export interface KeyxymArtifactRecord {
  bytes: number;
  sha256: string;
}

export type KeyxymTimestampAbi = "wasm-bigint" | "legalized-i64-low-high";

export interface KeyxymProvenanceManifest {
  schema: "tessaryn.keyxym-wasm-provenance/v1";
  version: "0.22.0";
  abi: "keyxym-v22-packed-1";
  source_repository: "JROChub/keyxym_map";
  source_commit: string;
  maximum_surfels: 48000;
  wasm_bigint: boolean;
  timestamp_abi: KeyxymTimestampAbi;
  workflow_run?: number;
  artifact_id?: number;
  artifacts: {
    "keyxym-v22.mjs": KeyxymArtifactRecord;
    "keyxym-v22.wasm": KeyxymArtifactRecord;
  };
}

const ROOT = "/keyxym";
const MANIFEST_URL = `${ROOT}/manifest.json`;
const MODULE_URL = `${ROOT}/keyxym-v22.mjs`;
const WASM_URL = `${ROOT}/keyxym-v22.wasm`;
const APPROVED_SOURCE_COMMIT = "3076c306126058c6e9b24d851681ae79a26b9b55";

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
  if (typeof WebAssembly !== "object") {
    throw new Error("Keyxym authority requires WebAssembly support");
  }

  const response = await fetch(MANIFEST_URL, {
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Keyxym provenance manifest unavailable (${response.status})`);
  const manifest = await response.json() as KeyxymProvenanceManifest;

  const timestampContractValid =
    (manifest.wasm_bigint === true && manifest.timestamp_abi === "wasm-bigint") ||
    (manifest.wasm_bigint === false && manifest.timestamp_abi === "legalized-i64-low-high");

  if (manifest.schema !== "tessaryn.keyxym-wasm-provenance/v1" ||
      manifest.version !== "0.22.0" ||
      manifest.abi !== "keyxym-v22-packed-1" ||
      manifest.source_repository !== "JROChub/keyxym_map" ||
      manifest.source_commit !== APPROVED_SOURCE_COMMIT ||
      manifest.maximum_surfels !== 48_000 ||
      !timestampContractValid) {
    throw new Error("Keyxym provenance manifest violates the v0.22 authority contract");
  }
  if (manifest.wasm_bigint && typeof BigInt !== "function") {
    throw new Error("This Keyxym runtime requires WebAssembly BigInt support");
  }

  const moduleRecord = requireArtifact(manifest, "keyxym-v22.mjs");
  const wasmRecord = requireArtifact(manifest, "keyxym-v22.wasm");
  const [moduleBytes, wasmBytes] = await Promise.all([
    fetchBytes(MODULE_URL),
    fetchBytes(WASM_URL),
  ]);

  if (moduleBytes.byteLength !== moduleRecord.bytes ||
      wasmBytes.byteLength !== wasmRecord.bytes) {
    throw new Error("Keyxym artifact byte length does not match provenance");
  }

  const [moduleDigest, wasmDigest] = await Promise.all([
    digest(moduleBytes),
    digest(wasmBytes),
  ]);
  if (moduleDigest !== moduleRecord.sha256 || wasmDigest !== wasmRecord.sha256) {
    throw new Error("Keyxym artifact digest does not match provenance");
  }

  const moduleText = new TextDecoder().decode(moduleBytes);
  for (const symbol of [
    "keyxym_v22_session_ingest_packed",
    "keyxym_v22_session_copy_geometry_packed",
    "keyxym_v22_session_quality_packed",
  ]) {
    if (!moduleText.includes(symbol)) throw new Error(`Keyxym module omits ${symbol}`);
  }

  return manifest;
}
