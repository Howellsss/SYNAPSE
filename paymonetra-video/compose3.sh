#!/usr/bin/env bash
# Character part 1 + part 2 (hard cut with a punch-in) + code-built teaser
# -> out/PayMonetra_20s_1920x1080.mp4
# Inputs: assets/char1.mp4, assets/char2.mp4 (Higgsfield Wan 3.0, 854x480) and the rendered teaser.
set -euo pipefail
cd "$(dirname "$0")"
C1=assets/char1.mp4; C2=assets/char2.mp4; T=out/PayMonetra_Teaser_10s_1920x1080.mp4
OUT=out/PayMonetra_20s_1920x1080.mp4
X2=0.5  # crossfade into the teaser (s)
D1=$(ffprobe -v error -show_entries format=duration -of csv=p=0 $C1)
D2=$(ffprobe -v error -show_entries format=duration -of csv=p=0 $C2)
O2=$(python3 -c "print(round($D1+$D2-$X2,3))")
UP="scale=1920:1080:flags=lanczos,unsharp=5:5:0.7:5:5:0.0,fps=30,format=yuv420p,setsar=1"
# Part 2 is pushed in ~8% so the cut between the two takes reads as a camera change.
PUNCH="scale=2074:1166:flags=lanczos,crop=1920:1080,unsharp=5:5:0.7:5:5:0.0,fps=30,format=yuv420p,setsar=1"
ffmpeg -y -hide_banner -loglevel error -i $C1 -i $C2 -i $T -filter_complex "
 [0:v]$UP[a];[1:v]$PUNCH[b];[2:v]fps=30,format=yuv420p,setsar=1,settb=AVTB[c];
 [0:a]aresample=48000,aformat=channel_layouts=stereo,afade=t=out:st=$(python3 -c "print($D1-0.02)"):d=0.02[a0];
 [1:a]aresample=48000,aformat=channel_layouts=stereo,afade=t=in:d=0.02[a1];
 [2:a]aresample=48000,aformat=channel_layouts=stereo[a2];
 [a][a0][b][a1]concat=n=2:v=1:a=1[abx][a01];[abx]settb=AVTB[ab];
 [ab][c]xfade=transition=fade:duration=$X2:offset=$O2[v];
 [a01][a2]acrossfade=d=$X2,loudnorm=I=-16:TP=-1.5:LRA=11,volume=2.6dB[aout]" \
 -map "[v]" -map "[aout]" -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -c:a aac -b:a 192k -ar 48000 \
 -movflags +faststart $OUT
ffprobe -v error -show_entries format=duration -of csv=p=0 $OUT
