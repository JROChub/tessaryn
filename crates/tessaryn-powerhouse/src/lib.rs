//! Narrow Power House adapter for Cell identity, Rootprint, and Memory Capsules.
//!
//! This crate verifies provenance and deterministic construction. It does not
//! claim that a physical-world observation is true merely because bytes match.

use power_house::provenance::{PhaArtifact, Rootprint, RootprintId};
use power_house::{ChallengeSuite, MemoryCapsule, MemoryCapsuleBuilder, ObservatorySidecar};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use tessaryn_canonical::cell_id;
use tessaryn_schema::{CellManifestV0, Digest};
use thiserror::Error;

/// Power House protocol projection for TESSARYN Cells.
pub const CELL_PROTOCOL_V0: &str = "tessaryn/world-cell/v0";

/// Exact Power House release used by this adapter's portable capsule profile.
pub const POWER_HOUSE_COMPATIBILITY_VERSION: &str = "0.3.24";

/// Portable proof and memory package for one Cell.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CellProofBundle {
    /// Original identity-bearing manifest.
    pub manifest: CellManifestV0,
    /// Canonical Cell identity.
    pub cell_id: Digest,
    /// Power House artifact.
    pub pha: PhaArtifact,
    /// Rootprint lineage.
    pub rootprint: Rootprint,
    /// Rootprint replay identity.
    pub replay_fingerprint: String,
    /// Offline-verifiable Memory Capsule.
    pub memory_capsule: MemoryCapsule,
}

/// Layered verification result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CellProofReport {
    /// Manifest identity matches.
    pub cell_identity_valid: bool,
    /// Power House core artifact is valid.
    pub pha_valid: bool,
    /// Rootprint graph is valid.
    pub rootprint_valid: bool,
    /// Replay fingerprint matches.
    pub replay_valid: bool,
    /// Memory Capsule verifies under the strict local policy.
    pub memory_capsule_valid: bool,
    /// Declares whether the report includes a physical-observation claim.
    pub physical_truth_claimed: bool,
}

/// One ordered world-lineage construction step.
#[derive(Debug, Clone)]
pub struct CellLineageStep {
    /// Unique branch label.
    pub label: String,
    /// Zero parents for the first step, one for a fork, and two for a merge.
    pub parent_labels: Vec<String>,
    /// Cell committed by the branch.
    pub manifest: CellManifestV0,
}

/// Rootprint memory spanning multiple Cells.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldLineageBundle {
    /// Complete Rootprint graph.
    pub rootprint: Rootprint,
    /// Branch IDs keyed by stable labels.
    pub branches: BTreeMap<String, String>,
    /// Deterministic replay identity.
    pub replay_fingerprint: String,
}

/// Independent verification result for a multi-Cell world lineage.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorldLineageReport {
    /// Rootprint graph and every branch relation verified.
    pub rootprint_valid: bool,
    /// Deterministic replay fingerprint matched.
    pub replay_valid: bool,
    /// Every declared label resolved to one graph branch.
    pub branch_map_valid: bool,
    /// Number of verified lineage branches.
    pub branches_verified: u64,
}

/// Creates the complete Power House projection for a Cell.
pub fn prove_cell(
    manifest: CellManifestV0,
    semantic_packet: Option<Value>,
) -> Result<CellProofBundle, BridgeError> {
    let id = cell_id(&manifest)?;
    let artifact = artifact_for_manifest(&manifest, &id)?;
    let mut rootprint = Rootprint::new("origin", artifact)?;
    let root_id = RootprintId::new(rootprint.root_branch.clone())?;
    bind_identity_root(&mut rootprint, &root_id)?;
    rootprint.verify()?;
    let replay = rootprint.replay()?;
    let pha = rootprint
        .branches
        .get(root_id.as_str())
        .ok_or(BridgeError::MissingRootBranch)?
        .artifact
        .clone();
    let mut capsule_builder = MemoryCapsuleBuilder::new(format!("cell_{}", &id.as_str()[7..23]))
        .producer("tessaryn-forge", POWER_HOUSE_COMPATIBILITY_VERSION)
        .with_pha(pha.clone())
        .with_rootprint(rootprint.clone())
        .with_replay_required()
        .with_challenge_suite(ChallengeSuite::standard());
    if let Some(packet) = semantic_packet {
        let mut nodes = BTreeMap::new();
        nodes.insert(root_id.to_string(), packet.clone());
        let sidecar = ObservatorySidecar::new(&rootprint, nodes)?;
        capsule_builder = capsule_builder.with_sidecar(sidecar);
        capsule_builder = capsule_builder.with_semantic_packet(
            "slbit/viz-packet/v3",
            format!("slp_{}", &id.as_str()[7..19]),
            root_id.as_str(),
            &replay.state_fingerprint,
            "claim_view",
            packet,
        )?;
    }
    let mut memory_capsule = capsule_builder.build()?;
    memory_capsule.header.producer.platform = None;
    memory_capsule.header.capsule_digest = None;
    memory_capsule.header.capsule_digest = Some(memory_capsule.calculate_capsule_digest()?);
    Ok(CellProofBundle {
        manifest,
        cell_id: id,
        pha,
        rootprint,
        replay_fingerprint: replay.state_fingerprint,
        memory_capsule,
    })
}

/// Builds one deterministic Rootprint graph across a sequence of Cells.
pub fn prove_lineage(steps: Vec<CellLineageStep>) -> Result<WorldLineageBundle, BridgeError> {
    let mut iterator = steps.into_iter();
    let first = iterator.next().ok_or(BridgeError::EmptyLineage)?;
    if !first.parent_labels.is_empty() {
        return Err(BridgeError::InvalidLineage(
            "the first step must not contain parents".to_string(),
        ));
    }
    let first_id = cell_id(&first.manifest)?;
    let mut rootprint = Rootprint::new(
        first.label.clone(),
        artifact_for_manifest(&first.manifest, &first_id)?,
    )?;
    let mut branches = BTreeMap::new();
    branches.insert(first.label, rootprint.root_branch.clone());
    let root_id = RootprintId::new(rootprint.root_branch.clone())?;
    bind_identity_root(&mut rootprint, &root_id)?;

    for step in iterator {
        if branches.contains_key(&step.label) {
            return Err(BridgeError::InvalidLineage(format!(
                "duplicate branch label {}",
                step.label
            )));
        }
        let id = cell_id(&step.manifest)?;
        let artifact = artifact_for_manifest(&step.manifest, &id)?;
        let branch_id = match step.parent_labels.as_slice() {
            [parent] => {
                let parent_id = branches.get(parent).ok_or_else(|| {
                    BridgeError::InvalidLineage(format!("unknown parent label {parent}"))
                })?;
                rootprint.fork(parent_id, step.label.clone(), artifact)?
            }
            [left, right] => {
                let left_id = branches.get(left).ok_or_else(|| {
                    BridgeError::InvalidLineage(format!("unknown parent label {left}"))
                })?;
                let right_id = branches.get(right).ok_or_else(|| {
                    BridgeError::InvalidLineage(format!("unknown parent label {right}"))
                })?;
                rootprint.merge(left_id, right_id, step.label.clone(), artifact)?
            }
            _ => {
                return Err(BridgeError::InvalidLineage(
                    "non-root steps require one or two parents".to_string(),
                ));
            }
        };
        let branch_root = RootprintId::new(branch_id.clone())?;
        bind_identity_root(&mut rootprint, &branch_root)?;
        branches.insert(step.label, branch_id);
    }
    rootprint.verify()?;
    let replay = rootprint.replay()?;
    Ok(WorldLineageBundle {
        rootprint,
        branches,
        replay_fingerprint: replay.state_fingerprint,
    })
}

/// Re-verifies a multi-Cell Rootprint lineage and deterministic replay state.
pub fn verify_lineage_bundle(
    bundle: &WorldLineageBundle,
) -> Result<WorldLineageReport, BridgeError> {
    bundle.rootprint.verify()?;
    let branch_ids = bundle
        .branches
        .values()
        .map(String::as_str)
        .collect::<std::collections::BTreeSet<_>>();
    let graph_ids = bundle
        .rootprint
        .branches
        .keys()
        .map(String::as_str)
        .collect::<std::collections::BTreeSet<_>>();
    if branch_ids != graph_ids || bundle.branches.len() != bundle.rootprint.branches.len() {
        return Err(BridgeError::LineageBranchMapMismatch);
    }
    let replay = bundle.rootprint.replay()?;
    if replay.state_fingerprint != bundle.replay_fingerprint {
        return Err(BridgeError::ReplayMismatch);
    }
    Ok(WorldLineageReport {
        rootprint_valid: true,
        replay_valid: true,
        branch_map_valid: true,
        branches_verified: bundle.branches.len() as u64,
    })
}

fn artifact_for_manifest(
    manifest: &CellManifestV0,
    id: &Digest,
) -> Result<PhaArtifact, BridgeError> {
    Ok(PhaArtifact::new(
        json!({
            "producer": "tessaryn-forge",
            "cell_schema": &manifest.schema,
            "anchor_id": &manifest.anchor_id,
            "source_manifest_root": id,
        }),
        CELL_PROTOCOL_V0,
        json!({
            "cell_manifest_digest": id,
            "chunk_merkle_root": &manifest.chunk_merkle_root,
            "policy_root": &manifest.policy_root,
            "declared_class": manifest.class,
        }),
        json!({
            "canonicalization_profile": "tessaryn-canonical-v0",
            "identity_verified": true,
            "physical_truth_claimed": false,
        }),
    )?)
}

fn bind_identity_root(rootprint: &mut Rootprint, root_id: &RootprintId) -> Result<(), BridgeError> {
    let root_branch = rootprint
        .branches
        .get_mut(root_id.as_str())
        .ok_or(BridgeError::MissingRootBranch)?;
    root_branch.artifact.identity_root = Some(root_id.clone());
    Ok(())
}

/// Verifies every local deterministic layer of a Cell package.
pub fn verify_bundle(bundle: &CellProofBundle) -> Result<CellProofReport, BridgeError> {
    let expected_cell_id = cell_id(&bundle.manifest)?;
    if expected_cell_id != bundle.cell_id {
        return Err(BridgeError::CellIdentityMismatch {
            expected: expected_cell_id,
            actual: bundle.cell_id.clone(),
        });
    }
    bundle.pha.verify()?;
    if bundle.pha.embedded_proof.protocol != CELL_PROTOCOL_V0 {
        return Err(BridgeError::ProtocolMismatch);
    }
    let input_id = bundle.pha.embedded_proof.public_inputs["cell_manifest_digest"]
        .as_str()
        .ok_or(BridgeError::PublicInputMismatch)?;
    if input_id != bundle.cell_id.as_str() {
        return Err(BridgeError::PublicInputMismatch);
    }
    bundle.rootprint.verify()?;
    let replay = bundle.rootprint.replay()?;
    if replay.state_fingerprint != bundle.replay_fingerprint {
        return Err(BridgeError::ReplayMismatch);
    }
    let memory_report = bundle
        .memory_capsule
        .verify(power_house::MemoryVerificationPolicy::strict())?;
    if !memory_report.core_valid || !memory_report.rootprint_valid || !memory_report.replay_valid {
        return Err(BridgeError::MemoryVerificationFailed);
    }
    Ok(CellProofReport {
        cell_identity_valid: true,
        pha_valid: true,
        rootprint_valid: true,
        replay_valid: true,
        memory_capsule_valid: true,
        physical_truth_claimed: false,
    })
}

/// Power House bridge error.
#[derive(Debug, Error)]
pub enum BridgeError {
    /// Canonical identity failed.
    #[error(transparent)]
    Canonical(#[from] tessaryn_canonical::CanonicalError),
    /// PHA construction or verification failed.
    #[error(transparent)]
    Pha(#[from] power_house::provenance::PhaError),
    /// Rootprint construction or verification failed.
    #[error(transparent)]
    Rootprint(#[from] power_house::provenance::RootprintError),
    /// Memory Capsule construction or verification failed.
    #[error(transparent)]
    Memory(#[from] power_house::MemoryError),
    /// Observatory sidecar construction or verification failed.
    #[error(transparent)]
    Observatory(#[from] power_house::ObservatoryError),
    /// Root branch was unexpectedly absent.
    #[error("Rootprint root branch is missing")]
    MissingRootBranch,
    /// Cell identity no longer matches the manifest.
    #[error("Cell identity mismatch: expected {expected}, found {actual}")]
    CellIdentityMismatch {
        /// Recalculated identity.
        expected: Digest,
        /// Stored identity.
        actual: Digest,
    },
    /// The protocol identifier changed.
    #[error("Power House protocol identifier mismatch")]
    ProtocolMismatch,
    /// PHA public input no longer binds the Cell.
    #[error("PHA public input does not bind the Cell identity")]
    PublicInputMismatch,
    /// Rootprint replay identity changed.
    #[error("Rootprint replay fingerprint mismatch")]
    ReplayMismatch,
    /// Strict Memory Capsule verification did not accept every core layer.
    #[error("Memory Capsule verification failed")]
    MemoryVerificationFailed,
    /// No lineage steps were supplied.
    #[error("world lineage requires at least one step")]
    EmptyLineage,
    /// Lineage labels or parents were invalid.
    #[error("invalid world lineage: {0}")]
    InvalidLineage(String),
    /// Declared labels did not map exactly to Rootprint branches.
    #[error("world lineage branch map mismatch")]
    LineageBranchMapMismatch,
}

#[cfg(test)]
mod tests {
    use super::*;
    use tessaryn_schema::{
        CellClass, ChannelDescriptor, Criticality, EvidenceDeclaration, SpatialExtent,
        TemporalExtent, TemporalStateKind, CELL_SCHEMA_V0,
    };

    fn digest(value: u64) -> Digest {
        Digest::new(format!("sha256:{value:064x}")).unwrap()
    }

    fn manifest() -> CellManifestV0 {
        CellManifestV0 {
            schema: CELL_SCHEMA_V0.to_string(),
            class: CellClass::Observation,
            anchor_id: digest(1),
            spatial_extent: SpatialExtent {
                min_um: [0, 0, 0],
                max_um: [4_000_000, 3_000_000, 2_000_000],
                orientation_q30: [0, 0, 0, 1 << 30],
                uncertainty_um: [1_000; 3],
            },
            temporal_extent: TemporalExtent {
                start_unix_us: 1,
                end_unix_us: 2,
                uncertainty_us: 10,
                clock_source: "synthetic/v0".to_string(),
                published_at_unix_us: 2,
                valid_from_unix_us: 1,
                valid_until_unix_us: Some(2),
                supersedes: Vec::new(),
                state_kind: TemporalStateKind::Observed,
            },
            channels: vec![ChannelDescriptor {
                role: "geometry/surfel".to_string(),
                codec: "tessaryn/surfel".to_string(),
                codec_version: "0".to_string(),
                chunk_root: digest(2),
                uncompressed_bytes: 64,
                quality_tier: 0,
                criticality: Criticality::Critical,
                license: "CC0-1.0".to_string(),
            }],
            parents: Vec::new(),
            source_records: Vec::new(),
            transform_records: Vec::new(),
            policy_root: digest(3),
            evidence: EvidenceDeclaration {
                identity_committed: true,
                replay_available: true,
                source_attributed: true,
                disputed: false,
                semantic_only: false,
                restricted: false,
            },
            chunk_merkle_root: digest(4),
        }
    }

    #[test]
    fn cell_bundle_verifies_end_to_end() {
        let bundle = prove_cell(
            manifest(),
            Some(json!({"schema":"slbit/viz-packet/v3","summary":"synthetic Cell"})),
        )
        .unwrap();
        let report = verify_bundle(&bundle).unwrap();
        assert!(report.cell_identity_valid);
        assert!(report.memory_capsule_valid);
        assert!(!report.physical_truth_claimed);
        assert_eq!(
            bundle.memory_capsule.header.producer.power_house_version,
            POWER_HOUSE_COMPATIBILITY_VERSION
        );
        assert_eq!(bundle.memory_capsule.header.producer.platform, None);
    }

    #[test]
    fn coordinate_mutation_is_rejected_at_cell_identity() {
        let mut bundle = prove_cell(manifest(), None).unwrap();
        bundle.manifest.spatial_extent.max_um[0] += 1;
        assert!(matches!(
            verify_bundle(&bundle),
            Err(BridgeError::CellIdentityMismatch { .. })
        ));
    }

    #[test]
    fn world_lineage_reverifies_and_branch_map_mutation_rejects() {
        let root = manifest();
        let mut derived = root.clone();
        derived.class = CellClass::Derived;
        derived.temporal_extent.state_kind = TemporalStateKind::Derived;
        derived.parents = vec![cell_id(&root).unwrap()];
        derived.channels[0].chunk_root = digest(20);
        derived.chunk_merkle_root = digest(20);
        let lineage = prove_lineage(vec![
            CellLineageStep {
                label: "observation".to_string(),
                parent_labels: Vec::new(),
                manifest: root,
            },
            CellLineageStep {
                label: "derived".to_string(),
                parent_labels: vec!["observation".to_string()],
                manifest: derived,
            },
        ])
        .unwrap();
        assert_eq!(
            verify_lineage_bundle(&lineage).unwrap().branches_verified,
            2
        );
        let mut mutation = lineage;
        mutation.branches.remove("derived");
        assert!(matches!(
            verify_lineage_bundle(&mutation),
            Err(BridgeError::LineageBranchMapMismatch)
        ));
    }
}
