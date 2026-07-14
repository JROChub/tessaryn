export const KEYXYM_V22_FEATURE_FLOATS = 6;
export const KEYXYM_V22_POSE_FLOATS = 22;
export const KEYXYM_V22_SURFEL_FLOATS = 13;
export const KEYXYM_V22_QUALITY_FLOATS = 8;

export interface KeyxymFeature {
  id: number;
  x: number;
  y: number;
  score: number;
  disparity: number;
  matchError: number;
}

export interface KeyxymFrame {
  timestampNs: bigint;
  width: number;
  height: number;
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  scaleMetersPerUnit: number;
  metricScale: boolean;
  rgb: Float32Array;
  features: KeyxymFeature[];
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

export interface KeyxymSurfel {
  x: number; y: number; z: number;
  nx: number; ny: number; nz: number;
  r: number; g: number; b: number;
  confidence: number;
  uncertainty: number;
  observations: number;
  sourceKeyframe: number;
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

type EmscriptenModule = {
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;
  _malloc(size: number): number;
  _free(pointer: number): void;
  _keyxym_v22_session_create(branch: number, voxel: number, maximum: number, output: number): number;
  _keyxym_v22_session_destroy(session: number): void;
  _keyxym_v22_session_ingest_packed(...args: Array<number | bigint>): number;
  _keyxym_v22_session_copy_geometry_packed(session: number, output: number, capacity: number, required: number): number;
  _keyxym_v22_session_quality_packed(session: number, output: number, count: number): number;
};

type EmscriptenFactory = (options?: {
  locateFile?: (path: string) => string;
  noInitialRun?: boolean;
}) => Promise<EmscriptenModule>;

const OK = 0;
const BUFFER_TOO_SMALL = 2;
const encoder = new TextEncoder();

export class KeyxymV22Runtime {
  private destroyed = false;

  private constructor(
    private readonly module: EmscriptenModule,
    private readonly session: number,
  ) {}

  static async load(
    moduleUrl = "/keyxym/keyxym-v22.mjs",
    wasmUrl = "/keyxym/keyxym-v22.wasm",
  ): Promise<KeyxymV22Runtime> {
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
      "_keyxym_v22_session_create", "_keyxym_v22_session_destroy",
      "_keyxym_v22_session_ingest_packed",
      "_keyxym_v22_session_copy_geometry_packed",
      "_keyxym_v22_session_quality_packed",
    ] as const) {
      if (!(name in module)) throw new Error(`Keyxym v0.22 ABI missing ${name}`);
    }

    const branch = KeyxymV22Runtime.writeBytes(module, encoder.encode("agent/v022-metric-world-cell\0"));
    const output = module._malloc(4);
    try {
      const status = module._keyxym_v22_session_create(branch, 0.018, 48_000, output);
      if (status !== OK) throw new Error(`Keyxym session create failed (${status})`);
      const session = new DataView(module.HEAPU8.buffer).getUint32(output, true);
      if (!session) throw new Error("Keyxym returned a null session");
      return new KeyxymV22Runtime(module, session);
    } finally {
      module._free(branch);
      module._free(output);
    }
  }

  ingest(frame: KeyxymFrame): KeyxymPoseEstimate {
    this.assertAlive();
    if (frame.rgb.length !== frame.width * frame.height * 3) {
      throw new Error("Keyxym RGB payload does not match frame dimensions");
    }
    const featureData = new Float32Array(frame.features.length * KEYXYM_V22_FEATURE_FLOATS);
    frame.features.forEach((feature, index) => featureData.set([
      feature.id, feature.x, feature.y, feature.score, feature.disparity, feature.matchError,
    ], index * KEYXYM_V22_FEATURE_FLOATS));
    const rgb = KeyxymV22Runtime.writeFloats(this.module, frame.rgb);
    const features = KeyxymV22Runtime.writeFloats(this.module, featureData);
    const commitment = KeyxymV22Runtime.writeBytes(this.module, frame.sourceCommitment);
    const pose = this.module._malloc(KEYXYM_V22_POSE_FLOATS * 4);
    try {
      const status = this.module._keyxym_v22_session_ingest_packed(
        this.session,
        frame.timestampNs,
        frame.width,
        frame.height,
        frame.fx,
        frame.fy,
        frame.cx,
        frame.cy,
        frame.scaleMetersPerUnit,
        frame.metricScale ? 1 : 0,
        rgb,
        frame.rgb.length / 3,
        features,
        frame.features.length,
        commitment,
        frame.sourceCommitment.length,
        pose,
        KEYXYM_V22_POSE_FLOATS,
      );
      if (status !== OK) throw new Error(`Keyxym ingest failed (${status})`);
      const offset = pose >>> 2;
      const values = this.module.HEAPF32.slice(offset, offset + KEYXYM_V22_POSE_FLOATS);
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
      this.module._free(rgb);
      this.module._free(features);
      this.module._free(commitment);
      this.module._free(pose);
    }
  }

  geometry(): KeyxymSurfel[] {
    this.assertAlive();
    const required = this.module._malloc(4);
    try {
      let status = this.module._keyxym_v22_session_copy_geometry_packed(this.session, 0, 0, required);
      if (status !== BUFFER_TOO_SMALL && status !== OK) {
        throw new Error(`Keyxym geometry size failed (${status})`);
      }
      const floatCount = new DataView(this.module.HEAPU8.buffer).getUint32(required, true);
      if (!floatCount) return [];
      if (floatCount % KEYXYM_V22_SURFEL_FLOATS !== 0) {
        throw new Error("Keyxym returned malformed packed geometry");
      }
      const output = this.module._malloc(floatCount * 4);
      try {
        status = this.module._keyxym_v22_session_copy_geometry_packed(
          this.session, output, floatCount, required,
        );
        if (status !== OK) throw new Error(`Keyxym geometry copy failed (${status})`);
        const offset = output >>> 2;
        const values = this.module.HEAPF32.slice(offset, offset + floatCount);
        const surfels: KeyxymSurfel[] = [];
        for (let i = 0; i < values.length; i += KEYXYM_V22_SURFEL_FLOATS) {
          surfels.push({
            x: values[i]!, y: values[i + 1]!, z: values[i + 2]!,
            nx: values[i + 3]!, ny: values[i + 4]!, nz: values[i + 5]!,
            r: values[i + 6]!, g: values[i + 7]!, b: values[i + 8]!,
            confidence: values[i + 9]!, uncertainty: values[i + 10]!,
            observations: values[i + 11]!, sourceKeyframe: values[i + 12]!,
          });
        }
        return surfels;
      } finally {
        this.module._free(output);
      }
    } finally {
      this.module._free(required);
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
      return {
        tracking: value[0]!, parallaxDegrees: value[1]!,
        reprojectionErrorPixels: value[2]!, coverage: value[3]!,
        confirmed: value[4]!, uncertain: value[5]!, rejected: value[6]!,
        metricScale: value[7]! === 1,
      };
    } finally {
      this.module._free(output);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.module._keyxym_v22_session_destroy(this.session);
    this.destroyed = true;
  }

  private assertAlive(): void {
    if (this.destroyed) throw new Error("Keyxym session has been destroyed");
  }

  private static writeBytes(module: EmscriptenModule, value: Uint8Array): number {
    const pointer = module._malloc(Math.max(1, value.byteLength));
    if (value.byteLength) module.HEAPU8.set(value, pointer);
    return pointer;
  }

  private static writeFloats(module: EmscriptenModule, value: Float32Array): number {
    const pointer = module._malloc(Math.max(4, value.byteLength));
    if (value.length) module.HEAPF32.set(value, pointer >>> 2);
    return pointer;
  }
}
