"""General MIDI tables for MoveGM."""

FAMILIES = ["Piano", "Chromatic Percussion", "Organ", "Guitar", "Bass", "Strings", "Ensemble", "Brass",
            "Reed", "Pipe", "Synth Lead", "Synth Pad", "Synth Effects", "Ethnic", "Percussive", "Sound Effects"]

PROGRAMS = [
    "Acoustic Grand Piano", "Bright Acoustic Piano", "Electric Grand Piano", "Honky-tonk Piano",
    "Electric Piano 1", "Electric Piano 2", "Harpsichord", "Clavinet",
    "Celesta", "Glockenspiel", "Music Box", "Vibraphone", "Marimba", "Xylophone", "Tubular Bells", "Dulcimer",
    "Drawbar Organ", "Percussive Organ", "Rock Organ", "Church Organ", "Reed Organ", "Accordion", "Harmonica",
    "Tango Accordion",
    "Nylon Guitar", "Steel Guitar", "Jazz Guitar", "Clean Guitar", "Muted Guitar", "Overdriven Guitar",
    "Distortion Guitar", "Guitar Harmonics",
    "Acoustic Bass", "Fingered Bass", "Picked Bass", "Fretless Bass", "Slap Bass 1", "Slap Bass 2",
    "Synth Bass 1", "Synth Bass 2",
    "Violin", "Viola", "Cello", "Contrabass", "Tremolo Strings", "Pizzicato Strings", "Orchestral Harp", "Timpani",
    "String Ensemble 1", "String Ensemble 2", "Synth Strings 1", "Synth Strings 2", "Choir Aahs", "Voice Oohs",
    "Synth Voice", "Orchestra Hit",
    "Trumpet", "Trombone", "Tuba", "Muted Trumpet", "French Horn", "Brass Section", "Synth Brass 1", "Synth Brass 2",
    "Soprano Sax", "Alto Sax", "Tenor Sax", "Baritone Sax", "Oboe", "English Horn", "Bassoon", "Clarinet",
    "Piccolo", "Flute", "Recorder", "Pan Flute", "Blown Bottle", "Shakuhachi", "Whistle", "Ocarina",
    "Square Lead", "Saw Lead", "Calliope Lead", "Chiff Lead", "Charang Lead", "Voice Lead", "Fifths Lead",
    "Bass + Lead",
    "New Age Pad", "Warm Pad", "Polysynth Pad", "Choir Pad", "Bowed Pad", "Metallic Pad", "Halo Pad", "Sweep Pad",
    "Rain FX", "Soundtrack FX", "Crystal FX", "Atmosphere FX", "Brightness FX", "Goblins FX", "Echoes FX",
    "Sci-fi FX",
    "Sitar", "Banjo", "Shamisen", "Koto", "Kalimba", "Bagpipe", "Fiddle", "Shanai",
    "Tinkle Bell", "Agogo", "Steel Drums", "Woodblock", "Taiko Drum", "Melodic Tom", "Synth Drum", "Reverse Cymbal",
    "Guitar Fret Noise", "Breath Noise", "Seashore", "Bird Tweet", "Telephone Ring", "Helicopter", "Applause",
    "Gunshot",
]
assert len(PROGRAMS) == 128

# Key each program is rendered at (the sample's recorded pitch). Move plays samples as root C3 (MIDI 60),
# so Voice_Transpose = 60 - key restores concert pitch. Octave-spaced keys keep Transpose a whole octave.
RENDER_KEY = {p: 60 for p in range(128)}
for p in (32, 33, 34, 35, 36, 37, 38, 39, 43, 87):      # basses, contrabass, bass+lead
    RENDER_KEY[p] = 36
for p in (42, 47, 57, 58, 67, 70):                       # cello, timpani, trombone, tuba, bari sax, bassoon
    RENDER_KEY[p] = 48
for p in (8, 10, 13, 40, 64, 68, 73, 74, 75, 78, 79):    # celesta, music box, xylo, violin, sop sax, oboe, flutes...
    RENDER_KEY[p] = 72
for p in (9, 72, 112):                                   # glockenspiel, piccolo, tinkle bell
    RENDER_KEY[p] = 84

# GM percussion names (GM1 35-81 plus GS extras 27-34, 82-87)
DRUM_NAMES = {
    27: "High Q", 28: "Slap", 29: "Scratch Push", 30: "Scratch Pull", 31: "Sticks", 32: "Square Click",
    33: "Metronome Click", 34: "Metronome Bell", 35: "Acoustic Bass Drum", 36: "Bass Drum 1", 37: "Side Stick",
    38: "Acoustic Snare", 39: "Hand Clap", 40: "Electric Snare", 41: "Low Floor Tom", 42: "Closed Hi-Hat",
    43: "High Floor Tom", 44: "Pedal Hi-Hat", 45: "Low Tom", 46: "Open Hi-Hat", 47: "Low-Mid Tom",
    48: "Hi-Mid Tom", 49: "Crash Cymbal 1", 50: "High Tom", 51: "Ride Cymbal 1", 52: "Chinese Cymbal",
    53: "Ride Bell", 54: "Tambourine", 55: "Splash Cymbal", 56: "Cowbell", 57: "Crash Cymbal 2",
    58: "Vibraslap", 59: "Ride Cymbal 2", 60: "Hi Bongo", 61: "Low Bongo", 62: "Mute Hi Conga",
    63: "Open Hi Conga", 64: "Low Conga", 65: "High Timbale", 66: "Low Timbale", 67: "High Agogo",
    68: "Low Agogo", 69: "Cabasa", 70: "Maracas", 71: "Short Whistle", 72: "Long Whistle", 73: "Short Guiro",
    74: "Long Guiro", 75: "Claves", 76: "Hi Wood Block", 77: "Low Wood Block", 78: "Mute Cuica",
    79: "Open Cuica", 80: "Mute Triangle", 81: "Open Triangle", 82: "Shaker", 83: "Jingle Bell",
    84: "Bell Tree", 85: "Castanets", 86: "Mute Surdo", 87: "Open Surdo",
}

# GeneralUser GS drum kits (bank 128 program -> kit name). Core kits put GM notes 36-51 on pads 1-16
# (Move pad notes are also 36-51, so GM drum notes play the right pads unchanged).
KITS = [(0, "Standard"), (8, "Room"), (16, "Power"), (24, "Electronic"), (25, "808-909"), (26, "Dance"),
        (32, "Jazz"), (40, "Brush"), (48, "Orchestral")]
# Extra percussion kits from the Standard kit: (name, first GM note); pads 1-16 = notes first..first+15
PERC_KITS = [("GM Perc 52-67", 52), ("GM Perc 68-83", 68), ("GM Perc 20-35", 20)]

# Converter fold-down for GM notes outside 36-51 when only the core kit is available
FOLD_TO_CORE = {35: 36, 27: 37, 28: 37, 31: 37, 32: 37, 33: 37, 34: 51, 52: 49, 53: 51, 54: 44, 55: 49,
                56: 37, 57: 49, 58: 46, 59: 51, 60: 50, 61: 48, 62: 48, 63: 47, 64: 45, 65: 50, 66: 47,
                67: 37, 68: 37, 69: 44, 70: 44, 71: 37, 72: 37, 73: 42, 74: 46, 75: 37, 76: 37, 77: 37,
                78: 39, 79: 39, 80: 42, 81: 46, 82: 44, 83: 44, 84: 46, 85: 37, 86: 45, 87: 43, 29: 39, 30: 39}
