import sys, json, glob, os, numpy as np
from scipy.io import wavfile
man = json.load(open('/home/claude/out/movegm-manifest.json'))
def f0_cents(x, sr, expect_hz):
    x = x.mean(axis=1) if x.ndim == 2 else x
    x = x.astype(np.float64) / 32768
    a, b = int(0.25 * sr), int(min(len(x), 1.75 * sr))
    seg = x[a:b]
    if len(seg) < sr * 0.3: seg = x[:int(min(len(x), sr))]
    seg = seg - seg.mean()
    if np.abs(seg).max() < 1e-4: return None
    # high-resolution spectrum, refine the peak nearest to each expected harmonic
    n = 1 << 20
    X = np.abs(np.fft.rfft(seg * np.hanning(len(seg)), n)); fr = np.fft.rfftfreq(n, 1 / sr)
    ests = []
    for h in range(1, 7):
        target = expect_hz * h
        if target > sr / 2 - 500: break
        lo, hi = np.searchsorted(fr, target * 2 ** (-0.6 / 12)), np.searchsorted(fr, target * 2 ** (0.6 / 12))
        if hi <= lo + 2: continue
        k = lo + np.argmax(X[lo:hi])
        if X[k] < X.max() * 0.02: continue
        a_, b_, c_ = np.log(X[k - 1] + 1e-12), np.log(X[k] + 1e-12), np.log(X[k + 1] + 1e-12)
        p = 0.5 * (a_ - c_) / (a_ - 2 * b_ + c_)
        f = (k + p) * (fr[1] - fr[0]) / h
        ests.append((X[k], 1200 * np.log2(f / expect_hz)))
    if not ests: return None
    w = np.array([e[0] for e in ests]); c = np.array([e[1] for e in ests])
    return float(np.median(c)), float(np.std(c))
rows = []
for p in man['programs']:
    sr, x = wavfile.read(os.path.join('/home/claude/out/_samples', p['sample']))
    hz = 440 * 2 ** ((p['render_key'] - 69) / 12)
    r = f0_cents(x, sr, hz)
    rows.append((p['program'] + 1, p['name'], r))
bad = [(n, nm, r) for n, nm, r in rows if r and abs(r[0]) > 8]
for n, nm, r in rows:
    if n in (31, 30, 29, 28, 27): print('CHECK', n, nm, r)
print('--- off by more than 8 cents:')
for n, nm, r in sorted(bad, key=lambda x: -abs(x[2][0])): print(f'{n:3d} {nm:24s} {r[0]:+6.1f} cents (spread {r[1]:.1f})')
print('unmeasurable:', [nm for n, nm, r in rows if not r])
