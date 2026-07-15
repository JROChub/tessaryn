import { sha256 } from "@noble/hashes/sha2.js";
import {
  KeyxymV22Runtime,
  type KeyxymFeature,
  type KeyxymPoseEstimate,
  type KeyxymQuality,
  type KeyxymSurfel,
} from "./keyxym-v22-runtime";

const WIDTH = 160;
const MIN_TRACKING = 0.55;
const MIN_PARALLAX_DEGREES = 1;
const MAX_REPROJECTION_ERROR = 3;
const MIN_CONFIRMED = 256;
const encoder = new TextEncoder();

interface SampledFrame {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  gray: Float32Array;
  rgb: Float32Array;
  commitment: Uint8Array;
}

interface AuthorityState {
  runtime: KeyxymV22Runtime | null;
  pose: KeyxymPoseEstimate | null;
  quality: KeyxymQuality | null;
  geometry: KeyxymSurfel[];
  previous: SampledFrame | null;
  previousFeatures: Array<{ id: number; x: number; y: number; score: number }>;
  processing: boolean;
  failure: string | null;
}

const state: AuthorityState = {
  runtime: null,
  pose: null,
  quality: null,
  geometry: [],
  previous: null,
  previousFeatures: [],
  processing: false,
  failure: null,
};

function element<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function text(id: string, value: string): void {
  const target = element(id);
  if (target) target.textContent = value;
}

function disable(id: string, value: boolean): void {
  const target = element<HTMLButtonElement>(id);
  if (target) target.disabled = value;
}

function sample(video: HTMLVideoElement): SampledFrame {
  const ratio = video.videoWidth > 0 ? video.videoHeight / video.videoWidth : 0.75;
  const height = Math.max(90, Math.round(WIDTH * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Authoritative capture context unavailable");
  context.drawImage(video, 0, 0, WIDTH, height);
  const image = context.getImageData(0, 0, WIDTH, height);
  const gray = new Float32Array(WIDTH * height);
  const rgb = new Float32Array(WIDTH * height * 3);
  for (let index = 0; index < gray.length; index += 1) {
    const source = index * 4;
    const target = index * 3;
    const r = image.data[source]! / 255;
    const g = image.data[source + 1]! / 255;
    const b = image.data[source + 2]! / 255;
    gray[index] = r * 0.2126 + g * 0.7152 + b * 0.0722;
    rgb[target] = r;
    rgb[target + 1] = g;
    rgb[target + 2] = b;
  }
  return {
    width: WIDTH,
    height,
    rgba: image.data,
    gray,
    rgb,
    commitment: sha256(image.data),
  };
}

function detect(frame: SampledFrame, maximum = 420) {
  const candidates: Array<{ id: number; x: number; y: number; score: number }> = [];
  for (let y = 3; y < frame.height - 3; y += 2) {
    for (let x = 3; x < frame.width - 3; x += 2) {
      const index = y * frame.width + x;
      const gx = frame.gray[index + 1]! - frame.gray[index - 1]!;
      const gy = frame.gray[index + frame.width]! - frame.gray[index - frame.width]!;
      const diagonalA = frame.gray[index + frame.width + 1]! - frame.gray[index - frame.width - 1]!;
      const diagonalB = frame.gray[index + frame.width - 1]! - frame.gray[index - frame.width + 1]!;
      const score = gx * gx + gy * gy + 0.5 * (diagonalA * diagonalA + diagonalB * diagonalB);
      if (score > 0.018) candidates.push({ id: 0, x, y, score });
    }
  }
  candidates.sort((left, right) => right.score - left.score);
  const selected: typeof candidates = [];
  for (const candidate of candidates) {
    if (selected.every((other) => Math.hypot(other.x - candidate.x, other.y - candidate.y) >= 6)) {
      candidate.id = selected.length + 1;
      selected.push(candidate);
      if (selected.length >= maximum) break;
    }
  }
  return selected;
}

function patchError(
  previous: SampledFrame,
  current: SampledFrame,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  let error = 0;
  let count = 0;
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      const a = previous.gray[(ay + dy) * previous.width + ax + dx]!;
      const b = current.gray[(by + dy) * current.width + bx + dx]!;
      error += Math.abs(a - b);
      count += 1;
    }
  }
  return error / count;
}

function correspond(
  previous: SampledFrame,
  current: SampledFrame,
  features: AuthorityState["previousFeatures"],
): KeyxymFeature[] {
  const matches: KeyxymFeature[] = [];
  for (const feature of features) {
    let bestError = Number.POSITIVE_INFINITY;
    let secondError = Number.POSITIVE_INFINITY;
    let bestX = feature.x;
    let bestY = feature.y;
    for (let dy = -12; dy <= 12; dy += 2) {
      for (let dx = -12; dx <= 12; dx += 2) {
        const x = feature.x + dx;
        const y = feature.y + dy;
        if (x < 3 || y < 3 || x >= current.width - 3 || y >= current.height - 3) continue;
        const error = patchError(previous, current, feature.x, feature.y, x, y);
        if (error < bestError) {
          secondError = bestError;
          bestError = error;
          bestX = x;
          bestY = y;
        } else if (error < secondError) {
          secondError = error;
        }
      }
    }
    if (bestError > 0.12 || bestError > secondError * 0.92) continue;
    matches.push({
      id: feature.id,
      x: bestX,
      y: bestY,
      score: feature.score,
      disparity: Math.hypot(bestX - feature.x, bestY - feature.y),
      matchError: bestError,
    });
  }
  return matches;
}

function sealable(): boolean {
  const quality = state.quality;
  const pose = state.pose;
  if (!state.runtime || !quality || !pose || !pose.recovered) return false;
  return quality.tracking >= MIN_TRACKING &&
    quality.parallaxDegrees >= MIN_PARALLAX_DEGREES &&
    Number.isFinite(quality.reprojectionErrorPixels) &&
    quality.reprojectionErrorPixels <= MAX_REPROJECTION_ERROR &&
    quality.confirmed >= MIN_CONFIRMED &&
    state.geometry.some((surfel) => surfel.observations >= 2 && surfel.sourceKeyframe >= 0) &&
    state.geometry.every((surfel) => Number.isFinite(surfel.uncertainty));
}

function updateInterface(): void {
  const quality = state.quality;
  if (!quality) {
    text("pose-state", state.failure ? "AUTHORITY OFFLINE" : "AUTHORITY LOADING");
    text("cell-state", "VISUAL PREVIEW / UNSEALED");
    disable("seal-button", true);
    return;
  }
  text("tracking-value", `${Math.round(quality.tracking * 100)}%`);
  text("parallax-value", `${quality.parallaxDegrees.toFixed(2)}°`);
  text("error-value", Number.isFinite(quality.reprojectionErrorPixels)
    ? `${quality.reprojectionErrorPixels.toFixed(2)} px`
    : "—");
  text("coverage-value", `${Math.round(quality.coverage * 100)}%`);
  text("confirmed-value", Math.round(quality.confirmed).toLocaleString());
  text("uncertain-value", Math.round(quality.uncertain).toLocaleString());
  text("rejected-value", Math.round(quality.rejected).toLocaleString());
  text("scale-value", quality.metricScale ? "METRIC / SENSOR" : "RELATIVE / UNSEALED");
  text("pose-state", state.pose?.recovered ? "KEYXYM POSE SOLVED" : "TRACKING LOST");
  text("backend-name", "KEYXYM V0.22 WASM");
  disable("seal-button", !sealable());
  if (!sealable()) text("cell-state", "VISUAL PREVIEW / UNSEALED");
}

async function process(video: HTMLVideoElement): Promise<void> {
  if (!state.runtime || state.processing || video.readyState < 2) return;
  state.processing = true;
  try {
    const current = sample(video);
    if (!state.previous) {
      state.previous = current;
      state.previousFeatures = detect(current);
      return;
    }
    const features = correspond(state.previous, current, state.previousFeatures);
    const focal = current.width * 0.82;
    state.pose = state.runtime.ingest({
      timestampNs: BigInt(Math.round(performance.timeOrigin * 1_000_000 + performance.now() * 1_000_000)),
      width: current.width,
      height: current.height,
      fx: focal,
      fy: focal,
      cx: current.width / 2,
      cy: current.height / 2,
      scaleMetersPerUnit: 1,
      metricScale: false,
      rgb: current.rgb,
      features,
      sourceCommitment: current.commitment,
    });
    state.quality = state.runtime.quality();
    if (state.pose.recovered && state.pose.tracking >= 0.35) {
      state.geometry = state.runtime.geometry();
      state.previous = current;
      state.previousFeatures = detect(current);
    }
    updateInterface();
    window.dispatchEvent(new CustomEvent("tessaryn:keyxym-v22", {
      detail: { pose: state.pose, quality: state.quality, geometry: state.geometry },
    }));
  } catch (error) {
    state.failure = error instanceof Error ? error.message : String(error);
    updateInterface();
  } finally {
    state.processing = false;
  }
}

function rejectUnprovenAction(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const control = target.closest("#seal-button, #send-button");
  if (!control || sealable()) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  text("cell-state", "REJECTED / INSUFFICIENT GEOMETRIC EVIDENCE");
  text("rootprint", "UNSEALED");
}

async function install(): Promise<void> {
  document.addEventListener("click", rejectUnprovenAction, true);
  disable("seal-button", true);
  disable("send-button", true);
  text("cell-state", "VISUAL PREVIEW / UNSEALED");
  try {
    state.runtime = await KeyxymV22Runtime.load();
    text("backend-name", "KEYXYM V0.22 WASM");
    text("pose-state", "KEYXYM READY");
  } catch (error) {
    state.failure = error instanceof Error ? error.message : String(error);
    text("backend-name", "PREVIEW ONLY");
    updateInterface();
  }
  const video = element<HTMLVideoElement>("camera");
  if (!video) return;
  window.setInterval(() => void process(video), 180);
  window.addEventListener("beforeunload", () => state.runtime?.destroy(), { once: true });
}

queueMicrotask(() => void install());
