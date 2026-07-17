use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use power_house::memory::{
    CapsuleHeader, CoreLayer, CoreVerificationPolicy, LineageLayer, MemoryBranch, ProducerInfo,
    ReplayExpected, ReplayLayer, ReplayPlan, ReplayResourceBounds,
};
use power_house::provenance::{PhaArtifact, Rootprint, RootprintId};
#[cfg(not(target_arch = "wasm32"))]
use power_house::MemoryVerificationPolicy;
use power_house::{ChallengeSuite, MemoryCapsule};
use serde_json::json;

use crate::model::{
    assurance_record, envelope_digest, sha256_hex, Evidence, ProofBundle, Seal,
    POWER_HOUSE_VERSION, PROFILE, PROTOCOL, PROVIDER, SEAL_SCHEMA,
};

fn verify_memory_capsule_portable(capsule: &MemoryCapsule) -> Result<(), String> {
    if capsule.header.schema != power_house::memory::MEMORY_CAPSULE_SCHEMA_V1 {
        return Err("unsupported Power House Memory Capsule schema".to_string());
    }
    if !capsule.header.critical_extensions.is_empty() {
        return Err("unknown critical Power House Memory Capsule extension".to_string());
    }
    let capsule_digest = capsule
        .calculate_capsule_digest()
        .map_err(|error| error.to_string())?;
    if capsule.header.capsule_digest.as_deref() != Some(capsule_digest.as_str()) {
        return Err("Power House Memory Capsule digest mismatch".to_string());
    }
    capsule
        .core
        .pha
        .verify()
        .map_err(|error| error.to_string())?;
    let core_digest = capsule
        .calculate_core_digest()
        .map_err(|error| error.to_string())?;
    if capsule.core.core_digest != core_digest {
        return Err("Power House Memory Capsule core digest mismatch".to_string());
    }
    for proof in &capsule.core.proofs {
        power_house::memory::validate_sha256(&proof.digest).map_err(|error| error.to_string())?;
    }
    capsule
        .lineage
        .rootprint
        .verify()
        .map_err(|error| error.to_string())?;
    if !capsule
        .lineage
        .rootprint
        .branches
        .values()
        .any(|branch| branch.artifact.phx_fingerprint == capsule.core.pha.phx_fingerprint)
    {
        return Err("Power House core artifact is absent from Rootprint lineage".to_string());
    }
    let replay = capsule
        .lineage
        .rootprint
        .replay()
        .map_err(|error| error.to_string())?;
    if replay.state_fingerprint != capsule.replay.replay.expected.replay_fingerprint {
        return Err("Power House Memory Capsule replay fingerprint mismatch".to_string());
    }
    if capsule.semantics.is_some() || !capsule.witnesses.is_empty() {
        return Err("browser assurance refuses unchecked semantic or witness layers".to_string());
    }

    // The upstream strict verifier currently reads std::time::Instant, which
    // aborts on wasm32-unknown-unknown before checking any proof. Native builds
    // retain it as an independent cross-check; browser builds execute every
    // deterministic proof invariant above without requiring a wall clock.
    #[cfg(not(target_arch = "wasm32"))]
    {
        let report = capsule
            .verify(MemoryVerificationPolicy::strict())
            .map_err(|error| error.to_string())?;
        if !report.core_valid || !report.rootprint_valid || !report.replay_valid {
            return Err("Power House Memory Capsule strict verification failed".to_string());
        }
    }
    Ok(())
}

fn build_memory_capsule_portable(
    capsule_id: &str,
    pha: PhaArtifact,
    rootprint: Rootprint,
) -> Result<MemoryCapsule, String> {
    pha.verify().map_err(|error| error.to_string())?;
    rootprint.verify().map_err(|error| error.to_string())?;
    let replay_state = rootprint.replay().map_err(|error| error.to_string())?;
    let branches = rootprint
        .branches
        .values()
        .map(|branch| MemoryBranch {
            branch_id: branch.id.clone(),
            label: branch.label.clone(),
            parent_ids: branch.parents.clone(),
            artifact_digest: branch.artifact.phx_fingerprint.clone(),
            state_fingerprint: replay_state.state_fingerprint.clone(),
            operation: if branch.parents.is_empty() {
                "create".to_string()
            } else if branch.parents.len() == 1 {
                "fork".to_string()
            } else {
                "merge".to_string()
            },
        })
        .collect();
    let mut capsule = MemoryCapsule {
        header: CapsuleHeader {
            schema: power_house::memory::MEMORY_CAPSULE_SCHEMA_V1.to_string(),
            capsule_id: format!("phm_{capsule_id}"),
            capsule_digest: None,
            created_at_unix_ms: 0,
            producer: ProducerInfo {
                name: "tessaryn-browser-assurance".to_string(),
                tool: "julian".to_string(),
                power_house_version: POWER_HOUSE_VERSION.to_string(),
                slbit_version: None,
                rustc: None,
                platform: None,
            },
            critical_extensions: Vec::new(),
            noncritical_extensions: Vec::new(),
        },
        core: CoreLayer {
            pha,
            proofs: Vec::new(),
            core_digest: String::new(),
            core_verification_policy: CoreVerificationPolicy::default(),
        },
        lineage: LineageLayer {
            rootprint,
            branches,
            equivalence: Vec::new(),
        },
        replay: ReplayLayer {
            replay: ReplayPlan {
                engine: "power_house".to_string(),
                version: POWER_HOUSE_VERSION.to_string(),
                commands: vec![
                    "julian memory verify capsule.phm".to_string(),
                    "julian memory replay capsule.phm".to_string(),
                    "julian memory challenge capsule.phm --all".to_string(),
                ],
                expected: ReplayExpected {
                    core_valid: true,
                    rootprint_valid: true,
                    replay_fingerprint: replay_state.state_fingerprint,
                    sidecar_valid: None,
                },
                resource_bounds: ReplayResourceBounds {
                    max_memory_mb: 512,
                    max_disk_mb: 1_024,
                    max_wall_seconds_reference: 600,
                },
                network_required: false,
            },
        },
        semantics: None,
        witnesses: Vec::new(),
        challenge: Some(ChallengeSuite::standard()),
        receipts: Vec::new(),
    };
    capsule.core.core_digest = capsule
        .calculate_core_digest()
        .map_err(|error| error.to_string())?;
    capsule.header.capsule_digest = Some(
        capsule
            .calculate_capsule_digest()
            .map_err(|error| error.to_string())?,
    );
    verify_memory_capsule_portable(&capsule)?;
    Ok(capsule)
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

    let mut memory_capsule = build_memory_capsule_portable(
        &format!("world_cell_{}", &evidence.canonical_digest[..16]),
        pha.clone(),
        rootprint.clone(),
    )?;
    memory_capsule.header.capsule_digest = None;
    let capsule_digest = memory_capsule
        .calculate_capsule_digest()
        .map_err(|error| error.to_string())?;
    memory_capsule.header.capsule_digest = Some(capsule_digest.clone());

    verify_memory_capsule_portable(&memory_capsule)?;

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
    verify_memory_capsule_portable(&seal.proof_bundle.memory_capsule)?;
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
