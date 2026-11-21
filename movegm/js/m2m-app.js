/* MIDI2Move page logic. Needs m2m-core.js (window.M2M) and m2m-manifest.js (window.M2M_MANIFEST). */
const MANIFEST = window.M2M_MANIFEST;
{
const $ = s => document.querySelector(s);
const PLAY_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 1l9 5-9 5z"/></svg>';
const STOP_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="2" width="8" height="8"/></svg>';
const ROLES = ['DR', 'T1', 'T2', 'T3', 'T4', 'PD'];
const ROLE_LABEL = { DR: 'Drum kit (16 pads)', T1: 'Move Track 1', T2: 'Move Track 2', T3: 'Move Track 3', T4: 'Move Track 4', PD: 'Spare drum pads, played chromatically' };
const TRACK_VAR = { DR: '--dr', T1: '--t1', T2: '--t2', T3: '--t3', T4: '--t4' };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const driftSet = new Set((MANIFEST.drift || []).map(d => d.program));

const state = { song: null, parts: [], roleOf: new Map(), pad: new Map(), mutes: { all: new Set(), bars: new Map() },
  sound: {}, soundTouched: {}, octave: {}, padSound: new Map(), solo: null, barCache: new Map(), plan: null, fileName: '' };
let gmFiles = null, lib = null;

/* ---------- Simple / Advanced (as js/mode.js in CircuitGM) ---------- */
const mode = (() => {
  const root = document.documentElement, box = $('#advanced'), note = $('#mode-changed'), touched = new Map();
  const valueOf = el => (el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value);
  const capture = e => { const el = e.target; if (!el.closest?.('.adv') || !el.matches?.('input, select') || touched.has(el)) return; touched.set(el, valueOf(el)); };
  ['pointerdown', 'focusin', 'keydown'].forEach(t => document.addEventListener(t, capture, true));
  const renumber = () => { let n = 1; for (const num of document.querySelectorAll('main > .panel > h2 > .num')) { const panel = num.closest('.panel'); if (panel.hidden || (root.classList.contains('simple') && panel.classList.contains('adv'))) continue; num.textContent = String(n++); } };
  const refresh = () => {
    let changed = 0; for (const [el, was] of touched) { if (!el.isConnected) { touched.delete(el); continue; } if (valueOf(el) !== was) changed++; }
    const simple = root.classList.contains('simple');
    note.hidden = !simple || changed === 0;
    note.textContent = changed ? `${changed} setting${changed > 1 ? 's' : ''} you changed ${changed > 1 ? 'are' : 'is'} hidden in simple mode and still applied. Switch on Advanced to see ${changed > 1 ? 'them' : 'it'}.` : '';
  };
  const apply = on => { root.classList.toggle('simple', !on); box.checked = on; renumber(); refresh(); };
  box.addEventListener('change', () => { try { localStorage.setItem('movegm-advanced-m2m', box.checked ? '1' : '0'); } catch (e) {} apply(box.checked); });
  document.addEventListener('change', refresh);
  let on = false; try { on = localStorage.getItem('movegm-advanced-m2m') === '1'; } catch (e) {}
  apply(on);
  return { refresh, isAdvanced: () => !root.classList.contains('simple') };
})();

/* ---------- step 1: sound pack + MIDI ---------- */
/* Where the sounds come from: MoveGM on this site by default, or a folder the user picks. */
const SITE_PACK = location.protocol === 'file:' ? null : new URL('../pack/MoveGM/', location.href).href;
const packStatus = (text, isError) => { $('#base-status').textContent = text; $('#base-status').classList.toggle('error', !!isError); };
const usePack = (name, getBytes, fromSite) => {
  lib = { manifest: MANIFEST, loadPreset: M2M.loadPresetFrom(getBytes) };
  $('#base-name').textContent = name;
  $('#gmsite').hidden = fromSite || !SITE_PACK;
  buffers.clear(); updateBuild();
};
async function useSitePack() {
  if (!SITE_PACK) { packStatus('Choose your MoveGM folder (the one holding "01 Piano" … "18 Drift Synths").'); return; }
  gmFiles = null;
  const url = rel => SITE_PACK + rel.split('/').map(encodeURIComponent).join('/');
  usePack('MoveGM v0.2', async rel => {
    const r = await fetch(url(rel));
    if (!r.ok) throw new Error(`Couldn't load ${rel} from the site (${r.status})`);
    return new Uint8Array(await r.arrayBuffer());
  }, true);
  packStatus('Loading from this site…');
  try {
    const r = await fetch(url(MANIFEST.programs[0].preset), { method: 'HEAD' });
    if (!r.ok) throw new Error(String(r.status));
    packStatus(`From this site: ${MANIFEST.programs.length} instruments, ${MANIFEST.kits.length} drum kits, ${(MANIFEST.drift || []).length} Drift synths. Sounds load as they're needed.`);
  } catch (err) {
    packStatus(`Couldn't reach the MoveGM sounds on this site. Check your connection, or choose a MoveGM folder.`, true);
  }
}
$('#gmsite').addEventListener('click', () => { $('#gmdir').value = ''; useSitePack(); });
$('#gmdir').addEventListener('change', e => {
  const files = [...e.target.files]; if (!files.length) return;
  gmFiles = new Map();
  for (const f of files) { const rp = f.webkitRelativePath || f.name; gmFiles.set(rp.slice(rp.indexOf('/') + 1), f); }
  const top = (files[0].webkitRelativePath || '').split('/')[0] || 'your folder';
  const need = MANIFEST.programs.map(p => p.preset).concat(MANIFEST.kits.map(k => k.preset));
  const found = need.filter(p => gmFiles.has(p)).length;
  const ok = found === need.length;
  packStatus(ok ? `From your folder "${top}": ${MANIFEST.programs.length} instruments, ${MANIFEST.kits.length} drum kits, ${(MANIFEST.drift || []).length} Drift synths.` : `Only ${found} of ${need.length} MoveGM presets found in "${top}". Is it a MoveGM folder (holding "01 Piano" … "18 Drift Synths")?`, !ok);
  usePack(`Folder: ${top}`, async rel => { const f = gmFiles.get(rel); if (!f) throw new Error('Missing in the chosen folder: ' + rel); return new Uint8Array(await f.arrayBuffer()); }, false);
});
const drop = $('#drop');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) loadFile(f); });
$('#file').addEventListener('change', e => { if (e.target.files[0]) loadFile(e.target.files[0]); });

async function loadFile(file) {
  stopAll();
  let song;
  try { song = M2M.parseMidi(new Uint8Array(await file.arrayBuffer())); }
  catch (err) { const fi = $('#fileinfo'); fi.hidden = false; fi.innerHTML = `<span class="status error">${esc(err.message)}</span>`; return; }
  state.song = song; state.fileName = file.name.replace(/\.(mid|midi|rmi|kar)$/i, '');
  state.parts = M2M.makeParts(song);
  state.mutes = { all: new Set(), bars: new Map() }; state.barCache.clear(); state.sound = {}; state.soundTouched = {}; state.octave = {}; state.padSound.clear(); state.solo = null;
  defaultRoles();
  const bars = Math.ceil(song.lengthBeats / barBeats());
  const fi = $('#fileinfo'); fi.hidden = false;
  fi.innerHTML = `<b>${esc(file.name)}</b> · ${song.tempo.toFixed(1).replace(/\.0$/, '')} BPM${song.tempoChanges > 1 ? ' (tempo changes: the first tempo is used)' : ''} · ${song.sig.num}/${song.sig.den} · ${bars} bars · ${state.parts.length} parts`;
  $('#setname').value = state.fileName.slice(0, 40);
  for (const id of ['#step-tracks', '#step-sounds', '#step-arrange', '#step-build']) $(id).hidden = false;
  renderTracks(); rolesChanged();
}
const barBeats = () => state.song.sig.num * 4 / state.song.sig.den;

/* ---------- step 2: parts ---------- */
function defaultRoles() {
  state.roleOf.clear(); state.pad.clear();
  const a = M2M.autoAssign(state.parts, MANIFEST, {});
  for (const p of state.parts) {
    const d = a[p.id].dest;
    const r = d === 'drums' ? 'DR' : d.startsWith('track') ? 'T' + d.slice(5) : d === 'pad' ? 'PD' : null;
    if (r) state.roleOf.set(p.id, r);
    if (r === 'PD') state.pad.set(p.id, { voices: Math.max(1, a[p.id].voices || 1), on: 'auto' });
  }
}
function renderTracks() {
  const tbody = $('#tracks tbody'); tbody.innerHTML = '';
  const len = state.song.lengthBeats || 1;
  for (const p of state.parts) {
    const tr = document.createElement('tr'); tr.dataset.id = p.id;
    const sub = (p.drum ? 'GM drums' : M2M.GM[p.prog]) + ` · ch ${p.ch + 1}` + (p.dupOf !== undefined ? ` · same notes as ch ${state.parts[p.dupOf].ch + 1}` : '') + (p.bends ? ` · ${p.bends} bent notes` : '');
    tr.innerHTML = `
      <td class="c-play"><button class="playbtn" type="button" aria-label="Play ${esc(p.label || p.name)}">${PLAY_ICON}</button></td>
      <td><div class="pname">${esc(p.label || p.name)}</div><div class="psub">${esc(sub)}</div></td>
      <td class="c-num">${p.count}</td>
      <td class="c-roll"><canvas class="roll" width="400" height="56"></canvas></td>
      <td class="c-roles"><div class="roles">${ROLES.map(r => `<button type="button" class="role" data-role="${r}" title="${ROLE_LABEL[r]}" ${(r === 'DR') !== !!p.drum ? 'disabled' : ''}>${r === 'DR' ? 'Drums' : r === 'PD' ? 'Pads' : r}</button>`).join('')}
        <span class="padopts adv" hidden><select aria-label="Which track's pads"><option value="auto">on drum track</option><option value="T2">on Track 2</option><option value="T3">on Track 3</option><option value="T4">on Track 4</option></select>
        <label>× <input type="number" min="1" max="16" aria-label="Number of pads (voices)" title="Pads (voices): 1 for a single line, 3-4 for chords"></label></span></div></td>`;
    tr.querySelector('.playbtn').addEventListener('click', e => togglePartPlay(p, e.currentTarget));
    for (const b of tr.querySelectorAll('.role')) b.addEventListener('click', () => {
      const r = b.dataset.role;
      if (state.roleOf.get(p.id) === r) state.roleOf.delete(p.id); else state.roleOf.set(p.id, r);
      if (r === 'PD' && !state.pad.has(p.id)) state.pad.set(p.id, { voices: Math.min(4, Math.max(1, p.poly)), on: 'auto' });
      rolesChanged();
    });
    const po = tr.querySelector('.padopts');
    po.querySelector('select').addEventListener('change', e => { state.pad.get(p.id).on = e.target.value; rolesChanged(); });
    po.querySelector('input').addEventListener('change', e => { state.pad.get(p.id).voices = Math.max(1, Math.min(16, +e.target.value || 1)); rolesChanged(); });
    drawRoll(tr.querySelector('canvas'), p, len);
    tbody.append(tr);
  }
}
function drawRoll(canvas, p, len) {
  const c = canvas.getContext('2d'), w = canvas.width, h = canvas.height; c.clearRect(0, 0, w, h);
  const [lo, hi] = p.drum ? [27, 87] : [p.lo, p.hi], span = Math.max(12, hi - lo + 1);
  c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(p.drum ? '--dr' : '--accent').trim() || '#888';
  for (const n of p.notes) { const x = (n.t / len) * w, y = h - 4 - ((n.n - lo) / span) * (h - 8); c.fillRect(x, y - 2, Math.max(1.5, (n.d / len) * w), 3); }
}
function syncRoleButtons() {
  for (const tr of $('#tracks tbody').children) {
    const id = +tr.dataset.id, r = state.roleOf.get(id);
    for (const b of tr.querySelectorAll('.role')) {
      b.setAttribute('aria-pressed', String(b.dataset.role === r));
      if (b.dataset.role === 'T1') b.disabled = hasDrums() || state.parts[id].drum;
    }
    const po = tr.querySelector('.padopts'); po.hidden = r !== 'PD';
    if (r === 'PD') { const pd = state.pad.get(id); po.querySelector('select').value = pd.on; po.querySelector('input').value = pd.voices; }
  }
}
const hasDrums = () => state.parts.some(p => state.roleOf.get(p.id) === 'DR');
const moveTracks = () => hasDrums() ? ['DR', 'T2', 'T3', 'T4'] : ['T1', 'T2', 'T3', 'T4'];
const partsOn = r => state.parts.filter(p => state.roleOf.get(p.id) === r);
// where a pad part's pads go: the drum track, or a melodic track with no normal part
function padTarget(p) {
  const want = state.pad.get(p.id)?.on || 'auto';
  if (want !== 'auto') return want;
  if (hasDrums()) return 'DR';
  for (const r of ['T4', 'T3', 'T2']) if (!partsOn(r).length) return r;
  return null;
}
const padPartsOn = t => state.parts.filter(p => state.roleOf.get(p.id) === 'PD' && padTarget(p) === t);
const trackParts = t => [...partsOn(t), ...padPartsOn(t)];

function rolesChanged() {
  if (hasDrums()) for (const p of partsOn('T1')) state.roleOf.set(p.id, 'T2');
  syncRoleButtons();
  for (const t of ['T1', 'T2', 'T3', 'T4']) {           // default sound = GM program of the first part on the track
    const first = partsOn(t)[0];
    if (!state.soundTouched[t] && first) state.sound[t] = { prog: first.prog, drift: false };
  }
  renderSounds(); rearrange();
}

/* ---------- step 3: sounds ---------- */
function soundOptions(sel) {
  const opts = [];
  M2M.GM.forEach((g, i) => {
    opts.push(`<option value="${i}:s"${sel && sel.prog === i && !sel.drift ? ' selected' : ''}>${i + 1}. ${esc(g)}</option>`);
    if (driftSet.has(i)) opts.push(`<option value="${i}:d"${sel && sel.prog === i && sel.drift ? ' selected' : ''}>${i + 1}. ${esc(g)} (Drift synth)</option>`);
  });
  return opts.join('');
}
function renderSounds() {
  const box = $('#sounds'); box.innerHTML = '';
  moveTracks().forEach((t, i) => {
    const d = document.createElement('div');
    const n = i + 1;
    if (t === 'DR') {
      d.className = 'field role-dr';
      const pads = padPartsOn('DR');
      d.innerHTML = `<label for="kit">Track 1 · Drum kit</label><select id="kit">${MANIFEST.kits.map((k, j) => `<option value="${j}">${esc(k.name)}</option>`).join('')}</select>
        <span class="sub">Playing: ${esc(partsOn('DR').map(p => p.label || p.name).join(' + ') || 'nothing')}${pads.length ? ' · on spare pads: ' + esc(pads.map(p => p.label || p.name).join(', ')) : ''}</span>`;
      d.querySelector('select').value = String(state.kit || 0);
      d.querySelector('select').addEventListener('change', e => { state.kit = +e.target.value; buffers.clear(); rearrange(); });
    } else {
      d.className = `field role-${t.toLowerCase()}`;
      const ps = partsOn(t), pads = padPartsOn(t);
      if (!ps.length && pads.length) {
        d.innerHTML = `<label>Track ${n} · Pads</label><span class="sub">A 16-pad track playing ${esc(pads.map(p => `${p.label || p.name} ×${state.pad.get(p.id).voices}`).join(', '))}.</span>`;
      } else {
        d.innerHTML = `<label for="snd-${t}">Track ${n} sound</label><select id="snd-${t}">${soundOptions(state.sound[t])}</select>
          <span class="sub">${ps.length ? 'Playing: ' + esc(ps.map(p => p.label || p.name).join(' + ')) : 'No part chosen; this track stays empty.'}${pads.length ? ' (Pads sent here are skipped: this track has a part.)' : ''}</span>`;
        const sel = d.querySelector('select'); sel.disabled = !ps.length;
        sel.addEventListener('change', e => { const [pr, k] = e.target.value.split(':'); state.sound[t] = { prog: +pr, drift: k === 'd' }; state.soundTouched[t] = true; buffers.clear(); rearrange(); });
      }
    }
    box.append(d);
  });
  // octave shift per melodic track (advanced)
  const tb = $('#transpose'); tb.innerHTML = '';
  for (const t of moveTracks().filter(t => t !== 'DR' && partsOn(t).length)) {
    const f = document.createElement('div'); f.className = 'field';
    f.innerHTML = `<label for="oct-${t}">Track ${t.slice(1)} octave</label><select id="oct-${t}">${[-2, -1, 0, 1, 2].map(o => `<option value="${o}"${(state.octave[t] || 0) === o ? ' selected' : ''}>${o > 0 ? '+' + o : o}</option>`).join('')}</select>`;
    f.querySelector('select').addEventListener('change', e => { state.octave[t] = +e.target.value; rearrange(); });
    tb.append(f);
  }
  // sounds for pad parts (advanced)
  const pp = state.parts.filter(p => state.roleOf.get(p.id) === 'PD');
  $('#padsounds-wrap').hidden = !pp.length;
  $('#padsounds').innerHTML = '';
  for (const p of pp) {
    const f = document.createElement('div'); f.className = 'field';
    const cur = state.padSound.has(p.id) ? state.padSound.get(p.id) : p.prog;
    f.innerHTML = `<label>${esc(p.label || p.name)} (pads)</label><select>${M2M.GM.map((g, i) => `<option value="${i}"${i === cur ? ' selected' : ''}>${i + 1}. ${esc(g)}</option>`).join('')}</select>`;
    f.querySelector('select').addEventListener('change', e => { state.padSound.set(p.id, +e.target.value); buffers.clear(); rearrange(); });
    $('#padsounds').append(f);
  }
}

/* ---------- step 4: arrangement ---------- */
for (const id of ['#section-bars', '#match', '#quantize', '#trim', '#bends', '#fold']) $(id).addEventListener('change', rearrange);
const isMuted = (id, bar) => state.mutes.all.has(id) || !!state.mutes.bars.get(id)?.has(bar);
function notesBars(id) {
  if (state.barCache.has(id)) return state.barCache.get(id);
  const bb = barBeats(), set = new Set();
  for (const n of state.parts[id].notes) set.add(Math.floor(n.t / bb + 1e-9));
  state.barCache.set(id, set); return set;
}
function mutedState(ids, bars) {
  let on = 0, off = 0;
  for (const k of ids) { const nb = notesBars(k); for (const b of bars) { if (!nb.has(b)) continue; if (isMuted(k, b)) off++; else on++; } }
  return { has: on + off > 0, muted: on === 0 && off > 0, partial: on > 0 && off > 0 };
}
function toggleMute(ids, bars) {
  const { all, bars: byId } = state.mutes;
  if (!bars) { const allMuted = ids.every(k => all.has(k)); for (const k of ids) { if (allMuted) all.delete(k); else { all.add(k); byId.delete(k); } } }
  else {
    const { muted } = mutedState(ids, bars);
    for (const k of ids) {
      if (!byId.has(k)) byId.set(k, new Set()); const set = byId.get(k);
      if (muted) { if (all.has(k)) { all.delete(k); for (const b of notesBars(k)) set.add(b); } for (const b of bars) set.delete(b); }
      else for (const b of bars) set.add(b);
    }
  }
  rearrange(true);
}
// The song as it will be converted: mutes, quantise, octave and pad sounds applied; core assignment.
function derived() {
  const bb = barBeats(), q = +$('#quantize').value, parts = [], assign = {};
  for (const p of state.parts) {
    const r = state.roleOf.get(p.id);
    if (!r) { assign[p.id] = { dest: 'skip' }; parts.push(p); continue; }
    let notes = p.notes.filter(n => !isMuted(p.id, Math.floor(n.t / bb + 1e-9)));
    if (q) notes = notes.map(n => ({ ...n, t: Math.round(n.t / q) * q, d: Math.max(q / 2, Math.round(n.d / q) * q) }));
    const oct = (state.octave[r] || 0) * 12;
    if (oct) notes = notes.map(n => ({ ...n, n: Math.max(0, Math.min(127, n.n + oct)) }));
    const prog = r === 'PD' && state.padSound.has(p.id) ? state.padSound.get(p.id) : p.prog;
    parts.push({ ...p, prog, notes, span: notes.length ? [Math.min(...notes.map(n => n.t)), Math.max(...notes.map(n => n.t + n.d))] : [0, 0] });
    if (r === 'DR') assign[p.id] = { dest: 'drums' };
    else if (r === 'PD') { const t = padTarget(p); assign[p.id] = { dest: !t ? 'skip' : t === 'DR' ? 'pad' : 'pad:track' + t.slice(1), voices: state.pad.get(p.id).voices }; }
    else assign[p.id] = { dest: 'track' + r.slice(1), sound: state.sound[r]?.drift ? 'drift' : 'sampler' };
  }
  let startBar = 0;
  if ($('#trim').checked) {
    const ts = parts.filter(p => assign[p.id].dest !== 'skip').flatMap(p => p.notes.map(n => n.t));
    if (ts.length) startBar = Math.floor(Math.min(...ts) / bb + 1e-9);
  }
  const sounds = {}; for (const t of ['T1', 'T2', 'T3', 'T4']) if (state.sound[t]) sounds['track' + t.slice(1)] = state.sound[t];
  return { parts, assign, startBar, sounds };
}
function rearrange(keepGrid) {
  if (!state.song) return;
  const dv = derived();
  const sel = $('#section-bars').value, m = $('#match').value;
  const used = dv.parts.filter(p => dv.assign[p.id].dest !== 'skip' && p.notes.length);
  if (!used.length) { state.plan = null; $('#summary').innerHTML = '<div class="stat"><div class="v">–</div><div class="k">no parts chosen</div></div>'; $('#grid').innerHTML = ''; $('#warnings').innerHTML = ''; updateBuild(); return; }
  const plan = M2M.arrange(state.song, dv.parts, dv.assign, { sectionBars: sel === 'auto' ? 0 : +sel, startBar: dv.startBar, match: m === 'exact' || m === 'loose' ? m : +m });
  state.plan = plan; state.dv = dv;
  renderSummary(plan); renderGrid(plan); renderWarnings(plan, dv); updateBuild();
  if (player.on && !keepGrid) restartPreview();
  else if (player.on) restartPreview();
}
function renderSummary(plan) {
  const used = moveTracks().filter(t => trackParts(t).length).length;
  const pads = state.parts.filter(p => state.roleOf.get(p.id) === 'PD').reduce((s, p) => s + (padTarget(p) ? state.pad.get(p.id).voices : 0), 0);
  const stats = [
    [plan.sets.length, plan.sets.length === 1 ? 'Move Set' : 'Move Sets'],
    [plan.sections, `sections of ${plan.sectionBars} bars`],
    [plan.sets.map(s => s.sceneSections.length).join(' + '), 'scenes per Set (max 8)'],
    [`${used} of 4`, 'Move tracks used'],
    [pads, pads === 1 ? 'chromatic pad' : 'chromatic pads'],
    [state.song.tempo.toFixed(1).replace(/\.0$/, ''), 'BPM'],
  ];
  $('#summary').innerHTML = stats.map(([v, k]) => `<div class="stat"><div class="v">${esc(String(v))}</div><div class="k">${esc(k)}</div></div>`).join('');
}
function trackLabel(t, i) {
  if (t === 'DR') return 'Track 1 · Drums';
  const ps = partsOn(t);
  if (!ps.length && padPartsOn(t).length) return `Track ${i + 1} · Pads`;
  const s = state.sound[t];
  return `Track ${i + 1} · ${s ? M2M.GM[s.prog] + (s.drift ? ' (Drift)' : '') : ''}`;
}
function renderGrid(plan) {
  const grid = $('#grid'); grid.innerHTML = '';
  const rows = [];
  moveTracks().forEach((t, i) => {
    const ps = trackParts(t); if (!ps.length) return;
    rows.push({ kind: 'track', t, ti: i, name: trackLabel(t, i), keys: ps.map(p => p.id) });
    for (const p of ps) rows.push({ kind: 'src', t, ti: i, name: (p.label || p.name) + (state.roleOf.get(p.id) === 'PD' ? ` (pads ×${state.pad.get(p.id).voices})` : ''), keys: [p.id] });
  });
  state.gridRows = rows;
  const labels = document.createElement('div'); labels.className = 'labels';
  labels.innerHTML = `<div class="row-label head">Set</div><div class="row-label head">Scene · bar</div>`;
  rows.forEach(row => {
    const d = document.createElement('div'); d.className = `row-label ${row.kind === 'src' ? 'src' : ''}`;
    const whole = row.keys.every(k => state.mutes.all.has(k));
    const dot = document.createElement('button'); dot.type = 'button'; dot.className = `dot${whole ? ' off' : ''}`;
    dot.style.setProperty('--c', `var(${TRACK_VAR[row.t]})`); dot.title = `${whole ? 'Unmute' : 'Mute'} ${row.name}`; dot.setAttribute('aria-pressed', String(!whole));
    dot.addEventListener('click', () => toggleMute(row.keys, null));
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = row.name; nm.title = row.name;
    d.append(dot, nm);
    if (row.kind === 'track') {
      const s = document.createElement('button'); s.type = 'button'; s.textContent = 'S'; s.className = `solo adv${state.solo === row.t ? ' on' : ''}`;
      s.title = `Solo ${row.name} in the preview`;
      s.addEventListener('click', () => { state.solo = state.solo === row.t ? null : row.t; renderGrid(plan); if (player.on) restartPreview(); });
      d.append(s);
    }
    labels.append(d);
  });
  grid.append(labels);
  const L = 'ABCDEFGH'; let sec = 0;
  plan.sets.forEach((set, k) => set.order.forEach((u, j) => {
    const i = sec++, b0 = plan.startBar + i * plan.sectionBars;
    const bars = Array.from({ length: plan.sectionBars }, (_, x) => b0 + x);
    const col = document.createElement('div'); col.className = 'col';
    if (j === 0 && k > 0) col.classList.add('proj-start'); else if (j > 0) col.classList.add('sec-start');
    col.dataset.bars = bars.join(','); col.dataset.beat = String(b0 * plan.barBeats);
    let html = `<div class="hd">${j === 0 ? 'Set ' + (k + 1) : ''}</div><div class="hd click" data-play="${b0 * plan.barBeats}" title="Play from bar ${b0 + 1}">${L[u]}·${b0 + 1}</div>`;
    rows.forEach((row, ri) => {
      const ms = mutedState(row.keys, bars), range = `bars ${b0 + 1}–${b0 + plan.sectionBars}`;
      if (row.kind === 'src') {
        const cls = !ms.has ? 'empty' : ms.muted ? 'muted' : ms.partial ? 'on part' : 'on';
        html += `<button type="button" class="cell src ${cls}" data-row="${ri}" style="--c:var(${TRACK_VAR[row.t]})" title="${esc(row.name)}, ${range}${ms.has ? (ms.muted ? ' (muted): click to unmute' : ': click to mute') : ' (no notes)'}"></button>`;
      } else {
        const cls = ms.muted ? 'muted' : !ms.has ? 'empty' : '';
        html += `<button type="button" class="cell ${cls}" data-row="${ri}" style="${ms.has ? `background:color-mix(in srgb, var(${TRACK_VAR[row.t]}) ${100 - (u % 8) * 8}%, #000)` : ''}" title="${esc(row.name)}: scene ${L[u]}, ${range}${ms.muted ? ' (muted): click to unmute' : ms.has ? ': click to mute' : ' (empty)'}">${ms.has ? L[u] : ''}</button>`;
      }
    });
    col.innerHTML = html; grid.append(col);
  }));
}
$('#grid').addEventListener('click', e => {
  const h = e.target.closest('[data-play]'); if (h) { playFrom(+h.dataset.play); return; }
  const cell = e.target.closest('.cell[data-row]'); if (!cell) return;
  const row = state.gridRows[+cell.dataset.row], col = cell.closest('.col');
  const bars = col.dataset.bars.split(',').map(Number);
  if (!mutedState(row.keys, bars).has) return;
  toggleMute(row.keys, bars);
});
function renderWarnings(plan, dv) {
  const w = [], bb = barBeats();
  if (state.song.tempoChanges > 1) w.push('The song changes tempo; the Set uses the first tempo.');
  const used = M2M.padsUsedByDrums({ notes: dv.parts.filter(p => dv.assign[p.id].dest === 'drums').flatMap(p => p.notes) }, $('#fold').checked, MANIFEST.fold_to_core);
  const want = t => state.parts.filter(p => state.roleOf.get(p.id) === 'PD' && padTarget(p) === t).reduce((s, p) => s + state.pad.get(p.id).voices, 0);
  if (want('DR') > 16 - used.size) w.push(`Drum track: ${want('DR')} pads wanted but only ${16 - used.size} are free; later parts get fewer pads.`);
  for (const t of ['T2', 'T3', 'T4']) if (want(t) && partsOn(t).length) w.push(`Track ${t.slice(1)} has a part, so the pad parts sent to its pads are skipped.`);
  const lost = state.parts.filter(p => state.roleOf.get(p.id) === 'PD' && p.poly > state.pad.get(p.id).voices);
  if (lost.length) w.push(`More notes at once than pads (extra notes are dropped or shortened): ${lost.map(p => `${p.label || p.name} (up to ${p.poly} notes, ${state.pad.get(p.id).voices} pad${state.pad.get(p.id).voices > 1 ? 's' : ''})`).join(', ')}.`);
  const noTarget = state.parts.filter(p => state.roleOf.get(p.id) === 'PD' && !padTarget(p));
  if (noTarget.length) w.push(`No spare pads for ${noTarget.map(p => p.label || p.name).join(', ')}: add a drum part or leave a track free.`);
  const merged = moveTracks().filter(t => t !== 'DR' && partsOn(t).length > 1);
  if (merged.length) w.push(`${merged.map(t => `Track ${t.slice(1)}`).join(', ')}: several parts share one sound.`);
  if (!$('#fold').checked) { const out = dv.parts.filter(p => dv.assign[p.id].dest === 'drums').flatMap(p => p.notes).filter(n => n.n < 36 || n.n > 51).length; if (out) w.push(`${out} drum notes outside the 16 pads are dropped (folding is off).`); }
  const skipped = state.parts.filter(p => !state.roleOf.get(p.id) && p.dupOf === undefined).length;
  if (skipped) w.push(`${skipped} part${skipped > 1 ? 's are' : ' is'} not converted (no Move track chosen).`);
  $('#warnings').innerHTML = w.map(x => `<li>${esc(x)}</li>`).join('');
}

/* ---------- preview ---------- */
let ctx = null; const buffers = new Map();
const player = { on: false, timer: null, startT: 0, startBeat: 0, cursor: 0, events: [], master: null, btn: null, partOnly: null };
async function bufferFor(rel, sampleName) {
  const key = rel + '|' + (sampleName || '');
  if (!buffers.has(key)) buffers.set(key, (async () => { const { samples } = await lib.loadPreset(rel); const name = sampleName || Object.keys(samples)[0]; return samples[name] ? await ctx.decodeAudioData(samples[name].slice().buffer) : null; })().catch(() => null));
  return buffers.get(key);
}
function previewEvents(onlyPart) {
  const dv = state.dv || derived(), kit = MANIFEST.kits[state.kit || 0], list = [], useB = $('#bends').checked;
  const trackOf = p => { const d = dv.assign[p.id].dest; return d === 'drums' || d === 'pad' ? (hasDrums() ? 'DR' : null) : d.startsWith('pad:') ? 'T' + d.slice(9) : d.startsWith('track') ? 'T' + d.slice(5) : null; };
  for (const p of dv.parts) {
    if (onlyPart !== undefined && onlyPart !== null) { if (p.id !== onlyPart) continue; }
    else { const d = dv.assign[p.id].dest; if (d === 'skip') continue; if (state.solo && trackOf(p) !== state.solo) continue; }
    const src = onlyPart !== null && onlyPart !== undefined && dv.assign[p.id].dest === 'skip' ? state.parts[p.id] : p;
    if (src.drum) {
      for (const n of src.notes) { const pad = M2M.padNote(n.n, $('#fold').checked, MANIFEST.fold_to_core); if (pad === null) continue; const kp = kit.pads.find(x => x.pad === pad); if (kp && kp.sample) list.push({ t: n.t, d: n.d, v: n.v, kind: 'drum', rel: kit.preset, sample: 'Samples/' + kp.sample }); }
    } else {
      const d = dv.assign[p.id].dest, isPad = d === 'pad' || d.startsWith('pad:');
      const tr = d.startsWith('track') ? 'T' + d.slice(5) : null;
      const prog = tr && state.sound[tr] ? state.sound[tr].prog : src.prog, pr = MANIFEST.programs[prog];
      const ns = isPad ? M2M.allocateVoices(src.notes, dv.assign[p.id].voices || 1).flat() : src.notes;
      for (const n of ns) list.push({ t: n.t, d: n.d, v: n.v, kind: 'mel', rel: pr.preset, pr, n: isPad ? n.n : M2M.bentNote(n, useB), bend: isPad && useB ? n.bend : null });
    }
  }
  return list.sort((a, b) => a.t - b.t);
}
async function startPreview(fromBeat, onlyPart, btn) {
  if (!lib) { $('#pvnote').textContent = 'Choose the MoveGM folder (step 1) to hear the preview.'; return; }
  ctx = ctx || new AudioContext(); await ctx.resume(); stopAll();
  player.events = previewEvents(onlyPart);
  await Promise.all([...new Set(player.events.map(e => e.rel + '|' + (e.sample || '')))].map(k => { const [r, s] = k.split('|'); return bufferFor(r, s || null); }));
  player.master = ctx.createGain(); player.master.gain.value = 0.6; player.master.connect(ctx.destination);
  player.startBeat = fromBeat || 0; player.cursor = player.events.findIndex(e => e.t >= player.startBeat - 1e-6);
  if (player.cursor < 0) { stopAll(); return; }
  player.startT = ctx.currentTime + 0.1; player.on = true; player.partOnly = onlyPart ?? null; player.btn = btn || null;
  if (btn) { btn.innerHTML = STOP_ICON; btn.classList.add('on'); } else $('#play').textContent = 'Stop preview';
  player.timer = setInterval(tick, 50); tick();
}
function restartPreview() { if (!player.on || player.partOnly !== null) return; const b = curBeat(); startPreview(b); }
const curBeat = () => player.on ? player.startBeat + (ctx.currentTime - player.startT) * state.song.tempo / 60 : 0;
function tick() {
  const spb = 60 / state.song.tempo, now = ctx.currentTime;
  while (player.cursor < player.events.length) {
    const e = player.events[player.cursor], when = player.startT + (e.t - player.startBeat) * spb;
    if (when > now + 0.4) break; voice(e, Math.max(when, now), e.d * spb); player.cursor++;
  }
  const beat = curBeat(); $('#time').textContent = mmss(Math.max(0, beat * spb));
  for (const c of document.querySelectorAll('.col')) { const b = +c.dataset.beat, len = state.plan ? state.plan.sectionBeats : 0; c.classList.toggle('now', beat >= b && beat < b + len); }
  if (player.cursor >= player.events.length && beat > player.events[player.events.length - 1].t + 4) stopAll();
}
async function voice(e, when, dur) {
  const buf = await buffers.get(e.rel + '|' + (e.sample || '')); if (!buf || !player.master) return;
  const g = ctx.createGain(); g.connect(player.master);
  const vel = (e.v / 127) ** 2, src = ctx.createBufferSource(); src.buffer = buf;
  if (e.kind === 'mel') {
    src.playbackRate.value = 2 ** ((e.n - e.pr.render_key) / 12);
    if (e.bend) { const spb = 60 / state.song.tempo; for (const b of e.bend) src.playbackRate.setValueAtTime(2 ** ((e.n + b.semis - e.pr.render_key) / 12), when + b.t * spb); }
    const env = e.pr.env, peak = 10 ** (e.pr.volume_db / 20) * (0.4 + 0.6 * vel) * 2, a = Math.max(0.002, env.attack), rel = Math.min(3, Math.max(0.02, env.release));
    g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(peak, when + a);
    g.gain.setTargetAtTime(peak * Math.max(0.001, env.sustain), when + a, Math.max(0.01, env.decay / 6.9));
    if (g.gain.cancelAndHoldAtTime) g.gain.cancelAndHoldAtTime(when + Math.max(dur, a));
    g.gain.setTargetAtTime(0, when + Math.max(dur, a), rel / 6.9);
    src.connect(g); src.start(when); src.stop(when + Math.max(dur, a) + rel + 0.05);
  } else { g.gain.value = 0.55 * (0.5 + 0.5 * vel); src.connect(g); src.start(when); }
}
function stopAll() {
  if (player.timer) clearInterval(player.timer); player.timer = null; player.on = false;
  if (player.master) { try { player.master.disconnect(); } catch (e) {} player.master = null; }
  if (player.btn) { player.btn.innerHTML = PLAY_ICON; player.btn.classList.remove('on'); player.btn = null; }
  $('#play').textContent = 'Play preview';
  for (const c of document.querySelectorAll('.col.now')) c.classList.remove('now');
}
$('#play').addEventListener('click', () => { if (player.on && player.partOnly === null) stopAll(); else startPreview(state.plan ? state.plan.startBar * state.plan.barBeats : 0); });
const playFrom = b => startPreview(b);
function togglePartPlay(p, btn) { const was = player.on && player.partOnly === p.id; stopAll(); if (!was) startPreview(0, p.id, btn); }

/* ---------- step 5: build ---------- */
function updateBuild() { $('#build').disabled = !lib || !state.plan; $('#build').textContent = state.plan && state.plan.sets.length > 1 ? `Download ${state.plan.sets.length} Move Sets` : 'Download Move Set'; }
$('#build').addEventListener('click', async () => {
  const btn = $('#build'), st = $('#build-status'); btn.disabled = true; st.textContent = 'Building…'; st.classList.remove('error');
  try {
    const dv = state.dv, plan = state.plan, base = ($('#setname').value || state.fileName || 'MIDI2Move').replace(/[\\/:*?"<>|]/g, '_');
    const notes = new Set();
    for (let i = 0; i < plan.sets.length; i++) {
      const res = await M2M.buildSet(state.song, dv.parts, dv.assign, plan, lib, { kitIndex: state.kit || 0, fold: $('#fold').checked, bends: $('#bends').checked, setIndex: i, sounds: dv.sounds });
      res.warnings.forEach(w => notes.add(w));
      const name = base + (plan.sets.length > 1 ? ` (${i + 1} of ${plan.sets.length})` : '') + '.ablbundle';
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([res.zip], { type: 'application/octet-stream' })); a.download = name;
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      await new Promise(r => setTimeout(r, 400));
    }
    st.textContent = `Saved ${plan.sets.length} Set${plan.sets.length > 1 ? 's' : ''}.` + (notes.size ? ' ' + [...notes].join(' ') : '');
  } catch (err) { st.textContent = err.message; st.classList.add('error'); console.error(err); }
  btn.disabled = false;
});

/* ---------- Live: scene follow actions ---------- */
const alsDrop = $('#alsdrop');
['dragenter', 'dragover'].forEach(ev => alsDrop.addEventListener(ev, e => { e.preventDefault(); alsDrop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => alsDrop.addEventListener(ev, e => { e.preventDefault(); alsDrop.classList.remove('over'); }));
alsDrop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) patchAls(f); });
$('#alsfile').addEventListener('change', e => { if (e.target.files[0]) patchAls(e.target.files[0]); });
async function patchAls(file) {
  const info = $('#alsinfo'); info.classList.remove('error');
  try {
    const xml = await M2M.readAls(new Uint8Array(await file.arrayBuffer()));
    if (!/<Ableton /.test(xml)) throw new Error('That does not look like a Live Set (.als).');
    const scenes = M2M.alsScenes(xml), plan = state.plan;
    const si = plan ? plan.sets.findIndex(s => s.sceneSections.length === scenes.filter(x => x.hasClips).length) : -1;
    const res = si >= 0 ? M2M.planFromOrder(plan.sets[si].order, scenes.length, plan.sectionBeats) : M2M.planFromSceneNames(scenes, state.song ? barBeats() : 4);
    const out = await M2M.writeAls(M2M.patchAlsFollowActions(xml, res.plan));
    const name = file.name.replace(/\.als$/i, '') + ' (plays as song).als';
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([out])); a.download = name; document.body.append(a); a.click(); a.remove();
    info.textContent = `Saved "${name}": ${res.plan.filter(p => p.action !== 'none').length} scenes chained${si >= 0 ? ' in this song\'s play order' : ', top to bottom'}. Open it in Live and launch the first scene.` + (res.repeats ? ' This song repeats sections; Live follows each scene once, so repeats are skipped.' : '');
  } catch (err) { info.textContent = err.message; info.classList.add('error'); }
}

/* ---------- site menu (as CircuitGM) ---------- */
for (const g of document.querySelectorAll('.navgroup > button')) g.addEventListener('click', () => { const li = g.parentElement, open = !li.classList.contains('open'); for (const x of document.querySelectorAll('.navgroup.open')) x.classList.remove('open'); li.classList.toggle('open', open); });
document.addEventListener('click', e => { if (!e.target.closest('.navgroup')) for (const x of document.querySelectorAll('.navgroup.open')) x.classList.remove('open'); });

useSitePack();
}
