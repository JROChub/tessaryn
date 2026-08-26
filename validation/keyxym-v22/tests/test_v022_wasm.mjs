import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";

const modulePath = resolve(process.argv[2]);
const wasmPath = resolve(process.argv[3]);
const imported = await import(pathToFileURL(modulePath).href);
assert.equal(typeof imported.default, "function");
const runtime = await imported.default({
  noInitialRun: true,
  locateFile: (path) => path.endsWith(".wasm") ? wasmPath : resolve(dirname(modulePath), path),
});

const OK = 0;
const INVALID_ARGUMENT = 1;
const BUFFER_TOO_SMALL = 2;
const POSE_FLOATS = 22;
const PREVIEW_FLOATS = 10;
const SURFEL_FLOATS = 13;
const RECEIPT_BYTES = 64;

function allocBytes(bytes) {
  const pointer = runtime._malloc(bytes.byteLength || 1);
  runtime.HEAPU8.set(bytes, pointer);
  return pointer;
}

function texture(width, height, shift) {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sx = x - shift;
      const checker = ((Math.trunc(sx / 5) ^ Math.trunc(y / 5)) & 1);
      const detail = ((sx * sx + y * y + sx * y) % 53 + 53) % 53;
      const value = checker ? 190 + detail % 50 : 25 + detail;
      const offset = (y * width + x) * 4;
      rgba[offset] = value;
      rgba[offset + 1] = Math.trunc(value * 3 / 4);
      rgba[offset + 2] = 255 - Math.trunc(value / 2);
      rgba[offset + 3] = 255;
    }
  }
  return rgba;
}

const branch = allocBytes(new TextEncoder().encode("browser-consensus\0"));
const sessionOutput = runtime._malloc(4);
assert.equal(runtime._keyxym_v22_browser_session_create(
  branch, 0.02, 48_000, 160, 120, 256, 2048, sessionOutput,
), OK);
const session = new DataView(runtime.HEAPU8.buffer).getUint32(sessionOutput, true);
assert.notEqual(session, 0);
runtime._free(branch);
runtime._free(sessionOutput);

const posePointer = runtime._malloc(POSE_FLOATS * 4);
const commitments = [1, 2, 3].map((value) => {
  const bytes = new Uint8Array(32);
  bytes[0] = value;
  return bytes;
});
const frames = [0, 8, 16].map((shift) => texture(640, 480, shift));

function ingest(index, timestamp) {
  const rgbaPointer = allocBytes(frames[index]);
  const commitmentPointer = allocBytes(commitments[index]);
  try {
    return runtime._keyxym_v22_browser_ingest_rgba_packed(
      session,
      BigInt(timestamp),
      640,
      480,
      520,
      520,
      320,
      240,
      1,
      0,
      rgbaPointer,
      frames[index].byteLength,
      commitmentPointer,
      commitments[index].byteLength,
      posePointer,
      POSE_FLOATS,
    );
  } finally {
    runtime._free(rgbaPointer);
    runtime._free(commitmentPointer);
  }
}

assert.equal(ingest(0, 1_000_000), OK);
assert.equal(runtime._keyxym_v22_browser_geometry_revision(session), 1n);

const requiredPointer = runtime._malloc(4);
assert.equal(runtime._keyxym_v22_browser_copy_preview_packed(
  session, 0, 0, requiredPointer,
), BUFFER_TOO_SMALL);
let required = new DataView(runtime.HEAPU8.buffer).getUint32(requiredPointer, true);
assert(required > 0);
assert.equal(required % PREVIEW_FLOATS, 0);
const previewPointer = runtime._malloc(required * 4);
assert.equal(runtime._keyxym_v22_browser_copy_preview_packed(
  session, previewPointer, required, requiredPointer,
), OK);
runtime._free(previewPointer);

assert.equal(ingest(1, 2_000_000), OK);
assert.equal(ingest(2, 3_000_000), OK);
const poseOffset = posePointer >>> 2;
const pose = runtime.HEAPF32.slice(poseOffset, poseOffset + POSE_FLOATS);
assert(pose[16] >= 12);
assert(pose[17] >= 10);
assert.equal(pose[21], 1);

const receiptPointer = runtime._malloc(RECEIPT_BYTES);
assert.equal(runtime._keyxym_v22_browser_copy_receipts(
  session, receiptPointer, RECEIPT_BYTES, requiredPointer,
), OK);
assert.equal(new DataView(runtime.HEAPU8.buffer).getUint32(requiredPointer, true), RECEIPT_BYTES);
const receipts = runtime.HEAPU8.slice(receiptPointer, receiptPointer + RECEIPT_BYTES);
assert(receipts.slice(0, 32).some((value) => value !== 0));
assert(receipts.slice(32).some((value) => value !== 0));
runtime._free(receiptPointer);

const revision = runtime._keyxym_v22_browser_geometry_revision(session);
assert.equal(revision, 3n);
const revisionPointer = runtime._malloc(8);
assert.equal(runtime._keyxym_v22_browser_copy_geometry_snapshot_packed(
  session, 0, 0, requiredPointer, revisionPointer,
), BUFFER_TOO_SMALL);
required = new DataView(runtime.HEAPU8.buffer).getUint32(requiredPointer, true);
assert(required > 0);
assert.equal(required % SURFEL_FLOATS, 0);
assert.equal(new DataView(runtime.HEAPU8.buffer).getBigUint64(revisionPointer, true), revision);
const geometryPointer = runtime._malloc(required * 4);
assert.equal(runtime._keyxym_v22_browser_copy_geometry_snapshot_packed(
  session, geometryPointer, required, requiredPointer, revisionPointer,
), OK);
const surfelCount = required / SURFEL_FLOATS;
assert(surfelCount > 0 && surfelCount <= 48_000);
assert.equal(new DataView(runtime.HEAPU8.buffer).getBigUint64(revisionPointer, true), revision);
runtime._free(geometryPointer);

const qualityPointer = runtime._malloc(8 * 4);
assert.equal(runtime._keyxym_v22_session_quality_packed(session, qualityPointer, 8), OK);
const quality = runtime.HEAPF32.slice(qualityPointer >>> 2, (qualityPointer >>> 2) + 8);
assert(quality.every(Number.isFinite));
runtime._free(qualityPointer);

assert.equal(ingest(2, 3_000_000), INVALID_ARGUMENT);

runtime._free(revisionPointer);
runtime._free(requiredPointer);
runtime._free(posePointer);
runtime._keyxym_v22_browser_session_destroy(session);

console.log(JSON.stringify({
  inliers: pose[17],
  surfelCount,
  revision: revision.toString(),
  poseReceipt: Buffer.from(receipts.slice(0, 32)).toString("hex"),
  qualityReceipt: Buffer.from(receipts.slice(32)).toString("hex"),
}, null, 2));
