# Move effects: reference for the MIDI2Move effects step

*21 Nov 2026. Sources: effect devices in our own Move Sets (Ableton Move Packs, 80 Sets) plus the commercial packs (research only), the Move manual and release notes. The preset lists below are the Ableton Core Library presets **seen in those Sets**. They're a large sample but **not the complete library**: the full list lives on the Move in `/data/CoreLibrary/Audio Effects/<Effect>/`.*

## Where effects live in a Move Set
| Place | Slots | Seen in Sets |
|---|---|---|
| Each track (instrument rack) | **2 insert effects** after the instrument | reverb 459, delay 366, saturator 236, chorus 170, autoFilter 108, phaser 41, channelEq 41, redux 8, autoPan 6 |
| Drum kit (Drum Rack) | **1 return effect**, fed by a **send on every pad** | reverb 164, delay 25, chorus 5, channelEq 2, phaser 1 |
| Main (master) track | 2 effects, then a fixed limiter | Dynamics rack (Punch Glue etc.) 129, Saturator 99, Channel EQ 20, Auto Filter 19, Phaser 19, Delay 19, Reverb 9; Limiter 153 |

- **Main track = inserts on the whole mix, not sends.** In all 105 Sets: `masterTrack.devices` is [effect 1, effect 2, `limiter`] (e.g. Dynamics → Saturator → Limiter), `masterTrack.mixer` is only `{pan, volume}`, every track's `mixer.sends` is empty, and `returnTracks` is empty. So there's **no per-track amount** for the main effects: the only control is each effect's own **Dry/Wet** (applies to the whole mix). In our Sets the main Saturator mostly sits at DryWet 0 (51 of 64), Auto Filter at 1.0.
- **Sends exist only inside drum kits:** each pad's chain has `mixer.sends: [{isEnabled, amount}]`, with `amount` in dB (−70 = off; commonly −18, −20, −23, −9, 0). Melodic tracks have no sends (`returnTracks` is always empty), so their effects are inserts.
- Effects store a `presetUri` such as `ableton:/packs/abl-core-library/Audio%20Effects/Reverb/Hall%20Bright.json` plus their full parameter set. "(default)" in the lists below means `presetUri: null` (the effect added from scratch).

## Effect types and presets seen
**Reverb** (`reverb`): Default Reverb, Hall Bright, Hall Damped, Hall Shine, Hall Large, Arena Tail, Parking Garage, Plate Damped, Room Wood, Small Tile, Marble Lobby, Museum Lobby, Vocal Space, Space Reverb, In A Box, Red Canyon

**Delay** (`delay`): 16th Ping Pong, 16th Clean, 8th Groove, 8th Dotted, 4th Bandpass, 4th Band-pass, 4th Distant, Time Delay, Bounce Delay (Move 2.0.5 also lists Tape Warble; newer firmware added LFO-based delay presets)

**Saturator** (`saturator`): Default Saturator, Analog Clip, Basic Soft, Gritty Bass, Beat Clipper, Hard Color, Hard Punch, 808 Shaper, Manic Smash, Rough Tone, Rage Clipper

**Chorus-Ensemble** (`chorus`): Chorus Default, Chorus Classic, Chorus Subtle Funk, Chorus Bass, Chorus Warmth, Chorus Vintage, Ensemble Deep, Ensemble Feedback, Warm Chorale (newer firmware added Tap/Time-based presets)

**Phaser-Flanger** (`phaser`): Phaser Default, Phaser Feedback, Phaser Spread, Flanger Default, Flanger Spinning, Flanger Rebound, Flanger Warm (plus Doubler modes; "Doubler Default" is named in the release notes)

**Auto Filter** (`autoFilter`): Default Filter, DJ Filter, Vowel Moving, LFO Beat Sync

**Channel EQ** (`channelEq`): Default EQ, Vocal Curve, Keys Bright, High End Boost, Low End Boost, Drum Smoother

**Redux** (`redux2`): Default Redux, New Mirage, Dirt & Grit, Some Dust

**Auto Pan-Tremolo** (`autoPan`): Trem Ducker, Pan Spin, Pan Subtle, Trem Gate Spikey

**Dynamics** (`audioEffectRack` holding channelEq + compressor; main track): Punch Glue, Very Fast, Gentle, Less Gentle, Soft Glue, Fast, Pump

**Not seen in any of our Sets:** **Erosion** and **Auto Shift** (added in Move 2.x). Their device names, parameters and presets need a Set saved on a Move that uses them.

## Agreed direction (21 Nov 2026)
Start with **Reverb and Delay as the two main-track effects** (preset + one amount each = Dry/Wet on the main track, applied to everything), keeping the fixed Limiter. Because the Move has no per-track sends, per-track amounts would need per-track insert Reverb/Delay with their own Dry/Wet; that's an optional Advanced extension.

## Proposal for MIDI2Move step "Add effects" (mirrors MIDI2Circuit's step 5)
- **Per Move track: Effect 1 and Effect 2.** Each is a menu of "Effect type / preset" (e.g. *Reverb / Hall Bright*, *Delay / 8th Dotted*), or None. Simple mode: none, or one suggested pair per track. Advanced: all slots.
- **Drum kit: return effect + send amount.** The return effect (*Reverb / Hall Bright* by default) and one **send amount for all pads** (Off / −23 / −18 / −9 / 0 dB), with per-pad sends as an Advanced option.
- **Main track: two effects** (Advanced), for example *Dynamics / Punch Glue* + *Saturator / Analog Clip*, as many of our Sets have.
- **Implementation:** each preset's parameters are harvested from our own Sets (Ableton's factory values, carried with its `presetUri`). Effects with no preset seen use the "(default)" parameter set. Validator: at most 2 FX per track and kinds from the list above.
