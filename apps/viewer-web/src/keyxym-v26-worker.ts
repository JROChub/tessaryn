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
  const sourceCommitment = new Uint8Array(await crypto.subtle.digest("SHA-256", rgba));
  const supplied = request.intrinsics;
  const suppliedValid = supplied !== undefined &&
    [supplied.width, supplied.height, supplied.fx, supplied.fy, supplied.cx, supplied.cy].every(Number.isFinite) &&
    supplied.width > 0 && supplied.height > 0 && supplied.fx > 0 && supplied.fy > 0;
  const scaleX = suppliedValid ? width / supplied.width : 1;
  const scaleY = suppliedValid ? height / supplied.height : 1;
  const focal = width / (2 * Math.tan(Math.PI / 6));
  const snapshot = runtime.ingest({
    timestampNs: BigInt(request.timestampNs),
    width,
    height,
    fx: suppliedValid ? supplied.fx * scaleX : focal,
    fy: suppliedValid ? supplied.fy * scaleY : focal,
    cx: suppliedValid ? supplied.cx * scaleX : width / 2,
    cy: suppliedValid ? supplied.cy * scaleY : height / 2,
    scaleMetersPerUnit: request.scaleMetersPerUnit,
    metricScale: request.metricScale,
    rgba,
    sourceCommitment,
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
  post({
    type: "frame",
    id: request.id,
    pose: snapshot.pose,
    quality: snapshot.quality,
    authority: snapshot.authority,
    forming: snapshot.forming,
    geometry: snapshot.geometry,
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
