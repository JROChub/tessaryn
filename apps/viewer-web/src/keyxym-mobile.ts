import { sha256 } from "@noble/hashes/sha2.js";
import "./keyxym-mobile.css";

const CHUNK_BYTES = 256 * 1024;
const DB_NAME = "tessaryn-keyxym-mobile-demo";
const DB_VERSION = 1;
const META_STORE = "metadata";
const JOURNAL_STORE = "journals";

interface StoredObject {
  id: string;
  name: string;
  mediaType: string;
  bytes: number;
  chunks: string[];
  createdAt: number;
}

interface TransferJournal {
  objectId: string;
  acknowledged: number[];
  complete: boolean;
  updatedAt: number;
}

const elements = {
  captureButton: byId<HTMLButtonElement>("capture-button"),
  sampleButton: byId<HTMLButtonElement>("sample-button"),
  input: byId<HTMLInputElement>("file-input"),
  clearButton: byId<HTMLButtonElement>("clear-button"),
  syncButton: byId<HTMLButtonElement>("sync-button"),
  interruptButton: byId<HTMLButtonElement>("interrupt-button"),
  deviceId: byId<HTMLElement>("device-id"),
  objectCount: byId<HTMLElement>("object-count"),
  localBytes: byId<HTMLElement>("local-bytes"),
  networkState: byId<HTMLElement>("network-state"),
  pipelineTitle: byId<HTMLElement>("pipeline-title"),
  pipelinePercent: byId<HTMLOutputElement>("pipeline-percent"),
  pipelineBar: byId<HTMLElement>("pipeline-bar"),
  pipelineSteps: byId<HTMLOListElement>("pipeline-steps"),
  objectName: byId<HTMLElement>("object-name"),
  objectDigest: byId<HTMLElement>("object-digest"),
  objectSize: byId<HTMLElement>("object-size"),
  objectChunks: byId<HTMLElement>("object-chunks"),
  objectJournal: byId<HTMLElement>("object-journal"),
  peerState: byId<HTMLElement>("peer-state"),
  eventLog: byId<HTMLPreElement>("event-log"),
};

let activeObject: StoredObject | null = null;
let interruptRequested = false;
let syncRunning = false;

void boot();

async function boot(): Promise<void> {
  const deviceId = await getOrCreateDeviceId();
  elements.deviceId.textContent = deviceId.slice(0, 16).toUpperCase();
  updateNetworkState();
  window.addEventListener("online", updateNetworkState);
  window.addEventListener("offline", updateNetworkState);
  elements.captureButton.addEventListener("click", () => elements.input.click());
  elements.sampleButton.addEventListener("click", () => void runSample());
  elements.input.addEventListener("change", () => {
    const file = elements.input.files?.[0];
    if (file) void ingestFile(file);
    elements.input.value = "";
  });
  elements.syncButton.addEventListener("click", () => void synchronize());
  elements.interruptButton.addEventListener("click", () => {
    interruptRequested = true;
    appendEvent("INTERRUPT REQUESTED / journal will remain durable.");
  });
  elements.clearButton.addEventListener("click", () => void clearLocalState());
  const objects = await listObjects();
  activeObject = objects.at(-1) ?? null;
  await refreshSummary();
  if (activeObject) await renderObject(activeObject);
}

async function runSample(): Promise<void> {
  const seed = crypto.getRandomValues(new Uint8Array(32));
  const bytes = new Uint8Array(768 * 1024);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = seed[index % seed.length] ^ (index & 0xff);
  }
  await ingestFile(new File([bytes], "iphone-pocket-weave.sample", { type: "application/octet-stream" }));
}

async function ingestFile(file: File): Promise<void> {
  setControls(false);
  resetPipeline();
  appendEvent(`READ / ${file.name} / ${formatBytes(file.size)}`);
  setStep("read", "active");
  setProgress(4, "Reading bounded slices");

  const chunkHashes: string[] = [];
  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_BYTES));
  const objectHasher = sha256.create();

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
    const start = chunkIndex * CHUNK_BYTES;
    const end = Math.min(file.size, start + CHUNK_BYTES);
    const chunk = new Uint8Array(await file.slice(start, end).arrayBuffer());
    objectHasher.update(chunk);
    setStep("hash", "active");
    const chunkHash = await digestHex(chunk);
    chunkHashes.push(chunkHash);
    setStep("chunk", "active");
    const fraction = (chunkIndex + 1) / totalChunks;
    setProgress(8 + Math.round(fraction * 52), `Hashing chunk ${chunkIndex + 1} of ${totalChunks}`);
    await nextFrame();
  }

  setStep("read", "done");
  setStep("hash", "done");
  setStep("chunk", "done");
  const id = bytesToHex(objectHasher.digest());
  const stored: StoredObject = {
    id,
    name: file.name,
    mediaType: file.type || "application/octet-stream",
    bytes: file.size,
    chunks: chunkHashes,
    createdAt: Date.now(),
  };

  setStep("persist", "active");
  setProgress(72, "Committing local metadata and resume journal");
  await putRecord(META_STORE, stored);
  const existing = await getRecord<TransferJournal>(JOURNAL_STORE, stored.id);
  if (!existing) {
    await putRecord(JOURNAL_STORE, {
      objectId: stored.id,
      acknowledged: [],
      complete: false,
      updatedAt: Date.now(),
    } satisfies TransferJournal);
  }
  setStep("persist", "done");
  setProgress(100, "Object admitted to the local weave");
  activeObject = stored;
  await renderObject(stored);
  await refreshSummary();
  appendEvent(`ADMITTED / ${shortDigest(stored.id)} / ${stored.chunks.length} chunks`);
  setControls(true);
}

async function synchronize(): Promise<void> {
  if (!activeObject || syncRunning) return;
  syncRunning = true;
  interruptRequested = false;
  setControls(false);
  elements.interruptButton.disabled = false;
  setStep("sync", "active");
  setPeerState("SYNCING", "active");
  appendEvent("HELLO / simulated peer admitted for local demonstration.");

  const journal = (await getRecord<TransferJournal>(JOURNAL_STORE, activeObject.id)) ?? {
    objectId: activeObject.id,
    acknowledged: [],
    complete: false,
    updatedAt: Date.now(),
  };
  const acknowledged = new Set(journal.acknowledged);
  const missing = activeObject.chunks.map((_, index) => index).filter((index) => !acknowledged.has(index));
  appendEvent(`ANTI-ENTROPY / ${missing.length} missing chunks.`);

  for (let position = 0; position < missing.length; position += 1) {
    const chunkIndex = missing[position];
    await sleep(90);
    acknowledged.add(chunkIndex);
    const progress = Math.round((acknowledged.size / activeObject.chunks.length) * 100);
    setProgress(progress, `Replicating chunk ${chunkIndex + 1}`);
    appendEvent(`CHUNK ${chunkIndex + 1} / ${activeObject.chunks[chunkIndex].slice(0, 12)} / ACK`);
    await putRecord(JOURNAL_STORE, {
      objectId: activeObject.id,
      acknowledged: [...acknowledged].sort((left, right) => left - right),
      complete: acknowledged.size === activeObject.chunks.length,
      updatedAt: Date.now(),
    } satisfies TransferJournal);
    await renderObject(activeObject);

    if (interruptRequested || (elements.interruptButton.dataset.auto === "true" && progress >= 40)) {
      elements.interruptButton.dataset.auto = "false";
      appendEvent(`INTERRUPTED / ${acknowledged.size} acknowledgements persisted.`);
      setPeerState("PAUSED", "paused");
      elements.pipelineTitle.textContent = "TRANSFER PAUSED / PRESS SYNC TO RESUME";
      syncRunning = false;
      setControls(true);
      return;
    }
  }

  await putRecord(JOURNAL_STORE, {
    objectId: activeObject.id,
    acknowledged: [...acknowledged].sort((left, right) => left - right),
    complete: true,
    updatedAt: Date.now(),
  } satisfies TransferJournal);
  setStep("sync", "done");
  setProgress(100, "Both demo peers converged");
  setPeerState("CONVERGED", "done");
  appendEvent(`RECEIPT / ${shortDigest(activeObject.id)} / complete=true`);
  await renderObject(activeObject);
  syncRunning = false;
  setControls(true);
}

async function renderObject(object: StoredObject): Promise<void> {
  const journal = await getRecord<TransferJournal>(JOURNAL_STORE, object.id);
  elements.objectName.textContent = object.name;
  elements.objectDigest.textContent = object.id;
  elements.objectSize.textContent = formatBytes(object.bytes);
  elements.objectChunks.textContent = String(object.chunks.length);
  const acknowledged = journal?.acknowledged.length ?? 0;
  elements.objectJournal.textContent = journal?.complete
    ? "COMPLETE"
    : `${acknowledged}/${object.chunks.length} ACKNOWLEDGED`;
  elements.syncButton.disabled = false;
  elements.interruptButton.disabled = false;
}

async function clearLocalState(): Promise<void> {
  if (syncRunning) return;
  await clearStore(META_STORE);
  await clearStore(JOURNAL_STORE);
  activeObject = null;
  resetPipeline();
  elements.objectName.textContent = "NONE";
  elements.objectDigest.textContent = "—";
  elements.objectSize.textContent = "—";
  elements.objectChunks.textContent = "—";
  elements.objectJournal.textContent = "EMPTY";
  elements.syncButton.disabled = true;
  elements.interruptButton.disabled = true;
  setPeerState("IDLE", "idle");
  elements.eventLog.textContent = "READY / Waiting for a local object.";
  await refreshSummary();
}

async function refreshSummary(): Promise<void> {
  const objects = await listObjects();
  elements.objectCount.textContent = String(objects.length);
  elements.localBytes.textContent = formatBytes(objects.reduce((sum, object) => sum + object.bytes, 0));
}

function resetPipeline(): void {
  for (const item of elements.pipelineSteps.querySelectorAll<HTMLElement>("li")) {
    item.classList.remove("active", "done");
  }
  setProgress(0, "Ready for a local object");
}

function setStep(name: string, state: "active" | "done"): void {
  const item = elements.pipelineSteps.querySelector<HTMLElement>(`[data-step="${name}"]`);
  if (!item) return;
  if (state === "done") item.classList.remove("active");
  item.classList.add(state);
}

function setProgress(percent: number, title: string): void {
  const bounded = Math.max(0, Math.min(100, percent));
  elements.pipelinePercent.value = `${bounded}%`;
  elements.pipelineBar.style.width = `${bounded}%`;
  elements.pipelineTitle.textContent = title.toUpperCase();
}

function setPeerState(label: string, state: string): void {
  elements.peerState.textContent = label;
  elements.peerState.className = `state-pill ${state}`;
}

function setControls(enabled: boolean): void {
  elements.captureButton.disabled = !enabled;
  elements.sampleButton.disabled = !enabled;
  elements.syncButton.disabled = !enabled || !activeObject;
  elements.interruptButton.disabled = !syncRunning && !activeObject;
}

function appendEvent(message: string): void {
  const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  elements.eventLog.textContent += `\n${stamp} / ${message}`;
  elements.eventLog.scrollTop = elements.eventLog.scrollHeight;
}

function updateNetworkState(): void {
  elements.networkState.textContent = navigator.onLine ? "ONLINE" : "OFFLINE";
}

async function getOrCreateDeviceId(): Promise<string> {
  const existing = localStorage.getItem("tessaryn-keyxym-device-id");
  if (existing) return existing;
  const random = crypto.getRandomValues(new Uint8Array(32));
  const id = await digestHex(random);
  localStorage.setItem("tessaryn-keyxym-device-id", id);
  return id;
}

async function listObjects(): Promise<StoredObject[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(META_STORE, "readonly");
    const request = transaction.objectStore(META_STORE).getAll();
    request.onsuccess = () => resolve((request.result as StoredObject[]).sort((a, b) => a.createdAt - b.createdAt));
    request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed"));
  });
}

async function putRecord(storeName: string, value: StoredObject | TransferJournal): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(value);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB write failed"));
  });
}

async function getRecord<T>(storeName: string, key: string): Promise<T | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, "readonly").objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB lookup failed"));
  });
}

async function clearStore(storeName: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB clear failed"));
  });
}

let databasePromise: Promise<IDBDatabase> | null = null;
function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(JOURNAL_STORE)) db.createObjectStore(JOURNAL_STORE, { keyPath: "objectId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
  return databasePromise;
}

async function digestHex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return bytesToHex(digest);
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function shortDigest(value: string): string {
  return `${value.slice(0, 12)}…${value.slice(-8)}`;
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element: ${id}`);
  return element as T;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
