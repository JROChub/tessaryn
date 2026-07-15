import { sha256 } from "@noble/hashes/sha2.js";
import type { KeyxymV26Manifest } from "./keyxym-v26-provenance";
import type { KeyxymReceipts } from "./keyxym-v26-theater-adapter";

export type AssuranceArtifactKind =
  | "reconstruction-receipt"
  | "moment"
  | "transfer"
  | "world-cell";

export interface WorldCellEvidenceRequest {
  profile: "eform/world-cell-assurance/v1";
  artifactKind: AssuranceArtifactKind;
  canonicalDigest: string;
  reconstructionReceipt: string;
  runtimeCommitment: string;
  parentCommitment: string;
  sequence: number;
  metricScale: boolean;
}

export interface NativeWorldCellSeal {
  schema:
    | "tessaryn/native-world-cell-seal/v1"
    | "tessaryn/browser-world-cell-seal/v1";
  assuranceRecord: string;
  rootprint: string;
  phaFingerprint: string;
  memoryCapsuleDigest: string;
  replayFingerprint: string;
  publicKeyBase64?: string;
  signatureBase64?: string;
  provider?: string;
  powerHouseVersion?: string;
  proofBundle?: unknown;
  verified: true;
}

export interface NativeAssuranceBridge {
  sealWorldCell(input: {
    canonicalCell: string;
    evidence: WorldCellEvidenceRequest;
  }): Promise<NativeWorldCellSeal>;
  verifyWorldCell(input: {
    canonicalCell: string;
    evidence: WorldCellEvidenceRequest;
    seal: NativeWorldCellSeal;
  }): Promise<boolean>;
}

declare global {
  interface Window {
    tessarynAssurance?: NativeAssuranceBridge;
  }
}

const encoder = new TextEncoder();
const HEX = /^[0-9a-f]{64}$/;
const POWER_HOUSE_DIGEST = /^(?:sha256:)?[0-9a-f]{64}$/;
const ZERO_DIGEST = "0".repeat(64);

export function bytesHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function normalize(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical World Cell values must be finite");
    return Object.is(value, -0) ? 0 : value;
  }
  if (value instanceof Uint8Array) return bytesHex(value);
  if (value instanceof Float32Array || value instanceof Float64Array) {
    return Array.from(value, (item) => normalize(item));
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(object).sort()) {
      const item = object[key];
      if (item !== undefined) sorted[key] = normalize(item);
    }
    return sorted;
  }
  throw new Error(`Unsupported canonical World Cell value: ${typeof value}`);
}

export function canonicalString(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function digestBytes(bytes: Uint8Array): string {
  return bytesHex(sha256(bytes));
}

export function digestValue(value: unknown): string {
  return digestBytes(encoder.encode(canonicalString(value)));
}

export function runtimeCommitment(manifest: KeyxymV26Manifest): string {
  return digestValue({
    schema: manifest.schema,
    version: manifest.version,
    abi: manifest.abi,
    perceptionAbi: manifest.perception_abi,
    sourceRepository: manifest.source_repository,
    sourceCommit: manifest.source_commit,
    timestampAbi: manifest.timestamp_abi,
    maximumSurfels: manifest.maximum_surfels,
    artifacts: manifest.artifacts,
  });
}

export function reconstructionReceipt(receipts: KeyxymReceipts): string {
  if (receipts.pose.byteLength !== 32 || receipts.quality.byteLength !== 32 ||
      receipts.authority.byteLength !== 32) {
    throw new Error("Keyxym v0.26 receipt triple must contain three 32-byte receipts");
  }
  const domain = encoder.encode("tessaryn/keyxym-receipt-triple/v1\0");
  const input = new Uint8Array(domain.byteLength + 96);
  input.set(domain, 0);
  input.set(receipts.pose, domain.byteLength);
  input.set(receipts.quality, domain.byteLength + 32);
  input.set(receipts.authority, domain.byteLength + 64);
  const digest = digestBytes(input);
  if (digest === ZERO_DIGEST) throw new Error("Keyxym reconstruction receipt is zero");
  return digest;
}

export function evidenceRequest(input: {
  artifactKind: AssuranceArtifactKind;
  canonicalDigest: string;
  reconstructionReceipt: string;
  runtimeCommitment: string;
  parentCommitment?: string;
  sequence: number;
  metricScale: boolean;
}): WorldCellEvidenceRequest {
  for (const [name, digest] of [
    ["canonical digest", input.canonicalDigest],
    ["reconstruction receipt", input.reconstructionReceipt],
    ["runtime commitment", input.runtimeCommitment],
  ] as const) {
    if (!HEX.test(digest) || digest === ZERO_DIGEST) throw new Error(`Invalid ${name}`);
  }
  const parent = input.parentCommitment ?? ZERO_DIGEST;
  if (!HEX.test(parent)) throw new Error("Invalid parent commitment");
  if (!Number.isSafeInteger(input.sequence) || input.sequence <= 0) {
    throw new Error("World Cell evidence sequence must be a positive integer");
  }
  return {
    profile: "eform/world-cell-assurance/v1",
    artifactKind: input.artifactKind,
    canonicalDigest: input.canonicalDigest,
    reconstructionReceipt: input.reconstructionReceipt,
    runtimeCommitment: input.runtimeCommitment,
    parentCommitment: parent,
    sequence: input.sequence,
    metricScale: input.metricScale,
  };
}

export function nativeAssuranceBridge(): NativeAssuranceBridge | null {
  const bridge = window.tessarynAssurance;
  if (!bridge || typeof bridge.sealWorldCell !== "function" ||
      typeof bridge.verifyWorldCell !== "function") return null;
  return bridge;
}

function validPowerHouseDigest(value: string): boolean {
  if (!POWER_HOUSE_DIGEST.test(value)) return false;
  return value.replace(/^sha256:/, "") !== ZERO_DIGEST;
}

export function validateNativeSeal(seal: NativeWorldCellSeal): void {
  if ((seal.schema !== "tessaryn/native-world-cell-seal/v1" &&
       seal.schema !== "tessaryn/browser-world-cell-seal/v1") || seal.verified !== true) {
    throw new Error("eform/Power House seal was not verified");
  }
  for (const [name, digest] of [
    ["Rootprint", seal.rootprint],
    ["PHA fingerprint", seal.phaFingerprint],
    ["Memory Capsule digest", seal.memoryCapsuleDigest],
    ["replay fingerprint", seal.replayFingerprint],
  ] as const) {
    if (!validPowerHouseDigest(digest)) throw new Error(`${name} is invalid`);
  }
  if (!seal.assuranceRecord.trim()) throw new Error("eform assurance record is missing");
}
