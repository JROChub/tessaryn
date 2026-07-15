import { KEYXYM_V26_FORMING_FLOATS, KEYXYM_V26_SURFEL_FLOATS } from "./keyxym-v26-runtime";
import type { KeyxymV26Authority, KeyxymV26Pose, KeyxymV26Quality, KeyxymV26Receipts } from "./keyxym-v26-runtime";
import { KeyxymV26WorkerClient } from "./keyxym-v26-client";
import type { KeyxymV26Manifest } from "./keyxym-v26-provenance";

export const KEYXYM_V26_SURFEL_FLOATS = KEYXYM_V26_SURFEL_FLOATS;

export interface KeyxymFormingSample {
  normalizedX: number; normalizedY: number; flowX: number; flowY: number;
  r: number; g: number; b: number; salience: number; trackSupport: number; age: number;
}

export interface KeyxymSurfel {
  x: number; y: number; z: number; nx: number; ny: number; nz: number;
  r: number; g: number; b: number; confidence: number; uncertainty: number;
  observations: number; sourceKeyframe: number;
}

export interface KeyxymGeometrySnapshot { revision: bigint; surfels: KeyxymSurfel[] }
export type KeyxymPoseEstimate = KeyxymV26Pose;
export type KeyxymQuality = KeyxymV26Quality;
export type KeyxymReceipts = KeyxymV26Receipts;
export type KeyxymAuthorityDecision = KeyxymV26Authority;

export interface KeyxymTheaterFrame {
  pose: KeyxymPoseEstimate;
  quality: KeyxymQuality;
  authority: KeyxymAuthorityDecision;
  receipts: KeyxymReceipts;
  forming: KeyxymFormingSample[];
  geometrySnapshot: KeyxymGeometrySnapshot | null;
  sourceCommitment: Uint8Array;
  processingMs: number;
}

function forming(values: Float32Array): KeyxymFormingSample[] {
  if (values.length % KEYXYM_V26_FORMING_FLOATS !== 0) throw new Error("Malformed Keyxym v0.26 forming field");
  const output: KeyxymFormingSample[] = [];
  for (let index = 0; index < values.length; index += KEYXYM_V26_FORMING_FLOATS) {
    output.push({
      normalizedX: values[index]!, normalizedY: values[index + 1]!, flowX: values[index + 2]!, flowY: values[index + 3]!,
      r: values[index + 4]!, g: values[index + 5]!, b: values[index + 6]!, salience: values[index + 7]!,
      trackSupport: values[index + 8]!, age: values[index + 9]!,
    });
  }
  return output;
}

function surfels(values: Float32Array): KeyxymSurfel[] {
  if (values.length % KEYXYM_V26_SURFEL_FLOATS !== 0) throw new Error("Malformed Keyxym v0.26 geometry");
  const output: KeyxymSurfel[] = [];
  for (let index = 0; index < values.length; index += KEYXYM_V26_SURFEL_FLOATS) {
    output.push({
      x: values[index]!, y: values[index + 1]!, z: values[index + 2]!,
      nx: values[index + 3]!, ny: values[index + 4]!, nz: values[index + 5]!,
      r: values[index + 6]!, g: values[index + 7]!, b: values[index + 8]!,
      confidence: values[index + 9]!, uncertainty: values[index + 10]!,
      observations: values[index + 11]!, sourceKeyframe: values[index + 12]!,
    });
  }
  return output;
}

export class KeyxymV26TheaterRuntime {
  private constructor(private readonly client: KeyxymV26WorkerClient) {}

  static async load(manifest: KeyxymV26Manifest): Promise<KeyxymV26TheaterRuntime> {
    return new KeyxymV26TheaterRuntime(await KeyxymV26WorkerClient.load({
      maximumAnalysisWidth: manifest.maximum_analysis_width,
      maximumAnalysisHeight: manifest.maximum_analysis_height,
      maximumTracks: manifest.maximum_tracks,
      maximumFormingSamples: manifest.maximum_preview_samples,
    }));
  }

  get busy(): boolean { return this.client.busy; }

  async ingest(input: {
    bitmap: ImageBitmap;
    timestampNs: bigint;
    sourceWidth: number;
    sourceHeight: number;
    scaleMetersPerUnit: number;
    metricScale: boolean;
  }): Promise<KeyxymTheaterFrame> {
    const result = await this.client.processFrame(input);
    return {
      pose: result.pose,
      quality: result.quality,
      authority: result.authority,
      receipts: { pose: result.poseReceipt, quality: result.qualityReceipt, authority: result.authorityReceipt },
      forming: forming(result.forming),
      geometrySnapshot: result.geometry ? { revision: BigInt(result.geometryRevision), surfels: surfels(result.geometry) } : null,
      sourceCommitment: result.sourceCommitment,
      processingMs: result.processingMs,
    };
  }

  destroy(): void { this.client.destroy(); }
}
