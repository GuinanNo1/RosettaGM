// PatchWorker TRACKS panel: the piano roll (Synth 1 / 2, MIDI 1 / 2) and the drum grid (Drum 1-4),
// shown instead of the 32 pads (PatchWorker 0.16). Not on the Circuit Tracks, which has no screen:
// a browser view of the same pattern data the pads edit (ProjectPlayer's edit methods), so a change
// in one shows in the other.
//
// Piano roll: one row per note (only the scale's notes unless Chromatic), one column per step (16,
// or 32 for longer patterns; steps outside the pattern shaded). Click an empty cell to add a note
// (drag right to make it longer), drag a note to move it, drag its right edge to change its length,
// click it to hear it, double-click it to remove it, scroll the wheel over it for velocity. Lengths snap to whole steps (hold
// Shift for sixths).
// Drum grid: Drum 1-4 rows, each the pattern its track plays. Click an empty cell to add a hit, a
// hit to hear it, double-click a hit to remove it;
// wheel for velocity. Hits with a sample of their own (a sample flip) are pink (hover or click to
// hear which).
// Marks along a hit's foot show its micro steps (six per step). Shift-click a cell, or click a hit
// that has micro-step hits, for a box that turns each micro step on or off (0.18).
// Piano roll: Shift-drag a note to move it in sixths of a step (its micro step, 0.18).
import { SCALES, CHROMATIC, inScale } from '../scales.js';
const FULL_GATE = 6;   // one step, in sixths (as in project.js)

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const nn = (n) => `${NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
const LOW = 24, HIGH = 108;      // C1 to C8: the rows the piano roll offers
const ROW_H = 13, KEY_W = 46, EDGE = 7, LONG = 32;

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

// o: { pp: () => ProjectPlayer, track: () => 0-7, pattern: (t) => index or null, velocity: () =>
// 1-127, activeSample: (t) => slot, sampleName: (slot) => name, noteOn(n, v), noteOff(n),
// audition(slot, track), status(text), flash(text), scale: () => { root, type } }
export function buildRoll(o) {
  const root = el('div', 'roll');
  root.hidden = true;
  const scroll = el('div', 'roll-scroll');
  const body = el('div', 'roll-body');
  const keys = el('div', 'roll-keys');
  const area = el('div', 'roll-area');
  const head = el('div', 'roll-head');
  area.append(head);
  body.append(keys, area);
  scroll.append(body);
  root.append(scroll);
  let view = null;       // what was last drawn: { kind, t, p, rows, n, sw }
  let drag = null;

  const isLong = (set) => set.playbackEnd > 15 || set.playbackStart > 15;
  // ---- piano roll
  function rowsFor(sc) {
    const out = [];
    for (let n = HIGH; n >= LOW; n--) if (sc.type === CHROMATIC || inScale(n - sc.root, sc.type)) out.push(n);
    return out;
  }
  function paintPiano(t, p, keepScroll) {
    const pp = o.pp(), sc = o.scale();
    const set = pp.raw(t, p).settings;
    const n = isLong(set) ? 32 : 16;
    const rows = rowsFor(sc);
    const width = Math.max(200, root.clientWidth - KEY_W - 2);
    const sw = width / n;
    const changed = !view || view.kind !== 'piano' || view.t !== t || view.p !== p || view.rows.length !== rows.length;
    view = { kind: 'piano', t, p, rows, n, sw, set };
    root.dataset.kind = 'piano';
    body.style.height = `${rows.length * ROW_H}px`;
    area.style.setProperty('--sw', `${sw}px`);
    area.style.setProperty('--rh', `${ROW_H}px`);
    area.style.width = `${width}px`;
    // Keys down the left: names on every C and the root; dark rows for black keys.
    keys.replaceChildren(...rows.map((note) => {
      const isRoot = ((note - sc.root) % 12 + 12) % 12 === 0;
      const k = el('div', `rk${[1, 3, 6, 8, 10].includes(note % 12) ? ' black' : ''}${isRoot ? ' root' : ''}`, isRoot || note % 12 === 0 ? nn(note) : '');
      k.dataset.note = note;
      k.title = nn(note);
      return k;
    }));
    // Rows and the shaded steps outside the pattern.
    const lo = Math.min(set.playbackStart, set.playbackEnd), hi = Math.max(set.playbackStart, set.playbackEnd);
    for (const c of [...area.children]) if (c !== head) c.remove();
    const shade = el('div', 'roll-shade');
    shade.style.background = `linear-gradient(to right, #0007 ${lo * sw}px, transparent ${lo * sw}px, transparent ${(hi + 1) * sw}px, #0007 ${(hi + 1) * sw}px)`;
    area.append(shade);
    rows.forEach((note, i) => { if ([1, 3, 6, 8, 10].includes(note % 12) && sc.type === CHROMATIC) { const r = el('div', 'roll-row black'); r.style.top = `${i * ROW_H}px`; area.append(r); } });
    // Notes.
    const rowOf = new Map(rows.map((note, i) => [note, i]));
    for (let k = 0; k < n; k++) {
      for (const nt of pp.stepNotes(t, p, k)) {
        const r = rowOf.get(nt.note);
        if (r == null) continue;
        const d = el('div', `rnote${k < lo || k > hi ? ' out' : ''}`);
        const micro = (nt.delay % 6) / 6;
        Object.assign(d.style, { left: `${(k + micro) * sw}px`, top: `${r * ROW_H}px`, width: `${Math.max(5, (nt.gate / 6) * sw - 1)}px`, opacity: String(0.45 + 0.55 * (nt.vel / 127)) });
        d.dataset.k = k; d.dataset.j = nt.j; d.dataset.note = nt.note; d.dataset.delay = nt.delay % 6;
        d.title = `${nn(nt.note)} · step ${k + 1}${nt.delay % 6 ? ` +${nt.delay % 6}/6` : ''} · ${gateText(nt.gate)} · velocity ${nt.vel}${nt.tie ? ' · tied' : ''}`;
        area.append(d);
      }
    }
    if (changed && !keepScroll) {
      // Centre on the notes, or on the keyboard's octave.
      const notes = [...area.querySelectorAll('.rnote')].map((d) => +d.dataset.note);
      const mid = notes.length ? (Math.max(...notes) + Math.min(...notes)) / 2 : (o.octave() + 1) * 12 + 6;
      const r = rows.findIndex((x) => x <= mid);
      scroll.scrollTop = Math.max(0, (r < 0 ? rows.length : r) * ROW_H - scroll.clientHeight / 2);
    }
  }
  const gateText = (g) => `${Math.floor(g / 6)}${g % 6 ? ` ${g % 6}/6` : ''} step${g === 6 ? '' : 's'}`;

  // ---- drum grid
  function paintDrums() {
    const pp = o.pp();
    const pats = [4, 5, 6, 7].map((t) => o.pattern(t));
    const sets = pats.map((p, i) => (p == null ? null : pp.raw(4 + i, p).settings));
    const n = sets.some((s) => s && isLong(s)) ? 32 : 16;
    const width = Math.max(200, root.clientWidth - KEY_W - 2);
    const sw = width / n;
    view = { kind: 'drum', n, sw, pats };
    root.dataset.kind = 'drum';
    const rh = Math.max(40, Math.floor((root.clientHeight - 6) / 4));
    body.style.height = `${rh * 4}px`;
    area.style.width = `${width}px`;
    area.style.setProperty('--sw', `${sw}px`);
    area.style.setProperty('--rh', `${rh}px`);
    keys.replaceChildren(...[0, 1, 2, 3].map((i) => {
      const slot = o.activeSample(4 + i);
      const k = el('div', `dk${o.track() === 4 + i ? ' sel' : ''}`);
      k.style.height = `${rh}px`;
      k.append(el('b', '', `D${i + 1}`), el('span', '', `${pats[i] == null ? '' : `P${pats[i] + 1} · `}${String(slot + 1).padStart(3, '0')}`));
      k.title = `Drum ${i + 1}: pattern ${pats[i] == null ? '-' : pats[i] + 1}, sample ${String(slot + 1).padStart(3, '0')} ${o.sampleName(slot) || ''}`;
      return k;
    }));
    for (const c of [...area.children]) if (c !== head) c.remove();
    [0, 1, 2, 3].forEach((i) => {
      const t = 4 + i, p = pats[i], set = sets[i];
      if (p == null) return;
      const lo = Math.min(set.playbackStart, set.playbackEnd), hi = Math.max(set.playbackStart, set.playbackEnd);
      const act = o.activeSample(t);
      for (let k = 0; k < n; k++) {
        const s = pp.raw(t, p).steps[k];
        const smp = pp.stepSample(t, p, k);
        const c = el('div', `dcell${k < lo || k > hi ? ' out' : ''}${k % 4 === 0 ? ' beat' : ''}${s.active ? ' on' : ''}${s.active && smp !== act ? ' flip' : ''}${o.track() === t ? ' sel' : ''}`, '');
        Object.assign(c.style, { left: `${k * sw + 1}px`, top: `${i * rh + 2}px`, width: `${sw - 2}px`, height: `${rh - 4}px` });
        if (s.active) c.style.opacity = String(0.5 + 0.5 * (s.velocity / 127));
        c.dataset.t = t; c.dataset.k = k;
        const mic = pp.stepMicro(t, p, k);
        const extra = s.active && (mic.filter(Boolean).length > 1 || !mic[0]);
        if (s.active) {
          const marks = el('span', 'dmicro');
          mic.forEach((on) => marks.append(el('i', on ? 'on' : '')));
          c.append(marks);
          if (extra) c.classList.add('multi');
        }
        c.title = `Drum ${i + 1} · step ${k + 1}${s.active ? ` · ${String(smp + 1).padStart(3, '0')} ${o.sampleName(smp) || ''}${smp !== act ? ' (its own sample)' : ''} · velocity ${s.velocity} · micro step${mic.filter(Boolean).length > 1 ? 's' : ''} ${mic.flatMap((on, m) => (on ? [m] : [])).join(', ')}` : ''}${extra ? ' · click to edit its micro steps' : ' · Shift-click for micro steps'}`;
        area.append(c);
      }
    });
  }

  // ---- micro steps of a drum step: a small box over the grid
  const pop = el('div', 'micropop');
  pop.hidden = true;
  root.append(pop);
  let popAt = null;   // { t, p, k }
  function openMicro(t, p, k, cell) {
    popAt = { t, p, k };
    const r = cell.getBoundingClientRect(), b = root.getBoundingClientRect();
    pop.style.left = `${Math.max(0, Math.min(b.width - 230, r.left - b.left))}px`;
    pop.hidden = false;
    paintPop();
    // Below the cell, or above it if the grid has no room below (the panel clips it).
    const h = pop.offsetHeight;
    pop.style.top = `${r.bottom - b.top + 2 + h <= b.height ? r.bottom - b.top + 2 : Math.max(0, r.top - b.top - h - 2)}px`;
  }
  function closeMicro() { pop.hidden = true; popAt = null; }
  function paintPop() {
    if (!popAt) return;
    const pp = o.pp(), { t, p, k } = popAt;
    const mic = pp.stepMicro(t, p, k);
    pop.replaceChildren(
      el('span', 'mp-title', `Drum ${t - 3} · step ${k + 1}: micro steps`),
      ...mic.map((on, m) => { const b = el('button', `mp-tick${on ? ' on' : ''}`, String(m)); b.type = 'button'; b.dataset.m = m; b.title = m ? `Micro step ${m}: ${m}/6 of a step late` : 'Micro step 0: on the step'; return b; }),
      Object.assign(el('button', 'mp-clear', 'Clear'), { type: 'button', title: 'Remove every hit on this step', disabled: !mic.some(Boolean) }),
      Object.assign(el('button', 'mp-close', '×'), { type: 'button', title: 'Close (Esc)' }));
  }
  pop.addEventListener('pointerdown', (e) => e.stopPropagation());
  pop.addEventListener('click', (e) => {
    const pp = o.pp();
    if (!popAt) return;
    const { t, p, k } = popAt;
    const b = e.target.closest('button');
    if (!b) return;
    if (b.classList.contains('mp-close')) { closeMicro(); return; }
    if (b.classList.contains('mp-clear')) { pp.clearStep(t, p, k); closeMicro(); return; }
    const m = +b.dataset.m;
    const mic = pp.toggleMicro(t, p, k, m, o.activeSample(t), o.velocity());
    if (mic[m]) o.audition(pp.stepSample(t, p, k), t);
    paintPop();
  });
  document.addEventListener('pointerdown', (e) => { if (popAt && !pop.contains(e.target) && !e.target.closest?.('.dcell')) closeMicro(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && popAt) closeMicro(); });

  // ---- input
  const at = (e) => { const b = area.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
  area.addEventListener('pointerdown', (e) => {
    if (!view || e.button !== 0) return;
    const pp = o.pp();
    e.preventDefault();
    if (view.kind === 'drum') {
      const c = e.target.closest('.dcell');
      if (!c) return;
      const t = +c.dataset.t, k = +c.dataset.k, p = o.pattern(t);
      // Micro steps: Shift-click, or a hit with micro-step hits (a click would lose them).
      if (e.shiftKey || c.classList.contains('multi')) { openMicro(t, p, k, c); return; }
      // A click on a hit plays it; a double-click removes it. A click on an empty cell adds one.
      if (pp.stepHas(t, p, k)) { o.audition(pp.stepSample(t, p, k), t); return; }
      pp.toggleHit(t, p, k, o.activeSample(t), o.velocity());
      o.audition(pp.stepSample(t, p, k), t);
      return;
    }
    const { t, p, rows, sw } = view;
    const pos = at(e);
    const nd = e.target.closest('.rnote');
    if (nd) {
      const r = nd.getBoundingClientRect();
      const resize = e.clientX > r.right - EDGE;
      drag = { mode: resize ? 'resize' : 'move', nd, k: +nd.dataset.k, j: +nd.dataset.j, note: +nd.dataset.note, delay: +(nd.dataset.delay ?? 0), x0: pos.x, y0: pos.y, w0: nd.offsetWidth, l0: nd.offsetLeft, t0: nd.offsetTop, moved: false };
      if (!resize && t < 2) o.noteOn(drag.note, 100);
    } else {
      const k = Math.floor(pos.x / sw), r = Math.floor(pos.y / ROW_H);
      if (k < 0 || k >= view.n || r < 0 || r >= rows.length) return;
      const note = rows[r];
      const ghost = el('div', 'rnote ghost');
      Object.assign(ghost.style, { left: `${k * sw}px`, top: `${r * ROW_H}px`, width: `${sw - 1}px` });
      area.append(ghost);
      drag = { mode: 'add', nd: ghost, k, note, x0: pos.x, gate: FULL_GATE, moved: false };
      if (t < 2) o.noteOn(note, o.velocity());
    }
    area.setPointerCapture(e.pointerId);
  });
  area.addEventListener('pointermove', (e) => {
    if (!drag) { hover(e); return; }
    const pos = at(e), { sw, rows } = view;
    const dx = pos.x - drag.x0;
    if (Math.abs(dx) > 3 || Math.abs(pos.y - (drag.y0 ?? pos.y)) > 3) drag.moved = true;
    const snap = (g) => (e.shiftKey ? Math.round(g) : Math.max(6, Math.round(g / 6) * 6));
    if (drag.mode === 'add') {
      drag.gate = Math.max(6, Math.min(96, snap(((pos.x - drag.k * sw) / sw) * 6)));
      drag.nd.style.width = `${(drag.gate / 6) * sw - 1}px`;
    } else if (drag.mode === 'resize') {
      drag.gate = Math.max(1, Math.min(96, snap(((drag.w0 + dx) / sw) * 6)));
      drag.nd.style.width = `${Math.max(5, (drag.gate / 6) * sw - 1)}px`;
      o.status(`${nn(drag.note)} · ${gateText(drag.gate)}`);
    } else if (drag.moved) {
      // Positions in sixths of a step: whole steps, keeping the note's micro step, or (Shift)
      // sixths, which moves its micro step (0-5) and its step.
      const from = drag.k * 6 + drag.delay;
      const to = e.shiftKey ? from + Math.round((dx / sw) * 6) : from + Math.round(dx / sw) * 6;
      const pos6 = Math.max(0, Math.min(view.n * 6 - 1, to));
      const dr = Math.round((pos.y - drag.y0) / ROW_H);
      const r0 = rows.indexOf(drag.note);
      drag.toK = Math.floor(pos6 / 6);
      drag.toDelay = pos6 % 6;
      drag.toNote = rows[Math.max(0, Math.min(rows.length - 1, r0 + dr))];
      drag.nd.style.left = `${drag.l0 + ((pos6 - from) / 6) * sw}px`;
      drag.nd.style.top = `${rows.indexOf(drag.toNote) * ROW_H}px`;
      o.status(`${nn(drag.toNote)} · step ${drag.toK + 1}${drag.toDelay ? ` +${drag.toDelay}/6` : ''}`);
    }
  });
  const end = () => {
    if (!drag) return;
    const d = drag, pp = o.pp(), { t, p } = view;
    drag = null;
    if (t < 2) o.noteOff(d.note);
    if (d.mode === 'add') {
      if (!pp.addNote(t, p, d.k, d.note, o.velocity(), d.gate)) { d.nd.remove(); o.flash(`Step ${d.k + 1} can't take ${nn(d.note)}: a step holds up to 6 notes, each once.`); }
    } else if (d.mode === 'resize') {
      if (d.gate != null) pp.setNoteGate(t, p, d.k, d.j, d.gate);
    } else if (!d.moved) { /* a click on a note only plays it; a double-click removes it */ }
    else if (d.toK != null && (d.toK !== d.k || d.toNote !== d.note || d.toDelay !== d.delay)) {
      if (!pp.moveNote(t, p, d.k, d.j, d.toK, d.toNote, d.toDelay)) { o.flash(`Step ${d.toK + 1} can't take ${nn(d.toNote)}.`); paint(true); }
    } else paint(true);
  };
  // Double-click removes a note or a hit (a single click plays it).
  area.addEventListener('dblclick', (e) => {
    if (!view) return;
    const pp = o.pp();
    if (view.kind === 'drum') {
      const c = document.elementFromPoint(e.clientX, e.clientY)?.closest('.dcell');
      if (!c || e.shiftKey) return;
      const t = +c.dataset.t, k = +c.dataset.k, p = o.pattern(t);
      if (!pp.stepHas(t, p, k)) return;
      closeMicro();
      pp.clearStep(t, p, k);
      o.flash(`Drum ${t - 3} step ${k + 1}: hit removed.`);
      return;
    }
    // Pointer capture makes the area the target: find the note under the pointer.
    const nd = document.elementFromPoint(e.clientX, e.clientY)?.closest('.rnote:not(.ghost)');
    if (!nd) return;
    pp.removeNote(view.t, view.p, +nd.dataset.k, +nd.dataset.j);
    o.flash(`${nn(+nd.dataset.note)} removed from step ${+nd.dataset.k + 1}.`);
  });
  area.addEventListener('pointerup', end);
  area.addEventListener('pointercancel', end);
  area.addEventListener('wheel', (e) => {
    const pp = o.pp();
    const nd = e.target.closest('.rnote, .dcell.on');
    if (!nd || !view) return;
    e.preventDefault();
    const step = e.deltaY < 0 ? 8 : -8;
    if (view.kind === 'drum') {
      const t = +nd.dataset.t, k = +nd.dataset.k, p = o.pattern(t);
      pp.setHitVelocity(t, p, k, pp.raw(t, p).steps[k].velocity + step);
      o.status(`velocity ${pp.raw(t, p).steps[k].velocity}`);
    } else {
      const { t, p } = view, k = +nd.dataset.k, j = +nd.dataset.j;
      const v = pp.raw(t, p).steps[k].notes[j].velocity + step;
      pp.setNoteVelocity(t, p, k, j, v);
      o.status(`${nn(+nd.dataset.note)} · velocity ${Math.max(1, Math.min(127, v))}`);
    }
  }, { passive: false });
  // Hover: the note or hit under the pointer in the status strip.
  function hover(e) {
    const nd = e.target.closest('.rnote, .dcell');
    if (nd) { o.status(nd.title); return; }
    if (view?.kind === 'piano') {
      const pos = at(e), r = Math.floor(pos.y / ROW_H), k = Math.floor(pos.x / view.sw);
      if (view.rows[r] != null && k >= 0 && k < view.n) { o.status(`${nn(view.rows[r])} · step ${k + 1}`); return; }
    }
    o.status('');
  }
  area.addEventListener('pointerleave', () => { if (!drag) o.status(''); });
  keys.addEventListener('pointerdown', (e) => {
    const k = e.target.closest('.rk');
    if (!k || o.track() > 1) return;
    const n = +k.dataset.note;
    o.noteOn(n, o.velocity());
    const up = () => { o.noteOff(n); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointerup', up);
  });

  // ---- drawing
  function paint(keepScroll = false) {
    if (root.hidden || drag) return;
    const pp = o.pp();
    const t = o.track();
    if (!pp?.loaded) { view = null; for (const c of [...area.children]) if (c !== head) c.remove(); keys.replaceChildren(); return; }
    root.dataset.trk = t;
    if (t >= 4) paintDrums();
    else { const p = o.pattern(t); if (p != null) paintPiano(t, p, keepScroll); }
  }
  // The play head: the step each track is on (pos.tracks[t].step), drawn for the track shown.
  function playhead(pos) {
    if (root.hidden || !view) { head.hidden = true; return; }
    const t = view.kind === 'drum' ? o.track() : view.t;
    const tp = pos?.tracks?.[t];
    if (!tp || tp.step == null || (view.kind === 'piano' && tp.pattern !== view.p)) { head.hidden = true; return; }
    head.hidden = false;
    head.style.left = `${tp.step * view.sw}px`;
    head.style.width = `${view.sw}px`;
  }
  // ▼ ▲: scroll the piano roll by an octave.
  function scrollOctave(dir) {
    if (view?.kind !== 'piano') return;
    const per = o.scale().type === CHROMATIC ? 12 : SCALES[o.scale().type].steps.length;
    scroll.scrollTop -= dir * per * ROW_H;
  }
  return { el: root, paint, playhead, scrollOctave, get kind() { return view?.kind; } };
}
