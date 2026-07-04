export class AudioService {
  private static ctx: AudioContext | null = null;
  private static masterGain: GainNode | null = null;
  private static padOsc1: OscillatorNode | null = null;
  private static padOsc2: OscillatorNode | null = null;
  private static filter: BiquadFilterNode | null = null;
  public static enabled = false;
  private static playing = false;

  public static init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.enabled ? 1 : 0;
      this.masterGain.connect(this.ctx.destination);
    } catch (e) {
      console.warn('AudioContext not supported', e);
    }
  }

  public static setEnabled(val: boolean) {
    this.enabled = val;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(val ? 1 : 0, this.ctx.currentTime, 0.1);
      if (val && !this.playing) {
        this.startPad();
      }
    } else if (val) {
      this.init();
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      this.startPad();
    }
  }

  private static startPad() {
    if (!this.ctx || !this.masterGain || this.playing) return;
    this.playing = true;
    
    this.padOsc1 = this.ctx.createOscillator();
    this.padOsc2 = this.ctx.createOscillator();
    
    this.padOsc1.type = 'sine';
    this.padOsc2.type = 'triangle';
    
    this.padOsc1.frequency.value = 55.0; // Low A
    this.padOsc2.frequency.value = 110.0; // A up an octave
    // detune slightly for spacey feel
    this.padOsc2.detune.value = 12;

    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 300;
    
    // Slow LFO on filter frequency
    const lfo = this.ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.05; // 20s cycle
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 200; // range 100-500Hz
    lfo.connect(lfoGain);
    lfoGain.connect(this.filter.frequency);
    lfo.start();

    const padVolume = this.ctx.createGain();
    padVolume.gain.value = 0.08;

    this.padOsc1.connect(this.filter);
    this.padOsc2.connect(this.filter);
    this.filter.connect(padVolume);
    padVolume.connect(this.masterGain);

    this.padOsc1.start();
    this.padOsc2.start();
  }

  public static playBlip() {
    if (!this.enabled || !this.ctx || !this.masterGain) return;
    
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1200, this.ctx.currentTime + 0.1);
    
    gain.gain.setValueAtTime(0, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.15, this.ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.15);
    
    osc.connect(gain);
    gain.connect(this.masterGain);
    
    osc.start();
    osc.stop(this.ctx.currentTime + 0.2);
  }
}
