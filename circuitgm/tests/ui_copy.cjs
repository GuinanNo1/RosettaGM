// TracksDECK 0.19: editing a project's own copy of a patch. Blue Monday project 27 plays slot 81 on
// Synth 2, but its saved copy differs from the pack's patch (about 100 bytes): the editor edits the
// copy (what the song plays), as a project edit; Edit the pack's patch switches to the slot's patch;
// Revert to how the project has it, Revert project and Save to pack slot. Needs the RosettaGM root
// served on 8765.
// node tests/ui_copy.cjs <Blue Monday.circuittrackspack>
const { chromium } = require('playwright');

(async () => {
  const packFile = process.argv[2];
  if (!packFile) { console.error('usage: node tests/ui_copy.cjs <Blue Monday pack>'); process.exit(2); }
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const fails = [];
  const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
  const errors = [];
  const p = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_|fonts\./.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('http://localhost:8765/circuitgm/tracksdeck/');
  await p.evaluate(() => indexedDB.deleteDatabase('circuitgm-tracksdeck'));
  await p.goto('http://localhost:8765/circuitgm/tracksdeck/');
  await p.waitForFunction(() => window.tracksdeck?.S.pack);
  await p.setInputFiles('#file-pack', packFile);
  await p.waitForFunction(() => window.tracksdeck.proj.loaded);
  const pw = (fn, ...a) => p.evaluate(fn, ...a);
  const FREQ = 64;   // Filter Frequency's address in a patch (js/pw/params.js)

  await pw(() => window.tracksdeck.loadProject(26, { quiet: true }));
  check(await pw(() => window.tracksdeck.proj.patchSlots[1]) === 80, 'project 27 plays slot 81 on Synth 2');
  check(await pw(() => !!window.tracksdeck.proj.ownCopy[1]), 'its Synth 2 copy really differs from the pack\'s patch');

  await p.click('#synth-seg [data-synth="1"]');
  await p.waitForFunction(() => window.tracksdeck.S.slot === 80);
  const st = await pw(() => { const w = window.tracksdeck; return { copy: w.S.copy, same: w.S.bytes === w.proj.ownCopy[1], song: w.proj.player.synths?.[1]?.bytes === w.proj.ownCopy[1] }; });
  check(st.copy === 1 && st.same, 'the editor edits the project\'s copy');
  check(st.song !== false, 'the song\'s Synth 2 plays that same array');
  check(await p.isVisible('#copy-chip'), '"Project copy" is shown next to the patch name');
  check(/own copy in project 27/.test(await p.textContent('#ed-what')), `the status line says so ("${(await p.textContent('#ed-what')).slice(0, 60)}…")`);
  check(await p.isVisible('#ed-copy-save') && await p.isVisible('#ed-copy-switch'), 'Save to pack slot and Edit the pack\'s patch are offered');

  // An edit goes to the copy: a project edit, the pack's patch untouched.
  const packBefore = await pw((a) => window.tracksdeck.S.pack.patches[80][a], FREQ);
  const copyBefore = await pw((a) => window.tracksdeck.proj.ownCopy[1][a], FREQ);
  const v = copyBefore > 10 ? copyBefore - 10 : copyBefore + 10;
  await pw(([a, x]) => window.tracksdeck.setByte(a, x), [FREQ, v]);
  const after = await pw((a) => { const w = window.tracksdeck; return { copy: w.proj.ownCopy[1][a], pack: w.S.pack.patches[80][a], edited: w.proj.entry.edited, slotMark: document.querySelector('#patchlist li[data-slot="80"]')?.classList.contains('edited') ?? false }; }, FREQ);
  check(after.copy === v, `the copy changed (${copyBefore} -> ${after.copy})`);
  check(after.pack === packBefore, 'the pack\'s patch is unchanged');
  check(after.edited, 'it is a project edit (Save keeps it)');
  check(!after.slotMark, 'the pack slot is not marked as edited');
  check(/Project edited/.test(await p.textContent('#ed-state')), 'the state says the project is edited');

  // Undo is the copy's own.
  await pw(() => window.tracksdeck.undo());
  check(await pw((a) => window.tracksdeck.proj.ownCopy[1][a], FREQ) === copyBefore, 'Undo puts the copy back');

  // Switch to the pack's patch and back.
  await p.click('#ed-copy-switch');
  const pv = await pw(() => { const w = window.tracksdeck; return { copy: w.S.copy, pack: w.S.bytes === w.S.pack.patches[80], song: w.proj.ownCopy[1] != null }; });
  check(pv.copy === null && pv.pack, 'Edit the pack\'s patch: the editor shows slot 81\'s patch');
  check(pv.song, 'the song still plays the copy');
  check(!(await p.isVisible('#copy-chip')) && /own, different copy/.test(await p.textContent('#ed-what')), 'the label goes, and the status line says the song plays a different copy');
  await p.click('#ed-copy-switch');
  check(await pw(() => window.tracksdeck.S.copy) === 1, 'Edit the project copy switches back');

  // Revert to how the project has it (Patch menu).
  await pw(([a, x]) => window.tracksdeck.setByte(a, x), [FREQ, v]);
  await p.click('#patch-menu-btn');
  check((await p.textContent('#patch-menu [data-act=revert]')) === 'Revert to how the project has it', 'the Patch menu offers Revert to how the project has it');
  await p.click('#patch-menu [data-act=revert]');
  check(await pw((a) => window.tracksdeck.proj.ownCopy[1][a], FREQ) === copyBefore, 'it brings back the saved copy');

  // Revert project brings back the saved copy too.
  await pw(([a, x]) => window.tracksdeck.setByte(a, x), [FREQ, v]);
  await pw(() => window.tracksdeck.proj.revert());
  const rv = await pw((a) => { const w = window.tracksdeck; return { v: w.proj.ownCopy[1]?.[a], bound: w.S.bytes === w.proj.ownCopy[1] }; }, FREQ);
  check(rv.v === copyBefore && rv.bound, `Revert project: the saved copy again, still edited here (${rv.v})`);

  // Save to pack slot (default: the project's own slot): the project then plays the pack's patch.
  const copyBytes = await pw(() => Array.from(window.tracksdeck.S.bytes));
  const done = pw(() => window.tracksdeck.saveCopyToSlot());
  await p.waitForSelector('dialog[open]');
  await p.click('#dlg-ok');
  await done;
  const sv = await pw(() => { const w = window.tracksdeck; return { slot: w.S.slot, copy: w.S.copy, own: w.proj.ownCopy[1], plays: w.proj.patchSlots[1], pack: Array.from(w.S.pack.patches[80]), bound: w.S.bytes === w.S.pack.patches[80], edited: w.proj.entry.edited }; });
  check(sv.plays === 80 && sv.own === null, 'the project now plays slot 81 from the pack');
  check(sv.pack.every((x, i) => x === copyBytes[i]), 'slot 81 has the copy');
  check(sv.copy === null && sv.bound, 'the editor edits the pack\'s patch, which the song plays');
  check(sv.edited, 'the project is marked edited (Save keeps the change)');
  check(!(await p.isVisible('#copy-chip')), 'no "Project copy" label');

  check(!errors.length, `no console errors (${errors.join(' | ') || 'none'})`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
