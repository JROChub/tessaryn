use power_house::provenance::{PhaArtifact, Rootprint};
use power_house::{transcript_digest, MemoryCapsule};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub(crate) const PROFILE: &str = "eform/world-cell-assurance/v1";
pub(crate) const SEAL_SCHEMA: &str = "tessaryn/browser-world-cell-seal/v1";
pub(crate) const PROTOCOL: &str = "tessaryn/world-cell-assurance/v1";
pub(crate) const PROVIDER: &str = "tessaryn-browser-assurance::ed25519-dalek/2.2.0";
pub(crate) const POWER_HOUSE_VERSION: &str = "0.3.24";
const ENVELOPE_FINAL: u64 = 0x5743_454e_5631_0001;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Evidence {
    pub(crate) profile: String,
    pub(crate) artifact_kind: String,
    pub(crate) canonical_digest: String,
    pub(crate) reconstruction_receipt: String,
    pub(crate) runtime_commitment: String,
    pub(crate) parent_commitment: String,
    pub(crate) sequence: u64,
    pub(crate) metric_scale: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProofBundle {
    pub(crate) pha: PhaArtifact,
    pub(crate) rootprint: Rootprint,
    pub(crate) memory_capsule: MemoryCapsule,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Seal {
    pub(crate) schema: String,
    pub(crate) assurance_record: String,
    pub(crate) rootprint: String,
    pub(crate) pha_fingerprint: String,
    pub(crate) memory_capsule_digest: String,
    pub(crate) replay_fingerprint: String,
    pub(crate) public_key_base64: String,
    pub(crate) signature_base64: String,
    pub(crate) provider: String,
    pub(crate) power_house_version: String,
    pub(crate) proof_bundle: ProofBundle,
    pub(crate) verified: bool,
}

pub(crate) fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn parse_digest(name: &str, value: &str, allow_zero: bool) -> Result<[u8; 32], String> {
    let decoded = hex::decode(value).map_err(|_| format!("{name} is not hexadecimal"))?;
    let digest: [u8; 32] = decoded
        .try_into()
        .map_err(|_| format!("{name} must contain exactly 32 bytes"))?;
    if !allow_zero && digest.iter().all(|byte| *byte == 0) {
        return Err(format!("{name} must not be zero"));
    }
    Ok(digest)
}

fn artifact_code(kind: &str) -> Result<u64, String> {
    match kind {
        "reconstruction-receipt" => Ok(1),
        "moment" => Ok(2),
        "transfer" => Ok(3),
        "world-cell" => Ok(4),
        _ => Err("unsupported eform World Cell artifact kind".to_string()),
    }
}

fn append_profile_words(output: &mut Vec<u64>) {
    let bytes = PROFILE.as_bytes();
    output.push(bytes.len() as u64);
    for chunk in bytes.chunks(8) {
        let mut word = [0u8; 8];
        word[..chunk.len()].copy_from_slice(chunk);
        output.push(u64::from_be_bytes(word));
    }
}

fn append_digest_words(output: &mut Vec<u64>, digest: &[u8; 32]) {
    for chunk in digest.chunks_exact(8) {
        let mut word = [0u8; 8];
        word.copy_from_slice(chunk);
        output.push(u64::from_be_bytes(word));
    }
}

pub(crate) fn envelope_digest(evidence: &Evidence) -> Result<[u8; 32], String> {
    if evidence.profile != PROFILE {
        return Err("World Cell assurance profile mismatch".to_string());
    }
    if evidence.sequence == 0 {
        return Err("World Cell evidence sequence must be nonzero".to_string());
    }
    let canonical = parse_digest("canonical digest", &evidence.canonical_digest, false)?;
    let reconstruction = parse_digest(
        "reconstruction receipt",
        &evidence.reconstruction_receipt,
        false,
    )?;
    let runtime = parse_digest("runtime commitment", &evidence.runtime_commitment, false)?;
    let parent = parse_digest("parent commitment", &evidence.parent_commitment, true)?;
    if evidence.sequence > 1 && parent.iter().all(|byte| *byte == 0) {
        return Err("non-genesis evidence requires a parent commitment".to_string());
    }

    let mut transcript = Vec::with_capacity(25);
    append_profile_words(&mut transcript);
    transcript.push(1);
    transcript.push(artifact_code(&evidence.artifact_kind)?);
    transcript.push(evidence.sequence);
    transcript.push(u64::from(evidence.metric_scale));
    append_digest_words(&mut transcript, &canonical);
    append_digest_words(&mut transcript, &reconstruction);
    append_digest_words(&mut transcript, &runtime);
    append_digest_words(&mut transcript, &parent);
    Ok(transcript_digest(&transcript, &[], ENVELOPE_FINAL))
}

pub(crate) fn assurance_record(
    evidence: &Evidence,
    envelope_hex: &str,
    public_key: &str,
    signature: &str,
) -> String {
    format!(
        "profile={PROFILE}\nartifact_kind={}\ncanonical_digest={}\nreconstruction_receipt={}\nruntime_commitment={}\nparent_commitment={}\nsequence={}\nscale={}\nenvelope_digest={envelope_hex}\ndomain=eform/ed25519/hash256/v1\ndigest={envelope_hex}\npublic_key={public_key}\nsignature={signature}\nprovider={PROVIDER}\npower_house_revision={POWER_HOUSE_VERSION}\n",
        evidence.artifact_kind,
        evidence.canonical_digest,
        evidence.reconstruction_receipt,
        evidence.runtime_commitment,
        evidence.parent_commitment,
        evidence.sequence,
        if evidence.metric_scale { "metric" } else { "relative" },
    )
}
