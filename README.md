# TESSARYN

TESSARYN is a local-first native 4D reality-construction engine. It assembles
bounded places from portable spatial-temporal Cells without a map SDK, tile
service, panorama provider, globe, or provider-owned world model.

> The world is not loaded. It is constructed.

## Release State

This repository is `0.3.0`. It contains the tested World Cell kernel,
capture-to-Cell reconstruction, authenticated private Locus exchange, signed
witness receipts, Power House packaging, a browser-local verifier, and the
TartanAir V2 ArchViz Tiny House validation Origin. Vesper Court remains a
deterministic protocol vector. See [STATUS.md](STATUS.md) for the software
release contract.

The release implements:

- strict integer-only Cell manifests and deterministic Cell IDs;
- domain-separated chunk hashing and Merkle roots;
- fixed-point Anchor transforms with explicit path divergence;
- a bounded, policy-aware Locus compiler and materialization receipts;
- local content-addressed storage with read-time digest verification;
- consent-gated RGB-D ingestion with identity-bound per-pixel masks and
  exclusion-volume redaction before deprojection and sparse SDF fusion;
- independently reverifiable reconstruction reports that omit raw frames;
- XChaCha20-Poly1305 encrypted Loci with X25519 multi-recipient key wrapping;
- Ed25519 signed, replay-protected, branch-preserving peer synchronization;
- signed witness receipts with explicit attestation classes and independence
  groups that never acquire core proof authority;
- Power House `.pha`, Rootprint, replay, Memory Capsule, and SLBIT bindings;
- a reproducible 640x640 RGB-D Origin with 48 archive-bound frames, 212,565
  verified surfels, and 224,867 verified sparse-SDF voxels;
- a provenance-bound dataset profile that keeps synthetic ground truth and
  real sensor evidence cryptographically distinct;
- three branch-aware trajectory Moments and one alternate reconstruction branch;
- real-sensor layout adapters for EuRoC stereo/IMU, KITTI stereo/LiDAR/OXTS,
  and ScanNet RGB-D sources, each producing a content-bound inspection receipt;
- a restricted region whose protected geometry is absent;
- strict local browser import, verification, rendering, and exact-layer
  mutation rejection for portable reconstruction artifacts;
- browser-local video reconstruction with pinned on-device relative-depth
  inference, multiscale image registration, shot-aware temporal grouping, six
  identity-bearing World Cells, three Chronofold Moments, and no media-player
  substitution;
- file-backed source indexing with no total application size cap,
  worker-isolated 4 MiB windows, bounded memory, progress, cancellation, and
  deterministic stream roots;
- worker-isolated verification of temporal artifacts with explicit source
  selection manifests and exact mutation rejection;
- full-bleed native Three.js construction, Condensation, continuous Scale Breathing,
  Chronofold, provenance Lens, and inside-out Cell Trace inspection;
- identity-derived matter, branching memory architecture, Cell condensation,
  Rootprint currents, living SLBIT constellations, temporal manifolds, and an
  adaptive software-renderer path;
- service-worker-backed offline operation after the first successful load.

## Run The Origin

```bash
cargo run -p tessaryn-cli -- generate-demo
cargo run -p tessaryn-cli -- verify-demo
cargo run -p tessaryn-cli -- challenge-demo
cargo run -p tessaryn-cli -- verify-validation-locus \
  apps/viewer-web/public/world/archviz-tiny-house-locus.json
cd apps/viewer-web
npm ci
npm run dev
```

Open `http://localhost:5173`. The viewer reads only local, same-origin fixture
data. It does not upload proof or world data.

The production Origin is available at [tessaryn.com](https://tessaryn.com/).

## Reconstruct A Capture

`reconstruct-rgbd-files` accepts bounded little-endian depth, RGBA, and optional
one-byte privacy-mask channels. Paths are confined to the request directory and
must have exact dimensions. The output is a portable JSON artifact containing
privacy-filtered surfels, sparse SDF, `.pha` bindings, Rootprint lineage, SLBIT
packets, and strict Memory Capsules.

```bash
cargo run -p tessaryn-cli -- \
  reconstruct-rgbd-files capture/request.json capture/artifact.json
cargo run -p tessaryn-cli -- \
  verify-reconstruction capture/artifact.json
```

The browser `OPEN` control imports the same artifact without uploading it. A
normal video enters a separate local construction path: the browser commits the
source stream, decodes nine shot samples, estimates image-space camera motion,
preserves shot discontinuities, selects three coherent keyframes, and runs the
pinned Depth Anything V2 Small model from same-origin assets only on those
admitted Moments before constructing three temporal surfel and
surface-field states. Each coherent keyframe retains an identity-bound organized
surfel grid; the native renderer triangulates only continuous neighbors into a
source-colored radiance surface while retaining the surfels as inspectable
evidence. Those states are bound into six Cell manifests, PHA
fingerprints, a Rootprint replay graph, a Memory Capsule, and an independent
SLBIT packet before the native viewer accepts them. The source is never shown as
the resulting world and no `<video>` player exists in the application shell.

The generated `tessaryn/video-locus-artifact/v1` JSON can be exported and
re-imported. Re-import recalculates geometry digests, Cell identities, PHA
bindings, Rootprint replay, and Memory Capsule integrity before materialization.
Monocular depth is relative rather than metric; RGB-D artifacts retain the
stronger fixed-point metric reconstruction profile described above.

## Reproduce The Validation Origin

The committed visual Origin is derived from the official TartanAir V2
`ArchVizTinyHouseDay/Data_easy/P000/lcam_front` sequence under CC BY 4.0. Its
profile binds source class, exact RGB and depth archive digests and byte counts,
640x640 calibration, simulator depth and pose ground truth, ordered frame
selection, reconstruction Cells, and Rootprint lineage. Details are in
[docs/validation-portfolio.md](docs/validation-portfolio.md) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

```bash
./scripts/reproduce-validation-origin.sh
```

Real sensor datasets remain local under their own terms. Their adapters verify
layout, synchronization, and every source file before issuing a receipt:

```bash
cargo run -p tessaryn-cli -- inspect-dataset euroc /data/MH_01_easy receipt.json
cargo run -p tessaryn-cli -- inspect-dataset kitti /data/2011_09_26_drive receipt.json
cargo run -p tessaryn-cli -- inspect-dataset scannet /data/scene0000_00 receipt.json
```

## Verify The Kernel

```bash
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
RUSTDOCFLAGS="-D warnings" cargo doc --workspace --no-deps
cargo test --workspace --locked
./scripts/check-no-map-substrate.sh
node scripts/check-source-hygiene.mjs
node scripts/check-sbom.mjs
cd apps/viewer-web && npm test && npm run build
```

## Architecture

```text
Cell schema -> canonical identity -> local store -> Anchor Graph
     -> World Weave -> bounded Locus -> native renderer
     -> TESSARYN Power House bridge -> .pha / Rootprint / Memory Capsule
```

Power House remains the verification and provenance authority. Rendering,
capture, reconstruction, and world networking remain separate product layers.
SLBIT meaning is independently bound to verified state and can be removed or
replaced without changing Cell identity.

## Local Verification

The local verifier checks canonical Cell identity, declared chunk digests and
Merkle roots, `.pha` bindings, Rootprint lineage, deterministic replay, Memory
Capsule integrity, witness receipts, and SLBIT packet bindings. Results expose
identity, lineage, replay, attribution, freshness, dispute, disclosure,
witnesses, and meaning as independently inspectable dimensions.

## Repository Map

- `crates/tessaryn-schema`: identity-bearing Cell types and limits.
- `crates/tessaryn-canonical`: strict parsing, canonicalization, IDs, and Merkle roots.
- `crates/tessaryn-anchor`: fixed-point relational coordinate graph.
- `crates/tessaryn-store`: local content-addressed Cell and chunk storage.
- `crates/tessaryn-transport`: canonical Base64 transport for bounded binary fields.
- `crates/tessaryn-forge`: bounded capture ingestion and pre-publication redaction.
- `crates/tessaryn-reconstruct`: fixed-point RGB-D reconstruction and sparse SDF fusion.
- `crates/tessaryn-privacy`: authenticated encryption, recipient wrapping, and revocation.
- `crates/tessaryn-weave`: deterministic Locus selection and receipts.
- `crates/tessaryn-sync`: signed encrypted selective-Locus peer exchange.
- `crates/tessaryn-witness`: scoped signed witness receipts and evidence dimensions.
- `crates/tessaryn-powerhouse`: narrow Power House integration boundary.
- `tools/tessaryn-cli`: reference generation, capture reconstruction, and offline verification.
- `apps/viewer-web`: local-first native 4D viewer.
- `specs`: versioned protocol contracts.
- `conformance`: canonical vectors and expected reports.
- `sbom`: normalized CycloneDX 1.5 inventories bound to both lockfiles.

## Supply Chain

`cargo deny` enforces licenses, sources, wildcard policy, and the documented
advisory boundary. Normalized CycloneDX inventories cover every Rust crate and
the browser application. `node scripts/check-sbom.mjs` rejects stale
lockfile bindings, modified inventories, non-CycloneDX documents, timestamps,
and leaked workstation paths.

## Public Origin

The tested static viewer is published at `https://tessaryn.com/`. GitHub Pages
deploys only after the conformance workflow succeeds. The apex and `www` hosts
use HTTPS, with `www` redirected to the apex. The distribution contains no
runtime map dependency, analytics SDK, remote world model, or upload endpoint.

[Open TESSARYN](https://tessaryn.com/)

## License

AGPL-3.0-only. See [LICENSE](LICENSE).
