import "./glossary.css";

/**
 * TESSARYN glossary and hash labels.
 *
 * Twelve terms, each defined in one short line, surfaced exactly where the
 * term first appears via `data-glossary-term` + `aria-describedby`.
 * Definitions are also available in full from the "?" button in the topbar.
 */

export type GlossaryTermId =
  | "world-cell"
  | "moment"
  | "rootprint"
  | "pha"
  | "slbit"
  | "locus"
  | "chronofold"
  | "keyxym"
  | "seal"
  | "eform"
  | "digest"
  | "provenance";

export interface GlossaryEntry {
  term: string;
  definition: string;
}

export const GLOSSARY: Record<GlossaryTermId, GlossaryEntry> = {
  "world-cell": {
    term: "World Cell",
    definition:
      "A portable, verifiable record of one bounded place: its geometry, its time, and the proof that ties them together.",
  },
  moment: {
    term: "Moment",
    definition:
      "A saved state of a World Cell along its trajectory, one you can return to and replay.",
  },
  rootprint: {
    term: "Rootprint",
    definition:
      "The fingerprint of a World Cell's origin branch: proof of where a place came from and that it has not changed.",
  },
  pha: {
    term: "PHA",
    definition:
      "The Power House fingerprint that binds a Cell's geometry to its identity and its replay.",
  },
  slbit: {
    term: "SLBIT",
    definition:
      "Living meaning: the summary that reorganizes around a Cell as focus and time change.",
  },
  locus: {
    term: "Locus",
    definition:
      "A dataset profile used to validate a reconstruction against known geometry.",
  },
  chronofold: {
    term: "Chronofold",
    definition:
      "A view that folds time across a Cell's Moments, showing saved states separated by phase.",
  },
  keyxym: {
    term: "Keyxym",
    definition:
      "The reconstruction runtime that turns camera frames into measured geometry.",
  },
  seal: {
    term: "Seal",
    definition:
      "A signed lock on a World Cell that makes it transferable as authoritative, verified geometry.",
  },
  eform: {
    term: "Eform",
    definition:
      "The assurance form a World Cell needs before it can be sealed and transferred to another device.",
  },
  digest: {
    term: "Digest / SHA-256",
    definition:
      "A SHA-256 fingerprint computed from bytes. Change one byte and the code changes.",
  },
  provenance: {
    term: "Provenance",
    definition:
      "The recorded lineage of a place: every source, check, and receipt that proves how it was built.",
  },
};

const GLOSSARY_IDS = Object.keys(GLOSSARY) as GlossaryTermId[];

/** First 12 + last 6 characters of a hash, e.g. `9f2c…a41b09`. */
export function formatShortHash(value: string): string {
  if (value.length <= 19) return value;
  return `${value.slice(0, 12)}...${value.slice(-6)}`;
}

/**
 * Render a hash as its short form with the full value available on tap:
 * hover shows the full hash, click / Enter copies it. The full value is
 * read back from `dataset` at copy time, so re-binding never goes stale.
 */
export function bindHashCopy(element: HTMLElement, fullValue: string): void {
  element.textContent = formatShortHash(fullValue);
  element.title = fullValue;
  element.dataset.fullHash = fullValue;
  element.tabIndex = 0;
  element.setAttribute("role", "button");
  element.setAttribute("aria-label", `Copy full hash ${fullValue}`);
  element.classList.add("hash-copy");
  if (element.dataset.hashCopyBound === "true") return;
  element.dataset.hashCopyBound = "true";
  const copy = (): void => {
    const value = element.dataset.fullHash ?? "";
    if (!value) return;
    const done = (): void => {
      element.classList.add("copied");
      window.setTimeout(() => element.classList.remove("copied"), 1200);
    };
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(value).then(done, done);
    } else {
      done();
    }
  };
  element.addEventListener("click", copy);
  element.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      copy();
    }
  });
}

let installed = false;
let tooltip: HTMLDivElement | null = null;
let tooltipTerm: HTMLElement | null = null;
let panel: HTMLElement | null = null;
let lastFocused: HTMLElement | null = null;

function entryFor(element: HTMLElement): GlossaryEntry | null {
  const id = element.dataset.glossaryTerm as GlossaryTermId | undefined;
  if (!id) return null;
  return GLOSSARY[id] ?? null;
}

function positionTooltip(anchor: HTMLElement): void {
  if (!tooltip) return;
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(300, window.innerWidth - 24);
  const height = tooltip.offsetHeight || 96;
  let top = rect.bottom + 10;
  if (top + height > window.innerHeight - 12) {
    top = Math.max(12, rect.top - height - 10);
  }
  let left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12);
  if (left < 12) left = 12;
  tooltip.style.top = `${String(Math.round(top))}px`;
  tooltip.style.left = `${String(Math.round(left))}px`;
  tooltip.style.width = `${String(Math.round(width))}px`;
}

function showTooltip(anchor: HTMLElement): void {
  const entry = entryFor(anchor);
  if (!tooltip || !entry) return;
  if (tooltipTerm && tooltipTerm !== anchor) {
    tooltipTerm.removeAttribute("aria-describedby");
  }
  tooltip.innerHTML = "";
  const term = document.createElement("b");
  term.textContent = entry.term;
  const definition = document.createElement("span");
  definition.textContent = entry.definition;
  tooltip.append(term, definition);
  anchor.setAttribute("aria-describedby", "tessaryn-tooltip");
  tooltip.hidden = false;
  tooltipTerm = anchor;
  positionTooltip(anchor);
}

function hideTooltip(): void {
  if (!tooltip) return;
  if (tooltipTerm) {
    tooltipTerm.removeAttribute("aria-describedby");
  }
  tooltip.hidden = true;
  tooltipTerm = null;
}

function triggerFromEvent(event: Event): HTMLElement | null {
  const target = event.target as HTMLElement | null;
  return target?.closest?.("[data-glossary-term]") ?? null;
}

export function openGlossary(): void {
  if (!panel) return;
  const active = document.activeElement;
  if (active instanceof HTMLElement && !panel.contains(active)) {
    lastFocused = active;
  }
  panel.hidden = false;
  const close = panel.querySelector<HTMLButtonElement>("[data-glossary-close]");
  close?.focus();
}

export function closeGlossary(): void {
  if (!panel) return;
  panel.hidden = true;
  if (lastFocused && document.contains(lastFocused)) {
    lastFocused.focus({ preventScroll: true });
  }
  lastFocused = null;
}

function buildPanel(): HTMLElement {
  const section = document.createElement("section");
  section.id = "tessaryn-glossary";
  section.className = "tessaryn-glossary";
  section.setAttribute("role", "dialog");
  section.setAttribute("aria-label", "TESSARYN glossary");
  section.hidden = true;
  const header = document.createElement("header");
  const title = document.createElement("h2");
  title.textContent = "GLOSSARY";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "icon-button";
  close.setAttribute("data-glossary-close", "");
  close.setAttribute("aria-label", "Close glossary");
  close.textContent = "×";
  close.addEventListener("click", closeGlossary);
  header.append(title, close);
  const list = document.createElement("dl");
  for (const id of GLOSSARY_IDS) {
    const entry = GLOSSARY[id];
    const term = document.createElement("dt");
    term.textContent = entry.term;
    const definition = document.createElement("dd");
    definition.textContent = entry.definition;
    list.append(term, definition);
  }
  const footer = document.createElement("footer");
  const tourButton = document.createElement("button");
  tourButton.type = "button";
  tourButton.className = "icon-command secondary";
  tourButton.textContent = "REPLAY THE FIRST-RUN TOUR";
  tourButton.addEventListener("click", () => {
    closeGlossary();
    document.dispatchEvent(new CustomEvent("tessaryn:open-tour"));
  });
  footer.append(tourButton);
  section.append(header, list, footer);
  return section;
}

/** Wire tooltips, the glossary panel, and the "?" help button. Idempotent. */
export function installGlossary(): void {
  if (installed) return;
  installed = true;
  tooltip = document.createElement("div");
  tooltip.id = "tessaryn-tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.hidden = true;
  document.body.append(tooltip);
  panel = buildPanel();
  document.body.append(panel);

  document.addEventListener("mouseover", (event) => {
    const trigger = triggerFromEvent(event);
    if (trigger) showTooltip(trigger);
  });
  document.addEventListener("mouseout", (event) => {
    const trigger = triggerFromEvent(event);
    if (!trigger || trigger !== tooltipTerm) return;
    const next = (event as MouseEvent).relatedTarget as Node | null;
    if (next && trigger.contains(next)) return;
    hideTooltip();
  });
  document.addEventListener("focusin", (event) => {
    const trigger = triggerFromEvent(event);
    if (trigger) showTooltip(trigger);
  });
  document.addEventListener("focusout", (event) => {
    const trigger = triggerFromEvent(event);
    if (!trigger || trigger !== tooltipTerm) return;
    const next = (event as FocusEvent).relatedTarget as Node | null;
    if (next && trigger.contains(next)) return;
    hideTooltip();
  });
  // Touch / keyboard: tap shows the definition when hover cannot.
  document.addEventListener("click", (event) => {
    const trigger = triggerFromEvent(event);
    if (trigger) {
      if (tooltipTerm !== trigger) showTooltip(trigger);
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest?.("#tessaryn-tooltip, #tessaryn-glossary")) return;
    hideTooltip();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideTooltip();
      closeGlossary();
    }
  });
  document.addEventListener("tessaryn:open-glossary", () => openGlossary());
  window.addEventListener("resize", () => {
    if (tooltipTerm) positionTooltip(tooltipTerm);
  });

  const help = document.getElementById("help-button");
  if (help instanceof HTMLButtonElement) {
    help.addEventListener("click", openGlossary);
  }
}
