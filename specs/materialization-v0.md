# Materialization v0

A Locus query includes an Anchor, local spatial bounds, temporal bounds,
capabilities, lineage selection, quality and resource ceilings, and a Lens.

The v0 compiler selects Cells deterministically by temporal start,
class rank, and Cell ID. Restricted Cells are excluded unless their policy root
is in the caller-validated capability set. The receipt commits to a digest of
that set without embedding capability secrets. Disputed Cells are returned as
explicit conflict sets. Selection is capped before materialization.

The receipt commits to selected Cell IDs, conflict sets, policy exclusions, and
bounds exclusions under `TESSARYN-MATERIALIZATION-v0`.
