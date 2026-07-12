# Development Status

Version: `0.5.0`

Capability states below describe the tested `0.5.0` release surface.

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
| High-fidelity Validation Lab | Implemented | Opt-in 48-frame TartanAir V2 640x640 RGB-D Locus, 212,565 surfels, 224,867 SDF voxels, 4 trajectory states |
| Provenance-bound dataset profile | Implemented | Source class, release, sensor model, ground truth, archive digests and sizes are identity-bearing |
| Explicit source-selection manifest | Implemented | Ordered frame IDs, source indices, synthetic timestamps, profile binding, mutation rejection, byte-identical reproduction workflow |
| Source Aggregate Cell | Implemented | Source manifest has its own PHA, replay, Memory Capsule, SLBIT packet, and top Rootprint branch |
| Real-sensor source adapters | Implemented | EuRoC, KITTI raw, and ScanNet layout, synchronization, bounded hashing, and receipt tests |
| Multilayer validation portfolio | Implemented | Shipped source-aware viewer distinguishes showcase ground truth from real-sensor stress adapters |
| Bounded Locus compiler | Implemented | Deterministic 10,000-Cell test |
| Power House bridge | Implemented | `.pha`, Rootprint, replay, Memory Capsule tests |
| Browser-local verifier and capture import | Implemented | Fixture and reconstruction-artifact verification, rendering, mutation rejection |
| Unbounded file-backed browser index | Implemented | No total application cap; 4 MiB worker windows, O(log n) stream root, progress, cancellation; raw media remains index-only |
| Native cinematic object package | Implemented | Strict binary header, authored geometry descriptor, chunked media commitments, Cell/PHA/Rootprint/replay/Memory Capsule verification |
| Native temporal matter renderer | Implemented | Diamond-plan atrium, inhabitable Cell walls, off-DOM committed temporal material, four Moments, Scale Breathing, Chronofold, provenance currents, SLBIT field |
| Personal Weave persistence | Implemented | Explicit origin-private retention, browser persistence request, local reopen, removal, and published-state tracking |
| Write-capable public Object Weave | Implemented | Browser Ed25519 identity, signed intent, resumable chunks, pending-byte/session reservations, stale-upload expiry, server-side cinematic and RGB-D reverification, atomic content-addressed commit, byte ranges, dynamic catalog, and discovery revocation |
| GitHub-independent user publication | Implemented | Real RGB-D and temporal objects publish from the product and receive stable publication receipts without repository access |
| Production Weave transport | Implemented | Dedicated node, restricted cloud firewall, loopback service, HTTPS, full/range retrieval, catalog admission, and owner-signed revocation verified 2026-07-12 |
| Authenticated private Loci | Implemented | XChaCha20-Poly1305, X25519/HKDF wrapping, revocation, tamper/property tests |
| Private multi-device Weave | Implemented | Ed25519 packets, chain/replay checks, branch preservation, local installation |
| Witness receipts | Implemented | Signed scoped statements, expiry, independence groups, no core authority |
| Cross-platform canonical fixture gate | Implemented | Linux, macOS, and Windows CI require byte-identical output |
| Lock-bound CycloneDX SBOM | Implemented | Per-crate and browser inventories checked in CI |
| Exact-layer mutation lab | Implemented | Cell, PHA core, binary, parser, and semantic rejection paths |
| Condensation | Implemented | Progressive structural materialization with distinct state copy |
| Scale Breathing | Implemented | Continuous object-to-site depth preserves the selected spatial anchor |
| Chronofold | Implemented | Three exact-ground-truth Moments, shared SDF structure, and unresolved branch geometry |
| Inside-out Trace | Implemented | Evidence, lineage, source, and removable meaning views |
| Constructed continuum visual system | Implemented | Identity-derived materials, memory branching, assembly, Rootprint currents, SLBIT fields, adaptive renderer |
| Custom domain and HTTPS | Implemented | Apex HTTPS and `www` canonical redirect verified 2026-07-10 |

## Release Contract

TESSARYN `0.5.0` is complete when the versioned software, deterministic
reference vectors, Validation Lab, local verification paths, mutation suite, browser experience,
offline path, supply-chain checks, and cross-platform conformance pass on the
release commit. The default starts in the private local construction field and
does not materialize synthetic ground truth or a public catalog object. Real
captures enter through `CONSTRUCT A PLACE`; validation data is opt-in through
`LAB`; public and device-owned objects remain available through `WEAVE` and
stable object/publication routes.
Vesper Court and the minimal reconstruction remain deterministic protocol vectors.
