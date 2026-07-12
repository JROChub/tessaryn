# Cinematic Object v1

`tessaryn/cinematic-object/v1` packages a deliberately authored native temporal
object and one internal cinematic material in a single file-backed artifact.
It does not infer geometry from video. The media payload cannot replace the
object descriptor and is never presented as a player surface.

## Binary layout

All integer header fields are unsigned little-endian.

| Offset | Bytes | Field |
|---:|---:|---|
| 0 | 16 | `TESSARYN-CIN4D\0\0` |
| 16 | 4 | version, exactly `1` |
| 20 | 4 | header bytes, exactly `80` |
| 24 | 8 | strict JSON manifest bytes |
| 32 | 8 | cinematic media bytes |
| 40 | 32 | raw SHA-256 of the manifest bytes |
| 72 | 8 | zero-reserved |
| 80 | variable | `tessaryn/cinematic-object/v1` manifest |
| next | variable | MP4 payload |

The file length must equal `80 + manifest_bytes + media_bytes`. Trailing data,
nonzero reserved bytes, duplicate JSON keys, non-integer identity data, and
unknown critical profiles are rejected.

## Native object boundary

The manifest contains a `tessaryn/cinematic-object-descriptor/v1` descriptor.
That descriptor defines geometry profile, deterministic seed, World Cell count,
spatial bounds, temporal Moments, phase state, and SLBIT meaning. Its canonical
bytes are committed as a `geometry/procedural` channel.

The MP4 is split into 4 MiB chunks. Each chunk receives the normal
`TESSARYN-CHUNK-v0` identity, and the ordered payload is checked against the
manifest before materialization. The chunk set is committed as an
`appearance/cinematic` channel. The Cell root commits both descriptor and media.

The object Cell carries a Power House PHA, Rootprint replay identity, strict
Memory Capsule, and non-core SLBIT packet. Local verification must complete
before the renderer marks the object accepted.

## Rendering contract

The descriptor creates the object. The video may drive emissive color,
refraction, temporal phase, and internal memory flow, but it must not be used as
geometry, projected onto a standalone rectangle, or shown with browser media
controls. Removing the cinematic payload leaves the object structurally
defined but fails its critical appearance channel.
