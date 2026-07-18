import type { KeyxymSurfaceVertex } from "./keyxym-v26-theater-adapter";

export function worldCellSurfacePly(vertices: readonly KeyxymSurfaceVertex[], metric: boolean): Blob {
  if (vertices.length < 3 || vertices.length % 3 !== 0) {
    throw new Error("A native triangle surface is required before model export");
  }
  const triangleCount = vertices.length / 3;
  const header = [
    "ply",
    "format binary_little_endian 1.0",
    "comment TESSARYN native World Cell surface",
    `comment scale ${metric ? "metric_meters" : "relative_units"}`,
    `element vertex ${String(vertices.length)}`,
    "property float x",
    "property float y",
    "property float z",
    "property float nx",
    "property float ny",
    "property float nz",
    "property uchar red",
    "property uchar green",
    "property uchar blue",
    `element face ${String(triangleCount)}`,
    "property list uchar int vertex_indices",
    "end_header\n",
  ].join("\n");
  const headerBytes = new TextEncoder().encode(header);
  const vertexBytes = vertices.length * 27;
  const faceBytes = triangleCount * 13;
  const payload = new ArrayBuffer(headerBytes.byteLength + vertexBytes + faceBytes);
  const output = new Uint8Array(payload);
  output.set(headerBytes);
  const view = new DataView(payload);
  let offset = headerBytes.byteLength;
  for (const vertex of vertices) {
    for (const value of [vertex.x, -vertex.y, -vertex.z, vertex.nx, -vertex.ny, -vertex.nz]) {
      view.setFloat32(offset, value, true);
      offset += 4;
    }
    output[offset++] = channel(vertex.r);
    output[offset++] = channel(vertex.g);
    output[offset++] = channel(vertex.b);
  }
  for (let index = 0; index < vertices.length; index += 3) {
    output[offset++] = 3;
    view.setInt32(offset, index, true); offset += 4;
    view.setInt32(offset, index + 1, true); offset += 4;
    view.setInt32(offset, index + 2, true); offset += 4;
  }
  return new Blob([payload], { type: "application/vnd.ply" });
}

function channel(value: number): number {
  return Math.round(Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 255);
}
