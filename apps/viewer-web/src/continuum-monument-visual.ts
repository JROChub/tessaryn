import * as THREE from "three";
import type { CinematicObjectDescriptorView } from "./types";

interface TemporalLayer {
  group: THREE.Object3D;
  basePosition: THREE.Vector3;
  phase: number;
  material: THREE.Material;
}

interface ProofCurrent {
  curve: THREE.CatmullRomCurve3;
  pulse: THREE.Mesh;
  phase: number;
}

interface MomentPhase {
  group: THREE.Group;
  target: THREE.Vector3;
  materials: THREE.Material[];
}

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
  private readonly shaders: THREE.ShaderMaterial[] = [];
  private readonly temporalLayers: TemporalLayer[] = [];
  private readonly proofCurrents: ProofCurrent[] = [];
  private readonly momentPhases: MomentPhase[] = [];
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

  constructor(
    descriptor: CinematicObjectDescriptorView,
    media: Blob,
    constrained: boolean,
  ) {
    this.descriptor = descriptor;
    this.constrained = constrained;
    this.root.name = "cinematic-continuum-monument";
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
      if (this.softwarePlaying) {
        this.softwareTime = (this.softwareTime + delta) % this.video.duration;
      }
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
    this.evidence = THREE.MathUtils.damp(
      this.evidence,
      this.evidenceTarget,
      7,
      delta,
    );
    const temporal = this.temporalPosition();
    for (const shader of this.shaders) {
      shader.uniforms.time!.value = seconds;
      shader.uniforms.temporal!.value = temporal;
      shader.uniforms.evidence!.value = this.evidence;
    }
    this.temporalLayers.forEach((layer, index) => {
      const direction = index - (this.temporalLayers.length - 1) * 0.5;
      const target = layer.basePosition.clone();
      target.x += direction * 2.4 * this.chronofold;
      target.z += Math.abs(direction) * 0.36 * this.chronofold;
      target.y += Math.sin((temporal + layer.phase) * Math.PI * 2) * 0.08;
      layer.group.position.lerp(target, 1 - Math.exp(-delta * 5.5));
      const scale = 1 + this.chronofold * (0.03 + Math.abs(direction) * 0.035);
      layer.group.scale.setScalar(
        THREE.MathUtils.damp(layer.group.scale.x, scale, 5.5, delta),
      );
      if ("opacity" in layer.material) {
        layer.material.transparent = true;
        layer.material.opacity =
          (0.26 + (index === 1 ? 0.22 : 0.08)) * (0.78 + this.chronofold * 0.22);
      }
    });
    this.momentPhases.forEach((phase) => {
      phase.group.visible = this.chronofold > 0.005;
      phase.group.position.lerp(
        phase.target.clone().multiplyScalar(this.chronofold),
        1 - Math.exp(-delta * 6.2),
      );
      const targetScale = 0.08 + this.chronofold * 0.92;
      phase.group.scale.setScalar(
        THREE.MathUtils.damp(phase.group.scale.x, targetScale, 6.2, delta),
      );
      for (const material of phase.materials) {
        if (material instanceof THREE.ShaderMaterial && material.uniforms.opacity) {
          material.uniforms.opacity.value =
            this.chronofold * Number(material.userData.baseOpacity ?? 1);
        } else if ("opacity" in material) {
          material.transparent = true;
          material.opacity =
            this.chronofold * Number(material.userData.baseOpacity ?? 1);
        }
      }
    });
    this.proofField.visible = this.evidence > 0.01;
    this.meaningField.visible = this.evidence > 0.01;
    for (const current of this.proofCurrents) {
      const position = (temporal * 1.7 + seconds * 0.025 + current.phase) % 1;
      current.curve.getPointAt(position, current.pulse.position);
      const material = current.pulse.material;
      if (material instanceof THREE.MeshStandardMaterial) {
        material.opacity = this.evidence * 0.86;
      }
    }
    if (!this.reducedMotion) {
      this.core.rotation.y = Math.sin(seconds * 0.075) * 0.09;
      this.core.rotation.x = Math.sin(seconds * 0.043) * 0.035;
      this.cellField.rotation.y = seconds * 0.018;
      this.meaningField.rotation.y = -seconds * 0.012;
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
    this.buildChamber(constrained);
    this.buildEnvelope(constrained);
    this.buildLogoArchitecture(constrained);
    this.buildTemporalMatter(constrained);
    this.buildWorldCells(constrained);
    this.buildProofCurrents(constrained);
    this.buildMeaningConstellation(constrained);
    for (const material of this.materials) {
      if ("opacity" in material && material.userData.baseOpacity === undefined) {
        material.userData.baseOpacity = material.opacity;
      }
    }
  }

  private buildChamber(constrained: boolean): void {
    const foundationMaterial = mineralMaterial("#151712", constrained, 0.12, 0.74);
    const foundation = new THREE.Mesh(
      new THREE.CylinderGeometry(4.45, 4.72, 0.2, 4),
      foundationMaterial,
    );
    foundation.position.y = -3.06;
    foundation.rotation.y = Math.PI / 4;
    foundation.receiveShadow = !constrained;
    foundation.name = "cinematic-memory-foundation";
    this.root.add(foundation);
    this.materials.push(foundationMaterial);

    const floorMaterial = mineralMaterial("#292820", constrained, 0.18, 0.52);
    const floor = new THREE.Mesh(
      new THREE.CylinderGeometry(3.94, 4.08, 0.07, 4),
      floorMaterial,
    );
    floor.position.y = -2.91;
    floor.rotation.y = Math.PI / 4;
    floor.receiveShadow = !constrained;
    floor.name = "cinematic-cell-floor";
    this.root.add(floor);
    this.materials.push(floorMaterial);

    const inlayMaterial = mineralMaterial("#7d745c", constrained, 0.48, 0.32);
    if (constrained) {
      const points: THREE.Vector3[] = [];
      for (const size of [1.25, 2.18, 3.16]) {
        const corners = [
          new THREE.Vector3(0, -2.86, size),
          new THREE.Vector3(size, -2.86, 0),
          new THREE.Vector3(0, -2.86, -size),
          new THREE.Vector3(-size, -2.86, 0),
        ];
        for (let index = 0; index < corners.length; index += 1) {
          points.push(corners[index]!, corners[(index + 1) % corners.length]!);
        }
      }
      const inlays = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: "#7d745c", transparent: true, opacity: 0.68 }),
      );
      inlays.name = "cinematic-floor-lineage-inlay";
      this.root.add(inlays);
      this.materials.push(inlays.material);
    } else {
      for (const size of [1.25, 2.18, 3.16]) {
        const inlay = new THREE.Mesh(
          diamondFrameGeometry(size, 0.028, 0.022),
          inlayMaterial,
        );
        inlay.position.y = -2.86;
        inlay.rotation.x = -Math.PI / 2;
        inlay.name = "cinematic-floor-lineage-inlay";
        this.root.add(inlay);
      }
    }
    this.materials.push(inlayMaterial);

    const columnMaterial = mineralMaterial("#33342e", constrained, 0.3, 0.36);
    const columnGeometry = new THREE.CylinderGeometry(0.11, 0.2, 3.2, 4);
    const columns = new THREE.InstancedMesh(columnGeometry, columnMaterial, 4);
    const columnMatrix = new THREE.Matrix4();
    const columnQuaternion = new THREE.Quaternion();
    const columnScale = new THREE.Vector3(1, 1, 1);
    const perimeter = [
      [-3.15, 0],
      [0, 3.15],
      [3.15, 0],
      [0, -3.15],
    ];
    perimeter.forEach(([x, z], index) => {
      columnQuaternion.setFromEuler(new THREE.Euler(0, Math.PI / 4 + index * 0.19, 0));
      columnMatrix.compose(
        new THREE.Vector3(x, -1.28, z),
        columnQuaternion,
        columnScale,
      );
      columns.setMatrixAt(index, columnMatrix);
    });
    columns.instanceMatrix.needsUpdate = true;
    columns.castShadow = !constrained;
    columns.name = "cinematic-anchor-colonnade";
    this.root.add(columns);
    this.materials.push(columnMaterial);

    const wallMaterial = mineralMaterial("#242720", constrained, 0.16, 0.7);
    const wallGeometry = new THREE.BoxGeometry(1, 1, 1);
    const walls = new THREE.InstancedMesh(wallGeometry, wallMaterial, 8);
    const glassMaterial = new THREE.MeshBasicMaterial({
      color: "#34504c",
      transparent: true,
      opacity: constrained ? 0.18 : 0.24,
      depthWrite: false,
    });
    const windows = new THREE.InstancedMesh(wallGeometry, glassMaterial, 8);
    const wallCorners = [
      new THREE.Vector3(0, 0, 3.38),
      new THREE.Vector3(3.38, 0, 0),
      new THREE.Vector3(0, 0, -3.38),
      new THREE.Vector3(-3.38, 0, 0),
    ];
    let segmentIndex = 0;
    for (let edge = 0; edge < wallCorners.length; edge += 1) {
      const edgeStart = wallCorners[edge]!;
      const edgeEnd = wallCorners[(edge + 1) % wallCorners.length]!;
      for (const [from, to] of [[0, 0.37], [0.63, 1]] as const) {
        const start = edgeStart.clone().lerp(edgeEnd, from);
        const end = edgeStart.clone().lerp(edgeEnd, to);
        const direction = end.clone().sub(start);
        const length = direction.length();
        const angle = -Math.atan2(direction.z, direction.x);
        const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, 0));
        const midpoint = start.clone().add(end).multiplyScalar(0.5);
        wallMatrix(
          new THREE.Vector3(midpoint.x, -2.3, midpoint.z),
          rotation,
          new THREE.Vector3(length, 1.06, 0.18),
          columnMatrix,
        );
        walls.setMatrixAt(segmentIndex, columnMatrix);
        wallMatrix(
          new THREE.Vector3(midpoint.x, -1.18, midpoint.z),
          rotation,
          new THREE.Vector3(length, 1.04, 0.065),
          columnMatrix,
        );
        windows.setMatrixAt(segmentIndex, columnMatrix);
        segmentIndex += 1;
      }
    }
    walls.instanceMatrix.needsUpdate = true;
    windows.instanceMatrix.needsUpdate = true;
    walls.name = "cinematic-inhabitable-cell-walls";
    windows.name = "cinematic-disclosure-boundary";
    this.root.add(walls, windows);
    this.materials.push(wallMaterial, glassMaterial);

    const stepMaterial = mineralMaterial("#34342b", constrained, 0.2, 0.62);
    const stepGeometry = new THREE.BoxGeometry(1, 1, 1);
    const steps = new THREE.InstancedMesh(stepGeometry, stepMaterial, 3);
    for (let index = 0; index < 3; index += 1) {
      columnMatrix.compose(
        new THREE.Vector3(0, -2.91 + index * 0.1, 3.65 + index * 0.3),
        new THREE.Quaternion(),
        new THREE.Vector3(1.45 + index * 0.34, 0.11, 0.44),
      );
      steps.setMatrixAt(index, columnMatrix);
    }
    steps.instanceMatrix.needsUpdate = true;
    steps.name = "cinematic-origin-threshold";
    this.root.add(steps);
    this.materials.push(stepMaterial);

    const warm = new THREE.PointLight("#c8a36f", constrained ? 2.1 : 3.4, 15, 1.8);
    warm.position.set(-3.8, 3.8, 3.6);
    const cool = new THREE.PointLight("#6f9992", constrained ? 1.8 : 2.8, 14, 1.9);
    cool.position.set(3.8, 1.4, -3.2);
    const interior = new THREE.PointLight("#d8c9a5", constrained ? 1.7 : 2.5, 8, 2.1);
    interior.position.set(0, 0.2, 0.8);
    this.root.add(warm, cool, interior);
  }

  private buildEnvelope(constrained: boolean): void {
    const lower = [
      new THREE.Vector3(0, -2.84, 3.72),
      new THREE.Vector3(3.72, -2.84, 0),
      new THREE.Vector3(0, -2.84, -3.72),
      new THREE.Vector3(-3.72, -2.84, 0),
    ];
    const shoulder = [
      new THREE.Vector3(0, 0.62, 2.76),
      new THREE.Vector3(2.76, 0.62, 0),
      new THREE.Vector3(0, 0.62, -2.76),
      new THREE.Vector3(-2.76, 0.62, 0),
    ];
    const crown = [
      new THREE.Vector3(0, 2.75, 1.08),
      new THREE.Vector3(1.08, 2.75, 0),
      new THREE.Vector3(0, 2.75, -1.08),
      new THREE.Vector3(-1.08, 2.75, 0),
    ];

    const wallMaterial = new THREE.MeshBasicMaterial({
      color: "#26312d",
      transparent: true,
      opacity: constrained ? 0.12 : 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const roofMaterial = new THREE.MeshBasicMaterial({
      color: "#4e4b3b",
      transparent: true,
      opacity: constrained ? 0.14 : 0.19,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const wallQuads: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [];
    for (const index of [1, 3]) {
      const next = (index + 1) % 4;
      wallQuads.push([lower[index]!, lower[next]!, shoulder[next]!, shoulder[index]!]);
    }
    const wall = new THREE.Mesh(quadsGeometry(wallQuads), wallMaterial);
    wall.name = "cinematic-private-envelope";
    this.root.add(wall);

    const roofQuads: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [];
    for (let index = 0; index < 4; index += 1) {
      const next = (index + 1) % 4;
      roofQuads.push([shoulder[index]!, shoulder[next]!, crown[next]!, crown[index]!]);
    }
    const roof = new THREE.Mesh(quadsGeometry(roofQuads), roofMaterial);
    roof.name = "cinematic-temporal-roof";
    this.root.add(roof);

    const edgeMaterial = new THREE.LineBasicMaterial({
      color: "#4d5043",
      transparent: true,
      opacity: 0.72,
    });
    const edgePoints: THREE.Vector3[] = [];
    for (let index = 0; index < 4; index += 1) {
      edgePoints.push(lower[index]!, shoulder[index]!, shoulder[index]!, crown[index]!);
    }
    const edges = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(edgePoints),
      edgeMaterial,
    );
    edges.name = "cinematic-envelope-edge";
    this.root.add(edges);
    this.materials.push(wallMaterial, roofMaterial, edgeMaterial);
  }

  private buildLogoArchitecture(constrained: boolean): void {
    const frames = [
      { x: -0.38, y: 0.28, z: -2.05, size: 2.42, color: "#444b35", yaw: 0.06 },
      { x: 0.38, y: -0.28, z: 0, size: 2.42, color: "#31504c", yaw: -0.08 },
      { x: 0.12, y: 0.2, z: 2.05, size: 1.74, color: "#633f34", yaw: 0.16 },
    ];
    frames.forEach((frame, index) => {
      const group = new THREE.Group();
      group.position.set(frame.x, frame.y, frame.z);
      group.rotation.y = frame.yaw;
      const geometry = diamondFrameGeometry(frame.size, frame.size * 0.065, 0.14);
      const material = mineralMaterial(frame.color, constrained, 0.32, 0.42);
      const frameMesh = new THREE.Mesh(geometry, material);
      frameMesh.castShadow = !constrained;
      frameMesh.receiveShadow = !constrained;
      frameMesh.name = `cinematic-identity-portal-${String(index + 1)}`;
      group.add(frameMesh);
      this.interactive.push(frameMesh);
      this.materials.push(material);
      this.core.add(group);
    });

    const spineMaterial = new THREE.LineBasicMaterial({
      color: "#77715f",
      transparent: true,
      opacity: 0.76,
    });
    const portalCorners = [
      new THREE.Vector3(0, 2.42, -2.05),
      new THREE.Vector3(2.42, 0, -2.05),
      new THREE.Vector3(0, -2.42, -2.05),
      new THREE.Vector3(-2.42, 0, -2.05),
    ];
    const spinePoints: THREE.Vector3[] = [];
    portalCorners.forEach((start, index) => {
      const end = start.clone();
      end.z = 2.05;
      end.x *= index % 2 === 0 ? 0.72 : 0.78;
      end.y *= index % 2 === 0 ? 0.78 : 0.72;
      spinePoints.push(start, end);
    });
    const spines = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(spinePoints),
      spineMaterial,
    );
    spines.name = "cinematic-lineage-spine";
    this.core.add(spines);
    this.materials.push(spineMaterial);

    const leafCount = constrained ? (innerWidth <= 680 ? 3 : 4) : 13;
    for (let index = 0; index < leafCount; index += 1) {
      const phase = index / leafCount;
      const geometry = new THREE.PlaneGeometry(1.52, 3.15, constrained ? 6 : 18, 1);
      const positions = geometry.attributes.position as THREE.BufferAttribute;
      for (let vertex = 0; vertex < positions.count; vertex += 1) {
        const x = positions.getX(vertex);
        positions.setZ(vertex, Math.sin((x / 1.52 + 0.5) * Math.PI) * 0.22);
      }
      geometry.computeVertexNormals();
      const leafMaterial = this.createCinematicMaterial(
        ["#9eae73", "#6faeaa", "#b97a5e", "#d7d0bd"][index % 4] ?? "#d7d0bd",
        constrained ? 0.22 : 0.3,
        phase,
      );
      const leaf = new THREE.Mesh(geometry, leafMaterial);
      const angle = phase * Math.PI * 1.72 - Math.PI * 0.86;
      leaf.position.set(Math.sin(angle) * 0.72, 0.02, Math.cos(angle) * 0.72);
      leaf.rotation.y = angle;
      leaf.rotation.z = (index - (leafCount - 1) * 0.5) * 0.012;
      leaf.name = "cinematic-memory-lamination";
      this.core.add(leaf);
      this.materials.push(leafMaterial);
    }

    const coreMaterial = this.createCinematicMaterial("#d7d0bd", 1, 0.2);
    const coreGeometry = new THREE.IcosahedronGeometry(0.92, constrained ? 2 : 4);
    const memoryCore = new THREE.Mesh(coreGeometry, coreMaterial);
    memoryCore.scale.set(0.7, 1.32, 0.7);
    memoryCore.name = "cinematic-temporal-core";
    memoryCore.castShadow = !constrained;
    this.core.add(memoryCore);
    this.interactive.push(memoryCore);
    this.materials.push(coreMaterial);

    const innerMaterial = mineralMaterial("#c4b89a", constrained, 0.62, 0.18);
    const inner = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.42, constrained ? 1 : 2),
      innerMaterial,
    );
    inner.name = "cinematic-identity-kernel";
    this.core.add(inner);
    this.interactive.push(inner);
    this.materials.push(inner.material);
  }

  private buildTemporalMatter(constrained: boolean): void {
    const shells = Math.min(this.descriptor.geometry.shell_count, constrained ? 3 : 6);
    for (let index = 0; index < shells; index += 1) {
      const phase = index / shells;
      const material = new THREE.MeshBasicMaterial({
        color: ["#5d6952", "#78694e", "#456d69", "#775247"][index % 4],
        transparent: true,
        opacity: 0.055 + index * 0.014,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const shell = new THREE.Mesh(
        diamondFrameGeometry(1.08 + index * 0.3, 0.026, 0.018),
        material,
      );
      shell.position.z = -0.36 + index * 0.24;
      shell.rotation.z = (index - (shells - 1) * 0.5) * 0.035;
      shell.name = "cinematic-temporal-section";
      this.core.add(shell);
      this.materials.push(material);
      this.temporalLayers.push({
        group: shell,
        basePosition: shell.position.clone(),
        phase,
        material,
      });
    }

    const phaseCount = Math.min(this.descriptor.geometry.phase_count, 4);
    for (let index = 0; index < phaseCount; index += 1) {
      const group = new THREE.Group();
      group.visible = false;
      group.scale.setScalar(0.08);
      const frameMaterial = mineralMaterial(
        ["#68744a", "#426a67", "#754b3c", "#a89a78"][index] ?? "#a89a78",
        constrained,
        0.42,
        0.27,
      );
      frameMaterial.transparent = true;
      frameMaterial.opacity = 0;
      frameMaterial.userData.baseOpacity = 0.86;
      const frame = new THREE.Mesh(diamondFrameGeometry(0.74, 0.075, 0.07), frameMaterial);
      const coreMaterial = new THREE.MeshBasicMaterial({
        color: ["#68744a", "#426a67", "#754b3c", "#a89a78"][index] ?? "#a89a78",
        transparent: true,
        opacity: 0,
      });
      coreMaterial.userData.baseOpacity = 0.78;
      const kernel = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.32, constrained ? 1 : 2),
        coreMaterial,
      );
      kernel.scale.set(0.72, 1.08, 0.72);
      group.add(frame, kernel);
      this.core.add(group);
      this.momentPhases.push({
        group,
        target: new THREE.Vector3(
          (index - (phaseCount - 1) * 0.5) * 2.2,
          2.72 - Math.abs(index - 1.5) * 0.2,
          -1.55,
        ),
        materials: [frameMaterial, coreMaterial],
      });
      this.materials.push(frameMaterial, coreMaterial);
    }

    const ribbons = Math.min(
      this.descriptor.geometry.ribbon_count,
      constrained ? (innerWidth <= 680 ? 1 : 2) : 5,
    );
    for (let index = 0; index < ribbons; index += 1) {
      const offset = index - (ribbons - 1) * 0.5;
      const points = [
        new THREE.Vector3(offset * 1.1, -2.78, 3.25),
        new THREE.Vector3(offset * 0.72, -1.7, 1.72),
        new THREE.Vector3(offset * 0.2, -0.15, 0.48),
        new THREE.Vector3(-offset * 0.16, 0.32, -0.45),
        new THREE.Vector3(-offset * 0.78, 1.62, -2.42),
      ];
      const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
      const material = new THREE.MeshBasicMaterial({
        color: ["#656b49", "#406a65", "#70483d", "#81775e"][index % 4] ?? "#81775e",
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
      });
      const ribbon = new THREE.Mesh(
        new THREE.TubeGeometry(curve, constrained ? 30 : 80, 0.012 + index * 0.002, 5, false),
        material,
      );
      ribbon.name = "cinematic-memory-channel";
      this.core.add(ribbon);
      this.materials.push(material);
    }
  }

  private buildWorldCells(constrained: boolean): void {
    const count = Math.min(this.descriptor.geometry.cell_count, 96);
    const geometry = new THREE.OctahedronGeometry(constrained ? 0.07 : 0.085, 0);
    const material = constrained
      ? new THREE.MeshPhongMaterial({
          color: "#d0ccba",
          specular: "#706b58",
          shininess: 34,
          vertexColors: true,
        })
      : new THREE.MeshStandardMaterial({
          color: "#d4d2c5",
          roughness: 0.34,
          metalness: 0.34,
          envMapIntensity: 0.24,
          vertexColors: true,
        });
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    const random = seededRandom(this.descriptor.geometry.seed);
    const colors = [
      new THREE.Color("#aeb88a"),
      new THREE.Color("#86aaa4"),
      new THREE.Color("#b38773"),
      new THREE.Color("#d4cfbd"),
    ];
    for (let index = 0; index < count; index += 1) {
      if (index < 36) {
        const portal = index % 3;
        const step = Math.floor(index / 3);
        const point = diamondPerimeterPoint((step + 0.5) / 12, [2.42, 2.42, 1.74][portal]!);
        position.set(
          point.x + [-0.38, 0.38, 0.12][portal]!,
          point.y + [0.28, -0.28, 0.2][portal]!,
          [-2.05, 0, 2.05][portal]!,
        );
      } else if (index < 60) {
        const point = diamondPerimeterPoint((index - 36 + 0.5) / 24, 3.45);
        position.set(point.x, -2.77, point.y);
      } else {
        const u = (index - 60 + 0.5) / Math.max(1, count - 60);
        const theta = u * Math.PI * 4.4;
        const radial = 0.92 + Math.sin(u * Math.PI) * 0.34;
        position.set(
          Math.cos(theta) * radial,
          (u - 0.5) * 3.8,
          Math.sin(theta) * radial,
        );
      }
      quaternion.setFromEuler(
        new THREE.Euler(index * 0.07, index * 0.13, index * 0.05),
      );
      scale.setScalar(0.72 + random() * 0.58);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, colors[index % colors.length] ?? colors[0]!);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.needsUpdate = true;
    mesh.name = "cinematic-world-cell-field";
    this.cellField.add(mesh);
    this.interactive.push(mesh);
    this.materials.push(material);
  }

  private buildProofCurrents(constrained: boolean): void {
    const count = constrained ? (innerWidth <= 680 ? 3 : 4) : 14;
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2;
      const start = new THREE.Vector3(
        Math.cos(angle) * (index % 2 === 0 ? 3.35 : 2.7),
        index % 3 === 0 ? 2.3 : -2.72,
        Math.sin(angle) * (index % 2 === 0 ? 2.65 : 3.1),
      );
      const end = new THREE.Vector3(
        Math.cos(angle + 0.72) * 0.3,
        Math.sin(angle * 1.8) * 0.45,
        Math.sin(angle + 0.72) * 0.3,
      );
      const curve = new THREE.CatmullRomCurve3([
        start,
        start.clone().lerp(end, 0.34).add(new THREE.Vector3(0, 0.22, 0.16)),
        start.clone().lerp(end, 0.7).add(new THREE.Vector3(0, -0.12, -0.12)),
        end,
      ]);
      const lineMaterial = new THREE.LineBasicMaterial({
        color: index % 3 === 0 ? "#a7b67a" : index % 3 === 1 ? "#73aaa6" : "#b67a60",
        transparent: true,
        opacity: 0.16,
      });
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(curve.getPoints(constrained ? 24 : 48)),
        lineMaterial,
      );
      this.proofField.add(line);
      const pulseMaterial = constrained
        ? new THREE.MeshBasicMaterial({
            color: lineMaterial.color,
            transparent: true,
          })
        : new THREE.MeshStandardMaterial({
        color: lineMaterial.color,
        emissive: lineMaterial.color,
        emissiveIntensity: 0.32,
        roughness: 0.25,
        transparent: true,
          });
      const pulse = new THREE.Mesh(new THREE.OctahedronGeometry(0.045, 0), pulseMaterial);
      this.proofField.add(pulse);
      this.proofCurrents.push({ curve, pulse, phase: index / count });
      this.materials.push(lineMaterial, pulseMaterial);
    }
  }

  private buildMeaningConstellation(constrained: boolean): void {
    const statements = this.descriptor.slbit.statements;
    const count = constrained ? statements.length : Math.min(10, statements.length * 2);
    const geometry = new THREE.TetrahedronGeometry(0.075, 0);
    const material = constrained
      ? new THREE.MeshPhongMaterial({
          color: "#c6c1ad",
          specular: "#5d665f",
          shininess: 26,
          vertexColors: true,
        })
      : new THREE.MeshStandardMaterial({
          color: "#d5d0bd",
          roughness: 0.31,
          metalness: 0.22,
          envMapIntensity: 0.24,
          vertexColors: true,
        });
    const nodes = new THREE.InstancedMesh(geometry, material, count);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const colors = [new THREE.Color("#c6c1ad"), new THREE.Color("#718b83")];
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2;
      const radius = 3.62 + (index % 2) * 0.22;
      quaternion.setFromEuler(new THREE.Euler(angle, angle * 0.7, angle * 0.3));
      scale.setScalar(0.86 + (index % 3) * 0.13);
      matrix.compose(
        new THREE.Vector3(
          Math.cos(angle) * radius,
          -2.67 + (index % 2) * 0.12,
          Math.sin(angle) * radius,
        ),
        quaternion,
        scale,
      );
      nodes.setMatrixAt(index, matrix);
      nodes.setColorAt(index, colors[index % colors.length]!);
    }
    nodes.instanceMatrix.needsUpdate = true;
    nodes.instanceColor!.needsUpdate = true;
    nodes.name = "cinematic-slbit-meaning";
    this.meaningField.add(nodes);
    this.materials.push(material);
  }

  private createCinematicMaterial(
    accent: string,
    opacity: number,
    phase: number,
  ): THREE.Material {
    if (this.constrained) {
      const color = new THREE.Color("#c9c4b5").lerp(new THREE.Color(accent), 0.18);
      const material = new THREE.MeshBasicMaterial({
        color,
        map: this.mediaTexture,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        depthWrite: opacity > 0.9,
        toneMapped: false,
      });
      material.userData.baseOpacity = opacity;
      return material;
    }
    const material = new THREE.ShaderMaterial({
      uniforms: {
        media: { value: this.mediaTexture },
        accent: { value: new THREE.Color(accent) },
        opacity: { value: opacity },
        phase: { value: phase },
        time: { value: 0 },
        temporal: { value: 0 },
        evidence: { value: 1 },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vObject;
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          vUv = uv;
          vObject = position;
          vNormal = normalize(normalMatrix * normal);
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          vView = normalize(-viewPosition.xyz);
          gl_Position = projectionMatrix * viewPosition;
        }
      `,
      fragmentShader: `
        uniform sampler2D media;
        uniform vec3 accent;
        uniform float opacity;
        uniform float phase;
        uniform float time;
        uniform float temporal;
        uniform float evidence;
        varying vec2 vUv;
        varying vec3 vObject;
        varying vec3 vNormal;
        varying vec3 vView;

        void main() {
          vec2 flow = vec2(
            vUv.x * 0.86 + vObject.z * 0.035 + temporal * 0.13 + phase,
            vUv.y * 0.92 - vObject.y * 0.018 + sin(time * 0.08 + phase * 6.2831) * 0.025
          );
          vec3 film = texture2D(media, fract(flow)).rgb;
          float strata = 0.5 + 0.5 * sin((vObject.x + vObject.y * 0.7 - vObject.z) * 5.4 + temporal * 12.0 + phase * 8.0);
          float facing = clamp(abs(dot(normalize(vNormal), normalize(vView))), 0.0, 1.0);
          vec3 mineral = mix(vec3(0.012, 0.014, 0.012), accent * 0.24, 0.52 + strata * 0.2);
          vec3 interior = film * (0.74 + evidence * 0.22) + accent * (0.10 + strata * 0.09);
          vec3 color = mix(interior, mineral, facing * 0.24);
          color += accent * pow(1.0 - facing, 2.4) * 0.16;
          gl_FragColor = vec4(color, opacity);
        }
      `,
      transparent: opacity < 0.999,
      depthWrite: opacity > 0.98,
      side: THREE.DoubleSide,
      toneMapped: true,
    });
    this.shaders.push(material);
    material.userData.baseOpacity = opacity;
    return material;
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
    bevelSegments: 4,
    bevelSize: Math.min(0.085, thickness * 0.2),
    bevelThickness: 0.06,
    curveSegments: 4,
    steps: 1,
  });
  geometry.translate(0, 0, -depth * 0.5);
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
    emissive: base.clone().multiplyScalar(0.035),
    specular: base.clone().lerp(new THREE.Color("#7f7864"), 0.18),
    shininess: Math.round(12 + (1 - roughness) * 34),
  });
}

function quadsGeometry(
  quads: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3][],
): THREE.BufferGeometry {
  const positions = quads.flatMap(([first, second, third, fourth]) => [
    ...first.toArray(),
    ...second.toArray(),
    ...third.toArray(),
    ...first.toArray(),
    ...third.toArray(),
    ...fourth.toArray(),
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.computeVertexNormals();
  return geometry;
}

function wallMatrix(
  position: THREE.Vector3,
  rotation: THREE.Quaternion,
  scale: THREE.Vector3,
  target: THREE.Matrix4,
): void {
  target.compose(position, rotation, scale);
}

function diamondPerimeterPoint(position: number, size: number): THREE.Vector2 {
  const corners = [
    new THREE.Vector2(0, size),
    new THREE.Vector2(size, 0),
    new THREE.Vector2(0, -size),
    new THREE.Vector2(-size, 0),
  ];
  const wrapped = ((position % 1) + 1) % 1;
  const segment = Math.floor(wrapped * 4);
  const local = wrapped * 4 - segment;
  return corners[segment]!.clone().lerp(corners[(segment + 1) % 4]!, local);
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
