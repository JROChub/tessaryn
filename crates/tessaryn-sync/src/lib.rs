//! Signed, encrypted, branch-preserving TESSARYN Locus synchronization.

#![forbid(unsafe_code)]

use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use tessaryn_canonical::{
    canonical_manifest, cell_id, chunk_id, chunk_merkle_root, parse_strict_json_bounded,
};
use tessaryn_powerhouse::{verify_bundle, BridgeError, CellProofBundle};
use tessaryn_privacy::{
    decrypt_locus, encrypt_locus, EncryptedLocusV0, PrivacyError, RecipientPublicKey,
    RecipientSecretKey, RevocationRegistry,
};
use tessaryn_schema::{CellManifestV0, Digest};
use tessaryn_store::{CellStore, StoreError};
use tessaryn_witness::{verify_receipt, verify_witness_set, WitnessError, WitnessReceiptV0};
use thiserror::Error;
use zeroize::Zeroizing;

const LOCUS_SCHEMA_V0: &str = "tessaryn/portable-locus/v0";
const SYNC_SCHEMA_V0: &str = "tessaryn/sync-packet/v0";
const MAX_LOCUS_BYTES: usize = 256 * 1024 * 1024;
const MAX_SYNC_PACKET_BYTES: usize = 512 * 1024 * 1024;
const MAX_CELLS: usize = 4_096;
const MAX_CHANNELS_PER_CELL: usize = 64;
const MAX_CHUNKS: usize = 16_384;

/// One content-addressed binary chunk in a portable Locus.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChunkTransferV0 {
    /// Declared content identity.
    pub chunk_id: Digest,
    /// Exact chunk bytes.
    #[serde(with = "tessaryn_transport::bytes_base64")]
    pub bytes: Vec<u8>,
}

/// Chunks committed by one Cell channel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChannelTransferV0 {
    /// Channel role from the Cell manifest.
    pub role: String,
    /// Channel Merkle root from the Cell manifest.
    pub chunk_root: Digest,
    /// Canonically chunk-ID-sorted content.
    pub chunks: Vec<ChunkTransferV0>,
}

/// Complete material required to install one Cell.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CellTransferV0 {
    /// Declared Cell identity.
    pub cell_id: Digest,
    /// Canonical Cell manifest.
    pub manifest: CellManifestV0,
    /// Complete per-channel chunk sets.
    pub channels: Vec<ChannelTransferV0>,
}

/// Selective, self-contained Locus transferred between peers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortableLocusV0 {
    /// Exact transport schema.
    pub schema: String,
    /// Rootprint branch retained by this transfer.
    pub branch_id: Digest,
    /// Materialization receipt that selected this bounded Locus.
    pub materialization_receipt: Digest,
    /// Canonically Cell-ID-sorted content.
    pub cells: Vec<CellTransferV0>,
    /// One independently verifiable Power House package per transferred Cell.
    pub proofs: Vec<CellProofBundle>,
    /// Optional explicit non-core witness receipts bound to transferred identities.
    pub witnesses: Vec<WitnessReceiptV0>,
}

impl PortableLocusV0 {
    /// Validates every Cell, channel Merkle root, and chunk identity.
    pub fn canonicalized(mut self) -> Result<Self, SyncError> {
        if self.schema != LOCUS_SCHEMA_V0
            || self.cells.is_empty()
            || self.cells.len() > MAX_CELLS
            || self.proofs.len() != self.cells.len()
        {
            return Err(SyncError::MalformedLocus);
        }
        self.cells
            .sort_by(|left, right| left.cell_id.cmp(&right.cell_id));
        if self
            .cells
            .windows(2)
            .any(|pair| pair[0].cell_id == pair[1].cell_id)
        {
            return Err(SyncError::MalformedLocus);
        }
        let mut total_chunks = 0_usize;
        let mut total_bytes = 0_usize;
        for cell in &mut self.cells {
            cell.manifest = canonical_manifest(&cell.manifest)?;
            if cell_id(&cell.manifest)? != cell.cell_id
                || cell.channels.is_empty()
                || cell.channels.len() > MAX_CHANNELS_PER_CELL
                || cell.channels.len() != cell.manifest.channels.len()
            {
                return Err(SyncError::MalformedLocus);
            }
            cell.channels.sort_by(|left, right| {
                (&left.role, &left.chunk_root).cmp(&(&right.role, &right.chunk_root))
            });
            let expected_channels = cell
                .manifest
                .channels
                .iter()
                .map(|channel| (&channel.role, &channel.chunk_root))
                .collect::<Vec<_>>();
            let received_channels = cell
                .channels
                .iter()
                .map(|channel| (&channel.role, &channel.chunk_root))
                .collect::<Vec<_>>();
            if expected_channels != received_channels {
                return Err(SyncError::MalformedLocus);
            }
            let mut cell_chunk_ids = Vec::new();
            for channel in &mut cell.channels {
                if channel.chunks.is_empty() {
                    return Err(SyncError::MalformedLocus);
                }
                channel
                    .chunks
                    .sort_by(|left, right| left.chunk_id.cmp(&right.chunk_id));
                if channel
                    .chunks
                    .windows(2)
                    .any(|pair| pair[0].chunk_id == pair[1].chunk_id)
                {
                    return Err(SyncError::MalformedLocus);
                }
                let mut channel_ids = Vec::with_capacity(channel.chunks.len());
                for chunk in &channel.chunks {
                    total_chunks = total_chunks
                        .checked_add(1)
                        .ok_or(SyncError::ResourceLimit)?;
                    total_bytes = total_bytes
                        .checked_add(chunk.bytes.len())
                        .ok_or(SyncError::ResourceLimit)?;
                    if total_chunks > MAX_CHUNKS || total_bytes > MAX_LOCUS_BYTES {
                        return Err(SyncError::ResourceLimit);
                    }
                    if chunk_id(&chunk.bytes) != chunk.chunk_id {
                        return Err(SyncError::ChunkMismatch);
                    }
                    channel_ids.push(chunk.chunk_id.clone());
                    cell_chunk_ids.push(chunk.chunk_id.clone());
                }
                if chunk_merkle_root(&channel_ids) != channel.chunk_root {
                    return Err(SyncError::ChunkMismatch);
                }
            }
            if chunk_merkle_root(&cell_chunk_ids) != cell.manifest.chunk_merkle_root {
                return Err(SyncError::ChunkMismatch);
            }
        }
        self.proofs
            .sort_by(|left, right| left.cell_id.cmp(&right.cell_id));
        if self
            .proofs
            .windows(2)
            .any(|pair| pair[0].cell_id == pair[1].cell_id)
        {
            return Err(SyncError::MalformedLocus);
        }
        for (cell, proof) in self.cells.iter().zip(&self.proofs) {
            if proof.cell_id != cell.cell_id
                || canonical_manifest(&proof.manifest)? != cell.manifest
            {
                return Err(SyncError::ProofBindingMismatch);
            }
            verify_bundle(proof)?;
        }
        let mut allowed_subjects =
            BTreeSet::from([self.branch_id.clone(), self.materialization_receipt.clone()]);
        for cell in &self.cells {
            allowed_subjects.insert(cell.cell_id.clone());
            for channel in &cell.channels {
                allowed_subjects.extend(channel.chunks.iter().map(|chunk| chunk.chunk_id.clone()));
            }
        }
        self.witnesses.sort_by(|left, right| {
            (&left.statement_id, left.witness_public_key.witness_id())
                .cmp(&(&right.statement_id, right.witness_public_key.witness_id()))
        });
        if self.witnesses.windows(2).any(|pair| pair[0] == pair[1]) {
            return Err(SyncError::MalformedLocus);
        }
        for receipt in &self.witnesses {
            verify_receipt(receipt, receipt.statement.observed_at_unix_us)?;
            if receipt
                .statement
                .subject_digests
                .iter()
                .any(|subject| !allowed_subjects.contains(subject))
            {
                return Err(SyncError::WitnessBindingMismatch);
            }
        }
        Ok(self)
    }

    /// Returns the portable identity of the validated Locus bytes.
    pub fn locus_id(&self) -> Result<Digest, SyncError> {
        let canonical = self.clone().canonicalized()?;
        Ok(domain_digest(
            b"TESSARYN-PORTABLE-LOCUS-ID-v0",
            &[&serde_json::to_vec(&canonical)?],
        ))
    }
}

/// Public Ed25519 synchronization identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct DeviceSigningPublicKey {
    /// Encoded Ed25519 verification key.
    pub bytes: [u8; 32],
}

impl DeviceSigningPublicKey {
    /// Returns the stable sender identity.
    pub fn sender_id(&self) -> Digest {
        domain_digest(b"TESSARYN-SYNC-SENDER-ID-v0", &[&self.bytes])
    }
}

/// Secret Ed25519 synchronization key.
pub struct DeviceSigningKey(SigningKey);

impl DeviceSigningKey {
    /// Generates a fresh operating-system-random signing identity.
    pub fn generate() -> Result<Self, SyncError> {
        let mut secret = Zeroizing::new([0_u8; 32]);
        getrandom::fill(secret.as_mut()).map_err(|_| SyncError::RandomnessUnavailable)?;
        Ok(Self(SigningKey::from_bytes(&secret)))
    }

    /// Imports a signing key from owned secret bytes.
    pub fn from_bytes(secret: [u8; 32]) -> Self {
        let secret = Zeroizing::new(secret);
        Self(SigningKey::from_bytes(&secret))
    }

    /// Returns the public verification key.
    pub fn public_key(&self) -> DeviceSigningPublicKey {
        DeviceSigningPublicKey {
            bytes: self.0.verifying_key().to_bytes(),
        }
    }
}

/// Signed and encrypted branch-specific synchronization packet.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncPacketV0 {
    /// Exact packet schema.
    pub schema: String,
    /// Sender verification key.
    pub sender_public_key: DeviceSigningPublicKey,
    /// Rootprint branch preserved by this stream.
    pub branch_id: Digest,
    /// Zero-based contiguous sequence per sender and branch.
    pub sequence: u64,
    /// Previous accepted packet identity, absent only at sequence zero.
    pub previous_packet_id: Option<Digest>,
    /// Sender-declared creation time.
    pub created_at_unix_us: i64,
    /// Digest binding the complete encrypted payload.
    pub encrypted_payload_digest: Digest,
    /// Encrypted selective Locus.
    pub encrypted_payload: EncryptedLocusV0,
    /// Packet identity excluding this signature.
    pub packet_id: Digest,
    /// Ed25519 signature bytes.
    #[serde(with = "tessaryn_transport::bytes_base64")]
    pub signature: Vec<u8>,
}

/// Accepted per-sender, per-branch packet head.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AcceptedHeadV0 {
    /// Last contiguous sequence.
    pub sequence: u64,
    /// Last packet identity.
    pub packet_id: Digest,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
struct StreamKey {
    sender_id: Digest,
    branch_id: Digest,
}

/// Persistent replay and branch-head state for a receiving peer.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncState {
    heads: BTreeMap<StreamKey, AcceptedHeadV0>,
    seen_packets: BTreeSet<Digest>,
}

impl SyncState {
    /// Returns the accepted head for one sender and branch.
    pub fn head(
        &self,
        sender: &DeviceSigningPublicKey,
        branch_id: &Digest,
    ) -> Option<&AcceptedHeadV0> {
        self.heads.get(&StreamKey {
            sender_id: sender.sender_id(),
            branch_id: branch_id.clone(),
        })
    }

    /// Number of independently retained sender/branch streams.
    pub fn branch_stream_count(&self) -> usize {
        self.heads.len()
    }
}

/// Builds, encrypts, and signs one selective Locus packet.
pub fn create_sync_packet(
    locus: PortableLocusV0,
    sender: &DeviceSigningKey,
    recipients: &[RecipientPublicKey],
    sequence: u64,
    previous_packet_id: Option<Digest>,
    created_at_unix_us: i64,
) -> Result<SyncPacketV0, SyncError> {
    validate_chain_shape(sequence, previous_packet_id.as_ref())?;
    let locus = locus.canonicalized()?;
    let branch_id = locus.branch_id.clone();
    let plaintext = serde_json::to_vec(&locus)?;
    if plaintext.len() > MAX_LOCUS_BYTES {
        return Err(SyncError::ResourceLimit);
    }
    let sender_public_key = sender.public_key();
    let aad = packet_aad(
        &sender_public_key,
        &branch_id,
        sequence,
        previous_packet_id.as_ref(),
        created_at_unix_us,
    );
    let encrypted_payload = encrypt_locus(&plaintext, &aad, recipients)?;
    let encrypted_payload_digest = encrypted_payload_digest(&encrypted_payload)?;
    let packet_id = calculate_packet_id(
        &sender_public_key,
        &branch_id,
        sequence,
        previous_packet_id.as_ref(),
        created_at_unix_us,
        &encrypted_payload_digest,
    );
    let signature = sender
        .0
        .sign(&signing_message(&packet_id))
        .to_bytes()
        .to_vec();
    Ok(SyncPacketV0 {
        schema: SYNC_SCHEMA_V0.to_string(),
        sender_public_key,
        branch_id,
        sequence,
        previous_packet_id,
        created_at_unix_us,
        encrypted_payload_digest,
        encrypted_payload,
        packet_id,
        signature,
    })
}

/// Verifies, decrypts, validates, and accepts one synchronization packet.
pub fn receive_sync_packet(
    packet: &SyncPacketV0,
    recipient: &RecipientSecretKey,
    registry: &RevocationRegistry,
    received_at_unix_us: i64,
    state: &mut SyncState,
) -> Result<PortableLocusV0, SyncError> {
    verify_sync_packet(packet)?;
    validate_next(packet, state)?;
    let aad = packet_aad(
        &packet.sender_public_key,
        &packet.branch_id,
        packet.sequence,
        packet.previous_packet_id.as_ref(),
        packet.created_at_unix_us,
    );
    let plaintext = decrypt_locus(
        &packet.encrypted_payload,
        &aad,
        recipient,
        registry,
        received_at_unix_us,
    )?;
    let locus = decode_locus(&plaintext)?;
    if locus.branch_id != packet.branch_id {
        return Err(SyncError::BranchMismatch);
    }
    if !locus.witnesses.is_empty() {
        verify_witness_set(&locus.witnesses, received_at_unix_us)?;
    }
    accept(packet, state);
    Ok(locus)
}

/// Installs a fully validated Locus in a content-addressed local store.
pub fn install_locus(store: &CellStore, locus: PortableLocusV0) -> Result<Digest, SyncError> {
    let locus = locus.canonicalized()?;
    let locus_id = locus.locus_id()?;
    for cell in &locus.cells {
        for channel in &cell.channels {
            for chunk in &channel.chunks {
                if store.put_chunk(&chunk.bytes)? != chunk.chunk_id {
                    return Err(SyncError::ChunkMismatch);
                }
            }
        }
        if store.put_manifest(&cell.manifest)? != cell.cell_id {
            return Err(SyncError::CellMismatch);
        }
    }
    Ok(locus_id)
}

fn decode_locus(bytes: &[u8]) -> Result<PortableLocusV0, SyncError> {
    if bytes.len() > MAX_LOCUS_BYTES {
        return Err(SyncError::ResourceLimit);
    }
    let locus = serde_json::from_slice::<PortableLocusV0>(bytes)?;
    let canonical = locus.canonicalized()?;
    if serde_json::to_vec(&canonical)? != bytes {
        return Err(SyncError::NonCanonicalLocus);
    }
    Ok(canonical)
}

/// Verifies packet identity, encrypted payload binding, and Ed25519 signature.
pub fn verify_sync_packet(packet: &SyncPacketV0) -> Result<(), SyncError> {
    validate_chain_shape(packet.sequence, packet.previous_packet_id.as_ref())?;
    if packet.schema != SYNC_SCHEMA_V0 || packet.signature.len() != 64 {
        return Err(SyncError::MalformedPacket);
    }
    let payload_digest = encrypted_payload_digest(&packet.encrypted_payload)?;
    if payload_digest != packet.encrypted_payload_digest {
        return Err(SyncError::PayloadMismatch);
    }
    let expected_id = calculate_packet_id(
        &packet.sender_public_key,
        &packet.branch_id,
        packet.sequence,
        packet.previous_packet_id.as_ref(),
        packet.created_at_unix_us,
        &packet.encrypted_payload_digest,
    );
    if expected_id != packet.packet_id {
        return Err(SyncError::PacketIdentityMismatch);
    }
    let verifying_key = VerifyingKey::from_bytes(&packet.sender_public_key.bytes)
        .map_err(|_| SyncError::InvalidSignature)?;
    let signature_bytes: [u8; 64] = packet
        .signature
        .as_slice()
        .try_into()
        .map_err(|_| SyncError::InvalidSignature)?;
    let signature = Signature::from_bytes(&signature_bytes);
    verifying_key
        .verify_strict(&signing_message(&packet.packet_id), &signature)
        .map_err(|_| SyncError::InvalidSignature)
}

/// Encodes one verified packet in the strict canonical JSON transport profile.
pub fn encode_sync_packet(packet: &SyncPacketV0) -> Result<Vec<u8>, SyncError> {
    verify_sync_packet(packet)?;
    let bytes = serde_json::to_vec(packet)?;
    if bytes.len() > MAX_SYNC_PACKET_BYTES {
        return Err(SyncError::ResourceLimit);
    }
    Ok(bytes)
}

/// Strictly decodes, canonical-form checks, and verifies one packet.
pub fn decode_sync_packet(bytes: &[u8]) -> Result<SyncPacketV0, SyncError> {
    let value = parse_strict_json_bounded(bytes, MAX_SYNC_PACKET_BYTES)?;
    let packet = serde_json::from_value::<SyncPacketV0>(value)?;
    if serde_json::to_vec(&packet)? != bytes {
        return Err(SyncError::NonCanonicalPacket);
    }
    verify_sync_packet(&packet)?;
    Ok(packet)
}

fn validate_next(packet: &SyncPacketV0, state: &SyncState) -> Result<(), SyncError> {
    if state.seen_packets.contains(&packet.packet_id) {
        return Err(SyncError::Replay);
    }
    match state.head(&packet.sender_public_key, &packet.branch_id) {
        None if packet.sequence == 0 && packet.previous_packet_id.is_none() => Ok(()),
        Some(head)
            if packet.sequence == head.sequence.saturating_add(1)
                && packet.previous_packet_id.as_ref() == Some(&head.packet_id) =>
        {
            Ok(())
        }
        _ => Err(SyncError::SequenceViolation),
    }
}

fn accept(packet: &SyncPacketV0, state: &mut SyncState) {
    state.seen_packets.insert(packet.packet_id.clone());
    state.heads.insert(
        StreamKey {
            sender_id: packet.sender_public_key.sender_id(),
            branch_id: packet.branch_id.clone(),
        },
        AcceptedHeadV0 {
            sequence: packet.sequence,
            packet_id: packet.packet_id.clone(),
        },
    );
}

fn validate_chain_shape(sequence: u64, previous: Option<&Digest>) -> Result<(), SyncError> {
    if (sequence == 0) != previous.is_none() {
        return Err(SyncError::SequenceViolation);
    }
    Ok(())
}

fn encrypted_payload_digest(payload: &EncryptedLocusV0) -> Result<Digest, SyncError> {
    Ok(domain_digest(
        b"TESSARYN-SYNC-ENCRYPTED-PAYLOAD-v0",
        &[&serde_json::to_vec(payload)?],
    ))
}

fn calculate_packet_id(
    sender: &DeviceSigningPublicKey,
    branch_id: &Digest,
    sequence: u64,
    previous_packet_id: Option<&Digest>,
    created_at_unix_us: i64,
    encrypted_payload_digest: &Digest,
) -> Digest {
    let sequence_bytes = sequence.to_be_bytes();
    let created_bytes = created_at_unix_us.to_be_bytes();
    let previous = previous_packet_id.map_or(b"".as_slice(), |digest| digest.as_str().as_bytes());
    domain_digest(
        b"TESSARYN-SYNC-PACKET-ID-v0",
        &[
            &sender.bytes,
            branch_id.as_str().as_bytes(),
            &sequence_bytes,
            previous,
            &created_bytes,
            encrypted_payload_digest.as_str().as_bytes(),
        ],
    )
}

fn packet_aad(
    sender: &DeviceSigningPublicKey,
    branch_id: &Digest,
    sequence: u64,
    previous_packet_id: Option<&Digest>,
    created_at_unix_us: i64,
) -> Vec<u8> {
    let sequence_bytes = sequence.to_be_bytes();
    let created_bytes = created_at_unix_us.to_be_bytes();
    let previous = previous_packet_id.map_or(b"".as_slice(), |digest| digest.as_str().as_bytes());
    encode_parts(
        b"TESSARYN-SYNC-PACKET-AAD-v0",
        &[
            &sender.bytes,
            branch_id.as_str().as_bytes(),
            &sequence_bytes,
            previous,
            &created_bytes,
        ],
    )
}

fn signing_message(packet_id: &Digest) -> Vec<u8> {
    encode_parts(
        b"TESSARYN-SYNC-PACKET-SIGNATURE-v0",
        &[packet_id.as_str().as_bytes()],
    )
}

fn domain_digest(domain: &[u8], parts: &[&[u8]]) -> Digest {
    Digest::new(format!(
        "sha256:{}",
        hex::encode(Sha256::digest(encode_parts(domain, parts)))
    ))
    .expect("SHA-256 always produces a valid digest")
}

fn encode_parts(domain: &[u8], parts: &[&[u8]]) -> Vec<u8> {
    let mut encoded = Vec::new();
    encoded.extend_from_slice(&(domain.len() as u64).to_be_bytes());
    encoded.extend_from_slice(domain);
    for part in parts {
        encoded.extend_from_slice(&(part.len() as u64).to_be_bytes());
        encoded.extend_from_slice(part);
    }
    encoded
}

/// Synchronization failure.
#[derive(Debug, Error)]
pub enum SyncError {
    /// Operating-system randomness was unavailable.
    #[error("operating-system randomness unavailable")]
    RandomnessUnavailable,
    /// Portable Locus structure or dimensions were malformed.
    #[error("malformed portable Locus")]
    MalformedLocus,
    /// Locus exceeded a bounded resource profile.
    #[error("portable Locus resource limit exceeded")]
    ResourceLimit,
    /// Chunk bytes or Merkle root did not match the declaration.
    #[error("portable Locus chunk commitment mismatch")]
    ChunkMismatch,
    /// Cell identity did not match its canonical manifest.
    #[error("portable Locus Cell identity mismatch")]
    CellMismatch,
    /// Locus bytes were valid JSON but not canonical sender output.
    #[error("portable Locus transport is not canonical")]
    NonCanonicalLocus,
    /// Packet JSON was parseable but not the one canonical transport form.
    #[error("synchronization packet transport is not canonical")]
    NonCanonicalPacket,
    /// Packet structure or dimensions were malformed.
    #[error("malformed synchronization packet")]
    MalformedPacket,
    /// Encrypted payload no longer matched its packet commitment.
    #[error("synchronization payload commitment mismatch")]
    PayloadMismatch,
    /// Packet identity no longer matched its signed fields.
    #[error("synchronization packet identity mismatch")]
    PacketIdentityMismatch,
    /// Packet signature was malformed or invalid.
    #[error("invalid synchronization packet signature")]
    InvalidSignature,
    /// Packet was already accepted.
    #[error("synchronization packet replay rejected")]
    Replay,
    /// Sequence or previous-packet relation was invalid.
    #[error("synchronization sequence chain rejected")]
    SequenceViolation,
    /// Encrypted Locus branch differed from its packet branch.
    #[error("synchronization branch binding mismatch")]
    BranchMismatch,
    /// Restricted Locus transport failed.
    #[error(transparent)]
    Privacy(#[from] PrivacyError),
    /// Canonical Cell operation failed.
    #[error(transparent)]
    Canonical(#[from] tessaryn_canonical::CanonicalError),
    /// JSON operation failed.
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    /// Local content-addressed storage failed.
    #[error(transparent)]
    Store(#[from] StoreError),
    /// Power House Cell package verification failed.
    #[error(transparent)]
    Bridge(#[from] BridgeError),
    /// Power House package did not bind the transferred Cell.
    #[error("portable Locus Power House proof binding mismatch")]
    ProofBindingMismatch,
    /// Witness receipt verification failed.
    #[error(transparent)]
    Witness(#[from] WitnessError),
    /// Witness subjects were not part of the transferred Locus.
    #[error("portable Locus witness subject binding mismatch")]
    WitnessBindingMismatch,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};
    use tessaryn_powerhouse::prove_cell;
    use tessaryn_schema::{
        CellClass, ChannelDescriptor, Criticality, EvidenceDeclaration, SourceRecord,
        SpatialExtent, TemporalExtent, TemporalStateKind, TransformRecord, CELL_SCHEMA_V0,
    };
    use tessaryn_witness::{
        sign_statement, AttestationClass, WitnessSigningKey, WitnessStatementV0,
    };

    static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    fn digest(value: u8) -> Digest {
        Digest::new(format!("sha256:{}", format!("{value:02x}").repeat(32))).unwrap()
    }

    fn locus(branch: Digest, bytes: &[u8]) -> PortableLocusV0 {
        let chunk_id = chunk_id(bytes);
        let chunk_root = chunk_merkle_root(std::slice::from_ref(&chunk_id));
        let manifest = CellManifestV0 {
            schema: CELL_SCHEMA_V0.to_string(),
            class: CellClass::Observation,
            anchor_id: digest(2),
            spatial_extent: SpatialExtent {
                min_um: [0, 0, 0],
                max_um: [1, 1, 1],
                orientation_q30: [0, 0, 0, 1 << 30],
                uncertainty_um: [1; 3],
            },
            temporal_extent: TemporalExtent {
                start_unix_us: 100,
                end_unix_us: 100,
                uncertainty_us: 1,
                clock_source: "sync/test-v0".to_string(),
                published_at_unix_us: 100,
                valid_from_unix_us: 100,
                valid_until_unix_us: None,
                supersedes: Vec::new(),
                state_kind: TemporalStateKind::Observed,
            },
            channels: vec![ChannelDescriptor {
                role: "geometry/surfel".to_string(),
                codec: "application/octet-stream".to_string(),
                codec_version: "0".to_string(),
                chunk_root: chunk_root.clone(),
                uncompressed_bytes: bytes.len() as u64,
                quality_tier: 0,
                criticality: Criticality::Critical,
                license: "private".to_string(),
            }],
            parents: Vec::new(),
            source_records: vec![SourceRecord {
                source_id: digest(3),
                source_type: "sync-test".to_string(),
                producer: "sync-test-device".to_string(),
                captured_at_unix_us: 100,
                device_key: None,
            }],
            transform_records: vec![TransformRecord {
                transform_id: digest(4),
                method: "sync-test".to_string(),
                tool: "tessaryn-sync-tests".to_string(),
                tool_version: env!("CARGO_PKG_VERSION").to_string(),
                input_ids: vec![digest(5)],
            }],
            policy_root: digest(6),
            evidence: EvidenceDeclaration {
                identity_committed: true,
                replay_available: true,
                source_attributed: true,
                disputed: false,
                semantic_only: false,
                restricted: true,
            },
            chunk_merkle_root: chunk_root.clone(),
        };
        let cell_id = cell_id(&manifest).unwrap();
        let proof = prove_cell(manifest.clone(), None).unwrap();
        PortableLocusV0 {
            schema: LOCUS_SCHEMA_V0.to_string(),
            branch_id: branch,
            materialization_receipt: digest(7),
            cells: vec![CellTransferV0 {
                cell_id,
                manifest,
                channels: vec![ChannelTransferV0 {
                    role: "geometry/surfel".to_string(),
                    chunk_root,
                    chunks: vec![ChunkTransferV0 {
                        chunk_id,
                        bytes: bytes.to_vec(),
                    }],
                }],
            }],
            proofs: vec![proof],
            witnesses: Vec::new(),
        }
    }

    #[test]
    fn two_devices_exchange_verify_decrypt_and_install_private_locus() {
        let sender = DeviceSigningKey::generate().unwrap();
        let recipient = RecipientSecretKey::generate().unwrap();
        let branch = digest(10);
        let private_bytes = b"private world geometry";
        let packet = create_sync_packet(
            locus(branch.clone(), private_bytes),
            &sender,
            &[recipient.public_key()],
            0,
            None,
            100,
        )
        .unwrap();
        assert!(!packet
            .encrypted_payload
            .ciphertext
            .windows(private_bytes.len())
            .any(|window| window == private_bytes));
        let mut state = SyncState::default();
        let received = receive_sync_packet(
            &packet,
            &recipient,
            &RevocationRegistry::default(),
            101,
            &mut state,
        )
        .unwrap();
        assert_eq!(received.branch_id, branch);

        let root = std::env::temp_dir().join(format!(
            "tessaryn-sync-test-{}-{}",
            std::process::id(),
            TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let store = CellStore::open(&root).unwrap();
        let expected_locus_id = received.locus_id().unwrap();
        assert_eq!(
            install_locus(&store, received.clone()).unwrap(),
            expected_locus_id
        );
        assert_eq!(
            store
                .get_chunk(&received.cells[0].channels[0].chunks[0].chunk_id)
                .unwrap(),
            private_bytes
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn unauthorized_replay_and_wrong_chain_are_rejected() {
        let sender = DeviceSigningKey::generate().unwrap();
        let recipient = RecipientSecretKey::generate().unwrap();
        let denied = RecipientSecretKey::generate().unwrap();
        let branch = digest(11);
        let first = create_sync_packet(
            locus(branch.clone(), b"first"),
            &sender,
            &[recipient.public_key()],
            0,
            None,
            100,
        )
        .unwrap();
        assert!(matches!(
            receive_sync_packet(
                &first,
                &denied,
                &RevocationRegistry::default(),
                100,
                &mut SyncState::default()
            ),
            Err(SyncError::Privacy(PrivacyError::RecipientNotAuthorized))
        ));
        let mut state = SyncState::default();
        receive_sync_packet(
            &first,
            &recipient,
            &RevocationRegistry::default(),
            100,
            &mut state,
        )
        .unwrap();
        assert!(matches!(
            receive_sync_packet(
                &first,
                &recipient,
                &RevocationRegistry::default(),
                100,
                &mut state
            ),
            Err(SyncError::Replay)
        ));
        let wrong_previous = create_sync_packet(
            locus(branch, b"second"),
            &sender,
            &[recipient.public_key()],
            1,
            Some(digest(99)),
            101,
        )
        .unwrap();
        assert!(matches!(
            receive_sync_packet(
                &wrong_previous,
                &recipient,
                &RevocationRegistry::default(),
                101,
                &mut state
            ),
            Err(SyncError::SequenceViolation)
        ));
    }

    #[test]
    fn tampered_payload_and_signature_are_rejected_before_decryption() {
        let sender = DeviceSigningKey::generate().unwrap();
        let recipient = RecipientSecretKey::generate().unwrap();
        let packet = create_sync_packet(
            locus(digest(12), b"private"),
            &sender,
            &[recipient.public_key()],
            0,
            None,
            100,
        )
        .unwrap();
        let mut payload_tamper = packet.clone();
        payload_tamper.encrypted_payload.ciphertext[0] ^= 1;
        assert!(matches!(
            verify_sync_packet(&payload_tamper),
            Err(SyncError::PayloadMismatch)
        ));
        let mut signature_tamper = packet;
        signature_tamper.signature[0] ^= 1;
        assert!(matches!(
            verify_sync_packet(&signature_tamper),
            Err(SyncError::InvalidSignature)
        ));
    }

    #[test]
    fn divergent_branches_remain_independent_streams() {
        let sender = DeviceSigningKey::generate().unwrap();
        let recipient = RecipientSecretKey::generate().unwrap();
        let left = create_sync_packet(
            locus(digest(13), b"left"),
            &sender,
            &[recipient.public_key()],
            0,
            None,
            100,
        )
        .unwrap();
        let right = create_sync_packet(
            locus(digest(14), b"right"),
            &sender,
            &[recipient.public_key()],
            0,
            None,
            100,
        )
        .unwrap();
        let mut state = SyncState::default();
        for packet in [&left, &right] {
            receive_sync_packet(
                packet,
                &recipient,
                &RevocationRegistry::default(),
                101,
                &mut state,
            )
            .unwrap();
        }
        assert_eq!(state.branch_stream_count(), 2);
        assert!(state.head(&sender.public_key(), &left.branch_id).is_some());
        assert!(state.head(&sender.public_key(), &right.branch_id).is_some());
    }

    #[test]
    fn chunk_mutation_is_rejected_before_packet_creation() {
        let sender = DeviceSigningKey::generate().unwrap();
        let recipient = RecipientSecretKey::generate().unwrap();
        let mut malformed = locus(digest(15), b"valid");
        malformed.cells[0].channels[0].chunks[0].bytes[0] ^= 1;
        assert!(matches!(
            create_sync_packet(malformed, &sender, &[recipient.public_key()], 0, None, 100),
            Err(SyncError::ChunkMismatch)
        ));
    }

    #[test]
    fn substituted_power_house_bundle_is_rejected_before_encryption() {
        let sender = DeviceSigningKey::generate().unwrap();
        let recipient = RecipientSecretKey::generate().unwrap();
        let mut malformed = locus(digest(16), b"valid");
        malformed.proofs[0].cell_id = digest(99);
        assert!(matches!(
            create_sync_packet(malformed, &sender, &[recipient.public_key()], 0, None, 100),
            Err(SyncError::ProofBindingMismatch)
        ));
    }

    #[test]
    fn strict_packet_transport_round_trips_and_rejects_ambiguity() {
        let sender = DeviceSigningKey::generate().unwrap();
        let recipient = RecipientSecretKey::generate().unwrap();
        let packet = create_sync_packet(
            locus(digest(17), b"strict-packet"),
            &sender,
            &[recipient.public_key()],
            0,
            None,
            100,
        )
        .unwrap();
        let encoded = encode_sync_packet(&packet).unwrap();
        assert_eq!(
            decode_sync_packet(&encoded).unwrap().packet_id,
            packet.packet_id
        );
        let pretty = serde_json::to_vec_pretty(&packet).unwrap();
        assert!(matches!(
            decode_sync_packet(&pretty),
            Err(SyncError::NonCanonicalPacket)
        ));
        let duplicate = String::from_utf8(encoded).unwrap().replacen(
            r#"{"schema":"tessaryn/sync-packet/v0""#,
            r#"{"schema":"invalid","schema":"tessaryn/sync-packet/v0""#,
            1,
        );
        assert!(decode_sync_packet(duplicate.as_bytes()).is_err());
    }

    #[test]
    fn bound_witness_receipt_survives_private_peer_exchange() {
        let sender = DeviceSigningKey::generate().unwrap();
        let recipient = RecipientSecretKey::generate().unwrap();
        let signer = WitnessSigningKey::generate().unwrap();
        let mut transferred = locus(digest(18), b"witnessed");
        let subject = transferred.cells[0].cell_id.clone();
        transferred.witnesses.push(
            sign_statement(
                WitnessStatementV0 {
                    schema: "tessaryn/witness-statement/v0".to_string(),
                    attestation_class: AttestationClass::BytesObserved,
                    subject_digests: vec![subject],
                    observed_at_unix_us: 100,
                    valid_until_unix_us: Some(200),
                    independence_group: "sync-test-lab".to_string(),
                    qualification: None,
                    core_proof_claimed: false,
                },
                &signer,
            )
            .unwrap(),
        );
        let packet = create_sync_packet(
            transferred,
            &sender,
            &[recipient.public_key()],
            0,
            None,
            100,
        )
        .unwrap();
        let received = receive_sync_packet(
            &packet,
            &recipient,
            &RevocationRegistry::default(),
            150,
            &mut SyncState::default(),
        )
        .unwrap();
        assert_eq!(received.witnesses.len(), 1);
    }

    #[test]
    fn witness_for_external_subject_is_rejected_before_encryption() {
        let sender = DeviceSigningKey::generate().unwrap();
        let recipient = RecipientSecretKey::generate().unwrap();
        let signer = WitnessSigningKey::generate().unwrap();
        let mut transferred = locus(digest(19), b"witnessed");
        transferred.witnesses.push(
            sign_statement(
                WitnessStatementV0 {
                    schema: "tessaryn/witness-statement/v0".to_string(),
                    attestation_class: AttestationClass::BytesObserved,
                    subject_digests: vec![digest(99)],
                    observed_at_unix_us: 100,
                    valid_until_unix_us: None,
                    independence_group: "sync-test-lab".to_string(),
                    qualification: None,
                    core_proof_claimed: false,
                },
                &signer,
            )
            .unwrap(),
        );
        assert!(matches!(
            create_sync_packet(
                transferred,
                &sender,
                &[recipient.public_key()],
                0,
                None,
                100
            ),
            Err(SyncError::WitnessBindingMismatch)
        ));
    }
}
