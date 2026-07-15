import { installBrowserAssuranceBridge } from "./browser-assurance-runtime";
import { verifyKeyxymV26Bundle } from "./keyxym-v26-provenance";
import { installWorldCellGuidance } from "./world-cell-guidance";

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
    if (heading) heading.textContent = "KEYXYM V0.26 AUTHORITY REJECTED";
    if (detail) detail.textContent = `${reason}. No camera frame, Moment, seal, or transfer will execute.`;
    stage.style.display = "";
  }
  if (capture) capture.disabled = true;
  if (seal) seal.disabled = true;
  if (send) send.disabled = true;
  if (start) start.disabled = true;
  document.documentElement.dataset.keyxymAuthority = "rejected";
  console.error("Keyxym v0.26 authority rejected", error);
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

try {
  const manifest = await verifyKeyxymV26Bundle();
  await installAssurance();
  const { installWorldCellTheater } = await import("./world-cell-theater-v26");
  await installWorldCellTheater(manifest);
  installWorldCellGuidance();
  document.documentElement.dataset.keyxymAuthority = "verified";
  document.documentElement.dataset.keyxymSource = manifest.source_commit;
  document.documentElement.dataset.keyxymAbi = manifest.abi;
  document.documentElement.dataset.keyxymVersion = manifest.version;
  const start = document.getElementById("start-button");
  if (start instanceof HTMLButtonElement) start.disabled = false;
} catch (error) {
  rejectAuthority(error);
}
