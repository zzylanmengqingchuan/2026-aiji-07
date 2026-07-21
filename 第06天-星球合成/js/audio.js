'use strict';
/* ================= Web Audio 程序化音效 ================= */

const SuikaAudio = {
  ctx: null,
  master: null,
  enabled: true,

  init() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? 0.4 : 0;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },

  setEnabled(v) {
    this.enabled = v;
    if (this.master) this.master.gain.value = v ? 0.4 : 0;
  },

  /* 基础音：频率可滑动的小音符 */
  tone(f0, f1, dur, type, vol, delay) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime + (delay || 0);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(f0, 1), t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  },

  /* 白噪声爆发（用于庆典/湮灭） */
  noise(dur, vol, delay) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime + (delay || 0);
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const flt = this.ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.value = 2400;
    src.connect(flt);
    flt.connect(g);
    g.connect(this.master);
    src.start(t);
  },

  drop()      { this.tone(170, 70, 0.1, 'triangle', 0.5); },
  click()     { this.tone(660, 660, 0.05, 'square', 0.12); },
  merge(level) {
    const f = 300 * Math.pow(2, level / 12);
    this.tone(f, f * 1.5, 0.13, 'sine', 0.5);
    this.tone(f * 2, f * 2, 0.09, 'sine', 0.2, 0.04);
  },
  combo(c) {
    const f = 500 + c * 90;
    this.tone(f, f * 1.3, 0.09, 'square', 0.14);
  },
  over() {
    this.tone(300, 75, 0.7, 'sawtooth', 0.3);
    this.tone(200, 55, 0.9, 'triangle', 0.3, 0.12);
  },
  celebrate() {
    const seq = [523, 659, 784, 1047, 1319, 1568];
    for (let i = 0; i < seq.length; i++) this.tone(seq[i], seq[i], 0.2, 'sine', 0.32, i * 0.09);
    this.noise(0.5, 0.16, 0);
    this.noise(0.4, 0.12, 0.3);
  },
};
