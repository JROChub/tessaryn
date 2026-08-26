#pragma once

#include "provenance.hpp"
#include "world_cell.hpp"

#include <cstdint>
#include <string>
#include <vector>

namespace keyxym {

inline constexpr std::uint32_t formal_world_cell_version = 20;

struct FormalLimits {
    std::uint64_t max_identifier_bytes{4096};
    std::uint64_t max_branch_bytes{1024};
    std::uint64_t max_surfels{50'000'000};
    std::uint64_t max_moments{1'000'000};
};

struct FormalMoment {
    std::string id;
    Timestamp start_time{};
    Timestamp end_time{};
    std::vector<Surfel> surfels;
    Hash256 parent_moment{};
    Hash256 evidence{};
    Hash256 rootprint{};
};

struct FormalWorldCell {
    std::string id;
    std::string branch{"main"};
    std::vector<Surfel> base_geometry;
    std::vector<FormalMoment> moments;
    Provenance provenance;
    Hash256 pha{};
    Hash256 memory_capsule{};
    Hash256 parent_rootprint{};

    [[nodiscard]] Hash256 compute_rootprint() const;
    void seal(const SignatureProvider& provider, const std::vector<Byte>& private_key);
    [[nodiscard]] bool verify(const SignatureProvider& provider,
                              const std::vector<Byte>& public_key) const;
};

struct FormalValidation {
    bool valid{false};
    std::string error;
};

[[nodiscard]] Hash256 compute_formal_moment_rootprint(const FormalMoment& moment);
[[nodiscard]] FormalValidation validate_formal_world_cell(
    const FormalWorldCell& cell, const FormalLimits& limits = {});
[[nodiscard]] std::vector<Byte> serialize_formal_world_cell(
    const FormalWorldCell& cell, const FormalLimits& limits = {});
[[nodiscard]] FormalWorldCell deserialize_formal_world_cell(
    const std::vector<Byte>& bytes, const FormalLimits& limits = {});
[[nodiscard]] FormalWorldCell migrate_world_cell_v2(const WorldCell& legacy,
                                                     std::string branch = "main");
[[nodiscard]] WorldCell export_world_cell_v2(const FormalWorldCell& cell);

} // namespace keyxym
