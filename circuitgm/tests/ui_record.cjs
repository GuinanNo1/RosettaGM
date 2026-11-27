// PatchWorker 0.28: Record mode (User Guide pp. 35-37, 62-64, 71). Record (or R) turns it on;
// held for more than half a second it ends on release; Shift + Record is Rec Quantise. While
// recording and playing, notes played by hand go into the pattern the track plays (nearest step,
// or nearest micro step with Rec Quantise off) with a gate as long as they were held; drum sample
// pads record hits (a sample flip for a sample that isn't the track's); turned knobs write their
// value from then until Record ends. Stopped, with a step chosen in Note view, a turned macro
// knob is written on that step. Recording doesn't restart playback.
// Needs the RosettaGM root served on 8765.
// node tests/ui_record.cjs <Blue Monday.circuittrackspack>
const { chromium } = require('playwright');

(async () => {
  const packFile = process.argv[2];
  if (!packFile) { console.error('usage: node tests/ui_record.cjs <Blue Monday pack>'); process.exit(2); }
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] }).catch(() => chromium.launch());
  const fails = [];
  const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
  const errors = [];
  const p = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_|fonts\./.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('http://localhost:8765/circuitgm/patchworker/');
  await p.evaluate(() => { indexedDB.deleteDatabase('circuitgm-patchworker'); localStorage.clear(); });
  await p.goto('http://localhost:8765/circuitgm/patchworker/');
  await p.waitForFunction(() => window.patchworker?.S.pack);
  await p.setInputFiles('#file-pack', packFile);
  await p.waitForFunction(() => window.patchworker.proj.loaded);
  const pw = (fn, ...a) => p.evaluate(fn, ...a);
  await p.click('#face [data-face=tracks]');
  await pw(() => { const pp = window.patchworker.proj; pp.selectScene(pp.scene); window.patchworker.panel().selectTrack(0); window.patchworker.panel().selectView('note'); });
  const rec = '.cbtn.tbtn.rec';
  const recOn = () => p.$eval(rec, (b) => b.classList.contains('on'));
  const notesOf = (t) => pw((t) => { const pp = window.patchworker.proj; const pat = pp.sel[t].start; const out = []; for (let k = 0; k < 32; k++) for (const n of pp.stepNotes(t, pat, k)) out.push({ k, note: n.note, gate: n.gate, delay: n.delay ?? pp.raw(t, pat).steps[k].notes[n.j].delay }); return out; }, t);
  const diff = (a, b) => b.filter((x) => !a.some((y) => y.k === x.k && y.note === x.note));

  // Record button and Rec Quantise legend.
  await p.click(rec);
  check(await recOn(), 'Record turns Record mode on (button lit)');
  check(await pw(() => window.patchworker.proj.recording), 'the project is recording');
  await p.keyboard.down('Shift');
  check(await p.$eval(`${rec} .leg`, (e) => e.textContent) === 'Quantise on', 'with Shift held its legend says Quantise on');
  await p.keyboard.up('Shift');
  await p.click(rec);
  check(!(await recOn()), 'Record again turns it off');

  // A note recorded while playing, quantised, with the gate it was held for.
  await pw(() => window.patchworker.proj.play());
  await p.waitForFunction(() => window.patchworker.proj.playing && window.patchworker.proj.player.position > 0.3);
  await p.click(rec);
  const start0 = await pw(() => window.patchworker.proj.player.startTime);
  const before = await notesOf(0);
  const where = await pw(() => { const pp = window.patchworker.proj; const at = pp.recPlace(0); window.patchworker.panel().recNote(61, 100, true); return { ...at, pos: pp.player.position }; });
  await p.waitForTimeout(300);
  const held = await pw(() => { const pp = window.patchworker.proj; window.patchworker.panel().recNote(61, 0, false); return pp.player.position; });
  let added = diff(before, await notesOf(0));
  check(added.length === 1, `a note played while recording is added (${JSON.stringify(added)})`);
  const want = Math.round(((held - where.pos) / where.stepSec) * 6);
  check(added[0] && added[0].k === where.k && added[0].delay === 0, `on the nearest step, ${where.k + 1} (got ${added[0] && added[0].k + 1}, micro ${added[0]?.delay})`);
  check(added[0] && Math.abs((added[0].gate & 0x7f) - want) <= 2, `with a gate as long as it was held (${added[0] && added[0].gate & 0x7f} sixths, held ${want})`);
  check(await pw(() => window.patchworker.proj.player.startTime) === start0, 'playback carried on without restarting');
  check(await pw(() => window.patchworker.proj.edited), 'the project is edited (Save keeps it)');
  check(await p.$$eval('.tracks.rec .pad.step.play', (x) => x.length) <= 1 && await p.$eval('#tracks', (e) => e.classList.contains('rec')), 'the panel shows Record mode (red step cursor)');

  // The computer keyboard records too.
  const b2 = await notesOf(0);
  await p.evaluate(() => document.activeElement?.blur());
  await p.keyboard.down('j');
  await p.waitForTimeout(150);
  await p.keyboard.up('j');
  added = diff(b2, await notesOf(0));
  check(added.length === 1, `a computer key records a note (${JSON.stringify(added)})`);

  // Rec Quantise off: the nearest micro step.
  await p.keyboard.down('Shift');
  await p.click(rec);
  await p.keyboard.up('Shift');
  check(await recOn() && !(await pw(() => window.patchworker.proj.rec.quantise)), 'Shift + Record turns Rec Quantise off (Record stays on)');
  let got = null;
  for (let tries = 0; tries < 20 && !got; tries++) {
    const b3 = await notesOf(0);
    const at = await pw(() => { const pp = window.patchworker.proj; const a = pp.recPlace(0); if (pp.stepNotes(0, a.p, a.k).length || a.m === 0) return null; window.patchworker.panel().recNote(66, 100, true); window.patchworker.panel().recNote(66, 0, false); return a; });
    if (!at) { await p.waitForTimeout(37); continue; }
    const a3 = diff(b3, await notesOf(0));
    got = { at, a3 };
  }
  check(got && got.a3.length === 1 && got.a3[0].k === got.at.k && got.a3[0].delay === got.at.m, `a note lands on its micro step (${got && JSON.stringify(got.a3)}, wanted step ${got && got.at.k + 1} micro ${got?.at.m})`);
  await p.keyboard.down('Shift');
  await p.click(rec);
  await p.keyboard.up('Shift');

  // Held Record: punch in and out.
  await p.click(rec);
  check(!(await recOn()), 'Record off');
  const box = await p.$eval(rec, (b) => { const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await p.mouse.move(box.x, box.y);
  await p.mouse.down();
  check(await recOn(), 'pressing Record turns it on');
  await p.waitForTimeout(650);
  await p.mouse.up();
  check(!(await recOn()), 'held for more than half a second, it turns off when let go');

  // R key.
  await p.keyboard.press('r');
  check(await recOn(), 'the R key turns Record on');

  // A macro knob turned while recording: recorded on Synth 1's pattern, the project's knob unchanged.
  const m5 = await pw(() => window.patchworker.proj.macro(0, 4));
  await p.focus('#macro-row .macro:nth-child(5) .knob');
  for (let i = 0; i < 5; i++) await p.keyboard.press('ArrowDown');
  await p.waitForTimeout(400);
  const lane = await pw(() => { const pp = window.patchworker.proj; const pat = pp.sel[0].start; const l = pp.laneLocks(0, pat, 'macro5'); const v = pp.recLatched(0, 'macro5'); const steps = (pp.raw(0, pat).settings.playbackEnd ?? 15) + 1; const sec = pp.placeAt(pp.player.position).tracks[0].stepSec; return { n: l.filter((x) => x[1] === v).length, total: steps * 6, perSec: 6 / sec, latched: v }; });
  // About 0.4 s of play head (plus the key presses) at 6 positions a step: far fewer than the whole pattern.
  check(lane.n >= 3 && lane.n < lane.total / 2 && lane.n <= lane.perSec * 1.5 && lane.latched === m5 - 5, `turning Macro 5 records it from there as the pattern plays (${lane.n} of ${lane.total} positions, ~${Math.round(lane.perSec)} a second; knob ${lane.latched})`);
  check(await pw(() => window.patchworker.proj.macro(0, 4)) === m5, `the project's own Macro 5 position stays ${m5}`);

  // Mixer view: a level turned while recording.
  await pw(() => window.patchworker.panel().selectView('mixer'));
  await p.waitForSelector('.pad.scene');
  const lv0 = await pw(() => window.patchworker.proj.levels[0]);
  await pw(() => window.patchworker.panel().mixKnobs().set(0, 30));
  await p.waitForTimeout(300);
  const lvl = await pw(() => { const pp = window.patchworker.proj; return { has: pp.laneHasData(0, pp.sel[0].start, 'level'), live: pp.liveMix(0, 'level'), base: pp.levels[0] }; });
  check(lvl.has && lvl.live === 30 && lvl.base === lv0, `Mixer view: Synth 1's level recorded at 30 (shown ${lvl.live}), its own level stays ${lv0}`);
  check(await p.$eval('#macro-row .macro:nth-child(1) .knob', (e) => +e.getAttribute('aria-valuenow')) === 30, 'knob 1 shows the recorded level');

  // Record off: the turned knobs are let go.
  await p.click(rec);
  check(await pw(() => window.patchworker.proj.rec.latches.size === 0 && !window.patchworker.proj.player.holdKeys?.size), 'Record off lets the turned knobs go');

  // Drum 1: a sample pad hit while recording (a sample flip).
  await pw(() => { window.patchworker.panel().selectTrack(4); window.patchworker.panel().selectView('note'); });
  await p.waitForSelector('.pad[data-dsample]');
  await p.click(rec);
  const drum = await pw(() => { const pp = window.patchworker.proj; const own = pp.entry.project.defaultDrums?.[0]; const pads = [...document.querySelectorAll('.pad[data-dsample]')].map((e) => +e.dataset.dsample); return { own, slot: pads.find((x) => x !== own) }; });
  let hit = null;
  for (let tries = 0; tries < 30 && !hit; tries++) {
    const at = await pw(() => { const pp = window.patchworker.proj; const a = pp.recPlace(4); return pp.raw(4, a.p).steps[a.k].active ? null : a; });
    if (!at) { await p.waitForTimeout(60); continue; }
    await p.click(`.pad[data-dsample="${drum.slot}"]`);
    hit = await pw((at) => { const pp = window.patchworker.proj; const s = pp.raw(4, at.p).steps; for (const k of [at.k, (at.k + 1) % 32, (at.k + 31) % 32]) if (s[k].active && s[k].drumChoice !== 0xff) return { k, choice: s[k].drumChoice }; return null; }, at);
  }
  check(hit && hit.choice === drum.slot, `a sample pad hit records a hit with that sample (${JSON.stringify(hit)}, sample ${drum.slot})`);
  await p.click(rec);

  // Stopped, a step chosen in Note view: a turned macro is written on that step.
  await pw(() => window.patchworker.proj.stop());
  await pw(() => { window.patchworker.panel().selectTrack(0); window.patchworker.panel().selectView('note'); });
  await p.click(rec);
  await p.click('.pad[data-step="2"]');
  await p.focus('#macro-row .macro:nth-child(6) .knob');
  await p.keyboard.press('ArrowUp');
  const st6 = await pw(() => { const pp = window.patchworker.proj; return pp.laneLocks(0, pp.sel[0].start, 'macro6').filter((x) => x[0] >= 2 && x[0] < 3); });
  check(st6.length === 1 && st6[0][0] === 2, `stopped, with step 3 chosen, Macro 6 is written on step 3 (${JSON.stringify(st6)})`);
  await p.click(rec);

  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
