//! Conflict-preserving Cell indexing and deterministic Locus materialization.

use serde::{Deserialize, Serialize};
use sha2::{Digest as ShaDigest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use tessaryn_canonical::cell_id;
use tessaryn_schema::{CellClass, CellManifestV0, Digest};
use thiserror::Error;

const RECEIPT_DOMAIN: &[u8] = b"TESSARYN-MATERIALIZATION-v0\0";
const CAPABILITY_SET_DOMAIN: &[u8] = b"TESSARYN-CAPABILITY-SET-v0\0";

/// Bounded observer query.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LocusQuery {
    /// Required Anchor.
    pub anchor_id: Digest,
    /// Inclusive local bounds in micrometers.
    pub min_um: [i64; 3],
    /// Inclusive local bounds in micrometers.
    pub max_um: [i64; 3],
    /// Target interval start.
    pub start_unix_us: i64,
    /// Target interval end.
    pub end_unix_us: i64,
    /// Policy roots authorized by capabilities already validated by the caller.
    pub authorized_policy_roots: Vec<Digest>,
    /// Optional Rootprint branch selected for this materialization.
    pub lineage_branch: Option<Digest>,
    /// Whether predicted and planned simulation Cells may enter the plan.
    pub include_predictions: bool,
    /// Hard selection ceiling.
    pub max_cells: usize,
}

/// Deterministic materialization receipt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MaterializationReceipt {
    /// Selected Cell IDs in canonical order.
    pub selected_cells: Vec<Digest>,
    /// Explicit disagreement sets.
    pub conflict_sets: Vec<Vec<Digest>>,
    /// Count excluded by policy.
    pub policy_excluded: u64,
    /// Count excluded by spatial or temporal bounds.
    pub bounds_excluded: u64,
    /// Count excluded because they belong to another lineage branch.
    pub lineage_excluded: u64,
    /// Count excluded by the prediction boundary.
    pub prediction_excluded: u64,
    /// Commitment to the policy-root capability set used for selection.
    pub capability_set_root: Digest,
    /// Domain-separated receipt identity.
    pub receipt_id: Digest,
}

/// In-memory deterministic Cell index.
#[derive(Debug, Clone, Default)]
pub struct CellIndex {
    cells: BTreeMap<Digest, IndexedCell>,
}

#[derive(Debug, Clone)]
struct IndexedCell {
    manifest: CellManifestV0,
    lineage_branch: Option<Digest>,
}

impl CellIndex {
    /// Inserts a manifest after recalculating its identity.
    pub fn insert(&mut self, manifest: CellManifestV0) -> Result<Digest, WeaveError> {
        self.insert_on_branch(manifest, None)
    }

    /// Inserts a manifest with an optional Rootprint branch binding.
    pub fn insert_on_branch(
        &mut self,
        manifest: CellManifestV0,
        lineage_branch: Option<Digest>,
    ) -> Result<Digest, WeaveError> {
        if self.cells.len() >= 100_000 {
            return Err(WeaveError::IndexLimit);
        }
        let id = cell_id(&manifest)?;
        self.cells.insert(
            id.clone(),
            IndexedCell {
                manifest,
                lineage_branch,
            },
        );
        Ok(id)
    }

    /// Compiles a deterministic bounded Locus.
    pub fn compile(&self, query: &LocusQuery) -> Result<MaterializationReceipt, WeaveError> {
        if query.max_cells == 0 || query.max_cells > 50_000 {
            return Err(WeaveError::InvalidCellLimit);
        }
        if query.start_unix_us > query.end_unix_us
            || (0..3).any(|axis| query.min_um[axis] > query.max_um[axis])
        {
            return Err(WeaveError::InvalidBounds);
        }
        let mut selected = Vec::new();
        let mut disputed = Vec::new();
        let authorized = query
            .authorized_policy_roots
            .iter()
            .cloned()
            .collect::<BTreeSet<_>>();
        let capability_set_root = capability_set_digest(&authorized)?;
        let mut policy_excluded = 0_u64;
        let mut bounds_excluded = 0_u64;
        let mut lineage_excluded = 0_u64;
        let mut prediction_excluded = 0_u64;
        for (id, indexed) in &self.cells {
            let manifest = &indexed.manifest;
            if manifest.anchor_id != query.anchor_id || !overlaps(manifest, query) {
                bounds_excluded += 1;
                continue;
            }
            if let Some(selected_branch) = &query.lineage_branch {
                if indexed
                    .lineage_branch
                    .as_ref()
                    .is_some_and(|branch| branch != selected_branch)
                {
                    lineage_excluded += 1;
                    continue;
                }
            }
            if !query.include_predictions && manifest.class == CellClass::Simulation {
                prediction_excluded += 1;
                continue;
            }
            if manifest.evidence.restricted && !authorized.contains(&manifest.policy_root) {
                policy_excluded += 1;
                continue;
            }
            selected.push((
                manifest.temporal_extent.start_unix_us,
                class_rank(manifest.class),
                id.clone(),
            ));
            if manifest.evidence.disputed {
                disputed.push(id.clone());
            }
        }
        selected.sort();
        selected.truncate(query.max_cells);
        let mut selected_cells = selected
            .into_iter()
            .map(|(_, _, id)| id)
            .collect::<Vec<_>>();
        let superseded = selected_cells
            .iter()
            .filter_map(|id| self.cells.get(id))
            .flat_map(|indexed| indexed.manifest.temporal_extent.supersedes.iter().cloned())
            .collect::<BTreeSet<_>>();
        selected_cells.retain(|id| !superseded.contains(id));
        let selected_set = selected_cells.iter().cloned().collect::<BTreeSet<_>>();
        disputed.retain(|id| selected_set.contains(id));
        let conflict_sets = if disputed.len() > 1 {
            vec![disputed]
        } else {
            Vec::new()
        };
        let projection = ReceiptProjection {
            selected_cells: &selected_cells,
            conflict_sets: &conflict_sets,
            policy_excluded,
            bounds_excluded,
            lineage_excluded,
            prediction_excluded,
            lineage_branch: query.lineage_branch.as_ref(),
            capability_set_root: &capability_set_root,
        };
        let receipt_id = receipt_digest(&projection)?;
        Ok(MaterializationReceipt {
            selected_cells,
            conflict_sets,
            policy_excluded,
            bounds_excluded,
            lineage_excluded,
            prediction_excluded,
            capability_set_root,
            receipt_id,
        })
    }
}

/// Locus compilation error.
#[derive(Debug, Error)]
pub enum WeaveError {
    /// Canonicalization failed.
    #[error(transparent)]
    Canonical(#[from] tessaryn_canonical::CanonicalError),
    /// JSON encoding failed.
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    /// Index capacity was exceeded.
    #[error("Cell index capacity exceeded")]
    IndexLimit,
    /// Query bound was malformed.
    #[error("invalid Locus bounds")]
    InvalidBounds,
    /// Query cell ceiling was malformed.
    #[error("max_cells must be between 1 and 50000")]
    InvalidCellLimit,
}

fn overlaps(manifest: &CellManifestV0, query: &LocusQuery) -> bool {
    let spatial = (0..3).all(|axis| {
        manifest.spatial_extent.max_um[axis] >= query.min_um[axis]
            && manifest.spatial_extent.min_um[axis] <= query.max_um[axis]
    });
    let temporal = manifest.temporal_extent.end_unix_us >= query.start_unix_us
        && manifest.temporal_extent.start_unix_us <= query.end_unix_us;
    let validity = manifest.temporal_extent.valid_from_unix_us <= query.end_unix_us
        && manifest
            .temporal_extent
            .valid_until_unix_us
            .is_none_or(|end| end >= query.start_unix_us);
    spatial && temporal && validity
}

fn class_rank(class: CellClass) -> u8 {
    match class {
        CellClass::Observation => 0,
        CellClass::Derived => 1,
        CellClass::Aggregate => 2,
        CellClass::Simulation => 3,
        CellClass::Annotation => 4,
        CellClass::Policy => 5,
    }
}

#[derive(Serialize)]
struct ReceiptProjection<'a> {
    selected_cells: &'a [Digest],
    conflict_sets: &'a [Vec<Digest>],
    policy_excluded: u64,
    bounds_excluded: u64,
    lineage_excluded: u64,
    prediction_excluded: u64,
    lineage_branch: Option<&'a Digest>,
    capability_set_root: &'a Digest,
}

fn receipt_digest(projection: &ReceiptProjection<'_>) -> Result<Digest, serde_json::Error> {
    let value = serde_json::to_value(projection)?;
    let mut hasher = Sha256::new();
    hasher.update(RECEIPT_DOMAIN);
    hasher.update(serde_json::to_vec(&value)?);
    Ok(
        Digest::new(format!("sha256:{}", hex::encode(hasher.finalize())))
            .expect("SHA-256 output is a valid digest"),
    )
}

fn capability_set_digest(authorized: &BTreeSet<Digest>) -> Result<Digest, serde_json::Error> {
    let mut hasher = Sha256::new();
    hasher.update(CAPABILITY_SET_DOMAIN);
    hasher.update(serde_json::to_vec(authorized)?);
    Ok(
        Digest::new(format!("sha256:{}", hex::encode(hasher.finalize())))
            .expect("SHA-256 output is a valid digest"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use tessaryn_schema::{
        ChannelDescriptor, Criticality, EvidenceDeclaration, SpatialExtent, TemporalExtent,
        TemporalStateKind, CELL_SCHEMA_V0,
    };

    fn digest(value: u64) -> Digest {
        Digest::new(format!("sha256:{value:064x}")).unwrap()
    }

    fn manifest(index: u64, anchor: &Digest) -> CellManifestV0 {
        CellManifestV0 {
            schema: CELL_SCHEMA_V0.to_string(),
            class: CellClass::Observation,
            anchor_id: anchor.clone(),
            spatial_extent: SpatialExtent {
                min_um: [index as i64 * 10_000, 0, 0],
                max_um: [index as i64 * 10_000 + 5_000, 5_000, 5_000],
                orientation_q30: [0, 0, 0, 1 << 30],
                uncertainty_um: [100; 3],
            },
            temporal_extent: TemporalExtent {
                start_unix_us: 0,
                end_unix_us: 100,
                uncertainty_us: 1,
                clock_source: "synthetic/v0".to_string(),
                published_at_unix_us: 100,
                valid_from_unix_us: 0,
                valid_until_unix_us: Some(100),
                supersedes: Vec::new(),
                state_kind: TemporalStateKind::Observed,
            },
            channels: vec![ChannelDescriptor {
                role: "geometry/surfel".to_string(),
                codec: "tessaryn/surfel".to_string(),
                codec_version: "0".to_string(),
                chunk_root: digest(index + 100_000),
                uncompressed_bytes: 16,
                quality_tier: 0,
                criticality: Criticality::Critical,
                license: "CC0-1.0".to_string(),
            }],
            parents: Vec::new(),
            source_records: Vec::new(),
            transform_records: Vec::new(),
            policy_root: digest(90_000),
            evidence: EvidenceDeclaration {
                identity_committed: true,
                replay_available: true,
                source_attributed: true,
                disputed: false,
                semantic_only: false,
                restricted: false,
            },
            chunk_merkle_root: digest(index + 200_000),
        }
    }

    #[test]
    fn ten_thousand_cells_are_indexed_and_bounded_deterministically() {
        let anchor = digest(1);
        let mut index = CellIndex::default();
        for value in 0..10_000 {
            index.insert(manifest(value, &anchor)).unwrap();
        }
        let query = LocusQuery {
            anchor_id: anchor,
            min_um: [0, -1, -1],
            max_um: [99_995_000, 10_000, 10_000],
            start_unix_us: 0,
            end_unix_us: 100,
            authorized_policy_roots: Vec::new(),
            lineage_branch: None,
            include_predictions: false,
            max_cells: 10_000,
        };
        let first = index.compile(&query).unwrap();
        let second = index.compile(&query).unwrap();
        assert_eq!(first, second);
        assert_eq!(first.selected_cells.len(), 10_000);
    }

    #[test]
    fn branch_prediction_and_supersession_bound_moment_selection() {
        let anchor = digest(1);
        let east = digest(2);
        let west = digest(3);
        let mut index = CellIndex::default();

        let shared_id = index.insert(manifest(1, &anchor)).unwrap();
        let east_id = index
            .insert_on_branch(manifest(2, &anchor), Some(east.clone()))
            .unwrap();
        index
            .insert_on_branch(manifest(3, &anchor), Some(west))
            .unwrap();

        let mut replacement = manifest(4, &anchor);
        replacement.class = CellClass::Derived;
        replacement.parents = vec![east_id.clone()];
        replacement.temporal_extent.state_kind = TemporalStateKind::Derived;
        replacement.temporal_extent.supersedes = vec![east_id.clone()];
        let replacement_id = index
            .insert_on_branch(replacement, Some(east.clone()))
            .unwrap();

        let mut prediction = manifest(5, &anchor);
        prediction.class = CellClass::Simulation;
        prediction.temporal_extent.state_kind = TemporalStateKind::Predicted;
        index
            .insert_on_branch(prediction, Some(east.clone()))
            .unwrap();

        let query = LocusQuery {
            anchor_id: anchor,
            min_um: [0, -1, -1],
            max_um: [100_000, 10_000, 10_000],
            start_unix_us: 0,
            end_unix_us: 100,
            authorized_policy_roots: Vec::new(),
            lineage_branch: Some(east),
            include_predictions: false,
            max_cells: 100,
        };
        let receipt = index.compile(&query).unwrap();
        assert!(receipt.selected_cells.contains(&shared_id));
        assert!(receipt.selected_cells.contains(&replacement_id));
        assert!(!receipt.selected_cells.contains(&east_id));
        assert_eq!(receipt.lineage_excluded, 1);
        assert_eq!(receipt.prediction_excluded, 1);
    }

    #[test]
    fn restricted_cells_require_their_exact_policy_capability() {
        let anchor = digest(1);
        let mut restricted = manifest(1, &anchor);
        restricted.evidence.restricted = true;
        let policy_root = restricted.policy_root.clone();
        let mut index = CellIndex::default();
        let restricted_id = index.insert(restricted).unwrap();
        let base_query = LocusQuery {
            anchor_id: anchor,
            min_um: [0, -1, -1],
            max_um: [20_000, 10_000, 10_000],
            start_unix_us: 0,
            end_unix_us: 100,
            authorized_policy_roots: Vec::new(),
            lineage_branch: None,
            include_predictions: false,
            max_cells: 10,
        };
        let denied = index.compile(&base_query).unwrap();
        assert!(denied.selected_cells.is_empty());
        assert_eq!(denied.policy_excluded, 1);

        let mut authorized_query = base_query;
        authorized_query.authorized_policy_roots = vec![policy_root];
        let authorized = index.compile(&authorized_query).unwrap();
        assert_eq!(authorized.selected_cells, vec![restricted_id]);
        assert_ne!(denied.capability_set_root, authorized.capability_set_root);
    }
}
