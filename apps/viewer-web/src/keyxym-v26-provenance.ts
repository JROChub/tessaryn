export interface KeyxymV26ArtifactRecord { bytes: number; sha256: string }

export interface KeyxymV26Manifest {
  schema: "keyxym.browser-runtime-provenance/v9";
  version: "0.26.0";
  abi: "keyxym-v26-reality-authority-1";
  perception_abi: "keyxym-v26-dense-photometric-surface-v1";
  source_repository: "JROChub/keyxym_map";
  source_commit: string;
  source_exact: true;
  derivation: "source-exact-reproducible-local-build";
  maximum_surfels: 48000;
  maximum_analysis_width: 320;
  maximum_analysis_height: 240;
  maximum_tracks: 768;
  maximum_preview_samples: 8192;
  timestamp_abi: "wasm-bigint-i64";
  pose_floats: 27;
  quality_floats: 8;
  authority_floats: 8;
  preview_record_floats: 10;
  geometry_record_floats: 13;
  receipt_bytes: 96;
  toolchain: {
    name: "Emscripten";
    version: "6.0.3";
    release_commit: string;
    official_package_sha256: string;
  };
  validation: {
    profile: "prxf/photographic-continuum-qualification/v3";
    reproducible_builds: 2;
    artifacts_identical: true;
    native_tests: 26;
    sanitizer_tests: 26;
    sanitizer_compilers: 2;
    mobile_sdk_tests: 25;
    wasm_runtime: true;
    middlebury_temple_ring_sha256: string;
    middlebury_views: 18;
    middlebury_recovered_frames: 10;
    middlebury_maximum_surfels: 2341;
    middlebury_terminal_surfels: 2341;
    middlebury_maximum_revision: 9;
    middlebury_maximum_confirmed_surfels: 909;
    middlebury_maximum_parallax_degrees: number;
    middlebury_moment_ready_frames: 2;
    middlebury_seal_ready_frames: 1;
    duplicate_geometry_suppressed: true;
  };
  artifacts: {
    "keyxym-v26.mjs": KeyxymV26ArtifactRecord;
    "keyxym-v26.wasm": KeyxymV26ArtifactRecord;
  };
}

export interface KeyxymV26AssetUrls {
  manifest: string;
  module: string;
  wasm: string;
}

const SOURCE = "2672ebe79655b3d78912b9332e24057b35772008";
const MODULE_SHA256 = "e6d8e6511cb57b4a5049ae81ae7fee50268d94d08a80991d6005f2b5587589bf";
const WASM_SHA256 = "ed18dc74a756ca4c95848036f72baa521d02a733350ce3e589ce4423186c8c52";
const EMSCRIPTEN_RELEASE = "9074aa513b501925adb1361e208932ad32a29a5f";
const EMSCRIPTEN_PACKAGE = "3f32b91a3f8d405846ccacee911f9364da75f413fbd11ea1f3f7f23bf9d07cf3";
const HASH = /^[0-9a-f]{64}$/;

function publicAssetUrl(path: string, parameters: Record<string, string>): string {
  const url = new URL(path, document.baseURI);
  for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value);
  return url.href;
}

export function keyxymV26AssetUrls(): KeyxymV26AssetUrls {
  return {
    manifest: publicAssetUrl("keyxym-v26/manifest.json", {
      source: SOURCE,
      contract: `${MODULE_SHA256}:${WASM_SHA256}`,
    }),
    module: publicAssetUrl("keyxym-v26/keyxym-v26.mjs", {
      source: SOURCE,
      sha256: MODULE_SHA256,
    }),
    wasm: publicAssetUrl("keyxym-v26/keyxym-v26.wasm", {
      source: SOURCE,
      sha256: WASM_SHA256,
    }),
  };
}

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
const digest = async (bytes: ArrayBuffer) => hex(await crypto.subtle.digest("SHA-256", bytes));

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", redirect: "error" });
  if (!response.ok) throw new Error(`Keyxym v0.26 artifact unavailable: ${new URL(url).pathname} (${response.status})`);
  return response.arrayBuffer();
}

function artifact(manifest: KeyxymV26Manifest, name: keyof KeyxymV26Manifest["artifacts"]): KeyxymV26ArtifactRecord {
  const record = manifest.artifacts[name];
  if (!record || !Number.isSafeInteger(record.bytes) || record.bytes <= 0 || !HASH.test(record.sha256)) throw new Error(`Invalid Keyxym v0.26 artifact record: ${name}`);
  return record;
}

export async function verifyKeyxymV26Bundle(): Promise<KeyxymV26Manifest> {
  if (!globalThis.isSecureContext) throw new Error("Keyxym v0.26 requires a secure browser context");
  if (typeof WebAssembly !== "object" || typeof BigInt !== "function" || !crypto.subtle) throw new Error("Keyxym v0.26 requires WebAssembly BigInt and Web Crypto");
  const urls = keyxymV26AssetUrls();
  const response = await fetch(urls.manifest, { cache: "no-store", credentials: "same-origin", redirect: "error" });
  if (!response.ok) throw new Error(`Keyxym v0.26 manifest unavailable (${response.status})`);
  const manifest = await response.json() as KeyxymV26Manifest;
  if (manifest.schema !== "keyxym.browser-runtime-provenance/v9" || manifest.version !== "0.26.0" ||
      manifest.abi !== "keyxym-v26-reality-authority-1" || manifest.perception_abi !== "keyxym-v26-dense-photometric-surface-v1" ||
      manifest.source_repository !== "JROChub/keyxym_map" || manifest.source_commit !== SOURCE || manifest.source_exact !== true ||
      manifest.derivation !== "source-exact-reproducible-local-build" || manifest.maximum_surfels !== 48_000 ||
      manifest.maximum_analysis_width !== 320 || manifest.maximum_analysis_height !== 240 || manifest.maximum_tracks !== 768 ||
      manifest.maximum_preview_samples !== 8_192 || manifest.timestamp_abi !== "wasm-bigint-i64" || manifest.pose_floats !== 27 ||
      manifest.quality_floats !== 8 || manifest.authority_floats !== 8 || manifest.preview_record_floats !== 10 ||
      manifest.geometry_record_floats !== 13 || manifest.receipt_bytes !== 96 || manifest.toolchain.name !== "Emscripten" ||
      manifest.toolchain.version !== "6.0.3" || manifest.toolchain.release_commit !== EMSCRIPTEN_RELEASE ||
      manifest.toolchain.official_package_sha256 !== EMSCRIPTEN_PACKAGE ||
      manifest.validation.profile !== "prxf/photographic-continuum-qualification/v3" ||
      manifest.validation.reproducible_builds !== 2 || !manifest.validation.artifacts_identical ||
      manifest.validation.native_tests !== 26 || manifest.validation.sanitizer_tests !== 26 ||
      manifest.validation.sanitizer_compilers !== 2 ||
      manifest.validation.mobile_sdk_tests !== 25 || !manifest.validation.wasm_runtime ||
      manifest.validation.middlebury_temple_ring_sha256 !== "5f871fe96d25f510eac026c66c3a4c38229326260986e9926cba8a64e88c8359" ||
      manifest.validation.middlebury_views !== 18 || manifest.validation.middlebury_recovered_frames !== 10 ||
      manifest.validation.middlebury_maximum_surfels !== 2341 || manifest.validation.middlebury_terminal_surfels !== 2341 ||
      manifest.validation.middlebury_maximum_revision !== 9 ||
      manifest.validation.middlebury_maximum_confirmed_surfels !== 909 ||
      manifest.validation.middlebury_maximum_parallax_degrees < 7.45 ||
      manifest.validation.middlebury_moment_ready_frames !== 2 ||
      manifest.validation.middlebury_seal_ready_frames !== 1 ||
      !manifest.validation.duplicate_geometry_suppressed ||
      Object.keys(manifest.artifacts).sort().join(",") !== "keyxym-v26.mjs,keyxym-v26.wasm") {
    throw new Error("Keyxym v0.26 provenance violates the reality-authority contract");
  }
  const moduleRecord = artifact(manifest, "keyxym-v26.mjs");
  const wasmRecord = artifact(manifest, "keyxym-v26.wasm");
  if (moduleRecord.sha256 !== MODULE_SHA256 || wasmRecord.sha256 !== WASM_SHA256) {
    throw new Error("Keyxym v0.26 manifest does not name the approved immutable artifacts");
  }
  const [moduleBytes, wasmBytes] = await Promise.all([fetchBytes(urls.module), fetchBytes(urls.wasm)]);
  if (moduleBytes.byteLength !== moduleRecord.bytes || wasmBytes.byteLength !== wasmRecord.bytes) throw new Error("Keyxym v0.26 artifact length mismatch");
  const [moduleHash, wasmHash] = await Promise.all([digest(moduleBytes), digest(wasmBytes)]);
  if (moduleHash !== moduleRecord.sha256 || wasmHash !== wasmRecord.sha256) throw new Error("Keyxym v0.26 artifact digest mismatch");
  await WebAssembly.compile(wasmBytes);
  const moduleText = new TextDecoder().decode(moduleBytes);
  for (const symbol of [
    "keyxym_v26_session_create", "keyxym_v26_session_destroy", "keyxym_v26_ingest_rgba_packed",
    "keyxym_v26_copy_receipts", "keyxym_v26_copy_preview_packed", "keyxym_v26_geometry_revision",
    "keyxym_v26_copy_geometry_snapshot_packed", "keyxym_v26_quality_packed", "keyxym_v26_authority_packed",
  ]) if (!moduleText.includes(symbol)) throw new Error(`Keyxym v0.26 module omits ${symbol}`);
  return manifest;
}
