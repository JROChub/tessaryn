# Privacy v0

Privacy is a disclosure policy, not a rendering effect.

- A restricted public Cell may expose a boundary without protected geometry.
- Blurring is not redaction when original detail remains recoverable.
- Publication and indexing require explicit capabilities.
- Revocation may remove keys and indexes while retaining a nonrevealing lineage commitment.
- Aggregate Cells must be tested for geometry and location leakage.

## Capture redaction

RGB-D privacy masks are canonical frame inputs. A mask byte of `1` removes that
pixel before local-normal estimation, deprojection, surfel output, SDF fusion,
or publication. Spatial exclusion volumes are then applied by the Forge before
the public chunk is encoded. Raw frame channels are omitted from reconstruction
reports.

## Restricted Locus transport

Restricted Loci use XChaCha20-Poly1305 authenticated encryption. A random
content key is wrapped independently for each canonical X25519 recipient using
HKDF-SHA256-derived wrapping keys. Header, recipient set, packet metadata, and
branch identity are authenticated. Ed25519 packet signatures, contiguous
sequence numbers, previous-packet identities, and receiver state reject
substitution, reordering, gaps, and replay.

Revocation prevents future decryptions at or after the earliest recorded
revocation time. It cannot erase plaintext that an authorized recipient already
decrypted, so retention and endpoint controls remain necessary.
