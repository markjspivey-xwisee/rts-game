// ═══════════════════════════════════════════════════════════════════════════
//  CANVAS RENDERER (multi-player, ages, naval, relics, formations)
// ═══════════════════════════════════════════════════════════════════════════

const T = 14;
const MW = 64, MH = 44;
const FOG_UNK = 0, FOG_SEEN = 1, FOG_VIS = 2;

const RC = { wood: "#2a6e24", stone: "#6a6a7e", gold: "#c4a030", food: "#8a6a2a" };
const RS = { wood: "🌲", stone: "🪨", gold: "💎", food: "🫐" };

const VEH_COLORS = {
  battering_ram: "#6a4a2a", catapult: "#5a5a3a", cart: "#6a5a2a",
};
const VEH_ICONS = {
  battering_ram: "🪵", catapult: "💣", cart: "🛒",
};

const NAVAL_ICONS = {
  fishing_boat: "🎣", transport: "⛵", warship: "🚢",
};

const SP = {
  none:       { c: "#b8a080", i: "♟" },
  lumberjack: { c: "#4a8c3f", i: "🪓" },
  miner:      { c: "#7a7a8e", i: "⛏" },
  farmer:     { c: "#c4a035", i: "🌾" },
  warrior:    { c: "#a83232", i: "⚔" },
  builder:    { c: "#6a5a3a", i: "🔨" },
};

const BLD_COLORS = {
  house: "#7B6545", farm: "#7B7B2A", barracks: "#5B3216",
  tower: "#4a4a5e", workshop: "#5a4a3a", market: "#6a5a2a",
  stable: "#6B5A40", bridge: "#8B7355",
  wall: "#5a5a6a", gate: "#6a6a7a", dock: "#4a3a2a",
  temple: "#8a7a6a", castle_tower: "#5a5a7a", wonder: "#c4a035",
};

export const BLD_SIZE = {
  house: 2, farm: 2, barracks: 2, tower: 1, workshop: 2, market: 2,
  stable: 2, bridge: 1, wall: 1, gate: 1, dock: 2,
  temple: 2, castle_tower: 1, wonder: 3,
};

const ET_COLORS = {
  scout: "#c87040", brute: "#8a3030", archer: "#a06050", raider: "#a04040",
};

const PROMO_ICONS = {
  recruit: "", veteran: "⭐", elite: "🌟", champion: "💎",
};

/**
 * Main game renderer.
 */
export function render(ctx, view, cam, w, h, sel, myId, zoom = 1) {
  if (!view || !view.terrain) return;

  const Z = T * zoom;

  ctx.fillStyle = "#0a0e08";
  ctx.fillRect(0, 0, w, h);

  const sx = (x) => x * Z - cam.x;
  const sy = (y) => y * Z - cam.y;

  const fog = view.fog || [];
  const terrain = view.terrain;

  // Terrain
  const startX = Math.max(0, Math.floor(cam.x / Z));
  const startY = Math.max(0, Math.floor(cam.y / Z));
  const endX = Math.min(MW, Math.ceil((cam.x + w) / Z) + 1);
  const endY = Math.min(MH, Math.ceil((cam.y + h) / Z) + 1);

  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const fv = fog[y]?.[x] ?? FOG_UNK;
      if (fv === FOG_UNK) continue;
      const tt = terrain[y]?.[x] ?? 0;
      const px = sx(x), py = sy(y);

      if (tt === 1) ctx.fillStyle = fv === FOG_VIS ? "#1a3a4a" : "#0e1820"; // water
      else if (tt === 2) ctx.fillStyle = fv === FOG_VIS ? "#2e3a22" : "#1a2216"; // hill
      else if (tt === 3) ctx.fillStyle = fv === FOG_VIS ? "#5a4a30" : "#3a3020"; // bridge
      else if (tt === 4) ctx.fillStyle = fv === FOG_VIS ? "#c4a868" : "#8a7a50"; // sand
      else if (tt === 5) ctx.fillStyle = fv === FOG_VIS ? "#0a2a3a" : "#061820"; // deep water
      else ctx.fillStyle = fv === FOG_VIS ? "#1a2816" : "#10160e"; // grass

      ctx.fillRect(px, py, Z, Z);

      if (fv === FOG_VIS) {
        ctx.strokeStyle = "rgba(255,255,255,0.03)";
        ctx.strokeRect(px, py, Z, Z);
      }
    }
  }

  // Resources
  for (const r of (view.resources || [])) {
    const fv = fog[r.y]?.[r.x] ?? FOG_UNK;
    if (fv === FOG_UNK || r.amount <= 0) continue;
    const px = sx(r.x), py = sy(r.y);
    if (px < -Z || px > w + Z || py < -Z || py > h + Z) continue;

    const alpha = fv === FOG_VIS ? 0.9 : 0.4;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = RC[r.type] || "#555";
    ctx.fillRect(px + 2, py + 2, Z - 4, Z - 4);
    if (fv === FOG_VIS) {
      ctx.fillStyle = "#fff";
      ctx.font = `${Math.max(6, 7 * zoom)}px monospace`;
      ctx.textAlign = "center";
      ctx.fillText(Math.floor(r.amount), px + Z / 2, py + Z - 2);
    }
    ctx.globalAlpha = 1;
  }

  // Relics
  for (const r of (view.visibleRelics || [])) {
    if (r.housed) continue;
    const fv = fog[r.y]?.[r.x] ?? FOG_UNK;
    if (fv === FOG_UNK) continue;
    const px = sx(r.x), py = sy(r.y);
    if (px < -Z * 2 || px > w + Z * 2 || py < -Z * 2 || py > h + Z * 2) continue;

    ctx.save();
    ctx.globalAlpha = fv === FOG_VIS ? 1 : 0.5;
    // Glowing golden cross
    const pulse = 0.7 + 0.3 * Math.sin(Date.now() * 0.004);
    ctx.fillStyle = `rgba(255, 215, 0, ${pulse})`;
    ctx.fillRect(px + Z * 0.35, py + 2, Z * 0.3, Z - 4);
    ctx.fillRect(px + 2, py + Z * 0.3, Z - 4, Z * 0.3);
    ctx.fillStyle = "#fff";
    ctx.font = `${Math.max(7, 8 * zoom)}px monospace`;
    ctx.textAlign = "center";
    ctx.fillText("✝", px + Z / 2, py - 1);
    ctx.restore();
  }

  // Horses
  for (const hr of (view.visibleHorses || [])) {
    if (!hr.alive || hr.riderId) continue;
    const fv = fog[hr.y]?.[hr.x] ?? FOG_UNK;
    if (fv === FOG_UNK) continue;
    const px = sx(hr.x), py = sy(hr.y);
    if (px < -Z * 2 || px > w + Z * 2 || py < -Z * 2 || py > h + Z * 2) continue;

    ctx.save();
    ctx.globalAlpha = fv === FOG_VIS ? 1 : 0.5;
    ctx.fillStyle = hr.tamed ? "#8a6a3a" : "#7a5a2a";
    ctx.beginPath();
    ctx.moveTo(px + Z / 2, py + 1);
    ctx.lineTo(px + Z - 2, py + Z / 2);
    ctx.lineTo(px + Z / 2, py + Z - 1);
    ctx.lineTo(px + 2, py + Z / 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = hr.tamed ? "#c9a825" : "#5a4a2a";
    ctx.lineWidth = 0.8;
    ctx.stroke();
    if (fv === FOG_VIS) {
      ctx.fillStyle = "#fff";
      ctx.font = `${Math.max(6, 7 * zoom)}px monospace`;
      ctx.textAlign = "center";
      ctx.fillText(hr.tamed ? "🐴" : "🐎", px + Z / 2, py - 1);
    }
    ctx.restore();
  }

  // Player info map
  const playerMap = {};
  for (const p of (view.players || [])) playerMap[p.id] = p;

  // Buildings helper
  const drawBuilding = (b, color, isOwn) => {
    const fv = fog[b.y]?.[b.x] ?? FOG_UNK;
    if (fv === FOG_UNK) return;
    const sz = BLD_SIZE[b.type] || 1;
    const px = sx(b.x), py = sy(b.y);
    if (px < -Z * 3 || px > w + Z || py < -Z * 3 || py > h + Z) return;

    ctx.save();
    ctx.globalAlpha = fv === FOG_VIS ? 1 : 0.5;
    ctx.fillStyle = color || BLD_COLORS[b.type] || "#555";
    ctx.fillRect(px, py, sz * Z, sz * Z);
    ctx.strokeStyle = isOwn ? "#c9a825" : "#666";
    ctx.lineWidth = 0.5;
    ctx.strokeRect(px, py, sz * Z, sz * Z);

    // HP bar
    const maxHp = b.maxHp || 100;
    if (b.hp != null && b.hp < maxHp) {
      const barW = sz * Z;
      const ratio = Math.max(0, Math.min(1, b.hp / maxHp));
      ctx.fillStyle = "#222";
      ctx.fillRect(px, py - 4, barW, 2);
      ctx.fillStyle = isOwn ? "#4a8" : "#c44";
      ctx.fillRect(px, py - 4, barW * ratio, 2);
    }

    // Tower/castle_tower range
    if ((b.type === "tower" || b.type === "castle_tower") && isOwn && fv === FOG_VIS) {
      const range = b.type === "castle_tower" ? 8 : 6;
      ctx.strokeStyle = "rgba(100,160,255,0.15)";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.arc(px + Z / 2, py + Z / 2, range * Z, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Wonder glow
    if (b.type === "wonder" && fv === FOG_VIS) {
      const glow = 0.2 + 0.1 * Math.sin(Date.now() * 0.003);
      ctx.fillStyle = `rgba(255, 215, 0, ${glow})`;
      ctx.fillRect(px - 2, py - 2, sz * Z + 4, sz * Z + 4);
    }
    ctx.restore();
  };

  // My buildings
  for (const b of (view.myBuildings || [])) drawBuilding(b, null, true);
  // Enemy buildings
  for (const b of (view.visibleEnemyBuildings || [])) {
    const owner = playerMap[b.owner];
    drawBuilding(b, owner?.color || "#c44", false);
  }

  // Town Centers
  const drawTC = (tc, color, label) => {
    const fv = fog[tc.y]?.[tc.x] ?? FOG_UNK;
    if (fv === FOG_UNK) return;
    const px = sx(tc.x - 1), py = sy(tc.y - 1);
    ctx.save();
    ctx.globalAlpha = fv === FOG_VIS ? 1 : 0.5;
    ctx.fillStyle = color;
    ctx.fillRect(px, py, 3 * Z, 3 * Z);
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1;
    ctx.strokeRect(px, py, 3 * Z, 3 * Z);

    const maxHp = tc.maxHp || 500;
    if (tc.hp != null && tc.hp < maxHp) {
      const barW = 3 * Z;
      const ratio = Math.max(0, Math.min(1, tc.hp / maxHp));
      ctx.fillStyle = "#222";
      ctx.fillRect(px, py - 6, barW, 3);
      ctx.fillStyle = color;
      ctx.fillRect(px, py - 6, barW * ratio, 3);
    }

    if (label && fv === FOG_VIS) {
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${Math.max(7, 8 * zoom)}px monospace`;
      ctx.textAlign = "center";
      ctx.fillText(label, px + 1.5 * Z, py + 1.5 * Z + 3);
    }
    ctx.restore();
  };

  if (view.myTc) {
    const me = playerMap[myId];
    drawTC(view.myTc, me?.color || "#c9a825", "TC");
  }
  for (const tc of (view.visibleTownCenters || [])) {
    const owner = playerMap[tc.owner || tc.ownerId];
    drawTC(tc, owner?.color || "#c44", owner?.name?.substring(0, 4) || "?");
  }

  // My vehicles
  for (const veh of (view.myVehicles || [])) {
    if (!veh.alive) continue;
    const px = sx(veh.x), py = sy(veh.y);
    if (px < -Z * 2 || px > w + Z * 2 || py < -Z * 2 || py > h + Z * 2) continue;

    ctx.fillStyle = VEH_COLORS[veh.type] || "#6a4a2a";
    ctx.fillRect(px + 1, py + 1, Z - 2, Z - 2);
    ctx.strokeStyle = veh.crewId ? "#c9a825" : "#555";
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 1, py + 1, Z - 2, Z - 2);
    ctx.fillStyle = "#fff";
    ctx.font = `${Math.max(7, 8 * zoom)}px monospace`;
    ctx.textAlign = "center";
    ctx.fillText(VEH_ICONS[veh.type] || "⚙", px + Z / 2, py + Z / 2 + 3);
    if (veh.hp < veh.maxHp) {
      ctx.fillStyle = "#222";
      ctx.fillRect(px, py - 4, Z, 2);
      ctx.fillStyle = "#4a8";
      ctx.fillRect(px, py - 4, Z * (veh.hp / veh.maxHp), 2);
    }
    if (!veh.crewId) {
      ctx.fillStyle = "#ff8";
      ctx.font = `${Math.max(5, 6 * zoom)}px monospace`;
      ctx.fillText("⬚", px + Z / 2, py - 1);
    }
  }

  // Enemy vehicles
  for (const veh of (view.visibleEnemyVehicles || [])) {
    const px = sx(veh.x), py = sy(veh.y);
    if (px < -Z * 2 || px > w + Z * 2 || py < -Z * 2 || py > h + Z * 2) continue;

    const owner = playerMap[veh.owner];
    ctx.fillStyle = owner?.color || "#a05050";
    ctx.fillRect(px + 1, py + 1, Z - 2, Z - 2);
    ctx.strokeStyle = owner?.color || "#c66";
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 1, py + 1, Z - 2, Z - 2);
    ctx.fillStyle = "#fff";
    ctx.font = `${Math.max(7, 8 * zoom)}px monospace`;
    ctx.textAlign = "center";
    ctx.fillText(VEH_ICONS[veh.type] || "⚙", px + Z / 2, py + Z / 2 + 3);
  }

  // My naval units
  for (const nu of (view.myNavalUnits || [])) {
    if (!nu.alive) continue;
    const px = sx(nu.x), py = sy(nu.y);
    if (px < -Z * 2 || px > w + Z * 2 || py < -Z * 2 || py > h + Z * 2) continue;

    ctx.fillStyle = "#3a5a7a";
    ctx.fillRect(px + 1, py + 1, Z - 2, Z - 2);
    ctx.strokeStyle = "#c9a825";
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 1, py + 1, Z - 2, Z - 2);
    ctx.fillStyle = "#fff";
    ctx.font = `${Math.max(7, 8 * zoom)}px monospace`;
    ctx.textAlign = "center";
    ctx.fillText(NAVAL_ICONS[nu.type] || "⚓", px + Z / 2, py + Z / 2 + 3);
    if (nu.hp < nu.maxHp) {
      ctx.fillStyle = "#222";
      ctx.fillRect(px, py - 4, Z, 2);
      ctx.fillStyle = "#4a8";
      ctx.fillRect(px, py - 4, Z * (nu.hp / nu.maxHp), 2);
    }
  }

  // Enemy naval units
  for (const nu of (view.visibleEnemyNaval || [])) {
    const px = sx(nu.x), py = sy(nu.y);
    if (px < -Z * 2 || px > w + Z * 2 || py < -Z * 2 || py > h + Z * 2) continue;

    const owner = playerMap[nu.owner];
    ctx.fillStyle = owner?.color || "#a05050";
    ctx.fillRect(px + 1, py + 1, Z - 2, Z - 2);
    ctx.strokeStyle = owner?.color || "#c66";
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 1, py + 1, Z - 2, Z - 2);
    ctx.fillStyle = "#fff";
    ctx.font = `${Math.max(7, 8 * zoom)}px monospace`;
    ctx.textAlign = "center";
    ctx.fillText(NAVAL_ICONS[nu.type] || "⚓", px + Z / 2, py + Z / 2 + 3);
  }

  // My units
  for (const v of (view.myUnits || [])) {
    if (!v.alive) continue;
    const px = sx(v.x), py = sy(v.y);
    if (px < -Z * 2 || px > w + Z * 2 || py < -Z * 2 || py > h + Z * 2) continue;

    const sp = SP[v.spec] || SP.none;

    // Mounted indicator
    if (v.mounted) {
      ctx.fillStyle = "#7a5a2a";
      ctx.fillRect(px + 1, py + Z * 0.4, Z - 2, Z * 0.5);
      ctx.strokeStyle = "#5a4020";
      ctx.lineWidth = 0.5;
      ctx.strokeRect(px + 1, py + Z * 0.4, Z - 2, Z * 0.5);
    }

    ctx.fillStyle = sp.c;
    ctx.beginPath();
    ctx.arc(px + Z / 2, py + Z / 2 - (v.mounted ? 2 : 0), Z * 0.38, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#c9a825";
    ctx.lineWidth = v.mounted ? 1 : 0.5;
    ctx.stroke();

    // Promotion icon (above spec stars)
    const promoIcon = PROMO_ICONS[v.promotion];
    if (promoIcon) {
      ctx.fillStyle = "#ffd700";
      ctx.font = `${Math.max(5, 6 * zoom)}px monospace`;
      ctx.textAlign = "center";
      ctx.fillText(promoIcon, px + Z / 2, py - (v.mounted ? 8 : 6));
    }

    // Level stars
    if (v.specLv > 0) {
      ctx.fillStyle = "#ffd700";
      ctx.font = `bold ${Math.max(5, 6 * zoom)}px monospace`;
      ctx.textAlign = "center";
      ctx.fillText("★".repeat(Math.min(v.specLv, 3)), px + Z / 2, py - (v.mounted ? 4 : 2));
    }

    // Formation indicator
    if (v.formation && v.formation !== "none") {
      ctx.fillStyle = "#8af";
      ctx.font = `${Math.max(4, 5 * zoom)}px monospace`;
      ctx.textAlign = "center";
      const fi = { line: "═", wedge: "▲", box: "□" };
      ctx.fillText(fi[v.formation] || "", px + Z / 2, py + Z + 6);
    }

    // Mounted icon
    if (v.mounted) {
      ctx.fillStyle = "#fff";
      ctx.font = `${Math.max(5, 5 * zoom)}px monospace`;
      ctx.textAlign = "center";
      ctx.fillText("🐴", px + Z / 2, py + Z + 4);
    }

    // HP bar
    if (v.hp < v.maxHp) {
      ctx.fillStyle = "#222";
      ctx.fillRect(px, py - 5, Z, 2);
      ctx.fillStyle = "#4a8";
      ctx.fillRect(px, py - 5, Z * (v.hp / v.maxHp), 2);
    }

    // Carry indicator
    if (v.carry > 0) {
      ctx.fillStyle = RC[v.carryType] || "#888";
      ctx.fillRect(px + Z - 4, py + Z - 4, 3, 3);
    }
  }

  // Enemy units
  for (const e of (view.visibleEnemyUnits || [])) {
    const px = sx(e.x), py = sy(e.y);
    if (px < -Z * 2 || px > w + Z * 2 || py < -Z * 2 || py > h + Z * 2) continue;

    const owner = playerMap[e.owner];
    ctx.fillStyle = owner?.color || "#a05050";
    ctx.beginPath();
    ctx.arc(px + Z / 2, py + Z / 2, Z * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = owner?.color || "#c66";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Promotion icon for enemy
    const ePromoIcon = PROMO_ICONS[e.promotion];
    if (ePromoIcon) {
      ctx.fillStyle = "#ffd700";
      ctx.font = `${Math.max(4, 5 * zoom)}px monospace`;
      ctx.textAlign = "center";
      ctx.fillText(ePromoIcon, px + Z / 2, py - 4);
    }

    if (e.hp < (e.maxHp || 30)) {
      ctx.fillStyle = "#222";
      ctx.fillRect(px, py - 5, Z, 2);
      ctx.fillStyle = "#c44";
      ctx.fillRect(px, py - 5, Z * (e.hp / (e.maxHp || 30)), 2);
    }
  }

  // Neutral enemies
  for (const e of (view.neutralEnemies || [])) {
    const px = sx(e.x), py = sy(e.y);
    if (px < -Z * 2 || px > w + Z * 2 || py < -Z * 2 || py > h + Z * 2) continue;

    const color = ET_COLORS[e.type] || "#a04040";
    ctx.fillStyle = color;
    if (e.type === "brute") ctx.fillRect(px + 1, py + 1, Z - 2, Z - 2);
    else if (e.type === "scout") {
      ctx.beginPath();
      ctx.moveTo(px + Z / 2, py + 1);
      ctx.lineTo(px + Z - 1, py + Z - 1);
      ctx.lineTo(px + 1, py + Z - 1);
      ctx.closePath(); ctx.fill();
    } else if (e.type === "archer") {
      ctx.beginPath();
      ctx.arc(px + Z / 2, py + Z / 2, Z * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ff8060"; ctx.lineWidth = 1.5; ctx.stroke();
    } else {
      ctx.fillRect(px + 2, py + 2, Z - 4, Z - 4);
    }

    if (e.hp < (e.maxHp || 30)) {
      ctx.fillStyle = "#222";
      ctx.fillRect(px, py - 4, Z, 2);
      ctx.fillStyle = "#c43";
      ctx.fillRect(px, py - 4, Z * (e.hp / (e.maxHp || 30)), 2);
    }
  }

  // Selection highlights
  if (sel) {
    const pulse = 0.6 + 0.4 * Math.sin(Date.now() * 0.006);
    ctx.lineWidth = 2;

    if (sel.unitId) {
      const v = (view.myUnits || []).find(u => u.id === sel.unitId && u.alive);
      if (v) {
        const x = sx(v.x) + Z / 2, y = sy(v.y) + Z / 2;
        ctx.strokeStyle = `rgba(201,168,37,${pulse})`;
        ctx.beginPath(); ctx.arc(x, y, Z * 0.65, 0, Math.PI * 2); ctx.stroke();
      }
    }

    if (sel.bld) {
      const b = sel.bld;
      const sz = (BLD_SIZE[b.type] || 1);
      const px = sx(b.x), py = sy(b.y), ps = sz * Z;
      ctx.strokeStyle = `rgba(201,168,37,${pulse})`;
      ctx.strokeRect(px - 2, py - 2, ps + 4, ps + 4);
    }
  }

  // Particles
  for (const p of (view.particles || [])) {
    if (p.life <= 0) continue;
    ctx.globalAlpha = p.alpha || 1;
    ctx.fillStyle = p.c;
    ctx.font = `bold ${Math.max(8, 9 * zoom)}px monospace`;
    ctx.textAlign = "center";
    ctx.fillText(p.txt, sx(p.x) + Z / 2, sy(p.y));
    ctx.globalAlpha = 1;
  }
}

/**
 * Minimap renderer.
 */
export function renderMini(ctx, view, cam, cw, ch, myId, zoom = 1) {
  if (!view || !view.terrain) return;
  const Z = T * zoom;
  const mw = ctx.canvas.width, mh = ctx.canvas.height;
  ctx.fillStyle = "#080c06";
  ctx.fillRect(0, 0, mw, mh);
  const mx = mw / MW, my = mh / MH;
  const fog = view.fog || [];
  const terrain = view.terrain;

  for (let y = 0; y < MH; y++) {
    for (let x = 0; x < MW; x++) {
      const fv = fog[y]?.[x] ?? FOG_UNK;
      if (fv < FOG_SEEN) continue;
      const tt = terrain[y]?.[x] ?? 0;
      if (tt === 1) ctx.fillStyle = fv === FOG_VIS ? "#1a2a3a" : "#0e1820"; // water
      else if (tt === 4) ctx.fillStyle = fv === FOG_VIS ? "#c4a868" : "#8a7a50"; // sand
      else ctx.fillStyle = fv === FOG_VIS ? "#1a2816" : "#10160e"; // grass/hill/bridge
      ctx.fillRect(x * mx, y * my, mx + 0.5, my + 0.5);
    }
  }

  // Resources
  ctx.globalAlpha = 0.5;
  for (const r of (view.resources || [])) {
    if (r.amount <= 0) continue;
    ctx.fillStyle = RC[r.type] || "#555";
    ctx.fillRect(r.x * mx, r.y * my, Math.max(1, mx), Math.max(1, my));
  }
  ctx.globalAlpha = 1;

  // Relics
  ctx.fillStyle = "#ffd700";
  for (const r of (view.visibleRelics || [])) {
    if (!r.housed) ctx.fillRect(r.x * mx - 1, r.y * my - 1, 3, 3);
  }

  // Buildings
  for (const b of [...(view.myBuildings || []), ...(view.visibleEnemyBuildings || [])]) {
    ctx.fillStyle = BLD_COLORS[b.type] || "#555";
    const sz = BLD_SIZE[b.type] || 1;
    ctx.fillRect(b.x * mx, b.y * my, sz * mx, sz * my);
  }

  // TCs
  const playerMap = {};
  for (const p of (view.players || [])) playerMap[p.id] = p;

  if (view.myTc) {
    const me = playerMap[myId];
    ctx.fillStyle = me?.color || "#c9a825";
    ctx.fillRect((view.myTc.x - 1) * mx, (view.myTc.y - 1) * my, 3 * mx, 3 * my);
  }

  for (const tc of (view.visibleTownCenters || [])) {
    const owner = playerMap[tc.owner || tc.ownerId];
    ctx.fillStyle = owner?.color || "#c44";
    ctx.fillRect((tc.x - 1) * mx, (tc.y - 1) * my, 3 * mx, 3 * my);
  }

  // Horses
  ctx.fillStyle = "#a86";
  for (const hr of (view.visibleHorses || [])) {
    if (hr.alive && !hr.riderId) ctx.fillRect(hr.x * mx - 0.5, hr.y * my - 0.5, 2, 2);
  }

  // My vehicles + naval
  ctx.fillStyle = "#ca8";
  for (const v of (view.myVehicles || [])) {
    if (v.alive) ctx.fillRect(v.x * mx - 0.5, v.y * my - 0.5, 3, 3);
  }
  ctx.fillStyle = "#4af";
  for (const n of (view.myNavalUnits || [])) {
    if (n.alive) ctx.fillRect(n.x * mx - 0.5, n.y * my - 0.5, 3, 3);
  }

  // My units
  ctx.fillStyle = "#8f8";
  for (const v of (view.myUnits || [])) {
    if (v.alive) ctx.fillRect(v.x * mx - 0.5, v.y * my - 0.5, 2, 2);
  }

  // Enemy units
  ctx.fillStyle = "#f44";
  for (const e of (view.visibleEnemyUnits || [])) {
    ctx.fillRect(e.x * mx - 0.5, e.y * my - 0.5, 2, 2);
  }

  // Camera viewport
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 1;
  ctx.strokeRect(cam.x / Z * mx, cam.y / Z * my, cw / Z * mx, ch / Z * my);
}
