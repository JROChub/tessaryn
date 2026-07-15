# v0.22 Authoritative Runtime Gate

The production Theater must never label browser-generated luminance depth, pass-through GPU output, orientation priors, image-space accumulation, or transient forming-field samples as metric reconstruction.

## Authority boundaries

`keyxym_map` is the sole reconstruction authority. Its compiled browser frontend owns RGBA downsampling, persistent feature identities, temporal correspondence, pose recovery input, transient forming-field output, uncertainty-weighted fusion, quality, and reconstruction receipts.

Tessaryn owns acquisition, presentation, canonical Moment and Cell construction, replay, transfer, and verification. It does not implement a competing vision or geometry pipeline.

The browser assurance module applies the `eform/world-cell-assurance/v1` envelope and uses Power House 0.3.24 for PHA, Rootprint, deterministic replay, and strict Memory Capsule verification. Assurance work runs only when sealing or verifying a Cell, never in the frame-rate loop. Power House source is unchanged.

## Installed authority artifacts

The Theater verifies these exact files before requesting camera access:

- `keyxym-v22.mjs` — 9,026 bytes, SHA-256 `ba0b596d150239c14c18530ed369fcff0ef222c74774e54ac6f6f160aab98e1c`
- `keyxym-v22.wasm` — 47,030 bytes, SHA-256 `e265f9c5d843f2fb0a1e9399cc5162cb08cca06a6b92d5d469419f5a3a4add75`
- `manifest.json` — the v4 source-exact dual-field provenance contract

The runtime is built from merged Keyxym `main` commit `5187ff10dfb63d4abbfee51ab894451efe428490` and ABI `keyxym-v22-browser-dual-field-4`.

The manifest requires `source_exact=true`, the unified C++ perception ABI, and the official Emscripten 6.0.3 release package SHA-256 `3f32b91a3f8d405846ccacee911f9364da75f413fbd11ea1f3f7f23bf9d07cf3`. The browser verifier rejects semantic closures, missing validation lanes, substituted source commits, or extra artifact records.

The retained merged-source bundle was installed by run `29413453432`, which reverified the artifact bytes and manifest, removed the obsolete `build-closure.json` sidecar, ran viewer tests and a production build, and committed only the final product assets.

The installed assurance artifact is:

- `tessaryn-browser-assurance-v1.wasm` — 561,270 bytes, SHA-256 `74308022cd03f93ba5e73077f8a725c844cb1945290e5c8cd4a4f7ee99a8516b`

Its only permitted import is `tessaryn.random_fill`, backed by `crypto.getRandomValues` in a secure context.

## Executed reconstruction evidence

The merged Keyxym authority passed all of the following before publication:

1. Exact Git-blob identity for nineteen compiled source and upstream test files.
2. Strict GCC build and unchanged browser frontend/runtime tests.
3. Clang AddressSanitizer and UndefinedBehaviorSanitizer.
4. MSVC `/W4 /permissive- /WX` build and tests.
5. Embeddable SDK build, install, and browser-header verification.
6. Checksum-verified official Emscripten 6.0.3 build.
7. A three-frame translated 640×480 WebAssembly runtime vector.
8. 95 recovered inliers, 163 authoritative surfels, and geometry revision 3 in the final merged-source build.
9. Nonzero native Keyxym pose and quality receipts.
10. Nonempty flow-aware forming-field output.
11. Rejection of a replayed nanosecond timestamp with `KEYXYM_V22_INVALID_ARGUMENT`.

Exact-source matrix run: `29412516894`. Merged-source artifact run: `29412763810`.

The installed assurance module passes rustfmt, clippy with warnings denied, native seal-and-mutation tests, `wasm32-unknown-unknown` compilation, and import/export inspection. The native eform profile is merged at commit `8096e8c1cdc52ee0326f75d7e62d9c3dc16b1e16`.

## Hard release gates

A World Cell may be sealed as v0.22 only when all are true:

1. Every Keyxym and assurance artifact matches its checked-in byte length and SHA-256 manifest record.
2. The Keyxym manifest proves a source-exact build from the approved merged source commit and toolchain package.
3. The required GCC, sanitizer, MSVC, mobile-SDK, and WebAssembly validation lanes are recorded as passed.
4. Pose recovery reports `recovered=true`.
5. Tracking confidence is at least 0.55.
6. Median parallax is at least 1.0 degree.
7. Reprojection error is finite and at most 3.0 pixels.
8. Confirmed geometry contains at least 256 surfels.
9. Every sealed surfel has source-keyframe lineage and finite uncertainty.
10. Metric scale is labelled `METRIC` only when supplied by verified calibrated sensor evidence. A typed reference length alone cannot promote monocular capture to metric truth.
11. Tracking loss freezes authoritative snapshot advancement and is recorded as evidence.
12. The canonical Moment lineage binds the source commitment, native Keyxym receipt pair, runtime commitment, geometry revision, pose, quality, scale state, and parent Moment.
13. The complete canonical Cell is signed through the eform assurance profile and reverified through Power House PHA, Rootprint, replay, and Memory Capsule state.
14. A receiving device verifies transferred bytes, every Moment, the Cell digest, assurance signature, PHA, Rootprint, replay fingerprint, and Memory Capsule before authoritative rendering.

When any gate fails, the Theater remains in `VISUAL PREVIEW / UNSEALED` state. Forming-field points may be shown immediately but can never enter canonical geometry, a Moment, Rootprint, PHA, Memory Capsule, or success counter.

This gate is deliberately hostile to false success. Missing geometry is preferable to invented geometry; explicit tracking loss is preferable to silent corruption; source-exact provenance is preferable to an undisclosed reconstruction.
