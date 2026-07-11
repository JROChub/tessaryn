use std::env;
use std::fs;
use std::path::PathBuf;
use tessaryn_cli::{generate_demo_world, verify_demo_world, DemoWorld};

fn main() {
    if let Err(error) = run() {
        eprintln!("tessaryn: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut arguments = env::args().skip(1);
    match arguments.next().as_deref() {
        Some("generate-demo") => {
            let output = arguments
                .next()
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("apps/viewer-web/public/world/vesper-court.json"));
            let world = generate_demo_world()?;
            let bytes = serde_json::to_vec_pretty(&world)?;
            if let Some(parent) = output.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(&output, bytes)?;
            let report = verify_demo_world(&world)?;
            println!(
                "generated {} Cells / {} Moments / {} disputes -> {}",
                report.cells_valid,
                report.moments,
                report.disputed_cells,
                output.display()
            );
        }
        Some("verify-demo") => {
            let input = arguments
                .next()
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("apps/viewer-web/public/world/vesper-court.json"));
            let world: DemoWorld = serde_json::from_slice(&fs::read(&input)?)?;
            let report = verify_demo_world(&world)?;
            println!("{}", serde_json::to_string_pretty(&report)?);
        }
        Some("challenge-demo") => {
            let input = arguments
                .next()
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("apps/viewer-web/public/world/vesper-court.json"));
            let world: DemoWorld = serde_json::from_slice(&fs::read(&input)?)?;
            verify_demo_world(&world)?;
            let report = world
                .origin_memory_capsule
                .challenge_all(power_house::MemoryVerificationPolicy::strict())?;
            if report.mismatches != 0 || report.expected_rejections != report.total {
                return Err("Memory Capsule challenge mismatch".into());
            }
            println!("{}", serde_json::to_string_pretty(&report)?);
        }
        _ => {
            println!("TESSARYN experimental tooling");
            println!("  tessaryn generate-demo [output.json]");
            println!("  tessaryn verify-demo [input.json]");
            println!("  tessaryn challenge-demo [input.json]");
        }
    }
    Ok(())
}
