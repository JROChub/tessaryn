import { sha256 } from "@noble/hashes/sha2.js";
import "./keyxym-mobile.css";
import {
  CHUNK_BYTES,
  clearPersonalWeave,
  deletePersonalObject,
  getJournal,
  getPersonalBlob,
  listPersonalObjects,
  persistJournal,
  persistPersonalObject,
  storageEstimate,
  type StoredObject,
  type TransferJournal,
} from "./keyxym-personal-store";

const elements = {
  captureButton: byId<HTMLButtonElement>("capture-button"),
  sampleButton: byId<HTMLButtonElement>("sample-button"),
  input: byId<HTMLInputElement>("file-input"),
  clearButton: byId<HTMLButtonElement>("clear-button"),
  deleteButton: byId<HTMLButtonElement>("delete-button"),
  viewButton: byId<HTMLButtonElement>("view-button"),
  shareButton: byId<HTMLButtonElement>("share-button"),
  syncButton: byId<HTMLButtonElement>("sync-button"),
  interruptButton: byId<HTMLButtonElement>("interrupt-button"),
  deviceId: byId<HTMLElement>("device-id"),
  objectCount: byId<HTMLElement>("object-count"),
  localBytes: byId<HTMLElement>("local-bytes"),
  storageQuota: byId<HTMLElement>("storage-quota"),
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
  preview: byId<HTMLDialogElement>("preview-dialog"),
  previewTitle: byId<HTMLElement>("preview-title"),
  previewBody: byId<HTMLElement>("preview-body"),
  previewClose: byId<HTMLButtonElement>("preview-close"),
};

let activeObject: StoredObject | null = null;
let interruptRequested = false;
let syncRunning = false;
let previewUrl: string | null = null;

void boot();

async function boot(): Promise<void> {
  elements.deviceId.textContent = (await getOrCreateDeviceId()).slice(0, 16).toUpperCase();
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
  elements.viewButton.addEventListener("click", () => void viewActiveObject());
  elements.shareButton.addEventListener("click", () => void shareActiveObject());
  elements.deleteButton.addEventListener("click", () => void deleteActiveObject());
  elements.clearButton.addEventListener("click", () => void clearAllObjects());
  elements.previewClose.addEventListener("click", closePreview);
  elements.preview.addEventListener("close", closePreviewUrl);
  const objects = await listPersonalObjects();
  activeObject = objects[0] ?? null;
  await refreshSummary();
  if (activeObject) await renderObject(activeObject);
}

async function runSample(): Promise<void> {
  const seed = crypto.getRandomValues(new Uint8Array(32));
  const bytes = new Uint8Array(768 * 1024);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = seed[index % seed.length]! ^ (index & 0xff);
  await ingestFile(new File([bytes], "cross-device-pocket-weave.sample", { type: "application/octet-stream" }));
}

async function ingestFile(file: File): Promise<void> {
  setControls(false);
  resetPipeline();
  appendEvent(`READ / ${file.name} / ${formatBytes(file.size)}`);
  setStep("read", "active");
  const chunkHashes: string[] = [];
  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_BYTES));
  const objectHasher = sha256.create();
  for (let index = 0; index < totalChunks; index += 1) {
    const chunk = new Uint8Array(await file.slice(index * CHUNK_BYTES, Math.min(file.size, (index + 1) * CHUNK_BYTES)).arrayBuffer());
    objectHasher.update(chunk);
    setStep("hash", "active");
    chunkHashes.push(bytesToHex(sha256(chunk)));
    setStep("chunk", "active");
    setProgress(8 + Math.round(((index + 1) / totalChunks) * 52), `Hashing chunk ${index + 1} of ${totalChunks}`);
    await nextFrame();
  }
  setStep("read", "done"); setStep("hash", "done"); setStep("chunk", "done");
  const stored: StoredObject = {
    id: bytesToHex(objectHasher.digest()), name: file.name,
    mediaType: file.type || "application/octet-stream", bytes: file.size,
    chunks: chunkHashes, createdAt: Date.now(),
  };
  setStep("persist", "active");
  setProgress(72, "Committing source bytes, metadata, and resume journal");
  await persistPersonalObject(stored, file);
  setStep("persist", "done");
  setProgress(100, "Object saved to your Personal Weave");
  activeObject = stored;
  await renderObject(stored); await refreshSummary();
  appendEvent(`ADMITTED / ${shortDigest(stored.id)} / ${stored.chunks.length} chunks / source retained locally`);
  setControls(true);
}

async function synchronize(): Promise<void> {
  if (!activeObject || syncRunning) return;
  syncRunning = true; interruptRequested = false; setControls(false);
  elements.interruptButton.disabled = false; setStep("sync", "active"); setPeerState("SYNCING", "active");
  appendEvent("HELLO / simulated peer admitted for local demonstration.");
  const journal = (await getJournal(activeObject.id)) ?? newJournal(activeObject.id);
  const acknowledged = new Set(journal.acknowledged);
  const missing = activeObject.chunks.map((_, index) => index).filter((index) => !acknowledged.has(index));
  appendEvent(`ANTI-ENTROPY / ${missing.length} missing chunks.`);
  for (const chunkIndex of missing) {
    await sleep(90); acknowledged.add(chunkIndex);
    const progress = Math.round((acknowledged.size / activeObject.chunks.length) * 100);
    setProgress(progress, `Replicating chunk ${chunkIndex + 1}`);
    appendEvent(`CHUNK ${chunkIndex + 1} / ${activeObject.chunks[chunkIndex]!.slice(0, 12)} / ACK`);
    await persistJournal({ objectId: activeObject.id, acknowledged: [...acknowledged].sort((a, b) => a - b), complete: acknowledged.size === activeObject.chunks.length, updatedAt: Date.now() });
    await renderObject(activeObject);
    if (interruptRequested || (elements.interruptButton.dataset.auto === "true" && progress >= 40)) {
      elements.interruptButton.dataset.auto = "false";
      appendEvent(`INTERRUPTED / ${acknowledged.size} acknowledgements persisted.`);
      setPeerState("PAUSED", "paused"); elements.pipelineTitle.textContent = "TRANSFER PAUSED / PRESS SYNC TO RESUME";
      syncRunning = false; setControls(true); return;
    }
  }
  await persistJournal({ objectId: activeObject.id, acknowledged: [...acknowledged].sort((a, b) => a - b), complete: true, updatedAt: Date.now() });
  setStep("sync", "done"); setProgress(100, "Both demo peers converged"); setPeerState("CONVERGED", "done");
  appendEvent(`RECEIPT / ${shortDigest(activeObject.id)} / complete=true`);
  await renderObject(activeObject); syncRunning = false; setControls(true);
}

async function viewActiveObject(): Promise<void> {
  if (!activeObject) return;
  const blob = await getPersonalBlob(activeObject.id);
  if (!blob) { appendEvent("VIEW FAILED / source bytes unavailable for this legacy record."); return; }
  closePreviewUrl();
  previewUrl = URL.createObjectURL(blob);
  elements.previewTitle.textContent = activeObject.name;
  elements.previewBody.replaceChildren(createPreview(blob, previewUrl, activeObject.name));
  elements.preview.showModal();
}

async function shareActiveObject(): Promise<void> {
  if (!activeObject) return;
  const blob = await getPersonalBlob(activeObject.id);
  if (!blob) { appendEvent("SHARE FAILED / source bytes unavailable for this legacy record."); return; }
  const file = new File([blob], activeObject.name, { type: activeObject.mediaType });
  try {
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ title: activeObject.name, text: `TESSARYN object ${activeObject.id}`, files: [file] });
    else if (navigator.share) await navigator.share({ title: activeObject.name, text: `TESSARYN object ${activeObject.id}` });
    else downloadBlob(blob, activeObject.name);
    appendEvent(`SHARED / ${shortDigest(activeObject.id)}`);
  } catch (error) {
    if ((error as DOMException).name !== "AbortError") appendEvent(`SHARE FAILED / ${(error as Error).message}`);
  }
}

async function deleteActiveObject(): Promise<void> {
  if (!activeObject || syncRunning) return;
  const id = activeObject.id;
  if (!window.confirm(`Delete ${activeObject.name} source bytes, metadata, and journal from this device?`)) return;
  await deletePersonalObject(id);
  activeObject = (await listPersonalObjects())[0] ?? null;
  appendEvent(`DELETED / ${shortDigest(id)} / bytes + metadata + journal`);
  await refreshSummary();
  if (activeObject) await renderObject(activeObject); else resetObjectPanel();
}

async function clearAllObjects(): Promise<void> {
  if (syncRunning || !window.confirm("Delete every Personal Weave object, source Blob, and transfer journal from this device?")) return;
  await clearPersonalWeave(); activeObject = null; resetObjectPanel(); resetPipeline();
  setPeerState("IDLE", "idle"); elements.eventLog.textContent = "READY / Personal Weave cleared."; await refreshSummary();
}

async function renderObject(object: StoredObject): Promise<void> {
  const journal = await getJournal(object.id);
  elements.objectName.textContent = object.name; elements.objectDigest.textContent = object.id;
  elements.objectSize.textContent = formatBytes(object.bytes); elements.objectChunks.textContent = String(object.chunks.length);
  elements.objectJournal.textContent = journal?.complete ? "COMPLETE" : `${journal?.acknowledged.length ?? 0}/${object.chunks.length} ACKNOWLEDGED`;
  const hasBlob = Boolean(await getPersonalBlob(object.id));
  elements.viewButton.disabled = !hasBlob; elements.shareButton.disabled = !hasBlob; elements.deleteButton.disabled = false;
  elements.syncButton.disabled = false; elements.interruptButton.disabled = false;
}

async function refreshSummary(): Promise<void> {
  const objects = await listPersonalObjects();
  elements.objectCount.textContent = String(objects.length);
  elements.localBytes.textContent = formatBytes(objects.reduce((sum, object) => sum + object.bytes, 0));
  const estimate = await storageEstimate();
  elements.storageQuota.textContent = estimate.quota > 0 ? `${formatBytes(estimate.usage)} / ${formatBytes(estimate.quota)} (${estimate.percent.toFixed(1)}%)` : "UNAVAILABLE";
}

function createPreview(blob: Blob, url: string, name: string): HTMLElement {
  if (blob.type.startsWith("image/")) { const image = document.createElement("img"); image.src = url; image.alt = name; return image; }
  if (blob.type.startsWith("video/")) { const video = document.createElement("video"); video.src = url; video.controls = true; video.playsInline = true; return video; }
  if (blob.type === "application/pdf") { const frame = document.createElement("iframe"); frame.src = url; frame.title = name; return frame; }
  if (blob.type.startsWith("text/") || blob.type.includes("json")) { const frame = document.createElement("iframe"); frame.src = url; frame.title = name; return frame; }
  const box = document.createElement("div"); box.className = "unsupported-preview";
  box.innerHTML = `<b>PREVIEW NOT AVAILABLE</b><p>This file type can still be shared or downloaded intact.</p>`;
  const button = document.createElement("button"); button.textContent = "DOWNLOAD OBJECT"; button.onclick = () => downloadBlob(blob, name); box.append(button); return box;
}

function resetObjectPanel(): void {
  elements.objectName.textContent = "NONE"; elements.objectDigest.textContent = "—"; elements.objectSize.textContent = "—";
  elements.objectChunks.textContent = "—"; elements.objectJournal.textContent = "EMPTY";
  for (const button of [elements.viewButton, elements.shareButton, elements.deleteButton, elements.syncButton, elements.interruptButton]) button.disabled = true;
}
function resetPipeline(): void { for (const item of elements.pipelineSteps.querySelectorAll<HTMLElement>("li")) item.classList.remove("active", "done"); setProgress(0, "Ready for a local object"); }
function setStep(name: string, state: "active" | "done"): void { const item = elements.pipelineSteps.querySelector<HTMLElement>(`[data-step="${name}"]`); if (!item) return; if (state === "done") item.classList.remove("active"); item.classList.add(state); }
function setProgress(percent: number, title: string): void { const bounded = Math.max(0, Math.min(100, percent)); elements.pipelinePercent.value = `${bounded}%`; elements.pipelineBar.style.width = `${bounded}%`; elements.pipelineTitle.textContent = title.toUpperCase(); }
function setPeerState(label: string, state: string): void { elements.peerState.textContent = label; elements.peerState.className = `state-pill ${state}`; }
function setControls(enabled: boolean): void { elements.captureButton.disabled = !enabled; elements.sampleButton.disabled = !enabled; elements.syncButton.disabled = !enabled || !activeObject; elements.interruptButton.disabled = !syncRunning && !activeObject; elements.viewButton.disabled = !enabled || !activeObject; elements.shareButton.disabled = !enabled || !activeObject; elements.deleteButton.disabled = !enabled || !activeObject; }
function appendEvent(message: string): void { const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }); elements.eventLog.textContent += `\n${stamp} / ${message}`; elements.eventLog.scrollTop = elements.eventLog.scrollHeight; }
function updateNetworkState(): void { elements.networkState.textContent = navigator.onLine ? "ONLINE" : "OFFLINE"; }
async function getOrCreateDeviceId(): Promise<string> { const existing = localStorage.getItem("tessaryn-keyxym-device-id"); if (existing) return existing; const id = bytesToHex(sha256(crypto.getRandomValues(new Uint8Array(32)))); localStorage.setItem("tessaryn-keyxym-device-id", id); return id; }
function newJournal(id: string): TransferJournal { return { objectId: id, acknowledged: [], complete: false, updatedAt: Date.now() }; }
function bytesToHex(bytes: Uint8Array): string { return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join(""); }
function formatBytes(bytes: number): string { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`; if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(2)} MiB`; return `${(bytes / 1024 ** 3).toFixed(2)} GiB`; }
function shortDigest(value: string): string { return `${value.slice(0, 12)}…${value.slice(-8)}`; }
function byId<T extends HTMLElement>(id: string): T { const element = document.getElementById(id); if (!element) throw new Error(`Missing required element: ${id}`); return element as T; }
function sleep(ms: number): Promise<void> { return new Promise((resolve) => window.setTimeout(resolve, ms)); }
function nextFrame(): Promise<void> { return new Promise((resolve) => requestAnimationFrame(() => resolve())); }
function closePreview(): void { elements.preview.close(); }
function closePreviewUrl(): void { if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null; }
function downloadBlob(blob: Blob, name: string): void { const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
