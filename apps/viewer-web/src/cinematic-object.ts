import { parseStrictIntegerJson } from "./strict-json";
import type {
  CinematicObjectBrowserReport,
  CinematicObjectEnvelopeView,
  Digest,
} from "./types";
import {
  calculateCanonicalChunkId,
  calculateChunkId,
  calculateChunkMerkleRoot,
  verifyCellProofBundle,
} from "./verification";

const MAGIC = new TextEncoder().encode("TESSARYN-CIN4D\0\0");
const VERSION = 1;
const HEADER_BYTES = 80;
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const SUPPORTED_GEOMETRY_PROFILES = new Set([
  "tessaryn/continuum-monument/v1",
  "tessaryn/logo-mansion/v1",
]);

export interface CinematicObjectProgress {
  bytesRead: number;
  totalBytes: number;
  chunksVerified: number;
}

export interface ParsedCinematicObject {
  envelope: CinematicObjectEnvelopeView;
  media: Blob;
  report: CinematicObjectBrowserReport;
  payloadOffset: number;
}

export async function parseAndVerifyCinematicObject(
  file: Blob,
  onProgress: (progress: CinematicObjectProgress) => void = () => undefined,
): Promise<ParsedCinematicObject> {
  if (!Number.isSafeInteger(file.size) || file.size < HEADER_BYTES) {
    throw new Error("cinematic object length is outside the browser-safe profile");
  }
  const header = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
  if (!equalBytes(header.subarray(0, MAGIC.length), MAGIC)) {
    throw new Error("unsupported cinematic object magic");
  }
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (
    view.getUint32(16, true) !== VERSION ||
    view.getUint32(20, true) !== HEADER_BYTES ||
    header.subarray(72, 80).some((byte) => byte !== 0)
  ) {
    throw new Error("unsupported cinematic object header");
  }
  const manifestBytes = safeU64(view.getBigUint64(24, true), "manifest length");
  const mediaBytes = safeU64(view.getBigUint64(32, true), "media length");
  if (manifestBytes <= 0 || manifestBytes > MAX_MANIFEST_BYTES) {
    throw new Error("cinematic manifest exceeds the 16 MiB parser profile");
  }
  const payloadOffset = HEADER_BYTES + manifestBytes;
  if (payloadOffset + mediaBytes !== file.size) {
    throw new Error("cinematic object length does not match its header");
  }
  const manifest = new Uint8Array(
    await file.slice(HEADER_BYTES, payloadOffset).arrayBuffer(),
  );
  const manifestHash = new Uint8Array(await crypto.subtle.digest("SHA-256", manifest));
  if (!equalBytes(manifestHash, header.subarray(40, 72))) {
    throw new Error("cinematic object manifest digest mismatch");
  }
  const parsed = parseStrictIntegerJson(new TextDecoder("utf-8", { fatal: true }).decode(manifest));
  if (!isCinematicObjectEnvelope(parsed)) {
    throw new Error("unsupported cinematic object envelope");
  }
  validateDescriptor(parsed);

  const report: CinematicObjectBrowserReport = {
    accepted: false,
    manifestValid: true,
    descriptorValid: false,
    mediaValid: false,
    cellValid: false,
    phaValid: false,
    rootprintValid: false,
    replayValid: false,
    memoryValid: false,
    verifiedMediaChunks: 0,
    errors: [],
  };
  try {
    const descriptorId = await calculateCanonicalChunkId(parsed.descriptor);
    if (descriptorId !== parsed.descriptor_chunk_id) {
      throw new Error("cinematic geometry descriptor commitment mismatch");
    }
    report.descriptorValid = true;
    if (
      parsed.media.payload_bytes !== mediaBytes ||
      parsed.media.chunk_bytes !== 4 * 1024 * 1024 ||
      parsed.media.chunk_ids.length !== Math.ceil(mediaBytes / parsed.media.chunk_bytes)
    ) {
      throw new Error("cinematic media profile mismatch");
    }
    const mediaChunkIds: Digest[] = [];
    let offset = 0;
    for (const expected of parsed.media.chunk_ids) {
      const length = Math.min(parsed.media.chunk_bytes, mediaBytes - offset);
      const bytes = new Uint8Array(
        await file
          .slice(payloadOffset + offset, payloadOffset + offset + length)
          .arrayBuffer(),
      );
      const actual = (await calculateChunkId(bytes)) as Digest;
      if (actual !== expected) {
        throw new Error(`cinematic media chunk ${String(mediaChunkIds.length)} mismatch`);
      }
      mediaChunkIds.push(actual);
      offset += length;
      report.verifiedMediaChunks = mediaChunkIds.length;
      onProgress({
        bytesRead: offset,
        totalBytes: mediaBytes,
        chunksVerified: mediaChunkIds.length,
      });
    }
    const mediaRoot = await calculateChunkMerkleRoot(mediaChunkIds);
    if (mediaRoot !== parsed.media.chunk_merkle_root) {
      throw new Error("cinematic media Merkle root mismatch");
    }
    const geometryRoot = await calculateChunkMerkleRoot([descriptorId]);
    const worldRoot = await calculateChunkMerkleRoot([descriptorId, ...mediaChunkIds]);
    const mediaChannel = parsed.cell_proof.manifest.channels.find(
      (channel) => channel.role === "appearance/cinematic",
    );
    const geometryChannel = parsed.cell_proof.manifest.channels.find(
      (channel) => channel.role === "geometry/procedural",
    );
    if (
      mediaChannel?.chunk_root !== mediaRoot ||
      mediaChannel.uncompressed_bytes !== mediaBytes ||
      geometryChannel?.chunk_root !== geometryRoot ||
      parsed.cell_proof.manifest.chunk_merkle_root !== worldRoot
    ) {
      throw new Error("cinematic Cell channel binding mismatch");
    }
    report.mediaValid = true;
    const proof = await verifyCellProofBundle(parsed.cell_proof);
    report.cellValid = proof.cellValid;
    report.phaValid = proof.phaValid;
    report.rootprintValid = proof.rootprintValid;
    report.replayValid = proof.replayValid;
    report.memoryValid = proof.memoryValid;
    report.errors.push(...proof.errors);
    const stored = parsed.cell_proof_report;
    if (
      !stored.cell_identity_valid ||
      !stored.pha_valid ||
      !stored.rootprint_valid ||
      !stored.replay_valid ||
      !stored.memory_capsule_valid ||
      stored.physical_truth_claimed ||
      proof.errors.length > 0
    ) {
      throw new Error("cinematic Power House proof report mismatch");
    }
    report.accepted = true;
  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error));
  }
  if (!report.accepted) throw new Error(report.errors.join(" / ") || "cinematic object rejected");
  return {
    envelope: parsed,
    media: file.slice(payloadOffset, payloadOffset + mediaBytes, parsed.descriptor.media.mime),
    report,
    payloadOffset,
  };
}

function validateDescriptor(envelope: CinematicObjectEnvelopeView): void {
  const descriptor = envelope.descriptor;
  const profile = descriptor.geometry.profile as string;
  if (
    descriptor.schema !== "tessaryn/cinematic-object-descriptor/v1" ||
    !SUPPORTED_GEOMETRY_PROFILES.has(profile) ||
    descriptor.media.mime !== "video/mp4" ||
    descriptor.media.codec !== "h264" ||
    descriptor.duration_ms <= 0 ||
    descriptor.media.width < 1_280 ||
    descriptor.media.height < 720 ||
    descriptor.media.frame_rate_millihz < 24_000 ||
    descriptor.geometry.cell_count < 24 ||
    descriptor.geometry.shell_count < 3 ||
    descriptor.geometry.ribbon_count < 3 ||
    descriptor.geometry.phase_count < 3 ||
    descriptor.geometry.bounds_um.some((value) => value <= 0) ||
    descriptor.moments.length < 3 ||
    descriptor.slbit.schema !== "slbit/viz-packet/v3" ||
    descriptor.slbit.statements.length === 0
  ) {
    throw new Error("invalid cinematic object descriptor");
  }
  descriptor.moments.forEach((moment, index) => {
    const previous = descriptor.moments[index - 1];
    if (
      !moment.id ||
      !moment.label ||
      !moment.meaning ||
      moment.time_ms < 0 ||
      moment.time_ms >= descriptor.duration_ms ||
      (previous && moment.time_ms <= previous.time_ms)
    ) {
      throw new Error("cinematic Moments must be unique and strictly time-ordered");
    }
  });
}

function isCinematicObjectEnvelope(value: unknown): value is CinematicObjectEnvelopeView {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Record<string, unknown>;
  const descriptor = envelope.descriptor as Record<string, unknown> | undefined;
  const media = envelope.media as Record<string, unknown> | undefined;
  const proof = envelope.cell_proof as Record<string, unknown> | undefined;
  return (
    envelope.schema === "tessaryn/cinematic-object/v1" &&
    descriptor?.schema === "tessaryn/cinematic-object-descriptor/v1" &&
    typeof descriptor.object_id === "string" &&
    typeof descriptor.title === "string" &&
    Array.isArray(descriptor.moments) &&
    typeof media?.payload_bytes === "number" &&
    Array.isArray(media.chunk_ids) &&
    typeof proof?.cell_id === "string" &&
    typeof proof.manifest === "object" &&
    typeof envelope.cell_proof_report === "object"
  );
}

function safeU64(value: bigint, name: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${name} exceeds the browser-safe integer profile`);
  }
  return Number(value);
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}
