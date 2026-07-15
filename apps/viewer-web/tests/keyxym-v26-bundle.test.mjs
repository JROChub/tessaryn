import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../public/keyxym-v26/", import.meta.url);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("Keyxym v0.26 reality runtime is source-exact and browser-loadable", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
  assert.equal(manifest.schema, "keyxym.browser-runtime-provenance/v6");
  assert.equal(manifest.version, "0.26.0");
  assert.equal(manifest.abi, "keyxym-v26-reality-authority-1");
  assert.equal(manifest.perception_abi, "keyxym-v26-calibrated-cpp-frontend-v1");
  assert.equal(manifest.source_repository, "JROChub/keyxym_map");
  assert.equal(manifest.source_commit, "c94d4db57d1db89e96cb7fd860da2d4c1617f516");
  assert.equal(manifest.source_exact, true);
  assert.equal(manifest.pose_floats, 27);
  assert.equal(manifest.quality_floats, 8);
  assert.equal(manifest.authority_floats, 8);
  assert.equal(manifest.preview_record_floats, 10);
  assert.equal(manifest.geometry_record_floats, 13);
  assert.equal(manifest.receipt_bytes, 96);
  assert.equal(manifest.validation.exact_blob_matrix_run, 29439226477);
  for (const lane of ["gcc", "asan_ubsan", "msvc", "mobile_sdk", "wasm_runtime"]) {
    assert.equal(manifest.validation[lane], true, `${lane} validation`);
  }
  assert.equal(manifest.toolchain.version, "6.0.3");
  assert.equal(manifest.toolchain.release_commit, "9074aa513b501925adb1361e208932ad32a29a5f");
  assert.equal(manifest.toolchain.official_package_sha256, "3f32b91a3f8d405846ccacee911f9364da75f413fbd11ea1f3f7f23bf9d07cf3");
  assert.deepEqual(Object.keys(manifest.artifacts).sort(), ["keyxym-v26.mjs", "keyxym-v26.wasm"]);

  const moduleBytes = await readFile(new URL("keyxym-v26.mjs", root));
  const wasmBytes = await readFile(new URL("keyxym-v26.wasm", root));
  assert.equal(moduleBytes.byteLength, 9_253);
  assert.equal(sha256(moduleBytes), "0d9f9921b01546051eacf7d0cf79f9b70e8b206dc455b833437fd992a737c7e5");
  assert.equal(wasmBytes.byteLength, 65_095);
  assert.equal(sha256(wasmBytes), "89c66a4c8465ef8db10b6c40d4fdd3dc7d9c662d728cbd80d824a2ef27ea7d0e");
  assert.equal(await WebAssembly.validate(wasmBytes), true);

  const moduleText = moduleBytes.toString("utf8");
  for (const symbol of [
    "_keyxym_v26_session_create",
    "_keyxym_v26_session_destroy",
    "_keyxym_v26_ingest_rgba_packed",
    "_keyxym_v26_copy_receipts",
    "_keyxym_v26_copy_preview_packed",
    "_keyxym_v26_geometry_revision",
    "_keyxym_v26_copy_geometry_snapshot_packed",
    "_keyxym_v26_quality_packed",
    "_keyxym_v26_authority_packed",
    "_malloc",
    "_free",
  ]) assert.ok(moduleText.includes(symbol), `missing v0.26 symbol ${symbol}`);
});
