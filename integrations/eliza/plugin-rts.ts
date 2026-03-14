/**
 * Eliza (ai16z) Plugin for Script RTS Game
 * ==========================================
 *
 * A plugin for the Eliza AI agent framework that enables playing the RTS game.
 * Implements CREATE_GAME, JOIN_GAME, SEND_COMMANDS, and GET_STATE actions.
 *
 * Usage:
 *   import { rtsPlugin } from "./plugin-rts";
 *   // Register with your Eliza agent
 *   agent.registerPlugin(rtsPlugin);
 */

import {
    type Action,
    type Plugin,
    type IAgentRuntime,
    type Memory,
    type State,
    type HandlerCallback,
    type ActionExample,
    ModelClass,
    generateText,
    composeContext,
} from "@elizaos/core";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BASE_URL =
    process.env.RTS_API_URL ||
    "https://script-rts-game.azurewebsites.net";
const API = `${BASE_URL}/api`;

interface GameSession {
    gameId: string;
    token: string;
    playerId: number;
    tick: number;
}

// Active sessions keyed by room/conversation ID
const sessions = new Map<string, GameSession>();

function getHeaders(session?: GameSession): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (session?.token) {
        h["Authorization"] = `Bearer ${session.token}`;
    }
    return h;
}

async function apiRequest(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    session?: GameSession
): Promise<unknown> {
    const url = `${API}${path}`;
    const opts: RequestInit = {
        method,
        headers: getHeaders(session),
    };
    if (body) {
        opts.body = JSON.stringify(body);
    }
    const resp = await fetch(url, opts);
    if (resp.status === 304) return { noChange: true };
    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`API ${resp.status}: ${text}`);
    }
    return resp.json();
}

// ---------------------------------------------------------------------------
// Action: CREATE_GAME
// ---------------------------------------------------------------------------

const createGameAction: Action = {
    name: "CREATE_GAME",
    description:
        "Create a new RTS game, add a bot opponent, and start the match.",
    similes: [
        "START_RTS_GAME",
        "NEW_GAME",
        "PLAY_RTS",
        "START_PLAYING",
        "LAUNCH_GAME",
    ],
    examples: [
        [
            {
                user: "{{user1}}",
                content: { text: "Start an RTS game for me" },
            },
            {
                user: "{{agentName}}",
                content: {
                    text: "Creating a new RTS game and adding a bot opponent...",
                    action: "CREATE_GAME",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: { text: "Let's play a strategy game" },
            },
            {
                user: "{{agentName}}",
                content: {
                    text: "Setting up a new RTS match right now!",
                    action: "CREATE_GAME",
                },
            },
        ],
    ] as ActionExample[][],

    validate: async (
        _runtime: IAgentRuntime,
        message: Memory
    ): Promise<boolean> => {
        const text = (message.content?.text || "").toLowerCase();
        return (
            text.includes("game") ||
            text.includes("rts") ||
            text.includes("play") ||
            text.includes("start") ||
            text.includes("match")
        );
    },

    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        _state: State | undefined,
        _options: Record<string, unknown>,
        callback: HandlerCallback
    ): Promise<boolean> => {
        const roomId = message.roomId;
        const playerName =
            (message.content?.playerName as string) || "ElizaBot";

        try {
            // Create game
            const createResult = (await apiRequest("POST", "/games", {
                playerName,
                playerType: "ai",
                config: { mapWidth: 128, mapHeight: 128 },
            })) as Record<string, unknown>;

            const session: GameSession = {
                gameId: createResult.gameId as string,
                token: createResult.token as string,
                playerId: createResult.playerId as number,
                tick: 0,
            };

            // Add bot opponent
            await apiRequest(
                "POST",
                `/games/${session.gameId}/add-bot`,
                undefined,
                session
            );

            // Start the game
            await apiRequest(
                "POST",
                `/games/${session.gameId}/start`,
                undefined,
                session
            );

            sessions.set(roomId, session);

            await callback({
                text:
                    `RTS game created and started!\n` +
                    `- Game ID: ${session.gameId}\n` +
                    `- Player: ${playerName}\n` +
                    `- Opponent: Bot\n\n` +
                    `Use "check game state" to see the battlefield, ` +
                    `or "send commands" to issue orders to your units.`,
            });

            return true;
        } catch (error) {
            await callback({
                text: `Failed to create game: ${(error as Error).message}`,
            });
            return false;
        }
    },
};

// ---------------------------------------------------------------------------
// Action: GET_STATE
// ---------------------------------------------------------------------------

const getStateAction: Action = {
    name: "GET_STATE",
    description:
        "Get the current game state including units, buildings, resources, and visible enemies.",
    similes: [
        "CHECK_GAME",
        "GAME_STATUS",
        "VIEW_STATE",
        "SHOW_MAP",
        "BATTLEFIELD_STATUS",
    ],
    examples: [
        [
            {
                user: "{{user1}}",
                content: { text: "What's the game state?" },
            },
            {
                user: "{{agentName}}",
                content: {
                    text: "Let me check the current battlefield situation...",
                    action: "GET_STATE",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: { text: "How's the game going?" },
            },
            {
                user: "{{agentName}}",
                content: {
                    text: "Checking our forces and resources now.",
                    action: "GET_STATE",
                },
            },
        ],
    ] as ActionExample[][],

    validate: async (
        _runtime: IAgentRuntime,
        message: Memory
    ): Promise<boolean> => {
        return sessions.has(message.roomId);
    },

    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        _state: State | undefined,
        _options: Record<string, unknown>,
        callback: HandlerCallback
    ): Promise<boolean> => {
        const session = sessions.get(message.roomId);
        if (!session) {
            await callback({
                text: "No active game in this conversation. Say 'start an RTS game' to begin.",
            });
            return false;
        }

        try {
            const state = (await apiRequest(
                "GET",
                `/games/${session.gameId}/state`,
                undefined,
                session
            )) as Record<string, unknown>;

            if ((state as any).noChange) {
                await callback({ text: "No changes since last check." });
                return true;
            }

            session.tick = (state.tick as number) || 0;

            const units = (state.units as any[]) || [];
            const buildings = (state.buildings as any[]) || [];
            const resources = state.resources as Record<string, number>;
            const enemyUnits = (state.enemyUnits as any[]) || [];
            const enemyBuildings = (state.enemyBuildings as any[]) || [];

            let report = `**Game State (Tick ${session.tick})**\n\n`;
            report += `**Resources:** Gold: ${resources?.gold ?? 0}, Wood: ${resources?.wood ?? 0}\n\n`;
            report += `**Your Forces:** ${units.length} units, ${buildings.length} buildings\n`;

            if (units.length > 0) {
                const typeCounts: Record<string, number> = {};
                for (const u of units) {
                    typeCounts[u.type] = (typeCounts[u.type] || 0) + 1;
                }
                report += `Units: ${Object.entries(typeCounts)
                    .map(([t, c]) => `${c}x ${t}`)
                    .join(", ")}\n`;
            }

            if (buildings.length > 0) {
                report += `Buildings: ${buildings.map((b: any) => b.type).join(", ")}\n`;
            }

            report += `\n**Enemy:** ${enemyUnits.length} units, ${enemyBuildings.length} buildings visible\n`;

            if (state.winner !== undefined && state.winner !== null) {
                report += `\n**GAME OVER** - Winner: Player ${state.winner}`;
            }

            await callback({ text: report });
            return true;
        } catch (error) {
            await callback({
                text: `Error getting state: ${(error as Error).message}`,
            });
            return false;
        }
    },
};

// ---------------------------------------------------------------------------
// Action: SEND_COMMANDS
// ---------------------------------------------------------------------------

const sendCommandsAction: Action = {
    name: "SEND_COMMANDS",
    description:
        "Send commands to units and buildings. Commands: move, attack, gather, build, train.",
    similes: [
        "ISSUE_ORDERS",
        "COMMAND_UNITS",
        "MOVE_UNITS",
        "ATTACK_ENEMY",
        "BUILD_STRUCTURE",
    ],
    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Send workers to gather gold",
                },
            },
            {
                user: "{{agentName}}",
                content: {
                    text: "Ordering workers to gather gold resources.",
                    action: "SEND_COMMANDS",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: { text: "Attack the enemy base" },
            },
            {
                user: "{{agentName}}",
                content: {
                    text: "Sending all combat units to attack!",
                    action: "SEND_COMMANDS",
                },
            },
        ],
    ] as ActionExample[][],

    validate: async (
        _runtime: IAgentRuntime,
        message: Memory
    ): Promise<boolean> => {
        return sessions.has(message.roomId);
    },

    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State | undefined,
        _options: Record<string, unknown>,
        callback: HandlerCallback
    ): Promise<boolean> => {
        const session = sessions.get(message.roomId);
        if (!session) {
            await callback({
                text: "No active game. Start one first!",
            });
            return false;
        }

        try {
            // Get current state to inform command generation
            const gameState = (await apiRequest(
                "GET",
                `/games/${session.gameId}/state`,
                undefined,
                session
            )) as Record<string, unknown>;

            // Use the LLM to generate appropriate commands based on user intent
            const commandPrompt = `You are controlling units in an RTS game. Based on the user's request and the current game state, generate a JSON array of commands.

Available command types:
- {"type": "move", "unitId": <id>, "x": <x>, "y": <y>}
- {"type": "attack", "unitId": <id>, "targetId": <target_id>}
- {"type": "gather", "unitId": <worker_id>, "targetId": <resource_id>}
- {"type": "build", "unitId": <worker_id>, "buildingType": "<type>", "x": <x>, "y": <y>}
- {"type": "train", "buildingId": <id>, "unitType": "<type>"}

Current game state:
${JSON.stringify(gameState, null, 2)}

User request: ${message.content?.text}

Respond with ONLY a JSON array of commands, no other text.`;

            const commandsText = await generateText({
                runtime,
                context: commandPrompt,
                modelClass: ModelClass.LARGE,
            });

            // Parse the commands from LLM response
            const jsonMatch = commandsText.match(/\[[\s\S]*\]/);
            if (!jsonMatch) {
                await callback({
                    text: "I couldn't determine the right commands. Could you be more specific?",
                });
                return false;
            }

            const commands = JSON.parse(jsonMatch[0]);

            const result = (await apiRequest(
                "POST",
                `/games/${session.gameId}/commands`,
                { commands },
                session
            )) as Record<string, unknown>;

            await callback({
                text: `Commands sent! ${result.accepted} command(s) accepted.\nCommands: ${JSON.stringify(commands, null, 2)}`,
            });

            return true;
        } catch (error) {
            await callback({
                text: `Error sending commands: ${(error as Error).message}`,
            });
            return false;
        }
    },
};

// ---------------------------------------------------------------------------
// Action: JOIN_GAME
// ---------------------------------------------------------------------------

const joinGameAction: Action = {
    name: "JOIN_GAME",
    description: "Join an existing RTS game by its game ID.",
    similes: ["ENTER_GAME", "CONNECT_GAME", "JOIN_MATCH"],
    examples: [
        [
            {
                user: "{{user1}}",
                content: { text: "Join game abc-123" },
            },
            {
                user: "{{agentName}}",
                content: {
                    text: "Joining game abc-123 now...",
                    action: "JOIN_GAME",
                },
            },
        ],
    ] as ActionExample[][],

    validate: async (
        _runtime: IAgentRuntime,
        message: Memory
    ): Promise<boolean> => {
        const text = (message.content?.text || "").toLowerCase();
        return text.includes("join") && text.includes("game");
    },

    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        _state: State | undefined,
        _options: Record<string, unknown>,
        callback: HandlerCallback
    ): Promise<boolean> => {
        const roomId = message.roomId;
        const text = message.content?.text || "";
        const playerName =
            (message.content?.playerName as string) || "ElizaBot";

        // Extract game ID from message (look for UUID-like or short ID patterns)
        const idMatch = text.match(
            /(?:game\s+)?([a-f0-9-]{6,36})/i
        );
        if (!idMatch) {
            await callback({
                text: "Please provide a game ID. Example: 'join game abc-123'",
            });
            return false;
        }

        const gameId = idMatch[1];

        try {
            const result = (await apiRequest("POST", `/games/${gameId}/join`, {
                playerName,
                playerType: "ai",
            })) as Record<string, unknown>;

            const session: GameSession = {
                gameId,
                token: result.token as string,
                playerId: result.playerId as number,
                tick: 0,
            };
            sessions.set(roomId, session);

            await callback({
                text: `Joined game ${gameId} as ${playerName}! Waiting for the game to start.`,
            });
            return true;
        } catch (error) {
            await callback({
                text: `Failed to join game: ${(error as Error).message}`,
            });
            return false;
        }
    },
};

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

export const rtsPlugin: Plugin = {
    name: "rts-game",
    description:
        "Play a real-time strategy game. Create games, command units, " +
        "gather resources, build bases, and destroy enemies.",
    actions: [createGameAction, getStateAction, sendCommandsAction, joinGameAction],
    evaluators: [],
    providers: [],
};

export default rtsPlugin;
