// ═══════════════════════════════════════════════════════════════════════════
//  SOUND EFFECTS
// ═══════════════════════════════════════════════════════════════════════════

let _ac = null;
function au() {
  if (!_ac) _ac = new (window.AudioContext || window.webkitAudioContext)();
  return _ac;
}

function tone(f, d = 0.08, v = 0.1, t = "square") {
  try {
    const c = au();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = t;
    o.frequency.value = f;
    g.gain.setValueAtTime(v, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + d);
    o.connect(g).connect(c.destination);
    o.start();
    o.stop(c.currentTime + d);
  } catch (_) { /* ignore audio errors */ }
}

export const SFX = {
  raid: () => {
    tone(220, 0.3, 0.13, "sawtooth");
    setTimeout(() => tone(180, 0.3, 0.1, "sawtooth"), 150);
  },
  build: () => {
    tone(520, 0.1, 0.08);
    setTimeout(() => tone(660, 0.12, 0.08), 80);
  },
  death: () => tone(120, 0.25, 0.08, "triangle"),
  hit: () => tone(300 + Math.random() * 80, 0.04, 0.05),
  ability: () => {
    tone(440, 0.06, 0.1);
    setTimeout(() => tone(660, 0.08, 0.1), 50);
    setTimeout(() => tone(880, 0.1, 0.08), 100);
  },
  spawn: () => tone(480, 0.1, 0.06, "sine"),
  win: () => {
    [523, 659, 784, 1047].forEach((f, i) =>
      setTimeout(() => tone(f, 0.2, 0.12, "sine"), i * 120)
    );
  },
  lose: () => {
    [300, 250, 200, 150].forEach((f, i) =>
      setTimeout(() => tone(f, 0.3, 0.1, "sawtooth"), i * 200)
    );
  },
  heal: () => {
    try {
      const c = au();
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(400, c.currentTime);
      o.frequency.linearRampToValueAtTime(600, c.currentTime + 0.15);
      g.gain.setValueAtTime(0.06, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.15);
      o.connect(g).connect(c.destination);
      o.start();
      o.stop(c.currentTime + 0.15);
    } catch (_) {}
  },
  naval: () => tone(120, 0.3, 0.1, "sawtooth"),
  ageUp: () => {
    try {
      const c = au();
      [523, 659, 784].forEach((f, i) => {
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = "sine";
        o.frequency.setValueAtTime(f, c.currentTime);
        o.frequency.linearRampToValueAtTime(f * 1.1, c.currentTime + 0.5);
        g.gain.setValueAtTime(0.08, c.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.5);
        o.connect(g).connect(c.destination);
        o.start();
        o.stop(c.currentTime + 0.5);
      });
    } catch (_) {}
  },
  relic: () => {
    tone(880, 0.2, 0.08, "sine");
    setTimeout(() => tone(1100, 0.2, 0.06, "sine"), 60);
  },
};
