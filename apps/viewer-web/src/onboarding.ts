/**
 * TESSARYN first-run tour (P0, Website Design Awards 10/10).
 *
 * Three steps, anchored to the real interface. Runs once, on first visit
 * only (`tessaryn-tour-seen` in localStorage), and never auto-replays.
 * The "?" button in the topbar reopens it at any time, as does the
 * glossary panel's "Replay the first-run tour" button.
 */

export interface OnboardingStep {
  /** CSS selector for the anchor element. Hidden anchors are skipped. */
  anchor: string;
  title: string;
  body: string;
}

const SEEN_KEY = "tessaryn-tour-seen";

let installed = false;
let steps: OnboardingStep[] = [];
let card: HTMLElement | null = null;
let titleEl: HTMLElement | null = null;
let bodyEl: HTMLElement | null = null;
let stepEl: HTMLElement | null = null;
let prevButton: HTMLButtonElement | null = null;
let nextButton: HTMLButtonElement | null = null;
let current = -1;

function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Private mode or blocked storage: the tour simply may show again.
  }
}

function hasSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function visibleAnchor(step: OnboardingStep): HTMLElement | null {
  const element = document.querySelector<HTMLElement>(step.anchor);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  if (getComputedStyle(element).display === "none") return null;
  return element;
}

function positionCard(anchor: HTMLElement): void {
  if (!card) return;
  if (window.innerWidth <= 760) {
    // Docked bottom sheet on small screens; CSS owns the position.
    card.style.top = "";
    card.style.left = "";
    return;
  }
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(360, window.innerWidth - 24);
  const height = card.offsetHeight || 220;
  let top = rect.bottom + 10;
  if (top + height > window.innerHeight - 12) {
    top = Math.max(12, rect.top - height - 10);
  }
  let left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12);
  if (left < 12) left = 12;
  card.style.top = `${String(Math.round(top))}px`;
  card.style.left = `${String(Math.round(left))}px`;
}

function showStep(index: number): void {
  // Skip anchors that are not on screen (e.g. an empty Moment tray).
  let next = index;
  let anchor: HTMLElement | null = null;
  while (next < steps.length) {
    const step = steps[next];
    if (!step) break;
    anchor = visibleAnchor(step);
    if (anchor) break;
    next += 1;
  }
  if (!anchor || next >= steps.length) {
    closeTour(true);
    return;
  }
  const step = steps[next];
  if (!step || !card || !titleEl || !bodyEl || !stepEl || !nextButton || !prevButton) return;
  current = next;
  titleEl.textContent = step.title;
  bodyEl.textContent = step.body;
  stepEl.textContent = `${String(current + 1)} / ${String(steps.length)}`;
  prevButton.disabled = current === 0;
  nextButton.textContent = current === steps.length - 1 ? "GOT IT" : "NEXT";
  card.hidden = false;
  positionCard(anchor);
}

function closeTour(seen: boolean): void {
  if (card) card.hidden = true;
  current = -1;
  if (seen) markSeen();
}

export function openOnboarding(): void {
  if (steps.length === 0) return;
  showStep(0);
}

function buildCard(): HTMLElement {
  const section = document.createElement("section");
  section.id = "tessaryn-tour";
  section.className = "tessaryn-tour";
  section.setAttribute("role", "dialog");
  section.setAttribute("aria-label", "First-run tour");
  section.hidden = true;
  const kicker = document.createElement("span");
  kicker.className = "tour-kicker";
  kicker.textContent = "FIRST RUN";
  const title = document.createElement("h2");
  const body = document.createElement("p");
  const footer = document.createElement("footer");
  const step = document.createElement("span");
  step.className = "tour-step";
  const prev = document.createElement("button");
  prev.type = "button";
  prev.textContent = "BACK";
  prev.addEventListener("click", () => showStep(current - 1));
  const next = document.createElement("button");
  next.type = "button";
  next.className = "tour-next";
  next.textContent = "NEXT";
  next.addEventListener("click", () => {
    if (current >= steps.length - 1) {
      closeTour(true);
    } else {
      showStep(current + 1);
    }
  });
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.textContent = "SKIP";
  dismiss.addEventListener("click", () => closeTour(true));
  footer.append(step, prev, next, dismiss);
  const glossaryLink = document.createElement("button");
  glossaryLink.type = "button";
  glossaryLink.className = "tour-glossary";
  glossaryLink.textContent = "What do these words mean? Open the glossary.";
  glossaryLink.addEventListener("click", () => {
    document.dispatchEvent(new CustomEvent("tessaryn:open-glossary"));
  });
  section.append(kicker, title, body, footer, glossaryLink);
  titleEl = title;
  bodyEl = body;
  stepEl = step;
  prevButton = prev;
  nextButton = next;
  return section;
}

/** Install the tour for this entry. Idempotent; auto-starts on first visit only. */
export function installOnboarding(nextSteps: OnboardingStep[]): void {
  steps = nextSteps;
  if (installed) {
    if (!hasSeen()) {
      window.setTimeout(() => openOnboarding(), 800);
    }
    return;
  }
  installed = true;
  card = buildCard();
  document.body.append(card);
  document.addEventListener("tessaryn:open-tour", () => openOnboarding());
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && card && !card.hidden) closeTour(true);
  });
  window.addEventListener("resize", () => {
    if (card && !card.hidden && current >= 0) {
      const step = steps[current];
      const anchor = step ? visibleAnchor(step) : null;
      if (anchor) positionCard(anchor);
    }
  });
  if (!hasSeen()) {
    window.setTimeout(() => openOnboarding(), 800);
  }
}
