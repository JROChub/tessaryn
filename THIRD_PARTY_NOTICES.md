# Third-Party Notices

## TartanAir V2: `ArchVizTinyHouseDay/Data_easy/P000`

TESSARYN `0.3.0` includes a derived validation Locus generated from the
TartanAir V2 `ArchVizTinyHouseDay` environment and `P000` easy trajectory.

- Project: <https://tartanair.org/>
- Dataset repository: <https://huggingface.co/datasets/theairlabcmu/tartanair2>
- RGB archive SHA-256: `9bea5fca9d0cf50105c7d34583d4d5db06e3715ef708262b4dfad763d34b17da`
- Depth archive SHA-256: `83e6e680297af35aa83d594ea3ed254bf71e9d9da7b26fee6d0ccb29f25ac104`
- License: [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/)
- Citation: W. Wang, Y. Hu, Y. Qiu, S. Shen, and Y. Shaoul, TartanAir V2
  Dataset, Carnegie Mellon University, 2023.

The repository does not redistribute the source RGB or depth PNG archives. The
bundled artifact contains deterministic surfel and sparse-SDF derivatives,
source profile and selection records, Power House bindings, Rootprint lineage,
and local verification reports. TartanAir is synthetic simulator data. The
artifact declares `synthetic_ground_truth` and is not represented as a physical
sensor capture.

## Depth Anything V2 Small

The browser video-Locus path includes the Q4 ONNX conversion of Depth Anything
V2 Small and executes it locally through Transformers.js and ONNX Runtime Web.

- Model: <https://huggingface.co/onnx-community/depth-anything-v2-small>
- Pinned revision: `413ce838e669ab7dfc01a6a396bf3d4397286d7f`
- Q4 model SHA-256: `5d55b02762e1907589158af3e366bd61ddf648155852a07bbf5e3a074639fcf8`
- Model license: Apache License 2.0
- Transformers.js license: Apache License 2.0
- ONNX Runtime license: MIT

The model files and runtime are served from the TESSARYN origin. Remote model
loading is disabled in application code. Inference does not upload source
frames. Depth Anything V2 produces relative monocular depth; TESSARYN records
that profile explicitly and does not relabel it as calibrated metric depth.

## Optional Real-Sensor Adapters

TESSARYN contains local layout-inspection adapters for EuRoC MAV, KITTI raw,
and ScanNet v2. Their source data is not redistributed. Operators are
responsible for obtaining those datasets and following their respective terms:

- EuRoC MAV: <https://projects.asl.ethz.ch/datasets/euroc-mav/>
- KITTI: <https://www.cvlibs.net/datasets/kitti/>
- ScanNet: <https://www.scan-net.org/>
