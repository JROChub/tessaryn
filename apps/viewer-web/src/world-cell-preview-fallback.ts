import "./world-cell-theater.css";
import * as THREE from "three";

const byId = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!(node instanceof HTMLElement)) throw new Error(`Missing World Cell element: ${id}`);
  return node as T;
};

interface GrayFrame {
  width: number;
  height: number;
  luma: Float32Array;
  rgba: Uint8ClampedArray;
}

interface Feature {
  x: number;
  y: number;
  score: number;
}

interface Track {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  error: number;
  residual: number;
}

interface MotionEstimate {
  dx: number;
  dy: number;
  parallax: number;
  quality: number;
  inliers: Track[];
}

interface VisualPoint {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
  confidence: number;
  born: number;
}

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value));

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

function detectFeatures(frame: GrayFrame, maximum = 150): Feature[] {
  const candidates: Feature[] = [];
  const { width, height, luma } = frame;
  for (let y = 5; y < height - 5; y += 3) {
    for (let x = 5; x < width - 5; x += 3) {
      let xx = 0;
      let yy = 0;
      let xy = 0;
      for (let oy = -2; oy <= 2; oy += 1) {
        for (let ox = -2; ox <= 2; ox += 1) {
          const index = (y + oy) * width + x + ox;
          const gx = luma[index + 1]! - luma[index - 1]!;
          const gy = luma[index + width]! - luma[index - width]!;
          xx += gx * gx;
          yy += gy * gy;
          xy += gx * gy;
        }
      }
      const trace = xx + yy;
      const score = xx * yy - xy * xy - 0.045 * trace * trace;
      if (score > 0.00022) candidates.push({ x, y, score });
    }
  }
  candidates.sort((left, right) => right.score - left.score);
  const selected: Feature[] = [];
  for (const candidate of candidates) {
    if (selected.every((feature) => {
      const dx = feature.x - candidate.x;
      const dy = feature.y - candidate.y;
      return dx * dx + dy * dy > 45;
    })) selected.push(candidate);
    if (selected.length >= maximum) break;
  }
  return selected;
}

function patchError(
  previous: GrayFrame,
  current: GrayFrame,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  let error = 0;
  let meanA = 0;
  let meanB = 0;
  let samples = 0;
  for (let oy = -2; oy <= 2; oy += 1) {
    for (let ox = -2; ox <= 2; ox += 1) {
      meanA += previous.luma[(ay + oy) * previous.width + ax + ox]!;
      meanB += current.luma[(by + oy) * current.width + bx + ox]!;
      samples += 1;
    }
  }
  meanA /= samples;
  meanB /= samples;
  for (let oy = -2; oy <= 2; oy += 1) {
    for (let ox = -2; ox <= 2; ox += 1) {
      const a = previous.luma[(ay + oy) * previous.width + ax + ox]! - meanA;
      const b = current.luma[(by + oy) * current.width + bx + ox]! - meanB;
      error += Math.abs(a - b);
    }
  }
  return error / samples;
}

function trackFeatures(previous: GrayFrame, current: GrayFrame, features: Feature[]): Track[] {
  const tracks: Track[] = [];
  for (const feature of features) {
    let bestX = feature.x;
    let bestY = feature.y;
    let best = Number.POSITIVE_INFINITY;
    let second = Number.POSITIVE_INFINITY;
    for (let dy = -8; dy <= 8; dy += 2) {
      for (let dx = -8; dx <= 8; dx += 2) {
        const x = feature.x + dx;
        const y = feature.y + dy;
        if (x < 3 || y < 3 || x >= current.width - 3 || y >= current.height - 3) continue;
        const error = patchError(previous, current, feature.x, feature.y, x, y);
        if (error < best) {
          second = best;
          best = error;
          bestX = x;
          bestY = y;
        } else if (error < second) {
          second = error;
        }
      }
    }
    const coarseX = bestX;
    const coarseY = bestY;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const x = coarseX + dx;
        const y = coarseY + dy;
        if (x < 3 || y < 3 || x >= current.width - 3 || y >= current.height - 3) continue;
        const error = patchError(previous, current, feature.x, feature.y, x, y);
        if (error < best) {
          second = best;
          best = error;
          bestX = x;
          bestY = y;
        } else if (error < second) {
          second = error;
        }
      }
    }
    if (best > 0.15 || best > second * 0.94) continue;
    tracks.push({
      ax: feature.x,
      ay: feature.y,
      bx: bestX,
      by: bestY,
      error: best,
      residual: 0,
    });
  }
  return tracks;
}

function estimateMotion(tracks: Track[], featureCount: number): MotionEstimate {
  if (tracks.length < 6) return { dx: 0, dy: 0, parallax: 0, quality: 0, inliers: [] };
  const dx = median(tracks.map((track) => track.bx - track.ax));
  const dy = median(tracks.map((track) => track.by - track.ay));
  for (const track of tracks) {
    track.residual = Math.hypot(track.bx - track.ax - dx, track.by - track.ay - dy);
  }
  const residualCenter = median(tracks.map((track) => track.residual));
  const threshold = Math.max(1.25, residualCenter * 2.8);
  const inliers = tracks.filter((track) => track.residual <= threshold && track.error <= 0.12);
  const support = inliers.length / Math.max(18, featureCount);
  const texture = clamp(featureCount / 90, 0, 1);
  const photometric = clamp(1 - median(inliers.map((track) => track.error)) / 0.12, 0, 1);
  const parallax = median(inliers.map((track) => Math.hypot(track.bx - track.ax, track.by - track.ay)));
  const quality = clamp(support * 0.58 + texture * 0.2 + photometric * 0.22, 0, 1);
  return { dx, dy, parallax, quality, inliers };
}

function createFrame(video: HTMLVideoElement, source: HTMLCanvasElement): GrayFrame | null {
  const width = 176;
  const height = Math.max(99, Math.round(width * video.videoHeight / Math.max(1, video.videoWidth)));
  source.width = width;
  source.height = height;
  const context = source.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(video, 0, 0, width, height);
  const image = context.getImageData(0, 0, width, height);
  const luma = new Float32Array(width * height);
  for (let index = 0; index < luma.length; index += 1) {
    const offset = index * 4;
    luma[index] = (
      image.data[offset]! * 0.2126 +
      image.data[offset + 1]! * 0.7152 +
      image.data[offset + 2]! * 0.0722
    ) / 255;
  }
  return { width, height, luma, rgba: image.data };
}

function appendKeyframe(
  frame: GrayFrame,
  motion: MotionEstimate,
  frameNumber: number,
  pose: { x: number; y: number; z: number; yaw: number },
  existing: VisualPoint[],
): VisualPoint[] {
  const fresh: VisualPoint[] = [];
  const stride = 4;
  const cos = Math.cos(pose.yaw);
  const sin = Math.sin(pose.yaw);
  for (let y = 3; y < frame.height - 3; y += stride) {
    for (let x = 3; x < frame.width - 3; x += stride) {
      const index = y * frame.width + x;
      const gx = frame.luma[index + 1]! - frame.luma[index - 1]!;
      const gy = frame.luma[index + frame.width]! - frame.luma[index - frame.width]!;
      const edge = clamp(Math.hypot(gx, gy) * 4, 0, 1);
      if (edge < 0.08 && ((x + y + frameNumber) % 3 !== 0)) continue;
      const offset = index * 4;
      const r = frame.rgba[offset]! / 255;
      const g = frame.rgba[offset + 1]! / 255;
      const b = frame.rgba[offset + 2]! / 255;
      const luminance = frame.luma[index]!;
      const radial = Math.hypot(x / frame.width - 0.5, y / frame.height - 0.5);
      const depth = 0.85 + (1 - edge) * 0.75 + (1 - luminance) * 0.28 + radial * 0.25;
      const localX = (x / frame.width - 0.5) * depth * 1.55;
      const localY = -(y / frame.height - 0.5) * depth * (frame.height / frame.width) * 1.55;
      const rotatedX = cos * localX - sin * -depth;
      const rotatedZ = sin * localX + cos * -depth;
      fresh.push({
        x: rotatedX + pose.x,
        y: localY + pose.y,
        z: rotatedZ + pose.z,
        r,
        g,
        b,
        confidence: clamp(0.35 + edge * 0.35 + motion.quality * 0.3, 0, 1),
        born: frameNumber,
      });
    }
  }
  const merged = [...existing, ...fresh];
  if (merged.length <= 18_000) return merged;
  return merged.slice(merged.length - 18_000);
}

export function installWorldCellPreviewFallback(reason: unknown): void {
  const video = byId<HTMLVideoElement>("camera");
  const canvas = byId<HTMLCanvasElement>("stage");
  const start = byId<HTMLButtonElement>("start-button");
  const stop = byId<HTMLButtonElement>("stop-button");
  const capture = byId<HTMLButtonElement>("capture-button");
  const seal = byId<HTMLButtonElement>("seal-button");
  const send = byId<HTMLButtonElement>("send-button");
  const stageMessage = byId<HTMLElement>("stage-message");

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x020912, 0.075);
  const camera = new THREE.PerspectiveCamera(52, 1, 0.01, 100);
  camera.position.set(0, 0, 2.7);
  scene.add(new THREE.AmbientLight(0xffffff, 1));
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.PointsMaterial({ size: 0.014, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.92 });
  const cloud = new THREE.Points(geometry, material);
  scene.add(cloud);
  const grid = new THREE.GridHelper(5, 40, 0x1c5770, 0x102433);
  grid.rotation.x = Math.PI / 2;
  grid.position.z = -2.1;
  scene.add(grid);

  const source = document.createElement("canvas");
  let stream: MediaStream | null = null;
  let running = false;
  let frameNumber = 0;
  let keyframes = 0;
  let timer = 0;
  let animation = 0;
  let previous: GrayFrame | null = null;
  let previousFeatures: Feature[] = [];
  let visualPoints: VisualPoint[] = [];
  let lastKeyframe = -20;
  const pose = { x: 0, y: 0, z: 0, yaw: 0 };
  const sourceReason = reason instanceof Error ? reason.message : String(reason);
  const keyxymState = document.documentElement.dataset.keyxymMapAuthority ?? "not-started";
  const eformState = document.documentElement.dataset.eformAuthority ?? "unavailable";

  document.documentElement.dataset.keyxymAuthority = "preview";
  document.documentElement.dataset.worldCellMode = "visual-preview";
  document.documentElement.dataset.visualPipeline = "tessaryn-visual-odometry-v1";
  document.documentElement.dataset.authoritativeSurfels = "0";

  byId("compute-state").textContent = "VISUAL ODOMETRY PREVIEW";
  byId("pose-state").textContent = "VISUAL TRACK READY";
  byId("cell-state").textContent = "VISUAL CELL / UNSEALED";
  byId("backend-name").textContent = "TESSARYN VISUAL ODOMETRY V1";
  byId("adapter-name").textContent = "CAMERA RGB / RELATIVE / NON-METRIC";
  byId("gpu-badge").textContent = "VISUAL ONLY";
  byId("rootprint").textContent = "UNSEALED";
  byId("surfel-count").textContent = "0 AUTH / 0 VIS";
  byId("sensor-detail").textContent =
    `Feature tracking and relative keyframe accumulation are active. Authoritative depth/pose remains locked ` +
    `(keyxym_map: ${keyxymState}; eform: ${eformState}) until a verified metric spatial adapter is present.`;

  const heading = stageMessage.querySelector("b");
  const detail = stageMessage.querySelector("span");
  if (heading) heading.textContent = "VISUAL ODOMETRY READY";
  if (detail) detail.textContent = `${sourceReason}. Camera RGB can create a relative visual preview only; no Moment, seal, Rootprint, or transfer can be created.`;
  stageMessage.style.display = "";

  capture.disabled = true;
  seal.disabled = true;
  send.disabled = true;
  stop.disabled = true;
  start.disabled = !navigator.mediaDevices?.getUserMedia;

  const resize = (): void => {
    const bounds = canvas.getBoundingClientRect();
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(Math.max(1, bounds.width), Math.max(1, bounds.height), false);
    camera.aspect = Math.max(1, bounds.width) / Math.max(1, bounds.height);
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  const updateCloud = (): void => {
    const positions = new Float32Array(visualPoints.length * 3);
    const colors = new Float32Array(visualPoints.length * 3);
    visualPoints.forEach((point, index) => {
      positions.set([point.x, point.y, point.z], index * 3);
      const age = clamp(1 - (frameNumber - point.born) / 1_800, 0.42, 1);
      const gain = age * (0.52 + point.confidence * 0.48);
      colors.set([point.r * gain, point.g * gain, point.b * gain], index * 3);
    });
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();
    byId("surfel-count").textContent = `0 AUTH / ${visualPoints.length.toLocaleString()} VIS`;
    document.documentElement.dataset.visualPoints = String(visualPoints.length);
    document.documentElement.dataset.visualKeyframes = String(keyframes);
  };

  const sampleFrame = (): void => {
    if (!running || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    const current = createFrame(video, source);
    if (!current) return;
    const features = detectFeatures(current);
    let motion: MotionEstimate = { dx: 0, dy: 0, parallax: 0, quality: 0, inliers: [] };
    if (previous) {
      const tracks = trackFeatures(previous, current, previousFeatures);
      motion = estimateMotion(tracks, previousFeatures.length);
      pose.x -= motion.dx / current.width * 0.16;
      pose.y += motion.dy / current.height * 0.12;
      pose.yaw = clamp(pose.yaw - motion.dx / current.width * 0.055, -0.7, 0.7);
      pose.z += clamp(motion.parallax / current.width, 0, 0.035) * 0.035;
    }

    const enoughTime = frameNumber - lastKeyframe >= 5;
    const usefulMotion = motion.parallax >= 0.65 && motion.quality >= 0.2;
    if (frameNumber === 0 || (enoughTime && usefulMotion)) {
      visualPoints = appendKeyframe(current, motion, frameNumber, pose, visualPoints);
      keyframes += 1;
      lastKeyframe = frameNumber;
      updateCloud();
    }

    previous = current;
    previousFeatures = features;
    frameNumber += 1;
    const qualityPercent = Math.round(motion.quality * 100);
    const parallaxDegrees = Math.atan2(motion.parallax, Math.max(1, current.width * 0.87)) * 180 / Math.PI;
    byId("frame-count").textContent = String(frameNumber);
    byId("pose-state").textContent = `VISUAL TRACK ${qualityPercent}%`;
    byId("capture-state").textContent = motion.quality >= 0.2 ? "VISUAL MAPPING" : "FIND TEXTURE / MOVE SLOWLY";
    byId("dispatch-time").textContent = `${motion.inliers.length} TRACKS / ${parallaxDegrees.toFixed(2)}° REL`;
    document.documentElement.dataset.visualTracking = motion.quality.toFixed(4);
    document.documentElement.dataset.visualParallax = parallaxDegrees.toFixed(4);
    document.documentElement.dataset.visualTracks = String(motion.inliers.length);
  };

  const render = (): void => {
    if (!running) cloud.rotation.y += 0.00022;
    camera.position.x += (pose.x * 0.32 - camera.position.x) * 0.035;
    camera.position.y += (pose.y * 0.25 - camera.position.y) * 0.035;
    camera.lookAt(pose.x * 0.18, pose.y * 0.18, -1.25 + pose.z * 0.2);
    renderer.render(scene, camera);
    animation = requestAnimationFrame(render);
  };
  render();

  const stopPreview = (): void => {
    running = false;
    if (timer) window.clearInterval(timer);
    timer = 0;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    video.srcObject = null;
    start.disabled = !navigator.mediaDevices?.getUserMedia;
    stop.disabled = true;
    byId("capture-state").textContent = "VISUAL READY";
    stageMessage.style.display = "";
  };

  start.onclick = async () => {
    start.disabled = true;
    byId("capture-state").textContent = "REQUESTING CAMERA";
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
      running = true;
      frameNumber = 0;
      keyframes = 0;
      previous = null;
      previousFeatures = [];
      visualPoints = [];
      lastKeyframe = -20;
      pose.x = 0;
      pose.y = 0;
      pose.z = 0;
      pose.yaw = 0;
      updateCloud();
      stop.disabled = false;
      stageMessage.style.display = "none";
      byId("capture-state").textContent = "VISUAL MAPPING";
      sampleFrame();
      timer = window.setInterval(sampleFrame, 125);
    } catch (error) {
      stopPreview();
      const message = error instanceof Error ? error.message : String(error);
      byId("capture-state").textContent = "CAMERA UNAVAILABLE";
      if (heading) heading.textContent = "CAMERA PREVIEW UNAVAILABLE";
      if (detail) detail.textContent = `${message}. Authority remains locked and no evidence was created.`;
      stageMessage.style.display = "";
    }
  };
  stop.onclick = stopPreview;
  window.addEventListener("beforeunload", () => {
    stopPreview();
    if (animation) cancelAnimationFrame(animation);
    renderer.dispose();
  }, { once: true });
}
