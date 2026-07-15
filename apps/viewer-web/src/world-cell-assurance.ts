import { blake2b } from "@noble/hashes/blake2.js";

export const WORLD_CELL_ASSURANCE_PROFILE = "eform/world-cell-assurance/v1";
export const EFORM_SIGNING_DOMAIN = "eform/ed25519/hash256/v1";
export const EFORM_PROVIDER = "power_house::net::ed25519";
export const POWER_HOUSE_REVISION = "7f3aa496104cccab0ab813ec7dc6f45d5d55e2f8";
const TRANSCRIPT_DOMAIN = new TextEncoder().encode("MFENX_TRANSCRIPT");
const ENVELOPE_FINAL = 0x5743_454e_5631_0001n;

export type WorldCellArtifactKind =
  | "reconstruction-receipt"
  | "moment"
  | "transfer"
  | "world-cell";

export interface WorldCellEvidenceRecord {
  artifactKind: WorldCellArtifactKind;
  canonicalDigest: string;
  reconstructionReceipt: string;
  runtimeCommitment: string;
  calibrationCommitment: string;
  sourceSetCommitment: string;
  parentCommitment: string;
  rootprintCommitment: string;
  sequence: bigint;
  timestampNs: bigint;
  metricScale: boolean;
  sealed: boolean;
}

export interface VerifiedWorldCellAssurance {
  profile: string;
  evidence: WorldCellEvidenceRecord;
  envelopeDigest: string;
  publicKeyBase64: string;
  signatureBase64: string;
  canonicalRecord: string;
}

const ZERO = "0".repeat(64);
const kindCode: Record<WorldCellArtifactKind, bigint> = {
  "reconstruction-receipt": 1n,
  moment: 2n,
  transfer: 3n,
  "world-cell": 4n,
};

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function bytesFromHex(value: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error("World Cell evidence digest is invalid");
  const output = new Uint8Array(32);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return output;
}

function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < output.length; index += 1) output[index] = binary.charCodeAt(index);
  return output;
}

function u64Bytes(value: bigint): Uint8Array {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) throw new Error("World Cell u64 field is out of range");
  const output = new Uint8Array(8);
  new DataView(output.buffer).setBigUint64(0, value, false);
  return output;
}

function wordFromBytes(bytes: Uint8Array): bigint {
  const padded = new Uint8Array(8);
  padded.set(bytes);
  return new DataView(padded.buffer).getBigUint64(0, false);
}

function digestWords(value: string): bigint[] {
  const bytes = bytesFromHex(value);
  const words: bigint[] = [];
  for (let offset = 0; offset < bytes.length; offset += 8) {
    words.push(wordFromBytes(bytes.slice(offset, offset + 8)));
  }
  return words;
}

function profileWords(): bigint[] {
  const bytes = new TextEncoder().encode(WORLD_CELL_ASSURANCE_PROFILE);
  const words = [BigInt(bytes.length)];
  for (let offset = 0; offset < bytes.length; offset += 8) {
    words.push(wordFromBytes(bytes.slice(offset, offset + 8)));
  }
  return words;
}

function validateEvidence(evidence: WorldCellEvidenceRecord): void {
  for (const [name, value] of [
    ["canonical digest", evidence.canonicalDigest],
    ["reconstruction receipt", evidence.reconstructionReceipt],
    ["runtime commitment", evidence.runtimeCommitment],
    ["calibration commitment", evidence.calibrationCommitment],
    ["source-set commitment", evidence.sourceSetCommitment],
  ] as const) {
    bytesFromHex(value);
    if (value === ZERO) throw new Error(`${name} must not be zero`);
  }
  bytesFromHex(evidence.parentCommitment);
  bytesFromHex(evidence.rootprintCommitment);
  if (evidence.sequence === 0n || evidence.timestampNs === 0n) {
    throw new Error("World Cell sequence and timestamp must be nonzero");
  }
  if (evidence.sequence > 1n && evidence.parentCommitment === ZERO) {
    throw new Error("Non-genesis evidence requires a parent commitment");
  }
  if ((evidence.artifactKind === "reconstruction-receipt" || evidence.artifactKind === "moment") &&
      evidence.sealed) {
    throw new Error("Reconstruction receipts and Moments cannot be sealed");
  }
  if (evidence.artifactKind === "transfer") {
    if (!evidence.sealed || evidence.rootprintCommitment === ZERO) {
      throw new Error("Transfer evidence requires a sealed Rootprint");
    }
  }
  if (evidence.artifactKind === "world-cell") {
    if (evidence.rootprintCommitment === ZERO) throw new Error("World Cell evidence requires a Rootprint");
    if (evidence.sealed && !evidence.metricScale) {
      throw new Error("Sealed World Cell evidence requires verified metric scale");
    }
  }
}

export function worldCellEnvelopeDigest(evidence: WorldCellEvidenceRecord): string {
  validateEvidence(evidence);
  const transcript = [
    ...profileWords(),
    1n,
    kindCode[evidence.artifactKind],
    evidence.sequence,
    evidence.timestampNs,
    evidence.metricScale ? 1n : 0n,
    evidence.sealed ? 1n : 0n,
    ...digestWords(evidence.canonicalDigest),
    ...digestWords(evidence.reconstructionReceipt),
    ...digestWords(evidence.runtimeCommitment),
    ...digestWords(evidence.calibrationCommitment),
    ...digestWords(evidence.sourceSetCommitment),
    ...digestWords(evidence.parentCommitment),
    ...digestWords(evidence.rootprintCommitment),
  ];
  const bytes: Uint8Array[] = [TRANSCRIPT_DOMAIN, u64Bytes(BigInt(transcript.length))];
  transcript.forEach((word) => bytes.push(u64Bytes(word)));
  bytes.push(u64Bytes(0n), u64Bytes(ENVELOPE_FINAL));
  const length = bytes.reduce((sum, item) => sum + item.length, 0);
  const input = new Uint8Array(length);
  let offset = 0;
  for (const item of bytes) {
    input.set(item, offset);
    offset += item.length;
  }
  return hex(blake2b(input, { dkLen: 32 }));
}

export function assuranceRequest(evidence: WorldCellEvidenceRecord): string {
  const envelopeDigest = worldCellEnvelopeDigest(evidence);
  return JSON.stringify({
    profile: WORLD_CELL_ASSURANCE_PROFILE,
    artifact_kind: evidence.artifactKind,
    canonical_digest: evidence.canonicalDigest,
    reconstruction_receipt: evidence.reconstructionReceipt,
    runtime_commitment: evidence.runtimeCommitment,
    calibration_commitment: evidence.calibrationCommitment,
    source_set_commitment: evidence.sourceSetCommitment,
    parent_commitment: evidence.parentCommitment,
    rootprint_commitment: evidence.rootprintCommitment,
    sequence: evidence.sequence.toString(),
    timestamp_ns: evidence.timestampNs.toString(),
    scale: evidence.metricScale ? "metric" : "relative",
    sealed: evidence.sealed,
    envelope_digest: envelopeDigest,
  }, null, 2);
}

function parseRecord(record: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const rawLine of record.trim().split(/\r?\n/)) {
    const separator = rawLine.indexOf("=");
    if (separator <= 0) throw new Error("Malformed eform assurance line");
    const key = rawLine.slice(0, separator);
    const value = rawLine.slice(separator + 1);
    if (fields.has(key)) throw new Error(`Duplicate eform assurance field ${key}`);
    fields.set(key, value);
  }
  return fields;
}

function required(fields: Map<string, string>, name: string): string {
  const value = fields.get(name);
  if (value === undefined) throw new Error(`Missing eform assurance field ${name}`);
  return value;
}

function evidenceFromFields(fields: Map<string, string>): WorldCellEvidenceRecord {
  const artifactKind = required(fields, "artifact_kind") as WorldCellArtifactKind;
  if (!(artifactKind in kindCode)) throw new Error("Unknown eform artifact kind");
  const scale = required(fields, "scale");
  if (scale !== "metric" && scale !== "relative") throw new Error("Invalid eform scale state");
  const sealed = required(fields, "sealed");
  if (sealed !== "true" && sealed !== "false") throw new Error("Invalid eform sealed state");
  return {
    artifactKind,
    canonicalDigest: required(fields, "canonical_digest"),
    reconstructionReceipt: required(fields, "reconstruction_receipt"),
    runtimeCommitment: required(fields, "runtime_commitment"),
    calibrationCommitment: required(fields, "calibration_commitment"),
    sourceSetCommitment: required(fields, "source_set_commitment"),
    parentCommitment: required(fields, "parent_commitment"),
    rootprintCommitment: required(fields, "rootprint_commitment"),
    sequence: BigInt(required(fields, "sequence")),
    timestampNs: BigInt(required(fields, "timestamp_ns")),
    metricScale: scale === "metric",
    sealed: sealed === "true",
  };
}

export async function verifyWorldCellAssurance(
  record: string,
  expected?: WorldCellEvidenceRecord,
): Promise<VerifiedWorldCellAssurance> {
  const fields = parseRecord(record);
  if (fields.size !== 23) throw new Error("Unexpected eform assurance fields");
  if (required(fields, "profile") !== WORLD_CELL_ASSURANCE_PROFILE ||
      required(fields, "domain") !== EFORM_SIGNING_DOMAIN ||
      required(fields, "provider") !== EFORM_PROVIDER ||
      required(fields, "power_house_revision") !== POWER_HOUSE_REVISION) {
    throw new Error("eform assurance trust boundary mismatch");
  }
  const evidence = evidenceFromFields(fields);
  const envelopeDigest = worldCellEnvelopeDigest(evidence);
  if (required(fields, "envelope_digest") !== envelopeDigest ||
      required(fields, "digest") !== envelopeDigest) {
    throw new Error("eform assurance envelope digest mismatch");
  }
  if (expected && worldCellEnvelopeDigest(expected) !== envelopeDigest) {
    throw new Error("eform assurance does not match the requested World Cell evidence");
  }
  if (!crypto.subtle) throw new Error("Web Crypto is unavailable");
  const publicKeyBase64 = required(fields, "public_key");
  const signatureBase64 = required(fields, "signature");
  const key = await crypto.subtle.importKey(
    "raw",
    bytesFromBase64(publicKeyBase64),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  const verified = await crypto.subtle.verify(
    { name: "Ed25519" },
    key,
    bytesFromBase64(signatureBase64),
    bytesFromHex(envelopeDigest),
  );
  if (!verified) throw new Error("eform Ed25519 signature verification failed");
  return {
    profile: WORLD_CELL_ASSURANCE_PROFILE,
    evidence,
    envelopeDigest,
    publicKeyBase64,
    signatureBase64,
    canonicalRecord: record.trim() + "\n",
  };
}
