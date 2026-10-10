"""Reframe take 2 of the character so it continues seamlessly from the end of take 1.

The generator starts every take on a wide shot and pushes in, so take 1 ends on a close-up
while take 2 opens wide: her face jumps ~35% smaller at the cut. This tracks her face in
take 2 and zooms each frame so the face keeps the size and position it had at the end of
take 1, with a gentle push-in continuing through the take. The warp goes straight from the
source to 1920x1080 (one resample) and keeps take 2's audio untouched, so lip sync is kept.

Usage: python3 match_take.py assets/char1.mp4 assets/char2.mp4 assets/char2_matched.mp4
"""
import subprocess
import sys

import cv2
import numpy as np

OUT_W, OUT_H = 1920, 1080
PUSH = 0.05  # extra face growth over the take, so the camera keeps easing in like take 1 did

casc = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')


def face(frame):
    f = casc.detectMultiScale(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), 1.05, 5, minSize=(30, 30))
    if not len(f):
        return None
    x, y, w, h = max(f, key=lambda r: r[2] * r[3])
    return np.array([x + w / 2, y + h / 2, w], dtype=float)


def read_frames(path):
    cap = cv2.VideoCapture(path)
    frames = []
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        frames.append(fr)
    return frames, cap.get(cv2.CAP_PROP_FPS)


def smooth_track(raw):
    """Fill misses, reject outlier detections, then smooth (cx, cy, w) over time."""
    track = np.array([r if r is not None else [np.nan] * 3 for r in raw])
    med = np.array([np.nanmedian(track[max(0, i - 7):i + 8], axis=0) for i in range(len(track))])
    bad = np.isnan(track).any(axis=1) | (np.abs(track[:, 2] - med[:, 2]) > 0.15 * med[:, 2])
    track[bad] = med[bad]
    k = np.exp(-0.5 * (np.arange(-6, 7) / 3.0) ** 2)
    k /= k.sum()
    pad = np.pad(track, ((6, 6), (0, 0)), mode='edge')
    return np.stack([np.convolve(pad[:, j], k, mode='valid') for j in range(3)], axis=1)


def main(take1, take2, out):
    f1, _ = read_frames(take1)
    tail = [face(fr) for fr in f1[-6:]]
    ref = np.mean([t for t in tail if t is not None], axis=0)  # where take 1 leaves her face

    f2, fps = read_frames(take2)
    h, w = f2[0].shape[:2]
    track = smooth_track([face(fr) for fr in f2])
    n = len(f2)
    up = OUT_W / w  # source -> output scale

    enc = subprocess.Popen([
        'ffmpeg', '-y', '-loglevel', 'error',
        '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{OUT_W}x{OUT_H}', '-r', str(fps), '-i', '-',
        '-i', take2, '-map', '0:v', '-map', '1:a', '-c:a', 'copy',
        '-vf', 'unsharp=5:5:0.6:5:5:0.0', '-c:v', 'libx264', '-preset', 'slow', '-crf', '14',
        '-pix_fmt', 'yuv420p', '-shortest', out,
    ], stdin=subprocess.PIPE)

    for i, fr in enumerate(f2):
        cx, cy, fw = track[i]
        target_w = ref[2] * (1 + PUSH * i / (n - 1))
        z = max(1.0, target_w / fw)
        # Place the tracked face centre where take 1 left it, then clamp so the frame stays covered.
        tx = ref[0] - z * cx
        ty = ref[1] - z * cy
        tx = min(0.0, max(w - z * w, tx))
        ty = min(0.0, max(h - z * h, ty))
        m = np.array([[z * up, 0, tx * up], [0, z * up, ty * up]])
        enc.stdin.write(cv2.warpAffine(fr, m, (OUT_W, OUT_H), flags=cv2.INTER_LANCZOS4).tobytes())
        if i in (0, n // 2, n - 1):
            print(f'frame {i}: face {fw:.0f}px -> zoom {z:.2f}')
    enc.stdin.close()
    enc.wait()
    print('wrote', out)


if __name__ == '__main__':
    main(*sys.argv[1:4])
