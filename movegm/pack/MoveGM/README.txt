MoveGM v0.2 - General MIDI preset pack for Ableton Move
=========================================================

128 GM programs (Melodic Sampler) + 12 drum kits (Drum Rack) + 23 Drift synths, one folder per GM family.

INSTALL
  1. Open http://move.local in a browser and go to the Presets tab.
  2. Drag the whole "MoveGM" folder onto the page and confirm Upload.
  3. On Move, browse User Presets > MoveGM.
  (Upload only the .ablpresetbundle folders; Move Manager skips other files.)

WHAT'S INSIDE
  01-16  GM programs 1-128, named "NNN Program Name" (GM numbering, 1-based)
  17     Drum Kits:
         01-09  GM Kit Standard/Room/Power/Electronic/808-909/Dance/Jazz/Brush/Orchestral
                pads 1-16 = GM notes 36-51 (Move's pad notes are also 36-51, so GM drum
                parts play the right pads unchanged)
         10-12  GM Perc 52-67, 68-83, 20-35 (the rest of the GM/GS percussion map,
                shifted onto pads 1-16)
  18     Drift Synths: 23 synthesised alternatives for GM synth programs (synth bass,
         synth strings/brass/voice, leads 81-88, pads 89-96), "NNN Name (Drift)".
         Macros: Filter Freq, Filter Reso, Filter Env, Osc 2 Level, Attack, Decay,
         Release, Glide.

HOW THE SAMPLES WERE MADE
  - One sample per preset (Move's Melodic Sampler has no key zones). Each program is
    recorded at one key (C1-C5 depending on range) and Voice Transpose restores pitch.
    Very wide-range parts (piano at the extremes) will sound stretched.
  - Move has no sample loop mode, so SoundFont loops are unrolled into 8-second samples
    with a fade; WAV loop points are also embedded.
  - GeneralUser's filter envelopes are baked into the sample at velocity 100; Move's
    filter is left fully open for you to use.
  - 44.1 kHz 16-bit WAV, mono unless the source layers are panned (34 programs stereo).
  - Levels follow GeneralUser's balance via each preset's Volume.
  - Sample files are prefixed MGM_ because Move stores all preset samples in one shared
    folder (UserLibrary/Samples/Preset Samples).

STATUS
  Not yet tested on Move hardware. Structures follow Ableton's own preset and Set files,
  and every file passes the pack validator, but the Melodic Sampler preset format in
  particular is unconfirmed (Live's exporter can't make one). Please report what loads.

CREDITS
  Sounds: GeneralUser GS 2.0.3 by S. Christian Collins - https://www.schristiancollins.com
  Used and modified under the GeneralUser GS License v2.0 (see LICENSE-GeneralUser-GS.txt).
  MoveGM is free; do not sell it.
