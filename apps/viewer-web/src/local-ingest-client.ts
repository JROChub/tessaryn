import {
  calculateLocalFileIdentity,
  type LocalFileIdentity,
  type LocalFileProgress,
} from "./local-file-identity";

interface Pending {
  file: File;
  resolve: (identity: LocalFileIdentity) => void;
  reject: (reason: Error) => void;
  onProgress: (progress: LocalFileProgress) => void;
  cancelled: boolean;
}

interface WorkerResponse {
  kind: "progress" | "complete" | "error";
  id: number;
  progress?: LocalFileProgress;
  identity?: LocalFileIdentity;
  error?: string;
}

export interface LocalIngestTask {
  result: Promise<LocalFileIdentity>;
  cancel: () => void;
}

let worker: Worker | null = null;
let sequence = 0;
const pending = new Map<number, Pending>();

export function indexLocalFileOffThread(
  file: File,
  onProgress: (progress: LocalFileProgress) => void,
): LocalIngestTask {
  const id = ++sequence;
  let cancelled = false;

  if (typeof Worker === "undefined") {
    return {
      result: calculateLocalFileIdentity(file, onProgress, () => cancelled),
      cancel: () => {
        cancelled = true;
      },
    };
  }

  const active = getWorker();
  let request: Pending;
  const result = new Promise<LocalFileIdentity>((resolve, reject) => {
    request = { file, resolve, reject, onProgress, cancelled: false };
    pending.set(id, request);
    active.postMessage({ kind: "index", id, file });
  });

  return {
    result,
    cancel: () => {
      if (request.cancelled) return;
      request.cancelled = true;
      pending.delete(id);
      if (worker === active) active.postMessage({ kind: "cancel", id });
      request.reject(new DOMException("local file indexing cancelled", "AbortError"));
    },
  };
}

export function destroyLocalIngestWorker(): void {
  worker?.terminate();
  worker = null;
  for (const request of pending.values()) {
    request.cancelled = true;
    request.reject(new Error("local file indexing worker terminated"));
  }
  pending.clear();
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./local-ingest-worker.ts", import.meta.url), {
    type: "module",
    name: "tessaryn-local-file-indexer",
  });
  worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
    const request = pending.get(event.data.id);
    if (!request || request.cancelled) return;
    if (event.data.kind === "progress" && event.data.progress) {
      request.onProgress(event.data.progress);
      return;
    }
    pending.delete(event.data.id);
    if (event.data.kind === "complete" && event.data.identity) {
      request.resolve(event.data.identity);
    } else {
      request.reject(new Error(event.data.error ?? "local file indexing failed"));
    }
  });
  worker.addEventListener("error", (event) => {
    event.preventDefault();
    const requests = [...pending.values()];
    pending.clear();
    worker?.terminate();
    worker = null;
    for (const request of requests) {
      if (request.cancelled) continue;
      void calculateLocalFileIdentity(
        request.file,
        request.onProgress,
        () => request.cancelled,
      ).then(request.resolve, (error: unknown) => {
        request.reject(error instanceof Error ? error : new Error(String(error)));
      });
    }
  });
  return worker;
}
