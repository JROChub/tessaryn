#pragma once

#include "v22.hpp"

#include <array>
#include <cstddef>
#include <cstdint>
#include <string>
#include <utility>
#include <vector>

namespace keyxym {

inline constexpr std::uint32_t reality_reconstruction_version = 26;

enum class RealityAuthorityStage : std::uint32_t {
    Forming = 0,
    Tracking = 1,
    MomentReady = 2,
    SealReady = 3,
};

enum RealityRejection : std::uint32_t {
    RealityRejectNone = 0,
    RealityRejectPose = 1U << 0U,
    RealityRejectTracking = 1U << 1U,
    RealityRejectParallax = 1U << 2U,
    RealityRejectReprojection = 1U << 3U,
    RealityRejectGeometry = 1U << 4U,
    RealityRejectContinuity = 1U << 5U,
    RealityRejectReceipt = 1U << 6U,
    RealityRejectDegenerate = 1U << 7U,
    RealityRejectScale = 1U << 8U,
};

struct RealityThresholds {
    float moment_tracking{0.45F};
    float seal_tracking{0.55F};
    float moment_parallax_degrees{0.60F};
    float seal_parallax_degrees{1.00F};
    float maximum_reprojection_error_pixels{3.00F};
    std::uint64_t moment_confirmed_surfels{32};
    std::uint64_t seal_confirmed_surfels{256};
    std::uint32_t moment_continuity_frames{2};
    std::uint32_t seal_continuity_frames{5};
};

struct RealityPoseEstimate {
    RigidPose pose;
    std::size_t matches{};
    std::size_t inliers{};
    float tracking_confidence{};
    float parallax_degrees{};
    float reprojection_error_pixels{};
    float rotation_degrees{};
    float translation_observability{};
    bool recovered{false};
    bool degenerate{true};
    bool relocalized{false};
    Hash256 receipt{};
};

struct RealityAuthorityDecision {
    RealityAuthorityStage stage{RealityAuthorityStage::Forming};
    std::uint32_t rejection_mask{RealityRejectPose};
    float score{};
    std::uint64_t confirmed_surfels{};
    std::uint32_t continuity_frames{};
    bool moment_allowed{false};
    bool seal_allowed{false};
    bool metric_scale{false};
    Hash256 receipt{};
};

struct RealityFrameResult {
    RealityPoseEstimate pose;
    MetricReconstructionQuality quality;
    RealityAuthorityDecision authority;
    std::uint64_t geometry_revision{};
    std::uint32_t keyframe_index{};
};

RealityPoseEstimate recover_reality_pose(const MetricFrame& reference,
                                         const MetricFrame& current,
                                         const RigidPose& world_from_reference = {});

std::vector<MetricSurfel> triangulate_reality_surfels(
    const MetricFrame& reference,
    const RigidPose& world_from_reference,
    const MetricFrame& current,
    const RealityPoseEstimate& pose,
    std::uint32_t keyframe,
    std::uint64_t& rejected);

RealityAuthorityDecision decide_reality_authority(
    const RealityPoseEstimate& pose,
    const MetricReconstructionQuality& quality,
    std::uint32_t continuity_frames,
    bool receipts_valid,
    const RealityThresholds& thresholds = {});

class RealityWorldCellSession {
public:
    explicit RealityWorldCellSession(std::string branch,
                                     float voxel_size_meters = 0.02F,
                                     std::size_t maximum_surfels = 5'000'000,
                                     RealityThresholds thresholds = {});

    RealityFrameResult ingest(const MetricFrame& frame);
    FormalMoment commit_reality_moment(std::string id);
    FormalWorldCell build_world_cell(Hash256 pha,
                                     Hash256 memory_capsule,
                                     Hash256 parent_rootprint = {}) const;

    const std::vector<MetricSurfel>& geometry() const noexcept;
    const std::vector<RigidPose>& trajectory() const noexcept;
    const MetricReconstructionQuality& quality() const noexcept;
    const RealityPoseEstimate& pose() const noexcept;
    const RealityAuthorityDecision& authority() const noexcept;
    std::uint64_t geometry_revision() const noexcept;
    std::uint32_t keyframe_index() const noexcept;

private:
    std::string branch_;
    float voxel_size_meters_;
    std::size_t maximum_surfels_;
    RealityThresholds thresholds_;
    bool has_keyframe_{false};
    bool has_previous_{false};
    MetricFrame keyframe_;
    MetricFrame previous_;
    RigidPose keyframe_pose_{};
    RigidPose previous_pose_{};
    std::uint32_t keyframe_index_{};
    std::uint32_t frame_index_{};
    std::uint32_t continuity_frames_{};
    std::uint32_t lost_frames_{};
    std::uint64_t geometry_revision_{};
    std::vector<MetricSurfel> geometry_;
    std::vector<RigidPose> trajectory_;
    std::vector<FormalMoment> moments_;
    MetricReconstructionQuality quality_{};
    RealityPoseEstimate pose_{};
    RealityAuthorityDecision authority_{};
};

} // namespace keyxym
