const root = document.documentElement;
root.dataset.worldCellBoot = "module-started";
root.dataset.worldCellMode = "initializing";

const BOOT_PHASE_TIMEOUT_MS = 8_000;
const PREVIEW_LOAD_TIMEOUT_MS = 12_000;

function setText(id: string, value: string): void {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function timeoutError(label: string, timeoutMs: number): Error {
  return new Error(`${label} did not complete within ${timeoutMs}ms`);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer = 0;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = window.setTimeout(() => reject(timeoutError(label, timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) window.clearTimeout(timer);
  }
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
    const registration = await withTimeout(
      navigator.serviceWorker.register(script, { updateViaCache: "none" }),
      BOOT_PHASE_TIMEOUT_MS,
      "Service worker registration",
    );
    await withTimeout(registration.update(), BOOT_PHASE_TIMEOUT_MS, "Service worker update");
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
    const { installBrowserAssuranceBridge } = await withTimeout(
      import("./browser-assurance-runtime"),
      BOOT_PHASE_TIMEOUT_MS,
      "eform assurance module load",
    );
    const manifest = await withTimeout(
      installBrowserAssuranceBridge(),
      BOOT_PHASE_TIMEOUT_MS,
      "eform assurance verification",
    );
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
    const { installWorldCellPreviewFallback } = await withTimeout(
      import("./world-cell-preview-fallback"),
      PREVIEW_LOAD_TIMEOUT_MS,
      "World Cell preview module load",
    );
    installWorldCellPreviewFallback(error);
  } catch (previewError) {
    console.error("World Cell preview path also failed", previewError);
    installEmergencyShell(previewError);
  }
}

interface SpatialCalibrationProbe {
  verified?: boolean;
  scaleMetersPerUnit?: number;
  receipt?: string;
}

async function hasVerifiedSpatialAdapter(): Promise<boolean> {
  const bridge = (window as unknown as {
    tessarynMetricSensor?: {
      currentCalibration?: () => Promise<SpatialCalibrationProbe>;
      currentSpatialFrame?: () => Promise<unknown>;
    };
  }).tessarynMetricSensor;
  if (typeof bridge?.currentCalibration !== "function" ||
      typeof bridge.currentSpatialFrame !== "function") return false;
  const calibration = await withTimeout(
    bridge.currentCalibration().catch(() => null),
    BOOT_PHASE_TIMEOUT_MS,
    "Spatial calibration probe",
  ).catch(() => null);
  return calibration?.verified === true &&
    Number.isFinite(calibration.scaleMetersPerUnit) &&
    Number(calibration.scaleMetersPerUnit) > 0 &&
    /^[0-9a-f]{64}$/u.test(calibration.receipt ?? "") &&
    calibration.receipt !== "0".repeat(64);
}

async function boot(): Promise<void> {
  const serviceWorkerRefresh = refreshServiceWorker();
  try {
    // Ordinary browser camera input does not need to wait for a service-worker
    // update before the honest visual preview becomes usable. The service worker
    // refresh continues in the background and is awaited only by the authoritative
    // Keyxym/eform path.
    if (!await hasVerifiedSpatialAdapter()) {
      document.documentElement.dataset.keyxymMapAuthority = "adapter-required";
      document.documentElement.dataset.eformAuthority = "not-requested";
      document.documentElement.dataset.worldCellAssurance = "not-requested";
      await enterPreview(new Error("Verified depth, intrinsics, pose, landmark, and calibration receipt adapter not present"));
      void serviceWorkerRefresh;
      return;
    }

    await serviceWorkerRefresh;
    const { verifyKeyxymV26Bundle } = await withTimeout(
      import("./keyxym-v26-provenance"),
      BOOT_PHASE_TIMEOUT_MS,
      "Keyxym provenance module load",
    );
    const manifest = await withTimeout(
      verifyKeyxymV26Bundle(),
      BOOT_PHASE_TIMEOUT_MS,
      "Keyxym v0.26 bundle verification",
    );
    document.documentElement.dataset.keyxymMapAuthority = "verified";
    document.documentElement.dataset.keyxymMapSource = manifest.source_commit;
    await installEformAssurance();
    const [{ installWorldCellTheater }, { installWorldCellGuidance }] = await withTimeout(
      Promise.all([
        import("./world-cell-theater-v26"),
        import("./world-cell-guidance"),
      ]),
      BOOT_PHASE_TIMEOUT_MS,
      "World Cell authoritative modules load",
    );
    await withTimeout(
      installWorldCellTheater(manifest),
      BOOT_PHASE_TIMEOUT_MS,
      "World Cell authoritative runtime installation",
    );
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
