//! Durable, write-capable public Object Weave node.

#![forbid(unsafe_code)]

use axum::body::{Body, Bytes};
use axum::extract::{DefaultBodyLimit, Path as AxumPath, State};
use axum::http::header::{
    ACCEPT_RANGES, CACHE_CONTROL, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, ETAG, RANGE,
};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use std::collections::BTreeSet;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tessaryn_cli::artifact::{read_reconstruction_artifact, verify_reconstruction_artifact};
use tessaryn_cli::cinematic::verify_cinematic_object;
use thiserror::Error;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::sync::Mutex;
use tokio_util::io::ReaderStream;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::limit::RequestBodyLimitLayer;

const PUBLISH_SCHEMA: &str = "tessaryn/publication-intent/v1";
const SESSION_SCHEMA: &str = "tessaryn/upload-session/v1";
const RECEIPT_SCHEMA: &str = "tessaryn/publication-receipt/v1";
const REVOCATION_SCHEMA: &str = "tessaryn/publication-revocation/v1";
const CATALOG_SCHEMA: &str = "tessaryn/public-object-catalog/v2";
const POLICY_SCHEMA: &str = "tessaryn/weave-node-policy/v1";
const DEFAULT_CHUNK_BYTES: u32 = 4 * 1024 * 1024;
const DEFAULT_MAX_OBJECT_BYTES: u64 = 512 * 1024 * 1024;
const DEFAULT_MAX_PUBLISHER_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const DEFAULT_MAX_PENDING_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const DEFAULT_MAX_RETAINED_BYTES: u64 = 32 * 1024 * 1024 * 1024;
const DEFAULT_MAX_ACTIVE_UPLOADS: u32 = 32;
const DEFAULT_MAX_ACTIVE_UPLOADS_PER_PUBLISHER: u32 = 4;
const DEFAULT_MAX_PUBLICATIONS: u64 = 100_000;
const DEFAULT_MAX_PUBLICATIONS_PER_PUBLISHER: u64 = 1_000;
const DEFAULT_UPLOAD_TTL_SECONDS: u64 = 24 * 60 * 60;
const MAX_INTENT_BYTES: usize = 32 * 1024;
static TEMPORARY_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// Node policy advertised to publishers before they transfer artifact bytes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeaveNodePolicyV1 {
    pub schema: String,
    pub chunk_bytes: u32,
    pub max_object_bytes: u64,
    pub max_publisher_bytes: u64,
    pub max_pending_bytes: u64,
    pub max_retained_bytes: u64,
    pub max_active_uploads: u32,
    pub max_active_uploads_per_publisher: u32,
    pub max_publications: u64,
    pub max_publications_per_publisher: u64,
    pub upload_ttl_seconds: u64,
    pub accepted_artifacts: Vec<String>,
    pub immutable_content_identity: bool,
    pub revocable_discovery: bool,
}

/// Runtime settings for one independently operated Weave node.
#[derive(Debug, Clone)]
pub struct WeaveConfig {
    pub root: PathBuf,
    pub listen: SocketAddr,
    pub public_base_url: String,
    pub allowed_origins: Vec<String>,
    pub chunk_bytes: u32,
    pub max_object_bytes: u64,
    pub max_publisher_bytes: u64,
    pub max_pending_bytes: u64,
    pub max_retained_bytes: u64,
    pub max_active_uploads: u32,
    pub max_active_uploads_per_publisher: u32,
    pub max_publications: u64,
    pub max_publications_per_publisher: u64,
    pub upload_ttl_seconds: u64,
}

impl Default for WeaveConfig {
    fn default() -> Self {
        Self {
            root: PathBuf::from("./weave-data"),
            listen: "127.0.0.1:8790".parse().expect("static socket address"),
            public_base_url: "http://127.0.0.1:8790".to_string(),
            allowed_origins: vec![
                "https://tessaryn.com".to_string(),
                "https://www.tessaryn.com".to_string(),
                "http://127.0.0.1:5173".to_string(),
                "http://127.0.0.1:4180".to_string(),
            ],
            chunk_bytes: DEFAULT_CHUNK_BYTES,
            max_object_bytes: DEFAULT_MAX_OBJECT_BYTES,
            max_publisher_bytes: DEFAULT_MAX_PUBLISHER_BYTES,
            max_pending_bytes: DEFAULT_MAX_PENDING_BYTES,
            max_retained_bytes: DEFAULT_MAX_RETAINED_BYTES,
            max_active_uploads: DEFAULT_MAX_ACTIVE_UPLOADS,
            max_active_uploads_per_publisher: DEFAULT_MAX_ACTIVE_UPLOADS_PER_PUBLISHER,
            max_publications: DEFAULT_MAX_PUBLICATIONS,
            max_publications_per_publisher: DEFAULT_MAX_PUBLICATIONS_PER_PUBLISHER,
            upload_ttl_seconds: DEFAULT_UPLOAD_TTL_SECONDS,
        }
    }
}

impl WeaveConfig {
    /// Loads operational policy from environment variables.
    pub fn from_env() -> Result<Self, WeaveError> {
        let mut config = Self::default();
        if let Ok(value) = std::env::var("TESSARYN_WEAVE_ROOT") {
            config.root = PathBuf::from(value);
        }
        if let Ok(value) = std::env::var("TESSARYN_WEAVE_LISTEN") {
            config.listen = value
                .parse()
                .map_err(|_| WeaveError::Configuration("invalid listen address".to_string()))?;
        }
        if let Ok(value) = std::env::var("TESSARYN_WEAVE_PUBLIC_URL") {
            config.public_base_url = value.trim_end_matches('/').to_string();
        }
        if let Ok(value) = std::env::var("TESSARYN_WEAVE_ALLOWED_ORIGINS") {
            config.allowed_origins = value
                .split(',')
                .map(str::trim)
                .filter(|origin| !origin.is_empty())
                .map(str::to_string)
                .collect();
        }
        if let Ok(value) = std::env::var("TESSARYN_WEAVE_CHUNK_BYTES") {
            config.chunk_bytes = parse_positive(&value, "chunk bytes")?;
        }
        if let Ok(value) = std::env::var("TESSARYN_WEAVE_MAX_OBJECT_BYTES") {
            config.max_object_bytes = parse_positive(&value, "maximum object bytes")?;
        }
        if let Ok(value) = std::env::var("TESSARYN_WEAVE_MAX_PUBLISHER_BYTES") {
            config.max_publisher_bytes = parse_positive(&value, "maximum publisher bytes")?;
        }
        if let Ok(value) = std::env::var("TESSARYN_WEAVE_MAX_PENDING_BYTES") {
            config.max_pending_bytes = parse_positive(&value, "maximum pending bytes")?;
        }
        if let Ok(value) = std::env::var("TESSARYN_WEAVE_MAX_RETAINED_BYTES") {
            config.max_retained_bytes = parse_positive(&value, "maximum retained bytes")?;
        }
        if let Ok(value) = std::env::var("TESSARYN_WEAVE_MAX_ACTIVE_UPLOADS") {
            config.max_active_uploads = parse_positive(&value, "maximum active uploads")?;
        }
        if let Ok(value) = std::env::var("TESSARYN_WEAVE_MAX_ACTIVE_UPLOADS_PER_PUBLISHER") {
            config.max_active_uploads_per_publisher =
                parse_positive(&value, "maximum active uploads per publisher")?;
        }
        if let Ok(value) = std::env::var("TESSARYN_WEAVE_MAX_PUBLICATIONS") {
            config.max_publications = parse_positive(&value, "maximum publications")?;
        }
        if let Ok(value) = std::env::var("TESSARYN_WEAVE_MAX_PUBLICATIONS_PER_PUBLISHER") {
            config.max_publications_per_publisher =
                parse_positive(&value, "maximum publications per publisher")?;
        }
        if let Ok(value) = std::env::var("TESSARYN_WEAVE_UPLOAD_TTL_SECONDS") {
            config.upload_ttl_seconds = parse_positive(&value, "upload TTL seconds")?;
        }
        validate_config(&config)?;
        Ok(config)
    }

    pub fn policy(&self) -> WeaveNodePolicyV1 {
        WeaveNodePolicyV1 {
            schema: POLICY_SCHEMA.to_string(),
            chunk_bytes: self.chunk_bytes,
            max_object_bytes: self.max_object_bytes,
            max_publisher_bytes: self.max_publisher_bytes,
            max_pending_bytes: self.max_pending_bytes,
            max_retained_bytes: self.max_retained_bytes,
            max_active_uploads: self.max_active_uploads,
            max_active_uploads_per_publisher: self.max_active_uploads_per_publisher,
            max_publications: self.max_publications,
            max_publications_per_publisher: self.max_publications_per_publisher,
            upload_ttl_seconds: self.upload_ttl_seconds,
            accepted_artifacts: vec![
                "tessaryn/cinematic-object/v1".to_string(),
                "tessaryn/reconstruction-artifact/v0".to_string(),
            ],
            immutable_content_identity: true,
            revocable_discovery: true,
        }
    }
}

/// Publisher-signed declaration that binds human discovery metadata to exact bytes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublicationIntentV1 {
    pub schema: String,
    pub object_id: String,
    pub title: String,
    pub summary: String,
    pub artifact_sha256: String,
    pub artifact_bytes: u64,
    pub media_type: String,
    pub created_at_unix_us: i64,
    pub nonce: String,
    pub publisher_public_key: String,
    pub signature: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UploadSessionV1 {
    pub schema: String,
    pub upload_id: String,
    pub publisher_id: String,
    pub chunk_bytes: u32,
    pub chunk_count: u64,
    pub accepted_at_unix_us: i64,
    pub intent: PublicationIntentV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UploadStatusV1 {
    pub upload_id: String,
    pub chunk_count: u64,
    pub received_chunks: Vec<u64>,
    pub missing_chunks: Vec<u64>,
    pub ready_to_commit: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PublicArtifactKind {
    CinematicObject,
    RgbdReconstruction,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublicationReceiptV1 {
    pub schema: String,
    pub publication_id: String,
    pub publisher_id: String,
    pub accepted_at_unix_us: i64,
    pub artifact_kind: PublicArtifactKind,
    pub artifact_url: String,
    pub cell_id: String,
    pub rootprint_branch: String,
    pub moments: usize,
    pub dimensions: String,
    pub media: String,
    pub intent: PublicationIntentV1,
}

/// Publisher-signed removal from discovery; retained object bytes and identity are unchanged.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublicationRevocationV1 {
    pub schema: String,
    pub publication_id: String,
    pub created_at_unix_us: i64,
    pub nonce: String,
    pub signature: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublicObjectEntryV2 {
    pub publication_id: String,
    pub publisher_id: String,
    pub object_id: String,
    pub title: String,
    pub artifact: String,
    pub artifact_sha256: String,
    pub artifact_bytes: u64,
    pub artifact_kind: PublicArtifactKind,
    pub cell_id: String,
    pub rootprint_branch: String,
    pub media: String,
    pub dimensions: String,
    pub moments: usize,
    pub summary: String,
    pub accepted_at_unix_us: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublicObjectCatalogV2 {
    pub schema: String,
    pub updated_at_unix_us: i64,
    pub objects: Vec<PublicObjectEntryV2>,
}

/// Durable storage and verification state for one node.
#[derive(Clone)]
pub struct WeaveNode {
    config: Arc<WeaveConfig>,
    commit_lock: Arc<Mutex<()>>,
    upload_lock: Arc<std::sync::Mutex<()>>,
}

impl WeaveNode {
    pub fn open(config: WeaveConfig) -> Result<Self, WeaveError> {
        validate_config(&config)?;
        for directory in ["uploads", "objects", "publications", "revocations", "tmp"] {
            fs::create_dir_all(config.root.join(directory))?;
        }
        Ok(Self {
            config: Arc::new(config),
            commit_lock: Arc::new(Mutex::new(())),
            upload_lock: Arc::new(std::sync::Mutex::new(())),
        })
    }

    pub fn config(&self) -> &WeaveConfig {
        &self.config
    }

    pub fn begin_upload(&self, intent: PublicationIntentV1) -> Result<UploadSessionV1, WeaveError> {
        let identity = verify_publication_intent(&intent)?;
        if intent.artifact_bytes > self.config.max_object_bytes {
            return Err(WeaveError::Policy(format!(
                "object exceeds this node's {} byte admission policy",
                self.config.max_object_bytes
            )));
        }
        let chunk_count = intent
            .artifact_bytes
            .div_ceil(u64::from(self.config.chunk_bytes));
        let upload_id = upload_id(&identity.preimage, &identity.signature);
        let _guard = self
            .upload_lock
            .lock()
            .map_err(|_| WeaveError::Internal("upload coordinator is poisoned".to_string()))?;
        self.prune_stale_uploads()?;
        let directory = self.upload_directory(&upload_id)?;
        let path = directory.join("session.json");
        if path.exists() {
            let existing = read_json::<UploadSessionV1>(&path)?;
            if existing.schema != SESSION_SCHEMA
                || existing.upload_id != upload_id
                || existing.publisher_id != identity.publisher_id
                || existing.chunk_bytes != self.config.chunk_bytes
                || existing.chunk_count != chunk_count
                || existing.intent != intent
            {
                return Err(WeaveError::Conflict(
                    "upload identity collision".to_string(),
                ));
            }
            return Ok(existing);
        }
        self.enforce_pending_upload_policy(&identity.publisher_id, &intent)?;
        let accepted_at_unix_us = now_unix_us()?;
        let session = UploadSessionV1 {
            schema: SESSION_SCHEMA.to_string(),
            upload_id: upload_id.clone(),
            publisher_id: identity.publisher_id,
            chunk_bytes: self.config.chunk_bytes,
            chunk_count,
            accepted_at_unix_us,
            intent,
        };
        fs::create_dir_all(&directory)?;
        write_json_atomic(&path, &session)?;
        Ok(session)
    }

    pub fn store_chunk(
        &self,
        upload_id: &str,
        index: u64,
        declared_sha256: &str,
        bytes: &[u8],
    ) -> Result<UploadStatusV1, WeaveError> {
        let _guard = self
            .upload_lock
            .lock()
            .map_err(|_| WeaveError::Internal("upload coordinator is poisoned".to_string()))?;
        let session = self.read_session(upload_id)?;
        if self
            .upload_directory(upload_id)?
            .join("commit.active")
            .exists()
        {
            return Err(WeaveError::Conflict(
                "upload is already being committed".to_string(),
            ));
        }
        if index >= session.chunk_count {
            return Err(WeaveError::Malformed(
                "chunk index is outside the upload".to_string(),
            ));
        }
        let expected = expected_chunk_bytes(&session, index)?;
        if bytes.len() as u64 != expected {
            return Err(WeaveError::Malformed(format!(
                "chunk {index} must contain {expected} bytes"
            )));
        }
        let found = sha256_digest(bytes);
        if declared_sha256 != found {
            return Err(WeaveError::Integrity("chunk digest mismatch".to_string()));
        }
        let path = self.chunk_path(upload_id, index)?;
        if path.exists() {
            let existing = fs::read(&path)?;
            if sha256_digest(&existing) != found || existing != bytes {
                return Err(WeaveError::Conflict(
                    "chunk index already contains different bytes".to_string(),
                ));
            }
            return self.upload_status(upload_id);
        }
        write_bytes_atomic(&path, bytes)?;
        self.upload_status(upload_id)
    }

    pub fn upload_status(&self, upload_id: &str) -> Result<UploadStatusV1, WeaveError> {
        let session = self.read_session(upload_id)?;
        let mut received_chunks = Vec::new();
        let mut missing_chunks = Vec::new();
        for index in 0..session.chunk_count {
            if self.chunk_path(upload_id, index)?.is_file() {
                received_chunks.push(index);
            } else {
                missing_chunks.push(index);
            }
        }
        Ok(UploadStatusV1 {
            upload_id: upload_id.to_string(),
            chunk_count: session.chunk_count,
            ready_to_commit: missing_chunks.is_empty(),
            received_chunks,
            missing_chunks,
        })
    }

    pub async fn commit_upload(
        &self,
        upload_id: String,
    ) -> Result<PublicationReceiptV1, WeaveError> {
        let _guard = self.commit_lock.lock().await;
        let node = self.clone();
        tokio::task::spawn_blocking(move || node.commit_upload_blocking(&upload_id))
            .await
            .map_err(|error| WeaveError::Internal(error.to_string()))?
    }

    pub fn catalog(&self) -> Result<PublicObjectCatalogV2, WeaveError> {
        let revoked = file_stems(&self.config.root.join("revocations"))?;
        let mut receipts = Vec::new();
        for entry in fs::read_dir(self.config.root.join("publications"))? {
            let path = entry?.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            let receipt = read_json::<PublicationReceiptV1>(&path)?;
            if receipt.schema != RECEIPT_SCHEMA || revoked.contains(&receipt.publication_id) {
                continue;
            }
            receipts.push(receipt);
        }
        receipts.sort_by(|left, right| {
            right
                .accepted_at_unix_us
                .cmp(&left.accepted_at_unix_us)
                .then_with(|| left.publication_id.cmp(&right.publication_id))
        });
        let updated_at_unix_us = receipts
            .iter()
            .map(|receipt| receipt.accepted_at_unix_us)
            .max()
            .unwrap_or(0);
        let objects = receipts.into_iter().map(public_entry).collect();
        Ok(PublicObjectCatalogV2 {
            schema: CATALOG_SCHEMA.to_string(),
            updated_at_unix_us,
            objects,
        })
    }

    pub fn revoke_publication(
        &self,
        revocation: PublicationRevocationV1,
    ) -> Result<PublicationRevocationV1, WeaveError> {
        if revocation.schema != REVOCATION_SCHEMA || revocation.created_at_unix_us <= 0 {
            return Err(WeaveError::Malformed(
                "unsupported publication revocation".to_string(),
            ));
        }
        validate_prefixed_id(&revocation.publication_id, "obj_")?;
        let receipt_path = self
            .config
            .root
            .join("publications")
            .join(format!("{}.json", revocation.publication_id));
        let receipt = read_json::<PublicationReceiptV1>(&receipt_path)?;
        let public_key =
            decode_exact::<32>(&receipt.intent.publisher_public_key, "publisher public key")?;
        let nonce = decode_exact::<32>(&revocation.nonce, "revocation nonce")?;
        let signature = decode_exact::<64>(&revocation.signature, "revocation signature")?;
        let preimage = revocation_preimage(
            &revocation.publication_id,
            revocation.created_at_unix_us,
            &nonce,
            &public_key,
        )?;
        VerifyingKey::from_bytes(&public_key)
            .map_err(|_| WeaveError::Signature("publisher key is invalid".to_string()))?
            .verify_strict(&preimage, &Signature::from_bytes(&signature))
            .map_err(|_| WeaveError::Signature("revocation signature rejected".to_string()))?;
        let path = self
            .config
            .root
            .join("revocations")
            .join(format!("{}.json", revocation.publication_id));
        if path.exists() {
            let existing = read_json::<PublicationRevocationV1>(&path)?;
            if existing != revocation {
                return Err(WeaveError::Conflict(
                    "publication was already revoked by a different signed statement".to_string(),
                ));
            }
            return Ok(existing);
        }
        write_json_atomic(&path, &revocation)?;
        Ok(revocation)
    }

    fn commit_upload_blocking(&self, upload_id: &str) -> Result<PublicationReceiptV1, WeaveError> {
        validate_prefixed_id(upload_id, "upl_")?;
        let existing_receipt = self
            .config
            .root
            .join("publications")
            .join(format!("{}.json", publication_id(upload_id)));
        if existing_receipt.exists() {
            return read_json(&existing_receipt);
        }
        let _marker = self.begin_commit_marker(upload_id)?;
        let session = self.read_session(upload_id)?;
        let status = self.upload_status(upload_id)?;
        if !status.ready_to_commit {
            return Err(WeaveError::Conflict(format!(
                "{} chunks remain missing",
                status.missing_chunks.len()
            )));
        }
        self.enforce_publisher_quota(&session)?;
        let temporary = self
            .config
            .root
            .join("tmp")
            .join(format!("{upload_id}.artifact.tmp"));
        if temporary.exists() {
            fs::remove_file(&temporary)?;
        }
        let mut output = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)?;
        let mut hasher = Sha256::new();
        for index in 0..session.chunk_count {
            let mut input = File::open(self.chunk_path(upload_id, index)?)?;
            let copied = copy_and_hash(&mut input, &mut output, &mut hasher)?;
            if copied != expected_chunk_bytes(&session, index)? {
                let _ = fs::remove_file(&temporary);
                return Err(WeaveError::Integrity(format!(
                    "chunk {index} changed before commit"
                )));
            }
        }
        output.sync_all()?;
        drop(output);
        let found = format!("sha256:{}", hex::encode(hasher.finalize()));
        if found != session.intent.artifact_sha256
            || fs::metadata(&temporary)?.len() != session.intent.artifact_bytes
        {
            let _ = fs::remove_file(&temporary);
            return Err(WeaveError::Integrity(
                "assembled artifact does not match the signed publication intent".to_string(),
            ));
        }
        let admitted = verify_admitted_artifact(&temporary, &session.intent)?;
        let object_path = self.artifact_path(&found)?;
        if object_path.exists() {
            if fs::metadata(&object_path)?.len() != session.intent.artifact_bytes
                || sha256_file(&object_path)? != found
            {
                let _ = fs::remove_file(&temporary);
                return Err(WeaveError::Integrity(
                    "content-addressed store contains conflicting bytes".to_string(),
                ));
            }
            fs::remove_file(&temporary)?;
        } else {
            fs::rename(&temporary, &object_path)?;
            sync_parent(&object_path)?;
        }
        let publication_id = publication_id(upload_id);
        let receipt = PublicationReceiptV1 {
            schema: RECEIPT_SCHEMA.to_string(),
            publication_id: publication_id.clone(),
            publisher_id: session.publisher_id,
            accepted_at_unix_us: now_unix_us()?,
            artifact_kind: admitted.kind,
            artifact_url: format!(
                "{}/v1/artifacts/{}",
                self.config.public_base_url,
                digest_hex(&found)?
            ),
            cell_id: admitted.cell_id,
            rootprint_branch: admitted.rootprint_branch,
            moments: admitted.moments,
            dimensions: admitted.dimensions,
            media: admitted.media,
            intent: session.intent,
        };
        write_json_atomic(&existing_receipt, &receipt)?;
        fs::remove_dir_all(self.upload_directory(upload_id)?)?;
        Ok(receipt)
    }

    fn enforce_publisher_quota(&self, session: &UploadSessionV1) -> Result<(), WeaveError> {
        let mut retained_digests = BTreeSet::new();
        let mut used = 0_u64;
        let mut publications = 0_u64;
        let mut publisher_publications = 0_u64;
        for entry in fs::read_dir(self.config.root.join("publications"))? {
            let path = entry?.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            let receipt = read_json::<PublicationReceiptV1>(&path)?;
            publications = publications.saturating_add(1);
            if receipt.publisher_id == session.publisher_id {
                publisher_publications = publisher_publications.saturating_add(1);
                if retained_digests.insert(receipt.intent.artifact_sha256.clone()) {
                    used = used
                        .checked_add(receipt.intent.artifact_bytes)
                        .ok_or_else(|| {
                            WeaveError::Policy("publisher byte accounting overflow".to_string())
                        })?;
                }
            }
        }
        if publications >= self.config.max_publications {
            return Err(WeaveError::Policy(
                "node has reached its publication receipt capacity".to_string(),
            ));
        }
        if publisher_publications >= self.config.max_publications_per_publisher {
            return Err(WeaveError::Policy(
                "publisher has reached its publication receipt capacity".to_string(),
            ));
        }
        let additional = if retained_digests.contains(&session.intent.artifact_sha256) {
            0
        } else {
            session.intent.artifact_bytes
        };
        if used.saturating_add(additional) > self.config.max_publisher_bytes {
            return Err(WeaveError::Policy(
                "publisher exceeds this node's durable storage allocation".to_string(),
            ));
        }
        let retained_bytes = retained_object_bytes(&self.config.root.join("objects"))?;
        let global_additional = if self
            .artifact_path(&session.intent.artifact_sha256)?
            .exists()
        {
            0
        } else {
            session.intent.artifact_bytes
        };
        if retained_bytes.saturating_add(global_additional) > self.config.max_retained_bytes {
            return Err(WeaveError::Policy(
                "node has reached its retained byte allocation".to_string(),
            ));
        }
        Ok(())
    }

    fn enforce_pending_upload_policy(
        &self,
        publisher_id: &str,
        intent: &PublicationIntentV1,
    ) -> Result<(), WeaveError> {
        let mut active = 0_u32;
        let mut publisher_active = 0_u32;
        let mut pending_bytes = 0_u64;
        for entry in fs::read_dir(self.config.root.join("uploads"))? {
            let path = entry?.path();
            if !path.is_dir() {
                continue;
            }
            let session = read_json::<UploadSessionV1>(&path.join("session.json"))?;
            active = active.saturating_add(1);
            if session.publisher_id == publisher_id {
                publisher_active = publisher_active.saturating_add(1);
            }
            pending_bytes = pending_bytes
                .checked_add(session.intent.artifact_bytes)
                .ok_or_else(|| {
                    WeaveError::Policy("pending byte accounting overflow".to_string())
                })?;
        }
        if active >= self.config.max_active_uploads {
            return Err(WeaveError::Policy(
                "node has reached its active upload capacity".to_string(),
            ));
        }
        if publisher_active >= self.config.max_active_uploads_per_publisher {
            return Err(WeaveError::Policy(
                "publisher has reached its active upload capacity".to_string(),
            ));
        }
        if pending_bytes.saturating_add(intent.artifact_bytes) > self.config.max_pending_bytes {
            return Err(WeaveError::Policy(
                "node has reached its pending byte allocation".to_string(),
            ));
        }
        let retained_bytes = retained_object_bytes(&self.config.root.join("objects"))?;
        let retained_additional = if self.artifact_path(&intent.artifact_sha256)?.exists() {
            0
        } else {
            intent.artifact_bytes
        };
        if retained_bytes
            .saturating_add(pending_bytes)
            .saturating_add(retained_additional)
            > self.config.max_retained_bytes
        {
            return Err(WeaveError::Policy(
                "node cannot reserve the requested retained bytes".to_string(),
            ));
        }
        let (publications, publisher_publications) =
            publication_counts(&self.config.root.join("publications"), publisher_id)?;
        if publications >= self.config.max_publications
            || publisher_publications >= self.config.max_publications_per_publisher
        {
            return Err(WeaveError::Policy(
                "node or publisher publication receipt capacity is exhausted".to_string(),
            ));
        }
        Ok(())
    }

    fn prune_stale_uploads(&self) -> Result<(), WeaveError> {
        let ttl = std::time::Duration::from_secs(self.config.upload_ttl_seconds);
        let abandoned_commit_ttl = ttl.saturating_mul(4);
        let now = SystemTime::now();
        for entry in fs::read_dir(self.config.root.join("uploads"))? {
            let path = entry?.path();
            if !path.is_dir() {
                continue;
            }
            let last_activity = directory_last_modified(&path)?;
            let age = now.duration_since(last_activity).unwrap_or_default();
            let committing = path.join("commit.active").is_file();
            if (!committing && age > ttl) || (committing && age > abandoned_commit_ttl) {
                fs::remove_dir_all(path)?;
            }
        }
        Ok(())
    }

    fn begin_commit_marker(&self, upload_id: &str) -> Result<CommitMarker, WeaveError> {
        let _guard = self
            .upload_lock
            .lock()
            .map_err(|_| WeaveError::Internal("upload coordinator is poisoned".to_string()))?;
        self.read_session(upload_id)?;
        let path = self.upload_directory(upload_id)?.join("commit.active");
        let mut marker = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&path)
            .map_err(|error| match error.kind() {
                std::io::ErrorKind::AlreadyExists => {
                    WeaveError::Conflict("upload is already being committed".to_string())
                }
                _ => WeaveError::Storage(error),
            })?;
        marker.write_all(b"tessaryn/upload-commit/v1\n")?;
        marker.sync_all()?;
        Ok(CommitMarker { path })
    }

    fn read_session(&self, upload_id: &str) -> Result<UploadSessionV1, WeaveError> {
        let path = self.upload_directory(upload_id)?.join("session.json");
        let session = read_json::<UploadSessionV1>(&path)?;
        if session.schema != SESSION_SCHEMA || session.upload_id != upload_id {
            return Err(WeaveError::Integrity(
                "invalid persisted upload session".to_string(),
            ));
        }
        verify_publication_intent(&session.intent)?;
        Ok(session)
    }

    fn upload_directory(&self, upload_id: &str) -> Result<PathBuf, WeaveError> {
        validate_prefixed_id(upload_id, "upl_")?;
        Ok(self.config.root.join("uploads").join(upload_id))
    }

    fn chunk_path(&self, upload_id: &str, index: u64) -> Result<PathBuf, WeaveError> {
        Ok(self
            .upload_directory(upload_id)?
            .join(format!("chunk-{index:016}.bin")))
    }

    fn artifact_path(&self, digest: &str) -> Result<PathBuf, WeaveError> {
        Ok(self.config.root.join("objects").join(digest_hex(digest)?))
    }
}

struct CommitMarker {
    path: PathBuf,
}

impl Drop for CommitMarker {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

#[derive(Debug)]
struct VerifiedIntent {
    preimage: Vec<u8>,
    signature: [u8; 64],
    publisher_id: String,
}

#[derive(Debug)]
struct AdmittedArtifact {
    kind: PublicArtifactKind,
    cell_id: String,
    rootprint_branch: String,
    moments: usize,
    dimensions: String,
    media: String,
}

/// Errors retain exact rejection classes for API clients and operators.
#[derive(Debug, Error)]
pub enum WeaveError {
    #[error("configuration: {0}")]
    Configuration(String),
    #[error("malformed: {0}")]
    Malformed(String),
    #[error("signature: {0}")]
    Signature(String),
    #[error("integrity: {0}")]
    Integrity(String),
    #[error("policy: {0}")]
    Policy(String),
    #[error("conflict: {0}")]
    Conflict(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("storage: {0}")]
    Storage(#[from] std::io::Error),
    #[error("internal: {0}")]
    Internal(String),
}

/// Builds the public HTTP API for a node.
pub fn router(node: WeaveNode) -> Result<Router, WeaveError> {
    let origins = node
        .config
        .allowed_origins
        .iter()
        .map(|origin| {
            origin
                .parse::<HeaderValue>()
                .map_err(|_| WeaveError::Configuration(format!("invalid CORS origin {origin}")))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::OPTIONS])
        .allow_headers([
            axum::http::header::CONTENT_TYPE,
            axum::http::header::RANGE,
            HeaderName::from_static("x-tessaryn-chunk-sha256"),
        ])
        .expose_headers([CONTENT_LENGTH, CONTENT_RANGE, ETAG, ACCEPT_RANGES]);
    let body_limit = usize::try_from(node.config.chunk_bytes)
        .map_err(|_| WeaveError::Configuration("chunk body limit overflow".to_string()))?
        .saturating_add(MAX_INTENT_BYTES);
    Ok(Router::new()
        .route("/healthz", get(health))
        .route("/v1/policy", get(policy))
        .route("/v1/catalog", get(catalog))
        .route("/v1/uploads", post(begin_upload))
        .route("/v1/uploads/{upload_id}", get(upload_status))
        .route("/v1/uploads/{upload_id}/chunks/{index}", put(store_chunk))
        .route("/v1/uploads/{upload_id}/commit", post(commit_upload))
        .route("/v1/publications/revoke", post(revoke_publication))
        .route("/v1/artifacts/{digest}", get(get_artifact))
        .layer(DefaultBodyLimit::disable())
        .layer(RequestBodyLimitLayer::new(body_limit))
        .layer(cors)
        .with_state(node))
}

async fn health(State(node): State<WeaveNode>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "schema": "tessaryn/weave-health/v1",
        "status": "ok",
        "policy": node.config.policy(),
    }))
}

async fn policy(State(node): State<WeaveNode>) -> Json<WeaveNodePolicyV1> {
    Json(node.config.policy())
}

async fn catalog(State(node): State<WeaveNode>) -> Result<Json<PublicObjectCatalogV2>, ApiError> {
    let catalog = tokio::task::spawn_blocking(move || node.catalog())
        .await
        .map_err(|error| WeaveError::Internal(error.to_string()))??;
    Ok(Json(catalog))
}

async fn begin_upload(
    State(node): State<WeaveNode>,
    Json(intent): Json<PublicationIntentV1>,
) -> Result<(StatusCode, Json<UploadSessionV1>), ApiError> {
    let session = tokio::task::spawn_blocking(move || node.begin_upload(intent))
        .await
        .map_err(|error| WeaveError::Internal(error.to_string()))??;
    Ok((StatusCode::CREATED, Json(session)))
}

async fn upload_status(
    State(node): State<WeaveNode>,
    AxumPath(upload_id): AxumPath<String>,
) -> Result<Json<UploadStatusV1>, ApiError> {
    let status = tokio::task::spawn_blocking(move || node.upload_status(&upload_id))
        .await
        .map_err(|error| WeaveError::Internal(error.to_string()))??;
    Ok(Json(status))
}

async fn store_chunk(
    State(node): State<WeaveNode>,
    AxumPath((upload_id, index)): AxumPath<(String, u64)>,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<Json<UploadStatusV1>, ApiError> {
    let digest = headers
        .get("x-tessaryn-chunk-sha256")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| WeaveError::Malformed("chunk digest header is required".to_string()))?
        .to_string();
    let status =
        tokio::task::spawn_blocking(move || node.store_chunk(&upload_id, index, &digest, &bytes))
            .await
            .map_err(|error| WeaveError::Internal(error.to_string()))??;
    Ok(Json(status))
}

async fn commit_upload(
    State(node): State<WeaveNode>,
    AxumPath(upload_id): AxumPath<String>,
) -> Result<(StatusCode, Json<PublicationReceiptV1>), ApiError> {
    let receipt = node.commit_upload(upload_id).await?;
    Ok((StatusCode::CREATED, Json(receipt)))
}

async fn revoke_publication(
    State(node): State<WeaveNode>,
    Json(revocation): Json<PublicationRevocationV1>,
) -> Result<Json<PublicationRevocationV1>, ApiError> {
    let accepted = tokio::task::spawn_blocking(move || node.revoke_publication(revocation))
        .await
        .map_err(|error| WeaveError::Internal(error.to_string()))??;
    Ok(Json(accepted))
}

async fn get_artifact(
    State(node): State<WeaveNode>,
    AxumPath(digest): AxumPath<String>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let digest = format!("sha256:{digest}");
    let path = node.artifact_path(&digest)?;
    let mut file = tokio::fs::File::open(&path)
        .await
        .map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => {
                WeaveError::NotFound("artifact is not retained by this node".to_string())
            }
            _ => WeaveError::Storage(error),
        })?;
    let total = file.metadata().await.map_err(WeaveError::Storage)?.len();
    let range = headers
        .get(RANGE)
        .and_then(|value| value.to_str().ok())
        .map(|value| parse_byte_range(value, total))
        .transpose()?;
    let (status, start, length) = match range {
        Some((start, end)) => {
            file.seek(std::io::SeekFrom::Start(start))
                .await
                .map_err(WeaveError::Storage)?;
            (StatusCode::PARTIAL_CONTENT, start, end - start + 1)
        }
        None => (StatusCode::OK, 0, total),
    };
    let stream = ReaderStream::new(file.take(length));
    let mut response = Response::new(Body::from_stream(stream));
    *response.status_mut() = status;
    let response_headers = response.headers_mut();
    response_headers.insert(
        CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    response_headers.insert(
        CONTENT_LENGTH,
        HeaderValue::from_str(&length.to_string())
            .map_err(|_| WeaveError::Internal("invalid content length".to_string()))?,
    );
    response_headers.insert(ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    response_headers.insert(
        CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=31536000, immutable"),
    );
    response_headers.insert(
        ETAG,
        HeaderValue::from_str(&format!("\"{}\"", digest_hex(&digest)?))
            .map_err(|_| WeaveError::Internal("invalid artifact ETag".to_string()))?,
    );
    if status == StatusCode::PARTIAL_CONTENT {
        response_headers.insert(
            CONTENT_RANGE,
            HeaderValue::from_str(&format!("bytes {start}-{}/{total}", start + length - 1))
                .map_err(|_| WeaveError::Internal("invalid content range".to_string()))?,
        );
    }
    Ok(response)
}

#[derive(Debug, Serialize)]
struct ApiErrorBody {
    schema: &'static str,
    code: &'static str,
    detail: String,
}

struct ApiError(WeaveError);

impl From<WeaveError> for ApiError {
    fn from(value: WeaveError) -> Self {
        Self(value)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code) = match &self.0 {
            WeaveError::Configuration(_) | WeaveError::Internal(_) | WeaveError::Storage(_) => {
                (StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL")
            }
            WeaveError::Malformed(_) => (StatusCode::BAD_REQUEST, "MALFORMED"),
            WeaveError::Signature(_) => (StatusCode::UNAUTHORIZED, "SIGNATURE_INVALID"),
            WeaveError::Integrity(_) => (StatusCode::UNPROCESSABLE_ENTITY, "INTEGRITY_REJECTED"),
            WeaveError::Policy(_) => (StatusCode::PAYLOAD_TOO_LARGE, "POLICY_REJECTED"),
            WeaveError::Conflict(_) => (StatusCode::CONFLICT, "STATE_CONFLICT"),
            WeaveError::NotFound(_) => (StatusCode::NOT_FOUND, "NOT_FOUND"),
        };
        (
            status,
            Json(ApiErrorBody {
                schema: "tessaryn/weave-error/v1",
                code,
                detail: self.0.to_string(),
            }),
        )
            .into_response()
    }
}

fn verify_publication_intent(intent: &PublicationIntentV1) -> Result<VerifiedIntent, WeaveError> {
    if intent.schema != PUBLISH_SCHEMA {
        return Err(WeaveError::Malformed(
            "unsupported publication intent schema".to_string(),
        ));
    }
    validate_object_id(&intent.object_id)?;
    validate_text(&intent.title, 160, "title")?;
    validate_text(&intent.summary, 500, "summary")?;
    validate_text(&intent.media_type, 120, "media type")?;
    if intent.artifact_bytes == 0 || intent.created_at_unix_us <= 0 {
        return Err(WeaveError::Malformed(
            "artifact bytes and creation time must be positive".to_string(),
        ));
    }
    digest_hex(&intent.artifact_sha256)?;
    let nonce = decode_exact::<32>(&intent.nonce, "publication nonce")?;
    let public_key = decode_exact::<32>(&intent.publisher_public_key, "publisher key")?;
    let signature = decode_exact::<64>(&intent.signature, "publication signature")?;
    let preimage = publication_preimage(intent, &nonce, &public_key)?;
    let verifying_key = VerifyingKey::from_bytes(&public_key)
        .map_err(|_| WeaveError::Signature("publisher key is invalid".to_string()))?;
    verifying_key
        .verify_strict(&preimage, &Signature::from_bytes(&signature))
        .map_err(|_| WeaveError::Signature("publication signature rejected".to_string()))?;
    Ok(VerifiedIntent {
        preimage,
        signature,
        publisher_id: publisher_id(&public_key),
    })
}

/// Stable binary preimage used by both browser and node Ed25519 implementations.
pub fn publication_preimage(
    intent: &PublicationIntentV1,
    nonce: &[u8; 32],
    public_key: &[u8; 32],
) -> Result<Vec<u8>, WeaveError> {
    let mut output = b"TESSARYN-WEAVE-PUBLICATION-v1\0".to_vec();
    append_field(&mut output, intent.object_id.as_bytes())?;
    append_field(&mut output, intent.title.as_bytes())?;
    append_field(&mut output, intent.summary.as_bytes())?;
    append_field(&mut output, intent.artifact_sha256.as_bytes())?;
    output.extend_from_slice(&intent.artifact_bytes.to_le_bytes());
    append_field(&mut output, intent.media_type.as_bytes())?;
    output.extend_from_slice(&intent.created_at_unix_us.to_le_bytes());
    output.extend_from_slice(nonce);
    output.extend_from_slice(public_key);
    Ok(output)
}

/// Stable preimage for removing one publication from discovery.
pub fn revocation_preimage(
    publication_id: &str,
    created_at_unix_us: i64,
    nonce: &[u8; 32],
    public_key: &[u8; 32],
) -> Result<Vec<u8>, WeaveError> {
    validate_prefixed_id(publication_id, "obj_")?;
    if created_at_unix_us <= 0 {
        return Err(WeaveError::Malformed(
            "revocation creation time must be positive".to_string(),
        ));
    }
    let mut output = b"TESSARYN-WEAVE-REVOCATION-v1\0".to_vec();
    append_field(&mut output, publication_id.as_bytes())?;
    output.extend_from_slice(&created_at_unix_us.to_le_bytes());
    output.extend_from_slice(nonce);
    output.extend_from_slice(public_key);
    Ok(output)
}

fn verify_admitted_artifact(
    path: &Path,
    intent: &PublicationIntentV1,
) -> Result<AdmittedArtifact, WeaveError> {
    let mut prefix = [0_u8; 16];
    let mut input = File::open(path)?;
    let read = input.read(&mut prefix)?;
    if read == prefix.len() && &prefix == b"TESSARYN-CIN4D\0\0" {
        let report = verify_cinematic_object(path)
            .map_err(|error| WeaveError::Integrity(error.to_string()))?;
        if report.object_id != intent.object_id {
            return Err(WeaveError::Integrity(
                "signed object ID does not match the cinematic descriptor".to_string(),
            ));
        }
        return Ok(AdmittedArtifact {
            kind: PublicArtifactKind::CinematicObject,
            cell_id: report.cell_id.to_string(),
            rootprint_branch: report.rootprint_branch,
            moments: report.moments,
            dimensions: "NATIVE 3D + BRANCH-AWARE TIME".to_string(),
            media: format!(
                "{}x{} {} / {} CHUNKS",
                report.media_width,
                report.media_height,
                report.media_codec.to_uppercase(),
                report.media_chunks
            ),
        });
    }
    let artifact = read_reconstruction_artifact(path)
        .map_err(|error| WeaveError::Integrity(error.to_string()))?;
    let verification = verify_reconstruction_artifact(&artifact)
        .map_err(|error| WeaveError::Integrity(error.to_string()))?;
    Ok(AdmittedArtifact {
        kind: PublicArtifactKind::RgbdReconstruction,
        cell_id: artifact.report.sdf_cell_id.to_string(),
        rootprint_branch: artifact.lineage.rootprint.root_branch,
        moments: 1,
        dimensions: "REAL RGB-D / NATIVE 3D + TIME".to_string(),
        media: format!(
            "{} SURFELS / {} SDF VOXELS",
            verification.verified_surfels, verification.verified_voxels
        ),
    })
}

fn public_entry(receipt: PublicationReceiptV1) -> PublicObjectEntryV2 {
    PublicObjectEntryV2 {
        publication_id: receipt.publication_id,
        publisher_id: receipt.publisher_id,
        object_id: receipt.intent.object_id,
        title: receipt.intent.title,
        artifact: receipt.artifact_url,
        artifact_sha256: receipt.intent.artifact_sha256,
        artifact_bytes: receipt.intent.artifact_bytes,
        artifact_kind: receipt.artifact_kind,
        cell_id: receipt.cell_id,
        rootprint_branch: receipt.rootprint_branch,
        media: receipt.media,
        dimensions: receipt.dimensions,
        moments: receipt.moments,
        summary: receipt.intent.summary,
        accepted_at_unix_us: receipt.accepted_at_unix_us,
    }
}

fn expected_chunk_bytes(session: &UploadSessionV1, index: u64) -> Result<u64, WeaveError> {
    let start = index
        .checked_mul(u64::from(session.chunk_bytes))
        .ok_or_else(|| WeaveError::Malformed("chunk offset overflow".to_string()))?;
    Ok(session
        .intent
        .artifact_bytes
        .saturating_sub(start)
        .min(u64::from(session.chunk_bytes)))
}

fn append_field(output: &mut Vec<u8>, value: &[u8]) -> Result<(), WeaveError> {
    let length = u32::try_from(value.len())
        .map_err(|_| WeaveError::Malformed("publication field is too large".to_string()))?;
    output.extend_from_slice(&length.to_le_bytes());
    output.extend_from_slice(value);
    Ok(())
}

fn decode_exact<const N: usize>(value: &str, label: &str) -> Result<[u8; N], WeaveError> {
    let decoded = STANDARD_NO_PAD
        .decode(value)
        .map_err(|_| WeaveError::Malformed(format!("{label} is not canonical Base64")))?;
    if decoded.len() != N || STANDARD_NO_PAD.encode(&decoded) != value {
        return Err(WeaveError::Malformed(format!(
            "{label} must be canonical unpadded Base64"
        )));
    }
    decoded
        .try_into()
        .map_err(|_| WeaveError::Malformed(format!("{label} has the wrong length")))
}

fn upload_id(preimage: &[u8], signature: &[u8; 64]) -> String {
    prefixed_hash(b"TESSARYN-UPLOAD-ID-v1\0", &[preimage, signature], "upl_")
}

fn publication_id(upload_id: &str) -> String {
    prefixed_hash(
        b"TESSARYN-PUBLICATION-ID-v1\0",
        &[upload_id.as_bytes()],
        "obj_",
    )
}

fn publisher_id(public_key: &[u8; 32]) -> String {
    prefixed_hash(b"TESSARYN-PUBLISHER-ID-v1\0", &[public_key], "key_")
}

fn prefixed_hash(domain: &[u8], parts: &[&[u8]], prefix: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    for part in parts {
        hasher.update((part.len() as u64).to_le_bytes());
        hasher.update(part);
    }
    format!("{prefix}{}", hex::encode(hasher.finalize()))
}

fn sha256_digest(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

fn sha256_file(path: &Path) -> Result<String, WeaveError> {
    let mut input = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let read = input.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("sha256:{}", hex::encode(hasher.finalize())))
}

fn copy_and_hash(
    input: &mut File,
    output: &mut File,
    hasher: &mut Sha256,
) -> Result<u64, WeaveError> {
    let mut copied = 0_u64;
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let read = input.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        output.write_all(&buffer[..read])?;
        hasher.update(&buffer[..read]);
        copied = copied
            .checked_add(read as u64)
            .ok_or_else(|| WeaveError::Integrity("artifact byte count overflow".to_string()))?;
    }
    Ok(copied)
}

fn digest_hex(digest: &str) -> Result<&str, WeaveError> {
    let value = digest
        .strip_prefix("sha256:")
        .ok_or_else(|| WeaveError::Malformed("SHA-256 digest prefix is required".to_string()))?;
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(WeaveError::Malformed(
            "SHA-256 digest must contain 64 lowercase hexadecimal characters".to_string(),
        ));
    }
    Ok(value)
}

fn validate_object_id(value: &str) -> Result<(), WeaveError> {
    if value.len() < 3
        || value.len() > 96
        || value.starts_with('-')
        || value.ends_with('-')
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    {
        return Err(WeaveError::Malformed(
            "object ID must be a 3-96 character lowercase slug".to_string(),
        ));
    }
    Ok(())
}

fn validate_prefixed_id(value: &str, prefix: &str) -> Result<(), WeaveError> {
    let suffix = value
        .strip_prefix(prefix)
        .ok_or_else(|| WeaveError::Malformed("invalid content identifier".to_string()))?;
    if suffix.len() != 64
        || !suffix
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(WeaveError::Malformed(
            "invalid content identifier".to_string(),
        ));
    }
    Ok(())
}

fn validate_text(value: &str, max: usize, label: &str) -> Result<(), WeaveError> {
    if value.trim() != value
        || value.is_empty()
        || value.len() > max
        || value
            .chars()
            .any(|character| character.is_control() || is_hidden_format_control(character))
    {
        return Err(WeaveError::Malformed(format!(
            "invalid publication {label}"
        )));
    }
    Ok(())
}

fn is_hidden_format_control(character: char) -> bool {
    matches!(
        character,
        '\u{061c}'
            | '\u{200b}'..='\u{200f}'
            | '\u{202a}'..='\u{202e}'
            | '\u{2060}'..='\u{2069}'
            | '\u{feff}'
    )
}

fn validate_config(config: &WeaveConfig) -> Result<(), WeaveError> {
    if config.chunk_bytes < 64 * 1024
        || config.chunk_bytes > 64 * 1024 * 1024
        || !config.chunk_bytes.is_power_of_two()
        || config.max_object_bytes < u64::from(config.chunk_bytes)
        || config.max_publisher_bytes < config.max_object_bytes
        || config.max_pending_bytes < config.max_object_bytes
        || config.max_retained_bytes < config.max_publisher_bytes
        || config.max_active_uploads == 0
        || config.max_active_uploads_per_publisher == 0
        || config.max_active_uploads_per_publisher > config.max_active_uploads
        || config.max_publications == 0
        || config.max_publications_per_publisher == 0
        || config.max_publications_per_publisher > config.max_publications
        || config.upload_ttl_seconds < 60
        || !config.public_base_url.starts_with("http")
        || config.allowed_origins.is_empty()
    {
        return Err(WeaveError::Configuration(
            "node policy is inconsistent or unsafe".to_string(),
        ));
    }
    Ok(())
}

fn parse_positive<T>(value: &str, label: &str) -> Result<T, WeaveError>
where
    T: std::str::FromStr + PartialEq + Default,
{
    let parsed = value
        .parse::<T>()
        .map_err(|_| WeaveError::Configuration(format!("invalid {label}")))?;
    if parsed == T::default() {
        return Err(WeaveError::Configuration(format!(
            "{label} must be positive"
        )));
    }
    Ok(parsed)
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, WeaveError> {
    let bytes = fs::read(path).map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound => {
            WeaveError::NotFound(format!("{} is unavailable", path.display()))
        }
        _ => WeaveError::Storage(error),
    })?;
    serde_json::from_slice(&bytes)
        .map_err(|error| WeaveError::Integrity(format!("invalid persisted JSON: {error}")))
}

fn write_json_atomic(path: &Path, value: &impl Serialize) -> Result<(), WeaveError> {
    let bytes = serde_json::to_vec(value)
        .map_err(|error| WeaveError::Internal(format!("JSON serialization failed: {error}")))?;
    write_bytes_atomic(path, &bytes)
}

fn write_bytes_atomic(path: &Path, bytes: &[u8]) -> Result<(), WeaveError> {
    let sequence = TEMPORARY_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let temporary = path.with_extension(format!("tmp-{}-{sequence}", std::process::id()));
    let mut output = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)?;
    output.write_all(bytes)?;
    output.sync_all()?;
    drop(output);
    match fs::rename(&temporary, path) {
        Ok(()) => sync_parent(path),
        Err(_error) if path.exists() => {
            let _ = fs::remove_file(&temporary);
            let existing = fs::read(path)?;
            if existing == bytes {
                Ok(())
            } else {
                Err(WeaveError::Conflict(
                    "atomic destination already contains different bytes".to_string(),
                ))
            }
        }
        Err(error) => {
            let _ = fs::remove_file(&temporary);
            Err(WeaveError::Storage(error))
        }
    }
}

fn sync_parent(path: &Path) -> Result<(), WeaveError> {
    if let Some(parent) = path.parent() {
        File::open(parent)?.sync_all()?;
    }
    Ok(())
}

fn file_stems(directory: &Path) -> Result<BTreeSet<String>, WeaveError> {
    let mut values = BTreeSet::new();
    for entry in fs::read_dir(directory)? {
        let path = entry?.path();
        if let Some(stem) = path.file_stem().and_then(|value| value.to_str()) {
            values.insert(stem.to_string());
        }
    }
    Ok(values)
}

fn retained_object_bytes(directory: &Path) -> Result<u64, WeaveError> {
    let mut bytes = 0_u64;
    for entry in fs::read_dir(directory)? {
        let metadata = entry?.metadata()?;
        if metadata.is_file() {
            bytes = bytes.checked_add(metadata.len()).ok_or_else(|| {
                WeaveError::Policy("retained byte accounting overflow".to_string())
            })?;
        }
    }
    Ok(bytes)
}

fn publication_counts(directory: &Path, publisher_id: &str) -> Result<(u64, u64), WeaveError> {
    let mut total = 0_u64;
    let mut publisher = 0_u64;
    for entry in fs::read_dir(directory)? {
        let path = entry?.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let receipt = read_json::<PublicationReceiptV1>(&path)?;
        total = total.saturating_add(1);
        if receipt.publisher_id == publisher_id {
            publisher = publisher.saturating_add(1);
        }
    }
    Ok((total, publisher))
}

fn directory_last_modified(directory: &Path) -> Result<SystemTime, WeaveError> {
    let mut latest = fs::metadata(directory)?.modified()?;
    for entry in fs::read_dir(directory)? {
        let modified = entry?.metadata()?.modified()?;
        if modified > latest {
            latest = modified;
        }
    }
    Ok(latest)
}

fn parse_byte_range(value: &str, total: u64) -> Result<(u64, u64), WeaveError> {
    let range = value
        .strip_prefix("bytes=")
        .ok_or_else(|| WeaveError::Malformed("unsupported Range unit".to_string()))?;
    if range.contains(',') || total == 0 {
        return Err(WeaveError::Malformed(
            "only one byte range is supported".to_string(),
        ));
    }
    let (start, end) = range
        .split_once('-')
        .ok_or_else(|| WeaveError::Malformed("invalid byte range".to_string()))?;
    let start = start
        .parse::<u64>()
        .map_err(|_| WeaveError::Malformed("range start is required".to_string()))?;
    let end = if end.is_empty() {
        total - 1
    } else {
        end.parse::<u64>()
            .map_err(|_| WeaveError::Malformed("invalid range end".to_string()))?
    };
    if start > end || end >= total {
        return Err(WeaveError::Malformed(
            "byte range is outside the artifact".to_string(),
        ));
    }
    Ok((start, end))
}

fn now_unix_us() -> Result<i64, WeaveError> {
    let micros = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| WeaveError::Internal("system clock precedes Unix epoch".to_string()))?
        .as_micros();
    i64::try_from(micros).map_err(|_| WeaveError::Internal("system clock overflow".to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::Request;
    use ed25519_dalek::{Signer, SigningKey};
    use http_body_util::BodyExt;
    use tessaryn_cli::cinematic::{
        pack_cinematic_object, CinematicGeometryV1, CinematicMediaDescriptorV1, CinematicMomentV1,
        CinematicObjectDescriptorV1, CinematicSlbitV1,
    };
    use tower::ServiceExt;

    #[tokio::test]
    async fn http_contract_exposes_policy_and_structured_rejections() {
        let directory = temporary_directory("http");
        let app = router(test_node(&directory)).unwrap();
        let response = app
            .clone()
            .oneshot(Request::get("/v1/policy").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let policy = serde_json::from_slice::<WeaveNodePolicyV1>(&bytes).unwrap();
        assert_eq!(policy.chunk_bytes, 64 * 1024);
        assert_eq!(policy.max_active_uploads_per_publisher, 4);
        assert_eq!(policy.max_retained_bytes, 32 * 1024 * 1024 * 1024);
        assert_eq!(policy.max_publications, 100_000);
        assert_eq!(policy.upload_ttl_seconds, 24 * 60 * 60);

        let response = app
            .oneshot(
                Request::post("/v1/uploads")
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(r#"{"schema":"wrong"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn signed_resumable_object_becomes_public_and_content_addressed() {
        let directory = temporary_directory("publish");
        let artifact = build_cinematic_fixture(&directory, "published-continuum");
        let node = test_node(&directory);
        let intent = signed_intent(&artifact, "published-continuum", "Published Continuum");
        let session = node.begin_upload(intent.clone()).unwrap();
        assert!(session.chunk_count > 1);
        assert_eq!(node.begin_upload(intent).unwrap(), session);

        let bytes = fs::read(&artifact).unwrap();
        for (index, chunk) in bytes.chunks(session.chunk_bytes as usize).enumerate().rev() {
            let digest = sha256_digest(chunk);
            let status = node
                .store_chunk(&session.upload_id, index as u64, &digest, chunk)
                .unwrap();
            assert_eq!(
                status.received_chunks.len(),
                session.chunk_count as usize - index
            );
        }
        let receipt = node.commit_upload(session.upload_id.clone()).await.unwrap();
        assert_eq!(receipt.artifact_kind, PublicArtifactKind::CinematicObject);
        assert_eq!(receipt.intent.object_id, "published-continuum");
        assert_eq!(receipt.moments, 3);
        assert!(receipt.cell_id.starts_with("sha256:"));

        let catalog = node.catalog().unwrap();
        assert_eq!(catalog.schema, CATALOG_SCHEMA);
        assert_eq!(catalog.objects.len(), 1);
        assert_eq!(catalog.objects[0].publication_id, receipt.publication_id);
        assert_eq!(
            fs::read(node.artifact_path(&receipt.intent.artifact_sha256).unwrap()).unwrap(),
            bytes
        );
        let revocation = signed_revocation(&receipt.publication_id);
        node.revoke_publication(revocation.clone()).unwrap();
        assert_eq!(
            node.revoke_publication(revocation).unwrap().publication_id,
            receipt.publication_id
        );
        assert!(node.catalog().unwrap().objects.is_empty());
        assert!(node
            .artifact_path(&receipt.intent.artifact_sha256)
            .unwrap()
            .is_file());
        assert!(!node.upload_directory(&session.upload_id).unwrap().exists());
        fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn real_rgbd_reconstruction_is_a_first_class_public_artifact() {
        let directory = temporary_directory("rgbd");
        fs::create_dir_all(&directory).unwrap();
        let source = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../conformance/reconstruction-v0/minimal-artifact.json");
        let artifact = directory.join("real-capture.json");
        fs::copy(source, &artifact).unwrap();
        let node = test_node(&directory);
        let intent = signed_intent(&artifact, "real-capture-origin", "Real Capture Origin");
        let session = node.begin_upload(intent).unwrap();
        let bytes = fs::read(&artifact).unwrap();
        for (index, chunk) in bytes.chunks(session.chunk_bytes as usize).enumerate() {
            node.store_chunk(
                &session.upload_id,
                index as u64,
                &sha256_digest(chunk),
                chunk,
            )
            .unwrap();
        }
        let receipt = node.commit_upload(session.upload_id).await.unwrap();
        assert_eq!(
            receipt.artifact_kind,
            PublicArtifactKind::RgbdReconstruction
        );
        assert_eq!(receipt.dimensions, "REAL RGB-D / NATIVE 3D + TIME");
        assert!(receipt.media.contains("SURFELS"));
        fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn signatures_chunks_and_internal_object_identity_are_adversarially_enforced() {
        let directory = temporary_directory("reject");
        let artifact = build_cinematic_fixture(&directory, "bound-object");
        let node = test_node(&directory);
        let mut invalid_signature = signed_intent(&artifact, "bound-object", "Bound Object");
        invalid_signature.signature.replace_range(0..1, "A");
        assert!(matches!(
            node.begin_upload(invalid_signature),
            Err(WeaveError::Signature(_)) | Err(WeaveError::Malformed(_))
        ));
        let mut hidden_text = signed_intent(&artifact, "bound-object", "Bound Object");
        hidden_text.title = "Bound\u{202e} Object".to_string();
        assert!(matches!(
            node.begin_upload(hidden_text),
            Err(WeaveError::Malformed(_))
        ));

        let wrong_identity = signed_intent(&artifact, "different-object", "Bound Object");
        let session = node.begin_upload(wrong_identity).unwrap();
        let bytes = fs::read(&artifact).unwrap();
        let first = &bytes[..session.chunk_bytes as usize];
        assert!(matches!(
            node.store_chunk(
                &session.upload_id,
                0,
                "sha256:0000000000000000000000000000000000000000000000000000000000000000",
                first,
            ),
            Err(WeaveError::Integrity(_))
        ));
        for (index, chunk) in bytes.chunks(session.chunk_bytes as usize).enumerate() {
            node.store_chunk(
                &session.upload_id,
                index as u64,
                &sha256_digest(chunk),
                chunk,
            )
            .unwrap();
        }
        assert!(matches!(
            node.commit_upload(session.upload_id).await,
            Err(WeaveError::Integrity(_))
        ));
        assert!(node.catalog().unwrap().objects.is_empty());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn pending_upload_capacity_is_reserved_before_bytes_are_accepted() {
        let directory = temporary_directory("pending-capacity");
        let first = build_cinematic_fixture(&directory.join("first"), "first-place");
        let second = build_cinematic_fixture(&directory.join("second"), "second-place");
        let node = WeaveNode::open(WeaveConfig {
            root: directory.join("weave"),
            public_base_url: "https://weave.example".to_string(),
            chunk_bytes: 64 * 1024,
            max_object_bytes: 16 * 1024 * 1024,
            max_publisher_bytes: 64 * 1024 * 1024,
            max_pending_bytes: 32 * 1024 * 1024,
            max_active_uploads: 2,
            max_active_uploads_per_publisher: 1,
            ..WeaveConfig::default()
        })
        .unwrap();
        node.begin_upload(signed_intent(&first, "first-place", "First Place"))
            .unwrap();
        assert!(matches!(
            node.begin_upload(signed_intent(&second, "second-place", "Second Place")),
            Err(WeaveError::Policy(_))
        ));
        fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn retained_bytes_and_receipt_counts_are_finite_node_policies() {
        let retained_directory = temporary_directory("retained-capacity");
        let first = build_cinematic_fixture(&retained_directory.join("first"), "first-place");
        let second = build_cinematic_fixture(&retained_directory.join("second"), "second-place");
        let retained_node = WeaveNode::open(WeaveConfig {
            root: retained_directory.join("weave"),
            public_base_url: "https://weave.example".to_string(),
            chunk_bytes: 64 * 1024,
            max_object_bytes: 256 * 1024,
            max_publisher_bytes: 300 * 1024,
            max_pending_bytes: 512 * 1024,
            max_retained_bytes: 300 * 1024,
            ..WeaveConfig::default()
        })
        .unwrap();
        publish_fixture(&retained_node, &first, "first-place", "First Place").await;
        assert!(matches!(
            retained_node.begin_upload(signed_intent(&second, "second-place", "Second Place")),
            Err(WeaveError::Policy(_))
        ));
        fs::remove_dir_all(retained_directory).unwrap();

        let receipt_directory = temporary_directory("receipt-capacity");
        let first = build_cinematic_fixture(&receipt_directory.join("first"), "first-place");
        let second = build_cinematic_fixture(&receipt_directory.join("second"), "second-place");
        let receipt_node = WeaveNode::open(WeaveConfig {
            root: receipt_directory.join("weave"),
            public_base_url: "https://weave.example".to_string(),
            chunk_bytes: 64 * 1024,
            max_object_bytes: 16 * 1024 * 1024,
            max_publisher_bytes: 64 * 1024 * 1024,
            max_publications: 1,
            max_publications_per_publisher: 1,
            ..WeaveConfig::default()
        })
        .unwrap();
        publish_fixture(&receipt_node, &first, "first-place", "First Place").await;
        assert!(matches!(
            receipt_node.begin_upload(signed_intent(&second, "second-place", "Second Place")),
            Err(WeaveError::Policy(_))
        ));
        fs::remove_dir_all(receipt_directory).unwrap();
    }

    #[test]
    fn ranges_and_path_identifiers_reject_ambiguous_forms() {
        assert_eq!(parse_byte_range("bytes=0-9", 100).unwrap(), (0, 9));
        assert_eq!(parse_byte_range("bytes=90-", 100).unwrap(), (90, 99));
        assert!(parse_byte_range("bytes=-10", 100).is_err());
        assert!(parse_byte_range("bytes=0-100", 100).is_err());
        assert!(validate_prefixed_id("upl_../escape", "upl_").is_err());
        assert!(digest_hex("sha256:ABCDEF").is_err());
    }

    fn signed_intent(path: &Path, object_id: &str, title: &str) -> PublicationIntentV1 {
        let bytes = fs::read(path).unwrap();
        let signing_key = SigningKey::from_bytes(&[23_u8; 32]);
        let public_key = signing_key.verifying_key().to_bytes();
        let nonce = [41_u8; 32];
        let mut intent = PublicationIntentV1 {
            schema: PUBLISH_SCHEMA.to_string(),
            object_id: object_id.to_string(),
            title: title.to_string(),
            summary: "A publisher-owned temporal place admitted without a GitHub workflow."
                .to_string(),
            artifact_sha256: sha256_digest(&bytes),
            artifact_bytes: bytes.len() as u64,
            media_type: "application/vnd.tessaryn.object".to_string(),
            created_at_unix_us: 1_783_833_600_000_000,
            nonce: STANDARD_NO_PAD.encode(nonce),
            publisher_public_key: STANDARD_NO_PAD.encode(public_key),
            signature: String::new(),
        };
        let preimage = publication_preimage(&intent, &nonce, &public_key).unwrap();
        intent.signature = STANDARD_NO_PAD.encode(signing_key.sign(&preimage).to_bytes());
        intent
    }

    fn signed_revocation(publication_id: &str) -> PublicationRevocationV1 {
        let signing_key = SigningKey::from_bytes(&[23_u8; 32]);
        let public_key = signing_key.verifying_key().to_bytes();
        let nonce = [19_u8; 32];
        let created_at_unix_us = 1_783_833_700_000_000;
        let preimage =
            revocation_preimage(publication_id, created_at_unix_us, &nonce, &public_key).unwrap();
        PublicationRevocationV1 {
            schema: REVOCATION_SCHEMA.to_string(),
            publication_id: publication_id.to_string(),
            created_at_unix_us,
            nonce: STANDARD_NO_PAD.encode(nonce),
            signature: STANDARD_NO_PAD.encode(signing_key.sign(&preimage).to_bytes()),
        }
    }

    fn build_cinematic_fixture(directory: &Path, object_id: &str) -> PathBuf {
        fs::create_dir_all(directory).unwrap();
        let descriptor = CinematicObjectDescriptorV1 {
            schema: "tessaryn/cinematic-object-descriptor/v1".to_string(),
            object_id: object_id.to_string(),
            title: "Published Continuum".to_string(),
            created_at_unix_us: 1_783_833_600_000_000,
            duration_ms: 9_000,
            geometry: CinematicGeometryV1 {
                profile: "tessaryn/continuum-monument/v1".to_string(),
                seed: 77,
                cell_count: 48,
                shell_count: 4,
                ribbon_count: 4,
                phase_count: 3,
                bounds_um: [8_000_000, 7_000_000, 9_000_000],
                quality_tier: 3,
            },
            media: CinematicMediaDescriptorV1 {
                mime: "video/mp4".to_string(),
                width: 1_920,
                height: 1_080,
                frame_rate_millihz: 30_000,
                codec: "h264".to_string(),
                codec_version: "high-4.1".to_string(),
            },
            moments: vec![
                fixture_moment("origin", "Origin", 0),
                fixture_moment("memory", "Memory", 3_000),
                fixture_moment("continuum", "Continuum", 6_000),
            ],
            slbit: CinematicSlbitV1 {
                schema: "slbit/viz-packet/v3".to_string(),
                claim_state: "AUTHORED_TEMPORAL_OBJECT".to_string(),
                summary: "A test continuum.".to_string(),
                statements: vec!["Temporal material remains non-geometric.".to_string()],
            },
        };
        let descriptor_path = directory.join("descriptor.json");
        let media_path = directory.join("media.mp4");
        let artifact_path = directory.join("fixture.tessaryn");
        fs::write(&descriptor_path, serde_json::to_vec(&descriptor).unwrap()).unwrap();
        fs::write(
            &media_path,
            (0..180_000)
                .map(|index| ((index * 37 + 11) % 251) as u8)
                .collect::<Vec<_>>(),
        )
        .unwrap();
        pack_cinematic_object(&descriptor_path, &media_path, &artifact_path).unwrap();
        artifact_path
    }

    async fn publish_fixture(node: &WeaveNode, path: &Path, object_id: &str, title: &str) {
        let session = node
            .begin_upload(signed_intent(path, object_id, title))
            .unwrap();
        let bytes = fs::read(path).unwrap();
        for (index, chunk) in bytes.chunks(session.chunk_bytes as usize).enumerate() {
            node.store_chunk(
                &session.upload_id,
                index as u64,
                &sha256_digest(chunk),
                chunk,
            )
            .unwrap();
        }
        node.commit_upload(session.upload_id).await.unwrap();
    }

    fn fixture_moment(id: &str, label: &str, time_ms: u64) -> CinematicMomentV1 {
        CinematicMomentV1 {
            id: id.to_string(),
            label: label.to_string(),
            time_ms,
            phase_milli: i32::try_from(time_ms / 9).unwrap(),
            meaning: format!("{label} remains navigable."),
        }
    }

    fn test_node(directory: &Path) -> WeaveNode {
        WeaveNode::open(WeaveConfig {
            root: directory.join("weave"),
            public_base_url: "https://weave.example".to_string(),
            chunk_bytes: 64 * 1024,
            max_object_bytes: 16 * 1024 * 1024,
            max_publisher_bytes: 64 * 1024 * 1024,
            ..WeaveConfig::default()
        })
        .unwrap()
    }

    fn temporary_directory(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "tessaryn-weave-{label}-{}-{nonce}",
            std::process::id()
        ))
    }
}
