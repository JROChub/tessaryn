#include "keyxym/v26.hpp"
#include "keyxym/sha256.hpp"
#include "v26_internal.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <stdexcept>
#include <utility>

namespace keyxym {
namespace {
float clamp01(float value) { return std::max(0.0F, std::min(1.0F, value)); }
bool nonzero(const Hash256& digest) { return std::any_of(digest.begin(), digest.end(), [](Byte value) { return value != 0U; }); }
void append_u64(std::vector<Byte>& output, std::uint64_t value) { for (int shift = 56; shift >= 0; shift -= 8) output.push_back(Byte(value >> shift)); }
void append_f32(std::vector<Byte>& output, float value) { std::uint32_t bits{}; std::memcpy(&bits, &value, sizeof(bits)); for (int shift = 24; shift >= 0; shift -= 8) output.push_back(Byte(bits >> shift)); }
void append_text(std::vector<Byte>& output, const char* value) { const std::size_t size = std::strlen(value); append_u64(output, size); output.insert(output.end(), value, value + size); }
void append_hash(std::vector<Byte>& output, const Hash256& value) { output.insert(output.end(), value.begin(), value.end()); }
Hash256 decision_receipt(const RealityAuthorityDecision& decision, const RealityPoseEstimate& pose, const MetricReconstructionQuality& quality) {
    std::vector<Byte> bytes;
    append_text(bytes, "keyxym/v26/authority-decision");
    append_u64(bytes, static_cast<std::uint32_t>(decision.stage));
    append_u64(bytes, decision.rejection_mask);
    append_f32(bytes, decision.score);
    append_u64(bytes, decision.confirmed_surfels);
    append_u64(bytes, decision.continuity_frames);
    bytes.push_back(decision.moment_allowed ? Byte{1} : Byte{0});
    bytes.push_back(decision.seal_allowed ? Byte{1} : Byte{0});
    bytes.push_back(decision.metric_scale ? Byte{1} : Byte{0});
    append_hash(bytes, pose.receipt);
    append_hash(bytes, quality.receipt);
    return sha256(bytes);
}
} // namespace

RealityAuthorityDecision decide_reality_authority(
    const RealityPoseEstimate& pose,
    const MetricReconstructionQuality& quality,
    std::uint32_t continuity_frames,
    bool receipts_valid,
    const RealityThresholds& thresholds) {
    RealityAuthorityDecision decision;
    decision.confirmed_surfels = quality.confirmed;
    decision.continuity_frames = continuity_frames;
    decision.metric_scale = quality.metric_scale;
    decision.rejection_mask = RealityRejectNone;
    if (!pose.recovered) decision.rejection_mask |= RealityRejectPose;
    if (pose.degenerate) decision.rejection_mask |= RealityRejectDegenerate;
    if (quality.tracking_confidence < thresholds.moment_tracking) decision.rejection_mask |= RealityRejectTracking;
    if (quality.parallax_degrees < thresholds.moment_parallax_degrees) decision.rejection_mask |= RealityRejectParallax;
    if (!std::isfinite(quality.reprojection_error_pixels) ||
        quality.reprojection_error_pixels > thresholds.maximum_reprojection_error_pixels) {
        decision.rejection_mask |= RealityRejectReprojection;
    }
    if (quality.confirmed < thresholds.moment_confirmed_surfels) decision.rejection_mask |= RealityRejectGeometry;
    if (continuity_frames < thresholds.moment_continuity_frames) decision.rejection_mask |= RealityRejectContinuity;
    if (!receipts_valid) decision.rejection_mask |= RealityRejectReceipt;

    const bool common = pose.recovered && !pose.degenerate && receipts_valid &&
        std::isfinite(quality.reprojection_error_pixels) &&
        quality.reprojection_error_pixels <= thresholds.maximum_reprojection_error_pixels;
    decision.moment_allowed = common &&
        quality.tracking_confidence >= thresholds.moment_tracking &&
        quality.parallax_degrees >= thresholds.moment_parallax_degrees &&
        quality.confirmed >= thresholds.moment_confirmed_surfels &&
        continuity_frames >= thresholds.moment_continuity_frames;
    decision.seal_allowed = common &&
        quality.tracking_confidence >= thresholds.seal_tracking &&
        quality.parallax_degrees >= thresholds.seal_parallax_degrees &&
        quality.confirmed >= thresholds.seal_confirmed_surfels &&
        continuity_frames >= thresholds.seal_continuity_frames;

    if (decision.seal_allowed) {
        decision.stage = RealityAuthorityStage::SealReady;
        decision.rejection_mask = RealityRejectNone;
    } else if (decision.moment_allowed) {
        decision.stage = RealityAuthorityStage::MomentReady;
    } else if (pose.recovered && !pose.degenerate) {
        decision.stage = RealityAuthorityStage::Tracking;
    }
    const float tracking_score = clamp01(quality.tracking_confidence / thresholds.seal_tracking);
    const float parallax_score = clamp01(quality.parallax_degrees / thresholds.seal_parallax_degrees);
    const float geometry_score = clamp01(float(quality.confirmed) /
        float(std::max<std::uint64_t>(1U, thresholds.seal_confirmed_surfels)));
    const float continuity_score = clamp01(float(continuity_frames) /
        float(std::max<std::uint32_t>(1U, thresholds.seal_continuity_frames)));
    const float error_score = clamp01(1.0F - quality.reprojection_error_pixels /
        std::max(0.001F, thresholds.maximum_reprojection_error_pixels));
    decision.score = 0.30F * tracking_score + 0.20F * parallax_score +
        0.25F * geometry_score + 0.15F * continuity_score + 0.10F * error_score;
    decision.receipt = decision_receipt(decision, pose, quality);
    return decision;
}

RealityWorldCellSession::RealityWorldCellSession(std::string branch,
                                                 float voxel_size_meters,
                                                 std::size_t maximum_surfels,
                                                 RealityThresholds thresholds)
    : branch_(std::move(branch)),
      voxel_size_meters_(voxel_size_meters),
      maximum_surfels_(maximum_surfels),
      thresholds_(thresholds) {
    if (branch_.empty() || !(voxel_size_meters_ > 0.0F) || maximum_surfels_ == 0U) {
        throw std::invalid_argument("invalid reality reconstruction session");
    }
}

RealityFrameResult RealityWorldCellSession::ingest(const MetricFrame& frame) {
    ++frame_index_;
    if (!has_keyframe_) {
        has_keyframe_ = true;
        has_previous_ = true;
        keyframe_ = frame;
        previous_ = frame;
        keyframe_pose_ = {};
        previous_pose_ = {};
        keyframe_index_ = frame_index_ - 1U;
        pose_ = {};
        pose_.pose = {};
        pose_.recovered = true;
        pose_.degenerate = true;
        pose_.tracking_confidence = 1.0F;
        pose_.receipt = v26_detail::pose_receipt(pose_, frame, frame);
        trajectory_.push_back(pose_.pose);
        quality_ = v26_detail::assess_quality(pose_, geometry_, 0U, frame.camera.metric_scale);
        authority_ = decide_reality_authority(pose_, quality_, 0U,
            nonzero(pose_.receipt) && nonzero(quality_.receipt), thresholds_);
        return {pose_, quality_, authority_, geometry_revision_, keyframe_index_};
    }

    RealityPoseEstimate estimate = recover_reality_pose(keyframe_, frame, keyframe_pose_);
    const MetricFrame* triangulation_reference = &keyframe_;
    const RigidPose* triangulation_pose = &keyframe_pose_;
    if (!estimate.recovered && has_previous_) {
        RealityPoseEstimate recovered = recover_reality_pose(previous_, frame, previous_pose_);
        if (recovered.recovered) {
            recovered.relocalized = true;
            recovered.receipt = v26_detail::pose_receipt(recovered, previous_, frame);
            estimate = recovered;
            triangulation_reference = &previous_;
            triangulation_pose = &previous_pose_;
        }
    }

    std::uint64_t rejected = 0U;
    if (estimate.recovered) {
        const auto incoming = triangulate_reality_surfels(
            *triangulation_reference, *triangulation_pose, frame, estimate,
            keyframe_index_, rejected);
        const std::size_t previous_size = geometry_.size();
        v26_detail::fuse(geometry_, incoming, voxel_size_meters_, maximum_surfels_);
        if (!incoming.empty() || geometry_.size() != previous_size) ++geometry_revision_;
        ++continuity_frames_;
        lost_frames_ = 0U;
        previous_ = frame;
        previous_pose_ = estimate.pose;
        has_previous_ = true;
        trajectory_.push_back(estimate.pose);
        const bool promote = estimate.parallax_degrees >= 1.5F ||
            frame_index_ - keyframe_index_ >= 12U;
        if (promote) {
            keyframe_ = frame;
            keyframe_pose_ = estimate.pose;
            keyframe_index_ = frame_index_ - 1U;
        }
    } else {
        continuity_frames_ = 0U;
        ++lost_frames_;
        rejected = estimate.matches;
    }

    pose_ = estimate;
    quality_ = v26_detail::assess_quality(pose_, geometry_, rejected, frame.camera.metric_scale);
    authority_ = decide_reality_authority(pose_, quality_, continuity_frames_,
        nonzero(pose_.receipt) && nonzero(quality_.receipt), thresholds_);
    return {pose_, quality_, authority_, geometry_revision_, keyframe_index_};
}

FormalMoment RealityWorldCellSession::commit_reality_moment(std::string id) {
    if (!authority_.moment_allowed) throw std::runtime_error("reality authority does not permit a Moment");
    if (id.empty()) throw std::invalid_argument("reality Moment id required");
    const auto confirmed = v26_detail::confirmed_geometry(geometry_);
    FormalMoment moment;
    moment.id = std::move(id);
    moment.start_time = Timestamp(std::chrono::nanoseconds(
        confirmed.empty() ? 0U : confirmed.front().first_seen_ns));
    moment.end_time = Timestamp(std::chrono::nanoseconds(
        confirmed.empty() ? 0U : confirmed.back().last_seen_ns));
    for (const auto& item : confirmed) moment.surfels.push_back(item.surfel);
    moment.parent_moment = moments_.empty() ? Hash256{} : moments_.back().rootprint;
    moment.evidence = authority_.receipt;
    moment.rootprint = compute_formal_moment_rootprint(moment);
    moments_.push_back(moment);
    return moment;
}

FormalWorldCell RealityWorldCellSession::build_world_cell(Hash256 pha,
                                                          Hash256 memory_capsule,
                                                          Hash256 parent_rootprint) const {
    FormalWorldCell cell;
    cell.branch = branch_;
    for (const auto& item : v26_detail::confirmed_geometry(geometry_)) cell.base_geometry.push_back(item.surfel);
    cell.moments = moments_;
    cell.pha = pha;
    cell.memory_capsule = memory_capsule;
    cell.parent_rootprint = parent_rootprint;
    return cell;
}

const std::vector<MetricSurfel>& RealityWorldCellSession::geometry() const noexcept { return geometry_; }
const std::vector<RigidPose>& RealityWorldCellSession::trajectory() const noexcept { return trajectory_; }
const MetricReconstructionQuality& RealityWorldCellSession::quality() const noexcept { return quality_; }
const RealityPoseEstimate& RealityWorldCellSession::pose() const noexcept { return pose_; }
const RealityAuthorityDecision& RealityWorldCellSession::authority() const noexcept { return authority_; }
std::uint64_t RealityWorldCellSession::geometry_revision() const noexcept { return geometry_revision_; }
std::uint32_t RealityWorldCellSession::keyframe_index() const noexcept { return keyframe_index_; }

} // namespace keyxym
