// Circuit Tracks scales (User Guide v3, p. 31). The index is the project's stored scale type
// (0x26D0C table, T_SCALE_TYPE) and the Scales View pad (17 + index): checked against every
// project in two hardware packs, whose notes all lie in their scale read this way.
export const SCALES = [
  { name: 'Natural Minor', steps: [0, 2, 3, 5, 7, 8, 10] },
  { name: 'Major', steps: [0, 2, 4, 5, 7, 9, 11] },
  { name: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  { name: 'Phrygian', steps: [0, 1, 3, 5, 7, 8, 10] },
  { name: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
  { name: 'Melodic Minor', steps: [0, 2, 3, 5, 7, 9, 11] },
  { name: 'Harmonic Minor', steps: [0, 2, 3, 5, 7, 8, 11] },
  { name: 'Bebop Dorian', steps: [0, 3, 4, 5, 7, 9, 10] },
  { name: 'Blues', steps: [0, 3, 5, 6, 7, 10] },
  { name: 'Minor Pentatonic', steps: [0, 3, 5, 7, 10] },
  { name: 'Hungarian Minor', steps: [0, 2, 3, 6, 7, 8, 11] },
  { name: 'Ukrainian Dorian', steps: [0, 2, 3, 6, 7, 9, 10] },
  { name: 'Marva', steps: [0, 1, 4, 6, 7, 9, 11] },
  { name: 'Todi', steps: [0, 1, 3, 6, 7, 8, 11] },
  { name: 'Whole Tone', steps: [0, 2, 4, 6, 8, 10] },
  { name: 'Chromatic', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
];
export const CHROMATIC = 15;
export const ROOT_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

const scaleOf = (type) => SCALES[type] ?? SCALES[CHROMATIC];
// Is a number of semitones above the root (any octave) in the scale?
export const inScale = (semi, type) => scaleOf(type).steps.includes(((semi % 12) + 12) % 12);

// Synth and MIDI notes are stored as semitones above the scale root, so changing the root
// transposes them. A note not in the scale (after the scale is changed) plays the nearest note
// in it; the guide says "normally either one semitone above or below the original note" without
// saying which, so a tie goes down (major third -> minor third). To check on the hardware.
export function snapToScale(semi, type) {
  if (inScale(semi, type)) return semi;
  for (let d = 1; d < 12; d++) {
    if (inScale(semi - d, type)) return semi - d;
    if (inScale(semi + d, type)) return semi + d;
  }
  return semi;
}

// The note of scale degree `deg` (0 = root, may run past one octave) above `base`.
export function degreeNote(base, deg, type) {
  const st = scaleOf(type).steps;
  return base + 12 * Math.floor(deg / st.length) + st[((deg % st.length) + st.length) % st.length];
}
export const scaleLength = (type) => scaleOf(type).steps.length;
