#pragma once
#include "types.hpp"
namespace keyxym {
struct Provenance { Hash256 content_hash{},manifest_hash{},rootprint{}; Signature creator_signature{}; Timestamp creation_time{}; std::uint64_t version{1}; };
Hash256 compute_merkle_root(const std::vector<Hash256>& leaves);
class SignatureProvider { public: virtual ~SignatureProvider()=default; virtual Signature sign(const Hash256&,const std::vector<Byte>& private_key) const=0; virtual bool verify(const Hash256&,const Signature&,const std::vector<Byte>& public_key) const=0; virtual const char* name() const noexcept=0; };
}
