// ═══════════════════════════════════════════════════════════════════════════
//  BOT PLAYER AI
// ═══════════════════════════════════════════════════════════════════════════

import { MW, MH, D, ri, pk, cl } from "./constants.js";
import { BLD } from "./buildings.js";
import { mkVillager, mkEnemy, ET } from "./units.js";
import { astar } from "./pathfinding.js";

/**
 * Run bot AI for one player. Mutates the player and state.
 * @param {import('./types.js').Player} player - the bot player
 * @param {import('./types.js').GameState} state - full game state
 * @param {Uint8Array[]} grid - pathfinding grid
 */
export function tickBotPlayer(player, state, grid) {
  const tick = state.tick;

  // Passive resource generation (simplified economy)
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

  // Find a free spot near TC for placing a building
  const findSpot = (sz, range) => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const bx = cl(player.tc.x + ri(-range, range), 2, MW - 3);
      const by = cl(player.tc.y + ri(-range, range), 2, MH - 3);
      let blocked = false;
      // Check TC overlap (3x3)
      if (Math.abs(bx - player.tc.x) < sz + 1 && Math.abs(by - player.tc.y) < sz + 1) continue;
      // Check existing buildings from all players
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

  // Auto-build with smart progression
  const builtOf = (type) => player.buildings.filter(b => b.type === type && b.built).length;
  const stk = player.stockpile;

  const tryBuild = (type) => {
    const bd = BLD[type];
    if (!bd) return false;
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
    // Priority build order for bot
    if (builtOf("farm") < 1) tryBuild("farm");
    else if (builtOf("barracks") < 1) tryBuild("barracks");
    else if (pop >= popCap - 1 && builtOf("house") < 5) tryBuild("house");
    else if (builtOf("workshop") < 1 && builtOf("barracks") >= 1) tryBuild("workshop");
    else if (builtOf("farm") < Math.ceil(pop / 5) && builtOf("farm") < 4) tryBuild("farm");
    else if (builtOf("market") < 1 && builtOf("workshop") >= 1) tryBuild("market");
    else if (builtOf("tower") < 2 && builtOf("workshop") >= 1) tryBuild("tower");
    else if (builtOf("barracks") < 2 && pop >= 10) tryBuild("barracks");
    else if (pop >= popCap - 1 && builtOf("house") < 6) tryBuild("house");
  }

  // Farm income
  player.buildings.forEach(b => {
    if (b.type === "farm" && b.built) player.stockpile.food += 0.15;
  });

  // Villager gathering AI
  for (const ev of player.units) {
    if (!ev.alive || ev.raiding) continue;
    if (ev.carry >= 8) {
      // Return to TC
      if (D(ev, player.tc) <= 2) {
        ev.carry = 0;
        ev.carryType = null;
      } else {
        const n = astar(ev.x, ev.y, player.tc.x, player.tc.y, grid, 80);
        if (n) { ev.x = n.x; ev.y = n.y; }
      }
    } else {
      // Find nearby resource
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

  // Send raids — escalating, targeting other players
  const raidInterval = Math.max(80, 260 - tick * 0.2);
  if (tick > 100 && tick % Math.floor(raidInterval) === 0) {
    const wave = Math.floor(tick / 200);
    const count = Math.min(8, 1 + wave + ri(0, 2));
    const pool = ["raider"];
    if (wave >= 1) pool.push("scout", "scout");
    if (wave >= 2) pool.push("archer");
    if (wave >= 3) pool.push("brute");

    // Find a random opposing player to target
    const opponents = state.players.filter(p => p.id !== player.id && !p.eliminated);
    if (opponents.length > 0) {
      const target = pk(opponents);
      for (let i = 0; i < count; i++) {
        const e = mkEnemy(pk(pool), player.tc.x + ri(-3, 3), player.tc.y + ri(-3, 3), state);
        // Tag enemy with target info
        e.targetPlayerId = target.id;
        state.enemies.push(e);
      }
      state.log.push(`[${tick}] ⚠ Raid! ${count} enemies from ${player.name}`);
    }
  }

  // Tower attacks against visible enemies from other players
  for (const b of player.buildings) {
    if (b.type === "tower" && b.built && tick % 3 === 0) {
      // Gather all enemy units from other players
      const enemyUnits = [];
      for (const other of state.players) {
        if (other.id === player.id || other.eliminated) continue;
        for (const u of other.units) {
          if (u.alive && D(u, b) <= BLD.tower.range) enemyUnits.push(u);
        }
      }
      if (enemyUnits.length > 0) {
        const target = enemyUnits[0];
        target.hp -= BLD.tower.dmg;
        if (target.hp <= 0) {
          target.alive = false;
          state.log.push(`[${tick}] ☠ #${target.id} killed by ${player.name}'s tower`);
        }
      }
    }
  }
}
