import { installBrowserAssuranceBridge } from "./browser-assurance-runtime";
import { verifyKeyxymV22Bundle } from "./keyxym-v22-provenance";

function rejectAuthority(error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  const badge = document.getElementById("cell-state");
  const stage = document.getElementById("stage-message");
  const capture = document.getElementById("capture-button") as HTMLButtonElement | null;
  const seal = document.getElementById("seal-button") as HTMLButtonElement | null;
  const send = document.getElementById("send-button") as HTMLButtonElement | null;
  const start = document.getElementById("start-button") as HTMLButtonElement | null;
  if (badge) badge.textContent = "WORLD CELL / AUTHORITY REJECTED";
  if (stage) {
    const heading = stage.querySelector("b");
    const detail = stage.querySelector("span");
    if (heading) heading.textContent = "KEYXYM AUTHORITY REJECTED";
    if (detail) detail.textContent = `${reason}. No camera frame, Moment, seal, or transfer will execute.`;
    stage.style.display = "";
  }
  if (capture) capture.disabled = true;
  if (seal) seal.disabled = true;
  if (send) send.disabled = true;
  if (start) start.disabled = true;
  document.documentElement.dataset.keyxymAuthority = "rejected";
  console.error("Keyxym v0.22 authority rejected", error);
}

async function installAssurance(): Promise<void> {
  try {
    const manifest = await installBrowserAssuranceBridge();
    document.documentElement.dataset.worldCellAssurance = "verified";
    document.documentElement.dataset.worldCellAssuranceSource = manifest.source_commit;
  } catch (error) {
    document.documentElement.dataset.worldCellAssurance = "rejected";
    console.error("Browser eform/Power House assurance rejected", error);
  }
}

function installAuthorityReadyInvariant(): void {
  const pose = document.getElementById("pose-state");
  const cell = document.getElementById("cell-state");
  if (!pose || !cell) throw new Error("World Cell authority state elements are missing");

  const reconcile = (): void => {
    if (document.documentElement.dataset.keyxymAuthority !== "verified") return;
    const poseState = pose.textContent?.trim();
    const cellState = cell.textContent?.trim() ?? "";
    if ((poseState === "AUTHORITY OFFLINE" || poseState === "ORIGIN") &&
        cellState.includes("READY")) {
      pose.textContent = "KEYXYM READY";
    }
  };

  const observer = new MutationObserver(reconcile);
  observer.observe(pose, { childList: true, characterData: true, subtree: true });
  observer.observe(cell, { childList: true, characterData: true, subtree: true });
  window.addEventListener("beforeunload", () => observer.disconnect(), { once: true });
  reconcile();
}

try {
  const manifest = await verifyKeyxymV22Bundle();
  await installAssurance();
  const { installWorldCellTheater } = await import("./world-cell-theater");
  await installWorldCellTheater(manifest);
  document.documentElement.dataset.keyxymAuthority = "verified";
  document.documentElement.dataset.keyxymSource = manifest.source_commit;
  document.documentElement.dataset.keyxymAbi = manifest.abi;
  installAuthorityReadyInvariant();
  const start = document.getElementById("start-button");
  if (start instanceof HTMLButtonElement) start.disabled = false;
} catch (error) {
  rejectAuthority(error);
}
