use eform::{encode_hex, world_cell_envelope_digest, WorldCellArtifactKind, WorldCellEvidence};

#[test]
fn power_house_world_cell_transcript_vector_is_stable() {
    let evidence = WorldCellEvidence {
        artifact_kind: WorldCellArtifactKind::WorldCell,
        canonical_digest: [1; 32],
        reconstruction_receipt: [2; 32],
        runtime_commitment: [3; 32],
        parent_commitment: [6; 32],
        sequence: 9,
        metric_scale: true,
    };
    assert_eq!(
        encode_hex(&world_cell_envelope_digest(&evidence).unwrap()),
        "14989520d9db85aba031d8120d062ecc3d9a724e18b96472184ef68e1868c60d"
    );
}
