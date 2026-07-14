import "./keyxym-mobile.css";
import {
  clearPersonalWeave,
  deletePersonalObject,
  getPersonalBlob,
  listPersonalObjects,
  storageEstimate,
  type StoredObject,
} from "./keyxym-personal-store";

const elements = {
  count: byId<HTMLElement>("weave-count"),
  bytes: byId<HTMLElement>("weave-bytes"),
  quota: byId<HTMLElement>("weave-quota"),
  search: byId<HTMLInputElement>("weave-search"),
  clear: byId<HTMLButtonElement>("weave-clear"),
  list: byId<HTMLElement>("weave-list"),
  preview: byId<HTMLDialogElement>("preview-dialog"),
  previewTitle: byId<HTMLElement>("preview-title"),
  previewBody: byId<HTMLElement>("preview-body"),
  previewClose: byId<HTMLButtonElement>("preview-close"),
};

let objects: StoredObject[] = [];
let previewUrl: string | null = null;

void boot();

async function boot(): Promise<void> {
  elements.search.addEventListener("input", render);
  elements.clear.addEventListener("click", () => void clearAll());
  elements.previewClose.addEventListener("click", () => elements.preview.close());
  elements.preview.addEventListener("close", closePreviewUrl);
  await reload();
}

async function reload(): Promise<void> {
  objects = await listPersonalObjects();
  elements.count.textContent = String(objects.length);
  elements.bytes.textContent = formatBytes(objects.reduce((sum, object) => sum + object.bytes, 0));
  const estimate = await storageEstimate();
  elements.quota.textContent = estimate.quota > 0
    ? `${formatBytes(estimate.usage)} / ${formatBytes(estimate.quota)} (${estimate.percent.toFixed(1)}%)`
    : "UNAVAILABLE";
  elements.clear.disabled = objects.length === 0;
  render();
}

function render(): void {
  const query = elements.search.value.trim().toLowerCase();
  const visible = objects.filter((object) => !query || object.name.toLowerCase().includes(query) || object.id.includes(query));
  elements.list.replaceChildren();
  if (visible.length === 0) {
    const empty = document.createElement("article");
    empty.className = "weave-empty";
    empty.innerHTML = `<b>NO PERSONAL OBJECTS</b><p>Add a photo, video, document, or file from the device demo.</p><a href="./keyxym-mobile.html">OPEN DEVICE DEMO</a>`;
    elements.list.append(empty);
    return;
  }
  for (const object of visible) elements.list.append(createCard(object));
}

function createCard(object: StoredObject): HTMLElement {
  const card = document.createElement("article");
  card.className = "weave-object";
  const heading = document.createElement("div");
  heading.className = "weave-object-heading";
  const title = document.createElement("span");
  const small = document.createElement("small"); small.textContent = new Date(object.createdAt).toLocaleString();
  const strong = document.createElement("b"); strong.textContent = object.name;
  title.append(small, strong);
  const digest = document.createElement("code"); digest.textContent = object.id;
  heading.append(title, digest);
  const meta = document.createElement("dl");
  meta.innerHTML = `<div><dt>TYPE</dt><dd>${escapeHtml(object.mediaType)}</dd></div><div><dt>SIZE</dt><dd>${formatBytes(object.bytes)}</dd></div><div><dt>CHUNKS</dt><dd>${object.chunks.length}</dd></div>`;
  const actions = document.createElement("div"); actions.className = "object-actions";
  const view = action("VIEW", "primary-action", () => void viewObject(object));
  const share = action("SHARE", "", () => void shareObject(object));
  const remove = action("DELETE", "danger-action", () => void removeObject(object));
  actions.append(view, share, remove);
  void getPersonalBlob(object.id).then((blob) => { view.disabled = !blob; share.disabled = !blob; });
  card.append(heading, meta, actions);
  return card;
}

async function viewObject(object: StoredObject): Promise<void> {
  const blob = await getPersonalBlob(object.id);
  if (!blob) return;
  closePreviewUrl();
  previewUrl = URL.createObjectURL(blob);
  elements.previewTitle.textContent = object.name;
  elements.previewBody.replaceChildren(createPreview(blob, previewUrl, object.name));
  elements.preview.showModal();
}

async function shareObject(object: StoredObject): Promise<void> {
  const blob = await getPersonalBlob(object.id);
  if (!blob) return;
  const file = new File([blob], object.name, { type: object.mediaType });
  try {
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ title: object.name, text: `TESSARYN object ${object.id}`, files: [file] });
    else if (navigator.share) await navigator.share({ title: object.name, text: `TESSARYN object ${object.id}` });
    else downloadBlob(blob, object.name);
  } catch (error) {
    if ((error as DOMException).name !== "AbortError") window.alert(`Share failed: ${(error as Error).message}`);
  }
}

async function removeObject(object: StoredObject): Promise<void> {
  if (!window.confirm(`Delete ${object.name} source bytes, metadata, and journal from this device?`)) return;
  await deletePersonalObject(object.id);
  await reload();
}

async function clearAll(): Promise<void> {
  if (!window.confirm("Delete every Personal Weave source Blob, metadata record, and transfer journal from this device?")) return;
  await clearPersonalWeave();
  await reload();
}

function createPreview(blob: Blob, url: string, name: string): HTMLElement {
  if (blob.type.startsWith("image/")) { const image = document.createElement("img"); image.src = url; image.alt = name; return image; }
  if (blob.type.startsWith("video/")) { const video = document.createElement("video"); video.src = url; video.controls = true; video.playsInline = true; return video; }
  if (blob.type.startsWith("audio/")) { const audio = document.createElement("audio"); audio.src = url; audio.controls = true; return audio; }
  if (blob.type === "application/pdf" || blob.type.startsWith("text/") || blob.type.includes("json")) { const frame = document.createElement("iframe"); frame.src = url; frame.title = name; return frame; }
  const box = document.createElement("div"); box.className = "unsupported-preview";
  const title = document.createElement("b"); title.textContent = "PREVIEW NOT AVAILABLE";
  const text = document.createElement("p"); text.textContent = "The original file is retained intact and can be shared or downloaded.";
  const button = action("DOWNLOAD OBJECT", "primary-action", () => downloadBlob(blob, name));
  box.append(title, text, button); return box;
}

function action(label: string, className: string, listener: () => void): HTMLButtonElement {
  const button = document.createElement("button"); button.type = "button"; button.textContent = label; button.className = className; button.addEventListener("click", listener); return button;
}
function closePreviewUrl(): void { if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null; }
function downloadBlob(blob: Blob, name: string): void { const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
function formatBytes(bytes: number): string { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`; if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(2)} MiB`; return `${(bytes / 1024 ** 3).toFixed(2)} GiB`; }
function escapeHtml(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
function byId<T extends HTMLElement>(id: string): T { const element = document.getElementById(id); if (!element) throw new Error(`Missing required element: ${id}`); return element as T; }
