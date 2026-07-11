#!/usr/bin/env bash
set -euo pipefail

readonly RGB_NAME="image_lcam_front.zip"
readonly DEPTH_NAME="depth_lcam_front.zip"
readonly REVISION="0d2d145e973832742a2aaa04b7d2ebffc8d82817"
readonly RGB_URL="https://huggingface.co/datasets/theairlabcmu/tartanair2/resolve/${REVISION}/ArchVizTinyHouseDay/Data_easy/${RGB_NAME}"
readonly DEPTH_URL="https://huggingface.co/datasets/theairlabcmu/tartanair2/resolve/${REVISION}/ArchVizTinyHouseDay/Data_easy/${DEPTH_NAME}"
readonly RGB_SHA="9bea5fca9d0cf50105c7d34583d4d5db06e3715ef708262b4dfad763d34b17da"
readonly DEPTH_SHA="83e6e680297af35aa83d594ea3ed254bf71e9d9da7b26fee6d0ccb29f25ac104"
readonly EXPECTED="apps/viewer-web/public/world/archviz-tiny-house-locus.json"

if [[ -n "${TESSARYN_REPRO_DIR:-}" ]]; then
  work="${TESSARYN_REPRO_DIR}"
  mkdir -p "${work}"
  cleanup=false
else
  work="$(mktemp -d /var/tmp/tessaryn-tartanair.XXXXXX)"
  cleanup=true
fi
if [[ "${cleanup}" == true ]]; then
  trap 'rm -rf "${work}"' EXIT
fi

download() {
  local url="$1"
  local output="$2"
  if [[ ! -f "${output}" ]]; then
    curl --fail --location --retry 4 --retry-delay 2 --output "${output}" "${url}"
  fi
}

download "${RGB_URL}" "${work}/${RGB_NAME}"
download "${DEPTH_URL}" "${work}/${DEPTH_NAME}"

printf '%s  %s\n' "${RGB_SHA}" "${work}/${RGB_NAME}" | sha256sum --check --status
printf '%s  %s\n' "${DEPTH_SHA}" "${work}/${DEPTH_NAME}" | sha256sum --check --status

generated="${work}/archviz-tiny-house-locus.json"
cargo run --locked -q -p tessaryn-cli -- \
  construct-tartanair-locus "${work}" "${generated}" 12
cargo run --locked -q -p tessaryn-cli -- verify-validation-locus "${generated}" >/dev/null
cmp --silent "${EXPECTED}" "${generated}"

echo "TARTANAIR VALIDATION ORIGIN REPRODUCED: ${EXPECTED}"
