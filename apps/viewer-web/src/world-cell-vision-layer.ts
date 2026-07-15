type AuthorityStage =
  | "verifying"
  | "ready"
  | "forming"
  | "tracking"
  | "moment-ready"
  | "seal-ready"
  | "rejected";

interface VisionState {
  authority: string;
  stage: AuthorityStage;
  frames: number;
  surfels: number;
  tracking: number;
  parallax: number;
  coverage: number;
  rejected: number;
  momentReady: boolean;
  sealReady: boolean;
  rejectionMask: number;
  rootprint: string;
  cellState: string;
}

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  hue: number;
  orbit: number;
  age: number;
}

interface VisionCell {
  angle: number;
  radius: number;
  layer: number;
  weight: number;
}

const REJECTION_BITS = [
  { bit: 1, title: "POSE NOT LOCKED", help: "anchor the camera on textured corners, object edges, or printed detail" },
  { bit: 2, title: "TRACKING LOW", help: "move slower and keep already-seen detail in view" },
  { bit: 4, title: "PARALLAX THIN", help: "slide sideways around the subject so foreground and background separate" },
  { bit: 8, title: "REPROJECTION HIGH", help: "reduce motion blur and avoid reflective glass or screens" },
  { bit: 16, title: "GEOMETRY SPARSE", help: "scan around textured objects at multiple depths" },
  { bit: 32, title: "CONTINUITY SHORT", help: "hold a steady orbit for several frames before committing" },
  { bit: 64, title: "RECEIPT REJECTED", help: "runtime receipt did not bind cleanly; keep capture local and retry" },
  { bit: 128, title: "DEGENERATE VIEW", help: "avoid flat walls, repeating patterns, and one-plane camera motion" },
  { bit: 256, title: "RELATIVE SCALE", help: "metric seal needs a verified depth or calibration receipt" },
] as const;

const html = document.documentElement;
const TAU = Math.PI * 2;

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function numberFromText(id: string): number {
  const text = byId(id)?.textContent ?? "";
  const value = Number(text.replace(/[^0-9.-]+/gu, ""));
  return Number.isFinite(value) ? value : 0;
}

function percentFromText(id: string): number {
  return Math.max(0, Math.min(1, numberFromText(id) / 100));
}

function classSafeStage(value: AuthorityStage): string {
  return value.replace(/[^a-z0-9-]/gu, "-");
}

function seed(index: number): number {
  return (Math.sin(index * 12.9898 + 78.233) * 43758.5453) % 1;
}

function formatPercent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100).toString()}%`;
}

function deriveStage(authority: string, rawStage: string | undefined, capture: string): AuthorityStage {
  if (authority === "rejected") return "rejected";
  if (rawStage === "forming" || rawStage === "tracking" || rawStage === "moment-ready" || rawStage === "seal-ready") {
    return rawStage;
  }
  if (/MOMENT READY/u.test(capture)) return "moment-ready";
  if (/SEAL READY/u.test(capture)) return "seal-ready";
  if (/TRACKING|RELOCALIZED/u.test(capture)) return "tracking";
  if (/FORMING/u.test(capture)) return "forming";
  if (authority === "verified") return "ready";
  return "verifying";
}

function guidanceFor(mask: number, state: VisionState): Array<{ title: string; help: string }> {
  if (state.stage === "rejected") {
    return [{ title: "AUTHORITY OFFLINE", help: "the runtime rejected proof; no capture, Moment, seal, or transfer is enabled" }];
  }
  const found = REJECTION_BITS.filter((item) => (mask & item.bit) !== 0).slice(0, 4);
  if (found.length > 0) return found.map((item) => ({ title: item.title, help: item.help }));
  if (state.sealReady) return [{ title: "SEAL WINDOW OPEN", help: "commit the seal-ready Moment, then seal with eform/Power House proof" }];
  if (state.momentReady) return [{ title: "MOMENT WINDOW OPEN", help: "commit an authoritative Moment before changing viewpoint" }];
  if (state.stage === "tracking") return [{ title: "BUILD CONTINUITY", help: "keep the subject in frame and continue the slow orbit" }];
  if (state.stage === "forming") return [{ title: "FORMING FIELD", help: "the visual field is alive; add sideways parallax to make it authoritative" }];
  return [{ title: "READY TO SEE", help: "start camera for real authority, or preview the vision without creating evidence" }];
}

class VisionLayer {
  private readonly stage: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly root: HTMLElement;
  private readonly status: HTMLElement;
  private readonly guidance: HTMLElement;
  private readonly ladder: HTMLElement;
  private readonly metrics: HTMLElement;
  private readonly previewButton: HTMLButtonElement;
  private readonly captureButton: HTMLButtonElement;
  private readonly particles: Particle[] = [];
  private readonly cells: VisionCell[] = [];
  private readonly resizeObserver: ResizeObserver;
  private readonly mutationObserver: MutationObserver;
  private preview = false;
  private pointerX = 0;
  private pointerY = 0;
  private frame = 0;
  private state: VisionState = this.readState();

  constructor(stage: HTMLElement) {
    this.stage = stage;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "vision-canvas";
    const context = this.canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("World Cell vision canvas is unavailable");
    this.ctx = context;
    this.root = document.createElement("section");
    this.root.className = "vision-console";
    this.root.setAttribute("aria-label", "World Cell vision cockpit");
    this.root.innerHTML = `
      <header>
        <span><small>TESSARYN VISION</small><b>4D CONTINUUM COCKPIT</b></span>
        <em id="vision-mode">LIVE AUTHORITY</em>
      </header>
      <div class="vision-status" aria-live="polite">Condensing the native World Cell instrument.</div>
      <div class="vision-ladder" aria-label="Authority ladder"></div>
      <div class="vision-guidance" aria-label="Capture guidance"></div>
      <div class="vision-metrics" aria-label="Continuum metrics"></div>
      <footer>
        <button id="vision-preview" type="button">VISION PREVIEW</button>
        <button id="vision-capture" type="button">START GUIDED CAPTURE</button>
      </footer>
      <p class="vision-disclaimer">Preview visuals are planning material only. Only Keyxym receipts, committed Moments, and eform seals become authoritative evidence.</p>
    `;
    this.status = this.require<HTMLElement>(".vision-status");
    this.guidance = this.require<HTMLElement>(".vision-guidance");
    this.ladder = this.require<HTMLElement>(".vision-ladder");
    this.metrics = this.require<HTMLElement>(".vision-metrics");
    this.previewButton = this.require<HTMLButtonElement>("#vision-preview");
    this.captureButton = this.require<HTMLButtonElement>("#vision-capture");
    this.stage.append(this.canvas, this.root);
    this.previewButton.addEventListener("click", () => this.togglePreview());
    this.captureButton.addEventListener("click", () => this.startGuidedCapture());
    this.stage.addEventListener("pointermove", (event) => this.trackPointer(event));
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.stage);
    this.mutationObserver = new MutationObserver(() => this.updateFromDom());
    this.mutationObserver.observe(html, { attributes: true, attributeFilter: [
      "data-keyxym-authority",
      "data-authority-stage",
      "data-authority-rejection-mask",
      "data-moment-allowed",
      "data-seal-allowed",
      "data-forming-samples",
      "data-authoritative-surfels",
    ] });
    this.seedVision();
    this.resize();
    this.updateFromDom();
    requestAnimationFrame((time) => this.draw(time));
  }

  private require<T extends HTMLElement>(selector: string): T {
    const found = this.root.querySelector(selector);
    if (!(found instanceof HTMLElement)) throw new Error(`World Cell vision element missing: ${selector}`);
    return found as T;
  }

  private seedVision(): void {
    for (let index = 0; index < 420; index += 1) {
      this.particles.push({
        x: seed(index) * 2 - 1,
        y: seed(index + 101) * 2 - 1,
        z: seed(index + 202),
        vx: 0,
        vy: 0,
        hue: 180 + seed(index + 303) * 80,
        orbit: seed(index + 404) * TAU,
        age: seed(index + 505) * 100,
      });
    }
    for (let index = 0; index < 18; index += 1) {
      this.cells.push({
        angle: index / 18 * TAU,
        radius: 0.20 + seed(index + 700) * 0.62,
        layer: (index % 6) / 5,
        weight: 0.45 + seed(index + 800) * 0.55,
      });
    }
  }

  private trackPointer(event: PointerEvent): void {
    const bounds = this.stage.getBoundingClientRect();
    this.pointerX = bounds.width > 0 ? (event.clientX - bounds.left) / bounds.width * 2 - 1 : 0;
    this.pointerY = bounds.height > 0 ? (event.clientY - bounds.top) / bounds.height * 2 - 1 : 0;
  }

  private resize(): void {
    const bounds = this.stage.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.floor(bounds.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(bounds.height * dpr));
    this.canvas.style.width = `${Math.max(1, bounds.width).toString()}px`;
    this.canvas.style.height = `${Math.max(1, bounds.height).toString()}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private togglePreview(): void {
    this.preview = !this.preview;
    this.root.dataset.preview = String(this.preview);
    this.previewButton.textContent = this.preview ? "LIVE AUTHORITY" : "VISION PREVIEW";
    this.updateFromDom();
  }

  private startGuidedCapture(): void {
    const start = byId<HTMLButtonElement>("start-button");
    if (!start || start.disabled) {
      this.status.textContent = "Authority is not ready for camera capture yet; preview remains visual-only.";
      return;
    }
    start.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  private readState(): VisionState {
    const authority = html.dataset.keyxymAuthority ?? "verifying";
    const capture = byId("capture-state")?.textContent?.trim().toUpperCase() ?? "VERIFYING";
    return {
      authority,
      stage: deriveStage(authority, html.dataset.authorityStage, capture),
      frames: Math.max(0, Math.round(numberFromText("frame-count"))),
      surfels: Math.max(0, Math.round(numberFromText("surfel-count"))),
      tracking: percentFromText("tracking-value"),
      parallax: Math.max(0, numberFromText("parallax-value")),
      coverage: percentFromText("coverage-value"),
      rejected: Math.max(0, Math.round(numberFromText("rejected-value"))),
      momentReady: html.dataset.momentAllowed === "true",
      sealReady: html.dataset.sealAllowed === "true",
      rejectionMask: Number.parseInt(html.dataset.authorityRejectionMask ?? "0", 10) || 0,
      rootprint: byId("rootprint")?.textContent?.trim() ?? "UNSEALED",
      cellState: byId("cell-state")?.textContent?.trim() ?? "WORLD CELL / VERIFYING",
    };
  }

  private updateFromDom(): void {
    this.state = this.readState();
    this.root.dataset.stage = classSafeStage(this.state.stage);
    const mode = this.root.querySelector("#vision-mode");
    if (mode) mode.textContent = this.preview ? "NON-AUTHORITATIVE VISION PREVIEW" : "LIVE AUTHORITY";
    const path = this.preview ? "vision preview" : this.state.cellState.toLowerCase();
    this.status.textContent = `${path} / ${this.state.frames.toLocaleString()} frames / ${this.state.surfels.toLocaleString()} surfels / ${this.state.rootprint}`;
    this.renderLadder();
    this.renderGuidance();
    this.renderMetrics();
  }

  private renderLadder(): void {
    const stages: Array<[AuthorityStage, string]> = [
      ["verifying", "PROVENANCE"],
      ["ready", "WORKER READY"],
      ["forming", "FORMING"],
      ["tracking", "TRACKING"],
      ["moment-ready", "MOMENT"],
      ["seal-ready", "SEAL"],
    ];
    const active = stages.findIndex(([stage]) => stage === this.state.stage);
    const ceiling = active >= 0 ? active : this.state.authority === "verified" ? 1 : 0;
    this.ladder.replaceChildren(...stages.map(([stage, label], index) => {
      const item = document.createElement("span");
      item.className = index <= ceiling && this.state.stage !== "rejected" ? "complete" : "";
      if (stage === this.state.stage) item.classList.add("active");
      item.textContent = label;
      return item;
    }));
  }

  private renderGuidance(): void {
    const items = guidanceFor(this.state.rejectionMask, this.state);
    this.guidance.replaceChildren(...items.map((item) => {
      const row = document.createElement("article");
      const title = document.createElement("b");
      const help = document.createElement("span");
      title.textContent = item.title;
      help.textContent = item.help;
      row.append(title, help);
      return row;
    }));
  }

  private renderMetrics(): void {
    const score = Math.max(this.state.tracking, this.state.coverage, this.preview ? 0.72 : 0);
    const values = [
      ["AUTHORITY", this.preview ? "PREVIEW" : this.state.stage.toUpperCase()],
      ["TRACK", formatPercent(this.state.tracking)],
      ["COVER", formatPercent(this.state.coverage)],
      ["PARALLAX", `${this.state.parallax.toFixed(2)}°`],
      ["REJECT", this.state.rejected.toLocaleString()],
      ["VISION", formatPercent(score)],
    ] as const;
    this.metrics.replaceChildren(...values.map(([label, value]) => {
      const box = document.createElement("span");
      const small = document.createElement("small");
      const strong = document.createElement("b");
      small.textContent = label;
      strong.textContent = value;
      box.append(small, strong);
      return box;
    }));
  }

  private draw(time: number): void {
    this.frame += 1;
    const bounds = this.stage.getBoundingClientRect();
    const width = Math.max(1, bounds.width);
    const height = Math.max(1, bounds.height);
    const centerX = width * (0.5 + this.pointerX * 0.015);
    const centerY = height * (0.52 + this.pointerY * 0.015);
    const activity = this.preview
      ? 0.82
      : Math.max(this.state.tracking, this.state.coverage, Math.min(1, this.state.surfels / 800));
    this.ctx.clearRect(0, 0, width, height);
    this.drawContinuumField(width, height, centerX, centerY, activity, time);
    this.drawCells(width, height, centerX, centerY, activity, time);
    this.drawParticles(width, height, centerX, centerY, activity, time);
    this.drawRings(width, height, centerX, centerY, activity, time);
    requestAnimationFrame((nextTime) => this.draw(nextTime));
  }

  private drawContinuumField(width: number, height: number, cx: number, cy: number, activity: number, time: number): void {
    const gradient = this.ctx.createRadialGradient(cx, cy, 20, cx, cy, Math.max(width, height) * 0.72);
    gradient.addColorStop(0, `rgba(98, 216, 255, ${0.05 + activity * 0.12})`);
    gradient.addColorStop(0.36, `rgba(210, 182, 110, ${0.025 + activity * 0.05})`);
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, width, height);

    this.ctx.save();
    this.ctx.translate(cx, cy);
    this.ctx.rotate(time * 0.000035);
    for (let ring = 0; ring < 7; ring += 1) {
      const radius = Math.min(width, height) * (0.12 + ring * 0.064 + Math.sin(time * 0.00045 + ring) * 0.004);
      this.ctx.beginPath();
      this.ctx.ellipse(0, 0, radius * (1.2 + activity * 0.14), radius * (0.48 + ring * 0.02), 0, 0, TAU);
      this.ctx.strokeStyle = `rgba(92, 208, 255, ${0.040 + activity * 0.035})`;
      this.ctx.lineWidth = ring % 2 === 0 ? 1.2 : 0.6;
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  private cellPosition(cell: VisionCell, width: number, height: number, cx: number, cy: number, time: number): { x: number; y: number } {
    const drift = time * 0.00018 + cell.layer * 0.7;
    const radius = Math.min(width, height) * cell.radius;
    return {
      x: cx + Math.cos(cell.angle + drift) * radius * (1.0 + cell.layer * 0.18),
      y: cy + Math.sin(cell.angle * 0.83 - drift) * radius * (0.54 + cell.layer * 0.16),
    };
  }

  private drawCells(width: number, height: number, cx: number, cy: number, activity: number, time: number): void {
    this.ctx.save();
    for (let index = 0; index < this.cells.length; index += 1) {
      const cell = this.cells[index]!;
      const position = this.cellPosition(cell, width, height, cx, cy, time);
      const next = this.cellPosition(this.cells[(index + 5) % this.cells.length]!, width, height, cx, cy, time);
      this.ctx.beginPath();
      this.ctx.moveTo(position.x, position.y);
      this.ctx.lineTo(next.x, next.y);
      this.ctx.strokeStyle = `rgba(178, 219, 255, ${0.035 + activity * 0.06})`;
      this.ctx.lineWidth = 0.7 + cell.weight * 0.8;
      this.ctx.stroke();
      const glow = 4 + cell.weight * 8 + activity * 8;
      const gradient = this.ctx.createRadialGradient(position.x, position.y, 1, position.x, position.y, glow);
      gradient.addColorStop(0, `rgba(255, 240, 184, ${0.24 + activity * 0.24})`);
      gradient.addColorStop(0.52, `rgba(98, 216, 255, ${0.08 + activity * 0.18})`);
      gradient.addColorStop(1, "rgba(98, 216, 255, 0)");
      this.ctx.fillStyle = gradient;
      this.ctx.beginPath();
      this.ctx.arc(position.x, position.y, glow, 0, TAU);
      this.ctx.fill();
    }
    this.ctx.restore();
  }

  private drawParticles(width: number, height: number, cx: number, cy: number, activity: number, time: number): void {
    const liveBoost = Math.min(1, this.state.surfels / 1400 + this.state.frames / 120);
    const previewBoost = this.preview ? 0.65 : 0;
    const authorityPull = Math.max(activity, liveBoost, previewBoost);
    this.ctx.save();
    this.ctx.globalCompositeOperation = "lighter";
    for (let index = 0; index < this.particles.length; index += 1) {
      const particle = this.particles[index]!;
      const targetCell = this.cells[index % this.cells.length]!;
      const target = this.cellPosition(targetCell, width, height, cx, cy, time + particle.age * 40);
      const baseX = cx + Math.cos(particle.orbit + time * 0.00016 * (0.5 + particle.z)) * width * (0.14 + particle.z * 0.25);
      const baseY = cy + Math.sin(particle.orbit * 0.77 - time * 0.00013) * height * (0.09 + particle.z * 0.18);
      const tx = baseX * (1 - authorityPull) + target.x * authorityPull;
      const ty = baseY * (1 - authorityPull) + target.y * authorityPull;
      particle.vx = (particle.vx + (tx - particle.x * width) * 0.000022) * 0.94;
      particle.vy = (particle.vy + (ty - particle.y * height) * 0.000022) * 0.94;
      particle.x += particle.vx;
      particle.y += particle.vy;
      const px = particle.x * width;
      const py = particle.y * height;
      const size = 0.9 + particle.z * 2.4 + activity * 1.8;
      this.ctx.fillStyle = `hsla(${particle.hue.toFixed(1)}, 88%, ${56 + particle.z * 20}%, ${0.07 + activity * 0.24})`;
      this.ctx.beginPath();
      this.ctx.arc(px, py, size, 0, TAU);
      this.ctx.fill();
      if (px < -20 || px > width + 20 || py < -20 || py > height + 20) {
        particle.x = 0.5 + (seed(index + this.frame) - 0.5) * 0.4;
        particle.y = 0.5 + (seed(index + this.frame + 7) - 0.5) * 0.4;
        particle.vx = 0;
        particle.vy = 0;
      }
    }
    this.ctx.restore();
  }

  private drawRings(width: number, height: number, cx: number, cy: number, activity: number, time: number): void {
    const stage = this.state.stage;
    const sealPulse = stage === "seal-ready" ? 1 : stage === "moment-ready" ? 0.72 : activity;
    this.ctx.save();
    this.ctx.translate(cx, cy);
    for (let index = 0; index < 4; index += 1) {
      const radius = Math.min(width, height) * (0.18 + index * 0.07 + sealPulse * 0.045);
      const start = time * 0.00055 * (index % 2 === 0 ? 1 : -1) + index;
      this.ctx.beginPath();
      this.ctx.arc(0, 0, radius, start, start + TAU * (0.24 + sealPulse * 0.20));
      this.ctx.strokeStyle = index === 3 && this.preview
        ? "rgba(255, 120, 86, 0.50)"
        : `rgba(255, 236, 178, ${0.08 + sealPulse * 0.16})`;
      this.ctx.lineWidth = 1.2 + sealPulse * 2;
      this.ctx.stroke();
    }
    this.ctx.restore();
    if (this.preview) {
      this.ctx.save();
      this.ctx.font = "600 11px ui-monospace, monospace";
      this.ctx.fillStyle = "rgba(255, 213, 160, 0.82)";
      this.ctx.fillText("NON-AUTHORITATIVE VISION PREVIEW / NO MOMENT / NO SEAL", 22, height - 24);
      this.ctx.restore();
    }
  }
}

export function installWorldCellVisionLayer(): void {
  if (document.documentElement.dataset.visionLayer === "installed") return;
  const stage = document.querySelector<HTMLElement>(".stage-panel");
  if (!stage) throw new Error("World Cell stage panel is missing");
  document.documentElement.dataset.visionLayer = "installed";
  new VisionLayer(stage);
}
