export const LOCAL_FILE_CHUNK_BYTES = 4 * 1024 * 1024;

export interface LocalFileProgress {
  bytesRead: number;
  totalBytes: number;
  chunksRead: number;
}

export interface LocalFileIdentity {
  schema: "tessaryn/local-file-index/v1";
  algorithm: "sha256-mmr-v1";
  byteLength: number;
  chunkBytes: number;
  chunkCount: number;
  streamRoot: string;
}

interface Peak {
  height: number;
  digest: Uint8Array;
}

const encoder = new TextEncoder();
const LEAF_DOMAIN = encoder.encode("TESSARYN-LOCAL-CHUNK-v1\0");
const NODE_DOMAIN = encoder.encode("TESSARYN-LOCAL-NODE-v1\0");
const FILE_DOMAIN = encoder.encode("TESSARYN-LOCAL-FILE-v1\0");

export async function calculateLocalFileIdentity(
  file: Blob,
  onProgress: (progress: LocalFileProgress) => void = () => undefined,
  isCancelled: () => boolean = () => false,
): Promise<LocalFileIdentity> {
  if (!Number.isSafeInteger(file.size) || file.size < 0) {
    throw new Error("local file length exceeds the browser-safe integer profile");
  }

  const peaks: Peak[] = [];
  let offset = 0;
  let chunkCount = 0;
  let lastProgressAt = 0;

  while (offset < file.size) {
    throwIfCancelled(isCancelled);
    const end = Math.min(file.size, offset + LOCAL_FILE_CHUNK_BYTES);
    const chunk = new Uint8Array(await file.slice(offset, end).arrayBuffer());
    const leaf = await sha256(
      concatenate([LEAF_DOMAIN, u64(chunkCount), u32(chunk.byteLength), chunk]),
    );
    let peak: Peak = { height: 0, digest: leaf };
    while (peaks.at(-1)?.height === peak.height) {
      const left = peaks.pop();
      if (!left) throw new Error("local file peak stack underflow");
      peak = {
        height: peak.height + 1,
        digest: await sha256(
          concatenate([NODE_DOMAIN, u32(peak.height), left.digest, peak.digest]),
        ),
      };
    }
    peaks.push(peak);
    offset = end;
    chunkCount += 1;

    const now = performance.now();
    if (offset === file.size || now - lastProgressAt >= 100) {
      onProgress({ bytesRead: offset, totalBytes: file.size, chunksRead: chunkCount });
      lastProgressAt = now;
    }
  }

  throwIfCancelled(isCancelled);
  const rootParts: Uint8Array[] = [
    FILE_DOMAIN,
    u64(file.size),
    u32(LOCAL_FILE_CHUNK_BYTES),
    u64(chunkCount),
    u32(peaks.length),
  ];
  for (const peak of peaks) rootParts.push(u32(peak.height), peak.digest);
  const root = await sha256(concatenate(rootParts));

  return {
    schema: "tessaryn/local-file-index/v1",
    algorithm: "sha256-mmr-v1",
    byteLength: file.size,
    chunkBytes: LOCAL_FILE_CHUNK_BYTES,
    chunkCount,
    streamRoot: "sha256:" + toHex(root),
  };
}

function throwIfCancelled(isCancelled: () => boolean): void {
  if (!isCancelled()) return;
  throw new DOMException("local file indexing cancelled", "AbortError");
}

async function sha256(value: Uint8Array): Promise<Uint8Array> {
  const input = new Uint8Array(value.byteLength);
  input.set(value);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", input.buffer));
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function u32(value: number): Uint8Array {
  const output = new Uint8Array(4);
  new DataView(output.buffer).setUint32(0, value, false);
  return output;
}

function u64(value: number): Uint8Array {
  const output = new Uint8Array(8);
  new DataView(output.buffer).setBigUint64(0, BigInt(value), false);
  return output;
}

function toHex(value: Uint8Array): string {
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
