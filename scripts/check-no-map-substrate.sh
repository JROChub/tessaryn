#!/usr/bin/env sh
set -eu

forbidden='mapbox|maplibre|leaflet|openlayers|cesium|google[-_ ]?maps|street[-_ ]?view|bing[-_ ]?maps|arcgis|here[-_ ]?maps'
files=$(find Cargo.toml Cargo.lock crates tools apps fuzz -type f \
  ! -path '*/node_modules/*' ! -path '*/dist/*' \
  \( -name 'Cargo.toml' -o -name 'Cargo.lock' -o -name 'package.json' -o -name 'package-lock.json' -o -name '*.ts' -o -name '*.js' \))

if printf '%s\n' "$files" | xargs grep -Ein "$forbidden"; then
  echo "forbidden map substrate dependency or runtime reference found" >&2
  exit 1
fi

echo "no forbidden map substrate dependency or runtime reference found"
