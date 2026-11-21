import asyncio, sys, os
from playwright.async_api import async_playwright
MID = sys.argv[1]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--autoplay-policy=no-user-gesture-required'])
        pg = await b.new_page(accept_downloads=True, viewport={'width': 1280, 'height': 1000})
        logs = []; pg.on('console', lambda m: logs.append(m.type + ': ' + m.text)); pg.on('pageerror', lambda e: logs.append('PAGEERROR ' + str(e)))
        await pg.goto('file:///home/claude/m2m/MIDI2Move.html')
        await pg.set_input_files('#gmdir', '/home/claude/out/MoveGM')
        await pg.wait_for_function("document.getElementById('gmstatus').textContent.includes('found')", timeout=30000)
        print('gm:', await pg.text_content('#gmstatus'))
        await pg.set_input_files('#midifile', MID)
        await pg.wait_for_selector('#parts tr')
        print('file:', await pg.text_content('#fileinfo'))
        rows = await pg.eval_on_selector_all('#parts tr', "rs => rs.map(r => [...r.querySelectorAll('td')].map(td => (td.querySelector('select') ? td.querySelector('select').selectedOptions[0].text : td.innerText).trim()).join(' | '))")
        for r in rows: print('  ', r)
        # change: send first skipped melodic part to a pad if any
        # Halo Pad + Warm Pad -> pads on Track 4 with 3 voices; free Track 4 by moving its part to pads too
        await pg.select_option('select[data-d="6"]', 'pad:track4'); await pg.select_option('select[data-d="7"]', 'pad:track4')
        await pg.fill('input[data-v="6"]', '3'); await pg.dispatch_event('input[data-v="6"]', 'change')
        print('voices inputs:', await pg.eval_on_selector_all('input[data-v]', "xs => xs.map(x => x.dataset.v + '=' + x.value)"))
        print('arr:', (await pg.text_content('#arrinfo'))[:300])
        print('warn:', await pg.text_content('#warn'))
        await pg.click('#play'); await pg.wait_for_timeout(2500); await pg.click('#stop')
        print('pos after preview:', await pg.text_content('#pos'))
        await pg.screenshot(path='/home/claude/m2m/ui.png', full_page=True)
        n = await pg.evaluate("arr.sets ? arr.sets.length : 1") if False else None
        os.makedirs('/home/claude/m2m/dl', exist_ok=True)
        async with pg.expect_download(timeout=60000) as dl:
            await pg.click('#export')
        d = await dl.value; path = '/home/claude/m2m/dl/' + d.suggested_filename; await d.save_as(path); print('downloaded', d.suggested_filename)
        await pg.wait_for_timeout(1500)
        print('status:', await pg.text_content('#expstatus'))
        for l in logs[:15]: print('LOG', l)
        await b.close()
asyncio.run(main())
