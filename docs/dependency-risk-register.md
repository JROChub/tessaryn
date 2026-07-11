# Dependency Risk Register

The release gate runs `cargo deny check` and fails on unapproved licenses,
wildcard dependencies, unknown sources, yanked releases, and new RustSec
advisories. The following inherited Arkworks 0.4 advisories are explicit,
reviewable exceptions as of 2026-07-10.

## RUSTSEC-2024-0388

`derivative 2.2.0` is unmaintained. It is transitively required by Arkworks 0.4.
The advisory identifies no vulnerability and offers no safe compatible upgrade.
TESSARYN does not call it directly.

## RUSTSEC-2024-0436

`paste 1.0.15` is unmaintained. It is transitively required by Arkworks 0.4.
The advisory identifies no vulnerability and offers no safe compatible upgrade.
TESSARYN does not call it directly.

## RUSTSEC-2025-0055

Remediated in `0.1.0`. The published Arkworks 0.4 crate constrains
`tracing-subscriber` to the vulnerable 0.2 line. TESSARYN carries a minimal,
licensed compatibility backport in `vendor/ark-relations`: it updates the
dependency to 0.3 and renames the empty `Layer::new_span` hook to
`Layer::on_new_span`. It also scopes a current-compiler lint allowance to one
unchanged upstream no-op. No proof or constraint behavior changes. The RustSec
exception was removed, and byte-identical conformance remains mandatory.

## Removal Gate

The unmaintained-crate exceptions must be removed when Power House migrates from
the Arkworks 0.4 dependency graph. Any new
advisory remains release-blocking until separately analyzed and recorded. This
record is risk acceptance, not a claim that an unmaintained dependency is ideal.
