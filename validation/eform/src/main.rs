use eform::{
    evaluate_activation, run_startup_self_tests, ActivationMode, AuditStatus, EformEngine,
    EformSignature, KeySource, WorldCellArtifactKind, WorldCellEvidence, POWER_HOUSE_REVISION,
    SIGNING_DOMAIN,
};
use std::path::PathBuf;

fn main() {
    match run(std::env::args().skip(1).collect()) {
        Ok(output) => {
            if !output.is_empty() {
                println!("{output}");
            }
        }
        Err(error) => {
            eprintln!("eform: {error}");
            std::process::exit(1);
        }
    }
}

fn run(args: Vec<String>) -> Result<String, Box<dyn std::error::Error>> {
    match args.as_slice() {
        [] => Ok(help()),
        [command] if command == "help" => Ok(help()),
        [command] if command == "self-test" => {
            let report = run_startup_self_tests()?;
            Ok(report.canonical_transcript())
        }
        [command, key_spec, digest_hex] if command == "sign" => {
            let engine = EformEngine::load(parse_key_source(key_spec))?;
            let digest = eform::decode_hex(digest_hex)?;
            Ok(engine.sign_hash256(&digest)?.canonical_record())
        }
        [
            command,
            key_spec,
            artifact_kind,
            canonical_digest,
            reconstruction_receipt,
            runtime_commitment,
            parent_commitment,
            sequence,
            scale,
        ] if command == "sign-world-cell" => {
            let evidence = WorldCellEvidence {
                artifact_kind: parse_artifact_kind(artifact_kind)?,
                canonical_digest: parse_digest32(canonical_digest)?,
                reconstruction_receipt: parse_digest32(reconstruction_receipt)?,
                runtime_commitment: parse_digest32(runtime_commitment)?,
                parent_commitment: parse_digest32(parent_commitment)?,
                sequence: sequence.parse()?,
                metric_scale: parse_scale(scale)?,
            };
            let engine = EformEngine::load(parse_key_source(key_spec))?;
            Ok(engine.sign_world_cell_evidence(evidence)?.canonical_record())
        }
        [command, digest_hex, public_key, signature] if command == "verify" => {
            let record = EformSignature {
                domain: SIGNING_DOMAIN.to_string(),
                digest_hex: digest_hex.clone(),
                public_key_base64: public_key.clone(),
                signature_base64: signature.clone(),
                provider: "power_house::net::ed25519".to_string(),
                power_house_revision: POWER_HOUSE_REVISION.to_string(),
            };
            EformEngine::verify_hash256(&record)?;
            Ok("verified".to_string())
        }
        [command] if command == "activation-report" => {
            let report = run_startup_self_tests()?;
            let decision = evaluate_activation(
                ActivationMode::Production,
                &report,
                &AuditStatus::Unreviewed,
            );
            Ok(format!(
                "approved={} mode=production reasons={}",
                decision.approved,
                decision.reasons.join(";")
            ))
        }
        _ => Err("invalid arguments; run `eform help`".into()),
    }
}

fn parse_key_source(spec: &str) -> KeySource {
    if let Some(seed) = spec.strip_prefix("ed25519://") {
        KeySource::SeedPhrase(seed.to_string())
    } else {
        KeySource::File(PathBuf::from(spec))
    }
}

fn parse_digest32(value: &str) -> Result<[u8; 32], Box<dyn std::error::Error>> {
    let bytes = eform::decode_hex(value)?;
    let length = bytes.len();
    bytes
        .try_into()
        .map_err(|_| format!("expected a 32-byte digest, received {length}").into())
}

fn parse_artifact_kind(value: &str) -> Result<WorldCellArtifactKind, Box<dyn std::error::Error>> {
    match value {
        "reconstruction-receipt" => Ok(WorldCellArtifactKind::ReconstructionReceipt),
        "moment" => Ok(WorldCellArtifactKind::Moment),
        "transfer" => Ok(WorldCellArtifactKind::Transfer),
        "world-cell" => Ok(WorldCellArtifactKind::WorldCell),
        _ => Err(format!("unsupported World Cell artifact kind: {value}").into()),
    }
}

fn parse_scale(value: &str) -> Result<bool, Box<dyn std::error::Error>> {
    match value {
        "metric" => Ok(true),
        "relative" => Ok(false),
        _ => Err("scale must be `metric` or `relative`".into()),
    }
}

fn help() -> String {
    [
        "eform commands:",
        "  eform self-test",
        "  eform sign <key-file|ed25519://seed> <32-byte-digest-hex>",
        concat!(
            "  eform sign-world-cell <key-file|ed25519://seed> ",
            "<reconstruction-receipt|moment|transfer|world-cell> ",
            "<canonical-digest> <reconstruction-receipt> <runtime-commitment> ",
            "<parent-commitment> <sequence> <relative|metric>"
        ),
        "  eform verify <digest-hex> <public-key-base64> <signature-base64>",
        "  eform activation-report",
    ]
    .join("\n")
}
