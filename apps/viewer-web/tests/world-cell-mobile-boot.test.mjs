import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const theaterUrl = new URL("../world-cell-theater.html", import.meta.url);
const entryUrl = new URL("../src/world-cell-authority-entry.ts", import.meta.url);

test("mobile boot always leaves VERIFYING through authority, preview, or visible recovery", async () => {
  const [theater, entry] = await Promise.all([
    readFile(theaterUrl, "utf8"),
    readFile(entryUrl, "utf8"),
  ]);

  assert.match(theater, /dataset\.worldCellMode = "booting"/);
  assert.match(theater, /dataset\.worldCellBoot = "html-ready"/);
  assert.match(theater, /new Set\(\["booting", "initializing", "boot-error"\]\)/);
  assert.match(theater, /const timeoutMs = 45000/);
  assert.match(theater, /window\.tessarynWorldCellBootFailure = recover/);
  assert.match(theater, /WORLD CELL MODULE UNAVAILABLE/);
  assert.match(theater, /START BASIC CAMERA/);
  assert.match(theater, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(theater, /worldCellMode = "boot-recovery"/);
  assert.match(
    theater,
    /onerror="window\.tessarynWorldCellBootFailure\?\.\('The World Cell release module could not load\.'\)"/,
  );
  assert.doesNotMatch(
    theater,
    /onerror="document\.documentElement\.dataset\.worldCellMode='boot-error'"/,
  );

  assert.match(entry, /dataset\.worldCellBoot = "module-started"/);
  assert.match(entry, /dataset\.worldCellMode = "initializing"/);
  assert.match(entry, /const BOOT_PHASE_TIMEOUT_MS = 20_000/);
  assert.match(entry, /const PREVIEW_LOAD_TIMEOUT_MS = 20_000/);
  assert.match(entry, /void refreshServiceWorker\(\)/);
  assert.match(entry, /"World Cell preview module load"/);
  assert.match(entry, /installEmergencyShell\(previewError\)/);

  assert.doesNotMatch(entry, /hasVerifiedSpatialAdapter/);
  assert.doesNotMatch(entry, /await serviceWorkerRefresh/);
  const concurrentServiceWorkerRefresh = entry.indexOf("void refreshServiceWorker()");
  const provenanceVerification = entry.indexOf("verifyKeyxymV26Bundle");
  assert.ok(concurrentServiceWorkerRefresh >= 0 && provenanceVerification > concurrentServiceWorkerRefresh);
  assert.ok(
    entry.indexOf('dataset.worldCellMode = "initializing"') < entry.indexOf("async function boot"),
    "module startup state must be visible before asynchronous work",
  );
});
