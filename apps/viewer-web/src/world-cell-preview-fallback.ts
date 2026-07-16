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

const MAX_VISUAL_POINTS = 7_200;
const SAMPLE_WIDTH = 192;
const SAMPLE_INTERVAL_MS = 100;
const PARTICLES_PER_TRACK = 3;

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value));

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

function detectFeatures(frame: GrayFrame, maximum = 160): Feature[] {
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
  const texture = clamp(featureCount / 100, 0, 1);
  const photometric = clamp(1 - median(inliers.map((track) => track.error)) / 0.12, 0, 1);
  const parallax = median(inliers.map((track) => Math.hypot(track.bx - track.ax, track.by - track.ay)));
  const quality = clamp(support * 0.58 + texture * 0.2 + photometric * 0.22, 0, 1);
  return { dx, dy, parallax, quality, inliers };
}

function createFrame(video: HTMLVideoElement, source: HTMLCanvasElement): GrayFrame | null {
  const width = SAMPLE_WIDTH;
  const height = Math.max(108, Math.round(width * video.videoHeight / Math.max(1, video.videoWidth)));
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

function sampleColor(frame: GrayFrame, x: number, y: number): [number, number, number] {
  const safeX = Math.round(clamp(x, 0, frame.width - 1));
  const safeY = Math.round(clamp(y, 0, frame.height - 1));
  const offset = (safeY * frame.width + safeX) * 4;
  const lift = (channel: number): number => 0.16 + channel / 255 * 0.84;
  return [
    lift(frame.rgba[offset]!),
    lift(frame.rgba[offset + 1]!),
    lift(frame.rgba[offset + 2]!),
  ];
}

function ordinalDepth(track: Track, motion: MotionEstimate): number {
  const flow = Math.hypot(track.bx - track.ax, track.by - track.ay);
  const relativeFlow = flow / Math.max(0.75, motion.parallax);
  const nearSignal = clamp((relativeFlow - 0.55) / 1.5, 0, 1);
  const structureSignal = clamp(track.residual / Math.max(1.25, motion.parallax), 0, 1);
  return clamp(1.82 - nearSignal * 0.82 - structureSignal * 0.18, 0.72, 1.9);
}

function deterministicJitter(x: number, y: number, frameNumber: number, particle: number): [number, number] {
  const seed = Math.sin(x * 12.9898 + y * 78.233 + frameNumber * 0.173 + particle * 4.131) * 43758.5453;
  const fraction = seed - Math.floor(seed);
  const angle = fraction * Math.PI * 2;
  const radius = (0.35 + ((fraction * 7.13) % 1) * 0.65) * particle;
  return [Math.cos(angle) * radius, Math.sin(angle) * radius];
}

function appendTrackedKeyframe(
  frame: GrayFrame,
  motion: MotionEstimate,
  features: Feature[],
  frameNumber: number,
  pose: { x: number; y: number; z: number; yaw: number },
  existing: VisualPoint[],
): VisualPoint[] {
  const fresh: VisualPoint[] = [];
  const tracked = motion.inliers.length >= 8
    ? motion.inliers.map((track) => ({
        x: track.bx,
        y: track.by,
        confidence: clamp(1 - track.error / 0.14, 0.2, 1),
        depth: ordinalDepth(track, motion),
      }))
    : features.map((feature) => ({
        x: feature.x,
        y: feature.y,
        confidence: 0.28,
        depth: 1.32,
      }));

  const cos = Math.cos(pose.yaw);
  const sin = Math.sin(pose.yaw);
  for (const trackedPoint of tracked) {
    const [r, g, b] = sampleColor(frame, trackedPoint.x, trackedPoint.y);
    for (let particle = 0; particle < PARTICLES_PER_TRACK; particle += 1) {
      const [jx, jy] = deterministicJitter(trackedPoint.x, trackedPoint.y, frameNumber, particle);
      const spread = particle === 0 ? 0 : 0.85 + (1 - trackedPoint.confidence) * 0.55;
      const px = trackedPoint.x + jx * spread;
      const py = trackedPoint.y + jy * spread;
      const localX = (px / frame.width - 0.5) * trackedPoint.depth * 1.72;
      const localY = -(py / frame.height - 0.5) * trackedPoint.depth *
        (frame.height / frame.width) * 1.72;
      const rotatedX = cos * localX - sin * -trackedPoint.depth;
      const rotatedZ = sin * localX + cos * -trackedPoint.depth;
      fresh.push({
        x: rotatedX + pose.x,
        y: localY + pose.y,
        z: rotatedZ + pose.z,
        r,
        g,
        b,
        confidence: trackedPoint.confidence * (particle === 0 ? 1 : 0.72),
        born: frameNumber,
      });
    }
  }

  const merged = [...existing, ...fresh];
  if (merged.length <= MAX_VISUAL_POINTS) return merged;
  return merged.slice(merged.length - MAX_VISUAL_POINTS);
}

function createDiscTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Visual preview point texture is unavailable");
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 31);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.32, "rgba(255,255,255,.92)");
  gradient.addColorStop(0.7, "rgba(255,255,255,.28)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function projectFlowPoint(frame: GrayFrame, x: number, y: number, depth: number): [number, number, number] {
  return [
    (x / frame.width - 0.5) * depth * 1.72,
    -(y / frame.height - 0.5) * depth * (frame.height / frame.width) * 1.72,
    -depth,
  ];
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

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: false,
    powerPreference: "high-performance",
    premultipliedAlpha: false,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x020912, 0.16);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 40);
  camera.position.set(0, 0, 2.35);

  const geometry = new THREE.BufferGeometry();
  const material = new THREE.PointsMaterial({
    size: 0.032,
    map: createDiscTexture(),
    alphaTest: 0.025,
    vertexColors: true,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
  });
  const cloud = new THREE.Points(geometry, material);
  cloud.frustumCulled = false;
  scene.add(cloud);

  const flowGeometry = new THREE.BufferGeometry();
  const flowMaterial = new THREE.LineBasicMaterial({
    color: 0x8ce6ff,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
  });
  const flowLines = new THREE.LineSegments(flowGeometry, flowMaterial);
  flowLines.frustumCulled = false;
  scene.add(flowLines);

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
  document.documentElement.dataset.visualRenderer = "sparse-ordinal-flow";
  document.documentElement.dataset.authoritativeSurfels = "0";

  byId("compute-state").textContent = "TRACKED FLOW PREVIEW";
  byId("pose-state").textContent = "VISUAL TRACK READY";
  byId("cell-state").textContent = "VISUAL CELL / UNSEALED";
  byId("backend-name").textContent = "TESSARYN TRACKED FLOW V2";
  byId("adapter-name").textContent = "CAMERA RGB / ORDINAL / NON-METRIC";
  byId("gpu-badge").textContent = "VISUAL ONLY";
  byId("rootprint").textContent = "UNSEALED";
  byId("surfel-count").textContent = "0 AUTH / 0 FLOW PTS";
  byId("sensor-detail").textContent =
    `Sparse measured tracks and relative motion layers are active. No dense or metric geometry is inferred ` +
    `(keyxym_map: ${keyxymState}; eform: ${eformState}) until a verified spatial adapter is present.`;

  const heading = stageMessage.querySelector("b");
  const detail = stageMessage.querySelector("span");
  if (heading) heading.textContent = "VISUAL ODOMETRY READY";
  if (detail) detail.textContent =
    `${sourceReason}. Camera RGB is shown directly with measured feature tracks and ordinal motion layers only; ` +
    `no Moment, seal, Rootprint, or transfer can be created.`;
  stageMessage.style.display = "";

  capture.disabled = true;
  seal.disabled = true;
  send.disabled = true;
  stop.disabled = true;
  start.disabled = !navigator.mediaDevices?.getUserMedia;

  const resize = (): void => {
    const bounds = canvas.getBoundingClientRect();
    renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    renderer.setSize(Math.max(1, bounds.width), Math.max(1, bounds.height), false);
    camera.aspect = Math.max(1, bounds.width) / Math.max(1, bounds.height);
    camera.updateProjectionMatrix();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  resize();

  const updateCloud = (): void => {
    const positions = new Float32Array(visualPoints.length * 3);
    const colors = new Float32Array(visualPoints.length * 3);
    visualPoints.forEach((point, index) => {
      positions.set([point.x, point.y, point.z], index * 3);
      const age = clamp(1 - (frameNumber - point.born) / 720, 0.1, 1);
      const gain = age * (0.46 + point.confidence * 0.54);
      colors.set([point.r * gain, point.g * gain, point.b * gain], index * 3);
    });
    const positionAttribute = new THREE.BufferAttribute(positions, 3);
    const colorAttribute = new THREE.BufferAttribute(colors, 3);
    positionAttribute.setUsage(THREE.DynamicDrawUsage);
    colorAttribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("position", positionAttribute);
    geometry.setAttribute("color", colorAttribute);
    byId("surfel-count").textContent =
      `0 AUTH / ${visualPoints.length.toLocaleString()} FLOW PTS`;
    document.documentElement.dataset.visualPoints = String(visualPoints.length);
    document.documentElement.dataset.visualKeyframes = String(keyframes);
  };

  const updateFlowOverlay = (frame: GrayFrame, motion: MotionEstimate): void => {
    const visibleTracks = motion.inliers.slice(0, 90);
    const positions = new Float32Array(visibleTracks.length * 6);
    visibleTracks.forEach((track, index) => {
      const startPoint = projectFlowPoint(frame, track.ax, track.ay, 0.82);
      const endPoint = projectFlowPoint(frame, track.bx, track.by, 0.82);
      positions.set([...startPoint, ...endPoint], index * 6);
    });
    const attribute = new THREE.BufferAttribute(positions, 3);
    attribute.setUsage(THREE.DynamicDrawUsage);
    flowGeometry.setAttribute("position", attribute);
  };

  const updateQualityPanel = (motion: MotionEstimate, parallaxDegrees: number): void => {
    const qualityPercent = Math.round(motion.quality * 100);
    const coverage = Math.round(clamp(motion.inliers.length / 90, 0, 1) * 100);
    byId("tracking-value").textContent = `${qualityPercent}%`;
    byId("parallax-value").textContent = `${parallaxDegrees.toFixed(2)}°`;
    byId("coverage-value").textContent = `${coverage}%`;
    byId("confirmed-value").textContent = "0";
    byId("uncertain-value").textContent = visualPoints.length.toLocaleString();
    byId("rejected-value").textContent = "0";
    const qualityMeter = byId<HTMLElement>("quality-meter");
    const computeMeter = byId<HTMLElement>("compute-meter");
    qualityMeter.style.width = `${qualityPercent}%`;
    computeMeter.style.width = `${Math.max(8, qualityPercent)}%`;
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
      pose.x -= motion.dx / current.width * 0.12;
      pose.y += motion.dy / current.height * 0.09;
      pose.yaw = clamp(pose.yaw - motion.dx / current.width * 0.035, -0.42, 0.42);
      pose.z += clamp(motion.parallax / current.width, 0, 0.025) * 0.018;
    }

    updateFlowOverlay(current, motion);
    const enoughTime = frameNumber - lastKeyframe >= 4;
    const usefulMotion = motion.parallax >= 0.55 && motion.quality >= 0.16 &&
      motion.inliers.length >= 8;
    if (frameNumber === 0 || (enoughTime && usefulMotion)) {
      visualPoints = appendTrackedKeyframe(
        current,
        motion,
        features,
        frameNumber,
        pose,
        visualPoints,
      );
      keyframes += 1;
      lastKeyframe = frameNumber;
      updateCloud();
    }

    previous = current;
    previousFeatures = features;
    frameNumber += 1;
    const qualityPercent = Math.round(motion.quality * 100);
    const parallaxDegrees = Math.atan2(
      motion.parallax,
      Math.max(1, current.width * 0.87),
    ) * 180 / Math.PI;
    byId("frame-count").textContent = String(frameNumber);
    byId("pose-state").textContent = `VISUAL TRACK ${qualityPercent}%`;
    byId("capture-state").textContent =
      motion.quality >= 0.16 ? "TRACKED FLOW" : "FIND TEXTURE / MOVE SLOWLY";
    byId("dispatch-time").textContent =
      `${motion.inliers.length} TRACKS / ${parallaxDegrees.toFixed(2)}° ORD`;
    updateQualityPanel(motion, parallaxDegrees);
    document.documentElement.dataset.visualTracking = motion.quality.toFixed(4);
    document.documentElement.dataset.visualParallax = parallaxDegrees.toFixed(4);
    document.documentElement.dataset.visualTracks = String(motion.inliers.length);
  };

  const render = (): void => {
    camera.position.x += (pose.x * 0.16 - camera.position.x) * 0.04;
    camera.position.y += (pose.y * 0.13 - camera.position.y) * 0.04;
    camera.lookAt(pose.x * 0.08, pose.y * 0.08, -1.22 + pose.z * 0.08);
    renderer.render(scene, camera);
    animation = requestAnimationFrame(render);
  };
  render();

  const stopPreview = (): void => {
    running = false;
    document.documentElement.dataset.visualActive = "false";
    if (timer) window.clearInterval(timer);
    timer = 0;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    video.srcObject = null;
    video.style.opacity = "0.2";
    video.style.filter = "saturate(.7) contrast(1.12)";
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
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      });
      video.srcObject = stream;
      video.style.opacity = "0.72";
      video.style.filter = "saturate(.9) contrast(1.08) brightness(.84)";
      await video.play();
      running = true;
      document.documentElement.dataset.visualActive = "true";
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
      flowGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(), 3));
      updateCloud();
      stop.disabled = false;
      stageMessage.style.display = "none";
      byId("capture-state").textContent = "TRACKED FLOW";
      sampleFrame();
      timer = window.setInterval(sampleFrame, SAMPLE_INTERVAL_MS);
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
    resizeObserver.disconnect();
    if (animation) cancelAnimationFrame(animation);
    geometry.dispose();
    flowGeometry.dispose();
    material.map?.dispose();
    material.dispose();
    flowMaterial.dispose();
    renderer.dispose();
  }, { once: true });
}
