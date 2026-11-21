"""Offline approximation of Move's Melodic Sampler / Drum Sampler, for auditioning MoveGM without hardware.

- Melodic Sampler: sample treated as root MIDI 60, pitch = note - 60 + Voice_Transpose (resampling),
  ADSR (Gate) with exponential decay/release, velocity -> volume blend, Volume (dB).
- Drum Sampler: one-shot at original pitch, Volume (dB), choke groups.
"""
import io
import json
import math
import os
import subprocess
import sys
import zipfile
import numpy as np
from scipy.io import wavfile
from urllib.parse import unquote

SR = 44100


def read_wav(b):
    sr, x = wavfile.read(io.BytesIO(b))
    x = x.astype(np.float32) / 32768.0
    return x if x.ndim == 2 else x[:, None]


def adsr(n_on, n_total, p):
    a = max(1, int(p['Voice_AmplitudeEnvelope_Attack'] * SR))
    d = max(1e-3, p['Voice_AmplitudeEnvelope_Decay'])
    s = p['Voice_AmplitudeEnvelope_Sustain']
    r = max(1e-3, p['Voice_AmplitudeEnvelope_Release'])
    t = np.arange(n_total) / SR
    env = np.empty(n_total, np.float32)
    att = np.arange(n_total) < a
    env[att] = np.arange(n_total)[att] / a
    td = t[~att] - a / SR
    # decay: exponential approach to sustain, reaching -60 dB of the gap after `d` seconds
    env[~att] = s + (1 - s) * np.exp(-td * 6.9 / d)
    if n_on < n_total:
        lvl = env[min(n_on, n_total - 1)]
        tr = (np.arange(n_total - n_on)) / SR
        env[n_on:] = lvl * np.exp(-tr * 6.9 / r)
    return env


def play_sampler(dev, sample, n, dur, vel):
    p = dev['parameters']
    semis = n - 60 + p['Voice_Transpose']
    rate = 2 ** (semis / 12)
    n_on = int(dur * SR)
    n_tot = n_on + int(min(p['Voice_AmplitudeEnvelope_Release'], 4.0) * SR)
    idx = np.arange(n_tot) * rate
    idx = idx[idx < len(sample) - 1]
    i0 = idx.astype(int)
    fr = (idx - i0)[:, None]
    y = sample[i0] * (1 - fr) + sample[i0 + 1] * fr
    env = adsr(n_on, len(y), p)[:, None]
    vtv = p['Voice_VelocityToVolume']
    g = 10 ** (p['Volume'] / 20) * ((1 - vtv) + vtv * (vel / 127) ** 2)
    return y * env * g


def play_drum(cell, sample, vel):
    p = cell['parameters']
    vtv = p['Voice_VelocityToVolume']
    return sample * 10 ** (p['Volume'] / 20) * ((1 - vtv) + vtv * (vel / 127) ** 2)


def render_track(device, samples, notes, length_s):
    out = np.zeros((int(length_s * SR) + SR * 4, 2), np.float32)
    inner = device['chains'][0]['devices'][0]
    if inner['kind'] == 'drumRack':
        pads = {c['drumZoneSettings']['receivingNote']: c for c in inner['chains']}
        last_choke = {}
        for t, n, d, v in notes:
            c = pads.get(n)
            if not c or not c['devices'][0]['deviceData']['sampleUri']:
                continue
            cell = c['devices'][0]
            y = play_drum(cell, samples[unquote(cell['deviceData']['sampleUri'])], v)
            i = int(t * SR)
            cg = c['drumZoneSettings']['chokeGroup']
            if cg:
                if cg in last_choke:   # cut previous voice in the group with a short fade
                    j0, ylen = last_choke[cg]
                    cut = i
                    end = min(j0 + ylen, len(out))
                    if cut < end:
                        f = min(256, end - cut)
                        out[cut:cut + f] -= prev[cut - j0:cut - j0 + f] * (1 - np.linspace(1, 0, f))[:, None]
                        out[cut + f:end] -= prev[cut - j0 + f:end - j0]
                last_choke[cg] = (i, len(y))
                prev = np.repeat(y, 2, axis=1) if y.shape[1] == 1 else y
            seg = out[i:i + len(y)]
            seg += (np.repeat(y, 2, axis=1) if y.shape[1] == 1 else y)[:len(seg)]
    else:
        sample = samples[unquote(inner['deviceData']['sampleUri'])]
        for t, n, d, v in notes:
            y = play_sampler(inner, sample, n, d, v)
            i = int(t * SR)
            seg = out[i:i + len(y)]
            seg += (np.repeat(y, 2, axis=1) if y.shape[1] == 1 else y)[:len(seg)]
    return out


def to_mp3(audio, path, kbps=96, mono=False):
    pk = np.abs(audio).max()
    if pk > 0.98:
        audio = audio * (0.98 / pk)
    buf = io.BytesIO()
    wavfile.write(buf, SR, (audio * 32767).astype(np.int16))
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'wav', '-i', '-', '-ac', '1' if mono else '2',
                    '-b:a', f'{kbps}k', path], input=buf.getvalue(), check=True)


def render_set(bundle, mp3):
    z = zipfile.ZipFile(bundle)
    song = json.loads(z.read('Song.abl'))
    samples = {n: read_wav(z.read(n)) for n in z.namelist() if n.startswith('Samples/')}
    spb = 60 / song['tempo']
    mix = None
    for t in song['tracks']:
        c = t['clipSlots'][0]['clip']
        notes = [(x['startTime'] * spb, x['noteNumber'], x['duration'] * spb, x['velocity']) for x in c['notes']]
        length = c['region']['end'] * spb
        y = render_track(t['devices'][0], samples, notes, length) * 10 ** (t['mixer']['volume'] / 20)
        mix = y if mix is None else mix + y
    to_mp3(mix[:int((length + 2) * SR)], mp3)


def audition(bundle, mp3):
    """Short phrase for one preset: arpeggio + chord for samplers, a beat for kits."""
    z = zipfile.ZipFile(bundle)
    p = json.loads(z.read('Preset.ablpreset'))
    samples = {n: read_wav(z.read(n)) for n in z.namelist() if n.startswith('Samples/')}
    inner = p['chains'][0]['devices'][0]
    if inner['kind'] == 'drumRack':
        pads = sorted(c['drumZoneSettings']['receivingNote'] for c in inner['chains']
                      if c['devices'][0]['deviceData']['sampleUri'])
        notes = [(i * 0.18, n, 0.15, 105) for i, n in enumerate(pads)]
        tot = len(pads) * 0.18 + 1.5
    else:
        base = 60 - p['chains'][0]['devices'][0]['parameters']['Voice_Transpose']
        base = min(max(base, 36), 72)
        seq = [0, 4, 7, 12, 7, 4]
        notes = [(i * 0.25, base + s, 0.22, 100) for i, s in enumerate(seq)]
        notes += [(1.6, base + s, 1.6, 95) for s in (0, 4, 7)]
        tot = 4.2
    y = render_track(p, samples, notes, tot)[:int(tot * SR)]
    to_mp3(y, mp3, kbps=56, mono=True)


if __name__ == '__main__':
    if sys.argv[1] == 'set':
        render_set(sys.argv[2], sys.argv[3])
    else:
        audition(sys.argv[2], sys.argv[3])
