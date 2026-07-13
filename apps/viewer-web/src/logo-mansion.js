import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { parseAndVerifyCinematicObject } from "./cinematic-object";
import { LogoMansion } from "./logo-mansion-scene.js";
import "./logo-mansion.css";

const OBJECT_URL = "./objects/nostalgia-continuum-monument-01.tessaryn";
const byId = (id) => {
  const value = document.getElementById(id);
  if (!value) throw new Error(`missing mansion element: ${id}`);
  return value;
};
const ui = {
  app: byId("mansion-app"),
  canvas: byId("mansion-canvas"),
  proof: byId("mansion-proof"),
  proofLabel: byId("mansion-proof-label"),
  moments: byId("mansion-moments"),
  cell: byId("mansion-cell"),
  rootprint: byId("mansion-rootprint"),
  roomName: byId("mansion-room-name"),
  roomMeta: byId("mansion-room-meta"),
  roomDetail: byId("mansion-room-detail"),
  momentLabel: byId("mansion-moment-label"),
  momentMeaning: byId("mansion-moment-meaning"),
  play: byId("mansion-play"),
  time: byId("mansion-time"),
  clock: byId("mansion-clock"),
  chronofold: byId("mansion-chronofold"),
  reset: byId("mansion-reset"),
  loader: byId("mansion-loader"),
  loaderTitle: byId("mansion-loader-title"),
  loaderDetail: byId("mansion-loader-detail"),
  loaderProgress: byId("mansion-loader-progress"),
  toast: byId("mansion-toast"),
};
let toastTimer = 0;

void boot().catch((error) => {
  console.error(error);
  document.body.dataset.error = "true";
  ui.proof.dataset.state = "rejected";
  ui.proofLabel.textContent = "OBJECT REJECTED";
  ui.loaderTitle.textContent = "MANSION CONSTRUCTION STOPPED";
  ui.loaderDetail.textContent = error instanceof Error ? error.message.toUpperCase() : String(error);
  ui.loaderProgress.style.width = "100%";
});

async function boot() {
  const constrained = innerWidth <= 680 || (navigator.hardwareConcurrency ?? 8) <= 4;
  const renderer = new THREE.WebGLRenderer({
    canvas: ui.canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.04;
  renderer.setPixelRatio(Math.min(devicePixelRatio, constrained ? 1.1 : 1.7));
  renderer.shadowMap.enabled = !constrained;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#03070a");
  scene.fog = new THREE.FogExp2("#03070a", 0.017);
  const camera = new THREE.PerspectiveCamera(48, 1, 0.05, 120);
  const homeCamera = new THREE.Vector3(12.8, 7.7, -12.6);
  const homeTarget = new THREE.Vector3(0, -0.9, 0);
  camera.position.copy(homeCamera);
  const controls = new OrbitControls(camera, ui.canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.055;
  controls.target.copy(homeTarget);
  controls.minDistance = 5.6;
  controls.maxDistance = 30;
  controls.maxPolarAngle = Math.PI * 0.49;

  const environment = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environmentMap = pmrem.fromScene(environment, 0.035);
  scene.environment = environmentMap.texture;
  environment.dispose();
  pmrem.dispose();
  const hemisphere = new THREE.HemisphereLight("#c8e1dc", "#17130f", constrained ? 1.35 : 2.05);
  const sun = new THREE.DirectionalLight("#ffe3ae", constrained ? 2.6 : 4.4);
  sun.position.set(-8, 14, 10);
  sun.castShadow = !constrained;
  sun.shadow.mapSize.set(1024, 1024);
  const teal = new THREE.PointLight("#74c8c1", constrained ? 3 : 8, 26, 1.8);
  teal.position.set(5, 2.5, 3);
  const ember = new THREE.PointLight("#d18662", constrained ? 3 : 7, 24, 1.9);
  ember.position.set(-4.5, 4, -4.5);
  scene.add(hemisphere, sun, teal, ember);

  setLoading("READING VERIFIED OBJECT", "FETCHING COMMITTED BYTES", 5);
  const response = await fetch(OBJECT_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`mansion object request failed: ${String(response.status)}`);
  const parsed = await parseAndVerifyCinematicObject(await response.blob(), (progress) => {
    const fraction = progress.totalBytes > 0 ? progress.bytesRead / progress.totalBytes : 0;
    setLoading(
      "VERIFYING MANSION CELL",
      `${String(progress.chunksVerified)} MEDIA CHUNKS REVERIFIED`,
      10 + fraction * 78,
    );
  });
  if (!parsed.report.accepted) throw new Error(parsed.report.errors.join(" / ") || "object rejected");

  const descriptor = parsed.envelope.descriptor;
  setLoading("DECODING TEMPORAL MATTER", "OPENING COMMITTED H.264 MEMORY", 91);
  const video = document.createElement("video");
  const videoUrl = URL.createObjectURL(parsed.media);
  video.src = videoUrl;
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = "auto";
  video.disablePictureInPicture = true;
  await new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("cinematic media metadata timed out")), 15_000);
    video.addEventListener("loadedmetadata", () => {
      window.clearTimeout(timer);
      const durationMs = Math.round(video.duration * 1_000);
      if (
        video.videoWidth !== descriptor.media.width ||
        video.videoHeight !== descriptor.media.height ||
        Math.abs(durationMs - descriptor.duration_ms) > 250
      ) {
        reject(new Error("cinematic media metadata does not match the verified descriptor"));
        return;
      }
      resolve();
    }, { once: true });
    video.addEventListener("error", () => {
      window.clearTimeout(timer);
      reject(new Error("browser decoder rejected the committed cinematic material"));
    }, { once: true });
    video.load();
  });

  const mediaTexture = new THREE.VideoTexture(video);
  mediaTexture.colorSpace = THREE.SRGBColorSpace;
  mediaTexture.minFilter = THREE.LinearFilter;
  mediaTexture.magFilter = THREE.LinearFilter;
  mediaTexture.generateMipmaps = false;
  setLoading("CONSTRUCTING LOGO MANSION", "ASSEMBLING THREE INTERLOCKED WINGS", 96);
  const mansion = new LogoMansion(descriptor, mediaTexture, constrained);
  mansion.root.position.y = 0.55;
  scene.add(mansion.root);
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(22, constrained ? 36 : 72),
    new THREE.MeshPhongMaterial({
      color: "#070c0c",
      emissive: "#020404",
      specular: "#19231f",
      shininess: 12,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -2.61;
  ground.receiveShadow = !constrained;
  scene.add(ground);

  ui.cell.textContent = shortDigest(parsed.envelope.cell_proof.cell_id, 10);
  ui.rootprint.textContent = shortDigest(parsed.envelope.cell_proof.rootprint.root_branch, 10);
  showSpace({
    name: "CENTRAL MEMORY ATRIUM",
    meta: "ROOTPRINT HEART / ALL LEVELS",
    detail: descriptor.slbit.summary,
  });
  populateMoments(descriptor, video);

  let fold = 0;
  let foldTarget = 0;
  let scrubbing = false;
  let lastFrame = performance.now();
  let activeMoment = "";
  let playing = false;
  const setPlaying = async (active) => {
    if (active) await video.play();
    else video.pause();
    playing = active;
    ui.play.classList.toggle("active", active);
    ui.play.setAttribute("aria-pressed", String(active));
    const label = ui.play.querySelector("b");
    if (label) label.textContent = active ? "PAUSE" : "TIME";
  };

  ui.play.addEventListener("click", () => {
    void setPlaying(!playing).catch(() => showToast("BROWSER BLOCKED CINEMATIC PLAYBACK"));
  });
  ui.chronofold.addEventListener("click", () => {
    foldTarget = foldTarget > 0.5 ? 0 : 1;
    const active = foldTarget > 0.5;
    ui.chronofold.classList.toggle("active", active);
    ui.chronofold.setAttribute("aria-pressed", String(active));
    showToast(active ? "CHRONOFOLD OPEN / WINGS SEPARATED" : "CURRENT CONTINUUM RESTORED");
  });
  ui.time.addEventListener("pointerdown", () => { scrubbing = true; });
  window.addEventListener("pointerup", () => { scrubbing = false; });
  ui.time.addEventListener("input", () => {
    if (Number.isFinite(video.duration) && video.duration > 0) {
      video.currentTime = (Number(ui.time.value) / 1_000) * video.duration;
    }
  });
  ui.reset.addEventListener("click", () => {
    camera.position.copy(homeCamera);
    controls.target.copy(homeTarget);
    controls.update();
    video.currentTime = 0;
    fold = 0;
    foldTarget = 0;
    ui.chronofold.classList.remove("active");
    ui.chronofold.setAttribute("aria-pressed", "false");
    showSpace({ name: "CENTRAL MEMORY ATRIUM", meta: "ROOTPRINT HEART / ALL LEVELS", detail: descriptor.slbit.summary });
    showToast("RETURNED TO MANSION ORIGIN");
  });
  bindSelection(mansion, camera, controls);

  const resize = () => {
    const width = Math.max(1, ui.canvas.clientWidth);
    const height = Math.max(1, ui.canvas.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(ui.canvas);
  resize();

  const animate = (now) => {
    const delta = Math.min(0.05, Math.max(0.001, (now - lastFrame) / 1_000));
    lastFrame = now;
    fold = THREE.MathUtils.damp(fold, foldTarget, 5.2, delta);
    const temporal = Number.isFinite(video.duration) && video.duration > 0 ? video.currentTime / video.duration : 0;
    mansion.animate(now / 1_000, delta, temporal, fold);
    controls.update();
    if (!scrubbing) ui.time.value = String(Math.round(temporal * 1_000));
    ui.clock.value = formatClock(video.currentTime * 1_000);
    ui.clock.textContent = ui.clock.value;
    const moment = currentMoment(descriptor.moments, video.currentTime * 1_000);
    if (moment && moment.id !== activeMoment) {
      activeMoment = moment.id;
      ui.app.dataset.moment = moment.id;
      ui.momentLabel.textContent = `${moment.label} / ${formatClock(moment.time_ms)}`;
      ui.momentMeaning.textContent = moment.meaning;
      document.querySelectorAll("[data-mansion-moment]").forEach((button) => {
        button.classList.toggle("active", button.dataset.mansionMoment === moment.id);
      });
    }
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  };

  window.__tessarynMansion = {
    descriptor,
    verification: parsed.report,
    diagnostics: () => mansion.diagnostics(),
  };
  ui.proof.dataset.state = "accepted";
  ui.proofLabel.textContent = `LOCALLY VERIFIED / ${String(parsed.report.verifiedMediaChunks)} CHUNKS`;
  setLoading("MANSION MATERIALIZED", "ROOTPRINT + TEMPORAL MATTER LIVE", 100);
  ui.app.dataset.ready = "true";
  document.body.dataset.ready = "true";
  await delay(320);
  ui.loader.hidden = true;
  try {
    await setPlaying(true);
  } catch {
    playing = false;
    showToast("MANSION READY / PRESS TIME TO PLAY");
  }
  requestAnimationFrame(animate);

  window.addEventListener("pagehide", () => {
    observer.disconnect();
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(videoUrl);
    mediaTexture.dispose();
    mansion.destroy();
    environmentMap.dispose();
    renderer.dispose();
  }, { once: true });
}

function bindSelection(mansion, camera, controls) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let down = null;
  ui.canvas.addEventListener("pointerdown", (event) => {
    down = { x: event.clientX, y: event.clientY };
  });
  ui.canvas.addEventListener("pointerup", (event) => {
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6) {
      down = null;
      return;
    }
    down = null;
    const bounds = ui.canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const selected = raycaster.intersectObjects(mansion.interactive, false)[0]?.object.userData.space;
    if (!selected) return;
    showSpace(selected);
    if (selected.focus) controls.target.lerp(new THREE.Vector3(...selected.focus), 0.78);
  });
}

function populateMoments(descriptor, video) {
  ui.moments.replaceChildren();
  for (const moment of descriptor.moments) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.mansionMoment = moment.id;
    const label = document.createElement("small");
    const time = document.createElement("span");
    label.textContent = moment.label;
    time.textContent = formatClock(moment.time_ms);
    button.append(label, time);
    button.addEventListener("click", () => { video.currentTime = moment.time_ms / 1_000; });
    ui.moments.append(button);
  }
}

function currentMoment(moments, timeMs) {
  let selected = moments[0] ?? null;
  for (const moment of moments) {
    if (moment.time_ms <= timeMs + 30) selected = moment;
    else break;
  }
  return selected;
}
function showSpace(value) {
  ui.roomName.textContent = value.name;
  ui.roomMeta.textContent = value.meta;
  ui.roomDetail.textContent = value.detail;
}
function setLoading(title, detail, percent) {
  ui.loaderTitle.textContent = title;
  ui.loaderDetail.textContent = detail;
  ui.loaderProgress.style.width = `${String(Math.max(0, Math.min(100, percent)))}%`;
}
function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => ui.toast.classList.remove("visible"), 2_200);
}
function formatClock(milliseconds) {
  const safe = Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0;
  const minutes = Math.floor(safe / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1_000);
  const millis = Math.floor(safe % 1_000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}
function shortDigest(value, length) {
  return value.startsWith("sha256:") ? value.slice(7, 7 + length).toUpperCase() : value.slice(0, length).toUpperCase();
}
function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
