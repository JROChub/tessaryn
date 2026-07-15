import { verifyKeyxymV22Bundle } from "./keyxym-v22-provenance";

function text(id: string, value: string): void {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function disable(id: string): void {
  const element = document.getElementById(id);
  if (element instanceof HTMLButtonElement) element.disabled = true;
}

try {
  const manifest = await verifyKeyxymV22Bundle();
  document.documentElement.dataset.keyxymAuthority = "verified";
  document.documentElement.dataset.keyxymCommit = manifest.source_commit;
  text("backend-name", "KEYXYM V0.22 / VERIFIED");
  text("adapter-name", manifest.source_commit.slice(0, 12).toUpperCase());
  await import("./authoritative-world-cell");
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  document.documentElement.dataset.keyxymAuthority = "rejected";
  text("backend-name", "PREVIEW ONLY");
  text("adapter-name", "AUTHORITY REJECTED");
  text("pose-state", "AUTHORITY OFFLINE");
  text("cell-state", "VISUAL PREVIEW / UNSEALED");
  text("rootprint", "UNSEALED");
  text("stage-message", reason);
  disable("capture-button");
  disable("seal-button");
  disable("send-button");
  console.error("Keyxym v0.22 authority rejected", error);
}
