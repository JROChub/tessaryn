use eform::{
    decode_hex, verify_world_cell_assurance, world_cell_envelope_digest, EformEngine, KeySource,
    WorldCellArtifactKind, WorldCellEvidence,
};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_FILE: AtomicU64 = AtomicU64::new(0);

fn seed_file() -> PathBuf {
    let sequence = NEXT_FILE.fetch_add(1, Ordering::Relaxed);
    let path = std::env::temp_dir().join(format!(
        "eform-world-cell-seed-{}-{sequence}.bin",
        std::process::id()
    ));
    let seed =
        decode_hex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60").unwrap();
    fs::write(&path, seed).unwrap();
    path
}

fn digest(value: u8) -> [u8; 32] {
    [value; 32]
}

fn world_cell(metric_scale: bool) -> WorldCellEvidence {
    WorldCellEvidence {
        artifact_kind: WorldCellArtifactKind::WorldCell,
        canonical_digest: digest(1),
        reconstruction_receipt: digest(2),
        runtime_commitment: digest(3),
        parent_commitment: digest(6),
        sequence: 9,
        metric_scale,
    }
}

#[test]
fn signs_and_verifies_relative_and_metric_world_cells() {
    let path = seed_file();
    let engine = EformEngine::load(KeySource::File(path.clone())).unwrap();

    for metric_scale in [false, true] {
        let assurance = engine
            .sign_world_cell_evidence(world_cell(metric_scale))
            .unwrap();
        verify_world_cell_assurance(&assurance).unwrap();
        let record = assurance.canonical_record();
        assert!(record.contains("profile=eform/world-cell-assurance/v1"));
        assert!(record.contains("artifact_kind=world-cell"));
        assert!(record.contains(if metric_scale {
            "scale=metric"
        } else {
            "scale=relative"
        }));
    }

    let _ = fs::remove_file(path);
}

#[test]
fn envelope_is_deterministic_and_domain_separated_by_kind() {
    let evidence = world_cell(false);
    let first = world_cell_envelope_digest(&evidence).unwrap();
    let second = world_cell_envelope_digest(&evidence).unwrap();
    assert_eq!(first, second);

    let mut transfer = evidence;
    transfer.artifact_kind = WorldCellArtifactKind::Transfer;
    assert_ne!(first, world_cell_envelope_digest(&transfer).unwrap());
}

#[test]
fn rejects_mutation_of_every_shared_authority_field() {
    let path = seed_file();
    let engine = EformEngine::load(KeySource::File(path.clone())).unwrap();
    let assurance = engine.sign_world_cell_evidence(world_cell(false)).unwrap();

    let mut canonical = assurance.clone();
    canonical.evidence.canonical_digest[0] ^= 1;
    assert!(verify_world_cell_assurance(&canonical).is_err());

    let mut reconstruction = assurance.clone();
    reconstruction.evidence.reconstruction_receipt[0] ^= 1;
    assert!(verify_world_cell_assurance(&reconstruction).is_err());

    let mut runtime = assurance.clone();
    runtime.evidence.runtime_commitment[0] ^= 1;
    assert!(verify_world_cell_assurance(&runtime).is_err());

    let mut parent = assurance.clone();
    parent.evidence.parent_commitment[0] ^= 1;
    assert!(verify_world_cell_assurance(&parent).is_err());

    let mut sequence = assurance.clone();
    sequence.evidence.sequence += 1;
    assert!(verify_world_cell_assurance(&sequence).is_err());

    let mut scale = assurance.clone();
    scale.evidence.metric_scale = !scale.evidence.metric_scale;
    assert!(verify_world_cell_assurance(&scale).is_err());

    let mut kind = assurance.clone();
    kind.evidence.artifact_kind = WorldCellArtifactKind::Transfer;
    assert!(verify_world_cell_assurance(&kind).is_err());

    let mut signature = assurance.clone();
    let replacement = if signature.signature.signature_base64.starts_with('A') {
        "B"
    } else {
        "A"
    };
    signature
        .signature
        .signature_base64
        .replace_range(0..1, replacement);
    assert!(verify_world_cell_assurance(&signature).is_err());

    let _ = fs::remove_file(path);
}

#[test]
fn enforces_digest_sequence_and_lineage_policy() {
    let mut evidence = world_cell(false);
    evidence.canonical_digest = [0; 32];
    assert!(world_cell_envelope_digest(&evidence).is_err());

    let mut evidence = world_cell(false);
    evidence.reconstruction_receipt = [0; 32];
    assert!(world_cell_envelope_digest(&evidence).is_err());

    let mut evidence = world_cell(false);
    evidence.runtime_commitment = [0; 32];
    assert!(world_cell_envelope_digest(&evidence).is_err());

    let mut evidence = world_cell(false);
    evidence.sequence = 0;
    assert!(world_cell_envelope_digest(&evidence).is_err());

    let mut evidence = world_cell(false);
    evidence.parent_commitment = [0; 32];
    assert!(world_cell_envelope_digest(&evidence).is_err());

    let genesis_moment = WorldCellEvidence {
        artifact_kind: WorldCellArtifactKind::Moment,
        canonical_digest: digest(11),
        reconstruction_receipt: digest(12),
        runtime_commitment: digest(13),
        parent_commitment: [0; 32],
        sequence: 1,
        metric_scale: false,
    };
    world_cell_envelope_digest(&genesis_moment).unwrap();
}
