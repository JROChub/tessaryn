import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("../src/world-cell-preview-fallback.ts", import.meta.url);

test("RGB preview keeps the camera primary with bounded live tracks", async () => {
  const source = await readFile(sourceUrl, "utf8");
  assert.match(source, /function detectFeatures/);
  assert.match(source, /function trackFeatures/);
  assert.match(source, /function estimateMotion/);
  assert.match(source, /function selectVisibleTracks/);
  assert.match(source, /function drawTrackHistory/);
  assert.match(source, /MAX_VISIBLE_TRACKS = 72/);
  assert.match(source, /MAX_TRACK_HISTORY = 2/);
  assert.match(source, /dataset\.visualRenderer = "camera-first-live-tracks"/);
  assert.match(source, /0 AUTH \/ \$\{visibleTracks\.length\} LIVE TRACKS/);
  assert.match(source, /video\.style\.opacity = "1"/);
  assert.match(source, /canvas\.style\.mixBlendMode = "screen"/);
  assert.match(source, /capture\.disabled = true/);
  assert.match(source, /seal\.disabled = true/);
  assert.match(source, /send\.disabled = true/);
  assert.doesNotMatch(source, /from "three"/);
  assert.doesNotMatch(source, /VisualPoint|ordinalDepth|appendTrackedKeyframe|MAX_VISUAL_POINTS/);
  assert.doesNotMatch(source, /FLOW PTS|point cloud.*active/i);
  assert.doesNotMatch(source, /commitMoment|buildCell|channel\.send/);
});
