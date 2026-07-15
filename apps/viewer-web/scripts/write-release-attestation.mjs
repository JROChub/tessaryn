import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const APP_DIRECTORY = resolve(SCRIPT_DIRECTORY, "..");
const DIST_DIRECTORY = resolve(
  APP_DIRECTORY,
  process.env.TESSARYN_DIST_DIRECTORY || "dist",
);
const RELEASE_FILE = "release.json";
const HEX_COMMIT = /^[0-9a-f]{40}$/u;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

function requiredEnvironment(name, pattern) {
  const value = process.env[name]?.trim() ?? "";
  if (!pattern.test(value)) {
    throw new Error(`${name} is missing or malformed`);
  }
  return value;
}

async function parseJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function inventory(directory, root = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`release distribution contains a symbolic link: ${absolute}`);
    }
    if (entry.isDirectory()) {
      files.push(...await inventory(absolute, root));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`release distribution contains a non-file entry: ${absolute}`);
    }
    const path = relative(root, absolute).split(sep).join("/");
    if (path === RELEASE_FILE) continue;
    const bytes = await readFile(absolute);
    files.push({
      path,
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function requireManifestValue(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} is missing from its provenance manifest`);
  }
  return value;
}

const sourceCommit = requiredEnvironment("TESSARYN_SOURCE_COMMIT", HEX_COMMIT);
const repository = requiredEnvironment("TESSARYN_REPOSITORY", REPOSITORY);
const conformanceRunId = requiredEnvironment("TESSARYN_CONFORMANCE_RUN_ID", POSITIVE_INTEGER);
const conformanceRunAttempt = requiredEnvironment(
  "TESSARYN_CONFORMANCE_RUN_ATTEMPT",
  POSITIVE_INTEGER,
);
const deploymentRunId = requiredEnvironment("TESSARYN_DEPLOYMENT_RUN_ID", POSITIVE_INTEGER);
const deploymentRunAttempt = requiredEnvironment(
  "TESSARYN_DEPLOYMENT_RUN_ATTEMPT",
  POSITIVE_INTEGER,
);

const packageManifest = await parseJson(join(APP_DIRECTORY, "package.json"));
const keyxymManifest = await parseJson(join(DIST_DIRECTORY, "keyxym-v26", "manifest.json"));
const assuranceManifest = await parseJson(join(DIST_DIRECTORY, "assurance", "manifest.json"));
const assets = await inventory(DIST_DIRECTORY);

for (const requiredPath of [
  "index.html",
  "world-cell-theater.html",
  "sw.js",
  "keyxym-v26/manifest.json",
  "keyxym-v26/keyxym-v26.mjs",
  "keyxym-v26/keyxym-v26.wasm",
  "assurance/manifest.json",
  "assurance/tessaryn-browser-assurance-v1.wasm",
]) {
  if (!assets.some((asset) => asset.path === requiredPath)) {
    throw new Error(`release distribution is missing ${requiredPath}`);
  }
}

const release = {
  schema: "tessaryn/deployment-attestation/v1",
  product: "TESSARYN Origin",
  version: requireManifestValue(packageManifest.version, "viewer version"),
  source: {
    repository,
    branch: "main",
    commit: sourceCommit,
  },
  qualification: {
    workflow: "conformance",
    conclusion: "success",
    run_id: Number(conformanceRunId),
    run_attempt: Number(conformanceRunAttempt),
    head_commit: sourceCommit,
  },
  deployment: {
    workflow: "deploy-origin",
    environment: "github-pages",
    run_id: Number(deploymentRunId),
    run_attempt: Number(deploymentRunAttempt),
    source_commit: sourceCommit,
  },
  authority: {
    keyxym: {
      version: requireManifestValue(keyxymManifest.version, "Keyxym version"),
      abi: requireManifestValue(keyxymManifest.abi, "Keyxym ABI"),
      source_repository: requireManifestValue(
        keyxymManifest.source_repository,
        "Keyxym source repository",
      ),
      source_commit: requireManifestValue(keyxymManifest.source_commit, "Keyxym source commit"),
      source_exact: keyxymManifest.source_exact === true,
    },
    browser_assurance: {
      profile: requireManifestValue(assuranceManifest.profile, "assurance profile"),
      provider: requireManifestValue(assuranceManifest.provider, "assurance provider"),
      source_repository: requireManifestValue(
        assuranceManifest.source_repository,
        "assurance source repository",
      ),
      source_commit: requireManifestValue(
        assuranceManifest.source_commit,
        "assurance source commit",
      ),
    },
  },
  distribution: {
    algorithm: "sha256",
    files: assets,
  },
};

await stat(DIST_DIRECTORY);
await writeFile(
  join(DIST_DIRECTORY, RELEASE_FILE),
  `${JSON.stringify(release, null, 2)}\n`,
  { encoding: "utf8", mode: 0o644 },
);
console.log(`wrote ${RELEASE_FILE} for ${sourceCommit} with ${String(assets.length)} files`);
