import "./world-cell-theater.css";
import * as THREE from "three";

const byId = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!(node instanceof HTMLElement)) throw new Error(`Missing World Cell element: ${id}`);
  return node as T;
};

interface VisualPoint {
  x: number; y: number; z: number;
  r: number; g: number; b: number;
}

export function installWorldCellPreviewFallback(reason: unknown): void {
  const video = byId<HTMLVideoElement>("camera");
  const canvas = byId<HTMLCanvasElement>("stage");
  const start = byId<HTMLButtonElement>("start-button");
  const stop = byId<HTMLButtonElement>("stop-button");
  const capture = byId<HTMLButtonElement>("capture-button");
  const seal = byId<HTMLButtonElement>("seal-button");
  const send = byId<HTMLButtonElement>("send-button");
  const stageMessage = byId<HTMLElement>("stage-message");

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, 1, 0.01, 100);
  camera.position.set(0, 0, 2.4);
  scene.add(new THREE.AmbientLight(0xffffff, 1));
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.PointsMaterial({ size: 0.018, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.94 });
  const cloud = new THREE.Points(geometry, material);
  scene.add(cloud);
  const grid = new THREE.GridHelper(4, 32, 0x1c5770, 0x102433);
  grid.rotation.x = Math.PI / 2;
  grid.position.z = -1.6;
  scene.add(grid);

  let stream: MediaStream | null = null;
  let running = false;
  let frame = 0;
  let timer = 0;
  let animation = 0;
  let previousLuma: Float32Array | null = null;
  let visualYaw = 0;
  let visualPitch = 0;
  const sourceReason = reason instanceof Error ? reason.message : String(reason);
  const keyxymState = document.documentElement.dataset.keyxymMapAuthority ?? "not-started";
  const eformState = document.documentElement.dataset.eformAuthority ?? "unavailable";

  document.documentElement.dataset.keyxymAuthority = "preview";
  document.documentElement.dataset.worldCellMode = "visual-preview";
  document.documentElement.dataset.visualPipeline = "keyxym-v021-responsive-baseline";

  byId("compute-state").textContent = "VISUAL SPATIAL PREVIEW";
  byId("pose-state").textContent = "VISUAL TRACK READY";
  byId("cell-state").textContent = "VISUAL CELL / UNSEALED";
  byId("backend-name").textContent = "KEYXYM V0.21 VISUAL BASELINE";
  byId("adapter-name").textContent = "CAMERA RGB / NON-METRIC";
  byId("gpu-badge").textContent = "VISUAL ONLY";
  byId("rootprint").textContent = "UNSEALED";
  byId("surfel-count").textContent = "0";
  byId("sensor-detail").textContent =
    `Responsive visual spatial formation is active. Authoritative depth/pose remains locked ` +
    `(keyxym_map: ${keyxymState}; eform: ${eformState}) until a verified depth and landmark adapter is present.`;

  const heading = stageMessage.querySelector("b");
  const detail = stageMessage.querySelector("span");
  if (heading) heading.textContent = "VISUAL SPATIAL MODE READY";
  if (detail) detail.textContent = `${sourceReason}. Camera RGB will form responsive non-authoritative points; no Moment, seal, Rootprint, or transfer can be created.`;
  stageMessage.style.display = "";

  capture.disabled = true;
  seal.disabled = true;
  send.disabled = true;
  stop.disabled = true;
  start.disabled = !navigator.mediaDevices?.getUserMedia;

  const resize = (): void => {
    const bounds = canvas.getBoundingClientRect();
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(Math.max(1, bounds.width), Math.max(1, bounds.height), false);
    camera.aspect = Math.max(1, bounds.width) / Math.max(1, bounds.height);
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  const updateCloud = (points: VisualPoint[]): void => {
    const positions = new Float32Array(points.length * 3);
    const colors = new Float32Array(points.length * 3);
    points.forEach((point, index) => {
      positions.set([point.x, point.y, point.z], index * 3);
      colors.set([point.r, point.g, point.b], index * 3);
    });
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();
    byId("surfel-count").textContent = `0 AUTH / ${points.length.toLocaleString()} VIS`;
    document.documentElement.dataset.visualPoints = String(points.length);
  };

  const sampleFrame = (): void => {
    if (!running || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    const width = 160;
    const height = Math.max(90, Math.round(width * video.videoHeight / Math.max(1, video.videoWidth)));
    const source = document.createElement("canvas");
    source.width = width;
    source.height = height;
    const context = source.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    context.drawImage(video, 0, 0, width, height);
    const image = context.getImageData(0, 0, width, height);
    const luma = new Float32Array(width * height);
    const points: VisualPoint[] = [];
    let flowX = 0;
    let flowY = 0;
    let flowWeight = 0;
    const stride = 3;
    for (let y = 1; y < height - 1; y += stride) {
      for (let x = 1; x < width - 1; x += stride) {
        const pixel = y * width + x;
        const offset = pixel * 4;
        const r = image.data[offset]! / 255;
        const g = image.data[offset + 1]! / 255;
        const b = image.data[offset + 2]! / 255;
        const value = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        luma[pixel] = value;
        const gx = (image.data[offset + 4]! - image.data[offset - 4]!) / 255;
        const gy = (image.data[offset + width * 4]! - image.data[offset - width * 4]!) / 255;
        const edge = Math.min(1, Math.hypot(gx, gy) * 2.5);
        const depth = 0.78 + (1 - value) * 0.72 + edge * 0.18;
        const nx = (x / width - 0.5) * depth * 1.45;
        const ny = -(y / height - 0.5) * depth * (height / width) * 1.45;
        points.push({ x: nx, y: ny, z: -depth, r, g, b });
        if (previousLuma) {
          const temporal = value - previousLuma[pixel]!;
          const weight = Math.abs(temporal) * (0.25 + edge);
          flowX += gx * temporal * weight;
          flowY += gy * temporal * weight;
          flowWeight += weight;
        }
      }
    }
    if (flowWeight > 0.001) {
      visualYaw = visualYaw * 0.9 + Math.max(-0.02, Math.min(0.02, flowX / flowWeight)) * 0.1;
      visualPitch = visualPitch * 0.9 + Math.max(-0.02, Math.min(0.02, flowY / flowWeight)) * 0.1;
    }
    previousLuma = luma;
    cloud.rotation.y += visualYaw;
    cloud.rotation.x = Math.max(-0.25, Math.min(0.25, cloud.rotation.x + visualPitch));
    updateCloud(points);
    frame += 1;
    byId("frame-count").textContent = String(frame);
    byId("pose-state").textContent = `VISUAL TRACK ${Math.round(Math.min(1, flowWeight * 5) * 100)}%`;
    byId("capture-state").textContent = "VISUAL FORMING";
    byId("dispatch-time").textContent = "RGB VISUAL / NON-AUTH";
  };

  const render = (): void => {
    if (!running) cloud.rotation.y += 0.00035;
    renderer.render(scene, camera);
    animation = requestAnimationFrame(render);
  };
  render();

  const stopPreview = (): void => {
    running = false;
    if (timer) window.clearInterval(timer);
    timer = 0;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    video.srcObject = null;
    start.disabled = !navigator.mediaDevices?.getUserMedia;
    stop.disabled = true;
    byId("capture-state").textContent = "VISUAL READY";
    stageMessage.style.display = "";
  };

  start.onclick = async () => {
    start.disabled = true;
    byId("capture-state").textContent = "REQUESTING CAMERA";
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
      running = true;
      frame = 0;
      previousLuma = null;
      stop.disabled = false;
      stageMessage.style.display = "none";
      byId("capture-state").textContent = "VISUAL FORMING";
      sampleFrame();
      timer = window.setInterval(sampleFrame, 120);
    } catch (error) {
      stopPreview();
      const message = error instanceof Error ? error.message : String(error);
      byId("capture-state").textContent = "CAMERA UNAVAILABLE";
      if (heading) heading.textContent = "CAMERA PREVIEW UNAVAILABLE";
      if (detail) detail.textContent = `${message}. Authority remains locked and no evidence was created.`;
      stageMessage.style.display = "";
    }
  };
  stop.onclick = stopPreview;
  window.addEventListener("beforeunload", () => {
    stopPreview();
    if (animation) cancelAnimationFrame(animation);
    renderer.dispose();
  }, { once: true });
}
