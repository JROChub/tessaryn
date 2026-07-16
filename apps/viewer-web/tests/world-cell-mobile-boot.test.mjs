import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("mobile boot cannot be preempted by service-worker refresh", async () => {
  const [entry, theater] = await Promise.all([
    read("src/world-cell-authority-entry.ts"),
    read("world-cell-theater.html"),
  ]);
  assert.match(theater, /dataset\.worldCellMode = "booting"/);
  assert.match(theater, /timeoutMs = 30000/);
  assert.match(theater, /dataset\.worldCellBoot = "html-ready"/);
  assert.match(entry, /dataset\.worldCellBoot = "entry-running"/);
  assert.match(entry, /void refreshServiceWorker\(\)/);
  assert.doesNotMatch(entry, /await refreshServiceWorker\(\)/);
});
