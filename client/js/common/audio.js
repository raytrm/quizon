/**
 * Motor de audio para QUIZÓN basado en Web Audio API.
 * Genera efectos y música sutil sin depender de archivos externos,
 * y permite reproducir archivos de audio personalizados si se definen en questions.json.
 */
export class QuizonAudio {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.muted = false;
    this.volume = 0.8;
    this.unlocked = false;
    this.loopTimer = null;
    this.currentUrlAudio = null;
  }

  ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : this.volume;
      this.masterGain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  async unlock() {
    const ctx = this.ensureContext();
    if (!ctx) return false;
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    this.unlocked = ctx.state === 'running';
    return this.unlocked;
  }

  setSettings({ muted, volume }) {
    if (muted !== undefined) this.muted = Boolean(muted);
    if (volume !== undefined) this.volume = Math.max(0, Math.min(1, Number(volume)));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(
        this.muted ? 0 : this.volume,
        this.ctx.currentTime,
        0.04
      );
    }
    if (this.currentUrlAudio) {
      this.currentUrlAudio.muted = this.muted;
      this.currentUrlAudio.volume = this.volume;
    }
  }

  playTone(freq, duration = 0.14, type = 'sine', gainLevel = 0.25, delay = 0) {
    if (!this.unlocked || this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);

    g.gain.setValueAtTime(0.001, start);
    g.gain.exponentialRampToValueAtTime(gainLevel, start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, start + duration);

    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(start);
    osc.stop(start + duration + 0.03);
  }

  playTick() {
    this.playTone(880, 0.06, 'triangle', 0.16);
  }

  playLightningAlert() {
    this.playTone(587.33, 0.1, 'sawtooth', 0.22, 0);
    this.playTone(880, 0.14, 'sawtooth', 0.25, 0.1);
    this.playTone(1174.66, 0.22, 'sawtooth', 0.28, 0.22);
  }

  playReveal() {
    this.playTone(523.25, 0.14, 'triangle', 0.22, 0);
    this.playTone(659.25, 0.14, 'triangle', 0.22, 0.11);
    this.playTone(783.99, 0.28, 'triangle', 0.26, 0.22);
  }

  playFanfare() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, idx) => {
      this.playTone(n, idx === notes.length - 1 ? 0.5 : 0.16, 'triangle', 0.26, idx * 0.14);
    });
  }

  startQuestionBed() {
    this.stopLoop();
    const pattern = [220, 261.63, 293.66, 261.63];
    let step = 0;
    this.loopTimer = setInterval(() => {
      if (!this.unlocked || this.muted) return;
      this.playTone(pattern[step % pattern.length], 0.18, 'sine', 0.08);
      step++;
    }, 550);
  }

  stopLoop() {
    if (this.loopTimer) {
      clearInterval(this.loopTimer);
      this.loopTimer = null;
    }
  }

  playMediaUrl(url) {
    if (!url || !this.unlocked) return;
    if (this.currentUrlAudio) {
      this.currentUrlAudio.pause();
      this.currentUrlAudio = null;
    }
    const audio = new Audio(url);
    audio.muted = this.muted;
    audio.volume = this.volume;
    audio.play().catch(() => {});
    this.currentUrlAudio = audio;
  }
}

