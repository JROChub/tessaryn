import "./keyxym-mobile.css";
import {
  clearPersonalWeave as clearDeviceFiles,
  deletePersonalObject,
  getPersonalBlob,
  listPersonalObjects,
  storageEstimate,
  type StoredObject,
} from "./keyxym-personal-store";
import {
  listPersonalWeave as listConstructions,
  personalWeaveFile,
  removePersonalObject as removeConstruction,
  type PersonalWeaveObject,
} from "./weave-client";
import { stageOriginFile } from "./origin-handoff";

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
let constructions: PersonalWeaveObject[] = [];
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
  [objects, constructions] = await Promise.all([listPersonalObjects(), listConstructions()]);
  elements.count.textContent = String(objects.length + constructions.length);
  elements.bytes.textContent = formatBytes(
    objects.reduce((sum, object) => sum + object.bytes, 0) +
    constructions.reduce((sum, object) => sum + object.bytes, 0),
  );
  const estimate = await storageEstimate();
  elements.quota.textContent = estimate.quota > 0
    ? `${formatBytes(estimate.usage)} / ${formatBytes(estimate.quota)} (${estimate.percent.toFixed(1)}%)`
    : "UNAVAILABLE";
  elements.clear.disabled = objects.length + constructions.length === 0;
  render();
}

function render(): void {
  const query = elements.search.value.trim().toLowerCase();
  const visible = objects.filter((object) => !query || object.name.toLowerCase().includes(query) || object.id.includes(query));
  const visibleConstructions = constructions.filter((object) => !query ||
    [object.title, object.objectId, object.artifactSha256, object.summary].join(" ").toLowerCase().includes(query));
  elements.list.replaceChildren();
  if (visible.length === 0 && visibleConstructions.length === 0) {
    const empty = document.createElement("article");
    empty.className = "weave-empty";
    empty.innerHTML = `<b>NO PERSONAL OBJECTS</b><p>Capture a World Cell or retain a source file on this device.</p><a href="./world-cell-theater.html">CAPTURE WORLD CELL</a>`;
    elements.list.append(empty);
    return;
  }
  if (visibleConstructions.length > 0) {
    elements.list.append(sectionLabel("CONSTRUCTIONS / OPEN IN ORIGIN"));
    for (const object of visibleConstructions) elements.list.append(createConstructionCard(object));
  }
  if (visible.length > 0) elements.list.append(sectionLabel("SOURCE FILES / DEVICE-LOCAL"));
  for (const object of visible) elements.list.append(createCard(object));
}

function sectionLabel(value: string): HTMLElement {
  const label = document.createElement("h2");
  label.className = "weave-section-label";
  label.textContent = value;
  return label;
}

function createConstructionCard(object: PersonalWeaveObject): HTMLElement {
  const card = document.createElement("article");
  card.className = "weave-object construction-object";
  const heading = document.createElement("div");
  heading.className = "weave-object-heading";
  const title = document.createElement("span");
  const small = document.createElement("small"); small.textContent = new Date(object.addedAtUnixUs / 1_000).toLocaleString();
  const strong = document.createElement("b"); strong.textContent = object.title;
  title.append(small, strong);
  const digest = document.createElement("code"); digest.textContent = object.artifactSha256;
  heading.append(title, digest);
  const meta = document.createElement("dl");
  meta.innerHTML = `<div><dt>TYPE</dt><dd>${object.artifactKind === "rgbd_reconstruction" ? "VERIFIED PLACE" : "TEMPORAL OBJECT"}</dd></div><div><dt>SIZE</dt><dd>${formatBytes(object.bytes)}</dd></div><div><dt>STATE</dt><dd>${object.publicationId ? "PUBLIC + PRIVATE" : "PRIVATE"}</dd></div>`;
  const actions = document.createElement("div"); actions.className = "object-actions";
  actions.append(
    action("OPEN IN ORIGIN", "primary-action", () => void openConstruction(object)),
    action("DOWNLOAD", "", () => void downloadConstruction(object)),
    action("DELETE", "danger-action", () => void removeStoredConstruction(object)),
  );
  card.append(heading, meta, actions);
  return card;
}

async function openConstruction(object: PersonalWeaveObject): Promise<void> {
  const file = await personalWeaveFile(object);
  const id = await stageOriginFile(file);
  const origin = new URL("./", location.href);
  origin.searchParams.set("open-local", id);
  location.assign(origin);
}

async function downloadConstruction(object: PersonalWeaveObject): Promise<void> {
  const file = await personalWeaveFile(object);
  downloadBlob(file, file.name);
}

async function removeStoredConstruction(object: PersonalWeaveObject): Promise<void> {
  if (!window.confirm(`Delete ${object.title} from this device?`)) return;
  await removeConstruction(object);
  await reload();
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
  if (!window.confirm("Delete every Personal Weave construction, source file, metadata record, and transfer journal from this device?")) return;
  await Promise.all(constructions.map((object) => removeConstruction(object)));
  await clearDeviceFiles();
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
