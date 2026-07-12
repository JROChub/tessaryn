# Local File Index v1

Schema: `tessaryn/local-file-index/v1`

The browser `OPEN` path may index a local file without copying the complete file
into JavaScript memory and without sending bytes over the network. The profile
has no application-level total file-size ceiling. Browser, operating-system,
filesystem, storage throughput, and available time remain physical constraints.

The index uses 4 MiB leaves and an ordered Merkle mountain range so working
memory is bounded by one leaf plus `O(log n)` peak digests.

## Domains

```text
leaf = SHA-256(
  "TESSARYN-LOCAL-CHUNK-v1\0" ||
  chunk_index_u64_be ||
  chunk_length_u32_be ||
  chunk_bytes
)

node = SHA-256(
  "TESSARYN-LOCAL-NODE-v1\0" ||
  child_height_u32_be ||
  left_digest ||
  right_digest
)

root = SHA-256(
  "TESSARYN-LOCAL-FILE-v1\0" ||
  file_length_u64_be ||
  chunk_size_u32_be ||
  chunk_count_u64_be ||
  peak_count_u32_be ||
  (peak_height_u32_be || peak_digest)*
)
```

Peaks are emitted from left to right. Equal-height peaks merge immediately; the
older peak is the left child. Empty files have zero chunks and zero peaks.

Empty-file conformance root:

```text
sha256:4a92843406d137a82b73651f63a28c335e1d940f3d3becb00a8c1fd5ab2c3d00
```

The exported index records the root, byte length, chunk size, chunk count, local
filename, media type, and modification time. Filename, media type, and
modification time are descriptive and do not enter the stream root.

Video and image files are presented through a revocable local object URL while
the worker indexes them. This path is file-backed: presentation does not wait for
the entire file, and closing the file revokes the URL and cancels unfinished
indexing. Reconstruction JSON remains a strict manifest profile. Large channel
data belongs in file-backed chunks rather than one enormous JSON string.
