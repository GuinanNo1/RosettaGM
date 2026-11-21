"""Build the MoveGM audition page (single HTML with embedded MP3s)."""
import base64
import json
import os
import sys

out = sys.argv[1]
man = json.load(open(os.path.join(out, 'movegm-manifest.json')))
FAM = ["Piano", "Chromatic Perc", "Organ", "Guitar", "Bass", "Strings", "Ensemble", "Brass", "Reed", "Pipe",
       "Synth Lead", "Synth Pad", "Synth FX", "Ethnic", "Percussive", "Sound FX", "Drum Kits"]
HUES = [8, 28, 45, 62, 88, 130, 160, 185, 200, 215, 240, 262, 285, 305, 325, 345, 0]


def b64(name):
    with open(os.path.join(out, '_audition', name + '.mp3'), 'rb') as f:
        return base64.b64encode(f.read()).decode()


items = []
for p in man['programs']:
    title = os.path.basename(p['preset']).replace('.ablpresetbundle', '')
    items.append(dict(n=p['program'] + 1, name=p['name'], f=p['program'] // 8, st=p['stereo'], lp=p['looped'],
                      k=p['render_key'], s=p['seconds'], gu=p['gu_name'], a=b64(title)))
for i, k in enumerate(man['kits']):
    title = os.path.basename(k['preset']).replace('.ablpresetbundle', '')
    items.append(dict(n=f"K{i + 1}", name=k['name'].replace('GM Kit ', ''), f=16, st=False, lp=False, k=None,
                      s=None, gu=f"Bank 128 · {sum(1 for x in k['pads'] if x['sample'])} pads", a=b64(title)))
with open(os.path.join(out, 'MoveGM Demo (offline render).mp3'), 'rb') as f:
    demo = base64.b64encode(f.read()).decode()

html = open(os.path.join(os.path.dirname(__file__), 'page_template.html')).read()
html = html.replace('/*DATA*/', 'const FAM=' + json.dumps(FAM) + ';const HUE=' + json.dumps(HUES) +
                    ';const ITEMS=' + json.dumps(items, separators=(',', ':')) + ';const DEMO="' + demo + '";')
with open(os.path.join(out, 'movegm-audition.html'), 'w') as f:
    f.write(html)
print(len(html) / 1e6, 'MB')
