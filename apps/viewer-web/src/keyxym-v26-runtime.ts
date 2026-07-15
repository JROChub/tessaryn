export const KEYXYM_V26_POSE_FLOATS = 27;
export const KEYXYM_V26_QUALITY_FLOATS = 8;
export const KEYXYM_V26_AUTHORITY_FLOATS = 8;
export const KEYXYM_V26_FORMING_FLOATS = 10;
export const KEYXYM_V26_SURFEL_FLOATS = 13;
export const KEYXYM_V26_RECEIPT_BYTES = 96;
export const KEYXYM_V26_MAXIMUM_SURFELS = 48_000;
export const KEYXYM_V26_MAXIMUM_FORMING_SAMPLES = 8_192;

export interface KeyxymV26BrowserFrame {
  timestampNs: bigint;
  width: number;
  height: number;
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  scaleMetersPerUnit: number;
  metricScale: boolean;
  rgba: Uint8Array;
  sourceCommitment: Uint8Array;
}

export interface KeyxymV26Pose {
  worldFromCamera: Float32Array;
  matches: number;
  inliers: number;
  tracking: number;
  parallaxDegrees: number;
  reprojectionErrorPixels: number;
  rotationDegrees: number;
  translationObservability: number;
  recovered: boolean;
  degenerate: boolean;
  relocalized: boolean;
  keyframeIndex: number;
}

export interface KeyxymV26Quality {
  tracking: number;
  parallaxDegrees: number;
  reprojectionErrorPixels: number;
  coverage: number;
  confirmed: number;
  uncertain: number;
  rejected: number;
  metricScale: boolean;
}

export type KeyxymV26AuthorityStage = "forming" | "tracking" | "moment-ready" | "seal-ready";

export interface KeyxymV26Authority {
  stage: KeyxymV26AuthorityStage;
  rejectionMask: number;
  score: number;
  confirmedSurfels: number;
  continuityFrames: number;
  momentAllowed: boolean;
  sealAllowed: boolean;
  metricScale: boolean;
}

export interface KeyxymV26Receipts {
  pose: Uint8Array;
  quality: Uint8Array;
  authority: Uint8Array;
}

export interface KeyxymV26Snapshot {
  pose: KeyxymV26Pose;
  quality: KeyxymV26Quality;
  authority: KeyxymV26Authority;
  receipts: KeyxymV26Receipts;
  forming: Float32Array;
  geometry: Float32Array | null;
  geometryRevision: bigint;
}

type EmscriptenModule = {
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;
  _malloc(size: number): number;
  _free(pointer: number): void;
  _keyxym_v26_session_create(...args: number[]): number;
  _keyxym_v26_session_destroy(session: number): void;
  _keyxym_v26_ingest_rgba_packed(...args: Array<number | bigint>): number;
  _keyxym_v26_copy_receipts(session: number, output: number, capacity: number, required: number): number;
  _keyxym_v26_copy_preview_packed(session: number, output: number, capacity: number, required: number): number;
  _keyxym_v26_geometry_revision(session: number): bigint;
  _keyxym_v26_copy_geometry_snapshot_packed(session: number, output: number, capacity: number, required: number, revision: number): number;
  _keyxym_v26_quality_packed(session: number, output: number, count: number): number;
  _keyxym_v26_authority_packed(session: number, output: number, count: number): number;
};

type EmscriptenFactory = (options?: {
  locateFile?: (path: string) => string;
  noInitialRun?: boolean;
}) => Promise<EmscriptenModule>;

export interface KeyxymV26RuntimeOptions {
  moduleUrl?: string;
  wasmUrl?: string;
  branch?: string;
  voxelSizeMeters?: number;
  maximumAnalysisWidth?: number;
  maximumAnalysisHeight?: number;
  maximumTracks?: number;
  maximumFormingSamples?: number;
}

const OK = 0;
const INVALID_ARGUMENT = 1;
const BUFFER_TOO_SMALL = 2;
const encoder = new TextEncoder();
const finite = (value: number) => Number.isFinite(value);

function positiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
}

function writeBytes(module: EmscriptenModule, bytes: Uint8Array): number {
  const pointer = module._malloc(Math.max(1, bytes.byteLength));
  module.HEAPU8.set(bytes, pointer);
  return pointer;
}

function authorityStage(value: number): KeyxymV26AuthorityStage {
  if (value === 0) return "forming";
  if (value === 1) return "tracking";
  if (value === 2) return "moment-ready";
  if (value === 3) return "seal-ready";
  throw new Error("Keyxym returned an invalid authority stage");
}

export class KeyxymV26Runtime {
  private destroyed = false;
  private lastTimestampNs = 0n;
  private lastGeometryRevision = -1n;

  private constructor(private readonly module: EmscriptenModule, private readonly session: number) {}

  static async load(options: KeyxymV26RuntimeOptions = {}): Promise<KeyxymV26Runtime> {
    const moduleUrl = options.moduleUrl ?? "/keyxym-v26/keyxym-v26.mjs";
    const wasmUrl = options.wasmUrl ?? "/keyxym-v26/keyxym-v26.wasm";
    const branchName = options.branch ?? "main/world-cell-theater-v026";
    const voxelSize = options.voxelSizeMeters ?? 0.018;
    const width = options.maximumAnalysisWidth ?? 320;
    const height = options.maximumAnalysisHeight ?? 240;
    const tracks = options.maximumTracks ?? 384;
    const forming = options.maximumFormingSamples ?? KEYXYM_V26_MAXIMUM_FORMING_SAMPLES;
    for (const [value, name] of [[width, "analysis width"], [height, "analysis height"], [tracks, "track budget"], [forming, "forming budget"]] as const) positiveInteger(value, name);
    if (!finite(voxelSize) || voxelSize <= 0) throw new Error("Keyxym voxel size is invalid");
    if (typeof BigInt !== "function") throw new Error("Keyxym v0.26 requires WebAssembly BigInt");

    const imported = await import(/* @vite-ignore */ moduleUrl) as { default?: EmscriptenFactory };
    if (typeof imported.default !== "function") throw new Error("Keyxym v0.26 module factory is missing");
    const module = await imported.default({ noInitialRun: true, locateFile: (path) => path.endsWith(".wasm") ? wasmUrl : path });
    for (const name of [
      "HEAPU8", "HEAPF32", "_malloc", "_free", "_keyxym_v26_session_create",
      "_keyxym_v26_session_destroy", "_keyxym_v26_ingest_rgba_packed",
      "_keyxym_v26_copy_receipts", "_keyxym_v26_copy_preview_packed",
      "_keyxym_v26_geometry_revision", "_keyxym_v26_copy_geometry_snapshot_packed",
      "_keyxym_v26_quality_packed", "_keyxym_v26_authority_packed",
    ] as const) if (!(name in module)) throw new Error(`Keyxym v0.26 ABI missing ${name}`);

    const branch = writeBytes(module, encoder.encode(`${branchName}\0`));
    const output = module._malloc(4);
    try {
      const status = module._keyxym_v26_session_create(branch, voxelSize, KEYXYM_V26_MAXIMUM_SURFELS, width, height, tracks, forming, output);
      if (status !== OK) throw new Error(`Keyxym v0.26 session create failed (${status})`);
      const session = new DataView(module.HEAPU8.buffer).getUint32(output, true);
      if (!session) throw new Error("Keyxym v0.26 returned a null session");
      return new KeyxymV26Runtime(module, session);
    } finally {
      module._free(branch);
      module._free(output);
    }
  }

  ingest(frame: KeyxymV26BrowserFrame): KeyxymV26Snapshot {
    this.assertAlive();
    const pixels = frame.width * frame.height;
    if (!Number.isSafeInteger(pixels) || pixels <= 0 || pixels > 64 * 1024 * 1024 || frame.rgba.byteLength !== pixels * 4) throw new Error("Keyxym frame payload is invalid");
    if (frame.sourceCommitment.byteLength !== 32) throw new Error("Keyxym source commitment must be 32 bytes");
    if (frame.timestampNs <= this.lastTimestampNs) throw new Error("Keyxym timestamps must increase strictly");
    if (![frame.fx, frame.fy, frame.cx, frame.cy, frame.scaleMetersPerUnit].every(finite) || frame.fx <= 0 || frame.fy <= 0 || frame.scaleMetersPerUnit <= 0) throw new Error("Keyxym camera model is invalid");

    const rgba = writeBytes(this.module, frame.rgba);
    const commitment = writeBytes(this.module, frame.sourceCommitment);
    const posePointer = this.module._malloc(KEYXYM_V26_POSE_FLOATS * 4);
    try {
      const status = this.module._keyxym_v26_ingest_rgba_packed(
        this.session, BigInt.asIntN(64, frame.timestampNs), frame.width, frame.height,
        frame.fx, frame.fy, frame.cx, frame.cy, frame.scaleMetersPerUnit,
        frame.metricScale ? 1 : 0, rgba, frame.rgba.byteLength, commitment,
        frame.sourceCommitment.byteLength, posePointer, KEYXYM_V26_POSE_FLOATS,
      );
      if (status === INVALID_ARGUMENT) throw new Error("Keyxym rejected the browser frame");
      if (status !== OK) throw new Error(`Keyxym v0.26 ingest failed (${status})`);
      const poseValues = this.module.HEAPF32.slice(posePointer >>> 2, (posePointer >>> 2) + KEYXYM_V26_POSE_FLOATS);
      if (!poseValues.every(finite)) throw new Error("Keyxym returned non-finite pose data");
      this.lastTimestampNs = frame.timestampNs;
      const pose: KeyxymV26Pose = {
        worldFromCamera: poseValues.slice(0, 16), matches: poseValues[16]!, inliers: poseValues[17]!,
        tracking: poseValues[18]!, parallaxDegrees: poseValues[19]!, reprojectionErrorPixels: poseValues[20]!,
        rotationDegrees: poseValues[21]!, translationObservability: poseValues[22]!, recovered: poseValues[23] === 1,
        degenerate: poseValues[24] === 1, relocalized: poseValues[25] === 1, keyframeIndex: poseValues[26]!,
      };
      return { pose, quality: this.quality(), authority: this.authority(), receipts: this.receipts(), forming: this.forming(), ...this.geometry() };
    } finally {
      this.module._free(rgba);
      this.module._free(commitment);
      this.module._free(posePointer);
    }
  }

  private quality(): KeyxymV26Quality {
    const pointer = this.module._malloc(KEYXYM_V26_QUALITY_FLOATS * 4);
    try {
      const status = this.module._keyxym_v26_quality_packed(this.session, pointer, KEYXYM_V26_QUALITY_FLOATS);
      if (status !== OK) throw new Error(`Keyxym quality copy failed (${status})`);
      const value = this.module.HEAPF32.slice(pointer >>> 2, (pointer >>> 2) + KEYXYM_V26_QUALITY_FLOATS);
      if (!value.every(finite)) throw new Error("Keyxym quality is non-finite");
      return { tracking: value[0]!, parallaxDegrees: value[1]!, reprojectionErrorPixels: value[2]!, coverage: value[3]!, confirmed: value[4]!, uncertain: value[5]!, rejected: value[6]!, metricScale: value[7] === 1 };
    } finally { this.module._free(pointer); }
  }

  private authority(): KeyxymV26Authority {
    const pointer = this.module._malloc(KEYXYM_V26_AUTHORITY_FLOATS * 4);
    try {
      const status = this.module._keyxym_v26_authority_packed(this.session, pointer, KEYXYM_V26_AUTHORITY_FLOATS);
      if (status !== OK) throw new Error(`Keyxym authority copy failed (${status})`);
      const value = this.module.HEAPF32.slice(pointer >>> 2, (pointer >>> 2) + KEYXYM_V26_AUTHORITY_FLOATS);
      if (!value.every(finite)) throw new Error("Keyxym authority is non-finite");
      return { stage: authorityStage(value[0]!), rejectionMask: value[1]!, score: value[2]!, confirmedSurfels: value[3]!, continuityFrames: value[4]!, momentAllowed: value[5] === 1, sealAllowed: value[6] === 1, metricScale: value[7] === 1 };
    } finally { this.module._free(pointer); }
  }

  private receipts(): KeyxymV26Receipts {
    const output = this.module._malloc(KEYXYM_V26_RECEIPT_BYTES);
    const required = this.module._malloc(4);
    try {
      const status = this.module._keyxym_v26_copy_receipts(this.session, output, KEYXYM_V26_RECEIPT_BYTES, required);
      const returned = new DataView(this.module.HEAPU8.buffer).getUint32(required, true);
      if (status !== OK || returned !== KEYXYM_V26_RECEIPT_BYTES) throw new Error("Keyxym returned malformed receipts");
      const bytes = this.module.HEAPU8.slice(output, output + KEYXYM_V26_RECEIPT_BYTES);
      return { pose: bytes.slice(0, 32), quality: bytes.slice(32, 64), authority: bytes.slice(64, 96) };
    } finally { this.module._free(output); this.module._free(required); }
  }

  private copyPacked(recordFloats: number, maximumRecords: number, copy: (output: number, capacity: number, required: number) => number): Float32Array {
    const required = this.module._malloc(4);
    try {
      const probe = copy(0, 0, required);
      const count = new DataView(this.module.HEAPU8.buffer).getUint32(required, true);
      if (probe !== OK && probe !== BUFFER_TOO_SMALL) throw new Error(`Keyxym packed probe failed (${probe})`);
      if (count === 0) return new Float32Array();
      if (count % recordFloats !== 0 || count / recordFloats > maximumRecords) throw new Error("Keyxym packed output exceeds contract");
      const output = this.module._malloc(count * 4);
      try {
        const status = copy(output, count, required);
        if (status !== OK) throw new Error(`Keyxym packed copy failed (${status})`);
        const values = this.module.HEAPF32.slice(output >>> 2, (output >>> 2) + count);
        if (!values.every(finite)) throw new Error("Keyxym packed output is non-finite");
        return values;
      } finally { this.module._free(output); }
    } finally { this.module._free(required); }
  }

  private forming(): Float32Array {
    return this.copyPacked(KEYXYM_V26_FORMING_FLOATS, KEYXYM_V26_MAXIMUM_FORMING_SAMPLES, (o, c, r) => this.module._keyxym_v26_copy_preview_packed(this.session, o, c, r));
  }

  private geometry(): { geometry: Float32Array | null; geometryRevision: bigint } {
    const revision = this.module._keyxym_v26_geometry_revision(this.session);
    if (revision === this.lastGeometryRevision) return { geometry: null, geometryRevision: revision };
    const required = this.module._malloc(4);
    const revisionPointer = this.module._malloc(8);
    try {
      const probe = this.module._keyxym_v26_copy_geometry_snapshot_packed(this.session, 0, 0, required, revisionPointer);
      const count = new DataView(this.module.HEAPU8.buffer).getUint32(required, true);
      if (probe !== OK && probe !== BUFFER_TOO_SMALL) throw new Error(`Keyxym geometry probe failed (${probe})`);
      if (count % KEYXYM_V26_SURFEL_FLOATS !== 0 || count / KEYXYM_V26_SURFEL_FLOATS > KEYXYM_V26_MAXIMUM_SURFELS) throw new Error("Keyxym geometry exceeds contract");
      let geometry = new Float32Array();
      if (count > 0) {
        const output = this.module._malloc(count * 4);
        try {
          const status = this.module._keyxym_v26_copy_geometry_snapshot_packed(this.session, output, count, required, revisionPointer);
          if (status !== OK) throw new Error(`Keyxym geometry copy failed (${status})`);
          geometry = this.module.HEAPF32.slice(output >>> 2, (output >>> 2) + count);
          if (!geometry.every(finite)) throw new Error("Keyxym geometry is non-finite");
        } finally { this.module._free(output); }
      }
      this.lastGeometryRevision = revision;
      return { geometry, geometryRevision: revision };
    } finally { this.module._free(required); this.module._free(revisionPointer); }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.module._keyxym_v26_session_destroy(this.session);
  }

  private assertAlive(): void { if (this.destroyed) throw new Error("Keyxym v0.26 runtime is destroyed"); }
}
