import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("World Cell Theater has one v0.26 provenance-gated controller", async () => {
  const [html, entry] = await Promise.all([
    read("world-cell-theater.html"),
    read("src/world-cell-authority-entry.ts"),
  ]);
  assert.match(html, /src="\.\/src\/world-cell-authority-entry\.ts"/);
  assert.match(html, /id="start-button"[^>]*disabled/);
  assert.match(html, /tessarynWorldCellBootFailure/);
  assert.match(entry, /verifyKeyxymV26Bundle/);
  assert.match(entry, /world-cell-theater-v26/);
  assert.doesNotMatch(entry, /verifyKeyxymV22Bundle/);
});

test("v0.26 runtime executes RGBA authority inside a bounded worker", async () => {
  const [runtime, worker, client] = await Promise.all([
    read("src/keyxym-v26-runtime.ts"),
    read("src/keyxym-v26-worker.ts"),
    read("src/keyxym-v26-client.ts"),
  ]);
  for (const symbol of [
    "_keyxym_v26_session_create",
    "_keyxym_v26_ingest_rgba_packed",
    "_keyxym_v26_copy_receipts",
    "_keyxym_v26_copy_preview_packed",
    "_keyxym_v26_geometry_revision",
    "_keyxym_v26_copy_geometry_snapshot_packed",
    "_keyxym_v26_quality_packed",
    "_keyxym_v26_authority_packed",
  ]) assert.match(runtime, new RegExp(symbol));
  assert.match(worker, /OffscreenCanvas/);
  assert.match(worker, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(worker, /request\.bitmap\.close\(\)/);
  assert.match(client, /this\.pending/);
  assert.match(client, /Keyxym worker frame already in flight/);
  assert.doesNotMatch(worker, /detectFeatures|essentialMatrix|triangulate/);
});

test("Theater consumes native authority decisions and contains no pose solver", async () => {
  const source = await read("src/world-cell-theater-v26.ts");
  assert.match(source, /KeyxymV26TheaterRuntime/);
  assert.match(source, /createImageBitmap\(this\.video\)/);
  assert.match(source, /this\.runtime\.ingest\(/);
  assert.match(source, /this\.authority\?\.momentAllowed/);
  assert.match(source, /this\.authority\?\.sealAllowed/);
  assert.match(source, /latest\.authority\.sealAllowed/);
  assert.match(source, /latest\.geometryRevision !== this\.geometrySnapshot\.revision/);
  assert.doesNotMatch(source, /getImageData|sha256\(rgba\)|detectFeatures|matchFeatures|recover_metric_pose/);
  assert.doesNotMatch(source, /tracking\s*>=\s*0\.2|parallaxDegrees\s*>=\s*0\.3|confirmed\.length\s*>=\s*4/);
});

test("forming observations cannot enter Moments or seals", async () => {
  const source = await read("src/world-cell-theater-v26.ts");
  assert.match(source, /const geometry = confirmedGeometry\(this\.geometrySnapshot\.surfels\)/);
  assert.match(source, /geometry: packedSurfels\(geometry\)/);
  assert.doesNotMatch(source, /geometry:.*formingSamples/);
  assert.match(source, /moment\.authority\.momentAllowed/);
  assert.match(source, /latest\.authority\.sealAllowed/);
  assert.match(source, /tessaryn\/world-cell-moment\/v26/);
  assert.match(source, /tessaryn\/world-cell\/v26/);
});

test("assurance binds the native pose, quality, and authority receipt triple", async () => {
  const source = await read("src/world-cell-assurance.ts");
  assert.match(source, /tessaryn\/keyxym-receipt-triple\/v1/);
  assert.match(source, /receipts\.pose\.byteLength !== 32/);
  assert.match(source, /receipts\.quality\.byteLength !== 32/);
  assert.match(source, /receipts\.authority\.byteLength !== 32/);
  assert.match(source, /domain\.byteLength \+ 96/);
  assert.match(source, /profile: "eform\/world-cell-assurance\/v1"/);
  assert.match(source, /runtimeCommitment/);
  assert.match(source, /parentCommitment/);
});

test("v0.26 provenance pins the complete source-exact authority", async () => {
  const source = await read("src/keyxym-v26-provenance.ts");
  assert.match(source, /keyxym\.browser-runtime-provenance\/v9/);
  assert.match(source, /keyxym-v26-reality-authority-1/);
  assert.match(source, /keyxym-v26-dense-photometric-surface-v1/);
  assert.match(source, /2672ebe79655b3d78912b9332e24057b35772008/);
  assert.match(source, /source_exact !== true/);
  assert.match(source, /pose_floats !== 27/);
  assert.match(source, /authority_floats !== 8/);
  assert.match(source, /receipt_bytes !== 96/);
  assert.match(source, /reproducible_builds !== 2/);
  assert.match(source, /middlebury_maximum_confirmed_surfels !== 909/);
  assert.match(source, /middlebury_terminal_surfels !== 2341/);
  assert.match(source, /middlebury_seal_ready_frames !== 1/);
  assert.match(source, /await WebAssembly\.compile\(wasmBytes\)/);
});

test("browser assurance remains provenance-bound and entropy-limited", async () => {
  const source = await read("src/browser-assurance-runtime.ts");
  assert.match(source, /tessaryn\.browser-assurance-provenance\/v1/);
  assert.match(source, /eform\/world-cell-assurance\/v1/);
  assert.match(source, /imports\.length !== 1/);
  assert.match(source, /imports\[0\]\?\.module !== "tessaryn"/);
  assert.match(source, /imports\[0\]\?\.name !== "random_fill"/);
  assert.match(source, /crypto\.getRandomValues/);
});

test("scale request cannot impersonate verified metric calibration", async () => {
  const [html, source] = await Promise.all([
    read("world-cell-theater.html"),
    read("src/world-cell-theater-v26.ts"),
  ]);
  assert.match(html, /Recording a known length does not itself establish metric scale/);
  assert.match(source, /this\.requestedReferenceMeters = value/);
  assert.match(source, /this\.metricCalibration\?\.verified === true/);
  assert.doesNotMatch(source, /metricScale:\s*this\.requestedReferenceMeters/);
});
