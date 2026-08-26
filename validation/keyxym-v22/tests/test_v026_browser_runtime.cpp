#include "keyxym/v26_browser_runtime.h"

#include <algorithm>
#include <array>
#include <cassert>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace {
std::vector<std::uint8_t> textured(std::uint32_t width,
                                   std::uint32_t height,
                                   int shift) {
    std::vector<std::uint8_t> rgba(
        static_cast<std::size_t>(width) * height * 4U, 255U);
    for (std::uint32_t y = 0; y < height; ++y) {
        for (std::uint32_t x = 0; x < width; ++x) {
            const int source_x = static_cast<int>(x) - shift;
            const int checker = ((source_x / 5) ^ (static_cast<int>(y) / 5)) & 1;
            const int detail = (source_x * source_x + static_cast<int>(y) *
                static_cast<int>(y) + source_x * static_cast<int>(y)) % 53;
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

int ingest(keyxym_v26_session* session,
           std::int64_t timestamp,
           std::vector<std::uint8_t>& rgba,
           std::array<std::uint8_t, 32>& commitment,
           std::array<float, KEYXYM_V26_POSE_FLOATS>& pose) {
    return keyxym_v26_ingest_rgba_packed(
        session, timestamp, 640U, 480U,
        520.0F, 520.0F, 320.0F, 240.0F,
        1.0F, 0U, rgba.data(), rgba.size(),
        commitment.data(), commitment.size(), pose.data(), pose.size());
}
} // namespace

int main() {
    keyxym_v26_session* session = nullptr;
    assert(keyxym_v26_session_create(
        "v026-browser", 0.02F, 48'000U, 320U, 240U, 384U, 8192U,
        &session) == KEYXYM_V26_OK);
    assert(session != nullptr);

    auto first = textured(640U, 480U, 0);
    auto second = textured(640U, 480U, 8);
    std::array<std::uint8_t, 32> first_commitment{};
    std::array<std::uint8_t, 32> second_commitment{};
    first_commitment[0] = 1U;
    second_commitment[0] = 2U;
    std::array<float, KEYXYM_V26_POSE_FLOATS> pose{};

    assert(ingest(session, 1'000'000, first, first_commitment, pose) == KEYXYM_V26_OK);
    assert(pose[23] == 1.0F);
    assert(pose[24] == 1.0F);

    std::size_t preview_required = 0U;
    assert(keyxym_v26_copy_preview_packed(
        session, nullptr, 0U, &preview_required) == KEYXYM_V26_BUFFER_TOO_SMALL);
    assert(preview_required != 0U);
    assert(preview_required % KEYXYM_V26_PREVIEW_FLOATS == 0U);
    std::vector<float> preview(preview_required);
    assert(keyxym_v26_copy_preview_packed(
        session, preview.data(), preview.size(), &preview_required) == KEYXYM_V26_OK);

    std::size_t receipt_required = 0U;
    assert(keyxym_v26_copy_receipts(
        session, nullptr, 0U, &receipt_required) == KEYXYM_V26_BUFFER_TOO_SMALL);
    assert(receipt_required == KEYXYM_V26_RECEIPT_BYTES);
    std::array<std::uint8_t, KEYXYM_V26_RECEIPT_BYTES> receipts{};
    assert(keyxym_v26_copy_receipts(
        session, receipts.data(), receipts.size(), &receipt_required) == KEYXYM_V26_OK);
    for (std::size_t offset = 0U; offset < receipts.size(); offset += 32U) {
        assert(std::any_of(receipts.begin() + static_cast<std::ptrdiff_t>(offset),
                           receipts.begin() + static_cast<std::ptrdiff_t>(offset + 32U),
                           [](std::uint8_t value) { return value != 0U; }));
    }

    std::array<float, KEYXYM_V26_QUALITY_FLOATS> quality{};
    std::array<float, KEYXYM_V26_AUTHORITY_FLOATS> authority{};
    assert(keyxym_v26_quality_packed(session, quality.data(), quality.size()) == KEYXYM_V26_OK);
    assert(keyxym_v26_authority_packed(session, authority.data(), authority.size()) == KEYXYM_V26_OK);
    assert(authority[5] == 0.0F);
    assert(authority[6] == 0.0F);

    assert(ingest(session, 2'000'000, second, second_commitment, pose) == KEYXYM_V26_OK);
    assert(ingest(session, 2'000'000, second, second_commitment, pose) == KEYXYM_V26_INVALID_ARGUMENT);

    std::size_t geometry_required = 0U;
    std::uint64_t revision = 0U;
    const int probe = keyxym_v26_copy_geometry_snapshot_packed(
        session, nullptr, 0U, &geometry_required, &revision);
    assert(probe == KEYXYM_V26_OK || probe == KEYXYM_V26_BUFFER_TOO_SMALL);
    assert(geometry_required % KEYXYM_V26_GEOMETRY_FLOATS == 0U);
    if (geometry_required != 0U) {
        std::vector<float> geometry(geometry_required);
        assert(keyxym_v26_copy_geometry_snapshot_packed(
            session, geometry.data(), geometry.size(), &geometry_required,
            &revision) == KEYXYM_V26_OK);
    }

    assert(keyxym_v26_ingest_rgba_packed(
        session, 3'000'000, 640U, 480U,
        520.0F, 520.0F, 320.0F, 240.0F,
        1.0F, 0U, second.data(), second.size(),
        second_commitment.data(), 31U, pose.data(), pose.size()) ==
        KEYXYM_V26_INVALID_ARGUMENT);

    keyxym_v26_session_destroy(session);
    return 0;
}
