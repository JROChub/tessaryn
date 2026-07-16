import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const theaterUrl = new URL("../world-cell-theater.html", import.meta.url);
const entryUrl = new URL("../src/world-cell-authority-entry.ts", import.meta.url);

test("mobile boot watchdog cannot preempt a running module graph", async () => {
  const [theater, entry] = await Promise.all([
    readFile(theaterUrl, "utf8"),
    readFile(entryUrl, "utf8"),
  ]);
  assert.match(theater, /dataset\.worldCellMode = "booting"/);
  assert.match(theater, /dataset\.worldCellBoot = "html-ready"/);
  assert.match(theater, /timeoutMs = 30000/);
  assert.match(theater, /worldCellMode !== "booting"/);
  assert.match(theater, /onerror="document\.documentElement\.dataset\.worldCellMode='boot-error'"/);
  assert.match(entry, /dataset\.worldCellBoot = "module-started"/);
  assert.match(entry, /dataset\.worldCellMode = "initializing"/);
  assert.ok(
    entry.indexOf('dataset.worldCellMode = "initializing"') < entry.indexOf("async function boot"),
    "module startup must disarm the HTML watchdog before asynchronous work",
  );
});
