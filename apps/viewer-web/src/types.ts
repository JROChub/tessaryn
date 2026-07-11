export type Digest = `sha256:${string}`;

export interface SpatialExtent {
  min_um: [number, number, number];
  max_um: [number, number, number];
  orientation_q30: [number, number, number, number];
  uncertainty_um: [number, number, number];
}

export interface TemporalExtent {
  start_unix_us: number;
  end_unix_us: number;
  uncertainty_us: number;
  clock_source: string;
  published_at_unix_us: number;
  valid_from_unix_us: number;
  valid_until_unix_us: number | null;
  supersedes: Digest[];
  state_kind: "observed" | "derived" | "predicted" | "planned";
}

export interface ChannelDescriptor {
  role: string;
  codec: string;
  codec_version: string;
  chunk_root: Digest;
  uncompressed_bytes: number;
  quality_tier: number;
  criticality: "critical" | "optional";
  license: string;
}

export interface SourceRecord {
  source_id: Digest;
  source_type: string;
  producer: string;
  captured_at_unix_us: number;
  device_key?: Digest;
}

export interface TransformRecord {
  transform_id: Digest;
  method: string;
  tool: string;
  tool_version: string;
  input_ids: Digest[];
}

export interface EvidenceDeclaration {
  identity_committed: boolean;
  replay_available: boolean;
  source_attributed: boolean;
  disputed: boolean;
  semantic_only: boolean;
  restricted: boolean;
}

export interface CellManifest {
  schema: "tessaryn/cell/v0";
  class: "observation" | "derived" | "simulation" | "annotation" | "policy" | "aggregate";
  anchor_id: Digest;
  spatial_extent: SpatialExtent;
  temporal_extent: TemporalExtent;
  channels: ChannelDescriptor[];
  parents: Digest[];
  source_records: SourceRecord[];
  transform_records: TransformRecord[];
  policy_root: Digest;
  evidence: EvidenceDeclaration;
  chunk_merkle_root: Digest;
}

export interface PhaArtifact {
  schema: "power-house/pha/v1";
  provenance: Record<string, string | number | boolean | null>;
  embedded_proof: {
    protocol: string;
    public_inputs: Record<string, string | number | boolean | null>;
    proof: Record<string, string | number | boolean | null>;
  };
  identity_root: Digest;
  phx_fingerprint: Digest;
}

export interface RootprintBranch {
  id: Digest;
  label: string;
  parents: Digest[];
  artifact: PhaArtifact;
  sequence: number;
}

export interface Rootprint {
  schema: "power-house/rootprint/v1";
  root_branch: Digest;
  branches: Record<string, RootprintBranch>;
}

export interface DemoMoment {
  id: string;
  label: string;
  unix_us: number;
  environment: {
    sky: string;
    sun: string;
    sun_milli: number;
    fog_ppm: number;
    condition: string;
  };
}

export interface DemoVisual {
  primitive: string;
  position_mm: [number, number, number];
  size_mm: [number, number, number];
  rotation_mdeg: [number, number, number];
  color: string;
  material: string;
  seed: number;
  moments: string[];
  branch?: string;
}

export interface DemoCell {
  key: string;
  label: string;
  cell_id: Digest;
  manifest: CellManifest;
  channel_payload: Record<string, unknown>;
  visual: DemoVisual;
  semantic_summary: string;
  proof: {
    pha: PhaArtifact;
    rootprint_id: Digest;
    replay_fingerprint: Digest;
  };
}

export interface DemoWorld {
  schema: "tessaryn/demo-world/v0";
  status: "reference-origin";
  product: string;
  origin: string;
  verification_profile: string;
  anchor_id: Digest;
  moments: DemoMoment[];
  cells: DemoCell[];
  lineage: {
    rootprint: Rootprint;
    replay_fingerprint: Digest;
    branches: Record<string, Digest>;
  };
  origin_memory_capsule: Record<string, any>;
}

export interface VerificationReport {
  cellsValid: number;
  phaValid: number;
  rootprintValid: boolean;
  replayValid: boolean;
  memoryValid: boolean;
  disputedCells: number;
  restrictedCells: number;
  errors: string[];
}

export interface RejectionResult {
  id: string;
  expectedLayer: "cell" | "core" | "semantic";
  actualLayer: "cell" | "core" | "semantic" | "none";
  code: string;
  coreUnchanged: boolean;
  detail: string;
}

export interface ForgeReportView {
  manifest: CellManifest;
  cell_id: Digest;
  public_chunk_id: Digest;
  public_chunk: string;
  accepted_samples: number;
  excluded_samples: number;
  raw_embedded: boolean;
  publication_allowed: boolean;
  report_id: Digest;
}

export interface CellProofBundleView {
  manifest: CellManifest;
  cell_id: Digest;
  pha: PhaArtifact;
  rootprint: Rootprint;
  replay_fingerprint: Digest;
  memory_capsule: Record<string, any>;
}

export interface ReconstructionArtifactView {
  schema: "tessaryn/reconstruction-artifact/v0";
  reconstruction_policy: {
    pixel_stride: number;
    surfel_radius_um: number;
    voxel_size_um: number;
    truncation_um: number;
  };
  report: {
    capture_commitment: Digest;
    observation: ForgeReportView;
    sdf_manifest: CellManifest;
    sdf_cell_id: Digest;
    sdf_chunk_id: Digest;
    sdf_chunk: string;
    admitted_depth_samples: number;
    masked_depth_samples: number;
    fused_voxels: number;
    report_id: Digest;
    raw_frames_embedded: boolean;
  };
  verification: {
    observation_valid: boolean;
    sdf_valid: boolean;
    report_valid: boolean;
    raw_frames_absent: boolean;
    verified_surfels: number;
    verified_voxels: number;
  };
  observation_proof: CellProofBundleView;
  observation_proof_report: Record<string, boolean | number>;
  sdf_proof: CellProofBundleView;
  sdf_proof_report: Record<string, boolean | number>;
  lineage: {
    rootprint: Rootprint;
    branches: Record<string, Digest>;
    replay_fingerprint: Digest;
  };
  lineage_report: Record<string, boolean | number>;
}

export interface SurfelPoint {
  positionUm: [number, number, number];
  normalQ15: [number, number, number];
  color: [number, number, number, number];
  radiusUm: number;
}

export interface SdfVoxelPoint {
  coordinate: [number, number, number];
  signedDistanceUm: number;
  weight: number;
}

export interface ReconstructionBrowserReport {
  cellsValid: number;
  phaValid: number;
  rootprintValid: boolean;
  replayValid: boolean;
  memoryValid: boolean;
  reportValid: boolean;
  rawFramesAbsent: boolean;
  surfels: SurfelPoint[];
  sdfVoxels: SdfVoxelPoint[];
  voxelSizeUm: number;
  voxels: number;
  errors: string[];
}

export interface DatasetProfileView {
  schema: "tessaryn/dataset-profile/v1";
  id: string;
  dataset: string;
  release: string;
  environment: string;
  sequence: string;
  source_class: "synthetic_ground_truth" | "real_sensor";
  homepage: string;
  license: string;
  citation: string;
  modalities: string[];
  sensor: {
    width: number;
    height: number;
    sample_rate_millihz: number;
    fx_q20: number;
    fy_q20: number;
    cx_q20: number;
    cy_q20: number;
    coordinate_frame: string;
  };
  ground_truth: {
    metric_depth: boolean;
    camera_pose: boolean;
    semantics: boolean;
    optical_flow: boolean;
    reference: string;
  };
  assets: Array<{
    role: string;
    url: string;
    sha256: Digest;
    bytes: number;
  }>;
}

export interface ValidationSourceView {
  profile: DatasetProfileView;
  selection_manifest: Digest;
  source_manifest: Digest;
  selected_frames: number;
  selections: Array<{
    id: string;
    frame_ids: Digest[];
    captured_at_unix_us: number[];
    source_indices: number[];
  }>;
}

export interface ValidationReconstructionMomentView {
  id: string;
  label: string;
  captured_at_unix_us: number;
  artifact: ReconstructionArtifactView;
}

export interface ValidationLocusArtifactView {
  schema: "tessaryn/validation-locus-artifact/v1";
  origin: string;
  source: ValidationSourceView;
  source_proof: CellProofBundleView;
  source_proof_report: Record<string, boolean | number>;
  moments: ValidationReconstructionMomentView[];
  alternate: ValidationReconstructionMomentView;
  lineage: {
    rootprint: Rootprint;
    branches: Record<string, Digest>;
    replay_fingerprint: Digest;
  };
  lineage_report: Record<string, boolean | number>;
}

export interface VerifiedValidationMoment {
  id: string;
  label: string;
  capturedAtUnixUs: number;
  verification: ReconstructionBrowserReport;
}

export interface ValidationLocusBrowserReport {
  cellsValid: number;
  phaValid: number;
  rootprintValid: boolean;
  replayValid: boolean;
  memoryValid: boolean;
  moments: VerifiedValidationMoment[];
  alternate: VerifiedValidationMoment | null;
  sourceManifest: Digest;
  errors: string[];
}
