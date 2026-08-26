#pragma once
#include "provenance.hpp"
namespace keyxym {
class WorldCell { public: std::string id; std::vector<Surfel> base_geometry; std::vector<Moment> temporal_moments; Provenance provenance; Hash256 pha{},memory_capsule{},parent_rootprint{}; Hash256 compute_rootprint() const; void seal(const SignatureProvider&,const std::vector<Byte>& private_key); bool verify(const SignatureProvider&,const std::vector<Byte>& public_key) const; };
}
