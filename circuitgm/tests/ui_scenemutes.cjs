// TracksDECK 0.22: scene mutes (Circuit Tracks firmware 1.2). Each scene saves the mutes it was
// stored with; Mixer view's pad 9 is Mute Recall. With it on, a scene's mutes become the current
// mutes when it starts (or is chosen while stopped) and the mute pads show them; mutes changed by
// hand hold until the next scene. With it off, scenes leave the mutes alone. Saved with the project.
// Voodoo_DL (MIDI2Circuit, Mute Recall on), project 24 "Voodoo People": scene 1 mutes all but
// Drum 1, scene 2 mutes Synth 2, MIDI 1, MIDI 2 and Drum 3. Needs the RosettaGM root served on 8765.
// node tests/ui_scenemutes.cjs <Voodoo_DL.circuittrackspack>
const { chromium } = require('playwright');

(async () => {
  const packFile = process.argv[2];
  if (!packFile) { console.error('usage: node tests/ui_scenemutes.cjs <Voodoo_DL pack>'); process.exit(2); }
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
  await pw(() => window.tracksdeck.loadProject(24));
  await p.waitForFunction(() => window.tracksdeck.proj.entry?.slot === 24);
  await p.click('#face [data-face=tracks]');
  await pw(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Mixer')).click());
  await p.waitForSelector('.pad.recall');

  const maskOf = (m) => m.map((x, t) => (x ? 1 << t : 0)).reduce((a, b) => a | b, 0);
  const state = () => pw(() => { const pp = window.tracksdeck.proj; return { recall: pp.muteRecall, mutes: pp.mutes.slice(), heard: pp.player.mutes.slice(), masks: pp.song.scenes.map((s) => s.mask) }; });
  const pads = () => p.$$eval('.pad.mute', (x) => x.map((e) => e.classList.contains('muted')));

  let s = await state();
  const m1 = s.masks[0], m2 = s.masks[1];
  check(s.recall === true, 'Voodoo People has Mute Recall on');
  check(m1 !== m2, `scenes 1 and 2 save different mutes (${m1.toString(2)} / ${m2.toString(2)})`);
  check(maskOf(s.mutes) === m1, 'on load, the mutes are scene 1\'s');
  check(maskOf(await pads()) === m1, 'the mute pads show them');
  check(maskOf(s.heard) === m1, 'and the player mutes those tracks');
  check(await p.$eval('.pad.recall', (e) => e.classList.contains('on') && e.matches('.pads .pad:nth-child(9)')), 'pad 9 is Mute recall, lit');

  // Choosing scene 2 while stopped recalls its mutes.
  await p.click('.pad.scene[data-scene="1"]');
  s = await state();
  check(maskOf(s.mutes) === m2 && maskOf(await pads()) === m2, 'choosing scene 2 recalls its mutes');

  // Every hit is rendered (muting is by gain now), with a scene-mutes event at each scene start.
  await pw(() => { const pp = window.tracksdeck.proj; pp.selectScene(0); pp.selectScene(1, { chain: true }); });
  const ev = await pw(() => { const pp = window.tracksdeck.proj; const e = pp.render.events.filter((x) => x.sceneMutes != null); return { n: e.length, first: e[0], second: e.find((x) => x.scene === 1), d1: pp.render.events.some((x) => x.track === 0 && x.note != null) }; });
  check(ev.first?.t === 0 && ev.first.sceneMutes === m1, 'the chain starts with scene 1\'s mutes');
  check(ev.second?.sceneMutes === m2 && ev.second.t > 0, `scene 2's mutes come at its start (${ev.second?.t?.toFixed(2)} s)`);
  check(ev.d1, 'Synth 1\'s notes are in what plays even though scene 1 mutes it (so it can be unmuted)');

  // Unmute Synth 1 by hand in scene 1, then edit-style restart inside the scene: the hand mute holds.
  await p.click('.pad.mute[data-mute="0"]');
  await pw(() => window.tracksdeck.proj.play());
  await p.waitForTimeout(400);
  s = await state();
  check(!s.mutes[0] && maskOf(s.mutes) === (m1 & ~1), 'Synth 1 unmuted by hand plays in scene 1 (Play keeps the hand mutes in the scene they were set)');
  await pw(() => window.tracksdeck.proj.changed(false));
  await p.waitForTimeout(200);
  s = await state();
  check(!s.mutes[0], 'a restart inside the scene keeps the hand mute');
  // Scene 2 starting brings its mutes.
  const wait = Math.round(ev.second.t * 1000) + 500;
  if (wait < 25000) {
    await p.waitForTimeout(wait - 600);
    s = await state();
    check(maskOf(s.heard) === maskOf(s.mutes), 'player and panel agree');
    check(maskOf(s.mutes) === m2 && maskOf(await pads()) === m2, 'when scene 2 starts, its mutes replace the current ones and the pads show them');
  } else console.log(`(scene 2 starts after ${ev.second.t.toFixed(1)} s: not waited for)`);
  await pw(() => window.tracksdeck.proj.stop());

  // Mute Recall off: scenes leave the mutes alone; no scene-mutes events; a project edit.
  await p.click('.pad.recall');
  s = await state();
  check(s.recall === false && !(await p.$eval('.pad.recall', (e) => e.classList.contains('on'))), 'pad 9 turns Mute Recall off (dim)');
  const before = maskOf(s.mutes);
  await p.click('.pad.scene[data-scene="0"]');
  s = await state();
  check(maskOf(s.mutes) === before, 'with it off, choosing a scene keeps the current mutes');
  check(await pw(() => !window.tracksdeck.proj.render.events.some((x) => x.sceneMutes != null)), 'and nothing in playback changes them');
  check(await pw(() => window.tracksdeck.proj.edited), 'the project counts as edited');

  // Save keeps it; reloading the project reads it back.
  await pw(() => window.tracksdeck.proj.save());
  check(await pw(() => window.tracksdeck.proj.entry.project.muteRecall === 0), 'Save writes Mute Recall off into the project');
  await pw(() => window.tracksdeck.loadProject(24));
  await p.waitForTimeout(300);
  s = await state();
  check(s.recall === false && maskOf(s.mutes) === 0, 'reloaded: Mute Recall off, nothing muted');
  await p.click('.pad.recall');
  s = await state();
  check(s.recall === true && maskOf(s.mutes) === s.masks[await pw(() => window.tracksdeck.proj.scene)], 'turning it on brings the chosen scene\'s mutes at once');
  await pw(() => window.tracksdeck.proj.save());
  check(await pw(() => window.tracksdeck.proj.entry.project.muteRecall === 1), 'Save writes Mute Recall on');

  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
