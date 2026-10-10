#!/usr/bin/env bash
# Code-built teaser -> AI character (two takes) -> code-built outro
# -> out/PayMonetra_30s_1920x1080.mp4
# Needs: out/PayMonetra_Teaser_10s_1920x1080.mp4, out/PayMonetra_Outro_10s_1920x1080.mp4,
#        assets/char1.mp4 (Higgsfield Wan 3.0, 854x480) and assets/char2_matched.mp4
#        (take 2 reframed by match_take.py to continue take 1's close-up).
set -euo pipefail
cd "$(dirname "$0")"
T=out/PayMonetra_Teaser_10s_1920x1080.mp4; O=out/PayMonetra_Outro_10s_1920x1080.mp4
C1=assets/char1.mp4; C2=assets/char2_matched.mp4
OUT=out/PayMonetra_30s_1920x1080.mp4
X=0.5   # teaser -> character crossfade (s); the outro opens on a full-frame orange wipe, so it hard-cuts in
XC=0.25 # take 1 -> take 2 blend; framing is matched, so a short dissolve hides the join
DT=$(ffprobe -v error -show_entries format=duration -of csv=p=0 $T)
D1=$(ffprobe -v error -show_entries format=duration -of csv=p=0 $C1)
OFF=$(python3 -c "print(round($DT-$X,3))")
OFF2=$(python3 -c "print(round($DT-$X+$D1-$XC,3))")
UP="scale=1920:1080:flags=lanczos,unsharp=5:5:0.7:5:5:0.0,fps=30,format=yuv420p,setsar=1,settb=AVTB"
NORM="fps=30,format=yuv420p,setsar=1,settb=AVTB"
AUD="aresample=48000,aformat=channel_layouts=stereo"
# Level each section on its own (static gain, measured): her two takes come out of the generator
# ~7 dB apart, and a single loudnorm over the whole mix rides the gain instead of fixing that.
# Voice sits at -15 LUFS; the music-only sections sit just under it at -17 LUFS.
lufs() { ffmpeg -hide_banner -i "$1" -af ebur128 -f null - 2>&1 | awk '/^ +I:/{v=$2} END{print v}'; }
gain() { python3 -c "print(round($2 - ($(lufs "$1")), 2))"; }
GT=$(gain $T -17); GC1=$(gain $C1 -15); GC2=$(gain $C2 -15); GO=$(gain $O -17)
echo "section gains (dB): teaser $GT, take1 $GC1, take2 $GC2, outro $GO"
ffmpeg -y -hide_banner -loglevel error -i $T -i $C1 -i $C2 -i $O -filter_complex "
 [0:v]$NORM[t];[1:v]$UP[c1];[2:v]$NORM[c2];[3:v]$NORM[o];
 [t][c1]xfade=transition=fade:duration=$X:offset=$OFF[s1x];[s1x]settb=AVTB[s1];
 [s1][c2]xfade=transition=fade:duration=$XC:offset=$OFF2[s2x];[s2x]settb=AVTB[s2];
 [0:a]$AUD,volume=${GT}dB[ta];[1:a]$AUD,volume=${GC1}dB[c1a];[2:a]$AUD,volume=${GC2}dB,afade=t=out:st=4.99:d=0.04[c2a];[3:a]$AUD,volume=${GO}dB,afade=t=in:d=0.02[oa];
 [ta][c1a]acrossfade=d=$X[s1a];[s1a][c2a]acrossfade=d=$XC:c1=tri:c2=nofa[s2a];
 [s2][s2a][o][oa]concat=n=2:v=1:a=1[v][am];
 [am]alimiter=limit=0.89:level=false[a]" \
 -map "[v]" -map "[a]" -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -c:a aac -b:a 192k -ar 48000 \
 -movflags +faststart $OUT
ffprobe -v error -show_entries format=duration -of csv=p=0 $OUT
