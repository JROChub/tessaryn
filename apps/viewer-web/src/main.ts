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
  RotateCcw,
  Scan,
  ShieldCheck,
  Upload,
  Waypoints,
  X,
  createIcons,
} from "lucide";
import "./style.css";
import type {
  DatasetProfileView,
  DemoCell,
  DemoMoment,
  DemoWorld,
  ReconstructionArtifactView,
  ReconstructionBrowserReport,
  ValidationLocusArtifactView,
  ValidationLocusBrowserReport,
  VerificationReport,
} from "./types";
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
import {
  hydrateVideoLocusArtifact,
  reconstructVideoToLocus,
  type VideoReconstructionProgress,
  type VideoReconstructionResult,
} from "./video-reconstruction";

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
      videoReconstruction?: VideoReconstructionResult;
      videoVerification?: VerificationReport;
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
type LocalImportStatus =
  | "indexing"
  | "indexed"
  | "reconstructing"
  | "materialized"
  | "error";

interface LocalImportView {
  name: string;
  mediaType: string;
  bytes: number;
  kind: LocalFileKind;
  status: LocalImportStatus;
  bytesRead: number;
  chunkCount: number;
  streamRoot?: string;
  worldCells?: number;
  surfels?: number;
  surfaceVoxels?: number;
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
  reconstruction?: VideoReconstructionResult;
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
  localKind: byId<HTMLElement>("local-kind"),
  localName: byId<HTMLElement>("local-name"),
  localStatus: byId<HTMLElement>("local-status"),
  localSize: byId<HTMLElement>("local-size"),
  localRoot: byId<HTMLElement>("local-root"),
  localProgress: byId<HTMLElement>("local-progress"),
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
let validationPortfolio: ValidationPortfolio | null = null;
const temporalArtifactsByCell = new Map<string, ReconstructionArtifactView>();
const temporalCellsByMoment = new Map<string, DemoCell>();
let chronofoldOpen = false;
let evidenceVisible = true;
let condensationComplete = false;
let toastTimer = 0;
let activeLocalImport: ActiveLocalImport | null = null;
let activeLocalTask: LocalIngestTask | null = null;
let activeReconstructionAbort: AbortController | null = null;
let videoReconstruction: VideoReconstructionResult | null = null;
let videoVerification: VerificationReport | null = null;
const MAX_INLINE_RECONSTRUCTION_BYTES = 64 * 1024 * 1024;
const runtimeMetrics: RuntimeMetrics = {
  bootStartedAtMs: performance.now(),
};

void boot();

async function boot(): Promise<void> {
  try {
    elements.bootStatus.textContent = "READING LOCAL CELL MANIFESTS";
    const [worldResponse, validationResponse, portfolioResponse] = await Promise.all([
      fetch("./world/vesper-court.json", { cache: "no-store" }),
      fetch("./world/archviz-tiny-house-locus.json", { cache: "no-store" }),
      fetch("./validation/portfolio.json", { cache: "no-store" }),
    ]);
    if (!worldResponse.ok) throw new Error("world fixture unavailable");
    if (!validationResponse.ok) throw new Error("validation Locus unavailable");
    if (!portfolioResponse.ok) throw new Error("validation portfolio unavailable");
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
    validationPortfolio = parsedPortfolio;
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
        RotateCcw,
        Scan,
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
  elements.importButton.addEventListener("click", () => elements.importInput.click());
  elements.importInput.addEventListener("change", () => void importLocalFile());
  elements.localClose.addEventListener("click", () => closeLocalFile());
  elements.localExport.addEventListener("click", () => {
    if (!activeLocalImport) return;
    if (activeLocalImport.reconstruction) exportVideoLocus(activeLocalImport.reconstruction);
    else exportLocalFileIndex(activeLocalImport);
  });
  elements.verifyClose.addEventListener("click", () => elements.verificationDialog.close());
  elements.fullscreenButton.addEventListener("click", () => void toggleFullscreen());
  elements.traceClose.addEventListener("click", closeTrace);
  elements.challengeClose.addEventListener("click", closeChallenge);
  elements.challengeButton.addEventListener("click", openChallenge);
  elements.exportButton.addEventListener("click", exportCapsule);
  elements.resetButton.addEventListener("click", () => {
    if (activeLocalImport && !activeLocalImport.reconstruction) {
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
    showToast(chronofoldOpen ? "THREE MOMENTS OPEN" : "CURRENT MOMENT RESTORED");
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
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (activeLocalImport) closeLocalFile();
    closeTrace();
    closeChallenge();
    if (elements.verificationDialog.open) elements.verificationDialog.close();
    if (elements.sourcesDialog.open) elements.sourcesDialog.close();
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

function populateVideoSource(result: VideoReconstructionResult): void {
  elements.sourceName.textContent = result.source.name;
  elements.sourceClass.textContent = "LOCAL VIDEO / PRIVATE BY DEFAULT";
  elements.sourceEnvironment.textContent = `${String(result.source.width)}x${String(result.source.height)} / ${(result.source.durationMs / 1_000).toFixed(2)} SEC`;
  elements.sourceSensor.textContent = `${String(result.profile.sampledFrames)} DECODED FRAMES / SOURCE STREAM`;
  elements.sourceGroundTruth.textContent = "RELATIVE DEPTH / IMAGE REGISTRATION";
  elements.sourceAssets.textContent = `1 / ${formatBytes(result.source.bytes)}`;
  elements.sourceProfileId.textContent = `${result.profile.depthModel}@${result.profile.depthModelRevision.slice(0, 12)}`;
  const rows = [
    {
      title: "SOURCE COMMITMENT",
      layer: "FILE-BACKED / LOCAL",
      summary: shortDigest(result.source.streamRoot, 28),
      modalities: "4 MIB STREAM WINDOWS / BOUNDED MEMORY",
      state: "BOUND",
    },
    {
      title: "RELATIVE DEPTH",
      layer: result.profile.depthMode.replaceAll("-", " ").toUpperCase(),
      summary: result.profile.depthModel,
      modalities: result.profile.depthModelSha256,
      state: "PINNED",
    },
    {
      title: "TEMPORAL REGISTRATION",
      layer: "SHOT-AWARE / THREE MOMENTS",
      summary: `${String(result.profile.shotDiscontinuities)} discontinuities retained during temporal grouping.`,
      modalities: result.profile.poseMode.replaceAll("-", " ").toUpperCase(),
      state: "REPLAYABLE",
    },
    {
      title: "WORLD CONSTRUCTION",
      layer: `${String(result.metrics.worldCells)} CELLS / ${String(result.metrics.rootprintBranches)} ROOTPRINT STATES`,
      summary: `${String(result.metrics.surfels)} surfels and ${String(result.metrics.surfaceVoxels)} surface-field cells.`,
      modalities: "PHA + ROOTPRINT + MEMORY CAPSULE + SLBIT",
      state: "VERIFIED",
    },
  ];
  elements.portfolioList.replaceChildren(
    ...rows.map((entry) => {
      const row = document.createElement("div");
      row.className = "portfolio-row";
      const identity = document.createElement("span");
      const title = document.createElement("b");
      const layer = document.createElement("small");
      title.textContent = entry.title;
      layer.textContent = entry.layer;
      identity.append(title, layer);
      const evidence = document.createElement("span");
      const summary = document.createElement("p");
      const modalities = document.createElement("small");
      summary.textContent = entry.summary;
      modalities.textContent = entry.modalities;
      evidence.append(summary, modalities);
      const state = document.createElement("em");
      state.textContent = entry.state;
      row.append(identity, evidence, state);
      return row;
    }),
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
  elements.originStatus.textContent = videoReconstruction
    ? "4D LOCUS / CONTINUUM STABLE"
    : validationArtifact
      ? "ARCHVIZ TINY HOUSE / CONTINUUM STABLE"
      : "VESPER COURT / CONTINUUM STABLE";
  elements.evidenceShort.textContent = "LOCALLY VERIFIED";
  showToast(
    `${String(videoReconstruction?.metrics.worldCells ?? validationVerification?.cellsValid ?? latestVerification?.cellsValid ?? worldData.cells.length)} WORLD CELLS / CONTINUUM ASSEMBLED`,
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
      videoReconstruction?.memoryCapsule ??
      importedArtifact?.observation_proof.memory_capsule ??
      temporalSelected?.sdf_proof.memory_capsule;
    const mutationWorld = videoReconstruction?.world ?? worldData;
    const result = await runMutation(mutationWorld, selected, mutation, semanticCapsule);
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
  if (activeLocalImport) {
    if (activeLocalImport.reconstruction && videoVerification) {
      renderVideoVerification(activeLocalImport.reconstruction, videoVerification);
    } else {
      renderLocalFileVerification(activeLocalImport);
    }
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
  if (
    file.size <= MAX_INLINE_RECONSTRUCTION_BYTES &&
    (isJsonFile(file) || (await hasJsonObjectPrefix(file)))
  ) {
    await importReconstructionFile(file);
    return;
  }
  if (localFileKind(file) === "video") {
    await reconstructVideoFile(file);
    return;
  }
  await openFileBackedArtifact(file);
}

async function importReconstructionFile(file: File): Promise<void> {
  elements.importButton.disabled = true;
  elements.importButton.querySelector("span")!.textContent = "READING";
  try {
    const parsed = parseStrictIntegerJson(await file.text());
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { schema?: unknown }).schema === "tessaryn/video-locus-artifact/v1"
    ) {
      const reconstruction = await hydrateVideoLocusArtifact(parsed);
      const verification = await verifyWorldOffThread(reconstruction.world);
      if (verification.errors.length > 0) throw new Error(verification.errors.join(" / "));
      const state = beginLocalImport(file, "video-reconstruction");
      state.kind = "video";
      materializeVideoResult(state, reconstruction, verification);
      return;
    }
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

async function openFileBackedArtifact(file: File): Promise<void> {
  const state = beginLocalImport(file, "local-file");
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
    elements.localStage.dataset.state = "materialized";
    elements.localStatus.textContent = `LOCAL STREAM INDEXED / ${String(identity.chunkCount)} CHUNKS`;
    elements.localSize.textContent = `${formatBytes(file.size)} / 100%`;
    elements.localRoot.textContent = identity.streamRoot;
    elements.localProgress.style.width = "100%";
    elements.localExport.disabled = false;
    elements.exportButton.disabled = false;
    syncLocalImportView();
    showToast("LOCAL STREAM ROOT COMPLETE");
  } catch (error) {
    handleLocalImportError(state, error, "LOCAL INDEX FAILED");
  }
}

async function reconstructVideoFile(file: File): Promise<void> {
  const state = beginLocalImport(file, "video-reconstruction");
  state.status = "indexing";
  elements.localKind.textContent = "VIDEO / SOURCE COMMITMENT";
  elements.localStatus.textContent = "COMMITTING SOURCE BYTES";
  showToast(`CONSTRUCTING LOCAL 4D LOCUS / ${formatBytes(file.size)} / NO UPLOAD`);
  const task = indexLocalFileOffThread(file, (progress) => {
    if (activeLocalImport !== state) return;
    state.progress = progress;
    const fraction = progress.totalBytes === 0 ? 1 : progress.bytesRead / progress.totalBytes;
    elements.localStatus.textContent = `SOURCE COMMITMENT / ${String(progress.chunksRead)} CHUNKS`;
    elements.localSize.textContent = `${formatBytes(progress.bytesRead)} / ${formatBytes(file.size)}`;
    elements.localProgress.style.width = `${(fraction * 8).toFixed(3)}%`;
    syncLocalImportView();
  });
  activeLocalTask = task;
  try {
    const identity = await task.result;
    if (activeLocalImport !== state) return;
    activeLocalTask = null;
    state.identity = identity;
    state.status = "reconstructing";
    state.progress = {
      bytesRead: identity.byteLength,
      totalBytes: identity.byteLength,
      chunksRead: identity.chunkCount,
    };
    syncLocalImportView();
    elements.localRoot.textContent = identity.streamRoot;
    elements.localKind.textContent = "VIDEO / NATIVE WORLD CONSTRUCTION";
    activeReconstructionAbort = new AbortController();
    const reconstruction = await reconstructVideoToLocus(
      file,
      identity,
      (progress) => updateVideoReconstructionProgress(state, progress),
      activeReconstructionAbort.signal,
    );
    if (activeLocalImport !== state) return;
    const verification = await verifyWorldOffThread(reconstruction.world);
    if (verification.errors.length > 0) throw new Error(verification.errors.join(" / "));
    materializeVideoResult(state, reconstruction, verification);
  } catch (error) {
    activeReconstructionAbort = null;
    handleLocalImportError(state, error, "VIDEO RECONSTRUCTION FAILED");
  }
}

function beginLocalImport(file: File, source: "local-file" | "video-reconstruction"): ActiveLocalImport {
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
  elements.app.dataset.source = source;
  elements.localStage.dataset.kind = state.kind;
  elements.localStage.dataset.state = "working";
  elements.localStage.hidden = false;
  elements.localName.textContent = file.name || "UNNAMED LOCAL FILE";
  if (source === "local-file") {
    elements.originName.textContent = file.name || "UNNAMED LOCAL FILE";
    elements.cellCount.textContent = "1 LOCAL SOURCE";
  }
  elements.localKind.textContent = `LOCAL ${state.kind.toUpperCase()} / FILE-BACKED`;
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
  return state;
}

function closeLocalFile(restoreSource = true): void {
  const active = activeLocalImport;
  activeLocalTask?.cancel();
  activeLocalTask = null;
  activeReconstructionAbort?.abort();
  activeReconstructionAbort = null;
  elements.localStage.hidden = true;
  elements.localExport.disabled = true;
  elements.localStage.removeAttribute("data-kind");
  elements.localStage.removeAttribute("data-state");
  activeLocalImport = null;
  if (window.__tessaryn) {
    delete window.__tessaryn.localImport;
    delete window.__tessaryn.videoReconstruction;
    delete window.__tessaryn.videoVerification;
  }
  if (!restoreSource) return;
  if (active?.previousSource) elements.app.dataset.source = active.previousSource;
  else delete elements.app.dataset.source;
  if (active) {
    elements.originName.textContent = active.previousOriginName;
    elements.cellCount.textContent = active.previousCellCount;
  }
  if (active?.reconstruction) restoreReferenceOrigin();
  videoReconstruction = null;
  videoVerification = null;
  elements.chronofoldButton.disabled = importedArtifact !== null;
  elements.challengeButton.disabled = false;
  elements.exportButton.disabled = false;
  elements.scaleBreath.disabled = false;
  showToast("LOCAL STREAM CLOSED");
}

function updateVideoReconstructionProgress(
  state: ActiveLocalImport,
  progress: VideoReconstructionProgress,
): void {
  if (activeLocalImport !== state) return;
  const ranges: Record<VideoReconstructionProgress["phase"], [number, number]> = {
    decode: [8, 18],
    model: [18, 30],
    motion: [30, 38],
    depth: [38, 72],
    cells: [72, 91],
    verify: [91, 98],
    complete: [98, 100],
  };
  const range = ranges[progress.phase];
  const percent = range[0] + (range[1] - range[0]) * progress.progress;
  elements.localStatus.textContent = progress.detail;
  elements.localSize.textContent = progress.phase.toUpperCase();
  elements.localProgress.style.width = `${percent.toFixed(3)}%`;
  syncLocalImportView();
}

function materializeVideoResult(
  state: ActiveLocalImport,
  reconstruction: VideoReconstructionResult,
  verification: VerificationReport,
): void {
  if (activeLocalImport !== state) return;
  state.status = "materialized";
  state.reconstruction = reconstruction;
  videoReconstruction = reconstruction;
  videoVerification = verification;
  activeReconstructionAbort = null;
  elements.localStage.dataset.kind = "video";
  elements.localStage.dataset.state = "materialized";
  elements.localKind.textContent = "VIDEO / NATIVE 4D LOCUS";
  elements.localName.textContent = reconstruction.source.name;
  elements.localStatus.textContent = "NATIVE 4D LOCUS / LOCALLY REVERIFIED";
  elements.localSize.textContent = `${String(reconstruction.metrics.surfels)} SURFELS / ${String(reconstruction.metrics.surfaceVoxels)} SURFACE CELLS`;
  elements.localRoot.textContent = reconstruction.source.streamRoot;
  elements.localProgress.style.width = "100%";
  elements.localExport.disabled = false;
  elements.chronofoldButton.disabled = false;
  elements.challengeButton.disabled = false;
  elements.exportButton.disabled = false;
  elements.scaleBreath.disabled = false;
  importedArtifact = null;
  importedVerification = null;
  condensationComplete = false;
  document.body.removeAttribute("data-materialized");
  selected =
    reconstruction.observations.at(-1)?.cell ?? reconstruction.world.cells.at(-1) ?? selected;
  scene.loadTemporalObservations(reconstruction.observations);
  populateVideoMoments(reconstruction);
  populateVideoSource(reconstruction);
  elements.originName.textContent = reconstruction.source.name;
  elements.cellCount.textContent = `${String(reconstruction.metrics.worldCells)} CELLS`;
  elements.anchorShort.textContent = shortDigest(reconstruction.world.anchor_id, 8);
  elements.momentShort.textContent = "MOMENT C";
  elements.evidenceShort.textContent = "LOCALLY VERIFIED";
  elements.originPhase.textContent = "ORIGIN / VIDEO LOCUS";
  elements.originStatus.textContent = "4D LOCUS / CONTINUUM STABLE";
  if (window.__tessaryn) {
    window.__tessaryn.world = reconstruction.world;
    window.__tessaryn.videoReconstruction = reconstruction;
    window.__tessaryn.videoVerification = verification;
    window.__tessaryn.verification = verification;
  }
  syncLocalImportView();
  showToast(
    `${String(reconstruction.metrics.worldCells)} WORLD CELLS / ${String(reconstruction.metrics.rootprintBranches)} ROOTPRINT STATES`,
  );
}

function handleLocalImportError(
  state: ActiveLocalImport,
  error: unknown,
  fallback: string,
): void {
  if (
    activeLocalImport !== state ||
    (error instanceof DOMException && error.name === "AbortError")
  ) {
    return;
  }
  state.status = "error";
  state.error = error instanceof Error ? error.message : String(error);
  activeLocalTask = null;
  elements.localStage.dataset.state = "error";
  elements.localStatus.textContent = fallback;
  elements.localRoot.textContent = state.error.toUpperCase();
  syncLocalImportView();
  showToast(fallback);
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
    worldCells: active.reconstruction?.metrics.worldCells,
    surfels: active.reconstruction?.metrics.surfels,
    surfaceVoxels: active.reconstruction?.metrics.surfaceVoxels,
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

function populateVideoMoments(result: VideoReconstructionResult): void {
  elements.momentRail.replaceChildren();
  temporalCellsByMoment.clear();
  result.observations.forEach((observation, index) => {
    temporalCellsByMoment.set(observation.id, observation.cell);
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.moment = observation.id;
    const active = index === result.observations.length - 1;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
    const label = document.createElement("b");
    const state = document.createElement("small");
    label.textContent = `0${String(index + 1)} / ${observation.label}`;
    state.textContent = `${String(observation.surfels.length)} SPATIAL SAMPLES`;
    button.append(label, state);
    button.addEventListener("click", () => {
      document.querySelectorAll<HTMLButtonElement>("[data-moment]").forEach((candidate) => {
        const selectedMoment = candidate === button;
        candidate.classList.toggle("active", selectedMoment);
        candidate.setAttribute("aria-pressed", String(selectedMoment));
      });
      scene.setMoment(observation.id);
      selected = observation.cell;
      elements.momentShort.textContent = `MOMENT ${String.fromCharCode(65 + index)}`;
      elements.originStatus.textContent = `${observation.label} / SPATIAL-TEMPORAL STATE`;
      showToast(`${observation.label} / ${String(observation.sdfVoxels.length)} SURFACE CELLS`);
    });
    elements.momentRail.append(button);
  });
}

function restoreReferenceOrigin(): void {
  if (!validationVerification || !validationArtifact) return;
  chronofoldOpen = false;
  elements.chronofoldButton.classList.remove("active");
  elements.chronofoldButton.setAttribute("aria-pressed", "false");
  const observations = temporalObservations(validationVerification);
  selected =
    observations.find((observation) => observation.id === "moment-c")?.cell ??
    observations[0]?.cell ??
    selected;
  scene.loadTemporalObservations(observations);
  populateTemporalMoments(validationVerification);
  if (validationPortfolio) {
    populateValidationPortfolio(validationArtifact.source.profile, validationPortfolio);
  }
  elements.originName.textContent = validationArtifact.origin;
  elements.cellCount.textContent = `${String(validationVerification.cellsValid)} CELLS`;
  elements.anchorShort.textContent = shortDigest(selected.manifest.anchor_id, 8);
  elements.momentShort.textContent = "MOMENT C";
  elements.evidenceShort.textContent = "LOCALLY VERIFIED";
  elements.originPhase.textContent = "ORIGIN / MATERIALIZED";
  elements.originStatus.textContent = "ARCHVIZ TINY HOUSE / CONTINUUM STABLE";
  if (window.__tessaryn) {
    window.__tessaryn.world = worldData;
    window.__tessaryn.verification = validationVerificationReport(validationVerification);
  }
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

function renderVideoVerification(
  result: VideoReconstructionResult,
  report: VerificationReport,
): void {
  const valid = report.errors.length === 0;
  elements.verifyCells.textContent = `${String(report.cellsValid)} / ${String(result.metrics.worldCells)} VALID`;
  elements.verifyPha.textContent = `${String(report.phaValid)} / ${String(result.metrics.phaBindings)} VALID`;
  elements.verifyRootprint.textContent = report.rootprintValid ? "VALID" : "INVALID";
  elements.verifyReplay.textContent = report.replayValid ? "VALID" : "INVALID";
  elements.verifyMemory.textContent = report.memoryValid ? "VALID" : "INVALID";
  elements.verifyTitle.textContent = valid ? "LOCAL VIDEO LOCUS ACCEPTED" : "VERIFICATION CAUTION";
  elements.verifyDetail.textContent = valid
    ? `${String(result.metrics.surfels)} source-derived surfels and ${String(result.metrics.surfaceVoxels)} surface-field cells bind three temporal Moments to source stream ${shortDigest(result.source.streamRoot, 18)}.`
    : report.errors.join(" / ");
}

function exportCapsule(): void {
  if (activeLocalImport) {
    if (activeLocalImport.reconstruction) {
      exportMemoryCapsule(
        activeLocalImport.reconstruction.memoryCapsule,
        `${safeFileStem(activeLocalImport.file.name)}.phm`,
      );
    } else {
      exportLocalFileIndex(activeLocalImport);
    }
    return;
  }
  const temporalSelected = temporalArtifactsByCell.get(selected.key);
  const capsule =
    importedArtifact?.sdf_proof.memory_capsule ??
    temporalSelected?.sdf_proof.memory_capsule ??
    worldData.origin_memory_capsule;
  const name = importedArtifact
    ? "tessaryn-imported-sdf.phm"
    : temporalSelected
      ? `${selected.key}.phm`
      : "vesper-court-origin.phm";
  exportMemoryCapsule(capsule, name);
}

function exportMemoryCapsule(capsule: Record<string, any>, name: string): void {
  const bytes = JSON.stringify(capsule, null, 2) + "\n";
  const blob = new Blob([bytes], { type: "application/vnd.powerhouse.memory+json" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = name;
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

function exportVideoLocus(result: VideoReconstructionResult): void {
  const artifact = {
    schema: result.schema,
    source: result.source,
    profile: result.profile,
    world: result.world,
    moments: result.moments,
    memory_capsule: result.memoryCapsule,
    metrics: result.metrics,
  };
  const blob = new Blob([JSON.stringify(artifact) + "\n"], {
    type: "application/vnd.tessaryn.locus+json",
  });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `${safeFileStem(result.source.name)}.tessaryn-locus.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1_000);
  showToast("NATIVE 4D LOCUS EXPORTED");
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

async function hasJsonObjectPrefix(file: File): Promise<boolean> {
  const prefix = new Uint8Array(await file.slice(0, 256).arrayBuffer());
  let offset = 0;
  if (prefix[0] === 0xef && prefix[1] === 0xbb && prefix[2] === 0xbf) offset = 3;
  while (offset < prefix.length) {
    const byte = prefix[offset];
    if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) {
      offset += 1;
      continue;
    }
    return byte === 0x7b;
  }
  return false;
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
