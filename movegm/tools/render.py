"""Render one SF2 key/velocity to a Move-ready sample (44.1 kHz), with loops unrolled.

Each matching region (layers, stereo L/R zones) is pitched, looped and panned, then mixed.
Output is mono unless regions have differing pan (stereo pairs / panned layers).
"""
import math
import struct
from fractions import Fraction
import numpy as np
from scipy.signal import resample_poly, lfilter
from sf2 import GEN

OUT_SR = 44100
ATTEN_FACTOR = 0.4          # EMU/FluidSynth convention for initialAttenuation (cB * 0.4)


def tc2s(tc):               # timecents -> seconds
    return 2.0 ** (tc / 1200.0) if tc > -12000 else 0.0


def cents2hz(c):
    return 8.176 * 2.0 ** (c / 1200.0)


def region_pitch_offset(r, key):
    g, s = r['gens'], r['sample']
    root = g.get(GEN['overridingRootKey'], -1)
    if root < 0:
        root = s.pitch if s.pitch <= 127 else 60
    st = g.get(GEN['scaleTuning'], 100)
    return (key - root) * st / 100.0 + g.get(GEN['coarseTune'], 0) + g.get(GEN['fineTune'], 0) / 100.0 + s.corr / 100.0


def addr(r):
    g, s = r['gens'], r['sample']
    o = lambda f, c: g.get(GEN[f], 0) + 32768 * g.get(GEN[c], 0)
    start = s.start + o('startAddrsOffset', 'startAddrsCoarseOffset')
    end = s.end + o('endAddrsOffset', 'endAddrsCoarseOffset')
    sl = s.sloop + o('startloopAddrsOffset', 'startloopAddrsCoarseOffset')
    el = s.eloop + o('endloopAddrsOffset', 'endloopAddrsCoarseOffset')
    return start, end, sl, el


def render_region(r, key, out_len_looped, max_len_oneshot):
    """Return (mono float32 at OUT_SR, looped: bool)."""
    s = r['sample']
    start, end, sl, el = addr(r)
    mode = r['gens'].get(GEN['sampleModes'], 0) & 3
    looped = mode in (1, 3) and start <= sl < el <= end and el - sl >= 8
    semis = region_pitch_offset(r, key)
    # source samples consumed per output sample
    step = (s.rate / OUT_SR) * 2.0 ** (semis / 12.0)
    if looped:
        need = int(out_len_looped * step) + 64
        head = s.data(start, sl)
        loop = s.data(sl, el)
        reps = max(1, int(math.ceil((need - len(head)) / len(loop))))
        src = np.concatenate([head, np.tile(loop, reps)])[:need]
    else:
        src = s.data(start, end)
        src = src[:int(max_len_oneshot * OUT_SR * step) + 64]
    frac = Fraction(1 / step).limit_denominator(4000)   # out/in ratio
    y = resample_poly(src.astype(np.float64), frac.numerator, frac.denominator, window=('kaiser', 8.0))
    if looped:
        y = y[:out_len_looped]
    y = bake_filter(y, r, key)
    return y.astype(np.float32), looped


def mod_env(g, key, n, sr=OUT_SR):
    """SF2 modulation envelope (0..1) sampled per output frame (note held throughout)."""
    d = tc2s(g.get(GEN['delayModEnv'], -12000))
    a = tc2s(g.get(GEN['attackModEnv'], -12000))
    h = tc2s(g.get(GEN['holdModEnv'], -12000) + g.get(GEN['keynumToModEnvHold'], 0) * (60 - key))
    dc = tc2s(g.get(GEN['decayModEnv'], -12000) + g.get(GEN['keynumToModEnvDecay'], 0) * (60 - key))
    sus = 1.0 - max(0, min(1000, g.get(GEN['sustainModEnv'], 0))) / 1000.0
    t = np.arange(n) / sr
    e = np.zeros(n)
    t1, t2, t3 = d, d + a, d + a + h
    e[(t >= t1) & (t < t2)] = (t[(t >= t1) & (t < t2)] - t1) / a if a > 0 else 1.0
    e[(t >= t2) & (t < t3)] = 1.0
    m = t >= t3
    e[m] = sus + (1 - sus) * np.clip(1 - (t[m] - t3) / dc, 0, 1) if dc > 0 else sus
    return e


def bake_filter(y, r, key, vel=100, block=64):
    """Apply SF2's time-varying 2-pole lowpass (initialFilterFc + modEnv + modulators)."""
    from sf2 import mod_offset
    g = r['gens']
    fc0 = g.get(GEN['initialFilterFc'], 13500) + mod_offset(r, GEN['initialFilterFc'], key, vel)
    env_amt = g.get(GEN['modEnvToFilterFc'], 0) + mod_offset(r, GEN['modEnvToFilterFc'], key, vel)
    if fc0 >= 13500 and env_amt >= 0:
        return y
    q_db = max(0.0, (g.get(GEN['initialFilterQ'], 0) + mod_offset(r, GEN['initialFilterQ'], key, vel)) / 10.0)
    Q = max(0.5, 10 ** (q_db / 20.0) * 0.7071)
    env = mod_env(g, key, len(y)) if env_amt else np.zeros(len(y))
    out = np.empty_like(y)
    zi = np.zeros(2)
    for i in range(0, len(y), block):
        c = fc0 + env_amt * env[i]
        f = min(cents2hz(c), 0.45 * OUT_SR)
        if c >= 13500:
            f = 0.45 * OUT_SR
        w = 2 * math.pi * f / OUT_SR
        al = math.sin(w) / (2 * Q)
        cw = math.cos(w)
        b = np.array([(1 - cw) / 2, 1 - cw, (1 - cw) / 2]) / (1 + al)
        a = np.array([1, -2 * cw / (1 + al), (1 - al) / (1 + al)])
        out[i:i + block], zi = lfilter(b, a, y[i:i + block], zi=zi)
    return out


def pick_regions(regions, key, vel):
    return [r for r in regions if r['key'][0] <= key <= r['key'][1] and r['vel'][0] <= vel <= r['vel'][1]]


def render(regions, key, vel=100, loop_seconds=8.0, max_oneshot=12.0, fade=0.6):
    """Mix all regions for key/vel. Returns dict(audio=(n,ch) float32, info...) or None."""
    rs = pick_regions(regions, key, vel)
    if not rs:
        return None
    out_len = int(loop_seconds * OUT_SR)
    parts, any_loop = [], False
    for r in rs:
        y, looped = render_region(r, key, out_len, max_oneshot)
        any_loop |= looped
        att = r['gens'].get(GEN['initialAttenuation'], 0) * ATTEN_FACTOR      # cB
        gain = 10 ** (-att / 200.0)
        pan = max(-500, min(500, r['gens'].get(GEN['pan'], 0))) / 500.0
        parts.append((y * gain, pan, r))
    n = max(len(p[0]) for p in parts)
    pans = {round(p[1], 3) for p in parts}
    stereo = len(pans) > 1
    out = np.zeros((n, 2 if stereo else 1), np.float32)
    for y, pan, r in parts:
        if stereo:
            a = (pan + 1) * math.pi / 4                      # constant-power pan
            out[:len(y), 0] += y * math.cos(a) * math.sqrt(2)
            out[:len(y), 1] += y * math.sin(a) * math.sqrt(2)
        else:
            out[:len(y), 0] += y
    # trim trailing near-silence (one-shots), then fade out the tail
    mag = np.abs(out).max(axis=1)
    thr = mag.max() * 10 ** (-70 / 20)
    nz = np.nonzero(mag > thr)[0]
    if len(nz):
        out = out[:nz[-1] + 1]
    f = min(len(out) // 4, int(fade * OUT_SR) if any_loop else int(0.05 * OUT_SR))
    if f > 0:
        out[-f:] *= np.linspace(1, 0, f, dtype=np.float32)[:, None] ** 2
    main = max(rs, key=lambda r: -r['gens'].get(GEN['initialAttenuation'], 0))
    return dict(audio=out, looped=any_loop, stereo=stereo, main=main, regions=rs)


def envelope(main, key, vel=100):
    """Map main region's SF2 volume envelope / filter to Move Melodic Sampler values."""
    from sf2 import mod_offset
    g = main['gens']
    dk = g.get(GEN['keynumToVolEnvDecay'], 0)
    decay = tc2s(g.get(GEN['decayVolEnv'], -12000) + dk * (60 - key))
    sus_cb = max(0, g.get(GEN['sustainVolEnv'], 0))
    fc = g.get(GEN['initialFilterFc'], 13500) + mod_offset(main, GEN['initialFilterFc'], key, vel)
    q = g.get(GEN['initialFilterQ'], 0)
    return dict(
        attack=max(0.0001, tc2s(g.get(GEN['attackVolEnv'], -12000)) + tc2s(g.get(GEN['holdVolEnv'], -12000)) * 0),
        decay=min(60.0, max(0.001, decay if decay > 0 else 60.0)),
        sustain=max(0.0003162277571391314, 10 ** (-sus_cb / 200.0)) if sus_cb < 1000 else 0.0003162277571391314,
        release=min(60.0, max(0.005, tc2s(g.get(GEN['releaseVolEnv'], -12000)))),
        cutoff=22000.0,          # SF2 filter is baked into the sample; Move filter left open
        resonance=0.0,
        exclusive=g.get(GEN['exclusiveClass'], 0),
        pan=max(-500, min(500, g.get(GEN['pan'], 0))) / 500.0,
    )


def write_wav(path, audio, loop=None, unity=60, sr=OUT_SR):
    """16-bit PCM WAV, TPDF-dithered, with optional 'smpl' chunk (unity note + loop)."""
    ch = audio.shape[1]
    x = audio * 32767.0 + (np.random.rand(*audio.shape) - np.random.rand(*audio.shape))
    pcm = np.clip(np.round(x), -32768, 32767).astype('<i2').tobytes()
    fmt = struct.pack('<HHIIHH', 1, ch, sr, sr * ch * 2, ch * 2, 16)
    smpl = b''
    if loop is not None or unity is not None:
        loops = [loop] if loop else []
        body = struct.pack('<IIIIIIIII', 0, 0, int(1e9 / sr), unity or 60, 0, 0, 0, len(loops), 0)
        for a, b in loops:
            body += struct.pack('<IIIIII', 0, 0, a, b - 1, 0, 0)
        smpl = b'smpl' + struct.pack('<I', len(body)) + body
    data = b'data' + struct.pack('<I', len(pcm)) + pcm + (b'\0' if len(pcm) & 1 else b'')
    riff = b'WAVE' + b'fmt ' + struct.pack('<I', len(fmt)) + fmt + smpl + data
    with open(path, 'wb') as f:
        f.write(b'RIFF' + struct.pack('<I', len(riff)) + riff)
