"""
AutoGPT Plugin for Script RTS Game
====================================

Implements the AutoGPT plugin interface to let AutoGPT play the RTS game.
Provides tools for game creation, state reading, and command submission.

Installation:
    1. Copy this directory into AutoGPT's plugins/ folder
    2. Add "ScriptRTSPlugin" to ALLOWLISTED_PLUGINS in .env
    3. Set RTS_API_URL in .env (optional, defaults to Azure deployment)

Plugin interface reference:
    https://github.com/Significant-Gravitas/AutoGPT/blob/master/autogpts/autogpt/autogpt/plugins/plugin_protocol.py
"""

import os
import json
from typing import Any, Dict, List, Optional, TypeVar

import requests

PromptGenerator = TypeVar("PromptGenerator")


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

BASE_URL = os.environ.get("RTS_API_URL", "https://script-rts-game.azurewebsites.net")
API = f"{BASE_URL}/api"

_session: Dict[str, Any] = {
    "game_id": None,
    "token": None,
    "player_id": None,
}


def _headers() -> dict:
    h = {"Content-Type": "application/json"}
    if _session["token"]:
        h["Authorization"] = f"Bearer {_session['token']}"
    return h


# ---------------------------------------------------------------------------
# Plugin class
# ---------------------------------------------------------------------------

class ScriptRTSPlugin:
    """AutoGPT plugin that enables playing the Script RTS game."""

    def __init__(self):
        self._name = "Script RTS Game"
        self._version = "1.0.0"
        self._description = (
            "Play a real-time strategy game via REST API. "
            "Create games, manage resources, train units, and defeat enemies."
        )

    # -- Plugin metadata ---------------------------------------------------

    def can_handle_on_response(self) -> bool:
        return False

    def can_handle_on_planning(self) -> bool:
        return False

    def can_handle_post_planning(self) -> bool:
        return False

    def can_handle_pre_instruction(self) -> bool:
        return False

    def can_handle_on_instruction(self) -> bool:
        return False

    def can_handle_post_instruction(self) -> bool:
        return False

    def can_handle_pre_command(self) -> bool:
        return False

    def can_handle_post_command(self) -> bool:
        return False

    def can_handle_chat_completion(
        self,
        messages: List[Dict[str, str]],
        model: str,
        temperature: float,
        max_tokens: int,
    ) -> bool:
        return False

    def can_handle_text_embedding(self, text: str) -> bool:
        return False

    def can_handle_user_input(self, user_input: str) -> bool:
        return False

    def can_handle_report(self) -> bool:
        return False

    # -- Post-prompt: inject RTS game commands into AutoGPT's prompt ------

    def post_prompt(self, prompt: PromptGenerator) -> PromptGenerator:
        """Add RTS game commands to AutoGPT's available commands."""

        prompt.add_command(
            "rts_create_game",
            "Create a new RTS game and join as host",
            {"player_name": "<name>"},
            _cmd_create_game,
        )
        prompt.add_command(
            "rts_add_bot_and_start",
            "Add a bot opponent and start the current game",
            {},
            _cmd_add_bot_and_start,
        )
        prompt.add_command(
            "rts_get_state",
            "Get current game state (units, buildings, resources, enemies)",
            {},
            _cmd_get_state,
        )
        prompt.add_command(
            "rts_send_commands",
            "Send commands to your units and buildings",
            {"commands": "<JSON array of command objects>"},
            _cmd_send_commands,
        )
        prompt.add_command(
            "rts_submit_script",
            "Submit a JavaScript automation script that runs each tick",
            {"code": "<JavaScript code string>"},
            _cmd_submit_script,
        )
        prompt.add_command(
            "rts_get_log",
            "Get recent game log entries",
            {},
            _cmd_get_log,
        )

        # Add RTS context to the system prompt
        prompt.add_resource(
            "RTS Game Guide",
            "rts_guide",
            (
                "You can play an RTS game! Use rts_create_game to start, "
                "rts_add_bot_and_start to begin, then loop: "
                "rts_get_state to see the battlefield, rts_send_commands to "
                "issue orders. Command types: move, attack, gather, build, train. "
                "Gather resources with workers, build barracks, train soldiers, "
                "and destroy the enemy base to win."
            ),
        )

        return prompt


# ---------------------------------------------------------------------------
# Command implementations
# ---------------------------------------------------------------------------

def _cmd_create_game(player_name: str) -> str:
    """Create a game, join as host."""
    try:
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
        return json.dumps(data, indent=2)
    except requests.RequestException as e:
        return f"Error: {e}"


def _cmd_add_bot_and_start() -> str:
    """Add bot and start game."""
    if not _session["game_id"]:
        return "No active game. Use rts_create_game first."
    gid = _session["game_id"]
    headers = _headers()
    try:
        resp = requests.post(f"{API}/games/{gid}/add-bot", headers=headers, timeout=10)
        resp.raise_for_status()
        resp = requests.post(f"{API}/games/{gid}/start", headers=headers, timeout=10)
        resp.raise_for_status()
        return "Bot added and game started."
    except requests.RequestException as e:
        return f"Error: {e}"


def _cmd_get_state() -> str:
    """Get game state."""
    if not _session["game_id"]:
        return "No active game."
    try:
        resp = requests.get(
            f"{API}/games/{_session['game_id']}/state",
            headers=_headers(), timeout=10,
        )
        if resp.status_code == 304:
            return "No state changes."
        resp.raise_for_status()
        state = resp.json()
        # Return a condensed summary
        summary = {
            "tick": state.get("tick"),
            "status": state.get("status"),
            "resources": state.get("resources"),
            "unit_count": len(state.get("units", [])),
            "building_count": len(state.get("buildings", [])),
            "units": [
                {"id": u["id"], "type": u.get("type"), "hp": u.get("hp"),
                 "x": u.get("x"), "y": u.get("y")}
                for u in state.get("units", [])[:20]  # Cap at 20 for readability
            ],
            "buildings": [
                {"id": b["id"], "type": b.get("type"), "hp": b.get("hp"),
                 "x": b.get("x"), "y": b.get("y")}
                for b in state.get("buildings", [])
            ],
            "enemies_visible": len(state.get("enemyUnits", [])),
            "enemy_buildings_visible": len(state.get("enemyBuildings", [])),
        }
        if state.get("winner") is not None:
            summary["winner"] = state["winner"]
            summary["game_over"] = True
        return json.dumps(summary, indent=2)
    except requests.RequestException as e:
        return f"Error: {e}"


def _cmd_send_commands(commands: str) -> str:
    """Send commands to the game."""
    if not _session["game_id"]:
        return "No active game."
    try:
        cmd_list = json.loads(commands) if isinstance(commands, str) else commands
        if not isinstance(cmd_list, list):
            cmd_list = [cmd_list]
        resp = requests.post(
            f"{API}/games/{_session['game_id']}/commands",
            json={"commands": cmd_list},
            headers=_headers(), timeout=10,
        )
        resp.raise_for_status()
        return json.dumps(resp.json())
    except (json.JSONDecodeError, requests.RequestException) as e:
        return f"Error: {e}"


def _cmd_submit_script(code: str) -> str:
    """Submit a player script."""
    if not _session["game_id"]:
        return "No active game."
    try:
        resp = requests.post(
            f"{API}/games/{_session['game_id']}/script",
            json={"code": code},
            headers=_headers(), timeout=10,
        )
        resp.raise_for_status()
        return json.dumps(resp.json())
    except requests.RequestException as e:
        return f"Error: {e}"


def _cmd_get_log() -> str:
    """Get game log."""
    if not _session["game_id"]:
        return "No active game."
    try:
        resp = requests.get(
            f"{API}/games/{_session['game_id']}/log",
            headers=_headers(), timeout=10,
        )
        resp.raise_for_status()
        return json.dumps(resp.json(), indent=2)
    except requests.RequestException as e:
        return f"Error: {e}"


# ---------------------------------------------------------------------------
# Plugin manifest (for AutoGPT plugin loading)
# ---------------------------------------------------------------------------

plugin = ScriptRTSPlugin()
