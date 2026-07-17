import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workerUrl = new URL("../public/sw.js", import.meta.url);

test("World Cell network failure cannot silently restore another release", async () => {
  const worker = await readFile(workerUrl, "utf8");
  const start = worker.indexOf("if (url.pathname === WORLD_CELL_PATH)");
  const end = worker.indexOf("if (url.pathname === \"/mansion\"", start);
  assert.ok(start >= 0 && end > start);
  const handler = worker.slice(start, end);
  assert.match(handler, /cache: "no-store"/);
  assert.match(handler, /CANONICAL_WORLD_CELL_PATH/);
  assert.doesNotMatch(handler, /catch|caches\.match|fallback/u);
});
