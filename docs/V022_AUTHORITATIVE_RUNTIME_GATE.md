# v0.22 Authoritative Runtime Gate

The production Theater must never label browser-generated luminance depth, pass-through GPU output, orientation priors, or image-space accumulation as metric reconstruction.

## Runtime boundary

`keyxym_map` is the reconstruction authority. Tessaryn owns acquisition, rendering, controls, replay, transport, and verification. The browser bridge consumes the packed v0.22 ABI and exposes only runtime-produced pose, geometry, uncertainty, quality, and lineage.

Required artifacts:

- `keyxym-v22.mjs`
- `keyxym-v22.wasm`
- a SHA-256 manifest binding both artifacts to the `keyxym_map` commit

## Hard release gates

A World Cell may be sealed as v0.22 only when all are true:

1. The Keyxym runtime artifact digest matches the checked-in release manifest.
2. Pose recovery reports `recovered=true`.
3. Tracking confidence is at least 0.55.
4. Median parallax is at least 1.0 degree.
5. Reprojection error is finite and at most 3.0 pixels.
6. Confirmed geometry contains at least 256 surfels.
7. Every sealed surfel has source-keyframe lineage and finite uncertainty.
8. Metric scale is labelled `METRIC` only when supplied by calibrated sensor depth or an explicit calibration object.
9. Tracking loss freezes authoritative fusion and is recorded as evidence.
10. A receiving device recomputes the canonical digest before rendering the cell as verified.

When any gate fails, the Theater remains in `VISUAL PREVIEW / UNSEALED` state. Preview points can be shown, but cannot enter the canonical v0.22 geometry, Moment delta, Rootprint, or success counters.

## Immediate integration sequence

1. Publish the two Keyxym WASM artifacts from the successful `keyxym_map` workflow into `apps/viewer-web/public/keyxym/`.
2. Add their immutable digests to `apps/viewer-web/public/keyxym/manifest.json`.
3. Load the Emscripten ES module once, create one bounded 48,000-surfel session, and transfer packed frame records through the ABI.
4. Replace Theater pose and geometry counters with the runtime outputs.
5. Disable Moment and Seal controls until the hard gates pass.
6. Include runtime commit, artifact digests, adapter identity, frame commitments, pose output, geometry digest, and timings in each reconstruction receipt.

This gate is deliberately hostile to false success. Missing geometry is preferable to invented geometry; explicit tracking loss is preferable to silent corruption.