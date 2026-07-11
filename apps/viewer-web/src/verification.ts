import type {
  CellManifest,
  DemoCell,
  DemoWorld,
  PhaArtifact,
  ReconstructionArtifactView,
  ReconstructionBrowserReport,
  RejectionResult,
  Rootprint,
  RootprintBranch,
  VerificationReport,
} from "./types";

const encoder = new TextEncoder();
const CELL_DOMAIN = encoder.encode("TESSARYN-CELL-v0\0");
const CHUNK_DOMAIN = encoder.encode("TESSARYN-CHUNK-v0\0");
const MERKLE_LEAF_DOMAIN = encoder.encode("TESSARYN-MERKLE-LEAF-v0\0");
const PHA_DOMAIN = encoder.encode("power-house:pha:v1:phx-fingerprint\0");
const BRANCH_DOMAIN = encoder.encode("power-house:rootprint:v1:branch-id\0");
const REPLAY_DOMAIN = encoder.encode("power-house:rootprint:v1:replay-state\0");
const CAPSULE_DOMAIN = encoder.encode("PHM-CAPSULE-v1\0");
const CORE_DOMAIN = encoder.encode("PHM-CORE-v1\0");
const SIDECAR_DOMAIN = encoder.encode("power-house:observatory-sidecar:v1\0");
const SEMANTIC_DOMAIN = encoder.encode("PHM-SEMANTIC-PACKET-v1\0");
const SURFEL_MAGIC = encoder.encode("TESSARYN-SURFEL-v0\0");
const SDF_MAGIC = encoder.encode("TESSARYN-SDF-v0\0");

export async function calculateCellId(manifest: CellManifest): Promise<string> {
  const canonical = canonicalizeManifest(manifest);
  return hashDomain(CELL_DOMAIN, encoder.encode(canonicalStringify(canonical)));
}

export async function calculatePhaFingerprint(artifact: PhaArtifact): Promise<string> {
  const core = {
    embedded_proof: {
      proof: artifact.embedded_proof.proof,
      protocol: artifact.embedded_proof.protocol,
      public_inputs: artifact.embedded_proof.public_inputs,
    },
    provenance: artifact.provenance,
    schema: artifact.schema,
  };
  assertIntegerJson(core);
  return hashDomain(PHA_DOMAIN, encoder.encode(canonicalStringify(core)));
}

export async function verifyWorld(world: DemoWorld): Promise<VerificationReport> {
  const errors: string[] = [];
  let cellsValid = 0;
  let phaValid = 0;
  for (const cell of world.cells) {
    try {
      const chunk = await hashDomain(
        CHUNK_DOMAIN,
        encoder.encode(canonicalStringify(cell.channel_payload)),
      );
      const chunkRoot = await hashDomain(MERKLE_LEAF_DOMAIN, digestBytes(chunk));
      if (
        chunkRoot !== cell.manifest.chunk_merkle_root ||
        cell.manifest.channels.some((channel) => channel.chunk_root !== chunkRoot)
      ) {
        throw new Error(cell.key + ": chunk commitment mismatch");
      }
      const cellId = await calculateCellId(cell.manifest);
      if (cellId !== cell.cell_id) {
        throw new Error(cell.key + ": Cell identity mismatch");
      }
      cellsValid += 1;
      const pha = await calculatePhaFingerprint(cell.proof.pha);
      if (
        pha !== cell.proof.pha.phx_fingerprint ||
        cell.proof.pha.embedded_proof.protocol !== "tessaryn/world-cell/v0" ||
        cell.proof.pha.embedded_proof.public_inputs.cell_manifest_digest !== cell.cell_id ||
        cell.proof.pha.identity_root !== cell.proof.rootprint_id
      ) {
        throw new Error(cell.key + ": PHA binding mismatch");
      }
      phaValid += 1;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  let rootprintValid = false;
  let replayValid = false;
  let memoryValid = false;
  try {
    const replay = await verifyRootprint(world.lineage.rootprint);
    rootprintValid = true;
    replayValid = replay === world.lineage.replay_fingerprint;
    if (!replayValid) errors.push("Rootprint replay fingerprint mismatch");
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  try {
    memoryValid = await verifyMemoryCapsule(world.origin_memory_capsule);
    if (!memoryValid) errors.push("Memory Capsule mismatch");
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return {
    cellsValid,
    phaValid,
    rootprintValid,
    replayValid,
    memoryValid,
    disputedCells: world.cells.filter((cell) => cell.manifest.evidence.disputed).length,
    restrictedCells: world.cells.filter((cell) => cell.manifest.evidence.restricted).length,
    errors,
  };
}

export async function verifyReconstructionArtifact(
  artifact: ReconstructionArtifactView,
): Promise<ReconstructionBrowserReport> {
  const result: ReconstructionBrowserReport = {
    cellsValid: 0,
    phaValid: 0,
    rootprintValid: false,
    replayValid: false,
    memoryValid: false,
    reportValid: false,
    rawFramesAbsent: false,
    surfels: [],
    voxels: 0,
    errors: [],
  };
  try {
    if (artifact.schema !== "tessaryn/reconstruction-artifact/v0") {
      throw new Error("unsupported reconstruction artifact schema");
    }
    assertIntegerJson(artifact);
    const report = artifact.report;
    if (report.raw_frames_embedded || report.observation.raw_embedded) {
      throw new Error("raw frame disclosure boundary failed");
    }
    result.rawFramesAbsent = true;

    const surfelBytes = bytesFromBase64(report.observation.public_chunk, "surfel chunk");
    result.surfels = decodeSurfelChunk(surfelBytes);
    const observationChunkId = await hashDomain(CHUNK_DOMAIN, surfelBytes);
    const observationRoot = await hashDomain(
      MERKLE_LEAF_DOMAIN,
      digestBytes(observationChunkId),
    );
    if (
      observationChunkId !== report.observation.public_chunk_id ||
      observationRoot !== report.observation.manifest.chunk_merkle_root ||
      report.observation.manifest.channels.some(
        (channel) => channel.chunk_root !== observationRoot,
      ) ||
      result.surfels.length !== report.observation.accepted_samples ||
      (await calculateCellId(report.observation.manifest)) !== report.observation.cell_id
    ) {
      throw new Error("observation Cell or surfel commitment mismatch");
    }
    const forgeProjection = {
      accepted_samples: report.observation.accepted_samples,
      cell_id: report.observation.cell_id,
      excluded_samples: report.observation.excluded_samples,
      public_chunk_id: report.observation.public_chunk_id,
      publication_allowed: report.observation.publication_allowed,
      raw_embedded: false,
    };
    if (
      (await hashDomain(CHUNK_DOMAIN, encoder.encode(canonicalStringify(forgeProjection)))) !==
      report.observation.report_id
    ) {
      throw new Error("Forge report identity mismatch");
    }
    result.cellsValid += 1;

    const sdfBytes = bytesFromBase64(report.sdf_chunk, "SDF chunk");
    result.voxels = decodeSdfChunk(sdfBytes, artifact.reconstruction_policy.voxel_size_um);
    const sdfChunkId = await hashDomain(CHUNK_DOMAIN, sdfBytes);
    const sdfRoot = await hashDomain(MERKLE_LEAF_DOMAIN, digestBytes(sdfChunkId));
    if (
      sdfChunkId !== report.sdf_chunk_id ||
      sdfRoot !== report.sdf_manifest.chunk_merkle_root ||
      report.sdf_manifest.channels.some((channel) => channel.chunk_root !== sdfRoot) ||
      (await calculateCellId(report.sdf_manifest)) !== report.sdf_cell_id ||
      report.sdf_manifest.parents.length !== 1 ||
      report.sdf_manifest.parents[0] !== report.observation.cell_id ||
      result.voxels !== report.fused_voxels
    ) {
      throw new Error("derived SDF Cell or chunk commitment mismatch");
    }
    result.cellsValid += 1;

    const reconstructionProjection = {
      admitted_depth_samples: report.admitted_depth_samples,
      capture_commitment: report.capture_commitment,
      fused_voxels: report.fused_voxels,
      masked_depth_samples: report.masked_depth_samples,
      observation_cell: report.observation.cell_id,
      raw_frames_embedded: false,
      reconstruction: artifact.reconstruction_policy,
      sdf_cell: report.sdf_cell_id,
      sdf_chunk: report.sdf_chunk_id,
    };
    if (
      (await hashDomain(
        CHUNK_DOMAIN,
        encoder.encode(canonicalStringify(reconstructionProjection)),
      )) !== report.report_id
    ) {
      throw new Error("reconstruction report identity mismatch");
    }
    result.reportValid = true;

    for (const [name, proof, expectedCell] of [
      ["observation", artifact.observation_proof, report.observation.cell_id],
      ["SDF", artifact.sdf_proof, report.sdf_cell_id],
    ] as const) {
      if (
        proof.cell_id !== expectedCell ||
        (await calculateCellId(proof.manifest)) !== expectedCell ||
        (await calculatePhaFingerprint(proof.pha)) !== proof.pha.phx_fingerprint ||
        proof.pha.embedded_proof.protocol !== "tessaryn/world-cell/v0" ||
        proof.pha.embedded_proof.public_inputs.cell_manifest_digest !== expectedCell
      ) {
        throw new Error(name + " Power House Cell binding mismatch");
      }
      result.phaValid += 1;
      const replay = await verifyRootprint(proof.rootprint);
      if (replay !== proof.replay_fingerprint) {
        throw new Error(name + " Rootprint replay mismatch");
      }
      if (!(await verifyMemoryCapsule(proof.memory_capsule))) {
        throw new Error(name + " Memory Capsule mismatch");
      }
    }
    result.memoryValid = true;

    const lineageReplay = await verifyRootprint(artifact.lineage.rootprint);
    result.rootprintValid = true;
    result.replayValid = lineageReplay === artifact.lineage.replay_fingerprint;
    if (!result.replayValid) throw new Error("world lineage replay mismatch");
    const graphIds = Object.keys(artifact.lineage.rootprint.branches).sort(compareUtf8);
    const mappedIds = Object.values(artifact.lineage.branches).sort(compareUtf8);
    if (canonicalStringify(graphIds) !== canonicalStringify(mappedIds)) {
      throw new Error("world lineage branch map mismatch");
    }
    for (const [label, expectedCell] of [
      ["observation", report.observation.cell_id],
      ["sdf-derived", report.sdf_cell_id],
    ] as const) {
      const branchId = artifact.lineage.branches[label];
      const branch = branchId ? artifact.lineage.rootprint.branches[branchId] : undefined;
      if (branch?.artifact.embedded_proof.public_inputs.cell_manifest_digest !== expectedCell) {
        throw new Error(label + " lineage binding mismatch");
      }
    }
    if (
      !Object.values(artifact.observation_proof_report).every(
        (value) => value === true || value === false,
      ) ||
      artifact.observation_proof_report.physical_truth_claimed !== false ||
      artifact.sdf_proof_report.physical_truth_claimed !== false ||
      artifact.verification.observation_valid !== true ||
      artifact.verification.sdf_valid !== true ||
      artifact.verification.report_valid !== true ||
      artifact.verification.raw_frames_absent !== true ||
      artifact.verification.verified_surfels !== result.surfels.length ||
      artifact.verification.verified_voxels !== result.voxels
    ) {
      throw new Error("stored verification report mismatch");
    }
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }
  return result;
}

function decodeSurfelChunk(bytes: Uint8Array): ReconstructionBrowserReport["surfels"] {
  const header = SURFEL_MAGIC.length + 4;
  if (!hasMagic(bytes, SURFEL_MAGIC) || bytes.length < header) {
    throw new Error("malformed surfel chunk");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(SURFEL_MAGIC.length, true);
  if (count > 1_000_000 || bytes.length !== header + count * 40) {
    throw new Error("surfel chunk resource or length mismatch");
  }
  const surfels: ReconstructionBrowserReport["surfels"] = [];
  let cursor = header;
  for (let index = 0; index < count; index += 1) {
    const position = [0, 0, 0] as [number, number, number];
    for (let axis = 0; axis < 3; axis += 1) {
      const coordinate = view.getBigInt64(cursor, true);
      cursor += 8;
      const numeric = Number(coordinate);
      if (!Number.isSafeInteger(numeric)) throw new Error("surfel coordinate is unsafe");
      position[axis] = numeric;
    }
    const normalQ15 = [
      view.getInt16(cursor, true),
      view.getInt16(cursor + 2, true),
      view.getInt16(cursor + 4, true),
    ] as [number, number, number];
    cursor += 6;
    const color = [
      view.getUint8(cursor),
      view.getUint8(cursor + 1),
      view.getUint8(cursor + 2),
      view.getUint8(cursor + 3),
    ] as [number, number, number, number];
    cursor += 4;
    const radiusUm = view.getUint32(cursor, true);
    cursor += 4;
    const confidence = view.getUint16(cursor, true);
    cursor += 2;
    if (radiusUm === 0 || confidence > 10_000) throw new Error("invalid surfel sample");
    surfels.push({ positionUm: position, normalQ15, color, radiusUm });
  }
  return surfels;
}

function decodeSdfChunk(bytes: Uint8Array, expectedVoxelSize: number): number {
  const header = SDF_MAGIC.length + 8;
  if (!hasMagic(bytes, SDF_MAGIC) || bytes.length < header) {
    throw new Error("malformed sparse SDF chunk");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const voxelSize = view.getUint32(SDF_MAGIC.length, true);
  const count = view.getUint32(SDF_MAGIC.length + 4, true);
  if (
    voxelSize !== expectedVoxelSize ||
    count > 2_000_000 ||
    bytes.length !== header + count * 20
  ) {
    throw new Error("sparse SDF dimensions mismatch");
  }
  let cursor = header;
  let previous: [number, number, number] | null = null;
  for (let index = 0; index < count; index += 1) {
    const coordinate = [
      view.getInt32(cursor, true),
      view.getInt32(cursor + 4, true),
      view.getInt32(cursor + 8, true),
    ] as [number, number, number];
    cursor += 16;
    const weight = view.getUint32(cursor, true);
    cursor += 4;
    if (weight === 0 || (previous && compareCoordinate(previous, coordinate) >= 0)) {
      throw new Error("noncanonical sparse SDF voxel");
    }
    previous = coordinate;
  }
  return count;
}

function compareCoordinate(
  left: [number, number, number],
  right: [number, number, number],
): number {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

function bytesFromBase64(encoded: string, label: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*$/.test(encoded) || encoded.length % 4 === 1) {
    throw new Error(label + " contains noncanonical Base64");
  }
  const padding = "=".repeat((4 - (encoded.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(encoded + padding);
  } catch {
    throw new Error(label + " contains invalid Base64");
  }
  if (btoa(binary).replace(/=+$/u, "") !== encoded) {
    throw new Error(label + " contains noncanonical Base64");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function hasMagic(bytes: Uint8Array, magic: Uint8Array): boolean {
  return (
    bytes.length >= magic.length && magic.every((value, index) => bytes[index] === value)
  );
}

export async function runMutation(
  world: DemoWorld,
  selected: DemoCell,
  mutation: string,
  semanticCapsule: Record<string, any> = world.origin_memory_capsule,
): Promise<RejectionResult> {
  if (mutation === "coordinate") {
    const manifest = structuredClone(selected.manifest);
    manifest.spatial_extent.max_um[0] += 1;
    const actual = await calculateCellId(manifest);
    return {
      id: "mut_cell_coordinate_001",
      expectedLayer: "cell",
      actualLayer: actual === selected.cell_id ? "none" : "cell",
      code: actual === selected.cell_id ? "UNEXPECTED_ACCEPT" : "CELL_ID_MISMATCH",
      coreUnchanged: false,
      detail: "One canonical micrometer changed; Cell identity no longer matches.",
    };
  }
  if (mutation === "fingerprint") {
    const artifact = structuredClone(selected.proof.pha);
    artifact.embedded_proof.proof.identity_verified = false;
    const actual = await calculatePhaFingerprint(artifact);
    return {
      id: "mut_pha_core_001",
      expectedLayer: "core",
      actualLayer: actual === artifact.phx_fingerprint ? "none" : "core",
      code: actual === artifact.phx_fingerprint ? "UNEXPECTED_ACCEPT" : "PHA_CORE_INVALID",
      coreUnchanged: false,
      detail: "The proof payload changed while the stored Power House fingerprint did not.",
    };
  }
  if (mutation === "semantic") {
    const capsule = structuredClone(semanticCapsule);
    const packet = capsule.semantics?.packets?.[0];
    if (!packet?.packet) throw new Error("semantic packet unavailable");
    packet.packet.summary = "tampered semantic presentation";
    const actual = await semanticPacketDigest(packet.packet);
    return {
      id: "mut_semantic_note_001",
      expectedLayer: "semantic",
      actualLayer: actual === packet.packet_digest ? "none" : "semantic",
      code: actual === packet.packet_digest ? "UNEXPECTED_ACCEPT" : "PACKET_DIGEST_MISMATCH",
      coreUnchanged: true,
      detail: "Meaning changed and was rejected; Cell and PHA identities remain valid.",
    };
  }
  throw new Error("unsupported mutation: " + mutation);
}

async function verifyMemoryCapsule(capsule: Record<string, any>): Promise<boolean> {
  if (capsule.header?.schema !== "power-house/memory-capsule/v1") return false;
  const projection = structuredClone(capsule);
  projection.header.capsule_digest = null;
  const capsuleDigest = await hashDomain(
    CAPSULE_DOMAIN,
    encoder.encode(canonicalStringify(projection)),
  );
  if (capsuleDigest !== capsule.header.capsule_digest) return false;

  const coreProjection = {
    core_verification_policy: capsule.core.core_verification_policy,
    pha: capsule.core.pha,
    proofs: capsule.core.proofs,
  };
  const coreDigest = await hashDomain(
    CORE_DOMAIN,
    encoder.encode(canonicalStringify(coreProjection)),
  );
  if (
    coreDigest !== capsule.core.core_digest ||
    (await calculatePhaFingerprint(capsule.core.pha)) !== capsule.core.pha.phx_fingerprint
  ) {
    return false;
  }

  const replay = await verifyRootprint(capsule.lineage.rootprint);
  if (replay !== capsule.replay.replay.expected.replay_fingerprint) return false;

  if (capsule.semantics) {
    const sidecar = capsule.semantics.sidecar;
    if (!sidecar || sidecar.rootprint_state_fingerprint !== replay) return false;
    const sidecarProjection = {
      nodes: sidecar.nodes,
      rootprint_state_fingerprint: sidecar.rootprint_state_fingerprint,
      schema: sidecar.schema,
    };
    const sidecarDigest = await hashDomain(
      SIDECAR_DOMAIN,
      encoder.encode(canonicalStringify(sidecarProjection)),
    );
    if (sidecarDigest !== sidecar.sidecar_sha256) return false;
    for (const packet of capsule.semantics.packets ?? []) {
      if (
        packet.bound_replay_fingerprint !== replay ||
        !capsule.lineage.rootprint.branches[packet.bound_branch_id] ||
        !packet.packet ||
        (await semanticPacketDigest(packet.packet)) !== packet.packet_digest
      ) {
        return false;
      }
    }
  }
  return true;
}

async function semanticPacketDigest(packet: Record<string, any>): Promise<string> {
  const projection = structuredClone(packet);
  if ("packet_digest" in projection) projection.packet_digest = "";
  if (projection.digests && "packet" in projection.digests) projection.digests.packet = "";
  if (projection.digests && "packet_digest" in projection.digests) {
    projection.digests.packet_digest = "";
  }
  return hashDomain(SEMANTIC_DOMAIN, encoder.encode(canonicalStringify(projection)));
}

async function verifyRootprint(graph: Rootprint): Promise<string> {
  if (graph.schema !== "power-house/rootprint/v1") {
    throw new Error("unsupported Rootprint schema");
  }
  const root = graph.branches[graph.root_branch];
  if (!root || root.sequence !== 0 || root.parents.length !== 0) {
    throw new Error("invalid Rootprint root");
  }
  for (const [key, branch] of Object.entries(graph.branches)) {
    if (key !== branch.id || branch.parents.length > 2) {
      throw new Error("invalid Rootprint branch " + key);
    }
    if ((await calculatePhaFingerprint(branch.artifact)) !== branch.artifact.phx_fingerprint) {
      throw new Error("invalid PHA in Rootprint branch " + key);
    }
    const expected = await calculateBranchId(branch);
    if (expected !== branch.id) throw new Error("branch ID mismatch " + key);
    for (const parent of branch.parents) {
      const parentBranch = graph.branches[parent];
      if (!parentBranch || parentBranch.sequence >= branch.sequence) {
        throw new Error("invalid parent ordering " + key);
      }
    }
  }
  detectCycles(graph);

  let ordered = Object.values(graph.branches).sort(
    (left, right) => left.sequence - right.sequence || compareUtf8(left.id, right.id),
  );
  const canonicalSequences = new Map<string, number>();
  for (const branch of ordered) {
    const parentSequence = branch.parents.reduce(
      (maximum, parent) => Math.max(maximum, canonicalSequences.get(parent) ?? 0),
      0,
    );
    canonicalSequences.set(branch.id, parentSequence + (branch.parents.length > 0 ? 1 : 0));
  }
  ordered = ordered.sort(
    (left, right) =>
      (canonicalSequences.get(left.id) ?? 0) - (canonicalSequences.get(right.id) ?? 0) ||
      compareUtf8(left.id, right.id),
  );
  const replayBranches = ordered.map((branch) => ({
    artifact_phx_fingerprint: branch.artifact.phx_fingerprint,
    id: branch.id,
    label: branch.label,
    parents: branch.parents,
    sequence: canonicalSequences.get(branch.id) ?? 0,
  }));
  const parentIds = new Set(ordered.flatMap((branch) => branch.parents));
  const tips = (Object.keys(graph.branches) as RootprintBranch["id"][])
    .filter((id) => !parentIds.has(id))
    .sort(compareUtf8);
  return hashDomain(
    REPLAY_DOMAIN,
    encoder.encode(
      canonicalStringify({
        branches: replayBranches,
        root_branch: graph.root_branch,
        tips,
      }),
    ),
  );
}

async function calculateBranchId(branch: RootprintBranch): Promise<string> {
  return hashDomain(
    BRANCH_DOMAIN,
    encoder.encode(
      canonicalStringify({
        artifact_phx_fingerprint: branch.artifact.phx_fingerprint,
        label: branch.label,
        parents: branch.parents,
      }),
    ),
  );
}

function detectCycles(graph: Rootprint): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error("Rootprint cycle detected");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const parent of graph.branches[id]?.parents ?? []) visit(parent);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of Object.keys(graph.branches)) visit(id);
}

function canonicalizeManifest(manifest: CellManifest): CellManifest {
  const value = structuredClone(manifest);
  value.channels.sort(
    (left, right) =>
      compareUtf8(left.role, right.role) || compareUtf8(left.chunk_root, right.chunk_root),
  );
  value.parents = [...new Set(value.parents)].sort(compareUtf8);
  value.temporal_extent.supersedes = [...new Set(value.temporal_extent.supersedes)].sort(
    compareUtf8,
  );
  value.source_records.sort((left, right) => compareUtf8(left.source_id, right.source_id));
  value.transform_records.sort((left, right) =>
    compareUtf8(left.transform_id, right.transform_id),
  );
  for (const transform of value.transform_records) {
    transform.input_ids = [...new Set(transform.input_ids)].sort(compareUtf8);
  }
  assertIntegerJson(value);
  return value;
}

function canonicalStringify(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("non-integer or unsafe JSON number");
    return String(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalStringify).join(",") + "]";
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => compareUtf8(left, right));
    return (
      "{" +
      entries
        .map(([key, item]) => JSON.stringify(key) + ":" + canonicalStringify(item))
        .join(",") +
      "}"
    );
  }
  throw new Error("unsupported canonical JSON type: " + typeof value);
}

function compareUtf8(left: string, right: string): number {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftBytes[index] ?? 0) - (rightBytes[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

function assertIntegerJson(value: unknown): void {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new Error("identity-bearing JSON contains a non-integer number");
  }
  if (Array.isArray(value)) {
    for (const item of value) assertIntegerJson(item);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      assertIntegerJson(item);
    }
  }
}

function digestBytes(value: string): Uint8Array {
  if (!/^sha256:[0-9a-f]{64}$/.test(value)) throw new Error("invalid SHA-256 digest");
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(7 + index * 2, 9 + index * 2), 16);
  }
  return bytes;
}

async function hashDomain(domain: Uint8Array, payload: Uint8Array): Promise<string> {
  const bytes = new Uint8Array(domain.length + payload.length);
  bytes.set(domain);
  bytes.set(payload, domain.length);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return (
    "sha256:" +
    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
  );
}
