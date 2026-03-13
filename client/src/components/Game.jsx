import { useState, useEffect, useRef, useCallback } from "react";
import { useGameSocket } from "../hooks/useGameSocket.js";
import { render, renderMini, BLD_SIZE } from "../rendering/renderer.js";
import { SFX } from "../sound.js";

const T = 14, MW = 64, MH = 44;
const SP = {
  none:       { c: "#b8a080", l: "Villager",   i: "♟" },
  lumberjack: { c: "#4a8c3f", l: "Lumberjack", i: "🪓" },
  miner:      { c: "#7a7a8e", l: "Miner",      i: "⛏" },
  farmer:     { c: "#c4a035", l: "Farmer",      i: "🌾" },
  warrior:    { c: "#a83232", l: "Warrior",     i: "⚔" },
  builder:    { c: "#6a5a3a", l: "Builder",     i: "🔨" },
};
const BLD = {
  house:    { icon: "🏠", size: 2, hp: 100, pop: 4, cost: { wood: 30 } },
  farm:     { icon: "🌾", size: 2, hp: 60, gen: "food", rate: 0.18, cost: { wood: 20 } },
  barracks: { icon: "⚔",  size: 2, hp: 150, unlocks: "warrior_training", cost: { wood: 50, stone: 20 } },
  tower:    { icon: "🗼", size: 1, hp: 200, range: 6, dmg: 4, cost: { stone: 40, gold: 10 } },
  workshop: { icon: "🔧", size: 2, hp: 120, unlocks: "tower", cost: { wood: 40, stone: 30 } },
  market:   { icon: "🏪", size: 2, hp: 100, unlocks: "trade", cost: { wood: 30, gold: 15 } },
  bridge:   { icon: "🌉", size: 1, hp: 80, cost: { wood: 15, stone: 10 } },
};

const ABILITIES = {
  warrior:    { name: "Whirlwind", icon: "💥", desc: "AoE damage to nearby enemies" },
  farmer:     { name: "Cultivate", icon: "🌱", desc: "Spawn food resource" },
  builder:    { name: "Repair",    icon: "🔧", desc: "Heal nearest damaged building" },
  miner:      { name: "Survey",    icon: "🔍", desc: "Reveal large area" },
  lumberjack: { name: "Chop Burst",icon: "🪓", desc: "Instant wood harvest" },
};

const ITEMS = {
  iron_pickaxe:  { slot: "tool",    label: "Iron Pickaxe",     icon: "⛏", cost: { wood: 10, stone: 15 }, craftAt: "workshop", desc: "+0.4 gather speed" },
  iron_axe:      { slot: "tool",    label: "Iron Axe",         icon: "🪓", cost: { wood: 15, stone: 10 }, craftAt: "workshop", desc: "+0.4 gather speed" },
  sickle:        { slot: "tool",    label: "Sickle",           icon: "🌾", cost: { wood: 10, gold: 5 },   craftAt: "workshop", desc: "+0.3 gather speed" },
  hammer:        { slot: "tool",    label: "Builder's Hammer", icon: "🔨", cost: { wood: 10, stone: 10 }, craftAt: "workshop", desc: "+0.5 build speed" },
  sword:         { slot: "weapon",  label: "Sword",            icon: "🗡", cost: { stone: 20, gold: 10 }, craftAt: "barracks", requires: "warrior_training", desc: "+3 damage" },
  spear:         { slot: "weapon",  label: "Spear",            icon: "🔱", cost: { wood: 15, stone: 10 }, craftAt: "barracks", requires: "warrior_training", desc: "+2 dmg, +6 siege" },
  bow:           { slot: "weapon",  label: "Bow",              icon: "🏹", cost: { wood: 20, gold: 5 },   craftAt: "barracks", requires: "warrior_training", desc: "+1.5 dmg, 3 range" },
  leather_armor: { slot: "armor",   label: "Leather Armor",    icon: "🦺", cost: { food: 20, gold: 5 },   craftAt: "barracks", desc: "+15 HP" },
  chain_mail:    { slot: "armor",   label: "Chain Mail",       icon: "🛡", cost: { stone: 25, gold: 15 }, craftAt: "barracks", requires: "warrior_training", desc: "+30 HP, -1 incoming" },
  battering_ram: { slot: "vehicle", label: "Battering Ram",    icon: "🪵", cost: { wood: 60, stone: 30 }, craftAt: "workshop", requires: "tower", desc: "+15 siege damage" },
  catapult:      { slot: "vehicle", label: "Catapult",         icon: "💣", cost: { wood: 40, stone: 40, gold: 20 }, craftAt: "workshop", requires: "tower", desc: "+10 siege, 4 range" },
  cart:          { slot: "vehicle", label: "Cart",             icon: "🛒", cost: { wood: 25, gold: 10 },  craftAt: "market", requires: "trade", desc: "+15 carry capacity" },
};

const btn = {
  background: "#2a2e22", color: "#a8a890", border: "1px solid #3a4030",
  borderRadius: 3, cursor: "pointer", fontFamily: "'Courier New',monospace",
  padding: "3px 8px", fontSize: 11, whiteSpace: "nowrap",
};

const DEFAULT_SCRIPT = `// Script RTS - Neural Net AI
// The neural net handles strategy (what to prioritize), the script handles tactics.
//
// api.neural  - { create(layers), load(json), extractFeatures(api), decodeAction(out) }
// api.items   - item definitions (cost, slot, craftAt, bonuses)
// api.memory  - persists across ticks (stores the net + decisions)
//
// Commands: v.cmd = "gather"|"attack"|"build"|"moveTo"|"ability"|"idle"|"craft"
// Craft:    v.cmd = "craft"; v.craftItem = "sword";

function update(api) {
  const { villagers, enemies, resources, stockpile, tc, buildings, tick, memory, tech, popCap, items } = api;

  // ── Initialize neural net (random weights, or paste trained weights below) ──
  if (!memory.net) {
    memory.net = api.neural.create(); // [45, 32, 16, 13] default
    // To load trained weights: memory.net = api.neural.load(WEIGHTS_JSON);
  }

  // ── Run neural net every 5 ticks for strategic decisions ──
  if (!memory.d || tick % 5 === 0) {
    const features = api.neural.extractFeatures(api);
    const output = memory.net.forward(features);
    memory.d = api.neural.decodeAction(output);
  }

  const d = memory.d;
  const threats = enemies.filter(e => api.pathDist(e, tc) < 14);
  const alive = villagers.filter(v => v.alive !== false);
  const milTarget = Math.round(d.militaryRatio * alive.length);
  let milCount = alive.filter(v => v.tag === "mil").length;
  let bldCount = alive.filter(v => v.tag === "bld").length;

  // ── Building costs (for affordability checks) ──
  const BLD_COST = {
    house: { wood: 30 }, farm: { wood: 20 }, barracks: { wood: 50, stone: 20 },
    tower: { stone: 40, gold: 10 }, workshop: { wood: 40, stone: 30 },
    market: { wood: 30, gold: 15 }, bridge: { wood: 15, stone: 10 },
  };
  const canAfford = (type) => {
    const c = BLD_COST[type];
    return c && Object.entries(c).every(([r, a]) => (stockpile[r] || 0) >= a);
  };

  for (const v of villagers) {
    // ── Tag assignment (neural net controls military ratio) ──
    if (!v.tag) {
      if (v.spec === "warrior") { v.tag = "mil"; milCount++; }
      else if (bldCount < 1) { v.tag = "bld"; bldCount++; }
      else if (milCount < milTarget) { v.tag = "mil"; milCount++; }
      else v.tag = "eco";
    }

    // ── TACTICAL: Always defend against nearby threats ──
    if (threats.length > 0) {
      const cl = threats.reduce((b, e) => {
        const dist = api.pathDist(v, e);
        return dist < b.d ? { e, d: dist } : b;
      }, { e: null, d: 999 });
      if (v.tag === "mil" || cl.d < 5) {
        if (v.specLv >= 3 && v.abCd <= 0 && cl.d <= 2) v.cmd = "ability";
        else { v.cmd = "attack"; v.targetId = cl.e.id; }
        continue;
      }
    }

    // ── STRATEGIC: Attack signal from neural net ──
    if (d.shouldAttack && v.tag === "mil" && api.enemyTc) {
      v.cmd = "moveTo"; v.moveX = api.enemyTc.x; v.moveY = api.enemyTc.y;
      continue;
    }

    // ── STRATEGIC: Craft signal from neural net ──
    if (d.shouldCraft) {
      if (v.spec === "warrior" && !v.equip?.weapon && tech.includes("warrior_training")) {
        if (buildings.some(b => b.type === "barracks" && b.built) && stockpile.stone >= 20 && stockpile.gold >= 10) {
          v.cmd = "craft"; v.craftItem = "sword"; continue;
        }
      }
      if (["lumberjack","miner","farmer"].includes(v.spec) && !v.equip?.tool) {
        if (buildings.some(b => b.type === "workshop" && b.built)) {
          const toolMap = { lumberjack: "iron_axe", miner: "iron_pickaxe", farmer: "sickle" };
          const tool = toolMap[v.spec];
          const cost = items[tool]?.cost || {};
          if (Object.entries(cost).every(([r, a]) => (stockpile[r] || 0) >= a)) {
            v.cmd = "craft"; v.craftItem = tool; continue;
          }
        }
      }
    }

    // ── STRATEGIC: Build orders from neural net ──
    if (v.tag === "bld") {
      for (const bType of d.buildOrders) {
        if (canAfford(bType)) {
          v.cmd = "build"; v.buildType = bType;
          v.buildX = tc.x + Math.floor(Math.random() * 10 - 5);
          v.buildY = tc.y + Math.floor(Math.random() * 10 - 5);
          break;
        }
      }
      if (v.cmd === "build") continue;
    }

    // ── STRATEGIC: Gather priority from neural net ──
    const gp = d.gatherPriority;
    const types = ["wood", "stone", "gold", "food"];
    types.sort((a, b) => (gp[b] || 0) - (gp[a] || 0));
    for (const gt of types) {
      const tgt = resources.filter(r => r.type === gt && r.amount > 0)
        .sort((a, b) => api.pathDist(a, v) - api.pathDist(b, v))[0];
      if (tgt) { v.cmd = "gather"; v.targetId = tgt.id; break; }
    }
    if (!v.cmd) v.cmd = "idle";
  }
}`;

export default function Game({ gameId, playerId, token, onLeave }) {
  const serverUrl = window.location.host;
  const { view, connected, error, sendCommands, sendScript } = useGameSocket(serverUrl, gameId, token);

  const cvRef = useRef(null);
  const mnRef = useRef(null);
  const camRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const afRef = useRef(null);
  const dragRef = useRef(null);

  const [script, setScript] = useState(DEFAULT_SCRIPT);
  const [sErr, setSErr] = useState(null);
  const [selUnit, setSelUnit] = useState(null);
  const [selBld, setSelBld] = useState(null);
  const [showS, setShowS] = useState(true);
  const [showLog, setShowLog] = useState(false);
  const [showCiv, setShowCiv] = useState(false);
  const [showTrain, setShowTrain] = useState(false);
  const [trainState, setTrainState] = useState({ running: false, gen: 0, history: [], sessionId: null, bestWeights: null });
  const [mTab, setMTab] = useState("map");

  const [wSz, setWSz] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const fn = () => setWSz({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  const mob = wSz.w < 768;

  // Center camera on TC when first view arrives
  const centered = useRef(false);
  useEffect(() => {
    if (view?.myTc && !centered.current) {
      const c = cvRef.current;
      if (c) {
        const rect = c.getBoundingClientRect();
        const Z = T * zoomRef.current;
        camRef.current = {
          x: view.myTc.x * Z - rect.width / 2,
          y: view.myTc.y * Z - rect.height / 2,
        };
        centered.current = true;
      }
    }
  }, [view]);

  // Canvas resize — depend on !!view so it re-runs when canvas first mounts
  const hasView = !!view;

  // Zoom with mouse wheel (use ref-based listener for non-passive)
  const zoomCanvasRef = useRef(null);
  useEffect(() => {
    const el = zoomCanvasRef.current;
    if (!el) return;
    const handler = (e) => {
      e.preventDefault();
      const c = cvRef.current;
      if (!c) return;
      const rect = c.getBoundingClientRect();
      const oldZoom = zoomRef.current;
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      const newZoom = Math.max(0.5, Math.min(3, oldZoom + delta));
      if (newZoom === oldZoom) return;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const worldX = (camRef.current.x + mx) / (T * oldZoom);
      const worldY = (camRef.current.y + my) / (T * oldZoom);
      camRef.current = {
        x: worldX * T * newZoom - mx,
        y: worldY * T * newZoom - my,
      };
      zoomRef.current = newZoom;
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [hasView]);
  useEffect(() => {
    const c = cvRef.current;
    if (!c) return;
    const parent = c.parentElement;
    if (!parent) return;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = parent.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      c.width = Math.floor(rect.width * dpr);
      c.height = Math.floor(rect.height * dpr);
      c.style.width = rect.width + "px";
      c.style.height = rect.height + "px";
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [mob, mTab, hasView]);

  // Render loop
  useEffect(() => {
    const c = cvRef.current, mc = mnRef.current;
    if (!c) return;
    const ctx = c.getContext("2d"), mctx = mc?.getContext("2d");

    const draw = () => {
      if (!view) { afRef.current = requestAnimationFrame(draw); return; }
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = c.width / dpr, ch = c.height / dpr;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      render(ctx, view, camRef.current, cw, ch, { unitId: selUnit, bld: selBld }, playerId, zoomRef.current);
      ctx.restore();
      if (mctx) renderMini(mctx, view, camRef.current, cw, ch, playerId, zoomRef.current);
      afRef.current = requestAnimationFrame(draw);
    };
    afRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(afRef.current);
  }, [view, selUnit, selBld, playerId]);

  // Mouse handlers for camera pan + selection
  const onMD = useCallback((e) => {
    if (e.button === 0) {
      dragRef.current = { x: e.clientX, y: e.clientY, cx: camRef.current.x, cy: camRef.current.y, moved: false };
    }
  }, []);

  const onMM = useCallback((e) => {
    if (dragRef.current) {
      const dx = e.clientX - dragRef.current.x;
      const dy = e.clientY - dragRef.current.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragRef.current.moved = true;
      camRef.current = { x: dragRef.current.cx - dx, y: dragRef.current.cy - dy };
    }
  }, []);

  const onMU = useCallback((e) => {
    if (dragRef.current && !dragRef.current.moved && view) {
      const rect = cvRef.current.getBoundingClientRect();
      const Z = T * zoomRef.current;
      const mx = Math.floor((e.clientX - rect.left + camRef.current.x) / Z);
      const my = Math.floor((e.clientY - rect.top + camRef.current.y) / Z);

      // Try to select a unit
      const unit = (view.myUnits || []).find(v => v.x === mx && v.y === my && v.alive);
      if (unit) {
        setSelUnit(unit.id);
        setSelBld(null);
      } else {
        // Try building (check full footprint)
        const bld = (view.myBuildings || []).find(b => {
          const sz = BLD_SIZE[b.type] || (BLD[b.type]?.size) || 1;
          return mx >= b.x && mx < b.x + sz && my >= b.y && my < b.y + sz;
        });
        // Also try TC
        const tc = view.myTc;
        const clickedTc = tc && mx >= tc.x - 1 && mx < tc.x + 2 && my >= tc.y - 1 && my < tc.y + 2;
        if (bld) { setSelBld(bld); setSelUnit(null); }
        else if (clickedTc) { setSelBld({ ...tc, type: "tc", _isTc: true }); setSelUnit(null); }
        else { setSelUnit(null); setSelBld(null); }
      }
    }
    dragRef.current = null;
  }, [view]);

  // Minimap click
  const onMiniClick = useCallback((e) => {
    const mc = mnRef.current;
    if (!mc || !cvRef.current) return;
    const rect = mc.getBoundingClientRect();
    const rx = (e.clientX - rect.left) / rect.width;
    const ry = (e.clientY - rect.top) / rect.height;
    const cRect = cvRef.current.getBoundingClientRect();
    const Z = T * zoomRef.current;
    camRef.current = {
      x: rx * MW * Z - cRect.width / 2,
      y: ry * MH * Z - cRect.height / 2,
    };
  }, []);

  // Compile and send script
  const compile = useCallback(() => {
    try {
      new Function("api", script + "\nif(typeof update==='function')update(api);");
      setSErr(null);
      sendScript(script);
    } catch (e) {
      setSErr(e.message);
    }
  }, [script, sendScript]);

  // Auto-compile default script when first connected
  const autoCompiled = useRef(false);
  useEffect(() => {
    if (connected && !autoCompiled.current) {
      autoCompiled.current = true;
      compile();
    }
  }, [connected, compile]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey && e.key === "Enter") { compile(); e.preventDefault(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [compile]);

  // ── Derived UI data ──
  const ui = view || {};
  const myUnits = ui.myUnits || [];
  const myBld = ui.myBuildings || [];
  const stk = ui.myStockpile || { wood: 0, stone: 0, gold: 0, food: 0 };
  const players = ui.players || [];
  const myPlayer = players.find(p => p.id === playerId);

  const fmtR = (v) => v < 1000 ? Math.floor(v) : (v / 1000).toFixed(1) + "k";
  const fmtD = (v) => v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1);
  const delta = ui.stkDelta || {};
  const dCol = (v) => (v || 0) > 0 ? "#4a8" : (v || 0) < -0.5 ? "#a44" : "#666";

  // Resource bar
  const resBar = (
    <div style={{ display: "flex", gap: mob ? 8 : 10, fontSize: mob ? 12 : 11, flexWrap: "wrap" }}>
      <span>👥 <b style={{ color: "#c9a825" }}>{myUnits.length}/{ui.myPopCap || 4}</b></span>
      <span>🪵 <b style={{ color: "#4a8" }}>{fmtR(stk.wood)}</b> <span style={{ color: dCol(delta.wood), fontSize: 9 }}>{fmtD(delta.wood || 0)}</span></span>
      <span>🪨 <b style={{ color: "#88a" }}>{fmtR(stk.stone)}</b> <span style={{ color: dCol(delta.stone), fontSize: 9 }}>{fmtD(delta.stone || 0)}</span></span>
      <span>🪙 <b style={{ color: "#ca5" }}>{fmtR(stk.gold)}</b> <span style={{ color: dCol(delta.gold), fontSize: 9 }}>{fmtD(delta.gold || 0)}</span></span>
      <span>🍖 <b style={{ color: stk.food < 10 ? "#f44" : "#a68" }}>{fmtR(stk.food)}</b> <span style={{ color: dCol(delta.food), fontSize: 9 }}>{fmtD(delta.food || 0)}</span></span>
    </div>
  );

  // Game over overlay
  const gameOverOverlay = ui.gameOver ? (
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 100,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.85)", backdropFilter: "blur(4px)",
    }}>
      <div style={{ textAlign: "center", padding: 40 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>{ui.winner === playerId ? "🏆" : "💀"}</div>
        <div style={{ fontSize: 24, color: ui.winner === playerId ? "#c9a825" : "#c44", fontWeight: "bold", marginBottom: 8 }}>
          {ui.winner === playerId ? "VICTORY!" : "DEFEATED"}
        </div>
        {ui.winner && ui.winner !== playerId && (
          <div style={{ color: "#888", marginBottom: 16 }}>
            {players.find(p => p.id === ui.winner)?.name || "Unknown"} wins!
          </div>
        )}
        <button onClick={onLeave} style={{ ...btn, padding: "10px 30px", fontSize: 14 }}>Back to Lobby</button>
      </div>
    </div>
  ) : null;

  // Unit roster
  const roster = (
    <div style={{ position: "absolute", bottom: mob ? 4 : 8, left: mob ? 4 : 8,
      display: "flex", gap: 2, flexWrap: "wrap",
      maxWidth: mob ? "calc(100% - 110px)" : "calc(100% - 180px)", pointerEvents: "auto",
    }}>
      {myUnits.map(v => {
        const sp = SP[v.spec] || SP.none;
        const sel = selUnit === v.id;
        return (
          <div key={v.id} onClick={() => setSelUnit(sel ? null : v.id)}
            style={{ background: sel ? "rgba(201,168,37,0.2)" : "rgba(0,0,0,0.8)", borderRadius: 3,
              padding: mob ? "4px 6px" : "2px 4px", fontSize: mob ? 11 : 9,
              border: sel ? "1px solid #c9a825" : `1px solid ${sp.c}30`, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 3,
            }}>
            <span style={{ color: sp.c }}>{sp.i}</span>
            {v.specLv > 0 && <span style={{ color: "#ffd700", fontSize: 8 }}>{"★".repeat(Math.min(v.specLv, 5))}</span>}
            {v.equip?.weapon && <span style={{ fontSize: 7 }}>{ITEMS[v.equip.weapon]?.icon}</span>}
          </div>
        );
      })}
    </div>
  );

  // Selected unit detail (enhanced)
  const unitDetail = selUnit ? (() => {
    const v = myUnits.find(u => u.id === selUnit);
    if (!v) return null;
    const sp = SP[v.spec] || SP.none;
    const xp = v.xp || {};
    const maxXP = Math.max(1, ...Object.values(xp));
    const ab = v.spec !== "none" ? ABILITIES[v.spec] : null;
    const eq = v.equip || {};
    const xpEntries = [
      ["wood",   "🪵", "#4a8c3f"],
      ["stone",  "🪨", "#7a7a8e"],
      ["gold",   "🪙", "#c4a030"],
      ["food",   "🍖", "#c4a035"],
      ["combat", "⚔",  "#a83232"],
      ["build",  "🔨", "#6a5a3a"],
    ];

    // Items available for crafting at this unit
    const availItems = Object.entries(ITEMS).filter(([key, def]) => {
      if (eq[def.slot] === key) return false; // already equipped
      const hasBld = myBld.some(b => b.type === def.craftAt && b.built);
      const hasTech = !def.requires || (ui.myTech || []).includes(def.requires);
      return hasBld && hasTech;
    });

    return (
      <div style={{ position: "absolute", top: mob ? 50 : 40, left: 8, zIndex: 10, width: 260,
        background: "rgba(0,0,0,0.92)", borderRadius: 4, padding: 8, border: "1px solid #2a3020",
        fontSize: 10, color: "#aaa", pointerEvents: "auto", maxHeight: "80vh", overflowY: "auto",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
          <span style={{ color: sp.c, fontSize: 18 }}>{sp.i}</span>
          <div>
            <div style={{ color: "#c9a825", fontWeight: "bold", fontSize: 11 }}>#{v.id} {sp.l} L{v.specLv}</div>
            <div style={{ color: "#666", fontSize: 9 }}>Cmd: {v.cmd || "idle"} | Tag: {v.tag || "none"}</div>
          </div>
        </div>

        {/* HP Bar */}
        <div style={{ marginBottom: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9 }}>
            <span>HP</span><span>{Math.floor(v.hp)}/{v.maxHp}</span>
          </div>
          <div style={{ height: 5, background: "#1a1a1a", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ width: `${(v.hp / v.maxHp) * 100}%`, height: "100%", background: v.hp / v.maxHp > 0.5 ? "#4a8" : "#c44", borderRadius: 2 }} />
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1px 8px", marginBottom: 6, padding: "4px 6px", background: "rgba(255,255,255,0.03)", borderRadius: 3 }}>
          <span>DMG: <b style={{ color: "#c88" }}>{v.dmg?.toFixed(1)}</b></span>
          <span>Range: <b>{v.atkRange || 1}</b></span>
          <span>GSpd: <b style={{ color: "#4a8" }}>{v.gSpd?.toFixed(1)}</b></span>
          <span>BSpd: <b style={{ color: "#6a5" }}>{v.bSpd?.toFixed(1)}</b></span>
          <span>Carry: <b>{v.carry}/{v.maxCarry}</b> {v.carryType || ""}</span>
          {(v.siegeDmg || 0) > 0 && <span>Siege: <b style={{ color: "#f84" }}>{v.siegeDmg}</b></span>}
        </div>

        {/* XP Bars */}
        <div style={{ marginBottom: 6, padding: "4px 6px", background: "rgba(255,255,255,0.03)", borderRadius: 3 }}>
          <div style={{ color: "#999", fontSize: 8, marginBottom: 3 }}>EXPERIENCE</div>
          {xpEntries.map(([key, icon, color]) => (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 1 }}>
              <span style={{ width: 12, fontSize: 9 }}>{icon}</span>
              <div style={{ flex: 1, height: 4, background: "#1a1a1a", borderRadius: 1, overflow: "hidden" }}>
                <div style={{ width: `${Math.min(100, ((xp[key] || 0) / Math.max(maxXP, 12)) * 100)}%`, height: "100%", background: color, borderRadius: 1 }} />
              </div>
              <span style={{ width: 22, textAlign: "right", fontSize: 8, color: "#666" }}>{Math.floor(xp[key] || 0)}</span>
            </div>
          ))}
        </div>

        {/* Ability */}
        {ab && (
          <div style={{ marginBottom: 6, padding: "4px 6px", background: "rgba(255,255,255,0.03)", borderRadius: 3 }}>
            <div style={{ color: "#999", fontSize: 8, marginBottom: 2 }}>ABILITY {v.specLv < 3 ? "(Lv3 to unlock)" : ""}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 14 }}>{ab.icon}</span>
              <div>
                <div style={{ color: v.specLv >= 3 ? "#c9a825" : "#555", fontWeight: "bold" }}>{ab.name}</div>
                <div style={{ color: "#666", fontSize: 9 }}>{ab.desc}</div>
              </div>
            </div>
            {v.specLv >= 3 && v.abCd > 0 && (
              <div style={{ color: "#888", marginTop: 2 }}>Cooldown: <b>{v.abCd}</b> ticks</div>
            )}
            {v.specLv >= 3 && v.abCd <= 0 && (
              <div style={{ color: "#4a8", marginTop: 2 }}>Ready!</div>
            )}
          </div>
        )}

        {/* Equipment */}
        <div style={{ marginBottom: 6, padding: "4px 6px", background: "rgba(255,255,255,0.03)", borderRadius: 3 }}>
          <div style={{ color: "#999", fontSize: 8, marginBottom: 3 }}>EQUIPMENT</div>
          {["weapon", "armor", "tool", "vehicle"].map(slot => {
            const itemKey = eq[slot];
            const item = itemKey ? ITEMS[itemKey] : null;
            return (
              <div key={slot} style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
                <span style={{ width: 50, color: "#666", textTransform: "capitalize", fontSize: 9 }}>{slot}:</span>
                {item ? (
                  <span style={{ color: "#c9a825" }}>{item.icon} {item.label}</span>
                ) : (
                  <span style={{ color: "#333" }}>empty</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Available Items (script reference) */}
        {availItems.length > 0 && (
          <div style={{ padding: "4px 6px", background: "rgba(255,255,255,0.03)", borderRadius: 3 }}>
            <div style={{ color: "#999", fontSize: 8, marginBottom: 3 }}>AVAILABLE ITEMS <span style={{ color: "#555" }}>(use script: v.cmd="craft"; v.craftItem="key")</span></div>
            {availItems.map(([key, def]) => {
              const costOk = Object.entries(def.cost).every(([r, a]) => (stk[r] || 0) >= a);
              return (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2, opacity: costOk ? 1 : 0.4 }}>
                  <span style={{ fontSize: 11 }}>{def.icon}</span>
                  <span style={{ color: "#888", fontSize: 9 }}>{def.label}</span>
                  <span style={{ color: "#555", fontSize: 8, marginLeft: "auto" }}>
                    {Object.entries(def.cost).map(([r,a]) => `${r}:${a}`).join(" ")}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  })() : null;

  // Selected building detail
  const bldDetail = selBld ? (() => {
    const b = selBld;
    const def = b._isTc ? null : BLD[b.type];
    const isTc = b._isTc;
    const maxHp = isTc ? (b.maxHp || 500) : (def?.hp || b.maxHp || 100);
    const hp = b.hp ?? maxHp;
    const hpRatio = Math.max(0, Math.min(1, hp / maxHp));
    const hpColor = hpRatio > 0.5 ? "#4a8" : hpRatio > 0.25 ? "#ca5" : "#c44";
    const isOwn = !b.owner || b.owner === playerId || isTc;
    const costStr = def?.cost ? Object.entries(def.cost).map(([k, v]) => `${k}:${v}`).join(" ") : "";

    return (
      <div style={{ position: "absolute", top: mob ? 50 : 40, left: 8, zIndex: 10, width: 230,
        background: "rgba(0,0,0,0.92)", borderRadius: 4, padding: 8, border: "1px solid #2a3020",
        fontSize: 10, color: "#aaa", pointerEvents: "auto",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <span style={{ color: "#c9a825", fontWeight: "bold", fontSize: 12 }}>
            {isTc ? "🏰" : def?.icon || "?"} {isTc ? "Town Center" : b.type}
          </span>
          <span style={{ color: isOwn ? "#4a8" : "#c44", fontSize: 9, fontWeight: "bold" }}>
            {isOwn ? "YOURS" : (players.find(p => p.id === b.owner)?.name || "ENEMY")}
          </span>
        </div>
        <div style={{ marginBottom: 2 }}>HP: <b>{Math.floor(hp)}/{maxHp}</b></div>
        <div style={{ height: 6, background: "#1a1a1a", borderRadius: 2, marginBottom: 6, overflow: "hidden" }}>
          <div style={{ width: `${hpRatio * 100}%`, height: "100%", background: hpColor, borderRadius: 2 }} />
        </div>
        <div style={{ color: "#888" }}>Pos: ({b.x}, {b.y}){def?.range != null ? ` | Range: ${def.range} DMG: ${def.dmg}` : ""}</div>
        {def?.pop && <div>+{def.pop} population cap</div>}
        {def?.gen && <div>Generates {def.gen} ({def.rate}/tick)</div>}
        {def?.unlocks && <div>Unlocks: <span style={{ color: "#c9a825" }}>{def.unlocks}</span></div>}
        {costStr && <div style={{ color: "#666", marginTop: 2 }}>Cost: {costStr}</div>}
        {!b.built && b.built !== undefined && <div style={{ color: "#ca5" }}>Under construction</div>}
      </div>
    );
  })() : null;

  // Civ panel content
  const stats = ui.stats || {};
  const specCounts = {};
  for (const v of myUnits) { const s = v.spec || "none"; specCounts[s] = (specCounts[s] || 0) + 1; }
  const totalGathered = stats.gathered || { wood: 0, stone: 0, gold: 0, food: 0 };
  const techMap = { warrior_training: "Barracks", tower: "Workshop", trade: "Market" };

  const civContent = (
    <div style={{ color: "#c8c0a8", fontSize: mob ? 12 : 10 }}>
      <div style={{ color: "#c9a825", fontWeight: "bold", marginBottom: 8, fontSize: 13 }}>🏛 CIVILIZATION</div>

      {/* Overview */}
      <div style={{ marginBottom: 8, padding: "6px 8px", background: "rgba(255,255,255,0.03)", borderRadius: 3 }}>
        <div style={{ color: "#999", fontSize: 9, marginBottom: 4 }}>OVERVIEW</div>
        <div>👥 Pop: <b style={{ color: "#c9a825" }}>{myUnits.length}/{ui.myPopCap || 4}</b> 🏠 Buildings: <b>{myBld.length}</b></div>
        <div>⚔ Kills: <b>{stats.kills || 0}</b> 💀 Deaths: <b>{stats.deaths || 0}</b></div>
        <div>📦 Gathered: <b>{Math.floor((totalGathered.wood || 0) + (totalGathered.stone || 0) + (totalGathered.gold || 0) + (totalGathered.food || 0))}</b> T: <b>{ui.tick || 0}</b></div>
      </div>

      {/* Players */}
      <div style={{ marginBottom: 8, padding: "6px 8px", background: "rgba(255,255,255,0.03)", borderRadius: 3 }}>
        <div style={{ color: "#999", fontSize: 9, marginBottom: 4 }}>PLAYERS</div>
        {players.map(p => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2,
            color: p.eliminated ? "#555" : (p.id === playerId ? "#c9a825" : "#aaa"),
          }}>
            <span style={{ color: p.color, fontSize: 12 }}>●</span>
            <span>{p.name}{p.id === playerId ? " (you)" : ""}</span>
            {p.eliminated && <span style={{ color: "#c44", fontSize: 9 }}>ELIMINATED</span>}
          </div>
        ))}
      </div>

      {/* Tech Tree */}
      <div style={{ marginBottom: 8, padding: "6px 8px", background: "rgba(255,255,255,0.03)", borderRadius: 3 }}>
        <div style={{ color: "#999", fontSize: 9, marginBottom: 4 }}>TECH TREE</div>
        {["warrior_training", "tower", "trade"].map(t => {
          const unlocked = (ui.myTech || []).includes(t);
          return (
            <div key={t} style={{ color: unlocked ? "#c9a825" : "#555", marginBottom: 2, display: "flex", gap: 6 }}>
              <span>{unlocked ? "✅" : "🔒"}</span>
              <span>{t.replace(/_/g, " ")}</span>
              <span style={{ color: "#666", fontSize: 9 }}>({techMap[t]})</span>
            </div>
          );
        })}
      </div>

      {/* Specializations */}
      <div style={{ marginBottom: 8, padding: "6px 8px", background: "rgba(255,255,255,0.03)", borderRadius: 3 }}>
        <div style={{ color: "#999", fontSize: 9, marginBottom: 4 }}>SPECIALIZATIONS</div>
        {Object.entries(SP).map(([key, sp]) => {
          const count = specCounts[key] || 0;
          const maxBar = Math.max(myUnits.length, 1);
          return (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
              <span style={{ color: sp.c, width: 14, textAlign: "center" }}>{sp.i}</span>
              <span style={{ width: 70, color: "#aaa" }}>{sp.l}</span>
              <div style={{ flex: 1, height: 6, background: "#1a1a1a", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ width: `${(count / maxBar) * 100}%`, height: "100%", background: sp.c, borderRadius: 2 }} />
              </div>
              <span style={{ color: "#888", width: 16, textAlign: "right" }}>{count}</span>
            </div>
          );
        })}
      </div>

      {/* Your Buildings */}
      <div style={{ marginBottom: 8, padding: "6px 8px", background: "rgba(255,255,255,0.03)", borderRadius: 3 }}>
        <div style={{ color: "#999", fontSize: 9, marginBottom: 4 }}>YOUR BUILDINGS</div>
        {Object.keys(BLD).map(type => {
          const count = myBld.filter(b => b.type === type).length;
          if (count === 0) return null;
          return (
            <div key={type} style={{ color: "#aaa", display: "flex", gap: 6, marginBottom: 2, justifyContent: "space-between" }}>
              <span>{BLD[type].icon} {type}</span><b>x{count}</b>
            </div>
          );
        })}
        {myBld.length === 0 && <div style={{ color: "#555" }}>No buildings yet</div>}
      </div>

      {/* Enemy Intel */}
      <div style={{ marginBottom: 8, padding: "6px 8px", background: "rgba(255,255,255,0.03)", borderRadius: 3 }}>
        <div style={{ color: "#999", fontSize: 9, marginBottom: 4 }}>ENEMY INTEL (scouted)</div>
        {(ui.visibleTownCenters || []).map(tc => {
          const owner = players.find(p => p.id === tc.owner);
          return (
            <div key={tc.id || tc.owner} style={{ color: "#c88", marginBottom: 2 }}>
              Enemy TC{owner ? ` (${owner.name})` : ""} HP: <b>{tc.hp != null ? `${Math.floor(tc.hp)}/${tc.maxHp || 500}` : "?"}</b>
            </div>
          );
        })}
        {(ui.visibleEnemyBuildings || []).length > 0 && (() => {
          const counts = {};
          for (const b of ui.visibleEnemyBuildings) counts[b.type] = (counts[b.type] || 0) + 1;
          return Object.entries(counts).map(([type, count]) => (
            <div key={type} style={{ color: "#a88", display: "flex", justifyContent: "space-between" }}>
              <span>{BLD[type]?.icon || "?"} {type}</span><b>x{count}</b>
            </div>
          ));
        })()}
        {(ui.visibleTownCenters || []).length === 0 && (ui.visibleEnemyBuildings || []).length === 0 &&
          <div style={{ color: "#555" }}>No enemy structures scouted</div>}
      </div>

      {/* Lifetime Gathered */}
      <div style={{ padding: "6px 8px", background: "rgba(255,255,255,0.03)", borderRadius: 3 }}>
        <div style={{ color: "#999", fontSize: 9, marginBottom: 4 }}>LIFETIME GATHERED</div>
        <div style={{ display: "flex", gap: 10 }}>
          <span>🪵 <b style={{ color: "#4a8" }}>{Math.floor(totalGathered.wood || 0)}</b></span>
          <span>🪨 <b style={{ color: "#88a" }}>{Math.floor(totalGathered.stone || 0)}</b></span>
          <span>🪙 <b style={{ color: "#ca5" }}>{Math.floor(totalGathered.gold || 0)}</b></span>
          <span>🍖 <b style={{ color: "#a68" }}>{Math.floor(totalGathered.food || 0)}</b></span>
        </div>
      </div>
    </div>
  );

  // Log content
  const logContent = (
    <div>
      {(ui.log || []).slice().reverse().map((l, i) => (
        <div key={i} style={{
          color: l.includes("⚠") ? "#c44" : l.includes("🏆") ? "#c9a825" : l.includes("⭐") ? "#ffd700" : "#888",
          marginBottom: 1, lineHeight: 1.4, fontSize: mob ? 11 : 9.5,
        }}>{l}</div>
      ))}
    </div>
  );

  // Training controls
  const startTraining = useCallback(async () => {
    try {
      const res = await fetch("/api/training/start", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ populationSize: 30, gamesPerNet: 3, maxTicks: 1000 }),
      });
      const data = await res.json();
      setTrainState(s => ({ ...s, sessionId: data.sessionId, gen: 0, history: [], running: true }));
      runGeneration(data.sessionId);
    } catch (e) { console.error("Training start failed:", e); }
  }, []);

  const runGeneration = useCallback(async (sid) => {
    try {
      const res = await fetch(`/api/training/${sid}/run`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generations: 1 }),
      });
      const data = await res.json();
      setTrainState(s => {
        const hist = [...s.history, ...data.generations];
        const newState = { ...s, gen: hist.length, history: hist, bestWeights: data.bestWeights };
        // Auto-continue if still running
        if (s.running && s.sessionId) setTimeout(() => runGeneration(s.sessionId), 50);
        return newState;
      });
    } catch (e) { console.error("Training generation failed:", e); }
  }, []);

  const stopTraining = useCallback(async () => {
    setTrainState(s => ({ ...s, running: false }));
    if (trainState.sessionId) {
      await fetch(`/api/training/${trainState.sessionId}/stop`, { method: "POST" }).catch(() => {});
    }
  }, [trainState.sessionId]);

  const loadWeightsToScript = useCallback(() => {
    if (!trainState.bestWeights) return;
    const json = JSON.stringify(trainState.bestWeights);
    const insertion = `\n// Trained weights (gen ${trainState.gen})\nconst WEIGHTS = ${json};\n`;
    // Replace the create line with a load line
    const newScript = script.replace(
      /memory\.net = api\.neural\.create\(\)[^;]*;/,
      `memory.net = api.neural.load(WEIGHTS);`
    );
    if (newScript !== script) {
      setScript(insertion + newScript);
    } else {
      setScript(insertion + script);
    }
  }, [trainState.bestWeights, trainState.gen, script]);

  const trainPanel = (
    <div style={{ fontSize: 10, color: "#aaa" }}>
      <div style={{ color: "#c9a825", fontWeight: "bold", fontSize: 11, marginBottom: 8 }}>🧠 Neural Net Training</div>
      <div style={{ marginBottom: 6, color: "#666", fontSize: 9 }}>
        Neuroevolution: populations of neural nets compete, the best survive and breed.
      </div>

      {!trainState.running && !trainState.sessionId && (
        <button onClick={startTraining} style={{ ...btn, background: "#2a4a2a", color: "#8c8", padding: "5px 12px" }}>
          ▶ Start Training (pop=30)
        </button>
      )}

      {trainState.sessionId && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span>Gen: <b style={{ color: "#c9a825" }}>{trainState.gen}</b></span>
            {trainState.running ? (
              <button onClick={stopTraining} style={{ ...btn, color: "#c44" }}>⏹ Stop</button>
            ) : (
              <button onClick={() => { setTrainState(s => ({ ...s, running: true })); runGeneration(trainState.sessionId); }}
                style={{ ...btn, background: "#2a4a2a", color: "#8c8" }}>▶ Resume</button>
            )}
          </div>

          {/* Fitness chart (ASCII sparkline) */}
          {trainState.history.length > 0 && (
            <div style={{ marginBottom: 6, padding: "4px 6px", background: "rgba(255,255,255,0.03)", borderRadius: 3 }}>
              <div style={{ color: "#999", fontSize: 8, marginBottom: 3 }}>FITNESS (best / avg)</div>
              {(() => {
                const h = trainState.history.slice(-20);
                const maxF = Math.max(...h.map(r => r.bestFitness), 1);
                return (
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 1, height: 40 }}>
                    {h.map((r, i) => (
                      <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
                        <div style={{ width: "100%", background: "#c9a825", borderRadius: 1,
                          height: `${(r.bestFitness / maxF) * 36}px`, minHeight: 1 }} />
                        <div style={{ width: "100%", background: "#555", borderRadius: 1,
                          height: `${(r.avgFitness / maxF) * 36}px`, minHeight: 1, marginTop: -Math.floor((r.avgFitness / maxF) * 36) }} />
                      </div>
                    ))}
                  </div>
                );
              })()}
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
                <span style={{ color: "#c9a825", fontSize: 8 }}>Best: {trainState.history.at(-1)?.bestFitness?.toFixed(0)}</span>
                <span style={{ color: "#666", fontSize: 8 }}>Avg: {trainState.history.at(-1)?.avgFitness?.toFixed(0)}</span>
              </div>
            </div>
          )}

          {/* Load weights button */}
          {trainState.bestWeights && (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              <button onClick={loadWeightsToScript} style={{ ...btn, background: "#2a3a4a", color: "#8ac" }}>
                📋 Load Best Weights to Script
              </button>
              <button onClick={() => {
                const blob = new Blob([JSON.stringify(trainState.bestWeights, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a"); a.href = url; a.download = `weights_gen${trainState.gen}.json`;
                a.click(); URL.revokeObjectURL(url);
              }} style={btn}>💾 Export JSON</button>
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 8, color: "#555", fontSize: 8, lineHeight: 1.4 }}>
        Arch: [45→32→16→13] ({45*32+32 + 32*16+16 + 16*13+13} params)<br/>
        45 features (resources, units, threats, tech, phase...)<br/>
        13 outputs (gather priority, build orders, mil ratio, attack, craft)
      </div>
    </div>
  );

  // Script editor
  const scriptEditor = (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: mob ? "8px 12px" : "5px 10px", background: "#1a1e16",
        borderBottom: "1px solid #2a3020", fontSize: mob ? 13 : 11, flexShrink: 0,
      }}>
        <span style={{ color: "#6a6" }}>📜 AI Script</span>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => { setScript(DEFAULT_SCRIPT); }} style={btn}>↺</button>
          <button onClick={compile} style={{ ...btn, background: sErr ? "#533" : "#2a4a2a" }}>▶ Compile</button>
        </div>
      </div>
      {sErr && <div style={{ padding: "6px 12px", background: "#3a1515", color: "#f88", fontSize: 10,
        borderBottom: "1px solid #5a2020", flexShrink: 0 }}>⚠ {sErr}</div>}
      <textarea value={script} onChange={e => setScript(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Tab") {
            e.preventDefault();
            const s = e.target.selectionStart, end = e.target.selectionEnd;
            setScript(script.substring(0, s) + "  " + script.substring(end));
            setTimeout(() => { e.target.selectionStart = e.target.selectionEnd = s + 2; }, 0);
          }
        }}
        spellCheck={false}
        style={{ flex: 1, background: "#0d110d", color: "#a0c898", border: "none",
          padding: mob ? 12 : 10, fontFamily: "'Courier New',monospace",
          fontSize: mob ? 12 : 11, lineHeight: 1.45, resize: "none", outline: "none", tabSize: 2,
        }}
      />
    </>
  );

  // Connection status
  if (!connected && !view) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
        height: "100vh", background: "#0f1410", color: "#888",
        fontFamily: "'Courier New',monospace",
      }}>
        Connecting to game server...
        {error && <div style={{ color: "#f44", marginTop: 8 }}>{error}</div>}
      </div>
    );
  }

  // ─── MOBILE LAYOUT ─────────────────────────────────
  if (mob) {
    const tabBtn = (id, label) => (
      <button key={id} onClick={() => setMTab(id)}
        style={{ ...btn, flex: 1, textAlign: "center", padding: "10px 4px", fontSize: 12,
          background: mTab === id ? "#3a4030" : "#1a1e16",
          color: mTab === id ? "#c9a825" : "#888", borderRadius: 0,
          borderTop: mTab === id ? "2px solid #c9a825" : "2px solid transparent",
        }}>
        {label}
      </button>
    );

    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", width: "100vw",
        background: "#0f1410", color: "#c8c0a8", fontFamily: "'Courier New',monospace",
        overflow: "hidden", position: "relative",
      }}>
        <div style={{ padding: "6px 8px", background: "#1a1e16", borderBottom: "1px solid #2a3020", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ color: "#c9a825", fontWeight: "bold", fontSize: 13 }}>⚔ SCRIPT RTS</span>
            <span style={{ color: "#555", fontSize: 10 }}>T:{ui.tick || 0}</span>
          </div>
          {resBar}
        </div>
        {gameOverOverlay}
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div ref={zoomCanvasRef}
            style={{ position: "relative", overflow: "hidden", touchAction: "none",
            flex: 1, display: mTab === "map" ? "flex" : "none", flexDirection: "column",
          }}
            onMouseDown={onMD} onMouseMove={onMM} onMouseUp={onMU} onMouseLeave={onMU}
            onContextMenu={e => e.preventDefault()}>
            <canvas ref={cvRef} style={{ width: "100%", height: "100%", display: "block", cursor: "grab" }} />
            <canvas ref={mnRef} width={110} height={77} onClick={onMiniClick}
              style={{ position: "absolute", bottom: 4, right: 4, border: "1px solid #3a4030",
                borderRadius: 3, cursor: "crosshair", background: "#080c06", width: 90, height: 63,
              }} />
            {roster}
            {unitDetail}
            {bldDetail}
          </div>
          {mTab === "script" && <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#111611" }}>{scriptEditor}</div>}
          {mTab === "civ" && <div style={{ flex: 1, background: "rgba(0,0,0,0.95)", padding: 12, overflowY: "auto" }}>{civContent}</div>}
          {mTab === "train" && <div style={{ flex: 1, background: "rgba(0,0,0,0.95)", padding: 12, overflowY: "auto" }}>{trainPanel}</div>}
          {mTab === "log" && <div style={{ flex: 1, background: "rgba(0,0,0,0.95)", padding: 12, fontSize: 12, overflowY: "auto" }}>{logContent}</div>}
        </div>
        <div style={{ display: "flex", flexShrink: 0, background: "#1a1e16", borderTop: "1px solid #2a3020" }}>
          {tabBtn("map", "🗺 Map")}
          {tabBtn("script", "📜")}
          {tabBtn("civ", "🏛")}
          {tabBtn("train", "🧠")}
          {tabBtn("log", "📋")}
        </div>
      </div>
    );
  }

  // ─── DESKTOP LAYOUT ────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", width: "100vw",
      background: "#0f1410", color: "#c8c0a8", fontFamily: "'Courier New',monospace",
      overflow: "hidden", position: "relative",
    }}>
      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px",
        background: "#1a1e16", borderBottom: "1px solid #2a3020", fontSize: 11,
        flexShrink: 0, flexWrap: "wrap",
      }}>
        <span style={{ color: "#c9a825", fontWeight: "bold", fontSize: 12 }}>⚔ SCRIPT RTS</span>
        <span style={{ color: "#555", fontSize: 10 }}>T:{ui.tick || 0}</span>
        <span style={{ color: "#333" }}>│</span>
        {resBar}
        <div style={{ flex: 1 }} />
        {/* Player indicators */}
        {players.map(p => (
          <span key={p.id} style={{ color: p.eliminated ? "#555" : p.color, fontSize: 10 }}>
            ●{p.name?.substring(0, 6)}{p.id === playerId ? "*" : ""}
          </span>
        ))}
        <span style={{ color: "#333" }}>│</span>
        <button onClick={() => setShowCiv(s => !s)} style={btn}>🏛Civ</button>
        <button onClick={() => setShowTrain(s => !s)} style={{ ...btn, color: showTrain ? "#c9a825" : "#a8a890" }}>🧠Train</button>
        <button onClick={() => setShowLog(s => !s)} style={btn}>Log</button>
        <button onClick={() => setShowS(s => !s)} style={btn}>{showS ? "◀" : "▶"}Script</button>
        <button onClick={onLeave} style={{ ...btn, color: "#c44" }}>✕</button>
      </div>

      {gameOverOverlay}

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Canvas area */}
        <div ref={zoomCanvasRef}
          style={{ position: "relative", overflow: "hidden", touchAction: "none", flex: 1 }}
          onMouseDown={onMD} onMouseMove={onMM} onMouseUp={onMU} onMouseLeave={onMU}
          onContextMenu={e => e.preventDefault()}>
          <canvas ref={cvRef} style={{ width: "100%", height: "100%", display: "block", cursor: "grab" }} />
          <canvas ref={mnRef} width={150} height={105} onClick={onMiniClick}
            style={{ position: "absolute", bottom: 8, right: 8, border: "1px solid #3a4030",
              borderRadius: 3, cursor: "crosshair", background: "#080c06", width: 150, height: 105,
            }} />
          {roster}
          {unitDetail}
          {bldDetail}
        </div>

        {/* Floating overlays */}
        {showCiv && (
          <div style={{ position: "absolute", top: 40, left: 8, zIndex: 10, width: 260, maxHeight: "75%",
            background: "rgba(0,0,0,0.92)", borderRadius: 4, padding: 10, overflowY: "auto",
            border: "1px solid #2a3020", pointerEvents: "auto",
          }}>{civContent}</div>
        )}
        {showTrain && (
          <div style={{ position: "absolute", top: 40, left: 280, zIndex: 10, width: 280, maxHeight: "75%",
            background: "rgba(0,0,0,0.92)", borderRadius: 4, padding: 10, overflowY: "auto",
            border: "1px solid #2a3020", pointerEvents: "auto",
          }}>{trainPanel}</div>
        )}
        {showLog && (
          <div style={{ position: "absolute", top: 40, right: showS ? 408 : 8, zIndex: 10, width: 250, maxHeight: "50%",
            background: "rgba(0,0,0,0.92)", borderRadius: 4, padding: 6, overflowY: "auto",
            border: "1px solid #2a3020", pointerEvents: "auto",
          }}>{logContent}</div>
        )}

        {/* Script panel */}
        {showS && (
          <div style={{ width: 390, flexShrink: 0, display: "flex", flexDirection: "column",
            borderLeft: "1px solid #2a3020", background: "#111611",
          }}>{scriptEditor}</div>
        )}
      </div>
    </div>
  );
}
