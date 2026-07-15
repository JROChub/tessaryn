import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../public/keyxym/", import.meta.url);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const expected = {
  source: "700cb523ef9c1fb37733ffd1b1cbe0227be420c3",
  closure: "c910d501234def82e3551ddcc59d2482bfd694c6d9849bd62dce2a6380b614b8",
  toolchain: "3f32b91a3f8d405846ccacee911f9364da75f413fbd11ea1f3f7f23bf9d07cf3",
};

test("Keyxym v0.22 runtime bundle is provenance-bound and browser-loadable", async () => {
  const manifestBytes = await readFile(new URL("manifest.json", root));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  assert.equal(manifest.schema, "keyxym.browser-runtime-provenance/v4");
  assert.equal(manifest.version, "0.22.0");
  assert.equal(manifest.abi, "keyxym-v22-browser-dual-field-4");
  assert.equal(manifest.perception_abi, "keyxym-v22-browser-frontend-cpp-v1");
  assert.equal(manifest.source_repository, "JROChub/keyxym_map");
  assert.equal(manifest.source_commit, expected.source);
  assert.equal(manifest.build_provenance, "independent-audited-semantic-closure");
  assert.equal(manifest.source_exact, false);
  assert.equal(manifest.build_closure_digest, expected.closure);
  assert.equal(manifest.maximum_surfels, 48_000);
  assert.equal(manifest.maximum_analysis_width, 320);
  assert.equal(manifest.maximum_analysis_height, 240);
  assert.equal(manifest.maximum_tracks, 384);
  assert.equal(manifest.maximum_preview_samples, 8_192);
  assert.equal(manifest.timestamp_abi, "wasm-bigint-i64");
  assert.equal(manifest.preview_record_floats, 10);
  assert.equal(manifest.geometry_record_floats, 13);
  assert.equal(manifest.receipt_bytes, 64);

  const closureBytes = await readFile(new URL("build-closure.json", root));
  const moduleBytes = await readFile(new URL("keyxym-v22.mjs", root));
  const wasmBytes = await readFile(new URL("keyxym-v22.wasm", root));
  for (const [name, bytes] of [
    ["build-closure.json", closureBytes],
    ["keyxym-v22.mjs", moduleBytes],
    ["keyxym-v22.wasm", wasmBytes],
  ]) {
    const record = manifest.artifacts[name];
    assert.equal(bytes.byteLength, record.bytes, `${name} byte length`);
    assert.equal(sha256(bytes), record.sha256, `${name} SHA-256`);
  }
  assert.equal(await WebAssembly.validate(wasmBytes), true);

  const closure = JSON.parse(closureBytes.toString("utf8"));
  assert.equal(closure.schema, "keyxym.browser-build-closure/v1");
  assert.equal(closure.source_commit, expected.source);
  assert.equal(closure.source_exact, false);
  assert.equal(closure.closure_digest_sha256, expected.closure);
  assert.equal(closure.toolchain.name, "Emscripten");
  assert.equal(closure.toolchain.release_commit, "9074aa513b501925adb1361e208932ad32a29a5f");
  assert.equal(closure.toolchain.official_package_sha256, expected.toolchain);
  assert.match(closure.derivation, /never represented as a byte-identical checkout/);
  assert.ok(closure.validation.includes(
    "native and WebAssembly pose/quality receipts matched byte-for-byte for a three-frame translated texture vector",
  ));
  assert.ok(closure.validation.includes(
    "native and WebAssembly geometry counts matched at 227 surfels",
  ));

  const moduleText = moduleBytes.toString("utf8");
  for (const symbol of [
    "_keyxym_v22_browser_session_create",
    "_keyxym_v22_browser_session_destroy",
    "_keyxym_v22_browser_ingest_rgba_packed",
    "_keyxym_v22_browser_copy_receipts",
    "_keyxym_v22_browser_copy_preview_packed",
    "_keyxym_v22_browser_geometry_revision",
    "_keyxym_v22_browser_copy_geometry_snapshot_packed",
    "_keyxym_v22_session_quality_packed",
    "_malloc",
    "_free",
  ]) {
    assert.ok(moduleText.includes(symbol), `missing browser ABI symbol ${symbol}`);
  }
});
