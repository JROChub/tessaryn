export const KEYXYM_V22_POSE_FLOATS = 22;
export const KEYXYM_V22_FORMING_FLOATS = 10;
export const KEYXYM_V22_SURFEL_FLOATS = 13;
export const KEYXYM_V22_QUALITY_FLOATS = 8;
export const KEYXYM_V22_RECEIPT_BYTES = 64;
export const KEYXYM_V22_MAXIMUM_SURFELS = 48_000;
export const KEYXYM_V22_MAXIMUM_FORMING_SAMPLES = 8_192;

export interface KeyxymBrowserFrame {
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

export interface KeyxymPoseEstimate {
  worldFromCamera: Float32Array;
  matches: number;
  inliers: number;
  tracking: number;
  parallaxDegrees: number;
  reprojectionErrorPixels: number;
  recovered: boolean;
}

export interface KeyxymFormingSample {
  normalizedX: number;
  normalizedY: number;
  flowX: number;
  flowY: number;
  r: number;
  g: number;
  b: number;
  salience: number;
  trackSupport: number;
  age: number;
}

export interface KeyxymSurfel {
  x: number; y: number; z: number;
  nx: number; ny: number; nz: number;
  r: number; g: number; b: number;
  confidence: number;
  uncertainty: number;
  observations: number;
  sourceKeyframe: number;
}

export interface KeyxymGeometrySnapshot {
  revision: bigint;
  surfels: KeyxymSurfel[];
}

export interface KeyxymQuality {
  tracking: number;
  parallaxDegrees: number;
  reprojectionErrorPixels: number;
  coverage: number;
  confirmed: number;
  uncertain: number;
  rejected: number;
  metricScale: boolean;
}

export interface KeyxymReceipts {
  pose: Uint8Array;
  quality: Uint8Array;
}

type EmscriptenModule = {
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;
  _malloc(size: number): number;
  _free(pointer: number): void;
  _keyxym_v22_browser_session_create(
    branch: number,
    voxel: number,
    maximumSurfels: number,
    maximumAnalysisWidth: number,
    maximumAnalysisHeight: number,
    maximumTracks: number,
    maximumPreviewSamples: number,
    output: number,
  ): number;
  _keyxym_v22_browser_session_destroy(session: number): void;
  _keyxym_v22_browser_ingest_rgba_packed(...args: Array<number | bigint>): number;
  _keyxym_v22_browser_copy_receipts(
    session: number,
    output: number,
    capacity: number,
    required: number,
  ): number;
  _keyxym_v22_browser_copy_preview_packed(
    session: number,
    output: number,
    capacity: number,
    required: number,
  ): number;
  _keyxym_v22_browser_geometry_revision(session: number): bigint;
  _keyxym_v22_browser_copy_geometry_snapshot_packed(
    session: number,
    output: number,
    capacity: number,
    required: number,
    revision: number,
  ): number;
  _keyxym_v22_session_quality_packed(session: number, output: number, count: number): number;
};

type EmscriptenFactory = (options?: {
  locateFile?: (path: string) => string;
  noInitialRun?: boolean;
}) => Promise<EmscriptenModule>;

export interface KeyxymRuntimeOptions {
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

function requirePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
}

function requireCamera(frame: KeyxymBrowserFrame): void {
  requirePositiveInteger(frame.width, "Keyxym frame width");
  requirePositiveInteger(frame.height, "Keyxym frame height");
  const pixels = frame.width * frame.height;
  if (!Number.isSafeInteger(pixels) || pixels > 64 * 1024 * 1024) {
    throw new Error("Keyxym frame pixel budget exceeded");
  }
  if (frame.rgba.byteLength !== pixels * 4) {
    throw new Error("Keyxym RGBA payload does not match frame dimensions");
  }
  if (frame.sourceCommitment.byteLength !== 32) {
    throw new Error("Keyxym source commitment must contain exactly 32 bytes");
  }
  if (frame.timestampNs <= 0n) throw new Error("Keyxym timestamp must be positive");
  if (![frame.fx, frame.fy, frame.cx, frame.cy, frame.scaleMetersPerUnit].every(finite) ||
      frame.fx <= 0 || frame.fy <= 0 || frame.scaleMetersPerUnit <= 0) {
    throw new Error("Keyxym camera model is invalid");
  }
}

export class KeyxymV22Runtime {
  private destroyed = false;
  private lastTimestampNs = 0n;

  private constructor(
    private readonly module: EmscriptenModule,
    private readonly session: number,
  ) {}

  static async load(options: KeyxymRuntimeOptions = {}): Promise<KeyxymV22Runtime> {
    const moduleUrl = options.moduleUrl ?? "/keyxym/keyxym-v22.mjs";
    const wasmUrl = options.wasmUrl ?? "/keyxym/keyxym-v22.wasm";
    const branchName = options.branch ?? "main/world-cell-theater";
    const voxelSizeMeters = options.voxelSizeMeters ?? 0.018;
    const maximumAnalysisWidth = options.maximumAnalysisWidth ?? 320;
    const maximumAnalysisHeight = options.maximumAnalysisHeight ?? 240;
    const maximumTracks = options.maximumTracks ?? 384;
    const maximumFormingSamples = options.maximumFormingSamples ?? KEYXYM_V22_MAXIMUM_FORMING_SAMPLES;

    requirePositiveInteger(maximumAnalysisWidth, "Keyxym analysis width");
    requirePositiveInteger(maximumAnalysisHeight, "Keyxym analysis height");
    requirePositiveInteger(maximumTracks, "Keyxym track budget");
    requirePositiveInteger(maximumFormingSamples, "Keyxym forming-field budget");
    if (!finite(voxelSizeMeters) || voxelSizeMeters <= 0) {
      throw new Error("Keyxym voxel size is invalid");
    }
    if (typeof BigInt !== "function") {
      throw new Error("Keyxym browser authority requires WebAssembly BigInt support");
    }

    const imported = await import(/* @vite-ignore */ moduleUrl) as { default?: EmscriptenFactory };
    if (typeof imported.default !== "function") {
      throw new Error("Keyxym v0.22 module factory is missing");
    }
    const module = await imported.default({
      noInitialRun: true,
      locateFile: (path) => path.endsWith(".wasm") ? wasmUrl : path,
    });
    for (const name of [
      "HEAPU8", "HEAPF32", "_malloc", "_free",
      "_keyxym_v22_browser_session_create",
      "_keyxym_v22_browser_session_destroy",
      "_keyxym_v22_browser_ingest_rgba_packed",
      "_keyxym_v22_browser_copy_receipts",
      "_keyxym_v22_browser_copy_preview_packed",
      "_keyxym_v22_browser_geometry_revision",
      "_keyxym_v22_browser_copy_geometry_snapshot_packed",
      "_keyxym_v22_session_quality_packed",
    ] as const) {
      if (!(name in module)) throw new Error(`Keyxym v0.22 browser ABI missing ${name}`);
    }

    const branch = KeyxymV22Runtime.writeBytes(module, encoder.encode(`${branchName}\0`));
    const output = module._malloc(4);
    try {
      const status = module._keyxym_v22_browser_session_create(
        branch,
        voxelSizeMeters,
        KEYXYM_V22_MAXIMUM_SURFELS,
        maximumAnalysisWidth,
        maximumAnalysisHeight,
        maximumTracks,
        maximumFormingSamples,
        output,
      );
      if (status !== OK) throw new Error(`Keyxym browser session create failed (${status})`);
      const session = new DataView(module.HEAPU8.buffer).getUint32(output, true);
      if (!session) throw new Error("Keyxym returned a null browser session");
      return new KeyxymV22Runtime(module, session);
    } finally {
      module._free(branch);
      module._free(output);
    }
  }

  ingest(frame: KeyxymBrowserFrame): KeyxymPoseEstimate {
    this.assertAlive();
    requireCamera(frame);
    if (frame.timestampNs <= this.lastTimestampNs) {
      throw new Error("Keyxym frame timestamps must increase strictly");
    }

    const rgba = KeyxymV22Runtime.writeBytes(this.module, frame.rgba);
    const commitment = KeyxymV22Runtime.writeBytes(this.module, frame.sourceCommitment);
    const pose = this.module._malloc(KEYXYM_V22_POSE_FLOATS * 4);
    try {
      const status = this.module._keyxym_v22_browser_ingest_rgba_packed(
        this.session,
        BigInt.asIntN(64, frame.timestampNs),
        frame.width,
        frame.height,
        frame.fx,
        frame.fy,
        frame.cx,
        frame.cy,
        frame.scaleMetersPerUnit,
        frame.metricScale ? 1 : 0,
        rgba,
        frame.rgba.byteLength,
        commitment,
        frame.sourceCommitment.byteLength,
        pose,
        KEYXYM_V22_POSE_FLOATS,
      );
      if (status === INVALID_ARGUMENT) throw new Error("Keyxym rejected the committed browser frame");
      if (status !== OK) throw new Error(`Keyxym browser ingest failed (${status})`);
      const offset = pose >>> 2;
      const values = this.module.HEAPF32.slice(offset, offset + KEYXYM_V22_POSE_FLOATS);
      if (!values.every(finite)) throw new Error("Keyxym returned a non-finite pose record");
      this.lastTimestampNs = frame.timestampNs;
      return {
        worldFromCamera: values.slice(0, 16),
        matches: values[16]!,
        inliers: values[17]!,
        tracking: values[18]!,
        parallaxDegrees: values[19]!,
        reprojectionErrorPixels: values[20]!,
        recovered: values[21]! === 1,
      };
    } finally {
      this.module._free(rgba);
      this.module._free(commitment);
      this.module._free(pose);
    }
  }

  receipts(): KeyxymReceipts {
    this.assertAlive();
    const output = this.module._malloc(KEYXYM_V22_RECEIPT_BYTES);
    const required = this.module._malloc(4);
    try {
      const status = this.module._keyxym_v22_browser_copy_receipts(
        this.session, output, KEYXYM_V22_RECEIPT_BYTES, required,
      );
      if (status !== OK) throw new Error(`Keyxym receipt copy failed (${status})`);
      const returned = new DataView(this.module.HEAPU8.buffer).getUint32(required, true);
      if (returned !== KEYXYM_V22_RECEIPT_BYTES) {
        throw new Error("Keyxym returned a malformed receipt record");
      }
      const bytes = this.module.HEAPU8.slice(output, output + KEYXYM_V22_RECEIPT_BYTES);
      return { pose: bytes.slice(0, 32), quality: bytes.slice(32, 64) };
    } finally {
      this.module._free(output);
      this.module._free(required);
    }
  }

  formingField(): KeyxymFormingSample[] {
    this.assertAlive();
    const values = this.copyPacked(
      KEYXYM_V22_FORMING_FLOATS,
      KEYXYM_V22_MAXIMUM_FORMING_SAMPLES,
      (output, capacity, required) => this.module._keyxym_v22_browser_copy_preview_packed(
        this.session, output, capacity, required,
      ),
      "forming field",
    );
    const samples: KeyxymFormingSample[] = [];
    for (let index = 0; index < values.length; index += KEYXYM_V22_FORMING_FLOATS) {
      samples.push({
        normalizedX: values[index]!,
        normalizedY: values[index + 1]!,
        flowX: values[index + 2]!,
        flowY: values[index + 3]!,
        r: values[index + 4]!,
        g: values[index + 5]!,
        b: values[index + 6]!,
        salience: values[index + 7]!,
        trackSupport: values[index + 8]!,
        age: values[index + 9]!,
      });
    }
    return samples;
  }

  geometryRevision(): bigint {
    this.assertAlive();
    const revision = this.module._keyxym_v22_browser_geometry_revision(this.session);
    if (typeof revision !== "bigint" || revision < 0n) {
      throw new Error("Keyxym returned an invalid geometry revision");
    }
    return revision;
  }

  geometrySnapshot(previousRevision?: bigint): KeyxymGeometrySnapshot | null {
    this.assertAlive();
    const current = this.geometryRevision();
    if (previousRevision !== undefined && current === previousRevision) return null;

    const required = this.module._malloc(4);
    const revisionPointer = this.module._malloc(8);
    try {
      let status = this.module._keyxym_v22_browser_copy_geometry_snapshot_packed(
        this.session, 0, 0, required, revisionPointer,
      );
      if (status !== BUFFER_TOO_SMALL && status !== OK) {
        throw new Error(`Keyxym geometry snapshot size failed (${status})`);
      }
      const view = new DataView(this.module.HEAPU8.buffer);
      const floatCount = view.getUint32(required, true);
      const revision = view.getBigUint64(revisionPointer, true);
      if (floatCount % KEYXYM_V22_SURFEL_FLOATS !== 0 ||
          floatCount / KEYXYM_V22_SURFEL_FLOATS > KEYXYM_V22_MAXIMUM_SURFELS) {
        throw new Error("Keyxym returned malformed or unbounded geometry");
      }
      if (!floatCount) return { revision, surfels: [] };
      const output = this.module._malloc(floatCount * 4);
      try {
        status = this.module._keyxym_v22_browser_copy_geometry_snapshot_packed(
          this.session, output, floatCount, required, revisionPointer,
        );
        if (status !== OK) throw new Error(`Keyxym geometry snapshot copy failed (${status})`);
        const returnedCount = new DataView(this.module.HEAPU8.buffer).getUint32(required, true);
        const returnedRevision = new DataView(this.module.HEAPU8.buffer).getBigUint64(revisionPointer, true);
        if (returnedCount !== floatCount || returnedRevision !== revision) {
          throw new Error("Keyxym geometry changed during the locked snapshot copy");
        }
        const offset = output >>> 2;
        const values = this.module.HEAPF32.slice(offset, offset + floatCount);
        if (!values.every(finite)) throw new Error("Keyxym geometry contains non-finite values");
        const surfels: KeyxymSurfel[] = [];
        for (let index = 0; index < values.length; index += KEYXYM_V22_SURFEL_FLOATS) {
          surfels.push({
            x: values[index]!, y: values[index + 1]!, z: values[index + 2]!,
            nx: values[index + 3]!, ny: values[index + 4]!, nz: values[index + 5]!,
            r: values[index + 6]!, g: values[index + 7]!, b: values[index + 8]!,
            confidence: values[index + 9]!, uncertainty: values[index + 10]!,
            observations: values[index + 11]!, sourceKeyframe: values[index + 12]!,
          });
        }
        return { revision, surfels };
      } finally {
        this.module._free(output);
      }
    } finally {
      this.module._free(required);
      this.module._free(revisionPointer);
    }
  }

  quality(): KeyxymQuality {
    this.assertAlive();
    const output = this.module._malloc(KEYXYM_V22_QUALITY_FLOATS * 4);
    try {
      const status = this.module._keyxym_v22_session_quality_packed(
        this.session, output, KEYXYM_V22_QUALITY_FLOATS,
      );
      if (status !== OK) throw new Error(`Keyxym quality failed (${status})`);
      const offset = output >>> 2;
      const value = this.module.HEAPF32.slice(offset, offset + KEYXYM_V22_QUALITY_FLOATS);
      if (!value.every(finite)) throw new Error("Keyxym quality record is non-finite");
      return {
        tracking: value[0]!,
        parallaxDegrees: value[1]!,
        reprojectionErrorPixels: value[2]!,
        coverage: value[3]!,
        confirmed: value[4]!,
        uncertain: value[5]!,
        rejected: value[6]!,
        metricScale: value[7]! === 1,
      };
    } finally {
      this.module._free(output);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.module._keyxym_v22_browser_session_destroy(this.session);
    this.destroyed = true;
  }

  private copyPacked(
    recordFloats: number,
    maximumRecords: number,
    copy: (output: number, capacity: number, required: number) => number,
    label: string,
  ): Float32Array {
    const required = this.module._malloc(4);
    try {
      let status = copy(0, 0, required);
      if (status !== BUFFER_TOO_SMALL && status !== OK) {
        throw new Error(`Keyxym ${label} size failed (${status})`);
      }
      const floatCount = new DataView(this.module.HEAPU8.buffer).getUint32(required, true);
      if (floatCount % recordFloats !== 0 || floatCount / recordFloats > maximumRecords) {
        throw new Error(`Keyxym returned malformed or unbounded ${label}`);
      }
      if (!floatCount) return new Float32Array();
      const output = this.module._malloc(floatCount * 4);
      try {
        status = copy(output, floatCount, required);
        if (status !== OK) throw new Error(`Keyxym ${label} copy failed (${status})`);
        const returnedCount = new DataView(this.module.HEAPU8.buffer).getUint32(required, true);
        if (returnedCount !== floatCount) throw new Error(`Keyxym ${label} changed during copy`);
        const offset = output >>> 2;
        const values = this.module.HEAPF32.slice(offset, offset + floatCount);
        if (!values.every(finite)) throw new Error(`Keyxym ${label} contains non-finite values`);
        return values;
      } finally {
        this.module._free(output);
      }
    } finally {
      this.module._free(required);
    }
  }

  private assertAlive(): void {
    if (this.destroyed) throw new Error("Keyxym browser session has been destroyed");
  }

  private static writeBytes(module: EmscriptenModule, value: Uint8Array): number {
    const pointer = module._malloc(Math.max(1, value.byteLength));
    if (!pointer) throw new Error("Keyxym WebAssembly allocation failed");
    if (value.byteLength) module.HEAPU8.set(value, pointer);
    return pointer;
  }
}
