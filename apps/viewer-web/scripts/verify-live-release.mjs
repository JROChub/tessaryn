import { createHash } from "node:crypto";

const origin = new URL(process.env.TESSARYN_LIVE_ORIGIN || "https://tessaryn.com/");
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
    release.authority?.keyxym?.version !== "0.26.0" ||
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

const legacyTheater = (await fetchBytes("world-cell-theater.html")).bytes.toString("utf8");
if (!/type="module"[^>]+src="\.\/assets\//u.test(legacyTheater) ||
    legacyTheater.includes("/src/world-cell-authority-entry.ts")) {
  throw new Error("live legacy World Cell Theater route is not the built application entry");
}
const canonicalRoute = await fetchBytes("world-cell-theater/");
const canonicalTheater = canonicalRoute.bytes.toString("utf8");
if (!/type="module"[^>]+src="\.\.\/assets\//u.test(canonicalTheater) ||
    canonicalTheater.includes("/src/world-cell-authority-entry.ts")) {
  throw new Error("live extensionless World Cell Theater route is not the built application entry");
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
  "tessaryn-world-cell-scan-v4",
  "world-cell-scan-v4",
  "START WORLD CELL SCAN",
  "NO DEFENSIBLE GEOMETRY",
  "relative-sparse-reconstruction",
]) {
  if (!applicationBytes.includes(marker)) {
    throw new Error(`live release omits required Scan V4 marker: ${marker}`);
  }
}
for (const forbidden of ["camera-first-live-tracks", "FLOW PTS", "18,000 VIS"]) {
  if (applicationBytes.includes(forbidden)) {
    throw new Error(`live release still contains retired World Cell renderer marker: ${forbidden}`);
  }
}

console.log(`verified live TESSARYN deployment ${expectedCommit} at ${origin.href}`);
