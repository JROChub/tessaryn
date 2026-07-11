# Reconstruction v0

`tessaryn/rgbd-session/v0` converts bounded RGB-D frames into two public Cells:
an observation Cell containing privacy-filtered surfels and a derived Cell
containing a sparse signed-distance field.

## Canonical input

Each frame binds calibration, capture time, fixed-point pose, little-endian
depth samples, aligned RGBA samples, and the optional one-byte privacy mask into
`TESSARYN-RGBD-FRAME-v0`. Frames are sorted by capture time and frame identity.
Identity-bearing transforms use integer micrometers and Q20/Q30 fixed point.

Limits are 2,048 frames, 16,777,216 pixels per frame, 64,000,000 pixels per
session, 1,000,000 public surfels, and 2,000,000 SDF voxels. Inputs outside the
declared depth interval, malformed quaternions, overflowing coordinates, and
stale frame identities reject.

## Privacy order

The mandatory processing order is:

1. validate the frame identity and dimensions;
2. reject a masked center or neighbor before local-normal estimation;
3. reject a masked sample before deprojection;
4. apply spatial exclusion volumes in the Forge;
5. encode the public surfel chunk;
6. fuse SDF voxels from the decoded public surfel chunk only.

Neither raw frame arrays nor redacted samples appear in a reconstruction report.

## Verification

`verify_reconstruction_report` independently recalculates the Forge report,
surfel and SDF chunk identities, Merkle roots, Cell IDs, parent relation, public
counters, reconstruction projection, and raw-frame absence. The CLI adds `.pha`,
Rootprint replay, multi-Cell lineage, SLBIT bindings, and strict Memory Capsule
challenge verification.
