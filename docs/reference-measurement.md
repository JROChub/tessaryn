# Reference Measurement

Status: local reference measurement; informational, not a universal hardware
claim.

Date: 2026-07-11

Release: `0.3.0`

Artifacts:

- TartanAir V2 validation Origin SHA-256:
  `4f49cb034ac906fc6bea9232a7feeda7da623f1f337357bad5f20c3778cdf966`;
- Vesper Court protocol vector SHA-256:
  `4fa39e0e8c1753d223d4b99073c442197430e37bf21a565118e48af2b2bf2c6d`;
- minimal reconstruction vector SHA-256:
  `0e58283a8c79c1fe21177e92cb83cd0c99e35a6745033d848b08195f60d5fdae`;
- validation portfolio SHA-256:
  `c946db0d5f1e09d8c6a4ba51528e8c7d6b08face98f16b58ba1963a182fd5d0e`.

The 17,505,897-byte validation Origin contains 48 selected TartanAir V2
ArchViz Tiny House RGB-D frames, 212,565 verified surfels, 224,867 verified
SDF voxels, three canonical Moments, one alternate branch, and nine
proof-bound Cells. The source profile is explicitly
`synthetic_ground_truth`; its archive digests, selection windows, sensor
profile, exact depth, and pose declarations are identity-bearing.

Host: Intel Core i5-2500S, 4 cores, Linux 6.19.14 x86_64.

Browser harness: Chrome for Testing 149.0.7827.55 through Playwright 1.61.1.
The renderer reported `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device
(Subzero)), SwiftShader driver)`. These frame measurements describe the
adaptive software-renderer fallback, not a physical GPU.

## Desktop Production Build

Five fresh-browser runs at 1440 by 900 CSS pixels produced these medians:

- page navigation through local verification and materialization: 5.192
  seconds;
- first meaningful structure: 3.436 seconds;
- complete browser-local validation verification: 4.348 seconds;
- renderer materialization after verified observations were available: 522.0
  ms;
- live JavaScript heap after settling: 86.3 MB;
- constrained frame median: 100.0 ms;
- constrained frame p95 median: 233.4 ms;
- adaptive pixel ratio: 0.46;
- draw calls: 18;
- triangles: 12,492;
- browser-local verification: 9 of 9 Cells and PHA artifacts, Rootprint valid,
  replay valid, all Memory Capsules valid, zero reported errors.

## Mobile-Viewport Production Build

Five fresh-browser runs at 390 by 844 CSS pixels produced these medians:

- page navigation through local verification and materialization: 5.155
  seconds;
- first meaningful structure: 3.395 seconds;
- complete browser-local validation verification: 4.241 seconds;
- renderer materialization after verified observations were available: 496.1
  ms;
- live JavaScript heap after settling: 84.7 MB;
- constrained frame median: 50.1 ms;
- constrained frame p95 median: 183.3 ms;
- adaptive pixel ratio: 0.50;
- draw calls: 18;
- triangles: 9,948;
- verification errors and viewport overflow: zero.

Final 96-by-96-grid canvas sampling found 1,408 distinct colors and 36.1%
nonblack coverage on desktop, and 1,872 distinct colors and 41.3% nonblack
coverage in the portrait viewport. Production captures and the Playwright
interaction suite reported no page errors, console errors, or incoherent
viewport overflow.

## Native Offline Verifier

The optimized `target/release/tessaryn` binary was timed with Node's monotonic
clock around ten independent child processes:

- validation Origin verification median: 212.4 ms;
- validation Origin p95: 217.4 ms;
- minimal reconstruction verification median: 14.9 ms;
- minimal reconstruction p95: 18.7 ms.

Every measured process exited successfully. Browser and native measurements
used local files and no map, analytics, upload, or remote world service.
