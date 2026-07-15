use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use power_house::provenance::{PhaArtifact, Rootprint, RootprintId};
use power_house::{ChallengeSuite, MemoryCapsuleBuilder, MemoryVerificationPolicy};
use serde_json::json;

use crate::model::{
    assurance_record, envelope_digest, sha256_hex, Evidence, ProofBundle, Seal,
    POWER_HOUSE_VERSION, PROFILE, PROTOCOL, PROVIDER, SEAL_SCHEMA,
};

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

pub(crate) fn create_seal(
    canonical_cell: &[u8],
    evidence_json: &[u8],
    seed: &[u8],
) -> Result<Seal, String> {
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

pub(crate) fn verify_seal(
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
    let envelope_hex = hex::encode(envelope);
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
    let root_branch = seal
        .proof_bundle
        .rootprint
        .branches
        .get(&seal.proof_bundle.rootprint.root_branch)
        .ok_or_else(|| "Power House root branch is missing".to_string())?;
    if root_branch.artifact.phx_fingerprint != seal.proof_bundle.pha.phx_fingerprint {
        return Err("Power House PHA and Rootprint artifact identities differ".to_string());
    }

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
        || inputs["envelope_digest"].as_str() != Some(envelope_hex.as_str())
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
            .contains(&format!("digest={envelope_hex}\n"))
        || !seal
            .assurance_record
            .contains(&format!("signature={}\n", seal.signature_base64))
    {
        return Err("eform-profile assurance record mismatch".to_string());
    }
    Ok(())
}
