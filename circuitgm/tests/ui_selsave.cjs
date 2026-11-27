// TracksDECK 0.29: Save keeps the scene chain and the pattern chains each track plays (0x2C0 and
// 0x2C4); loading brings them back. The hardware saves the scene playing at the time (Blue
// Monday project 1: chain 1-16, saved on scene 16), so saved pattern chains that match a scene
// leave the chain playing from its start; only chains that match no scene (chosen by hand) load
// as chosen. Needs the RosettaGM root served on 8765.
// node tests/ui_selsave.cjs <Blue Monday.circuittrackspack>
const { chromium } = require('playwright');

(async () => {
  const packFile = process.argv[2];
  if (!packFile) { console.error('usage: node tests/ui_selsave.cjs <Blue Monday pack>'); process.exit(2); }
  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
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
  await p.click('#face [data-face=tracks]');
  const state = () => pw(() => { const pp = window.tracksdeck.proj; return { slot: pp.entry.slot, custom: pp.custom, scene: pp.scene, chain: [pp.sceneChain.start, pp.sceneChain.end], sel: pp.sel.map((c) => [c.start, c.end]) }; });
  const reload = async (slot) => { await pw(async (s) => { await window.tracksdeck.loadProject(s); }, slot); await p.waitForFunction(() => window.tracksdeck.proj.loaded); return state(); };
  const save = async () => { await p.click('.cbtn.save'); await p.click('.cbtn.save'); await p.waitForTimeout(150); };

  // Opening: project 1 was saved on scene 16 of its chain 1-16: the chain plays from scene 1.
  let s = await state();
  const file = await pw(() => { const pr = window.tracksdeck.proj.entry.project; return { chain: [pr.sceneChain.start, pr.sceneChain.end], cur: pr.patternChains.map((c) => [c.start, c.end]), s16: pr.scenes[15].trackChains.map((c) => [c.start, c.end]) }; });
  check(JSON.stringify(file.cur) === JSON.stringify(file.s16), 'Blue Monday project 1 was saved playing scene 16');
  check(!s.custom && JSON.stringify(s.chain) === JSON.stringify(file.chain) && s.scene === file.chain[0], `opening it keeps the scene chain ${file.chain[0] + 1}-${file.chain[1] + 1}, from scene ${s.scene + 1}`);
  const slot = s.slot;

  // Patterns chosen by hand (matching no scene): Save, reload, they come back.
  await pw(() => { const pp = window.tracksdeck.proj; pp.selectPattern(0, 5); pp.selectPattern(0, 6, { extend: true }); pp.selectPattern(4, 3); pp.selectPattern(7, 6); });
  const picked = (await state()).sel;
  const matchesScene = await pw((sel) => window.tracksdeck.proj.song.scenes.some((sc) => sc.chains.every((c, t) => c.start === sel[t][0] && c.end === sel[t][1])), picked);
  check(!matchesScene, 'the patterns chosen match no scene');
  await save();
  const saved = await pw(() => { const pr = window.tracksdeck.proj.entry.project; return { cur: pr.patternChains.map((c) => [c.start, c.end]), chain: [pr.sceneChain.start, pr.sceneChain.end] }; });
  check(JSON.stringify(saved.cur) === JSON.stringify(picked), `Save writes them as the project's current pattern chains (${JSON.stringify(saved.cur)})`);
  await reload((slot + 1) % 7);
  s = await reload(slot);
  check(s.custom && JSON.stringify(s.sel) === JSON.stringify(picked), `reloading the project brings them back, playing as chosen (${JSON.stringify(s.sel)})`);

  // A scene chain: Save, reload, it comes back with its first scene's patterns.
  await pw(() => { const pp = window.tracksdeck.proj; pp.selectScene(2); pp.selectScene(4, { chain: true }); });
  await save();
  await reload((slot + 1) % 7);
  s = await reload(slot);
  const s3 = await pw(() => window.tracksdeck.proj.song.scenes[2].chains.map((c) => [c.start, c.end]));
  check(!s.custom && JSON.stringify(s.chain) === '[2,4]' && s.scene === 2, `a scene chain 3-5 is saved and comes back (${JSON.stringify(s.chain)}, custom ${s.custom})`);
  check(JSON.stringify(s.sel) === JSON.stringify(s3), "with scene 3's patterns");

  // Choosing patterns doesn't by itself make the project edited (nothing to discard), but Save keeps them.
  await pw(() => window.tracksdeck.proj.selectPattern(1, 4));
  check(!(await pw(() => window.tracksdeck.proj.edited)), 'choosing patterns is not an edit on its own');

  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
