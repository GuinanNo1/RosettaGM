// TracksDECK 0.26: while the song plays, Mixer view's and FX view's macro knobs and faders follow
// recorded level, pan and send movements (as the hardware's knob LEDs do); stopped, they show the
// project's own values. A followed knob or fader is marked `.auto`. Apricots project 1: Synth 2's
// pattern 1 has recorded Pan; the test also draws a Synth 1 level lane and a Drum 1 delay-send lane.
// Needs the RosettaGM root served on 8765.
// node tests/ui_mixfollow.cjs <Apricots.circuittrackspack>
const { chromium } = require('playwright');

(async () => {
  const packFile = process.argv[2];
  if (!packFile) { console.error('usage: node tests/ui_mixfollow.cjs <Apricots pack>'); process.exit(2); }
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] }).catch(() => chromium.launch());
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
  await pw(() => window.tracksdeck.panel().selectView('mixer'));
  await p.waitForSelector('.pad.scene');

  const knobs = () => p.$$eval('#macro-row .macro', (x) => x.map((c) => ({ auto: c.classList.contains('auto'), v: +c.querySelector('.knob').getAttribute('aria-valuenow'), t: c.querySelector('.k-out').textContent })));
  const faders = () => p.$$eval('.mixbox .lvl', (x) => x.map((c) => ({ auto: c.classList.contains('auto'), lv: +c.querySelector('input.fader').value, pn: +c.querySelector('input.pan').value, out: c.querySelector('output').textContent })));
  const sendFaders = () => p.$$eval('.faderbox .lvl', (x) => x.map((c) => ({ auto: c.classList.contains('auto'), v: +c.querySelector('input.fader').value })));

  // One scene; Synth 1 at level 100, Drum 1's delay send 0; Synth 1's pattern holds level 20 and
  // Drum 1's pattern delay send 90 on every step.
  await pw(() => { const pp = window.tracksdeck.proj; pp.selectScene(pp.scene); pp.setLevel(0, 100); pp.setSend(4, 'delay', 0); });
  const pats = await pw(() => { const pp = window.tracksdeck.proj; return { s1: pp.sel[0].start, s2: pp.sel[1].start, d1: pp.sel[4].start }; });
  await pw((x) => {
    const pp = window.tracksdeck.proj;
    const n0 = (pp.raw(0, x.s1).settings.playbackEnd ?? 15) + 1, n4 = (pp.raw(4, x.d1).settings.playbackEnd ?? 15) + 1;
    for (let k = 0; k < n0; k++) pp.setLaneValue(0, x.s1, 'level', k, null, 20);
    for (let k = 0; k < n4; k++) pp.setLaneValue(4, x.d1, 'delay_send', k, null, 90);
    pp.commitLanes();
  }, pats);
  const hasPan = await pw((x) => window.tracksdeck.proj.laneHasData(1, x.s2, 'pan'), pats);
  check(hasPan, `Synth 2's pattern ${pats.s2 + 1} has recorded pan`);
  await pw(() => window.tracksdeck.panel().selectView('mixer'));

  // Stopped: the project's values, nothing marked.
  let k = await knobs(), f = await faders();
  check(k[0].v === 100 && !k[0].auto && f[0].lv === 100 && !f[0].auto, `stopped: knob 1 and the fader show Synth 1's level, 100 (knob ${k[0].v}, fader ${f[0].lv})`);
  check(await pw(() => window.tracksdeck.proj.liveMix(0, 'level')) === null, 'liveMix is null when stopped');

  // Playing: they follow the recording; the project's level is unchanged.
  await pw(() => window.tracksdeck.proj.play());
  await p.waitForFunction(() => window.tracksdeck.proj.liveMix(0, 'level') === 20, null, { timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(250);
  k = await knobs(); f = await faders();
  check(k[0].v === 20 && k[0].auto, `playing: knob 1 follows the recorded level, 20 (${k[0].v}, ${k[0].auto ? 'marked' : 'not marked'})`);
  check(f[0].lv === 20 && f[0].out === '20' && f[0].auto, `the Synth 1 fader follows too (${f[0].lv}, ${f[0].auto ? 'marked' : 'not marked'})`);
  check(await pw(() => window.tracksdeck.proj.levels[0]) === 100, 'the project\'s own level stays 100');
  check(!k[2].auto && !f[2].auto, 'tracks with nothing recorded are not marked');

  // Pan (▼): knob 2 follows Synth 2's recorded pan.
  await p.click('.cbtn.arrow >> nth=0');
  await p.waitForFunction(() => window.tracksdeck.proj.liveMix(1, 'pan') != null, null, { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(100);
  const want = await pw(() => window.tracksdeck.proj.liveMix(1, 'pan'));
  k = await knobs(); f = await faders();
  const base = await pw(() => window.tracksdeck.proj.pans[1]);
  check(want != null && Math.abs(k[1].v - want) <= 30, `pan: knob 2 follows Synth 2's recorded pan (knob ${k[1].v}, recorded ${want}, project ${base})`);
  check(Math.abs(f[1].pn - k[1].v) <= 30, `and so does its pan slider (${f[1].pn})`);
  await p.click('.cbtn.arrow >> nth=1');

  // FX view, delay sends: knob 5 and Drum 1's fader follow the recorded send.
  await pw(() => window.tracksdeck.panel().selectView('fx'));
  await p.waitForSelector('.sendbox:not([hidden])');
  await p.click('.sendkind button[data-kind=delay]');
  await p.waitForTimeout(250);
  k = await knobs(); let sf = await sendFaders();
  check(k[4].v === 90 && k[4].auto, `FX view (delay): knob 5 follows Drum 1's recorded send, 90 (${k[4].v})`);
  check(sf[4].v === 90 && sf[4].auto, `and Drum 1's send fader (${sf[4].v})`);
  check(await pw(() => window.tracksdeck.proj.send(4, 'delay')) === 0, 'the project\'s own send stays 0');
  await p.click('.sendkind button[data-kind=reverb]');
  await p.waitForTimeout(150);
  k = await knobs();
  check(!k[4].auto, 'reverb sends (nothing recorded): knob 5 not marked');
  await p.click('.sendkind button[data-kind=delay]');
  await p.waitForTimeout(150);

  // Stopped again: back to the project's values.
  await pw(() => window.tracksdeck.proj.stop());
  await p.waitForTimeout(150);
  k = await knobs(); sf = await sendFaders();
  check(k[4].v === 0 && !k[4].auto && sf[4].v === 0 && !sf[4].auto, `stopped: knob 5 and the fader back to the project's send, 0 (${k[4].v}, ${sf[4].v})`);
  await pw(() => window.tracksdeck.panel().selectView('mixer'));
  await p.waitForTimeout(100);
  f = await faders(); k = await knobs();
  check(f[0].lv === 100 && !f[0].auto && k[0].v === 100 && !k[0].auto, `Mixer view: Synth 1 back to 100 (fader ${f[0].lv}, knob ${k[0].v})`);

  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
