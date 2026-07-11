//! Strict canonicalization, identity, and chunk Merkle binding.

use serde::de::{DeserializeSeed, MapAccess, SeqAccess, Visitor};
use serde_json::Value;
use sha2::{Digest as ShaDigest, Sha256};
use std::collections::BTreeMap;
use std::fmt;
use tessaryn_schema::{CellManifestV0, Digest};
use thiserror::Error;

const CELL_ID_DOMAIN: &[u8] = b"TESSARYN-CELL-v0\0";
const CHUNK_ID_DOMAIN: &[u8] = b"TESSARYN-CHUNK-v0\0";
const MERKLE_LEAF_DOMAIN: &[u8] = b"TESSARYN-MERKLE-LEAF-v0\0";
const MERKLE_NODE_DOMAIN: &[u8] = b"TESSARYN-MERKLE-NODE-v0\0";
const EMPTY_MERKLE_DOMAIN: &[u8] = b"TESSARYN-MERKLE-EMPTY-v0\0";

/// Maximum accepted canonical manifest size.
pub const MAX_MANIFEST_BYTES: usize = 1_048_576;

/// Returns a canonical clone with unordered collections sorted.
pub fn canonical_manifest(manifest: &CellManifestV0) -> Result<CellManifestV0, CanonicalError> {
    manifest.validate()?;
    let mut canonical = manifest.clone();
    canonical.channels.sort_by(|left, right| {
        (&left.role, &left.chunk_root).cmp(&(&right.role, &right.chunk_root))
    });
    canonical.parents.sort();
    canonical.parents.dedup();
    canonical.temporal_extent.supersedes.sort();
    canonical.temporal_extent.supersedes.dedup();
    canonical
        .source_records
        .sort_by(|left, right| left.source_id.cmp(&right.source_id));
    canonical
        .transform_records
        .sort_by(|left, right| left.transform_id.cmp(&right.transform_id));
    for transform in &mut canonical.transform_records {
        transform.input_ids.sort();
        transform.input_ids.dedup();
    }
    Ok(canonical)
}

/// Serializes a Cell using sorted object keys and integer-only JSON.
///
/// Strings are committed as exact UTF-8 code-point sequences. Version 0 does
/// not perform implicit Unicode normalization.
pub fn canonical_bytes(manifest: &CellManifestV0) -> Result<Vec<u8>, CanonicalError> {
    let canonical = canonical_manifest(manifest)?;
    let value = serde_json::to_value(canonical)?;
    reject_non_integer_numbers(&value, "$")?;
    Ok(serde_json::to_vec(&value)?)
}

/// Calculates the domain-separated identity of a Cell manifest.
pub fn cell_id(manifest: &CellManifestV0) -> Result<Digest, CanonicalError> {
    let bytes = canonical_bytes(manifest)?;
    Ok(hash_parts(CELL_ID_DOMAIN, &[&bytes]))
}

/// Calculates the domain-separated identity of one binary chunk.
pub fn chunk_id(bytes: &[u8]) -> Digest {
    hash_parts(CHUNK_ID_DOMAIN, &[bytes])
}

/// Calculates a deterministic Merkle root from chunk identities.
///
/// Leaves are sorted, duplicate addresses are retained, and an odd node is
/// promoted unchanged to the next level. The empty tree has a dedicated root.
pub fn chunk_merkle_root(chunks: &[Digest]) -> Digest {
    if chunks.is_empty() {
        return hash_parts(EMPTY_MERKLE_DOMAIN, &[]);
    }
    let mut level = chunks
        .iter()
        .map(|digest| hash_parts(MERKLE_LEAF_DOMAIN, &[&digest.bytes()]))
        .collect::<Vec<_>>();
    level.sort();
    while level.len() > 1 {
        let mut next = Vec::with_capacity(level.len().div_ceil(2));
        for pair in level.chunks(2) {
            if pair.len() == 1 {
                next.push(pair[0].clone());
            } else {
                next.push(hash_parts(
                    MERKLE_NODE_DOMAIN,
                    &[&pair[0].bytes(), &pair[1].bytes()],
                ));
            }
        }
        level = next;
    }
    level.remove(0)
}

/// Parses strict integer-only JSON while rejecting duplicate keys.
pub fn parse_strict_json(bytes: &[u8]) -> Result<Value, CanonicalError> {
    if bytes.len() > MAX_MANIFEST_BYTES {
        return Err(CanonicalError::ResourceLimit {
            found: bytes.len(),
            maximum: MAX_MANIFEST_BYTES,
        });
    }
    let text = std::str::from_utf8(bytes).map_err(CanonicalError::Utf8)?;
    let mut deserializer = serde_json::Deserializer::from_str(text);
    let value = StrictValueSeed.deserialize(&mut deserializer)?;
    deserializer.end()?;
    reject_non_integer_numbers(&value, "$")?;
    Ok(value)
}

/// Parses and validates a strict Cell manifest.
pub fn parse_manifest(bytes: &[u8]) -> Result<CellManifestV0, CanonicalError> {
    let value = parse_strict_json(bytes)?;
    let manifest = serde_json::from_value::<CellManifestV0>(value)?;
    manifest.validate()?;
    Ok(manifest)
}

/// Canonicalization error.
#[derive(Debug, Error)]
pub enum CanonicalError {
    /// Schema validation failed.
    #[error(transparent)]
    Schema(#[from] tessaryn_schema::SchemaError),
    /// JSON encoding or decoding failed.
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    /// Input was not UTF-8.
    #[error("manifest is not UTF-8: {0}")]
    Utf8(#[from] std::str::Utf8Error),
    /// A JSON object repeated a key.
    #[error("duplicate JSON key: {0}")]
    DuplicateKey(String),
    /// Identity-bearing JSON contained a floating-point number.
    #[error("non-integer number at {0}")]
    NonIntegerNumber(String),
    /// Input exceeded a parser resource limit.
    #[error("manifest size {found} exceeds {maximum} bytes")]
    ResourceLimit {
        /// Observed size.
        found: usize,
        /// Maximum accepted size.
        maximum: usize,
    },
}

fn hash_parts(domain: &[u8], parts: &[&[u8]]) -> Digest {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    for part in parts {
        hasher.update(part);
    }
    Digest::new(format!("sha256:{}", hex::encode(hasher.finalize())))
        .expect("SHA-256 formatter always emits a valid digest")
}

fn reject_non_integer_numbers(value: &Value, path: &str) -> Result<(), CanonicalError> {
    match value {
        Value::Number(number) if !number.is_i64() && !number.is_u64() => {
            Err(CanonicalError::NonIntegerNumber(path.to_string()))
        }
        Value::Array(values) => {
            for (index, value) in values.iter().enumerate() {
                reject_non_integer_numbers(value, &format!("{path}[{index}]"))?;
            }
            Ok(())
        }
        Value::Object(values) => {
            for (key, value) in values {
                reject_non_integer_numbers(value, &format!("{path}.{key}"))?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

struct StrictValueSeed;

impl<'de> DeserializeSeed<'de> for StrictValueSeed {
    type Value = Value;

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        deserializer.deserialize_any(StrictValueVisitor)
    }
}

struct StrictValueVisitor;

impl<'de> Visitor<'de> for StrictValueVisitor {
    type Value = Value;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("strict integer-only JSON")
    }

    fn visit_bool<E>(self, value: bool) -> Result<Self::Value, E> {
        Ok(Value::Bool(value))
    }

    fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E> {
        Ok(Value::Number(value.into()))
    }

    fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E> {
        Ok(Value::Number(value.into()))
    }

    fn visit_f64<E>(self, _value: f64) -> Result<Self::Value, E>
    where
        E: serde::de::Error,
    {
        Err(E::custom("floating-point numbers are forbidden"))
    }

    fn visit_str<E>(self, value: &str) -> Result<Self::Value, E> {
        Ok(Value::String(value.to_string()))
    }

    fn visit_string<E>(self, value: String) -> Result<Self::Value, E> {
        Ok(Value::String(value))
    }

    fn visit_none<E>(self) -> Result<Self::Value, E> {
        Ok(Value::Null)
    }

    fn visit_unit<E>(self) -> Result<Self::Value, E> {
        Ok(Value::Null)
    }

    fn visit_some<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        StrictValueSeed.deserialize(deserializer)
    }

    fn visit_seq<A>(self, mut sequence: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        let mut values = Vec::new();
        while let Some(value) = sequence.next_element_seed(StrictValueSeed)? {
            values.push(value);
        }
        Ok(Value::Array(values))
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut values = BTreeMap::new();
        while let Some(key) = map.next_key::<String>()? {
            if values.contains_key(&key) {
                return Err(serde::de::Error::custom(format!(
                    "duplicate JSON key: {key}"
                )));
            }
            let value = map.next_value_seed(StrictValueSeed)?;
            values.insert(key, value);
        }
        Ok(Value::Object(values.into_iter().collect()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tessaryn_schema::{
        CellClass, ChannelDescriptor, Criticality, EvidenceDeclaration, SpatialExtent,
        TemporalExtent, TemporalStateKind, CELL_SCHEMA_V0,
    };

    fn digest(byte: &str) -> Digest {
        Digest::new(format!("sha256:{}", byte.repeat(64))).unwrap()
    }

    fn manifest() -> CellManifestV0 {
        CellManifestV0 {
            schema: CELL_SCHEMA_V0.to_string(),
            class: CellClass::Observation,
            anchor_id: digest("1"),
            spatial_extent: SpatialExtent {
                min_um: [0, 0, 0],
                max_um: [1_000_000, 2_000_000, 3_000_000],
                orientation_q30: [0, 0, 0, 1 << 30],
                uncertainty_um: [1_000, 1_000, 2_000],
            },
            temporal_extent: TemporalExtent {
                start_unix_us: 1,
                end_unix_us: 2,
                uncertainty_us: 10,
                clock_source: "synthetic-clock/v0".to_string(),
                published_at_unix_us: 2,
                valid_from_unix_us: 1,
                valid_until_unix_us: Some(2),
                supersedes: Vec::new(),
                state_kind: TemporalStateKind::Observed,
            },
            channels: vec![ChannelDescriptor {
                role: "geometry/surfel".to_string(),
                codec: "tessaryn/surfel".to_string(),
                codec_version: "0".to_string(),
                chunk_root: digest("2"),
                uncompressed_bytes: 128,
                quality_tier: 0,
                criticality: Criticality::Critical,
                license: "CC0-1.0".to_string(),
            }],
            parents: Vec::new(),
            source_records: Vec::new(),
            transform_records: Vec::new(),
            policy_root: digest("3"),
            evidence: EvidenceDeclaration {
                identity_committed: true,
                replay_available: true,
                source_attributed: true,
                disputed: false,
                semantic_only: false,
                restricted: false,
            },
            chunk_merkle_root: digest("4"),
        }
    }

    #[test]
    fn canonical_identity_changes_with_core_mutation() {
        let original = manifest();
        let mut mutated = original.clone();
        mutated.spatial_extent.max_um[0] += 1;
        assert_ne!(cell_id(&original).unwrap(), cell_id(&mutated).unwrap());
    }

    #[test]
    fn unordered_inputs_canonicalize_to_one_identity() {
        let mut left = manifest();
        left.parents = vec![digest("b"), digest("a")];
        let mut right = left.clone();
        right.parents.reverse();
        assert_eq!(cell_id(&left).unwrap(), cell_id(&right).unwrap());
    }

    #[test]
    fn strict_parser_rejects_duplicates_floats_and_oversize() {
        assert!(parse_strict_json(br#"{"a":1,"a":2}"#).is_err());
        assert!(parse_strict_json(br#"{"a":1.5}"#).is_err());
        assert!(parse_strict_json(&vec![b' '; MAX_MANIFEST_BYTES + 1]).is_err());
    }

    #[test]
    fn arbitrary_parser_bytes_never_panic() {
        let mut state = 0x9e37_79b9_u32;
        for case in 0..4_096_usize {
            let length = case % 768;
            let mut bytes = vec![0_u8; length];
            for byte in &mut bytes {
                state ^= state << 13;
                state ^= state >> 17;
                state ^= state << 5;
                *byte = state as u8;
            }
            let outcome = std::panic::catch_unwind(|| parse_strict_json(&bytes));
            assert!(
                outcome.is_ok(),
                "strict parser panicked on fuzz case {case}"
            );
        }
    }

    #[test]
    fn merkle_root_is_order_independent_but_mutation_sensitive() {
        let left = vec![chunk_id(b"alpha"), chunk_id(b"beta")];
        let right = vec![left[1].clone(), left[0].clone()];
        assert_eq!(chunk_merkle_root(&left), chunk_merkle_root(&right));
        assert_ne!(
            chunk_merkle_root(&left),
            chunk_merkle_root(&[chunk_id(b"alpha!")])
        );
    }
}
