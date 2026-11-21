# RosettaGM: notes for Claude sessions

RosettaGM is the umbrella for Ian's General MIDI translation tools for
grooveboxes. Device families keep their own names: **CircuitGM** (Novation
Circuit Tracks and Rhythm) and **MoveGM** (Ableton Move: the MoveGM pack and
MIDI2Move). The repo started from CircuitGM's history on 21 Nov 2026; the old
GuinanNo1/CircuitGM repo only redirects here.

Layout: one folder per device family, so new grooveboxes slot in without
touching the others. `circuitgm/` holds the Circuit pages (`tracksgm/`,
`midi2circuit/`, …), plus its own `js/`, `css/`, `data/`, `docs/` and
`tests/`; `movegm/` will hold the Move pack page, `midi2move/` and theirs.
Tool pages are two levels deep: `../../css/app.css` (shared, at the root),
`../js/…` and `../css/…` (the family's own). Only code used by more than one
family goes at the root (`css/app.css`; a `js/shared/` when Move starts sharing
the MIDI reader). `index.html` is the RosettaGM home; each family's
`index.html` is its overview. A new family gets `<device>gm/` and an entry in
the menu's Devices group on every page.

The Move tools' research and handoff notes are in the claude.ai Project
"Ableton Move" and in `~/Documents/Claude/Ableton Move Lab/` on Ian's Mac.

## Circuit: check the official guides before reverse-engineering


Ian keeps Novation's official documents on his Mac, in
`~/Documents/Claude/CircuitGM-testdata/guides/` (a connected folder when the
chat is linked to his computer; ask for access to `CircuitGM-testdata` if it
isn't). **Search these first** when you need a parameter's name, range,
meaning, default or MIDI number. Earlier sessions spent time on hardware tests
for facts that were already in the Programmer's Reference.

| File | What it has |
|---|---|
| `circuit_tracks_programmer_s_reference_guide_v3.pdf` | **Circuit Tracks Programmer's Reference v3**: the patch SysEx layout and every synth parameter (name, range, default), CC and NRPN numbers for synths, drums, mixer and FX (reverb and delay parameters, sends), MIDI channels. The Rhythm has no reference guide of its own; its shared parameters (FX values, for example) match this one. |
| `circuit_tracks_user_guide_v3_en (2).pdf` | Circuit Tracks User Guide v3: views, FX presets, scenes, mixer, setup and advanced setup. |
| `Circuit Rhythm User Guide v1.0 English - EN.pdf` | Circuit Rhythm User Guide v1.0. |
| `circuit_rhythm_2.0_firmware_update_addendum_v1_english_en.pdf` | Circuit Rhythm 2.0 firmware addendum (Grid FX and other 2.0 features). |
| `Circuit 1.8 User Guide.pdf`, `circuit-ug-en-03-v1-6.pdf` | The original Circuit (not Tracks): background only. |

Other test data sits next to `guides/`: `tracks/` and `rhythm/` (packs
saved from the hardware) and `midi/` (test songs). Calibration results and
hardware recordings stay local; the repo only describes the method.

## Where things are documented in the repo

- `circuitgm/docs/circuit-tracks-file-formats.md`,
  `circuitgm/docs/circuit-rhythm-format.md`: file formats, byte offsets, what
  has been confirmed on the hardware.
- `<family>/docs/versions.md`: the version shown on each tool page of that family.
- `README.md`: RosettaGM layout; `circuitgm/README.md`: Circuit files and test
  commands (run from `circuitgm/`, with the repo root served on port 8765).

## Conventions

- Every tool page shows its version next to its status badge. Bump it, and
  the `?v=` cache tags on the page's CSS/JS, with each change.
- Ian is red/green colour blind: refer to Components' pack/project colours by
  palette number 1–14, left to right (top row 1–7, bottom row 8–14), not
  by colour name.
- The site menu is the same on every page (five dropdown groups: Devices,
  General MIDI Packs, MIDI Converters, Patch Editors, Pack Trimming); add a
  new tool to it on all pages, including PatchWorker's `topnav` and the
  RosettaGM home page.
- Not affiliated with Novation, Focusrite or Ableton. GeneralUser GS (S.
  Christian Collins) is credited wherever its samples are used; commercial
  Move packs on Ian's Mac are research only, never copied.
