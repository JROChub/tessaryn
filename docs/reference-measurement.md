# Reference Measurement

Status: local reference measurement; informational, not a software-release gate.

Date: 2026-07-10

Release: `0.1.1`

Reference Origin SHA-256:
`d88c0520f8d91d9c1884d1593e0dcde6e9c1da0a070115a63f42e395d7b90237`

Reconstruction vector SHA-256:
`7fa6c59ba414e8789d7039fe357aecaf30545f859f0e49f5f9792cfec3db6278`

Fixture: Vesper Court deterministic reference Origin, 18 Cells, 3 Moments, 2
dispute Cells, 1 restricted Cell.

Host: Intel Core i5-2500S, 4 cores, Linux 6.19.14 x86_64.

Browser harness: Chromium 149.0.7827.55 headless through Playwright 1.61.1 at
1440 by 900 CSS pixels. The renderer reported `ANGLE (Google, Vulkan 1.3.0
(SwiftShader Device (Subzero)), SwiftShader driver)`; therefore this run is a
software-renderer diagnostic and is not a physical-GPU performance claim.

Five clean production-build runs produced these medians:

- first structural Cell: 603 ms after scene construction began;
- all reference Cells materialized: 1.98 seconds;
- browser-local verification complete: 756 ms;
- steady software-renderer frame median: 83.4 ms;
- steady software-renderer frame p95 median: 266.6 ms;
- draw calls after materialization: 40;
- triangles after materialization: 14,754;
- browser-local verification: 18 of 18 Cells, 18 of 18 PHA artifacts,
  Rootprint valid, replay valid, Memory Capsule valid.

The optimized CLI verified the 38 KiB reconstruction conformance artifact ten
times with a 0.02 second median. It generated and packaged the bounded 18-surfel,
90-voxel vector five times with a 0.02 second median.
