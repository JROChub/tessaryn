#pragma once
#include <array>
#include <chrono>
#include <cstdint>
#include <string>
#include <vector>
namespace keyxym {
using Byte=std::uint8_t; using Hash256=std::array<Byte,32>; using Signature=std::array<Byte,64>;
using Timestamp=std::chrono::time_point<std::chrono::system_clock,std::chrono::nanoseconds>;
struct Surfel { float x{},y{},z{},nx{},ny{},nz{},r{},g{},b{},confidence{}; std::uint64_t timestamp_offset{}; };
struct Moment { Timestamp start_time{},end_time{}; std::vector<Surfel> surfels; Hash256 moment_hash{}; };
std::string hex(const Hash256&); bool from_hex(const std::string&, Hash256&);
}