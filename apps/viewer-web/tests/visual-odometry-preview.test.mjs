import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("../src/world-cell-preview-fallback.ts", import.meta.url);

test("RGB preview uses measured feature tracking and bounded keyframes", async () => {
  const source = await readFile(sourceUrl, "utf8");
  assert.match(source, /function detectFeatures/);
  assert.match(source, /function trackFeatures/);
  assert.match(source, /function estimateMotion/);
  assert.match(source, /motion\.inliers\.length/);
  assert.match(source, /dataset\.visualTracking/);
  assert.match(source, /dataset\.visualParallax/);
  assert.match(source, /dataset\.visualKeyframes/);
  assert.match(source, /18_000/);
  assert.match(source, /0 AUTH \/ \$\{visualPoints\.length/);
  assert.match(source, /capture\.disabled = true/);
  assert.match(source, /seal\.disabled = true/);
  assert.match(source, /send\.disabled = true/);
  assert.doesNotMatch(source, /VISUAL TRACK 100%/);
  assert.doesNotMatch(source, /commitMoment|buildCell|channel\.send/);
});
