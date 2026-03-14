"""
LangChain Agent for Script RTS Game
====================================

A LangChain agent that plays the RTS game using the REST API.
Uses LangChain tools to create games, read state, and send commands.

Usage:
    export OPENAI_API_KEY=sk-...       # or ANTHROPIC_API_KEY
    export RTS_API_URL=https://script-rts-game.azurewebsites.net
    python agent.py
"""

import os
import json
import time
from typing import Optional

import requests
from langchain_core.tools import tool
from langchain_core.messages import HumanMessage, SystemMessage
from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

BASE_URL = os.environ.get("RTS_API_URL", "https://script-rts-game.azurewebsites.net")
API = f"{BASE_URL}/api"

# Session state shared across tools
_session = {
    "game_id": None,
    "token": None,
    "player_id": None,
    "tick": 0,
}


def _headers() -> dict:
    """Return auth headers for API calls."""
    h = {"Content-Type": "application/json"}
    if _session["token"]:
        h["Authorization"] = f"Bearer {_session['token']}"
    return h


# ---------------------------------------------------------------------------
# LangChain Tools
# ---------------------------------------------------------------------------

@tool
def create_game(player_name: str, map_width: int = 128, map_height: int = 128) -> str:
    """Create a new RTS game and join as the host player.

    Args:
        player_name: Your player name.
        map_width: Map width in tiles (default 128).
        map_height: Map height in tiles (default 128).

    Returns:
        JSON with gameId and token on success, or error message.
    """
    try:
        resp = requests.post(f"{API}/games", json={
            "playerName": player_name,
            "playerType": "ai",
            "config": {
                "mapWidth": map_width,
                "mapHeight": map_height,
            },
        }, headers={"Content-Type": "application/json"}, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        _session["game_id"] = data.get("gameId")
        _session["token"] = data.get("token")
        _session["player_id"] = data.get("playerId")
        return json.dumps(data, indent=2)
    except requests.RequestException as e:
        return f"Error creating game: {e}"


@tool
def add_bot_and_start() -> str:
    """Add a bot opponent to the current game and start the match.

    Returns:
        Status message indicating success or failure.
    """
    if not _session["game_id"] or not _session["token"]:
        return "Error: No active game. Call create_game first."

    gid = _session["game_id"]
    headers = _headers()
    results = []

    try:
        # Add a bot
        resp = requests.post(f"{API}/games/{gid}/add-bot", headers=headers, timeout=10)
        resp.raise_for_status()
        results.append(f"Bot added: {resp.json()}")

        # Start the game
        resp = requests.post(f"{API}/games/{gid}/start", headers=headers, timeout=10)
        resp.raise_for_status()
        results.append("Game started!")
        return "\n".join(results)
    except requests.RequestException as e:
        return f"Error: {e}"


@tool
def get_state() -> str:
    """Get the current game state including resources, units, buildings, and visible map.

    Returns:
        JSON game state with tick, resources, units, buildings, and enemy info.
    """
    if not _session["game_id"] or not _session["token"]:
        return "Error: No active game."

    gid = _session["game_id"]
    try:
        resp = requests.get(
            f"{API}/games/{gid}/state",
            headers=_headers(),
            params={"since": _session["tick"]},
            timeout=10,
        )
        if resp.status_code == 304:
            return "No state change since last check."
        resp.raise_for_status()
        state = resp.json()
        _session["tick"] = state.get("tick", _session["tick"])

        # Summarize for the LLM to keep context manageable
        summary = {
            "tick": state.get("tick"),
            "status": state.get("status"),
            "resources": state.get("resources"),
            "units": [
                {"id": u.get("id"), "type": u.get("type"), "hp": u.get("hp"),
                 "x": u.get("x"), "y": u.get("y"), "state": u.get("state")}
                for u in state.get("units", [])
            ],
            "buildings": [
                {"id": b.get("id"), "type": b.get("type"), "hp": b.get("hp"),
                 "x": b.get("x"), "y": b.get("y"), "complete": b.get("complete")}
                for b in state.get("buildings", [])
            ],
            "enemies_visible": len(state.get("enemyUnits", [])),
            "enemy_buildings_visible": len(state.get("enemyBuildings", [])),
        }
        if state.get("winner") is not None:
            summary["winner"] = state["winner"]
        return json.dumps(summary, indent=2)
    except requests.RequestException as e:
        return f"Error getting state: {e}"


@tool
def send_commands(commands_json: str) -> str:
    """Send commands to your units and buildings.

    Args:
        commands_json: A JSON string containing a list of command objects.
            Each command needs a 'type' field. Common command types:
            - {"type": "move", "unitId": <id>, "x": <x>, "y": <y>}
            - {"type": "attack", "unitId": <id>, "targetId": <id>}
            - {"type": "gather", "unitId": <id>, "targetId": <resource_id>}
            - {"type": "build", "unitId": <worker_id>, "buildingType": "<type>", "x": <x>, "y": <y>}
            - {"type": "train", "buildingId": <id>, "unitType": "<type>"}

    Returns:
        Number of commands accepted, or error message.
    """
    if not _session["game_id"] or not _session["token"]:
        return "Error: No active game."

    try:
        commands = json.loads(commands_json)
    except json.JSONDecodeError as e:
        return f"Invalid JSON: {e}"

    if not isinstance(commands, list):
        commands = [commands]

    gid = _session["game_id"]
    try:
        resp = requests.post(
            f"{API}/games/{gid}/commands",
            json={"commands": commands},
            headers=_headers(),
            timeout=10,
        )
        resp.raise_for_status()
        return json.dumps(resp.json())
    except requests.RequestException as e:
        return f"Error sending commands: {e}"


@tool
def submit_script(code: str) -> str:
    """Submit a JavaScript automation script that runs each tick.

    The script receives the game state and returns commands automatically.
    This is an alternative to manually calling send_commands each tick.

    Args:
        code: JavaScript code string. The script has access to `state` (game state)
              and must return an array of command objects.

    Returns:
        Compilation result (success or error details).
    """
    if not _session["game_id"] or not _session["token"]:
        return "Error: No active game."

    gid = _session["game_id"]
    try:
        resp = requests.post(
            f"{API}/games/{gid}/script",
            json={"code": code},
            headers=_headers(),
            timeout=10,
        )
        resp.raise_for_status()
        return json.dumps(resp.json())
    except requests.RequestException as e:
        return f"Error submitting script: {e}"


# ---------------------------------------------------------------------------
# Agent setup
# ---------------------------------------------------------------------------

TOOLS = [create_game, add_bot_and_start, get_state, send_commands, submit_script]

SYSTEM_PROMPT = """\
You are an AI commander playing a real-time strategy game via its REST API.

Your goal is to win the game by gathering resources, building structures,
training an army, and defeating the enemy.

Strategy guidelines:
1. Start by checking the game state to understand your units and resources.
2. Send workers to gather nearby resources (gold, wood).
3. Build production buildings (barracks, archery range) when you have enough resources.
4. Train military units and scout the map.
5. Attack the enemy when you have a strong army.
6. Keep checking state and adapting your strategy.

Available command types:
- move: Move a unit to (x, y)
- attack: Attack a target unit/building
- gather: Send a worker to gather a resource
- build: Order a worker to build a structure
- train: Train a unit from a building

Always check the game state before sending commands to know your current
units, resources, and what the enemy is doing. The game runs in ticks --
poll state and send commands in a loop until the game ends.
"""


def create_agent(use_anthropic: bool = False):
    """Create and return the LangChain agent executor.

    Args:
        use_anthropic: If True, use ChatAnthropic; otherwise use ChatOpenAI.
    """
    if use_anthropic:
        from langchain_anthropic import ChatAnthropic
        llm = ChatAnthropic(model="claude-sonnet-4-20250514", temperature=0)
    else:
        from langchain_openai import ChatOpenAI
        llm = ChatOpenAI(model="gpt-4o", temperature=0)

    prompt = ChatPromptTemplate.from_messages([
        SystemMessage(content=SYSTEM_PROMPT),
        MessagesPlaceholder(variable_name="chat_history", optional=True),
        ("human", "{input}"),
        MessagesPlaceholder(variable_name="agent_scratchpad"),
    ])

    agent = create_tool_calling_agent(llm, TOOLS, prompt)
    return AgentExecutor(agent=agent, tools=TOOLS, verbose=True, max_iterations=50)


# ---------------------------------------------------------------------------
# Game loop
# ---------------------------------------------------------------------------

def play_game(agent_executor: AgentExecutor):
    """Run the full game loop: create, start, play until finished."""

    print("=== Creating game ===")
    result = agent_executor.invoke({
        "input": (
            "Create a new game with player name 'LangChainBot', "
            "add a bot opponent, and start the game."
        ),
    })
    print(result["output"])

    # Play loop
    turn = 0
    while turn < 200:
        turn += 1
        print(f"\n=== Turn {turn} ===")
        result = agent_executor.invoke({
            "input": (
                "Check the game state. If the game is over, say 'GAME OVER' and "
                "report who won. Otherwise, analyze the situation and send "
                "appropriate commands to gather resources, build, train units, "
                "and attack enemies."
            ),
        })
        output = result["output"]
        print(output)

        if "GAME OVER" in output.upper():
            print("\n=== Game finished ===")
            break

        # Wait a bit between turns to let the game simulation advance
        time.sleep(2)

    print(f"\nCompleted after {turn} turns.")


def main():
    use_anthropic = bool(os.environ.get("ANTHROPIC_API_KEY"))
    agent_executor = create_agent(use_anthropic=use_anthropic)
    play_game(agent_executor)


if __name__ == "__main__":
    main()
