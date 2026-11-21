# MoveGM tool versions

Each MoveGM page shows its version next to its title. Bump it, and the `?v=` cache tags on the page's CSS/JS, with each change. Paths below are relative to `movegm/`.

| Tool / pack | Version | Shown as |
|---|---|---|
| MIDI2Move | 0.6 | alpha 0.6 (`midi2move/index.html`, `midi2move/help.html`, overview card) |
| MoveGM pack | 0.2 | v0.2 (`pack/index.html`, `pack/README.txt`, release `movegm-v0.2`) |

## MIDI2Move
- **alpha 0.6** (21 Nov 2026): uses MoveGM from the site by default (`pack/MoveGM/`, each preset fetched when first needed); "Use another pack folder…" picks a folder with MoveGM's layout instead, and "Use MoveGM from this site" switches back. Opened from disk, it asks for a folder as before. Help: new "Using another sound pack" section. Conversion unchanged.
- **alpha 0.5** (21 Nov 2026): first version on the RosettaGM site. The single local page is split into `midi2move/index.html`, `css/m2m.css`, `js/m2m-core.js` (unchanged from alpha 0.4), `js/m2m-app.js` and `js/m2m-manifest.js`; RosettaGM menu; new help page (Quickstart and User guide); the sound-pack box links to the MoveGM download. Conversion unchanged.
- **alpha 0.4** (21 Nov 2026): page rebuilt on the MIDI2Circuit layout (Simple/Advanced, numbered steps, grid with mutes).
- Earlier, as a local page in the Ableton Move Lab: v0.1 MIDI importer and core · v0.1.1 note-overlap fix · v0.2 polyphonic pads and pad tracks · v0.3 "Play it as a song in Live" · v0.3.1 pitch bends, Mute, click-to-play · v0.3.2 version label. Details in `docs/MIDI2Move-design.md`.

## MoveGM pack
- **v0.2** (21 Nov 2026): 128 GM programs (Melodic Sampler), 12 drum kits, 23 Drift synths. Confirmed in Live 12 Lite; not yet on Move hardware.
- **v0.1**: first build (superseded).
