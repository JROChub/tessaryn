import type {
  DemoWorld,
  ReconstructionArtifactView,
  ValidationLocusArtifactView,
} from "./types";
import {
  verifyReconstructionArtifact,
  verifyValidationLocusArtifact,
  verifyWorld,
} from "./verification";

type VerificationRequest =
  | { id: number; kind: "world"; payload: DemoWorld }
  | { id: number; kind: "reconstruction"; payload: ReconstructionArtifactView }
  | { id: number; kind: "validation"; payload: ValidationLocusArtifactView };

self.addEventListener("message", (event: MessageEvent<VerificationRequest>) => {
  void handle(event.data);
});

async function handle(request: VerificationRequest): Promise<void> {
  try {
    const result =
      request.kind === "world"
        ? await verifyWorld(request.payload)
        : request.kind === "reconstruction"
          ? await verifyReconstructionArtifact(request.payload)
          : await verifyValidationLocusArtifact(request.payload);
    self.postMessage({ id: request.id, result });
  } catch (error) {
    self.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
