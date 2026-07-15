#![forbid(unsafe_code)]

pub mod world_cell;
pub use world_cell::*;

use power_house::net::{
    decode_public_key_base64, decode_signature_base64, encode_public_key_base64,
    encode_signature_base64, load_or_derive_keypair, sign_payload, verify_signature,
    Ed25519KeySource, KeyMaterial,
};
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const EFORM_VERSION: &str = "0.1.0";
pub const POWER_HOUSE_REVISION: &str = "7f3aa496104cccab0ab813ec7dc6f45d5d55e2f8";
pub const SIGNING_DOMAIN: &str = "eform/ed25519/hash256/v1";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EformError {
    InvalidDigestLength(usize),
    InvalidHex,
    Key(String),
    Signature(String),
    SelfTest(String),
    Policy(String),
    Io(String),
}

impl fmt::Display for EformError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidDigestLength(n) => write!(f, "expected a 32-byte digest, received {n}"),
            Self::InvalidHex => write!(f, "invalid hexadecimal input"),
            Self::Key(e) => write!(f, "key error: {e}"),
            Self::Signature(e) => write!(f, "signature error: {e}"),
            Self::SelfTest(e) => write!(f, "self-test failure: {e}"),
            Self::Policy(e) => write!(f, "activation policy rejected: {e}"),
            Self::Io(e) => write!(f, "I/O error: {e}"),
        }
    }
}

impl std::error::Error for EformError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KeySource {
    SeedPhrase(String),
    File(PathBuf),
}

impl KeySource {
    fn to_power_house(&self) -> Ed25519KeySource {
        match self {
            Self::SeedPhrase(seed) => Ed25519KeySource::Seed(seed.clone()),
            Self::File(path) => Ed25519KeySource::File(path.clone()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EformSignature {
    pub domain: String,
    pub digest_hex: String,
    pub public_key_base64: String,
    pub signature_base64: String,
    pub provider: String,
    pub power_house_revision: String,
}

impl EformSignature {
    pub fn canonical_record(&self) -> String {
        format!(
            "domain={}\ndigest={}\npublic_key={}\nsignature={}\nprovider={}\npower_house_revision={}\n",
            self.domain,
            self.digest_hex,
            self.public_key_base64,
            self.signature_base64,
            self.provider,
            self.power_house_revision
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SelfTestCase {
    pub name: String,
    pub passed: bool,
    pub evidence: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SelfTestReport {
    pub eform_version: String,
    pub power_house_revision: String,
    pub cases: Vec<SelfTestCase>,
}

impl SelfTestReport {
    pub fn passed(&self) -> bool {
        !self.cases.is_empty() && self.cases.iter().all(|case| case.passed)
    }

    pub fn canonical_transcript(&self) -> String {
        let mut out = format!(
            "eform_version={}\npower_house_revision={}\n",
            self.eform_version, self.power_house_revision
        );
        for case in &self.cases {
            out.push_str(&format!(
                "case={} passed={} evidence={}\n",
                case.name, case.passed, case.evidence
            ));
        }
        out
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuditStatus {
    Unreviewed,
    IndependentReview {
        reviewer: String,
        reviewed_commit: String,
        critical_open: u32,
        high_open: u32,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ActivationMode {
    Development,
    Production,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActivationDecision {
    pub approved: bool,
    pub mode: ActivationMode,
    pub reasons: Vec<String>,
}

pub fn evaluate_activation(
    mode: ActivationMode,
    report: &SelfTestReport,
    audit: &AuditStatus,
) -> ActivationDecision {
    let mut reasons = Vec::new();
    if report.power_house_revision != POWER_HOUSE_REVISION {
        reasons.push("Power House revision mismatch".to_string());
    }
    if !report.passed() {
        reasons.push("cryptographic startup tests did not all pass".to_string());
    }
    if mode == ActivationMode::Production {
        match audit {
            AuditStatus::Unreviewed => reasons.push("independent review is required".to_string()),
            AuditStatus::IndependentReview {
                reviewer,
                reviewed_commit,
                critical_open,
                high_open,
            } => {
                if reviewer.trim().is_empty() || reviewed_commit.trim().is_empty() {
                    reasons.push("audit identity is incomplete".to_string());
                }
                if *critical_open != 0 || *high_open != 0 {
                    reasons.push("critical or high audit findings remain open".to_string());
                }
            }
        }
    }
    ActivationDecision {
        approved: reasons.is_empty(),
        mode,
        reasons,
    }
}

pub struct EformEngine {
    keys: KeyMaterial,
}

impl EformEngine {
    pub fn load(source: KeySource) -> Result<Self, EformError> {
        let keys = load_or_derive_keypair(&source.to_power_house())
            .map_err(|e| EformError::Key(e.to_string()))?;
        Ok(Self { keys })
    }

    pub fn public_key_base64(&self) -> String {
        encode_public_key_base64(&self.keys.verifying)
    }

    pub fn sign_hash256(&self, digest: &[u8]) -> Result<EformSignature, EformError> {
        if digest.len() != 32 {
            return Err(EformError::InvalidDigestLength(digest.len()));
        }
        let signature = sign_payload(&self.keys.signing, digest);
        Ok(EformSignature {
            domain: SIGNING_DOMAIN.to_string(),
            digest_hex: encode_hex(digest),
            public_key_base64: encode_public_key_base64(&self.keys.verifying),
            signature_base64: encode_signature_base64(&signature),
            provider: "power_house::net::ed25519".to_string(),
            power_house_revision: POWER_HOUSE_REVISION.to_string(),
        })
    }

    pub fn verify_hash256(record: &EformSignature) -> Result<(), EformError> {
        if record.domain != SIGNING_DOMAIN {
            return Err(EformError::Signature("signing domain mismatch".to_string()));
        }
        if record.power_house_revision != POWER_HOUSE_REVISION {
            return Err(EformError::Signature(
                "Power House revision mismatch".to_string(),
            ));
        }
        let digest = decode_hex(&record.digest_hex)?;
        if digest.len() != 32 {
            return Err(EformError::InvalidDigestLength(digest.len()));
        }
        let public_key = decode_public_key_base64(&record.public_key_base64)
            .map_err(|e| EformError::Signature(e.to_string()))?;
        let signature = decode_signature_base64(&record.signature_base64)
            .map_err(|e| EformError::Signature(e.to_string()))?;
        verify_signature(&public_key, &digest, &signature)
            .map_err(|e| EformError::Signature(e.to_string()))
    }
}

pub fn run_startup_self_tests() -> Result<SelfTestReport, EformError> {
    let mut cases = Vec::new();
    let vector = RfcVector {
        name: "RFC8032-TEST-1-empty-message",
        secret_hex: "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
        public_hex: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
        message_hex: "",
        signature_hex: concat!(
            "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155",
            "5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b"
        ),
    };
    cases.push(run_rfc_vector(&vector)?);

    let temporary = temporary_seed_path();
    let seed = decode_hex(vector.secret_hex)?;
    fs::write(&temporary, &seed).map_err(|e| EformError::Io(e.to_string()))?;
    let keys = load_or_derive_keypair(&Ed25519KeySource::File(temporary.clone()))
        .map_err(|e| EformError::Key(e.to_string()))?;
    let signature = sign_payload(&keys.signing, b"eform-negative-test");
    let mut altered = b"eform-negative-test".to_vec();
    altered[0] ^= 1;
    let rejected = verify_signature(&keys.verifying, &altered, &signature).is_err();
    secure_remove(&temporary);
    cases.push(SelfTestCase {
        name: "message-mutation-rejected".to_string(),
        passed: rejected,
        evidence: "one-bit message mutation".to_string(),
    });

    let report = SelfTestReport {
        eform_version: EFORM_VERSION.to_string(),
        power_house_revision: POWER_HOUSE_REVISION.to_string(),
        cases,
    };
    if !report.passed() {
        return Err(EformError::SelfTest(report.canonical_transcript()));
    }
    Ok(report)
}

struct RfcVector<'a> {
    name: &'a str,
    secret_hex: &'a str,
    public_hex: &'a str,
    message_hex: &'a str,
    signature_hex: &'a str,
}

fn run_rfc_vector(vector: &RfcVector<'_>) -> Result<SelfTestCase, EformError> {
    let secret = decode_hex(vector.secret_hex)?;
    let message = decode_hex(vector.message_hex)?;
    let expected_public = decode_hex(vector.public_hex)?;
    let expected_signature = decode_hex(vector.signature_hex)?;
    let path = temporary_seed_path();
    fs::write(&path, &secret).map_err(|e| EformError::Io(e.to_string()))?;
    let keys = load_or_derive_keypair(&Ed25519KeySource::File(path.clone()))
        .map_err(|e| EformError::Key(e.to_string()))?;
    let signature = sign_payload(&keys.signing, &message);
    let public_matches = keys.verifying.to_bytes().as_slice() == expected_public.as_slice();
    let signature_matches = signature.to_bytes().as_slice() == expected_signature.as_slice();
    let verifies = verify_signature(&keys.verifying, &message, &signature).is_ok();
    secure_remove(&path);
    Ok(SelfTestCase {
        name: vector.name.to_string(),
        passed: public_matches && signature_matches && verifies,
        evidence: format!(
            "public={} signature={} verify={}",
            public_matches, signature_matches, verifies
        ),
    })
}

fn temporary_seed_path() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    std::env::temp_dir().join(format!("eform-seed-{}-{nanos}.bin", std::process::id()))
}

fn secure_remove(path: &Path) {
    if let Ok(metadata) = fs::metadata(path) {
        let zeros = vec![0u8; metadata.len() as usize];
        let _ = fs::write(path, zeros);
    }
    let _ = fs::remove_file(path);
}

pub fn encode_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

pub fn decode_hex(input: &str) -> Result<Vec<u8>, EformError> {
    if !input.len().is_multiple_of(2) {
        return Err(EformError::InvalidHex);
    }
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len() / 2);
    for chunk in bytes.chunks_exact(2) {
        let hi = hex_nibble(chunk[0])?;
        let lo = hex_nibble(chunk[1])?;
        out.push((hi << 4) | lo);
    }
    Ok(out)
}

fn hex_nibble(value: u8) -> Result<u8, EformError> {
    match value {
        b'0'..=b'9' => Ok(value - b'0'),
        b'a'..=b'f' => Ok(value - b'a' + 10),
        b'A'..=b'F' => Ok(value - b'A' + 10),
        _ => Err(EformError::InvalidHex),
    }
}
