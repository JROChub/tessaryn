import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const scriptUrl = new URL("../scripts/verify-live-release.mjs", import.meta.url);

test("live release verification requires the calibrated spatial continuum and rejects retired renderers", async () => {
  const source = await readFile(scriptUrl, "utf8");
  assert.match(source, /keyxym-v26-reality-authority-spatial-surface-3/);
  assert.match(source, /keyxym-v26-calibrated-spatial-triangle-surface-v3/);
  assert.match(source, /5758375618325d215ce9ed6ad96872f36179e188/);
  assert.match(source, /48a9de27f8a212fabc2f4f72108109dad0fe166f1e81eef806da282f42aa6a85/);
  assert.match(source, /native-triangles/);
  assert.match(source, /relative-live-preview/);
  assert.match(source, /tessaryn\/spatial-calibration\/v1/);
  assert.match(source, /Metric capture requires an exact browser media-frame identity/);
  assert.match(source, /Host-verified synchronized RGB-D/);
  assert.match(source, /duplicate_geometry_suppressed/);
  assert.match(source, /scale_only_metric_rejected/);
  assert.match(source, /camera-first-live-tracks/);
  assert.match(source, /FLOW PTS/);
  assert.match(source, /18,000 VIS/);
  assert.match(source, /live release still contains retired World Cell renderer marker/);
  assert.match(source, /cache: "no-store"/);
  assert.match(source, /deployment_probe/);
});
