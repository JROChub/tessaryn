# Public Object Catalog v1

`tessaryn/public-object-catalog/v1` is the read-only discovery index for public
Tessaryn objects. It provides names and locations; it is never an authority for
object validity.

Each entry contains:

- stable `object_id`;
- display title and SLBIT-derived summary;
- same-origin artifact path;
- expected Cell ID and Rootprint root branch;
- media, dimension, and Moment discovery metadata.

The browser must fetch the artifact and independently verify its binary header,
manifest digest, geometry descriptor, media chunks, Cell identity, PHA,
Rootprint, replay, and Memory Capsule. A catalog match cannot make a failed
artifact valid.

Public URLs use `?object=<object-id>`. Search operates locally over the catalog.
The service worker caches a successfully opened same-origin artifact for later
offline replay.

Publication is explicit. A local file selected with `OPEN` remains local unless
the same committed artifact and catalog entry are included in a public release.
This prevents accidental disclosure while giving every released object a stable
public address.
