"""
CrewAI RTS Game Crew
=====================

A multi-agent crew that plays the RTS game with specialized roles:
- Scout Agent: explores the map and reports enemy positions
- Economy Agent: manages resource gathering and building construction
- Military Agent: handles unit training and combat operations
- Commander Agent: coordinates overall strategy

Usage:
    export OPENAI_API_KEY=sk-...
    export RTS_API_URL=https://script-rts-game.azurewebsites.net
    python rts_crew.py
"""

import os
import json
import time

import requests
from crewai import Agent, Crew, Task, Process
from crewai.tools import tool

# ---------------------------------------------------------------------------
# Configuration & shared state
# ---------------------------------------------------------------------------

BASE_URL = os.environ.get("RTS_API_URL", "https://script-rts-game.azurewebsites.net")
API = f"{BASE_URL}/api"

_session = {
    "game_id": None,
    "token": None,
    "player_id": None,
    "tick": 0,
    "last_state": None,
}


def _headers() -> dict:
    h = {"Content-Type": "application/json"}
    if _session["token"]:
        h["Authorization"] = f"Bearer {_session['token']}"
    return h


# ---------------------------------------------------------------------------
# Shared tools (available to all agents)
# ---------------------------------------------------------------------------

@tool
def create_and_start_game(player_name: str) -> str:
    """Create a new RTS game, add a bot opponent, and start the match.

    Args:
        player_name: Name for the AI player.

    Returns:
        Game creation result with gameId and token.
    """
    try:
        # Create game
        resp = requests.post(f"{API}/games", json={
            "playerName": player_name,
            "playerType": "ai",
            "config": {"mapWidth": 128, "mapHeight": 128},
        }, headers={"Content-Type": "application/json"}, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        _session["game_id"] = data.get("gameId")
        _session["token"] = data.get("token")
        _session["player_id"] = data.get("playerId")

        gid = _session["game_id"]
        headers = _headers()

        # Add bot
        resp = requests.post(f"{API}/games/{gid}/add-bot", headers=headers, timeout=10)
        resp.raise_for_status()

        # Start
        resp = requests.post(f"{API}/games/{gid}/start", headers=headers, timeout=10)
        resp.raise_for_status()

        return json.dumps({"gameId": gid, "status": "started", **data}, indent=2)
    except requests.RequestException as e:
        return f"Error: {e}"


@tool
def get_game_state() -> str:
    """Get the current game state including units, buildings, resources, and enemies.

    Returns:
        Full game state as JSON.
    """
    if not _session["game_id"]:
        return "No active game."
    try:
        resp = requests.get(
            f"{API}/games/{_session['game_id']}/state",
            headers=_headers(),
            timeout=10,
        )
        if resp.status_code == 304:
            return json.dumps(_session["last_state"]) if _session["last_state"] else "No changes."
        resp.raise_for_status()
        state = resp.json()
        _session["tick"] = state.get("tick", 0)
        _session["last_state"] = state
        return json.dumps(state, indent=2)
    except requests.RequestException as e:
        return f"Error: {e}"


@tool
def send_game_commands(commands_json: str) -> str:
    """Send an array of commands to the game.

    Args:
        commands_json: JSON string of command array. Each command needs 'type'.
            Types: move, attack, gather, build, train.
            Example: [{"type":"gather","unitId":1,"targetId":5}]

    Returns:
        Number of commands accepted.
    """
    if not _session["game_id"]:
        return "No active game."
    try:
        commands = json.loads(commands_json)
        if not isinstance(commands, list):
            commands = [commands]
        resp = requests.post(
            f"{API}/games/{_session['game_id']}/commands",
            json={"commands": commands},
            headers=_headers(),
            timeout=10,
        )
        resp.raise_for_status()
        return json.dumps(resp.json())
    except (json.JSONDecodeError, requests.RequestException) as e:
        return f"Error: {e}"


# ---------------------------------------------------------------------------
# Agent definitions
# ---------------------------------------------------------------------------

common_tools = [get_game_state, send_game_commands]

scout_agent = Agent(
    role="Scout Commander",
    goal="Explore the map, find enemy positions, and locate resource deposits.",
    backstory=(
        "You are an elite reconnaissance specialist. Your job is to send "
        "fast units to uncharted areas of the map and report back on enemy "
        "base locations, army composition, and resource nodes. You use move "
        "commands to send scouts across the map."
    ),
    tools=common_tools,
    verbose=True,
    allow_delegation=False,
)

economy_agent = Agent(
    role="Economy Manager",
    goal="Maximize resource income and build infrastructure efficiently.",
    backstory=(
        "You are a master of logistics and supply chains. Your job is to "
        "ensure workers are gathering gold and wood, construct buildings "
        "in optimal locations, and expand the base economy. You use gather "
        "and build commands."
    ),
    tools=common_tools,
    verbose=True,
    allow_delegation=False,
)

military_agent = Agent(
    role="Military Commander",
    goal="Train combat units and destroy the enemy.",
    backstory=(
        "You are a seasoned battlefield commander. Your job is to train "
        "soldiers from barracks and other military buildings, organize them "
        "into attack groups, and lead assaults on the enemy base. You use "
        "train and attack commands."
    ),
    tools=common_tools,
    verbose=True,
    allow_delegation=False,
)

commander_agent = Agent(
    role="Supreme Commander",
    goal="Coordinate all agents and decide the overall strategy to win.",
    backstory=(
        "You are the supreme commander overseeing the entire operation. "
        "You analyze reports from scouts, economy status, and military "
        "strength to decide the grand strategy: when to expand, when to "
        "attack, and how to allocate resources between economy and military."
    ),
    tools=[get_game_state, send_game_commands, create_and_start_game],
    verbose=True,
    allow_delegation=True,
)


# ---------------------------------------------------------------------------
# Task definitions
# ---------------------------------------------------------------------------

def create_setup_task() -> Task:
    return Task(
        description=(
            "Create a new RTS game with player name 'CrewAI_Commander', "
            "add a bot opponent, and start the match. Report the game ID."
        ),
        expected_output="Game ID and confirmation that the game has started.",
        agent=commander_agent,
    )


def create_scout_task() -> Task:
    return Task(
        description=(
            "Get the current game state. Identify any units that can be used "
            "as scouts (fast or expendable units). Send them to explore "
            "unexplored areas of the map. Report what you find: enemy positions, "
            "resource locations, and map features."
        ),
        expected_output=(
            "A scouting report with enemy locations, resource positions, "
            "and recommended areas to explore next."
        ),
        agent=scout_agent,
    )


def create_economy_task() -> Task:
    return Task(
        description=(
            "Get the current game state. Ensure all worker units are gathering "
            "resources (gold and wood). If we have enough resources, build "
            "production buildings (barracks, etc). If we need more workers, "
            "train them from the town center. Prioritize: workers gathering > "
            "build barracks > expand."
        ),
        expected_output=(
            "Summary of economic actions taken: workers assigned, buildings "
            "started, resource income status."
        ),
        agent=economy_agent,
    )


def create_military_task() -> Task:
    return Task(
        description=(
            "Get the current game state. Train military units from available "
            "barracks and military buildings. If we have enough soldiers and "
            "know where the enemy is, organize an attack force and send them "
            "to assault the enemy base. Protect our own base if under attack."
        ),
        expected_output=(
            "Summary of military actions: units trained, attacks launched, "
            "defensive measures taken."
        ),
        agent=military_agent,
    )


def create_strategy_task() -> Task:
    return Task(
        description=(
            "Review the game state and reports from the scout, economy, and "
            "military agents. Decide the overall strategy for the next phase: "
            "should we focus on economy, go aggressive, or defend? Issue any "
            "high-level commands to adjust the plan. Check if the game is "
            "over and report the result."
        ),
        expected_output=(
            "Strategic assessment and orders for next phase. If game is over, "
            "report the winner."
        ),
        agent=commander_agent,
    )


# ---------------------------------------------------------------------------
# Crew assembly & game loop
# ---------------------------------------------------------------------------

def run_game():
    """Run the full RTS game with the CrewAI crew."""

    # Phase 1: Setup
    print("=" * 60)
    print("PHASE 1: Game Setup")
    print("=" * 60)

    setup_crew = Crew(
        agents=[commander_agent],
        tasks=[create_setup_task()],
        process=Process.sequential,
        verbose=True,
    )
    setup_result = setup_crew.kickoff()
    print(f"Setup result: {setup_result}")

    # Phase 2: Game loop
    for turn in range(1, 51):
        print(f"\n{'=' * 60}")
        print(f"TURN {turn}")
        print("=" * 60)

        # Each turn runs scout -> economy -> military -> commander
        turn_crew = Crew(
            agents=[scout_agent, economy_agent, military_agent, commander_agent],
            tasks=[
                create_scout_task(),
                create_economy_task(),
                create_military_task(),
                create_strategy_task(),
            ],
            process=Process.sequential,
            verbose=True,
        )

        result = turn_crew.kickoff()
        output = str(result)
        print(f"Turn {turn} result: {output}")

        if "game over" in output.lower() or "winner" in output.lower():
            print(f"\nGame ended at turn {turn}!")
            break

        # Allow game simulation to advance
        time.sleep(3)

    print("\n=== Game session complete ===")


if __name__ == "__main__":
    run_game()
