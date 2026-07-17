import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workerUrl = new URL("../public/sw.js", import.meta.url);

test("World Cell uses one network release instead of an offline shell fallback", async () => {
  const worker = await readFile(workerUrl, "utf8");
  assert.match(worker, /WORLD_CELL_PATH/);
  assert.match(worker, /CANONICAL_WORLD_CELL_PATH/);
  assert.match(worker, /fetch\(new Request\(event\.request, \{ cache: "no-store" \}\)\)/u);
  const theaterBranch = worker.slice(worker.indexOf("url.pathname === WORLD_CELL_PATH"));
  const theaterHandler = theaterBranch.slice(0, theaterBranch.indexOf("if (url.pathname === \"/mansion\""));
  assert.doesNotMatch(theaterHandler, /caches\.|networkFirst|fallback/u);
});
