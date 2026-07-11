//! Explicit signed witness receipts that remain outside core Cell truth.

#![forbid(unsafe_code)]

use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use tessaryn_schema::Digest;
use thiserror::Error;
use zeroize::Zeroizing;

const WITNESS_SCHEMA_V0: &str = "tessaryn/witness-statement/v0";
const MAX_SUBJECTS: usize = 1_024;
const MAX_RECEIPTS: usize = 4_096;
const MAX_RECEIPT_BYTES: usize = 1024 * 1024;

/// Exact boundary of a human or device witness statement.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AttestationClass {
    /// Witness possessed or inspected committed bytes.
    BytesObserved,
    /// Witness observed a named capture device participating.
    DevicePresent,
    /// Human witness declares that a physical scene was observed.
    PhysicalSceneObserved,
    /// Authorized operator reviewed a declared transformation or policy.
    OperatorReview,
}

/// Canonical statement signed by one witness identity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WitnessStatementV0 {
    /// Exact statement schema.
    pub schema: String,
    /// Explicit attestation boundary.
    pub attestation_class: AttestationClass,
    /// Cell, chunk, receipt, or session identities being witnessed.
    pub subject_digests: Vec<Digest>,
    /// Observation time supplied by the witness.
    pub observed_at_unix_us: i64,
    /// Optional inclusive statement expiry.
    pub valid_until_unix_us: Option<i64>,
    /// Declared organizational or operational independence group.
    pub independence_group: String,
    /// Content address of a policy or qualification record.
    pub qualification: Option<Digest>,
    /// Witness receipts never become Power House core proof truth.
    pub core_proof_claimed: bool,
}

/// Public Ed25519 witness identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct WitnessPublicKey {
    /// Encoded Ed25519 verification key.
    pub bytes: [u8; 32],
}

impl WitnessPublicKey {
    /// Returns the stable public witness identity.
    pub fn witness_id(&self) -> Digest {
        domain_digest(b"TESSARYN-WITNESS-ID-v0", &[&self.bytes])
    }
}

/// Secret witness signing identity.
pub struct WitnessSigningKey(SigningKey);

impl WitnessSigningKey {
    /// Generates a fresh operating-system-random witness identity.
    pub fn generate() -> Result<Self, WitnessError> {
        let mut bytes = Zeroizing::new([0_u8; 32]);
        getrandom::fill(bytes.as_mut()).map_err(|_| WitnessError::RandomnessUnavailable)?;
        Ok(Self(SigningKey::from_bytes(&bytes)))
    }

    /// Imports an owned Ed25519 signing key.
    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        let bytes = Zeroizing::new(bytes);
        Self(SigningKey::from_bytes(&bytes))
    }

    /// Returns the corresponding public witness identity.
    pub fn public_key(&self) -> WitnessPublicKey {
        WitnessPublicKey {
            bytes: self.0.verifying_key().to_bytes(),
        }
    }
}

/// Signed portable witness receipt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WitnessReceiptV0 {
    /// Canonical statement.
    pub statement: WitnessStatementV0,
    /// Content identity of the canonical statement.
    pub statement_id: Digest,
    /// Public signer identity.
    pub witness_public_key: WitnessPublicKey,
    /// Ed25519 signature over the domain-separated statement identity.
    #[serde(with = "tessaryn_transport::bytes_base64")]
    pub signature: Vec<u8>,
}

/// Layered witness-set report; no universal score is produced.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WitnessSetReport {
    /// Number of valid receipts.
    pub receipts_valid: u64,
    /// Number of distinct signing keys.
    pub distinct_witnesses: u64,
    /// Number of declared independence groups.
    pub independence_groups: u64,
    /// Counts by explicit attestation class.
    pub attestation_classes: BTreeMap<AttestationClass, u64>,
    /// Whether every receipt was current at verification time.
    pub all_current: bool,
    /// Witness evidence remains non-core.
    pub changes_core_validity: bool,
}

/// Canonicalizes and signs one witness statement.
pub fn sign_statement(
    statement: WitnessStatementV0,
    signer: &WitnessSigningKey,
) -> Result<WitnessReceiptV0, WitnessError> {
    let statement = canonical_statement(statement)?;
    let statement_id = statement_id(&statement)?;
    let signature = signer
        .0
        .sign(&signature_message(&statement_id))
        .to_bytes()
        .to_vec();
    Ok(WitnessReceiptV0 {
        statement,
        statement_id,
        witness_public_key: signer.public_key(),
        signature,
    })
}

/// Verifies statement identity, signature, and temporal validity.
pub fn verify_receipt(receipt: &WitnessReceiptV0, at_unix_us: i64) -> Result<(), WitnessError> {
    if receipt.signature.len() != 64 {
        return Err(WitnessError::MalformedSignature);
    }
    let canonical = canonical_statement(receipt.statement.clone())?;
    if canonical != receipt.statement || statement_id(&canonical)? != receipt.statement_id {
        return Err(WitnessError::StatementMismatch);
    }
    if canonical
        .valid_until_unix_us
        .is_some_and(|expiry| at_unix_us > expiry)
    {
        return Err(WitnessError::Expired);
    }
    let key = VerifyingKey::from_bytes(&receipt.witness_public_key.bytes)
        .map_err(|_| WitnessError::MalformedSignature)?;
    let signature_bytes: [u8; 64] = receipt
        .signature
        .as_slice()
        .try_into()
        .map_err(|_| WitnessError::MalformedSignature)?;
    let signature = Signature::from_bytes(&signature_bytes);
    key.verify_strict(&signature_message(&receipt.statement_id), &signature)
        .map_err(|_| WitnessError::InvalidSignature)
}

/// Verifies and groups a bounded set without pretending groups are independent by default.
pub fn verify_witness_set(
    receipts: &[WitnessReceiptV0],
    at_unix_us: i64,
) -> Result<WitnessSetReport, WitnessError> {
    if receipts.is_empty() || receipts.len() > MAX_RECEIPTS {
        return Err(WitnessError::ReceiptLimit);
    }
    let mut receipt_ids = BTreeSet::new();
    let mut witnesses = BTreeSet::new();
    let mut groups = BTreeSet::new();
    let mut classes = BTreeMap::new();
    for receipt in receipts {
        verify_receipt(receipt, at_unix_us)?;
        let receipt_id = domain_digest(
            b"TESSARYN-WITNESS-RECEIPT-ID-v0",
            &[
                receipt.statement_id.as_str().as_bytes(),
                &receipt.witness_public_key.bytes,
                &receipt.signature,
            ],
        );
        if !receipt_ids.insert(receipt_id) {
            return Err(WitnessError::DuplicateReceipt);
        }
        witnesses.insert(receipt.witness_public_key.witness_id());
        groups.insert(receipt.statement.independence_group.clone());
        *classes
            .entry(receipt.statement.attestation_class)
            .or_insert(0) += 1;
    }
    Ok(WitnessSetReport {
        receipts_valid: receipts.len() as u64,
        distinct_witnesses: witnesses.len() as u64,
        independence_groups: groups.len() as u64,
        attestation_classes: classes,
        all_current: true,
        changes_core_validity: false,
    })
}

/// Encodes one verified receipt in its strict canonical JSON transport form.
pub fn encode_witness_receipt(receipt: &WitnessReceiptV0) -> Result<Vec<u8>, WitnessError> {
    verify_receipt(receipt, receipt.statement.observed_at_unix_us)?;
    let bytes = serde_json::to_vec(receipt).map_err(|_| WitnessError::Projection)?;
    if bytes.len() > MAX_RECEIPT_BYTES {
        return Err(WitnessError::ReceiptLimit);
    }
    Ok(bytes)
}

/// Strictly decodes and verifies one canonical witness receipt.
pub fn decode_witness_receipt(
    bytes: &[u8],
    at_unix_us: i64,
) -> Result<WitnessReceiptV0, WitnessError> {
    let value = tessaryn_canonical::parse_strict_json_bounded(bytes, MAX_RECEIPT_BYTES)
        .map_err(|_| WitnessError::NonCanonicalTransport)?;
    let receipt = serde_json::from_value::<WitnessReceiptV0>(value)
        .map_err(|_| WitnessError::NonCanonicalTransport)?;
    if serde_json::to_vec(&receipt).map_err(|_| WitnessError::Projection)? != bytes {
        return Err(WitnessError::NonCanonicalTransport);
    }
    verify_receipt(&receipt, at_unix_us)?;
    Ok(receipt)
}

fn canonical_statement(
    mut statement: WitnessStatementV0,
) -> Result<WitnessStatementV0, WitnessError> {
    if statement.schema != WITNESS_SCHEMA_V0
        || statement.subject_digests.is_empty()
        || statement.subject_digests.len() > MAX_SUBJECTS
        || statement.independence_group.trim().is_empty()
        || statement.independence_group.len() > 256
        || statement.core_proof_claimed
        || statement
            .valid_until_unix_us
            .is_some_and(|expiry| expiry < statement.observed_at_unix_us)
    {
        return Err(WitnessError::InvalidStatement);
    }
    statement.subject_digests.sort();
    statement.subject_digests.dedup();
    Ok(statement)
}

fn statement_id(statement: &WitnessStatementV0) -> Result<Digest, WitnessError> {
    let bytes = serde_json::to_vec(statement).map_err(|_| WitnessError::Projection)?;
    Ok(domain_digest(
        b"TESSARYN-WITNESS-STATEMENT-ID-v0",
        &[&bytes],
    ))
}

fn signature_message(statement_id: &Digest) -> Vec<u8> {
    encode_parts(
        b"TESSARYN-WITNESS-SIGNATURE-v0",
        &[statement_id.as_str().as_bytes()],
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

/// Witness receipt failure.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum WitnessError {
    /// Operating-system randomness was unavailable.
    #[error("operating-system randomness unavailable")]
    RandomnessUnavailable,
    /// Statement fields or evidence boundary were invalid.
    #[error("invalid witness statement")]
    InvalidStatement,
    /// Statement bytes no longer matched their identity.
    #[error("witness statement identity mismatch")]
    StatementMismatch,
    /// Signature encoding was malformed.
    #[error("malformed witness signature")]
    MalformedSignature,
    /// Signature did not authenticate the statement.
    #[error("invalid witness signature")]
    InvalidSignature,
    /// Statement had expired at the verification time.
    #[error("witness statement expired")]
    Expired,
    /// Witness set exceeded the bounded profile.
    #[error("witness receipt count outside bounded profile")]
    ReceiptLimit,
    /// Exact receipt was repeated in the set.
    #[error("duplicate witness receipt")]
    DuplicateReceipt,
    /// Canonical statement projection failed.
    #[error("witness statement projection failed")]
    Projection,
    /// Receipt JSON was ambiguous or not in the one canonical transport form.
    #[error("witness receipt transport is not canonical")]
    NonCanonicalTransport,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn digest(value: u8) -> Digest {
        Digest::new(format!("sha256:{}", format!("{value:02x}").repeat(32))).unwrap()
    }

    fn statement(group: &str, class: AttestationClass) -> WitnessStatementV0 {
        WitnessStatementV0 {
            schema: WITNESS_SCHEMA_V0.to_string(),
            attestation_class: class,
            subject_digests: vec![digest(2), digest(1)],
            observed_at_unix_us: 100,
            valid_until_unix_us: Some(200),
            independence_group: group.to_string(),
            qualification: Some(digest(3)),
            core_proof_claimed: false,
        }
    }

    #[test]
    fn receipts_verify_and_preserve_evidence_dimensions() {
        let first = WitnessSigningKey::generate().unwrap();
        let second = WitnessSigningKey::generate().unwrap();
        let receipts = vec![
            sign_statement(
                statement("lab-a", AttestationClass::PhysicalSceneObserved),
                &first,
            )
            .unwrap(),
            sign_statement(statement("lab-b", AttestationClass::BytesObserved), &second).unwrap(),
        ];
        let report = verify_witness_set(&receipts, 150).unwrap();
        assert_eq!(report.receipts_valid, 2);
        assert_eq!(report.distinct_witnesses, 2);
        assert_eq!(report.independence_groups, 2);
        assert_eq!(
            report.attestation_classes[&AttestationClass::PhysicalSceneObserved],
            1
        );
        assert!(!report.changes_core_validity);
    }

    #[test]
    fn same_group_is_not_misreported_as_independent() {
        let first = WitnessSigningKey::generate().unwrap();
        let second = WitnessSigningKey::generate().unwrap();
        let receipts = vec![
            sign_statement(
                statement("same-operator", AttestationClass::BytesObserved),
                &first,
            )
            .unwrap(),
            sign_statement(
                statement("same-operator", AttestationClass::BytesObserved),
                &second,
            )
            .unwrap(),
        ];
        let report = verify_witness_set(&receipts, 150).unwrap();
        assert_eq!(report.distinct_witnesses, 2);
        assert_eq!(report.independence_groups, 1);
    }

    #[test]
    fn signature_statement_expiry_and_duplicate_mutations_reject() {
        let signer = WitnessSigningKey::generate().unwrap();
        let receipt =
            sign_statement(statement("lab-a", AttestationClass::BytesObserved), &signer).unwrap();
        let mut signature = receipt.clone();
        signature.signature[0] ^= 1;
        assert_eq!(
            verify_receipt(&signature, 150),
            Err(WitnessError::InvalidSignature)
        );
        let mut subject = receipt.clone();
        subject.statement.subject_digests.push(digest(9));
        assert_eq!(
            verify_receipt(&subject, 150),
            Err(WitnessError::StatementMismatch)
        );
        assert_eq!(verify_receipt(&receipt, 201), Err(WitnessError::Expired));
        assert_eq!(
            verify_witness_set(&[receipt.clone(), receipt], 150),
            Err(WitnessError::DuplicateReceipt)
        );
    }

    #[test]
    fn semantic_or_witness_data_cannot_claim_core_proof_authority() {
        let signer = WitnessSigningKey::generate().unwrap();
        let mut invalid = statement("lab-a", AttestationClass::OperatorReview);
        invalid.core_proof_claimed = true;
        assert_eq!(
            sign_statement(invalid, &signer),
            Err(WitnessError::InvalidStatement)
        );
    }

    #[test]
    fn strict_receipt_transport_round_trips_and_rejects_pretty_json() {
        let signer = WitnessSigningKey::generate().unwrap();
        let receipt =
            sign_statement(statement("lab-a", AttestationClass::BytesObserved), &signer).unwrap();
        let encoded = encode_witness_receipt(&receipt).unwrap();
        assert_eq!(
            decode_witness_receipt(&encoded, 150).unwrap().statement_id,
            receipt.statement_id
        );
        let pretty = serde_json::to_vec_pretty(&receipt).unwrap();
        assert_eq!(
            decode_witness_receipt(&pretty, 150),
            Err(WitnessError::NonCanonicalTransport)
        );
    }
}
