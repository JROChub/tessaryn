import * as THREE from "three";
import type { DemoCell, DemoMoment, DemoWorld } from "./types";

export type ScaleMode = "object" | "room" | "site";

export interface WorldDiagnostics {
  frameMedianMs: number | null;
  frameP95Ms: number | null;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  pixelRatio: number;
  renderer: string;
  firstStructureMs: number | null;
  materializationMs: number | null;
  cellCount: number;
  scale: ScaleMode;
  chronofold: boolean;
}

interface CellNode {
  cell: DemoCell;
  group: THREE.Group;
  materials: THREE.Material[];
  basePosition: THREE.Vector3;
  targetPosition: THREE.Vector3;
  currentOpacity: number;
  targetOpacity: number;
  condensed: boolean;
  condenseAt: number;
  momentIndex: number;
}

interface WeaveLink {
  line: THREE.Line;
  from: CellNode;
  to: CellNode;
}

interface WorldCallbacks {
  onCellSelected: (cell: DemoCell) => void;
  onCondensationProgress: (value: number, label: string) => void;
  onCondensationComplete: () => void;
  onScaleChanged: (scale: ScaleMode) => void;
}

const ALL_MOMENTS = 3;
const DEG_TO_RAD = Math.PI / 180;

export class TessarynWorld {
  private readonly canvas: HTMLCanvasElement;
  private readonly world: DemoWorld;
  private readonly callbacks: WorldCallbacks;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(52, 1, 0.05, 160);
  private readonly root = new THREE.Group();
  private readonly aggregateRoot = new THREE.Group();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly nodes = new Map<string, CellNode>();
  private readonly cellsById = new Map<string, CellNode>();
  private readonly interactive: THREE.Object3D[] = [];
  private readonly weaveLinks: WeaveLink[] = [];
  private readonly textureCache = new Map<string, THREE.CanvasTexture>();
  private readonly animatedShaders: THREE.ShaderMaterial[] = [];
  private readonly aggregateMaterials: THREE.Material[] = [];
  private readonly keys = new Set<string>();
  private readonly timer = new THREE.Timer();
  private readonly focus = new THREE.Vector3(0, 1.1, 0);
  private readonly targetFocus = new THREE.Vector3(0, 1.1, 0);
  private readonly selectedWorld = new THREE.Vector3();
  private readonly targetBackground = new THREE.Color("#a8c5c2");
  private readonly sun = new THREE.DirectionalLight("#fff0bb", 2.2);
  private readonly ambient = new THREE.HemisphereLight("#d8ded2", "#283228", 1.5);
  private pointerState: { x: number; y: number; moved: boolean } | null = null;
  private yaw = 0.12;
  private pitch = 0.44;
  private targetDistance = 16;
  private distance = 16;
  private scale: ScaleMode = "room";
  private moment = "moment-c";
  private chronofold = false;
  private evidence = true;
  private selected: CellNode | null = null;
  private startedAt = performance.now();
  private visible = true;
  private animationFrame = 0;
  private aggregateOpacity = 0;
  private targetAggregateOpacity = 0;
  private readonly frameDurations: number[] = [];
  private firstStructureMs: number | null = null;
  private materializationMs: number | null = null;
  private resizeObserver: ResizeObserver;

  constructor(canvas: HTMLCanvasElement, world: DemoWorld, callbacks: WorldCallbacks) {
    this.canvas = canvas;
    this.world = world;
    this.callbacks = callbacks;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth <= 680 ? 1 : 1.4));
    this.renderer.shadowMap.enabled = innerWidth > 680;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color("#a8c5c2");
    this.scene.fog = new THREE.FogExp2("#a8c5c2", 0.013);
    this.scene.add(this.root, this.aggregateRoot, this.ambient, this.sun);
    this.timer.connect(document);
    this.sun.position.set(-8, 14, 9);
    this.sun.castShadow = innerWidth > 680;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.left = -18;
    this.sun.shadow.camera.right = 18;
    this.sun.shadow.camera.top = 18;
    this.sun.shadow.camera.bottom = -18;
    this.buildWorld();
    this.bindInteractions();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    document.addEventListener("visibilitychange", this.handleVisibility);
    this.animationFrame = requestAnimationFrame(this.animate);
  }

  setMoment(moment: string): void {
    if (!this.world.moments.some((candidate) => candidate.id === moment)) return;
    this.moment = moment;
    const environment = this.world.moments.find((candidate) => candidate.id === moment);
    if (environment) this.applyEnvironment(environment);
    this.updateCellTargets();
  }

  setScale(scale: ScaleMode): void {
    this.scale = scale;
    if (scale === "object") {
      const node = this.selected ?? this.findVisibleArchive();
      if (node) this.targetFocus.copy(node.group.position);
      this.targetDistance = 4.4;
      this.pitch = 0.28;
    } else if (scale === "room") {
      this.targetFocus.set(0, 1.1, 0);
      this.targetDistance = 16;
      this.pitch = 0.44;
    } else {
      this.targetFocus.set(0, 1.3, 0);
      this.targetDistance = 28;
      this.pitch = 0.72;
    }
    this.updateCellTargets();
    this.callbacks.onScaleChanged(scale);
  }

  setChronofold(active: boolean): void {
    this.chronofold = active;
    this.updateCellTargets();
  }

  setEvidence(active: boolean): void {
    this.evidence = active;
    for (const link of this.weaveLinks) link.line.visible = active;
    for (const node of this.nodes.values()) {
      const boundary = node.group.getObjectByName("cell-boundary");
      if (boundary) boundary.visible = active;
    }
  }

  selectCell(key: string): void {
    const node = this.nodes.get(key);
    if (!node) return;
    this.selected = node;
    this.highlightSelection();
    this.callbacks.onCellSelected(node.cell);
    this.updateCellTargets();
    if (this.scale === "object") {
      this.targetFocus.copy(node.group.position);
    }
  }

  reset(): void {
    this.selected = null;
    this.yaw = 0.12;
    this.pitch = 0.44;
    this.targetFocus.set(0, 1.1, 0);
    this.setScale("room");
    this.highlightSelection();
  }

  selectedScreenPosition(): { x: number; y: number; visible: boolean } | null {
    if (!this.selected) return null;
    this.selected.group.getWorldPosition(this.selectedWorld);
    this.selectedWorld.project(this.camera);
    const visible =
      this.selectedWorld.z > -1 &&
      this.selectedWorld.z < 1 &&
      Math.abs(this.selectedWorld.x) < 0.96 &&
      Math.abs(this.selectedWorld.y) < 0.94;
    return {
      x: (this.selectedWorld.x * 0.5 + 0.5) * this.canvas.clientWidth,
      y: (-this.selectedWorld.y * 0.5 + 0.5) * this.canvas.clientHeight,
      visible,
    };
  }

  diagnostics(): WorldDiagnostics {
    const samples = [...this.frameDurations].sort((left, right) => left - right);
    const percentile = (fraction: number): number | null => {
      if (samples.length === 0) return null;
      const index = Math.min(samples.length - 1, Math.floor((samples.length - 1) * fraction));
      return samples[index] ?? null;
    };
    const context = this.renderer.getContext();
    const debug = context.getExtension("WEBGL_debug_renderer_info");
    const renderer = debug
      ? String(context.getParameter(debug.UNMASKED_RENDERER_WEBGL))
      : String(context.getParameter(context.RENDERER));
    return {
      frameMedianMs: percentile(0.5),
      frameP95Ms: percentile(0.95),
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      pixelRatio: this.renderer.getPixelRatio(),
      renderer,
      firstStructureMs: this.firstStructureMs,
      materializationMs: this.materializationMs,
      cellCount: this.nodes.size,
      scale: this.scale,
      chronofold: this.chronofold,
    };
  }

  destroy(): void {
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    document.removeEventListener("visibilitychange", this.handleVisibility);
    this.timer.dispose();
    this.renderer.dispose();
  }

  private buildWorld(): void {
    const plane = new THREE.Mesh(
      new THREE.CircleGeometry(23, 96),
      new THREE.MeshStandardMaterial({
        color: "#768078",
        roughness: 1,
        metalness: 0,
        transparent: true,
        opacity: 0.2,
      }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -0.205;
    plane.receiveShadow = true;
    this.root.add(plane);

    this.world.cells.forEach((cell, index) => {
      const group = this.createCellObject(cell);
      const momentIndex = this.momentIndex(cell);
      const priority = this.condensationPriority(cell);
      const node: CellNode = {
        cell,
        group,
        materials: this.collectMaterials(group),
        basePosition: group.position.clone(),
        targetPosition: group.position.clone(),
        currentOpacity: 0,
        targetOpacity: 0,
        condensed: cell.visual.primitive === "none",
        condenseAt: 260 + priority * 250 + index * 28,
        momentIndex,
      };
      group.scale.setScalar(node.condensed ? 1 : 0.001);
      this.setOpacity(node, 0);
      this.nodes.set(cell.key, node);
      this.cellsById.set(cell.cell_id, node);
      this.root.add(group);
    });
    this.createWeave();
    this.createUnknownBoundary();
    this.createAggregateField();
    this.updateCellTargets();
  }

  private createCellObject(cell: DemoCell): THREE.Group {
    const group = new THREE.Group();
    group.name = cell.key;
    const position = cell.visual.position_mm.map((value) => value / 1000) as [
      number,
      number,
      number,
    ];
    const size = cell.visual.size_mm.map((value) => value / 1000) as [
      number,
      number,
      number,
    ];
    group.position.set(...position);
    group.rotation.set(
      cell.visual.rotation_mdeg[0] * 0.001 * DEG_TO_RAD,
      cell.visual.rotation_mdeg[1] * 0.001 * DEG_TO_RAD,
      cell.visual.rotation_mdeg[2] * 0.001 * DEG_TO_RAD,
    );
    const material = this.materialFor(cell);

    switch (cell.visual.primitive) {
      case "box":
      case "wall": {
        this.addMesh(group, new THREE.BoxGeometry(...size), material, cell, true);
        break;
      }
      case "gallery": {
        const columnMaterial = material.clone();
        for (let index = 0; index < 7; index += 1) {
          const column = new THREE.Mesh(
            new THREE.BoxGeometry(0.34, size[1], size[2]),
            columnMaterial,
          );
          column.position.x = -size[0] / 2 + 0.7 + (index * (size[0] - 1.4)) / 6;
          column.castShadow = true;
          column.receiveShadow = true;
          group.add(column);
          this.registerInteractive(column, cell);
        }
        const lintel = new THREE.Mesh(
          new THREE.BoxGeometry(size[0], 0.48, size[2] * 1.25),
          material,
        );
        lintel.position.y = size[1] / 2 - 0.25;
        lintel.castShadow = true;
        group.add(lintel);
        this.registerInteractive(lintel, cell);
        break;
      }
      case "terrace": {
        for (let index = 0; index < 4; index += 1) {
          const step = new THREE.Mesh(
            new THREE.BoxGeometry(size[0] - index * 0.55, size[1] / 4, size[2] - index * 0.75),
            material,
          );
          step.position.y = -size[1] / 2 + (index + 0.5) * (size[1] / 4);
          step.position.z = index * -0.25;
          step.receiveShadow = true;
          step.castShadow = true;
          group.add(step);
          this.registerInteractive(step, cell);
        }
        break;
      }
      case "water": {
        const shader = this.waterMaterial(cell.visual.color);
        const water = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[2], 48, 8), shader);
        water.rotation.x = -Math.PI / 2;
        water.receiveShadow = true;
        group.add(water);
        this.registerInteractive(water, cell);
        break;
      }
      case "cylinder": {
        this.addMesh(
          group,
          new THREE.CylinderGeometry(size[0] / 2, size[0] * 0.62, size[1], 18, 4),
          material,
          cell,
          true,
        );
        break;
      }
      case "canopy": {
        const random = seededRandom(cell.visual.seed);
        for (let index = 0; index < 9; index += 1) {
          const crown = new THREE.Mesh(
            new THREE.IcosahedronGeometry(size[0] * (0.18 + random() * 0.09), 1),
            material,
          );
          crown.position.set(
            (random() - 0.5) * size[0] * 0.62,
            (random() - 0.5) * size[1] * 0.38,
            (random() - 0.5) * size[2] * 0.62,
          );
          crown.scale.y = 0.7 + random() * 0.65;
          crown.castShadow = true;
          group.add(crown);
          this.registerInteractive(crown, cell);
        }
        break;
      }
      case "grove": {
        const bladeGeometry = new THREE.ConeGeometry(0.045, 0.55, 4);
        const grove = new THREE.InstancedMesh(bladeGeometry, material, 130);
        const random = seededRandom(cell.visual.seed);
        const matrix = new THREE.Matrix4();
        const rotation = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        const translation = new THREE.Vector3();
        for (let index = 0; index < 130; index += 1) {
          translation.set(
            (random() - 0.5) * size[0],
            -size[1] * 0.42 + random() * 0.18,
            (random() - 0.5) * size[2],
          );
          rotation.setFromEuler(new THREE.Euler(0, random() * Math.PI, (random() - 0.5) * 0.2));
          const bladeScale = 0.55 + random() * 1.1;
          scale.set(bladeScale, bladeScale, bladeScale);
          matrix.compose(translation, rotation, scale);
          grove.setMatrixAt(index, matrix);
        }
        grove.instanceMatrix.needsUpdate = true;
        grove.castShadow = true;
        group.add(grove);
        this.registerInteractive(grove, cell);
        break;
      }
      case "privacy": {
        const shader = this.privacyMaterial(cell.visual.color);
        const volume = new THREE.Mesh(new THREE.BoxGeometry(...size), shader);
        volume.renderOrder = 5;
        group.add(volume);
        this.registerInteractive(volume, cell);
        const frame = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(...size)),
          new THREE.LineBasicMaterial({
            color: cell.visual.color,
            transparent: true,
            opacity: 0.72,
          }),
        );
        frame.name = "cell-boundary";
        group.add(frame);
        break;
      }
      case "light-field": {
        const random = seededRandom(cell.visual.seed);
        const positions = new Float32Array(180 * 3);
        for (let index = 0; index < 180; index += 1) {
          positions[index * 3] = (random() - 0.5) * size[0];
          positions[index * 3 + 1] = (random() - 0.5) * size[1];
          positions[index * 3 + 2] = (random() - 0.5) * size[2];
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        const points = new THREE.Points(
          geometry,
          new THREE.PointsMaterial({
            color: cell.visual.color,
            size: 0.035,
            transparent: true,
            opacity: 0.2,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
        );
        group.add(points);
        break;
      }
      case "archive-stone": {
        const stone = this.addMesh(
          group,
          new THREE.DodecahedronGeometry(size[0] / 2, 1),
          material,
          cell,
          true,
        );
        stone.rotation.set(0.18, 0.42, -0.12);
        const frame = new THREE.LineSegments(
          new THREE.EdgesGeometry(stone.geometry, 18),
          new THREE.LineBasicMaterial({
            color: "#efe3a5",
            transparent: true,
            opacity: 0.64,
          }),
        );
        frame.scale.setScalar(1.018);
        frame.name = "cell-boundary";
        group.add(frame);
        break;
      }
      case "threshold": {
        const threshold = this.addMesh(
          group,
          new THREE.BoxGeometry(...size),
          material,
          cell,
          true,
        );
        threshold.rotation.x = -0.18;
        break;
      }
      case "none":
      default:
        break;
    }
    if (
      cell.visual.primitive !== "none" &&
      cell.visual.primitive !== "privacy" &&
      cell.visual.primitive !== "archive-stone"
    ) {
      const helper = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(...size)),
        new THREE.LineBasicMaterial({
          color: cell.visual.color,
          transparent: true,
          opacity: cell.manifest.evidence.disputed ? 0.58 : 0.12,
        }),
      );
      helper.name = "cell-boundary";
      group.add(helper);
    }
    return group;
  }

  private addMesh(
    group: THREE.Group,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    cell: DemoCell,
    shadows: boolean,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    group.add(mesh);
    this.registerInteractive(mesh, cell);
    return mesh;
  }

  private registerInteractive(object: THREE.Object3D, cell: DemoCell): void {
    object.userData.cellKey = cell.key;
    this.interactive.push(object);
  }

  private materialFor(cell: DemoCell): THREE.MeshStandardMaterial {
    const texture = this.textureFor(cell.visual.material, cell.visual.color, cell.visual.seed);
    const disputed = cell.manifest.evidence.disputed;
    const material = new THREE.MeshStandardMaterial({
      color: cell.visual.color,
      map: texture,
      roughness: cell.visual.material.includes("archive") ? 0.46 : 0.86,
      metalness: cell.visual.material.includes("archive") ? 0.18 : 0.02,
      transparent: true,
      opacity: disputed ? 0.58 : 1,
      depthWrite: !disputed,
    });
    if (disputed) material.emissive.set(cell.visual.color).multiplyScalar(0.08);
    material.userData.baseEmissive = material.emissive.getHex();
    material.userData.baseEmissiveIntensity = material.emissiveIntensity;
    return material;
  }

  private textureFor(name: string, color: string, seed: number): THREE.CanvasTexture {
    const key = name + ":" + color + ":" + seed;
    const existing = this.textureCache.get(key);
    if (existing) return existing;
    const canvas = document.createElement("canvas");
    canvas.width = 192;
    canvas.height = 192;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("2D texture context unavailable");
    const base = new THREE.Color(color);
    const image = context.createImageData(canvas.width, canvas.height);
    const random = seededRandom(seed);
    const veins = Array.from({ length: 7 }, () => ({
      x: random() * canvas.width,
      y: random() * canvas.height,
      width: 4 + random() * 18,
    }));
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const grain =
          (Math.sin((x + seed) * 0.17) + Math.sin((y - seed) * 0.13)) * 0.018 +
          (random() - 0.5) * 0.075;
        let vein = 0;
        for (const line of veins) {
          const distance = Math.abs(y - line.y - Math.sin((x - line.x) * 0.035) * line.width);
          if (distance < 1.2) vein += 0.09;
        }
        const offset = (y * canvas.width + x) * 4;
        image.data[offset] = Math.round(THREE.MathUtils.clamp((base.r + grain + vein) * 255, 0, 255));
        image.data[offset + 1] = Math.round(
          THREE.MathUtils.clamp((base.g + grain + vein * 0.45) * 255, 0, 255),
        );
        image.data[offset + 2] = Math.round(
          THREE.MathUtils.clamp((base.b + grain * 0.7) * 255, 0, 255),
        );
        image.data[offset + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2.5, 2.5);
    texture.anisotropy = Math.min(this.renderer.capabilities.getMaxAnisotropy(), 4);
    this.textureCache.set(key, texture);
    return texture;
  }

  private waterMaterial(color: string): THREE.ShaderMaterial {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        color: { value: new THREE.Color(color) },
        time: { value: 0 },
        opacity: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      vertexShader: [
        "uniform float time;",
        "varying vec2 vUv;",
        "void main(){",
        "vUv=uv;",
        "vec3 p=position;",
        "p.z+=sin((position.x+time)*4.0)*0.025+sin((position.y-time*0.6)*8.0)*0.012;",
        "gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);",
        "}",
      ].join("\n"),
      fragmentShader: [
        "uniform vec3 color;",
        "uniform float time;",
        "uniform float opacity;",
        "varying vec2 vUv;",
        "void main(){",
        "float current=0.5+0.5*sin(vUv.x*38.0+time*1.8+sin(vUv.y*8.0));",
        "vec3 c=mix(color*0.48,color*1.32,current*0.32);",
        "gl_FragColor=vec4(c,(0.48+current*0.18)*opacity);",
        "}",
      ].join("\n"),
    });
    this.animatedShaders.push(material);
    return material;
  }

  private privacyMaterial(color: string): THREE.ShaderMaterial {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        color: { value: new THREE.Color(color) },
        time: { value: 0 },
        opacity: { value: 1 },
      },
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      vertexShader: [
        "varying vec3 vPosition;",
        "void main(){",
        "vPosition=position;",
        "gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);",
        "}",
      ].join("\n"),
      fragmentShader: [
        "uniform vec3 color;",
        "uniform float time;",
        "uniform float opacity;",
        "varying vec3 vPosition;",
        "void main(){",
        "float weave=step(0.48,fract((vPosition.x+vPosition.y+vPosition.z+time*0.08)*6.0));",
        "float scan=0.55+0.45*sin((vPosition.y-time*0.18)*11.0);",
        "gl_FragColor=vec4(color*(0.55+scan*0.28),(0.11+weave*0.09)*opacity);",
        "}",
      ].join("\n"),
    });
    this.animatedShaders.push(material);
    return material;
  }

  private createWeave(): void {
    const origin = this.nodes.get("origin-floor");
    if (!origin) return;
    for (const node of this.nodes.values()) {
      const parents = node.cell.manifest.parents;
      if (parents.length === 0 && node !== origin && node.cell.visual.primitive !== "none") {
        this.addWeaveLink(origin, node);
      }
      for (const parentId of parents) {
        const parent = this.cellsById.get(parentId);
        if (parent) this.addWeaveLink(parent, node);
      }
    }
  }

  private addWeaveLink(from: CellNode, to: CellNode): void {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      from.group.position,
      to.group.position,
    ]);
    const line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({
        color: to.cell.manifest.evidence.disputed ? to.cell.visual.color : "#d7d2bd",
        transparent: true,
        opacity: to.cell.manifest.evidence.disputed ? 0.48 : 0.09,
        depthWrite: false,
      }),
    );
    line.visible = this.evidence;
    this.root.add(line);
    this.weaveLinks.push({ line, from, to });
  }

  private createUnknownBoundary(): void {
    const points = [
      new THREE.Vector3(-9, 0, 8.5),
      new THREE.Vector3(-4, 0, 9.8),
      new THREE.Vector3(0, 0, 9.2),
      new THREE.Vector3(4, 0, 10.1),
      new THREE.Vector3(9, 0, 8.6),
    ];
    const material = new THREE.LineDashedMaterial({
      color: "#c8c3ae",
      transparent: true,
      opacity: 0.32,
      dashSize: 0.28,
      gapSize: 0.34,
    });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material);
    line.computeLineDistances();
    this.root.add(line);
    for (const point of points) {
      const vertical = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          point,
          point.clone().add(new THREE.Vector3(0, 1.2, 0)),
        ]),
        material,
      );
      vertical.computeLineDistances();
      this.root.add(vertical);
    }
  }

  private createAggregateField(): void {
    this.aggregateRoot.name = "site-aggregate-field";
    this.aggregateRoot.position.y = 0.08;
    const visibleNodes = [...this.nodes.values()].filter(
      (node) => node.cell.visual.primitive !== "none",
    );
    if (visibleNodes.length === 0) return;

    const markerGeometry = new THREE.OctahedronGeometry(0.13, 0);
    const markerMaterial = new THREE.MeshStandardMaterial({
      color: "#d7d2bd",
      roughness: 0.68,
      metalness: 0.08,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    markerMaterial.userData.baseOpacity = 0.92;
    const markers = new THREE.InstancedMesh(markerGeometry, markerMaterial, visibleNodes.length);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const translation = new THREE.Vector3();
    visibleNodes.forEach((node, index) => {
      const radius = Math.max(
        0.7,
        Math.sqrt(node.cell.visual.size_mm[0] * node.cell.visual.size_mm[2]) / 7_500,
      );
      translation.set(node.basePosition.x, 0.24 + radius * 0.12, node.basePosition.z);
      scale.set(radius, 0.65 + radius * 0.12, radius);
      matrix.compose(translation, quaternion, scale);
      markers.setMatrixAt(index, matrix);
      markers.setColorAt(
        index,
        new THREE.Color(
          node.cell.manifest.evidence.disputed
            ? node.cell.visual.color
            : node.cell.manifest.evidence.restricted
              ? "#d18662"
              : "#b8c7aa",
        ),
      );
    });
    markers.instanceMatrix.needsUpdate = true;
    if (markers.instanceColor) markers.instanceColor.needsUpdate = true;
    this.aggregateRoot.add(markers);

    const origin = this.nodes.get("origin-floor")?.basePosition ?? new THREE.Vector3();
    const relationPositions: number[] = [];
    for (const node of visibleNodes) {
      relationPositions.push(origin.x, 0.16, origin.z);
      relationPositions.push(node.basePosition.x, 0.16, node.basePosition.z);
    }
    const relationGeometry = new THREE.BufferGeometry();
    relationGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(relationPositions, 3),
    );
    const relationMaterial = new THREE.LineBasicMaterial({
      color: "#d7d2bd",
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    relationMaterial.userData.baseOpacity = 0.22;
    this.aggregateRoot.add(new THREE.LineSegments(relationGeometry, relationMaterial));

    const maximumRadius = Math.max(
      ...visibleNodes.map((node) => Math.hypot(node.basePosition.x, node.basePosition.z)),
      1,
    );
    for (const ratio of [0.38, 0.68, 1]) {
      const points = new THREE.EllipseCurve(
        0,
        0,
        maximumRadius * ratio,
        maximumRadius * ratio * 0.82,
        0,
        Math.PI * 2,
        false,
        0.12,
      )
        .getPoints(96)
        .map((point) => new THREE.Vector3(point.x, 0.1, point.y));
      const material = new THREE.LineDashedMaterial({
        color: ratio === 1 ? "#74c8c1" : "#d7d2bd",
        transparent: true,
        opacity: 0,
        dashSize: 0.16,
        gapSize: 0.26,
        depthWrite: false,
      });
      material.userData.baseOpacity = ratio === 1 ? 0.48 : 0.17;
      const loop = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), material);
      loop.computeLineDistances();
      this.aggregateRoot.add(loop);
    }

    const currentKeys = [
      "west-terrace",
      "grove-field",
      "water-current",
      "archive-c",
      "north-gallery",
    ];
    const currentPoints = currentKeys
      .map((key) => this.nodes.get(key)?.basePosition)
      .filter((point): point is THREE.Vector3 => Boolean(point))
      .map((point) => new THREE.Vector3(point.x, 0.28, point.z));
    if (currentPoints.length > 2) {
      const path = new THREE.CatmullRomCurve3(currentPoints, false, "centripetal");
      const material = new THREE.MeshBasicMaterial({
        color: "#74c8c1",
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      material.userData.baseOpacity = 0.52;
      this.aggregateRoot.add(
        new THREE.Mesh(new THREE.TubeGeometry(path, 96, 0.025, 5, false), material),
      );
    }

    this.aggregateRoot.traverse((object) => {
      const renderable = object as THREE.Mesh;
      if (!renderable.material) return;
      const materials = Array.isArray(renderable.material)
        ? renderable.material
        : [renderable.material];
      for (const material of materials) {
        if (!this.aggregateMaterials.includes(material)) this.aggregateMaterials.push(material);
      }
    });
    this.aggregateRoot.visible = false;
  }

  private updateCellTargets(): void {
    const objectFocus = this.selected ?? this.findVisibleArchive();
    this.targetAggregateOpacity = this.scale === "site" ? 1 : 0;
    for (const node of this.nodes.values()) {
      const shared = node.cell.visual.moments.length === ALL_MOMENTS;
      const active = node.cell.visual.moments.includes(this.moment);
      const semanticOnly = node.cell.visual.primitive === "none";
      const visible = node.condensed && !semanticOnly && (this.chronofold ? true : active || shared);
      const temporalOpacity = visible
        ? node.cell.manifest.evidence.disputed
          ? 0.66
          : this.chronofold && !active && !shared
            ? 0.28
            : 1
        : 0;
      let scaleOpacity = 1;
      if (this.scale === "object") {
        const related =
          node === objectFocus ||
          (objectFocus
            ? node.cell.manifest.parents.includes(objectFocus.cell.cell_id) ||
              objectFocus.cell.manifest.parents.includes(node.cell.cell_id)
            : false);
        scaleOpacity = node === objectFocus ? 1 : related ? 0.24 : 0.055;
      } else if (this.scale === "site") {
        scaleOpacity = ["light-field", "grove", "canopy", "archive-stone"].includes(
          node.cell.visual.primitive,
        )
          ? 0.22
          : 0.48;
      }
      node.targetOpacity = temporalOpacity * scaleOpacity;
      node.targetPosition.copy(node.basePosition);
      if (this.chronofold && !shared) {
        node.targetPosition.y += (node.momentIndex - 1) * 3.8;
        if (node.cell.manifest.evidence.disputed) {
          node.targetPosition.x += node.cell.visual.branch === "east-hypothesis" ? 1.1 : -1.1;
        }
      }
    }
  }

  private applyEnvironment(moment: DemoMoment): void {
    this.targetBackground.set(moment.environment.sky);
    this.sun.color.set(moment.environment.sun);
    this.sun.intensity = moment.environment.sun_milli / 420;
    this.scene.fog = new THREE.FogExp2(
      moment.environment.sky,
      moment.environment.fog_ppm / 1_000_000 + 0.006,
    );
  }

  private collectMaterials(root: THREE.Object3D): THREE.Material[] {
    const materials: THREE.Material[] = [];
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.material) return;
      const values = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of values) {
        if (!materials.includes(material)) {
          if (!(material instanceof THREE.ShaderMaterial) && "opacity" in material) {
            material.userData.baseOpacity = material.opacity;
          }
          materials.push(material);
        }
      }
    });
    return materials;
  }

  private setOpacity(node: CellNode, opacity: number): void {
    node.currentOpacity = opacity;
    for (const material of node.materials) {
      if (material instanceof THREE.ShaderMaterial && material.uniforms.opacity) {
        material.uniforms.opacity.value = opacity;
      } else if ("opacity" in material) {
        material.transparent = true;
        material.opacity = opacity * Number(material.userData.baseOpacity ?? 1);
      }
    }
    node.group.visible = opacity > 0.002;
  }

  private highlightSelection(): void {
    for (const node of this.nodes.values()) {
      const selected = node === this.selected;
      node.group.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (material instanceof THREE.MeshStandardMaterial) {
            material.emissive.setHex(
              selected ? 0xb7c984 : Number(material.userData.baseEmissive ?? 0),
            );
            material.emissiveIntensity = selected
              ? 0.22
              : Number(material.userData.baseEmissiveIntensity ?? 1);
          }
        }
      });
    }
  }

  private momentIndex(cell: DemoCell): number {
    const moment = cell.visual.moments[0];
    const index = this.world.moments.findIndex((candidate) => candidate.id === moment);
    return index < 0 ? 1 : index;
  }

  private condensationPriority(cell: DemoCell): number {
    const priorities: Record<string, number> = {
      box: 0,
      gallery: 1,
      wall: 1,
      terrace: 1,
      cylinder: 2,
      water: 2,
      grove: 3,
      canopy: 3,
      "archive-stone": 4,
      threshold: 4,
      privacy: 5,
      "light-field": 5,
      none: 6,
    };
    return priorities[cell.visual.primitive] ?? 6;
  }

  private findVisibleArchive(): CellNode | null {
    for (const key of ["archive-c", "archive-b", "archive-a"]) {
      const node = this.nodes.get(key);
      if (node && node.cell.visual.moments.includes(this.moment)) return node;
    }
    return null;
  }

  private bindInteractions(): void {
    this.canvas.addEventListener("pointerdown", (event) => {
      this.canvas.setPointerCapture(event.pointerId);
      this.pointerState = { x: event.clientX, y: event.clientY, moved: false };
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (!this.pointerState) return;
      const dx = event.clientX - this.pointerState.x;
      const dy = event.clientY - this.pointerState.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) this.pointerState.moved = true;
      this.yaw -= dx * 0.0042;
      this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.0032, 0.08, 1.28);
      this.pointerState.x = event.clientX;
      this.pointerState.y = event.clientY;
    });
    this.canvas.addEventListener("pointerup", (event) => {
      if (this.pointerState && !this.pointerState.moved) this.pick(event);
      this.pointerState = null;
    });
    this.canvas.addEventListener("pointercancel", () => {
      this.pointerState = null;
    });
    this.canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const order: ScaleMode[] = ["object", "room", "site"];
        const index = order.indexOf(this.scale);
        const next = THREE.MathUtils.clamp(index + (event.deltaY > 0 ? 1 : -1), 0, 2);
        this.setScale(order[next] ?? "room");
      },
      { passive: false },
    );
    window.addEventListener("keydown", (event) => {
      if (["INPUT", "TEXTAREA"].includes((event.target as HTMLElement)?.tagName)) return;
      this.keys.add(event.key.toLowerCase());
    });
    window.addEventListener("keyup", (event) => this.keys.delete(event.key.toLowerCase()));
  }

  private pick(event: PointerEvent): void {
    const bounds = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster
      .intersectObjects(this.interactive, false)
      .find((candidate) => candidate.object.visible);
    const key = hit?.object.userData.cellKey as string | undefined;
    if (key) this.selectCell(key);
  }

  private resize(): void {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, width <= 680 ? 1 : 1.4));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.fov = height < 500 ? 62 : width <= 680 ? 58 : 52;
    this.camera.updateProjectionMatrix();
  }

  private handleVisibility = (): void => {
    this.visible = !document.hidden;
    if (this.visible) this.timer.reset();
  };

  private animate = (timestamp: number): void => {
    this.animationFrame = requestAnimationFrame(this.animate);
    if (!this.visible) return;
    this.timer.update(timestamp);
    const rawDelta = this.timer.getDelta();
    const delta = Math.min(rawDelta, 0.05);
    if (rawDelta > 0) {
      this.frameDurations.push(rawDelta * 1_000);
      if (this.frameDurations.length > 240) this.frameDurations.shift();
    }
    const elapsed = performance.now() - this.startedAt;
    const seconds = performance.now() * 0.001;
    let condensed = 0;
    for (const node of this.nodes.values()) {
      if (!node.condensed && elapsed >= node.condenseAt) {
        node.condensed = true;
        this.firstStructureMs ??= elapsed;
        node.group.scale.setScalar(0.02);
        this.updateCellTargets();
      }
      if (node.condensed) condensed += 1;
      node.currentOpacity = THREE.MathUtils.damp(
        node.currentOpacity,
        node.targetOpacity,
        7,
        delta,
      );
      this.setOpacity(node, node.currentOpacity);
      node.group.position.lerp(node.targetPosition, 1 - Math.exp(-delta * 5.5));
      const targetScale = node.condensed && node.targetOpacity > 0.001 ? 1 : 0.72;
      const scale = THREE.MathUtils.damp(node.group.scale.x, targetScale, 5.5, delta);
      node.group.scale.setScalar(scale);
    }
    this.aggregateOpacity = THREE.MathUtils.damp(
      this.aggregateOpacity,
      this.targetAggregateOpacity,
      5.5,
      delta,
    );
    this.aggregateRoot.visible = this.aggregateOpacity > 0.002;
    for (const material of this.aggregateMaterials) {
      if ("opacity" in material) {
        material.transparent = true;
        material.opacity =
          this.aggregateOpacity * Number(material.userData.baseOpacity ?? 1);
      }
    }
    const progress = condensed / this.nodes.size;
    if (progress === 1) this.materializationMs ??= elapsed;
    this.callbacks.onCondensationProgress(
      progress,
      progress < 0.34 ? "STRUCTURE" : progress < 0.72 ? "APPEARANCE" : "EVIDENCE",
    );
    if (progress === 1 && elapsed < 4_500) this.callbacks.onCondensationComplete();

    for (const shader of this.animatedShaders) {
      const time = shader.uniforms.time;
      if (time) time.value = seconds;
    }
    for (const link of this.weaveLinks) {
      const positions = link.line.geometry.attributes.position as THREE.BufferAttribute;
      positions.setXYZ(0, link.from.group.position.x, link.from.group.position.y, link.from.group.position.z);
      positions.setXYZ(1, link.to.group.position.x, link.to.group.position.y, link.to.group.position.z);
      positions.needsUpdate = true;
      link.line.visible =
        this.evidence && link.from.currentOpacity > 0.03 && link.to.currentOpacity > 0.03;
    }
    this.updateMovement(delta);
    this.focus.lerp(this.targetFocus, 1 - Math.exp(-delta * 4.5));
    this.distance = THREE.MathUtils.damp(this.distance, this.targetDistance, 4.5, delta);
    const cosPitch = Math.cos(this.pitch);
    this.camera.position.set(
      this.focus.x + Math.sin(this.yaw) * cosPitch * this.distance,
      this.focus.y + Math.sin(this.pitch) * this.distance,
      this.focus.z + Math.cos(this.yaw) * cosPitch * this.distance,
    );
    this.camera.lookAt(this.focus);
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.lerp(this.targetBackground, 1 - Math.exp(-delta * 2.5));
    }
    this.renderer.render(this.scene, this.camera);
  };

  private updateMovement(delta: number): void {
    const speed = (this.scale === "site" ? 8 : this.scale === "room" ? 4 : 1.8) * delta;
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(forward.z, 0, -forward.x);
    if (this.keys.has("w") || this.keys.has("arrowup")) this.targetFocus.addScaledVector(forward, speed);
    if (this.keys.has("s") || this.keys.has("arrowdown")) {
      this.targetFocus.addScaledVector(forward, -speed);
    }
    if (this.keys.has("a") || this.keys.has("arrowleft")) {
      this.targetFocus.addScaledVector(right, -speed);
    }
    if (this.keys.has("d") || this.keys.has("arrowright")) {
      this.targetFocus.addScaledVector(right, speed);
    }
    if (this.keys.has("q")) this.targetFocus.y = Math.max(0.2, this.targetFocus.y - speed);
    if (this.keys.has("e")) this.targetFocus.y = Math.min(8, this.targetFocus.y + speed);
    this.targetFocus.x = THREE.MathUtils.clamp(this.targetFocus.x, -10, 10);
    this.targetFocus.z = THREE.MathUtils.clamp(this.targetFocus.z, -10, 10);
  }
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
