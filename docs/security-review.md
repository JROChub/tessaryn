# Security Review Record

Status: engineering review for `0.2.0`.

## Boundaries reviewed

- strict JSON rejects duplicate keys, floats, unsafe integers, deep input, and
  alternate canonical transport;
- binary codecs enforce magic, exact length, count, and resource limits;
- frame privacy masks are identity-bearing and precede every geometry output;
- public reconstruction verification requires raw-frame absence;
- XChaCha20-Poly1305 authenticates encrypted Loci and per-recipient key wraps;
- X25519/HKDF keys bind the ephemeral key, recipient, recipient set, and header;
- Ed25519 synchronization packets bind sender, branch, sequence, predecessor,
  creation time, and encrypted payload;
- receiver state rejects replay, gaps, reordering, and branch substitution;
- every transferred Cell includes a locally verified Power House bundle;
- witness receipts remain scoped, signed, expiring, and independently bound;
- the renderer never renders imported text as HTML;
- file-backed capture paths are confined and exact-sized;
- TUM source indexes require strict sorted timestamps, confined paths, bounded
  PNG dimensions, fixed calibration, deterministic association, and exact frame
  selection manifests;
- the real temporal artifact binds the official archive digest, exact ordered
  frame IDs and timestamps, four reconstruction commitments, and nine
  Rootprint branches;
- the complete source projection is a ninth Aggregate Cell with its own PHA,
  Rootprint replay, Memory Capsule challenge suite, and top-lineage binding;
- temporal verification runs in a dedicated worker and returns no redundant
  copy of the identity-bearing artifact;
- the web build has no analytics, upload endpoint, map SDK, tile client, or
  remote world model.

## Automated evidence

Workspace unit, property, mutation, strict clippy, rustdoc, browser, mobile,
offline, source-hygiene, no-map, SBOM, and cross-platform conformance gates run
in CI. Cargo-fuzz targets strict JSON, surfel/SDF codecs, and signed packet and
witness envelopes on a scheduled campaign. A separate scheduled workflow
downloads the official TUM archive, verifies its SHA-256, reconstructs the
48-frame Origin, and requires byte identity with the release artifact.

## Deployment records

Deployment-specific cryptographic, privacy, capture-device, legal, and
reproduction records travel with the deployment they evaluate. The software
release is governed by the repository conformance suite.
