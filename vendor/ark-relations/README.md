# ark-relations 0.4 compatibility backport

This directory contains `ark-relations` 0.4.0 from crates.io, whose published
crate checksum is:

```text
00796b6efc05a3f48225e59cb6a2cda78881e7c390872d5786aaf112f31fb4f0
```

The upstream source and dual MIT/Apache-2.0 licenses are preserved. TESSARYN
applies only these compatibility changes:

1. require `tracing-subscriber` 0.3 instead of the vulnerable 0.2 line;
2. rename the `Layer::new_span` implementation to the 0.3 API name
   `Layer::on_new_span` without changing its empty body;
3. allow the upstream `dropping_references` lint at its existing no-op line so
   current compilers can build the unchanged behavior under warnings-as-errors.

No field, constraint-system, serialization, proof, or arithmetic behavior is
modified. Cross-platform conformance requires all TESSARYN and Power House
artifacts to remain byte-identical after this backport.
