use crate::{decode_hex, encode_hex, EformEngine, EformError, EformSignature};
use power_house::transcript_digest;

pub const WORLD_CELL_ASSURANCE_PROFILE: &str = "eform/world-cell-assurance/v1";
const WORLD_CELL_ENVELOPE_FINAL: u64 = 0x5743_454e_5631_0001;
const ZERO_DIGEST: Digest32 = [0; 32];

pub type Digest32 = [u8; 32];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorldCellArtifactKind {
    ReconstructionReceipt,
    Moment,
    Transfer,
    WorldCell,
}

impl WorldCellArtifactKind {
    fn code(self) -> u64 {
        match self {
            Self::ReconstructionReceipt => 1,
            Self::Moment => 2,
            Self::Transfer => 3,
            Self::WorldCell => 4,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::ReconstructionReceipt => "reconstruction-receipt",
            Self::Moment => "moment",
            Self::Transfer => "transfer",
            Self::WorldCell => "world-cell",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorldCellEvidence {
    pub artifact_kind: WorldCellArtifactKind,
    pub canonical_digest: Digest32,
    pub reconstruction_receipt: Digest32,
    pub runtime_commitment: Digest32,
    pub parent_commitment: Digest32,
    pub sequence: u64,
    pub metric_scale: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorldCellAssurance {
    pub profile: String,
    pub evidence: WorldCellEvidence,
    pub envelope_digest_hex: String,
    pub signature: EformSignature,
}

impl WorldCellAssurance {
    pub fn canonical_record(&self) -> String {
        format!(
            concat!(
                "profile={}\n",
                "artifact_kind={}\n",
                "canonical_digest={}\n",
                "reconstruction_receipt={}\n",
                "runtime_commitment={}\n",
                "parent_commitment={}\n",
                "sequence={}\n",
                "scale={}\n",
                "envelope_digest={}\n",
                "{}"
            ),
            self.profile,
            self.evidence.artifact_kind.as_str(),
            encode_hex(&self.evidence.canonical_digest),
            encode_hex(&self.evidence.reconstruction_receipt),
            encode_hex(&self.evidence.runtime_commitment),
            encode_hex(&self.evidence.parent_commitment),
            self.evidence.sequence,
            if self.evidence.metric_scale {
                "metric"
            } else {
                "relative"
            },
            self.envelope_digest_hex,
            self.signature.canonical_record(),
        )
    }
}

fn digest_words(digest: &Digest32, output: &mut Vec<u64>) {
    for chunk in digest.chunks_exact(8) {
        let mut word = [0u8; 8];
        word.copy_from_slice(chunk);
        output.push(u64::from_be_bytes(word));
    }
}

fn profile_words(output: &mut Vec<u64>) {
    let bytes = WORLD_CELL_ASSURANCE_PROFILE.as_bytes();
    output.push(bytes.len() as u64);
    for chunk in bytes.chunks(8) {
        let mut word = [0u8; 8];
        word[..chunk.len()].copy_from_slice(chunk);
        output.push(u64::from_be_bytes(word));
    }
}

fn nonzero(name: &str, digest: &Digest32) -> Result<(), EformError> {
    if digest == &ZERO_DIGEST {
        return Err(EformError::Policy(format!("{name} must not be zero")));
    }
    Ok(())
}

pub fn validate_world_cell_evidence(evidence: &WorldCellEvidence) -> Result<(), EformError> {
    nonzero("canonical digest", &evidence.canonical_digest)?;
    nonzero("reconstruction receipt", &evidence.reconstruction_receipt)?;
    nonzero("runtime commitment", &evidence.runtime_commitment)?;
    if evidence.sequence == 0 {
        return Err(EformError::Policy(
            "World Cell evidence sequence must be nonzero".to_string(),
        ));
    }
    if evidence.sequence > 1 && evidence.parent_commitment == ZERO_DIGEST {
        return Err(EformError::Policy(
            "non-genesis evidence requires a parent commitment".to_string(),
        ));
    }
    Ok(())
}

pub fn world_cell_envelope_digest(
    evidence: &WorldCellEvidence,
) -> Result<Digest32, EformError> {
    validate_world_cell_evidence(evidence)?;
    let mut transcript = Vec::with_capacity(25);
    profile_words(&mut transcript);
    transcript.push(1);
    transcript.push(evidence.artifact_kind.code());
    transcript.push(evidence.sequence);
    transcript.push(u64::from(evidence.metric_scale));
    digest_words(&evidence.canonical_digest, &mut transcript);
    digest_words(&evidence.reconstruction_receipt, &mut transcript);
    digest_words(&evidence.runtime_commitment, &mut transcript);
    digest_words(&evidence.parent_commitment, &mut transcript);
    Ok(transcript_digest(
        &transcript,
        &[],
        WORLD_CELL_ENVELOPE_FINAL,
    ))
}

impl EformEngine {
    pub fn sign_world_cell_evidence(
        &self,
        evidence: WorldCellEvidence,
    ) -> Result<WorldCellAssurance, EformError> {
        let envelope_digest = world_cell_envelope_digest(&evidence)?;
        let signature = self.sign_hash256(&envelope_digest)?;
        Ok(WorldCellAssurance {
            profile: WORLD_CELL_ASSURANCE_PROFILE.to_string(),
            evidence,
            envelope_digest_hex: encode_hex(&envelope_digest),
            signature,
        })
    }
}

pub fn verify_world_cell_assurance(assurance: &WorldCellAssurance) -> Result<(), EformError> {
    if assurance.profile != WORLD_CELL_ASSURANCE_PROFILE {
        return Err(EformError::Policy(
            "World Cell assurance profile mismatch".to_string(),
        ));
    }
    let expected = world_cell_envelope_digest(&assurance.evidence)?;
    let recorded = decode_hex(&assurance.envelope_digest_hex)?;
    if recorded.as_slice() != expected.as_slice() {
        return Err(EformError::Signature(
            "World Cell envelope digest mismatch".to_string(),
        ));
    }
    if assurance.signature.digest_hex != assurance.envelope_digest_hex {
        return Err(EformError::Signature(
            "signature is not bound to the World Cell envelope".to_string(),
        ));
    }
    EformEngine::verify_hash256(&assurance.signature)
}
