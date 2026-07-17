# World Cell Scan V4

Status: implemented browser-relative scan boundary

World Cell Scan V4 is the ordinary RGB-camera path used when no verified metric spatial adapter is present. It is intentionally separate from Keyxym/eform authority. A successful Scan V4 result is scale-free relative geometry and cannot create a Moment, seal, Rootprint, authoritative surfel, publication receipt, or transfer payload.

## Capture contract

The browser samples camera evidence at 320 pixels wide and captures six to
twelve bounded grayscale/RGBA keyframes while the user moves sideways around a
textured subject. A view is admitted only when direct tracking from the last
admitted keyframe has sufficient support, spatial coverage, and baseline. This
makes slow subpixel motion observable over time without manufacturing motion
from accumulated noise. The live display contains only the current bounded
tracking overlay; it never accumulates decorative or pseudo-depth particles.

## Reconstruction contract

The worker:

1. generates bounded adjacent, near-adjacent, and strategic long-baseline keyframe-pair candidates across the scan timeline;
2. performs mean-normalized patch matching with ratio and forward/backward consistency checks;
3. ranks several independent temporal baselines, then estimates an essential matrix for each candidate with deterministic RANSAC and the calibrated eight-point form using a declared approximate browser focal model;
4. enforces the essential-matrix singular-value constraint;
5. fits a calibrated rotation-only competing model and rejects a scan when that
   simpler model explains the correspondence field without observable translation;
6. evaluates all four relative-pose decompositions;
7. triangulates correspondences using homogeneous least squares;
8. requires positive depth in both cameras;
9. rejects points exceeding the reprojection-error limit;
10. requires spatial coverage and a minimum triangulation angle; and
11. continues to the next ranked baseline when a candidate is degenerate or fails acceptance; and
12. emits bounded scale-free points when at least one independently gated baseline passes the complete acceptance gate.

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
- the rotation-only competing model must fail at least one degeneracy condition:
  median residual no greater than 1.25 pixels, at least 16 rotation-consistent
  correspondences, inlier support of at least 0.60 at the 1.5-pixel threshold,
  and calibrated-homography orthogonality error no greater than 0.12;
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
