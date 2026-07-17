import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("World Cell Scan V4 gates relative geometry on measured multi-view evidence", async () => {
  const [runtime, worker] = await Promise.all([
    read("src/world-cell-preview-fallback.ts"),
    read("src/world-cell-scan-v4-worker.ts"),
  ]);

  assert.match(runtime, /tessaryn-world-cell-scan-v4/);
  assert.match(runtime, /dataset\.visualRenderer = "world-cell-scan-v4"/);
  assert.match(runtime, /dataset\.scanState = "capturing"/);
  assert.match(runtime, /MIN_KEYFRAMES = 6/);
  assert.match(runtime, /SAMPLE_WIDTH = 320/);
  assert.match(runtime, /trackFeatures\(keyframeReference, current, keyframeReferenceFeatures, 18\)/);
  assert.match(runtime, /baselineMotion\.parallax >= 1\.2/);
  assert.match(runtime, /FINISH & SOLVE/);
  assert.match(runtime, /if \(keyframes\.length >= MAX_KEYFRAMES\) keyframes\.shift\(\)/);
  assert.match(runtime, /dataset\.scanAcceptedViews/);
  assert.match(runtime, /requestPreviewSolve/);
  assert.match(runtime, /accepted-live-relative-preview/);
  assert.match(runtime, /LIVE RELATIVE GEOMETRY/);
  assert.match(runtime, /relative-live-preview/);
  assert.match(runtime, /new Worker\(new URL\("\.\/world-cell-scan-v4-worker\.ts"/);
  assert.match(runtime, /NO DEFENSIBLE GEOMETRY/);
  assert.match(runtime, /relative-sparse-reconstruction/);
  assert.match(runtime, /video\.style\.opacity = "1"/);
  assert.match(runtime, /seal\.disabled = true/);
  assert.match(runtime, /send\.disabled = true/);
  assert.doesNotMatch(runtime, /FLOW PTS|18_000|camera-first-live-tracks/);
  assert.doesNotMatch(runtime, /commitMoment|buildCell|channel\.send/);

  assert.match(worker, /estimateEssentialRansac/);
  assert.match(worker, /choosePairs/);
  assert.match(worker, /maximum = 420/);
  assert.match(worker, /for \(let gap = 1; gap <= 3; gap \+= 1\)/);
  assert.match(worker, /for \(let index = 0; index < selections\.length; index \+= 1\)/);
  assert.match(worker, /failureProgress/);
  assert.match(worker, /decomposeEssential/);
  assert.match(worker, /triangulate/);
  assert.match(worker, /positiveDepthRatio/);
  assert.match(worker, /reprojectionErrorPixels/);
  assert.match(worker, /triangulationAngleDegrees/);
  assert.match(worker, /estimateCalibratedHomography/);
  assert.match(worker, /rotationOnlyMetrics/);
  assert.match(worker, /ROTATION_ONLY_MAX_MEDIAN_ERROR_PIXELS/);
  assert.match(worker, /ROTATION_ONLY_MIN_INLIER_RATIO/);
  assert.match(worker, /ROTATION_ONLY_MAX_ORTHOGONALITY_ERROR/);
  assert.match(worker, /selected\.coverage < 0\.24/);
  assert.match(worker, /MIN_RECONSTRUCTED_POINTS = 16/);
  assert.doesNotMatch(worker, /luminance.*depth|radial.*depth|ordinalDepth/iu);
});
