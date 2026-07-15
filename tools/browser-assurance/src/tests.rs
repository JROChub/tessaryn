use crate::model::{envelope_digest, sha256_hex, Evidence, PROFILE};
use crate::proof::{create_seal, verify_seal};

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
fn seals_and_rejects_cell_mutation() {
    let cell = br#"{"schema":"tessaryn/world-cell/v22","version":22}"#;
    let evidence = evidence(cell);
    let evidence_json = serde_json::to_vec(&evidence).expect("serialize evidence");
    let seal = create_seal(cell, &evidence_json, &[7_u8; 32]).expect("create seal");
    let seal_json = serde_json::to_vec(&seal).expect("serialize seal");
    verify_seal(cell, &evidence_json, &seal_json).expect("verify seal");

    let mut mutated = cell.to_vec();
    mutated[2] ^= 1;
    assert!(verify_seal(&mutated, &evidence_json, &seal_json).is_err());
    assert!(seal.assurance_record.contains(PROFILE));
    assert!(seal.rootprint.starts_with("sha256:"));
    assert!(seal.pha_fingerprint.starts_with("sha256:"));
}

#[test]
fn envelope_binds_scale_lineage_and_receipt() {
    let cell = b"world-cell";
    let original = evidence(cell);
    let first = envelope_digest(&original).expect("initial envelope");

    let mut changed = original.clone();
    changed.metric_scale = true;
    assert_ne!(first, envelope_digest(&changed).expect("metric envelope"));

    changed = original.clone();
    changed.parent_commitment = "44".repeat(32);
    assert_ne!(first, envelope_digest(&changed).expect("lineage envelope"));

    changed = original;
    changed.reconstruction_receipt = "55".repeat(32);
    assert_ne!(first, envelope_digest(&changed).expect("receipt envelope"));
}

#[test]
fn rejects_invalid_seed_and_non_world_cell_artifact() {
    let cell = b"world-cell";
    let mut evidence = evidence(cell);
    let evidence_json = serde_json::to_vec(&evidence).expect("serialize evidence");
    assert!(create_seal(cell, &evidence_json, &[7_u8; 31]).is_err());

    evidence.artifact_kind = "moment".to_string();
    let evidence_json = serde_json::to_vec(&evidence).expect("serialize evidence");
    assert!(create_seal(cell, &evidence_json, &[7_u8; 32]).is_err());
}
