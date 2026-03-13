import { useState, useEffect, useRef, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════════════════
//  CONSTANTS & HELPERS
// ═══════════════════════════════════════════════════════════════════════════
const T = 14, MW = 64, MH = 44, TICK_MS = 100;
const FOG_UNK = 0, FOG_SEEN = 1, FOG_VIS = 2;
const VIS = 6, TVIS = 8;
const TERRAIN_GRASS = 0, TERRAIN_WATER = 1, TERRAIN_HILL = 2, TERRAIN_BRIDGE = 3;

let _uid = 1;
const D = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const cl = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const ri = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo;
const pk = a => a[ri(0, a.length - 1)];

// ═══════════════════════════════════════════════════════════════════════════
//  SOUND
// ═══════════════════════════════════════════════════════════════════════════
let _ac = null;
function au() { if (!_ac) _ac = new (window.AudioContext || window.webkitAudioContext)(); return _ac; }
function tone(f, d = 0.08, v = 0.1, t = "square") {
  try { const c = au(), o = c.createOscillator(), g = c.createGain(); o.type = t; o.frequency.value = f;
    g.gain.setValueAtTime(v, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + d);
    o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + d); } catch {}
}
const SFX = {
  raid: () => { tone(220, 0.3, 0.13, "sawtooth"); setTimeout(() => tone(180, 0.3, 0.1, "sawtooth"), 150); },
  build: () => { tone(520, 0.1, 0.08); setTimeout(() => tone(660, 0.12, 0.08), 80); },
  death: () => tone(120, 0.25, 0.08, "triangle"),
  hit: () => tone(300 + Math.random() * 80, 0.04, 0.05),
  ability: () => { tone(440, 0.06, 0.1); setTimeout(() => tone(660, 0.08, 0.1), 50); setTimeout(() => tone(880, 0.1, 0.08), 100); },
  spawn: () => tone(480, 0.1, 0.06, "sine"),
  win: () => { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.2, 0.12, "sine"), i * 120)); },
  lose: () => { [300, 250, 200, 150].forEach((f, i) => setTimeout(() => tone(f, 0.3, 0.1, "sawtooth"), i * 200)); },
};

// ═══════════════════════════════════════════════════════════════════════════
//  TERRAIN GENERATION
// ═══════════════════════════════════════════════════════════════════════════
function genTerrain() {
  const grid = Array.from({ length: MH }, () => new Uint8Array(MW));
  // River snaking across map
  let rx = ri(MW * 0.3, MW * 0.5);
  for (let y = 0; y < MH; y++) {
    rx += ri(-2, 2);
    rx = cl(rx, 4, MW - 5);
    for (let dx = -1; dx <= 1; dx++) {
      const wx = rx + dx;
      if (wx >= 0 && wx < MW) grid[y][wx] = TERRAIN_WATER;
    }
  }
  // Natural ford crossings (2-3)
  const fords = [ri(4, Math.floor(MH * 0.3)), ri(Math.floor(MH * 0.4), Math.floor(MH * 0.7)), ri(Math.floor(MH * 0.75), MH - 4)];
  for (const fy of fords) {
    for (let y = fy - 1; y <= fy + 1; y++)
      for (let x = 0; x < MW; x++)
        if (y >= 0 && y < MH && grid[y][x] === TERRAIN_WATER)
          grid[y][x] = TERRAIN_BRIDGE;
  }
  // Hill clusters
  for (let i = 0; i < 8; i++) {
    const cx = ri(4, MW - 5), cy = ri(4, MH - 5);
    for (let j = 0; j < ri(3, 8); j++) {
      const hx = cl(cx + ri(-2, 2), 0, MW - 1), hy = cl(cy + ri(-1, 1), 0, MH - 1);
      if (grid[hy][hx] === TERRAIN_GRASS) grid[hy][hx] = TERRAIN_HILL;
    }
  }
  // Clear areas around TCs
  const clearAround = (cx, cy, r) => {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && x < MW && y >= 0 && y < MH) grid[y][x] = TERRAIN_GRASS;
      }
  };
  clearAround(12, Math.floor(MH / 2), 4);
  clearAround(MW - 13, Math.floor(MH / 2), 4);
  return grid;
}

// ═══════════════════════════════════════════════════════════════════════════
//  A* PATHFINDING (terrain-aware)
// ═══════════════════════════════════════════════════════════════════════════
function buildGrid(gs) {
  const g = Array.from({ length: MH }, () => new Uint8Array(MW));
  // Water blocks
  for (let y = 0; y < MH; y++)
    for (let x = 0; x < MW; x++)
      if (gs.terrain[y][x] === TERRAIN_WATER) g[y][x] = 1;
  // Buildings block
  const markTC = (tc) => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const bx = tc.x + dx, by = tc.y + dy;
        if (bx >= 0 && bx < MW && by >= 0 && by < MH) g[by][bx] = 1;
      }
  };
  markTC(gs.tc);
  if (gs.etc) markTC(gs.etc);
  const markBuildings = (blds) => {
    for (const b of blds) {
      if (!b.built) continue;
      const sz = BLD[b.type]?.size || 1;
      for (let dy = 0; dy < sz; dy++)
        for (let dx = 0; dx < sz; dx++) {
          const bx = b.x + dx, by = b.y + dy;
          if (bx >= 0 && bx < MW && by >= 0 && by < MH) g[by][bx] = 1;
        }
    }
  };
  markBuildings(gs.bld);
  markBuildings(gs.ebld);
  return g;
}

function astar(sx, sy, ex, ey, grid, maxS = 180) {
  if (sx === ex && sy === ey) return null;
  ex = cl(ex, 0, MW - 1); ey = cl(ey, 0, MH - 1);
  sx = cl(sx, 0, MW - 1); sy = cl(sy, 0, MH - 1);
  const K = (x, y) => y * MW + x;
  const open = [{ x: sx, y: sy, g: 0, f: Math.abs(ex - sx) + Math.abs(ey - sy) }];
  const closed = new Set(), from = new Map(), gs = new Map();
  gs.set(K(sx, sy), 0);
  let steps = 0;
  while (open.length > 0 && steps++ < maxS) {
    open.sort((a, b) => a.f - b.f);
    const c = open.shift(), ck = K(c.x, c.y);
    if (c.x === ex && c.y === ey) {
      let px = ex, py = ey;
      while (from.has(K(px, py))) {
        const p = from.get(K(px, py));
        if (p.x === sx && p.y === sy) return { x: px, y: py };
        px = p.x; py = p.y;
      }
      return { x: px, y: py };
    }
    closed.add(ck);
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = c.x + dx, ny = c.y + dy;
      if (nx < 0 || nx >= MW || ny < 0 || ny >= MH) continue;
      const nk = K(nx, ny);
      if (closed.has(nk)) continue;
      if (grid[ny][nx] && !(nx === ex && ny === ey)) continue;
      const ng = c.g + 1;
      if (!gs.has(nk) || ng < gs.get(nk)) {
        gs.set(nk, ng); from.set(nk, { x: c.x, y: c.y });
        open.push({ x: nx, y: ny, g: ng, f: ng + Math.abs(ex - nx) + Math.abs(ey - ny) });
      }
    }
  }
  const dx = Math.sign(ex - sx), dy = Math.sign(ey - sy);
  if (dx !== 0 && !grid[sy]?.[sx + dx]) return { x: sx + dx, y: sy };
  if (dy !== 0 && !grid[sy + dy]?.[sx]) return { x: sx, y: sy + dy };
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  BUILDINGS
// ═══════════════════════════════════════════════════════════════════════════
const BLD = {
  house:    { cost: { wood: 30 }, pop: 4, size: 2, color: "#7B6545", hp: 100, bt: 25, icon: "🏠" },
  farm:     { cost: { wood: 20 }, size: 2, color: "#7B7B2A", hp: 60, bt: 20, gen: "food", rate: 0.18, icon: "🌾" },
  barracks: { cost: { wood: 50, stone: 20 }, size: 2, color: "#5B3216", hp: 150, bt: 35, icon: "⚔", unlocks: ["warrior_training"] },
  tower:    { cost: { stone: 40, gold: 10 }, size: 1, color: "#4a4a5e", hp: 200, bt: 40, range: 6, dmg: 4, icon: "🗼", requires: "tower" },
  workshop: { cost: { wood: 40, stone: 30 }, size: 2, color: "#5a4a3a", hp: 120, bt: 30, icon: "🔧", unlocks: ["tower"] },
  market:   { cost: { wood: 30, gold: 15 }, size: 2, color: "#6a5a2a", hp: 100, bt: 25, icon: "🏪", unlocks: ["trade"] },
  bridge:   { cost: { wood: 15, stone: 10 }, size: 1, color: "#8B7355", hp: 80, bt: 15, icon: "🌉" },
};

function getTech(blds) {
  const t = new Set();
  for (const b of blds) { if (!b.built) continue; const d = BLD[b.type]; if (d?.unlocks) d.unlocks.forEach(u => t.add(u)); }
  return t;
}

// ═══════════════════════════════════════════════════════════════════════════
//  SPECS
// ═══════════════════════════════════════════════════════════════════════════
const SP = {
  none:       { c: "#b8a080", l: "Villager",   i: "♟" },
  lumberjack: { c: "#4a8c3f", l: "Lumberjack", i: "🪓" },
  miner:      { c: "#7a7a8e", l: "Miner",      i: "⛏" },
  farmer:     { c: "#c4a035", l: "Farmer",      i: "🌾" },
  warrior:    { c: "#a83232", l: "Warrior",     i: "⚔" },
  builder:    { c: "#6a5a3a", l: "Builder",     i: "🔨" },
};

function calcSpec(v) {
  const { wood, stone, gold, food, combat, build } = v.xp;
  const e = [["lumberjack", wood], ["miner", stone + gold], ["farmer", food], ["warrior", combat], ["builder", build]];
  e.sort((a, b) => b[1] - a[1]);
  return e[0][1] >= 12 ? { s: e[0][0], lv: Math.min(5, Math.floor(e[0][1] / 18) + 1) } : { s: "none", lv: 0 };
}

function applySpec(v) {
  const { s, lv } = calcSpec(v);
  v.spec = s; v.specLv = lv;
  v.maxHp = 30 + (s === "warrior" ? lv * 10 : 0);
  v.dmg = 2 + (s === "warrior" ? lv * 2.5 : 0);
  v.maxCarry = 10 + (["lumberjack", "miner", "farmer"].includes(s) ? lv * 4 : 0);
  v.gSpd = 1 + (["lumberjack", "miner", "farmer"].includes(s) ? lv * 0.35 : 0);
  v.bSpd = 1 + (s === "builder" ? lv * 0.6 : 0);
  if (v.hp > v.maxHp) v.hp = v.maxHp;
}

function decayXP(v) {
  const { s } = calcSpec(v);
  const dom = { lumberjack: "wood", miner: "stone", farmer: "food", warrior: "combat", builder: "build" };
  for (const k of Object.keys(v.xp))
    if (k !== dom[s] && !(s === "miner" && k === "gold") && v.xp[k] > 0) v.xp[k] = Math.max(0, v.xp[k] - 0.05);
}

// ═══════════════════════════════════════════════════════════════════════════
//  ENEMY TYPES
// ═══════════════════════════════════════════════════════════════════════════
const ET = {
  scout:  { hp: 18, dmg: 2, spd: 2, c: "#c87040", ranged: false },
  brute:  { hp: 55, dmg: 6, spd: 0.5, c: "#8a3030", ranged: false },
  archer: { hp: 22, dmg: 3, spd: 1, c: "#a06050", ranged: true, range: 4 },
  raider: { hp: 30, dmg: 4, spd: 1, c: "#a04040", ranged: false },
};

// ═══════════════════════════════════════════════════════════════════════════
//  UNIT FACTORIES
// ═══════════════════════════════════════════════════════════════════════════
function mkVillager(x, y) {
  return {
    id: _uid++, x, y, hp: 30, maxHp: 30, carry: 0, carryType: null, maxCarry: 10,
    cmd: null, targetId: null, buildType: null, buildX: 0, buildY: 0, moveX: 0, moveY: 0, tag: null,
    xp: { wood: 0, stone: 0, gold: 0, food: 0, combat: 0, build: 0 },
    spec: "none", specLv: 0, gSpd: 1, bSpd: 1, dmg: 2, alive: true, atkCd: 0, abCd: 0,
  };
}

function mkEnemy(type, x, y) {
  const d = ET[type];
  return { id: _uid++, x, y, type, hp: d.hp, maxHp: d.hp, dmg: d.dmg, spd: d.spd, ranged: d.ranged || false, range: d.range || 1, alive: true, atkCd: 0, moveCd: 0 };
}

function spawnEdgeEnemy(type) {
  const sides = [{ x: ri(0, MW - 1), y: 0 }, { x: ri(0, MW - 1), y: MH - 1 }, { x: 0, y: ri(0, MH - 1) }, { x: MW - 1, y: ri(0, MH - 1) }];
  const p = pk(sides);
  return mkEnemy(type, p.x, p.y);
}

// ═══════════════════════════════════════════════════════════════════════════
//  MAP GENERATION
// ═══════════════════════════════════════════════════════════════════════════
function genResources(terrain) {
  const res = [];
  const pTcX = 12, pTcY = Math.floor(MH / 2);
  const eTcX = MW - 13, eTcY = Math.floor(MH / 2);
  const ok = (x, y) => terrain[y]?.[x] !== TERRAIN_WATER && D({ x, y }, { x: pTcX, y: pTcY }) > 4 && D({ x, y }, { x: eTcX, y: eTcY }) > 4;

  // Clustered regions
  const regions = [
    { type: "wood", cx: 8, cy: 10, n: 18 }, { type: "wood", cx: MW - 10, cy: MH - 10, n: 16 },
    { type: "wood", cx: 20, cy: MH - 8, n: 12 }, { type: "wood", cx: MW - 20, cy: 8, n: 12 },
    { type: "stone", cx: 18, cy: MH / 2, n: 10 }, { type: "stone", cx: MW - 18, cy: MH / 2, n: 8 },
    { type: "gold", cx: MW / 2 - 3, cy: 6, n: 6 }, { type: "gold", cx: MW / 2 + 3, cy: MH - 7, n: 6 },
    { type: "food", cx: 15, cy: pTcY - 5, n: 5 }, { type: "food", cx: 10, cy: pTcY + 5, n: 5 },
    { type: "food", cx: MW - 15, cy: eTcY - 5, n: 5 }, { type: "food", cx: MW - 10, cy: eTcY + 5, n: 5 },
  ];
  // Scattered
  for (let i = 0; i < 15; i++) regions.push({ type: "wood", cx: ri(3, MW - 4), cy: ri(3, MH - 4), n: ri(3, 7) });
  for (let i = 0; i < 4; i++) regions.push({ type: "stone", cx: ri(5, MW - 6), cy: ri(5, MH - 6), n: ri(2, 4) });

  const maxAmts = { wood: 250, stone: 350, gold: 500, food: 280 };
  const regrow = { wood: 0.02, stone: 0, gold: 0, food: 0.01 };

  for (const reg of regions) {
    for (let j = 0; j < reg.n; j++) {
      const rx = cl(reg.cx + ri(-3, 3), 1, MW - 2), ry = cl(reg.cy + ri(-2, 2), 1, MH - 2);
      if (ok(rx, ry))
        res.push({ id: _uid++, type: reg.type, x: rx, y: ry, amount: ri(80, maxAmts[reg.type]), maxAmt: maxAmts[reg.type], rg: regrow[reg.type] });
    }
  }
  return res;
}

// ═══════════════════════════════════════════════════════════════════════════
//  FOG OF WAR
// ═══════════════════════════════════════════════════════════════════════════
function mkFog() { return Array.from({ length: MH }, () => new Uint8Array(MW)); }

function updFog(fog, gs) {
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) if (fog[y][x] === FOG_VIS) fog[y][x] = FOG_SEEN;
  const reveal = (cx, cy, r) => {
    const r2 = r * r;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const fx = cx + dx, fy = cy + dy;
      if (fx >= 0 && fx < MW && fy >= 0 && fy < MH) fog[fy][fx] = FOG_VIS;
    }
  };
  for (const v of gs.vil) if (v.alive) {
    const hillBonus = gs.terrain[v.y]?.[v.x] === TERRAIN_HILL ? 2 : 0;
    reveal(v.x, v.y, VIS + hillBonus);
  }
  reveal(gs.tc.x, gs.tc.y, VIS + 1);
  for (const b of gs.bld) if (b.built) reveal(b.x, b.y, b.type === "tower" ? TVIS : 4);
}

// ═══════════════════════════════════════════════════════════════════════════
//  ENEMY AI TOWN
// ═══════════════════════════════════════════════════════════════════════════
function tickEnemyTown(s, grid) {
  // Passive resource gen (simplified)
  s.estk.wood += 0.5 + s.tick * 0.002;
  s.estk.stone += 0.2 + s.tick * 0.001;
  s.estk.food += 0.4 + s.tick * 0.001;
  s.estk.gold += 0.05;

  // Spawn enemy villagers
  const ePop = s.evil.filter(v => v.alive).length;
  const ePopCap = 4 + s.ebld.filter(b => b.type === "house" && b.built).length * 4;
  if (s.tick % 60 === 0 && ePop < ePopCap && s.estk.food >= 20) {
    s.estk.food -= 20;
    const ev = mkVillager(s.etc.x + ri(-1, 1), s.etc.y + ri(-1, 1));
    ev.enemy = true;
    s.evil.push(ev);
  }

  // Enemy auto-build
  if (s.tick % 80 === 0 && s.estk.wood >= 30) {
    const eHouses = s.ebld.filter(b => b.type === "house" && b.built).length;
    if (eHouses < 5 && ePop >= ePopCap - 1) {
      s.estk.wood -= 30;
      s.ebld.push({ id: _uid++, type: "house", x: s.etc.x + ri(-5, 5), y: s.etc.y + ri(-4, 4), hp: 100, maxHp: 100, built: true });
    } else if (s.ebld.filter(b => b.type === "farm" && b.built).length < 2 && s.estk.wood >= 20) {
      s.estk.wood -= 20;
      s.ebld.push({ id: _uid++, type: "farm", x: s.etc.x + ri(-4, 4), y: s.etc.y + ri(-3, 3), hp: 60, maxHp: 60, built: true });
    } else if (s.ebld.filter(b => b.type === "tower" && b.built).length < 2 && s.estk.stone >= 40 && s.estk.gold >= 10) {
      s.estk.stone -= 40; s.estk.gold -= 10;
      s.ebld.push({ id: _uid++, type: "tower", x: s.etc.x + pk([-5, 5, 0]), y: s.etc.y + pk([-5, 5, 0]), hp: 200, maxHp: 200, built: true });
    }
  }

  // Enemy farms generate food
  s.ebld.forEach(b => { if (b.type === "farm" && b.built) s.estk.food += 0.15; });

  // Enemy villager AI: gather nearby or idle
  for (const ev of s.evil) {
    if (!ev.alive || ev.raiding) continue;
    if (ev.carry >= 8) {
      if (D(ev, s.etc) <= 2) { ev.carry = 0; ev.carryType = null; }
      else { const n = astar(ev.x, ev.y, s.etc.x, s.etc.y, grid, 80); if (n) { ev.x = n.x; ev.y = n.y; } }
    } else {
      const nr = s.res.filter(r => r.amount > 0 && D(r, s.etc) < 18).sort((a, b) => D(a, ev) - D(b, ev))[0];
      if (nr) {
        if (D(ev, nr) <= 1) { const a = Math.min(2, nr.amount); nr.amount -= a; ev.carry += a; ev.carryType = nr.type; }
        else { const n = astar(ev.x, ev.y, nr.x, nr.y, grid, 80); if (n) { ev.x = n.x; ev.y = n.y; } }
      }
    }
  }

  // Send raids — escalating
  const raidInterval = Math.max(80, 260 - s.tick * 0.2);
  if (s.tick > 100 && s.tick % Math.floor(raidInterval) === 0) {
    const wave = Math.floor(s.tick / 200);
    const count = Math.min(8, 1 + wave + ri(0, 2));
    const pool = ["raider"]; if (wave >= 1) pool.push("scout", "scout"); if (wave >= 2) pool.push("archer"); if (wave >= 3) pool.push("brute");
    const spawned = [];
    for (let i = 0; i < count; i++) { const e = mkEnemy(pk(pool), s.etc.x + ri(-3, 3), s.etc.y + ri(-3, 3)); s.enemies.push(e); spawned.push(e); }
    s.log.push(`[${s.tick}] ⚠ Raid! ${count} enemies from enemy town`);
    SFX.raid();
  }

  // Enemy tower attacks
  for (const b of s.ebld) {
    if (b.type === "tower" && b.built && s.tick % 3 === 0) {
      const inR = s.vil.filter(v => v.alive && D(v, b) <= 6);
      if (inR.length > 0) { inR[0].hp -= 4; if (inR[0].hp <= 0) { inR[0].alive = false; s.log.push(`[${s.tick}] ☠ #${inR[0].id} killed by enemy tower`); SFX.death(); s.stats.deaths++; } }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  DEFAULT SCRIPT
// ═══════════════════════════════════════════════════════════════════════════
const DEFAULT_SCRIPT = `// ═══ VILLAGER AI SCRIPT ═══
// Edit update(api), hit Compile (or Ctrl+Enter).
//
// ── API ─────────────────────────────────────────
// api.villagers     [{id,x,y,hp,maxHp,spec,specLv,xp,
//                     carry,carryType,tag,abCd,...}]
// api.enemies       [{id,x,y,hp,type,ranged,range}]
//   types: scout(fast) brute(tank) archer(ranged) raider
// api.resources     [{id,type,x,y,amount}]
// api.stockpile     {wood,stone,gold,food}
// api.buildings     [{id,type,x,y,hp}]
// api.tc            {x,y,hp,maxHp} your town center
// api.enemyTc       {x,y,hp} enemy TC (if visible)
// api.tick, api.popCap, api.tech (Set)
// api.memory        {} persists across ticks
// api.terrain(x,y)  0=grass 1=water 2=hill 3=bridge
//
// ── Helpers ─────────────────────────────────────
// api.nearbyEnemies(unit, radius) → enemy[]
// api.nearbyAllies(unit, radius)  → villager[]
// api.pathDist(a, b)              → manhattan distance
// api.inFog(x, y)                 → bool
// rng(lo, hi), pick(arr), dist(a,b) also available
//
// ── Commands ────────────────────────────────────
// v.cmd = "gather"  + v.targetId
// v.cmd = "build"   + v.buildType + v.buildX, v.buildY
//   house, farm, barracks, tower*, workshop, market, bridge
// v.cmd = "attack"  + v.targetId
// v.cmd = "moveTo"  + v.moveX, v.moveY
// v.cmd = "ability" (spec L3+, 40-tick CD)
// v.cmd = "idle"
// v.tag = "string"  squad grouping
//
// ── Abilities (L3+) ────────────────────────────
// Warrior:AoE  Farmer:Plant  Builder:Repair
// Miner:Prospect  Lumberjack:Cleave
//
// ── WIN: Destroy enemy Town Center! ─────────────
// ── LOSE: Your Town Center is destroyed. ────────

function update(api) {
  const { villagers, enemies, resources, stockpile,
          tc, enemyTc, buildings, tick, memory, tech, popCap } = api;

  if (!memory.init) { memory.init = true; memory.phase = "eco"; }

  const threats = enemies.filter(e => api.pathDist(e, tc) < 14);
  const houses = buildings.filter(b => b.type === "house").length;
  const farms = buildings.filter(b => b.type === "farm").length;
  const hasWS = tech.has("tower");
  const towers = buildings.filter(b => b.type === "tower").length;

  // Phase control
  if (tick > 300 && villagers.length >= 8) memory.phase = "military";
  if (tick > 600 && villagers.length >= 10 && enemyTc) memory.phase = "attack";

  // Tag untagged
  for (const v of villagers) {
    if (!v.tag) {
      if (v.spec === "warrior") v.tag = "mil";
      else if (villagers.filter(u => u.tag === "bld").length < 1) v.tag = "bld";
      else v.tag = "eco";
    }
  }

  // Determine build task
  let bt = null;
  if (villagers.length >= popCap - 1 && stockpile.wood >= 30 && houses < 7)
    bt = { type: "house", x: tc.x + rng(-5,5), y: tc.y + rng(-5,5) };
  else if (farms < 3 && stockpile.wood >= 20 && stockpile.food < 80)
    bt = { type: "farm", x: tc.x + rng(-4,4), y: tc.y + rng(-4,4) };
  else if (!hasWS && stockpile.wood >= 40 && stockpile.stone >= 30)
    bt = { type: "workshop", x: tc.x + 5, y: tc.y + 3 };
  else if (hasWS && towers < 3 && stockpile.stone >= 40 && stockpile.gold >= 10) {
    const ofs = [[-6,-6],[6,-6],[0,7]][towers % 3];
    bt = { type: "tower", x: tc.x + ofs[0], y: tc.y + ofs[1] };
  }

  for (const v of villagers) {
    // ── DEFEND ──
    if (threats.length > 0) {
      const cl = threats.reduce((b, e) => {
        const d = api.pathDist(v, e);
        return d < b.d ? { e, d } : b;
      }, { e: null, d: 999 });
      if (v.tag === "mil" || v.spec === "warrior" || cl.d < 5) {
        if (v.spec === "warrior" && v.specLv >= 3 && v.abCd <= 0 && cl.d <= 2) v.cmd = "ability";
        else { v.cmd = "attack"; v.targetId = cl.e.id; }
        continue;
      }
    }

    // ── ATTACK PHASE ──
    if (memory.phase === "attack" && v.tag === "mil" && enemyTc) {
      // Find enemy near their TC or attack TC directly
      const nearE = enemies.filter(e => api.pathDist(e, enemyTc) < 8)
        .sort((a, b) => api.pathDist(a, v) - api.pathDist(b, v))[0];
      if (nearE && api.pathDist(v, nearE) < 12) {
        v.cmd = "attack"; v.targetId = nearE.id;
      } else {
        v.cmd = "moveTo"; v.moveX = enemyTc.x; v.moveY = enemyTc.y;
      }
      continue;
    }

    // ── BUILD ──
    if (v.tag === "bld" && bt) {
      v.cmd = "build"; v.buildType = bt.type; v.buildX = bt.x; v.buildY = bt.y;
      bt = null; continue;
    }
    if (v.tag === "bld" && v.spec === "builder" && v.specLv >= 3 && v.abCd <= 0) {
      const dmg = buildings.find(b => b.hp < (b.maxHp || 100));
      if (dmg) { v.cmd = "ability"; continue; }
    }

    // ── GATHER ──
    const gt = v.spec === "lumberjack" ? "wood"
      : v.spec === "miner" ? (stockpile.stone < stockpile.gold ? "stone" : "gold")
      : v.spec === "farmer" ? "food"
      : stockpile.wood < 60 ? "wood"
      : stockpile.food < 40 ? "food"
      : stockpile.stone < 40 ? "stone" : "gold";

    if (v.spec === "lumberjack" && v.specLv >= 3 && v.abCd <= 0 && v.carry < v.maxCarry) {
      const tree = resources.find(r => r.type === "wood" && r.amount > 20 && api.pathDist(v, r) <= 1);
      if (tree) { v.cmd = "ability"; continue; }
    }

    const tgt = resources.filter(r => r.type === gt && r.amount > 0)
      .sort((a, b) => api.pathDist(a, v) - api.pathDist(b, v))[0];
    if (tgt) { v.cmd = "gather"; v.targetId = tgt.id; }
    else v.cmd = "idle";
  }
}

function onRaid(enemies) {}
function onUnitDied(unit) {}
function onBuildComplete(building) {}`;

// ═══════════════════════════════════════════════════════════════════════════
//  GAME STATE
// ═══════════════════════════════════════════════════════════════════════════
function initGame() {
  const terrain = genTerrain();
  const res = genResources(terrain);
  const pX = 12, pY = Math.floor(MH / 2);
  const eX = MW - 13, eY = Math.floor(MH / 2);
  const vil = [];
  for (let i = 0; i < 4; i++) vil.push(mkVillager(pX + ri(-2, 2), pY + ri(-2, 2)));
  const evil = [];
  for (let i = 0; i < 3; i++) { const ev = mkVillager(eX + ri(-2, 2), eY + ri(-2, 2)); ev.enemy = true; evil.push(ev); }
  return {
    tick: 0, terrain, res, vil, evil, enemies: [], bld: [], ebld: [], bq: [],
    tc: { x: pX, y: pY, hp: 500, maxHp: 500 },
    etc: { x: eX, y: eY, hp: 500, maxHp: 500 },
    stk: { wood: 120, stone: 30, gold: 0, food: 100 },
    estk: { wood: 100, stone: 20, gold: 0, food: 80 },
    popCap: 4, fog: mkFog(),
    log: ["☀ Dawn. An enemy town lies across the river... Destroy their TC to win!"],
    mem: {}, particles: [],
    stats: { kills: 0, deaths: 0, gathered: { wood: 0, stone: 0, gold: 0, food: 0 }, built: 0, maxPop: 4, wavesEndured: 0, specLevels: {} },
    gameOver: false, won: false, paused: false,
    scriptMs: 0, stkDelta: { wood: 0, stone: 0, gold: 0, food: 0 },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  TICK
// ═══════════════════════════════════════════════════════════════════════════
function tickGame(gs, scriptFn, hooks) {
  if (gs.gameOver || gs.paused) return gs;
  const s = {
    ...gs, tick: gs.tick + 1,
    vil: gs.vil.map(v => ({ ...v, xp: { ...v.xp } })),
    evil: gs.evil.map(v => ({ ...v })),
    enemies: gs.enemies.map(e => ({ ...e })),
    res: gs.res.map(r => ({ ...r })),
    bld: gs.bld.map(b => ({ ...b })),
    ebld: gs.ebld.map(b => ({ ...b })),
    bq: gs.bq.map(q => ({ ...q })),
    stk: { ...gs.stk }, estk: { ...gs.estk },
    tc: { ...gs.tc }, etc: { ...gs.etc },
    log: [...gs.log], stats: { ...gs.stats, gathered: { ...gs.stats.gathered }, specLevels: { ...gs.stats.specLevels } },
    particles: gs.particles.filter(p => p.life > 0).map(p => ({ ...p, life: p.life - 1, y: p.y - 0.3, alpha: p.life / p.ml })),
    fog: gs.fog.map(r => new Uint8Array(r)), mem: gs.mem,
  };
  const prevStk = { ...gs.stk };
  const addP = (x, y, txt, c, life = 15) => s.particles.push({ x, y, txt, c, life, ml: life, alpha: 1 });

  // Pop cap, passives
  s.popCap = 4 + s.bld.filter(b => b.type === "house" && b.built).length * 4;
  s.bld.forEach(b => { if (b.type === "farm" && b.built) s.stk.food += BLD.farm.rate; if (b.type === "market" && b.built) s.stk.gold += 0.08; });

  // Food upkeep (economy sink)
  const pop = s.vil.filter(v => v.alive).length;
  s.stk.food -= pop * 0.04;
  if (s.stk.food < -20) {
    // Starvation: villagers lose HP
    for (const v of s.vil) if (v.alive) v.hp -= 1;
    if (s.tick % 30 === 0) s.log.push(`[${s.tick}] ⚠ Starvation! Villagers losing HP`);
  }

  // Building decay (every 100 ticks, each building loses 1 HP)
  if (s.tick % 100 === 0) {
    for (const b of s.bld) if (b.built && b.hp > 1) b.hp -= 1;
  }

  // Regrowth
  if (s.tick % 20 === 0) for (const r of s.res) if (r.rg > 0 && r.amount > 0 && r.amount < r.maxAmt) r.amount = Math.min(r.maxAmt, r.amount + r.rg * 20);

  // Spawn villager
  if (s.tick % 55 === 0 && s.stk.food >= 30 && pop < s.popCap) {
    s.stk.food -= 30;
    const nv = mkVillager(s.tc.x + ri(-1, 1), s.tc.y + ri(-1, 1));
    s.vil.push(nv);
    s.log.push(`[${s.tick}] 👤 Villager #${nv.id} born`);
    SFX.spawn();
  }
  s.stats.maxPop = Math.max(s.stats.maxPop, s.vil.filter(v => v.alive).length);

  // XP decay
  if (s.tick % 10 === 0) for (const v of s.vil) if (v.alive) decayXP(v);

  // Milestone announcements
  for (const v of s.vil) {
    if (!v.alive) continue;
    const { s: spec, lv } = calcSpec(v);
    const prevLv = s.stats.specLevels[v.id] || 0;
    if (lv > prevLv && lv >= 1) {
      s.log.push(`[${s.tick}] ⭐ #${v.id} reached ${SP[spec]?.l} L${lv}!`);
      s.stats.specLevels[v.id] = lv;
      if (lv === 3) addP(v.x, v.y, "✦ ABILITY", "#ffd700", 25);
    }
  }

  // Enemy town AI
  const grid = buildGrid(s);
  tickEnemyTown(s, grid);

  // Run user script
  const tech = getTech(s.bld);
  const fogR = s.fog;
  let scriptStart = performance.now();
  try {
    const etcVis = fogR[s.etc.y]?.[s.etc.x] === FOG_VIS ? { x: s.etc.x, y: s.etc.y, hp: s.etc.hp, maxHp: s.etc.maxHp } : null;
    const api = {
      villagers: s.vil.filter(v => v.alive),
      enemies: [...s.enemies.filter(e => e.alive && fogR[e.y]?.[e.x] === FOG_VIS), ...s.evil.filter(v => v.alive && fogR[v.y]?.[v.x] === FOG_VIS).map(v => ({ id: v.id, x: v.x, y: v.y, hp: v.hp, maxHp: v.maxHp, type: "villager", dmg: 2, ranged: false, range: 1 }))],
      resources: s.res.filter(r => r.amount > 0),
      stockpile: s.stk, buildings: s.bld.filter(b => b.built),
      tc: s.tc, enemyTc: etcVis,
      tick: s.tick, popCap: s.popCap, tech, memory: s.mem,
      nearbyEnemies: (u, r) => [...s.enemies, ...s.evil.filter(v => v.alive)].filter(e => e.alive !== false && D(e, u) <= r && fogR[e.y]?.[e.x] === FOG_VIS),
      nearbyAllies: (u, r) => s.vil.filter(v => v.alive && v.id !== u.id && D(v, u) <= r),
      pathDist: (a, b) => D(a, b),
      inFog: (x, y) => (fogR[y]?.[x] || 0) !== FOG_VIS,
      terrain: (x, y) => s.terrain[y]?.[x] ?? 0,
    };
    scriptFn(api);
  } catch (e) {
    if (!s.log.some(l => l.includes(e.message)) || s.tick % 15 === 0) s.log.push(`[${s.tick}] ❌ ${e.message}`);
  }
  s.scriptMs = performance.now() - scriptStart;

  // Process villager commands
  for (const v of s.vil) {
    if (!v.alive) continue;
    if (v.atkCd > 0) v.atkCd--;
    if (v.abCd > 0) v.abCd--;
    const mv = (tx, ty) => { const n = astar(v.x, v.y, tx, ty, grid, 150); if (n) { v.x = n.x; v.y = n.y; } };

    // ABILITY
    if (v.cmd === "ability" && v.specLv >= 3 && v.abCd <= 0) {
      v.abCd = 40; SFX.ability();
      if (v.spec === "warrior") {
        let h = 0;
        for (const e of [...s.enemies, ...s.evil]) { if (e.alive !== false && D(e, v) <= 2) { e.hp -= v.dmg * 1.5; h++; if (e.hp <= 0) { e.alive = false; v.xp.combat += 5; s.stats.kills++; } } }
        addP(v.x, v.y, `💥x${h}`, "#f44", 20); v.xp.combat += 3;
      } else if (v.spec === "farmer") {
        s.res.push({ id: _uid++, type: "food", x: v.x, y: v.y, amount: 60, maxAmt: 120, rg: 0.04 });
        addP(v.x, v.y, "🌱", "#4a4", 20); v.xp.food += 3;
      } else if (v.spec === "builder") {
        const dmgd = s.bld.filter(b => b.built && b.hp < (BLD[b.type]?.hp || 100)).sort((a, b) => D(a, v) - D(b, v))[0];
        if (dmgd) { dmgd.hp = Math.min(BLD[dmgd.type]?.hp || 100, dmgd.hp + 25); addP(dmgd.x, dmgd.y, "🔧+25", "#4a8", 20); }
        else if (s.tc.hp < s.tc.maxHp) { s.tc.hp = Math.min(s.tc.maxHp, s.tc.hp + 25); addP(s.tc.x, s.tc.y, "🔧+25", "#4a8", 20); }
        v.xp.build += 3;
      } else if (v.spec === "miner") {
        addP(v.x, v.y, "🔍", "#ca5", 20);
        for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) { const fx = v.x + dx, fy = v.y + dy; if (fx >= 0 && fx < MW && fy >= 0 && fy < MH) s.fog[fy][fx] = FOG_VIS; }
        v.xp.stone += 2; v.xp.gold += 2;
      } else if (v.spec === "lumberjack") {
        const tree = s.res.find(r => r.type === "wood" && r.amount > 0 && D(r, v) <= 1);
        if (tree) { const a = Math.min(Math.ceil(6 * v.gSpd), tree.amount); tree.amount -= a; v.carry += a; v.carryType = "wood"; addP(v.x, v.y, "🪓x3", "#4a8", 20); }
        v.xp.wood += 3;
      }
      applySpec(v); v.cmd = "idle"; continue;
    }

    // GATHER
    if (v.cmd === "gather" && v.targetId != null) {
      if (v.carry >= v.maxCarry) {
        if (D(v, s.tc) <= 2) {
          s.stk[v.carryType] = (s.stk[v.carryType] || 0) + v.carry;
          s.stats.gathered[v.carryType] = (s.stats.gathered[v.carryType] || 0) + v.carry;
          v.carry = 0; v.carryType = null;
        } else mv(s.tc.x, s.tc.y);
      } else {
        const r = s.res.find(r => r.id === v.targetId && r.amount > 0);
        if (r) {
          if (D(v, r) <= 1) { const a = Math.min(Math.ceil(2 * v.gSpd), r.amount, v.maxCarry - v.carry); r.amount -= a; v.carry += a; v.carryType = r.type; v.xp[r.type] = (v.xp[r.type] || 0) + 1; applySpec(v); }
          else mv(r.x, r.y);
        } else v.cmd = "idle";
      }
    }
    // ATTACK
    else if (v.cmd === "attack" && v.targetId != null) {
      const tgt = [...s.enemies, ...s.evil].find(e => e.id === v.targetId && e.alive !== false);
      if (tgt) {
        if (D(v, tgt) <= 1) {
          if (v.atkCd <= 0) {
            tgt.hp -= v.dmg; v.atkCd = 3; v.xp.combat += 2; SFX.hit(); applySpec(v);
            if (tgt.hp <= 0) { tgt.alive = false; v.xp.combat += 5; applySpec(v); addP(tgt.x, tgt.y, "☠", "#f44"); s.stats.kills++; }
          }
        } else mv(tgt.x, tgt.y);
      }
      // Also allow attacking enemy TC
      else if (D(v, s.etc) <= 2 && s.etc.hp > 0) {
        if (v.atkCd <= 0) { s.etc.hp -= v.dmg; v.atkCd = 3; v.xp.combat += 2; SFX.hit(); applySpec(v); addP(s.etc.x, s.etc.y, `-${Math.floor(v.dmg)}`, "#f88", 10); }
      }
    }
    // MOVE TO (also attacks enemy TC if adjacent)
    else if (v.cmd === "moveTo" && v.moveX != null) {
      if (D(v, s.etc) <= 2 && s.etc.hp > 0 && Math.abs(v.moveX - s.etc.x) <= 1 && Math.abs(v.moveY - s.etc.y) <= 1) {
        if (v.atkCd <= 0) { s.etc.hp -= v.dmg; v.atkCd = 3; v.xp.combat += 2; SFX.hit(); addP(s.etc.x, s.etc.y, `-${Math.floor(v.dmg)}`, "#f88", 10); }
      } else if (v.x !== v.moveX || v.y !== v.moveY) mv(v.moveX, v.moveY);
    }
    // BUILD
    else if (v.cmd === "build" && v.buildType) {
      const bd = BLD[v.buildType]; if (!bd) continue;
      if (bd.requires && !tech.has(bd.requires)) { v.cmd = "idle"; continue; }
      let bq = s.bq.find(q => q.bId === v.id && !q.done);
      if (!bq) {
        let ok = true; for (const [r, a] of Object.entries(bd.cost)) if ((s.stk[r] || 0) < a) ok = false;
        if (ok) {
          for (const [r, a] of Object.entries(bd.cost)) s.stk[r] -= a;
          const bx = cl(v.buildX || v.x + 2, 2, MW - 3), by = cl(v.buildY || v.y + 2, 2, MH - 3);
          bq = { bId: v.id, type: v.buildType, x: bx, y: by, prog: 0, need: bd.bt, done: false };
          s.bq.push(bq);
        } else { v.cmd = "idle"; continue; }
      }
      if (bq && !bq.done) {
        if (D(v, bq) <= 2) {
          bq.prog += v.bSpd; v.xp.build += 1; applySpec(v);
          if (bq.prog >= bq.need) {
            bq.done = true;
            const nb = { id: _uid++, type: bq.type, x: bq.x, y: bq.y, hp: bd.hp, maxHp: bd.hp, built: true };
            s.bld.push(nb); s.stats.built++;
            s.log.push(`[${s.tick}] ${bd.icon} ${bq.type} built`); SFX.build();
            if (bq.type === "bridge" && s.terrain[bq.y]?.[bq.x] === TERRAIN_WATER) s.terrain[bq.y][bq.x] = TERRAIN_BRIDGE;
            try { hooks?.onBuildComplete?.(nb); } catch {}
            v.cmd = "idle";
          }
        } else mv(bq.x, bq.y);
      }
    }
    // IDLE
    else {
      if (v.carry > 0) {
        if (D(v, s.tc) <= 2) { s.stk[v.carryType] += v.carry; s.stats.gathered[v.carryType] += v.carry; v.carry = 0; v.carryType = null; }
        else mv(s.tc.x, s.tc.y);
      }
    }
  }

  // Enemy unit AI
  for (const e of s.enemies) {
    if (!e.alive) continue;
    if (e.atkCd > 0) e.atkCd--;
    if (e.moveCd > 0) { e.moveCd--; continue; }
    const def = ET[e.type] || ET.raider;
    if (def.spd < 1) e.moveCd = Math.round(1 / def.spd) - 1;
    const nv = s.vil.filter(v => v.alive).sort((a, b) => D(a, e) - D(b, e))[0];
    const tgt = nv && D(nv, e) < 12 ? nv : s.tc;
    const d = D(e, tgt), ar = e.ranged ? e.range : 1;
    if (d <= ar) {
      if (e.atkCd <= 0) {
        tgt.hp -= e.dmg; e.atkCd = e.ranged ? 5 : 4; SFX.hit();
        if (tgt.hp <= 0 && tgt.alive !== undefined) {
          tgt.alive = false; s.log.push(`[${s.tick}] ☠ #${tgt.id} killed by ${e.type}`); SFX.death(); s.stats.deaths++;
          try { hooks?.onUnitDied?.(tgt); } catch {}
        }
      }
    } else {
      const n = astar(e.x, e.y, tgt.x, tgt.y, grid, 80); if (n) { e.x = n.x; e.y = n.y; }
      if (e.type === "scout") { const n2 = astar(e.x, e.y, tgt.x, tgt.y, grid, 40); if (n2) { e.x = n2.x; e.y = n2.y; } }
    }
  }

  // Player towers
  for (const b of s.bld) {
    if (b.type === "tower" && b.built && s.tick % 3 === 0) {
      const inR = [...s.enemies, ...s.evil].filter(e => e.alive !== false && D(e, b) <= BLD.tower.range);
      if (inR.length > 0) { inR[0].hp -= BLD.tower.dmg; addP(inR[0].x, inR[0].y, "⚡", "#8af", 8); if (inR[0].hp <= 0) { inR[0].alive = false; s.stats.kills++; } }
    }
  }

  // Win/lose check
  if (s.tc.hp <= 0) { s.gameOver = true; s.won = false; s.log.push(`[${s.tick}] 💀 Your Town Center destroyed!`); SFX.lose(); }
  if (s.etc.hp <= 0) { s.gameOver = true; s.won = true; s.log.push(`[${s.tick}] 🏆 Enemy Town Center destroyed! VICTORY!`); SFX.win(); }

  // Cleanup
  s.enemies = s.enemies.filter(e => e.alive);
  s.vil = s.vil.filter(v => v.alive);
  s.evil = s.evil.filter(v => v.alive);
  s.bq = s.bq.filter(q => !q.done);
  if (s.log.length > 100) s.log = s.log.slice(-70);

  // Stockpile delta
  s.stkDelta = { wood: s.stk.wood - prevStk.wood, stone: s.stk.stone - prevStk.stone, gold: s.stk.gold - prevStk.gold, food: s.stk.food - prevStk.food };

  updFog(s.fog, s);
  return s;
}

// ═══════════════════════════════════════════════════════════════════════════
//  RENDERER
// ═══════════════════════════════════════════════════════════════════════════
const RC = { wood: "#2d6a1e", stone: "#5a5a6a", gold: "#c9a825", food: "#7a2a4a" };
const RS = { wood: "#1a3a10", stone: "#33333a", gold: "#6a5515", food: "#3a1525" };
const TC = { [TERRAIN_GRASS]: "#222e1a", [TERRAIN_WATER]: "#1a2a3a", [TERRAIN_HILL]: "#2a3222", [TERRAIN_BRIDGE]: "#3a3020" };
const TCS = { [TERRAIN_GRASS]: "#161e12", [TERRAIN_WATER]: "#101a24", [TERRAIN_HILL]: "#1e2418", [TERRAIN_BRIDGE]: "#2a2418" };

function render(ctx, gs, cam, cw, ch, sel) {
  const w = cw || ctx.canvas.width, h = ch || ctx.canvas.height;
  ctx.fillStyle = "#0e120c"; ctx.fillRect(0, 0, w, h);
  const sx = px => px * T - cam.x, sy = py => py * T - cam.y;
  const fog = gs.fog, ter = gs.terrain;
  const txS = Math.max(0, Math.floor(cam.x / T)), tyS = Math.max(0, Math.floor(cam.y / T));
  const txE = Math.min(MW, Math.ceil((cam.x + w) / T) + 1), tyE = Math.min(MH, Math.ceil((cam.y + h) / T) + 1);

  // Terrain + fog
  for (let ty = tyS; ty < tyE; ty++) for (let tx = txS; tx < txE; tx++) {
    const fv = fog[ty]?.[tx] || 0, tt = ter[ty]?.[tx] || 0;
    ctx.fillStyle = fv === FOG_UNK ? "#080c06" : fv === FOG_SEEN ? (TCS[tt] || "#161e12") : (TC[tt] || "#222e1a");
    ctx.fillRect(tx * T - cam.x, ty * T - cam.y, T, T);
    // Water shimmer
    if (tt === TERRAIN_WATER && fv === FOG_VIS) {
      ctx.fillStyle = `rgba(40,80,140,${0.08 + 0.04 * Math.sin(gs.tick * 0.1 + tx * 0.5)})`;
      ctx.fillRect(tx * T - cam.x, ty * T - cam.y, T, T);
    }
    // Hill dots
    if (tt === TERRAIN_HILL && fv >= FOG_SEEN) {
      ctx.fillStyle = fv === FOG_VIS ? "rgba(100,120,80,0.3)" : "rgba(60,70,50,0.2)";
      ctx.fillRect(tx * T - cam.x + 3, ty * T - cam.y + 3, 2, 2);
      ctx.fillRect(tx * T - cam.x + 8, ty * T - cam.y + 7, 2, 2);
    }
  }

  // Resources
  for (const r of gs.res) {
    if (r.amount <= 0) continue; const fv = fog[r.y]?.[r.x] || 0; if (fv === FOG_UNK) continue;
    const x = sx(r.x), y = sy(r.y); if (x < -T || x > w + T || y < -T || y > h + T) continue;
    const a = fv === FOG_SEEN ? 0.3 : 0.4 + 0.6 * (r.amount / r.maxAmt);
    ctx.globalAlpha = a; ctx.fillStyle = fv === FOG_SEEN ? (RS[r.type] || "#333") : (RC[r.type] || "#555");
    if (r.type === "wood") { ctx.beginPath(); ctx.arc(x + T / 2, y + T * 0.35, T * 0.4, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = fv === FOG_SEEN ? "#2a1a0a" : "#5a3a1a"; ctx.fillRect(x + T / 2 - 1, y + T * 0.4, 2, T * 0.45); }
    else if (r.type === "food") { ctx.beginPath(); ctx.arc(x + T / 2, y + T / 2, T * 0.35, 0, Math.PI * 2); ctx.fill(); }
    else if (r.type === "gold") { ctx.fillRect(x + 3, y + 4, T - 6, T - 6); }
    else ctx.fillRect(x + 2, y + 3, T - 4, T - 5);
    ctx.globalAlpha = 1;
  }

  // Buildings (player + enemy)
  const drawBlds = (blds, alpha = 1) => {
    for (const b of blds) {
      const fv = fog[b.y]?.[b.x] || 0; if (fv === FOG_UNK) continue;
      const bd = BLD[b.type]; const x = sx(b.x), y = sy(b.y), sz = (bd?.size || 1) * T;
      ctx.globalAlpha = (fv === FOG_SEEN ? 0.4 : 1) * alpha;
      ctx.fillStyle = bd?.color || "#555"; ctx.fillRect(x, y, sz, sz);
      ctx.strokeStyle = "rgba(255,255,255,0.15)"; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, sz - 1, sz - 1);
      if (b.type === "tower" && fv === FOG_VIS) { ctx.strokeStyle = "rgba(130,170,255,0.1)"; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.arc(x + T / 2, y + T / 2, BLD.tower.range * T, 0, Math.PI * 2); ctx.stroke(); }
      if (b.hp < (bd?.hp || 100)) { ctx.globalAlpha = 1; ctx.fillStyle = "#222"; ctx.fillRect(x, y - 4, sz, 3); ctx.fillStyle = "#4a4"; ctx.fillRect(x, y - 4, sz * (b.hp / (bd?.hp || 100)), 3); }
      ctx.globalAlpha = 1;
    }
  };
  drawBlds(gs.bld);
  drawBlds(gs.ebld);

  // Build queue ghosts
  for (const bq of gs.bq) { if (bq.done) continue; const bd = BLD[bq.type]; const x = sx(bq.x), y = sy(bq.y), sz = (bd?.size || 1) * T; ctx.globalAlpha = 0.2 + 0.4 * (bq.prog / bq.need); ctx.fillStyle = bd?.color || "#555"; ctx.fillRect(x, y, sz, sz); ctx.globalAlpha = 1; ctx.fillStyle = "#555"; ctx.fillRect(x, y - 5, sz, 3); ctx.fillStyle = "#cc5"; ctx.fillRect(x, y - 5, sz * (bq.prog / bq.need), 3); }

  // Town Centers
  const drawTC = (tc, color, label) => {
    const fv = fog[tc.y]?.[tc.x] || 0; if (fv === FOG_UNK) return;
    const x = sx(tc.x - 1), y = sy(tc.y - 1), sz = T * 3;
    ctx.globalAlpha = fv === FOG_SEEN ? 0.5 : 1;
    ctx.fillStyle = color; ctx.fillRect(x, y, sz, sz);
    ctx.strokeStyle = label === "TC" ? "#c9a825" : "#c44"; ctx.lineWidth = 2; ctx.strokeRect(x, y, sz, sz);
    ctx.fillStyle = label === "TC" ? "#c9a825" : "#f66"; ctx.font = `bold ${Math.max(8, T - 4)}px monospace`; ctx.textAlign = "center"; ctx.fillText(label, x + sz / 2, y + sz / 2 + 3);
    const p = tc.hp / tc.maxHp; ctx.fillStyle = "#222"; ctx.fillRect(x, y - 5, sz, 3); ctx.fillStyle = p > 0.5 ? "#4a4" : p > 0.25 ? "#aa4" : "#a44"; ctx.fillRect(x, y - 5, sz * p, 3);
    ctx.globalAlpha = 1;
  };
  drawTC(gs.tc, "#5a4520", "TC");
  drawTC(gs.etc, "#4a2020", "EC");

  // Villagers (player)
  for (const v of gs.vil) {
    if (!v.alive) continue; const x = sx(v.x), y = sy(v.y);
    if (x < -T * 2 || x > w + T * 2 || y < -T * 2 || y > h + T * 2) continue;
    const sp = SP[v.spec] || SP.none;
    ctx.fillStyle = sp.c; ctx.beginPath(); ctx.arc(x + T / 2, y + T / 2, T * 0.38, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 1; ctx.stroke();
    if (v.specLv >= 3) { ctx.strokeStyle = sp.c + "80"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x + T / 2, y + T / 2, T * 0.52, 0, Math.PI * 2); ctx.stroke(); }
    if (v.specLv > 0) { ctx.fillStyle = "#ffd700"; for (let i = 0; i < v.specLv; i++) ctx.fillRect(x + 1 + i * 3, y - 3, 2, 2); }
    if (v.carry > 0) { ctx.fillStyle = RC[v.carryType] || "#aaa"; ctx.beginPath(); ctx.arc(x + T - 2, y + 2, 2.5, 0, Math.PI * 2); ctx.fill(); }
    if (v.hp < v.maxHp) { ctx.fillStyle = "#222"; ctx.fillRect(x, y - 5, T, 2); ctx.fillStyle = "#4a4"; ctx.fillRect(x, y - 5, T * (v.hp / v.maxHp), 2); }
  }

  // Enemy villagers (visible only)
  for (const ev of gs.evil) {
    if (!ev.alive) continue; const fv = fog[ev.y]?.[ev.x] || 0; if (fv !== FOG_VIS) continue;
    const x = sx(ev.x), y = sy(ev.y);
    ctx.fillStyle = "#a05050"; ctx.beginPath(); ctx.arc(x + T / 2, y + T / 2, T * 0.35, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#c66"; ctx.lineWidth = 1; ctx.stroke();
    if (ev.hp < ev.maxHp) { ctx.fillStyle = "#222"; ctx.fillRect(x, y - 5, T, 2); ctx.fillStyle = "#c44"; ctx.fillRect(x, y - 5, T * (ev.hp / ev.maxHp), 2); }
  }

  // Enemies
  for (const e of gs.enemies) {
    if (!e.alive) continue; const fv = fog[e.y]?.[e.x] || 0; if (fv !== FOG_VIS) continue;
    const x = sx(e.x), y = sy(e.y); if (x < -T * 2 || x > w + T * 2 || y < -T * 2 || y > h + T * 2) continue;
    const def = ET[e.type] || ET.raider; ctx.fillStyle = def.c;
    if (e.type === "brute") ctx.fillRect(x + 1, y + 1, T - 2, T - 2);
    else if (e.type === "scout") { ctx.beginPath(); ctx.moveTo(x + T / 2, y + 1); ctx.lineTo(x + T - 1, y + T - 1); ctx.lineTo(x + 1, y + T - 1); ctx.closePath(); ctx.fill(); }
    else if (e.type === "archer") { ctx.beginPath(); ctx.arc(x + T / 2, y + T / 2, T * 0.35, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = "#ff8060"; ctx.lineWidth = 1.5; ctx.stroke(); }
    else ctx.fillRect(x + 2, y + 2, T - 4, T - 4);
    if (e.hp < e.maxHp) { ctx.fillStyle = "#222"; ctx.fillRect(x, y - 4, T, 2); ctx.fillStyle = "#c43"; ctx.fillRect(x, y - 4, T * (e.hp / e.maxHp), 2); }
  }

  // Selection highlights
  if (sel) {
    const pulse = 0.6 + 0.4 * Math.sin(Date.now() * 0.006);
    ctx.lineWidth = 2;
    // Selected villager
    if (sel.unitId) {
      const v = gs.vil.find(u => u.id === sel.unitId && u.alive);
      if (v) {
        const x = sx(v.x) + T / 2, y = sy(v.y) + T / 2;
        ctx.strokeStyle = `rgba(201,168,37,${pulse})`;
        ctx.beginPath(); ctx.arc(x, y, T * 0.65, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = `rgba(201,168,37,${pulse * 0.3})`;
        ctx.beginPath(); ctx.arc(x, y, T * 0.85, 0, Math.PI * 2); ctx.stroke();
      }
    }
    // Selected building
    if (sel.bld) {
      const b = sel.bld;
      const isTC = b.type === "town_center";
      const sz = isTC ? 3 : (BLD[b.type]?.size || 1);
      const bx = isTC ? b.x - 1 : b.x;
      const by = isTC ? b.y - 1 : b.y;
      const x = sx(bx), y = sy(by), s = sz * T;
      const col = b.owner === "enemy" ? `rgba(255,80,80,${pulse})` : `rgba(201,168,37,${pulse})`;
      ctx.strokeStyle = col;
      ctx.strokeRect(x - 2, y - 2, s + 4, s + 4);
      ctx.strokeStyle = col.replace(String(pulse), String(pulse * 0.3));
      ctx.strokeRect(x - 4, y - 4, s + 8, s + 8);
    }
  }

  // Particles
  for (const p of gs.particles) { if (p.life <= 0) continue; ctx.globalAlpha = p.alpha; ctx.fillStyle = p.c; ctx.font = "bold 9px monospace"; ctx.textAlign = "center"; ctx.fillText(p.txt, sx(p.x) + T / 2, sy(p.y)); ctx.globalAlpha = 1; }
}

function renderMini(ctx, gs, cam, cw, ch) {
  const mw = ctx.canvas.width, mh = ctx.canvas.height;
  ctx.fillStyle = "#080c06"; ctx.fillRect(0, 0, mw, mh);
  const mx = mw / MW, my = mh / MH;
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const fv = gs.fog[y]?.[x] || 0, tt = gs.terrain[y]?.[x] || 0;
    if (fv >= FOG_SEEN) { ctx.fillStyle = tt === TERRAIN_WATER ? (fv === FOG_VIS ? "#1a2a3a" : "#0e1820") : fv === FOG_VIS ? "#1a2816" : "#10160e"; ctx.fillRect(x * mx, y * my, mx + 0.5, my + 0.5); }
  }
  ctx.globalAlpha = 0.5;
  for (const r of gs.res) { if (r.amount <= 0 || (gs.fog[r.y]?.[r.x] || 0) === FOG_UNK) continue; ctx.fillStyle = RC[r.type] || "#555"; ctx.fillRect(r.x * mx, r.y * my, Math.max(1, mx), Math.max(1, my)); }
  ctx.globalAlpha = 1;
  for (const b of [...gs.bld, ...gs.ebld]) { const fv = gs.fog[b.y]?.[b.x] || 0; if (fv === FOG_UNK) continue; ctx.fillStyle = BLD[b.type]?.color || "#555"; ctx.fillRect(b.x * mx, b.y * my, (BLD[b.type]?.size || 1) * mx, (BLD[b.type]?.size || 1) * my); }
  ctx.fillStyle = "#c9a825"; ctx.fillRect((gs.tc.x - 1) * mx, (gs.tc.y - 1) * my, 3 * mx, 3 * my);
  if ((gs.fog[gs.etc.y]?.[gs.etc.x] || 0) >= FOG_SEEN) { ctx.fillStyle = "#c44"; ctx.fillRect((gs.etc.x - 1) * mx, (gs.etc.y - 1) * my, 3 * mx, 3 * my); }
  ctx.fillStyle = "#8f8"; for (const v of gs.vil) if (v.alive) ctx.fillRect(v.x * mx - 0.5, v.y * my - 0.5, 2, 2);
  ctx.fillStyle = "#f44"; for (const e of gs.enemies) if (e.alive && (gs.fog[e.y]?.[e.x] || 0) === FOG_VIS) ctx.fillRect(e.x * mx - 0.5, e.y * my - 0.5, 2, 2);
  // Threat direction indicators
  for (const e of gs.enemies) {
    if (!e.alive) continue;
    const ex = e.x * mx, ey = e.y * my;
    if (ex < 0 || ex > mw || ey < 0 || ey > mh) continue;
    if (D(e, gs.tc) < 18) { ctx.fillStyle = "rgba(255,60,60,0.5)"; ctx.beginPath(); ctx.arc(ex, ey, 3, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 1;
  ctx.strokeRect(cam.x / T * mx, cam.y / T * my, cw / T * mx, ch / T * my);
}

// ═══════════════════════════════════════════════════════════════════════════
//  COMPONENT (Responsive: Desktop + Mobile)
// ═══════════════════════════════════════════════════════════════════════════
function useWindowSize() {
  const [sz, setSz] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const fn = () => setSz({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return sz;
}

const B = { background: "#2a2e22", color: "#a8a890", border: "1px solid #3a4030", borderRadius: 3, cursor: "pointer", fontFamily: "'Courier New',monospace", whiteSpace: "nowrap" };

export default function RTSGame() {
  const wSz = useWindowSize();
  const mob = wSz.w < 768;

  const cvRef = useRef(null), mnRef = useRef(null), gRef = useRef(initGame());
  const afRef = useRef(null), tiRef = useRef(null), camRef = useRef({ x: 0, y: 0 });
  const [script, setScript] = useState(DEFAULT_SCRIPT);
  const [cFn, setCFn] = useState(null);
  const [hooks, setHooks] = useState({});
  const [sErr, setSErr] = useState(null);
  const [mTab, setMTab] = useState("map"); // mobile: map | script | log | watch
  const [showS, setShowS] = useState(true);
  const [showLog, setShowLog] = useState(false);
  const [showWatch, setShowWatch] = useState(false);
  const [spd, setSpd] = useState(1);
  const [selUnit, setSelUnit] = useState(null);
  const [selBld, setSelBld] = useState(null);
  const [showCiv, setShowCiv] = useState(false);
  const selUnitRef = useRef(null);
  const selBldRef = useRef(null);
  useEffect(() => { selUnitRef.current = selUnit; }, [selUnit]);
  useEffect(() => { selBldRef.current = selBld; }, [selBld]);
  const [ui, setUi] = useState({ tick: 0, stk: { wood: 120, stone: 30, gold: 0, food: 100 }, pop: 4, popCap: 4, vil: [], bld: [], ebld: [], log: [], gameOver: false, won: false, paused: false, tcHp: 500, tcMax: 500, etcHp: 500, etcMax: 500, tech: [], stats: {}, scriptMs: 0, stkDelta: {}, mem: {} });

  const helpers = `var rng=function(lo,hi){return Math.floor(Math.random()*(hi-lo+1))+lo;};var pick=function(arr){return arr[rng(0,arr.length-1)];};var dist=function(a,b){return Math.abs(a.x-b.x)+Math.abs(a.y-b.y);};\n`;

  const compile = useCallback((src) => {
    try {
      const fn = new Function("api", helpers + src + `\nif(typeof update==='function')update(api);`);
      const hFn = new Function(helpers + src + `\nreturn{onRaid:typeof onRaid==='function'?onRaid:null,onUnitDied:typeof onUnitDied==='function'?onUnitDied:null,onBuildComplete:typeof onBuildComplete==='function'?onBuildComplete:null};`);
      setCFn(() => fn); try { setHooks(hFn()); } catch { setHooks({}); } setSErr(null);
    } catch (e) { setSErr(e.message); }
  }, []);

  useEffect(() => { compile(script); }, []);

  // Center camera with proper canvas size
  const centerCam = useCallback(() => {
    const c = cvRef.current; if (!c) return;
    const gs = gRef.current;
    const rect = c.getBoundingClientRect();
    const cw = rect.width || c.width;
    const ch = rect.height || c.height;
    camRef.current = { x: gs.tc.x * T - cw / 2, y: gs.tc.y * T - ch / 2 };
  }, []);
  useEffect(() => { setTimeout(centerCam, 100); }, [centerCam]);

  // Resize canvas to match container
  useEffect(() => {
    const c = cvRef.current; if (!c) return;
    const parent = c.parentElement; if (!parent) return;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = parent.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      c.width = Math.floor(rect.width * dpr);
      c.height = Math.floor(rect.height * dpr);
      c.style.width = rect.width + "px";
      c.style.height = rect.height + "px";
      // DPR scaling is handled in draw loop via setTransform
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [mob, mTab]);

  const stepOnce = useCallback(() => {
    const fn = cFn || (() => {});
    gRef.current.paused = false;
    gRef.current = tickGame(gRef.current, fn, hooks);
    gRef.current.paused = true;
    updateUI();
  }, [cFn, hooks]);

  const updateUI = useCallback(() => {
    const gs = gRef.current;
    setUi({
      tick: gs.tick, stk: gs.stk, pop: gs.vil.filter(v => v.alive).length, popCap: gs.popCap,
      vil: gs.vil.filter(v => v.alive).map(v => ({ id: v.id, spec: v.spec, specLv: v.specLv, hp: v.hp, maxHp: v.maxHp, cmd: v.cmd, carry: v.carry, carryType: v.carryType, tag: v.tag, abCd: v.abCd, xp: { ...v.xp } })),
      bld: gs.bld.filter(b => b.built).map(b => ({ id: b.id, type: b.type, x: b.x, y: b.y, hp: b.hp, maxHp: b.maxHp || BLD[b.type]?.hp || 100 })),
      ebld: gs.ebld.filter(b => b.built).map(b => ({ id: b.id, type: b.type, x: b.x, y: b.y, hp: b.hp, maxHp: b.maxHp || BLD[b.type]?.hp || 100 })),
      log: gs.log.slice(-25), gameOver: gs.gameOver, won: gs.won, paused: gs.paused,
      tcHp: gs.tc.hp, tcMax: gs.tc.maxHp, etcHp: gs.etc.hp, etcMax: gs.etc.maxHp,
      tech: [...getTech(gs.bld)], stats: gs.stats, scriptMs: gs.scriptMs, stkDelta: gs.stkDelta, mem: gs.mem,
    });
  }, []);

  useEffect(() => {
    const c = cvRef.current, mc = mnRef.current; if (!c) return;
    const ctx = c.getContext("2d"), mctx = mc?.getContext("2d");
    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = c.width / dpr, ch = c.height / dpr;
      ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      render(ctx, gRef.current, camRef.current, cw, ch, { unitId: selUnitRef.current, bld: selBldRef.current });
      ctx.restore();
      if (mctx) renderMini(mctx, gRef.current, camRef.current, cw, ch);
      afRef.current = requestAnimationFrame(draw);
    };
    afRef.current = requestAnimationFrame(draw);
    const tick = () => { const fn = cFn || (() => {}); gRef.current = tickGame(gRef.current, fn, hooks); updateUI(); };
    tiRef.current = setInterval(tick, TICK_MS / spd);
    return () => { cancelAnimationFrame(afRef.current); clearInterval(tiRef.current); };
  }, [cFn, spd, hooks, updateUI]);

  // Hotkeys (desktop)
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === "TEXTAREA") {
        if (e.ctrlKey && e.key === "Enter") { e.preventDefault(); compile(script); }
        return;
      }
      if (e.code === "Space") { e.preventDefault(); gRef.current.paused = !gRef.current.paused; setUi(p => ({ ...p, paused: gRef.current.paused })); }
      else if (e.key === "]") setSpd(s => s === 1 ? 2 : s === 2 ? 4 : 1);
      else if (e.key === "[") setSpd(s => s === 4 ? 2 : s === 2 ? 1 : 4);
      else if (e.key === "n" || e.key === "N") { if (gRef.current.paused) stepOnce(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [script, compile, stepOnce]);

  // Prevent pull-to-refresh and overscroll at document level
  useEffect(() => {
    const s = document.documentElement.style;
    const bs = document.body.style;
    s.overscrollBehavior = "none";
    bs.overscrollBehavior = "none";
    s.overflow = "hidden";
    bs.overflow = "hidden";
    bs.position = "fixed";
    bs.width = "100%";
    bs.height = "100%";
    return () => { s.overscrollBehavior = ""; bs.overscrollBehavior = ""; s.overflow = ""; bs.overflow = ""; bs.position = ""; bs.width = ""; bs.height = ""; };
  }, []);

  // Mouse drag (desktop) + tap-to-select
  const dRef = useRef(null);
  const TAP_DIST = 8, TAP_TIME = 300;

  const screenToTile = (clientX, clientY) => {
    const c = cvRef.current; if (!c) return null;
    const rect = c.getBoundingClientRect();
    const tx = Math.floor((clientX - rect.left + camRef.current.x) / T);
    const ty = Math.floor((clientY - rect.top + camRef.current.y) / T);
    return { x: tx, y: ty };
  };

  const selectAtTile = (tx, ty) => {
    const gs = gRef.current;
    // Check player villagers first (within 1.5 tiles)
    let bestV = null, bestVD = 3;
    for (const v of gs.vil) {
      if (!v.alive) continue;
      const d = Math.abs(v.x - tx) + Math.abs(v.y - ty);
      if (d < bestVD) { bestV = v.id; bestVD = d; }
    }
    if (bestV !== null) { setSelUnit(bestV); setSelBld(null); return; }

    // Check player buildings
    for (const b of gs.bld) {
      if (!b.built) continue;
      const sz = BLD[b.type]?.size || 1;
      if (tx >= b.x && tx < b.x + sz && ty >= b.y && ty < b.y + sz) {
        setSelBld({ ...b, owner: "player" }); setSelUnit(null); return;
      }
    }
    // Check enemy buildings (if visible)
    for (const b of gs.ebld) {
      if (!b.built) continue;
      const fv = gs.fog[b.y]?.[b.x] || 0;
      if (fv !== FOG_VIS) continue;
      const sz = BLD[b.type]?.size || 1;
      if (tx >= b.x && tx < b.x + sz && ty >= b.y && ty < b.y + sz) {
        setSelBld({ ...b, owner: "enemy" }); setSelUnit(null); return;
      }
    }
    // Check TCs
    if (Math.abs(tx - gs.tc.x) <= 1 && Math.abs(ty - gs.tc.y) <= 1) {
      setSelBld({ id: "tc", type: "town_center", x: gs.tc.x, y: gs.tc.y, hp: gs.tc.hp, maxHp: gs.tc.maxHp, owner: "player" }); setSelUnit(null); return;
    }
    if (Math.abs(tx - gs.etc.x) <= 1 && Math.abs(ty - gs.etc.y) <= 1 && (gs.fog[gs.etc.y]?.[gs.etc.x] || 0) === FOG_VIS) {
      setSelBld({ id: "etc", type: "town_center", x: gs.etc.x, y: gs.etc.y, hp: gs.etc.hp, maxHp: gs.etc.maxHp, owner: "enemy" }); setSelUnit(null); return;
    }
    setSelUnit(null); setSelBld(null);
  };

  const onMD = e => {
    dRef.current = { sx: e.clientX, sy: e.clientY, cx: camRef.current.x, cy: camRef.current.y, t: Date.now() };
  };
  const onMM = e => {
    if (dRef.current) {
      camRef.current.x = dRef.current.cx - (e.clientX - dRef.current.sx);
      camRef.current.y = dRef.current.cy - (e.clientY - dRef.current.sy);
    }
  };
  const onMU = e => {
    if (dRef.current) {
      const dx = Math.abs(e.clientX - dRef.current.sx);
      const dy = Math.abs(e.clientY - dRef.current.sy);
      const dt = Date.now() - dRef.current.t;
      if (dx < TAP_DIST && dy < TAP_DIST && dt < TAP_TIME) {
        const tile = screenToTile(e.clientX, e.clientY);
        if (tile) selectAtTile(tile.x, tile.y);
      }
    }
    dRef.current = null;
  };

  // Touch: native listeners to bypass passive default, plus tap-to-select
  const touchRef = useRef(null);
  const mapContainerRef = useRef(null);

  useEffect(() => {
    const el = mapContainerRef.current;
    if (!el) return;

    const handleTouchStart = (e) => {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        touchRef.current = { sx: t.clientX, sy: t.clientY, cx: camRef.current.x, cy: camRef.current.y, t: Date.now() };
      }
    };
    const handleTouchMove = (e) => {
      e.preventDefault(); // Actually works because { passive: false }
      if (touchRef.current && e.touches.length === 1) {
        const t = e.touches[0];
        camRef.current.x = touchRef.current.cx - (t.clientX - touchRef.current.sx);
        camRef.current.y = touchRef.current.cy - (t.clientY - touchRef.current.sy);
      }
    };
    const handleTouchEnd = (e) => {
      if (touchRef.current && e.changedTouches.length === 1) {
        const t = e.changedTouches[0];
        const dx = Math.abs(t.clientX - touchRef.current.sx);
        const dy = Math.abs(t.clientY - touchRef.current.sy);
        const dt = Date.now() - touchRef.current.t;
        if (dx < TAP_DIST && dy < TAP_DIST && dt < TAP_TIME) {
          const tile = screenToTile(t.clientX, t.clientY);
          if (tile) selectAtTile(tile.x, tile.y);
        }
      }
      touchRef.current = null;
    };

    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: false });
    el.addEventListener("touchend", handleTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
    };
  }, [mTab, mob]);

  const onMiniClick = e => {
    e.stopPropagation();
    const mc = mnRef.current; if (!mc) return;
    const r = mc.getBoundingClientRect();
    const cx = (e.clientX || e.changedTouches?.[0]?.clientX || 0);
    const cy = (e.clientY || e.changedTouches?.[0]?.clientY || 0);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = cvRef.current ? cvRef.current.width / dpr : 400;
    const ch = cvRef.current ? cvRef.current.height / dpr : 300;
    camRef.current.x = (cx - r.left) / r.width * MW * T - cw / 2;
    camRef.current.y = (cy - r.top) / r.height * MH * T - ch / 2;
  };

  const restart = () => {
    _uid = 1; gRef.current = initGame(); setSelUnit(null);
    setTimeout(centerCam, 50);
  };
  const togglePause = () => { gRef.current.paused = !gRef.current.paused; setUi(p => ({ ...p, paused: gRef.current.paused })); };

  const xpK = ["wood", "stone", "gold", "food", "combat", "build"];
  const xpC = { wood: "#4a8c3f", stone: "#7a7a8e", gold: "#c9a825", food: "#c4a035", combat: "#a83232", build: "#6a5a3a" };
  const fmtD = v => v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1);

  // Shared button style adjusted for mobile
  const btn = { ...B, padding: mob ? "6px 10px" : "3px 8px", fontSize: mob ? 13 : 11, minHeight: mob ? 36 : "auto" };

  const logColor = l => l.includes("⚠") ? "#e84" : l.includes("☠") ? "#c44" : l.includes("💀") ? "#f44" : l.includes("built") ? "#4a8" : l.includes("👤") ? "#8a8" : l.includes("❌") ? "#f88" : l.includes("⭐") ? "#ffd700" : l.includes("🏆") ? "#c9a825" : "#777";


  // Inline JSX fragments (NOT components — avoids remounting on re-render)
  const resBar = (
    <div style={{ display: "flex", alignItems: "center", gap: mob ? 4 : 5, flexWrap: "wrap", fontSize: 11 }}>
      <span>🪵<b style={{ color: "#4a8" }}>{Math.floor(ui.stk.wood)}</b></span>
      <span>🪨<b style={{ color: "#88a" }}>{Math.floor(ui.stk.stone)}</b></span>
      <span>🪙<b style={{ color: "#ca5" }}>{Math.floor(ui.stk.gold)}</b></span>
      <span>🍖<b style={{ color: ui.stk.food < 10 ? "#f44" : "#a68" }}>{Math.floor(ui.stk.food)}</b></span>
      {!mob && <span style={{ color: "#333" }}>│</span>}
      <span>👥{ui.pop}/{ui.popCap}</span>
      <span style={{ color: "#c9a825" }}>🏰{ui.tcHp}</span>
      <span style={{ color: "#c44" }}>💀{ui.etcHp}</span>
    </div>
  );

  const gameOverOverlay = ui.gameOver ? (
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.85)", zIndex: 100, padding: 20 }}>
      <div style={{ textAlign: "center", maxWidth: 340, width: "100%" }}>
        <div style={{ fontSize: mob ? 24 : 28, color: ui.won ? "#c9a825" : "#c43", fontWeight: "bold", letterSpacing: 3 }}>{ui.won ? "🏆 VICTORY" : "💀 DEFEAT"}</div>
        <div style={{ color: "#aaa", margin: "8px 0", fontSize: 12 }}>Survived {ui.tick} ticks</div>
        <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 4, padding: 10, margin: "10px 0", fontSize: mob ? 11 : 10, textAlign: "left", lineHeight: 1.6 }}>
          <div>⚔ Kills: <b style={{ color: "#c9a825" }}>{ui.stats.kills}</b> │ ☠ Deaths: <b style={{ color: "#c44" }}>{ui.stats.deaths}</b></div>
          <div>🏠 Built: <b>{ui.stats.built}</b> │ 👥 Max: <b>{ui.stats.maxPop}</b></div>
          <div>🪵{Math.floor(ui.stats.gathered?.wood || 0)} 🪨{Math.floor(ui.stats.gathered?.stone || 0)} 🪙{Math.floor(ui.stats.gathered?.gold || 0)} 🍖{Math.floor(ui.stats.gathered?.food || 0)}</div>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
          <button onClick={restart} style={{ ...btn, fontSize: 14, padding: "8px 20px" }}>🔄 Play Again</button>
          <button onClick={() => navigator.clipboard?.writeText(script)} style={{ ...btn, fontSize: 14, padding: "8px 20px" }}>📋 Copy Script</button>
        </div>
      </div>
    </div>
  ) : null;

  const selV = selUnit ? ui.vil.find(u => u.id === selUnit) : null;
  const selSp = selV ? (SP[selV.spec] || SP.none) : null;

  const unitDetail = selV && selSp ? (
    <div onClick={() => setSelUnit(null)} style={{ position: "absolute", top: mob ? 4 : 8, left: mob ? 4 : 8, background: "rgba(0,0,0,0.92)", border: "1px solid #3a4030", borderRadius: 4, padding: 8, width: mob ? "calc(100% - 24px)" : 210, maxWidth: 280, fontSize: mob ? 11 : 10, pointerEvents: "auto", zIndex: 5 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ color: selSp.c, fontWeight: "bold" }}>{selSp.i} {selSp.l} #{selV.id}</span>
        <span style={{ color: "#888" }}>L{selV.specLv} {mob ? "✕" : ""}</span>
      </div>
      <div style={{ color: "#888", marginBottom: 4, lineHeight: 1.4 }}>HP:{selV.hp}/{selV.maxHp} Cmd:{selV.cmd || "idle"} Tag:{selV.tag || "—"}{selV.carry > 0 && ` 📦${selV.carry}${selV.carryType}`}{selV.abCd > 0 && ` CD:${selV.abCd}`}</div>
      {xpK.map(k => (
        <div key={k} style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
          <span style={{ width: 40, color: xpC[k], fontSize: mob ? 10 : 9 }}>{k}</span>
          <div style={{ flex: 1, background: "#1a1a1a", height: mob ? 7 : 5, borderRadius: 2, overflow: "hidden" }}>
            <div style={{ width: `${Math.min(100, (selV.xp[k] / 90) * 100)}%`, height: "100%", background: xpC[k], borderRadius: 2 }} />
          </div>
          <span style={{ color: "#555", fontSize: mob ? 9 : 8, width: 24, textAlign: "right" }}>{selV.xp[k].toFixed(0)}</span>
        </div>
      ))}
      {selV.specLv >= 3 && <div style={{ marginTop: 4, color: "#c9a825", fontSize: mob ? 10 : 9 }}>✦ {selV.spec === "warrior" ? "AoE" : selV.spec === "farmer" ? "Plant" : selV.spec === "builder" ? "Repair" : selV.spec === "miner" ? "Prospect" : "Cleave"} {selV.abCd > 0 ? `CD:${selV.abCd}` : "READY"}</div>}
    </div>
  ) : null;

  // Building detail panel
  const bldInfo = selBld ? (() => {
    const bd = BLD[selBld.type];
    const isTC = selBld.type === "town_center";
    const label = isTC ? "Town Center" : selBld.type;
    const icon = isTC ? "🏰" : (bd?.icon || "🏠");
    // Live HP lookup
    let liveHp = selBld.hp;
    if (isTC && selBld.owner === "player") liveHp = ui.tcHp;
    else if (isTC && selBld.owner === "enemy") liveHp = ui.etcHp;
    else {
      const src = selBld.owner === "enemy" ? ui.ebld : ui.bld;
      const live = src.find(b => b.id === selBld.id);
      if (live) liveHp = live.hp;
    }
    const hpMax = selBld.maxHp || (bd?.hp || 100);
    const hpPct = Math.max(0, liveHp / hpMax);
    return (
      <div onClick={() => setSelBld(null)} style={{ position: "absolute", top: mob ? 4 : 8, left: mob ? 4 : 8, background: "rgba(0,0,0,0.92)", border: `1px solid ${selBld.owner === "enemy" ? "#5a2020" : "#3a4030"}`, borderRadius: 4, padding: 8, width: mob ? "calc(100% - 24px)" : 210, maxWidth: 280, fontSize: mob ? 11 : 10, pointerEvents: "auto", zIndex: 5 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ color: selBld.owner === "enemy" ? "#c44" : "#c9a825", fontWeight: "bold" }}>{icon} {label}</span>
          <span style={{ color: selBld.owner === "enemy" ? "#c44" : "#888", fontSize: 9 }}>{selBld.owner === "enemy" ? "ENEMY" : "YOURS"} {mob ? "✕" : ""}</span>
        </div>
        <div style={{ marginBottom: 4 }}>
          <div style={{ color: "#888", marginBottom: 2 }}>HP: {Math.floor(liveHp)}/{hpMax}</div>
          <div style={{ background: "#1a1a1a", height: mob ? 8 : 6, borderRadius: 2, overflow: "hidden" }}>
            <div style={{ width: `${hpPct * 100}%`, height: "100%", background: hpPct > 0.5 ? "#4a8" : hpPct > 0.25 ? "#aa4" : "#a44", borderRadius: 2 }} />
          </div>
        </div>
        <div style={{ color: "#777", lineHeight: 1.5, fontSize: mob ? 10 : 9 }}>
          Pos: ({selBld.x}, {selBld.y})
          {bd?.pop && ` │ Pop: +${bd.pop}`}
          {bd?.gen && ` │ Generates: ${bd.gen}`}
          {bd?.range && ` │ Range: ${bd.range} DMG: ${bd.dmg}`}
          {bd?.unlocks && ` │ Unlocks: ${bd.unlocks.join(", ")}`}
          {bd?.cost && <div style={{ marginTop: 2 }}>Cost: {Object.entries(bd.cost).map(([r, a]) => `${r}:${a}`).join(" ")}</div>}
        </div>
      </div>
    );
  })() : null;

  // ─── Civ Stats Panel ───
  const specCounts = {};
  for (const v of ui.vil) {
    specCounts[v.spec] = (specCounts[v.spec] || 0) + 1;
  }
  const bldCounts = {};
  for (const b of ui.bld) {
    bldCounts[b.type] = (bldCounts[b.type] || 0) + 1;
  }
  const ebldCounts = {};
  for (const b of ui.ebld) {
    ebldCounts[b.type] = (ebldCounts[b.type] || 0) + 1;
  }
  const totalGathered = Object.values(ui.stats.gathered || {}).reduce((a, b) => a + b, 0);

  const allTech = ["warrior_training", "tower", "trade"];
  const techUnlocked = ui.tech || [];

  const civContent = (
    <div style={{ color: "#c8c0a8", fontSize: mob ? 12 : 10 }}>
      <div style={{ color: "#c9a825", fontWeight: "bold", marginBottom: 8, fontSize: mob ? 15 : 13 }}>🏛 CIVILIZATION</div>

      {/* Overview */}
      <div style={{ marginBottom: 8, padding: "6px 8px", background: "rgba(255,255,255,0.03)", borderRadius: 3 }}>
        <div style={{ color: "#999", fontSize: mob ? 11 : 9, marginBottom: 2 }}>OVERVIEW</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: mob ? 10 : 6, color: "#aaa" }}>
          <span>👥 Pop: <b style={{ color: "#c9a825" }}>{ui.pop}/{ui.popCap}</b></span>
          <span>🏠 Buildings: <b style={{ color: "#c9a825" }}>{ui.bld.length}</b></span>
          <span>⚔ Kills: <b style={{ color: "#4a8" }}>{ui.stats.kills || 0}</b></span>
          <span>☠ Losses: <b style={{ color: "#c44" }}>{ui.stats.deaths || 0}</b></span>
          <span>📦 Gathered: <b style={{ color: "#ca5" }}>{Math.floor(totalGathered)}</b></span>
          <span>T: <b>{ui.tick}</b></span>
        </div>
      </div>

      {/* Tech Tree */}
      <div style={{ marginBottom: 8, padding: "6px 8px", background: "rgba(255,255,255,0.03)", borderRadius: 3 }}>
        <div style={{ color: "#999", fontSize: mob ? 11 : 9, marginBottom: 4 }}>TECH TREE</div>
        {allTech.map(t => {
          const unlocked = techUnlocked.includes(t);
          return (
            <div key={t} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3, color: unlocked ? "#c9a825" : "#555" }}>
              <span style={{ fontSize: mob ? 14 : 12 }}>{unlocked ? "✅" : "🔒"}</span>
              <span style={{ fontWeight: unlocked ? "bold" : "normal" }}>{t.replace(/_/g, " ")}</span>
              <span style={{ fontSize: mob ? 9 : 8, color: "#555" }}>
                {t === "warrior_training" ? "(barracks)" : t === "tower" ? "(workshop)" : "(market)"}
              </span>
            </div>
          );
        })}
      </div>

      {/* Specialization Breakdown */}
      <div style={{ marginBottom: 8, padding: "6px 8px", background: "rgba(255,255,255,0.03)", borderRadius: 3 }}>
        <div style={{ color: "#999", fontSize: mob ? 11 : 9, marginBottom: 4 }}>SPECIALIZATIONS</div>
        {Object.entries(SP).map(([key, sp]) => {
          const count = specCounts[key] || 0;
          if (count === 0 && key === "none" && ui.vil.length > 4) return null;
          return (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
              <span style={{ color: sp.c, width: 20, textAlign: "center" }}>{sp.i}</span>
              <span style={{ color: count > 0 ? sp.c : "#555", width: mob ? 90 : 70, fontSize: mob ? 11 : 9 }}>{sp.l}</span>
              <div style={{ flex: 1, background: "#1a1a1a", height: mob ? 7 : 5, borderRadius: 2, overflow: "hidden" }}>
                <div style={{ width: ui.vil.length > 0 ? `${(count / ui.vil.length) * 100}%` : "0%", height: "100%", background: sp.c, borderRadius: 2, opacity: count > 0 ? 1 : 0.2 }} />
              </div>
              <span style={{ color: count > 0 ? "#aaa" : "#555", width: 20, textAlign: "right", fontSize: mob ? 11 : 9 }}>{count}</span>
            </div>
          );
        })}
      </div>

      {/* Buildings */}
      <div style={{ marginBottom: 8, padding: "6px 8px", background: "rgba(255,255,255,0.03)", borderRadius: 3 }}>
        <div style={{ color: "#999", fontSize: mob ? 11 : 9, marginBottom: 4 }}>YOUR BUILDINGS</div>
        {Object.keys(BLD).map(type => {
          const count = bldCounts[type] || 0;
          if (count === 0) return null;
          const bd = BLD[type];
          return (
            <div key={type} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2, color: "#aaa" }}>
              <span style={{ width: 20, textAlign: "center" }}>{bd.icon}</span>
              <span style={{ flex: 1, fontSize: mob ? 11 : 9 }}>{type}</span>
              <span style={{ fontWeight: "bold" }}>×{count}</span>
            </div>
          );
        })}
        {Object.keys(bldCounts).length === 0 && <div style={{ color: "#555", fontSize: mob ? 10 : 9 }}>No buildings yet</div>}
      </div>

      {/* Enemy Intel */}
      <div style={{ padding: "6px 8px", background: "rgba(255,255,255,0.03)", borderRadius: 3 }}>
        <div style={{ color: "#c44", fontSize: mob ? 11 : 9, marginBottom: 4 }}>ENEMY INTEL (scouted)</div>
        <div style={{ color: "#888", marginBottom: 2 }}>Enemy TC HP: <b style={{ color: "#c44" }}>{ui.etcHp}/{ui.etcMax}</b></div>
        {Object.keys(BLD).map(type => {
          const count = ebldCounts[type] || 0;
          if (count === 0) return null;
          const bd = BLD[type];
          return (
            <div key={type} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2, color: "#a88" }}>
              <span style={{ width: 20, textAlign: "center" }}>{bd.icon}</span>
              <span style={{ flex: 1, fontSize: mob ? 11 : 9 }}>{type}</span>
              <span>×{count}</span>
            </div>
          );
        })}
        {Object.keys(ebldCounts).length === 0 && <div style={{ color: "#555", fontSize: mob ? 10 : 9 }}>No intel — scout enemy base!</div>}
      </div>

      {/* Resource Totals */}
      <div style={{ marginTop: 8, padding: "6px 8px", background: "rgba(255,255,255,0.03)", borderRadius: 3 }}>
        <div style={{ color: "#999", fontSize: mob ? 11 : 9, marginBottom: 4 }}>LIFETIME GATHERED</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: mob ? 8 : 4 }}>
          <span>🪵 <b style={{ color: "#4a8" }}>{Math.floor(ui.stats.gathered?.wood || 0)}</b></span>
          <span>🪨 <b style={{ color: "#88a" }}>{Math.floor(ui.stats.gathered?.stone || 0)}</b></span>
          <span>🪙 <b style={{ color: "#ca5" }}>{Math.floor(ui.stats.gathered?.gold || 0)}</b></span>
          <span>🍖 <b style={{ color: "#a68" }}>{Math.floor(ui.stats.gathered?.food || 0)}</b></span>
        </div>
      </div>
    </div>
  );

  const roster = (
    <div style={{ position: "absolute", bottom: mob ? 4 : 8, left: mob ? 4 : 8, display: "flex", gap: 2, flexWrap: "wrap", maxWidth: mob ? "calc(100% - 110px)" : "calc(100% - 180px)", pointerEvents: "auto" }}>
      {ui.vil.map(v => { const sp = SP[v.spec] || SP.none; const sel = selUnit === v.id; return (
        <div key={v.id} onClick={() => setSelUnit(sel ? null : v.id)} style={{ background: sel ? "rgba(201,168,37,0.2)" : "rgba(0,0,0,0.8)", borderRadius: 3, padding: mob ? "4px 6px" : "2px 4px", fontSize: mob ? 11 : 9, border: sel ? "1px solid #c9a825" : `1px solid ${sp.c}30`, cursor: "pointer", display: "flex", alignItems: "center", gap: 3, minHeight: mob ? 28 : "auto" }}>
          <span style={{ color: sp.c }}>{sp.i}</span>
          {v.specLv > 0 && <span style={{ color: "#ffd700", fontSize: mob ? 10 : 8 }}>{"★".repeat(Math.min(v.specLv, 5))}</span>}
        </div>
      ); })}
    </div>
  );

  const watchContent = (
    <div style={{ color: "#c8c0a8", fontSize: mob ? 12 : 9.5 }}>
      <div style={{ color: "#c9a825", fontWeight: "bold", marginBottom: 6, fontSize: mob ? 14 : 12 }}>🔍 WATCH</div>
      <div style={{ color: "#666", marginBottom: 6 }}>Script: <span style={{ color: ui.scriptMs < 1 ? "#4a8" : ui.scriptMs < 5 ? "#ca5" : "#f44" }}>{ui.scriptMs?.toFixed(2)}ms</span></div>
      <div style={{ color: "#666", marginBottom: 4 }}>Δ/tick:</div>
      <div style={{ marginBottom: 6, paddingLeft: 6, display: "flex", flexWrap: "wrap", gap: mob ? 8 : 4 }}>
        {["wood", "stone", "gold", "food"].map(k => (
          <span key={k} style={{ color: (ui.stkDelta?.[k] || 0) > 0 ? "#4a8" : (ui.stkDelta?.[k] || 0) < -0.5 ? "#a44" : "#666" }}>{k[0].toUpperCase()}:{fmtD(ui.stkDelta?.[k] || 0)}</span>
        ))}
      </div>
      <div style={{ color: "#666", marginBottom: 4 }}>Kills: <span style={{ color: "#c9a825" }}>{ui.stats.kills}</span> Deaths: <span style={{ color: "#c44" }}>{ui.stats.deaths}</span></div>
      <div style={{ color: "#555", borderTop: "1px solid #2a3020", paddingTop: 6, marginTop: 6 }}>api.memory:</div>
      <pre style={{ color: "#8a8", fontSize: mob ? 10 : 8.5, margin: "4px 0", whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: mob ? 250 : 150, overflow: "auto" }}>
        {JSON.stringify(ui.mem, null, 1)}
      </pre>
    </div>
  );

  const logContent = (
    <div>
      {ui.log.slice().reverse().map((l, i) => (
        <div key={i} style={{ color: logColor(l), marginBottom: mob ? 4 : 1, lineHeight: 1.4 }}>{l}</div>
      ))}
    </div>
  );

  const scriptEditor = (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: mob ? "8px 12px" : "5px 10px", background: "#1a1e16", borderBottom: "1px solid #2a3020", fontSize: mob ? 13 : 11, flexShrink: 0 }}>
        <span style={{ color: "#6a6" }}>📜 AI Script</span>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => { setScript(DEFAULT_SCRIPT); compile(DEFAULT_SCRIPT); }} style={btn}>↺</button>
          <button onClick={() => compile(script)} style={{ ...btn, background: sErr ? "#533" : "#2a4a2a" }}>▶ Compile</button>
        </div>
      </div>
      {sErr && <div style={{ padding: "6px 12px", background: "#3a1515", color: "#f88", fontSize: mob ? 11 : 10, borderBottom: "1px solid #5a2020", flexShrink: 0 }}>⚠ {sErr}</div>}
      <textarea value={script} onChange={e => setScript(e.target.value)}
        onKeyDown={e => { if (e.key === "Tab") { e.preventDefault(); const s = e.target.selectionStart, end = e.target.selectionEnd; setScript(script.substring(0, s) + "  " + script.substring(end)); setTimeout(() => { e.target.selectionStart = e.target.selectionEnd = s + 2; }, 0); } }}
        spellCheck={false}
        style={{ flex: 1, background: "#0d110d", color: "#a0c898", border: "none", padding: mob ? 12 : 10, fontFamily: "'Courier New',monospace", fontSize: mob ? 12 : 11, lineHeight: 1.45, resize: "none", outline: "none", tabSize: 2 }} />
      <div style={{ padding: mob ? "8px 12px" : "5px 10px", borderTop: "1px solid #2a3020", fontSize: mob ? 10 : 9, color: "#555", lineHeight: 1.5, flexShrink: 0 }}>
        <span style={{ color: "#6a6" }}>Goal:</span> Destroy enemy TC!{!mob && <><br /><span style={{ color: "#6a6" }}>Keys:</span> Space=pause ]/[=speed N=step Ctrl+Enter=compile</>}
      </div>
    </>
  );

  // ─── MOBILE LAYOUT ────────────────────────────────────────────
  if (mob) {
    const tabBtn = (id, label) => (
      <button key={id} onClick={() => setMTab(id)}
        style={{ ...btn, flex: 1, textAlign: "center", padding: "10px 4px", fontSize: 12,
          background: mTab === id ? "#3a4030" : "#1a1e16",
          color: mTab === id ? "#c9a825" : "#888",
          border: mTab === id ? "1px solid #c9a825" : "1px solid #2a3020",
          borderRadius: 0, borderTop: mTab === id ? "2px solid #c9a825" : "2px solid transparent",
        }}>
        {label}
      </button>
    );

    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", width: "100vw", background: "#0f1410", color: "#c8c0a8", fontFamily: "'Courier New',monospace", overflow: "hidden", position: "relative", overscrollBehavior: "none" }}>
        <div style={{ padding: "6px 8px", background: "#1a1e16", borderBottom: "1px solid #2a3020", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ color: "#c9a825", fontWeight: "bold", fontSize: 13 }}>⚔ SCRIPT RTS</span>
            <div style={{ display: "flex", gap: 4 }}>
              <button onClick={() => setSpd(s => s === 1 ? 2 : s === 2 ? 4 : 1)} style={btn}>⏩{spd}x</button>
              <button onClick={togglePause} style={btn}>{ui.paused ? "▶" : "⏸"}</button>
              <button onClick={stepOnce} style={{ ...btn, opacity: ui.paused ? 1 : 0.5 }}>⏭</button>
              <button onClick={restart} style={btn}>🔄</button>
            </div>
          </div>
          {resBar}
        </div>
        {gameOverOverlay}
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {/* Canvas always in DOM but hidden via display:none when not active */}
          <div ref={mapContainerRef} style={{ position: "relative", overflow: "hidden", touchAction: "none", flex: 1, display: mTab === "map" ? "flex" : "none", flexDirection: "column" }}
            onMouseDown={onMD} onMouseMove={onMM} onMouseUp={onMU} onMouseLeave={onMU}
            onContextMenu={e => e.preventDefault()}>
            <canvas ref={cvRef} style={{ width: "100%", height: "100%", display: "block", cursor: "grab" }} />
            <canvas ref={mnRef} width={110} height={77}
              onClick={onMiniClick} onTouchEnd={onMiniClick}
              style={{ position: "absolute", bottom: 4, right: 4, border: "1px solid #3a4030", borderRadius: 3, cursor: "crosshair", background: "#080c06", width: 90, height: 63 }} />
            {roster}
            {unitDetail}
            {bldInfo}
          </div>
          {mTab === "script" && <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#111611" }}>{scriptEditor}</div>}
          {mTab === "log" && <div style={{ flex: 1, background: "rgba(0,0,0,0.95)", padding: 12, fontSize: 12, overflowY: "auto" }}>{logContent}</div>}
          {mTab === "watch" && <div style={{ flex: 1, background: "rgba(0,0,0,0.95)", padding: 12, overflowY: "auto" }}>{watchContent}</div>}
          {mTab === "civ" && <div style={{ flex: 1, background: "rgba(0,0,0,0.95)", padding: 12, overflowY: "auto" }}>{civContent}</div>}
        </div>
        <div style={{ display: "flex", flexShrink: 0, background: "#1a1e16", borderTop: "1px solid #2a3020" }}>
          {tabBtn("map", "🗺 Map")}
          {tabBtn("script", "📜")}
          {tabBtn("civ", "🏛")}
          {tabBtn("log", "📋")}
          {tabBtn("watch", "🔍")}
        </div>
      </div>
    );
  }

  // ─── DESKTOP LAYOUT ───────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", width: "100vw", background: "#0f1410", color: "#c8c0a8", fontFamily: "'Courier New',monospace", overflow: "hidden", position: "relative", overscrollBehavior: "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", background: "#1a1e16", borderBottom: "1px solid #2a3020", fontSize: 11, flexShrink: 0, flexWrap: "wrap" }}>
        <span style={{ color: "#c9a825", fontWeight: "bold", fontSize: 12 }}>⚔ SCRIPT RTS</span>
        <span style={{ color: "#555", fontSize: 10 }}>T:{ui.tick}</span>
        <span style={{ color: "#333" }}>│</span>
        {resBar}
        {ui.tech.length > 0 && <span style={{ color: "#777", fontSize: 10 }}>⚙{ui.tech.join(",")}</span>}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 9, color: "#555" }}>{ui.scriptMs?.toFixed(1)}ms</span>
        <button onClick={() => setSpd(s => s === 1 ? 2 : s === 2 ? 4 : 1)} style={btn}>⏩{spd}x</button>
        <button onClick={togglePause} style={btn}>{ui.paused ? "▶" : "⏸"}</button>
        <button onClick={stepOnce} style={{ ...btn, opacity: ui.paused ? 1 : 0.5 }} title="Step (N)">⏭</button>
        <button onClick={restart} style={btn}>🔄</button>
        <button onClick={() => setShowWatch(s => !s)} style={btn}>{showWatch ? "▬" : "▭"}Watch</button>
        <button onClick={() => setShowCiv(s => !s)} style={btn}>🏛Civ</button>
        <button onClick={() => setShowS(s => !s)} style={btn}>{showS ? "◀" : "▶"}Script</button>
        <button onClick={() => setShowLog(s => !s)} style={btn}>Log</button>
      </div>
      {gameOverOverlay}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Canvas area */}
        <div ref={mapContainerRef} style={{ position: "relative", overflow: "hidden", touchAction: "none", flex: 1 }}
          onMouseDown={onMD} onMouseMove={onMM} onMouseUp={onMU} onMouseLeave={onMU}
          onContextMenu={e => e.preventDefault()}>
          <canvas ref={cvRef} style={{ width: "100%", height: "100%", display: "block", cursor: "grab" }} />
          <canvas ref={mnRef} width={150} height={105}
            onClick={onMiniClick}
            style={{ position: "absolute", bottom: 8, right: 8, border: "1px solid #3a4030", borderRadius: 3, cursor: "crosshair", background: "#080c06", width: 150, height: 105 }} />
          {roster}
          {unitDetail}
            {bldInfo}
        </div>
        {/* Desktop floating overlays */}
        {showCiv && (
          <div style={{ position: "absolute", top: 40, left: 8, zIndex: 10, width: 260, maxHeight: "75%", background: "rgba(0,0,0,0.92)", borderRadius: 4, padding: 10, overflowY: "auto", border: "1px solid #2a3020", pointerEvents: "auto" }}>
            {civContent}
          </div>
        )}
        {showWatch && (
          <div style={{ position: "absolute", top: 40, right: showLog && showS ? 660 : showS ? 408 : showLog ? 268 : 8, zIndex: 10, width: 220, maxHeight: "60%", background: "rgba(0,0,0,0.92)", borderRadius: 4, padding: 8, overflowY: "auto", border: "1px solid #2a3020", pointerEvents: "auto" }}>
            {watchContent}
          </div>
        )}
        {showLog && (
          <div style={{ position: "absolute", top: 40, right: showS ? 408 : 8, zIndex: 10, width: 250, maxHeight: "50%", background: "rgba(0,0,0,0.92)", borderRadius: 4, padding: 6, fontSize: 9.5, overflowY: "auto", border: "1px solid #2a3020", pointerEvents: "auto" }}>
            {logContent}
          </div>
        )}
        {showS && (
          <div style={{ width: 390, flexShrink: 0, display: "flex", flexDirection: "column", borderLeft: "1px solid #2a3020", background: "#111611" }}>
            {scriptEditor}
          </div>
        )}
      </div>
    </div>
  );
}
