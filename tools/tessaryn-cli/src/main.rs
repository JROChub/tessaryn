mod datasets;
mod layout;
mod tartanair;

use datasets::{tartanair_profile, validation_portfolio};
use layout::inspect_dataset_layout;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use tartanair::{load_tartanair_validation_capture, ValidationSelectionRecord};
use tessaryn_canonical::{chunk_id, chunk_merkle_root, parse_strict_json_bounded};
use tessaryn_cli::artifact::{
    build_reconstruction_artifact, verify_reconstruction_artifact, ReconstructionArtifactV0,
    RECONSTRUCTION_ARTIFACT_SCHEMA_V0,
};
use tessaryn_cli::cinematic::{pack_cinematic_object, verify_cinematic_object};
use tessaryn_cli::{generate_demo_world, verify_demo_world, DemoWorld};
use tessaryn_forge::CapturePolicy;
use tessaryn_powerhouse::{
    prove_cell, prove_lineage, verify_bundle, verify_lineage_bundle, CellLineageStep,
    CellProofBundle, CellProofReport, WorldLineageBundle, WorldLineageReport,
};
use tessaryn_reconstruct::{
    rgbd_frame_id, verify_reconstruction_report, ReconstructionPolicy, RgbdCalibrationV0,
    RgbdFrameV0, RgbdSessionV0, RigidPoseQ30,
};
use tessaryn_schema::{
    CellClass, CellManifestV0, ChannelDescriptor, Criticality, DatasetProfileV1, Digest,
    EvidenceDeclaration, SourceRecord, TemporalStateKind, TransformRecord, CELL_SCHEMA_V0,
};
use tessaryn_sync::PortableLocusV0;

const MAX_TOOL_INPUT_BYTES: usize = 256 * 1024 * 1024;
const RECONSTRUCTION_REQUEST_SCHEMA_V0: &str = "tessaryn/reconstruction-request/v0";
const RGBD_FILE_REQUEST_SCHEMA_V0: &str = "tessaryn/rgbd-file-request/v0";
const VALIDATION_LOCUS_ARTIFACT_SCHEMA_V1: &str = "tessaryn/validation-locus-artifact/v1";

#[derive(Debug, Serialize, Deserialize)]
struct ReconstructionRequestV0 {
    schema: String,
    session: RgbdSessionV0,
    capture_policy: CapturePolicy,
    reconstruction_policy: ReconstructionPolicy,
}

#[derive(Debug, Serialize, Deserialize)]
struct RgbdFileRequestV0 {
    schema: String,
    declared_session_id: Digest,
    anchor_id: Digest,
    clock_source: String,
    producer: String,
    device_key: Option<Digest>,
    frames: Vec<RgbdFileFrameV0>,
    capture_policy: CapturePolicy,
    reconstruction_policy: ReconstructionPolicy,
}

#[derive(Debug, Serialize, Deserialize)]
struct RgbdFileFrameV0 {
    #[serde(default)]
    frame_id: Option<Digest>,
    captured_at_unix_us: i64,
    calibration: RgbdCalibrationV0,
    pose: RigidPoseQ30,
    depth_u16_le: PathBuf,
    color_rgba8: PathBuf,
    #[serde(default)]
    privacy_mask_u8: Option<PathBuf>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ValidationLocusArtifactV1 {
    schema: String,
    origin: String,
    source: ValidationSourceV1,
    source_proof: CellProofBundle,
    source_proof_report: CellProofReport,
    moments: Vec<ValidationReconstructionMomentV1>,
    alternate: ValidationReconstructionMomentV1,
    lineage: WorldLineageBundle,
    lineage_report: WorldLineageReport,
}

#[derive(Debug, Serialize, Deserialize)]
struct ValidationSourceV1 {
    profile: DatasetProfileV1,
    selection_manifest: Digest,
    source_manifest: Digest,
    selected_frames: usize,
    selections: Vec<ValidationSelectionRecord>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ValidationReconstructionMomentV1 {
    id: String,
    label: String,
    captured_at_unix_us: i64,
    artifact: ReconstructionArtifactV0,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("tessaryn: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut arguments = env::args().skip(1);
    match arguments.next().as_deref() {
        Some("generate-demo") => {
            let output = arguments
                .next()
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("apps/viewer-web/public/world/vesper-court.json"));
            let world = generate_demo_world()?;
            let bytes = serde_json::to_vec_pretty(&world)?;
            if let Some(parent) = output.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(&output, bytes)?;
            let report = verify_demo_world(&world)?;
            println!(
                "generated {} Cells / {} Moments / {} disputes -> {}",
                report.cells_valid,
                report.moments,
                report.disputed_cells,
                output.display()
            );
        }
        Some("verify-demo") => {
            let input = arguments
                .next()
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("apps/viewer-web/public/world/vesper-court.json"));
            let world: DemoWorld = serde_json::from_slice(&fs::read(&input)?)?;
            let report = verify_demo_world(&world)?;
            println!("{}", serde_json::to_string_pretty(&report)?);
        }
        Some("challenge-demo") => {
            let input = arguments
                .next()
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("apps/viewer-web/public/world/vesper-court.json"));
            let world: DemoWorld = serde_json::from_slice(&fs::read(&input)?)?;
            verify_demo_world(&world)?;
            let report = world
                .origin_memory_capsule
                .challenge_all(power_house::MemoryVerificationPolicy::strict())?;
            if report.mismatches != 0 || report.expected_rejections != report.total {
                return Err("Memory Capsule challenge mismatch".into());
            }
            println!("{}", serde_json::to_string_pretty(&report)?);
        }
        Some("reconstruct-rgbd") => {
            let input = required_path(arguments.next(), "RGB-D request path")?;
            let output = required_path(arguments.next(), "reconstruction artifact path")?;
            ensure_no_extra(arguments)?;
            let request: ReconstructionRequestV0 = read_strict_json(&input)?;
            if request.schema != RECONSTRUCTION_REQUEST_SCHEMA_V0 {
                return Err("unsupported reconstruction request schema".into());
            }
            run_reconstruction(
                request.session,
                request.capture_policy,
                request.reconstruction_policy,
                &output,
            )?;
        }
        Some("reconstruct-rgbd-files") => {
            let input = required_path(arguments.next(), "RGB-D file request path")?;
            let output = required_path(arguments.next(), "reconstruction artifact path")?;
            ensure_no_extra(arguments)?;
            let request: RgbdFileRequestV0 = read_strict_json(&input)?;
            let (session, capture_policy, reconstruction_policy) =
                load_rgbd_file_request(&input, request)?;
            run_reconstruction(session, capture_policy, reconstruction_policy, &output)?;
        }
        Some("generate-reconstruction-vector") => {
            let output = arguments.next().map(PathBuf::from).unwrap_or_else(|| {
                PathBuf::from("conformance/reconstruction-v0/minimal-artifact.json")
            });
            ensure_no_extra(arguments)?;
            let (session, capture_policy, reconstruction_policy) = reconstruction_vector();
            run_reconstruction(session, capture_policy, reconstruction_policy, &output)?;
        }
        Some("verify-reconstruction") => {
            let input = required_path(arguments.next(), "reconstruction artifact path")?;
            ensure_no_extra(arguments)?;
            let artifact: ReconstructionArtifactV0 = read_strict_json(&input)?;
            if artifact.schema != RECONSTRUCTION_ARTIFACT_SCHEMA_V0 {
                return Err("unsupported reconstruction artifact schema".into());
            }
            let report = verify_reconstruction_artifact(&artifact)?;
            println!("{}", serde_json::to_string_pretty(&report)?);
        }
        Some("construct-tartanair-locus") => {
            let input = required_path(arguments.next(), "TartanAir V2 archive directory")?;
            let output = required_path(arguments.next(), "validation Locus artifact path")?;
            let frames_per_moment = arguments
                .next()
                .map(|value| value.parse::<usize>())
                .transpose()?
                .unwrap_or(12);
            ensure_no_extra(arguments)?;
            run_tartanair_validation_locus(&input, &output, frames_per_moment)?;
        }
        Some("verify-validation-locus") => {
            let input = required_path(arguments.next(), "validation Locus artifact path")?;
            ensure_no_extra(arguments)?;
            let artifact: ValidationLocusArtifactV1 = read_strict_json(&input)?;
            let report = verify_validation_locus(&artifact)?;
            println!("{}", serde_json::to_string_pretty(&report)?);
        }
        Some("dataset-catalog") => {
            let output = arguments.next().map(PathBuf::from);
            ensure_no_extra(arguments)?;
            let bytes = serde_json::to_vec_pretty(&validation_portfolio())?;
            if let Some(output) = output {
                write_atomic(&output, &bytes)?;
                println!("wrote validation portfolio -> {}", output.display());
            } else {
                println!("{}", String::from_utf8(bytes)?);
            }
        }
        Some("inspect-dataset") => {
            let kind = arguments.next().ok_or("missing dataset adapter")?;
            let input = required_path(arguments.next(), "dataset directory")?;
            let output = arguments.next().map(PathBuf::from);
            ensure_no_extra(arguments)?;
            let receipt = inspect_dataset_layout(&kind, &input)?;
            let bytes = serde_json::to_vec_pretty(&receipt)?;
            if let Some(output) = output {
                write_atomic(&output, &bytes)?;
                println!("committed {kind} dataset layout -> {}", output.display());
            } else {
                println!("{}", String::from_utf8(bytes)?);
            }
        }
        Some("verify-locus") => {
            let input = required_path(arguments.next(), "portable Locus path")?;
            ensure_no_extra(arguments)?;
            let locus: PortableLocusV0 = read_strict_json(&input)?;
            let locus = locus.canonicalized()?;
            println!(
                "{}",
                serde_json::to_string_pretty(&serde_json::json!({
                    "branch_id": locus.branch_id,
                    "cells_valid": locus.cells.len(),
                    "locus_id": locus.locus_id()?,
                    "schema": locus.schema,
                }))?
            );
        }
        Some("pack-cinematic-object") => {
            let descriptor = required_path(arguments.next(), "cinematic descriptor path")?;
            let media = required_path(arguments.next(), "cinematic media path")?;
            let output = required_path(arguments.next(), "cinematic object path")?;
            ensure_no_extra(arguments)?;
            let report = pack_cinematic_object(&descriptor, &media, &output)?;
            println!("{}", serde_json::to_string_pretty(&report)?);
        }
        Some("verify-cinematic-object") => {
            let input = required_path(arguments.next(), "cinematic object path")?;
            ensure_no_extra(arguments)?;
            let report = verify_cinematic_object(&input)?;
            println!("{}", serde_json::to_string_pretty(&report)?);
        }
        _ => {
            println!("TESSARYN local world-construction tooling");
            println!("  tessaryn generate-demo [output.json]");
            println!("  tessaryn verify-demo [input.json]");
            println!("  tessaryn challenge-demo [input.json]");
            println!("  tessaryn reconstruct-rgbd <request.json> <artifact.json>");
            println!("  tessaryn reconstruct-rgbd-files <request.json> <artifact.json>");
            println!("  tessaryn generate-reconstruction-vector [artifact.json]");
            println!("  tessaryn verify-reconstruction <artifact.json>");
            println!("  tessaryn construct-tartanair-locus <archive-dir> <artifact.json> [frames]");
            println!("  tessaryn verify-validation-locus <artifact.json>");
            println!("  tessaryn dataset-catalog [output.json]");
            println!(
                "  tessaryn inspect-dataset <euroc|kitti|scannet> <dataset-dir> [receipt.json]"
            );
            println!("  tessaryn verify-locus <portable-locus.json>");
            println!(
                "  tessaryn pack-cinematic-object <descriptor.json> <media.mp4> <object.tessaryn>"
            );
            println!("  tessaryn verify-cinematic-object <object.tessaryn>");
        }
    }
    Ok(())
}

fn reconstruction_vector() -> (RgbdSessionV0, CapturePolicy, ReconstructionPolicy) {
    let mut frames = Vec::new();
    for (index, depth) in [1_000_u16, 1_100_u16].into_iter().enumerate() {
        let placeholder =
            Digest::new(format!("sha256:{}", "00".repeat(32))).expect("fixed digest is valid");
        let mut frame = RgbdFrameV0 {
            frame_id: placeholder,
            captured_at_unix_us: 100 + index as i64 * 100,
            calibration: RgbdCalibrationV0 {
                width: 4,
                height: 4,
                fx_q20: 4 << 20,
                fy_q20: 4 << 20,
                cx_q20: 1 << 20,
                cy_q20: 1 << 20,
                min_depth_mm: 100,
                max_depth_mm: 10_000,
            },
            pose: RigidPoseQ30 {
                translation_um: [index as i64 * 50_000, 0, 0],
                rotation_q30: [0, 0, 0, 1 << 30],
            },
            depth_mm: vec![depth; 16],
            color_rgba: vec![[40 + index as u8 * 80, 150, 190, 255]; 16],
            privacy_mask: Vec::new(),
        };
        frame.frame_id = rgbd_frame_id(&frame).expect("fixed frame is valid");
        frames.push(frame);
    }
    (
        RgbdSessionV0 {
            schema: "tessaryn/rgbd-session/v0".to_string(),
            declared_session_id: fixed_digest(30),
            anchor_id: fixed_digest(31),
            clock_source: "tessaryn/conformance-clock-v0".to_string(),
            producer: "tessaryn-reconstruction-conformance".to_string(),
            device_key: Some(fixed_digest(32)),
            frames,
        },
        CapturePolicy {
            operator_confirmed: true,
            visible_recording: true,
            local_processing: true,
            publication_allowed: true,
            retain_raw: false,
            exclusions: Vec::new(),
            derivative_license: "CC0-1.0".to_string(),
        },
        ReconstructionPolicy {
            pixel_stride: 1,
            surfel_radius_um: 5_000,
            voxel_size_um: 20_000,
            truncation_um: 40_000,
        },
    )
}

fn fixed_digest(value: u8) -> Digest {
    Digest::new(format!("sha256:{}", format!("{value:02x}").repeat(32)))
        .expect("fixed digest is valid")
}

fn run_reconstruction(
    session: RgbdSessionV0,
    capture_policy: CapturePolicy,
    reconstruction_policy: ReconstructionPolicy,
    output: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let artifact = build_reconstruction_artifact(session, capture_policy, reconstruction_policy)?;
    write_atomic(output, &serde_json::to_vec(&artifact)?)?;
    println!(
        "reconstructed {} public surfels / {} sparse SDF voxels -> {}",
        artifact.verification.verified_surfels,
        artifact.verification.verified_voxels,
        output.display()
    );
    Ok(())
}

fn run_tartanair_validation_locus(
    archive_root: &Path,
    output: &Path,
    frames_per_moment: usize,
) -> Result<(), Box<dyn std::error::Error>> {
    let capture = load_tartanair_validation_capture(archive_root, frames_per_moment)?;
    let capture_policy = CapturePolicy {
        operator_confirmed: true,
        visible_recording: true,
        local_processing: true,
        publication_allowed: true,
        retain_raw: false,
        exclusions: Vec::new(),
        derivative_license: capture.profile.license.clone(),
    };
    let reconstruction_policy = ReconstructionPolicy {
        pixel_stride: 8,
        surfel_radius_um: 12_000,
        voxel_size_um: 30_000,
        truncation_um: 60_000,
    };

    let mut moments = Vec::with_capacity(capture.moments.len());
    for slice in capture.moments {
        let captured_at_unix_us = slice
            .session
            .frames
            .first()
            .ok_or("validation Moment contains no frames")?
            .captured_at_unix_us;
        moments.push(ValidationReconstructionMomentV1 {
            id: slice.id,
            label: slice.label,
            captured_at_unix_us,
            artifact: build_reconstruction_artifact(
                slice.session,
                capture_policy.clone(),
                reconstruction_policy.clone(),
            )?,
        });
    }
    let alternate_time = capture
        .alternate
        .session
        .frames
        .first()
        .ok_or("validation alternate Moment contains no frames")?
        .captured_at_unix_us;
    let alternate = ValidationReconstructionMomentV1 {
        id: capture.alternate.id,
        label: capture.alternate.label,
        captured_at_unix_us: alternate_time,
        artifact: build_reconstruction_artifact(
            capture.alternate.session,
            capture_policy,
            reconstruction_policy,
        )?,
    };
    if moments.len() != 3 {
        return Err("validation Locus must contain exactly three canonical Moments".into());
    }

    let selection_manifest = selection_manifest(&capture.profile, &capture.selections)?;
    let source_bytes =
        validation_source_bytes(&capture.profile, &moments, &alternate, &selection_manifest)?;
    let source_manifest = chunk_id(&source_bytes);
    let source_cell = validation_source_cell(
        &capture.profile,
        &moments,
        &alternate,
        &selection_manifest,
        &source_manifest,
        source_bytes.len(),
        env!("CARGO_PKG_VERSION"),
    )?;
    let source_proof = prove_cell(
        source_cell.clone(),
        Some(serde_json::json!({
            "claim_state": "SOURCE_SEQUENCE_BOUND",
            "schema": "slbit/viz-packet/v3",
            "summary": "The validation Locus binds exact TartanAir V2 RGB and depth archives, simulator ground truth, ordered frame selections, and four reconstruction commitments.",
        })),
    )?;
    let source_proof_report = verify_bundle(&source_proof)?;
    let lineage = prove_validation_lineage(&source_cell, &moments, &alternate)?;
    let lineage_report = verify_lineage_bundle(&lineage)?;
    let artifact = ValidationLocusArtifactV1 {
        schema: VALIDATION_LOCUS_ARTIFACT_SCHEMA_V1.to_string(),
        origin: "ARCHVIZ TINY HOUSE / EXACT RGB-D GROUND TRUTH".to_string(),
        source: ValidationSourceV1 {
            profile: capture.profile,
            selection_manifest,
            source_manifest,
            selected_frames: capture.selected_frames,
            selections: capture.selections,
        },
        source_proof,
        source_proof_report,
        moments,
        alternate,
        lineage,
        lineage_report,
    };
    verify_validation_locus(&artifact)?;
    write_atomic(output, &serde_json::to_vec(&artifact)?)?;
    println!(
        "constructed {} ground-truth RGB-D Moments / 1 alternate branch / {} source frames -> {}",
        artifact.moments.len(),
        artifact.source.selected_frames,
        output.display()
    );
    Ok(())
}

fn selection_manifest(
    profile: &DatasetProfileV1,
    selections: &[ValidationSelectionRecord],
) -> Result<Digest, serde_json::Error> {
    Ok(chunk_id(&serde_json::to_vec(&serde_json::json!({
        "profile": profile,
        "selected": selections,
    }))?))
}

fn validation_source_bytes(
    profile: &DatasetProfileV1,
    moments: &[ValidationReconstructionMomentV1],
    alternate: &ValidationReconstructionMomentV1,
    selection_manifest: &Digest,
) -> Result<Vec<u8>, serde_json::Error> {
    serde_json::to_vec(&serde_json::json!({
        "moments": moments
            .iter()
            .map(|moment| serde_json::json!({
                "capture_commitment": moment.artifact.report.capture_commitment,
                "id": moment.id,
                "observation_cell": moment.artifact.report.observation.cell_id,
                "sdf_cell": moment.artifact.report.sdf_cell_id,
            }))
            .chain(std::iter::once(serde_json::json!({
                "capture_commitment": alternate.artifact.report.capture_commitment,
                "id": alternate.id,
                "observation_cell": alternate.artifact.report.observation.cell_id,
                "sdf_cell": alternate.artifact.report.sdf_cell_id,
            })))
            .collect::<Vec<_>>(),
        "profile": profile,
        "selection_manifest": selection_manifest,
    }))
}

fn validation_source_manifest(
    profile: &DatasetProfileV1,
    moments: &[ValidationReconstructionMomentV1],
    alternate: &ValidationReconstructionMomentV1,
    selection_manifest: &Digest,
) -> Result<Digest, serde_json::Error> {
    Ok(chunk_id(&validation_source_bytes(
        profile,
        moments,
        alternate,
        selection_manifest,
    )?))
}

fn validation_source_cell(
    profile: &DatasetProfileV1,
    moments: &[ValidationReconstructionMomentV1],
    alternate: &ValidationReconstructionMomentV1,
    selection_manifest: &Digest,
    source_manifest: &Digest,
    source_bytes: usize,
    tool_version: &str,
) -> Result<CellManifestV0, Box<dyn std::error::Error>> {
    let observations = moments
        .iter()
        .chain(std::iter::once(alternate))
        .map(|moment| &moment.artifact.report.observation)
        .collect::<Vec<_>>();
    let template = observations
        .first()
        .ok_or("validation source Cell has no observations")?;
    let mut spatial_extent = template.manifest.spatial_extent.clone();
    let mut temporal_extent = template.manifest.temporal_extent.clone();
    let mut source_records = Vec::<SourceRecord>::with_capacity(observations.len());
    let mut input_ids = profile
        .assets
        .iter()
        .map(|asset| asset.sha256.clone())
        .chain(std::iter::once(selection_manifest.clone()))
        .collect::<Vec<_>>();
    for observation in observations.iter().copied() {
        if observation.manifest.anchor_id != template.manifest.anchor_id
            || observation.manifest.policy_root != template.manifest.policy_root
        {
            return Err("validation source observations disagree on anchor or policy".into());
        }
        for axis in 0..3 {
            spatial_extent.min_um[axis] =
                spatial_extent.min_um[axis].min(observation.manifest.spatial_extent.min_um[axis]);
            spatial_extent.max_um[axis] =
                spatial_extent.max_um[axis].max(observation.manifest.spatial_extent.max_um[axis]);
            spatial_extent.uncertainty_um[axis] = spatial_extent.uncertainty_um[axis]
                .max(observation.manifest.spatial_extent.uncertainty_um[axis]);
        }
        temporal_extent.start_unix_us = temporal_extent
            .start_unix_us
            .min(observation.manifest.temporal_extent.start_unix_us);
        temporal_extent.end_unix_us = temporal_extent
            .end_unix_us
            .max(observation.manifest.temporal_extent.end_unix_us);
        temporal_extent.published_at_unix_us = temporal_extent
            .published_at_unix_us
            .max(observation.manifest.temporal_extent.published_at_unix_us);
        temporal_extent.valid_from_unix_us = temporal_extent
            .valid_from_unix_us
            .min(observation.manifest.temporal_extent.valid_from_unix_us);
        source_records.extend(observation.manifest.source_records.iter().cloned());
        input_ids.push(observation.cell_id.clone());
        input_ids.extend(
            observation
                .manifest
                .source_records
                .iter()
                .map(|record| record.source_id.clone()),
        );
    }
    source_records.sort_by(|left, right| left.source_id.cmp(&right.source_id));
    source_records.dedup_by(|left, right| left.source_id == right.source_id);
    input_ids.sort();
    input_ids.dedup();
    let mut parents = vec![
        moments[2].artifact.report.sdf_cell_id.clone(),
        alternate.artifact.report.sdf_cell_id.clone(),
    ];
    parents.sort();
    temporal_extent.clock_source = format!("{}/validation-locus", profile.id);
    temporal_extent.valid_until_unix_us = None;
    temporal_extent.supersedes.clear();
    temporal_extent.state_kind = TemporalStateKind::Derived;
    let chunk_root = chunk_merkle_root(std::slice::from_ref(source_manifest));
    let transform_id = chunk_id(&serde_json::to_vec(&serde_json::json!({
        "input_ids": input_ids,
        "profile": profile,
        "selection_manifest": selection_manifest,
        "source_manifest": source_manifest,
    }))?);
    let manifest = CellManifestV0 {
        schema: CELL_SCHEMA_V0.to_string(),
        class: CellClass::Aggregate,
        anchor_id: template.manifest.anchor_id.clone(),
        spatial_extent,
        temporal_extent,
        channels: vec![ChannelDescriptor {
            role: "reconstruction/report".to_string(),
            codec: "tessaryn/validation-source-manifest".to_string(),
            codec_version: "1".to_string(),
            chunk_root: chunk_root.clone(),
            uncompressed_bytes: u64::try_from(source_bytes)?,
            quality_tier: 0,
            criticality: Criticality::Critical,
            license: profile.license.clone(),
        }],
        parents,
        source_records,
        transform_records: vec![TransformRecord {
            transform_id,
            method: "tessaryn/validation-source-binding-v1".to_string(),
            tool: "tessaryn-cli".to_string(),
            tool_version: tool_version.to_string(),
            input_ids,
        }],
        policy_root: template.manifest.policy_root.clone(),
        evidence: EvidenceDeclaration {
            identity_committed: true,
            replay_available: true,
            source_attributed: true,
            disputed: false,
            semantic_only: false,
            restricted: false,
        },
        chunk_merkle_root: chunk_root,
    };
    manifest.validate()?;
    Ok(manifest)
}

fn prove_validation_lineage(
    source_cell: &CellManifestV0,
    moments: &[ValidationReconstructionMomentV1],
    alternate: &ValidationReconstructionMomentV1,
) -> Result<WorldLineageBundle, Box<dyn std::error::Error>> {
    let labels = ["moment-a", "moment-b", "moment-c"];
    let mut steps = Vec::with_capacity(9);
    for (index, (label, moment)) in labels.iter().zip(moments).enumerate() {
        let observation_label = format!("{label}-observation");
        let sdf_label = format!("{label}-sdf");
        let parents = if index == 0 {
            Vec::new()
        } else {
            vec![format!("{}-sdf", labels[index - 1])]
        };
        steps.push(CellLineageStep {
            label: observation_label.clone(),
            parent_labels: parents,
            manifest: moment.artifact.report.observation.manifest.clone(),
        });
        steps.push(CellLineageStep {
            label: sdf_label,
            parent_labels: vec![observation_label],
            manifest: moment.artifact.report.sdf_manifest.clone(),
        });
    }
    steps.push(CellLineageStep {
        label: "alternate-c-observation".to_string(),
        parent_labels: vec!["moment-b-sdf".to_string()],
        manifest: alternate.artifact.report.observation.manifest.clone(),
    });
    steps.push(CellLineageStep {
        label: "alternate-c-sdf".to_string(),
        parent_labels: vec!["alternate-c-observation".to_string()],
        manifest: alternate.artifact.report.sdf_manifest.clone(),
    });
    steps.push(CellLineageStep {
        label: "source".to_string(),
        parent_labels: vec!["moment-c-sdf".to_string(), "alternate-c-sdf".to_string()],
        manifest: source_cell.clone(),
    });
    Ok(prove_lineage(steps)?)
}

fn verify_validation_locus(
    artifact: &ValidationLocusArtifactV1,
) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    if artifact.schema != VALIDATION_LOCUS_ARTIFACT_SCHEMA_V1 || artifact.moments.len() != 3 {
        return Err("invalid validation Locus envelope".into());
    }
    artifact.source.profile.validate()?;
    if artifact.source.profile != tartanair_profile()
        || selection_manifest(&artifact.source.profile, &artifact.source.selections)?
            != artifact.source.selection_manifest
        || validation_source_manifest(
            &artifact.source.profile,
            &artifact.moments,
            &artifact.alternate,
            &artifact.source.selection_manifest,
        )? != artifact.source.source_manifest
    {
        return Err("validation source manifest mismatch".into());
    }
    let expected_ids = ["moment-a", "moment-b", "moment-c", "alternate-c"];
    let expected_times = [
        artifact.moments[0].captured_at_unix_us,
        artifact.moments[1].captured_at_unix_us,
        artifact.moments[2].captured_at_unix_us,
        artifact.alternate.captured_at_unix_us,
    ];
    if artifact.source.selections.len() != expected_ids.len()
        || artifact.source.selected_frames
            != artifact
                .source
                .selections
                .iter()
                .map(|selection| selection.frame_ids.len())
                .sum::<usize>()
        || artifact
            .source
            .selections
            .iter()
            .zip(expected_ids.into_iter().zip(expected_times))
            .any(|(selection, (expected_id, expected_time))| {
                selection.id != expected_id
                    || selection.frame_ids.len() < 3
                    || selection.frame_ids.len() != selection.captured_at_unix_us.len()
                    || selection.frame_ids.len() != selection.source_indices.len()
                    || selection.captured_at_unix_us.first() != Some(&expected_time)
                    || selection
                        .source_indices
                        .iter()
                        .zip(&selection.captured_at_unix_us)
                        .any(|(index, timestamp)| i64::from(*index) * 100_000 != *timestamp)
                    || !selection
                        .captured_at_unix_us
                        .windows(2)
                        .all(|pair| pair[0] < pair[1])
            })
    {
        return Err("validation source selection mismatch".into());
    }
    let source_bytes = validation_source_bytes(
        &artifact.source.profile,
        &artifact.moments,
        &artifact.alternate,
        &artifact.source.selection_manifest,
    )?;
    let source_transform_versions = artifact
        .source_proof
        .manifest
        .transform_records
        .iter()
        .filter(|record| record.method == "tessaryn/validation-source-binding-v1")
        .map(|record| record.tool_version.as_str())
        .collect::<Vec<_>>();
    if source_transform_versions.len() != 1 {
        return Err("validation source transform version is missing or ambiguous".into());
    }
    let expected_source_cell = validation_source_cell(
        &artifact.source.profile,
        &artifact.moments,
        &artifact.alternate,
        &artifact.source.selection_manifest,
        &artifact.source.source_manifest,
        source_bytes.len(),
        source_transform_versions[0],
    )?;
    if artifact.source_proof.manifest != expected_source_cell
        || verify_bundle(&artifact.source_proof)? != artifact.source_proof_report
    {
        return Err("validation source Cell proof mismatch".into());
    }
    let source_challenge = artifact
        .source_proof
        .memory_capsule
        .challenge_all(power_house::MemoryVerificationPolicy::strict())?;
    if source_challenge.mismatches != 0
        || source_challenge.expected_rejections != source_challenge.total
    {
        return Err("validation source Cell challenge mismatch".into());
    }
    let mut surfels = 0_u64;
    let mut voxels = 0_u64;
    for moment in artifact
        .moments
        .iter()
        .chain(std::iter::once(&artifact.alternate))
    {
        let verified = verify_reconstruction_report(
            &moment.artifact.report,
            &moment.artifact.reconstruction_policy,
        )?;
        if verified != moment.artifact.verification {
            return Err(format!("stored verification mismatch for {}", moment.id).into());
        }
        verify_reconstruction_artifact(&moment.artifact)?;
        surfels = surfels
            .checked_add(verified.verified_surfels)
            .ok_or("surfel count overflow")?;
        voxels = voxels
            .checked_add(verified.verified_voxels)
            .ok_or("voxel count overflow")?;
    }
    if verify_lineage_bundle(&artifact.lineage)? != artifact.lineage_report {
        return Err("validation Rootprint verification mismatch".into());
    }
    verify_lineage_cell_binding(&artifact.lineage, "source", &artifact.source_proof.cell_id)?;
    let source_branch_id = artifact
        .lineage
        .branches
        .get("source")
        .ok_or("validation source branch is missing")?;
    let source_branch = artifact
        .lineage
        .rootprint
        .branches
        .get(source_branch_id)
        .ok_or("validation source Rootprint branch is missing")?;
    let mut expected_source_parents = vec![
        artifact
            .lineage
            .branches
            .get("moment-c-sdf")
            .ok_or("moment-c SDF branch is missing")?
            .clone(),
        artifact
            .lineage
            .branches
            .get("alternate-c-sdf")
            .ok_or("alternate-c SDF branch is missing")?
            .clone(),
    ];
    expected_source_parents.sort();
    let mut actual_source_parents = source_branch.parents.clone();
    actual_source_parents.sort();
    if actual_source_parents != expected_source_parents {
        return Err("validation source branch merge mismatch".into());
    }
    for (label, moment) in ["moment-a", "moment-b", "moment-c"]
        .into_iter()
        .zip(&artifact.moments)
    {
        verify_lineage_cell_binding(
            &artifact.lineage,
            &format!("{label}-observation"),
            &moment.artifact.report.observation.cell_id,
        )?;
        verify_lineage_cell_binding(
            &artifact.lineage,
            &format!("{label}-sdf"),
            &moment.artifact.report.sdf_cell_id,
        )?;
    }
    verify_lineage_cell_binding(
        &artifact.lineage,
        "alternate-c-observation",
        &artifact.alternate.artifact.report.observation.cell_id,
    )?;
    verify_lineage_cell_binding(
        &artifact.lineage,
        "alternate-c-sdf",
        &artifact.alternate.artifact.report.sdf_cell_id,
    )?;
    Ok(serde_json::json!({
        "alternate_branch_valid": true,
        "cells_valid": 9,
        "dataset_profile": artifact.source.profile.id,
        "moments_valid": artifact.moments.len(),
        "rootprint_valid": true,
        "schema": artifact.schema,
        "selected_frames": artifact.source.selected_frames,
        "source_class": artifact.source.profile.source_class,
        "source_manifest": artifact.source.source_manifest,
        "surfels_valid": surfels,
        "voxels_valid": voxels,
    }))
}

fn verify_lineage_cell_binding(
    lineage: &WorldLineageBundle,
    label: &str,
    expected_cell_id: &Digest,
) -> Result<(), Box<dyn std::error::Error>> {
    let branch_id = lineage
        .branches
        .get(label)
        .ok_or_else(|| format!("lineage is missing {label}"))?;
    let branch = lineage
        .rootprint
        .branches
        .get(branch_id)
        .ok_or_else(|| format!("lineage branch {label} is missing"))?;
    let found = branch.artifact.embedded_proof.public_inputs["cell_manifest_digest"]
        .as_str()
        .ok_or("lineage artifact omits Cell identity")?;
    if found != expected_cell_id.as_str() {
        return Err(format!("lineage branch {label} does not bind reconstruction Cell").into());
    }
    Ok(())
}

fn load_rgbd_file_request(
    request_path: &Path,
    request: RgbdFileRequestV0,
) -> Result<(RgbdSessionV0, CapturePolicy, ReconstructionPolicy), Box<dyn std::error::Error>> {
    if request.schema != RGBD_FILE_REQUEST_SCHEMA_V0 {
        return Err("unsupported RGB-D file request schema".into());
    }
    let base = request_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .canonicalize()?;
    let mut frames = Vec::with_capacity(request.frames.len());
    for source in request.frames {
        let pixels = usize::try_from(source.calibration.width)
            .ok()
            .and_then(|width| {
                usize::try_from(source.calibration.height)
                    .ok()
                    .and_then(|height| width.checked_mul(height))
            })
            .ok_or("RGB-D frame dimensions overflow")?;
        let depth_bytes = read_exact_relative(
            &base,
            &source.depth_u16_le,
            pixels.checked_mul(2).ok_or("depth byte count overflow")?,
        )?;
        let color_bytes = read_exact_relative(
            &base,
            &source.color_rgba8,
            pixels.checked_mul(4).ok_or("color byte count overflow")?,
        )?;
        let privacy_mask = match &source.privacy_mask_u8 {
            Some(path) => read_exact_relative(&base, path, pixels)?,
            None => Vec::new(),
        };
        let depth_mm = depth_bytes
            .chunks_exact(2)
            .map(|bytes| u16::from_le_bytes([bytes[0], bytes[1]]))
            .collect::<Vec<_>>();
        let color_rgba = color_bytes
            .chunks_exact(4)
            .map(|bytes| [bytes[0], bytes[1], bytes[2], bytes[3]])
            .collect::<Vec<_>>();
        let placeholder = Digest::new(format!("sha256:{}", "00".repeat(32)))?;
        let mut frame = RgbdFrameV0 {
            frame_id: source.frame_id.clone().unwrap_or(placeholder),
            captured_at_unix_us: source.captured_at_unix_us,
            calibration: source.calibration,
            pose: source.pose,
            depth_mm,
            color_rgba,
            privacy_mask,
        };
        let calculated = rgbd_frame_id(&frame)?;
        if source
            .frame_id
            .is_some_and(|declared| declared != calculated)
        {
            return Err("RGB-D source file does not match declared frame_id".into());
        }
        frame.frame_id = calculated;
        frames.push(frame);
    }
    Ok((
        RgbdSessionV0 {
            schema: "tessaryn/rgbd-session/v0".to_string(),
            declared_session_id: request.declared_session_id,
            anchor_id: request.anchor_id,
            clock_source: request.clock_source,
            producer: request.producer,
            device_key: request.device_key,
            frames,
        },
        request.capture_policy,
        request.reconstruction_policy,
    ))
}

fn read_exact_relative(
    base: &Path,
    relative: &Path,
    expected_bytes: usize,
) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    if relative.is_absolute()
        || relative.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("RGB-D channel paths must remain inside the request directory".into());
    }
    let path = base.join(relative).canonicalize()?;
    if !path.starts_with(base) {
        return Err("RGB-D channel path escaped the request directory".into());
    }
    let metadata = fs::metadata(&path)?;
    if metadata.len() != expected_bytes as u64 {
        return Err(format!(
            "{} contains {} bytes; expected {}",
            relative.display(),
            metadata.len(),
            expected_bytes
        )
        .into());
    }
    let mut bytes = Vec::with_capacity(expected_bytes);
    File::open(path)?.read_to_end(&mut bytes)?;
    if bytes.len() != expected_bytes {
        return Err("RGB-D channel changed while it was being read".into());
    }
    Ok(bytes)
}

fn required_path(
    value: Option<String>,
    description: &str,
) -> Result<PathBuf, Box<dyn std::error::Error>> {
    value
        .map(PathBuf::from)
        .ok_or_else(|| format!("missing {description}").into())
}

fn ensure_no_extra(
    mut arguments: impl Iterator<Item = String>,
) -> Result<(), Box<dyn std::error::Error>> {
    if arguments.next().is_some() {
        return Err("unexpected extra command arguments".into());
    }
    Ok(())
}

fn read_strict_json<T: DeserializeOwned>(path: &Path) -> Result<T, Box<dyn std::error::Error>> {
    let metadata = fs::metadata(path)?;
    if metadata.len() > MAX_TOOL_INPUT_BYTES as u64 {
        return Err(format!("input exceeds {MAX_TOOL_INPUT_BYTES} bytes").into());
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    File::open(path)?
        .take(MAX_TOOL_INPUT_BYTES as u64 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > MAX_TOOL_INPUT_BYTES {
        return Err(format!("input exceeds {MAX_TOOL_INPUT_BYTES} bytes").into());
    }
    let value = parse_strict_json_bounded(&bytes, MAX_TOOL_INPUT_BYTES)?;
    Ok(serde_json::from_value(value)?)
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), Box<dyn std::error::Error>> {
    if bytes.len() > MAX_TOOL_INPUT_BYTES {
        return Err(format!("output exceeds {MAX_TOOL_INPUT_BYTES} bytes").into());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("invalid output filename")?;
    let temporary = parent.join(format!(".{file_name}.{}.tmp", std::process::id()));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)?;
    if let Err(error) = file.write_all(bytes).and_then(|()| file.sync_all()) {
        let _ = fs::remove_file(&temporary);
        return Err(error.into());
    }
    if let Err(error) = fs::rename(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(error.into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use tessaryn_forge::ExclusionVolume;

    static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    fn digest(value: u8) -> Digest {
        Digest::new(format!("sha256:{}", format!("{value:02x}").repeat(32))).unwrap()
    }

    fn test_root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "tessaryn-cli-rgbd-{}-{}",
            std::process::id(),
            TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ))
    }

    fn file_request(frame_id: Option<Digest>) -> RgbdFileRequestV0 {
        RgbdFileRequestV0 {
            schema: RGBD_FILE_REQUEST_SCHEMA_V0.to_string(),
            declared_session_id: digest(1),
            anchor_id: digest(2),
            clock_source: "rgbd/file-test-v0".to_string(),
            producer: "file-test-device".to_string(),
            device_key: Some(digest(3)),
            frames: vec![RgbdFileFrameV0 {
                frame_id,
                captured_at_unix_us: 100,
                calibration: RgbdCalibrationV0 {
                    width: 4,
                    height: 4,
                    fx_q20: 4 << 20,
                    fy_q20: 4 << 20,
                    cx_q20: 1 << 20,
                    cy_q20: 1 << 20,
                    min_depth_mm: 100,
                    max_depth_mm: 10_000,
                },
                pose: RigidPoseQ30 {
                    translation_um: [0; 3],
                    rotation_q30: [0, 0, 0, 1 << 30],
                },
                depth_u16_le: PathBuf::from("frame.depth16le"),
                color_rgba8: PathBuf::from("frame.rgba8"),
                privacy_mask_u8: None,
            }],
            capture_policy: CapturePolicy {
                operator_confirmed: true,
                visible_recording: true,
                local_processing: true,
                publication_allowed: true,
                retain_raw: false,
                exclusions: vec![ExclusionVolume {
                    id: digest(4),
                    min_um: [10_000_000; 3],
                    max_um: [11_000_000; 3],
                }],
                derivative_license: "CC0-1.0".to_string(),
            },
            reconstruction_policy: ReconstructionPolicy {
                pixel_stride: 1,
                surfel_radius_um: 5_000,
                voxel_size_um: 20_000,
                truncation_um: 40_000,
            },
        }
    }

    fn write_channels(root: &Path) {
        let mut depth = Vec::new();
        for _ in 0..16 {
            depth.extend_from_slice(&1_000_u16.to_le_bytes());
        }
        fs::write(root.join("frame.depth16le"), depth).unwrap();
        fs::write(root.join("frame.rgba8"), [20_u8, 40, 60, 255].repeat(16)).unwrap();
    }

    #[test]
    fn file_backed_rgbd_request_reconstructs_and_reverifies() {
        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        write_channels(&root);
        let mut privacy_mask = vec![0_u8; 16];
        privacy_mask[0] = 1;
        fs::write(root.join("frame.mask8"), privacy_mask).unwrap();
        let request_path = root.join("request.json");
        let artifact_path = root.join("artifact.json");
        let mut request = file_request(None);
        request.frames[0].privacy_mask_u8 = Some(PathBuf::from("frame.mask8"));
        fs::write(&request_path, serde_json::to_vec(&request).unwrap()).unwrap();
        let loaded: RgbdFileRequestV0 = read_strict_json(&request_path).unwrap();
        let (session, capture_policy, reconstruction_policy) =
            load_rgbd_file_request(&request_path, loaded).unwrap();
        assert_eq!(
            session.frames[0].frame_id,
            rgbd_frame_id(&session.frames[0]).unwrap()
        );
        run_reconstruction(
            session,
            capture_policy,
            reconstruction_policy,
            &artifact_path,
        )
        .unwrap();
        let artifact: ReconstructionArtifactV0 = read_strict_json(&artifact_path).unwrap();
        assert_eq!(
            verify_reconstruction_report(&artifact.report, &artifact.reconstruction_policy)
                .unwrap(),
            artifact.verification
        );
        assert!(artifact.verification.raw_frames_absent);
        assert_eq!(artifact.report.admitted_depth_samples, 9);
        assert_eq!(artifact.report.masked_depth_samples, 1);
        assert_eq!(artifact.report.observation.accepted_samples, 8);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn file_backed_rgbd_rejects_wrong_identity_size_and_path_escape() {
        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        write_channels(&root);
        let request_path = root.join("request.json");

        let wrong_identity = file_request(Some(digest(99)));
        assert!(load_rgbd_file_request(&request_path, wrong_identity).is_err());

        fs::write(root.join("frame.depth16le"), [0_u8; 2]).unwrap();
        assert!(load_rgbd_file_request(&request_path, file_request(None)).is_err());

        write_channels(&root);
        let mut escaped = file_request(None);
        escaped.frames[0].depth_u16_le = PathBuf::from("../outside.depth16le");
        assert!(load_rgbd_file_request(&request_path, escaped).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
