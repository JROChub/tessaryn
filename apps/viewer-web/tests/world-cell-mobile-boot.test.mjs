import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const theaterUrl = new URL("../world-cell-theater.html", import.meta.url);
const entryUrl = new URL("../src/world-cell-authority-entry.ts", import.meta.url);

test("mobile boot is bounded and cannot remain in verifying forever", async () => {
  const [theater, entry] = await Promise.all([
    readFile(theaterUrl, "utf8"),
    readFile(entryUrl, "utf8"),
  ]);
  assert.match(theater, /dataset\.worldCellMode = "booting"/);
  assert.match(theater, /dataset\.worldCellBoot = "html-ready"/);
  assert.match(theater, /timeoutMs = 30000/);
  assert.match(theater, /onerror="document\.documentElement\.dataset\.worldCellMode='boot-error'"/);
  assert.match(entry, /dataset\.worldCellBoot = "module-started"/);
  assert.match(entry, /dataset\.worldCellMode = "initializing"/);
  assert.match(entry, /const BOOT_PHASE_TIMEOUT_MS = 8_000/);
  assert.match(entry, /const PREVIEW_LOAD_TIMEOUT_MS = 12_000/);
  assert.match(entry, /withTimeout\(\s*navigator\.serviceWorker\.register/);
  assert.match(entry, /withTimeout\(registration\.update\(\)/);
  assert.match(entry, /"Spatial calibration probe"/);
  assert.match(entry, /"World Cell preview module load"/);
  assert.match(entry, /installEmergencyShell\(previewError\)/);
  assert.ok(
    entry.indexOf('dataset.worldCellMode = "initializing"') < entry.indexOf("async function boot"),
    "module startup state must be visible before asynchronous work",
  );
});