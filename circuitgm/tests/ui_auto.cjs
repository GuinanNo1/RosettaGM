// TracksDECK 0.20: the automation lane under the piano roll and drum grid. Apricots project 1:
// Synth 2's pattern 1 has Macro 2 recorded on step 1, Drum 3's pattern 1 has Pitch. Draws Macro 5
// (filter frequency) on steps 1-4, a value on a sixth of step 6, clears step 2, plays (the song's
// synth and the macro knob follow the drawing), saves (the pack's project keeps it), and draws a
// drum lane. Needs the RosettaGM root served on 8765.
// node tests/ui_auto.cjs <Apricots.circuittrackspack>
const { chromium } = require('playwright');

(async () => {
  const packFile = process.argv[2];
  if (!packFile) { console.error('usage: node tests/ui_auto.cjs <Apricots pack>'); process.exit(2); }
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
  check(await pw(() => window.tracksdeck.proj.entry.slot) === 0, 'Apricots opens on project 1');

  // Synth 2 in the editor (so the macro knobs are the project's), then TRACKS, Synth 2, piano roll.
  await p.click('#synth-seg [data-synth="1"]');
  await p.waitForFunction(() => window.tracksdeck.S.slot === 32);
  await p.click('#face [data-face=tracks]');
  await pw(() => window.tracksdeck.panel().selectTrack(1));
  await p.click('.rollbtn');
  await p.waitForSelector('.lane:not([hidden]) .lane-area');
  const lane = () => pw(() => window.tracksdeck.panel() && document.querySelector('.lane-sel').value);
  check(await lane() === 'macro2', `the lane opens on the macro with values (${await lane()})`);
  const opts = await p.$$eval('.lane-sel option', (x) => x.map((o) => o.textContent));
  check(opts.length === 12 && opts[1].startsWith('• Macro 2 · ') && /^Macro 5 · .+/.test(opts[4]) && !/not assigned/.test(opts[4]) && opts[8] === 'Level',
    `the list: 8 macros labelled with what they control, then level, pan and sends (${opts[4]}, …)`);

  // Macro 5: draw steps 1-4 rising (one drag), from about 20 to about 110.
  await p.selectOption('.lane-sel', 'macro5');
  await p.$eval('.lane-area', (e) => e.scrollIntoView({ block: 'center' }));
  const box = await p.$eval('.lane-area', (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const L = await pw(() => window.tracksdeck.panel().lane());
  const sw = box.w / L.n;
  console.log(`     (lane: track ${L.t + 1}, pattern ${L.p + 1}, ${L.n} steps, ${L.per} positions a step)`);
  const yOf = (v) => box.y + 1 + (1 - v / 127) * (box.h - 3);
  await p.mouse.move(box.x + 0.5 * sw, yOf(20));
  await p.mouse.down();
  await p.mouse.move(box.x + 1.5 * sw, yOf(50), { steps: 4 });
  await p.mouse.move(box.x + 2.5 * sw, yOf(80), { steps: 4 });
  await p.mouse.move(box.x + 3.5 * sw, yOf(110), { steps: 4 });
  await p.mouse.up();
  const locks = () => pw(() => window.tracksdeck.proj.laneLocks(1, window.tracksdeck.panel().lane().p, 'macro5'));
  let l = await locks();
  check(l.length === 4 && l.every(([pos], i) => pos === i) && l.every(([, v], i) => i === 0 || v > l[i - 1][1]) && l[0][1] < 40 && Math.abs(l[3][1] - 110) <= 2,
    `dragging draws a value on each step passed (${l.map(([pos, v]) => `${pos + 1}:${v}`).join(' ')})`);
  check(await pw(() => window.tracksdeck.proj.edited), 'it is a project edit');
  check(await pw(() => document.querySelector('.lane-sel option[value=macro5]').textContent.startsWith('• ')), 'the list marks Macro 5 as having values');
  const bars = await p.$$eval('.lane-svg .lane-bar-v', (x) => x.length);
  check(bars === 4, `the lane shows a bar per drawn step (${bars})`);

  // Shift: one sixth of step 6 (its 4th sixth).
  await p.keyboard.down('Shift');
  await p.mouse.click(box.x + (5 + 3.5 / 6) * sw, yOf(64));
  await p.keyboard.up('Shift');
  l = await locks();
  const six = l.find(([pos]) => pos > 5 && pos < 6);
  check(six && Math.abs(six[0] - 5.5) < 0.01 && Math.abs(six[1] - 64) <= 2, `Shift draws on a sixth of a step (${six ? `${(six[0] + 1).toFixed(3)}:${six[1]}` : 'none'})`);

  // Double-click step 2 clears it.
  await p.mouse.dblclick(box.x + 1.5 * sw, yOf(100));
  l = await locks();
  check(!l.some(([pos]) => pos >= 1 && pos < 2) && l.some(([pos]) => pos === 0) && l.some(([pos]) => pos === 2), `double-click clears a step (${l.map(([pos, v]) => `${+(pos + 1).toFixed(3)}:${v}`).join(' ')})`);

  // The song has the drawing: playing moves the song's Synth 2 macro 5 and the knob shows it.
  const autos = await pw(() => window.tracksdeck.proj.render.events.filter((e) => e.track === 1 && e.autoKey === 'macro5').length);
  check(autos > 0, `the song plays the drawn movements (${autos} on Synth 2 macro 5)`);
  await pw(() => window.tracksdeck.proj.play());
  const seen = new Set();
  let knobAuto = false;
  for (let i = 0; i < 40; i++) {
    await p.waitForTimeout(100);
    const s = await pw(() => ({ v: window.tracksdeck.proj.player.synths[1].macroPos?.[4], auto: document.querySelectorAll('#macro-row .macro')[4]?.classList.contains('auto'), shown: +document.querySelectorAll('#macro-row .knob')[4]?.getAttribute('aria-valuenow') }));
    if (s.v != null) seen.add(s.v);
    if (s.auto && s.shown === s.v) knobAuto = true;
  }
  await pw(() => window.tracksdeck.proj.stop());
  check(seen.size >= 2, `playing turns Synth 2's macro 5 to the drawn values (${[...seen].join(', ')})`);
  check(knobAuto, 'the macro 5 knob turns with it while the song plays');
  const after = await pw(() => ({ v: window.tracksdeck.proj.player.synths[1].macroPos?.[4], shown: +document.querySelectorAll('#macro-row .knob')[4]?.getAttribute('aria-valuenow'), auto: document.querySelectorAll('#macro-row .macro')[4]?.classList.contains('auto') }));
  check(after.v === 16 && after.shown === 16 && !after.auto, `stopped, it is back at the project's position (${after.v}, knob ${after.shown})`);

  // Save: the project in the pack keeps the lane.
  await p.click('.cbtn.save');
  await p.click('.cbtn.save');
  const saved = await pw(async () => {
    const { parseNCS } = await import('/circuitgm/js/vendor/ncs.js');
    const pp = window.tracksdeck.proj, b = pp.pack.files.get(pp.entry.url);
    const proj = parseNCS(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    const blk = proj.patterns ? proj.patterns[1][window.tracksdeck.panel().lane().p] : null;
    return { locks: blk?.paramLocks?.macro5 ?? null, m2: blk?.paramLocks?.macro2 ?? null };
  });
  const live = await locks();
  const sk = saved.locks ? Object.entries(saved.locks).map(([pos, v]) => [+pos, v]).sort((a, b) => a[0] - b[0]) : [];
  check(sk.length === 4 && JSON.stringify(sk) === JSON.stringify(live) && sk.some(([pos]) => Math.abs(pos - 5.5) < 0.01) && !!saved.m2,
    `Save keeps the lane in the project (${sk.map(([pos, v]) => `${+(pos + 1).toFixed(3)}:${v}`).join(' ')}; Macro 2 kept: ${!!saved.m2})`);

  // Drum 3: the drum grid's lane follows the selected drum, Pitch recorded in pattern 1.
  await pw(() => window.tracksdeck.panel().selectTrack(6));
  await p.waitForFunction(() => document.querySelector('.ct .roll').dataset.kind === 'drum');
  check(await lane() === 'pitch', `Drum 3's lane opens on Pitch (${await lane()})`);
  const dopts = await p.$$eval('.lane-sel option', (x) => x.map((o) => o.textContent.replace(/^• /, '')));
  check(dopts.join('|') === 'Pitch|Decay|Distortion|EQ|Reverb send|Delay send|Level|Pan', `drum lanes: ${dopts.join(', ')}`);
  await p.selectOption('.lane-sel', 'decay');
  await p.$eval('.lane-area', (e) => e.scrollIntoView({ block: 'center' }));
  const dbox = await p.$eval('.lane-area', (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const dn = await pw(() => { const a = document.querySelector('.ct .roll .roll-area'); return Math.round(parseFloat(a.style.width) / parseFloat(a.style.getPropertyValue('--sw'))); });
  const dsw = dbox.w / dn;
  await p.mouse.click(dbox.x + 2.5 * dsw, dbox.y + 1 + (1 - 30 / 127) * (dbox.h - 3));
  const dl = await pw(() => { const pp = window.tracksdeck.proj; return pp.entry.project.patterns[6].flatMap((_, i) => pp.laneLocks(6, i, 'decay')); });
  check(dl.length === 1 && dl[0][0] === 2 && Math.abs(dl[0][1] - 30) <= 2, `a click draws Drum 3's decay on step 3 (${dl.map(([pos, v]) => `${pos + 1}:${v}`).join(' ')})`);
  check(await p.$eval('.lane-area', (e, w) => Math.abs(e.getBoundingClientRect().width - w) < 2, await p.$eval('.ct .roll .roll-area', (e) => e.getBoundingClientRect().width)), 'the lane lines up with the grid\'s steps');

  check(!errors.length, `no console errors (${errors.join(' | ') || 'none'})`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
