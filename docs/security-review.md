# Security Review Record

Status: engineering review for `0.1.1`.

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
- the web build has no analytics, upload endpoint, map SDK, tile client, or
  remote world model.

## Automated evidence

Workspace unit, property, mutation, strict clippy, rustdoc, browser, mobile,
offline, source-hygiene, no-map, SBOM, and cross-platform conformance gates run
in CI. Cargo-fuzz targets strict JSON, surfel/SDF codecs, and signed packet and
witness envelopes on a scheduled campaign.

## Deployment records

Deployment-specific cryptographic, privacy, capture-device, legal, and
reproduction records travel with the deployment they evaluate. The software
release is governed by the repository conformance suite.
