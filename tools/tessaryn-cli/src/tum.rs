use png::{BitDepth, ColorType, Decoder};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use tessaryn_canonical::chunk_id;
use tessaryn_reconstruct::{
    rgbd_frame_id, RgbdCalibrationV0, RgbdFrameV0, RgbdSessionV0, RigidPoseQ30,
};
use tessaryn_schema::Digest;
use thiserror::Error;

pub const TUM_DATASET_NAME: &str = "TUM RGB-D Benchmark / freiburg1_desk";
pub const TUM_DATASET_HOME: &str = "https://cvg.cit.tum.de/data/datasets/rgbd-dataset";
pub const TUM_SEQUENCE_URL: &str =
    "https://cvg.cit.tum.de/rgbd/dataset/freiburg1/rgbd_dataset_freiburg1_desk.tgz";
pub const TUM_ARCHIVE_SHA256: &str =
    "sha256:e983d6830916e66dc4a46a71368046b149b283de87769690e7aa4e0b9483530c";
pub const TUM_LICENSE: &str = "CC-BY-4.0";
pub const TUM_CITATION: &str =
    "J. Sturm, N. Engelhard, F. Endres, W. Burgard, and D. Cremers, A Benchmark for the Evaluation of RGB-D SLAM Systems, IROS 2012";
const MAX_INDEX_ENTRIES: usize = 100_000;
const MAX_IMAGE_PIXELS: usize = 16_777_216;
const PAIR_TOLERANCE_US: i64 = 35_000;
const POSE_TOLERANCE_US: i64 = 50_000;
const Q20: i128 = 1_i128 << 20;
const Q30: i128 = 1_i128 << 30;

#[derive(Debug)]
pub struct TumTemporalCapture {
    pub moments: Vec<TumSessionSlice>,
    pub alternate: TumSessionSlice,
    pub selections: Vec<TumSelectionRecord>,
    pub source_manifest: Digest,
    pub selected_frames: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TumSelectionRecord {
    pub id: String,
    pub frame_ids: Vec<Digest>,
    pub captured_at_unix_us: Vec<i64>,
}

#[derive(Debug)]
pub struct TumSessionSlice {
    pub id: String,
    pub label: String,
    pub session: RgbdSessionV0,
}

#[derive(Debug, Clone)]
struct TimedFile {
    timestamp_us: i64,
    relative: PathBuf,
}

#[derive(Debug, Clone)]
struct TimedPose {
    timestamp_us: i64,
    translation_um: [i64; 3],
    rotation_q30: [i32; 4],
}

#[derive(Debug, Clone)]
struct FrameSource {
    timestamp_us: i64,
    depth: PathBuf,
    color: PathBuf,
    pose: TimedPose,
}

pub fn load_tum_temporal_capture(
    dataset_root: &Path,
    frames_per_moment: usize,
) -> Result<TumTemporalCapture, TumImportError> {
    if !(3..=32).contains(&frames_per_moment) {
        return Err(TumImportError::InvalidFrameCount);
    }
    let root = dataset_root.canonicalize()?;
    let rgb = parse_file_index(&root, "rgb.txt")?;
    let depth = parse_file_index(&root, "depth.txt")?;
    let poses = parse_pose_index(&root, "groundtruth.txt")?;
    let pairs = associate_frames(&rgb, &depth, &poses)?;
    if pairs.len() < frames_per_moment * 5 {
        return Err(TumImportError::InsufficientFrames);
    }

    let windows = [
        ("moment-a", "FIRST OBSERVATION", 5_usize, 25_usize),
        ("moment-b", "SECOND OBSERVATION", 38, 58),
        ("moment-c", "PRESENT OBSERVATION", 70, 90),
        ("alternate-c", "ALTERNATE OBSERVATION", 78, 98),
    ];
    let mut slices = Vec::with_capacity(windows.len());
    for (id, label, start_percent, end_percent) in windows {
        let selected = select_window(&pairs, start_percent, end_percent, frames_per_moment)?;
        slices.push(load_slice(&root, id, label, selected)?);
    }

    let selections = slices
        .iter()
        .map(|slice| TumSelectionRecord {
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
        })
        .collect::<Vec<_>>();
    let source_manifest = selection_manifest(&selections)?;
    let alternate = slices.pop().ok_or(TumImportError::InsufficientFrames)?;
    let selected_frames = slices
        .iter()
        .map(|slice| slice.session.frames.len())
        .sum::<usize>()
        + alternate.session.frames.len();
    Ok(TumTemporalCapture {
        moments: slices,
        alternate,
        selections,
        source_manifest,
        selected_frames,
    })
}

pub fn selection_manifest(selections: &[TumSelectionRecord]) -> Result<Digest, serde_json::Error> {
    Ok(chunk_id(&serde_json::to_vec(&serde_json::json!({
        "dataset": TUM_DATASET_NAME,
        "homepage": TUM_DATASET_HOME,
        "citation": TUM_CITATION,
        "license": TUM_LICENSE,
        "selected": selections,
        "sequence": TUM_SEQUENCE_URL,
    }))?))
}

fn parse_file_index(root: &Path, name: &str) -> Result<Vec<TimedFile>, TumImportError> {
    let text = std::fs::read_to_string(confined_path(root, Path::new(name))?)?;
    let mut entries = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut fields = line.split_ascii_whitespace();
        let timestamp = fields.next().ok_or(TumImportError::MalformedIndex)?;
        let relative = fields.next().ok_or(TumImportError::MalformedIndex)?;
        if fields.next().is_some() {
            return Err(TumImportError::MalformedIndex);
        }
        let relative = PathBuf::from(relative);
        confined_path(root, &relative)?;
        entries.push(TimedFile {
            timestamp_us: parse_decimal_scaled(timestamp, 1_000_000)?,
            relative,
        });
        if entries.len() > MAX_INDEX_ENTRIES {
            return Err(TumImportError::IndexLimit);
        }
    }
    require_sorted_unique(&entries, |entry| entry.timestamp_us)?;
    Ok(entries)
}

fn parse_pose_index(root: &Path, name: &str) -> Result<Vec<TimedPose>, TumImportError> {
    let text = std::fs::read_to_string(confined_path(root, Path::new(name))?)?;
    let mut entries = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let fields = line.split_ascii_whitespace().collect::<Vec<_>>();
        if fields.len() != 8 {
            return Err(TumImportError::MalformedPose);
        }
        let mut translation_um = [0_i64; 3];
        for axis in 0..3 {
            translation_um[axis] = parse_decimal_scaled(fields[axis + 1], 1_000_000)?;
        }
        let mut rotation_q30 = [0_i32; 4];
        for axis in 0..4 {
            rotation_q30[axis] = i32::try_from(parse_decimal_scaled(fields[axis + 4], Q30)?)
                .map_err(|_| TumImportError::NumericRange)?;
        }
        entries.push(TimedPose {
            timestamp_us: parse_decimal_scaled(fields[0], 1_000_000)?,
            translation_um,
            rotation_q30,
        });
        if entries.len() > MAX_INDEX_ENTRIES {
            return Err(TumImportError::IndexLimit);
        }
    }
    require_sorted_unique(&entries, |entry| entry.timestamp_us)?;
    Ok(entries)
}

fn require_sorted_unique<T>(
    entries: &[T],
    timestamp: impl Fn(&T) -> i64,
) -> Result<(), TumImportError> {
    if entries.is_empty()
        || !entries
            .windows(2)
            .all(|pair| timestamp(&pair[0]) < timestamp(&pair[1]))
    {
        return Err(TumImportError::NoncanonicalIndex);
    }
    Ok(())
}

fn associate_frames(
    rgb: &[TimedFile],
    depth: &[TimedFile],
    poses: &[TimedPose],
) -> Result<Vec<FrameSource>, TumImportError> {
    let mut output = Vec::new();
    let mut used_depth = std::collections::BTreeSet::new();
    for color in rgb {
        let depth_index = nearest_index(depth, color.timestamp_us, |entry| entry.timestamp_us)
            .ok_or(TumImportError::InsufficientFrames)?;
        let depth_entry = &depth[depth_index];
        if (depth_entry.timestamp_us - color.timestamp_us).abs() > PAIR_TOLERANCE_US
            || !used_depth.insert(depth_index)
        {
            continue;
        }
        let pose_index = nearest_index(poses, depth_entry.timestamp_us, |entry| entry.timestamp_us)
            .ok_or(TumImportError::InsufficientFrames)?;
        let pose = poses[pose_index].clone();
        if (pose.timestamp_us - depth_entry.timestamp_us).abs() > POSE_TOLERANCE_US {
            continue;
        }
        output.push(FrameSource {
            timestamp_us: depth_entry.timestamp_us,
            depth: depth_entry.relative.clone(),
            color: color.relative.clone(),
            pose,
        });
    }
    output.sort_by_key(|frame| frame.timestamp_us);
    if output.len() < 16 {
        return Err(TumImportError::InsufficientFrames);
    }
    Ok(output)
}

fn nearest_index<T>(entries: &[T], target: i64, timestamp: impl Fn(&T) -> i64) -> Option<usize> {
    let index = entries
        .binary_search_by(|entry| timestamp(entry).cmp(&target))
        .unwrap_or_else(|insertion| insertion);
    [
        index.checked_sub(1),
        (index < entries.len()).then_some(index),
    ]
    .into_iter()
    .flatten()
    .min_by_key(|candidate| (timestamp(&entries[*candidate]) - target).abs())
}

fn select_window(
    frames: &[FrameSource],
    start_percent: usize,
    end_percent: usize,
    count: usize,
) -> Result<Vec<FrameSource>, TumImportError> {
    let last = frames.len() - 1;
    let start = last * start_percent / 100;
    let end = last * end_percent / 100;
    if start >= end || end >= frames.len() || end - start + 1 < count {
        return Err(TumImportError::InsufficientFrames);
    }
    let span = end - start;
    let selected = (0..count)
        .map(|index| {
            let offset = if count == 1 {
                span / 2
            } else {
                span * index / (count - 1)
            };
            frames[start + offset].clone()
        })
        .collect::<Vec<_>>();
    if !selected
        .windows(2)
        .all(|pair| pair[0].timestamp_us < pair[1].timestamp_us)
    {
        return Err(TumImportError::InsufficientFrames);
    }
    Ok(selected)
}

fn load_slice(
    root: &Path,
    id: &str,
    label: &str,
    sources: Vec<FrameSource>,
) -> Result<TumSessionSlice, TumImportError> {
    let mut frames = Vec::with_capacity(sources.len());
    for source in sources {
        let (depth_width, depth_height, depth_mm) =
            decode_depth_png(&confined_path(root, &source.depth)?)?;
        let (color_width, color_height, color_rgba) =
            decode_color_png(&confined_path(root, &source.color)?)?;
        if depth_width != color_width || depth_height != color_height {
            return Err(TumImportError::ImageDimensionMismatch);
        }
        if depth_width != 640 || depth_height != 480 {
            return Err(TumImportError::UnsupportedCalibration);
        }
        let placeholder = Digest::new(format!("sha256:{}", "00".repeat(32)))?;
        let mut frame = RgbdFrameV0 {
            frame_id: placeholder,
            captured_at_unix_us: source.timestamp_us,
            calibration: freiburg1_calibration(),
            pose: RigidPoseQ30 {
                translation_um: source.pose.translation_um,
                rotation_q30: source.pose.rotation_q30,
            },
            depth_mm,
            color_rgba,
            privacy_mask: Vec::new(),
        };
        frame.frame_id = rgbd_frame_id(&frame)?;
        frames.push(frame);
    }
    let session_projection = serde_json::json!({
        "dataset": TUM_DATASET_NAME,
        "frames": frames.iter().map(|frame| frame.frame_id.as_str()).collect::<Vec<_>>(),
        "slice": id,
    });
    let declared_session_id = chunk_id(&serde_json::to_vec(&session_projection)?);
    let anchor_id = chunk_id(b"TESSARYN-TUM-FREIBURG1-DESK-ANCHOR-v0");
    Ok(TumSessionSlice {
        id: id.to_string(),
        label: label.to_string(),
        session: RgbdSessionV0 {
            schema: "tessaryn/rgbd-session/v0".to_string(),
            declared_session_id,
            anchor_id,
            clock_source: "tum/rgbd/freiburg1-timestamp".to_string(),
            producer: "TUM Computer Vision Group / RGB-D Benchmark".to_string(),
            device_key: None,
            frames,
        },
    })
}

fn freiburg1_calibration() -> RgbdCalibrationV0 {
    RgbdCalibrationV0 {
        width: 640,
        height: 480,
        fx_q20: scaled_ratio(5_173, 10, Q20) as u64,
        fy_q20: scaled_ratio(5_165, 10, Q20) as u64,
        cx_q20: scaled_ratio(3_186, 10, Q20) as i64,
        cy_q20: scaled_ratio(2_553, 10, Q20) as i64,
        min_depth_mm: 250,
        max_depth_mm: 5_000,
    }
}

fn scaled_ratio(numerator: i128, denominator: i128, scale: i128) -> i128 {
    (numerator * scale + denominator / 2) / denominator
}

fn decode_depth_png(path: &Path) -> Result<(u32, u32, Vec<u16>), TumImportError> {
    let (info, bytes) = decode_png(path)?;
    if info.color_type != ColorType::Grayscale || info.bit_depth != BitDepth::Sixteen {
        return Err(TumImportError::UnsupportedDepthPng);
    }
    let depth_mm = bytes
        .chunks_exact(2)
        .map(|sample| {
            let source = u16::from_be_bytes([sample[0], sample[1]]);
            if source == 0 {
                0
            } else {
                (source + 2) / 5
            }
        })
        .collect::<Vec<_>>();
    Ok((info.width, info.height, depth_mm))
}

fn decode_color_png(path: &Path) -> Result<(u32, u32, Vec<[u8; 4]>), TumImportError> {
    let (info, bytes) = decode_png(path)?;
    if info.bit_depth != BitDepth::Eight {
        return Err(TumImportError::UnsupportedColorPng);
    }
    let color = match info.color_type {
        ColorType::Rgb => bytes
            .chunks_exact(3)
            .map(|sample| [sample[0], sample[1], sample[2], 255])
            .collect(),
        ColorType::Rgba => bytes
            .chunks_exact(4)
            .map(|sample| [sample[0], sample[1], sample[2], sample[3]])
            .collect(),
        _ => return Err(TumImportError::UnsupportedColorPng),
    };
    Ok((info.width, info.height, color))
}

fn decode_png(path: &Path) -> Result<(png::OutputInfo, Vec<u8>), TumImportError> {
    let decoder = Decoder::new(BufReader::new(File::open(path)?));
    let mut reader = decoder.read_info()?;
    let size = reader
        .output_buffer_size()
        .ok_or(TumImportError::ImageLimit)?;
    let mut bytes = vec![0; size];
    let info = reader.next_frame(&mut bytes)?;
    let pixels = usize::try_from(info.width)
        .ok()
        .and_then(|width| {
            usize::try_from(info.height)
                .ok()
                .and_then(|height| width.checked_mul(height))
        })
        .ok_or(TumImportError::ImageLimit)?;
    if pixels == 0 || pixels > MAX_IMAGE_PIXELS {
        return Err(TumImportError::ImageLimit);
    }
    bytes.truncate(info.buffer_size());
    Ok((info, bytes))
}

fn confined_path(root: &Path, relative: &Path) -> Result<PathBuf, TumImportError> {
    if relative.is_absolute()
        || relative.components().any(|component| {
            matches!(
                component,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
    {
        return Err(TumImportError::PathEscape);
    }
    let path = root.join(relative).canonicalize()?;
    if !path.starts_with(root) {
        return Err(TumImportError::PathEscape);
    }
    Ok(path)
}

fn parse_decimal_scaled(value: &str, scale: i128) -> Result<i64, TumImportError> {
    if scale <= 0 || value.is_empty() {
        return Err(TumImportError::MalformedNumber);
    }
    let (negative, unsigned) = match value.as_bytes()[0] {
        b'-' => (true, &value[1..]),
        b'+' => (false, &value[1..]),
        _ => (false, value),
    };
    if unsigned.is_empty() {
        return Err(TumImportError::MalformedNumber);
    }
    let mut parts = unsigned.split('.');
    let integer = parts.next().ok_or(TumImportError::MalformedNumber)?;
    let fraction = parts.next().unwrap_or("");
    if parts.next().is_some()
        || integer.is_empty()
        || !integer.bytes().all(|byte| byte.is_ascii_digit())
        || !fraction.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(TumImportError::MalformedNumber);
    }
    let integer_value = integer
        .parse::<i128>()
        .map_err(|_| TumImportError::NumericRange)?;
    let denominator = 10_i128
        .checked_pow(u32::try_from(fraction.len()).map_err(|_| TumImportError::NumericRange)?)
        .ok_or(TumImportError::NumericRange)?;
    let fraction_value = if fraction.is_empty() {
        0
    } else {
        fraction
            .parse::<i128>()
            .map_err(|_| TumImportError::NumericRange)?
    };
    let numerator = integer_value
        .checked_mul(denominator)
        .and_then(|base| base.checked_add(fraction_value))
        .ok_or(TumImportError::NumericRange)?;
    let rounded = numerator
        .checked_mul(scale)
        .and_then(|scaled| scaled.checked_add(denominator / 2))
        .ok_or(TumImportError::NumericRange)?
        / denominator;
    let signed = if negative { -rounded } else { rounded };
    i64::try_from(signed).map_err(|_| TumImportError::NumericRange)
}

#[derive(Debug, Error)]
pub enum TumImportError {
    #[error("TUM source index is malformed")]
    MalformedIndex,
    #[error("TUM pose index is malformed")]
    MalformedPose,
    #[error("TUM source index is empty, unsorted, or duplicated")]
    NoncanonicalIndex,
    #[error("TUM source index exceeds the bounded profile")]
    IndexLimit,
    #[error("TUM source does not contain enough aligned RGB-D frames")]
    InsufficientFrames,
    #[error("frames per Moment must be between 3 and 32")]
    InvalidFrameCount,
    #[error("source path escaped the dataset root")]
    PathEscape,
    #[error("source image exceeds the bounded profile")]
    ImageLimit,
    #[error("depth PNG must be 16-bit grayscale")]
    UnsupportedDepthPng,
    #[error("color PNG must be 8-bit RGB or RGBA")]
    UnsupportedColorPng,
    #[error("depth and color dimensions do not match")]
    ImageDimensionMismatch,
    #[error("source image does not match the Freiburg1 calibration profile")]
    UnsupportedCalibration,
    #[error("source decimal is malformed")]
    MalformedNumber,
    #[error("source numeric value exceeds the canonical fixed-point profile")]
    NumericRange,
    #[error(transparent)]
    Io(#[from] std::io::Error),
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
    fn decimal_conversion_is_exact_and_sign_preserving() {
        assert_eq!(parse_decimal_scaled("1.25", 1_000_000).unwrap(), 1_250_000);
        assert_eq!(parse_decimal_scaled("-0.5", 1_000_000).unwrap(), -500_000);
        assert_eq!(
            parse_decimal_scaled("0.333333333", Q30).unwrap(),
            357_913_941
        );
        assert!(parse_decimal_scaled("1e3", 1_000).is_err());
        assert!(parse_decimal_scaled("1.2.3", 1_000).is_err());
    }

    #[test]
    fn nearest_timestamp_prefers_the_closest_entry() {
        let entries = vec![
            TimedFile {
                timestamp_us: 10,
                relative: PathBuf::from("a"),
            },
            TimedFile {
                timestamp_us: 30,
                relative: PathBuf::from("b"),
            },
        ];
        assert_eq!(
            nearest_index(&entries, 24, |entry| entry.timestamp_us),
            Some(1)
        );
        assert_eq!(
            nearest_index(&entries, 18, |entry| entry.timestamp_us),
            Some(0)
        );
    }

    #[test]
    fn frame_windows_are_distinct_and_deterministic() {
        let pose = TimedPose {
            timestamp_us: 0,
            translation_um: [0; 3],
            rotation_q30: [0, 0, 0, 1 << 30],
        };
        let frames = (0..100)
            .map(|index| FrameSource {
                timestamp_us: index,
                depth: PathBuf::from(format!("depth/{index}")),
                color: PathBuf::from(format!("rgb/{index}")),
                pose: pose.clone(),
            })
            .collect::<Vec<_>>();
        let selected = select_window(&frames, 5, 25, 8).unwrap();
        assert_eq!(selected.len(), 8);
        assert_eq!(selected.first().unwrap().timestamp_us, 4);
        assert_eq!(selected.last().unwrap().timestamp_us, 24);
        assert!(selected
            .windows(2)
            .all(|pair| pair[0].timestamp_us < pair[1].timestamp_us));
    }
}
