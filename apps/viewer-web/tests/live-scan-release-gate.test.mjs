import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const scriptUrl = new URL("../scripts/verify-live-release.mjs", import.meta.url);

test("live release verification requires Scan V4 and rejects retired renderers", async () => {
  const source = await readFile(scriptUrl, "utf8");
  assert.match(source, /tessaryn-world-cell-scan-v4/);
  assert.match(source, /world-cell-scan-v4/);
  assert.match(source, /START WORLD CELL SCAN/);
  assert.match(source, /NO DEFENSIBLE GEOMETRY/);
  assert.match(source, /relative-sparse-reconstruction/);
  assert.match(source, /camera-first-live-tracks/);
  assert.match(source, /FLOW PTS/);
  assert.match(source, /18,000 VIS/);
  assert.match(source, /live release still contains retired World Cell renderer marker/);
  assert.match(source, /cache: "no-store"/);
  assert.match(source, /deployment_probe/);
});
