export interface KeyxymArtifactRecord {
  bytes: number;
  sha256: string;
}

export interface KeyxymBuildClosure {
  schema: "keyxym.browser-build-closure/v1";
  source_repository: "JROChub/keyxym_map";
  source_commit: string;
  source_exact: false;
  derivation: string;
  closure_digest_sha256: string;
  toolchain: {
    name: "Emscripten";
    version: string;
    release_commit: string;
    official_package_sha256: string;
  };
  compiled_files: Record<string, {
    bytes: number;
    sha256: string;
    git_blob: string;
    upstream_git_blob: string;
    byte_identical_to_upstream: boolean;
  }>;
  validation: string[];
}

export interface KeyxymProvenanceManifest {
  schema: "keyxym.browser-runtime-provenance/v4";
  version: "0.22.0";
  abi: "keyxym-v22-browser-dual-field-4";
  perception_abi: "keyxym-v22-browser-frontend-cpp-v1";
  source_repository: "JROChub/keyxym_map";
  source_commit: string;
  build_provenance: "independent-audited-semantic-closure";
  source_exact: false;
  build_closure_schema: "keyxym.browser-build-closure/v1";
  build_closure_digest: string;
  maximum_surfels: 48000;
  maximum_analysis_width: 320;
  maximum_analysis_height: 240;
  maximum_tracks: 384;
  maximum_preview_samples: 8192;
  timestamp_abi: "wasm-bigint-i64";
  feature_record_floats: 6;
  preview_record_floats: 10;
  geometry_record_floats: 13;
  receipt_bytes: 64;
  artifacts: {
    "build-closure.json": KeyxymArtifactRecord;
    "keyxym-v22.mjs": KeyxymArtifactRecord;
    "keyxym-v22.wasm": KeyxymArtifactRecord;
  };
}

const ROOT = "/keyxym";
const MANIFEST_URL = `${ROOT}/manifest.json`;
const CLOSURE_URL = `${ROOT}/build-closure.json`;
const MODULE_URL = `${ROOT}/keyxym-v22.mjs`;
const WASM_URL = `${ROOT}/keyxym-v22.wasm`;
const APPROVED_SOURCE_COMMIT = "700cb523ef9c1fb37733ffd1b1cbe0227be420c3";
const APPROVED_CLOSURE_DIGEST = "c910d501234def82e3551ddcc59d2482bfd694c6d9849bd62dce2a6380b614b8";
const APPROVED_TOOLCHAIN_PACKAGE = "3f32b91a3f8d405846ccacee911f9364da75f413fbd11ea1f3f7f23bf9d07cf3";
const HASH = /^[0-9a-f]{64}$/;
const GIT_BLOB = /^[0-9a-f]{40}$/;

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (value) =>
    value.toString(16).padStart(2, "0")).join("");
}

async function digest(bytes: ArrayBuffer): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", bytes));
}

function requireArtifact(
  manifest: KeyxymProvenanceManifest,
  name: keyof KeyxymProvenanceManifest["artifacts"],
): KeyxymArtifactRecord {
  const artifact = manifest.artifacts[name];
  if (!artifact || !Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0 ||
      !HASH.test(artifact.sha256)) {
    throw new Error(`Invalid Keyxym provenance record for ${name}`);
  }
  return artifact;
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Keyxym artifact unavailable: ${url} (${response.status})`);
  return response.arrayBuffer();
}

function verifyClosure(closure: KeyxymBuildClosure, manifest: KeyxymProvenanceManifest): void {
  if (closure.schema !== "keyxym.browser-build-closure/v1" ||
      closure.source_repository !== manifest.source_repository ||
      closure.source_commit !== manifest.source_commit ||
      closure.source_exact !== false ||
      closure.closure_digest_sha256 !== manifest.build_closure_digest ||
      closure.closure_digest_sha256 !== APPROVED_CLOSURE_DIGEST ||
      closure.toolchain.name !== "Emscripten" ||
      closure.toolchain.release_commit !== "9074aa513b501925adb1361e208932ad32a29a5f" ||
      closure.toolchain.official_package_sha256 !== APPROVED_TOOLCHAIN_PACKAGE ||
      !closure.derivation.includes("never represented as a byte-identical checkout")) {
    throw new Error("Keyxym build closure violates the approved derivation contract");
  }

  const requiredFiles = [
    "src/sha256.cpp",
    "src/v20.cpp",
    "src/v22.cpp",
    "src/v22_c_api.cpp",
    "src/v22_browser_frontend.cpp",
    "src/v22_browser_runtime.cpp",
    "include/keyxym/v22.hpp",
    "include/keyxym/v22_c_api.h",
    "include/keyxym/v22_browser_frontend.hpp",
    "include/keyxym/v22_browser_runtime.h",
  ];
  for (const path of requiredFiles) {
    const file = closure.compiled_files[path];
    if (!file || !Number.isSafeInteger(file.bytes) || file.bytes <= 0 ||
        !HASH.test(file.sha256) || !GIT_BLOB.test(file.git_blob) ||
        !GIT_BLOB.test(file.upstream_git_blob)) {
      throw new Error(`Keyxym build closure omits ${path}`);
    }
  }

  for (const required of [
    "upstream tests/test_v022_browser_frontend.cpp passed unchanged",
    "upstream tests/test_v022_browser_runtime.cpp passed unchanged",
    "native and WebAssembly pose/quality receipts matched byte-for-byte for a three-frame translated texture vector",
    "native and WebAssembly geometry counts matched at 227 surfels",
    "WebAssembly replayed timestamp rejected with KEYXYM_V22_INVALID_ARGUMENT",
  ]) {
    if (!closure.validation.includes(required)) {
      throw new Error(`Keyxym build closure omits validation: ${required}`);
    }
  }
}

export async function verifyKeyxymV22Bundle(): Promise<KeyxymProvenanceManifest> {
  if (!globalThis.isSecureContext) {
    throw new Error("Keyxym authority requires a secure browser context");
  }
  if (typeof WebAssembly !== "object" || typeof BigInt !== "function") {
    throw new Error("Keyxym authority requires WebAssembly BigInt support");
  }

  const response = await fetch(MANIFEST_URL, {
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Keyxym provenance manifest unavailable (${response.status})`);
  const manifest = await response.json() as KeyxymProvenanceManifest;

  if (manifest.schema !== "keyxym.browser-runtime-provenance/v4" ||
      manifest.version !== "0.22.0" ||
      manifest.abi !== "keyxym-v22-browser-dual-field-4" ||
      manifest.perception_abi !== "keyxym-v22-browser-frontend-cpp-v1" ||
      manifest.source_repository !== "JROChub/keyxym_map" ||
      manifest.source_commit !== APPROVED_SOURCE_COMMIT ||
      manifest.build_provenance !== "independent-audited-semantic-closure" ||
      manifest.source_exact !== false ||
      manifest.build_closure_schema !== "keyxym.browser-build-closure/v1" ||
      manifest.build_closure_digest !== APPROVED_CLOSURE_DIGEST ||
      manifest.maximum_surfels !== 48_000 ||
      manifest.maximum_analysis_width !== 320 ||
      manifest.maximum_analysis_height !== 240 ||
      manifest.maximum_tracks !== 384 ||
      manifest.maximum_preview_samples !== 8_192 ||
      manifest.timestamp_abi !== "wasm-bigint-i64" ||
      manifest.feature_record_floats !== 6 ||
      manifest.preview_record_floats !== 10 ||
      manifest.geometry_record_floats !== 13 ||
      manifest.receipt_bytes !== 64) {
    throw new Error("Keyxym provenance manifest violates the dual-field authority contract");
  }

  const closureRecord = requireArtifact(manifest, "build-closure.json");
  const moduleRecord = requireArtifact(manifest, "keyxym-v22.mjs");
  const wasmRecord = requireArtifact(manifest, "keyxym-v22.wasm");
  const [closureBytes, moduleBytes, wasmBytes] = await Promise.all([
    fetchBytes(CLOSURE_URL),
    fetchBytes(MODULE_URL),
    fetchBytes(WASM_URL),
  ]);

  if (closureBytes.byteLength !== closureRecord.bytes ||
      moduleBytes.byteLength !== moduleRecord.bytes ||
      wasmBytes.byteLength !== wasmRecord.bytes) {
    throw new Error("Keyxym artifact byte length does not match provenance");
  }

  const [closureDigest, moduleDigest, wasmDigest] = await Promise.all([
    digest(closureBytes),
    digest(moduleBytes),
    digest(wasmBytes),
  ]);
  if (closureDigest !== closureRecord.sha256 ||
      moduleDigest !== moduleRecord.sha256 ||
      wasmDigest !== wasmRecord.sha256) {
    throw new Error("Keyxym artifact digest does not match provenance");
  }

  const closure = JSON.parse(new TextDecoder().decode(closureBytes)) as KeyxymBuildClosure;
  verifyClosure(closure, manifest);
  await WebAssembly.compile(wasmBytes);

  const moduleText = new TextDecoder().decode(moduleBytes);
  for (const symbol of [
    "keyxym_v22_browser_session_create",
    "keyxym_v22_browser_session_destroy",
    "keyxym_v22_browser_ingest_rgba_packed",
    "keyxym_v22_browser_copy_receipts",
    "keyxym_v22_browser_copy_preview_packed",
    "keyxym_v22_browser_geometry_revision",
    "keyxym_v22_browser_copy_geometry_snapshot_packed",
    "keyxym_v22_session_quality_packed",
  ]) {
    if (!moduleText.includes(symbol)) throw new Error(`Keyxym module omits ${symbol}`);
  }

  return manifest;
}
