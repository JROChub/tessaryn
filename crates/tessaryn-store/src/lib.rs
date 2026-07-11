//! Local content-addressed and stream-verifiable Cell storage.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use tessaryn_canonical::{canonical_bytes, cell_id, chunk_id, parse_manifest};
use tessaryn_schema::{CellManifestV0, Digest};
use thiserror::Error;

/// Default maximum accepted binary chunk size.
pub const DEFAULT_MAX_CHUNK_BYTES: u64 = 64 * 1024 * 1024;
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// Local content-addressed store.
#[derive(Debug, Clone)]
pub struct CellStore {
    root: PathBuf,
    max_chunk_bytes: u64,
}

impl CellStore {
    /// Opens or creates a store.
    pub fn open(root: impl Into<PathBuf>) -> Result<Self, StoreError> {
        let root = root.into();
        fs::create_dir_all(root.join("chunks"))?;
        fs::create_dir_all(root.join("manifests"))?;
        Ok(Self {
            root,
            max_chunk_bytes: DEFAULT_MAX_CHUNK_BYTES,
        })
    }

    /// Applies a lower caller-defined chunk size ceiling.
    pub fn with_max_chunk_bytes(mut self, maximum: u64) -> Self {
        self.max_chunk_bytes = maximum.min(DEFAULT_MAX_CHUNK_BYTES);
        self
    }

    /// Atomically stores one binary chunk and returns its content address.
    pub fn put_chunk(&self, bytes: &[u8]) -> Result<Digest, StoreError> {
        if bytes.len() as u64 > self.max_chunk_bytes {
            return Err(StoreError::ResourceLimit {
                found: bytes.len() as u64,
                maximum: self.max_chunk_bytes,
            });
        }
        let digest = chunk_id(bytes);
        let path = self.path_for("chunks", &digest);
        self.write_atomic(&path, bytes)?;
        Ok(digest)
    }

    /// Loads and re-verifies one binary chunk.
    pub fn get_chunk(&self, digest: &Digest) -> Result<Vec<u8>, StoreError> {
        let bytes = self.read_bounded(&self.path_for("chunks", digest), self.max_chunk_bytes)?;
        let actual = chunk_id(&bytes);
        if &actual != digest {
            return Err(StoreError::DigestMismatch {
                expected: digest.clone(),
                actual,
            });
        }
        Ok(bytes)
    }

    /// Stores one canonical Cell manifest.
    pub fn put_manifest(&self, manifest: &CellManifestV0) -> Result<Digest, StoreError> {
        let digest = cell_id(manifest)?;
        let bytes = canonical_bytes(manifest)?;
        self.write_atomic(&self.path_for("manifests", &digest), &bytes)?;
        Ok(digest)
    }

    /// Loads, strictly parses, and re-verifies one Cell manifest.
    pub fn get_manifest(&self, digest: &Digest) -> Result<CellManifestV0, StoreError> {
        let bytes = self.read_bounded(
            &self.path_for("manifests", digest),
            tessaryn_canonical::MAX_MANIFEST_BYTES as u64,
        )?;
        let manifest = parse_manifest(&bytes)?;
        let actual = cell_id(&manifest)?;
        if &actual != digest {
            return Err(StoreError::DigestMismatch {
                expected: digest.clone(),
                actual,
            });
        }
        Ok(manifest)
    }

    fn path_for(&self, namespace: &str, digest: &Digest) -> PathBuf {
        let hex = &digest.as_str()[7..];
        self.root
            .join(namespace)
            .join(&hex[..2])
            .join(format!("{}.bin", &hex[2..]))
    }

    fn write_atomic(&self, path: &Path, bytes: &[u8]) -> Result<(), StoreError> {
        if path.exists() {
            return Ok(());
        }
        let parent = path.parent().ok_or(StoreError::InvalidPath)?;
        fs::create_dir_all(parent)?;
        let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let temporary = parent.join(format!(".write-{}-{sequence}", std::process::id()));
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        match fs::rename(&temporary, path) {
            Ok(()) => Ok(()),
            Err(_) if path.exists() => {
                let _ = fs::remove_file(&temporary);
                Ok(())
            }
            Err(error) => {
                let _ = fs::remove_file(&temporary);
                Err(StoreError::Io(error))
            }
        }
    }

    fn read_bounded(&self, path: &Path, maximum: u64) -> Result<Vec<u8>, StoreError> {
        let metadata = fs::metadata(path)?;
        if metadata.len() > maximum {
            return Err(StoreError::ResourceLimit {
                found: metadata.len(),
                maximum,
            });
        }
        let file = File::open(path)?;
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        file.take(maximum.saturating_add(1))
            .read_to_end(&mut bytes)?;
        if bytes.len() as u64 > maximum {
            return Err(StoreError::ResourceLimit {
                found: bytes.len() as u64,
                maximum,
            });
        }
        Ok(bytes)
    }
}

/// Store error.
#[derive(Debug, Error)]
pub enum StoreError {
    /// File operation failed.
    #[error(transparent)]
    Io(#[from] std::io::Error),
    /// Canonicalization failed.
    #[error(transparent)]
    Canonical(#[from] tessaryn_canonical::CanonicalError),
    /// Stored bytes no longer match their address.
    #[error("content digest mismatch: expected {expected}, found {actual}")]
    DigestMismatch {
        /// Expected address.
        expected: Digest,
        /// Recalculated address.
        actual: Digest,
    },
    /// Content exceeded a resource limit.
    #[error("content size {found} exceeds {maximum} bytes")]
    ResourceLimit {
        /// Observed size.
        found: u64,
        /// Maximum size.
        maximum: u64,
    },
    /// Internal path construction failed.
    #[error("invalid store path")]
    InvalidPath,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary_store() -> PathBuf {
        std::env::temp_dir().join(format!(
            "tessaryn-store-test-{}-{}",
            std::process::id(),
            TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ))
    }

    #[test]
    fn chunks_round_trip_and_tampering_is_rejected() {
        let root = temporary_store();
        let store = CellStore::open(&root).unwrap();
        let digest = store.put_chunk(b"world-cell-chunk").unwrap();
        assert_eq!(store.get_chunk(&digest).unwrap(), b"world-cell-chunk");
        let path = store.path_for("chunks", &digest);
        fs::write(path, b"tampered").unwrap();
        assert!(matches!(
            store.get_chunk(&digest),
            Err(StoreError::DigestMismatch { .. })
        ));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn chunk_limit_is_enforced_before_write() {
        let root = temporary_store();
        let store = CellStore::open(&root).unwrap().with_max_chunk_bytes(4);
        assert!(matches!(
            store.put_chunk(b"12345"),
            Err(StoreError::ResourceLimit { .. })
        ));
        let _ = fs::remove_dir_all(root);
    }
}
