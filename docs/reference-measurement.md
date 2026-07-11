# Reference Measurement

Status: local reference measurement; informational, not a universal hardware claim.

Date: 2026-07-11

Release: `0.2.0`

Artifacts:

- real temporal Origin SHA-256:
  `84b2a773b742d0c46ff91ee1fabbabe09e33efa7f56d15af4cef6df19e44028a`;
- Vesper Court protocol vector SHA-256:
  `7bf4ce649d832c218544d640d5e9c5eae6bae3e3c4bfe2fb35cebf63c82ec4e2`;
- minimal reconstruction vector SHA-256:
  `133cad826a95cf6530ecbb1b404adffae60e28dbd619dab5657c401009f03697`.

The 13,019,318-byte real Origin contains 48 selected TUM Freiburg1 desk RGB-D
frames, 174,972 verified surfels, 131,808 verified SDF voxels, three canonical
Moments, one alternate branch, and nine proof-bound Cells.

Host: Intel Core i5-2500S, 4 cores, Linux 6.19.14 x86_64.

Browser harness: Chrome for Testing 149.0.7827.55 through Playwright 1.61.1.
The renderer reported `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device
(Subzero)), SwiftShader driver)`. These frame measurements therefore describe
the adaptive software-renderer fallback, not a physical GPU.

## Desktop Production Build

Five fresh-browser runs at 1440 by 900 CSS pixels produced these medians:

- application ready after fetch, strict parse, verification, and construction:
  3.582 seconds;
- first meaningful structure from navigation start: 2.610 seconds;
- complete browser-local temporal verification: 3.582 seconds;
- live JavaScript heap after settling: 65.2 MB;
- constrained frame median: 133.3 ms;
- constrained frame p95 median: 216.6 ms;
- adaptive pixel ratio: 0.46;
- draw calls: 18;
- triangles: 18,492;
- browser-local verification: 9 of 9 Cells and PHA artifacts, Rootprint valid,
  replay valid, all Memory Capsules valid, zero reported errors.

## Mobile-Viewport Production Build

Five fresh-browser runs at 390 by 844 CSS pixels produced these medians:

- application ready: 3.434 seconds;
- first meaningful structure: 2.615 seconds;
- complete browser-local temporal verification: 3.434 seconds;
- live JavaScript heap after settling: 80.2 MB;
- constrained frame median: 66.8 ms;
- constrained frame p95 median: 100.1 ms;
- adaptive pixel ratio: 0.50;
- draw calls: 18;
- triangles: 13,824;
- verification errors: zero.

Final 96-by-96-grid screenshot sampling found 1,530 distinct colors and 38.4%
nonblack canvas coverage on constrained desktop, 1,201 colors and 37.4%
coverage on forced-full desktop, and 2,346 colors and 46.8% coverage in the
portrait viewport. Full, constrained, Chronofold, desktop, and mobile captures
produced no viewport overflow, page errors, or console errors. Forced full
detail was visually checked under SwiftShader but is not reported as a
performance result because that profile is intended for hardware GPUs.

## Native Offline Verifier

The optimized `target/release/tessaryn` binary was timed with Node's monotonic
clock around ten independent child processes:

- real temporal Origin verification median: 178.4 ms;
- real temporal Origin p95: 186.8 ms;
- minimal reconstruction verification median: 15.7 ms;
- minimal reconstruction p95: 16.5 ms.

Every measured process exited successfully. Browser and native measurements
used local files and no map, analytics, upload, or remote world service.
