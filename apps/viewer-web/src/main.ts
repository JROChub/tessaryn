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
  VerificationReport,
} from "./types";
import { parseStrictIntegerJson } from "./strict-json";
import { runMutation, verifyReconstructionArtifact, verifyWorld } from "./verification";
import { TessarynWorld, type ScaleMode } from "./world";

declare global {
  interface Window {
    __tessaryn?: {
      world: DemoWorld;
      verification: VerificationReport | null;
      importedArtifact?: ReconstructionArtifactView;
      importedVerification?: ReconstructionBrowserReport;
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
  bootStatus: byId<HTMLElement>("boot-status"),
  toast: byId<HTMLElement>("toast"),
};

let worldData: DemoWorld;
let scene: TessarynWorld;
let selected: DemoCell;
let latestVerification: VerificationReport | null = null;
let importedArtifact: ReconstructionArtifactView | null = null;
let importedVerification: ReconstructionBrowserReport | null = null;
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
    const response = await fetch("./world/vesper-court.json", { cache: "no-store" });
    if (!response.ok) throw new Error("world fixture unavailable");
    worldData = (await response.json()) as DemoWorld;
    if (
      worldData.schema !== "tessaryn/demo-world/v0" ||
      worldData.status !== "reference-origin"
    ) {
      throw new Error("unsupported world fixture");
    }
    selected =
      worldData.cells.find((cell) => cell.key === "archive-c") ??
      worldData.cells[0] ??
      fail("world contains no Cells");
    populateMoments(worldData.moments);
    elements.originName.textContent = worldData.origin;
    elements.cellCount.textContent = String(worldData.cells.length) + " CELLS";
    elements.anchorShort.textContent = shortDigest(worldData.anchor_id, 8);
    elements.momentShort.textContent = "MOMENT C";
    elements.evidenceShort.textContent = "ASSEMBLING";
    scene = new TessarynWorld(elements.canvas, worldData, {
      onCellSelected: openTrace,
      onCondensationProgress: updateCondensation,
      onCondensationComplete: finishCondensation,
      onScaleChanged: updateScaleButtons,
    });
    window.addEventListener("pagehide", () => scene.destroy(), { once: true });
    window.__tessaryn = {
      world: worldData,
      verification: null,
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
    latestVerification = await verifyWorld(worldData);
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
      elements.momentShort.textContent = "MOMENT " + String.fromCharCode(65 + index);
      elements.originStatus.textContent = "MATERIALIZED / " + moment.label.toUpperCase();
      showToast(moment.label.toUpperCase());
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
  elements.originStatus.textContent = "VESPER COURT / CONTINUUM STABLE";
  elements.evidenceShort.textContent = "LOCALLY VERIFIED";
  showToast("18 WORLD CELLS / CONTINUUM ASSEMBLED");
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
}

function closeTrace(): void {
  elements.traceDrawer.classList.remove("open");
  elements.traceDrawer.setAttribute("aria-hidden", "true");
  elements.traceDrawer.setAttribute("inert", "");
  elements.worldLabel.hidden = true;
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
    const semanticCapsule = importedArtifact?.observation_proof.memory_capsule;
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
    const report = await verifyReconstructionArtifact(importedArtifact);
    importedVerification = report;
    renderImportedVerification(report);
    return;
  }
  const report = await verifyWorld(worldData);
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
    const verification = await verifyReconstructionArtifact(parsed);
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

function reconstructionCell(artifact: ReconstructionArtifactView): DemoCell {
  const proof = artifact.observation_proof;
  const packet = proof.memory_capsule.semantics?.packets?.[0]?.packet as
    | { summary?: unknown }
    | undefined;
  return {
    key: "imported-rgbd-observation",
    label: "IMPORTED RGB-D OBSERVATION",
    cell_id: artifact.report.observation.cell_id,
    manifest: artifact.report.observation.manifest,
    channel_payload: {},
    visual: {
      primitive: "surfel",
      position_mm: [0, 1_000, 0],
      size_mm: [1_000, 1_000, 1_000],
      rotation_mdeg: [0, 0, 0],
      color: "#74c8c1",
      material: "captured-surfel-field",
      seed: 0,
      moments: worldData.moments.map((moment) => moment.id),
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
      ? `${String(report.surfels.length)} surfels and ${String(report.voxels)} SDF voxels verified. Raw frames are absent. Physical sensor honesty is not proven.`
      : report.errors.join(" / ");
}

function exportCapsule(): void {
  const capsule = importedArtifact?.sdf_proof.memory_capsule ?? worldData.origin_memory_capsule;
  const bytes = JSON.stringify(capsule, null, 2) + "\n";
  const blob = new Blob([bytes], { type: "application/vnd.powerhouse.memory+json" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = importedArtifact ? "tessaryn-imported-sdf.phm" : "vesper-court-origin.phm";
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
