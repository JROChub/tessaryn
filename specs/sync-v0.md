# Synchronization v0

`tessaryn/sync-packet/v0` transfers an encrypted `tessaryn/portable-locus/v0`
between devices while preserving its Rootprint branch.

A portable Locus contains no more than 4,096 Cells, 64 channels per Cell,
16,384 chunks, or 256 MiB of plaintext. Every chunk, channel Merkle root, Cell
Merkle root, canonical manifest, Cell ID, and one Power House bundle per Cell is
verified before encryption and again after decryption. Optional witness subjects
must identify the packet branch, materialization receipt, transferred Cells, or
transferred chunks.

Each packet binds:

```text
sender Ed25519 key
Rootprint branch
contiguous sequence
previous packet ID
creation time
encrypted payload digest
```

The packet ID and signature use separate domains. Receivers retain a head for
every sender/branch pair and reject duplicate packets, gaps, reordering, wrong
predecessors, branch substitution, invalid signatures, and noncanonical JSON.
Divergent branches remain independent streams until an explicit higher-level
merge.
