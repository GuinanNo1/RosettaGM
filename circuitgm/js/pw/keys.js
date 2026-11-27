// TracksDECK's MIDI keyboard input for Offline mode: notes from any connected MIDI keyboard play
// the browser synth. Nothing is ever sent out, and no SysEx access is asked for.
// A Circuit Tracks works as a keyboard too: its MIDI 1 and MIDI 2 tracks send on channels 3 and 4
// by default (fixed here: channel 3 = Synth 1, channel 4 = Synth 2) without sounding its own synths.

export const SYNTH_CHANNELS = { 2: 0, 3: 1 };   // 0-based MIDI channel -> browser synth (MIDI 1, MIDI 2)
const isTracks = (port) => /circuit tracks/i.test(port.name ?? '');

export class MidiKeys extends EventTarget {
  constructor() {
    super();
    this.access = null;
    this.inputs = [];           // names of the connected inputs
    this.error = null;
    this.onNote = null;         // (on, note, velocity, channel)
    this.onAllOff = null;       // (channel) on All Notes Off / All Sound Off
    this.onSustain = null;      // (down, channel) on the sustain pedal (CC 64)
    this.last = null;           // { channel, name, at } of the last note received
  }

  get supported() { return typeof navigator !== 'undefined' && !!navigator.requestMIDIAccess; }
  get enabled() { return !!this.access; }
  get tracks() { return this.inputs.some((n) => isTracks({ name: n })); }

  async enable() {
    if (!this.supported) { this.error = 'This browser has no Web MIDI: use Chrome or Edge to play from a MIDI keyboard.'; this.emit(); return false; }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch {
      this.error = 'MIDI access was not allowed. Allow MIDI for this page and try again.';
      this.emit();
      return false;
    }
    this.error = null;
    this.access.onstatechange = () => this.scan();
    this.scan();
    return true;
  }

  disable() {
    if (this.access) {
      this.access.onstatechange = null;
      for (const port of this.access.inputs.values()) port.onmidimessage = null;
    }
    this.access = null;
    this.inputs = [];
    this.emit();
  }

  scan() {
    if (!this.access) return;
    const ins = [...this.access.inputs.values()].filter((p) => p.state !== 'disconnected');
    for (const port of ins) port.onmidimessage = (ev) => this.receive(port, ev.data);
    this.inputs = ins.map((p) => p.name ?? 'MIDI input');
    this.emit();
  }

  emit() { this.dispatchEvent(new Event('change')); }

  receive(port, data) {
    if (!data || data.length < 2) return;
    const status = data[0] & 0xf0;
    const ch = data[0] & 0x0f;
    if (status === 0x90 || status === 0x80) {
      const on = status === 0x90 && data[2] > 0;
      if (on) this.last = { channel: ch, name: port.name ?? '', at: performance.now() };
      this.onNote?.(on, data[1], on ? data[2] : 0, ch);
    } else if (status === 0xb0 && (data[1] === 120 || data[1] === 123)) this.onAllOff?.(ch);
    else if (status === 0xb0 && data[1] === 64) this.onSustain?.(data[2] >= 64, ch);
  }
}
