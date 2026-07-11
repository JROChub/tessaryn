# Capture Workflow

TESSARYN accepts an offline RGB-D file request. The capture device or adapter
must produce one depth file (`u16` little-endian millimeters), one aligned RGBA8
file, and optionally one privacy mask (`u8`, where `1` is excluded) per frame.

All paths are relative to the request JSON directory. Absolute paths, parent
traversal, symlink escapes, changing files, and incorrect byte counts reject.
The request must also declare calibration, a Q30 camera-to-Anchor pose, capture
time, capture policy, and reconstruction policy. A declared frame ID is optional;
when present it must match the complete frame contents.

```bash
cargo run --locked -p tessaryn-cli -- \
  reconstruct-rgbd-files capture/request.json capture/artifact.json
cargo run --locked -p tessaryn-cli -- \
  verify-reconstruction capture/artifact.json
```

The resulting artifact is public-shareable only if its policy permits
publication. It contains the filtered surfel and SDF chunks, Cell manifests,
Power House bundles, Rootprint lineage, SLBIT packets, and Memory Capsules. It
does not contain raw frame arrays. Import it with the viewer's `OPEN` control to
reverify and render it locally. The browser profile accepts artifacts up to 128
MiB; larger bounded artifacts remain verifiable with the 256 MiB CLI profile.

Before physical capture, obtain site authorization, show a visible recording
state, define exclusion volumes, inspect the public derivative, test aggregate
and metadata leakage, and retain raw source only under an explicit local policy.
