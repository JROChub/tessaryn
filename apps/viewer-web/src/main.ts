import {
  Box,
  Code2,
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
  DemoCell,
  DemoMoment,
  DemoWorld,
  ReconstructionArtifactView,
  ReconstructionBrowserReport,
  TemporalLocusArtifactView,
  TemporalLocusBrowserReport,
  VerificationReport,
} from "./types";
import { parseStrictIntegerJson } from "./strict-json";
import { runMutation } from "./verification";
import {
  destroyVerificationWorker,
  verifyReconstructionOffThread,
  verifyTemporalOffThread,
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
      temporalArtifact?: TemporalLocusArtifactView;
      temporalVerification?: TemporalLocusBrowserReport;
      verifyTemporalArtifact: typeof verifyTemporalOffThread;
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
};

let worldData: DemoWorld;
let scene: TessarynWorld;
let selected: DemoCell;
let latestVerification: VerificationReport | null = null;
let importedArtifact: ReconstructionArtifactView | null = null;
let importedVerification: ReconstructionBrowserReport | null = null;
let temporalArtifact: TemporalLocusArtifactView | null = null;
let temporalVerification: TemporalLocusBrowserReport | null = null;
const temporalArtifactsByCell = new Map<string, ReconstructionArtifactView>();
const temporalCellsByMoment = new Map<string, DemoCell>();
let chronofoldOpen = false;
let evidenceVisible = true;
let condensationComplete = false;
let toastTimer = 0;
const MAX_IMPORT_BYTES = 128 * 1024 * 1024;
const runtimeMetrics: RuntimeMetrics = {
  bootStartedAtMs: performance.now(),
};

void boot();

async function boot(): Promise<void> {
  try {
    elements.bootStatus.textContent = "READING LOCAL CELL MANIFESTS";
    const [worldResponse, temporalResponse] = await Promise.all([
      fetch("./world/vesper-court.json", { cache: "no-store" }),
      fetch("./world/freiburg-desk-locus.json", { cache: "no-store" }),
    ]);
    if (!worldResponse.ok) throw new Error("world fixture unavailable");
    if (!temporalResponse.ok) throw new Error("real temporal Locus unavailable");
    worldData = (await worldResponse.json()) as DemoWorld;
    if (
      worldData.schema !== "tessaryn/demo-world/v0" ||
      worldData.status !== "reference-origin"
    ) {
      throw new Error("unsupported world fixture");
    }
    const parsedTemporal = parseStrictIntegerJson(await temporalResponse.text());
    if (!isTemporalLocusArtifact(parsedTemporal)) {
      throw new Error("unsupported temporal Locus artifact");
    }
    temporalArtifact = parsedTemporal;
    elements.bootStatus.textContent = "VERIFYING REAL RGB-D CONTINUUM";
    temporalVerification = await verifyTemporalOffThread(parsedTemporal);
    if (temporalVerification.errors.length > 0 || !temporalVerification.alternate) {
      throw new Error(temporalVerification.errors.join(" / ") || "temporal Locus rejected");
    }
    const observations = temporalObservations(temporalVerification);
    selected =
      observations.find((observation) => observation.id === "moment-c")?.cell ??
      observations[0]?.cell ??
      fail("temporal Locus contains no observations");
    populateTemporalMoments(temporalVerification);
    elements.originName.textContent = parsedTemporal.origin;
    elements.cellCount.textContent = String(temporalVerification.cellsValid) + " CELLS";
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
        destroyVerificationWorker();
        scene.destroy();
      },
      { once: true },
    );
    window.__tessaryn = {
      world: worldData,
      verification: temporalVerificationReport(temporalVerification),
      temporalArtifact: parsedTemporal,
      temporalVerification,
      verifyTemporalArtifact: verifyTemporalOffThread,
      scene,
      metrics: runtimeMetrics,
    };
    bindControls();
    createIcons({
      icons: {
        Box,
        Code2,
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
    latestVerification = temporalVerificationReport(temporalVerification);
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
  elements.importButton.addEventListener("click", () => elements.importInput.click());
  elements.importInput.addEventListener("change", () => void importReconstruction());
  elements.verifyClose.addEventListener("click", () => elements.verificationDialog.close());
  elements.fullscreenButton.addEventListener("click", () => void toggleFullscreen());
  elements.traceClose.addEventListener("click", closeTrace);
  elements.challengeClose.addEventListener("click", closeChallenge);
  elements.challengeButton.addEventListener("click", openChallenge);
  elements.exportButton.addEventListener("click", exportCapsule);
  elements.resetButton.addEventListener("click", () => {
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
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeTrace();
    closeChallenge();
    if (elements.verificationDialog.open) elements.verificationDialog.close();
  });
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

function populateTemporalMoments(report: TemporalLocusBrowserReport): void {
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
  elements.originStatus.textContent = temporalArtifact
    ? "FREIBURG DESK / CONTINUUM STABLE"
    : "VESPER COURT / CONTINUUM STABLE";
  elements.evidenceShort.textContent = "LOCALLY VERIFIED";
  showToast(
    `${String(temporalVerification?.cellsValid ?? latestVerification?.cellsValid ?? worldData.cells.length)} WORLD CELLS / CONTINUUM ASSEMBLED`,
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
  if (importedArtifact) {
    const report = await verifyReconstructionOffThread(importedArtifact);
    importedVerification = report;
    renderImportedVerification(report);
    return;
  }
  if (temporalArtifact) {
    if (temporalVerification) {
      renderTemporalVerification(temporalVerification);
      return;
    }
    const report = await verifyTemporalOffThread(temporalArtifact);
    temporalVerification = report;
    latestVerification = temporalVerificationReport(report);
    if (window.__tessaryn) {
      window.__tessaryn.temporalVerification = report;
      window.__tessaryn.verification = latestVerification;
    }
    renderTemporalVerification(report);
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

function renderTemporalVerification(report: TemporalLocusBrowserReport): void {
  elements.verifyCells.textContent = `${String(report.cellsValid)} / 9 VALID`;
  elements.verifyPha.textContent = `${String(report.phaValid)} / 9 VALID`;
  elements.verifyRootprint.textContent = report.rootprintValid ? "VALID" : "INVALID";
  elements.verifyReplay.textContent = report.replayValid ? "VALID" : "INVALID";
  elements.verifyMemory.textContent = report.memoryValid ? "VALID" : "INVALID";
  elements.verifyTitle.textContent =
    report.errors.length === 0 ? "REAL 4D LOCUS ACCEPTED" : "VERIFICATION CAUTION";
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
      ? `${String(surfels)} sensor surfels and ${String(voxels)} SDF voxels verified across three Moments and one Rootprint branch.`
      : report.errors.join(" / ");
}

async function importReconstruction(): Promise<void> {
  const file = elements.importInput.files?.[0];
  elements.importInput.value = "";
  if (!file) return;
  if (file.size > MAX_IMPORT_BYTES) {
    showToast("ARTIFACT EXCEEDS 128 MIB BROWSER PROFILE");
    return;
  }
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

function isReconstructionArtifact(value: unknown): value is ReconstructionArtifactView {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { schema?: unknown }).schema === "tessaryn/reconstruction-artifact/v0" &&
    typeof (value as { report?: unknown }).report === "object"
  );
}

function isTemporalLocusArtifact(value: unknown): value is TemporalLocusArtifactView {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { schema?: unknown }).schema === "tessaryn/temporal-locus-artifact/v0" &&
    Array.isArray((value as { moments?: unknown }).moments)
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

function temporalObservations(report: TemporalLocusBrowserReport): TemporalObservation[] {
  if (!temporalArtifact) throw new Error("temporal artifact unavailable");
  temporalArtifactsByCell.clear();
  temporalCellsByMoment.clear();
  const values = [
    ...report.moments.map((moment) => ({ ...moment, alternate: false })),
    ...(report.alternate ? [{ ...report.alternate, alternate: true }] : []),
  ];
  const sourceStates = [...temporalArtifact.moments, temporalArtifact.alternate];
  return values.map((moment, index) => {
    const artifact = sourceStates[index]?.artifact;
    if (!artifact) throw new Error(`${moment.id}: temporal artifact binding unavailable`);
    const cell = reconstructionCell(artifact, {
      key: `real-${moment.id}`,
      label: `${moment.label} / VERIFIED SDF`,
      momentId: moment.id,
      layer: "sdf",
      alternate: moment.alternate,
    });
    cell.semantic_summary = `${moment.label} from the TUM Freiburg1 desk RGB-D sequence. ${String(moment.verification.surfels.length)} color surfels and ${String(moment.verification.voxels)} sparse-SDF voxels assemble this state.`;
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
    };
  });
}

function temporalVerificationReport(
  report: TemporalLocusBrowserReport,
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

function exportCapsule(): void {
  const temporalSelected = temporalArtifactsByCell.get(selected.key);
  const capsule =
    importedArtifact?.sdf_proof.memory_capsule ??
    temporalSelected?.sdf_proof.memory_capsule ??
    worldData.origin_memory_capsule;
  const bytes = JSON.stringify(capsule, null, 2) + "\n";
  const blob = new Blob([bytes], { type: "application/vnd.powerhouse.memory+json" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = importedArtifact
    ? "tessaryn-imported-sdf.phm"
    : temporalSelected
      ? `${selected.key}.phm`
      : "vesper-court-origin.phm";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1_000);
  showToast("MEMORY CAPSULE EXPORTED");
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
