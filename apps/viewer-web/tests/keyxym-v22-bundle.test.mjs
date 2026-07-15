import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../public/keyxym/", import.meta.url);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("Keyxym v0.22 runtime bundle is provenance-bound and browser-loadable", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
  assert.equal(manifest.schema, "tessaryn.keyxym-wasm-provenance/v1");
  assert.equal(manifest.version, "0.22.0");
  assert.equal(manifest.abi, "keyxym-v22-packed-1");
  assert.equal(manifest.source_repository, "JROChub/keyxym_map");
  assert.equal(manifest.source_commit, "3076c306126058c6e9b24d851681ae79a26b9b55");
  assert.equal(manifest.maximum_surfels, 48_000);
  assert.equal(manifest.wasm_bigint, false);
  assert.equal(manifest.timestamp_abi, "legalized-i64-low-high");

  const moduleBytes = await readFile(new URL("keyxym-v22.mjs", root));
  const wasmBytes = await readFile(new URL("keyxym-v22.wasm", root));
  const moduleRecord = manifest.artifacts["keyxym-v22.mjs"];
  const wasmRecord = manifest.artifacts["keyxym-v22.wasm"];
  assert.equal(moduleBytes.byteLength, moduleRecord.bytes);
  assert.equal(wasmBytes.byteLength, wasmRecord.bytes);
  assert.equal(sha256(moduleBytes), moduleRecord.sha256);
  assert.equal(sha256(wasmBytes), wasmRecord.sha256);
  assert.equal(await WebAssembly.validate(wasmBytes), true);

  const moduleText = moduleBytes.toString("utf8");
  for (const symbol of [
    "_keyxym_v22_session_create",
    "_keyxym_v22_session_destroy",
    "_keyxym_v22_session_ingest_packed",
    "_keyxym_v22_session_copy_geometry_packed",
    "_keyxym_v22_session_quality_packed",
    "_malloc",
    "_free",
  ]) {
    assert.ok(moduleText.includes(symbol), `missing browser ABI symbol ${symbol}`);
  }
});
