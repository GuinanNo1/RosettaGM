# Tool versions

RosettaGM started on 21 Nov 2026 from the CircuitGM repository, with its full history. The Circuit tools keep their own numbering. Paths below are relative to `circuitgm/`.

Each tool page shows its version next to its status badge, so you can tell which version a browser has loaded. GitHub Pages can take about 10 minutes to serve a new version; refresh with Shift-reload if a page shows an older one.

**Rule for every change to a tool:** bump its version here and everywhere the page shows it (badge in `<tool>/index.html` and `help.html`, the "for testing" note under the heading, the landing page card, the README table and the tool's own README title), add a line below, and bump the page's cache tag (`?v=…`) on the files you changed. MIDI2Rhythm takes its badge from `VERSION` in `js/m2r/app.js` and lists its versions in `midi2rhythm/help.html`.

| Tool | Current | Shown as |
|---|---|---|
| MIDI2Circuit | 0.16 | alpha 0.16 |
| MIDI2Rhythm | 0.21 | For testing · v0.21 |
| Circuit2MIDI | 0.7 | alpha 0.7 |
| CircuitTrim | 0.5 | alpha 0.5 |
| PatchWorker | 0.9 | For testing · v0.9 (top bar) |

Numbering started on 14 Nov 2026. Earlier changes are grouped roughly:

## MIDI2Circuit
- **0.16** (21 Nov 2026): menu lists the Ableton Move tools (Devices › Ableton Move, MoveGM, MIDI2Move). Tool unchanged.
- **0.15** (21 Nov 2026): CircuitGM moved into RosettaGM (now guinanno1.github.io/RosettaGM/circuitgm/); menu brand RosettaGM, new Devices group, "Circuit MIDI Converters" renamed "MIDI Converters". Tool unchanged.
- **0.14** (17 Nov 2026): PackTrim renamed CircuitTrim (button and links).
- **0.13** (16 Nov 2026): A Circuit Tracks pack project as the song keeps its mix: reverb and delay (stored values), FX off, and each track's level, pan, sends and sidechain, moved with its part to the track it plays on (first part of each synth/MIDI track; the busiest part of each drum track). Step 5's sends and sidechain start from it.
- **0.12** (16 Nov 2026): MIDI 1 / MIDI 2 template choice in step 5 (Advanced). Delay 1 uses the Tracks' own values (a fresh project's), which differ from the Rhythm's. Effects passed on the hardware.
- **0.11** (16 Nov 2026): Effects are their own step (5, Add effects; Build is now 6). Simple mode says no effects are added; Advanced shows the presets, send sliders (one row per track; stacked on phones) and sidechain.
- **0.10** (16 Nov 2026): Effects in step 5 (Advanced): reverb and delay presets, reverb/delay sends for Synth 1, Synth 2 and Drum 1–4, and a sidechain preset and trigger drum for each synth, the same for every project. Values from Ian's save of every preset on the Tracks (`tests/m2c_fx.mjs`).
- **0.9** (15 Nov 2026): Pack colour setting removed (Components ignores a pack file's colour on import; set it in Components).
- **0.8** (15 Nov 2026): pack colour names from Components' own list (red … pink, blue = default); 0.7's green = "teal" undone. Components seems to ignore the file's colour on import.
- **0.7** (15 Nov 2026): Pack colour written as Components stores it (Blue = no entry, Green = "teal"); the others still unmapped.
- **0.6** (15 Nov 2026): Circuit Tracks projects loaded as the song read their synth and MIDI notes relative to the project's scale root (they were off by the root, e.g. a whole tone flat with root D).
- **0.5** (14 Nov 2026): version shown on the page. Includes everything up to the PackTrim link and "Rebuild in MIDI2Circuit".
- 0.4: simple / Advanced modes, Trim the pack.
- 0.3: Circuit packs as the song; shared preview with PatchWorker's synth and mixer.
- 0.2: per-track step rates ("Per track: keep notes", the default).
- 0.1 (6 Nov 2026): first public alpha.

## MIDI2Rhythm
See `midi2rhythm/help.html` (Versions). 0.1–0.6 on 14 Nov 2026; 0.7 (15 Nov): Circuit packs as the song; 0.8: pack projects keep their layout; 0.9: drum Pitch to Tune, project colours; 0.10: scale-root fix for Tracks notes, scene mute recall copied; 0.11: pack colour names (wrong guess); 0.12: Components' real colour names; 0.13: Pack colour setting removed; 0.14: effects (presets and sends); 0.15: preset names; 0.16: preset tables shared with MIDI2Circuit (`js/fx.js`), packs unchanged; 0.17: Effects as step 5 with send sliders; 0.18: sidechain for all 8 tracks; 0.19: a kept layout keeps the source project's mix (FX, levels, pans, sends, sidechain); 0.20 (21 Nov): moved into RosettaGM, menu changes only; 0.21: Move tools in the menu.

## Circuit2MIDI
- **0.7** (21 Nov 2026): menu lists the Ableton Move tools (Devices › Ableton Move, MoveGM, MIDI2Move). Tool unchanged.
- **0.6** (21 Nov 2026): CircuitGM moved into RosettaGM (now guinanno1.github.io/RosettaGM/circuitgm/); menu brand RosettaGM, new Devices group, "Circuit MIDI Converters" renamed "MIDI Converters". Tool unchanged.
- **0.5** (17 Nov 2026): PackTrim renamed CircuitTrim (button and links).
- **0.4** (15 Nov 2026): Circuit Tracks synth and MIDI notes are read relative to the project's scale root (exports were off by the root, e.g. a whole tone flat with root D).
- **0.3** (14 Nov 2026): version shown; trimming moved to PackTrim; "Rebuild in MIDI2Circuit".
- 0.2: simple / Advanced modes, "Convert to Circuit Tracks" hand-off.
- 0.1 (8 Nov 2026): first alpha.

## CircuitTrim (was PackTrim)
- **0.5** (21 Nov 2026): menu lists the Ableton Move tools (Devices › Ableton Move, MoveGM, MIDI2Move). Tool unchanged.
- **0.4** (21 Nov 2026): CircuitGM moved into RosettaGM (now guinanno1.github.io/RosettaGM/circuitgm/); menu brand RosettaGM, new Devices group, "Circuit MIDI Converters" renamed "MIDI Converters". Tool unchanged.
- **0.3** (17 Nov 2026): renamed from PackTrim to CircuitTrim, at `circuittrim/` (the old `packtrim/` address redirects). Still under the menu's Pack Trimming group, which leaves room for trimmers for other devices.
- **0.2** (14 Nov 2026): version shown; "Keep: only project N" (Advanced); takes packs handed over from the other tools.
- 0.1 (10 Nov 2026): first alpha.

## PatchWorker
- **0.9** (22 Nov 2026): Offline only (plan `plan-patchworker-tracks-first.md`). The Circuit Tracks link (Live, Get, Play on Tracks, Save to Tracks, Patches from the Circuit Tracks, Hear on) is hidden; `?tracksmode` still shows it, for development. New: Saved / Edited · not saved status with Save .syx and Download pack; Unsaved edits tray (Open, .syx, Discard, Save all as .syx bank, Discard all); one warning, before Open pack… or Load TracksGM replaces unsaved edits (offers a .syx bank first); no more confirmations for Initial Patch, Revert or Duplicate to pad (Undo instead); MIDI keyboard input (any keyboard; channel 3 = Synth 1, channel 4 = Synth 2, as the Circuit Tracks' MIDI 1 / MIDI 2 tracks; sustain pedal) with a reminder to use MIDI 1 / 2 when a Circuit Tracks is the keyboard; Synth 1 / Synth 2 switch always shown.
- **0.8** (21 Nov 2026): menu lists the Ableton Move tools (Devices › Ableton Move, MoveGM, MIDI2Move). Tool unchanged.
- **0.7** (21 Nov 2026): CircuitGM moved into RosettaGM (now guinanno1.github.io/RosettaGM/circuitgm/); menu brand RosettaGM, new Devices group, "Circuit MIDI Converters" renamed "MIDI Converters". Tool unchanged.
- **0.6** (14 Nov 2026): version shown in the top bar. Includes the Tracks panel, preset view, mixer panel, follow-the-Tracks, patches from the Tracks, Save to Tracks and the clearer button names.
- 0.1 (12 Nov 2026): first test version (synth patch editor).
