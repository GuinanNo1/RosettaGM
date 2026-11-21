# Ableton Move file formats: research notes

*Research date: 14 Nov 2026. Based on 105 of your own `.ablbundle` Sets in `Ableton Move Lab/Ableton Move Packs` (schema versions 1.6.2 to 1.8.3), and on 4 commercial packs in `Ableton Move Lab/Ableton Move Presets` (296 `.ablpresetbundle` and 48 `.ablbundle`, schemas 1.4.4 to 1.8.1), plus Ableton help articles and community projects (schwung, extending-move, mrdrums). Anything marked **[untested]** has to be checked on hardware before a tool depends on it.*

> **Licensing:** the commercial packs (AFTE Deep Techno, DNB Foundations, MK Melodic Movement, Upturn Techtronix) are for format research only. Don't copy their presets, samples or parameter values into anything we release. Templates for release must come from our own Sets, Ableton factory structures re-created by hand, or presets we export ourselves from Live.

---

## 1. File types at a glance

| Extension | What it is | Container |
|---|---|---|
| `.ablbundle` | A Move/Note **Set** with its samples | ZIP, entries **stored** (no compression) |
| `.abl` | The Set JSON on its own (`Song.abl` inside a bundle) | UTF-8 JSON |
| `.ablpresetbundle` | A **preset** (instrument/kit) with its samples. Exported from Live 12.1+ ("Export ABL Preset") | ZIP: `Preset.ablpreset` + optional `Samples/` + optional `BundleInfo.json` (see §5) |
| `.ablpreset` / `.json` | Preset JSON: one device tree, the same shape as a track's `devices[0]` in Song.abl, plus `$schema` (`…/devicePreset.json`) | JSON |
| `.als` | Ableton Live Set: gzip'd XML. Not native to Move. Live opens Move Sets, but Live → Move is not officially supported | gzip XML |

Sample files: WAV (PCM 16/24, float 32, WAVE_FORMAT_EXTENSIBLE), AIFF and AIFC (16/24-bit). Sample rates of 44.1, 48 and 96 kHz are all present, in mono and stereo. Move keeps files as-is and resamples to 44.1 kHz at playback. It converts samples to 32-bit in memory, so a 16-bit file takes about twice its file size in RAM. Limits: 400 MB per Set or preset upload and 100 MB per sample upload (Move Manager). Move 2.1 raised a Set's sample budget to 800 MB.

---

## 2. `.ablbundle` layout

```
Song.abl            ← Set JSON (required)
BundleInfo.json     ← provenance map (always present in samples)
Samples/<file>      ← flat folder, every sample used by the Set
```

- Sets downloaded from Move are *stored* (method 0), with samples first, then `Song.abl`, then `BundleInfo.json`. Commercial Sets use the same layout, but 32 of 48 have **no** `BundleInfo.json` at all, so it's **optional**.
- Commercial `.ablpresetbundle` files (Live exports) are **deflate**-compressed with varying entry order, and they're sold as Move-compatible. Move's unzipper therefore copes with deflate and doesn't care about order. STORE is still the cheapest choice for audio.
- **Filename encoding:** Live writes UTF-8 names *without* the ZIP UTF-8 flag (bit 11). Non-ASCII names (e.g. `FÜR`) are UTF-8 bytes in the ZIP and `%C3%9C` in the URI. A web writer should set the UTF-8 flag (JSZip/fflate do).
- `Samples/` is flat. Name collisions are presumably resolved by renaming.

### BundleInfo.json
```json
{ "originalSampleUris": {
    "Samples/Kick%20909%202.wav": "ableton:/packs/abl-core-library/Samples/Drums/Kick/Kick%20909%202.wav",
    "Samples/OChime.wav":        "ableton:/user-library/Samples/Circuit/chime/OChime.wav",
    "Samples/Set%203%20Rec%202.wav": "ableton:/user-library/Recordings/Set%203%20Rec%202.wav" } }
```
- Key: the bundle-relative path, URL-encoded exactly as it appears in Song.abl. Value: where the sample originally lived.
- In 19 cases Song.abl references a sample that was **not** in the ZIP (e.g. a deleted recording), but the URI is still listed here. Move probably falls back to the original URI. A generated tool should always bundle every sample.
- Live-exported presets put **local machine paths** in the values (e.g. `file:///E%3A/MUSIC/…/CRASH%20%289%29.wav`). Move clearly doesn't validate these values; they're provenance only. For generated content, either omit the file or use `ableton:/user-library/Samples/<YourFolder>/<file>`.

### URI schemes and on-device paths
| URI | Device path |
|---|---|
| `Samples/…` (relative) | inside the Set's own project folder |
| `ableton:/user-library/…` | `/data/UserData/UserLibrary/…` (Samples, Recordings, Track Presets, …) |
| `ableton:/packs/abl-core-library/…` | `/data/CoreLibrary/…` (read-only factory content) |
| `ableton:/device-resources/wavetable-sprites/<name>` | built-in Wavetable tables |

**Encoding:** percent-encoding with `/`, `.`, `-` and `_` left literal. Space → `%20`, and parentheses **are** encoded (`(`→`%28`, `)`→`%29`), as are `#`, `+`, `&` and `!`. JavaScript's `encodeURIComponent` does **not** encode `( ) ! ' *`, so use a custom encoder:
```js
const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const sampleUri = name => 'Samples/' + enc(name);
```

---

## 3. Song.abl (Set JSON)

Pretty-printed with a 2-space indent. Key order in samples is consistent. Keep it as listed below; whether the parser cares is **[untested]**.

### Top level
```jsonc
{
  "$schema": "http://tech.ableton.com/schema/song/1.8.3/song.json",  // seen 1.4.4 … 1.8.3
  "stepEditorResolution": "1/16",     // "1/16" | "1/32" | "1/64"
  "tempo": 120.0,                      // seen 39–157
  "globalGrooveAmount": 0.0,
  "rootNote": 5,                       // 0–11 (0 = C)
  "scale": "Major",                    // Major, Minor, Dorian, Phrygian, … (Move scale names)
  "melodicLayout": "chromatic",        // "chromatic" | "inKey"
  "timeSignature": {"upper":4,"lower":4},  // optional, newer schemas only
  "tracks": [ …4 tracks… ],            // always 4 in samples (Move = 4 tracks)
  "returnTracks": [],                  // always empty
  "masterTrack": { … },
  "scenes": [ {"name":"","color":null} ×8 ],   // 8 typical (6 and 9 seen)
  "grooves": [ … ],
  "metadata": { "usedFeatures": [ … ] }
}
```

### Track
```jsonc
{
  "kind": "midi",               // "midi" | "audio" (audio tracks since Move 2.0)
  "name": "", "color": 20,      // color index 1–25
  "isSelected": false,
  "clipSlots": [ …8 slots… ],
  // midi tracks only:
  "isNoteRepeatOn": false, "noteRepeatRate": "1/16",
  "noteRepeatArpeggio": {"style":"chordRepeat"},
  "uiOctaveIndex": 4,
  "midiInputMode": "auto",       // "auto" | [] | [channelIndex]  (0-based)
  "midiOutputEndpoint": null,    // null | channelIndex
  "devices": [ instrumentRack ], // midi: exactly one top-level instrumentRack
  "mixer": {"pan":0.0,"solo-cue":false,"speakerOn":true,"volume":0.0,"sends":[]}  // volume in dB (−70…+6)
}
```
Audio tracks have no instrument. `devices` holds 0–2 effects directly (e.g. `["reverb","delay"]`).

**Older schema (1.4.4/1.4.5, Move 1.0 era, commercial Sets):** tracks have `isArmed` instead of `isSelected`, and no `midiInputMode`/`midiOutputEndpoint`. These packs are sold for current firmware, so Move evidently migrates old schemas on load. A generator can therefore target an older, simpler schema **[untested on current firmware, but strongly implied]**.

### Clip slot / clip
```jsonc
{ "hasStop": true, "clip": null }    // empty slot

{ "hasStop": true, "clip": {
    "name": "", "color": 20, "isEnabled": true,
    "isPlaying": true,               // optional; present on the slot that was playing
    "region": { "start": 0.0, "end": 8.0,
                "loop": {"start":0.0,"end":8.0,"isEnabled":true} },   // beats (quarter notes)
    "timeSignature": {"upper":4,"lower":4},   // optional, newer schemas
    "grooveId": 1,                    // MIDI clips; references grooves[].id
    "notes": [ {
        "noteNumber": 41, "startTime": 0.0, "duration": 0.25,
        "velocity": 127.0, "offVelocity": 0.0,
        "automations": { "PitchBend": [ {"time":0.0,"value":-1365.33} ] }  // optional per-note (MPE-style)
    } ],
    "stepEditorScrollPosition": 4.0,
    "envelopes": [ { "parameterId": 2, "breakpoints": [ {"time":7.13,"value":2.39} ], "region": null } ]
} }
```
- Times are in beats. Clip lengths seen: 0.75–64 beats (16 bars max).
- Velocity is a float, 1–127.
- **Automation linkage:** an automated device parameter becomes `{"value": x, "id": N}` and the clip envelope refers to it by `parameterId: N`. The id is unique within the Set.
- Drum tracks: notes 36–51 play pads 1–16. Overlapping notes on the same pad get truncated on save.
- **Per-note PitchBend** may hold several points (`[{time, value}, …]`, times in beats from the note start). This plays bend curves on Drum Sampler pads (confirmed in Live 12).
- **Invariant:** within a clip, no two notes of the same `noteNumber` may overlap or share a start time. Live refuses to open a Set that breaks this ("document invariant violation"). Generators must end each note before the next note of the same pitch starts.

**Audio clip** (audio tracks): no notes or grooveId. Instead:
```jsonc
"sampleUri": "Samples/Drums%20Full%20Disco%20125%20bpm.wav",
"warping": { "markers": [ {"seconds":0.0,"beats":0.0}, {"seconds":7.68,"beats":16.0} ],
             "tempoAfterLastMarker": 125.0 },
"gain": -5.0, "transpose": 0, "detune": 0.0
```

### Grooves
```json
{"id":1,"name":"Swing 16ths","base":"1/16","loop":{"start":0.0,"end":4.0},
 "events":[{"time":0.0},{"time":0.3333},{"time":0.5},…]}
```

### metadata.usedFeatures
A list of feature flags the Set relies on, probably used for version-compatibility warnings. Seen: `Compressor Device`, `Compressor Side Chain EQ`, `Drum Sampler Pitch > Env`, `Saturator BassShaper Curve Type`, `Auto Filter Device`, `Drum Sampler Playback Effects`, `Groove`, `Drum Sampler 12dB Low-Pass Filter`, `Chorus Delay Tap`, `Chorus Delay Times`, `Audio Clip Properties`, `Limiter Advanced Modes`, `Auto Pan Device`, `Drum Sampler Peak Filter`, `Drum Sampler Modulation`. To be safe, copy them from a template.

---

## 4. Devices (the "patch" format)

All devices share this shape:
```jsonc
{ "presetUri": "ableton:/packs/abl-core-library/Track%20Presets/Drums/Electronic/909%20Kit.json" | null,
  "kind": "drumCell",
  "name": "",
  "lockId": 1001, "lockSeal": -973461132,     // racks only (see below)
  "parameters": { … },
  "chains": [ … ],                             // racks only
  "returnChains": [ … ],                       // drumRack only
  "deviceData": { … } }                        // non-rack devices
```

### Device kinds seen
- **Racks:** `instrumentRack`, `drumRack`, `audioEffectRack`
- **Instruments:** `drumCell` (Drum Sampler), `melodicSampler`, `drift`, `wavetable`
- **Effects:** `reverb`, `delay`, `saturator`, `chorus`, `channelEq`, `compressor`, `limiter`, `autoFilter`, `phaser`, `redux2`, `autoPan`

### Required track structures (the only shapes seen across 410 MIDI tracks)
```
Drum kit:      instrumentRack ─ chain ─ [ drumRack(16 chains of 1 drumCell, 1 returnChain w/ 1 FX), FX ]
Drift:         instrumentRack ─ chain ─ [ instrumentRack ─ chain ─ [drift], FX, FX ]
Wavetable:     instrumentRack ─ chain ─ [ instrumentRack ─ chain ─ [wavetable], FX, FX ]
Sampler:       instrumentRack ─ chain ─ [ melodicSampler, FX, FX ]
(variant)      instrumentRack ─ chain ─ [ drift, FX, FX ]       (older/alternate)
Master:        [ audioEffectRack(channelEq, compressor) | FX, FX, limiter ]
```
Ableton's documented export rules: Drums = Instrument Rack › Drum Rack (Drum Samplers on pads, one return chain holding one effect) + one insert effect. Drift = Instrument Rack › Instrument Rack with mapped macros › Drift, + two insert effects.

### Parameters
A parameter is either a bare value (number, bool or enum string) or an object:
| Object form | Meaning |
|---|---|
| `{"value": v, "presetValue": p}` | edited away from the loaded preset (p = preset's value) |
| `{"value": v, "macroMapping": {"macroIndex": 0-7, "rangeMin": a, "rangeMax": b}}` | mapped to rack macro (min at macro 0, max at 127) |
| `{"value": v, "customName": "Filter Cutoff"}` | macro label (on `MacroN` params of racks) |
| `{"value": v, "id": N}` | automated, referenced by clip `envelopes[].parameterId` |
Forms can combine (e.g. `customName + presetValue`, `customName + id`). Racks always carry `Enabled` and `Macro0`–`Macro7` (0–127).

### lockId / lockSeal (racks)
- Every rack has `lockId: 1001` plus a 32-bit signed `lockSeal`.
- The seal stays the same for a given factory preset (e.g. all "Acid 303" racks = −1868183645; the inner drumRack is usually 830049224; the inner Wavetable rack is 570097652). It **doesn't** strictly match the current child devices, because users swap effects on Move and the seal stays the same.
- The algorithm is unknown. **But the seal appears not to be required:**
  - 294 of 296 Live-exported commercial presets have **no** `lockId`/`lockSeal` on any rack. The 2 exceptions are drumRacks carrying the factory value 830049224, copied from a template.
  - Sets saved by Move after loading those presets still contain **29 seal-less inner racks** (e.g. `UPTURN/PATCHES/MAXI`, `DNB FOUNDATIONS/KIT 1`). Move loads, plays and re-saves them without complaint.
  - When a preset goes onto a track, Move seems to stamp the **outer** rack with a role-based seal: −973461132 for a drum kit outer rack, and 830049224 for the drumRack even with 7 or 8 pads. Instrument racks get one of a handful of values.
- **Recommendation:** omit `lockId`/`lockSeal` in generated **presets** (that matches what Live exports). In generated **Sets**, copy the role values above for safety. Confirming that a Set with no seals at all loads is still **[untested]**, but it's low risk.

### drumRack specifics
- **Partial kits are valid.** Commercial presets ship drumRacks with 7, 8, 12 or 15 chains, and the gaps can fall anywhere: e.g. notes `36,37,38,40,41,42,43` (39 missing) and `36,40,41,42,43,39,38,37`. Each chain holds exactly one `drumCell` and carries:
  `"drumZoneSettings": {"receivingNote": 36…51, "sendingNote": 60, "chokeGroup": null|1|2}`
- Chain order in the array is often unsorted (13 of 35 full commercial kits, plus the Chime Set). Given the gaps, **`receivingNote` is what places a chain on a pad** (36 = pad 1, bottom-left), not array position. A generator can write only the pads it uses.
- `returnChains` may be empty (`[]`). 10 commercial kits have no return effect, despite Ableton's "one return chain" rule.
- An empty pad is a drumCell with `"deviceData": {"sampleUri": null}`.
- Chain `mixer` includes `sends: [{"isEnabled":true,"amount":-70.0}]` → level into the single return chain (dB).
- `returnChains`: `[ {name, color, devices:[ one FX ], mixer} ]`.

### drumCell (Drum Sampler) parameters (43)
`Effect_Type` ("Sub Osc", …) and `Effect_*` amounts, `Voice_Envelope_Mode` ("A-H-D"), `Voice_Envelope_Attack/Hold/Decay`, `Voice_Filter_Type/Frequency/Resonance/On/PeakGain`, `Voice_Transpose`, `Voice_Detune`, `Voice_Gain`, `Voice_PlaybackStart/Length` (0–1), `Voice_VelocityToVolume`, `Voice_Modulation*`, `NotePitchBend`, `Pan`, `Volume` (dB), `Enabled`. Sample: `deviceData.sampleUri`.

### melodicSampler
`Voice_AmplitudeEnvelope_*` (incl. `SustainMode: "Gate"`), `Voice_FilterEnvelope_*`, `Voice_Filter_*` (`Slope: "12"`), `Voice_Lfo_*`, `Voice_Transpose`, `Voice_PlaybackStart/Length`, `Volume`. A single sample is in `deviceData.sampleUri`, with no multisample zones seen. This matters for MoveGM: one sample per instrument, transposed across the keyboard.

### drift (83 params) / wavetable (101 params)
- Drift: `Oscillator*`, `Filter_*`, `Envelope1/2_*`, `CyclingEnvelope_*`, `Lfo_*`, `Global_*` (`VoiceMode` Mono/Poly/Stereo/Unison, `VoiceCount`, `Glide`, `PitchBendRange`, `SerialNumber`…). `deviceData: {}`.
- Wavetable: `deviceData` = `{spriteUri1, spriteUri2, modulations: {<paramName>: [13 floats]}}`. The modulation matrix stores one row per target.

---

## 5. Presets (`.ablpresetbundle` / `.ablpreset`)

### Bundle layout (296 commercial presets examined)
```
Preset.ablpreset    ← always this exact name
Samples/<file>      ← only if the preset uses samples (drum kits); flat
BundleInfo.json     ← optional (present in 152 of 296)
```
Deflate compression. Entry order varies (`Samples/` first when present). ZIP timestamps are usually zeroed (1980-00-00), i.e. Live doesn't set them.

### Preset.ablpreset
```jsonc
{
  "$schema": "http://tech.ableton.com/schema/song/1.4.7/devicePreset.json",  // seen 1.4.4, 1.4.7
  "kind": "instrumentRack",          // always the outer instrumentRack
  "name": "5th Saw",
  "parameters": { "Enabled": true, "Macro0": …, … "Macro7": … },
  "chains": [ { "name": "", "color": 0, "mixer": {…}, "devices": [ … ] } ]
}
```
- The top level has **no** `presetUri`, `lockId` or `lockSeal`. Inner devices keep `presetUri` (usually `null`).
- The device-preset schema is versioned separately from the song schema (`devicePreset.json` 1.4.x vs `song.json` 1.8.x).
- Sample references are relative (`Samples/<encoded name>`), the same as in Sets. All 588 drum-cell refs were present in their ZIPs.
- Pretty-printed, 2-space indent, `$schema` first.

### Structures seen in commercial presets (all with the outer instrumentRack)
| Count | Structure |
|---|---|
| 251 | `[ instrumentRack[drift], 0–2 FX ]`. Includes **25 with no FX at all** and many with a single FX |
| 45 | `[ drumRack(7–16 pads, 0–1 return), 0–1 FX ]` |
FX seen: reverb, delay, autoFilter, saturator, chorus, phaser, channelEq, redux2. **Auto Filter is valid in presets**, even though Ableton's help article doesn't list it. No Wavetable or Sampler presets appear in these packs, because Live 12.1's exporter only supports Drift and Drum Sampler kits. Our own Sets do contain them.

### What happens on upload
Inferred from presetUri / originalSampleUris in Sets saved after the presets were installed:
- `Presets` tab upload of a folder → `/data/UserData/UserLibrary/Track Presets/<uploaded folder path>/<preset name>.ablpreset`
  e.g. `ableton:/user-library/Track%20Presets/DNB%20FOUNDATIONS/REESE/PHISON.ablpreset`
  The folder hierarchy is preserved, so a tool can ship a ZIP of folders like `MoveGM/Pianos/…` and the user drags the folder in.
- Bundled samples are extracted to `/data/UserData/UserLibrary/Samples/Preset Samples/`. The name is flat, so **collisions across presets are a real risk**: prefix sample filenames with a pack ID (e.g. `MGM_001_AcPiano_C4.wav`).
- Factory presets: `ableton:/packs/abl-core-library/Track%20Presets/…/909%20Kit.json` → `/data/CoreLibrary/Track Presets/…`. Editing a core preset on Move copies it into the UserLibrary.
- Move Manager rejects non-preset files in a dropped folder (pack readmes warn about this), so only `.ablpresetbundle` files should go in preset folders.

## 6. Getting files onto Move (official routes, no hacking)

- **Move Manager**: `http://move.local` (USB-C or same Wi-Fi, 6-digit code on the display).
  - Sets tab: upload `.ablbundle` (Move holds 32 Sets max).
  - Presets tab: upload `.ablpresetbundle`.
  - Samples tab: upload audio files or folders (≤100 MB).
- Ableton Note on iOS opens both `.ablbundle` and `.ablpresetbundle` and syncs with Move over Ableton Cloud.
- In Move Manager, use Chrome or Firefox for downloads. Older Safari builds saved bundles as `.zip`.

---

## 7. Implications for the web tools

1. **Build from templates, don't synthesise from scratch.** Keep a library of known-good device trees extracted from *our own* Sets and Live exports (909 Kit, Drift, Wavetable and Sampler racks, master chain) and change only parameters, samples and notes. That keeps `usedFeatures`, schema version and unknown parameter defaults valid. Don't copy from the commercial packs.
2. **Bundle writer in the browser:** a ZIP (STORE or deflate both work) with the UTF-8 name flag set. Write `Song.abl`/`Preset.ablpreset` plus `Samples/`. `BundleInfo.json` is optional.
3. **Presets are the easiest first target.** A preset is a single device tree with no seal and an optional BundleInfo, and it's proven to work from third-party tools (Live's exporter). MoveGM can ship as a folder of `.ablpresetbundle` files that the user drags onto the Presets tab.
4. **MIDI2Move:** 4 tracks × 8 clips max. Clip ≤ 64 beats (16 bars) per clip, so longer files need splitting across clip slots or scenes. Note times are in beats. Drums go to notes 36–51. GM drum notes (35–81) have to be folded into 16 pads.
5. **Circuit2Move:** Circuit's 8-step patterns × 4 tracks map naturally onto clips. Synth patches map to Drift parameters (Drift is the closest analogue), and drum samples go into drumCell kits.
6. **MoveGM:** one Sampler per program (single sample, no zones) or a Drift approximation. Each GM program becomes an `.ablpresetbundle`. Drum kits are drumRacks of up to 16 pads (partial kits are fine), so the GM kit needs to be curated down to 16 sounds. Prefix sample names to avoid clashes in the shared `Preset Samples` folder.

## 8. Open questions to test on hardware

Resolved by the commercial packs: `.ablpresetbundle` layout ✔, deflate and entry order accepted ✔, BundleInfo optional and not validated ✔, seal-less racks load ✔ (in presets, and as inner racks in Sets), pads placed by `receivingNote` ✔ (strongly implied by gapped kits).

Still open:
1. Does a **Melodic Sampler** or **Wavetable** preset load when uploaded as `.ablpresetbundle`? Live 12.1 can't export these, so it's untested territory and key for MoveGM. Test by hand-building one from a Sampler track in our own Set.
2. Does a Set with **no seals at all** (outer racks included) load?
3. Minimum valid Song.abl. Can `usedFeatures`, `grooves` and scenes be empty?
4. Which `$schema` to write for new Sets: oldest (1.4.4, simplest, evidently migrated) or newest (1.8.3)?
5. Sample-name collision behaviour in `Samples/Preset Samples/`: overwrite or rename?

## 9. Reusing code and assets from schwung

The [schwung](https://github.com/charlesvestal/schwung) repo is mostly permissively licensed, so it can be used in our tools where it fits, with credit. Checked 14 Nov 2026 against its README and `THIRD_PARTY_LICENSES.md`:

- **OK to reuse with attribution** (keep the copyright notice, credit in the README/about page):
  - schwung's own source: **MIT** (host, shim source, schwung-manager)
  - QuickJS (MIT), the Cycling '74 **Move MIDI emulator** used on the `/mirror` page (MIT; possibly useful for a browser preview of the Move's pads), Freeverb (public domain), stb (public domain / MIT-0), Tamsyn/Tamzen fonts (permissive), libsamplerate (BSD-2), sonic (Apache-2.0), Flite (BSD-style)
- **Avoid copying into our web tools (copyleft):**
  - `link-subscriber` / Ableton Link (GPL-2.0+; Ableton also sells a commercial licence)
  - `jack_shadow.so` / jack2 (GPL-2.0+)
  - `schwung-tts` and eSpeak NG (GPL-3.0+)
  - the Ableton ablspi protocol docs (GPL-2.0 reference material)
- **MPL:** none listed in the main repo's licence file. The catalog modules live in separate repos, each with its own licence. Check each one before reuse; MPL-2.0 is file-level copyleft, so modified MPL files must stay MPL and keep their source available.
- **Module assets** (ROMs, SoundFonts, wavetable packs) are copied in by modules at install time and are not covered by schwung's licence. Treat each one separately.
- Practical rule: put an `ATTRIBUTION.md` / credits section in each tool listing every reused file, its source URL and its licence.

## Sources
- [Presets on Move and Note (Ableton Help)](https://help.ableton.com/hc/articles/15616909965596)
- [Sets and Content on Move (Ableton Help)](https://help.ableton.com/hc/articles/15338257784092)
- [How to manage and share Move Sets](https://help.ableton.com/hc/en-us/articles/17032431214236)
- [Move release notes](https://www.ableton.com/en/release-notes/move-1/)
- [schwung](https://github.com/charlesvestal/schwung) · [extending-move file formats (DeepWiki)](https://deepwiki.com/charlesvestal/extending-move/8.1-file-formats-and-structure) · [schwung-mrdrums (URI → path mapping)](https://github.com/handcraftedcc/schwung-mrdrums)
