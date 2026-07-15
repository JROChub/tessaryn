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
const POSE_FLOATS = 27;
const QUALITY_FLOATS = 8;
const AUTHORITY_FLOATS = 8;
const PREVIEW_FLOATS = 10;
const SURFEL_FLOATS = 13;
const RECEIPT_BYTES = 96;

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

const branch = allocBytes(new TextEncoder().encode("v026-validation\0"));
const sessionOutput = runtime._malloc(4);
assert.equal(runtime._keyxym_v26_session_create(
  branch, 0.02, 48_000, 320, 240, 384, 8192, sessionOutput,
), OK);
const session = new DataView(runtime.HEAPU8.buffer).getUint32(sessionOutput, true);
assert.notEqual(session, 0);
runtime._free(branch);
runtime._free(sessionOutput);

const posePointer = runtime._malloc(POSE_FLOATS * 4);
const frames = [0, 8, 16, 24, 32, 40].map((shift) => texture(640, 480, shift));
const commitments = frames.map((_, index) => {
  const bytes = new Uint8Array(32);
  bytes[0] = index + 1;
  return bytes;
});

function ingest(index, timestamp) {
  const rgbaPointer = allocBytes(frames[index]);
  const commitmentPointer = allocBytes(commitments[index]);
  try {
    return runtime._keyxym_v26_ingest_rgba_packed(
      session, BigInt(timestamp), 640, 480, 520, 520, 320, 240,
      1, 0, rgbaPointer, frames[index].byteLength,
      commitmentPointer, commitments[index].byteLength,
      posePointer, POSE_FLOATS,
    );
  } finally {
    runtime._free(rgbaPointer);
    runtime._free(commitmentPointer);
  }
}

assert.equal(ingest(0, 1_000_000), OK);
const poseOffset = posePointer >>> 2;
let pose = runtime.HEAPF32.slice(poseOffset, poseOffset + POSE_FLOATS);
assert.equal(pose[23], 1);
assert.equal(pose[24], 1);
assert.equal(runtime._keyxym_v26_geometry_revision(session), 0n);

const requiredPointer = runtime._malloc(4);
assert.equal(runtime._keyxym_v26_copy_preview_packed(
  session, 0, 0, requiredPointer,
), BUFFER_TOO_SMALL);
let required = new DataView(runtime.HEAPU8.buffer).getUint32(requiredPointer, true);
assert(required > 0 && required % PREVIEW_FLOATS === 0);
const previewPointer = runtime._malloc(required * 4);
assert.equal(runtime._keyxym_v26_copy_preview_packed(
  session, previewPointer, required, requiredPointer,
), OK);
runtime._free(previewPointer);

for (let index = 1; index < frames.length; index += 1) {
  assert.equal(ingest(index, (index + 1) * 1_000_000), OK);
}
pose = runtime.HEAPF32.slice(poseOffset, poseOffset + POSE_FLOATS);
assert(pose.slice(0, 23).every(Number.isFinite));
assert(pose[16] >= 12);
assert(pose[17] >= 10);
assert(pose[18] >= 0 && pose[18] <= 1);
assert(pose[21] >= 0);
assert(pose[22] >= 0 && pose[22] <= 1);

const receiptPointer = runtime._malloc(RECEIPT_BYTES);
assert.equal(runtime._keyxym_v26_copy_receipts(
  session, receiptPointer, RECEIPT_BYTES, requiredPointer,
), OK);
assert.equal(new DataView(runtime.HEAPU8.buffer).getUint32(requiredPointer, true), RECEIPT_BYTES);
const receipts = runtime.HEAPU8.slice(receiptPointer, receiptPointer + RECEIPT_BYTES);
for (let offset = 0; offset < RECEIPT_BYTES; offset += 32) {
  assert(receipts.slice(offset, offset + 32).some((value) => value !== 0));
}

const qualityPointer = runtime._malloc(QUALITY_FLOATS * 4);
const authorityPointer = runtime._malloc(AUTHORITY_FLOATS * 4);
assert.equal(runtime._keyxym_v26_quality_packed(session, qualityPointer, QUALITY_FLOATS), OK);
assert.equal(runtime._keyxym_v26_authority_packed(session, authorityPointer, AUTHORITY_FLOATS), OK);
const quality = runtime.HEAPF32.slice(qualityPointer >>> 2, (qualityPointer >>> 2) + QUALITY_FLOATS);
const authority = runtime.HEAPF32.slice(authorityPointer >>> 2, (authorityPointer >>> 2) + AUTHORITY_FLOATS);
assert(quality.every(Number.isFinite));
assert(authority.every(Number.isFinite));
assert(authority[0] >= 0 && authority[0] <= 3);
assert(authority[2] >= 0 && authority[2] <= 1);
assert(authority[5] === 0 || authority[5] === 1);
assert(authority[6] === 0 || authority[6] === 1);

const revision = runtime._keyxym_v26_geometry_revision(session);
const revisionPointer = runtime._malloc(8);
const geometryStatus = runtime._keyxym_v26_copy_geometry_snapshot_packed(
  session, 0, 0, requiredPointer, revisionPointer,
);
assert(geometryStatus === OK || geometryStatus === BUFFER_TOO_SMALL);
required = new DataView(runtime.HEAPU8.buffer).getUint32(requiredPointer, true);
assert.equal(required % SURFEL_FLOATS, 0);
assert.equal(new DataView(runtime.HEAPU8.buffer).getBigUint64(revisionPointer, true), revision);
let surfelCount = 0;
if (required > 0) {
  const geometryPointer = runtime._malloc(required * 4);
  assert.equal(runtime._keyxym_v26_copy_geometry_snapshot_packed(
    session, geometryPointer, required, requiredPointer, revisionPointer,
  ), OK);
  const geometry = runtime.HEAPF32.slice(geometryPointer >>> 2, (geometryPointer >>> 2) + required);
  assert(geometry.every(Number.isFinite));
  surfelCount = required / SURFEL_FLOATS;
  assert(surfelCount <= 48_000);
  runtime._free(geometryPointer);
}

assert.equal(ingest(frames.length - 1, frames.length * 1_000_000), INVALID_ARGUMENT);

runtime._free(authorityPointer);
runtime._free(qualityPointer);
runtime._free(receiptPointer);
runtime._free(revisionPointer);
runtime._free(requiredPointer);
runtime._free(posePointer);
runtime._keyxym_v26_session_destroy(session);

console.log(JSON.stringify({
  matches: pose[16],
  inliers: pose[17],
  tracking: pose[18],
  parallaxDegrees: pose[19],
  reprojectionErrorPixels: pose[20],
  rotationDegrees: pose[21],
  translationObservability: pose[22],
  recovered: pose[23] === 1,
  degenerate: pose[24] === 1,
  relocalized: pose[25] === 1,
  authorityStage: authority[0],
  authorityScore: authority[2],
  momentAllowed: authority[5] === 1,
  sealAllowed: authority[6] === 1,
  surfelCount,
  revision: revision.toString(),
  poseReceipt: Buffer.from(receipts.slice(0, 32)).toString("hex"),
  qualityReceipt: Buffer.from(receipts.slice(32, 64)).toString("hex"),
  authorityReceipt: Buffer.from(receipts.slice(64, 96)).toString("hex"),
}, null, 2));
