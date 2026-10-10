"""Reframe take 2 of the character so it follows on smoothly from take 1.

The generator starts every take on a wide shot and pushes in, so take 1 ends on a close-up
while take 2 opens wide. A face-following reframe matched the cut but shook with every head
movement and cropped her hair, so this uses a locked-off virtual camera instead: a smooth zoom
that starts at Z0 and eases out to the take's own framing, anchored near the top of the frame
so her full head stays in shot. Take 2's own (smooth) camera push carries on underneath.
The warp goes straight from the source to 1920x1080 (one resample); take 2's audio is copied.

Usage: python3 match_take.py assets/char2.mp4 assets/char2_matched.mp4
"""
import subprocess
import sys

import cv2
import numpy as np

OUT_W, OUT_H = 1920, 1080
Z0 = 1.25          # opening zoom: closer to take 1's close-up without cropping her hair
ANCHOR = (0.5, 0)  # zoom about the top-centre of the frame, so headroom is kept


def main(take2, out):
    cap = cv2.VideoCapture(take2)
    fps = cap.get(cv2.CAP_PROP_FPS)
    frames = []
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        frames.append(fr)
    h, w = frames[0].shape[:2]
    n = len(frames)
    up = OUT_W / w
    ax, ay = ANCHOR[0] * w, ANCHOR[1] * h

    enc = subprocess.Popen([
        'ffmpeg', '-y', '-loglevel', 'error',
        '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{OUT_W}x{OUT_H}', '-r', str(fps), '-i', '-',
        '-i', take2, '-map', '0:v', '-map', '1:a', '-c:a', 'copy',
        '-vf', 'unsharp=5:5:0.6:5:5:0.0', '-c:v', 'libx264', '-preset', 'slow', '-crf', '14',
        '-pix_fmt', 'yuv420p', '-shortest', out,
    ], stdin=subprocess.PIPE)

    for i, fr in enumerate(frames):
        u = i / (n - 1)
        ease = 0.5 - 0.5 * np.cos(np.pi * u)  # smooth start and finish, no jerks
        z = Z0 + (1.0 - Z0) * ease
        tx, ty = ax - z * ax, ay - z * ay
        m = np.array([[z * up, 0, tx * up], [0, z * up, ty * up]])
        enc.stdin.write(cv2.warpAffine(fr, m, (OUT_W, OUT_H), flags=cv2.INTER_LANCZOS4).tobytes())
        if i in (0, n // 2, n - 1):
            print(f'frame {i}: zoom {z:.3f}')
    enc.stdin.close()
    enc.wait()
    print('wrote', out)


if __name__ == '__main__':
    main(*sys.argv[1:3])
