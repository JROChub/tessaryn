import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../public/keyxym-v26/", import.meta.url);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("Keyxym v0.26 reality runtime is source-exact and browser-loadable", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
  assert.equal(manifest.schema, "keyxym.browser-runtime-provenance/v11");
  assert.equal(manifest.version, "0.26.1");
  assert.equal(manifest.abi, "keyxym-v26-reality-authority-spatial-surface-3");
  assert.equal(manifest.perception_abi, "keyxym-v26-calibrated-spatial-triangle-surface-v3");
  assert.equal(manifest.source_repository, "JROChub/keyxym_map");
  assert.equal(manifest.source_commit, "5758375618325d215ce9ed6ad96872f36179e188");
  assert.equal(manifest.source_exact, true);
  assert.equal(manifest.pose_floats, 27);
  assert.equal(manifest.quality_floats, 8);
  assert.equal(manifest.authority_floats, 8);
  assert.equal(manifest.preview_record_floats, 10);
  assert.equal(manifest.geometry_record_floats, 13);
  assert.equal(manifest.surface_vertex_record_floats, 11);
  assert.equal(manifest.maximum_surface_vertices, 288_000);
  assert.equal(manifest.receipt_bytes, 96);
  assert.equal(manifest.maximum_tracks, 768);
  assert.equal(manifest.validation.profile, "prxf/calibrated-spatial-continuum-qualification/v5");
  assert.equal(manifest.validation.reproducible_builds, 2);
  assert.equal(manifest.validation.artifacts_identical, true);
  assert.equal(manifest.validation.native_tests, 26);
  assert.equal(manifest.validation.sanitizer_tests, 26);
  assert.equal(manifest.validation.sanitizer_compilers, 1);
  assert.equal(manifest.validation.mobile_sdk_tests, 25);
  assert.equal(manifest.validation.wasm_runtime, true);
  assert.equal(manifest.validation.metric_spatial_ingest, true);
  assert.equal(manifest.validation.scale_only_metric_rejected, true);
  assert.equal(manifest.validation.middlebury_temple_ring_sha256, "5f871fe96d25f510eac026c66c3a4c38229326260986e9926cba8a64e88c8359");
  assert.equal(manifest.validation.middlebury_recovered_frames, 10);
  assert.equal(manifest.validation.middlebury_maximum_surfels, 4_790);
  assert.equal(manifest.validation.middlebury_terminal_surfels, 4_790);
  assert.equal(manifest.validation.middlebury_maximum_surface_vertices, 3_174);
  assert.equal(manifest.validation.middlebury_terminal_surface_vertices, 1_977);
  assert.equal(manifest.validation.middlebury_maximum_revision, 9);
  assert.equal(manifest.validation.middlebury_maximum_confirmed_surfels, 2_093);
  assert.ok(manifest.validation.middlebury_maximum_parallax_degrees >= 7.45);
  assert.equal(manifest.validation.middlebury_moment_ready_frames, 2);
  assert.equal(manifest.validation.middlebury_seal_ready_frames, 1);
  assert.equal(manifest.validation.duplicate_geometry_suppressed, true);
  assert.equal(manifest.toolchain.version, "6.0.3");
  assert.equal(manifest.toolchain.release_commit, "9074aa513b501925adb1361e208932ad32a29a5f");
  assert.equal(manifest.toolchain.official_package_sha256, "3f32b91a3f8d405846ccacee911f9364da75f413fbd11ea1f3f7f23bf9d07cf3");
  assert.deepEqual(Object.keys(manifest.artifacts).sort(), ["keyxym-v26.mjs", "keyxym-v26.wasm"]);

  const moduleBytes = await readFile(new URL("keyxym-v26.mjs", root));
  const wasmBytes = await readFile(new URL("keyxym-v26.wasm", root));
  assert.equal(moduleBytes.byteLength, 8_661);
  assert.equal(sha256(moduleBytes), "ec3e38fedfd7885d430f2fd3cfab08ec1af5cdeeadd840faca057394ed7a8942");
  assert.equal(wasmBytes.byteLength, 111_034);
  assert.equal(sha256(wasmBytes), "48a9de27f8a212fabc2f4f72108109dad0fe166f1e81eef806da282f42aa6a85");
  assert.equal(await WebAssembly.validate(wasmBytes), true);

  const moduleText = moduleBytes.toString("utf8");
  for (const symbol of [
    "_keyxym_v26_session_create",
    "_keyxym_v26_session_destroy",
    "_keyxym_v26_ingest_rgba_packed",
    "_keyxym_v26_copy_receipts",
    "_keyxym_v26_copy_preview_packed",
    "_keyxym_v26_geometry_revision",
    "_keyxym_v26_ingest_spatial_rgba_packed",
    "_keyxym_v26_copy_geometry_snapshot_packed",
    "_keyxym_v26_copy_surface_snapshot_packed",
    "_keyxym_v26_quality_packed",
    "_keyxym_v26_authority_packed",
    "_malloc",
    "_free",
  ]) assert.ok(moduleText.includes(symbol), `missing v0.26 symbol ${symbol}`);
});
