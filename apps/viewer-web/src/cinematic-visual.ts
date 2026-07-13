import * as THREE from "three";
import type { CinematicObjectDescriptorView } from "./types";

interface AnimatedLayer {
  group: THREE.Object3D;
  base: THREE.Vector3;
  chronofoldOffset: THREE.Vector3;
  phase: number;
}

interface ProofCurrent {
  curve: THREE.CatmullRomCurve3;
  pulse: THREE.Mesh;
  phase: number;
}

interface MediaSurface {
  material: THREE.MeshBasicMaterial;
  baseOpacity: number;
  phase: number;
}

interface RoomPlan {
  label: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  level: number;
  wing: "olive" | "teal" | "ember";
}

type MansionDescriptor = CinematicObjectDescriptorView & {
  architecture?: { schema?: string };
};

const LOGO_COLORS = ["#9bb568", "#74c8c1", "#d18662"] as const;

const ROOM_PLANS: readonly RoomPlan[] = [
  { label: "grand-foyer", x: 0, z: 1.46, width: 1.02, depth: 0.72, level: 0, wing: "olive" },
  { label: "library", x: -1.15, z: 0.58, width: 0.94, depth: 0.86, level: 0, wing: "olive" },
  { label: "salon", x: 0.92, z: 0.48, width: 1.08, depth: 0.86, level: 0, wing: "olive" },
  { label: "music-room", x: -0.34, z: -0.86, width: 0.98, depth: 0.74, level: 0, wing: "olive" },
  { label: "study", x: 0.88, z: -0.82, width: 0.82, depth: 0.72, level: 0, wing: "olive" },
  { label: "master-suite", x: -0.96, z: 0.38, width: 1.02, depth: 0.78, level: 1, wing: "olive" },
  { label: "dressing-gallery", x: 0.14, z: 0.42, width: 0.86, depth: 0.72, level: 1, wing: "olive" },
  { label: "west-terrace", x: 0.78, z: -0.8, width: 1.14, depth: 0.64, level: 1, wing: "olive" },
  { label: "dining-hall", x: -1.05, z: 0.42, width: 1.1, depth: 0.9, level: 0, wing: "teal" },
  { label: "gallery", x: 0.92, z: 0.45, width: 1.05, depth: 0.84, level: 0, wing: "teal" },
  { label: "kitchen", x: -0.64, z: 1.35, width: 0.96, depth: 0.74, level: 0, wing: "teal" },
  { label: "conservatory", x: 0.72, z: -0.88, width: 1.26, depth: 0.74, level: 0, wing: "teal" },
  { label: "suite-a", x: -0.92, z: 0.32, width: 1.0, depth: 0.74, level: 1, wing: "teal" },
  { label: "suite-b", x: 0.86, z: 0.34, width: 1.0, depth: 0.76, level: 1, wing: "teal" },
  { label: "east-terrace", x: 0.26, z: -0.94, width: 1.34, depth: 0.58, level: 1, wing: "teal" },
  { label: "memory-atrium", x: 0, z: 0.2, width: 1.18, depth: 1.0, level: 0, wing: "ember" },
  { label: "archive", x: -0.72, z: 1.02, width: 0.78, depth: 0.64, level: 0, wing: "ember" },
  { label: "stairs", x: 0.74, z: 1.02, width: 0.54, depth: 0.64, level: 0, wing: "ember" },
  { label: "bridge-hall", x: 0, z: 0.12, width: 1.16, depth: 0.92, level: 1, wing: "ember" },
  { label: "private-archive", x: 0.58, z: 0.98, width: 0.7, depth: 0.58, level: 1, wing: "ember" },
  { label: "observatory", x: 0, z: 0.1, width: 1.04, depth: 0.82, level: 2, wing: "ember" },
];

const WING_BASES: Record<RoomPlan["wing"], { x: number; z: number; color: string; stone: string; roof: string; offset: THREE.Vector3; size: number }> = {
  olive: {
    x: -1.55,
    z: 0.84,
    color: LOGO_COLORS[0],
    stone: "#2d3728",
    roof: "#59683c",
    offset: new THREE.Vector3(-1.1, 0.05, 0.42),
    size: 2.35,
  },
  teal: {
    x: 1.55,
    z: -0.84,
    color: LOGO_COLORS[1],
    stone: "#263c3b",
    roof: "#2f6d6a",
    offset: new THREE.Vector3(1.1, 0.05, -0.42),
    size: 2.35,
  },
  ember: {
    x: 0,
    z: 0,
    color: LOGO_COLORS[2],
    stone: "#4a3028",
    roof: "#6c3c30",
    offset: new THREE.Vector3(0, 0.44, 0),
    size: 1.58,
  },
};

export class CinematicObjectVisual {
  readonly root = new THREE.Group();
  readonly interactive: THREE.Object3D[] = [];
  readonly materials: THREE.Material[] = [];
  readonly radius = 6.35;
  readonly focus = new THREE.Vector3(0, 0.72, 0);

  get phaseCount(): number {
    return this.descriptor.geometry.phase_count;
  }

  get semanticCount(): number {
    return this.descriptor.slbit.statements.length;
  }

  get activeSemanticCount(): number {
    return this.evidenceTarget > 0.5 ? this.semanticCount : 0;
  }

  private readonly descriptor: CinematicObjectDescriptorView;
  private readonly constrained: boolean;
  private readonly video: HTMLVideoElement;
  private readonly videoUrl: string;
  private readonly mediaTexture: THREE.Texture;
  private readonly mediaCanvas: HTMLCanvasElement | null;
  private readonly mediaContext: CanvasRenderingContext2D | null;
  private readonly animatedLayers: AnimatedLayer[] = [];
  private readonly proofCurrents: ProofCurrent[] = [];
  private readonly mediaSurfaces: MediaSurface[] = [];
  private readonly cellField = new THREE.Group();
  private readonly proofField = new THREE.Group();
  private readonly meaningField = new THREE.Group();
  private readonly core = new THREE.Group();
  private chronofoldTarget = 0;
  private chronofold = 0;
  private evidenceTarget = 1;
  private evidence = 1;
  private readyPromise: Promise<void>;
  private reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  private lastMediaFrameAt = -1;
  private softwareTime = 0;
  private softwarePlaying = true;
  private lastSoftwareSeekAt = -1;
  private mansionProfile = false;

  constructor(
    descriptor: CinematicObjectDescriptorView,
    media: Blob,
    constrained: boolean,
  ) {
    this.descriptor = descriptor;
    this.constrained = constrained;
    this.root.name = "cinematic-continuum-object";
    this.root.position.copy(this.focus);
    this.video = document.createElement("video");
    this.video.muted = true;
    this.video.loop = true;
    this.video.playsInline = true;
    this.video.preload = "auto";
    this.video.disablePictureInPicture = true;
    this.videoUrl = URL.createObjectURL(media);
    this.video.src = this.videoUrl;
    if (constrained) {
      this.mediaCanvas = document.createElement("canvas");
      this.mediaCanvas.width = 512;
      this.mediaCanvas.height = 288;
      this.mediaContext = this.mediaCanvas.getContext("2d", { alpha: false });
      if (!this.mediaContext) throw new Error("cinematic fallback canvas unavailable");
      this.mediaTexture = new THREE.CanvasTexture(this.mediaCanvas);
    } else {
      this.mediaCanvas = null;
      this.mediaContext = null;
      this.mediaTexture = new THREE.VideoTexture(this.video);
    }
    this.mediaTexture.colorSpace = THREE.SRGBColorSpace;
    this.mediaTexture.minFilter = THREE.LinearFilter;
    this.mediaTexture.magFilter = THREE.LinearFilter;
    this.mediaTexture.generateMipmaps = false;
    this.readyPromise = new Promise((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new Error("cinematic media metadata timed out")),
        15_000,
      );
      this.video.addEventListener(
        "loadedmetadata",
        () => {
          window.clearTimeout(timer);
          const durationMs = Math.round(this.video.duration * 1_000);
          if (
            this.video.videoWidth !== descriptor.media.width ||
            this.video.videoHeight !== descriptor.media.height ||
            Math.abs(durationMs - descriptor.duration_ms) > 250
          ) {
            reject(new Error("cinematic media metadata does not match its descriptor"));
            return;
          }
          resolve();
        },
        { once: true },
      );
      this.video.addEventListener(
        "error",
        () => {
          window.clearTimeout(timer);
          reject(new Error("cinematic media decoder rejected the committed payload"));
        },
        { once: true },
      );
    });
    this.build(constrained);
    this.video.load();
  }

  async ready(): Promise<void> {
    await this.readyPromise;
    if (!this.reducedMotion && !this.constrained) await this.video.play();
  }

  setCellKey(key: string): void {
    for (const object of this.interactive) object.userData.cellKey = key;
  }

  setChronofold(active: boolean): void {
    this.chronofoldTarget = active ? 1 : 0;
  }

  setEvidence(active: boolean): void {
    this.evidenceTarget = active ? 1 : 0;
  }

  setMoment(id: string): boolean {
    const moment = this.descriptor.moments.find((candidate) => candidate.id === id);
    if (!moment || !Number.isFinite(this.video.duration)) return false;
    const seconds = moment.time_ms / 1_000;
    this.softwareTime = seconds;
    this.video.currentTime = seconds;
    return true;
  }

  setTemporalPosition(value: number): void {
    if (!Number.isFinite(this.video.duration)) return;
    const seconds = THREE.MathUtils.clamp(value, 0, 1) * this.video.duration;
    this.softwareTime = seconds;
    this.video.currentTime = seconds;
  }

  temporalPosition(): number {
    if (!Number.isFinite(this.video.duration) || this.video.duration <= 0) return 0;
    return (this.constrained ? this.softwareTime : this.video.currentTime) / this.video.duration;
  }

  isPlaying(): boolean {
    return this.constrained ? this.softwarePlaying : !this.video.paused;
  }

  async setPlaying(active: boolean): Promise<void> {
    if (this.constrained) {
      this.softwarePlaying = active;
      return;
    }
    if (active) await this.video.play();
    else this.video.pause();
  }

  animate(seconds: number, delta: number, scaleDepth: number): void {
    if (this.constrained && Number.isFinite(this.video.duration) && this.video.duration > 0) {
      if (this.softwarePlaying) this.softwareTime = (this.softwareTime + delta) % this.video.duration;
      if (
        this.lastSoftwareSeekAt < 0 ||
        seconds - this.lastSoftwareSeekAt >= 2 ||
        Math.abs(this.video.currentTime - this.softwareTime) > 2.5
      ) {
        this.video.currentTime = this.softwareTime;
        this.lastSoftwareSeekAt = seconds;
      }
    }
    if (
      this.mediaContext &&
      this.mediaCanvas &&
      this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      (this.lastMediaFrameAt < 0 || seconds - this.lastMediaFrameAt >= 1)
    ) {
      this.mediaContext.drawImage(
        this.video,
        0,
        0,
        this.mediaCanvas.width,
        this.mediaCanvas.height,
      );
      this.mediaTexture.needsUpdate = true;
      this.lastMediaFrameAt = seconds;
    }
    this.chronofold = THREE.MathUtils.damp(
      this.chronofold,
      this.chronofoldTarget,
      this.reducedMotion ? 30 : 4.8,
      delta,
    );
    this.evidence = THREE.MathUtils.damp(this.evidence, this.evidenceTarget, 7, delta);
    const temporal = this.temporalPosition();

    this.animatedLayers.forEach((layer) => {
      const target = layer.base
        .clone()
        .add(layer.chronofoldOffset.clone().multiplyScalar(this.chronofold));
      target.y += Math.sin((temporal + layer.phase) * Math.PI * 2) * (this.mansionProfile ? 0.035 : 0.08);
      layer.group.position.lerp(target, 1 - Math.exp(-delta * 5.8));
    });
    this.mediaSurfaces.forEach((surface) => {
      surface.material.opacity = surface.baseOpacity * this.evidence * (0.72 + 0.28 * Math.sin((temporal + surface.phase) * Math.PI * 2));
    });
    this.proofField.visible = this.evidence > 0.01;
    this.meaningField.visible = this.evidence > 0.01;
    for (const current of this.proofCurrents) {
      const position = (temporal * 1.7 + seconds * 0.025 + current.phase) % 1;
      current.curve.getPointAt(position, current.pulse.position);
      const material = current.pulse.material;
      if (material instanceof THREE.MeshPhongMaterial || material instanceof THREE.MeshBasicMaterial) {
        material.opacity = this.evidence * 0.86;
      }
    }
    if (!this.reducedMotion) {
      this.core.rotation.y += delta * (this.mansionProfile ? 0.06 : 0.04);
      this.cellField.rotation.y += delta * 0.018;
      this.meaningField.rotation.y -= delta * 0.012;
    }
    const compression = THREE.MathUtils.lerp(1, 0.84, Math.max(0, scaleDepth - 0.7) / 0.3);
    this.root.scale.y = THREE.MathUtils.damp(this.root.scale.y, compression, 4, delta);
  }

  destroy(): void {
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    URL.revokeObjectURL(this.videoUrl);
    this.mediaTexture.dispose();
    this.root.traverse((object) => {
      const renderable = object as THREE.Mesh;
      renderable.geometry?.dispose();
      if (!renderable.material) return;
      const values = Array.isArray(renderable.material)
        ? renderable.material
        : [renderable.material];
      values.forEach((material) => material.dispose());
    });
    this.root.clear();
  }

  private build(constrained: boolean): void {
    this.root.add(this.core, this.cellField, this.proofField, this.meaningField);
    this.mansionProfile = this.isGenuineMansionDescriptor();
    if (this.mansionProfile) this.buildGenuineMansion(constrained);
    else this.buildContinuumMonument(constrained);
    this.buildWorldCells(constrained);
    this.buildProofCurrents(constrained);
    this.buildMeaningConstellation(constrained);
    for (const material of this.materials) {
      if ("opacity" in material && material.userData.baseOpacity === undefined) {
        material.userData.baseOpacity = material.opacity;
      }
    }
  }

  private isGenuineMansionDescriptor(): boolean {
    const descriptor = this.descriptor as MansionDescriptor;
    return (
      descriptor.object_id.includes("mansion") ||
      descriptor.object_id.includes("estate") ||
      descriptor.architecture?.schema === "tessaryn/logo-mansion-architecture/v1"
    );
  }

  private material(color: string, constrained: boolean, opacity = 1): THREE.MeshPhongMaterial {
    const material = mineralMaterial(color, constrained, 0.18, 0.46);
    material.transparent = opacity < 0.999;
    material.opacity = opacity;
    this.materials.push(material);
    return material;
  }

  private mediaMaterial(color: string, opacity: number, phase: number): THREE.MeshBasicMaterial {
    const material = new THREE.MeshBasicMaterial({
      map: this.mediaTexture,
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.materials.push(material);
    this.mediaSurfaces.push({ material, baseOpacity: opacity, phase });
    return material;
  }

  private box(
    parent: THREE.Object3D,
    name: string,
    color: string,
    constrained: boolean,
    position: THREE.Vector3,
    scale: THREE.Vector3,
    opacity = 1,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(scale.x, scale.y, scale.z), this.material(color, constrained, opacity));
    mesh.name = name;
    mesh.position.copy(position);
    mesh.castShadow = !constrained;
    mesh.receiveShadow = !constrained;
    parent.add(mesh);
    return mesh;
  }

  private buildGenuineMansion(constrained: boolean): void {
    this.root.name = "cinematic-genuine-tessaryn-mansion";
    const foundation = new THREE.Mesh(
      new THREE.CylinderGeometry(5.2, 5.65, 0.24, 4),
      this.material("#171b14", constrained, 1),
    );
    foundation.rotation.y = Math.PI / 4;
    foundation.position.y = -3.05;
    foundation.receiveShadow = !constrained;
    foundation.name = "genuine-mansion-site-diamond";
    this.root.add(foundation);

    const court = new THREE.Mesh(
      new THREE.CylinderGeometry(4.6, 4.9, 0.08, 4),
      this.material("#2d2a1d", constrained, 0.92),
    );
    court.rotation.y = Math.PI / 4;
    court.position.y = -2.88;
    court.name = "genuine-mansion-rootprint-court";
    this.root.add(court);

    for (const [index, wingName] of (["olive", "teal", "ember"] as const).entries()) {
      const wing = WING_BASES[wingName];
      const group = new THREE.Group();
      group.name = `genuine-${wingName}-inhabitable-wing`;
      group.position.set(wing.x, -0.08, wing.z);
      group.rotation.y = Math.PI / 4;
      this.root.add(group);
      this.animatedLayers.push({
        group,
        base: group.position.clone(),
        chronofoldOffset: wing.offset,
        phase: index / 3,
      });
      this.buildWingShell(group, wingName, constrained);
      this.buildWingRooms(group, wingName, constrained);
      this.buildWingRoof(group, wingName, constrained);
    }

    this.buildAtrium(constrained);
    this.buildMansionLogoFrames(constrained);
    this.buildMansionTraversal(constrained);
  }

  private buildWingShell(
    group: THREE.Group,
    wingName: RoomPlan["wing"],
    constrained: boolean,
  ): void {
    const wing = WING_BASES[wingName];
    const baseMaterial = this.material(wing.stone, constrained, 0.94);
    const floorGeometry = diamondSlabGeometry(wing.size, 0.12);
    for (const level of wingName === "ember" ? [0, 1, 2] : [0, 1]) {
      const floor = new THREE.Mesh(floorGeometry.clone(), baseMaterial);
      floor.name = `genuine-${wingName}-floor-${String(level + 1)}`;
      floor.position.y = -2.32 + level * 0.86;
      floor.receiveShadow = !constrained;
      group.add(floor);
      this.interactive.push(floor);
      const edge = new THREE.Mesh(
        diamondFrameGeometry(wing.size, 0.055, 0.08),
        this.material(wing.color, constrained, 0.98),
      );
      edge.position.y = floor.position.y + 0.08;
      edge.rotation.x = -Math.PI / 2;
      edge.name = `genuine-${wingName}-circulation-ring-${String(level + 1)}`;
      group.add(edge);
    }
  }

  private buildWingRooms(
    group: THREE.Group,
    wingName: RoomPlan["wing"],
    constrained: boolean,
  ): void {
    const wing = WING_BASES[wingName];
    const plans = ROOM_PLANS.filter((room) => room.wing === wingName);
    for (const [index, room] of plans.entries()) {
      const y = -2.17 + room.level * 0.86;
      const floor = this.box(
        group,
        `room-${room.label}-floor`,
        wing.color,
        constrained,
        new THREE.Vector3(room.x, y, room.z),
        new THREE.Vector3(room.width, 0.05, room.depth),
        0.74,
      );
      floor.userData.roomLabel = room.label;
      this.interactive.push(floor);
      const wallColor = room.level === 0 ? wing.stone : wing.roof;
      const wallHeight = 0.46;
      const wallY = y + wallHeight * 0.5 + 0.05;
      this.box(group, `room-${room.label}-north`, wallColor, constrained, new THREE.Vector3(room.x, wallY, room.z - room.depth * 0.5), new THREE.Vector3(room.width, wallHeight, 0.045), 0.96);
      this.box(group, `room-${room.label}-south`, wallColor, constrained, new THREE.Vector3(room.x, wallY, room.z + room.depth * 0.5), new THREE.Vector3(room.width, wallHeight, 0.045), 0.96);
      this.box(group, `room-${room.label}-west`, wallColor, constrained, new THREE.Vector3(room.x - room.width * 0.5, wallY, room.z), new THREE.Vector3(0.045, wallHeight, room.depth), 0.96);
      this.box(group, `room-${room.label}-east`, wallColor, constrained, new THREE.Vector3(room.x + room.width * 0.5, wallY, room.z), new THREE.Vector3(0.045, wallHeight, room.depth), 0.96);
      const pane = new THREE.Mesh(
        new THREE.PlaneGeometry(room.width * 0.72, 0.28),
        this.mediaMaterial(wing.color, 0.25, index / Math.max(1, plans.length)),
      );
      pane.name = `room-${room.label}-memory-window`;
      pane.position.set(room.x, wallY + 0.08, room.z - room.depth * 0.5 - 0.026);
      group.add(pane);
    }
  }

  private buildWingRoof(
    group: THREE.Group, wingName: RoomPlan["wing"], constrained: boolean): void {
    const wing = WING_BASES[wingName];
    const roofLevel = wingName === "ember" ? 0.52 : -0.24;
    const roof = new THREE.Mesh(
      diamondRoofGeometry(wing.size * 0.98, wingName === "ember" ? 1.05 : 0.78),
      this.material(wing.roof, constrained, 0.72),
    );
    roof.name = `genuine-${wingName}-disclosure-roof`;
    roof.position.y = roofLevel;
    roof.castShadow = !constrained;
    group.add(roof);
  }

  private buildAtrium(constrained: boolean): void {
    const atriumMaterial = this.mediaMaterial("#d7d0bd", 0.34, 0.18);
    const atrium = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.82, 2.75, 8), atriumMaterial);
    atrium.name = "genuine-central-memory-atrium";
    atrium.position.y = -1.02;
    atrium.castShadow = !constrained;
    this.core.add(atrium);
    const kernel = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.48, constrained ? 1 : 3),
      this.material("#d7d0bd", constrained, 0.98),
    );
    kernel.name = "genuine-atrium-identity-kernel";
    kernel.position.y = 0.5;
    this.core.add(kernel);
    this.root.add(this.core);
    this.interactive.push(atrium, kernel);
  }

  private buildMansionLogoFrames(constrained: boolean): void {
    const frames = [
      { color: LOGO_COLORS[0], size: 3.15, z: -1.1, y: -0.5, x: -0.7, yaw: 0.05 },
      { color: LOGO_COLORS[1], size: 3.15, z: 1.1, y: -0.46, x: 0.7, yaw: -0.05 },
      { color: LOGO_COLORS[2], size: 2.3, z: 0, y: -0.1, x: 0, yaw: 0.12 },
    ];
    frames.forEach((frame, index) => {
      const portal = new THREE.Group();
      portal.position.set(frame.x, frame.y, frame.z);
      portal.rotation.y = frame.yaw;
      const mesh = new THREE.Mesh(
        diamondFrameGeometry(frame.size, frame.size * 0.05, 0.12),
        this.material(frame.color, constrained, 0.95),
      );
      mesh.name = `genuine-logo-architectural-portal-${String(index + 1)}`;
      portal.add(mesh);
      this.root.add(portal);
      this.interactive.push(mesh);
      this.animatedLayers.push({
        group: portal,
        base: portal.position.clone(),
        chronofoldOffset: new THREE.Vector3((index - 1) * 0.65, index === 2 ? 0.32 : 0.08, (index - 1) * 0.9),
        phase: index / 3,
      });
    });
  }

  private buildMansionTraversal(constrained: boolean): void {
    const points = [
      new THREE.Vector3(-3.1, -2.08, 1.95),
      new THREE.Vector3(-1.9, -2.04, 1.12),
      new THREE.Vector3(-0.66, -1.18, 0.55),
      new THREE.Vector3(0.1, -0.32, 0.05),
      new THREE.Vector3(0.92, -1.18, -0.52),
      new THREE.Vector3(2.35, -2.03, -1.22),
      new THREE.Vector3(0.05, 0.42, 0.05),
    ];
    const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
    const path = new THREE.Mesh(
      new THREE.TubeGeometry(curve, constrained ? 40 : 96, 0.022, 7, false),
      this.material("#d0ad64", constrained, 0.9),
    );
    path.name = "genuine-whole-home-continuum-path";
    this.proofField.add(path);
    this.proofCurrents.push({
      curve,
      pulse: new THREE.Mesh(
        new THREE.SphereGeometry(0.09, constrained ? 8 : 14, constrained ? 6 : 10),
        this.material("#f0d899", constrained, 0.95),
      ),
      phase: 0.15,
    });
    this.proofField.add(this.proofCurrents[0]!.pulse);
  }

  private buildContinuumMonument(constrained: boolean): void {
    const foundation = new THREE.Mesh(
      new THREE.CylinderGeometry(4.45, 4.72, 0.2, 4),
      this.material("#151712", constrained, 1),
    );
    foundation.position.y = -3.06;
    foundation.rotation.y = Math.PI / 4;
    foundation.receiveShadow = !constrained;
    foundation.name = "cinematic-memory-foundation";
    this.root.add(foundation);

    const floor = new THREE.Mesh(
      new THREE.CylinderGeometry(3.94, 4.08, 0.07, 4),
      this.material("#292820", constrained, 1),
    );
    floor.position.y = -2.91;
    floor.rotation.y = Math.PI / 4;
    floor.name = "cinematic-cell-floor";
    this.root.add(floor);

    const frames = [
      { x: -0.38, y: 0.28, z: -2.05, size: 2.42, color: "#444b35", yaw: 0.06 },
      { x: 0.38, y: -0.28, z: 0, size: 2.42, color: "#31504c", yaw: -0.08 },
      { x: 0.12, y: 0.2, z: 2.05, size: 1.74, color: "#633f34", yaw: 0.16 },
    ];
    frames.forEach((frame, index) => {
      const group = new THREE.Group();
      group.position.set(frame.x, frame.y, frame.z);
      group.rotation.y = frame.yaw;
      const frameMesh = new THREE.Mesh(
        diamondFrameGeometry(frame.size, frame.size * 0.065, 0.14),
        this.material(frame.color, constrained, 1),
      );
      frameMesh.name = `cinematic-identity-portal-${String(index + 1)}`;
      group.add(frameMesh);
      this.core.add(group);
      this.interactive.push(frameMesh);
    });

    const leafCount = constrained ? (innerWidth <= 680 ? 3 : 4) : 12;
    for (let index = 0; index < leafCount; index += 1) {
      const phase = index / leafCount;
      const material = this.mediaMaterial(
        ["#9eae73", "#6faeaa", "#b97a5e", "#d7d0bd"][index % 4] ?? "#d7d0bd",
        constrained ? 0.22 : 0.32,
        phase,
      );
      const leaf = new THREE.Mesh(new THREE.PlaneGeometry(1.52, 3.15, constrained ? 4 : 12, 1), material);
      const angle = phase * Math.PI * 1.72 - Math.PI * 0.86;
      leaf.position.set(Math.sin(angle) * 0.72, 0.02, Math.cos(angle) * 0.72);
      leaf.rotation.y = angle;
      leaf.name = "cinematic-memory-lamination";
      this.core.add(leaf);
    }
    const coreGeometry = new THREE.IcosahedronGeometry(0.92, constrained ? 1 : 3);
    const memoryCore = new THREE.Mesh(coreGeometry, this.mediaMaterial("#d7d0bd", 0.82, 0.2));
    memoryCore.scale.set(0.7, 1.32, 0.7);
    memoryCore.name = "cinematic-temporal-core";
    this.core.add(memoryCore);
    this.interactive.push(memoryCore);
    this.root.add(this.core);

    for (let index = 0; index < Math.min(this.descriptor.geometry.shell_count, constrained ? 3 : 6); index += 1) {
      const shell = new THREE.Mesh(
        diamondFrameGeometry(1.08 + index * 0.3, 0.026, 0.018),
        new THREE.MeshBasicMaterial({
          color: ["#5d6952", "#78694e", "#456d69", "#775247"][index % 4] ?? "#775247",
          transparent: true,
          opacity: 0.055 + index * 0.014,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      shell.position.z = -0.36 + index * 0.24;
      shell.name = "cinematic-temporal-section";
      this.core.add(shell);
      this.materials.push(shell.material as THREE.Material);
      this.animatedLayers.push({
        group: shell,
        base: shell.position.clone(),
        chronofoldOffset: new THREE.Vector3((index - 2) * 0.75, 0, Math.abs(index - 2) * 0.12),
        phase: index / Math.max(1, this.descriptor.geometry.shell_count),
      });
    }
  }

  private buildWorldCells(constrained: boolean): void {
    const count = Math.min(this.descriptor.geometry.cell_count, this.mansionProfile ? 108 : 96);
    const geometry = new THREE.OctahedronGeometry(constrained ? 0.055 : 0.075, 0);
    const material = this.material("#d4d2c5", constrained, 0.88);
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    const random = seededRandom(this.descriptor.geometry.seed);
    const colors = LOGO_COLORS.map((color) => new THREE.Color(color));
    for (let index = 0; index < count; index += 1) {
      if (this.mansionProfile && index < ROOM_PLANS.length) {
        const room = ROOM_PLANS[index]!;
        const wing = WING_BASES[room.wing];
        const rotated = new THREE.Vector3(room.x, -2.02 + room.level * 0.86, room.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);
        position.set(wing.x + rotated.x, rotated.y + 0.44, wing.z + rotated.z);
      } else {
        const u = (index + 0.5) / count;
        const theta = u * Math.PI * (this.mansionProfile ? 8 : 4.4);
        const radial = this.mansionProfile ? 4.1 + Math.sin(u * Math.PI * 6) * 0.25 : 1.05 + Math.sin(u * Math.PI) * 0.34;
        position.set(Math.cos(theta) * radial, (u - 0.5) * (this.mansionProfile ? 2.5 : 3.8), Math.sin(theta) * radial);
      }
      quaternion.setFromEuler(new THREE.Euler(index * 0.07, index * 0.13, index * 0.05));
      scale.setScalar(0.72 + random() * 0.58);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, colors[index % colors.length] ?? colors[0]!);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.needsUpdate = true;
    mesh.name = this.mansionProfile ? "genuine-mansion-world-cell-field" : "cinematic-world-cell-field";
    this.cellField.add(mesh);
    this.interactive.push(mesh);
  }

  private buildProofCurrents(constrained: boolean): void {
    if (this.proofCurrents.length > 0) return;
    const count = constrained ? 3 : 8;
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2;
      const radius = this.mansionProfile ? 4.35 : 3.1;
      const points = [
        new THREE.Vector3(Math.cos(angle) * radius, -2.6, Math.sin(angle) * radius),
        new THREE.Vector3(Math.cos(angle + 0.28) * (radius * 0.75), -0.4, Math.sin(angle + 0.28) * (radius * 0.75)),
        new THREE.Vector3(Math.cos(angle + 0.56) * radius, 1.85, Math.sin(angle + 0.56) * radius),
      ];
      const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
      const line = new THREE.Mesh(
        new THREE.TubeGeometry(curve, constrained ? 24 : 54, 0.01, 5, false),
        new THREE.MeshBasicMaterial({
          color: LOGO_COLORS[index % LOGO_COLORS.length] ?? LOGO_COLORS[0],
          transparent: true,
          opacity: 0.26,
          depthWrite: false,
        }),
      );
      const pulse = new THREE.Mesh(
        new THREE.SphereGeometry(0.045, constrained ? 6 : 10, constrained ? 5 : 8),
        this.material(LOGO_COLORS[index % LOGO_COLORS.length] ?? LOGO_COLORS[0], constrained, 0.86),
      );
      this.proofField.add(line, pulse);
      this.materials.push(line.material as THREE.Material);
      this.proofCurrents.push({ curve, pulse, phase: index / count });
    }
  }

  private buildMeaningConstellation(constrained: boolean): void {
    const count = Math.max(1, this.descriptor.slbit.statements.length);
    const geometry = new THREE.DodecahedronGeometry(constrained ? 0.055 : 0.075, 0);
    const material = this.material("#d7d0bd", constrained, 0.78);
    const radius = this.mansionProfile ? 4.8 : 2.25;
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2;
      const point = new THREE.Mesh(geometry.clone(), material);
      point.name = "cinematic-slbit-meaning-node";
      point.position.set(Math.cos(angle) * radius, 1.45 + Math.sin(index) * 0.16, Math.sin(angle) * radius);
      this.meaningField.add(point);
    }
  }
}

function diamondFrameGeometry(size: number, thickness: number, depth: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, size);
  shape.lineTo(size, 0);
  shape.lineTo(0, -size);
  shape.lineTo(-size, 0);
  shape.closePath();
  const hole = new THREE.Path();
  const inner = size - thickness;
  hole.moveTo(0, inner);
  hole.lineTo(inner, 0);
  hole.lineTo(0, -inner);
  hole.lineTo(-inner, 0);
  hole.closePath();
  shape.holes.push(hole);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: Math.min(0.06, thickness * 0.2),
    bevelThickness: 0.045,
    curveSegments: 4,
    steps: 1,
  });
  geometry.translate(0, 0, -depth * 0.5);
  geometry.computeVertexNormals();
  return geometry;
}

function diamondSlabGeometry(size: number, height: number): THREE.BufferGeometry {
  const vertices = [
    new THREE.Vector3(0, 0, size),
    new THREE.Vector3(size, 0, 0),
    new THREE.Vector3(0, 0, -size),
    new THREE.Vector3(-size, 0, 0),
    new THREE.Vector3(0, height, size),
    new THREE.Vector3(size, height, 0),
    new THREE.Vector3(0, height, -size),
    new THREE.Vector3(-size, height, 0),
  ];
  const faces = [
    [0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6],
    [0, 4, 5], [0, 5, 1], [1, 5, 6], [1, 6, 2],
    [2, 6, 7], [2, 7, 3], [3, 7, 4], [3, 4, 0],
  ];
  const positions = faces.flatMap((face) => face.flatMap((index) => vertices[index]!.toArray()));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function diamondRoofGeometry(size: number, height: number): THREE.BufferGeometry {
  const apex = new THREE.Vector3(0, height, 0);
  const corners = [
    new THREE.Vector3(0, 0, size),
    new THREE.Vector3(size, 0, 0),
    new THREE.Vector3(0, 0, -size),
    new THREE.Vector3(-size, 0, 0),
  ];
  const positions: number[] = [];
  for (let index = 0; index < corners.length; index += 1) {
    positions.push(...apex.toArray(), ...corners[index]!.toArray(), ...corners[(index + 1) % corners.length]!.toArray());
  }
  positions.push(...corners[0]!.toArray(), ...corners[2]!.toArray(), ...corners[1]!.toArray());
  positions.push(...corners[0]!.toArray(), ...corners[3]!.toArray(), ...corners[2]!.toArray());
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function mineralMaterial(
  color: string,
  _constrained: boolean,
  _metalness: number,
  roughness: number,
): THREE.MeshPhongMaterial {
  const base = new THREE.Color(color);
  return new THREE.MeshPhongMaterial({
    color,
    emissive: base.clone().multiplyScalar(0.05),
    specular: base.clone().lerp(new THREE.Color("#c8bea2"), 0.24),
    shininess: Math.round(14 + (1 - roughness) * 38),
  });
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let output = value;
    output = Math.imul(output ^ (output >>> 15), output | 1);
    output ^= output + Math.imul(output ^ (output >>> 7), output | 61);
    return ((output ^ (output >>> 14)) >>> 0) / 4_294_967_296;
  };
}
