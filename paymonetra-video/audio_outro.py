"""Synthesised sound bed for the 10s outro (no samples, so no licensing questions).

Cue times match src/outro.js. Writes out/outro-audio.wav (48 kHz stereo).
"""
import os
import wave
import numpy as np

SR = 48000
DUR = 10.0
N = int(SR * DUR)
t = np.arange(N) / SR
rng = np.random.default_rng(11)
L = np.zeros(N)
R = np.zeros(N)


def add(sig, start, gain=1.0, pan=0.0):
    i = int(start * SR)
    j = min(N, i + len(sig))
    if j <= i:
        return
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    L[i:j] += sig[: j - i] * gain * l * np.sqrt(2)
    R[i:j] += sig[: j - i] * gain * r * np.sqrt(2)


def lowpass(x, cutoff):
    cutoff = np.broadcast_to(np.asarray(cutoff, dtype=float), x.shape)
    a = 1 - np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for k in range(len(x)):
        acc += a[k] * (x[k] - acc)
        y[k] = acc
    return y


def tone(freq, length, decay, partials=((1, 1.0),)):
    tt = np.arange(int(length * SR)) / SR
    out = sum(amp * np.sin(2 * np.pi * freq * ratio * tt) * np.exp(-tt * decay * ratio ** 0.5) for ratio, amp in partials)
    return out * np.minimum(1, tt / 0.004)


def whoosh(length, peak_cut=3200):
    n = int(length * SR)
    tt = np.arange(n) / SR
    shape = np.sin(np.pi * np.clip(tt / length, 0, 1)) ** 2
    return lowpass(rng.standard_normal(n), 300 + peak_cut * shape) * shape


# --- Pad: brighter than the teaser's (C major add9), steady under the showcase ---
pad = np.zeros(N)
for f, amp in [(65.41, 0.5), (130.81, 0.35), (196.0, 0.28), (329.63, 0.2), (293.66, 0.14), (523.25, 0.08)]:
    for det in (-0.15, 0.15):
        pad += amp * np.sin(2 * np.pi * (f + det) * t + rng.uniform(0, 6.28))
pad *= np.interp(t, [0, 0.4, 9.0, 10.0], [0.6, 1.0, 1.0, 0]) * (1 + 0.06 * np.sin(2 * np.pi * 0.5 * t))
add(lowpass(pad, 2400), 0, 0.10)

# --- Driving pulse at 128 bpm through the feature section, lighter on the end card ---
beat = 60 / 128
for k, b in enumerate(np.arange(0.0, 9.4, beat / 2)):
    on_end_card = b >= 6.0
    if k % 2 == 0:
        kl = int(0.3 * SR)
        kt = np.arange(kl) / SR
        kick = np.sin(2 * np.pi * (50 + 95 * np.exp(-kt * 32)) * kt) * np.exp(-kt * 10)
        add(kick, b, (0.18 if on_end_card else 0.34) * (1 if b < 9.0 else 0.5))
    hl = int(0.05 * SR)
    hat = np.diff(rng.standard_normal(hl + 1)) * np.exp(-np.arange(hl) / SR * 80)
    add(hat, b + beat / 4, 0.03 if not on_end_card else 0.015, 0.3 if k % 2 else -0.3)

# --- Wipes ---
for b in (0.0, 1.5, 3.0, 4.5, 6.0):
    add(whoosh(0.5), max(0.0, b - 0.25), 0.45, -0.2)

# --- F0 transfer: coin swoosh then a two-note received ding ---
add(whoosh(0.7, 2200), 0.3, 0.25, 0.2)
add(tone(1318.5, 0.8, 7, ((1, 1.0), (2, 0.2))), 1.0, 0.07, 0.4)
add(tone(1760.0, 0.9, 6, ((1, 1.0), (2, 0.2))), 1.08, 0.06, 0.4)

# --- F1 crypto: three coin pops, then the Buy→Sell toggle click ---
for i in range(3):
    add(tone(880 * (1.26 ** i), 0.15, 30), 1.55 + i * 0.12, 0.06, -0.3 + 0.3 * i)
add(tone(2400, 0.04, 120), 2.45, 0.08, 0.3)

# --- F2 card: soft swish as the card turns in, approval chime ---
add(whoosh(0.8, 1800), 3.0, 0.3, 0.3)
add(tone(1046.5, 0.9, 6, ((1, 1.0), (2, 0.25))), 3.85, 0.07, 0.3)

# --- F3 bills: four tile pops, then the paid tick ---
for i in range(4):
    add(tone(660 + 110 * i, 0.12, 35), 4.55 + i * 0.1, 0.055, -0.3 + 0.2 * i)
add(tone(1568.0, 0.6, 9, ((1, 1.0), (2, 0.2))), 5.35, 0.07, 0.3)

# --- End card: sub swell + the teaser's two-note brand chime, resolved ---
sl = int(1.4 * SR)
st = np.arange(sl) / SR
add(np.sin(2 * np.pi * (46 + 30 * np.exp(-st * 15)) * st) * np.exp(-st * 3.5), 6.2, 0.45)
bell = ((1, 1.0), (2.0, 0.35), (2.76, 0.18), (5.4, 0.06))
add(tone(1046.5, 2.8, 1.8, bell), 6.25, 0.10, -0.15)
add(tone(1568.0, 2.8, 2.0, bell), 6.38, 0.08, 0.15)
add(tone(2093.0, 2.6, 2.2, bell), 6.51, 0.05, 0.0)

# --- Master ---
fade = np.interp(t, [0, 9.0, 10.0], [1, 1, 0])
L *= fade
R *= fade
peak = max(np.abs(L).max(), np.abs(R).max())
L, R = L / peak * 0.7, R / peak * 0.7
os.makedirs('out', exist_ok=True)
data = (np.stack([L, R], axis=1) * 32767).astype('<i2')
with wave.open('out/outro-audio.wav', 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(data.tobytes())
print('wrote out/outro-audio.wav')
