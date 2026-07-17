import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workerUrl = new URL("../public/sw.js", import.meta.url);

test("World Cell theater is never cached or served by the service worker", async () => {
  const worker = await readFile(workerUrl, "utf8");
  const coreMatch = worker.match(/const CORE = \[([\s\S]*?)\];/u);
  assert.ok(coreMatch, "service worker must declare its offline core");
  assert.doesNotMatch(coreMatch[1], /world-cell-theater\.html/u);
  assert.match(worker, /const WORLD_CELL_PATH/);
  assert.match(worker, /const CANONICAL_WORLD_CELL_PATH/);
  assert.match(worker, /url\.pathname === WORLD_CELL_PATH/);
  assert.match(worker, /url\.pathname === CANONICAL_WORLD_CELL_PATH/);
  assert.match(worker, /cache: "no-store"/);
  assert.match(worker, /Never serve the World Cell instrument from CacheStorage/);
});
