use crate::datasets::{
    tartanair_profile, TARTANAIR_DEPTH_BYTES, TARTANAIR_DEPTH_SHA256, TARTANAIR_RGB_BYTES,
    TARTANAIR_RGB_SHA256,
};
use png::{BitDepth, ColorType, Decoder};
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use std::fs::File;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use tessaryn_canonical::chunk_id;
use tessaryn_reconstruct::{
    rgbd_frame_id, RgbdCalibrationV0, RgbdFrameV0, RgbdSessionV0, RigidPoseQ30,
};
use tessaryn_schema::{DatasetProfileV1, Digest};
use thiserror::Error;
use zip::ZipArchive;

const RGB_ARCHIVE: &str = "image_lcam_front.zip";
const DEPTH_ARCHIVE: &str = "depth_lcam_front.zip";
const PREFIX: &str = "ArchVizTinyHouseDay/Data_easy/P000";
const MAX_ARCHIVE_ENTRIES: usize = 10_000;
const MAX_IMAGE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_IMAGE_PIXELS: usize = 16_777_216;
const Q30: i128 = 1_i128 << 30;
const FRAME_PERIOD_US: i64 = 100_000;

#[derive(Debug)]
pub struct TartanAirValidationCapture {
    pub profile: DatasetProfileV1,
    pub moments: Vec<TartanAirSessionSlice>,
    pub alternate: TartanAirSessionSlice,
    pub selections: Vec<ValidationSelectionRecord>,
    pub selected_frames: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ValidationSelectionRecord {
    pub id: String,
    pub frame_ids: Vec<Digest>,
    pub captured_at_unix_us: Vec<i64>,
    pub source_indices: Vec<u32>,
}

#[derive(Debug)]
pub struct TartanAirSessionSlice {
    pub id: String,
    pub label: String,
    pub session: RgbdSessionV0,
}

#[derive(Debug, Clone)]
struct TimedPose {
    translation_um: [i64; 3],
    rotation_q30: [i32; 4],
}

pub fn load_tartanair_validation_capture(
    archive_root: &Path,
    frames_per_moment: usize,
) -> Result<TartanAirValidationCapture, TartanAirImportError> {
    if !(3..=24).contains(&frames_per_moment) {
        return Err(TartanAirImportError::InvalidFrameCount);
    }
    let root = archive_root.canonicalize()?;
    let rgb_path = confined_file(&root, RGB_ARCHIVE)?;
    let depth_path = confined_file(&root, DEPTH_ARCHIVE)?;
    verify_archive(&rgb_path, TARTANAIR_RGB_BYTES, TARTANAIR_RGB_SHA256)?;
    verify_archive(&depth_path, TARTANAIR_DEPTH_BYTES, TARTANAIR_DEPTH_SHA256)?;

    let mut rgb_zip = ZipArchive::new(File::open(rgb_path)?)?;
    let mut depth_zip = ZipArchive::new(File::open(depth_path)?)?;
    if rgb_zip.len() > MAX_ARCHIVE_ENTRIES || depth_zip.len() > MAX_ARCHIVE_ENTRIES {
        return Err(TartanAirImportError::ArchiveEntryLimit);
    }
    let pose_name = format!("{PREFIX}/pose_lcam_front.txt");
    let pose_bytes = read_zip_entry(&mut rgb_zip, &pose_name, 4 * 1024 * 1024)?;
    let poses = parse_pose_file(&pose_bytes)?;
    if poses.len() < frames_per_moment * 5 {
        return Err(TartanAirImportError::InsufficientFrames);
    }
    validate_sequence_entries(&mut rgb_zip, &mut depth_zip, poses.len())?;

    let windows = [
        ("moment-a", "ORIGIN OBSERVATION", 4_usize, 26_usize),
        ("moment-b", "INTERIOR TRANSIT", 29, 53),
        ("moment-c", "RESOLVED RETURN", 56, 80),
        ("alternate-c", "ALTERNATE PASS", 64, 88),
    ];
    let mut slices = Vec::with_capacity(windows.len());
    for (id, label, start_percent, end_percent) in windows {
        let indices = select_window(poses.len(), start_percent, end_percent, frames_per_moment)?;
        slices.push(load_slice(
            &mut rgb_zip,
            &mut depth_zip,
            &poses,
            id,
            label,
            &indices,
        )?);
    }

    let selections = slices
        .iter()
        .map(|slice| {
            let source_indices = slice
                .session
                .frames
                .iter()
                .map(|frame| u32::try_from(frame.captured_at_unix_us / FRAME_PERIOD_US))
                .collect::<Result<Vec<_>, _>>()
                .map_err(|_| TartanAirImportError::NumericRange)?;
            Ok(ValidationSelectionRecord {
                id: slice.id.clone(),
                frame_ids: slice
                    .session
                    .frames
                    .iter()
                    .map(|frame| frame.frame_id.clone())
                    .collect(),
                captured_at_unix_us: slice
                    .session
                    .frames
                    .iter()
                    .map(|frame| frame.captured_at_unix_us)
                    .collect(),
                source_indices,
            })
        })
        .collect::<Result<Vec<_>, TartanAirImportError>>()?;
    let alternate = slices
        .pop()
        .ok_or(TartanAirImportError::InsufficientFrames)?;
    let selected_frames = slices
        .iter()
        .map(|slice| slice.session.frames.len())
        .sum::<usize>()
        + alternate.session.frames.len();
    Ok(TartanAirValidationCapture {
        profile: tartanair_profile(),
        moments: slices,
        alternate,
        selections,
        selected_frames,
    })
}

fn verify_archive(
    path: &Path,
    expected_bytes: u64,
    expected_digest: &str,
) -> Result<(), TartanAirImportError> {
    if path.metadata()?.len() != expected_bytes {
        return Err(TartanAirImportError::ArchiveSizeMismatch);
    }
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let found = format!("sha256:{}", hex::encode(hasher.finalize()));
    if found != expected_digest {
        return Err(TartanAirImportError::ArchiveDigestMismatch);
    }
    Ok(())
}

fn validate_sequence_entries(
    rgb_zip: &mut ZipArchive<File>,
    depth_zip: &mut ZipArchive<File>,
    frame_count: usize,
) -> Result<(), TartanAirImportError> {
    for index in 0..frame_count {
        let rgb_name = rgb_entry(index);
        let depth_name = depth_entry(index);
        let rgb = rgb_zip
            .by_name(&rgb_name)
            .map_err(|_| TartanAirImportError::MissingFrame)?;
        if !rgb.is_file() || rgb.size() == 0 || rgb.size() > MAX_IMAGE_BYTES {
            return Err(TartanAirImportError::ImageLimit);
        }
        drop(rgb);
        let depth = depth_zip
            .by_name(&depth_name)
            .map_err(|_| TartanAirImportError::MissingFrame)?;
        if !depth.is_file() || depth.size() == 0 || depth.size() > MAX_IMAGE_BYTES {
            return Err(TartanAirImportError::ImageLimit);
        }
    }
    Ok(())
}

fn parse_pose_file(bytes: &[u8]) -> Result<Vec<TimedPose>, TartanAirImportError> {
    let text = std::str::from_utf8(bytes).map_err(|_| TartanAirImportError::MalformedPose)?;
    let mut poses = Vec::new();
    for line in text.lines() {
        let fields = line.split_ascii_whitespace().collect::<Vec<_>>();
        if fields.len() != 7 {
            return Err(TartanAirImportError::MalformedPose);
        }
        let mut translation_um = [0_i64; 3];
        for axis in 0..3 {
            translation_um[axis] = parse_decimal_scaled(fields[axis], 1_000_000)?;
        }
        let mut rotation_q30 = [0_i32; 4];
        for axis in 0..4 {
            rotation_q30[axis] = i32::try_from(parse_decimal_scaled(fields[axis + 3], Q30)?)
                .map_err(|_| TartanAirImportError::NumericRange)?;
        }
        poses.push(TimedPose {
            translation_um,
            rotation_q30,
        });
        if poses.len() > 2_048 {
            return Err(TartanAirImportError::FrameLimit);
        }
    }
    if poses.is_empty() {
        return Err(TartanAirImportError::InsufficientFrames);
    }
    Ok(poses)
}

fn select_window(
    frame_count: usize,
    start_percent: usize,
    end_percent: usize,
    count: usize,
) -> Result<Vec<usize>, TartanAirImportError> {
    let last = frame_count
        .checked_sub(1)
        .ok_or(TartanAirImportError::InsufficientFrames)?;
    let start = last * start_percent / 100;
    let end = last * end_percent / 100;
    if start >= end || end >= frame_count || end - start + 1 < count {
        return Err(TartanAirImportError::InsufficientFrames);
    }
    let span = end - start;
    let selected = (0..count)
        .map(|position| start + span * position / (count - 1))
        .collect::<Vec<_>>();
    if !selected.windows(2).all(|pair| pair[0] < pair[1]) {
        return Err(TartanAirImportError::InsufficientFrames);
    }
    Ok(selected)
}

fn load_slice(
    rgb_zip: &mut ZipArchive<File>,
    depth_zip: &mut ZipArchive<File>,
    poses: &[TimedPose],
    id: &str,
    label: &str,
    indices: &[usize],
) -> Result<TartanAirSessionSlice, TartanAirImportError> {
    let mut frames = Vec::with_capacity(indices.len());
    for &index in indices {
        let rgb_bytes = read_zip_entry(rgb_zip, &rgb_entry(index), MAX_IMAGE_BYTES)?;
        let depth_bytes = read_zip_entry(depth_zip, &depth_entry(index), MAX_IMAGE_BYTES)?;
        let (rgb_width, rgb_height, color_rgba) = decode_color_png(&rgb_bytes)?;
        let (depth_width, depth_height, depth_mm) = decode_depth_png(&depth_bytes)?;
        if rgb_width != 640
            || rgb_height != 640
            || depth_width != rgb_width
            || depth_height != rgb_height
        {
            return Err(TartanAirImportError::ImageDimensionMismatch);
        }
        let pose = poses.get(index).ok_or(TartanAirImportError::MissingFrame)?;
        let placeholder = Digest::new(format!("sha256:{}", "00".repeat(32)))?;
        let mut frame = RgbdFrameV0 {
            frame_id: placeholder,
            captured_at_unix_us: i64::try_from(index)
                .map_err(|_| TartanAirImportError::NumericRange)?
                .checked_mul(FRAME_PERIOD_US)
                .ok_or(TartanAirImportError::NumericRange)?,
            calibration: calibration(),
            pose: RigidPoseQ30 {
                translation_um: pose.translation_um,
                rotation_q30: pose.rotation_q30,
            },
            depth_mm,
            color_rgba,
            privacy_mask: Vec::new(),
        };
        frame.frame_id = rgbd_frame_id(&frame)?;
        frames.push(frame);
    }
    let declared_session_id = chunk_id(&serde_json::to_vec(&serde_json::json!({
        "dataset_profile": tartanair_profile(),
        "frames": frames.iter().map(|frame| &frame.frame_id).collect::<Vec<_>>(),
        "slice": id,
    }))?);
    Ok(TartanAirSessionSlice {
        id: id.to_string(),
        label: label.to_string(),
        session: RgbdSessionV0 {
            schema: "tessaryn/rgbd-session/v0".to_string(),
            declared_session_id,
            anchor_id: chunk_id(b"TESSARYN-TARTANAIR-V2-ARCHVIZ-TINY-HOUSE-P000-ANCHOR-v1"),
            clock_source: "tartanair-v2/synthetic-10hz".to_string(),
            producer: "Carnegie Mellon University / TartanAir V2".to_string(),
            device_key: None,
            frames,
        },
    })
}

fn calibration() -> RgbdCalibrationV0 {
    RgbdCalibrationV0 {
        width: 640,
        height: 640,
        fx_q20: 320 << 20,
        fy_q20: 320 << 20,
        cx_q20: 320 << 20,
        cy_q20: 320 << 20,
        min_depth_mm: 200,
        max_depth_mm: 20_000,
    }
}

fn decode_color_png(bytes: &[u8]) -> Result<(u32, u32, Vec<[u8; 4]>), TartanAirImportError> {
    let (info, decoded) = decode_png(bytes)?;
    if info.bit_depth != BitDepth::Eight {
        return Err(TartanAirImportError::UnsupportedColorPng);
    }
    let color = match info.color_type {
        ColorType::Rgb => decoded
            .chunks_exact(3)
            .map(|sample| [sample[0], sample[1], sample[2], 255])
            .collect(),
        ColorType::Rgba => decoded
            .chunks_exact(4)
            .map(|sample| [sample[0], sample[1], sample[2], sample[3]])
            .collect(),
        _ => return Err(TartanAirImportError::UnsupportedColorPng),
    };
    Ok((info.width, info.height, color))
}

fn decode_depth_png(bytes: &[u8]) -> Result<(u32, u32, Vec<u16>), TartanAirImportError> {
    let (info, decoded) = decode_png(bytes)?;
    if info.bit_depth != BitDepth::Eight || info.color_type != ColorType::Rgba {
        return Err(TartanAirImportError::UnsupportedDepthPng);
    }
    let depth = decoded
        .chunks_exact(4)
        .map(|sample| {
            let bits = u32::from_le_bytes([sample[0], sample[1], sample[2], sample[3]]);
            f32_bits_to_millimeters(bits).unwrap_or(0)
        })
        .collect();
    Ok((info.width, info.height, depth))
}

fn f32_bits_to_millimeters(bits: u32) -> Option<u16> {
    if bits >> 31 != 0 {
        return None;
    }
    let exponent = ((bits >> 23) & 0xff) as i32;
    let fraction = bits & 0x7f_ffff;
    if exponent == 0xff || (exponent == 0 && fraction == 0) {
        return None;
    }
    let (mantissa, binary_exponent) = if exponent == 0 {
        (u128::from(fraction), -126 - 23)
    } else {
        (u128::from((1 << 23) | fraction), exponent - 127 - 23)
    };
    let numerator = mantissa.checked_mul(1_000)?;
    let rounded = if binary_exponent >= 0 {
        numerator.checked_shl(binary_exponent as u32)?
    } else {
        let shift = u32::try_from(-binary_exponent).ok()?;
        if shift >= 128 {
            0
        } else {
            let divisor = 1_u128 << shift;
            numerator.checked_add(divisor / 2)? / divisor
        }
    };
    u16::try_from(rounded).ok()
}

fn decode_png(bytes: &[u8]) -> Result<(png::OutputInfo, Vec<u8>), TartanAirImportError> {
    let decoder = Decoder::new(Cursor::new(bytes));
    let mut reader = decoder.read_info()?;
    let size = reader
        .output_buffer_size()
        .ok_or(TartanAirImportError::ImageLimit)?;
    let mut output = vec![0; size];
    let info = reader.next_frame(&mut output)?;
    let pixels = usize::try_from(info.width)
        .ok()
        .and_then(|width| {
            usize::try_from(info.height)
                .ok()
                .and_then(|height| width.checked_mul(height))
        })
        .ok_or(TartanAirImportError::ImageLimit)?;
    if pixels == 0 || pixels > MAX_IMAGE_PIXELS {
        return Err(TartanAirImportError::ImageLimit);
    }
    output.truncate(info.buffer_size());
    Ok((info, output))
}

fn read_zip_entry(
    archive: &mut ZipArchive<File>,
    name: &str,
    max_bytes: u64,
) -> Result<Vec<u8>, TartanAirImportError> {
    let entry = archive
        .by_name(name)
        .map_err(|_| TartanAirImportError::MissingFrame)?;
    if !entry.is_file() || entry.size() == 0 || entry.size() > max_bytes {
        return Err(TartanAirImportError::ImageLimit);
    }
    let expected_size = entry.size();
    let capacity = usize::try_from(expected_size).map_err(|_| TartanAirImportError::ImageLimit)?;
    let mut bytes = Vec::with_capacity(capacity);
    entry
        .take(max_bytes + 1)
        .read_to_end(&mut bytes)
        .map_err(TartanAirImportError::Io)?;
    if bytes.len() as u64 != expected_size || bytes.len() as u64 > max_bytes {
        return Err(TartanAirImportError::ImageLimit);
    }
    Ok(bytes)
}

fn rgb_entry(index: usize) -> String {
    format!("{PREFIX}/image_lcam_front/{index:06}_lcam_front.png")
}

fn depth_entry(index: usize) -> String {
    format!("{PREFIX}/depth_lcam_front/{index:06}_lcam_front_depth.png")
}

fn confined_file(root: &Path, name: &str) -> Result<PathBuf, TartanAirImportError> {
    let path = root.join(name).canonicalize()?;
    if !path.starts_with(root) || !path.is_file() {
        return Err(TartanAirImportError::PathEscape);
    }
    Ok(path)
}

fn parse_decimal_scaled(value: &str, scale: i128) -> Result<i64, TartanAirImportError> {
    if value.is_empty() || scale <= 0 || value.len() > 96 {
        return Err(TartanAirImportError::MalformedNumber);
    }
    let (negative, unsigned) = match value.as_bytes()[0] {
        b'-' => (true, &value[1..]),
        b'+' => (false, &value[1..]),
        _ => (false, value),
    };
    let mut exponent_parts = unsigned.split(['e', 'E']);
    let mantissa = exponent_parts
        .next()
        .ok_or(TartanAirImportError::MalformedNumber)?;
    let exponent = exponent_parts
        .next()
        .map(|part| part.parse::<i32>())
        .transpose()
        .map_err(|_| TartanAirImportError::MalformedNumber)?
        .unwrap_or(0);
    if exponent_parts.next().is_some() || !(-64..=64).contains(&exponent) {
        return Err(TartanAirImportError::MalformedNumber);
    }
    let mut decimal_parts = mantissa.split('.');
    let integer = decimal_parts
        .next()
        .ok_or(TartanAirImportError::MalformedNumber)?;
    let fraction = decimal_parts.next().unwrap_or("");
    if decimal_parts.next().is_some()
        || integer.is_empty()
        || !integer.bytes().all(|byte| byte.is_ascii_digit())
        || !fraction.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(TartanAirImportError::MalformedNumber);
    }
    let digits = format!("{integer}{fraction}")
        .parse::<i128>()
        .map_err(|_| TartanAirImportError::NumericRange)?;
    let decimal_exponent = exponent
        .checked_sub(i32::try_from(fraction.len()).map_err(|_| TartanAirImportError::NumericRange)?)
        .ok_or(TartanAirImportError::NumericRange)?;
    let scaled = digits
        .checked_mul(scale)
        .ok_or(TartanAirImportError::NumericRange)?;
    let rounded = if decimal_exponent >= 0 {
        scaled
            .checked_mul(
                10_i128
                    .checked_pow(decimal_exponent as u32)
                    .ok_or(TartanAirImportError::NumericRange)?,
            )
            .ok_or(TartanAirImportError::NumericRange)?
    } else {
        let denominator = 10_i128
            .checked_pow((-decimal_exponent) as u32)
            .ok_or(TartanAirImportError::NumericRange)?;
        scaled
            .checked_add(denominator / 2)
            .ok_or(TartanAirImportError::NumericRange)?
            / denominator
    };
    let signed = if negative { -rounded } else { rounded };
    i64::try_from(signed).map_err(|_| TartanAirImportError::NumericRange)
}

#[derive(Debug, Error)]
pub enum TartanAirImportError {
    #[error("frames per Moment must be between 3 and 24")]
    InvalidFrameCount,
    #[error("TartanAir archive size does not match the release profile")]
    ArchiveSizeMismatch,
    #[error("TartanAir archive digest does not match the release profile")]
    ArchiveDigestMismatch,
    #[error("TartanAir archive exceeds the bounded entry profile")]
    ArchiveEntryLimit,
    #[error("TartanAir trajectory exceeds the bounded frame profile")]
    FrameLimit,
    #[error("TartanAir trajectory does not contain enough frames")]
    InsufficientFrames,
    #[error("TartanAir pose file is malformed")]
    MalformedPose,
    #[error("TartanAir trajectory frame is missing")]
    MissingFrame,
    #[error("source path escaped the archive directory")]
    PathEscape,
    #[error("source image exceeds the bounded profile")]
    ImageLimit,
    #[error("TartanAir depth PNG must be 8-bit RGBA float32 bytes")]
    UnsupportedDepthPng,
    #[error("TartanAir color PNG must be 8-bit RGB or RGBA")]
    UnsupportedColorPng,
    #[error("TartanAir image dimensions do not match the 640x640 camera profile")]
    ImageDimensionMismatch,
    #[error("source decimal is malformed")]
    MalformedNumber,
    #[error("source numeric value exceeds the canonical fixed-point profile")]
    NumericRange,
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Zip(#[from] zip::result::ZipError),
    #[error(transparent)]
    Png(#[from] png::DecodingError),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Schema(#[from] tessaryn_schema::SchemaError),
    #[error(transparent)]
    Reconstruction(#[from] tessaryn_reconstruct::ReconstructionError),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scientific_decimal_conversion_is_exact_and_sign_preserving() {
        assert_eq!(
            parse_decimal_scaled("1.25e+00", 1_000_000).unwrap(),
            1_250_000
        );
        assert_eq!(
            parse_decimal_scaled("-5.0e-01", 1_000_000).unwrap(),
            -500_000
        );
        assert_eq!(
            parse_decimal_scaled("3.33333333e-01", Q30).unwrap(),
            357_913_941
        );
        assert!(parse_decimal_scaled("nan", 1_000).is_err());
        assert!(parse_decimal_scaled("1e999", 1_000).is_err());
    }

    #[test]
    fn float_depth_decoding_uses_integer_ieee754_conversion() {
        assert_eq!(f32_bits_to_millimeters(1.0_f32.to_bits()), Some(1_000));
        assert_eq!(f32_bits_to_millimeters(1.2345_f32.to_bits()), Some(1_235));
        assert_eq!(f32_bits_to_millimeters(f32::INFINITY.to_bits()), None);
        assert_eq!(f32_bits_to_millimeters((-1.0_f32).to_bits()), None);
    }

    #[test]
    fn selected_windows_are_distinct_and_deterministic() {
        let selected = select_window(116, 4, 26, 12).unwrap();
        assert_eq!(selected.len(), 12);
        assert!(selected.windows(2).all(|pair| pair[0] < pair[1]));
    }
}
