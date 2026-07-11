# TESSARYN

TESSARYN is an experimental native 4D reality-construction engine. It assembles
bounded places from portable spatial-temporal Cells without a map SDK, tile
service, panorama provider, globe, or provider-owned world model.

> The world is not loaded. It is constructed.

## Release State

This repository is `0.1.0-alpha.1`. It contains a tested World Cell kernel and a
synthetic Origin-to-Cell vertical slice named Vesper Court. It is not TESSARYN
v0.1 and does not claim a captured place, physical truth, production capture,
multi-device privacy, or independent reproduction. See [STATUS.md](STATUS.md).

The synthetic slice implements:

- strict integer-only Cell manifests and deterministic Cell IDs;
- domain-separated chunk hashing and Merkle roots;
- fixed-point Anchor transforms with explicit path divergence;
- a bounded, policy-aware Locus compiler and materialization receipts;
- local content-addressed storage with read-time digest verification;
- consent-gated deterministic surfel ingestion with exclusion-volume redaction;
- Power House `.pha`, Rootprint, replay, Memory Capsule, and SLBIT bindings;
- three branch-aware Moments and one unresolved reconstruction dispute;
- a restricted region whose protected geometry is absent;
- local browser verification and exact-layer mutation rejection;
- full-bleed native Three.js construction, Condensation, Scale Breathing,
  Chronofold, evidence Lens, and inside-out Cell Trace inspection;
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

## Verify The Kernel

```bash
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
RUSTDOCFLAGS="-D warnings" cargo doc --workspace --no-deps
cargo test --workspace --locked
./scripts/check-no-map-substrate.sh
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
- `crates/tessaryn-forge`: bounded capture-record ingestion and pre-publication redaction.
- `crates/tessaryn-weave`: deterministic Locus selection and receipts.
- `crates/tessaryn-powerhouse`: narrow Power House integration boundary.
- `tools/tessaryn-cli`: synthetic fixture generation and offline verification.
- `apps/viewer-web`: local-first native 4D viewer.
- `specs`: experimental protocol contracts.
- `conformance`: canonical vectors and expected reports.
- `sbom`: normalized CycloneDX 1.5 inventories bound to both lockfiles.

## Supply Chain

`cargo deny` enforces licenses, sources, wildcard policy, and the documented
advisory boundary. Nine normalized CycloneDX inventories cover every Rust crate
and the browser application. `node scripts/check-sbom.mjs` rejects stale
lockfile bindings, modified inventories, non-CycloneDX documents, timestamps,
and leaked workstation paths.

## Public Origin

The tested static viewer is published at the first-party MFENX path below and
mirrored by this repository's GitHub Pages workflow. Both distributions contain
no runtime map dependency, analytics SDK, remote world model, or upload endpoint.
`tessaryn.com` must not be attached until its DNS points to the deployed origin
and HTTPS is verified; see [deployment.md](docs/deployment.md).

[Open the experimental synthetic Origin](https://mfenx.com/tessaryn/)

[Open the GitHub Pages mirror](https://jrochub.github.io/tessaryn/)

## License

AGPL-3.0-only. See [LICENSE](LICENSE).
