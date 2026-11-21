import json, os, sys, copy, zipfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import demo_set as ds
out, dest = sys.argv[1], sys.argv[2]
pack = os.path.join(out, 'MoveGM')
man = json.load(open(os.path.join(out, 'movegm-manifest.json')))
dr = {d['program']: d['preset'] for d in man['drift']}

def drift_track_device(p):
    d = {"presetUri": None, "kind": "instrumentRack", "name": p['name'], "lockId": 1001, "lockSeal": 812985650,
         "parameters": p['parameters'], "chains": copy.deepcopy(p['chains'])}
    inner = d['chains'][0]['devices'][0]
    d['chains'][0]['devices'][0] = {"presetUri": None, "kind": "instrumentRack", "name": inner['name'], "lockId": 1001,
                                     "lockSeal": 278284, "parameters": inner['parameters'], "chains": inner['chains']}
    return d

drums, bass, keys, pad = ds.music()
lead = []
mel = [69, 72, 76, 74, 72, 71, 69, 67]
for bar in range(8):
    for i, t in enumerate((0, 0.75, 1.5, 2.5)):
        lead.append(ds.note(mel[(bar + i) % 8] + 12, bar * 4 + t, 0.6 if i < 3 else 1.2, 100))
picks = [("Drums", 20, man['kits'][4]['preset'], 'kit', drums), ("Synth Bass", 2, dr[38], 'drift', bass),
         ("Saw Lead", 8, dr[81], 'drift', lead), ("Warm Pad", 14, dr[89], 'drift', pad)]
tracks, samples = [], {}
for name, color, rel, kind, notes in picks:
    p, s = ds.load_preset(pack, rel)
    samples.update(s)
    dev = ds.as_track_device(p, True) if kind == 'kit' else drift_track_device(p)
    tracks.append(ds.track(name, color, dev, ds.clip(name, color, notes)))
song = json.loads(zipfile.ZipFile(os.path.join(out, 'MoveGM Demo.ablbundle')).read('Song.abl'))
song['tracks'] = tracks
with zipfile.ZipFile(dest, 'w', zipfile.ZIP_STORED) as z:
    for n, b in sorted(samples.items()):
        z.writestr(n, b)
    z.writestr('Song.abl', json.dumps(song, indent=2))
print('wrote', dest)
