---
name: economy-management
description: "Manage RTS economy: resource gathering, building placement, population growth. Use when optimizing resource collection or build orders."
version: 1.0.0
---

# Economy Management

## Key Formulas

- **Pop cap** = 4 + (houses * 4)
- **Food upkeep** = population * 0.04 per tick
- **Farm income** = 0.18 food/tick per farm
- **Market income** = 0.08 gold/tick per market
- **Villager spawn** = every 55 ticks if food >= 30 and pop < cap
- **Building decay** = -1 HP per 100 ticks

## Resource Priorities by Phase

### Early (tick 0-200)
1. Wood (for houses, farms)
2. Food (prevent starvation)
3. Stone (save for later)

### Mid (tick 200-500)
1. Balanced wood/stone (for workshop, barracks)
2. Gold (for towers, market)
3. Food (maintain army)

### Late (tick 500+)
1. Gold (towers cost 10 gold each)
2. Food (large army upkeep)
3. Stone (tower construction)

## Optimal Build Order

1. **2x House** (60 wood) — pop cap 4→12
2. **2x Farm** (40 wood) — +0.36 food/tick
3. **Workshop** (40w 30s) — unlocks tower tech
4. **1x House** (30 wood) — pop cap 12→16
5. **Barracks** (50w 20s) — unlocks warrior training
6. **2x Tower** (80s 20g) — base defense
7. **Market** (30w 15g) — gold income
8. **More houses** as needed

## Gathering Efficiency

- Lumberjack L3+ with Cleave: 6x wood gather speed
- Miner L3+ with Prospect: reveals hidden resources
- Farmer L3+ with Plant: creates a food node (60 amount)
- Builder L3+ with Repair: maintains building HP

## Break-Even Analysis

- 1 villager upkeep = 0.04 food/tick
- 1 farm produces = 0.18 food/tick
- 1 farm sustains ≈ 4.5 villagers
- For 12 pop: need ~3 farms minimum
- For 20 pop: need ~5 farms minimum

## Specialization Tips

- Don't spread XP: keep lumberjacks on wood, miners on stone
- XP decays on non-dominant tasks (0.05/10 ticks)
- Level 3 unlocks abilities — prioritize getting 2-3 warriors to L3
- Tag units: "eco" for gatherers, "bld" for builders, "mil" for military
