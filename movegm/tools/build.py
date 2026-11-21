"""Build the MoveGM preset pack from GeneralUser GS.

usage: python3 build.py <GeneralUser-GS.sf2> <out_dir>
"""
import json
import math
import os
import re
import sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sf2
import render
import gm
import movepreset as mp
from sf2 import GEN

VEL = 100
SAMPLER_TARGET_DB = -12.0     # median Melodic Sampler Volume across the pack (Move default is ~-12)
DRUM_TARGET_DB = -10.0        # median Drum Sampler Volume (Move default ~-10.5)
PEAK = 10 ** (-1 / 20)        # normalise samples to -1 dBFS


def slug(s):
    return re.sub(r'[^A-Za-z0-9]+', '', s.title())


def loop_points(res, key):
    """Approximate a loop in the unrolled sample (for samplers that read WAV loops)."""
    if not res['looped']:
        return None
    r = res['main']
    start, end, sl, el = render.addr(r)
    step = (r['sample'].rate / render.OUT_SR) * 2 ** (render.region_pitch_offset(r, key) / 12)
    head, period = (sl - start) / step, (el - sl) / step
    n = len(res['audio']) - int(0.7 * render.OUT_SR)
    if period <= 0 or n <= head + period * 2:
        return None
    k0 = math.ceil(max(0, render.OUT_SR * 1.0 - head) / period)
    a = head + k0 * period
    k = math.floor((n - a) / period)
    if k < 1:
        return None
    return int(round(a)), int(round(a + k * period))


def norm(audio):
    pk = float(np.abs(audio).max())
    if pk <= 0:
        return audio, -120.0
    return audio * (PEAK / pk), 20 * math.log10(pk / PEAK)


def main(sf_path, out):
    sf = sf2.SF2(sf_path)
    stage = os.path.join(out, '_samples')
    pack = os.path.join(out, 'MoveGM')
    os.makedirs(stage, exist_ok=True)
    manifest = dict(source=sf.info.get('INAM'), programs=[], kits=[])

    # ---------- melodic programs ----------
    progs = []
    for p in range(128):
        key = gm.RENDER_KEY[p]
        regions = sf.regions(0, p)
        res = render.render(regions, key, VEL)
        if res is None:   # fall back to nearest key with regions
            for d in range(1, 25):
                for k2 in (key + d, key - d):
                    res = render.render(regions, k2, VEL) if 0 <= k2 <= 127 else None
                    if res:
                        key = k2 - (k2 - key) % 12 if False else k2
                        break
                if res:
                    break
        name = gm.PROGRAMS[p]
        fname = f"MGM_{p + 1:03d}_{slug(name)}.wav"
        audio, gain_db = norm(res['audio'])
        lp = loop_points(res, key)
        render.write_wav(os.path.join(stage, fname), audio, loop=lp, unity=60)
        env = render.envelope(res['main'], key, VEL)
        progs.append(dict(program=p, name=name, file=fname, key=key, gain_db=gain_db, env=env,
                          stereo=res['stereo'], looped=res['looped'], loop=lp,
                          seconds=round(len(audio) / render.OUT_SR, 2), sf2_name=sf.presets[(0, p)]['name']))
        print(f"{p + 1:3d} {name:24s} key {key} {'ST' if res['stereo'] else 'mono'} "
              f"{'loop' if res['looped'] else 'one-shot'} {len(audio) / 44100:5.2f}s level {gain_db:+.1f} dB", flush=True)
    off = SAMPLER_TARGET_DB - float(np.median([x['gain_db'] for x in progs]))
    for x in progs:
        vol = max(-40.0, min(0.0, x['gain_db'] + off))
        fam = gm.FAMILIES[x['program'] // 8]
        d = os.path.join(pack, f"{x['program'] // 8 + 1:02d} {fam}")
        os.makedirs(d, exist_ok=True)
        title = f"{x['program'] + 1:03d} {x['name']}"
        dev = mp.melodic_sampler(x['name'], x['file'], x['env'], 60 - x['key'], vol)
        rel = os.path.join(os.path.basename(d), title + '.ablpresetbundle')
        mp.write_bundle(os.path.join(pack, rel), mp.sampler_preset(x['name'], dev),
                        [(x['file'], os.path.join(stage, x['file']))])
        manifest['programs'].append(dict(program=x['program'], name=x['name'], preset=rel, sample=x['file'],
                                         render_key=x['key'], transpose=60 - x['key'], volume_db=round(vol, 2),
                                         stereo=x['stereo'], looped=x['looped'], seconds=x['seconds'],
                                         env={k: round(v, 4) for k, v in x['env'].items()},
                                         gu_name=x['sf2_name']))

    # ---------- drum kits ----------
    kits = []
    for prog, kname in gm.KITS:
        kits.append((f"GM Kit {kname}", prog, [(36 + i, 36 + i) for i in range(16)]))
    for kname, first in gm.PERC_KITS:
        kits.append((kname, 0, [(36 + i, first + i) for i in range(16)]))
    pad_info = []
    for kname, prog, pads in kits:
        regions = sf.regions(128, prog)
        rows = []
        for pad_note, gm_note in pads:
            res = render.render(regions, gm_note, VEL, loop_seconds=3.0, max_oneshot=6.0, fade=0.3)
            if res is None:
                rows.append(dict(pad=pad_note, gm=gm_note, file=None))
                continue
            fname = f"MGM_K{prog:03d}_{gm_note:02d}_{slug(gm.DRUM_NAMES.get(gm_note, 'Drum'))}.wav"
            audio, gain_db = norm(res['audio'])
            path = os.path.join(stage, fname)
            if not os.path.exists(path):
                render.write_wav(path, audio, unity=60)
            rows.append(dict(pad=pad_note, gm=gm_note, file=fname, gain_db=gain_db,
                             excl={r['gens'].get(GEN['exclusiveClass'], 0) for r in res['regions']} - {0},
                             stereo=res['stereo']))
        pad_info.append((kname, prog, rows))
    doff = DRUM_TARGET_DB - float(np.median([r['gain_db'] for _, _, rows in pad_info for r in rows if r['file']]))
    d = os.path.join(pack, "17 Drum Kits")
    os.makedirs(d, exist_ok=True)
    for i, (kname, prog, rows) in enumerate(pad_info):
        # merge exclusive classes that share pads (e.g. hi-hats use classes 1 and 2), max 2 choke groups
        groups = []
        for r in rows:
            if r['file'] and r['excl']:
                hit = [g for g in groups if g['cls'] & r['excl']]
                g = {'cls': set(r['excl']), 'pads': {r['pad']}}
                for h in hit:
                    g['cls'] |= h['cls']; g['pads'] |= h['pads']; groups.remove(h)
                groups.append(g)
        groups = [g for g in groups if len(g['pads']) > 1]
        groups.sort(key=lambda g: (0 if g['pads'] & {42, 44, 46} else 1, min(g['pads'])))
        padchoke = {p: j + 1 for j, g in enumerate(groups[:2]) for p in g['pads']}
        choke = {f"group{j + 1}": sorted(g['pads']) for j, g in enumerate(groups[:2])}
        for r in rows:
            r['choke'] = padchoke.get(r['pad'])
        pads = [(r['pad'], r['file'], max(-40.0, min(0.0, r['gain_db'] + doff)) if r['file'] else -12.0,
                 r['choke']) for r in rows]
        title = f"{i + 1:02d} {kname}"
        rel = os.path.join(os.path.basename(d), title + '.ablpresetbundle')
        files = sorted({r['file'] for r in rows if r['file']})
        mp.write_bundle(os.path.join(pack, rel), mp.drum_preset(kname, pads),
                        [(f, os.path.join(stage, f)) for f in files])
        manifest['kits'].append(dict(name=kname, preset=rel, gu_kit=prog,
                                     pads=[dict(pad=r['pad'], gm_note=r['gm'], sample=r['file'],
                                                choke=r['choke']) for r in rows]))
        print(f"kit {title}: {sum(1 for r in rows if r['file'])} pads, choke groups {choke}")
    manifest['fold_to_core'] = gm.FOLD_TO_CORE
    with open(os.path.join(out, 'movegm-manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
