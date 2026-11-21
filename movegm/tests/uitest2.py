import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--autoplay-policy=no-user-gesture-required'])
        pg = await b.new_page(accept_downloads=True, viewport={'width': 1280, 'height': 1100})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file:///home/claude/m2m/MIDI2Move.html')
        await pg.set_input_files('#gmdir', '/home/claude/out/MoveGM')
        await pg.wait_for_function("document.getElementById('gmstatus').textContent.includes('found')")
        await pg.set_input_files('#midifile', '/mnt/user-data/uploads/Claude/CircuitGM-testdata/midi/Frankie_Goes_to_Hollywood_-_Relax.mid')
        await pg.wait_for_selector('#parts tr')
        print('bend notes shown:', await pg.eval_on_selector_all('#parts .small', "xs => xs.map(x=>x.textContent).filter(t=>t.includes('bend'))"))
        await pg.check('input[data-mute="0"]')                 # mute drums
        box = await pg.query_selector('#roll'); bb = await box.bounding_box()
        await pg.mouse.click(bb['x'] + bb['width'] * 0.5, bb['y'] + 8)      # section letter row -> play section
        await pg.wait_for_timeout(1500)
        print('playing from section, position', await pg.text_content('#pos'), 'playhead', await pg.evaluate('typeof playhead'))
        await pg.click('#stop')
        await pg.screenshot(path='/home/claude/m2m/ui2.png')
        async with pg.expect_download(timeout=60000) as dl: await pg.click('#export')
        d = await dl.value; await d.save_as('/tmp/' + d.suggested_filename); print('export ok', d.suggested_filename)
        print('errors', errs); await b.close()
asyncio.run(main())
