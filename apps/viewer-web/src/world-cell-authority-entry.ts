function setText(id: string, value: string): void {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function installEmergencyShell(reason: unknown): void {
  const detail = reason instanceof Error ? reason.message : String(reason);
  const start = document.getElementById("start-button");
  const stop = document.getElementById("stop-button");
  const capture = document.getElementById("capture-button");
  const seal = document.getElementById("seal-button");
  const send = document.getElementById("send-button");
  const stage = document.getElementById("stage-message");

  document.documentElement.dataset.keyxymAuthority = "boot-failed";
  document.documentElement.dataset.worldCellMode = "recovery";
  document.documentElement.dataset.keyxymMapAuthority ||= "unavailable";
  document.documentElement.dataset.eformAuthority ||= "unavailable";

  setText("capture-state", "RECOVERY");
  setText("compute-state", "RUNTIME UNAVAILABLE");
  setText("pose-state", "NO AUTHORITY");
  setText("cell-state", "WORLD CELL / RECOVERY REQUIRED");
  setText("gpu-badge", "BOOT FAILED");
  setText("backend-name", "TESSARYN RECOVERY SHELL");
  setText("adapter-name", "NO EXECUTABLE AUTHORITY");
  setText("sensor-detail", "The verified runtime could not load. No frame, Moment, seal, Rootprint, or transfer operation is available.");

  if (stage) {
    const heading = stage.querySelector("b");
    const message = stage.querySelector("span");
    if (heading) heading.textContent = "WORLD CELL RUNTIME COULD NOT START";
    if (message) message.textContent = `${detail}. Retry after refreshing the release files.`;
    stage.style.display = "";
  }

  for (const control of [stop, capture, seal, send]) {
    if (control instanceof HTMLButtonElement) control.disabled = true;
  }
  if (start instanceof HTMLButtonElement) {
    start.disabled = false;
    start.textContent = "RETRY AUTHORITY";
    start.onclick = () => location.reload();
  }
}

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
    const { installBrowserAssuranceBridge } = await import("./browser-assurance-runtime");
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

async function enterPreview(error: unknown): Promise<void> {
  try {
    const { installWorldCellPreviewFallback } = await import("./world-cell-preview-fallback");
    installWorldCellPreviewFallback(error);
  } catch (previewError) {
    console.error("World Cell preview path also failed", previewError);
    installEmergencyShell(previewError);
  }
}

function hasVerifiedSpatialAdapter(): boolean {
  const bridge = (window as unknown as {
    tessarynMetricSensor?: { currentCalibration?: unknown; currentSpatialFrame?: unknown };
  }).tessarynMetricSensor;
  return typeof bridge?.currentCalibration === "function" &&
    typeof bridge?.currentSpatialFrame === "function";
}

async function boot(): Promise<void> {
  try {
    await refreshServiceWorker();

    // v0.21's working spatial contract required calibrated depth and tracked 3D
    // landmarks. Ordinary Safari camera RGB is therefore a responsive visual
    // preview, not an authoritative reconstruction input.
    if (!hasVerifiedSpatialAdapter()) {
      document.documentElement.dataset.keyxymMapAuthority = "adapter-required";
      document.documentElement.dataset.eformAuthority = "not-requested";
      document.documentElement.dataset.worldCellAssurance = "not-requested";
      await enterPreview(new Error("Verified depth, intrinsics, pose, and landmark adapter not present"));
      return;
    }

    const { verifyKeyxymV26Bundle } = await import("./keyxym-v26-provenance");
    const manifest = await verifyKeyxymV26Bundle();
    document.documentElement.dataset.keyxymMapAuthority = "verified";
    document.documentElement.dataset.keyxymMapSource = manifest.source_commit;
    await installEformAssurance();
    const [{ installWorldCellTheater }, { installWorldCellGuidance }] = await Promise.all([
      import("./world-cell-theater-v26"),
      import("./world-cell-guidance"),
    ]);
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
    document.documentElement.dataset.keyxymMapAuthority ||= "rejected";
    if (!document.documentElement.dataset.eformAuthority) {
      document.documentElement.dataset.eformAuthority = "unavailable";
      document.documentElement.dataset.worldCellAssurance = "unavailable";
    }
    console.error("World Cell authoritative path unavailable; entering visual preview", error);
    await enterPreview(error);
  }
}

void boot();
