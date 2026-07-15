#pragma once

#include "v21.hpp"

#include <array>
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace keyxym {

struct MetricFeatureObservation {
    std::uint32_t id{};
    float x{};
    float y{};
    float score{};
    float disparity{};
    float match_error{};
};

struct MetricCameraModel {
    CameraIntrinsics intrinsics;
    float scale_meters_per_unit{1.0F};
    bool metric_scale{false};
};

struct MetricPoseEstimate {
    RigidPose pose;
    std::size_t matches{};
    std::size_t inliers{};
    float tracking_confidence{};
    float parallax_degrees{};
    float reprojection_error_pixels{};
    bool recovered{false};
    Hash256 receipt{};
};

struct MetricSurfel {
    Surfel surfel;
    float uncertainty{1.0F};
    std::uint32_t observations{1};
    std::uint64_t first_seen_ns{};
    std::uint64_t last_seen_ns{};
    std::uint32_t source_keyframe{};
};

struct MetricReconstructionQuality {
    float tracking_confidence{};
    float parallax_degrees{};
    float reprojection_error_pixels{};
    float coverage{};
    std::uint64_t confirmed{};
    std::uint64_t uncertain{};
    std::uint64_t rejected{};
    bool metric_scale{false};
    Hash256 receipt{};
};

struct MetricFrame {
    Timestamp timestamp{};
    MetricCameraModel camera;
    std::vector<std::array<float, 3>> rgb;
    std::vector<MetricFeatureObservation> features;
    Hash256 source_commitment{};
};

struct MetricMomentEvidence {
    FormalMoment moment;
    MetricPoseEstimate pose;
    MetricReconstructionQuality quality;
    Hash256 geometry_commitment{};
    Hash256 evidence_receipt{};
};

MetricPoseEstimate recover_metric_pose(const MetricFrame& reference,
                                       const MetricFrame& current,
                                       const RigidPose& prior = {});

std::vector<MetricSurfel> triangulate_metric_surfels(const MetricFrame& reference,
                                                     const MetricFrame& current,
                                                     const MetricPoseEstimate& pose,
                                                     std::uint32_t keyframe,
                                                     std::uint64_t& rejected);

void fuse_metric_surfels(std::vector<MetricSurfel>& accumulated,
                         const std::vector<MetricSurfel>& incoming,
                         float voxel_size_meters = 0.02F,
                         std::size_t maximum_surfels = 5'000'000);

MetricReconstructionQuality assess_metric_quality(const MetricPoseEstimate& pose,
                                                   const std::vector<MetricSurfel>& surfels,
                                                   std::uint64_t rejected,
                                                   bool metric_scale);

class MetricWorldCellSession {
public:
    explicit MetricWorldCellSession(std::string branch,
                                    float voxel_size_meters = 0.02F,
                                    std::size_t maximum_surfels = 5'000'000);

    MetricPoseEstimate ingest(const MetricFrame& frame);
    MetricMomentEvidence commit_metric_moment(std::string id);
    FormalWorldCell build_world_cell(Hash256 pha,
                                     Hash256 memory_capsule,
                                     Hash256 parent_rootprint = {}) const;

    const std::vector<MetricSurfel>& metric_geometry() const noexcept;
    const MetricReconstructionQuality& quality() const noexcept;
    const std::vector<RigidPose>& trajectory() const noexcept;

private:
    std::string branch_;
    float voxel_size_meters_;
    std::size_t maximum_surfels_;
    bool has_reference_{false};
    MetricFrame reference_;
    RigidPose last_pose_{};
    std::vector<MetricSurfel> geometry_;
    std::vector<RigidPose> trajectory_;
    std::vector<MetricMomentEvidence> metric_moments_;
    MetricReconstructionQuality quality_{};
};

} // namespace keyxym
