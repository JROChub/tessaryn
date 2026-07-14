export interface KeyxymMetricPoint {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  r: number;
  g: number;
  b: number;
  confidence: number;
  uncertainty: number;
  observations: number;
  firstSeenNs: bigint;
  lastSeenNs: bigint;
  sourceKeyframe: number;
}

export interface KeyxymPoseResult {
  matrix: number[];
  matches: number;
  inliers: number;
  tracking: number;
  parallaxDegrees: number;
  reprojectionErrorPixels: number;
  recovered: boolean;
  receipt: string;
}

export interface KeyxymQualityResult {
  tracking: number;
  parallaxDegrees: number;
  reprojectionErrorPixels: number;
  coverage: number;
  confirmed: bigint;
  uncertain: bigint;
  rejected: bigint;
  metricScale: boolean;
  receipt: string;
}

export interface KeyxymFrameResult {
  pose: KeyxymPoseResult;
  quality: KeyxymQualityResult;
  geometry: KeyxymMetricPoint[];
  elapsedMs: number;
}

interface EmscriptenModule {
  HEAPU8: Uint8Array;
  _malloc(size: number): number;
  _free(pointer: number): void;
  _keyxym_v22_session_create(
    branch: number,
    voxelSize: number,
    maximumSurfels: number,
    output: number,
  ): number;
  _keyxym_v22_session_destroy(session: number): void;
  _keyxym_v22_browser_forget_session(session: number): void;
  _keyxym_v22_session_ingest_rgba(session: number, frame: number, pose: number): number;
  _keyxym_v22_session_geometry_count(session: number): number;
  _keyxym_v22_session_copy_geometry(
    session: number,
    output: number,
    capacity: number,
    required: number,
  ): number;
  _keyxym_v22_session_quality(session: number, output: number): number;
}

type KeyxymFactory = (options?: {
  locateFile?: (file: string) => string;
}) => Promise<EmscriptenModule>;

const OK = 0;
const FRAME_SIZE = 48;
const POSE_SIZE = 120;
const SURFEL_SIZE = 72;
const QUALITY_SIZE = 80;

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function view(module: EmscriptenModule): DataView {
  return new DataView(module.HEAPU8.buffer);
}

function writeCString(module: EmscriptenModule, text: string): number {
  const encoded = new TextEncoder().encode(`${text}\0`);
  const pointer = module._malloc(encoded.length);
  module.HEAPU8.set(encoded, pointer);
  return pointer;
}

export class KeyxymV22Runtime {
  private constructor(
    private readonly module: EmscriptenModule,
    private readonly session: number,
  ) {}

  static async load(): Promise<KeyxymV22Runtime> {
    const moduleUrl = new URL("../runtime/keyxym-v22.js", import.meta.url).href;
    const wasmUrl = new URL("../runtime/keyxym-v22.wasm", import.meta.url).href;
    const imported = await import(/* @vite-ignore */ moduleUrl) as { default: KeyxymFactory };
    const module = await imported.default({
      locateFile: (file) => file.endsWith(".wasm") ? wasmUrl : file,
    });
    const branch = writeCString(module, "tessaryn/browser/main");
    const output = module._malloc(4);
    try {
      const status = module._keyxym_v22_session_create(branch, 0.02, 180_000, output);
      if (status !== OK) throw new Error(`Keyxym session creation failed (${status})`);
      const session = view(module).getUint32(output, true);
      if (session === 0) throw new Error("Keyxym returned a null session");
      return new KeyxymV22Runtime(module, session);
    } finally {
      module._free(branch);
      module._free(output);
    }
  }

  ingest(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    timestampNs: bigint,
    metricScale = false,
  ): KeyxymFrameResult {
    const started = performance.now();
    const rgbaPointer = this.module._malloc(rgba.byteLength);
    const framePointer = this.module._malloc(FRAME_SIZE);
    const posePointer = this.module._malloc(POSE_SIZE);
    try {
      this.module.HEAPU8.set(rgba, rgbaPointer);
      const data = view(this.module);
      data.setBigInt64(framePointer, timestampNs, true);
      data.setUint32(framePointer + 8, width, true);
      data.setUint32(framePointer + 12, height, true);
      const focal = Math.max(width, height) * 0.9;
      data.setFloat32(framePointer + 16, focal, true);
      data.setFloat32(framePointer + 20, focal, true);
      data.setFloat32(framePointer + 24, width / 2, true);
      data.setFloat32(framePointer + 28, height / 2, true);
      data.setFloat32(framePointer + 32, 1, true);
      data.setUint8(framePointer + 36, metricScale ? 1 : 0);
      data.setUint32(framePointer + 40, rgbaPointer, true);
      data.setUint32(framePointer + 44, rgba.byteLength, true);

      const status = this.module._keyxym_v22_session_ingest_rgba(
        this.session,
        framePointer,
        posePointer,
      );
      if (status !== OK) throw new Error(`Keyxym frame ingestion failed (${status})`);

      return {
        pose: this.readPose(posePointer),
        quality: this.readQuality(),
        geometry: this.readGeometry(),
        elapsedMs: performance.now() - started,
      };
    } finally {
      this.module._free(rgbaPointer);
      this.module._free(framePointer);
      this.module._free(posePointer);
    }
  }

  dispose(): void {
    this.module._keyxym_v22_browser_forget_session(this.session);
    this.module._keyxym_v22_session_destroy(this.session);
  }

  private readPose(pointer: number): KeyxymPoseResult {
    const data = view(this.module);
    const matrix = Array.from({ length: 16 }, (_, index) =>
      data.getFloat32(pointer + index * 4, true));
    return {
      matrix,
      matches: data.getUint32(pointer + 64, true),
      inliers: data.getUint32(pointer + 68, true),
      tracking: data.getFloat32(pointer + 72, true),
      parallaxDegrees: data.getFloat32(pointer + 76, true),
      reprojectionErrorPixels: data.getFloat32(pointer + 80, true),
      recovered: data.getUint8(pointer + 84) !== 0,
      receipt: hex(this.module.HEAPU8.slice(pointer + 85, pointer + 117)),
    };
  }

  private readQuality(): KeyxymQualityResult {
    const pointer = this.module._malloc(QUALITY_SIZE);
    try {
      const status = this.module._keyxym_v22_session_quality(this.session, pointer);
      if (status !== OK) throw new Error(`Keyxym quality read failed (${status})`);
      const data = view(this.module);
      return {
        tracking: data.getFloat32(pointer, true),
        parallaxDegrees: data.getFloat32(pointer + 4, true),
        reprojectionErrorPixels: data.getFloat32(pointer + 8, true),
        coverage: data.getFloat32(pointer + 12, true),
        confirmed: data.getBigUint64(pointer + 16, true),
        uncertain: data.getBigUint64(pointer + 24, true),
        rejected: data.getBigUint64(pointer + 32, true),
        metricScale: data.getUint8(pointer + 40) !== 0,
        receipt: hex(this.module.HEAPU8.slice(pointer + 41, pointer + 73)),
      };
    } finally {
      this.module._free(pointer);
    }
  }

  private readGeometry(): KeyxymMetricPoint[] {
    const count = this.module._keyxym_v22_session_geometry_count(this.session);
    if (count === 0) return [];
    const output = this.module._malloc(count * SURFEL_SIZE);
    const required = this.module._malloc(4);
    try {
      const status = this.module._keyxym_v22_session_copy_geometry(
        this.session,
        output,
        count,
        required,
      );
      if (status !== OK) throw new Error(`Keyxym geometry read failed (${status})`);
      const data = view(this.module);
      return Array.from({ length: count }, (_, index) => {
        const pointer = output + index * SURFEL_SIZE;
        return {
          x: data.getFloat32(pointer, true),
          y: data.getFloat32(pointer + 4, true),
          z: data.getFloat32(pointer + 8, true),
          nx: data.getFloat32(pointer + 12, true),
          ny: data.getFloat32(pointer + 16, true),
          nz: data.getFloat32(pointer + 20, true),
          r: data.getFloat32(pointer + 24, true),
          g: data.getFloat32(pointer + 28, true),
          b: data.getFloat32(pointer + 32, true),
          confidence: data.getFloat32(pointer + 36, true),
          uncertainty: data.getFloat32(pointer + 40, true),
          observations: data.getUint32(pointer + 44, true),
          firstSeenNs: data.getBigUint64(pointer + 48, true),
          lastSeenNs: data.getBigUint64(pointer + 56, true),
          sourceKeyframe: data.getUint32(pointer + 64, true),
        };
      });
    } finally {
      this.module._free(output);
      this.module._free(required);
    }
  }
}
