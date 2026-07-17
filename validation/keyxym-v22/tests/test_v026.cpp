#include "keyxym/v26.hpp"

#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstdint>
#include <cstdio>

namespace {
keyxym::MetricFeatureObservation project(std::uint32_t id,
                                         float x,
                                         float y,
                                         float z,
                                         const keyxym::CameraIntrinsics& camera) {
    return {id,
            camera.fx * x / z + camera.cx,
            camera.fy * y / z + camera.cy,
            1.0F,
            0.0F,
            0.15F};
}

std::pair<keyxym::MetricFrame, keyxym::MetricFrame> make_scene(float angle_degrees,
                                                               float translation_x,
                                                               float translation_y,
                                                               float translation_z) {
    keyxym::MetricFrame reference;
    keyxym::MetricFrame current;
    reference.camera.intrinsics = {640, 480, 520, 520, 320, 240, 0.001F};
    current.camera = reference.camera;
    reference.timestamp = keyxym::Timestamp(std::chrono::nanoseconds(1'000'000));
    current.timestamp = keyxym::Timestamp(std::chrono::nanoseconds(2'000'000));
    reference.source_commitment[0] = 1U;
    current.source_commitment[0] = 2U;
    reference.rgb.resize(640U * 480U, {0.4F, 0.6F, 0.8F});
    current.rgb = reference.rgb;
    const float angle = angle_degrees * 3.14159265358979323846F / 180.0F;
    const float cosine = std::cos(angle);
    const float sine = std::sin(angle);
    std::uint32_t id = 1U;
    for (int grid_y = -4; grid_y <= 4; ++grid_y) {
        for (int grid_x = -6; grid_x <= 6; ++grid_x) {
            const float x = float(grid_x) * 0.12F;
            const float y = float(grid_y) * 0.10F;
            const float z = 2.0F + float((grid_x + grid_y + 20) % 5) * 0.25F;
            reference.features.push_back(project(id, x, y, z, reference.camera.intrinsics));
            const float current_x = cosine * x + sine * z + translation_x;
            const float current_y = y + translation_y;
            const float current_z = -sine * x + cosine * z + translation_z;
            auto observation = project(id, current_x, current_y, current_z,
                                       current.camera.intrinsics);
            observation.disparity = std::hypot(
                observation.x - reference.features.back().x,
                observation.y - reference.features.back().y);
            current.features.push_back(observation);
            ++id;
        }
    }
    return {std::move(reference), std::move(current)};
}

bool nonzero(const keyxym::Hash256& digest) {
    return std::any_of(digest.begin(), digest.end(),
                       [](std::uint8_t value) { return value != 0U; });
}

void report(const char* label, const keyxym::RealityPoseEstimate& pose) {
    std::fprintf(stderr,
                 "%s recovered=%d degenerate=%d matches=%zu inliers=%zu rotation=%.6f parallax=%.6f residual=%.6f observability=%.6f confidence=%.6f\n",
                 label,
                 pose.recovered ? 1 : 0,
                 pose.degenerate ? 1 : 0,
                 pose.matches,
                 pose.inliers,
                 pose.rotation_degrees,
                 pose.parallax_degrees,
                 pose.reprojection_error_pixels,
                 pose.translation_observability,
                 pose.tracking_confidence);
}
} // namespace

int main() {
    keyxym::MetricFrame empty_reference;
    keyxym::MetricFrame empty_current;
    empty_reference.camera.intrinsics = {640, 480, 520, 520, 320, 240, 0.001F};
    empty_current.camera = empty_reference.camera;
    empty_reference.source_commitment[0] = 9U;
    empty_current.source_commitment[0] = 10U;
    const auto empty_pose = keyxym::recover_reality_pose(empty_reference, empty_current);
    assert(!empty_pose.recovered);
    assert(nonzero(empty_pose.receipt));
    assert(empty_pose.receipt == keyxym::recover_reality_pose(empty_reference, empty_current).receipt);

    auto [reference, current] = make_scene(5.0F, 0.12F, 0.01F, 0.02F);
    for (std::uint32_t outlier = 0; outlier < 12U; ++outlier) {
        current.features[outlier].x += 35.0F + float(outlier);
        current.features[outlier].y -= 24.0F;
        current.features[outlier].match_error = 3.5F;
    }
    const auto pose = keyxym::recover_reality_pose(reference, current);
    report("mixed", pose);
    assert(pose.recovered);
    assert(!pose.degenerate);
    assert(pose.matches >= 90U);
    assert(pose.inliers >= 55U);
    assert(pose.rotation_degrees > 2.0F && pose.rotation_degrees < 8.0F);
    assert(pose.translation_observability > 0.005F);
    assert(pose.reprojection_error_pixels < 3.0F);
    assert(nonzero(pose.receipt));
    std::uint64_t rejected = 0U;
    const auto geometry = keyxym::triangulate_reality_surfels(
        reference, {}, current, pose, 0U, rejected);
    assert(geometry.size() >= 50U);
    assert(rejected >= 10U);

    auto [translation_reference, translation_current] = make_scene(0.0F, 0.12F, 0.01F, 0.0F);
    const auto translation_pose = keyxym::recover_reality_pose(
        translation_reference, translation_current);
    report("translation", translation_pose);
    assert(translation_pose.recovered);
    assert(!translation_pose.degenerate);
    assert(translation_pose.inliers >= 80U);
    assert(translation_pose.rotation_degrees < 1.0F);
    assert(translation_pose.parallax_degrees > 0.08F);
    assert(nonzero(translation_pose.receipt));
    std::uint64_t translation_rejected = 0U;
    const auto translation_geometry = keyxym::triangulate_reality_surfels(
        translation_reference, {}, translation_current, translation_pose, 0U,
        translation_rejected);
    assert(translation_geometry.size() >= 70U);

    auto [rotation_reference, rotation_current] = make_scene(5.0F, 0.0F, 0.0F, 0.0F);
    const auto rotation_only = keyxym::recover_reality_pose(rotation_reference, rotation_current);
    report("rotation-only", rotation_only);
    assert(!rotation_only.recovered);
    assert(nonzero(rotation_only.receipt));

    auto [low_reference, low_current] = make_scene(0.0F, 0.0001F, 0.0F, 0.0F);
    const auto low_parallax = keyxym::recover_reality_pose(low_reference, low_current);
    report("low-parallax", low_parallax);
    assert(!low_parallax.recovered);
    assert(nonzero(low_parallax.receipt));

    auto [outlier_reference, outlier_current] = make_scene(0.0F, 0.12F, 0.0F, 0.0F);
    for (std::size_t index = 0; index < outlier_current.features.size(); ++index) {
        if (index % 4U != 0U) {
            outlier_current.features[index].x += 80.0F + float(index % 17U);
            outlier_current.features[index].y -= 55.0F;
            outlier_current.features[index].match_error = 3.8F;
        }
    }
    const auto outlier_pose = keyxym::recover_reality_pose(outlier_reference, outlier_current);
    report("outlier-heavy", outlier_pose);
    assert(!outlier_pose.recovered);
    assert(nonzero(outlier_pose.receipt));

    keyxym::MetricReconstructionQuality quality;
    quality.tracking_confidence = 0.70F;
    quality.parallax_degrees = 1.5F;
    quality.reprojection_error_pixels = 1.0F;
    quality.confirmed = 300U;
    quality.receipt[0] = 1U;
    const auto decision = keyxym::decide_reality_authority(pose, quality, 6U, true);
    assert(decision.moment_allowed);
    assert(decision.seal_allowed);
    assert(decision.stage == keyxym::RealityAuthorityStage::SealReady);
    assert(decision.rejection_mask == keyxym::RealityRejectNone);
    quality.confirmed = 10U;
    const auto blocked = keyxym::decide_reality_authority(pose, quality, 6U, true);
    assert(!blocked.moment_allowed);
    assert(!blocked.seal_allowed);
    assert((blocked.rejection_mask & keyxym::RealityRejectGeometry) != 0U);
    return 0;
}
