import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../public/keyxym/", import.meta.url);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const expected = {
  source: "5187ff10dfb63d4abbfee51ab894451efe428490",
  toolchainRelease: "9074aa513b501925adb1361e208932ad32a29a5f",
  toolchainPackage: "3f32b91a3f8d405846ccacee911f9364da75f413fbd11ea1f3f7f23bf9d07cf3",
  validationRun: 29412516894,
};

test("Keyxym v0.22 runtime bundle is source-exact and browser-loadable", async () => {
  const manifestBytes = await readFile(new URL("manifest.json", root));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  assert.equal(manifest.schema, "keyxym.browser-runtime-provenance/v4");
  assert.equal(manifest.version, "0.22.0");
  assert.equal(manifest.abi, "keyxym-v22-browser-dual-field-4");
  assert.equal(manifest.perception_abi, "keyxym-v22-unified-cpp-frontend-v1");
  assert.equal(manifest.source_repository, "JROChub/keyxym_map");
  assert.equal(manifest.source_commit, expected.source);
  assert.equal(manifest.source_exact, true);
  assert.equal(manifest.derivation, "source-exact-external-validation-build");
  assert.equal(manifest.maximum_surfels, 48_000);
  assert.equal(manifest.maximum_analysis_width, 320);
  assert.equal(manifest.maximum_analysis_height, 240);
  assert.equal(manifest.maximum_tracks, 384);
  assert.equal(manifest.maximum_preview_samples, 8_192);
  assert.equal(manifest.timestamp_abi, "wasm-bigint-i64");
  assert.equal(manifest.feature_record_floats, 6);
  assert.equal(manifest.preview_record_floats, 10);
  assert.equal(manifest.geometry_record_floats, 13);
  assert.equal(manifest.receipt_bytes, 64);
  assert.deepEqual(manifest.toolchain, {
    name: "Emscripten",
    version: "6.0.3",
    release_commit: expected.toolchainRelease,
    official_package_sha256: expected.toolchainPackage,
  });
  assert.deepEqual(manifest.validation, {
    exact_blob_matrix_run: expected.validationRun,
    gcc: true,
    asan_ubsan: true,
    msvc: true,
    mobile_sdk: true,
    wasm_runtime: true,
  });
  assert.deepEqual(Object.keys(manifest.artifacts).sort(), [
    "keyxym-v22.mjs",
    "keyxym-v22.wasm",
  ]);

  const moduleBytes = await readFile(new URL("keyxym-v22.mjs", root));
  const wasmBytes = await readFile(new URL("keyxym-v22.wasm", root));
  for (const [name, bytes] of [
    ["keyxym-v22.mjs", moduleBytes],
    ["keyxym-v22.wasm", wasmBytes],
  ]) {
    const record = manifest.artifacts[name];
    assert.equal(bytes.byteLength, record.bytes, `${name} byte length`);
    assert.equal(sha256(bytes), record.sha256, `${name} SHA-256`);
  }
  assert.equal(await WebAssembly.validate(wasmBytes), true);

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
