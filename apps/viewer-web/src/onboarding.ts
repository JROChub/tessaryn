/**
 * TESSARYN first-run tour.
 *
 * Three steps, anchored to the real interface. Runs once, on first visit
 * only (`tessaryn-tour-seen` in localStorage), and never auto-replays.
 * The "?" button in the topbar reopens it at any time, as does the
 * glossary panel's "Replay the first-run tour" button.
 */

export interface OnboardingStep {
  /** CSS selector for the anchor element. A hidden anchor is waited for, briefly, never skipped. */
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

/**
 * Retries for an anchor that is not visible yet, such as the Construct
 * button, which stays `display: none` until boot sets the reference
 * source. A step is never silently skipped: while its anchor is missing
 * the tour waits, and if the anchor never appears the tour closes
 * without marking itself seen, so it can try again on the next visit.
 */
const RETRY_DELAY_MS = 150;
const MAX_RETRIES = 20;
let session = 0;
let pendingIndex = -1;
/** Increments on every rendered step, so a pending retry never jumps the user after they navigate elsewhere. */
let renderToken = 0;
/**
 * Present on `documentElement` while the tour is open. The theater keeps
 * its Moments tray hidden until a Moment exists; this class reveals it
 * for the tour, so the Moments and Seal steps always have an anchor.
 */
const TOUR_OPEN_CLASS = "tessaryn-tour-open";

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

function showStep(index: number, attempt = 0): void {
  if (index >= steps.length) {
    closeTour(true);
    return;
  }
  if (index < 0) index = 0;
  if (pendingIndex === index) return;
  const step = steps[index];
  if (!step) {
    closeTour(false);
    return;
  }
  const anchor = visibleAnchor(step);
  if (!anchor) {
    if (attempt < MAX_RETRIES) {
      pendingIndex = index;
      const token = session;
      const rendered = renderToken;
      window.setTimeout(() => {
        pendingIndex = -1;
        if (token !== session || rendered !== renderToken || !card || card.hidden) return;
        showStep(index, attempt + 1);
      }, RETRY_DELAY_MS);
      return;
    }
    closeTour(false);
    return;
  }
  if (!card || !titleEl || !bodyEl || !stepEl || !nextButton || !prevButton) return;
  current = index;
  renderToken += 1;
  titleEl.textContent = step.title;
  bodyEl.textContent = step.body;
  stepEl.textContent = `${String(current + 1)} / ${String(steps.length)}`;
  prevButton.disabled = current === 0;
  nextButton.textContent = current === steps.length - 1 ? "GOT IT" : "NEXT";
  card.hidden = false;
  card.focus({ preventScroll: true });
  positionCard(anchor);
}

function closeTour(seen: boolean): void {
  session += 1;
  pendingIndex = -1;
  document.documentElement.classList.remove(TOUR_OPEN_CLASS);
  if (card) card.hidden = true;
  current = -1;
  if (seen) markSeen();
}

export function openOnboarding(): void {
  if (steps.length === 0) return;
  session += 1;
  pendingIndex = -1;
  document.documentElement.classList.add(TOUR_OPEN_CLASS);
  showStep(0);
}

function buildCard(): HTMLElement {
  const section = document.createElement("section");
  section.id = "tessaryn-tour";
  section.className = "tessaryn-tour";
  section.setAttribute("role", "dialog");
  section.setAttribute("aria-label", "First-run tour");
  section.tabIndex = -1;
  section.hidden = true;
  const kicker = document.createElement("span");
  kicker.className = "tour-kicker";
  kicker.textContent = "FIRST RUN";
  const title = document.createElement("h2");
  title.textContent = "First-run tour";
  const body = document.createElement("p");
  const footer = document.createElement("footer");
  footer.setAttribute("role", "none");
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
