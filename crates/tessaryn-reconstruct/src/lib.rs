//! Deterministic fixed-point RGB-D reconstruction and sparse SDF fusion.

#![forbid(unsafe_code)]

use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use tessaryn_canonical::{cell_id, chunk_id, chunk_merkle_root};
use tessaryn_forge::{
    decode_surfel_chunk, forge_surfel_cell, verify_forge_report, CapturePolicy, CaptureSession,
    ForgeError, ForgeReport, SurfelSample,
};
use tessaryn_schema::{
    CellClass, CellManifestV0, ChannelDescriptor, Criticality, Digest, EvidenceDeclaration,
    TemporalStateKind, TransformRecord, CELL_SCHEMA_V0,
};
use thiserror::Error;

const RGBD_SCHEMA_V0: &str = "tessaryn/rgbd-session/v0";
const SDF_MAGIC: &[u8] = b"TESSARYN-SDF-v0\0";
const Q20: i128 = 1_i128 << 20;
const Q30: i128 = 1_i128 << 30;
const MAX_FRAMES: usize = 2_048;
const MAX_PIXELS_PER_FRAME: usize = 16_777_216;
const MAX_SESSION_PIXELS: usize = 64_000_000;
const MAX_OUTPUT_SURFELS: usize = 1_000_000;
const MAX_SDF_VOXELS: usize = 2_000_000;
const SDF_VOXEL_BYTES: usize = 20;

/// Integer camera calibration for one depth/color frame profile.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RgbdCalibrationV0 {
    /// Frame width in pixels.
    pub width: u32,
    /// Frame height in pixels.
    pub height: u32,
    /// Horizontal focal length in Q20 pixels.
    pub fx_q20: u64,
    /// Vertical focal length in Q20 pixels.
    pub fy_q20: u64,
    /// Horizontal principal point in Q20 pixels.
    pub cx_q20: i64,
    /// Vertical principal point in Q20 pixels.
    pub cy_q20: i64,
    /// Minimum admitted depth in millimeters.
    pub min_depth_mm: u16,
    /// Maximum admitted depth in millimeters.
    pub max_depth_mm: u16,
}

/// Fixed-point camera-to-Anchor pose.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RigidPoseQ30 {
    /// Camera origin in Anchor-local micrometers.
    pub translation_um: [i64; 3],
    /// Unit quaternion x/y/z/w in Q30.
    pub rotation_q30: [i32; 4],
}

/// One bounded RGB-D frame.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RgbdFrameV0 {
    /// Content address supplied by the capture adapter.
    pub frame_id: Digest,
    /// Capture time in Unix microseconds.
    pub captured_at_unix_us: i64,
    /// Camera calibration.
    pub calibration: RgbdCalibrationV0,
    /// Camera-to-Anchor pose.
    pub pose: RigidPoseQ30,
    /// Row-major depth samples in millimeters; zero means unavailable.
    pub depth_mm: Vec<u16>,
    /// Row-major RGBA samples aligned to depth.
    pub color_rgba: Vec<[u8; 4]>,
    /// Optional row-major privacy mask; one removes a pixel before deprojection.
    #[serde(default, with = "tessaryn_transport::bytes_base64")]
    pub privacy_mask: Vec<u8>,
}

/// Calculates the canonical content identity of one RGB-D frame.
pub fn rgbd_frame_id(frame: &RgbdFrameV0) -> Result<Digest, ReconstructionError> {
    let metadata = serde_json::to_vec(&serde_json::json!({
        "calibration": &frame.calibration,
        "captured_at_unix_us": frame.captured_at_unix_us,
        "pose": &frame.pose,
    }))?;
    let mut hasher = Sha256::new();
    update_hash_part(&mut hasher, b"TESSARYN-RGBD-FRAME-v0");
    update_hash_part(&mut hasher, &metadata);
    hasher.update((frame.depth_mm.len() as u64).to_be_bytes());
    for depth in &frame.depth_mm {
        hasher.update(depth.to_le_bytes());
    }
    hasher.update((frame.color_rgba.len() as u64).to_be_bytes());
    for color in &frame.color_rgba {
        hasher.update(color);
    }
    hasher.update((frame.privacy_mask.len() as u64).to_be_bytes());
    hasher.update(&frame.privacy_mask);
    Digest::new(format!("sha256:{}", hex::encode(hasher.finalize())))
        .map_err(|_| ReconstructionError::FrameIdentityMismatch)
}

fn update_hash_part(hasher: &mut Sha256, part: &[u8]) {
    hasher.update((part.len() as u64).to_be_bytes());
    hasher.update(part);
}

/// Portable input from one RGB-D capture session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RgbdSessionV0 {
    /// Must equal `tessaryn/rgbd-session/v0`.
    pub schema: String,
    /// Device- or operator-declared session identity.
    pub declared_session_id: Digest,
    /// Anchor receiving reconstructed samples.
    pub anchor_id: Digest,
    /// Stable capture clock identifier.
    pub clock_source: String,
    /// Capture producer and device profile.
    pub producer: String,
    /// Optional device signing-key fingerprint.
    pub device_key: Option<Digest>,
    /// Frames; canonical reconstruction sorts by time and frame ID.
    pub frames: Vec<RgbdFrameV0>,
}

/// Bounded reconstruction controls.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReconstructionPolicy {
    /// Pixel sampling stride.
    pub pixel_stride: u16,
    /// Published surfel radius in micrometers.
    pub surfel_radius_um: u32,
    /// Sparse SDF voxel edge length in micrometers.
    pub voxel_size_um: u32,
    /// SDF truncation distance in micrometers.
    pub truncation_um: u32,
}

/// One canonical sparse SDF voxel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SdfVoxel {
    /// Integer voxel coordinate.
    pub coordinate: [i32; 3],
    /// Signed distance in micrometers.
    pub signed_distance_um: i32,
    /// Accumulated confidence weight.
    pub weight: u32,
}

/// Output of deterministic RGB-D reconstruction.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReconstructionReport {
    /// Commitment to canonicalized raw session input; raw frames are omitted.
    pub capture_commitment: Digest,
    /// Privacy-filtered observation Cell and surfel chunk.
    pub observation: ForgeReport,
    /// Derived sparse SDF Cell.
    pub sdf_manifest: CellManifestV0,
    /// Derived sparse SDF Cell identity.
    pub sdf_cell_id: Digest,
    /// Sparse SDF chunk identity.
    pub sdf_chunk_id: Digest,
    /// Sparse SDF bytes.
    #[serde(with = "tessaryn_transport::bytes_base64")]
    pub sdf_chunk: Vec<u8>,
    /// Number of valid depth samples admitted before privacy filtering.
    pub admitted_depth_samples: u64,
    /// Number of otherwise valid depth pixels removed by the frame privacy mask.
    pub masked_depth_samples: u64,
    /// Number of fused public voxels.
    pub fused_voxels: u64,
    /// Report identity over public outputs and reconstruction parameters.
    pub report_id: Digest,
    /// Raw frame bytes are never embedded.
    pub raw_frames_embedded: bool,
}

/// Independent verification result for public reconstruction outputs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReconstructionVerificationReport {
    /// Observation Cell identity and surfel chunk matched.
    pub observation_valid: bool,
    /// Derived SDF Cell identity, parent binding, and chunk matched.
    pub sdf_valid: bool,
    /// Public report identity and counters matched.
    pub report_valid: bool,
    /// Raw frame bytes were absent from the public report.
    pub raw_frames_absent: bool,
    /// Number of verified public surfels.
    pub verified_surfels: u64,
    /// Number of verified sparse SDF voxels.
    pub verified_voxels: u64,
}

/// Reconstructs one RGB-D session into observation and derived SDF Cells.
pub fn reconstruct_rgbd_session(
    mut session: RgbdSessionV0,
    capture_policy: CapturePolicy,
    reconstruction: ReconstructionPolicy,
) -> Result<ReconstructionReport, ReconstructionError> {
    validate_reconstruction_policy(&reconstruction)?;
    validate_session(&session)?;
    session.frames.sort_by(|left, right| {
        (left.captured_at_unix_us, &left.frame_id)
            .cmp(&(right.captured_at_unix_us, &right.frame_id))
    });
    let capture_commitment = chunk_id(&serde_json::to_vec(&session)?);
    let mut samples = Vec::new();
    let mut admitted_depth_samples = 0_u64;
    let mut masked_depth_samples = 0_u64;
    for frame in &session.frames {
        append_frame_samples(
            frame,
            &reconstruction,
            &mut samples,
            &mut admitted_depth_samples,
            &mut masked_depth_samples,
        )?;
    }
    if samples.is_empty() {
        return Err(ReconstructionError::NoValidDepth);
    }
    let captured_at_unix_us = session.frames[0].captured_at_unix_us;
    let captured_until_unix_us = session
        .frames
        .last()
        .map(|frame| frame.captured_at_unix_us)
        .ok_or(ReconstructionError::EmptySession)?;
    let observation = forge_surfel_cell(
        CaptureSession {
            session_id: capture_commitment.clone(),
            anchor_id: session.anchor_id,
            captured_at_unix_us,
            captured_until_unix_us: Some(captured_until_unix_us),
            clock_source: session.clock_source,
            producer: session.producer,
            device_key: session.device_key,
            samples,
        },
        capture_policy,
    )?;
    let public_samples = decode_surfel_chunk(&observation.public_chunk)?;
    let voxels = fuse_sparse_sdf(&public_samples, &reconstruction)?;
    let sdf_chunk = encode_sdf_chunk(reconstruction.voxel_size_um, &voxels)?;
    let sdf_chunk_id = chunk_id(&sdf_chunk);
    let sdf_root = chunk_merkle_root(std::slice::from_ref(&sdf_chunk_id));
    let transform_id = chunk_id(&serde_json::to_vec(&serde_json::json!({
        "capture_commitment": &capture_commitment,
        "observation_cell": &observation.cell_id,
        "policy": &reconstruction,
        "sdf_chunk": &sdf_chunk_id,
    }))?);
    let mut temporal_extent = observation.manifest.temporal_extent.clone();
    temporal_extent.state_kind = TemporalStateKind::Derived;
    let sdf_manifest = CellManifestV0 {
        schema: CELL_SCHEMA_V0.to_string(),
        class: CellClass::Derived,
        anchor_id: observation.manifest.anchor_id.clone(),
        spatial_extent: observation.manifest.spatial_extent.clone(),
        temporal_extent,
        channels: vec![ChannelDescriptor {
            role: "geometry/sdf".to_string(),
            codec: "tessaryn/sparse-sdf-le".to_string(),
            codec_version: "0".to_string(),
            chunk_root: sdf_root.clone(),
            uncompressed_bytes: sdf_chunk.len() as u64,
            quality_tier: 1,
            criticality: Criticality::Critical,
            license: observation
                .manifest
                .channels
                .first()
                .map(|channel| channel.license.clone())
                .ok_or(ReconstructionError::MissingObservationChannel)?,
        }],
        parents: vec![observation.cell_id.clone()],
        source_records: observation.manifest.source_records.clone(),
        transform_records: vec![TransformRecord {
            transform_id,
            method: "tessaryn/sparse-sdf-fusion-v0".to_string(),
            tool: "tessaryn-reconstruct".to_string(),
            tool_version: env!("CARGO_PKG_VERSION").to_string(),
            input_ids: vec![observation.cell_id.clone(), capture_commitment.clone()],
        }],
        policy_root: observation.manifest.policy_root.clone(),
        evidence: EvidenceDeclaration {
            identity_committed: true,
            replay_available: true,
            source_attributed: true,
            disputed: false,
            semantic_only: false,
            restricted: observation.manifest.evidence.restricted,
        },
        chunk_merkle_root: sdf_root,
    };
    let sdf_cell_id = cell_id(&sdf_manifest)?;
    let report_id = reconstruction_report_id(&ReconstructionReportIdentity {
        capture_commitment: &capture_commitment,
        observation_cell_id: &observation.cell_id,
        sdf_cell_id: &sdf_cell_id,
        sdf_chunk_id: &sdf_chunk_id,
        admitted_depth_samples,
        masked_depth_samples,
        fused_voxels: voxels.len() as u64,
        reconstruction: &reconstruction,
        raw_frames_embedded: false,
    })?;
    Ok(ReconstructionReport {
        capture_commitment,
        observation,
        sdf_manifest,
        sdf_cell_id,
        sdf_chunk_id,
        sdf_chunk,
        admitted_depth_samples,
        masked_depth_samples,
        fused_voxels: voxels.len() as u64,
        report_id,
        raw_frames_embedded: false,
    })
}

/// Re-verifies all public reconstruction bytes without access to raw frames.
pub fn verify_reconstruction_report(
    report: &ReconstructionReport,
    reconstruction: &ReconstructionPolicy,
) -> Result<ReconstructionVerificationReport, ReconstructionError> {
    validate_reconstruction_policy(reconstruction)?;
    if report.raw_frames_embedded || report.observation.raw_embedded {
        return Err(ReconstructionError::RawFrameDisclosure);
    }
    let forge_verification = verify_forge_report(&report.observation)?;
    let surfels = decode_surfel_chunk(&report.observation.public_chunk)?;
    let observation_valid = forge_verification.chunk_valid
        && forge_verification.cell_valid
        && forge_verification.report_valid;

    let (voxel_size_um, voxels) = decode_sdf_chunk(&report.sdf_chunk)?;
    let sdf_chunk_id = chunk_id(&report.sdf_chunk);
    let sdf_root = chunk_merkle_root(std::slice::from_ref(&sdf_chunk_id));
    let sdf_valid = voxel_size_um == reconstruction.voxel_size_um
        && sdf_chunk_id == report.sdf_chunk_id
        && sdf_root == report.sdf_manifest.chunk_merkle_root
        && cell_id(&report.sdf_manifest)? == report.sdf_cell_id
        && report.sdf_manifest.parents == vec![report.observation.cell_id.clone()]
        && voxels.len() as u64 == report.fused_voxels;
    if !sdf_valid {
        return Err(ReconstructionError::SdfMismatch);
    }
    let expected_report_id = reconstruction_report_id(&ReconstructionReportIdentity {
        capture_commitment: &report.capture_commitment,
        observation_cell_id: &report.observation.cell_id,
        sdf_cell_id: &report.sdf_cell_id,
        sdf_chunk_id: &report.sdf_chunk_id,
        admitted_depth_samples: report.admitted_depth_samples,
        masked_depth_samples: report.masked_depth_samples,
        fused_voxels: report.fused_voxels,
        reconstruction,
        raw_frames_embedded: false,
    })?;
    if expected_report_id != report.report_id {
        return Err(ReconstructionError::ReportMismatch);
    }
    Ok(ReconstructionVerificationReport {
        observation_valid,
        sdf_valid,
        report_valid: true,
        raw_frames_absent: true,
        verified_surfels: surfels.len() as u64,
        verified_voxels: voxels.len() as u64,
    })
}

struct ReconstructionReportIdentity<'a> {
    capture_commitment: &'a Digest,
    observation_cell_id: &'a Digest,
    sdf_cell_id: &'a Digest,
    sdf_chunk_id: &'a Digest,
    admitted_depth_samples: u64,
    masked_depth_samples: u64,
    fused_voxels: u64,
    reconstruction: &'a ReconstructionPolicy,
    raw_frames_embedded: bool,
}

fn reconstruction_report_id(
    identity: &ReconstructionReportIdentity<'_>,
) -> Result<Digest, ReconstructionError> {
    Ok(chunk_id(&serde_json::to_vec(&serde_json::json!({
        "admitted_depth_samples": identity.admitted_depth_samples,
        "capture_commitment": identity.capture_commitment,
        "fused_voxels": identity.fused_voxels,
        "masked_depth_samples": identity.masked_depth_samples,
        "observation_cell": identity.observation_cell_id,
        "raw_frames_embedded": identity.raw_frames_embedded,
        "reconstruction": identity.reconstruction,
        "sdf_cell": identity.sdf_cell_id,
        "sdf_chunk": identity.sdf_chunk_id,
    }))?))
}

/// Decodes one bounded sparse SDF chunk.
pub fn decode_sdf_chunk(bytes: &[u8]) -> Result<(u32, Vec<SdfVoxel>), ReconstructionError> {
    let header = SDF_MAGIC.len() + 8;
    if bytes.len() < header || !bytes.starts_with(SDF_MAGIC) {
        return Err(ReconstructionError::MalformedSdf);
    }
    let voxel_size_um = u32::from_le_bytes(
        bytes[SDF_MAGIC.len()..SDF_MAGIC.len() + 4]
            .try_into()
            .map_err(|_| ReconstructionError::MalformedSdf)?,
    );
    let count = u32::from_le_bytes(
        bytes[SDF_MAGIC.len() + 4..header]
            .try_into()
            .map_err(|_| ReconstructionError::MalformedSdf)?,
    ) as usize;
    let expected = header
        .checked_add(
            count
                .checked_mul(SDF_VOXEL_BYTES)
                .ok_or(ReconstructionError::MalformedSdf)?,
        )
        .ok_or(ReconstructionError::MalformedSdf)?;
    if count > MAX_SDF_VOXELS || bytes.len() != expected || voxel_size_um == 0 {
        return Err(ReconstructionError::MalformedSdf);
    }
    let mut cursor = header;
    let mut voxels = Vec::with_capacity(count);
    for _ in 0..count {
        let coordinate = [
            read_i32(bytes, &mut cursor)?,
            read_i32(bytes, &mut cursor)?,
            read_i32(bytes, &mut cursor)?,
        ];
        let signed_distance_um = read_i32(bytes, &mut cursor)?;
        let weight = read_u32(bytes, &mut cursor)?;
        if weight == 0 {
            return Err(ReconstructionError::MalformedSdf);
        }
        voxels.push(SdfVoxel {
            coordinate,
            signed_distance_um,
            weight,
        });
    }
    if !voxels
        .windows(2)
        .all(|pair| pair[0].coordinate < pair[1].coordinate)
    {
        return Err(ReconstructionError::MalformedSdf);
    }
    Ok((voxel_size_um, voxels))
}

fn validate_session(session: &RgbdSessionV0) -> Result<(), ReconstructionError> {
    if session.schema != RGBD_SCHEMA_V0 {
        return Err(ReconstructionError::UnsupportedSchema);
    }
    if session.frames.is_empty() {
        return Err(ReconstructionError::EmptySession);
    }
    if session.frames.len() > MAX_FRAMES {
        return Err(ReconstructionError::FrameLimit);
    }
    if session.clock_source.trim().is_empty()
        || session.clock_source.len() > 256
        || session.producer.trim().is_empty()
        || session.producer.len() > 256
    {
        return Err(ReconstructionError::InvalidSession);
    }
    let mut total_pixels = 0_usize;
    let mut ids = BTreeSet::new();
    for frame in &session.frames {
        validate_frame(frame)?;
        total_pixels = total_pixels
            .checked_add(frame.depth_mm.len())
            .ok_or(ReconstructionError::PixelLimit)?;
        if total_pixels > MAX_SESSION_PIXELS {
            return Err(ReconstructionError::PixelLimit);
        }
        if !ids.insert(frame.frame_id.clone()) {
            return Err(ReconstructionError::DuplicateFrame);
        }
    }
    Ok(())
}

fn validate_frame(frame: &RgbdFrameV0) -> Result<(), ReconstructionError> {
    let calibration = &frame.calibration;
    let pixels = usize::try_from(calibration.width)
        .ok()
        .and_then(|width| {
            usize::try_from(calibration.height)
                .ok()
                .and_then(|height| width.checked_mul(height))
        })
        .ok_or(ReconstructionError::InvalidCalibration)?;
    if calibration.width < 2
        || calibration.height < 2
        || pixels > MAX_PIXELS_PER_FRAME
        || calibration.fx_q20 == 0
        || calibration.fy_q20 == 0
        || calibration.min_depth_mm == 0
        || calibration.min_depth_mm > calibration.max_depth_mm
        || frame.depth_mm.len() != pixels
        || frame.color_rgba.len() != pixels
        || (!frame.privacy_mask.is_empty() && frame.privacy_mask.len() != pixels)
        || frame.privacy_mask.iter().any(|value| *value > 1)
    {
        return Err(ReconstructionError::InvalidCalibration);
    }
    validate_q30(frame.pose.rotation_q30)?;
    if rgbd_frame_id(frame)? != frame.frame_id {
        return Err(ReconstructionError::FrameIdentityMismatch);
    }
    Ok(())
}

fn validate_reconstruction_policy(
    policy: &ReconstructionPolicy,
) -> Result<(), ReconstructionError> {
    if policy.pixel_stride == 0
        || policy.pixel_stride > 64
        || policy.surfel_radius_um == 0
        || policy.voxel_size_um == 0
        || policy.truncation_um < policy.voxel_size_um
        || policy.truncation_um > policy.voxel_size_um.saturating_mul(32)
    {
        return Err(ReconstructionError::InvalidPolicy);
    }
    Ok(())
}

fn append_frame_samples(
    frame: &RgbdFrameV0,
    policy: &ReconstructionPolicy,
    output: &mut Vec<SurfelSample>,
    admitted_depth_samples: &mut u64,
    masked_depth_samples: &mut u64,
) -> Result<(), ReconstructionError> {
    let width = frame.calibration.width as usize;
    let height = frame.calibration.height as usize;
    let stride = policy.pixel_stride as usize;
    for row in (0..height - 1).step_by(stride) {
        for column in (0..width - 1).step_by(stride) {
            let index = row * width + column;
            let depth = frame.depth_mm[index];
            if !depth_is_admitted(depth, &frame.calibration) {
                continue;
            }
            *admitted_depth_samples = admitted_depth_samples
                .checked_add(1)
                .ok_or(ReconstructionError::PixelLimit)?;
            if frame
                .privacy_mask
                .get(index)
                .is_some_and(|value| *value == 1)
            {
                *masked_depth_samples = masked_depth_samples
                    .checked_add(1)
                    .ok_or(ReconstructionError::PixelLimit)?;
                continue;
            }
            if output.len() >= MAX_OUTPUT_SURFELS {
                return Err(ReconstructionError::SurfelLimit);
            }
            let normal_q15 = frame_normal(frame, column, row)
                .or_else(|| fallback_frame_normal(frame))
                .ok_or(ReconstructionError::InvalidPose)?;
            output.push(SurfelSample {
                position_um: deproject(frame, column, row, depth)?,
                normal_q15,
                color_rgba: frame.color_rgba[index],
                radius_um: policy.surfel_radius_um,
                confidence_basis_points: 9_500,
            });
        }
    }
    Ok(())
}

fn fallback_frame_normal(frame: &RgbdFrameV0) -> Option<[i16; 3]> {
    let rotated = rotate_q30([0, 0, 32_767], frame.pose.rotation_q30).ok()?;
    normalize_q15(rotated.map(i128::from))
}

fn frame_normal(frame: &RgbdFrameV0, column: usize, row: usize) -> Option<[i16; 3]> {
    let width = frame.calibration.width as usize;
    let center_index = row * width + column;
    let right_index = center_index + 1;
    let down_index = (row + 1) * width + column;
    if pixel_masked(frame, center_index)
        || pixel_masked(frame, right_index)
        || pixel_masked(frame, down_index)
    {
        return None;
    }
    let center_depth = frame.depth_mm[center_index];
    let right_depth = frame.depth_mm[right_index];
    let down_depth = frame.depth_mm[down_index];
    if !depth_is_admitted(center_depth, &frame.calibration)
        || !depth_is_admitted(right_depth, &frame.calibration)
        || !depth_is_admitted(down_depth, &frame.calibration)
    {
        return None;
    }
    let center = deproject(frame, column, row, center_depth).ok()?;
    let right = deproject(frame, column + 1, row, right_depth).ok()?;
    let down = deproject(frame, column, row + 1, down_depth).ok()?;
    normalize_q15(cross(subtract(right, center)?, subtract(down, center)?)?)
}

fn pixel_masked(frame: &RgbdFrameV0, index: usize) -> bool {
    frame
        .privacy_mask
        .get(index)
        .is_some_and(|value| *value == 1)
}

fn deproject(
    frame: &RgbdFrameV0,
    column: usize,
    row: usize,
    depth_mm: u16,
) -> Result<[i64; 3], ReconstructionError> {
    let calibration = &frame.calibration;
    let depth_um = i128::from(depth_mm) * 1_000;
    let x = ((column as i128 * Q20 - i128::from(calibration.cx_q20)) * depth_um)
        / i128::from(calibration.fx_q20);
    let y = ((row as i128 * Q20 - i128::from(calibration.cy_q20)) * depth_um)
        / i128::from(calibration.fy_q20);
    let camera = [to_i64(x)?, to_i64(y)?, to_i64(depth_um)?];
    let rotated = rotate_q30(camera, frame.pose.rotation_q30)?;
    let mut world = [0_i64; 3];
    for axis in 0..3 {
        world[axis] = rotated[axis]
            .checked_add(frame.pose.translation_um[axis])
            .ok_or(ReconstructionError::CoordinateOverflow)?;
    }
    Ok(world)
}

fn rotate_q30(vector: [i64; 3], quaternion: [i32; 4]) -> Result<[i64; 3], ReconstructionError> {
    let q = quaternion.map(i128::from);
    let v = vector.map(i128::from);
    let first_cross = cross_i128([q[0], q[1], q[2]], v)?;
    let t = first_cross.map(|value| value * 2 / Q30);
    let second_cross = cross_i128([q[0], q[1], q[2]], t)?;
    let mut output = [0_i64; 3];
    for axis in 0..3 {
        output[axis] = to_i64(v[axis] + q[3] * t[axis] / Q30 + second_cross[axis] / Q30)?;
    }
    Ok(output)
}

fn fuse_sparse_sdf(
    samples: &[SurfelSample],
    policy: &ReconstructionPolicy,
) -> Result<Vec<SdfVoxel>, ReconstructionError> {
    let mut accumulators = BTreeMap::<[i32; 3], (i128, u64)>::new();
    let step = i64::from(policy.voxel_size_um);
    let truncation = i64::from(policy.truncation_um);
    for sample in samples {
        let mut offset = -truncation;
        while offset <= truncation {
            let mut point = [0_i64; 3];
            for (axis, coordinate) in point.iter_mut().enumerate() {
                let displacement = i64::from(sample.normal_q15[axis])
                    .checked_mul(offset)
                    .ok_or(ReconstructionError::CoordinateOverflow)?
                    / 32_767;
                *coordinate = sample.position_um[axis]
                    .checked_add(displacement)
                    .ok_or(ReconstructionError::CoordinateOverflow)?;
            }
            let coordinate = [
                i32::try_from(point[0].div_euclid(step))
                    .map_err(|_| ReconstructionError::CoordinateOverflow)?,
                i32::try_from(point[1].div_euclid(step))
                    .map_err(|_| ReconstructionError::CoordinateOverflow)?,
                i32::try_from(point[2].div_euclid(step))
                    .map_err(|_| ReconstructionError::CoordinateOverflow)?,
            ];
            let weight = u64::from(sample.confidence_basis_points.max(1));
            let entry = accumulators.entry(coordinate).or_default();
            entry.0 = entry
                .0
                .checked_add(i128::from(offset) * i128::from(weight))
                .ok_or(ReconstructionError::CoordinateOverflow)?;
            entry.1 = entry
                .1
                .checked_add(weight)
                .ok_or(ReconstructionError::CoordinateOverflow)?;
            if accumulators.len() > MAX_SDF_VOXELS {
                return Err(ReconstructionError::VoxelLimit);
            }
            offset = offset
                .checked_add(step)
                .ok_or(ReconstructionError::CoordinateOverflow)?;
        }
    }
    accumulators
        .into_iter()
        .map(|(coordinate, (weighted_distance, weight))| {
            Ok(SdfVoxel {
                coordinate,
                signed_distance_um: i32::try_from(weighted_distance / i128::from(weight))
                    .map_err(|_| ReconstructionError::CoordinateOverflow)?,
                weight: u32::try_from(weight).unwrap_or(u32::MAX),
            })
        })
        .collect()
}

fn encode_sdf_chunk(
    voxel_size_um: u32,
    voxels: &[SdfVoxel],
) -> Result<Vec<u8>, ReconstructionError> {
    if voxels.is_empty() || voxels.len() > MAX_SDF_VOXELS {
        return Err(ReconstructionError::VoxelLimit);
    }
    let count = u32::try_from(voxels.len()).map_err(|_| ReconstructionError::VoxelLimit)?;
    let mut bytes = Vec::with_capacity(SDF_MAGIC.len() + 8 + voxels.len() * SDF_VOXEL_BYTES);
    bytes.extend_from_slice(SDF_MAGIC);
    bytes.extend_from_slice(&voxel_size_um.to_le_bytes());
    bytes.extend_from_slice(&count.to_le_bytes());
    for voxel in voxels {
        for coordinate in voxel.coordinate {
            bytes.extend_from_slice(&coordinate.to_le_bytes());
        }
        bytes.extend_from_slice(&voxel.signed_distance_um.to_le_bytes());
        bytes.extend_from_slice(&voxel.weight.to_le_bytes());
    }
    Ok(bytes)
}

fn validate_q30(quaternion: [i32; 4]) -> Result<(), ReconstructionError> {
    let expected = Q30 * Q30;
    let norm = quaternion
        .into_iter()
        .map(|value| i128::from(value) * i128::from(value))
        .sum::<i128>();
    if (norm - expected).abs() > expected / 500 {
        return Err(ReconstructionError::InvalidPose);
    }
    Ok(())
}

fn depth_is_admitted(depth: u16, calibration: &RgbdCalibrationV0) -> bool {
    depth >= calibration.min_depth_mm && depth <= calibration.max_depth_mm
}

fn subtract(left: [i64; 3], right: [i64; 3]) -> Option<[i64; 3]> {
    Some([
        left[0].checked_sub(right[0])?,
        left[1].checked_sub(right[1])?,
        left[2].checked_sub(right[2])?,
    ])
}

fn cross(left: [i64; 3], right: [i64; 3]) -> Option<[i128; 3]> {
    cross_i128(left.map(i128::from), right.map(i128::from)).ok()
}

fn cross_i128(left: [i128; 3], right: [i128; 3]) -> Result<[i128; 3], ReconstructionError> {
    Ok([
        left[1]
            .checked_mul(right[2])
            .and_then(|value| value.checked_sub(left[2].checked_mul(right[1])?))
            .ok_or(ReconstructionError::CoordinateOverflow)?,
        left[2]
            .checked_mul(right[0])
            .and_then(|value| value.checked_sub(left[0].checked_mul(right[2])?))
            .ok_or(ReconstructionError::CoordinateOverflow)?,
        left[0]
            .checked_mul(right[1])
            .and_then(|value| value.checked_sub(left[1].checked_mul(right[0])?))
            .ok_or(ReconstructionError::CoordinateOverflow)?,
    ])
}

fn normalize_q15(vector: [i128; 3]) -> Option<[i16; 3]> {
    let squared = vector.into_iter().try_fold(0_u128, |sum, value| {
        sum.checked_add(value.unsigned_abs().checked_mul(value.unsigned_abs())?)
    })?;
    let norm = integer_sqrt(squared);
    if norm == 0 {
        return None;
    }
    let mut output = [0_i16; 3];
    for axis in 0..3 {
        let value = vector[axis]
            .checked_mul(32_767)?
            .checked_div(norm as i128)?;
        output[axis] = i16::try_from(value.clamp(-32_767, 32_767)).ok()?;
    }
    Some(output)
}

fn integer_sqrt(value: u128) -> u128 {
    if value < 2 {
        return value;
    }
    let mut low = 1_u128;
    let mut high = value.min(u128::from(u64::MAX));
    while low <= high {
        let middle = low + (high - low) / 2;
        if middle <= value / middle {
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }
    high
}

fn to_i64(value: i128) -> Result<i64, ReconstructionError> {
    i64::try_from(value).map_err(|_| ReconstructionError::CoordinateOverflow)
}

fn read_i32(bytes: &[u8], cursor: &mut usize) -> Result<i32, ReconstructionError> {
    let end = cursor
        .checked_add(4)
        .ok_or(ReconstructionError::MalformedSdf)?;
    let value = i32::from_le_bytes(
        bytes
            .get(*cursor..end)
            .ok_or(ReconstructionError::MalformedSdf)?
            .try_into()
            .map_err(|_| ReconstructionError::MalformedSdf)?,
    );
    *cursor = end;
    Ok(value)
}

fn read_u32(bytes: &[u8], cursor: &mut usize) -> Result<u32, ReconstructionError> {
    let end = cursor
        .checked_add(4)
        .ok_or(ReconstructionError::MalformedSdf)?;
    let value = u32::from_le_bytes(
        bytes
            .get(*cursor..end)
            .ok_or(ReconstructionError::MalformedSdf)?
            .try_into()
            .map_err(|_| ReconstructionError::MalformedSdf)?,
    );
    *cursor = end;
    Ok(value)
}

/// RGB-D reconstruction rejection.
#[derive(Debug, Error)]
pub enum ReconstructionError {
    /// Input schema is unsupported.
    #[error("unsupported RGB-D session schema")]
    UnsupportedSchema,
    /// Session contained no frames.
    #[error("RGB-D session contains no frames")]
    EmptySession,
    /// Session metadata was malformed.
    #[error("invalid RGB-D session metadata")]
    InvalidSession,
    /// Frame count exceeded the profile.
    #[error("RGB-D frame limit exceeded")]
    FrameLimit,
    /// Pixel count exceeded the profile.
    #[error("RGB-D pixel limit exceeded")]
    PixelLimit,
    /// Output sample count exceeded the profile.
    #[error("reconstructed surfel limit exceeded")]
    SurfelLimit,
    /// Frame IDs must be unique.
    #[error("duplicate RGB-D frame identity")]
    DuplicateFrame,
    /// Frame bytes or metadata did not match the declared frame identity.
    #[error("RGB-D frame content identity mismatch")]
    FrameIdentityMismatch,
    /// Calibration or frame buffers were malformed.
    #[error("invalid RGB-D calibration or frame dimensions")]
    InvalidCalibration,
    /// Pose was not a Q30 unit quaternion.
    #[error("invalid RGB-D frame pose")]
    InvalidPose,
    /// Reconstruction controls were malformed.
    #[error("invalid reconstruction policy")]
    InvalidPolicy,
    /// No admitted depth remained.
    #[error("RGB-D session contains no admitted depth")]
    NoValidDepth,
    /// Sparse SDF capacity was exceeded.
    #[error("sparse SDF voxel limit exceeded")]
    VoxelLimit,
    /// Sparse SDF bytes were malformed.
    #[error("malformed sparse SDF chunk")]
    MalformedSdf,
    /// Fixed-point arithmetic overflowed.
    #[error("fixed-point coordinate overflow")]
    CoordinateOverflow,
    /// Observation output unexpectedly omitted its channel.
    #[error("observation Cell contains no channel")]
    MissingObservationChannel,
    /// Public output unexpectedly contained raw frame bytes.
    #[error("public reconstruction report disclosed raw frame bytes")]
    RawFrameDisclosure,
    /// Observation Cell, chunk, or counters did not match.
    #[error("reconstructed observation output mismatch")]
    ObservationMismatch,
    /// Derived SDF Cell, chunk, parent, or counters did not match.
    #[error("reconstructed SDF output mismatch")]
    SdfMismatch,
    /// Reconstruction report identity did not match its public fields.
    #[error("reconstruction report identity mismatch")]
    ReportMismatch,
    /// Forge rejected capture or privacy policy.
    #[error(transparent)]
    Forge(#[from] ForgeError),
    /// JSON projection failed.
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    /// Canonical identity failed.
    #[error(transparent)]
    Canonical(#[from] tessaryn_canonical::CanonicalError),
}

#[cfg(test)]
mod tests {
    use super::*;
    use tessaryn_forge::ExclusionVolume;

    fn digest(value: u8) -> Digest {
        Digest::new(format!("sha256:{}", format!("{value:02x}").repeat(32))).unwrap()
    }

    fn frame(id: u8, time: i64, depth: u16) -> RgbdFrameV0 {
        let mut frame = RgbdFrameV0 {
            frame_id: digest(id),
            captured_at_unix_us: time,
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
                translation_um: [i64::from(id) * 1_000, 0, 0],
                rotation_q30: [0, 0, 0, 1 << 30],
            },
            depth_mm: vec![depth; 16],
            color_rgba: vec![[id, 40, 60, 255]; 16],
            privacy_mask: Vec::new(),
        };
        frame.frame_id = rgbd_frame_id(&frame).unwrap();
        frame
    }

    fn session(frames: Vec<RgbdFrameV0>) -> RgbdSessionV0 {
        RgbdSessionV0 {
            schema: RGBD_SCHEMA_V0.to_string(),
            declared_session_id: digest(90),
            anchor_id: digest(91),
            clock_source: "rgbd/test-clock-v0".to_string(),
            producer: "rgbd-test-device".to_string(),
            device_key: Some(digest(92)),
            frames,
        }
    }

    fn capture_policy() -> CapturePolicy {
        CapturePolicy {
            operator_confirmed: true,
            visible_recording: true,
            local_processing: true,
            publication_allowed: true,
            retain_raw: false,
            exclusions: Vec::new(),
            derivative_license: "CC0-1.0".to_string(),
        }
    }

    fn reconstruction_policy() -> ReconstructionPolicy {
        ReconstructionPolicy {
            pixel_stride: 1,
            surfel_radius_um: 5_000,
            voxel_size_um: 20_000,
            truncation_um: 40_000,
        }
    }

    #[test]
    fn frame_order_produces_one_reconstruction_identity() {
        let first = frame(1, 100, 1_000);
        let second = frame(2, 200, 1_100);
        let left = reconstruct_rgbd_session(
            session(vec![first.clone(), second.clone()]),
            capture_policy(),
            reconstruction_policy(),
        )
        .unwrap();
        let right = reconstruct_rgbd_session(
            session(vec![second, first]),
            capture_policy(),
            reconstruction_policy(),
        )
        .unwrap();
        assert_eq!(left.capture_commitment, right.capture_commitment);
        assert_eq!(left.observation.cell_id, right.observation.cell_id);
        assert_eq!(left.sdf_cell_id, right.sdf_cell_id);
        assert_eq!(left.sdf_chunk, right.sdf_chunk);
        assert_eq!(left.observation.manifest.temporal_extent.start_unix_us, 100);
        assert_eq!(left.observation.manifest.temporal_extent.end_unix_us, 200);
        assert!(!left.raw_frames_embedded);
    }

    #[test]
    fn sdf_round_trip_is_canonical_and_bounded() {
        let report = reconstruct_rgbd_session(
            session(vec![frame(1, 100, 1_000)]),
            capture_policy(),
            reconstruction_policy(),
        )
        .unwrap();
        let (voxel_size, voxels) = decode_sdf_chunk(&report.sdf_chunk).unwrap();
        assert_eq!(voxel_size, 20_000);
        assert_eq!(voxels.len() as u64, report.fused_voxels);
        assert!(voxels
            .windows(2)
            .all(|pair| pair[0].coordinate < pair[1].coordinate));
        assert!(matches!(
            decode_sdf_chunk(&report.sdf_chunk[..report.sdf_chunk.len() - 1]),
            Err(ReconstructionError::MalformedSdf)
        ));
    }

    #[test]
    fn privacy_exclusion_precedes_sdf_fusion() {
        let mut policy = capture_policy();
        policy.exclusions.push(ExclusionVolume {
            id: digest(93),
            min_um: [-500_000, -500_000, 900_000],
            max_um: [0, 0, 1_100_000],
        });
        let report = reconstruct_rgbd_session(
            session(vec![frame(1, 100, 1_000)]),
            policy,
            reconstruction_policy(),
        )
        .unwrap();
        assert!(report.observation.excluded_samples > 0);
        let public = decode_surfel_chunk(&report.observation.public_chunk).unwrap();
        assert!(public.iter().all(|sample| {
            !(sample.position_um[0] >= -500_000
                && sample.position_um[0] <= 0
                && sample.position_um[1] >= -500_000
                && sample.position_um[1] <= 0
                && sample.position_um[2] >= 900_000
                && sample.position_um[2] <= 1_100_000)
        }));
    }

    #[test]
    fn malformed_dimensions_and_pose_are_rejected() {
        let mut bad_dimensions = frame(1, 100, 1_000);
        bad_dimensions.depth_mm.pop();
        assert!(matches!(
            reconstruct_rgbd_session(
                session(vec![bad_dimensions]),
                capture_policy(),
                reconstruction_policy()
            ),
            Err(ReconstructionError::InvalidCalibration)
        ));
        let mut bad_pose = frame(1, 100, 1_000);
        bad_pose.pose.rotation_q30 = [0; 4];
        assert!(matches!(
            reconstruct_rgbd_session(
                session(vec![bad_pose]),
                capture_policy(),
                reconstruction_policy()
            ),
            Err(ReconstructionError::InvalidPose)
        ));
    }

    #[test]
    fn depth_mutation_changes_capture_and_cell_identity() {
        let first = reconstruct_rgbd_session(
            session(vec![frame(1, 100, 1_000)]),
            capture_policy(),
            reconstruction_policy(),
        )
        .unwrap();
        let second = reconstruct_rgbd_session(
            session(vec![frame(1, 100, 1_001)]),
            capture_policy(),
            reconstruction_policy(),
        )
        .unwrap();
        assert_ne!(first.capture_commitment, second.capture_commitment);
        assert_ne!(first.observation.cell_id, second.observation.cell_id);
        assert_ne!(first.sdf_cell_id, second.sdf_cell_id);
    }

    #[test]
    fn stale_frame_identity_rejects_content_mutation() {
        let mut mutated = frame(1, 100, 1_000);
        mutated.depth_mm[0] += 1;
        assert!(matches!(
            reconstruct_rgbd_session(
                session(vec![mutated]),
                capture_policy(),
                reconstruction_policy()
            ),
            Err(ReconstructionError::FrameIdentityMismatch)
        ));
    }

    #[test]
    fn public_reconstruction_report_verifies_and_mutations_reject() {
        let policy = reconstruction_policy();
        let report = reconstruct_rgbd_session(
            session(vec![frame(1, 100, 1_000), frame(2, 200, 1_100)]),
            capture_policy(),
            policy.clone(),
        )
        .unwrap();
        let verified = verify_reconstruction_report(&report, &policy).unwrap();
        assert!(verified.observation_valid);
        assert!(verified.sdf_valid);
        assert!(verified.report_valid);
        assert!(verified.raw_frames_absent);

        let mut surfel_mutation = report.clone();
        let index = surfel_mutation.observation.public_chunk.len() - 1;
        surfel_mutation.observation.public_chunk[index] ^= 1;
        assert!(verify_reconstruction_report(&surfel_mutation, &policy).is_err());

        let mut sdf_mutation = report.clone();
        let index = sdf_mutation.sdf_chunk.len() - 1;
        sdf_mutation.sdf_chunk[index] ^= 1;
        assert!(verify_reconstruction_report(&sdf_mutation, &policy).is_err());

        let mut report_mutation = report;
        report_mutation.admitted_depth_samples += 1;
        assert!(matches!(
            verify_reconstruction_report(&report_mutation, &policy),
            Err(ReconstructionError::ReportMismatch)
        ));
    }

    #[test]
    fn pixel_privacy_mask_precedes_deprojection_and_sdf_fusion() {
        let mut masked = frame(1, 100, 1_000);
        masked.color_rgba[0] = [255, 0, 255, 255];
        masked.privacy_mask = vec![0; 16];
        masked.privacy_mask[0] = 1;
        masked.frame_id = rgbd_frame_id(&masked).unwrap();
        let report = reconstruct_rgbd_session(
            session(vec![masked]),
            capture_policy(),
            reconstruction_policy(),
        )
        .unwrap();
        assert_eq!(report.admitted_depth_samples, 9);
        assert_eq!(report.masked_depth_samples, 1);
        assert_eq!(report.observation.accepted_samples, 8);
        let public = decode_surfel_chunk(&report.observation.public_chunk).unwrap();
        assert!(!public
            .iter()
            .any(|sample| sample.color_rgba == [255, 0, 255, 255]));
        verify_reconstruction_report(&report, &reconstruction_policy()).unwrap();
    }
}
