use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use tessaryn_canonical::chunk_id;
use tessaryn_schema::{DatasetSourceClass, Digest};
use thiserror::Error;

const MAX_FILES: usize = 200_000;
const MAX_TOTAL_BYTES: u64 = 1_099_511_627_776;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DatasetLayoutReceiptV1 {
    pub schema: String,
    pub profile_id: String,
    pub source_class: DatasetSourceClass,
    pub adapter: String,
    pub files: usize,
    pub bytes: u64,
    pub samples: DatasetSampleCountsV1,
    pub content_root: Digest,
    pub receipt_id: Digest,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DatasetSampleCountsV1 {
    pub primary: usize,
    pub secondary: usize,
    pub motion: usize,
    pub reference: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct FileCommitment {
    path: String,
    bytes: u64,
    sha256: Digest,
}

pub fn inspect_dataset_layout(
    kind: &str,
    root: &Path,
) -> Result<DatasetLayoutReceiptV1, DatasetLayoutError> {
    let root = root.canonicalize()?;
    let (profile_id, adapter, samples) = match kind {
        "euroc" => inspect_euroc(&root)?,
        "kitti" => inspect_kitti(&root)?,
        "scannet" => inspect_scannet(&root)?,
        _ => return Err(DatasetLayoutError::UnsupportedAdapter),
    };
    let commitments = commit_tree(&root)?;
    let bytes = commitments.iter().try_fold(0_u64, |total, file| {
        total
            .checked_add(file.bytes)
            .ok_or(DatasetLayoutError::ResourceLimit)
    })?;
    let content_root = chunk_id(&serde_json::to_vec(&commitments)?);
    let mut receipt = DatasetLayoutReceiptV1 {
        schema: "tessaryn/dataset-layout-receipt/v1".to_string(),
        profile_id: profile_id.to_string(),
        source_class: DatasetSourceClass::RealSensor,
        adapter: adapter.to_string(),
        files: commitments.len(),
        bytes,
        samples,
        content_root,
        receipt_id: Digest::new(format!("sha256:{}", "00".repeat(32)))?,
    };
    receipt.receipt_id = chunk_id(&serde_json::to_vec(&serde_json::json!({
        "adapter": receipt.adapter,
        "bytes": receipt.bytes,
        "content_root": receipt.content_root,
        "files": receipt.files,
        "profile_id": receipt.profile_id,
        "samples": receipt.samples,
        "schema": receipt.schema,
        "source_class": receipt.source_class,
    }))?);
    Ok(receipt)
}

fn inspect_euroc(
    root: &Path,
) -> Result<(&'static str, &'static str, DatasetSampleCountsV1), DatasetLayoutError> {
    let cam0 = parse_csv_timestamps(&required(root, "mav0/cam0/data.csv")?)?;
    let cam1 = parse_csv_timestamps(&required(root, "mav0/cam1/data.csv")?)?;
    let imu = parse_csv_timestamps(&required(root, "mav0/imu0/data.csv")?)?;
    let ground_truth = parse_csv_timestamps(&required(
        root,
        "mav0/state_groundtruth_estimate0/data.csv",
    )?)?;
    if cam0 != cam1
        || count_regular_files(&required_dir(root, "mav0/cam0/data")?)? != cam0.len()
        || count_regular_files(&required_dir(root, "mav0/cam1/data")?)? != cam1.len()
        || imu.len() <= cam0.len()
        || ground_truth.is_empty()
    {
        return Err(DatasetLayoutError::SynchronizationMismatch);
    }
    Ok((
        "euroc-mav/v1",
        "euroc-stereo-imu-layout-v1",
        DatasetSampleCountsV1 {
            primary: cam0.len(),
            secondary: cam1.len(),
            motion: imu.len(),
            reference: ground_truth.len(),
        },
    ))
}

fn inspect_kitti(
    root: &Path,
) -> Result<(&'static str, &'static str, DatasetSampleCountsV1), DatasetLayoutError> {
    let image_left = count_regular_files(&required_dir(root, "image_02/data")?)?;
    let image_right = count_regular_files(&required_dir(root, "image_03/data")?)?;
    let lidar = count_regular_files(&required_dir(root, "velodyne_points/data")?)?;
    let motion = count_regular_files(&required_dir(root, "oxts/data")?)?;
    let image_times = count_nonempty_lines(&required(root, "image_02/timestamps.txt")?)?;
    let lidar_times = count_nonempty_lines(&required(root, "velodyne_points/timestamps.txt")?)?;
    let motion_times = count_nonempty_lines(&required(root, "oxts/timestamps.txt")?)?;
    if image_left == 0
        || image_left != image_right
        || image_left != image_times
        || lidar != lidar_times
        || motion != motion_times
    {
        return Err(DatasetLayoutError::SynchronizationMismatch);
    }
    Ok((
        "kitti/raw",
        "kitti-stereo-lidar-layout-v1",
        DatasetSampleCountsV1 {
            primary: image_left,
            secondary: image_right,
            motion,
            reference: lidar,
        },
    ))
}

fn inspect_scannet(
    root: &Path,
) -> Result<(&'static str, &'static str, DatasetSampleCountsV1), DatasetLayoutError> {
    let color = count_regular_files(&required_dir(root, "color")?)?;
    let depth = count_regular_files(&required_dir(root, "depth")?)?;
    let pose = count_regular_files(&required_dir(root, "pose")?)?;
    let intrinsic = count_regular_files(&required_dir(root, "intrinsic")?)?;
    if color == 0 || color != depth || color != pose || intrinsic < 2 {
        return Err(DatasetLayoutError::SynchronizationMismatch);
    }
    Ok((
        "scannet/v2",
        "scannet-rgbd-layout-v1",
        DatasetSampleCountsV1 {
            primary: color,
            secondary: depth,
            motion: pose,
            reference: intrinsic,
        },
    ))
}

fn parse_csv_timestamps(path: &Path) -> Result<Vec<u64>, DatasetLayoutError> {
    let text = fs::read_to_string(path)?;
    let mut timestamps = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let timestamp = line
            .split(',')
            .next()
            .ok_or(DatasetLayoutError::MalformedIndex)?
            .trim()
            .parse::<u64>()
            .map_err(|_| DatasetLayoutError::MalformedIndex)?;
        timestamps.push(timestamp);
        if timestamps.len() > MAX_FILES {
            return Err(DatasetLayoutError::ResourceLimit);
        }
    }
    if timestamps.is_empty() || !timestamps.windows(2).all(|pair| pair[0] < pair[1]) {
        return Err(DatasetLayoutError::MalformedIndex);
    }
    Ok(timestamps)
}

fn count_nonempty_lines(path: &Path) -> Result<usize, DatasetLayoutError> {
    let count = fs::read_to_string(path)?
        .lines()
        .filter(|line| !line.trim().is_empty())
        .count();
    if count == 0 || count > MAX_FILES {
        return Err(DatasetLayoutError::ResourceLimit);
    }
    Ok(count)
}

fn count_regular_files(path: &Path) -> Result<usize, DatasetLayoutError> {
    let mut count = 0_usize;
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        if entry.file_type()?.is_file() {
            count = count
                .checked_add(1)
                .ok_or(DatasetLayoutError::ResourceLimit)?;
        }
    }
    if count == 0 || count > MAX_FILES {
        return Err(DatasetLayoutError::ResourceLimit);
    }
    Ok(count)
}

fn commit_tree(root: &Path) -> Result<Vec<FileCommitment>, DatasetLayoutError> {
    let mut pending = vec![root.to_path_buf()];
    let mut files = Vec::new();
    let mut total = 0_u64;
    while let Some(directory) = pending.pop() {
        let mut entries = fs::read_dir(&directory)?.collect::<Result<Vec<_>, _>>()?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries.into_iter().rev() {
            let file_type = entry.file_type()?;
            if file_type.is_symlink() {
                return Err(DatasetLayoutError::SymlinkRejected);
            }
            if file_type.is_dir() {
                pending.push(entry.path());
                continue;
            }
            if !file_type.is_file() {
                return Err(DatasetLayoutError::UnsupportedFileType);
            }
            let path = entry.path();
            let bytes = entry.metadata()?.len();
            total = total
                .checked_add(bytes)
                .ok_or(DatasetLayoutError::ResourceLimit)?;
            if total > MAX_TOTAL_BYTES || files.len() >= MAX_FILES {
                return Err(DatasetLayoutError::ResourceLimit);
            }
            files.push(FileCommitment {
                path: portable_relative(root, &path)?,
                bytes,
                sha256: hash_file(&path)?,
            });
        }
    }
    files.sort_by(|left, right| left.path.cmp(&right.path));
    if files.is_empty() {
        return Err(DatasetLayoutError::MissingRequiredPath);
    }
    Ok(files)
}

fn hash_file(path: &Path) -> Result<Digest, DatasetLayoutError> {
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
    Ok(Digest::new(format!(
        "sha256:{}",
        hex::encode(hasher.finalize())
    ))?)
}

fn portable_relative(root: &Path, path: &Path) -> Result<String, DatasetLayoutError> {
    let relative = path
        .strip_prefix(root)
        .map_err(|_| DatasetLayoutError::PathEscape)?;
    let parts = relative
        .components()
        .map(|component| {
            component
                .as_os_str()
                .to_str()
                .ok_or(DatasetLayoutError::NonUtf8Path)
        })
        .collect::<Result<Vec<_>, _>>()?;
    if parts.is_empty() {
        return Err(DatasetLayoutError::PathEscape);
    }
    Ok(parts.join("/"))
}

fn required(root: &Path, relative: &str) -> Result<PathBuf, DatasetLayoutError> {
    let path = root.join(relative);
    if !path.is_file() {
        return Err(DatasetLayoutError::MissingRequiredPath);
    }
    Ok(path)
}

fn required_dir(root: &Path, relative: &str) -> Result<PathBuf, DatasetLayoutError> {
    let path = root.join(relative);
    if !path.is_dir() {
        return Err(DatasetLayoutError::MissingRequiredPath);
    }
    Ok(path)
}

#[derive(Debug, Error)]
pub enum DatasetLayoutError {
    #[error("unsupported dataset adapter")]
    UnsupportedAdapter,
    #[error("dataset is missing a required path")]
    MissingRequiredPath,
    #[error("dataset index is malformed or not strictly ordered")]
    MalformedIndex,
    #[error("dataset modalities are not synchronized")]
    SynchronizationMismatch,
    #[error("dataset exceeds the bounded inspection profile")]
    ResourceLimit,
    #[error("dataset symlinks are rejected")]
    SymlinkRejected,
    #[error("dataset contains an unsupported file type")]
    UnsupportedFileType,
    #[error("dataset path escaped its root")]
    PathEscape,
    #[error("dataset paths must be UTF-8")]
    NonUtf8Path,
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Schema(#[from] tessaryn_schema::SchemaError),
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static SEQUENCE: AtomicU64 = AtomicU64::new(0);

    fn root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "tessaryn-layout-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ))
    }

    #[test]
    fn scannet_layout_produces_a_content_bound_real_sensor_receipt() {
        let root = root();
        for directory in ["color", "depth", "pose", "intrinsic"] {
            fs::create_dir_all(root.join(directory)).unwrap();
        }
        for index in 0..2 {
            fs::write(root.join(format!("color/{index}.jpg")), [index as u8]).unwrap();
            fs::write(root.join(format!("depth/{index}.png")), [index as u8, 1]).unwrap();
            fs::write(root.join(format!("pose/{index}.txt")), b"pose").unwrap();
            fs::write(root.join(format!("intrinsic/{index}.txt")), b"intrinsic").unwrap();
        }
        let receipt = inspect_dataset_layout("scannet", &root).unwrap();
        assert_eq!(receipt.source_class, DatasetSourceClass::RealSensor);
        assert_eq!(receipt.samples.primary, 2);
        fs::write(root.join("color/0.jpg"), b"changed").unwrap();
        let changed = inspect_dataset_layout("scannet", &root).unwrap();
        assert_ne!(receipt.content_root, changed.content_root);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn euroc_rejects_unsynchronized_stereo() {
        let root = root();
        for directory in [
            "mav0/cam0/data",
            "mav0/cam1/data",
            "mav0/imu0",
            "mav0/state_groundtruth_estimate0",
        ] {
            fs::create_dir_all(root.join(directory)).unwrap();
        }
        fs::write(root.join("mav0/cam0/data.csv"), "1,a\n2,b\n").unwrap();
        fs::write(root.join("mav0/cam1/data.csv"), "1,a\n3,b\n").unwrap();
        fs::write(root.join("mav0/imu0/data.csv"), "1,a\n2,b\n3,c\n").unwrap();
        fs::write(
            root.join("mav0/state_groundtruth_estimate0/data.csv"),
            "1,a\n2,b\n",
        )
        .unwrap();
        fs::write(root.join("mav0/cam0/data/1.png"), b"a").unwrap();
        fs::write(root.join("mav0/cam0/data/2.png"), b"b").unwrap();
        fs::write(root.join("mav0/cam1/data/1.png"), b"a").unwrap();
        fs::write(root.join("mav0/cam1/data/2.png"), b"b").unwrap();
        assert!(matches!(
            inspect_dataset_layout("euroc", &root),
            Err(DatasetLayoutError::SynchronizationMismatch)
        ));
        fs::remove_dir_all(root).unwrap();
    }
}
