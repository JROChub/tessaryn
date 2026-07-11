use serde::{Deserialize, Serialize};
use tessaryn_schema::{
    DatasetAssetV1, DatasetGroundTruthV1, DatasetProfileV1, DatasetSensorProfileV1,
    DatasetSourceClass, Digest, DATASET_PROFILE_SCHEMA_V1,
};

pub const TARTANAIR_DATASET_ID: &str = "tartanair-v2/archviz-tiny-house-day/easy/p000";
pub const TARTANAIR_DATASET: &str = "TartanAir V2";
pub const TARTANAIR_RELEASE: &str = "v2-2023";
pub const TARTANAIR_ENVIRONMENT: &str = "ArchVizTinyHouseDay";
pub const TARTANAIR_SEQUENCE: &str = "Data_easy/P000/lcam_front";
pub const TARTANAIR_HOME: &str = "https://tartanair.org/";
pub const TARTANAIR_LICENSE: &str = "CC-BY-4.0";
pub const TARTANAIR_CITATION: &str = "W. Wang, Y. Hu, Y. Qiu, S. Shen, and Y. Shaoul, TartanAir V2 Dataset, Carnegie Mellon University, 2023";
pub const TARTANAIR_RGB_URL: &str = "https://huggingface.co/datasets/theairlabcmu/tartanair2/resolve/0d2d145e973832742a2aaa04b7d2ebffc8d82817/ArchVizTinyHouseDay/Data_easy/image_lcam_front.zip";
pub const TARTANAIR_DEPTH_URL: &str = "https://huggingface.co/datasets/theairlabcmu/tartanair2/resolve/0d2d145e973832742a2aaa04b7d2ebffc8d82817/ArchVizTinyHouseDay/Data_easy/depth_lcam_front.zip";
pub const TARTANAIR_RGB_SHA256: &str =
    "sha256:9bea5fca9d0cf50105c7d34583d4d5db06e3715ef708262b4dfad763d34b17da";
pub const TARTANAIR_DEPTH_SHA256: &str =
    "sha256:83e6e680297af35aa83d594ea3ed254bf71e9d9da7b26fee6d0ccb29f25ac104";
pub const TARTANAIR_RGB_BYTES: u64 = 517_844_269;
pub const TARTANAIR_DEPTH_BYTES: u64 = 186_046_186;

pub fn tartanair_profile() -> DatasetProfileV1 {
    let profile = DatasetProfileV1 {
        schema: DATASET_PROFILE_SCHEMA_V1.to_string(),
        id: TARTANAIR_DATASET_ID.to_string(),
        dataset: TARTANAIR_DATASET.to_string(),
        release: TARTANAIR_RELEASE.to_string(),
        environment: TARTANAIR_ENVIRONMENT.to_string(),
        sequence: TARTANAIR_SEQUENCE.to_string(),
        source_class: DatasetSourceClass::SyntheticGroundTruth,
        homepage: TARTANAIR_HOME.to_string(),
        license: TARTANAIR_LICENSE.to_string(),
        citation: TARTANAIR_CITATION.to_string(),
        modalities: vec![
            "camera_pose".to_string(),
            "metric_depth".to_string(),
            "rgb".to_string(),
        ],
        sensor: DatasetSensorProfileV1 {
            width: 640,
            height: 640,
            sample_rate_millihz: 10_000,
            fx_q20: 320 << 20,
            fy_q20: 320 << 20,
            cx_q20: 320 << 20,
            cy_q20: 320 << 20,
            coordinate_frame: "ned/opencv-camera".to_string(),
        },
        ground_truth: DatasetGroundTruthV1 {
            metric_depth: true,
            camera_pose: true,
            semantics: false,
            optical_flow: false,
            reference: "simulator-exact".to_string(),
        },
        assets: vec![
            DatasetAssetV1 {
                role: "depth".to_string(),
                url: TARTANAIR_DEPTH_URL.to_string(),
                sha256: Digest::new(TARTANAIR_DEPTH_SHA256).expect("fixed digest is valid"),
                bytes: TARTANAIR_DEPTH_BYTES,
            },
            DatasetAssetV1 {
                role: "rgb".to_string(),
                url: TARTANAIR_RGB_URL.to_string(),
                sha256: Digest::new(TARTANAIR_RGB_SHA256).expect("fixed digest is valid"),
                bytes: TARTANAIR_RGB_BYTES,
            },
        ],
    };
    profile.validate().expect("built-in profile is canonical");
    profile
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ValidationPortfolioV1 {
    pub schema: String,
    pub entries: Vec<ValidationPortfolioEntryV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ValidationPortfolioEntryV1 {
    pub id: String,
    pub layer: String,
    pub source_class: DatasetSourceClass,
    pub release_year: u16,
    pub modalities: Vec<String>,
    pub adapter: String,
    pub state: String,
    pub evidence_scope: String,
    pub homepage: String,
    pub usage: String,
}

pub fn validation_portfolio() -> ValidationPortfolioV1 {
    ValidationPortfolioV1 {
        schema: "tessaryn/validation-portfolio/v1".to_string(),
        entries: vec![
            ValidationPortfolioEntryV1 {
                id: TARTANAIR_DATASET_ID.to_string(),
                layer: "showcase_and_exact_ground_truth".to_string(),
                source_class: DatasetSourceClass::SyntheticGroundTruth,
                release_year: 2023,
                modalities: vec![
                    "camera_pose".to_string(),
                    "metric_depth".to_string(),
                    "rgb".to_string(),
                ],
                adapter: "tartanair-v2-rgbd-v1".to_string(),
                state: "release".to_string(),
                evidence_scope:
                    "photorealistic RGB-D reconstruction with exact simulator depth and pose"
                        .to_string(),
                homepage: TARTANAIR_HOME.to_string(),
                usage: "public_origin".to_string(),
            },
            ValidationPortfolioEntryV1 {
                id: "euroc-mav/v1".to_string(),
                layer: "real_sensor_stress".to_string(),
                source_class: DatasetSourceClass::RealSensor,
                release_year: 2016,
                modalities: vec![
                    "ground_truth_pose".to_string(),
                    "imu".to_string(),
                    "stereo".to_string(),
                ],
                adapter: "euroc-stereo-imu-layout-v1".to_string(),
                state: "adapter".to_string(),
                evidence_scope:
                    "stereo and visual-inertial synchronization, calibration, and trajectory stress"
                        .to_string(),
                homepage: "https://projects.asl.ethz.ch/datasets/euroc-mav/".to_string(),
                usage: "local_noncommercial_evaluation".to_string(),
            },
            ValidationPortfolioEntryV1 {
                id: "kitti/raw".to_string(),
                layer: "real_sensor_stress".to_string(),
                source_class: DatasetSourceClass::RealSensor,
                release_year: 2012,
                modalities: vec![
                    "lidar".to_string(),
                    "oxts".to_string(),
                    "stereo".to_string(),
                ],
                adapter: "kitti-stereo-lidar-layout-v1".to_string(),
                state: "adapter".to_string(),
                evidence_scope: "outdoor stereo, LiDAR, and vehicle-motion synchronization stress"
                    .to_string(),
                homepage: "https://www.cvlibs.net/datasets/kitti/".to_string(),
                usage: "local_noncommercial_evaluation".to_string(),
            },
            ValidationPortfolioEntryV1 {
                id: "scannet/v2".to_string(),
                layer: "real_sensor_indoor".to_string(),
                source_class: DatasetSourceClass::RealSensor,
                release_year: 2017,
                modalities: vec![
                    "camera_pose".to_string(),
                    "metric_depth".to_string(),
                    "rgb".to_string(),
                ],
                adapter: "scannet-rgbd-layout-v1".to_string(),
                state: "adapter".to_string(),
                evidence_scope: "indoor RGB-D reconstruction under physical sensor noise"
                    .to_string(),
                homepage: "https://www.scan-net.org/".to_string(),
                usage: "terms_gated_local_evaluation".to_string(),
            },
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn portfolio_never_blurs_synthetic_and_real_sources() {
        let portfolio = validation_portfolio();
        assert_eq!(portfolio.entries.len(), 4);
        assert_eq!(
            portfolio.entries[0].source_class,
            DatasetSourceClass::SyntheticGroundTruth
        );
        assert!(portfolio.entries[1..]
            .iter()
            .all(|entry| entry.source_class == DatasetSourceClass::RealSensor));
        assert_eq!(tartanair_profile().assets.len(), 2);
    }
}
