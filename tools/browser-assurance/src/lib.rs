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
        MemoryCapsuleBuilder::new(format!("world_cell_{}", &evidence.canonical_digest[..16]))
            .producer("tessaryn-browser-assurance", POWER_HOUSE_VERSION)
            .with_pha(pha.clone())
            .with_rootprint(rootprint.clone())
            .with_replay_required()
            .with_challenge_suite(ChallengeSuite::standard())
            .build()
            .map_err(|error| error.to_string())?;
    memory_capsule.header.producer.platform = None;
    memory_capsule.header.capsule_digest = None;
    let capsule_digest = memory_capsule
        .calculate_capsule_digest()
        .map_err(|error| error.to_string())?;
    memory_capsule.header.capsule_digest = Some(capsule_digest.clone());

    let report = memory_capsule
        .verify(MemoryVerificationPolicy::strict())
        .map_err(|error| error.to_string())?;
    if !report.core_valid || !report.rootprint_valid || !report.replay_valid {
        return Err("Power House Memory Capsule verification failed".to_string());
    }

    let rootprint_id = rootprint.root_branch.clone();
    let pha_fingerprint = pha.phx_fingerprint.clone();
    let replay_fingerprint = replay.state_fingerprint;
    Ok((
        ProofBundle {
            pha,
            rootprint,
            memory_capsule,
        },
        rootprint_id,
        pha_fingerprint,
        capsule_digest,
        replay_fingerprint,
    ))
}

fn create_seal(canonical_cell: &[u8], evidence_json: &[u8], seed: &[u8]) -> Result<Seal, String> {
    let evidence: Evidence = serde_json::from_slice(evidence_json)
        .map_err(|error| format!("invalid assurance evidence: {error}"))?;
    if evidence.artifact_kind != "world-cell" {
        return Err("browser sealing requires a complete World Cell artifact".to_string());
    }
    if sha256_hex(canonical_cell) != evidence.canonical_digest {
        return Err("canonical World Cell digest mismatch".to_string());
    }
    let seed: [u8; 32] = seed
        .try_into()
        .map_err(|_| "browser assurance seed must contain exactly 32 bytes".to_string())?;
    let signing = SigningKey::from_bytes(&seed);
    let verifying = signing.verifying_key();
    let envelope = envelope_digest(&evidence)?;
    let envelope_hex = hex::encode(envelope);
    let signature = signing.sign(&envelope);
    verifying
        .verify_strict(&envelope, &signature)
        .map_err(|error| format!("local Ed25519 self-verification failed: {error}"))?;
    let public_key_base64 = BASE64.encode(verifying.to_bytes());
    let signature_base64 = BASE64.encode(signature.to_bytes());
    let record = assurance_record(
        &evidence,
        &envelope_hex,
        &public_key_base64,
        &signature_base64,
    );
    let (proof_bundle, rootprint, pha_fingerprint, memory_capsule_digest, replay_fingerprint) =
        build_proof_bundle(
            canonical_cell,
            &evidence,
            &envelope_hex,
            &public_key_base64,
            &signature_base64,
        )?;
    let seal = Seal {
        schema: SEAL_SCHEMA.to_string(),
        assurance_record: record,
        rootprint,
        pha_fingerprint,
        memory_capsule_digest,
        replay_fingerprint,
        public_key_base64,
        signature_base64,
        provider: PROVIDER.to_string(),
        power_house_version: POWER_HOUSE_VERSION.to_string(),
        proof_bundle,
        verified: true,
    };
    verify_seal(
        canonical_cell,
        evidence_json,
        &serde_json::to_vec(&seal).map_err(|error| error.to_string())?,
    )?;
    Ok(seal)
}

fn verify_seal(
    canonical_cell: &[u8],
    evidence_json: &[u8],
    seal_json: &[u8],
) -> Result<(), String> {
    let evidence: Evidence = serde_json::from_slice(evidence_json)
        .map_err(|error| format!("invalid assurance evidence: {error}"))?;
    let seal: Seal = serde_json::from_slice(seal_json)
        .map_err(|error| format!("invalid browser seal: {error}"))?;
    if seal.schema != SEAL_SCHEMA
        || !seal.verified
        || seal.provider != PROVIDER
        || seal.power_house_version != POWER_HOUSE_VERSION
    {
        return Err("browser assurance seal identity mismatch".to_string());
    }
    if sha256_hex(canonical_cell) != evidence.canonical_digest {
        return Err("canonical World Cell digest mismatch".to_string());
    }
    let envelope = envelope_digest(&evidence)?;
    let public_bytes = BASE64
        .decode(&seal.public_key_base64)
        .map_err(|error| format!("invalid assurance public key: {error}"))?;
    let public_bytes: [u8; 32] = public_bytes
        .try_into()
        .map_err(|_| "assurance public key must contain 32 bytes".to_string())?;
    let signature_bytes = BASE64
        .decode(&seal.signature_base64)
        .map_err(|error| format!("invalid assurance signature: {error}"))?;
    let signature_bytes: [u8; 64] = signature_bytes
        .try_into()
        .map_err(|_| "assurance signature must contain 64 bytes".to_string())?;
    let verifying = VerifyingKey::from_bytes(&public_bytes)
        .map_err(|error| format!("invalid assurance public key: {error}"))?;
    let signature = Signature::from_bytes(&signature_bytes);
    verifying
        .verify_strict(&envelope, &signature)
        .map_err(|error| format!("eform-profile signature verification failed: {error}"))?;

    seal.proof_bundle
        .pha
        .verify()
        .map_err(|error| error.to_string())?;
    seal.proof_bundle
        .rootprint
        .verify()
        .map_err(|error| error.to_string())?;
    let replay = seal
        .proof_bundle
        .rootprint
        .replay()
        .map_err(|error| error.to_string())?;
    let memory_report = seal
        .proof_bundle
        .memory_capsule
        .verify(MemoryVerificationPolicy::strict())
        .map_err(|error| error.to_string())?;
    if !memory_report.core_valid || !memory_report.rootprint_valid || !memory_report.replay_valid {
        return Err("Power House Memory Capsule verification failed".to_string());
    }
    let capsule_digest = seal
        .proof_bundle
        .memory_capsule
        .calculate_capsule_digest()
        .map_err(|error| error.to_string())?;
    if seal.rootprint != seal.proof_bundle.rootprint.root_branch
        || seal.pha_fingerprint != seal.proof_bundle.pha.phx_fingerprint
        || seal.memory_capsule_digest != capsule_digest
        || seal.replay_fingerprint != replay.state_fingerprint
    {
        return Err("Power House proof identity mismatch".to_string());
    }
    let inputs = &seal.proof_bundle.pha.embedded_proof.public_inputs;
    if inputs["canonical_digest"].as_str() != Some(evidence.canonical_digest.as_str())
        || inputs["reconstruction_receipt"].as_str()
            != Some(evidence.reconstruction_receipt.as_str())
        || inputs["runtime_commitment"].as_str() != Some(evidence.runtime_commitment.as_str())
        || inputs["parent_commitment"].as_str() != Some(evidence.parent_commitment.as_str())
        || inputs["sequence"].as_u64() != Some(evidence.sequence)
        || inputs["metric_scale"].as_bool() != Some(evidence.metric_scale)
        || inputs["envelope_digest"].as_str() != Some(hex::encode(envelope).as_str())
        || inputs["public_key"].as_str() != Some(seal.public_key_base64.as_str())
    {
        return Err(
            "Power House PHA public inputs do not bind the World Cell evidence".to_string(),
        );
    }
    if !seal
        .assurance_record
        .contains(&format!("profile={PROFILE}\n"))
        || !seal
            .assurance_record
            .contains(&format!("digest={}\n", hex::encode(envelope)))
        || !seal
            .assurance_record
            .contains(&format!("signature={}\n", seal.signature_base64))
    {
        return Err("eform-profile assurance record mismatch".to_string());
    }
    Ok(())
}

fn set_result(value: Result<Vec<u8>, String>) -> i32 {
    match value {
        Ok(bytes) => {
            *RESULT.lock().expect("result mutex poisoned") = bytes;
            ERROR.lock().expect("error mutex poisoned").clear();
            0
        }
        Err(message) => {
            RESULT.lock().expect("result mutex poisoned").clear();
            *ERROR.lock().expect("error mutex poisoned") = message.into_bytes();
            -1
        }
    }
}

unsafe fn input<'a>(pointer: *const u8, length: usize) -> Result<&'a [u8], String> {
    if pointer.is_null() && length != 0 {
        return Err("null browser-assurance input pointer".to_string());
    }
    Ok(slice::from_raw_parts(pointer, length))
}

#[no_mangle]
pub extern "C" fn tessaryn_assurance_alloc(length: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(length);
    let pointer = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    pointer
}

#[no_mangle]
pub unsafe extern "C" fn tessaryn_assurance_dealloc(pointer: *mut u8, capacity: usize) {
    if !pointer.is_null() {
        drop(Vec::from_raw_parts(pointer, 0, capacity));
    }
}

#[no_mangle]
pub unsafe extern "C" fn tessaryn_assurance_seal(
    cell_pointer: *const u8,
    cell_length: usize,
    evidence_pointer: *const u8,
    evidence_length: usize,
    seed_pointer: *const u8,
    seed_length: usize,
) -> i32 {
    set_result((|| {
        let cell = input(cell_pointer, cell_length)?;
        let evidence = input(evidence_pointer, evidence_length)?;
        let seed = input(seed_pointer, seed_length)?;
        let seal = create_seal(cell, evidence, seed)?;
        serde_json::to_vec(&seal).map_err(|error| error.to_string())
    })())
}

#[no_mangle]
pub unsafe extern "C" fn tessaryn_assurance_verify(
    cell_pointer: *const u8,
    cell_length: usize,
    evidence_pointer: *const u8,
    evidence_length: usize,
    seal_pointer: *const u8,
    seal_length: usize,
) -> i32 {
    match (|| {
        verify_seal(
            input(cell_pointer, cell_length)?,
            input(evidence_pointer, evidence_length)?,
            input(seal_pointer, seal_length)?,
        )?;
        Ok::<(), String>(())
    })() {
        Ok(()) => {
            ERROR.lock().expect("error mutex poisoned").clear();
            1
        }
        Err(message) => {
            *ERROR.lock().expect("error mutex poisoned") = message.into_bytes();
            0
        }
    }
}

#[no_mangle]
pub extern "C" fn tessaryn_assurance_result_pointer() -> *const u8 {
    RESULT.lock().expect("result mutex poisoned").as_ptr()
}

#[no_mangle]
pub extern "C" fn tessaryn_assurance_result_length() -> usize {
    RESULT.lock().expect("result mutex poisoned").len()
}

#[no_mangle]
pub extern "C" fn tessaryn_assurance_error_pointer() -> *const u8 {
    ERROR.lock().expect("error mutex poisoned").as_ptr()
}

#[no_mangle]
pub extern "C" fn tessaryn_assurance_error_length() -> usize {
    ERROR.lock().expect("error mutex poisoned").len()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn evidence(cell: &[u8]) -> Evidence {
        Evidence {
            profile: PROFILE.to_string(),
            artifact_kind: "world-cell".to_string(),
            canonical_digest: sha256_hex(cell),
            reconstruction_receipt: "11".repeat(32),
            runtime_commitment: "22".repeat(32),
            parent_commitment: "33".repeat(32),
            sequence: 2,
            metric_scale: false,
        }
    }

    #[test]
    fn seals_and_rejects_mutation() {
        let cell = br#"{"schema":"tessaryn/world-cell/v22","version":22}"#;
        let evidence = evidence(cell);
        let evidence_json = serde_json::to_vec(&evidence).unwrap();
        let seal = create_seal(cell, &evidence_json, &[7u8; 32]).unwrap();
        let seal_json = serde_json::to_vec(&seal).unwrap();
        verify_seal(cell, &evidence_json, &seal_json).unwrap();
        let mut mutated = cell.to_vec();
        mutated[2] ^= 1;
        assert!(verify_seal(&mutated, &evidence_json, &seal_json).is_err());
        assert!(seal.assurance_record.contains(PROFILE));
        assert!(seal.rootprint.starts_with(SHA256_PREFIX));
        assert!(seal.pha_fingerprint.starts_with(SHA256_PREFIX));
    }

    #[test]
    fn envelope_binds_scale_and_lineage() {
        let cell = b"world-cell";
        let original = evidence(cell);
        let first = envelope_digest(&original).unwrap();
        let mut changed = original.clone();
        changed.metric_scale = true;
        assert_ne!(first, envelope_digest(&changed).unwrap());
        changed = original;
        changed.parent_commitment = "44".repeat(32);
        assert_ne!(first, envelope_digest(&changed).unwrap());
    }
}
