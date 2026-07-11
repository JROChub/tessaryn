#!/usr/bin/env bash
set -euo pipefail

readonly ARCHIVE_NAME="rgbd_dataset_freiburg1_desk.tgz"
readonly ARCHIVE_URL="https://cvg.cit.tum.de/rgbd/dataset/freiburg1/${ARCHIVE_NAME}"
readonly ARCHIVE_SHA256="e983d6830916e66dc4a46a71368046b149b283de87769690e7aa4e0b9483530c"
readonly EXPECTED="apps/viewer-web/public/world/freiburg-desk-locus.json"

work="${1:-$(mktemp -d)}"
mkdir -p "${work}"
archive="${work}/${ARCHIVE_NAME}"
generated="${work}/freiburg-desk-locus.json"

if [[ ! -f "${archive}" ]]; then
  curl --fail --location --retry 3 --output "${archive}" "${ARCHIVE_URL}"
fi
printf '%s  %s\n' "${ARCHIVE_SHA256}" "${archive}" | sha256sum --check --status

if [[ ! -d "${work}/rgbd_dataset_freiburg1_desk" ]]; then
  tar --extract --gzip --file "${archive}" --directory "${work}"
fi

cargo run --locked -q -p tessaryn-cli -- construct-tum-locus \
  "${work}/rgbd_dataset_freiburg1_desk" "${generated}" 12
cmp "${EXPECTED}" "${generated}"
cargo run --locked -q -p tessaryn-cli -- verify-temporal-locus "${generated}"
printf 'real Origin reproduction PASS: %s\n' "${generated}"
