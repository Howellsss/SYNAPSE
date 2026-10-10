#!/usr/bin/env bash
# Code-built teaser -> AI character (two takes) -> code-built outro
# -> out/PayMonetra_30s_1920x1080.mp4
# Needs: out/PayMonetra_Teaser_10s_1920x1080.mp4, out/PayMonetra_Outro_10s_1920x1080.mp4,
#        assets/char1.mp4, assets/char2.mp4 (Higgsfield Wan 3.0, 854x480).
set -euo pipefail
cd "$(dirname "$0")"
T=out/PayMonetra_Teaser_10s_1920x1080.mp4; O=out/PayMonetra_Outro_10s_1920x1080.mp4
C1=assets/char1.mp4; C2=assets/char2.mp4
OUT=out/PayMonetra_30s_1920x1080.mp4
X=0.5  # teaser -> character crossfade (s); the outro opens on a full-frame orange wipe, so it hard-cuts in
DT=$(ffprobe -v error -show_entries format=duration -of csv=p=0 $T)
OFF=$(python3 -c "print(round($DT-$X,3))")
UP="scale=1920:1080:flags=lanczos,unsharp=5:5:0.7:5:5:0.0,fps=30,format=yuv420p,setsar=1,settb=AVTB"
# Take 2 is pushed in ~8% so the cut between the two takes reads as a camera change.
PUNCH="scale=2074:1166:flags=lanczos,crop=1920:1080,unsharp=5:5:0.7:5:5:0.0,fps=30,format=yuv420p,setsar=1,settb=AVTB"
NORM="fps=30,format=yuv420p,setsar=1,settb=AVTB"
AUD="aresample=48000,aformat=channel_layouts=stereo"
ffmpeg -y -hide_banner -loglevel error -i $T -i $C1 -i $C2 -i $O -filter_complex "
 [0:v]$NORM[t];[1:v]$UP[c1];[2:v]$PUNCH[c2];[3:v]$NORM[o];
 [t][c1]xfade=transition=fade:duration=$X:offset=$OFF[s1x];[s1x]settb=AVTB[s1];
 [0:a]$AUD[ta];[1:a]$AUD,afade=t=out:st=4.99:d=0.04[c1a];[2:a]$AUD,afade=t=in:d=0.02,afade=t=out:st=4.99:d=0.04[c2a];[3:a]$AUD,afade=t=in:d=0.02[oa];
 [ta][c1a]acrossfade=d=$X[s1a];
 [s1][s1a][c2][c2a][o][oa]concat=n=3:v=1:a=1[v][am];
 [am]loudnorm=I=-16:TP=-1.5:LRA=11,volume=2dB,alimiter=limit=0.85[a]" \
 -map "[v]" -map "[a]" -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -c:a aac -b:a 192k -ar 48000 \
 -movflags +faststart $OUT
ffprobe -v error -show_entries format=duration -of csv=p=0 $OUT
