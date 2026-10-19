// ---- sound: synthesized live, off until the visitor turns it on ----
// whoosh as a module lands, crackle as a cable joins, a swell at the surge,
// a tick per recorded second, an alarm when a server dies.
// Nothing plays continuously: only events make sound.
const Sound = (() => {
  let ac = null, master, noise, lastTick = 0;
  const on = () => !!ac && ac.state === "running";
  function noiseBuffer() {
    const b = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate), d = b.getChannelData(0);
    let x = 9; for (let i = 0; i < d.length; i++) { x = (x * 1664525 + 1013904223) >>> 0; d[i] = x / 2147483648 - 1; }
    return b;
  }
  function start() {
    ac = new AudioContext();
    master = ac.createGain(); master.gain.value = 0; master.connect(ac.destination);
    master.gain.setTargetAtTime(0.85, ac.currentTime, 0.3);
    noise = noiseBuffer();
  }
  const burst = (t, dur, { type = "highpass", f = 2600, q = 0.7, gain = 0.4, f2 = null } = {}) => {
    const n = ac.createBufferSource(); n.buffer = noise;
    const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q; if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.02, dur / 3)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(fl).connect(g).connect(master); n.start(t, (t * 7.31) % 1.5, dur + 0.05);
  };
  const tone = (t, f, dur, { gain = 0.1, type = "sine", attack = 0.01, f2 = null } = {}) => {
    const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.05);
  };
  return {
    get on() { return on(); },
    // turn sound on: create the context if needed and resume it; true once audio is actually running
    async enable() { if (!ac) start(); if (!on()) { try { await ac.resume(); } catch {} if (on()) this.chime(); } return on(); },
    async disable() { if (on()) await ac.suspend(); return false; },
    async toggle() { return on() ? this.disable() : this.enable(); },
    // a short gold chime: sound is on
    chime() { if (!on()) return; const t = ac.currentTime; tone(t, 659.3, 0.9, { gain: 0.08 }); tone(t + 0.09, 987.8, 1.1, { gain: 0.06 }); tone(t + 0.18, 1318.5, 1.3, { gain: 0.035 }); },
    // a soft tick as a traffic pulse passes, at most a few a second
    tick() { if (!on() || ac.currentTime - lastTick < 0.14) return; lastTick = ac.currentTime; tone(ac.currentTime, 2200 + Math.random() * 400, 0.05, { gain: 0.018 }); },
    state() { return ac ? ac.state : "none"; },
    whoosh() { if (!on()) return; burst(ac.currentTime, 0.55, { type: "bandpass", f: 260, f2: 1900, q: 1.4, gain: 0.16 }); tone(ac.currentTime + 0.42, 92, 0.35, { gain: 0.12, f2: 60 }); },
    crackle() {
      if (!on()) return; const t = ac.currentTime;
      for (const [d, len, g] of [[0, 0.05, 0.45], [0.06, 0.02, 0.3], [0.1, 0.06, 0.4], [0.19, 0.02, 0.28], [0.26, 0.04, 0.22], [0.37, 0.02, 0.14]]) burst(t + d, len, { f: 2800, gain: g });
      tone(t, 1320, 0.5, { gain: 0.05 }); tone(t + 0.01, 1980, 0.35, { gain: 0.025 });
    },
    surge() {
      if (!on()) return; const t = ac.currentTime;
      tone(t, 48, 2.6, { gain: 0.32, attack: 0.25, f2: 96 }); burst(t, 1.4, { type: "bandpass", f: 400, f2: 5200, q: 0.9, gain: 0.22 });
      for (const [f, d] of [[440, 0.15], [554.4, 0.3], [659.3, 0.45], [880, 0.6]]) tone(t + d, f, 2.8, { gain: 0.045, attack: 0.4 });
    },
    alarm() { if (!on()) return; const t = ac.currentTime; for (let i = 0; i < 3; i++) { tone(t + i * 0.32, 660, 0.14, { gain: 0.07, type: "triangle" }); tone(t + i * 0.32 + 0.16, 440, 0.14, { gain: 0.07, type: "triangle" }); } burst(t, 0.5, { f: 3200, gain: 0.25 }); },
  };
})();
