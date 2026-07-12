import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { PublicObjectCatalog, PublicObjectCatalogEntry } from "./types";

const DATABASE_NAME = "tessaryn-personal-weave-v1";
const DATABASE_VERSION = 1;
const IDENTITY_STORE = "identity";
const OBJECT_STORE = "objects";
const PUBLISH_SCHEMA = "tessaryn/publication-intent/v1";
const CONFIG_SCHEMA = "tessaryn/weave-client-config/v1";
const HASH_WINDOW_BYTES = 4 * 1024 * 1024;
type Digest = `sha256:${string}`;

export interface WeaveClientConfig {
  schema: typeof CONFIG_SCHEMA;
  api: string;
}

export interface WeaveNodePolicy {
  schema: "tessaryn/weave-node-policy/v1";
  chunk_bytes: number;
  max_object_bytes: number;
  max_publisher_bytes: number;
  max_pending_bytes: number;
  max_retained_bytes: number;
  max_active_uploads: number;
  max_active_uploads_per_publisher: number;
  max_publications: number;
  max_publications_per_publisher: number;
  upload_ttl_seconds: number;
  accepted_artifacts: string[];
  immutable_content_identity: boolean;
  revocable_discovery: boolean;
}

export interface PublicationMetadata {
  objectId: string;
  title: string;
  summary: string;
  mediaType: string;
  cellId: Digest;
  rootprintBranch: Digest;
  artifactKind: "cinematic_object" | "rgbd_reconstruction";
}

export interface PublicationReceipt {
  schema: "tessaryn/publication-receipt/v1";
  publication_id: string;
  publisher_id: string;
  accepted_at_unix_us: number;
  artifact_kind: "cinematic_object" | "rgbd_reconstruction";
  artifact_url: string;
  cell_id: Digest;
  rootprint_branch: Digest;
  moments: number;
  dimensions: string;
  media: string;
  intent: PublicationIntent;
}

interface PublicationRevocation {
  schema: "tessaryn/publication-revocation/v1";
  publication_id: string;
  created_at_unix_us: number;
  nonce: string;
  signature: string;
}

export interface PublicationProgress {
  stage: "identity" | "hashing" | "admission" | "uploading" | "verifying" | "complete";
  bytesProcessed: number;
  totalBytes: number;
  completedChunks: number;
  totalChunks: number;
}

export interface PersonalWeaveObject {
  localId: string;
  objectId: string;
  title: string;
  summary: string;
  fileName: string;
  mediaType: string;
  bytes: number;
  artifactSha256: Digest;
  cellId: Digest;
  rootprintBranch: Digest;
  artifactKind: "cinematic_object" | "rgbd_reconstruction";
  addedAtUnixUs: number;
  storage: "indexeddb" | "opfs";
  blob?: Blob;
  publicationId?: string;
  publicArtifact?: string;
}

interface PublicationIntent {
  schema: typeof PUBLISH_SCHEMA;
  object_id: string;
  title: string;
  summary: string;
  artifact_sha256: Digest;
  artifact_bytes: number;
  media_type: string;
  created_at_unix_us: number;
  nonce: string;
  publisher_public_key: string;
  signature: string;
}

interface UploadSession {
  schema: "tessaryn/upload-session/v1";
  upload_id: string;
  publisher_id: string;
  chunk_bytes: number;
  chunk_count: number;
  intent: PublicationIntent;
}

interface UploadStatus {
  upload_id: string;
  chunk_count: number;
  received_chunks: number[];
  missing_chunks: number[];
  ready_to_commit: boolean;
}

interface PublisherIdentity {
  privateKey: CryptoKey;
  publicKeyBytes: Uint8Array;
}

interface StoredIdentity {
  id: "publisher";
  privateKey: CryptoKey;
  publicKeyBytes: Uint8Array;
}

let localIdentityPromise: Promise<PublisherIdentity> | null = null;

export async function loadWeaveClientConfig(): Promise<WeaveClientConfig | null> {
  try {
    const override = new URLSearchParams(location.search).get("weaveApi");
    const localHost = location.hostname === "127.0.0.1" || location.hostname === "localhost";
    if (localHost && !override) return null;
    if (override) {
      const url = new URL(override);
      if (url.protocol !== "https:" && !(localHost && url.protocol === "http:")) return null;
      return { schema: CONFIG_SCHEMA, api: override.replace(/\/$/u, "") };
    }
    const response = await fetch("./weave.json", { cache: "no-store" });
    if (!response.ok) return null;
    const value = (await response.json()) as Partial<WeaveClientConfig>;
    if (value.schema !== CONFIG_SCHEMA || typeof value.api !== "string" || !value.api.startsWith("https://")) {
      return null;
    }
    return { schema: CONFIG_SCHEMA, api: value.api.replace(/\/$/u, "") };
  } catch {
    return null;
  }
}

export async function fetchPublicWeave(api: string): Promise<PublicObjectCatalog> {
  const response = await fetch(`${api}/v1/catalog`, {
    cache: "no-store",
    signal: AbortSignal.timeout(2_500),
  });
  const value = await responseJson(response);
  if (!isPublicCatalogV2(value, api)) throw new Error("public Weave returned an unsupported catalog");
  return {
    schema: "tessaryn/public-object-catalog/v2",
    updated_at_unix_us: value.updated_at_unix_us,
    objects: value.objects,
  };
}

export async function fetchWeavePolicy(api: string): Promise<WeaveNodePolicy> {
  const response = await fetch(`${api}/v1/policy`, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const value = (await responseJson(response)) as Partial<WeaveNodePolicy>;
  if (
    value.schema !== "tessaryn/weave-node-policy/v1" ||
    !Number.isSafeInteger(value.chunk_bytes) ||
    !Number.isSafeInteger(value.max_object_bytes) ||
    !Number.isSafeInteger(value.max_publisher_bytes) ||
    !Number.isSafeInteger(value.max_pending_bytes) ||
    !Number.isSafeInteger(value.max_retained_bytes) ||
    !Number.isSafeInteger(value.max_active_uploads) ||
    !Number.isSafeInteger(value.max_active_uploads_per_publisher) ||
    !Number.isSafeInteger(value.max_publications) ||
    !Number.isSafeInteger(value.max_publications_per_publisher) ||
    !Number.isSafeInteger(value.upload_ttl_seconds) ||
    [
      value.chunk_bytes,
      value.max_object_bytes,
      value.max_publisher_bytes,
      value.max_pending_bytes,
      value.max_retained_bytes,
      value.max_active_uploads,
      value.max_active_uploads_per_publisher,
      value.max_publications,
      value.max_publications_per_publisher,
      value.upload_ttl_seconds,
    ].some((entry) => (entry ?? 0) <= 0) ||
    !Array.isArray(value.accepted_artifacts) ||
    value.accepted_artifacts.some((entry) => typeof entry !== "string") ||
    value.immutable_content_identity !== true ||
    value.revocable_discovery !== true
  ) {
    throw new Error("public Weave returned an invalid node policy");
  }
  return value as WeaveNodePolicy;
}

export async function publishArtifact(
  api: string,
  file: File,
  metadata: PublicationMetadata,
  onProgress: (progress: PublicationProgress) => void,
  signal?: AbortSignal,
): Promise<PublicationReceipt> {
  const policy = await fetchWeavePolicy(api);
  if (file.size <= 0) throw new Error("empty artifacts cannot enter the public Weave");
  const artifactSchema =
    metadata.artifactKind === "rgbd_reconstruction"
      ? "tessaryn/reconstruction-artifact/v0"
      : "tessaryn/cinematic-object/v1";
  if (!policy.accepted_artifacts.includes(artifactSchema)) {
    throw new Error("this public Weave does not admit the active artifact class");
  }
  if (file.size > policy.max_object_bytes) {
    throw new Error(`this node admits at most ${formatBytes(policy.max_object_bytes)} per object`);
  }
  onProgress(progress("identity", file.size));
  const identity = await publisherIdentity();
  onProgress(progress("hashing", file.size));
  const artifactSha256 = await hashFile(file, (bytesProcessed) => {
    onProgress({ ...progress("hashing", file.size), bytesProcessed });
  }, signal);
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  const intent: PublicationIntent = {
    schema: PUBLISH_SCHEMA,
    object_id: normalizeObjectId(metadata.objectId),
    title: strictText(metadata.title, 160, "title"),
    summary: strictText(metadata.summary, 500, "summary"),
    artifact_sha256: artifactSha256,
    artifact_bytes: file.size,
    media_type: strictText(metadata.mediaType || "application/octet-stream", 120, "media type"),
    created_at_unix_us: Date.now() * 1_000,
    nonce: base64(nonce),
    publisher_public_key: base64(identity.publicKeyBytes),
    signature: "",
  };
  const preimage = publicationPreimage(intent, nonce, identity.publicKeyBytes);
  const signature = await crypto.subtle.sign(
    "Ed25519",
    identity.privateKey,
    preimage.slice().buffer as ArrayBuffer,
  );
  intent.signature = base64(new Uint8Array(signature));
  onProgress(progress("admission", file.size));
  const session = validateUploadSession(await responseJson(
    await fetch(`${api}/v1/uploads`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(intent),
      signal,
    }),
  ), intent, policy);
  const status = validateUploadStatus(await responseJson(
    await fetch(`${api}/v1/uploads/${encodeURIComponent(session.upload_id)}`, {
      cache: "no-store",
      signal,
    }),
  ), session);
  const missing = status.missing_chunks;
  let completed = session.chunk_count - missing.length;
  let bytesProcessed = file.size - missing.reduce(
    (total, index) => total + chunkLength(file.size, session.chunk_bytes, index),
    0,
  );
  for (const index of missing) {
    signal?.throwIfAborted();
    const start = index * session.chunk_bytes;
    const chunk = new Uint8Array(
      await file.slice(start, Math.min(file.size, start + session.chunk_bytes)).arrayBuffer(),
    );
    const digest = `sha256:${bytesToHex(sha256(chunk))}`;
    await retry(async () => {
      const accepted = validateUploadStatus(await responseJson(
        await fetch(
          `${api}/v1/uploads/${encodeURIComponent(session.upload_id)}/chunks/${String(index)}`,
          {
            method: "PUT",
            headers: {
              "content-type": "application/octet-stream",
              "x-tessaryn-chunk-sha256": digest,
            },
            body: chunk,
            signal,
          },
        ),
      ), session);
      if (!accepted.received_chunks.includes(index)) {
        throw new Error("public Weave did not retain the uploaded chunk");
      }
    }, signal);
    completed += 1;
    bytesProcessed += chunk.length;
    onProgress({
      stage: "uploading",
      bytesProcessed,
      totalBytes: file.size,
      completedChunks: completed,
      totalChunks: session.chunk_count,
    });
  }
  onProgress({
    stage: "verifying",
    bytesProcessed: file.size,
    totalBytes: file.size,
    completedChunks: session.chunk_count,
    totalChunks: session.chunk_count,
  });
  const receipt = validatePublicationReceipt(await responseJson(
    await fetch(`${api}/v1/uploads/${encodeURIComponent(session.upload_id)}/commit`, {
      method: "POST",
      signal,
    }),
  ), session, metadata, api);
  onProgress({
    stage: "complete",
    bytesProcessed: file.size,
    totalBytes: file.size,
    completedChunks: session.chunk_count,
    totalChunks: session.chunk_count,
  });
  return receipt;
}

export async function saveToPersonalWeave(
  file: File,
  metadata: PublicationMetadata,
  knownDigest?: Digest,
): Promise<PersonalWeaveObject> {
  await navigator.storage?.persist?.();
  const artifactSha256 = knownDigest ?? (await hashFile(file));
  const localId = artifactSha256.replace("sha256:", "");
  let storage: PersonalWeaveObject["storage"] = "indexeddb";
  let blob: Blob | undefined = file;
  if (navigator.storage?.getDirectory) {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(`${localId}.artifact`, { create: true });
    const writable = await handle.createWritable();
    await file.stream().pipeTo(writable);
    storage = "opfs";
    blob = undefined;
  }
  const record: PersonalWeaveObject = {
    localId,
    objectId: normalizeObjectId(metadata.objectId),
    title: strictText(metadata.title, 160, "title"),
    summary: strictText(metadata.summary, 500, "summary"),
    fileName: file.name || `${metadata.objectId}.tessaryn`,
    mediaType: metadata.mediaType || "application/octet-stream",
    bytes: file.size,
    artifactSha256,
    cellId: metadata.cellId,
    rootprintBranch: metadata.rootprintBranch,
    artifactKind: metadata.artifactKind,
    addedAtUnixUs: Date.now() * 1_000,
    storage,
    blob,
  };
  const database = await openDatabase();
  await requestDone(database.transaction(OBJECT_STORE, "readwrite").objectStore(OBJECT_STORE).put(record));
  database.close();
  return record;
}

export async function listPersonalWeave(): Promise<PersonalWeaveObject[]> {
  const database = await openDatabase();
  const records = await requestDone<PersonalWeaveObject[]>(
    database.transaction(OBJECT_STORE, "readonly").objectStore(OBJECT_STORE).getAll(),
  );
  database.close();
  return records.sort((left, right) => right.addedAtUnixUs - left.addedAtUnixUs);
}

export async function personalWeaveFile(record: PersonalWeaveObject): Promise<File> {
  let blob = record.blob;
  if (record.storage === "opfs") {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(`${record.localId}.artifact`);
    blob = await handle.getFile();
  }
  if (!blob) throw new Error("personal Weave bytes are unavailable on this device");
  if (blob.size !== record.bytes || (await hashFile(blob)) !== record.artifactSha256) {
    throw new Error("personal Weave bytes do not match their retained identity");
  }
  return new File([blob], record.fileName, { type: record.mediaType, lastModified: 0 });
}

export async function markPersonalObjectPublished(
  localId: string,
  receipt: PublicationReceipt,
): Promise<void> {
  const database = await openDatabase();
  const record = await requestDone<PersonalWeaveObject | undefined>(
    database.transaction(OBJECT_STORE, "readonly").objectStore(OBJECT_STORE).get(localId),
  );
  if (record) {
    record.publicationId = receipt.publication_id;
    record.publicArtifact = receipt.artifact_url;
    await requestDone(
      database.transaction(OBJECT_STORE, "readwrite").objectStore(OBJECT_STORE).put(record),
    );
  }
  database.close();
}

export async function revokePublication(
  api: string,
  publicationId: string,
  signal?: AbortSignal,
): Promise<void> {
  const identity = await publisherIdentity();
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  const createdAtUnixUs = Date.now() * 1_000;
  const preimage = revocationPreimage(
    publicationId,
    createdAtUnixUs,
    nonce,
    identity.publicKeyBytes,
  );
  const signature = await crypto.subtle.sign(
    "Ed25519",
    identity.privateKey,
    preimage.slice().buffer as ArrayBuffer,
  );
  const revocation: PublicationRevocation = {
    schema: "tessaryn/publication-revocation/v1",
    publication_id: publicationId,
    created_at_unix_us: createdAtUnixUs,
    nonce: base64(nonce),
    signature: base64(new Uint8Array(signature)),
  };
  const response = await fetch(`${api}/v1/publications/revoke`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(revocation),
    signal,
  });
  const accepted = (await responseJson(response)) as Partial<PublicationRevocation>;
  if (accepted.publication_id !== publicationId) {
    throw new Error("public Weave returned an invalid revocation receipt");
  }
}

export async function markPersonalObjectUnpublished(localId: string): Promise<void> {
  const database = await openDatabase();
  const record = await requestDone<PersonalWeaveObject | undefined>(
    database.transaction(OBJECT_STORE, "readonly").objectStore(OBJECT_STORE).get(localId),
  );
  if (record) {
    delete record.publicationId;
    delete record.publicArtifact;
    await requestDone(
      database.transaction(OBJECT_STORE, "readwrite").objectStore(OBJECT_STORE).put(record),
    );
  }
  database.close();
}

export async function removePersonalObject(record: PersonalWeaveObject): Promise<void> {
  const database = await openDatabase();
  await requestDone(database.transaction(OBJECT_STORE, "readwrite").objectStore(OBJECT_STORE).delete(record.localId));
  database.close();
  if (record.storage === "opfs" && navigator.storage?.getDirectory) {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(`${record.localId}.artifact`).catch(() => undefined);
  }
}

export async function hashFile(
  file: Blob,
  onProgress?: (bytesProcessed: number) => void,
  signal?: AbortSignal,
): Promise<Digest> {
  const hasher = sha256.create();
  let offset = 0;
  while (offset < file.size) {
    signal?.throwIfAborted();
    const end = Math.min(file.size, offset + HASH_WINDOW_BYTES);
    hasher.update(new Uint8Array(await file.slice(offset, end).arrayBuffer()));
    offset = end;
    onProgress?.(offset);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return `sha256:${bytesToHex(hasher.digest())}`;
}

function publicationPreimage(
  intent: PublicationIntent,
  nonce: Uint8Array,
  publicKey: Uint8Array,
): Uint8Array {
  const bytes: number[] = [...new TextEncoder().encode("TESSARYN-WEAVE-PUBLICATION-v1\0")];
  appendField(bytes, intent.object_id);
  appendField(bytes, intent.title);
  appendField(bytes, intent.summary);
  appendField(bytes, intent.artifact_sha256);
  appendU64(bytes, intent.artifact_bytes);
  appendField(bytes, intent.media_type);
  appendI64(bytes, intent.created_at_unix_us);
  bytes.push(...nonce, ...publicKey);
  return new Uint8Array(bytes);
}

function revocationPreimage(
  publicationId: string,
  createdAtUnixUs: number,
  nonce: Uint8Array,
  publicKey: Uint8Array,
): Uint8Array {
  if (!/^obj_[a-f0-9]{64}$/u.test(publicationId)) {
    throw new Error("invalid publication identity");
  }
  const bytes: number[] = [...new TextEncoder().encode("TESSARYN-WEAVE-REVOCATION-v1\0")];
  appendField(bytes, publicationId);
  appendI64(bytes, createdAtUnixUs);
  bytes.push(...nonce, ...publicKey);
  return new Uint8Array(bytes);
}

async function publisherIdentity(): Promise<PublisherIdentity> {
  if (navigator.locks) {
    return navigator.locks.request("tessaryn-publisher-identity-v1", () =>
      loadOrCreatePublisherIdentity(),
    );
  }
  localIdentityPromise ??= loadOrCreatePublisherIdentity().finally(() => {
    localIdentityPromise = null;
  });
  return localIdentityPromise;
}

async function loadOrCreatePublisherIdentity(): Promise<PublisherIdentity> {
  const database = await openDatabase();
  const store = database.transaction(IDENTITY_STORE, "readonly").objectStore(IDENTITY_STORE);
  const existing = await requestDone<StoredIdentity | undefined>(store.get("publisher"));
  if (existing) {
    if (
      existing.privateKey.algorithm.name !== "Ed25519" ||
      !existing.privateKey.usages.includes("sign") ||
      existing.publicKeyBytes.byteLength !== 32
    ) {
      database.close();
      throw new Error("the retained publisher identity is malformed");
    }
    if (existing.privateKey.extractable) {
      const exported = await crypto.subtle.exportKey("pkcs8", existing.privateKey);
      existing.privateKey = await crypto.subtle.importKey(
        "pkcs8",
        exported,
        "Ed25519",
        false,
        ["sign"],
      );
      new Uint8Array(exported).fill(0);
      await requestDone(
        database.transaction(IDENTITY_STORE, "readwrite").objectStore(IDENTITY_STORE).put(existing),
      );
    }
    database.close();
    return existing;
  }
  let pair: CryptoKeyPair;
  try {
    pair = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
  } catch {
    database.close();
    throw new Error("this browser cannot create the Ed25519 publisher identity required by the public Weave");
  }
  const publicKeyBytes = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const exportedPrivateKey = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    exportedPrivateKey,
    "Ed25519",
    false,
    ["sign"],
  );
  new Uint8Array(exportedPrivateKey).fill(0);
  const identity: StoredIdentity = {
    id: "publisher",
    privateKey,
    publicKeyBytes,
  };
  const write = database.transaction(IDENTITY_STORE, "readwrite").objectStore(IDENTITY_STORE);
  await requestDone(write.put(identity));
  database.close();
  return identity;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(IDENTITY_STORE)) {
        database.createObjectStore(IDENTITY_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(OBJECT_STORE)) {
        database.createObjectStore(OBJECT_STORE, { keyPath: "localId" });
      }
    };
    request.onerror = () => reject(request.error ?? new Error("personal Weave database failed"));
    request.onsuccess = () => resolve(request.result);
  });
}

function requestDone<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("personal Weave transaction failed"));
  });
}

function appendField(output: number[], value: string): void {
  const bytes = new TextEncoder().encode(value);
  appendU32(output, bytes.length);
  output.push(...bytes);
}

function appendU32(output: number[], value: number): void {
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setUint32(0, value, true);
  output.push(...new Uint8Array(buffer));
}

function appendU64(output: number[], value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("publication byte count is unsafe");
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setBigUint64(0, BigInt(value), true);
  output.push(...new Uint8Array(buffer));
}

function appendI64(output: number[], value: number): void {
  if (!Number.isSafeInteger(value)) throw new Error("publication timestamp is unsafe");
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setBigInt64(0, BigInt(value), true);
  output.push(...new Uint8Array(buffer));
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/=+$/u, "");
}

async function responseJson(response: Response): Promise<unknown> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    value = null;
  }
  if (!response.ok) {
    const detail =
      value && typeof value === "object" && "detail" in value && typeof value.detail === "string"
        ? value.detail
        : `public Weave request failed (${String(response.status)})`;
    throw new Error(detail);
  }
  return value;
}

async function retry(operation: () => Promise<void>, signal?: AbortSignal): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    signal?.throwIfAborted();
    try {
      await operation();
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
    }
  }
  throw lastError;
}

function progress(stage: PublicationProgress["stage"], totalBytes: number): PublicationProgress {
  return { stage, bytesProcessed: 0, totalBytes, completedChunks: 0, totalChunks: 0 };
}

function normalizeObjectId(value: string): string {
  const normalized = value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 96);
  if (normalized.length < 3) throw new Error("object ID must contain at least three letters or numbers");
  return normalized;
}

function strictText(value: string, maximum: number, label: string): string {
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > maximum ||
    /[\u0000-\u001f\u007f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/u.test(normalized)
  ) {
    throw new Error(`invalid publication ${label}`);
  }
  return normalized;
}

function validateUploadSession(
  value: unknown,
  intent: PublicationIntent,
  policy: WeaveNodePolicy,
): UploadSession {
  if (!value || typeof value !== "object") {
    throw new Error("public Weave returned an invalid upload session");
  }
  const session = value as Partial<UploadSession>;
  const chunkBytes = session.chunk_bytes;
  const chunkCount = session.chunk_count;
  if (
    session.schema !== "tessaryn/upload-session/v1" ||
    typeof session.upload_id !== "string" ||
    !/^upl_[a-f0-9]{64}$/u.test(session.upload_id) ||
    typeof session.publisher_id !== "string" ||
    !/^key_[a-f0-9]{64}$/u.test(session.publisher_id) ||
    !Number.isSafeInteger(chunkBytes) ||
    (chunkBytes ?? 0) <= 0 ||
    chunkBytes !== policy.chunk_bytes ||
    !Number.isSafeInteger(chunkCount) ||
    (chunkCount ?? 0) <= 0 ||
    chunkCount !== Math.ceil(intent.artifact_bytes / chunkBytes) ||
    !sameIntent(session.intent, intent)
  ) {
    throw new Error("public Weave returned an invalid upload session");
  }
  return session as UploadSession;
}

function validateUploadStatus(value: unknown, session: UploadSession): UploadStatus {
  if (!value || typeof value !== "object") {
    throw new Error("public Weave returned an invalid upload status");
  }
  const status = value as Partial<UploadStatus>;
  const received = validChunkIndexes(status.received_chunks, session.chunk_count);
  const missing = validChunkIndexes(status.missing_chunks, session.chunk_count);
  if (
    status.upload_id !== session.upload_id ||
    status.chunk_count !== session.chunk_count ||
    received === null ||
    missing === null ||
    received.some((index) => missing.includes(index)) ||
    new Set([...received, ...missing]).size !== session.chunk_count ||
    typeof status.ready_to_commit !== "boolean" ||
    status.ready_to_commit !== (missing.length === 0)
  ) {
    throw new Error("public Weave returned an invalid upload status");
  }
  return {
    upload_id: session.upload_id,
    chunk_count: session.chunk_count,
    received_chunks: received,
    missing_chunks: missing,
    ready_to_commit: status.ready_to_commit,
  };
}

function validatePublicationReceipt(
  value: unknown,
  session: UploadSession,
  metadata: PublicationMetadata,
  api: string,
): PublicationReceipt {
  if (!value || typeof value !== "object") {
    throw new Error("public Weave returned an invalid publication receipt");
  }
  const receipt = value as Partial<PublicationReceipt>;
  let artifactUrl: URL;
  try {
    artifactUrl = new URL(receipt.artifact_url ?? "");
  } catch {
    throw new Error("public Weave returned an invalid artifact URL");
  }
  const artifactHex = session.intent.artifact_sha256.replace("sha256:", "");
  if (
    receipt.schema !== "tessaryn/publication-receipt/v1" ||
    typeof receipt.publication_id !== "string" ||
    !/^obj_[a-f0-9]{64}$/u.test(receipt.publication_id) ||
    receipt.publisher_id !== session.publisher_id ||
    !Number.isSafeInteger(receipt.accepted_at_unix_us) ||
    (receipt.accepted_at_unix_us ?? 0) <= 0 ||
    receipt.artifact_kind !== metadata.artifactKind ||
    artifactUrl.origin !== new URL(api).origin ||
    artifactUrl.pathname !== `/v1/artifacts/${artifactHex}` ||
    artifactUrl.search !== "" ||
    artifactUrl.hash !== "" ||
    receipt.cell_id !== metadata.cellId ||
    receipt.rootprint_branch !== metadata.rootprintBranch ||
    !Number.isSafeInteger(receipt.moments) ||
    (receipt.moments ?? 0) <= 0 ||
    typeof receipt.dimensions !== "string" ||
    typeof receipt.media !== "string" ||
    !sameIntent(receipt.intent, session.intent)
  ) {
    throw new Error("publication receipt does not bind the locally verified object");
  }
  return receipt as PublicationReceipt;
}

function validChunkIndexes(value: unknown, chunkCount: number): number[] | null {
  if (!Array.isArray(value)) return null;
  const indexes = value.filter(
    (index): index is number =>
      Number.isSafeInteger(index) && index >= 0 && index < chunkCount,
  );
  if (indexes.length !== value.length || new Set(indexes).size !== indexes.length) return null;
  return indexes;
}

function sameIntent(left: PublicationIntent | undefined, right: PublicationIntent): boolean {
  return Boolean(
    left &&
      left.schema === right.schema &&
      left.object_id === right.object_id &&
      left.title === right.title &&
      left.summary === right.summary &&
      left.artifact_sha256 === right.artifact_sha256 &&
      left.artifact_bytes === right.artifact_bytes &&
      left.media_type === right.media_type &&
      left.created_at_unix_us === right.created_at_unix_us &&
      left.nonce === right.nonce &&
      left.publisher_public_key === right.publisher_public_key &&
      left.signature === right.signature,
  );
}

function chunkLength(fileBytes: number, chunkBytes: number, index: number): number {
  return Math.min(chunkBytes, fileBytes - index * chunkBytes);
}

function isPublicCatalogV2(value: unknown, api: string): value is {
  schema: "tessaryn/public-object-catalog/v2";
  updated_at_unix_us: number;
  objects: PublicObjectCatalogEntry[];
} {
  if (!value || typeof value !== "object") return false;
  const apiOrigin = new URL(api).origin;
  const catalog = value as Record<string, unknown>;
  return (
    catalog.schema === "tessaryn/public-object-catalog/v2" &&
    Number.isSafeInteger(catalog.updated_at_unix_us) &&
    Array.isArray(catalog.objects) &&
    catalog.objects.every((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const object = entry as Record<string, unknown>;
      let artifact: URL;
      try {
        artifact = new URL(String(object.artifact));
      } catch {
        return false;
      }
      return (
        typeof object.publication_id === "string" && /^obj_[a-f0-9]{64}$/u.test(object.publication_id) &&
        typeof object.publisher_id === "string" && /^key_[a-f0-9]{64}$/u.test(object.publisher_id) &&
        typeof object.object_id === "string" && /^[a-z0-9][a-z0-9-]{1,94}[a-z0-9]$/u.test(object.object_id) &&
        typeof object.title === "string" &&
        typeof object.summary === "string" &&
        typeof object.artifact === "string" &&
        artifact.origin === apiOrigin &&
        artifact.search === "" &&
        artifact.hash === "" &&
        typeof object.artifact_sha256 === "string" && /^sha256:[a-f0-9]{64}$/u.test(object.artifact_sha256) &&
        artifact.pathname === `/v1/artifacts/${object.artifact_sha256.slice(7)}` &&
        typeof object.artifact_bytes === "number" && Number.isSafeInteger(object.artifact_bytes) && object.artifact_bytes > 0 &&
        (object.artifact_kind === "cinematic_object" || object.artifact_kind === "rgbd_reconstruction") &&
        typeof object.cell_id === "string" && /^sha256:[a-f0-9]{64}$/u.test(object.cell_id) &&
        typeof object.rootprint_branch === "string" && /^sha256:[a-f0-9]{64}$/u.test(object.rootprint_branch) &&
        typeof object.media === "string" &&
        typeof object.dimensions === "string" &&
        typeof object.moments === "number" && Number.isSafeInteger(object.moments) && object.moments > 0 &&
        typeof object.accepted_at_unix_us === "number" && Number.isSafeInteger(object.accepted_at_unix_us)
      );
    })
  );
}

function formatBytes(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)} GB`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(value / 1_000))} KB`;
}
