function rejectStartup(error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  const badge = document.getElementById("cell-state");
  const stage = document.getElementById("stage-message");
  const capture = document.getElementById("capture-button") as HTMLButtonElement | null;
  const seal = document.getElementById("seal-button") as HTMLButtonElement | null;
  const send = document.getElementById("send-button") as HTMLButtonElement | null;
  const start = document.getElementById("start-button") as HTMLButtonElement | null;

  if (badge) badge.textContent = "WORLD CELL / STARTUP FAILED";
  if (stage) {
    const heading = stage.querySelector("b");
    const detail = stage.querySelector("span");
    if (heading) heading.textContent = "KEYXYM V0.21 STARTUP FAILED";
    if (detail) detail.textContent = `${reason}. Reload the page to retry the v0.21 key-map runtime.`;
    stage.style.display = "";
  }
  if (capture) capture.disabled = true;
  if (seal) seal.disabled = true;
  if (send) send.disabled = true;
  if (start) start.disabled = true;
  document.documentElement.dataset.keyxymAuthority = "unavailable";
  console.error("Keyxym v0.21 startup failed", error);
}

async function refreshServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  const script = new URL("./sw.js", document.baseURI);
  try {
    const registration = await navigator.serviceWorker.register(script, { updateViaCache: "none" });
    await registration.update();
    document.documentElement.dataset.serviceWorker = "current";
  } catch (error) {
    document.documentElement.dataset.serviceWorker = "unavailable";
    console.warn("TESSARYN service worker refresh unavailable", error);
  }
}

try {
  await refreshServiceWorker();
  await import("./world-cell-theater");
  document.documentElement.dataset.keyxymAuthority = "v021-key-map";
  document.documentElement.dataset.keyxymVersion = "0.21";
  document.documentElement.dataset.worldCellController = "keyxym-v021-key-map";
  const start = document.getElementById("start-button");
  if (start instanceof HTMLButtonElement) start.disabled = false;
} catch (error) {
  rejectStartup(error);
}
