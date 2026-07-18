import "./world-cell-theater.css";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
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
  type KeyxymSurfaceSnapshot,
  type KeyxymSurfaceVertex,
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
import {
  assertValidSpatialFrame,
  isValidSpatialCalibration,
  type TessarynSpatialCalibration,
} from "./tessaryn-spatial-sensor";

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

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: (now: number, metadata: VideoFrameIdentity) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

interface VideoFrameIdentity {
  mediaTime: number;
  presentedFrames: number;
}

const ZERO_DIGEST = "0".repeat(64);
const MAX_MOMENTS = 48;
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
function digestBytesFromHex(value: string): Uint8Array {
  if (!nonzeroDigest(value)) throw new Error("Spatial calibration receipt is invalid");
  return Uint8Array.from(value.match(/.{2}/gu)!, (pair) => Number.parseInt(pair, 16));
}
function rootprintLabel(value: string): string {
  const digest = value.startsWith("sha256:") ? value.slice(7) : value;
  return digest.slice(0, 16).toUpperCase();
}

function createPointMaterial(additive: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: !additive,
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
        gl_PointSize = clamp(aSize * (42.0 / max(0.35, -viewPosition.z)), 1.0, 14.0);
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float radius = length(gl_PointCoord - vec2(0.5));
        if (radius > 0.5) discard;
        float core = smoothstep(0.5, 0.34, radius);
        gl_FragColor = vec4(vColor, vAlpha * core);
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

function setSurfaceGeometry(
  geometry: THREE.BufferGeometry,
  positions: Float32Array,
  normals: Float32Array,
  colors: Float32Array,
): void {
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
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
  private readonly retainedSourceFrame = element<HTMLCanvasElement>("retained-source-frame");
  private readonly canvas = element<HTMLCanvasElement>("stage");
  private readonly renderer: THREE.WebGLRenderer | null;
  private readonly fallbackContext: CanvasRenderingContext2D | null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
  private readonly controls = new OrbitControls(this.camera, this.canvas);
  private readonly formingGeometry = new THREE.BufferGeometry();
  private readonly authorityGeometry = new THREE.BufferGeometry();
  private readonly authoritySurfaceGeometry = new THREE.BufferGeometry();
  private readonly formingCloud = new THREE.Points(this.formingGeometry, createPointMaterial(true));
  private readonly authorityCloud = new THREE.Points(this.authorityGeometry, createPointMaterial(false));
  private readonly authoritySurface = new THREE.Mesh(
    this.authoritySurfaceGeometry,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: true,
    }),
  );
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
  private surfaceSnapshot: KeyxymSurfaceSnapshot = { revision: 0n, vertices: [] };
  private renderedSurfelCount = 0;
  private renderedSurfaceTriangles = 0;
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
  private spatialCalibration: TessarynSpatialCalibration | null = null;
  private requestedReferenceMeters: number | null = null;
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private pendingChunks: Uint8Array[] = [];
  private expectedDigest = "";
  private expectedBytes = 0;
  private hadRecoveredPose = false;
  private lastAutomaticMomentAt = 0;
  private readonly heldKeys = new Set<string>();
  private lastRenderAt = performance.now();

  constructor(private readonly manifest: KeyxymV26Manifest) {
    this.runtimeCommitmentValue = runtimeCommitment(manifest);
    let renderer: THREE.WebGLRenderer | null = null;
    let fallbackContext: CanvasRenderingContext2D | null = null;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
      });
    } catch (error) {
      // Rendering capability is not reconstruction authority. A browser that
      // cannot create WebGL must still capture, reconstruct, seal, and transfer.
      console.warn("WebGL unavailable; using the compatible World Cell renderer", error);
      fallbackContext = this.canvas.getContext("2d", { alpha: true });
    }
    this.renderer = renderer;
    this.fallbackContext = fallbackContext;
    document.documentElement.dataset.worldCellRenderer = renderer ? "webgl" : "canvas-2d";
    // Keyxym's camera convention looks down +Z; the renderer converts it to
    // Three's -Z convention so the participant begins at the capture origin.
    this.camera.position.set(0, 0, 0.02);
    this.controls.target.set(0, 0, -2);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = false;
    this.controls.minDistance = 0.05;
    this.controls.maxDistance = 40;
    this.controls.zoomToCursor = true;
    this.scene.add(this.formingCloud, this.authorityCloud, this.authoritySurface);
    const grid = new THREE.GridHelper(3.6, 36, 0x123d52, 0x091925);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -1.35;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.24;
    this.scene.add(grid);
    this.scene.add(new THREE.HemisphereLight(0xd9f4ff, 0x18202a, 1.35));
    const surfaceLight = new THREE.DirectionalLight(0xffffff, 1.8);
    surfaceLight.position.set(-1.4, 2.2, 0.8);
    this.scene.add(surfaceLight);
    this.canvas.tabIndex = 0;
    window.addEventListener("keydown", (event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight"].includes(event.code)) {
        this.heldKeys.add(event.code);
        event.preventDefault();
      }
    });
    window.addEventListener("keyup", (event) => this.heldKeys.delete(event.code));
    new ResizeObserver(() => this.resize()).observe(this.canvas);
    this.resize();
    this.render();
  }

  async initialize(): Promise<void> {
    this.runtime = await KeyxymV26TheaterRuntime.load(this.manifest);
    this.bindControls();
    document.documentElement.dataset.worldCellController = "keyxym-v026-worker-v1";
    document.documentElement.dataset.captureActive = "false";
    document.documentElement.dataset.reconstructionVisible = "false";
    setText("backend-name", "KEYXYM V0.26 / REALITY");
    setText("adapter-name", this.manifest.source_commit.slice(0, 12).toUpperCase());
    setText("gpu-badge", "WORKER WASM READY");
    setText("compute-state", "KEYXYM V0.26");
    setText("pose-state", "KEYXYM READY");
    setText("cell-state", "WORLD CELL / READY / RELATIVE");
    this.setStageMessage(
      "READY TO CAPTURE A PLACE",
      "Start the camera, frame a textured subject, then move slowly sideways around it. TESSARYN will tell you when enough real geometry has formed.",
    );
    this.updateControls();
    navigator.serviceWorker?.register("./sw.js").catch(() => undefined);
  }

  private resize(): void {
    const bounds = this.canvas.getBoundingClientRect();
    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    if (this.renderer) {
      this.renderer.setPixelRatio(pixelRatio);
      this.renderer.setSize(Math.max(1, bounds.width), Math.max(1, bounds.height), false);
    } else {
      this.canvas.width = Math.max(1, Math.round(bounds.width * pixelRatio));
      this.canvas.height = Math.max(1, Math.round(bounds.height * pixelRatio));
    }
    this.camera.aspect = Math.max(1, bounds.width) / Math.max(1, bounds.height);
    this.camera.updateProjectionMatrix();
  }

  private render = (): void => {
    const now = performance.now();
    const elapsed = Math.min(0.05, Math.max(0, (now - this.lastRenderAt) / 1_000));
    this.lastRenderAt = now;
    this.updateNavigation(elapsed);
    this.controls.update();
    document.documentElement.dataset.viewerPosition = [
      this.camera.position.x, this.camera.position.y, this.camera.position.z,
    ].map((value) => value.toFixed(5)).join(",");
    if (this.renderer) this.renderer.render(this.scene, this.camera);
    else this.renderCompatibleCanvas();
    requestAnimationFrame(this.render);
  };

  private renderCompatibleCanvas(): void {
    const context = this.fallbackContext;
    if (!context) return;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const scaleX = width / 2;
    const scaleY = height / 2;
    context.clearRect(0, 0, width, height);

    if (this.running) {
      const formingStride = Math.max(1, Math.ceil(this.formingSamples.length / 900));
      for (let index = 0; index < this.formingSamples.length; index += formingStride) {
        const sample = this.formingSamples[index]!;
        const x = (sample.normalizedX + 1) * scaleX;
        const y = (1 - sample.normalizedY) * scaleY;
        context.fillStyle = `rgba(${Math.round(clamp01(sample.r) * 255)},${Math.round(clamp01(sample.g) * 255)},${Math.round(clamp01(sample.b) * 255)},.48)`;
        context.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
    }

    const surfels = this.geometrySnapshot.surfels;
    const surfelStride = Math.max(1, Math.ceil(surfels.length / 2_500));
    const projected = new THREE.Vector3();
    for (let index = 0; index < surfels.length; index += surfelStride) {
      const surfel = surfels[index]!;
      projected.set(surfel.x, -surfel.y, -surfel.z).project(this.camera);
      if (projected.z < -1 || projected.z > 1) continue;
      const x = (projected.x + 1) * scaleX;
      const y = (1 - projected.y) * scaleY;
      context.fillStyle = `rgba(${Math.round(clamp01(surfel.r) * 255)},${Math.round(clamp01(surfel.g) * 255)},${Math.round(clamp01(surfel.b) * 255)},.82)`;
      context.beginPath();
      context.arc(x, y, 1.5 + clamp01(surfel.confidence) * 2.5, 0, Math.PI * 2);
      context.fill();
    }
  }

  private updateNavigation(elapsed: number): void {
    if (!this.heldKeys.size || elapsed <= 0) return;
    const forward = new THREE.Vector3().subVectors(this.controls.target, this.camera.position);
    forward.y = 0;
    if (forward.lengthSq() < 1e-8) forward.set(0, 0, -1);
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize();
    const movement = new THREE.Vector3();
    if (this.heldKeys.has("KeyW") || this.heldKeys.has("ArrowUp")) movement.add(forward);
    if (this.heldKeys.has("KeyS") || this.heldKeys.has("ArrowDown")) movement.sub(forward);
    if (this.heldKeys.has("KeyD") || this.heldKeys.has("ArrowRight")) movement.add(right);
    if (this.heldKeys.has("KeyA") || this.heldKeys.has("ArrowLeft")) movement.sub(right);
    if (movement.lengthSq() <= 0) return;
    const fast = this.heldKeys.has("ShiftLeft") || this.heldKeys.has("ShiftRight");
    movement.normalize().multiplyScalar((fast ? 2.4 : 0.8) * elapsed);
    this.camera.position.add(movement);
    this.controls.target.add(movement);
  }

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
    element<HTMLButtonElement>("advanced-button").onclick = () => this.toggleAdvancedControls();
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

  private toggleAdvancedControls(): void {
    const button = element<HTMLButtonElement>("advanced-button");
    const controls = document.querySelector<HTMLElement>(".advanced-capture");
    const expanded = button.getAttribute("aria-expanded") !== "true";
    button.setAttribute("aria-expanded", String(expanded));
    button.textContent = expanded ? "HIDE OPTIONS" : "MORE OPTIONS";
    if (controls) controls.hidden = !expanded;
    document.documentElement.dataset.advancedControls = String(expanded);
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
    document.documentElement.dataset.captureActive = "true";
    document.documentElement.dataset.sourceFrameRetained = "false";
    this.canvas.closest(".stage-panel")?.classList.remove("has-retained-source");
    this.lastProcessedAt = 0;
    element<HTMLButtonElement>("start-button").disabled = true;
    element<HTMLButtonElement>("stop-button").disabled = false;
    setText("capture-state", "FORMING");
    this.updatePresentationMode();
    this.hideStageMessage();
    await this.refreshSpatialCalibration();
    this.scheduleFrame();
  }

  private stopCamera(): void {
    this.running = false;
    document.documentElement.dataset.captureActive = "false";
    if (this.frameCallback && this.video.cancelVideoFrameCallback) this.video.cancelVideoFrameCallback(this.frameCallback);
    if (this.fallbackTimer) window.clearTimeout(this.fallbackTimer);
    this.frameCallback = 0;
    this.fallbackTimer = 0;
    this.retainCurrentSourceFrame();
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    this.mediaStream = null;
    // Keep the ended stream attached so the last sensory frame remains a
    // visible reference when no native geometry was defensible. Reset or a
    // new capture replaces it explicitly; hardware tracks are already closed.
    this.video.pause();
    element<HTMLButtonElement>("start-button").disabled = false;
    element<HTMLButtonElement>("stop-button").disabled = true;
    this.showStoppedResult();
    this.updateControls();
  }

  private retainCurrentSourceFrame(): void {
    const width = this.video.videoWidth;
    const height = this.video.videoHeight;
    if (width < 1 || height < 1) {
      document.documentElement.dataset.sourceFrameRetained = "false";
      return;
    }
    this.retainedSourceFrame.width = width;
    this.retainedSourceFrame.height = height;
    const context = this.retainedSourceFrame.getContext("2d", { alpha: false });
    if (!context) {
      document.documentElement.dataset.sourceFrameRetained = "false";
      return;
    }
    context.drawImage(this.video, 0, 0, width, height);
    document.documentElement.dataset.sourceFrameRetained = "true";
    this.canvas.closest(".stage-panel")?.classList.add("has-retained-source");
  }

  private scheduleFrame(): void {
    if (!this.running) return;
    if (this.video.requestVideoFrameCallback) {
      this.frameCallback = this.video.requestVideoFrameCallback((now, metadata) => void this.onVideoFrame(now, metadata));
    } else {
      this.fallbackTimer = window.setTimeout(() => void this.onVideoFrame(performance.now()), 32);
    }
  }

  private async onVideoFrame(now: number, frameIdentity?: VideoFrameIdentity): Promise<void> {
    this.scheduleFrame();
    if (!this.running || this.processing || this.runtime?.busy ||
        now - this.lastProcessedAt < this.analysisIntervalMs ||
        this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    this.processing = true;
    this.lastProcessedAt = now;
    try {
      await this.processFrame(now, frameIdentity);
    } catch (error) {
      if (this.running) this.handleFrameFailure(error);
      else this.showStoppedResult();
    } finally {
      this.processing = false;
    }
  }

  private async processFrame(now: number, frameIdentity?: VideoFrameIdentity): Promise<void> {
    if (!this.runtime) throw new Error("Keyxym v0.26 authority is unavailable");
    const sourceWidth = this.video.videoWidth;
    const sourceHeight = this.video.videoHeight;
    if (!sourceWidth || !sourceHeight) return;
    const calculated = BigInt(Math.max(1, Math.round((performance.timeOrigin + now) * 1_000_000)));
    const timestampNs = calculated > this.lastTimestampNs ? calculated : this.lastTimestampNs + 1n;
    this.lastTimestampNs = timestampNs;
    const calibration = this.spatialCalibration?.verified === true ? this.spatialCalibration : null;
    const adapter = calibration ? window.tessarynSpatialSensor : undefined;
    const bitmap = await createImageBitmap(this.video);
    let spatialFrame = null;
    try {
      if (calibration) {
        if (!adapter || !frameIdentity || !Number.isFinite(frameIdentity.mediaTime) ||
            !Number.isSafeInteger(frameIdentity.presentedFrames) || frameIdentity.presentedFrames < 1) {
          throw new Error("Metric capture requires an exact browser media-frame identity");
        }
        const spatialRequest = {
          timestampNs: timestampNs.toString(),
          colorMediaTimeSeconds: frameIdentity.mediaTime,
          presentedFrames: frameIdentity.presentedFrames,
          colorWidth: sourceWidth,
          colorHeight: sourceHeight,
        };
        spatialFrame = await adapter.captureFrame(spatialRequest);
        assertValidSpatialFrame(spatialFrame, calibration, spatialRequest);
      }
    } catch (error) {
      bitmap.close();
      throw error;
    }
    const result = await this.runtime.ingest({
      bitmap,
      timestampNs,
      sourceWidth,
      sourceHeight,
      scaleMetersPerUnit: 1,
      metricScale: spatialFrame !== null,
      intrinsics: calibration?.intrinsics,
      spatial: spatialFrame && calibration ? {
        width: spatialFrame.width,
        height: spatialFrame.height,
        depthMeters: spatialFrame.depthMeters,
        worldFromCamera: spatialFrame.worldFromCamera,
        calibrationReceipt: digestBytesFromHex(calibration.receipt),
      } : undefined,
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
    if (result.pose.recovered) this.followCapturePose(result.pose);
    if (result.geometrySnapshot && result.surfaceSnapshot && result.pose.recovered) {
      if (result.geometrySnapshot.revision !== result.surfaceSnapshot.revision) {
        throw new Error("Keyxym native surface revision diverges from authority geometry");
      }
      this.geometrySnapshot = result.geometrySnapshot;
      this.surfaceSnapshot = result.surfaceSnapshot;
    }
    this.analysisIntervalMs = Math.max(33, Math.min(100, result.processingMs * 1.25));
    setText("dispatch-time", `${result.processingMs.toFixed(1)} ms / worker`);
    this.updateFormingCloud(result.forming, result.quality.coverage);
    this.updateAuthorityCloud(this.geometrySnapshot.surfels, this.surfaceSnapshot.vertices);
    this.updateQualityUi();
    this.recordRuntimeEvidence();
    this.updateControls();
    const latestMoment = this.moments.at(-1);
    const sealTransition = result.authority.sealAllowed && latestMoment?.authority.sealAllowed !== true;
    if (this.canCommitMoment() && this.moments.length < MAX_MOMENTS &&
        latestMoment?.geometryRevision !== this.geometrySnapshot.revision.toString() &&
        (sealTransition || Date.now() - this.lastAutomaticMomentAt >= 2_500)) {
      await this.commitMoment(true);
      this.lastAutomaticMomentAt = Date.now();
      if (result.authority.sealAllowed && nativeAssuranceBridge()) {
        try {
          await this.seal();
        } catch (error) {
          // Preserve capture continuity if the local assurance transport is
          // temporarily unavailable. The exact seal-ready Moment remains
          // immutable and available for an explicit retry.
          console.warn("Automatic World Cell seal deferred", error);
          setText("cell-state", "WORLD CELL / SEAL READY / RETRY AVAILABLE");
        }
      }
    }
    if (this.running) {
      if (previouslyRecovered && !result.pose.recovered) {
        this.setStageMessage("RELOCALIZING", "The accumulated reconstruction is retained. Return to a textured, previously observed view to continue it.", true);
      } else if (result.pose.recovered) {
        this.hideStageMessage();
      }
    }
    document.documentElement.dataset.formingSamples = String(result.forming.length);
    document.documentElement.dataset.authoritativeSurfels = String(this.geometrySnapshot.surfels.length);
    document.documentElement.dataset.geometryRevision = this.geometrySnapshot.revision.toString();
    document.documentElement.dataset.authorityStage = result.authority.stage;
    document.documentElement.dataset.authorityRejectionMask = String(result.authority.rejectionMask);
    document.documentElement.dataset.momentAllowed = String(result.authority.momentAllowed);
    document.documentElement.dataset.sealAllowed = String(result.authority.sealAllowed);
    if (result.authority.momentAllowed) document.documentElement.dataset.everMomentReady = "true";
    if (result.authority.sealAllowed) document.documentElement.dataset.everSealReady = "true";
    if (!this.running) this.showStoppedResult();
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
      positions[index * 3 + 2] = -0.86 - temporalDepth - Math.min(0.07, sample.salience * 0.10);
      colors[index * 3] = sample.r; colors[index * 3 + 1] = sample.g; colors[index * 3 + 2] = sample.b;
      alpha[index] = Math.max(0.07, (0.72 - authorityWeight * 0.50) * (0.30 + clamp01(sample.trackSupport) * 0.70));
      size[index] = 0.45 + Math.min(0.75, sample.age * 0.025) + Math.min(0.65, flow * 16);
    }
    setPointGeometry(this.formingGeometry, positions, colors, alpha, size);
  }

  private followCapturePose(pose: KeyxymPoseEstimate): void {
    if (pose.worldFromCamera.length !== 16 || !Array.from(pose.worldFromCamera).every(Number.isFinite)) return;
    const value = pose.worldFromCamera;
    const captured = new THREE.Matrix4().set(
      value[0]!, value[1]!, value[2]!, value[3]!,
      value[4]!, value[5]!, value[6]!, value[7]!,
      value[8]!, value[9]!, value[10]!, value[11]!,
      value[12]!, value[13]!, value[14]!, value[15]!,
    );
    // Keyxym uses +Z forward and +Y down; Three uses -Z forward and +Y up.
    // Conjugating the rigid pose preserves the captured world frame while
    // placing the Theater observer at the participant's recovered camera.
    const basis = new THREE.Matrix4().makeScale(1, -1, -1);
    const theaterPose = basis.clone().multiply(captured).multiply(basis);
    theaterPose.decompose(this.camera.position, this.camera.quaternion, this.camera.scale);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.controls.target.copy(this.camera.position).add(forward.multiplyScalar(2));
    this.controls.update();
  }

  private updateAuthorityCloud(surfels: KeyxymSurfel[], nativeVertices: KeyxymSurfaceVertex[] = []): void {
    const positions = new Float32Array(surfels.length * 3);
    const colors = new Float32Array(surfels.length * 3);
    const alpha = new Float32Array(surfels.length);
    const size = new Float32Array(surfels.length);
    for (let index = 0; index < surfels.length; index += 1) {
      const surfel = surfels[index]!;
      positions[index * 3] = surfel.x;
      positions[index * 3 + 1] = -surfel.y;
      positions[index * 3 + 2] = -surfel.z;
      colors[index * 3] = clamp01(surfel.r); colors[index * 3 + 1] = clamp01(surfel.g); colors[index * 3 + 2] = clamp01(surfel.b);
      alpha[index] = Math.max(0.28, clamp01(surfel.confidence) * (1 - Math.min(0.72, Math.max(0, surfel.uncertainty))));
      size[index] = 0.55 + Math.min(0.85, surfel.observations * 0.10) + clamp01(surfel.confidence) * 0.65;
    }
    setPointGeometry(this.authorityGeometry, positions, colors, alpha, size);
    const nativeSurface = nativeVertices.length >= 3 && nativeVertices.length % 3 === 0;
    const surfacePositions = new Float32Array(nativeSurface ? nativeVertices.length * 3 : 0);
    const surfaceNormals = new Float32Array(nativeSurface ? nativeVertices.length * 3 : 0);
    const surfaceColors = new Float32Array(nativeSurface ? nativeVertices.length * 3 : 0);
    if (nativeSurface) {
      for (let index = 0; index < nativeVertices.length; index += 1) {
        const vertex = nativeVertices[index]!;
        surfacePositions[index * 3] = vertex.x;
        surfacePositions[index * 3 + 1] = -vertex.y;
        surfacePositions[index * 3 + 2] = -vertex.z;
        surfaceNormals[index * 3] = vertex.nx;
        surfaceNormals[index * 3 + 1] = -vertex.ny;
        surfaceNormals[index * 3 + 2] = -vertex.nz;
        const confidenceScale = 0.88 + clamp01(vertex.confidence) * 0.12;
        surfaceColors[index * 3] = clamp01(vertex.r * confidenceScale);
        surfaceColors[index * 3 + 1] = clamp01(vertex.g * confidenceScale);
        surfaceColors[index * 3 + 2] = clamp01(vertex.b * confidenceScale);
      }
    }
    setSurfaceGeometry(
      this.authoritySurfaceGeometry,
      surfacePositions,
      surfaceNormals,
      surfaceColors,
    );
    // Never recenter or renormalize an evolving map. Its origin is the first
    // camera pose and remains stable for locomotion, replay, and occlusion.
    this.authorityCloud.position.set(0, 0, 0);
    this.authorityCloud.scale.setScalar(1);
    this.authoritySurface.position.set(0, 0, 0);
    this.authoritySurface.scale.setScalar(1);
    const nativeTriangles = nativeSurface ? nativeVertices.length / 3 : 0;
    this.renderedSurfelCount = surfels.length;
    this.renderedSurfaceTriangles = nativeTriangles;
    this.updatePresentationMode();
    document.documentElement.dataset.surfacePatches = "0";
    document.documentElement.dataset.surfaceVertices = String(nativeSurface ? nativeVertices.length : 0);
    document.documentElement.dataset.surfaceTriangles = String(nativeTriangles);
    document.documentElement.dataset.surfaceSupportedArea = "0.000000";
    document.documentElement.dataset.surfaceMedianRadius = "0.000000";
    document.documentElement.dataset.surfaceMaximumRadius = "0.000000";
    document.documentElement.dataset.surfaceMaximumAngularRadius = "0.000000";
    document.documentElement.dataset.surfaceBuildMilliseconds = "0.000";
    setText("surfel-count", surfels.length.toLocaleString());
  }

  private updatePresentationMode(): void {
    const metric = this.quality?.metricScale === true;
    const hasSurface = this.renderedSurfaceTriangles >= 16;
    const hasContinuum = this.renderedSurfaceTriangles >= 64;
    const metricContinuum = metric && hasContinuum;
    const relativeSurface = !metric && !this.running && hasSurface;
    const relativePoints = !metric && !this.running && !hasSurface && this.renderedSurfelCount > 0;
    const surfaceVisible = metricContinuum || relativeSurface;
    const pointsVisible = (metric && !hasSurface && this.renderedSurfelCount > 0) || relativePoints;
    const reconstructionVisible = surfaceVisible || pointsVisible;

    const surfaceMaterial = this.authoritySurface.material as THREE.MeshStandardMaterial;
    if (surfaceMaterial.transparent !== relativeSurface) {
      surfaceMaterial.transparent = relativeSurface;
      surfaceMaterial.needsUpdate = true;
    }
    surfaceMaterial.opacity = relativeSurface ? 0.72 : 1;
    surfaceMaterial.depthWrite = !relativeSurface;
    this.authoritySurface.visible = surfaceVisible;
    this.authorityCloud.visible = pointsVisible;
    this.formingCloud.visible = this.running && metric && this.renderedSurfelCount < 1_024;
    const stage = this.canvas.closest(".stage-panel");
    stage?.classList.toggle("has-authority", hasSurface || this.renderedSurfelCount > 0);
    stage?.classList.toggle("has-authoritative-surface", surfaceVisible);
    stage?.classList.toggle("has-metric-continuum", metricContinuum);
    stage?.classList.toggle("has-relative-reconstruction", relativeSurface || relativePoints);
    document.documentElement.dataset.reconstructionVisible = String(reconstructionVisible);
    document.documentElement.dataset.surfaceMode = metric
      ? (hasSurface ? "native-triangles" : "metric-surfels-pending")
      : this.running
        ? "relative-live-preview"
        : hasSurface
          ? "relative-native-triangles"
          : relativePoints
            ? "relative-native-surfels"
            : "relative-source-frame";
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
    setText("cell-state", this.sealedCell
      ? `WORLD CELL / SEALED / ${this.sealedCell.scaleState.toUpperCase()} / ${this.sealedCell.moments.length} MOMENTS`
      : `WORLD CELL / ${this.quality.metricScale ? "METRIC" : "RELATIVE"} / ${label}`);
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

  private async commitMoment(automatic = false): Promise<void> {
    if (!this.canCommitMoment() || !this.pose || !this.quality || !this.authority || !this.receipts) {
      throw new Error("The native Keyxym v0.26 authority decision does not permit a Moment");
    }
    if (this.moments.length >= MAX_MOMENTS) throw new Error("World Cell Moment limit reached");
    const geometry = confirmedGeometry(this.geometrySnapshot.surfels);
    const parent = this.moments.at(-1)?.canonicalDigest ?? ZERO_DIGEST;
    const body: Omit<MomentRecord, "canonicalDigest"> = {
      schema: "tessaryn/world-cell-moment/v26",
      id: `${automatic ? "continuum" : "moment"}-${String(this.moments.length).padStart(4, "0")}`,
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
    document.documentElement.dataset.worldCellSealed = "true";
    setText("rootprint", rootprintLabel(seal.rootprint));
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
    setText("rootprint", rootprintLabel(cell.seal.rootprint));
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

  private handleFrameFailure(error: unknown): void {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("World Cell frame rejected", error);
    setText("pose-state", "FRAME REJECTED");
    setText("capture-state", "CAPTURE ACTIVE");
    this.setStageMessage("FRAME REJECTED", `${reason}. The accumulated reconstruction is intact; capture can continue.`, true);
    this.updateControls();
  }

  private showStoppedResult(): void {
    this.updatePresentationMode();
    const metric = this.quality?.metricScale === true;
    const reconstructionVisible = document.documentElement.dataset.reconstructionVisible === "true";
    if (reconstructionVisible) {
      const title = metric ? "METRIC CONTINUUM READY" : "RELATIVE RECONSTRUCTION READY";
      setText("pose-state", "RECONSTRUCTION READY");
      setText("capture-state", "RECONSTRUCTION READY");
      this.setStageMessage(
        title,
        "Capture stopped. Native geometry remains visible over the retained sensory frame; drag to inspect it or restart the camera to extend it.",
        true,
      );
    } else {
      setText("pose-state", "CAPTURE PAUSED");
      setText("capture-state", "PAUSED");
      this.setStageMessage(
        "CAPTURE PAUSED",
        "No native reconstruction was established. The final source frame is retained; restart and move slowly sideways around textured objects at different depths.",
        true,
      );
    }
    if (this.sealedCell) {
      setText("cell-state", `WORLD CELL / SEALED / ${this.sealedCell.scaleState.toUpperCase()} / ${this.sealedCell.moments.length} MOMENTS`);
    }
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
    setText("sensor-detail", `Reference request recorded: ${value.toFixed(3)} m. It is not metric evidence; synchronized calibrated depth and spatial pose are still required.`);
    element<HTMLDialogElement>("calibration-dialog").close();
  }

  private async refreshSpatialCalibration(): Promise<void> {
    const calibration = await window.tessarynSpatialSensor?.currentCalibration().catch(() => null) ?? null;
    if (isValidSpatialCalibration(calibration)) {
      const intrinsics = calibration.intrinsics;
      this.spatialCalibration = calibration;
      setText("sensor-badge", calibration.device.toUpperCase());
      setText("sensor-detail", `Host-verified synchronized RGB-D and spatial pose: ${intrinsics.width}×${intrinsics.height}.`);
    } else {
      this.spatialCalibration = null;
    }
  }

  private async connectSerial(): Promise<void> {
    const serial = (navigator as Navigator & { serial?: { requestPort(): Promise<{ open(input: { baudRate: number }): Promise<void>; getInfo(): unknown }> } }).serial;
    if (!serial) throw new Error("WebSerial is unavailable");
    const port = await serial.requestPort();
    await port.open({ baudRate: 921_600 });
    element("sensor-log").textContent = `Serial transport connected: ${JSON.stringify(port.getInfo())}. Metric authority requires a verified scale receipt.`;
    await this.refreshSpatialCalibration();
  }

  private async connectUsb(): Promise<void> {
    const usb = (navigator as Navigator & { usb?: { requestDevice(input: { filters: Array<Record<string, number>> }): Promise<{ open(): Promise<void>; productName?: string; vendorId: number; productId: number }> } }).usb;
    if (!usb) throw new Error("WebUSB is unavailable");
    const device = await usb.requestDevice({ filters: [] });
    await device.open();
    element("sensor-log").textContent = `USB transport connected: ${device.productName ?? "spatial sensor"} (${device.vendorId}:${device.productId}).`;
    await this.refreshSpatialCalibration();
  }

  private async probeXr(): Promise<void> {
    const xr = (navigator as Navigator & { xr?: { isSessionSupported(mode: string): Promise<boolean> } }).xr;
    if (!xr || !await xr.isSessionSupported("immersive-ar")) {
      element("sensor-log").textContent = "WebXR immersive AR/depth is unavailable.";
      return;
    }
    element("sensor-log").textContent = "WebXR immersive AR is available. Metric authority still requires a verified calibration receipt.";
    await this.refreshSpatialCalibration();
  }

  private async reset(): Promise<void> {
    this.stopCamera();
    this.video.srcObject = null;
    this.retainedSourceFrame.width = 1;
    this.retainedSourceFrame.height = 1;
    if (this.playTimer) window.clearInterval(this.playTimer);
    this.playTimer = 0;
    this.runtime?.destroy();
    this.runtime = await KeyxymV26TheaterRuntime.load(this.manifest);
    this.frameNumber = 0;
    this.lastTimestampNs = 0n;
    this.analysisIntervalMs = 50;
    this.geometrySnapshot = { revision: 0n, surfels: [] };
    this.surfaceSnapshot = { revision: 0n, vertices: [] };
    this.renderedSurfelCount = 0;
    this.renderedSurfaceTriangles = 0;
    this.pose = null; this.quality = null; this.authority = null; this.receipts = null;
    this.sourceCommitment = ZERO_DIGEST;
    this.formingSamples = [];
    this.moments = [];
    this.evidence = [];
    this.sealedCell = null;
    this.currentMoment = 0;
    this.hadRecoveredPose = false;
    this.lastAutomaticMomentAt = 0;
    delete document.documentElement.dataset.everMomentReady;
    delete document.documentElement.dataset.everSealReady;
    delete document.documentElement.dataset.worldCellSealed;
    setPointGeometry(this.formingGeometry, new Float32Array(), new Float32Array(), new Float32Array(), new Float32Array());
    setPointGeometry(this.authorityGeometry, new Float32Array(), new Float32Array(), new Float32Array(), new Float32Array());
    setSurfaceGeometry(this.authoritySurfaceGeometry, new Float32Array(), new Float32Array(), new Float32Array());
    this.canvas.closest(".stage-panel")?.classList.remove(
      "has-authority", "has-authoritative-surface", "has-metric-continuum", "has-relative-reconstruction",
      "has-retained-source",
    );
    document.documentElement.dataset.captureActive = "false";
    document.documentElement.dataset.reconstructionVisible = "false";
    document.documentElement.dataset.sourceFrameRetained = "false";
    delete document.documentElement.dataset.surfacePatches;
    delete document.documentElement.dataset.surfaceMode;
    delete document.documentElement.dataset.surfaceVertices;
    delete document.documentElement.dataset.surfaceMaximumRadius;
    delete document.documentElement.dataset.surfaceMaximumAngularRadius;
    delete document.documentElement.dataset.surfaceBuildMilliseconds;
    delete document.documentElement.dataset.surfaceTriangles;
    delete document.documentElement.dataset.surfaceSupportedArea;
    delete document.documentElement.dataset.surfaceMedianRadius;
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
