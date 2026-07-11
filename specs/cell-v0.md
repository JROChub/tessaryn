# Cell v0

Schema: `tessaryn/cell/v0`

A Cell is an immutable manifest binding class, local space, time, channels,
parents, sources, transforms, policy, evidence declarations, and a chunk Merkle
root.

Identity rules:

- strict UTF-8 JSON;
- duplicate keys rejected;
- floating-point values rejected;
- integers must fit the declared Rust field and browser-safe fixture profile;
- object keys sorted by UTF-8 byte order;
- channels sorted by role then chunk root;
- parents and transform inputs sorted and deduplicated;
- temporal supersession IDs sorted and deduplicated;
- source and transform records sorted by their IDs;
- no implicit Unicode normalization;
- maximum manifest size: 1 MiB;
- Cell ID: `SHA-256("TESSARYN-CELL-v0\\0" || canonical_manifest)`.

Observation, derived, simulation, annotation, policy, and aggregate classes are
identity-bearing. Derived and aggregate Cells require at least one parent.
Semantic-only evidence requires the annotation class.

The temporal extent commits observation bounds, clock and uncertainty,
publication time, validity interval, superseded Cell IDs, and one of observed,
derived, predicted, or planned. Cell class and temporal authority must agree.
