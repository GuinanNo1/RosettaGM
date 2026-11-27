// PatchWorker 0.25: the pulsing scene pad (User Guide v3 p. 83). In Mixer view the scene chosen last
// pulses (with a ring) while the patterns selected match the ones stored in it. Choosing other
// patterns in Patterns view stops it; choosing the matching ones again brings it back. Only the
// most recently chosen scene does this; storing the selection into that scene makes it match.
// Needs the RosettaGM root served on 8765.
// node tests/ui_scenematch.cjs <Blue Monday.circuittrackspack>
const { chromium } = require('playwright');

(async () => {
  const packFile = process.argv[2];
  if (!packFile) { console.error('usage: node tests/ui_scenematch.cjs <Blue Monday pack>'); process.exit(2); }
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] }).catch(() => chromium.launch());
  const fails = [];
  const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const p = await ctx.newPage();
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
  const view = (name) => pw((name) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(name)).click(), name);
  await view('Mixer');
  await p.waitForSelector('.pad.scene');
  // Repaint Mixer view as a visit to Patterns view and back would.
  const repaint = async () => { await view('Patterns'); await p.waitForSelector('.pad.pattern'); await view('Mixer'); await p.waitForSelector('.pad.scene'); };
  const matching = () => p.$$eval('.pad.scene.match', (x) => x.map((e) => +e.dataset.scene));
  const state = () => pw(() => { const pp = window.patchworker.proj; return { custom: pp.custom, scene: pp.scene, chain: [pp.sceneChain.start, pp.sceneChain.end], sel: pp.sel.map((c) => [c.start, c.end]) }; });
  const sceneChains = (i) => pw((i) => window.patchworker.proj.song.scenes[i].chains.map((c) => [c.start, c.end]), i);

  // 1. On loading: the chosen scene pulses, and only it.
  let s = await state();
  check(JSON.stringify(await matching()) === JSON.stringify([s.scene]), `on loading, the chosen scene (${s.scene + 1}) pulses, and only it`);
  check(await pw(() => window.patchworker.proj.sceneMatches()), 'sceneMatches() is true');
  const anim = await p.$eval('.pad.scene.match', (e) => getComputedStyle(e).animationName);
  check(anim === 'scenepulse', `it pulses bright/dim (animation ${anim})`);
  check(/Pulsing: the scene chosen last/.test(await p.$eval('.pad.scene.match', (e) => e.title)), 'its title says what the pulse means');

  // 2. Other patterns chosen in Patterns view: no pad pulses. (Blue Monday opens with scenes 1-16
  // chained; choose the first scene alone, so a hand-picked selection can match it again.)
  await p.click(`.pad.scene[data-scene="${s.scene}"]`);
  await p.waitForTimeout(50);
  s = await state();
  check(s.chain[0] === s.chain[1] && JSON.stringify(await matching()) === JSON.stringify([s.scene]), `scene ${s.scene + 1} chosen alone: it pulses`);
  const orig = s.sel[0];
  const other = orig[0] === 0 && orig[1] === 0 ? 1 : 0;
  await pw((o) => window.patchworker.proj.selectPattern(0, o), other);
  await repaint();
  check((await matching()).length === 0, 'choosing another pattern for Synth 1 stops the pulse');
  check(/patterns selected have changed/.test(await p.$eval(`.pad.scene[data-scene="${s.scene}"]`, (e) => e.title)), 'the chosen scene\'s title says the patterns have changed');

  // 3. The matching patterns chosen again: it pulses again (the selection is still "chosen here").
  await pw((o) => { const pp = window.patchworker.proj; pp.selectPattern(0, o[0]); if (o[1] > o[0]) pp.selectPattern(0, o[1], { extend: true }); }, orig);
  await repaint();
  s = await state();
  check(s.custom && JSON.stringify(await matching()) === JSON.stringify([s.scene]), 'choosing the same patterns again brings the pulse back');

  // 4. Another scene chosen: it pulses; the old one doesn't.
  const old = s.scene, next = (old + 3) % 16;
  await p.click(`.pad.scene[data-scene="${next}"]`);
  await p.waitForTimeout(50);
  check(JSON.stringify(await matching()) === JSON.stringify([next]), `choosing scene ${next + 1} moves the pulse to it`);

  // 5. Patterns of a scene other than the one chosen last: no pulse (only the chosen scene counts).
  const ch = await sceneChains(old);
  const nch = await sceneChains(next);
  if (JSON.stringify(ch) !== JSON.stringify(nch)) {
    await pw((ch) => { const pp = window.patchworker.proj; ch.forEach((c, t) => { pp.selectPattern(t, c[0]); if (c[1] > c[0]) pp.selectPattern(t, c[1], { extend: true }); }); }, ch);
    await repaint();
    check((await matching()).length === 0, `selecting scene ${old + 1}'s patterns doesn't light it (only the scene chosen last pulses)`);
  } else check(true, `(scenes ${old + 1} and ${next + 1} hold the same patterns: skipped)`);

  // 6. Storing the selection into the chosen scene makes it match; storing into another doesn't.
  await pw((o) => window.patchworker.proj.selectPattern(0, o), (nch[0][0] + 1) % 8);
  await repaint();
  check((await matching()).length === 0, 'new patterns chosen: no pulse');
  const elsewhere = (next + 5) % 16;
  await p.keyboard.down('Shift');
  await p.click(`.pad.scene[data-scene="${elsewhere}"]`);
  await p.keyboard.up('Shift');
  await p.waitForTimeout(50);
  check((await matching()).length === 0, `storing them in scene ${elsewhere + 1} (not the chosen one) doesn't make it pulse`);
  check((await p.$$('.pad.scene.storing')).length === 0, 'Shift released: no gold pads');
  await p.keyboard.down('Shift');
  check(await p.$eval(`.pad.scene[data-scene="${next}"]`, (e) => getComputedStyle(e).animationName) === 'none', 'with Shift held the pads do not pulse');
  await p.click(`.pad.scene[data-scene="${next}"]`);
  await p.keyboard.up('Shift');
  await p.waitForTimeout(50);
  check(JSON.stringify(await matching()) === JSON.stringify([next]), `storing them in scene ${next + 1} (the chosen one) makes it pulse`);

  // 7. A scene chain: its first scene pulses; once patterns are changed by hand the chain stops,
  // so choosing the same patterns again doesn't bring the pulse back.
  await p.click('.pad.scene[data-scene="3"]');
  await p.click('.pad.scene[data-scene="5"]', { modifiers: ['Alt'] });
  await p.waitForTimeout(50);
  s = await state();
  check(JSON.stringify(s.chain) === '[3,5]' && JSON.stringify(await matching()) === '[3]', `chain 4-6: scene 4 pulses (chain ${s.chain}, pulsing ${await matching()})`);
  const c4 = s.sel[0];
  await pw((o) => window.patchworker.proj.selectPattern(0, o), (c4[0] + 1) % 8);
  await pw((o) => { const pp = window.patchworker.proj; pp.selectPattern(0, o[0]); if (o[1] > o[0]) pp.selectPattern(0, o[1], { extend: true }); }, c4);
  await repaint();
  check((await matching()).length === 0, 'after changing patterns by hand, a chain\'s first scene stays unlit');

  // 8. The scene playing now is filled but doesn't pulse; reduced motion keeps the ring only.
  await p.evaluate(() => { const e = document.querySelector('.pad.scene[data-scene="9"]'); e.classList.add('now'); });
  check(await p.$eval('.pad.scene[data-scene="9"]', (e) => getComputedStyle(e).animationName) === 'none', 'a playing scene that is not the matched one doesn\'t pulse');
  await p.click('.pad.scene[data-scene="2"]');
  await p.emulateMedia({ reducedMotion: 'reduce' });
  const rm = await p.$eval('.pad.scene.match', (e) => ({ a: getComputedStyle(e).animationName, b: getComputedStyle(e).boxShadow }));
  check(rm.a === 'none' && rm.b !== 'none', `reduced motion: no pulse, ring kept (${rm.a})`);

  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
