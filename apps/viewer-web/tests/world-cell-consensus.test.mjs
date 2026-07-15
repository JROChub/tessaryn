import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("World Cell Theater has one provenance-gated controller", async () => {
  const html = await read("world-cell-theater.html");
  assert.match(html, /src="\/src\/world-cell-authority-entry\.ts"/);
  assert.doesNotMatch(html, /src="\/src\/world-cell-theater\.ts"/);
  assert.match(html, /id="start-button"[^>]*disabled/);
  assert.match(html, /VERIFYING KEYXYM AUTHORITY/);
  assert.match(html, /EFORM REQUIRED/);
});

test("browser runtime consumes compiled RGBA authority and native receipts", async () => {
  const source = await read("src/keyxym-v22-runtime.ts");
  for (const symbol of [
    "_keyxym_v22_browser_session_create",
    "_keyxym_v22_browser_ingest_rgba_packed",
    "_keyxym_v22_browser_copy_receipts",
    "_keyxym_v22_browser_copy_preview_packed",
    "_keyxym_v22_browser_geometry_revision",
    "_keyxym_v22_browser_copy_geometry_snapshot_packed",
  ]) assert.match(source, new RegExp(symbol));
  assert.match(source, /rgba: Uint8Array/);
  assert.match(source, /pose: bytes\.slice\(0, 32\)/);
  assert.match(source, /quality: bytes\.slice\(32, 64\)/);
  assert.doesNotMatch(source, /KeyxymFeature/);
});

test("Theater contains no browser pose solver or invented luminance depth", async () => {
  const source = await read("src/world-cell-theater.ts");
  assert.match(source, /this\.runtime\.ingest\(/);
  assert.match(source, /this\.runtime\.formingField\(\)/);
  assert.match(source, /this\.runtime\.geometrySnapshot\(/);
  assert.match(source, /this\.runtime\.receipts\(\)/);
  assert.match(source, /confirmedGeometry/);
  assert.doesNotMatch(source, /0\.75\s*\+\s*\(1\s*-\s*luminance\)/);
  assert.doesNotMatch(source, /detectFeatures|patchError|matchFeatures|frameNumber\s*\/\s*/);
  assert.doesNotMatch(source, /world-cell-theater\.ts.*world-cell-authority-entry\.ts/s);
});

test("forming field is excluded from Moments and assurance is mandatory", async () => {
  const source = await read("src/world-cell-theater.ts");
  assert.match(source, /geometry: packedSurfels\(geometry\)/);
  assert.match(source, /const geometry = confirmedGeometry\(this\.geometrySnapshot\.surfels\)/);
  assert.doesNotMatch(source, /geometry:.*formingSamples/);
  assert.match(source, /nativeAssuranceBridge\(\)/);
  assert.match(source, /A verified native eform and Power House bridge is required/);
  assert.match(source, /Only an eform and Power House sealed World Cell can be sent/);
  assert.match(source, /Incoming World Cell requires native eform and Power House verification/);
});

test("assurance evidence binds native Keyxym receipt pair and runtime provenance", async () => {
  const source = await read("src/world-cell-assurance.ts");
  assert.match(source, /tessaryn\/keyxym-receipt-pair\/v1/);
  assert.match(source, /receipts\.pose\.byteLength !== 32/);
  assert.match(source, /receipts\.quality\.byteLength !== 32/);
  assert.match(source, /profile: "eform\/world-cell-assurance\/v1"/);
  assert.match(source, /runtimeCommitment/);
  assert.match(source, /parentCommitment/);
  assert.match(source, /phaFingerprint/);
  assert.match(source, /memoryCapsuleDigest/);
  assert.match(source, /replayFingerprint/);
});

test("provenance contract pins the merged source-exact authority", async () => {
  const source = await read("src/keyxym-v22-provenance.ts");
  assert.match(source, /keyxym\.browser-runtime-provenance\/v4/);
  assert.match(source, /keyxym-v22-browser-dual-field-4/);
  assert.match(source, /keyxym-v22-unified-cpp-frontend-v1/);
  assert.match(source, /source_exact: true/);
  assert.match(source, /source-exact-external-validation-build/);
  assert.match(source, /5187ff10dfb63d4abbfee51ab894451efe428490/);
  assert.match(source, /APPROVED_TOOLCHAIN_RELEASE/);
  assert.match(source, /APPROVED_TOOLCHAIN_PACKAGE/);
  assert.match(source, /APPROVED_VALIDATION_RUN = 29412516894/);
  assert.match(source, /manifest\.validation\.gcc !== true/);
  assert.match(source, /manifest\.validation\.asan_ubsan !== true/);
  assert.match(source, /manifest\.validation\.msvc !== true/);
  assert.match(source, /manifest\.validation\.mobile_sdk !== true/);
  assert.match(source, /manifest\.validation\.wasm_runtime !== true/);
  assert.match(source, /receipt_bytes: 64/);
  assert.match(source, /await WebAssembly\.compile\(wasmBytes\)/);
  assert.doesNotMatch(source, /build-closure\.json/);
  assert.doesNotMatch(source, /independent-audited-semantic-closure/);
  assert.doesNotMatch(source, /source_exact: false/);
  assert.doesNotMatch(source, /keyxym-standalone-frontend-v1/);
  assert.doesNotMatch(source, /keyxym-frontend-v1\.wasm/);
});

test("browser assurance is provenance-bound and entropy-limited", async () => {
  const source = await read("src/browser-assurance-runtime.ts");
  assert.match(source, /tessaryn\.browser-assurance-provenance\/v1/);
  assert.match(source, /eform\/world-cell-assurance\/v1/);
  assert.match(source, /tessaryn-browser-assurance::ed25519-dalek\/2\.2\.0/);
  assert.match(source, /imports\.length !== 1/);
  assert.match(source, /imports\[0\]\?\.module !== "tessaryn"/);
  assert.match(source, /imports\[0\]\?\.name !== "random_fill"/);
  assert.match(source, /crypto\.getRandomValues/);
  assert.match(source, /crypto\.subtle\.digest\("SHA-256"/);
});

test("scale request cannot impersonate verified metric calibration", async () => {
  const html = await read("world-cell-theater.html");
  const source = await read("src/world-cell-theater.ts");
  assert.match(html, /Recording a known length does not itself establish metric scale/);
  assert.match(source, /this\.requestedReferenceMeters = value/);
  assert.match(source, /this\.metricCalibration\?\.verified === true/);
  assert.match(source, /metricScale: calibration !== null/);
  assert.doesNotMatch(source, /metricScale:\s*this\.requestedReferenceMeters/);
});
