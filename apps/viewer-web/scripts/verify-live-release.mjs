import { createHash } from "node:crypto";

const origin = new URL(process.env.TESSARYN_LIVE_ORIGIN || "https://tessaryn.com/");
const expectedKeyxym = Object.freeze({
  abi: "keyxym-v26-reality-authority-spatial-surface-3",
  sourceCommit: "5758375618325d215ce9ed6ad96872f36179e188",
  wasmSha256: "48a9de27f8a212fabc2f4f72108109dad0fe166f1e81eef806da282f42aa6a85",
});
const expectedCommit = process.env.TESSARYN_EXPECTED_COMMIT?.trim() ?? "";
if (!/^[0-9a-f]{40}$/u.test(expectedCommit)) {
  throw new Error("TESSARYN_EXPECTED_COMMIT is missing or malformed");
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function fetchBytes(path) {
  const url = new URL(path, origin);
  url.searchParams.set("deployment_probe", `${Date.now()}-${Math.random()}`);
  const response = await fetch(url, {
    cache: "no-store",
    redirect: "follow",
    headers: { "cache-control": "no-cache", pragma: "no-cache" },
  });
  if (!response.ok) throw new Error(`${url.pathname} returned ${response.status}`);
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") ?? "",
    finalUrl: response.url,
  };
}

let release;
let lastError;
for (let attempt = 1; attempt <= 18; attempt += 1) {
  try {
    const result = await fetchBytes("release.json");
    release = JSON.parse(result.bytes.toString("utf8"));
    if (release?.source?.commit !== expectedCommit ||
        release?.qualification?.head_commit !== expectedCommit ||
        release?.deployment?.source_commit !== expectedCommit) {
      throw new Error(
        `release.json names ${release?.source?.commit ?? "no commit"}, expected ${expectedCommit}`,
      );
    }
    break;
  } catch (error) {
    lastError = error;
    if (attempt === 18) throw error;
    await delay(Math.min(30_000, 2_000 * attempt));
  }
}
if (!release) throw lastError ?? new Error("release.json was not available");
if (release.schema !== "tessaryn/deployment-attestation/v1" ||
    release.authority?.keyxym?.version !== "0.26.1" ||
    release.authority?.keyxym?.abi !== expectedKeyxym.abi ||
    release.authority?.keyxym?.source_commit !== expectedKeyxym.sourceCommit ||
    release.authority?.keyxym?.source_exact !== true) {
  throw new Error("live release attestation does not name the approved v0.26 authority");
}

const inventory = new Map(release.distribution?.files?.map((entry) => [entry.path, entry]) ?? []);
for (const path of [
  "index.html",
  "world-cell-theater.html",
  "world-cell-theater/index.html",
  "sw.js",
  "keyxym-v26/manifest.json",
  "keyxym-v26/keyxym-v26.mjs",
  "keyxym-v26/keyxym-v26.wasm",
  "assurance/manifest.json",
  "assurance/tessaryn-browser-assurance-v1.wasm",
]) {
  const record = inventory.get(path);
  if (!record || !Number.isSafeInteger(record.bytes) || !/^[0-9a-f]{64}$/u.test(record.sha256)) {
    throw new Error(`release inventory omits ${path}`);
  }
  const result = await fetchBytes(path);
  if (result.bytes.byteLength !== record.bytes || digest(result.bytes) !== record.sha256) {
    throw new Error(`live ${path} does not match release.json`);
  }
}

const keyxymManifestResult = await fetchBytes("keyxym-v26/manifest.json");
const keyxymManifest = JSON.parse(keyxymManifestResult.bytes.toString("utf8"));
if (keyxymManifest.schema !== "keyxym.browser-runtime-provenance/v11" ||
    keyxymManifest.abi !== expectedKeyxym.abi ||
    keyxymManifest.perception_abi !== "keyxym-v26-calibrated-spatial-triangle-surface-v3" ||
    keyxymManifest.source_commit !== expectedKeyxym.sourceCommit ||
    keyxymManifest.source_exact !== true ||
    keyxymManifest.artifacts?.["keyxym-v26.wasm"]?.sha256 !== expectedKeyxym.wasmSha256 ||
    keyxymManifest.validation?.metric_spatial_ingest !== true ||
    keyxymManifest.validation?.duplicate_geometry_suppressed !== true ||
    keyxymManifest.validation?.scale_only_metric_rejected !== true) {
  throw new Error("live Keyxym manifest does not name the qualified calibrated spatial authority");
}

const legacyTheater = (await fetchBytes("world-cell-theater.html")).bytes.toString("utf8");
if (!/type="module"[^>]+src="\.\/assets\//u.test(legacyTheater) ||
    !legacyTheater.includes('id="retained-source-frame"') ||
    legacyTheater.includes("/src/world-cell-authority-entry.ts")) {
  throw new Error("live legacy World Cell Theater route is not the built application entry");
}
const canonicalRoute = await fetchBytes("world-cell-theater/");
const canonicalTheater = canonicalRoute.bytes.toString("utf8");
const canonicalInventory = inventory.get("world-cell-theater/index.html");
const canonicalPath = new URL(canonicalRoute.finalUrl).pathname;
if (!canonicalInventory || canonicalRoute.bytes.byteLength !== canonicalInventory.bytes ||
    digest(canonicalRoute.bytes) !== canonicalInventory.sha256 ||
    !canonicalPath.endsWith("/world-cell-theater/")) {
  throw new Error("live canonical World Cell route does not resolve to its attested directory artifact");
}
if (!/<base href="\.\.\/">/u.test(canonicalTheater) ||
    !/type="module"[^>]+src="\.\.\/assets\//u.test(canonicalTheater) ||
    !canonicalTheater.includes('id="retained-source-frame"') ||
    canonicalTheater.includes("/src/world-cell-authority-entry.ts")) {
  throw new Error("live extensionless World Cell Theater route lacks its root asset contract");
}

const javascriptAssets = [...inventory.keys()].filter((path) =>
  /^assets\/.+\.js$/u.test(path));
if (javascriptAssets.length === 0) {
  throw new Error("release inventory contains no built JavaScript assets");
}
let applicationBytes = "";
for (const path of javascriptAssets) {
  const record = inventory.get(path);
  const result = await fetchBytes(path);
  if (!record || result.bytes.byteLength !== record.bytes || digest(result.bytes) !== record.sha256) {
    throw new Error(`live ${path} does not match release.json`);
  }
  applicationBytes += result.bytes.toString("utf8");
}
for (const marker of [
  "keyxym-v26-reality-authority-spatial-surface-3",
  "native-triangles",
  "relative-live-preview",
  "relative-native-triangles",
  "RELATIVE RECONSTRUCTION READY",
  "tessaryn/spatial-calibration/v1",
  "Metric capture requires an exact browser media-frame identity",
  "Host-verified synchronized RGB-D",
]) {
  if (!applicationBytes.includes(marker)) {
    throw new Error(`live release omits required spatial continuum marker: ${marker}`);
  }
}
for (const forbidden of ["camera-first-live-tracks", "FLOW PTS", "18,000 VIS"]) {
  if (applicationBytes.includes(forbidden)) {
    throw new Error(`live release still contains retired World Cell renderer marker: ${forbidden}`);
  }
}

console.log(`verified live TESSARYN deployment ${expectedCommit} at ${origin.href}`);
