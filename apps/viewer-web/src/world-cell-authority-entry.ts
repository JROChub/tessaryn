async function refreshServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  try {
    const registration = await navigator.serviceWorker.register(new URL("./sw.js", document.baseURI), {
      updateViaCache: "none",
    });
    await registration.update();
    document.documentElement.dataset.serviceWorker = "current";
  } catch (error) {
    document.documentElement.dataset.serviceWorker = "unavailable";
    console.warn("TESSARYN service worker refresh unavailable", error);
  }
}

function setText(id: string, value: string): void {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

await refreshServiceWorker();
await import("./world-cell-theater-v21");

document.documentElement.dataset.keyxymAuthority = "v021";
document.documentElement.dataset.keyxymVersion = "0.21";
setText("capture-state", "READY");
setText("compute-state", "KEYXYM 0.21");
setText("pose-state", "VISUAL PREVIEW / UNSEALED");
setText("cell-state", "WORLD CELL / V0.21 / READY");
setText("backend-name", "KEYXYM MAPS V0.21");
setText("adapter-name", "VISUAL RECONSTRUCTION");

const start = document.getElementById("start-button");
if (start instanceof HTMLButtonElement) start.disabled = false;

const stage = document.getElementById("stage-message");
if (stage) {
  const heading = stage.querySelector("b");
  const detail = stage.querySelector("span");
  if (heading) heading.textContent = "KEYXYM MAPS V0.21 READY";
  if (detail) detail.textContent = "Start the camera to restore immediate visual reconstruction, point-cloud formation, and Moment capture.";
  stage.style.display = "";
}
