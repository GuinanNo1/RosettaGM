"""Write Ableton Move .ablpresetbundle files (Preset.ablpreset + Samples/).

Structures follow Move-File-Format-Notes.md: outer instrumentRack, no lockId/lockSeal (as Live's
exporter writes), parameter names taken from real Move Sets (song schema 1.7/1.8).
"""
import json
import zipfile
from urllib.parse import quote

SCHEMA = "http://tech.ableton.com/schema/song/1.4.7/devicePreset.json"


def enc(name):
    return 'Samples/' + quote(name, safe='-_.')


def rack_params():
    p = {"Enabled": True}
    for i in range(8):
        p[f"Macro{i}"] = 0.0
    return p


def mixer(sends=None):
    return {"pan": 0.0, "solo-cue": False, "speakerOn": True, "volume": 0.0, "sends": sends or []}


def melodic_sampler(name, sample_file, env, transpose, volume_db, vel_to_vol=0.6):
    return {
        "presetUri": None, "kind": "melodicSampler", "name": name,
        "parameters": {
            "Enabled": True,
            "Voice_AmplitudeEnvelope_Attack": round(env['attack'], 6),
            "Voice_AmplitudeEnvelope_Decay": round(env['decay'], 6),
            "Voice_AmplitudeEnvelope_Release": round(env['release'], 6),
            "Voice_AmplitudeEnvelope_Sustain": round(env['sustain'], 8),
            "Voice_AmplitudeEnvelope_SustainMode": "Gate",
            "Voice_Detune": 0.0,
            "Voice_FilterEnvelope_Attack": 0.00010000000149011611,
            "Voice_FilterEnvelope_Decay": 0.6,
            "Voice_FilterEnvelope_On": True,
            "Voice_FilterEnvelope_Release": 0.05,
            "Voice_FilterEnvelope_Sustain": 0.0,
            "Voice_Filter_Frequency": 22000.0,
            "Voice_Filter_FrequencyModulationAmounts_EnvelopeAmount": 0,
            "Voice_Filter_FrequencyModulationAmounts_LfoAmount": 0.0,
            "Voice_Filter_On": True,
            "Voice_Filter_Resonance": 0.0,
            "Voice_Filter_Slope": "12",
            "Voice_Filter_Type": "Lowpass",
            "Voice_Gain": 1.0,
            "Voice_Lfo_On": True,
            "Voice_Lfo_Rate": 8.065959930419922,
            "Voice_Lfo_Type": "Sine",
            "Voice_PlaybackLength": 1.0,
            "Voice_PlaybackStart": 0.0,
            "Voice_Transpose": int(transpose),
            "Voice_VelocityToVolume": vel_to_vol,
            "Volume": round(volume_db, 2),
        },
        "deviceData": {"sampleUri": enc(sample_file)},
    }


def drum_cell(sample_file, volume_db, decay=10.0):
    # Parameter set copied from a Move-saved Drum Sampler (Chime Set, schema 1.7.0), effects neutral.
    return {
        "presetUri": None, "kind": "drumCell", "name": "",
        "parameters": {
            "Effect_EightBitFilterDecay": 5.0, "Effect_EightBitResamplingRate": 14080.0,
            "Effect_FmAmount": 0.0, "Effect_FmFrequency": 999.9998779296876,
            "Effect_LoopLength": 0.30000001192092896, "Effect_LoopOffset": 0.0,
            "Effect_NoiseAmount": 0.0, "Effect_NoiseFrequency": 10000.0009765625, "Effect_On": True,
            "Effect_PitchEnvelopeAmount": 0.0, "Effect_PitchEnvelopeDecay": 0.29999998211860657,
            "Effect_PunchAmount": 0.0, "Effect_PunchTime": 0.12015999853610992,
            "Effect_RingModAmount": 0.0, "Effect_RingModFrequency": 999.9998168945312,
            "Effect_StretchFactor": 1.0, "Effect_StretchGrainSize": 0.09999999403953552,
            "Effect_SubOscAmount": 0.0, "Effect_SubOscFrequency": 59.99999237060547,
            "Effect_Type": "Sub Osc", "Enabled": True, "NotePitchBend": True, "Pan": 0.0,
            "Voice_Detune": 0.0, "Voice_Envelope_Attack": 9.999999747378752e-05,
            "Voice_Envelope_Decay": decay, "Voice_Envelope_Hold": 0.0010000000474974513,
            "Voice_Envelope_Mode": "A-H-D", "Voice_Filter_Frequency": 21999.990234375,
            "Voice_Filter_On": True, "Voice_Filter_PeakGain": 1.0, "Voice_Filter_Resonance": 0.0,
            "Voice_Filter_Type": "Lowpass", "Voice_Gain": 1.0, "Voice_ModulationAmount": 0.0,
            "Voice_ModulationSource": "Velocity", "Voice_ModulationTarget": "Filter",
            "Voice_PitchToEnvelopeModulation": True, "Voice_PlaybackLength": 1.0, "Voice_PlaybackStart": 0.0,
            "Voice_Transpose": 0, "Voice_VelocityToVolume": 0.3499999940395355, "Volume": round(volume_db, 2),
        },
        "deviceData": {"sampleUri": enc(sample_file) if sample_file else None},
    }


def sampler_preset(name, device):
    return {"$schema": SCHEMA, "kind": "instrumentRack", "name": name, "parameters": rack_params(),
            "chains": [{"name": "", "color": 0, "devices": [device], "mixer": mixer()}]}


def drum_preset(name, pads):
    """pads: list of (receiving_note, sample_file or None, volume_db, choke_group or None)."""
    chains = []
    for note, f, vol, choke in pads:
        chains.append({"name": "", "color": 0, "devices": [drum_cell(f, vol)], "mixer": mixer(),
                       "drumZoneSettings": {"receivingNote": note, "sendingNote": 60, "chokeGroup": choke}})
    rack = {"presetUri": None, "kind": "drumRack", "name": name, "parameters": rack_params(),
            "chains": chains, "returnChains": []}
    return {"$schema": SCHEMA, "kind": "instrumentRack", "name": name, "parameters": rack_params(),
            "chains": [{"name": "", "color": 0, "devices": [rack], "mixer": mixer()}]}


def write_bundle(path, preset, sample_paths):
    """sample_paths: list of (archive_name, local_path)."""
    with zipfile.ZipFile(path, 'w') as z:
        for arc, local in sample_paths:
            z.write(local, 'Samples/' + arc, compress_type=zipfile.ZIP_STORED)
        z.writestr('Preset.ablpreset', json.dumps(preset, indent=2), compress_type=zipfile.ZIP_DEFLATED)
