import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const pages = ["index.html", "world-cell-theater.html", "personal-weave.html", "keyxym-mobile.html"];
const read = (path) => readFile(new URL(path, root), "utf8");

test("every product page remains connected to Origin and World Cell capture", async () => {
  const content = Object.fromEntries(await Promise.all(pages.map(async (page) => [page, await read(page)])));
  for (const page of pages.filter((page) => page !== "index.html")) {
    assert.match(content[page], /href="\.\/"/u, `${page} lost its Origin route`);
  }
  for (const page of ["personal-weave.html", "keyxym-mobile.html"]) {
    assert.match(content[page], /href="\.\/world-cell-theater\.html"/u, `${page} lost World Cell capture`);
  }
  assert.match(await read("vite.config.ts"), /id="world-cell-command"/u);
  assert.match(content["world-cell-theater.html"], /id="open-model-button"/u);
  assert.match(content["world-cell-theater.html"], /id="download-model-button"/u);
  assert.match(content["world-cell-theater.html"], /id="export-cell-button"/u);
});

test("all static page links resolve to shipped product files", async () => {
  for (const page of pages) {
    const html = await read(page);
    for (const match of html.matchAll(/href="(\.\/[^"]*)"/gu)) {
      const href = match[1];
      if (href === "./" || href.includes("release.json")) continue;
      const target = href.slice(2).split(/[?#]/u)[0];
      await access(new URL(target, root)).catch(() => access(new URL(`public/${target}`, root)));
    }
  }
});

test("World Cell model handoff preserves native triangles and scale classification", async () => {
  const [runtime, modelExport, origin, weave] = await Promise.all([
    read("src/world-cell-theater-v26.ts"),
    read("src/world-cell-export.ts"),
    read("src/main.ts"),
    read("src/personal-weave.ts"),
  ]);
  assert.match(runtime, /worldCellSurfacePly\(this\.surfaceSnapshot\.vertices, metric\)/u);
  assert.match(runtime, /surfaceSnapshot\.vertices\.length >= 48/u);
  assert.match(modelExport, /scale \$\{metric \? "metric_meters" : "relative_units"\}/u);
  assert.match(modelExport, /vertices\.length % 3 !== 0/u);
  assert.doesNotMatch(modelExport, /triangulat|poisson|convexHull/iu);
  assert.match(origin, /takeOriginFile\(handoffId\)/u);
  assert.match(origin, /await routeLocalFiles\(\[file\]\)/u);
  assert.match(origin, /ownsCondensationPresentation\(\)/u);
  assert.match(origin, /dataset\.source === "reference" \|\| elements\.app\.dataset\.source === "validation"/u);
  assert.match(weave, /listConstructions\(\)/u);
  assert.match(weave, /OPEN IN ORIGIN/u);
});
