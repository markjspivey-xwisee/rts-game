// ═══════════════════════════════════════════════════════════════════════════
//  N-PLAYER GAME TICK (with ages, formations, naval, relics, diplomacy)
// ═══════════════════════════════════════════════════════════════════════════

import {
  MW, MH, D, cl, ri, pk,
  FOG_VIS, TERRAIN_WATER, TERRAIN_BRIDGE, TICK_MS,
  AGE_ORDER, AGE_COSTS, AGE_TIME, AGES,
  FORMATIONS, PROMOTIONS, PROMO_ORDER, DIPLO,
} from "./constants.js";
import { BLD, getTech } from "./buildings.js";
import { SP, ET, mkVillager, mkEnemy, mkVehicle, mkNavalUnit, VEHICLE_TYPES, NAVAL, calcSpec, applySpec, decayXP, getPromotion } from "./units.js";
import { ITEMS, getEquipBonuses } from "./items.js";
import { astar, buildGrid, buildWaterGrid } from "./pathfinding.js";
import { updFog } from "./fog.js";
import { tickBotPlayer } from "./player-ai.js";

function getEnemyUnits(s, playerId) {
  const units = [];
  for (const p of s.players) {
    if (p.id === playerId || p.eliminated) continue;
    // Check diplomacy
    const rel = s.diplomacy?.[playerId]?.[p.id] ?? DIPLO.enemy;
    if (rel === DIPLO.ally) continue; // allies are not enemies
    for (const u of p.units) {
      if (u.alive) units.push(u);
    }
  }
  return units;
}

function getEnemyTCs(s, playerId) {
  return s.players
    .filter(p => {
      if (p.id === playerId || p.eliminated || p.tc.hp <= 0) return false;
      const rel = s.diplomacy?.[playerId]?.[p.id] ?? DIPLO.enemy;
      return rel !== DIPLO.ally;
    })
    .map(p => ({ ...p.tc, ownerId: p.id }));
}

/**
 * Main game tick. Advances the game state by one tick.
 */
export function tickGame(gs) {
  if (gs.gameOver || gs.paused) return gs;

  // Deep-copy mutable state
  const s = {
    ...gs,
    tick: gs.tick + 1,
    resources: gs.resources.map(r => ({ ...r })),
    horses: (gs.horses || []).map(h => ({ ...h })),
    relics: (gs.relics || []).map(r => ({ ...r })),
    enemies: gs.enemies.map(e => ({ ...e })),
    log: [...gs.log],
    particles: gs.particles
      .filter(p => p.life > 0)
      .map(p => ({ ...p, life: p.life - 1, y: p.y - 0.3, alpha: p.life / p.ml })),
    players: gs.players.map(p => ({
      ...p,
      tc: { ...p.tc },
      units: p.units.map(v => ({ ...v, xp: { ...v.xp }, equip: { ...(v.equip || {}) } })),
      buildings: p.buildings.map(b => ({ ...b })),
      vehicles: (p.vehicles || []).map(v => ({ ...v })),
      navalUnits: (p.navalUnits || []).map(n => ({ ...n, passengers: [...(n.passengers || [])] })),
      stockpile: { ...p.stockpile },
      fog: p.fog.map(r => new Uint8Array(r)),
      stats: {
        ...p.stats,
        gathered: { ...p.stats.gathered },
        specLevels: { ...p.stats.specLevels },
        promotions: { ...(p.stats.promotions || {}) },
      },
      buildQueue: (p.buildQueue || []).map(q => ({ ...q })),
      memory: p.memory,
      ageProgress: p.ageProgress ? { ...p.ageProgress } : null,
      _pendingCmds: [],
    })),
    nextUid: gs.nextUid,
    diplomacy: JSON.parse(JSON.stringify(gs.diplomacy || {})),
  };

  const addP = (x, y, txt, c, life = 15) =>
    s.particles.push({ x, y, txt, c, life, ml: life, alpha: 1 });

  // ─── PER-PLAYER UPDATES ────────────────────────────────────
  for (const player of s.players) {
    if (player.eliminated) continue;

    const aliveUnits = player.units.filter(v => v.alive);
    const pop = aliveUnits.length;

    // Pop cap from houses
    player.popCap = 4 + player.buildings.filter(b => b.type === "house" && b.built).length * 4;

    // Passive income from buildings
    for (const b of player.buildings) {
      if (!b.built) continue;
      if (b.type === "farm") player.stockpile.food += BLD.farm.rate;
      if (b.type === "market") player.stockpile.gold += 0.08;
    }

    // Relic income (gold for housed relics)
    let relicGold = 0;
    for (const r of s.relics) {
      if (r.owner === player.id && r.housed) {
        relicGold += r.goldRate;
      }
    }
    player.stockpile.gold += relicGold;
    player.relicCount = s.relics.filter(r => r.owner === player.id && r.housed).length;

    // Stable produces tamed horses every 120 ticks
    if (s.tick % 120 === 0) {
      for (const b of player.buildings) {
        if (b.type === "stable" && b.built) {
          const ownedHorses = (s.horses || []).filter(h => h.alive && h.owner === player.id && !h.riderId);
          if (ownedHorses.length < 4) {
            s.horses.push({
              id: s.nextUid++,
              x: b.x + ri(-1, 1), y: b.y + ri(-1, 1),
              hp: 20, maxHp: 20,
              alive: true, tamed: true,
              riderId: null, owner: player.id,
              wanderCd: 0,
            });
            s.log.push(`[${s.tick}] 🐴 ${player.name}: Horse bred at stable`);
          }
        }
      }
    }

    // Age advancement progress
    if (player.ageProgress) {
      player.ageProgress.progress++;
      if (player.ageProgress.progress >= player.ageProgress.needed) {
        player.age = player.ageProgress.targetAge;
        player.ageProgress = null;
        const ageInfo = AGES[player.age];
        s.log.push(`[${s.tick}] ${ageInfo.icon} ${player.name} advanced to ${ageInfo.name}!`);
        addP(player.tc.x, player.tc.y, ageInfo.icon + " " + ageInfo.name, ageInfo.color, 30);
      }
    }

    // Process pending commands (age advance, tribute, diplomacy, naval)
    for (const cmd of (player._pendingCmds || [])) {
      if (cmd.cmd === "advance_age") {
        const idx = AGE_ORDER.indexOf(player.age);
        if (idx < AGE_ORDER.length - 1 && !player.ageProgress) {
          const nextAge = AGE_ORDER[idx + 1];
          const cost = AGE_COSTS[nextAge];
          let ok = true;
          for (const [r, a] of Object.entries(cost)) {
            if ((player.stockpile[r] || 0) < a) ok = false;
          }
          if (ok) {
            for (const [r, a] of Object.entries(cost)) player.stockpile[r] -= a;
            player.ageProgress = { targetAge: nextAge, progress: 0, needed: AGE_TIME[nextAge] };
            s.log.push(`[${s.tick}] ${AGES[nextAge].icon} ${player.name} advancing to ${AGES[nextAge].name}...`);
          }
        }
      }
      if (cmd.cmd === "tribute") {
        const target = s.players.find(p => p.id === cmd.targetPlayerId);
        if (target && cmd.resource && cmd.amount > 0 && (player.stockpile[cmd.resource] || 0) >= cmd.amount) {
          player.stockpile[cmd.resource] -= cmd.amount;
          target.stockpile[cmd.resource] = (target.stockpile[cmd.resource] || 0) + Math.floor(cmd.amount * 0.75); // 25% tax
          s.log.push(`[${s.tick}] 💰 ${player.name} tributed ${cmd.amount} ${cmd.resource} to ${target.name}`);
        }
      }
      if (cmd.cmd === "set_diplomacy") {
        const targetId = cmd.targetPlayerId;
        const status = cmd.status; // 0=enemy, 1=neutral, 2=ally
        if (s.diplomacy[player.id] && targetId !== player.id) {
          s.diplomacy[player.id][targetId] = status;
          const statusName = ["Enemy", "Neutral", "Ally"][status] || "Unknown";
          s.log.push(`[${s.tick}] 🤝 ${player.name} set ${statusName} with ${targetId}`);
        }
      }
      if (cmd.cmd === "train_naval") {
        const def = NAVAL[cmd.navalType];
        if (def && player.buildings.some(b => b.type === "dock" && b.built)) {
          let ok = true;
          for (const [r, a] of Object.entries(def.cost)) {
            if ((player.stockpile[r] || 0) < a) ok = false;
          }
          if (ok) {
            for (const [r, a] of Object.entries(def.cost)) player.stockpile[r] -= a;
            const dock = player.buildings.find(b => b.type === "dock" && b.built);
            const nu = mkNavalUnit(cmd.navalType, dock.x, dock.y, player.id, s);
            player.navalUnits.push(nu);
            s.log.push(`[${s.tick}] ${def.icon} ${player.name}: ${def.label} trained!`);
          }
        }
      }
    }
    player._pendingCmds = [];

    // Food upkeep
    player.stockpile.food -= pop * 0.04;
    if (player.stockpile.food < 0) {
      player.stockpile.food = 0;
      for (const v of aliveUnits) v.hp -= 0.5;
      if (s.tick % 30 === 0) {
        s.log.push(`[${s.tick}] ⚠ ${player.name}: Starvation!`);
      }
    }

    // Building decay every 100 ticks
    if (s.tick % 100 === 0) {
      for (const b of player.buildings) {
        if (b.built && b.hp > 1) b.hp -= 1;
      }
    }

    // Spawn villager (non-bot players)
    if (player.type !== "bot") {
      if (s.tick % 55 === 0 && player.stockpile.food >= 30 && pop < player.popCap) {
        player.stockpile.food -= 30;
        const nv = mkVillager(player.tc.x + ri(-1, 1), player.tc.y + ri(-1, 1), player.id, s);
        player.units.push(nv);
        s.log.push(`[${s.tick}] 👤 ${player.name}: Villager #${nv.id} born`);
      }
    }

    player.stats.maxPop = Math.max(player.stats.maxPop, aliveUnits.length);

    // XP decay
    if (s.tick % 10 === 0) {
      for (const v of aliveUnits) decayXP(v);
    }

    // Milestone announcements + promotion tracking
    for (const v of player.units) {
      if (!v.alive) continue;
      const { s: spec, lv } = calcSpec(v);
      const prevLv = player.stats.specLevels[v.id] || 0;
      if (lv > prevLv && lv >= 1) {
        s.log.push(`[${s.tick}] ⭐ ${player.name} #${v.id} reached ${SP[spec]?.l} L${lv}!`);
        player.stats.specLevels[v.id] = lv;
        if (lv === 3) addP(v.x, v.y, "✦ ABILITY", "#ffd700", 25);
      }
      // Promotion check
      const promo = getPromotion(v);
      const prevPromo = player.stats.promotions[v.id] || "recruit";
      if (promo !== prevPromo && PROMO_ORDER.indexOf(promo) > PROMO_ORDER.indexOf(prevPromo)) {
        const pi = PROMOTIONS[promo];
        s.log.push(`[${s.tick}] ${pi.icon} ${player.name} #${v.id} promoted to ${pi.label}!`);
        player.stats.promotions[v.id] = promo;
        addP(v.x, v.y, pi.icon + " " + pi.label, "#ffd700", 20);
      }
    }

    // Wonder win condition: if wonder built for 300 ticks
    const wonder = player.buildings.find(b => b.type === "wonder" && b.built);
    if (wonder) {
      if (!wonder.wonderTimer) wonder.wonderTimer = 0;
      wonder.wonderTimer++;
      if (wonder.wonderTimer >= 300 && !s.gameOver) {
        s.gameOver = true;
        s.winner = player.id;
        s.log.push(`[${s.tick}] 🏛 ${player.name} wins by Wonder!`);
      }
    }
  }

  // ─── GLOBAL: RESOURCE REGROWTH ─────────────────────────────
  if (s.tick % 20 === 0) {
    for (const r of s.resources) {
      if (r.rg > 0 && r.amount > 0 && r.amount < r.maxAmt) {
        r.amount = Math.min(r.maxAmt, r.amount + r.rg * 20);
      }
    }
  }

  // ─── BOT PLAYER AI ─────────────────────────────────────────
  const grid = buildGrid(s);
  for (const player of s.players) {
    if (player.eliminated) continue;
    if (player.type === "bot") {
      tickBotPlayer(player, s, grid);
    }
  }

  // ─── PROCESS UNIT COMMANDS (non-bot players) ───────────────
  for (const player of s.players) {
    if (player.eliminated || player.type === "bot") continue;

    const tech = getTech(player.buildings);
    const allEnemyUnits = getEnemyUnits(s, player.id);
    const enemyTCs = getEnemyTCs(s, player.id);

    for (const v of player.units) {
      if (!v.alive) continue;
      if (v.atkCd > 0) v.atkCd--;
      if (v.abCd > 0) v.abCd--;

      // Formation combat bonus
      const formation = FORMATIONS[v.formation] || FORMATIONS.none;

      const mv = (tx, ty) => {
        const n = astar(v.x, v.y, tx, ty, grid, 150);
        if (n) {
          v.x = n.x; v.y = n.y;
          // Mounted units move a second step (2x speed)
          if (v.mounted && (v.x !== tx || v.y !== ty)) {
            const n2 = astar(v.x, v.y, tx, ty, grid, 80);
            if (n2) { v.x = n2.x; v.y = n2.y; }
          }
          // Update horse position to follow rider
          if (v.mounted) {
            const horse = (s.horses || []).find(h => h.id === v.mounted);
            if (horse) { horse.x = v.x; horse.y = v.y; }
          }
          // Update vehicle position to follow crew
          if (v.crewing) {
            const veh = (player.vehicles || []).find(vh => vh.id === v.crewing);
            if (veh) { veh.x = v.x; veh.y = v.y; }
          }
        }
      };

      // ── ABILITY ──
      if (v.cmd === "ability" && v.specLv >= 3 && v.abCd <= 0) {
        v.abCd = 40;
        if (v.spec === "warrior") {
          let h = 0;
          for (const e of [...allEnemyUnits, ...s.enemies]) {
            if (e.alive !== false && D(e, v) <= 2) {
              e.hp -= v.dmg * 1.5; h++;
              if (e.hp <= 0) { e.alive = false; v.xp.combat += 5; player.stats.kills++; }
            }
          }
          addP(v.x, v.y, `💥x${h}`, "#f44", 20);
          v.xp.combat += 3;
        } else if (v.spec === "farmer") {
          s.resources.push({
            id: s.nextUid++, type: "food", x: v.x, y: v.y,
            amount: 60, maxAmt: 120, rg: 0.04,
          });
          addP(v.x, v.y, "🌱", "#4a4", 20);
          v.xp.food += 3;
        } else if (v.spec === "builder") {
          const dmgd = player.buildings
            .filter(b => b.built && b.hp < (BLD[b.type]?.hp || 100))
            .sort((a, b) => D(a, v) - D(b, v))[0];
          if (dmgd) {
            dmgd.hp = Math.min(BLD[dmgd.type]?.hp || 100, dmgd.hp + 25);
            addP(dmgd.x, dmgd.y, "🔧+25", "#4a8", 20);
          } else if (player.tc.hp < player.tc.maxHp) {
            player.tc.hp = Math.min(player.tc.maxHp, player.tc.hp + 25);
            addP(player.tc.x, player.tc.y, "🔧+25", "#4a8", 20);
          }
          v.xp.build += 3;
        } else if (v.spec === "miner") {
          addP(v.x, v.y, "🔍", "#ca5", 20);
          for (let dy = -8; dy <= 8; dy++) {
            for (let dx = -8; dx <= 8; dx++) {
              const fx = v.x + dx, fy = v.y + dy;
              if (fx >= 0 && fx < MW && fy >= 0 && fy < MH) player.fog[fy][fx] = FOG_VIS;
            }
          }
          v.xp.stone += 2; v.xp.gold += 2;
        } else if (v.spec === "lumberjack") {
          const tree = s.resources.find(r => r.type === "wood" && r.amount > 0 && D(r, v) <= 1);
          if (tree) {
            const a = Math.min(Math.ceil(6 * v.gSpd), tree.amount);
            tree.amount -= a; v.carry += a; v.carryType = "wood";
            addP(v.x, v.y, "🪓x3", "#4a8", 20);
          }
          v.xp.wood += 3;
        }
        applySpec(v); v.cmd = "idle"; continue;
      }

      // ── GATHER ──
      if (v.cmd === "gather" && v.targetId != null) {
        if (v.carry >= v.maxCarry) {
          if (D(v, player.tc) <= 2) {
            player.stockpile[v.carryType] = (player.stockpile[v.carryType] || 0) + v.carry;
            player.stats.gathered[v.carryType] = (player.stats.gathered[v.carryType] || 0) + v.carry;
            v.carry = 0; v.carryType = null;
          } else {
            mv(player.tc.x, player.tc.y);
          }
        } else {
          const r = s.resources.find(r => r.id === v.targetId && r.amount > 0);
          if (r) {
            if (D(v, r) <= 1) {
              const a = Math.min(Math.ceil(2 * v.gSpd), r.amount, v.maxCarry - v.carry);
              r.amount -= a; v.carry += a; v.carryType = r.type;
              v.xp[r.type] = (v.xp[r.type] || 0) + 1;
              applySpec(v);
            } else {
              mv(r.x, r.y);
            }
          } else {
            v.cmd = "idle";
          }
        }
      }
      // ── ATTACK ──
      else if (v.cmd === "attack" && v.targetId != null) {
        const atkR = v.atkRange || 1;
        const tgt = [...allEnemyUnits, ...s.enemies].find(e => e.id === v.targetId && e.alive !== false);
        if (tgt) {
          if (D(v, tgt) <= atkR) {
            if (v.atkCd <= 0) {
              const dr = tgt.dmgReduce || 0;
              const fDmg = Math.max(1, v.dmg * formation.dmgMult - dr - (formation.dmgReduce || 0));
              tgt.hp -= fDmg; v.atkCd = 3; v.xp.combat += 2; applySpec(v);
              if (tgt.hp <= 0) {
                tgt.alive = false; v.xp.combat += 5; applySpec(v);
                addP(tgt.x, tgt.y, "☠", "#f44");
                player.stats.kills++;
              }
            }
          } else {
            mv(tgt.x, tgt.y);
          }
        } else {
          const nearTC = enemyTCs.filter(tc => tc.hp > 0).sort((a, b) => D(a, v) - D(b, v))[0];
          const siegeR = Math.max(2, atkR);
          if (nearTC && D(v, nearTC) <= siegeR) {
            if (v.atkCd <= 0) {
              const totalDmg = v.dmg + (v.siegeDmg || 0);
              nearTC.hp -= totalDmg; v.atkCd = 3; v.xp.combat += 2; applySpec(v);
              addP(nearTC.x, nearTC.y, `-${Math.floor(totalDmg)}`, "#f88", 10);
              const tcOwner = s.players.find(p => p.id === nearTC.ownerId);
              if (tcOwner) tcOwner.tc.hp = nearTC.hp;
            }
          } else if (nearTC) {
            mv(nearTC.x, nearTC.y);
          }
        }
      }
      // ── MOVE TO ──
      else if (v.cmd === "moveTo" && v.moveX != null) {
        let attackedTC = false;
        const siegeR = Math.max(2, v.atkRange || 1);
        for (const etc of enemyTCs) {
          if (D(v, etc) <= siegeR && etc.hp > 0 &&
              Math.abs(v.moveX - etc.x) <= 1 && Math.abs(v.moveY - etc.y) <= 1) {
            if (v.atkCd <= 0) {
              const totalDmg = v.dmg + (v.siegeDmg || 0);
              etc.hp -= totalDmg; v.atkCd = 3; v.xp.combat += 2;
              addP(etc.x, etc.y, `-${Math.floor(totalDmg)}`, "#f88", 10);
              const tcOwner = s.players.find(p => p.id === etc.ownerId);
              if (tcOwner) tcOwner.tc.hp = etc.hp;
            }
            attackedTC = true;
            break;
          }
        }
        if (!attackedTC && (v.x !== v.moveX || v.y !== v.moveY)) {
          mv(v.moveX, v.moveY);
        }
      }
      // ── BUILD ──
      else if (v.cmd === "build" && v.buildType) {
        const bd = BLD[v.buildType];
        if (!bd) continue;
        if (bd.requires && !tech.has(bd.requires)) { v.cmd = "idle"; continue; }
        // Age check
        if (bd.age) {
          const pAge = AGE_ORDER.indexOf(player.age);
          const bAge = AGE_ORDER.indexOf(bd.age);
          if (bAge > pAge) { v.cmd = "idle"; continue; }
        }

        let bq = player.buildQueue.find(q => q.bId === v.id && !q.done);
        if (!bq) {
          let ok = true;
          for (const [r, a] of Object.entries(bd.cost)) {
            if ((player.stockpile[r] || 0) < a) ok = false;
          }
          if (ok) {
            let bx = cl(v.buildX || v.x + 2, 2, MW - 3);
            let by = cl(v.buildY || v.y + 2, 2, MH - 3);
            const bsz = bd.size || 1;

            const overlaps = (tx, ty) => {
              for (const p of s.players) {
                if (!p.tc || p.eliminated) continue;
                if (Math.abs(tx - p.tc.x) < bsz + 1 && Math.abs(ty - p.tc.y) < bsz + 1) return true;
              }
              for (const p of s.players) {
                for (const eb of p.buildings) {
                  const esz = BLD[eb.type]?.size || 1;
                  if (tx < eb.x + esz && tx + bsz > eb.x && ty < eb.y + esz && ty + bsz > eb.y) return true;
                }
              }
              for (const q of player.buildQueue) {
                if (q.done) continue;
                const qsz = BLD[q.type]?.size || 1;
                if (tx < q.x + qsz && tx + bsz > q.x && ty < q.y + qsz && ty + bsz > q.y) return true;
              }
              // Docks must be on water, all others must not be
              if (bd.onWater) {
                if (s.terrain[ty]?.[tx] !== TERRAIN_WATER) return true;
              } else {
                if (s.terrain[ty]?.[tx] === TERRAIN_WATER) return true;
              }
              return false;
            };

            if (overlaps(bx, by)) {
              let found = false;
              for (let r = 1; r <= 4 && !found; r++) {
                for (let dy = -r; dy <= r && !found; dy++) {
                  for (let dx = -r; dx <= r; dx++) {
                    if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                    const nx = cl(bx + dx, 2, MW - 3), ny = cl(by + dy, 2, MH - 3);
                    if (!overlaps(nx, ny)) { bx = nx; by = ny; found = true; break; }
                  }
                }
              }
              if (!found) { v.cmd = "idle"; continue; }
            }

            for (const [r, a] of Object.entries(bd.cost)) player.stockpile[r] -= a;
            bq = { bId: v.id, type: v.buildType, x: bx, y: by, prog: 0, need: bd.bt, done: false };
            player.buildQueue.push(bq);
          } else {
            v.cmd = "idle"; continue;
          }
        }
        if (bq && !bq.done) {
          if (D(v, bq) <= 2) {
            bq.prog += v.bSpd; v.xp.build += 1; applySpec(v);
            if (bq.prog >= bq.need) {
              bq.done = true;
              const nb = {
                id: s.nextUid++, type: bq.type, x: bq.x, y: bq.y,
                hp: bd.hp, maxHp: bd.hp, built: true,
              };
              player.buildings.push(nb);
              player.stats.built++;
              s.log.push(`[${s.tick}] ${bd.icon} ${player.name}: ${bq.type} built`);
              if (bq.type === "bridge" && s.terrain[bq.y]?.[bq.x] === TERRAIN_WATER) {
                s.terrain[bq.y][bq.x] = TERRAIN_BRIDGE;
              }
              v.cmd = "idle";
            }
          } else {
            mv(bq.x, bq.y);
          }
        }
      }
      // ── CRAFT ──
      else if (v.cmd === "craft" && v.craftItem) {
        const itemDef = ITEMS[v.craftItem];
        if (itemDef) {
          const hasBuilding = player.buildings.some(b => b.type === itemDef.craftAt && b.built);
          const hasTech = !itemDef.requires || tech.has(itemDef.requires);
          if (hasBuilding && hasTech) {
            const craftBld = player.buildings.find(b => b.type === itemDef.craftAt && b.built && D(b, v) <= 2);
            if (craftBld) {
              if (!v.craftProg) v.craftProg = 0;
              if (v.craftProg === 0) {
                let ok = true;
                for (const [r, a] of Object.entries(itemDef.cost)) {
                  if ((player.stockpile[r] || 0) < a) ok = false;
                }
                if (!ok) { v.cmd = "idle"; v.craftItem = null; v.craftProg = 0; continue; }
                for (const [r, a] of Object.entries(itemDef.cost)) player.stockpile[r] -= a;
              }
              v.craftProg += v.bSpd;
              if (v.craftProg >= itemDef.craftTime) {
                if (itemDef.slot === "vehicle" && VEHICLE_TYPES[v.craftItem]) {
                  const veh = mkVehicle(v.craftItem, craftBld.x + 1, craftBld.y + 1, player.id, s);
                  if (!player.vehicles) player.vehicles = [];
                  player.vehicles.push(veh);
                  addP(craftBld.x, craftBld.y, itemDef.icon, "#ffd700", 20);
                  s.log.push(`[${s.tick}] ${itemDef.icon} ${player.name}: ${itemDef.label} built! (crew it with a villager)`);
                } else {
                  v.equip[itemDef.slot] = v.craftItem;
                  applySpec(v);
                  addP(v.x, v.y, itemDef.icon, "#ffd700", 20);
                  s.log.push(`[${s.tick}] ${itemDef.icon} ${player.name} #${v.id}: ${itemDef.label} crafted!`);
                }
                v.cmd = "idle"; v.craftItem = null; v.craftProg = 0;
              }
            } else {
              const anyBld = player.buildings.filter(b => b.type === itemDef.craftAt && b.built)
                .sort((a, b) => D(a, v) - D(b, v))[0];
              if (anyBld) mv(anyBld.x, anyBld.y);
              else { v.cmd = "idle"; v.craftItem = null; v.craftProg = 0; }
            }
          } else {
            v.cmd = "idle"; v.craftItem = null; v.craftProg = 0;
          }
        } else {
          v.cmd = "idle"; v.craftItem = null; v.craftProg = 0;
        }
      }
      // ── MOUNT HORSE ──
      else if (v.cmd === "mount" && v.targetId != null) {
        const horse = (s.horses || []).find(h => h.id === v.targetId && h.alive && !h.riderId);
        if (horse) {
          if (D(v, horse) <= 1) {
            v.mounted = horse.id;
            horse.riderId = v.id;
            horse.owner = player.id;
            horse.tamed = true;
            addP(v.x, v.y, "🐴", "#a86", 15);
            s.log.push(`[${s.tick}] 🐴 ${player.name} #${v.id}: Mounted horse`);
            v.cmd = "idle";
          } else {
            mv(horse.x, horse.y);
          }
        } else {
          v.cmd = "idle";
        }
      }
      // ── DISMOUNT HORSE ──
      else if (v.cmd === "dismount" && v.mounted) {
        const horse = (s.horses || []).find(h => h.id === v.mounted);
        if (horse) {
          horse.riderId = null;
          horse.x = v.x;
          horse.y = v.y;
        }
        v.mounted = null;
        addP(v.x, v.y, "🐴↓", "#a86", 15);
        v.cmd = "idle";
      }
      // ── CREW VEHICLE ──
      else if (v.cmd === "crew" && v.targetId != null) {
        const veh = (player.vehicles || []).find(vh => vh.id === v.targetId && vh.alive && !vh.crewId);
        if (veh) {
          if (D(v, veh) <= 1) {
            v.crewing = veh.id;
            veh.crewId = v.id;
            v.x = veh.x;
            v.y = veh.y;
            const vt = VEHICLE_TYPES[veh.type];
            addP(v.x, v.y, vt?.icon || "⚙", "#ca8", 15);
            s.log.push(`[${s.tick}] ${vt?.icon || "⚙"} ${player.name} #${v.id}: Crewing ${vt?.label || veh.type}`);
            v.cmd = "idle";
          } else {
            mv(veh.x, veh.y);
          }
        } else {
          v.cmd = "idle";
        }
      }
      // ── UNCREW VEHICLE ──
      else if (v.cmd === "uncrew" && v.crewing) {
        const veh = (player.vehicles || []).find(vh => vh.id === v.crewing);
        if (veh) {
          veh.crewId = null;
        }
        v.crewing = null;
        v.cmd = "idle";
      }
      // ── PICKUP RELIC ──
      else if (v.cmd === "pickup_relic" && v.targetId != null) {
        const relic = (s.relics || []).find(r => r.id === v.targetId && !r.carrierId);
        if (relic) {
          if (D(v, relic) <= 1) {
            relic.carrierId = v.id;
            relic.owner = player.id;
            relic.housed = false;
            addP(v.x, v.y, "✝", "#ffd700", 20);
            s.log.push(`[${s.tick}] ✝ ${player.name} #${v.id}: Picked up relic!`);
            v.cmd = "idle";
          } else {
            mv(relic.x, relic.y);
          }
        } else {
          v.cmd = "idle";
        }
      }
      // ── IDLE ──
      else {
        if (v.carry > 0) {
          if (D(v, player.tc) <= 2) {
            player.stockpile[v.carryType] += v.carry;
            player.stats.gathered[v.carryType] += v.carry;
            v.carry = 0; v.carryType = null;
          } else {
            mv(player.tc.x, player.tc.y);
          }
        }
      }
    }

    // ── NAVAL UNIT AI ──
    const wGrid = buildWaterGrid(s);
    for (const nu of (player.navalUnits || [])) {
      if (!nu.alive) continue;
      if (nu.atkCd > 0) nu.atkCd--;

      // Warships auto-attack nearby enemy coastal buildings/units
      if (nu.dmg > 0 && nu.atkCd <= 0) {
        const range = nu.range || 1;
        let attacked = false;
        for (const other of s.players) {
          if (other.id === player.id || other.eliminated) continue;
          const rel = s.diplomacy?.[player.id]?.[other.id] ?? DIPLO.enemy;
          if (rel === DIPLO.ally) continue;
          // Attack buildings in range
          for (const eb of other.buildings) {
            if (eb.built && eb.hp > 0 && D(nu, eb) <= range) {
              eb.hp -= nu.dmg + (nu.siegeDmg || 0);
              nu.atkCd = 5;
              addP(eb.x, eb.y, `-${nu.dmg + (nu.siegeDmg || 0)}`, "#88f", 10);
              attacked = true;
              break;
            }
          }
          if (attacked) break;
          // Attack TC
          if (other.tc.hp > 0 && D(nu, other.tc) <= range) {
            other.tc.hp -= nu.dmg + (nu.siegeDmg || 0);
            nu.atkCd = 5;
            addP(other.tc.x, other.tc.y, `-${nu.dmg + (nu.siegeDmg || 0)}`, "#88f", 10);
            break;
          }
        }
      }

      // Fishing boats auto-gather food from water
      if (nu.gSpd > 0 && nu.type === "fishing_boat") {
        player.stockpile.food += nu.gSpd * 0.1;
      }
    }
  }

  // ─── RELIC POSITION SYNC ─────────────────────────────────
  for (const relic of s.relics) {
    if (relic.carrierId) {
      // Find the carrying unit
      let carrier = null;
      for (const p of s.players) {
        carrier = p.units.find(u => u.id === relic.carrierId && u.alive);
        if (carrier) {
          relic.x = carrier.x;
          relic.y = carrier.y;
          // Auto-house relic when carrier reaches a temple
          const temple = p.buildings.find(b => b.type === "temple" && b.built && D(b, carrier) <= 2);
          if (temple) {
            relic.housed = true;
            relic.carrierId = null;
            relic.owner = p.id;
            s.log.push(`[${s.tick}] ⛪ ${p.name}: Relic housed in temple! (+${relic.goldRate}/tick gold)`);
            addP(temple.x, temple.y, "✝⛪", "#ffd700", 25);
          }
          break;
        }
      }
      // If carrier is dead, drop the relic
      if (!carrier) {
        relic.carrierId = null;
      }
    }
  }

  // Relic win: all relics housed by one player
  if (s.relics.length > 0) {
    const allHoused = s.relics.every(r => r.housed);
    if (allHoused) {
      const owners = new Set(s.relics.map(r => r.owner));
      if (owners.size === 1 && !s.gameOver) {
        const winnerId = [...owners][0];
        const winner = s.players.find(p => p.id === winnerId);
        s.gameOver = true;
        s.winner = winnerId;
        s.log.push(`[${s.tick}] ✝ ${winner?.name} wins by collecting all relics!`);
      }
    }
  }

  // ─── NEUTRAL ENEMY AI (PvE raids) ─────────────────────────
  if (s.enablePvE && s.tick > 200 && s.tick % 300 === 0) {
    const wave = Math.floor(s.tick / 300);
    const count = Math.min(6, 1 + wave);
    const pool = ["raider"];
    if (wave >= 2) pool.push("scout", "scout");
    if (wave >= 3) pool.push("archer");
    if (wave >= 4) pool.push("brute");
    for (let i = 0; i < count; i++) {
      const sides = [
        { x: ri(0, MW - 1), y: 0 },
        { x: ri(0, MW - 1), y: MH - 1 },
        { x: 0, y: ri(0, MH - 1) },
        { x: MW - 1, y: ri(0, MH - 1) },
      ];
      const sp = pk(sides);
      const e = mkEnemy(pk(pool), sp.x, sp.y, s);
      s.enemies.push(e);
    }
    s.log.push(`[${s.tick}] ⚠ Wild raiders appear from the edges!`);
  }

  // ─── NEUTRAL ENEMY MOVEMENT ────────────────────────────────
  for (const e of s.enemies) {
    if (!e.alive) continue;
    if (e.atkCd > 0) e.atkCd--;
    if (e.moveCd > 0) { e.moveCd--; continue; }
    const def = ET[e.type] || ET.raider;
    if (def.spd < 1) e.moveCd = Math.round(1 / def.spd) - 1;

    let nearest = null;
    let nearDist = Infinity;
    let targetTC = null;

    const targetPlayer = e.targetPlayerId
      ? s.players.find(p => p.id === e.targetPlayerId && !p.eliminated)
      : null;

    const searchPlayers = targetPlayer ? [targetPlayer] : s.players.filter(p => !p.eliminated);

    for (const p of searchPlayers) {
      for (const v of p.units) {
        if (!v.alive) continue;
        const d = D(v, e);
        if (d < nearDist) { nearDist = d; nearest = v; targetTC = p.tc; }
      }
      if (p.tc.hp > 0) {
        const d = D(p.tc, e);
        if (d < nearDist) { nearDist = d; nearest = null; targetTC = p.tc; }
      }
    }

    const tgt = nearest && nearDist < 12 ? nearest : targetTC;
    if (!tgt) continue;

    const d = D(e, tgt);
    const ar = e.ranged ? e.range : 1;

    if (d <= ar) {
      if (e.atkCd <= 0) {
        if (tgt.hp !== undefined) {
          tgt.hp -= e.dmg;
          e.atkCd = e.ranged ? 5 : 4;
          if (tgt.alive !== undefined && tgt.hp <= 0) {
            tgt.alive = false;
            s.log.push(`[${s.tick}] ☠ #${tgt.id} killed by ${e.type}`);
            for (const p of s.players) {
              if (p.units.some(u => u.id === tgt.id)) {
                p.stats.deaths++;
                break;
              }
            }
          }
        }
      }
    } else {
      const n = astar(e.x, e.y, tgt.x, tgt.y, grid, 80);
      if (n) { e.x = n.x; e.y = n.y; }
      if (e.type === "scout") {
        const n2 = astar(e.x, e.y, tgt.x, tgt.y, grid, 40);
        if (n2) { e.x = n2.x; e.y = n2.y; }
      }
    }
  }

  // ─── PLAYER TOWER ATTACKS ──────────────────────────────────
  for (const player of s.players) {
    if (player.eliminated) continue;
    for (const b of player.buildings) {
      if (!b.built || s.tick % 3 !== 0) continue;
      if (b.type !== "tower" && b.type !== "castle_tower") continue;
      const towerDef = BLD[b.type];
      if (!towerDef?.range) continue;

      const targets = [];
      for (const other of s.players) {
        if (other.id === player.id || other.eliminated) continue;
        const rel = s.diplomacy?.[player.id]?.[other.id] ?? DIPLO.enemy;
        if (rel === DIPLO.ally) continue;
        for (const u of other.units) {
          if (u.alive && D(u, b) <= towerDef.range) targets.push(u);
        }
      }
      for (const e of s.enemies) {
        if (e.alive && D(e, b) <= towerDef.range) targets.push(e);
      }

      if (targets.length > 0) {
        const t = targets[0];
        t.hp -= towerDef.dmg;
        addP(t.x, t.y, "⚡", "#8af", 8);
        if (t.hp <= 0) {
          t.alive = false;
          player.stats.kills++;
        }
      }
    }
  }

  // ─── VEHICLE COMBAT ──────────────────────────────────────
  for (const player of s.players) {
    if (player.eliminated) continue;
    for (const veh of (player.vehicles || [])) {
      if (!veh.alive || !veh.crewId) continue;
      const vt = VEHICLE_TYPES[veh.type];
      if (!vt || vt.siegeDmg <= 0) continue;

      const atkRange = vt.atkRange || 1;
      const enemyTCsForVeh = getEnemyTCs(s, player.id);
      let attacked = false;

      for (const etc of enemyTCsForVeh) {
        if (etc.hp > 0 && D(veh, etc) <= Math.max(2, atkRange)) {
          etc.hp -= vt.siegeDmg + vt.dmg;
          addP(etc.x, etc.y, `-${vt.siegeDmg + vt.dmg}`, "#f88", 12);
          const tcOwner = s.players.find(p => p.id === etc.ownerId);
          if (tcOwner) tcOwner.tc.hp = etc.hp;
          attacked = true;
          break;
        }
      }

      if (!attacked) {
        for (const other of s.players) {
          if (other.id === player.id || other.eliminated) continue;
          const rel = s.diplomacy?.[player.id]?.[other.id] ?? DIPLO.enemy;
          if (rel === DIPLO.ally) continue;
          for (const eb of other.buildings) {
            if (eb.built && eb.hp > 0 && D(veh, eb) <= atkRange) {
              eb.hp -= vt.siegeDmg + vt.dmg;
              addP(eb.x, eb.y, `-${vt.siegeDmg + vt.dmg}`, "#f88", 10);
              if (eb.hp <= 0) {
                s.log.push(`[${s.tick}] 💥 ${player.name}'s ${vt.label} destroyed ${eb.type}`);
              }
              attacked = true;
              break;
            }
          }
          if (attacked) break;
        }
      }
    }
  }

  // ─── WILD HORSE WANDERING ───────────────────────────────
  for (const h of (s.horses || [])) {
    if (!h.alive || h.riderId) continue;
    if (h.wanderCd > 0) { h.wanderCd--; continue; }
    h.wanderCd = ri(8, 25);
    const dx = ri(-1, 1), dy = ri(-1, 1);
    const nx = cl(h.x + dx, 1, MW - 2);
    const ny = cl(h.y + dy, 1, MH - 2);
    if (s.terrain[ny]?.[nx] !== TERRAIN_WATER) {
      h.x = nx; h.y = ny;
    }
  }

  // ─── WIN/LOSE CHECK ────────────────────────────────────────
  for (const player of s.players) {
    if (player.eliminated) continue;
    if (player.tc.hp <= 0) {
      player.eliminated = true;
      s.log.push(`[${s.tick}] 💀 ${player.name}'s Town Center destroyed!`);
    }
  }

  const alive = s.players.filter(p => !p.eliminated);
  if (alive.length <= 1 && !s.gameOver) {
    s.gameOver = true;
    if (alive.length === 1) {
      s.winner = alive[0].id;
      s.log.push(`[${s.tick}] 🏆 ${alive[0].name} wins! VICTORY!`);
    } else {
      s.winner = null;
      s.log.push(`[${s.tick}] 💀 Draw — all Town Centers destroyed!`);
    }
  }

  // ─── CLEANUP ───────────────────────────────────────────────
  s.enemies = s.enemies.filter(e => e.alive);
  s.horses = (s.horses || []).filter(h => h.alive);
  for (const player of s.players) {
    for (const v of player.units) {
      if (!v.alive && v.mounted) {
        const horse = (s.horses || []).find(h => h.id === v.mounted);
        if (horse) { horse.riderId = null; }
      }
      if (!v.alive && v.crewing) {
        const veh = (player.vehicles || []).find(vh => vh.id === v.crewing);
        if (veh) { veh.crewId = null; }
      }
    }
    player.units = player.units.filter(v => v.alive);
    player.vehicles = (player.vehicles || []).filter(v => v.alive);
    player.navalUnits = (player.navalUnits || []).filter(n => n.alive);
    player.buildings = player.buildings.filter(b => !b.built || b.hp > 0);
    player.buildQueue = (player.buildQueue || []).filter(q => !q.done);
  }
  if (s.log.length > 150) s.log = s.log.slice(-100);

  // ─── STOCKPILE DELTAS ──────────────────────────────────────
  for (let i = 0; i < s.players.length; i++) {
    const p = s.players[i];
    const prev = gs.players[i]?.stockpile || { wood: 0, stone: 0, gold: 0, food: 0 };
    p.stkDelta = {
      wood: p.stockpile.wood - prev.wood,
      stone: p.stockpile.stone - prev.stone,
      gold: p.stockpile.gold - prev.gold,
      food: p.stockpile.food - prev.food,
    };
  }

  // ─── FOG OF WAR (per player) ──────────────────────────────
  for (const player of s.players) {
    if (player.eliminated) continue;
    // Shared vision with allies
    const alliedUnits = [];
    const alliedBuildings = [];
    for (const other of s.players) {
      if (other.id === player.id || other.eliminated) continue;
      const rel = s.diplomacy?.[player.id]?.[other.id];
      const relBack = s.diplomacy?.[other.id]?.[player.id];
      if (rel === DIPLO.ally && relBack === DIPLO.ally) {
        alliedUnits.push(...other.units.filter(u => u.alive));
        alliedBuildings.push(...other.buildings.filter(b => b.built));
      }
    }
    updFog(
      player.fog,
      [...player.units.filter(v => v.alive), ...alliedUnits],
      [...player.buildings.filter(b => b.built), ...alliedBuildings],
      player.tc,
      s.terrain
    );
  }

  return s;
}
