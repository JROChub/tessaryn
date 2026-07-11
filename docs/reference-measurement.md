# Reference Measurement

Status: measured locally, not independently reproduced.

Date: 2026-07-10

Fixture: Vesper Court `experimental-synthetic`, 18 Cells, 3 Moments, 2 dispute
Cells, 1 restricted Cell.

Browser harness: Chromium 148 headless through Playwright on Linux. The renderer
reported `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))`; therefore
frame pacing from this run is a software-renderer diagnostic and is not a GPU
performance claim.

Observed in the initial room Lens at 1440 by 900 CSS pixels:

- first structural Cell: approximately 0.67 seconds after world construction began;
- all synthetic Cells condensed: approximately 2.72 seconds;
- draw calls after materialization: 86 before aggregate-field optimization;
- triangles after materialization: 5,428 before aggregate-field optimization;
- browser-local verification: 18 of 18 Cells, 18 of 18 PHA artifacts,
  Rootprint valid, replay valid, Memory Capsule valid;
- physical truth: not claimed.

The 60 FPS desktop target remains unmeasured on reference GPU hardware. A
hardware run must record exact CPU, GPU, browser, operating system, resolution,
build commit, and fixture digest before that target can be marked measured.
