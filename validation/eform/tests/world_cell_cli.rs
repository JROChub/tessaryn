use std::fs;
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_FILE: AtomicU64 = AtomicU64::new(0);

fn hex(value: u8) -> String {
    std::iter::repeat_n(format!("{value:02x}"), 32).collect()
}

#[test]
fn signs_relative_world_cell_record_from_cli() {
    let sequence = NEXT_FILE.fetch_add(1, Ordering::Relaxed);
    let seed_path = std::env::temp_dir().join(format!(
        "eform-world-cell-cli-{}-{sequence}.bin",
        std::process::id()
    ));
    fs::write(
        &seed_path,
        eform::decode_hex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")
            .unwrap(),
    )
    .unwrap();

    let output = Command::new(env!("CARGO_BIN_EXE_eform"))
        .args([
            "sign-world-cell",
            seed_path.to_str().unwrap(),
            "world-cell",
            &hex(1),
            &hex(2),
            &hex(3),
            &hex(6),
            "9",
            "relative",
        ])
        .output()
        .unwrap();

    let _ = fs::remove_file(seed_path);
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("profile=eform/world-cell-assurance/v1"));
    assert!(stdout.contains("artifact_kind=world-cell"));
    assert!(stdout.contains("scale=relative"));
    assert!(stdout.contains("domain=eform/ed25519/hash256/v1"));
    assert!(stdout.contains("provider=power_house::net::ed25519"));
    assert!(!stdout.contains("sealed="));
}

#[test]
fn rejects_non_genesis_record_without_parent_from_cli() {
    let output = Command::new(env!("CARGO_BIN_EXE_eform"))
        .args([
            "sign-world-cell",
            "ed25519://test-seed",
            "transfer",
            &hex(1),
            &hex(2),
            &hex(3),
            &hex(0),
            "2",
            "relative",
        ])
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr)
        .contains("non-genesis evidence requires a parent commitment"));
}
