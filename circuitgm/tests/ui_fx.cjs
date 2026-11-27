// TracksDECK 0.23: FX view and Side Chain view (User Guide pp. 90-94). FX: rows 1-2 the 16 delay
// presets, row 3 the 8 reverb presets, pad 25 FX on/off; pressing a preset makes the macro knobs
// that effect's sends. Side Chain (FX again): rows 3-4 Off + presets 1-7 for Synth 1/2 (▼: MIDI
// 1/2), pads 5-8 the trigger drum. All edit the project: Save keeps them, Revert puts them back.
// Also: drum sends come from the tail's send bytes (they were read from the drum settings, always 0).
// Voodoo_DL project 24 "Voodoo People": reverb 5, delay 8, Drum 3/4 reverb sends 17/29.
// Needs the RosettaGM root served on 8765.   node tests/ui_fx.cjs <Voodoo_DL.circuittrackspack>
const { chromium } = require('playwright');

(async () => {
  const packFile = process.argv[2];
  if (!packFile) { console.error('usage: node tests/ui_fx.cjs <Voodoo_DL pack>'); process.exit(2); }
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
  // Start audio so the mixer exists (as after a first Play).
  await pw(() => window.tracksdeck.proj.play());
  await p.waitForTimeout(300);
  await pw(() => window.tracksdeck.proj.stop());
  const fxBtn = () => p.click('.ct button[data-view="fx"]');
  await fxBtn();
  await p.waitForSelector('.pad.fxp');
  const view = () => pw(() => window.tracksdeck.panel().state.view);
  const st = () => pw(() => { const pp = window.tracksdeck.proj, pr = pp.entry.project; return { rp: pr.reverbPreset, dp: pr.delayPreset, fx: { ...pr.fx, reverbSends: [...pr.fx.reverbSends], delaySends: [...pr.fx.delaySends] }, sc: pr.sidechain.map((s) => ({ ...s })), edited: pp.edited, mix: pp.player.mix, shapes: pp.player.mixer?.shapes, strips: pp.player.mixer?.strips.map((s) => s.cfg && { reverb: s.cfg.reverb, delay: s.cfg.delay }) }; });

  let s = await st();
  check(await view() === 'fx', 'FX opens FX view');
  check(s.rp === 4 && s.dp === 7, `the project's presets: reverb ${s.rp + 1}, delay ${s.dp + 1}`);
  check(await p.$eval('.pad.fxp.reverb.on', (e) => e.textContent) === '5' && await p.$eval('.pad.fxp.delay.on', (e) => e.textContent) === '8', 'reverb 5 and delay 8 are bright');
  check(await p.$eval('.pads .pad:nth-child(25)', (e) => e.classList.contains('fxon') && e.classList.contains('on')), 'pad 25: FX on');
  check(s.mix.drums[2].reverb === 17 && s.mix.drums[3].reverb === 29, 'drum sends come from the tail (Drum 3 17, Drum 4 29)');
  check(s.strips[6].reverb === 17, 'and reach the mixer');

  // Knobs: reverb sends to start with.
  const knobs = () => pw(() => { const m = window.tracksdeck.panel().mixKnobs(); return m && { mode: m.mode, v: [0, 1, 2, 3, 4, 5, 6, 7].map((k) => m.get(k)), cap: [...document.querySelectorAll('#macro-row .macro .m-cap')].map((c) => c.textContent) }; });
  let k = await knobs();
  check(k?.mode === 'reverb' && k.v[6] === 17 && k.v[7] === 29 && k.v[0] === 16, `the macro knobs are reverb sends (${k?.v})`);
  check(k?.cap[0] === 'Synth 1' && k.cap[7] === 'Drum 4', 'captions name the tracks');

  // The send faders under the pads show the same values and set them.
  const faders = () => p.$$eval('.sendbox .lvl input', (x) => x.map((e) => +e.value));
  check(await p.isVisible('.sendbox') && (await faders()).join() === k.v.join(), 'the faders under the pads show the reverb sends');
  check(await p.$eval('.sendkind button.on', (e) => e.dataset.kind) === 'reverb', 'the switch says Reverb sends');
  await p.$eval('.sendbox .lvl[data-track="5"] input', (e) => { e.value = 40; e.dispatchEvent(new Event('input', { bubbles: true })); });
  check(await pw(() => window.tracksdeck.proj.send(5, 'reverb')) === 40 && (await knobs()).v[5] === 40, 'a fader sets Drum 2\'s reverb send, and the knob follows');
  await p.click('.sendkind button[data-kind="delay"]');
  check((await knobs()).mode === 'delay' && (await faders()).join() === (await knobs()).v.join() && (await st()).dp === 7, 'Delay sends switches the faders and knobs without changing the preset');
  await p.click('.sendkind button[data-kind="reverb"]');
  await pw(() => window.tracksdeck.panel().mixKnobs().set(5, 0));
  // A delay preset: number and values written, knobs become delay sends.
  await p.click('.pad.fxp.delay[data-delay="10"]');
  s = await st();
  check(s.dp === 10 && s.fx.delaySync === 10 && s.fx.delayFeedback === 82, 'delay 11 sets its number and values');
  check(s.edited, 'the project counts as edited');
  k = await knobs();
  check(k.mode === 'delay' && k.v[0] === 30 && k.v[1] === 14, `the knobs are now delay sends (${k.v})`);
  check((await faders()).join() === k.v.join() && await p.$eval('.sendkind button.on', (e) => e.dataset.kind) === 'delay', 'and the faders switch to delay sends');
  check(await pw(() => window.tracksdeck.proj.player.mix.delay.sync) === 10, 'the mixer plays the new delay');
  // A reverb preset.
  await p.click('.pad.fxp.reverb[data-reverb="0"]');
  s = await st();
  check(s.rp === 0 && s.fx.reverbType === 0 && s.fx.reverbDecay === 80, 'reverb 1 sets its number and values');
  check((await knobs()).mode === 'reverb', 'and the knobs are reverb sends again');
  // Turning a knob sets the send; Drum 1 = tail byte 2.
  await pw(() => window.tracksdeck.panel().mixKnobs().set(4, 90));
  s = await st();
  check(s.fx.reverbSends[2] === 90 && s.strips[4].reverb === 90, 'Drum 1\'s knob sets its reverb send (tail byte 2) and the mixer follows');
  await pw(() => window.tracksdeck.panel().mixKnobs().set(2, 55));
  s = await st();
  check(s.fx.reverbSends[6] === 55, 'MIDI 1\'s send goes to tail byte 6');
  // FX off / on.
  await p.click('.pads .pad:nth-child(25)');
  s = await st();
  check(s.fx.fxBypass === true && s.mix.bypass === true, 'pad 25 turns FX off (bypass)');
  check(await p.$eval('.pads .pad:nth-child(25)', (e) => e.textContent) === 'FX off', 'and says so');
  await p.click('.pads .pad:nth-child(25)');
  check((await st()).fx.fxBypass === false, 'and on again');

  // Side Chain view: FX again.
  await fxBtn();
  check(await view() === 'sidechain', 'FX again opens Side Chain view');
  check(await p.$$eval('.pad.scoff.on', (x) => x.length) === 2, 'both synths start Off (bright)');
  check(await pw(() => window.tracksdeck.panel().mixKnobs()) === null, 'the knobs go back to the patch macros');
  await p.click('.pad.scp[data-sctrack="1"][data-scpreset="5"]');
  s = await st();
  check(s.sc[1].preset === 5 && s.sc[1].depth === 127 && s.sc[1].hold === 90, 'Synth 2 preset 5 sets its values');
  check(s.shapes?.[1]?.drum === 0, 'the mixer ducks Synth 2 from Drum 1');
  await p.click('.pad.scsrc[data-scsrc="2"]');
  s = await st();
  check(s.sc[1].source === 2 && s.shapes[1].drum === 2, 'pad 7 makes Drum 3 the trigger for Synth 2 (the track pressed last)');
  check(s.sc[0].source === 0, 'Synth 1 keeps its own trigger');
  // ▼: MIDI page.
  await pw(() => [...document.querySelectorAll('.ct button')].find((b) => b.textContent.trim() === '▼').click());
  check(await p.$eval('.pad.scoff', (e) => e.dataset.sctrack) === '2', '▼ shows MIDI 1 and 2');
  await p.click('.pad.scp[data-sctrack="3"][data-scpreset="2"]');
  check((await st()).sc[3].preset === 2, 'MIDI 2 gets preset 2 (saved; not played in the browser)');
  await pw(() => [...document.querySelectorAll('.ct button')].find((b) => b.textContent.trim() === '▲').click());
  check(await p.$eval('.pad.scoff', (e) => e.dataset.sctrack) === '0', '▲ goes back to the synths');

  // A muted trigger drum doesn't duck.
  const ducks = await pw(() => {
    const pl = window.tracksdeck.proj.player;
    let n = 0; const orig = pl.mixer.trigger.bind(pl.mixer);
    pl.mixer.trigger = (d, t) => { n++; orig(d, t); };
    const ev = { t: 0, d: 0.1, track: 6, note: 60, vel: 100, part: 'x' };
    pl.drumBuffers ??= new Map();
    const at = pl.ctx.currentTime + 0.05;
    pl.mutes[6] = true; try { pl.drum(ev, at); } catch {}
    const muted = n;
    pl.mutes[6] = false; try { pl.drum(ev, at); } catch {}
    pl.mixer.trigger = orig;
    return { muted, open: n - muted };
  });
  check(ducks.muted === 0 && ducks.open === 1, 'a muted drum doesn\'t fire the side chain');

  // Save, reload: kept.
  await pw(() => window.tracksdeck.proj.save());
  await pw(() => window.tracksdeck.loadProject(24));
  await p.waitForTimeout(300);
  s = await st();
  check(s.rp === 0 && s.dp === 10 && s.fx.reverbSends[2] === 90 && s.sc[1].preset === 5 && s.sc[1].source === 2 && s.sc[3].preset === 2, 'Save keeps presets, sends and side chains');
  // Revert puts back the saved version.
  await fxBtn();
  if (await view() !== 'fx') await fxBtn();
  await p.click('.pad.fxp.reverb[data-reverb="7"]');
  await pw(() => window.tracksdeck.proj.revert());
  s = await st();
  check(s.rp === 0 && !s.edited && s.mix.reverb.decay === 80, 'Revert project puts the saved reverb back');

  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
