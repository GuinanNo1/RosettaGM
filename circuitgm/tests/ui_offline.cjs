// TracksDECK in Offline mode (the default since v0.9): no Circuit Tracks link, the Saved / Edited
// status line, the Unsaved edits tray, the warning before another pack replaces unsaved edits, and a
// MIDI keyboard (a stand-in Web MIDI input) playing the browser synth on channels 3 and 4.
// Needs the RosettaGM root served on port 8765 (python3 -m http.server 8765).
// node tests/ui_offline.cjs [screenshot dir]
const { chromium } = require('playwright');
const fs = require('fs');

// A MIDI input only (no outputs): a keyboard, or a Circuit Tracks when named so.
const fakeKeys = () => {
  window.__midiAsked = [];
  const inputs = new Map();
  const access = { inputs, outputs: new Map(), onstatechange: null };
  window.__plug = (name) => {
    const port = { name, state: 'connected', onmidimessage: null };
    inputs.set(name, port);
    access.onstatechange?.({ port });
    return port;
  };
  window.__send = (name, bytes) => inputs.get(name)?.onmidimessage?.({ data: Uint8Array.from(bytes) });
  navigator.requestMIDIAccess = async (opts) => { window.__midiAsked.push(opts ?? {}); return access; };
};

(async () => {
  const out = process.argv[2] ?? 'tests/out';
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const fails = [];
  const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(fakeKeys);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_|fonts\./.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  const open = async (q = '') => { await page.goto(`http://localhost:8765/circuitgm/tracksdeck/${q}`); await page.waitForFunction(() => window.tracksdeck?.S.pack && document.querySelectorAll('#patchlist li[data-slot]').length === 128); };
  await page.goto('http://localhost:8765/circuitgm/tracksdeck/');
  await page.evaluate(() => indexedDB.deleteDatabase('circuitgm-tracksdeck'));
  await open();

  // --- no Circuit Tracks link anywhere
  check(await page.isHidden('#link') && await page.isHidden('#hw') && await page.isHidden('#hear-ctl') && await page.isHidden('#pack-tracks-row') && await page.isHidden('#ed-hw'), 'no link, Live, Get, Save to Tracks or Hear on controls');
  check(await page.isVisible('#kb') && (await page.innerText('#kb-text')) === 'No MIDI keyboard' && await page.isVisible('#kb-btn'), 'the keyboard status shows instead');
  check(await page.isVisible('#synth-seg'), 'the Synth 1 / Synth 2 switch is shown');
  check(!(await page.evaluate(() => window.__midiAsked.length)), 'MIDI is not asked for until the button is pressed');

  // --- status line
  check((await page.innerText('#ed-state')) === 'SAVED' || (await page.innerText('#ed-state')).toLowerCase() === 'saved', `a fresh patch shows Saved (${await page.innerText('#ed-state')})`);
  check(await page.isHidden('#ed-save'), 'no save buttons while saved');
  check((await page.innerText('#tray-count')) === '0', 'the tray starts empty');

  // Edit slot 1, then slot 3.
  await page.evaluate(() => { const w = window.tracksdeck; w.setByte(70, 20); });
  check(/edited/i.test(await page.innerText('#ed-state')) && await page.isVisible('#ed-save'), 'an edit shows Edited · not saved with Save .syx and Download pack');
  // Leaving a changed patch asks once.
  const dlgOpen = () => page.evaluate(() => document.querySelector('#dlg').open);
  await page.click('#patchlist li[data-slot="2"]');
  await page.waitForSelector('#dlg[open]');
  check(/Save your changes to "Grand Piano"/.test(await page.innerText('#dlg-title')) && (await page.innerText('#dlg-ok')) === 'Save .syx', 'leaving a changed patch asks once whether to save it');
  await page.click('#dlg-alt2');   // Not now
  await page.waitForTimeout(100);
  check(await page.evaluate(() => window.tracksdeck.S.slot === 2), 'Not now moves on, the edit stays unsaved');
  await page.click('#patchlist li[data-slot="0"]');
  await page.waitForTimeout(100);
  check(!(await dlgOpen()), 'leaving an unchanged patch asks nothing');
  await page.click('#patchlist li[data-slot="2"]');
  await page.waitForTimeout(100);
  check(!(await dlgOpen()) && await page.evaluate(() => window.tracksdeck.S.slot === 2), 'the same unsaved patch is not asked about twice');
  await page.evaluate(() => window.tracksdeck.setByte(70, 21));
  await page.click('#patchlist li[data-slot="0"]');
  await page.waitForSelector('#dlg[open]');
  await page.click('#dlg-cancel');
  await page.waitForTimeout(100);
  check(await page.evaluate(() => window.tracksdeck.S.slot === 2), 'Stay on this patch stays');
  await page.click('#patchlist li[data-slot="0"]');
  await page.waitForSelector('#dlg[open]');
  await page.check('#dlg-body input[type=checkbox]');
  await page.click('#dlg-alt2');
  await page.waitForTimeout(100);
  check(await page.evaluate(() => window.tracksdeck.S.slot === 0) && !(await page.isChecked('#tray-ask')), "Don't ask again turns it off (the tray box shows it)");
  await page.click('#patchlist li[data-slot="2"]');
  await page.waitForTimeout(100);
  check(!(await dlgOpen()), 'then nothing asks');
  check((await page.innerText('#tray-count')) === '2', 'both edits are in the tray');
  await page.click('#tray summary');
  const rows = await page.$$eval('#tray-list li', (ls) => ls.map((l) => l.querySelector('.n').textContent));
  check(rows.join() === '003,001', `newest first (${rows.join()})`);
  check(/just now/.test(await page.innerText('#tray-list')), 'tray rows say when');

  // Save .syx from the status line: that slot leaves the tray.
  let dl = page.waitForEvent('download');
  await page.click('#ed-syx');
  check((await dl).suggestedFilename().endsWith('.syx'), 'Save .syx downloads the patch');
  check((await page.innerText('#ed-state')).toLowerCase() === 'saved' && (await page.innerText('#tray-count')) === '1', 'it is then Saved, and out of the tray');
  await page.evaluate(() => window.tracksdeck.setByte(70, 22));
  check(/edited/i.test(await page.innerText('#ed-state')) && (await page.innerText('#tray-count')) === '2', 'a later edit makes it unsaved again');

  // Open from the tray, then Discard slot 3.
  await page.click('#tray-list li[data-slot="0"] button:has-text("Open")');
  check(await page.evaluate(() => window.tracksdeck.S.slot === 0), 'Open in the tray edits that patch');
  await page.click('#tray-list li[data-slot="2"] button:has-text("Discard")');
  check(await page.evaluate(() => window.tracksdeck.S.pack.patches[2][70] === 21) && (await page.innerText('#tray-count')) === '1', 'Discard puts the patch back as it was last saved (its .syx)');
  await page.click('#patchlist li[data-slot="2"]');
  await page.click('#undo');
  check(await page.evaluate(() => window.tracksdeck.S.bytes[70] === 22), 'undo on that patch brings the discarded edit back');

  // Initial Patch and Revert no longer ask.
  await page.click('#patch-menu-btn');
  await page.click('[data-act="init"]');
  check(!(await page.evaluate(() => document.querySelector('#dlg').open)) && (await page.inputValue('#patch-name')) === 'Initial Patch', 'Start from the Initial Patch asks nothing');
  await page.click('#undo');

  // A reload keeps the tray, including what was saved.
  await page.waitForTimeout(700);
  await open();
  check((await page.innerText('#tray-count')) === '2', `a reload keeps the unsaved edits (${await page.innerText('#tray-count')})`);

  // --- loading a pack warns, offers a bank, then clears
  await page.click('#pack-reset');
  await page.waitForSelector('#dlg[open]');
  check(/2 unsaved edits/.test(await page.innerText('#dlg-body')) && (await page.innerText('#dlg-alt')).includes('bank'), 'Load TracksGM warns with the count and offers a .syx bank');
  await page.click('#dlg-cancel');
  check((await page.innerText('#tray-count')) === '2', 'Cancel keeps the edits');
  await page.click('#pack-reset');
  await page.waitForSelector('#dlg[open]');
  dl = page.waitForEvent('download');
  await page.click('#dlg-alt');
  const bank = await dl;
  const size = fs.statSync(await bank.path()).size;
  check(size === 2 * 350, `the bank holds the 2 unsaved patches (${size} bytes)`);
  const fresh = await page.waitForFunction(() => window.tracksdeck.unsavedSlots().length === 0 && document.querySelector('#tray-count').textContent === '0' && document.querySelector('#patch-name').value === 'Grand Piano' && window.tracksdeck.S.pack.patches[2][70] === window.tracksdeck.S.pack.original[2][70], null, { timeout: 8000 }).then(() => true, () => false);
  check(fresh, 'then TracksGM loads fresh');
  await page.click('#pack-reset');
  await page.waitForTimeout(400);
  check(!(await page.evaluate(() => document.querySelector('#dlg').open)), 'with nothing unsaved, Load TracksGM asks nothing');

  // Download pack marks everything saved.
  await page.evaluate(() => window.tracksdeck.setByte(70, 30));
  await page.click('#ed-pack');
  await page.waitForSelector('#dlg[open]');
  dl = page.waitForEvent('download');
  await page.click('#dlg-ok');
  check((await dl).suggestedFilename().endsWith('.circuittrackspack') && (await page.innerText('#tray-count')) === '0', 'Download pack empties the tray');

  // The tray box turns the question back on.
  await page.evaluate(() => { document.querySelector('#tray').open = true; });
  await page.check('#tray-ask');
  await page.evaluate(() => window.tracksdeck.setByte(70, 31));
  await page.click('#patchlist li[data-slot="5"]');
  await page.waitForSelector('#dlg[open]');
  dl = page.waitForEvent('download');
  await page.click('#dlg-ok');
  check((await dl).suggestedFilename().endsWith('.syx') && await page.evaluate(() => window.tracksdeck.S.slot === 5 && window.tracksdeck.unsavedSlots().length === 0), 'with it back on, Save .syx saves the patch and moves on');

  // --- MIDI keyboard
  await page.click('#kb-btn');
  check(await page.evaluate(() => window.__midiAsked.length === 1 && window.__midiAsked[0].sysex === false), 'MIDI is asked for without SysEx');
  check(/no midi keyboard found/i.test(await page.innerText('#kb-text')), 'with nothing plugged in it says so');
  await page.evaluate(() => window.__plug('Keystation 49'));
  await page.waitForFunction(() => /Keystation/.test(document.querySelector('#kb-text').textContent));
  check(await page.evaluate(() => document.querySelector('#kb-led').classList.contains('on')), 'a plugged-in keyboard lights the status');
  await page.evaluate(() => window.__send('Keystation 49', [0x90, 60, 90]));
  check(await page.evaluate(() => window.tracksdeck.S.held.has(60) && window.tracksdeck.S.synth === 0), 'channel 1 plays the synth chosen here');
  await page.evaluate(() => window.__send('Keystation 49', [0x80, 60, 0]));
  check(await page.evaluate(() => !window.tracksdeck.S.held.has(60)), 'note off stops it');
  await page.evaluate(() => window.__send('Keystation 49', [0x93, 64, 100]));
  check(await page.evaluate(() => window.tracksdeck.S.synth === 1 && document.body.dataset.synth === '1' && window.tracksdeck.S.held.has(64)), 'channel 4 (MIDI 2) chooses Synth 2 and plays it');
  await page.evaluate(() => window.__send('Keystation 49', [0x83, 64, 0]));
  await page.evaluate(() => window.__send('Keystation 49', [0x92, 62, 100]));
  check(await page.evaluate(() => window.tracksdeck.S.synth === 0 && window.tracksdeck.S.held.has(62)), 'channel 3 (MIDI 1) chooses Synth 1');
  // Sustain pedal holds released notes until it is lifted.
  await page.evaluate(() => { window.__send('Keystation 49', [0xb2, 64, 127]); window.__send('Keystation 49', [0x82, 62, 0]); });
  check(await page.evaluate(() => window.tracksdeck.S.held.has(62)), 'the sustain pedal holds a released note');
  await page.evaluate(() => window.__send('Keystation 49', [0xb2, 64, 0]));
  check(await page.evaluate(() => !window.tracksdeck.S.held.has(62)), 'lifting the pedal lets it go');
  // A Circuit Tracks: the reminder, once.
  await page.evaluate(() => window.__plug('Circuit Tracks MIDI'));
  await page.waitForFunction(() => /Circuit Tracks/.test(document.querySelector('#kb-text').textContent));
  check(/Select MIDI 1 or MIDI 2/.test(await page.innerText('#toast')), 'a Circuit Tracks gets the MIDI 1 / MIDI 2 reminder');
  check(!(await page.evaluate(() => document.querySelector('#dlg').open)), 'as a note, not a dialog');
  // The keyboard comes back by itself on the next visit (permission already granted).
  await page.screenshot({ path: `${out}/offline.png` });

  // --- ?tracksmode still shows the link (for later work)
  await open('?tracksmode');
  check(await page.isVisible('#link') && await page.isHidden('#kb'), '?tracksmode shows the Circuit Tracks link instead');

  check(!errors.length, `no console errors (${errors.join(' | ') || 'none'})`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
