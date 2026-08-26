#include "keyxym/v22_browser_frontend.hpp"

#include <algorithm>
#include <cassert>
#include <cstddef>
#include <cstdint>
#include <set>
#include <stdexcept>
#include <vector>

namespace {
std::vector<std::uint8_t> textured(std::uint32_t width,
                                   std::uint32_t height,
                                   int shift) {
    std::vector<std::uint8_t> rgba(static_cast<std::size_t>(width) * height * 4U, 255U);
    for (std::uint32_t y = 0; y < height; ++y) {
        for (std::uint32_t x = 0; x < width; ++x) {
            const int sx = static_cast<int>(x) - shift;
            const int checker = ((sx / 5) ^ (static_cast<int>(y) / 5)) & 1;
            const int detail = (sx * sx + static_cast<int>(y) * static_cast<int>(y) +
                                sx * static_cast<int>(y)) % 53;
            const auto value = static_cast<std::uint8_t>(
                checker ? 190 + detail % 50 : 25 + detail);
            const std::size_t offset =
                (static_cast<std::size_t>(y) * width + x) * 4U;
            rgba[offset] = value;
            rgba[offset + 1U] = static_cast<std::uint8_t>(
                (static_cast<unsigned>(value) * 3U) / 4U);
            rgba[offset + 2U] = static_cast<std::uint8_t>(255U - value / 2U);
        }
    }
    return rgba;
}
} // namespace

int main() {
    keyxym::browser::FrontendConfig config;
    config.maximum_analysis_width = 160U;
    config.maximum_analysis_height = 120U;
    config.maximum_tracks = 256U;
    config.maximum_preview_samples = 2048U;
    keyxym::browser::Frontend frontend(config);

    constexpr std::uint32_t width = 640U;
    constexpr std::uint32_t height = 480U;
    auto first_pixels = textured(width, height, 0);
    auto second_pixels = textured(width, height, 8);
    auto third_pixels = textured(width, height, 16);

    const auto first = frontend.ingest(
        {width, height, first_pixels.data(), first_pixels.size()});
    assert(first.width == 160U && first.height == 120U);
    assert(first.rgb.size() ==
           static_cast<std::size_t>(first.width) * first.height * 3U);
    assert(first.features.size() >= 12U);
    assert(!first.preview.empty() &&
           first.preview.size() <= config.maximum_preview_samples);
    assert(std::all_of(first.features.begin(), first.features.end(),
                       [](const auto& feature) {
                           return !feature.matched &&
                                  feature.disparity == 0.0F &&
                                  feature.age == 1U;
                       }));

    std::set<std::uint32_t> first_ids;
    for (const auto& feature : first.features) first_ids.insert(feature.id);

    const auto second = frontend.ingest(
        {width, height, second_pixels.data(), second_pixels.size()});
    std::size_t matched_second = 0U;
    std::set<std::uint32_t> matched_ids;
    for (const auto& feature : second.features) {
        if (!feature.matched) continue;
        ++matched_second;
        matched_ids.insert(feature.id);
        assert(first_ids.count(feature.id) == 1U);
        assert(feature.age == 2U);
        assert(feature.disparity > 0.0F);
    }
    assert(matched_second >= 12U);

    const auto third = frontend.ingest(
        {width, height, third_pixels.data(), third_pixels.size()});
    std::size_t persistent = 0U;
    for (const auto& feature : third.features) {
        if (feature.matched && matched_ids.count(feature.id) != 0U) {
            ++persistent;
            assert(feature.age >= 3U);
        }
    }
    assert(persistent >= 10U);

    frontend.reset();
    assert(frontend.sequence() == 0U);
    const auto reset = frontend.ingest(
        {width, height, first_pixels.data(), first_pixels.size()});
    assert(reset.sequence == 0U);
    assert(std::all_of(reset.features.begin(), reset.features.end(),
                       [](const auto& feature) {
                           return feature.age == 1U && !feature.matched;
                       }));

    bool rejected = false;
    try {
        (void)frontend.ingest(
            {width, height, first_pixels.data(), first_pixels.size() - 1U});
    } catch (const std::invalid_argument&) {
        rejected = true;
    }
    assert(rejected);
    return 0;
}
