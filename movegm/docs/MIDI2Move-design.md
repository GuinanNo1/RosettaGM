# MIDI2Move: design notes (draft, 21 Nov 2026)

A browser tool that turns **MIDI files, Ableton Live Sets, Circuit Tracks packs and Circuit Rhythm packs** into a Move Set (`.ablbundle`). It uses the source's own sounds where Move can play them, and MoveGM sounds otherwise. Modelled on MIDI2Rhythm: load, preview, choose which parts to convert, download.

## Architecture: importers → common song model → Move exporter
```
 .mid ──────────┐
 .als / Live    │   ┌──────────────────────────────┐    ┌────────────┐    ┌──────────────┐
 project folder ├──▶│ Song model                   │──▶ │ Preview +  │──▶ │ Move exporter│──▶ .ablbundle
 .circuittracks │   │ tempo, sig, sections/scenes, │    │ assign UI  │    │ (Song.abl +  │
   pack         │   │ parts: notes + sound source  │    └────────────┘    │  samples)    │
 .circuitrhythm─┘   └──────────────────────────────┘                      └──────────────┘
```
Each **part** in the song model carries its notes (in beats), polyphony stats, an optional drum map, and a **sound source**, one of:
- `gm`: a GM program or kit, rendered with MoveGM
- `move-device`: a device tree Move can play directly (Drift, Drum Rack of Drum Samplers, Simpler → Melodic Sampler, Wavetable, Move effects)
- `sample`: one or more audio files for Drum Sampler pads or a Melodic Sampler
- `substitute`: a sound Move can't play (Operator, Analog, plugins, Circuit synth engine). The tool suggests a MoveGM or Drift stand-in by name/category, and the user can override it.

The preview, assign and arrange steps below are shared by every format.

## Importers
**MIDI (.mid):** SMF 0/1. Channels → parts. Program changes → `gm`; channel 10 → GM kit.

**Ableton Live (.als, or a Live project folder via a folder picker so referenced samples come with it):**
- gzip-compressed XML (Live 12: `<Ableton MajorVersion="5" MinorVersion="12.0_…">`). `LiveSet/Tracks/MidiTrack|AudioTrack`; notes in `MidiClip/Notes/KeyTracks/KeyTrack/Notes/MidiNoteEvent` (`Time`, `Duration`, `Velocity`, in beats). Tempo at `MainTrack…/Tempo/Manual`.
- **Session clips** map straight onto Move clip slots and scenes. **Arrangement clips** are sectioned like a MIDI file.
- **Devices:** Live's XML uses the **same parameter names as Move's JSON**. Verified: Live's `<Drift>` holds `Filter_Frequency`, `Oscillator1_Type`, … exactly as the Move `drift` does. Element ↔ kind mapping: `Drift`→drift, `DrumGroupDevice`→drumRack, `DrumCell`→drumCell, `InstrumentVector`→wavetable, `InstrumentGroupDevice`→instrumentRack, `OriginalSimpler`→melodicSampler (single sample), `Reverb`, `Delay`, `Saturator`, `PhaserNew`, `Chorus2`, `ChannelEq`, `AutoFilter2`, `Compressor2`, `Limiter`, `Redux2`. Enum values need a lookup table. **Rosetta pair already in the Lab:** `Chime.ablbundle` (Move) and `Chime Copy Project/Chime Copy.als` (the same Set saved by Live 12.2).
- Instruments Move lacks (Operator, Analog, Sampler multisamples, plugins) → `substitute`. Drum Racks with Simpler pads → Drum Sampler pads with the same samples. More than 2 effects, or effects Move lacks → keep the Move-compatible ones (2 slots), report the rest.
- Audio tracks → Move audio tracks (Move 2.x: `sampleUri` + warp markers). Later phase.

**Circuit Tracks (.circuittrackspack) / Circuit Rhythm (.circuitrhythmpack):**
- Reuse the parsers from the earlier Circuit work (Circuit2Move / RhythmGM, done outside this Project). Test data is in `Claude/CircuitGM-testdata/tracks`.
- Natural fit: Circuit **patterns → Move clips**, pattern chains/scenes → Move scenes.
- Tracks: 4 drum tracks → one Move drum track (pads 1–4, + chromatic pads). Synth 1/2 → Move tracks with Drift stand-ins (or MoveGM). MIDI tracks 1/2 → MoveGM/Drift per user choice.
- Rhythm: 8 sample tracks → Move drum track pads with the pack's own samples. Rhythm's pitched sample playing maps directly onto **chromatic pads** (PitchBend per note).

## Move constraints that shape it
- **4 tracks**, each holding a melodic instrument (Melodic Sampler or Drift, polyphonic) or a 16-pad drum kit.
- **8 clip slots per track**, with scenes across them. Step-sequenced clips run up to 16 bars (64 beats in 4/4). A Set with 9 scenes has been seen, so more than 8 is possible but untested.
- **One tempo per Set**, and a `timeSignature` field (newer schemas).
- GM drum notes 36–51 = Move pad notes 36–51 = MoveGM core kit pads, so they need no remapping. Other GM drum notes are folded with the manifest's `fold_to_core` table, or dropped.

## Extra monophonic lines: chromatic pads (from our own Sets)
A drum pad can be played chromatically. The encoding was verified in BLT Move FINAL, I Would Die 4U, GLUE, 303 Temptation and others:
- The note keeps the **pad's own note number** (e.g. 51) and carries `"automations": {"PitchBend": [{"time": 0.0, "value": V}]}`.
- **V = semitones × 170.667** (8192/48, so ±48 semitones). Positive steps are 170.646 (8191/48). Your Sets use −13 to +16 semitones. Exactly one point at time 0, so each note has a fixed pitch and there are no glides.
- The pad's Drum Sampler has `NotePitchBend: true` (already MoveGM's default).
- **Envelope:** Drum Sampler `Voice_Envelope_Mode` is `"A-H-D"` (one-shot) or `"A-S-R"` (gate). Use **A-S-R** for melodic pads, so notes sustain while held and release after. MoveGM's 8 s unrolled samples sustain naturally.
- A pad is monophonic (it retriggers), so only single-line parts fit: bass lines, leads, counter-melodies. Overlapping notes are truncated to the next note start.
- Other per-note automations seen: `Pressure` (poly aftertouch), as stepped multi-point curves with times in beats from the note's start.

So a drum track can carry the drum part **plus** one or more mono lines on whatever pads the song's drums don't use. That gives more than 4 parts within the 4-track limit.

## Flow
1. **Load** a `.mid` file (SMF type 0/1), parsed in the browser.
2. **Analyse each channel:** GM program (and changes), note count, range, maximum polyphony, density, and drums (channel 10).
3. **Preview:** a piano roll per channel and WebAudio playback through the MoveGM samples, using the same sampler model as the offline preview, with mute/solo.
4. **Assign**, with suggested defaults the user can change:
   - Track 1 = drums (choice of MoveGM kit). Unused pads are offered as chromatic slots.
   - Tracks 2–4 = the most important polyphonic channels (by note count and range), each with its MoveGM preset (Sampler, or Drift where one exists).
   - Remaining **monophonic** channels (max polyphony 1, or forced mono by highest/lowest-note priority) → chromatic pads on the drum track, using that program's MoveGM sample.
   - Anything left over is listed as "not converted".
5. **Arrange:** split the song into ≤16-bar sections. Each section becomes a scene, and identical sections reuse the same clips (deduplication), so the song fits the clip slots. Lay the clips out across the scenes.
6. **Export** an `.ablbundle`: Song.abl plus only the samples used, taken from the MoveGM pack. The user points the tool at their local MoveGM folder (file input), so nothing has to be hosted.

## Mapping details
- Melodic track device = the MoveGM preset tree (outer instrumentRack). In a Set, add role seals as in the demo (sampler outer 1472017714; kit outer −973461132 / drumRack 830049224; Drift inner rack 278284). These are probably not needed.
- Chromatic pad: drumCell with `sampleUri` = the program's MoveGM sample, `Voice_Envelope_Mode` = "A-S-R", Volume from the manifest. For each note, PitchBend = (MIDI note − render_key) × 170.667, and `Voice_Transpose` keeps the bend within ±48.
- MIDI velocity → note velocity. Note times → beats (ticks / PPQ). Same-pitch overlaps are trimmed.
- v1 ignores channel pitch bend and CCs. Later: CC7/11 → clip volume automation, pitch bend → per-note PitchBend on melodic tracks (untested).

## Build order
1. Shared core: song model, preview/assign UI, Move exporter (incl. chromatic pads, scene dedupe) + **MIDI importer** (test files: `Claude/CircuitGM-testdata/midi`, 25 files).
2. **Live importer:** notes/clips first with `substitute` sounds, then native device conversion via the Chime Rosetta pair, then samples from project folders.
3. **Circuit Tracks/Rhythm importers**, using the existing Circuit parsers.
4. Audio tracks (Live audio clips → Move audio tracks).

## Status: v0.1 (21 Nov 2026), MIDI importer + shared core
`MIDI2Move/MIDI2Move.html` is a single local page (open it in Chrome/Safari/Firefox from the Lab folder). Source is in `MIDI2Move/src/` (`m2m-core.js` is format-independent and also runs in Node).
- **Flow:** choose the MoveGM folder → drop a .mid → piano-roll overview, parts table (instrument override, Send to, Sampler/Drift, solo) → preview with MoveGM samples → arrangement summary → export.
- **Auto-assign:** the drums part → drum track; polyphonic parts get tracks first, then by importance; the remaining near-monophonic parts → up to 4 chromatic pads. Duplicate parts (identical notes on another channel) are flagged and skipped.
- **Arrangement:** sections of 16/8/4 bars (auto picks the fewest Sets), loose repeat matching (1/24 beat, velocity/16). Songs needing more than 8 scenes are split into several Sets, "Name (1 of 2)" etc., each with its own play order. In the 10 test files, exact repeats were rare (fills/variations), so long songs typically need 2 Sets.
- **Chromatic pads:** free pads counted downward from 51; drumCell with the program's MoveGM sample, `A-S-R`, Hold 60 s, Decay = the program's release, VelocityToVolume 0.6, Effect off. PitchBend = (note − render_key − Transpose) × 8192/48 (8191/48 positive). Chords are reduced to the top note.
- **A-S-R semantics** (from our Sets): the same params as A-H-D: Attack, Hold, Decay. Decay acts as the release. Hold seen at 60 s on gated pads.
- **Float fidelity:** Move JSON distinguishes `12.0` from `12`. The core uses a float-preserving JSON parser/writer (`M2M.jparse/jstr`, floats boxed as `F`), so preset values survive round trips unchanged.
- **Tests:** 10 MIDI files converted in Node; all 15 resulting Sets pass `validate.py`. A Playwright test drives the real page in Chrome (folder load, MIDI load, reassignment, preview, export), and its download is byte-identical to the Node build.
- **Note invariant (v0.1.1 fix):** Live refuses to load a clip in which two notes of the same pitch overlap or start together ("document invariant violation"). MIDI files often contain these, and drum folding creates them (35 and 36 both land on pad 36). `cleanNotes()` now merges same-start duplicates (keeps the louder) and ends an overlapping note just before the next start. `validate.py` checks for it.
- **Confirmed in Live 12 Lite (21 Nov 2026):** `knight-rider-theme` and `bladerunner` (v0.1.1) load and play well; chromatic drum-pad notes play at the correct pitches. **Polyphonic pads confirmed too:** `ITAT pads` and `bladerunner pads` play pad chords at the correct pitch and roughly correct levels. Still to check: everything on Move hardware.

## v0.2: polyphonic pads and pad tracks (21 Nov 2026)
- **Voices:** a part sent to pads gets N pads (1–16) carrying the same sample. `allocateVoices()` gives each pad one note at a time. Chords keep the highest notes; when all pads are busy, the pad that frees soonest is cut short. 1 voice = the old single-line behaviour.
- **Pad tracks:** the Send to options are "Pads on drum track" (free pads, counted down from 51) and "Pads on Track 2/3/4" (that track becomes a 16-pad Drum Rack, counted up from 36, unused pads empty). Several parts can share a pad track. A track that also has a normal part ignores pad parts (the page warns).
- **Example:** Bladerunner, 12 parts in 4 tracks: drums + 3 single-line pads, Saw Lead, Synth Strings 2, and a pad track with Synth Brass ×3, Fretless ×2, String Ens 1 ×2, String Ens 2 ×3, Harp ×3, Tubular Bells ×3.
- **Trade-off:** pad sounds use the Drum Sampler's A-S-R envelope (attack, hold 60 s, release) and filter. There's no Sampler LFO/filter envelope; fine for most GM sounds.

## Decision: Move Set + Live Set downloads
The Move format has no scene follow actions: no field appears in any of the 153 Sets examined (scenes only have `name`, `color`), and the schema isn't public. Adding unknown fields could make the Move reject a Set. So the export page will offer **two downloads**:
- **Move Set (.ablbundle):** for the hardware. Scenes are launched by hand, in the play order the tool shows.
- **Live Set (.als):** the same tracks, clips and sounds, plus **scene follow actions** (Next / Jump, timed to the section length), so it plays straight through as a song in Live (including Lite). The page will explain the difference.
Built in phase 2 alongside the Live importer (same XML knowledge; Live-saved `.als` files with Move devices in the Lab serve as templates).

## v0.3: "Play it as a song in Live" (interim, 21 Nov 2026)
Until the full `.als` writer exists: the user opens the Move Set in Live and uses *Save Live Set As*, then drops the `.als` onto the page. `M2M.patchAlsFollowActions()` sets each scene's `<FollowAction>` and the page returns "… (plays as song).als".
- **Live XML** (Live 12.2, `Scene/FollowAction`): `FollowTime` (beats; 4 = 1 bar), `IsLinked`, `LoopIterations`, `FollowActionA/B` (0 none, 1 stop, 4 next, 9 jump…), `FollowChanceA/B`, `JumpIndexA/B` (1-based), `FollowActionEnabled`. No global follow-action flag is stored in the file.
- **Plan:** the page's own play order (when the same song is loaded and the scene counts match), otherwise scenes top to bottom, with the section length taken from the scene names ("A bar 1", "B bar 17"). Next/Jump, skipping empty scenes; the last scene Stops. Repeated sections can't be followed twice, so the page warns.
- **To confirm in Live:** that follow time is counted in beats and that the jump index is 1-based (both inferred from Live-saved files).

## v0.3.1: MIDI pitch bend + better preview (21 Nov 2026)
- **Found via Relax:** the guitar channels set an RPN 0 bend range of ±12 and bend most notes (57/78 Distortion Guitar notes). Ignoring bends made them sound "slightly flat". The samples themselves are in tune: a pack-wide tuning check shows every pitched sample within ±3 cents (except Flute +11 and Rock Organ +12, from GeneralUser's own tuning; worth correcting in MoveGM v0.3).
- **Parser:** pitch bend events plus RPN 0 (range, default ±2) per channel. Each note gets `bend` (points relative to the note start, in semitones) and `bendAvg` (time-weighted).
- **Pads:** exact bends as multi-point per-note `PitchBend` automation (times in beats from the note start; up to 64 points). Single-point and **multi-point PitchBend both confirmed in Live 12 Lite** (21 Nov 2026: Relax guitar bends now in tune).
- **Sampler/Drift tracks:** a note whose average bend is at least ½ semitone is moved to the nearest semitone. Per-note bend on Melodic Sampler is unconfirmed.
- **Preview:** a Mute column (alongside Solo; changes apply while playing); click the roll to play from that bar, or a section letter to play from that section; pad bends heard as playback-rate curves.

## Versioning
- The page header and tab title show the version and build time (UTC), e.g. "MIDI2Move v0.3.2 · built 21 Nov 2026 11:29 UTC", set by `VERSION` in `src/make_html.py`. Bump it for every build handed over.
- Delivery check: after copying to the Lab, compare the file's checksum on the user's machine with the build (a reused upload name once delivered a stale copy).
- From alpha 0.4 the label follows CircuitGM's style ("alpha 0.4" badge beside the title, build time in the alpha notice).
- History: v0.1 MIDI importer and core · v0.1.1 note-overlap fix · v0.2 polyphonic pads and pad tracks · v0.3 "Play it as a song in Live" · v0.3.1 pitch bends, Mute, click-to-play · v0.3.2 version label · alpha 0.4 page rebuilt on the MIDI2Circuit layout.

## alpha 0.4: page matches MIDI2Circuit (21 Nov 2026)
For users moving between the CircuitGM tools, the page now follows `CircuitGM/midi2circuit/index.html`: the same stylesheet (`css/app.css`, inlined), site menu, masthead (badge, lede, alpha notice), numbered step panels, the Simple/Advanced switch (localStorage key `movegm-advanced-m2m`; `.adv` hidden in simple mode, with a note when hidden settings were changed), and the footer.
1. **Load a MIDI file:** the mode switch, a **Sound pack** box (MoveGM folder; in MIDI2Circuit's base-pack position, shown in both modes because it's required), the drop zone.
2. **Choose the parts:** ▶ per part, part name (MIDI track name) with instrument · channel, notes, activity roll, role buttons **Drums · T1–T4 · Pads** (T1 is disabled when there's a drum part, because the kit is Track 1). Advanced: pad target (drum track / Track 2–4) and pad count.
3. **Pick the sounds:** per Move track: the drum kit, or a MoveGM sound (GM list plus "(Drift synth)" where one exists), defaulting to the first part's program. Advanced: octave −2…+2 per track, and a sound per pad part.
4. **Check the arrangement:** Advanced options (Section length Auto/4/8/16; Repeats exact / ignoring velocity / ≥90% / ≥75% similar (Jaccard over note tokens per track); Quantise off, 1/16, 1/8, 1/16T; Skip empty bars at the start; pitch bends; drum folding), summary tiles, Play preview, and **the grid**: Move tracks with their parts underneath, one column per section across Sets, scene letter in each cell. A dot mutes a row, a cell mutes those bars, and the S button (Advanced) solos a track; click a scene · bar heading to play from there; the playing column is outlined. Mutes apply to the preview and the Set.
5. **Build the Set:** Set name, download (one file per Set), and the optional "Play it as a song in Ableton Live" drop.
- **Accessibility:** tracks are always named in text (role buttons, grid row labels, sound fields); colour is secondary. Ian is red/green colour blind (per the CircuitGM repo notes).

## Open questions
1. Long songs: one Set with scenes plus deduplication (preferred), or several Sets?
2. More than 8 scenes in a Set: test on Move.
3. Melodic Sampler support for per-note PitchBend (would allow channel bends on melodic tracks).
4. A-S-R parameter semantics on the Drum Sampler: which params are attack, sustain and release. Check an A-S-R pad in our Sets.
