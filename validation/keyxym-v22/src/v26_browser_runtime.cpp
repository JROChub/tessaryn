#include "keyxym/v26_browser_runtime.h"
#include "keyxym/v22_browser_frontend.hpp"
#include "keyxym/v26.hpp"

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <vector>

struct keyxym_v26_session {
    keyxym_v26_session(std::string branch,
                       float voxel_size,
                       std::size_t maximum_surfels,
                       keyxym::browser::FrontendConfig frontend_config)
        : runtime(std::move(branch), voxel_size, maximum_surfels),
          frontend(frontend_config) {}

    mutable std::mutex mutex;
    keyxym::RealityWorldCellSession runtime;
    keyxym::browser::Frontend frontend;
    std::vector<float> preview;
    std::array<std::uint8_t, 32> pose_receipt{};
    std::array<std::uint8_t, 32> quality_receipt{};
    std::array<std::uint8_t, 32> authority_receipt{};
    std::int64_t last_timestamp_ns{};
    bool has_timestamp{};
};

namespace {
int map_exception() noexcept {
    try { throw; }
    catch (const std::invalid_argument&) { return KEYXYM_V26_INVALID_ARGUMENT; }
    catch (...) { return KEYXYM_V26_RUNTIME_ERROR; }
}

bool valid_frame(std::uint32_t width, std::uint32_t height,
                 float fx, float fy, float cx, float cy, float scale,
                 const std::uint8_t* rgba, std::size_t rgba_size,
                 const std::uint8_t* commitment, std::size_t commitment_size) {
    if (width < 16U || height < 16U || rgba == nullptr || commitment == nullptr ||
        commitment_size != 32U || !(fx > 0.0F) || !(fy > 0.0F) ||
        !std::isfinite(fx) || !std::isfinite(fy) || !std::isfinite(cx) ||
        !std::isfinite(cy) || !std::isfinite(scale) || !(scale > 0.0F)) return false;
    const auto pixels = static_cast<std::uint64_t>(width) * height;
    return pixels <= 64ULL * 1024ULL * 1024ULL &&
           rgba_size == static_cast<std::size_t>(pixels) * 4U;
}

void pack_pose(const keyxym::RealityFrameResult& result, float* output) {
    std::copy(result.pose.pose.world_from_camera.begin(),
              result.pose.pose.world_from_camera.end(), output);
    output[16] = static_cast<float>(result.pose.matches);
    output[17] = static_cast<float>(result.pose.inliers);
    output[18] = result.pose.tracking_confidence;
    output[19] = result.pose.parallax_degrees;
    output[20] = result.pose.reprojection_error_pixels;
    output[21] = result.pose.rotation_degrees;
    output[22] = result.pose.translation_observability;
    output[23] = result.pose.recovered ? 1.0F : 0.0F;
    output[24] = result.pose.degenerate ? 1.0F : 0.0F;
    output[25] = result.pose.relocalized ? 1.0F : 0.0F;
    output[26] = static_cast<float>(result.keyframe_index);
}

std::vector<float> pack_preview(const std::vector<keyxym::browser::PreviewSample>& preview) {
    std::vector<float> output;
    output.reserve(preview.size() * KEYXYM_V26_PREVIEW_FLOATS);
    for (const auto& sample : preview) {
        output.insert(output.end(), {sample.normalized_x, sample.normalized_y,
            sample.flow_x, sample.flow_y, sample.r, sample.g, sample.b,
            sample.salience, sample.track_support, sample.age});
    }
    return output;
}
} // namespace

extern "C" {
int keyxym_v26_session_create(const char* branch, float voxel_size_meters,
                              size_t maximum_surfels,
                              uint32_t maximum_analysis_width,
                              uint32_t maximum_analysis_height,
                              size_t maximum_tracks,
                              size_t maximum_preview_samples,
                              keyxym_v26_session** out_session) {
    if (branch == nullptr || out_session == nullptr || !(voxel_size_meters > 0.0F) ||
        maximum_surfels == 0U) return KEYXYM_V26_INVALID_ARGUMENT;
    *out_session = nullptr;
    try {
        keyxym::browser::FrontendConfig config;
        config.maximum_analysis_width = maximum_analysis_width;
        config.maximum_analysis_height = maximum_analysis_height;
        config.maximum_tracks = maximum_tracks;
        config.maximum_preview_samples = maximum_preview_samples;
        std::unique_ptr<keyxym_v26_session> session(new keyxym_v26_session(
            branch, voxel_size_meters, maximum_surfels, config));
        *out_session = session.release();
        return KEYXYM_V26_OK;
    } catch (...) { return map_exception(); }
}

void keyxym_v26_session_destroy(keyxym_v26_session* session) { delete session; }

int keyxym_v26_ingest_rgba_packed(keyxym_v26_session* session,
                                  int64_t timestamp_ns,
                                  uint32_t width, uint32_t height,
                                  float fx, float fy, float cx, float cy,
                                  float scale_meters_per_unit,
                                  uint8_t metric_scale,
                                  const uint8_t* rgba, size_t rgba_size,
                                  const uint8_t* source_commitment,
                                  size_t source_commitment_size,
                                  float* pose_output,
                                  size_t pose_output_count) {
    if (session == nullptr || pose_output == nullptr ||
        pose_output_count < KEYXYM_V26_POSE_FLOATS ||
        !valid_frame(width, height, fx, fy, cx, cy, scale_meters_per_unit,
                     rgba, rgba_size, source_commitment, source_commitment_size)) {
        return KEYXYM_V26_INVALID_ARGUMENT;
    }
    try {
        std::lock_guard<std::mutex> lock(session->mutex);
        if (session->has_timestamp && timestamp_ns <= session->last_timestamp_ns)
            return KEYXYM_V26_INVALID_ARGUMENT;
        auto frontend = session->frontend.ingest({width, height, rgba, rgba_size});
        keyxym::MetricFrame frame;
        frame.timestamp = keyxym::Timestamp(std::chrono::nanoseconds(timestamp_ns));
        frame.camera.intrinsics.width = frontend.width;
        frame.camera.intrinsics.height = frontend.height;
        frame.camera.intrinsics.fx = fx * frontend.source_scale_x;
        frame.camera.intrinsics.fy = fy * frontend.source_scale_y;
        frame.camera.intrinsics.cx = cx * frontend.source_scale_x;
        frame.camera.intrinsics.cy = cy * frontend.source_scale_y;
        frame.camera.scale_meters_per_unit = scale_meters_per_unit;
        frame.camera.metric_scale = metric_scale != 0U;
        const std::size_t pixels = static_cast<std::size_t>(frontend.width) * frontend.height;
        if (frontend.rgb.size() != pixels * 3U) return KEYXYM_V26_RUNTIME_ERROR;
        frame.rgb.reserve(pixels);
        for (std::size_t pixel = 0; pixel < pixels; ++pixel) {
            const std::size_t offset = pixel * 3U;
            frame.rgb.push_back({frontend.rgb[offset], frontend.rgb[offset + 1U],
                                 frontend.rgb[offset + 2U]});
        }
        frame.features.reserve(frontend.features.size());
        for (const auto& feature : frontend.features) {
            frame.features.push_back({feature.id, feature.x, feature.y, feature.score,
                                      feature.disparity, feature.match_error});
        }
        std::copy(source_commitment, source_commitment + 32U,
                  frame.source_commitment.begin());
        const auto result = session->runtime.ingest(frame);
        pack_pose(result, pose_output);
        session->preview = pack_preview(frontend.preview);
        std::copy(result.pose.receipt.begin(), result.pose.receipt.end(),
                  session->pose_receipt.begin());
        std::copy(result.quality.receipt.begin(), result.quality.receipt.end(),
                  session->quality_receipt.begin());
        std::copy(result.authority.receipt.begin(), result.authority.receipt.end(),
                  session->authority_receipt.begin());
        session->last_timestamp_ns = timestamp_ns;
        session->has_timestamp = true;
        return KEYXYM_V26_OK;
    } catch (...) { return map_exception(); }
}

int keyxym_v26_copy_receipts(const keyxym_v26_session* session,
                             uint8_t* output, size_t output_capacity,
                             size_t* required_bytes) {
    if (session == nullptr || required_bytes == nullptr) return KEYXYM_V26_INVALID_ARGUMENT;
    *required_bytes = KEYXYM_V26_RECEIPT_BYTES;
    if (output_capacity < *required_bytes) return KEYXYM_V26_BUFFER_TOO_SMALL;
    if (output == nullptr) return KEYXYM_V26_INVALID_ARGUMENT;
    std::lock_guard<std::mutex> lock(session->mutex);
    std::copy(session->pose_receipt.begin(), session->pose_receipt.end(), output);
    std::copy(session->quality_receipt.begin(), session->quality_receipt.end(), output + 32U);
    std::copy(session->authority_receipt.begin(), session->authority_receipt.end(), output + 64U);
    return KEYXYM_V26_OK;
}

int keyxym_v26_copy_preview_packed(const keyxym_v26_session* session,
                                   float* output, size_t output_float_capacity,
                                   size_t* required_float_count) {
    if (session == nullptr || required_float_count == nullptr) return KEYXYM_V26_INVALID_ARGUMENT;
    std::lock_guard<std::mutex> lock(session->mutex);
    *required_float_count = session->preview.size();
    if (output_float_capacity < *required_float_count) return KEYXYM_V26_BUFFER_TOO_SMALL;
    if (*required_float_count != 0U && output == nullptr) return KEYXYM_V26_INVALID_ARGUMENT;
    if (*required_float_count != 0U) std::copy(session->preview.begin(), session->preview.end(), output);
    return KEYXYM_V26_OK;
}

uint64_t keyxym_v26_geometry_revision(const keyxym_v26_session* session) {
    if (session == nullptr) return 0U;
    std::lock_guard<std::mutex> lock(session->mutex);
    return session->runtime.geometry_revision();
}

int keyxym_v26_copy_geometry_snapshot_packed(const keyxym_v26_session* session,
                                             float* output,
                                             size_t output_float_capacity,
                                             size_t* required_float_count,
                                             uint64_t* revision) {
    if (session == nullptr || required_float_count == nullptr || revision == nullptr)
        return KEYXYM_V26_INVALID_ARGUMENT;
    std::lock_guard<std::mutex> lock(session->mutex);
    const auto& geometry = session->runtime.geometry();
    *required_float_count = geometry.size() * KEYXYM_V26_GEOMETRY_FLOATS;
    *revision = session->runtime.geometry_revision();
    if (output_float_capacity < *required_float_count) return KEYXYM_V26_BUFFER_TOO_SMALL;
    if (*required_float_count != 0U && output == nullptr) return KEYXYM_V26_INVALID_ARGUMENT;
    for (std::size_t index = 0; index < geometry.size(); ++index) {
        const auto& source = geometry[index];
        float* record = output + index * KEYXYM_V26_GEOMETRY_FLOATS;
        record[0] = source.surfel.x; record[1] = source.surfel.y; record[2] = source.surfel.z;
        record[3] = source.surfel.nx; record[4] = source.surfel.ny; record[5] = source.surfel.nz;
        record[6] = source.surfel.r; record[7] = source.surfel.g; record[8] = source.surfel.b;
        record[9] = source.surfel.confidence; record[10] = source.uncertainty;
        record[11] = static_cast<float>(source.observations);
        record[12] = static_cast<float>(source.source_keyframe);
    }
    return KEYXYM_V26_OK;
}

int keyxym_v26_quality_packed(const keyxym_v26_session* session,
                              float* output, size_t output_float_count) {
    if (session == nullptr || output == nullptr || output_float_count < KEYXYM_V26_QUALITY_FLOATS)
        return KEYXYM_V26_INVALID_ARGUMENT;
    std::lock_guard<std::mutex> lock(session->mutex);
    const auto& quality = session->runtime.quality();
    output[0] = quality.tracking_confidence; output[1] = quality.parallax_degrees;
    output[2] = quality.reprojection_error_pixels; output[3] = quality.coverage;
    output[4] = static_cast<float>(quality.confirmed);
    output[5] = static_cast<float>(quality.uncertain);
    output[6] = static_cast<float>(quality.rejected);
    output[7] = quality.metric_scale ? 1.0F : 0.0F;
    return KEYXYM_V26_OK;
}

int keyxym_v26_authority_packed(const keyxym_v26_session* session,
                                float* output, size_t output_float_count) {
    if (session == nullptr || output == nullptr || output_float_count < KEYXYM_V26_AUTHORITY_FLOATS)
        return KEYXYM_V26_INVALID_ARGUMENT;
    std::lock_guard<std::mutex> lock(session->mutex);
    const auto& authority = session->runtime.authority();
    output[0] = static_cast<float>(static_cast<std::uint32_t>(authority.stage));
    output[1] = static_cast<float>(authority.rejection_mask);
    output[2] = authority.score;
    output[3] = static_cast<float>(authority.confirmed_surfels);
    output[4] = static_cast<float>(authority.continuity_frames);
    output[5] = authority.moment_allowed ? 1.0F : 0.0F;
    output[6] = authority.seal_allowed ? 1.0F : 0.0F;
    output[7] = authority.metric_scale ? 1.0F : 0.0F;
    return KEYXYM_V26_OK;
}

const char* keyxym_v26_status_message(int status) {
    switch (status) {
        case KEYXYM_V26_OK: return "ok";
        case KEYXYM_V26_INVALID_ARGUMENT: return "invalid argument";
        case KEYXYM_V26_BUFFER_TOO_SMALL: return "buffer too small";
        case KEYXYM_V26_RUNTIME_ERROR: return "runtime error";
        default: return "unknown status";
    }
}
} // extern "C"
