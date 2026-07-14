# v0.22 Metric World Cell Standard

## Product truth

A camera frame is not geometry. Device orientation is not a six-degree-of-freedom trajectory. Luminance is not depth. A WebGPU dispatch is not evidence merely because it ran on a GPU.

v0.22 fails closed. The Theater may render an explicitly labelled transient preview, but it may not admit a surfel into confirmed World Cell geometry until an evidence backend supplies pose, depth, covariance, and lineage fields and the integrity gate accepts them.

## Authorities

Every observation declares separate pose and depth authorities:

- `visual-relative`: calibrated multi-view estimate with unresolved scale;
- `sensor-metric`: hardware depth, inertial, XR anchor, or equivalent metric authority;
- `fused-metric`: independently weighted visual and metric sensor estimates;
- `none`: no admissible estimate.

A known reference length establishes scale only when bound to a solved reconstruction and included in its receipt. Entering a number alone does not make geometry metric.

## Portable admission policy

`metric-integrity.ts` initially requires at least 80 features, 40 temporal correspondences, 28 RANSAC inliers, a 55% inlier ratio, 1.25 degrees median parallax, reprojection error no greater than 2.5 pixels, and bounded pose and geometry covariance.

These thresholds are protocol inputs, not marketing numbers. Device profiles may tighten them but may not silently weaken them.

## Claims

The UI must derive claims from the integrity decision:

- `TRACKING` indicates feature tracking health only;
- `6DOF SOLVED` requires an admitted pose backend;
- `RELATIVE GEOMETRY` requires admitted pose and triangulated relative depth;
- `METRIC GEOMETRY` additionally requires admissible scale authority;
- `SEALED METRIC CELL` requires confirmed geometry, metric scale, lineage, and the sealing threshold.

Tracking loss freezes fusion. A stale pose must never continue reconstruction.

## Reconstruction receipts

Each receipt commits to the shader, WASM, or native backend digest; adapter and browser execution identity; camera calibration and distortion model; selected keyframe digests; correspondence and RANSAC statistics; pose and geometry covariance; depth and scale authorities; accepted, uncertain, and rejected counts; parent Moment and Rootprint lineage; input and output digests; and elapsed time.

## Backend target

The ordinary-phone path should use a dedicated worker and deterministic WASM geometry core for calibrated features, KLT or descriptor matching, essential-matrix RANSAC, cheirality-tested pose decomposition, triangulation, and local bundle adjustment. WebGPU accelerates pyramids, gradients, descriptors, correspondence scoring, depth hypotheses, and surfel reduction. WebXR or LiDAR depth is an optional metric authority, not a prerequisite for relative reconstruction.

## Defensible novelty

The invention is not a generic point cloud. It is fail-closed geometric admission, per-surfel uncertainty and lineage, temporally branching Moments, executable reconstruction receipts, sovereign cross-device verification, and exact replay of an evidence-bound physical memory.
