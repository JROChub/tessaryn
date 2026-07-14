export type PoseAuthority = "none" | "visual-relative" | "sensor-metric" | "fused-metric";
export type DepthAuthority = "none" | "triangulated-relative" | "sensor-metric" | "fused-metric";
export type ReconstructionState = "initializing" | "tracking" | "tracking-lost" | "relative-geometry" | "metric-geometry" | "sealable";

export interface IntegrityObservation {
  timestampMs: number;
  poseAuthority: PoseAuthority;
  depthAuthority: DepthAuthority;
  featureCount: number;
  correspondenceCount: number;
  inlierCount: number;
  medianParallaxDegrees: number;
  reprojectionErrorPx: number;
  baselineMeters?: number;
  metricScaleSource?: "depth-sensor" | "known-reference" | "xr-anchor";
  confirmedSurfels: number;
  uncertainSurfels: number;
  rejectedSamples: number;
  trackingCovariance: number;
  geometryCovariance: number;
}

export interface IntegrityDecision {
  state: ReconstructionState;
  mayFuse: boolean;
  mayConfirmGeometry: boolean;
  mayClaimSixDof: boolean;
  mayClaimMetricScale: boolean;
  maySealMetricCell: boolean;
  quality: number;
  reasons: string[];
}

const finite = (value: number) => Number.isFinite(value);
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/** Fail-closed admission policy for v0.22. Renderers must not bypass it. */
export function evaluateIntegrity(input: IntegrityObservation): IntegrityDecision {
  const reasons: string[] = [];
  const enoughFeatures = input.featureCount >= 80;
  const enoughCorrespondences = input.correspondenceCount >= 40;
  const inlierRatio = input.correspondenceCount > 0 ? input.inlierCount / input.correspondenceCount : 0;
  const enoughInliers = input.inlierCount >= 28 && inlierRatio >= 0.55;
  const enoughParallax = finite(input.medianParallaxDegrees) && input.medianParallaxDegrees >= 1.25;
  const boundedError = finite(input.reprojectionErrorPx) && input.reprojectionErrorPx <= 2.5;
  const boundedTrackingCovariance = finite(input.trackingCovariance) && input.trackingCovariance <= 0.18;
  const boundedGeometryCovariance = finite(input.geometryCovariance) && input.geometryCovariance <= 0.22;
  const poseSolved = input.poseAuthority !== "none" && enoughFeatures && enoughCorrespondences && enoughInliers && boundedError && boundedTrackingCovariance;
  const depthSolved = input.depthAuthority !== "none" && enoughParallax && boundedGeometryCovariance;
  const metricPose = input.poseAuthority === "sensor-metric" || input.poseAuthority === "fused-metric";
  const metricDepth = input.depthAuthority === "sensor-metric" || input.depthAuthority === "fused-metric";
  const metricScale = Boolean(input.metricScaleSource) && (metricPose || metricDepth) && finite(input.baselineMeters ?? Number.NaN) && (input.baselineMeters ?? 0) > 0;

  if (!enoughFeatures) reasons.push("insufficient stable visual features");
  if (!enoughCorrespondences) reasons.push("insufficient temporal correspondences");
  if (!enoughInliers) reasons.push("RANSAC consensus below admission threshold");
  if (!enoughParallax) reasons.push("baseline/parallax insufficient for triangulation");
  if (!boundedError) reasons.push("reprojection error exceeds 2.5 px");
  if (!boundedTrackingCovariance) reasons.push("pose covariance is unbounded");
  if (!boundedGeometryCovariance) reasons.push("geometry covariance is unbounded");
  if (!metricScale) reasons.push("metric scale has no admissible authority");

  const mayFuse = poseSolved && depthSolved;
  const mayConfirmGeometry = mayFuse && input.confirmedSurfels > 0;
  const mayClaimSixDof = poseSolved;
  const mayClaimMetricScale = metricScale;
  const maySealMetricCell = mayConfirmGeometry && metricScale && input.confirmedSurfels >= 512 && input.uncertainSurfels <= input.confirmedSurfels * 3;

  let state: ReconstructionState = "tracking";
  if (!enoughFeatures || !enoughCorrespondences) state = "initializing";
  if (input.featureCount >= 80 && !poseSolved) state = "tracking-lost";
  if (mayConfirmGeometry) state = metricScale ? "metric-geometry" : "relative-geometry";
  if (maySealMetricCell) state = "sealable";

  const quality = clamp01(
    clamp01(input.featureCount / 240) * 0.1 +
    clamp01(input.correspondenceCount / 140) * 0.1 +
    clamp01(inlierRatio) * 0.2 +
    clamp01(input.medianParallaxDegrees / 8) * 0.15 +
    clamp01(1 - input.reprojectionErrorPx / 5) * 0.15 +
    clamp01(1 - input.trackingCovariance) * 0.1 +
    clamp01(1 - input.geometryCovariance) * 0.1 +
    (metricScale ? 0.1 : 0),
  );

  return { state, mayFuse, mayConfirmGeometry, mayClaimSixDof, mayClaimMetricScale, maySealMetricCell, quality, reasons };
}

export function assertMetricSeal(decision: IntegrityDecision): void {
  if (!decision.maySealMetricCell) throw new Error(`Metric World Cell seal rejected: ${decision.reasons.join("; ")}`);
}
