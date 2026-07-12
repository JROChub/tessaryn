# Video Locus v1

Schema: `tessaryn/video-locus-artifact/v1`

Video Locus v1 is the browser-local path from an ordinary video source to a
portable, branch-aware TESSARYN Locus. It is not media playback and does not
claim calibrated metric reconstruction.

## Processing order

1. Build `tessaryn/local-file-index/v1` over the complete source in bounded
   4 MiB windows.
2. Decode nine evenly distributed source timestamps through a temporary local
   object URL.
3. Register all nine adjacent grayscale pyramids over translation and scale
   candidates.
4. Retain high-residual or histogram-divergent transitions as shot boundaries.
5. Form three ordered temporal groups and select one coherent spatial keyframe
   from each group.
6. Run the pinned same-origin Depth Anything V2 Small Q4 model on only the three
   admitted keyframes. The source pixels remain local.
7. Quantize source-colored surfels, their organized row/column grid, and a
   deterministic occupied surface field.
8. Commit each Moment as one observation Cell and one derived surface-field
   Cell.
9. Bind the six Cells into PHA artifacts, an ordered Rootprint graph, replay
   state, a Memory Capsule, and a removable SLBIT packet.
10. Reverify every generated layer before materializing the Locus.

The source object URL is revoked after frame decoding. The application shell
contains no visible `video` element.

## Pinned inference profile

```text
model: onnx-community/depth-anything-v2-small
revision: 413ce838e669ab7dfc01a6a396bf3d4397286d7f
q4 SHA-256: 5d55b02762e1907589158af3e366bd61ddf648155852a07bbf5e3a074639fcf8
runtime WASM SHA-256: c46655e8a94afc45338d4cb2b840475f88e5012d524509916e505079c00bfa39
network upload: false
remote models: disabled
```

The model and runtime are served by the same origin and cached on demand by the
service worker. If the model cannot initialize, a deterministic fallback depth
field remains available and is recorded as `deterministic-fallback` rather than
being mislabeled as model inference.

## Identity projection

Each observation payload commits to:

```text
source stream root
Moment ID
surfel channel digest
surfel count
organized surfel-grid dimensions or null
depth mode
metric-scale declaration
```

Each derived payload commits to:

```text
observation Cell ID
surface-field digest
surface-cell count
voxel size
metric-scale declaration
```

The canonical Cell manifest commits to the payload root, spatial and temporal
extent, source record, transformation record, policy root, parent relation, and
supersession relation. The PHA public inputs bind the Cell ID, channel root,
class, and policy root.

## Re-import

An importer must reject unless it can:

- parse strict integer JSON;
- find exactly three Moments and six Cells;
- recalculate every surfel and surface-field digest;
- reject any organized grid whose dimensions do not exactly cover its surfels;
- verify observation-to-derived parent relations;
- verify all Cell identities and PHA fingerprints;
- replay the complete Rootprint graph;
- verify the Memory Capsule and SLBIT binding;
- reproduce the stored counters.

Only after these checks may the renderer expose Condensation, Scale Breathing,
Chronofold, Trace, mutation challenge, or export controls.

## Geometry scope

The current video profile produces relative monocular geometry. It supports
spatial parallax, free observer movement around the reconstructed field, and
native temporal separation, but it does not infer an absolute physical scale.
Metric RGB-D input continues to use `tessaryn/reconstruction-artifact/v0`.

The viewer derives a discontinuity-aware indexed radiance surface from each
organized surfel grid. Major adjacent depth jumps remain open rather than being
bridged with invented geometry. The indexed surface is presentation state: the
identity-bearing artifact remains the quantized surfel grid and occupied surface
field, so changing GPU output cannot change Cell identity.
