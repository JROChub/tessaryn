#include "keyxym/v22.hpp"
#include "keyxym/sha256.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>
#include <map>
#include <stdexcept>
#include <tuple>

namespace keyxym { namespace {

void u64(std::vector<Byte>& out, std::uint64_t value) {
    for (int shift = 56; shift >= 0; shift -= 8) out.push_back(Byte(value >> shift));
}

void f32(std::vector<Byte>& out, float value) {
    std::uint32_t bits{};
    std::memcpy(&bits, &value, sizeof(bits));
    for (int shift = 24; shift >= 0; shift -= 8) out.push_back(Byte(bits >> shift));
}

void text(std::vector<Byte>& out, const std::string& value) {
    u64(out, value.size());
    out.insert(out.end(), value.begin(), value.end());
}

void hash(std::vector<Byte>& out, const Hash256& value) {
    out.insert(out.end(), value.begin(), value.end());
}

float clamp01(float value) { return std::max(0.0F, std::min(1.0F, value)); }

RigidPose identity_pose() {
    RigidPose pose;
    pose.world_from_camera = {1, 0, 0, 0,
                              0, 1, 0, 0,
                              0, 0, 1, 0,
                              0, 0, 0, 1};
    return pose;
}

float median(std::vector<float> values) {
    if (values.empty()) return 0.0F;
    const auto middle = values.begin() + std::ptrdiff_t(values.size() / 2U);
    std::nth_element(values.begin(), middle, values.end());
    return *middle;
}

std::array<float, 3> transform(const RigidPose& pose, float x, float y, float z) {
    const auto& m = pose.world_from_camera;
    return {m[0] * x + m[1] * y + m[2] * z + m[3],
            m[4] * x + m[5] * y + m[6] * z + m[7],
            m[8] * x + m[9] * y + m[10] * z + m[11]};
}

Hash256 geometry_digest(const std::vector<MetricSurfel>& geometry) {
    std::vector<Byte> bytes;
    text(bytes, "keyxym/v22/metric-geometry");
    u64(bytes, geometry.size());
    for (const auto& item : geometry) {
        const auto& surfel = item.surfel;
        f32(bytes, surfel.x); f32(bytes, surfel.y); f32(bytes, surfel.z);
        f32(bytes, surfel.nx); f32(bytes, surfel.ny); f32(bytes, surfel.nz);
        f32(bytes, surfel.r); f32(bytes, surfel.g); f32(bytes, surfel.b);
        f32(bytes, surfel.confidence); f32(bytes, item.uncertainty);
        u64(bytes, item.observations); u64(bytes, item.first_seen_ns);
        u64(bytes, item.last_seen_ns); u64(bytes, item.source_keyframe);
    }
    return sha256(bytes);
}

Hash256 quality_digest(const MetricReconstructionQuality& quality) {
    std::vector<Byte> bytes;
    text(bytes, "keyxym/v22/quality");
    f32(bytes, quality.tracking_confidence);
    f32(bytes, quality.parallax_degrees);
    f32(bytes, quality.reprojection_error_pixels);
    f32(bytes, quality.coverage);
    u64(bytes, quality.confirmed); u64(bytes, quality.uncertain); u64(bytes, quality.rejected);
    bytes.push_back(quality.metric_scale ? Byte{1} : Byte{0});
    return sha256(bytes);
}

} // namespace

MetricPoseEstimate recover_metric_pose(const MetricFrame& reference,
                                       const MetricFrame& current,
                                       const RigidPose& prior) {
    MetricPoseEstimate result;
    result.pose = prior.world_from_camera[15] == 0.0F ? identity_pose() : prior;
    std::map<std::uint32_t, MetricFeatureObservation> references;
    for (const auto& feature : reference.features) references.emplace(feature.id, feature);

    std::vector<float> dx;
    std::vector<float> dy;
    std::vector<float> errors;
    for (const auto& feature : current.features) {
        const auto found = references.find(feature.id);
        if (found == references.end()) continue;
        if (!std::isfinite(feature.x) || !std::isfinite(feature.y) || !std::isfinite(feature.match_error)) continue;
        dx.push_back(feature.x - found->second.x);
        dy.push_back(feature.y - found->second.y);
        errors.push_back(std::max(0.0F, feature.match_error));
    }
    result.matches = dx.size();
    if (result.matches < 12U) return result;

    const float mx = median(dx);
    const float my = median(dy);
    std::vector<float> residuals;
    residuals.reserve(dx.size());
    for (std::size_t index = 0; index < dx.size(); ++index) {
        residuals.push_back(std::hypot(dx[index] - mx, dy[index] - my));
    }
    const float threshold = std::max(1.25F, median(residuals) * 2.5F);
    float error_sum = 0.0F;
    for (std::size_t index = 0; index < residuals.size(); ++index) {
        if (residuals[index] <= threshold) {
            ++result.inliers;
            error_sum += errors[index];
        }
    }
    if (result.inliers < 10U) return result;

    const auto& camera = current.camera;
    if (camera.intrinsics.fx <= 0.0F || camera.intrinsics.fy <= 0.0F) {
        throw std::invalid_argument("invalid metric camera intrinsics");
    }
    const float baseline_pixels = std::hypot(mx, my);
    const float unit = camera.scale_meters_per_unit / camera.intrinsics.fx;
    result.pose.world_from_camera[3] -= mx * unit;
    result.pose.world_from_camera[7] += my * unit;
    result.pose.world_from_camera[11] += std::min(0.03F, baseline_pixels * unit * 0.08F);
    result.parallax_degrees = std::atan2(baseline_pixels, camera.intrinsics.fx) * 57.2957795F;
    result.reprojection_error_pixels = error_sum / float(result.inliers);
    result.tracking_confidence = clamp01(float(result.inliers) /
        float(std::max<std::size_t>(40U, result.matches)));
    result.recovered = result.tracking_confidence >= 0.2F;

    std::vector<Byte> bytes;
    text(bytes, "keyxym/v22/metric-pose");
    for (const float value : result.pose.world_from_camera) f32(bytes, value);
    u64(bytes, result.matches); u64(bytes, result.inliers);
    f32(bytes, result.tracking_confidence); f32(bytes, result.parallax_degrees);
    f32(bytes, result.reprojection_error_pixels);
    hash(bytes, reference.source_commitment); hash(bytes, current.source_commitment);
    result.receipt = sha256(bytes);
    return result;
}

std::vector<MetricSurfel> triangulate_metric_surfels(const MetricFrame& reference,
                                                     const MetricFrame& current,
                                                     const MetricPoseEstimate& pose,
                                                     std::uint32_t keyframe,
                                                     std::uint64_t& rejected) {
    if (!pose.recovered) throw std::invalid_argument("metric pose not recovered");
    const auto& intrinsics = current.camera.intrinsics;
    if (intrinsics.fx <= 0.0F || intrinsics.fy <= 0.0F) throw std::invalid_argument("invalid intrinsics");
    std::map<std::uint32_t, MetricFeatureObservation> references;
    for (const auto& feature : reference.features) references.emplace(feature.id, feature);

    const float tx = pose.pose.world_from_camera[3];
    const float ty = pose.pose.world_from_camera[7];
    const float tz = pose.pose.world_from_camera[11];
    const float baseline = std::max(0.004F, std::sqrt(tx * tx + ty * ty + tz * tz));
    const auto timestamp = std::uint64_t(current.timestamp.time_since_epoch().count());
    std::vector<MetricSurfel> output;

    for (const auto& feature : current.features) {
        const auto found = references.find(feature.id);
        if (found == references.end()) continue;
        const float disparity = feature.disparity > 0.0F ? feature.disparity :
            std::hypot(feature.x - found->second.x, feature.y - found->second.y);
        if (!std::isfinite(disparity) || disparity < 0.55F || disparity > 96.0F || feature.match_error > 2.5F) {
            ++rejected;
            continue;
        }
        const float depth = std::max(0.08F, std::min(30.0F, intrinsics.fx * baseline / disparity));
        const auto world = transform(pose.pose,
            (feature.x - intrinsics.cx) * depth / intrinsics.fx,
            (feature.y - intrinsics.cy) * depth / intrinsics.fy,
            depth);
        MetricSurfel item;
        item.surfel.x = world[0]; item.surfel.y = world[1]; item.surfel.z = world[2];
        const float length = std::max(0.0001F,
            std::sqrt(world[0] * world[0] + world[1] * world[1] + world[2] * world[2]));
        item.surfel.nx = -world[0] / length; item.surfel.ny = -world[1] / length; item.surfel.nz = -world[2] / length;
        std::array<float, 3> color{0.75F, 0.75F, 0.75F};
        if (!current.rgb.empty()) {
            const auto x = std::min<std::uint32_t>(intrinsics.width - 1U,
                std::uint32_t(std::max(0.0F, feature.x)));
            const auto y = std::min<std::uint32_t>(intrinsics.height - 1U,
                std::uint32_t(std::max(0.0F, feature.y)));
            color = current.rgb[std::size_t(y) * intrinsics.width + x];
        }
        item.surfel.r = color[0]; item.surfel.g = color[1]; item.surfel.b = color[2];
        item.surfel.confidence = clamp01(pose.tracking_confidence *
            (1.0F - std::min(1.0F, feature.match_error / 3.0F)) * std::min(1.0F, disparity / 4.0F));
        item.surfel.timestamp_offset = timestamp;
        item.uncertainty = std::max(0.001F, std::min(1.0F,
            pose.reprojection_error_pixels / std::max(0.5F, disparity) + 1.0F / float(pose.inliers)));
        item.first_seen_ns = timestamp; item.last_seen_ns = timestamp; item.source_keyframe = keyframe;
        output.push_back(item);
    }
    return output;
}

void fuse_metric_surfels(std::vector<MetricSurfel>& accumulated,
                         const std::vector<MetricSurfel>& incoming,
                         float voxel_size_meters,
                         std::size_t maximum_surfels) {
    if (!(voxel_size_meters > 0.0F) || maximum_surfels == 0U) {
        throw std::invalid_argument("invalid metric fusion limits");
    }
    std::map<std::tuple<long long, long long, long long>, MetricSurfel> voxels;
    auto add = [&](const MetricSurfel& item) {
        const auto key = std::make_tuple(std::llround(item.surfel.x / voxel_size_meters),
                                         std::llround(item.surfel.y / voxel_size_meters),
                                         std::llround(item.surfel.z / voxel_size_meters));
        const auto inserted = voxels.emplace(key, item);
        if (inserted.second) return;
        auto& prior = inserted.first->second;
        const float wa = prior.surfel.confidence / std::max(0.001F, prior.uncertainty);
        const float wb = item.surfel.confidence / std::max(0.001F, item.uncertainty);
        const float total = std::max(0.001F, wa + wb);
        prior.surfel.x = (prior.surfel.x * wa + item.surfel.x * wb) / total;
        prior.surfel.y = (prior.surfel.y * wa + item.surfel.y * wb) / total;
        prior.surfel.z = (prior.surfel.z * wa + item.surfel.z * wb) / total;
        prior.surfel.r = (prior.surfel.r * wa + item.surfel.r * wb) / total;
        prior.surfel.g = (prior.surfel.g * wa + item.surfel.g * wb) / total;
        prior.surfel.b = (prior.surfel.b * wa + item.surfel.b * wb) / total;
        prior.surfel.confidence = clamp01(prior.surfel.confidence + item.surfel.confidence * 0.12F);
        prior.uncertainty = std::max(0.001F,
            std::min(prior.uncertainty, item.uncertainty) * 0.92F);
        ++prior.observations;
        prior.first_seen_ns = std::min(prior.first_seen_ns, item.first_seen_ns);
        prior.last_seen_ns = std::max(prior.last_seen_ns, item.last_seen_ns);
    };
    for (const auto& item : accumulated) add(item);
    for (const auto& item : incoming) add(item);
    if (voxels.size() > maximum_surfels) throw std::runtime_error("metric surfel limit exceeded");
    accumulated.clear();
    accumulated.reserve(voxels.size());
    for (const auto& entry : voxels) accumulated.push_back(entry.second);
}

MetricReconstructionQuality assess_metric_quality(const MetricPoseEstimate& pose,
                                                   const std::vector<MetricSurfel>& surfels,
                                                   std::uint64_t rejected,
                                                   bool metric_scale) {
    MetricReconstructionQuality quality;
    quality.tracking_confidence = pose.tracking_confidence;
    quality.parallax_degrees = pose.parallax_degrees;
    quality.reprojection_error_pixels = pose.reprojection_error_pixels;
    quality.rejected = rejected;
    quality.metric_scale = metric_scale;
    for (const auto& item : surfels) {
        if (item.observations >= 2U && item.surfel.confidence >= 0.55F && item.uncertainty <= 0.25F) ++quality.confirmed;
        else ++quality.uncertain;
    }
    quality.coverage = float(quality.confirmed) /
        float(std::max<std::uint64_t>(1U, quality.confirmed + quality.uncertain));
    quality.receipt = quality_digest(quality);
    return quality;
}

MetricWorldCellSession::MetricWorldCellSession(std::string branch,
                                               float voxel_size_meters,
                                               std::size_t maximum_surfels)
    : branch_(std::move(branch)),
      voxel_size_meters_(voxel_size_meters),
      maximum_surfels_(maximum_surfels),
      last_pose_(identity_pose()) {
    if (branch_.empty() || !(voxel_size_meters_ > 0.0F) || maximum_surfels_ == 0U) {
        throw std::invalid_argument("invalid metric session");
    }
}

MetricPoseEstimate MetricWorldCellSession::ingest(const MetricFrame& frame) {
    if (!has_reference_) {
        reference_ = frame;
        has_reference_ = true;
        MetricPoseEstimate origin;
        origin.pose = last_pose_; origin.recovered = true; origin.tracking_confidence = 1.0F;
        trajectory_.push_back(last_pose_);
        quality_ = assess_metric_quality(origin, geometry_, 0U, frame.camera.metric_scale);
        return origin;
    }
    auto estimate = recover_metric_pose(reference_, frame, last_pose_);
    if (!estimate.recovered) {
        quality_ = assess_metric_quality(estimate, geometry_, estimate.matches, frame.camera.metric_scale);
        return estimate;
    }
    std::uint64_t rejected{};
    const auto incoming = triangulate_metric_surfels(reference_, frame, estimate,
        std::uint32_t(trajectory_.size()), rejected);
    fuse_metric_surfels(geometry_, incoming, voxel_size_meters_, maximum_surfels_);
    last_pose_ = estimate.pose;
    trajectory_.push_back(last_pose_);
    quality_ = assess_metric_quality(estimate, geometry_, rejected, frame.camera.metric_scale);
    reference_ = frame;
    return estimate;
}

MetricMomentEvidence MetricWorldCellSession::commit_metric_moment(std::string id) {
    if (id.empty()) throw std::invalid_argument("metric moment id required");
    MetricMomentEvidence evidence;
    evidence.moment.id = std::move(id);
    evidence.moment.start_time = Timestamp(std::chrono::nanoseconds(
        geometry_.empty() ? 0U : geometry_.front().first_seen_ns));
    evidence.moment.end_time = Timestamp(std::chrono::nanoseconds(
        geometry_.empty() ? 0U : geometry_.back().last_seen_ns));
    for (const auto& item : geometry_) evidence.moment.surfels.push_back(item.surfel);
    evidence.moment.parent_moment = metric_moments_.empty() ? Hash256{} :
        metric_moments_.back().moment.rootprint;
    evidence.geometry_commitment = geometry_digest(geometry_);
    evidence.quality = quality_;
    std::vector<Byte> bytes;
    text(bytes, "keyxym/v22/metric-moment-evidence");
    hash(bytes, evidence.geometry_commitment); hash(bytes, evidence.quality.receipt);
    hash(bytes, evidence.moment.parent_moment);
    evidence.evidence_receipt = sha256(bytes);
    evidence.moment.evidence = evidence.evidence_receipt;
    evidence.moment.rootprint = compute_formal_moment_rootprint(evidence.moment);
    evidence.pose.pose = last_pose_;
    evidence.pose.recovered = true;
    evidence.pose.tracking_confidence = quality_.tracking_confidence;
    evidence.pose.parallax_degrees = quality_.parallax_degrees;
    evidence.pose.reprojection_error_pixels = quality_.reprojection_error_pixels;
    metric_moments_.push_back(evidence);
    return evidence;
}

FormalWorldCell MetricWorldCellSession::build_world_cell(Hash256 pha,
                                                         Hash256 memory_capsule,
                                                         Hash256 parent_rootprint) const {
    FormalWorldCell cell;
    cell.branch = branch_;
    for (const auto& item : geometry_) cell.base_geometry.push_back(item.surfel);
    for (const auto& evidence : metric_moments_) cell.moments.push_back(evidence.moment);
    cell.pha = pha;
    cell.memory_capsule = memory_capsule;
    cell.parent_rootprint = parent_rootprint;
    return cell;
}

const std::vector<MetricSurfel>& MetricWorldCellSession::metric_geometry() const noexcept { return geometry_; }
const MetricReconstructionQuality& MetricWorldCellSession::quality() const noexcept { return quality_; }
const std::vector<RigidPose>& MetricWorldCellSession::trajectory() const noexcept { return trajectory_; }

} // namespace keyxym
