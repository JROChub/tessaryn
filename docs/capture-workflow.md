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
does not contain raw frame arrays. Import it with the viewer's `CONSTRUCT A
PLACE` or `ADD` control to reverify and render it locally.

The intake also accepts complete validation-Locus JSON, `.tessaryn` temporal
objects, and GLB/GLTF/OBJ/PLY/STL source geometry. Source geometry is staged in
the traversable renderer and receives a local stream root, but it is not called
a World Cell and does not receive invented PHA or Rootprint state. GLTF
dependencies must be selected as local companion files; network dependencies
are rejected.

Arbitrary local media and binary artifacts use the file-backed local index
profile. There is no application-level total-size cap for indexing: the browser
reads fixed 4 MiB windows in a dedicated worker and retains only an `O(log n)`
stream-root accumulator. Raw video, image, and audio remain source evidence and
are not presented as reconstructed geometry or as a media player. Interactive
source-geometry decoding has a separate 512 MiB browser safety profile; larger
models are still indexed. Very large reconstruction channels must remain
external file-backed chunks referenced by a compact strict JSON manifest; they
must not be embedded into a single enormous JSON string. See
`specs/local-file-index-v1.md`.

Before physical capture, obtain site authorization, show a visible recording
state, define exclusion volumes, inspect the public derivative, test aggregate
and metadata leakage, and retain raw source only under an explicit local policy.
