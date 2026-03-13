#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
//  MCP Server for RTS Game
// ═══════════════════════════════════════════════════════════════════════════

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import * as api from "./game-client.js";

const server = new Server(
  { name: "rts-game", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// ── Tool definitions ──────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "list_games",
    description: "List available RTS games to join or spectate. Returns open lobbies and active games.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "create_game",
    description: "Create a new RTS game lobby. You'll be the host and can add bots or wait for players to join.",
    inputSchema: {
      type: "object",
      properties: {
        player_name: { type: "string", description: "Your player name" },
        player_count: { type: "number", description: "Number of players (2-4)", default: 2 },
        enable_pve: { type: "boolean", description: "Enable neutral PvE raids from map edges", default: false },
      },
      required: ["player_name"],
    },
  },
  {
    name: "join_game",
    description: "Join an existing game lobby by its ID.",
    inputSchema: {
      type: "object",
      properties: {
        game_id: { type: "string", description: "Game ID to join" },
        player_name: { type: "string", description: "Your player name" },
      },
      required: ["game_id", "player_name"],
    },
  },
  {
    name: "start_game",
    description: "Start the game (host only). All players must have joined first.",
    inputSchema: {
      type: "object",
      properties: { game_id: { type: "string" } },
      required: ["game_id"],
    },
  },
  {
    name: "add_bot",
    description: "Add a bot player to the game lobby (host only).",
    inputSchema: {
      type: "object",
      properties: { game_id: { type: "string" } },
      required: ["game_id"],
    },
  },
  {
    name: "get_game_state",
    description: "Get your current game state: units, buildings, resources, visible enemies, stockpile. Filtered by fog of war.",
    inputSchema: {
      type: "object",
      properties: { game_id: { type: "string" } },
      required: ["game_id"],
    },
  },
  {
    name: "send_commands",
    description: "Send commands to your units. Each command targets a unit you own.\n\nActions:\n- gather: send unit to harvest (needs target_id of resource)\n- attack: attack enemy unit (needs target_id)\n- moveTo: move to coordinates (needs x, y)\n- build: construct building (needs build_type, x, y)\n- ability: use spec ability (level 3+)\n- idle: stop current action\n- setTag: set unit tag for grouping",
    inputSchema: {
      type: "object",
      properties: {
        game_id: { type: "string" },
        commands: {
          type: "array",
          items: {
            type: "object",
            properties: {
              unit_id: { type: "number", description: "ID of your unit" },
              action: { type: "string", enum: ["gather", "attack", "moveTo", "build", "ability", "idle", "setTag"] },
              target_id: { type: "number", description: "Target resource/unit ID (for gather/attack)" },
              x: { type: "number", description: "X coordinate (for moveTo/build)" },
              y: { type: "number", description: "Y coordinate (for moveTo/build)" },
              build_type: { type: "string", description: "Building type (house/farm/barracks/tower/workshop/market/bridge)" },
              tag: { type: "string", description: "Tag string (for setTag)" },
            },
            required: ["unit_id", "action"],
          },
        },
      },
      required: ["game_id", "commands"],
    },
  },
  {
    name: "get_units",
    description: "Get detailed info about all your units: position, specialization, HP, current command, XP.",
    inputSchema: {
      type: "object",
      properties: { game_id: { type: "string" } },
      required: ["game_id"],
    },
  },
  {
    name: "get_buildings",
    description: "Get your buildings and any visible enemy buildings.",
    inputSchema: {
      type: "object",
      properties: { game_id: { type: "string" } },
      required: ["game_id"],
    },
  },
  {
    name: "get_map_info",
    description: "Get terrain info and visible resource locations with amounts.",
    inputSchema: {
      type: "object",
      properties: { game_id: { type: "string" } },
      required: ["game_id"],
    },
  },
  {
    name: "submit_script",
    description: "Submit a JavaScript AI script that runs every tick to control your units automatically. The script should define an update(api) function.",
    inputSchema: {
      type: "object",
      properties: {
        game_id: { type: "string" },
        code: { type: "string", description: "JavaScript code with update(api) function" },
      },
      required: ["game_id", "code"],
    },
  },
];

// ── Handlers ──────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "list_games": {
        const data = await api.listGames();
        const games = data.games || [];
        if (games.length === 0) return text("No games available. Use create_game to start one.");
        let out = `Found ${games.length} game(s):\n\n`;
        for (const g of games) {
          out += `- **${g.id.substring(0, 8)}** | ${g.status} | ${g.players?.length || 0}/${g.config?.playerCount || 2} players`;
          if (g.players) out += ` | ${g.players.map(p => p.name).join(", ")}`;
          out += "\n";
        }
        return text(out);
      }

      case "create_game": {
        const data = await api.createGame(
          args.player_name,
          args.player_count || 2,
          args.enable_pve || false
        );
        return text(
          `Game created!\n` +
          `- Game ID: ${data.gameId}\n` +
          `- Your Player ID: ${data.playerId}\n` +
          `- Player count: ${args.player_count || 2}\n\n` +
          `Next: Use add_bot to add bot opponents, then start_game when ready.`
        );
      }

      case "join_game": {
        const data = await api.joinGame(args.game_id, args.player_name);
        return text(`Joined game ${args.game_id.substring(0, 8)}!\nYour Player ID: ${data.playerId}\n\nWait for the host to start the game, then use get_game_state.`);
      }

      case "start_game": {
        await api.startGame(args.game_id);
        return text(`Game started! Use get_game_state to see the map and begin playing.`);
      }

      case "add_bot": {
        const data = await api.addBot(args.game_id);
        return text(`Bot added: ${data.playerId || "OK"}`);
      }

      case "get_game_state": {
        const state = await api.getState(args.game_id);
        return text(formatState(state));
      }

      case "send_commands": {
        // Transform commands from MCP format to API format
        const cmds = (args.commands || []).map(c => {
          const cmd = { type: c.action, unitId: c.unit_id };
          if (c.target_id !== undefined) cmd.targetId = c.target_id;
          if (c.x !== undefined) cmd.x = c.x;
          if (c.y !== undefined) cmd.y = c.y;
          if (c.build_type) cmd.buildType = c.build_type;
          if (c.tag) cmd.tag = c.tag;
          return cmd;
        });
        const data = await api.sendCommands(args.game_id, cmds);
        return text(`Commands sent: ${data.accepted || cmds.length} accepted.`);
      }

      case "get_units": {
        const state = await api.getState(args.game_id);
        return text(formatUnits(state));
      }

      case "get_buildings": {
        const state = await api.getState(args.game_id);
        return text(formatBuildings(state));
      }

      case "get_map_info": {
        const state = await api.getState(args.game_id);
        return text(formatMap(state));
      }

      case "submit_script": {
        const data = await api.submitScript(args.game_id, args.code);
        if (data.error) return text(`Script error: ${data.error}`);
        return text(`Script compiled and deployed! It will run every tick automatically.`);
      }

      default:
        return text(`Unknown tool: ${name}`);
    }
  } catch (e) {
    return text(`Error: ${e.message}`);
  }
});

// ── Formatters ────────────────────────────────────────────────────────────

function text(content) {
  return { content: [{ type: "text", text: content }] };
}

function formatState(s) {
  if (!s || s.error) return `Error: ${s?.error || "No state available"}`;

  let out = `## Game State (Tick ${s.tick})\n\n`;

  // Players
  out += `### Players\n`;
  for (const p of (s.players || [])) {
    out += `- ${p.name} (${p.id})${p.id === s.myId ? " **← YOU**" : ""} | color: ${p.color}${p.eliminated ? " | ELIMINATED" : ""}\n`;
  }

  // Resources
  const stk = s.myStockpile || {};
  out += `\n### Your Stockpile\n`;
  out += `- Wood: ${Math.floor(stk.wood || 0)} | Stone: ${Math.floor(stk.stone || 0)} | Gold: ${Math.floor(stk.gold || 0)} | Food: ${Math.floor(stk.food || 0)}\n`;
  out += `- Population: ${(s.myUnits || []).length}/${s.myPopCap || 4}\n`;

  // TC
  if (s.myTc) out += `\n### Your Town Center\n- Position: (${s.myTc.x}, ${s.myTc.y}) | HP: ${s.myTc.hp}/${s.myTc.maxHp}\n`;

  // Units summary
  out += `\n### Your Units (${(s.myUnits || []).length})\n`;
  const specs = {};
  for (const u of (s.myUnits || [])) {
    specs[u.spec || "none"] = (specs[u.spec || "none"] || 0) + 1;
  }
  for (const [spec, count] of Object.entries(specs)) {
    out += `- ${spec}: ${count}\n`;
  }

  // Buildings
  out += `\n### Your Buildings (${(s.myBuildings || []).length})\n`;
  const bldCounts = {};
  for (const b of (s.myBuildings || [])) bldCounts[b.type] = (bldCounts[b.type] || 0) + 1;
  for (const [type, count] of Object.entries(bldCounts)) out += `- ${type}: ${count}\n`;

  // Visible enemies
  const enemies = s.visibleEnemyUnits || [];
  if (enemies.length > 0) {
    out += `\n### Visible Enemies (${enemies.length})\n`;
    for (const e of enemies.slice(0, 10)) {
      out += `- #${e.id} (${e.owner}) at (${e.x},${e.y}) HP:${Math.floor(e.hp)}\n`;
    }
    if (enemies.length > 10) out += `- ... and ${enemies.length - 10} more\n`;
  }

  // Visible enemy TCs
  for (const tc of (s.visibleTownCenters || [])) {
    out += `\n### Enemy TC: ${tc.owner || "?"} at (${tc.x},${tc.y}) HP:${tc.hp}/${tc.maxHp}\n`;
  }

  // Tech
  if ((s.myTech || []).length > 0) {
    out += `\n### Tech: ${s.myTech.join(", ")}\n`;
  }

  if (s.gameOver) {
    out += `\n## GAME OVER — Winner: ${s.winner || "none"}\n`;
  }

  return out;
}

function formatUnits(s) {
  if (!s) return "No state";
  let out = `## Your Units (${(s.myUnits || []).length})\n\n`;
  out += `| ID | Spec | Lv | HP | Pos | Cmd | Carry | Tag | AbCD |\n`;
  out += `|----|------|----|----|-----|-----|-------|-----|------|\n`;
  for (const u of (s.myUnits || [])) {
    out += `| ${u.id} | ${u.spec || "none"} | ${u.specLv || 0} | ${Math.floor(u.hp)}/${u.maxHp} | (${u.x},${u.y}) | ${u.cmd || "idle"} | ${u.carry || 0} ${u.carryType || ""} | ${u.tag || "-"} | ${u.abCd || 0} |\n`;
  }
  return out;
}

function formatBuildings(s) {
  if (!s) return "No state";
  let out = `## Your Buildings (${(s.myBuildings || []).length})\n\n`;
  for (const b of (s.myBuildings || [])) {
    out += `- ${b.type} #${b.id} at (${b.x},${b.y}) HP:${b.hp}/${b.maxHp}\n`;
  }
  if ((s.visibleEnemyBuildings || []).length > 0) {
    out += `\n## Visible Enemy Buildings\n`;
    for (const b of s.visibleEnemyBuildings) {
      out += `- ${b.type} (${b.owner}) at (${b.x},${b.y}) HP:${b.hp}/${b.maxHp}\n`;
    }
  }
  return out;
}

function formatMap(s) {
  if (!s) return "No state";
  let out = `## Map Info\n`;
  out += `- Size: 64x44 tiles\n`;
  out += `- Your TC: (${s.myTc?.x},${s.myTc?.y})\n\n`;

  // Resource summary
  const resByType = {};
  for (const r of (s.resources || [])) {
    if (!resByType[r.type]) resByType[r.type] = [];
    resByType[r.type].push(r);
  }
  out += `## Visible Resources\n`;
  for (const [type, rs] of Object.entries(resByType)) {
    const total = rs.reduce((s, r) => s + (r.amount || 0), 0);
    out += `- ${type}: ${rs.length} nodes, ~${Math.floor(total)} total\n`;
    // Show top 5 closest to TC
    const sorted = rs.sort((a, b) => {
      const da = Math.abs(a.x - (s.myTc?.x || 0)) + Math.abs(a.y - (s.myTc?.y || 0));
      const db = Math.abs(b.x - (s.myTc?.x || 0)) + Math.abs(b.y - (s.myTc?.y || 0));
      return da - db;
    });
    for (const r of sorted.slice(0, 5)) {
      out += `  - #${r.id} at (${r.x},${r.y}) amount:${Math.floor(r.amount)}\n`;
    }
  }
  return out;
}

// ── Start ─────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
