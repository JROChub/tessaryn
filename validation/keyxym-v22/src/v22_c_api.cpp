#include "keyxym/v22_c_api.h"
#include "keyxym/v22.hpp"

#include <algorithm>
#include <chrono>
#include <cstring>
#include <exception>
#include <memory>
#include <new>
#include <string>
#include <vector>

struct keyxym_v22_session {
    explicit keyxym_v22_session(std::string branch,
                                float voxel_size_meters,
                                std::size_t maximum_surfels)
        : runtime(std::move(branch), voxel_size_meters, maximum_surfels) {}

    keyxym::MetricWorldCellSession runtime;
};

namespace {

void copy_hash(const keyxym::Hash256& source, std::uint8_t destination[32]) {
    std::copy(source.begin(), source.end(), destination);
}

keyxym::MetricFrame convert_frame(const keyxym_v22_frame& input) {
    if (input.width == 0 || input.height == 0 || input.fx <= 0.0F || input.fy <= 0.0F) {
        throw std::invalid_argument("invalid camera model");
    }
    const std::size_t pixels = static_cast<std::size_t>(input.width) * input.height;
    if (input.rgb_triplet_count != pixels || (pixels != 0 && input.rgb == nullptr)) {
        throw std::invalid_argument("rgb triplet count does not match frame dimensions");
    }
    if (input.feature_count != 0 && input.features == nullptr) {
        throw std::invalid_argument("missing feature array");
    }
    if (input.source_commitment_size != 0 && input.source_commitment_size != 32) {
        throw std::invalid_argument("source commitment must contain 32 bytes");
    }
    if (input.source_commitment_size == 32 && input.source_commitment == nullptr) {
        throw std::invalid_argument("missing source commitment bytes");
    }

    keyxym::MetricFrame frame;
    frame.timestamp = keyxym::Timestamp(std::chrono::nanoseconds(input.timestamp_ns));
    frame.camera.intrinsics.width = input.width;
    frame.camera.intrinsics.height = input.height;
    frame.camera.intrinsics.fx = input.fx;
    frame.camera.intrinsics.fy = input.fy;
    frame.camera.intrinsics.cx = input.cx;
    frame.camera.intrinsics.cy = input.cy;
    frame.camera.scale_meters_per_unit = input.scale_meters_per_unit;
    frame.camera.metric_scale = input.metric_scale != 0;

    frame.rgb.reserve(pixels);
    for (std::size_t index = 0; index < pixels; ++index) {
        const std::size_t offset = index * 3;
        frame.rgb.push_back({input.rgb[offset], input.rgb[offset + 1], input.rgb[offset + 2]});
    }

    frame.features.reserve(input.feature_count);
    for (std::size_t index = 0; index < input.feature_count; ++index) {
        const auto& source = input.features[index];
        frame.features.push_back({source.id,
                                  source.x,
                                  source.y,
                                  source.score,
                                  source.disparity,
                                  source.match_error});
    }
    if (input.source_commitment_size == 32) {
        std::copy(input.source_commitment,
                  input.source_commitment + input.source_commitment_size,
                  frame.source_commitment.begin());
    }
    return frame;
}

void copy_pose(const keyxym::MetricPoseEstimate& source, keyxym_v22_pose& destination) {
    std::copy(source.pose.world_from_camera.begin(),
              source.pose.world_from_camera.end(),
              destination.world_from_camera);
    destination.matches = source.matches;
    destination.inliers = source.inliers;
    destination.tracking_confidence = source.tracking_confidence;
    destination.parallax_degrees = source.parallax_degrees;
    destination.reprojection_error_pixels = source.reprojection_error_pixels;
    destination.recovered = source.recovered ? 1U : 0U;
    copy_hash(source.receipt, destination.receipt);
}

void copy_surfel(const keyxym::MetricSurfel& source, keyxym_v22_surfel& destination) {
    destination.x = source.surfel.x;
    destination.y = source.surfel.y;
    destination.z = source.surfel.z;
    destination.nx = source.surfel.nx;
    destination.ny = source.surfel.ny;
    destination.nz = source.surfel.nz;
    destination.r = source.surfel.r;
    destination.g = source.surfel.g;
    destination.b = source.surfel.b;
    destination.confidence = source.surfel.confidence;
    destination.uncertainty = source.uncertainty;
    destination.observations = source.observations;
    destination.first_seen_ns = source.first_seen_ns;
    destination.last_seen_ns = source.last_seen_ns;
    destination.source_keyframe = source.source_keyframe;
}

int map_exception() noexcept {
    try {
        throw;
    } catch (const std::invalid_argument&) {
        return KEYXYM_V22_INVALID_ARGUMENT;
    } catch (...) {
        return KEYXYM_V22_RUNTIME_ERROR;
    }
}

} // namespace

extern "C" {

int keyxym_v22_session_create(const char* branch,
                              float voxel_size_meters,
                              size_t maximum_surfels,
                              keyxym_v22_session** out_session) {
    if (branch == nullptr || out_session == nullptr || voxel_size_meters <= 0.0F || maximum_surfels == 0) {
        return KEYXYM_V22_INVALID_ARGUMENT;
    }
    *out_session = nullptr;
    try {
        std::unique_ptr<keyxym_v22_session> session(
            new keyxym_v22_session(branch, voxel_size_meters, maximum_surfels));
        *out_session = session.release();
        return KEYXYM_V22_OK;
    } catch (...) {
        return map_exception();
    }
}

void keyxym_v22_session_destroy(keyxym_v22_session* session) {
    delete session;
}

int keyxym_v22_session_ingest(keyxym_v22_session* session,
                              const keyxym_v22_frame* frame,
                              keyxym_v22_pose* out_pose) {
    if (session == nullptr || frame == nullptr || out_pose == nullptr) {
        return KEYXYM_V22_INVALID_ARGUMENT;
    }
    try {
        const auto estimate = session->runtime.ingest(convert_frame(*frame));
        copy_pose(estimate, *out_pose);
        return KEYXYM_V22_OK;
    } catch (...) {
        return map_exception();
    }
}

size_t keyxym_v22_session_geometry_count(const keyxym_v22_session* session) {
    return session == nullptr ? 0U : session->runtime.metric_geometry().size();
}

int keyxym_v22_session_copy_geometry(const keyxym_v22_session* session,
                                     keyxym_v22_surfel* output,
                                     size_t capacity,
                                     size_t* required) {
    if (session == nullptr || required == nullptr) {
        return KEYXYM_V22_INVALID_ARGUMENT;
    }
    const auto& geometry = session->runtime.metric_geometry();
    *required = geometry.size();
    if (capacity < geometry.size()) {
        return KEYXYM_V22_BUFFER_TOO_SMALL;
    }
    if (!geometry.empty() && output == nullptr) {
        return KEYXYM_V22_INVALID_ARGUMENT;
    }
    for (std::size_t index = 0; index < geometry.size(); ++index) {
        copy_surfel(geometry[index], output[index]);
    }
    return KEYXYM_V22_OK;
}

int keyxym_v22_session_quality(const keyxym_v22_session* session,
                               keyxym_v22_quality* output) {
    if (session == nullptr || output == nullptr) {
        return KEYXYM_V22_INVALID_ARGUMENT;
    }
    const auto& quality = session->runtime.quality();
    output->tracking_confidence = quality.tracking_confidence;
    output->parallax_degrees = quality.parallax_degrees;
    output->reprojection_error_pixels = quality.reprojection_error_pixels;
    output->coverage = quality.coverage;
    output->confirmed = quality.confirmed;
    output->uncertain = quality.uncertain;
    output->rejected = quality.rejected;
    output->metric_scale = quality.metric_scale ? 1U : 0U;
    copy_hash(quality.receipt, output->receipt);
    return KEYXYM_V22_OK;
}

int keyxym_v22_session_ingest_packed(
    keyxym_v22_session* session,
    int64_t timestamp_ns,
    uint32_t width,
    uint32_t height,
    float fx,
    float fy,
    float cx,
    float cy,
    float scale_meters_per_unit,
    uint8_t metric_scale,
    const float* rgb,
    size_t rgb_triplet_count,
    const float* feature_records,
    size_t feature_count,
    const uint8_t* source_commitment,
    size_t source_commitment_size,
    float* pose_output,
    size_t pose_output_count) {
    if (session == nullptr || pose_output == nullptr ||
        pose_output_count < KEYXYM_V22_PACKED_POSE_FLOATS ||
        (feature_count != 0 && feature_records == nullptr)) {
        return KEYXYM_V22_INVALID_ARGUMENT;
    }
    try {
        std::vector<keyxym_v22_feature> features(feature_count);
        for (std::size_t index = 0; index < feature_count; ++index) {
            const float* record = feature_records + index * KEYXYM_V22_PACKED_FEATURE_FLOATS;
            features[index] = {static_cast<std::uint32_t>(record[0]),
                               record[1], record[2], record[3], record[4], record[5]};
        }
        keyxym_v22_frame frame{};
        frame.timestamp_ns = timestamp_ns;
        frame.width = width;
        frame.height = height;
        frame.fx = fx;
        frame.fy = fy;
        frame.cx = cx;
        frame.cy = cy;
        frame.scale_meters_per_unit = scale_meters_per_unit;
        frame.metric_scale = metric_scale;
        frame.rgb = rgb;
        frame.rgb_triplet_count = rgb_triplet_count;
        frame.features = features.data();
        frame.feature_count = features.size();
        frame.source_commitment = source_commitment;
        frame.source_commitment_size = source_commitment_size;

        const auto estimate = session->runtime.ingest(convert_frame(frame));
        std::copy(estimate.pose.world_from_camera.begin(),
                  estimate.pose.world_from_camera.end(), pose_output);
        pose_output[16] = static_cast<float>(estimate.matches);
        pose_output[17] = static_cast<float>(estimate.inliers);
        pose_output[18] = estimate.tracking_confidence;
        pose_output[19] = estimate.parallax_degrees;
        pose_output[20] = estimate.reprojection_error_pixels;
        pose_output[21] = estimate.recovered ? 1.0F : 0.0F;
        return KEYXYM_V22_OK;
    } catch (...) {
        return map_exception();
    }
}

int keyxym_v22_session_copy_geometry_packed(
    const keyxym_v22_session* session,
    float* output,
    size_t output_float_capacity,
    size_t* required_float_count) {
    if (session == nullptr || required_float_count == nullptr) {
        return KEYXYM_V22_INVALID_ARGUMENT;
    }
    const auto& geometry = session->runtime.metric_geometry();
    *required_float_count = geometry.size() * KEYXYM_V22_PACKED_SURFEL_FLOATS;
    if (output_float_capacity < *required_float_count) {
        return KEYXYM_V22_BUFFER_TOO_SMALL;
    }
    if (*required_float_count != 0 && output == nullptr) {
        return KEYXYM_V22_INVALID_ARGUMENT;
    }
    for (std::size_t index = 0; index < geometry.size(); ++index) {
        const auto& source = geometry[index];
        float* record = output + index * KEYXYM_V22_PACKED_SURFEL_FLOATS;
        record[0] = source.surfel.x;
        record[1] = source.surfel.y;
        record[2] = source.surfel.z;
        record[3] = source.surfel.nx;
        record[4] = source.surfel.ny;
        record[5] = source.surfel.nz;
        record[6] = source.surfel.r;
        record[7] = source.surfel.g;
        record[8] = source.surfel.b;
        record[9] = source.surfel.confidence;
        record[10] = source.uncertainty;
        record[11] = static_cast<float>(source.observations);
        record[12] = static_cast<float>(source.source_keyframe);
    }
    return KEYXYM_V22_OK;
}

int keyxym_v22_session_quality_packed(
    const keyxym_v22_session* session,
    float* output,
    size_t output_float_count) {
    if (session == nullptr || output == nullptr ||
        output_float_count < KEYXYM_V22_PACKED_QUALITY_FLOATS) {
        return KEYXYM_V22_INVALID_ARGUMENT;
    }
    const auto& quality = session->runtime.quality();
    output[0] = quality.tracking_confidence;
    output[1] = quality.parallax_degrees;
    output[2] = quality.reprojection_error_pixels;
    output[3] = quality.coverage;
    output[4] = static_cast<float>(quality.confirmed);
    output[5] = static_cast<float>(quality.uncertain);
    output[6] = static_cast<float>(quality.rejected);
    output[7] = quality.metric_scale ? 1.0F : 0.0F;
    return KEYXYM_V22_OK;
}

const char* keyxym_v22_status_message(int status) {
    switch (status) {
        case KEYXYM_V22_OK: return "ok";
        case KEYXYM_V22_INVALID_ARGUMENT: return "invalid argument";
        case KEYXYM_V22_BUFFER_TOO_SMALL: return "buffer too small";
        case KEYXYM_V22_RUNTIME_ERROR: return "runtime error";
        default: return "unknown status";
    }
}

} // extern "C"
