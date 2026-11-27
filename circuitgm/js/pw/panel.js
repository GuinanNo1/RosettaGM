// PatchWorker's TRACKS face: a panel laid out like the Circuit Tracks front panel (track
// buttons, view buttons, 32 pads, transport). The layout and views follow Web Tracks by Namir
// Sayed-Ahmad Baraza (circuit-tracks-tools, MIT); the code is CircuitGM's own.
//
// Steps of the plan (claude/plan-patchworker-tracks-panel.md) built so far:
// 1. The shell. The track buttons choose the synth being edited, and Note view plays it from the
//    bottom two rows of pads.
// 2. Preset view. Synth tracks: the pack's 128 patches as four pages of 32 pads; the lit pad is
//    the patch being edited, pressing a pad edits that patch and plays it while held. Drum tracks:
//    the pack's 64 samples as two pages; pressing a pad picks the track's sample and plays it.
// 3. The Offline player (PatchWorker 0.10): Projects view picks and plays a project from the pack
//    (js/pw/project.js); Patterns view chooses each track's pattern chain; Mixer view mutes tracks,
//    sets levels and picks scenes and scene chains (bottom two rows, as on the hardware); Tempo
//    view sets tempo and swing; Note view shows the playing pattern's steps on the top two rows.
// 4. Step editing (PatchWorker 0.13): Note view adds and removes notes (synth and MIDI: choose a
//    step, then the keys; drums: tap a step), Velocity, Gate, Probability and Pattern Settings views,
//    Clear, Duplicate and 1-16/17-32 as on the hardware (User Guide v3, pp. 38-55 and 75), and Save
//    into the pack open in the browser (p. 60).
// The other views are placeholders until their step is built.

export const TRACKS = [
  { id: 's1', label: 'Synth 1', kind: 'synth' }, { id: 's2', label: 'Synth 2', kind: 'synth' },
  { id: 'm1', label: 'MIDI 1', kind: 'midi' }, { id: 'm2', label: 'MIDI 2', kind: 'midi' },
  { id: 'd1', label: 'Drum 1', kind: 'drum' }, { id: 'd2', label: 'Drum 2', kind: 'drum' },
  { id: 'd3', label: 'Drum 3', kind: 'drum' }, { id: 'd4', label: 'Drum 4', kind: 'drum' },
];
// View buttons: the step views on the left, the project views on the right, as on the hardware.
export const VIEWS = [
  { id: 'note', label: 'Note', step: 1 }, { id: 'velocity', label: 'Velocity', step: 3 },
  { id: 'gate', label: 'Gate', step: 3 }, { id: 'probability', label: 'Probability', step: 3 },
  { id: 'micro', label: 'Micro step', step: 3 }, { id: 'pattern', label: 'Pattern settings', step: 3 },
  { id: 'preset', label: 'Preset', step: 1, group: 'project' }, { id: 'projects', label: 'Projects', step: 1 },
  { id: 'patterns', label: 'Patterns', step: 1 }, { id: 'mixer', label: 'Mixer', step: 1 },
  { id: 'fx', label: 'FX', step: 1 }, { id: 'sidechain', label: 'Side Chain', step: 1 },
  { id: 'scales', label: 'Scales', step: 3 }, { id: 'expand', label: 'Expanded Note', step: 3 }, { id: 'roll', label: 'Piano roll', step: 3 }, { id: 'tempo', label: 'Tempo', step: 1 },
];
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const noteName = (n) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
// Views whose top two rows are the pattern's steps.
const STEP_VIEWS = ['note', 'velocity', 'gate', 'probability', 'micro', 'pattern'];
// Pattern Settings: the sync rate row, left to right (stored values: 0 = 1/32T ... 7 = 1/4), and
// the play orders on pads 29-32.
const RATE_PADS = ['1/4', '1/4T', '1/8', '1/8T', '1/16', '1/16T', '1/32', '1/32T'];
const DIRECTIONS = ['Forward', 'Reverse', 'Ping-pong', 'Random'];
const FIXED_VELOCITY = 96;
// Note view keyboard on the bottom two rows of pads: white keys on the bottom row, the black
// keys above them (null = no key), from C to the next C.
import { SCALES, CHROMATIC, ROOT_NAMES, inScale, degreeNote } from '../scales.js';
import { buildRoll } from './roll.js?v=20261125a';
import { DELAY_NAMES, REVERB_NAMES } from '../fx.js';
const WHITE = [0, 2, 4, 5, 7, 9, 11, 12];
const BLACK = [null, 1, 3, null, 6, 8, 10, null];

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid);
  return el;
}

// Drum tracks start on these sample slots (TracksGM's Std Kick, Snare, CH, OH) until a project
// sets them (step 3).
const DRUM_DEFAULT = [0, 1, 3, 4];
const pad3 = (n) => String(n).padStart(3, '0');

// root: the panel's container. api: { synth() -> 0/1 being edited, chooseSynth(i),
// noteOn(note, velocity?), noteOff(note), octave() -> keyboard octave (C3 = 3), velocity() -> the
// velocity the keys play at, projectSaved(slot) after Save,
// slot() -> pack slot being edited, slotCount() -> 128, slotInfo(i) -> { name, empty, edited, fetched },
// selectSlot(i), copyTo(i) (asks before replacing a patch), revert(),
// sampleCount() -> 64, sampleName(i) -> name or '' for an empty slot, audition(i, track), stopAudition(),
// proj: the ProjectPlayer (js/pw/project.js) or null, projects() -> its 64 slots, loadProject(slot) }.
export function buildPanel(root, api) {
  const st = { track: api.synth(), view: 'note', pads: [], page: [0, 0, 0, 0, 0, 0, 0, 0], vpage: { projects: 0, patterns: 0 }, drum: DRUM_DEFAULT.slice(), copying: false, hover: null, lastSlot: null, pos: null,
    spage: [0, 0, 0, 0, 0, 0, 0, 0],   // step page per track (0: steps 1-16, 1: 17-32)
    sel: null,                         // the step chosen in a step view (0-31)
    armed: false,                      // Note view: keys add / remove notes on the chosen step
    mode: null,                        // 'clear' or 'dup' while Clear or Duplicate is on
    mixMode: 'level',                  // Mixer view: the macro knobs set 'level' or 'pan'
    fxMode: 'reverb',                  // FX view: the macro knobs set 'reverb' or 'delay' sends (the last preset pad pressed)
    scPage: 0,                         // Side Chain view: 0 Synth 1 / 2, 1 MIDI 1 / 2
    scTrack: 0,                        // Side Chain view: the track (0-3) whose trigger drum the top row chooses
    dupSrc: null,                      // Duplicate: the step being copied
    fixedVel: false,                   // Shift + Velocity: Fixed Velocity (96)
    saveArm: false,                    // Save pressed once: the next Save (or a project pad) saves
    msg: '', msgTimer: null,
    scale: { root: 0, type: CHROMATIC },     // the keyboard's scale when no project is loaded
    dpage: [0, 0, 0, 0],                     // drum Note view: the page of 16 samples shown
    flip: null,                              // drum Note view: the sample armed for a sample flip
    heldStep: null,                          // drum Note view: the step held (its sample shows red)
    stepFlip: null,                          // drum Note view: the step armed by a long press
    rollFocus: null,                         // { t, p }: the pattern the roll opened on (Patterns view)
    rollStatus: '' };                        // what is under the pointer in the roll                        // drum Note view: the step armed by a long press                            // drum Note view: the sample armed for a sample flip   // the keyboard's scale when no project is loaded
  const pp = api.proj ?? null;

  // ---- the panel, laid out as the Circuit Tracks' top panel (User Guide v3, page 15)
  const shift = { on: false, held: false };   // Shift: the computer's Shift key, or click to arm it for one press
  const isShift = (e) => !!e?.shiftKey || shift.on;
  const useShift = () => { if (shift.on && !shift.held) { shift.on = false; paintShift(); } };
  // A panel button: name, optional second legend (shown below, as on the hardware) or top legend
  // (above: the function row's Shift legends), and a handler (e) => void.
  const btn = (cls, name, { below, above, title, onclick, disabled } = {}) => {
    const b = h('button', { type: 'button', class: `cbtn ${cls}`, title: title ?? name },
      above ? h('span', { class: 'leg-top', text: above }) : null,
      h('span', { class: 'nm', text: name }),
      below ? h('span', { class: 'leg', text: below }) : null);
    if (disabled) b.classList.add('idle');
    b.addEventListener('click', (e) => {
      // Any other button cancels a Save waiting for its second press.
      const cancel = st.saveArm && !b.classList.contains('save');
      if (cancel) st.saveArm = false;
      onclick?.(e);
      if (cancel) paint();
    });
    return b;
  };
  const trackBtns = TRACKS.map((t, i) => {
    const b = btn(`trk ${t.kind}`, t.label, { title: t.kind === 'synth' ? `${t.label}: edit and play its patch` : `${t.label}: its steps in Note view, its sample in Preset view`, onclick: () => selectTrack(i) });
    b.dataset.track = i;
    b.dataset.short = t.label.replace('Synth ', 'S').replace('MIDI ', 'M').replace('Drum ', 'D');
    b.setAttribute('aria-pressed', 'false');
    return b;
  });
  // View buttons. Second legends: a secondary view (Shift + button, or press the button again in its
  // view) or a Shift-only mode. Views not built yet still select, and say so in the status strip.
  const viewBtn = (id, name, { below, secondary, title, onShift } = {}) => {
    const b = btn('view', name, { below, title: title ?? `${name}${below ? ` (Shift: ${below})` : ''}`, onclick: (e) => {
      const sh = isShift(e);
      useShift();
      if (sh && onShift) { onShift(); return; }
      if (secondary && (sh || st.view === id)) selectView(st.view === secondary && !sh ? id : secondary);
      else selectView(id);
    } });
    b.dataset.view = id;
    if (secondary) b.dataset.secondary = secondary;
    b.setAttribute('aria-pressed', 'false');
    return b;
  };
  const vNote = viewBtn('note', 'Note', { below: 'Expand', secondary: 'expand' });
  const vVel = viewBtn('velocity', 'Velocity', { below: 'Fixed', title: 'Velocity (Shift: Fixed Velocity on or off; notes you add then have velocity 96)', onShift: () => { st.fixedVel = !st.fixedVel; flash(`Fixed Velocity ${st.fixedVel ? 'on: notes you add have velocity 96' : 'off: notes you add take the velocity set at the bottom'}.`); } });
  const vGate = viewBtn('gate', 'Gate', { below: 'Micro Step', secondary: 'micro' });
  const vPat = viewBtn('pattern', 'Pattern Settings', { below: 'Probability', secondary: 'probability' });
  const vPreset = viewBtn('preset', 'Preset');
  const vPatterns = viewBtn('patterns', 'Patterns', { below: 'View Lock' });
  const vMixer = viewBtn('mixer', 'Mixer');
  const vFx = viewBtn('fx', 'FX', { below: 'Side Chain', secondary: 'sidechain' });
  const vScales = viewBtn('scales', 'Scales');
  const vTempo = btn('view tempo', 'Tempo Swing', { above: 'Tap', title: 'Tempo and Swing (Shift: Tap tempo)', onclick: (e) => { const sh = isShift(e); useShift(); if (sh) { tapTempo(); if (st.view !== 'tempo') selectView('tempo'); } else selectView('tempo'); } });
  vTempo.dataset.view = 'tempo';
  const vProjects = btn('view half', 'Projects', { above: 'Packs', title: 'Projects (Shift or press again: Packs, not built yet)', onclick: () => { useShift(); selectView('projects'); } });
  vProjects.dataset.view = 'projects';
  const viewBtns = [vNote, vVel, vGate, vPat, vPreset, vPatterns, vMixer, vFx, vScales, vTempo, vProjects];
  // ▼ ▲: octave in Note view, page in Preset, Projects and Patterns views.
  const arrow = (dir) => btn('arrow half', dir < 0 ? '▼' : '▲', { title: dir < 0 ? 'Octave down, or the previous page' : 'Octave up, or the next page', onclick: () => { useShift(); stepPage(dir); } });
  const downBtn = arrow(-1), upBtn = arrow(1);
  const stepPageBtn = btn('steppage', '1-16 17-32', { title: '1-16 / 17-32: a pattern of 16 steps becomes 32 steps; then it shows steps 1-16 or 17-32. With Clear on: back to 16 steps. With Duplicate on: copy steps 1-16 to 17-32.', onclick: () => { useShift(); stepPagePress(); } });
  stepPageBtn.querySelector('.nm').replaceChildren(h('span', { class: 'p1', text: '1-16' }), ' ', h('span', { class: 'p2', text: '17-32' }));
  const clearBtn = btn('clear', 'Clear', { above: 'Click', title: 'Clear: turn it on, then press steps to clear them (notes or hits, and probability back to 100%). Press Clear again (or Esc) to stop. With 1-16/17-32: the pattern back to 16 steps.', onclick: (e) => {
    const sh = isShift(e); useShift();
    if (sh) { flash('Click (the click track) is not built yet.'); return; }
    setMode(st.mode === 'clear' ? null : 'clear');
  } });
  const copyBtn = btn('dup', 'Duplicate', { above: 'Mutate', title: 'Duplicate. Step views: turn it on, press the step to copy, then the steps to copy it to; press Duplicate again to stop. With 1-16/17-32: copy steps 1-16 to 17-32. Preset view: press it, then a pad, to copy the patch being edited there.', onclick: (e) => {
    const sh = isShift(e); useShift();
    if (sh) { flash('Mutate is not built yet.'); return; }
    if (presetKind() === 'synth') { st.copying = !st.copying; paint(); return; }
    if (STEP_VIEWS.includes(st.view) || st.view === 'mixer') setMode(st.mode === 'dup' ? null : 'dup');
  } });
  const saveBtn = btn('save half', 'Save', { title: 'Save: press once (it flashes), then again to save the project into the browser\'s copy of the pack (nothing is written to disk). In Projects view, press Save and then a pad to save to that project. Download pack writes a new pack file. Shift: Setup.', onclick: (e) => {
    const sh = isShift(e); useShift();
    if (sh) { flash('Setup is not built yet.'); return; }
    if (!pp?.loaded) { flash('Load a project in Projects view first.'); return; }
    if (!st.saveArm) { st.saveArm = true; paint(); return; }
    doSave(pp.entry.slot);
  } });
  const shiftBtn = btn('shift', 'Shift', { title: 'Shift: click to arm it for the next button or pad, or hold the computer\'s Shift key', onclick: () => { shift.on = !shift.on; paintShift(); } });
  const playBtn = btn('tbtn play', '▶', { title: 'Play or stop the project (Space). Choose a project first (Projects, or Project in the bottom bar).', onclick: () => { useShift(); pp?.toggle(); } });
  playBtn.setAttribute('aria-label', 'Play');
  const recBtn = btn('tbtn rec idle', '●', { below: 'Rec Quantise', title: 'Record (comes with step editing). Shift: Rec Quantise.', disabled: true });
  recBtn.setAttribute('aria-label', 'Record');
  let shownShift = false;
  function paintShift() {
    const on = shift.on || shift.held;
    shiftBtn.classList.toggle('on', on);
    root.classList.toggle('shifted', on);
    // Pattern Settings shows the start point while Shift is held, and Mixer view's scene pads turn
    // gold, as on the hardware.
    if (on !== shownShift && ['pattern', 'mixer'].includes(st.view) && !root.hidden) { shownShift = on; paint(); }
    shownShift = on;
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Shift' && !shift.held) { shift.held = true; paintShift(); } });
  document.addEventListener('keyup', (e) => { if (e.key === 'Shift') { shift.held = false; paintShift(); } });
  window.addEventListener('blur', () => { shift.held = false; paintShift(); });

  const lcd = h('p', { class: 'panel-lcd', role: 'status' });
  const hint = h('p', { class: 'panel-hint' });
  const revertBtn = h('button', { type: 'button', class: 'btn small', text: 'Revert', title: 'Put back the patch the pack had in this slot', onclick: () => api.revert() });
  const projRevertBtn = h('button', { type: 'button', class: 'btn small', text: 'Revert project', title: 'Drop the edits made since the project was last saved', onclick: () => { pp?.revert(); flash('Project back to its saved version.'); } });
  const rollBtn = h('button', { type: 'button', class: 'btn small rollbtn', title: 'Show the pattern as a piano roll (synth and MIDI tracks) or a drum grid (drum tracks) instead of the pads', onclick: () => {
    if (st.view === 'roll') { selectView('note'); return; }
    st.rollFocus = null;
    selectView('roll');
  } });
  const tools = h('div', { class: 'pad-tools' }, rollBtn, h('span', { class: 'grow' }), revertBtn, projRevertBtn);
  const grid = h('div', { class: 'pads', role: 'group', 'aria-label': 'Pads' });
  // The piano roll / drum grid, shown instead of the pads (roll.js).
  let lastGridH = 0;
  const LANE_PX = 124;   // the automation lane under the roll (roll.js): list, lane and gaps
  const roll = buildRoll({
    pp: () => pp, track: () => st.track,
    pattern: (t) => (st.rollFocus?.t === t ? st.rollFocus.p : viewPattern(t)?.index ?? null),
    velocity: () => velocity(), activeSample: (t) => activeSample(t), sampleName: (i) => api.sampleName(i),
    noteOn: (n, v) => api.noteOn(n, v), noteOff: (n) => api.noteOff(n), audition: (i, t) => api.audition(i, t),
    octave: () => api.octave(), scale: () => curScale(),
    status: (text) => { st.rollStatus = text; paintLcd(); }, flash: (text) => flash(text),
  });
  // Mixer view (User Guide pp. 88-89): under the pads, each track's level (a vertical fader) and
  // pan (a horizontal slider below it), as saved in the project; the macro knobs set the same
  // values (level, or pan after ▼). Double-click: level 100, pan centre.
  const panText = (v) => (v === 64 ? 'C' : v < 64 ? `L${64 - v}` : `R${v - 64}`);
  const levels = TRACKS.map((t, i) => {
    const input = h('input', { type: 'range', class: 'fader', min: 0, max: 127, value: 100, 'aria-label': `${t.label} level`, title: `${t.label} level (0-127; the Circuit Tracks' default is 100). Double-click for 100.` });
    const out = h('output', { text: '100' });
    const pan = h('input', { type: 'range', class: 'pan', min: 0, max: 127, value: 64, 'aria-label': `${t.label} pan`, title: `${t.label} pan (centre 64). Double-click for centre.` });
    const pout = h('output', { class: 'pout', text: 'C' });
    input.addEventListener('input', () => { pp?.setLevel(i, +input.value); out.textContent = input.value; });
    input.addEventListener('dblclick', () => { input.value = 100; pp?.setLevel(i, 100); out.textContent = '100'; });
    pan.addEventListener('input', () => { pp?.setPan(i, +pan.value); pout.textContent = panText(+pan.value); });
    pan.addEventListener('dblclick', () => { pan.value = 64; pp?.setPan(i, 64); pout.textContent = 'C'; });
    return { input, out, pan, pout, cell: h('div', { class: `lvl ${t.kind}`, 'data-track': i }, h('span', { text: t.label }), input, out, pan, pout) };
  });
  const mixbox = h('div', { class: 'mixbox', hidden: true }, levels.map((l) => l.cell));
  // FX view: under the pads, each track's reverb or delay send (whichever the macro knobs set: the
  // kind of preset pressed last, or the Reverb / Delay switch here). Double-click: 0.
  const sends = TRACKS.map((t, i) => {
    const input = h('input', { type: 'range', class: 'fader', min: 0, max: 127, value: 0, 'aria-label': `${t.label} send` });
    const out = h('output', { text: '0' });
    input.addEventListener('input', () => { pp?.setSend(i, st.fxMode, +input.value); out.textContent = input.value; });
    input.addEventListener('dblclick', () => { input.value = 0; pp?.setSend(i, st.fxMode, 0); out.textContent = '0'; });
    return { input, out, cell: h('div', { class: `lvl ${t.kind}`, 'data-track': i }, h('span', { text: t.label }), input, out) };
  });
  const sendKind = ['reverb', 'delay'].map((k) => h('button', { type: 'button', 'data-kind': k, text: k === 'reverb' ? 'Reverb sends' : 'Delay sends', title: `Show and set each track's ${k} send (the macro knobs follow)`, onclick: () => setFxMode(k) }));
  const sendbox = h('div', { class: 'sendbox', hidden: true }, h('div', { class: 'seg sendkind' }, sendKind), h('div', { class: 'faderbox' }, sends.map((x) => x.cell)));
  function setFxMode(k) {
    if (st.fxMode === k) return;
    st.fxMode = k;
    flash(`The macro knobs and faders set each track's ${k} send.`);
    paint();
  }
  function paintSends() {
    sendbox.dataset.kind = st.fxMode;
    sendKind.forEach((b) => { const on = b.dataset.kind === st.fxMode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    sends.forEach((x, i) => {
      const v = pp?.loaded ? pp.send(i, st.fxMode) : 0;
      x.input.value = v;
      x.out.textContent = v;
      x.input.disabled = !pp?.loaded;
      x.input.title = `${TRACKS[i].label} ${st.fxMode} send (0-127). Double-click for 0.${i === 2 || i === 3 ? ' Saved for the Circuit Tracks\' rear input; not heard in the browser.' : ''}`;
    });
  }
  // Tempo view: tempo and swing as the hardware's macros 1 and 2 would set them, and Tap.
  const bpm = h('input', { type: 'number', min: 40, max: 240, value: 120, 'aria-label': 'Tempo (BPM)' });
  const bpmRange = h('input', { type: 'range', min: 40, max: 240, value: 120, 'aria-label': 'Tempo' });
  const swing = h('input', { type: 'range', min: 20, max: 80, value: 50, 'aria-label': 'Swing' });
  const swingOut = h('output', { text: '50%' });
  const taps = [];
  const tap = h('button', { type: 'button', class: 'btn', text: 'Tap', title: 'Tap in time, at least three times, to set the tempo' });
  const setBpm = (v) => { pp?.setTempo(v); paintTempo(); };
  bpm.addEventListener('change', () => setBpm(+bpm.value || 120));
  bpmRange.addEventListener('input', () => setBpm(+bpmRange.value));
  swing.addEventListener('input', () => { pp?.setSwing(+swing.value); paintTempo(); });
  tap.addEventListener('click', () => tapTempo());
  function tapTempo() {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
    taps.push(now);
    if (taps.length > 5) taps.shift();
    if (taps.length >= 3) setBpm(60000 / ((taps[taps.length - 1] - taps[0]) / (taps.length - 1)));
  }
  const bigBpm = h('p', { class: 'bigbpm' });
  const tempobox = h('div', { class: 'tempobox', hidden: true }, bigBpm,
    h('label', { class: 'trow' }, h('span', { text: 'Tempo' }), bpmRange, bpm, tap),
    h('label', { class: 'trow' }, h('span', { text: 'Swing' }), swing, swingOut));
  function paintTempo() {
    const t = pp?.loaded ? pp.tempo : 120, sw = pp?.loaded ? pp.swing : 50;
    bigBpm.textContent = `${t} BPM`;
    if (document.activeElement !== bpm) bpm.value = t;
    bpmRange.value = t;
    swing.value = sw;
    swingOut.textContent = `${sw}%`;
    for (const el of [bpm, bpmRange, swing, tap]) el.disabled = !pp?.loaded;
  }
  for (let i = 0; i < 32; i++) {
    const pad = h('button', { type: 'button', class: 'pad', 'data-pad': i, tabindex: '-1' });
    st.pads.push(pad);
    grid.append(pad);
  }

  // Knobs: Master Volume, the eight macros (the editor's own macro knobs move in here while TRACKS
  // shows: see adoptMacros), Master Filter.
  const dial = (label, { value, min = 0, max = 127, centre = null, onInput, title }) => {
    const svg = h('span', { class: 'dial', role: 'slider', tabindex: 0, 'aria-label': label, 'aria-valuemin': min, 'aria-valuemax': max, title });
    const cell = h('div', { class: 'ct-dial' }, svg, h('span', { class: 'cap', text: label }));
    let v = value();
    const show = () => {
      const a = -135 + 270 * (v - min) / (max - min);
      svg.style.setProperty('--a', `${a}deg`);
      svg.setAttribute('aria-valuenow', v);
      svg.classList.toggle('centre', centre != null && v === centre);
    };
    const set = (x) => { v = Math.max(min, Math.min(max, Math.round(x))); show(); onInput(v); };
    svg.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      svg.setPointerCapture(e.pointerId);
      const y0 = e.clientY, v0 = v;
      const move = (ev) => set(v0 + (y0 - ev.clientY) * (max - min) / 160);
      const end = () => { svg.removeEventListener('pointermove', move); svg.removeEventListener('pointerup', end); };
      svg.addEventListener('pointermove', move);
      svg.addEventListener('pointerup', end);
    });
    svg.addEventListener('dblclick', () => set(centre ?? value()));
    svg.addEventListener('keydown', (e) => { const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key]; if (d) { e.preventDefault(); set(v + d * (e.shiftKey ? 10 : 1)); } });
    show();
    return { cell, refresh: () => { v = value(); show(); } };
  };
  const vol = dial('Master Volume', { value: () => api.volume?.() ?? 80, min: 0, max: 100, onInput: (v) => api.setVolume?.(v), title: 'Master Volume (the page volume). Drag up or down.' });
  const filt = dial('Master Filter', { value: () => pp?.masterFilter ?? 64, centre: 64, onInput: (v) => pp?.setMasterFilter(v), title: 'Master Filter for the project playing: left low-pass, right high-pass, centre off. Double-click for off.' });
  const macroSlot = h('div', { class: 'ct-macros', 'aria-label': 'Macros' });

  root.append(h('div', { class: 'ct' },
    h('div', { class: 'ct-knobs' }, vol.cell, macroSlot, filt.cell),
    h('div', { class: 'ct-body' },
      h('div', { class: 'c-l r1' }, vScales),
      h('div', { class: 'c-m r1 fnrow' }, h('span', { class: 'pair' }, downBtn, upBtn), stepPageBtn, vTempo, clearBtn, copyBtn, h('span', { class: 'pair' }, saveBtn, vProjects)),
      h('div', { class: 'c-r r1' }, shiftBtn),
      h('div', { class: 'c-l r2' }, vPreset),
      h('div', { class: 'c-m r2 tracks-row', role: 'group', 'aria-label': 'Tracks' }, trackBtns),
      h('div', { class: 'c-r r2' }, vPatterns),
      h('div', { class: 'c-l rg stepcol' }, vNote, vVel, vGate, vPat),
      h('div', { class: 'c-m rg padzone' }, grid, roll.el, tempobox),
      h('div', { class: 'c-r rg rightcol' }, vMixer, vFx, recBtn, playBtn),
      h('div', { class: 'c-m rs status' }, lcd, tools, mixbox, sendbox, hint))));

  // Pads: pointer down plays, up / leave releases. In Preset view a pad picks a patch (and plays
  // it at the keyboard's C while held) or a drum sample (and plays it).
  const down = new Map();   // pointerId -> note
  const hold = (e, pad, n) => {
    pad.setPointerCapture?.(e.pointerId);
    down.set(e.pointerId, n);
    pad.classList.add('down');
    api.noteOn(n);
  };
  grid.addEventListener('pointerdown', (e) => {
    const pad = e.target.closest('.pad');
    if (!pad) return;
    if (pad.dataset.slot != null) {
      e.preventDefault();
      const i = +pad.dataset.slot;
      if (st.copying) { st.copying = false; paint(); if (i !== api.slot()) api.copyTo(i); return; }
      if (i !== api.slot()) api.selectSlot(i);
      hold(e, pad, (api.octave() + 1) * 12);
      return;
    }
    if (pad.dataset.sample != null) {
      e.preventDefault();
      chooseSample(st.track, +pad.dataset.sample);
      api.audition(+pad.dataset.sample, st.track);
      paint();
      return;
    }
    // Drum Note view sample pads: a quick tap makes the sample the track's active sample (and plays
    // it); a longer press only plays it, and arms it for a sample flip (User Guide pp. 60-62).
    if (pad.dataset.dsample != null) {
      e.preventDefault();
      const slot = +pad.dataset.dsample, t = st.track, down = performance.now();
      api.audition(slot, t);
      pad.classList.add('down');
      const up = () => {
        pad.classList.remove('down');
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        if (st.stepFlip != null && pp?.loaded) {
          // A step armed by a long press takes this sample.
          const vp = viewPattern(t);
          if (vp) pp.flipStep(t, vp.index, st.stepFlip, slot, velocity(), { keep: true });
          flash(`Step ${st.stepFlip + 1} plays ${pad3(slot + 1)} ${api.sampleName(slot) || ''}.`);
          st.stepFlip = null;
          paint();
          return;
        }
        if (performance.now() - down < 500) {
          if (st.flip != null) { st.flip = null; paint(); return; }
          chooseSample(t, slot);
          paint();
        } else {
          st.flip = st.flip === slot ? null : slot;
          paint();
          if (st.flip != null) flash(`Sample flip: press steps to give them sample ${pad3(slot + 1)} ${api.sampleName(slot) || ''} (a step that already plays it loses its hit). Press the sample pad again or Esc to finish.`);
        }
      };
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
      return;
    }
    if (pad.dataset.project != null) {
      e.preventDefault();
      const i = +pad.dataset.project;
      if (st.saveArm) { doSave(i); return; }
      if (!api.projects?.()[i]?.empty) api.loadProject(i);
      return;
    }
    if (pad.dataset.step != null) {
      e.preventDefault();
      if (drumNote() && pp?.loaded && !st.mode && st.flip == null && viewPattern(st.track)) { drumStepHold(+pad.dataset.step); return; }
      stepPress(+pad.dataset.step, e);
      return;
    }
    if (pad.dataset.val != null) { e.preventDefault(); valuePress(+pad.dataset.val); return; }
    if (pad.dataset.keynote != null) { e.preventDefault(); setScale(+pad.dataset.keynote, null); return; }
    if (pad.dataset.scale != null) { e.preventDefault(); setScale(null, +pad.dataset.scale); return; }
    // Chains, as on the hardware: hold one pattern (or scene) pad and press another. Shift-click
    // too for patterns; for scenes Shift stores the scene, so ⌘/Alt-click chains them.
    if (pad.dataset.pattern != null) {
      e.preventDefault();
      const t = +pad.dataset.ptrack, pt = +pad.dataset.pattern;
      const held = st.held?.kind === 'pattern' && st.held.track === t;
      if (held) pp?.selectPattern(t, st.held.index, {}), pp?.selectPattern(t, pt, { extend: true });
      else pp?.selectPattern(t, pt, { extend: isShift(e) });
      useShift();
      if (!held) st.held = { kind: 'pattern', track: t, index: pt, id: e.pointerId };
      return;
    }
    if (pad.dataset.scene != null) {
      e.preventDefault();
      const i = +pad.dataset.scene;
      if (!pp?.loaded) return;
      // Shift + scene: store the patterns playing now and the mutes (User Guide p. 81; addendum p. 8).
      if (isShift(e)) {
        useShift();
        const muted = pp.mutes.map((m, t) => (m ? TRACKS[t].label : null)).filter(Boolean);
        pp.storeScene(i);
        flash(`Scene ${i + 1} stored: the patterns playing now${muted.length ? `, with ${muted.join(', ')} muted` : ', no tracks muted'}. Save keeps it.`);
        return;
      }
      if (st.mode === 'clear') { pp.clearScene(i); flash(`Scene ${i + 1} cleared: pattern 1 for every track, no mutes.`); return; }
      if (st.mode === 'dup') {
        if (st.dupSrc == null) { st.dupSrc = i; paint(); flash(`Copying scene ${i + 1}: press the scenes to copy it to. Duplicate again stops.`); return; }
        pp.copyScene(st.dupSrc, i);
        flash(st.dupSrc === i ? `That is scene ${i + 1} itself: press another scene to copy it to.` : `Scene ${st.dupSrc + 1} copied to scene ${i + 1}.`);
        return;
      }
      // Chains: hold one scene pad and press another (touch), or ⌘/Alt-click with a mouse.
      const held = st.held?.kind === 'scene';
      if (held) { pp.selectScene(st.held.index); pp.selectScene(i, { chain: true }); }
      else pp.selectScene(i, { chain: e.metaKey || e.altKey });
      if (!held) st.held = { kind: 'scene', index: i, id: e.pointerId };
      return;
    }
    if (pad.dataset.mute != null) { e.preventDefault(); const t = +pad.dataset.mute; pp?.setMute(t, !pp.mutes[t]); return; }
    if (pad.dataset.delay != null) { e.preventDefault(); const n = +pad.dataset.delay; pp?.setDelayPreset(n); st.fxMode = 'delay'; flash(`Delay ${n + 1}: ${DELAY_NAMES[n]}. The macro knobs are now delay sends.`); paint(); return; }
    if (pad.dataset.reverb != null) { e.preventDefault(); const n = +pad.dataset.reverb; pp?.setReverbPreset(n); st.fxMode = 'reverb'; flash(`Reverb ${n + 1}: ${REVERB_NAMES[n]}. The macro knobs are now reverb sends.`); paint(); return; }
    if (pad.dataset.fxon != null) { e.preventDefault(); pp?.setFxOn(!pp.fxOn); flash(pp?.fxOn ? 'FX on: reverb and delay are heard.' : 'FX off: reverb and delay are bypassed (the sends are kept).'); return; }
    if (pad.dataset.scsrc != null) { e.preventDefault(); const d = +pad.dataset.scsrc; pp?.setSidechainSource(st.scTrack, d); flash(`${TRACKS[st.scTrack].label} is ducked by Drum ${d + 1}.`); return; }
    if (pad.dataset.scpreset != null) { e.preventDefault(); const t = +pad.dataset.sctrack, n = +pad.dataset.scpreset; st.scTrack = t; pp?.setSidechainPreset(t, n); flash(n ? `${TRACKS[t].label}: side chain preset ${n}, triggered by Drum ${pp.sidechain(t).source + 1} (top row to change).` : `${TRACKS[t].label}: side chain off.`); paint(); return; }
    if (pad.dataset.recall != null) { e.preventDefault(); pp?.setMuteRecall(!pp.muteRecall); flash(`Mute Recall ${pp?.muteRecall ? 'on: scenes bring back the mutes saved with them' : 'off: scenes keep the current mutes'}.`); return; }
    if (pad.dataset.drumhit != null) { e.preventDefault(); api.audition(+pad.dataset.drumhit, st.track); pad.classList.add('down'); setTimeout(() => pad.classList.remove('down'), 120); return; }
    if (pad.dataset.note == null) return;
    e.preventDefault();
    const note = +pad.dataset.note;
    // A step chosen in Note view: the key adds that note to the step, or removes it.
    if (st.view === 'note' && st.armed && st.sel != null) {
      const vp = viewPattern(st.track);
      if (vp) {
        const r = pp.toggleNote(st.track, vp.index, st.sel, note, velocity());
        if (r === 'full') flash('A step holds up to 6 notes. Remove one first.');
        if (r === 'removed') return;
      }
    }
    if (TRACKS[st.track].kind === 'synth') hold(e, pad, note);
  });
  const up = (e) => {
    if (st.held?.id === e.pointerId) st.held = null;
    const n = down.get(e.pointerId);
    if (n == null) return;
    down.delete(e.pointerId);
    for (const p of st.pads) p.classList.remove('down');
    api.noteOff(n);
  };
  // Hovering a preset pad shows its name on the LCD.
  // Patterns view: double-click a pattern to edit it in the piano roll / drum grid (Patterns again
  // goes back).
  grid.addEventListener('dblclick', (e) => {
    const pad = e.target.closest('.pad');
    if (st.view !== 'patterns' || pad?.dataset.pattern == null || !pp?.loaded) return;
    const t = +pad.dataset.ptrack, p = +pad.dataset.pattern;
    st.rollFocus = { t, p };
    selectTrack(t);
    selectView('roll');
  });
  window.addEventListener('resize', () => { if (st.view === 'roll' && !root.hidden) roll.paint(true); });
  grid.addEventListener('pointerover', (e) => {
    const pad = e.target.closest('.pad');
    const k = pad?.dataset.slot ?? pad?.dataset.sample ?? (pad?.dataset.project != null ? `p${pad.dataset.project}` : pad?.dataset.dsample != null ? `d${pad.dataset.dsample}` : pad?.dataset.step != null && drumNote() ? `s${pad.dataset.step}` : null);
    if (k === st.hover) return;
    st.hover = k;
    paintLcd();
  });
  grid.addEventListener('pointerleave', () => { st.hover = null; paintLcd(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (st.copying || st.mode || st.saveArm || st.armed || st.flip != null || st.stepFlip != null) { st.copying = false; st.mode = null; st.dupSrc = null; st.saveArm = false; st.armed = false; st.flip = null; st.stepFlip = null; paint(); }
  });
  document.addEventListener('pointerup', (e) => { if (st.held?.id === e.pointerId) st.held = null; });
  grid.addEventListener('pointerup', up);
  grid.addEventListener('pointercancel', up);

  function selectTrack(i) {
    st.track = i;
    st.copying = false;
    st.armed = false;
    st.dupSrc = null;
    st.flip = null;
    st.stepFlip = null;
    if (TRACKS[i].kind === 'drum') st.dpage[i - 4] = Math.floor(activeSample(i) / 16);
    if (TRACKS[i].kind === 'synth' && i !== api.synth()) api.chooseSynth(i);
    paint();
  }
  function selectView(id) {
    st.view = id;
    st.copying = false;
    st.armed = false;
    st.flip = null;
    st.stepFlip = null;
    if (!STEP_VIEWS.includes(id)) { st.mode = null; st.dupSrc = null; }
    if (id === 'preset') followSlot();
    // Side Chain view opens on the MIDI page when a MIDI track is selected (User Guide p. 94).
    if (id === 'sidechain') { st.scPage = TRACKS[st.track].kind === 'midi' ? 1 : 0; st.scTrack = st.scPage * 2 + (st.track === 1 || st.track === 3 ? 1 : 0); }
    paint();
  }
  // Turn the synth tracks' preset page to the one holding the patch being edited.
  function followSlot() { st.lastSlot = api.slot(); st.page[0] = st.page[1] = Math.floor(st.lastSlot / 32); }
  const presetKind = () => (st.view !== 'preset' ? null : TRACKS[st.track].kind);
  const viewPaged = () => st.view === 'projects' || (st.view === 'patterns' && pp?.loaded);
  const drumNote = () => st.view === 'note' && TRACKS[st.track].kind === 'drum';
  const pageCount = () => (drumNote() ? Math.ceil(api.sampleCount() / 16) : viewPaged() ? 2 : presetKind() === 'synth' ? Math.ceil(api.slotCount() / 32) : presetKind() === 'drum' ? Math.ceil(api.sampleCount() / 32) : 0);
  const getPage = () => (drumNote() ? st.dpage[st.track - 4] : viewPaged() ? st.vpage[st.view] : st.page[st.track]);
  const setPage = (k) => { if (drumNote()) st.dpage[st.track - 4] = k; else if (viewPaged()) st.vpage[st.view] = k; else st.page[st.track] = k; };
  // A drum track's active sample: the loaded project's (it plays it), otherwise the panel's.
  const activeSample = (t) => (pp?.loaded ? pp.entry.project.defaultDrums[t - 4] : st.drum[t - 4]);
  function chooseSample(t, slot) {
    st.drum[t - 4] = slot;
    st.dpage[t - 4] = Math.floor(slot / 16);
    if (pp?.loaded) pp.setDrumSample(t, slot);
  }

  // ---- step editing
  // A short message in the status strip (it replaces the hint for a few seconds).
  function flash(text) {
    st.msg = text;
    clearTimeout(st.msgTimer);
    st.msgTimer = setTimeout(() => { st.msg = ''; paintHint(); }, 7000);
    paintHint();
  }
  function paintHint() { hint.textContent = st.msg || hint.dataset.text || ''; hint.classList.toggle('msg', !!st.msg); }
  function setHint(text) { hint.dataset.text = text; paintHint(); }
  function setMixMode(m) {
    if (st.mixMode === m) return;
    st.mixMode = m;
    flash(m === 'pan' ? 'The macro knobs pan each track (▲ for levels).' : 'The macro knobs set each track\'s level (▼ for pan).');
    paint();
  }
  // The macro knobs in Mixer view (read by the editor's macro strip): each track's level or pan.
  // With Clear on, turning a knob deletes that track's recorded level (or pan) movements in the
  // pattern it plays; in pan mode turning it clockwise puts the track back in the centre.
  function mixKnobs() {
    if (!pp?.loaded || root.hidden) return null;
    if (st.view === 'fx') return fxKnobs();
    if (st.view !== 'mixer') return null;
    const pan = st.mixMode === 'pan';
    const arr = () => (pan ? pp.pans : pp.levels);
    return {
      pan, mode: st.mixMode, name: pan ? 'pan' : 'level',
      def: pan ? 64 : 100,
      label: (k) => TRACKS[k].label,
      kind: (k) => TRACKS[k].kind,
      get: (k) => arr()[k],
      text: (v) => (pan ? panText(v) : String(v)),
      set: (k, v) => {
        if (st.mode === 'clear') {
          const p = viewPattern(k)?.index;
          if (pan && v > arr()[k]) { pp.setPan(k, 64); flash(`${TRACKS[k].label} back in the centre.`); return; }
          const gone = p != null && pp.clearMixAutomation(k, pan ? 'pan' : 'level', p);
          flash(gone ? `${TRACKS[k].label}: recorded ${pan ? 'pan' : 'level'} movements deleted from pattern ${p + 1}.` : `${TRACKS[k].label}: no recorded ${pan ? 'pan' : 'level'} movements in pattern ${p == null ? '-' : p + 1}.`);
          return;
        }
        if (pan) pp.setPan(k, v); else pp.setLevel(k, v);
      },
    };
  }
  // FX view's macro knobs: each track's reverb or delay send (the last preset pad pressed), lit
  // cream for reverb and peach for delay, brighter as the send rises (User Guide p. 91).
  function fxKnobs() {
    const kind = st.fxMode, key = `${kind}_send`;
    return {
      pan: false, mode: kind, name: `${kind} send`, def: 0,
      colour: (k, v) => `color-mix(in srgb, ${kind === 'reverb' ? '#f4e2b0' : '#ffab7a'} ${Math.round(20 + (v / 127) * 80)}%, #24242e)`,
      label: (k) => TRACKS[k].label,
      kind: (k) => TRACKS[k].kind,
      get: (k) => pp.send(k, kind),
      text: (v) => String(v),
      set: (k, v) => {
        if (st.mode === 'clear') {
          const p = viewPattern(k)?.index;
          const gone = p != null && pp.clearMixAutomation(k, key, p);
          flash(gone ? `${TRACKS[k].label}: recorded ${kind} send movements deleted from pattern ${p + 1}.` : `${TRACKS[k].label}: no recorded ${kind} send movements in pattern ${p == null ? '-' : p + 1}.`);
          return;
        }
        pp.setSend(k, kind, v);
      },
    };
  }
  function setMode(m) {
    st.mode = m;
    st.dupSrc = null;
    if (m) st.armed = false;
    paint();
  }
  const velocity = () => (st.fixedVel ? FIXED_VELOCITY : api.velocity?.() ?? 100);
  const pageBase = () => st.spage[st.track] * 16;
  // The pattern the step views show and edit, with its stored settings.
  function editTarget() {
    const vp = viewPattern(st.track);
    if (!vp) return null;
    return { t: st.track, p: vp.index, pat: vp.pat, set: pp.raw(st.track, vp.index).settings };
  }
  const isLong = (set) => set.playbackEnd > 15 || set.playbackStart > 15;
  // When stopped, a chosen synth step plays its notes (the hardware sounds them while held).
  function auditionStep(t, p, k) {
    if (pp.playing || TRACKS[t].kind !== 'synth') return;
    const notes = pp.stepNotes(t, p, k);
    for (const n of notes) api.noteOn(n.note, n.vel);
    if (notes.length) setTimeout(() => { for (const n of notes) api.noteOff(n.note); }, 280);
  }
  // Drum Note view, as on the hardware: holding a step lights its sample red on the sample pads
  // (turning to its page); a quick tap adds or removes the hit; a long press arms the step for a
  // sample flip (a sample pad then gives it that sample; the step again or Esc cancels).
  function drumStepHold(k) {
    const t = st.track, vp = viewPattern(t), down = performance.now();
    if (st.stepFlip === k) { st.stepFlip = null; paint(); return; }
    st.stepFlip = null;
    st.heldStep = k;
    const smp = pp.stepSample(t, vp.index, k);
    if (smp != null) st.dpage[t - 4] = Math.floor(smp / 16);
    paint();
    const up = () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      st.heldStep = null;
      if (performance.now() - down < 500) {
        const on = pp.toggleHit(t, vp.index, k, activeSample(t), velocity());
        if (on) api.audition(activeSample(t), t);
        paint();
      } else {
        st.stepFlip = k;
        paint();
        flash(`Step ${k + 1} is armed: tap a sample pad to give it that sample (▼ ▲ for other pages). Press the step again or Esc to cancel.`);
      }
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }
  function stepPress(k, e) {
    const tg = editTarget();
    if (!tg) { flash('Choose a project in Projects view first.'); return; }
    const { t, p } = tg, kind = TRACKS[t].kind;
    if (st.view === 'pattern') {
      if (isShift(e)) pp.setStart(t, p, k); else pp.setEnd(t, p, k);
      useShift();
      return;
    }
    if (st.mode === 'clear') { pp.clearStep(t, p, k); flash(`Step ${k + 1} cleared.`); return; }
    if (st.mode === 'dup') {
      if (st.dupSrc == null) { st.dupSrc = k; paint(); flash(`Copying step ${k + 1}: press the steps to copy it to. Duplicate again stops.`); return; }
      pp.copyStep(t, p, st.dupSrc, k);
      flash(`Step ${st.dupSrc + 1} copied to step ${k + 1}.`);
      return;
    }
    if (st.view === 'note') {
      if (kind === 'drum') {
        if (st.flip != null) { if (pp.flipStep(t, p, k, st.flip, velocity())) api.audition(st.flip, t); return; }
        const on = pp.toggleHit(t, p, k, activeSample(t), velocity());
        if (on) api.audition(activeSample(t), t);
        return;
      }
      if (st.armed && st.sel === k) { st.armed = false; paint(); return; }
      st.sel = k;
      st.armed = true;
      auditionStep(t, p, k);
      paint();
      return;
    }
    st.sel = k;
    auditionStep(t, p, k);
    paint();
  }
  // The bottom rows of Velocity (16-pad fader), Gate (16 steps), Probability (8 pads, row 3) and
  // Pattern Settings (sync rate on row 3, play order on pads 29-32).
  function valuePress(i) {
    const tg = editTarget();
    if (!tg) return;
    const { t, p } = tg;
    if (st.view === 'pattern') {
      if (i < 8) pp.setRate(t, p, 7 - i); else pp.setDirection(t, p, i - 12);
      return;
    }
    const k = st.sel;
    if (k == null) { flash('Choose a step first (top two rows).'); return; }
    if (microView()) { microPress(t, p, k, i); return; }
    if (!pp.stepHas(t, p, k)) { flash(`Step ${k + 1} has nothing on it, so it has no ${st.view}.`); return; }
    if (st.view === 'velocity') pp.setVelocity(t, p, k, i === 15 ? 127 : (i + 1) * 8);
    else if (st.view === 'gate') {
      // The highest lit pad again shortens the gate by a sixth of a step, back to whole after five.
      const g = pp.stepNotes(t, p, k)[0]?.gate ?? 0;
      let ng = (i + 1) * 6;
      if (g > i * 6 && g <= (i + 1) * 6) { ng = g - 1; if (ng <= i * 6) ng = (i + 1) * 6; }
      pp.setGate(t, p, k, ng);
    } else if (st.view === 'probability') pp.setProbability(t, p, k, i);
  }
  function microPress(t, p, k, i) {
    if (TRACKS[t].kind === 'drum') {
      if (i > 5) return;
      const mic = pp.toggleMicro(t, p, k, i, activeSample(t), velocity());
      if (mic[i]) api.audition(pp.stepSample(t, p, k), t);
      flash(mic.some(Boolean) ? `Step ${k + 1} plays on micro step${mic.filter(Boolean).length > 1 ? 's' : ''} ${mic.flatMap((on, m) => (on ? [m + 1] : [])).join(', ')}.` : `Step ${k + 1} is empty now.`);
      return;
    }
    const notes = pp.stepNotes(t, p, k);
    if (!notes.length) { flash(`Step ${k + 1} has no notes: add some in Note view first.`); return; }
    const sel = microSel({ t, p }, k, notes);
    if (i < 6) {
      pp.setNoteDelay(t, p, k, [...sel], i);
      flash(`${sel.size === notes.length ? `Step ${k + 1}'s notes start` : `${[...sel].map((j) => noteName(notes.find((n) => n.j === j).note)).join(' ')} ${sel.size > 1 ? 'start' : 'starts'}`} ${i ? `${i}/6 of a step late` : 'on the step'}.`);
    } else if (i === 7) {
      const on = !pp.stepTie(t, p, k);
      pp.setStepTie(t, p, k, on);
      flash(on ? `Step ${k + 1} is tied forward: set its gate to reach the next note.` : `Step ${k + 1} is no longer tied.`);
    } else if (i >= 8 && i < 8 + notes.length) {
      const n = notes[i - 8];
      if (shift.on || shift.held) {
        if (sel.has(n.j) && sel.size > 1) sel.delete(n.j); else sel.add(n.j);
        useShift();
      } else { sel.clear(); sel.add(n.j); }
      api.noteOn(n.note, n.vel);
      setTimeout(() => api.noteOff(n.note), 250);
      paint();
    }
  }
  function stepPagePress() {
    const tg = editTarget();
    if (!tg) { flash('Choose a project in Projects view first.'); return; }
    const { t, p, set } = tg;
    if (st.mode === 'clear') { pp.shortenPattern(t, p); st.spage[t] = 0; flash('The pattern is back to 16 steps. Steps 17-32 are kept for when it grows again.'); return; }
    if (st.mode === 'dup') { pp.doublePattern(t, p); flash('Steps 1-16 copied to 17-32: the pattern is 32 steps.'); return; }
    if (!isLong(set)) { pp.extendPattern(t, p); st.spage[t] = 0; flash('The pattern is 32 steps now. Press 1-16/17-32 again to see steps 17-32.'); return; }
    st.spage[t] ^= 1;
    st.armed = false;
    paint();
  }
  function doSave(slot) {
    const from = pp.entry.slot;
    const list = api.projects?.() ?? [];
    const over = slot !== from && !list[slot]?.empty;
    const e = pp.save(slot);
    st.saveArm = false;
    flash(`Saved "${e.name || 'project'}" ${slot === from ? `in project ${slot + 1}` : `to project ${slot + 1}${over ? ' (replacing what was there)' : ''}; project ${from + 1} stays as it was saved`}. It is saved in the browser's copy of the pack (kept between visits); nothing is written to disk until you Download pack.`);
    api.projectSaved?.(slot);
    paint();
  }

  // ▼ ▲ turn pages where a view has them (Preset, Projects, Patterns), otherwise the octave.
  function stepPage(dir) {
    const n = pageCount();
    if (n) { setPage(Math.max(0, Math.min(n - 1, getPage() + dir))); paint(); return; }
    if (st.view === 'roll') { roll.scrollOctave(dir); return; }
    // Mixer view: it opens on level; ▼ turns the macro knobs into pan controls, ▲ back to level.
    if (st.view === 'mixer') { setMixMode(dir < 0 ? 'pan' : 'level'); return; }
    // Side Chain view: ▼ the MIDI 1 / 2 page, ▲ back to Synth 1 / 2.
    if (st.view === 'sidechain') { const pg = dir < 0 ? 1 : 0; if (pg !== st.scPage) { st.scPage = pg; flash(pg ? 'Side chain for MIDI 1 and 2.' : 'Side chain for Synth 1 and 2.'); paint(); } return; }
    if (st.view === 'note' || st.view === 'expand') api.setOctave?.(api.octave() + dir);
  }
  function paintPages() {
    const n = pageCount();
    const paged = n > 0;
    if (paged) setPage(Math.min(getPage(), n - 1));
    const mixer = (st.view === 'mixer' || st.view === 'sidechain') && !!pp?.loaded;
    downBtn.classList.toggle('idle', !mixer && (paged ? getPage() === 0 : !['note', 'expand', 'roll'].includes(st.view) || api.octave() <= 0));
    upBtn.classList.toggle('idle', !mixer && (paged ? getPage() >= n - 1 : !['note', 'expand', 'roll'].includes(st.view) || api.octave() >= 6));
    const synth = presetKind() === 'synth';
    const stepView = STEP_VIEWS.includes(st.view);
    const projEdit = !!pp?.loaded && pp.edited && (stepView || ['projects', 'roll', 'mixer', 'fx', 'sidechain'].includes(st.view));
    const rollable = !!pp?.loaded && (st.view === 'note' || st.view === 'roll');
    tools.hidden = !synth && !projEdit && !rollable;
    rollBtn.hidden = !rollable;
    rollBtn.textContent = st.view === 'roll' ? 'Pads' : TRACKS[st.track].kind === 'drum' ? 'Drum grid' : 'Piano roll';
    revertBtn.hidden = !synth;
    projRevertBtn.hidden = !projEdit;
    copyBtn.classList.toggle('on', st.copying || st.mode === 'dup');
    copyBtn.classList.toggle('idle', !synth && !(stepView && pp?.loaded));
    clearBtn.classList.toggle('on', st.mode === 'clear');
    // Mixer view: the arrow that switches the knobs is lit (▼ in level mode, ▲ in pan mode).
    downBtn.classList.toggle('lit', (st.view === 'mixer' && st.mixMode !== 'pan') || (st.view === 'sidechain' && st.scPage === 0));
    upBtn.classList.toggle('lit', (st.view === 'mixer' && st.mixMode === 'pan') || (st.view === 'sidechain' && st.scPage === 1));
    api.mixKnobsChanged?.();
    clearBtn.classList.toggle('idle', !((stepView || st.view === 'mixer' || st.view === 'fx') && pp?.loaded));
    if (synth) revertBtn.disabled = !api.slotInfo(api.slot()).edited;
    // 1-16/17-32: dim for a pattern of 16 steps, otherwise it shows which half the grid shows.
    const tg = pp?.loaded ? editTarget() : null;
    const long = !!tg && isLong(tg.set);
    if (!long) st.spage[st.track] = 0;
    stepPageBtn.classList.toggle('idle', !tg || !stepView);
    stepPageBtn.dataset.page = long ? String(st.spage[st.track] + 1) : '';
    saveBtn.classList.toggle('idle', !pp?.loaded);
    saveBtn.classList.toggle('armed', st.saveArm);
    saveBtn.classList.toggle('edited', !!pp?.edited);
  }
  // Page text for the status strip.
  function pageText() {
    const n = pageCount();
    if (!n) return '';
    const k = getPage();
    return st.view === 'patterns' ? ` · patterns ${k * 4 + 1}–${k * 4 + 4}` : ` · ${k * 32 + 1}–${(k + 1) * 32}`;
  }

  function paintPresetPads() {
    const kind = presetKind();
    const base = st.page[st.track] * 32;
    const cur = kind === 'synth' ? api.slot() : activeSample(st.track);
    st.pads.forEach((p, k) => {
      const i = base + k;
      clearPad(p);
      let cls = 'pad preset';
      let name;
      if (kind === 'synth') {
        if (i >= api.slotCount()) { p.className = 'pad off'; p.textContent = ''; return; }
        const info = api.slotInfo(i);
        name = info.empty ? 'Initial Patch' : info.name || '(no name)';
        if (info.empty) cls += ' empty';
        if (info.edited) cls += ' edited';
        if (info.fetched) cls += ' fetched';
        p.dataset.slot = i;
      } else {
        if (i >= api.sampleCount()) { p.className = 'pad off'; p.textContent = ''; return; }
        name = api.sampleName(i);
        if (!name) cls += ' empty';
        p.dataset.sample = i;
      }
      if (i === cur) cls += ' lit';
      if (st.copying && i !== cur) cls += ' target';
      p.className = cls;
      p.textContent = String(i + 1);
      p.title = `${pad3(i + 1)} ${name || '(empty)'}`;
      p.setAttribute('aria-label', p.title);
      p.setAttribute('aria-pressed', String(i === cur));
    });
  }

  function paintLcd() {
    const t = TRACKS[st.track], v = VIEWS.find((x) => x.id === st.view);
    let text = `${t.label} · ${v.label}`;
    const kind = presetKind();
    if (kind === 'synth') {
      const i = st.hover != null ? +st.hover : api.slot();
      const info = api.slotInfo(i);
      text += ` · ${pad3(i + 1)} ${info.empty ? 'Initial Patch' : info.name || '(no name)'}`;
    } else if (kind === 'drum') {
      const i = st.hover != null ? +st.hover : activeSample(st.track);
      text += ` · ${pad3(i + 1)} ${api.sampleName(i) || '(empty)'}`;
    } else if (st.view === 'projects') {
      const list = api.projects?.() ?? [];
      const i = st.hover?.startsWith?.('p') ? +st.hover.slice(1) : pp?.loaded ? pp.entry.slot : null;
      text = `Projects${i != null ? ` · ${i + 1} ${list[i]?.empty ? '(empty)' : list[i]?.name || '(no name)'}` : ''}`;
    } else if (pp?.loaded && ['patterns', 'mixer', 'tempo'].includes(st.view)) {
      const sc = pp.custom ? 'patterns chosen here' : pp.sceneChain.end > pp.sceneChain.start ? `scenes ${pp.sceneChain.start + 1}–${pp.sceneChain.end + 1}` : `scene ${pp.scene + 1}`;
      text = `${v.label} · ${pp.entry.slot + 1} ${pp.song.name} · ${sc}${st.pos?.scene != null && pp.playing ? ` · playing scene ${st.pos.scene + 1}` : ''}`;
    }
    if (pp?.loaded && STEP_VIEWS.includes(st.view)) text += stepText();
    if (drumNote()) {
      // Which sample: the pad or step under the pointer, the step held or armed, else the track's.
      const vp = pp?.loaded ? viewPattern(st.track) : null;
      const hs = st.hover?.startsWith?.('s') ? +st.hover.slice(1) : st.heldStep ?? st.stepFlip;
      const nm = (i) => `${pad3(i + 1)} ${api.sampleName(i) || '(empty)'}`;
      if (st.hover?.startsWith?.('d')) text += ` · sample ${nm(+st.hover.slice(1))}`;
      else if (hs != null && vp) { const smp = pp.stepSample(st.track, vp.index, hs); text += ` · step ${hs + 1}: ${smp == null ? 'no hit' : `${nm(smp)}${smp !== activeSample(st.track) ? ' (its own sample)' : ''}`}`; }
      else text += ` · ${nm(activeSample(st.track))}`;
    }
    if (st.view === 'velocity' && st.fixedVel) text += ' · Fixed Velocity';
    if (pp?.loaded && pp.edited && (STEP_VIEWS.includes(st.view) || st.view === 'projects' || st.view === 'scales')) text += ' · edited, not saved';
    if (st.view === 'roll') {
      // "Piano roll" or "Drum grid", the pattern, and what is under the pointer.
      const drum = TRACKS[st.track].kind === 'drum';
      if (drum) text = text.replace('Piano roll', 'Drum grid');
      const pt = st.rollFocus?.t === st.track ? st.rollFocus.p : viewPattern(st.track)?.index;
      if (pp?.loaded && pt != null && !drum) text += ` · pattern ${pt + 1} · ${scaleText()}`;
      if (st.rollStatus) text += ` · ${st.rollStatus}`;
      if (pp?.loaded && pp.edited) text += ' · edited, not saved';
    }
    const keys = (st.view === 'note' || st.view === 'expand') && TRACKS[st.track].kind !== 'drum';
    if (st.view === 'scales') text += ` · ${scaleText()}`;
    lcd.textContent = text + (keys ? ` · octave C${api.octave()} · ${scaleText()}` : pageText());
  }

  // Note view's top two rows: the 16 steps of the pattern the track is playing (or the first of its
  // chain when stopped), lit where a step plays something; the play head moves along them.
  function viewPattern(track) {
    if (!pp?.loaded) return null;
    const p = st.pos?.tracks?.[track]?.pattern ?? pp.sel[track].start;
    return { index: p, pat: pp.song.tracks[track].patterns[p] };
  }
  // The top two rows of every step view: the steps on the page shown. Lit where a step plays
  // something; dark outside the pattern's start and end (dim red if something is stored there).
  function stepClass(k, vp, kind) {
    let cls = 'pad step';
    const step = vp?.pat?.steps[k];
    const has = !!step?.hits.length;
    if (vp && (k < vp.pat.start || k > vp.pat.end)) cls += ` outside${has ? ' has' : ''}`;
    else if (has) {
      cls += ` on ${kind}`;
      // Drum steps: pink where the hit has its own sample (a sample flip); red for the sample armed.
      if (kind === 'drum' && pp?.loaded) {
        const smp = pp.stepSample(st.track, vp.index, k);
        if (st.flip != null && smp === st.flip) cls += ' flipmark';
        else if (smp !== activeSample(st.track)) cls += ' flip';
      }
    }
    if (vp && st.view !== 'note' && st.view !== 'pattern' && st.sel === k) cls += ' sel';
    if (st.view === 'note' && st.armed && st.sel === k) cls += ' armed';
    if (kind === 'drum' && (st.heldStep === k || st.stepFlip === k)) cls += ' armed';
    if (st.mode === 'dup' && st.dupSrc === k) cls += ' src';
    return cls;
  }
  // The scale the keyboard follows: the loaded project's (saved with it), otherwise Chromatic.
  const curScale = () => (pp?.loaded ? { root: pp.root, type: pp.scaleType } : st.scale);
  // The note of a keyboard pad (rows counted from the top, 0-3), or null for a dark pad. Chromatic:
  // a one-octave piano (white keys on the bottom row), two octaves in Expanded Note view. Other
  // scales: eight scale notes a row from the root, each row starting on the last note of the row
  // below (User Guide pp. 25-28), two rows or four in Expanded Note view.
  function keyNote(row, col, oct, sc) {
    if (sc.type === CHROMATIC) {
      const semi = row % 2 ? WHITE[col] : BLACK[col];
      return semi == null ? null : (oct + 1 + (row < 2 ? 1 : 0)) * 12 + semi;
    }
    const deg = (3 - row) * 7 + col;
    return degreeNote((oct + 1) * 12 + sc.root, deg, sc.type);
  }
  function paintPads() {
    const kind = TRACKS[st.track].kind;
    const synthTrack = kind === 'synth';
    const keyTrack = kind === 'synth' || kind === 'midi';
    const oct = api.octave();
    const vp = st.view === 'note' ? viewPattern(st.track) : null;
    const drumSample = kind === 'drum' ? activeSample(st.track) : null;
    const base = pageBase();
    // The chosen step's notes light their keys (in the octave shown).
    const inStep = new Set(vp && st.armed && st.sel != null && keyTrack ? pp.stepNotes(st.track, vp.index, st.sel).map((n) => n.note) : []);
    st.pads.forEach((p, i) => {
      const row = Math.floor(i / 8), col = i % 8;
      let note = null, cls = 'pad', label = '';
      delete p.dataset.drumhit; delete p.dataset.dsample; delete p.dataset.project; delete p.dataset.pattern; delete p.dataset.ptrack; delete p.dataset.scene; delete p.dataset.mute; delete p.dataset.recall; delete p.dataset.delay; delete p.dataset.reverb; delete p.dataset.fxon; delete p.dataset.scsrc; delete p.dataset.scpreset; delete p.dataset.sctrack; p.style.removeProperty('--c'); delete p.dataset.val;
      const expand = st.view === 'expand';
      if (st.view === 'note' && row < 2) {
        const k = base + row * 8 + col;
        cls = stepClass(k, vp, kind);
        p.dataset.step = k;
        if (vp) label = String(k + 1);
      } else if ((st.view === 'note' || expand) && kind === 'drum') {
        if (expand) cls += ' off';
        else {
          // 16 of the 64 samples (▼ ▲ for the other pages), in the track's colour; the active one bright.
          const slot = st.dpage[st.track - 4] * 16 + (row - 2) * 8 + col;
          if (slot < api.sampleCount()) {
            const showStep = st.heldStep ?? st.stepFlip;
            const stepSmp = showStep != null && vp ? pp.stepSample(st.track, vp.index, showStep) : null;
            cls += ` dsample t${st.track - 3}${slot === drumSample ? ' lit' : ''}${st.flip === slot || stepSmp === slot ? ' flipsrc' : ''}${api.sampleName(slot) ? '' : ' empty'}`;
            p.dataset.dsample = slot;
            label = String(slot + 1);
            p.title = `${pad3(slot + 1)} ${api.sampleName(slot) || '(empty)'}`;
          } else cls += ' off';
        }
      } else if ((st.view === 'note' || expand) && keyTrack) {
        const sc = curScale();
        note = keyNote(row, col, oct, sc);
        if (note != null && note >= 0 && note <= 127) {
          const chrom = sc.type === CHROMATIC;
          cls += chrom ? (row % 2 ? ' key white' : ' key black') : ' key scale';
          const isRoot = (((note - sc.root) % 12) + 12) % 12 === 0;
          if (isRoot) cls += ' root';
          if (isRoot || !chrom) label = noteName(note);
          if (inStep.has(note)) cls += ' instep';
          if (!synthTrack && !st.armed) cls += ' mute';
        } else { note = null; cls += ' off'; }
      } else cls += ' off';
      if (!(st.view === 'note' && row < 2)) delete p.dataset.step;
      p.className = cls;
      p.textContent = label;
      delete p.dataset.slot; delete p.dataset.sample; p.removeAttribute('aria-pressed');
      if (p.dataset.dsample == null) p.removeAttribute('title');
      if (note == null) { delete p.dataset.note; p.removeAttribute('aria-label'); p.tabIndex = -1; }
      else { p.dataset.note = note; p.setAttribute('aria-label', noteName(note)); }
      if (p.dataset.step != null) p.setAttribute('aria-label', `Step ${+p.dataset.step + 1}`);
    });
  }

  // Scales view (User Guide pp. 30-32): rows 1-2 choose the root as a one-octave piano (pads 1, 4,
  // 8 and 16 dark), bright where the note is in the scale; rows 3-4 the 16 scales, in the order of
  // the stored scale type.
  function paintScales() {
    const sc = curScale();
    st.pads.forEach((p, i) => {
      clearPad(p);
      delete p.dataset.keynote; delete p.dataset.scale;
      const row = Math.floor(i / 8), col = i % 8;
      if (row < 2) {
        const semi = row === 1 ? (col < 7 ? WHITE[col] : null) : BLACK[col];
        if (semi == null) { p.className = 'pad off'; return; }
        const inSc = inScale(semi - sc.root, sc.type);
        p.className = `pad keynote${inSc ? ' on' : ''}${semi === sc.root ? ' root' : ''}`;
        p.textContent = ROOT_NAMES[semi];
        p.dataset.keynote = semi;
        p.title = `Root ${ROOT_NAMES[semi]}${semi === sc.root ? ' (chosen)' : ''}`;
      } else {
        const t = (row - 2) * 8 + col;
        p.className = `pad scale${t === sc.type ? ' sel' : ''}`;
        p.textContent = SCALES[t].name;
        p.dataset.scale = t;
        p.title = `${SCALES[t].name}: ${SCALES[t].steps.map((x) => ROOT_NAMES[(x + sc.root) % 12]).join(' ')}`;
      }
      p.setAttribute('aria-label', p.title);
    });
  }
  function setScale(root, type) {
    if (pp?.loaded) { pp.setScale(root, type); return; }
    if (root != null) st.scale.root = root;
    if (type != null) st.scale.type = type;
    paint();
  }
  const scaleText = () => { const sc = curScale(); return `${sc.type === CHROMATIC && sc.root === 0 ? '' : `${ROOT_NAMES[sc.root]} `}${SCALES[sc.type].name}`; };

  // Micro Step view; on a drum track Gate view is its Micro Step view, as on the hardware (p. 66).
  const microView = () => st.view === 'micro' || (st.view === 'gate' && TRACKS[st.track].kind === 'drum');
  // The notes chosen in Micro Step view (all of the step's notes until some are chosen).
  function microSel(tg, k, notes) {
    const key = `${tg.t}:${tg.p}:${k}`;
    if (st.microSel?.key !== key) st.microSel = { key, js: new Set(notes.map((n) => n.j)) };
    for (const j of [...st.microSel.js]) if (!notes.some((n) => n.j === j)) st.microSel.js.delete(j);
    if (!st.microSel.js.size) for (const n of notes) st.microSel.js.add(n.j);
    return st.microSel.js;
  }

  // Velocity, Gate, Probability and Pattern Settings views: steps on the top rows, the chosen
  // step's value (or the pattern's settings) on the bottom rows.
  function paintStepView() {
    const kind = TRACKS[st.track].kind;
    const vp = viewPattern(st.track);
    const tg = vp ? editTarget() : null;
    const base = pageBase();
    if (tg && (st.sel == null || st.sel < base || st.sel >= base + 16)) {
      st.sel = null;
      // Start on the first step on this page that has something on it.
      for (let k = base; k < base + 16; k++) if (pp.stepHas(tg.t, tg.p, k)) { st.sel = k; break; }
      st.sel ??= base;
    }
    const k = st.sel;
    const has = tg && k != null && pp.stepHas(tg.t, tg.p, k);
    const notes = has && kind !== 'drum' ? pp.stepNotes(tg.t, tg.p, k) : [];
    const raw = has ? pp.raw(tg.t, tg.p).steps[k] : null;
    const shiftOn = shift.on || shift.held;
    st.pads.forEach((p, i) => {
      clearPad(p);
      delete p.dataset.val;
      const row = Math.floor(i / 8), col = i % 8;
      if (row < 2) {
        const sk = base + row * 8 + col;
        let cls = stepClass(sk, vp, kind);
        if (st.view === 'pattern' && tg && sk === (shiftOn ? tg.set.playbackStart : tg.set.playbackEnd)) cls += ' endpt';
        p.className = cls;
        if (vp) { p.dataset.step = sk; p.textContent = String(sk + 1); p.setAttribute('aria-label', `Step ${sk + 1}`); }
        return;
      }
      if (!tg) { p.className = 'pad off'; return; }
      const v = (row - 2) * 8 + col;   // 0-15 on the bottom two rows
      let cls = 'pad lvl';
      if (microView()) {
        // Micro Step (User Guide pp. 48-51, 66): pads 17-22 the six micro steps. Drums: each one
        // a hit, on or off. Synth / MIDI: pads 25-30 the step's notes (chosen bright), pads 17-22
        // where the chosen notes start, pad 24 tie forward.
        if (v < 6) {
          // All six dimly lit; bright where the step (drums) or the chosen notes play.
          if (kind === 'drum') cls += has && pp.stepMicro(tg.t, tg.p, k)[v] ? ' on' : ' dim';
          else {
            const sel = microSel(tg, k, notes);
            if (notes.some((n) => sel.has(n.j) && n.delay % 6 === v)) cls += ' on';
            else if (notes.some((n) => n.delay % 6 === v)) cls += ' mid';
            else cls += ' dim';
          }
          cls += ' micro';
          p.textContent = String(v + 1);
          p.title = v ? `Micro step ${v + 1}: ${v}/6 of a step late` : 'Micro step 1: on the step';
        } else if (kind !== 'drum' && v === 7) {
          if (!has) { p.className = 'pad off'; return; }
          cls = `pad tie${pp.stepTie(tg.t, tg.p, k) ? ' on' : ''}`;
          p.textContent = '⌒';
          p.title = 'Tie forward: the step\'s notes carry on into the same notes on the next step (set the gate to reach it)';
        } else if (kind !== 'drum' && v >= 8 && v < 8 + notes.length) {
          const n = notes[v - 8];
          cls = `pad noteslot${microSel(tg, k, notes).has(n.j) ? ' on' : ' dim'}`;
          p.textContent = noteName(n.note);
          p.title = `${noteName(n.note)}, micro step ${n.delay % 6 + 1}: click to choose it (Shift-click to add or remove it)`;
        } else { p.className = 'pad off'; return; }
        p.className = cls;
        p.dataset.val = v;
        p.setAttribute('aria-label', p.title);
        return;
      }
      if (st.view === 'velocity') {
        const vels = kind === 'drum' ? (has ? [raw.velocity] : []) : notes.map((n) => n.vel);
        if (vels.length) {
          const full = (x) => (x >= 127 ? 16 : Math.floor(x / 8));
          const lo = Math.min(...vels), hi = Math.max(...vels);
          if (v < full(lo)) cls += ' on';
          else if (v < Math.ceil(hi / 8)) cls += ' dim';
        }
        p.title = `Velocity ${v === 15 ? 127 : (v + 1) * 8}`;
      } else if (st.view === 'gate') {
        if (kind === 'drum') { p.className = 'pad off'; return; }
        const g = notes[0]?.gate ?? 0;
        const full = Math.floor(g / 6);
        if (v < full) cls += ' on';
        else if (v === full && g % 6) { cls += ' part'; p.style.setProperty('--part', String((g % 6) / 6)); }
        p.title = `Gate ${v + 1} step${v ? 's' : ''}`;
      } else if (st.view === 'probability') {
        if (row !== 2) { p.className = 'pad off'; return; }
        const pr = has ? raw.probability : -1;
        if (v <= pr) cls += ` on prob p${v}`;
        p.title = `Probability ${((v + 1) * 12.5).toString().replace('.0', '')}%`;
      } else if (st.view === 'pattern') {
        if (row === 2) {
          cls = `pad rate${tg.set.syncRate === 7 - col ? ' sel' : ''}`;
          p.textContent = RATE_PADS[col];
          p.title = `Sync rate ${RATE_PADS[col]}${col === 4 ? ' (default)' : ''}`;
        } else if (col >= 4) {
          cls = `pad dir${tg.set.direction === col - 4 ? ' sel' : ''}`;
          p.textContent = ['▶', '◀', '◀▶', '?'][col - 4];
          p.title = `Play order: ${DIRECTIONS[col - 4]}`;
        } else { p.className = 'pad off'; return; }
        p.dataset.val = row === 2 ? col : 8 + col;
        p.className = cls;
        p.setAttribute('aria-label', p.title);
        return;
      } else { p.className = 'pad off'; return; }
      p.className = cls;
      p.dataset.val = v;
      p.setAttribute('aria-label', p.title);
    });
  }
  // What the chosen step holds, for the status strip.
  function stepText() {
    const tg = editTarget();
    if (!tg) return '';
    const { t, p, set } = tg;
    let text = ` · pattern ${p + 1}${isLong(set) ? ` · steps ${st.spage[t] ? '17-32' : '1-16'}` : ''}`;
    if (st.view === 'pattern') {
      return `${text} · steps ${set.playbackStart + 1}-${set.playbackEnd + 1} · ${RATE_PADS[7 - set.syncRate] ?? '?'} · ${DIRECTIONS[set.direction] ?? '?'}`;
    }
    const k = st.sel;
    if (k == null || (st.view === 'note' && !st.armed)) return text;
    text += ` · step ${k + 1}`;
    if (!pp.stepHas(t, p, k)) return `${text} (empty)`;
    const raw = pp.raw(t, p).steps[k];
    const notes = TRACKS[t].kind === 'drum' ? [] : pp.stepNotes(t, p, k);
    if (st.view === 'note') return `${text}: ${notes.map((n) => noteName(n.note)).join(' ')}`;
    if (st.view === 'velocity') {
      const vels = TRACKS[t].kind === 'drum' ? [raw.velocity] : notes.map((n) => n.vel);
      const lo = Math.min(...vels), hi = Math.max(...vels);
      return `${text} · velocity ${lo === hi ? lo : `${lo}-${hi}`}`;
    }
    if (st.view === 'gate' && notes.length) {
      const g = notes[0].gate;
      return `${text} · gate ${Math.floor(g / 6)}${g % 6 ? ` ${g % 6}/6` : ''} step${g === 6 ? '' : 's'}${notes[0].tie ? ' (tied on)' : ''}`;
    }
    if (st.view === 'probability') return `${text} · probability ${((raw.probability + 1) * 12.5).toString()}%`;
    if (microView()) {
      if (TRACKS[t].kind === 'drum') return `${text} · micro steps ${pp.stepMicro(t, p, k).flatMap((on, m) => (on ? [m + 1] : [])).join(', ')}`;
      return `${text}: ${notes.map((n) => `${noteName(n.note)}${n.delay % 6 ? ` +${n.delay % 6}/6` : ''}`).join(' ')}${pp.stepTie(t, p, k) ? ' · tied' : ''}`;
    }
    return text;
  }

  const clearPad = (p) => { for (const k of ['note', 'slot', 'sample', 'step', 'drumhit', 'project', 'pattern', 'ptrack', 'scene', 'mute', 'recall', 'delay', 'reverb', 'fxon', 'scsrc', 'scpreset', 'sctrack']) delete p.dataset[k]; p.style.removeProperty('--c'); p.removeAttribute('title'); p.removeAttribute('aria-pressed'); p.removeAttribute('aria-label'); p.textContent = ''; };

  // Projects view: the pack's 64 project slots as two pages; the lit pad is the project loaded.
  function paintProjects() {
    const list = api.projects?.() ?? [];
    const base = st.vpage.projects * 32;
    st.pads.forEach((p, k) => {
      clearPad(p);
      const i = base + k, e = list[i];
      const cur = pp?.loaded && pp.entry.slot === i;
      const saved = pp?.pack?.savedProjects?.has(i);
      p.className = `pad project${e && !e.empty ? ' filled' : ' empty'}${cur ? ' lit' : ''}${cur && pp.playing ? ' playing' : ''}${e?.edited ? ' edited' : ''}${saved ? ' saved' : ''}${st.saveArm ? ' target' : ''}`;
      p.textContent = String(i + 1);
      if ((e && !e.empty) || st.saveArm) p.dataset.project = i;
      p.title = `Project ${i + 1}: ${!e || e.empty ? '(empty)' : e.name || '(no name)'}`;
      p.setAttribute('aria-label', p.title);
      p.setAttribute('aria-pressed', String(!!cur));
    });
  }

  // Patterns view: one column per track, patterns 1-4 (page 1) or 5-8 (page 2) down the rows.
  function paintPatterns() {
    const base = st.vpage.patterns * 4;
    st.pads.forEach((p, k) => {
      clearPad(p);
      const row = Math.floor(k / 8), t = k % 8, pat = base + row;
      if (!pp?.loaded) { p.className = 'pad off'; return; }
      const c = pp.sel[t];
      const sel = pat >= c.start && pat <= c.end;
      const now = pp.playing && st.pos?.tracks?.[t]?.pattern === pat;
      p.className = `pad pattern ${TRACKS[t].kind}${pp.patternHasNotes(t, pat) ? ' has' : ''}${sel ? ' sel' : ''}${now ? ' now' : ''}`;
      p.dataset.pattern = pat;
      p.dataset.ptrack = t;
      p.textContent = String(pat + 1);
      p.title = `${TRACKS[t].label} pattern ${pat + 1}${pp.patternHasNotes(t, pat) ? '' : ' (empty)'}. Click to play it; Shift-click to chain from the first selected pattern.`;
      p.setAttribute('aria-label', p.title);
      p.setAttribute('aria-pressed', String(sel));
    });
  }

  // Mixer view: row 1 mutes each track; pad 9 (row 2, first pad) is Mute Recall (firmware 1.2:
  // bright white = scenes recall the mutes saved with them); rows 3-4 are the 16 scenes (click to
  // select, hold and press another or ⌘/Alt-click to chain; Shift-click stores, Clear clears,
  // Duplicate copies).
  function paintMixer() {
    st.pads.forEach((p, k) => {
      clearPad(p);
      const row = Math.floor(k / 8), col = k % 8;
      if (!pp?.loaded) { p.className = 'pad off'; return; }
      if (row === 0) {
        const muted = pp.mutes[col];
        p.className = `pad mute ${TRACKS[col].kind}${muted ? ' muted' : ''}`;
        p.dataset.mute = col;
        p.textContent = muted ? 'Muted' : TRACKS[col].label.replace('Synth ', 'S').replace('MIDI ', 'M').replace('Drum ', 'D');
        p.title = `${TRACKS[col].label}: ${muted ? 'muted, click to unmute' : 'click to mute'}`;
        p.setAttribute('aria-pressed', String(muted));
      } else if (row === 1 && col === 0) {
        const on = pp.muteRecall;
        p.className = `pad recall${on ? ' on' : ''}`;
        p.dataset.recall = '1';
        p.textContent = 'Mute recall';
        p.title = `Mute Recall ${on ? 'on: each scene brings back the mutes saved with it (click to turn off)' : 'off: scenes keep the current mutes (click to turn on)'}`;
        p.setAttribute('aria-pressed', String(on));
      } else if (row >= 2) {
        const i = (row - 2) * 8 + col;
        const inChain = !pp.custom && i >= pp.sceneChain.start && i <= pp.sceneChain.end;
        const now = pp.playing && st.pos?.scene === i;
        // Shift held: the scene pads turn gold (stored ones bright), ready to store (User Guide p. 81).
        const storing = shift.on || shift.held;
        p.className = `pad scene${pp.sceneStored(i) ? ' stored' : ''}${inChain ? ' chain' : ''}${!pp.custom && i === pp.scene ? ' sel' : ''}${now ? ' now' : ''}${storing ? ' storing' : ''}${st.mode === 'dup' && st.dupSrc === i ? ' src' : ''}`;
        p.dataset.scene = i;
        p.textContent = String(i + 1);
        p.title = storing ? `Scene ${i + 1}: click to store the patterns playing now and the current mutes here${pp.sceneStored(i) ? ' (replaces what is stored)' : ''}.`
          : st.mode === 'clear' ? `Scene ${i + 1}: click to clear it (pattern 1 for every track, no mutes).`
          : st.mode === 'dup' ? (st.dupSrc == null ? `Scene ${i + 1}: click to copy it.` : `Scene ${i + 1}: click to copy scene ${st.dupSrc + 1} here.`)
          : `Scene ${i + 1}${pp.sceneStored(i) ? '' : ' (not saved in the project: plays pattern 1 of each track)'}. Click to play it; hold it and press another (or ⌘/Alt-click) to chain scenes; Shift-click to store.`;
        p.setAttribute('aria-pressed', String(inChain));
      } else p.className = 'pad off';
      p.setAttribute('aria-label', p.title || '');
    });
    levels.forEach((l, i) => {
      const v = pp?.levels?.[i] ?? 100, pn = pp?.pans?.[i] ?? 64;
      l.input.value = v;
      l.out.textContent = v;
      l.pan.value = pn;
      l.pout.textContent = panText(pn);
      l.input.disabled = l.pan.disabled = !pp?.loaded;
    });
    mixbox.dataset.mode = st.mixMode;
  }

  // FX view (User Guide pp. 90-92): rows 1-2 the 16 delay presets, row 3 the 8 reverb presets (the
  // project's preset bright), pad 25 FX on / off.
  function paintFx() {
    paintSends();
    st.pads.forEach((p, k) => {
      clearPad(p);
      const row = Math.floor(k / 8), col = k % 8;
      if (!pp?.loaded) { p.className = 'pad off'; return; }
      if (row < 2) {
        const on = pp.delayPreset === k;
        p.className = `pad fxp delay${on ? ' on' : ''}`;
        p.dataset.delay = k;
        p.textContent = String(k + 1);
        p.title = `Delay ${k + 1}: ${DELAY_NAMES[k]}${on ? ' (the project\'s delay)' : ''}`;
        p.setAttribute('aria-pressed', String(on));
      } else if (row === 2) {
        const on = pp.reverbPreset === col;
        p.className = `pad fxp reverb${on ? ' on' : ''}`;
        p.dataset.reverb = col;
        p.textContent = String(col + 1);
        p.title = `Reverb ${col + 1}: ${REVERB_NAMES[col]}${on ? ' (the project\'s reverb)' : ''}`;
        p.setAttribute('aria-pressed', String(on));
      } else if (col === 0) {
        const on = pp.fxOn;
        p.className = `pad fxon${on ? ' on' : ''}`;
        p.dataset.fxon = '1';
        p.textContent = on ? 'FX on' : 'FX off';
        p.title = on ? 'FX on: click to bypass reverb and delay' : 'FX off (bypassed): click to turn them back on';
        p.setAttribute('aria-pressed', String(on));
      } else p.className = 'pad off';
      p.setAttribute('aria-label', p.title || '');
    });
  }
  // Side Chain view (User Guide pp. 93-94): page 1 Synth 1 / 2, page 2 MIDI 1 / 2 (▼ ▲). Rows 3 and
  // 4: each track's Off pad and presets 1-7; pads 5-8 choose the drum that ducks the track whose
  // preset was pressed last.
  const TRACK_C = ['var(--s1)', 'var(--s2)', 'var(--midi)', 'var(--midi)'];
  function paintSidechain() {
    const base = st.scPage * 2;
    if (st.scTrack < base || st.scTrack > base + 1) st.scTrack = base;
    st.pads.forEach((p, k) => {
      clearPad(p);
      const row = Math.floor(k / 8), col = k % 8;
      if (!pp?.loaded) { p.className = 'pad off'; return; }
      if (row === 0 && col >= 4) {
        const d = col - 4, sc = pp.sidechain(st.scTrack), on = sc.source === d;
        p.className = `pad scsrc drum${on ? ' on' : ''}${sc.preset ? '' : ' idle'}`;
        p.dataset.scsrc = d;
        p.textContent = `Drum ${d + 1}`;
        p.title = `Drum ${d + 1}${on ? ' ducks' : ': click to make it duck'} ${TRACKS[st.scTrack].label}${sc.preset ? '' : ' (its side chain is off)'}`;
        p.setAttribute('aria-pressed', String(on));
      } else if (row >= 2) {
        const t = base + row - 2, sc = pp.sidechain(t), on = sc.preset === col;
        p.dataset.sctrack = t;
        p.dataset.scpreset = col;
        p.style.setProperty('--c', TRACK_C[t]);
        if (col === 0) {
          p.className = `pad scoff${on ? ' on' : ''}`;
          p.textContent = 'Off';
          p.title = `${TRACKS[t].label}: side chain ${on ? 'off' : 'on: click to turn it off'}`;
        } else {
          p.className = `pad scp${on ? ' on' : ''}${t === st.scTrack ? ' chosen' : ''}`;
          p.textContent = String(col);
          p.title = `${TRACKS[t].label}: side chain preset ${col}${on ? ` (on, from Drum ${sc.source + 1})` : ''}`;
        }
        p.setAttribute('aria-pressed', String(on));
      } else p.className = 'pad off';
      p.setAttribute('aria-label', p.title || '');
    });
  }

  function paint() {
    st.track = TRACKS[st.track].kind === 'synth' ? api.synth() : st.track;
    playBtn.classList.toggle('idle', !pp?.loaded);
    playBtn.classList.toggle('on', !!pp?.playing);
    playBtn.querySelector('.nm').textContent = pp?.playing ? '■' : '▶';
    playBtn.setAttribute('aria-label', pp?.playing ? 'Stop' : 'Play');
    mixbox.hidden = st.view !== 'mixer';
    sendbox.hidden = st.view !== 'fx';
    tempobox.hidden = st.view !== 'tempo';
    if (!grid.hidden && grid.offsetHeight) lastGridH = grid.offsetHeight;
    grid.hidden = st.view === 'tempo' || st.view === 'roll';
    roll.el.hidden = st.view !== 'roll';
    if (st.view === 'roll') roll.el.style.height = `${(lastGridH || 330) + LANE_PX}px`;   // the pads' height, plus the automation lane under the roll
    trackBtns.forEach((b, i) => { const on = i === st.track; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    viewBtns.forEach((b) => { const on = b.dataset.view === st.view || b.dataset.secondary === st.view; b.classList.toggle('on', on); b.classList.toggle('second', b.dataset.secondary === st.view); b.setAttribute('aria-pressed', String(on)); });
    vol.refresh();
    filt.refresh();
    const t = TRACKS[st.track], v = VIEWS.find((x) => x.id === st.view);
    root.dataset.track = t.kind;
    root.dataset.copying = st.copying ? 'yes' : 'no';
    paintLcd();
    paintPages();
    if (v.id === 'preset') {
      if (t.kind === 'synth') setHint(st.copying
        ? 'Press the pad to copy the patch being edited onto. Duplicate again or Esc cancels.'
        : `Press a pad to edit that patch; it plays while you hold the pad. ▼ ▲ turn the page; Duplicate then a pad copies the patch there. An orange dot marks a patch changed since the pack was opened${api.hardware ? ', a ring one fetched from the Circuit Tracks' : ''}.`);
      else if (t.kind === 'drum') setHint(`Press a pad to choose ${t.label}'s sample and hear it.${pp?.loaded ? ' Loading a project sets each drum to the project\'s own sample; drum hits you add in Note view use the sample chosen here.' : ''}`);
      else setHint('MIDI tracks have no presets here.');
      if (t.kind === 'midi') { st.pads.forEach((p) => { clearPad(p); p.className = 'pad off'; }); } else paintPresetPads();
      return;
    }
    const none = 'Choose a project in Projects view first.';
    const saveHint = st.saveArm && pp?.loaded ? ` Save is waiting: press Save again to save over project ${pp.entry.slot + 1}${v.id === 'projects' ? ', or press another project\'s pad to save there' : ', or go to Projects view and press Save, then a pad, to save to another project'}. Esc cancels.` : '';
    if (v.id === 'projects') { setHint((st.saveArm && pp?.loaded ? '' : 'Press a project to load it, then ▶ (or Space) to play it. Synth 1 and 2 play the pack\'s patches as you edit them. Edits stay here until you Save (a dot marks a project with unsaved edits, a ring one saved into the pack here).') + saveHint); paintProjects(); return; }
    if (v.id === 'patterns') { setHint(pp?.loaded ? 'The lit pads are the patterns each track plays. Click a pattern to play it; hold it and press another (or Shift-click) to chain the patterns between them. ▼ ▲ show patterns 1-4 or 5-8. Choosing a scene in Mixer view puts back its patterns.' + saveHint : none); paintPatterns(); return; }
    if (v.id === 'mixer') { setHint(pp?.loaded ? `Top row: mute each track. Pad 9 (Mute recall): when lit, each scene brings back the mutes saved with it as it starts; when dim, scenes keep the current mutes. Bottom two rows: the 16 scenes (white: saved in the project). Click a scene to play it; hold it and press another (or ⌘/Alt-click) to chain the scenes between them. Shift-click a scene to store the patterns playing now (as chosen in Patterns view) and the current mutes in it; with Clear on, click a scene to clear it; with Duplicate on, click a scene and then the scenes to copy it to. The macro knobs set each track\'s ${st.mixMode === 'pan' ? 'pan (▲ for levels)' : 'level (▼ for pan)'}, as do the faders (level) and sliders (pan) below; Save keeps them. With Clear on, turning a knob deletes that track\'s recorded ${st.mixMode === 'pan' ? 'pan movements (clockwise: back to the centre)' : 'level movements'} in the pattern it plays.` + saveHint : none); paintMixer(); return; }
    if (v.id === 'fx') { setHint(pp?.loaded ? `Rows 1-2: the 16 delay presets; row 3: the 8 reverb presets (bright: the project's). Pressing a preset also makes the macro knobs that effect's send for each track (now: ${st.fxMode} sends; the knob brightens as the send rises). The faders below show and set the same sends; Reverb sends / Delay sends switches them and the knobs without changing the preset. Pad 25 turns FX on or off. With Clear on, turning a knob deletes that track's recorded ${st.fxMode} send movements in the pattern it plays. Save keeps all of it. Press FX again (or Shift + FX) for Side Chain.` + saveHint : none); paintFx(); return; }
    if (v.id === 'sidechain') { setHint(pp?.loaded ? `Side chain for ${st.scPage ? 'MIDI 1 (row 3) and MIDI 2 (row 4)' : 'Synth 1 (row 3) and Synth 2 (row 4)'}: Off, or presets 1-7 (how the drum ducks the track). Pads 5-8: the drum that ducks ${TRACKS[st.scTrack].label} (the track whose preset you pressed last). ${st.scPage ? '▲ for Synth 1 and 2.' : '▼ for MIDI 1 and 2.'} A muted drum doesn't duck. Save keeps it.${st.scPage ? ' The MIDI tracks\' side chains act on the Circuit Tracks\' rear inputs; the browser keeps and saves them but doesn\'t play them.' : ''}` + saveHint : none); paintSidechain(); return; }
    if (v.id === 'roll') {
      const drum = t.kind === 'drum';
      setHint(!pp?.loaded ? none : drum
        ? 'Drum grid: Drum 1-4 against the steps, each row the pattern its track plays. Click an empty cell to add a hit (with the track\'s sample), click a hit to hear it, double-click it to remove it; scroll the wheel over a hit for its velocity. Marks along a hit\'s foot are its six micro steps: Shift-click a cell (or click a hit with micro-step hits, outlined) to turn them on or off. Pink hits play a sample of their own (click one to hear it, hover for its name; change it in Note view). The automation lane underneath shows a recorded knob (choose it in its list): drag to draw values (Shift: sixths of a step), double-click a step to clear it. Pads (or Note) goes back.' + saveHint
        : `Piano roll (${scaleText()}): click to add a note (drag right for a longer one), drag a note to move it, drag its right edge to change its length (whole steps; hold Shift for sixths), Shift-drag it to move it in sixths of a step (its micro step), click it to hear it, double-click it to remove it, scroll the wheel over it for velocity. ▼ ▲ scroll an octave. The automation lane underneath shows a recorded knob (choose it in its list): drag to draw values (Shift: sixths of a step), double-click a step to clear it. Pads (or Note) goes back.` + saveHint);
      roll.paint();
      roll.playhead(st.pos);
      return;
    }
    if (v.id === 'scales') {
      setHint(`Rows 1-2: the root note (bright: notes in the scale). Rows 3-4: the scale. Note view's keyboard follows them. ${pp?.loaded ? 'They belong to the project: changing the root transposes its synth and MIDI notes, and a note not in a new scale plays the nearest one in it (nothing is lost; choose the old scale to hear it as before). Save keeps them.' : 'With no project loaded this only sets the keyboard (Chromatic to start with).'}` + saveHint);
      paintScales();
      return;
    }
    if (v.id === 'expand') {
      setHint(TRACKS[st.track].kind === 'drum' ? 'Expanded Note view is a bigger keyboard for Synth 1 and 2 (and MIDI 1 and 2).' : `A four-row keyboard (${scaleText()}): two octaves more than Note view. ▼ ▲ change octave. Press Note again to go back.`);
      paintPads();
      return;
    }
    if (v.id === 'tempo') { setHint(pp?.loaded ? 'Tempo and swing. Save keeps them in the project.' + saveHint : none); paintTempo(); return; }
    if (!pp?.loaded && v.step <= 3) setHint(`${none} Then the top rows show the steps of the pattern the track plays, and you can edit them.`);
    else if (v.step > 3) setHint(`${v.label} view is not built yet.`);
    else if (st.mode === 'clear') setHint('Clear is on: press a step to clear it (its notes or hit go, probability back to 100%). 1-16/17-32 puts the pattern back to 16 steps. Press Clear again or Esc to stop.');
    else if (st.mode === 'dup') setHint(st.dupSrc == null ? 'Duplicate is on: press the step to copy (1-16/17-32 copies steps 1-16 to 17-32). Press Duplicate again or Esc to stop.' : `Duplicate: press the steps to copy step ${st.dupSrc + 1} to. Press Duplicate again or Esc to stop.`);
    else if (v.id === 'velocity') setHint(`Press a step (top rows), then a pad on the bottom rows to set its velocity: pad 1 is 8, pad 12 is 96, pad 16 is 127. With several notes on the step, bright pads show the lowest velocity and dim ones the highest. Shift + Velocity: Fixed Velocity (${st.fixedVel ? 'on' : 'off'}).`);
    else if (v.id === 'gate' && t.kind !== 'drum') setHint('Press a step (top rows), then a pad on the bottom rows: the number of steps its notes sound for. Press the highest lit pad again to shorten it by a sixth of a step at a time. Press Gate again for Micro Step.');
    else if (microView()) setHint(t.kind === 'drum' ? `Micro steps: press a step (top rows), then pads 17-22 turn its six micro steps on or off (1 is on the step, each one a sixth of a step later than the one before; bright where the step plays). Several can be on: each plays the hit. A micro step on an empty step adds a hit with ${t.label}'s sample. All of a step's hits share its velocity, sample and probability.` : 'Micro steps: press a step (top rows). Pads 25-30 are its notes, in the order they were added (bright: chosen; click one to choose it, Shift-click to choose several). Pads 17-22 set when the chosen notes start: 1 on the step, 2-6 one to five sixths of a step late (bright: the chosen notes, mid: the others). Pad 24 ties the step forward. Press Gate again to go back.');
    else if (v.id === 'probability') setHint('Press a step (top rows), then a pad on row 3: the chance the step plays on each pass (8 pads 100%, 4 pads 50%, 1 pad 12.5%). Press Pattern Settings again to go back.');
    else if (v.id === 'pattern') setHint('Press a step to make it the last step of the pattern (hold Shift, or click Shift first, to move the first step). Row 3: sync rate (1/16 is the default). Pads 29-32: play order forward, reverse, ping-pong, random. Press Pattern Settings again for Probability.');
    else if (t.kind === 'midi') setHint(`Press a step to choose it (it turns red), then the keys to add or remove its notes; press the step again to let go. MIDI tracks play other gear from the Circuit Tracks; here they are sketched with a simple tone. Clear, Duplicate and 1-16/17-32 work on steps.`);
    else if (t.kind === 'drum') setHint(st.flip != null ? `Sample flip with ${pad3(st.flip + 1)} ${api.sampleName(st.flip) || ''}: press steps to give them this sample (red: steps playing it). Press the sample pad again or Esc to finish.` : `Bottom rows: 16 of the 64 samples (▼ ▲ for the others; hover for the name). Tap one to make it ${t.label}'s sample (bright) and hear it; hold one to hear it and arm a sample flip. Tap a step to add a hit with ${t.label}'s sample (${pad3(activeSample(st.track) + 1)} ${api.sampleName(activeSample(st.track)) || ''}), tap it again to remove it. Pink steps play a sample of their own; hover a step to see which.`);
    else setHint(st.armed ? `Step ${st.sel + 1} is chosen: the keys add notes to it (red: already on it) or remove them. ▼ ▲ change octave. Press the step again or Esc to play the keys normally.` : 'Press a step to choose it (it turns red, and plays its notes), then the keys to add or remove its notes. Without a chosen step the keys play the patch. ▼ ▲ change octave; velocity comes from the control at the bottom.');
    if (saveHint && STEP_VIEWS.includes(v.id)) setHint(hint.dataset.text + saveHint);
    if (['velocity', 'gate', 'probability', 'pattern', 'micro'].includes(v.id)) { paintStepView(); return; }
    paintPads();
  }

  // The play head moved (pos from js/pw/project.js, or null when stopped): repaint only what shows it.
  function step(pos) {
    const prev = st.pos;
    st.pos = pos;
    if (root.hidden) return;
    const sceneMoved = prev?.scene !== pos?.scene;
    if (st.view === 'roll') {
      // Repaint when a track moves to another pattern (chains, scenes), then the play head.
      if (!st.rollFocus && (!prev || !pos || prev.tracks.some((x, i) => x?.pattern !== pos.tracks[i]?.pattern))) roll.paint(true);
      roll.playhead(pos);
    } else if (STEP_VIEWS.includes(st.view)) {
      const vp = viewPattern(st.track);
      const cur = pos?.tracks?.[st.track];
      if ((prev?.tracks?.[st.track]?.pattern) !== cur?.pattern) { if (st.view === 'note') paintPads(); else paint(); }
      for (const p of st.pads) if (p.dataset.step != null) p.classList.toggle('play', !!pos && cur && +p.dataset.step === cur.step && vp?.index === cur.pattern);
    } else if (st.view === 'patterns') {
      if (!prev || !pos || prev.tracks.some((x, i) => x?.pattern !== pos.tracks[i]?.pattern)) paintPatterns();
    } else if (st.view === 'mixer') {
      if (sceneMoved) paintMixer();
    }
    if (sceneMoved && ['patterns', 'mixer', 'tempo'].includes(st.view)) paintLcd();
  }
  // A project was loaded: drums take its own samples.
  function projectLoaded() {
    if (pp?.loaded) st.drum = pp.song.tracks.slice(4).map((tr, i) => tr.defaultSample ?? DRUM_DEFAULT[i]);
    st.pos = null;
    paint();
  }

  // Repaint after a patch changes or another slot is chosen elsewhere (cheap when hidden).
  function refresh() {
    if (root.hidden || st.view !== 'preset') return;
    if (api.slot() !== st.lastSlot) followSlot();   // another patch was chosen: show its page
    paint();
  }

  paint();
  // selectTrack: a track chosen on the Circuit Tracks itself (0 Synth 1 … 7 Drum 4).
  // selectView: a view chosen on the Circuit Tracks itself (an id from VIEWS).
  return { paint, refresh, step, projectLoaded, macroSlot, mixKnobs, lane: () => roll.lane, selectTrack: (i) => { if (i >= 0 && i < TRACKS.length) selectTrack(i); }, selectView: (id) => { if (VIEWS.some((v) => v.id === id) && id !== st.view) selectView(id); }, state: st };
}
