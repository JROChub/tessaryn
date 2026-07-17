import type {
  KeyxymV26WorkerFrameResult,
  KeyxymV26WorkerOptions,
  KeyxymV26WorkerRequest,
  KeyxymV26WorkerResponse,
} from "./keyxym-v26-worker-protocol";

export class KeyxymV26WorkerClient {
  private readonly worker = new Worker(new URL("./keyxym-v26-worker.ts", import.meta.url), { type: "module" });
  private readyResolve!: () => void;
  private readyReject!: (error: Error) => void;
  private readonly ready = new Promise<void>((resolve, reject) => {
    this.readyResolve = resolve;
    this.readyReject = reject;
  });
  private nextId = 1;
  private pending: {
    id: number;
    resolve: (value: KeyxymV26WorkerFrameResult) => void;
    reject: (error: Error) => void;
  } | null = null;
  private destroyed = false;

  private constructor(options: KeyxymV26WorkerOptions) {
    this.worker.onmessage = (event: MessageEvent<KeyxymV26WorkerResponse>) => this.onMessage(event.data);
    this.worker.onerror = (event) => {
      const error = new Error(event.message || "Keyxym worker failed");
      this.readyReject(error);
      this.pending?.reject(error);
      this.pending = null;
    };
    const request: KeyxymV26WorkerRequest = { type: "initialize", options };
    this.worker.postMessage(request);
  }

  static async load(options: KeyxymV26WorkerOptions): Promise<KeyxymV26WorkerClient> {
    const client = new KeyxymV26WorkerClient(options);
    await client.ready;
    return client;
  }

  get busy(): boolean { return this.pending !== null; }

  async processFrame(input: {
    bitmap: ImageBitmap;
    timestampNs: bigint;
    sourceWidth: number;
    sourceHeight: number;
    scaleMetersPerUnit: number;
    metricScale: boolean;
    intrinsics?: { width: number; height: number; fx: number; fy: number; cx: number; cy: number };
    spatial?: {
      width: number;
      height: number;
      depthMeters: Float32Array;
      worldFromCamera: Float32Array;
      calibrationReceipt: Uint8Array;
    };
  }): Promise<KeyxymV26WorkerFrameResult> {
    if (this.destroyed) {
      input.bitmap.close();
      throw new Error("Keyxym worker client is destroyed");
    }
    if (this.pending) {
      input.bitmap.close();
      throw new Error("Keyxym worker frame already in flight");
    }
    const id = this.nextId++;
    const promise = new Promise<KeyxymV26WorkerFrameResult>((resolve, reject) => {
      this.pending = { id, resolve, reject };
    });
    const request: KeyxymV26WorkerRequest = {
      type: "frame",
      id,
      bitmap: input.bitmap,
      timestampNs: input.timestampNs.toString(),
      sourceWidth: input.sourceWidth,
      sourceHeight: input.sourceHeight,
      scaleMetersPerUnit: input.scaleMetersPerUnit,
      metricScale: input.metricScale,
      intrinsics: input.intrinsics,
      spatial: input.spatial,
    };
    const transfer: Transferable[] = [input.bitmap];
    if (input.spatial) {
      for (const buffer of [input.spatial.depthMeters.buffer, input.spatial.worldFromCamera.buffer,
        input.spatial.calibrationReceipt.buffer]) {
        if (!transfer.includes(buffer as Transferable)) transfer.push(buffer as Transferable);
      }
    }
    this.worker.postMessage(request, transfer);
    return promise;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.pending?.reject(new Error("Keyxym worker client was destroyed"));
    this.pending = null;
    const request: KeyxymV26WorkerRequest = { type: "destroy" };
    this.worker.postMessage(request);
    this.worker.terminate();
  }

  private onMessage(message: KeyxymV26WorkerResponse): void {
    if (message.type === "ready") {
      this.readyResolve();
      return;
    }
    if (message.type === "error") {
      const error = new Error(message.message);
      if (message.id !== undefined && this.pending?.id === message.id) {
        this.pending.reject(error);
        this.pending = null;
      } else {
        this.readyReject(error);
      }
      return;
    }
    if (!this.pending || this.pending.id !== message.id) return;
    this.pending.resolve(message);
    this.pending = null;
  }
}
