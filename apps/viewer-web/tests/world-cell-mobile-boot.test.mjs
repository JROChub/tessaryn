import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const theaterUrl = new URL("../world-cell-theater.html", import.meta.url);

test("mobile boot watchdog cannot preempt a running module graph", async () => {
  const theater = await readFile(theaterUrl, "utf8");
  assert.match(theater, /dataset\.worldCellMode = "booting"/);
  assert.match(theater, /dataset\.worldCellBoot = "html-ready"/);
  assert.match(theater, /timeoutMs = 30000/);
  assert.match(theater, /worldCellMode !== "booting"/);
  assert.match(theater, /onerror="document\.documentElement\.dataset\.worldCellMode='boot-error'"/);
});
