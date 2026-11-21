import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome')
        pg = await b.new_page(accept_downloads=True)
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file:///home/claude/m2m/MIDI2Move.html')
        await pg.set_input_files('#midifile', '/mnt/user-data/uploads/Claude/CircuitGM-testdata/midi/knight-rider-theme.mid')
        await pg.wait_for_selector('#parts tr')
        async with pg.expect_download() as dl:
            await pg.set_input_files('#alsfile', '/mnt/user-data/uploads/Claude/Ableton Move Lab/Ableton Move Packs/Chime Copy-1 Project/Kids.als')
        d = await dl.value; await d.save_as('/tmp/' + d.suggested_filename); print('downloaded', d.suggested_filename)
        print(await pg.text_content('#alsinfo')); print('errors', errs)
        await b.close()
asyncio.run(main())
