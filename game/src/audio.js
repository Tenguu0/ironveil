// All sound is synthesized with WebAudio — zero network, zero audio files.
// A small synth kit: gunshots (filtered noise burst + thump), hits, reload clicks,
// plant/defuse beeps, the charge alarm, the explosion and round stingers.
export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch {
      return false;
    }
    return true;
  }

  function noiseBuffer(seconds) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function burst({ dur = 0.12, freq = 1800, q = 0.8, gain = 0.5, type = 'bandpass', slideTo = 0 }) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(dur + 0.05);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    if (slideTo) filter.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t + dur);
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  function tone({ freq = 440, dur = 0.1, gain = 0.25, type = 'sine', slideTo = 0, delay = 0 }) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  return {
    unlock() { ensure(); },
    toggleMute() { muted = !muted; return muted; },
    get muted() { return muted; },
    shot(kind) {
      if (kind === 'sniper') {
        burst({ dur: 0.28, freq: 900, slideTo: 120, gain: 0.9, q: 0.6 });
        tone({ freq: 160, dur: 0.16, gain: 0.5, type: 'triangle', slideTo: 50 });
      } else if (kind === 'smg') {
        burst({ dur: 0.08, freq: 2400, slideTo: 500, gain: 0.42, q: 1.1 });
      } else if (kind === 'pistol') {
        burst({ dur: 0.09, freq: 2000, slideTo: 400, gain: 0.45, q: 1.0 });
      } else { // rifle
        burst({ dur: 0.14, freq: 1500, slideTo: 220, gain: 0.6, q: 0.9 });
        tone({ freq: 130, dur: 0.1, gain: 0.35, type: 'triangle', slideTo: 55 });
      }
    },
    distantShot() { burst({ dur: 0.16, freq: 700, slideTo: 140, gain: 0.22, q: 0.7 }); },
    hit(kill) {
      tone({ freq: kill ? 1320 : 990, dur: 0.07, gain: 0.3, type: 'square' });
      if (kill) tone({ freq: 1760, dur: 0.12, gain: 0.22, type: 'square', delay: 0.06 });
    },
    hurt() { tone({ freq: 220, dur: 0.18, gain: 0.35, type: 'sawtooth', slideTo: 90 }); },
    reload() {
      tone({ freq: 500, dur: 0.05, gain: 0.2, type: 'square' });
      tone({ freq: 700, dur: 0.05, gain: 0.2, type: 'square', delay: 0.28 });
      tone({ freq: 900, dur: 0.06, gain: 0.25, type: 'square', delay: 0.55 });
    },
    dryClick() { tone({ freq: 1200, dur: 0.04, gain: 0.18, type: 'square' }); },
    buy() { tone({ freq: 880, dur: 0.07, gain: 0.22, type: 'sine' }); tone({ freq: 1320, dur: 0.09, gain: 0.18, type: 'sine', delay: 0.07 }); },
    beep(final) { tone({ freq: final ? 1560 : 1040, dur: final ? 0.3 : 0.09, gain: 0.25, type: 'square' }); },
    plantDone() { tone({ freq: 660, dur: 0.12, gain: 0.25, type: 'square' }); tone({ freq: 990, dur: 0.18, gain: 0.25, type: 'square', delay: 0.12 }); },
    explosion() {
      burst({ dur: 1.1, freq: 300, slideTo: 45, gain: 1.0, q: 0.4, type: 'lowpass' });
      tone({ freq: 70, dur: 0.9, gain: 0.7, type: 'sine', slideTo: 28 });
    },
    roundWin() {
      [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, dur: 0.16, gain: 0.22, type: 'triangle', delay: i * 0.11 }));
    },
    roundLose() {
      [392, 330, 262, 196].forEach((f, i) => tone({ freq: f, dur: 0.18, gain: 0.2, type: 'triangle', delay: i * 0.12 }));
    },
    step() { burst({ dur: 0.05, freq: 300, gain: 0.08, q: 0.5, type: 'lowpass' }); },
  };
}
