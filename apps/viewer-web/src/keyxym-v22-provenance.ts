export interface KeyxymArtifactRecord {
  bytes: number;
  sha256: string;
}

export interface KeyxymProvenanceManifest {
  schema: "keyxym.browser-runtime-provenance/v4";
  version: "0.22.0";
  abi: "keyxym-v22-browser-dual-field-4";
  perception_abi: "keyxym-standalone-frontend-v1";
  source_repository: "JROChub/keyxym_map";
  source_commit: string;
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
    "keyxym-frontend-v1.wasm": KeyxymArtifactRecord;
    "keyxym-v22.mjs": KeyxymArtifactRecord;
    "keyxym-v22.wasm": KeyxymArtifactRecord;
  };
}

const ROOT = "/keyxym";
const MANIFEST_URL = `${ROOT}/manifest.json`;
const FRONTEND_URL = `${ROOT}/keyxym-frontend-v1.wasm`;
const MODULE_URL = `${ROOT}/keyxym-v22.mjs`;
const WASM_URL = `${ROOT}/keyxym-v22.wasm`;
const APPROVED_SOURCE_COMMIT = "700cb523ef9c1fb37733ffd1b1cbe0227be420c3";

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
      !/^[0-9a-f]{64}$/.test(artifact.sha256)) {
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
      manifest.perception_abi !== "keyxym-standalone-frontend-v1" ||
      manifest.source_repository !== "JROChub/keyxym_map" ||
      manifest.source_commit !== APPROVED_SOURCE_COMMIT ||
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

  const frontendRecord = requireArtifact(manifest, "keyxym-frontend-v1.wasm");
  const moduleRecord = requireArtifact(manifest, "keyxym-v22.mjs");
  const wasmRecord = requireArtifact(manifest, "keyxym-v22.wasm");
  const [frontendBytes, moduleBytes, wasmBytes] = await Promise.all([
    fetchBytes(FRONTEND_URL),
    fetchBytes(MODULE_URL),
    fetchBytes(WASM_URL),
  ]);

  if (frontendBytes.byteLength !== frontendRecord.bytes ||
      moduleBytes.byteLength !== moduleRecord.bytes ||
      wasmBytes.byteLength !== wasmRecord.bytes) {
    throw new Error("Keyxym artifact byte length does not match provenance");
  }

  const [frontendDigest, moduleDigest, wasmDigest] = await Promise.all([
    digest(frontendBytes),
    digest(moduleBytes),
    digest(wasmBytes),
  ]);
  if (frontendDigest !== frontendRecord.sha256 ||
      moduleDigest !== moduleRecord.sha256 ||
      wasmDigest !== wasmRecord.sha256) {
    throw new Error("Keyxym artifact digest does not match provenance");
  }

  await WebAssembly.compile(frontendBytes);
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
