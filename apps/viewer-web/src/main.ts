import {
  Box,
  CloudUpload,
  Code2,
  Database,
  Download,
  EyeOff,
  Fingerprint,
  FlaskConical,
  GitBranch,
  HardDrive,
  HardDriveDownload,
  Landmark,
  Layers3,
  Library,
  Maximize2,
  MessageSquareText,
  Move3d,
  Pause,
  Play,
  RotateCcw,
  RadioTower,
  Scan,
  Search,
  Share2,
  ShieldCheck,
  Trash2,
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
import { takeOriginFile } from "./origin-handoff";
import {
  destroyLocalIngestWorker,
  indexLocalFileOffThread,
  type LocalIngestTask,
} from "./local-ingest-client";
import type { LocalFileIdentity, LocalFileProgress } from "./local-file-identity";
import { parseStrictIntegerJson } from "./strict-json";
import {
  disposeSourceGeometry,
  parseSourceGeometry,
  sourceGeometryFormat,
  type SourceGeometryStats,
} from "./source-geometry";
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
  fetchPublicWeave,
  hashFile,
  listPersonalWeave,
  loadWeaveClientConfig,
  markPersonalObjectPublished,
  markPersonalObjectUnpublished,
  personalWeaveFile,
  publishArtifact,
  removePersonalObject,
  revokePublication,
  saveToPersonalWeave,
  type PersonalWeaveObject,
  type PublicationMetadata,
  type PublicationProgress,
  type WeaveClientConfig,
} from "./weave-client";

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
      sourceGeometry?: SourceGeometryView;
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

type LocalFileKind = "geometry" | "video" | "image" | "audio" | "binary";
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
  previousOriginPhase: string;
  previousOriginStatus: string;
  previousAnchorShort: string;
  previousMomentShort: string;
  previousEvidenceShort: string;
  previousIdentityState: string;
  previousCondensationWidth: string;
  error?: string;
}

interface ActiveCinematicObject {
  file: File;
  envelope: CinematicObjectEnvelopeView;
  verification: CinematicObjectBrowserReport;
  publicEntry: PublicObjectCatalogEntry | null;
}

interface ActiveValidationLocus {
  file: File;
  artifact: ValidationLocusArtifactView;
  verification: ValidationLocusBrowserReport;
}

interface SourceGeometryView extends SourceGeometryStats {
  name: string;
  streamRoot: string;
  displayScale: number;
}

const elements = {
  app: byId<HTMLDivElement>("app"),
  canvas: byId<HTMLCanvasElement>("world-canvas"),
  originName: byId<HTMLElement>("origin-name"),
  cellCount: byId<HTMLElement>("cell-count"),
  networkState: byId<HTMLElement>("network-state"),
  identityState: byId<HTMLElement>("identity-state"),
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
  constructButton: byId<HTMLButtonElement>("construct-button"),
  importInput: byId<HTMLInputElement>("import-input"),
  intakeDialog: byId<HTMLDialogElement>("intake-dialog"),
  intakeClose: byId<HTMLButtonElement>("intake-close"),
  intakeDrop: byId<HTMLButtonElement>("intake-drop"),
  intakeResult: byId<HTMLElement>("intake-result"),
  intakeState: byId<HTMLElement>("intake-state"),
  intakeFile: byId<HTMLElement>("intake-file"),
  intakeDetail: byId<HTMLElement>("intake-detail"),
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
  openValidationOrigin: byId<HTMLButtonElement>("open-validation-origin"),
  objectsButton: byId<HTMLButtonElement>("objects-button"),
  objectsDialog: byId<HTMLDialogElement>("objects-dialog"),
  objectsClose: byId<HTMLButtonElement>("objects-close"),
  objectSearch: byId<HTMLInputElement>("object-search"),
  objectList: byId<HTMLElement>("object-list"),
  weaveNodeState: byId<HTMLElement>("weave-node-state"),
  publicWeaveCount: byId<HTMLElement>("public-weave-count"),
  personalWeaveCount: byId<HTMLElement>("personal-weave-count"),
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
  publishDialog: byId<HTMLDialogElement>("publish-dialog"),
  publishClose: byId<HTMLButtonElement>("publish-close"),
  publishKind: byId<HTMLElement>("publish-kind"),
  publishFile: byId<HTMLElement>("publish-file"),
  publishCell: byId<HTMLElement>("publish-cell"),
  publishObjectId: byId<HTMLInputElement>("publish-object-id"),
  publishTitle: byId<HTMLInputElement>("publish-title"),
  publishSummary: byId<HTMLTextAreaElement>("publish-summary"),
  publishConsent: byId<HTMLInputElement>("publish-consent"),
  publishProgress: byId<HTMLElement>("publish-progress"),
  publishStage: byId<HTMLElement>("publish-stage"),
  publishPercent: byId<HTMLElement>("publish-percent"),
  publishProgressBar: byId<HTMLElement>("publish-progress-bar"),
  publishDetail: byId<HTMLElement>("publish-detail"),
  keepObject: byId<HTMLButtonElement>("keep-object"),
  publishObject: byId<HTMLButtonElement>("publish-object"),
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
let referenceVerification: VerificationReport | null = null;
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
let activeSourceGeometry: SourceGeometryView | null = null;
let activeValidationLocus: ActiveValidationLocus | null = null;
let publicObjectCatalog: PublicObjectCatalog | null = null;
let bundledObjectCatalog: PublicObjectCatalog | null = null;
let weaveConfig: WeaveClientConfig | null = null;
let personalWeaveObjects: PersonalWeaveObject[] = [];
let weaveScope: "public" | "personal" = "public";
let activeArtifactFile: File | null = null;
let activePublicEntry: PublicObjectCatalogEntry | null = null;
let publishAbort: AbortController | null = null;
let cinematicScrubbing = false;
const MAX_INLINE_RECONSTRUCTION_BYTES = 64 * 1024 * 1024;
const NATIVE_RECONSTRUCTION_SCHEMA = "tessaryn/reconstruction-artifact/v0";
const NATIVE_VALIDATION_SCHEMA = "tessaryn/validation-locus-artifact/v1";
const runtimeMetrics: RuntimeMetrics = {
  bootStartedAtMs: performance.now(),
};

void boot();

async function boot(): Promise<void> {
  try {
    elements.bootStatus.textContent = "READING LOCAL CELL MANIFESTS";
    const [
      worldResponse,
      validationResponse,
      portfolioResponse,
      catalogResponse,
      clientConfig,
      personalObjects,
    ] = await Promise.all([
      fetch("./world/vesper-court.json", { cache: "no-store" }),
      fetch("./world/archviz-tiny-house-locus.json", { cache: "no-store" }),
      fetch("./validation/portfolio.json", { cache: "no-store" }),
      fetch("./objects/catalog.json", { cache: "no-store" }),
      loadWeaveClientConfig(),
      listPersonalWeave().catch(() => []),
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
    bundledObjectCatalog = parsedCatalog;
    publicObjectCatalog = parsedCatalog;
    weaveConfig = clientConfig;
    personalWeaveObjects = personalObjects;
    validationArtifact = parsedValidation;
    elements.bootStatus.textContent = "VERIFYING REFERENCE + GROUND TRUTH";
    const [verifiedReference, verifiedValidation] = await Promise.all([
      verifyWorldOffThread(worldData),
      verifyValidationOffThread(parsedValidation),
    ]);
    referenceVerification = verifiedReference;
    validationVerification = verifiedValidation;
    if (verifiedReference.errors.length > 0) {
      throw new Error(verifiedReference.errors.join(" / "));
    }
    if (validationVerification.errors.length > 0 || !validationVerification.alternate) {
      throw new Error(
        validationVerification.errors.join(" / ") || "validation Locus rejected",
      );
    }
    selected =
      worldData.cells.find((cell) => cell.key === "archive-c") ??
      worldData.cells[0] ??
      fail("reference Origin contains no Cells");
    populateMoments(worldData.moments);
    populateValidationPortfolio(parsedValidation.source.profile, parsedPortfolio);
    populatePublicObjects(parsedCatalog.objects);
    updateWeaveCounts();
    elements.app.dataset.source = "reference";
    elements.originName.textContent = "LOCAL CONSTRUCTION FIELD";
    elements.cellCount.textContent = `${String(worldData.cells.length)} REFERENCE CELLS`;
    elements.anchorShort.textContent = shortDigest(selected.manifest.anchor_id, 8);
    elements.momentShort.textContent = "REFERENCE";
    elements.evidenceShort.textContent = "ASSEMBLING";
    scene = new TessarynWorld(elements.canvas, worldData, {
      onCellSelected: openTrace,
      onCondensationProgress: updateCondensation,
      onCondensationComplete: finishCondensation,
      onScaleChanged: updateScaleButtons,
      onScaleDepthChanged: updateScaleDepth,
    });
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
      verification: verifiedReference,
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
        EyeOff,
        Fingerprint,
        FlaskConical,
        GitBranch,
        HardDrive,
        HardDriveDownload,
        Landmark,
        Layers3,
        Library,
        Maximize2,
        MessageSquareText,
        Move3d,
        Pause,
        Play,
        RadioTower,
        RotateCcw,
        Scan,
        Search,
        Share2,
        ShieldCheck,
        Trash2,
        Upload,
        Waypoints,
        X,
        CloudUpload,
      },
    });
    elements.bootStatus.textContent = "ORIGIN FRAME ACCEPTED";
    await delay(380);
    elements.app.dataset.ready = "true";
    document.body.dataset.ready = "true";
    latestVerification = verifiedReference;
    window.__tessaryn.verification = latestVerification;
    runtimeMetrics.verificationMs = performance.now() - runtimeMetrics.bootStartedAtMs;
    elements.evidenceShort.textContent =
      latestVerification.errors.length === 0 ? "LOCALLY VERIFIED" : "CAUTION";
    registerServiceWorker();
    updateNetworkState();
    window.addEventListener("online", updateNetworkState);
    window.addEventListener("offline", updateNetworkState);
    requestAnimationFrame(updateWorldLabel);
    void initializeObjectWeave();
  } catch (error) {
    console.error(error);
    elements.bootStatus.textContent =
      error instanceof Error ? error.message.toUpperCase() : "ORIGIN FAILED";
    document.body.dataset.error = "true";
  }
}

async function initializeObjectWeave(): Promise<void> {
  await refreshPublicWeave();
  const handoffId = new URLSearchParams(location.search).get("open-local");
  if (handoffId) {
    const file = await takeOriginFile(handoffId);
    const route = new URL(location.href);
    route.searchParams.delete("open-local");
    history.replaceState(null, "", route);
    if (file) {
      await routeLocalFiles([file]);
      return;
    }
    showToast("THE ORIGIN HANDOFF EXPIRED / OPEN THE MODEL AGAIN");
  }
  if (new URLSearchParams(location.search).get("origin") === "validation") {
    openValidationOrigin(false);
    return;
  }
  await enterInitialPublicObject();
}

function bindControls(): void {
  elements.verifyButton.addEventListener("click", () => void showVerification());
  elements.sourcesButton.addEventListener("click", () => {
    if (!elements.sourcesDialog.open) elements.sourcesDialog.showModal();
  });
  elements.sourcesClose.addEventListener("click", () => elements.sourcesDialog.close());
  elements.openValidationOrigin.addEventListener("click", () => {
    elements.sourcesDialog.close();
    openValidationOrigin();
  });
  elements.objectsButton.addEventListener("click", () => {
    if (!elements.objectsDialog.open) elements.objectsDialog.showModal();
    renderWeaveScope();
    elements.objectSearch.focus();
  });
  elements.objectsClose.addEventListener("click", () => elements.objectsDialog.close());
  elements.objectSearch.addEventListener("input", () => {
    renderWeaveScope();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-weave-scope]").forEach((button) => {
    button.addEventListener("click", () => {
      weaveScope = button.dataset.weaveScope === "personal" ? "personal" : "public";
      document.querySelectorAll<HTMLButtonElement>("[data-weave-scope]").forEach((candidate) => {
        const active = candidate === button;
        candidate.classList.toggle("active", active);
        candidate.setAttribute("aria-selected", String(active));
      });
      renderWeaveScope();
    });
  });
  elements.importButton.addEventListener("click", openIntakeDialog);
  elements.constructButton.addEventListener("click", openIntakeDialog);
  elements.intakeClose.addEventListener("click", () => elements.intakeDialog.close());
  elements.intakeDrop.addEventListener("click", () => elements.importInput.click());
  elements.importInput.addEventListener("change", () => void importLocalFiles());
  bindIntakeDrop();
  elements.localClose.addEventListener("click", () => {
    if (
      activeCinematicObject ||
      activeSourceGeometry ||
      activeValidationLocus ||
      importedArtifact
    ) restoreReferenceOrigin();
    else closeLocalFile();
  });
  elements.localExport.addEventListener("click", () => {
    if (activeLocalImport) exportLocalFileIndex(activeLocalImport);
  });
  elements.localShare.addEventListener("click", () => {
    if (activePublicEntry) void shareActiveObject();
    else openPublishDialog();
  });
  elements.publishClose.addEventListener("click", closePublishDialog);
  elements.keepObject.addEventListener("click", () => void keepActiveObject());
  elements.publishObject.addEventListener("click", () => void publishActiveObject());
  elements.verifyClose.addEventListener("click", () => elements.verificationDialog.close());
  elements.fullscreenButton.addEventListener("click", () => void toggleFullscreen());
  elements.traceClose.addEventListener("click", closeTrace);
  elements.challengeClose.addEventListener("click", closeChallenge);
  elements.challengeButton.addEventListener("click", openChallenge);
  elements.exportButton.addEventListener("click", exportCapsule);
  elements.resetButton.addEventListener("click", () => {
    if (activeCinematicObject || activeSourceGeometry) {
      restoreReferenceOrigin();
      return;
    }
    if (importedArtifact) {
      restoreReferenceOrigin();
      return;
    }
    if (activeValidationLocus) {
      restoreReferenceOrigin();
      return;
    }
    if (activeLocalImport) {
      closeLocalFile();
      return;
    }
    if (elements.app.dataset.source === "validation") {
      restoreReferenceOrigin();
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
  elements.publishDialog.addEventListener("click", (event) => {
    if (event.target === elements.publishDialog) closePublishDialog();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (activeLocalImport) closeLocalFile();
    closeTrace();
    closeChallenge();
    if (elements.verificationDialog.open) elements.verificationDialog.close();
    if (elements.sourcesDialog.open) elements.sourcesDialog.close();
    if (elements.objectsDialog.open) elements.objectsDialog.close();
    if (elements.publishDialog.open) closePublishDialog();
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

function populatePersonalObjects(entries: PersonalWeaveObject[], query = ""): void {
  const needle = query.trim().toLocaleLowerCase();
  const visible = entries.filter((entry) =>
    [entry.objectId, entry.title, entry.summary, entry.artifactKind]
      .join(" ")
      .toLocaleLowerCase()
      .includes(needle),
  );
  elements.objectList.replaceChildren();
  if (visible.length === 0) {
    const empty = document.createElement("p");
    empty.className = "object-empty";
    empty.textContent = "NO CONSTRUCTIONS ARE RETAINED ON THIS DEVICE";
    elements.objectList.append(empty);
    return;
  }
  for (const entry of visible) {
    const row = document.createElement("div");
    row.className = "personal-object-row";
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
    id.textContent = entry.objectId;
    identity.append(title, id);
    const detail = document.createElement("span");
    const summary = document.createElement("small");
    const metrics = document.createElement("em");
    summary.textContent = entry.summary;
    metrics.textContent = `${entry.artifactKind === "rgbd_reconstruction" ? "REAL RGB-D" : "TEMPORAL OBJECT"} / ${formatBytes(entry.bytes)}${entry.publicationId ? " / PUBLIC" : " / PRIVATE"}`;
    detail.append(summary, metrics);
    button.append(mark, identity, detail);
    button.addEventListener("click", () => void openPersonalObject(entry));
    const actions = document.createElement("span");
    actions.className = "personal-object-actions";
    if (entry.publicationId) {
      const unpublish = document.createElement("button");
      unpublish.type = "button";
      unpublish.className = "icon-button personal-unpublish";
      unpublish.title = "Remove from public discovery";
      unpublish.setAttribute("aria-label", `Remove ${entry.title} from public discovery`);
      unpublish.innerHTML = '<i data-lucide="eye-off"></i>';
      unpublish.addEventListener("click", () => void unpublishPersonalWeaveEntry(entry));
      actions.append(unpublish);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-button personal-remove";
    remove.title = "Remove device copy";
    remove.setAttribute("aria-label", `Remove ${entry.title} from this device`);
    remove.innerHTML = '<i data-lucide="trash-2"></i>';
    remove.addEventListener("click", () => void removePersonalWeaveEntry(entry));
    actions.append(remove);
    row.append(button, actions);
    elements.objectList.append(row);
  }
  createIcons({ icons: { EyeOff, Trash2 } });
}

function renderWeaveScope(): void {
  if (weaveScope === "personal") {
    populatePersonalObjects(personalWeaveObjects, elements.objectSearch.value);
  } else {
    populatePublicObjects(publicObjectCatalog?.objects ?? [], elements.objectSearch.value);
  }
}

async function refreshPublicWeave(): Promise<void> {
  if (!weaveConfig) {
    elements.weaveNodeState.dataset.state = "offline";
    elements.weaveNodeState.textContent = "RELEASE CATALOG";
    return;
  }
  elements.weaveNodeState.dataset.state = "connecting";
  elements.weaveNodeState.textContent = "SYNCHRONIZING";
  try {
    const dynamic = await fetchPublicWeave(weaveConfig.api);
    publicObjectCatalog = mergePublicCatalogs(dynamic, bundledObjectCatalog);
    if (window.__tessaryn) window.__tessaryn.publicObjectCatalog = publicObjectCatalog;
    elements.weaveNodeState.dataset.state = "live";
    elements.weaveNodeState.textContent = "WRITE NODE LIVE";
  } catch {
    publicObjectCatalog = bundledObjectCatalog;
    elements.weaveNodeState.dataset.state = "offline";
    elements.weaveNodeState.textContent = "OFFLINE / DEVICE WEAVE LIVE";
  }
  updateWeaveCounts();
  renderWeaveScope();
}

function mergePublicCatalogs(
  primary: PublicObjectCatalog,
  fallback: PublicObjectCatalog | null,
): PublicObjectCatalog {
  const objects: PublicObjectCatalogEntry[] = [];
  const seen = new Set<string>();
  for (const entry of [...primary.objects, ...(fallback?.objects ?? [])]) {
    const key = entry.publication_id ?? entry.artifact_sha256 ?? `${entry.object_id}:${entry.cell_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    objects.push(entry);
  }
  return {
    schema: "tessaryn/public-object-catalog/v2",
    updated_at_unix_us: Math.max(primary.updated_at_unix_us, fallback?.updated_at_unix_us ?? 0),
    objects,
  };
}

function updateWeaveCounts(): void {
  elements.publicWeaveCount.textContent = String(publicObjectCatalog?.objects.length ?? 0);
  elements.personalWeaveCount.textContent = String(personalWeaveObjects.length);
}

async function openPersonalObject(entry: PersonalWeaveObject): Promise<void> {
  elements.objectsDialog.close();
  try {
    const file = await personalWeaveFile(entry);
    if (entry.artifactKind === "rgbd_reconstruction") {
      await importReconstructionFile(file);
    } else {
      await importCinematicFile(file);
    }
  } catch (error) {
    showToast(error instanceof Error ? error.message.toUpperCase() : "DEVICE OBJECT FAILED");
  }
}

async function removePersonalWeaveEntry(entry: PersonalWeaveObject): Promise<void> {
  if (!confirm(`Remove ${entry.title} from this device?`)) return;
  await removePersonalObject(entry);
  personalWeaveObjects = personalWeaveObjects.filter((candidate) => candidate.localId !== entry.localId);
  updateWeaveCounts();
  renderWeaveScope();
  showToast("DEVICE COPY REMOVED / PUBLIC IDENTITY UNCHANGED");
}

async function unpublishPersonalWeaveEntry(entry: PersonalWeaveObject): Promise<void> {
  if (!entry.publicationId || !weaveConfig) return;
  if (!confirm(`Remove ${entry.title} from public discovery? Its content identity will remain unchanged.`)) {
    return;
  }
  try {
    await revokePublication(weaveConfig.api, entry.publicationId);
    await markPersonalObjectUnpublished(entry.localId);
    const publicationId = entry.publicationId;
    delete entry.publicationId;
    delete entry.publicArtifact;
    if (publicObjectCatalog) {
      publicObjectCatalog.objects = publicObjectCatalog.objects.filter(
        (candidate) => candidate.publication_id !== publicationId,
      );
    }
    updateWeaveCounts();
    renderWeaveScope();
    showToast("PUBLIC DISCOVERY REVOKED / OBJECT IDENTITY UNCHANGED");
  } catch (error) {
    showToast(error instanceof Error ? error.message.toUpperCase() : "REVOCATION FAILED");
  }
}

async function enterInitialPublicObject(): Promise<void> {
  if (!publicObjectCatalog || new URLSearchParams(location.search).get("origin") === "validation") {
    return;
  }
  const requested = new URLSearchParams(location.search).get("object");
  const requestedPublication = new URLSearchParams(location.search).get("publication");
  const entry = requestedPublication
    ? publicObjectCatalog.objects.find(
        (candidate) => candidate.publication_id === requestedPublication,
      )
    : requested
      ? publicObjectCatalog.objects.find((candidate) => candidate.object_id === requested)
      : undefined;
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
    if (entry.artifact_sha256 && (await hashFile(blob)) !== entry.artifact_sha256) {
      throw new Error("public artifact digest does not match its publication receipt");
    }
    const reconstruction = entry.artifact_kind === "rgbd_reconstruction";
    const file = new File([blob], `${entry.object_id}.${reconstruction ? "json" : "tessaryn"}`, {
      type: reconstruction ? "application/json" : "application/vnd.tessaryn.object",
      lastModified: 0,
    });
    if (reconstruction) await importReconstructionFile(file, entry);
    else await importCinematicFile(file, entry);
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
    (catalog.schema === "tessaryn/public-object-catalog/v1" ||
      catalog.schema === "tessaryn/public-object-catalog/v2") &&
    typeof catalog.updated_at_unix_us === "number" &&
    Array.isArray(catalog.objects) &&
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
  if (ownsCondensationPresentation()) {
    elements.condensation.style.width = String(Math.round(progress * 100)) + "%";
  }
  if (!condensationComplete && ownsCondensationPresentation()) {
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
  if (!ownsCondensationPresentation()) return;
  elements.originPhase.textContent = "ORIGIN / MATERIALIZED";
  elements.originStatus.textContent =
    elements.app.dataset.source === "validation"
      ? "GROUND-TRUTH LAB / CONTINUUM STABLE"
      : "PRIVATE ORIGIN READY / ADD YOUR CAPTURE";
  elements.evidenceShort.textContent = "LOCALLY VERIFIED";
  const materializedCells =
    elements.app.dataset.source === "validation"
      ? (validationVerification?.cellsValid ?? 0)
      : worldData.cells.length;
  showToast(
    `${String(materializedCells)} WORLD CELLS / CONTINUUM ASSEMBLED`,
  );
}

function ownsCondensationPresentation(): boolean {
  return elements.app.dataset.source === "reference" || elements.app.dataset.source === "validation";
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
  if (activeLocalImport && elements.app.dataset.source === "local-file") {
    renderLocalFileVerification(activeLocalImport);
    return;
  }
  if (activeCinematicObject) {
    renderCinematicVerification(activeCinematicObject);
    return;
  }
  if (activeValidationLocus) {
    renderValidationVerification(activeValidationLocus.verification);
    return;
  }
  if (activeSourceGeometry && activeLocalImport) {
    renderSourceGeometryVerification(activeSourceGeometry, activeLocalImport);
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
  if (elements.app.dataset.source === "validation" && validationArtifact) {
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

function openIntakeDialog(): void {
  elements.intakeResult.hidden = true;
  delete elements.intakeResult.dataset.state;
  delete elements.intakeDialog.dataset.drag;
  if (!elements.intakeDialog.open) elements.intakeDialog.showModal();
  elements.intakeDrop.focus();
}

function bindIntakeDrop(): void {
  const hasFiles = (event: DragEvent): boolean =>
    Array.from(event.dataTransfer?.types ?? []).includes("Files");
  window.addEventListener("dragenter", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (!elements.intakeDialog.open) openIntakeDialog();
    elements.intakeDialog.dataset.drag = "true";
  });
  window.addEventListener("dragover", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  });
  window.addEventListener("dragleave", (event) => {
    if (event.clientX > 0 && event.clientY > 0) return;
    delete elements.intakeDialog.dataset.drag;
  });
  window.addEventListener("drop", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    delete elements.intakeDialog.dataset.drag;
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) void routeLocalFiles(files);
  });
  elements.intakeDialog.addEventListener("close", () => {
    delete elements.intakeDialog.dataset.drag;
  });
}

async function importLocalFiles(): Promise<void> {
  const files = Array.from(elements.importInput.files ?? []);
  elements.importInput.value = "";
  if (files.length === 0) return;
  await routeLocalFiles(files);
}

async function routeLocalFiles(files: readonly File[]): Promise<void> {
  const file = primaryIntakeFile(files);
  if (!file) return;
  presentIntakeResult("working", file.name, "INSPECTING LOCAL BYTES");
  try {
    if (isCinematicFile(file)) {
      elements.intakeDialog.close();
      await importCinematicFile(file);
      return;
    }
    if (sourceGeometryFormat(file)) {
      elements.intakeDialog.close();
      await importSourceGeometry(file, files);
      return;
    }
    if (isJsonFile(file) && file.size <= MAX_INLINE_RECONSTRUCTION_BYTES) {
      const source = await file.text();
      let parsed: unknown;
      try {
        parsed = parseStrictIntegerJson(source);
      } catch (error) {
        if (containsNativeSchema(source)) throw error;
        elements.intakeDialog.close();
        await openFileBackedArtifact(file);
        return;
      }
      if (isReconstructionArtifact(parsed)) {
        elements.intakeDialog.close();
        await importReconstructionFile(file, null, parsed);
        return;
      }
      if (isValidationLocusArtifact(parsed)) {
        elements.intakeDialog.close();
        await importValidationLocusFile(file, parsed);
        return;
      }
    }
    elements.intakeDialog.close();
    await openFileBackedArtifact(file);
  } catch (error) {
    console.error(error);
    presentIntakeFailure(file, error);
  }
}

function primaryIntakeFile(files: readonly File[]): File | undefined {
  return (
    files.find(isCinematicFile) ??
    files.find((file) => sourceGeometryFormat(file) !== null) ??
    files.find(isJsonFile) ??
    files[0]
  );
}

function isCinematicFile(file: File): boolean {
  return (
    file.name.toLowerCase().endsWith(".tessaryn") ||
    file.type.toLowerCase() === "application/vnd.tessaryn.object"
  );
}

function containsNativeSchema(source: string): boolean {
  return source.includes(NATIVE_RECONSTRUCTION_SCHEMA) || source.includes(NATIVE_VALIDATION_SCHEMA);
}

function presentIntakeResult(
  state: "working" | "accepted" | "indexed" | "rejected",
  file: string,
  detail: string,
): void {
  elements.intakeResult.hidden = false;
  elements.intakeResult.dataset.state = state;
  elements.intakeState.textContent = state.toUpperCase();
  elements.intakeFile.textContent = file || "UNNAMED LOCAL FILE";
  elements.intakeDetail.textContent = detail;
}

function presentIntakeFailure(file: File, error: unknown): void {
  if (!elements.intakeDialog.open) elements.intakeDialog.showModal();
  const detail = error instanceof Error ? error.message : String(error);
  presentIntakeResult("rejected", file.name, detail.toUpperCase());
  showToast(detail.toUpperCase());
}

async function importReconstructionFile(
  file: File,
  requestedEntry: PublicObjectCatalogEntry | null = null,
  preparedArtifact: ReconstructionArtifactView | null = null,
): Promise<void> {
  elements.importButton.disabled = true;
  elements.importButton.querySelector("span")!.textContent = "READING";
  try {
    const parsed = preparedArtifact ?? parseStrictIntegerJson(await file.text());
    if (!isReconstructionArtifact(parsed)) {
      throw new Error("unsupported reconstruction artifact");
    }
    const verification = await verifyReconstructionOffThread(parsed);
    if (verification.errors.length > 0) {
      throw new Error(verification.errors.join(" / "));
    }
    clearActiveConstruction();
    const cell = reconstructionCell(parsed);
    importedArtifact = parsed;
    importedVerification = verification;
    activeArtifactFile = file;
    activePublicEntry = requestedEntry;
    activeCinematicObject = null;
    if (window.__tessaryn) {
      window.__tessaryn.importedArtifact = parsed;
      window.__tessaryn.importedVerification = verification;
    }
    elements.app.dataset.source = "imported";
    elements.localStage.hidden = false;
    elements.localStage.dataset.kind = "reconstruction";
    elements.localKind.textContent = requestedEntry
      ? "PUBLIC REAL-CAPTURE LOCUS / LOCALLY VERIFIED"
      : "LOCAL REAL-CAPTURE LOCUS / LOCALLY VERIFIED";
    elements.localName.textContent = requestedEntry?.title ?? file.name;
    elements.localStatus.textContent = `${String(verification.surfels.length)} SURFELS + POWER HOUSE ACCEPTED`;
    elements.localSize.textContent = `${formatBytes(file.size)} / REAL RGB-D`;
    elements.localRoot.textContent = shortDigest(parsed.report.sdf_cell_id, 24);
    elements.localProgress.style.width = "100%";
    elements.localExport.disabled = true;
    elements.localShare.disabled = false;
    elements.localShare.title = requestedEntry ? "Share public Locus" : "Place in Object Weave";
    selected = cell;
    scene.loadSurfelObservation(cell, verification.surfels);
    elements.originName.textContent = "LOCAL RGB-D LOCUS";
    elements.cellCount.textContent = "2 CELLS";
    elements.anchorShort.textContent = shortDigest(cell.manifest.anchor_id, 8);
    elements.momentShort.textContent = "CAPTURE";
    elements.evidenceShort.textContent = "FULLY REVERIFIED";
    setTopIdentityState("ROOTPRINT VERIFIED");
    elements.originPhase.textContent = "ORIGIN / IMPORTED CAPTURE";
    elements.originStatus.textContent = "SURFEL + SDF LOCUS MATERIALIZED";
    elements.condensation.style.width = "100%";
    elements.chronofoldButton.disabled = true;
    elements.chronofoldButton.classList.remove("active");
    populateImportedMoment(cell);
    const route = new URL(location.href);
    if (requestedEntry) route.searchParams.set("object", requestedEntry.object_id);
    else route.searchParams.delete("object");
    if (requestedEntry?.publication_id) {
      route.searchParams.set("publication", requestedEntry.publication_id);
    } else {
      route.searchParams.delete("publication");
    }
    history.replaceState(null, "", route);
    showToast(`${String(verification.surfels.length)} SURFELS VERIFIED LOCALLY`);
    await showVerification();
  } catch (error) {
    console.error(error);
    if (requestedEntry) {
      showToast(error instanceof Error ? error.message.toUpperCase() : "IMPORT REJECTED");
    } else {
      presentIntakeFailure(file, error);
    }
  } finally {
    elements.importButton.disabled = false;
    elements.importButton.querySelector("span")!.textContent = "OPEN";
  }
}

async function importValidationLocusFile(
  file: File,
  artifact: ValidationLocusArtifactView,
): Promise<void> {
  elements.importButton.disabled = true;
  elements.importButton.querySelector("span")!.textContent = "VERIFYING";
  try {
    const verification = await verifyValidationOffThread(artifact);
    if (verification.errors.length > 0 || !verification.alternate) {
      throw new Error(verification.errors.join(" / ") || "validation Locus rejected");
    }
    clearActiveConstruction();
    const observations = temporalObservations(verification, artifact);
    scene.loadTemporalObservations(observations);
    scene.setMoment("moment-c");
    activeValidationLocus = { file, artifact, verification };
    activeArtifactFile = file;
    selected =
      observations.find((observation) => observation.id === "moment-c")?.cell ??
      observations[0]?.cell ??
      selected;
    latestVerification = validationVerificationReport(verification);
    if (window.__tessaryn) window.__tessaryn.verification = latestVerification;
    elements.app.dataset.source = "imported-validation";
    elements.localStage.hidden = false;
    elements.localStage.dataset.kind = "reconstruction";
    elements.localKind.textContent = "PORTABLE 4D LOCUS / LOCALLY VERIFIED";
    elements.localName.textContent = artifact.origin || file.name;
    elements.localStatus.textContent = `${String(verification.cellsValid)} CELLS + POWER HOUSE ACCEPTED`;
    elements.localSize.textContent = `${formatBytes(file.size)} / FOUR MOMENTS`;
    elements.localRoot.textContent = shortDigest(artifact.source_proof.cell_id, 24);
    elements.localProgress.style.width = "100%";
    elements.localExport.disabled = true;
    elements.localShare.disabled = true;
    elements.originName.textContent = artifact.origin;
    elements.cellCount.textContent = `${String(verification.cellsValid)} CELLS`;
    elements.anchorShort.textContent = shortDigest(selected.manifest.anchor_id, 8);
    elements.momentShort.textContent = "MOMENT C";
    elements.evidenceShort.textContent = "LOCALLY VERIFIED";
    setTopIdentityState("ROOTPRINT VERIFIED");
    elements.originPhase.textContent = "ORIGIN / IMPORTED 4D LOCUS";
    elements.originStatus.textContent = "FOUR MOMENTS / BRANCH RETAINED";
    elements.condensation.style.width = "100%";
    elements.chronofoldButton.disabled = false;
    elements.challengeButton.disabled = false;
    elements.exportButton.disabled = false;
    elements.scaleBreath.disabled = false;
    populateTemporalMoments(verification);
    const route = new URL(location.href);
    route.searchParams.delete("object");
    route.searchParams.delete("publication");
    route.searchParams.delete("origin");
    history.replaceState(null, "", route);
    showToast("PORTABLE 4D LOCUS VERIFIED / CONSTRUCTED");
    await showVerification();
  } catch (error) {
    console.error(error);
    restoreReferenceOrigin(false);
    presentIntakeFailure(file, error);
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
  clearActiveConstruction();
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
    activeArtifactFile = file;
    activePublicEntry = publicEntry;
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
    elements.localShare.disabled = false;
    elements.localShare.title = publicEntry ? "Share public object" : "Place in Object Weave";
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
    setTopIdentityState("ROOTPRINT VERIFIED");
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
    if (publicEntry?.publication_id) route.searchParams.set("publication", publicEntry.publication_id);
    else route.searchParams.delete("publication");
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
    restoreReferenceOrigin(false);
    if (requestedEntry) {
      showToast(error instanceof Error ? error.message.toUpperCase() : "OBJECT REJECTED");
    } else {
      presentIntakeFailure(file, error);
    }
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

async function importSourceGeometry(file: File, companions: readonly File[]): Promise<void> {
  elements.importButton.disabled = true;
  elements.importButton.querySelector("span")!.textContent = "READING";
  clearActiveConstruction();
  const indexing = openFileBackedArtifact(file, "geometry");
  const parsing = parseSourceGeometry(file, companions);
  const [indexed, parsed] = await Promise.allSettled([indexing, parsing]);
  elements.importButton.disabled = false;
  elements.importButton.querySelector("span")!.textContent = "OPEN";

  if (indexed.status === "rejected") {
    if (parsed.status === "fulfilled") disposeSourceGeometry(parsed.value);
    presentIntakeFailure(file, indexed.reason);
    return;
  }
  if (parsed.status === "rejected") {
    presentIntakeFailure(file, parsed.reason);
    return;
  }
  const state = indexed.value;
  if (!state.identity || state.status !== "indexed") {
    disposeSourceGeometry(parsed.value);
    presentIntakeFailure(file, new Error(state.error ?? "source stream identity failed"));
    return;
  }

  const displayScale = scene.loadSourceGeometry(parsed.value);
  activeSourceGeometry = {
    ...parsed.value.stats,
    name: file.name,
    streamRoot: state.identity.streamRoot,
    displayScale,
  };
  activeArtifactFile = null;
  activePublicEntry = null;
  activeCinematicObject = null;
  importedArtifact = null;
  importedVerification = null;
  activeValidationLocus = null;
  if (window.__tessaryn) {
    window.__tessaryn.sourceGeometry = activeSourceGeometry;
    delete window.__tessaryn.cinematicObject;
    delete window.__tessaryn.cinematicVerification;
    delete window.__tessaryn.importedArtifact;
    delete window.__tessaryn.importedVerification;
  }
  const stats = parsed.value.stats;
  const drawables = stats.meshes + stats.pointClouds;
  elements.app.dataset.source = "source-geometry";
  elements.localStage.dataset.kind = "geometry";
  elements.localKind.textContent = "SOURCE GEOMETRY / LOCAL BYTE IDENTITY";
  elements.localName.textContent = file.name;
  elements.localStatus.textContent = `${String(drawables)} DRAWABLES / ${String(stats.vertices)} VERTICES`;
  elements.localSize.textContent = `${formatBytes(file.size)} / ${stats.format.toUpperCase()} / INDEXED`;
  elements.localRoot.textContent = state.identity.streamRoot;
  elements.localProgress.style.width = "100%";
  elements.localExport.disabled = false;
  elements.localShare.disabled = true;
  elements.originName.textContent = file.name;
  elements.cellCount.textContent = `${String(drawables)} SOURCE DRAWABLES`;
  elements.anchorShort.textContent = "UNBOUND";
  elements.momentShort.textContent = "STATIC SOURCE";
  elements.evidenceShort.textContent = "STREAM ROOT ONLY";
  setTopIdentityState("SOURCE ROOT ONLY");
  elements.originPhase.textContent = "ORIGIN / SOURCE GEOMETRY";
  elements.originStatus.textContent = "GEOMETRY STAGED / WORLD CELL NOT ATTACHED";
  elements.condensation.style.width = "100%";
  elements.chronofoldButton.disabled = true;
  elements.challengeButton.disabled = true;
  elements.exportButton.disabled = false;
  elements.scaleBreath.disabled = false;
  populateSourceGeometryMoment(stats);
  const route = new URL(location.href);
  route.searchParams.delete("object");
  route.searchParams.delete("publication");
  route.searchParams.delete("origin");
  history.replaceState(null, "", route);
  showToast("SOURCE GEOMETRY STAGED / LOCAL STREAM ROOT COMPLETE");
}

function populateSourceGeometryMoment(stats: SourceGeometryStats): void {
  elements.momentRail.replaceChildren();
  const button = document.createElement("button");
  button.type = "button";
  button.className = "active";
  button.setAttribute("aria-pressed", "true");
  const label = document.createElement("b");
  const state = document.createElement("small");
  label.textContent = `01 / ${stats.format.toUpperCase()} SOURCE`;
  state.textContent = `${String(stats.vertices)} VERTICES`;
  button.append(label, state);
  elements.momentRail.append(button);
}

async function openFileBackedArtifact(
  file: File,
  kindOverride?: LocalFileKind,
): Promise<ActiveLocalImport> {
  const previousSource = activeLocalImport?.previousSource ?? elements.app.dataset.source;
  const previousOriginName =
    activeLocalImport?.previousOriginName ?? elements.originName.textContent ?? "";
  const previousCellCount =
    activeLocalImport?.previousCellCount ?? elements.cellCount.textContent ?? "";
  const previousOriginPhase =
    activeLocalImport?.previousOriginPhase ?? elements.originPhase.textContent ?? "";
  const previousOriginStatus =
    activeLocalImport?.previousOriginStatus ?? elements.originStatus.textContent ?? "";
  const previousAnchorShort =
    activeLocalImport?.previousAnchorShort ?? elements.anchorShort.textContent ?? "";
  const previousMomentShort =
    activeLocalImport?.previousMomentShort ?? elements.momentShort.textContent ?? "";
  const previousEvidenceShort =
    activeLocalImport?.previousEvidenceShort ?? elements.evidenceShort.textContent ?? "";
  const previousIdentityState =
    activeLocalImport?.previousIdentityState ?? elements.identityState.textContent?.trim() ?? "";
  const previousCondensationWidth =
    activeLocalImport?.previousCondensationWidth ?? elements.condensation.style.width;
  closeLocalFile(false);
  const state: ActiveLocalImport = {
    file,
    kind: kindOverride ?? localFileKind(file),
    status: "indexing",
    identity: null,
    progress: { bytesRead: 0, totalBytes: file.size, chunksRead: 0 },
    previousSource,
    previousOriginName,
    previousCellCount,
    previousOriginPhase,
    previousOriginStatus,
    previousAnchorShort,
    previousMomentShort,
    previousEvidenceShort,
    previousIdentityState,
    previousCondensationWidth,
  };
  activeLocalImport = state;
  elements.app.dataset.source = "local-file";
  elements.localStage.dataset.kind = state.kind;
  elements.localStage.hidden = false;
  elements.localName.textContent = file.name || "UNNAMED LOCAL FILE";
  elements.originName.textContent = file.name || "UNNAMED LOCAL FILE";
  elements.cellCount.textContent = "1 LOCAL FILE";
  elements.originPhase.textContent = "LOCAL SOURCE / BYTE IDENTITY";
  elements.originStatus.textContent = "INDEXING SOURCE EVIDENCE / NO UPLOAD";
  elements.anchorShort.textContent = "UNBOUND";
  elements.momentShort.textContent = "LOCAL FILE";
  elements.evidenceShort.textContent = "STREAM ROOT PENDING";
  setTopIdentityState("SOURCE ROOT ONLY");
  elements.condensation.style.width = "0%";
  elements.localKind.textContent = localFileKindLabel(state.kind);
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
    elements.condensation.style.width = `${percent.toFixed(3)}%`;
    syncLocalImportView();
  });
  activeLocalTask = task;

  try {
    const identity = await task.result;
    if (activeLocalImport !== state) return state;
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
    elements.condensation.style.width = "100%";
    elements.originStatus.textContent = "SOURCE EVIDENCE INDEXED / LOCAL IDENTITY READY";
    elements.evidenceShort.textContent = "STREAM ROOT COMPLETE";
    elements.localExport.disabled = false;
    elements.exportButton.disabled = false;
    syncLocalImportView();
    showToast("LOCAL STREAM ROOT COMPLETE");
  } catch (error) {
    if (
      activeLocalImport !== state ||
      (error instanceof DOMException && error.name === "AbortError")
    ) {
      return state;
    }
    state.status = "error";
    state.error = error instanceof Error ? error.message : String(error);
    activeLocalTask = null;
    elements.localStatus.textContent = "LOCAL INDEX FAILED";
    elements.originStatus.textContent = "SOURCE EVIDENCE INDEX FAILED";
    elements.evidenceShort.textContent = "INDEX CAUTION";
    elements.localRoot.textContent = state.error.toUpperCase();
    syncLocalImportView();
    showToast("LOCAL INDEX FAILED");
  }
  return state;
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
    elements.originPhase.textContent = active.previousOriginPhase;
    elements.originStatus.textContent = active.previousOriginStatus;
    elements.anchorShort.textContent = active.previousAnchorShort;
    elements.momentShort.textContent = active.previousMomentShort;
    elements.evidenceShort.textContent = active.previousEvidenceShort;
    setTopIdentityState(active.previousIdentityState);
    elements.condensation.style.width = active.previousCondensationWidth;
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

function temporalObservations(
  report: ValidationLocusBrowserReport,
  artifact: ValidationLocusArtifactView | null = validationArtifact,
): TemporalObservation[] {
  if (!artifact) throw new Error("validation artifact unavailable");
  const activeValidationArtifact = artifact;
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

function renderSourceGeometryVerification(
  source: SourceGeometryView,
  state: ActiveLocalImport,
): void {
  elements.verifyCells.textContent = "SOURCE ROOT";
  elements.verifyPha.textContent = "NOT ATTACHED";
  elements.verifyRootprint.textContent = "NOT ATTACHED";
  elements.verifyReplay.textContent = `${String(source.meshes + source.pointClouds)} DRAWABLES`;
  elements.verifyMemory.textContent = "FILE-BACKED";
  elements.verifyTitle.textContent = "SOURCE GEOMETRY STAGED";
  elements.verifyDetail.textContent =
    `${source.format.toUpperCase()} geometry with ${String(source.vertices)} vertices and ` +
    `${String(source.triangles)} triangles is rendered from local bytes. ` +
    `Stream root ${source.streamRoot}. No Cell, PHA, or Rootprint identity is inferred from source geometry.`;
  if (state.status === "error") elements.verifyTitle.textContent = "SOURCE INDEX CAUTION";
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

function openPublishDialog(): void {
  const metadata = activePublicationMetadata();
  if (!activeArtifactFile || !metadata) {
    showToast("OPEN A VERIFIED CONSTRUCTION FIRST");
    return;
  }
  elements.publishKind.textContent =
    metadata.artifactKind === "rgbd_reconstruction"
      ? "REAL RGB-D CONSTRUCTION"
      : "NATIVE TEMPORAL OBJECT";
  elements.publishFile.textContent = activeArtifactFile.name;
  elements.publishCell.textContent = metadata.cellId;
  elements.publishObjectId.value = metadata.objectId;
  elements.publishTitle.value = metadata.title;
  elements.publishSummary.value = metadata.summary;
  elements.publishConsent.checked = false;
  setPublishBusy(false);
  updatePublicationProgress({
    stage: "identity",
    bytesProcessed: 0,
    totalBytes: activeArtifactFile.size,
    completedChunks: 0,
    totalChunks: 0,
  });
  elements.publishStage.textContent = "READY";
  elements.publishDetail.textContent = weaveConfig
    ? "LOCAL PUBLISHER KEY / RESUMABLE VERIFIED ADMISSION"
    : "PUBLIC NODE OFFLINE / DEVICE WEAVE AVAILABLE";
  if (!elements.publishDialog.open) elements.publishDialog.showModal();
}

function closePublishDialog(): void {
  publishAbort?.abort();
  publishAbort = null;
  setPublishBusy(false);
  if (elements.publishDialog.open) elements.publishDialog.close();
}

async function keepActiveObject(): Promise<void> {
  const metadata = publicationFormMetadata();
  const file = activeArtifactFile;
  if (!file || !metadata) return;
  setPublishBusy(true);
  elements.publishStage.textContent = "RETAINING ON DEVICE";
  elements.publishDetail.textContent = "REQUESTING DURABLE BROWSER STORAGE";
  try {
    const record = await saveToPersonalWeave(file, metadata);
    personalWeaveObjects = [
      record,
      ...personalWeaveObjects.filter((candidate) => candidate.localId !== record.localId),
    ];
    updateWeaveCounts();
    elements.publishProgress.dataset.state = "complete";
    elements.publishProgressBar.style.width = "100%";
    elements.publishPercent.textContent = "100%";
    elements.publishStage.textContent = "RETAINED ON THIS DEVICE";
    elements.publishDetail.textContent = record.artifactSha256;
    showToast("CONSTRUCTION RETAINED IN YOUR PERSONAL WEAVE");
  } catch (error) {
    elements.publishProgress.dataset.state = "error";
    elements.publishStage.textContent = "DEVICE RETENTION FAILED";
    elements.publishDetail.textContent = error instanceof Error ? error.message.toUpperCase() : "STORAGE FAILED";
  } finally {
    setPublishBusy(false);
  }
}

async function publishActiveObject(): Promise<void> {
  const metadata = publicationFormMetadata();
  const file = activeArtifactFile;
  if (!file || !metadata) return;
  if (!weaveConfig) {
    elements.publishStage.textContent = "PUBLIC NODE OFFLINE";
    elements.publishDetail.textContent = "KEEP ON DEVICE REMAINS AVAILABLE";
    return;
  }
  if (!elements.publishConsent.checked) {
    elements.publishConsent.focus();
    elements.publishStage.textContent = "PUBLICATION AUTHORIZATION REQUIRED";
    return;
  }
  publishAbort?.abort();
  publishAbort = new AbortController();
  setPublishBusy(true);
  try {
    const receipt = await publishArtifact(
      weaveConfig.api,
      file,
      metadata,
      updatePublicationProgress,
      publishAbort.signal,
    );
    const record = await saveToPersonalWeave(
      file,
      metadata,
      receipt.intent.artifact_sha256,
    );
    await markPersonalObjectPublished(record.localId, receipt);
    record.publicationId = receipt.publication_id;
    record.publicArtifact = receipt.artifact_url;
    personalWeaveObjects = [
      record,
      ...personalWeaveObjects.filter((candidate) => candidate.localId !== record.localId),
    ];
    const entry: PublicObjectCatalogEntry = {
      publication_id: receipt.publication_id,
      publisher_id: receipt.publisher_id,
      object_id: receipt.intent.object_id,
      title: receipt.intent.title,
      artifact: receipt.artifact_url,
      artifact_sha256: receipt.intent.artifact_sha256,
      artifact_bytes: receipt.intent.artifact_bytes,
      artifact_kind: receipt.artifact_kind,
      cell_id: receipt.cell_id,
      rootprint_branch: receipt.rootprint_branch,
      media: receipt.media,
      dimensions: receipt.dimensions,
      moments: receipt.moments,
      summary: receipt.intent.summary,
      accepted_at_unix_us: receipt.accepted_at_unix_us,
    };
    publicObjectCatalog = mergePublicCatalogs(
      {
        schema: "tessaryn/public-object-catalog/v2",
        updated_at_unix_us: receipt.accepted_at_unix_us,
        objects: [entry],
      },
      publicObjectCatalog,
    );
    activePublicEntry = entry;
    if (activeCinematicObject) activeCinematicObject.publicEntry = entry;
    elements.localKind.textContent =
      metadata.artifactKind === "rgbd_reconstruction"
        ? "PUBLIC REAL-CAPTURE LOCUS / LOCALLY VERIFIED"
        : "PUBLIC OBJECT WEAVE / LOCALLY VERIFIED";
    elements.localShare.title = "Share public construction";
    const route = new URL(location.href);
    route.searchParams.set("object", entry.object_id);
    route.searchParams.set("publication", receipt.publication_id);
    history.replaceState(null, "", route);
    updateWeaveCounts();
    elements.publishProgress.dataset.state = "complete";
    elements.publishStage.textContent = "PUBLIC WEAVE ACCEPTED";
    elements.publishDetail.textContent = receipt.publication_id;
    showToast("SIGNED CONSTRUCTION PUBLISHED / NO GITHUB WORKFLOW");
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    elements.publishProgress.dataset.state = "error";
    elements.publishStage.textContent = "PUBLICATION REJECTED";
    elements.publishDetail.textContent = error instanceof Error ? error.message.toUpperCase() : "PUBLICATION FAILED";
    showToast("PUBLICATION REJECTED / LOCAL OBJECT UNCHANGED");
  } finally {
    publishAbort = null;
    setPublishBusy(false);
  }
}

function publicationFormMetadata(): PublicationMetadata | null {
  const active = activePublicationMetadata();
  if (!active) return null;
  return {
    ...active,
    objectId: elements.publishObjectId.value,
    title: elements.publishTitle.value,
    summary: elements.publishSummary.value,
  };
}

function activePublicationMetadata(): PublicationMetadata | null {
  if (activeCinematicObject) {
    const envelope = activeCinematicObject.envelope;
    return {
      objectId: envelope.descriptor.object_id,
      title: envelope.descriptor.title,
      summary: envelope.descriptor.slbit.summary,
      mediaType: activeArtifactFile?.type || "application/vnd.tessaryn.object",
      cellId: envelope.cell_proof.cell_id,
      rootprintBranch: envelope.cell_proof.rootprint.root_branch,
      artifactKind: "cinematic_object",
    };
  }
  if (importedArtifact) {
    const base = (activeArtifactFile?.name ?? "real-capture")
      .replace(/\.[^.]+$/u, "")
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "");
    return {
      objectId:
        base.length >= 3
          ? base
          : `capture-${importedArtifact.report.sdf_cell_id.replace(/^sha256:/u, "").slice(0, 12)}`,
      title: activePublicEntry?.title ?? "LOCAL RGB-D LOCUS",
      summary:
        activePublicEntry?.summary ??
        "A privacy-filtered real sensor reconstruction with locally verified surfels, sparse SDF, Rootprint lineage, and replay.",
      mediaType: "application/json",
      cellId: importedArtifact.report.sdf_cell_id,
      rootprintBranch: importedArtifact.lineage.rootprint.root_branch,
      artifactKind: "rgbd_reconstruction",
    };
  }
  return null;
}

function updatePublicationProgress(progress: PublicationProgress): void {
  const percent =
    progress.totalBytes === 0
      ? progress.stage === "complete"
        ? 100
        : 0
      : Math.min(100, Math.round((progress.bytesProcessed / progress.totalBytes) * 100));
  elements.publishProgress.dataset.state = progress.stage;
  elements.publishStage.textContent = progress.stage.replaceAll("_", " ").toUpperCase();
  elements.publishPercent.textContent = `${String(percent)}%`;
  elements.publishProgressBar.style.width = `${String(percent)}%`;
  elements.publishDetail.textContent =
    progress.totalChunks > 0
      ? `${String(progress.completedChunks)} / ${String(progress.totalChunks)} CHUNKS / ${formatBytes(progress.bytesProcessed)}`
      : `${formatBytes(progress.bytesProcessed)} / ${formatBytes(progress.totalBytes)}`;
}

function setPublishBusy(busy: boolean): void {
  elements.keepObject.disabled = busy;
  elements.publishObject.disabled = busy;
  elements.publishObjectId.disabled = busy;
  elements.publishTitle.disabled = busy;
  elements.publishSummary.disabled = busy;
  elements.publishConsent.disabled = busy;
}

function clearActiveConstruction(): void {
  activeCinematicObject = null;
  activeSourceGeometry = null;
  activeValidationLocus = null;
  activeArtifactFile = null;
  activePublicEntry = null;
  importedArtifact = null;
  importedVerification = null;
  if (window.__tessaryn) {
    delete window.__tessaryn.cinematicObject;
    delete window.__tessaryn.cinematicVerification;
    delete window.__tessaryn.importedArtifact;
    delete window.__tessaryn.importedVerification;
    delete window.__tessaryn.sourceGeometry;
  }
  closeLocalFile(false);
  elements.cinematicControls.hidden = true;
  elements.localShare.disabled = true;
  chronofoldOpen = false;
  elements.chronofoldButton.classList.remove("active");
  elements.chronofoldButton.setAttribute("aria-pressed", "false");
  closeTrace();
  closeChallenge();
}

function openValidationOrigin(notify = true): void {
  clearActiveConstruction();
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
  setTopIdentityState("ROOTPRINT VERIFIED");
  elements.originPhase.textContent = "ORIGIN / MATERIALIZED";
  elements.originStatus.textContent = "GROUND-TRUTH LAB / CONTINUUM STABLE";
  elements.condensation.style.width = "100%";
  elements.chronofoldButton.disabled = false;
  elements.challengeButton.disabled = false;
  elements.exportButton.disabled = false;
  elements.scaleBreath.disabled = false;
  populateTemporalMoments(validationVerification);
  const route = new URL(location.href);
  route.searchParams.delete("object");
  route.searchParams.delete("publication");
  route.searchParams.set("origin", "validation");
  history.replaceState(null, "", route);
  latestVerification = validationVerificationReport(validationVerification);
  if (window.__tessaryn) window.__tessaryn.verification = latestVerification;
  if (notify) showToast("GROUND-TRUTH VALIDATION LOCUS OPEN");
}

function restoreReferenceOrigin(notify = true): void {
  clearActiveConstruction();
  scene.loadReferenceWorld();
  selected =
    worldData.cells.find((cell) => cell.key === "archive-c") ??
    worldData.cells[0] ??
    selected;
  evidenceVisible = true;
  scene.setEvidence(true);
  elements.evidenceButton.classList.add("active");
  elements.evidenceButton.setAttribute("aria-pressed", "true");
  elements.app.dataset.source = "reference";
  elements.originName.textContent = "LOCAL CONSTRUCTION FIELD";
  elements.cellCount.textContent = `${String(worldData.cells.length)} REFERENCE CELLS`;
  elements.anchorShort.textContent = shortDigest(worldData.anchor_id, 8);
  elements.momentShort.textContent = "REFERENCE";
  elements.evidenceShort.textContent = "LOCALLY VERIFIED";
  setTopIdentityState("ROOTPRINT LIVE");
  elements.originPhase.textContent = "PRIVATE ORIGIN / READY";
  elements.originStatus.textContent = "PRIVATE ORIGIN READY / ADD YOUR CAPTURE";
  elements.condensation.style.width = "100%";
  elements.chronofoldButton.disabled = false;
  elements.challengeButton.disabled = false;
  elements.exportButton.disabled = false;
  elements.scaleBreath.disabled = false;
  populateMoments(worldData.moments);
  const route = new URL(location.href);
  route.searchParams.delete("object");
  route.searchParams.delete("publication");
  route.searchParams.delete("origin");
  history.replaceState(null, "", route);
  latestVerification = referenceVerification;
  if (window.__tessaryn) window.__tessaryn.verification = latestVerification;
  if (notify) showToast("PRIVATE ORIGIN READY / ADD A CAPTURE");
}

async function shareActiveObject(): Promise<void> {
  const entry = activePublicEntry;
  if (!entry) return;
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("object", entry.object_id);
  if (entry.publication_id) url.searchParams.set("publication", entry.publication_id);
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

function setTopIdentityState(label: string): void {
  const signal = document.createElement("i");
  elements.identityState.replaceChildren(signal, document.createTextNode(label));
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

function localFileKindLabel(kind: LocalFileKind): string {
  if (kind === "geometry") return "SOURCE GEOMETRY / INDEXING LOCAL BYTES";
  if (kind === "video") return "SOURCE VIDEO / INDEXED EVIDENCE / NOT WORLD GEOMETRY";
  if (kind === "image") return "SOURCE IMAGE / INDEXED EVIDENCE / NOT WORLD GEOMETRY";
  if (kind === "audio") return "SOURCE AUDIO / INDEXED EVIDENCE / NOT WORLD GEOMETRY";
  return "SOURCE FILE / FILE-BACKED IDENTITY";
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
