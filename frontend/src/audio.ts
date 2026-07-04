export class AudioService {
  private static ctx: AudioContext | null = null;
  private static masterGain: GainNode | null = null;
  private static masterFilter: BiquadFilterNode | null = null;

  public static init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      this.masterFilter = this.ctx.createBiquadFilter();
      this.masterFilter.type = 'lowpass';
      this.masterFilter.frequency.value = 4500;
      
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 1;
      
      this.masterFilter.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);
    } catch (e) {
      console.warn('AudioContext not supported', e);
    }
  }

  public static playBlip() {
    this.init();
    if (!this.ctx || !this.masterFilter) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    
    const t = this.ctx.currentTime;
    
    // Layer 1: Sine
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(780, t);
    osc.frequency.exponentialRampToValueAtTime(620, t + 0.07);
    
    const oscGain = this.ctx.createGain();
    oscGain.gain.setValueAtTime(0, t);
    oscGain.gain.linearRampToValueAtTime(0.07, t + 0.01);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    
    osc.connect(oscGain);
    oscGain.connect(this.masterFilter);
    osc.start(t);
    osc.stop(t + 0.12);
    
    // Layer 2: Noise burst
    const bufferSize = this.ctx.sampleRate * 0.012; // 12ms
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) output[i] = Math.random() * 2 - 1;
    
    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    
    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 2000;
    noiseFilter.Q.value = 6;
    
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.07, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.012);
    
    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.masterFilter);
    
    noiseSource.start(t);
  }
}
