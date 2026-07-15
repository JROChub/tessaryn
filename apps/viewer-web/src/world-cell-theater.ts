import "./world-cell-theater.css";
import * as THREE from "three";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  KeyxymV22Runtime,
  type KeyxymPoseEstimate,
  type KeyxymQuality,
  type KeyxymSurfel,
} from "./keyxym-v22-runtime";
import { verifyKeyxymV22Bundle, type KeyxymProvenanceManifest } from "./keyxym-v22-provenance";
import {
  KeyxymFrontendRuntime,
  type KeyxymFormingSample,
} from "./keyxym-frontend-runtime";
import {
  assuranceRequest,
  verifyWorldCellAssurance,
  type VerifiedWorldCellAssurance,
  type WorldCellEvidenceRecord,
} from "./world-cell-assurance";

const ANALYSIS_WIDTH = 160;
const MAX_MOMENTS = 8;
const ZERO_DIGEST = "0".repeat(64);
const MIN_MOMENT_TRACKING = 0.25;
const MIN_SEAL_TRACKING = 0.55;
const MIN_SEAL_PARALLAX = 1;
const MAX_SEAL_REPROJECTION = 3;
const MIN_SEAL_CONFIRMED = 128;
const encoder = new TextEncoder();

const q = <T extends HTMLElement>(id: string): T => {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing World Cell Theater element ${id}`);
  return value as T;
};
const text = (id: string, value: string): void => { q(id).textContent = value; };
const disabled = (id: string, value: boolean): void => { q<HTMLButtonElement>(id).disabled = value; };
const hex = (bytes: Uint8Array): string => Array.from(
  bytes,
  (value) => value.toString(16).padStart(2, "0"),
).join("");

function canonical(value: unknown): string {
  if (value === null || typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  throw new Error("World Cell canonical value is unsupported");
}
const digest = (value: unknown): string => hex(sha256(encoder.encode(
  typeof value === "string" ? value : canonical(value),
)));

interface PackedMoment {
  version: 22;
  id: string;
  sequence: number;
  createdNs: string;
  parentCommitment: string;
  authorityReceipt: string;
  geometryCommitment: string;
  sourceSetCommitment: string;
  calibrationCommitment: string;
  runtimeCommitment: string;
  metricScale: boolean;
  pose: number[];
  quality: KeyxymQuality;
  geometry: number[];
}

interface WorldCellBody {
  version: 22;
  branch: "main";
  createdNs: string;
  runtimeCommitment: string;
  calibrationCommitment: string;
  sourceSetCommitment: string;
  moments: PackedMoment[];
}

interface SealedWorldCell {
  schema: "tessaryn.metric-world-cell/v22";
  id: string;
  body: WorldCellBody;
  canonicalDigest: string;
  rootprintCommitment: string;
  assuranceRecord: string;
  assuranceEnvelope: string;
}

interface EvidenceEntry {
  time: number;
  kind: string;
  state: string;
  commitment: string;
  details: Record<string, unknown>;
}

const video = q<HTMLVideoElement>("camera");
const canvas = q<HTMLCanvasElement>("stage");
const sampleCanvas = document.createElement("canvas");
const context = sampleCanvas.getContext("2d", { willReadFrequently: true });
if (!context) throw new Error("World Cell capture context unavailable");
const sampleContext: CanvasRenderingContext2D = context;

const renderer = new THREE.WebGLRenderer({
  canvas,
  alpha: true,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const stageCamera = new THREE.PerspectiveCamera(52, 1, 0.01, 100);
stageCamera.position.set(0, 0, 2.8);
scene.add(new THREE.AmbientLight(0xffffff, 1.2));

const worldGroup = new THREE.Group();
const formingGroup = new THREE.Group();
scene.add(worldGroup, formingGroup);
const confirmedGeometry = new THREE.BufferGeometry();
const confirmedMaterial = new THREE.PointsMaterial({
  size: 0.024,
  vertexColors: true,
  sizeAttenuation: true,
  transparent: true,
  opacity: 0.98,
  depthWrite: true,
});
const confirmedCloud = new THREE.Points(confirmedGeometry, confirmedMaterial);
worldGroup.add(confirmedCloud);
const formingGeometry = new THREE.BufferGeometry();
const formingMaterial = new THREE.PointsMaterial({
  size: 0.018,
  vertexColors: true,
  sizeAttenuation: true,
  transparent: true,
  opacity: 0.72,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});
const formingCloud = new THREE.Points(formingGeometry, formingMaterial);
formingGroup.add(formingCloud);
const trajectoryGeometry = new THREE.BufferGeometry();
const trajectoryMaterial = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.75 });
const trajectoryLine = new THREE.Line(trajectoryGeometry, trajectoryMaterial);
worldGroup.add(trajectoryLine);
const grid = new THREE.GridHelper(4, 32, 0x1c5770, 0x102433);
grid.rotation.x = Math.PI / 2;
grid.position.z = -1.65;
scene.add(grid);
const raycaster = new THREE.Raycaster();
raycaster.params.Points = { threshold: 0.08 };
const pointer = new THREE.Vector2();

let core: KeyxymV22Runtime | null = null;
let frontend: KeyxymFrontendRuntime | null = null;
let coreManifest: KeyxymProvenanceManifest | null = null;
let stream: MediaStream | null = null;
let running = false;
let processing = false;
let frameNumber = 0;
let latestPose: KeyxymPoseEstimate | null = null;
let latestQuality: KeyxymQuality | null = null;
let latestGeometry: KeyxymSurfel[] = [];
let latestGeometryPacked: number[] = [];
let latestForming: KeyxymFormingSample[] = [];
let sourceCommitments: string[] = [];
let sourceSetCommitment = ZERO_DIGEST;
let runtimeCommitment = ZERO_DIGEST;
let calibrationCommitment = ZERO_DIGEST;
let scaleMetersPerUnit = 1;
let metricScale = false;
let moments: PackedMoment[] = [];
let currentMoment = -1;
let trajectory: number[][] = [];
let assuranceEvidence: WorldCellEvidenceRecord | null = null;
let assuranceBody: WorldCellBody | null = null;
let verifiedAssurance: VerifiedWorldCellAssurance | null = null;
let sealedCell: SealedWorldCell | null = null;
let playTimer = 0;
let calibrationKnownMeters: number | null = null;
let calibrationPicks: number[] = [];
let peer: RTCPeerConnection | null = null;
let channel: RTCDataChannel | null = null;
let pendingChunks: Uint8Array[] = [];
let expectedDigest = "";
let expectedBytes = 0;
const evidence: EvidenceEntry[] = [];

function recordEvidence(kind: string, state: string, details: Record<string, unknown>): void {
  const commitment = digest({ kind, state, details, previous: evidence.at(-1)?.commitment ?? ZERO_DIGEST });
  evidence.push({ time: Date.now(), kind, state, commitment, details });
  q("evidence-log").textContent = JSON.stringify(evidence, null, 2);
}

function resize(): void {
  const bounds = canvas.getBoundingClientRect();
  renderer.setSize(bounds.width, bounds.height, false);
  stageCamera.aspect = bounds.width / Math.max(1, bounds.height);
  stageCamera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);

function render(): void {
  worldGroup.rotation.y += running ? 0.0008 : 0.00025;
  formingGroup.rotation.z = Math.sin(performance.now() * 0.00022) * 0.012;
  renderer.render(scene, stageCamera);
  requestAnimationFrame(render);
}
render();

function updateForming(samples: KeyxymFormingSample[]): void {
  const positions = new Float32Array(samples.length * 3);
  const colors = new Float32Array(samples.length * 3);
  const aspect = sampleCanvas.width / Math.max(1, sampleCanvas.height);
  samples.forEach((sample, index) => {
    const flow = Math.hypot(sample.flowX, sample.flowY);
    const presentationLayer = 0.2 + Math.min(0.32, sample.trackSupport * 0.12 + sample.salience * 0.6 + flow * 2);
    positions.set([
      sample.normalizedX * aspect * 0.92 + sample.flowX * 3.2,
      sample.normalizedY * 0.92 + sample.flowY * 3.2,
      presentationLayer,
    ], index * 3);
    const certainty = 0.32 + sample.trackSupport * 0.68;
    colors.set([sample.r * certainty, sample.g * certainty, sample.b * certainty], index * 3);
  });
  formingGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  formingGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  formingGeometry.computeBoundingSphere();
  formingGroup.visible = samples.length > 0;
}

function packedSurfels(surfels: KeyxymSurfel[]): number[] {
  const output = new Array<number>(surfels.length * 13);
  surfels.forEach((surfel, index) => {
    const offset = index * 13;
    output.splice(offset, 13,
      surfel.x, surfel.y, surfel.z,
      surfel.nx, surfel.ny, surfel.nz,
      surfel.r, surfel.g, surfel.b,
      surfel.confidence, surfel.uncertainty,
      surfel.observations, surfel.sourceKeyframe,
    );
  });
  return output;
}

function updateConfirmed(packed: number[]): void {
  const count = Math.floor(packed.length / 13);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const source = index * 13;
    const target = index * 3;
    positions[target] = packed[source]!;
    positions[target + 1] = -packed[source + 1]!;
    positions[target + 2] = -packed[source + 2]!;
    const confidence = Math.max(0.2, Math.min(1, packed[source + 9]!));
    colors[target] = packed[source + 6]! * confidence;
    colors[target + 1] = packed[source + 7]! * confidence;
    colors[target + 2] = packed[source + 8]! * confidence;
  }
  confirmedGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  confirmedGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  confirmedGeometry.computeBoundingBox();
  confirmedGeometry.computeBoundingSphere();
  const sphere = confirmedGeometry.boundingSphere;
  if (sphere && sphere.radius > 0) {
    confirmedCloud.position.copy(sphere.center).multiplyScalar(-1);
    const scale = Math.min(1.4, 1.15 / sphere.radius);
    worldGroup.scale.setScalar(scale);
  }
  confirmedCloud.visible = count > 0;
  text("surfel-count", count.toLocaleString());
}

function updateTrajectory(): void {
  const points = trajectory.map((pose) => new THREE.Vector3(pose[3] ?? 0, -(pose[7] ?? 0), -(pose[11] ?? 0)));
  trajectoryGeometry.setFromPoints(points);
}

function momentReady(): boolean {
  return !!latestPose?.recovered && latestPose.inliers >= 10 && latestPose.tracking >= MIN_MOMENT_TRACKING && latestGeometry.length > 0;
}

function geometrySealable(): boolean {
  return metricScale && !!latestPose?.recovered && !!latestQuality &&
    latestQuality.tracking >= MIN_SEAL_TRACKING &&
    latestQuality.parallaxDegrees >= MIN_SEAL_PARALLAX &&
    Number.isFinite(latestQuality.reprojectionErrorPixels) &&
    latestQuality.reprojectionErrorPixels <= MAX_SEAL_REPROJECTION &&
    latestQuality.confirmed >= MIN_SEAL_CONFIRMED &&
    latestGeometry.some((surfel) => surfel.observations >= 2) &&
    moments.length > 0;
}

function updateInterface(): void {
  const quality = latestQuality;
  text("frame-count", frameNumber.toLocaleString());
  text("backend-name", core && frontend ? "KEYXYM DUAL-FIELD WASM" : "KEYXYM LOADING");
  text("compute-state", core && frontend ? "WASM" : "PROBING");
  text("gpu-badge", "WEBGL2 ACTIVE");
  text("adapter-name", frontend?.sourceCommit.slice(0, 12).toUpperCase() ?? "VERIFYING");
  if (!quality) {
    text("pose-state", core && frontend ? "KEYXYM READY" : "AUTHORITY LOADING");
    text("cell-state", latestForming.length ? "FORMING FIELD / NON-METRIC" : "WORLD CELL / EMPTY");
    disabled("capture-button", true);
    disabled("seal-button", true);
    return;
  }
  text("tracking-value", `${Math.round(quality.tracking * 100)}%`);
  text("parallax-value", `${quality.parallaxDegrees.toFixed(2)}°`);
  text("error-value", Number.isFinite(quality.reprojectionErrorPixels) ? `${quality.reprojectionErrorPixels.toFixed(2)} px` : "—");
  text("coverage-value", `${Math.round(quality.coverage * 100)}%`);
  text("confirmed-value", Math.round(quality.confirmed).toLocaleString());
  text("uncertain-value", Math.round(quality.uncertain).toLocaleString());
  text("rejected-value", Math.round(quality.rejected).toLocaleString());
  q("quality-meter").style.width = `${Math.round(Math.min(1, quality.tracking) * 100)}%`;
  text("scale-value", metricScale ? "METRIC / CALIBRATED" : "RELATIVE / FORMING");
  text("pose-state", latestPose?.recovered ? "KEYXYM POSE SOLVED" : "BUILD PARALLAX");
  disabled("capture-button", !momentReady());
  disabled("seal-button", !geometrySealable());
  if (sealedCell) text("cell-state", `WORLD CELL / ASSURED / ${moments.length} MOMENTS`);
  else if (moments.length) text("cell-state", `WORLD CELL / ${moments.length} MOMENTS / UNSEALED`);
  else text("cell-state", latestPose?.recovered ? "AUTHORITATIVE GEOMETRY / UNSEALED" : "FORMING FIELD / NON-METRIC");
}

function sampleFrame(): { rgba: Uint8ClampedArray; rgb: Float32Array; width: number; height: number; commitment: Uint8Array } {
  const ratio = video.videoWidth > 0 ? video.videoHeight / video.videoWidth : 0.75;
  const height = Math.max(90, Math.min(240, Math.round(ANALYSIS_WIDTH * ratio)));
  sampleCanvas.width = ANALYSIS_WIDTH;
  sampleCanvas.height = height;
  sampleContext.drawImage(video, 0, 0, ANALYSIS_WIDTH, height);
  const image = sampleContext.getImageData(0, 0, ANALYSIS_WIDTH, height);
  const rgb = new Float32Array(ANALYSIS_WIDTH * height * 3);
  for (let index = 0; index < ANALYSIS_WIDTH * height; index += 1) {
    const source = index * 4;
    const target = index * 3;
    rgb[target] = image.data[source]! / 255;
    rgb[target + 1] = image.data[source + 1]! / 255;
    rgb[target + 2] = image.data[source + 2]! / 255;
  }
  const bytes = new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength);
  return { rgba: image.data, rgb, width: ANALYSIS_WIDTH, height, commitment: sha256(bytes) };
}

async function processFrame(): Promise<void> {
  if (!running || processing || !core || !frontend || video.readyState < 2) return;
  processing = true;
  const started = performance.now();
  try {
    const frame = sampleFrame();
    const perception = frontend.ingest(frame.rgba, frame.width, frame.height);
    latestForming = perception.forming;
    updateForming(latestForming);
    const focal = frame.width * 0.82;
    latestPose = core.ingest({
      timestampNs: BigInt(Math.round(performance.timeOrigin * 1_000_000 + performance.now() * 1_000_000)),
      width: frame.width,
      height: frame.height,
      fx: focal,
      fy: focal,
      cx: frame.width / 2,
      cy: frame.height / 2,
      scaleMetersPerUnit,
      metricScale,
      rgb: frame.rgb,
      features: perception.features,
      sourceCommitment: frame.commitment,
    });
    latestQuality = core.quality();
    if (latestPose.recovered && latestPose.tracking >= 0.2) {
      latestGeometry = core.geometry();
      latestGeometryPacked = packedSurfels(latestGeometry);
      updateConfirmed(latestGeometryPacked);
      trajectory.push(Array.from(latestPose.worldFromCamera));
      if (trajectory.length > 300) trajectory.shift();
      updateTrajectory();
    }
    sourceCommitments.push(hex(frame.commitment));
    if (sourceCommitments.length > 128) sourceCommitments.shift();
    sourceSetCommitment = digest({ domain: "keyxym/source-set/v1", sources: sourceCommitments });
    calibrationCommitment = digest({
      domain: "keyxym/calibration/v1",
      width: frame.width,
      height: frame.height,
      fx: focal,
      fy: focal,
      cx: frame.width / 2,
      cy: frame.height / 2,
      scaleMetersPerUnit,
      metricScale,
    });
    frameNumber += 1;
    text("dispatch-time", `${(performance.now() - started).toFixed(1)} ms`);
    q("compute-meter").style.width = `${Math.min(100, 20 + latestForming.length / 100)}%`;
    if (frameNumber % 12 === 0) {
      recordEvidence("keyxym-frame", latestPose.recovered ? "tracked" : "forming", {
        sequence: perception.sequence.toString(),
        sourceCommitment: hex(frame.commitment),
        features: perception.features.length,
        forming: perception.forming.length,
        authoritativeSurfels: latestGeometry.length,
        tracking: latestPose.tracking,
      });
    }
    updateInterface();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    text("pose-state", "KEYXYM REJECTED");
    text("cell-state", "FORMING FIELD / AUTHORITY REJECTED");
    recordEvidence("keyxym-error", "rejected", { reason });
  } finally {
    processing = false;
  }
}

function scheduleCapture(): void {
  if (!running) return;
  const callback = (): void => {
    void processFrame().finally(scheduleCapture);
  };
  const videoWithCallback = video as HTMLVideoElement & {
    requestVideoFrameCallback?: (callback: () => void) => number;
  };
  if (videoWithCallback.requestVideoFrameCallback) videoWithCallback.requestVideoFrameCallback(callback);
  else window.setTimeout(callback, 90);
}

async function initializeAuthority(): Promise<void> {
  coreManifest = await verifyKeyxymV22Bundle();
  document.documentElement.dataset.keyxymAuthority = "verified";
  document.documentElement.dataset.keyxymCommit = coreManifest.source_commit;
  document.documentElement.dataset.keyxymTimestampAbi = coreManifest.timestamp_abi;
  frontend = await KeyxymFrontendRuntime.load();
  core = await KeyxymV22Runtime.load();
  runtimeCommitment = digest({
    domain: "tessaryn/keyxym-runtime-set/v1",
    core: coreManifest,
    frontendCommit: frontend.sourceCommit,
    frontendDigest: "b630de5c05cd22a63bd5fd23ab1615f73ec45aadd46bab8eabc53458613d68f7",
  });
  text("backend-name", "KEYXYM DUAL-FIELD / VERIFIED");
  text("pose-state", "KEYXYM READY");
  updateInterface();
}

async function resetAuthority(preserveCalibration = true): Promise<void> {
  core?.destroy();
  core = null;
  frontend?.reset();
  latestPose = null;
  latestQuality = null;
  latestGeometry = [];
  latestGeometryPacked = [];
  latestForming = [];
  trajectory = [];
  sourceCommitments = [];
  sourceSetCommitment = ZERO_DIGEST;
  moments = [];
  currentMoment = -1;
  assuranceEvidence = null;
  assuranceBody = null;
  verifiedAssurance = null;
  sealedCell = null;
  frameNumber = 0;
  if (!preserveCalibration) {
    metricScale = false;
    scaleMetersPerUnit = 1;
    calibrationCommitment = ZERO_DIGEST;
  }
  updateForming([]);
  updateConfirmed([]);
  updateTrajectory();
  updateTimeline();
  core = await KeyxymV22Runtime.load();
  updateInterface();
}

async function startCamera(): Promise<void> {
  if (!core || !frontend) await initializeAuthority();
  stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  running = true;
  disabled("start-button", true);
  disabled("stop-button", false);
  text("capture-state", "CAPTURING");
  q("stage-message").style.display = "none";
  recordEvidence("camera-open", "accepted", {
    tracks: stream.getVideoTracks().map((track) => track.getSettings()),
  });
  scheduleCapture();
}

function stopCamera(): void {
  running = false;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  video.srcObject = null;
  disabled("start-button", false);
  disabled("stop-button", true);
  disabled("capture-button", true);
  text("capture-state", "READY");
}

function authorityReceipt(
  geometryCommitment: string,
  parentCommitment: string,
  sequence: number,
): string {
  if (!latestPose || !latestQuality) throw new Error("No authoritative Keyxym state");
  return digest({
    domain: "keyxym/v22/browser-authority-receipt/v1",
    geometryCommitment,
    pose: Array.from(latestPose.worldFromCamera),
    quality: latestQuality,
    sourceSetCommitment,
    calibrationCommitment,
    runtimeCommitment,
    parentCommitment,
    sequence,
  });
}

function commitMoment(): void {
  if (!momentReady() || !latestPose || !latestQuality) {
    text("cell-state", "REJECTED / BUILD AUTHORITATIVE GEOMETRY");
    return;
  }
  const parentCommitment = moments.at(-1)?.authorityReceipt ?? ZERO_DIGEST;
  const sequence = moments.length + 1;
  const geometry = latestGeometryPacked.slice();
  const geometryCommitment = digest({ domain: "keyxym/v22/geometry-snapshot/v1", geometry });
  const receipt = authorityReceipt(geometryCommitment, parentCommitment, sequence);
  const moment: PackedMoment = {
    version: 22,
    id: receipt,
    sequence,
    createdNs: (BigInt(Date.now()) * 1_000_000n).toString(),
    parentCommitment,
    authorityReceipt: receipt,
    geometryCommitment,
    sourceSetCommitment,
    calibrationCommitment,
    runtimeCommitment,
    metricScale,
    pose: Array.from(latestPose.worldFromCamera),
    quality: { ...latestQuality },
    geometry,
  };
  moments.push(moment);
  if (moments.length > MAX_MOMENTS) moments.shift();
  currentMoment = moments.length - 1;
  assuranceEvidence = null;
  assuranceBody = null;
  verifiedAssurance = null;
  sealedCell = null;
  updateTimeline();
  updateInterface();
  recordEvidence("moment", "committed", {
    id: moment.id,
    sequence: moment.sequence,
    surfels: geometry.length / 13,
    metricScale: moment.metricScale,
  });
}

function updateTimeline(): void {
  const timelineElement = q("timeline");
  timelineElement.innerHTML = "";
  if (!moments.length) {
    timelineElement.innerHTML = '<span class="empty">No authoritative Moments committed.</span>';
    disabled("prev-button", true);
    disabled("next-button", true);
    disabled("play-button", true);
    return;
  }
  moments.forEach((moment, index) => {
    const button = document.createElement("button");
    button.className = index === currentMoment ? "active" : "";
    button.innerHTML = `<small>MOMENT ${String(moment.sequence).padStart(2, "0")}</small><b>${(moment.geometry.length / 13).toLocaleString()} AUTH SURFELS</b>`;
    button.onclick = () => showMoment(index);
    timelineElement.appendChild(button);
  });
  const slider = q<HTMLInputElement>("replay-slider");
  slider.max = String(moments.length - 1);
  slider.value = String(Math.max(0, currentMoment));
  disabled("prev-button", false);
  disabled("next-button", false);
  disabled("play-button", false);
}

function showMoment(index: number): void {
  if (!moments.length) return;
  currentMoment = Math.max(0, Math.min(index, moments.length - 1));
  const moment = moments[currentMoment]!;
  updateConfirmed(moment.geometry);
  updateTimeline();
  text("cell-state", `WORLD CELL / MOMENT ${moment.sequence} / ${moment.metricScale ? "METRIC" : "RELATIVE"}`);
}

function cellBody(): WorldCellBody {
  return {
    version: 22,
    branch: "main",
    createdNs: (BigInt(Date.now()) * 1_000_000n).toString(),
    runtimeCommitment,
    calibrationCommitment,
    sourceSetCommitment,
    moments,
  };
}

function buildAssuranceEvidence(): WorldCellEvidenceRecord {
  if (!geometrySealable()) throw new Error("World Cell geometry is not sealable");
  const body = assuranceBody ?? cellBody();
  assuranceBody = body;
  const canonicalDigest = digest(body);
  const lastMoment = moments.at(-1);
  if (!lastMoment) throw new Error("World Cell has no Moment lineage");
  const rootprintCommitment = digest({
    domain: "tessaryn/power-house-rootprint-input/v1",
    canonicalDigest,
    momentLineage: moments.map((moment) => moment.authorityReceipt),
  });
  return {
    artifactKind: "world-cell",
    canonicalDigest,
    reconstructionReceipt: lastMoment.authorityReceipt,
    runtimeCommitment,
    calibrationCommitment,
    sourceSetCommitment,
    parentCommitment: lastMoment.authorityReceipt,
    rootprintCommitment,
    sequence: BigInt(moments.length + 1),
    timestampNs: BigInt(body.createdNs),
    metricScale: true,
    sealed: true,
  };
}

function createAssuranceRequest(): void {
  try {
    stopCamera();
    assuranceBody = cellBody();
    assuranceEvidence = buildAssuranceEvidence();
    const request = assuranceRequest(assuranceEvidence);
    q<HTMLTextAreaElement>("assurance-input").value = request;
    text("assurance-status", "EFORM SIGNATURE REQUIRED / paste canonical assurance record after signing.");
    recordEvidence("eform-request", "pending", {
      envelope: JSON.parse(request) as Record<string, unknown>,
      command: "eform sign-world-cell <key> <request fields>",
    });
  } catch (error) {
    text("assurance-status", error instanceof Error ? error.message : String(error));
  }
}

async function applyAssurance(): Promise<void> {
  if (!assuranceEvidence) assuranceEvidence = buildAssuranceEvidence();
  const record = q<HTMLTextAreaElement>("assurance-input").value.trim();
  verifiedAssurance = await verifyWorldCellAssurance(record, assuranceEvidence);
  const body = assuranceBody;
  if (!body) throw new Error("World Cell assurance body is missing");
  const canonicalDigest = digest(body);
  if (canonicalDigest !== assuranceEvidence.canonicalDigest) {
    throw new Error("World Cell changed after assurance was requested");
  }
  sealedCell = {
    schema: "tessaryn.metric-world-cell/v22",
    id: digest({
      canonicalDigest,
      rootprintCommitment: assuranceEvidence.rootprintCommitment,
      assuranceEnvelope: verifiedAssurance.envelopeDigest,
    }),
    body,
    canonicalDigest,
    rootprintCommitment: assuranceEvidence.rootprintCommitment,
    assuranceRecord: verifiedAssurance.canonicalRecord,
    assuranceEnvelope: verifiedAssurance.envelopeDigest,
  };
  text("rootprint", sealedCell.rootprintCommitment.slice(0, 16).toUpperCase());
  text("assurance-status", "EFORM / POWER HOUSE ED25519 VERIFIED");
  disabled("send-button", !channel || channel.readyState !== "open");
  updateInterface();
  recordEvidence("eform-assurance", "verified", {
    envelope: verifiedAssurance.envelopeDigest,
    publicKey: verifiedAssurance.publicKeyBase64,
    worldCell: sealedCell.id,
  });
}

function beginCalibration(): void {
  const known = Number(q<HTMLInputElement>("scale-input").value);
  if (!Number.isFinite(known) || known < 0.01 || known > 20 || latestGeometry.length < 2) {
    text("sensor-detail", "Build authoritative geometry first, then enter a known reference length between 0.01 and 20 meters.");
    return;
  }
  calibrationKnownMeters = known;
  calibrationPicks = [];
  q<HTMLDialogElement>("calibration-dialog").close();
  text("cell-state", "CALIBRATION / TAP FIRST CONFIRMED POINT");
}

function pickCalibrationPoint(event: PointerEvent): void {
  if (calibrationKnownMeters === null || latestGeometry.length < 2) return;
  const bounds = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
  pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
  raycaster.setFromCamera(pointer, stageCamera);
  const intersection = raycaster.intersectObject(confirmedCloud, false)[0];
  if (intersection?.index === undefined) {
    text("cell-state", "CALIBRATION / TAP A CONFIRMED SURFEL");
    return;
  }
  calibrationPicks.push(intersection.index);
  if (calibrationPicks.length === 1) {
    text("cell-state", "CALIBRATION / TAP SECOND CONFIRMED POINT");
    return;
  }
  const first = latestGeometry[calibrationPicks[0]!];
  const second = latestGeometry[calibrationPicks[1]!];
  if (!first || !second) throw new Error("Calibration surfel selection is invalid");
  const relativeDistance = Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z);
  if (!Number.isFinite(relativeDistance) || relativeDistance <= 0.0001) {
    calibrationPicks = [];
    text("cell-state", "CALIBRATION / POINTS TOO CLOSE / RETRY");
    return;
  }
  scaleMetersPerUnit = calibrationKnownMeters / relativeDistance;
  metricScale = true;
  calibrationCommitment = digest({
    domain: "keyxym/user-reference-calibration/v1",
    knownMeters: calibrationKnownMeters,
    relativeDistance,
    scaleMetersPerUnit,
    geometryCommitment: digest(latestGeometryPacked),
  });
  calibrationKnownMeters = null;
  calibrationPicks = [];
  text("sensor-detail", `Metric calibration accepted at ${scaleMetersPerUnit.toPrecision(5)} meters per reconstructed unit. Authority is restarting.`);
  void resetAuthority(true).then(() => text("cell-state", "METRIC CALIBRATION / RECONSTRUCT AGAIN"));
}

function setupPeer(): RTCPeerConnection {
  peer?.close();
  peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  peer.onconnectionstatechange = () => text("peer-state", peer?.connectionState.toUpperCase() ?? "CLOSED");
  peer.ondatachannel = (event) => attachChannel(event.channel);
  return peer;
}

function attachChannel(value: RTCDataChannel): void {
  channel = value;
  channel.binaryType = "arraybuffer";
  channel.onopen = () => {
    text("channel-state", "OPEN");
    disabled("send-button", !sealedCell);
  };
  channel.onclose = () => {
    text("channel-state", "CLOSED");
    disabled("send-button", true);
  };
  channel.onmessage = onPeerMessage;
}

const waitIce = (connection: RTCPeerConnection): Promise<void> => new Promise((resolve) => {
  if (connection.iceGatheringState === "complete") return resolve();
  connection.onicegatheringstatechange = () => {
    if (connection.iceGatheringState === "complete") resolve();
  };
});

async function createOffer(): Promise<void> {
  const connection = setupPeer();
  attachChannel(connection.createDataChannel("tessaryn-world-cell-v22", { ordered: true }));
  await connection.setLocalDescription(await connection.createOffer());
  await waitIce(connection);
  q<HTMLTextAreaElement>("pairing-text").value = JSON.stringify(connection.localDescription);
  text("transfer-state", "Offer created. Copy it to the joining device.");
}

async function joinOffer(): Promise<void> {
  const raw = q<HTMLTextAreaElement>("pairing-text").value.trim();
  if (!raw) throw new Error("Paste an offer first");
  const connection = setupPeer();
  await connection.setRemoteDescription(JSON.parse(raw) as RTCSessionDescriptionInit);
  await connection.setLocalDescription(await connection.createAnswer());
  await waitIce(connection);
  q<HTMLTextAreaElement>("pairing-text").value = JSON.stringify(connection.localDescription);
  text("transfer-state", "Answer created. Copy it back to the offering device.");
}

async function applyAnswer(): Promise<void> {
  if (!peer) throw new Error("Create an offer first");
  await peer.setRemoteDescription(JSON.parse(q<HTMLTextAreaElement>("pairing-text").value) as RTCSessionDescriptionInit);
  text("transfer-state", "Answer applied. Waiting for encrypted data channel.");
}

async function sendCell(): Promise<void> {
  if (!sealedCell || !channel || channel.readyState !== "open") return;
  const bytes = encoder.encode(canonical(sealedCell));
  const fullDigest = hex(sha256(bytes));
  const chunkSize = 32 * 1024;
  const chunks = Math.ceil(bytes.length / chunkSize);
  channel.send(JSON.stringify({ type: "manifest", digest: fullDigest, bytes: bytes.length, chunks }));
  for (let index = 0; index < chunks; index += 1) {
    channel.send(bytes.slice(index * chunkSize, (index + 1) * chunkSize));
    q("transfer-meter").style.width = `${Math.round((index + 1) / chunks * 100)}%`;
    await new Promise((resolve) => setTimeout(resolve, 4));
  }
  channel.send(JSON.stringify({ type: "complete" }));
  text("transfer-state", `Sent ${bytes.length.toLocaleString()} assured bytes.`);
  recordEvidence("webrtc-send", "verified", { bytes: bytes.length, digest: fullDigest, cell: sealedCell.id });
}

function onPeerMessage(event: MessageEvent): void {
  if (typeof event.data === "string") {
    const message = JSON.parse(event.data) as { type: string; digest?: string; bytes?: number };
    if (message.type === "manifest") {
      pendingChunks = [];
      expectedDigest = message.digest ?? "";
      expectedBytes = message.bytes ?? 0;
      text("transfer-state", `Receiving ${expectedBytes.toLocaleString()} bytes…`);
    } else if (message.type === "complete") {
      void finalizeReceive();
    }
    return;
  }
  pendingChunks.push(new Uint8Array(event.data as ArrayBuffer));
  const received = pendingChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  q("transfer-meter").style.width = `${Math.min(100, Math.round(received / Math.max(1, expectedBytes) * 100))}%`;
}

async function finalizeReceive(): Promise<void> {
  const bytes = new Uint8Array(expectedBytes);
  let offset = 0;
  for (const chunk of pendingChunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if (offset !== expectedBytes || hex(sha256(bytes)) !== expectedDigest) {
    text("transfer-state", "REJECTED / transport digest mismatch");
    return;
  }
  const received = JSON.parse(new TextDecoder().decode(bytes)) as SealedWorldCell;
  if (received.schema !== "tessaryn.metric-world-cell/v22") throw new Error("Unsupported World Cell schema");
  const canonicalDigest = digest(received.body);
  if (canonicalDigest !== received.canonicalDigest) throw new Error("World Cell canonical digest mismatch");
  const lastMoment = received.body.moments.at(-1);
  if (!lastMoment) throw new Error("World Cell has no Moment lineage");
  const expectedEvidence: WorldCellEvidenceRecord = {
    artifactKind: "world-cell",
    canonicalDigest,
    reconstructionReceipt: lastMoment.authorityReceipt,
    runtimeCommitment: received.body.runtimeCommitment,
    calibrationCommitment: received.body.calibrationCommitment,
    sourceSetCommitment: received.body.sourceSetCommitment,
    parentCommitment: lastMoment.authorityReceipt,
    rootprintCommitment: received.rootprintCommitment,
    sequence: BigInt(received.body.moments.length + 1),
    timestampNs: BigInt(received.body.createdNs),
    metricScale: true,
    sealed: true,
  };
  const assurance = await verifyWorldCellAssurance(received.assuranceRecord, expectedEvidence);
  const identity = digest({
    canonicalDigest,
    rootprintCommitment: received.rootprintCommitment,
    assuranceEnvelope: assurance.envelopeDigest,
  });
  if (identity !== received.id) throw new Error("World Cell assured identity mismatch");
  sealedCell = received;
  verifiedAssurance = assurance;
  moments = received.body.moments;
  currentMoment = moments.length - 1;
  runtimeCommitment = received.body.runtimeCommitment;
  calibrationCommitment = received.body.calibrationCommitment;
  sourceSetCommitment = received.body.sourceSetCommitment;
  metricScale = true;
  updateTimeline();
  showMoment(currentMoment);
  text("rootprint", received.rootprintCommitment.slice(0, 16).toUpperCase());
  text("transfer-state", `VERIFIED / eform assured World Cell reconstructed from ${bytes.length.toLocaleString()} bytes.`);
  recordEvidence("webrtc-receive", "verified", { bytes: bytes.length, digest: expectedDigest, cell: received.id });
  updateInterface();
}

async function connectSerial(): Promise<void> {
  const navigatorWithSerial = navigator as Navigator & { serial?: { requestPort(): Promise<{ open(options: { baudRate: number }): Promise<void> }> } };
  if (!navigatorWithSerial.serial) throw new Error("WebSerial unavailable");
  const port = await navigatorWithSerial.serial.requestPort();
  await port.open({ baudRate: 115200 });
  text("sensor-badge", "EVENT SENSOR");
  q("sensor-log").textContent = "Event sensor transport connected. Metric authority remains camera-based until calibrated sensor samples are admitted by Keyxym.";
  recordEvidence("sensor-connect", "transport-only", { transport: "WebSerial" });
}

async function connectUsb(): Promise<void> {
  const navigatorWithUsb = navigator as Navigator & {
    usb?: { requestDevice(options: { filters: Array<Record<string, number>> }): Promise<{ open(): Promise<void>; productName?: string; vendorId: number; productId: number }> };
  };
  if (!navigatorWithUsb.usb) throw new Error("WebUSB unavailable");
  const device = await navigatorWithUsb.usb.requestDevice({ filters: [] });
  await device.open();
  text("sensor-badge", "USB SENSOR");
  q("sensor-log").textContent = `Connected ${device.productName ?? "USB spatial sensor"}. Samples remain untrusted until admitted by a Keyxym sensor adapter.`;
  recordEvidence("sensor-connect", "transport-only", { vendorId: device.vendorId, productId: device.productId });
}

async function probeXr(): Promise<void> {
  const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
  if (!xr || !await xr.isSessionSupported("immersive-ar")) {
    q("sensor-log").textContent = "WebXR immersive AR/depth is not exposed by this browser.";
    return;
  }
  q("sensor-log").textContent = "WebXR immersive AR is available. Depth becomes metric evidence only after Keyxym admits calibrated depth samples.";
  text("sensor-badge", "WEBXR READY");
  recordEvidence("sensor-probe", "available", { immersiveAR: true });
}

function reportError(error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  text("cell-state", `REJECTED / ${reason}`);
  recordEvidence("interface-error", "rejected", { reason });
}

q("start-button").onclick = () => void startCamera().catch(reportError);
q("stop-button").onclick = stopCamera;
q("capture-button").onclick = commitMoment;
q("seal-button").onclick = createAssuranceRequest;
q("calibrate-button").onclick = () => q<HTMLDialogElement>("calibration-dialog").showModal();
q("apply-calibration").onclick = beginCalibration;
canvas.addEventListener("pointerdown", pickCalibrationPoint);
q<HTMLInputElement>("replay-slider").oninput = (event) => showMoment(Number((event.target as HTMLInputElement).value));
q("prev-button").onclick = () => showMoment(currentMoment - 1);
q("next-button").onclick = () => showMoment(currentMoment + 1);
q("play-button").onclick = () => {
  if (playTimer) {
    clearInterval(playTimer);
    playTimer = 0;
    text("play-button", "PLAY");
    return;
  }
  if (!moments.length) return;
  text("play-button", "STOP");
  playTimer = window.setInterval(() => showMoment((currentMoment + 1) % moments.length), 900);
};
q("host-button").onclick = () => void createOffer().catch(reportError);
q("join-button").onclick = () => void joinOffer().catch(reportError);
q("answer-button").onclick = () => void applyAnswer().catch(reportError);
q("send-button").onclick = () => void sendCell().catch(reportError);
q("sensor-button").onclick = () => q<HTMLDialogElement>("sensor-dialog").showModal();
q("evidence-button").onclick = () => q<HTMLDialogElement>("evidence-dialog").showModal();
q("request-assurance").onclick = createAssuranceRequest;
q("apply-assurance").onclick = () => void applyAssurance().catch((error) => {
  text("assurance-status", error instanceof Error ? error.message : String(error));
  reportError(error);
});
document.querySelectorAll<HTMLElement>("[data-close]").forEach((button) => {
  button.onclick = () => q<HTMLDialogElement>(button.dataset.close ?? "").close();
});
q("serial-button").onclick = () => void connectSerial().catch((error) => { q("sensor-log").textContent = String(error); });
q("usb-button").onclick = () => void connectUsb().catch((error) => { q("sensor-log").textContent = String(error); });
q("xr-button").onclick = () => void probeXr().catch(reportError);
q("reset-button").onclick = () => {
  stopCamera();
  void resetAuthority(false).catch(reportError);
  text("rootprint", "UNSEALED");
  text("cell-state", "WORLD CELL / EMPTY");
};
window.addEventListener("beforeunload", () => {
  stopCamera();
  core?.destroy();
  peer?.close();
});
navigator.serviceWorker?.register("./sw.js").catch(() => undefined);
updateTimeline();
disabled("capture-button", true);
disabled("seal-button", true);
disabled("send-button", true);
void initializeAuthority().catch((error) => {
  document.documentElement.dataset.keyxymAuthority = "rejected";
  text("backend-name", "AUTHORITY REJECTED");
  text("pose-state", "KEYXYM OFFLINE");
  reportError(error);
});
