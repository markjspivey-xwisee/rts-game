---
name: scouting
description: "Fog of war management and map awareness for RTS. Use when needing to explore the map or gather intelligence on enemy positions."
version: 1.0.0
---

# Scouting & Map Awareness

## Vision Mechanics

| Source | Vision Range | Notes |
|--------|-------------|-------|
| Villager | 6 tiles | Base vision |
| On hill | 6 + 2 = 8 tiles | Terrain bonus |
| Town Center | 7 tiles | Always-on |
| Tower | 8 tiles | Best permanent vision |
| Miner L3 Prospect | 8-tile reveal | One-time ability, 40-tick CD |
| Building | 4 tiles | Any built structure |

## Fog of War States

- **Unknown** (black): Never explored. No information.
- **Seen** (dark): Previously explored. Shows terrain, resource positions (not amounts). Enemy units NOT visible.
- **Visible** (lit): Currently in vision range. Shows everything including enemy units, resource amounts.

## Map Layout

- **Size**: 64x44 tiles
- **River**: Snakes vertically across map, 3 tiles wide
- **Fords**: 2-3 natural crossing points (river becomes bridge terrain)
- **Hills**: 8 clusters of 3-8 tiles, provide vision bonus

### TC Positions by Player Count
- **2 players**: Left (12,22) and Right (51,22)
- **3 players**: Triangle — (12,12), (51,12), (32,36)
- **4 players**: Corners — (10,10), (53,10), (10,33), (53,33)

## Scouting Strategy

### Early Game
1. Send 1 villager to explore while others gather
2. Follow the river to find ford crossings — these are key chokepoints
3. Move toward where enemy TCs should be (based on player count)
4. Station scout on a hill for maximum vision

### Mid Game
1. Build towers at strategic points for permanent vision
2. Use Miner L3 Prospect ability to reveal large areas instantly
3. Watch enemy build patterns: towers = they're defending, barracks = they're attacking

### What to Look For
- **Enemy TC position**: Critical for attack planning
- **Enemy tower positions**: Must be cleared before attacking TC
- **Resource locations**: Find gold and stone deposits for late game
- **Chokepoints**: River fords, narrow passages between hills
- **Enemy army movements**: Visible enemy units in your fog

### Intelligence Priorities
1. Enemy TC location and HP
2. Enemy tower count and positions
3. Enemy army size (visible units)
4. Resource-rich areas not yet claimed
5. Unguarded approaches to enemy base
