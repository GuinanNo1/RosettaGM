// PatchWorker step editing and Save (0.13): Note view (synth keys, drum taps), Clear, Duplicate,
// 1-16/17-32, Velocity, Gate, Probability, Pattern Settings, Save (same slot, another slot) and the
// saved project surviving a reload. Needs the RosettaGM root served on port 8765.
// node tests/ui_edit.cjs <pack with projects, e.g. "Blue Monday.circuittrackspack"> [screenshot dir]
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const packFile = process.argv[2];
  const out = process.argv[3] ?? 'tests/out';
  if (!packFile) { console.error('usage: node tests/ui_edit.cjs <pack.circuittrackspack> [out dir]'); process.exit(2); }
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const fails = [];
  const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const p = await ctx.newPage();
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
  const slot = await p.evaluate(() => +document.querySelector('.pad.project.filled').dataset.project);
  await p.click(`.pad.project[data-project="${slot}"]`);
  await p.waitForFunction(() => window.patchworker.proj.loaded);
  const pw = (fn, ...a) => p.evaluate(fn, ...a);
  const pat = () => pw(() => { const pp = window.patchworker.proj, st = window.patchworker.panel().state; return pp.sel[st.track].start; });
  const pad = (i) => `.pads .pad:nth-child(${i + 1})`;
  // Go to a view without pressing its button a second time (that opens its secondary view).
  const view = async (id) => { if (await pw(() => window.patchworker.panel().state.view) !== id) await p.click(`.view[data-view=${id}]`); };

  // ---- Note view, Synth 1: choose an empty step, add a note from the keys, remove it again.
  await p.click('.trk[data-track="0"]');
  await view('note');
  const p0 = await pat();
  let empty = await pw((pt) => { const pp = window.patchworker.proj; for (let k = 0; k < 16; k++) if (!pp.stepHas(0, pt, k)) return k; return -1; }, p0);
  if (empty < 0) {
    // Every step has notes: clear step 1 to start from.
    await p.click('.cbtn.clear'); await p.click(pad(0)); await p.click('.cbtn.clear');
    empty = 0;
  }
  check(!(await pw(([pt, k]) => window.patchworker.proj.stepHas(0, pt, k), [p0, empty])), `Synth 1 pattern ${p0 + 1}: step ${empty + 1} is empty to start with`);
  const evBefore = await pw(() => window.patchworker.proj.render.events.length);
  await p.click(pad(empty));
  check(await p.$eval(pad(empty), (x) => x.classList.contains('armed')), 'pressing a step chooses it (red)');
  const key = await p.$eval('.pad.key.root', (x) => +x.dataset.note);
  await p.click('.pad.key.root');
  let notes = await pw(([pt, k]) => window.patchworker.proj.stepNotes(0, pt, k).map((n) => n.note), [p0, empty]);
  check(notes.length === 1 && notes[0] === key, `a key adds its note to the step (${notes})`);
  check(await p.$eval('.pad.key.root', (x) => x.classList.contains('instep')), 'the key lights as on the step');
  check(await pw(() => window.patchworker.proj.render.events.length) > evBefore, 'the new note is in what plays');
  check(/edited, not saved/.test(await p.innerText('.panel-lcd')), 'the LCD says the project is edited');
  await p.click(pad(27));
  notes = await pw(([pt, k]) => window.patchworker.proj.stepNotes(0, pt, k).length, [p0, empty]);
  check(notes === 2, 'a second key adds a second note');
  await p.click('.pad.key.root');
  notes = await pw(([pt, k]) => window.patchworker.proj.stepNotes(0, pt, k).map((n) => n.note), [p0, empty]);
  check(notes.length === 1 && notes[0] !== key, 'pressing a key on the step again removes that note');
  await p.click(pad(empty));
  check(!(await pw(() => window.patchworker.panel().state.armed)), 'pressing the step again lets go of it');

  // ---- Clear and Duplicate
  await p.click('.cbtn.dup');
  await p.click(pad(empty));
  const dest = (empty + 2) % 16;
  await p.click(pad(dest));
  check(await pw(([pt, a, b]) => JSON.stringify(window.patchworker.proj.stepNotes(0, pt, a)) === JSON.stringify(window.patchworker.proj.stepNotes(0, pt, b)), [p0, empty, dest]), `Duplicate copies step ${empty + 1} to step ${dest + 1}`);
  await p.click('.cbtn.dup');
  await p.click('.cbtn.clear');
  check(await p.$eval('.cbtn.clear', (x) => x.classList.contains('on')), 'Clear turns on');
  await p.click(pad(dest));
  check(!(await pw(([pt, k]) => window.patchworker.proj.stepHas(0, pt, k), [p0, dest])), 'Clear then a step clears it');
  await p.keyboard.press('Escape');
  check(!(await pw(() => window.patchworker.panel().state.mode)), 'Esc turns Clear off');

  // ---- Velocity, Gate, Probability on the step with a note
  await p.click('.view[data-view=velocity]');
  await p.click(pad(empty));
  await p.click(pad(16 + 5));   // pad 6 of the fader: 48
  check(await pw(([pt, k]) => window.patchworker.proj.stepNotes(0, pt, k)[0].vel, [p0, empty]) === 48, 'Velocity: pad 6 sets 48');
  check(await p.$$eval('.pad.lvl.on', (x) => x.length) === 6, 'Velocity: six pads lit');
  await p.click('.view[data-view=gate]');
  await p.click(pad(16 + 3));   // 4 steps
  check(await pw(([pt, k]) => window.patchworker.proj.stepNotes(0, pt, k)[0].gate, [p0, empty]) === 24, 'Gate: pad 4 sets 4 steps');
  await p.click(pad(16 + 3));
  check(await pw(([pt, k]) => window.patchworker.proj.stepNotes(0, pt, k)[0].gate, [p0, empty]) === 23, 'Gate: pad 4 again shortens it by a sixth');
  check(/gate 3 5\/6 steps/.test(await p.innerText('.panel-lcd')), 'Gate: the LCD shows 3 5/6 steps');
  await p.click('.view[data-view=pattern]');
  await p.click('.view[data-view=pattern]');
  check(await pw(() => window.patchworker.panel().state.view === 'probability'), 'Pattern Settings again opens Probability');
  await p.click(pad(16 + 3));
  check(await pw(([pt, k]) => window.patchworker.proj.raw(0, pt, k).steps[k].probability, [p0, empty]) === 3, 'Probability: pad 4 sets 50%');

  // ---- Pattern Settings
  await p.click('.view[data-view=pattern]');
  check(await pw(() => window.patchworker.panel().state.view === 'pattern'), 'Pattern Settings again goes back');
  await p.click(pad(11));
  check(await pw((pt) => window.patchworker.proj.raw(0, pt).settings.playbackEnd, p0) === 11, 'a step sets the end point (12 steps)');
  await p.click('.cbtn.shift');
  await p.click(pad(2));
  check(await pw((pt) => window.patchworker.proj.raw(0, pt).settings.playbackStart, p0) === 2, 'Shift + a step sets the start point');
  await p.click(pad(16 + 2));
  check(await pw((pt) => window.patchworker.proj.raw(0, pt).settings.syncRate, p0) === 5, 'sync rate pad 3 is 1/8');
  await p.click(pad(24 + 5));
  check(await pw((pt) => window.patchworker.proj.raw(0, pt).settings.direction, p0) === 1, 'pad 30 is reverse');
  await p.click(pad(15));
  await p.click('.cbtn.shift');
  await p.click(pad(0));
  await p.click(pad(16 + 4));
  await p.click(pad(24 + 4));

  // ---- 1-16/17-32
  await view('note');
  await p.click('.cbtn.steppage');
  check(await pw((pt) => window.patchworker.proj.raw(0, pt).settings.playbackEnd, p0) === 31, '1-16/17-32 makes the pattern 32 steps');
  await p.click('.cbtn.steppage');
  check(/steps 17-32/.test(await p.innerText('.panel-lcd')) && await p.$eval(pad(0), (x) => x.textContent === '17'), 'pressed again it shows steps 17-32');
  await p.click('.cbtn.clear');
  await p.click('.cbtn.steppage');
  await p.click('.cbtn.clear');
  check(await pw((pt) => window.patchworker.proj.raw(0, pt).settings.playbackEnd, p0) === 15, 'Clear + 1-16/17-32 puts it back to 16 steps');

  // ---- Drum 1: tap a step on and off
  await p.click('.trk[data-track="4"]');
  const dp = await pat();
  let dk = await pw((pt) => { const pp = window.patchworker.proj; for (let k = 0; k < 16; k++) if (!pp.stepHas(4, pt, k)) return k; return -1; }, dp);
  if (dk < 0) { await p.click('.cbtn.clear'); await p.click(pad(0)); await p.click('.cbtn.clear'); dk = 0; }
  await p.click(pad(dk));
  check(await pw(([pt, k]) => window.patchworker.proj.stepHas(4, pt, k), [dp, dk]), `Drum 1: a tap adds a hit on step ${dk + 1}`);
  await p.click(pad(dk));
  check(!(await pw(([pt, k]) => window.patchworker.proj.stepHas(4, pt, k), [dp, dk])), 'and another tap removes it');
  await p.click(pad(dk));

  // ---- Drum sample pads (bottom rows): 16 of the 64 samples, tap = the track's sample, hold =
  // sample flip; holding a step lights its sample red; a long press on a step arms it.
  check(await p.$$eval('.pad.dsample', (x) => x.length) === 16, '16 sample pads');
  const lsel = (sel) => p.$(sel).then((h) => h.boundingBox());
  const longPress = async (sel, ms = 650) => { const b = await lsel(sel); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down(); await p.waitForTimeout(ms); await p.mouse.up(); };
  const act0 = await pw(() => window.patchworker.proj.entry.project.defaultDrums[0]);
  check(await p.$eval('.pad.dsample.lit', (x) => +x.dataset.dsample) === act0, `the lit sample pad is Drum 1's sample (${act0 + 1})`);
  await p.click('.cbtn.arrow:has-text("▲")');
  const pg = await pw(() => window.patchworker.panel().state.dpage[0]);
  check(pg === Math.min(3, Math.floor(act0 / 16) + 1), `▲ shows the next 16 samples (page ${pg + 1})`);
  const newSmp = await p.$eval('.pad.dsample:not(.lit)', (x) => +x.dataset.dsample);
  await p.click(`.pad.dsample[data-dsample="${newSmp}"]`);
  check(await pw(() => window.patchworker.proj.entry.project.defaultDrums[0]) === newSmp, `a tap makes sample ${newSmp + 1} Drum 1's sample`);
  check(await pw(([pt, k]) => window.patchworker.proj.stepSample(4, pt, k), [dp, dk]) === newSmp, 'hits without their own sample play it');
  const flipSmp = await p.$$eval('.pad.dsample:not(.lit)', (x) => +x[1].dataset.dsample);
  await longPress(`.pad.dsample[data-dsample="${flipSmp}"]`);
  check(await pw(() => window.patchworker.panel().state.flip) === flipSmp, 'a long press arms a sample flip');
  const fk = (dk + 1) % 16;
  await p.click(pad(fk));
  check(await pw(([pt, k]) => window.patchworker.proj.stepSample(4, pt, k), [dp, fk]) === flipSmp, `a step pressed then plays sample ${flipSmp + 1}`);
  await p.keyboard.press('Escape');
  check(await p.$eval(pad(fk), (x) => x.classList.contains('flip')), 'the flipped step is pink');
  await p.click('.cbtn.arrow:has-text("▼")');
  // Hold the flipped step: its sample lights red (turning to its page).
  { const b = await lsel(pad(fk)); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down(); await p.waitForTimeout(150);
    check(await p.$eval('.pad.dsample.flipsrc', (x) => +x.dataset.dsample).catch(() => null) === flipSmp, 'holding a step lights its sample red');
    check(/its own sample/.test(await p.innerText('.panel-lcd')), 'the LCD names the step\'s own sample');
    await p.waitForTimeout(600); await p.mouse.up(); }
  check(await pw(() => window.patchworker.panel().state.stepFlip) === fk, 'a long press on a step arms it');
  await p.click(`.pad.dsample[data-dsample="${newSmp}"]`);
  check(await pw(([pt, k]) => window.patchworker.proj.stepSample(4, pt, k), [dp, fk]) === newSmp && await pw(() => window.patchworker.panel().state.stepFlip) == null, 'then a sample pad gives the step that sample');
  await p.screenshot({ path: `${out}/edit-note-drum.png` });

  // ---- Save over the project
  await p.click('.cbtn.save');
  check(await p.$eval('.cbtn.save', (x) => x.classList.contains('armed')), 'Save once: it flashes');
  await p.click('.cbtn.save');
  const saved = await pw(([s, pt, k, dpt, dkk]) => {
    const pk = window.patchworker.S.pack, url = pk.index.projects[s].url;
    return { edited: window.patchworker.proj.edited, inSet: pk.savedProjects.has(s), url, dset: window.patchworker.proj.raw(4, dpt).steps[dkk].active };
  }, [slot, p0, empty, dp, dk]);
  check(!saved.edited && saved.inSet && saved.dset, 'Save again: saved into the pack, no longer edited');
  // What was written reads back with the edits.
  const back = await pw(async ([s, pt, k]) => {
    const { readProject } = await import('/circuitgm/js/pack.js?v=20261122b');
    const d = window.patchworker.S.pack.files.get(window.patchworker.S.pack.index.projects[s].url);
    const proj = readProject('circuit-tracks', d.slice().buffer);
    const st = proj.patterns[0][pt].steps[k];
    return { drums: proj.defaultDrums[0], mask: st.mask, vel: st.notes.find((n, j) => (st.mask >> j) & 1)?.velocity, gate: st.notes.find((n, j) => (st.mask >> j) & 1)?.gate, prob: st.probability, tempo: proj.tempo };
  }, [slot, p0, empty]);
  check(back.drums !== act0, `the saved file has Drum 1's new sample (${back.drums + 1})`);
  check(back.mask && back.vel === 48 && back.gate === 23 && back.prob === 3, `the saved file has the step's note, velocity, gate and probability (${JSON.stringify(back)})`);

  // ---- Save to another project slot (Projects view: Save, then a pad)
  await p.click('.trk[data-track="0"]');
  await view('note');
  await p.click(pad(empty));
  await p.click('.cbtn.clear');
  await p.click(pad(empty));
  await p.click('.cbtn.clear');
  check(await pw(() => window.patchworker.proj.edited), 'another edit marks it edited again');
  await p.click('.view[data-view=projects]');
  const target = await pw(() => window.patchworker.S.pack.projectList.findIndex((e, i) => e.empty && i < 32));
  await p.click('.cbtn.save');
  check(await p.$$eval('.pad.project.target', (x) => x.length) === 32, 'with Save waiting every project pad is a target');
  await p.click(pad(target % 32));
  const two = await pw(([s, t, pt, k]) => {
    const pk = window.patchworker.S.pack, list = pk.projectList;
    return { now: window.patchworker.proj.entry.slot, newHas: !list[t].empty, newStep: window.patchworker.proj.stepHas(0, pt, k), oldEdited: !!list[s].edited, name: pk.index.projects[t].name, oldName: pk.index.projects[s].name };
  }, [slot, target, p0, empty]);
  check(two.now === target && two.newHas && !two.newStep && !two.oldEdited && two.name === two.oldName, `saved to project ${target + 1}; project ${slot + 1} keeps its saved version (${JSON.stringify(two)})`);
  check(await pw(([s, pt, k]) => { const pk = window.patchworker.S.pack; return pk.projectList[s].project.patterns[0][pt].steps[k].mask !== 0; }, [slot, p0, empty]), `project ${slot + 1} still has the note saved earlier`);
  await p.screenshot({ path: `${out}/edit-projects.png` });

  // ---- The saved projects come back after a reload, and go into Download pack
  await pw(() => new Promise((r) => setTimeout(r, 600)));
  await p.reload();
  await p.waitForFunction(() => window.patchworker?.S.pack?.savedProjects);
  const after = await pw(([s, t]) => { const pk = window.patchworker.S.pack; return { saved: [...pk.savedProjects].sort((a, b) => a - b), tHas: pk.files.has(pk.index.projects[t].url), notDl: [...pk.projectsNotDownloaded] }; }, [slot, target]);
  check(after.saved.includes(slot) && after.saved.includes(target) && after.tHas, `after a reload the saved projects are back (${JSON.stringify(after)})`);
  const inZip = await pw(async (t) => {
    const pw2 = window.patchworker;
    const { blob } = await pw2.buildPack(pw2.S.pack, { name: 'x' });
    const { readZip } = await import('/circuitgm/js/vendor/zip.js');
    const zip = readZip(await blob.arrayBuffer());
    const index = JSON.parse(new TextDecoder().decode(await zip.get('index.json')()));
    const url = index.projects[t].url;
    return !!zip.get(url) && (await zip.get(url)()).byteLength === 160780;
  }, target);
  check(inZip, 'Download pack contains the project saved to the new slot');

  check(!errors.length, `no console errors (${errors.join(' | ') || 'none'})`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
