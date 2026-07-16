import "./world-cell-theater.css";

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

interface KeyframePayload extends GrayFrame {
  index: number;
}

interface RelativePoint {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
  error: number;
}

interface SolveMetrics {
  keyframes: number;
  pair: [number, number];
  matches: number;
  inliers: number;
  reconstructed: number;
  positiveDepthRatio: number;
  reprojectionErrorPixels: number;
  parallaxDegrees: number;
  coverage: number;
  triangulationAngleDegrees: number;
  processingMs: number;
}

interface SolveSuccess {
  type: "result";
  ok: true;
  points: RelativePoint[];
  metrics: SolveMetrics;
}

interface SolveFailure {
  type: "result";
  ok: false;
  reason: string;
  metrics: Partial<SolveMetrics> & { keyframes: number; processingMs: number };
}

type SolveResult = SolveSuccess | SolveFailure;

const SAMPLE_WIDTH = 192;
const SAMPLE_INTERVAL_MS = 100;
const MAX_KEYFRAMES = 12;
const MIN_KEYFRAMES = 4;
const MAX_LIVE_TRACKS = 36;

const byId = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!(node instanceof HTMLElement)) throw new Error(`Missing World Cell element: ${id}`);
  return node as T;
};

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value));

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

function detectFeatures(frame: GrayFrame, maximum = 170): Feature[] {
  const candidates: Feature[] = [];
  const { width, height, luma } = frame;
  for (let y = 5; y < height - 5; y += 3) {
    for (let x = 5; x < width - 5; x += 3) {
      let xx = 0;
      let yy = 0;
      let xy = 0;
      for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
        for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
          const index = (y + offsetY) * width + x + offsetX;
          const gradientX = (luma[index + 1] ?? 0) - (luma[index - 1] ?? 0);
          const gradientY = (luma[index + width] ?? 0) - (luma[index - width] ?? 0);
          xx += gradientX * gradientX;
          yy += gradientY * gradientY;
          xy += gradientX * gradientY;
        }
      }
      const trace = xx + yy;
      const score = xx * yy - xy * xy - 0.045 * trace * trace;
      if (score > 0.0002) candidates.push({ x, y, score });
    }
  }
  candidates.sort((left, right) => right.score - left.score);
  const selected: Feature[] = [];
  for (const candidate of candidates) {
    if (selected.every((feature) => {
      const deltaX = feature.x - candidate.x;
      const deltaY = feature.y - candidate.y;
      return deltaX * deltaX + deltaY * deltaY > 44;
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
  let meanPrevious = 0;
  let meanCurrent = 0;
  let samples = 0;
  for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
    for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
      meanPrevious += previous.luma[(ay + offsetY) * previous.width + ax + offsetX] ?? 0;
      meanCurrent += current.luma[(by + offsetY) * current.width + bx + offsetX] ?? 0;
      samples += 1;
    }
  }
  meanPrevious /= samples;
  meanCurrent /= samples;
  let error = 0;
  for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
    for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
      const left = (previous.luma[(ay + offsetY) * previous.width + ax + offsetX] ?? 0) -
        meanPrevious;
      const right = (current.luma[(by + offsetY) * current.width + bx + offsetX] ?? 0) -
        meanCurrent;
      error += Math.abs(left - right);
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
    for (let offsetY = -8; offsetY <= 8; offsetY += 2) {
      for (let offsetX = -8; offsetX <= 8; offsetX += 2) {
        const x = feature.x + offsetX;
        const y = feature.y + offsetY;
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
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        const x = coarseX + offsetX;
        const y = coarseY + offsetY;
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
      (image.data[offset] ?? 0) * 0.2126 +
      (image.data[offset + 1] ?? 0) * 0.7152 +
      (image.data[offset + 2] ?? 0) * 0.0722
    ) / 255;
  }
  return { width, height, luma, rgba: new Uint8ClampedArray(image.data) };
}

function spatialCoverage(tracks: Track[], width: number, height: number): number {
  const occupied = new Set<string>();
  for (const track of tracks) {
    const column = Math.min(5, Math.max(0, Math.floor(track.bx / Math.max(1, width) * 6)));
    const row = Math.min(3, Math.max(0, Math.floor(track.by / Math.max(1, height) * 4)));
    occupied.add(`${column}:${row}`);
  }
  return occupied.size / 24;
}

function resizeCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
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

function coverTransform(
  canvas: HTMLCanvasElement,
  frameWidth: number,
  frameHeight: number,
): { scale: number; offsetX: number; offsetY: number } {
  const bounds = canvas.getBoundingClientRect();
  const scale = Math.max(bounds.width / frameWidth, bounds.height / frameHeight);
  return {
    scale,
    offsetX: (bounds.width - frameWidth * scale) / 2,
    offsetY: (bounds.height - frameHeight * scale) / 2,
  };
}

function drawLiveTracks(canvas: HTMLCanvasElement, frame: GrayFrame, tracks: Track[]): void {
  const context = resizeCanvas(canvas);
  if (!context) return;
  const bounds = canvas.getBoundingClientRect();
  context.clearRect(0, 0, bounds.width, bounds.height);
  const transform = coverTransform(canvas, frame.width, frame.height);
  const visible = [...tracks]
    .sort((left, right) => (left.error + left.residual * 0.03) -
      (right.error + right.residual * 0.03))
    .slice(0, MAX_LIVE_TRACKS);
  context.lineCap = "round";
  for (const track of visible) {
    const ax = transform.offsetX + track.ax * transform.scale;
    const ay = transform.offsetY + track.ay * transform.scale;
    const bx = transform.offsetX + track.bx * transform.scale;
    const by = transform.offsetY + track.by * transform.scale;
    const confidence = clamp(1 - track.error / 0.14, 0.1, 1);
    if (Math.hypot(bx - ax, by - ay) >= 1) {
      context.beginPath();
      context.moveTo(ax, ay);
      context.lineTo(bx, by);
      context.lineWidth = 1;
      context.strokeStyle = `rgba(104,220,255,${(0.12 + confidence * 0.22).toFixed(3)})`;
      context.stroke();
    }
    context.beginPath();
    context.arc(bx, by, 2.4, 0, Math.PI * 2);
    context.lineWidth = 1;
    context.strokeStyle = `rgba(135,232,255,${(0.32 + confidence * 0.5).toFixed(3)})`;
    context.stroke();
  }
}

function clearCanvas(canvas: HTMLCanvasElement): void {
  const context = resizeCanvas(canvas);
  if (!context) return;
  const bounds = canvas.getBoundingClientRect();
  context.clearRect(0, 0, bounds.width, bounds.height);
}

function setText(id: string, text: string): void {
  byId(id).textContent = text;
}

function setMeter(id: string, value: number): void {
  byId(id).style.width = `${clamp(value, 0, 100)}%`;
}

function setStageMessage(heading: string, detail: string, visible: boolean): void {
  const message = byId("stage-message");
  const headingNode = message.querySelector("b");
  const detailNode = message.querySelector("span");
  if (headingNode) headingNode.textContent = heading;
  if (detailNode) detailNode.textContent = detail;
  message.style.display = visible ? "" : "none";
}

function formatFailureReason(result: SolveFailure): string {
  const metrics = result.metrics;
  const measurements = [
    Number.isFinite(metrics.matches) ? `${metrics.matches} matches` : null,
    Number.isFinite(metrics.inliers) ? `${metrics.inliers} inliers` : null,
    Number.isFinite(metrics.parallaxDegrees) ? `${Number(metrics.parallaxDegrees).toFixed(2)}° parallax` : null,
    Number.isFinite(metrics.reprojectionErrorPixels) ?
      `${Number(metrics.reprojectionErrorPixels).toFixed(2)} px reprojection error` : null,
  ].filter((value): value is string => value !== null);
  return `${result.reason}${measurements.length > 0 ? ` (${measurements.join(", ")})` : ""}`;
}

export function installWorldCellPreviewFallback(reason: unknown): void {
  const video = byId<HTMLVideoElement>("camera");
  const canvas = byId<HTMLCanvasElement>("stage");
  const start = byId<HTMLButtonElement>("start-button");
  const solveButton = byId<HTMLButtonElement>("capture-button");
  const stop = byId<HTMLButtonElement>("stop-button");
  const seal = byId<HTMLButtonElement>("seal-button");
  const send = byId<HTMLButtonElement>("send-button");
  const source = document.createElement("canvas");
  let stream: MediaStream | null = null;
  let running = false;
  let solving = false;
  let frameNumber = 0;
  let timer = 0;
  let previous: GrayFrame | null = null;
  let previousFeatures: Feature[] = [];
  let keyframes: KeyframePayload[] = [];
  let lastKeyframeFrame = -100;
  let resultAnimation = 0;
  let resultPoints: RelativePoint[] = [];
  let evidence: Record<string, unknown> = {};
  const sourceReason = reason instanceof Error ? reason.message : String(reason);
  const keyxymState = document.documentElement.dataset.keyxymMapAuthority ?? "adapter-required";
  const eformState = document.documentElement.dataset.eformAuthority ?? "not-requested";

  const geometryLabel = document.querySelector<HTMLElement>(".stage-hud span:first-child small");
  if (geometryLabel) geometryLabel.textContent = "RELATIVE GEOMETRY";
  canvas.style.pointerEvents = "none";
  canvas.style.mixBlendMode = "screen";
  document.documentElement.dataset.keyxymAuthority = "preview";
  document.documentElement.dataset.worldCellMode = "visual-preview";
  document.documentElement.dataset.visualPipeline = "tessaryn-world-cell-scan-v4";
  document.documentElement.dataset.visualRenderer = "world-cell-scan-v4";
  document.documentElement.dataset.authoritativeSurfels = "0";
  document.documentElement.dataset.scanVersion = "4";
  document.documentElement.dataset.scanState = "ready";
  document.documentElement.dataset.scanPoints = "0";

  setText("capture-state", "SCAN READY");
  setText("compute-state", "MULTI-VIEW");
  setText("pose-state", "MOVE SIDEWAYS");
  setText("cell-state", "WORLD CELL SCAN / READY");
  setText("backend-name", "TESSARYN MULTI-VIEW SOLVER V4");
  setText("adapter-name", "CAMERA RGB / SCALE-FREE / NON-AUTH");
  setText("gpu-badge", "RELATIVE ONLY");
  setText("rootprint", "UNSEALED");
  setText("surfel-count", "0 AUTH / 0 REL PTS");
  setText("frame-count", "0");
  setText("tracking-value", "0%");
  setText("parallax-value", "0.00°");
  setText("error-value", "—");
  setText("coverage-value", "0%");
  setText("confirmed-value", "0");
  setText("uncertain-value", "0");
  setText("rejected-value", "0");
  setText("scale-value", "RELATIVE");
  setText("dispatch-time", "NO SCAN");
  setText("sensor-detail",
    `Capture four to twelve translated views. Geometry appears only after essential-matrix, positive-depth, ` +
    `triangulation-angle, coverage, and reprojection checks pass. Authority remains locked ` +
    `(keyxym_map: ${keyxymState}; eform: ${eformState}).`);
  setStageMessage(
    "WORLD CELL SCAN V4 READY",
    `${sourceReason}. Move sideways around a textured subject, then finish the scan. ` +
      `No geometry is displayed unless multi-view triangulation passes acceptance checks.`,
    true,
  );

  start.textContent = "START WORLD CELL SCAN";
  start.disabled = !navigator.mediaDevices?.getUserMedia;
  solveButton.textContent = "FINISH & SOLVE";
  solveButton.disabled = true;
  stop.textContent = "CANCEL SCAN";
  stop.disabled = true;
  seal.disabled = true;
  seal.textContent = "METRIC AUTHORITY REQUIRED";
  send.disabled = true;
  for (const id of ["host-button", "join-button", "answer-button", "prev-button", "play-button", "next-button"]) {
    const control = document.getElementById(id);
    if (control instanceof HTMLButtonElement) control.disabled = true;
  }

  const stopStream = (): void => {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    video.srcObject = null;
  };

  const stopSampling = (): void => {
    running = false;
    document.documentElement.dataset.visualActive = "false";
    if (timer) window.clearInterval(timer);
    timer = 0;
  };

  const stopResultAnimation = (): void => {
    if (resultAnimation) cancelAnimationFrame(resultAnimation);
    resultAnimation = 0;
  };

  const renderResult = (timestamp: number): void => {
    const context = resizeCanvas(canvas);
    if (!context) return;
    const bounds = canvas.getBoundingClientRect();
    context.globalCompositeOperation = "source-over";
    context.fillStyle = "rgba(2,7,12,.94)";
    context.fillRect(0, 0, bounds.width, bounds.height);
    const yaw = timestamp * 0.00018;
    const pitch = -0.16;
    const cosineYaw = Math.cos(yaw);
    const sineYaw = Math.sin(yaw);
    const cosinePitch = Math.cos(pitch);
    const sinePitch = Math.sin(pitch);
    const projected = resultPoints.map((point) => {
      const rotatedX = cosineYaw * point.x - sineYaw * point.z;
      const yawZ = sineYaw * point.x + cosineYaw * point.z;
      const rotatedY = cosinePitch * point.y - sinePitch * yawZ;
      const rotatedZ = sinePitch * point.y + cosinePitch * yawZ;
      const depth = rotatedZ + 4.2;
      const scale = Math.min(bounds.width, bounds.height) * 0.52 / Math.max(1.2, depth);
      return {
        x: bounds.width / 2 + rotatedX * scale,
        y: bounds.height / 2 - rotatedY * scale,
        depth,
        point,
      };
    }).sort((left, right) => right.depth - left.depth);
    for (const item of projected) {
      if (item.depth <= 0.5) continue;
      const alpha = clamp(0.95 - item.point.error * 0.12, 0.22, 0.92);
      const red = Math.round(clamp(item.point.r, 0, 1) * 255);
      const green = Math.round(clamp(item.point.g, 0, 1) * 255);
      const blue = Math.round(clamp(item.point.b, 0, 1) * 255);
      context.beginPath();
      context.arc(item.x, item.y, clamp(3.6 / item.depth + 1.2, 1.3, 3.8), 0, Math.PI * 2);
      context.fillStyle = `rgba(${red},${green},${blue},${alpha.toFixed(3)})`;
      context.fill();
    }
    context.fillStyle = "rgba(208,237,248,.76)";
    context.font = "600 11px ui-monospace, monospace";
    context.fillText(`RELATIVE / SCALE-FREE / ${resultPoints.length} TRIANGULATED POINTS`, 18, bounds.height - 20);
    resultAnimation = requestAnimationFrame(renderResult);
  };

  const updateEvidence = (payload: Record<string, unknown>): void => {
    evidence = {
      schema: "tessaryn/world-cell-scan-evidence/v4",
      createdAtUnixMs: Date.now(),
      authority: {
        authoritative: false,
        metric: false,
        momentAllowed: false,
        sealAllowed: false,
        rootprintAllowed: false,
      },
      ...payload,
    };
    byId("evidence-log").textContent = JSON.stringify(evidence, null, 2);
  };

  const captureKeyframe = (frame: GrayFrame): void => {
    if (keyframes.length >= MAX_KEYFRAMES) return;
    keyframes.push({
      index: frameNumber,
      width: frame.width,
      height: frame.height,
      luma: new Float32Array(frame.luma),
      rgba: new Uint8ClampedArray(frame.rgba),
    });
    lastKeyframeFrame = frameNumber;
    solveButton.disabled = keyframes.length < MIN_KEYFRAMES;
    solveButton.textContent = keyframes.length >= MIN_KEYFRAMES ?
      `FINISH & SOLVE ${keyframes.length} VIEWS` :
      `CAPTURE ${MIN_KEYFRAMES - keyframes.length} MORE VIEWS`;
    setText("pose-state", `CAPTURING ${keyframes.length}/${MAX_KEYFRAMES} VIEWS`);
    document.documentElement.dataset.scanViews = String(keyframes.length);
  };

  const sampleFrame = (): void => {
    if (!running || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    const current = createFrame(video, source);
    if (!current) return;
    const features = detectFeatures(current);
    let motion: MotionEstimate = { dx: 0, dy: 0, parallax: 0, quality: 0, inliers: [] };
    if (previous) motion = estimateMotion(trackFeatures(previous, current, previousFeatures), previousFeatures.length);
    const coverage = spatialCoverage(motion.inliers, current.width, current.height);
    drawLiveTracks(canvas, current, motion.inliers);
    const enoughTime = frameNumber - lastKeyframeFrame >= 6;
    const usefulView = motion.quality >= 0.16 && motion.inliers.length >= 12 &&
      motion.parallax >= 0.7 && motion.parallax <= 18 && coverage >= 0.2;
    if (keyframes.length === 0 || (enoughTime && usefulView)) captureKeyframe(current);
    previous = current;
    previousFeatures = features;
    frameNumber += 1;
    const qualityPercent = Math.round(motion.quality * 100);
    const parallaxDegrees = Math.atan2(motion.parallax, Math.max(1, current.width * 0.9)) * 180 / Math.PI;
    setText("frame-count", String(frameNumber));
    setText("tracking-value", `${qualityPercent}%`);
    setText("parallax-value", `${parallaxDegrees.toFixed(2)}°`);
    setText("coverage-value", `${Math.round(coverage * 100)}%`);
    setText("confirmed-value", "0");
    setText("uncertain-value", String(motion.inliers.length));
    setText("rejected-value", String(Math.max(0, previousFeatures.length - motion.inliers.length)));
    setText("capture-state", usefulView ? "CAPTURING VIEWS" : "MOVE SIDEWAYS / FIND TEXTURE");
    setText("compute-state", "KEYFRAME SELECTION");
    setText("dispatch-time", `${motion.inliers.length} TRACKS / ${keyframes.length} VIEWS`);
    setMeter("quality-meter", qualityPercent);
    setMeter("compute-meter", keyframes.length / MAX_KEYFRAMES * 100);
    document.documentElement.dataset.visualTracking = motion.quality.toFixed(4);
    document.documentElement.dataset.visualParallax = parallaxDegrees.toFixed(4);
    document.documentElement.dataset.visualTracks = String(motion.inliers.length);
  };

  const resetReadyState = (message = true): void => {
    stopSampling();
    stopStream();
    stopResultAnimation();
    resultPoints = [];
    keyframes = [];
    previous = null;
    previousFeatures = [];
    frameNumber = 0;
    lastKeyframeFrame = -100;
    solving = false;
    clearCanvas(canvas);
    video.style.opacity = "0.2";
    video.style.filter = "saturate(.75) contrast(1.08)";
    canvas.style.mixBlendMode = "screen";
    document.documentElement.dataset.scanState = "ready";
    document.documentElement.dataset.scanPoints = "0";
    document.documentElement.dataset.scanViews = "0";
    start.textContent = "START WORLD CELL SCAN";
    start.disabled = !navigator.mediaDevices?.getUserMedia;
    solveButton.textContent = "FINISH & SOLVE";
    solveButton.disabled = true;
    stop.disabled = true;
    setText("capture-state", "SCAN READY");
    setText("compute-state", "MULTI-VIEW");
    setText("pose-state", "MOVE SIDEWAYS");
    setText("cell-state", "WORLD CELL SCAN / READY");
    setText("surfel-count", "0 AUTH / 0 REL PTS");
    setText("frame-count", "0");
    setText("dispatch-time", "NO SCAN");
    setText("error-value", "—");
    setMeter("quality-meter", 0);
    setMeter("compute-meter", 0);
    if (message) setStageMessage(
      "WORLD CELL SCAN V4 READY",
      "Move sideways around a textured subject. Finish only after at least four distinct views are captured.",
      true,
    );
  };

  const solveScan = async (): Promise<void> => {
    if (solving || keyframes.length < MIN_KEYFRAMES) return;
    solving = true;
    stopSampling();
    solveButton.disabled = true;
    stop.disabled = true;
    start.disabled = true;
    document.documentElement.dataset.scanState = "solving";
    setText("capture-state", "SOLVING GEOMETRY");
    setText("compute-state", "ESSENTIAL MATRIX + TRIANGULATION");
    setText("pose-state", `SOLVING ${keyframes.length} VIEWS`);
    setText("gpu-badge", "WORKER ACTIVE");
    setMeter("compute-meter", 76);
    clearCanvas(canvas);
    setStageMessage(
      "SOLVING RELATIVE GEOMETRY",
      "Selecting a baseline pair, rejecting outliers, recovering relative pose, triangulating, and checking reprojection error.",
      true,
    );
    const frames = keyframes;
    keyframes = [];
    const worker = new Worker(new URL("./world-cell-scan-v4-worker.ts", import.meta.url), { type: "module" });
    let timeout = 0;
    const result = await new Promise<SolveResult>((resolve) => {
      const finish = (value: SolveResult): void => {
        if (timeout) window.clearTimeout(timeout);
        worker.terminate();
        resolve(value);
      };
      worker.onmessage = (event: MessageEvent<SolveResult>) => finish(event.data);
      worker.onerror = (event) => finish({
        type: "result",
        ok: false,
        reason: event.message || "The scan worker did not complete.",
        metrics: { keyframes: frames.length, processingMs: 0 },
      });
      timeout = window.setTimeout(() => finish({
        type: "result",
        ok: false,
        reason: "The scan worker exceeded the 20 second processing limit.",
        metrics: { keyframes: frames.length, processingMs: 20_000 },
      }), 20_000);
      const transfers: Transferable[] = [];
      for (const frame of frames) transfers.push(frame.luma.buffer, frame.rgba.buffer);
      worker.postMessage({ type: "solve", frames }, transfers);
    });
    stopStream();
    solving = false;
    start.disabled = false;
    stop.disabled = true;
    if (result.ok) {
      resultPoints = result.points;
      canvas.style.mixBlendMode = "normal";
      video.style.opacity = "0.1";
      video.style.filter = "saturate(.65) contrast(1.05)";
      document.documentElement.dataset.scanState = "reconstructed";
      document.documentElement.dataset.scanResult = "relative-sparse-reconstruction";
      document.documentElement.dataset.scanPoints = String(result.points.length);
      document.documentElement.dataset.scanInliers = String(result.metrics.inliers);
      document.documentElement.dataset.scanReprojectionError =
        result.metrics.reprojectionErrorPixels.toFixed(4);
      setText("capture-state", "RELATIVE SCAN COMPLETE");
      setText("compute-state", "GEOMETRY ACCEPTED");
      setText("pose-state", "RELATIVE SOLVE");
      setText("cell-state", "WORLD CELL SCAN / RELATIVE / UNSEALED");
      setText("backend-name", "TESSARYN TWO-VIEW SFM V4");
      setText("adapter-name", "CAMERA RGB / TRIANGULATED / SCALE-FREE");
      setText("gpu-badge", "RELATIVE SOLVE");
      setText("surfel-count", `0 AUTH / ${result.points.length.toLocaleString()} REL PTS`);
      setText("frame-count", String(result.metrics.keyframes));
      setText("tracking-value", `${Math.round(result.metrics.inliers / Math.max(1, result.metrics.matches) * 100)}%`);
      setText("parallax-value", `${result.metrics.parallaxDegrees.toFixed(2)}°`);
      setText("error-value", `${result.metrics.reprojectionErrorPixels.toFixed(2)} px`);
      setText("coverage-value", `${Math.round(result.metrics.coverage * 100)}%`);
      setText("confirmed-value", "0");
      setText("uncertain-value", result.points.length.toLocaleString());
      setText("rejected-value", String(Math.max(0, result.metrics.matches - result.metrics.inliers)));
      setText("dispatch-time", `${result.metrics.processingMs.toFixed(1)} ms / worker`);
      setMeter("quality-meter", clamp(
        100 - result.metrics.reprojectionErrorPixels * 18 + result.metrics.coverage * 20,
        0,
        100,
      ));
      setMeter("compute-meter", 100);
      start.textContent = "NEW SCAN";
      solveButton.textContent = "SOLVE COMPLETE";
      solveButton.disabled = true;
      setStageMessage("", "", false);
      updateEvidence({
        state: "accepted-relative-reconstruction",
        renderer: "world-cell-scan-v4",
        metrics: result.metrics,
        relativePointCount: result.points.length,
      });
      resultAnimation = requestAnimationFrame(renderResult);
    } else {
      resultPoints = [];
      canvas.style.mixBlendMode = "screen";
      video.style.opacity = "1";
      video.style.filter = "saturate(1.02) contrast(1.02) brightness(.98)";
      clearCanvas(canvas);
      document.documentElement.dataset.scanState = "rejected";
      document.documentElement.dataset.scanResult = "no-geometry";
      document.documentElement.dataset.scanPoints = "0";
      setText("capture-state", "SCAN REJECTED");
      setText("compute-state", "NO GEOMETRY CREATED");
      setText("pose-state", "RESCAN REQUIRED");
      setText("cell-state", "WORLD CELL SCAN / NO GEOMETRY");
      setText("gpu-badge", "REJECTED");
      setText("surfel-count", "0 AUTH / 0 REL PTS");
      setText("error-value", Number.isFinite(result.metrics.reprojectionErrorPixels) ?
        `${Number(result.metrics.reprojectionErrorPixels).toFixed(2)} px` : "—");
      setText("dispatch-time", `${result.metrics.processingMs.toFixed(1)} ms / worker`);
      setMeter("compute-meter", 0);
      start.textContent = "RESCAN";
      solveButton.textContent = "NO GEOMETRY";
      solveButton.disabled = true;
      const failure = formatFailureReason(result);
      setStageMessage(
        "NO DEFENSIBLE GEOMETRY",
        `${failure}. No point cloud, Moment, seal, or Rootprint was created. Rescan with slow sideways motion and textured surfaces.`,
        true,
      );
      updateEvidence({
        state: "rejected-no-geometry",
        renderer: "world-cell-scan-v4",
        reason: result.reason,
        metrics: result.metrics,
      });
    }
  };

  start.onclick = async (): Promise<void> => {
    if (document.documentElement.dataset.scanState === "reconstructed" ||
        document.documentElement.dataset.scanState === "rejected") resetReadyState(false);
    start.disabled = true;
    solveButton.disabled = true;
    stop.disabled = true;
    setText("capture-state", "REQUESTING CAMERA");
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
      frameNumber = 0;
      previous = null;
      previousFeatures = [];
      keyframes = [];
      lastKeyframeFrame = -100;
      resultPoints = [];
      stopResultAnimation();
      canvas.style.mixBlendMode = "screen";
      clearCanvas(canvas);
      document.documentElement.dataset.visualActive = "true";
      document.documentElement.dataset.scanState = "capturing";
      document.documentElement.dataset.scanPoints = "0";
      document.documentElement.dataset.scanViews = "0";
      solveButton.textContent = `CAPTURE ${MIN_KEYFRAMES} MORE VIEWS`;
      stop.disabled = false;
      setText("capture-state", "CAPTURING VIEWS");
      setText("compute-state", "KEYFRAME SELECTION");
      setText("pose-state", `CAPTURING 0/${MAX_KEYFRAMES} VIEWS`);
      setText("cell-state", "WORLD CELL SCAN / CAPTURING");
      setText("gpu-badge", "CAMERA ACTIVE");
      setStageMessage("", "", false);
      sampleFrame();
      timer = window.setInterval(sampleFrame, SAMPLE_INTERVAL_MS);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      resetReadyState(false);
      setText("capture-state", "CAMERA UNAVAILABLE");
      setStageMessage(
        "CAMERA UNAVAILABLE",
        `${detail}. No evidence or geometry was created.`,
        true,
      );
    }
  };

  solveButton.onclick = () => void solveScan();
  stop.onclick = () => resetReadyState();
  byId<HTMLButtonElement>("reset-button").onclick = () => resetReadyState();

  const showDialog = (id: string): void => {
    const dialog = document.getElementById(id);
    if (dialog instanceof HTMLDialogElement) dialog.showModal();
  };
  byId<HTMLButtonElement>("sensor-button").onclick = () => showDialog("sensor-dialog");
  byId<HTMLButtonElement>("calibrate-button").onclick = () => showDialog("calibration-dialog");
  byId<HTMLButtonElement>("evidence-button").onclick = () => showDialog("evidence-dialog");
  document.querySelectorAll<HTMLElement>("[data-close]").forEach((control) => {
    control.onclick = () => {
      const target = control.dataset.close;
      const dialog = target ? document.getElementById(target) : null;
      if (dialog instanceof HTMLDialogElement) dialog.close();
    };
  });

  const resizeObserver = new ResizeObserver(() => {
    if (resultPoints.length > 0 && !resultAnimation) resultAnimation = requestAnimationFrame(renderResult);
    else if (!running) clearCanvas(canvas);
  });
  resizeObserver.observe(canvas);
  updateEvidence({
    state: "ready",
    renderer: "world-cell-scan-v4",
    sourceReason,
  });

  window.addEventListener("beforeunload", () => {
    stopSampling();
    stopStream();
    stopResultAnimation();
    resizeObserver.disconnect();
  }, { once: true });
}
