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
// The other views are placeholders until their step is built.

export const TRACKS = [
  { id: 's1', label: 'Synth 1', kind: 'synth' }, { id: 's2', label: 'Synth 2', kind: 'synth' },
  { id: 'm1', label: 'MIDI 1', kind: 'midi' }, { id: 'm2', label: 'MIDI 2', kind: 'midi' },
  { id: 'd1', label: 'Drum 1', kind: 'drum' }, { id: 'd2', label: 'Drum 2', kind: 'drum' },
  { id: 'd3', label: 'Drum 3', kind: 'drum' }, { id: 'd4', label: 'Drum 4', kind: 'drum' },
];
// View buttons: the step views on the left, the project views on the right, as on the hardware.
export const VIEWS = [
  { id: 'note', label: 'Note', step: 1 }, { id: 'velocity', label: 'Velocity', step: 4 },
  { id: 'gate', label: 'Gate', step: 4 }, { id: 'probability', label: 'Probability', step: 4 },
  { id: 'micro', label: 'Micro step', step: 4 }, { id: 'pattern', label: 'Pattern settings', step: 4 },
  { id: 'preset', label: 'Preset', step: 1, group: 'project' }, { id: 'projects', label: 'Projects', step: 1 },
  { id: 'patterns', label: 'Patterns', step: 1 }, { id: 'mixer', label: 'Mixer', step: 1 },
  { id: 'fx', label: 'FX', step: 4 }, { id: 'sidechain', label: 'Sidechain', step: 4 },
  { id: 'scales', label: 'Scales', step: 4 }, { id: 'tempo', label: 'Tempo', step: 1 },
];
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
// Note view keyboard on the bottom two rows of pads: white keys on the bottom row, the black
// keys above them (null = no key), from C to the next C.
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
// noteOn(note), noteOff(note), octave() -> keyboard octave (C3 = 3),
// slot() -> pack slot being edited, slotCount() -> 128, slotInfo(i) -> { name, empty, edited, fetched },
// selectSlot(i), copyTo(i) (asks before replacing a patch), revert(),
// sampleCount() -> 64, sampleName(i) -> name or '' for an empty slot, audition(i), stopAudition(),
// proj: the ProjectPlayer (js/pw/project.js) or null, projects() -> its 64 slots, loadProject(slot) }.
export function buildPanel(root, api) {
  const st = { track: api.synth(), view: 'note', pads: [], page: [0, 0, 0, 0, 0, 0, 0, 0], vpage: { projects: 0, patterns: 0 }, drum: DRUM_DEFAULT.slice(), copying: false, hover: null, lastSlot: null, pos: null };
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
    b.addEventListener('click', (e) => { onclick?.(e); });
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
  const viewBtn = (id, name, { below, secondary, title } = {}) => {
    const b = btn('view', name, { below, title: title ?? `${name}${below ? ` (Shift: ${below})` : ''}`, onclick: (e) => {
      const sh = isShift(e);
      useShift();
      if (secondary && (sh || st.view === id)) selectView(st.view === secondary && !sh ? id : secondary);
      else selectView(id);
    } });
    b.dataset.view = id;
    if (secondary) b.dataset.secondary = secondary;
    b.setAttribute('aria-pressed', 'false');
    return b;
  };
  const vNote = viewBtn('note', 'Note', { below: 'Expand' });
  const vVel = viewBtn('velocity', 'Velocity', { below: 'Fixed' });
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
  const stepPageBtn = btn('idle', '1-16 17-32', { title: '1-16 / 17-32: step pages (comes with step editing)', disabled: true });
  const clearBtn = btn('idle', 'Clear', { above: 'Click', title: 'Clear (comes with step editing)', disabled: true });
  const copyBtn = btn('dup', 'Duplicate', { above: 'Mutate', title: 'Duplicate. In Preset view: press it, then a pad, to copy the patch being edited there.', onclick: () => { useShift(); if (presetKind() === 'synth') { st.copying = !st.copying; paint(); } } });
  const saveBtn = btn('idle half', 'Save', { title: 'Save (comes with saving projects; use Download pack meanwhile). Shift: Setup.', disabled: true });
  const shiftBtn = btn('shift', 'Shift', { title: 'Shift: click to arm it for the next button or pad, or hold the computer\'s Shift key', onclick: () => { shift.on = !shift.on; paintShift(); } });
  const playBtn = btn('tbtn play', '▶', { title: 'Play or stop the project (Space). Choose a project first (Projects, or Project in the bottom bar).', onclick: () => { useShift(); pp?.toggle(); } });
  playBtn.setAttribute('aria-label', 'Play');
  const recBtn = btn('tbtn rec idle', '●', { below: 'Rec Quantise', title: 'Record (comes with step editing). Shift: Rec Quantise.', disabled: true });
  recBtn.setAttribute('aria-label', 'Record');
  function paintShift() {
    shiftBtn.classList.toggle('on', shift.on || shift.held);
    root.classList.toggle('shifted', shift.on || shift.held);
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Shift' && !shift.held) { shift.held = true; paintShift(); } });
  document.addEventListener('keyup', (e) => { if (e.key === 'Shift') { shift.held = false; paintShift(); } });
  window.addEventListener('blur', () => { shift.held = false; paintShift(); });

  const lcd = h('p', { class: 'panel-lcd', role: 'status' });
  const hint = h('p', { class: 'panel-hint' });
  const revertBtn = h('button', { type: 'button', class: 'btn small', text: 'Revert', title: 'Put back the patch the pack had in this slot', onclick: () => api.revert() });
  const tools = h('div', { class: 'pad-tools' }, h('span', { class: 'grow' }), revertBtn);
  const grid = h('div', { class: 'pads', role: 'group', 'aria-label': 'Pads' });
  // Mixer view: a level slider per track under the pads (the hardware uses its macro knobs).
  const levels = TRACKS.map((t, i) => {
    const input = h('input', { type: 'range', min: 0, max: 127, value: 100, 'aria-label': `${t.label} level`, title: `${t.label} level (0-127; the Circuit Tracks' default is 100). Double-click for 100.` });
    const out = h('output', { text: '100' });
    input.addEventListener('input', () => { pp?.setLevel(i, +input.value); out.textContent = input.value; });
    input.addEventListener('dblclick', () => { input.value = 100; pp?.setLevel(i, 100); out.textContent = '100'; });
    return { input, out, cell: h('label', { class: `lvl ${t.kind}`, 'data-track': i }, h('span', { text: t.label }), input, out) };
  });
  const mixbox = h('div', { class: 'mixbox', hidden: true }, levels.map((l) => l.cell));
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
      h('div', { class: 'c-m rg padzone' }, grid, tempobox),
      h('div', { class: 'c-r rg rightcol' }, vMixer, vFx, recBtn, playBtn),
      h('div', { class: 'c-m rs status' }, lcd, tools, mixbox, hint))));

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
      st.drum[st.track - 4] = +pad.dataset.sample;
      api.audition(+pad.dataset.sample);
      paint();
      return;
    }
    if (pad.dataset.project != null) { e.preventDefault(); api.loadProject(+pad.dataset.project); return; }
    // Chains, as on the hardware: hold one pattern (or scene) pad and press another. Shift-click too.
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
      const held = st.held?.kind === 'scene';
      if (held) { pp?.selectScene(st.held.index); pp?.selectScene(i, { chain: true }); }
      else pp?.selectScene(i, { chain: isShift(e) });
      useShift();
      if (!held) st.held = { kind: 'scene', index: i, id: e.pointerId };
      return;
    }
    if (pad.dataset.mute != null) { e.preventDefault(); const t = +pad.dataset.mute; pp?.setMute(t, !pp.mutes[t]); return; }
    if (pad.dataset.drumhit != null) { e.preventDefault(); api.audition(+pad.dataset.drumhit); pad.classList.add('down'); setTimeout(() => pad.classList.remove('down'), 120); return; }
    if (pad.dataset.note == null) return;
    e.preventDefault();
    hold(e, pad, +pad.dataset.note);
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
  grid.addEventListener('pointerover', (e) => {
    const pad = e.target.closest('.pad');
    const k = pad?.dataset.slot ?? pad?.dataset.sample ?? (pad?.dataset.project != null ? `p${pad.dataset.project}` : null);
    if (k === st.hover) return;
    st.hover = k;
    paintLcd();
  });
  grid.addEventListener('pointerleave', () => { st.hover = null; paintLcd(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && st.copying) { st.copying = false; paint(); } });
  document.addEventListener('pointerup', (e) => { if (st.held?.id === e.pointerId) st.held = null; });
  grid.addEventListener('pointerup', up);
  grid.addEventListener('pointercancel', up);

  function selectTrack(i) {
    st.track = i;
    st.copying = false;
    if (TRACKS[i].kind === 'synth' && i !== api.synth()) api.chooseSynth(i);
    paint();
  }
  function selectView(id) {
    st.view = id;
    st.copying = false;
    if (id === 'preset') followSlot();
    paint();
  }
  // Turn the synth tracks' preset page to the one holding the patch being edited.
  function followSlot() { st.lastSlot = api.slot(); st.page[0] = st.page[1] = Math.floor(st.lastSlot / 32); }
  const presetKind = () => (st.view !== 'preset' ? null : TRACKS[st.track].kind);
  const viewPaged = () => st.view === 'projects' || (st.view === 'patterns' && pp?.loaded);
  const pageCount = () => (viewPaged() ? 2 : presetKind() === 'synth' ? Math.ceil(api.slotCount() / 32) : presetKind() === 'drum' ? Math.ceil(api.sampleCount() / 32) : 0);
  const getPage = () => (viewPaged() ? st.vpage[st.view] : st.page[st.track]);
  const setPage = (k) => { if (viewPaged()) st.vpage[st.view] = k; else st.page[st.track] = k; };

  // ▼ ▲ turn pages where a view has them (Preset, Projects, Patterns), otherwise the octave.
  function stepPage(dir) {
    const n = pageCount();
    if (n) { setPage(Math.max(0, Math.min(n - 1, getPage() + dir))); paint(); return; }
    if (st.view === 'note') api.setOctave?.(api.octave() + dir);
  }
  function paintPages() {
    const n = pageCount();
    const paged = n > 0;
    if (paged) setPage(Math.min(getPage(), n - 1));
    downBtn.classList.toggle('idle', paged ? getPage() === 0 : st.view !== 'note' || api.octave() <= 0);
    upBtn.classList.toggle('idle', paged ? getPage() >= n - 1 : st.view !== 'note' || api.octave() >= 6);
    const synth = presetKind() === 'synth';
    tools.hidden = !synth;
    copyBtn.classList.toggle('on', st.copying);
    copyBtn.classList.toggle('idle', !synth);
    if (synth) revertBtn.disabled = !api.slotInfo(api.slot()).edited;
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
    const cur = kind === 'synth' ? api.slot() : st.drum[st.track - 4];
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
      const i = st.hover != null ? +st.hover : st.drum[st.track - 4];
      text += ` · ${pad3(i + 1)} ${api.sampleName(i) || '(empty)'}`;
    } else if (st.view === 'projects') {
      const list = api.projects?.() ?? [];
      const i = st.hover?.startsWith?.('p') ? +st.hover.slice(1) : pp?.loaded ? pp.entry.slot : null;
      text = `Projects${i != null ? ` · ${i + 1} ${list[i]?.empty ? '(empty)' : list[i]?.name || '(no name)'}` : ''}`;
    } else if (pp?.loaded && ['patterns', 'mixer', 'tempo'].includes(st.view)) {
      const sc = pp.custom ? 'patterns chosen here' : pp.sceneChain.end > pp.sceneChain.start ? `scenes ${pp.sceneChain.start + 1}–${pp.sceneChain.end + 1}` : `scene ${pp.scene + 1}`;
      text = `${v.label} · ${pp.entry.slot + 1} ${pp.song.name} · ${sc}${st.pos?.scene != null && pp.playing ? ` · playing scene ${st.pos.scene + 1}` : ''}`;
    }
    lcd.textContent = text + (st.view === 'note' && TRACKS[st.track].kind === 'synth' ? ` · octave C${api.octave()}` : pageText());
  }

  // Note view's top two rows: the 16 steps of the pattern the track is playing (or the first of its
  // chain when stopped), lit where a step plays something; the play head moves along them.
  function viewPattern(track) {
    if (!pp?.loaded) return null;
    const p = st.pos?.tracks?.[track]?.pattern ?? pp.sel[track].start;
    return { index: p, pat: pp.song.tracks[track].patterns[p] };
  }
  function paintPads() {
    const kind = TRACKS[st.track].kind;
    const synthTrack = kind === 'synth';
    const oct = api.octave();
    const vp = st.view === 'note' ? viewPattern(st.track) : null;
    const drumSample = kind === 'drum' ? st.drum[st.track - 4] : null;
    st.pads.forEach((p, i) => {
      const row = Math.floor(i / 8), col = i % 8;
      let note = null, cls = 'pad', label = '';
      delete p.dataset.drumhit; delete p.dataset.project; delete p.dataset.pattern; delete p.dataset.ptrack; delete p.dataset.scene; delete p.dataset.mute;
      if (st.view === 'note' && row < 2) {
        cls += ' step';
        const k = row * 8 + col;
        const step = vp?.pat?.steps[k];
        if (vp && (k < vp.pat.start || k > vp.pat.end)) cls += ' outside';
        else if (step?.hits.length) cls += ` on ${kind}`;
        p.dataset.step = k;
      } else if (st.view === 'note' && kind === 'drum') {
        if (row === 3 && col < 4 || row === 2 && col < 4) { cls += ' drumhit'; p.dataset.drumhit = drumSample; label = row === 3 && col === 0 ? 'Hit' : ''; } else cls += ' off';
      } else if (st.view === 'note' && synthTrack) {
        const semi = row === 3 ? WHITE[col] : BLACK[col];
        if (semi != null) {
          note = (oct + 1) * 12 + semi;
          cls += row === 3 ? ' key white' : ' key black';
          if (semi % 12 === 0) { cls += ' root'; label = `${NOTE_NAMES[0]}${Math.floor(note / 12) - 1}`; }
        } else cls += ' off';
      } else cls += ' off';
      if (!(st.view === 'note' && row < 2)) delete p.dataset.step;
      p.className = cls;
      p.textContent = label;
      delete p.dataset.slot; delete p.dataset.sample; p.removeAttribute('title'); p.removeAttribute('aria-pressed');
      if (note == null) { delete p.dataset.note; p.removeAttribute('aria-label'); p.tabIndex = -1; }
      else { p.dataset.note = note; p.setAttribute('aria-label', `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`); }
    });
  }

  const clearPad = (p) => { for (const k of ['note', 'slot', 'sample', 'step', 'drumhit', 'project', 'pattern', 'ptrack', 'scene', 'mute']) delete p.dataset[k]; p.removeAttribute('title'); p.removeAttribute('aria-pressed'); p.removeAttribute('aria-label'); p.textContent = ''; };

  // Projects view: the pack's 64 project slots as two pages; the lit pad is the project loaded.
  function paintProjects() {
    const list = api.projects?.() ?? [];
    const base = st.vpage.projects * 32;
    st.pads.forEach((p, k) => {
      clearPad(p);
      const i = base + k, e = list[i];
      const cur = pp?.loaded && pp.entry.slot === i;
      p.className = `pad project${e && !e.empty ? ' filled' : ' empty'}${cur ? ' lit' : ''}${cur && pp.playing ? ' playing' : ''}`;
      p.textContent = String(i + 1);
      if (e && !e.empty) p.dataset.project = i;
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

  // Mixer view: row 1 mutes each track; rows 3-4 are the 16 scenes (click to select, Shift-click to
  // chain from the selected one).
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
      } else if (row >= 2) {
        const i = (row - 2) * 8 + col;
        const inChain = !pp.custom && i >= pp.sceneChain.start && i <= pp.sceneChain.end;
        const now = pp.playing && st.pos?.scene === i;
        p.className = `pad scene${pp.sceneStored(i) ? ' stored' : ''}${inChain ? ' chain' : ''}${!pp.custom && i === pp.scene ? ' sel' : ''}${now ? ' now' : ''}`;
        p.dataset.scene = i;
        p.textContent = String(i + 1);
        p.title = `Scene ${i + 1}${pp.sceneStored(i) ? '' : ' (not saved in the project: plays pattern 1 of each track)'}. Click to play it; Shift-click to chain scenes.`;
        p.setAttribute('aria-pressed', String(inChain));
      } else p.className = 'pad off';
      p.setAttribute('aria-label', p.title || '');
    });
    levels.forEach((l, i) => {
      const v = pp?.levels?.[i] ?? 100;
      l.input.value = v;
      l.out.textContent = v;
      l.input.disabled = !pp?.loaded;
    });
  }

  function paint() {
    st.track = TRACKS[st.track].kind === 'synth' ? api.synth() : st.track;
    playBtn.classList.toggle('idle', !pp?.loaded);
    playBtn.classList.toggle('on', !!pp?.playing);
    playBtn.querySelector('.nm').textContent = pp?.playing ? '■' : '▶';
    playBtn.setAttribute('aria-label', pp?.playing ? 'Stop' : 'Play');
    mixbox.hidden = st.view !== 'mixer';
    tempobox.hidden = st.view !== 'tempo';
    grid.hidden = st.view === 'tempo';
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
      if (t.kind === 'synth') hint.textContent = st.copying
        ? 'Press the pad to copy the patch being edited onto. Duplicate again or Esc cancels.'
        : `Press a pad to edit that patch; it plays while you hold the pad. ▼ ▲ turn the page; Duplicate then a pad copies the patch there. An orange dot marks a patch changed since the pack was opened${api.hardware ? ', a ring one fetched from the Circuit Tracks' : ''}.`;
      else if (t.kind === 'drum') hint.textContent = `Press a pad to choose ${t.label}'s sample and hear it.${pp?.loaded ? ' Loading a project sets each drum to the project\'s own sample.' : ''}`;
      else hint.textContent = 'MIDI tracks have no presets here.';
      if (t.kind === 'midi') { st.pads.forEach((p) => { clearPad(p); p.className = 'pad off'; }); } else paintPresetPads();
      return;
    }
    const none = 'Choose a project in Projects view first.';
    if (v.id === 'projects') { hint.textContent = 'Press a project to load it, then ▶ (or Space) to play it. Synth 1 and 2 play the pack\'s patches as you edit them; changing patch here (patch list or Preset view) changes what that synth plays. Nothing is saved in the project.'; paintProjects(); return; }
    if (v.id === 'patterns') { hint.textContent = pp?.loaded ? 'The lit pads are the patterns each track plays. Click a pattern to play it; hold it and press another (or Shift-click) to chain the patterns between them. ▼ ▲ show patterns 1-4 or 5-8. Choosing a scene in Mixer view puts back its patterns.' : none; paintPatterns(); return; }
    if (v.id === 'mixer') { hint.textContent = pp?.loaded ? 'Top row: mute each track. Bottom two rows: the 16 scenes (white: saved in the project). Click a scene to play it; hold it and press another (or Shift-click) to chain the scenes between them. The sliders set each track\'s level.' : none; paintMixer(); return; }
    if (v.id === 'tempo') { hint.textContent = pp?.loaded ? 'Tempo and swing for playing here. Not saved in the project.' : none; paintTempo(); return; }
    if (v.step > 3) hint.textContent = `${v.label} view is not built yet (step ${v.step} of the Tracks panel plan).`;
    else if (t.kind === 'midi') hint.textContent = pp?.loaded ? `${t.label}'s steps in the pattern it is playing. MIDI tracks play other gear from the Circuit Tracks; here they are sketched with a simple tone.` : `${t.label} shows its steps once a project is loaded.`;
    else if (t.kind === 'drum') hint.textContent = `${pp?.loaded ? `${t.label}'s steps in the pattern it is playing (top rows). ` : ''}The bottom-left pads play ${t.label}'s sample (${pad3(st.drum[st.track - 4] + 1)} ${api.sampleName(st.drum[st.track - 4]) || ''}); choose another in Preset view.`;
    else hint.textContent = `${pp?.loaded ? 'Top rows: the steps of the pattern this synth is playing. ' : ''}Play the patch from the bottom two rows of pads. The keyboard octave and velocity come from the controls at the bottom.`;
    paintPads();
  }

  // The play head moved (pos from js/pw/project.js, or null when stopped): repaint only what shows it.
  function step(pos) {
    const prev = st.pos;
    st.pos = pos;
    if (root.hidden) return;
    const sceneMoved = prev?.scene !== pos?.scene;
    if (st.view === 'note') {
      const vp = viewPattern(st.track);
      const cur = pos?.tracks?.[st.track];
      if ((prev?.tracks?.[st.track]?.pattern) !== cur?.pattern) paintPads();
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
  return { paint, refresh, step, projectLoaded, macroSlot, selectTrack: (i) => { if (i >= 0 && i < TRACKS.length) selectTrack(i); }, selectView: (id) => { if (VIEWS.some((v) => v.id === id) && id !== st.view) selectView(id); }, state: st };
}
