# TESSARYN

TESSARYN is a local-first native 4D reality-construction engine. It assembles
bounded places from portable spatial-temporal Cells without a map SDK, tile
service, panorama provider, globe, or provider-owned world model.

> The world is not loaded. It is constructed.

## Release State

This repository is `0.1.0`. It contains the tested World Cell kernel,
capture-to-Cell reconstruction, authenticated private Locus exchange, signed
witness receipts, Power House packaging, a browser-local verifier, and the
Vesper Court deterministic reference Origin. See [STATUS.md](STATUS.md) for the
software release contract and optional field-evidence profile.

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
- three branch-aware Moments and one unresolved reconstruction dispute;
- a restricted region whose protected geometry is absent;
- strict local browser import, verification, rendering, and exact-layer
  mutation rejection for portable reconstruction artifacts;
- full-bleed native Three.js construction, Condensation, Scale Breathing,
  Chronofold, evidence Lens, and inside-out Cell Trace inspection;
- deterministic crystalline Cell lattices, Rootprint flow, SLBIT meaning
  constellations, temporal manifolds, and an adaptive software-renderer path;
- service-worker-backed offline operation after the first successful load.

## Run The Origin

```bash
cargo run -p tessaryn-cli -- generate-demo
cargo run -p tessaryn-cli -- verify-demo
cargo run -p tessaryn-cli -- challenge-demo
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

The browser `OPEN` control imports the same artifact without uploading it.

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
capture, reconstruction, and world networking remain outside its trusted core.
SLBIT meaning is bound to verified state but remains non-core.

## Evidence Boundary

A valid Cell proves that canonical bytes, declared chunks, provenance bindings,
and replay state match their committed identities. It does not prove that a
sensor was honest or that a physical claim is true. TESSARYN exposes identity,
lineage, replay, attribution, freshness, dispute, disclosure, witnesses, and
semantic status separately. It never compresses them into one truth score.

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
