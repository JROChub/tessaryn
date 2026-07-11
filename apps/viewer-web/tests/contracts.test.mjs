import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const fixtureUrl = new URL("../public/world/vesper-court.json", import.meta.url);
const temporalFixtureUrl = new URL(
  "../public/world/freiburg-desk-locus.json",
  import.meta.url,
);
const htmlUrl = new URL("../index.html", import.meta.url);
const packageUrl = new URL("../package-lock.json", import.meta.url);
const packageManifestUrl = new URL("../package.json", import.meta.url);
const workerUrl = new URL("../public/sw.js", import.meta.url);

test("the bounded Origin declares its local verification profile", async () => {
  const world = JSON.parse(await readFile(fixtureUrl, "utf8"));
  assert.equal(world.schema, "tessaryn/demo-world/v0");
  assert.equal(world.status, "reference-origin");
  assert.equal(world.cells.length, 18);
  assert.equal(world.moments.length, 3);
  assert.equal(world.cells.filter((cell) => cell.manifest.evidence.disputed).length, 2);
  assert.equal(world.cells.filter((cell) => cell.manifest.evidence.restricted).length, 1);
  assert.equal(world.origin_memory_capsule.header.producer.power_house_version, "0.3.24");
  assert.equal(world.origin_memory_capsule.header.producer.platform, null);
  assert.match(world.verification_profile, /Cell identity, PHA, Rootprint, replay/i);
});

test("the real temporal Origin binds exact RGB-D source selections", async () => {
  const locus = JSON.parse(await readFile(temporalFixtureUrl, "utf8"));
  assert.equal(locus.schema, "tessaryn/temporal-locus-artifact/v0");
  assert.equal(locus.source.dataset, "TUM RGB-D Benchmark / freiburg1_desk");
  assert.equal(
    locus.source.archive_sha256,
    "sha256:e983d6830916e66dc4a46a71368046b149b283de87769690e7aa4e0b9483530c",
  );
  assert.equal(locus.source.selected_frames, 48);
  assert.deepEqual(
    locus.source.selections.map((selection) => selection.id),
    ["moment-a", "moment-b", "moment-c", "alternate-c"],
  );
  for (const selection of locus.source.selections) {
    assert.equal(selection.frame_ids.length, 12);
    assert.equal(selection.captured_at_unix_us.length, 12);
  }
  assert.equal(locus.moments.length, 3);
  assert.equal(locus.alternate.id, "alternate-c");
  assert.equal(locus.lineage_report.branches_verified, 9);
  assert.equal(locus.source_proof.manifest.class, "aggregate");
  assert.equal(locus.source_proof_report.memory_capsule_valid, true);
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
  assert.ok(worker.includes(`const CACHE = "tessaryn-origin-v${release}-real-locus1";`));
  assert.match(worker, /\.\/world\/freiburg-desk-locus\.json/);
  assert.match(worker, /\.\/world\/vesper-court\.json/);
  assert.match(worker, /url\.origin !== self\.location\.origin/);
  assert.match(worker, /event\.request\.mode === "navigate"/);
});
