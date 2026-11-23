// PatchWorker's Offline player: plays a project from the pack open in the browser, through the
// browser synth (Synth 1 / 2 on the pack's patches, so edits are heard in context), the pack's
// drum samples and the project mixer measured on the hardware (js/pw/mixer.js, set 7).
//
// The song model and rendering are Circuit2MIDI's (js/song.js): scenes, pattern chains, step
// timing, micro-steps, gates, ties, swing. On top of that this keeps the live state the
// Circuit Tracks has while playing: the selected scene and scene chain, each track's pattern
// chain (as chosen in Patterns view), mutes, levels, tempo and swing.
import { readProject, isEmpty } from '../pack.js?v=20261122b';
import { songOf, renderSong, STEP_TICKS, PPQ } from '../song.js?v=20261123c';
import { Player } from '../player.js?v=20261122b';
import { serializeNCS } from '../vendor/ncs.js';
import { snapToScale, CHROMATIC } from '../scales.js';

const NCS_PATCH_SLOT = [0xcd64, 0xcd6c];   // Synth 1 / Synth 2: the pack slot the project plays
const NCS_DEFAULT_DRUMS = 0x1a278;          // 4 bytes: each drum track's sample (its active sample)
const STORED_NOTE_OFFSET = 12;             // stored synth note = MIDI note + 12 - scale root
const MAX_NOTES = 6;                       // notes per synth / MIDI step
export const FULL_GATE = 6;                // a gate of one step, in sixths of a step
const LOOP_SECONDS = 600;   // the arrangement is repeated to fill this, so loops are seamless
const MAX_REPEATS = 64;
const stepTicks = (rate) => STEP_TICKS[rate] ?? 360;

function stepOrder(pat) {
  const fwd = [];
  for (let i = pat.start; i <= pat.end; i++) fwd.push(i);
  if (pat.dir === 1) return fwd.reverse();
  if (pat.dir === 2 && fwd.length > 2) return [...fwd, ...fwd.slice(1, -1).reverse()];
  return fwd;
}

// pack: PatchWorker's pack (js/pw/packio.js openPack). Returns the 64 project slots:
// { slot, name, empty, project (parsed, or null), error }.
export function packProjects(pack) {
  if (pack.projectList) return pack.projectList;
  const out = [];
  for (const [i, p] of (pack.index.projects ?? []).entries()) {
    const entry = { slot: i, name: p?.name ?? '', url: p?.url, empty: true, project: null, error: null };
    const data = p?.url ? pack.files.get(p.url) : null;
    if (data) {
      try {
        entry.project = readProject('circuit-tracks', data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
        entry.empty = isEmpty('circuit-tracks', entry.project);
        if (!entry.name) entry.name = entry.project.name ?? '';
      } catch (e) { entry.error = e.message; }
    }
    out.push(entry);
  }
  while (out.length < 64) out.push({ slot: out.length, name: '', empty: true, project: null, error: null });
  pack.projectList = out;
  return out;
}

// The pack as js/song.js expects it (names and presence of patches and samples).
function songPack(pack, patchName) {
  const samples = (pack.index.samples ?? []).map((s) => ({ name: s?.name ?? '', url: s?.url, present: !!(s?.url && pack.files.has(s.url)) }));
  const patches = pack.patches.map((b, i) => ({ name: patchName(i) }));
  return { product: 'circuit-tracks', samples, patches };
}

export class ProjectPlayer {
  // opts: { patchBytes(slot) -> the pack's 340-byte patch array (the live one, so edits are heard),
  //   patchName(slot), original(slot) -> the pack's patch as opened, onChange(), onStep(pos) }
  constructor(opts) {
    this.o = opts;
    this.player = new Player();
    this.pack = null;
    this.entry = null;       // the project slot entry
    this.song = null;
    this.mutes = new Array(8).fill(false);
    this.levels = null;      // per track 0-127 (MIDI tracks: 127)
    this.render = null;      // { order, rendered, scenes (song with the live scene), loop, events }
    this.masterFilter = 64;  // the panel's Master Filter knob (64 = off), as CC 74 on channel 16
    this.player.onPosition = (pos) => this.tickAt(pos);
    this.player.onEnd = () => { if (this.wantPlay) this.start(0); else this.o.onChange?.(); };
  }

  get loaded() { return !!this.song; }
  get playing() { return this.player.playing; }

  // Load project `slot` of `pack`. Synth 1 / 2 play the pack's patches in the project's slots.
  async load(pack, slot) {
    const list = packProjects(pack);
    const entry = list[slot];
    if (!entry?.project || entry.project.empty) return false;
    const was = this.playing;
    this.stop();
    this.pack = pack;
    this.entry = entry;
    const proj = entry.project;
    this.song = songOf(songPack(pack, this.o.patchName), entry);
    this.tempo = proj.tempo ?? 120;
    this.swing = proj.swing ?? 50;
    // Which pack slot each synth plays; a project whose own copy has drifted from the pack keeps
    // its copy until another patch is chosen for that synth.
    this.patchSlots = proj.patchSlots.slice(0, 2);
    this.ownCopy = [0, 1].map((i) => {
      const copy = i === 0 ? proj.synth1Patch : proj.synth2Patch;
      const orig = this.o.original(this.patchSlots[i]);
      const same = copy && orig && copy.length >= 340 && orig.every((v, k) => v === copy[k]);
      return same ? null : copy;
    });
    this.scene = 0;
    const c = this.song.sceneChain;
    this.sceneChain = { start: c.start, end: c.end };
    this.scene = c.start;
    this.sel = this.song.scenes[this.scene].chains.map((x) => ({ ...x }));
    this.custom = false;     // patterns changed since the scene was chosen
    this.mutes.fill(false);
    this.player.mutes.fill(false);
    this.player.solo = -1;
    this.player.setProject(proj, { patches: [0, 1].map((i) => this.ownCopy[i] ?? this.o.patchBytes(this.patchSlots[i])) });
    this.masterFilter = this.player.mix?.filter?.cutoff ?? 64;
    this.levels = [0, 1, 2, 3, 4, 5, 6, 7].map((t) => (t < 2 ? this.player.mix.synth[t].level : t >= 4 ? this.player.mix.drums[t - 4].level : 127));
    this.rerender();
    this.linkSynths();
    await this.loadSamples();
    this.o.onChange?.();
    if (was) this.play();
    return true;
  }

  // Forget the project (another pack was opened).
  unload() {
    this.stop();
    this.song = null;
    this.entry = null;
    this.render = null;
    this.pack = null;
    this.o.onChange?.();
  }

  // The player's browser synths play the pack's own arrays, so edits made in the editor are heard.
  linkSynths() {
    this.player.ensure();
    if (!this.player.synths) return;
    for (let i = 0; i < 2; i++) {
      const syn = this.player.synths[i];
      if (!syn) continue;
      syn.setPatch(this.ownCopy[i] ? new Uint8Array(this.ownCopy[i]) : this.o.patchBytes(this.patchSlots[i]));
      syn.bpm = this.tempo;
    }
  }

  // A patch was edited: refresh the synth(s) playing that slot.
  patchChanged(slot) {
    for (let i = 0; i < 2; i++) if (!this.ownCopy?.[i] && this.patchSlots?.[i] === slot) this.player.synths?.[i]?.refresh();
  }

  // Choose the patch Synth i plays (as in the Circuit Tracks' Preset view). Not saved in the project.
  setPatchSlot(i, slot) {
    if (!this.loaded || this.patchSlots[i] === slot && !this.ownCopy[i]) return;
    this.patchSlots[i] = slot;
    this.ownCopy[i] = null;
    this.player.synths?.[i]?.setPatch(this.o.patchBytes(slot));
    this.o.onChange?.();
  }

  async loadSamples() {
    const used = new Set();
    for (const tr of this.song.tracks) {
      if (tr.kind !== 'drum') continue;
      if (tr.defaultSample != null) used.add(tr.defaultSample);
      for (const pat of tr.patterns) for (const s of pat.steps) for (const h of s.hits) if (h.sample != null) used.add(h.sample);
    }
    const map = new Map();
    for (const slot of used) {
      const url = this.pack.index.samples?.[slot]?.url;
      const data = url ? this.pack.files.get(url) : null;
      if (data) map.set(`s${slot}`, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    }
    try { await this.player.setDrumSamples(map); } catch { /* no audio yet: decoded on first play */ }
  }

  // ---- what plays
  // The song with the live pattern selection as an extra scene (index 16) when it has changed.
  arrangement() {
    const song = { ...this.song, swing: this.swing, scenes: this.song.scenes.slice() };
    let order;
    if (this.custom) {
      song.scenes.push({ index: 16, used: true, mask: 0, chains: this.sel.map((c) => ({ ...c })) });
      order = [16];
    } else {
      order = [];
      for (let s = this.sceneChain.start; s <= this.sceneChain.end; s++) order.push(s);
    }
    return { song, order };
  }

  rerender() {
    const { song, order } = this.arrangement();
    const sceneMutes = !this.custom && this.song.muteRecall !== 0;
    const rendered = renderSong(song, { order, swing: true, chance: 'keep', sceneMutes });
    const sec = (tick) => (tick / PPQ) * (60 / this.tempo);
    const loop = sec(rendered.length);
    const reps = loop > 0 ? Math.max(1, Math.min(MAX_REPEATS, Math.ceil(LOOP_SECONDS / loop))) : 1;
    const events = [];
    for (let r = 0; r < reps; r++) {
      const off = r * loop;
      for (const h of rendered.hits) {
        const tr = this.song.tracks[h.track];
        const t = off + sec(h.tick);
        const d = sec(h.dur);
        if (tr.kind === 'drum') {
          if (h.sample != null) events.push({ t, d, track: h.track, note: 60, vel: h.vel, part: `s${h.sample}`, choke: true });
        } else events.push({ t, d, track: h.track, note: h.note, vel: h.vel, program: 80, env: tr.env });
      }
    }
    this.render = { song, order, rendered, loop, reps, events };
  }

  // ---- transport
  async play(from = 0) {
    if (!this.loaded) return;
    this.wantPlay = true;
    await this.start(from);
    this.o.onChange?.();
  }
  async start(from) {
    if (!this.render) this.rerender();
    const { events, loop, reps } = this.render;
    if (!loop) return;
    await this.player.play(events, { from, length: loop * reps });
    this.linkSynths();
    this.player.applyGains();
    this.applyLevels();
    this.applyFilter();
  }
  // Master Filter: below 64 low-pass, above 64 high-pass, 64 off; resonance from the project.
  setMasterFilter(v) { this.masterFilter = v; this.applyFilter(); }
  applyFilter() { this.player.mixer?.setFilter(this.masterFilter, this.player.mix?.filter?.resonance ?? 64); }
  stop() {
    this.wantPlay = false;
    this.player.stop();
    this.o.onStep?.(null);
    this.o.onChange?.();
  }
  toggle() { if (this.playing) this.stop(); else this.play(); }

  // Something that changes the arrangement: restart it (from the top when `fromTop`, otherwise at
  // the same point in the loop).
  changed(fromTop) {
    const pos = this.playing ? this.player.position : null;
    this.rerender();
    if (pos != null) this.start(fromTop ? 0 : pos % (this.render.loop || 1));
    this.o.onChange?.();
  }

  // ---- scenes and patterns (Mixer and Patterns views)
  selectScene(i, { chain = false } = {}) {
    if (!this.loaded) return;
    if (chain) this.sceneChain = { start: Math.min(this.scene, i), end: Math.max(this.scene, i) };
    else { this.scene = i; this.sceneChain = { start: i, end: i }; }
    this.scene = this.sceneChain.start;
    this.sel = this.song.scenes[this.scene].chains.map((x) => ({ ...x }));
    this.custom = false;
    this.changed(true);
  }
  // Press a pattern pad: that pattern alone; with `extend`, a chain from the track's first
  // selected pattern to this one (chains are contiguous, as on the hardware).
  selectPattern(track, p, { extend = false } = {}) {
    if (!this.loaded) return;
    const c = this.sel[track];
    this.sel[track] = extend ? { start: Math.min(c.start, p), end: Math.max(c.start, p) } : { start: p, end: p };
    this.custom = true;
    this.changed(true);
  }
  sceneStored(i) { return !!this.song?.scenes[i]?.used; }

  // ---- step editing (Note, Velocity, Gate, Probability and Pattern Settings views)
  // Edits change the project loaded here (its parsed model, entry.project) and are heard at once.
  // They stay in this visit until saved into the pack (save()), as on the hardware until Save.
  get edited() { return !!this.entry?.edited; }
  raw(t, p) { return this.entry.project.patterns[t][p]; }
  get root() { return (this.entry.project.scaleRoot ?? 0) % 12; }
  get scaleType() { return this.entry.project.scaleType ?? CHROMATIC; }
  // Scales view: root 0-11 (transposes the synth and MIDI notes) and scale 0-15. Saved with Save.
  setScale(root, type) {
    const p = this.entry.project;
    if (root != null) p.scaleRoot = root;
    if (type != null) p.scaleType = type;
    this.edit();
  }
  isDrum(t) { return t >= 4; }
  // After any edit: rebuild the song model, keep what is selected, re-render (at the same point).
  edit() {
    this.entry.edited = true;
    this.song = songOf(songPack(this.pack, this.o.patchName), this.entry);
    this.changed(false);
  }
  // The notes on a synth / MIDI step as MIDI notes: [{ j, note, vel, gate, tie, delay }].
  stepNotes(t, p, k) {
    const s = this.raw(t, p).steps[k];
    if (this.isDrum(t)) return [];
    const out = [];
    // The note as it sounds: in the scale (snapped if the scale was changed), above the root.
    s.notes.forEach((n, j) => { if ((s.mask >> j) & 1) out.push({ j, note: snapToScale(n.note - STORED_NOTE_OFFSET, this.scaleType) + this.root, vel: n.velocity, gate: n.gate & 0x7f, tie: (n.gate & 0x80) !== 0, delay: n.delay }); });
    return out;
  }
  stepHas(t, p, k) {
    const s = this.raw(t, p).steps[k];
    return this.isDrum(t) ? !!s.active : !!(s.mask & 0x3f);
  }
  // Add a note to a synth / MIDI step, or remove it if the step has it. A new note takes the step's
  // gate and micro step from the notes already there (they belong to the step on the hardware).
  // Returns 'added', 'removed' or 'full'.
  toggleNote(t, p, k, note, vel) {
    const s = this.raw(t, p).steps[k];
    const stored = note + STORED_NOTE_OFFSET - this.root;
    if (stored < 0 || stored > 127) return 'full';
    const have = this.stepNotes(t, p, k);
    const hit = have.find((n) => n.note === note);
    if (hit) { s.mask &= ~(1 << hit.j); this.edit(); return 'removed'; }
    let j = -1;
    for (let i = 0; i < MAX_NOTES; i++) if (!((s.mask >> i) & 1)) { j = i; break; }
    if (j < 0) return 'full';
    const tpl = have[0] ? s.notes[have[0].j] : null;
    s.notes[j] = { note: stored, gate: tpl ? tpl.gate : FULL_GATE, delay: tpl ? tpl.delay : 0, velocity: Math.max(1, Math.min(127, vel)) };
    if (!have.length) s.probability = 7;
    s.mask |= 1 << j;
    this.edit();
    return 'added';
  }
  // Piano roll: notes one at a time. note is the MIDI note as it sounds (in the scale); gate in
  // sixths of a step (1-96). addNote returns false when the step has 6 notes or that note already.
  addNote(t, p, k, note, vel, gate = FULL_GATE, { commit = true } = {}) {
    const s = this.raw(t, p).steps[k];
    const stored = note + STORED_NOTE_OFFSET - this.root;
    if (stored < 0 || stored > 127) return false;
    const have = this.stepNotes(t, p, k);
    if (have.some((n) => n.note === note)) return false;
    let j = -1;
    for (let i = 0; i < MAX_NOTES; i++) if (!((s.mask >> i) & 1)) { j = i; break; }
    if (j < 0) return false;
    const tpl = have[0] ? s.notes[have[0].j] : null;
    s.notes[j] = { note: stored, gate: Math.max(1, Math.min(96, gate)), delay: tpl ? tpl.delay : 0, velocity: Math.max(1, Math.min(127, vel)) };
    if (!have.length) s.probability = 7;
    s.mask |= 1 << j;
    if (commit) this.edit();
    return true;
  }
  removeNote(t, p, k, j, { commit = true } = {}) {
    this.raw(t, p).steps[k].mask &= ~(1 << j);
    if (commit) this.edit();
  }
  // Move a note to another step and / or pitch, keeping its gate and velocity. False (and nothing
  // changed) if the target step is full or has that note.
  moveNote(t, p, k, j, toK, toNote) {
    const s = this.raw(t, p).steps[k];
    const n = s.notes[j];
    const keep = { gate: n.gate & 0x7f, vel: n.velocity };
    this.removeNote(t, p, k, j, { commit: false });
    if (this.addNote(t, p, toK, toNote, keep.vel, keep.gate, { commit: false })) { this.edit(); return true; }
    s.mask |= 1 << j;   // put it back
    return false;
  }
  setNoteGate(t, p, k, j, g) { this.raw(t, p).steps[k].notes[j].gate = Math.max(1, Math.min(96, g)); this.edit(); }
  setNoteVelocity(t, p, k, j, v) { this.raw(t, p).steps[k].notes[j].velocity = Math.max(1, Math.min(127, v)); this.edit(); }
  setHitVelocity(t, p, k, v) { const s = this.raw(t, p).steps[k]; if (s.active) { s.velocity = Math.max(1, Math.min(127, v)); this.edit(); } }

  // Drum Note view: a tap toggles a hit with the track's sample (0xff: the track's own sample).
  toggleHit(t, p, k, sample, vel) {
    const s = this.raw(t, p).steps[k];
    if (s.active) { s.active = false; s.micro = null; }
    else {
      const dflt = this.entry.project.defaultDrums?.[t - 4];
      Object.assign(s, { active: true, micro: null, velocity: Math.max(1, Math.min(127, vel)), probability: 7, drumChoice: sample == null || sample === dflt ? 0xff : sample });
    }
    this.edit();
    return s.active;
  }
  // The sample a drum step plays (its own, after a sample flip, or the track's).
  stepSample(t, p, k) {
    const s = this.raw(t, p).steps[k];
    if (!s.active) return null;
    return s.drumChoice === 0xff ? this.entry.project.defaultDrums?.[t - 4] : s.drumChoice;
  }
  // A drum track's active sample: hits without a sample of their own play it (Note view: a tap on
  // a sample pad; Preset view). Kept in both places the project stores it (0x1A278 and the drum
  // config's first byte; which one the unit loads is unconfirmed, see the file-format notes).
  setDrumSample(t, slot) {
    const p = this.entry.project;
    if (p.defaultDrums[t - 4] === slot) return;
    p.defaultDrums[t - 4] = slot;
    if (p.drumConfigs?.[t - 4]) p.drumConfigs[t - 4].patchSelect = slot;
    this.edit();
  }
  // Sample flip (User Guide p. 62): the step plays this sample instead of the track's. A step that
  // already plays it loses its hit.
  // keep: give the step the sample even if it already plays it (a step armed by a long press).
  flipStep(t, p, k, slot, vel, { keep = false } = {}) {
    const s = this.raw(t, p).steps[k];
    const dflt = this.entry.project.defaultDrums?.[t - 4];
    const choice = slot === dflt ? 0xff : slot;
    if (s.active && s.drumChoice === choice) { if (keep) return true; s.active = false; s.micro = null; }
    else if (s.active) s.drumChoice = choice;
    else Object.assign(s, { active: true, micro: null, velocity: Math.max(1, Math.min(127, vel)), probability: 7, drumChoice: choice });
    this.edit();
    return s.active;
  }
  // Clear: every note or hit on the step goes, and its probability returns to 100%.
  clearStep(t, p, k) {
    const s = this.raw(t, p).steps[k];
    if (this.isDrum(t)) Object.assign(s, { active: false, micro: null, probability: 7, drumChoice: 0xff });
    else { s.mask = 0; s.probability = 7; }
    this.edit();
  }
  // Duplicate: the step's notes and their settings onto another step (replacing what was there).
  copyStep(t, p, from, to) {
    if (from === to) return;
    const steps = this.raw(t, p).steps;
    steps[to] = structuredClone(steps[from]);
    this.edit();
  }
  setVelocity(t, p, k, v) {
    const s = this.raw(t, p).steps[k];
    v = Math.max(1, Math.min(127, v));
    if (this.isDrum(t)) { if (!s.active) return; s.velocity = v; } else {
      const have = this.stepNotes(t, p, k);
      if (!have.length) return;
      for (const n of have) s.notes[n.j].velocity = v;
    }
    this.edit();
  }
  // Gate in sixths of a step (1-96). Setting it ends a tie into the next step.
  setGate(t, p, k, g) {
    if (this.isDrum(t)) return;
    const s = this.raw(t, p).steps[k];
    const have = this.stepNotes(t, p, k);
    if (!have.length) return;
    for (const n of have) s.notes[n.j].gate = Math.max(1, Math.min(96, g));
    this.edit();
  }
  // Probability 0-7 (7 = 100%, each step down 12.5%).
  setProbability(t, p, k, v) {
    if (!this.stepHas(t, p, k)) return;
    this.raw(t, p).steps[k].probability = Math.max(0, Math.min(7, v));
    this.edit();
  }
  // Pattern Settings: start and end steps (0-31), sync rate (0-7 as stored: 1/32T ... 1/4) and
  // play order (0 forward, 1 reverse, 2 ping-pong, 3 random).
  setEnd(t, p, k) {
    const st = this.raw(t, p).settings;
    st.playbackEnd = k;
    if (st.playbackStart > k) st.playbackStart = k;
    this.edit();
  }
  setStart(t, p, k) {
    const st = this.raw(t, p).settings;
    st.playbackStart = k;
    if (st.playbackEnd < k) st.playbackEnd = k;
    this.edit();
  }
  setRate(t, p, r) { this.raw(t, p).settings.syncRate = r; this.edit(); }
  setDirection(t, p, d) { this.raw(t, p).settings.direction = d; this.edit(); }
  // 1-16/17-32: a pattern of 16 steps or fewer becomes 32 steps; with Clear back to 16 (the steps
  // after 16 are kept, unheard); with Duplicate steps 1-16 (and their automation) are copied to
  // 17-32 and the pattern becomes 32 steps.
  extendPattern(t, p) { const st = this.raw(t, p).settings; st.playbackEnd = 31; this.edit(); }
  shortenPattern(t, p) {
    const st = this.raw(t, p).settings;
    st.playbackEnd = Math.min(st.playbackEnd, 15);
    if (st.playbackStart > st.playbackEnd) st.playbackStart = 0;
    this.edit();
  }
  doublePattern(t, p) {
    const pat = this.raw(t, p);
    for (let k = 0; k < 16; k++) pat.steps[k + 16] = structuredClone(pat.steps[k]);
    for (const locks of Object.values(pat.paramLocks ?? {})) {
      for (const pos of Object.keys(locks)) if (+pos >= 16) delete locks[pos];
      for (const [pos, v] of Object.entries(locks)) if (+pos < 16) locks[Math.round((+pos + 16) * 1000) / 1000] = v;
    }
    pat.settings.playbackEnd = 31;
    if (pat.settings.playbackStart > 15) pat.settings.playbackStart = 0;
    this.edit();
  }

  // ---- saving into the pack (the pack open in the browser; Download pack writes it out)
  // Save as on the hardware: the steps, tempo and swing, and the patch each synth plays (its slot
  // and the project's own copy of it). slot: the project slot to save into (default: this one; the
  // original stays as it was saved when another slot is chosen). Returns the saved entry.
  save(slot = this.entry.slot) {
    const pack = this.pack, src = this.entry, proj = src.project;
    proj.tempo = this.tempo;
    proj.swing = this.swing;
    const patches = [0, 1].map((i) => new Uint8Array(this.ownCopy[i] ?? this.o.patchBytes(this.patchSlots[i])));
    proj.synth1Patch = patches[0];
    proj.synth2Patch = patches[1];
    proj.patchSlots = this.patchSlots.slice();
    const base = pack.files.get(src.url);
    const out = serializeNCS(proj, base);
    NCS_PATCH_SLOT.forEach((o, i) => { out[o] = this.patchSlots[i]; });
    proj.defaultDrums.forEach((v, i) => { out[NCS_DEFAULT_DRUMS + i] = v; });
    pack.index.projects ??= [];
    for (let i = pack.index.projects.length; i < 64; i++) pack.index.projects.push({ name: '', url: `projects/project_${i}.ncs` });
    const url = pack.index.projects[slot]?.url || `projects/project_${slot}.ncs`;
    const name = src.name || proj.name || '';
    pack.index.projects[slot] = { ...pack.index.projects[slot], name, url };
    pack.files.set(url, out);
    (pack.savedProjects ??= new Set()).add(slot);
    const list = packProjects(pack);
    const fresh = { slot, name, url, empty: false, project: readProject('circuit-tracks', out.slice().buffer), error: null, edited: false };
    fresh.empty = isEmpty('circuit-tracks', fresh.project);
    if (slot !== src.slot) this.revertEntry(src);   // the original keeps its saved version
    list[slot] = fresh;
    this.entry = fresh;
    this.song = songOf(songPack(pack, this.o.patchName), fresh);
    this.ownCopy = this.ownCopy.map((c, i) => (c ? patches[i] : null));
    this.o.onChange?.();
    return fresh;
  }
  // Put a project slot back as it is saved in the pack (unsaved edits are dropped).
  revertEntry(entry) {
    const data = this.pack.files.get(entry.url);
    entry.project = readProject('circuit-tracks', data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    entry.empty = isEmpty('circuit-tracks', entry.project);
    entry.edited = false;
  }
  // Revert the loaded project to its saved version, keeping the scene and patterns chosen.
  revert() {
    if (!this.edited) return;
    this.revertEntry(this.entry);
    this.song = songOf(songPack(this.pack, this.o.patchName), this.entry);
    this.changed(false);
  }
  patternHasNotes(track, p) { return !!this.song?.tracks[track].patterns[p]?.steps.some((s) => s.hits.length); }

  // ---- mixer
  setMute(t, on) { this.mutes[t] = on; this.player.setMute(t, on); this.o.onChange?.(); }
  setLevel(t, v) { this.levels[t] = v; this.applyLevels(); this.o.onChange?.(); }
  applyLevels() {
    const mx = this.player.mixer;
    if (!mx || !this.levels) return;
    for (let t = 0; t < 8; t++) { const s = mx.strips[t]; if (s.cfg) mx.setStrip(t, { ...s.cfg, level: this.levels[t] }); }
  }

  // ---- tempo and swing
  setTempo(bpm) {
    this.tempo = Math.max(40, Math.min(240, Math.round(bpm)));
    for (const syn of this.player.synths ?? []) if (syn) { syn.bpm = this.tempo; syn.refresh(); }
    this.changed(false);
  }
  setSwing(v) { this.swing = Math.max(20, Math.min(80, Math.round(v))); this.changed(false); }

  // ---- where the play head is: the scene playing, and each track's pattern and step
  tickAt(pos) {
    if (!this.render?.loop) return;
    const { rendered, song, loop } = this.render;
    const tick = ((pos % loop) / (60 / this.tempo)) * PPQ;
    const sc = rendered.sceneStarts.find((s) => tick >= s.tick && tick < s.tick + s.length) ?? rendered.sceneStarts[0];
    if (!sc) return;
    const t0 = tick - sc.tick;
    const tracks = this.song.tracks.map((tr) => {
      const c = song.scenes[sc.scene].chains[tr.index];
      let total = 0;
      for (let p = c.start; p <= c.end; p++) total += stepOrder(tr.patterns[p]).length * stepTicks(tr.patterns[p].rate);
      if (!total) return null;
      let t = t0 % total;
      for (let p = c.start; p <= c.end; p++) {
        const pat = tr.patterns[p];
        const ord = stepOrder(pat);
        const len = ord.length * stepTicks(pat.rate);
        if (t < len) return { pattern: p, step: ord[Math.floor(t / stepTicks(pat.rate))] };
        t -= len;
      }
      return null;
    });
    this.o.onStep?.({ scene: sc.scene < 16 ? sc.scene : null, tracks, beat: Math.floor(tick / PPQ) });
  }
}
