"""MoveGM Drift synth alternatives for GM synth-family programs.

Structure (as Ableton documents and Live exports): outer instrumentRack > [instrumentRack(mapped macros) > [drift]].
Parameter *names* come from Drift devices in the user's own Move Sets (all 83 identical across schemas);
every value below is our own (NEUTRAL patch + per-program settings), nothing copied from a preset.
"""
import copy
import movepreset as mp

NEUTRAL = {
    "CyclingEnvelope_Hold": 0.0, "CyclingEnvelope_MidPoint": 0.5, "CyclingEnvelope_Mode": "Freq",
    "CyclingEnvelope_Rate": 5.0, "CyclingEnvelope_Ratio": 1.0, "CyclingEnvelope_SyncedRate": 15,
    "CyclingEnvelope_Time": 1.0, "Enabled": True,
    "Envelope1_Attack": 0.001, "Envelope1_Decay": 0.6, "Envelope1_Release": 0.4, "Envelope1_Sustain": 0.8,
    "Envelope2_Attack": 0.001, "Envelope2_Decay": 0.6, "Envelope2_Release": 0.4, "Envelope2_Sustain": 0.0,
    "Filter_Frequency": 20000.0, "Filter_HiPassFrequency": 10.0, "Filter_ModAmount1": 0.0, "Filter_ModAmount2": 0.0,
    "Filter_ModSource1": "Env 2 / Cyc", "Filter_ModSource2": "Velocity", "Filter_NoiseThrough": True,
    "Filter_OscillatorThrough1": True, "Filter_OscillatorThrough2": True, "Filter_Resonance": 0.0,
    "Filter_Tracking": 0.5, "Filter_Type": "I",
    "Global_DriftDepth": 0.08, "Global_Envelope2Mode": "Env", "Global_Glide": 0.0, "Global_HiQuality": False,
    "Global_Legato": False, "Global_MonoVoiceDepth": 0.0, "Global_NotePitchBend": True, "Global_PitchBendRange": 2,
    "Global_PolyVoiceDepth": 0.0, "Global_ResetOscillatorPhase": False, "Global_SerialNumber": 0,
    "Global_StereoVoiceDepth": 0.1, "Global_Transpose": 0, "Global_UnisonVoiceDepth": 0.0, "Global_VoiceCount": "8",
    "Global_VoiceMode": "Poly", "Global_VolVelMod": 0.4, "Global_Volume": 0.7,
    "Lfo_Amount": 0.0, "Lfo_ModAmount": 0.0, "Lfo_ModSource": "Velocity", "Lfo_Mode": "Freq", "Lfo_Rate": 5.0,
    "Lfo_Ratio": 1.0, "Lfo_Retrigger": False, "Lfo_Shape": "Sine", "Lfo_SyncedRate": 15, "Lfo_Time": 1.0,
    "Mixer_NoiseLevel": 0.0, "Mixer_NoiseOn": False, "Mixer_OscillatorGain1": 0.5, "Mixer_OscillatorGain2": 0.5,
    "Mixer_OscillatorOn1": True, "Mixer_OscillatorOn2": False,
    "ModulationMatrix_Amount1": 0.0, "ModulationMatrix_Amount2": 0.0, "ModulationMatrix_Amount3": 0.0,
    "ModulationMatrix_Source1": "Velocity", "ModulationMatrix_Source2": "LFO", "ModulationMatrix_Source3": "Pressure",
    "ModulationMatrix_Target1": "None", "ModulationMatrix_Target2": "None", "ModulationMatrix_Target3": "None",
    "Oscillator1_Shape": 0.0, "Oscillator1_ShapeMod": 0.0, "Oscillator1_ShapeModSource": "Env 2 / Cyc",
    "Oscillator1_Transpose": 0, "Oscillator1_Type": "Saw",
    "Oscillator2_Detune": 0.0, "Oscillator2_Transpose": 0, "Oscillator2_Type": "Saw",
    "PitchModulation_Amount1": 0.0, "PitchModulation_Amount2": 0.0,
    "PitchModulation_Source1": "Env 2 / Cyc", "PitchModulation_Source2": "LFO",
}

# 8 macros (index: param, label, other end of range, where the preset value sits).
# The preset's own value is always placed at an END of the macro range and the macro parked at 0 or 127,
# so the parameter is exact whatever curve Live/Move use to map macro -> parameter (they recompute on load).
MACROS = [("Filter_Frequency", "Filter Freq", 20.0, "max"),      # turn down to darken
          ("Filter_Resonance", "Filter Reso", 1.0, "min"),
          ("Filter_ModAmount1", "Filter Env", 1.0, "min"),
          ("Mixer_OscillatorGain2", "Osc 2 Level", 0.0, "max"),
          ("Envelope1_Attack", "Attack", 4.0, "min"),
          ("Envelope1_Decay", "Decay", 4.0, "min"),
          ("Envelope1_Release", "Release", 6.0, "min"),
          ("Global_Glide", "Glide", 1.0, "min")]


def two(o1="Saw", o2="Saw", det=0.0, g2=0.45, t2=0):
    return {"Oscillator1_Type": o1, "Oscillator2_Type": o2, "Oscillator2_Detune": det, "Mixer_OscillatorOn2": True,
            "Mixer_OscillatorGain2": g2, "Oscillator2_Transpose": t2}


def env1(a, d, s, r):
    return {"Envelope1_Attack": a, "Envelope1_Decay": d, "Envelope1_Sustain": s, "Envelope1_Release": r}


def fenv(freq, amt=0.0, a=0.001, d=0.4, s=0.0, res=0.0):
    return {"Filter_Frequency": freq, "Filter_ModAmount1": amt, "Filter_Resonance": res,
            "Envelope2_Attack": a, "Envelope2_Decay": d, "Envelope2_Sustain": s, "Envelope2_Release": 0.4}


MONO = {"Global_VoiceMode": "Mono", "Global_Legato": True}
VIB = {"PitchModulation_Source2": "LFO", "PitchModulation_Amount2": 0.012, "Lfo_Amount": 1.0, "Lfo_Rate": 5.5}

PATCHES = {  # GM program (0-based): settings
    38: {**MONO, **two("Saw", "Saw", 0.08, 0.5, -1), **env1(0.001, 0.5, 0.8, 0.12), **fenv(380, 0.55, d=0.28, res=0.3)},
    39: {**MONO, **two("Rectangle", "Saw", 0.0, 0.35, -1), **env1(0.001, 0.4, 0.7, 0.1), **fenv(650, 0.45, d=0.22, res=0.25)},
    50: {**two("Saw", "Saw", 0.12, 0.5), **env1(0.35, 1.0, 0.9, 0.9), **fenv(3500, 0.1, a=0.3, d=1.0, s=0.5)},
    51: {**two("Saw", "Triangle", 0.1, 0.5), **env1(0.55, 1.0, 0.9, 1.1), **fenv(2400, 0.1, a=0.5, d=1.2, s=0.5),
         "Global_DriftDepth": 0.15},
    54: {**two("Sine", "Triangle", 0.07, 0.6), **env1(0.2, 1.0, 0.85, 0.8), **fenv(2000), **VIB},
    62: {**two("Saw", "Saw", 0.08, 0.5), **env1(0.02, 0.6, 0.75, 0.3), **fenv(900, 0.5, a=0.05, d=0.4, s=0.3, res=0.1)},
    63: {**two("Saw", "Rectangle", 0.05, 0.4), **env1(0.04, 0.6, 0.8, 0.35), **fenv(1300, 0.35, a=0.08, d=0.5, s=0.35)},
    80: {**MONO, "Oscillator1_Type": "Rectangle", **env1(0.002, 0.3, 0.9, 0.15), **fenv(5000), "Global_Glide": 0.05},
    81: {**MONO, **two("Saw", "Saw", 0.1, 0.5), **env1(0.002, 0.3, 0.9, 0.15), **fenv(4000, 0.2, d=0.3, res=0.2),
         "Global_Glide": 0.05},
    82: {**two("Triangle", "Sine", 0.0, 0.5, 1), **env1(0.03, 0.4, 0.9, 0.25), **fenv(6000), "Mixer_NoiseOn": True,
         "Mixer_NoiseLevel": 0.08, **VIB},
    83: {**MONO, "Oscillator1_Type": "Pulse", "Oscillator1_Shape": 0.3, **env1(0.002, 0.25, 0.8, 0.2),
         **fenv(2500, 0.5, d=0.08), "Mixer_NoiseOn": True, "Mixer_NoiseLevel": 0.1},
    84: {**MONO, **two("Saturated", "Saw", 0.06, 0.4), **env1(0.002, 0.4, 0.85, 0.2), **fenv(3000, 0.25, d=0.3, res=0.3)},
    85: {**MONO, **two("Sine", "Triangle", 0.07, 0.6), **env1(0.06, 0.5, 0.9, 0.3), **fenv(3000), **VIB},
    86: {**MONO, **two("Saw", "Saw", 7.0, 0.5), **env1(0.002, 0.4, 0.85, 0.2), **fenv(3500, 0.2, d=0.3, res=0.15)},
    87: {**MONO, **two("Saw", "Saw", 0.05, 0.6, -1), **env1(0.002, 0.4, 0.85, 0.2), **fenv(2500, 0.35, d=0.3, res=0.25)},
    88: {**two("Sine", "Triangle", 0.05, 0.5, 1), **env1(0.4, 1.5, 0.8, 2.0), **fenv(3000), "Global_DriftDepth": 0.15},
    89: {**two("Saw", "Saw", 0.12, 0.5), **env1(0.6, 1.5, 0.9, 1.5), **fenv(1200, 0.15, a=0.6, d=1.5, s=0.3)},
    90: {**two("Saw", "Saw", 0.1, 0.5), **env1(0.01, 0.8, 0.7, 0.8), **fenv(2000, 0.3, d=0.8, s=0.2, res=0.1)},
    91: {**two("Triangle", "Sine", 0.08, 0.6), **env1(0.5, 1.5, 0.9, 1.5), **fenv(2500), **VIB, "Lfo_Rate": 4.5},
    92: {"Oscillator1_Type": "Saw", **env1(0.8, 1.5, 0.9, 1.2), **fenv(1500, 0.15, a=0.8, d=1.5, s=0.4),
         "Global_DriftDepth": 0.2},
    93: {**two("Shark Tooth", "Rectangle", 0.3, 0.35, 1), **env1(0.3, 1.5, 0.8, 1.5), **fenv(4000, 0.1, res=0.3)},
    94: {**two("Sine", "Saw", 0.1, 0.25), **env1(1.0, 2.0, 0.9, 2.5), **fenv(2200), "Global_DriftDepth": 0.15},
    95: {**two("Saw", "Saw", 0.1, 0.5), **env1(0.5, 1.5, 0.9, 1.5), **fenv(300, 0.0, res=0.35),
         "Filter_ModSource2": "LFO", "Filter_ModAmount2": 0.18, "Lfo_Amount": 1.0, "Lfo_Rate": 0.2},
}


def drift_preset(name, prog):
    p = copy.deepcopy(NEUTRAL)
    p.update(PATCHES[prog])
    inner_params = {"Enabled": True}
    for i, (param, label, other, at) in enumerate(MACROS):
        v = float(p[param])
        if at == "max":
            lo, hi, mv = min(other, v), v, 127.0
        else:
            lo, hi, mv = v, max(other, v), 0.0
        if hi == lo:                       # degenerate: widen so the knob still does something
            hi = lo + (1.0 if at == "min" else 0.0) or lo + 1.0
        p[param] = {"value": v, "macroMapping": {"macroIndex": i, "rangeMin": lo, "rangeMax": hi}}
        inner_params[f"Macro{i}"] = {"value": mv, "customName": label}
    drift = {"presetUri": None, "kind": "drift", "name": name, "parameters": p, "deviceData": {}}
    inner = {"presetUri": None, "kind": "instrumentRack", "name": "Drift", "parameters": inner_params,
             "chains": [{"name": "", "color": 0, "devices": [drift], "mixer": mp.mixer()}]}
    return {"$schema": mp.SCHEMA, "kind": "instrumentRack", "name": name, "parameters": mp.rack_params(),
            "chains": [{"name": "", "color": 0, "devices": [inner], "mixer": mp.mixer()}]}
