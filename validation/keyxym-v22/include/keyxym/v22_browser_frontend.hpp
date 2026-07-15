#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

namespace keyxym::browser {

struct FrontendConfig {
    std::uint32_t maximum_analysis_width{320};
    std::uint32_t maximum_analysis_height{240};
    std::size_t maximum_tracks{384};
    std::size_t maximum_preview_samples{8192};
    std::uint32_t detection_cell_size{12};
    std::uint32_t search_radius{18};
    float minimum_corner_score{0.0018F};
    float maximum_patch_error{0.16F};
    float ratio_threshold{0.92F};
    float forward_backward_threshold{2.0F};
};

struct RgbaFrameView {
    std::uint32_t width{};
    std::uint32_t height{};
    const std::uint8_t* rgba{};
    std::size_t rgba_size{};
};

struct TrackedFeature {
    std::uint32_t id{};
    float x{};
    float y{};
    float previous_x{};
    float previous_y{};
    float score{};
    float disparity{};
    float match_error{};
    std::uint32_t age{};
    bool matched{};
};

struct PreviewSample {
    float normalized_x{};
    float normalized_y{};
    float flow_x{};
    float flow_y{};
    float r{};
    float g{};
    float b{};
    float salience{};
    float track_support{};
    float age{};
};

struct FrontendFrame {
    std::uint32_t width{};
    std::uint32_t height{};
    float source_scale_x{1.0F};
    float source_scale_y{1.0F};
    std::vector<float> rgb;
    std::vector<TrackedFeature> features;
    std::vector<PreviewSample> preview;
    std::uint64_t sequence{};
};

class Frontend {
public:
    struct StoredTrack {
        std::uint32_t id{};
        float x{};
        float y{};
        float score{};
        std::uint32_t age{};
    };

    explicit Frontend(FrontendConfig config = {});

    FrontendFrame ingest(const RgbaFrameView& frame);
    void reset() noexcept;

    const FrontendConfig& config() const noexcept { return config_; }
    std::uint64_t sequence() const noexcept { return sequence_; }

private:
    FrontendConfig config_;
    std::uint64_t sequence_{};
    std::uint32_t next_track_id_{1};
    std::uint32_t width_{};
    std::uint32_t height_{};
    std::vector<float> previous_gray_;
    std::vector<StoredTrack> tracks_;
};

} // namespace keyxym::browser
