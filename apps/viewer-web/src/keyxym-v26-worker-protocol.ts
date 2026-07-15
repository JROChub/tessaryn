import type { KeyxymV26Authority, KeyxymV26Pose, KeyxymV26Quality } from "./keyxym-v26-runtime";

export interface KeyxymV26WorkerOptions {
  maximumAnalysisWidth: number;
  maximumAnalysisHeight: number;
  maximumTracks: number;
  maximumFormingSamples: number;
}

export type KeyxymV26WorkerRequest =
  | { type: "initialize"; options: KeyxymV26WorkerOptions }
  | {
      type: "frame";
      id: number;
      bitmap: ImageBitmap;
      timestampNs: string;
      sourceWidth: number;
      sourceHeight: number;
      scaleMetersPerUnit: number;
      metricScale: boolean;
    }
  | { type: "destroy" };

export interface KeyxymV26WorkerFrameResult {
  type: "frame";
  id: number;
  pose: KeyxymV26Pose;
  quality: KeyxymV26Quality;
  authority: KeyxymV26Authority;
  forming: Float32Array;
  geometry: Float32Array | null;
  geometryRevision: string;
  poseReceipt: Uint8Array;
  qualityReceipt: Uint8Array;
  authorityReceipt: Uint8Array;
  sourceCommitment: Uint8Array;
  processingMs: number;
  width: number;
  height: number;
}

export type KeyxymV26WorkerResponse =
  | { type: "ready" }
  | KeyxymV26WorkerFrameResult
  | { type: "error"; id?: number; message: string };
