// PatchWorker Scales (0.14): Scales view (root and scale pads), Note view's keyboard following the
// project's scale, Expanded Note view, transposing by root, snapping on a scale change, Save keeping
// the scale, and Download pack asking for a new name. Needs the RosettaGM root served on 8765.
// node tests/ui_scales.cjs <"Blue Monday.circuittrackspack" (project 1: D Dorian)> [screenshot dir]
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const packFile = process.argv[2];
  const out = process.argv[3] ?? 'tests/out';
  if (!packFile) { console.error('usage: node tests/ui_scales.cjs <Blue Monday pack> [out dir]'); process.exit(2); }
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const fails = [];
  const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_|fonts\./.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('http://localhost:8765/circuitgm/patchworker/');
  await p.evaluate(() => indexedDB.deleteDatabase('circuitgm-patchworker'));
  await p.goto('http://localhost:8765/circuitgm/patchworker/');
  await p.waitForFunction(() => window.patchworker?.S.pack);
  const pw = (fn, ...a) => p.evaluate(fn, ...a);
  const pad = (i) => `.pads .pad:nth-child(${i + 1})`;
  const padNote = (i) => p.$eval(pad(i), (x) => (x.dataset.note == null ? null : +x.dataset.note));

  // ---- No project (TracksGM): the keyboard is Chromatic, and Scales view changes only it.
  await p.click('#face [data-face=tracks]');
  check(await pw(() => window.patchworker.panel().state.view === 'note'), 'the panel opens in Note view');
  const whites = await p.$$eval('.ct .pads .pad.key.white', (x) => x.length);
  check(whites === 8, `no project: a Chromatic piano keyboard (${whites} white keys)`);
  await p.click('.view[data-view=scales]');
  check(/Scales · Chromatic/.test(await p.innerText('.panel-lcd')), 'Scales view says Chromatic');
  await p.click(pad(16 + 1));   // Major
  await p.click('.view[data-view=note]');
  check(await p.$$eval('.pad.key.scale', (x) => x.length) === 16, 'choosing Major gives a 16-pad scale keyboard');
  const n24 = await padNote(24), n31 = await padNote(31), n16 = await padNote(16);
  check(n31 - n24 === 12 && n16 === n31, `rows: pad 25 ${n24}, pad 32 an octave up (${n31}) = pad 17 (${n16})`);
  check(await padNote(26) - n24 === 4, 'Major: the third key is a major third above the root');
  await p.click('.view[data-view=scales]');
  await p.click(pad(16 + 15));   // back to Chromatic

  // ---- Blue Monday project 1: D Dorian
  await p.setInputFiles('#file-pack', packFile);
  await p.waitForFunction(() => window.patchworker.S.pack.fileName !== 'TracksGM_v1.circuittrackspack');
  await p.click('.view[data-view=projects]');
  await p.click('.pad.project[data-project="0"]');
  await p.waitForFunction(() => window.patchworker.proj.loaded);
  await p.click('.trk[data-track="0"]');
  await p.click('.view[data-view=scales]');
  check(/D Dorian/.test(await p.innerText('.panel-lcd')), 'Scales view shows the project\'s scale: D Dorian');
  check(await p.$eval('.pad.keynote.root', (x) => x.textContent) === 'D', 'the D pad is the root');
  check(await p.$eval('.pad.scale.sel', (x) => x.textContent) === 'Dorian', 'Dorian is lit');
  const lit = await p.$$eval('.pad.keynote.on', (x) => x.map((e) => e.textContent).sort().join(' '));
  check(lit === 'A B C D E F G', `bright keynotes are D Dorian's notes (${lit})`);
  await p.click('.view[data-view=note]');
  const root = await padNote(24);
  check(root % 12 === 2 && await p.$eval(pad(24), (x) => x.classList.contains('root')), `Note view keyboard starts on D (${root})`);
  check(/D Dorian/.test(await p.innerText('.panel-lcd')), 'the LCD names the scale in Note view');
  await p.screenshot({ path: `${out}/scales-note.png` });

  // Notes as they sound before changing anything (pattern 1, Synth 1).
  const notesOf = () => pw(() => { const pp = window.patchworker.proj, out = []; for (let k = 0; k < 32; k++) out.push(...pp.stepNotes(0, 0, k).map((n) => n.note)); return out; });
  const before = await notesOf();
  check(before.length > 0, `Synth 1 pattern 1 has ${before.length} notes`);

  // ---- Root E: everything moves up a tone.
  await p.click('.view[data-view=scales]');
  await p.click(pad(8 + 2));   // E
  const up = await notesOf();
  check(up.every((n, i) => n === before[i] + 2), 'root D -> E transposes the notes up a tone');
  check(/edited, not saved/.test(await p.innerText('.panel-lcd')), 'changing the scale edits the project');
  await p.click(pad(8 + 1));   // back to D
  check(JSON.stringify(await notesOf()) === JSON.stringify(before), 'back to D: as before');

  // ---- Scale Major: F (a minor third above D) is not in D major and snaps to the nearest note.
  await p.click(pad(16 + 1));
  const maj = await notesOf();
  const inMaj = (n) => [0, 2, 4, 5, 7, 9, 11].includes(((n - 2) % 12 + 12) % 12);
  check(maj.every(inMaj), 'in D Major every note plays in the scale');
  check(maj.some((n, i) => n !== before[i]) && maj.every((n, i) => Math.abs(n - before[i]) <= 1), 'notes not in it move by a semitone at most');
  await p.click(pad(16 + 2));   // Dorian again
  check(JSON.stringify(await notesOf()) === JSON.stringify(before), 'Dorian again: the notes are as they were (nothing lost)');

  // ---- Expanded Note view: Note pressed again
  await p.click('.view[data-view=note]');
  await p.click('.view[data-view=note]');
  check(await pw(() => window.patchworker.panel().state.view === 'expand'), 'Note again opens Expanded Note view');
  check(await p.$$eval('.pad.key.scale', (x) => x.length) === 32, 'a 32-pad scale keyboard');
  check(await padNote(8) === await padNote(23) && await padNote(0) - await padNote(24) === 36, 'four rows rising from the bottom, each starting on the last note of the row below');
  await p.click('.view[data-view=note]');
  check(await pw(() => window.patchworker.panel().state.view === 'note'), 'Note again goes back');

  // ---- Save keeps the scale
  await p.click('.view[data-view=scales]');
  await p.click(pad(8 + 4));   // G
  await p.click(pad(16 + 1));  // Major
  await p.click('.cbtn.save'); await p.click('.cbtn.save');
  const saved = await pw(async () => {
    const { readProject } = await import('/circuitgm/js/pack.js?v=20261122b');
    const pk = window.patchworker.S.pack, d = pk.files.get(pk.index.projects[0].url);
    const pr = readProject('circuit-tracks', d.slice().buffer);
    return [pr.scaleRoot, pr.scaleType];
  });
  check(saved[0] === 7 && saved[1] === 1, `Save keeps the root and scale (${saved})`);
  check(/nothing is written to disk until you Download pack/.test(await p.innerText('.panel-hint')), 'the Save message says nothing is written to disk');

  // ---- Download pack asks for a new name
  await p.click('#pack-save');
  const dlg = await p.waitForSelector('dialog[open] input[type=text]');
  check(await dlg.inputValue() === 'Blue Monday 2', `Download pack suggests a new name (${await dlg.inputValue()})`);
  check(/Blue Monday 2\.circuittrackspack/.test(await p.innerText('dialog[open]')), 'and shows the file name');
  await dlg.fill('BM Scales');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('dialog[open] button.primary, dialog[open] button:has-text("Download")')]);
  check(dl.suggestedFilename() === 'BM Scales.circuittrackspack', `the file is named from it (${dl.suggestedFilename()})`);
  check(await p.inputValue('#pack-name') === 'BM Scales', 'and the pack takes the name');

  check(!errors.length, `no console errors (${errors.join(' | ') || 'none'})`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
