import {
  Box,
  Code2,
  Database,
  Download,
  Fingerprint,
  FlaskConical,
  GitBranch,
  Landmark,
  Layers3,
  Maximize2,
  MessageSquareText,
  Move3d,
  Pause,
  Play,
  RotateCcw,
  Scan,
  Search,
  Share2,
  ShieldCheck,
  Upload,
  Waypoints,
  X,
  createIcons,
} from "lucide";
import "./style.css";
import type {
  CinematicMomentView,
  CinematicObjectBrowserReport,
  CinematicObjectEnvelopeView,
  DatasetProfileView,
  DemoCell,
  DemoMoment,
  DemoWorld,
  PublicObjectCatalog,
  PublicObjectCatalogEntry,
  ReconstructionArtifactView,
  ReconstructionBrowserReport,
  ValidationLocusArtifactView,
  ValidationLocusBrowserReport,
  VerificationReport,
} from "./types";
import { parseAndVerifyCinematicObject } from "./cinematic-object";
import {
  destroyLocalIngestWorker,
  indexLocalFileOffThread,
  type LocalIngestTask,
} from "./local-ingest-client";
import type { LocalFileIdentity, LocalFileProgress } from "./local-file-identity";
import { parseStrictIntegerJson } from "./strict-json";
import { runMutation } from "./verification";
import {
  destroyVerificationWorker,
  verifyReconstructionOffThread,
  verifyValidationOffThread,
  verifyWorldOffThread,
} from "./verification-client";
import {
  TessarynWorld,
  type ScaleMode,
  type TemporalObservation,
} from "./world";

declare global {
  interface Window {
    __tessaryn?: {
      world: DemoWorld;
      verification: VerificationReport | null;
      importedArtifact?: ReconstructionArtifactView;
      importedVerification?: ReconstructionBrowserReport;
      validationArtifact?: ValidationLocusArtifactView;
      validationVerification?: ValidationLocusBrowserReport;
      localImport?: LocalImportView;
      cinematicObject?: CinematicObjectEnvelopeView;
      cinematicVerification?: CinematicObjectBrowserReport;
      publicObjectCatalog?: PublicObjectCatalog;
      verifyValidationArtifact: typeof verifyValidationOffThread;
      scene: TessarynWorld;
      metrics: RuntimeMetrics;
    };
  }
}

interface RuntimeMetrics {
  bootStartedAtMs: number;
  firstStructureMs?: number;
  materializedMs?: number;
  verificationMs?: number;
}

type LocalFileKind = "video" | "image" | "audio" | "binary";
type LocalImportStatus = "indexing" | "indexed" | "error";

interface LocalImportView {
  name: string;
  mediaType: string;
  bytes: number;
  kind: LocalFileKind;
  status: LocalImportStatus;
  bytesRead: number;
  chunkCount: number;
  streamRoot?: string;
}

interface ActiveLocalImport {
  file: File;
  kind: LocalFileKind;
  status: LocalImportStatus;
  identity: LocalFileIdentity | null;
  progress: LocalFileProgress;
  previousSource?: string;
  previousOriginName: string;
  previousCellCount: string;
  error?: string;
}

interface ActiveCinematicObject {
  file: File;
  envelope: CinematicObjectEnvelopeView;
  verification: CinematicObjectBrowserReport;
  publicEntry: PublicObjectCatalogEntry | null;
}

const elements = {
  app: byId<HTMLDivElement>("app"),
  canvas: byId<HTMLCanvasElement>("world-canvas"),
  originName: byId<HTMLElement>("origin-name"),
  cellCount: byId<HTMLElement>("cell-count"),
  networkState: byId<HTMLElement>("network-state"),
  momentRail: byId<HTMLElement>("moment-rail"),
  originPhase: byId<HTMLElement>("origin-phase"),
  originStatus: byId<HTMLElement>("origin-status"),
  condensation: byId<HTMLElement>("condensation-progress"),
  anchorShort: byId<HTMLElement>("anchor-short"),
  momentShort: byId<HTMLElement>("moment-short"),
  evidenceShort: byId<HTMLElement>("evidence-short"),
  worldLabel: byId<HTMLElement>("world-label"),
  worldLabelTitle: byId<HTMLElement>("world-label-title"),
  worldLabelState: byId<HTMLElement>("world-label-state"),
  traceDrawer: byId<HTMLElement>("trace-drawer"),
  traceClose: byId<HTMLButtonElement>("trace-close"),
  traceTitle: byId<HTMLElement>("trace-title"),
  traceClass: byId<HTMLElement>("trace-class"),
  traceCore: byId<HTMLElement>("trace-core"),
  traceReplay: byId<HTMLElement>("trace-replay"),
  traceDisclosure: byId<HTMLElement>("trace-disclosure"),
  traceCellId: byId<HTMLElement>("trace-cell-id"),
  tracePha: byId<HTMLElement>("trace-pha"),
  traceRootprint: byId<HTMLElement>("trace-rootprint"),
  traceAnchor: byId<HTMLElement>("trace-anchor"),
  traceSummary: byId<HTMLElement>("trace-summary"),
  evidenceVector: byId<HTMLElement>("evidence-vector"),
  lineagePath: byId<HTMLElement>("lineage-path"),
  challengeDrawer: byId<HTMLElement>("challenge-drawer"),
  challengeClose: byId<HTMLButtonElement>("challenge-close"),
  rejectionTrace: byId<HTMLElement>("rejection-trace"),
  verificationDialog: byId<HTMLDialogElement>("verification-dialog"),
  verifyTitle: byId<HTMLElement>("verify-title"),
  verifyCells: byId<HTMLElement>("verify-cells"),
  verifyPha: byId<HTMLElement>("verify-pha"),
  verifyRootprint: byId<HTMLElement>("verify-rootprint"),
  verifyReplay: byId<HTMLElement>("verify-replay"),
  verifyMemory: byId<HTMLElement>("verify-memory"),
  verifyDetail: byId<HTMLElement>("verify-detail"),
  verifyButton: byId<HTMLButtonElement>("verify-button"),
  importButton: byId<HTMLButtonElement>("import-button"),
  importInput: byId<HTMLInputElement>("import-input"),
  verifyClose: byId<HTMLButtonElement>("verify-close"),
  fullscreenButton: byId<HTMLButtonElement>("fullscreen-button"),
  chronofoldButton: byId<HTMLButtonElement>("chronofold-button"),
  evidenceButton: byId<HTMLButtonElement>("evidence-button"),
  challengeButton: byId<HTMLButtonElement>("challenge-button"),
  exportButton: byId<HTMLButtonElement>("export-button"),
  resetButton: byId<HTMLButtonElement>("reset-button"),
  scaleBreath: byId<HTMLInputElement>("scale-breath"),
  bootStatus: byId<HTMLElement>("boot-status"),
  toast: byId<HTMLElement>("toast"),
  sourcesButton: byId<HTMLButtonElement>("sources-button"),
  sourcesDialog: byId<HTMLDialogElement>("sources-dialog"),
  sourcesClose: byId<HTMLButtonElement>("sources-close"),
  objectsButton: byId<HTMLButtonElement>("objects-button"),
  objectsDialog: byId<HTMLDialogElement>("objects-dialog"),
  objectsClose: byId<HTMLButtonElement>("objects-close"),
  objectSearch: byId<HTMLInputElement>("object-search"),
  objectList: byId<HTMLElement>("object-list"),
  sourceName: byId<HTMLElement>("source-name"),
  sourceClass: byId<HTMLElement>("source-class"),
  sourceEnvironment: byId<HTMLElement>("source-environment"),
  sourceSensor: byId<HTMLElement>("source-sensor"),
  sourceGroundTruth: byId<HTMLElement>("source-ground-truth"),
  sourceAssets: byId<HTMLElement>("source-assets"),
  sourceProfileId: byId<HTMLElement>("source-profile-id"),
  portfolioList: byId<HTMLElement>("portfolio-list"),
  localStage: byId<HTMLElement>("local-stage"),
  localClose: byId<HTMLButtonElement>("local-close"),
  localExport: byId<HTMLButtonElement>("local-export"),
  localShare: byId<HTMLButtonElement>("local-share"),
  localKind: byId<HTMLElement>("local-kind"),
  localName: byId<HTMLElement>("local-name"),
  localStatus: byId<HTMLElement>("local-status"),
  localSize: byId<HTMLElement>("local-size"),
  localRoot: byId<HTMLElement>("local-root"),
  localProgress: byId<HTMLElement>("local-progress"),
  cinematicControls: byId<HTMLElement>("cinematic-controls"),
  cinematicPlay: byId<HTMLButtonElement>("cinematic-play"),
  cinematicTime: byId<HTMLInputElement>("cinematic-time"),
  cinematicClock: byId<HTMLOutputElement>("cinematic-clock"),
};

interface ValidationPortfolio {
  schema: "tessaryn/validation-portfolio/v1";
  entries: Array<{
    id: string;
    layer: string;
    source_class: "synthetic_ground_truth" | "real_sensor";
    release_year: number;
    modalities: string[];
    adapter: string;
    state: string;
    evidence_scope: string;
    homepage: string;
    usage: string;
  }>;
}

let worldData: DemoWorld;
let scene: TessarynWorld;
let selected: DemoCell;
let latestVerification: VerificationReport | null = null;
let importedArtifact: ReconstructionArtifactView | null = null;
let importedVerification: ReconstructionBrowserReport | null = null;
let validationArtifact: ValidationLocusArtifactView | null = null;
let validationVerification: ValidationLocusBrowserReport | null = null;
const temporalArtifactsByCell = new Map<string, ReconstructionArtifactView>();
const temporalCellsByMoment = new Map<string, DemoCell>();
let chronofoldOpen = false;
let evidenceVisible = true;
let condensationComplete = false;
let toastTimer = 0;
let activeLocalImport: ActiveLocalImport | null = null;
let activeLocalTask: LocalIngestTask | null = null;
let activeCinematicObject: ActiveCinematicObject | null = null;
let publicObjectCatalog: PublicObjectCatalog | null = null;
let cinematicScrubbing = false;
const MAX_INLINE_RECONSTRUCTION_BYTES = 64 * 1024 * 1024;
const runtimeMetrics: RuntimeMetrics = {
  bootStartedAtMs: performance.now(),
};

void boot();

async function boot(): Promise<void> {
  try {
    elements.bootStatus.textContent = "READING LOCAL CELL MANIFESTS";
    const [worldResponse, validationResponse, portfolioResponse, catalogResponse] = await Promise.all([
      fetch("./world/vesper-court.json", { cache: "no-store" }),
      fetch("./world/archviz-tiny-house-locus.json", { cache: "no-store" }),
      fetch("./validation/portfolio.json", { cache: "no-store" }),
      fetch("./objects/catalog.json", { cache: "no-store" }),
    ]);
    if (!worldResponse.ok) throw new Error("world fixture unavailable");
    if (!validationResponse.ok) throw new Error("validation Locus unavailable");
    if (!portfolioResponse.ok) throw new Error("validation portfolio unavailable");
    if (!catalogResponse.ok) throw new Error("public Object Weave unavailable");
    worldData = (await worldResponse.json()) as DemoWorld;
    if (
      worldData.schema !== "tessaryn/demo-world/v0" ||
      worldData.status !== "reference-origin"
    ) {
      throw new Error("unsupported world fixture");
    }
    const parsedValidation = parseStrictIntegerJson(await validationResponse.text());
    if (!isValidationLocusArtifact(parsedValidation)) {
      throw new Error("unsupported validation Locus artifact");
    }
    const parsedPortfolio = parseStrictIntegerJson(await portfolioResponse.text());
    if (!isValidationPortfolio(parsedPortfolio)) {
      throw new Error("unsupported validation portfolio");
    }
    const parsedCatalog = parseStrictIntegerJson(await catalogResponse.text());
    if (!isPublicObjectCatalog(parsedCatalog)) {
      throw new Error("unsupported public Object Weave catalog");
    }
    publicObjectCatalog = parsedCatalog;
    validationArtifact = parsedValidation;
    elements.bootStatus.textContent = "VERIFYING EXACT RGB-D GROUND TRUTH";
    validationVerification = await verifyValidationOffThread(parsedValidation);
    if (validationVerification.errors.length > 0 || !validationVerification.alternate) {
      throw new Error(
        validationVerification.errors.join(" / ") || "validation Locus rejected",
      );
    }
    const observations = temporalObservations(validationVerification);
    selected =
      observations.find((observation) => observation.id === "moment-c")?.cell ??
      observations[0]?.cell ??
      fail("temporal Locus contains no observations");
    populateTemporalMoments(validationVerification);
    populateValidationPortfolio(parsedValidation.source.profile, parsedPortfolio);
    populatePublicObjects(parsedCatalog.objects);
    elements.originName.textContent = parsedValidation.origin;
    elements.cellCount.textContent = String(validationVerification.cellsValid) + " CELLS";
    elements.anchorShort.textContent = shortDigest(selected.manifest.anchor_id, 8);
    elements.momentShort.textContent = "MOMENT C";
    elements.evidenceShort.textContent = "ASSEMBLING";
    scene = new TessarynWorld(elements.canvas, worldData, {
      onCellSelected: openTrace,
      onCondensationProgress: updateCondensation,
      onCondensationComplete: finishCondensation,
      onScaleChanged: updateScaleButtons,
      onScaleDepthChanged: updateScaleDepth,
    });
    scene.loadTemporalObservations(observations);
    window.addEventListener(
      "pagehide",
      () => {
        closeLocalFile(false);
        destroyLocalIngestWorker();
        destroyVerificationWorker();
        scene.destroy();
      },
      { once: true },
    );
    window.__tessaryn = {
      world: worldData,
      verification: validationVerificationReport(validationVerification),
      validationArtifact: parsedValidation,
      validationVerification,
      publicObjectCatalog: parsedCatalog,
      verifyValidationArtifact: verifyValidationOffThread,
      scene,
      metrics: runtimeMetrics,
    };
    bindControls();
    createIcons({
      icons: {
        Box,
        Code2,
        Database,
        Download,
        Fingerprint,
        FlaskConical,
        GitBranch,
        Landmark,
        Layers3,
        Maximize2,
        MessageSquareText,
        Move3d,
        Pause,
        Play,
        RotateCcw,
        Scan,
        Search,
        Share2,
        ShieldCheck,
        Upload,
        Waypoints,
        X,
      },
    });
    elements.bootStatus.textContent = "ORIGIN FRAME ACCEPTED";
    await delay(380);
    elements.app.dataset.ready = "true";
    document.body.dataset.ready = "true";
    latestVerification = validationVerificationReport(validationVerification);
    window.__tessaryn.verification = latestVerification;
    runtimeMetrics.verificationMs = performance.now() - runtimeMetrics.bootStartedAtMs;
    elements.evidenceShort.textContent =
      latestVerification.errors.length === 0 ? "LOCALLY VERIFIED" : "CAUTION";
    registerServiceWorker();
    updateNetworkState();
    window.addEventListener("online", updateNetworkState);
    window.addEventListener("offline", updateNetworkState);
    requestAnimationFrame(updateWorldLabel);
    void enterInitialPublicObject();
  } catch (error) {
    console.error(error);
    elements.bootStatus.textContent =
      error instanceof Error ? error.message.toUpperCase() : "ORIGIN FAILED";
    document.body.dataset.error = "true";
  }
}

function bindControls(): void {
  elements.verifyButton.addEventListener("click", () => void showVerification());
  elements.sourcesButton.addEventListener("click", () => {
    if (!elements.sourcesDialog.open) elements.sourcesDialog.showModal();
  });
  elements.sourcesClose.addEventListener("click", () => elements.sourcesDialog.close());
  elements.objectsButton.addEventListener("click", () => {
    if (!elements.objectsDialog.open) elements.objectsDialog.showModal();
    elements.objectSearch.focus();
  });
  elements.objectsClose.addEventListener("click", () => elements.objectsDialog.close());
  elements.objectSearch.addEventListener("input", () => {
    populatePublicObjects(
      publicObjectCatalog?.objects ?? [],
      elements.objectSearch.value,
    );
  });
  elements.importButton.addEventListener("click", () => elements.importInput.click());
  elements.importInput.addEventListener("change", () => void importLocalFile());
  elements.localClose.addEventListener("click", () => {
    if (activeCinematicObject) restoreValidationOrigin();
    else closeLocalFile();
  });
  elements.localExport.addEventListener("click", () => {
    if (activeLocalImport) exportLocalFileIndex(activeLocalImport);
  });
  elements.localShare.addEventListener("click", () => void shareActiveObject());
  elements.verifyClose.addEventListener("click", () => elements.verificationDialog.close());
  elements.fullscreenButton.addEventListener("click", () => void toggleFullscreen());
  elements.traceClose.addEventListener("click", closeTrace);
  elements.challengeClose.addEventListener("click", closeChallenge);
  elements.challengeButton.addEventListener("click", openChallenge);
  elements.exportButton.addEventListener("click", exportCapsule);
  elements.resetButton.addEventListener("click", () => {
    if (activeCinematicObject) {
      restoreValidationOrigin();
      return;
    }
    if (activeLocalImport) {
      closeLocalFile();
      return;
    }
    scene.reset();
    closeTrace();
    showToast("RETURNED TO ORIGIN");
  });
  elements.chronofoldButton.addEventListener("click", () => {
    chronofoldOpen = !chronofoldOpen;
    elements.chronofoldButton.classList.toggle("active", chronofoldOpen);
    elements.chronofoldButton.setAttribute("aria-pressed", String(chronofoldOpen));
    scene.setChronofold(chronofoldOpen);
    elements.originPhase.textContent = chronofoldOpen
      ? "ORIGIN / CHRONOFOLD"
      : "ORIGIN / MATERIALIZED";
    showToast(
      chronofoldOpen
        ? `${String(activeCinematicObject?.envelope.descriptor.moments.length ?? 3)} MOMENTS OPEN`
        : "CURRENT MOMENT RESTORED",
    );
  });
  elements.evidenceButton.addEventListener("click", () => {
    evidenceVisible = !evidenceVisible;
    elements.evidenceButton.classList.toggle("active", evidenceVisible);
    elements.evidenceButton.setAttribute("aria-pressed", String(evidenceVisible));
    scene.setEvidence(evidenceVisible);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-scale]").forEach((button) => {
    button.addEventListener("click", () => scene.setScale(button.dataset.scale as ScaleMode));
  });
  elements.scaleBreath.addEventListener("input", () => {
    scene.setScaleDepth(Number(elements.scaleBreath.value) / 1_000);
  });
  elements.cinematicPlay.addEventListener("click", () => void toggleCinematicPlayback());
  elements.cinematicTime.addEventListener("pointerdown", () => {
    cinematicScrubbing = true;
  });
  elements.cinematicTime.addEventListener("pointerup", () => {
    cinematicScrubbing = false;
  });
  elements.cinematicTime.addEventListener("input", () => {
    const position = Number(elements.cinematicTime.value) / 1_000;
    scene.setCinematicTime(position);
    updateCinematicClock(position);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-trace-tab]").forEach((button) => {
    button.addEventListener("click", () => activateTraceTab(button.dataset.traceTab ?? "evidence"));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-mutation]").forEach((button) => {
    button.addEventListener("click", () => void executeMutation(button.dataset.mutation ?? ""));
  });
  elements.verificationDialog.addEventListener("click", (event) => {
    if (event.target === elements.verificationDialog) elements.verificationDialog.close();
  });
  elements.sourcesDialog.addEventListener("click", (event) => {
    if (event.target === elements.sourcesDialog) elements.sourcesDialog.close();
  });
  elements.objectsDialog.addEventListener("click", (event) => {
    if (event.target === elements.objectsDialog) elements.objectsDialog.close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (activeLocalImport) closeLocalFile();
    closeTrace();
    closeChallenge();
    if (elements.verificationDialog.open) elements.verificationDialog.close();
    if (elements.sourcesDialog.open) elements.sourcesDialog.close();
    if (elements.objectsDialog.open) elements.objectsDialog.close();
  });
}

function populateValidationPortfolio(
  profile: DatasetProfileView,
  portfolio: ValidationPortfolio,
): void {
  elements.sourceName.textContent = profile.dataset;
  elements.sourceClass.textContent = profile.source_class.replaceAll("_", " ").toUpperCase();
  elements.sourceEnvironment.textContent = profile.environment;
  elements.sourceSensor.textContent = `${String(profile.sensor.width)}x${String(profile.sensor.height)} RGB-D / ${String(profile.sensor.sample_rate_millihz / 1_000)} HZ`;
  elements.sourceGroundTruth.textContent = `${profile.ground_truth.reference.toUpperCase()} / DEPTH + POSE`;
  const assetBytes = profile.assets.reduce((total, asset) => total + asset.bytes, 0);
  elements.sourceAssets.textContent = `${String(profile.assets.length)} / ${(assetBytes / 1_000_000).toFixed(1)} MB`;
  elements.sourceProfileId.textContent = profile.id;
  elements.portfolioList.replaceChildren();
  for (const entry of portfolio.entries) {
    const row = document.createElement("div");
    row.className = "portfolio-row";
    row.dataset.sourceClass = entry.source_class;
    const identity = document.createElement("span");
    const title = document.createElement("b");
    const layer = document.createElement("small");
    title.textContent = entry.id;
    layer.textContent = `${entry.layer.replaceAll("_", " ").toUpperCase()} / ${String(entry.release_year)}`;
    identity.append(title, layer);
    const evidence = document.createElement("span");
    const summary = document.createElement("p");
    const modalities = document.createElement("small");
    summary.textContent = entry.evidence_scope;
    modalities.textContent = entry.modalities.join(" + ").toUpperCase();
    evidence.append(summary, modalities);
    const state = document.createElement("em");
    state.textContent = entry.state.toUpperCase();
    row.append(identity, evidence, state);
    elements.portfolioList.append(row);
  }
}

function populatePublicObjects(
  entries: PublicObjectCatalogEntry[],
  query = "",
): void {
  const needle = query.trim().toLocaleLowerCase();
  const visible = entries.filter((entry) =>
    [entry.object_id, entry.title, entry.summary, entry.media, entry.dimensions]
      .join(" ")
      .toLocaleLowerCase()
      .includes(needle),
  );
  elements.objectList.replaceChildren();
  if (visible.length === 0) {
    const empty = document.createElement("p");
    empty.className = "object-empty";
    empty.textContent = "NO COMMITTED OBJECT MATCHES THIS QUERY";
    elements.objectList.append(empty);
    return;
  }
  for (const entry of visible) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "object-entry";
    const mark = document.createElement("span");
    mark.className = "object-entry-mark";
    mark.append(document.createElement("i"), document.createElement("i"), document.createElement("i"));
    const identity = document.createElement("span");
    const title = document.createElement("b");
    const id = document.createElement("code");
    title.textContent = entry.title;
    id.textContent = entry.object_id;
    identity.append(title, id);
    const detail = document.createElement("span");
    const summary = document.createElement("small");
    const metrics = document.createElement("em");
    summary.textContent = entry.summary;
    metrics.textContent = `${entry.dimensions} / ${String(entry.moments)} MOMENTS / ${entry.media}`;
    detail.append(summary, metrics);
    button.append(mark, identity, detail);
    button.addEventListener("click", () => void loadPublicObject(entry));
    elements.objectList.append(button);
  }
}

async function enterInitialPublicObject(): Promise<void> {
  if (!publicObjectCatalog || new URLSearchParams(location.search).get("origin") === "validation") {
    return;
  }
  const requested = new URLSearchParams(location.search).get("object");
  const entry = requested
    ? publicObjectCatalog.objects.find((candidate) => candidate.object_id === requested)
    : publicObjectCatalog.objects[0];
  if (entry) await loadPublicObject(entry);
}

async function loadPublicObject(entry: PublicObjectCatalogEntry): Promise<void> {
  elements.objectsDialog.close();
  elements.importButton.disabled = true;
  showToast("FINDING COMMITTED OBJECT");
  try {
    const response = await fetch(new URL(entry.artifact, location.href), { cache: "no-store" });
    if (!response.ok) throw new Error(`public object unavailable (${String(response.status)})`);
    const blob = await response.blob();
    const file = new File([blob], `${entry.object_id}.tessaryn`, {
      type: "application/vnd.tessaryn.object",
      lastModified: 0,
    });
    await importCinematicFile(file, entry);
  } catch (error) {
    console.error(error);
    elements.importButton.disabled = false;
    elements.importButton.querySelector("span")!.textContent = "OPEN";
    showToast(error instanceof Error ? error.message.toUpperCase() : "PUBLIC OBJECT FAILED");
  }
}

function isPublicObjectCatalog(value: unknown): value is PublicObjectCatalog {
  if (!value || typeof value !== "object") return false;
  const catalog = value as Record<string, unknown>;
  return (
    catalog.schema === "tessaryn/public-object-catalog/v1" &&
    typeof catalog.updated_at_unix_us === "number" &&
    Array.isArray(catalog.objects) &&
    catalog.objects.length > 0 &&
    catalog.objects.every((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const object = entry as Record<string, unknown>;
      return (
        typeof object.object_id === "string" &&
        typeof object.title === "string" &&
        typeof object.artifact === "string" &&
        typeof object.cell_id === "string" &&
        typeof object.rootprint_branch === "string" &&
        typeof object.summary === "string"
      );
    })
  );
}

function populateMoments(moments: DemoMoment[]): void {
  elements.momentRail.replaceChildren();
  moments.forEach((moment, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.moment = moment.id;
    button.classList.toggle("active", index === moments.length - 1);
    button.setAttribute("aria-pressed", String(index === moments.length - 1));
    const label = document.createElement("b");
    const state = document.createElement("small");
    label.textContent = "0" + String(index + 1) + " / " + moment.label.split(" / ")[0];
    state.textContent = moment.environment.condition.toUpperCase();
    button.append(label, state);
    button.addEventListener("click", () => {
      document
        .querySelectorAll<HTMLButtonElement>("[data-moment]")
        .forEach((candidate) => {
          const active = candidate === button;
          candidate.classList.toggle("active", active);
          candidate.setAttribute("aria-pressed", String(active));
        });
      scene.setMoment(moment.id);
      selected = temporalCellsByMoment.get(moment.id) ?? selected;
      elements.momentShort.textContent = "MOMENT " + String.fromCharCode(65 + index);
      elements.originStatus.textContent = "MATERIALIZED / " + moment.label.toUpperCase();
      showToast(moment.label.toUpperCase());
    });
    elements.momentRail.append(button);
  });
}

function populateTemporalMoments(report: ValidationLocusBrowserReport): void {
  elements.momentRail.replaceChildren();
  report.moments.forEach((moment, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.moment = moment.id;
    button.classList.toggle("active", moment.id === "moment-c");
    button.setAttribute("aria-pressed", String(moment.id === "moment-c"));
    const label = document.createElement("b");
    const state = document.createElement("small");
    label.textContent = `0${String(index + 1)} / ${moment.label}`;
    state.textContent = `${String(moment.verification.surfels.length)} SURFELS`;
    button.append(label, state);
    button.addEventListener("click", () => {
      document
        .querySelectorAll<HTMLButtonElement>("[data-moment]")
        .forEach((candidate) => {
          const active = candidate === button;
          candidate.classList.toggle("active", active);
          candidate.setAttribute("aria-pressed", String(active));
        });
      scene.setMoment(moment.id);
      elements.momentShort.textContent = `MOMENT ${String.fromCharCode(65 + index)}`;
      elements.originStatus.textContent = `MATERIALIZED / ${moment.label}`;
      showToast(`${moment.label} / ${String(moment.verification.voxels)} SDF VOXELS`);
    });
    elements.momentRail.append(button);
  });
}

function updateCondensation(progress: number, phase: string): void {
  if (progress > 0 && runtimeMetrics.firstStructureMs === undefined) {
    runtimeMetrics.firstStructureMs = performance.now() - runtimeMetrics.bootStartedAtMs;
  }
  elements.condensation.style.width = String(Math.round(progress * 100)) + "%";
  if (!condensationComplete) {
    elements.originPhase.textContent = "ORIGIN / " + phase;
    elements.originStatus.textContent =
      progress < 1 ? "WORLD CELLS CONDENSING" : "MATERIALIZATION COMPLETE";
  }
}

function finishCondensation(): void {
  if (condensationComplete) return;
  condensationComplete = true;
  runtimeMetrics.materializedMs = performance.now() - runtimeMetrics.bootStartedAtMs;
  document.body.dataset.materialized = "true";
  elements.originPhase.textContent = "ORIGIN / MATERIALIZED";
  elements.originStatus.textContent = validationArtifact
    ? "ARCHVIZ TINY HOUSE / CONTINUUM STABLE"
    : "VESPER COURT / CONTINUUM STABLE";
  elements.evidenceShort.textContent = "LOCALLY VERIFIED";
  showToast(
    `${String(validationVerification?.cellsValid ?? latestVerification?.cellsValid ?? worldData.cells.length)} WORLD CELLS / CONTINUUM ASSEMBLED`,
  );
}

function openTrace(cell: DemoCell): void {
  selected = cell;
  closeChallenge();
  elements.traceDrawer.classList.add("open");
  elements.traceDrawer.setAttribute("aria-hidden", "false");
  elements.traceDrawer.removeAttribute("inert");
  elements.traceTitle.textContent = cell.label.toUpperCase();
  elements.traceClass.textContent = cell.manifest.class.toUpperCase();
  elements.traceCore.textContent = "VALID";
  elements.traceReplay.textContent = "BOUND";
  elements.traceDisclosure.textContent = cell.manifest.evidence.restricted ? "RESTRICTED" : "VISIBLE";
  elements.traceCellId.textContent = cell.cell_id;
  elements.tracePha.textContent = cell.proof.pha.phx_fingerprint;
  elements.traceRootprint.textContent = cell.proof.rootprint_id;
  elements.traceAnchor.textContent = cell.manifest.anchor_id;
  elements.traceSummary.textContent = cell.semantic_summary;
  elements.worldLabelTitle.textContent = cell.label.toUpperCase();
  elements.worldLabelState.textContent = evidenceLabel(cell);
  elements.worldLabel.hidden = false;
  populateEvidenceVector(cell);
  populateLineage(cell);
  activateTraceTab("evidence");
  scene.pullSelection();
}

function closeTrace(): void {
  elements.traceDrawer.classList.remove("open");
  elements.traceDrawer.setAttribute("aria-hidden", "true");
  elements.traceDrawer.setAttribute("inert", "");
  elements.worldLabel.hidden = true;
  scene.setInspectionLayer(null);
}

function populateEvidenceVector(cell: DemoCell): void {
  const evidence = cell.manifest.evidence;
  const rows: ReadonlyArray<readonly [string, string]> = [
    ["IDENTITY", evidence.identity_committed ? "COMMITTED" : "ABSENT"],
    ["REPLAY", evidence.replay_available ? "AVAILABLE" : "UNAVAILABLE"],
    ["SOURCE", evidence.source_attributed ? "ATTRIBUTED" : "UNATTRIBUTED"],
    ["FRESHNESS", cell.visual.moments.length === 3 ? "MULTI-MOMENT" : "MOMENT-BOUND"],
    ["TEMPORAL AUTHORITY", evidenceTemporalLabel(cell)],
    [
      "VALIDITY",
      cell.manifest.temporal_extent.valid_until_unix_us === null ? "OPEN" : "BOUNDED",
    ],
    [
      "SUPERSESSION",
      cell.manifest.temporal_extent.supersedes.length === 0
        ? "NONE"
        : String(cell.manifest.temporal_extent.supersedes.length) + " CELL",
    ],
    ["DISPUTE", evidence.disputed ? "RETAINED" : "NONE"],
    ["SLBIT", evidence.semantic_only ? "MEANING CELL" : "INDEPENDENTLY BOUND"],
  ];
  elements.evidenceVector.replaceChildren(
    ...rows.map(([label, value]) => {
      const row = document.createElement("span");
      const name = document.createElement("em");
      const state = document.createElement("b");
      name.textContent = label;
      state.textContent = value;
      row.append(name, state);
      return row;
    }),
  );
}

function populateLineage(cell: DemoCell): void {
  elements.lineagePath.replaceChildren();
  const parents = cell.manifest.parents.map((parent) => ({
    label: "PARENT CELL",
    digest: parent,
  }));
  const entries = [
    ...parents,
    { label: cell.label.toUpperCase(), digest: cell.cell_id },
    { label: "ROOTPRINT BRANCH", digest: cell.proof.rootprint_id },
  ];
  for (const entry of entries) {
    const row = document.createElement("span");
    const title = document.createElement("b");
    const digest = document.createElement("small");
    title.textContent = entry.label;
    digest.textContent = shortDigest(entry.digest, 22);
    row.append(title, digest);
    elements.lineagePath.append(row);
  }
}

function activateTraceTab(tab: string): void {
  document.querySelectorAll<HTMLButtonElement>("[data-trace-tab]").forEach((button) => {
    const active = button.dataset.traceTab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll<HTMLElement>(".trace-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === "trace-" + tab);
  });
  scene.setInspectionLayer(
    tab === "lineage" ? "lineage" : tab === "meaning" ? "meaning" : "state",
  );
}

function openChallenge(): void {
  closeTrace();
  elements.challengeDrawer.classList.add("open");
  elements.challengeDrawer.setAttribute("aria-hidden", "false");
  elements.challengeDrawer.removeAttribute("inert");
}

function closeChallenge(): void {
  elements.challengeDrawer.classList.remove("open");
  elements.challengeDrawer.setAttribute("aria-hidden", "true");
  elements.challengeDrawer.setAttribute("inert", "");
}

async function executeMutation(mutation: string): Promise<void> {
  try {
    const temporalSelected = temporalArtifactsByCell.get(selected.key);
    const semanticCapsule =
      activeCinematicObject?.envelope.cell_proof.memory_capsule ??
      importedArtifact?.observation_proof.memory_capsule ??
      temporalSelected?.sdf_proof.memory_capsule;
    const result = await runMutation(worldData, selected, mutation, semanticCapsule);
    const values = elements.rejectionTrace.querySelectorAll("dd");
    elements.rejectionTrace.querySelector("small")!.textContent = result.id.toUpperCase();
    elements.rejectionTrace.querySelector("b")!.textContent = result.code;
    if (values[0]) values[0].textContent = result.expectedLayer.toUpperCase();
    if (values[1]) values[1].textContent = result.actualLayer.toUpperCase();
    if (values[2]) values[2].textContent = result.coreUnchanged ? "YES" : "NO";
    elements.rejectionTrace.title = result.detail;
    elements.rejectionTrace.dataset.status =
      result.actualLayer === result.expectedLayer ? "rejected" : "mismatch";
    showToast(result.code);
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error));
  }
}

async function showVerification(): Promise<void> {
  if (!elements.verificationDialog.open) elements.verificationDialog.showModal();
  elements.verifyTitle.textContent = "VERIFYING LOCAL WORLD";
  for (const element of [
    elements.verifyCells,
    elements.verifyPha,
    elements.verifyRootprint,
    elements.verifyReplay,
    elements.verifyMemory,
  ]) {
    element.textContent = "PENDING";
  }
  if (activeCinematicObject) {
    renderCinematicVerification(activeCinematicObject);
    return;
  }
  if (activeLocalImport) {
    renderLocalFileVerification(activeLocalImport);
    return;
  }
  if (importedArtifact) {
    const report = await verifyReconstructionOffThread(importedArtifact);
    importedVerification = report;
    renderImportedVerification(report);
    return;
  }
  if (validationArtifact) {
    if (validationVerification) {
      renderValidationVerification(validationVerification);
      return;
    }
    const report = await verifyValidationOffThread(validationArtifact);
    validationVerification = report;
    latestVerification = validationVerificationReport(report);
    if (window.__tessaryn) {
      window.__tessaryn.validationVerification = report;
      window.__tessaryn.verification = latestVerification;
    }
    renderValidationVerification(report);
    return;
  }
  const report = await verifyWorldOffThread(worldData);
  latestVerification = report;
  if (window.__tessaryn) window.__tessaryn.verification = report;
  elements.verifyCells.textContent =
    String(report.cellsValid) + " / " + String(worldData.cells.length) + " VALID";
  elements.verifyPha.textContent =
    String(report.phaValid) + " / " + String(worldData.cells.length) + " VALID";
  elements.verifyRootprint.textContent = report.rootprintValid ? "VALID" : "INVALID";
  elements.verifyReplay.textContent = report.replayValid ? "VALID" : "INVALID";
  elements.verifyMemory.textContent = report.memoryValid ? "VALID" : "INVALID";
  elements.verifyTitle.textContent =
    report.errors.length === 0 ? "LOCAL WORLD ACCEPTED" : "VERIFICATION CAUTION";
  elements.verifyDetail.textContent =
    report.errors.length === 0
      ? `${String(report.cellsValid)} Cell identities, ${String(report.phaValid)} PHA bindings, Rootprint lineage, replay, and Memory Capsule verified locally.`
      : report.errors.join(" / ");
}

function renderValidationVerification(report: ValidationLocusBrowserReport): void {
  elements.verifyCells.textContent = `${String(report.cellsValid)} / 9 VALID`;
  elements.verifyPha.textContent = `${String(report.phaValid)} / 9 VALID`;
  elements.verifyRootprint.textContent = report.rootprintValid ? "VALID" : "INVALID";
  elements.verifyReplay.textContent = report.replayValid ? "VALID" : "INVALID";
  elements.verifyMemory.textContent = report.memoryValid ? "VALID" : "INVALID";
  elements.verifyTitle.textContent =
    report.errors.length === 0 ? "GROUND-TRUTH LOCUS ACCEPTED" : "VERIFICATION CAUTION";
  const surfels = report.moments.reduce(
    (total, moment) => total + moment.verification.surfels.length,
    report.alternate?.verification.surfels.length ?? 0,
  );
  const voxels = report.moments.reduce(
    (total, moment) => total + moment.verification.voxels,
    report.alternate?.verification.voxels ?? 0,
  );
  elements.verifyDetail.textContent =
    report.errors.length === 0
      ? `${String(surfels)} source-bound surfels and ${String(voxels)} SDF voxels verified across three Moments and one Rootprint branch.`
      : report.errors.join(" / ");
}

async function importLocalFile(): Promise<void> {
  const file = elements.importInput.files?.[0];
  elements.importInput.value = "";
  if (!file) return;
  if (file.name.toLowerCase().endsWith(".tessaryn")) {
    await importCinematicFile(file);
    return;
  }
  if (isJsonFile(file) && file.size <= MAX_INLINE_RECONSTRUCTION_BYTES) {
    await importReconstructionFile(file);
    return;
  }
  await openFileBackedArtifact(file);
}

async function importReconstructionFile(file: File): Promise<void> {
  elements.importButton.disabled = true;
  elements.importButton.querySelector("span")!.textContent = "READING";
  try {
    const parsed = parseStrictIntegerJson(await file.text());
    if (!isReconstructionArtifact(parsed)) {
      throw new Error("unsupported reconstruction artifact");
    }
    const verification = await verifyReconstructionOffThread(parsed);
    if (verification.errors.length > 0) {
      throw new Error(verification.errors.join(" / "));
    }
    closeLocalFile(false);
    const cell = reconstructionCell(parsed);
    importedArtifact = parsed;
    importedVerification = verification;
    if (window.__tessaryn) {
      window.__tessaryn.importedArtifact = parsed;
      window.__tessaryn.importedVerification = verification;
    }
    elements.app.dataset.source = "imported";
    selected = cell;
    scene.loadSurfelObservation(cell, verification.surfels);
    elements.originName.textContent = "LOCAL RGB-D LOCUS";
    elements.cellCount.textContent = "2 CELLS";
    elements.anchorShort.textContent = shortDigest(cell.manifest.anchor_id, 8);
    elements.momentShort.textContent = "CAPTURE";
    elements.evidenceShort.textContent = "FULLY REVERIFIED";
    elements.originPhase.textContent = "ORIGIN / IMPORTED CAPTURE";
    elements.originStatus.textContent = "SURFEL + SDF LOCUS MATERIALIZED";
    elements.condensation.style.width = "100%";
    elements.chronofoldButton.disabled = true;
    elements.chronofoldButton.classList.remove("active");
    populateImportedMoment(cell);
    showToast(`${String(verification.surfels.length)} SURFELS VERIFIED LOCALLY`);
    await showVerification();
  } catch (error) {
    console.error(error);
    showToast(error instanceof Error ? error.message.toUpperCase() : "IMPORT REJECTED");
  } finally {
    elements.importButton.disabled = false;
    elements.importButton.querySelector("span")!.textContent = "OPEN";
  }
}

async function importCinematicFile(
  file: File,
  requestedEntry: PublicObjectCatalogEntry | null = null,
): Promise<void> {
  elements.importButton.disabled = true;
  elements.importButton.querySelector("span")!.textContent = "VERIFYING";
  elements.app.dataset.source = "cinematic-loading";
  elements.cinematicControls.hidden = true;
  scene.prepareCinematicLoad();
  activeCinematicObject = null;
  if (window.__tessaryn) {
    delete window.__tessaryn.cinematicObject;
    delete window.__tessaryn.cinematicVerification;
  }
  const indexing = openFileBackedArtifact(file);
  try {
    elements.localStage.dataset.kind = "cinematic";
    elements.localKind.textContent = "NATIVE TEMPORAL OBJECT / VERIFYING";
    elements.localStatus.textContent = "READING COMMITTED OBJECT";
    const parsed = await parseAndVerifyCinematicObject(file, (progress) => {
      if (activeLocalImport?.file !== file) return;
      const percent =
        progress.totalBytes === 0
          ? 100
          : (progress.bytesRead / progress.totalBytes) * 100;
      elements.localStatus.textContent = `VERIFYING MEDIA / ${String(progress.chunksVerified)} CHUNKS`;
      elements.localProgress.style.width = `${percent.toFixed(3)}%`;
    });
    const publicEntry =
      requestedEntry ??
      publicObjectCatalog?.objects.find(
        (entry) =>
          entry.object_id === parsed.envelope.descriptor.object_id &&
          entry.cell_id === parsed.envelope.cell_proof.cell_id,
      ) ??
      null;
    const cell = cinematicCell(parsed.envelope);
    selected = cell;
    importedArtifact = null;
    importedVerification = null;
    await scene.loadCinematicObject(cell, parsed.envelope.descriptor, parsed.media);
    activeCinematicObject = {
      file,
      envelope: parsed.envelope,
      verification: parsed.report,
      publicEntry,
    };
    if (window.__tessaryn) {
      window.__tessaryn.cinematicObject = parsed.envelope;
      window.__tessaryn.cinematicVerification = parsed.report;
      delete window.__tessaryn.importedArtifact;
      delete window.__tessaryn.importedVerification;
    }
    await indexing;
    elements.app.dataset.source = "cinematic";
    elements.localStage.hidden = false;
    elements.localStage.dataset.kind = "cinematic";
    elements.localKind.textContent = publicEntry
      ? "PUBLIC OBJECT WEAVE / LOCALLY VERIFIED"
      : "LOCAL OBJECT / LOCALLY VERIFIED";
    elements.localName.textContent = parsed.envelope.descriptor.title;
    elements.localStatus.textContent = `${String(parsed.report.verifiedMediaChunks)} MEDIA CHUNKS + POWER HOUSE ACCEPTED`;
    elements.localSize.textContent = `${formatBytes(file.size)} / FILE-BACKED`;
    elements.localShare.disabled = publicEntry === null;
    elements.cinematicControls.hidden = false;
    elements.cinematicTime.value = "0";
    updateCinematicClock(0);
    syncCinematicPlayState();
    elements.originName.textContent = parsed.envelope.descriptor.title;
    elements.cellCount.textContent = `${String(parsed.envelope.descriptor.geometry.cell_count)} WORLD CELLS`;
    elements.anchorShort.textContent = shortDigest(
      parsed.envelope.cell_proof.manifest.anchor_id,
      8,
    );
    elements.momentShort.textContent = "ORIGIN";
    elements.evidenceShort.textContent = "POWER HOUSE ACCEPTED";
    elements.originPhase.textContent = "OBJECT / CONSTRUCTED";
    elements.originStatus.textContent = "CONSTRUCTED MEMORY / TEMPORAL FIELD LIVE";
    elements.condensation.style.width = "100%";
    elements.chronofoldButton.disabled = false;
    elements.challengeButton.disabled = false;
    elements.exportButton.disabled = false;
    elements.scaleBreath.disabled = false;
    chronofoldOpen = false;
    elements.chronofoldButton.classList.remove("active");
    elements.chronofoldButton.setAttribute("aria-pressed", "false");
    populateCinematicMoments(parsed.envelope.descriptor.moments);
    const route = new URL(location.href);
    if (publicEntry) route.searchParams.set("object", publicEntry.object_id);
    else route.searchParams.delete("object");
    history.replaceState(null, "", route);
    showToast(
      publicEntry
        ? "PUBLIC OBJECT FOUND / VERIFIED / CONSTRUCTED"
        : "LOCAL OBJECT VERIFIED / CONSTRUCTED",
    );
  } catch (error) {
    console.error(error);
    activeLocalTask?.cancel();
    await indexing;
    restoreValidationOrigin(false);
    showToast(error instanceof Error ? error.message.toUpperCase() : "OBJECT REJECTED");
  } finally {
    elements.importButton.disabled = false;
    elements.importButton.querySelector("span")!.textContent = "OPEN";
  }
}

function cinematicCell(envelope: CinematicObjectEnvelopeView): DemoCell {
  const descriptor = envelope.descriptor;
  const proof = envelope.cell_proof;
  return {
    key: `cinematic-${descriptor.object_id}`,
    label: descriptor.title,
    cell_id: proof.cell_id,
    manifest: proof.manifest,
    channel_payload: {
      descriptor_chunk_id: envelope.descriptor_chunk_id,
      media_chunk_root: envelope.media.chunk_merkle_root,
      object_id: descriptor.object_id,
    },
    visual: {
      primitive: "cinematic-object",
      position_mm: [0, 1_550, 0],
      size_mm: descriptor.geometry.bounds_um.map((value) => Math.round(value / 1_000)) as [
        number,
        number,
        number,
      ],
      rotation_mdeg: [0, 0, 0],
      color: "#d7d0bd",
      material: "cinematic-matter",
      seed: descriptor.geometry.seed,
      moments: descriptor.moments.map((moment) => moment.id),
    },
    semantic_summary: descriptor.slbit.summary,
    proof: {
      pha: proof.pha,
      rootprint_id: proof.rootprint.root_branch,
      replay_fingerprint: proof.replay_fingerprint,
    },
  };
}

function populateCinematicMoments(moments: CinematicMomentView[]): void {
  elements.momentRail.replaceChildren();
  moments.forEach((moment, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.moment = moment.id;
    button.classList.toggle("active", index === 0);
    button.setAttribute("aria-pressed", String(index === 0));
    const label = document.createElement("b");
    const state = document.createElement("small");
    label.textContent = `${String(index + 1).padStart(2, "0")} / ${moment.label}`;
    state.textContent = formatMilliseconds(moment.time_ms);
    button.append(label, state);
    button.addEventListener("click", () => {
      elements.momentRail.querySelectorAll("button").forEach((candidate) => {
        const active = candidate === button;
        candidate.classList.toggle("active", active);
        candidate.setAttribute("aria-pressed", String(active));
      });
      scene.setMoment(moment.id);
      const duration = activeCinematicObject?.envelope.descriptor.duration_ms ?? 1;
      const position = moment.time_ms / duration;
      elements.cinematicTime.value = String(Math.round(position * 1_000));
      updateCinematicClock(position);
      elements.momentShort.textContent = moment.label.toUpperCase();
      elements.originStatus.textContent = moment.meaning.toUpperCase();
    });
    elements.momentRail.append(button);
  });
}

function renderCinematicVerification(active: ActiveCinematicObject): void {
  const report = active.verification;
  const envelope = active.envelope;
  elements.verifyCells.textContent = report.cellValid
    ? `1 CELL + ${String(report.verifiedMediaChunks)} CHUNKS`
    : "INVALID";
  elements.verifyPha.textContent = report.phaValid ? "VALID" : "INVALID";
  elements.verifyRootprint.textContent = report.rootprintValid ? "VALID" : "INVALID";
  elements.verifyReplay.textContent = report.replayValid ? "VALID" : "INVALID";
  elements.verifyMemory.textContent = report.memoryValid ? "VALID" : "INVALID";
  elements.verifyTitle.textContent = report.accepted
    ? "NATIVE TEMPORAL OBJECT ACCEPTED"
    : "OBJECT REJECTED";
  elements.verifyDetail.textContent = report.accepted
    ? `${envelope.descriptor.title}: authored geometry, ${String(report.verifiedMediaChunks)} cinematic chunks, Cell identity, PHA, Rootprint replay, Memory Capsule, and SLBIT binding verified from local bytes.`
    : report.errors.join(" / ");
}

async function openFileBackedArtifact(file: File): Promise<void> {
  const previousSource = activeLocalImport?.previousSource ?? elements.app.dataset.source;
  const previousOriginName =
    activeLocalImport?.previousOriginName ?? elements.originName.textContent ?? "";
  const previousCellCount =
    activeLocalImport?.previousCellCount ?? elements.cellCount.textContent ?? "";
  closeLocalFile(false);
  const state: ActiveLocalImport = {
    file,
    kind: localFileKind(file),
    status: "indexing",
    identity: null,
    progress: { bytesRead: 0, totalBytes: file.size, chunksRead: 0 },
    previousSource,
    previousOriginName,
    previousCellCount,
  };
  activeLocalImport = state;
  elements.app.dataset.source = "local-file";
  elements.localStage.dataset.kind = state.kind;
  elements.localStage.hidden = false;
  elements.localName.textContent = file.name || "UNNAMED LOCAL FILE";
  elements.originName.textContent = file.name || "UNNAMED LOCAL FILE";
  elements.cellCount.textContent = "1 LOCAL FILE";
  elements.localKind.textContent =
    state.kind === "video"
      ? "RAW VIDEO / INDEX ONLY / NOT WORLD GEOMETRY"
      : `LOCAL ${state.kind.toUpperCase()} / FILE-BACKED`;
  elements.localStatus.textContent = "INDEXING LOCAL BYTES";
  elements.localSize.textContent = `${formatBytes(file.size)} / 0%`;
  elements.localRoot.textContent = "STREAM ROOT PENDING";
  elements.localProgress.style.width = "0%";
  elements.localExport.disabled = true;
  elements.chronofoldButton.disabled = true;
  elements.challengeButton.disabled = true;
  elements.exportButton.disabled = true;
  elements.scaleBreath.disabled = true;
  syncLocalImportView();
  showToast(`LOCAL STREAM OPEN / ${formatBytes(file.size)} / NO UPLOAD`);

  const task = indexLocalFileOffThread(file, (progress) => {
    if (activeLocalImport !== state) return;
    state.progress = progress;
    const percent =
      progress.totalBytes === 0 ? 100 : (progress.bytesRead / progress.totalBytes) * 100;
    elements.localStatus.textContent = `INDEXING / ${String(progress.chunksRead)} CHUNKS`;
    elements.localSize.textContent = `${formatBytes(file.size)} / ${percent.toFixed(1)}%`;
    elements.localRoot.textContent = `${formatBytes(progress.bytesRead)} READ / BOUNDED MEMORY`;
    elements.localProgress.style.width = `${percent.toFixed(3)}%`;
    syncLocalImportView();
  });
  activeLocalTask = task;

  try {
    const identity = await task.result;
    if (activeLocalImport !== state) return;
    state.status = "indexed";
    state.identity = identity;
    state.progress = {
      bytesRead: identity.byteLength,
      totalBytes: identity.byteLength,
      chunksRead: identity.chunkCount,
    };
    activeLocalTask = null;
    elements.localStatus.textContent = `LOCAL STREAM INDEXED / ${String(identity.chunkCount)} CHUNKS`;
    elements.localSize.textContent = `${formatBytes(file.size)} / 100%`;
    elements.localRoot.textContent = identity.streamRoot;
    elements.localProgress.style.width = "100%";
    elements.localExport.disabled = false;
    elements.exportButton.disabled = false;
    syncLocalImportView();
    showToast("LOCAL STREAM ROOT COMPLETE");
  } catch (error) {
    if (
      activeLocalImport !== state ||
      (error instanceof DOMException && error.name === "AbortError")
    ) {
      return;
    }
    state.status = "error";
    state.error = error instanceof Error ? error.message : String(error);
    activeLocalTask = null;
    elements.localStatus.textContent = "LOCAL INDEX FAILED";
    elements.localRoot.textContent = state.error.toUpperCase();
    syncLocalImportView();
    showToast("LOCAL INDEX FAILED");
  }
}

function closeLocalFile(restoreSource = true): void {
  const active = activeLocalImport;
  activeLocalTask?.cancel();
  activeLocalTask = null;
  elements.localStage.hidden = true;
  elements.localExport.disabled = true;
  elements.localShare.disabled = true;
  elements.localStage.removeAttribute("data-kind");
  activeLocalImport = null;
  if (window.__tessaryn) delete window.__tessaryn.localImport;
  if (!restoreSource) return;
  if (active?.previousSource) elements.app.dataset.source = active.previousSource;
  else delete elements.app.dataset.source;
  if (active) {
    elements.originName.textContent = active.previousOriginName;
    elements.cellCount.textContent = active.previousCellCount;
  }
  elements.chronofoldButton.disabled = importedArtifact !== null;
  elements.challengeButton.disabled = false;
  elements.exportButton.disabled = false;
  elements.scaleBreath.disabled = false;
  showToast("LOCAL STREAM CLOSED");
}

function syncLocalImportView(): void {
  if (!window.__tessaryn || !activeLocalImport) return;
  const active = activeLocalImport;
  window.__tessaryn.localImport = {
    name: active.file.name,
    mediaType: active.file.type || "application/octet-stream",
    bytes: active.file.size,
    kind: active.kind,
    status: active.status,
    bytesRead: active.progress.bytesRead,
    chunkCount: active.identity?.chunkCount ?? active.progress.chunksRead,
    streamRoot: active.identity?.streamRoot,
  };
}

function isReconstructionArtifact(value: unknown): value is ReconstructionArtifactView {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { schema?: unknown }).schema === "tessaryn/reconstruction-artifact/v0" &&
    typeof (value as { report?: unknown }).report === "object"
  );
}

function isValidationLocusArtifact(value: unknown): value is ValidationLocusArtifactView {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { schema?: unknown }).schema === "tessaryn/validation-locus-artifact/v1" &&
    Array.isArray((value as { moments?: unknown }).moments)
  );
}

function isValidationPortfolio(value: unknown): value is ValidationPortfolio {
  if (
    typeof value !== "object" ||
    value === null ||
    (value as { schema?: unknown }).schema !== "tessaryn/validation-portfolio/v1" ||
    !Array.isArray((value as { entries?: unknown }).entries)
  ) {
    return false;
  }
  const entries = (value as { entries: unknown[] }).entries;
  return (
    entries.length >= 2 &&
    entries.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        ["synthetic_ground_truth", "real_sensor"].includes(
          String((entry as { source_class?: unknown }).source_class),
        ),
    )
  );
}

function reconstructionCell(
  artifact: ReconstructionArtifactView,
  options: {
    key?: string;
    label?: string;
    momentId?: string;
    layer?: "observation" | "sdf";
    alternate?: boolean;
  } = {},
): DemoCell {
  const useSdf = options.layer === "sdf";
  const proof = useSdf ? artifact.sdf_proof : artifact.observation_proof;
  const packet = proof.memory_capsule.semantics?.packets?.[0]?.packet as
    | { summary?: unknown }
    | undefined;
  return {
    key: options.key ?? "imported-rgbd-observation",
    label: options.label ?? "IMPORTED RGB-D OBSERVATION",
    cell_id: useSdf ? artifact.report.sdf_cell_id : artifact.report.observation.cell_id,
    manifest: useSdf ? artifact.report.sdf_manifest : artifact.report.observation.manifest,
    channel_payload: {},
    visual: {
      primitive: "surfel",
      position_mm: [0, 1_000, 0],
      size_mm: [1_000, 1_000, 1_000],
      rotation_mdeg: [0, 0, 0],
      color: options.alternate ? "#db806d" : "#74c8c1",
      material: useSdf ? "verified-surfel-sdf-field" : "captured-surfel-field",
      seed: 0,
      moments: options.momentId
        ? [options.momentId]
        : worldData.moments.map((moment) => moment.id),
      branch: options.alternate ? "alternate-observation" : undefined,
    },
    semantic_summary:
      typeof packet?.summary === "string"
        ? packet.summary
        : "Privacy-filtered RGB-D observation with a locally verified Cell identity.",
    proof: {
      pha: proof.pha,
      rootprint_id: proof.rootprint.root_branch,
      replay_fingerprint: proof.replay_fingerprint,
    },
  };
}

function temporalObservations(report: ValidationLocusBrowserReport): TemporalObservation[] {
  if (!validationArtifact) throw new Error("validation artifact unavailable");
  const activeValidationArtifact = validationArtifact;
  temporalArtifactsByCell.clear();
  temporalCellsByMoment.clear();
  const values = [
    ...report.moments.map((moment) => ({ ...moment, alternate: false })),
    ...(report.alternate ? [{ ...report.alternate, alternate: true }] : []),
  ];
  const sourceStates = [
    ...activeValidationArtifact.moments,
    activeValidationArtifact.alternate,
  ];
  return values.map((moment, index) => {
    const artifact = sourceStates[index]?.artifact;
    if (!artifact) throw new Error(`${moment.id}: temporal artifact binding unavailable`);
    const cell = reconstructionCell(artifact, {
      key: `validation-${moment.id}`,
      label: `${moment.label} / VERIFIED SDF`,
      momentId: moment.id,
      layer: "sdf",
      alternate: moment.alternate,
    });
    cell.semantic_summary = `${moment.label} from TartanAir V2 ArchViz Tiny House exact RGB-D ground truth. ${String(moment.verification.surfels.length)} color surfels and ${String(moment.verification.voxels)} sparse-SDF voxels assemble this state.`;
    temporalArtifactsByCell.set(cell.key, artifact);
    temporalCellsByMoment.set(moment.id, cell);
    return {
      id: moment.id,
      label: moment.label,
      cell,
      surfels: moment.verification.surfels,
      sdfVoxels: moment.verification.sdfVoxels,
      voxelSizeUm: moment.verification.voxelSizeUm,
      alternate: moment.alternate,
      coordinateFrame: activeValidationArtifact.source.profile.sensor.coordinate_frame,
    };
  });
}

function validationVerificationReport(
  report: ValidationLocusBrowserReport,
): VerificationReport {
  return {
    cellsValid: report.cellsValid,
    phaValid: report.phaValid,
    rootprintValid: report.rootprintValid,
    replayValid: report.replayValid,
    memoryValid: report.memoryValid,
    disputedCells: report.alternate ? 1 : 0,
    restrictedCells: 0,
    errors: [...report.errors],
  };
}

function populateImportedMoment(cell: DemoCell): void {
  elements.momentRail.replaceChildren();
  const button = document.createElement("button");
  button.type = "button";
  button.className = "active";
  button.setAttribute("aria-pressed", "true");
  const label = document.createElement("b");
  const state = document.createElement("small");
  label.textContent = "01 / CAPTURE INTERVAL";
  state.textContent = `${String(cell.manifest.temporal_extent.start_unix_us)} - ${String(cell.manifest.temporal_extent.end_unix_us)}`;
  button.append(label, state);
  elements.momentRail.append(button);
}

function renderImportedVerification(report: ReconstructionBrowserReport): void {
  elements.verifyCells.textContent = `${String(report.cellsValid)} / 2 VALID`;
  elements.verifyPha.textContent = `${String(report.phaValid)} / 2 VALID`;
  elements.verifyRootprint.textContent = report.rootprintValid ? "VALID" : "INVALID";
  elements.verifyReplay.textContent = report.replayValid ? "VALID" : "INVALID";
  elements.verifyMemory.textContent = report.memoryValid ? "VALID" : "INVALID";
  elements.verifyTitle.textContent =
    report.errors.length === 0 ? "LOCAL CAPTURE ACCEPTED" : "VERIFICATION CAUTION";
  elements.verifyDetail.textContent =
    report.errors.length === 0
      ? `${String(report.surfels.length)} surfels and ${String(report.voxels)} SDF voxels verified from the portable reconstruction artifact.`
      : report.errors.join(" / ");
}

function renderLocalFileVerification(state: ActiveLocalImport): void {
  const percent =
    state.progress.totalBytes === 0
      ? 100
      : (state.progress.bytesRead / state.progress.totalBytes) * 100;
  elements.verifyCells.textContent = state.identity
    ? "STREAM ROOT"
    : `${percent.toFixed(1)}% INDEXED`;
  elements.verifyPha.textContent = "NOT ATTACHED";
  elements.verifyRootprint.textContent = "LOCAL INDEX";
  elements.verifyReplay.textContent = state.identity
    ? `${String(state.identity.chunkCount)} CHUNKS`
    : "IN PROGRESS";
  elements.verifyMemory.textContent = "FILE-BACKED";
  elements.verifyTitle.textContent =
    state.status === "indexed"
      ? "LOCAL FILE INDEXED"
      : state.status === "error"
        ? "LOCAL INDEX CAUTION"
        : "INDEXING LOCAL FILE";
  elements.verifyDetail.textContent = state.identity
    ? `${formatBytes(state.file.size)} indexed through fixed ` +
      `${formatBytes(state.identity.chunkBytes)} windows with bounded memory. ` +
      `Stream root ${state.identity.streamRoot}.`
    : state.error ??
      `${formatBytes(state.progress.bytesRead)} of ${formatBytes(state.file.size)} read directly from local storage.`;
}

function exportCapsule(): void {
  if (activeLocalImport && !activeCinematicObject) {
    exportLocalFileIndex(activeLocalImport);
    return;
  }
  const temporalSelected = temporalArtifactsByCell.get(selected.key);
  const capsule =
    activeCinematicObject?.envelope.cell_proof.memory_capsule ??
    importedArtifact?.sdf_proof.memory_capsule ??
    temporalSelected?.sdf_proof.memory_capsule ??
    worldData.origin_memory_capsule;
  const bytes = JSON.stringify(capsule, null, 2) + "\n";
  const blob = new Blob([bytes], { type: "application/vnd.powerhouse.memory+json" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = activeCinematicObject
    ? `${activeCinematicObject.envelope.descriptor.object_id}.phm`
    : importedArtifact
    ? "tessaryn-imported-sdf.phm"
    : temporalSelected
      ? `${selected.key}.phm`
      : "vesper-court-origin.phm";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1_000);
  showToast("MEMORY CAPSULE EXPORTED");
}

function exportLocalFileIndex(state: ActiveLocalImport): void {
  if (!state.identity) {
    showToast("STREAM ROOT STILL INDEXING");
    return;
  }
  const index = {
    ...state.identity,
    file: {
      name: state.file.name,
      media_type: state.file.type || "application/octet-stream",
      last_modified_unix_ms: state.file.lastModified,
    },
  };
  const blob = new Blob([JSON.stringify(index, null, 2) + "\n"], {
    type: "application/json",
  });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `${safeFileStem(state.file.name)}.tessaryn-index.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1_000);
  showToast("LOCAL FILE INDEX EXPORTED");
}

function updateScaleButtons(scale: ScaleMode): void {
  document.querySelectorAll<HTMLButtonElement>("[data-scale]").forEach((button) => {
    const active = button.dataset.scale === scale;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (!chronofoldOpen) {
    elements.originPhase.textContent =
      scale === "object"
        ? "LOCUS / INSIDE-OUT DEPTH"
        : scale === "site"
          ? "LOCUS / AGGREGATE FIELD"
          : "ORIGIN / MATERIALIZED";
  }
}

function updateScaleDepth(value: number): void {
  elements.scaleBreath.value = String(Math.round(value * 1_000));
  elements.scaleBreath.style.setProperty("--scale-position", `${String(value * 100)}%`);
}

function updateWorldLabel(): void {
  if (!scene) return;
  if (activeCinematicObject && !cinematicScrubbing) {
    const position = scene.cinematicTime();
    elements.cinematicTime.value = String(Math.round(position * 1_000));
    updateCinematicClock(position);
    syncCinematicPlayState();
  }
  const projected = scene.selectedScreenPosition();
  if (!projected || !projected.visible || !elements.traceDrawer.classList.contains("open")) {
    elements.worldLabel.hidden = true;
  } else {
    elements.worldLabel.hidden = false;
    elements.worldLabel.style.left = String(Math.round(projected.x)) + "px";
    elements.worldLabel.style.top = String(Math.round(projected.y)) + "px";
  }
  requestAnimationFrame(updateWorldLabel);
}

function restoreValidationOrigin(notify = true): void {
  activeCinematicObject = null;
  if (window.__tessaryn) {
    delete window.__tessaryn.cinematicObject;
    delete window.__tessaryn.cinematicVerification;
  }
  closeLocalFile(false);
  elements.cinematicControls.hidden = true;
  elements.localShare.disabled = true;
  chronofoldOpen = false;
  elements.chronofoldButton.classList.remove("active");
  elements.chronofoldButton.setAttribute("aria-pressed", "false");
  if (!validationVerification) return;
  const observations = temporalObservations(validationVerification);
  scene.loadTemporalObservations(observations);
  scene.setMoment("moment-c");
  evidenceVisible = true;
  scene.setEvidence(true);
  elements.evidenceButton.classList.add("active");
  elements.evidenceButton.setAttribute("aria-pressed", "true");
  selected =
    observations.find((observation) => observation.id === "moment-c")?.cell ??
    observations[0]?.cell ??
    selected;
  elements.app.dataset.source = "validation";
  elements.originName.textContent = validationArtifact?.origin ?? "ARCHVIZ TINY HOUSE";
  elements.cellCount.textContent = `${String(validationVerification.cellsValid)} CELLS`;
  elements.anchorShort.textContent = shortDigest(selected.manifest.anchor_id, 8);
  elements.momentShort.textContent = "MOMENT C";
  elements.evidenceShort.textContent = "LOCALLY VERIFIED";
  elements.originPhase.textContent = "ORIGIN / MATERIALIZED";
  elements.originStatus.textContent = "ARCHVIZ TINY HOUSE / CONTINUUM STABLE";
  elements.condensation.style.width = "100%";
  elements.chronofoldButton.disabled = false;
  elements.challengeButton.disabled = false;
  elements.exportButton.disabled = false;
  elements.scaleBreath.disabled = false;
  populateTemporalMoments(validationVerification);
  const route = new URL(location.href);
  route.searchParams.delete("object");
  history.replaceState(null, "", route);
  if (notify) showToast("VALIDATION ORIGIN RESTORED");
}

async function shareActiveObject(): Promise<void> {
  const entry = activeCinematicObject?.publicEntry;
  if (!entry) return;
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("object", entry.object_id);
  try {
    if (navigator.share) {
      await navigator.share({ title: entry.title, text: entry.summary, url: url.toString() });
    } else {
      await navigator.clipboard.writeText(url.toString());
      showToast("PUBLIC OBJECT LINK COPIED");
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    await navigator.clipboard.writeText(url.toString());
    showToast("PUBLIC OBJECT LINK COPIED");
  }
}

async function toggleCinematicPlayback(): Promise<void> {
  const next = !scene.cinematicPlaying();
  try {
    await scene.setCinematicPlaying(next);
    syncCinematicPlayState();
  } catch (error) {
    showToast(error instanceof Error ? error.message.toUpperCase() : "TEMPORAL PLAYBACK FAILED");
  }
}

function syncCinematicPlayState(): void {
  const playing = scene.cinematicPlaying();
  elements.cinematicPlay.classList.toggle("playing", playing);
  elements.cinematicPlay.setAttribute("aria-pressed", String(playing));
  elements.cinematicPlay.title = playing ? "Pause temporal object" : "Play temporal object";
}

function updateCinematicClock(position: number): void {
  const duration = activeCinematicObject?.envelope.descriptor.duration_ms ?? 0;
  elements.cinematicClock.value = formatMilliseconds(Math.round(duration * position));
}

function evidenceLabel(cell: DemoCell): string {
  if (cell.manifest.evidence.restricted) return "RESTRICTED / GEOMETRY ABSENT";
  if (cell.manifest.evidence.disputed) return "DISPUTED / BRANCH RETAINED";
  if (cell.manifest.evidence.semantic_only) return "SLBIT / LIVING MEANING";
  return "IDENTITY / ROOTPRINT ALIGNED";
}

function evidenceTemporalLabel(cell: DemoCell): string {
  return cell.manifest.temporal_extent.state_kind.toUpperCase();
}

async function toggleFullscreen(): Promise<void> {
  if (document.fullscreenElement) await document.exitFullscreen();
  else await elements.app.requestFullscreen();
}

function updateNetworkState(): void {
  elements.networkState.innerHTML = "";
  const signal = document.createElement("i");
  elements.networkState.append(signal, document.createTextNode(navigator.onLine ? "LOCAL" : "OFFLINE READY"));
}

function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  navigator.serviceWorker.register("./sw.js").catch((error) => console.warn("service worker", error));
}

function showToast(message: string): void {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("visible"), 2_200);
}

function isJsonFile(file: File): boolean {
  return file.type === "application/json" || file.name.toLowerCase().endsWith(".json");
}

function localFileKind(file: File): LocalFileKind {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  if (type.startsWith("video/") || /\.(mp4|m4v|mov|webm|ogv|mkv)$/.test(name)) {
    return "video";
  }
  if (type.startsWith("image/") || /\.(avif|bmp|gif|jpe?g|png|webp)$/.test(name)) {
    return "image";
  }
  if (type.startsWith("audio/") || /\.(aac|flac|m4a|mp3|oga|ogg|wav)$/.test(name)) {
    return "audio";
  }
  return "binary";
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${String(bytes)} B`;
  const units = ["KiB", "MiB", "GiB", "TiB", "PiB"];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1_024;
    unit += 1;
  } while (value >= 1_024 && unit < units.length - 1);
  const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unit] ?? "B"}`;
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const remainder = total % 60;
  return hours > 0
    ? `${String(hours)}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes)}:${String(remainder).padStart(2, "0")}`;
}

function formatMilliseconds(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds));
  const minutes = Math.floor(total / 60_000);
  const seconds = Math.floor((total % 60_000) / 1_000);
  const remainder = total % 1_000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(remainder).padStart(3, "0")}`;
}

function safeFileStem(name: string): string {
  const stem = name.replace(/\.[^.]+$/, "").replace(/[^a-z0-9._-]+/gi, "-");
  return stem.replace(/^-+|-+$/g, "") || "tessaryn-local-file";
}

function shortDigest(value: string, length: number): string {
  if (value.length <= length + 7) return value;
  return value.slice(0, length) + "..." + value.slice(-6);
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error("missing interface element: " + id);
  return element as T;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function fail(message: string): never {
  throw new Error(message);
}
