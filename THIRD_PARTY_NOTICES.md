# Third-Party Notices

## TartanAir V2: `ArchVizTinyHouseDay/Data_easy/P000`

TESSARYN `0.5.0` retains the `0.3.0` derived validation Locus generated from the
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

## Optional Real-Sensor Adapters

TESSARYN contains local layout-inspection adapters for EuRoC MAV, KITTI raw,
and ScanNet v2. Their source data is not redistributed. Operators are
responsible for obtaining those datasets and following their respective terms:

- EuRoC MAV: <https://projects.asl.ethz.ch/datasets/euroc-mav/>
- KITTI: <https://www.cvlibs.net/datasets/kitti/>
- ScanNet: <https://www.scan-net.org/>
