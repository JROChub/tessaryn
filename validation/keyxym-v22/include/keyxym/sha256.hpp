#pragma once
#include "types.hpp"
#include <cstddef>
namespace keyxym { Hash256 sha256(const Byte* data,std::size_t size); inline Hash256 sha256(const std::vector<Byte>& v){return sha256(v.data(),v.size());} Hash256 sha256(const std::string& s); }
