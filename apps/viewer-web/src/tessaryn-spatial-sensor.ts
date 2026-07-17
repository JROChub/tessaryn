import { digestValue } from "./world-cell-assurance";

export const TESSARYN_SPATIAL_CALIBRATION_SCHEMA = "tessaryn/spatial-calibration/v1" as const;

export interface TessarynSpatialIntrinsics {
  width: number;
  height: number;
  fx: number;
  fy: number;
  cx: number;
  cy: number;
}

export interface TessarynSpatialCalibration {
  schema: typeof TESSARYN_SPATIAL_CALIBRATION_SCHEMA;
  verified: true;
  device: string;
  receipt: string;
  depthUnit: "meters-f32";
  poseConvention: "row-major-world-from-camera";
  synchronizedColorDepth: true;
  intrinsics: TessarynSpatialIntrinsics;
}

export interface TessarynSpatialFrame {
  timestampNs: string;
  colorMediaTimeSeconds: number;
  presentedFrames: number;
  width: number;
  height: number;
  depthMeters: Float32Array;
  worldFromCamera: Float32Array;
}

export interface TessarynSpatialSensor {
  currentCalibration(): Promise<TessarynSpatialCalibration>;
  captureFrame(request: {
    timestampNs: string;
    colorMediaTimeSeconds: number;
    presentedFrames: number;
    colorWidth: number;
    colorHeight: number;
  }): Promise<TessarynSpatialFrame>;
}

declare global {
  interface Window {
    /** Installed by a trusted RGB-D, stereo, LiDAR, or spatial-computing host adapter. */
    tessarynSpatialSensor?: TessarynSpatialSensor;
  }
}

const DIGEST = /^[0-9a-f]{64}$/u;
const finite = (value: number): boolean => Number.isFinite(value);

export function spatialCalibrationReceipt(calibration: Omit<TessarynSpatialCalibration, "receipt" | "verified">): string {
  return digestValue({
    schema: calibration.schema,
    device: calibration.device,
    depthUnit: calibration.depthUnit,
    poseConvention: calibration.poseConvention,
    synchronizedColorDepth: calibration.synchronizedColorDepth,
    intrinsics: calibration.intrinsics,
  });
}

export function isValidSpatialCalibration(value: unknown): value is TessarynSpatialCalibration {
  if (!value || typeof value !== "object") return false;
  const calibration = value as Partial<TessarynSpatialCalibration>;
  const intrinsics = calibration.intrinsics;
  if (calibration.schema !== TESSARYN_SPATIAL_CALIBRATION_SCHEMA || calibration.verified !== true ||
      calibration.depthUnit !== "meters-f32" ||
      calibration.poseConvention !== "row-major-world-from-camera" ||
      calibration.synchronizedColorDepth !== true || typeof calibration.device !== "string" ||
      calibration.device.trim().length < 1 || calibration.device.length > 128 ||
      typeof calibration.receipt !== "string" || !DIGEST.test(calibration.receipt) ||
      calibration.receipt === "0".repeat(64) || !intrinsics) return false;
  const { width, height, fx, fy, cx, cy } = intrinsics;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 16 || height < 16 ||
      width > 8_192 || height > 8_192 || width * height > 33_554_432 ||
      ![fx, fy, cx, cy].every(finite) || fx <= 0 || fy <= 0 ||
      cx < -0.5 || cx > width - 0.5 || cy < -0.5 || cy > height - 0.5) return false;
  return calibration.receipt === spatialCalibrationReceipt({
    schema: calibration.schema,
    device: calibration.device,
    depthUnit: calibration.depthUnit,
    poseConvention: calibration.poseConvention,
    synchronizedColorDepth: calibration.synchronizedColorDepth,
    intrinsics,
  });
}

export function assertValidSpatialFrame(
  frame: TessarynSpatialFrame,
  calibration: TessarynSpatialCalibration,
  request: { timestampNs: string; colorMediaTimeSeconds: number; presentedFrames: number },
): void {
  if (!frame || frame.timestampNs !== request.timestampNs ||
      frame.colorMediaTimeSeconds !== request.colorMediaTimeSeconds ||
      frame.presentedFrames !== request.presentedFrames ||
      frame.width !== calibration.intrinsics.width || frame.height !== calibration.intrinsics.height ||
      !(frame.depthMeters instanceof Float32Array) ||
      frame.depthMeters.length !== frame.width * frame.height ||
      !(frame.worldFromCamera instanceof Float32Array) || frame.worldFromCamera.length !== 16 ||
      !frame.depthMeters.every((depth) => finite(depth) && depth >= 0) ||
      !frame.worldFromCamera.every(finite)) {
    throw new Error("Spatial adapter returned an unsynchronized, non-finite, or misaligned frame");
  }
}
