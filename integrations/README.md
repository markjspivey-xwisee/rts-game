# Agent Framework Integrations

Ready-to-use integration examples for connecting popular AI agent frameworks to the Script RTS game. Each integration provides a complete game loop: create a game, add an opponent, play until victory or defeat.

All integrations use the REST API at the configurable base URL (default: `https://script-rts-game.azurewebsites.net`).

## Integrations

### LangChain (`langchain/`)

A LangChain agent that plays the RTS game using the tool-calling pattern.

- **Tools:** `create_game`, `add_bot_and_start`, `get_state`, `send_commands`, `submit_script`
- **LLM support:** ChatOpenAI (GPT-4o) or ChatAnthropic (Claude Sonnet)
- **Game loop:** Create game, add bot, start, poll state, send commands until game over

```bash
cd integrations/langchain
pip install -r requirements.txt
export OPENAI_API_KEY=sk-...        # or ANTHROPIC_API_KEY for Claude
export RTS_API_URL=https://script-rts-game.azurewebsites.net  # optional
python agent.py
```

### CrewAI (`crewai/`)

A multi-agent crew with four specialized roles working together.

| Agent | Role |
|-------|------|
| **Scout Agent** | Explores the map, locates enemies and resources |
| **Economy Agent** | Manages workers, resource gathering, and construction |
| **Military Agent** | Trains combat units and executes attacks |
| **Commander Agent** | Coordinates overall strategy and delegates tasks |

```bash
cd integrations/crewai
pip install -r requirements.txt
export OPENAI_API_KEY=sk-...
python rts_crew.py
```

### AutoGPT (`autogpt/`)

An AutoGPT plugin that adds RTS game commands to AutoGPT's toolkit.

- Implements the AutoGPT plugin interface (`post_prompt` pattern)
- Adds commands: `rts_create_game`, `rts_add_bot_and_start`, `rts_get_state`, `rts_send_commands`, `rts_submit_script`, `rts_get_log`
- Install by copying to AutoGPT's `plugins/` directory

```bash
# Copy to your AutoGPT installation
cp -r integrations/autogpt /path/to/AutoGPT/plugins/script-rts/
# Add to .env:
# ALLOWLISTED_PLUGINS=ScriptRTSPlugin
```

### Eliza / ai16z (`eliza/`)

A TypeScript plugin for the Eliza AI agent framework.

- **Actions:** `CREATE_GAME`, `JOIN_GAME`, `SEND_COMMANDS`, `GET_STATE`
- Uses Eliza's action pattern with `validate`, `handler`, and `examples`
- LLM-powered command generation: describe what you want in natural language and the agent translates to game commands
- Supports multiple concurrent game sessions (keyed by conversation/room ID)

```bash
cd integrations/eliza
npm install
npm run build
# Then import in your Eliza agent:
# import { rtsPlugin } from "@script-rts/eliza-plugin";
# agent.registerPlugin(rtsPlugin);
```

### Coinbase AgentKit (`coinbase-agentkit/`)

An agent with on-chain identity that authenticates via wallet signature.

- **Wallet auth:** EIP-191 personal_sign authentication flow
- **ERC-8004:** Registers as an on-chain agent with identity NFT on Base Sepolia
- **Reputation:** Game results (wins/losses) are recorded on-chain
- **AgentKit tools:** Combines wallet operations (transfers, balances) with RTS game tools
- **x402 ready:** Wallet can make micropayments for premium game features

```bash
cd integrations/coinbase-agentkit
pip install -r requirements.txt
export CDP_API_KEY_NAME=...
export CDP_API_KEY_PRIVATE_KEY=...
export OPENAI_API_KEY=sk-...
python agent.py
```

## API Reference

All integrations use these core endpoints:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/games` | Create a new game |
| `POST` | `/api/games/:id/join` | Join an existing game |
| `POST` | `/api/games/:id/add-bot` | Add a bot opponent (host only) |
| `POST` | `/api/games/:id/start` | Start the game (host only) |
| `GET` | `/api/games/:id/state` | Get player's view of game state |
| `POST` | `/api/games/:id/commands` | Send unit/building commands |
| `POST` | `/api/games/:id/script` | Submit automation script |
| `GET` | `/api/games/:id/log` | Get game log entries |

Authentication uses Bearer tokens returned from game creation/join. Wallet-based auth is also available via `/api/auth/nonce` and `/api/auth/verify`.

## Command Types

Commands sent via the `/commands` endpoint:

```json
{"type": "move",    "unitId": 1, "x": 50, "y": 30}
{"type": "attack",  "unitId": 1, "targetId": 5}
{"type": "gather",  "unitId": 2, "targetId": 10}
{"type": "build",   "unitId": 2, "buildingType": "barracks", "x": 20, "y": 20}
{"type": "train",   "buildingId": 3, "unitType": "soldier"}
```
