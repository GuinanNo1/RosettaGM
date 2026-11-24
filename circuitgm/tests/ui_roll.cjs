// PatchWorker piano roll and drum grid (0.16): the Piano roll / Drum grid button in Note view,
// double-click in Patterns view, adding, lengthening, moving, resizing, removing notes, wheel
// velocity, drum grid hits, and going back. Needs the RosettaGM root served on 8765.
// node tests/ui_roll.cjs <"Blue Monday.circuittrackspack"> [screenshot dir]
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const packFile = process.argv[2];
  const out = process.argv[3] ?? 'tests/out';
  if (!packFile) { console.error('usage: node tests/ui_roll.cjs <pack with projects> [out dir]'); process.exit(2); }
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
  await p.click('.pad.project.filled');
  await p.waitForFunction(() => window.patchworker.proj.loaded);
  const pw = (fn, ...a) => p.evaluate(fn, ...a);
  const view = () => pw(() => window.patchworker.panel().state.view);
  await p.click('.trk[data-track="0"]');
  if (await view() !== 'note') await p.click('.view[data-view=note]');

  // ---- Note view's button opens the piano roll
  check(await p.isVisible('.rollbtn') && (await p.innerText('.rollbtn')) === 'Piano roll', 'Note view has a Piano roll button');
  await p.click('.rollbtn');
  check(await view() === 'roll' && await p.isHidden('.pads') && await p.isVisible('.roll'), 'it shows the piano roll instead of the pads');
  check(/Piano roll · pattern \d+/.test(await p.innerText('.panel-lcd')), 'the LCD says Piano roll and the pattern');
  const pt = await pw(() => window.patchworker.proj.sel[0].start);
  const count = () => pw((x) => { const pp = window.patchworker.proj; let n = 0; for (let k = 0; k < 32; k++) n += pp.stepNotes(0, x, k).length; return n; }, pt);
  const n0 = await count();
  check(await p.$$eval('.rnote', (x) => x.length) > 0, `it draws the pattern's notes (${n0} in the pattern)`);

  // Find an empty cell: a step and a row with no note.
  const geo = await pw(() => { const a = document.querySelector('.roll-area').getBoundingClientRect(); const sw = parseFloat(getComputedStyle(document.querySelector('.roll-area')).getPropertyValue('--sw')); return { x: a.left, y: a.top, sw }; });
  const sc = await p.$eval('.roll-scroll', (x) => ({ top: x.scrollTop, h: x.clientHeight }));
  const rowsVisible = Math.floor(sc.h / 13);
  const firstRow = Math.ceil(sc.top / 13);
  let cell = null;
  for (let r = firstRow + 1; r < firstRow + rowsVisible - 1 && !cell; r++) {
    const note = await p.$eval(`.roll-keys .rk:nth-child(${r + 1})`, (x) => +x.dataset.note);
    for (let k = 0; k < 14 && !cell; k++) {
      const used = await pw(([x, kk, nt]) => window.patchworker.proj.stepNotes(0, x, kk).some((n) => n.note === nt) || window.patchworker.proj.stepNotes(0, x, kk).length >= 6, [pt, k, note]);
      if (!used) cell = { r, k, note };
    }
  }
  check(!!cell, `found an empty cell (step ${cell?.k + 1}, note ${cell?.note})`);
  const cx = (k, f = 0.5) => geo.x + (k + f) * geo.sw;
  const cy = (r) => geo.y + r * 13 + 6;
  // Click and drag right over two steps: a note three steps long.
  await p.mouse.move(cx(cell.k, 0.3), cy(cell.r)); await p.mouse.down(); await p.mouse.move(cx(cell.k + 2, 0.9), cy(cell.r), { steps: 5 }); await p.mouse.up();
  const added = await pw(([x, k, nt]) => window.patchworker.proj.stepNotes(0, x, k).find((n) => n.note === nt), [pt, cell.k, cell.note]);
  check(added && added.gate === 18, `click and drag adds a note three steps long (${JSON.stringify(added)})`);
  check(await count() === n0 + 1 && /edited, not saved/.test(await p.innerText('.panel-lcd')), 'the pattern has one more note, edited');
  // Wheel over it: velocity up 8.
  const v0 = added.vel;
  await p.mouse.move(cx(cell.k, 0.5), cy(cell.r)); await p.mouse.wheel(0, -100);
  check(await pw(([x, k, j]) => window.patchworker.proj.raw(0, x).steps[k].notes[j].velocity, [pt, cell.k, added.j]) === Math.min(127, v0 + 8), 'the wheel raises its velocity by 8');
  // Drag its right edge back to one step.
  const nd = await p.$(`.rnote[data-k="${cell.k}"][data-note="${cell.note}"]`);
  const bb = await nd.boundingBox();
  await p.mouse.move(bb.x + bb.width - 2, bb.y + 5); await p.mouse.down(); await p.mouse.move(cx(cell.k, 0.95), bb.y + 5, { steps: 5 }); await p.mouse.up();
  check(await pw(([x, k, nt]) => window.patchworker.proj.stepNotes(0, x, k).find((n) => n.note === nt)?.gate, [pt, cell.k, cell.note]) === 6, 'dragging the right edge makes it one step');
  // Drag it one step right and one row down.
  const nd2 = await p.$(`.rnote[data-k="${cell.k}"][data-note="${cell.note}"]`);
  const b2 = await nd2.boundingBox();
  const below = await p.$eval(`.roll-keys .rk:nth-child(${cell.r + 2})`, (x) => +x.dataset.note);
  await p.mouse.move(b2.x + 3, b2.y + 5); await p.mouse.down(); await p.mouse.move(b2.x + 3 + geo.sw, b2.y + 5 + 13, { steps: 6 }); await p.mouse.up();
  const moved = await pw(([x, k, nt]) => window.patchworker.proj.stepNotes(0, x, k).some((n) => n.note === nt), [pt, cell.k + 1, below]);
  const gone = !(await pw(([x, k, nt]) => window.patchworker.proj.stepNotes(0, x, k).some((n) => n.note === nt), [pt, cell.k, cell.note]));
  check(moved && gone, `dragging moves it to step ${cell.k + 2}, one row down`);
  // Click it: still there (a click plays it). Double-click: removed.
  await p.click(`.rnote[data-k="${cell.k + 1}"][data-note="${below}"]`, { position: { x: 3, y: 5 } });
  check(await count() === n0 + 1, 'clicking a note keeps it (it plays)');
  await p.dblclick(`.rnote[data-k="${cell.k + 1}"][data-note="${below}"]`, { position: { x: 3, y: 5 } });
  check(await count() === n0, 'double-clicking a note removes it');
  await p.screenshot({ path: `${out}/roll-piano.png` });
  // ▼ ▲ scroll an octave.
  const top0 = await p.$eval('.roll-scroll', (x) => x.scrollTop);
  await p.click('.cbtn.arrow:has-text("▼")');
  check(await p.$eval('.roll-scroll', (x) => x.scrollTop) > top0 || top0 >= (await p.$eval('.roll-scroll', (x) => x.scrollHeight - x.clientHeight)), '▼ scrolls down an octave');
  // Pads goes back.
  await p.click('.rollbtn');
  check(await view() === 'note' && await p.isVisible('.pads'), 'Pads goes back to Note view');

  // ---- Patterns view: double-click Drum 2's pattern 1 opens the drum grid on it
  await p.click('.view[data-view=patterns]');
  await p.dblclick('.pad[data-ptrack="5"][data-pattern="0"]');
  check(await view() === 'roll' && await pw(() => window.patchworker.panel().state.track) === 5, 'double-clicking a drum pattern opens the drum grid on Drum 2');
  check(/Drum 2 · Drum grid/.test(await p.innerText('.panel-lcd')) && await p.$$eval('.dcell', (x) => x.length) >= 64, 'four rows of steps');
  check(/^P1/.test(await p.$eval('.dk:nth-child(2) span', (x) => x.textContent)), 'Drum 2\'s row shows pattern 1');
  const emptyCell = await p.$eval('.dcell[data-t="5"]:not(.on):not(.out)', (x) => +x.dataset.k);
  await p.click(`.dcell[data-t="5"][data-k="${emptyCell}"]`);
  check(await pw((k) => window.patchworker.proj.stepHas(5, 0, k), emptyCell), `clicking a cell adds a hit on Drum 2 step ${emptyCell + 1}`);
  await p.mouse.move(...(await p.$(`.dcell[data-t="5"][data-k="${emptyCell}"]`).then((h) => h.boundingBox()).then((b) => [b.x + b.width / 2, b.y + b.height / 2])));
  const dv0 = await pw((k) => window.patchworker.proj.raw(5, 0).steps[k].velocity, emptyCell);
  await p.mouse.wheel(0, 100);
  check(await pw((k) => window.patchworker.proj.raw(5, 0).steps[k].velocity, emptyCell) === Math.max(1, dv0 - 8), 'the wheel lowers its velocity');
  await p.click(`.dcell[data-t="5"][data-k="${emptyCell}"]`);
  check(await pw((k) => window.patchworker.proj.stepHas(5, 0, k), emptyCell), 'clicking the hit keeps it (it plays)');
  await p.dblclick(`.dcell[data-t="5"][data-k="${emptyCell}"]`);
  check(!(await pw((k) => window.patchworker.proj.stepHas(5, 0, k), emptyCell)), 'double-clicking it removes it');
  await p.screenshot({ path: `${out}/roll-drum.png` });
  await p.click('.view[data-view=patterns]');
  check(await view() === 'patterns', 'Patterns goes back to Patterns view');
  // Synth pattern from Patterns view: the piano roll on that pattern.
  await p.dblclick('.pad[data-ptrack="1"][data-pattern="1"]');
  check(await view() === 'roll' && /Synth 2 · Piano roll · pattern 2/.test(await p.innerText('.panel-lcd')), 'double-clicking Synth 2 pattern 2 opens its piano roll');

  check(!errors.length, `no console errors (${errors.join(' | ') || 'none'})`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
