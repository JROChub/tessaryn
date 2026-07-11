import type {
  CellManifest,
  DemoCell,
  DemoWorld,
  PhaArtifact,
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

export async function runMutation(
  world: DemoWorld,
  selected: DemoCell,
  mutation: string,
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
    const capsule = structuredClone(world.origin_memory_capsule);
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
