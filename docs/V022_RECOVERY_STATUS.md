# v0.22 recovery status

The browser-side metric reconstruction experiment was removed after repeated mobile regressions. The World Cell Theater runtime is restored to the last responsive v0.21 baseline.

The authoritative v0.22 metric reconstruction implementation remains in `JROChub/keyxym_map`. Tessaryn will consume that runtime through a compiled C ABI/WebAssembly boundary rather than duplicating metric reconstruction logic in TypeScript.
