---
name: military-tactics
description: "RTS combat strategy: defense, offense, unit composition, attack timing. Use when planning attacks or defending against raids."
version: 1.0.0
---

# Military Tactics

## Unit Combat Stats

| Unit | HP | DMG | Speed | Range | Notes |
|------|----|-----|-------|-------|-------|
| Villager | 30 | 2 | 1 | 1 | Base unit |
| Warrior L1 | 40 | 4.5 | 1 | 1 | +10 HP, +2.5 DMG per level |
| Warrior L3 | 60 | 9.5 | 1 | 1 | Unlocks AoE ability |
| Warrior L5 | 80 | 14.5 | 1 | 1 | Maximum power |
| Scout (NPC) | 18 | 2 | 2 | 1 | Fast, low HP |
| Brute (NPC) | 55 | 6 | 0.5 | 1 | Slow tank |
| Archer (NPC) | 22 | 3 | 1 | 4 | Ranged |
| Raider (NPC) | 30 | 4 | 1 | 1 | Standard |

## Combat Mechanics

- Melee attack cooldown: 3 ticks
- Ranged attack cooldown: 5 ticks
- Tower: 4 DMG every 3 ticks, range 6
- Warrior AoE ability: 1.5x DMG to all enemies in 2-tile radius, 40-tick cooldown
- Attack command auto-targets: unit → nearby enemy → enemy TC

## Defense Strategy

### Tower Placement
- Place towers in triangle around TC at ~5-6 tile distance
- Each tower covers 6-tile radius = ~113 tile area
- 3 towers with overlapping coverage = near-total TC defense
- Towers attack strongest nearby enemy first

### Warrior Defense
- Keep 2-3 warriors near TC with "mil" tag
- Warriors L3+ with AoE can clear entire raid waves
- Position warriors at chokepoints (river fords, bridges)

### Early Warning
- Place a tower or unit on hills for +2 vision bonus
- Miner L3 Prospect reveals 8-tile radius — use for scouting

## Offense Strategy

### When to Attack
- Have 6+ warriors (ideally L3+)
- Enemy just lost units to a raid
- Your economy is stable (farms sustaining army)
- You've scouted enemy base and know tower positions

### Attack Execution
1. Move army to enemy territory in a group
2. **Clear towers first** — they do 4 DMG/3 ticks, very dangerous
3. Kill enemy villagers to cripple economy
4. Focus-fire enemy TC (500 HP)
5. Use AoE abilities when enemies cluster

### Force Calculation
- Enemy TC: 500 HP
- Warrior L3 DMG: ~9.5, cooldown 3 ticks = ~3.2 DPS
- 6 Warriors L3 = ~19 DPS → TC dies in ~26 seconds
- Enemy tower: 200 HP → each warrior does ~3.2 DPS → dies in ~10 seconds

## Bot Raid Patterns

Bot enemies send raids from their TC with escalating composition:
- Wave 1 (tick ~100): 1-3 raiders
- Wave 2 (tick ~200): raiders + scouts
- Wave 3 (tick ~400): + archers
- Wave 4 (tick ~600): + brutes
- Raid interval decreases over time (260 → 80 ticks)

## Counter-Strategies by Enemy Type

- **Scouts**: Fast but weak. Towers handle them. One warrior kills in 2 hits.
- **Brutes**: Slow tanks. Kite them — move away, attack, move away. Use AoE.
- **Archers**: Range 4 is dangerous. Rush them with warriors. Towers outrange them.
- **Raiders**: Standard threat. Towers + 1-2 warriors handle them.
