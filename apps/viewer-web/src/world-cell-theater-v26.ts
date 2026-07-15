import "./world-cell-theater.css";
import * as THREE from "three";
import type { KeyxymV26Manifest } from "./keyxym-v26-provenance";
import {
  KEYXYM_V26_SURFEL_FLOATS,
  KeyxymV26TheaterRuntime,
  type KeyxymAuthorityDecision,
  type KeyxymFormingSample,
  type KeyxymGeometrySnapshot,
  type KeyxymPoseEstimate,
  type KeyxymQuality,
  type KeyxymReceipts,
  type KeyxymSurfel,
} from "./keyxym-v26-theater-adapter";
import {
  bytesHex,
  canonicalString,
  digestBytes,
  digestValue,
  evidenceRequest,
  nativeAssuranceBridge,
  reconstructionReceipt,
  runtimeCommitment,
  validateNativeSeal,
  type NativeWorldCellSeal,
  type WorldCellEvidenceRequest,
} from "./world-cell-assurance";

interface RuntimeEvidence {
  time: number;
  kind: "keyxym-v026-frame";
  sourceCommitment: string;
  poseReceipt: string;
  qualityReceipt: string;
  authorityReceipt: string;
  reconstructionReceipt: string;
  runtimeCommitment: string;
  geometryRevision: string;
  details: Record<string, unknown>;
}

interface MomentRecord {
  schema: "tessaryn/world-cell-moment/v26";
  id: string;
  sequence: number;
  createdAtUnixMs: number;
  geometryRevision: string;
  geometryRecordFloats: 13;
  geometry: number[];
  pose: number[];
  quality: KeyxymQuality;
  authority: KeyxymAuthorityDecision;
  sourceCommitment: string;
  poseReceipt: string;
  qualityReceipt: string;
  authorityReceipt: string;
  reconstructionReceipt: string;
  runtimeCommitment: string;
  parentCommitment: string;
  metricScale: boolean;
  canonicalDigest: string;
}

interface WorldCellDraft {
  schema: "tessaryn/world-cell/v26";
  version: 26;
  branch: "main/world-cell-theater-v026";
  createdAtUnixMs: number;
  runtimeCommitment: string;
  scaleState: "relative" | "metric";
  moments: MomentRecord[];
  evidence: RuntimeEvidence[];
}

interface SealedWorldCell extends WorldCellDraft {
  canonicalDigest: string;
  assuranceEvidence: WorldCellEvidenceRequest;
  seal: NativeWorldCellSeal;
}

interface MetricSensorCalibration {
  verified: boolean;
  scaleMetersPerUnit: number;
  device: string;
  receipt: string;
}

declare global {
  interface Window {
    tessarynMetricSensor?: {
      currentCalibration(): Promise<MetricSensorCalibration>;
    };
  }
}

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: (now: number) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

const ZERO_DIGEST = "0".repeat(64);
const MAX_MOMENTS = 24;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`World Cell Theater element is missing: ${id}`);
  return found as T;
}

function setText(id: string, value: string): void { element(id).textContent = value; }
function setWidth(id: string, value: number): void {
  element(id).style.width = `${Math.max(0, Math.min(100, value))}%`;
}
function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
function nonzeroDigest(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value) && value !== ZERO_DIGEST;
}
function nonzeroBytes(value: Uint8Array): boolean {
  return value.byteLength === 32 && value.some((item) => item !== 0);
}

function createPointMaterial(additive: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: `
      attribute vec3 color;
      attribute float aAlpha;
      attribute float aSize;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vColor = color;
        vAlpha = aAlpha;
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        gl_PointSize = clamp(aSize * (280.0 / max(0.35, -viewPosition.z)), 1.25, 26.0);
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float radius = length(gl_PointCoord - vec2(0.5));
        if (radius > 0.5) discard;
        float core = smoothstep(0.5, 0.06, radius);
        float glow = smoothstep(0.5, 0.0, radius) * 0.48;
        gl_FragColor = vec4(vColor * (0.70 + glow), vAlpha * core);
      }
    `,
  });
}

function setPointGeometry(
  geometry: THREE.BufferGeometry,
  positions: Float32Array,
  colors: Float32Array,
  alpha: Float32Array,
  size: Float32Array,
): void {
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  geometry.computeBoundingSphere();
}

function packedSurfels(surfels: KeyxymSurfel[]): number[] {
  const output = new Array<number>(surfels.length * KEYXYM_V26_SURFEL_FLOATS);
  let offset = 0;
  for (const surfel of surfels) {
    output[offset++] = surfel.x; output[offset++] = surfel.y; output[offset++] = surfel.z;
    output[offset++] = surfel.nx; output[offset++] = surfel.ny; output[offset++] = surfel.nz;
    output[offset++] = surfel.r; output[offset++] = surfel.g; output[offset++] = surfel.b;
    output[offset++] = surfel.confidence; output[offset++] = surfel.uncertainty;
    output[offset++] = surfel.observations; output[offset++] = surfel.sourceKeyframe;
  }
  return output;
}

function unpackSurfels(values: number[]): KeyxymSurfel[] {
  if (values.length % KEYXYM_V26_SURFEL_FLOATS !== 0) throw new Error("Moment geometry is malformed");
  const output: KeyxymSurfel[] = [];
  for (let index = 0; index < values.length; index += KEYXYM_V26_SURFEL_FLOATS) {
    const item = values.slice(index, index + KEYXYM_V26_SURFEL_FLOATS);
    if (!item.every(Number.isFinite)) throw new Error("Moment geometry is non-finite");
    output.push({
      x: item[0]!, y: item[1]!, z: item[2]!, nx: item[3]!, ny: item[4]!, nz: item[5]!,
      r: item[6]!, g: item[7]!, b: item[8]!, confidence: item[9]!, uncertainty: item[10]!,
      observations: item[11]!, sourceKeyframe: item[12]!,
    });
  }
  return output;
}

function confirmedGeometry(surfels: KeyxymSurfel[]): KeyxymSurfel[] {
  return surfels.filter((surfel) =>
    surfel.observations >= 2 && surfel.confidence >= 0.55 && surfel.uncertainty <= 0.25);
}

function momentBody(moment: MomentRecord): Omit<MomentRecord, "canonicalDigest"> {
  const { canonicalDigest: _canonicalDigest, ...body } = moment;
  return body;
}

function validateMoment(moment: MomentRecord, expectedParent: string): void {
  if (moment.schema !== "tessaryn/world-cell-moment/v26" ||
      moment.geometryRecordFloats !== KEYXYM_V26_SURFEL_FLOATS ||
      moment.parentCommitment !== expectedParent || !moment.authority.momentAllowed ||
      !nonzeroDigest(moment.runtimeCommitment) || !nonzeroDigest(moment.authorityReceipt) ||
      !nonzeroDigest(moment.reconstructionReceipt) ||
      digestValue(momentBody(moment)) !== moment.canonicalDigest) {
    throw new Error(`Moment ${moment.id} failed v0.26 authority and lineage verification`);
  }
  const geometry = unpackSurfels(moment.geometry);
  if (geometry.length !== Math.round(moment.authority.confirmedSurfels)) {
    throw new Error(`Moment ${moment.id} geometry does not match its native authority decision`);
  }
}

class TheaterController {
  private readonly video = element<VideoWithFrameCallback>("camera");
  private readonly canvas = element<HTMLCanvasElement>("stage");
  private readonly renderer = new THREE.WebGLRenderer({
    canvas: this.canvas,
    alpha: true,
    antialias: true,
    powerPreference: "high-performance",
  });
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
  private readonly formingGeometry = new THREE.BufferGeometry();
  private readonly authorityGeometry = new THREE.BufferGeometry();
  private readonly formingCloud = new THREE.Points(this.formingGeometry, createPointMaterial(true));
  private readonly authorityCloud = new THREE.Points(this.authorityGeometry, createPointMaterial(false));
  private readonly runtimeCommitmentValue: string;

  private runtime: KeyxymV26TheaterRuntime | null = null;
  private mediaStream: MediaStream | null = null;
  private running = false;
  private processing = false;
  private frameCallback = 0;
  private fallbackTimer = 0;
  private lastProcessedAt = 0;
  private lastTimestampNs = 0n;
  private analysisIntervalMs = 50;
  private frameNumber = 0;
  private geometrySnapshot: KeyxymGeometrySnapshot = { revision: 0n, surfels: [] };
  private pose: KeyxymPoseEstimate | null = null;
  private quality: KeyxymQuality | null = null;
  private authority: KeyxymAuthorityDecision | null = null;
  private receipts: KeyxymReceipts | null = null;
  private sourceCommitment = ZERO_DIGEST;
  private formingSamples: KeyxymFormingSample[] = [];
  private moments: MomentRecord[] = [];
  private evidence: RuntimeEvidence[] = [];
  private currentMoment = 0;
  private playTimer = 0;
  private sealedCell: SealedWorldCell | null = null;
  private metricCalibration: MetricSensorCalibration | null = null;
  private requestedReferenceMeters: number | null = null;
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private pendingChunks: Uint8Array[] = [];
  private expectedDigest = "";
  private expectedBytes = 0;
  private hadRecoveredPose = false;

  constructor(private readonly manifest: KeyxymV26Manifest) {
    this.runtimeCommitmentValue = runtimeCommitment(manifest);
    this.camera.position.set(0, 0, 2.65);
    this.scene.add(this.formingCloud, this.authorityCloud);
    const grid = new THREE.GridHelper(3.6, 36, 0x123d52, 0x091925);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -1.35;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.24;
    this.scene.add(grid);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1));
    new ResizeObserver(() => this.resize()).observe(this.canvas);
    this.resize();
    this.render();
  }

  async initialize(): Promise<void> {
    this.runtime = await KeyxymV26TheaterRuntime.load(this.manifest);
    this.bindControls();
    document.documentElement.dataset.worldCellController = "keyxym-v026-worker-v1";
    setText("backend-name", "KEYXYM V0.26 / REALITY");
    setText("adapter-name", this.manifest.source_commit.slice(0, 12).toUpperCase());
    setText("gpu-badge", "WORKER WASM READY");
    setText("compute-state", "KEYXYM V0.26");
    setText("pose-state", "KEYXYM READY");
    setText("cell-state", "WORLD CELL / READY / RELATIVE");
    this.setStageMessage(
      "REALITY FORMATION READY",
      "The worker forms immediate visual evidence while calibrated Keyxym geometry becomes authoritative.",
    );
    this.updateControls();
    navigator.serviceWorker?.register("./sw.js").catch(() => undefined);
  }

  private resize(): void {
    const bounds = this.canvas.getBoundingClientRect();
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(Math.max(1, bounds.width), Math.max(1, bounds.height), false);
    this.camera.aspect = Math.max(1, bounds.width) / Math.max(1, bounds.height);
    this.camera.updateProjectionMatrix();
  }

  private render = (): void => {
    if (!this.running) this.authorityCloud.rotation.y += 0.00035;
    this.formingCloud.rotation.y *= 0.96;
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.render);
  };

  private bindControls(): void {
    element<HTMLButtonElement>("start-button").onclick = () => void this.startCamera().catch((error) => this.fail(error));
    element<HTMLButtonElement>("stop-button").onclick = () => this.stopCamera();
    element<HTMLButtonElement>("capture-button").onclick = () => void this.commitMoment().catch((error) => this.fail(error));
    element<HTMLButtonElement>("seal-button").onclick = () => void this.seal().catch((error) => this.fail(error));
    element<HTMLInputElement>("replay-slider").oninput = (event) => this.showMoment(Number((event.target as HTMLInputElement).value));
    element<HTMLButtonElement>("prev-button").onclick = () => this.showMoment(this.currentMoment - 1);
    element<HTMLButtonElement>("next-button").onclick = () => this.showMoment(this.currentMoment + 1);
    element<HTMLButtonElement>("play-button").onclick = () => this.togglePlayback();
    element<HTMLButtonElement>("host-button").onclick = () => void this.createOffer().catch((error) => this.fail(error));
    element<HTMLButtonElement>("join-button").onclick = () => void this.joinOffer().catch((error) => this.fail(error));
    element<HTMLButtonElement>("answer-button").onclick = () => void this.applyAnswer().catch((error) => this.fail(error));
    element<HTMLButtonElement>("send-button").onclick = () => void this.sendCell().catch((error) => this.fail(error));
    element<HTMLButtonElement>("reset-button").onclick = () => void this.reset().catch((error) => this.fail(error));
    element<HTMLButtonElement>("sensor-button").onclick = () => element<HTMLDialogElement>("sensor-dialog").showModal();
    element<HTMLButtonElement>("evidence-button").onclick = () => element<HTMLDialogElement>("evidence-dialog").showModal();
    element<HTMLButtonElement>("calibrate-button").onclick = () => element<HTMLDialogElement>("calibration-dialog").showModal();
    element<HTMLButtonElement>("apply-calibration").onclick = () => this.recordReferenceRequest();
    element<HTMLButtonElement>("serial-button").onclick = () => void this.connectSerial().catch((error) => this.sensorError(error));
    element<HTMLButtonElement>("usb-button").onclick = () => void this.connectUsb().catch((error) => this.sensorError(error));
    element<HTMLButtonElement>("xr-button").onclick = () => void this.probeXr().catch((error) => this.sensorError(error));
    document.querySelectorAll<HTMLElement>("[data-close]").forEach((button) => {
      button.onclick = () => element<HTMLDialogElement>(button.dataset.close ?? "").close();
    });
    window.addEventListener("beforeunload", () => {
      this.stopCamera();
      this.runtime?.destroy();
      this.peer?.close();
    }, { once: true });
  }

  private async startCamera(): Promise<void> {
    if (!this.runtime) throw new Error("Keyxym v0.26 authority is not initialized");
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 60 } },
      audio: false,
    });
    this.video.srcObject = this.mediaStream;
    await this.video.play();
    this.running = true;
    this.lastProcessedAt = 0;
    element<HTMLButtonElement>("start-button").disabled = true;
    element<HTMLButtonElement>("stop-button").disabled = false;
    setText("capture-state", "FORMING");
    this.hideStageMessage();
    await this.refreshMetricCalibration();
    this.scheduleFrame();
  }

  private stopCamera(): void {
    this.running = false;
    if (this.frameCallback && this.video.cancelVideoFrameCallback) this.video.cancelVideoFrameCallback(this.frameCallback);
    if (this.fallbackTimer) window.clearTimeout(this.fallbackTimer);
    this.frameCallback = 0;
    this.fallbackTimer = 0;
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    this.mediaStream = null;
    this.video.srcObject = null;
    element<HTMLButtonElement>("start-button").disabled = false;
    element<HTMLButtonElement>("stop-button").disabled = true;
    setText("capture-state", "READY");
    this.updateControls();
  }

  private scheduleFrame(): void {
    if (!this.running) return;
    if (this.video.requestVideoFrameCallback) {
      this.frameCallback = this.video.requestVideoFrameCallback((now) => void this.onVideoFrame(now));
    } else {
      this.fallbackTimer = window.setTimeout(() => void this.onVideoFrame(performance.now()), 32);
    }
  }

  private async onVideoFrame(now: number): Promise<void> {
    this.scheduleFrame();
    if (!this.running || this.processing || this.runtime?.busy ||
        now - this.lastProcessedAt < this.analysisIntervalMs ||
        this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    this.processing = true;
    this.lastProcessedAt = now;
    try {
      await this.processFrame(now);
    } catch (error) {
      this.freezeOnTrackingFailure(error);
    } finally {
      this.processing = false;
    }
  }

  private async processFrame(now: number): Promise<void> {
    if (!this.runtime) throw new Error("Keyxym v0.26 authority is unavailable");
    const sourceWidth = this.video.videoWidth;
    const sourceHeight = this.video.videoHeight;
    if (!sourceWidth || !sourceHeight) return;
    const calculated = BigInt(Math.max(1, Math.round((performance.timeOrigin + now) * 1_000_000)));
    const timestampNs = calculated > this.lastTimestampNs ? calculated : this.lastTimestampNs + 1n;
    this.lastTimestampNs = timestampNs;
    const calibration = this.metricCalibration?.verified === true ? this.metricCalibration : null;
    const bitmap = await createImageBitmap(this.video);
    const result = await this.runtime.ingest({
      bitmap,
      timestampNs,
      sourceWidth,
      sourceHeight,
      scaleMetersPerUnit: calibration?.scaleMetersPerUnit ?? 1,
      metricScale: calibration !== null,
    });
    const previouslyRecovered = this.hadRecoveredPose;
    this.pose = result.pose;
    this.quality = result.quality;
    this.authority = result.authority;
    this.receipts = result.receipts;
    this.sourceCommitment = bytesHex(result.sourceCommitment);
    this.formingSamples = result.forming;
    this.frameNumber += 1;
    this.hadRecoveredPose ||= result.pose.recovered;
    if (result.geometrySnapshot && result.pose.recovered) this.geometrySnapshot = result.geometrySnapshot;
    this.analysisIntervalMs = Math.max(33, Math.min(100, result.processingMs * 1.25));
    setText("dispatch-time", `${result.processingMs.toFixed(1)} ms / worker`);
    this.updateFormingCloud(result.forming, result.quality.coverage);
    this.updateAuthorityCloud(this.geometrySnapshot.surfels);
    this.updateQualityUi();
    this.recordRuntimeEvidence();
    this.updateControls();
    if (previouslyRecovered && !result.pose.recovered) {
      this.setStageMessage("TRACKING FROZEN", "Authoritative geometry is frozen. Return to a textured, previously observed view for relocalization.", true);
    } else if (result.pose.recovered) {
      this.hideStageMessage();
    }
    document.documentElement.dataset.formingSamples = String(result.forming.length);
    document.documentElement.dataset.authoritativeSurfels = String(this.geometrySnapshot.surfels.length);
    document.documentElement.dataset.geometryRevision = this.geometrySnapshot.revision.toString();
    document.documentElement.dataset.authorityStage = result.authority.stage;
    document.documentElement.dataset.authorityRejectionMask = String(result.authority.rejectionMask);
    document.documentElement.dataset.momentAllowed = String(result.authority.momentAllowed);
    document.documentElement.dataset.sealAllowed = String(result.authority.sealAllowed);
  }

  private updateFormingCloud(samples: KeyxymFormingSample[], coverage: number): void {
    const positions = new Float32Array(samples.length * 3);
    const colors = new Float32Array(samples.length * 3);
    const alpha = new Float32Array(samples.length);
    const size = new Float32Array(samples.length);
    const authorityWeight = clamp01(coverage);
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index]!;
      const flow = Math.hypot(sample.flowX, sample.flowY);
      const temporalDepth = Math.min(0.34, sample.age * 0.006 + flow * 2.5);
      positions[index * 3] = sample.normalizedX * (1.10 + temporalDepth * 0.18) + sample.flowX * 3.4;
      positions[index * 3 + 1] = sample.normalizedY * (0.84 + temporalDepth * 0.12) + sample.flowY * 3.4;
      positions[index * 3 + 2] = -0.86 + temporalDepth + Math.min(0.07, sample.salience * 0.10);
      colors[index * 3] = sample.r; colors[index * 3 + 1] = sample.g; colors[index * 3 + 2] = sample.b;
      alpha[index] = Math.max(0.07, (0.72 - authorityWeight * 0.50) * (0.30 + clamp01(sample.trackSupport) * 0.70));
      size[index] = 2.2 + Math.min(9, sample.age * 0.20) + Math.min(5, flow * 82);
    }
    setPointGeometry(this.formingGeometry, positions, colors, alpha, size);
  }

  private updateAuthorityCloud(surfels: KeyxymSurfel[]): void {
    const positions = new Float32Array(surfels.length * 3);
    const colors = new Float32Array(surfels.length * 3);
    const alpha = new Float32Array(surfels.length);
    const size = new Float32Array(surfels.length);
    for (let index = 0; index < surfels.length; index += 1) {
      const surfel = surfels[index]!;
      positions[index * 3] = surfel.x; positions[index * 3 + 1] = surfel.y; positions[index * 3 + 2] = surfel.z;
      colors[index * 3] = clamp01(surfel.r); colors[index * 3 + 1] = clamp01(surfel.g); colors[index * 3 + 2] = clamp01(surfel.b);
      alpha[index] = Math.max(0.14, clamp01(surfel.confidence) * (1 - Math.min(0.78, Math.max(0, surfel.uncertainty))));
      size[index] = 3.0 + Math.min(7, surfel.observations * 0.8) + clamp01(surfel.confidence) * 2.8;
    }
    setPointGeometry(this.authorityGeometry, positions, colors, alpha, size);
    const sphere = this.authorityGeometry.boundingSphere;
    if (sphere && sphere.radius > 0.00001) {
      this.authorityCloud.position.copy(sphere.center).multiplyScalar(-1);
      this.authorityCloud.scale.setScalar(Math.min(4, 0.92 / sphere.radius));
    } else {
      this.authorityCloud.position.set(0, 0, 0);
      this.authorityCloud.scale.setScalar(1);
    }
    setText("surfel-count", surfels.length.toLocaleString());
  }

  private updateQualityUi(): void {
    if (!this.pose || !this.quality || !this.authority) return;
    const labels: Record<KeyxymAuthorityDecision["stage"], string> = {
      forming: "FORMING",
      tracking: this.pose.relocalized ? "RELOCALIZED" : "TRACKING",
      "moment-ready": "MOMENT READY",
      "seal-ready": "SEAL READY",
    };
    const label = labels[this.authority.stage];
    setText("frame-count", String(this.frameNumber));
    setText("pose-state", `${label} ${Math.round(this.pose.tracking * 100)}%`);
    setText("tracking-value", `${Math.round(clamp01(this.quality.tracking) * 100)}%`);
    setText("parallax-value", `${this.quality.parallaxDegrees.toFixed(2)}°`);
    setText("error-value", Number.isFinite(this.quality.reprojectionErrorPixels) ? `${this.quality.reprojectionErrorPixels.toFixed(2)} px` : "—");
    setText("coverage-value", `${Math.round(clamp01(this.quality.coverage) * 100)}%`);
    setText("confirmed-value", Math.round(this.quality.confirmed).toLocaleString());
    setText("uncertain-value", Math.round(this.quality.uncertain).toLocaleString());
    setText("rejected-value", Math.round(this.quality.rejected).toLocaleString());
    setText("scale-value", this.quality.metricScale ? "METRIC" : "RELATIVE");
    setText("cell-state", `WORLD CELL / ${this.quality.metricScale ? "METRIC" : "RELATIVE"} / ${label}`);
    setWidth("quality-meter", clamp01(this.authority.score) * 100);
    setWidth("compute-meter", Math.min(100, 18 + this.formingSamples.length / 120 + this.geometrySnapshot.surfels.length / 480));
    setText("capture-state", label);
  }

  private recordRuntimeEvidence(): void {
    if (!this.pose || !this.quality || !this.authority || !this.receipts) return;
    const latest = this.evidence.at(-1);
    if (latest?.sourceCommitment === this.sourceCommitment && latest.geometryRevision === this.geometrySnapshot.revision.toString()) return;
    const record: RuntimeEvidence = {
      time: Date.now(),
      kind: "keyxym-v026-frame",
      sourceCommitment: this.sourceCommitment,
      poseReceipt: bytesHex(this.receipts.pose),
      qualityReceipt: bytesHex(this.receipts.quality),
      authorityReceipt: bytesHex(this.receipts.authority),
      reconstructionReceipt: reconstructionReceipt(this.receipts),
      runtimeCommitment: this.runtimeCommitmentValue,
      geometryRevision: this.geometrySnapshot.revision.toString(),
      details: {
        matches: this.pose.matches,
        inliers: this.pose.inliers,
        tracking: this.pose.tracking,
        parallaxDegrees: this.pose.parallaxDegrees,
        reprojectionErrorPixels: this.pose.reprojectionErrorPixels,
        rotationDegrees: this.pose.rotationDegrees,
        translationObservability: this.pose.translationObservability,
        degenerate: this.pose.degenerate,
        relocalized: this.pose.relocalized,
        authorityStage: this.authority.stage,
        authorityScore: this.authority.score,
        rejectionMask: this.authority.rejectionMask,
        momentAllowed: this.authority.momentAllowed,
        sealAllowed: this.authority.sealAllowed,
        confirmed: this.quality.confirmed,
        uncertain: this.quality.uncertain,
        rejected: this.quality.rejected,
        metricScale: this.quality.metricScale,
      },
    };
    this.evidence.push(record);
    if (this.evidence.length > 96) this.evidence.splice(0, this.evidence.length - 96);
    element("evidence-log").textContent = JSON.stringify(this.evidence, null, 2);
  }

  private canCommitMoment(): boolean {
    return this.authority?.momentAllowed === true && this.pose?.recovered === true && !this.pose.degenerate &&
      this.quality !== null && this.receipts !== null &&
      confirmedGeometry(this.geometrySnapshot.surfels).length === Math.round(this.authority.confirmedSurfels) &&
      nonzeroBytes(this.receipts.pose) && nonzeroBytes(this.receipts.quality) && nonzeroBytes(this.receipts.authority) &&
      nonzeroDigest(this.sourceCommitment);
  }

  private async commitMoment(): Promise<void> {
    if (!this.canCommitMoment() || !this.pose || !this.quality || !this.authority || !this.receipts) {
      throw new Error("The native Keyxym v0.26 authority decision does not permit a Moment");
    }
    if (this.moments.length >= MAX_MOMENTS) throw new Error("World Cell Moment limit reached");
    const geometry = confirmedGeometry(this.geometrySnapshot.surfels);
    const parent = this.moments.at(-1)?.canonicalDigest ?? ZERO_DIGEST;
    const body: Omit<MomentRecord, "canonicalDigest"> = {
      schema: "tessaryn/world-cell-moment/v26",
      id: `moment-${String(this.moments.length).padStart(4, "0")}`,
      sequence: this.moments.length + 1,
      createdAtUnixMs: Date.now(),
      geometryRevision: this.geometrySnapshot.revision.toString(),
      geometryRecordFloats: 13,
      geometry: packedSurfels(geometry),
      pose: Array.from(this.pose.worldFromCamera),
      quality: { ...this.quality },
      authority: { ...this.authority },
      sourceCommitment: this.sourceCommitment,
      poseReceipt: bytesHex(this.receipts.pose),
      qualityReceipt: bytesHex(this.receipts.quality),
      authorityReceipt: bytesHex(this.receipts.authority),
      reconstructionReceipt: reconstructionReceipt(this.receipts),
      runtimeCommitment: this.runtimeCommitmentValue,
      parentCommitment: parent,
      metricScale: this.quality.metricScale,
    };
    const moment: MomentRecord = { ...body, canonicalDigest: digestValue(body) };
    validateMoment(moment, parent);
    this.moments.push(moment);
    this.currentMoment = this.moments.length - 1;
    this.sealedCell = null;
    this.updateTimeline();
    setText("cell-state", `WORLD CELL / ${this.moments.length} VERIFIED MOMENT${this.moments.length === 1 ? "" : "S"} / UNSEALED`);
    setText("rootprint", "UNSEALED");
    this.updateControls();
  }

  private updateTimeline(): void {
    const timeline = element("timeline");
    timeline.innerHTML = "";
    if (!this.moments.length) {
      const empty = document.createElement("span");
      empty.className = "empty";
      empty.textContent = "No authoritative Moments committed.";
      timeline.appendChild(empty);
      return;
    }
    this.moments.forEach((moment, index) => {
      const button = document.createElement("button");
      button.className = index === this.currentMoment ? "active" : "";
      const small = document.createElement("small");
      small.textContent = `MOMENT ${String(index).padStart(2, "0")}`;
      const strong = document.createElement("b");
      strong.textContent = `${(moment.geometry.length / KEYXYM_V26_SURFEL_FLOATS).toLocaleString()} CONFIRMED`;
      button.append(small, strong);
      button.onclick = () => this.showMoment(index);
      timeline.appendChild(button);
    });
    const slider = element<HTMLInputElement>("replay-slider");
    slider.max = String(this.moments.length - 1);
    slider.value = String(this.currentMoment);
    element<HTMLButtonElement>("prev-button").disabled = false;
    element<HTMLButtonElement>("next-button").disabled = false;
    element<HTMLButtonElement>("play-button").disabled = false;
  }

  private showMoment(index: number): void {
    if (!this.moments.length) return;
    this.currentMoment = Math.max(0, Math.min(index, this.moments.length - 1));
    const moment = this.moments[this.currentMoment]!;
    this.updateAuthorityCloud(unpackSurfels(moment.geometry));
    this.updateTimeline();
    setText("cell-state", `WORLD CELL / MOMENT ${this.currentMoment} / ${moment.metricScale ? "METRIC" : "RELATIVE"}`);
  }

  private togglePlayback(): void {
    if (this.playTimer) {
      window.clearInterval(this.playTimer);
      this.playTimer = 0;
      setText("play-button", "PLAY");
      return;
    }
    if (!this.moments.length) return;
    setText("play-button", "STOP");
    this.playTimer = window.setInterval(() => this.showMoment((this.currentMoment + 1) % this.moments.length), 900);
  }

  private worldCellDraft(): WorldCellDraft {
    return {
      schema: "tessaryn/world-cell/v26",
      version: 26,
      branch: "main/world-cell-theater-v026",
      createdAtUnixMs: Date.now(),
      runtimeCommitment: this.runtimeCommitmentValue,
      scaleState: this.moments.every((moment) => moment.metricScale) ? "metric" : "relative",
      moments: this.moments.map((moment) => ({ ...moment, geometry: [...moment.geometry], pose: [...moment.pose], quality: { ...moment.quality }, authority: { ...moment.authority } })),
      evidence: this.evidence.map((item) => ({ ...item, details: { ...item.details } })),
    };
  }

  private async seal(): Promise<void> {
    const bridge = nativeAssuranceBridge();
    if (!bridge) throw new Error("A verified eform and Power House bridge is required to seal this World Cell");
    const latest = this.moments.at(-1);
    if (!latest || !this.authority?.sealAllowed || !latest.authority.sealAllowed ||
        latest.geometryRevision !== this.geometrySnapshot.revision.toString()) {
      throw new Error("Commit a SEAL READY Moment at the current Keyxym geometry revision before sealing");
    }
    const draft = this.worldCellDraft();
    const canonicalCell = canonicalString(draft);
    const canonicalDigest = digestBytes(encoder.encode(canonicalCell));
    const evidence = evidenceRequest({
      artifactKind: "world-cell",
      canonicalDigest,
      reconstructionReceipt: latest.reconstructionReceipt,
      runtimeCommitment: this.runtimeCommitmentValue,
      parentCommitment: latest.canonicalDigest,
      sequence: this.moments.length,
      metricScale: draft.scaleState === "metric",
    });
    const seal = await bridge.sealWorldCell({ canonicalCell, evidence });
    validateNativeSeal(seal);
    if (!await bridge.verifyWorldCell({ canonicalCell, evidence, seal })) {
      throw new Error("eform and Power House rejected the sealed World Cell");
    }
    this.sealedCell = { ...draft, canonicalDigest, assuranceEvidence: evidence, seal };
    setText("rootprint", seal.rootprint.slice(0, 16).toUpperCase());
    setText("cell-state", `WORLD CELL / SEALED / ${draft.scaleState.toUpperCase()} / ${this.moments.length} MOMENTS`);
    element("evidence-log").textContent = JSON.stringify({ runtimeEvidence: this.evidence, assuranceEvidence: evidence, seal }, null, 2);
    this.updateControls();
  }

  private setupPeer(): RTCPeerConnection {
    this.peer?.close();
    const peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    peer.onconnectionstatechange = () => setText("peer-state", peer.connectionState.toUpperCase());
    peer.ondatachannel = (event) => this.attachChannel(event.channel);
    this.peer = peer;
    return peer;
  }

  private attachChannel(channel: RTCDataChannel): void {
    this.channel = channel;
    channel.binaryType = "arraybuffer";
    channel.onopen = () => { setText("channel-state", "OPEN"); this.updateControls(); };
    channel.onclose = () => { setText("channel-state", "CLOSED"); this.updateControls(); };
    channel.onerror = () => setText("channel-state", "ERROR");
    channel.onmessage = (event) => {
      try { this.onPeerMessage(event); } catch (error) { this.fail(error); }
    };
  }

  private async waitForIce(peer: RTCPeerConnection): Promise<void> {
    if (peer.iceGatheringState === "complete") return;
    await new Promise<void>((resolve) => {
      const timeout = window.setTimeout(resolve, 4_000);
      const listener = () => {
        if (peer.iceGatheringState === "complete") {
          window.clearTimeout(timeout);
          peer.removeEventListener("icegatheringstatechange", listener);
          resolve();
        }
      };
      peer.addEventListener("icegatheringstatechange", listener);
    });
  }

  private parsePairingText(): RTCSessionDescriptionInit {
    const value = JSON.parse(element<HTMLTextAreaElement>("pairing-text").value) as RTCSessionDescriptionInit;
    if ((value.type !== "offer" && value.type !== "answer") || typeof value.sdp !== "string" || !value.sdp) {
      throw new Error("Pairing text is not a valid WebRTC description");
    }
    return value;
  }

  private async createOffer(): Promise<void> {
    const peer = this.setupPeer();
    this.attachChannel(peer.createDataChannel("tessaryn-world-cell", { ordered: true }));
    await peer.setLocalDescription(await peer.createOffer());
    await this.waitForIce(peer);
    element<HTMLTextAreaElement>("pairing-text").value = JSON.stringify(peer.localDescription);
    setText("transfer-state", "Offer ready. Copy it to the receiving device.");
  }

  private async joinOffer(): Promise<void> {
    const offer = this.parsePairingText();
    if (offer.type !== "offer") throw new Error("Paste an offer before joining");
    const peer = this.setupPeer();
    await peer.setRemoteDescription(offer);
    await peer.setLocalDescription(await peer.createAnswer());
    await this.waitForIce(peer);
    element<HTMLTextAreaElement>("pairing-text").value = JSON.stringify(peer.localDescription);
    setText("transfer-state", "Answer ready. Copy it back to the hosting device.");
  }

  private async applyAnswer(): Promise<void> {
    const answer = this.parsePairingText();
    if (answer.type !== "answer" || !this.peer) throw new Error("Create an offer, then paste the answer");
    await this.peer.setRemoteDescription(answer);
    setText("transfer-state", "Answer applied. Waiting for the verified channel.");
  }

  private async sendCell(): Promise<void> {
    if (!this.sealedCell) throw new Error("Only a sealed World Cell can be sent");
    if (!this.channel || this.channel.readyState !== "open") throw new Error("Verified World Cell channel is not open");
    const bytes = encoder.encode(canonicalString(this.sealedCell));
    const digest = digestBytes(bytes);
    const chunkBytes = 64 * 1024;
    const total = Math.ceil(bytes.byteLength / chunkBytes);
    this.channel.send(JSON.stringify({ type: "manifest", schema: "tessaryn/world-cell-transfer/v26", digest, bytes: bytes.byteLength, chunks: total }));
    for (let index = 0; index < total; index += 1) {
      while (this.channel.bufferedAmount > 4 * 1024 * 1024) await new Promise((resolve) => window.setTimeout(resolve, 12));
      this.channel.send(bytes.slice(index * chunkBytes, (index + 1) * chunkBytes));
      setWidth("transfer-meter", ((index + 1) / total) * 100);
    }
    this.channel.send(JSON.stringify({ type: "complete" }));
    setText("transfer-state", `Sent ${bytes.byteLength.toLocaleString()} sealed bytes.`);
  }

  private onPeerMessage(event: MessageEvent): void {
    if (typeof event.data === "string") {
      const message = JSON.parse(event.data) as Record<string, unknown>;
      if (message.type === "manifest") {
        const bytes = Number(message.bytes);
        const digest = String(message.digest ?? "");
        if (message.schema !== "tessaryn/world-cell-transfer/v26" || !Number.isSafeInteger(bytes) ||
            bytes <= 0 || bytes > 128 * 1024 * 1024 || !/^[0-9a-f]{64}$/.test(digest)) {
          throw new Error("Incoming v0.26 World Cell manifest is invalid");
        }
        this.pendingChunks = [];
        this.expectedBytes = bytes;
        this.expectedDigest = digest;
        setText("transfer-state", `Receiving ${bytes.toLocaleString()} sealed bytes…`);
      } else if (message.type === "complete") {
        void this.finalizeReceive().catch((error) => this.fail(error));
      }
      return;
    }
    const bytes = event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : new Uint8Array(event.data as ArrayBufferLike);
    this.pendingChunks.push(bytes);
    const received = this.pendingChunks.reduce((total, chunk) => total + chunk.byteLength, 0);
    setWidth("transfer-meter", this.expectedBytes ? received / this.expectedBytes * 100 : 0);
  }

  private async finalizeReceive(): Promise<void> {
    const received = this.pendingChunks.reduce((total, chunk) => total + chunk.byteLength, 0);
    if (received !== this.expectedBytes) throw new Error("Incoming World Cell byte count is incomplete");
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of this.pendingChunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    if (digestBytes(bytes) !== this.expectedDigest) throw new Error("Incoming World Cell transport digest mismatch");
    const cell = JSON.parse(decoder.decode(bytes)) as SealedWorldCell;
    await this.verifyReceivedCell(cell);
    this.sealedCell = cell;
    this.moments = cell.moments;
    this.evidence = cell.evidence;
    this.currentMoment = Math.max(0, this.moments.length - 1);
    this.updateTimeline();
    this.showMoment(this.currentMoment);
    setText("rootprint", cell.seal.rootprint.slice(0, 16).toUpperCase());
    setText("transfer-state", `VERIFIED / reconstructed ${bytes.byteLength.toLocaleString()} sealed bytes.`);
    this.updateControls();
  }

  private async verifyReceivedCell(cell: SealedWorldCell): Promise<void> {
    if (cell.schema !== "tessaryn/world-cell/v26" || cell.version !== 26 ||
        cell.branch !== "main/world-cell-theater-v026" || !Array.isArray(cell.moments) ||
        !cell.moments.length || !nonzeroDigest(cell.runtimeCommitment)) {
      throw new Error("Incoming v0.26 World Cell schema is invalid");
    }
    let parent = ZERO_DIGEST;
    for (const moment of cell.moments) { validateMoment(moment, parent); parent = moment.canonicalDigest; }
    const latest = cell.moments.at(-1)!;
    if (!latest.authority.sealAllowed) throw new Error("Incoming Cell was not committed from a SEAL READY authority decision");
    const draft: WorldCellDraft = {
      schema: cell.schema, version: cell.version, branch: cell.branch,
      createdAtUnixMs: cell.createdAtUnixMs, runtimeCommitment: cell.runtimeCommitment,
      scaleState: cell.scaleState, moments: cell.moments, evidence: cell.evidence,
    };
    const canonicalCell = canonicalString(draft);
    const digest = digestBytes(encoder.encode(canonicalCell));
    if (digest !== cell.canonicalDigest || cell.assuranceEvidence.canonicalDigest !== digest ||
        cell.assuranceEvidence.parentCommitment !== parent ||
        cell.assuranceEvidence.runtimeCommitment !== cell.runtimeCommitment ||
        cell.assuranceEvidence.reconstructionReceipt !== latest.reconstructionReceipt) {
      throw new Error("Incoming v0.26 World Cell evidence binding failed");
    }
    validateNativeSeal(cell.seal);
    const bridge = nativeAssuranceBridge();
    if (!bridge || !await bridge.verifyWorldCell({ canonicalCell, evidence: cell.assuranceEvidence, seal: cell.seal })) {
      throw new Error("Incoming World Cell requires eform and Power House verification");
    }
  }

  private updateControls(): void {
    element<HTMLButtonElement>("capture-button").disabled = !this.running || !this.canCommitMoment();
    const bridge = nativeAssuranceBridge();
    const latest = this.moments.at(-1);
    const sealReady = this.authority?.sealAllowed === true && latest?.authority.sealAllowed === true &&
      latest.geometryRevision === this.geometrySnapshot.revision.toString();
    const sealButton = element<HTMLButtonElement>("seal-button");
    sealButton.disabled = !sealReady || bridge === null;
    sealButton.textContent = bridge ? (sealReady ? "SEAL CELL" : "SEAL GATE") : "EFORM REQUIRED";
    element<HTMLButtonElement>("send-button").disabled = !this.sealedCell || !this.channel || this.channel.readyState !== "open";
  }

  private freezeOnTrackingFailure(error: unknown): void {
    const reason = error instanceof Error ? error.message : String(error);
    setText("pose-state", "TRACKING FROZEN");
    setText("capture-state", "FROZEN");
    setText("cell-state", "WORLD CELL / AUTHORITY FROZEN");
    this.setStageMessage("TRACKING FROZEN", `${reason}. Authoritative geometry was not advanced.`, true);
    this.updateControls();
  }

  private setStageMessage(title: string, detail: string, visible = true): void {
    const message = element("stage-message");
    const heading = message.querySelector("b");
    const body = message.querySelector("span");
    if (heading) heading.textContent = title;
    if (body) body.textContent = detail;
    message.style.display = visible ? "" : "none";
  }
  private hideStageMessage(): void { element("stage-message").style.display = "none"; }
  private fail(error: unknown): void {
    this.setStageMessage("WORLD CELL OPERATION REJECTED", error instanceof Error ? error.message : String(error), true);
    console.error("World Cell Theater v0.26", error);
  }
  private sensorError(error: unknown): void {
    element("sensor-log").textContent = error instanceof Error ? error.message : String(error);
  }

  private recordReferenceRequest(): void {
    const value = Number(element<HTMLInputElement>("scale-input").value);
    if (!Number.isFinite(value) || value < 0.01 || value > 20) throw new Error("Reference length must be between 0.01 and 20 meters");
    this.requestedReferenceMeters = value;
    setText("sensor-detail", `Reference request recorded: ${value.toFixed(3)} m. Metric status remains disabled until a verified sensor adapter binds that scale to this capture.`);
    element<HTMLDialogElement>("calibration-dialog").close();
  }

  private async refreshMetricCalibration(): Promise<void> {
    const calibration = await window.tessarynMetricSensor?.currentCalibration().catch(() => null) ?? null;
    if (calibration?.verified === true && Number.isFinite(calibration.scaleMetersPerUnit) &&
        calibration.scaleMetersPerUnit > 0 && nonzeroDigest(calibration.receipt)) {
      this.metricCalibration = calibration;
      setText("sensor-badge", calibration.device.toUpperCase());
      setText("sensor-detail", `Verified metric scale: ${calibration.scaleMetersPerUnit.toFixed(6)} meters per unit.`);
    } else {
      this.metricCalibration = null;
    }
  }

  private async connectSerial(): Promise<void> {
    const serial = (navigator as Navigator & { serial?: { requestPort(): Promise<{ open(input: { baudRate: number }): Promise<void>; getInfo(): unknown }> } }).serial;
    if (!serial) throw new Error("WebSerial is unavailable");
    const port = await serial.requestPort();
    await port.open({ baudRate: 921_600 });
    element("sensor-log").textContent = `Serial transport connected: ${JSON.stringify(port.getInfo())}. Metric authority requires a verified scale receipt.`;
    await this.refreshMetricCalibration();
  }

  private async connectUsb(): Promise<void> {
    const usb = (navigator as Navigator & { usb?: { requestDevice(input: { filters: Array<Record<string, number>> }): Promise<{ open(): Promise<void>; productName?: string; vendorId: number; productId: number }> } }).usb;
    if (!usb) throw new Error("WebUSB is unavailable");
    const device = await usb.requestDevice({ filters: [] });
    await device.open();
    element("sensor-log").textContent = `USB transport connected: ${device.productName ?? "spatial sensor"} (${device.vendorId}:${device.productId}).`;
    await this.refreshMetricCalibration();
  }

  private async probeXr(): Promise<void> {
    const xr = (navigator as Navigator & { xr?: { isSessionSupported(mode: string): Promise<boolean> } }).xr;
    if (!xr || !await xr.isSessionSupported("immersive-ar")) {
      element("sensor-log").textContent = "WebXR immersive AR/depth is unavailable.";
      return;
    }
    element("sensor-log").textContent = "WebXR immersive AR is available. Metric authority still requires a verified calibration receipt.";
    await this.refreshMetricCalibration();
  }

  private async reset(): Promise<void> {
    this.stopCamera();
    if (this.playTimer) window.clearInterval(this.playTimer);
    this.playTimer = 0;
    this.runtime?.destroy();
    this.runtime = await KeyxymV26TheaterRuntime.load(this.manifest);
    this.frameNumber = 0;
    this.lastTimestampNs = 0n;
    this.analysisIntervalMs = 50;
    this.geometrySnapshot = { revision: 0n, surfels: [] };
    this.pose = null; this.quality = null; this.authority = null; this.receipts = null;
    this.sourceCommitment = ZERO_DIGEST;
    this.formingSamples = [];
    this.moments = [];
    this.evidence = [];
    this.sealedCell = null;
    this.currentMoment = 0;
    this.hadRecoveredPose = false;
    setPointGeometry(this.formingGeometry, new Float32Array(), new Float32Array(), new Float32Array(), new Float32Array());
    setPointGeometry(this.authorityGeometry, new Float32Array(), new Float32Array(), new Float32Array(), new Float32Array());
    setText("surfel-count", "0"); setText("frame-count", "0"); setText("pose-state", "KEYXYM READY");
    setText("rootprint", "UNSEALED"); setText("cell-state", "WORLD CELL / READY / RELATIVE");
    element("evidence-log").textContent = "No evidence recorded.";
    this.updateTimeline();
    this.updateControls();
    this.setStageMessage("REALITY FORMATION READY", "Start the camera and move slowly to build calibrated multi-view evidence.", true);
  }
}

export async function installWorldCellTheater(manifest: KeyxymV26Manifest): Promise<void> {
  const controller = new TheaterController(manifest);
  await controller.initialize();
}
