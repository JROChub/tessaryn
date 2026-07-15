# v0.22 Authoritative Runtime Gate

The production Theater must never label browser-generated luminance depth, pass-through GPU output, orientation priors, image-space accumulation, or transient forming-field samples as metric reconstruction.

## Authority boundaries

`keyxym_map` is the sole reconstruction authority. Its compiled browser frontend owns RGBA downsampling, persistent feature identities, temporal correspondence, pose recovery input, transient forming-field output, uncertainty-weighted fusion, quality, and reconstruction receipts.

Tessaryn owns acquisition, presentation, canonical Moment and Cell construction, replay, transfer, and verification. It does not implement a competing vision or geometry pipeline.

The browser assurance module applies the `eform/world-cell-assurance/v1` envelope and uses Power House 0.3.24 for PHA, Rootprint, deterministic replay, and strict Memory Capsule verification. Assurance work runs only when sealing or verifying a Cell, never in the frame-rate loop. Power House source is unchanged.

## Installed authority artifacts

The Theater verifies these exact files before requesting camera access:

- `keyxym-v22.mjs` — 9,546 bytes, SHA-256 `e9867b1979eeb9dc5109c3882b5c10d2bb81d23faa38fcfd6b6bd18c707035d4`
- `keyxym-v22.wasm` — 48,184 bytes, SHA-256 `3e2464e6be15a335d90c57c34d3066d5c265460eb9fe4166c5ed3f879f1c5f11`
- `build-closure.json` — 6,610 bytes, SHA-256 `fb73f660feb2d03c4aa102a90380f5ea688d85a1ea7532a1c84f9d0be1324a23`
- `manifest.json` — the v4 dual-field provenance contract

The runtime targets Keyxym source commit `700cb523ef9c1fb37733ffd1b1cbe0227be420c3` and ABI `keyxym-v22-browser-dual-field-4`.

This build is explicitly classified as an **independent audited semantic closure**, not a byte-identical private-repository checkout. The checked-in closure attestation binds every compiled file to both its closure blob and upstream Git blob, identifies files that differ byte-for-byte, records the official Emscripten 6.0.3 package SHA-256, and lists the executed parity tests. The browser verifier rejects any manifest that hides or changes that classification.

The installed assurance artifact is:

- `tessaryn-browser-assurance-v1.wasm` — 561,270 bytes, SHA-256 `74308022cd03f93ba5e73077f8a725c844cb1945290e5c8cd4a4f7ee99a8516b`

Its only permitted import is `tessaryn.random_fill`, backed by `crypto.getRandomValues` in a secure context.

## Executed reconstruction evidence

The installed Keyxym runtime passed all of the following before publication:

1. The unchanged upstream browser frontend test.
2. The unchanged upstream browser runtime test.
3. A three-frame translated 640×480 texture vector in native C++ and WebAssembly.
4. Byte-identical native/WebAssembly pose and quality receipts.
5. An exact native/WebAssembly result of 227 fused surfels.
6. Monotonic geometry revisions 1, 2, and 3.
7. Nonempty flow-aware forming-field output.
8. Rejection of a replayed nanosecond timestamp with `KEYXYM_V22_INVALID_ARGUMENT`.

The installed assurance module passes rustfmt, clippy with warnings denied, native seal-and-mutation tests, `wasm32-unknown-unknown` compilation, and import/export inspection.

## Hard release gates

A World Cell may be sealed as v0.22 only when all are true:

1. Every Keyxym and assurance artifact matches its checked-in byte length and SHA-256 manifest record.
2. The Keyxym build-closure attestation matches the approved closure digest, toolchain, upstream identities, and validation transcript.
3. Pose recovery reports `recovered=true`.
4. Tracking confidence is at least 0.55.
5. Median parallax is at least 1.0 degree.
6. Reprojection error is finite and at most 3.0 pixels.
7. Confirmed geometry contains at least 256 surfels.
8. Every sealed surfel has source-keyframe lineage and finite uncertainty.
9. Metric scale is labelled `METRIC` only when supplied by verified calibrated sensor evidence. A typed reference length alone cannot promote monocular capture to metric truth.
10. Tracking loss freezes authoritative snapshot advancement and is recorded as evidence.
11. The canonical Moment lineage binds the source commitment, native Keyxym receipt pair, runtime commitment, geometry revision, pose, quality, scale state, and parent Moment.
12. The complete canonical Cell is signed through the eform assurance profile and reverified through Power House PHA, Rootprint, replay, and Memory Capsule state.
13. A receiving device verifies transferred bytes, every Moment, the Cell digest, assurance signature, PHA, Rootprint, replay fingerprint, and Memory Capsule before authoritative rendering.

When any gate fails, the Theater remains in `VISUAL PREVIEW / UNSEALED` state. Forming-field points may be shown immediately but can never enter canonical geometry, a Moment, Rootprint, PHA, Memory Capsule, or success counter.

This gate is deliberately hostile to false success. Missing geometry is preferable to invented geometry; explicit tracking loss is preferable to silent corruption; disclosed semantic derivation is preferable to false source provenance.
