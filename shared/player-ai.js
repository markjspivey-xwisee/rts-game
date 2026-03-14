// ═══════════════════════════════════════════════════════════════════════════
//  BOT PLAYER AI (with ages, formations, naval, relics)
// ═══════════════════════════════════════════════════════════════════════════

import { MW, MH, D, ri, pk, cl, AGE_ORDER, AGE_COSTS } from "./constants.js";
import { BLD } from "./buildings.js";
import { mkVillager, mkEnemy, mkNavalUnit, ET, NAVAL } from "./units.js";
import { astar } from "./pathfinding.js";

/**
 * Run bot AI for one player. Mutates the player and state.
 */
export function tickBotPlayer(player, state, grid) {
  const tick = state.tick;

  // Passive resource generation
  player.stockpile.wood += 0.5 + tick * 0.002;
  player.stockpile.stone += 0.2 + tick * 0.001;
  player.stockpile.food += 0.4 + tick * 0.001;
  player.stockpile.gold += 0.05;

  // Spawn bot villagers
  const aliveUnits = player.units.filter(v => v.alive);
  const pop = aliveUnits.length;
  const popCap = 4 + player.buildings.filter(b => b.type === "house" && b.built).length * 4;
  player.popCap = popCap;

  if (tick % 60 === 0 && pop < popCap && player.stockpile.food >= 20) {
    player.stockpile.food -= 20;
    const ev = mkVillager(player.tc.x + ri(-1, 1), player.tc.y + ri(-1, 1), player.id, state);
    ev.enemy = true;
    player.units.push(ev);
  }

  // Age advancement
  if (tick % 100 === 0 && !player.ageProgress) {
    const idx = AGE_ORDER.indexOf(player.age || "dark");
    if (idx < AGE_ORDER.length - 1) {
      const nextAge = AGE_ORDER[idx + 1];
      const cost = AGE_COSTS[nextAge];
      let canAdvance = true;
      for (const [r, a] of Object.entries(cost)) {
        if ((player.stockpile[r] || 0) < a * 1.2) canAdvance = false; // keep some buffer
      }
      if (canAdvance) {
        player._pendingCmds = player._pendingCmds || [];
        player._pendingCmds.push({ cmd: "advance_age" });
      }
    }
  }

  // Find a free spot near TC
  const findSpot = (sz, range) => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const bx = cl(player.tc.x + ri(-range, range), 2, MW - 3);
      const by = cl(player.tc.y + ri(-range, range), 2, MH - 3);
      if (Math.abs(bx - player.tc.x) < sz + 1 && Math.abs(by - player.tc.y) < sz + 1) continue;
      let blocked = false;
      for (const p of state.players) {
        for (const eb of p.buildings) {
          const esz = BLD[eb.type]?.size || 1;
          if (bx < eb.x + esz && bx + sz > eb.x && by < eb.y + esz && by + sz > eb.y) { blocked = true; break; }
        }
        if (blocked) break;
      }
      if (!blocked) return { x: bx, y: by };
    }
    return null;
  };

  // Auto-build with smart progression + age awareness
  const builtOf = (type) => player.buildings.filter(b => b.type === type && b.built).length;
  const stk = player.stockpile;
  const age = player.age || "dark";
  const ageIdx = AGE_ORDER.indexOf(age);

  const tryBuild = (type) => {
    const bd = BLD[type];
    if (!bd) return false;
    // Check age requirement
    if (bd.age) {
      const bldAgeIdx = AGE_ORDER.indexOf(bd.age);
      if (bldAgeIdx > ageIdx) return false;
    }
    const cost = bd.cost;
    if (!Object.entries(cost).every(([r, a]) => (stk[r] || 0) >= a)) return false;
    const spot = findSpot(bd.size || 2, 6);
    if (!spot) return false;
    Object.entries(cost).forEach(([r, a]) => { stk[r] -= a; });
    player.buildings.push({
      id: state.nextUid++, type,
      x: spot.x, y: spot.y,
      hp: bd.hp, maxHp: bd.hp, built: true,
    });
    return true;
  };

  if (tick % 60 === 0) {
    // Dark Age priorities
    if (builtOf("farm") < 1) tryBuild("farm");
    else if (builtOf("barracks") < 1) tryBuild("barracks");
    else if (pop >= popCap - 1 && builtOf("house") < 5) tryBuild("house");
    // Feudal Age buildings
    else if (builtOf("workshop") < 1 && builtOf("barracks") >= 1) tryBuild("workshop");
    else if (builtOf("farm") < Math.ceil(pop / 5) && builtOf("farm") < 4) tryBuild("farm");
    else if (builtOf("market") < 1 && builtOf("workshop") >= 1) tryBuild("market");
    else if (builtOf("stable") < 1 && builtOf("workshop") >= 1) tryBuild("stable");
    else if (builtOf("tower") < 2 && builtOf("workshop") >= 1) tryBuild("tower");
    // Castle Age buildings
    else if (builtOf("temple") < 1 && ageIdx >= 2) tryBuild("temple");
    else if (builtOf("castle_tower") < 1 && ageIdx >= 2 && builtOf("workshop") >= 1) tryBuild("castle_tower");
    else if (builtOf("barracks") < 2 && pop >= 10) tryBuild("barracks");
    else if (pop >= popCap - 1 && builtOf("house") < 6) tryBuild("house");
    // Walls around TC
    else if (builtOf("wall") < 4 && tick > 200) tryBuild("wall");
  }

  // Train naval units if dock exists
  if (tick % 120 === 0 && builtOf("dock") > 0) {
    const navalCount = (player.navalUnits || []).filter(n => n.alive).length;
    if (navalCount < 3 && stk.wood >= 80 && stk.gold >= 40) {
      const type = navalCount === 0 ? "fishing_boat" : "warship";
      const def = NAVAL[type];
      if (def) {
        let ok = true;
        for (const [r, a] of Object.entries(def.cost)) {
          if ((stk[r] || 0) < a) ok = false;
        }
        if (ok) {
          for (const [r, a] of Object.entries(def.cost)) stk[r] -= a;
          const dock = player.buildings.find(b => b.type === "dock" && b.built);
          if (dock) {
            const nu = mkNavalUnit(type, dock.x, dock.y, player.id, state);
            if (!player.navalUnits) player.navalUnits = [];
            player.navalUnits.push(nu);
          }
        }
      }
    }
  }

  // Farm income
  player.buildings.forEach(b => {
    if (b.type === "farm" && b.built) player.stockpile.food += 0.15;
  });

  // Villager gathering AI
  for (const ev of player.units) {
    if (!ev.alive || ev.raiding) continue;
    if (ev.carry >= 8) {
      if (D(ev, player.tc) <= 2) {
        ev.carry = 0;
        ev.carryType = null;
      } else {
        const n = astar(ev.x, ev.y, player.tc.x, player.tc.y, grid, 80);
        if (n) { ev.x = n.x; ev.y = n.y; }
      }
    } else {
      const nr = state.resources
        .filter(r => r.amount > 0 && D(r, player.tc) < 18)
        .sort((a, b) => D(a, ev) - D(b, ev))[0];
      if (nr) {
        if (D(ev, nr) <= 1) {
          const a = Math.min(2, nr.amount);
          nr.amount -= a;
          ev.carry += a;
          ev.carryType = nr.type;
        } else {
          const n = astar(ev.x, ev.y, nr.x, nr.y, grid, 80);
          if (n) { ev.x = n.x; ev.y = n.y; }
        }
      }
    }
  }

  // Send raids
  const raidInterval = Math.max(80, 260 - tick * 0.2);
  if (tick > 100 && tick % Math.floor(raidInterval) === 0) {
    const wave = Math.floor(tick / 200);
    const count = Math.min(8, 1 + wave + ri(0, 2));
    const pool = ["raider"];
    if (wave >= 1) pool.push("scout", "scout");
    if (wave >= 2) pool.push("archer");
    if (wave >= 3) pool.push("brute");

    const opponents = state.players.filter(p => p.id !== player.id && !p.eliminated);
    if (opponents.length > 0) {
      const target = pk(opponents);
      for (let i = 0; i < count; i++) {
        const e = mkEnemy(pk(pool), player.tc.x + ri(-3, 3), player.tc.y + ri(-3, 3), state);
        e.targetPlayerId = target.id;
        state.enemies.push(e);
      }
      state.log.push(`[${tick}] ⚠ Raid! ${count} enemies from ${player.name}`);
    }
  }

  // Tower attacks
  for (const b of player.buildings) {
    if ((b.type === "tower" || b.type === "castle_tower") && b.built && tick % 3 === 0) {
      const towerDef = BLD[b.type];
      if (!towerDef?.range) continue;
      const enemyUnits = [];
      for (const other of state.players) {
        if (other.id === player.id || other.eliminated) continue;
        for (const u of other.units) {
          if (u.alive && D(u, b) <= towerDef.range) enemyUnits.push(u);
        }
      }
      if (enemyUnits.length > 0) {
        const target = enemyUnits[0];
        target.hp -= towerDef.dmg;
        if (target.hp <= 0) {
          target.alive = false;
          state.log.push(`[${tick}] ☠ #${target.id} killed by ${player.name}'s tower`);
        }
      }
    }
  }
}
