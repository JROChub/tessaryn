//! Canonical protocol types for TESSARYN World Cells.

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::fmt;
use thiserror::Error;

/// Stable schema identifier for the first experimental Cell format.
pub const CELL_SCHEMA_V0: &str = "tessaryn/cell/v0";

/// A validated SHA-256 content address.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Digest(String);

impl Digest {
    /// Validates and constructs a digest.
    pub fn new(value: impl Into<String>) -> Result<Self, SchemaError> {
        let value = value.into();
        let Some(hex) = value.strip_prefix("sha256:") else {
            return Err(SchemaError::InvalidDigest(value));
        };
        if hex.len() != 64 || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(SchemaError::InvalidDigest(value));
        }
        Ok(Self(format!("sha256:{}", hex.to_ascii_lowercase())))
    }

    /// Returns the encoded digest.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Returns the 32 digest bytes.
    pub fn bytes(&self) -> [u8; 32] {
        let mut output = [0_u8; 32];
        hex_decode_into(&self.0[7..], &mut output);
        output
    }
}

impl fmt::Display for Digest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl Serialize for Digest {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for Digest {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::new(value).map_err(serde::de::Error::custom)
    }
}

/// Declared origin of a Cell's world state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CellClass {
    /// Directly derived from a capture or human observation event.
    Observation,
    /// Deterministically produced from one or more parent Cells.
    Derived,
    /// Predicted, planned, or hypothetical world state.
    Simulation,
    /// Human or machine interpretation that is not observed geometry.
    Annotation,
    /// Authorization, retention, revocation, or disclosure policy.
    Policy,
    /// Multiscale summary generated from lower-level Cells.
    Aggregate,
}

/// Whether failure to understand a channel invalidates materialization.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Criticality {
    /// The channel must be understood by the materializer.
    Critical,
    /// The channel may be preserved and ignored.
    Optional,
}

/// Canonical local spatial bounds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SpatialExtent {
    /// Inclusive minimum in integer micrometers.
    pub min_um: [i64; 3],
    /// Inclusive maximum in integer micrometers.
    pub max_um: [i64; 3],
    /// Quaternion components in signed Q30 fixed point, ordered x/y/z/w.
    pub orientation_q30: [i32; 4],
    /// Declared uncertainty in micrometers.
    pub uncertainty_um: [u64; 3],
}

/// Canonical temporal bounds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TemporalExtent {
    /// Observation interval start in Unix microseconds.
    pub start_unix_us: i64,
    /// Observation interval end in Unix microseconds.
    pub end_unix_us: i64,
    /// Declared temporal uncertainty in microseconds.
    pub uncertainty_us: u64,
    /// Stable clock-source identifier.
    pub clock_source: String,
    /// Time at which the Cell was published.
    pub published_at_unix_us: i64,
    /// Inclusive validity interval start.
    pub valid_from_unix_us: i64,
    /// Inclusive validity interval end, or no declared expiry.
    pub valid_until_unix_us: Option<i64>,
    /// Earlier Cell identities explicitly superseded by this state.
    pub supersedes: Vec<Digest>,
    /// Declared relationship between this state and physical time.
    pub state_kind: TemporalStateKind,
}

/// Temporal authority of a Cell state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TemporalStateKind {
    /// Directly observed state.
    Observed,
    /// State deterministically derived from other Cells.
    Derived,
    /// Forecast or simulated future state.
    Predicted,
    /// Declared intended future state.
    Planned,
}

/// One content-addressed binary world channel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChannelDescriptor {
    /// Stable role such as `geometry/surfel` or `privacy/mask`.
    pub role: String,
    /// Codec identifier.
    pub codec: String,
    /// Exact codec version.
    pub codec_version: String,
    /// Merkle root of channel chunks.
    pub chunk_root: Digest,
    /// Declared uncompressed byte count.
    pub uncompressed_bytes: u64,
    /// Quality tier, where zero is the minimum usable representation.
    pub quality_tier: u16,
    /// Criticality contract.
    pub criticality: Criticality,
    /// SPDX-style license identifier or `private`.
    pub license: String,
}

/// Source material used to construct a Cell.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SourceRecord {
    /// Content-addressed source record ID.
    pub source_id: Digest,
    /// Stable source kind such as `synthetic-generator` or `rgbd-capture`.
    pub source_type: String,
    /// Producer-controlled source label.
    pub producer: String,
    /// Capture timestamp in Unix microseconds.
    pub captured_at_unix_us: i64,
    /// Optional signing-key fingerprint.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_key: Option<Digest>,
}

/// Deterministic derivation applied to source or parent Cells.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TransformRecord {
    /// Content-addressed transformation receipt.
    pub transform_id: Digest,
    /// Stable transformation method.
    pub method: String,
    /// Exact tool identifier.
    pub tool: String,
    /// Exact tool version.
    pub tool_version: String,
    /// Sorted input content addresses.
    pub input_ids: Vec<Digest>,
}

/// Evidence declarations remain separate rather than becoming one score.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EvidenceDeclaration {
    /// Whether the manifest is expected to carry a verifiable identity.
    pub identity_committed: bool,
    /// Whether the declared derivation can be replayed locally.
    pub replay_available: bool,
    /// Whether source attribution is present.
    pub source_attributed: bool,
    /// Whether disagreement is intentionally retained.
    pub disputed: bool,
    /// Whether the Cell contains semantic interpretation only.
    pub semantic_only: bool,
    /// Whether content requires an authorization capability.
    pub restricted: bool,
}

/// Identity-bearing manifest for one portable World Cell.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CellManifestV0 {
    /// Must equal [`CELL_SCHEMA_V0`].
    pub schema: String,
    /// Cell class.
    pub class: CellClass,
    /// Local coordinate frame identity.
    pub anchor_id: Digest,
    /// Local spatial extent.
    pub spatial_extent: SpatialExtent,
    /// Time-bearing extent.
    pub temporal_extent: TemporalExtent,
    /// Content channels.
    pub channels: Vec<ChannelDescriptor>,
    /// Parent Cell identities.
    pub parents: Vec<Digest>,
    /// Source records.
    pub source_records: Vec<SourceRecord>,
    /// Derivation records.
    pub transform_records: Vec<TransformRecord>,
    /// Authorization and disclosure policy root.
    pub policy_root: Digest,
    /// Multidimensional evidence declaration.
    pub evidence: EvidenceDeclaration,
    /// Merkle root across every chunk committed by this Cell.
    pub chunk_merkle_root: Digest,
}

impl CellManifestV0 {
    /// Validates structural invariants without calculating identity.
    pub fn validate(&self) -> Result<(), SchemaError> {
        if self.schema != CELL_SCHEMA_V0 {
            return Err(SchemaError::UnsupportedSchema(self.schema.clone()));
        }
        for axis in 0..3 {
            if self.spatial_extent.min_um[axis] > self.spatial_extent.max_um[axis] {
                return Err(SchemaError::InvalidSpatialExtent(axis));
            }
        }
        validate_orientation(self.spatial_extent.orientation_q30)?;
        if self.temporal_extent.start_unix_us > self.temporal_extent.end_unix_us {
            return Err(SchemaError::InvalidTemporalExtent);
        }
        if self
            .temporal_extent
            .valid_until_unix_us
            .is_some_and(|end| self.temporal_extent.valid_from_unix_us > end)
        {
            return Err(SchemaError::InvalidValidityInterval);
        }
        validate_token("clock_source", &self.temporal_extent.clock_source)?;
        if self.channels.is_empty() {
            return Err(SchemaError::MissingChannels);
        }
        for channel in &self.channels {
            validate_token("channel.role", &channel.role)?;
            validate_token("channel.codec", &channel.codec)?;
            validate_token("channel.codec_version", &channel.codec_version)?;
            validate_token("channel.license", &channel.license)?;
        }
        for source in &self.source_records {
            validate_token("source.source_type", &source.source_type)?;
            validate_token("source.producer", &source.producer)?;
        }
        for transform in &self.transform_records {
            validate_token("transform.method", &transform.method)?;
            validate_token("transform.tool", &transform.tool)?;
            validate_token("transform.tool_version", &transform.tool_version)?;
        }
        if matches!(self.class, CellClass::Derived | CellClass::Aggregate)
            && self.parents.is_empty()
        {
            return Err(SchemaError::MissingParents(self.class));
        }
        if self.evidence.semantic_only && self.class != CellClass::Annotation {
            return Err(SchemaError::SemanticClassMismatch);
        }
        let temporal_class_matches = match self.class {
            CellClass::Observation => {
                self.temporal_extent.state_kind == TemporalStateKind::Observed
            }
            CellClass::Derived | CellClass::Aggregate => {
                self.temporal_extent.state_kind == TemporalStateKind::Derived
            }
            CellClass::Simulation => matches!(
                self.temporal_extent.state_kind,
                TemporalStateKind::Predicted | TemporalStateKind::Planned
            ),
            CellClass::Annotation | CellClass::Policy => true,
        };
        if !temporal_class_matches {
            return Err(SchemaError::TemporalClassMismatch);
        }
        Ok(())
    }
}

/// Schema validation error.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum SchemaError {
    /// A digest was malformed.
    #[error("invalid SHA-256 digest: {0}")]
    InvalidDigest(String),
    /// The schema is not supported.
    #[error("unsupported Cell schema: {0}")]
    UnsupportedSchema(String),
    /// One spatial bound is inverted.
    #[error("spatial extent is inverted on axis {0}")]
    InvalidSpatialExtent(usize),
    /// The fixed-point orientation is not a unit quaternion within tolerance.
    #[error("orientation_q30 is not a unit quaternion")]
    InvalidOrientation,
    /// The temporal interval is inverted.
    #[error("temporal extent is inverted")]
    InvalidTemporalExtent,
    /// The declared validity interval was inverted.
    #[error("temporal validity interval is inverted")]
    InvalidValidityInterval,
    /// A required token was empty or excessively long.
    #[error("invalid {0}")]
    InvalidToken(&'static str),
    /// A Cell contained no channels.
    #[error("Cell must contain at least one channel")]
    MissingChannels,
    /// A derived or aggregate Cell omitted parents.
    #[error("{0:?} Cell must contain at least one parent")]
    MissingParents(CellClass),
    /// Semantic-only evidence was attached to a non-annotation Cell.
    #[error("semantic_only evidence requires annotation class")]
    SemanticClassMismatch,
    /// Cell class and temporal authority disagree.
    #[error("Cell class and temporal state kind disagree")]
    TemporalClassMismatch,
}

fn validate_orientation(quaternion: [i32; 4]) -> Result<(), SchemaError> {
    const ONE_Q30: i128 = 1_i128 << 30;
    const TOLERANCE: i128 = ONE_Q30 * ONE_Q30 / 500;
    let norm_squared = quaternion
        .into_iter()
        .map(|value| i128::from(value) * i128::from(value))
        .sum::<i128>();
    let expected = ONE_Q30 * ONE_Q30;
    if (norm_squared - expected).abs() > TOLERANCE {
        return Err(SchemaError::InvalidOrientation);
    }
    Ok(())
}

fn validate_token(name: &'static str, value: &str) -> Result<(), SchemaError> {
    let length = value.len();
    if value.trim().is_empty() || length > 256 || value.chars().any(char::is_control) {
        return Err(SchemaError::InvalidToken(name));
    }
    Ok(())
}

fn hex_decode_into(value: &str, output: &mut [u8; 32]) {
    for (index, chunk) in value.as_bytes().chunks_exact(2).enumerate() {
        output[index] = (hex_nibble(chunk[0]) << 4) | hex_nibble(chunk[1]);
    }
}

fn hex_nibble(byte: u8) -> u8 {
    match byte {
        b'0'..=b'9' => byte - b'0',
        b'a'..=b'f' => byte - b'a' + 10,
        b'A'..=b'F' => byte - b'A' + 10,
        _ => unreachable!("digest validation runs before decoding"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn digest_is_validated_and_normalized() {
        let digest = Digest::new(format!("sha256:{}", "AB".repeat(32))).unwrap();
        assert_eq!(digest.as_str(), format!("sha256:{}", "ab".repeat(32)));
        assert_eq!(digest.bytes(), [0xab; 32]);
        assert!(Digest::new("sha256:00").is_err());
    }

    #[test]
    fn orientation_requires_q30_unit_length() {
        assert!(validate_orientation([0, 0, 0, 1 << 30]).is_ok());
        assert_eq!(
            validate_orientation([0, 0, 0, 1]),
            Err(SchemaError::InvalidOrientation)
        );
    }
}
