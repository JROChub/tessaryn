import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const manifestPath = "sbom/manifest.json";

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function buildManifest() {
  const files = [
    "sbom/rust/tessaryn-anchor.cdx.json",
    "sbom/rust/tessaryn-canonical.cdx.json",
    "sbom/rust/tessaryn-forge.cdx.json",
    "sbom/rust/tessaryn-powerhouse.cdx.json",
    "sbom/rust/tessaryn-privacy.cdx.json",
    "sbom/rust/tessaryn-reconstruct.cdx.json",
    "sbom/rust/tessaryn-schema.cdx.json",
    "sbom/rust/tessaryn-store.cdx.json",
    "sbom/rust/tessaryn-sync.cdx.json",
    "sbom/rust/tessaryn-transport.cdx.json",
    "sbom/rust/tessaryn-weave.cdx.json",
    "sbom/rust/tessaryn-witness.cdx.json",
    "sbom/rust/tessaryn-cli.cdx.json",
    "sbom/viewer-web.cdx.json",
  ];
  return {
    schema: "tessaryn/sbom-manifest/v0",
    generators: {
      rust: "cargo-cyclonedx 0.5.9",
      browser: "@cyclonedx/cyclonedx-npm 6.0.0",
    },
    inputs: {
      "Cargo.lock": await sha256("Cargo.lock"),
      "apps/viewer-web/package-lock.json": await sha256(
        "apps/viewer-web/package-lock.json",
      ),
    },
    files: Object.fromEntries(
      await Promise.all(files.map(async (file) => [file, await sha256(file)])),
    ),
  };
}

if (process.argv.includes("--write")) {
  await writeFile(manifestPath, JSON.stringify(await buildManifest(), null, 2) + "\n", "utf8");
  process.exit(0);
}

const expected = JSON.parse(await readFile(manifestPath, "utf8"));
const actual = await buildManifest();
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  throw new Error("SBOM manifest is stale; regenerate inventories and run with --write");
}

for (const path of Object.keys(actual.files)) {
  const source = await readFile(path, "utf8");
  const document = JSON.parse(source);
  if (document.bomFormat !== "CycloneDX" || document.specVersion !== "1.5") {
    throw new Error(`${path}: expected CycloneDX 1.5`);
  }
  if (document.metadata?.timestamp !== "1970-01-01T00:00:00.000Z") {
    throw new Error(`${path}: timestamp is not normalized`);
  }
  if (/\/(home|Users)\/|[A-Z]:\/Users\//i.test(source)) {
    throw new Error(`${path}: local workstation path leaked into SBOM`);
  }
}

console.log(`SBOM PASS: ${Object.keys(actual.files).length} CycloneDX inventories bound to lockfiles`);
