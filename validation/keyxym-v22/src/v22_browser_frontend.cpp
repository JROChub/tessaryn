#include "keyxym/v22_browser_frontend.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>
#include <utility>

namespace keyxym::browser {
namespace {

struct AnalysisImage {
    std::uint32_t width{};
    std::uint32_t height{};
    float source_scale_x{1.0F};
    float source_scale_y{1.0F};
    std::vector<float> gray;
    std::vector<float> rgb;
};

struct Candidate {
    float x{};
    float y{};
    float score{};
};

struct Match {
    bool accepted{};
    float x{};
    float y{};
    float error{std::numeric_limits<float>::infinity()};
};

std::size_t checked_pixels(std::uint32_t width, std::uint32_t height) {
    if (width == 0U || height == 0U) throw std::invalid_argument("empty browser frame");
    const auto pixels = static_cast<std::uint64_t>(width) * height;
    if (pixels > 64ULL * 1024ULL * 1024ULL) {
        throw std::length_error("browser frame pixel limit exceeded");
    }
    return static_cast<std::size_t>(pixels);
}

float luminance(const std::uint8_t* rgba, std::size_t pixel) {
    const std::size_t offset = pixel * 4U;
    return (0.2126F * static_cast<float>(rgba[offset]) +
            0.7152F * static_cast<float>(rgba[offset + 1U]) +
            0.0722F * static_cast<float>(rgba[offset + 2U])) /
           255.0F;
}

AnalysisImage make_analysis_image(const RgbaFrameView& input,
                                  const FrontendConfig& config) {
    const std::size_t source_pixels = checked_pixels(input.width, input.height);
    if (input.rgba == nullptr || input.rgba_size != source_pixels * 4U) {
        throw std::invalid_argument("RGBA byte count does not match frame dimensions");
    }

    const float width_ratio = static_cast<float>(config.maximum_analysis_width) /
                              static_cast<float>(input.width);
    const float height_ratio = static_cast<float>(config.maximum_analysis_height) /
                               static_cast<float>(input.height);
    const float scale = std::min(1.0F, std::min(width_ratio, height_ratio));

    AnalysisImage output;
    output.width = std::max<std::uint32_t>(16U,
        static_cast<std::uint32_t>(std::floor(static_cast<float>(input.width) * scale)));
    output.height = std::max<std::uint32_t>(16U,
        static_cast<std::uint32_t>(std::floor(static_cast<float>(input.height) * scale)));
    output.source_scale_x = static_cast<float>(output.width) / static_cast<float>(input.width);
    output.source_scale_y = static_cast<float>(output.height) / static_cast<float>(input.height);

    const std::size_t pixels = checked_pixels(output.width, output.height);
    output.gray.resize(pixels);
    output.rgb.resize(pixels * 3U);

    for (std::uint32_t y = 0; y < output.height; ++y) {
        const std::uint32_t source_y = std::min(input.height - 1U,
            static_cast<std::uint32_t>((static_cast<std::uint64_t>(y) * input.height) /
                                       output.height));
        for (std::uint32_t x = 0; x < output.width; ++x) {
            const std::uint32_t source_x = std::min(input.width - 1U,
                static_cast<std::uint32_t>((static_cast<std::uint64_t>(x) * input.width) /
                                           output.width));
            const std::size_t source_pixel = static_cast<std::size_t>(source_y) * input.width + source_x;
            const std::size_t destination_pixel = static_cast<std::size_t>(y) * output.width + x;
            const std::size_t source_offset = source_pixel * 4U;
            const std::size_t destination_offset = destination_pixel * 3U;
            output.gray[destination_pixel] = luminance(input.rgba, source_pixel);
            output.rgb[destination_offset] = static_cast<float>(input.rgba[source_offset]) / 255.0F;
            output.rgb[destination_offset + 1U] = static_cast<float>(input.rgba[source_offset + 1U]) / 255.0F;
            output.rgb[destination_offset + 2U] = static_cast<float>(input.rgba[source_offset + 2U]) / 255.0F;
        }
    }
    return output;
}

float at(const std::vector<float>& image, std::uint32_t width, int x, int y) {
    return image[static_cast<std::size_t>(y) * width + static_cast<std::size_t>(x)];
}

float corner_score(const std::vector<float>& gray, std::uint32_t width, int x, int y) {
    const float gx = at(gray, width, x + 1, y) - at(gray, width, x - 1, y);
    const float gy = at(gray, width, x, y + 1) - at(gray, width, x, y - 1);
    const float d1 = at(gray, width, x + 1, y + 1) - at(gray, width, x - 1, y - 1);
    const float d2 = at(gray, width, x + 1, y - 1) - at(gray, width, x - 1, y + 1);
    return gx * gx + gy * gy + 0.25F * (d1 * d1 + d2 * d2);
}

std::vector<Candidate> detect_candidates(const std::vector<float>& gray,
                                         std::uint32_t width,
                                         std::uint32_t height,
                                         const FrontendConfig& config) {
    const int border = 5;
    const int cell = std::max(6, static_cast<int>(config.detection_cell_size));
    std::vector<Candidate> candidates;
    for (int cell_y = border; cell_y < static_cast<int>(height) - border; cell_y += cell) {
        for (int cell_x = border; cell_x < static_cast<int>(width) - border; cell_x += cell) {
            Candidate best;
            for (int y = cell_y; y < std::min(cell_y + cell, static_cast<int>(height) - border); ++y) {
                for (int x = cell_x; x < std::min(cell_x + cell, static_cast<int>(width) - border); ++x) {
                    const float score = corner_score(gray, width, x, y);
                    if (score > best.score) best = {static_cast<float>(x), static_cast<float>(y), score};
                }
            }
            if (best.score >= config.minimum_corner_score) candidates.push_back(best);
        }
    }
    std::sort(candidates.begin(), candidates.end(), [](const Candidate& left, const Candidate& right) {
        if (left.score != right.score) return left.score > right.score;
        if (left.y != right.y) return left.y < right.y;
        return left.x < right.x;
    });
    return candidates;
}

float zero_mean_patch_error(const std::vector<float>& previous,
                            const std::vector<float>& current,
                            std::uint32_t width,
                            int previous_x,
                            int previous_y,
                            int current_x,
                            int current_y,
                            int radius) {
    float previous_mean = 0.0F;
    float current_mean = 0.0F;
    int samples = 0;
    for (int oy = -radius; oy <= radius; ++oy) {
        for (int ox = -radius; ox <= radius; ++ox) {
            previous_mean += at(previous, width, previous_x + ox, previous_y + oy);
            current_mean += at(current, width, current_x + ox, current_y + oy);
            ++samples;
        }
    }
    previous_mean /= static_cast<float>(samples);
    current_mean /= static_cast<float>(samples);

    float error = 0.0F;
    for (int oy = -radius; oy <= radius; ++oy) {
        for (int ox = -radius; ox <= radius; ++ox) {
            const float left = at(previous, width, previous_x + ox, previous_y + oy) - previous_mean;
            const float right = at(current, width, current_x + ox, current_y + oy) - current_mean;
            error += std::abs(left - right);
        }
    }
    return error / static_cast<float>(samples);
}

Match search_patch(const std::vector<float>& previous,
                   const std::vector<float>& current,
                   std::uint32_t width,
                   std::uint32_t height,
                   float source_x,
                   float source_y,
                   int center_x,
                   int center_y,
                   int radius,
                   int step,
                   const FrontendConfig& config) {
    const int patch_radius = 2;
    const int sx = static_cast<int>(std::lround(source_x));
    const int sy = static_cast<int>(std::lround(source_y));
    if (sx < patch_radius || sy < patch_radius ||
        sx >= static_cast<int>(width) - patch_radius ||
        sy >= static_cast<int>(height) - patch_radius) {
        return {};
    }

    float best = std::numeric_limits<float>::infinity();
    float second = std::numeric_limits<float>::infinity();
    int best_x = center_x;
    int best_y = center_y;
    for (int dy = -radius; dy <= radius; dy += step) {
        for (int dx = -radius; dx <= radius; dx += step) {
            const int x = center_x + dx;
            const int y = center_y + dy;
            if (x < patch_radius || y < patch_radius ||
                x >= static_cast<int>(width) - patch_radius ||
                y >= static_cast<int>(height) - patch_radius) {
                continue;
            }
            const float error = zero_mean_patch_error(previous, current, width,
                                                       sx, sy, x, y, patch_radius);
            if (error < best) {
                second = best;
                best = error;
                best_x = x;
                best_y = y;
            } else if (error < second) {
                second = error;
            }
        }
    }

    Match result;
    result.x = static_cast<float>(best_x);
    result.y = static_cast<float>(best_y);
    result.error = best;
    result.accepted = std::isfinite(best) && best <= config.maximum_patch_error &&
                      (!std::isfinite(second) || best < second * config.ratio_threshold);
    return result;
}

Match track_one(const std::vector<float>& previous,
                const std::vector<float>& current,
                std::uint32_t width,
                std::uint32_t height,
                float x,
                float y,
                const FrontendConfig& config) {
    const int radius = static_cast<int>(config.search_radius);
    const auto coarse = search_patch(previous, current, width, height, x, y,
                                     static_cast<int>(std::lround(x)),
                                     static_cast<int>(std::lround(y)),
                                     radius, 3, config);
    if (!coarse.accepted) return coarse;
    const auto refined = search_patch(previous, current, width, height, x, y,
                                      static_cast<int>(std::lround(coarse.x)),
                                      static_cast<int>(std::lround(coarse.y)),
                                      3, 1, config);
    if (!refined.accepted) return refined;

    const auto backward = search_patch(current, previous, width, height,
                                       refined.x, refined.y,
                                       static_cast<int>(std::lround(x)),
                                       static_cast<int>(std::lround(y)),
                                       3, 1, config);
    if (!backward.accepted ||
        std::hypot(backward.x - x, backward.y - y) > config.forward_backward_threshold) {
        return {};
    }
    return refined;
}

bool separated(float x, float y,
               const std::vector<Frontend::StoredTrack>& tracks,
               float minimum_distance) {
    const float minimum_squared = minimum_distance * minimum_distance;
    for (const auto& track : tracks) {
        const float dx = track.x - x;
        const float dy = track.y - y;
        if (dx * dx + dy * dy < minimum_squared) return false;
    }
    return true;
}

std::pair<float, float> median_flow(const std::vector<TrackedFeature>& features) {
    std::vector<float> dx;
    std::vector<float> dy;
    for (const auto& feature : features) {
        if (!feature.matched) continue;
        dx.push_back(feature.x - feature.previous_x);
        dy.push_back(feature.y - feature.previous_y);
    }
    if (dx.empty()) return {0.0F, 0.0F};
    const auto middle_x = dx.begin() + static_cast<std::ptrdiff_t>(dx.size() / 2U);
    const auto middle_y = dy.begin() + static_cast<std::ptrdiff_t>(dy.size() / 2U);
    std::nth_element(dx.begin(), middle_x, dx.end());
    std::nth_element(dy.begin(), middle_y, dy.end());
    return {*middle_x, *middle_y};
}

std::vector<PreviewSample> make_preview(const AnalysisImage& image,
                                        const std::vector<TrackedFeature>& features,
                                        const FrontendConfig& config) {
    std::vector<PreviewSample> output;
    if (config.maximum_preview_samples == 0U) return output;
    const float target_stride = std::sqrt(
        static_cast<float>(image.width) * static_cast<float>(image.height) /
        static_cast<float>(config.maximum_preview_samples));
    const int stride = std::max(1, static_cast<int>(std::ceil(target_stride)));
    const auto [global_dx, global_dy] = median_flow(features);
    const float support = std::min(1.0F, static_cast<float>(features.size()) /
                                           static_cast<float>(std::max<std::size_t>(1U, config.maximum_tracks)));
    output.reserve(std::min<std::size_t>(config.maximum_preview_samples,
        (image.width / static_cast<std::uint32_t>(stride) + 1U) *
        (image.height / static_cast<std::uint32_t>(stride) + 1U)));

    for (int y = 0; y < static_cast<int>(image.height); y += stride) {
        for (int x = 0; x < static_cast<int>(image.width); x += stride) {
            if (output.size() >= config.maximum_preview_samples) return output;
            const std::size_t pixel = static_cast<std::size_t>(y) * image.width + static_cast<std::size_t>(x);
            const std::size_t color = pixel * 3U;
            float local_dx = global_dx;
            float local_dy = global_dy;
            float local_age = 0.0F;
            float nearest = 64.0F;
            for (const auto& feature : features) {
                if (!feature.matched) continue;
                const float distance = std::hypot(feature.x - static_cast<float>(x),
                                                  feature.y - static_cast<float>(y));
                if (distance < nearest) {
                    nearest = distance;
                    local_dx = feature.x - feature.previous_x;
                    local_dy = feature.y - feature.previous_y;
                    local_age = static_cast<float>(feature.age);
                }
            }
            output.push_back({
                (static_cast<float>(x) / static_cast<float>(image.width) - 0.5F) * 2.0F,
                -(static_cast<float>(y) / static_cast<float>(image.height) - 0.5F) * 2.0F,
                local_dx / static_cast<float>(image.width),
                -local_dy / static_cast<float>(image.height),
                image.rgb[color], image.rgb[color + 1U], image.rgb[color + 2U],
                image.gray[pixel], support, local_age
            });
        }
    }
    return output;
}

} // namespace

Frontend::Frontend(FrontendConfig config) : config_(config) {
    if (config_.maximum_analysis_width < 16U || config_.maximum_analysis_height < 16U ||
        config_.maximum_tracks < 12U || config_.maximum_preview_samples == 0U ||
        config_.detection_cell_size < 4U || config_.search_radius < 3U ||
        !(config_.minimum_corner_score > 0.0F) || !(config_.maximum_patch_error > 0.0F) ||
        !(config_.ratio_threshold > 0.0F && config_.ratio_threshold < 1.0F) ||
        !(config_.forward_backward_threshold > 0.0F)) {
        throw std::invalid_argument("invalid browser frontend configuration");
    }
}

FrontendFrame Frontend::ingest(const RgbaFrameView& frame) {
    AnalysisImage image = make_analysis_image(frame, config_);
    const bool compatible_previous = width_ == image.width && height_ == image.height &&
                                     !previous_gray_.empty();

    std::vector<TrackedFeature> output_features;
    std::vector<StoredTrack> next_tracks;
    output_features.reserve(config_.maximum_tracks);
    next_tracks.reserve(config_.maximum_tracks);

    if (compatible_previous) {
        for (const auto& track : tracks_) {
            const Match match = track_one(previous_gray_, image.gray,
                                          image.width, image.height,
                                          track.x, track.y, config_);
            if (!match.accepted) continue;
            const float disparity = std::hypot(match.x - track.x, match.y - track.y);
            const std::uint32_t age = track.age + 1U;
            output_features.push_back({track.id, match.x, match.y, track.x, track.y,
                                       track.score, disparity, match.error * 8.0F,
                                       age, true});
            next_tracks.push_back({track.id, match.x, match.y, track.score, age});
            if (next_tracks.size() >= config_.maximum_tracks) break;
        }
    }

    const auto candidates = detect_candidates(image.gray, image.width, image.height, config_);
    for (const auto& candidate : candidates) {
        if (next_tracks.size() >= config_.maximum_tracks) break;
        if (!separated(candidate.x, candidate.y, next_tracks,
                       static_cast<float>(config_.detection_cell_size) * 0.55F)) {
            continue;
        }
        if (next_track_id_ == 0U || next_track_id_ > 16'000'000U) {
            throw std::overflow_error("browser feature identity space exhausted");
        }
        const std::uint32_t id = next_track_id_++;
        output_features.push_back({id, candidate.x, candidate.y, candidate.x, candidate.y,
                                   candidate.score, 0.0F, 0.0F, 1U, false});
        next_tracks.push_back({id, candidate.x, candidate.y, candidate.score, 1U});
    }

    FrontendFrame output;
    output.width = image.width;
    output.height = image.height;
    output.source_scale_x = image.source_scale_x;
    output.source_scale_y = image.source_scale_y;
    output.features = std::move(output_features);
    output.preview = make_preview(image, output.features, config_);
    output.rgb = std::move(image.rgb);
    output.sequence = sequence_;

    previous_gray_ = std::move(image.gray);
    tracks_ = std::move(next_tracks);
    width_ = output.width;
    height_ = output.height;
    ++sequence_;
    return output;
}

void Frontend::reset() noexcept {
    sequence_ = 0U;
    next_track_id_ = 1U;
    width_ = 0U;
    height_ = 0U;
    previous_gray_.clear();
    tracks_.clear();
}

} // namespace keyxym::browser
