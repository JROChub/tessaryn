import type {
  CellManifest,
  DemoCell,
  DemoMoment,
  DemoWorld,
  Digest,
  PhaArtifact,
  Rootprint,
  RootprintBranch,
  SdfVoxelPoint,
  SurfelPoint,
} from "./types";
import type { LocalFileIdentity } from "./local-file-identity";
import type { TemporalObservation } from "./world";
import {
  calculateCellId,
  calculateJsonChunkCommitment,
  calculateMemoryCapsuleDigest,
  calculateMemoryCoreDigest,
  calculatePhaFingerprint,
  calculateRootprintBranchId,
  calculateRootprintReplay,
  calculateSemanticDigest,
  calculateSidecarDigest,
  verifyGeneratedMemoryCapsule,
} from "./verification";

const MODEL_ID = "onnx-community/depth-anything-v2-small";
const MODEL_REVISION = "413ce838e669ab7dfc01a6a396bf3d4397286d7f";
const MODEL_SHA256 =
  "sha256:5d55b02762e1907589158af3e366bd61ddf648155852a07bbf5e3a074639fcf8";
const RUNTIME_SHA256 =
  "sha256:c46655e8a94afc45338d4cb2b840475f88e5012d524509916e505079c00bfa39";
const ZERO_DIGEST = `sha256:${"0".repeat(64)}` as Digest;
const FRAME_COUNT = 9;
const FRAME_LONG_EDGE = 768;
const TARGET_SURFELS_PER_FRAME = 60_000;
const FIELD_VOXEL_UM = 180_000;

export type ReconstructionPhase =
  | "decode"
  | "model"
  | "depth"
  | "motion"
  | "cells"
  | "verify"
  | "complete";

export interface VideoReconstructionProgress {
  phase: ReconstructionPhase;
  progress: number;
  detail: string;
}

export interface VideoReconstructionSource {
  name: string;
  mediaType: string;
  bytes: number;
  width: number;
  height: number;
  durationMs: number;
  streamRoot: Digest;
}

export interface VideoReconstructionProfile {
  schema: "tessaryn/video-reconstruction-profile/v1";
  depthModel: string;
  depthModelRevision: string;
  depthModelSha256: Digest;
  runtimeSha256: Digest;
  depthMode: "relative-monocular" | "deterministic-fallback";
  poseMode: "multiscale-image-registration";
  metricScale: false;
  localOnly: true;
  sampledFrames: number;
  shotDiscontinuities: number;
}

export interface VideoMomentArtifact {
  id: string;
  label: string;
  capturedAtUnixUs: number;
  observationCellId: Digest;
  fieldCellId: Digest;
  surfels: SurfelPoint[];
  surfelGrid: { columns: number; rows: number } | null;
  surfaceField: SdfVoxelPoint[];
  voxelSizeUm: number;
}

export interface VideoReconstructionResult {
  schema: "tessaryn/video-locus-artifact/v1";
  source: VideoReconstructionSource;
  profile: VideoReconstructionProfile;
  world: DemoWorld;
  observations: TemporalObservation[];
  moments: VideoMomentArtifact[];
  memoryCapsule: Record<string, any>;
  metrics: {
    surfels: number;
    surfaceVoxels: number;
    worldCells: number;
    phaBindings: number;
    rootprintBranches: number;
  };
}

export interface VideoLocusFile {
  schema: "tessaryn/video-locus-artifact/v1";
  source: VideoReconstructionSource;
  profile: VideoReconstructionProfile;
  world: DemoWorld;
  moments: VideoMomentArtifact[];
  memory_capsule: Record<string, any>;
  metrics: VideoReconstructionResult["metrics"];
}

interface DecodedFrame {
  canvas: HTMLCanvasElement;
  image: ImageData;
  grayscale: Uint8Array;
  grayWidth: number;
  grayHeight: number;
  timeMs: number;
}

interface DepthField {
  width: number;
  height: number;
  meters: Float32Array;
}

export interface FrameMotion {
  shiftX: number;
  shiftY: number;
  scalePpm: number;
  residualMilli: number;
  histogramMilli: number;
  discontinuity: boolean;
}

interface CameraPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  segment: number;
}

interface MomentGeometry {
  id: string;
  label: string;
  capturedAtUnixUs: number;
  surfels: SurfelPoint[];
  surfelGrid: { columns: number; rows: number } | null;
  surfaceField: SdfVoxelPoint[];
}

type ProgressCallback = (progress: VideoReconstructionProgress) => void;
type DepthEstimator = (image: HTMLCanvasElement) => Promise<unknown>;

let depthEstimatorPromise: Promise<DepthEstimator> | null = null;

export async function reconstructVideoToLocus(
  file: File,
  identity: LocalFileIdentity,
  onProgress: ProgressCallback,
  signal: AbortSignal,
): Promise<VideoReconstructionResult> {
  assertNotAborted(signal);
  onProgress({ phase: "decode", progress: 0, detail: "DECODING NINE SOURCE MOMENTS" });
  const decoded = await decodeVideoFrames(file, onProgress, signal);
  assertNotAborted(signal);

  let depthMode: VideoReconstructionProfile["depthMode"] = "relative-monocular";
  let estimator: DepthEstimator | null = null;
  try {
    estimator = await getDepthEstimator((detail, progress) => {
      onProgress({ phase: "model", progress, detail });
    });
  } catch (error) {
    console.error("local depth model unavailable", error);
    depthMode = "deterministic-fallback";
    onProgress({
      phase: "model",
      progress: 1,
      detail: "LOCAL DEPTH MODEL UNAVAILABLE / FALLBACK ACTIVE",
    });
  }

  const motions: FrameMotion[] = [];
  const poses: CameraPose[] = [{ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, segment: 0 }];
  for (let index = 1; index < decoded.frames.length; index += 1) {
    assertNotAborted(signal);
    const previous = decoded.frames[index - 1];
    const current = decoded.frames[index];
    const previousPose = poses[index - 1];
    if (!previous || !current || !previousPose) continue;
    const motion = estimateFrameMotion(previous, current);
    motions.push(motion);
    poses.push(integratePose(previousPose, motion));
    onProgress({
      phase: "motion",
      progress: index / (decoded.frames.length - 1),
      detail: motion.discontinuity
        ? `SHOT BOUNDARY ${String(previousPose.segment + 1)} RETAINED`
        : `CAMERA MOTION ${String(index)} OF ${String(decoded.frames.length - 1)}`,
    });
  }

  const baseUnixUs = Math.max(0, file.lastModified) * 1_000;
  const geometries: MomentGeometry[] = [];
  const frameGroups = temporalFrameGroups(poses, decoded.frames.length, 3);
  const keyframeIndices = frameGroups.map((indices) => indices[Math.floor(indices.length / 2)]);
  if (keyframeIndices.length !== 3 || keyframeIndices.some((index) => index === undefined)) {
    throw new Error("video did not produce three admitted temporal keyframes");
  }
  const depthFields: Array<DepthField | undefined> = new Array(decoded.frames.length);
  for (let admittedIndex = 0; admittedIndex < keyframeIndices.length; admittedIndex += 1) {
    assertNotAborted(signal);
    const frameIndex = keyframeIndices[admittedIndex];
    const frame = frameIndex === undefined ? undefined : decoded.frames[frameIndex];
    if (frameIndex === undefined || !frame) continue;
    onProgress({
      phase: "depth",
      progress: admittedIndex / keyframeIndices.length,
      detail: `ESTIMATING SPATIAL DEPTH / MOMENT ${String(admittedIndex + 1)} OF ${String(keyframeIndices.length)}`,
    });
    try {
      const output = estimator ? await estimator(frame.canvas) : null;
      depthFields[frameIndex] = output ? depthOutputToField(output, frame) : fallbackDepth(frame);
    } catch (error) {
      console.error("depth inference failed", error);
      depthMode = "deterministic-fallback";
      depthFields[frameIndex] = fallbackDepth(frame);
    }
  }
  onProgress({ phase: "depth", progress: 1, detail: "THREE DEPTH FIELDS RESOLVED" });
  const momentDefinitions = [
    ["moment-a", "ARRIVAL"],
    ["moment-b", "PASSAGE"],
    ["moment-c", "SANCTUM"],
  ] as const;
  for (let momentIndex = 0; momentIndex < momentDefinitions.length; momentIndex += 1) {
    assertNotAborted(signal);
    const definition = momentDefinitions[momentIndex];
    if (!definition) continue;
    const surfels: SurfelPoint[] = [];
    let surfelGrid: MomentGeometry["surfelGrid"] = null;
    const frameIndices = frameGroups[momentIndex] ?? [];
    const centerIndex = frameIndices[Math.floor(frameIndices.length / 2)];
    const centerFrame = centerIndex === undefined ? undefined : decoded.frames[centerIndex];
    const centerDepth = centerIndex === undefined ? undefined : depthFields[centerIndex];
    const centerPose = centerIndex === undefined ? undefined : poses[centerIndex];
    if (centerFrame && centerDepth && centerPose) {
      const reconstructed = frameToSurfels(centerFrame, centerDepth, centerPose);
      surfels.push(...reconstructed.surfels);
      surfelGrid = reconstructed.grid;
    }
    const surfaceField = voxelizeSurface(surfels, FIELD_VOXEL_UM);
    geometries.push({
      id: definition[0],
      label: definition[1],
      capturedAtUnixUs: baseUnixUs + Math.round((centerFrame?.timeMs ?? 0) * 1_000),
      surfels,
      surfelGrid,
      surfaceField,
    });
    onProgress({
      phase: "cells",
      progress: (momentIndex + 1) / momentDefinitions.length,
      detail: `${definition[1]} / ${String(surfels.length)} SPATIAL SAMPLES`,
    });
  }

  const source: VideoReconstructionSource = {
    name: file.name || "UNNAMED VIDEO",
    mediaType: file.type || "video/mp4",
    bytes: file.size,
    width: decoded.sourceWidth,
    height: decoded.sourceHeight,
    durationMs: Math.round(decoded.durationSeconds * 1_000),
    streamRoot: identity.streamRoot as Digest,
  };
  const profile: VideoReconstructionProfile = {
    schema: "tessaryn/video-reconstruction-profile/v1",
    depthModel: MODEL_ID,
    depthModelRevision: MODEL_REVISION,
    depthModelSha256: MODEL_SHA256,
    runtimeSha256: RUNTIME_SHA256,
    depthMode,
    poseMode: "multiscale-image-registration",
    metricScale: false,
    localOnly: true,
    sampledFrames: decoded.frames.length,
    shotDiscontinuities: motions.filter((motion) => motion.discontinuity).length,
  };
  const constructed = await constructWorld(source, profile, geometries);
  onProgress({ phase: "verify", progress: 0.5, detail: "REPLAYING CELL IDENTITIES" });
  if (!(await verifyGeneratedMemoryCapsule(constructed.memoryCapsule))) {
    throw new Error("generated Memory Capsule did not reverify");
  }
  onProgress({ phase: "complete", progress: 1, detail: "NATIVE 4D LOCUS MATERIALIZED" });
  return {
    schema: "tessaryn/video-locus-artifact/v1",
    source,
    profile,
    world: constructed.world,
    observations: constructed.observations,
    moments: constructed.moments,
    memoryCapsule: constructed.memoryCapsule,
    metrics: {
      surfels: geometries.reduce((total, moment) => total + moment.surfels.length, 0),
      surfaceVoxels: geometries.reduce(
        (total, moment) => total + moment.surfaceField.length,
        0,
      ),
      worldCells: constructed.world.cells.length,
      phaBindings: constructed.world.cells.length,
      rootprintBranches: Object.keys(constructed.world.lineage.rootprint.branches).length,
    },
  };
}

export async function hydrateVideoLocusArtifact(
  value: unknown,
): Promise<VideoReconstructionResult> {
  if (!isVideoLocusFile(value)) throw new Error("unsupported video Locus artifact");
  const file = value;
  if (
    file.world.status !== "local-reconstruction" ||
    file.moments.length !== 3 ||
    file.world.cells.length !== 6 ||
    file.source.streamRoot !== file.world.cells[0]?.manifest.source_records[0]?.source_id
  ) {
    throw new Error("video Locus envelope or source binding mismatch");
  }
  const observations: TemporalObservation[] = [];
  let surfelCount = 0;
  let fieldCount = 0;
  for (const moment of file.moments) {
    const observationCell = file.world.cells.find(
      (cell) => cell.cell_id === moment.observationCellId,
    );
    const fieldCell = file.world.cells.find((cell) => cell.cell_id === moment.fieldCellId);
    if (
      !observationCell ||
      !fieldCell ||
      fieldCell.manifest.parents.length !== 1 ||
      fieldCell.manifest.parents[0] !== observationCell.cell_id ||
      moment.voxelSizeUm !== FIELD_VOXEL_UM
    ) {
      throw new Error(`${moment.id}: temporal Cell relation mismatch`);
    }
    const expectedSurfelDigest = observationCell.channel_payload.surfel_digest;
    const expectedFieldDigest = fieldCell.channel_payload.surface_field_digest;
    const committedGrid = observationCell.channel_payload.surfel_grid;
    if (
      (await digestSurfels(moment.surfels)) !== expectedSurfelDigest ||
      (await digestField(moment.surfaceField)) !== expectedFieldDigest
    ) {
      throw new Error(`${moment.id}: reconstructed geometry digest mismatch`);
    }
    if (
      moment.surfelGrid !== null &&
      (moment.surfelGrid.columns < 2 ||
        moment.surfelGrid.rows < 2 ||
        moment.surfelGrid.columns * moment.surfelGrid.rows !== moment.surfels.length)
    ) {
      throw new Error(`${moment.id}: organized surfel grid mismatch`);
    }
    if (
      (moment.surfelGrid === null && committedGrid !== null) ||
      (moment.surfelGrid !== null &&
        (typeof committedGrid !== "object" ||
          committedGrid === null ||
          (committedGrid as { columns?: unknown }).columns !== moment.surfelGrid.columns ||
          (committedGrid as { rows?: unknown }).rows !== moment.surfelGrid.rows))
    ) {
      throw new Error(`${moment.id}: organized surfel grid commitment mismatch`);
    }
    surfelCount += moment.surfels.length;
    fieldCount += moment.surfaceField.length;
    observations.push({
      id: moment.id,
      label: moment.label,
      cell: fieldCell,
      surfels: moment.surfels,
      surfelGrid: moment.surfelGrid,
      sdfVoxels: moment.surfaceField,
      voxelSizeUm: moment.voxelSizeUm,
      alternate: false,
      coordinateFrame: "tessaryn/local-camera",
    });
  }
  if (
    surfelCount !== file.metrics.surfels ||
    fieldCount !== file.metrics.surfaceVoxels ||
    file.metrics.worldCells !== file.world.cells.length ||
    file.metrics.phaBindings !== file.world.cells.length ||
    file.metrics.rootprintBranches !== Object.keys(file.world.lineage.rootprint.branches).length ||
    file.memory_capsule.header?.capsule_digest !==
      file.world.origin_memory_capsule.header?.capsule_digest ||
    !(await verifyGeneratedMemoryCapsule(file.memory_capsule))
  ) {
    throw new Error("video Locus report or Memory Capsule mismatch");
  }
  return {
    schema: file.schema,
    source: file.source,
    profile: file.profile,
    world: file.world,
    observations,
    moments: file.moments,
    memoryCapsule: file.memory_capsule,
    metrics: file.metrics,
  };
}

function isVideoLocusFile(value: unknown): value is VideoLocusFile {
  if (typeof value !== "object" || value === null) return false;
  const artifact = value as Partial<VideoLocusFile>;
  return (
    artifact.schema === "tessaryn/video-locus-artifact/v1" &&
    typeof artifact.source === "object" &&
    artifact.source !== null &&
    /^sha256:[0-9a-f]{64}$/.test(String(artifact.source.streamRoot)) &&
    typeof artifact.profile === "object" &&
    artifact.profile !== null &&
    typeof artifact.world === "object" &&
    artifact.world !== null &&
    Array.isArray(artifact.moments) &&
    typeof artifact.memory_capsule === "object" &&
    artifact.memory_capsule !== null &&
    typeof artifact.metrics === "object" &&
    artifact.metrics !== null
  );
}

async function getDepthEstimator(
  onProgress: (detail: string, progress: number) => void,
): Promise<DepthEstimator> {
  depthEstimatorPromise ??= (async () => {
    const transformers = await import("@huggingface/transformers");
    const base = new URL("./", document.baseURI);
    transformers.env.allowLocalModels = true;
    transformers.env.allowRemoteModels = false;
    transformers.env.localModelPath = new URL(
      "models/",
      base,
    ).href;
    transformers.env.useBrowserCache = true;
    const wasm = transformers.env.backends.onnx.wasm;
    if (!wasm) throw new Error("local ONNX WASM runtime is unavailable");
    wasm.wasmPaths = new URL("runtime/", base).href;
    wasm.numThreads = globalThis.crossOriginIsolated
      ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1))
      : 1;
    const progressCallback = (event: unknown): void => {
      const item = event as { status?: string; loaded?: number; total?: number; file?: string };
      const progress =
        item.total && item.loaded !== undefined ? item.loaded / item.total : item.status === "ready" ? 1 : 0.08;
      const file = item.file?.split("/").at(-1)?.replaceAll("_", " ") ?? "DEPTH ENGINE";
      onProgress(`LOADING ${file.toUpperCase()}`, Math.max(0, Math.min(1, progress)));
    };
    const estimator = await transformers.pipeline("depth-estimation", MODEL_ID, {
      dtype: "q4",
      device: "wasm",
      local_files_only: true,
      progress_callback: progressCallback,
    });
    return estimator as unknown as DepthEstimator;
  })();
  return depthEstimatorPromise;
}

async function decodeVideoFrames(
  file: File,
  onProgress: ProgressCallback,
  signal: AbortSignal,
): Promise<{
  frames: DecodedFrame[];
  sourceWidth: number;
  sourceHeight: number;
  durationSeconds: number;
}> {
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = objectUrl;
  try {
    await waitForEvent(video, "loadedmetadata", signal);
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0 || video.videoWidth <= 0 || video.videoHeight <= 0) {
      throw new Error("video metadata does not contain a finite visual timeline");
    }
    const scale = Math.min(1, FRAME_LONG_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(2, Math.round(video.videoWidth * scale));
    const height = Math.max(2, Math.round(video.videoHeight * scale));
    const times = Array.from({ length: FRAME_COUNT }, (_unused, index) =>
      duration * (0.04 + (index / (FRAME_COUNT - 1)) * 0.92),
    );
    const frames: DecodedFrame[] = [];
    for (let index = 0; index < times.length; index += 1) {
      assertNotAborted(signal);
      const time = times[index] ?? 0;
      await seekVideo(video, time, signal);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", {
        alpha: false,
        colorSpace: "srgb",
        willReadFrequently: true,
      });
      if (!context) throw new Error("2D frame decoder unavailable");
      context.drawImage(video, 0, 0, width, height);
      const image = context.getImageData(0, 0, width, height);
      const gray = grayscaleThumbnail(image, 128);
      frames.push({
        canvas,
        image,
        grayscale: gray.data,
        grayWidth: gray.width,
        grayHeight: gray.height,
        timeMs: Math.round(time * 1_000),
      });
      onProgress({
        phase: "decode",
        progress: (index + 1) / times.length,
        detail: `DECODED MOMENT SAMPLE ${String(index + 1)} OF ${String(times.length)}`,
      });
    }
    return {
      frames,
      sourceWidth: video.videoWidth,
      sourceHeight: video.videoHeight,
      durationSeconds: duration,
    };
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}

function depthOutputToField(output: unknown, frame: DecodedFrame): DepthField {
  const predicted = (output as {
    predicted_depth?: { dims?: number[]; data?: ArrayLike<number> };
  }).predicted_depth;
  if (!predicted?.dims || !predicted.data || predicted.dims.length < 2) {
    throw new Error("depth model returned an unsupported tensor");
  }
  const sourceHeight = predicted.dims.at(-2) ?? 0;
  const sourceWidth = predicted.dims.at(-1) ?? 0;
  if (sourceWidth <= 0 || sourceHeight <= 0 || predicted.data.length < sourceWidth * sourceHeight) {
    throw new Error("depth tensor dimensions are malformed");
  }
  const samples: number[] = [];
  for (let index = 0; index < sourceWidth * sourceHeight; index += 17) {
    const value = Number(predicted.data[index]);
    if (Number.isFinite(value)) samples.push(value);
  }
  samples.sort((left, right) => left - right);
  const low = percentile(samples, 0.03);
  const high = percentile(samples, 0.97);
  const span = Math.max(1e-6, high - low);
  const meters = new Float32Array(frame.image.width * frame.image.height);
  for (let row = 0; row < frame.image.height; row += 1) {
    const sourceRow = Math.min(sourceHeight - 1, Math.floor((row / frame.image.height) * sourceHeight));
    for (let column = 0; column < frame.image.width; column += 1) {
      const sourceColumn = Math.min(
        sourceWidth - 1,
        Math.floor((column / frame.image.width) * sourceWidth),
      );
      const value = Number(predicted.data[sourceRow * sourceWidth + sourceColumn]);
      const inverseDepth = Math.max(0, Math.min(1, (value - low) / span));
      meters[row * frame.image.width + column] = 0.85 + (1 - inverseDepth) ** 1.45 * 9.15;
    }
  }
  return { width: frame.image.width, height: frame.image.height, meters };
}

function fallbackDepth(frame: DecodedFrame): DepthField {
  const { width, height, data } = frame.image;
  const meters = new Float32Array(width * height);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const offset = (row * width + column) * 4;
      const luminance =
        ((data[offset] ?? 0) * 54 + (data[offset + 1] ?? 0) * 183 + (data[offset + 2] ?? 0) * 19) /
        (256 * 255);
      const vertical = 1 - row / Math.max(1, height - 1);
      meters[row * width + column] = 1.1 + vertical * 5.8 + (1 - luminance) * 1.7;
    }
  }
  return { width, height, meters };
}

export function estimateFrameMotion(previous: DecodedFrame, current: DecodedFrame): FrameMotion {
  if (previous.grayWidth !== current.grayWidth || previous.grayHeight !== current.grayHeight) {
    throw new Error("motion frames use different dimensions");
  }
  const width = previous.grayWidth;
  const height = previous.grayHeight;
  let best = { score: Number.POSITIVE_INFINITY, dx: 0, dy: 0, scale: 1 };
  for (const scale of [0.97, 0.985, 1, 1.015, 1.03]) {
    for (let dy = -6; dy <= 6; dy += 2) {
      for (let dx = -8; dx <= 8; dx += 2) {
        const score = registrationScore(
          previous.grayscale,
          current.grayscale,
          width,
          height,
          dx,
          dy,
          scale,
          4,
        );
        if (score < best.score) best = { score, dx, dy, scale };
      }
    }
  }
  for (let dy = best.dy - 1; dy <= best.dy + 1; dy += 1) {
    for (let dx = best.dx - 1; dx <= best.dx + 1; dx += 1) {
      for (const scale of [best.scale - 0.0075, best.scale, best.scale + 0.0075]) {
        const score = registrationScore(
          previous.grayscale,
          current.grayscale,
          width,
          height,
          dx,
          dy,
          scale,
          3,
        );
        if (score < best.score) best = { score, dx, dy, scale };
      }
    }
  }
  const histogram = histogramDistance(previous.grayscale, current.grayscale);
  return {
    shiftX: best.dx,
    shiftY: best.dy,
    scalePpm: Math.round((best.scale - 1) * 1_000_000),
    residualMilli: Math.round(best.score * 1_000),
    histogramMilli: Math.round(histogram * 1_000),
    discontinuity: best.score > 34 || histogram > 0.32,
  };
}

function integratePose(previous: CameraPose, motion: FrameMotion): CameraPose {
  if (motion.discontinuity) {
    return { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, segment: previous.segment + 1 };
  }
  const scale = motion.scalePpm / 1_000_000;
  return {
    x: previous.x - motion.shiftX * 0.018,
    y: previous.y + motion.shiftY * 0.014,
    z: previous.z + scale * 3.2 + 0.035,
    yaw: previous.yaw - motion.shiftX * 0.0048,
    pitch: Math.max(-0.28, Math.min(0.28, previous.pitch - motion.shiftY * 0.0032)),
    segment: previous.segment,
  };
}

export function temporalFrameGroups(
  poses: CameraPose[],
  frameCount: number,
  targetGroups: number,
): number[][] {
  const segments = new Map<number, number[]>();
  for (let index = 0; index < frameCount; index += 1) {
    const segment = poses[index]?.segment ?? 0;
    const values = segments.get(segment) ?? [];
    values.push(index);
    segments.set(segment, values);
  }
  const ordered = [...segments.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, indices]) => indices);
  if (ordered.length === targetGroups) return ordered;
  if (ordered.length > targetGroups) {
    return Array.from({ length: targetGroups }, (_unused, groupIndex) => {
      const start = Math.floor((groupIndex / targetGroups) * ordered.length);
      const end = Math.floor(((groupIndex + 1) / targetGroups) * ordered.length);
      return ordered.slice(start, Math.max(start + 1, end)).flat();
    });
  }
  return Array.from({ length: targetGroups }, (_unused, groupIndex) => {
    const start = Math.floor((groupIndex / targetGroups) * frameCount);
    const end = Math.floor(((groupIndex + 1) / targetGroups) * frameCount);
    return Array.from({ length: Math.max(1, end - start) }, (_item, offset) =>
      Math.min(frameCount - 1, start + offset),
    );
  });
}

function frameToSurfels(
  frame: DecodedFrame,
  depth: DepthField,
  pose: CameraPose,
): { surfels: SurfelPoint[]; grid: { columns: number; rows: number } | null } {
  const { width, height, data } = frame.image;
  const stride = Math.max(2, Math.ceil(Math.sqrt((width * height) / TARGET_SURFELS_PER_FRAME)));
  const focal = Math.max(width, height) * 0.88;
  const centerX = (width - 1) * 0.5;
  const centerY = (height - 1) * 0.5;
  const surfels: SurfelPoint[] = [];
  const rows: number[] = [];
  const columns: number[] = [];
  for (let row = stride; row < height - stride; row += stride) rows.push(row);
  for (let column = stride; column < width - stride; column += stride) columns.push(column);
  for (const row of rows) {
    for (const column of columns) {
      const index = row * width + column;
      const z = depth.meters[index];
      if (!z || !Number.isFinite(z)) continue;
      const x = ((column - centerX) / focal) * z;
      const y = ((centerY - row) / focal) * z;
      const world = rotatePoint(x, y, z, pose.yaw, pose.pitch);
      const left = depth.meters[index - stride] ?? z;
      const right = depth.meters[index + stride] ?? z;
      const up = depth.meters[index - stride * width] ?? z;
      const down = depth.meters[index + stride * width] ?? z;
      const normal = normalize3((left - right) * 1.6, (down - up) * 1.6, stride / focal);
      const worldNormal = rotatePoint(normal[0], normal[1], normal[2], pose.yaw, pose.pitch);
      const colorOffset = index * 4;
      const radiusMeters = Math.max(0.008, (z / focal) * stride * 0.72);
      surfels.push({
        positionUm: [
          Math.round((world[0] + pose.x) * 1_000_000),
          Math.round((world[1] + pose.y) * 1_000_000),
          Math.round((world[2] + pose.z) * 1_000_000),
        ],
        normalQ15: [
          Math.round(worldNormal[0] * 32_767),
          Math.round(worldNormal[1] * 32_767),
          Math.round(worldNormal[2] * 32_767),
        ],
        color: [
          data[colorOffset] ?? 0,
          data[colorOffset + 1] ?? 0,
          data[colorOffset + 2] ?? 0,
          255,
        ],
        radiusUm: Math.round(radiusMeters * 1_000_000),
      });
    }
  }
  return {
    surfels,
    grid:
      surfels.length === rows.length * columns.length
        ? { columns: columns.length, rows: rows.length }
        : null,
  };
}

function voxelizeSurface(surfels: SurfelPoint[], voxelSizeUm: number): SdfVoxelPoint[] {
  const weights = new Map<string, { coordinate: [number, number, number]; weight: number }>();
  for (const surfel of surfels) {
    const coordinate: [number, number, number] = [
      Math.floor(surfel.positionUm[0] / voxelSizeUm),
      Math.floor(surfel.positionUm[1] / voxelSizeUm),
      Math.floor(surfel.positionUm[2] / voxelSizeUm),
    ];
    const key = coordinate.join(",");
    const current = weights.get(key);
    if (current) current.weight = Math.min(65_535, current.weight + 1);
    else weights.set(key, { coordinate, weight: 1 });
  }
  return [...weights.values()]
    .sort((left, right) => compareCoordinate(left.coordinate, right.coordinate))
    .map((entry) => ({
      coordinate: entry.coordinate,
      signedDistanceUm: 0,
      weight: entry.weight,
    }));
}

async function constructWorld(
  source: VideoReconstructionSource,
  profile: VideoReconstructionProfile,
  geometries: MomentGeometry[],
): Promise<{
  world: DemoWorld;
  observations: TemporalObservation[];
  moments: VideoMomentArtifact[];
  memoryCapsule: Record<string, any>;
}> {
  const anchorCommitment = await calculateJsonChunkCommitment({
    schema: "tessaryn/video-anchor/v1",
    source_stream_root: source.streamRoot,
    pose_mode: profile.poseMode,
  });
  const anchorId = anchorCommitment.chunkId as Digest;
  const policyCommitment = await calculateJsonChunkCommitment({
    schema: "tessaryn/local-private-policy/v1",
    network_upload: false,
    source_retained_by_user: true,
  });
  const policyRoot = policyCommitment.chunkId as Digest;
  const cells: DemoCell[] = [];
  const momentArtifacts: VideoMomentArtifact[] = [];
  let previousObservation: Digest | null = null;
  let previousField: Digest | null = null;

  for (let index = 0; index < geometries.length; index += 1) {
    const geometry = geometries[index];
    if (!geometry) continue;
    const surfelDigest = await digestSurfels(geometry.surfels);
    const fieldDigest = await digestField(geometry.surfaceField);
    const bounds = surfelBounds(geometry.surfels);
    const transformCommitment = await calculateJsonChunkCommitment({
      schema: "tessaryn/video-transform/v1",
      source_stream_root: source.streamRoot,
      moment: geometry.id,
      depth_model: profile.depthModelSha256,
      pose_mode: profile.poseMode,
      metric_scale: false,
    });
    const observationPayload = {
      schema: "tessaryn/video-surfel-channel/v1",
      source_stream_root: source.streamRoot,
      moment: geometry.id,
      surfel_digest: surfelDigest,
      surfel_count: geometry.surfels.length,
      surfel_grid: geometry.surfelGrid,
      depth_mode: profile.depthMode,
      metric_scale: false,
    };
    const observationChunk = await calculateJsonChunkCommitment(observationPayload);
    const observationManifest = makeManifest({
      className: "observation",
      anchorId,
      policyRoot,
      bounds,
      capturedAtUnixUs: geometry.capturedAtUnixUs,
      chunkRoot: observationChunk.chunkRoot as Digest,
      channelRole: "geometry/surfel",
      channelBytes: geometry.surfels.length * 32,
      sourceRoot: source.streamRoot,
      transformId: transformCommitment.chunkId as Digest,
      parents: previousObservation ? [previousObservation] : [],
      supersedes: previousObservation ? [previousObservation] : [],
      stateKind: "observed",
    });
    const observationCellId = (await calculateCellId(observationManifest)) as Digest;
    const observation = makeCell(
      `${geometry.id}-observation`,
      `${geometry.label} OBSERVATION`,
      observationCellId,
      observationManifest,
      observationPayload,
      geometry,
      `Source frames reconstructed into ${String(geometry.surfels.length)} local spatial samples.`,
    );
    cells.push(observation);

    const fieldPayload = {
      schema: "tessaryn/video-surface-field/v1",
      source_cell: observationCellId,
      surface_field_digest: fieldDigest,
      surface_voxels: geometry.surfaceField.length,
      voxel_size_um: FIELD_VOXEL_UM,
      metric_scale: false,
    };
    const fieldChunk = await calculateJsonChunkCommitment(fieldPayload);
    const fieldManifest = makeManifest({
      className: "derived",
      anchorId,
      policyRoot,
      bounds,
      capturedAtUnixUs: geometry.capturedAtUnixUs,
      chunkRoot: fieldChunk.chunkRoot as Digest,
      channelRole: "geometry/surface-field",
      channelBytes: geometry.surfaceField.length * 20,
      sourceRoot: source.streamRoot,
      transformId: transformCommitment.chunkId as Digest,
      parents: [observationCellId],
      supersedes: previousField ? [previousField] : [],
      stateKind: "derived",
    });
    const fieldCellId = (await calculateCellId(fieldManifest)) as Digest;
    const fieldCell = makeCell(
      `${geometry.id}-surface`,
      `${geometry.label} SPATIAL FIELD`,
      fieldCellId,
      fieldManifest,
      fieldPayload,
      geometry,
      `A deterministic surface field binds the ${geometry.label.toLowerCase()} spatial samples to their source video identity.`,
    );
    cells.push(fieldCell);
    momentArtifacts.push({
      id: geometry.id,
      label: geometry.label,
      capturedAtUnixUs: geometry.capturedAtUnixUs,
      observationCellId,
      fieldCellId,
      surfels: geometry.surfels,
      surfelGrid: geometry.surfelGrid,
      surfaceField: geometry.surfaceField,
      voxelSizeUm: FIELD_VOXEL_UM,
    });
    previousObservation = observationCellId;
    previousField = fieldCellId;
  }

  const graph: Rootprint = {
    schema: "power-house/rootprint/v1",
    root_branch: ZERO_DIGEST,
    branches: {},
  };
  const branchMap: Record<string, Digest> = {};
  let parent: Digest | null = null;
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    if (!cell) continue;
    const pha = makePha(cell, anchorId);
    pha.phx_fingerprint = (await calculatePhaFingerprint(pha)) as Digest;
    const branch: RootprintBranch = {
      id: ZERO_DIGEST,
      label: cell.key,
      parents: parent ? [parent] : [],
      artifact: pha,
      sequence: index,
    };
    branch.id = (await calculateRootprintBranchId(branch)) as Digest;
    pha.identity_root = branch.id;
    branch.artifact = structuredClone(pha);
    graph.branches[branch.id] = branch;
    if (index === 0) graph.root_branch = branch.id;
    branchMap[cell.key] = branch.id;
    cell.proof = {
      pha,
      rootprint_id: branch.id,
      replay_fingerprint: ZERO_DIGEST,
    };
    parent = branch.id;
  }
  const replay = (await calculateRootprintReplay(graph)) as Digest;
  for (const cell of cells) cell.proof.replay_fingerprint = replay;
  const currentCell = cells.at(-1);
  if (!currentCell) throw new Error("video reconstruction produced no Cells");
  const memoryCapsule = await buildMemoryCapsule(currentCell, graph, replay);
  const moments: DemoMoment[] = geometries.map((geometry, index) => ({
    id: geometry.id,
    label: `${geometry.label} / SOURCE MOMENT ${String(index + 1)}`,
    unix_us: geometry.capturedAtUnixUs,
    environment: {
      sky: index === 0 ? "#071017" : index === 1 ? "#0d1114" : "#100d0a",
      sun: index === 0 ? "#a8dce0" : index === 1 ? "#e1bd80" : "#f0d8b2",
      sun_milli: 2_800 + index * 420,
      fog_ppm: 8_000 + index * 1_500,
      condition: geometry.label.toLowerCase(),
    },
  }));
  const world: DemoWorld = {
    schema: "tessaryn/demo-world/v0",
    status: "local-reconstruction",
    product: "TESSARYN LOCAL VIDEO LOCUS",
    origin: source.name,
    verification_profile:
      "Local source stream, Cell identity, PHA, Rootprint replay, Memory Capsule, and SLBIT bindings. Relative monocular geometry does not assert metric scale.",
    anchor_id: anchorId,
    moments,
    cells,
    lineage: { rootprint: graph, replay_fingerprint: replay, branches: branchMap },
    origin_memory_capsule: memoryCapsule,
  };
  const observations = momentArtifacts.map((moment) => {
    const cell = cells.find((candidate) => candidate.cell_id === moment.fieldCellId);
    if (!cell) throw new Error(`missing derived Cell for ${moment.id}`);
    return {
      id: moment.id,
      label: moment.label,
      cell,
      surfels: moment.surfels,
      surfelGrid: moment.surfelGrid,
      sdfVoxels: moment.surfaceField,
      voxelSizeUm: moment.voxelSizeUm,
      alternate: false,
      coordinateFrame: "tessaryn/local-camera",
    } satisfies TemporalObservation;
  });
  return { world, observations, moments: momentArtifacts, memoryCapsule };
}

function makeManifest(input: {
  className: CellManifest["class"];
  anchorId: Digest;
  policyRoot: Digest;
  bounds: { min: [number, number, number]; max: [number, number, number] };
  capturedAtUnixUs: number;
  chunkRoot: Digest;
  channelRole: string;
  channelBytes: number;
  sourceRoot: Digest;
  transformId: Digest;
  parents: Digest[];
  supersedes: Digest[];
  stateKind: "observed" | "derived";
}): CellManifest {
  return {
    schema: "tessaryn/cell/v0",
    class: input.className,
    anchor_id: input.anchorId,
    spatial_extent: {
      min_um: input.bounds.min,
      max_um: input.bounds.max,
      orientation_q30: [0, 0, 0, 1_073_741_824],
      uncertainty_um: [420_000, 420_000, 1_100_000],
    },
    temporal_extent: {
      start_unix_us: input.capturedAtUnixUs,
      end_unix_us: input.capturedAtUnixUs,
      uncertainty_us: 120_000,
      clock_source: "video-presentation-timestamp",
      published_at_unix_us: input.capturedAtUnixUs,
      valid_from_unix_us: input.capturedAtUnixUs,
      valid_until_unix_us: null,
      supersedes: input.supersedes,
      state_kind: input.stateKind,
    },
    channels: [
      {
        role: input.channelRole,
        codec: input.channelRole === "geometry/surfel" ? "tessaryn-surfel-v0" : "tessaryn-surface-field-v1",
        codec_version: "1",
        chunk_root: input.chunkRoot,
        uncompressed_bytes: input.channelBytes,
        quality_tier: 1,
        criticality: "critical",
        license: "source-controlled",
      },
    ],
    parents: input.parents,
    source_records: [
      {
        source_id: input.sourceRoot,
        source_type: "local-video",
        producer: "tessaryn-browser-forge",
        captured_at_unix_us: input.capturedAtUnixUs,
      },
    ],
    transform_records: [
      {
        transform_id: input.transformId,
        method: "relative-depth-plus-image-registration",
        tool: "tessaryn-video-forge",
        tool_version: "1",
        input_ids: [input.sourceRoot],
      },
    ],
    policy_root: input.policyRoot,
    evidence: {
      identity_committed: true,
      replay_available: true,
      source_attributed: true,
      disputed: false,
      semantic_only: false,
      restricted: false,
    },
    chunk_merkle_root: input.chunkRoot,
  };
}

function makeCell(
  key: string,
  label: string,
  cellId: Digest,
  manifest: CellManifest,
  payload: Record<string, unknown>,
  geometry: MomentGeometry,
  summary: string,
): DemoCell {
  const size = [
    manifest.spatial_extent.max_um[0] - manifest.spatial_extent.min_um[0],
    manifest.spatial_extent.max_um[1] - manifest.spatial_extent.min_um[1],
    manifest.spatial_extent.max_um[2] - manifest.spatial_extent.min_um[2],
  ] as [number, number, number];
  return {
    key,
    label,
    cell_id: cellId,
    manifest,
    channel_payload: payload,
    visual: {
      primitive: "surfel-field",
      position_mm: [0, 1_100, 0],
      size_mm: size.map((value) => Math.max(100, Math.round(value / 1_000))) as [
        number,
        number,
        number,
      ],
      rotation_mdeg: [0, 0, 0],
      color: geometry.id === "moment-a" ? "#8fd8cf" : geometry.id === "moment-b" ? "#d9ba76" : "#e8e2d7",
      material: "source-derived",
      seed: Number.parseInt(cellId.slice(7, 15), 16),
      moments: [geometry.id],
    },
    semantic_summary: summary,
    proof: { pha: {} as PhaArtifact, rootprint_id: ZERO_DIGEST, replay_fingerprint: ZERO_DIGEST },
  };
}

function makePha(cell: DemoCell, anchorId: Digest): PhaArtifact {
  return {
    schema: "power-house/pha/v1",
    provenance: {
      anchor_id: anchorId,
      cell_schema: "tessaryn/cell/v0",
      producer: "tessaryn-browser-forge",
      source_manifest_root: cell.cell_id,
    },
    embedded_proof: {
      protocol: "tessaryn/world-cell/v0",
      public_inputs: {
        cell_manifest_digest: cell.cell_id,
        chunk_merkle_root: cell.manifest.chunk_merkle_root,
        declared_class: cell.manifest.class,
        policy_root: cell.manifest.policy_root,
      },
      proof: {
        canonicalization_profile: "tessaryn-canonical-v0",
        identity_verified: true,
        metric_scale_claimed: false,
        physical_truth_claimed: false,
      },
    },
    identity_root: ZERO_DIGEST,
    phx_fingerprint: ZERO_DIGEST,
  };
}

async function buildMemoryCapsule(
  cell: DemoCell,
  graph: Rootprint,
  replay: Digest,
): Promise<Record<string, any>> {
  const packet = {
    claim: { authority: "semantic", label: cell.label },
    explanation_constraints: {
      forbid_unbound_claims: true,
      mark_generated_text_non_authoritative: true,
    },
    schema: "slbit/viz-packet/v3",
    summary: cell.semantic_summary,
  };
  const packetDigest = await calculateSemanticDigest(packet);
  const sidecarProjection = {
    nodes: {
      [cell.proof.rootprint_id]: {
        claim: packet.claim,
        explanation_constraints: packet.explanation_constraints,
        schema: packet.schema,
      },
    },
    rootprint_state_fingerprint: replay,
    schema: "power-house/observatory-sidecar/v1",
  };
  const sidecarDigest = await calculateSidecarDigest(sidecarProjection);
  const corePolicy = {
    require_rootprint: true,
    require_replay: true,
    allow_external_attachments: true,
    fail_on_unknown_critical: true,
  };
  const coreProjection = {
    core_verification_policy: corePolicy,
    pha: cell.proof.pha,
    proofs: [],
  };
  const coreDigest = await calculateMemoryCoreDigest(coreProjection);
  const capsule: Record<string, any> = {
    header: {
      schema: "power-house/memory-capsule/v1",
      capsule_id: `phm_${cell.cell_id.slice(7, 23)}`,
      capsule_digest: null,
      created_at_unix_ms: 0,
      producer: {
        name: "tessaryn-browser-forge",
        tool: "tessaryn",
        power_house_version: "0.3.24",
        slbit_version: "3.0.0",
        rustc: null,
        platform: null,
      },
      critical_extensions: [],
      noncritical_extensions: [],
    },
    core: {
      pha: cell.proof.pha,
      proofs: [],
      core_digest: coreDigest,
      core_verification_policy: corePolicy,
    },
    lineage: {
      rootprint: graph,
      branches: Object.values(graph.branches).map((branch, index) => ({
        branch_id: branch.id,
        label: branch.label,
        parent_ids: branch.parents,
        artifact_digest: branch.artifact.phx_fingerprint,
        state_fingerprint: replay,
        operation: index === 0 ? "create" : "fork",
      })),
      equivalence: [],
    },
    replay: {
      replay: {
        engine: "power_house",
        version: "0.3.24",
        commands: ["julian memory verify capsule.phm", "julian memory replay capsule.phm"],
        expected: {
          core_valid: true,
          rootprint_valid: true,
          replay_fingerprint: replay,
          sidecar_valid: true,
        },
        resource_bounds: {
          max_memory_mb: 2048,
          max_disk_mb: 4096,
          max_wall_seconds_reference: 3600,
        },
        network_required: false,
      },
    },
    semantics: {
      sidecar_schema: "power-house/observatory-sidecar/v1",
      sidecar: { ...sidecarProjection, sidecar_sha256: sidecarDigest },
      packets: [
        {
          packet_schema: "slbit/viz-packet/v3",
          packet_id: `slp_${cell.cell_id.slice(7, 19)}`,
          packet_digest: packetDigest,
          bound_branch_id: cell.proof.rootprint_id,
          bound_replay_fingerprint: replay,
          role: "claim_view",
          packet,
        },
      ],
      semantic_policy: {
        semantic_changes_affect_core: false,
        llm_text_is_non_authoritative: true,
        require_packet_digest: true,
        require_branch_binding: true,
      },
    },
    witnesses: [],
    challenge: { mutations: [] },
    receipts: [],
  };
  capsule.header.capsule_digest = await calculateMemoryCapsuleDigest(capsule);
  return capsule;
}

function surfelBounds(surfels: SurfelPoint[]): {
  min: [number, number, number];
  max: [number, number, number];
} {
  if (surfels.length === 0) throw new Error("reconstructed moment contains no surfels");
  const min: [number, number, number] = [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
  const max: [number, number, number] = [Number.MIN_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, Number.MIN_SAFE_INTEGER];
  for (const surfel of surfels) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = surfel.positionUm[axis];
      if (value === undefined) continue;
      min[axis] = Math.min(min[axis] ?? value, value);
      max[axis] = Math.max(max[axis] ?? value, value);
    }
  }
  return { min, max };
}

async function digestSurfels(surfels: SurfelPoint[]): Promise<Digest> {
  const buffer = new ArrayBuffer(surfels.length * 32);
  const view = new DataView(buffer);
  surfels.forEach((surfel, index) => {
    const offset = index * 32;
    view.setInt32(offset, surfel.positionUm[0], true);
    view.setInt32(offset + 4, surfel.positionUm[1], true);
    view.setInt32(offset + 8, surfel.positionUm[2], true);
    view.setInt16(offset + 12, surfel.normalQ15[0], true);
    view.setInt16(offset + 14, surfel.normalQ15[1], true);
    view.setInt16(offset + 16, surfel.normalQ15[2], true);
    view.setUint8(offset + 18, surfel.color[0]);
    view.setUint8(offset + 19, surfel.color[1]);
    view.setUint8(offset + 20, surfel.color[2]);
    view.setUint8(offset + 21, surfel.color[3]);
    view.setUint32(offset + 24, surfel.radiusUm, true);
  });
  return digestDomain("TESSARYN-BROWSER-SURFELS-v1\0", new Uint8Array(buffer));
}

async function digestField(field: SdfVoxelPoint[]): Promise<Digest> {
  const buffer = new ArrayBuffer(field.length * 20);
  const view = new DataView(buffer);
  field.forEach((voxel, index) => {
    const offset = index * 20;
    view.setInt32(offset, voxel.coordinate[0], true);
    view.setInt32(offset + 4, voxel.coordinate[1], true);
    view.setInt32(offset + 8, voxel.coordinate[2], true);
    view.setInt32(offset + 12, voxel.signedDistanceUm, true);
    view.setUint32(offset + 16, voxel.weight, true);
  });
  return digestDomain("TESSARYN-BROWSER-SURFACE-v1\0", new Uint8Array(buffer));
}

async function digestDomain(domain: string, payload: Uint8Array): Promise<Digest> {
  const prefix = new TextEncoder().encode(domain);
  const bytes = new Uint8Array(prefix.length + payload.length);
  bytes.set(prefix);
  bytes.set(payload, prefix.length);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return (`sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`) as Digest;
}

function grayscaleThumbnail(image: ImageData, maxWidth: number): {
  data: Uint8Array;
  width: number;
  height: number;
} {
  const width = Math.min(maxWidth, image.width);
  const height = Math.max(2, Math.round((image.height / image.width) * width));
  const output = new Uint8Array(width * height);
  for (let row = 0; row < height; row += 1) {
    const sourceRow = Math.min(image.height - 1, Math.floor((row / height) * image.height));
    for (let column = 0; column < width; column += 1) {
      const sourceColumn = Math.min(image.width - 1, Math.floor((column / width) * image.width));
      const offset = (sourceRow * image.width + sourceColumn) * 4;
      output[row * width + column] = Math.round(
        ((image.data[offset] ?? 0) * 54 +
          (image.data[offset + 1] ?? 0) * 183 +
          (image.data[offset + 2] ?? 0) * 19) /
          256,
      );
    }
  }
  return { data: output, width, height };
}

function registrationScore(
  previous: Uint8Array,
  current: Uint8Array,
  width: number,
  height: number,
  shiftX: number,
  shiftY: number,
  scale: number,
  stride: number,
): number {
  const centerX = (width - 1) * 0.5;
  const centerY = (height - 1) * 0.5;
  let error = 0;
  let samples = 0;
  for (let row = 6; row < height - 6; row += stride) {
    for (let column = 6; column < width - 6; column += stride) {
      const sourceX = Math.round((column - centerX) / scale + centerX - shiftX);
      const sourceY = Math.round((row - centerY) / scale + centerY - shiftY);
      if (sourceX < 0 || sourceY < 0 || sourceX >= width || sourceY >= height) continue;
      error += Math.abs(
        (current[row * width + column] ?? 0) - (previous[sourceY * width + sourceX] ?? 0),
      );
      samples += 1;
    }
  }
  return samples === 0 ? Number.POSITIVE_INFINITY : error / samples;
}

function histogramDistance(left: Uint8Array, right: Uint8Array): number {
  const leftBins = new Uint32Array(16);
  const rightBins = new Uint32Array(16);
  for (const value of left) {
    const index = Math.min(15, value >>> 4);
    leftBins[index] = (leftBins[index] ?? 0) + 1;
  }
  for (const value of right) {
    const index = Math.min(15, value >>> 4);
    rightBins[index] = (rightBins[index] ?? 0) + 1;
  }
  let difference = 0;
  const total = Math.max(1, Math.min(left.length, right.length));
  for (let index = 0; index < 16; index += 1) {
    difference += Math.abs((leftBins[index] ?? 0) - (rightBins[index] ?? 0));
  }
  return difference / (total * 2);
}

function rotatePoint(
  x: number,
  y: number,
  z: number,
  yaw: number,
  pitch: number,
): [number, number, number] {
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const yawX = x * cosYaw + z * sinYaw;
  const yawZ = -x * sinYaw + z * cosYaw;
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  return [yawX, y * cosPitch - yawZ * sinPitch, y * sinPitch + yawZ * cosPitch];
}

function normalize3(x: number, y: number, z: number): [number, number, number] {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  return values[Math.min(values.length - 1, Math.max(0, Math.floor((values.length - 1) * fraction)))] ?? 0;
}

function compareCoordinate(
  left: [number, number, number],
  right: [number, number, number],
): number {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

function waitForEvent(
  target: HTMLMediaElement,
  eventName: "loadedmetadata" | "seeked",
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      target.removeEventListener(eventName, done);
      target.removeEventListener("error", failed);
      signal.removeEventListener("abort", aborted);
    };
    const done = (): void => {
      cleanup();
      resolve();
    };
    const failed = (): void => {
      cleanup();
      reject(new Error("browser could not decode the selected video"));
    };
    const aborted = (): void => {
      cleanup();
      reject(new DOMException("reconstruction cancelled", "AbortError"));
    };
    target.addEventListener(eventName, done, { once: true });
    target.addEventListener("error", failed, { once: true });
    signal.addEventListener("abort", aborted, { once: true });
  });
}

async function seekVideo(
  video: HTMLVideoElement,
  time: number,
  signal: AbortSignal,
): Promise<void> {
  if (Math.abs(video.currentTime - time) < 0.002 && video.readyState >= 2) return;
  const ready = waitForEvent(video, "seeked", signal);
  video.currentTime = Math.max(0, Math.min(video.duration, time));
  await ready;
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("reconstruction cancelled", "AbortError");
}
