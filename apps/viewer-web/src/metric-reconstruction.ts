export interface GrayFrame {
  width: number;
  height: number;
  gray: Float32Array;
  rgba: Uint8ClampedArray;
  timestamp: number;
}

export interface Feature {
  x: number;
  y: number;
  score: number;
}

export interface Match {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  error: number;
}

export interface MetricPose {
  tx: number;
  ty: number;
  tz: number;
  yaw: number;
  pitch: number;
  roll: number;
  inliers: number;
  reprojectionError: number;
  parallaxDegrees: number;
  tracking: number;
}

export interface MetricSurfel {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  r: number;
  g: number;
  b: number;
  confidence: number;
  uncertainty: number;
  observations: number;
  firstSeen: number;
  lastSeen: number;
  keyframe: number;
}

export interface CameraModel {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  scaleMeters: number;
}

export interface ReconstructionQuality {
  tracking: number;
  parallaxDegrees: number;
  reprojectionError: number;
  coverage: number;
  confirmed: number;
  uncertain: number;
  rejected: number;
  metricScale: boolean;
}

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

export function rgbaToGray(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  timestamp: number,
): GrayFrame {
  const gray = new Float32Array(width * height);
  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * 4;
    gray[index] = (
      rgba[offset]! * 0.2126 +
      rgba[offset + 1]! * 0.7152 +
      rgba[offset + 2]! * 0.0722
    ) / 255;
  }
  return { width, height, gray, rgba, timestamp };
}

export function detectFeatures(
  frame: GrayFrame,
  maximum = 420,
): Feature[] {
  const { width, height, gray } = frame;
  const candidates: Feature[] = [];
  const radius = 2;
  for (let y = 4; y < height - 4; y += 2) {
    for (let x = 4; x < width - 4; x += 2) {
      let xx = 0;
      let yy = 0;
      let xy = 0;
      for (let oy = -radius; oy <= radius; oy += 1) {
        for (let ox = -radius; ox <= radius; ox += 1) {
          const index = (y + oy) * width + x + ox;
          const gx = gray[index + 1]! - gray[index - 1]!;
          const gy = gray[index + width]! - gray[index - width]!;
          xx += gx * gx;
          yy += gy * gy;
          xy += gx * gy;
        }
      }
      const determinant = xx * yy - xy * xy;
      const trace = xx + yy;
      const score = determinant - 0.045 * trace * trace;
      if (score > 0.002) candidates.push({ x, y, score });
    }
  }
  candidates.sort((left, right) => right.score - left.score);
  const selected: Feature[] = [];
  for (const candidate of candidates) {
    const separated = selected.every((feature) => {
      const dx = feature.x - candidate.x;
      const dy = feature.y - candidate.y;
      return dx * dx + dy * dy > 49;
    });
    if (separated) selected.push(candidate);
    if (selected.length >= maximum) break;
  }
  return selected;
}

function patchError(
  left: GrayFrame,
  right: GrayFrame,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  let error = 0;
  let samples = 0;
  for (let oy = -2; oy <= 2; oy += 1) {
    for (let ox = -2; ox <= 2; ox += 1) {
      const ai = (ay + oy) * left.width + ax + ox;
      const bi = (by + oy) * right.width + bx + ox;
      error += Math.abs(left.gray[ai]! - right.gray[bi]!);
      samples += 1;
    }
  }
  return error / samples;
}

export function matchFeatures(
  previous: GrayFrame,
  current: GrayFrame,
  features: Feature[],
): Match[] {
  const matches: Match[] = [];
  const search = 12;
  for (const feature of features) {
    let bestError = Number.POSITIVE_INFINITY;
    let secondError = Number.POSITIVE_INFINITY;
    let bestX = feature.x;
    let bestY = feature.y;
    for (let dy = -search; dy <= search; dy += 1) {
      for (let dx = -search; dx <= search; dx += 1) {
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
    const distinct = bestError < 0.12 && bestError < secondError * 0.82;
    if (distinct) {
      matches.push({
        ax: feature.x,
        ay: feature.y,
        bx: bestX,
        by: bestY,
        error: bestError,
      });
    }
  }
  return matches;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

export function solvePose(
  matches: Match[],
  camera: CameraModel,
  prior: MetricPose,
): MetricPose {
  if (matches.length < 12) {
    return {
      ...prior,
      inliers: matches.length,
      tracking: clamp(matches.length / 12, 0, 1),
      reprojectionError: 99,
      parallaxDegrees: 0,
    };
  }
  const dx = matches.map((match) => match.bx - match.ax);
  const dy = matches.map((match) => match.by - match.ay);
  const mx = median(dx);
  const my = median(dy);
  const residuals = matches.map((match) =>
    Math.hypot(match.bx - match.ax - mx, match.by - match.ay - my),
  );
  const threshold = Math.max(1.5, median(residuals) * 2.5);
  const inliers = matches.filter((_, index) => residuals[index]! <= threshold);
  const error = inliers.reduce((sum, match) => sum + match.error, 0) / Math.max(1, inliers.length);
  const baselinePixels = Math.hypot(mx, my);
  const parallaxDegrees = Math.atan2(baselinePixels, camera.fx) * 180 / Math.PI;
  const scale = camera.scaleMeters / Math.max(camera.fx, 1);
  const tx = prior.tx - mx * scale;
  const ty = prior.ty + my * scale;
  const tz = prior.tz + Math.min(0.02, baselinePixels * scale * 0.08);
  const yaw = prior.yaw - mx / camera.fx * 0.18;
  const pitch = prior.pitch + my / camera.fy * 0.12;
  return {
    tx,
    ty,
    tz,
    yaw,
    pitch,
    roll: prior.roll,
    inliers: inliers.length,
    reprojectionError: error * 10,
    parallaxDegrees,
    tracking: clamp(inliers.length / Math.max(40, matches.length), 0, 1),
  };
}

function rotatePoint(
  x: number,
  y: number,
  z: number,
  pose: MetricPose,
): [number, number, number] {
  const cy = Math.cos(pose.yaw);
  const sy = Math.sin(pose.yaw);
  const cp = Math.cos(pose.pitch);
  const sp = Math.sin(pose.pitch);
  const x1 = cy * x + sy * z;
  const z1 = -sy * x + cy * z;
  const y1 = cp * y - sp * z1;
  const z2 = sp * y + cp * z1;
  return [x1 + pose.tx, y1 + pose.ty, z2 + pose.tz];
}

export function triangulateSurfels(
  previous: GrayFrame,
  current: GrayFrame,
  matches: Match[],
  pose: MetricPose,
  camera: CameraModel,
  keyframe: number,
): { surfels: MetricSurfel[]; rejected: number } {
  const surfels: MetricSurfel[] = [];
  let rejected = 0;
  const baseline = Math.max(0.004, Math.hypot(pose.tx, pose.ty, pose.tz));
  for (const match of matches) {
    const disparity = Math.hypot(match.bx - match.ax, match.by - match.ay);
    if (disparity < 0.7 || disparity > 40) {
      rejected += 1;
      continue;
    }
    const depth = clamp(camera.fx * baseline / disparity, 0.12, 8);
    const x = (match.bx - camera.cx) * depth / camera.fx;
    const y = -(match.by - camera.cy) * depth / camera.fy;
    const [wx, wy, wz] = rotatePoint(x, y, -depth, pose);
    const pixel = (Math.round(match.by) * current.width + Math.round(match.bx)) * 4;
    const confidence = clamp(
      pose.tracking * (1 - match.error * 3) * Math.min(1, disparity / 4),
      0.05,
      1,
    );
    const uncertainty = clamp(
      pose.reprojectionError / Math.max(0.5, disparity) + 1 / Math.max(1, pose.inliers),
      0.002,
      1,
    );
    const normalLength = Math.hypot(wx, wy, wz) || 1;
    surfels.push({
      x: wx,
      y: wy,
      z: wz,
      nx: -wx / normalLength,
      ny: -wy / normalLength,
      nz: -wz / normalLength,
      r: current.rgba[pixel]! / 255,
      g: current.rgba[pixel + 1]! / 255,
      b: current.rgba[pixel + 2]! / 255,
      confidence,
      uncertainty,
      observations: 1,
      firstSeen: previous.timestamp,
      lastSeen: current.timestamp,
      keyframe,
    });
  }
  return { surfels, rejected };
}

export function fuseSurfels(
  existing: MetricSurfel[],
  incoming: MetricSurfel[],
  maximum = 90_000,
): MetricSurfel[] {
  const voxels = new Map<string, MetricSurfel>();
  const add = (surfel: MetricSurfel) => {
    const resolution = 55;
    const key = [
      Math.round(surfel.x * resolution),
      Math.round(surfel.y * resolution),
      Math.round(surfel.z * resolution),
    ].join(":");
    const prior = voxels.get(key);
    if (!prior) {
      voxels.set(key, { ...surfel });
      return;
    }
    const wa = prior.confidence / Math.max(0.002, prior.uncertainty);
    const wb = surfel.confidence / Math.max(0.002, surfel.uncertainty);
    const total = wa + wb;
    prior.x = (prior.x * wa + surfel.x * wb) / total;
    prior.y = (prior.y * wa + surfel.y * wb) / total;
    prior.z = (prior.z * wa + surfel.z * wb) / total;
    prior.r = (prior.r * wa + surfel.r * wb) / total;
    prior.g = (prior.g * wa + surfel.g * wb) / total;
    prior.b = (prior.b * wa + surfel.b * wb) / total;
    prior.confidence = clamp(prior.confidence + surfel.confidence * 0.12, 0, 1);
    prior.uncertainty = Math.max(0.001, Math.min(prior.uncertainty, surfel.uncertainty) * 0.92);
    prior.observations += 1;
    prior.lastSeen = Math.max(prior.lastSeen, surfel.lastSeen);
  };
  for (const surfel of existing) add(surfel);
  for (const surfel of incoming) add(surfel);
  return [...voxels.values()]
    .sort((left, right) => {
      const leftRank = left.confidence * left.observations / left.uncertainty;
      const rightRank = right.confidence * right.observations / right.uncertainty;
      return rightRank - leftRank;
    })
    .slice(0, maximum);
}

export function assessQuality(
  surfels: MetricSurfel[],
  pose: MetricPose,
  rejected: number,
  metricScale: boolean,
): ReconstructionQuality {
  const confirmed = surfels.filter((surfel) =>
    surfel.observations >= 2 && surfel.confidence >= 0.6 && surfel.uncertainty <= 0.18,
  ).length;
  const uncertain = surfels.length - confirmed;
  const coverage = clamp(confirmed / 32_000, 0, 1);
  return {
    tracking: pose.tracking,
    parallaxDegrees: pose.parallaxDegrees,
    reprojectionError: pose.reprojectionError,
    coverage,
    confirmed,
    uncertain,
    rejected,
    metricScale,
  };
}
