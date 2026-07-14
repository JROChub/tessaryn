import "./world-cell-theater.css";
import * as THREE from "three";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  assessQuality,
  detectFeatures,
  fuseSurfels,
  matchFeatures,
  rgbaToGray,
  solvePose,
  triangulateSurfels,
  type CameraModel,
  type GrayFrame,
  type MetricPose,
  type MetricSurfel,
  type ReconstructionQuality,
} from "./metric-reconstruction";

const q = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const setText = (id: string, value: string) => {
  q(id).textContent = value;
};
const encoder = new TextEncoder();
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
const digest = (value: unknown) =>
  hex(sha256(encoder.encode(typeof value === "string" ? value : JSON.stringify(value))));

interface Moment {
  id: string;
  created: number;
  surfels: MetricSurfel[];
  pose: MetricPose;
  quality: ReconstructionQuality;
  sensor: string;
  backend: string;
  inputHash: string;
  outputHash: string;
  receipt: string;
}

interface Evidence {
  time: number;
  kind: string;
  device: string;
  transport: string;
  input: string;
  output: string;
  receipt: string;
  hardware: boolean;
  details: Record<string, unknown>;
}

interface WorldCell {
  version: 22;
  id: string;
  branch: string;
  created: number;
  camera: CameraModel;
  moments: Moment[];
  trajectory: MetricPose[];
  pha: string;
  memoryCapsule: string;
  rootprint: string;
  evidence: Evidence[];
}

const video = q<HTMLVideoElement>("camera");
const canvas = q<HTMLCanvasElement>("stage");
const renderer = new THREE.WebGLRenderer({
  canvas,
  alpha: true,
  antialias: true,
  powerPreference: "high-performance",
});
const scene = new THREE.Scene();
const camera3 = new THREE.PerspectiveCamera(52, 1, 0.01, 100);
camera3.position.set(0, 0, 2.4);
scene.add(new THREE.AmbientLight(0xffffff, 1));
const geometry = new THREE.BufferGeometry();
const material = new THREE.PointsMaterial({
  size: 0.018,
  vertexColors: true,
  sizeAttenuation: true,
  transparent: true,
  opacity: 0.96,
});
const cloud = new THREE.Points(geometry, material);
scene.add(cloud);
const uncertainGeometry = new THREE.BufferGeometry();
const uncertainMaterial = new THREE.PointsMaterial({
  size: 0.012,
  color: 0x5ed7ff,
  transparent: true,
  opacity: 0.24,
});
const uncertainCloud = new THREE.Points(uncertainGeometry, uncertainMaterial);
scene.add(uncertainCloud);
const trajectoryGeometry = new THREE.BufferGeometry();
const trajectoryLine = new THREE.Line(
  trajectoryGeometry,
  new THREE.LineBasicMaterial({ color: 0xd2b66e, transparent: true, opacity: 0.9 }),
);
scene.add(trajectoryLine);
const grid = new THREE.GridHelper(4, 32, 0x1c5770, 0x102433);
grid.rotation.x = Math.PI / 2;
grid.position.z = -1.6;
scene.add(grid);

let stream: MediaStream | null = null;
let running = false;
let processing = false;
let frameNo = 0;
let keyframeNo = 0;
let previousFrame: GrayFrame | null = null;
let referenceFeatures = [] as ReturnType<typeof detectFeatures>;
let surfels: MetricSurfel[] = [];
let moments: Moment[] = [];
let trajectory: MetricPose[] = [];
let currentMoment = 0;
let playTimer = 0;
let rejectedTotal = 0;
let pose: MetricPose = {
  tx: 0,
  ty: 0,
  tz: 0,
  yaw: 0,
  pitch: 0,
  roll: 0,
  inliers: 0,
  reprojectionError: 99,
  parallaxDegrees: 0,
  tracking: 0,
};
let quality: ReconstructionQuality = assessQuality([], pose, 0, false);
let cameraModel: CameraModel = {
  fx: 120,
  fy: 120,
  cx: 80,
  cy: 60,
  scaleMeters: 0.12,
};
let metricScale = false;
let gpuDevice: GPUDevice | null = null;
let gpuAdapterName = "CPU REFERENCE";
let backend = "CPU MULTI-VIEW";
let peer: RTCPeerConnection | null = null;
let channel: RTCDataChannel | null = null;
let pendingChunks: Uint8Array[] = [];
let expectedDigest = "";
let expectedBytes = 0;
const evidence: Evidence[] = [];

function resize() {
  const bounds = canvas.getBoundingClientRect();
  renderer.setSize(bounds.width, bounds.height, false);
  camera3.aspect = bounds.width / bounds.height;
  camera3.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);

function render() {
  if (!running) cloud.rotation.y += 0.00025;
  renderer.render(scene, camera3);
  requestAnimationFrame(render);
}
render();

function updateTrajectory() {
  const positions = new Float32Array(trajectory.length * 3);
  trajectory.forEach((item, index) => {
    positions.set([item.tx, item.ty, item.tz], index * 3);
  });
  trajectoryGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
}

function updateCloud(items: MetricSurfel[]) {
  const confirmed = items.filter((item) =>
    item.observations >= 2 && item.confidence >= 0.6 && item.uncertainty <= 0.18,
  );
  const uncertain = items.filter((item) => !confirmed.includes(item));
  const positions = new Float32Array(confirmed.length * 3);
  const colors = new Float32Array(confirmed.length * 3);
  confirmed.forEach((item, index) => {
    positions.set([item.x, item.y, item.z], index * 3);
    const confidence = 0.45 + item.confidence * 0.55;
    colors.set([item.r * confidence, item.g * confidence, item.b * confidence], index * 3);
  });
  const uncertainPositions = new Float32Array(uncertain.length * 3);
  uncertain.forEach((item, index) => {
    uncertainPositions.set([item.x, item.y, item.z], index * 3);
  });
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  uncertainGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(uncertainPositions, 3),
  );
  geometry.computeBoundingSphere();
  setText("surfel-count", String(items.length));
}

function updateQuality() {
  quality = assessQuality(surfels, pose, rejectedTotal, metricScale);
  setText("tracking-value", `${Math.round(quality.tracking * 100)}%`);
  setText("parallax-value", `${quality.parallaxDegrees.toFixed(2)}°`);
  setText("error-value", Number.isFinite(quality.reprojectionError)
    ? `${quality.reprojectionError.toFixed(2)} px`
    : "—");
  setText("coverage-value", `${Math.round(quality.coverage * 100)}%`);
  setText("confirmed-value", quality.confirmed.toLocaleString());
  setText("uncertain-value", quality.uncertain.toLocaleString());
  setText("rejected-value", quality.rejected.toLocaleString());
  setText("scale-value", quality.metricScale ? "METRIC" : "RELATIVE");
  q("quality-meter").style.width = `${Math.round(
    Math.min(1, quality.tracking * 0.45 + quality.coverage * 0.35 +
      Math.min(1, quality.parallaxDegrees / 8) * 0.2) * 100,
  )}%`;
}

function updateTimeline() {
  const element = q("timeline");
  element.innerHTML = "";
  if (moments.length === 0) {
    element.innerHTML = '<span class="empty">No Moments committed.</span>';
    return;
  }
  moments.forEach((moment, index) => {
    const button = document.createElement("button");
    button.className = index === currentMoment ? "active" : "";
    button.innerHTML = `<small>MOMENT ${String(index).padStart(2, "0")}</small>` +
      `<b>${moment.quality.confirmed.toLocaleString()} CONFIRMED</b>`;
    button.onclick = () => showMoment(index);
    element.appendChild(button);
  });
  const slider = q<HTMLInputElement>("replay-slider");
  slider.max = String(moments.length - 1);
  slider.value = String(currentMoment);
  ["prev-button", "next-button", "play-button", "seal-button"].forEach((id) => {
    q<HTMLButtonElement>(id).disabled = false;
  });
}

function showMoment(index: number) {
  if (moments.length === 0) return;
  currentMoment = Math.max(0, Math.min(index, moments.length - 1));
  const moment = moments[currentMoment]!;
  updateCloud(moment.surfels);
  setText("cell-state", `WORLD CELL / MOMENT ${currentMoment}`);
  setText("tracking-value", `${Math.round(moment.quality.tracking * 100)}%`);
  setText("coverage-value", `${Math.round(moment.quality.coverage * 100)}%`);
  updateTimeline();
}

async function probeGpu() {
  try {
    if (!navigator.gpu) throw new Error("WebGPU unavailable");
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error("No adapter");
    gpuDevice = await adapter.requestDevice();
    gpuAdapterName = (adapter.info?.description || adapter.info?.device || "WEBGPU ADAPTER").toUpperCase();
    backend = "WEBGPU FEATURE + FUSION";
    setText("gpu-badge", "ACTIVE");
    setText("compute-state", "WEBGPU");
    setText("backend-name", backend);
    setText("adapter-name", gpuAdapterName);
  } catch {
    setText("gpu-badge", "CPU FALLBACK");
    setText("backend-name", backend);
    setText("adapter-name", "PORTABLE");
  }
}
void probeGpu();

async function gpuScore(values: Float32Array) {
  if (!gpuDevice || values.byteLength === 0) return values;
  const shader = gpuDevice.createShaderModule({
    code: `
      @group(0) @binding(0) var<storage, read> src: array<f32>;
      @group(0) @binding(1) var<storage, read_write> dst: array<f32>;
      @compute @workgroup_size(64)
      fn main(@builtin(global_invocation_id) id: vec3<u32>) {
        let i = id.x;
        if (i < arrayLength(&src)) {
          let v = src[i];
          dst[i] = clamp(v * v * 1.25 + v * 0.1, 0.0, 1.0);
        }
      }
    `,
  });
  const source = gpuDevice.createBuffer({
    size: values.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const destination = gpuDevice.createBuffer({
    size: values.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const readback = gpuDevice.createBuffer({
    size: values.byteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  gpuDevice.queue.writeBuffer(source, 0, values);
  const pipeline = gpuDevice.createComputePipeline({
    layout: "auto",
    compute: { module: shader, entryPoint: "main" },
  });
  const bind = gpuDevice.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: source } },
      { binding: 1, resource: { buffer: destination } },
    ],
  });
  const command = gpuDevice.createCommandEncoder();
  const pass = command.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bind);
  pass.dispatchWorkgroups(Math.ceil(values.length / 64));
  pass.end();
  command.copyBufferToBuffer(destination, 0, readback, 0, values.byteLength);
  gpuDevice.queue.submit([command.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const output = new Float32Array(readback.getMappedRange().slice(0));
  readback.unmap();
  source.destroy();
  destination.destroy();
  readback.destroy();
  return output;
}

function captureImage(): GrayFrame {
  const width = 160;
  const ratio = video.videoWidth > 0 ? video.videoHeight / video.videoWidth : 0.75;
  const height = Math.max(90, Math.round(width * ratio));
  const scratch = document.createElement("canvas");
  scratch.width = width;
  scratch.height = height;
  const context = scratch.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("2D capture context unavailable");
  context.drawImage(video, 0, 0, width, height);
  const image = context.getImageData(0, 0, width, height);
  cameraModel = {
    ...cameraModel,
    fx: width * 0.82,
    fy: width * 0.82,
    cx: width / 2,
    cy: height / 2,
  };
  return rgbaToGray(image.data, width, height, performance.now());
}

async function processFrame() {
  if (!running || processing || video.readyState < 2) return;
  processing = true;
  const started = performance.now();
  try {
    const current = captureImage();
    if (!previousFrame) {
      previousFrame = current;
      referenceFeatures = detectFeatures(current);
      frameNo += 1;
      return;
    }
    const matches = matchFeatures(previousFrame, current, referenceFeatures);
    pose = solvePose(matches, cameraModel, pose);
    const triangulated = triangulateSurfels(
      previousFrame,
      current,
      matches,
      pose,
      cameraModel,
      keyframeNo,
    );
    rejectedTotal += triangulated.rejected;
    if (gpuDevice && triangulated.surfels.length > 0) {
      const scores = new Float32Array(triangulated.surfels.map((item) => item.confidence));
      const refined = await gpuScore(scores);
      triangulated.surfels.forEach((item, index) => {
        item.confidence = refined[index] ?? item.confidence;
      });
    }
    const acceptedKeyframe = pose.tracking >= 0.35 &&
      (pose.parallaxDegrees >= 0.35 || frameNo % 8 === 0);
    if (acceptedKeyframe) {
      surfels = fuseSurfels(surfels, triangulated.surfels);
      keyframeNo += 1;
      previousFrame = current;
      referenceFeatures = detectFeatures(current);
      trajectory.push({ ...pose });
      updateTrajectory();
      updateCloud(surfels);
    }
    frameNo += 1;
    setText("frame-count", String(frameNo));
    setText("pose-state", pose.tracking >= 0.35 ? `SOLVED ${trajectory.length}` : "TRACKING LOW");
    setText("dispatch-time", `${(performance.now() - started).toFixed(1)} ms`);
    q("compute-meter").style.width = `${Math.min(100, 15 + pose.tracking * 45 + quality.coverage * 40)}%`;
    updateQuality();
    if (frameNo % 12 === 0) {
      recordEvidence("metric-reconstruction", {
        pose,
        quality,
        matches: matches.length,
        keyframe: acceptedKeyframe,
      }, navigator.userAgent, gpuDevice ? "WebGPU + camera" : "CPU + camera", Boolean(gpuDevice));
    }
  } finally {
    processing = false;
  }
}

function recordEvidence(
  kind: string,
  output: unknown,
  device = navigator.userAgent,
  transport = "browser",
  hardware = Boolean(gpuDevice),
  details: Record<string, unknown> = {},
) {
  const input = digest({ kind, frameNo, previous: evidence.at(-1)?.receipt ?? "0" });
  const outputDigest = digest(output);
  const item: Evidence = {
    time: Date.now(),
    kind,
    device,
    transport,
    input,
    output: outputDigest,
    receipt: digest({ kind, input, outputDigest, device, transport, details }),
    hardware,
    details,
  };
  evidence.push(item);
  q("evidence-log").textContent = JSON.stringify(evidence, null, 2);
}

async function startCamera() {
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
  frameNo = 0;
  previousFrame = null;
  referenceFeatures = [];
  q<HTMLButtonElement>("start-button").disabled = true;
  q<HTMLButtonElement>("capture-button").disabled = false;
  q<HTMLButtonElement>("stop-button").disabled = false;
  setText("capture-state", "CAPTURING");
  q("stage-message").style.display = "none";
  recordEvidence("camera-open", {
    tracks: stream.getVideoTracks().map((track) => track.getSettings()),
  });
  const loop = async () => {
    if (!running) return;
    await processFrame();
    window.setTimeout(loop, gpuDevice ? 95 : 150);
  };
  void loop();
}

function stopCamera() {
  running = false;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  q<HTMLButtonElement>("start-button").disabled = false;
  q<HTMLButtonElement>("capture-button").disabled = true;
  q<HTMLButtonElement>("stop-button").disabled = true;
  setText("capture-state", "READY");
}

function commitMoment() {
  if (surfels.length === 0 || pose.tracking < 0.25) return;
  const snapshot = surfels.map((item) => ({ ...item }));
  const inputHash = digest({ frameNo, pose, cameraModel, trajectory });
  const outputHash = digest(snapshot);
  const moment: Moment = {
    id: `moment-${moments.length}`,
    created: Date.now(),
    surfels: snapshot,
    pose: { ...pose },
    quality: { ...quality },
    sensor: q("sensor-badge").textContent || "CAMERA",
    backend,
    inputHash,
    outputHash,
    receipt: digest({
      inputHash,
      outputHash,
      parent: moments.at(-1)?.receipt || "0",
      quality,
      cameraModel,
    }),
  };
  moments.push(moment);
  currentMoment = moments.length - 1;
  updateTimeline();
  recordEvidence("metric-moment", moment, navigator.userAgent, backend, Boolean(gpuDevice), {
    scale: metricScale ? "metric" : "relative",
  });
  setText("cell-state", `WORLD CELL / ${moments.length} MOMENTS`);
}

function buildCell(): WorldCell {
  const base = {
    version: 22 as const,
    id: "",
    branch: "main",
    created: Date.now(),
    camera: cameraModel,
    moments,
    trajectory,
    pha: digest("tessaryn/pha/v22/metric-world-cell"),
    memoryCapsule: digest({ moments: moments.map((moment) => moment.receipt), trajectory }),
    rootprint: "",
    evidence,
  };
  const rootprint = digest({ ...base, rootprint: undefined, id: undefined });
  return { ...base, id: rootprint, rootprint };
}

function seal() {
  const cell = buildCell();
  setText("rootprint", cell.rootprint.slice(0, 16).toUpperCase());
  setText("cell-state", `WORLD CELL / SEALED / ${moments.length} MOMENTS`);
  recordEvidence("seal-v22", cell, "browser-crypto", "SHA-256", false, {
    metricScale,
    camera: cameraModel,
  });
  q<HTMLButtonElement>("send-button").disabled = !channel || channel.readyState !== "open";
}

function setupPeer() {
  peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  peer.onconnectionstatechange = () =>
    setText("peer-state", peer?.connectionState.toUpperCase() || "CLOSED");
  peer.ondatachannel = (event) => attachChannel(event.channel);
  return peer;
}

function attachChannel(next: RTCDataChannel) {
  channel = next;
  channel.binaryType = "arraybuffer";
  channel.onopen = () => {
    setText("channel-state", "OPEN");
    q<HTMLButtonElement>("send-button").disabled = moments.length === 0;
  };
  channel.onclose = () => setText("channel-state", "CLOSED");
  channel.onmessage = onPeerMessage;
}

const waitForIce = (connection: RTCPeerConnection) =>
  new Promise<void>((resolve) => {
    if (connection.iceGatheringState === "complete") {
      resolve();
      return;
    }
    connection.onicegatheringstatechange = () => {
      if (connection.iceGatheringState === "complete") resolve();
    };
  });

async function createOffer() {
  const connection = setupPeer();
  attachChannel(connection.createDataChannel("tessaryn-metric-world-cell", { ordered: true }));
  await connection.setLocalDescription(await connection.createOffer());
  await waitForIce(connection);
  q<HTMLTextAreaElement>("pairing-text").value = JSON.stringify(connection.localDescription);
  setText("transfer-state", "Offer created. Copy it to the joining device.");
}

async function joinOffer() {
  const raw = q<HTMLTextAreaElement>("pairing-text").value.trim();
  if (!raw) return;
  const connection = setupPeer();
  await connection.setRemoteDescription(JSON.parse(raw));
  await connection.setLocalDescription(await connection.createAnswer());
  await waitForIce(connection);
  q<HTMLTextAreaElement>("pairing-text").value = JSON.stringify(connection.localDescription);
  setText("transfer-state", "Answer created. Copy it back to the offering device.");
}

async function applyAnswer() {
  if (!peer) throw new Error("Create an offer first");
  await peer.setRemoteDescription(JSON.parse(q<HTMLTextAreaElement>("pairing-text").value));
  setText("transfer-state", "Answer applied. Waiting for the encrypted data channel.");
}

async function sendCell() {
  if (!channel || channel.readyState !== "open") return;
  const bytes = encoder.encode(JSON.stringify(buildCell()));
  const fullDigest = hex(sha256(bytes));
  const chunkSize = 32 * 1024;
  const total = Math.ceil(bytes.length / chunkSize);
  channel.send(JSON.stringify({ type: "manifest", digest: fullDigest, bytes: bytes.length, chunks: total }));
  for (let index = 0; index < total; index += 1) {
    channel.send(bytes.slice(index * chunkSize, (index + 1) * chunkSize));
    q("transfer-meter").style.width = `${Math.round((index + 1) / total * 100)}%`;
    await new Promise((resolve) => window.setTimeout(resolve, 8));
  }
  channel.send(JSON.stringify({ type: "complete" }));
  setText("transfer-state", `Sent ${bytes.length.toLocaleString()} verified bytes.`);
  recordEvidence("webrtc-send", { bytes: bytes.length, digest: fullDigest }, "peer", "WebRTC DataChannel", true);
}

function onPeerMessage(event: MessageEvent) {
  if (typeof event.data === "string") {
    const message = JSON.parse(event.data) as { type: string; digest?: string; bytes?: number };
    if (message.type === "manifest") {
      pendingChunks = [];
      expectedDigest = message.digest || "";
      expectedBytes = message.bytes || 0;
      setText("transfer-state", `Receiving ${expectedBytes.toLocaleString()} bytes…`);
    } else if (message.type === "complete") {
      void finalizeReceive();
    }
    return;
  }
  pendingChunks.push(new Uint8Array(event.data));
  const received = pendingChunks.reduce((total, chunk) => total + chunk.length, 0);
  q("transfer-meter").style.width = `${Math.min(100, Math.round(received / expectedBytes * 100))}%`;
}

async function finalizeReceive() {
  const bytes = new Uint8Array(expectedBytes);
  let offset = 0;
  for (const chunk of pendingChunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const actual = hex(sha256(bytes));
  if (actual !== expectedDigest) {
    setText("transfer-state", "REJECTED / canonical digest mismatch");
    return;
  }
  const cell = JSON.parse(new TextDecoder().decode(bytes)) as WorldCell;
  const calculated = digest({ ...cell, rootprint: undefined, id: undefined });
  if (calculated !== cell.rootprint || cell.version !== 22) {
    setText("transfer-state", "REJECTED / Metric World Cell Rootprint mismatch");
    return;
  }
  moments = cell.moments;
  trajectory = cell.trajectory;
  cameraModel = cell.camera;
  metricScale = cell.moments.some((moment) => moment.quality.metricScale);
  surfels = moments.at(-1)?.surfels ?? [];
  evidence.splice(0, evidence.length, ...cell.evidence);
  currentMoment = Math.max(0, moments.length - 1);
  updateTimeline();
  updateTrajectory();
  updateCloud(surfels);
  updateQuality();
  setText("rootprint", cell.rootprint.slice(0, 16).toUpperCase());
  setText("transfer-state", `VERIFIED / Metric World Cell reconstructed from ${bytes.length.toLocaleString()} bytes.`);
  recordEvidence("webrtc-receive", { bytes: bytes.length, digest: actual }, "peer", "WebRTC DataChannel", true);
}

async function connectSerial() {
  const navigatorWithSerial = navigator as Navigator & {
    serial?: { requestPort(): Promise<any> };
  };
  if (!navigatorWithSerial.serial) throw new Error("WebSerial unavailable");
  const port = await navigatorWithSerial.serial.requestPort();
  await port.open({ baudRate: 1_000_000 });
  setText("sensor-badge", "EVENT CAMERA");
  q("sensor-log").textContent = "Physical event-camera serial stream connected.";
  recordEvidence("sensor-connect", { baudRate: 1_000_000 }, "event-camera", "WebSerial", true);
}

async function connectUsb() {
  const navigatorWithUsb = navigator as Navigator & {
    usb?: { requestDevice(options: { filters: unknown[] }): Promise<any> };
  };
  if (!navigatorWithUsb.usb) throw new Error("WebUSB unavailable");
  const device = await navigatorWithUsb.usb.requestDevice({ filters: [] });
  await device.open();
  setText("sensor-badge", "USB DEPTH");
  q("sensor-log").textContent = `Connected ${device.productName || "USB spatial sensor"}.`;
  recordEvidence("sensor-connect", {
    vendorId: device.vendorId,
    productId: device.productId,
  }, device.productName || "USB sensor", "WebUSB", true);
}

async function probeXr() {
  if (!navigator.xr || !await navigator.xr.isSessionSupported("immersive-ar")) {
    q("sensor-log").textContent = "WebXR immersive AR/depth is not exposed by this browser.";
    return;
  }
  setText("sensor-badge", "WEBXR READY");
  q("sensor-log").textContent = "WebXR immersive AR is available for native depth fusion.";
  recordEvidence("sensor-probe", { immersiveAR: true }, "phone-depth", "WebXR", true);
}

function applyCalibration() {
  const value = Number(q<HTMLInputElement>("scale-input").value);
  if (!Number.isFinite(value) || value <= 0.01 || value > 20) return;
  cameraModel.scaleMeters = value;
  metricScale = true;
  setText("scale-value", "METRIC");
  q<HTMLDialogElement>("calibration-dialog").close();
  recordEvidence("scale-calibration", { scaleMeters: value }, "user-reference", "calibration", false);
}

function reset() {
  stopCamera();
  surfels = [];
  moments = [];
  trajectory = [];
  evidence.length = 0;
  previousFrame = null;
  rejectedTotal = 0;
  pose = { ...pose, tx: 0, ty: 0, tz: 0, yaw: 0, pitch: 0, roll: 0, tracking: 0 };
  updateCloud([]);
  updateTrajectory();
  updateTimeline();
  updateQuality();
  setText("rootprint", "UNSEALED");
  setText("cell-state", "WORLD CELL / EMPTY");
}

q("start-button").onclick = () => void startCamera().catch((error) => setText("stage-message", String(error)));
q("stop-button").onclick = stopCamera;
q("capture-button").onclick = commitMoment;
q("seal-button").onclick = seal;
q<HTMLInputElement>("replay-slider").oninput = (event) => showMoment(Number((event.target as HTMLInputElement).value));
q("prev-button").onclick = () => showMoment(currentMoment - 1);
q("next-button").onclick = () => showMoment(currentMoment + 1);
q("play-button").onclick = () => {
  if (playTimer) {
    clearInterval(playTimer);
    playTimer = 0;
    setText("play-button", "PLAY");
    return;
  }
  if (moments.length === 0) return;
  setText("play-button", "STOP");
  playTimer = window.setInterval(() => showMoment((currentMoment + 1) % moments.length), 900);
};
q("host-button").onclick = () => void createOffer();
q("join-button").onclick = () => void joinOffer();
q("answer-button").onclick = () => void applyAnswer();
q("send-button").onclick = () => void sendCell();
q("sensor-button").onclick = () => q<HTMLDialogElement>("sensor-dialog").showModal();
q("evidence-button").onclick = () => q<HTMLDialogElement>("evidence-dialog").showModal();
q("calibrate-button").onclick = () => q<HTMLDialogElement>("calibration-dialog").showModal();
q("apply-calibration").onclick = applyCalibration;
document.querySelectorAll<HTMLElement>("[data-close]").forEach((button) => {
  button.onclick = () => q<HTMLDialogElement>(button.dataset.close!).close();
});
q("serial-button").onclick = () => void connectSerial().catch((error) => {
  q("sensor-log").textContent = String(error);
});
q("usb-button").onclick = () => void connectUsb().catch((error) => {
  q("sensor-log").textContent = String(error);
});
q("xr-button").onclick = () => void probeXr();
q("reset-button").onclick = reset;
window.addEventListener("beforeunload", stopCamera);
navigator.serviceWorker?.register("./sw.js").catch(() => undefined);
updateTimeline();
updateQuality();
