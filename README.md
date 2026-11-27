# RosettaGM
General MIDI as a common language for grooveboxes. Like the Rosetta Stone, every tool here translates through one shared language, General MIDI, so songs and sounds can move between devices that can't read each other's files. Each device gets a General MIDI sound pack and converters to and from MIDI.

**Website: https://guinanno1.github.io/RosettaGM/**

| Device family | Packs and tools | Status |
|---|---|---|
| **CircuitGM**: Novation Circuit Tracks and Circuit Rhythm | TracksGM, RhythmGM, MIDI2Circuit, MIDI2Rhythm, Circuit2MIDI, TracksDECK, CircuitTrim: see [`circuitgm/README.md`](circuitgm/README.md) | Ready / alpha |
| **MoveGM**: Ableton Move | MoveGM sound pack, MIDI2Move converter: see [`movegm/README.md`](movegm/README.md) | For testing |

RosettaGM grew out of the CircuitGM repository (21 Nov 2026) and keeps its full history. The old CircuitGM addresses redirect to their new places under `circuitgm/`.

## Hosting on GitHub Pages

The site is static (HTML, CSS and JavaScript modules), with no build step. In **Settings → Pages**, set **Source** to *Deploy from a branch*, choose `main` and the `/ (root)` folder, then **Save**. After a minute or two it is live at `https://guinanno1.github.io/RosettaGM/`.

## Running it on your own computer

Browsers block JavaScript modules and file loading when a page is opened straight from disk, so serve the folder instead:

```sh
cd RosettaGM
python3 -m http.server 8765
```

Then open <http://localhost:8765/>.

## Layout

Each device family has its own folder with its pages, code, data, docs and tests. Only what every family uses sits at the top.

| Path | What it is |
|---|---|
| `index.html` | The RosettaGM home page (all device families). |
| `css/app.css`, `favicon.svg` | Styles shared by every page, including the site menu, and the icon. |
| `circuitgm/` | CircuitGM: Novation Circuit Tracks and Circuit Rhythm packs and tools ([README](circuitgm/README.md)). |
| `movegm/` | MoveGM: Ableton Move sound pack and MIDI2Move ([README](movegm/README.md)). |

A new groovebox gets its own `<device>gm/` folder with an `index.html` overview, and an entry in the menu's Devices group on every page.

## Credits and licences

- **Samples:** [GeneralUser GS](https://github.com/mrbumpy409/GeneralUser-GS) by S. Christian Collins; each family's README says where they are used and where the licence is kept.
- **Circuit project-format code and research:** [circuit-tracks-tools](https://github.com/namirsab/circuit-tracks-tools) by Namir Sayed-Ahmad Baraza (MIT) and [ncstool](https://github.com/Ondrysak/ncstool).
- **Other code:** this repository's licence (MPL-2.0, see `LICENSE`).
- Not affiliated with Novation, Focusrite or Ableton. "Circuit Tracks", "Circuit Rhythm" and "Components" are trademarks of Focusrite; "Move" and "Live" of Ableton.
