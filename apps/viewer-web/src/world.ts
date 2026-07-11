import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type {
  DemoCell,
  DemoMoment,
  DemoWorld,
  SdfVoxelPoint,
  SurfelPoint,
} from "./types";

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
  activeMeaningFields: number;
  assemblyPoints: number;
  continuumLayers: number;
  scale: ScaleMode;
  scaleDepth: number;
  chronofold: boolean;
  temporalObservations: number;
  sdfVoxels: number;
}

export interface TemporalObservation {
  id: string;
  label: string;
  cell: DemoCell;
  surfels: SurfelPoint[];
  sdfVoxels: SdfVoxelPoint[];
  voxelSizeUm: number;
  alternate: boolean;
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
  meaning: THREE.Group | null;
  currentOpacity: number;
  targetOpacity: number;
  condensed: boolean;
  condenseAt: number;
  assembledAt: number | null;
  momentIndex: number;
}

interface WeaveLink {
  line: THREE.Line | null;
  pulse: THREE.Mesh | null;
  phase: number;
  bend: number;
  segments: number;
  vertexOffset: number;
  from: CellNode;
  to: CellNode;
}

interface ImportedLink {
  line: THREE.Line;
  from: CellNode;
  to: CellNode;
}

interface WorldCallbacks {
  onCellSelected: (cell: DemoCell) => void;
  onCondensationProgress: (value: number, label: string) => void;
  onCondensationComplete: () => void;
  onScaleChanged: (scale: ScaleMode) => void;
  onScaleDepthChanged: (value: number) => void;
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
  private readonly continuumRoot = new THREE.Group();
  private readonly fieldRoot = new THREE.Group();
  private readonly root = new THREE.Group();
  private readonly aggregateRoot = new THREE.Group();
  private readonly temporalRoot = new THREE.Group();
  private readonly importedRoot = new THREE.Group();
  private readonly focusRoot = new THREE.Group();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly nodes = new Map<string, CellNode>();
  private readonly cellsById = new Map<string, CellNode>();
  private readonly interactive: THREE.Object3D[] = [];
  private readonly weaveLinks: WeaveLink[] = [];
  private readonly importedLinks: ImportedLink[] = [];
  private readonly textureCache = new Map<string, THREE.CanvasTexture>();
  private readonly animatedShaders: THREE.ShaderMaterial[] = [];
  private readonly aggregateMaterials: THREE.Material[] = [];
  private readonly temporalMaterials: THREE.Material[] = [];
  private readonly focusMaterials: THREE.MeshBasicMaterial[] = [];
  private readonly keys = new Set<string>();
  private readonly timer = new THREE.Timer();
  private readonly focus = new THREE.Vector3(0, 1.1, 0);
  private readonly targetFocus = new THREE.Vector3(0, 1.1, 0);
  private readonly selectedWorld = new THREE.Vector3();
  private readonly weaveSample = new THREE.Vector3();
  private readonly targetBackground = new THREE.Color("#060b10");
  private readonly sun = new THREE.DirectionalLight("#ffe1a1", 4.1);
  private readonly ambient = new THREE.HemisphereLight("#b9dce0", "#15120f", 2.05);
  private readonly crystalLight = new THREE.PointLight("#73cdd0", 12, 34, 1.8);
  private readonly archiveLight = new THREE.PointLight("#e2b76d", 8, 28, 1.9);
  private readonly constrainedRenderer: boolean;
  private environmentMap: THREE.WebGLRenderTarget | null = null;
  private assemblyMaterial: THREE.ShaderMaterial | null = null;
  private assemblyPointCount = 0;
  private pointerState: { x: number; y: number; moved: boolean } | null = null;
  private yaw = 0.12;
  private pitch = 0.44;
  private targetDistance = 16;
  private distance = 16;
  private scale: ScaleMode = "room";
  private scaleDepth = 0.5;
  private targetScaleDepth = 0.5;
  private moment = "moment-c";
  private chronofold = false;
  private evidence = true;
  private selected: CellNode | null = null;
  private hovered: CellNode | null = null;
  private focusOpacity = 0;
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
  private constrainedWeave: THREE.LineSegments | null = null;
  private importedTemporal = false;
  private importedSdfVoxelCount = 0;
  private importedProvenanceLinks = 0;
  private materializedCellCount = 0;
  private inspectionLayer: "state" | "lineage" | "meaning" | null = null;
  private lastScaleTargetUpdate = -1;
  private lastScaleDepthCallback = -1;
  private adaptivePixelRatio = 1;
  private lastResolutionAdjustmentMs = 0;

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
    this.renderer.toneMappingExposure = 1.14;
    this.adaptivePixelRatio = this.preferredPixelRatio(innerWidth);
    this.renderer.setPixelRatio(this.adaptivePixelRatio);
    this.renderer.shadowMap.enabled = innerWidth > 680 && !this.constrainedRenderer;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.background = new THREE.Color("#03070a");
    this.scene.fog = new THREE.FogExp2("#03070a", 0.014);
    if (!this.constrainedRenderer) {
      const environment = new RoomEnvironment();
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.environmentMap = pmrem.fromScene(environment, 0.035);
      this.scene.environment = this.environmentMap.texture;
      environment.dispose();
      pmrem.dispose();
    }
    this.crystalLight.position.set(-7, 4.5, 2);
    this.archiveLight.position.set(6, 2.8, -5);
    this.scene.add(
      this.continuumRoot,
      this.fieldRoot,
      this.root,
      this.aggregateRoot,
      this.temporalRoot,
      this.importedRoot,
      this.focusRoot,
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
    this.materializedCellCount = this.world.cells.length;
    this.selected = this.nodes.get("archive-c") ?? this.findVisibleArchive();
    this.highlightSelection();
    this.setScale("object");
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
    if (this.importedTemporal) {
      const node = [...this.nodes.values()].find(
        (candidate) => candidate.group.userData.temporalMoment === moment,
      );
      if (node) {
        this.selected = node;
        this.highlightSelection();
      }
    }
    this.updateCellTargets();
  }

  setScale(scale: ScaleMode): void {
    this.scale = scale;
    this.targetScaleDepth = scale === "object" ? 0 : scale === "room" ? 0.5 : 1;
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
      this.targetDistance = innerWidth <= 680 ? 4.15 : 3.05;
      this.pitch = 0.28;
    } else if (scale === "room") {
      this.targetFocus.set(0, 1.1, 0);
      this.targetDistance = 14.5;
      this.pitch = 0.4;
    } else {
      this.targetFocus.set(0, 1.3, 0);
      this.targetDistance = 25;
      this.pitch = 0.72;
    }
    this.updateCellTargets();
    this.callbacks.onScaleChanged(scale);
  }

  setScaleDepth(value: number): void {
    this.targetScaleDepth = THREE.MathUtils.clamp(value, 0, 1);
    const next: ScaleMode =
      this.targetScaleDepth < 0.28
        ? "object"
        : this.targetScaleDepth > 0.74
          ? "site"
          : "room";
    if (next !== this.scale) {
      this.scale = next;
      if (next === "object" && this.selected) {
        this.targetFocus.copy(this.selected.group.position);
      } else if (next !== "object") {
        this.targetFocus.copy(this.importedFrame?.focus ?? new THREE.Vector3(0, 1.1, 0));
      }
      this.callbacks.onScaleChanged(next);
    }
  }

  setInspectionLayer(layer: "state" | "lineage" | "meaning" | null): void {
    this.inspectionLayer = layer;
    for (const node of this.nodes.values()) {
      const rootprint = node.group.getObjectByName("rootprint-memory");
      if (rootprint) rootprint.visible = layer === "lineage" && node === this.selected;
    }
    this.updateMeaningFields();
  }

  pullSelection(): void {
    if (!this.selected) return;
    this.targetFocus.copy(this.selected.group.position);
    this.setScaleDepth(0);
    this.prepareInspection(this.selected);
  }

  setChronofold(active: boolean): void {
    this.chronofold = active;
    this.targetTemporalOpacity = active && !this.importedTemporal ? 1 : 0;
    this.updateCellTargets();
  }

  setEvidence(active: boolean): void {
    this.evidence = active;
    if (this.constrainedWeave) this.constrainedWeave.visible = active;
    for (const link of this.weaveLinks) {
      if (link.line) link.line.visible = active;
      if (link.pulse) link.pulse.visible = active && !this.constrainedRenderer;
    }
    for (const node of this.nodes.values()) {
      const boundary = node.group.getObjectByName("cell-boundary");
      if (boundary) boundary.visible = active;
    }
    this.updateMeaningFields();
    this.updateCellTargets();
  }

  selectCell(key: string): void {
    const node = this.nodes.get(key);
    if (!node) return;
    this.selected = node;
    this.highlightSelection();
    this.callbacks.onCellSelected(node.cell);
    this.updateCellTargets();
    this.updateMeaningFields();
    this.setInspectionLayer(this.inspectionLayer);
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
    this.updateMeaningFields();
  }

  loadSurfelObservation(cell: DemoCell, surfels: SurfelPoint[]): void {
    if (surfels.length === 0) throw new Error("imported observation contains no surfels");
    this.disposeImportedRoot();
    this.importedTemporal = false;
    this.importedSdfVoxelCount = 0;
    this.importedProvenanceLinks = 0;
    this.materializedCellCount = 2;
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
      meaning: null,
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

  loadTemporalObservations(observations: TemporalObservation[]): void {
    if (observations.length < 3 || observations.some((observation) => observation.surfels.length === 0)) {
      throw new Error("temporal Locus requires at least three nonempty observations");
    }
    this.disposeImportedRoot();
    this.root.visible = false;
    this.aggregateRoot.visible = false;
    this.importedRoot.visible = true;
    this.importedTemporal = true;
    this.nodes.clear();
    this.cellsById.clear();
    this.interactive.length = 0;
    this.weaveLinks.length = 0;
    this.constrainedWeave = null;

    const bounds = new THREE.Box3();
    const point = new THREE.Vector3();
    for (const observation of observations) {
      for (const surfel of observation.surfels) {
        point.set(
          surfel.positionUm[0] / 1_000_000,
          surfel.positionUm[2] / 1_000_000,
          -surfel.positionUm[1] / 1_000_000,
        );
        bounds.expandByPoint(point);
      }
    }
    if (bounds.isEmpty()) throw new Error("temporal Locus has no finite geometry");
    const sourceCenter = bounds.getCenter(new THREE.Vector3());
    const localBounds = bounds.clone().translate(sourceCenter.clone().multiplyScalar(-1));
    const size = localBounds.getSize(new THREE.Vector3());
    const radius = Math.max(0.8, size.length() * 0.5);
    const focus = new THREE.Vector3(0, 1.15, 0);
    const momentColors = ["#8fd8cf", "#d9ba76", "#e7e0cf", "#db806d"];
    const canonicalObservations = observations.filter((observation) => !observation.alternate);
    const stableVoxelKeys = canonicalObservations
      .map(
        (observation) =>
          new Set(
            observation.sdfVoxels
              .filter(
                (voxel) => Math.abs(voxel.signedDistanceUm) <= observation.voxelSizeUm,
              )
              .map((voxel) => voxel.coordinate.join(",")),
          ),
      )
      .reduce<Set<string>>((shared, current, index) => {
        if (index === 0) return current;
        return new Set([...shared].filter((key) => current.has(key)));
      }, new Set());

    observations.forEach((observation, observationIndex) => {
      const surfelLimit = this.constrainedRenderer
        ? innerWidth <= 680
          ? 18_000
          : 24_000
        : observation.surfels.length;
      const surfelStride = Math.max(1, Math.ceil(observation.surfels.length / surfelLimit));
      const renderedSurfels = observation.surfels.filter(
        (_surfel, index) => index % surfelStride === 0,
      );
      const positions = new Float32Array(renderedSurfels.length * 3);
      const normals = new Float32Array(renderedSurfels.length * 3);
      const colors = new Float32Array(renderedSurfels.length * 3);
      let radiusSum = 0;
      renderedSurfels.forEach((surfel, index) => {
        positions.set(
          [
            surfel.positionUm[0] / 1_000_000 - sourceCenter.x,
            surfel.positionUm[2] / 1_000_000 - sourceCenter.y,
            -surfel.positionUm[1] / 1_000_000 - sourceCenter.z,
          ],
          index * 3,
        );
        normals.set(
          [
            surfel.normalQ15[0] / 32_767,
            surfel.normalQ15[2] / 32_767,
            -surfel.normalQ15[1] / 32_767,
          ],
          index * 3,
        );
        colors.set(
          [surfel.color[0] / 255, surfel.color[1] / 255, surfel.color[2] / 255],
          index * 3,
        );
        radiusSum += surfel.radiusUm / 1_000_000;
      });
      const surfelGeometry = new THREE.BufferGeometry();
      surfelGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      surfelGeometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
      surfelGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      surfelGeometry.computeBoundingSphere();
      const surfelMaterial = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: true,
        uniforms: {
          opacity: { value: 1 },
          pointSize: {
            value: THREE.MathUtils.clamp(
              (radiusSum / renderedSurfels.length) * 1_800,
              4.2,
              34,
            ),
          },
          pixelRatio: { value: this.renderer.getPixelRatio() },
        },
        vertexShader: [
          "attribute vec3 color;",
          "varying vec3 vColor;",
          "varying vec3 vNormal;",
          "uniform float pointSize;",
          "uniform float pixelRatio;",
          "void main(){",
          "vec4 viewPosition=modelViewMatrix*vec4(position,1.0);",
          "vColor=color;",
          "vNormal=normalize(normalMatrix*normal);",
          "gl_PointSize=clamp(pointSize*pixelRatio/max(0.25,-viewPosition.z),2.8,42.0);",
          "gl_Position=projectionMatrix*viewPosition;",
          "}",
        ].join("\n"),
        fragmentShader: [
          "varying vec3 vColor;",
          "varying vec3 vNormal;",
          "uniform float opacity;",
          "void main(){",
          "vec2 p=gl_PointCoord-vec2(0.5);",
          "float radius=length(p);",
          "if(radius>0.48) discard;",
          "vec3 lightDirection=normalize(vec3(-0.28,0.78,0.46));",
          "float diffuse=0.38+0.62*abs(dot(normalize(vNormal),lightDirection));",
          "float edge=1.0-smoothstep(0.34,0.48,radius);",
          "float core=1.0-smoothstep(0.0,0.46,radius);",
          "vec3 matter=vColor*diffuse+vec3(0.08,0.13,0.12)*core;",
          "gl_FragColor=vec4(matter,opacity*edge);",
          "}",
        ].join("\n"),
      });
      const surfelPoints = new THREE.Points(surfelGeometry, surfelMaterial);
      surfelPoints.name = "observed-surfel-field";
      surfelPoints.userData.cellKey = observation.cell.key;

      const group = new THREE.Group();
      group.name = observation.cell.key;
      group.position.copy(focus);
      group.userData.temporalMoment = observation.id;
      group.userData.alternate = observation.alternate;
      group.add(surfelPoints);

      const nearSurface = observation.sdfVoxels.filter(
        (voxel) => Math.abs(voxel.signedDistanceUm) <= observation.voxelSizeUm,
      );
      const temporalDelta = nearSurface.filter(
        (voxel) => !stableVoxelKeys.has(voxel.coordinate.join(",")),
      );
      const voxelSource =
        temporalDelta.length > 0
          ? temporalDelta
          : nearSurface.length > 0
            ? nearSurface
            : observation.sdfVoxels;
      const maxInstances = this.constrainedRenderer
        ? innerWidth <= 680
          ? 480
          : 700
        : 16_000;
      const stride = Math.max(1, Math.ceil(voxelSource.length / maxInstances));
      const instanceCount = Math.ceil(voxelSource.length / stride);
      const voxelMeters = observation.voxelSizeUm / 1_000_000;
      const voxelGeometry = new THREE.BoxGeometry(
        voxelMeters * 0.66,
        voxelMeters * 0.66,
        voxelMeters * 0.66,
      );
      const voxelMaterial = new THREE.MeshStandardMaterial({
        color: momentColors[observationIndex] ?? "#8fd8cf",
        roughness: 0.68,
        metalness: 0.08,
        transparent: true,
        opacity: 0.48,
        depthWrite: true,
        vertexColors: true,
      });
      voxelMaterial.userData.baseOpacity = observation.alternate ? 0.34 : 0.48;
      const sdfMatter = new THREE.InstancedMesh(voxelGeometry, voxelMaterial, instanceCount);
      sdfMatter.name = "verified-sdf-matter";
      sdfMatter.userData.cellKey = observation.cell.key;
      const matrix = new THREE.Matrix4();
      const baseColor = new THREE.Color(momentColors[observationIndex] ?? "#8fd8cf");
      let instanceIndex = 0;
      for (let index = 0; index < voxelSource.length; index += stride) {
        const voxel = voxelSource[index];
        if (!voxel) continue;
        const x = (voxel.coordinate[0] + 0.5) * voxelMeters - sourceCenter.x;
        const y = (voxel.coordinate[2] + 0.5) * voxelMeters - sourceCenter.y;
        const z = -(voxel.coordinate[1] + 0.5) * voxelMeters - sourceCenter.z;
        const confidence = THREE.MathUtils.clamp(Math.log2(voxel.weight + 1) / 18, 0.55, 1);
        matrix.makeScale(confidence, confidence, confidence);
        matrix.setPosition(x, y, z);
        sdfMatter.setMatrixAt(instanceIndex, matrix);
        const distance = THREE.MathUtils.clamp(
          Math.abs(voxel.signedDistanceUm) / Math.max(1, observation.voxelSizeUm),
          0,
          1,
        );
        sdfMatter.setColorAt(
          instanceIndex,
          baseColor.clone().lerp(new THREE.Color("#f2eee3"), (1 - distance) * 0.34),
        );
        instanceIndex += 1;
      }
      sdfMatter.instanceMatrix.needsUpdate = true;
      if (sdfMatter.instanceColor) sdfMatter.instanceColor.needsUpdate = true;
      sdfMatter.computeBoundingSphere();
      group.add(sdfMatter);

      const boundary = new THREE.LineSegments(
        new THREE.EdgesGeometry(
          new THREE.BoxGeometry(
            Math.max(0.1, size.x),
            Math.max(0.1, size.y),
            Math.max(0.1, size.z),
          ),
        ),
        new THREE.LineBasicMaterial({
          color: momentColors[observationIndex] ?? "#8fd8cf",
          transparent: true,
          opacity: observation.alternate ? 0.22 : 0.12,
        }),
      );
      boundary.name = "cell-boundary";
      group.add(boundary);
      this.createTemporalTraceLayers(
        group,
        observation.cell,
        [size.x, size.y, size.z],
        momentColors[observationIndex] ?? "#8fd8cf",
      );
      this.createSemanticConstellation(
        group,
        observation.cell,
        true,
        [size.x, size.y, size.z],
      );
      this.importedRoot.add(group);

      const node: CellNode = {
        cell: observation.cell,
        group,
        materials: this.collectMaterials(group),
        basePosition: focus.clone(),
        targetPosition: focus.clone(),
        baseQuaternion: group.quaternion.clone(),
        assemblyQuaternion: group.quaternion.clone(),
        halo: null,
        haloMaterial: null,
        meaning: group.getObjectByName("slbit-constellation") as THREE.Group | null,
        currentOpacity: observation.id === "moment-c" ? 1 : 0,
        targetOpacity: observation.id === "moment-c" ? 1 : 0,
        condensed: true,
        condenseAt: 0,
        assembledAt: 0,
        momentIndex: observation.alternate ? 2 : Math.max(0, observationIndex),
      };
      this.nodes.set(observation.cell.key, node);
      this.cellsById.set(observation.cell.cell_id, node);
      this.interactive.push(surfelPoints, sdfMatter);
      this.setOpacity(node, node.currentOpacity);
    });

    const sharedReference = canonicalObservations.at(-1);
    if (sharedReference && stableVoxelKeys.size > 0) {
      const stableSource = sharedReference.sdfVoxels.filter((voxel) =>
        stableVoxelKeys.has(voxel.coordinate.join(",")),
      );
      const stableLimit = this.constrainedRenderer
        ? innerWidth <= 680
          ? 400
          : 600
        : stableSource.length;
      const stableStride = Math.max(1, Math.ceil(stableSource.length / stableLimit));
      const stableVoxels = stableSource.filter(
        (_voxel, index) => index % stableStride === 0,
      );
      const voxelMeters = sharedReference.voxelSizeUm / 1_000_000;
      const geometry = new THREE.BoxGeometry(
        voxelMeters * 0.72,
        voxelMeters * 0.72,
        voxelMeters * 0.72,
      );
      const material = new THREE.MeshStandardMaterial({
        color: "#d9e5d4",
        emissive: "#16231d",
        emissiveIntensity: 0.16,
        roughness: 0.62,
        metalness: 0.1,
        transparent: true,
        opacity: 0.64,
      });
      const sharedMatter = new THREE.InstancedMesh(
        geometry,
        material,
        stableVoxels.length,
      );
      sharedMatter.name = "shared-temporal-structure";
      const matrix = new THREE.Matrix4();
      stableVoxels.forEach((voxel, index) => {
        matrix.makeTranslation(
          (voxel.coordinate[0] + 0.5) * voxelMeters - sourceCenter.x,
          (voxel.coordinate[2] + 0.5) * voxelMeters - sourceCenter.y,
          -(voxel.coordinate[1] + 0.5) * voxelMeters - sourceCenter.z,
        );
        sharedMatter.setMatrixAt(index, matrix);
      });
      sharedMatter.instanceMatrix.needsUpdate = true;
      sharedMatter.computeBoundingSphere();
      const sharedRoot = new THREE.Group();
      sharedRoot.name = "chronofold-shared-structure";
      sharedRoot.position.copy(focus);
      sharedRoot.add(sharedMatter);
      this.importedRoot.add(sharedRoot);
    }

    const byMoment = (id: string) =>
      [...this.nodes.values()].find((node) => node.group.userData.temporalMoment === id);
    for (const [fromId, toId] of [
      ["moment-a", "moment-b"],
      ["moment-b", "moment-c"],
      ["moment-b", "alternate-c"],
    ] as const) {
      const from = byMoment(fromId);
      const to = byMoment(toId);
      if (!from || !to) continue;
      const geometry = new THREE.BufferGeometry().setFromPoints([
        from.group.position.clone(),
        from.group.position.clone(),
        to.group.position.clone(),
      ]);
      const line = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({
          color: toId === "alternate-c" ? "#db806d" : "#8fd8cf",
          transparent: true,
          opacity: toId === "alternate-c" ? 0.52 : 0.34,
          depthWrite: false,
        }),
      );
      line.visible = false;
      this.importedRoot.add(line);
      this.importedLinks.push({ line, from, to });
    }

    this.raycaster.params.Points = { threshold: Math.max(0.025, radius * 0.012) };
    this.importedFrame = { focus, radius };
    this.importedSdfVoxelCount = observations.reduce(
      (total, observation) => total + observation.sdfVoxels.length,
      0,
    );
    this.assemblyPointCount = observations.reduce(
      (total, observation) => total + observation.surfels.length,
      0,
    );
    this.importedProvenanceLinks = this.importedLinks.length;
    this.materializedCellCount = observations.length * 2;
    this.firstStructureMs ??= performance.now() - this.startedAt;
    this.moment = "moment-c";
    this.selected = byMoment("moment-c") ?? [...this.nodes.values()][0] ?? null;
    this.setChronofold(false);
    this.setScale("room");
    this.updateCellTargets();
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
      cellCount: this.materializedCellCount || this.nodes.size,
      provenanceLinks: this.importedTemporal
        ? this.importedProvenanceLinks
        : this.weaveLinks.length,
      temporalManifolds: this.importedTemporal ? this.nodes.size : this.world.moments.length,
      semanticConstellations: [...this.nodes.values()].filter((node) =>
        Boolean(node.meaning),
      ).length,
      activeMeaningFields: [...this.nodes.values()].filter((node) => node.meaning?.visible)
        .length,
      assemblyPoints: this.assemblyPointCount,
      continuumLayers: this.importedTemporal
        ? this.importedRoot.children.length
        : this.continuumRoot.children.length,
      scale: this.scale,
      scaleDepth: this.scaleDepth,
      chronofold: this.chronofold,
      temporalObservations: this.importedTemporal ? this.nodes.size : 0,
      sdfVoxels: this.importedSdfVoxelCount,
    };
  }

  destroy(): void {
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    document.removeEventListener("visibilitychange", this.handleVisibility);
    this.timer.dispose();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse((object) => {
      const renderable = object as THREE.Mesh;
      if (renderable.geometry) geometries.add(renderable.geometry);
      if (!renderable.material) return;
      const values = Array.isArray(renderable.material)
        ? renderable.material
        : [renderable.material];
      values.forEach((material) => materials.add(material));
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    this.textureCache.forEach((texture) => texture.dispose());
    this.textureCache.clear();
    this.environmentMap?.dispose();
    this.environmentMap = null;
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  private detectConstrainedRenderer(): boolean {
    const requested = new URLSearchParams(location.search).get("visual");
    if (requested === "full") return false;
    if (requested === "constrained") return true;
    const context = this.renderer.getContext();
    const debug = context.getExtension("WEBGL_debug_renderer_info");
    const renderer = debug
      ? String(context.getParameter(debug.UNMASKED_RENDERER_WEBGL))
      : String(context.getParameter(context.RENDERER));
    return /swiftshader|llvmpipe|software rasterizer/i.test(renderer);
  }

  private preferredPixelRatio(width: number): number {
    const cap = this.constrainedRenderer
      ? width <= 680
        ? 0.58
        : 0.46
      : width <= 680
        ? 1
        : 1.4;
    return Math.min(devicePixelRatio, cap);
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
    this.importedLinks.length = 0;
  }

  private buildWorld(): void {
    this.createContinuumField();
    this.createAnchorField();

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
      const meaning = group.getObjectByName("slbit-constellation");
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
        meaning: meaning instanceof THREE.Group ? meaning : null,
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
    this.createAssemblyField();
    this.createWeave();
    this.createUnknownBoundary();
    this.createAggregateField();
    this.createTemporalField();
    this.createFocusField();
    this.updateCellTargets();
  }

  private createContinuumField(): void {
    this.continuumRoot.name = "continuum-volume";
    const shellMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        upper: { value: new THREE.Color("#102327") },
        lower: { value: new THREE.Color("#020607") },
      },
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: [
        "varying vec3 vPosition;",
        "void main(){",
        "vPosition=position;",
        "gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);",
        "}",
      ].join("\n"),
      fragmentShader: [
        "uniform float time;",
        "uniform vec3 upper;",
        "uniform vec3 lower;",
        "varying vec3 vPosition;",
        "float hash(vec3 p){return fract(sin(dot(p,vec3(17.13,91.7,43.31)))*43758.5453);}",
        "void main(){",
        "vec3 n=normalize(vPosition);",
        "float horizon=smoothstep(-0.42,0.72,n.y);",
        "float strata=0.5+0.5*sin(n.y*31.0+n.x*5.0+n.z*7.0+time*0.018);",
        "float grain=hash(floor(n*190.0));",
        "vec3 color=mix(lower,upper,horizon);",
        "color+=vec3(0.018,0.032,0.029)*strata*(0.25+0.75*horizon);",
        "color+=vec3(0.012,0.017,0.015)*step(0.992,grain);",
        "gl_FragColor=vec4(color,1.0);",
        "}",
      ].join("\n"),
    });
    this.animatedShaders.push(shellMaterial);
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(72, this.constrainedRenderer ? 20 : 36, 18),
      shellMaterial,
    );
    shell.name = "continuum-shell";
    this.continuumRoot.add(shell);

    const groundMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        opacity: { value: 1 },
        mineral: { value: new THREE.Color("#0b1d1c") },
        vein: { value: new THREE.Color("#31534d") },
      },
      transparent: true,
      depthWrite: true,
      side: THREE.DoubleSide,
      vertexShader: [
        "uniform float time;",
        "varying float vRadius;",
        "varying float vHeight;",
        "varying vec2 vLocal;",
        "void main(){",
        "vec3 p=position;",
        "vLocal=position.xy;",
        "vRadius=length(position.xy);",
        "float broad=sin(position.x*0.31)+cos(position.y*0.27);",
        "float fine=sin((position.x+position.y)*0.84)*0.035;",
        "p.z=broad*0.055+fine;",
        "vHeight=p.z;",
        "gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);",
        "}",
      ].join("\n"),
      fragmentShader: [
        "uniform vec3 mineral;",
        "uniform vec3 vein;",
        "uniform float opacity;",
        "varying float vRadius;",
        "varying float vHeight;",
        "varying vec2 vLocal;",
        "void main(){",
        "if(vRadius>24.5) discard;",
        "float contour=pow(0.5+0.5*sin(vRadius*2.7+vHeight*18.0),10.0);",
        "float fracture=pow(0.5+0.5*sin(vLocal.x*0.43-vLocal.y*0.71),18.0);",
        "float edge=1.0-smoothstep(22.0,24.5,vRadius);",
        "vec3 color=mix(mineral,vein,contour*0.24+fracture*0.12);",
        "gl_FragColor=vec4(color,(0.94*edge+0.06)*opacity);",
        "}",
      ].join("\n"),
    });
    this.animatedShaders.push(groundMaterial);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(50, 50, this.constrainedRenderer ? 28 : 64, this.constrainedRenderer ? 28 : 64),
      groundMaterial,
    );
    ground.name = "constructed-ground";
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.24;
    ground.receiveShadow = true;
    this.continuumRoot.add(ground);

    const seamCells = this.world.cells.filter(
      (cell) => cell.visual.primitive !== "none" && cell.key !== "origin-floor",
    );
    const seamCount = this.constrainedRenderer ? 3 : 4;
    for (let seamIndex = 0; seamIndex < seamCount; seamIndex += 1) {
      const path = seamCells
        .filter((_, index) => index % seamCount === seamIndex)
        .map((cell, index) => {
          const position = cell.visual.position_mm;
          return new THREE.Vector3(
            position[0] / 1000 + Math.sin(index * 1.7 + seamIndex) * 1.1,
            -0.14 + seamIndex * 0.012,
            position[2] / 1000 + Math.cos(index * 1.3 + seamIndex) * 1.35,
          );
        });
      if (path.length < 3) continue;
      const material = new THREE.MeshBasicMaterial({
        color: seamIndex % 2 === 0 ? "#315d55" : "#76583e",
        transparent: true,
        opacity: this.constrainedRenderer ? 0.18 : 0.25,
        depthWrite: false,
      });
      material.userData.baseOpacity = material.opacity;
      const seam = new THREE.Mesh(
        new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3(path, false, "centripetal"),
          this.constrainedRenderer ? 36 : 72,
          0.012 + seamIndex * 0.004,
          4,
          false,
        ),
        material,
      );
      seam.name = "cell-derived-stratum";
      this.continuumRoot.add(seam);
    }
  }

  private createAssemblyField(): void {
    const visibleNodes = [...this.nodes.values()].filter(
      (node) =>
        node.cell.visual.primitive !== "none" &&
        node.cell.key !== "origin-floor" &&
        !node.cell.manifest.evidence.restricted,
    );
    const pointsPerCell = this.constrainedRenderer ? 14 : innerWidth <= 680 ? 22 : 38;
    const total = visibleNodes.length * pointsPerCell;
    if (total === 0) return;
    const target = new Float32Array(total * 3);
    const origin = new Float32Array(total * 3);
    const delay = new Float32Array(total);
    const color = new Float32Array(total * 3);
    const size = new Float32Array(total);
    let cursor = 0;
    for (const node of visibleNodes) {
      const random = seededRandom(node.cell.visual.seed ^ 0xa55e4b1);
      const cellSize = node.cell.visual.size_mm.map((value) => value / 1000) as [
        number,
        number,
        number,
      ];
      const parent = node.cell.manifest.parents
        .map((parentId) => this.cellsById.get(parentId))
        .find(Boolean);
      const source = parent?.basePosition ?? new THREE.Vector3(0, 0.12, 0);
      const pointColor = this.presentationColor(node.cell).lerp(new THREE.Color("#d8eee8"), 0.34);
      for (let index = 0; index < pointsPerCell; index += 1) {
        const axis = index % 3;
        const local: [number, number, number] = [
          (random() - 0.5) * cellSize[0],
          (random() - 0.5) * cellSize[1],
          (random() - 0.5) * cellSize[2],
        ];
        local[axis] = (random() > 0.5 ? 0.5 : -0.5) * (cellSize[axis] ?? 0);
        const targetOffset = cursor * 3;
        target[targetOffset] = node.basePosition.x + (local[0] ?? 0);
        target[targetOffset + 1] = node.basePosition.y + (local[1] ?? 0);
        target[targetOffset + 2] = node.basePosition.z + (local[2] ?? 0);
        const spread = 1.2 + random() * 3.8;
        origin[targetOffset] = source.x + (random() - 0.5) * spread;
        origin[targetOffset + 1] = source.y + (random() - 0.2) * spread;
        origin[targetOffset + 2] = source.z + (random() - 0.5) * spread;
        delay[cursor] = node.condenseAt * 0.001 + random() * 0.52;
        color[targetOffset] = pointColor.r;
        color[targetOffset + 1] = pointColor.g;
        color[targetOffset + 2] = pointColor.b;
        size[cursor] = 1.7 + random() * 1.8;
        cursor += 1;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(target, 3));
    geometry.setAttribute("aOrigin", new THREE.BufferAttribute(origin, 3));
    geometry.setAttribute("aDelay", new THREE.BufferAttribute(delay, 1));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(color, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    this.assemblyMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        opacity: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: [
        "uniform float time;",
        "attribute vec3 aOrigin;",
        "attribute float aDelay;",
        "attribute vec3 aColor;",
        "attribute float aSize;",
        "varying vec3 vColor;",
        "varying float vSettled;",
        "void main(){",
        "float p=clamp((time-aDelay)/1.35,0.0,1.0);",
        "float eased=1.0-pow(1.0-p,4.0);",
        "float resonance=sin(p*3.14159265)*(1.0-p)*0.16;",
        "vec3 direction=normalize(position-aOrigin+vec3(0.0001));",
        "vec3 assembled=mix(aOrigin,position,eased)+direction*resonance;",
        "vec4 mv=modelViewMatrix*vec4(assembled,1.0);",
        "gl_Position=projectionMatrix*mv;",
        "gl_PointSize=aSize*(0.82+0.58*sin(p*3.14159265))*(58.0/max(1.0,-mv.z));",
        "vColor=aColor;",
        "vSettled=p;",
        "}",
      ].join("\n"),
      fragmentShader: [
        "uniform float opacity;",
        "varying vec3 vColor;",
        "varying float vSettled;",
        "void main(){",
        "vec2 p=abs(gl_PointCoord-0.5);",
        "float diamond=1.0-smoothstep(0.28,0.5,p.x+p.y);",
        "if(diamond<=0.001) discard;",
        "float unsettled=1.0-smoothstep(0.72,1.0,vSettled);",
        "float alpha=unsettled*0.82*diamond*opacity;",
        "gl_FragColor=vec4(vColor*(1.15+diamond*0.35),alpha);",
        "}",
      ].join("\n"),
    });
    const points = new THREE.Points(geometry, this.assemblyMaterial);
    points.name = "cell-condensation-field";
    points.frustumCulled = false;
    this.continuumRoot.add(points);
    this.assemblyPointCount = total;
  }

  private createAnchorField(): void {
    this.fieldRoot.name = "anchor-field";
    const anchorMaterial = this.constrainedRenderer
      ? new THREE.MeshBasicMaterial({ color: "#79bdb4" })
      : new THREE.MeshPhysicalMaterial({
          color: "#8fd2c7",
          emissive: "#1e5a54",
          emissiveIntensity: 0.18,
          roughness: 0.24,
          metalness: 0.08,
          clearcoat: 0.72,
          clearcoatRoughness: 0.15,
        });
    const anchorCore = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.2, 1),
      anchorMaterial,
    );
    anchorCore.position.y = 0.04;
    this.fieldRoot.add(anchorCore);

    const seed = Number.parseInt(this.world.anchor_id.slice(-8), 16) || 1;
    const random = seededRandom(seed);
    for (let index = 0; index < 3; index += 1) {
      const geometry = new THREE.IcosahedronGeometry(0.42 + index * 0.19, 1);
      const shell = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, 24),
        new THREE.LineBasicMaterial({
          color: index === 1 ? "#d9bd79" : "#86c9c1",
          transparent: true,
          opacity: 0.12 - index * 0.022,
          depthWrite: false,
        }),
      );
      shell.rotation.set(random() * Math.PI, random() * Math.PI, random() * Math.PI);
      shell.position.y = 0.04;
      shell.userData.rotationRate = (0.018 + random() * 0.018) * (index % 2 ? -1 : 1);
      this.fieldRoot.add(shell);
    }

    const identityLoop = new THREE.Mesh(
      new THREE.TorusKnotGeometry(0.62, 0.008, 96, 3, 2, 5),
      new THREE.MeshBasicMaterial({
        color: "#d7c483",
        transparent: true,
        opacity: 0.26,
        depthWrite: false,
      }),
    );
    identityLoop.position.y = 0.04;
    identityLoop.rotation.x = 0.58;
    identityLoop.userData.rotationRate = -0.012;
    this.fieldRoot.add(identityLoop);
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
      case "box": {
        if (cell.key === "origin-floor") {
          const originPlane = new THREE.Mesh(
            new THREE.PlaneGeometry(size[0], size[2]),
            new THREE.MeshBasicMaterial({
              color: "#000000",
              transparent: true,
              opacity: 0,
              colorWrite: false,
              depthWrite: false,
              side: THREE.DoubleSide,
            }),
          );
          originPlane.rotation.x = -Math.PI / 2;
          group.add(originPlane);
          this.registerInteractive(originPlane, cell);
        } else {
          this.addMesh(group, this.roundedBox(size), material, cell, true);
        }
        break;
      }
      case "wall": {
        const random = seededRandom(cell.visual.seed ^ 0x44a11);
        const shards = this.constrainedRenderer ? 7 : 11;
        const shardMesh = new THREE.InstancedMesh(
          this.roundedBox([1, 1, 1]),
          material,
          shards,
        );
        const matrix = new THREE.Matrix4();
        const quaternion = new THREE.Quaternion();
        const shardScale = new THREE.Vector3();
        const shardPosition = new THREE.Vector3();
        for (let index = 0; index < shards; index += 1) {
          const width = (size[0] / shards) * (0.82 + random() * 0.34);
          const height = size[1] * (0.72 + random() * 0.32);
          shardPosition.set(
            -size[0] / 2 + ((index + 0.5) * size[0]) / shards,
            (height - size[1]) * 0.5,
            (random() - 0.5) * size[2] * 0.22,
          );
          quaternion.setFromEuler(new THREE.Euler(0, 0, (random() - 0.5) * 0.055));
          shardScale.set(width, height, size[2] * (0.72 + random() * 0.28));
          matrix.compose(shardPosition, quaternion, shardScale);
          shardMesh.setMatrixAt(index, matrix);
        }
        shardMesh.instanceMatrix.needsUpdate = true;
        shardMesh.castShadow = true;
        shardMesh.receiveShadow = true;
        group.add(shardMesh);
        this.registerInteractive(shardMesh, cell);
        break;
      }
      case "gallery": {
        const columnMaterial = material.clone();
        const columns = new THREE.InstancedMesh(
          new THREE.CylinderGeometry(0.17, 0.25, 1, 7, 4),
          columnMaterial,
          7,
        );
        const matrix = new THREE.Matrix4();
        const position = new THREE.Vector3();
        const scale = new THREE.Vector3(1, size[1], 1);
        const quaternion = new THREE.Quaternion();
        for (let index = 0; index < 7; index += 1) {
          position.set(-size[0] / 2 + 0.7 + (index * (size[0] - 1.4)) / 6, 0, 0);
          matrix.compose(position, quaternion, scale);
          columns.setMatrixAt(index, matrix);
        }
        columns.instanceMatrix.needsUpdate = true;
        columns.castShadow = true;
        columns.receiveShadow = true;
        group.add(columns);
        this.registerInteractive(columns, cell);
        const lintel = new THREE.Mesh(
          this.roundedBox([size[0], 0.48, size[2] * 1.25]),
          material,
        );
        lintel.position.y = size[1] / 2 - 0.25;
        lintel.castShadow = true;
        group.add(lintel);
        this.registerInteractive(lintel, cell);
        break;
      }
      case "terrace": {
        const steps = new THREE.InstancedMesh(this.roundedBox([1, 1, 1]), material, 4);
        const matrix = new THREE.Matrix4();
        const position = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();
        const stepScale = new THREE.Vector3();
        for (let index = 0; index < 4; index += 1) {
          position.set(
            0,
            -size[1] / 2 + (index + 0.5) * (size[1] / 4),
            index * -0.25,
          );
          stepScale.set(
            size[0] - index * 0.55,
            size[1] / 4,
            size[2] - index * 0.75,
          );
          matrix.compose(position, quaternion, stepScale);
          steps.setMatrixAt(index, matrix);
        }
        steps.instanceMatrix.needsUpdate = true;
        steps.receiveShadow = true;
        steps.castShadow = true;
        group.add(steps);
        this.registerInteractive(steps, cell);
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
          new THREE.CylinderGeometry(size[0] / 2, size[0] * 0.62, size[1], 14, 8),
          material,
          cell,
          true,
        );
        const helixPoints = Array.from({ length: 48 }, (_, index) => {
          const t = index / 47;
          const angle = t * Math.PI * 7 + cell.visual.seed * 0.01;
          const radius = size[0] * (0.43 + Math.sin(t * Math.PI) * 0.08);
          return new THREE.Vector3(
            Math.cos(angle) * radius,
            (t - 0.5) * size[1],
            Math.sin(angle) * radius,
          );
        });
        const helix = new THREE.Mesh(
          new THREE.TubeGeometry(
            new THREE.CatmullRomCurve3(helixPoints),
            72,
            0.012,
            4,
            false,
          ),
          new THREE.MeshBasicMaterial({
            color: "#d7b66e",
            transparent: true,
            opacity: 0.34,
            depthWrite: false,
          }),
        );
        helix.name = "growth-current";
        group.add(helix);
        break;
      }
      case "canopy": {
        const random = seededRandom(cell.visual.seed);
        const count = this.constrainedRenderer ? 72 : 150;
        const leafGeometry = new THREE.OctahedronGeometry(size[0] * 0.034, 0);
        const leafMaterial = this.constrainedRenderer
          ? new THREE.MeshLambertMaterial({
              color: "#ffffff",
              vertexColors: true,
            })
          : new THREE.MeshPhysicalMaterial({
              color: "#ffffff",
              emissive: "#173f2d",
              emissiveIntensity: 0.52,
              roughness: 0.25,
              metalness: 0.04,
              clearcoat: 0.68,
              clearcoatRoughness: 0.2,
              vertexColors: true,
            });
        const foliage = new THREE.InstancedMesh(leafGeometry, leafMaterial, count);
        const matrix = new THREE.Matrix4();
        const quaternion = new THREE.Quaternion();
        const leafScale = new THREE.Vector3();
        const leafPosition = new THREE.Vector3();
        for (let index = 0; index < count; index += 1) {
          const lobe = index % 3;
          const angle = random() * Math.PI * 2;
          const radius = Math.sqrt(random()) * size[0] * 0.34;
          const centerX = (lobe - 1) * size[0] * 0.18;
          leafPosition.set(
            centerX + Math.cos(angle) * radius,
            (random() - 0.42) * size[1] * 0.48 + Math.sin(angle * 2) * 0.08,
            Math.sin(angle) * radius * (0.72 + random() * 0.26),
          );
          quaternion.setFromEuler(
            new THREE.Euler(random() * Math.PI, random() * Math.PI, random() * Math.PI),
          );
          const scalar = 0.58 + random() * 1.22;
          leafScale.set(scalar * 0.55, scalar * 1.5, scalar * 0.72);
          matrix.compose(leafPosition, quaternion, leafScale);
          foliage.setMatrixAt(index, matrix);
          foliage.setColorAt(
            index,
            new THREE.Color(
              index % 17 === 0 ? "#d2c66f" : index % 11 === 0 ? "#75c9bb" : "#6ea781",
            ),
          );
        }
        foliage.instanceMatrix.needsUpdate = true;
        if (foliage.instanceColor) foliage.instanceColor.needsUpdate = true;
        foliage.castShadow = true;
        foliage.receiveShadow = true;
        group.add(foliage);
        this.registerInteractive(foliage, cell);
        break;
      }
      case "grove": {
        const bladeGeometry = new THREE.OctahedronGeometry(0.085, 0);
        const groveMaterial = this.constrainedRenderer
          ? new THREE.MeshLambertMaterial({
              color: "#ffffff",
              vertexColors: true,
            })
          : new THREE.MeshPhysicalMaterial({
              color: "#ffffff",
              emissive: "#123824",
              emissiveIntensity: 0.48,
              roughness: 0.28,
              clearcoat: 0.55,
              vertexColors: true,
            });
        const groveCount = this.constrainedRenderer ? 180 : 360;
        const grove = new THREE.InstancedMesh(bladeGeometry, groveMaterial, groveCount);
        const random = seededRandom(cell.visual.seed);
        const matrix = new THREE.Matrix4();
        const rotation = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        const translation = new THREE.Vector3();
        for (let index = 0; index < groveCount; index += 1) {
          translation.set(
            (random() - 0.5) * size[0],
            -size[1] * 0.42 + random() * 0.18,
            (random() - 0.5) * size[2],
          );
          rotation.setFromEuler(new THREE.Euler(0, random() * Math.PI, (random() - 0.5) * 0.2));
          const bladeScale = 0.55 + random() * 1.1;
          scale.set(bladeScale * 0.38, bladeScale * 2.3, bladeScale * 0.5);
          matrix.compose(translation, rotation, scale);
          grove.setMatrixAt(index, matrix);
          grove.setColorAt(
            index,
            new THREE.Color(index % 19 === 0 ? "#d1c06f" : index % 13 === 0 ? "#6dbbb0" : "#5a946f"),
          );
        }
        grove.instanceMatrix.needsUpdate = true;
        if (grove.instanceColor) grove.instanceColor.needsUpdate = true;
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
        const lightPointMaterial = new THREE.ShaderMaterial({
          uniforms: {
            color: { value: new THREE.Color(cell.visual.color) },
            opacity: { value: 1 },
          },
          transparent: true,
          depthWrite: false,
          vertexShader: [
            "void main(){",
            "gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);",
            `gl_PointSize=${this.constrainedRenderer ? "1.2" : "1.7"};`,
            "}",
          ].join("\n"),
          fragmentShader: [
            "uniform vec3 color;",
            "uniform float opacity;",
            "void main(){",
            "vec2 p=abs(gl_PointCoord-0.5);",
            "float facet=1.0-smoothstep(0.32,0.5,p.x+p.y);",
            "if(facet<=0.001) discard;",
            "gl_FragColor=vec4(color,facet*0.34*opacity);",
            "}",
          ].join("\n"),
        });
        const points = new THREE.Points(
          geometry,
          lightPointMaterial,
        );
        group.add(points);
        const shaftGeometry = new THREE.CylinderGeometry(0.008, 0.035, 5.8, 6, 1, true);
        const shaftMaterial = new THREE.MeshBasicMaterial({
          color: "#d8c68e",
          transparent: true,
          opacity: this.constrainedRenderer ? 0.12 : 0.16,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        shaftMaterial.userData.baseOpacity = shaftMaterial.opacity;
        const shaftCount = this.constrainedRenderer ? 12 : 24;
        const shafts = new THREE.InstancedMesh(shaftGeometry, shaftMaterial, shaftCount);
        const shaftMatrix = new THREE.Matrix4();
        const shaftRotation = new THREE.Quaternion();
        const shaftScale = new THREE.Vector3();
        const shaftPosition = new THREE.Vector3();
        for (let index = 0; index < shaftCount; index += 1) {
          shaftPosition.set(
            (random() - 0.5) * size[0] * 0.82,
            -size[1] * 0.42,
            (random() - 0.5) * size[2] * 0.82,
          );
          shaftRotation.setFromEuler(
            new THREE.Euler((random() - 0.5) * 0.14, random() * Math.PI, (random() - 0.5) * 0.14),
          );
          const shaftWidth = 0.65 + random() * 1.5;
          shaftScale.set(shaftWidth, 0.8 + random() * 0.42, shaftWidth);
          shaftMatrix.compose(shaftPosition, shaftRotation, shaftScale);
          shafts.setMatrixAt(index, shaftMatrix);
        }
        shafts.instanceMatrix.needsUpdate = true;
        shafts.name = "light-architecture";
        group.add(shafts);
        break;
      }
      case "archive-stone": {
        const stone = this.addMesh(
          group,
          new THREE.IcosahedronGeometry(size[0] * 0.34, this.constrainedRenderer ? 1 : 2),
          material,
          cell,
          true,
        );
        stone.rotation.set(0.18, 0.42, -0.12);
        stone.scale.set(0.82, 1.2, 0.82);
        const innerMaterial = this.constrainedRenderer
          ? new THREE.MeshBasicMaterial({ color: "#f2d589" })
          : new THREE.MeshStandardMaterial({
              color: "#d9ae52",
              emissive: "#62400d",
              emissiveIntensity: 0.28,
              roughness: 0.16,
              metalness: 0.26,
            });
        innerMaterial.userData.baseOpacity = innerMaterial.opacity;
        const inner = new THREE.Mesh(
          new THREE.IcosahedronGeometry(size[0] * 0.13, 1),
          innerMaterial,
        );
        inner.name = "memory-core";
        group.add(inner);
        const frame = new THREE.LineSegments(
          new THREE.EdgesGeometry(stone.geometry, 18),
          new THREE.LineBasicMaterial({
            color: "#efe3a5",
            transparent: true,
            opacity: 0.64,
          }),
        );
        frame.scale.copy(stone.scale).multiplyScalar(1.018);
        frame.name = "cell-boundary";
        group.add(frame);
        this.createMemoryArchitecture(group, cell, size[0] * 0.52);
        break;
      }
      case "threshold": {
        const threshold = this.addMesh(
          group,
          new THREE.IcosahedronGeometry(1, this.constrainedRenderer ? 1 : 2),
          material,
          cell,
          true,
        );
        threshold.scale.set(size[0] * 0.54, size[1] * 0.58, size[2] * 0.54);
        threshold.rotation.set(-0.18, cell.key === "threshold-east" ? 0.16 : -0.16, 0.04);
        const thresholdFrame = new THREE.LineSegments(
          new THREE.EdgesGeometry(threshold.geometry, 20),
          new THREE.LineBasicMaterial({
            color: cell.visual.color,
            transparent: true,
            opacity: 0.48,
            depthWrite: false,
          }),
        );
        thresholdFrame.name = "cell-boundary";
        thresholdFrame.scale.copy(threshold.scale).multiplyScalar(1.012);
        thresholdFrame.rotation.copy(threshold.rotation);
        group.add(thresholdFrame);
        break;
      }
      case "none": {
        break;
      }
      default:
        break;
    }
    if (
      cell.visual.primitive !== "none" &&
      cell.visual.primitive !== "privacy" &&
      cell.key !== "origin-floor"
    ) {
      this.createCrystallineLattice(group, cell, size);
    }
    if (
      cell.visual.primitive !== "none" &&
      cell.visual.primitive !== "privacy" &&
      cell.visual.primitive !== "archive-stone" &&
      cell.visual.primitive !== "threshold" &&
      cell.key !== "origin-floor"
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
    if (!cell.manifest.evidence.restricted && cell.semantic_summary.trim()) {
      this.createSemanticConstellation(
        group,
        cell,
        !cell.manifest.evidence.semantic_only,
        size,
      );
    }
    return group;
  }

  private roundedBox(size: [number, number, number]): RoundedBoxGeometry {
    const radius = Math.min(Math.max(Math.min(...size) * 0.11, 0.018), 0.16);
    return new RoundedBoxGeometry(
      size[0],
      size[1],
      size[2],
      this.constrainedRenderer ? 2 : 4,
      radius,
    );
  }

  private createMemoryArchitecture(
    group: THREE.Group,
    cell: DemoCell,
    radius: number,
  ): void {
    const branchCount = this.constrainedRenderer ? 5 : 8;
    const nodesPerBranch = this.constrainedRenderer ? 6 : 10;
    const count = branchCount * nodesPerBranch;
    const random = seededRandom(cell.visual.seed ^ 0x4d454d);
    const nodeGeometry = new THREE.DodecahedronGeometry(radius * 0.038, 0);
    const nodeMaterial = this.constrainedRenderer
      ? new THREE.MeshLambertMaterial({ color: "#f2d28a" })
      : new THREE.MeshStandardMaterial({
          color: "#ffffff",
          emissive: "#9b6e20",
          emissiveIntensity: 0.54,
          roughness: 0.18,
          metalness: 0.22,
          vertexColors: true,
        });
    const nodes = new THREE.InstancedMesh(nodeGeometry, nodeMaterial, count);
    nodes.name = "memory-nodes";
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    const branchPoints: THREE.Vector3[][] = [];
    let nodeIndex = 0;
    for (let branch = 0; branch < branchCount; branch += 1) {
      const points: THREE.Vector3[] = [];
      const baseAngle = (branch / branchCount) * Math.PI * 2 + (random() - 0.5) * 0.12;
      for (let step = 0; step < nodesPerBranch; step += 1) {
        const t = step / Math.max(1, nodesPerBranch - 1);
        const angle = baseAngle + t * (1.18 + (branch % 3) * 0.19);
        const radial = radius * (0.1 + Math.pow(t, 0.78) * (0.78 + (branch % 2) * 0.13));
        position.set(
          Math.cos(angle) * radial,
          radius * (-0.74 + t * 1.72 + Math.sin(t * Math.PI) * 0.34),
          Math.sin(angle) * radial * (0.72 + (branch % 4) * 0.06),
        );
        points.push(position.clone());
        const tangent = new THREE.Vector3(
          -Math.sin(angle),
          0.55 + t * 0.62,
          Math.cos(angle),
        ).normalize();
        quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
        const nodeScale = step === nodesPerBranch - 1 ? 1.65 : 0.68 + t * 0.62;
        scale.set(nodeScale * 0.72, nodeScale * 1.18, nodeScale * 0.72);
        matrix.compose(position, quaternion, scale);
        nodes.setMatrixAt(nodeIndex, matrix);
        if (!this.constrainedRenderer) {
          nodes.setColorAt(
            nodeIndex,
            new THREE.Color(
              step === nodesPerBranch - 1
                ? "#f3dda0"
                : (branch + step) % 7 === 0
                  ? "#78cfc5"
                  : (branch + step) % 5 === 0
                    ? "#ad9dd0"
                    : "#dfbd6c",
            ),
          );
        }
        nodeIndex += 1;
      }
      branchPoints.push(points);
    }
    nodes.instanceMatrix.needsUpdate = true;
    if (nodes.instanceColor) nodes.instanceColor.needsUpdate = true;
    group.add(nodes);

    const segmentCount = branchCount * (nodesPerBranch - 1);
    const branchMaterial = this.constrainedRenderer
      ? new THREE.MeshLambertMaterial({ color: "#d7b765" })
      : new THREE.MeshStandardMaterial({
          color: "#ffffff",
          emissive: "#725015",
          emissiveIntensity: 0.3,
          roughness: 0.2,
          metalness: 0.42,
          vertexColors: true,
        });
    const branches = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(radius * 0.012, radius * 0.021, 1, 6, 1),
      branchMaterial,
      segmentCount,
    );
    branches.name = "memory-lattice";
    let segmentIndex = 0;
    const start = new THREE.Vector3();
    const end = new THREE.Vector3();
    const direction = new THREE.Vector3();
    for (let branch = 0; branch < branchPoints.length; branch += 1) {
      const points = branchPoints[branch] ?? [];
      for (let step = 0; step < points.length - 1; step += 1) {
        start.copy(points[step] ?? new THREE.Vector3());
        end.copy(points[step + 1] ?? start);
        direction.subVectors(end, start);
        const length = Math.max(0.001, direction.length());
        position.addVectors(start, end).multiplyScalar(0.5);
        quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
        scale.set(1, length, 1);
        matrix.compose(position, quaternion, scale);
        branches.setMatrixAt(segmentIndex, matrix);
        if (!this.constrainedRenderer) {
          branches.setColorAt(
            segmentIndex,
            new THREE.Color(
              branch % 4 === 0 ? "#6fbfb7" : branch % 5 === 0 ? "#a795c8" : "#d5b45f",
            ),
          );
        }
        segmentIndex += 1;
      }
    }
    branches.instanceMatrix.needsUpdate = true;
    if (branches.instanceColor) branches.instanceColor.needsUpdate = true;
    group.add(branches);

    const shardCount = this.constrainedRenderer ? 18 : 32;
    const shardGeometry = new THREE.TetrahedronGeometry(radius * 0.14, 1);
    const shardMaterial = this.constrainedRenderer
      ? new THREE.MeshLambertMaterial({
          color: "#edcf82",
        })
      : new THREE.MeshPhysicalMaterial({
          color: "#ffffff",
          roughness: 0.12,
          metalness: 0.12,
          clearcoat: 1,
          clearcoatRoughness: 0.06,
          vertexColors: true,
          transparent: true,
          opacity: 0.72,
          depthWrite: false,
        });
    const shards = new THREE.InstancedMesh(shardGeometry, shardMaterial, shardCount);
    shards.name = "memory-shards";
    for (let index = 0; index < shardCount; index += 1) {
      const branch = index % branchCount;
      const points = branchPoints[branch] ?? [];
      const t = 0.42 + (Math.floor(index / branchCount) / Math.max(1, Math.ceil(shardCount / branchCount) - 1)) * 0.55;
      const pointAt = THREE.MathUtils.clamp(Math.round(t * (points.length - 1)), 0, points.length - 1);
      position.copy(points[pointAt] ?? new THREE.Vector3());
      position.x += (random() - 0.5) * radius * 0.18;
      position.y += (random() - 0.5) * radius * 0.14;
      position.z += (random() - 0.5) * radius * 0.18;
      const outward = position.clone().normalize();
      quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), outward);
      quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(outward, random() * Math.PI));
      scale.set(0.34 + random() * 0.18, 1.02 + t * 0.56, 0.3 + random() * 0.16);
      matrix.compose(position, quaternion, scale);
      shards.setMatrixAt(index, matrix);
      if (!this.constrainedRenderer) {
        shards.setColorAt(
          index,
          new THREE.Color(
            index % 6 === 0 ? "#74cfc5" : index % 5 === 0 ? "#ab9bd2" : "#e2bf69",
          ),
        );
      }
    }
    shards.instanceMatrix.needsUpdate = true;
    if (shards.instanceColor) shards.instanceColor.needsUpdate = true;
    group.add(shards);
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
    const count = this.constrainedRenderer ? 6 : innerWidth <= 680 ? 10 : 16;
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
      if (index > 2 && index % 2 === 0) {
        const cross = points[Math.max(1, index - 2)];
        if (cross) {
          segments.push(point.x, point.y, point.z, cross.x, cross.y, cross.z);
        }
      }
    }
    if (this.constrainedRenderer) {
      const latticeGeometry = new THREE.BufferGeometry();
      latticeGeometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(segments, 3),
      );
      const latticeMaterial = new THREE.LineBasicMaterial({
        color: stateColor,
        transparent: true,
        opacity: cell.manifest.evidence.disputed ? 0.28 : 0.11,
        depthWrite: false,
      });
      latticeMaterial.userData.baseOpacity = latticeMaterial.opacity;
      const lattice = new THREE.LineSegments(latticeGeometry, latticeMaterial);
      lattice.name = "cell-lattice";
      group.add(lattice);
    } else {
      const segmentCount = Math.floor(segments.length / 6);
      const veinMaterial = new THREE.MeshStandardMaterial({
        color: stateColor,
        emissive: stateColor,
        emissiveIntensity: cell.manifest.evidence.disputed ? 0.48 : 0.22,
        roughness: 0.22,
        metalness: 0.34,
        transparent: true,
        opacity: cell.manifest.evidence.disputed ? 0.62 : 0.34,
        depthWrite: false,
      });
      veinMaterial.userData.baseOpacity = veinMaterial.opacity;
      const veins = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.008, 0.014, 1, 5, 1),
        veinMaterial,
        segmentCount,
      );
      const matrix = new THREE.Matrix4();
      const midpoint = new THREE.Vector3();
      const direction = new THREE.Vector3();
      const start = new THREE.Vector3();
      const end = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      for (let index = 0; index < segmentCount; index += 1) {
        const offset = index * 6;
        start.set(segments[offset] ?? 0, segments[offset + 1] ?? 0, segments[offset + 2] ?? 0);
        end.set(
          segments[offset + 3] ?? 0,
          segments[offset + 4] ?? 0,
          segments[offset + 5] ?? 0,
        );
        direction.subVectors(end, start);
        const length = Math.max(0.001, direction.length());
        midpoint.addVectors(start, end).multiplyScalar(0.5);
        quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
        scale.set(1, length, 1);
        matrix.compose(midpoint, quaternion, scale);
        veins.setMatrixAt(index, matrix);
      }
      veins.instanceMatrix.needsUpdate = true;
      veins.name = "cell-lattice";
      group.add(veins);
    }

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

  private createSemanticConstellation(
    group: THREE.Group,
    cell: DemoCell,
    ambient: boolean,
    size: [number, number, number],
  ): void {
    const summarySeed = [...cell.semantic_summary].reduce(
      (value, character) => Math.imul(value ^ character.charCodeAt(0), 16_777_619),
      cell.visual.seed ^ 0x51b17,
    );
    const random = seededRandom(summarySeed);
    const constellationRoot = new THREE.Group();
    constellationRoot.name = "slbit-constellation";
    constellationRoot.userData.ambient = ambient;
    constellationRoot.visible = !ambient;
    const baseHeight = ambient ? Math.max(0.7, size[1] * 0.55 + 0.28) : 2.5;
    constellationRoot.position.y = ambient ? baseHeight : 0;
    const points: THREE.Vector3[] = [];
    const count = ambient
      ? this.constrainedRenderer
        ? 6
        : innerWidth <= 680
          ? 7
          : 9
      : innerWidth <= 680
        ? 10
        : 15;
    const fieldRadius = ambient
      ? THREE.MathUtils.clamp(Math.hypot(size[0], size[2]) * 0.2, 0.42, 1.28)
      : 2.2;
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2 + (random() - 0.5) * 0.28;
      const radius = fieldRadius * (0.68 + random() * 0.42);
      points.push(
        new THREE.Vector3(
          Math.cos(angle) * radius,
          (random() - 0.5) * fieldRadius * 0.62,
          Math.sin(angle) * radius * 0.68,
        ),
      );
    }
    const pointsMaterial = this.constrainedRenderer
      ? new THREE.MeshBasicMaterial({ color: "#b7d9d6" })
      : new THREE.MeshStandardMaterial({
          color: "#b7d9d6",
          emissive: "#426f72",
          emissiveIntensity: 0.42,
          roughness: 0.18,
          metalness: 0.34,
        });
    const nodeSize = ambient ? 0.027 : innerWidth <= 680 ? 0.054 : 0.041;
    const constellation = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(nodeSize, 0),
      pointsMaterial,
      points.length,
    );
    const nodeMatrix = new THREE.Matrix4();
    const nodeQuaternion = new THREE.Quaternion();
    const nodeScale = new THREE.Vector3();
    points.forEach((point, index) => {
      nodeQuaternion.setFromEuler(new THREE.Euler(index * 0.37, index * 0.61, index * 0.23));
      const sizeMultiplier = index % 4 === 0 ? 1.55 : 0.78 + random() * 0.5;
      nodeScale.setScalar(sizeMultiplier);
      nodeMatrix.compose(point, nodeQuaternion, nodeScale);
      constellation.setMatrixAt(index, nodeMatrix);
    });
    constellation.instanceMatrix.needsUpdate = true;
    constellation.name = "slbit-nodes";
    this.registerInteractive(constellation, cell);
    constellationRoot.add(constellation);

    const connections: number[] = [];
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      const next = points[(index + 1) % points.length];
      if (!point || !next) continue;
      connections.push(point.x, point.y, point.z, next.x, next.y, next.z);
      if (index % 3 === 0) {
        connections.push(point.x, point.y, point.z, 0, 0, 0);
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
      opacity: ambient ? 0.14 : 0.2,
      depthWrite: false,
    });
    connectionMaterial.userData.baseOpacity = connectionMaterial.opacity;
    constellationRoot.add(new THREE.LineSegments(connectionGeometry, connectionMaterial));
    group.add(constellationRoot);
  }

  private createTemporalTraceLayers(
    group: THREE.Group,
    cell: DemoCell,
    size: [number, number, number],
    color: string,
  ): void {
    const rootprint = new THREE.Group();
    rootprint.name = "rootprint-memory";
    rootprint.visible = false;
    rootprint.position.set(0, -size[1] * 0.42, size[2] * 0.46);
    const radius = THREE.MathUtils.clamp(Math.hypot(size[0], size[2]) * 0.055, 0.16, 0.44);
    const random = seededRandom(cell.visual.seed ^ Number.parseInt(cell.cell_id.slice(-8), 16));
    const count = Math.max(4, Math.min(8, cell.manifest.parents.length + 5));
    const points = Array.from({ length: count }, (_, index) => {
      const phase = (index / Math.max(1, count - 1) - 0.5) * Math.PI * 1.28;
      return new THREE.Vector3(
        Math.sin(phase) * radius * 1.8,
        Math.cos(phase) * radius * 0.72 + (random() - 0.5) * radius * 0.2,
        (random() - 0.5) * radius * 0.5,
      );
    });
    const nodeMaterial = this.constrainedRenderer
      ? new THREE.MeshBasicMaterial({ color })
      : new THREE.MeshStandardMaterial({
          color,
          emissive: new THREE.Color(color).multiplyScalar(0.18),
          emissiveIntensity: 0.28,
          roughness: 0.42,
          metalness: 0.16,
        });
    const nodes = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(radius * 0.11, 0),
      nodeMaterial,
      count,
    );
    const matrix = new THREE.Matrix4();
    points.forEach((position, index) => {
      matrix.makeTranslation(position.x, position.y, position.z);
      nodes.setMatrixAt(index, matrix);
    });
    nodes.instanceMatrix.needsUpdate = true;
    nodes.name = "rootprint-nodes";
    rootprint.add(nodes);
    const segments: number[] = [];
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1];
      const to = points[index];
      if (!from || !to) continue;
      segments.push(from.x, from.y, from.z, to.x, to.y, to.z);
    }
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(segments, 3),
    );
    rootprint.add(
      new THREE.LineSegments(
        lineGeometry,
        new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: 0.62,
          depthWrite: false,
        }),
      ),
    );
    group.add(rootprint);
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
    if (material.includes("archive")) return color.lerp(new THREE.Color("#76592f"), 0.68);
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
  ): THREE.ShaderMaterial {
    const displayColor = this.presentationColor(cell);
    const disputed = cell.manifest.evidence.disputed;
    const archive = cell.visual.material.includes("archive");
    const accent = archive
      ? new THREE.Color("#f2d68b")
      : disputed
        ? new THREE.Color("#ef927a")
        : displayColor.clone().lerp(new THREE.Color("#9ee0d6"), 0.5);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        baseColor: { value: displayColor },
        accentColor: { value: accent },
        time: { value: 0 },
        opacity: { value: disputed ? 0.78 : 1 },
        selected: { value: 0 },
        seed: { value: (cell.visual.seed % 10_007) / 10_007 },
        detail: { value: this.constrainedRenderer ? 0.48 : archive ? 1.35 : 1 },
      },
      transparent: true,
      depthWrite: !disputed,
      vertexColors: true,
      vertexShader: [
        "varying vec3 vNormalView;",
        "varying vec3 vViewDirection;",
        "varying vec3 vLocal;",
        "varying vec3 vInstanceTint;",
        "void main(){",
        "vec4 localPosition=vec4(position,1.0);",
        "vec3 localNormal=normal;",
        "vInstanceTint=vec3(1.0);",
        "#ifdef USE_INSTANCING",
        "localPosition=instanceMatrix*localPosition;",
        "localNormal=mat3(instanceMatrix)*localNormal;",
        "#endif",
        "#ifdef USE_INSTANCING_COLOR",
        "vInstanceTint=instanceColor;",
        "#endif",
        "vec4 viewPosition=modelViewMatrix*localPosition;",
        "vNormalView=normalize(normalMatrix*localNormal);",
        "vViewDirection=normalize(-viewPosition.xyz);",
        "vLocal=localPosition.xyz;",
        "gl_Position=projectionMatrix*viewPosition;",
        "}",
      ].join("\n"),
      fragmentShader: [
        "uniform vec3 baseColor;",
        "uniform vec3 accentColor;",
        "uniform float time;",
        "uniform float opacity;",
        "uniform float selected;",
        "uniform float seed;",
        "uniform float detail;",
        "varying vec3 vNormalView;",
        "varying vec3 vViewDirection;",
        "varying vec3 vLocal;",
        "varying vec3 vInstanceTint;",
        "void main(){",
        "vec3 n=normalize(vNormalView);",
        "vec3 v=normalize(vViewDirection);",
        "vec3 lightA=normalize(vec3(-0.42,0.74,0.52));",
        "vec3 lightB=normalize(vec3(0.67,0.18,-0.72));",
        "float diffuse=0.28+0.58*max(dot(n,lightA),0.0)+0.18*max(dot(n,lightB),0.0);",
        "float rim=pow(1.0-max(dot(n,v),0.0),2.4);",
        "float strata=0.5+0.5*sin(dot(vLocal,vec3(8.7,5.3,11.9))*detail+seed*37.0);",
        "float cross=0.5+0.5*sin(dot(vLocal,vec3(-13.1,7.2,4.6))*detail-seed*19.0);",
        "float vein=pow(max(strata,cross),18.0);",
        "float facet=0.5+0.5*sin((n.x*2.9+n.y*4.7+n.z*7.1+seed)*9.0);",
        "vec3 color=baseColor*vInstanceTint*(diffuse*(0.82+facet*0.18));",
        "color=mix(color,accentColor,vein*(0.08+detail*0.06));",
        "color+=accentColor*rim*(0.16+selected*0.3);",
        "color+=accentColor*selected*(0.06+0.05*sin(time*0.35+seed*12.0));",
        "gl_FragColor=vec4(color,opacity);",
        "}",
      ].join("\n"),
    });
    material.userData.cellMaterial = true;
    this.animatedShaders.push(material);
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
    if (!this.constrainedRenderer || this.weaveLinks.length === 0) return;
    const verticesPerLink = (this.weaveLinks[0]?.segments ?? 0) * 2;
    const positions = new Float32Array(this.weaveLinks.length * verticesPerLink * 3);
    const colors = new Float32Array(positions.length);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const positionAttribute = geometry.getAttribute("position") as THREE.BufferAttribute;
    const colorAttribute = geometry.getAttribute("color") as THREE.BufferAttribute;
    this.weaveLinks.forEach((link, linkIndex) => {
      link.vertexOffset = linkIndex * verticesPerLink;
      const color = new THREE.Color(
        link.to.cell.manifest.evidence.disputed ? "#e1846f" : "#76c8c8",
      );
      for (let segment = 0; segment < link.segments; segment += 1) {
        const first = this.weavePosition(
          link.from.group.position,
          link.to.group.position,
          segment / link.segments,
          link.bend,
        );
        const second = this.weavePosition(
          link.from.group.position,
          link.to.group.position,
          (segment + 1) / link.segments,
          link.bend,
        );
        const offset = link.vertexOffset + segment * 2;
        positionAttribute.setXYZ(offset, first.x, first.y, first.z);
        positionAttribute.setXYZ(offset + 1, second.x, second.y, second.z);
        colorAttribute.setXYZ(offset, color.r, color.g, color.b);
        colorAttribute.setXYZ(offset + 1, color.r, color.g, color.b);
      }
    });
    positionAttribute.needsUpdate = true;
    colorAttribute.needsUpdate = true;
    this.constrainedWeave = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      }),
    );
    this.constrainedWeave.name = "rootprint-current-field";
    this.root.add(this.constrainedWeave);
  }

  private addWeaveLink(from: CellNode, to: CellNode): void {
    const phase = (to.cell.visual.seed % 997) / 997;
    const bend = ((to.cell.visual.seed % 211) / 211 - 0.5) * 1.7;
    const segments = this.constrainedRenderer ? 8 : 22;
    if (this.constrainedRenderer) {
      this.weaveLinks.push({
        line: null,
        pulse: null,
        phase,
        bend,
        segments,
        vertexOffset: 0,
        from,
        to,
      });
      return;
    }
    const points = Array.from({ length: segments + 1 }, (_, index) =>
      this.weavePosition(from.group.position, to.group.position, index / segments, bend),
    );
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
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
      phase,
      bend,
      segments,
      vertexOffset: 0,
      from,
      to,
    });
  }

  private weavePosition(
    from: THREE.Vector3,
    to: THREE.Vector3,
    t: number,
    bend: number,
    target = new THREE.Vector3(),
  ): THREE.Vector3 {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const planar = Math.max(0.001, Math.hypot(dx, dz));
    const midX = (from.x + to.x) * 0.5 + (-dz / planar) * bend;
    const midY = (from.y + to.y) * 0.5 + 0.34 + planar * 0.045;
    const midZ = (from.z + to.z) * 0.5 + (dx / planar) * bend;
    const inverse = 1 - t;
    return target.set(
      inverse * inverse * from.x + 2 * inverse * t * midX + t * t * to.x,
      inverse * inverse * from.y + 2 * inverse * t * midY + t * t * to.y,
      inverse * inverse * from.z + 2 * inverse * t * midZ + t * t * to.z,
    );
  }

  private createFocusField(): void {
    this.focusRoot.name = "cell-resonance-focus";
    this.focusRoot.visible = false;
    const focusMaterial = new THREE.MeshBasicMaterial({
      color: "#84cec5",
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const braces = new THREE.InstancedMesh(
      new THREE.TetrahedronGeometry(0.095, 0),
      focusMaterial,
      12,
    );
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    for (let index = 0; index < 12; index += 1) {
      const angle = (index / 12) * Math.PI * 2;
      const elevation = index % 3 === 0 ? 0.48 : index % 3 === 1 ? 0 : -0.42;
      position.set(Math.cos(angle) * 0.92, elevation, Math.sin(angle) * 0.92);
      quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), position.clone().normalize());
      scale.set(0.7, 2.1, 0.7);
      matrix.compose(position, quaternion, scale);
      braces.setMatrixAt(index, matrix);
    }
    braces.instanceMatrix.needsUpdate = true;
    braces.userData.rotationRate = 0.035;
    this.focusRoot.add(braces);
    this.focusMaterials.push(focusMaterial);
  }

  private updateMeaningFields(): void {
    for (const node of this.nodes.values()) {
      if (!node.meaning) continue;
      const ambient = Boolean(node.meaning.userData.ambient);
      node.meaning.visible =
        this.evidence && (!ambient || node === this.selected || node === this.hovered);
    }
  }

  private setHovered(node: CellNode | null): void {
    if (node === this.hovered) return;
    this.hovered = node;
    this.canvas.dataset.focus = node?.cell.key ?? "";
    this.canvas.style.cursor = node ? "pointer" : "grab";
    this.updateMeaningFields();
  }

  private createUnknownBoundary(): void {
    const points = [
      new THREE.Vector3(-9, 0, 8.5),
      new THREE.Vector3(-4, 0, 9.8),
      new THREE.Vector3(0, 0, 9.2),
      new THREE.Vector3(4, 0, 10.1),
      new THREE.Vector3(9, 0, 8.6),
    ];
    const count = 24;
    const fragments = new THREE.InstancedMesh(
      new THREE.TetrahedronGeometry(0.19, 0),
      new THREE.MeshBasicMaterial({ color: "#65736d", transparent: true, opacity: 0.36 }),
      count,
    );
    const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    for (let index = 0; index < count; index += 1) {
      const t = index / (count - 1);
      const point = curve.getPoint(t);
      point.y += 0.12 + Math.sin(index * 1.7) * 0.16;
      quaternion.setFromEuler(new THREE.Euler(index * 0.31, index * 0.61, index * 0.19));
      const width = 0.5 + (index % 5) * 0.13;
      scale.set(width, 1.5 + (index % 4) * 0.55, width * 0.72);
      matrix.compose(point, quaternion, scale);
      fragments.setMatrixAt(index, matrix);
    }
    fragments.instanceMatrix.needsUpdate = true;
    fragments.name = "open-continuum-edge";
    this.root.add(fragments);
  }

  private createAggregateField(): void {
    this.aggregateRoot.name = "site-aggregate-field";
    this.aggregateRoot.position.y = 0.08;
    const visibleNodes = [...this.nodes.values()].filter(
      (node) => node.cell.visual.primitive !== "none",
    );
    if (visibleNodes.length === 0) return;

    const markerGeometry = new THREE.OctahedronGeometry(0.13, 0);
    const markerMaterial = this.constrainedRenderer
      ? new THREE.MeshBasicMaterial({
          color: "#d7d2bd",
          vertexColors: true,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        })
      : new THREE.MeshPhysicalMaterial({
          color: "#d7d2bd",
          roughness: 0.18,
          metalness: 0.08,
          clearcoat: 1,
          clearcoatRoughness: 0.08,
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
      translation.set(
        node.basePosition.x * 0.72,
        0.62 + node.momentIndex * 1.2 + radius * 0.18,
        node.basePosition.z * 0.72,
      );
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

    const origin = new THREE.Vector3(0, 1.72, 0);
    const relationPositions: number[] = [];
    for (const node of visibleNodes) {
      relationPositions.push(origin.x, origin.y, origin.z);
      relationPositions.push(
        node.basePosition.x * 0.72,
        0.62 + node.momentIndex * 1.2,
        node.basePosition.z * 0.72,
      );
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

    const stemsMaterial = new THREE.MeshBasicMaterial({
      color: "#557d75",
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    stemsMaterial.userData.baseOpacity = 0.22;
    const stems = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.012, 0.035, 1, 5, 1),
      stemsMaterial,
      visibleNodes.length,
    );
    visibleNodes.forEach((node, index) => {
      const height = 0.62 + node.momentIndex * 1.2;
      translation.set(node.basePosition.x * 0.72, height * 0.5, node.basePosition.z * 0.72);
      scale.set(1, height, 1);
      matrix.compose(translation, quaternion, scale);
      stems.setMatrixAt(index, matrix);
    });
    stems.instanceMatrix.needsUpdate = true;
    this.aggregateRoot.add(stems);

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
      .map(
        (point, index) =>
          new THREE.Vector3(point.x * 0.72, 0.9 + index * 0.34, point.z * 0.72),
      );
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
      const height = (index - 1) * 2.8 + 1.2;
      const momentColor = new THREE.Color(moment.environment.sun).lerp(
        new THREE.Color(index === 1 ? "#72c9ca" : index === 0 ? "#9a8ec3" : "#e1bc72"),
        0.62,
      );
      const ribbonMaterial = new THREE.MeshBasicMaterial({
        color: momentColor,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      ribbonMaterial.userData.baseOpacity = index === 1 ? 0.075 : 0.052;
      const columns = this.constrainedRenderer ? 24 : 48;
      const positions: number[] = [];
      const indices: number[] = [];
      const upperEdge: THREE.Vector3[] = [];
      const lowerEdge: THREE.Vector3[] = [];
      for (let column = 0; column <= columns; column += 1) {
        const t = column / columns;
        const x = (t - 0.5) * 24;
        const z =
          Math.sin(t * Math.PI * 2 + index * 0.82) * 1.1 +
          Math.sin(t * Math.PI * 5 - index * 0.37) * 0.24 +
          (index - 1) * 0.7;
        const lower = height - 1.1 - Math.sin(t * Math.PI) * 0.25;
        const upper = height + 1.1 + Math.sin(t * Math.PI) * 0.38;
        positions.push(x, lower, z, x, upper, z + 0.12);
        lowerEdge.push(new THREE.Vector3(x, lower, z));
        upperEdge.push(new THREE.Vector3(x, upper, z + 0.12));
        if (column < columns) {
          const offset = column * 2;
          indices.push(offset, offset + 1, offset + 2, offset + 1, offset + 3, offset + 2);
        }
      }
      const ribbonGeometry = new THREE.BufferGeometry();
      ribbonGeometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3),
      );
      ribbonGeometry.setIndex(indices);
      ribbonGeometry.computeVertexNormals();
      this.temporalRoot.add(new THREE.Mesh(ribbonGeometry, ribbonMaterial));
      this.temporalMaterials.push(ribbonMaterial);

      const edgeMaterial = new THREE.LineBasicMaterial({
        color: momentColor,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      edgeMaterial.userData.baseOpacity = index === 1 ? 0.29 : 0.19;
      this.temporalRoot.add(
        new THREE.Line(new THREE.BufferGeometry().setFromPoints(upperEdge), edgeMaterial),
      );
      this.temporalMaterials.push(edgeMaterial);
      if (!this.constrainedRenderer) {
        const lowerEdgeMaterial = edgeMaterial.clone();
        lowerEdgeMaterial.userData.baseOpacity = edgeMaterial.userData.baseOpacity;
        this.temporalRoot.add(
          new THREE.Line(new THREE.BufferGeometry().setFromPoints(lowerEdge), lowerEdgeMaterial),
        );
        this.temporalMaterials.push(lowerEdgeMaterial);
      }
    });
    this.temporalRoot.visible = false;
  }

  private updateCellTargets(): void {
    const objectFocus = this.selected ?? this.findVisibleArchive();
    this.targetAggregateOpacity = !this.importedFrame && this.scale === "site" ? 1 : 0;
    for (const node of this.nodes.values()) {
      if (this.importedFrame) {
        node.targetPosition.copy(node.basePosition);
        if (!this.importedTemporal) {
          node.targetOpacity = 1;
          continue;
        }
        const temporalMoment = String(node.group.userData.temporalMoment ?? "");
        const alternate = Boolean(node.group.userData.alternate);
        const active = temporalMoment === this.moment && !alternate;
        const scaleVisibility =
          this.scaleDepth < 0.3 && node !== this.selected ? 0.06 : 1;
        node.targetOpacity =
          (this.chronofold ? (alternate ? 0.52 : active ? 1 : 0.34) : active ? 1 : 0) *
          scaleVisibility;
        if (this.chronofold) {
          const separation = THREE.MathUtils.clamp(this.importedFrame.radius * 1.35, 2.8, 7.5);
          const phase = temporalMoment === "moment-a" ? -1 : temporalMoment === "moment-b" ? 0 : 1;
          node.targetPosition.x += phase * separation;
          node.targetPosition.z += phase * 0.42;
          if (alternate) {
            node.targetPosition.y += separation * 0.32;
            node.targetPosition.z += separation * 0.5;
          }
        }
        node.group.traverse((object) => {
          if (object.name === "cell-boundary") {
            object.visible = this.evidence && (node === this.selected || this.chronofold);
          }
          if (object.name === "verified-sdf-matter") {
            object.visible = this.scaleDepth >= 0.14 || node === this.selected;
          }
        });
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
        scaleOpacity = semanticOnly ? 0.12 : node === objectFocus ? 1 : related ? 0.12 : 0.012;
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
        if (object.name === "cell-lattice") {
          object.visible =
            detailedEvidence &&
            (node === this.selected ||
              node === this.hovered ||
              node.cell.manifest.evidence.disputed);
        }
        if (object.name === "cell-boundary") {
          object.visible =
            detailedEvidence &&
            (node === this.selected ||
              node === this.hovered ||
              node.cell.manifest.evidence.disputed);
        }
      });
      if (this.chronofold && !shared) {
        node.targetPosition.y += (node.momentIndex - 1) * 2.8;
        if (node.cell.manifest.evidence.disputed) {
          node.targetPosition.x += node.cell.visual.branch === "east-hypothesis" ? 1.1 : -1.1;
        }
      }
    }
    this.updateMeaningFields();
  }

  private applyEnvironment(moment: DemoMoment): void {
    const momentIndex = Math.max(
      0,
      this.world.moments.findIndex((candidate) => candidate.id === moment.id),
    );
    this.targetBackground
      .set(moment.environment.sky)
      .lerp(new THREE.Color("#04080d"), 0.88);
    this.sun.color.set(moment.environment.sun);
    this.sun.intensity = moment.environment.sun_milli / 270;
    const azimuth = [-1.04, -0.18, 0.72][momentIndex] ?? 0.72;
    const elevation = [0.34, 0.72, 0.58][momentIndex] ?? 0.58;
    const radius = 17;
    this.sun.position.set(
      Math.cos(azimuth) * Math.cos(elevation) * radius,
      Math.sin(elevation) * radius,
      Math.sin(azimuth) * Math.cos(elevation) * radius,
    );
    this.ambient.color
      .set(moment.environment.sky)
      .lerp(new THREE.Color("#a7d2d3"), 0.72);
    this.crystalLight.intensity = 8 + moment.environment.fog_ppm / 2_800;
    this.archiveLight.intensity = 7 + moment.environment.sun_milli / 300;
    this.scene.fog = new THREE.FogExp2(
      this.targetBackground,
      moment.environment.fog_ppm / 1_400_000 + 0.014,
    );
    const shell = this.continuumRoot.getObjectByName("continuum-shell");
    if (shell instanceof THREE.Mesh && shell.material instanceof THREE.ShaderMaterial) {
      shell.material.uniforms.upper!.value
        .set(moment.environment.sky)
        .lerp(new THREE.Color("#18342f"), 0.72);
      shell.material.uniforms.lower!.value
        .set(moment.environment.sky)
        .lerp(new THREE.Color("#010304"), 0.94);
    }
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
        material.transparent = true;
        material.depthWrite = opacity > 0.985;
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
          if (
            material instanceof THREE.MeshStandardMaterial
          ) {
            material.userData.baseEmissive ??= material.emissive.getHex();
            material.userData.baseEmissiveIntensity ??= material.emissiveIntensity;
            material.emissive.setHex(
              selected ? 0xb7c984 : Number(material.userData.baseEmissive ?? 0),
            );
            material.emissiveIntensity = selected
              ? 0.22
              : Number(material.userData.baseEmissiveIntensity ?? 1);
          } else if (material instanceof THREE.ShaderMaterial && material.uniforms.selected) {
            material.uniforms.selected.value = selected ? 1 : 0;
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
      this.canvas.style.cursor = "grabbing";
      this.pointerState = { x: event.clientX, y: event.clientY, moved: false };
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (!this.pointerState) {
        this.setHovered(this.nodeAt(event));
        return;
      }
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
      this.setHovered(this.nodeAt(event));
    });
    this.canvas.addEventListener("pointercancel", () => {
      this.pointerState = null;
      this.setHovered(null);
    });
    this.canvas.addEventListener("pointerleave", () => this.setHovered(null));
    this.canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const normalized = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY;
        this.setScaleDepth(this.targetScaleDepth + normalized * 0.00072);
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
    const node = this.nodeAt(event);
    if (node) this.selectCell(node.cell.key);
  }

  private nodeAt(event: PointerEvent): CellNode | null {
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
    return key ? (this.nodes.get(key) ?? null) : null;
  }

  private resize(): void {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.adaptivePixelRatio = Math.min(
      this.adaptivePixelRatio,
      this.preferredPixelRatio(width),
    );
    this.renderer.setPixelRatio(this.adaptivePixelRatio);
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
    if (this.assemblyMaterial) {
      this.assemblyMaterial.uniforms.time!.value = this.reducedMotion ? 100 : elapsed * 0.001;
    }
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
      if (constellation?.visible && !this.reducedMotion) {
        const focused = node === this.hovered || node === this.selected;
        constellation.rotation.y = seconds * (focused ? 0.12 : 0.038);
        constellation.rotation.z = Math.sin(seconds * 0.17 + node.momentIndex) * 0.045;
      }
      const memoryCore = node.group.getObjectByName("memory-core");
      if (memoryCore && !this.reducedMotion) {
        memoryCore.rotation.x = seconds * 0.18;
        memoryCore.rotation.y = seconds * 0.24;
      }
      const memoryLattice = node.group.getObjectByName("memory-lattice");
      const memoryNodes = node.group.getObjectByName("memory-nodes");
      const memoryShards = node.group.getObjectByName("memory-shards");
      if (!this.reducedMotion) {
        node.group.children.forEach((child) => {
          if (child.name !== "memory-weave") return;
          const rate = Number(child.userData.rotationRate ?? 0.02);
          child.rotation.x += delta * rate * 0.52;
          child.rotation.y += delta * rate;
        });
        if (memoryLattice) memoryLattice.rotation.y = -seconds * 0.07;
        if (memoryNodes) memoryNodes.rotation.y = seconds * 0.045;
        if (memoryShards) {
          memoryShards.rotation.x = Math.sin(seconds * 0.08) * 0.04;
          memoryShards.rotation.y = -seconds * 0.025;
        }
      }
      if (!this.reducedMotion) {
        node.group.children.forEach((child, index) => {
          if (child.name !== "memory-orbit") return;
          child.rotation.z += delta * (0.08 + index * 0.025);
          child.rotation.y += delta * (index % 2 === 0 ? 0.055 : -0.055);
        });
      }
    }
    for (const link of this.importedLinks) {
      const positions = link.line.geometry.getAttribute("position") as THREE.BufferAttribute;
      const from = link.from.group.position;
      const to = link.to.group.position;
      positions.setXYZ(0, from.x, from.y, from.z);
      positions.setXYZ(
        1,
        (from.x + to.x) * 0.5,
        Math.max(from.y, to.y) + 0.72,
        (from.z + to.z) * 0.5,
      );
      positions.setXYZ(2, to.x, to.y, to.z);
      positions.needsUpdate = true;
      link.line.visible =
        this.evidence &&
        this.chronofold &&
        link.from.currentOpacity > 0.03 &&
        link.to.currentOpacity > 0.03;
    }
    if (!this.reducedMotion) {
      this.fieldRoot.children.forEach((child) => {
        const rate = Number(child.userData.rotationRate ?? 0);
        if (rate !== 0) child.rotation.y += delta * rate;
      });
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
    if (!this.reducedMotion) this.temporalRoot.rotation.y = Math.sin(seconds * 0.12) * 0.028;
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
      if (this.constrainedRenderer && this.constrainedWeave) {
        const positions = this.constrainedWeave.geometry.attributes.position as THREE.BufferAttribute;
        if (!visible) {
          for (let index = 0; index < link.segments; index += 1) {
            const offset = link.vertexOffset + index * 2;
            positions.setXYZ(
              offset,
              link.from.group.position.x,
              link.from.group.position.y,
              link.from.group.position.z,
            );
            positions.setXYZ(
              offset + 1,
              link.from.group.position.x,
              link.from.group.position.y,
              link.from.group.position.z,
            );
          }
          continue;
        }
        for (let index = 0; index < link.segments; index += 1) {
          const first = this.weavePosition(
            link.from.group.position,
            link.to.group.position,
            index / link.segments,
            link.bend,
            this.weaveSample,
          );
          const offset = link.vertexOffset + index * 2;
          positions.setXYZ(offset, first.x, first.y, first.z);
          const second = this.weavePosition(
            link.from.group.position,
            link.to.group.position,
            (index + 1) / link.segments,
            link.bend,
            this.weaveSample,
          );
          positions.setXYZ(offset + 1, second.x, second.y, second.z);
        }
        this.constrainedWeave.visible = this.evidence;
        continue;
      }
      if (!link.line || !link.pulse) continue;
      const positions = link.line.geometry.attributes.position as THREE.BufferAttribute;
      for (let index = 0; index <= link.segments; index += 1) {
        const point = this.weavePosition(
          link.from.group.position,
          link.to.group.position,
          index / link.segments,
          link.bend,
          this.weaveSample,
        );
        positions.setXYZ(index, point.x, point.y, point.z);
      }
      positions.needsUpdate = true;
      link.line.computeLineDistances();
      link.line.visible = visible;
      link.pulse.visible = visible;
      if (visible) {
        const focused = [this.selected, this.hovered].some(
          (node) => node === link.from || node === link.to,
        );
        const rate = (link.to.cell.manifest.evidence.disputed ? 0.1 : 0.065) *
          (focused ? 1.9 : 1);
        const position = (seconds * rate + link.phase) % 1;
        if (!this.constrainedRenderer) {
          this.weavePosition(
            link.from.group.position,
            link.to.group.position,
            position,
            link.bend,
            link.pulse.position,
          );
          const pulseScale = 0.74 + Math.sin((position + link.phase) * Math.PI) * 0.48;
          link.pulse.scale.setScalar(pulseScale * (focused ? 1.28 : 1));
          const pulseMaterial = link.pulse.material;
          if (pulseMaterial instanceof THREE.MeshBasicMaterial) {
            pulseMaterial.opacity = focused ? 0.94 : 0.68;
          }
        }
        const lineMaterial = link.line.material;
        if (lineMaterial instanceof THREE.LineDashedMaterial) {
          lineMaterial.opacity = link.to.cell.manifest.evidence.disputed
            ? 0.32 + Math.abs(Math.sin(seconds * 2.1 + link.phase * 8)) * 0.2
            : focused
              ? 0.46
              : 0.13;
        }
      }
    }
    if (this.constrainedWeave) {
      const positions = this.constrainedWeave.geometry.attributes.position as THREE.BufferAttribute;
      positions.needsUpdate = true;
    }
    const focusNode = this.hovered ?? this.selected;
    this.focusOpacity = THREE.MathUtils.damp(
      this.focusOpacity,
      focusNode ? 1 : 0,
      8,
      delta,
    );
    this.focusRoot.visible = this.focusOpacity > 0.002;
    if (focusNode) {
      this.focusRoot.position.lerp(focusNode.group.position, 1 - Math.exp(-delta * 9));
      const extent = focusNode.cell.visual.size_mm;
      const radius = THREE.MathUtils.clamp(
        Math.hypot(extent[0], extent[1], extent[2]) / 4_800,
        0.7,
        2.8,
      );
      const currentScale = this.focusRoot.scale.x;
      const nextScale = THREE.MathUtils.damp(currentScale, radius, 7, delta);
      this.focusRoot.scale.setScalar(nextScale);
      const focusColor = focusNode.cell.manifest.evidence.disputed
        ? new THREE.Color("#e18a73")
        : new THREE.Color("#8fd8cf");
      this.focusMaterials.forEach((material, index) => {
        material.color.lerp(focusColor, 1 - Math.exp(-delta * 6));
        material.opacity = this.focusOpacity * (index === this.focusMaterials.length - 1 ? 0.72 : 0.3);
      });
      if (!this.reducedMotion) {
        this.focusRoot.children.forEach((child, index) => {
          const rate = Number(child.userData.rotationRate ?? 0.08 + index * 0.02);
          child.rotation.z += delta * rate;
        });
      }
    }
    this.updateScaleBreathing(delta);
    this.updateInspection(delta);
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
    this.updateAdaptiveResolution(timestamp);
    this.renderer.render(this.scene, this.camera);
  };

  private updateAdaptiveResolution(timestamp: number): void {
    if (
      this.reducedMotion ||
      timestamp - this.lastResolutionAdjustmentMs < 3_000 ||
      this.frameDurations.length < 45
    ) {
      return;
    }
    this.lastResolutionAdjustmentMs = timestamp;
    const samples = [...this.frameDurations].sort((left, right) => left - right);
    const median = samples[Math.floor(samples.length / 2)] ?? 0;
    const mobile = this.canvas.clientWidth <= 680;
    const targetMs = mobile ? 33.4 : 20;
    const cap = this.preferredPixelRatio(this.canvas.clientWidth);
    const floor = this.constrainedRenderer ? (mobile ? 0.46 : 0.36) : mobile ? 0.72 : 0.64;
    let next = this.adaptivePixelRatio;
    if (median > targetMs * 1.35) next = Math.max(floor, next - 0.08);
    else if (median < targetMs * 0.72) next = Math.min(cap, next + 0.05);
    if (Math.abs(next - this.adaptivePixelRatio) < 0.001) return;
    this.adaptivePixelRatio = next;
    this.renderer.setPixelRatio(next);
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight, false);
    for (const shader of this.animatedShaders) {
      if (shader.uniforms.pixelRatio) shader.uniforms.pixelRatio.value = next;
    }
    for (const node of this.nodes.values()) {
      for (const material of node.materials) {
        if (material instanceof THREE.ShaderMaterial && material.uniforms.pixelRatio) {
          material.uniforms.pixelRatio.value = next;
        }
      }
    }
  }

  private updateScaleBreathing(delta: number): void {
    const next = THREE.MathUtils.damp(
      this.scaleDepth,
      this.targetScaleDepth,
      this.reducedMotion ? 30 : 5.8,
      delta,
    );
    this.scaleDepth = Math.abs(next - this.targetScaleDepth) < 0.0005
      ? this.targetScaleDepth
      : next;
    const objectDistance = this.importedFrame
      ? Math.max(0.8, this.importedFrame.radius * 0.72)
      : innerWidth <= 680
        ? 4.15
        : 3.05;
    const roomDistance = this.importedFrame
      ? Math.max(1.4, this.importedFrame.radius * 1.65)
      : 14.5;
    const siteDistance = this.importedFrame
      ? Math.max(2.6, this.importedFrame.radius * 3.1)
      : 25;
    if (this.scaleDepth <= 0.5) {
      this.targetDistance = THREE.MathUtils.lerp(
        objectDistance,
        roomDistance,
        smoothstep01(this.scaleDepth * 2),
      );
    } else {
      this.targetDistance = THREE.MathUtils.lerp(
        roomDistance,
        siteDistance,
        smoothstep01((this.scaleDepth - 0.5) * 2),
      );
    }
    if (Math.abs(this.scaleDepth - this.lastScaleTargetUpdate) >= 0.012) {
      this.lastScaleTargetUpdate = this.scaleDepth;
      this.updateCellTargets();
    }
    if (Math.abs(this.scaleDepth - this.lastScaleDepthCallback) >= 0.004) {
      this.lastScaleDepthCallback = this.scaleDepth;
      this.callbacks.onScaleDepthChanged(this.scaleDepth);
    }
  }

  private prepareInspection(node: CellNode): void {
    node.group.traverse((object) => {
      if (!object.userData.inspectionBase) {
        object.userData.inspectionBase = object.position.toArray();
      }
    });
  }

  private updateInspection(delta: number): void {
    if (!this.selected) return;
    this.prepareInspection(this.selected);
    const factor = this.inspectionLayer ? 1 : 0;
    this.selected.group.traverse((object) => {
      const base = object.userData.inspectionBase as [number, number, number] | undefined;
      if (!base || object === this.selected?.group) return;
      const target = new THREE.Vector3(base[0], base[1], base[2]);
      const name = object.name;
      if (this.inspectionLayer === "state" && /boundary|sdf-matter|cell-lattice/.test(name)) {
        target.multiplyScalar(1.08).add(new THREE.Vector3(0, 0.08, 0));
      } else if (
        this.inspectionLayer === "lineage" &&
        /memory|rootprint|growth-current/.test(name)
      ) {
        target.multiplyScalar(1.16).add(new THREE.Vector3(0, 0.26, 0));
      } else if (this.inspectionLayer === "meaning" && /slbit/.test(name)) {
        target.multiplyScalar(1.22).add(new THREE.Vector3(0, 0.48, 0));
      } else if (factor > 0 && name === "observed-surfel-field") {
        target.add(new THREE.Vector3(0, -0.04, 0));
      }
      object.position.lerp(target, 1 - Math.exp(-delta * 7.5));
    });
  }

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

function smoothstep01(value: number): number {
  const clamped = THREE.MathUtils.clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}
