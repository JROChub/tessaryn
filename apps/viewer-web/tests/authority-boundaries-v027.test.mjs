import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("TESSARYN keeps keyxym_map, eform, and preview as separate authorities", async () => {
  const [entry, preview] = await Promise.all([
    read("src/world-cell-authority-entry.ts"),
    read("src/world-cell-preview-fallback.ts"),
  ]);

  assert.match(entry, /dataset\.keyxymMapAuthority/);
  assert.match(entry, /dataset\.eformAuthority/);
  assert.match(entry, /installWorldCellPreviewFallback/);
  assert.match(entry, /verifyKeyxymV26Bundle/);
  assert.match(entry, /installBrowserAssuranceBridge/);

  assert.match(preview, /worldCellMode = "visual-preview"/);
  assert.match(preview, /capture\.disabled = true/);
  assert.match(preview, /seal\.disabled = true/);
  assert.match(preview, /send\.disabled = true/);
  assert.match(preview, /cannot become a Moment, seal, Rootprint, or transfer artifact/);
  assert.doesNotMatch(preview, /commitMoment|buildCell|rootprint\s*=|channel\.send/);
});
