/**
 * Synthesized sound effects — Web Audio API only, no audio files.
 *
 * The AudioContext is created lazily and resumed on the first user
 * interaction (pointerdown/keydown) to satisfy browser autoplay policy.
 * Mute state persists per tab in sessionStorage ('uno-party:muted').
 */

export type SoundName = 'laugh' | 'drumroll' | 'whoosh' | 'click' | 'fanfare' | 'pop';

const MUTE_KEY = 'uno-party:muted';

let ctx: AudioContext | null = null;
let unlocked = false;

export function isMuted(): boolean {
  try {
    return sessionStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setMuted(muted: boolean): void {
  try {
    sessionStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // storage unavailable — mute just won't persist
  }
}

function getCtx(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Call once at app start: unlocks audio on the first user gesture. */
export function initSoundUnlock(): void {
  if (unlocked) return;
  unlocked = true;
  const unlock = () => {
    getCtx();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

// ---- tiny synth helpers ----

function tone(
  ac: AudioContext,
  { freq, freqEnd, type = 'sine', at = 0, dur = 0.15, gain = 0.2 }: {
    freq: number;
    freqEnd?: number;
    type?: OscillatorType;
    at?: number;
    dur?: number;
    gain?: number;
  },
): void {
  const t0 = ac.currentTime + at;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
  amp.gain.setValueAtTime(0, t0);
  amp.gain.linearRampToValueAtTime(gain, t0 + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(amp).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noiseBurst(
  ac: AudioContext,
  { at = 0, dur = 0.1, gain = 0.15, low = 1000, high = 8000 }: {
    at?: number;
    dur?: number;
    gain?: number;
    low?: number;
    high?: number;
  },
): void {
  const t0 = ac.currentTime + at;
  const len = Math.max(1, Math.floor(ac.sampleRate * dur));
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(high, t0);
  bp.frequency.exponentialRampToValueAtTime(low, t0 + dur);
  const amp = ac.createGain();
  amp.gain.setValueAtTime(gain, t0);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bp).connect(amp).connect(ac.destination);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

// ---- the effects ----

/** "ha-ha-ha" chuckle, ~0.9s — played with the 😂 penalty emoji. */
function laugh(ac: AudioContext): void {
  for (let i = 0; i < 3; i++) {
    tone(ac, { freq: 520 - i * 90, freqEnd: 380 - i * 70, type: 'sawtooth', at: i * 0.22, dur: 0.16, gain: 0.12 });
  }
}

/** Snare-ish drumroll, ~1.2s — played during the UNO screen shake. */
function drumroll(ac: AudioContext): void {
  for (let i = 0; i < 24; i++) {
    noiseBurst(ac, { at: i * 0.05, dur: 0.04, gain: 0.05 + (i / 24) * 0.08, low: 1200, high: 4000 });
  }
  tone(ac, { freq: 90, freqEnd: 50, type: 'sine', at: 1.2, dur: 0.35, gain: 0.3 }); // crash
  noiseBurst(ac, { at: 1.2, dur: 0.3, gain: 0.2, low: 500, high: 6000 });
}

/** Quick whoosh — a card slides onto the pile. */
function whoosh(ac: AudioContext): void {
  noiseBurst(ac, { dur: 0.18, gain: 0.12, low: 900, high: 5000 });
}

/** Soft click — a card is drawn from the deck. */
function click(ac: AudioContext): void {
  tone(ac, { freq: 1400, freqEnd: 900, type: 'triangle', dur: 0.05, gain: 0.15 });
}

/** Little victory arpeggio — winner screen fanfare. */
function fanfare(ac: AudioContext): void {
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  notes.forEach((freq, i) => {
    tone(ac, { freq, type: 'triangle', at: i * 0.14, dur: 0.35, gain: 0.18 });
    tone(ac, { freq: freq / 2, type: 'sine', at: i * 0.14, dur: 0.35, gain: 0.1 });
  });
  tone(ac, { freq: 1318.5, type: 'triangle', at: notes.length * 0.14, dur: 0.6, gain: 0.16 });
}

/** Tiny bubble pop — incoming chat message. */
function pop(ac: AudioContext): void {
  tone(ac, { freq: 880, freqEnd: 1320, type: 'sine', dur: 0.07, gain: 0.1 });
}

const SOUNDS: Record<SoundName, (ac: AudioContext) => void> = {
  laugh,
  drumroll,
  whoosh,
  click,
  fanfare,
  pop,
};

/** Play a sound, honoring mute + autoplay policy. Never throws. */
export function playSound(name: SoundName): void {
  if (isMuted()) return;
  try {
    const ac = getCtx();
    if (!ac || ac.state !== 'running') return; // not unlocked yet — skip silently
    SOUNDS[name](ac);
  } catch {
    // audio unavailable — stay silent
  }
}
