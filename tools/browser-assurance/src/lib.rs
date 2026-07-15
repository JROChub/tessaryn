use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use power_house::provenance::{PhaArtifact, Rootprint, RootprintId};
use power_house::{
    transcript_digest, ChallengeSuite, MemoryCapsule, MemoryCapsuleBuilder,
    MemoryVerificationPolicy,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::slice;
use std::sync::Mutex;

const PROFILE: &str = "eform/world-cell-assurance/v1";
const SEAL_SCHEMA: &str = "tessaryn/browser-world-cell-seal/v1";
const PROTOCOL: &str = "tessaryn/world-cell-assurance/v1";
const PROVIDER: &str = "tessaryn-browser-assurance::ed25519-dalek/2.2.0";
const POWER_HOUSE_VERSION: &str = "0.3.24";
const ENVELOPE_FINAL: u64 = 0x5743_454e_5631_0001;
const SHA256_PREFIX: &str = "sha256:";

static RESULT: Mutex<Vec<u8>> = Mutex::new(Vec::new());
static ERROR: Mutex<Vec<u8>> = Mutex::new(Vec::new());

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Evidence {
    profile: String,
    artifact_kind: String,
    canonical_digest: String,
    reconstruction_receipt: String,
    runtime_commitment: String,
    parent_commitment: String,
    sequence: u64,
    metric_scale: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProofBundle {
    pha: PhaArtifact,
    rootprint: Rootprint,
    memory_capsule: MemoryCapsule,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Seal {
    schema: String,
    assurance_record: String,
    rootprint: String,
    pha_fingerprint: String,
    memory_capsule_digest: String,
    replay_fingerprint: String,
    public_key_base64: String,
    signature_base64: String,
    provider: String,
    power_house_version: String,
    proof_bundle: ProofBundle,
    verified: bool,
}

fn sha256_hex(bytes: &[u8]) -> String {
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

fn envelope_digest(evidence: &Evidence) -> Result<[u8; 32], String> {
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
    let mut transcript = Vec::with_capacity(24);
    append_profile_words(&mut transcript);
    transcript.push(1);
    transcript.push(artifact_code(&evidence.artifact_kind)?);
    transcript.push(evidence.sequence);
    transcript.push(if evidence.metric_scale { 1 } else { 0 });
    append_digest_words(&mut transcript, &canonical);
    append_digest_words(&mut transcript, &reconstruction);
    append_digest_words(&mut transcript, &runtime);
    append_digest_words(&mut transcript, &parent);
    Ok(transcript_digest(&transcript, &[], ENVELOPE_FINAL))
}

fn assurance_record(
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

fn build_proof_bundle(
    canonical_cell: &[u8],
    evidence: &Evidence,
    envelope_hex: &str,
    public_key: &str,
    signature: &str,
) -> Result<(ProofBundle, String, String, String, String), String> {
    let artifact = PhaArtifact::new(
        json!({
            "producer": "tessaryn-browser-assurance",
            "profile": PROFILE,
            "provider": PROVIDER,
            "power_house_version": POWER_HOUSE_VERSION,
        }),
        PROTOCOL,
        json!({
            "artifact_kind": evidence.artifact_kind,
            "canonical_digest": evidence.canonical_digest,
            "reconstruction_receipt": evidence.reconstruction_receipt,
            "runtime_commitment": evidence.runtime_commitment,
            "parent_commitment": evidence.parent_commitment,
            "sequence": evidence.sequence,
            "metric_scale": evidence.metric_scale,
            "envelope_digest": envelope_hex,
            "public_key": public_key,
        }),
        json!({
            "signature": signature,
            "canonical_bytes": canonical_cell.len() as u64,
            "identity_verified": true,
            "physical_truth_claimed": false,
        }),
    )
    .map_err(|error| error.to_string())?;
    artifact.verify().map_err(|error| error.to_string())?;

    let mut rootprint =
        Rootprint::new("world-cell", artifact).map_err(|error| error.to_string())?;
    let root_id =
        RootprintId::new(rootprint.root_branch.clone()).map_err(|error| error.to_string())?;
    let branch = rootprint
        .branches
        .get_mut(root_id.as_str())
        .ok_or_else(|| "Power House root branch is missing".to_string())?;
    branch.artifact.identity_root = Some(root_id);
    rootprint.verify().map_err(|error| error.to_string())?;
    let replay = rootprint.replay().map_err(|error| error.to_string())?;
    let pha = rootprint
        .branches
        .get(&rootprint.root_branch)
        .ok_or_else(|| "Power House root branch is missing".to_string())?
        .artifact
        .clone();

    let mut memory_capsule =
        MemoryCapsuleBuilder::new(format!("world_cell_{}", &evidence.canonical_digest¶»§q«^