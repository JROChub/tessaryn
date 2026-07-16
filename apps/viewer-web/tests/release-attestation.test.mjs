import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const appDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const script = join(appDirectory, "scripts", "write-release-attestation.mjs");
const sourceCommit = "0123456789abcdef0123456789abcdef01234567";
const packageManifest = JSON.parse(await readFile(join(appDirectory, "package.json"), "utf8"));

async function write(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "tessaryn-release-"));
  const files = {
    "index.html": "<!doctype html><title>TESSARYN</title>\n",
    "world-cell-theater.html": "<!doctype html><title>World Cell</title>\n",
    "sw.js": "self.addEventListener('fetch', () => undefined);\n",
    "keyxym-v26/keyxym-v26.mjs": "export default function Keyxym() {}\n",
    "keyxym-v26/keyxym-v26.wasm": Buffer.from([0x00, 0x61, 0x73, 0x6d]),
    "assurance/tessaryn-browser-assurance-v1.wasm": Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01]),
    "assets/app.js": "console.log('tessaryn');\n",
  };
  for (const [path, content] of Object.entries(files)) {
    await write(join(directory, path), content);
  }
  await write(
    join(directory, "keyxym-v26", "manifest.json"),
    `${JSON.stringify({
      abi: "keyxym-v26-reality-authority-1",
      source_commit: "c94d4db57d1db89e96cb7fd860da2d4c1617f516",
      source_exact: true,
      source_repository: "JROChub/keyxym_map",
      version: "0.26.0",
    })}\n`,
  );
  await write(
    join(directory, "assurance", "manifest.json"),
    `${JSON.stringify({
      profile: "eform/world-cell-assurance/v1",
      provider: "tessaryn-browser-assurance::ed25519-dalek/2.2.0",
      source_commit: "ecfa0f6584f8890afd4a3a44b4aa972b2768a62e",
      source_repository: "JROChub/tessaryn",
    })}\n`,
  );
  await write(join(directory, "release.json"), "{\"mode\":\"development\"}\n");
  return { directory, files };
}

function run(directory, overrides = {}) {
  return spawnSync(process.execPath, [script], {
    cwd: appDirectory,
    encoding: "utf8",
    env: {
      ...process.env,
      TESSARYN_DIST_DIRECTORY: directory,
      TESSARYN_SOURCE_COMMIT: sourceCommit,
      TESSARYN_REPOSITORY: "JROChub/tessaryn",
      TESSARYN_CONFORMANCE_RUN_ID: "301",
      TESSARYN_CONFORMANCE_RUN_ATTEMPT: "2",
      TESSARYN_DEPLOYMENT_RUN_ID: "401",
      TESSARYN_DEPLOYMENT_RUN_ATTEMPT: "3",
      ...overrides,
    },
  });
}

test("release attestation binds the qualified commit and every deployed file deterministically", async (t) => {
  const { directory, files } = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));

  const first = run(directory);
  assert.equal(first.status, 0, first.stderr);
  const firstBytes = await readFile(join(directory, "release.json"));
  const release = JSON.parse(firstBytes.toString("utf8"));

  assert.equal(release.schema, "tessaryn/deployment-attestation/v1");
  assert.equal(release.version, packageManifest.version);
  assert.equal(release.source.commit, sourceCommit);
  assert.equal(release.qualification.head_commit, sourceCommit);
  assert.equal(release.qualification.run_id, 301);
  assert.equal(release.qualification.run_attempt, 2);
  assert.equal(release.deployment.source_commit, sourceCommit);
  assert.equal(release.deployment.run_id, 401);
  assert.equal(release.deployment.run_attempt, 3);
  assert.equal(release.authority.keyxym.version, "0.26.0");
  assert.equal(release.authority.keyxym.source_exact, true);
  assert.equal(release.authority.browser_assurance.profile, "eform/world-cell-assurance/v1");
  assert.equal("generated_at" in release, false);

  const paths = release.distribution.files.map((entry) => entry.path);
  assert.deepEqual(paths, [...paths].sort());
  assert.equal(paths.includes("release.json"), false);
  for (const [path, content] of Object.entries(files)) {
    const entry = release.distribution.files.find((candidate) => candidate.path === path);
    assert.ok(entry, `attestation omits ${path}`);
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
    assert.equal(entry.bytes, bytes.byteLength);
    assert.equal(entry.sha256, createHash("sha256").update(bytes).digest("hex"));
  }

  const second = run(directory);
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(await readFile(join(directory, "release.json")), firstBytes);
});

test("release attestation rejects malformed or unqualified deployment identity", async (t) => {
  const { directory } = await fixture();
  t.after(() => rm(directory, { recursive: true, force: true }));

  const malformedCommit = run(directory, { TESSARYN_SOURCE_COMMIT: "main" });
  assert.notEqual(malformedCommit.status, 0);
  assert.match(malformedCommit.stderr, /TESSARYN_SOURCE_COMMIT is missing or malformed/u);

  const missingRun = run(directory, { TESSARYN_CONFORMANCE_RUN_ID: "0" });
  assert.notEqual(missingRun.status, 0);
  assert.match(missingRun.stderr, /TESSARYN_CONFORMANCE_RUN_ID is missing or malformed/u);
});
