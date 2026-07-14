export interface GrayFrame {
  width: number;
  height: number;
  gray: Float32Array;
  rgba: Uint8ClampedArray;
  timestamp: number;
}

export interface Feature { x: number; y: number; score: number }
export interface Match { ax: number; ay: number; bx: number; by: number; error: number }

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

export function detectFeatures(frame: GrayFrame, maximum = 900): Feature[] {
  const { width, height, gray } = frame;
  const candidates: Feature[] = [];
  for (let y = 4; y < height - 4; y += 2) {
    for (let x = 4; x < width - 4; x += 2) {
      let xx = 0;
      let yy = 0;
      let xy = 0;
      for (let oy = -2; oy <= 2; oy += 1) {
        for (let ox = -2; ox <= 2; ox += 1) {
          const index = (y + oy) * width + x + ox;
          const gx = gray[index + 1]! - gray[index - 1]!;
          const gy = gray[index + width]! - gray[index - width]!;
          xx += gx * gx;
          yy += gy * gy;
          xy += gx * gy;
        }
      }
      const trace = xx + yy;
      const score = xx * yy - xy * xy - 0.042 * trace * trace;
      if (score > 0.00045) candidates.push({ x, y, score });
    }
  }
  candidates.sort((left, right) => right.score - left.score);
  const selected: Feature[] = [];
  for (const candidate of candidates) {
    const separated = selected.every((feature) => {
      const dx = feature.x - candidate.x;
      const dy = feature.y - candidate.y;
      return dx * dx + dy * dy > 20;
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
  let meanLeft = 0;
  let meanRight = 0;
  let samples = 0;
  for (let oy = -2; oy <= 2; oy += 1) {
    for (let ox = -2; ox <= 2; ox += 1) {
      meanLeft += left.gray[(ay + oy) * left.width + ax + ox]!;
      meanRight += right.gray[(by + oy) * right.width + bx + ox]!;
      samples += 1;
    }
  }
  meanLeft /= samples;
  meanRight /= samples;
  let error = 0;
  for (let oy = -2; oy <= 2; oy += 1) {
    for (let ox = -2; ox <= 2; ox += 1) {
      const a = left.gray[(ay + oy) * left.width + ax + ox]! - meanLeft;
      const b = right.gray[(by + oy) * right.width + bx + ox]! - meanRight;
      error += Math.abs(a - b);
    }
  }
  return error / samples;
}

function searchMatch(
  previous: GrayFrame,
  current: GrayFrame,
  feature: Feature,
): Match | null {
  const search = 18;
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
  if (bestError > 0.18 || bestError > secondError * 0.93) return null;
  return { ax: feature.x, ay: feature.y, bx: bestX, by: bestY, error: bestError };
}

export function matchFeatures(
  previous: GrayFrame,
  current: GrayFrame,
  features: Feature[],
): Match[] {
  const matches: Match[] = [];
  for (const feature of features) {
    const forward = searchMatch(previous, current, feature);
    if (!forward) continue;
    const backwardFeature = { x: forward.bx, y: forward.by, score: feature.score };
    const backward = searchMatch(current, previous, backwardFeature);
    if (!backward) continue;
    const roundTrip = Math.hypot(backward.bx - feature.x, backward.by - feature.y);
    if (roundTrip <= 2.25) matches.push(forward);
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
  if (matches.length < 8) {
    return {
      ...prior,
      inliers: matches.length,
      tracking: clamp(matches.length / 16, 0, 0.3),
      reprojectionError: Number.POSITIVE_INFINITY,
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
  const threshold = Math.max(1.25, median(residuals) * 2.8);
  const inliers = matches.filter((_, index) => residuals[index]! <= threshold);
  const error = inliers.reduce((sum, match) => sum + match.error, 0) /
    Math.max(1, inliers.length);
  const baselinePixels = Math.hypot(mx, my);
  const parallaxDegrees = Math.atan2(baselinePixels, camera.fx) * 180 / Math.PI;
  const scale = camera.scaleMeters / Math.max(camera.fx, 1);
  const support = inliers.length / Math.max(24, matches.length);
  const photometric = clamp(1 - error / 0.18, 0, 1);
  return {
    tx: prior.tx - mx * scale,
    ty: prior.ty + my * scale,
    tz: prior.tz + Math.min(0.025, baselinePixels * scale * 0.1),
    yaw: prior.yaw - mx / camera.fx * 0.2,
    pitch: prior.pitch + my / camera.fy * 0.14,
    roll: prior.roll,
    inliers: inliers.length,
    reprojectionError: error * 8,
    parallaxDegrees,
    tracking: clamp(support * 0.75 + photometric * 0.25, 0, 1),
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
  const motionBaseline = Math.hypot(pose.tx, pose.ty, pose.tz);
  const baseline = Math.max(0.006, motionBaseline, camera.scaleMeters * 0.035);
  for (const match of matches) {
    const disparity = Math.hypot(match.bx - match.ax, match.by - match.ay);
    if (disparity < 0.45 || disparity > 64) {
      rejected += 1;
      continue;
    }
    const depth = clamp(camera.fx * baseline / disparity, 0.12, 10);
    const baseConfidence = clamp(
      pose.tracking * (1 - match.error * 2.4) * Math.min(1, disparity / 2.5),
      0.04,
      1,
    );
    const uncertainty = clamp(
      pose.reprojectionError / Math.max(0.6, disparity) + 1 / Math.max(1, pose.inliers),
      0.002,
      1,
    );
    for (let oy = -3; oy <= 3; oy += 1) {
      for (let ox = -3; ox <= 3; ox += 1) {
        if ((ox + oy) % 2 !== 0) continue;
        const px = Math.round(match.bx + ox);
        const py = Math.round(match.by + oy);
        if (px < 0 || py < 0 || px >= current.width || py >= current.height) continue;
        const local = current.gray[py * current.width + px]!;
        const center = current.gray[Math.round(match.by) * current.width + Math.round(match.bx)]!;
        const edgePenalty = clamp(Math.abs(local - center) * 2.5, 0, 0.55);
        const localDepth = depth * (1 + (local - center) * 0.035);
        const x = (px - camera.cx) * localDepth / camera.fx;
        const y = -(py - camera.cy) * localDepth / camera.fy;
        const [wx, wy, wz] = rotatePoint(x, y, -localDepth, pose);
        const pixel = (py * current.width + px) * 4;
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
          confidence: clamp(baseConfidence - edgePenalty, 0.03, 1),
          uncertainty: clamp(uncertainty + edgePenalty * 0.3, 0.002, 1),
          observations: 1,
          firstSeen: previous.timestamp,
          lastSeen: current.timestamp,
          keyframe,
        });
      }
    }
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
    const resolution = 72;
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
    prior.confidence = clamp(prior.confidence + surfel.confidence * 0.16, 0, 1);
    prior.uncertainty = Math.max(0.001, Math.min(prior.uncertainty, surfel.uncertainty) * 0.88);
    prior.observations += 1;
    prior.firstSeen = Math.min(prior.firstSeen, surfel.firstSeen);
    prior.lastSeen = Math.max(prior.lastSeen, surfel.lastSeen);
  };
  existing.forEach(add);
  incoming.forEach(add);
  return [...voxels.values()]
    .sort((left, right) =>
      right.confidence * right.observations / right.uncertainty -
      left.confidence * left.observations / left.uncertainty)
    .slice(0, maximum);
}

export function assessQuality(
  surfels: MetricSurfel[],
  pose: MetricPose,
  rejected: number,
  metricScale: boolean,
): ReconstructionQuality {
  const confirmed = surfels.filter((item) =>
    item.observations >= 2 && item.confidence >= 0.52 && item.uncertainty <= 0.3).length;
  const uncertain = surfels.length - confirmed;
  const total = confirmed + uncertain + rejected;
  return {
    tracking: pose.tracking,
    parallaxDegrees: pose.parallaxDegrees,
    reprojectionError: pose.reprojectionError,
    coverage: total === 0 ? 0 : confirmed / Math.max(1, confirmed + uncertain),
    confirmed,
    uncertain,
    rejected,
    metricScale,
  };
}
