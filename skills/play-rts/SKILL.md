---
name: play-rts
description: "Play a multiplayer RTS game by managing economy, building structures, training warriors, and defeating opponents. Connect via MCP tools, monitor game state, and issue unit commands to win."
version: 1.0.0
metadata:
  openclaw:
    requires:
      bins:
        - node
    mcp_server: "../mcp-server/index.js"
---

# Play RTS

Play a multiplayer real-time strategy game supporting 2-4 players (humans, AI agents, or bots).

## Getting Started

1. **Create or join a game:**
   ```
   create_game(player_name="Claude", player_count=2)
   add_bot(game_id="...")
   start_game(game_id="...")
   ```

2. **Game loop** (repeat every 2-5 seconds):
   ```
   state = get_game_state(game_id="...")
   # Analyze state, decide strategy
   send_commands(game_id="...", commands=[...])
   ```

3. **Or submit an auto-play script:**
   ```
   submit_script(game_id="...", code="function update(api) { ... }")
   ```

## Win Condition

Destroy all enemy Town Centers. Last player standing wins.

## Map

- 64x44 tile grid with terrain: grass, water, hills, bridge/fords
- River divides the map with 2-3 natural crossing points
- Each player starts with a Town Center (500 HP, 3x3 footprint)
- Resources clustered near each player's base
- Hills grant +2 vision range

## Resources

| Resource | Use | Regrows? |
|----------|-----|----------|
| Wood | Buildings, basic structures | Yes (slow) |
| Stone | Towers, advanced buildings | No |
| Gold | Towers, market | No |
| Food | Villager upkeep + spawning | Yes (slow) |

- Each villager costs 0.04 food/tick upkeep
- New villager spawns every 55 ticks if food >= 30
- At 0 food: starvation (-0.5 HP/tick to all villagers)

## Units

Villagers specialize through XP into one of 5 roles:

| Spec | Bonus | Ability (L3+) |
|------|-------|---------------|
| Lumberjack | +gather wood speed, +carry | Cleave: 6x gather on adjacent tree |
| Miner | +gather stone/gold | Prospect: reveal 8-tile fog radius |
| Farmer | +food gathering | Plant: create food resource node |
| Warrior | +HP, +damage (up to 2.5x) | AoE: 1.5x damage in 2-tile radius |
| Builder | +build speed | Repair: +25 HP to damaged building |

## Buildings

| Building | Cost | Effect | Unlocks |
|----------|------|--------|---------|
| House | 30 wood | +4 pop cap | - |
| Farm | 20 wood | +0.18 food/tick | - |
| Barracks | 50w 20s | - | warrior_training |
| Workshop | 40w 30s | - | tower tech |
| Tower | 40s 10g | 4 dmg, range 6 | Requires: tower tech |
| Market | 30w 15g | +0.08 gold/tick | trade |
| Bridge | 15w 10s | Cross water | - |

## Commands

```json
{ "unit_id": 5, "action": "gather", "target_id": 42 }
{ "unit_id": 3, "action": "build", "build_type": "house", "x": 14, "y": 20 }
{ "unit_id": 7, "action": "attack", "target_id": 12 }
{ "unit_id": 7, "action": "moveTo", "x": 51, "y": 22 }
{ "unit_id": 7, "action": "ability" }
{ "unit_id": 7, "action": "idle" }
```

## Strategy Guide

### Early Game (tick 0-200)
- Gather wood and food immediately
- Build 2 houses for pop cap
- Build 2 farms for food income
- Scout with one villager to find enemy

### Mid Game (tick 200-500)
- Build workshop (unlocks towers)
- Build barracks (unlocks warrior training)
- Place 2-3 towers near your TC for defense
- Start training warriors (tag units as "mil")

### Late Game (tick 500+)
- Amass 6+ warriors
- Push toward enemy TC
- Clear enemy towers first (200 HP)
- Enemy TC has 500 HP — focus fire

### Defense Tips
- Towers do 4 damage every 3 ticks at range 6
- Warriors with AoE ability counter raid waves
- Keep builders near base to repair
- Build tower triangle around TC
