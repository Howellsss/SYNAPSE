"""Synthesised sound bed for the 10s teaser (no samples, so no licensing questions).

Cue times match src/teaser.js. Writes out/teaser-audio.wav (48 kHz stereo).
"""
import os
import wave
import numpy as np

SR = 48000
DUR = 10.0
N = int(SR * DUR)
t = np.arange(N) / SR
rng = np.random.default_rng(7)
L = np.zeros(N)
R = np.zeros(N)


def env_adsr(length, a, d, s, r, total):
    e = np.ones(length)
    ai, di, ri = int(a * SR), int(d * SR), int(r * SR)
    e[:ai] = np.linspace(0, 1, ai, endpoint=False) if ai else e[:ai]
    e[ai:ai + di] = np.linspace(1, s, di, endpoint=False) if di else e[ai:ai + di]
    e[ai + di:] = s
    hold = int(total * SR) - ri
    if 0 < hold < length:
        e[hold:hold + ri] *= np.linspace(1, 0, min(ri, length - hold))
        e[hold + ri:] = 0
    return e


def add(sig, start, gain=1.0, pan=0.0):
    i = int(start * SR)
    j = min(N, i + len(sig))
    if j <= i:
        return
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    L[i:j] += sig[: j - i] * gain * l * np.sqrt(2)
    R[i:j] += sig[: j - i] * gain * r * np.sqrt(2)


def lowpass(x, cutoff):
    """One-pole lowpass; cutoff may be a scalar or a per-sample array (Hz)."""
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
    attack = np.minimum(1, tt / 0.004)
    return out * attack


# --- Pad: Fmaj9, quiet under the hook, opening up on the logo reveal ---
pad = np.zeros(N)
for f, amp in [(87.31, 0.5), (130.81, 0.35), (220.0, 0.28), (329.63, 0.2), (392.0, 0.16), (523.25, 0.08)]:
    for det in (-0.12, 0.12):
        pad += amp * np.sin(2 * np.pi * (f + det) * t + rng.uniform(0, 6.28))
level = np.interp(t, [0, 1.6, 2.9, 3.1, 8.8, 10.0], [0, 0.45, 0.55, 1.0, 1.0, 0])
pad *= level * (1 + 0.08 * np.sin(2 * np.pi * 0.25 * t))
pad = lowpass(pad, np.interp(t, [0, 3.0, 3.2, 10], [700, 1100, 2600, 2200]))
add(pad, 0, 0.11)

# --- Riser into the reveal (1.2s → 3.0s) ---
rl = int(1.8 * SR)
rt = np.arange(rl) / SR
noise = rng.standard_normal(rl)
riser = lowpass(noise, 300 + 5200 * (rt / 1.8) ** 2) * (rt / 1.8) ** 2.2
sweep = np.sin(2 * np.pi * np.cumsum(180 + 520 * (rt / 1.8) ** 2) / SR) * (rt / 1.8) ** 3
add(riser * 0.5 + sweep * 0.12, 1.2, 0.5)

# --- Reveal: soft sub impact + two-note brand chime ---
sub_len = int(1.2 * SR)
st = np.arange(sub_len) / SR
sub = np.sin(2 * np.pi * (48 + 40 * np.exp(-st * 18)) * st) * np.exp(-st * 4.5)
add(sub, 3.02, 0.55)
bell = ((1, 1.0), (2.0, 0.35), (2.76, 0.18), (5.4, 0.06))
add(tone(1046.5, 2.5, 2.2, bell), 3.03, 0.11, -0.15)
add(tone(1568.0, 2.5, 2.4, bell), 3.16, 0.08, 0.15)

# --- Gentle pulse from the reveal onward (120 bpm) ---
for k, beat in enumerate(np.arange(3.5, 9.6, 0.5)):
    fade = 1.0 if beat < 8.8 else max(0.0, (9.6 - beat) / 0.8)
    if k % 2 == 0:
        kl = int(0.35 * SR)
        kt = np.arange(kl) / SR
        kick = np.sin(2 * np.pi * (52 + 90 * np.exp(-kt * 30)) * kt) * np.exp(-kt * 9)
        add(kick, beat, 0.32 * fade)
    hl = int(0.06 * SR)
    hat = np.diff(rng.standard_normal(hl + 1)) * np.exp(-np.arange(hl) / SR * 70)
    add(hat, beat + 0.25, 0.035 * fade, 0.3 if k % 2 else -0.3)

# --- Tagline word ticks ---
for i, cue in enumerate((3.9, 4.25, 4.6)):
    add(tone(1760 + 220 * i, 0.12, 45), cue, 0.07, (-0.3, 0.0, 0.3)[i])

# --- Whoosh: tagline out / logo move / phone rises (5.85s → 7.0s) ---
wl = int(1.15 * SR)
wt = np.arange(wl) / SR
shape = np.sin(np.pi * np.clip(wt / 1.15, 0, 1)) ** 2
wh = lowpass(rng.standard_normal(wl), 400 + 2600 * shape) * shape
add(wh, 5.85, 0.55, -0.1)

# --- Notification ding as the "Wallet funded" toast lands ---
ding = ((1, 1.0), (2.0, 0.2))
add(tone(783.99, 0.9, 6, ding), 8.55, 0.09, 0.35)
add(tone(1174.66, 1.0, 5, ding), 8.67, 0.08, 0.35)

# --- Master: gentle tail fade, peak normalise ---
master_fade = np.interp(t, [0, 9.2, 10.0], [1, 1, 0])
L *= master_fade
R *= master_fade
peak = max(np.abs(L).max(), np.abs(R).max())
L, R = L / peak * 0.7, R / peak * 0.7

os.makedirs('out', exist_ok=True)
data = (np.stack([L, R], axis=1) * 32767).astype('<i2')
with wave.open('out/teaser-audio.wav', 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(data.tobytes())
print('wrote out/teaser-audio.wav')
