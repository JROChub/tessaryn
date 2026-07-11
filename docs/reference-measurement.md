# Reference Measurement

Status: measured locally, not independently reproduced.

Date: 2026-07-10

Release: `0.1.0-rc.1`

Reference Origin SHA-256:
`81da7f1661a9c67aefe5e8ac1a0ec1e7e2b2473bc30d0ee584cb4e6b954b0427`

Reconstruction vector SHA-256:
`f7e8a0a7773586f64b1152dad10e83635fd028d67fb743bf7bcaacfd20be66a4`

Fixture: Vesper Court deterministic reference Origin, 18 Cells, 3 Moments, 2
dispute Cells, 1 restricted Cell.

Host: Intel Core i5-2500S, 4 cores, Linux 6.19.14 x86_64.

Browser harness: Chromium 149.0.7827.55 headless through Playwright 1.58.2 at
1440 by 900 CSS pixels. The renderer reported `ANGLE (Google, Vulkan 1.3.0
(SwiftShader Device (Subzero)), SwiftShader driver)`; therefore this run is a
software-renderer diagnostic and is not a physical-GPU performance claim.

Five clean production-build runs produced these medians:

- first structural Cell: 686 ms after viewer boot began;
- all reference Cells materialized: 2.56 seconds;
- browser-local verification complete: 1.87 seconds;
- draw calls after materialization: 86 before aggregate-field optimization;
- triangles after materialization: 5,428 before aggregate-field optimization;
- browser-local verification: 18 of 18 Cells, 18 of 18 PHA artifacts,
  Rootprint valid, replay valid, Memory Capsule valid;
- physical truth: not claimed.

The optimized CLI verified the 38 KiB reconstruction conformance artifact ten
times with a 0.02 second median. It generated and packaged the bounded 18-surfel,
90-voxel vector five times with a 0.02 second median. These values describe the
small conformance vector, not a real-site throughput claim.

The 60 FPS desktop target remains unmeasured on reference GPU hardware. A
hardware run must record exact CPU, GPU, browser, operating system, resolution,
build commit, and fixture digest before that target can be marked measured.
