# World Cell Scan V4

Status: implemented browser-relative scan boundary

World Cell Scan V4 is the ordinary RGB-camera path used when no verified metric spatial adapter is present. It is intentionally separate from Keyxym/eform authority. A successful Scan V4 result is scale-free relative geometry and cannot create a Moment, seal, Rootprint, authoritative surfel, publication receipt, or transfer payload.

## Capture contract

The browser captures four to twelve bounded grayscale/RGBA keyframes while the user moves sideways around a textured subject. A view is admitted only when measured feature tracking has sufficient support, spatial coverage, and inter-frame motion. The live display contains only the current bounded tracking overlay; it never accumulates decorative or pseudo-depth particles.

## Reconstruction contract

The worker:

1. selects a separated keyframe pair;
2. performs mean-normalized patch matching with ratio and forward/backward consistency checks;
3. estimates an essential matrix with deterministic RANSAC and the calibrated eight-point form using a declared approximate browser focal model;
4. enforces the essential-matrix singular-value constraint;
5. evaluates all four relative-pose decompositions;
6. triangulates correspondences using homogeneous least squares;
7. requires positive depth in both cameras;
8. rejects points exceeding the reprojection-error limit;
9. requires spatial coverage and a minimum triangulation angle; and
10. emits bounded scale-free points only when the complete acceptance gate passes.

If any gate fails, the result is `no-geometry`. The browser must display the failure measurements and create no point cloud.

## Required runtime identity

```text
data-visual-pipeline=tessaryn-world-cell-scan-v4
data-visual-renderer=world-cell-scan-v4
data-scan-version=4
```

Scan states are `ready`, `capturing`, `solving`, `reconstructed`, and `rejected`.

## Acceptance thresholds

The reference implementation requires:

- at least 24 stable pair matches;
- at least 24 essential-matrix inliers;
- at least 16 accepted triangulated points after spatial trimming;
- a majority positive-depth solution, with positive-depth ratio of at least 0.50;
- median reprojection error no greater than 3.5 pixels;
- median triangulation angle of at least 0.35 degrees; and
- image coverage of at least 0.24 over a 6 by 4 grid.

These thresholds bound false geometry; they do not confer metric or protocol authority.

## Authority boundary

The Scan V4 evidence record must state:

```json
{
  "authoritative": false,
  "metric": false,
  "momentAllowed": false,
  "sealAllowed": false,
  "rootprintAllowed": false
}
```

A verified native spatial adapter remains required for metric Keyxym reconstruction and eform assurance.
