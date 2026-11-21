"""Build a 4-track demo Move Set (.ablbundle) from MoveGM presets, for testing in Live 12.4+/Note/Move.

usage: python3 demo_set.py <out_dir containing MoveGM/ and movegm-manifest.json> <out.ablbundle>
"""
import copy
import json
import os
import sys
import zipfile
from urllib.parse import unquote

SONG_SCHEMA = "http://tech.ableton.com/schema/song/1.8.2/song.json"
SEALS = {'sampler_outer': 1472017714, 'kit_outer': -973461132, 'drumrack': 830049224}  # Move role values


def load_preset(pack, rel):
    z = zipfile.ZipFile(os.path.join(pack, rel))
    p = json.loads(z.read('Preset.ablpreset'))
    samples = {n: z.read(n) for n in z.namelist() if n.startswith('Samples/')}
    return p, samples


def as_track_device(p, drum):
    d = {"presetUri": None, "kind": p['kind'], "name": p['name'], "lockId": 1001,
         "lockSeal": SEALS['kit_outer' if drum else 'sampler_outer'],
         "parameters": p['parameters'], "chains": copy.deepcopy(p['chains'])}
    if drum:
        dr = d['chains'][0]['devices'][0]
        d['chains'][0]['devices'][0] = {"presetUri": None, "kind": "drumRack", "name": dr['name'],
                                         "lockId": 1001, "lockSeal": SEALS['drumrack'],
                                         "parameters": dr['parameters'], "chains": dr['chains'],
                                         "returnChains": dr['returnChains']}
    return d


def note(n, t, d, v=100):
    return {"noteNumber": n, "startTime": float(t), "duration": float(d), "velocity": float(v), "offVelocity": 0.0}


def clip(name, color, notes, length=32.0):
    return {"name": name, "color": color, "isEnabled": True,
            "region": {"start": 0.0, "end": length, "loop": {"start": 0.0, "end": length, "isEnabled": True}},
            "grooveId": 1, "notes": sorted(notes, key=lambda x: (x['startTime'], x['noteNumber'])),
            "stepEditorScrollPosition": 0.0, "envelopes": []}


def track(name, color, device, the_clip):
    slots = [{"hasStop": True, "clip": the_clip}] + [{"hasStop": True, "clip": None} for _ in range(7)]
    return {"kind": "midi", "name": name, "color": color, "isSelected": False, "clipSlots": slots,
            "isNoteRepeatOn": False, "noteRepeatRate": "1/16", "noteRepeatArpeggio": {"style": "chordRepeat"},
            "uiOctaveIndex": 4, "midiInputMode": "auto", "midiOutputEndpoint": None, "devices": [device],
            "mixer": {"pan": 0.0, "solo-cue": False, "speakerOn": True, "volume": -3.0, "sends": []}}


def music():
    # A minor, 110 bpm, 8 bars: Am | F | C | G  x2
    chords = [(57, 60, 64), (53, 57, 60), (48, 52, 55), (55, 59, 62)] * 2
    roots = [45, 41, 36, 43] * 2
    drums, bass, keys, pad = [], [], [], []
    for bar in range(8):
        b0 = bar * 4.0
        for beat in range(4):
            drums.append(note(36, b0 + beat, 0.25, 115 if beat in (0, 2) else 95))
            if beat in (1, 3):
                drums.append(note(38, b0 + beat, 0.25, 110))
            for e in (0, 0.5):
                drums.append(note(42, b0 + beat + e, 0.25, 90 if e == 0 else 70))
        if bar % 4 == 3:
            drums.append(note(46, b0 + 3.5, 0.5, 90))
        if bar == 7:
            drums += [note(50, b0 + 3.0, 0.25, 100), note(47, b0 + 3.25, 0.25, 100), note(45, b0 + 3.5, 0.25, 105)]
        if bar == 0:
            drums.append(note(49, 0.0, 1.0, 110))
        r = roots[bar]
        for t, n, d in ((0, r, 0.75), (1.0, r, 0.5), (1.5, r + 12, 0.25), (2.0, r, 0.75), (3.0, r + 7, 0.5),
                        (3.5, r + 10 if bar % 2 else r + 12, 0.5)):
            bass.append(note(n, b0 + t, d, 105))
        for t in (0.0, 1.5, 2.5):
            keys += [note(n, b0 + t, 0.9, 88) for n in chords[bar]]
        pad += [note(n + 12, b0, 4.0, 80) for n in chords[bar]]
    return drums, bass, keys, pad


def main(out, dest):
    pack = os.path.join(out, 'MoveGM')
    man = json.load(open(os.path.join(out, 'movegm-manifest.json')))
    prog = {p['program']: p for p in man['programs']}
    kit = man['kits'][0]
    picks = [("Drums", 20, kit['preset'], True), ("Bass", 2, prog[33]['preset'], False),
             ("Keys", 8, prog[4]['preset'], False), ("Strings", 14, prog[48]['preset'], False)]
    drums, bass, keys, pad = music()
    clips = [clip("Beat", 20, drums), clip("Bass", 2, bass), clip("Chords", 8, keys), clip("Pad", 14, pad)]
    tracks, samples = [], {}
    for (name, color, rel, drum), c in zip(picks, clips):
        p, s = load_preset(pack, rel)
        samples.update(s)
        tracks.append(track(name, color, as_track_device(p, drum), c))
    song = {
        "$schema": SONG_SCHEMA, "stepEditorResolution": "1/16", "tempo": 110.0, "globalGrooveAmount": 0.0,
        "rootNote": 9, "scale": "Minor", "melodicLayout": "inKey", "tracks": tracks, "returnTracks": [],
        "masterTrack": {"color": 2, "isSelected": False, "devices": [], "mixer": {"pan": 0.0, "volume": 0.0}},
        "scenes": [{"name": "", "color": None} for _ in range(8)],
        "grooves": [{"id": 1, "name": "Swing 16ths", "base": "1/16", "loop": {"start": 0.0, "end": 4.0},
                     "events": [{"time": i / 4 + (1 / 12 if i % 2 else 0)} for i in range(16)]}],
        "metadata": {"usedFeatures": ["Drum Sampler Pitch > Env"]},
    }
    with zipfile.ZipFile(dest, 'w', zipfile.ZIP_STORED) as z:
        for n, b in sorted(samples.items()):
            z.writestr(n, b)
        z.writestr('Song.abl', json.dumps(song, indent=2))
        z.writestr('BundleInfo.json', json.dumps({"originalSampleUris": {
            n.replace(' ', '%20'): "ableton:/user-library/Samples/Preset%20Samples/" + n[8:] for n in sorted(samples)}},
            indent=2))
    print('wrote', dest, len(samples), 'samples')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
