"""
Coinbase AgentKit RTS Game Agent
=================================

An AI agent that uses Coinbase AgentKit with an agentic wallet to:
- Authenticate via EIP-191 wallet signature
- Register as an ERC-8004 on-chain agent
- Play RTS games with on-chain identity and reputation tracking
- Make micropayments for premium features via x402

Usage:
    export CDP_API_KEY_NAME=...
    export CDP_API_KEY_PRIVATE_KEY=...
    export OPENAI_API_KEY=sk-...
    export RTS_API_URL=https://script-rts-game.azurewebsites.net
    python agent.py
"""

import os
import json
import time
from typing import Optional

import requests
from eth_account.messages import encode_defunct
from langchain_core.tools import tool
from langchain_core.messages import SystemMessage
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_openai import ChatOpenAI
from langchain.agents import AgentExecutor, create_tool_calling_agent

from coinbase_agentkit import (
    AgentKit,
    AgentKitConfig,
    CdpWalletProvider,
    CdpWalletProviderConfig,
)
from coinbase_agentkit_langchain import get_langchain_tools

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

BASE_URL = os.environ.get("RTS_API_URL", "https://script-rts-game.azurewebsites.net")
API = f"{BASE_URL}/api"

_session = {
    "game_id": None,
    "token": None,           # Bearer token from wallet auth
    "player_id": None,
    "agent_id": None,         # ERC-8004 agent ID
    "wallet_address": None,
    "tick": 0,
}


def _headers() -> dict:
    h = {"Content-Type": "application/json"}
    if _session["token"]:
        h["Authorization"] = f"Bearer {_session['token']}"
    return h


# ---------------------------------------------------------------------------
# Wallet authentication (EIP-191)
# ---------------------------------------------------------------------------

def wallet_auth(agentkit: AgentKit) -> str:
    """Authenticate with the RTS server using wallet signature.

    Flow:
    1. Request nonce from server
    2. Sign nonce with agentic wallet (EIP-191 personal_sign)
    3. Submit signature to get bearer token

    Returns:
        Bearer token string.
    """
    wallet = agentkit.wallet_provider
    address = wallet.get_address()
    _session["wallet_address"] = address

    print(f"[Auth] Authenticating wallet: {address}")

    # Step 1: Request nonce
    resp = requests.get(
        f"{API}/auth/nonce",
        params={"address": address},
        timeout=10,
    )
    resp.raise_for_status()
    nonce_data = resp.json()
    nonce = nonce_data["nonce"]
    message = nonce_data["message"]

    print(f"[Auth] Got nonce, signing message...")

    # Step 2: Sign the message with the agentic wallet
    # The wallet provider signs EIP-191 personal messages
    signature = wallet.sign_message(message)

    # Step 3: Submit signature to get bearer token
    resp = requests.post(
        f"{API}/auth/verify",
        json={
            "address": address,
            "signature": signature,
            "nonce": nonce,
        },
        headers={"Content-Type": "application/json"},
        timeout=10,
    )
    resp.raise_for_status()
    auth_data = resp.json()

    _session["token"] = auth_data["token"]
    print(f"[Auth] Authenticated! Agent ID: {auth_data.get('agentId')}")
    return auth_data["token"]


# ---------------------------------------------------------------------------
# ERC-8004 agent registration
# ---------------------------------------------------------------------------

def register_erc8004_agent(agent_name: str = "AgentKit-RTS-Player") -> dict:
    """Register as an ERC-8004 on-chain agent.

    This creates an agent identity tied to the wallet address,
    with on-chain registration on Base Sepolia.

    Returns:
        Registration result with agent ID and on-chain identity.
    """
    address = _session["wallet_address"]
    if not address:
        raise RuntimeError("Must authenticate wallet first")

    print(f"[ERC-8004] Registering agent '{agent_name}' for wallet {address}")

    resp = requests.post(
        f"{API}/agents/register",
        json={
            "walletAddress": address,
            "name": agent_name,
        },
        headers={"Content-Type": "application/json"},
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()

    _session["agent_id"] = data.get("agent", {}).get("agentId")
    print(f"[ERC-8004] Agent registered: ID={_session['agent_id']}")
    print(f"[ERC-8004] On-chain: {data.get('onChain', False)}")
    if data.get("identity", {}).get("fullId"):
        print(f"[ERC-8004] Full ID: {data['identity']['fullId']}")

    return data


# ---------------------------------------------------------------------------
# Game tools
# ---------------------------------------------------------------------------

@tool
def create_game(player_name: str) -> str:
    """Create a new RTS game and join as the host player.

    Args:
        player_name: Your player name.

    Returns:
        Game creation result with gameId and token.
    """
    try:
        resp = requests.post(f"{API}/games", json={
            "playerName": player_name,
            "playerType": "ai",
            "config": {"mapWidth": 128, "mapHeight": 128},
        }, headers=_headers(), timeout=10)
        resp.raise_for_status()
        data = resp.json()
        _session["game_id"] = data.get("gameId")
        # Use the game-specific token for commands (keep wallet token for auth)
        _session["token"] = data.get("token")
        _session["player_id"] = data.get("playerId")
        return json.dumps(data, indent=2)
    except requests.RequestException as e:
        return f"Error: {e}"


@tool
def add_bot_and_start() -> str:
    """Add a bot opponent and start the game.

    Returns:
        Status message.
    """
    if not _session["game_id"]:
        return "No active game."
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


@tool
def get_state() -> str:
    """Get the current game state.

    Returns:
        JSON with tick, resources, units, buildings, enemies.
    """
    if not _session["game_id"]:
        return "No active game."
    try:
        resp = requests.get(
            f"{API}/games/{_session['game_id']}/state",
            headers=_headers(),
            params={"since": _session["tick"]},
            timeout=10,
        )
        if resp.status_code == 304:
            return "No state change."
        resp.raise_for_status()
        state = resp.json()
        _session["tick"] = state.get("tick", 0)

        summary = {
            "tick": state.get("tick"),
            "status": state.get("status"),
            "resources": state.get("resources"),
            "units": [
                {"id": u["id"], "type": u.get("type"), "hp": u.get("hp"),
                 "x": u.get("x"), "y": u.get("y"), "state": u.get("state")}
                for u in state.get("units", [])
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
        return json.dumps(summary, indent=2)
    except requests.RequestException as e:
        return f"Error: {e}"


@tool
def send_commands(commands_json: str) -> str:
    """Send commands to your units.

    Args:
        commands_json: JSON array of commands. Types: move, attack, gather, build, train.
            Example: [{"type":"gather","unitId":1,"targetId":5}]

    Returns:
        Acceptance result.
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


@tool
def check_agent_reputation() -> str:
    """Check the on-chain reputation of this agent.

    Returns:
        Reputation data including ELO, wins, losses, and on-chain status.
    """
    if not _session["agent_id"]:
        return "Agent not registered. Register first."
    try:
        resp = requests.get(
            f"{API}/agents/{_session['agent_id']}/reputation",
            timeout=10,
        )
        resp.raise_for_status()
        return json.dumps(resp.json(), indent=2)
    except requests.RequestException as e:
        return f"Error: {e}"


@tool
def submit_script(code: str) -> str:
    """Submit a JavaScript automation script.

    Args:
        code: JavaScript code that receives game state and returns commands.

    Returns:
        Compilation result.
    """
    if not _session["game_id"]:
        return "No active game."
    try:
        resp = requests.post(
            f"{API}/games/{_session['game_id']}/script",
            json={"code": code},
            headers=_headers(),
            timeout=10,
        )
        resp.raise_for_status()
        return json.dumps(resp.json())
    except requests.RequestException as e:
        return f"Error: {e}"


# ---------------------------------------------------------------------------
# Agent setup & game loop
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
You are an AI agent with an on-chain identity (ERC-8004) playing a real-time
strategy game. Your wallet address is your persistent identity, and your
game performance is tracked on-chain as reputation.

Your goal is to win RTS games by gathering resources, building a base,
training an army, and defeating the enemy.

Strategy:
1. Check game state to understand the situation.
2. Send workers to gather gold and wood.
3. Build barracks and other military structures.
4. Train soldiers and scout the map.
5. Attack enemy base when ready.
6. Keep adapting based on what you see.

You have on-chain reputation at stake -- win to improve your ELO and reputation!
"""

GAME_TOOLS = [
    create_game,
    add_bot_and_start,
    get_state,
    send_commands,
    submit_script,
    check_agent_reputation,
]


def create_agentkit_agent():
    """Create the AgentKit agent with wallet and game tools."""

    # Initialize CDP wallet provider
    wallet_config = CdpWalletProviderConfig(
        api_key_name=os.environ.get("CDP_API_KEY_NAME"),
        api_key_private_key=os.environ.get("CDP_API_KEY_PRIVATE_KEY"),
        network_id=os.environ.get("CDP_NETWORK_ID", "base-sepolia"),
    )
    wallet_provider = CdpWalletProvider(wallet_config)

    # Initialize AgentKit
    agentkit = AgentKit(AgentKitConfig(wallet_provider=wallet_provider))

    # Get AgentKit built-in tools (wallet operations, transfers, etc.)
    agentkit_tools = get_langchain_tools(agentkit)

    # Combine with RTS game tools
    all_tools = agentkit_tools + GAME_TOOLS

    # Create LLM and agent
    llm = ChatOpenAI(model="gpt-4o", temperature=0)

    prompt = ChatPromptTemplate.from_messages([
        SystemMessage(content=SYSTEM_PROMPT),
        MessagesPlaceholder(variable_name="chat_history", optional=True),
        ("human", "{input}"),
        MessagesPlaceholder(variable_name="agent_scratchpad"),
    ])

    agent = create_tool_calling_agent(llm, all_tools, prompt)
    executor = AgentExecutor(
        agent=agent,
        tools=all_tools,
        verbose=True,
        max_iterations=50,
    )

    return agentkit, executor


def play_game():
    """Full game loop with wallet auth and on-chain identity."""

    print("=" * 60)
    print("Coinbase AgentKit RTS Player")
    print("=" * 60)

    # Initialize agent
    agentkit, executor = create_agentkit_agent()

    # Authenticate with wallet
    print("\n--- Wallet Authentication ---")
    wallet_auth(agentkit)
    print(f"Wallet: {_session['wallet_address']}")

    # Register as ERC-8004 agent
    print("\n--- ERC-8004 Registration ---")
    reg = register_erc8004_agent("AgentKit-Commander")
    print(f"Agent ID: {_session['agent_id']}")

    # Create and play game
    print("\n--- Starting Game ---")
    result = executor.invoke({
        "input": (
            "Create a new RTS game with player name 'AgentKit-Commander', "
            "add a bot, and start the game."
        ),
    })
    print(result["output"])

    # Game loop
    for turn in range(1, 101):
        print(f"\n--- Turn {turn} ---")
        result = executor.invoke({
            "input": (
                "Check the game state. If the game is over, report the winner "
                "and check your agent reputation. Otherwise, issue commands to "
                "gather resources, build, train units, and attack."
            ),
        })
        output = result["output"]
        print(output)

        if "GAME OVER" in output.upper() or "winner" in output.lower():
            # Check final reputation
            print("\n--- Final Reputation ---")
            result = executor.invoke({
                "input": "Check your agent reputation to see your updated ELO and stats.",
            })
            print(result["output"])
            break

        time.sleep(2)

    print("\n=== Session complete ===")
    print(f"Wallet: {_session['wallet_address']}")
    print(f"Agent ID: {_session['agent_id']}")


if __name__ == "__main__":
    play_game()
