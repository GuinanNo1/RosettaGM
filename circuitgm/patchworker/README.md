# CircuitGM Patch Editor (PatchWorker), for testing, v0.14

**Try it:** https://guinanno1.github.io/RosettaGM/circuitgm/patchworker/

**Help:** https://guinanno1.github.io/RosettaGM/circuitgm/patchworker/help.html

A web page that edits the synth patches of a Novation Circuit Tracks, without the hardware. It opens with the [TracksGM](../tracksgm/) pack, plays patches in the browser (from the page, the computer keyboard or a MIDI keyboard, including a Circuit Tracks), and saves single `.syx` patches or a complete `.circuittrackspack` for Novation Components. Nothing is uploaded, and there is no server.

Since v0.9 PatchWorker is **Offline only** (see the claude.ai Project note `plan-patchworker-tracks-first.md`): the Circuit Tracks link below is hidden and only shows with `?tracksmode` at the end of the address, for development of a later Tracks mode.

## What it does

- **Pages as in Novation Components:** Main (oscillators, mixer, filter, envelopes, LFOs), Effects (chorus / phaser, EQ, distortion, voice) and Modulation (macro destinations, 20-row mod matrix), with the eight macros above every page.
- **Every parameter of the 340-byte patch** is editable, and bytes the page does not show are kept as they are.
- **Hardware units:** cutoff in Hz, envelope times, LFO rate, EQ and levels are shown using CircuitGM's measurements of a real Circuit Tracks.
- **Browser synth** for working without the hardware (an approximation, see below).
- **MIDI keyboard (Offline):** any Web MIDI keyboard plays the browser synth, with velocity and sustain pedal. Channel 3 chooses Synth 1 and channel 4 Synth 2 (the Circuit Tracks' MIDI 1 / MIDI 2 tracks, which don't sound its own synths); other channels play the synth chosen on the page. Nothing is sent out, and no SysEx access is asked for.
- **Saved / unsaved:** a status tag (Saved, Edited · not saved) with Save .syx and Download pack, and an Unsaved edits tray listing every changed patch not downloaded since (Open, .syx, Discard, Save all as .syx bank). Leaving an unsaved patch asks once whether to save it (not again until it changes; can be turned off), and replacing the pack with unsaved edits asks first.
- **Circuit Tracks link (`?tracksmode` only):** sends the patch to Synth 1 or 2, sends each edit live (CC / NRPN for single parameters, the whole patch for mod matrix and macro assignments), plays notes on the hardware, follows the hardware's macro knobs, fetches a synth's current patch, and can write a patch to a slot on the Circuit Tracks.
- **Files:** open and download `.circuittrackspack` packs, single patches and banks as `.syx`. Samples and projects pass through untouched; a project's own copy of an edited patch can be updated when it still matched the pack.
- **Undo / redo per patch**, hold-to-compare with the original, revert, copy to another slot, and a session (including what is unsaved) that survives closing the tab.
- **TRACKS / EDITOR switch:** TRACKS shows a panel laid out like the Circuit Tracks' top panel (v0.12: knobs, function row, track buttons, view columns either side of the 32 pads, Play at the bottom right, Shift and second legends), with behaviour modelled on [Web Tracks](https://webtracks.namirsab.dev/). Preset view picks patches and drum samples; Note view plays the patch from the pads.
- **Offline player (v0.10):** A **Project** picker and ▶ in the bottom bar (v0.11), or Projects view in the TRACKS panel, load a project from the pack, and ▶ / Space plays it through the browser synth, the pack's drum samples and the measured project mixer, with Synth 1 / 2 on the pack's patches as you edit them. Patterns view (pattern chains), Mixer view (mutes, levels, scenes and scene chains), Tempo view (tempo, swing, Tap) and the play head in Note view. 
- **Step editing and Save (v0.13):** Note view adds and removes notes (synth and MIDI: choose a step, then the keys; drums: tap steps), Velocity, Gate, Probability and Pattern Settings views, Clear, Duplicate and 1-16/17-32 as in the User Guide. Save (twice, or Save then a pad in Projects view) writes the project into the pack open in the browser with `serializeNCS` over the original file; saved projects are kept in the session and go into Download pack.
- **Scales (v0.14):** Scales view sets the project's root and scale (`js/scales.js`); the Note view keyboard follows it, Expanded Note view adds two rows. Download pack asks for the pack name.

## How it is built

| Path | What it is |
|---|---|
| `patchworker/index.html`, `patchworker/help.html` | The page and its help. |
| `css/patchworker.css` | Styles (PatchWorker has its own dark panel look). |
| `js/patchworker.js` | The page: controls, pack list, files, keyboard, Circuit Tracks link. |
| `js/pw/params.js` | The patch as a parameter table: addresses, ranges, defaults, CC / NRPN numbers, display units, SysEx. |
| `js/pw/engine.js` | The browser synth (Web Audio). |
| `js/pw/keys.js` | MIDI keyboard input for Offline mode (notes, sustain; channels 3 / 4 choose Synth 1 / 2). |
| `js/pw/midi.js` | Web MIDI link to the Circuit Tracks (Tracks mode, `?tracksmode`). |
| `js/pw/packio.js` | Reading and writing packs and `.syx` files, and the saved session. |
| `js/pw/panel.js` | The TRACKS face: the Circuit Tracks style panel. |
| `js/pw/project.js` | The Offline player: a pack project's live state (scene, scene chain, pattern chains, mutes, levels, tempo, swing) on top of Circuit2MIDI's song model (`js/song.js`), played by `js/player.js`. |
| `js/pw/mixlaws.js` | The Circuit Tracks project controls as numbers, from calibration set 7: mixer levels and pans, reverb, delay, master filter, drum pitch / decay / distortion / EQ, sidechain. |
| `js/pw/mixer.js` | The project mixer in Web Audio, built from `mixlaws.js`; `js/player.js` plays through it. |
| `tests/ui_offline.cjs` | Browser test of Offline mode: no link controls, status tag, Unsaved edits tray, the load-pack warning and bank, and a stand-in MIDI keyboard on channels 1, 3 and 4. |
| `tests/ui_patchworker.cjs` | Browser test: renders all 128 TracksGM patches, edits, saves, reloads, and (with `?tracksmode`) drives a stand-in Circuit Tracks. `tests/ui_follow.cjs` also runs in `?tracksmode`. |
| `tests/ui_panel.cjs` | Browser test of the TRACKS face. |
| `tests/mixlaws.mjs`, `tests/ui_mixer.cjs` | The set 7 laws against the measurements, in Node and as offline renders in a browser. |

The patch layout and MIDI numbers are from the Circuit Tracks Programmer's Reference Guide v3; see [`docs/circuit-tracks-file-formats.md`](../docs/circuit-tracks-file-formats.md).

## The browser synth

`js/pw/engine.js` is adapted from the Web Audio synth in [circuit-tracks-tools](https://github.com/namirsab/circuit-tracks-tools) by Namir Sayed-Ahmad Baraza (MIT licence, `js/vendor/LICENSE-circuit-tracks-tools.txt`): its voice structure, buffer LFOs, envelope handling and voice stealing. PatchWorker's version reads the patch bytes directly and uses curves measured on the hardware:

- filter cutoff (about one octave per 11.5 steps, 64 = 650 Hz), with key tracking;
- envelope times (+32 steps = 10×);
- LFO rate (3.39 Hz at 64, one octave per 12 steps);
- mod depth to pitch (cubic: +32 = +16 semitones) and to filter frequency;
- EQ gains and corner frequencies, Pre / Post FX level (1 dB per step, +12 dB maximum).

It adds wavetable shapes, ring modulation, density, virtual sync, filter drive and bypass routing, mod matrix source 1 × source 2, LFO delay with the four fade modes, and a phaser.

Pitch: the Circuit Tracks plays MIDI note 60 at 261.6 Hz (measured, calibration set 2) and ignores the patch's Keyboard Octave for notes arriving over MIDI (that setting is the pads' and patch preview's starting octave). The browser synth does the same.

Not emulated: Q normalise, pitch-bend range, LFO slew and common sync, and mod matrix destinations V-Sync, Pulse Width, Drive, LFO Rate and envelope Decay. The vocal and random wavetables are stand-ins. Macro depth scaling is an estimate (not yet measured).

## Testing

```sh
python3 -m http.server 8765 &      # from the RosettaGM root
node tests/ui_offline.cjs tests/out
node tests/ui_player.cjs "path/to/Blue Monday.circuittrackspack" tests/out   # any Tracks pack with projects
node tests/ui_patchworker.cjs tests/out
node tests/ui_panel.cjs && node tests/ui_preset.cjs && node tests/ui_follow.cjs
```

Still to check with a Circuit Tracks (Offline): notes from its MIDI 1 / MIDI 2 tracks arrive on channels 3 / 4 and choose Synth 1 / 2.

Not yet checked on hardware: the live CC / NRPN stream, Get, and Save to Tracks (Store). They follow the Programmer's Reference Guide.
