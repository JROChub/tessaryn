#!/usr/bin/env bash
set -euo pipefail

output="${1:-/tmp/tessaryn-logo-mansion-material.mp4}"
mkdir -p "$(dirname "$output")"

# The committed film is intentionally low-entropy: the Three.js mansion provides
# geometry, logo color, and temporal motion. This deterministic tonal field is
# decoded only as an internal material source, never as a visible video surface.
ffmpeg -hide_banner -loglevel warning -y \
  -f lavfi -i "color=c=0x101511:s=1280x720:r=24:d=12" \
  -t 12 \
  -an \
  -c:v libx264 \
  -preset veryslow \
  -crf 40 \
  -profile:v high \
  -level:v 4.1 \
  -g 288 \
  -keyint_min 288 \
  -sc_threshold 0 \
  -movflags +faststart \
  "$output"

ffprobe -v error \
  -select_streams v:0 \
  -show_entries stream=codec_name,profile,width,height,avg_frame_rate \
  -show_entries format=duration,size \
  -of json \
  "$output"
