// PatchWorker 0.24: storing scenes in Mixer view (User Guide v3 pp. 81-84; Rhythm 2.0 addendum p. 8).
// Shift + scene pad stores the patterns each track plays now and the current mutes; Clear + scene
// clears it; Duplicate, a scene, then other scenes copies it; ⌘/Alt-click chains scenes. Storing
// doesn't select the scene or change the chain. Save keeps the scenes, Revert drops them.
// Needs the RosettaGM root served on 8765.
// node tests/ui_scenestore.cjs <Blue Monday.circuittrackspack>
const { chromium } = require('playwright');

(async () => {
  const packFile = process.argv[2];
  if (!packFile) { console.error('usage: node tests/ui_scenestore.cjs <Blue Monday pack>'); process.exit(2); }
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
  await pw(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Mixer')).click());
  await p.waitForSelector('.pad.scene');

  const scene = (i) => pw((i) => { const pp = window.patchworker.proj; const s = pp.song.scenes[i]; return { used: s.used, mask: s.mask, chains: s.chains.map((c) => [c.start, c.end]) }; }, i);
  const state = () => pw(() => { const pp = window.patchworker.proj; return { custom: pp.custom, scene: pp.scene, chain: [pp.sceneChain.start, pp.sceneChain.end], sel: pp.sel.map((c) => [c.start, c.end]), mutes: pp.mutes.slice(), edited: pp.edited }; });
  const padClass = (i) => p.$eval(`.pad.scene[data-scene="${i}"]`, (e) => e.className);

  // Choose patterns as in Patterns view (Synth 1 plays pattern 3, Drum 1 patterns 1-2) and mute Synth 2.
  await pw(() => { const pp = window.patchworker.proj; pp.selectPattern(0, 2); pp.selectPattern(4, 0); pp.selectPattern(4, 1, { extend: true }); });
  // (Blue Monday stores all 16 scenes, with mutes; start from Synth 2 alone muted.)
  await pw(() => { const pp = window.patchworker.proj; for (let t = 0; t < 8; t++) pp.setMute(t, t === 1); });
  const orig = await pw(() => window.patchworker.proj.song.scenes.map((s) => ({ mask: s.mask, chains: s.chains.map((c) => [c.start, c.end]) })));
  const before = await state();
  check(before.custom && before.sel[0][0] === 2 && before.sel[4][1] === 1, 'patterns chosen (custom selection)');
  check(JSON.stringify(orig[14].chains[0]) !== '[2,2]' || orig[14].mask !== 2, 'scene 15 holds something else to begin with');

  // Shift held: the scene pads turn gold.
  await p.keyboard.down('Shift');
  await p.waitForTimeout(50);
  check((await p.$$('.pad.scene.storing')).length === 16, 'with Shift held, all 16 scene pads show as ready to store');
  await p.click('.pad.scene[data-scene="14"]');
  await p.keyboard.up('Shift');
  await p.waitForTimeout(50);
  check((await p.$$('.pad.scene.storing')).length === 0, 'releasing Shift puts them back');
  let s15 = await scene(14);
  check(s15.used, 'Shift + scene 15 stores it');
  check(s15.chains[0][0] === 2 && s15.chains[0][1] === 2 && s15.chains[4][0] === 0 && s15.chains[4][1] === 1, `with the patterns chosen (${JSON.stringify(s15.chains)})`);
  check(s15.mask === 2, `and the mutes (Synth 2: mask ${s15.mask})`);
  check(/\bstored\b/.test(await padClass(14)), 'its pad lights as stored');
  let after = await state();
  check(after.custom && JSON.stringify(after.chain) === JSON.stringify(before.chain) && after.scene === before.scene, 'storing does not select the scene or change the scene chain');
  check(after.edited, 'storing is a project edit');
  check(/Scene 15 stored/.test(await p.textContent('body')), 'a message says what was stored');

  // The armed panel Shift button works too, and is used up by the press.
  await p.click('.cbtn.shift');
  await p.click('.pad.scene[data-scene="12"]');
  check((await scene(12)).used, 'Shift button then a scene pad stores too');
  check(!(await p.$eval('.cbtn.shift', (e) => e.classList.contains('on'))), 'the Shift button is used up');

  // Choosing scene 15 plays what was stored, with its mutes (Mute Recall on) once the hand mute is undone.
  await pw(() => { const pp = window.patchworker.proj; for (let t = 0; t < 8; t++) pp.setMute(t, false); });
  await pw(() => window.patchworker.proj.setMuteRecall(true));
  await p.click('.pad.scene[data-scene="14"]');
  after = await state();
  check(!after.custom && after.scene === 14 && after.sel[0][0] === 2 && after.sel[4][1] === 1, 'choosing scene 15 plays its stored patterns');
  check(after.mutes[1] && after.mutes.filter(Boolean).length === 1, 'and recalls its mutes');

  // Duplicate: scene 15 to 16 and 14.
  await p.click('.cbtn.dup');
  await p.click('.pad.scene[data-scene="14"]');
  check(/\bsrc\b/.test(await padClass(14)), 'Duplicate: the scene to copy is marked');
  await p.click('.pad.scene[data-scene="15"]');
  await p.click('.pad.scene[data-scene="13"]');
  await p.click('.cbtn.dup');
  const s16 = await scene(15), s14 = await scene(13);
  check(JSON.stringify(s16) === JSON.stringify(s15) && JSON.stringify(s14) === JSON.stringify(s15), 'Duplicate copies it to each scene pressed');
  check(!(await state()).custom && (await state()).scene === 14, 'copying leaves the chosen scene alone');

  // Clear: scene 16 back to pattern 1, no mutes.
  await p.click('.cbtn.clear');
  await p.click('.pad.scene[data-scene="15"]');
  await p.click('.cbtn.clear');
  const c16 = await scene(15);
  check(!c16.used && c16.mask === 0 && c16.chains.every((c) => c[0] === 0 && c[1] === 0), 'Clear + scene 16 clears it');

  // Clearing the chosen scene changes what plays.
  await p.click('.cbtn.clear');
  await p.click('.pad.scene[data-scene="14"]');
  await p.click('.cbtn.clear');
  after = await state();
  check(after.sel.every((c) => c[0] === 0 && c[1] === 0), 'clearing the chosen scene puts its tracks on pattern 1');

  // Chains with a mouse: Alt-click (or ⌘-click). A plain click doesn't chain.
  await p.click('.pad.scene[data-scene="12"]');
  await p.click('.pad.scene[data-scene="13"]', { modifiers: ['Alt'] });
  after = await state();
  check(JSON.stringify(after.chain) === '[12,13]', `Alt-click chains scenes 13-14 (${after.chain})`);
  await p.click('.pad.scene[data-scene="12"]');
  await p.click('.pad.scene[data-scene="13"]', { modifiers: ['Meta'] });
  check(JSON.stringify((await state()).chain) === '[12,13]', '⌘-click chains too');

  // Save keeps the stored scenes (read back from the saved file).
  const saved = await pw(() => { const pp = window.patchworker.proj; const e = pp.save(); return e.project.scenes.map((s) => ({ flags: s.flags, mask: s.mask, c0: [s.trackChains[0].start, s.trackChains[0].end] })); });
  check(saved[13].flags === 1 && saved[13].mask === 2 && saved[13].c0[0] === 2, 'Save writes scene 14 (stored flag, mutes, patterns)');
  check(saved[14].flags === 0 && saved[14].mask === 0 && saved[15].flags === 0, 'and the cleared scenes as cleared');

  // Revert drops an unsaved store.
  await pw(() => { const pp = window.patchworker.proj; for (let t = 0; t < 8; t++) pp.setMute(t, t === 7); });
  await p.keyboard.down('Shift');
  await p.click('.pad.scene[data-scene="10"]');
  await p.keyboard.up('Shift');
  check((await scene(10)).mask === 128, 'scene 11 stored with Drum 4 muted');
  await pw(() => window.patchworker.proj.revert());
  const r11 = await scene(10), r14 = await scene(13);
  check(r11.mask === orig[10].mask && JSON.stringify(r11.chains) === JSON.stringify(orig[10].chains), 'Revert puts scene 11 back as saved');
  check(r14.mask === 2 && r14.chains[0][0] === 2, 'and keeps the saved scene 14');

  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
