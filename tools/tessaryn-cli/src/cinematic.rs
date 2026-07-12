use serde::{Deserialize, Serialize};
use sha2::{Digest as ShaDigest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use tessaryn_canonical::{chunk_id, chunk_merkle_root, parse_strict_json_bounded};
use tessaryn_powerhouse::{prove_cell, verify_bundle, CellProofBundle, CellProofReport};
use tessaryn_schema::{
    CellClass, CellManifestV0, ChannelDescriptor, Criticality, Digest, EvidenceDeclaration,
    SourceRecord, SpatialExtent, TemporalExtent, TemporalStateKind, CELL_SCHEMA_V0,
};

const MAGIC: &[u8; 16] = b"TESSARYN-CIN4D\0\0";
const VERSION: u32 = 1;
const HEADER_BYTES: u32 = 80;
const MEDIA_CHUNK_BYTES: usize = 4 * 1024 * 1024;
const MAX_MANIFEST_BYTES: usize = 16 * 1024 * 1024;
const DESCRIPTOR_SCHEMA: &str = "tessaryn/cinematic-object-descriptor/v1";
const ENVELOPE_SCHEMA: &str = "tessaryn/cinematic-object/v1";
const GEOMETRY_PROFILE: &str = "tessaryn/continuum-monument/v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CinematicObjectDescriptorV1 {
    pub schema: String,
    pub object_id: String,
    pub title: String,
    pub created_at_unix_us: i64,
    pub duration_ms: u64,
    pub geometry: CinematicGeometryV1,
    pub media: CinematicMediaDescriptorV1,
    pub moments: Vec<CinematicMomentV1>,
    pub slbit: CinematicSlbitV1,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CinematicGeometryV1 {
    pub profile: String,
    pub seed: u32,
    pub cell_count: u32,
    pub shell_count: u16,
    pub ribbon_count: u16,
    pub phase_count: u16,
    pub bounds_um: [u64; 3],
    pub quality_tier: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CinematicMediaDescriptorV1 {
    pub mime: String,
    pub width: u32,
    pub height: u32,
    pub frame_rate_millihz: u32,
    pub codec: String,
    pub codec_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CinematicMomentV1 {
    pub id: String,
    pub label: String,
    pub time_ms: u64,
    pub phase_milli: i32,
    pub meaning: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CinematicSlbitV1 {
    pub schema: String,
    pub claim_state: String,
    pub summary: String,
    pub statements: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CinematicMediaCommitmentV1 {
    pub payload_bytes: u64,
    pub chunk_bytes: u32,
    pub chunk_ids: Vec<Digest>,
    pub chunk_merkle_root: Digest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CinematicObjectEnvelopeV1 {
    pub schema: String,
    pub descriptor: CinematicObjectDescriptorV1,
    pub descriptor_chunk_id: Digest,
    pub media: CinematicMediaCommitmentV1,
    pub cell_proof: CellProofBundle,
    pub cell_proof_report: CellProofReport,
}

#[derive(Debug, Clone, Serialize)]
pub struct CinematicObjectReportV1 {
    pub schema: &'static str,
    pub object_id: String,
    pub bytes: u64,
    pub media_bytes: u64,
    pub media_chunks: usize,
    pub cell_id: Digest,
    pub rootprint_branch: String,
    pub pha_valid: bool,
    pub rootprint_valid: bool,
    pub replay_valid: bool,
    pub memory_capsule_valid: bool,
}

pub fn pack_cinematic_object(
    descriptor_path: &Path,
    media_path: &Path,
    output_path: &Path,
) -> Result<CinematicObjectReportV1, Box<dyn std::error::Error>> {
    let descriptor_value = parse_strict_json_bounded(
        &fs::read(descriptor_path)?,
        tessaryn_canonical::MAX_MANIFEST_BYTES,
    )?;
    let descriptor = serde_json::from_value::<CinematicObjectDescriptorV1>(descriptor_value)?;
    validate_descriptor(&descriptor)?;

    let descriptor_bytes = canonical_json_bytes(&descriptor)?;
    let descriptor_chunk_id = chunk_id(&descriptor_bytes);
    let (media_bytes, media_chunk_ids) = commit_media(media_path)?;
    let media_root = chunk_merkle_root(&media_chunk_ids);
    let geometry_root = chunk_merkle_root(std::slice::from_ref(&descriptor_chunk_id));
    let mut all_chunks = Vec::with_capacity(media_chunk_ids.len() + 1);
    all_chunks.push(descriptor_chunk_id.clone());
    all_chunks.extend(media_chunk_ids.iter().cloned());
    let world_root = chunk_merkle_root(&all_chunks);
    let duration_us = i64::try_from(descriptor.duration_ms)?
        .checked_mul(1_000)
        .ok_or("cinematic duration exceeds the temporal profile")?;
    let end_unix_us = descriptor
        .created_at_unix_us
        .checked_add(duration_us)
        .ok_or("cinematic temporal extent overflow")?;
    let manifest = CellManifestV0 {
        schema: CELL_SCHEMA_V0.to_string(),
        class: CellClass::Simulation,
        anchor_id: chunk_id(
            format!("TESSARYN-CINEMATIC-ANCHOR-v1\0{}", descriptor.object_id).as_bytes(),
        ),
        spatial_extent: SpatialExtent {
            min_um: descriptor
                .geometry
                .bounds_um
                .map(|value| -(value as i64) / 2),
            max_um: descriptor.geometry.bounds_um.map(|value| value as i64 / 2),
            orientation_q30: [0, 0, 0, 1 << 30],
            uncertainty_um: [0, 0, 0],
        },
        temporal_extent: TemporalExtent {
            start_unix_us: descriptor.created_at_unix_us,
            end_unix_us,
            uncertainty_us: 0,
            clock_source: "tessaryn/cinematic-timeline/v1".to_string(),
            published_at_unix_us: descriptor.created_at_unix_us,
            valid_from_unix_us: descriptor.created_at_unix_us,
            valid_until_unix_us: None,
            supersedes: Vec::new(),
            state_kind: TemporalStateKind::Predicted,
        },
        channels: vec![
            ChannelDescriptor {
                role: "appearance/cinematic".to_string(),
                codec: descriptor.media.codec.clone(),
                codec_version: descriptor.media.codec_version.clone(),
                chunk_root: media_root.clone(),
                uncompressed_bytes: media_bytes,
                quality_tier: descriptor.geometry.quality_tier,
                criticality: Criticality::Critical,
                license: "LicenseRef-TESSARYN-Showcase".to_string(),
            },
            ChannelDescriptor {
                role: "geometry/procedural".to_string(),
                codec: GEOMETRY_PROFILE.to_string(),
                codec_version: "1".to_string(),
                chunk_root: geometry_root,
                uncompressed_bytes: descriptor_bytes.len() as u64,
                quality_tier: descriptor.geometry.quality_tier,
                criticality: Criticality::Critical,
                license: "LicenseRef-TESSARYN-Showcase".to_string(),
            },
        ],
        parents: Vec::new(),
        source_records: vec![SourceRecord {
            source_id: descriptor_chunk_id.clone(),
            source_type: "authored-cinematic-object".to_string(),
            producer: "tessaryn-studio".to_string(),
            captured_at_unix_us: descriptor.created_at_unix_us,
            device_key: None,
        }],
        transform_records: Vec::new(),
        policy_root: chunk_id(b"TESSARYN-PUBLIC-LOCAL-OBJECT-POLICY-v1\0"),
        evidence: EvidenceDeclaration {
            identity_committed: true,
            replay_available: true,
            source_attributed: true,
            disputed: false,
            semantic_only: false,
            restricted: false,
        },
        chunk_merkle_root: world_root,
    };
    let cell_proof = prove_cell(manifest, Some(serde_json::to_value(&descriptor.slbit)?))?;
    let cell_proof_report = verify_bundle(&cell_proof)?;
    let envelope = CinematicObjectEnvelopeV1 {
        schema: ENVELOPE_SCHEMA.to_string(),
        descriptor,
        descriptor_chunk_id,
        media: CinematicMediaCommitmentV1 {
            payload_bytes: media_bytes,
            chunk_bytes: MEDIA_CHUNK_BYTES as u32,
            chunk_ids: media_chunk_ids,
            chunk_merkle_root: media_root,
        },
        cell_proof,
        cell_proof_report,
    };
    let manifest_bytes = serde_json::to_vec(&envelope)?;
    if manifest_bytes.len() > MAX_MANIFEST_BYTES {
        return Err("cinematic object manifest exceeds 16 MiB".into());
    }
    let manifest_hash = Sha256::digest(&manifest_bytes);
    let temporary = temporary_path(output_path);
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let result = (|| -> Result<(), Box<dyn std::error::Error>> {
        let mut output = BufWriter::new(
            OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&temporary)?,
        );
        write_header(
            &mut output,
            manifest_bytes.len() as u64,
            media_bytes,
            &manifest_hash,
        )?;
        output.write_all(&manifest_bytes)?;
        std::io::copy(&mut BufReader::new(File::open(media_path)?), &mut output)?;
        output.flush()?;
        output.get_ref().sync_all()?;
        Ok(())
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    fs::rename(&temporary, output_path)?;
    verify_cinematic_object(output_path)
}

pub fn verify_cinematic_object(
    input_path: &Path,
) -> Result<CinematicObjectReportV1, Box<dyn std::error::Error>> {
    let mut input = BufReader::new(File::open(input_path)?);
    let metadata = input.get_ref().metadata()?;
    let header = read_header(&mut input)?;
    let expected_bytes = u64::from(HEADER_BYTES)
        .checked_add(header.manifest_bytes)
        .and_then(|value| value.checked_add(header.media_bytes))
        .ok_or("cinematic object size overflow")?;
    if metadata.len() != expected_bytes {
        return Err("cinematic object length does not match its header".into());
    }
    if header.manifest_bytes > MAX_MANIFEST_BYTES as u64 {
        return Err("cinematic object manifest exceeds 16 MiB".into());
    }
    let mut manifest_bytes = vec![0_u8; header.manifest_bytes as usize];
    input.read_exact(&mut manifest_bytes)?;
    if Sha256::digest(&manifest_bytes).as_slice() != header.manifest_sha256 {
        return Err("cinematic object manifest digest mismatch".into());
    }
    let value = parse_strict_json_bounded(&manifest_bytes, MAX_MANIFEST_BYTES)?;
    let envelope = serde_json::from_value::<CinematicObjectEnvelopeV1>(value)?;
    validate_descriptor(&envelope.descriptor)?;
    if envelope.schema != ENVELOPE_SCHEMA || envelope.media.payload_bytes != header.media_bytes {
        return Err("unsupported cinematic object envelope".into());
    }
    let descriptor_bytes = canonical_json_bytes(&envelope.descriptor)?;
    let descriptor_chunk_id = chunk_id(&descriptor_bytes);
    if descriptor_chunk_id != envelope.descriptor_chunk_id {
        return Err("cinematic geometry descriptor commitment mismatch".into());
    }
    let media_chunk_ids = commit_media_reader(&mut input, header.media_bytes)?;
    if media_chunk_ids != envelope.media.chunk_ids
        || chunk_merkle_root(&media_chunk_ids) != envelope.media.chunk_merkle_root
    {
        return Err("cinematic media commitment mismatch".into());
    }
    let media_channel = envelope
        .cell_proof
        .manifest
        .channels
        .iter()
        .find(|channel| channel.role == "appearance/cinematic")
        .ok_or("cinematic media channel missing")?;
    let geometry_channel = envelope
        .cell_proof
        .manifest
        .channels
        .iter()
        .find(|channel| channel.role == "geometry/procedural")
        .ok_or("cinematic geometry channel missing")?;
    let mut world_chunks = Vec::with_capacity(media_chunk_ids.len() + 1);
    world_chunks.push(descriptor_chunk_id);
    world_chunks.extend(media_chunk_ids.iter().cloned());
    if envelope.media.chunk_bytes != MEDIA_CHUNK_BYTES as u32
        || media_channel.chunk_root != envelope.media.chunk_merkle_root
        || media_channel.uncompressed_bytes != header.media_bytes
        || geometry_channel.chunk_root
            != chunk_merkle_root(std::slice::from_ref(&envelope.descriptor_chunk_id))
        || envelope.cell_proof.manifest.chunk_merkle_root != chunk_merkle_root(&world_chunks)
    {
        return Err("cinematic Cell channel binding mismatch".into());
    }
    let proof_report = verify_bundle(&envelope.cell_proof)?;
    if proof_report != envelope.cell_proof_report {
        return Err("cinematic stored proof report mismatch".into());
    }
    Ok(CinematicObjectReportV1 {
        schema: "tessaryn/cinematic-object-report/v1",
        object_id: envelope.descriptor.object_id,
        bytes: metadata.len(),
        media_bytes: header.media_bytes,
        media_chunks: media_chunk_ids.len(),
        cell_id: envelope.cell_proof.cell_id,
        rootprint_branch: envelope.cell_proof.rootprint.root_branch.clone(),
        pha_valid: proof_report.pha_valid,
        rootprint_valid: proof_report.rootprint_valid,
        replay_valid: proof_report.replay_valid,
        memory_capsule_valid: proof_report.memory_capsule_valid,
    })
}

fn validate_descriptor(
    descriptor: &CinematicObjectDescriptorV1,
) -> Result<(), Box<dyn std::error::Error>> {
    if descriptor.schema != DESCRIPTOR_SCHEMA
        || descriptor.geometry.profile != GEOMETRY_PROFILE
        || descriptor.media.mime != "video/mp4"
        || descriptor.media.codec != "h264"
        || descriptor.object_id.trim().is_empty()
        || descriptor.title.trim().is_empty()
        || descriptor.duration_ms == 0
        || descriptor.media.width < 1_280
        || descriptor.media.height < 720
        || descriptor.media.frame_rate_millihz < 24_000
        || descriptor.geometry.cell_count < 24
        || descriptor.geometry.shell_count < 3
        || descriptor.geometry.ribbon_count < 3
        || descriptor.geometry.phase_count < 3
        || descriptor.geometry.bounds_um.contains(&0)
        || descriptor.moments.len() < 3
        || descriptor.slbit.schema != "slbit/viz-packet/v3"
        || descriptor.slbit.statements.is_empty()
    {
        return Err("invalid cinematic object descriptor".into());
    }
    let mut last = None;
    for moment in &descriptor.moments {
        if moment.id.trim().is_empty()
            || moment.label.trim().is_empty()
            || moment.meaning.trim().is_empty()
            || moment.time_ms >= descriptor.duration_ms
            || last.is_some_and(|value| moment.time_ms <= value)
        {
            return Err("cinematic Moments must be unique and strictly time-ordered".into());
        }
        last = Some(moment.time_ms);
    }
    Ok(())
}

fn commit_media(path: &Path) -> Result<(u64, Vec<Digest>), Box<dyn std::error::Error>> {
    let mut input = BufReader::new(File::open(path)?);
    let bytes = input.get_ref().metadata()?.len();
    if bytes == 0 {
        return Err("cinematic media is empty".into());
    }
    let chunks = commit_media_reader(&mut input, bytes)?;
    Ok((bytes, chunks))
}

fn commit_media_reader<R: Read>(
    input: &mut R,
    bytes: u64,
) -> Result<Vec<Digest>, Box<dyn std::error::Error>> {
    let mut remaining = bytes;
    let mut buffer = vec![0_u8; MEDIA_CHUNK_BYTES];
    let mut chunks = Vec::new();
    while remaining > 0 {
        let expected = usize::try_from(remaining.min(MEDIA_CHUNK_BYTES as u64))?;
        input.read_exact(&mut buffer[..expected])?;
        chunks.push(chunk_id(&buffer[..expected]));
        remaining -= expected as u64;
    }
    Ok(chunks)
}

struct Header {
    manifest_bytes: u64,
    media_bytes: u64,
    manifest_sha256: [u8; 32],
}

fn write_header<W: Write>(
    output: &mut W,
    manifest_bytes: u64,
    media_bytes: u64,
    manifest_sha256: &[u8],
) -> Result<(), Box<dyn std::error::Error>> {
    if manifest_sha256.len() != 32 {
        return Err("invalid manifest digest length".into());
    }
    output.write_all(MAGIC)?;
    output.write_all(&VERSION.to_le_bytes())?;
    output.write_all(&HEADER_BYTES.to_le_bytes())?;
    output.write_all(&manifest_bytes.to_le_bytes())?;
    output.write_all(&media_bytes.to_le_bytes())?;
    output.write_all(manifest_sha256)?;
    output.write_all(&[0_u8; 8])?;
    Ok(())
}

fn read_header<R: Read>(input: &mut R) -> Result<Header, Box<dyn std::error::Error>> {
    let mut bytes = [0_u8; HEADER_BYTES as usize];
    input.read_exact(&mut bytes)?;
    if &bytes[..16] != MAGIC
        || u32::from_le_bytes(bytes[16..20].try_into()?) != VERSION
        || u32::from_le_bytes(bytes[20..24].try_into()?) != HEADER_BYTES
        || bytes[72..80] != [0_u8; 8]
    {
        return Err("unsupported cinematic object header".into());
    }
    Ok(Header {
        manifest_bytes: u64::from_le_bytes(bytes[24..32].try_into()?),
        media_bytes: u64::from_le_bytes(bytes[32..40].try_into()?),
        manifest_sha256: bytes[40..72].try_into()?,
    })
}

fn canonical_json_bytes<T: Serialize>(value: &T) -> Result<Vec<u8>, serde_json::Error> {
    serde_json::to_vec(&serde_json::to_value(value)?)
}

fn temporary_path(output: &Path) -> PathBuf {
    let mut value = output.as_os_str().to_os_string();
    value.push(format!(".tmp-{}", std::process::id()));
    PathBuf::from(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn header_round_trips_and_rejects_reserved_bytes() {
        let mut bytes = Vec::new();
        write_header(&mut bytes, 123, 456, &[7_u8; 32]).unwrap();
        assert_eq!(bytes.len(), HEADER_BYTES as usize);
        let header = read_header(&mut bytes.as_slice()).unwrap();
        assert_eq!(header.manifest_bytes, 123);
        assert_eq!(header.media_bytes, 456);
        assert_eq!(header.manifest_sha256, [7_u8; 32]);
        bytes[79] = 1;
        assert!(read_header(&mut bytes.as_slice()).is_err());
    }

    #[test]
    fn descriptor_requires_native_temporal_structure() {
        let mut descriptor = fixture_descriptor();
        assert!(validate_descriptor(&descriptor).is_ok());
        descriptor.moments[1].time_ms = descriptor.moments[0].time_ms;
        assert!(validate_descriptor(&descriptor).is_err());
    }

    #[test]
    fn package_round_trip_rejects_manifest_media_and_trailing_mutations() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory =
            std::env::temp_dir().join(format!("tessaryn-cinematic-{}-{nonce}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let descriptor_path = directory.join("descriptor.json");
        let media_path = directory.join("material.mp4");
        let object_path = directory.join("object.tessaryn");
        fs::write(
            &descriptor_path,
            serde_json::to_vec(&fixture_descriptor()).unwrap(),
        )
        .unwrap();
        let media = (0..MEDIA_CHUNK_BYTES + 17)
            .map(|index| ((index * 31 + 7) % 251) as u8)
            .collect::<Vec<_>>();
        fs::write(&media_path, media).unwrap();
        let report = pack_cinematic_object(&descriptor_path, &media_path, &object_path).unwrap();
        assert_eq!(report.media_chunks, 2);
        assert!(report.pha_valid && report.rootprint_valid && report.memory_capsule_valid);

        let original = fs::read(&object_path).unwrap();
        let header = read_header(&mut original.as_slice()).unwrap();
        let payload_offset = HEADER_BYTES as usize + header.manifest_bytes as usize;
        for (name, mutate) in [
            ("manifest", HEADER_BYTES as usize + 8),
            ("media", payload_offset + 8),
        ] {
            let mut bytes = original.clone();
            bytes[mutate] ^= 0x01;
            let path = directory.join(format!("{name}.tessaryn"));
            fs::write(&path, bytes).unwrap();
            assert!(verify_cinematic_object(&path).is_err());
        }
        let mut trailing = original;
        trailing.push(0);
        let trailing_path = directory.join("trailing.tessaryn");
        fs::write(&trailing_path, trailing).unwrap();
        assert!(verify_cinematic_object(&trailing_path).is_err());
        fs::remove_dir_all(directory).unwrap();
    }

    fn fixture_descriptor() -> CinematicObjectDescriptorV1 {
        CinematicObjectDescriptorV1 {
            schema: DESCRIPTOR_SCHEMA.to_string(),
            object_id: "continuum-monument-01".to_string(),
            title: "Continuum Monument".to_string(),
            created_at_unix_us: 1_783_833_600_000_000,
            duration_ms: 12_000,
            geometry: CinematicGeometryV1 {
                profile: GEOMETRY_PROFILE.to_string(),
                seed: 0x51f15e,
                cell_count: 48,
                shell_count: 5,
                ribbon_count: 4,
                phase_count: 4,
                bounds_um: [9_000_000, 9_000_000, 7_000_000],
                quality_tier: 4,
            },
            media: CinematicMediaDescriptorV1 {
                mime: "video/mp4".to_string(),
                width: 2_560,
                height: 1_440,
                frame_rate_millihz: 30_000,
                codec: "h264".to_string(),
                codec_version: "high-5.1".to_string(),
            },
            moments: vec![
                CinematicMomentV1 {
                    id: "origin".to_string(),
                    label: "Origin".to_string(),
                    time_ms: 0,
                    phase_milli: 0,
                    meaning: "Construction begins.".to_string(),
                },
                CinematicMomentV1 {
                    id: "memory".to_string(),
                    label: "Memory".to_string(),
                    time_ms: 4_000,
                    phase_milli: 333,
                    meaning: "Memory enters the structure.".to_string(),
                },
                CinematicMomentV1 {
                    id: "continuum".to_string(),
                    label: "Continuum".to_string(),
                    time_ms: 8_000,
                    phase_milli: 667,
                    meaning: "Temporal layers remain navigable.".to_string(),
                },
            ],
            slbit: CinematicSlbitV1 {
                schema: "slbit/viz-packet/v3".to_string(),
                claim_state: "AUTHORED_TEMPORAL_OBJECT".to_string(),
                summary: "A native temporal object.".to_string(),
                statements: vec!["Media is an internal material.".to_string()],
            },
        }
    }
}
