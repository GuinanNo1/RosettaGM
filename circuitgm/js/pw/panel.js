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

  const trackBtns = TRACKS.map((t, i) => h('button', {
    type: 'button', class: `trk ${t.kind}`, 'data-track': i, 'aria-pressed': 'false', text: t.label,
    title: t.kind === 'synth' ? `${t.label}: edit and play its patch` : `${t.label}: its steps in Note view, its sample in Preset view`,
    onclick: () => selectTrack(i),
  }));
  const viewBtns = VIEWS.map((v) => h('button', {
    type: 'button', class: `view${v.group ? ` ${v.group}` : ''}`, 'data-view': v.id, 'aria-pressed': 'false', text: v.label,
    title: v.step > 3 ? `${v.label} view (not built yet)` : `${v.label} view`,
    onclick: () => selectView(v.id),
  }));
  const lcd = h('p', { class: 'panel-lcd', role: 'status' });
  const hint = h('p', { class: 'panel-hint' });
  const pages = h('div', { class: 'pages seg', role: 'group', 'aria-label': 'Pages' });
  const copyBtn = h('button', { type: 'button', class: 'btn small', 'aria-pressed': 'false', title: 'Duplicate the patch being edited onto another pad and edit the copy: press this, then the pad', onclick: () => { st.copying = !st.copying; paint(); } });
  const revertBtn = h('button', { type: 'button', class: 'btn small', text: 'Revert', title: 'Put back the patch the pack had in this slot', onclick: () => api.revert() });
  const tools = h('div', { class: 'pad-tools' }, pages, h('span', { class: 'grow' }), copyBtn, revertBtn);
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
  tap.addEventListener('click', () => {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
    taps.push(now);
    if (taps.length > 5) taps.shift();
    if (taps.length >= 3) setBpm(60000 / ((taps[taps.length - 1] - taps[0]) / (taps.length - 1)));
  });
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
  const playBtn = h('button', { type: 'button', class: 'tbtn play', disabled: true, title: 'Play or stop the project (Space). Choose a project in Projects view first.', 'aria-label': 'Play', text: '▶', onclick: () => pp?.toggle() });
  const transport = h('div', { class: 'transport' },
    playBtn,
    h('button', { type: 'button', class: 'tbtn rec', disabled: true, title: 'Record (comes with step editing)', 'aria-label': 'Record', text: '●' }),
    h('button', { type: 'button', class: 'tbtn', disabled: true, title: 'Clear (comes with step editing)', text: 'Clear' }),
    h('button', { type: 'button', class: 'tbtn', disabled: true, title: 'Duplicate (comes with step editing)', text: 'Duplicate' }),
  );

  root.append(
    h('div', { class: 'panel-top' }, h('div', { class: 'tracks-row', role: 'group', 'aria-label': 'Tracks' }, trackBtns), transport),
    h('div', { class: 'panel-mid' },
      h('div', { class: 'views', role: 'group', 'aria-label': 'Views' }, viewBtns),
      h('div', { class: 'padzone' }, lcd, tools, grid, mixbox, tempobox, hint)),
  );

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
    if (pad.dataset.pattern != null) { e.preventDefault(); pp?.selectPattern(+pad.dataset.ptrack, +pad.dataset.pattern, { extend: e.shiftKey }); return; }
    if (pad.dataset.scene != null) { e.preventDefault(); pp?.selectScene(+pad.dataset.scene, { chain: e.shiftKey }); return; }
    if (pad.dataset.mute != null) { e.preventDefault(); const t = +pad.dataset.mute; pp?.setMute(t, !pp.mutes[t]); return; }
    if (pad.dataset.drumhit != null) { e.preventDefault(); api.audition(+pad.dataset.drumhit); pad.classList.add('down'); setTimeout(() => pad.classList.remove('down'), 120); return; }
    if (pad.dataset.note == null) return;
    e.preventDefault();
    hold(e, pad, +pad.dataset.note);
  });
  const up = (e) => {
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

  function paintPages() {
    const n = pageCount();
    tools.hidden = !n;
    if (!n) return;
    setPage(Math.min(getPage(), n - 1));
    if (pages.children.length !== n) {
      pages.textContent = '';
      for (let k = 0; k < n; k++) pages.append(h('button', { type: 'button', 'data-page': k, onclick: () => { setPage(k); paint(); } }));
    }
    [...pages.children].forEach((b, k) => {
      b.textContent = st.view === 'patterns' ? `Patterns ${k * 4 + 1}–${k * 4 + 4}` : `${k * 32 + 1}–${(k + 1) * 32}`;
      const on = k === getPage();
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const synth = presetKind() === 'synth';
    copyBtn.hidden = revertBtn.hidden = !synth;
    if (synth) {
      const info = api.slotInfo(api.slot());
      copyBtn.textContent = st.copying ? 'Cancel' : 'Duplicate to pad…';
      copyBtn.classList.toggle('on', st.copying);
      copyBtn.setAttribute('aria-pressed', String(st.copying));
      revertBtn.disabled = !info.edited;
    }
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
    lcd.textContent = text;
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
    playBtn.disabled = !pp?.loaded;
    playBtn.classList.toggle('on', !!pp?.playing);
    playBtn.textContent = pp?.playing ? '■' : '▶';
    playBtn.setAttribute('aria-label', pp?.playing ? 'Stop' : 'Play');
    mixbox.hidden = st.view !== 'mixer';
    tempobox.hidden = st.view !== 'tempo';
    grid.hidden = st.view === 'tempo';
    trackBtns.forEach((b, i) => { const on = i === st.track; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    viewBtns.forEach((b) => { const on = b.dataset.view === st.view; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    const t = TRACKS[st.track], v = VIEWS.find((x) => x.id === st.view);
    root.dataset.track = t.kind;
    root.dataset.copying = st.copying ? 'yes' : 'no';
    paintLcd();
    paintPages();
    if (v.id === 'preset') {
      if (t.kind === 'synth') hint.textContent = st.copying
        ? 'Press the pad to duplicate the patch being edited onto. Esc cancels.'
        : `Press a pad to edit that patch; it plays while you hold the pad. An orange dot marks a patch changed since the pack was opened${api.hardware ? ', a ring one fetched from the Circuit Tracks' : ''}.`;
      else if (t.kind === 'drum') hint.textContent = `Press a pad to choose ${t.label}'s sample and hear it.${pp?.loaded ? ' Loading a project sets each drum to the project\'s own sample.' : ''}`;
      else hint.textContent = 'MIDI tracks have no presets here.';
      if (t.kind === 'midi') { st.pads.forEach((p) => { clearPad(p); p.className = 'pad off'; }); } else paintPresetPads();
      return;
    }
    const none = 'Choose a project in Projects view first.';
    if (v.id === 'projects') { hint.textContent = 'Press a project to load it, then ▶ (or Space) to play it. Synth 1 and 2 play the pack\'s patches as you edit them; changing patch here (patch list or Preset view) changes what that synth plays. Nothing is saved in the project.'; paintProjects(); return; }
    if (v.id === 'patterns') { hint.textContent = pp?.loaded ? 'The lit pads are the patterns each track plays. Click a pattern to play it; Shift-click another to chain the patterns between them. Choosing a scene in Mixer view puts back its patterns.' : none; paintPatterns(); return; }
    if (v.id === 'mixer') { hint.textContent = pp?.loaded ? 'Top row: mute each track. Bottom two rows: the 16 scenes (white: saved in the project). Click a scene to play it; Shift-click another to chain the scenes between them. The sliders set each track\'s level.' : none; paintMixer(); return; }
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
  return { paint, refresh, step, projectLoaded, selectTrack: (i) => { if (i >= 0 && i < TRACKS.length) selectTrack(i); }, selectView: (id) => { if (VIEWS.some((v) => v.id === id) && id !== st.view) selectView(id); }, state: st };
}
