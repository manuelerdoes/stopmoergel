// Tiny synthesized UI sounds (Web Audio, no audio files). Every public function
// is safe to call anywhere: it never throws and silently does nothing if audio
// is unavailable or disabled. Volumes are deliberately gentle.

const STORAGE_KEY = 'stopmoergel.sound';

let enabledCache: boolean | null = null;
let ctx: AudioContext | null = null;

export function isSoundEnabled(): boolean {
  if (enabledCache !== null) return enabledCache;
  let on = true;
  try {
    on = localStorage.getItem(STORAGE_KEY) !== '0';
  } catch {
    /* storage unavailable: default on */
  }
  enabledCache = on;
  return on;
}

export function setSoundEnabled(on: boolean): void {
  enabledCache = on;
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/** Lazily create the shared context. Must be reached from a user gesture on iOS. */
function getCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const w = window as unknown as {
        AudioContext?: typeof AudioContext;
        webkitAudioContext?: typeof AudioContext;
      };
      const Ctor = w.AudioContext ?? w.webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

/** Run `fn` with a ready context, only if sound is on; swallow all errors. */
function play(fn: (ac: AudioContext, t: number) => void): void {
  try {
    if (!isSoundEnabled()) return;
    const ac = getCtx();
    if (!ac) return;
    fn(ac, ac.currentTime + 0.01);
  } catch {
    /* never throw from UI sounds */
  }
}

/** Oscillator with a quick attack and exponential decay. */
function tone(
  ac: AudioContext,
  t: number,
  type: OscillatorType,
  f0: number,
  f1: number,
  dur: number,
  peak: number,
): void {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** Band-passed white noise burst with exponential decay; sweeps filter f0 -> f1. */
function noise(
  ac: AudioContext,
  t: number,
  dur: number,
  peak: number,
  f0: number,
  f1: number,
  q: number,
): void {
  const len = Math.max(1, Math.floor(ac.sampleRate * dur));
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = q;
  filter.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) filter.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(g).connect(ac.destination);
  src.start(t);
}

export function playShutter(): void {
  play((ac, t) => {
    noise(ac, t, 0.12, 0.35, 3500, 1500, 0.8);
    tone(ac, t, 'square', 1800, 600, 0.03, 0.08); // mechanical click
    tone(ac, t + 0.06, 'square', 1200, 500, 0.04, 0.05); // second, softer click
  });
}

export function playPop(): void {
  play((ac, t) => {
    tone(ac, t, 'sine', 420, 900, 0.1, 0.22);
  });
}

export function playWhoosh(): void {
  play((ac, t) => {
    noise(ac, t, 0.2, 0.25, 2800, 300, 1.2);
    tone(ac, t, 'sine', 500, 150, 0.2, 0.06);
  });
}

export function playTada(): void {
  play((ac, t) => {
    // C5 - E5 - G5 arpeggio, last note rings a bit longer.
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((f, i) => {
      const dur = i === notes.length - 1 ? 0.35 : 0.14;
      tone(ac, t + i * 0.11, 'triangle', f, f, dur, 0.2);
    });
  });
}
