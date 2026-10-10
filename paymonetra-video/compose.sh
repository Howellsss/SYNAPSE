#!/usr/bin/env bash
# Joins the AI character opener (assets/character.mp4) with the code-built teaser.
# Output: out/PayMonetra_15s_1920x1080.mp4
set -euo pipefail
cd "$(dirname "$0")"
CHAR=${1:-assets/character.mp4}
TEASER=out/PayMonetra_Teaser_10s_1920x1080.mp4
OUT=out/PayMonetra_15s_1920x1080.mp4
XF=0.5  # crossfade length (s)

CD=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$CHAR")
OFF=$(python3 -c "print(round($CD - $XF, 3))")

ffmpeg -y -hide_banner -loglevel error -i "$CHAR" -i "$TEASER" -filter_complex "
  [0:v]scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos,crop=1920:1080,
       unsharp=5:5:0.6,fps=30,format=yuv420p,setsar=1[cv];
  [1:v]fps=30,format=yuv420p,setsar=1[tv];
  [cv][tv]xfade=transition=fade:duration=$XF:offset=$OFF[v];
  [0:a]aresample=48000,aformat=channel_layouts=stereo[ca];
  [1:a]aresample=48000,aformat=channel_layouts=stereo[ta];
  [ca][ta]acrossfade=d=$XF:c1=tri:c2=tri,loudnorm=I=-16:TP=-1.5:LRA=11[a]" \
  -map "[v]" -map "[a]" -c:v libx264 -preset slow -crf 16 -c:a aac -b:a 192k -ar 48000 \
  -movflags +faststart "$OUT"
ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT"
echo "wrote $OUT"
