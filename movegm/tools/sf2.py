"""Minimal SoundFont 2 parser: presets -> instruments -> samples, with generator resolution.

Implements SF2.01 zone semantics for generators (global zones, preset-level generators
added to instrument-level ones, key/vel range intersection). Modulators are ignored.
"""
import struct
import numpy as np

# Generator IDs (SF2.01 spec section 8.1.2)
GEN = dict(startAddrsOffset=0, endAddrsOffset=1, startloopAddrsOffset=2, endloopAddrsOffset=3,
           startAddrsCoarseOffset=4, modLfoToPitch=5, vibLfoToPitch=6, modEnvToPitch=7,
           initialFilterFc=8, initialFilterQ=9, modLfoToFilterFc=10, modEnvToFilterFc=11,
           endAddrsCoarseOffset=12, modLfoToVolume=13, chorusEffectsSend=15, reverbEffectsSend=16,
           pan=17, delayModLFO=21, freqModLFO=22, delayVibLFO=23, freqVibLFO=24,
           delayModEnv=25, attackModEnv=26, holdModEnv=27, decayModEnv=28, sustainModEnv=29,
           releaseModEnv=30, keynumToModEnvHold=31, keynumToModEnvDecay=32,
           delayVolEnv=33, attackVolEnv=34, holdVolEnv=35, decayVolEnv=36, sustainVolEnv=37,
           releaseVolEnv=38, keynumToVolEnvHold=39, keynumToVolEnvDecay=40, instrument=41,
           keyRange=43, velRange=44, startloopAddrsCoarseOffset=45, keynum=46, velocity=47,
           initialAttenuation=48, endloopAddrsCoarseOffset=50, coarseTune=51, fineTune=52,
           sampleID=53, sampleModes=54, scaleTuning=56, exclusiveClass=57, overridingRootKey=58)
GEN_NAME = {v: k for k, v in GEN.items()}
SIGNED = {GEN[n] for n in GEN} - {GEN['keyRange'], GEN['velRange'], GEN['instrument'],
                                   GEN['sampleID'], GEN['sampleModes']}
# Defaults (spec 8.1.3) for generators we care about
DEFAULTS = {GEN['initialFilterFc']: 13500, GEN['delayVolEnv']: -12000, GEN['attackVolEnv']: -12000,
            GEN['holdVolEnv']: -12000, GEN['decayVolEnv']: -12000, GEN['releaseVolEnv']: -12000,
            GEN['delayModEnv']: -12000, GEN['attackModEnv']: -12000, GEN['holdModEnv']: -12000,
            GEN['decayModEnv']: -12000, GEN['releaseModEnv']: -12000,
            GEN['scaleTuning']: 100, GEN['overridingRootKey']: -1, GEN['keynum']: -1, GEN['velocity']: -1}
# Generators that are NOT additive at preset level (spec 8.5: preset-level only offsets these)
NON_ADDITIVE_IN_PRESET = {GEN[n] for n in ('startAddrsOffset', 'endAddrsOffset', 'startloopAddrsOffset',
                          'endloopAddrsOffset', 'startAddrsCoarseOffset', 'endAddrsCoarseOffset',
                          'startloopAddrsCoarseOffset', 'endloopAddrsCoarseOffset', 'keynum', 'velocity',
                          'sampleModes', 'exclusiveClass', 'overridingRootKey')}


def _chunks(buf, off, end):
    while off + 8 <= end:
        cid = buf[off:off + 4].decode('latin1')
        size = struct.unpack_from('<I', buf, off + 4)[0]
        yield cid, off + 8, size
        off += 8 + size + (size & 1)


def _cstr(b):
    return b.split(b'\0', 1)[0].decode('latin1').strip()


class Sample:
    def __init__(self, sf, name, start, end, sloop, eloop, rate, pitch, corr, link, stype):
        self.sf, self.name, self.start, self.end = sf, name, start, end
        self.sloop, self.eloop, self.rate = sloop, eloop, rate
        self.pitch, self.corr, self.link, self.type = pitch, corr, link, stype

    @property
    def is_left(self): return self.type & 4 == 4
    @property
    def is_right(self): return self.type & 2 == 2
    @property
    def is_rom(self): return bool(self.type & 0x8000)

    def data(self, a=None, b=None):
        """float32 [-1,1] for absolute sample index range [a,b)."""
        a = self.start if a is None else a
        b = self.end if b is None else b
        return self.sf.pcm[a:b].astype(np.float32) / 32768.0


class Zone:
    def __init__(self, gens, mods=()):
        self.gens = gens  # dict gen_id -> raw value (int or (lo,hi))
        self.mods = list(mods)  # (src, dest, amount, amtsrc, trans)

    def get(self, name, default=None):
        g = GEN[name]
        if g in self.gens:
            return self.gens[g]
        return DEFAULTS.get(g, 0) if default is None else default


class SF2:
    def __init__(self, path):
        buf = open(path, 'rb').read()
        assert buf[:4] == b'RIFF' and buf[8:12] == b'sfbk', 'not an SF2 file'
        lists = {}
        for cid, off, size in _chunks(buf, 12, len(buf)):
            if cid == 'LIST':
                lists[buf[off:off + 4].decode()] = (off + 4, off + size)
        self.info = {}
        for cid, off, size in _chunks(buf, *lists['INFO']):
            self.info[cid] = _cstr(buf[off:off + size]) if cid != 'ifil' else struct.unpack_from('<HH', buf, off)
        sd = {cid: (off, size) for cid, off, size in _chunks(buf, *lists['sdta'])}
        off, size = sd['smpl']
        self.pcm = np.frombuffer(buf, dtype='<i2', count=size // 2, offset=off)
        pd = {cid: (off, size) for cid, off, size in _chunks(buf, *lists['pdta'])}

        def recs(name, fmt):
            off, size = pd[name]
            n = struct.calcsize(fmt)
            return [struct.unpack_from(fmt, buf, off + i * n) for i in range(size // n)]

        phdr = recs('phdr', '<20sHHHIII')
        pbag = recs('pbag', '<HH')
        pgen = recs('pgen', '<HH')
        inst = recs('inst', '<20sH')
        ibag = recs('ibag', '<HH')
        igen = recs('igen', '<HH')
        pmod = recs('pmod', '<HHhHH')
        imod = recs('imod', '<HHhHH')
        shdr = recs('shdr', '<20sIIIIIBbHH')

        self.samples = [Sample(self, _cstr(r[0]), *r[1:6], r[6], r[7], r[8], r[9]) for r in shdr[:-1]]

        def gens_for(bags, gens, i):
            out = {}
            for g in range(bags[i][0], bags[i + 1][0]):
                op, amt = gens[g]
                if op in (GEN['keyRange'], GEN['velRange']):
                    out[op] = (amt & 0xFF, amt >> 8)
                elif op in SIGNED:
                    out[op] = struct.unpack('<h', struct.pack('<H', amt))[0]
                else:
                    out[op] = amt
            return out

        def zones(hdrs, bag_idx, bags, gens, term, mods):
            res = []
            for i in range(len(hdrs) - 1):
                zs = [Zone(gens_for(bags, gens, b), mods[bags[b][1]:bags[b + 1][1]])
                      for b in range(hdrs[i][bag_idx], hdrs[i + 1][bag_idx])]
                glob = None
                if zs and term not in zs[0].gens:
                    glob = zs.pop(0)
                res.append((glob, zs))
            return res

        self.instruments = []
        for (name, _), (glob, zs) in zip(inst, zones(inst, 1, ibag, igen, GEN['sampleID'], imod)):
            self.instruments.append(dict(name=_cstr(name), glob=glob, zones=zs))
        self.presets = {}
        for h, (glob, zs) in zip(phdr, zones(phdr, 3, pbag, pgen, GEN['instrument'], pmod)):
            self.presets[(h[2], h[1])] = dict(name=_cstr(h[0]), bank=h[2], program=h[1], glob=glob, zones=zs)

    # ------------------------------------------------------------------
    def regions(self, bank, program):
        """Flatten a preset into playable regions: list of dicts with sample + resolved gens."""
        p = self.presets.get((bank, program))
        if p is None:
            return []
        out = []
        for pz in p['zones']:
            pg = dict(p['glob'].gens) if p['glob'] else {}
            pg.update(pz.gens)
            ins = self.instruments[pg[GEN['instrument']]]
            for iz in ins['zones']:
                ig = dict(ins['glob'].gens) if ins['glob'] else {}
                ig.update(iz.gens)
                kr = _isect(pg.get(GEN['keyRange'], (0, 127)), ig.get(GEN['keyRange'], (0, 127)))
                vr = _isect(pg.get(GEN['velRange'], (0, 127)), ig.get(GEN['velRange'], (0, 127)))
                if kr is None or vr is None:
                    continue
                g = {k: v for k, v in DEFAULTS.items()}
                g.update({k: v for k, v in ig.items() if k not in (GEN['keyRange'], GEN['velRange'])})
                for k, v in pg.items():
                    if k in (GEN['keyRange'], GEN['velRange'], GEN['instrument']) or k in NON_ADDITIVE_IN_PRESET:
                        continue
                    g[k] = g.get(k, DEFAULTS.get(k, 0)) + v
                # modulators: defaults < instrument global < instrument zone (replace by identity); preset adds
                im = {}
                for m in DEFAULT_MODS + (ins['glob'].mods if ins['glob'] else []) + iz.mods:
                    im[(m[0], m[1], m[3])] = m
                pm = {}
                for m in (p['glob'].mods if p['glob'] else []) + pz.mods:
                    pm[(m[0], m[1], m[3])] = m
                out.append(dict(sample=self.samples[g[GEN['sampleID']]], gens=g, key=kr, vel=vr,
                                instrument=ins['name'], mods=list(im.values()), pmods=list(pm.values())))
        return out


def _isect(a, b):
    lo, hi = max(a[0], b[0]), min(a[1], b[1])
    return (lo, hi) if lo <= hi else None


def gname(g, name):
    return g.get(GEN[name], DEFAULTS.get(GEN[name], 0))


# SF2.01 default modulators (spec 8.4) as (src, dest, amount, amtsrc, trans)
DEFAULT_MODS = [
    (0x0502, GEN['initialAttenuation'], 960, 0, 0),   # velocity -> attenuation (concave, neg)
    (0x0102, GEN['initialFilterFc'], -2400, 0, 0),    # velocity -> filter cutoff (linear, neg)
    (0x000D, GEN['vibLfoToPitch'], 50, 0, 0),         # channel pressure -> vib LFO pitch
    (0x0081, GEN['vibLfoToPitch'], 50, 0, 0),         # CC1 -> vib LFO pitch
    (0x0587, GEN['initialAttenuation'], 960, 0, 0),   # CC7 -> attenuation
    (0x028A, GEN['pan'], 1000, 0, 0),                 # CC10 -> pan
    (0x058B, GEN['initialAttenuation'], 960, 0, 0),   # CC11 -> attenuation
    (0x00DB, GEN['reverbEffectsSend'], 200, 0, 0),    # CC91 -> reverb
    (0x00DD, GEN['chorusEffectsSend'], 200, 0, 0),    # CC93 -> chorus
]
CC_DEFAULTS = {7: 100, 10: 64, 11: 127, 91: 40, 93: 0, 64: 0, 1: 0}


def _src_value(src, key, vel):
    if src == 0:
        return 1.0
    idx, cc, d, p, t = src & 0x7F, (src >> 7) & 1, (src >> 8) & 1, (src >> 9) & 1, src >> 10
    if cc:
        raw = CC_DEFAULTS.get(idx, 0)
    else:
        raw = {0: 127, 2: vel, 3: key, 10: 0, 13: 0, 14: 8192, 16: 2}.get(idx, 0)
    span = 16383.0 if (not cc and idx == 14) else 127.0
    x = raw / span
    if d:
        x = 1.0 - x
    import math
    if t == 1:      # concave
        f = lambda v: 0.0 if v <= 0 else (1.0 if v >= 1 else -20.0 / 96.0 * math.log10((1 - v) ** 2) if v < 1 else 1.0)
    elif t == 2:    # convex
        f = lambda v: 0.0 if v <= 0 else (1.0 if v >= 1 else 1 + 20.0 / 96.0 * math.log10(v ** 2))
    elif t == 3:    # switch
        f = lambda v: 1.0 if v >= 0.5 else 0.0
    else:
        f = lambda v: v
    if p:           # bipolar
        return 2.0 * f(x) - 1.0 if t == 0 else (f(2 * x - 1) if x >= .5 else -f(1 - 2 * x))
    return f(x)


def mod_offset(region, dest, key, vel, include=('mods', 'pmods')):
    """Sum of modulator contributions to generator `dest` for this key/velocity."""
    tot = 0.0
    for k in include:
        for src, dst, amt, asrc, _ in region.get(k, []):
            if dst == dest:
                tot += amt * _src_value(src, key, vel) * _src_value(asrc, key, vel)
    return tot
