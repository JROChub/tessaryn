# Contributing

TESSARYN is evidence-gated research. A visually persuasive prototype is not a
protocol result.

Every contribution must:

1. identify whether it changes core identity, derivation, policy, or presentation;
2. include deterministic tests for identity-bearing behavior;
3. include a mutation or rejection test for a new trust boundary;
4. preserve unknown space, branch disagreement, and semantic/core separation;
5. avoid map SDKs, basemaps, tile services, panorama services, remote scripts,
   hidden telemetry, and provider-owned world models;
6. record hardware, build, dataset, and method for every performance claim;
7. label capabilities according to `STATUS.md`.

Run all commands listed in the README before opening a pull request. New
frontier work also requires a Speculation Record in `experiments/`.
