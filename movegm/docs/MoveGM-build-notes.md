# MoveGM: build notes (v0.2, 21 Nov 2026)

General MIDI preset pack for Ableton Move, built from **GeneralUser GS 2.0.3** (cloned from github.com/mrbumpy409/GeneralUser-GS). It's the basis for the MIDI2Move converter. Licence: GeneralUser GS License v2.0. Free to use and modify, including in software, with credit. Don't sell it.

## Output
- `MoveGM/01 Piano … 16 Sound Effects/NNN Name.ablpresetbundle`: 128 Melodic Sampler presets
- `MoveGM/17 Drum Kits/`: 9 core kits (GU Standard, Room, Power, Electronic, 808/909, Dance, Jazz, Brush, Orchestral). Pads 1–16 hold GM notes 36–51, which are also Move's pad notes, so GM drum parts need no remapping. There are also 3 percussion kits (GM notes 52–67, 68–83 and 20–35 shifted onto pads 1–16).
- `movegm-manifest.json`: for each program: preset path, sample, render key, transpose, Volume, stereo/looped, envelope; per kit: pad → GM note, choke; plus `fold_to_core`, a GM drum note → core-kit pad map for the converter.
- 130 MB in total; loading every preset at once would need 270 MB of Move RAM. A 4-track demo Set uses about 11 MB.

## Decisions
| Topic | Decision | Why |
|---|---|---|
| Looping | Unroll SF2 loops into 8 s samples (3 s for drums), fade the tail, embed a WAV `smpl` loop | Move's Melodic Sampler has no loop mode: no loop params in 112 real instances |
| Format | 44.1 kHz / 16-bit TPDF-dithered; stereo only when layers are panned (34 of 128) | Move runs at 44.1 kHz and holds samples as 32-bit in RAM |
| Pitch | Render at key K (36/48/60/72/84 by range); `Voice_Transpose = 60 − K`; `smpl` unity note 60 | No root-note param exists. Ableton's "Strings Ens C4.wav" uses Transpose −12, which fits a root of MIDI 60. Writing unity note 60 keeps both readings consistent |
| Velocity layer | Render at velocity 100; `Voice_VelocityToVolume` 0.6 | Single sample, so Move velocity only scales level |
| Filter | Bake GU's time-varying filter (initialFilterFc + modEnv + modulators) into the sample, and leave Move's filter at 22 kHz | GU drives tone from mod envelopes, e.g. the piano starts at an 800 Hz cutoff that a static Move filter can't reproduce |
| Amp envelope | GU volume envelope → Move Attack/Decay/Sustain/Release (Gate mode) | |
| Levels | Normalise each sample to −1 dBFS, keep GU balance through `Volume` (median −12 dB samplers, −10 dB drums) | |
| Choke | Exclusive classes merged by shared pads (hats use GU classes 1 and 2); max 2 groups per kit | Only choke groups 1/2 seen in real files |
| Racks | No `lockId`/`lockSeal` in presets. The demo Set uses role seals (kit outer −973461132, drumRack 830049224, sampler outer 1472017714) | Matches Live exports and Move-saved Sets |
| FX | None | Valid in commercial presets; leaves both slots free |

Renderer notes: SF2.01 generator inheritance plus modulator evaluation (defaults, overridden per instrument; GU sets the default velocity→filter to 0). Initial attenuation uses the EMU/FluidSynth 0.4 factor. Vibrato LFO and modEnv→pitch are ignored.

## Drift synths (v0.2)
- 23 presets in `MoveGM/18 Drift Synths`: GM 39–40, 51–52, 55, 63–64, 81–96, named "NNN Name (Drift)".
- Structure: outer instrumentRack › instrumentRack (8 mapped macros) › drift. This is Ableton's documented Drift preset format. No seals.
- The 83 parameter names come from Drift devices in our own Sets (identical across schemas 1.6–1.8). All values are ours: a NEUTRAL patch plus per-program settings, nothing copied from a preset.
- Units: times in seconds; gains linear (1.995 = +6 dB); filter in Hz; oscillator transpose in octaves (−2…2); Osc 2 detune in semitones; Global_Transpose in semitones.
- Macros: Filter Freq, Filter Reso, Filter Env, Osc 2 Level, Attack, Decay, Release, Glide.
- **Finding (corrected after the Live test):** Live **does** recompute mapped parameters from the macro position when it loads a preset. v0.2's first build placed macros on a linear scale, and the instruments came out extremely quiet: Live's frequency/time curves aren't linear, so the 380 Hz cutoff loaded at about 25 Hz. (Move-saved Sets store mismatched macro/parameter pairs, which misled the first reading.)
- **Rule:** put the preset's value at one END of each macro's range and park the macro at exactly 0 or 127. That's exact under any mapping curve. Filter Freq: range 20 Hz → the preset cutoff, macro 127 (turning down darkens; it can't open beyond the preset). Attack/Decay/Release/Reso/Env/Glide: range from the preset value upward, macro 0. Applies to every generated preset with mapped macros.
- The offline preview can't render Drift. Check these in Live (Lite includes Drift) using `MoveGM Drift Demo.ablbundle`.

## Test results
- 21 Nov 2026: `MoveGM Drift Demo.ablbundle` first build loaded, but the Drift instruments were extremely quiet (macro-curve issue above). Fixed build (endpoint macro rule, Global_Volume 0.7) **confirmed in Live 12 Lite: Drift levels now match the drums.**
- 21 Nov 2026: `MoveGM Demo.ablbundle` loads and plays correctly in **Ableton Live 12 Lite**. Confirmed: the Set structure, bundled samples, Melodic Sampler → Simpler conversion, and pitch/Transpose handling.
- Parameter-name check: the pack's Melodic Sampler (28) and Drum Sampler (43) parameter lists exactly match all 112 / 1,837 instances in our Sets.

## Untested assumptions (check on hardware / in Note)
1. A Melodic Sampler preset loads from `.ablpresetbundle` (Live can't export one, so it's never been seen).
2. Preset `$schema` 1.4.7 combined with param names taken from song schema 1.7/1.8 Sets.
3. Root = MIDI 60 (play C3 on a piano preset: it should sound at C3).
4. Drum Sampler `Voice_Envelope_Decay` = 10 s lets cymbals ring fully.
5. The demo Set opens (master track with no devices).

## Next
- Ranged split presets (e.g. Piano Lo/Hi) if single-sample stretching is too obvious.
- MIDI2Move: 16 channels → 4 tracks. Use the manifest; drums go to a core kit via `fold_to_core`.

## Files
Build scripts (in `MoveGM/build-scripts/`): `sf2.py` parser, `drift.py` + `build_drift.py`, `demo_drift.py`, `render.py`, `gm.py` tables, `movepreset.py` writer, `build.py`, `validate.py`, `demo_set.py`, `preview.py` (offline Move sampler model), `make_page.py`.
Rebuild with `python3 build.py GeneralUser-GS.sf2 out/`. It needs numpy and scipy, plus ffmpeg for previews.
