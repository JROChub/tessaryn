# Architecture

TESSARYN is split into a small deterministic kernel and an experimental product
surface. The kernel owns Cell schemas, canonical identity, Anchor transforms,
local storage, Locus selection, and the Power House adapter. The viewer owns GPU
buffers, presentation, interaction, and non-core semantic rendering.

## Data Flow

```text
Capture or synthetic input
  -> Cell Forge report
  -> canonical Cell manifest and addressed chunks
  -> local Cell store
  -> Anchor Graph and World Weave
  -> bounded Locus query
  -> materialization receipt
  -> native renderer
```

The Power House adapter projects canonical Cell identity into
`tessaryn/world-cell/v0`, creates Rootprint lineage, and packages a bounded Cell
memory. It does not import rendering or capture code into Power House.

The portable Cell Capsule profile declares the exact compatible Power House
release and leaves optional host-platform metadata unset. OS, architecture, and
hardware belong in non-identity reproduction receipts; allowing them into the
Capsule digest would make one Cell produce different portable identities on
Linux, macOS, and Windows.

## Stable Boundary

The alpha kernel APIs are experimental but deterministic. GPU pixels are not
identity-bearing. Cell manifests, chunk roots, transforms, selected state, and
materialization receipts are identity-bearing where their schema says so.
