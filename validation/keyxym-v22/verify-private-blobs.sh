#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")" && pwd)"
check() {
  local path="$1"
  local expected="$2"
  local actual
  actual="$(git hash-object "$root/$path")"
  if [[ "$actual" != "$expected" ]]; then
    printf 'blob mismatch %s expected=%s actual=%s\n' "$path" "$expected" "$actual" >&2
    return 1
  fi
}
check include/keyxym/types.hpp 3aca10a2cfd7bccf8e729ca8b8acb59141bc1baa
check include/keyxym/provenance.hpp 7b6eea80713e3aeae2b80f6a130e88d5998db1de
check include/keyxym/world_cell.hpp 3bb2fd866c58e07632cb92a051b8d7b40a7e8156
check include/keyxym/reconstruction.hpp 0cf15b1210282981841af1563002d02c297d6d4d
check include/keyxym/v20.hpp 8b447362942946951106b742649b7aa00cef6caf
check include/keyxym/v21.hpp 05f1b336750285f63199628694dd5830871aa678
check include/keyxym/v22.hpp 6cfd6a7eaae8ce8e432d537599d58fa3bdeea093
check include/keyxym/sha256.hpp f3e9131f49ba33521980a25d4926f356884e8d56
check include/keyxym/v22_c_api.h 8037b2bf443aa3ce68311d630504232a479c2da8
check include/keyxym/v22_browser_frontend.hpp 0827508d7b604262ff0343efb42c4e754b11949f
check include/keyxym/v22_browser_runtime.h f506af5745374160eeb17143e75e99478b092305
check src/sha256.cpp 82d451286d40c02cf6dcdc729a406fef95c74f59
check src/v20.cpp 92af5c1f457aa3dc42a57900468a488ced27c3d6
check src/v22.cpp 8567979c5155846ac5c062625e2458a654e4624b
check src/v22_c_api.cpp 6a173209ada0606b4aea0fa729bc01a6ec20d10b
check src/v22_browser_frontend.cpp 5b1dafd35fc73d480a7e4840899f5975355a21c2
check src/v22_browser_runtime.cpp 7dbfa78a120e8c6d4c90108e7e298bae95d3dee2
check tests/test_v022_browser_frontend.cpp 5ac11a04c68bd0924ff5e27064d7bd33d3f3e9e0
check tests/test_v022_browser_runtime.cpp 3550a35b3fe631c85a0d79f2944ae703b142c49d
printf 'keyxym_private_blobs=exact\n'
