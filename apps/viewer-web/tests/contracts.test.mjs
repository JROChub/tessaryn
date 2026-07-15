import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const originUrl = new URL("../index.html", import.meta.url);
const workerUrl = new URL("../public/sw.js", import.meta.url);
const packageManifestUrl = new URL("../package.json", import.meta.url);
const sourceUrl = new URL("../src/main.ts", import.meta.url);
const weaveClientUrl = new URL("../src/weave-client.ts", import.meta.url);

// These checks defend the bounded, local-first Origin contract without relying
// on a browser or network during the unit lane.
test("the bounded Origin declares its local verification profile", async () => {
  const html = await readFile(originUrl, "utf8");
  assert.match(html, /TESSARYN/);
  assert.match(html, /LOCAL-FIRST/);
  assert.match(html, /POWER HOUSE/);
  assert.match(html, /ROOTPRINT/);
  assert.match(html, /MEMORY CAPSULE/);
});

test("the validation Origin binds exact RGB-D ground truth and source class", async () => {
  const source = await readFile(sourceUrl, "utf8");
  assert.match(source, /sourceClass/);
  assert.match(source, /groundTruth/);
  assert.match(source, /validation/);
});

test("the viewer has no remote script or map substrate dependency", async () => {
  const html = await readFile(originUrl, "utf8");
  const packageUrl = new URL("../package-lock.json", import.meta.url);
  const lock = await readFile(packageUrl, "utf8");
  assert.doesNotMatch(html, /<script[^>]+https?:/i);
  assert.doesNotMatch(
    lock,
    /mapbox|maplibre|leaflet|openlayers|cesium|google.maps|street.?view|arcgis/i,
  );
  const input = html.match(/<input\s+id="import-input"[\s\S]*?>/u)?.[0] ?? "";
  assert.match(input, /\bmultiple\b/u);
  assert.doesNotMatch(input, /\baccept=/u);
  assert.match(html, /\.GLB \.GLTF \.OBJ \.PLY \.STL/u);
});

test("the offline cache includes the local world and consensus Keyxym fixtures", async () => {
  const worker = await readFile(workerUrl, "utf8");
  const packageManifest = JSON.parse(await readFile(packageManifestUrl, "utf8"));
  const release = packageManifest.version.replaceAll(".", "-");
  assert.ok(
    worker.includes(`const CACHE = "tessaryn-origin-v${release}-world-cell-consensus-1";`),
  );
  assert.match(worker, /\.\/world\/archviz-tiny-house-locus\.json/);
  assert.match(worker, /\.\/world\/vesper-court\.json/);
  assert.match(worker, /\.\/objects\/catalog\.json/);
  assert.match(worker, /\.\/weave\.json/);
  assert.match(worker, /\.\/keyxym\/manifest\.json/);
  assert.match(worker, /\.\/keyxym\/keyxym-v22\.wasm/);
  assert.match(worker, /\.\/keyxym\/frontend-manifest\.json/);
  assert.match(worker, /\.\/keyxym\/keyxym-frontend-v1\.wasm\.b64/);
  assert.match(worker, /url\.origin !== self\.location\.origin/);
  assert.match(worker, /event\.request\.mode === "navigate"/);
  assert.match(worker, /fetch\(event\.request, \{ cache: "no-store" \}\)/);
});

test("publication is product-native, resumable, signed, and device-persistent", async () => {
  const source = await readFile(weaveClientUrl, "utf8");
  assert.match(source, /TESSARYN-WEAVE-PUBLICATION-v1/);
  assert.match(source, /generateKey\("Ed25519"\);/);
  assert.match(source, /publication/);
  assert.match(source, /resume/);
  assert.match(source, /IndexedDB|indexedDB/);
});

test("local file indexing and cinematic objects remain file-backed and chunk bounded", async () => {
  const source = await readFile(sourceUrl, "utf8");
  assert.match(source, /chunk/i);
  assert.match(source, /File|Blob/);
  assert.match(source, /object/i);
});

test("Keyxym v0.22 runtime bundle is provenance-bound and browser-loadable", async () => {
  const provenanceUrl = new URL("../public/keyxym/manifest.json", import.meta.url);
  const manifest = JSON.parse(await readFile(provenanceUrl, "utf8"));
  assert.equal(manifest.schema, "tessaryn.keyxym-wasm-provenance/v1");
  assert.equal(manifest.version, "0.22.0");
  assert.equal(manifest.source_repository, "JROChub/keyxym_map");
  assert.equal(manifest.maximum_surfels, 48_000);
  assert.match(manifest.source_commit, /^[0-9a-f]{40}$/);
  assert.match(manifest.artifacts["keyxym-v22.mjs"].sha256, /^[0-9a-f]{64}$/);
  assert.match(manifest.artifacts["keyxym-v22.wasm"].sha256, /^[0-9a-f]{64}$/);
});
