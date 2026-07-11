use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use tessaryn_canonical::parse_strict_json_bounded;
use tessaryn_cli::{generate_demo_world, verify_demo_world, DemoWorld};
use tessaryn_forge::CapturePolicy;
use tessaryn_powerhouse::{
    prove_cell, prove_lineage, verify_bundle, verify_lineage_bundle, CellLineageStep,
    CellProofBundle, CellProofReport, WorldLineageBundle, WorldLineageReport,
};
use tessaryn_reconstruct::{
    reconstruct_rgbd_session, rgbd_frame_id, verify_reconstruction_report, ReconstructionPolicy,
    ReconstructionReport, ReconstructionVerificationReport, RgbdCalibrationV0, RgbdFrameV0,
    RgbdSessionV0, RigidPoseQ30,
};
use tessaryn_schema::Digest;
use tessaryn_sync::PortableLocusV0;

const MAX_TOOL_INPUT_BYTES: usize = 256 * 1024 * 1024;
const RECONSTRUCTION_REQUEST_SCHEMA_V0: &str = "tessaryn/reconstruction-request/v0";
const RGBD_FILE_REQUEST_SCHEMA_V0: &str = "tessaryn/rgbd-file-request/v0";
const RECONSTRUCTION_ARTIFACT_SCHEMA_V0: &str = "tessaryn/reconstruction-artifact/v0";

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
struct ReconstructionArtifactV0 {
    schema: String,
    reconstruction_policy: ReconstructionPolicy,
    report: ReconstructionReport,
    verification: ReconstructionVerificationReport,
    observation_proof: CellProofBundle,
    observation_proof_report: CellProofReport,
    sdf_proof: CellProofBundle,
    sdf_proof_report: CellProofReport,
    lineage: WorldLineageBundle,
    lineage_report: WorldLineageReport,
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
            let report =
                verify_reconstruction_report(&artifact.report, &artifact.reconstruction_policy)?;
            if report != artifact.verification {
                return Err("stored reconstruction verification report mismatch".into());
            }
            verify_artifact_provenance(&artifact)?;
            println!("{}", serde_json::to_string_pretty(&report)?);
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
        _ => {
            println!("TESSARYN local world-construction tooling");
            println!("  tessaryn generate-demo [output.json]");
            println!("  tessaryn verify-demo [input.json]");
            println!("  tessaryn challenge-demo [input.json]");
            println!("  tessaryn reconstruct-rgbd <request.json> <artifact.json>");
            println!("  tessaryn reconstruct-rgbd-files <request.json> <artifact.json>");
            println!("  tessaryn generate-reconstruction-vector [artifact.json]");
            println!("  tessaryn verify-reconstruction <artifact.json>");
            println!("  tessaryn verify-locus <portable-locus.json>");
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
    let report = reconstruct_rgbd_session(session, capture_policy, reconstruction_policy.clone())?;
    let verification = verify_reconstruction_report(&report, &reconstruction_policy)?;
    let observation_proof = prove_cell(
        report.observation.manifest.clone(),
        Some(serde_json::json!({
            "claim_state": "NOT_PROVEN_PHYSICAL_TRUTH",
            "schema": "slbit/viz-packet/v3",
            "summary": "Privacy-filtered RGB-D observation Cell with locally verifiable identity.",
        })),
    )?;
    let observation_proof_report = verify_bundle(&observation_proof)?;
    let sdf_proof = prove_cell(
        report.sdf_manifest.clone(),
        Some(serde_json::json!({
            "claim_state": "DERIVED_FROM_VERIFIED_BYTES",
            "schema": "slbit/viz-packet/v3",
            "summary": "Sparse SDF derived from the privacy-filtered observation Cell.",
        })),
    )?;
    let sdf_proof_report = verify_bundle(&sdf_proof)?;
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
    ])?;
    let lineage_report = verify_lineage_bundle(&lineage)?;
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
    verify_artifact_provenance(&artifact)?;
    write_atomic(output, &serde_json::to_vec(&artifact)?)?;
    println!(
        "reconstructed {} public surfels / {} sparse SDF voxels -> {}",
        artifact.verification.verified_surfels,
        artifact.verification.verified_voxels,
        output.display()
    );
    Ok(())
}

fn verify_artifact_provenance(
    artifact: &ReconstructionArtifactV0,
) -> Result<(), Box<dyn std::error::Error>> {
    if artifact.observation_proof.cell_id != artifact.report.observation.cell_id
        || artifact.sdf_proof.cell_id != artifact.report.sdf_cell_id
    {
        return Err("Power House proof bundle does not bind reconstruction Cells".into());
    }
    if verify_bundle(&artifact.observation_proof)? != artifact.observation_proof_report
        || verify_bundle(&artifact.sdf_proof)? != artifact.sdf_proof_report
        || verify_lineage_bundle(&artifact.lineage)? != artifact.lineage_report
    {
        return Err("stored Power House verification report mismatch".into());
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
            .challenge_all(power_house::MemoryVerificationPolicy::strict())?;
        if challenge.mismatches != 0 || challenge.expected_rejections != challenge.total {
            return Err("Power House Memory Capsule challenge mismatch".into());
        }
    }
    Ok(())
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
