// PatchWorker's Offline player: plays a project from the pack open in the browser, through the
// browser synth (Synth 1 / 2 on the pack's patches, so edits are heard in context), the pack's
// drum samples and the project mixer measured on the hardware (js/pw/mixer.js, set 7).
//
// The song model and rendering are Circuit2MIDI's (js/song.js): scenes, pattern chains, step
// timing, micro-steps, gates, ties, swing. On top of that this keeps the live state the
// Circuit Tracks has while playing: the selected scene and scene chain, each track's pattern
// chain (as chosen in Patterns view), mutes, levels, tempo and swing.
import { readProject, isEmpty } from '../pack.js?v=20261122b';
import { songOf, renderSong, STEP_TICKS, PPQ } from '../song.js?v=20261122b';
import { Player } from '../player.js?v=20261122b';

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
  }
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
