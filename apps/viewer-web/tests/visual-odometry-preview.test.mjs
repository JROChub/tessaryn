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
  assert.match(runtime, /FINISH & SOLVE/);
  assert.match(runtime, /new Worker\(new URL\("\.\/world-cell-scan-v4-worker\.ts"/);
  assert.match(runtime, /NO DEFENSIBLE GEOMETRY/);
  assert.match(runtime, /relative-sparse-reconstruction/);
  assert.match(runtime, /video\.style\.opacity = "1"/);
  assert.match(runtime, /seal\.disabled = true/);
  assert.match(runtime, /send\.disabled = true/);
  assert.doesNotMatch(runtime, /FLOW PTS|18_000|camera-first-live-tracks/);
  assert.doesNotMatch(runtime, /commitMoment|buildCell|channel\.send/);

  assert.match(worker, /estimateEssentialRansac/);
  assert.match(worker, /decomposeEssential/);
  assert.match(worker, /triangulate/);
  assert.match(worker, /positiveDepthRatio/);
  assert.match(worker, /reprojectionErrorPixels/);
  assert.match(worker, /triangulationAngleDegrees/);
  assert.match(worker, /selected\.coverage < 0\.24/);
  assert.match(worker, /MIN_RECONSTRUCTED_POINTS = 16/);
  assert.doesNotMatch(worker, /luminance.*depth|radial.*depth|ordinalDepth/iu);
});
