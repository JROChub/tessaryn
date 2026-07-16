import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("TESSARYN keeps keyxym_map, eform, and preview as separate authorities", async () => {
  const [entry, preview, theater] = await Promise.all([
    read("src/world-cell-authority-entry.ts"),
    read("src/world-cell-preview-fallback.ts"),
    read("world-cell-theater.html"),
  ]);

  assert.match(entry, /dataset\.keyxymMapAuthority/);
  assert.match(entry, /dataset\.eformAuthority/);
  assert.match(entry, /import\("\.\/keyxym-v26-provenance"\)/);
  assert.match(entry, /import\("\.\/browser-assurance-runtime"\)/);
  assert.match(entry, /import\("\.\/world-cell-preview-fallback"\)/);
  assert.match(entry, /hasVerifiedSpatialAdapter/);
  assert.match(entry, /currentSpatialFrame/);
  assert.match(entry, /installEmergencyShell/);
  assert.match(entry, /WORLD CELL \/ RECOVERY REQUIRED/);
  assert.doesNotMatch(entry, /^import\s/m, "the boot entry must execute before dependent chunks load");

  assert.match(theater, /worldCellMode = "boot-recovery"/);
  assert.match(theater, /WORLD CELL BOOT DID NOT COMPLETE/);
  assert.match(theater, /RETRY AUTHORITY/);
  assert.match(theater, /window\.location\.reload\(\)/);
  assert.match(theater, /No camera frame, Moment, seal, Rootprint, or transfer operation has executed/);

  assert.match(preview, /worldCellMode = "visual-preview"/);
  assert.match(preview, /keyxym-v021-responsive-baseline/);
  assert.match(preview, /VISUAL TRACK/);
  assert.match(preview, /capture\.disabled = true/);
  assert.match(preview, /seal\.disabled = true/);
  assert.match(preview, /send\.disabled = true/);
  assert.match(preview, /no Moment, seal, Rootprint, or transfer can be created/);
  assert.doesNotMatch(preview, /commitMoment|buildCell|rootprint\s*=|channel\.send/);
});
