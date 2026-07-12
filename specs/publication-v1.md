# Write-Capable Object Weave v1

`tessaryn/publication-intent/v1` removes the source repository from the world
publication path. A publisher creates an origin-private Ed25519 identity in the
client, signs discovery metadata against an exact artifact digest, transfers the
artifact in resumable chunks, and receives a node-issued publication receipt
only after full local verification on the node.

GitHub is a software release channel. It is not a user-content admission layer.

## Identity boundary

The signed intent binds:

```text
object ID
title
SLBIT summary
artifact SHA-256
artifact byte count
media type
publisher creation time
32-byte random nonce
32-byte Ed25519 public key
```

The signature preimage begins with
`TESSARYN-WEAVE-PUBLICATION-v1\0`. Strings are UTF-8 with a little-endian
`u32` byte length. Byte count is little-endian `u64`; creation time is
little-endian `i64`; nonce and public key are appended as fixed 32-byte values.
The signature is not part of the preimage. Binary values use canonical unpadded
Base64 in JSON.

The upload ID, publication ID, publisher ID, artifact digest, Cell ID, and
Rootprint branch are separate identities. No catalog label changes artifact or
Cell identity. Human-facing labels reject control, bidi-override, isolation,
zero-width, and byte-order-mark characters so discovery text cannot visually
spoof those identifiers.

## Admission sequence

1. `GET /v1/policy` returns chunk, object, publisher, pending-byte,
   retained-byte, active-session, publication-count, and idle-expiry policy.
2. `POST /v1/uploads` verifies the signed intent and creates an idempotent
   upload session.
3. `GET /v1/uploads/<upload-id>` returns received and missing chunk indexes.
4. `PUT /v1/uploads/<upload-id>/chunks/<index>` admits one exact-size chunk
   whose SHA-256 is carried in `X-Tessaryn-Chunk-SHA256`.
5. `POST /v1/uploads/<upload-id>/commit` atomically assembles and hashes the
   artifact, then independently verifies its protocol and Power House layers.
6. `GET /v1/catalog` exposes accepted publication receipts.
7. `GET /v1/artifacts/<sha256-hex>` serves immutable bytes and supports one
   HTTP byte range.

Interrupted publication resumes from missing indexes. A repeated signed intent
produces the same upload identity. Repeated chunks are accepted only when their
bytes and digest are identical.

## Accepted artifacts

The initial node admits:

- `tessaryn/cinematic-object/v1`, including descriptor, media Merkle root, Cell,
  PHA, Rootprint, replay, Memory Capsule, and SLBIT verification;
- `tessaryn/reconstruction-artifact/v0`, including real RGB-D reconstruction,
  observation and SDF Cells, lineage, replay, Capsule challenges, and stored
  report equivalence.

Real sensor and authored/simulated objects remain distinct catalog classes.

## Persistence and replication

Artifacts are stored by SHA-256 and deduplicated independently of publication
metadata. Session, artifact, and receipt writes use temporary files, `fsync`,
atomic rename, and parent-directory synchronization. A second node can admit
the same signed intent and exact bytes without changing any object identity.

The protocol has no universal total-world byte limit. Every storage node must
advertise finite object and publisher capacity. Large worlds are composed from
content-addressed Cells and Loci rather than represented as one impossible
browser allocation.

## Discovery revocation

Object identity is immutable; public discovery is not. A publisher can sign a
`tessaryn/publication-revocation/v1` statement. The node then removes the
publication from its catalog while retaining content identity and any replicas
required by policy. Revocation must never claim to erase copies already held by
other authorized peers.

## Abuse boundary

Nodes reserve declared pending bytes before accepting chunks, cap global and
per-publisher active sessions, bound retained bytes and receipt counts, expire
idle uploads, and enforce request-body, connection, request-rate, per-object,
and per-publisher limits before expensive verification. Content identity does not
grant publication rights or legal immunity. Operators retain an explicit
discovery policy and can operate independent catalogs over the same immutable
artifact identities.
