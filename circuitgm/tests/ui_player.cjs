// PatchWorker's Offline player (0.10): Projects, Patterns, Mixer, Tempo and Note views with a
// Circuit Tracks pack that has projects. Needs the RosettaGM root served on port 8765.
// node tests/ui_player.cjs <pack with projects, e.g. "Blue Monday.circuittrackspack"> [screenshot dir]
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const packFile = process.argv[2];
  const out = process.argv[3] ?? 'tests/out';
  if (!packFile) { console.error('usage: node tests/ui_player.cjs <pack.circuittrackspack> [out dir]'); process.exit(2); }
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const fails = [];
  const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
  const errors = [];
  for (const [name, vp] of [['desktop', { width: 1400, height: 950 }], ['phone', { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport: vp });
    const p = await ctx.newPage();
    p.on('console', (m) => { if (m.type() === 'error' && !/ERR_|fonts\./.test(m.text())) errors.push(`${name}: ${m.text()}`); });
    p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    await p.goto('http://localhost:8765/circuitgm/patchworker/');
    await p.evaluate(() => indexedDB.deleteDatabase('circuitgm-patchworker'));
    await p.goto('http://localhost:8765/circuitgm/patchworker/');
    await p.waitForFunction(() => window.patchworker?.S.pack);
    await p.click('#face [data-face=tracks]');
    await p.click('.view[data-view=projects]');
    check(await p.$$eval('.pad.project.filled', (x) => x.length) === 0, `${name}: TracksGM has no projects to play`);
    check(await p.evaluate(() => document.querySelector('.tbtn.play').classList.contains('idle')), `${name}: Play is off until a project is loaded`);

    check(await p.isHidden('#song-ctl'), `${name}: no Project picker for a pack without projects`);
    // The panel is laid out as the Circuit Tracks (User Guide p. 15): Play at the bottom right of the
    // grid, the view columns either side, the track buttons above.
    const lay = await p.evaluate(() => {
      const r = (q) => document.querySelector(q).getBoundingClientRect();
      const g = r('.ct .pads'), play = r('.tbtn.play'), note = r('.cbtn.view[data-view=note]'), mixer = r('.cbtn.view[data-view=mixer]'), trk = r('.trk[data-track="0"]'), shift = r('.cbtn.shift');
      return { playRight: play.left >= g.right - 2, playBottom: Math.abs(play.bottom - g.bottom) < 16, noteLeft: note.right <= g.left + 2, mixerRight: mixer.left >= g.right - 2, trkAbove: trk.bottom <= g.top + 2, shiftTopRight: shift.left >= g.right - 2 && shift.bottom < trk.top };
    });
    check(Object.values(lay).every(Boolean), `${name}: Play bottom right, views either side, tracks above, Shift top right (${JSON.stringify(lay)})`);
    await p.click('.cbtn.view[data-view=gate]');
    await p.click('.cbtn.view[data-view=gate]');
    check(await p.evaluate(() => window.patchworker.panel().state.view === 'micro'), `${name}: pressing Gate again opens Micro Step`);
    await p.click('.cbtn.shift');
    await p.click('.cbtn.view[data-view=fx]');
    check(await p.evaluate(() => window.patchworker.panel().state.view === 'sidechain' && !document.querySelector('.cbtn.shift').classList.contains('on')), `${name}: Shift then FX opens Side Chain, and Shift lets go`);
    await p.click('.cbtn.view[data-view=projects]');
    await p.setInputFiles('#file-pack', packFile);
    await p.waitForFunction(() => window.patchworker.S.pack.fileName !== 'TracksGM_v1.circuittrackspack');

    // The bottom bar's Project picker and ▶ play a song straight from the editor.
    await p.click('#face [data-face=editor]');
    await p.waitForSelector('#song-ctl:not([hidden])');
    const opts = await p.$$eval('#song-pick option', (o) => o.length);
    check(opts > 0, `${name}: the bottom bar offers the pack's projects (${opts})`);
    await p.click('#song-play');
    await p.waitForFunction(() => window.patchworker.proj.playing, null, { timeout: 8000 });
    check((await p.innerText('#song-play')) === '■' && await p.evaluate(() => window.patchworker.proj.entry.slot === +document.querySelector('#song-pick').value), `${name}: its ▶ loads and plays the chosen project`);
    await p.keyboard.press('Space');
    check(!(await p.evaluate(() => window.patchworker.proj.playing)) && (await p.innerText('#song-play')) === '▶', `${name}: Space stops it from the editor`);
    await p.click('#face [data-face=tracks]');
    await p.click('.view[data-view=projects]');
    const filled = await p.$$eval('.pad.project.filled', (ps) => ps.map((x) => +x.dataset.project));
    check(filled.length > 0, `${name}: the pack's projects light up (${filled.join(', ')})`);
    await p.click(`.pad[data-project="${filled[0]}"]`);
    await p.waitForFunction(() => { const w = window.patchworker; return w.proj.render && w.S.slot === w.proj.patchSlots[w.S.synth] && document.querySelector('.pad.project.lit') && +document.querySelector('#bpm').value === w.proj.tempo; });
    const info = await p.evaluate(() => { const w = window.patchworker; return { slots: w.proj.patchSlots, slot: w.S.slot, events: w.proj.render.events.length, loop: w.proj.render.loop, tempo: w.proj.tempo, bpm: document.querySelector('#bpm').value }; });
    check(info.events > 0 && info.loop > 0, `${name}: the project renders (${info.events} events, ${info.loop.toFixed(1)} s loop)`);
    check(info.slot === info.slots[0], `${name}: the editor opens Synth 1's patch (slot ${info.slot + 1})`);
    check(+info.bpm === info.tempo, `${name}: the tempo box takes the project's tempo (${info.tempo})`);
    check(await p.evaluate((i) => document.querySelector(`.pad[data-project="${i}"]`).classList.contains('lit'), filled[0]), `${name}: the loaded project's pad is lit`);

    // Synth 2 follows its patch; edits reach the playing synth.
    await p.click('#synth-seg [data-synth="1"]');
    await p.waitForTimeout(100);
    check(await p.evaluate(() => window.patchworker.S.slot === window.patchworker.proj.patchSlots[1]), `${name}: choosing Synth 2 edits the patch Synth 2 plays`);
    await p.click('#synth-seg [data-synth="0"]');
    await p.waitForTimeout(100);

    // Play.
    await p.click('.tbtn.play');
    await p.waitForTimeout(900);
    const pos = await p.evaluate(() => window.patchworker.panel().state.pos);
    check(await p.evaluate(() => window.patchworker.proj.playing) && pos && pos.tracks.length === 8, `${name}: Play plays and the play head moves (scene ${pos ? pos.scene + 1 : '?'})`);
    check(await p.evaluate(() => { const w = window.patchworker; return w.proj.player.synths[0]?.bytes === w.S.pack.patches[w.proj.patchSlots[0]]; }), `${name}: Synth 1 plays the pack's own patch array (edits are heard)`);
    await p.evaluate(() => window.patchworker.setByte(70, 40));   // an edit while playing
    check(!errors.length, `${name}: editing while playing raises nothing`);

    // Note view: steps and the play head.
    await p.click('.view[data-view=note]');
    await p.waitForTimeout(300);
    check(await p.$$eval('.pad[data-step]', (x) => x.length) === 16, `${name}: Note view shows 16 steps`);
    check(await p.$$eval('.pad.step.play', (x) => x.length) === 1, `${name}: one step carries the play head`);

    // Patterns view: pick a pattern for Drum 1, then chain.
    await p.click('.view[data-view=patterns]');
    await p.waitForTimeout(200);
    check(await p.$$eval('.pad.pattern', (x) => x.length) === 32 && await p.$$eval('.pad.pattern.sel', (x) => x.length) >= 8, `${name}: Patterns view shows each track's selected patterns`);
    await p.click('.pad[data-ptrack="4"][data-pattern="1"]');
    check(await p.evaluate(() => { const w = window.patchworker.proj; return w.custom && w.sel[4].start === 1 && w.sel[4].end === 1 && w.playing; }), `${name}: clicking a pattern plays it (still playing)`);
    await p.click('.pad[data-ptrack="4"][data-pattern="3"]', { modifiers: ['Shift'] });
    check(await p.evaluate(() => { const s = window.patchworker.proj.sel[4]; return s.start === 1 && s.end === 3; }), `${name}: Shift-click chains patterns 2 to 4`);
    await p.click('.fnrow .arrow:has-text("▲")');
    check(await p.$eval('.pad.pattern', (x) => x.dataset.pattern) === '4', `${name}: page 2 shows patterns 5-8`);

    // Mixer view: mute, level, scenes.
    await p.click('.view[data-view=mixer]');
    await p.waitForTimeout(200);
    await p.click('.pad[data-mute="4"]');
    check(await p.evaluate(() => window.patchworker.proj.mutes[4] && window.patchworker.proj.player.mutes[4]) && await p.$eval('.pad[data-mute="4"]', (x) => x.classList.contains('muted')), `${name}: the top row mutes Drum 1`);
    await p.click('.pad[data-mute="4"]');
    await p.$eval('.mixbox .lvl[data-track="1"] input', (el) => { el.value = 40; el.dispatchEvent(new Event('input')); });
    check(await p.evaluate(() => window.patchworker.proj.levels[1] === 40), `${name}: a level slider sets Synth 2's level`);
    await p.click('.pad[data-scene="1"]');
    check(await p.evaluate(() => { const w = window.patchworker.proj; return !w.custom && w.scene === 1 && w.sceneChain.start === 1 && w.sceneChain.end === 1; }), `${name}: a scene pad plays that scene (and puts back its patterns)`);
    await p.click('.pad[data-scene="3"]', { modifiers: ['Alt'] });
    check(await p.evaluate(() => { const c = window.patchworker.proj.sceneChain; return c.start === 1 && c.end === 3; }), `${name}: Alt-click chains scenes 2 to 4 (Shift-click stores, 0.24)`);
    check(await p.$$eval('.pad.scene.chain', (x) => x.length) === 3, `${name}: the chain is lit`);

    // Tempo view.
    await p.click('.view[data-view=tempo]');
    await p.fill('.tempobox input[type=number]', '100');
    await p.press('.tempobox input[type=number]', 'Enter');
    await p.waitForTimeout(100);
    check(await p.evaluate(() => window.patchworker.proj.tempo === 100) && (await p.innerText('.bigbpm')) === '100 BPM', `${name}: Tempo view sets the tempo`);
    await p.$eval('.tempobox input[aria-label=Swing]', (el) => { el.value = 66; el.dispatchEvent(new Event('input')); });
    check(await p.evaluate(() => window.patchworker.proj.swing === 66), `${name}: and the swing`);
    await p.screenshot({ path: `${out}/player-${name}.png` });

    // Preset view: choosing another patch changes what Synth 1 plays.
    await p.click('.view[data-view=preset]');
    const target = await p.evaluate(() => (window.patchworker.proj.patchSlots[0] + 1) % 32);
    await p.click(`.pad[data-slot="${target}"]`);
    // The patch was edited while playing: leaving it asks once whether to save it.
    await p.waitForSelector('#dlg[open]');
    await p.click('#dlg-alt2');
    await p.waitForTimeout(150);
    check(await p.evaluate((t) => window.patchworker.proj.patchSlots[0] === t && window.patchworker.proj.player.synths[0]?.bytes === window.patchworker.S.pack.patches[t], target), `${name}: a Preset pad gives Synth 1 that patch to play`);

    // Space stops, Space plays.
    await p.keyboard.press('Space');
    check(!(await p.evaluate(() => window.patchworker.proj.playing)), `${name}: Space stops the project`);
    await p.keyboard.press('Space');
    await p.waitForTimeout(200);
    check(await p.evaluate(() => window.patchworker.proj.playing), `${name}: Space plays it again`);
    await p.keyboard.press('Escape');
    check(!(await p.evaluate(() => window.patchworker.proj.playing)), `${name}: Esc stops it`);

    // Opening another pack forgets the project.
    await p.evaluate(() => { const w = window.patchworker; w.S.pack.saved = {}; });
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check(overflow <= 0, `${name}: no sideways overflow (${overflow})`);
    await ctx.close();
  }
  check(!errors.length, `no console errors (${errors.join(' | ') || 'none'})`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
