import "./world-cell-theater.css";

const byId = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!(node instanceof HTMLElement)) throw new Error(`Missing World Cell element: ${id}`);
  return node as T;
};

interface GrayFrame {
  width: number;
  height: number;
  luma: Float32Array;
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

interface TrackSnapshot {
  width: number;
  height: number;
  tracks: Track[];
}

const SAMPLE_WIDTH = 192;
const SAMPLE_INTERVAL_MS = 100;
const MAX_VISIBLE_TRACKS = 72;
const MAX_TRACK_HISTORY = 2;

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
  return { width, height, luma };
}

function selectVisibleTracks(motion: MotionEstimate, width: number, height: number): Track[] {
  const ranked = [...motion.inliers].sort((left, right) =>
    (left.error + left.residual * 0.025) - (right.error + right.residual * 0.025));
  const cells = new Map<string, number>();
  const selected: Track[] = [];
  for (const track of ranked) {
    const column = Math.min(7, Math.max(0, Math.floor(track.bx / Math.max(1, width) * 8)));
    const row = Math.min(5, Math.max(0, Math.floor(track.by / Math.max(1, height) * 6)));
    const key = `${column}:${row}`;
    const count = cells.get(key) ?? 0;
    if (count >= 2) continue;
    cells.set(key, count + 1);
    selected.push(track);
    if (selected.length >= MAX_VISIBLE_TRACKS) break;
  }
  return selected;
}

function resizeOverlay(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const bounds = canvas.getBoundingClientRect();
  const dpr = Math.min(1.5, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(bounds.width * dpr));
  const height = Math.max(1, Math.round(bounds.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d", { alpha: true, desynchronized: true });
  context?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return context;
}

function drawTrackHistory(canvas: HTMLCanvasElement, history: TrackSnapshot[]): void {
  const context = resizeOverlay(canvas);
  if (!context) return;
  const bounds = canvas.getBoundingClientRect();
  context.clearRect(0, 0, bounds.width, bounds.height);
  context.globalCompositeOperation = "screen";
  context.lineCap = "round";
  context.lineJoin = "round";

  history.forEach((snapshot, historyIndex) => {
    const age = history.length - 1 - historyIndex;
    const alphaScale = age === 0 ? 1 : 0.22;
    const scale = Math.max(bounds.width / snapshot.width, bounds.height / snapshot.height);
    const offsetX = (bounds.width - snapshot.width * scale) / 2;
    const offsetY = (bounds.height - snapshot.height * scale) / 2;

    snapshot.tracks.forEach((track) => {
      const ax = offsetX + track.ax * scale;
      const ay = offsetY + track.ay * scale;
      const bx = offsetX + track.bx * scale;
      const by = offsetY + track.by * scale;
      const flow = Math.hypot(bx - ax, by - ay);
      const confidence = clamp(1 - track.error / 0.14, 0.15, 1);
      const structure = clamp(track.residual / 4, 0, 1);
      const lineAlpha = alphaScale * (0.12 + confidence * 0.28);
      const markerAlpha = alphaScale * (0.34 + confidence * 0.52);

      if (flow >= 0.55) {
        context.beginPath();
        context.moveTo(ax, ay);
        context.lineTo(bx, by);
        context.lineWidth = age === 0 ? 1.25 : 0.7;
        context.strokeStyle = `rgba(118,226,255,${lineAlpha.toFixed(3)})`;
        context.stroke();
      }

      context.beginPath();
      context.arc(bx, by, age === 0 ? 3.3 + structure * 0.8 : 2.1, 0, Math.PI * 2);
      context.lineWidth = age === 0 ? 1.15 : 0.7;
      context.strokeStyle = `rgba(126,231,255,${markerAlpha.toFixed(3)})`;
      context.stroke();

      if (age === 0) {
        context.beginPath();
        context.arc(bx, by, 1.15, 0, Math.PI * 2);
        context.fillStyle = `rgba(255,238,188,${(0.42 + confidence * 0.5).toFixed(3)})`;
        context.fill();
      }
    });
  });

  context.globalCompositeOperation = "source-over";
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
  const source = document.createElement("canvas");
  let stream: MediaStream | null = null;
  let running = false;
  let frameNumber = 0;
  let stableWindows = 0;
  let timer = 0;
  let previous: GrayFrame | null = null;
  let previousFeatures: Feature[] = [];
  let trackHistory: TrackSnapshot[] = [];
  let lastStableWindow = -20;
  const sourceReason = reason instanceof Error ? reason.message : String(reason);
  const keyxymState = document.documentElement.dataset.keyxymMapAuthority ?? "not-started";
  const eformState = document.documentElement.dataset.eformAuthority ?? "unavailable";

  canvas.style.pointerEvents = "none";
  canvas.style.mixBlendMode = "screen";
  document.documentElement.dataset.keyxymAuthority = "preview";
  document.documentElement.dataset.worldCellMode = "visual-preview";
  document.documentElement.dataset.visualPipeline = "tessaryn-visual-odometry-v1";
  document.documentElement.dataset.visualRenderer = "camera-first-live-tracks";
  document.documentElement.dataset.authoritativeSurfels = "0";

  byId("compute-state").textContent = "LIVE FEATURE TRACKING";
  byId("pose-state").textContent = "VISUAL TRACK READY";
  byId("cell-state").textContent = "VISUAL CELL / UNSEALED";
  byId("backend-name").textContent = "TESSARYN CAMERA TRACK OVERLAY V3";
  byId("adapter-name").textContent = "CAMERA RGB / LIVE TRACKS / NON-METRIC";
  byId("gpu-badge").textContent = "VISUAL ONLY";
  byId("rootprint").textContent = "UNSEALED";
  byId("surfel-count").textContent = "0 AUTH / 0 LIVE TRACKS";
  byId("sensor-detail").textContent =
    `The camera remains primary. Only current measured feature tracks are overlaid; no point cloud, dense depth, ` +
    `or metric geometry is inferred (keyxym_map: ${keyxymState}; eform: ${eformState}).`;

  const heading = stageMessage.querySelector("b");
  const detail = stageMessage.querySelector("span");
  if (heading) heading.textContent = "CAMERA TRACKING READY";
  if (detail) detail.textContent =
    `${sourceReason}. Camera RGB is shown directly with a bounded live tracking overlay only; ` +
    `no Moment, seal, Rootprint, or transfer can be created.`;
  stageMessage.style.display = "";

  capture.disabled = true;
  seal.disabled = true;
  send.disabled = true;
  stop.disabled = true;
  start.disabled = !navigator.mediaDevices?.getUserMedia;

  const resizeObserver = new ResizeObserver(() => drawTrackHistory(canvas, trackHistory));
  resizeObserver.observe(canvas);
  drawTrackHistory(canvas, trackHistory);

  const updateQualityPanel = (motion: MotionEstimate, parallaxDegrees: number, liveTracks: number): void => {
    const qualityPercent = Math.round(motion.quality * 100);
    const coverage = Math.round(clamp(liveTracks / MAX_VISIBLE_TRACKS, 0, 1) * 100);
    byId("tracking-value").textContent = `${qualityPercent}%`;
    byId("parallax-value").textContent = `${parallaxDegrees.toFixed(2)}°`;
    byId("coverage-value").textContent = `${coverage}%`;
    byId("confirmed-value").textContent = "0";
    byId("uncertain-value").textContent = liveTracks.toLocaleString();
    byId("rejected-value").textContent = "0";
    byId<HTMLElement>("quality-meter").style.width = `${qualityPercent}%`;
    byId<HTMLElement>("compute-meter").style.width = `${Math.max(8, qualityPercent)}%`;
  };

  const sampleFrame = (): void => {
    if (!running || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    const current = createFrame(video, source);
    if (!current) return;
    const features = detectFeatures(current);
    let motion: MotionEstimate = { dx: 0, dy: 0, parallax: 0, quality: 0, inliers: [] };
    if (previous) {
      motion = estimateMotion(trackFeatures(previous, current, previousFeatures), previousFeatures.length);
    }

    const visibleTracks = selectVisibleTracks(motion, current.width, current.height);
    if (visibleTracks.length > 0) {
      trackHistory.push({ width: current.width, height: current.height, tracks: visibleTracks });
      if (trackHistory.length > MAX_TRACK_HISTORY) trackHistory.shift();
    } else {
      trackHistory = [];
    }
    drawTrackHistory(canvas, trackHistory);

    const enoughTime = frameNumber - lastStableWindow >= 5;
    const usefulMotion = motion.parallax >= 0.55 && motion.quality >= 0.16 && visibleTracks.length >= 8;
    if (enoughTime && usefulMotion) {
      stableWindows += 1;
      lastStableWindow = frameNumber;
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
      motion.quality >= 0.16 ? "LIVE TRACKING" : "FIND TEXTURE / MOVE SLOWLY";
    byId("dispatch-time").textContent =
      `${visibleTracks.length} LIVE TRACKS / ${parallaxDegrees.toFixed(2)}° REL`;
    byId("surfel-count").textContent = `0 AUTH / ${visibleTracks.length} LIVE TRACKS`;
    updateQualityPanel(motion, parallaxDegrees, visibleTracks.length);
    document.documentElement.dataset.visualPoints = String(visibleTracks.length);
    document.documentElement.dataset.visualKeyframes = String(stableWindows);
    document.documentElement.dataset.visualTracking = motion.quality.toFixed(4);
    document.documentElement.dataset.visualParallax = parallaxDegrees.toFixed(4);
    document.documentElement.dataset.visualTracks = String(visibleTracks.length);
  };

  const stopPreview = (): void => {
    running = false;
    document.documentElement.dataset.visualActive = "false";
    if (timer) window.clearInterval(timer);
    timer = 0;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    video.srcObject = null;
    video.style.opacity = "0.2";
    video.style.filter = "saturate(.7) contrast(1.08)";
    trackHistory = [];
    drawTrackHistory(canvas, trackHistory);
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
      video.style.opacity = "1";
      video.style.filter = "saturate(1.02) contrast(1.02) brightness(.98)";
      await video.play();
      running = true;
      document.documentElement.dataset.visualActive = "true";
      frameNumber = 0;
      stableWindows = 0;
      previous = null;
      previousFeatures = [];
      trackHistory = [];
      lastStableWindow = -20;
      drawTrackHistory(canvas, trackHistory);
      stop.disabled = false;
      stageMessage.style.display = "none";
      byId("capture-state").textContent = "LIVE TRACKING";
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
  }, { once: true });
}
