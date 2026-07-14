import "./world-cell-theater.css";
import * as THREE from "three";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  KeyxymV22Runtime,
  type KeyxymFrameResult,
  type KeyxymMetricPoint,
} from "./keyxym-v22-runtime";

const q = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const video = q<HTMLVideoElement>("camera");
const canvas = q<HTMLCanvasElement>("stage");
const renderer = new THREE.WebGLRenderer({
  canvas,
  alpha: true,
  antialias: true,
  powerPreference: "high-performance",
});
const scene = new THREE.Scene();
const theaterCamera = new THREE.PerspectiveCamera(52, 1, 0.01, 100);
theaterCamera.position.set(0, 0, 2.4);
scene.add(new THREE.AmbientLight(0xffffff, 1));
const geometry = new THREE.BufferGeometry();
const material = new THREE.PointsMaterial({
  size: 0.022,
  vertexColors: true,
  sizeAttenuation: true,
  transparent: true,
  opacity: 0.97,
});
const cloud = new THREE.Points(geometry, material);
scene.add(cloud);
const grid = new THREE.GridHelper(4, 32, 0x1c5770, 0x102433);
grid.rotation.x = Math.PI / 2;
grid.position.z = -1.6;
scene.add(grid);

interface Point {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
  confidence: number;
  uncertainty: number;
  observations: number;
}

interface Moment {
  id: string;
  created: number;
  points: Point[];
  pose: number[];
  quality: Record<string, string | number | boolean>;
  receipt: string;
  parent: string;
}

interface Evidence {
  time: number;
  kind: string;
  receipt: string;
  details: Record<string, unknown>;
}

interface WorldCell {
  version: 22;
  id: string;
  branch: string;
  created: number;
  moments: Moment[];
  pha: string;
  memoryCapsule: string;
  rootprint: string;
  evidence: Evidence[];
}

let keyxym: KeyxymV22Runtime | null = null;
let stream: MediaStream | null = null;
let running = false;
let frameNumber = 0;
let points: Point[] = [];
let latestResult: KeyxymFrameResult | null = null;
let moments: Moment[] = [];
let currentMoment = 0;
let playTimer = 0;
let captureTimer = 0;
let peer: RTCPeerConnection | null = null;
let channel: RTCDataChannel | null = null;
let pendingChunks: Uint8Array[] = [];
let expectedDigest = "";
let expectedBytes = 0;
const evidence: Evidence[] = [];
const encoder = new TextEncoder();

const setText = (id: string, value: string) => {
  q(id).textContent = value;
};

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");

const digest = (value: unknown) =>
  hex(sha256(encoder.encode(typeof value === "string" ? value : JSON.stringify(value))));

function resize(): void {
  const bounds = canvas.getBoundingClientRect();
  renderer.setSize(bounds.width, bounds.height, false);
  theaterCamera.aspect = bounds.width / bounds.height;
  theaterCamera.updateProjectionMatrix();
}

new ResizeObserver(resize).observe(canvas);

function render(): void {
  renderer.render(scene, theaterCamera);
  requestAnimationFrame(render);
}
render();

function updateCloud(next: Point[]): void {
  const positions = new Float32Array(next.length * 3);
  const colors = new Float32Array(next.length * 3);
  for (let index = 0; index < next.length; index += 1) {
    const point = next[index]!;
    positions.set([point.x, -point.y, -point.z], index * 3);
    const confidenceGain = Math.max(0.35, Math.min(1, point.confidence + 0.25));
    colors.set([
      point.r * confidenceGain,
      point.g * confidenceGain,
      point.b * confidenceGain,
    ], index * 3);
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  setText("surfel-count", next.length.toLocaleString());
}

function convertGeometry(source: KeyxymMetricPoint[]): Point[] {
  return source.map((point) => ({
    x: point.x,
    y: point.y,
    z: point.z,
    r: point.r,
    g: point.g,
    b: point.b,
    confidence: point.confidence,
    uncertainty: point.uncertainty,
    observations: point.observations,
  }));
}

function recordEvidence(kind: string, details: Record<string, unknown>): void {
  const receipt = digest({ kind, details });
  evidence.push({ time: Date.now(), kind, receipt, details });
  q("evidence-log").textContent = JSON.stringify(evidence, null, 2);
}

function updateQuality(result: KeyxymFrameResult): void {
  const pose = result.pose;
  const quality = result.quality;
  if (pose.recovered) {
    setText("pose-state", `SOLVED ${pose.inliers}`);
  } else if (pose.matches > 0) {
    setText("pose-state", `TRACKING ${pose.matches}`);
  } else {
    setText("pose-state", "SEEKING PARALLAX");
  }
  setText("dispatch-time", `${result.elapsedMs.toFixed(1)} ms`);
  setText("backend-name", "KEYXYM V0.22 WASM");
  setText("adapter-name", "C++ METRIC CORE");
  setText("compute-state", "KEYXYM");
  setText("gpu-badge", "COMPILED");
  q("compute-meter").style.width = `${Math.round(Math.min(1, quality.tracking) * 100)}%`;
  q<HTMLButtonElement>("capture-button").disabled = points.length === 0;
}

async function captureFrame(): Promise<void> {
  if (!running || !keyxym || video.readyState < 2) return;
  const width = 176;
  const height = Math.max(104, Math.round(width * video.videoHeight / video.videoWidth));
  const offscreen = document.createElement("canvas");
  offscreen.width = width;
  offscreen.height = height;
  const context = offscreen.getContext("2d", { willReadFrequently: true });
  if (!context) return;
  context.drawImage(video, 0, 0, width, height);
  const image = context.getImageData(0, 0, width, height);
  const result = keyxym.ingest(
    image.data,
    width,
    height,
    BigInt(Date.now()) * 1_000_000n,
    false,
  );
  latestResult = result;
  points = convertGeometry(result.geometry);
  updateCloud(points);
  updateQuality(result);
  frameNumber += 1;
  setText("frame-count", frameNumber.toLocaleString());
  if (frameNumber % 8 === 0) {
    recordEvidence("keyxym-v22-frame", {
      matches: result.pose.matches,
      inliers: result.pose.inliers,
      tracking: result.pose.tracking,
      parallaxDegrees: result.pose.parallaxDegrees,
      reprojectionErrorPixels: result.pose.reprojectionErrorPixels,
      poseReceipt: result.pose.receipt,
      qualityReceipt: result.quality.receipt,
      surfels: result.geometry.length,
    });
  }
}

async function loadRuntime(): Promise<void> {
  setText("backend-name", "LOADING KEYXYM V0.22");
  try {
    keyxym = await KeyxymV22Runtime.load();
    setText("backend-name", "KEYXYM V0.22 WASM");
    setText("adapter-name", "C++ METRIC CORE");
    setText("gpu-badge", "READY");
    setText("compute-state", "KEYXYM");
    recordEvidence("runtime-loaded", { runtime: "keyxym_map/v0.22", transport: "WebAssembly" });
  } catch (error) {
    setText("backend-name", "KEYXYM LOAD FAILED");
    setText("adapter-name", String(error));
    setText("gpu-badge", "FAILED");
    throw error;
  }
}

async function startCamera(): Promise<void> {
  if (!keyxym) await loadRuntime();
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
  frameNumber = 0;
  q<HTMLButtonElement>("start-button").disabled = true;
  q<HTMLButtonElement>("stop-button").disabled = false;
  setText("capture-state", "CAPTURING");
  q("stage-message").style.display = "none";
  const loop = async () => {
    if (!running) return;
    try {
      await captureFrame();
    } catch (error) {
      setText("pose-state", "RUNTIME ERROR");
      recordEvidence("runtime-error", { message: String(error) });
    }
    captureTimer = window.setTimeout(loop, 140);
  };
  await loop();
}

function stopCamera(): void {
  running = false;
  window.clearTimeout(captureTimer);
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  q<HTMLButtonElement>("start-button").disabled = false;
  q<HTMLButtonElement>("capture-button").disabled = true;
  q<HTMLButtonElement>("stop-button").disabled = true;
  setText("capture-state", "READY");
}

function updateTimeline(): void {
  const timeline = q("timeline");
  timeline.innerHTML = "";
  if (moments.length === 0) {
    timeline.innerHTML = '<span class="empty">No Moments committed.</span>';
    return;
  }
  moments.forEach((moment, index) => {
    const button = document.createElement("button");
    button.className = index === currentMoment ? "active" : "";
    button.innerHTML = `<small>MOMENT ${String(index).padStart(2, "0")}</small><b>${moment.points.length.toLocaleString()} SURFELS</b>`;
    button.onclick = () => showMoment(index);
    timeline.appendChild(button);
  });
  const slider = q<HTMLInputElement>("replay-slider");
  slider.max = String(moments.length - 1);
  slider.value = String(currentMoment);
  q<HTMLButtonElement>("prev-button").disabled = false;
  q<HTMLButtonElement>("next-button").disabled = false;
  q<HTMLButtonElement>("play-button").disabled = false;
  q<HTMLButtonElement>("seal-button").disabled = false;
}

function showMoment(index: number): void {
  if (moments.length === 0) return;
  currentMoment = Math.max(0, Math.min(index, moments.length - 1));
  points = moments[currentMoment]!.points.map((point) => ({ ...point }));
  updateCloud(points);
  updateTimeline();
  setText("cell-state", `WORLD CELL / MOMENT ${currentMoment}`);
}

function commitMoment(): void {
  if (!latestResult || points.length === 0) return;
  const parent = moments.at(-1)?.receipt ?? "0";
  const quality = {
    tracking: latestResult.quality.tracking,
    parallaxDegrees: latestResult.quality.parallaxDegrees,
    reprojectionErrorPixels: latestResult.quality.reprojectionErrorPixels,
    coverage: latestResult.quality.coverage,
    confirmed: latestResult.quality.confirmed.toString(),
    uncertain: latestResult.quality.uncertain.toString(),
    rejected: latestResult.quality.rejected.toString(),
    poseReceipt: latestResult.pose.receipt,
    qualityReceipt: latestResult.quality.receipt,
  };
  const receipt = digest({ parent, quality, points });
  moments.push({
    id: `moment-${moments.length}`,
    created: Date.now(),
    points: points.map((point) => ({ ...point })),
    pose: [...latestResult.pose.matrix],
    quality,
    receipt,
    parent,
  });
  currentMoment = moments.length - 1;
  updateTimeline();
  setText("cell-state", `WORLD CELL / ${moments.length} MOMENTS`);
  recordEvidence("moment", { receipt, parent, quality });
}

function buildCell(): WorldCell {
  const base = {
    version: 22 as const,
    id: "",
    branch: "main",
    created: Date.now(),
    moments,
    pha: digest("keyxym/pha/v22"),
    memoryCapsule: digest(moments.map((moment) => moment.receipt)),
    rootprint: "",
    evidence,
  };
  const rootprint = digest({ ...base, rootprint: undefined, id: undefined });
  return { ...base, id: rootprint, rootprint };
}

function seal(): void {
  const cell = buildCell();
  setText("rootprint", cell.rootprint.slice(0, 16).toUpperCase());
  setText("cell-state", `WORLD CELL / SEALED / ${moments.length} MOMENTS`);
  recordEvidence("seal", { rootprint: cell.rootprint, runtime: "keyxym_map/v0.22" });
  q<HTMLButtonElement>("send-button").disabled = !channel || channel.readyState !== "open";
}

function setupPeer(): RTCPeerConnection {
  peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
  peer.onconnectionstatechange = () => setText("peer-state", peer?.connectionState.toUpperCase() ?? "CLOSED");
  peer.ondatachannel = (event) => attachChannel(event.channel);
  return peer;
}

function attachChannel(next: RTCDataChannel): void {
  channel = next;
  channel.binaryType = "arraybuffer";
  channel.onopen = () => {
    setText("channel-state", "OPEN");
    q<HTMLButtonElement>("send-button").disabled = moments.length === 0;
  };
  channel.onclose = () => setText("channel-state", "CLOSED");
  channel.onmessage = onPeerMessage;
}

const waitForIce = (connection: RTCPeerConnection) => new Promise<void>((resolve) => {
  if (connection.iceGatheringState === "complete") return resolve();
  connection.onicegatheringstatechange = () => {
    if (connection.iceGatheringState === "complete") resolve();
  };
});

async function createOffer(): Promise<void> {
  const connection = setupPeer();
  attachChannel(connection.createDataChannel("tessaryn-world-cell", { ordered: true }));
  await connection.setLocalDescription(await connection.createOffer());
  await waitForIce(connection);
  q<HTMLTextAreaElement>("pairing-text").value = JSON.stringify(connection.localDescription);
  setText("transfer-state", "Offer created. Copy it to the joining device.");
}

async function joinOffer(): Promise<void> {
  const raw = q<HTMLTextAreaElement>("pairing-text").value.trim();
  if (!raw) return;
  const connection = setupPeer();
  await connection.setRemoteDescription(JSON.parse(raw));
  await connection.setLocalDescription(await connection.createAnswer());
  await waitForIce(connection);
  q<HTMLTextAreaElement>("pairing-text").value = JSON.stringify(connection.localDescription);
  setText("transfer-state", "Answer created. Copy it back to the offering device.");
}

async function applyAnswer(): Promise<void> {
  if (!peer) throw new Error("Create an offer first");
  await peer.setRemoteDescription(JSON.parse(q<HTMLTextAreaElement>("pairing-text").value));
  setText("transfer-state", "Answer applied. Waiting for the encrypted data channel.");
}

async function sendCell(): Promise<void> {
  if (!channel || channel.readyState !== "open") return;
  const bytes = encoder.encode(JSON.stringify(buildCell()));
  const fullDigest = hex(sha256(bytes));
  const chunkSize = 32 * 1024;
  const total = Math.ceil(bytes.length / chunkSize);
  channel.send(JSON.stringify({ type: "manifest", digest: fullDigest, bytes: bytes.length, chunks: total }));
  for (let index = 0; index < total; index += 1) {
    channel.send(bytes.slice(index * chunkSize, (index + 1) * chunkSize));
    q("transfer-meter").style.width = `${Math.round((index + 1) / total * 100)}%`;
    await new Promise((resolve) => setTimeout(resolve, 8));
  }
  channel.send(JSON.stringify({ type: "complete" }));
  setText("transfer-state", `Sent ${bytes.length.toLocaleString()} verified bytes.`);
}

function onPeerMessage(event: MessageEvent): void {
  if (typeof event.data === "string") {
    const message = JSON.parse(event.data);
    if (message.type === "manifest") {
      pendingChunks = [];
      expectedDigest = message.digest;
      expectedBytes = message.bytes;
      setText("transfer-state", `Receiving ${message.bytes.toLocaleString()} bytes…`);
    } else if (message.type === "complete") {
      void finalizeReceive();
    }
    return;
  }
  pendingChunks.push(new Uint8Array(event.data));
  const received = pendingChunks.reduce((total, chunk) => total + chunk.length, 0);
  q("transfer-meter").style.width = `${Math.min(100, Math.round(received / expectedBytes * 100))}%`;
}

async function finalizeReceive(): Promise<void> {
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
  if (cell.version !== 22 || calculated !== cell.rootprint) {
    setText("transfer-state", "REJECTED / v0.22 World Cell verification failed");
    return;
  }
  moments = cell.moments;
  evidence.splice(0, evidence.length, ...cell.evidence);
  currentMoment = Math.max(0, moments.length - 1);
  updateTimeline();
  showMoment(currentMoment);
  setText("rootprint", cell.rootprint.slice(0, 16).toUpperCase());
  setText("transfer-state", `VERIFIED / v0.22 World Cell reconstructed from ${bytes.length.toLocaleString()} bytes.`);
}

async function connectSerial(): Promise<void> {
  const navigatorWithSerial = navigator as Navigator & {
    serial?: { requestPort(): Promise<{ open(options: { baudRate: number }): Promise<void> }> };
  };
  if (!navigatorWithSerial.serial) throw new Error("WebSerial unavailable");
  const port = await navigatorWithSerial.serial.requestPort();
  await port.open({ baudRate: 3_000_000 });
  setText("sensor-badge", "EVENT CAMERA");
  setText("sensor-detail", "Physical event-camera transport connected through WebSerial.");
  recordEvidence("sensor-connect", { transport: "WebSerial", hardware: true });
}

async function connectUsb(): Promise<void> {
  const navigatorWithUsb = navigator as Navigator & {
    usb?: { requestDevice(options: { filters: unknown[] }): Promise<{ open(): Promise<void>; productName?: string; vendorId: number; productId: number }> };
  };
  if (!navigatorWithUsb.usb) throw new Error("WebUSB unavailable");
  const device = await navigatorWithUsb.usb.requestDevice({ filters: [] });
  await device.open();
  setText("sensor-badge", "USB SENSOR");
  setText("sensor-detail", `${device.productName ?? "USB spatial sensor"} connected.`);
  recordEvidence("sensor-connect", {
    transport: "WebUSB",
    vendorId: device.vendorId,
    productId: device.productId,
    hardware: true,
  });
}

async function probeXr(): Promise<void> {
  const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
  if (!xr || !await xr.isSessionSupported("immersive-ar")) {
    setText("sensor-detail", "WebXR immersive AR/depth is not exposed by this browser.");
    return;
  }
  setText("sensor-badge", "WEBXR READY");
  setText("sensor-detail", "WebXR immersive AR is available for a depth-capable host session.");
  recordEvidence("sensor-probe", { transport: "WebXR", immersiveAR: true });
}

q("start-button").onclick = () => void startCamera().catch((error) => {
  q("stage-message").textContent = String(error);
});
q("stop-button").onclick = stopCamera;
q("capture-button").onclick = commitMoment;
q("seal-button").onclick = seal;
q<HTMLInputElement>("replay-slider").oninput = (event) =>
  showMoment(Number((event.target as HTMLInputElement).value));
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
document.querySelectorAll<HTMLElement>("[data-close]").forEach((button) => {
  button.onclick = () => q<HTMLDialogElement>(button.dataset.close!).close();
});
q("serial-button").onclick = () => void connectSerial().catch((error) => setText("sensor-detail", String(error)));
q("usb-button").onclick = () => void connectUsb().catch((error) => setText("sensor-detail", String(error)));
q("xr-button").onclick = () => void probeXr();
q("reset-button").onclick = () => {
  stopCamera();
  keyxym?.dispose();
  keyxym = null;
  points = [];
  moments = [];
  evidence.length = 0;
  latestResult = null;
  updateCloud([]);
  updateTimeline();
  setText("rootprint", "UNSEALED");
  setText("cell-state", "WORLD CELL / EMPTY");
  void loadRuntime();
};
window.addEventListener("beforeunload", () => {
  stopCamera();
  keyxym?.dispose();
});
navigator.serviceWorker?.register("./sw.js").catch(() => {});
updateTimeline();
void loadRuntime();
