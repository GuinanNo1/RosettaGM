import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--autoplay-policy=no-user-gesture-required'])
        pg = await b.new_page(accept_downloads=True, viewport={'width': 1200, 'height': 1000})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: m.type == 'error' and errs.append(m.text))
        await pg.goto('file:///home/claude/m2m/MIDI2Move.html')
        await pg.set_input_files('#gmdir', '/home/claude/out/MoveGM')
        await pg.wait_for_function("document.getElementById('base-status').textContent.startsWith('Loaded')")
        await pg.set_input_files('#file', '/mnt/user-data/uploads/Claude/CircuitGM-testdata/midi/Frankie_Goes_to_Hollywood_-_Relax.mid')
        await pg.wait_for_selector('#tracks tbody tr')
        await pg.screenshot(path='/home/claude/m2m/v04_simple.png', full_page=True)
        print('simple: adv visible?', await pg.is_visible('#arrange-options'))
        print('summary', await pg.eval_on_selector_all('#summary .stat', "xs=>xs.map(x=>x.innerText.replace(/\\n/,' '))"))
        await pg.check('#advanced'); await pg.wait_for_timeout(200)
        print('adv: options visible?', await pg.is_visible('#arrange-options'))
        # assign skipped Distortion? Choose a skipped part -> T4? Instead send "Brass Section" (skip) to Pads
        rows = await pg.query_selector_all('#tracks tbody tr')
        names = [await r.eval_on_selector('.pname', 'e=>e.textContent') for r in rows]
        print('parts', names)
        await (await rows[5].query_selector('button.role[data-role="PD"]')).click()
        await pg.wait_for_timeout(200)
        print('pad opts visible', await (await rows[5].query_selector('.padopts')).is_visible())
        # mute whole drums row then a single section cell on track row 2
        dots = await pg.query_selector_all('#grid .dot'); await dots[1].click()
        cells = await pg.query_selector_all('#grid .col:nth-of-type(3) .cell'); 
        if cells: await cells[0].click()
        print('muted cells', len(await pg.query_selector_all('#grid .cell.muted')))
        await pg.click('#grid .hd.click >> nth=1'); await pg.wait_for_timeout(1200)
        print('playing col highlighted', len(await pg.query_selector_all('#grid .col.now')), await pg.text_content('#time'))
        await pg.click('#play'); 
        await pg.screenshot(path='/home/claude/m2m/v04_adv.png', full_page=True)
        print('warnings', await pg.eval_on_selector_all('#warnings li', "xs=>xs.map(x=>x.textContent)"))
        async with pg.expect_download(timeout=60000) as dl: await pg.click('#build')
        d = await dl.value; await d.save_as('/tmp/v04_' + d.suggested_filename); print('built', d.suggested_filename, await pg.text_content('#build-status'))
        print('errors', errs); await b.close()
asyncio.run(main())
