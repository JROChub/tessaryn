import { installBrowserAssuranceBridge } from "./browser-assurance-runtime";
import { verifyKeyxymV26Bundle } from "./keyxym-v26-provenance";
import { installWorldCellGuidance } from "./world-cell-guidance";
import { installWorldCellPreviewFallback } from "./world-cell-preview-fallback";

async function refreshServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  const script = new URL("./sw.js", document.baseURI);
  try {
    const registration = await navigator.serviceWorker.register(script, { updateViaCache: "none" });
    await registration.update();
    if (registration.installing || registration.waiting) {
      await Promise.race([
        new Promise<void>((resolve) => {
          navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true });
        }),
        new Promise<void>((resolve) => window.setTimeout(resolve, 3_000)),
      ]);
    }
    document.documentElement.dataset.serviceWorker = "current";
  } catch (error) {
    document.documentElement.dataset.serviceWorker = "unavailable";
    console.warn("TESSARYN service worker refresh unavailable", error);
  }
}

async function installEformAssurance(): Promise<void> {
  try {
    const manifest = await installBrowserAssuranceBridge();
    document.documentElement.dataset.eformAuthority = "verified";
    document.documentElement.dataset.eformSource = manifest.source_commit;
    document.documentElement.dataset.worldCellAssurance = "verified";
    document.documentElement.dataset.worldCellAssuranceSource = manifest.source_commit;
  } catch (error) {
    document.documentElement.dataset.eformAuthority = "rejected";
    document.documentElement.dataset.worldCellAssurance = "rejected";
    console.error("Independent eform assurance rejected", error);
    throw error;
  }
}

try {
  await refreshServiceWorker();
  const manifest = await verifyKeyxymV26Bundle();
  document.documentElement.dataset.keyxymMapAuthority = "verified";
  document.documentElement.dataset.keyxymMapSource = manifest.source_commit;
  await installEformAssurance();
  const { installWorldCellTheater } = await import("./world-cell-theater-v26");
  await installWorldCellTheater(manifest);
  installWorldCellGuidance();
  document.documentElement.dataset.keyxymAuthority = "verified";
  document.documentElement.dataset.keyxymSource = manifest.source_commit;
  document.documentElement.dataset.keyxymAbi = manifest.abi;
  document.documentElement.dataset.keyxymVersion = manifest.version;
  document.documentElement.dataset.worldCellMode = "authoritative";
  const start = document.getElementById("start-button");
  if (start instanceof HTMLButtonElement) start.disabled = false;
} catch (error) {
  if (!document.documentElement.dataset.keyxymMapAuthority) {
    document.documentElement.dataset.keyxymMapAuthority = "rejected";
  }
  if (!document.documentElement.dataset.eformAuthority) {
    document.documentElement.dataset.eformAuthority = "unavailable";
    document.documentElement.dataset.worldCellAssurance = "unavailable";
  }
  console.error("World Cell authoritative path unavailable; entering visual preview", error);
  installWorldCellPreviewFallback(error);
}
