# Keyxym v0.22 integration

The Theater currently uses the restored responsive v0.21 visual preview runtime.

The next metric integration must consume the compiled `keyxym_map` v0.22 runtime through its C ABI or WebAssembly build. Tessaryn will not independently implement authoritative pose recovery, metric triangulation, uncertainty fusion, or formal World Cell construction in TypeScript.

The browser responsibilities are limited to camera acquisition, sensor permissions, UI, rendering, replay, WebRTC transport, and canonical verification of runtime-produced objects.
