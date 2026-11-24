// PatchWorker 0.18 micro steps (User Guide pp. 48-51, 66): Micro Step view on a drum track (Gate
// view) and on Synth 1 (Gate, then Gate again), tie forward, the drum grid's micro-step marks and
// box, Shift-drag in the piano roll, and that it all survives Save. Needs the RosettaGM root
// served on 8765.
// node tests/ui_micro.cjs <"Blue Monday.circuittrackspack"> [screenshot dir]
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const packFile = process.argv[2];
  const out = process.argv[3] ?? 'tests/out';
  if (!packFile) { console.error('usage: node tests/ui_micro.cjs <Blue Monday pack> [out dir]'); process.exit(2); }
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
  await p.setInputFiles('#file-pack', packFile);
  await p.waitForFunction(() => window.patchworker.S.pack.fileName !== 'TracksGM_v1.circuittrackspack');
  await p.click('#face [data-face=tracks]');
  await p.click('.view[data-view=projects]');
  await p.click('.pad.project[data-project="0"]');
  await p.waitForFunction(() => window.patchworker.proj.loaded);
  const pw = (fn, ...a) => p.evaluate(fn, ...a);
  const st = () => pw(() => { const s = window.patchworker.panel().state; return { view: s.view, track: s.track, sel: s.sel }; });
  const pad = (i) => `.pads .pad:nth-child(${i + 1})`;
  const target = () => pw(() => { const pp = window.patchworker.proj, s = window.patchworker.panel().state; return { t: s.track, p: pp.sel[s.track].start, k: s.sel }; });

  // ---- Drum 1: Gate view is its Micro Step view
  await p.click('.trk[data-track="4"]');
  await p.click('.view[data-view=gate]');
  check((await st()).view === 'gate' && /Micro steps/.test(await p.innerText('.panel-hint')), 'Drum 1 Gate view explains micro steps');
  let tg = await target();
  const plain = await pw(({ t, p: pt, k }) => window.patchworker.proj.stepMicro(t, pt, k), tg);
  check(plain[0] && plain.filter(Boolean).length === 1, `step ${tg.k + 1} starts as a plain hit (micro step 0 lit)`);
  check(await p.$eval(pad(16), (x) => x.classList.contains('on')) && !(await p.$eval(pad(19), (x) => x.classList.contains('on'))), 'pad 17 is lit, pad 20 is not');
  await p.click(pad(19));
  let mic = await pw(({ t, p: pt, k }) => window.patchworker.proj.stepMicro(t, pt, k), tg);
  check(mic[0] && mic[3] && mic.filter(Boolean).length === 2, 'pad 20 adds a hit on micro step 3');
  await p.click(pad(16));
  mic = await pw(({ t, p: pt, k }) => window.patchworker.proj.stepMicro(t, pt, k), tg);
  check(!mic[0] && mic[3], 'pad 17 turns micro step 0 off: the hit is only on micro step 3');
  const raw = await pw(({ t, p: pt, k }) => window.patchworker.proj.raw(t, pt).steps[k], tg);
  check(raw.active && JSON.stringify(raw.micro) === JSON.stringify([false, false, false, true, false, false]), 'stored as the micro mask the file uses');
  check(/micro steps 4\b/.test(await p.innerText('.ct').catch(() => '')), 'the status strip shows it as micro step 4 (numbered 1-6)');
  const labels = await p.$$eval('.pads .pad.micro', (x) => x.map((d) => `${d.textContent}:${d.classList.contains('on') ? 'on' : d.classList.contains('dim') ? 'dim' : '?'}`));
  check(labels.join(' ') === '1:dim 2:dim 3:dim 4:on 5:dim 6:dim', `micro step pads numbered 1-6, dim, the one played bright (${labels.join(' ')})`);
  // An empty step: a micro step adds a hit.
  const empty = await pw(({ t, p: pt }) => { const pp = window.patchworker.proj; for (let k = 0; k < 16; k++) if (!pp.stepHas(t, pt, k)) return k; return -1; }, tg);
  if (empty >= 0) {
    await p.click(pad(empty));
    await p.click(pad(18));
    const m2 = await pw(([g, k]) => window.patchworker.proj.stepMicro(g.t, g.p, k), [tg, empty]);
    check(m2[2] && m2.filter(Boolean).length === 1, `a micro step on empty step ${empty + 1} adds a hit there`);
    await p.click(pad(18));
    check(!(await pw(([g, k]) => window.patchworker.proj.stepHas(g.t, g.p, k), [tg, empty])), 'turning it off again empties the step');
    await p.click(pad(tg.k));
  }
  await p.screenshot({ path: `${out}/micro-drum.png` });

  // ---- Drum grid: marks, the box
  await p.click('.view[data-view=note]');
  await p.click('.rollbtn');
  check(await p.isVisible('.roll[data-kind=drum]'), 'drum grid shown');
  const cell = `.dcell[data-t="4"][data-k="${tg.k}"]`;
  check(await p.$eval(cell, (c) => c.classList.contains('multi') && c.querySelectorAll('.dmicro i.on').length === 1 && c.querySelectorAll('.dmicro i')[3].classList.contains('on')), 'the edited hit shows its micro step (mark 4 of 6) and is outlined');
  await p.click(cell);
  check(await p.isVisible('.micropop'), 'clicking a hit with micro-step hits opens the micro step box (instead of removing it)');
  check(await pw(({ t, p: pt, k }) => window.patchworker.proj.stepHas(t, pt, k), tg), 'the hit is still there');
  await p.click('.micropop .mp-tick[data-m="5"]');
  mic = await pw(({ t, p: pt, k }) => window.patchworker.proj.stepMicro(t, pt, k), tg);
  check(mic[3] && mic[5] && mic.filter(Boolean).length === 2, 'the box turns micro step 5 on');
  await p.screenshot({ path: `${out}/micro-grid.png` });
  await p.keyboard.press('Escape');
  check(await p.isHidden('.micropop'), 'Esc closes the box');
  const plainCell = await pw(() => { const c = [...document.querySelectorAll('.dcell.on:not(.multi)')][0]; return c ? { t: +c.dataset.t, k: +c.dataset.k } : null; });
  if (plainCell) {
    await p.click(`.dcell[data-t="${plainCell.t}"][data-k="${plainCell.k}"]`, { modifiers: ['Shift'] });
    check(await p.isVisible('.micropop') && /step \d+: micro steps/.test(await p.innerText('.micropop .mp-title')), 'Shift-click on a plain hit opens the box too');
    await p.click('.micropop .mp-close');
  }
  await p.click('.rollbtn');

  // ---- Synth 1: Gate, then Gate again = Micro Step view
  await p.click('.trk[data-track="0"]');
  await p.click('.view[data-view=gate]');
  if ((await st()).view !== 'gate') await p.click('.view[data-view=gate]');
  await p.click('.view[data-view=gate]');
  check((await st()).view === 'micro', 'Synth 1: Gate pressed again opens Micro Step view');
  tg = await target();
  let notes = await pw(({ t, p: pt, k }) => window.patchworker.proj.stepNotes(t, pt, k), tg);
  if (!notes.length) {
    const k = await pw(({ t, p: pt }) => { const pp = window.patchworker.proj; for (let k = 0; k < 16; k++) if (pp.stepHas(t, pt, k)) return k; return -1; }, tg);
    await p.click(pad(k));
    tg = await target();
    notes = await pw(({ t, p: pt, k: kk }) => window.patchworker.proj.stepNotes(t, pt, kk), tg);
  }
  check(notes.length > 0, `step ${tg.k + 1} has ${notes.length} note(s)`);
  check(await p.$$eval('.pads .pad.noteslot', (x) => x.length) === notes.length, 'pads 25+ show one pad per note');
  check(await p.$$eval('.pads .pad.noteslot.on', (x) => x.length) === notes.length, 'all notes are chosen to start with');
  await p.click(pad(20));
  notes = await pw(({ t, p: pt, k }) => window.patchworker.proj.stepNotes(t, pt, k), tg);
  check(notes.every((n) => n.delay === 4), 'pad 21 delays every note by 4/6 of a step');
  if (notes.length > 1) {
    await p.click(pad(24));
    check(await p.$$eval('.pads .pad.noteslot.on', (x) => x.length) === 1, 'pad 25 chooses only the first note');
    await p.click(pad(17));
    notes = await pw(({ t, p: pt, k }) => window.patchworker.proj.stepNotes(t, pt, k), tg);
    check(notes[0].delay === 1 && notes.slice(1).every((n) => n.delay === 4), 'pad 18 then moves only that note to micro step 1');
    check(await p.$eval(pad(17), (x) => x.classList.contains('on')) && await p.$eval(pad(20), (x) => x.classList.contains('dim')), 'its micro step is bright, the other notes\' dim');
  }
  const played = await pw(({ t, p: pt, k }) => window.patchworker.proj.song.tracks[t].patterns[pt].steps[k].hits.map((h) => h.micro), tg);
  check(played.includes(4), `what plays has the delayed notes (micro steps ${played.join(', ')})`);
  // Tie forward
  await p.click(pad(23));
  check(await pw(({ t, p: pt, k }) => window.patchworker.proj.stepTie(t, pt, k), tg), 'pad 24 ties the step forward');
  check(await p.$eval(pad(23), (x) => x.classList.contains('on')), 'and lights');
  await p.click('.view[data-view=gate]');
  check((await st()).view === 'gate', 'Gate again goes back to Gate view');
  await p.click(pad(18));
  check(await pw(({ t, p: pt, k }) => window.patchworker.proj.stepTie(t, pt, k), tg), 'setting the gate keeps the tie');
  await p.click('.view[data-view=gate]');
  await p.click(pad(23));
  check(!(await pw(({ t, p: pt, k }) => window.patchworker.proj.stepTie(t, pt, k), tg)), 'pad 24 again unties it');
  await p.screenshot({ path: `${out}/micro-synth.png` });

  // ---- Piano roll: Shift-drag moves a note in sixths
  await p.click('.view[data-view=note]');
  await p.click('.rollbtn');
  await p.waitForSelector('.rnote');
  const nd = await p.$('.rnote');
  const info = await nd.evaluate((d) => ({ k: +d.dataset.k, j: +d.dataset.j, note: +d.dataset.note, delay: +d.dataset.delay }));
  const sw = await pw(() => parseFloat(getComputedStyle(document.querySelector('.roll-area')).getPropertyValue('--sw')));
  const box = await nd.boundingBox();
  const sx = box.x + Math.min(6, box.width / 3), sy = box.y + box.height / 2;
  await p.keyboard.down('Shift');
  await p.mouse.move(sx, sy);
  await p.mouse.down();
  await p.mouse.move(sx + sw * (2 / 6) * 0.5, sy, { steps: 2 });
  await p.mouse.move(sx + sw * (2 / 6), sy, { steps: 3 });
  await p.mouse.up();
  await p.keyboard.up('Shift');
  const pt0 = await pw(() => { const pp = window.patchworker.proj; return pp.sel[0].start; });
  const want = info.k * 6 + info.delay + 2;
  const moved = await pw(([pt, note, w]) => { const pp = window.patchworker.proj; const k = Math.floor(w / 6); return pp.stepNotes(0, pt, k).find((n) => n.note === note)?.delay; }, [pt0, info.note, want]);
  check(moved === want % 6, `Shift-drag moves ${info.note} two sixths later (step ${Math.floor(want / 6) + 1}, micro step ${moved} want ${want % 6})`);
  await p.click('.rollbtn');

  // ---- Save keeps it
  await p.click('.cbtn.save');
  await p.click('.cbtn.save');
  const savedDrum = await pw(async () => {
    const { parseNCS } = await import('/circuitgm/js/vendor/ncs.js');
    const pp = window.patchworker.proj, e = pp.entry;
    const bytes = pp.pack.files.get(e.url);
    const pr = parseNCS(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const pat = pr.patterns[4][pp.sel[4].start];
    return pat.steps.map((s) => (s.micro ? s.micro.map(Number).join('') : null)).filter(Boolean);
  });
  check(savedDrum.includes('000101'), `Save writes the drum micro steps (${savedDrum.join(' ')})`);

  check(!errors.length, `no console errors (${errors.join(' | ') || 'none'})`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
