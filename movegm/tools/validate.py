"""Validate .ablpresetbundle / .ablbundle files against structures seen in real Move files.

usage: python3 validate.py <dir or file>...
"""
import glob
import json
import os
import struct
import sys
import zipfile
from urllib.parse import unquote

RACKS = {'instrumentRack', 'drumRack', 'audioEffectRack'}
INSTR = {'drumCell', 'melodicSampler', 'drift', 'wavetable'}
FX = {'reverb', 'delay', 'saturator', 'chorus', 'channelEq', 'compressor', 'limiter', 'autoFilter',
      'phaser', 'redux2', 'autoPan'}
MIXER_KEYS = ['pan', 'solo-cue', 'speakerOn', 'volume', 'sends']
MS_PARAMS = {'Enabled', 'Voice_AmplitudeEnvelope_Attack', 'Voice_AmplitudeEnvelope_Decay',
             'Voice_AmplitudeEnvelope_Release', 'Voice_AmplitudeEnvelope_Sustain',
             'Voice_AmplitudeEnvelope_SustainMode', 'Voice_Detune', 'Voice_FilterEnvelope_Attack',
             'Voice_FilterEnvelope_Decay', 'Voice_FilterEnvelope_On', 'Voice_FilterEnvelope_Release',
             'Voice_FilterEnvelope_Sustain', 'Voice_Filter_Frequency',
             'Voice_Filter_FrequencyModulationAmounts_EnvelopeAmount',
             'Voice_Filter_FrequencyModulationAmounts_LfoAmount', 'Voice_Filter_On', 'Voice_Filter_Resonance',
             'Voice_Filter_Slope', 'Voice_Filter_Type', 'Voice_Gain', 'Voice_Lfo_On', 'Voice_Lfo_Rate',
             'Voice_Lfo_Type', 'Voice_PlaybackLength', 'Voice_PlaybackStart', 'Voice_Transpose',
             'Voice_VelocityToVolume', 'Volume'}


def wav_info(b):
    assert b[:4] == b'RIFF' and b[8:12] == b'WAVE', 'not RIFF/WAVE'
    p, info = 12, {}
    while p + 8 <= len(b):
        cid, sz = b[p:p + 4], struct.unpack_from('<I', b, p + 4)[0]
        if cid == b'fmt ':
            fmt, ch, sr, _, _, bits = struct.unpack_from('<HHIIHH', b, p + 8)
            info.update(fmt=fmt, ch=ch, sr=sr, bits=bits)
        elif cid == b'data':
            info['frames'] = sz // (info['ch'] * info['bits'] // 8)
        elif cid == b'smpl':
            n = struct.unpack_from('<I', b, p + 8 + 28)[0]
            info['unity'] = struct.unpack_from('<I', b, p + 8 + 12)[0]
            info['loops'] = [struct.unpack_from('<II', b, p + 8 + 36 + i * 24 + 8) for i in range(n)]
        p += 8 + sz + (sz & 1)
    return info


def check_device(d, path, errs, refs, depth=0):
    k = d.get('kind')
    where = f"{path}/{k}"
    if k not in RACKS | INSTR | FX:
        errs.append(f"{where}: unknown kind")
    if not isinstance(d.get('parameters'), dict):
        errs.append(f"{where}: no parameters")
    if k in RACKS:
        for i in range(8):
            if f"Macro{i}" not in d['parameters']:
                errs.append(f"{where}: missing Macro{i}")
        for ch in d.get('chains', []):
            if list(ch.get('mixer', {}).keys()) != MIXER_KEYS:
                errs.append(f"{where}: chain mixer keys {list(ch.get('mixer', {}).keys())}")
            for x in ch.get('devices', []):
                check_device(x, where, errs, refs, depth + 1)
    if k == 'drumRack':
        notes = [c['drumZoneSettings']['receivingNote'] for c in d['chains']]
        if len(set(notes)) != len(notes) or not all(36 <= n <= 51 for n in notes):
            errs.append(f"{where}: bad receivingNotes {notes}")
        if len(d['chains']) > 16:
            errs.append(f"{where}: >16 pads")
        for c in d['chains']:
            z = c['drumZoneSettings']
            if z['sendingNote'] != 60 or z['chokeGroup'] not in (None, 1, 2):
                errs.append(f"{where}: drumZoneSettings {z}")
            if len(c['devices']) != 1 or c['devices'][0]['kind'] != 'drumCell':
                errs.append(f"{where}: pad chain must hold exactly one drumCell")
        if len(d.get('returnChains', [])) > 1:
            errs.append(f"{where}: >1 return chain")
    if k == 'melodicSampler':
        p = d['parameters']
        missing, extra = MS_PARAMS - set(p), set(p) - MS_PARAMS
        if missing or extra:
            errs.append(f"{where}: params missing {missing} extra {extra}")
        if not -48 <= p['Voice_Transpose'] <= 48:
            errs.append(f"{where}: transpose {p['Voice_Transpose']}")
        for n in ('Attack', 'Decay', 'Release'):
            v = p[f'Voice_AmplitudeEnvelope_{n}']
            if not 0 < v <= 60:
                errs.append(f"{where}: {n} {v}")
        if not -70 <= p['Volume'] <= 6:
            errs.append(f"{where}: Volume {p['Volume']}")
    if k == 'drift':
        import json as _j, os as _o
        kp = _o.environ.get('MOVE_PARAM_KEYS')
        if kp:
            want = set(_j.load(open(kp))['drift'])
            got = set(d['parameters'])
            if want != got:
                errs.append(f"{where}: drift params missing {want - got} extra {got - want}")
    if k in ('melodicSampler', 'drumCell'):
        u = d.get('deviceData', {}).get('sampleUri')
        if u:
            refs.append(u)


def check_preset_tree(top, errs, refs, is_preset):
    if top.get('kind') != 'instrumentRack':
        errs.append('top-level must be instrumentRack')
    if is_preset and list(top)[:5] != ['$schema', 'kind', 'name', 'parameters', 'chains']:
        errs.append(f'top-level key order {list(top)}')
    if len(top.get('chains', [])) != 1:
        errs.append('outer rack must have exactly 1 chain')
    devs = top['chains'][0]['devices']
    inst = [x for x in devs if x['kind'] in INSTR | {'drumRack', 'instrumentRack'}]
    fx = [x for x in devs if x['kind'] in FX | {'audioEffectRack'}]
    if len(inst) != 1 or devs[0] is not inst[0] or len(fx) > 2 or len(inst) + len(fx) != len(devs):
        errs.append(f"outer chain must be [instrument, <=2 FX]: {[x['kind'] for x in devs]}")
    check_device(top, '', errs, refs)


def check_zip(path):
    errs, warn, mem = [], [], 0
    z = zipfile.ZipFile(path)
    names = z.namelist()
    if path.endswith('.ablpresetbundle'):
        if 'Preset.ablpreset' not in names:
            return ['no Preset.ablpreset'], warn, 0
        doc = json.loads(z.read('Preset.ablpreset'))
        refs = []
        check_preset_tree(doc, errs, refs, True)
        if 'lockSeal' in json.dumps(doc):
            warn.append('contains lockSeal (Live exports normally omit it)')
    else:
        doc = json.loads(z.read('Song.abl'))
        refs = []
        if len(doc['tracks']) != 4:
            errs.append('Set must have 4 tracks')
        for ti, t in enumerate(doc['tracks']):
            if len(t['clipSlots']) != 8:
                errs.append('track needs 8 clip slots')
            for si, sl in enumerate(t['clipSlots']):
                c = sl.get('clip')
                if not c:
                    continue
                by = {}
                for n in c.get('notes', []):
                    by.setdefault(n['noteNumber'], []).append((n['startTime'], n['startTime'] + n['duration'], n['duration']))
                    if n['duration'] <= 0 or n['startTime'] < 0 or n['startTime'] >= c['region']['end']:
                        errs.append(f'track {ti+1} clip {si+1}: bad note timing {n}')
                bad = sum(1 for v in by.values() for a, b in zip(sorted(v), sorted(v)[1:]) if a[1] > b[0] + 1e-9)
                if bad:
                    errs.append(f'track {ti+1} clip {si+1}: {bad} overlapping/duplicate same-pitch notes (Live: document invariant violation)')
            if t['kind'] == 'midi':
                check_preset_tree(t['devices'][0], errs, refs, False)
    for u in set(refs):
        arc = unquote(u)
        if not u.startswith('Samples/'):
            warn.append(f'non-bundled sample ref {u}')
            continue
        if arc not in names:
            errs.append(f'missing sample {arc}')
            continue
        wi = wav_info(z.read(arc))
        if (wi['fmt'], wi['sr'], wi['bits']) != (1, 44100, 16) or wi['ch'] not in (1, 2):
            errs.append(f'{arc}: format {wi}')
        for a, b in wi.get('loops', []):
            if not 0 <= a < b < wi['frames']:
                errs.append(f'{arc}: loop {a}-{b} outside {wi["frames"]} frames')
        mem += wi['frames'] * wi['ch'] * 4
    for n in names:
        if n.startswith('Samples/') and 'Samples/' + n[8:] not in {unquote(u) for u in refs}:
            warn.append(f'unreferenced {n}')
        if any(ord(c) > 127 for c in n):
            warn.append(f'non-ASCII name {n}')
    return errs, warn, mem


if __name__ == '__main__':
    files = []
    for a in sys.argv[1:]:
        files += [a] if os.path.isfile(a) else sorted(glob.glob(a + '/**/*.abl*bundle', recursive=True))
    bad, total = 0, 0
    for f in files:
        e, w, mem = check_zip(f)
        total += mem
        if e or w:
            print(('FAIL ' if e else 'warn ') + os.path.relpath(f), *e, *w, sep='\n   ')
        bad += bool(e)
    print(f"{len(files)} files checked, {bad} failed; RAM if all loaded {total / 1e6:.0f} MB")
