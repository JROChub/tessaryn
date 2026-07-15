const REJECT_POSE = 1 << 0;
const REJECT_TRACKING = 1 << 1;
const REJECT_PARALLAX = 1 << 2;
const REJECT_REPROJECTION = 1 << 3;
const REJECT_GEOMETRY = 1 << 4;
const REJECT_CONTINUITY = 1 << 5;
const REJECT_RECEIPT = 1 << 6;
const REJECT_DEGENERATE = 1 << 7;
const REJECT_SCALE = 1 << 8;

// Contract note: previous hard-stop copy was "AUTHORITY RECEIPT REJECTED";
// the UI now keeps the visual field alive while preserving the no-Moment/no-seal boundary.
type AuthorityStage = "forming" | "tracking" | "moment-ready" | "seal-ready";

interface RealitySnapshot {
  stage: AuthorityStage;
  mask: number;
  frameCount: number;
  formingSamples: number;
  surfels: number;
  geometryRevision: string;
  tracking: number;
  coverage: number;
  score: number;
  parallaxDegrees: number;
  poseErrorPixels: number | null;
  confirmed: number;
  uncertain: number;
  rejected: number;
  momentOpen: boolean;
  sealOpen: boolean;
  captureState: string;
}

interface CockpitElements {
  shell: HTMLElement;
  canvas: HTMLCanvasElement;
  stage: HTMLElement;
  score: HTMLElement;
  scoreFill: HTMLElement;
  motionFill: HTMLElement;
  evidenceFill: HTMLElement;
  lineageFill: HTMLElement;
  primary: HTMLElement;
  secondary: HTMLElement;
  ledger: HTMLElement;
  momentGate: HTMLElement;
  sealGate: HTMLElement;
}

const COCKPIT_STYLE_ID = "tessaryn-reality-cockpit-style";
const STAGE_LABELS: Record<AuthorityStage, string> = {
  forming: "FORMING FIELD",
  tracking: "TRACKING FIELD",
  "moment-ready": "MOMENT GATE",
  "seal-ready": "SEAL GATE",
};

function numericAttribute(root: HTMLElement, name: string): number {
  const value = Number(root.dataset[name]);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function text(id: string): string {
  return document.getElementById(id)?.textContent?.trim() ?? "";
}

function numberFromText(id: string): number {
  const match = text(id).replaceAll(",", "").match(/-?\d+(?:\.\d+)?/u);
  return match ? Number(match[0]) : 0;
}

function percentageFromText(id: string): number {
  return Math.max(0, Math.min(1, numberFromText(id) / 100));
}

function widthRatio(id: string): number {
  const element = document.getElementById(id) as HTMLElement | null;
  if (!element) return 0;
  const raw = element.style.width || getComputedStyle(element).width;
  return raw.endsWith("%") ? Math.max(0, Math.min(1, Number(raw.slice(0, -1)) / 100)) : 0;
}

function authorityStage(root: HTMLElement): AuthorityStage {
  const stage = root.dataset.authorityStage;
  return stage === "tracking" || stage === "moment-ready" || stage === "seal-ready"
    ? stage
    : "forming";
}

function snapshot(root: HTMLElement): RealitySnapshot {
  const score = widthRatio("quality-meter");
  return {
    stage: authorityStage(root),
    mask: numericAttribute(root, "authorityRejectionMask"),
    frameCount: numberFromText("frame-count"),
    formingSamples: Number(root.dataset.formingSamples ?? 0) || 0,
    surfels: Number(root.dataset.authoritativeSurfels ?? 0) || numberFromText("surfel-count"),
    geometryRevision: root.dataset.geometryRevision ?? "0",
    tracking: percentageFromText("tracking-value"),
    coverage: percentageFromText("coverage-value"),
    score,
    parallaxDegrees: numberFromText("parallax-value"),
    poseErrorPixels: text("error-value") === "—" ? null : numberFromText("error-value"),
    confirmed: numberFromText("confirmed-value"),
    uncertain: numberFromText("uncertain-value"),
    rejected: numberFromText("rejected-value"),
    momentOpen: root.dataset.momentAllowed === "true",
    sealOpen: root.dataset.sealAllowed === "true",
    captureState: text("capture-state"),
  };
}

function installStyles(): void {
  if (document.getElementById(COCKPIT_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = COCKPIT_STYLE_ID;
  style.textContent = `
    .reality-cockpit{position:absolute;inset:0;pointer-events:none;z-index:6;color:#e8f8ff;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
    .reality-vector-field{position:absolute;inset:0;width:100%;height:100%;opacity:.76;mix-blend-mode:screen}
    .reality-authority-card{position:absolute;left:14px;bottom:16px;width:min(438px,calc(100% - 28px));padding:13px 14px;background:linear-gradient(180deg,rgba(4,9,16,.84),rgba(2,5,9,.72));border:1px solid rgba(98,216,255,.22);border-radius:8px;box-shadow:0 18px 60px rgba(0,0,0,.38);backdrop-filter:blur(18px)}
    .reality-authority-card header{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:0 0 10px}
    .reality-authority-card small{display:block;font:700 9px/1.2 ui-monospace,monospace;letter-spacing:.15em;color:#7a8da1;text-transform:uppercase}
    .reality-authority-card b{display:block;margin-top:4px;font:800 13px/1.12 ui-monospace,monospace;letter-spacing:.08em;color:#f2fcff;text-transform:uppercase}
    .reality-score{min-width:72px;text-align:right;color:#8ce9ff;font:800 18px/1 ui-monospace,monospace}
    .reality-meter{height:6px;background:rgba(96,118,143,.18);border-radius:999px;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,.05)}
    .reality-meter i{display:block;width:0;height:100%;background:linear-gradient(90deg,#c76650,#d7bb68,#7de6ff);transition:width .18s ease}
    .reality-axis{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin:9px 0}
    .reality-axis span{padding:8px;background:rgba(7,15,24,.62);border:1px solid rgba(255,255,255,.06);border-radius:5px}
    .reality-axis em{display:block;margin-bottom:6px;color:#72879c;font:700 8px/1 ui-monospace,monospace;letter-spacing:.13em;text-transform:uppercase;font-style:normal}
    .reality-axis i{display:block;height:4px;background:rgba(83,102,120,.2);border-radius:999px;overflow:hidden}
    .reality-axis i::before{content:"";display:block;width:var(--value,0%);height:100%;background:linear-gradient(90deg,#63d5ff,#d8c06c);transition:width .18s ease}
    .reality-instruction{margin:0;color:#cbe1ef;font:600 12px/1.45 ui-sans-serif,system-ui,sans-serif}
    .reality-instruction strong{display:block;color:#fff;font:800 12px/1.25 ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;margin-bottom:4px}
    .reality-ledger{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-top:9px;color:#9ab0c2;font:700 9px/1.2 ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase}
    .reality-ledger span{padding:7px 8px;border-radius:4px;background:rgba(6,12,19,.56);border:1px solid rgba(255,255,255,.05)}
    .reality-ledger b{display:block;margin-top:3px;color:#e6f9ff;font-size:10px;letter-spacing:0;text-transform:none}
    .reality-gates{position:absolute;right:16px;bottom:18px;display:grid;gap:8px;width:160px}
    .reality-gate{padding:9px 10px;border-radius:7px;background:rgba(3,8,13,.74);border:1px solid rgba(255,255,255,.08);backdrop-filter:blur(14px);text-align:center;box-shadow:0 14px 40px rgba(0,0,0,.26)}
    .reality-gate small{display:block;color:#70869a;font:800 8px/1 ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase}
    .reality-gate b{display:block;margin-top:5px;color:#d5e5ef;font:900 13px/1 ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase}
    .reality-gate[data-open="true"]{border-color:rgba(115,238,255,.45);box-shadow:0 0 30px rgba(98,216,255,.18),inset 0 0 0 1px rgba(115,238,255,.16)}
    .reality-gate[data-open="true"] b{color:#8df2ff}
    @media(max-width:760px){.reality-authority-card{left:8px;right:8px;bottom:10px;width:auto}.reality-gates{right:10px;top:80px;bottom:auto;width:124px}.reality-axis{grid-template-columns:1fr}.reality-ledger{grid-template-columns:1fr}}
  `;
  document.head.append(style);
}

function buildCockpit(stagePanel: HTMLElement): CockpitElements {
  stagePanel.querySelector<HTMLElement>(".reality-cockpit")?.remove();
  const shell = document.createElement("div");
  shell.className = "reality-cockpit";
  shell.setAttribute("aria-label", "Measurement-driven Reality Cockpit");
  shell.innerHTML = `
    <canvas class="reality-vector-field" aria-hidden="true"></canvas>
    <section class="reality-authority-card" aria-live="polite">
      <header><span><small>REALITY COCKPIT</small><b data-role="stage">FORMING FIELD</b></span><output class="reality-score" data-role="score">0%</output></header>
      <div class="reality-meter"><i data-role="score-fill"></i></div>
      <div class="reality-axis">
        <span><em>MOTION</em><i data-role="motion-fill"></i></span>
        <span><em>EVIDENCE</em><i data-role="evidence-fill"></i></span>
        <span><em>LINEAGE</em><i data-role="lineage-fill"></i></span>
      </div>
      <p class="reality-instruction"><strong data-role="primary">AWAITING VERIFIED AUTHORITY</strong><span data-role="secondary">The cockpit will show the exact gate blocking capture once Keyxym begins measuring frames.</span></p>
      <div class="reality-ledger" data-role="ledger"></div>
    </section>
    <div class="reality-gates">
      <span class="reality-gate" data-role="moment-gate" data-open="false"><small>Moment</small><b>LOCKED</b></span>
      <span class="reality-gate" data-role="seal-gate" data-open="false"><small>Seal</small><b>LOCKED</b></span>
    </div>
  `;
  stagePanel.append(shell);
  return {
    shell,
    canvas: shell.querySelector<HTMLCanvasElement>("canvas")!,
    stage: shell.querySelector<HTMLElement>('[data-role="stage"]')!,
    score: shell.querySelector<HTMLElement>('[data-role="score"]')!,
    scoreFill: shell.querySelector<HTMLElement>('[data-role="score-fill"]')!,
    motionFill: shell.querySelector<HTMLElement>('[data-role="motion-fill"]')!,
    evidenceFill: shell.querySelector<HTMLElement>('[data-role="evidence-fill"]')!,
    lineageFill: shell.querySelector<HTMLElement>('[data-role="lineage-fill"]')!,
    primary: shell.querySelector<HTMLElement>('[data-role="primary"]')!,
    secondary: shell.querySelector<HTMLElement>('[data-role="secondary"]')!,
    ledger: shell.querySelector<HTMLElement>('[data-role="ledger"]')!,
    momentGate: shell.querySelector<HTMLElement>('[data-role="moment-gate"]')!,
    sealGate: shell.querySelector<HTMLElement>('[data-role="seal-gate"]')!,
  };
}

function instruction(mask: number, establishedTracking: boolean): { title: string; detail: string } {
  if (mask & REJECT_RECEIPT) {
    return {
      title: "AUTHORITY SYNCING",
      detail: "The visual field stays live while Keyxym rebuilds a valid receipt chain. Keep scanning slowly; no Moment or seal opens until native receipts validate.",
    };
  }
  if (mask & REJECT_REPROJECTION) {
    return {
      title: "REDUCE MOTION BLUR",
      detail: "Move more slowly, keep textured edges sharp, and maintain the same objects in view until reprojection returns below the authority limit.",
    };
  }
  if (mask & (REJECT_POSE | REJECT_TRACKING | REJECT_PARALLAX | REJECT_DEGENERATE)) {
    return {
      title: establishedTracking ? "REACQUIRE TRACKING" : "CREATE 3D PARALLAX",
      detail: "Move slowly sideways around textured objects at different depths. Keep them in view; avoid flat walls, digital screens, blur, and repeating patterns.",
    };
  }
  if (mask & (REJECT_GEOMETRY | REJECT_CONTINUITY)) {
    return {
      title: "BUILD VERIFIED GEOMETRY",
      detail: "Continue a slow arc, then revisit the same surfaces so Keyxym can confirm them across frames before enabling a Moment.",
    };
  }
  if (mask & REJECT_SCALE) {
    return {
      title: "METRIC SCALE UNBOUND",
      detail: "Relative World Cells can form now. Metric authority requires a verified depth, event, or calibration adapter receipt before scale can be sealed.",
    };
  }
  return {
    title: "AUTHORITY FIELD STABLE",
    detail: "Keep the same textured geometry in view. When the native gate opens, commit the Moment before changing viewpoint.",
  };
}

function updateStageMessage(
  root: HTMLElement,
  stage: HTMLElement,
  heading: HTMLElement,
  detail: HTMLElement,
  capture: HTMLElement,
  establishedTracking: boolean,
): void {
  if (root.dataset.keyxymAuthority !== "verified") return;
  const currentStage = authorityStage(root);
  if (currentStage !== "forming") return;
  if ((capture.textContent ?? "").trim() === "READY") return;
  const next = instruction(numericAttribute(root, "authorityRejectionMask"), establishedTracking);
  heading.textContent = next.title;
  detail.textContent = next.detail;
  stage.style.display = "";
}

function setBar(element: HTMLElement, ratio: number): void {
  element.style.setProperty("--value", `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`);
}

function ledgerItem(label: string, value: string): HTMLElement {
  const item = document.createElement("span");
  const strong = document.createElement("b");
  strong.textContent = value;
  item.append(document.createTextNode(label), strong);
  return item;
}

function renderCockpit(cockpit: CockpitElements, state: RealitySnapshot, establishedTracking: boolean): void {
  const next = instruction(state.mask, establishedTracking);
  const motion = Math.max(state.tracking, Math.min(1, state.parallaxDegrees / 1.2));
  const evidence = Math.max(state.coverage, Math.min(1, state.confirmed / 256));
  const lineage = state.sealOpen ? 1 : state.momentOpen ? 0.68 : state.geometryRevision !== "0" ? 0.34 : 0;
  cockpit.stage.textContent = STAGE_LABELS[state.stage];
  cockpit.score.textContent = `${Math.round(state.score * 100)}%`;
  cockpit.scoreFill.style.width = `${Math.round(state.score * 100)}%`;
  setBar(cockpit.motionFill, motion);
  setBar(cockpit.evidenceFill, evidence);
  setBar(cockpit.lineageFill, lineage);
  cockpit.primary.textContent = state.momentOpen ? "COMMIT AUTHORIZED MOMENT" : next.title;
  cockpit.secondary.textContent = state.momentOpen
    ? "The native v0.26 gate currently allows a Moment. Commit now, then keep scanning until Seal opens."
    : next.detail;
  cockpit.momentGate.dataset.open = String(state.momentOpen);
  cockpit.momentGate.querySelector("b")!.textContent = state.momentOpen ? "OPEN" : "LOCKED";
  cockpit.sealGate.dataset.open = String(state.sealOpen);
  cockpit.sealGate.querySelector("b")!.textContent = state.sealOpen ? "OPEN" : "LOCKED";
  cockpit.ledger.replaceChildren(
    ledgerItem("Frames", String(state.frameCount)),
    ledgerItem("Forming", state.formingSamples.toLocaleString()),
    ledgerItem("Confirmed", state.confirmed.toLocaleString()),
    ledgerItem("Revision", state.geometryRevision),
    ledgerItem("Parallax", `${state.parallaxDegrees.toFixed(2)}°`),
    ledgerItem("Pose error", state.poseErrorPixels === null ? "—" : `${state.poseErrorPixels.toFixed(2)} px`),
  );
}

function drawField(canvas: HTMLCanvasElement, state: RealitySnapshot, timeMs: number): void {
  const bounds = canvas.getBoundingClientRect();
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.floor(bounds.width * ratio));
  const height = Math.max(1, Math.floor(bounds.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, width, height);
  context.save();
  context.scale(ratio, ratio);
  const w = width / ratio;
  const h = height / ratio;
  const cx = w * 0.5;
  const cy = h * 0.50;
  const pulse = timeMs * 0.0012;
  const authority = Math.max(0.06, state.score);
  const parallax = Math.min(1, state.parallaxDegrees / 2);
  const coverage = Math.max(state.coverage, Math.min(1, state.surfels / 2048));

  context.globalAlpha = 0.26;
  context.strokeStyle = "rgba(104,214,255,.24)";
  context.lineWidth = 1;
  for (let radius = 72; radius < Math.max(w, h) * 0.65; radius += 74) {
    context.beginPath();
    context.arc(cx, cy, radius + Math.sin(pulse + radius * 0.01) * 5 * authority, 0, Math.PI * 2);
    context.stroke();
  }

  const rays = Math.max(24, Math.min(128, Math.round(24 + state.formingSamples / 80 + state.confirmed / 16)));
  for (let index = 0; index < rays; index += 1) {
    const angle = (index / rays) * Math.PI * 2 + pulse * (0.16 + authority * 0.24);
    const radius = 92 + ((index * 47) % 260) + Math.sin(pulse * 1.7 + index) * 26 * (0.25 + parallax);
    const bend = Math.sin(angle * 3 + pulse) * 28 * parallax;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius * 0.62;
    context.globalAlpha = 0.06 + authority * 0.20 + coverage * 0.10;
    context.strokeStyle = state.momentOpen ? "rgba(132,244,255,.55)" : "rgba(226,191,102,.40)";
    context.beginPath();
    context.moveTo(cx + Math.cos(angle + Math.PI) * 18, cy + Math.sin(angle + Math.PI) * 12);
    context.quadraticCurveTo(cx + Math.cos(angle + Math.PI / 2) * bend, cy + Math.sin(angle + Math.PI / 2) * bend, x, y);
    context.stroke();
  }

  context.globalAlpha = 0.80;
  context.lineWidth = 2;
  context.strokeStyle = state.sealOpen ? "rgba(154,255,232,.85)" : state.momentOpen ? "rgba(112,229,255,.78)" : "rgba(211,180,101,.66)";
  context.beginPath();
  context.arc(cx, cy, 52 + authority * 36, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.04, authority));
  context.stroke();

  context.globalAlpha = 0.66;
  context.fillStyle = state.stage === "forming" ? "rgba(216,184,104,.58)" : "rgba(112,229,255,.72)";
  const arrow = -Math.PI / 2 + Math.min(1, state.parallaxDegrees / 1.5) * Math.PI * 1.2;
  context.beginPath();
  context.moveTo(cx + Math.cos(arrow) * 24, cy + Math.sin(arrow) * 24);
  context.lineTo(cx + Math.cos(arrow - 0.18) * 82, cy + Math.sin(arrow - 0.18) * 82);
  context.lineTo(cx + Math.cos(arrow + 0.18) * 82, cy + Math.sin(arrow + 0.18) * 82);
  context.closePath();
  context.fill();
  context.restore();
}

export function installWorldCellGuidance(): () => void {
  const root = document.documentElement;
  const stage = document.getElementById("stage-message");
  const heading = stage?.querySelector("b") ?? null;
  const detail = stage?.querySelector("span") ?? null;
  const capture = document.getElementById("capture-state");
  const stagePanel = document.querySelector<HTMLElement>(".stage-panel");
  if (!stage || !heading || !detail || !capture || !stagePanel) return () => undefined;

  stage.setAttribute("aria-live", "polite");
  installStyles();
  const cockpit = buildCockpit(stagePanel);
  let establishedTracking = false;
  let animation = 0;
  let latest = snapshot(root);

  const update = () => {
    if (root.dataset.keyxymAuthority !== "verified") return;
    latest = snapshot(root);
    if (latest.stage !== "forming") establishedTracking = true;
    updateStageMessage(root, stage, heading, detail, capture, establishedTracking);
    renderCockpit(cockpit, latest, establishedTracking);
  };

  const tick = (timeMs: number) => {
    latest = snapshot(root);
    drawField(cockpit.canvas, latest, timeMs);
    animation = requestAnimationFrame(tick);
  };

  const rootObserver = new MutationObserver(update);
  rootObserver.observe(root, {
    attributes: true,
    attributeFilter: [
      "data-keyxym-authority",
      "data-authority-stage",
      "data-authority-rejection-mask",
      "data-forming-samples",
      "data-authoritative-surfels",
      "data-geometry-revision",
      "data-moment-allowed",
      "data-seal-allowed",
    ],
  });
  const observer = new MutationObserver(update);
  for (const target of [
    capture,
    ...[
      "frame-count", "tracking-value", "parallax-value", "error-value", "coverage-value",
      "confirmed-value", "uncertain-value", "rejected-value", "quality-meter",
    ].map((id) => document.getElementById(id)).filter((item): item is HTMLElement => item instanceof HTMLElement),
  ]) {
    observer.observe(target, { childList: true, characterData: true, attributes: true, subtree: true });
  }
  update();
  animation = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(animation);
    rootObserver.disconnect();
    observer.disconnect();
    cockpit.shell.remove();
  };
}
