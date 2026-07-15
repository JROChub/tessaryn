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
const mainUrl = new URL("../src/main.ts", import.meta.url);
const localIdentityUrl = new URL("../src/local-file-identity.ts", import.meta.url);
const localWorkerUrl = new URL("../src/local-ingest-worker.ts", import.meta.url);
const cinematicObjectUrl = new URL("../src/cinematic-object.ts", import.meta.url);
const sourceGeometryUrl = new URL("../src/source-geometry.ts", import.meta.url);
const weaveClientUrl = new URL("../src/weave-client.ts", import.meta.url);

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
  const input = html.match(/<input\s+id="import-input"[\s\S]*?>/u)?.[0] ?? "";
  assert.match(input, /\bmultiple\b/u);
  assert.doesNotMatch(input, /\baccept=/u);
  assert.match(html, /\.GLB \.GLTF \.OBJ \.PLY \.STL/u);
});

test("the offline cache includes local worlds and verified authority runtimes", async () => {
  const worker = await readFile(workerUrl, "utf8");
  const packageManifest = JSON.parse(await readFile(packageManifestUrl, "utf8"));
  const release = packageManifest.version.replaceAll(".", "-");
  assert.ok(
    worker.includes(`const CACHE = "tessaryn-origin-v${release}-world-cell-v22";`),
  );
  for (const asset of [
    "./world/archviz-tiny-house-locus.json",
    "./world/vesper-court.json",
    "./objects/catalog.json",
    "./weave.json",
    "./keyxym/manifest.json",
    "./keyxym/build-closure.json",
    "./keyxym/keyxym-v22.mjs",
    "./keyxym/keyxym-v22.wasm",
    "./assurance/manifest.json",
    "./assurance/tessaryn-browser-assurance-v1.wasm",
  ]) {
    assert.ok(worker.includes(`"${asset}"`), `offline cache omits ${asset}`);
  }
  assert.match(worker, /url\.origin !== self\.location\.origin/);
  assert.match(worker, /event\.request\.mode === "navigate"/);
});

test("publication is product-native, resumable, signed, and device-persistent", async () => {
  const source = await readFile(weaveClientUrl, "utf8");
  assert.match(source, /TESSARYN-WEAVE-PUBLICATION-v1/);
  assert.match(source, /generateKey\("Ed25519"/);
  assert.match(source, /importKey\([\s\S]*?false,[\s\S]*?\["sign"\]/);
  assert.match(source, /\\u202a-\\u202e/);
  assert.match(source, /missing_chunks/);
  assert.match(source, /x-tessaryn-chunk-sha256/);
  assert.match(source, /navigator\.storage\.getDirectory/);
  assert.match(source, /publication-revocation\/v1/);
  assert.doesNotMatch(source, /github\.com|api\.github/);
});

test("local file indexing and cinematic objects remain file-backed and chunk bounded", async () => {
  const [main, identity, localWorker, cinematic, sourceGeometry] = await Promise.all([
    readFile(mainUrl, "utf8"),
    readFile(localIdentityUrl, "utf8"),
    readFile(localWorkerUrl, "utf8"),
    readFile(cinematicObjectUrl, "utf8"),
    readFile(sourceGeometryUrl, "utf8"),
  ]);
  assert.doesNotMatch(main, /MAX_IMPORT_BYTES|EXCEEDS 128 MIB/);
  assert.doesNotMatch(main, /localVideo|<video|presentLocalMedia/);
  assert.match(identity, /LOCAL_FILE_CHUNK_BYTES = 4 \* 1024 \* 1024/);
  assert.match(identity, /TESSARYN-LOCAL-FILE-v1/);
  assert.match(identity, /while \(peaks\.at\(-1\)\?\.height === peak\.height\)/);
  assert.match(localWorker, /calculateLocalFileIdentity/);
  assert.match(cinematic, /\.slice\(payloadOffset \+ offset/);
  assert.match(cinematic, /calculateChunkMerkleRoot/);
  assert.match(cinematic, /verifyCellProofBundle/);
  assert.match(sourceGeometry, /GLTFLoader/);
  assert.match(sourceGeometry, /OBJLoader/);
  assert.match(sourceGeometry, /PLYLoader/);
  assert.match(sourceGeometry, /STLLoader/);
  assert.match(sourceGeometry, /validateFinitePositions/);
});
