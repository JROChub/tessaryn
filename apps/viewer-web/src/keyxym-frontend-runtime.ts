import { sha256 } from "@noble/hashes/sha2.js";

export const KEYXYM_FRONTEND_FEATURE_FLOATS = 6;
export const KEYXYM_FRONTEND_PREVIEW_FLOATS = 10;

export interface KeyxymFrontendFeature {
  id: number;
  x: number;
  y: number;
  score: number;
  disparity: number;
  matchError: number;
}

export interface KeyxymFormingSample {
  normalizedX: number;
  normalizedY: number;
  flowX: number;
  flowY: number;
  r: number;
  g: number;
  b: number;
  salience: number;
  trackSupport: number;
  age: number;
}

export interface KeyxymFrontendFrame {
  features: KeyxymFrontendFeature[];
  forming: KeyxymFormingSample[];
  sequence: bigint;
}

interface KeyxymFrontendManifest {
  schema: "keyxym.browser-perception-provenance/v1";
  abi: "keyxym-standalone-frontend-v1";
  source_repository: "JROChub/keyxym_map";
  source_commit: string;
  encoding: "base64";
  artifact: string;
  decoded_bytes: number;
  decoded_sha256: string;
  maximum_analysis_width: number;
  maximum_analysis_height: number;
  maximum_tracks: number;
  maximum_preview_samples: number;
  feature_record_floats: number;
  preview_record_floats: number;
}

interface KeyxymFrontendExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  keyxym_frontend_reset(): void;
  keyxym_frontend_rgba_ptr(): number;
  keyxym_frontend_rgba_capacity(): number;
  keyxym_frontend_ingest(width: number, height: number, rgbaBytes: number): number;
  keyxym_frontend_feature_count(): number;
  keyxym_frontend_features_ptr(): number;
  keyxym_frontend_preview_count(): number;
  keyxym_frontend_preview_ptr(): number;
  keyxym_frontend_sequence(): bigint;
}

const encoder = new TextEncoder();
const hex = (bytes: Uint8Array): string => Array.from(
  bytes,
  (value) => value.toString(16).padStart(2, "0"),
).join("");

function requireManifest(value: unknown): KeyxymFrontendManifest {
  if (!value || typeof value !== "object") throw new Error("Keyxym frontend manifest is invalid");
  const manifest = value as Partial<KeyxymFrontendManifest>;
  if (manifest.schema !== "keyxym.browser-perception-provenance/v1" ||
      manifest.abi !== "keyxym-standalone-frontend-v1" ||
      manifest.source_repository !== "JROChub/keyxym_map" ||
      manifest.encoding !== "base64" ||
      typeof manifest.artifact !== "string" ||
      !/^[0-9a-f]{40}$/.test(manifest.source_commit ?? "") ||
      !Number.isSafeInteger(manifest.decoded_bytes) ||
      !/^[0-9a-f]{64}$/.test(manifest.decoded_sha256 ?? "") ||
      manifest.feature_record_floats !== KEYXYM_FRONTEND_FEATURE_FLOATS ||
      manifest.preview_record_floats !== KEYXYM_FRONTEND_PREVIEW_FLOATS ||
      manifest.maximum_analysis_width !== 320 ||
      manifest.maximum_analysis_height !== 240 ||
      manifest.maximum_tracks !== 384 ||
      manifest.maximum_preview_samples !== 8192) {
    throw new Error("Keyxym frontend manifest contract mismatch");
  }
  return manifest as KeyxymFrontendManifest;
}

function decodeBase64(value: string): Uint8Array {
  const normalized = value.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new Error("Keyxym frontend artifact is not canonical base64");
  }
  const binary = atob(normalized);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    output[index] = binary.charCodeAt(index);
  }
  return output;
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const output = new Uint8Array(bytes.byteLength);
  output.set(bytes);
  return output.buffer;
}

function requireExports(value: WebAssembly.Exports): KeyxymFrontendExports {
  const required = [
    "memory",
    "keyxym_frontend_reset",
    "keyxym_frontend_rgba_ptr",
    "keyxym_frontend_rgba_capacity",
    "keyxym_frontend_ingest",
    "keyxym_frontend_feature_count",
    "keyxym_frontend_features_ptr",
    "keyxym_frontend_preview_count",
    "keyxym_frontend_preview_ptr",
    "keyxym_frontend_sequence",
  ];
  for (const name of required) {
    if (!(name in value)) throw new Error(`Keyxym frontend ABI missing ${name}`);
  }
  return value as KeyxymFrontendExports;
}

export class KeyxymFrontendRuntime {
  private constructor(
    private readonly exports: KeyxymFrontendExports,
    readonly sourceCommit: string,
  ) {}

  static async load(
    manifestUrl = "/keyxym/frontend-manifest.json",
  ): Promise<KeyxymFrontendRuntime> {
    const manifestResponse = await fetch(manifestUrl, { cache: "no-store" });
    if (!manifestResponse.ok) throw new Error(`Keyxym frontend manifest fetch failed (${manifestResponse.status})`);
    const manifest = requireManifest(await manifestResponse.json());
    const artifactUrl = new URL(manifest.artifact, new URL(manifestUrl, location.href));
    const artifactResponse = await fetch(artifactUrl, { cache: "no-store" });
    if (!artifactResponse.ok) throw new Error(`Keyxym frontend artifact fetch failed (${artifactResponse.status})`);
    const artifactText = await artifactResponse.text();
    const bytes = decodeBase64(artifactText);
    if (bytes.byteLength !== manifest.decoded_bytes) {
      throw new Error("Keyxym frontend artifact byte length mismatch");
    }
    if (hex(sha256(bytes)) !== manifest.decoded_sha256) {
      throw new Error("Keyxym frontend artifact digest mismatch");
    }
    const instantiated = await WebAssembly.instantiate(exactArrayBuffer(bytes), {});
    const exports = requireExports(instantiated.instance.exports);
    if (exports.keyxym_frontend_rgba_capacity() !== 320 * 240 * 4) {
      throw new Error("Keyxym frontend capacity mismatch");
    }
    exports.keyxym_frontend_reset();
    document.documentElement.dataset.keyxymFrontend = "verified";
    document.documentElement.dataset.keyxymFrontendCommit = manifest.source_commit;
    return new KeyxymFrontendRuntime(exports, manifest.source_commit);
  }

  ingest(rgba: Uint8ClampedArray, width: number, height: number): KeyxymFrontendFrame {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
        width < 16 || height < 16 || width > 320 || height > 240 ||
        rgba.byteLength !== width * height * 4) {
      throw new Error("Keyxym frontend frame is invalid");
    }
    const pointer = this.exports.keyxym_frontend_rgba_ptr();
    new Uint8Array(this.exports.memory.buffer, pointer, rgba.byteLength).set(
      new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength),
    );
    const status = this.exports.keyxym_frontend_ingest(width, height, rgba.byteLength);
    if (status !== 0) throw new Error(`Keyxym frontend ingest failed (${status})`);

    const featureCount = this.exports.keyxym_frontend_feature_count();
    if (!Number.isSafeInteger(featureCount) || featureCount < 0 || featureCount > 384) {
      throw new Error("Keyxym frontend returned an invalid feature count");
    }
    const featureValues = new Float32Array(
      this.exports.memory.buffer,
      this.exports.keyxym_frontend_features_ptr(),
      featureCount * KEYXYM_FRONTEND_FEATURE_FLOATS,
    ).slice();
    const features: KeyxymFrontendFeature[] = [];
    for (let offset = 0; offset < featureValues.length; offset += KEYXYM_FRONTEND_FEATURE_FLOATS) {
      const record = featureValues.slice(offset, offset + KEYXYM_FRONTEND_FEATURE_FLOATS);
      if (!record.every(Number.isFinite)) throw new Error("Keyxym frontend feature is non-finite");
      features.push({
        id: record[0]!,
        x: record[1]!,
        y: record[2]!,
        score: record[3]!,
        disparity: record[4]!,
        matchError: record[5]!,
      });
    }

    const previewCount = this.exports.keyxym_frontend_preview_count();
    if (!Number.isSafeInteger(previewCount) || previewCount < 0 || previewCount > 8192) {
      throw new Error("Keyxym frontend returned an invalid forming-field count");
    }
    const previewValues = new Float32Array(
      this.exports.memory.buffer,
      this.exports.keyxym_frontend_preview_ptr(),
      previewCount * KEYXYM_FRONTEND_PREVIEW_FLOATS,
    ).slice();
    const forming: KeyxymFormingSample[] = [];
    for (let offset = 0; offset < previewValues.length; offset += KEYXYM_FRONTEND_PREVIEW_FLOATS) {
      const record = previewValues.slice(offset, offset + KEYXYM_FRONTEND_PREVIEW_FLOATS);
      if (!record.every(Number.isFinite)) throw new Error("Keyxym forming-field sample is non-finite");
      forming.push({
        normalizedX: record[0]!,
        normalizedY: record[1]!,
        flowX: record[2]!,
        flowY: record[3]!,
        r: record[4]!,
        g: record[5]!,
        b: record[6]!,
        salience: record[7]!,
        trackSupport: record[8]!,
        age: record[9]!,
      });
    }

    return {
      features,
      forming,
      sequence: this.exports.keyxym_frontend_sequence(),
    };
  }

  reset(): void {
    this.exports.keyxym_frontend_reset();
  }
}

export function keyxymFrontendManifestCommitment(manifest: unknown): Uint8Array {
  return sha256(encoder.encode(JSON.stringify(manifest)));
}
