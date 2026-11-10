import type {
  DemoWorld,
  ReconstructionArtifactView,
  ReconstructionBrowserReport,
  ValidationLocusArtifactView,
  ValidationLocusBrowserReport,
  VerificationReport,
} from "./types";
import {
  verifyReconstructionArtifact,
  verifyValidationLocusArtifact,
  verifyWorld,
} from "./verification";

type VerificationKind = "world" | "reconstruction" | "validation";
type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  fallback: () => Promise<unknown>;
};

let worker: Worker | null = null;
let sequence = 0;
const pending = new Map<number, Pending>();
/**
 * Silence budget for the verification worker. A healthy worker answers
 * well within this window for the artifacts verified here; a worker that
 * never answers (its script fetch stalled, or its thread never started)
 * must fall back to the main thread instead of hanging the caller.
 * The fallback runs the same pure verification functions in-thread.
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

/** Run every pending verification on the main thread and drop the worker. */
function fallbackAllToMainThread(): void {
  const requests = [...pending.values()];
  pending.clear();
  for (const id of [...watchdogs.keys()]) clearWatchdog(id);
  worker?.terminate();
  worker = null;
  for (const request of requests) {
    void request.fallback().then(request.resolve, (error: unknown) => {
      request.reject(error instanceof Error ? error : new Error(String(error)));
    });
  }
}

export function verifyWorldOffThread(world: DemoWorld): Promise<VerificationReport> {
  return request<VerificationReport>("world", world, () => verifyWorld(world));
}

export function verifyReconstructionOffThread(
  artifact: ReconstructionArtifactView,
): Promise<ReconstructionBrowserReport> {
  return request<ReconstructionBrowserReport>("reconstruction", artifact, () =>
    verifyReconstructionArtifact(artifact),
  );
}

export function verifyValidationOffThread(
  artifact: ValidationLocusArtifactView,
): Promise<ValidationLocusBrowserReport> {
  return request<ValidationLocusBrowserReport>("validation", artifact, () =>
    verifyValidationLocusArtifact(artifact),
  );
}

export function destroyVerificationWorker(): void {
  worker?.terminate();
  worker = null;
  for (const id of [...watchdogs.keys()]) clearWatchdog(id);
  for (const value of pending.values()) {
    value.reject(new Error("verification worker terminated"));
  }
  pending.clear();
}

function request<T>(
  kind: VerificationKind,
  payload: DemoWorld | ReconstructionArtifactView | ValidationLocusArtifactView,
  fallback: () => Promise<T>,
): Promise<T> {
  if (typeof Worker === "undefined") return fallback();
  const active = getWorker();
  const id = ++sequence;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, {
      resolve: (value) => resolve(value as T),
      reject,
      fallback: fallback as () => Promise<unknown>,
    });
    active.postMessage({ id, kind, payload });
    armWatchdog(id);
  });
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./verification-worker.ts", import.meta.url), {
    type: "module",
    name: "tessaryn-local-verifier",
  });
  worker.addEventListener("message", (event: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
    const value = pending.get(event.data.id);
    if (!value) return;
    clearWatchdog(event.data.id);
    pending.delete(event.data.id);
    if (event.data.error) value.reject(new Error(event.data.error));
    else value.resolve(event.data.result);
  });
  worker.addEventListener("error", (event) => {
    event.preventDefault();
    fallbackAllToMainThread();
  });
  return worker;
}
