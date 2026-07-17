import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("TESSARYN keeps keyxym_map, eform, and relative scan geometry as separate authorities", async () => {
  const [entry, preview, worker, theater] = await Promise.all([
    read("src/world-cell-authority-entry.ts"),
    read("src/world-cell-preview-fallback.ts"),
    read("src/world-cell-scan-v4-worker.ts"),
    read("world-cell-theater.html"),
  ]);

  assert.match(entry, /dataset\.keyxymMapAuthority/);
  assert.match(entry, /dataset\.eformAuthority/);
  assert.match(entry, /import\("\.\/keyxym-v26-provenance"\)/);
  assert.match(entry, /import\("\.\/browser-assurance-runtime"\)/);
  assert.match(entry, /import\("\.\/world-cell-preview-fallback"\)/);
  assert.doesNotMatch(entry, /hasVerifiedSpatialAdapter/);
  assert.doesNotMatch(entry, /currentSpatialFrame/);
  assert.match(entry, /spatial sensor[\s\S]*optional evidence/);
  assert.match(entry, /installEmergencyShell/);
  assert.doesNotMatch(entry, /^import\s/m, "the boot entry must execute before dependent chunks load");

  assert.match(theater, /worldCellMode = "boot-recovery"/);
  assert.match(theater, /WORLD CELL MODULE UNAVAILABLE/);
  assert.match(theater, /START BASIC CAMERA/);
  assert.match(theater, /no geometry, Moment, seal, Rootprint, evidence, or transfer can be created/);

  assert.match(preview, /worldCellMode = "visual-preview"/);
  assert.match(preview, /tessaryn-world-cell-scan-v4/);
  assert.match(preview, /world-cell-scan-v4/);
  assert.match(preview, /authoritativeSurfels = "0"/);
  assert.match(preview, /authoritative: false/);
  assert.match(preview, /metric: false/);
  assert.match(preview, /momentAllowed: false/);
  assert.match(preview, /sealAllowed: false/);
  assert.match(preview, /rootprintAllowed: false/);
  assert.match(preview, /seal\.disabled = true/);
  assert.match(preview, /send\.disabled = true/);
  assert.match(preview, /NO DEFENSIBLE GEOMETRY/);
  assert.doesNotMatch(preview, /commitMoment|buildCell|rootprint\s*=|channel\.send/);

  assert.match(worker, /essential matrix/iu);
  assert.match(worker, /positive-depth/iu);
  assert.match(worker, /reprojection/iu);
  assert.doesNotMatch(worker, /Rootprint|Moment|sealAllowed:\s*true/);
});
