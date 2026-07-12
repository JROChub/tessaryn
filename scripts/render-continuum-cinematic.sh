#!/usr/bin/env bash
set -euo pipefail

output="${1:-/tmp/tessaryn-continuum-material.mp4}"
mkdir -p "$(dirname "$output")"

filter_graph="[0:v]format=rgb24,
lutrgb=r='val*0.78':g='val*0.88':b='val*0.69',
curves=all='0/0 0.24/0.11 0.62/0.58 1/1'[p];
[1:v]format=rgb24,eq=saturation=1.06:contrast=1.04[g];
[2:v]format=rgb24,
colorchannelmixer=rr=0.72:rg=0.18:rb=0.10:gr=0.18:gg=0.68:gb=0.14:br=0.08:bg=0.38:bb=0.54,
eq=contrast=1.18:brightness=-0.08[m];
[p][g]blend=all_mode=softlight:all_opacity=0.78[pg];
[pg][m]blend=all_mode=screen:all_opacity=0.24,
eq=contrast=1.1:saturation=1.02:brightness=-0.01,
vignette=PI/10:eval=frame,format=yuv420p[out]"

ffmpeg -hide_banner -loglevel warning -y \
  -f lavfi -i "perlin=s=2560x1440:r=30:octaves=7:persistence=0.5:xscale=1.6:yscale=1.1:tscale=0.028:random_mode=seed:seed=5377470" \
  -f lavfi -i "gradients=s=2560x1440:r=30:c0=0x10130e:c1=0x76543f:c2=0x7f936f:c3=0xd6c59a:c4=0x3e7772:c5=0x9a6b4d:n=6:type=spiral:speed=0.009:duration=12" \
  -f lavfi -i "mandelbrot=s=2560x1440:r=30:maxiter=900:start_x=-0.743644:start_y=-0.131826:start_scale=2.8:end_scale=0.34:end_pts=360:morphxf=0.004:morphyf=0.006:morphamp=0.02" \
  -filter_complex "$filter_graph" \
  -map "[out]" \
  -t 12 \
  -an \
  -c:v libx264 \
  -preset slow \
  -crf 16 \
  -profile:v high \
  -level:v 5.1 \
  -g 60 \
  -keyint_min 30 \
  -movflags +faststart \
  "$output"

ffprobe -v error \
  -select_streams v:0 \
  -show_entries stream=codec_name,profile,width,height,avg_frame_rate \
  -show_entries format=duration,size \
  -of json \
  "$output"
