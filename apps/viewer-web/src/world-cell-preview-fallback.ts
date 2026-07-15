import "./world-cell-theater.css";

const byId = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!(node instanceof HTMLElement)) throw new Error(`Missing World Cell element: ${id}`);
  return node as T;
};

export function installWorldCellPreviewFallback(reason: unknown): void {
  const video = byId<HTMLVideoElement>("camera");
  const canvas = byId<HTMLCanvasElement>("stage");
  const start = byId<HTMLButtonElement>("start-button");
  const stop = byId<HTMLButtonElement>("stop-button");
  const capture = byId<HTMLButtonElement>("capture-button");
  const seal = byId<HTMLButtonElement>("seal-button");
  const send = byId<HTMLButtonElement>("send-button");
  const stageMessage = byId<HTMLElement>("stage-message");
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("Visual preview canvas unavailable");

  let stream: MediaStream | null = null;
  let frame = 0;
  let animation = 0;
  const sourceReason = reason instanceof Error ? reason.message : String(reason);

  document.documentElement.dataset.keyxymAuthority = "offline";
  document.documentElement.dataset.eformAuthority = "offline";
  document.documentElement.dataset.worldCellMode = "visual-preview";

  byId("compute-state").textContent = "KEYXYM_MAP OFFLINE";
  byId("pose-state").textContent = "VISUAL PREVIEW / UNSEALED";
  byId("cell-state").textContent = "VISUAL PREVIEW / NO AUTHORITY";
  byId("backend-name").textContent = "TESSARYN VISUAL PREVIEW";
  byId("adapter-name").textContent = "CAMERA RGB / NON-METRIC";
  byId("gpu-badge").textContent = "PREVIEW ONLY";
  byId("sensor-detail").textContent =
    "Camera visualization is available, but keyxym_map reconstruction and eform assurance are offline. Preview pixels cannot become a Moment, seal, Rootprint, or transfer artifact.";

  const heading = stageMessage.querySelector("b");
  const detail = stageMessage.querySelector("span");
  if (heading) heading.textContent = "VISUAL PREVIEW AVAILABLE";
  if (detail) detail.textContent = `Independent authority unavailable: ${sourceReason}. Start camera for non-authoritative visualization only.`;
  stageMessage.style.display = "";

  capture.disabled = true;
  seal.disabled = true;
  send.disabled = true;
  start.disabled = false;

  const resize = (): void => {
    const bounds = canvas.getBoundingClientRect();
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(bounds.width * ratio));
    const height = Math.max(1, Math.round(bounds.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  };

  const draw = (): void => {
    resize();
    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);
    if (video.readyState >= 2) {
      context.globalAlpha = 0.34;
      context.drawImage(video, 0, 0, width, height);
      context.globalAlpha = 1;
      const columns = 48;
      const rows = 36;
      const stepX = width / columns;
      const stepY = height / rows;
      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < columns; x += 1) {
          const pulse = 0.5 + 0.5 * Math.sin(frame * 0.035 + x * 0.31 + y * 0.19);
          const radius = 0.7 + pulse * 1.8;
          context.fillStyle = `rgba(208,229,238,${(0.18 + pulse * 0.45).toFixed(3)})`;
          context.beginPath();
          context.arc((x + 0.5) * stepX, (y + 0.5) * stepY, radius, 0, Math.PI * 2);
          context.fill();
        }
      }
      frame += 1;
      byId("frame-count").textContent = String(frame);
      byId("surfel-count").textContent = String(columns * rows);
    }
    animation = requestAnimationFrame(draw);
  };

  const stopPreview = (): void => {
    if (animation) cancelAnimationFrame(animation);
    animation = 0;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    video.srcObject = null;
    start.disabled = false;
    stop.disabled = true;
    byId("capture-state").textContent = "PREVIEW READY";
    stageMessage.style.display = "";
  };

  start.onclick = async () => {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    start.disabled = true;
    stop.disabled = false;
    stageMessage.style.display = "none";
    byId("capture-state").textContent = "PREVIEWING";
    draw();
  };
  stop.onclick = stopPreview;
  window.addEventListener("beforeunload", stopPreview, { once: true });
}
