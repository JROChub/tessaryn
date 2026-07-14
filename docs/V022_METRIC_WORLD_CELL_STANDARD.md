# v0.22 Metric World Cell Standard

## Non-negotiable product truth

A browser camera frame is not geometry. Device orientation is not a six-degree-of-freedom trajectory. Luminance is not depth. A WebGPU dispatch is not evidence merely because it ran on a GPU.

v0.22 therefore fails closed. The Theater may render an explicitly labelled transient preview, but it may not admit a surfel into confirmed World Cell geometry until an evidence backend supplies all required pose, depth, covariance, and lineage fields and the integrity gate accepts them.

## Authorities

Every admitted observation declares separate pose and depth authorities:

- `visual-relative`: calibrated multi-view visual pose or depth, scale unresolved;
- `sensor-metric`: hardware depth, inertial, XR anchor, or other metric sensor authority;
- `fused-metric`: independently weighted visual and metric sensor estimates;
- `none`: no admissible estimate.

A known reference length can establish scale only when it is bound to a solved visual reconstruction and included in the receipt. Merely entering a number does not make geometry metric.

## Admission thresholds

The initial portable policy in `metric-integrity.ts` requires at least 80 features, 40 temporal correspondences, 28 RANSAC inliers, a 55% inlier ratio, 1.25 degrees median parallax, reprojection error no greater than 2.5 pixels, and bounded pose and geometry covariance.

These thresholds are protocol inputs, not marketing numbers. Future device profiles may tighten them, but may not silently weaken them.

## Claims

The UI must derive claims from the integrity decision:

- `TRACKING` only indicates feature tracking health;
- `6DOF SOLVED` requires an admitted pose backend;
- `RELATIVE GEOMETRY` requires admitted pose and triangulated relative depth;
- `METRIC GEOMETRY` additionally requires an admissible scale authority;
- `SEALED METRIC CELL` requires confirmed geometry, metric scale, lineage, and the sealing threshold.

Tracking loss must freeze fusion. It must never continue by reusing a stale pose.

## Required receipt fields

Each reconstruction receipt commits to:

- shader/module or WASM backend digest;
- adapter and browser execution identity;
- camera calibration and distortion model;
- selected keyframe digests;
- correspondence and RANSAC statistics;
- pose and geometry covariance summaries;
- depth and scale authorities;
- accepted, uncertain, and rejected sample counts;
- parent Moment and Rootprint lineage;
- input and output digests and elapsed time.

## Backend roadmap

The ordinary-phone path should use a dedicated worker and a deterministic WASM geometry core for calibrated feature extraction, KLT/descriptor matching, essential-matrix RANSAC, cheirality-tested pose decomposition, triangulation, and local bundle adjustment. WebGPU should accelerate image pyramids, gradients, descriptors, correspondence scoring, depth hypotheses, and voxel/surfel reduction. WebXR/LiDAR depth remains an optional metric authority, never a prerequisite for relative reconstruction.

## Protection and novelty

The defensible invention is not a generic point cloud. It is the combination of fail-closed geometric admission, per-surfel uncertainty and lineage, temporally branching Moments, executable reconstruction receipts, sovereign cross-device verification, and exact replay of an evidence-bound physical memory.

No release may describe itself as metric while the integrity gate rejects metric scale or sealing.