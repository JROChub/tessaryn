# Development Status

Version: `0.1.1`

Capability states below describe the tested `0.1.1` release surface.

| Capability | State | Evidence |
|---|---|---|
| Separate repository and dependency boundary | Implemented | Workspace layout and CI policy |
| Cell v0 strict schema | Implemented | Rust tests and generated fixture |
| Integer-only canonical identity | Implemented | Duplicate-key, float, ordering, and mutation tests |
| Chunk Merkle binding | Implemented | Order and mutation tests |
| Fixed-point Anchor Graph | Implemented | Composition and divergence tests |
| Local content-addressed store | Implemented | Round-trip, size, and tamper tests |
| Consent-gated surfel record ingestion | Implemented | Authorization, exclusion, deterministic ordering, malformed-input tests |
| File-backed RGB-D capture adapter | Implemented | Exact channel sizes, confined paths, declared frame-ID rejection |
| Per-pixel privacy masks | Implemented | Identity-bound and applied before normals, deprojection, surfels, and SDF |
| Deterministic sparse SDF reconstruction | Implemented | Canonical codec, bounded fusion, report replay, mutation tests |
| Public reconstruction reports without raw frames | Implemented | Independent report, Cell, chunk, PHA, lineage, and Capsule verification |
| Bounded Locus compiler | Implemented | Deterministic 10,000-Cell test |
| Power House bridge | Implemented | `.pha`, Rootprint, replay, Memory Capsule tests |
| Browser-local verifier and capture import | Implemented | Fixture and reconstruction-artifact verification, rendering, mutation rejection |
| Authenticated private Loci | Implemented | XChaCha20-Poly1305, X25519/HKDF wrapping, revocation, tamper/property tests |
| Private multi-device Weave | Implemented | Ed25519 packets, chain/replay checks, branch preservation, local installation |
| Witness receipts | Implemented | Signed scoped statements, expiry, independence groups, no core authority |
| Cross-platform canonical fixture gate | Implemented | Linux, macOS, and Windows CI require byte-identical output |
| Lock-bound CycloneDX SBOM | Implemented | Per-crate and browser inventories checked in CI |
| Exact-layer mutation lab | Implemented | Cell, PHA core, binary, parser, and semantic rejection paths |
| Condensation | Implemented | Progressive structural materialization with distinct state copy |
| Scale Breathing | Implemented | Object, room, and site representations preserve selection |
| Chronofold | Implemented | Three reference Moments and unresolved branch geometry |
| Inside-out Trace | Implemented | Evidence, lineage, source, and removable meaning views |
| Constructed continuum visual system | Implemented | Identity-derived materials, memory branching, assembly, Rootprint currents, SLBIT fields, adaptive renderer |
| Custom domain and HTTPS | Implemented | Apex HTTPS and `www` canonical redirect verified 2026-07-10 |

## Release Contract

TESSARYN `0.1.1` is complete when the versioned software, deterministic
reference Origin, local verification paths, mutation suite, browser experience,
offline path, supply-chain checks, and cross-platform conformance pass on the
release commit. The bundled Vesper Court data is the canonical reference Origin
used by those release gates.
