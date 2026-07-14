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

type WasmExports = {
  memory: WebAssembly.Memory;
  malloc(size: number): number;
  free(pointer: number): void;
  keyxym_v22_session_create(branch: number, voxel: number, maximum: number, output: number): number;
  keyxym_v22_session_destroy(session: number): void;
  keyxym_v22_session_ingest_packed(...args: number[]): number;
  keyxym_v22_session_copy_geometry_packed(session: number, output: number, capacity: number, required: number): number;
  keyxym_v22_session_quality_packed(session: number, output: number, count: number): number;
};

const OK = 0;
const BUFFER_TOO_SMALL = 2;
const encoder = new TextEncoder();

export class KeyxymV22Runtime {
  private constructor(private readonly wasm: WasmExports, private readonly session: number) {}

  static async load(url = "/keyxym/keyxym-v22.wasm"): Promise<KeyxymV22Runtime> {
    const response = await fetch(url, { cache: "no-store", integrity: "" });
    if (!response.ok) throw new Error(`Keyxym v0.22 runtime unavailable (${response.status})`);
    const imports = { env: { abort: () => { throw new Error("Keyxym WASM aborted"); } } };
    const result = await WebAssembly.instantiateStreaming(response, imports);
    const wasm = result.instance.exports as unknown as WasmExports;
    for (const name of ["memory", "malloc", "free", "keyxym_v22_session_create", "keyxym_v22_session_ingest_packed", "keyxym_v22_session_copy_geometry_packed", "keyxym_v22_session_quality_packed"]) {
      if (!(name in wasm)) throw new Error(`Keyxym v0.22 ABI missing ${name}`);
    }
    const branch = KeyxymV22Runtime.writeBytes(wasm, encoder.encode("agent/v022-metric-world-cell\0"));
    const output = wasm.malloc(4);
    try {
      const status = wasm.keyxym_v22_session_create(branch.pointer, 0.018, 48_000, output);
      if (status !== OK) throw new Error(`Keyxym session create failed (${status})`);
      const session = new DataView(wasm.memory.buffer).getUint32(output, true);
      if (!session) throw new Error("Keyxym returned a null session");
      return new KeyxymV22Runtime(wasm, session);
    } finally {
      wasm.free(branch.pointer);
      wasm.free(output);
    }
  }

  ingest(frame: KeyxymFrame): KeyxymPoseEstimate {
    const featureData = new Float32Array(frame.features.length * KEYXYM_V22_FEATURE_FLOATS);
    frame.features.forEach((feature, index) => featureData.set([
      feature.id, feature.x, feature.y, feature.score, feature.disparity, feature.matchError,
    ], index * KEYXYM_V22_FEATURE_FLOATS));
    const rgb = KeyxymV22Runtime.writeFloats(this.wasm, frame.rgb);
    const features = KeyxymV22Runtime.writeFloats(this.wasm, featureData);
    const commitment = KeyxymV22Runtime.writeBytes(this.wasm, frame.sourceCommitment);
    const pose = this.wasm.malloc(KEYXYM_V22_POSE_FLOATS * 4);
    try {
      const status = this.wasm.keyxym_v22_session_ingest_packed(
        this.session, Number(frame.timestampNs), frame.width, frame.height,
        frame.fx, frame.fy, frame.cx, frame.cy, frame.scaleMetersPerUnit,
        frame.metricScale ? 1 : 0, rgb.pointer, frame.rgb.length / 3,
        features.pointer, frame.features.length, commitment.pointer,
        frame.sourceCommitment.length, pose, KEYXYM_V22_POSE_FLOATS,
      );
      if (status !== OK) throw new Error(`Keyxym ingest failed (${status})`);
      const values = new Float32Array(this.wasm.memory.buffer, pose, KEYXYM_V22_POSE_FLOATS).slice();
      return {
        worldFromCamera: values.slice(0, 16), matches: values[16]!, inliers: values[17]!,
        tracking: values[18]!, parallaxDegrees: values[19]!,
        reprojectionErrorPixels: values[20]!, recovered: values[21]! === 1,
      };
    } finally {
      this.wasm.free(rgb.pointer); this.wasm.free(features.pointer);
      this.wasm.free(commitment.pointer); this.wasm.free(pose);
    }
  }

  geometry(): KeyxymSurfel[] {
    const required = this.wasm.malloc(4);
    try {
      let status = this.wasm.keyxym_v22_session_copy_geometry_packed(this.session, 0, 0, required);
      if (status !== BUFFER_TOO_SMALL && status !== OK) throw new Error(`Keyxym geometry size failed (${status})`);
      const count = new DataView(this.wasm.memory.buffer).getUint32(required, true);
      if (!count) return [];
      const output = this.wasm.malloc(count * 4);
      try {
        status = this.wasm.keyxym_v22_session_copy_geometry_packed(this.session, output, count, required);
        if (status !== OK) throw new Error(`Keyxym geometry copy failed (${status})`);
        const values = new Float32Array(this.wasm.memory.buffer, output, count);
        const surfels: KeyxymSurfel[] = [];
        for (let i = 0; i < values.length; i += KEYXYM_V22_SURFEL_FLOATS) surfels.push({
          x: values[i]!, y: values[i + 1]!, z: values[i + 2]!, nx: values[i + 3]!, ny: values[i + 4]!, nz: values[i + 5]!,
          r: values[i + 6]!, g: values[i + 7]!, b: values[i + 8]!, confidence: values[i + 9]!, uncertainty: values[i + 10]!,
          observations: values[i + 11]!, sourceKeyframe: values[i + 12]!,
        });
        return surfels;
      } finally { this.wasm.free(output); }
    } finally { this.wasm.free(required); }
  }

  quality(): KeyxymQuality {
    const output = this.wasm.malloc(KEYXYM_V22_QUALITY_FLOATS * 4);
    try {
      const status = this.wasm.keyxym_v22_session_quality_packed(this.session, output, KEYXYM_V22_QUALITY_FLOATS);
      if (status !== OK) throw new Error(`Keyxym quality failed (${status})`);
      const value = new Float32Array(this.wasm.memory.buffer, output, KEYXYM_V22_QUALITY_FLOATS);
      return { tracking: value[0]!, parallaxDegrees: value[1]!, reprojectionErrorPixels: value[2]!, coverage: value[3]!, confirmed: value[4]!, uncertain: value[5]!, rejected: value[6]!, metricScale: value[7]! === 1 };
    } finally { this.wasm.free(output); }
  }

  destroy(): void { this.wasm.keyxym_v22_session_destroy(this.session); }

  private static writeBytes(wasm: WasmExports, value: Uint8Array) {
    const pointer = wasm.malloc(Math.max(1, value.byteLength));
    new Uint8Array(wasm.memory.buffer, pointer, value.byteLength).set(value);
    return { pointer };
  }
  private static writeFloats(wasm: WasmExports, value: Float32Array) {
    const pointer = wasm.malloc(Math.max(4, value.byteLength));
    new Float32Array(wasm.memory.buffer, pointer, value.length).set(value);
    return { pointer };
  }
}
