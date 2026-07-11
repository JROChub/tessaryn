import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const fixtureUrl = new URL("../public/world/vesper-court.json", import.meta.url);
const validationFixtureUrl = new URL(
  "../public/world/archviz-tiny-house-locus.json",
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

test("the validation Origin binds exact RGB-D ground truth and source class", async () => {
  const locus = JSON.parse(await readFile(validationFixtureUrl, "utf8"));
  assert.equal(locus.schema, "tessaryn/validation-locus-artifact/v1");
  assert.equal(locus.source.profile.dataset, "TartanAir V2");
  assert.equal(locus.source.profile.environment, "ArchVizTinyHouseDay");
  assert.equal(locus.source.profile.source_class, "synthetic_ground_truth");
  assert.equal(locus.source.profile.ground_truth.metric_depth, true);
  assert.equal(locus.source.profile.ground_truth.camera_pose, true);
  assert.equal(locus.source.profile.ground_truth.semantics, false);
  assert.equal(locus.source.profile.ground_truth.optical_flow, false);
  assert.deepEqual(
    locus.source.profile.assets.map((asset) => asset.sha256),
    [
      "sha256:83e6e680297af35aa83d594ea3ed254bf71e9d9da7b26fee6d0ccb29f25ac104",
      "sha256:9bea5fca9d0cf50105c7d34583d4d5db06e3715ef708262b4dfad763d34b17da",
    ],
  );
  assert.equal(locus.source.selected_frames, 48);
  assert.deepEqual(
    locus.source.selections.map((selection) => selection.id),
    ["moment-a", "moment-b", "moment-c", "alternate-c"],
  );
  for (const selection of locus.source.selections) {
    assert.equal(selection.frame_ids.length, 12);
    assert.equal(selection.captured_at_unix_us.length, 12);
    assert.equal(selection.source_indices.length, 12);
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
  assert.ok(worker.includes(`const CACHE = "tessaryn-origin-v${release}-validation-locus1";`));
  assert.match(worker, /\.\/world\/archviz-tiny-house-locus\.json/);
  assert.match(worker, /\.\/world\/vesper-court\.json/);
  assert.match(worker, /url\.origin !== self\.location\.origin/);
  assert.match(worker, /event\.request\.mode === "navigate"/);
});
