# Real Temporal Origin

TESSARYN `0.2.0` starts from a real RGB-D reconstruction of the TUM
`freiburg1_desk` sequence. It replaces the synthetic reference scene as the
default visible Origin while retaining Vesper Court as a deterministic protocol
conformance vector.

## Portable State

The artifact at
`apps/viewer-web/public/world/freiburg-desk-locus.json` contains:

- 48 exact source-frame identities and timestamps in four ordered selections;
- three canonical Moments and one unresolved alternate branch;
- 174,972 verified color surfels;
- 131,808 verified sparse-SDF voxels;
- nine Cell, PHA, Rootprint, replay, and Memory Capsule paths, including a
  dedicated source Aggregate Cell;
- an archive digest, selection digest, and aggregate source manifest;
- SLBIT summaries bound independently to each derived SDF Cell.

Raw RGB and depth images are not embedded. The four states are temporal windows
from one public benchmark sequence, not separate days. The alternate selection
overlaps the later sequence and remains a distinct Rootprint branch.

## Reproduce

The reproduction script downloads the official archive, verifies its SHA-256,
extracts it locally, selects the same 12 frames per state, rebuilds all Cells,
and requires byte identity with the committed artifact:

```bash
./scripts/reproduce-real-origin.sh
```

An existing download directory can be reused:

```bash
./scripts/reproduce-real-origin.sh /tmp/tessaryn-real-origin
```

The same process runs in the scheduled and manually dispatchable
`real-origin-reproduction` workflow. Normal CI verifies the committed artifact
on Linux, macOS, and Windows and deliberately mutates a selected timestamp to
confirm rejection at the source-manifest layer.

## Browser Materialization

The browser verifies the artifact in a dedicated worker, then renders captured
surfels and near-surface SDF matter directly. No map, panorama, tile, globe, or
remote world provider participates. Chronofold separates the three canonical
states and alternate branch while exact SDF intersections remain as shared
temporal structure. Scale Breathing continuously changes spatial detail, and
inside-out Trace modes reveal state, lineage, or removable SLBIT meaning.

The service worker retains the complete Origin after the first successful
same-origin load. Subsequent reconstruction and verification can complete with
networking disabled.
