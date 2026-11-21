const fs = require('fs'), path = require('path');
const M2M = require('./m2m-core.js');
const OUT = '/home/claude/out', man = JSON.parse(fs.readFileSync(OUT + '/movegm-manifest.json'));
const lib = { manifest: man, loadPreset: M2M.loadPresetFrom(async rel => new Uint8Array(fs.readFileSync(path.join(OUT, 'MoveGM', rel)))) };
(async () => {
  const dir = '/mnt/user-data/uploads/Claude/CircuitGM-testdata/midi';
  fs.mkdirSync('/home/claude/m2m/sets', { recursive: true });
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.mid'))) {
    try {
      const song = M2M.parseMidi(new Uint8Array(fs.readFileSync(path.join(dir, f))));
      const parts = M2M.makeParts(song);
      const assign = M2M.autoAssign(parts, man, {});
      const arr = M2M.arrange(song, parts, assign);
      let res;
      for (let si = 0; si < arr.sets.length; si++) {
        res = await M2M.buildSet(song, parts, assign, arr, lib, { kitIndex: 0, fold: true, setIndex: si });
        const out = '/home/claude/m2m/sets/' + f.replace(/\.mid$/, '') + (arr.sets.length > 1 ? ` (${si + 1} of ${arr.sets.length})` : '') + '.ablbundle';
        fs.writeFileSync(out, res.zip);
        if (si === 0) console.log(`\n== ${f}: tempo ${song.tempo.toFixed(1)} sig ${song.sig.num}/${song.sig.den} ${song.lengthBeats.toFixed(0)} beats, ${parts.length} parts; sections ${arr.sectionBars} bars x ${arr.sections}, unique ${arr.unique}, Sets ${arr.sets.length}`);
        console.log(`   set ${si + 1}: order ${res.playOrder}`);
      }
      for (const p of parts) console.log(`   ${String(p.ch + 1).padStart(2)} ${p.name.padEnd(22)} n=${String(p.count).padStart(4)} ${p.lo}-${p.hi} poly ${p.poly} ov ${p.overlap.toFixed(2)} -> ${assign[p.id].dest}${p.dupOf !== undefined ? ' (duplicate of ' + parts[p.dupOf].name + ')' : ''}`);
      for (const t of res.set.tracks) console.log(`   [${t.name}] clips ${t.clipSlots.filter(c => c.clip).length}, notes ${t.clipSlots.reduce((s, c) => s + (c.clip ? c.clip.notes.length : 0), 0)}`);
      if (res.warnings.length) console.log('   warnings:', res.warnings);
      console.log(`   bundle ${(res.zip.length / 1e6).toFixed(1)} MB`);
    } catch (e) { console.log('!! ' + f + ': ' + e.stack); }
  }
})();
