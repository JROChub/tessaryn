#include "keyxym/v22_browser_runtime.h"
#include "keyxym/v22_browser_frontend.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <unordered_map>
#include <vector>

namespace {

struct BrowserState {
    explicit BrowserState(keyxym::browser::FrontendConfig config)
        : frontend(std::move(config)) {}

    std::mutex mutex;
    keyxym::browser::Frontend frontend;
    std::vector<float> preview;
    std::array<std::uint8_t, 32> pose_receipt{};
    std::array<std::uint8_t, 32> quality_receipt{};
    std::int64_t last_timestamp_ns{};
    std::uint64_t geometry_revision{};
    bool has_timestamp{};
};

std::mutex registry_mutex;
std::unordered_map<const keyxym_v22_session*, std::shared_ptr<BrowserState>> registry;

std::shared_ptr<BrowserState> state_for(const keyxym_v22_session* session) {
    std::lock_guard<std::mutex> lock(registry_mutex);
    const auto found = registry.find(session);
    return found == registry.end() ? std::shared_ptr<BrowserState>{} : found->second;
}

bool valid_frame(const keyxym_v22_browser_frame& frame) {
    if (frame.width < 16U || frame.height < 16U || frame.rgba == nullptr ||
        frame.source_commitment == nullptr || frame.source_commitment_size != 32U ||
        !(frame.fx > 0.0F) || !(frame.fy > 0.0F) ||
        !std::isfinite(frame.fx) || !std::isfinite(frame.fy) ||
        !std::isfinite(frame.cx) || !std::isfinite(frame.cy) ||
        !std::isfinite(frame.scale_meters_per_unit) ||
        !(frame.scale_meters_per_unit > 0.0F)) {
        return false;
    }
    const auto pixels = static_cast<std::uint64_t>(frame.width) * frame.height;
    return pixels <= 64ULL * 1024ULL * 1024ULL &&
           frame.rgba_size == static_cast<std::size_t>(pixels) * 4U;
}

std::vector<keyxym_v22_feature> native_features(
    const std::vector<keyxym::browser::TrackedFeature>& features) {
    std::vector<keyxym_v22_feature> output;
    output.reserve(features.size());
    for (const auto& feature : features) {
        output.push_back({feature.id, feature.x, feature.y, feature.score,
                          feature.disparity, feature.match_error});
    }
    return output;
}

void pack_pose(const keyxym_v22_pose& source, float* output) {
    std::copy(std::begin(source.world_from_camera),
              std::end(source.world_from_camera), output);
    output[16] = static_cast<float>(source.matches);
    output[17] = static_cast<float>(source.inliers);
    output[18] = source.tracking_confidence;
    output[19] = source.parallax_degrees;
    output[20] = source.reprojection_error_pixels;
    output[21] = source.recovered != 0U ? 1.0F : 0.0F;
}

std::vector<float> pack_preview(const std::vector<keyxym::browser::PreviewSample>& preview) {
    std::vector<float> output;
    output.reserve(preview.size() * KEYXYM_V22_BROWSER_PREVIEW_FLOATS);
    for (const auto& sample : preview) {
        output.insert(output.end(), {
            sample.normalized_x, sample.normalized_y,
            sample.flow_x, sample.flow_y,
            sample.r, sample.g, sample.b,
            sample.salience, sample.track_support, sample.age
        });
    }
    return output;
}

} // namespace

extern "C" {

int keyxym_v22_browser_session_create(
    const char* branch,
    float voxel_size_meters,
    size_t maximum_surfels,
    uint32_t maximum_analysis_width,
    uint32_t maximum_analysis_height,
    size_t maximum_tracks,
    size_t maximum_preview_samples,
    keyxym_v22_session** out_session) {
    if (out_session == nullptr) return KEYXYM_V22_INVALID_ARGUMENT;
    *out_session = nullptr;
    keyxym::browser::FrontendConfig config;
    config.maximum_analysis_width = maximum_analysis_width;
    config.maximum_analysis_height = maximum_analysis_height;
    config.maximum_tracks = maximum_tracks;
    config.maximum_preview_samples = maximum_preview_samples;
    try {
        auto state = std::make_shared<BrowserState>(config);
        keyxym_v22_session* session = nullptr;
        const int status = keyxym_v22_session_create(
            branch, voxel_size_meters, maximum_surfels, &session);
        if (status != KEYXYM_V22_OK) return status;
        try {
            std::lock_guard<std::mutex> lock(registry_mutex);
            registry.emplace(session, std::move(state));
        } catch (...) {
            keyxym_v22_session_destroy(session);
            throw;
        }
        *out_session = session;
        return KEYXYM_V22_OK;
    } catch (const std::invalid_argument&) {
        return KEYXYM_V22_INVALID_ARGUMENT;
    } catch (...) {
        return KEYXYM_V22_RUNTIME_ERROR;
    }
}

void keyxym_v22_browser_session_destroy(keyxym_v22_session* session) {
    if (session == nullptr) return;
    std::shared_ptr<BrowserState> state;
    {
        std::lock_guard<std::mutex> lock(registry_mutex);
        const auto found = registry.find(session);
        if (found != registry.end()) {
            state = found->second;
            registry.erase(found);
        }
    }
    if (state) {
        std::lock_guard<std::mutex> lock(state->mutex);
        keyxym_v22_session_destroy(session);
    } else {
        keyxym_v22_session_destroy(session);
    }
}

int keyxym_v22_browser_ingest_rgba(
    keyxym_v22_session* session,
    const keyxym_v22_browser_frame* frame,
    float* pose_output,
    size_t pose_output_count) {
    if (session == nullptr || frame == nullptr || pose_output == nullptr ||
        pose_output_count < KEYXYM_V22_PACKED_POSE_FLOATS || !valid_frame(*frame)) {
        return KEYXYM_V22_INVALID_ARGUMENT;
    }
    const auto state = state_for(session);
    if (!state) return KEYXYM_V22_INVALID_ARGUMENT;

    try {
        std::lock_guard<std::mutex> lock(state->mutex);
        if (state->has_timestamp && frame->timestamp_ns <= state->last_timestamp_ns) {
            return KEYXYM_V22_INVALID_ARGUMENT;
        }
        auto frontend = state->frontend.ingest({
            frame->width, frame->height, frame->rgba, frame->rgba_size
        });
        const auto features = native_features(frontend.features);
        keyxym_v22_frame metric_frame{};
        metric_frame.timestamp_ns = frame->timestamp_ns;
        metric_frame.width = frontend.width;
        metric_frame.height = frontend.height;
        metric_frame.fx = frame->fx * frontend.source_scale_x;
        metric_frame.fy = frame->fy * frontend.source_scale_y;
        metric_frame.cx = frame->cx * frontend.source_scale_x;
        metric_frame.cy = frame->cy * frontend.source_scale_y;
        metric_frame.scale_meters_per_unit = frame->scale_meters_per_unit;
        metric_frame.metric_scale = frame->metric_scale;
        metric_frame.rgb = frontend.rgb.data();
        metric_frame.rgb_triplet_count =
            static_cast<std::size_t>(frontend.width) * frontend.height;
        metric_frame.features = features.data();
        metric_frame.feature_count = features.size();
        metric_frame.source_commitment = frame->source_commitment;
        metric_frame.source_commitment_size = frame->source_commitment_size;

        keyxym_v22_pose pose{};
        const int status = keyxym_v22_session_ingest(session, &metric_frame, &pose);
        if (status != KEYXYM_V22_OK) return status;
        keyxym_v22_quality quality{};
        const int quality_status = keyxym_v22_session_quality(session, &quality);
        if (quality_status != KEYXYM_V22_OK) return quality_status;

        pack_pose(pose, pose_output);
        std::copy(std::begin(pose.receipt), std::end(pose.receipt),
                  state->pose_receipt.begin());
        std::copy(std::begin(quality.receipt), std::end(quality.receipt),
                  state->quality_receipt.begin());
        state->preview = pack_preview(frontend.preview);
        state->last_timestamp_ns = frame->timestamp_ns;
        state->has_timestamp = true;
        ++state->geometry_revision;
        return KEYXYM_V22_OK;
    } catch (const std::invalid_argument&) {
        return KEYXYM_V22_INVALID_ARGUMENT;
    } catch (...) {
        return KEYXYM_V22_RUNTIME_ERROR;
    }
}

int keyxym_v22_browser_ingest_rgba_packed(
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
    const uint8_t* rgba,
    size_t rgba_size,
    const uint8_t* source_commitment,
    size_t source_commitment_size,
    float* pose_output,
    size_t pose_output_count) {
    keyxym_v22_browser_frame frame{};
    frame.timestamp_ns = timestamp_ns;
    frame.width = width;
    frame.height = height;
    frame.fx = fx;
    frame.fy = fy;
    frame.cx = cx;
    frame.cy = cy;
    frame.scale_meters_per_unit = scale_meters_per_unit;
    frame.metric_scale = metric_scale;
    frame.rgba = rgba;
    frame.rgba_size = rgba_size;
    frame.source_commitment = source_commitment;
    frame.source_commitment_size = source_commitment_size;
    return keyxym_v22_browser_ingest_rgba(
        session, &frame, pose_output, pose_output_count);
}

int keyxym_v22_browser_copy_receipts(
    const keyxym_v22_session* session,
    uint8_t* output,
    size_t output_capacity,
    size_t* required_bytes) {
    if (session == nullptr || required_bytes == nullptr) {
        return KEYXYM_V22_INVALID_ARGUMENT;
    }
    *required_bytes = KEYXYM_V22_BROWSER_RECEIPT_BYTES;
    if (output_capacity < *required_bytes) return KEYXYM_V22_BUFFER_TOO_SMALL;
    if (output == nullptr) return KEYXYM_V22_INVALID_ARGUMENT;
    const auto state = state_for(session);
    if (!state) return KEYXYM_V22_INVALID_ARGUMENT;
    std::lock_guard<std::mutex> lock(state->mutex);
    std::copy(state->pose_receipt.begin(), state->pose_receipt.end(), output);
    std::copy(state->quality_receipt.begin(), state->quality_receipt.end(), output + 32U);
    return KEYXYM_V22_OK;
}

int keyxym_v22_browser_copy_preview_packed(
    const keyxym_v22_session* session,
    float* output,
    size_t output_float_capacity,
    size_t* required_float_count) {
    if (session == nullptr || required_float_count == nullptr) {
        return KEYXYM_V22_INVALID_ARGUMENT;
    }
    const auto state = state_for(session);
    if (!state) return KEYXYM_V22_INVALID_ARGUMENT;
    std::lock_guard<std::mutex> lock(state->mutex);
    *required_float_count = state->preview.size();
    if (output_float_capacity < *required_float_count) return KEYXYM_V22_BUFFER_TOO_SMALL;
    if (*required_float_count != 0U && output == nullptr) return KEYXYM_V22_INVALID_ARGUMENT;
    if (*required_float_count != 0U) {
        std::copy(state->preview.begin(), state->preview.end(), output);
    }
    return KEYXYM_V22_OK;
}

uint64_t keyxym_v22_browser_geometry_revision(const keyxym_v22_session* session) {
    const auto state = state_for(session);
    if (!state) return 0U;
    std::lock_guard<std::mutex> lock(state->mutex);
    return state->geometry_revision;
}

int keyxym_v22_browser_copy_geometry_snapshot_packed(
    const keyxym_v22_session* session,
    float* output,
    size_t output_float_capacity,
    size_t* required_float_count,
    uint64_t* revision) {
    if (session == nullptr || required_float_count == nullptr || revision == nullptr) {
        return KEYXYM_V22_INVALID_ARGUMENT;
    }
    const auto state = state_for(session);
    if (!state) return KEYXYM_V22_INVALID_ARGUMENT;
    std::lock_guard<std::mutex> lock(state->mutex);
    const int status = keyxym_v22_session_copy_geometry_packed(
        session, output, output_float_capacity, required_float_count);
    *revision = state->geometry_revision;
    return status;
}

} // extern "C"
