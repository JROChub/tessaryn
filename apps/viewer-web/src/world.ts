import * as THREE from "three";
import type { DemoCell, DemoMoment, DemoWorld, SurfelPoint } from "./types";

export type ScaleMode = "object" | "room" | "site";

export interface WorldDiagnostics {
  visualProfile: "full" | "constrained";
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
  provenanceLinks: number;
  temporalManifolds: number;
  semanticConstellations: number;
  scale: ScaleMode;
  chronofold: boolean;
}

interface CellNode {
  cell: DemoCell;
  group: THREE.Group;
  materials: THREE.Material[];
  basePosition: THREE.Vector3;
  targetPosition: THREE.Vector3;
  baseQuaternion: THREE.Quaternion;
  assemblyQuaternion: THREE.Quaternion;
  halo: THREE.Mesh | null;
  haloMaterial: THREE.MeshBasicMaterial | null;
  currentOpacity: number;
  targetOpacity: number;
  condensed: boolean;
  condenseAt: number;
  assembledAt: number | null;
  momentIndex: number;
}

interface WeaveLink {
  line: THREE.Line;
  pulse: THREE.Mesh;
  phase: number;
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
  private readonly fieldRoot = new THREE.Group();
  private readonly root = new THREE.Group();
  private readonly aggregateRoot = new THREE.Group();
  private readonly temporalRoot = new THREE.Group();
  private readonly importedRoot = new THREE.Group();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly nodes = new Map<string, CellNode>();
  private readonly cellsById = new Map<string, CellNode>();
  private readonly interactive: THREE.Object3D[] = [];
  private readonly weaveLinks: WeaveLink[] = [];
  private readonly textureCache = new Map<string, THREE.CanvasTexture>();
  private readonly animatedShaders: THREE.ShaderMaterial[] = [];
  private readonly aggregateMaterials: THREE.Material[] = [];
  private readonly temporalMaterials: THREE.Material[] = [];
  private readonly keys = new Set<string>();
  private readonly timer = new THREE.Timer();
  private readonly focus = new THREE.Vector3(0, 1.1, 0);
  private readonly targetFocus = new THREE.Vector3(0, 1.1, 0);
  private readonly selectedWorld = new THREE.Vector3();
  private readonly targetBackground = new THREE.Color("#060b10");
  private readonly sun = new THREE.DirectionalLight("#ffe1a1", 3.4);
  private readonly ambient = new THREE.HemisphereLight("#b9dce0", "#15120f", 1.45);
  private readonly crystalLight = new THREE.PointLight("#73cdd0", 12, 34, 1.8);
  private readonly archiveLight = new THREE.PointLight("#e2b76d", 8, 28, 1.9);
  private readonly constrainedRenderer: boolean;
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
  private temporalOpacity = 0;
  private targetTemporalOpacity = 0;
  private readonly frameDurations: number[] = [];
  private firstStructureMs: number | null = null;
  private materializationMs: number | null = null;
  private resizeObserver: ResizeObserver;
  private importedFrame: { focus: THREE.Vector3; radius: number } | null = null;
  private readonly reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(canvas: HTMLCanvasElement, world: DemoWorld, callbacks: WorldCallbacks) {
    this.canvas = canvas;
    this.world = world;
    this.callbacks = callbacks;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.constrainedRenderer = this.detectConstrainedRenderer();
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.22;
    this.renderer.setPixelRatio(
      Math.min(devicePixelRatio, this.constrainedRenderer ? 0.75 : innerWidth <= 680 ? 1 : 1.4),
    );
    this.renderer.shadowMap.enabled = innerWidth > 680 && !this.constrainedRenderer;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = new THREE.Color("#060b10");
    this.scene.fog = new THREE.FogExp2("#060b10", 0.018);
    this.crystalLight.position.set(-7, 4.5, 2);
    this.archiveLight.position.set(6, 2.8, -5);
    this.scene.add(
      this.fieldRoot,
      this.root,
      this.aggregateRoot,
      this.temporalRoot,
      this.importedRoot,
      this.ambient,
      this.sun,
    );
    if (!this.constrainedRenderer) this.scene.add(this.crystalLight, this.archiveLight);
    this.timer.connect(document);
    this.sun.position.set(-8, 14, 9);
    this.sun.castShadow = innerWidth > 680 && !this.constrainedRenderer;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.left = -18;
    this.sun.shadow.camera.right = 18;
    this.sun.shadow.camera.top = 18;
    this.sun.shadow.camera.bottom = -18;
    this.buildWorld();
    const initialMoment = this.world.moments.find((candidate) => candidate.id === this.moment);
    if (initialMoment) this.applyEnvironment(initialMoment);
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
    if (this.importedFrame) {
      this.targetFocus.copy(this.importedFrame.focus);
      const multiplier = scale === "object" ? 0.72 : scale === "site" ? 3.1 : 1.65;
      this.targetDistance = Math.max(0.8, this.importedFrame.radius * multiplier);
      this.pitch = scale === "site" ? 0.72 : scale === "object" ? 0.28 : 0.44;
      this.updateCellTargets();
      this.callbacks.onScaleChanged(scale);
      return;
    }
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
    this.targetTemporalOpacity = active && !this.importedFrame ? 1 : 0;
    this.updateCellTargets();
  }

  setEvidence(active: boolean): void {
    this.evidence = active;
    for (const link of this.weaveLinks) {
      link.line.visible = active;
      link.pulse.visible = active && !this.constrainedRenderer;
    }
    for (const node of this.nodes.values()) {
      const boundary = node.group.getObjectByName("cell-boundary");
      if (boundary) boundary.visible = active;
    }
    this.updateCellTargets();
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
    this.targetFocus.copy(this.importedFrame?.focus ?? new THREE.Vector3(0, 1.1, 0));
    this.setScale("room");
    this.highlightSelection();
  }

  loadSurfelObservation(cell: DemoCell, surfels: SurfelPoint[]): void {
    if (surfels.length === 0) throw new Error("imported observation contains no surfels");
    this.disposeImportedRoot();
    this.root.visible = false;
    this.aggregateRoot.visible = false;
    this.importedRoot.visible = true;
    this.nodes.clear();
    this.cellsById.clear();
    this.interactive.length = 0;

    const positions = new Float32Array(surfels.length * 3);
    const normals = new Float32Array(surfels.length * 3);
    const colors = new Float32Array(surfels.length * 3);
    const bounds = new THREE.Box3();
    const point = new THREE.Vector3();
    let radiusSum = 0;
    surfels.forEach((surfel, index) => {
      point.set(
        surfel.positionUm[0] / 1_000_000,
        surfel.positionUm[1] / 1_000_000,
        surfel.positionUm[2] / 1_000_000,
      );
      bounds.expandByPoint(point);
      positions.set([point.x, point.y, point.z], index * 3);
      normals.set(
        [
          surfel.normalQ15[0] / 32_767,
          surfel.normalQ15[1] / 32_767,
          surfel.normalQ15[2] / 32_767,
        ],
        index * 3,
      );
      colors.set(
        [surfel.color[0] / 255, surfel.color[1] / 255, surfel.color[2] / 255],
        index * 3,
      );
      radiusSum += surfel.radiusUm / 1_000_000;
    });
    const sourceCenter = bounds.getCenter(new THREE.Vector3());
    for (let index = 0; index < surfels.length; index += 1) {
      positions[index * 3] = (positions[index * 3] ?? 0) - sourceCenter.x;
      positions[index * 3 + 1] = (positions[index * 3 + 1] ?? 0) - sourceCenter.y;
      positions[index * 3 + 2] = (positions[index * 3 + 2] ?? 0) - sourceCenter.z;
    }
    const localBounds = bounds.clone().translate(sourceCenter.clone().multiplyScalar(-1));
    const size = localBounds.getSize(new THREE.Vector3());
    const radius = Math.max(0.5, size.length() * 0.5);
    const focus = new THREE.Vector3(0, 1.1, 0);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();
    const material = new THREE.ShaderMaterial({
      transparent: true,
      vertexColors: true,
      depthWrite: true,
      uniforms: {
        opacity: { value: 1 },
        pointSize: {
          value: THREE.MathUtils.clamp((radiusSum / surfels.length) * 880, 3, 28),
        },
        pixelRatio: { value: this.renderer.getPixelRatio() },
      },
      vertexShader: `
        attribute vec3 color;
        varying vec3 vColor;
        varying vec3 vNormal;
        uniform float pointSize;
        uniform float pixelRatio;
        void main() {
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          vColor = color;
          vNormal = normalize(normalMatrix * normal);
          gl_PointSize = clamp(pointSize * pixelRatio / max(0.25, -viewPosition.z), 2.0, 42.0);
          gl_Position = projectionMatrix * viewPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying vec3 vNormal;
        uniform float opacity;
        void main() {
          vec2 disc = gl_PointCoord - vec2(0.5);
          float radius = length(disc);
          float angle = atan(disc.y, disc.x);
          float crystalEdge = 0.43 + 0.045 * cos(angle * 6.0);
          if (radius > crystalEdge) discard;
          vec3 lightDirection = normalize(vec3(-0.35, 0.72, 0.48));
          float diffuse = 0.42 + 0.58 * abs(dot(normalize(vNormal), lightDirection));
          float edge = 1.0 - smoothstep(crystalEdge - 0.08, crystalEdge, radius);
          float core = 1.0 - smoothstep(0.0, crystalEdge, radius);
          vec3 crystal = vColor * diffuse + vec3(0.14, 0.24, 0.23) * core;
          gl_FragColor = vec4(crystal, opacity * edge);
        }
      `,
    });
    const points = new THREE.Points(geometry, material);
    points.userData.cellKey = cell.key;
    const group = new THREE.Group();
    group.position.copy(focus);
    group.add(points);

    const boundary = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z)),
      new THREE.LineBasicMaterial({ color: "#74c8c1", transparent: true, opacity: 0.42 }),
    );
    boundary.name = "cell-boundary";
    group.add(boundary);
    this.importedRoot.add(group);
    this.raycaster.params.Points = { threshold: Math.max(0.04, radius * 0.025) };

    const node: CellNode = {
      cell,
      group,
      materials: this.collectMaterials(group),
      basePosition: focus.clone(),
      targetPosition: focus.clone(),
      baseQuaternion: group.quaternion.clone(),
      assemblyQuaternion: group.quaternion.clone(),
      halo: null,
      haloMaterial: null,
      currentOpacity: 1,
      targetOpacity: 1,
      condensed: true,
      condenseAt: 0,
      assembledAt: 0,
      momentIndex: 1,
    };
    this.nodes.set(cell.key, node);
    this.cellsById.set(cell.cell_id, node);
    this.interactive.push(points);
    this.importedFrame = { focus, radius };
    this.selected = node;
    this.setChronofold(false);
    this.setScale("room");
    this.setOpacity(node, 1);
    this.callbacks.onCellSelected(cell);
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
      visualProfile: this.constrainedRenderer ? "constrained" : "full",
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
      provenanceLinks: this.weaveLinks.length,
      temporalManifolds: this.world.moments.length,
      semanticConstellations: [...this.nodes.values()].filter((node) =>
        Boolean(node.group.getObjectByName("slbit-constellation")),
      ).length,
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

  private detectConstrainedRenderer(): boolean {
    const context = this.renderer.getContext();
    const debug = context.getExtension("WEBGL_debug_renderer_info");
    const renderer = debug
      ? String(context.getParameter(debug.UNMASKED_RENDERER_WEBGL))
      : String(context.getParameter(context.RENDERER));
    return /swiftshader|llvmpipe|software rasterizer/i.test(renderer);
  }

  private disposeImportedRoot(): void {
    this.importedRoot.traverse((object) => {
      const renderable = object as THREE.Mesh;
      renderable.geometry?.dispose();
      if (!renderable.material) return;
      const materials = Array.isArray(renderable.material)
        ? renderable.material
        : [renderable.material];
      materials.forEach((material) => material.dispose());
    });
    this.importedRoot.clear();
  }

  private buildWorld(): void {
    this.createAnchorField();
    const floorMaterial = this.constrainedRenderer
      ? new THREE.MeshBasicMaterial({
          color: "#10191a",
          transparent: true,
          opacity: 0.78,
        })
      : new THREE.MeshStandardMaterial({
          color: "#10191a",
          roughness: 0.72,
          metalness: 0.18,
          transparent: true,
          opacity: 0.78,
        });
    const plane = new THREE.Mesh(
      new THREE.CircleGeometry(23, 12),
      floorMaterial,
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -0.205;
    plane.receiveShadow = true;
    this.root.add(plane);

    this.world.cells.forEach((cell, index) => {
      const group = this.createCellObject(cell);
      const momentIndex = this.momentIndex(cell);
      const priority = this.condensationPriority(cell);
      const baseQuaternion = group.quaternion.clone();
      const random = seededRandom(cell.visual.seed ^ 0x51f15e);
      const axis = new THREE.Vector3(
        random() - 0.5,
        0.35 + random() * 0.65,
        random() - 0.5,
      ).normalize();
      const assemblyQuaternion = baseQuaternion
        .clone()
        .multiply(
          new THREE.Quaternion().setFromAxisAngle(
            axis,
            (0.22 + random() * 0.34) * (random() > 0.5 ? 1 : -1),
          ),
        );
      const assemblyHalo = group.getObjectByName("assembly-halo");
      const node: CellNode = {
        cell,
        group,
        materials: this.collectMaterials(group),
        basePosition: group.position.clone(),
        targetPosition: group.position.clone(),
        baseQuaternion,
        assemblyQuaternion,
        halo: assemblyHalo instanceof THREE.Mesh ? assemblyHalo : null,
        haloMaterial:
          group.userData.haloMaterial instanceof THREE.MeshBasicMaterial
            ? group.userData.haloMaterial
            : null,
        currentOpacity: 0,
        targetOpacity: 0,
        condensed: cell.visual.primitive === "none",
        condenseAt: 260 + priority * 250 + index * 28,
        assembledAt: cell.visual.primitive === "none" ? 0 : null,
        momentIndex,
      };
      group.quaternion.copy(assemblyQuaternion);
      group.scale.setScalar(node.condensed ? 1 : 0.001);
      this.setOpacity(node, 0);
      this.nodes.set(cell.key, node);
      this.cellsById.set(cell.cell_id, node);
      this.root.add(group);
    });
    this.createWeave();
    this.createUnknownBoundary();
    this.createAggregateField();
    this.createTemporalField();
    this.updateCellTargets();
  }

  private createAnchorField(): void {
    this.fieldRoot.name = "anchor-field";
    const fieldMaterial = new THREE.MeshBasicMaterial({
      color: "#5f999b",
      transparent: true,
      opacity: 0.035,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    for (const [inner, outer] of [
      [4.4, 4.46],
      [8.8, 8.88],
      [14.2, 14.3],
      [21.5, 21.64],
    ] as const) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 12), fieldMaterial);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -0.19;
      this.fieldRoot.add(ring);
    }

    const radialPositions: number[] = [];
    for (let index = 0; index < 12; index += 1) {
      const angle = (index / 12) * Math.PI * 2;
      radialPositions.push(0, -0.185, 0);
      radialPositions.push(Math.cos(angle) * 21.5, -0.185, Math.sin(angle) * 21.5);
    }
    const radialGeometry = new THREE.BufferGeometry();
    radialGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(radialPositions, 3),
    );
    this.fieldRoot.add(
      new THREE.LineSegments(
        radialGeometry,
        new THREE.LineBasicMaterial({
          color: "#7da6a4",
          transparent: true,
          opacity: 0.055,
          depthWrite: false,
        }),
      ),
    );

    const anchorMaterial = this.constrainedRenderer
      ? new THREE.MeshBasicMaterial({ color: "#a9ded7" })
      : new THREE.MeshStandardMaterial({
          color: "#d6ebe5",
          emissive: "#4e9d9c",
          emissiveIntensity: 0.7,
          roughness: 0.16,
          metalness: 0.28,
        });
    const anchorCore = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.18, 0),
      anchorMaterial,
    );
    anchorCore.position.y = -0.02;
    this.fieldRoot.add(anchorCore);
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
      case "none": {
        if (cell.manifest.evidence.semantic_only) {
          this.createSemanticConstellation(group, cell);
        }
        break;
      }
      default:
        break;
    }
    if (cell.visual.primitive !== "none" && cell.visual.primitive !== "privacy") {
      this.createCrystallineLattice(group, cell, size);
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

  private createCrystallineLattice(
    group: THREE.Group,
    cell: DemoCell,
    size: [number, number, number],
  ): void {
    const random = seededRandom(cell.visual.seed ^ 0xc311c311);
    const stateColor = cell.manifest.evidence.disputed
      ? "#e1846f"
      : cell.manifest.evidence.restricted
        ? "#dfbd73"
        : "#8fd8d2";
    const points: THREE.Vector3[] = [new THREE.Vector3()];
    const count = this.constrainedRenderer ? 4 : innerWidth <= 680 ? 6 : 9;
    for (let index = 0; index < count; index += 1) {
      points.push(
        new THREE.Vector3(
          (random() - 0.5) * size[0] * 0.78,
          (random() - 0.5) * size[1] * 0.78,
          (random() - 0.5) * size[2] * 0.78,
        ),
      );
    }

    const segments: number[] = [];
    for (let index = 1; index < points.length; index += 1) {
      const point = points[index];
      const next = points[index === points.length - 1 ? 1 : index + 1];
      if (!point || !next) continue;
      segments.push(0, 0, 0, point.x, point.y, point.z);
      segments.push(point.x, point.y, point.z, next.x, next.y, next.z);
    }
    const latticeGeometry = new THREE.BufferGeometry();
    latticeGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(segments, 3),
    );
    const latticeMaterial = new THREE.LineBasicMaterial({
      color: stateColor,
      transparent: true,
      opacity: cell.manifest.evidence.disputed ? 0.31 : 0.16,
      depthWrite: false,
    });
    latticeMaterial.userData.baseOpacity = latticeMaterial.opacity;
    const lattice = new THREE.LineSegments(latticeGeometry, latticeMaterial);
    lattice.name = "cell-lattice";
    group.add(lattice);

    if (!this.constrainedRenderer) {
      const nodeGeometry = new THREE.OctahedronGeometry(0.035, 0);
      const nodeMaterial = new THREE.MeshBasicMaterial({
        color: stateColor,
        transparent: true,
        opacity: 0.52,
        depthWrite: false,
      });
      nodeMaterial.userData.baseOpacity = nodeMaterial.opacity;
      const nodes = new THREE.InstancedMesh(nodeGeometry, nodeMaterial, points.length);
      const matrix = new THREE.Matrix4();
      points.forEach((point, index) => {
        const nodeScale = index === 0 ? 1.8 : 0.72 + random() * 0.55;
        matrix.makeScale(nodeScale, nodeScale, nodeScale);
        matrix.setPosition(point);
        nodes.setMatrixAt(index, matrix);
      });
      nodes.instanceMatrix.needsUpdate = true;
      group.add(nodes);
    }

    if (this.constrainedRenderer) return;
    const haloMaterial = new THREE.MeshBasicMaterial({
      color: stateColor,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    haloMaterial.userData.baseOpacity = 0;
    const radius = Math.max(0.28, Math.hypot(size[0], size[2]) * 0.54);
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(radius * 0.97, radius, 24),
      haloMaterial,
    );
    halo.name = "assembly-halo";
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = -size[1] * 0.5 - 0.035;
    group.add(halo);
    group.userData.haloMaterial = haloMaterial;
  }

  private createSemanticConstellation(group: THREE.Group, cell: DemoCell): void {
    const summarySeed = [...cell.semantic_summary].reduce(
      (value, character) => Math.imul(value ^ character.charCodeAt(0), 16_777_619),
      cell.visual.seed ^ 0x51b17,
    );
    const random = seededRandom(summarySeed);
    const points: THREE.Vector3[] = [];
    const count = innerWidth <= 680 ? 8 : 13;
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2 + (random() - 0.5) * 0.28;
      const radius = 1.45 + random() * 1.15;
      points.push(
        new THREE.Vector3(
          Math.cos(angle) * radius,
          2.5 + (random() - 0.5) * 1.45,
          Math.sin(angle) * radius * 0.68,
        ),
      );
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const pointsMaterial = new THREE.PointsMaterial({
      color: "#b7d9d6",
      size: innerWidth <= 680 ? 0.075 : 0.055,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
      sizeAttenuation: true,
    });
    pointsMaterial.userData.baseOpacity = pointsMaterial.opacity;
    const constellation = new THREE.Points(geometry, pointsMaterial);
    constellation.name = "slbit-constellation";
    this.registerInteractive(constellation, cell);
    group.add(constellation);

    const connections: number[] = [];
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      const next = points[(index + 1) % points.length];
      if (!point || !next) continue;
      connections.push(point.x, point.y, point.z, next.x, next.y, next.z);
      if (index % 3 === 0) {
        connections.push(point.x, point.y, point.z, 0, 2.5, 0);
      }
    }
    const connectionGeometry = new THREE.BufferGeometry();
    connectionGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(connections, 3),
    );
    const connectionMaterial = new THREE.LineBasicMaterial({
      color: "#9a8ec3",
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    });
    connectionMaterial.userData.baseOpacity = connectionMaterial.opacity;
    group.add(new THREE.LineSegments(connectionGeometry, connectionMaterial));
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

  private presentationColor(cell: DemoCell): THREE.Color {
    const color = new THREE.Color(cell.visual.color);
    const material = cell.visual.material;
    if (material.includes("archive")) return color.lerp(new THREE.Color("#dfb86f"), 0.58);
    if (material.includes("mineral")) return color.lerp(new THREE.Color("#244a4b"), 0.72);
    if (material.includes("limestone") || material.includes("lichen")) {
      return color.lerp(new THREE.Color("#6f918e"), 0.56);
    }
    if (material.includes("strata")) return color.lerp(new THREE.Color("#8c6c52"), 0.5);
    if (material.includes("foliage") || material.includes("vegetation")) {
      return color.lerp(new THREE.Color("#2f6c66"), 0.48);
    }
    if (material.includes("wood")) return color.lerp(new THREE.Color("#76533e"), 0.34);
    return color;
  }

  private materialFor(
    cell: DemoCell,
  ): THREE.MeshStandardMaterial | THREE.MeshBasicMaterial {
    const displayColor = this.presentationColor(cell);
    const displayHex = "#" + displayColor.getHexString();
    const texture = this.textureFor(cell.visual.material, displayHex, cell.visual.seed);
    const disputed = cell.manifest.evidence.disputed;
    const archive = cell.visual.material.includes("archive");
    const baseColor = displayColor;
    const common = {
      color: displayColor,
      map: texture,
      emissive: baseColor
        .clone()
        .multiplyScalar(disputed ? 0.17 : archive ? 0.11 : 0.055),
      emissiveIntensity: disputed ? 0.8 : 0.55,
      transparent: true,
      opacity: disputed ? 0.62 : 0.96,
      depthWrite: !disputed,
    };
    const material = this.constrainedRenderer
      ? new THREE.MeshBasicMaterial({
          color: displayColor,
          map: texture,
          transparent: true,
          opacity: disputed ? 0.62 : 0.96,
          depthWrite: !disputed,
        })
      : new THREE.MeshStandardMaterial({
          ...common,
          roughness: archive ? 0.24 : 0.38,
          metalness: archive ? 0.34 : 0.14,
        });
    if (material instanceof THREE.MeshStandardMaterial) {
      material.userData.baseEmissive = material.emissive.getHex();
      material.userData.baseEmissiveIntensity = material.emissiveIntensity;
    } else {
      material.userData.baseColor = material.color.getHex();
    }
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
    const random = seededRandom(seed);
    context.fillStyle = base.clone().multiplyScalar(0.58).getStyle();
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < 34; index += 1) {
      const centerX = random() * canvas.width;
      const centerY = random() * canvas.height;
      const radius = 14 + random() * 52;
      const facet = base
        .clone()
        .offsetHSL((random() - 0.5) * 0.045, (random() - 0.5) * 0.08, 0.04 + random() * 0.2);
      context.globalAlpha = 0.08 + random() * 0.16;
      context.fillStyle = facet.getStyle();
      context.beginPath();
      for (let corner = 0; corner < 3; corner += 1) {
        const angle = random() * Math.PI * 2;
        const distance = radius * (0.35 + random() * 0.65);
        const x = centerX + Math.cos(angle) * distance;
        const y = centerY + Math.sin(angle) * distance;
        if (corner === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.closePath();
      context.fill();
    }
    context.globalAlpha = 0.28;
    context.strokeStyle = base.clone().lerp(new THREE.Color("#e2eee8"), 0.52).getStyle();
    context.lineWidth = 0.7;
    for (let index = 0; index < 15; index += 1) {
      context.beginPath();
      const startX = random() * canvas.width;
      const startY = random() * canvas.height;
      context.moveTo(startX, startY);
      context.lineTo(
        startX + (random() - 0.5) * canvas.width * 0.8,
        startY + (random() - 0.5) * canvas.height * 0.8,
      );
      context.stroke();
    }
    context.globalAlpha = 1;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1.7, 1.7);
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
    const disputed = to.cell.manifest.evidence.disputed;
    const line = new THREE.Line(
      geometry,
      new THREE.LineDashedMaterial({
        color: disputed ? "#e1846f" : "#76c8c8",
        transparent: true,
        opacity: disputed ? 0.48 : 0.18,
        dashSize: disputed ? 0.1 : 0.24,
        gapSize: disputed ? 0.16 : 0.32,
        depthWrite: false,
      }),
    );
    line.computeLineDistances();
    line.visible = this.evidence;
    this.root.add(line);
    const pulse = new THREE.Mesh(
      new THREE.OctahedronGeometry(disputed ? 0.07 : 0.052, 0),
      new THREE.MeshBasicMaterial({
        color: disputed ? "#f0a08a" : "#c2f2e9",
        transparent: true,
        opacity: disputed ? 0.82 : 0.68,
        depthWrite: false,
      }),
    );
    pulse.visible = this.evidence && !this.constrainedRenderer;
    pulse.renderOrder = 6;
    this.root.add(pulse);
    this.weaveLinks.push({
      line,
      pulse,
      phase: (to.cell.visual.seed % 997) / 997,
      from,
      to,
    });
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

  private createTemporalField(): void {
    this.temporalRoot.name = "chronofold-field";
    this.world.moments.forEach((moment, index) => {
      const height = (index - 1) * 3.8;
      const momentColor = new THREE.Color(moment.environment.sun).lerp(
        new THREE.Color(index === 1 ? "#72c9ca" : index === 0 ? "#9a8ec3" : "#e1bc72"),
        0.62,
      );
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: momentColor,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      ringMaterial.userData.baseOpacity = index === 1 ? 0.19 : 0.13;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(10.2 + index * 0.55, 0.012, 3, 96),
        ringMaterial,
      );
      ring.rotation.x = Math.PI / 2;
      ring.rotation.z = index * 0.12 - 0.1;
      ring.position.y = height;
      this.temporalRoot.add(ring);
      this.temporalMaterials.push(ringMaterial);

      const phasePositions: number[] = [];
      for (let segment = 0; segment < 12; segment += 1) {
        const angle = (segment / 12) * Math.PI * 2 + index * 0.08;
        phasePositions.push(0, height, 0);
        phasePositions.push(
          Math.cos(angle) * (10.2 + index * 0.55),
          height,
          Math.sin(angle) * (10.2 + index * 0.55),
        );
      }
      const phaseGeometry = new THREE.BufferGeometry();
      phaseGeometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(phasePositions, 3),
      );
      const phaseMaterial = new THREE.LineBasicMaterial({
        color: momentColor,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      phaseMaterial.userData.baseOpacity = index === 1 ? 0.08 : 0.045;
      this.temporalRoot.add(new THREE.LineSegments(phaseGeometry, phaseMaterial));
      this.temporalMaterials.push(phaseMaterial);
    });
    this.temporalRoot.visible = false;
  }

  private updateCellTargets(): void {
    const objectFocus = this.selected ?? this.findVisibleArchive();
    this.targetAggregateOpacity = !this.importedFrame && this.scale === "site" ? 1 : 0;
    for (const node of this.nodes.values()) {
      if (this.importedFrame) {
        node.targetOpacity = 1;
        node.targetPosition.copy(node.basePosition);
        continue;
      }
      const shared = node.cell.visual.moments.length === ALL_MOMENTS;
      const active = node.cell.visual.moments.includes(this.moment);
      const semanticOnly = node.cell.visual.primitive === "none";
      const visible =
        node.condensed &&
        (semanticOnly
          ? this.evidence
          : this.chronofold
            ? true
            : active || shared);
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
        scaleOpacity = semanticOnly ? 0.14 : node === objectFocus ? 1 : related ? 0.24 : 0.055;
      } else if (this.scale === "site") {
        scaleOpacity = semanticOnly
          ? 0.34
          : ["light-field", "grove", "canopy", "archive-stone"].includes(
                node.cell.visual.primitive,
              )
            ? 0.22
            : 0.48;
      }
      node.targetOpacity = temporalOpacity * scaleOpacity;
      node.targetPosition.copy(node.basePosition);
      const detailedEvidence =
        this.evidence &&
        (!this.constrainedRenderer ||
          !this.chronofold ||
          active ||
          shared ||
          node.cell.manifest.evidence.disputed);
      node.group.traverse((object) => {
        if (object.name === "cell-lattice" || object.name === "cell-boundary") {
          object.visible = detailedEvidence;
        }
        if (object.name === "slbit-constellation") object.visible = this.evidence;
      });
      if (this.chronofold && !shared) {
        node.targetPosition.y += (node.momentIndex - 1) * 3.8;
        if (node.cell.manifest.evidence.disputed) {
          node.targetPosition.x += node.cell.visual.branch === "east-hypothesis" ? 1.1 : -1.1;
        }
      }
    }
  }

  private applyEnvironment(moment: DemoMoment): void {
    this.targetBackground
      .set(moment.environment.sky)
      .lerp(new THREE.Color("#04080d"), 0.88);
    this.sun.color.set(moment.environment.sun);
    this.sun.intensity = moment.environment.sun_milli / 340;
    this.ambient.color
      .set(moment.environment.sky)
      .lerp(new THREE.Color("#a7d2d3"), 0.72);
    this.crystalLight.intensity = 8 + moment.environment.fog_ppm / 2_800;
    this.archiveLight.intensity = 7 + moment.environment.sun_milli / 300;
    this.scene.fog = new THREE.FogExp2(
      this.targetBackground,
      moment.environment.fog_ppm / 1_400_000 + 0.014,
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
          } else if (material instanceof THREE.MeshBasicMaterial) {
            material.color.setHex(
              selected ? 0xc5d98d : Number(material.userData.baseColor ?? 0xffffff),
            );
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
    this.renderer.setPixelRatio(
      Math.min(devicePixelRatio, this.constrainedRenderer ? 0.75 : width <= 680 ? 1 : 1.4),
    );
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
    const seconds = this.reducedMotion ? 0 : performance.now() * 0.001;
    let condensed = 0;
    for (const node of this.nodes.values()) {
      if (!node.condensed && elapsed >= node.condenseAt) {
        node.condensed = true;
        node.assembledAt = elapsed;
        this.firstStructureMs ??= elapsed;
        node.group.scale.setScalar(0.02);
        node.group.quaternion.copy(node.assemblyQuaternion);
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
      node.group.quaternion.slerp(node.baseQuaternion, 1 - Math.exp(-delta * 4.8));
      if (node.haloMaterial && node.assembledAt !== null) {
        const assemblyAge = Math.max(0, elapsed - node.assembledAt);
        const envelope = Math.max(0, 1 - assemblyAge / 1_700);
        if (node.halo) {
          node.halo.visible =
            !this.reducedMotion && envelope > 0.002 && node.currentOpacity > 0.002;
        }
        node.haloMaterial.opacity = this.reducedMotion
          ? 0
          : envelope * node.currentOpacity * 0.62;
      }
      const constellation = node.group.getObjectByName("slbit-constellation");
      if (constellation && !this.reducedMotion) {
        constellation.rotation.y = seconds * 0.055;
        constellation.rotation.z = Math.sin(seconds * 0.17) * 0.035;
      }
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
    this.temporalOpacity = THREE.MathUtils.damp(
      this.temporalOpacity,
      this.targetTemporalOpacity,
      4.8,
      delta,
    );
    this.temporalRoot.visible = this.temporalOpacity > 0.002;
    if (!this.reducedMotion) this.temporalRoot.rotation.y = seconds * 0.012;
    for (const material of this.temporalMaterials) {
      if ("opacity" in material) {
        material.transparent = true;
        material.opacity =
          this.temporalOpacity * Number(material.userData.baseOpacity ?? 1);
      }
    }
    const progress = condensed / this.nodes.size;
    if (progress === 1) this.materializationMs ??= elapsed;
    this.callbacks.onCondensationProgress(
      progress,
      progress < 0.34 ? "STRUCTURE" : progress < 0.72 ? "APPEARANCE" : "EVIDENCE",
    );
    if (progress === 1) this.callbacks.onCondensationComplete();

    for (const shader of this.animatedShaders) {
      const time = shader.uniforms.time;
      if (time) time.value = seconds;
    }
    for (const link of this.weaveLinks) {
      const positions = link.line.geometry.attributes.position as THREE.BufferAttribute;
      positions.setXYZ(0, link.from.group.position.x, link.from.group.position.y, link.from.group.position.z);
      positions.setXYZ(1, link.to.group.position.x, link.to.group.position.y, link.to.group.position.z);
      positions.needsUpdate = true;
      const currentDetail = [link.from, link.to].some(
        (node) =>
          node.cell.visual.moments.includes(this.moment) ||
          node.cell.visual.moments.length === ALL_MOMENTS ||
          node.cell.manifest.evidence.disputed,
      );
      const visible =
        this.evidence &&
        link.from.currentOpacity > 0.03 &&
        link.to.currentOpacity > 0.03 &&
        (!this.constrainedRenderer || !this.chronofold || currentDetail);
      link.line.visible = visible;
      link.pulse.visible = visible && !this.constrainedRenderer;
      if (visible) {
        const rate = link.to.cell.manifest.evidence.disputed ? 0.1 : 0.065;
        const position = (seconds * rate + link.phase) % 1;
        if (!this.constrainedRenderer) {
          link.pulse.position.lerpVectors(
            link.from.group.position,
            link.to.group.position,
            position,
          );
          const pulseScale = 0.74 + Math.sin((position + link.phase) * Math.PI) * 0.48;
          link.pulse.scale.setScalar(pulseScale);
        }
        const lineMaterial = link.line.material;
        if (lineMaterial instanceof THREE.LineDashedMaterial) {
          lineMaterial.opacity = link.to.cell.manifest.evidence.disputed
            ? 0.32 + Math.abs(Math.sin(seconds * 2.1 + link.phase * 8)) * 0.2
            : 0.16;
        }
      }
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
