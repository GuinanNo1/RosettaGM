// TracksDECK's Tracks panel, Preset view (js/pw/panel.js step 2): patch pages for the synth
// tracks, the lit pad following the patch being edited, edited / fetched marks, copy to a pad
// with the overwrite check, and drum sample pages.
// Needs `python3 -m http.server 8765` running in the repo.
// node tests/ui_preset.cjs [<screenshot dir>]
const { chromium } = require('playwright');

(async () => {
  const shots = process.argv[2];
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errs = [];
  let fails = 0;
  const check = (name, ok) => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); };
  for (const [name, vp] of [['desktop', { width: 1400, height: 950 }], ['phone', { width: 390, height: 844 }]]) {
    const ctx = await b.newContext({ viewport: vp });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await p.goto('http://localhost:8765/circuitgm/tracksdeck/');
    await p.waitForFunction(() => window.tracksdeck?.S.pack && document.querySelectorAll('#patchlist li[data-slot]').length === 128);
    await p.click('#face [data-face=tracks]');
    await p.click('.view[data-view=preset]');
    const lit = () => p.evaluate(() => [...document.querySelectorAll('.pad.preset.lit')].map((x) => +x.dataset.slot).join());
    check(`${name}: Preset shows 32 patch pads and 4 pages`, await p.evaluate(() => document.querySelectorAll('.pad.preset[data-slot]').length === 32 && /1–32/.test(document.querySelector('.panel-lcd').textContent)));
    check(`${name}: the lit pad is the patch being edited`, (await lit()) === String(await p.evaluate(() => window.tracksdeck.S.slot)));
    // Press pad 5: edits slot 5 and plays C3 while held.
    await p.hover('.pad[data-slot="4"]');
    await p.mouse.down();
    await p.waitForTimeout(80);
    check(`${name}: pressing a pad edits that patch and plays it`, (await p.evaluate(() => `${window.tracksdeck.S.slot}|${[...window.tracksdeck.S.held.keys()]}`)) === '4|48');
    await p.mouse.up();
    check(`${name}: letting go stops it`, (await p.evaluate(() => window.tracksdeck.S.held.size)) === 0);
    check(`${name}: the LCD names the patch`, await p.evaluate(() => document.querySelector('.panel-lcd').textContent.includes(`005 ${document.querySelector('#patch-name').value}`)));
    // Page 3, then choosing a patch from the editor's list turns the page back.
    await p.click('.fnrow .arrow:has-text("▲")'); await p.click('.fnrow .arrow:has-text("▲")');
    check(`${name}: page 3 shows slots 65-96`, await p.evaluate(() => document.querySelector('.pad.preset').dataset.slot === '64'));
    await p.evaluate(() => window.tracksdeck.selectSlot(100));
    check(`${name}: choosing slot 101 elsewhere lights it on page 4`, (await lit()) === '100' && await p.evaluate(() => /97–128/.test(document.querySelector('.panel-lcd').textContent)));
    // An edit marks the pad.
    await p.evaluate(() => { const w = window.tracksdeck; w.setByte(20, (w.S.bytes[20] + 1) & 127); });
    check(`${name}: an edited patch gets its mark`, await p.evaluate(() => document.querySelector('.pad[data-slot="100"]').classList.contains('edited')));
    // Copy to pad 102 (not empty: since 0.9 it doesn't ask; undo brings it back).
    await p.click('.cbtn.dup');
    check(`${name}: Copy to pad makes the other pads targets`, await p.evaluate(() => document.querySelectorAll('.pad.preset.target').length === 31));
    await p.click('.pad[data-slot="101"]');
    await p.waitForTimeout(150);
    check(`${name}: copying onto a patch asks nothing`, !(await p.evaluate(() => document.querySelector('#dlg').open)));
    check(`${name}: the copy lands in slot 102 and is edited there`, await p.evaluate(() => {
      const w = window.tracksdeck;
      return w.S.slot === 101 && w.S.pack.patches[101].every((v, i) => v === w.S.pack.patches[100][i]) && document.querySelector('.pad[data-slot="101"]').classList.contains('lit');
    }));
    await p.evaluate(() => window.tracksdeck.undo());
    check(`${name}: undo brings back slot 102`, await p.evaluate(() => {
      const w = window.tracksdeck;
      return w.S.pack.patches[101].every((v, i) => v === w.S.pack.original[101][i]);
    }));
    // Revert slot 101 from the panel.
    await p.evaluate(() => window.tracksdeck.selectSlot(100));
    await p.click('.pad-tools .btn >> text=Revert');
    await p.waitForTimeout(100);
    check(`${name}: Revert clears the mark`, await p.evaluate(() => !document.querySelector('.pad[data-slot="100"]').classList.contains('edited')));
    // Drum track: 2 pages of samples; a pad picks the sample.
    await p.click('.trk[data-track="4"]');
    check(`${name}: Drum 1 shows sample pads, 2 pages, Std Kick lit`, await p.evaluate(() => document.querySelectorAll('.pad.preset[data-sample]').length === 32 && /1–32/.test(document.querySelector('.panel-lcd').textContent) && document.querySelector('.pad.preset.lit').dataset.sample === '0'));
    await p.click('.pad[data-sample="8"]');
    await p.waitForTimeout(200);
    check(`${name}: pressing a sample pad picks it`, await p.evaluate(() => document.querySelector('.pad.preset.lit').dataset.sample === '8' && document.querySelector('.panel-lcd').textContent.includes('009 Room Kick')));
    await p.click('.trk[data-track="2"]');
    check(`${name}: MIDI tracks show no presets`, await p.evaluate(() => document.querySelectorAll('.pad.preset').length === 0));
    check(`${name}: no sideways overflow`, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await p.click('.trk[data-track="0"]');
    if (shots) await p.screenshot({ path: `${shots}/preset-${name}.png`, fullPage: name === 'phone' });
    await ctx.close();
  }
  check(`no console errors (${errs.length ? errs.join('; ') : 'none'})`, !errs.length);
  await b.close();
  console.log(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
