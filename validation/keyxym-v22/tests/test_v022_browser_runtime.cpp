#include "keyxym/v22_browser_runtime.h"

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

int packed_ingest(keyxym_v22_session* session,
                  std::int64_t timestamp,
                  std::vector<std::uint8_t>& rgba,
                  std::array<std::uint8_t, 32>& commitment,
                  std::array<float, KEYXYM_V22_PACKED_POSE_FLOATS>& pose) {
    return keyxym_v22_browser_ingest_rgba_packed(
        session,
        timestamp,
        640U,
        480U,
        520.0F,
        520.0F,
        320.0F,
        240.0F,
        1.0F,
        0U,
        rgba.data(),
        rgba.size(),
        commitment.data(),
        commitment.size(),
        pose.data(),
        pose.size());
}
} // namespace

int main() {
    keyxym_v22_session* session = nullptr;
    assert(keyxym_v22_browser_session_create(
               "browser-consensus", 0.02F, 48000U,
               160U, 120U, 256U, 2048U, &session) == KEYXYM_V22_OK);
    assert(session != nullptr);

    auto a = textured(640U, 480U, 0);
    auto b = textured(640U, 480U, 8);
    auto c = textured(640U, 480U, 16);
    std::array<std::uint8_t, 32> ca{}, cb{}, cc{};
    ca[0] = 1U;
    cb[0] = 2U;
    cc[0] = 3U;

    std::array<float, KEYXYM_V22_PACKED_POSE_FLOATS> pose{};
    assert(packed_ingest(session, 1'000'000, a, ca, pose) == KEYXYM_V22_OK);
    assert(keyxym_v22_browser_geometry_revision(session) == 1U);

    size_t preview_required = 0U;
    assert(keyxym_v22_browser_copy_preview_packed(
               session, nullptr, 0U, &preview_required) == KEYXYM_V22_BUFFER_TOO_SMALL);
    assert(preview_required != 0U);
    assert(preview_required % KEYXYM_V22_BROWSER_PREVIEW_FLOATS == 0U);
    std::vector<float> preview(preview_required);
    assert(keyxym_v22_browser_copy_preview_packed(
               session, preview.data(), preview.size(), &preview_required) == KEYXYM_V22_OK);

    assert(packed_ingest(session, 2'000'000, b, cb, pose) == KEYXYM_V22_OK);
    assert(packed_ingest(session, 3'000'000, c, cc, pose) == KEYXYM_V22_OK);
    assert(pose[16] >= 12.0F);
    assert(pose[17] >= 10.0F);
    assert(pose[21] == 1.0F);

    size_t receipt_required = 0U;
    assert(keyxym_v22_browser_copy_receipts(
               session, nullptr, 0U, &receipt_required) == KEYXYM_V22_BUFFER_TOO_SMALL);
    assert(receipt_required == KEYXYM_V22_BROWSER_RECEIPT_BYTES);
    std::array<std::uint8_t, KEYXYM_V22_BROWSER_RECEIPT_BYTES> receipts{};
    assert(keyxym_v22_browser_copy_receipts(
               session, receipts.data(), receipts.size(), &receipt_required) == KEYXYM_V22_OK);
    assert(std::any_of(receipts.begin(), receipts.begin() + 32,
                       [](std::uint8_t value) { return value != 0U; }));
    assert(std::any_of(receipts.begin() + 32, receipts.end(),
                       [](std::uint8_t value) { return value != 0U; }));

    const std::uint64_t revision = keyxym_v22_browser_geometry_revision(session);
    assert(revision == 3U);
    size_t geometry_required = 0U;
    std::uint64_t snapshot_revision = 0U;
    const int probe = keyxym_v22_browser_copy_geometry_snapshot_packed(
        session, nullptr, 0U, &geometry_required, &snapshot_revision);
    assert(probe == KEYXYM_V22_BUFFER_TOO_SMALL || probe == KEYXYM_V22_OK);
    assert(snapshot_revision == revision);
    assert(geometry_required % KEYXYM_V22_BROWSER_GEOMETRY_FLOATS == 0U);
    assert(geometry_required != 0U);
    std::vector<float> geometry(geometry_required);
    assert(keyxym_v22_browser_copy_geometry_snapshot_packed(
               session, geometry.data(), geometry.size(),
               &geometry_required, &snapshot_revision) == KEYXYM_V22_OK);
    assert(snapshot_revision == revision);

    assert(packed_ingest(session, 3'000'000, c, cc, pose) == KEYXYM_V22_INVALID_ARGUMENT);
    assert(keyxym_v22_browser_ingest_rgba_packed(
               session, 4'000'000, 640U, 480U,
               520.0F, 520.0F, 320.0F, 240.0F,
               1.0F, 0U, c.data(), c.size(),
               cc.data(), 31U, pose.data(), pose.size()) == KEYXYM_V22_INVALID_ARGUMENT);

    keyxym_v22_browser_session_destroy(session);
    return 0;
}
