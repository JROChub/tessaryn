import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";

export type SourceGeometryFormat = "glb" | "gltf" | "obj" | "ply" | "stl";

export interface SourceGeometryStats {
  format: SourceGeometryFormat;
  nodes: number;
  meshes: number;
  pointClouds: number;
  vertices: number;
  triangles: number;
  materials: number;
  textures: number;
  dimensions: [number, number, number];
}

export interface SourceGeometryAsset {
  root: THREE.Object3D;
  stats: SourceGeometryStats;
}

export function disposeSourceGeometry(asset: SourceGeometryAsset): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  asset.root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Points)) return;
    geometries.add(object.geometry);
    const values = Array.isArray(object.material) ? object.material : [object.material];
    values.forEach((material) => {
      materials.add(material);
      Object.values(material).forEach((value) => {
        if (value instanceof THREE.Texture) textures.add(value);
      });
    });
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  textures.forEach((texture) => texture.dispose());
}

const MAX_SCENE_NODES = 100_000;
const MAX_SOURCE_VERTICES = 100_000_000;
const MAX_INTERACTIVE_SOURCE_BYTES = 512 * 1024 * 1024;

export function sourceGeometryFormat(file: File): SourceGeometryFormat | null {
  const name = file.name.toLowerCase();
  const match = name.match(/\.([a-z0-9]+)$/u);
  const extension = match?.[1];
  if (
    extension === "glb" ||
    extension === "gltf" ||
    extension === "obj" ||
    extension === "ply" ||
    extension === "stl"
  ) {
    return extension;
  }
  const type = file.type.toLowerCase();
  if (type === "model/gltf-binary") return "glb";
  if (type === "model/gltf+json") return "gltf";
  if (type === "model/obj") return "obj";
  if (type === "model/ply") return "ply";
  if (type === "model/stl") return "stl";
  return null;
}

export async function parseSourceGeometry(
  file: File,
  companions: readonly File[],
): Promise<SourceGeometryAsset> {
  const format = sourceGeometryFormat(file);
  if (!format) throw new Error("unsupported source geometry format");
  if (file.size > MAX_INTERACTIVE_SOURCE_BYTES) {
    throw new Error(
      "source geometry is indexed, but exceeds the 512 MiB interactive decoder profile",
    );
  }

  const objectUrls = new Map<File, string>();
  const admittedCompanions = new Set<File>();
  let admittedBytes = file.size;
  const manager = new THREE.LoadingManager();
  const filesByPath = mapCompanionFiles(companions);
  manager.setURLModifier((requested) => {
    if (/^(?:blob:|data:)/iu.test(requested)) return requested;
    if (/^(?:https?:|file:|\/\/)/iu.test(requested)) {
      throw new Error(
        "source geometry network dependency rejected; add it as a local companion file",
      );
    }
    const candidate = resolveCompanionFile(requested, filesByPath);
    if (!candidate) {
      throw new Error(`source geometry companion is missing: ${basename(requested)}`);
    }
    if (!admittedCompanions.has(candidate)) {
      admittedBytes += candidate.size;
      if (admittedBytes > MAX_INTERACTIVE_SOURCE_BYTES) {
        throw new Error(
          "source geometry companions exceed the 512 MiB interactive decoder profile",
        );
      }
      admittedCompanions.add(candidate);
    }
    let url = objectUrls.get(candidate);
    if (!url) {
      url = URL.createObjectURL(candidate);
      objectUrls.set(candidate, url);
    }
    return url;
  });

  try {
    const root = await parseByFormat(file, format, manager);
    const stats = inspectSourceGeometry(root, format);
    return { root, stats };
  } finally {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
  }
}

async function parseByFormat(
  file: File,
  format: SourceGeometryFormat,
  manager: THREE.LoadingManager,
): Promise<THREE.Object3D> {
  if (format === "glb" || format === "gltf") {
    const loader = new GLTFLoader(manager);
    const payload = format === "glb" ? await file.arrayBuffer() : await file.text();
    return new Promise((resolve, reject) => {
      loader.parse(
        payload,
        "",
        (gltf) => resolve(gltf.scene),
        (error) => reject(loaderError(error, "GLTF SOURCE REJECTED")),
      );
    });
  }
  if (format === "obj") {
    return new OBJLoader(manager).parse(await file.text());
  }
  if (format === "ply") {
    const geometry = new PLYLoader(manager).parse(await file.arrayBuffer());
    return geometry.index
      ? new THREE.Mesh(geometry, sourceMeshMaterial(geometry))
      : new THREE.Points(geometry, sourcePointMaterial(geometry));
  }
  const geometry = new STLLoader(manager).parse(await file.arrayBuffer());
  return new THREE.Mesh(geometry, sourceMeshMaterial(geometry));
}

function sourceMeshMaterial(geometry: THREE.BufferGeometry): THREE.MeshStandardMaterial {
  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
  const vertexColors = Boolean(geometry.getAttribute("color"));
  return new THREE.MeshStandardMaterial({
    color: vertexColors ? "#ffffff" : "#c8ccc3",
    vertexColors,
    roughness: 0.62,
    metalness: 0.03,
    side: THREE.DoubleSide,
  });
}

function sourcePointMaterial(geometry: THREE.BufferGeometry): THREE.PointsMaterial {
  geometry.computeBoundingBox();
  const diagonal = geometry.boundingBox?.getSize(new THREE.Vector3()).length() ?? 1;
  return new THREE.PointsMaterial({
    color: geometry.getAttribute("color") ? "#ffffff" : "#c8ccc3",
    vertexColors: Boolean(geometry.getAttribute("color")),
    size: THREE.MathUtils.clamp(diagonal / 480, 0.002, 0.035),
    sizeAttenuation: true,
  });
}

function inspectSourceGeometry(
  root: THREE.Object3D,
  format: SourceGeometryFormat,
): SourceGeometryStats {
  let nodes = 0;
  let meshes = 0;
  let pointClouds = 0;
  let vertices = 0;
  let triangles = 0;
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  root.updateMatrixWorld(true);
  root.traverse((object) => {
    nodes += 1;
    if (nodes > MAX_SCENE_NODES) {
      throw new Error("source geometry exceeds the scene-node safety profile");
    }
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Points)) return;
    if (object instanceof THREE.Mesh) meshes += 1;
    else pointClouds += 1;
    const position = object.geometry.getAttribute("position");
    if (!position) throw new Error("source geometry drawable has no position channel");
    validateFinitePositions(position);
    vertices += position.count;
    if (vertices > MAX_SOURCE_VERTICES) {
      throw new Error("source geometry exceeds the interactive vertex safety profile");
    }
    if (object instanceof THREE.Mesh) {
      triangles += Math.floor((object.geometry.index?.count ?? position.count) / 3);
    }
    const values = Array.isArray(object.material) ? object.material : [object.material];
    values.forEach((material) => {
      materials.add(material);
      Object.values(material).forEach((value) => {
        if (value instanceof THREE.Texture) textures.add(value);
      });
    });
  });

  if (meshes + pointClouds === 0 || vertices === 0) {
    throw new Error("source geometry contains no renderable vertices");
  }
  const bounds = new THREE.Box3().setFromObject(root);
  if (bounds.isEmpty() || !finiteVector(bounds.min) || !finiteVector(bounds.max)) {
    throw new Error("source geometry bounds are invalid");
  }
  const size = bounds.getSize(new THREE.Vector3());
  return {
    format,
    nodes,
    meshes,
    pointClouds,
    vertices,
    triangles,
    materials: materials.size,
    textures: textures.size,
    dimensions: [size.x, size.y, size.z],
  };
}

function validateFinitePositions(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
): void {
  for (let index = 0; index < attribute.count; index += 1) {
    if (
      !Number.isFinite(attribute.getX(index)) ||
      !Number.isFinite(attribute.getY(index)) ||
      !Number.isFinite(attribute.getZ(index))
    ) {
      throw new Error("source geometry contains a non-finite position");
    }
  }
}

function finiteVector(value: THREE.Vector3): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

function mapCompanionFiles(files: readonly File[]): Map<string, File> {
  const mapped = new Map<string, File>();
  for (const file of files) {
    const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    for (const key of [relative, file.name, basename(relative)]) {
      const normalized = normalizePath(key);
      const existing = mapped.get(normalized);
      if (existing && existing !== file) {
        throw new Error(`source geometry companion path is ambiguous: ${key}`);
      }
      mapped.set(normalized, file);
    }
  }
  return mapped;
}

function resolveCompanionFile(
  requested: string,
  files: ReadonlyMap<string, File>,
): File | undefined {
  const clean = normalizePath(requested.split(/[?#]/u, 1)[0] ?? requested);
  return files.get(clean) ?? files.get(basename(clean));
}

function normalizePath(value: string): string {
  try {
    return decodeURIComponent(value)
      .replace(/^\.\//u, "")
      .replace(/\\/gu, "/")
      .toLowerCase();
  } catch {
    return value.replace(/^\.\//u, "").replace(/\\/gu, "/").toLowerCase();
  }
}

function basename(value: string): string {
  return value.split("/").at(-1) ?? value;
}

function loaderError(error: unknown, prefix: string): Error {
  const detail =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "decoder failure";
  return new Error(`${prefix}: ${detail}`);
}
