export interface KeyxymV26ArtifactRecord { bytes: number; sha256: string }

export interface KeyxymV26Manifest {
  schema: "keyxym.browser-runtime-provenance/v6";
  version: "0.26.0";
  abi: "keyxym-v26-reality-authority-1";
  perception_abi: "keyxym-v26-calibrated-cpp-frontend-v1";
  source_repository: "JROChub/keyxym_map";
  source_commit: string;
  source_exact: true;
  derivation: "source-exact-external-validation-build";
  maximum_surfels: 48000;
  maximum_analysis_width: 320;
  maximum_analysis_height: 240;
  maximum_tracks: 384;
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
    exact_blob_matrix_run: 29439226477;
    gcc: true;
    asan_ubsan: true;
    msvc: true;
    mobile_sdk: true;
    wasm_runtime: true;
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

const SOURCE = "c94d4db57d1db89e96cb7fd860da2d4c1617f516";
const MODULE_SHA256 = "0d9f9921b01546051eacf7d0cf79f9b70e8b206dc455b833437fd992a737c7e5";
const WASM_SHA256 = "89c66a4c8465ef8db10b6c40d4fdd3dc7d9c662d728cbd80d824a2ef27ea7d0e";
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
  if (manifest.schema !== "keyxym.browser-runtime-provenance/v6" || manifest.version !== "0.26.0" ||
      manifest.abi !== "keyxym-v26-reality-authority-1" || manifest.perception_abi !== "keyxym-v26-calibrated-cpp-frontend-v1" ||
      manifest.source_repository !== "JROChub/keyxym_map" || manifest.source_commit !== SOURCE || manifest.source_exact !== true ||
      manifest.derivation !== "source-exact-external-validation-build" || manifest.maximum_surfels !== 48_000 ||
      manifest.maximum_analysis_width !== 320 || manifest.maximum_analysis_height !== 240 || manifest.maximum_tracks !== 384 ||
      manifest.maximum_preview_samples !== 8_192 || manifest.timestamp_abi !== "wasm-bigint-i64" || manifest.pose_floats !== 27 ||
      manifest.quality_floats !== 8 || manifest.authority_floats !== 8 || manifest.preview_record_floats !== 10 ||
      manifest.geometry_record_floats !== 13 || manifest.receipt_bytes !== 96 || manifest.toolchain.name !== "Emscripten" ||
      manifest.toolchain.version !== "6.0.3" || manifest.toolchain.release_commit !== EMSCRIPTEN_RELEASE ||
      manifest.toolchain.official_package_sha256 !== EMSCRIPTEN_PACKAGE || manifest.validation.exact_blob_matrix_run !== 29439226477 ||
      !manifest.validation.gcc || !manifest.validation.asan_ubsan || !manifest.validation.msvc || !manifest.validation.mobile_sdk || !manifest.validation.wasm_runtime ||
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
