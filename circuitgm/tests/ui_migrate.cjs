// TracksDECK 0.30: PatchWorker's saved browser data moves once to the new names. A session saved
// under the old IndexedDB name ('circuitgm-patchworker') opens as before, the old localStorage
// settings ('circuitgm-patchworker-*') carry over, and the old names are gone afterwards.
// Needs the RosettaGM root served on 8765. No pack file needed (uses TracksGM from the site).
// node tests/ui_migrate.cjs
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const fails = [];
  const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
  const errors = [];
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_|fonts\./.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(e.message));

  // Seed the old data from another page on the same site, as PatchWorker 0.29 left it.
  await p.goto('http://localhost:8765/circuitgm/rhythmdeck/');
  await p.evaluate(async () => {
    localStorage.clear();
    for (const d of await indexedDB.databases()) indexedDB.deleteDatabase(d.name);
    localStorage.setItem('circuitgm-patchworker-face', 'tracks');
    localStorage.setItem('circuitgm-patchworker-side', 'hidden');
    localStorage.setItem('circuitgm-patchworker-keys', 'l');
    const buffer = await (await fetch('/circuitgm/tracksgm/TracksGM_v1.circuittrackspack')).arrayBuffer();
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('circuitgm-patchworker', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => {
        const tx = req.result.transaction('kv', 'readwrite');
        tx.objectStore('kv').put({ buffer, fileName: 'Migrated pack.circuittrackspack' }, 'pack');
        tx.oncomplete = () => { req.result.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  });

  await p.goto('http://localhost:8765/circuitgm/tracksdeck/');
  await p.waitForFunction(() => window.tracksdeck?.S.pack, null, { timeout: 15000 });
  check(await p.evaluate(() => window.tracksdeck.S.pack.fileName) === 'Migrated pack.circuittrackspack', 'the session saved under the old name opens');
  const ls = await p.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));
  check(ls['circuitgm-tracksdeck-face'] === 'tracks' && ls['circuitgm-tracksdeck-side'] === 'hidden' && ls['circuitgm-tracksdeck-keys'] === 'l', 'the old settings carry over to the new keys');
  check(!Object.keys(ls).some((k) => k.startsWith('circuitgm-patchworker')), 'no old localStorage keys are left');
  check(await p.$eval('#app', (e) => e.classList.contains('side-hidden')), 'a carried-over setting is used (pack column hidden)');
  await p.waitForTimeout(300);
  const dbs = await p.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  check(dbs.includes('circuitgm-tracksdeck') && !dbs.includes('circuitgm-patchworker'), `the old IndexedDB session is gone (${dbs.join(', ')})`);

  // A second visit opens the same session from the new name.
  await p.reload();
  await p.waitForFunction(() => window.tracksdeck?.S.pack, null, { timeout: 15000 });
  check(await p.evaluate(() => window.tracksdeck.S.pack.fileName) === 'Migrated pack.circuittrackspack', 'the next visit opens it from the new name');

  check(!errors.length, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
