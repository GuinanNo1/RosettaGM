/* MIDI2Move core: format-independent song model -> Move Set (.ablbundle).
   Runs in browsers and Node (uses DecompressionStream for zip inflate). No dependencies. */
(function (root) {
'use strict';
const M2M = {};

/* ------------------------------------------------------------------ zip */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
const enc = new TextEncoder(), dec = new TextDecoder();

M2M.writeZip = function (files) {           // files: [{name, data:Uint8Array}] -> Uint8Array (STORE, UTF-8 names)
  const parts = [], central = []; let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), d = f.data, crc = crc32(d);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, 0, true); h.setUint16(12, 0x21, true); h.setUint32(14, crc, true); h.setUint32(18, d.length, true);
    h.setUint32(22, d.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), name, d);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true); c.setUint16(12, 0, true); c.setUint16(14, 0x21, true); c.setUint32(16, crc, true);
    c.setUint32(20, d.length, true); c.setUint32(24, d.length, true); c.setUint16(28, name.length, true);
    c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + d.length;
  }
  const csize = central.reduce((a, b) => a + b.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, csize, true); e.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(e.buffer)];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0)); let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
};

async function inflateRaw(u8) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([u8]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
M2M.readZip = async function (buf) {        // -> {name: Uint8Array}
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eo = u8.length - 22; while (eo >= 0 && dv.getUint32(eo, true) !== 0x06054b50) eo--;
  if (eo < 0) throw new Error('not a zip file');
  const n = dv.getUint16(eo + 10, true); let p = dv.getUint32(eo + 16, true); const out = {};
  for (let i = 0; i < n; i++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    const lo = dv.getUint32(p + 42, true), name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
    const ds = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    const raw = u8.subarray(ds, ds + csize);
    out[name] = method === 0 ? raw.slice() : await inflateRaw(raw);
    p += 46 + nl + xl + cl;
  }
  return out;
};

/* ------------------------------------------- float-preserving JSON
   Move/Live JSON distinguishes 12.0 (float) from 12 (int). JS numbers don't, so floats are boxed in F. */
class F { constructor(v) { this.v = +v; } valueOf() { return this.v; } }
M2M.F = F;
const f = v => new F(v);
M2M.jparse = function (txt) {
  let i = 0;
  const ws = () => { while (' \t\n\r'.includes(txt[i])) i++; };
  const val = () => {
    ws(); const c = txt[i];
    if (c === '{') { i++; const o = {}; ws(); if (txt[i] === '}') { i++; return o; }
      for (;;) { ws(); const k = val(); ws(); i++; o[k] = val(); ws(); if (txt[i++] === '}') return o; } }
    if (c === '[') { i++; const a = []; ws(); if (txt[i] === ']') { i++; return a; }
      for (;;) { a.push(val()); ws(); if (txt[i++] === ']') return a; } }
    if (c === '"') { let j = i + 1; while (txt[j] !== '"') j += txt[j] === '\\' ? 2 : 1; const s = JSON.parse(txt.slice(i, j + 1)); i = j + 1; return s; }
    if (txt.startsWith('true', i)) { i += 4; return true; }
    if (txt.startsWith('false', i)) { i += 5; return false; }
    if (txt.startsWith('null', i)) { i += 4; return null; }
    const m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(txt.slice(i, i + 40)); i += m[0].length;
    return (m[1] || m[2]) ? new F(m[0]) : Number(m[0]);
  };
  return val();
};
function fmtFloat(v) { if (!isFinite(v)) return '0.0'; const s = String(v); return /[.eE]/.test(s) ? s : s + '.0'; }
M2M.jstr = function (o, ind = 2) {
  const go = (x, d) => {
    if (x instanceof F) return fmtFloat(x.v);
    if (x === null || typeof x !== 'object') return JSON.stringify(x);
    const pad = ' '.repeat(ind * (d + 1)), end = ' '.repeat(ind * d);
    if (Array.isArray(x)) return x.length ? '[\n' + x.map(y => pad + go(y, d + 1)).join(',\n') + '\n' + end + ']' : '[]';
    const ks = Object.keys(x).filter(k => x[k] !== undefined);
    return ks.length ? '{\n' + ks.map(k => pad + JSON.stringify(k) + ': ' + go(x[k], d + 1)).join(',\n') + '\n' + end + '}' : '{}';
  };
  return go(o, 0);
};
const deep = x => x instanceof F ? new F(x.v) : Array.isArray(x) ? x.map(deep) : (x && typeof x === 'object') ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, deep(v)])) : x;
M2M.deep = deep;

/* ------------------------------------------------------------------ MIDI */
M2M.parseMidi = function (u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const str = (o, l) => String.fromCharCode(...u8.subarray(o, o + l));
  if (str(0, 4) !== 'MThd') throw new Error('not a MIDI file');
  const fmt = dv.getUint16(8), ntr = dv.getUint16(10), div = dv.getUint16(12);
  if (div & 0x8000) throw new Error('SMPTE-timed MIDI files are not supported');
  const ppq = div; let p = 8 + dv.getUint32(4);
  const events = []; const trackNames = [];
  for (let t = 0; t < ntr && p < u8.length; t++) {
    if (str(p, 4) !== 'MTrk') { p += 8 + dv.getUint32(p + 4); t--; continue; }
    const end = p + 8 + dv.getUint32(p + 4); p += 8;
    let tick = 0, rs = 0, tname = '';
    while (p < end) {
      let v = 0, b; do { b = u8[p++]; v = (v << 7) | (b & 0x7F); } while (b & 0x80); tick += v;
      let st = u8[p];
      if (st & 0x80) p++; else st = rs;
      if (st === 0xFF) {
        const type = u8[p++]; let len = 0; do { b = u8[p++]; len = (len << 7) | (b & 0x7F); } while (b & 0x80);
        const d = u8.subarray(p, p + len); p += len;
        if (type === 0x51) events.push({ tick, type: 'tempo', bpm: 60000000 / ((d[0] << 16) | (d[1] << 8) | d[2]) });
        else if (type === 0x58) events.push({ tick, type: 'timesig', num: d[0], den: 2 ** d[1] });
        else if (type === 0x03 && !tname) tname = dec.decode(d).replace(/\0/g, '').trim();
        else if (type === 0x2F) break;
        continue;
      }
      if (st === 0xF0 || st === 0xF7) { let len = 0; do { b = u8[p++]; len = (len << 7) | (b & 0x7F); } while (b & 0x80); p += len; continue; }
      rs = st; const hi = st & 0xF0, ch = st & 0x0F;
      if (hi === 0xC0 || hi === 0xD0) { const a = u8[p++]; if (hi === 0xC0) events.push({ tick, type: 'prog', ch, prog: a, trk: t }); continue; }
      const a = u8[p++], c = u8[p++];
      if (hi === 0xE0) { events.push({ tick, type: 'bend', ch, val: ((c << 7) | a) - 8192 }); continue; }
      if (hi === 0xB0 && (a === 100 || a === 101 || a === 6 || a === 38)) { events.push({ tick, type: 'rpn', ch, cc: a, val: c }); continue; }
      if (hi === 0x90 && c > 0) events.push({ tick, type: 'on', ch, note: a, vel: c, trk: t });
      else if (hi === 0x80 || hi === 0x90) events.push({ tick, type: 'off', ch, note: a, trk: t });
      else if (hi === 0xB0 && a === 0 ) events.push({ tick, type: 'bank', ch, val: c });
    }
    trackNames[t] = tname; p = end;
  }
  events.sort((x, y) => x.tick - y.tick || (x.type === 'off' ? -1 : 0) - (y.type === 'off' ? -1 : 0));
  const tempos = events.filter(e => e.type === 'tempo');
  const sig = events.find(e => e.type === 'timesig') || { num: 4, den: 4 };
  // notes per channel; program at note-on time
  const prog = new Array(16).fill(0), open = new Map(), notes = [], chTrack = new Array(16).fill(-1);
  const range = new Array(16).fill(2), rpnSel = Array.from({ length: 16 }, () => [127, 127]), bends = Array.from({ length: 16 }, () => []);
  for (const e of events) {
    if (e.type === 'rpn') {
      if (e.cc === 101) rpnSel[e.ch][0] = e.val; else if (e.cc === 100) rpnSel[e.ch][1] = e.val;
      else if (rpnSel[e.ch][0] === 0 && rpnSel[e.ch][1] === 0) { if (e.cc === 6) range[e.ch] = e.val; else range[e.ch] = Math.floor(range[e.ch]) + e.val / 100; }
      continue;
    }
    if (e.type === 'bend') { bends[e.ch].push({ t: e.tick / ppq, semis: e.val / (e.val >= 0 ? 8191 : 8192) * range[e.ch] }); continue; }
    if (e.type === 'prog') prog[e.ch] = e.prog;
    else if (e.type === 'on') {
      const k = e.ch * 128 + e.note; if (!open.has(k)) open.set(k, []);
      open.get(k).push({ ch: e.ch, n: e.note, v: e.vel, t0: e.tick, prog: prog[e.ch] });
      if (chTrack[e.ch] < 0) chTrack[e.ch] = e.trk;
    } else if (e.type === 'off') {
      const q = open.get(e.ch * 128 + e.note); if (q && q.length) { const o = q.shift(); o.t1 = e.tick; notes.push(o); }
    }
  }
  for (const q of open.values()) for (const o of q) { o.t1 = o.t0 + ppq / 4; notes.push(o); }
  const lastTick = notes.reduce((m, x) => Math.max(m, x.t1), 0);
  // pitch bend per note: value at the start, changes during the note, and the time-weighted average
  const bendAt = (bl, t) => { let lo = 0, hi = bl.length - 1, v = 0; while (lo <= hi) { const m = (lo + hi) >> 1; if (bl[m].t <= t + 1e-9) { v = bl[m].semis; lo = m + 1; } else hi = m - 1; } return v; };
  for (const o of notes) {
    const bl = bends[o.ch]; if (!bl.length) continue;
    const t0 = o.t0 / ppq, t1 = o.t1 / ppq;
    const pts = [{ t: 0, semis: bendAt(bl, t0) }];
    for (const b of bl) if (b.t > t0 + 1e-9 && b.t < t1 - 1e-9) pts.push({ t: b.t - t0, semis: b.semis });
    let acc = 0; for (let i = 0; i < pts.length; i++) { const e = i + 1 < pts.length ? pts[i + 1].t : t1 - t0; acc += pts[i].semis * (e - pts[i].t); }
    const avg = (t1 - t0) > 0 ? acc / (t1 - t0) : pts[0].semis;
    if (pts.some(p => Math.abs(p.semis) > 1e-3)) { o.bend = pts; o.bendAvg = avg; }
  }
  return {
    format: 'midi', ppq, smf: fmt,
    tempo: tempos.length ? tempos[0].bpm : 120, tempoChanges: new Set(tempos.map(t => Math.round(t.bpm * 10))).size,
    sig: { num: sig.num, den: sig.den },
    lengthBeats: lastTick / ppq,
    notes: notes.map(x => { const o = { ch: x.ch, n: x.n, v: x.v, t: x.t0 / ppq, d: Math.max(1 / 64, (x.t1 - x.t0) / ppq), prog: x.prog };
      if (x.bend) { o.bend = x.bend; o.bendAvg = x.bendAvg; } return o; }),
    bendRange: range,
    trackNames, chTrack,
  };
};

/* ---------------------------------------------- song model -> parts */
M2M.GM = ["Acoustic Grand Piano","Bright Acoustic Piano","Electric Grand Piano","Honky-tonk Piano","Electric Piano 1","Electric Piano 2","Harpsichord","Clavinet","Celesta","Glockenspiel","Music Box","Vibraphone","Marimba","Xylophone","Tubular Bells","Dulcimer","Drawbar Organ","Percussive Organ","Rock Organ","Church Organ","Reed Organ","Accordion","Harmonica","Tango Accordion","Nylon Guitar","Steel Guitar","Jazz Guitar","Clean Guitar","Muted Guitar","Overdriven Guitar","Distortion Guitar","Guitar Harmonics","Acoustic Bass","Fingered Bass","Picked Bass","Fretless Bass","Slap Bass 1","Slap Bass 2","Synth Bass 1","Synth Bass 2","Violin","Viola","Cello","Contrabass","Tremolo Strings","Pizzicato Strings","Orchestral Harp","Timpani","String Ensemble 1","String Ensemble 2","Synth Strings 1","Synth Strings 2","Choir Aahs","Voice Oohs","Synth Voice","Orchestra Hit","Trumpet","Trombone","Tuba","Muted Trumpet","French Horn","Brass Section","Synth Brass 1","Synth Brass 2","Soprano Sax","Alto Sax","Tenor Sax","Baritone Sax","Oboe","English Horn","Bassoon","Clarinet","Piccolo","Flute","Recorder","Pan Flute","Blown Bottle","Shakuhachi","Whistle","Ocarina","Square Lead","Saw Lead","Calliope Lead","Chiff Lead","Charang Lead","Voice Lead","Fifths Lead","Bass + Lead","New Age Pad","Warm Pad","Polysynth Pad","Choir Pad","Bowed Pad","Metallic Pad","Halo Pad","Sweep Pad","Rain FX","Soundtrack FX","Crystal FX","Atmosphere FX","Brightness FX","Goblins FX","Echoes FX","Sci-fi FX","Sitar","Banjo","Shamisen","Koto","Kalimba","Bagpipe","Fiddle","Shanai","Tinkle Bell","Agogo","Steel Drums","Woodblock","Taiko Drum","Melodic Tom","Synth Drum","Reverse Cymbal","Guitar Fret Noise","Breath Noise","Seashore","Bird Tweet","Telephone Ring","Helicopter","Applause","Gunshot"];

function maxPoly(notes) {
  const ev = []; for (const x of notes) { ev.push([x.t, 1]); ev.push([x.t + x.d - 1e-6, -1]); }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]); let c = 0, m = 0; for (const [, s] of ev) { c += s; m = Math.max(m, c); } return m;
}
function polyStats(notes) {             // fraction of note starts that overlap another sounding note
  if (notes.length < 2) return 0;
  const s = [...notes].sort((a, b) => a.t - b.t); let ov = 0, end = -1;
  for (const x of s) { if (x.t < end - 1e-4) ov++; end = Math.max(end, x.t + x.d); }
  return ov / s.length;
}

M2M.makeParts = function (song) {
  const by = new Map();
  for (const x of song.notes) {
    const drum = x.ch === 9;
    const key = drum ? 'd9' : x.ch + ':' + x.prog;         // split a channel by program
    if (!by.has(key)) by.set(key, { key, ch: x.ch, prog: drum ? null : x.prog, drum, notes: [] });
    by.get(key).notes.push(x);
  }
  const parts = [...by.values()].map((p, i) => {
    const ns = p.notes.map(n => n.n);
    const name = p.drum ? 'Drums' : M2M.GM[p.prog];
    const tn = song.trackNames && song.chTrack ? song.trackNames[song.chTrack[p.ch]] : '';
    return Object.assign(p, {
      id: i, name, label: tn || '', count: p.notes.length, lo: Math.min(...ns), hi: Math.max(...ns),
      poly: maxPoly(p.notes), overlap: polyStats(p.notes), bends: p.notes.filter(n => n.bend).length,
      span: [Math.min(...p.notes.map(n => n.t)), Math.max(...p.notes.map(n => n.t + n.d))],
    });
  });
  parts.sort((a, b) => (b.drum - a.drum) || a.ch - b.ch || a.prog - b.prog);
  parts.forEach((p, i) => p.id = i);
  const seen = new Map();                 // identical note content on another channel -> duplicate
  for (const p of parts) {
    const sig = p.notes.map(n => n.n + '@' + n.t.toFixed(3)).sort().join(',');
    if (seen.has(sig)) p.dupOf = seen.get(sig); else seen.set(sig, p.id);
  }
  return parts;
};

/* ---------------------------------------------- assignment
   dest: 'drums' | 'track2' | 'track3' | 'track4' | 'pad' | 'skip'; sound: 'sampler' | 'drift' */
M2M.autoAssign = function (parts, manifest, opts = {}) {
  M2M._fold = manifest.fold_to_core || {};
  const drift = new Set((manifest.drift || []).map(d => d.program));
  const a = {}; for (const p of parts) a[p.id] = { dest: 'skip', sound: 'sampler' };
  const drums = parts.filter(p => p.drum).sort((x, y) => y.count - x.count);
  if (drums.length) a[drums[0].id].dest = 'drums';
  const mel = parts.filter(p => !p.drum);
  // importance: notes weighted by duration coverage
  const score = p => p.notes.reduce((s, n) => s + Math.min(n.d, 4), 0) + p.count * 0.25;
  const ranked = [...mel].filter(p => p.dupOf === undefined).sort((x, y) => score(y) - score(x));
  const tracks = drums.length ? ['track2', 'track3', 'track4'] : ['track1', 'track2', 'track3', 'track4'];
  const freePads = drums.length ? 16 - M2M.padsUsedByDrums(drums[0], opts.fold !== false).size : 0;
  let padsLeft = Math.min(freePads, opts.maxPads ?? 4);
  // polyphonic parts get tracks first; mono parts can go on pads
  const polyFirst = [...ranked].sort((x, y) => ((y.overlap > 0.05) - (x.overlap > 0.05)) || score(y) - score(x));
  const chosen = new Set();
  for (const p of polyFirst) { if (!tracks.length) break; if (p.overlap > 0.05 || ranked.indexOf(p) < 3) { a[p.id].dest = tracks.shift(); chosen.add(p.id); } }
  for (const p of ranked) if (!chosen.has(p.id) && tracks.length) { a[p.id].dest = tracks.shift(); chosen.add(p.id); }
  for (const p of ranked) if (!chosen.has(p.id) && padsLeft > 0 && p.overlap <= 0.25) { a[p.id].dest = 'pad'; a[p.id].voices = 1; padsLeft--; chosen.add(p.id); }
  for (const p of parts) if (!p.drum && drift.has(p.prog) && opts.preferDrift) a[p.id].sound = 'drift';
  if (!drums.length) for (const p of parts) if (a[p.id].dest === 'pad') a[p.id].dest = 'skip';
  return a;
};

M2M.padNote = function (gm, fold, foldMap) {         // GM drum note -> Move pad note (36-51) or null
  if (gm >= 36 && gm <= 51) return gm;
  if (!fold) return null;
  const f = foldMap[gm]; return f === undefined ? null : f;
};
M2M.padsUsedByDrums = function (part, fold, foldMap) {
  foldMap = foldMap || M2M._fold || {};
  const s = new Set(); for (const n of part.notes) { const p = M2M.padNote(n.n, fold, foldMap); if (p !== null) s.add(p); } return s;
};

/* ---------------------------------------------- arrangement */
M2M.arrange = function (song, parts, assign, opts = {}) {
  const barBeats = song.sig.num * 4 / song.sig.den;
  const used = parts.filter(p => assign[p.id] && assign[p.id].dest !== 'skip' && p.notes.length);
  const end = Math.max(...used.map(p => Math.max(...p.notes.map(n => n.t + n.d))), barBeats);
  const startBar = opts.startBar || 0;
  // match: 'exact' | 'loose' (ignore velocity, 1/24-beat timing) | number (similarity threshold, e.g. 0.9)
  const match = opts.match ?? (opts.loose === false ? 'exact' : 'loose');
  const thr = typeof match === 'number' ? match : 1;
  const q = t => match === 'exact' ? Math.round(t * 1000) : Math.round(t * 24);
  const totalBars = Math.max(1, Math.ceil(end / barBeats - 1e-6) - startBar);
  const cands = opts.sectionBars ? [opts.sectionBars] : [16, 8, 4].filter(S => S * barBeats <= 64 + 1e-6);
  if (!cands.length) cands.push(Math.max(1, Math.floor(64 / barBeats)));
  const dests = [...new Set(used.map(p => assign[p.id].dest))];
  const tokens = (t0, t1) => dests.map(d => used.filter(p => assign[p.id].dest === d).flatMap(p => p.notes
    .filter(n => n.t >= t0 - 1e-6 && n.t < t1 - 1e-6)
    .map(n => `${p.id}:${n.n},${q(n.t - t0)},${q(Math.min(n.d, t1 - n.t))}${match === 'exact' ? ',' + n.v : ''}`)));
  const jacc = (a, b) => { if (!a.length && !b.length) return 1; if (!a.length || !b.length) return 0;
    const A = new Set(a); let i = 0; for (const x of new Set(b)) if (A.has(x)) i++; return i / (A.size + new Set(b).size - i); };
  let best = null;
  for (const S of cands) {
    const len = S * barBeats, nsec = Math.ceil(totalBars / S), reps = [], order = [];
    for (let i = 0; i < nsec; i++) {
      const t0 = (startBar + i * S) * barBeats, tk = tokens(t0, t0 + len);
      let hit = -1;
      for (let r = 0; r < reps.length && hit < 0; r++) {
        const ok = tk.every((x, di) => thr >= 1 ? x.length === reps[r].tk[di].length && x.slice().sort().join() === reps[r].tk[di].slice().sort().join() : jacc(x, reps[r].tk[di]) >= thr);
        if (ok) hit = r;
      }
      if (hit < 0) { hit = reps.length; reps.push({ tk, first: i }); }
      order.push(hit);
    }
    const sets = []; let cur = null;
    for (let i = 0; i < nsec; i++) {
      const u = order[i];
      if (!cur || (!cur.map.has(u) && cur.map.size >= 8)) { cur = { map: new Map(), sceneSections: [], order: [] }; sets.push(cur); }
      if (!cur.map.has(u)) { cur.map.set(u, cur.sceneSections.length); cur.sceneSections.push(reps[u].first); }
      cur.order.push(cur.map.get(u));
    }
    const r = { sectionBars: S, sectionBeats: len, sections: nsec, order, unique: reps.length,
      sets: sets.map(x => ({ sceneSections: x.sceneSections, order: x.order })) };
    if (!best || r.sets.length < best.sets.length) best = r;
  }
  return Object.assign(best, { barBeats, startBar, totalBars, match });
};

/* Notes for a Melodic Sampler track: bends rounded to the nearest semitone (per-note bend on Sampler unconfirmed). */
M2M.bentNote = (n, useBends) => (useBends && n.bend && Math.abs(n.bendAvg) >= 0.5) ? n.n + Math.round(n.bendAvg) : n.n;

/* ---------------------------------------------- Set building */
const SEALS = { sampler: 1472017714, kit: -973461132, drumRack: 830049224, driftOuter: 812985650, driftInner: 278284 };
const PB_SEMI = 8192 / 48;
const clone = deep;
function encName(n) { return 'Samples/' + encodeURIComponent(n).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase()); }
M2M.encName = encName;

function trackDevice(preset, kind) {           // preset tree (from .ablpresetbundle) -> Set track device with seals
  const d = { presetUri: null, kind: 'instrumentRack', name: preset.name, lockId: 1001,
    lockSeal: kind === 'kit' ? SEALS.kit : kind === 'drift' ? SEALS.driftOuter : SEALS.sampler,
    parameters: clone(preset.parameters), chains: clone(preset.chains) };
  const inner = d.chains[0].devices[0];
  if (inner.kind === 'drumRack' || inner.kind === 'instrumentRack') {
    const { presetUri, kind: k, name, parameters, chains, returnChains } = inner;
    const x = { presetUri: null, kind: k, name, lockId: 1001, lockSeal: k === 'drumRack' ? SEALS.drumRack : SEALS.driftInner, parameters, chains };
    if (returnChains) x.returnChains = returnChains;
    d.chains[0].devices[0] = x;
  }
  return d;
}

/* Live/Move reject clips where two notes of the same pitch overlap ("document invariant violation").
   Same pitch + same start -> keep the louder/longer one; overlapping -> end the earlier note at the next start. */
function cleanNotes(ns) {
  const by = new Map();
  for (const n of ns) { const k = n.noteNumber; if (!by.has(k)) by.set(k, []); by.get(k).push(n); }
  const out = [];
  for (const list of by.values()) {
    list.sort((a, b) => +a.startTime - +b.startTime || +b.velocity - +a.velocity || +b.duration - +a.duration);
    const keep = [];
    for (const n of list) {
      const last = keep[keep.length - 1];
      if (last && Math.abs(+n.startTime - +last.startTime) < 1e-6) continue;
      if (last && +last.startTime + +last.duration > +n.startTime - 1e-9) {
        const gap = Math.floor((+n.startTime - +last.startTime) * 1e6 - 1) / 1e6;   // end strictly before next start
        if (gap <= 0) continue;                                                       // practically simultaneous: drop
        last.duration = new F(gap);
      }
      keep.push(n);
    }
    out.push(...keep);
  }
  return out;
}
M2M.cleanNotes = cleanNotes;

/* Spread a part over `voices` pads: each pad plays one note at a time. Chords keep the highest notes;
   when all pads are busy the pad that frees soonest is cut short. Returns one note list per pad. */
function allocateVoices(notes, voices) {
  const s = [...notes].sort((a, b) => a.t - b.t || b.n - a.n);
  const lanes = Array.from({ length: voices }, () => []), ends = new Array(voices).fill(-1);
  for (const x of s) {
    let k = -1;
    for (let i = 0; i < voices; i++) if (ends[i] <= x.t + 1e-6) { k = i; break; }
    if (k < 0) {                       // steal the voice that would end first (not one starting at the same time)
      let best = -1;
      for (let i = 0; i < voices; i++) { const last = lanes[i][lanes[i].length - 1]; if (last && last.t < x.t - 1e-4 && (best < 0 || ends[i] < ends[best])) best = i; }
      if (best < 0) continue;          // chord bigger than the voice count: drop the lower notes
      const last = lanes[best][lanes[best].length - 1]; last.d = Math.max(1 / 128, x.t - last.t); k = best;
    }
    lanes[k].push({ ...x }); ends[k] = x.t + x.d;
  }
  return lanes;
}
M2M.allocateVoices = allocateVoices;

function monoize(notes) {                      // highest-note priority, trim overlaps
  const s = [...notes].sort((a, b) => a.t - b.t || b.n - a.n), out = [];
  for (const x of s) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.t - x.t) < 1e-4) continue;          // chord: keep highest (sorted first)
    if (last && last.t + last.d > x.t) last.d = Math.max(1 / 64, x.t - last.t);
    out.push({ ...x });
  }
  return out;
}
M2M.monoize = monoize;

/* lib: { manifest, loadPreset(relPath) -> Promise<{preset, samples:{name:Uint8Array}}> }
   cfg: { name, kitIndex, fold } */
M2M.buildSet = async function (song, parts, assign, arr, lib, cfg) {
  const part = arr.sets[cfg.setIndex || 0];
  const man = lib.manifest, foldMap = man.fold_to_core;
  const prog = p => man.programs[p], driftOf = p => (man.drift || []).find(d => d.program === p);
  const samples = {}; const warnings = [];
  const addSamples = s => Object.assign(samples, s);
  const dests = ['drums', 'track1', 'track2', 'track3', 'track4'];
  const byDest = {}; for (const p of parts) { const a = assign[p.id]; if (a && a.dest !== 'skip') (byDest[a.dest] = byDest[a.dest] || []).push(p); }
  const hasDrums = !!byDest.drums;
  const slots = hasDrums ? ['drums', 'track2', 'track3', 'track4'] : ['track1', 'track2', 'track3', 'track4'];
  const colors = [20, 2, 8, 14];
  const S = arr.sectionBeats, a0 = s => (arr.startBar + s * arr.sectionBars) * arr.barBeats;
  const sceneSec = part.sceneSections;
  const clipFor = (notesFn, i, color, name) => {
    const t0 = a0(sceneSec[i]), t1 = t0 + S;
    const ns = cleanNotes(notesFn(t0, t1));
    if (!ns.length) return null;
    return { name, color, isEnabled: true,
      region: { start: f(0), end: f(S), loop: { start: f(0), end: f(S), isEnabled: true } },
      grooveId: 1, notes: ns.sort((x, y) => x.startTime - y.startTime || x.noteNumber - y.noteNumber),
      stepEditorScrollPosition: f(0), envelopes: [] };
  };
  const pbv = semis => +(Math.max(-48, Math.min(48, semis)) * (semis >= 0 ? 8191 / 48 : PB_SEMI)).toFixed(4);
  const note = (n, t, d, v, pb) => { const o = { noteNumber: n, startTime: f(+t.toFixed(6)), duration: f(+d.toFixed(6)), velocity: f(Math.max(1, Math.min(127, v))), offVelocity: f(0) };
    if (pb !== undefined) o.automations = { PitchBend: (Array.isArray(pb) ? pb : [{ t: 0, v: pb }]).map(x => ({ time: f(+x.t.toFixed(6)), value: f(x.v) })) }; return o; };
  const inWin = (ns, t0, t1) => ns.filter(n => n.t >= t0 - 1e-6 && n.t < t1 - 1e-6);
  const tracks = [];
  for (let ti = 0; ti < 4; ti++) {
    const dest = slots[ti], ps = byDest[dest] || [];
    let device, notesFn, tname;
    const padDest = d => d === 'pad' || d === 'pad:' + dest || (dest === 'drums' && d === 'pad:drums');
    const padParts = parts.filter(p => assign[p.id] && padDest(assign[p.id].dest) && (dest === 'drums' || assign[p.id].dest !== 'pad'));
    const isPadTrack = dest !== 'drums' && !ps.length && padParts.length;
    if (dest === 'drums' || isPadTrack) {
      const kit = man.kits[cfg.kitIndex || 0];
      const { preset, samples: ks } = await lib.loadPreset(kit.preset);
      device = trackDevice(preset, 'kit');
      const rack = device.chains[0].devices[0];
      const drumNotes = dest === 'drums' ? ps.flatMap(p => p.notes) : [];
      if (dest === 'drums') addSamples(ks);
      else for (const c of rack.chains) { c.devices[0].deviceData.sampleUri = null; c.drumZoneSettings.chokeGroup = null; }
      const usedPads = new Set(drumNotes.map(n => M2M.padNote(n.n, cfg.fold !== false, foldMap)).filter(x => x !== null));
      const free = []; if (dest === 'drums') { for (let n = 51; n >= 36; n--) if (!usedPads.has(n)) free.push(n); } else for (let n = 36; n <= 51; n++) free.push(n);
      const padMap = [];
      for (const p of padParts) {
        const want = Math.max(1, Math.min(16, assign[p.id].voices || 1));
        if (!free.length) { warnings.push(`No free pad for ${p.name}; skipped`); continue; }
        const got = Math.min(want, free.length);
        if (got < want) warnings.push(`${p.name}: only ${got} of ${want} pads free on ${dest === 'drums' ? 'the drum track' : 'its track'}`);
        const pads = free.splice(0, got), pr = prog(p.prog);
        const { samples: s } = await lib.loadPreset(pr.preset); addSamples(s);
        const lanes = allocateVoices(p.notes, got);
        const offs = lanes.flat().map(n => n.n - pr.render_key);
        let T = 0; const mx = Math.max(...offs), mn = Math.min(...offs);
        if (mx > 48 || mn < -48) T = Math.max(-48, Math.min(48, Math.round((mx + mn) / 24) * 12));
        for (const pad of pads) {
          let chain = rack.chains.find(c => c.drumZoneSettings.receivingNote === pad);
          if (!chain) { chain = clone(rack.chains[0]); chain.drumZoneSettings.receivingNote = pad; rack.chains.push(chain); }
          const cell = chain.devices[0], q = cell.parameters;
          cell.deviceData.sampleUri = encName(pr.sample);
          Object.assign(q, { Voice_Envelope_Mode: 'A-S-R', Voice_Envelope_Attack: f(Math.max(0.0001, pr.env.attack)), Voice_Envelope_Hold: f(60),
            Voice_Envelope_Decay: f(Math.min(4.0, Math.max(0.02, pr.env.release))), Voice_Transpose: T, Voice_VelocityToVolume: f(0.6),
            Volume: f(Math.max(-40, Math.min(0, pr.volume_db + 2))), NotePitchBend: true, Effect_On: false });
          chain.drumZoneSettings.chokeGroup = null;
        }
        padMap.push({ pads, part: p, lanes, T });
      }
      rack.chains.sort((x, y) => x.drumZoneSettings.receivingNote - y.drumZoneSettings.receivingNote);
      notesFn = (t0, t1) => {
        const out = [];
        for (const n of inWin(drumNotes, t0, t1)) { const pd = M2M.padNote(n.n, cfg.fold !== false, foldMap); if (pd !== null) out.push(note(pd, n.t - t0, Math.min(n.d, t1 - n.t), n.v)); }
        for (const m of padMap) m.lanes.forEach((lane, li) => { for (const n of inWin(lane, t0, t1)) {
          const off = n.n - prog(m.part.prog).render_key - m.T, d = Math.min(n.d, t1 - n.t);
          let pb = [{ t: 0, v: pbv(off) }];
          if (cfg.bends !== false && n.bend) {
            pb = []; let last = null;
            for (const b of n.bend) { if (b.t >= d) break; const v = pbv(off + b.semis); if (v !== last) pb.push({ t: b.t, v }); last = v; }
            if (pb.length > 64) pb = pb.filter((x, i) => i % Math.ceil(pb.length / 64) === 0);
            if (!pb.length || pb[0].t > 0) pb.unshift({ t: 0, v: pbv(off) });
          }
          out.push(note(m.pads[li], n.t - t0, d, n.v, pb));
        } });
        return out;
      };
      const label = padMap.map(m => m.part.name + (m.pads.length > 1 ? ' x' + m.pads.length : '')).join(', ');
      tname = dest === 'drums' ? 'Drums' + (label ? ' + ' + label : '') : 'Pads: ' + label;
      device.name = tname.slice(0, 40);
    } else {
      const lead = ps[0];
      const ov = (cfg.sounds || {})[dest];
      const pnum = ov ? ov.prog : lead ? lead.prog : 0;
      const useDrift = ov ? (ov.drift && driftOf(pnum)) : (lead && assign[lead.id].sound === 'drift' && driftOf(pnum));
      const rel = useDrift ? driftOf(pnum).preset : prog(pnum).preset;
      const { preset, samples: s } = await lib.loadPreset(rel); addSamples(s);
      device = trackDevice(preset, useDrift ? 'drift' : 'sampler');
      const ns = ps.flatMap(p => p.notes);
      notesFn = (t0, t1) => inWin(ns, t0, t1).map(n => note(Math.max(0, Math.min(127, M2M.bentNote(n, cfg.bends !== false))), n.t - t0, Math.min(n.d, t1 - n.t), n.v));
      tname = lead ? (ps.map(p => p.name).join(' + ')) : '';
      if (ps.length > 1) warnings.push(`${tname}: ${ps.length} parts merged on one track, using ${M2M.GM[pnum]}`);
      if (lead) tname = (useDrift ? M2M.GM[pnum] + ' (Drift)' : M2M.GM[pnum]) + (ps.length > 1 || ps[0].prog !== pnum ? ' · ' + ps.map(p => p.label || p.name).join(' + ') : '');
    }
    const clipSlots = [];
    for (let i = 0; i < 8; i++) clipSlots.push({ hasStop: true, clip: i < sceneSec.length ? clipFor(notesFn, i, colors[ti], '') : null });
    tracks.push({ kind: 'midi', name: tname.slice(0, 40), color: colors[ti], isSelected: ti === 0, clipSlots,
      isNoteRepeatOn: false, noteRepeatRate: '1/16', noteRepeatArpeggio: { style: 'chordRepeat' }, uiOctaveIndex: 4,
      midiInputMode: 'auto', midiOutputEndpoint: null, devices: [device],
      mixer: { pan: f(0), 'solo-cue': false, speakerOn: true, volume: f(-3), sends: [] } });
  }
  const letters = 'ABCDEFGH';
  const scenes = []; for (let i = 0; i < 8; i++) scenes.push({ name: i < sceneSec.length ? `${letters[i]} bar ${arr.startBar + sceneSec[i] * arr.sectionBars + 1}` : '', color: null });
  const set = {
    $schema: 'http://tech.ableton.com/schema/song/1.8.2/song.json', stepEditorResolution: '1/16',
    tempo: f(+song.tempo.toFixed(2)), globalGrooveAmount: f(0), rootNote: 0, scale: 'Major', melodicLayout: 'chromatic',
    tracks, returnTracks: [], masterTrack: { color: 2, isSelected: false, devices: [], mixer: { pan: f(0), volume: f(0) } },
    scenes, grooves: [{ id: 1, name: 'Swing 16ths', base: '1/16', loop: { start: f(0), end: f(4) },
      events: Array.from({ length: 16 }, (_, i) => ({ time: f(i / 4 + (i % 2 ? 1 / 12 : 0)) })) }],
    metadata: { usedFeatures: ['Drum Sampler Pitch > Env'] },
  };
  if (song.sig.num !== 4 || song.sig.den !== 4) set.timeSignature = { upper: song.sig.num, lower: song.sig.den };
  // only bundle samples that are referenced
  const refs = new Set(); const walkRefs = x => { if (x && typeof x === 'object' && !(x instanceof F)) for (const [k, v] of Object.entries(x)) { if (k === 'sampleUri' && typeof v === 'string') refs.add(decodeURIComponent(v)); else walkRefs(v); } }; walkRefs(set);
  const files = Object.keys(samples).filter(n => refs.has(n)).sort().map(n => ({ name: n, data: samples[n] }));
  const missing = [...refs].filter(r => !samples[r]); if (missing.length) warnings.push('Missing samples: ' + missing.join(', '));
  files.push({ name: 'Song.abl', data: enc.encode(M2M.jstr(set)) });
  const playOrder = part.order.map(u => letters[u]).join(' ');
  return { zip: M2M.writeZip(files), set, warnings, playOrder, sampleBytes: files.reduce((s, f) => s + f.data.length, 0) };
};

M2M.loadPresetFrom = function (getFileBytes) {   // getFileBytes(relPath) -> Promise<Uint8Array>
  const cache = new Map();
  return async rel => {
    if (!cache.has(rel)) cache.set(rel, (async () => {
      const z = await M2M.readZip(await getFileBytes(rel));
      const preset = M2M.jparse(dec.decode(z['Preset.ablpreset']));
      const samples = {}; for (const k in z) if (k.startsWith('Samples/')) samples[k] = z[k];
      return { preset, samples };
    })());
    return cache.get(rel);
  };
};

/* ---------------------------------------------- Live Set (.als) follow-action patch
   Live opens a Move Set as Session View scenes. After "Save Live Set As", this sets every scene's Follow Action
   so the scenes play in song order: Next (4) or Jump (9) after the section length; the last scene Stops (1). */
async function gunzip(u8) { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()); }
async function gzip(u8) { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()); }
M2M.readAls = async function (u8) { const raw = u8[0] === 0x1f && u8[1] === 0x8b ? await gunzip(u8) : u8; return dec.decode(raw); };
M2M.alsScenes = function (xml) {
  const scenes = []; const re = /<Scene Id="(\d+)">([\s\S]*?)<\/Scene>/g; let m;
  while ((m = re.exec(xml))) { const nm = /<Name Value="([^"]*)"/.exec(m[2]); scenes.push({ id: +m[1], name: nm ? nm[1] : '' }); }
  const used = new Set(); const clipRe = /<ClipSlot Id="(\d+)">([\s\S]*?)<\/ClipSlot>/g;
  while ((m = clipRe.exec(xml))) if (/<MidiClip |<AudioClip /.test(m[2])) used.add(+m[1]);
  scenes.forEach((s, i) => s.hasClips = used.has(i));
  return scenes;
};
/* plan: [{action:'next'|'jump'|'stop'|'none', beats, jump (0-based)}] per scene */
M2M.planFromOrder = function (order, nScenes, sectionBeats) {
  const plan = Array.from({ length: nScenes }, () => ({ action: 'none', beats: sectionBeats, jump: 0 }));
  const seen = new Set(); let repeats = false;
  for (let i = 0; i < order.length; i++) {
    const cur = order[i], nxt = order[i + 1];
    if (seen.has(cur)) { repeats = true; continue; }
    seen.add(cur);
    if (nxt === undefined) plan[cur] = { action: 'stop', beats: sectionBeats, jump: 0 };
    else if (seen.has(nxt)) { repeats = true; plan[cur] = { action: 'stop', beats: sectionBeats, jump: 0 }; }
    else plan[cur] = nxt === cur + 1 ? { action: 'next', beats: sectionBeats, jump: 0 } : { action: 'jump', beats: sectionBeats, jump: nxt };
  }
  return { plan, repeats };
};
M2M.planFromSceneNames = function (scenes, barBeats = 4) {     // names like "A bar 1", "B bar 17"
  const bars = scenes.map(s => { const m = /bar (\d+)/.exec(s.name); return m ? +m[1] : null; });
  const used = scenes.map((s, i) => i).filter(i => scenes[i].hasClips);
  let len = 16;
  const diffs = []; for (let i = 1; i < bars.length; i++) if (bars[i] !== null && bars[i - 1] !== null && bars[i] > bars[i - 1]) diffs.push(bars[i] - bars[i - 1]);
  if (diffs.length) len = Math.min(...diffs);
  return M2M.planFromOrder(used, scenes.length, len * barBeats);
};
const ACTION = { none: 0, stop: 1, next: 4, jump: 9 };
M2M.patchAlsFollowActions = function (xml, plan) {
  let i = -1;
  return xml.replace(/<Scene Id="(\d+)">([\s\S]*?)<\/Scene>/g, (whole, id, body) => {
    i++; const p = plan[i]; if (!p) return whole;
    const set = (b, tag, v) => b.replace(new RegExp('<' + tag + ' Value="[^"]*"'), `<${tag} Value="${v}"`);
    const nb = body.replace(/<FollowAction>[\s\S]*?<\/FollowAction>/, fa => {
      let x = fa;
      x = set(x, 'FollowTime', p.beats); x = set(x, 'IsLinked', 'false'); x = set(x, 'LoopIterations', 1);
      x = set(x, 'FollowActionA', ACTION[p.action]); x = set(x, 'FollowActionB', 0);
      x = set(x, 'FollowChanceA', 100); x = set(x, 'FollowChanceB', 0);
      x = set(x, 'JumpIndexA', (p.jump || 0) + 1);
      x = set(x, 'FollowActionEnabled', p.action === 'none' ? 'false' : 'true');
      return x;
    });
    return `<Scene Id="${id}">${nb}</Scene>`;
  });
};
M2M.writeAls = async function (xml) { return gzip(enc.encode(xml)); };

root.M2M = M2M;
if (typeof module !== 'undefined') module.exports = M2M;
})(typeof window !== 'undefined' ? window : globalThis);
