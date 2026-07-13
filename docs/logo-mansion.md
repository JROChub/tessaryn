# TESSARYN Logo Mansion

`TESSARYN / LOGO MANSION` is a native cinematic World Cell derived from the three interlocking diamond outlines in `apps/viewer-web/public/tessaryn-mark.svg`.

## Open it

Run the web viewer, then open:

```text
/?object=tessaryn-logo-mansion-01
```

The object is also discoverable from the Object Weave by searching for `mansion`.

## Architectural construction

The renderer treats the mark as an inhabitable plan rather than a flat decal:

- the sage diamond becomes the western garden wing;
- the teal diamond becomes the eastern water wing;
- the terracotta diamond becomes the central memory atrium;
- sky bridges join the wings without collapsing their distinct identities;
- the central Chronofold stair, roof crowns, courtyards, pools, windows, and provenance currents remain procedural Three.js geometry.

The committed H.264 payload is used only as an internal material and light field. It never supplies geometry and no video surface is added to the document.

## Four-dimensional behavior

The descriptor exposes four Moments: `foundation`, `habitation`, `memory`, and `continuum`. The time scrubber moves the committed material state. Chronofold separates the three wings and reveals four architectural phase models while preserving one PHA identity and one Rootprint branch.

## Rebuild the media and object

Generate the 12-second deterministic material:

```bash
./scripts/render-logo-mansion-cinematic.sh /tmp/tessaryn-logo-mansion-material.mp4
```

Pack it with the repository CLI:

```bash
cargo run -p tessaryn-cli -- cinematic pack \
  --descriptor assets/cinematic/tessaryn-logo-mansion-01.json \
  --media /tmp/tessaryn-logo-mansion-material.mp4 \
  --output apps/viewer-web/public/objects/tessaryn-logo-mansion-01.tessaryn

gzip -n -9 -c apps/viewer-web/public/objects/tessaryn-logo-mansion-01.tessaryn \
  > apps/viewer-web/public/objects/tessaryn-logo-mansion-01.tessaryn.gz
```

Verify the result:

```bash
cargo run -p tessaryn-cli -- cinematic verify \
  apps/viewer-web/public/objects/tessaryn-logo-mansion-01.tessaryn
```

The public catalog transports the exact package as deterministic gzip (`.tessaryn.gz`). The viewer expands it before hashing and verification, so the published digest remains the digest of the uncompressed `.tessaryn` object.

The verified package is 32,004 bytes (6,114 bytes in deterministic gzip transport), commits one media chunk, contains 96 World Cells, and uses the existing `tessaryn/continuum-monument/v1` procedural profile with an object-specific mansion constructor selected by `object_id`.
