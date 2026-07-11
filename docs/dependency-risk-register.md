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

`tracing-subscriber 0.2.25` can emit unescaped ANSI control sequences when an
application logs attacker-controlled text through an initialized subscriber.
It enters the graph through the Arkworks 0.4 `std` feature. Neither Power House
nor TESSARYN initializes or calls `tracing-subscriber`, so the affected logging
path is not reachable in this release. Disabling the feature also disables the
parallel Groth16 path and is therefore not an equivalent remediation.

## Removal Gate

These exceptions must be removed when Power House migrates from the Arkworks 0.4
dependency graph or an upstream-compatible release eliminates them. Any new
advisory remains release-blocking until separately analyzed and recorded. This
record is risk acceptance, not a claim that an unmaintained dependency is ideal.
