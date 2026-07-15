#include "keyxym/v26.hpp"

#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstdint>

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
} // namespace

int main() {
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

    const float angle = 5.0F * 3.14159265358979323846F / 180.0F;
    const float cosine = std::cos(angle);
    const float sine = std::sin(angle);
    std::uint32_t id = 1U;
    for (int grid_y = -4; grid_y <= 4; ++grid_y) {
        for (int grid_x = -6; grid_x <= 6; ++grid_x) {
            const float x = float(grid_x) * 0.12F;
            const float y = float(grid_y) * 0.10F;
            const float z = 2.0F + float((grid_x + grid_y + 20) % 5) * 0.25F;
            reference.features.push_back(project(id, x, y, z, reference.camera.intrinsics));
            const float current_x = cosine * x + sine * z + 0.12F;
            const float current_y = y + 0.01F;
            const float current_z = -sine * x + cosine * z + 0.02F;
            auto observation = project(id, current_x, current_y, current_z,
                                       current.camera.intrinsics);
            observation.disparity = std::hypot(
                observation.x - reference.features.back().x,
                observation.y - reference.features.back().y);
            current.features.push_back(observation);
            ++id;
        }
    }

    for (std::uint32_t outlier = 0; outlier < 12U; ++outlier) {
        current.features[outlier].x += 35.0F + float(outlier);
        current.features[outlier].y -= 24.0F;
        current.features[outlier].match_error = 3.5F;
    }

    const auto pose = keyxym::recover_reality_pose(reference, current);
    assert(pose.recovered);
    assert(!pose.degenerate);
    assert(pose.matches >= 90U);
    assert(pose.inliers >= 55U);
    assert(pose.rotation_degrees > 2.0F && pose.rotation_degrees < 8.0F);
    assert(pose.translation_observability > 0.005F);
    assert(pose.reprojection_error_pixels < 3.0F);
    assert(std::any_of(pose.receipt.begin(), pose.receipt.end(),
                       [](std::uint8_t value) { return value != 0U; }));

    std::uint64_t rejected = 0U;
    const auto geometry = keyxym::triangulate_reality_surfels(
        reference, {}, current, pose, 0U, rejected);
    assert(geometry.size() >= 50U);
    assert(rejected >= 10U);

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
