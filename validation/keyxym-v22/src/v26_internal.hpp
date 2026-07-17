#pragma once

#include "keyxym/v26.hpp"

namespace keyxym::v26_detail {
Hash256 pose_receipt(const RealityPoseEstimate&, const MetricFrame&, const MetricFrame&);
MetricReconstructionQuality assess_quality(const RealityPoseEstimate&, const std::vector<MetricSurfel>&, std::uint64_t, bool);
void fuse(std::vector<MetricSurfel>&, const std::vector<MetricSurfel>&, float, std::size_t);
std::vector<MetricSurfel> confirmed_geometry(const std::vector<MetricSurfel>&);
} // namespace keyxym::v26_detail
