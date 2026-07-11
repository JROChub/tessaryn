//! Privacy-gated deterministic capture-record Forge.

#![forbid(unsafe_code)]

use serde::{Deserialize, Serialize};
use tessaryn_canonical::{cell_id, chunk_id, chunk_merkle_root};
use tessaryn_schema::{
    CellClass, CellManifestV0, ChannelDescriptor, Criticality, Digest, EvidenceDeclaration,
    SourceRecord, SpatialExtent, TemporalExtent, TemporalStateKind, TransformRecord,
    CELL_SCHEMA_V0,
};
use thiserror::Error;

const SURFEL_MAGIC: &[u8] = b"TESSARYN-SURFEL-v0\0";
const MAX_SURFELS: usize = 1_000_000;
const SURFEL_BYTES: usize = 40;

/// One integer-only oriented surface sample.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct SurfelSample {
    /// Position in local integer micrometers.
    pub position_um: [i64; 3],
    /// Unit normal in signed Q15 fixed point.
    pub normal_q15: [i16; 3],
    /// Linearized display color and alpha.
    pub color_rgba: [u8; 4],
    /// Disc radius in micrometers.
    pub radius_um: u32,
    /// Capture confidence in basis points.
    pub confidence_basis_points: u16,
}

/// Authorized bounded capture input.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CaptureSession {
    /// Stable content address for the capture session record.
    pub session_id: Digest,
    /// Local Anchor receiving the samples.
    pub anchor_id: Digest,
    /// Inclusive capture interval start.
    pub captured_at_unix_us: i64,
    /// Inclusive capture interval end; omitted for an instantaneous observation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub captured_until_unix_us: Option<i64>,
    /// Stable clock source.
    pub clock_source: String,
    /// Capture producer identifier.
    pub producer: String,
    /// Optional device signing-key fingerprint.
    pub device_key: Option<Digest>,
    /// Integer surfel records. Raw images are not accepted by this adapter.
    pub samples: Vec<SurfelSample>,
}

/// A local volume removed before a shareable derivative is encoded.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct ExclusionVolume {
    /// Stable private policy identifier.
    pub id: Digest,
    /// Inclusive minimum local coordinate.
    pub min_um: [i64; 3],
    /// Inclusive maximum local coordinate.
    pub max_um: [i64; 3],
}

/// Explicit capture and disclosure policy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CapturePolicy {
    /// An operator explicitly authorized this capture.
    pub operator_confirmed: bool,
    /// The device exposed a visible recording state.
    pub visible_recording: bool,
    /// Processing remains local for this Forge operation.
    pub local_processing: bool,
    /// Whether the resulting derivative is authorized for publication.
    pub publication_allowed: bool,
    /// Whether raw sensor material may be retained after the derivative is built.
    pub retain_raw: bool,
    /// Regions removed before public derivative encoding.
    pub exclusions: Vec<ExclusionVolume>,
    /// SPDX-style derivative license or `private`.
    pub derivative_license: String,
}

/// Deterministic output from one Forge operation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ForgeReport {
    /// Identity-bearing Cell manifest.
    pub manifest: CellManifestV0,
    /// Recalculated Cell identity.
    pub cell_id: Digest,
    /// Address of the shareable surfel chunk.
    pub public_chunk_id: Digest,
    /// Exact shareable surfel bytes.
    #[serde(with = "tessaryn_transport::bytes_base64")]
    pub public_chunk: Vec<u8>,
    /// Number of retained samples.
    pub accepted_samples: u64,
    /// Number removed by exclusion policy.
    pub excluded_samples: u64,
    /// Raw samples are never embedded in the report.
    pub raw_embedded: bool,
    /// Whether publication was explicitly authorized.
    pub publication_allowed: bool,
    /// Content address of the Forge report projection.
    pub report_id: Digest,
}

/// Independent verification result for one public Forge report.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ForgeVerificationReport {
    /// Surfel chunk identity and bounded decoding matched.
    pub chunk_valid: bool,
    /// Cell manifest identity and Merkle root matched.
    pub cell_valid: bool,
    /// Forge report projection identity matched.
    pub report_valid: bool,
    /// Raw capture samples were absent.
    pub raw_absent: bool,
    /// Number of verified public surfels.
    pub verified_samples: u64,
}

/// Builds one observation Cell from authorized integer surfel records.
pub fn forge_surfel_cell(
    session: CaptureSession,
    policy: CapturePolicy,
) -> Result<ForgeReport, ForgeError> {
    validate_policy(&policy)?;
    validate_session(&session)?;

    let mut canonical_policy = policy.clone();
    canonical_policy.exclusions.sort();
    canonical_policy.exclusions.dedup();
    let policy_bytes = serde_json::to_vec(&canonical_policy)?;
    let policy_root = chunk_id(&policy_bytes);

    let mut accepted = Vec::with_capacity(session.samples.len());
    let mut excluded_samples = 0_u64;
    for sample in &session.samples {
        validate_sample(sample)?;
        if canonical_policy
            .exclusions
            .iter()
            .any(|volume| contains(volume, sample.position_um))
        {
            excluded_samples += 1;
        } else {
            accepted.push(sample.clone());
        }
    }
    if accepted.is_empty() {
        return Err(ForgeError::EmptyDerivative);
    }
    accepted.sort();
    let public_chunk = encode_surfel_chunk(&accepted)?;
    let public_chunk_id = chunk_id(&public_chunk);
    let chunk_root = chunk_merkle_root(std::slice::from_ref(&public_chunk_id));
    let (min_um, max_um) = sample_bounds(&accepted)?;

    let captured_until_unix_us = session
        .captured_until_unix_us
        .unwrap_or(session.captured_at_unix_us);
    let source_record_bytes = serde_json::to_vec(&serde_json::json!({
        "anchor_id": &session.anchor_id,
        "captured_at_unix_us": session.captured_at_unix_us,
        "captured_until_unix_us": captured_until_unix_us,
        "producer": &session.producer,
        "public_chunk_id": &public_chunk_id,
        "session_id": &session.session_id,
    }))?;
    let source_id = chunk_id(&source_record_bytes);
    let transform_id = chunk_id(
        format!(
            "tessaryn/surfel-encode-v0:{}:{}",
            session.session_id, public_chunk_id
        )
        .as_bytes(),
    );
    let manifest = CellManifestV0 {
        schema: CELL_SCHEMA_V0.to_string(),
        class: CellClass::Observation,
        anchor_id: session.anchor_id,
        spatial_extent: SpatialExtent {
            min_um,
            max_um,
            orientation_q30: [0, 0, 0, 1 << 30],
            uncertainty_um: [1_000; 3],
        },
        temporal_extent: TemporalExtent {
            start_unix_us: session.captured_at_unix_us,
            end_unix_us: captured_until_unix_us,
            uncertainty_us: 1_000,
            clock_source: session.clock_source,
            published_at_unix_us: captured_until_unix_us,
            valid_from_unix_us: session.captured_at_unix_us,
            valid_until_unix_us: None,
            supersedes: Vec::new(),
            state_kind: TemporalStateKind::Observed,
        },
        channels: vec![ChannelDescriptor {
            role: "geometry/surfel".to_string(),
            codec: "tessaryn/surfel-le".to_string(),
            codec_version: "0".to_string(),
            chunk_root: chunk_root.clone(),
            uncompressed_bytes: public_chunk.len() as u64,
            quality_tier: 0,
            criticality: Criticality::Critical,
            license: canonical_policy.derivative_license,
        }],
        parents: Vec::new(),
        source_records: vec![SourceRecord {
            source_id,
            source_type: "surfel-capture-record".to_string(),
            producer: session.producer,
            captured_at_unix_us: session.captured_at_unix_us,
            device_key: session.device_key,
        }],
        transform_records: vec![TransformRecord {
            transform_id,
            method: "tessaryn/surfel-encode-v0".to_string(),
            tool: "tessaryn-forge".to_string(),
            tool_version: env!("CARGO_PKG_VERSION").to_string(),
            input_ids: vec![session.session_id],
        }],
        policy_root,
        evidence: EvidenceDeclaration {
            identity_committed: true,
            replay_available: true,
            source_attributed: true,
            disputed: false,
            semantic_only: false,
            restricted: !policy.publication_allowed,
        },
        chunk_merkle_root: chunk_root,
    };
    let cell_id = cell_id(&manifest)?;
    let report_id = forge_report_id(
        accepted.len() as u64,
        excluded_samples,
        &cell_id,
        &public_chunk_id,
        policy.publication_allowed,
        false,
    )?;
    Ok(ForgeReport {
        manifest,
        cell_id,
        public_chunk_id,
        public_chunk,
        accepted_samples: accepted.len() as u64,
        excluded_samples,
        raw_embedded: false,
        publication_allowed: policy.publication_allowed,
        report_id,
    })
}

/// Re-verifies every public, independently checkable Forge output.
pub fn verify_forge_report(report: &ForgeReport) -> Result<ForgeVerificationReport, ForgeError> {
    if report.raw_embedded {
        return Err(ForgeError::RawCaptureDisclosure);
    }
    let samples = decode_surfel_chunk(&report.public_chunk)?;
    let public_chunk_id = chunk_id(&report.public_chunk);
    let chunk_root = chunk_merkle_root(std::slice::from_ref(&public_chunk_id));
    if public_chunk_id != report.public_chunk_id || samples.len() as u64 != report.accepted_samples
    {
        return Err(ForgeError::PublicChunkMismatch);
    }
    if chunk_root != report.manifest.chunk_merkle_root
        || cell_id(&report.manifest)? != report.cell_id
    {
        return Err(ForgeError::CellMismatch);
    }
    let expected_report_id = forge_report_id(
        report.accepted_samples,
        report.excluded_samples,
        &report.cell_id,
        &report.public_chunk_id,
        report.publication_allowed,
        false,
    )?;
    if expected_report_id != report.report_id {
        return Err(ForgeError::ReportMismatch);
    }
    Ok(ForgeVerificationReport {
        chunk_valid: true,
        cell_valid: true,
        report_valid: true,
        raw_absent: true,
        verified_samples: samples.len() as u64,
    })
}

fn forge_report_id(
    accepted_samples: u64,
    excluded_samples: u64,
    cell_id: &Digest,
    public_chunk_id: &Digest,
    publication_allowed: bool,
    raw_embedded: bool,
) -> Result<Digest, ForgeError> {
    Ok(chunk_id(&serde_json::to_vec(&serde_json::json!({
        "accepted_samples": accepted_samples,
        "cell_id": cell_id,
        "excluded_samples": excluded_samples,
        "public_chunk_id": public_chunk_id,
        "publication_allowed": publication_allowed,
        "raw_embedded": raw_embedded,
    }))?))
}

/// Decodes the bounded deterministic surfel transport.
pub fn decode_surfel_chunk(bytes: &[u8]) -> Result<Vec<SurfelSample>, ForgeError> {
    if bytes.len() < SURFEL_MAGIC.len() + 4 || !bytes.starts_with(SURFEL_MAGIC) {
        return Err(ForgeError::MalformedChunk);
    }
    let mut count_bytes = [0_u8; 4];
    count_bytes.copy_from_slice(&bytes[SURFEL_MAGIC.len()..SURFEL_MAGIC.len() + 4]);
    let count = u32::from_le_bytes(count_bytes) as usize;
    if count > MAX_SURFELS {
        return Err(ForgeError::SampleLimit);
    }
    let expected = SURFEL_MAGIC
        .len()
        .checked_add(4)
        .and_then(|value| value.checked_add(count.checked_mul(SURFEL_BYTES)?))
        .ok_or(ForgeError::MalformedChunk)?;
    if bytes.len() != expected {
        return Err(ForgeError::MalformedChunk);
    }
    let mut cursor = SURFEL_MAGIC.len() + 4;
    let mut samples = Vec::with_capacity(count);
    for _ in 0..count {
        let mut take = |length: usize| {
            let output = &bytes[cursor..cursor + length];
            cursor += length;
            output
        };
        let mut position_um = [0_i64; 3];
        for value in &mut position_um {
            *value = i64::from_le_bytes(take(8).try_into().expect("bounded slice"));
        }
        let mut normal_q15 = [0_i16; 3];
        for value in &mut normal_q15 {
            *value = i16::from_le_bytes(take(2).try_into().expect("bounded slice"));
        }
        let color_rgba = take(4).try_into().expect("bounded slice");
        let radius_um = u32::from_le_bytes(take(4).try_into().expect("bounded slice"));
        let confidence_basis_points =
            u16::from_le_bytes(take(2).try_into().expect("bounded slice"));
        let sample = SurfelSample {
            position_um,
            normal_q15,
            color_rgba,
            radius_um,
            confidence_basis_points,
        };
        validate_sample(&sample)?;
        samples.push(sample);
    }
    Ok(samples)
}

fn encode_surfel_chunk(samples: &[SurfelSample]) -> Result<Vec<u8>, ForgeError> {
    let count = u32::try_from(samples.len()).map_err(|_| ForgeError::SampleLimit)?;
    let capacity = SURFEL_MAGIC
        .len()
        .checked_add(4)
        .and_then(|value| value.checked_add(samples.len().checked_mul(SURFEL_BYTES)?))
        .ok_or(ForgeError::SampleLimit)?;
    let mut bytes = Vec::with_capacity(capacity);
    bytes.extend_from_slice(SURFEL_MAGIC);
    bytes.extend_from_slice(&count.to_le_bytes());
    for sample in samples {
        for value in sample.position_um {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        for value in sample.normal_q15 {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        bytes.extend_from_slice(&sample.color_rgba);
        bytes.extend_from_slice(&sample.radius_um.to_le_bytes());
        bytes.extend_from_slice(&sample.confidence_basis_points.to_le_bytes());
    }
    Ok(bytes)
}

fn validate_policy(policy: &CapturePolicy) -> Result<(), ForgeError> {
    if !policy.operator_confirmed {
        return Err(ForgeError::OperatorConsentRequired);
    }
    if !policy.visible_recording {
        return Err(ForgeError::VisibleRecordingRequired);
    }
    if !policy.local_processing {
        return Err(ForgeError::LocalProcessingRequired);
    }
    if policy.derivative_license.trim().is_empty() || policy.derivative_license.len() > 128 {
        return Err(ForgeError::InvalidPolicy);
    }
    for volume in &policy.exclusions {
        if (0..3).any(|axis| volume.min_um[axis] > volume.max_um[axis]) {
            return Err(ForgeError::InvalidPolicy);
        }
    }
    Ok(())
}

fn validate_session(session: &CaptureSession) -> Result<(), ForgeError> {
    if session.samples.is_empty() {
        return Err(ForgeError::EmptyCapture);
    }
    if session.samples.len() > MAX_SURFELS {
        return Err(ForgeError::SampleLimit);
    }
    if session.clock_source.trim().is_empty()
        || session.clock_source.len() > 256
        || session.producer.trim().is_empty()
        || session.producer.len() > 256
    {
        return Err(ForgeError::InvalidSession);
    }
    if session
        .captured_until_unix_us
        .is_some_and(|end| end < session.captured_at_unix_us)
    {
        return Err(ForgeError::InvalidSession);
    }
    Ok(())
}

fn validate_sample(sample: &SurfelSample) -> Result<(), ForgeError> {
    if sample.radius_um == 0 || sample.confidence_basis_points > 10_000 {
        return Err(ForgeError::InvalidSample);
    }
    let norm = sample
        .normal_q15
        .into_iter()
        .map(|value| i64::from(value) * i64::from(value))
        .sum::<i64>();
    let one = 32_767_i64 * 32_767_i64;
    if (norm - one).abs() > one / 50 {
        return Err(ForgeError::InvalidSample);
    }
    Ok(())
}

fn contains(volume: &ExclusionVolume, point: [i64; 3]) -> bool {
    (0..3).all(|axis| point[axis] >= volume.min_um[axis] && point[axis] <= volume.max_um[axis])
}

fn sample_bounds(samples: &[SurfelSample]) -> Result<([i64; 3], [i64; 3]), ForgeError> {
    let mut minimum = [i64::MAX; 3];
    let mut maximum = [i64::MIN; 3];
    for sample in samples {
        let radius = i64::from(sample.radius_um);
        for axis in 0..3 {
            minimum[axis] = minimum[axis].min(
                sample.position_um[axis]
                    .checked_sub(radius)
                    .ok_or(ForgeError::CoordinateOverflow)?,
            );
            maximum[axis] = maximum[axis].max(
                sample.position_um[axis]
                    .checked_add(radius)
                    .ok_or(ForgeError::CoordinateOverflow)?,
            );
        }
    }
    Ok((minimum, maximum))
}

/// Forge rejection.
#[derive(Debug, Error)]
pub enum ForgeError {
    /// Operator authorization was absent.
    #[error("operator capture authorization is required")]
    OperatorConsentRequired,
    /// Recording state was not visible.
    #[error("visible recording state is required")]
    VisibleRecordingRequired,
    /// The operation attempted to leave local processing mode.
    #[error("capture Forge requires local processing")]
    LocalProcessingRequired,
    /// Capture policy was malformed.
    #[error("invalid capture policy")]
    InvalidPolicy,
    /// Capture metadata was malformed.
    #[error("invalid capture session")]
    InvalidSession,
    /// Capture contained no samples.
    #[error("capture contains no surfels")]
    EmptyCapture,
    /// Every sample was removed by policy.
    #[error("privacy policy removed every sample")]
    EmptyDerivative,
    /// A surfel was malformed.
    #[error("invalid surfel sample")]
    InvalidSample,
    /// Sample count exceeded the bounded codec profile.
    #[error("surfel sample limit exceeded")]
    SampleLimit,
    /// Encoded bytes were malformed.
    #[error("malformed surfel chunk")]
    MalformedChunk,
    /// Bounds overflowed the canonical coordinate range.
    #[error("surfel coordinate overflow")]
    CoordinateOverflow,
    /// Public report unexpectedly contained raw capture samples.
    #[error("public Forge report disclosed raw capture samples")]
    RawCaptureDisclosure,
    /// Public surfel bytes, identity, or count did not match.
    #[error("public Forge chunk mismatch")]
    PublicChunkMismatch,
    /// Forge Cell identity or Merkle root did not match.
    #[error("Forge Cell identity mismatch")]
    CellMismatch,
    /// Forge report projection digest did not match.
    #[error("Forge report identity mismatch")]
    ReportMismatch,
    /// JSON encoding failed.
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    /// Canonical identity failed.
    #[error(transparent)]
    Canonical(#[from] tessaryn_canonical::CanonicalError),
}

#[cfg(test)]
mod tests {
    use super::*;

    fn digest(value: u8) -> Digest {
        Digest::new(format!("sha256:{}", format!("{value:02x}").repeat(32))).unwrap()
    }

    fn sample(position_um: [i64; 3], color_rgba: [u8; 4]) -> SurfelSample {
        SurfelSample {
            position_um,
            normal_q15: [0, 0, 32_767],
            color_rgba,
            radius_um: 2_000,
            confidence_basis_points: 9_500,
        }
    }

    fn session(samples: Vec<SurfelSample>) -> CaptureSession {
        CaptureSession {
            session_id: digest(1),
            anchor_id: digest(2),
            captured_at_unix_us: 100,
            captured_until_unix_us: None,
            clock_source: "capture/test-v0".to_string(),
            producer: "test-device".to_string(),
            device_key: Some(digest(3)),
            samples,
        }
    }

    fn policy() -> CapturePolicy {
        CapturePolicy {
            operator_confirmed: true,
            visible_recording: true,
            local_processing: true,
            publication_allowed: true,
            retain_raw: false,
            exclusions: vec![ExclusionVolume {
                id: digest(4),
                min_um: [90_000, -10_000, -10_000],
                max_um: [110_000, 10_000, 10_000],
            }],
            derivative_license: "CC0-1.0".to_string(),
        }
    }

    #[test]
    fn exclusion_happens_before_public_chunk_encoding() {
        let hidden = sample([100_000, 0, 0], [255, 0, 255, 255]);
        let report = forge_surfel_cell(
            session(vec![
                sample([0, 0, 0], [10, 20, 30, 255]),
                hidden.clone(),
                sample([20_000, 0, 0], [40, 50, 60, 255]),
            ]),
            policy(),
        )
        .unwrap();
        assert_eq!(report.accepted_samples, 2);
        assert_eq!(report.excluded_samples, 1);
        assert!(!report.raw_embedded);
        let decoded = decode_surfel_chunk(&report.public_chunk).unwrap();
        assert!(!decoded.contains(&hidden));
        assert_eq!(chunk_id(&report.public_chunk), report.public_chunk_id);
    }

    #[test]
    fn unordered_surfel_input_produces_one_cell_identity() {
        let left = sample([0, 0, 0], [10, 20, 30, 255]);
        let right = sample([20_000, 0, 0], [40, 50, 60, 255]);
        let first =
            forge_surfel_cell(session(vec![left.clone(), right.clone()]), policy()).unwrap();
        let second = forge_surfel_cell(session(vec![right, left]), policy()).unwrap();
        assert_eq!(first.cell_id, second.cell_id);
        assert_eq!(first.public_chunk, second.public_chunk);
    }

    #[test]
    fn capture_without_explicit_authorization_is_rejected() {
        let mut denied = policy();
        denied.operator_confirmed = false;
        assert!(matches!(
            forge_surfel_cell(session(vec![sample([0, 0, 0], [0; 4])]), denied),
            Err(ForgeError::OperatorConsentRequired)
        ));
    }

    #[test]
    fn malformed_or_truncated_chunks_are_rejected() {
        assert!(matches!(
            decode_surfel_chunk(b"not-a-surfel"),
            Err(ForgeError::MalformedChunk)
        ));
        let report = forge_surfel_cell(
            session(vec![sample([0, 0, 0], [10, 20, 30, 255])]),
            policy(),
        )
        .unwrap();
        assert!(
            decode_surfel_chunk(&report.public_chunk[..report.public_chunk.len() - 1]).is_err()
        );
    }

    #[test]
    fn capture_interval_is_identity_bearing_and_ordered() {
        let mut ranged = session(vec![sample([0, 0, 0], [10, 20, 30, 255])]);
        ranged.captured_until_unix_us = Some(200);
        let report = forge_surfel_cell(ranged.clone(), policy()).unwrap();
        assert_eq!(report.manifest.temporal_extent.start_unix_us, 100);
        assert_eq!(report.manifest.temporal_extent.end_unix_us, 200);
        assert_eq!(report.manifest.temporal_extent.published_at_unix_us, 200);

        let instant = forge_surfel_cell(
            session(vec![sample([0, 0, 0], [10, 20, 30, 255])]),
            policy(),
        )
        .unwrap();
        assert_ne!(report.cell_id, instant.cell_id);

        ranged.captured_until_unix_us = Some(99);
        assert!(matches!(
            forge_surfel_cell(ranged, policy()),
            Err(ForgeError::InvalidSession)
        ));
    }

    #[test]
    fn public_forge_report_reverifies_and_projection_mutation_rejects() {
        let report = forge_surfel_cell(
            session(vec![sample([0, 0, 0], [10, 20, 30, 255])]),
            policy(),
        )
        .unwrap();
        assert_eq!(verify_forge_report(&report).unwrap().verified_samples, 1);

        let mut projection_mutation = report.clone();
        projection_mutation.excluded_samples += 1;
        assert!(matches!(
            verify_forge_report(&projection_mutation),
            Err(ForgeError::ReportMismatch)
        ));
        let mut raw_mutation = report;
        raw_mutation.raw_embedded = true;
        assert!(matches!(
            verify_forge_report(&raw_mutation),
            Err(ForgeError::RawCaptureDisclosure)
        ));
    }
}
