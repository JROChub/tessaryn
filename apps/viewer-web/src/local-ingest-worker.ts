import {
  calculateLocalFileIdentity,
  type LocalFileIdentity,
  type LocalFileProgress,
} from "./local-file-identity";

type LocalIngestRequest =
  | { kind: "index"; id: number; file: File }
  | { kind: "cancel"; id: number };

type LocalIngestResponse =
  | { kind: "progress"; id: number; progress: LocalFileProgress }
  | { kind: "complete"; id: number; identity: LocalFileIdentity }
  | { kind: "error"; id: number; error: string };

const cancelled = new Set<number>();

self.addEventListener("message", (event: MessageEvent<LocalIngestRequest>) => {
  if (event.data.kind === "cancel") {
    cancelled.add(event.data.id);
    return;
  }
  void index(event.data.id, event.data.file);
});

async function index(id: number, file: File): Promise<void> {
  try {
    const identity = await calculateLocalFileIdentity(
      file,
      (progress) => post({ kind: "progress", id, progress }),
      () => cancelled.has(id),
    );
    if (!cancelled.has(id)) post({ kind: "complete", id, identity });
  } catch (error) {
    if (!cancelled.has(id)) {
      post({
        kind: "error",
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } finally {
    cancelled.delete(id);
  }
}

function post(message: LocalIngestResponse): void {
  self.postMessage(message);
}
