// TracksDECK 0.21: Mixer view's levels and pans (User Guide pp. 88-89). The macro knobs set each
// track's level, ▼ turns them into pan controls and ▲ back (0.21.1); vertical level faders and
// horizontal pan sliders under the pads show the same values. Loading a project sets them as saved,
// Save keeps them, Revert project puts them back. With Clear on, turning a knob deletes the
// track's recorded level / pan movements in its pattern (pan: clockwise centres the track).
// Apricots project 1: Synth 2's pattern 1 has recorded Pan. Needs the RosettaGM root served on 8765.
// node tests/ui_mixpan.cjs <Apricots.circuittrackspack>
const { chromium } = require('playwright');

(async () => {
  const packFile = process.argv[2];
  if (!packFile) { console.error('usage: node tests/ui_mixpan.cjs <Apricots pack>'); process.exit(2); }
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const fails = [];
  const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
  const errors = [];
  const p = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_|fonts\./.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('http://localhost:8765/circuitgm/tracksdeck/');
  await p.evaluate(() => { indexedDB.deleteDatabase('circuitgm-tracksdeck'); localStorage.clear(); });
  await p.goto('http://localhost:8765/circuitgm/tracksdeck/');
  await p.waitForFunction(() => window.tracksdeck?.S.pack);
  await p.setInputFiles('#file-pack', packFile);
  await p.waitForFunction(() => window.tracksdeck.proj.loaded);
  const pw = (fn, ...a) => p.evaluate(fn, ...a);
  await p.click('#face [data-face=tracks]');

  // The project's saved levels and pans.
  const file = await pw(() => { const pr = window.tracksdeck.proj.entry.project; return { lv: [...pr.mixerLevels, ...pr.drumConfigs.map((d) => d.level)], pn: [...pr.mixerPans, ...pr.drumConfigs.map((d) => d.pan)] }; });
  const st = () => pw(() => ({ lv: window.tracksdeck.proj.levels.slice(), pn: window.tracksdeck.proj.pans.slice() }));
  let s = await st();
  check(JSON.stringify(s.lv) === JSON.stringify(file.lv) && JSON.stringify(s.pn) === JSON.stringify(file.pn), `loading sets the levels and pans as saved (${s.lv.join(' ')} / ${s.pn.join(' ')})`);

  await pw(() => window.tracksdeck.panel().selectView('mixer'));
  const knobs = () => p.$$eval('#macro-row .macro', (x) => x.map((c) => ({ mix: c.classList.contains('mixk'), cap: c.querySelector('.m-cap').textContent, v: +c.querySelector('.knob').getAttribute('aria-valuenow'), t: c.querySelector('.k-out').textContent })));
  let k = await knobs();
  check(k.every((x) => x.mix) && k.map((x) => x.cap).join('|') === 'Synth 1|Synth 2|MIDI 1|MIDI 2|Drum 1|Drum 2|Drum 3|Drum 4', `in Mixer view the macro knobs are the tracks (${k.map((x) => x.cap).join(', ')})`);
  check(k.every((x, i) => x.v === s.lv[i]), `they show the levels (${k.map((x) => x.v).join(' ')})`);
  const faders = () => p.$$eval('.mixbox .lvl', (x) => x.map((c) => ({ lv: +c.querySelector('input.fader').value, pn: +c.querySelector('input.pan').value, vertical: getComputedStyle(c.querySelector('input.fader')).writingMode.startsWith('vertical') })));
  let f = await faders();
  check(f.every((x, i) => x.lv === s.lv[i] && x.pn === s.pn[i]) && f.every((x) => x.vertical), 'the faders (vertical) and pan sliders show the same values');
  const arrows = () => p.$$eval('.cbtn.arrow', (x) => x.map((b) => b.classList.contains('lit')));
  check(JSON.stringify(await arrows()) === '[true,false]', 'it opens on level, ▼ lit (press for pan)');

  // Turn Synth 1's knob down 10.
  await p.focus('#macro-row .macro:nth-child(1) .knob');
  for (let i = 0; i < 10; i++) await p.keyboard.press('ArrowDown');
  s = await st();
  f = await faders();
  check(s.lv[0] === file.lv[0] - 10 && f[0].lv === s.lv[0], `turning knob 1 sets Synth 1's level (${s.lv[0]}), and its fader follows`);
  check(await pw(() => window.tracksdeck.proj.edited && window.tracksdeck.proj.player.mixer.strips[0].cfg.level === window.tracksdeck.proj.levels[0]), 'it is a project edit, heard in the mixer');

  // ▼: pan.
  await p.click('.cbtn.arrow >> nth=0');
  check(JSON.stringify(await arrows()) === '[false,true]', '▼ switches to pan: ▲ is lit (back to level)');
  k = await knobs();
  check(k.every((x, i) => x.v === s.pn[i]) && k.every((x, i) => x.t === (s.pn[i] === 64 ? 'C' : s.pn[i] < 64 ? `L${64 - s.pn[i]}` : `R${s.pn[i] - 64}`)), `the knobs show the pans (${k.map((x) => x.t).join(' ')})`);
  await p.focus('#macro-row .macro:nth-child(5) .knob');
  for (let i = 0; i < 20; i++) await p.keyboard.press('ArrowLeft');
  s = await st();
  f = await faders();
  check(s.pn[4] === file.pn[4] - 20 && f[4].pn === s.pn[4], `turning knob 5 pans Drum 1 (${s.pn[4]}), and its pan slider follows`);
  // A pan slider moves the knob.
  await p.$eval('.mixbox .lvl[data-track="7"] input.pan', (e) => { e.value = 100; e.dispatchEvent(new Event('input', { bubbles: true })); });
  k = await knobs();
  check(k[7].v === 100 && k[7].t === 'R36', `the pan slider pans Drum 4 and the knob follows (${k[7].t})`);
  // A level fader (in pan mode) changes the level.
  await p.$eval('.mixbox .lvl[data-track="5"] input.fader', (e) => { e.value = 80; e.dispatchEvent(new Event('input', { bubbles: true })); });
  check((await st()).lv[5] === 80, 'the fader sets Drum 2\'s level');

  // Clear on, pan mode: Synth 2 (recorded pan in its pattern) anticlockwise deletes it; clockwise centres it.
  const sp = await pw(() => window.tracksdeck.panel().state && window.tracksdeck.proj.sel[1].start);
  const panLocks = () => pw((x) => Object.keys(window.tracksdeck.proj.raw(1, x).paramLocks?.pan ?? {}).length, sp);
  const before = await panLocks();
  await p.click('.cbtn.clear');
  await p.focus('#macro-row .macro:nth-child(2) .knob');
  await p.keyboard.press('ArrowDown');
  check(before > 0 && await panLocks() === 0, `Clear + turning Synth 2's knob anticlockwise deletes its recorded pan in pattern ${sp + 1} (${before} values)`);
  await pw(() => window.tracksdeck.proj.setPan(1, 30));
  await p.focus('#macro-row .macro:nth-child(2) .knob');
  await p.keyboard.press('ArrowUp');
  check((await st()).pn[1] === 64, 'Clear + turning it clockwise puts Synth 2 back in the centre');
  await p.click('.cbtn.clear');

  // ▲: back to level. Leaving Mixer view gives the knobs back to the patch's macros.
  await p.click('.cbtn.arrow >> nth=1');
  k = await knobs();
  s = await st();
  check(k.every((x, i) => x.v === s.lv[i]) && JSON.stringify(await arrows()) === '[true,false]', '▲ goes back to levels');
  await pw(() => window.tracksdeck.panel().selectView('note'));
  k = await knobs();
  check(k.every((x) => !x.mix) && !k.some((x) => /Synth|Drum/.test(x.cap)), `out of Mixer view the knobs are the patch's macros again (${k[4].cap})`);

  // Save keeps the levels and pans; another project and back loads them.
  const want = await st();
  await p.click('.cbtn.save');
  await p.click('.cbtn.save');
  const saved = await pw(async () => {
    const { parseNCS } = await import('/circuitgm/js/vendor/ncs.js');
    const pp = window.tracksdeck.proj, b = pp.pack.files.get(pp.entry.url);
    const pr = parseNCS(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    return { lv: [...pr.mixerLevels, ...pr.drumConfigs.map((d) => d.level)], pn: [...pr.mixerPans, ...pr.drumConfigs.map((d) => d.pan)] };
  });
  check(JSON.stringify(saved) === JSON.stringify(want), `Save keeps them in the project (${saved.lv.join(' ')} / ${saved.pn.join(' ')})`);
  await pw(async () => { const w = window.tracksdeck; const ok = await w.proj.load(w.S.pack, 1); if (!ok) await w.proj.load(w.S.pack, 2); });
  await pw(async () => { const w = window.tracksdeck; await w.proj.load(w.S.pack, 0); });
  s = await st();
  check(JSON.stringify({ lv: s.lv, pn: s.pn }) === JSON.stringify(want), 'loading the project again sets them as saved');

  // Revert project puts unsaved changes back.
  await pw(() => { window.tracksdeck.proj.setLevel(4, 12); window.tracksdeck.proj.setPan(0, 0); });
  await pw(() => window.tracksdeck.proj.revert());
  s = await st();
  check(s.lv[4] === want.lv[4] && s.pn[0] === want.pn[0] && await pw(() => window.tracksdeck.proj.player.mixer.strips[4].cfg.level) === want.lv[4], 'Revert project puts the saved levels and pans back');

  check(!errors.length, `no console errors (${errors.join(' | ') || 'none'})`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
