import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import drift, gm, movepreset as mp
out = sys.argv[1]
pack = os.path.join(out, 'MoveGM', '18 Drift Synths')
os.makedirs(pack, exist_ok=True)
man = json.load(open(os.path.join(out, 'movegm-manifest.json')))
man['drift'] = []
for prog in sorted(drift.PATCHES):
    name = f"{gm.PROGRAMS[prog]} (Drift)"
    title = f"{prog + 1:03d} {name}"
    rel = os.path.join('18 Drift Synths', title + '.ablpresetbundle')
    mp.write_bundle(os.path.join(out, 'MoveGM', rel), drift.drift_preset(name, prog), [])
    man['drift'].append(dict(program=prog, name=name, preset=rel))
json.dump(man, open(os.path.join(out, 'movegm-manifest.json'), 'w'), indent=1)
print(len(man['drift']), 'drift presets')
