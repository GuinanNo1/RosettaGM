// TracksDECK 0.27: the pack column (left) hides to a thin strip with ‹ / › or the \ key, and stays
// hidden after a reload. With it hidden the TRACKS panel grows as far as the window's height lets
// the pads fit (no change on a 1440 x 900 laptop); the piano roll takes the pads' new height.
// Needs the RosettaGM root served on 8765.
// node tests/ui_side.cjs <Blue Monday.circuittrackspack>
const { chromium } = require('playwright');

(async () => {
  const packFile = process.argv[2];
  if (!packFile) { console.error('usage: node tests/ui_side.cjs <Blue Monday pack>'); process.exit(2); }
  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const fails = [];
  const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_|fonts\./.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(e.message));
  const open = async () => {
    await p.goto('http://localhost:8765/circuitgm/tracksdeck/');
    await p.waitForFunction(() => window.tracksdeck?.S.pack);
  };
  await open();
  await p.evaluate(() => { indexedDB.deleteDatabase('circuitgm-tracksdeck'); localStorage.clear(); });
  await open();
  await p.setInputFiles('#file-pack', packFile);
  await p.waitForFunction(() => window.tracksdeck.proj.loaded);
  await p.click('#face [data-face=tracks]');
  const box = (s) => p.$eval(s, (e) => { const r = e.getBoundingClientRect(); return { x: r.x, w: r.width, h: r.height, bottom: r.bottom }; });
  const hidden = () => p.$eval('#app', (e) => e.classList.contains('side-hidden'));

  // Shown at first.
  let side = await box('.side'), ct = await box('.ct');
  check(!(await hidden()) && side.w > 250, `the pack column shows at first (${Math.round(side.w)} px)`);
  check(Math.round(ct.w) <= 920, `the panel is at most 920 px wide (${Math.round(ct.w)})`);
  check(await p.textContent('#side-toggle') === '‹' && await p.getAttribute('#side-toggle', 'aria-expanded') === 'true', 'the toggle shows ‹');
  await p.click('.ct .cbtn.view:has-text("Note")').catch(() => {});
  const roll = async () => { await p.evaluate(() => window.tracksdeck.panel().selectView('roll')); await p.waitForTimeout(200); return box('.roll'); };
  const roll1 = await roll();
  await p.evaluate(() => window.tracksdeck.panel().selectView('note'));
  const pads1 = await box('.pads');

  // ‹ hides it: the panel grows, the pads still fit in the window.
  await p.click('#side-toggle');
  await p.waitForTimeout(200);
  side = await box('.side'); ct = await box('.ct');
  check(await hidden() && side.w <= 32, `‹ hides the column to a strip (${Math.round(side.w)} px)`);
  check(await p.isHidden('#patchlist') && await p.isHidden('#pack-open'), 'its contents are hidden');
  check(await p.textContent('#side-toggle') === '›' && await p.getAttribute('#side-toggle', 'aria-expanded') === 'false', 'the toggle shows ›');
  check(ct.w > 1000, `at 1920 x 1080 the panel grows (${Math.round(ct.w)} px)`);
  const pads2 = await box('.pads'), dev = await box('.device');
  check(pads2.w > pads1.w * 1.2, `the pads grow (${Math.round(pads1.w)} → ${Math.round(pads2.w)} px)`);
  const centre = ct.x + ct.w / 2, devMid = dev.x + dev.w / 2;
  check(Math.abs(centre - devMid) < 20, `the panel is centred (panel centre ${Math.round(centre)}, area centre ${Math.round(devMid)})`);
  check(pads2.bottom <= dev.bottom, `and still fit above the bottom bar (pads end ${Math.round(pads2.bottom)}, panel area ${Math.round(dev.bottom)})`);
  const roll2 = await roll();
  check(roll2.h > roll1.h + 50, `the piano roll takes the pads' new height (${Math.round(roll1.h)} → ${Math.round(roll2.h)} px)`);
  await p.evaluate(() => window.tracksdeck.panel().selectView('note'));

  // Remembered after a reload; › shows it again.
  await open();
  await p.waitForTimeout(200);
  check(await hidden(), 'the column stays hidden after a reload');
  await p.click('#side-toggle');
  await p.waitForTimeout(100);
  check(!(await hidden()) && await p.isVisible('#patchlist'), '› shows it again');

  // The \ key toggles it, but not while typing.
  await p.evaluate(() => document.activeElement?.blur());
  await p.keyboard.press('Backslash');
  await p.waitForTimeout(100);
  check(await hidden(), 'the \\ key hides it');
  await p.keyboard.press('Backslash');
  await p.waitForTimeout(100);
  check(!(await hidden()), 'and shows it again');
  await p.focus('#search');
  await p.keyboard.press('Backslash');
  await p.waitForTimeout(100);
  check(!(await hidden()) && (await p.inputValue('#search')) === '\\', 'typing \\ in the search box types it, and leaves the column');
  await p.fill('#search', '');

  // A laptop window: hiding the column doesn't make the panel bigger (the pads wouldn't fit).
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.click('#side-toggle');
  await p.waitForTimeout(200);
  ct = await box('.ct');
  check(Math.round(ct.w) <= 920, `at 1440 x 900 the panel stays at most 920 px (${Math.round(ct.w)})`);
  const d2 = await box('.device');
  check(Math.abs(ct.x + ct.w / 2 - (d2.x + d2.w / 2)) < 20, 'and sits in the middle of the space');
  await p.click('#side-toggle');

  // Phones (stacked layout): the column collapses to its toggle.
  await p.setViewportSize({ width: 700, height: 900 });
  await p.waitForTimeout(100);
  const s1 = await box('.side');
  await p.click('#side-toggle');
  await p.waitForTimeout(150);
  const s2 = await box('.side');
  check(s2.h < 50 && s1.h > 150, `stacked layout: the column collapses (${Math.round(s1.h)} → ${Math.round(s2.h)} px tall)`);
  await p.click('#side-toggle');

  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
