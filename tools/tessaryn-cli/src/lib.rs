//! Deterministic reference Origin and conformance tooling.

pub mod artifact;
pub mod cinematic;

use power_house::provenance::PhaArtifact;
use power_house::{MemoryCapsule, MemoryVerificationPolicy};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use tessaryn_canonical::{cell_id, chunk_id, chunk_merkle_root};
use tessaryn_powerhouse::{
    prove_cell, prove_lineage, CellLineageStep, WorldLineageBundle, CELL_PROTOCOL_V0,
};
use tessaryn_schema::{
    CellClass, CellManifestV0, ChannelDescriptor, Criticality, Digest, EvidenceDeclaration,
    SourceRecord, SpatialExtent, TemporalExtent, TemporalStateKind, TransformRecord,
    CELL_SCHEMA_V0,
};
use thiserror::Error;

/// Reference fixture schema.
pub const DEMO_SCHEMA_V0: &str = "tessaryn/demo-world/v0";
const ORIGIN_START: i64 = 1_766_361_600_000_000;
const ORIGIN_END: i64 = 1_788_739_200_000_000;

/// One temporal state exposed by the viewer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DemoMoment {
    /// Stable key.
    pub id: String,
    /// Human label.
    pub label: String,
    /// Exact reference timestamp.
    pub unix_us: i64,
    /// Independently bound environmental presentation metadata.
    pub environment: DemoEnvironment,
}

/// Independently bound environmental presentation metadata.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DemoEnvironment {
    /// Sky color.
    pub sky: String,
    /// Sun color.
    pub sun: String,
    /// Sun intensity in thousandths.
    pub sun_milli: u16,
    /// Fog density in millionths.
    pub fog_ppm: u16,
    /// Short environmental label.
    pub condition: String,
}

/// Renderer descriptor kept outside Cell identity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DemoVisual {
    /// Primitive understood by the native reference renderer.
    pub primitive: String,
    /// Center position in millimeters.
    pub position_mm: [i64; 3],
    /// Local dimensions in millimeters.
    pub size_mm: [u64; 3],
    /// Euler rotation in milli-degrees.
    pub rotation_mdeg: [i32; 3],
    /// Renderer color.
    pub color: String,
    /// Material family.
    pub material: String,
    /// Deterministic procedural seed.
    pub seed: u32,
    /// Moments in which the presentation is active.
    pub moments: Vec<String>,
    /// Optional disagreement branch label.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
}

/// Browser-facing proof projection for a Cell.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DemoProof {
    /// Power House artifact.
    pub pha: PhaArtifact,
    /// Root branch binding.
    pub rootprint_id: String,
    /// Replay identity.
    pub replay_fingerprint: String,
}

/// One inspectable fixture Cell.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DemoCell {
    /// Stable product key.
    pub key: String,
    /// Human label.
    pub label: String,
    /// Canonical Cell ID.
    pub cell_id: Digest,
    /// Identity-bearing manifest.
    pub manifest: CellManifestV0,
    /// Bounded structural channel payload committed by the chunk root.
    pub channel_payload: Value,
    /// Independently bound presentation descriptor.
    pub visual: DemoVisual,
    /// Human-readable independently bound interpretation.
    pub semantic_summary: String,
    /// Power House projection.
    pub proof: DemoProof,
}

/// Complete deterministic reference Origin fixture.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DemoWorld {
    /// Fixture schema.
    pub schema: String,
    /// Explicit capability state.
    pub status: String,
    /// Product name.
    pub product: String,
    /// Origin label.
    pub origin: String,
    /// Evidence-boundary statement.
    /// Positive description of the locally verified release profile.
    pub verification_profile: String,
    /// Local Anchor ID.
    pub anchor_id: Digest,
    /// Temporal states.
    pub moments: Vec<DemoMoment>,
    /// Inspectable Cells.
    pub cells: Vec<DemoCell>,
    /// Multi-Cell Rootprint memory.
    pub lineage: WorldLineageBundle,
    /// One exportable Power House Memory Capsule for the Origin Cell.
    pub origin_memory_capsule: MemoryCapsule,
}

/// Layered fixture verification report.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DemoVerificationReport {
    /// Verified Cell count.
    pub cells_valid: usize,
    /// Verified PHA count.
    pub pha_valid: usize,
    /// Number of temporal states.
    pub moments: usize,
    /// Number of retained disagreement Cells.
    pub disputed_cells: usize,
    /// Number of restricted Cells.
    pub restricted_cells: usize,
    /// Rootprint graph passed.
    pub rootprint_valid: bool,
    /// Replay fingerprint matched.
    pub replay_valid: bool,
    /// Origin Memory Capsule passed strict local verification.
    pub memory_capsule_valid: bool,
    /// Physical truth is intentionally not claimed by this reference fixture.
    pub physical_truth_claimed: bool,
    /// Origin Anchor committed by the first Cell.
    pub anchor_id: Digest,
    /// First Cell identity in canonical fixture order.
    pub first_cell_id: Digest,
    /// Root branch of the world lineage.
    pub rootprint_root: String,
    /// Deterministic world-lineage replay identity.
    pub replay_fingerprint: String,
    /// Portable Origin Memory Capsule identity.
    pub capsule_digest: String,
}

/// Generates the bounded deterministic Vesper Court reference Origin.
pub fn generate_demo_world() -> Result<DemoWorld, DemoError> {
    let anchor_id = chunk_id(b"tessaryn:anchor:vesper-court:v0");
    let policy_root = chunk_id(b"tessaryn:policy:private-by-default:v0");
    let moments = demo_moments();
    let mut cells = Vec::new();
    let mut ids = BTreeMap::new();

    let static_specs = vec![
        spec(
            "origin-floor",
            "Origin floor",
            CellClass::Observation,
            "box",
            [0, -100, 0],
            [18_000, 200, 16_000],
            [0, 0, 0],
            "#8d9288",
            "mineral",
            11,
            all_moments(),
            None,
            false,
            false,
            "The structural plane establishing Vesper Court.",
        ),
        spec(
            "north-gallery",
            "North gallery",
            CellClass::Observation,
            "gallery",
            [0, 1_900, -6_300],
            [12_000, 3_800, 900],
            [0, 0, 0],
            "#c8c3ae",
            "limestone",
            12,
            all_moments(),
            None,
            false,
            false,
            "A deterministic reference architectural observation Cell.",
        ),
        spec(
            "east-wall",
            "East boundary",
            CellClass::Observation,
            "wall",
            [7_700, 1_300, 0],
            [500, 2_600, 12_000],
            [0, 0, 0],
            "#7c877a",
            "lichen-stone",
            13,
            all_moments(),
            None,
            false,
            false,
            "Observed boundary geometry with declared uncertainty.",
        ),
        spec(
            "west-terrace",
            "West terrace",
            CellClass::Observation,
            "terrace",
            [-6_200, 500, 500],
            [4_800, 1_000, 8_000],
            [0, 0, 0],
            "#a89a7c",
            "strata",
            14,
            all_moments(),
            None,
            false,
            false,
            "A multilevel traversable surface.",
        ),
        spec(
            "water-current",
            "Water current",
            CellClass::Observation,
            "water",
            [1_000, 70, 2_900],
            [8_000, 140, 1_200],
            [0, 0, 0],
            "#4f8f92",
            "water",
            15,
            all_moments(),
            None,
            false,
            false,
            "A time-bearing environmental channel.",
        ),
        spec(
            "tree-trunk",
            "Courtyard tree",
            CellClass::Observation,
            "cylinder",
            [3_600, 1_500, -900],
            [700, 3_000, 700],
            [0, 0, 0],
            "#665c47",
            "wood",
            16,
            all_moments(),
            None,
            false,
            false,
            "The stable trunk shared by three temporal canopy Cells.",
        ),
        spec(
            "grove-field",
            "Grove field",
            CellClass::Observation,
            "grove",
            [-1_800, 600, 4_500],
            [6_000, 1_200, 4_000],
            [0, 0, 0],
            "#6c8260",
            "vegetation",
            17,
            all_moments(),
            None,
            false,
            false,
            "Deterministic low vegetation in the reference Origin.",
        ),
        spec(
            "private-room",
            "Restricted interior",
            CellClass::Policy,
            "privacy",
            [-6_100, 1_700, -4_300],
            [3_200, 3_400, 3_000],
            [0, 0, 0],
            "#b36f61",
            "occlusion",
            18,
            all_moments(),
            None,
            true,
            false,
            "Authorization boundary; protected geometry is absent.",
        ),
        spec(
            "environment-light",
            "Captured light field",
            CellClass::Observation,
            "light-field",
            [0, 3_500, 0],
            [14_000, 7_000, 12_000],
            [0, 0, 0],
            "#e5d6a5",
            "environment",
            19,
            all_moments(),
            None,
            false,
            false,
            "Moment-bound environmental parameters committed to this World Cell.",
        ),
    ];
    for item in static_specs {
        let cell = build_cell(item, &anchor_id, &policy_root, Vec::new())?;
        ids.insert(cell.key.clone(), cell.cell_id.clone());
        cells.push(cell);
    }

    let canopy_a = build_cell(
        spec(
            "canopy-a",
            "Canopy / first light",
            CellClass::Observation,
            "canopy",
            [3_600, 3_500, -900],
            [3_600, 3_200, 3_600],
            [0, 0, 0],
            "#73815d",
            "foliage",
            31,
            vec!["moment-a".to_string()],
            None,
            false,
            false,
            "Earliest reference canopy observation.",
        ),
        &anchor_id,
        &policy_root,
        Vec::new(),
    )?;
    ids.insert(canopy_a.key.clone(), canopy_a.cell_id.clone());
    cells.push(canopy_a);

    let canopy_b = build_cell(
        spec(
            "canopy-b",
            "Canopy / rain archive",
            CellClass::Derived,
            "canopy",
            [3_600, 3_650, -900],
            [3_900, 3_500, 3_900],
            [0, 0, 0],
            "#526f55",
            "foliage-wet",
            32,
            vec!["moment-b".to_string()],
            None,
            false,
            false,
            "Derived temporal canopy state with explicit parent.",
        ),
        &anchor_id,
        &policy_root,
        vec![ids["canopy-a"].clone()],
    )?;
    ids.insert(canopy_b.key.clone(), canopy_b.cell_id.clone());
    cells.push(canopy_b);

    let canopy_c = build_cell(
        spec(
            "canopy-c",
            "Canopy / present weave",
            CellClass::Derived,
            "canopy",
            [3_600, 3_800, -900],
            [4_200, 3_800, 4_200],
            [0, 0, 0],
            "#81945e",
            "foliage-sun",
            33,
            vec!["moment-c".to_string()],
            None,
            false,
            false,
            "Latest derived canopy state.",
        ),
        &anchor_id,
        &policy_root,
        vec![ids["canopy-b"].clone()],
    )?;
    ids.insert(canopy_c.key.clone(), canopy_c.cell_id.clone());
    cells.push(canopy_c);

    let object_a = build_cell(
        spec(
            "archive-a",
            "Archive stone / first light",
            CellClass::Observation,
            "archive-stone",
            [-1_900, 700, 300],
            [1_400, 1_400, 1_400],
            [0, 12_000, 0],
            "#b4a977",
            "archive",
            41,
            vec!["moment-a".to_string()],
            None,
            false,
            false,
            "Portable object at its earliest reference position.",
        ),
        &anchor_id,
        &policy_root,
        Vec::new(),
    )?;
    ids.insert(object_a.key.clone(), object_a.cell_id.clone());
    cells.push(object_a);

    let object_b = build_cell(
        spec(
            "archive-b",
            "Archive stone / rain archive",
            CellClass::Derived,
            "archive-stone",
            [-600, 700, 900],
            [1_400, 1_400, 1_400],
            [0, 38_000, 0],
            "#c1b274",
            "archive-wet",
            42,
            vec!["moment-b".to_string()],
            None,
            false,
            false,
            "Movement preserved as a derived temporal Cell.",
        ),
        &anchor_id,
        &policy_root,
        vec![ids["archive-a"].clone()],
    )?;
    ids.insert(object_b.key.clone(), object_b.cell_id.clone());
    cells.push(object_b);

    let object_c = build_cell(
        spec(
            "archive-c",
            "Archive stone / present weave",
            CellClass::Derived,
            "archive-stone",
            [900, 700, 100],
            [1_400, 1_400, 1_400],
            [0, 74_000, 0],
            "#d2c37d",
            "archive-sun",
            43,
            vec!["moment-c".to_string()],
            None,
            false,
            false,
            "Latest object track state.",
        ),
        &anchor_id,
        &policy_root,
        vec![ids["archive-b"].clone()],
    )?;
    ids.insert(object_c.key.clone(), object_c.cell_id.clone());
    cells.push(object_c);

    let disputed_parent = ids["origin-floor"].clone();
    let dispute_east = build_cell(
        spec(
            "threshold-east",
            "Threshold hypothesis east",
            CellClass::Derived,
            "threshold",
            [5_300, 450, 4_800],
            [3_200, 900, 2_400],
            [0, -9_000, 0],
            "#cf8d62",
            "disputed",
            51,
            vec!["moment-c".to_string()],
            Some("east-hypothesis".to_string()),
            false,
            true,
            "One unresolved reconstruction hypothesis.",
        ),
        &anchor_id,
        &policy_root,
        vec![disputed_parent.clone()],
    )?;
    ids.insert(dispute_east.key.clone(), dispute_east.cell_id.clone());
    cells.push(dispute_east);

    let dispute_west = build_cell(
        spec(
            "threshold-west",
            "Threshold hypothesis west",
            CellClass::Derived,
            "threshold",
            [5_000, 450, 5_100],
            [3_200, 900, 2_400],
            [0, 11_000, 0],
            "#63a6a1",
            "disputed",
            52,
            vec!["moment-c".to_string()],
            Some("west-hypothesis".to_string()),
            false,
            true,
            "Competing reconstruction retained without silent averaging.",
        ),
        &anchor_id,
        &policy_root,
        vec![disputed_parent],
    )?;
    ids.insert(dispute_west.key.clone(), dispute_west.cell_id.clone());
    cells.push(dispute_west);

    let annotation = build_cell(
        spec(
            "meaning-layer",
            "Origin interpretation",
            CellClass::Annotation,
            "none",
            [0, 0, 0],
            [1, 1, 1],
            [0, 0, 0],
            "#d8d4c5",
            "semantic",
            61,
            all_moments(),
            None,
            false,
            false,
            "SLBIT meaning is independently bound and reorganizes with Cell focus.",
        ),
        &anchor_id,
        &policy_root,
        Vec::new(),
    )?;
    ids.insert(annotation.key.clone(), annotation.cell_id.clone());
    cells.push(annotation);

    cells.sort_by(|left, right| left.key.cmp(&right.key));
    let lineage = prove_lineage(vec![
        lineage_step("origin", &cells, "origin-floor", vec![]),
        lineage_step("moment-a", &cells, "archive-a", vec!["origin"]),
        lineage_step("moment-b", &cells, "archive-b", vec!["moment-a"]),
        lineage_step("moment-c", &cells, "archive-c", vec!["moment-b"]),
        lineage_step(
            "east-hypothesis",
            &cells,
            "threshold-east",
            vec!["moment-c"],
        ),
        lineage_step(
            "west-hypothesis",
            &cells,
            "threshold-west",
            vec!["moment-c"],
        ),
    ])?;
    let origin = cells
        .iter()
        .find(|cell| cell.key == "origin-floor")
        .ok_or_else(|| DemoError::InvalidFixture("origin Cell missing".to_string()))?;
    let origin_bundle = prove_cell(
        origin.manifest.clone(),
        Some(json!({
            "schema": "slbit/viz-packet/v3",
            "claim": {
                "label": "Vesper Court reference Origin",
                "authority": "semantic"
            },
            "explanation_constraints": {
                "mark_generated_text_non_authoritative": true,
                "forbid_unbound_claims": true
            }
        })),
    )?;
    debug_assert_eq!(
        origin.proof.pha.phx_fingerprint,
        origin_bundle.pha.phx_fingerprint
    );
    Ok(DemoWorld {
        schema: DEMO_SCHEMA_V0.to_string(),
        status: "reference-origin".to_string(),
        product: "TESSARYN".to_string(),
        origin: "Vesper Court / Reference Origin 01".to_string(),
        verification_profile: "Local Cell identity, PHA, Rootprint, replay, Memory Capsule, and SLBIT bindings verify against the packaged bytes.".to_string(),
        anchor_id,
        moments,
        cells,
        lineage,
        origin_memory_capsule: origin_bundle.memory_capsule,
    })
}

/// Verifies the complete fixture without network access.
pub fn verify_demo_world(world: &DemoWorld) -> Result<DemoVerificationReport, DemoError> {
    if world.schema != DEMO_SCHEMA_V0 || world.status != "reference-origin" {
        return Err(DemoError::InvalidFixture(
            "schema or status mismatch".to_string(),
        ));
    }
    if world.moments.len() != 3 {
        return Err(DemoError::InvalidFixture(
            "three Moments are required".to_string(),
        ));
    }
    let mut cells_valid = 0;
    let mut pha_valid = 0;
    let mut disputed_cells = 0;
    let mut restricted_cells = 0;
    for cell in &world.cells {
        let payload_bytes = serde_json::to_vec(&cell.channel_payload)?;
        let payload_chunk = chunk_id(&payload_bytes);
        let payload_root = chunk_merkle_root(&[payload_chunk]);
        if payload_root != cell.manifest.chunk_merkle_root
            || cell
                .manifest
                .channels
                .iter()
                .any(|channel| channel.chunk_root != payload_root)
        {
            return Err(DemoError::ChunkMismatch(cell.key.clone()));
        }
        let expected = cell_id(&cell.manifest)?;
        if expected != cell.cell_id {
            return Err(DemoError::CellMismatch(cell.key.clone()));
        }
        cell.proof.pha.verify()?;
        if cell.proof.pha.embedded_proof.protocol != CELL_PROTOCOL_V0
            || cell.proof.pha.embedded_proof.public_inputs["cell_manifest_digest"]
                != Value::String(cell.cell_id.to_string())
        {
            return Err(DemoError::PhaMismatch(cell.key.clone()));
        }
        if cell
            .proof
            .pha
            .identity_root
            .as_ref()
            .map(ToString::to_string)
            != Some(cell.proof.rootprint_id.clone())
        {
            return Err(DemoError::PhaMismatch(cell.key.clone()));
        }
        cells_valid += 1;
        pha_valid += 1;
        disputed_cells += usize::from(cell.manifest.evidence.disputed);
        restricted_cells += usize::from(cell.manifest.evidence.restricted);
    }
    if disputed_cells < 2 || restricted_cells < 1 {
        return Err(DemoError::InvalidFixture(
            "fixture must retain disagreement and privacy boundaries".to_string(),
        ));
    }
    world.lineage.rootprint.verify()?;
    let replay = world.lineage.rootprint.replay()?;
    if replay.state_fingerprint != world.lineage.replay_fingerprint || replay.tips.len() != 2 {
        return Err(DemoError::LineageMismatch);
    }
    let memory_report = world
        .origin_memory_capsule
        .verify(MemoryVerificationPolicy::strict())?;
    if !memory_report.core_valid || !memory_report.rootprint_valid || !memory_report.replay_valid {
        return Err(DemoError::MemoryMismatch);
    }
    let first_cell = world.cells.first().ok_or_else(|| {
        DemoError::InvalidFixture("the Origin requires at least one Cell".to_string())
    })?;
    Ok(DemoVerificationReport {
        cells_valid,
        pha_valid,
        moments: world.moments.len(),
        disputed_cells,
        restricted_cells,
        rootprint_valid: true,
        replay_valid: true,
        memory_capsule_valid: true,
        physical_truth_claimed: false,
        anchor_id: first_cell.manifest.anchor_id.clone(),
        first_cell_id: first_cell.cell_id.clone(),
        rootprint_root: world.lineage.rootprint.root_branch.clone(),
        replay_fingerprint: replay.state_fingerprint,
        capsule_digest: memory_report.capsule_digest,
    })
}

/// Demo generation or verification error.
#[derive(Debug, Error)]
pub enum DemoError {
    /// Canonicalization failed.
    #[error(transparent)]
    Canonical(#[from] tessaryn_canonical::CanonicalError),
    /// Power House bridge failed.
    #[error(transparent)]
    Bridge(#[from] tessaryn_powerhouse::BridgeError),
    /// Power House PHA failed.
    #[error(transparent)]
    Pha(#[from] power_house::provenance::PhaError),
    /// Rootprint failed.
    #[error(transparent)]
    Rootprint(#[from] power_house::provenance::RootprintError),
    /// Memory Capsule failed.
    #[error(transparent)]
    Memory(#[from] power_house::MemoryError),
    /// JSON failed.
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    /// Fixture contract was malformed.
    #[error("invalid fixture: {0}")]
    InvalidFixture(String),
    /// One Cell identity failed.
    #[error("Cell identity mismatch: {0}")]
    CellMismatch(String),
    /// One structural channel payload failed its chunk commitment.
    #[error("Cell chunk payload mismatch: {0}")]
    ChunkMismatch(String),
    /// One PHA projection failed.
    #[error("PHA projection mismatch: {0}")]
    PhaMismatch(String),
    /// Rootprint replay or tip set failed.
    #[error("world lineage mismatch")]
    LineageMismatch,
    /// Memory Capsule failed strict verification.
    #[error("origin Memory Capsule mismatch")]
    MemoryMismatch,
}

#[derive(Debug, Clone)]
struct CellSpec {
    key: String,
    label: String,
    class: CellClass,
    visual: DemoVisual,
    restricted: bool,
    disputed: bool,
    summary: String,
}

#[allow(clippy::too_many_arguments)]
fn spec(
    key: &str,
    label: &str,
    class: CellClass,
    primitive: &str,
    position_mm: [i64; 3],
    size_mm: [u64; 3],
    rotation_mdeg: [i32; 3],
    color: &str,
    material: &str,
    seed: u32,
    moments: Vec<String>,
    branch: Option<String>,
    restricted: bool,
    disputed: bool,
    summary: &str,
) -> CellSpec {
    CellSpec {
        key: key.to_string(),
        label: label.to_string(),
        class,
        visual: DemoVisual {
            primitive: primitive.to_string(),
            position_mm,
            size_mm,
            rotation_mdeg,
            color: color.to_string(),
            material: material.to_string(),
            seed,
            moments,
            branch,
        },
        restricted,
        disputed,
        summary: summary.to_string(),
    }
}

fn build_cell(
    item: CellSpec,
    anchor_id: &Digest,
    policy_root: &Digest,
    parents: Vec<Digest>,
) -> Result<DemoCell, DemoError> {
    let channel_payload = json!({
        "key": &item.key,
        "position_mm": item.visual.position_mm,
        "primitive": &item.visual.primitive,
        "rotation_mdeg": item.visual.rotation_mdeg,
        "schema": "tessaryn/demo-channel/v0",
        "seed": item.visual.seed,
        "size_mm": item.visual.size_mm,
    });
    let payload = serde_json::to_vec(&channel_payload)?;
    let chunk = chunk_id(&payload);
    let merkle = chunk_merkle_root(&[chunk]);
    let semantic_only = item.class == CellClass::Annotation;
    let role = match item.class {
        CellClass::Annotation => "semantic/labels",
        CellClass::Policy => "privacy/mask",
        _ => match item.visual.primitive.as_str() {
            "light-field" => "environment/light",
            "water" => "environment/weather",
            _ => "geometry/sdf",
        },
    };
    let start = item
        .visual
        .moments
        .first()
        .and_then(|moment| moment_time(moment))
        .unwrap_or(ORIGIN_START);
    let end = item
        .visual
        .moments
        .last()
        .and_then(|moment| moment_time(moment))
        .unwrap_or(ORIGIN_END);
    let mut min_um = [0_i64; 3];
    let mut max_um = [0_i64; 3];
    for axis in 0..3 {
        let half = i64::try_from(item.visual.size_mm[axis] / 2).unwrap_or(i64::MAX);
        min_um[axis] = item.visual.position_mm[axis].saturating_sub(half) * 1_000;
        max_um[axis] = item.visual.position_mm[axis].saturating_add(half) * 1_000;
    }
    let source_id = chunk_id(format!("source:{}:{start}", item.key).as_bytes());
    let transform_records = if parents.is_empty() {
        Vec::new()
    } else {
        vec![TransformRecord {
            transform_id: chunk_id(format!("transform:{}:{start}", item.key).as_bytes()),
            method: "tessaryn/reference-delta-v0".to_string(),
            tool: "tessaryn-reference-world".to_string(),
            tool_version: env!("CARGO_PKG_VERSION").to_string(),
            input_ids: parents.clone(),
        }]
    };
    let supersedes = if matches!(
        item.key.as_str(),
        "canopy-b" | "canopy-c" | "archive-b" | "archive-c"
    ) {
        parents.clone()
    } else {
        Vec::new()
    };
    let state_kind = match item.class {
        CellClass::Observation => TemporalStateKind::Observed,
        CellClass::Simulation => TemporalStateKind::Predicted,
        _ => TemporalStateKind::Derived,
    };
    let manifest = CellManifestV0 {
        schema: CELL_SCHEMA_V0.to_string(),
        class: item.class,
        anchor_id: anchor_id.clone(),
        spatial_extent: SpatialExtent {
            min_um,
            max_um,
            orientation_q30: [0, 0, 0, 1 << 30],
            uncertainty_um: if item.disputed {
                [120_000; 3]
            } else {
                [8_000; 3]
            },
        },
        temporal_extent: TemporalExtent {
            start_unix_us: start,
            end_unix_us: end,
            uncertainty_us: 1_000,
            clock_source: "tessaryn/reference-clock-v0".to_string(),
            published_at_unix_us: end,
            valid_from_unix_us: start,
            valid_until_unix_us: Some(end),
            supersedes,
            state_kind,
        },
        channels: vec![ChannelDescriptor {
            role: role.to_string(),
            codec: "tessaryn/demo-primitive".to_string(),
            codec_version: "0".to_string(),
            chunk_root: merkle.clone(),
            uncompressed_bytes: payload.len() as u64,
            quality_tier: 0,
            criticality: if semantic_only {
                Criticality::Optional
            } else {
                Criticality::Critical
            },
            license: "CC0-1.0".to_string(),
        }],
        parents,
        source_records: vec![SourceRecord {
            source_id,
            source_type: "reference-generator".to_string(),
            producer: "tessaryn-reference-world".to_string(),
            captured_at_unix_us: start,
            device_key: None,
        }],
        transform_records,
        policy_root: policy_root.clone(),
        evidence: EvidenceDeclaration {
            identity_committed: true,
            replay_available: true,
            source_attributed: true,
            disputed: item.disputed,
            semantic_only,
            restricted: item.restricted,
        },
        chunk_merkle_root: merkle,
    };
    let id = cell_id(&manifest)?;
    let packet = json!({
        "schema": "slbit/viz-packet/v3",
        "claim": {
            "label": item.label,
            "authority": "semantic",
            "bound_core": {"cell_id": id}
        },
        "summary": item.summary,
        "generated_text_non_authoritative": true
    });
    let bundle = prove_cell(manifest.clone(), Some(packet))?;
    let rootprint_id = bundle.rootprint.root_branch.clone();
    Ok(DemoCell {
        key: item.key,
        label: item.label,
        cell_id: id,
        manifest,
        channel_payload,
        visual: item.visual,
        semantic_summary: item.summary,
        proof: DemoProof {
            pha: bundle.pha,
            rootprint_id,
            replay_fingerprint: bundle.replay_fingerprint,
        },
    })
}

fn lineage_step(
    label: &str,
    cells: &[DemoCell],
    cell_key: &str,
    parents: Vec<&str>,
) -> CellLineageStep {
    let manifest = cells
        .iter()
        .find(|cell| cell.key == cell_key)
        .unwrap_or_else(|| panic!("fixture Cell {cell_key} must exist"))
        .manifest
        .clone();
    CellLineageStep {
        label: label.to_string(),
        parent_labels: parents.into_iter().map(str::to_string).collect(),
        manifest,
    }
}

fn demo_moments() -> Vec<DemoMoment> {
    vec![
        DemoMoment {
            id: "moment-a".to_string(),
            label: "First light / 2025-12-22".to_string(),
            unix_us: ORIGIN_START,
            environment: DemoEnvironment {
                sky: "#b8c5bf".to_string(),
                sun: "#ffd39a".to_string(),
                sun_milli: 880,
                fog_ppm: 12,
                condition: "cold first light".to_string(),
            },
        },
        DemoMoment {
            id: "moment-b".to_string(),
            label: "Rain archive / 2026-03-18".to_string(),
            unix_us: 1_773_792_000_000_000,
            environment: DemoEnvironment {
                sky: "#65777a".to_string(),
                sun: "#c4d0ca".to_string(),
                sun_milli: 420,
                fog_ppm: 34,
                condition: "recorded rain state".to_string(),
            },
        },
        DemoMoment {
            id: "moment-c".to_string(),
            label: "Present weave / 2026-07-10".to_string(),
            unix_us: ORIGIN_END,
            environment: DemoEnvironment {
                sky: "#a8c5c2".to_string(),
                sun: "#fff0bb".to_string(),
                sun_milli: 1_060,
                fog_ppm: 8,
                condition: "clear present state".to_string(),
            },
        },
    ]
}

fn moment_time(moment: &str) -> Option<i64> {
    demo_moments()
        .into_iter()
        .find(|candidate| candidate.id == moment)
        .map(|candidate| candidate.unix_us)
}

fn all_moments() -> Vec<String> {
    vec![
        "moment-a".to_string(),
        "moment-b".to_string(),
        "moment-c".to_string(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reference_origin_verifies_offline() {
        let world = generate_demo_world().unwrap();
        let report = verify_demo_world(&world).unwrap();
        assert_eq!(report.cells_valid, world.cells.len());
        assert_eq!(report.moments, 3);
        assert_eq!(report.disputed_cells, 2);
        assert_eq!(report.restricted_cells, 1);
        assert!(!report.physical_truth_claimed);
    }

    #[test]
    fn coordinate_mutation_fails_at_cell_identity() {
        let mut world = generate_demo_world().unwrap();
        world.cells[0].manifest.spatial_extent.max_um[0] += 1;
        assert!(matches!(
            verify_demo_world(&world),
            Err(DemoError::CellMismatch(_))
        ));
    }

    #[test]
    fn structural_chunk_mutation_fails_before_cell_identity() {
        let mut world = generate_demo_world().unwrap();
        world.cells[0].channel_payload["seed"] = json!(9_999);
        assert!(matches!(
            verify_demo_world(&world),
            Err(DemoError::ChunkMismatch(_))
        ));
    }

    #[test]
    fn temporal_anchor_parent_and_policy_mutations_fail_identity() {
        let base = generate_demo_world().unwrap();
        let derived = base
            .cells
            .iter()
            .position(|cell| !cell.manifest.parents.is_empty())
            .unwrap();

        let mut time = base.clone();
        time.cells[0].manifest.temporal_extent.published_at_unix_us += 1;
        assert!(matches!(
            verify_demo_world(&time),
            Err(DemoError::CellMismatch(_))
        ));

        let mut anchor = base.clone();
        anchor.cells[0].manifest.anchor_id = chunk_id(b"mutated-anchor");
        assert!(matches!(
            verify_demo_world(&anchor),
            Err(DemoError::CellMismatch(_))
        ));

        let mut parent = base.clone();
        parent.cells[derived].manifest.parents[0] = chunk_id(b"mutated-parent");
        assert!(matches!(
            verify_demo_world(&parent),
            Err(DemoError::CellMismatch(_))
        ));

        let mut policy = base;
        policy.cells[0].manifest.policy_root = chunk_id(b"mutated-policy");
        assert!(matches!(
            verify_demo_world(&policy),
            Err(DemoError::CellMismatch(_))
        ));
    }

    #[test]
    fn capsule_challenge_suite_rejects_at_expected_layers() {
        let world = generate_demo_world().unwrap();
        let report = world
            .origin_memory_capsule
            .challenge_all(MemoryVerificationPolicy::strict())
            .unwrap();
        assert_eq!(report.total, 10);
        assert_eq!(report.expected_rejections, report.total);
        assert_eq!(report.mismatches, 0);
        assert!(report.results.iter().all(|result| result.passed));
    }

    #[test]
    fn semantic_mutation_does_not_change_core_cell_identity() {
        let mut world = generate_demo_world().unwrap();
        let before = world.cells[0].cell_id.clone();
        world.cells[0].semantic_summary = "changed presentation".to_string();
        assert_eq!(cell_id(&world.cells[0].manifest).unwrap(), before);
        assert!(verify_demo_world(&world).is_ok());
    }
}
