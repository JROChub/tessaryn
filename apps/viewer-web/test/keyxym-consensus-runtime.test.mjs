import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const publicKeyxym = path.join(root, "public", "keyxym");

function syntheticFrame(width, height, shift) {
  const output = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const shifted = x - shift;
      const checker = (Math.floor(shifted / 5) ^ Math.floor(y / 5)) & 1;
      const detail = ((shifted * shifted + y * y + shifted * y) % 53 + 53) % 53;
      const value = checker ? 190 + detail % 50 : 25 + detail;
      const offset = (y * width + x) * 4;
      output[offset] = value;
      output[offset + 1] = Math.floor(value * 3 / 4);
      output[offset + 2] = 255 - Math.floor(value / 2);
      output[offset + 3] = 255;
    }
  }
  return output;
}

function ingest(exports, rgba, width, height) {
  new Uint8Array(exports.memory.buffer, exports.keyxym_frontend_rgba_ptr(), rgba.length).set(rgba);
  assert.equal(exports.keyxym_frontend_ingest(width, height, rgba.length), 0);
  const featureCount = exports.keyxym_frontend_feature_count();
  const features = new Float32Array(
    exports.memory.buffer,
    exports.keyxym_frontend_features_ptr(),
    featureCount * 6,
  ).slice();
  const previewCount = exports.keyxym_frontend_preview_count();
  const preview = new Float32Array(
    exports.memory.buffer,
    exports.keyxym_frontend_preview_ptr(),
    previewCount * 10,
  ).slice();
  return { featureCount, features, previewCount, preview };
}

test("provenance-bound Keyxym perception WASM retains tracks and emits forming samples", async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(publicKeyxym, "frontend-manifest.json"), "utf8"));
  const encoded = fs.readFileSync(path.join(publicKeyxym, manifest.artifact), "utf8").replace(/\s+/g, "");
  const bytes = Buffer.from(encoded, "base64");
  assert.equal(bytes.length, manifest.decoded_bytes);
  assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), manifest.decoded_sha256);
  assert.equal(manifest.source_repository, "JROChub/keyxym_map");
  assert.match(manifest.source_commit, /^[0-9a-f]{40}$/);
  assert.equal(manifest.feature_record_floats, 6);
  assert.equal(manifest.preview_record_floats, 10);

  const { instance } = await WebAssembly.instantiate(bytes, {});
  const exports = instance.exports;
  for (const name of [
    "memory",
    "keyxym_frontend_reset",
    "keyxym_frontend_rgba_ptr",
    "keyxym_frontend_rgba_capacity",
    "keyxym_frontend_ingest",
    "keyxym_frontend_feature_count",
    "keyxym_frontend_features_ptr",
    "keyxym_frontend_preview_count",
    "keyxym_frontend_preview_ptr",
    "keyxym_frontend_sequence",
  ]) assert.ok(name in exports, `missing ${name}`);

  const width = 160;
  const height = 120;
  const first = ingest(exports, syntheticFrame(width, height, 0), width, height);
  const second = ingest(exports, syntheticFrame(width, height, 6), width, height);
  const firstIds = new Set(Array.from({ length: first.featureCount }, (_, index) => first.features[index * 6]));
  let persistent = 0;
  let matched = 0;
  for (let index = 0; index < second.featureCount; index += 1) {
    if (firstIds.has(second.features[index * 6])) persistent += 1;
    if (second.features[index * 6 + 4] > 0) matched += 1;
  }
  const supported = Array.from(
    { length: second.previewCount },
    (_, index) => second.preview[index * 10 + 8],
  ).filter((value) => value > 0).length;
  assert.ok(first.featureCount >= 30);
  assert.ok(persistent >= 12);
  assert.ok(matched >= 12);
  assert.ok(second.previewCount >= 1000 && second.previewCount <= 8192);
  assert.ok(supported >= 20);
});

test("World Cell Theater has one controller and no luminance pseudo-depth", () => {
  const html = fs.readFileSync(path.join(root, "world-cell-theater.html"), "utf8");
  const source = fs.readFileSync(path.join(root, "src", "world-cell-theater.ts"), "utf8");
  assert.equal((html.match(/src="\/src\/world-cell-theater\.ts"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /world-cell-authority-entry/);
  assert.doesNotMatch(source, /0\.75\s*\+\s*\(1\s*-\s*lum/);
  assert.doesNotMatch(source, /TRACK\s*\$\{frame/);
  assert.match(source, /KeyxymFrontendRuntime/);
  assert.match(source, /KeyxymV22Runtime/);
  assert.match(source, /verifyWorldCellAssurance/);
  assert.match(source, /FORMING FIELD \/ NON-METRIC/);
});
