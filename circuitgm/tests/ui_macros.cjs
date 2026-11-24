// PatchWorker 0.18.3: a project's macro knob positions. Apricots project 1 saves Synth 2 (slot 33)
// with macro 2 at 72 and macro 5 at 16, the pack's patch has them at 0: the project plays the pack's
// patch at its own knob positions, the knobs show them, and turning one is heard in the song (a
// project edit; the patch is unchanged). Needs the RosettaGM root served on 8765.
// node tests/ui_macros.cjs <Apricots.circuittrackspack>
const { chromium } = require('playwright');

(async () => {
  const packFile = process.argv[2];
  if (!packFile) { console.error('usage: node tests/ui_macros.cjs <Apricots pack>'); process.exit(2); }
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
  await p.waitForFunction(() => window.patchworker.proj.loaded);
  const pw = (fn, ...a) => p.evaluate(fn, ...a);

  check(await pw(() => window.patchworker.proj.patchSlots[1]) === 32, 'project 1 plays slot 33 on Synth 2');
  check(await pw(() => window.patchworker.proj.ownCopy[1] === null), 'its copy differs only in knob positions, so it plays the pack\'s patch');
  const m = await pw(() => window.patchworker.proj.macros[1]);
  check(m[1] === 72 && m[4] === 16, `the project's Synth 2 knobs: macro 2 = ${m[1]}, macro 5 = ${m[4]}`);
  check(await pw(() => { const s = window.patchworker.proj.player.synths[1]; return s.macroPos?.[1] === 72 && s.macroPos?.[4] === 16; }), 'the song\'s Synth 2 plays at them');

  // Edit Synth 2 in the editor: its knobs show the project's positions.
  await p.click('#synth-seg [data-synth="1"]');
  await p.waitForFunction(() => window.patchworker.S.slot === 32);
  const shown = await p.$$eval('#macro-row .knob', (x) => x.map((k) => +k.getAttribute('aria-valuenow')));
  check(shown[1] === 72 && shown[4] === 16, `the macro knobs show them (${shown.join(', ')})`);
  const patchByte = () => pw(() => { const w = window.patchworker; return w.S.bytes[221]; });
  const before = await patchByte();
  // Turn macro 5 up by 10 with the keyboard.
  await p.focus('#macro-row .macro:nth-child(5) .knob');
  for (let i = 0; i < 10; i++) await p.keyboard.press('ArrowUp');
  const after = await pw(() => ({ proj: window.patchworker.proj.macros[1][4], song: window.patchworker.proj.player.synths[1].macroPos?.[4], edited: window.patchworker.proj.entry.edited }));
  check(after.proj === 26 && after.song === 26, `turning macro 5 moves the song's Synth 2 (project ${after.proj}, playing ${after.song})`);
  check(after.edited, 'it is a project edit (Save keeps it)');
  check(await patchByte() === before, 'the pack\'s patch is unchanged');
  check(await pw(() => window.patchworker.synth?.macroPos?.[4] ?? 26) === 26, 'the keyboard synth follows the knob too');

  // Save writes the knob into the project's copy of the patch.
  await p.click('#face [data-face=tracks]');
  await p.click('.cbtn.save');
  await p.click('.cbtn.save');
  const saved = await pw(async () => {
    const { parseNCS } = await import('/circuitgm/js/vendor/ncs.js');
    const pp = window.patchworker.proj, b = pp.pack.files.get(pp.entry.url);
    return Array.from(parseNCS(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)).synth2Patch.slice(221, 273)).filter((_, i) => i === 0 || i === 51);
  });
  check(saved[0] === 72 && saved[1] === 26, `Save keeps the knobs in the project (macro 2 ${saved[0]}, macro 5 ${saved[1]})`);

  check(!errors.length, `no console errors (${errors.join(' | ') || 'none'})`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
