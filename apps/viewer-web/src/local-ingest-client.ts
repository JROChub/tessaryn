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
/**
 * Silence budget for the indexer worker. A healthy worker posts progress
 * at least every few hundred milliseconds while it has chunks to hash, so
 * three seconds without any message means the worker never started, its
 * script fetch stalled, or its thread is stuck. The request then falls
 * back to the main thread instead of hanging forever: a stalled worker
 * must never leave a local import at 0% with no way forward.
 */
const WATCHDOG_MS = 3_000;
const watchdogs = new Map<number, ReturnType<typeof setTimeout>>();

function armWatchdog(id: number): void {
  clearWatchdog(id);
  watchdogs.set(
    id,
    setTimeout(() => {
      watchdogs.delete(id);
      if (!pending.has(id)) return;
      fallbackAllToMainThread();
    }, WATCHDOG_MS),
  );
}

function clearWatchdog(id: number): void {
  const timer = watchdogs.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    watchdogs.delete(id);
  }
}

/** Run every pending indexing request on the main thread and drop the worker. */
function fallbackAllToMainThread(): void {
  const requests = [...pending.values()];
  pending.clear();
  for (const id of [...watchdogs.keys()]) clearWatchdog(id);
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
}

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
    armWatchdog(id);
  });

  return {
    result,
    cancel: () => {
      if (request.cancelled) return;
      request.cancelled = true;
      pending.delete(id);
      clearWatchdog(id);
      if (worker === active) active.postMessage({ kind: "cancel", id });
      request.reject(new DOMException("local file indexing cancelled", "AbortError"));
    },
  };
}

export function destroyLocalIngestWorker(): void {
  worker?.terminate();
  worker = null;
  for (const id of [...watchdogs.keys()]) clearWatchdog(id);
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
      armWatchdog(event.data.id);
      return;
    }
    clearWatchdog(event.data.id);
    pending.delete(event.data.id);
    if (event.data.kind === "complete" && event.data.identity) {
      request.resolve(event.data.identity);
    } else {
      request.reject(new Error(event.data.error ?? "local file indexing failed"));
    }
  });
  worker.addEventListener("error", (event) => {
    event.preventDefault();
    fallbackAllToMainThread();
  });
  return worker;
}
