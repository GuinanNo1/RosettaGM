// PatchWorker 0.17: the page title line, the side list's Show menu (Patches, Changed patches,
// Samples with preview, Projects to load and play), and recorded automation in playback (drum
// pitch, levels, pans, sends, drum distortion / EQ, synth macros). Needs the RosettaGM root
// served on 8765.
// node tests/ui_lists.cjs <"Blue Monday.circuittrackspack"> [screenshot dir]
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const packFile = process.argv[2];
  const out = process.argv[3] ?? 'tests/out';
  if (!packFile) { console.error('usage: node tests/ui_lists.cjs <Blue Monday pack> [out dir]'); process.exit(2); }
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const fails = [];
  const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
  const errors = [];
  const p = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_|fonts\./.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('http://localhost:8765/circuitgm/patchworker/');
  await p.evaluate(() => indexedDB.deleteDatabase('circuitgm-patchworker'));
  await p.goto('http://localhost:8765/circuitgm/patchworker/');
  await p.waitForFunction(() => window.patchworker?.S.pack);
  const pw = (fn, ...a) => p.evaluate(fn, ...a);

  // ---- title line
  check((await p.innerText('.pagetitle h1')).startsWith('PatchWorker'), 'a line under the menu names PatchWorker');
  check(/v0\.17/.test(await p.innerText('.pagetitle .navver')), 'with the version next to it');

  await p.setInputFiles('#file-pack', packFile);
  await p.waitForFunction(() => window.patchworker.S.pack.fileName !== 'TracksGM_v1.circuittrackspack');

  // ---- Show menu
  const opts = await p.$$eval('#filter option', (o) => o.map((x) => x.value));
  check(JSON.stringify(opts) === JSON.stringify(['', 'edited', 'samples', 'projects']), `Show menu: ${opts.join(', ')}`);
  check(await p.$$eval('#patchlist li[data-slot]', (x) => x.length) === 128, 'Patches lists 128 patches');

  await p.selectOption('#filter', 'samples');
  const nSamples = await p.$$eval('#patchlist li[data-sample]:not(.empty)', (x) => x.length);
  check(nSamples > 0, `Samples lists the pack's samples (${nSamples})`);
  check(await p.getAttribute('#search', 'placeholder') === 'Search samples', 'search says Search samples');
  await p.click('#patchlist li[data-sample]:not(.empty)');
  await p.waitForSelector('#patchlist li.playing');
  check(await p.innerText('#patchlist li.playing .play') === '■', 'clicking a sample plays it (row shows ■)');
  check(/\d\.\d\d s/.test(await p.innerText('#patchlist li.playing .len')), 'and shows its length');
  await p.screenshot({ path: `${out}/lists-samples.png` });
  await p.click('#patchlist li.playing');
  check(await p.$$eval('#patchlist li.playing', (x) => x.length) === 0, 'clicking it again stops it');
  const first = await p.innerText('#patchlist li[data-sample]:not(.empty) .nm');
  await p.fill('#search', first.slice(0, 4));
  check(await p.$$eval('#patchlist li[data-sample]', (x) => x.length) >= 1, `search filters samples ("${first.slice(0, 4)}")`);

  await p.selectOption('#filter', 'projects');
  check(await p.inputValue('#search') === '', 'changing Show clears the search');
  const filled = await p.$$eval('#patchlist li[data-project]:not(.empty)', (x) => x.map((l) => +l.dataset.project));
  check(filled.length > 1, `Projects lists the pack's projects (${filled.length} with notes)`);
  // Project 27 (slot 26) has Synth 1 macro 3 and 5 automation and Drum 1 pan automation.
  check(filled.includes(26), 'project 27 is listed');
  await p.click('#patchlist li[data-project="26"] .nm');
  await p.waitForFunction(() => window.patchworker.proj.loaded && window.patchworker.proj.entry.slot === 26);
  await p.waitForTimeout(300);
  const cls = await p.$eval('#patchlist li[data-project="26"]', (l) => l.className);
  check(/\bsel\b/.test(cls), `clicking a project loads it (row selected: "${cls}")`);
  await p.click('#patchlist li[data-project="26"] .play');
  await p.waitForFunction(() => window.patchworker.proj.playing);
  check(await p.innerText('#patchlist li[data-project="26"] .play') === '■', '▶ plays it (row shows ■)');

  // ---- automation
  const autos = await pw(() => window.patchworker.proj.render.events.filter((e) => e.autoKey).map((e) => `${e.track}:${e.autoKey}`));
  const kinds = [...new Set(autos)].sort();
  check(kinds.includes('0:macro3') && kinds.includes('0:macro5'), `project 27's automation is in the playback (${kinds.join(' ')})`);
  // Its macro movements start late in the song: play from just after the first one, which also
  // checks that starting mid-song picks up the knob positions recorded before that point.
  await pw(() => { const pp = window.patchworker.proj; const e = pp.render.events.find((x) => x.autoKey === 'macro5'); return pp.start(e.t + 0.05); });
  await p.waitForTimeout(300);
  const mp = await pw(() => window.patchworker.proj.player.synths[0].macroPos);
  check(Array.isArray(mp) && (mp[2] != null || mp[4] != null), `Synth 1's macros follow the recording (macro 3 = ${mp?.[2]}, macro 5 = ${mp?.[4]})`);
  const patchPos = await pw(() => { const pp = window.patchworker.proj; return Array.from(pp.player.synths[0].bytes.slice(0, 1)).length; });
  check(patchPos === 1, 'the synth still has its patch');
  await p.click('#patchlist li[data-project="26"] .play');
  await p.waitForFunction(() => !window.patchworker.proj.playing);
  const after = await pw(() => window.patchworker.proj.player.synths[0].macroPos?.every((v) => v == null) ?? true);
  check(after, 'stopping gives the macros back to the patch');

  // Project 1 (slot 0): Drum 3 pitch automation becomes part of each hit.
  await p.click('#patchlist li[data-project="0"] .nm');
  await p.waitForFunction(() => window.patchworker.proj.entry.slot === 0);
  const drumAuto = await pw(() => window.patchworker.proj.render.events.filter((e) => e.track === 6 && e.part && e.auto?.pitch != null).length);
  check(drumAuto > 0, `Drum 3 hits carry their recorded pitch (${drumAuto})`);
  // Project 25 (slot 24): Synth 2 reverb send automation.
  await p.click('#patchlist li[data-project="24"] .nm');
  await p.waitForFunction(() => window.patchworker.proj.entry.slot === 24);
  const n = await pw(() => window.patchworker.proj.render.events.filter((e) => e.autoKey === 'reverb_send' && e.track === 1).length);
  check(n > 0, `Synth 2 reverb send automation is scheduled (${n} movements)`);
  const v = await pw(() => { const pp = window.patchworker.proj; const e = pp.render.events.find((x) => x.autoKey === 'reverb_send' && x.track === 1); pp.start(e.t + 0.05); return e.value; });
  await p.waitForTimeout(400);
  // The send moves continuously: compare with the last movement before now (within a step).
  const r = await pw(() => {
    const pp = window.patchworker.proj, pos = pp.player.position;
    const ev = pp.render.events.filter((x) => x.autoKey === 'reverb_send' && x.track === 1);
    const near = ev.filter((x) => x.t <= pos && x.t > pos - 0.25).map((x) => x.value);
    return { g: pp.player.mixer.strips[1].reverb.gain.value, lo: Math.min(...near), hi: Math.max(...near) };
  });
  const lo = (r.lo / 127) ** 1.1, hi = (r.hi / 127) ** 1.1;
  check(r.g >= lo - 0.03 && r.g <= hi + 0.03, `and Synth 2's reverb send follows it (gain ${r.g.toFixed(3)}, recorded ${r.lo}-${r.hi} in the last 0.25 s = ${lo.toFixed(3)}-${hi.toFixed(3)})`);
  await pw(() => window.patchworker.proj.stop());

  await p.selectOption('#filter', '');
  check(await p.$$eval('#patchlist li[data-slot]', (x) => x.length) === 128, 'Patches brings the patch list back');
  await p.screenshot({ path: `${out}/lists-patches.png` });

  check(!errors.length, `no console errors (${errors.join(' | ') || 'none'})`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
