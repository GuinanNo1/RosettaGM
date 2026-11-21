const fs = require('fs'), path = require('path');
const M2M = require('./m2m-core.js');
const OUT = '/home/claude/out', man = JSON.parse(fs.readFileSync(OUT + '/movegm-manifest.json'));
const lib = { manifest: man, loadPreset: M2M.loadPresetFrom(async rel => new Uint8Array(fs.readFileSync(path.join(OUT, 'MoveGM', rel)))) };
const dir = '/mnt/user-data/uploads/Claude/CircuitGM-testdata/midi';
async function run(file, tweak, outName) {
  const song = M2M.parseMidi(new Uint8Array(fs.readFileSync(path.join(dir, file))));
  const parts = M2M.makeParts(song), assign = M2M.autoAssign(parts, man, {});
  tweak(parts, assign);
  const arr = M2M.arrange(song, parts, assign);
  for (let si = 0; si < arr.sets.length; si++) {
    const res = await M2M.buildSet(song, parts, assign, arr, lib, { kitIndex: 0, fold: true, setIndex: si });
    fs.writeFileSync(`sets/${outName}${arr.sets.length > 1 ? ` (${si + 1} of ${arr.sets.length})` : ''}.ablbundle`, res.zip);
    if (si === 0) {
      console.log(`== ${outName}`);
      for (const p of parts) console.log(`   ${p.name.padEnd(22)} poly ${p.poly} -> ${assign[p.id].dest}${assign[p.id].voices ? ' x' + assign[p.id].voices : ''}`);
      for (const t of res.set.tracks) {
        const r = t.devices[0].chains[0].devices[0];
        const pads = r.kind === 'drumRack' ? r.chains.filter(c => c.devices[0].deviceData.sampleUri).map(c => c.drumZoneSettings.receivingNote + ':' + c.devices[0].deviceData.sampleUri.slice(8, 22)) : [];
        console.log(`   [${t.name}] notes ${t.clipSlots.reduce((s, c) => s + (c.clip ? c.clip.notes.length : 0), 0)} ${pads.length ? 'pads ' + pads.join(' ') : ''}`);
      }
      if (res.warnings.length) console.log('   warnings:', res.warnings);
    }
  }
}
(async () => {
  const by = (parts, name) => parts.find(p => p.name === name);
  await run('in-the-air-tonight-full-score.mid', (parts, a) => {
    a[by(parts, 'Electric Piano 1').id] = { dest: 'pad', voices: 3, sound: 'sampler' };
    a[by(parts, 'Halo Pad').id] = { dest: 'pad:track4', voices: 3, sound: 'sampler' };
    a[by(parts, 'Warm Pad').id] = { dest: 'pad:track4', voices: 3, sound: 'sampler' };
    a[by(parts, 'Distortion Guitar').id] = { dest: 'track2', sound: 'sampler' };
  }, 'ITAT pads');
  await run('bladerunner.mid', (parts, a) => {
    for (const p of parts) if (a[p.id].dest === 'skip' && p.dupOf === undefined && !p.drum) a[p.id] = { dest: 'pad:track4', voices: Math.min(3, p.poly), sound: 'sampler' };
    for (const p of parts) if (a[p.id].dest === 'track4') a[p.id].dest = 'skip';
  }, 'bladerunner pads');
})();
