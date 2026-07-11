# Development Status

Version: `0.1.0-rc.1`

The words Implemented, Measured, Reproduced, Experimental, and Speculative are
used as defined by the TESSARYN research charter.

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
| Custom domain and HTTPS | Implemented | Apex HTTPS and `www` canonical redirect verified 2026-07-10 |
| Real 20-40 meter pilot site | External acceptance required | No physical pilot dataset was supplied to this build environment |
| Three real capture sessions | External acceptance required | Requires capture hardware and site authorization |
| Independent second-machine reproduction | Not reproduced | External operator required |
| Trademark clearance | Not completed | Counsel and jurisdiction-specific review required |

## v0.1 Gate

The software release candidate is complete for internal conformance. TESSARYN
`0.1.0` remains evidence-gated until a real bounded place is captured in three
sessions, privacy-reviewed, independently reconstructed, verified offline,
measured against the reference budgets, and reproduced by an independent
operator. The bundled Vesper Court data is a deterministic reference Origin;
it is never represented as a physical capture.
