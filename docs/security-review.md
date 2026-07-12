# Security Review Record

Status: engineering review for `0.5.0`.

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
- TartanAir import reads directly from two exact-size, digest-pinned ZIP
  archives and rejects missing entries, archive bombs, malformed PNGs, wrong
  dimensions, invalid float depth, malformed scientific poses, and noncanonical
  frame windows;
- dataset profiles bind source class, release, scene, sequence, sensor model,
  ground-truth declarations, source URLs, archive sizes, and archive digests;
- the validation artifact binds exact ordered frame IDs, source indices,
  synthetic timestamps, four reconstruction commitments, and nine
  Rootprint branches;
- the complete source projection is a ninth Aggregate Cell with its own PHA,
  Rootprint replay, Memory Capsule challenge suite, and top-lineage binding;
- validation verification runs in a dedicated worker and returns no redundant
  copy of the identity-bearing artifact;
- arbitrary local files use a separate worker, fixed 4 MiB reads, an O(log n)
  digest accumulator, and cancellable progress; indexing never converts the
  complete file into one JavaScript string or buffer;
- GLB/GLTF/OBJ/PLY/STL source previews retain that file-backed byte identity,
  enforce finite coordinates plus node/vertex and interactive-byte profiles,
  reject missing companions, and reject every network resource reference;
- EuRoC, KITTI, and ScanNet adapters reject symlinks, unsorted indexes,
  modality-count mismatches, resource overrun, and file-content mutation;
- public publication uses a browser-origin Ed25519 identity and signs exact
  object metadata, complete artifact SHA-256, byte count, nonce, and timestamp;
- upload sessions are deterministic and resumable; every chunk has an exact
  expected length and independently checked SHA-256;
- commit reassembles into a temporary file, recalculates the signed artifact
  digest, reruns reconstruction/cinematic and Power House verification, fsyncs,
  then atomically renames into a content-addressed store;
- discovery revocation requires the original publisher key and cannot mutate
  or claim erasure of artifact identity;
- node, Nginx, and systemd policies independently bound object size,
  publisher allocation, pending and retained bytes, active upload sessions,
  publication counts, idle-session lifetime, request body, request rate,
  connections, filesystem access, and exposed network surface;
- the web build has no analytics, map SDK, tile client, or remote world model;
  its only write path is the explicit signed Weave publication operation.

## Automated evidence

Workspace unit, property, mutation, strict clippy, rustdoc, browser, mobile,
offline, source-hygiene, no-map, SBOM, and cross-platform conformance gates run
in CI. Cargo-fuzz targets strict JSON, surfel/SDF codecs, and signed packet and
witness envelopes on a scheduled campaign. A separate scheduled workflow
downloads the official TartanAir V2 RGB and depth archives, verifies both
SHA-256 values, reconstructs the 48-frame Origin, and requires byte identity
with the release artifact.

## Deployment records

Deployment-specific cryptographic, privacy, capture-device, legal, and
reproduction records travel with the deployment they evaluate. The software
release is governed by the repository conformance suite.
