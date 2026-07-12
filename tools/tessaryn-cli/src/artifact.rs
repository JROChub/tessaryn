//! Portable real-capture reconstruction artifacts shared by the CLI and Weave nodes.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tessaryn_canonical::parse_strict_json_bounded;
use tessaryn_forge::CapturePolicy;
use tessaryn_powerhouse::{
    prove_cell, prove_lineage, verify_bundle, verify_lineage_bundle, CellLineageStep,
    CellProofBundle, CellProofReport, WorldLineageBundle, WorldLineageReport,
};
use tessaryn_reconstruct::{
    reconstruct_rgbd_session, verify_reconstruction_report, ReconstructionPolicy,
    ReconstructionReport, ReconstructionVerificationReport, RgbdSessionV0,
};
use tessaryn_schema::Digest;
use thiserror::Error;

/// Strict schema emitted for a bounded RGB-D reconstruction.
pub const RECONSTRUCTION_ARTIFACT_SCHEMA_V0: &str = "tessaryn/reconstruction-artifact/v0";

const MAX_RECONSTRUCTION_ARTIFACT_BYTES: usize = 256 * 1024 * 1024;

/// A complete locally reverifiable RGB-D reconstruction and its Power House lineage.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReconstructionArtifactV0 {
    pub schema: String,
    pub reconstruction_policy: ReconstructionPolicy,
    pub report: ReconstructionReport,
    pub verification: ReconstructionVerificationReport,
    pub observation_proof: CellProofBundle,
    pub observation_proof_report: CellProofReport,
    pub sdf_proof: CellProofBundle,
    pub sdf_proof_report: CellProofReport,
    pub lineage: WorldLineageBundle,
    pub lineage_report: WorldLineageReport,
}

/// Failure to construct or verify a portable reconstruction artifact.
#[derive(Debug, Error)]
#[error("{0}")]
pub struct ArtifactError(String);

/// Reconstructs one privacy-filtered session and binds both observation and SDF Cells.
pub fn build_reconstruction_artifact(
    session: RgbdSessionV0,
    capture_policy: CapturePolicy,
    reconstruction_policy: ReconstructionPolicy,
) -> Result<ReconstructionArtifactV0, ArtifactError> {
    let report = reconstruct_rgbd_session(session, capture_policy, reconstruction_policy.clone())
        .map_err(failure)?;
    let verification =
        verify_reconstruction_report(&report, &reconstruction_policy).map_err(failure)?;
    let observation_proof = prove_cell(
        report.observation.manifest.clone(),
        Some(serde_json::json!({
            "claim_state": "SOURCE_OBSERVATION_COMMITTED",
            "schema": "slbit/viz-packet/v3",
            "summary": "Privacy-filtered RGB-D observation Cell with locally verifiable identity.",
        })),
    )
    .map_err(failure)?;
    let observation_proof_report = verify_bundle(&observation_proof).map_err(failure)?;
    let sdf_proof = prove_cell(
        report.sdf_manifest.clone(),
        Some(serde_json::json!({
            "claim_state": "DERIVED_FROM_VERIFIED_BYTES",
            "schema": "slbit/viz-packet/v3",
            "summary": "Sparse SDF derived from the privacy-filtered observation Cell.",
        })),
    )
    .map_err(failure)?;
    let sdf_proof_report = verify_bundle(&sdf_proof).map_err(failure)?;
    let lineage = prove_lineage(vec![
        CellLineageStep {
            label: "observation".to_string(),
            parent_labels: Vec::new(),
            manifest: report.observation.manifest.clone(),
        },
        CellLineageStep {
            label: "sdf-derived".to_string(),
            parent_labels: vec!["observation".to_string()],
            manifest: report.sdf_manifest.clone(),
        },
    ])
    .map_err(failure)?;
    let lineage_report = verify_lineage_bundle(&lineage).map_err(failure)?;
    let artifact = ReconstructionArtifactV0 {
        schema: RECONSTRUCTION_ARTIFACT_SCHEMA_V0.to_string(),
        reconstruction_policy,
        report,
        verification,
        observation_proof,
        observation_proof_report,
        sdf_proof,
        sdf_proof_report,
        lineage,
        lineage_report,
    };
    verify_reconstruction_artifact(&artifact)?;
    Ok(artifact)
}

/// Reads and strictly verifies one reconstruction artifact without trusting stored reports.
pub fn read_reconstruction_artifact(
    path: &Path,
) -> Result<ReconstructionArtifactV0, ArtifactError> {
    let bytes = fs::read(path).map_err(failure)?;
    if bytes.len() > MAX_RECONSTRUCTION_ARTIFACT_BYTES {
        return Err(ArtifactError(
            "reconstruction artifact exceeds the bounded JSON profile".to_string(),
        ));
    }
    let value =
        parse_strict_json_bounded(&bytes, MAX_RECONSTRUCTION_ARTIFACT_BYTES).map_err(failure)?;
    let artifact = serde_json::from_value::<ReconstructionArtifactV0>(value).map_err(failure)?;
    verify_reconstruction_artifact(&artifact)?;
    Ok(artifact)
}

/// Recalculates reconstruction, Cell, PHA, Rootprint, replay, Capsule, and lineage bindings.
pub fn verify_reconstruction_artifact(
    artifact: &ReconstructionArtifactV0,
) -> Result<ReconstructionVerificationReport, ArtifactError> {
    if artifact.schema != RECONSTRUCTION_ARTIFACT_SCHEMA_V0 {
        return Err(ArtifactError(
            "unsupported reconstruction artifact schema".to_string(),
        ));
    }
    let report = verify_reconstruction_report(&artifact.report, &artifact.reconstruction_policy)
        .map_err(failure)?;
    if report != artifact.verification {
        return Err(ArtifactError(
            "stored reconstruction verification report mismatch".to_string(),
        ));
    }
    if artifact.observation_proof.cell_id != artifact.report.observation.cell_id
        || artifact.sdf_proof.cell_id != artifact.report.sdf_cell_id
    {
        return Err(ArtifactError(
            "Power House proof bundle does not bind reconstruction Cells".to_string(),
        ));
    }
    if verify_bundle(&artifact.observation_proof).map_err(failure)?
        != artifact.observation_proof_report
        || verify_bundle(&artifact.sdf_proof).map_err(failure)? != artifact.sdf_proof_report
        || verify_lineage_bundle(&artifact.lineage).map_err(failure)? != artifact.lineage_report
    {
        return Err(ArtifactError(
            "stored Power House verification report mismatch".to_string(),
        ));
    }
    verify_lineage_cell_binding(
        &artifact.lineage,
        "observation",
        &artifact.report.observation.cell_id,
    )?;
    verify_lineage_cell_binding(
        &artifact.lineage,
        "sdf-derived",
        &artifact.report.sdf_cell_id,
    )?;
    for proof in [&artifact.observation_proof, &artifact.sdf_proof] {
        let challenge = proof
            .memory_capsule
            .challenge_all(power_house::MemoryVerificationPolicy::strict())
            .map_err(failure)?;
        if challenge.mismatches != 0 || challenge.expected_rejections != challenge.total {
            return Err(ArtifactError(
                "Power House Memory Capsule challenge mismatch".to_string(),
            ));
        }
    }
    Ok(report)
}

fn verify_lineage_cell_binding(
    lineage: &WorldLineageBundle,
    label: &str,
    expected_cell_id: &Digest,
) -> Result<(), ArtifactError> {
    let branch_id = lineage
        .branches
        .get(label)
        .ok_or_else(|| ArtifactError(format!("lineage is missing {label}")))?;
    let branch = lineage
        .rootprint
        .branches
        .get(branch_id)
        .ok_or_else(|| ArtifactError(format!("lineage branch {label} is missing")))?;
    let found = branch.artifact.embedded_proof.public_inputs["cell_manifest_digest"]
        .as_str()
        .ok_or_else(|| ArtifactError("lineage artifact omits Cell identity".to_string()))?;
    if found != expected_cell_id.as_str() {
        return Err(ArtifactError(format!(
            "lineage branch {label} does not bind the expected Cell"
        )));
    }
    Ok(())
}

fn failure(error: impl std::fmt::Display) -> ArtifactError {
    ArtifactError(error.to_string())
}
