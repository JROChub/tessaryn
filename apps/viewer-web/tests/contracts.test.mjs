import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const fixtureUrl = new URL("../public/world/vesper-court.json", import.meta.url);
const htmlUrl = new URL("../index.html", import.meta.url);
const packageUrl = new URL("../package-lock.json", import.meta.url);
const packageManifestUrl = new URL("../package.json", import.meta.url);
const workerUrl = new URL("../public/sw.js", import.meta.url);

test("the bounded Origin declares its evidence state", async () => {
  const world = JSON.parse(await readFile(fixtureUrl, "utf8"));
  assert.equal(world.schema, "tessaryn/demo-world/v0");
  assert.equal(world.status, "reference-origin");
  assert.equal(world.cells.length, 18);
  assert.equal(world.moments.length, 3);
  assert.equal(world.cells.filter((cell) => cell.manifest.evidence.disputed).length, 2);
  assert.equal(world.cells.filter((cell) => cell.manifest.evidence.restricted).length, 1);
  assert.equal(world.origin_memory_capsule.header.producer.power_house_version, "0.3.24");
  assert.equal(world.origin_memory_capsule.header.producer.platform, null);
  assert.match(world.evidence_boundary, /physical truth is not claimed/i);
});

test("the viewer has no remote script or map substrate dependency", async () => {
  const html = await readFile(htmlUrl, "utf8");
  const lock = await readFile(packageUrl, "utf8");
  assert.doesNotMatch(html, /<script[^>]+https?:/i);
  assert.doesNotMatch(
    lock,
    /mapbox|maplibre|leaflet|openlayers|cesium|google.maps|street.?view|arcgis/i,
  );
});

test("the offline cache includes the local world fixture", async () => {
  const worker = await readFile(workerUrl, "utf8");
  const packageManifest = JSON.parse(await readFile(packageManifestUrl, "utf8"));
  const release = packageManifest.version.replaceAll(".", "-");
  assert.ok(worker.includes(`const CACHE = "tessaryn-origin-v${release}-portable1";`));
  assert.match(worker, /\.\/world\/vesper-court\.json/);
  assert.match(worker, /url\.origin !== self\.location\.origin/);
  assert.match(worker, /event\.request\.mode === "navigate"/);
});
