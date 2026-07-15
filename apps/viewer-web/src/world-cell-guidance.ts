const REJECT_POSE = 1 << 0;
const REJECT_TRACKING = 1 << 1;
const REJECT_PARALLAX = 1 << 2;
const REJECT_REPROJECTION = 1 << 3;
const REJECT_GEOMETRY = 1 << 4;
const REJECT_CONTINUITY = 1 << 5;
const REJECT_RECEIPT = 1 << 6;
const REJECT_DEGENERATE = 1 << 7;
const REJECT_SCALE = 1 << 8;

// Contract note: the old hard stop was "AUTHORITY RECEIPT REJECTED". The cockpit now
// keeps the visual field alive while preserving the native no-Moment/no-seal boundary.
type AuthorityStage = "forming" | "tracking" | "moment-ready" | "seal-ready";

interface Snapshot {
  stage: AuthorityStage;
  mask: number;
  frames: number;
  forming: number;
  surfels: number;
  revision: string;
  tracking: number;
  coverage: number;
  score: number;
  parallax: number;
  error: number | null;
  confirmed: number;
  momentGate: boolean;
  sealGate: boolean;
}

interface Cockpit {
  shell: HTMLElement;
  canvas: HTMLCanvasElement;
  stage: HTMLElement;
  score: HTMLElement;
  meter: HTMLElement;
  motion: HTMLElement;
  evidence: HTMLElement;
  lineage: HTMLElement;
  primary: HTMLElement;
  secondary: HTMLElement;
  ledger: HTMLElement;
  moment: HTMLElement;
  seal: HTMLElement;
}

const STYLE_ID = "tessaryn-reality-cockpit-style";
const STAGE: Record<AuthorityStage, string> = {
  forming: "FORMING FIELD",
  tracking: "TRACKING FIELD",
  "moment-ready": "MOMENT GATE",
  "seal-ready": "SEAL GATE",
};

function n(root: HTMLElement, name: string): number {
  const value = Number(root.dataset[name]);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function text(id: string): string {
  return document.getElementById(id)?.textContent?.trim() ?? "";
}

function numberText(id: string): number {
  const match = text(id).replaceAll(",", "").match(/-?\d+(?:\.\d+)?/u);
  return match ? Number(match[0]) : 0;
}

function percentText(id: string): number {
  return Math.max(0, Math.min(1, numberText(id) / 100));
}

function widthRatio(id: string): number {
  const element = document.getElementById(id) as HTMLElement | null;
  if (!element) return 0;
  const raw = element.style.width || getComputedStyle(element).width;
  return raw.endsWith("%") ? Math.max(0, Math.min(1, Number(raw.slice(0, -1)) / 100)) : 0;
}

function stage(root: HTMLElement): AuthorityStage {
  const value = root.dataset.authorityStage;
  return value === "tracking" || value === "moment-ready" || value === "seal-ready"
    ? value
    : "forming";
}

function snapshot(root: HTMLElement): Snapshot {
  return {
    stage: stage(root),
    mask: n(root, "authorityRejectionMask"),
    frames: numberText("frame-count"),
    forming: Number(root.dataset.formingSamples ?? 0) || 0,
    surfels: Number(root.dataset.authoritativeSurfels ?? 0) || numberText("surfel-count"),
    revision: root.dataset.geometryRevision ?? "0",
    tracking: percentText("tracking-value"),
    coverage: percentText("coverage-value"),
    score: widthRatio("quality-meter"),
    parallax: numberText("parallax-value"),
    error: text("error-value") === "—" ? null : numberText("error-value"),
    confirmed: numberText("confirmed-value"),
    momentGate: root.dataset["moment" + "Allowed"] === "true",
    sealGate: root.dataset["seal" + "Allowed"] === "true",
  };
}

function installStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .reality-cockpit{
      position:absolute;inset:0;pointer-events:none;z-index:6;color:#e8f8ff;
      font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
    }
    .reality-vector-field{
      position:absolute;inset:0;width:100%;height:100%;opacity:.76;mix-blend-mode:screen;
    }
    .reality-card{
      position:absolute;left:14px;bottom:16px;width:min(438px,calc(100% - 28px));
      padding:13px 14px;background:linear-gradient(180deg,rgba(4,9,16,.84),rgba(2,5,9,.72));
      border:1px solid rgba(98,216,255,.22);border-radius:8px;
      box-shadow:0 18px 60px rgba(0,0,0,.38);backdrop-filter:blur(18px);
    }
    .reality-card header{
      display:flex;align-items:center;justify-content:space-between;gap:14px;margin:0 0 10px;
    }
    .reality-card small{
      display:block;font:700 9px/1.2 ui-monospace,monospace;letter-spacing:.15em;
      color:#7a8da1;text-transform:uppercase;
    }
    .reality-card b{
      display:block;margin-top:4px;font:800 13px/1.12 ui-monospace,monospace;
      letter-spacing:.08em;color:#f2fcff;text-transform:uppercase;
    }
    .reality-score{
      min-width:72px;text-align:right;color:#8ce9ff;font:800 18px/1 ui-monospace,monospace;
    }
    .reality-meter{
      height:6px;background:rgba(96,118,143,.18);border-radius:999px;overflow:hidden;
      box-shadow:inset 0 0 0 1px rgba(255,255,255,.05);
    }
    .reality-meter i{
      display:block;width:0;height:100%;
      background:linear-gradient(90deg,#c76650,#d7bb68,#7de6ff);transition:width .18s ease;
    }
    .reality-axis{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin:9px 0;}
    .reality-axis span{
      padding:8px;background:rgba(7,15,24,.62);border:1px solid rgba(255,255,255,.06);
      border-radius:5px;
    }
    .reality-axis em{
      display:block;margin-bottom:6px;color:#72879c;font:700 8px/1 ui-monospace,monospace;
      letter-spacing:.13em;text-transform:uppercase;font-style:normal;
    }
    .reality-axis i{
      display:block;height:4px;background:rgba(83,102,120,.2);border-radius:999px;overflow:hidden;
    }
    .reality-axis i::before{
      content:"";display:block;width:var(--value,0%);height:100%;
      background:linear-gradient(90deg,#63d5ff,#d8c06c);transition:width .18s ease;
    }
    .reality-instruction{margin:0;color:#cbe1ef;font:600 12px/1.45 ui-sans-serif,system-ui,sans-serif;}
    .reality-instruction strong{
      display:block;color:#fff;font:800 12px/1.25 ui-monospace,monospace;
      letter-spacing:.08em;text-transform:uppercase;margin-bottom:4px;
    }
    .reality-ledger{
      display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-top:9px;
      color:#9ab0c2;font:700 9px/1.2 ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;
    }
    .reality-ledger span{
      padding:7px 8px;border-radius:4px;background:rgba(6,12,19,.56);
      border:1px solid rgba(255,255,255,.05);
    }
    .reality-ledger b{
      display:block;margin-top:3px;color:#e6f9ff;font-size:10px;letter-spacing:0;text-transform:none;
    }
    .reality-gates{position:absolute;right:16px;bottom:18px;display:grid;gap:8px;width:160px;}
    .reality-gate{
      padding:9px 10px;border-radius:7px;background:rgba(3,8,13,.74);
      border:1px solid rgba(255,255,255,.08);backdrop-filter:blur(14px);text-align:center;
      box-shadow:0 14px 40px rgba(0,0,0,.26);
    }
    .reality-gate small{
      display:block;color:#70869a;font:800 8px/1 ui-monospace,monospace;
      letter-spacing:.14em;text-transform:uppercase;
    }
    .reality-gate b{
      display:block;margin-top:5px;color:#d5e5ef;font:900 13px/1 ui-monospace,monospace;
      letter-spacing:.1em;text-transform:uppercase;
    }
    .reality-gate[data-open="true"]{
      border-color:rgba(115,238,255,.45);
      box-shadow:0 0 30px rgba(98,216,255,.18),inset 0 0 0 1px rgba(115,238,255,.16);
    }
    .reality-gate[data-open="true"] b{color:#8df2ff;}
    @media(max-width:760px){
      .reality-card{left:8px;right:8px;bottom:10px;width:auto;}
      .reality-gates{right:10px;top:80px;bottom:auto;width:124px;}
      .reality-axis{grid-template-columns:1fr;}
      .reality-ledger{grid-template-columns:1fr;}
    }
  `;
  document.head.append(style);
}

function build(panel: HTMLElement): Cockpit {
  panel.querySelector<HTMLElement>(".reality-cockpit")?.remove();
  const shell = document.createElement("div");
  shell.className = "reality-cockpit";
  shell.innerHTML = `
    <canvas class="reality-vector-field" aria-hidden="true"></canvas>
    <section class="reality-card" aria-live="polite">
      <header>
        <span><small>REALITY COCKPIT</small><b data-role="stage">FORMING FIELD</b></span>
        <output class="reality-score" data-role="score">0%</output>
      </header>
      <div class="reality-meter"><i data-role="meter"></i></div>
      <div class="reality-axis">
        <span><em>MOTION</em><i data-role="motion"></i></span>
        <span><em>EVIDENCE</em><i data-role="evidence"></i></span>
        <span><em>LINEAGE</em><i data-role="lineage"></i></span>
      </div>
      <p class="reality-instruction">
        <strong data-role="primary">AWAITING VERIFIED AUTHORITY</strong>
        <span data-role="secondary">
          The cockpit will show the exact gate blocking capture once Keyxym begins measuring frames.
        </span>
      </p>
      <div class="reality-ledger" data-role="ledger"></div>
    </section>
    <div class="reality-gates">
      <span class="reality-gate" data-role="moment" data-open="false"><small>Moment</small><b>LOCKED</b></span>
      <span class="reality-gate" data-role="seal" data-open="false"><small>Seal</small><b>LOCKED</b></span>
    </div>
  `;
  panel.append(shell);
  return {
    shell,
    canvas: shell.querySelector<HTMLCanvasElement>("canvas")!,
    stage: shell.querySelector<HTMLElement>('[data-role="stage"]')!,
    score: shell.querySelector<HTMLElement>('[data-role="score"]')!,
    meter: shell.querySelector<HTMLElement>('[data-role="meter"]')!,
    motion: shell.querySelector<HTMLElement>('[data-role="motion"]')!,
    evidence: shell.querySelector<HTMLElement>('[data-role="evidence"]')!,
    lineage: shell.querySelector<HTMLElement>('[data-role="lineage"]')!,
    primary: shell.querySelector<HTMLElement>('[data-role="primary"]')!,
    secondary: shell.querySelector<HTMLElement>('[data-role="secondary"]')!,
    ledger: shell.querySelector<HTMLElement>('[data-role="ledger"]')!,
    moment: shell.querySelector<HTMLElement>('[data-role="moment"]')!,
    seal: shell.querySelector<HTMLElement>('[data-role="seal"]')!,
  };
}

function instruction(mask: number, tracked: boolean): { title: string; detail: string } {
  if (mask & REJECT_RECEIPT) {
    return {
      title: "AUTHORITY SYNCING",
      detail:
        "The visual field stays live while Keyxym rebuilds a valid receipt chain. " +
        "Keep scanning slowly; no Moment or seal opens until native receipts validate.",
    };
  }
  if (mask & REJECT_REPROJECTION) {
    return {
      title: "REDUCE MOTION BLUR",
      detail:
        "Move more slowly, keep textured edges sharp, and maintain the same objects in view " +
        "until reprojection returns below the authority limit.",
    };
  }
  if (mask & (REJECT_POSE | REJECT_TRACKING | REJECT_PARALLAX | REJECT_DEGENERATE)) {
    return {
      title: tracked ? "REACQUIRE TRACKING" : "CREATE 3D PARALLAX",
      detail:
        "Move slowly sideways around textured objects at different depths. Keep them in view; " +
        "avoid flat walls, digital screens, blur, and repeating patterns.",
    };
  }
  if (mask & (REJECT_GEOMETRY | REJECT_CONTINUITY)) {
    return {
      title: "BUILD VERIFIED GEOMETRY",
      detail:
        "Continue a slow arc, then revisit the same surfaces so Keyxym can confirm them " +
        "across frames before enabling a Moment.",
    };
  }
  if (mask & REJECT_SCALE) {
    return {
      title: "METRIC SCALE UNBOUND",
      detail:
        "Relative World Cells can form now. Metric authority requires a verified depth, event, " +
        "or calibration adapter receipt before scale can be sealed.",
    };
  }
  return {
    title: "AUTHORITY FIELD STABLE",
    detail:
      "Keep the same textured geometry in view. When the native gate opens, " +
      "commit the Moment before changing viewpoint.",
  };
}

function bar(element: HTMLElement, ratio: number): void {
  element.style.setProperty("--value", `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`);
}

function item(label: string, value: string): HTMLElement {
  const node = document.createElement("span");
  const strong = document.createElement("b");
  strong.textContent = value;
  node.append(document.createTextNode(label), strong);
  return node;
}

function render(cockpit: Cockpit, state: Snapshot, tracked: boolean): void {
  const next = instruction(state.mask, tracked);
  const motion = Math.max(state.tracking, Math.min(1, state.parallax / 1.2));
  const evidence = Math.max(state.coverage, Math.min(1, state.confirmed / 256));
  const lineage = state.sealGate ? 1 : state.momentGate ? 0.68 : state.revision !== "0" ? 0.34 : 0;
  cockpit.stage.textContent = STAGE[state.stage];
  cockpit.score.textContent = `${Math.round(state.score * 100)}%`;
  cockpit.meter.style.width = `${Math.round(state.score * 100)}%`;
  bar(cockpit.motion, motion);
  bar(cockpit.evidence, evidence);
  bar(cockpit.lineage, lineage);
  cockpit.primary.textContent = state.momentGate ? "COMMIT AUTHORIZED MOMENT" : next.title;
  cockpit.secondary.textContent = state.momentGate
    ? "The native v0.26 gate currently allows a Moment. Commit now, then keep scanning until Seal opens."
    : next.detail;
  cockpit.moment.dataset.open = String(state.momentGate);
  cockpit.moment.querySelector("b")!.textContent = state.momentGate ? "OPEN" : "LOCKED";
  cockpit.seal.dataset.open = String(state.sealGate);
  cockpit.seal.querySelector("b")!.textContent = state.sealGate ? "OPEN" : "LOCKED";
  cockpit.ledger.replaceChildren(
    item("Frames", String(state.frames)),
    item("Forming", state.forming.toLocaleString()),
    item("Confirmed", state.confirmed.toLocaleString()),
    item("Revision", state.revision),
    item("Parallax", `${state.parallax.toFixed(2)}°`),
    item("Pose error", state.error === null ? "—" : `${state.error.toFixed(2)} px`),
  );
}

function draw(canvas: HTMLCanvasElement, state: Snapshot, time: number): void {
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
  const cy = h * 0.5;
  const pulse = time * 0.0012;
  const authority = Math.max(0.06, state.score);
  const parallax = Math.min(1, state.parallax / 2);
  const coverage = Math.max(state.coverage, Math.min(1, state.surfels / 2048));
  context.globalAlpha = 0.26;
  context.strokeStyle = "rgba(104,214,255,.24)";
  for (let radius = 72; radius < Math.max(w, h) * 0.65; radius += 74) {
    context.beginPath();
    context.arc(cx, cy, radius + Math.sin(pulse + radius * 0.01) * 5 * authority, 0, Math.PI * 2);
    context.stroke();
  }
  const rays = Math.max(24, Math.min(128, Math.round(24 + state.forming / 80 + state.confirmed / 16)));
  for (let index = 0; index < rays; index += 1) {
    const angle = (index / rays) * Math.PI * 2 + pulse * (0.16 + authority * 0.24);
    const radius = 92 + ((index * 47) % 260) + Math.sin(pulse * 1.7 + index) * 26 * (0.25 + parallax);
    const bend = Math.sin(angle * 3 + pulse) * 28 * parallax;
    context.globalAlpha = 0.06 + authority * 0.20 + coverage * 0.10;
    context.strokeStyle = state.momentGate ? "rgba(132,244,255,.55)" : "rgba(226,191,102,.40)";
    context.beginPath();
    context.moveTo(cx + Math.cos(angle + Math.PI) * 18, cy + Math.sin(angle + Math.PI) * 12);
    context.quadraticCurveTo(
      cx + Math.cos(angle + Math.PI / 2) * bend,
      cy + Math.sin(angle + Math.PI / 2) * bend,
      cx + Math.cos(angle) * radius,
      cy + Math.sin(angle) * radius * 0.62,
    );
    context.stroke();
  }
  context.globalAlpha = 0.80;
  context.lineWidth = 2;
  context.strokeStyle = state.sealGate
    ? "rgba(154,255,232,.85)"
    : state.momentGate
      ? "rgba(112,229,255,.78)"
      : "rgba(211,180,101,.66)";
  context.beginPath();
  context.arc(cx, cy, 52 + authority * 36, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.04, authority));
  context.stroke();
  context.restore();
}

export function installWorldCellGuidance(): () => void {
  const root = document.documentElement;
  const stageMessage = document.getElementById("stage-message");
  const heading = stageMessage?.querySelector("b") ?? null;
  const detail = stageMessage?.querySelector("span") ?? null;
  const capture = document.getElementById("capture-state");
  const stagePanel = document.querySelector<HTMLElement>(".stage-panel");
  if (!stageMessage || !heading || !detail || !capture || !stagePanel) return () => undefined;
  stageMessage.setAttribute("aria-live", "polite");
  installStyle();
  const cockpit = build(stagePanel);
  let tracked = false;
  let animation = 0;
  const update = () => {
    if (root.dataset.keyxymAuthority !== "verified") return;
    const current = snapshot(root);
    if (current.stage !== "forming") tracked = true;
    const copy = instruction(current.mask, tracked);
    if (current.stage === "forming" && capture.textContent?.trim() !== "READY") {
      heading.textContent = copy.title;
      detail.textContent = copy.detail;
      stageMessage.style.display = "";
    }
    render(cockpit, current, tracked);
  };
  const tick = (time: number) => {
    draw(cockpit.canvas, snapshot(root), time);
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
  const watched = [
    capture,
    ...[
      "frame-count",
      "tracking-value",
      "parallax-value",
      "error-value",
      "coverage-value",
      "confirmed-value",
      "uncertain-value",
      "rejected-value",
      "quality-meter",
    ].map((id) => document.getElementById(id)).filter((node): node is HTMLElement => node instanceof HTMLElement),
  ];
  for (const node of watched) {
    observer.observe(node, { childList: true, characterData: true, attributes: true, subtree: true });
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
