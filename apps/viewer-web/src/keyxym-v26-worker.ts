/// <reference lib="webworker" />

import { KeyxymV26Runtime } from "./keyxym-v26-runtime";
import type {
  KeyxymV26WorkerRequest,
  KeyxymV26WorkerResponse,
} from "./keyxym-v26-worker-protocol";

const scope = self as DedicatedWorkerGlobalScope;
let runtime: KeyxymV26Runtime | null = null;
let canvas: OffscreenCanvas | null = null;
let context: OffscreenCanvasRenderingContext2D | null = null;
let maximumWidth = 320;
let maximumHeight = 240;

function post(message: KeyxymV26WorkerResponse, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer);
}

function failure(error: unknown, id?: number): void {
  post({ type: "error", id, message: error instanceof Error ? error.message : String(error) });
}

async function initialize(request: Extract<KeyxymV26WorkerRequest, { type: "initialize" }>): Promise<void> {
  maximumWidth = request.options.maximumAnalysisWidth;
  maximumHeight = request.options.maximumAnalysisHeight;
  runtime = await KeyxymV26Runtime.load({
    moduleUrl: request.options.moduleUrl,
    wasmUrl: request.options.wasmUrl,
    branch: "main/world-cell-theater-v026",
    maximumAnalysisWidth: maximumWidth,
    maximumAnalysisHeight: maximumHeight,
    maximumTracks: request.options.maximumTracks,
    maximumFormingSamples: request.options.maximumFormingSamples,
  });
  canvas = new OffscreenCanvas(maximumWidth, maximumHeight);
  context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Keyxym worker could not create its capture context");
  post({ type: "ready" });
}

async function processFrame(request: Extract<KeyxymV26WorkerRequest, { type: "frame" }>): Promise<void> {
  const started = performance.now();
  if (!runtime || !canvas || !context) throw new Error("Keyxym worker is not initialized");
  if (request.metricScale !== (request.spatial !== undefined)) {
    throw new Error("Metric authority requires a synchronized calibrated depth and spatial-pose frame");
  }
  const scale = Math.min(1, maximumWidth / request.sourceWidth, maximumHeight / request.sourceHeight);
  const width = Math.max(16, Math.floor(request.sourceWidth * scale));
  const height = Math.max(16, Math.floor(request.sourceHeight * scale));
  canvas.width = width;
  canvas.height = height;
  try {
    context.drawImage(request.bitmap, 0, 0, width, height);
  } finally {
    request.bitmap.close();
  }
  const image = context.getImageData(0, 0, width, height);
  const rgba = new Uint8Array(image.data.buffer.slice(0));
  const supplied = request.intrinsics;
  const suppliedValid = supplied !== undefined &&
    [supplied.width, supplied.height, supplied.fx, supplied.fy, supplied.cx, supplied.cy].every(Number.isFinite) &&
    supplied.width > 0 && supplied.height > 0 && supplied.fx > 0 && supplied.fy > 0;
  const scaleX = suppliedValid ? width / supplied.width : 1;
  const scaleY = suppliedValid ? height / supplied.height : 1;
  const focal = width / (2 * Math.tan(Math.PI / 6));
  let spatial: {
    depthMeters: Float32Array;
    worldFromCamera: Float32Array;
    calibrationReceipt: Uint8Array;
  } | undefined;
  if (request.spatial) {
    const source = request.spatial;
    const sourcePixels = source.width * source.height;
    if (!suppliedValid || supplied!.width !== source.width || supplied!.height !== source.height ||
        !Number.isSafeInteger(sourcePixels) || sourcePixels <= 0 ||
        source.depthMeters.length !== sourcePixels || source.worldFromCamera.length !== 16 ||
        source.calibrationReceipt.byteLength !== 32 ||
        !source.depthMeters.every((depth) => Number.isFinite(depth) && depth >= 0) ||
        !source.worldFromCamera.every(Number.isFinite)) {
      throw new Error("Verified spatial frame is not aligned with its calibration");
    }
    const depthMeters = new Float32Array(width * height);
    for (let y = 0; y < height; y += 1) {
      const sourceY = Math.min(source.height - 1, Math.floor(y * source.height / height));
      for (let x = 0; x < width; x += 1) {
        const sourceX = Math.min(source.width - 1, Math.floor(x * source.width / width));
        depthMeters[y * width + x] = source.depthMeters[sourceY * source.width + sourceX]!;
      }
    }
    spatial = {
      depthMeters,
      worldFromCamera: source.worldFromCamera,
      calibrationReceipt: source.calibrationReceipt,
    };
  }
  const commitmentBytes = spatial
    ? new Uint8Array(rgba.byteLength + spatial.depthMeters.byteLength +
      spatial.worldFromCamera.byteLength + spatial.calibrationReceipt.byteLength)
    : rgba;
  if (spatial) {
    let offset = 0;
    commitmentBytes.set(rgba, offset); offset += rgba.byteLength;
    commitmentBytes.set(new Uint8Array(spatial.depthMeters.buffer,
      spatial.depthMeters.byteOffset, spatial.depthMeters.byteLength), offset);
    offset += spatial.depthMeters.byteLength;
    commitmentBytes.set(new Uint8Array(spatial.worldFromCamera.buffer,
      spatial.worldFromCamera.byteOffset, spatial.worldFromCamera.byteLength), offset);
    offset += spatial.worldFromCamera.byteLength;
    commitmentBytes.set(spatial.calibrationReceipt, offset);
  }
  const sourceCommitment = new Uint8Array(await crypto.subtle.digest("SHA-256", commitmentBytes));
  const snapshot = runtime.ingest({
    timestampNs: BigInt(request.timestampNs),
    width,
    height,
    fx: suppliedValid ? supplied.fx * scaleX : focal,
    fy: suppliedValid ? supplied.fy * scaleY : focal,
    cx: suppliedValid ? supplied.cx * scaleX : width / 2,
    cy: suppliedValid ? supplied.cy * scaleY : height / 2,
    scaleMetersPerUnit: spatial ? 1 : request.scaleMetersPerUnit,
    metricScale: spatial !== undefined,
    rgba,
    sourceCommitment,
    spatial,
  });
  const transfer: Transferable[] = [
    snapshot.pose.worldFromCamera.buffer,
    snapshot.forming.buffer,
    snapshot.receipts.pose.buffer,
    snapshot.receipts.quality.buffer,
    snapshot.receipts.authority.buffer,
    sourceCommitment.buffer,
  ];
  if (snapshot.geometry) transfer.push(snapshot.geometry.buffer);
  if (snapshot.surface) transfer.push(snapshot.surface.buffer);
  post({
    type: "frame",
    id: request.id,
    pose: snapshot.pose,
    quality: snapshot.quality,
    authority: snapshot.authority,
    forming: snapshot.forming,
    geometry: snapshot.geometry,
    surface: snapshot.surface,
    geometryRevision: snapshot.geometryRevision.toString(),
    poseReceipt: snapshot.receipts.pose,
    qualityReceipt: snapshot.receipts.quality,
    authorityReceipt: snapshot.receipts.authority,
    sourceCommitment,
    processingMs: performance.now() - started,
    width,
    height,
  }, transfer);
}

scope.onmessage = (event: MessageEvent<KeyxymV26WorkerRequest>) => {
  const request = event.data;
  if (request.type === "initialize") {
    void initialize(request).catch((error) => failure(error));
    return;
  }
  if (request.type === "frame") {
    void processFrame(request).catch((error) => failure(error, request.id));
    return;
  }
  runtime?.destroy();
  runtime = null;
  scope.close();
};
