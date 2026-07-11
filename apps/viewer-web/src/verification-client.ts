import type {
  DemoWorld,
  ReconstructionArtifactView,
  ReconstructionBrowserReport,
  TemporalLocusArtifactView,
  TemporalLocusBrowserReport,
  VerificationReport,
} from "./types";
import {
  verifyReconstructionArtifact,
  verifyTemporalLocusArtifact,
  verifyWorld,
} from "./verification";

type VerificationKind = "world" | "reconstruction" | "temporal";
type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

let worker: Worker | null = null;
let sequence = 0;
const pending = new Map<number, Pending>();

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

export function verifyTemporalOffThread(
  artifact: TemporalLocusArtifactView,
): Promise<TemporalLocusBrowserReport> {
  return request<TemporalLocusBrowserReport>("temporal", artifact, () =>
    verifyTemporalLocusArtifact(artifact),
  );
}

export function destroyVerificationWorker(): void {
  worker?.terminate();
  worker = null;
  for (const value of pending.values()) {
    value.reject(new Error("verification worker terminated"));
  }
  pending.clear();
}

function request<T>(
  kind: VerificationKind,
  payload: DemoWorld | ReconstructionArtifactView | TemporalLocusArtifactView,
  fallback: () => Promise<T>,
): Promise<T> {
  if (typeof Worker === "undefined") return fallback();
  const active = getWorker();
  const id = ++sequence;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, {
      resolve: (value) => resolve(value as T),
      reject,
    });
    active.postMessage({ id, kind, payload });
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
    pending.delete(event.data.id);
    if (event.data.error) value.reject(new Error(event.data.error));
    else value.resolve(event.data.result);
  });
  worker.addEventListener("error", (event) => {
    const error = new Error(event.message || "verification worker failed");
    for (const value of pending.values()) value.reject(error);
    pending.clear();
    worker?.terminate();
    worker = null;
  });
  return worker;
}
