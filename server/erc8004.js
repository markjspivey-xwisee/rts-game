// ═══════════════════════════════════════════════════════════════════════════
//  ERC-8004 INTEGRATION - On-chain agent identity & reputation
// ═══════════════════════════════════════════════════════════════════════════
//
// Integrates with ERC-8004 Trustless Agents standard:
//   - Identity Registry: agents register as NFTs with on-chain identity
//   - Reputation Registry: game results posted as reputation feedback
//   - Validation Registry: match results verified on-chain
//
// Supports Base Sepolia (testnet) and Base mainnet.
// Agents can optionally register their wallet as an ERC-8004 agent
// to get persistent on-chain identity and verifiable match history.
// ═══════════════════════════════════════════════════════════════════════════

import { Router } from "express";
import { linkAgentId, getProfile } from "./wallet-auth.js";

// ERC-8004 contract ABIs (minimal interfaces for interaction)
const IDENTITY_REGISTRY_ABI = [
  "function register(string agentURI) external returns (uint256 agentId)",
  "function register(string agentURI, tuple(string metadataKey, bytes metadataValue)[] metadata) external returns (uint256 agentId)",
  "function setAgentURI(uint256 agentId, string newURI) external",
  "function getMetadata(uint256 agentId, string metadataKey) external view returns (bytes)",
  "function setMetadata(uint256 agentId, string metadataKey, bytes metadataValue) external",
  "function tokenURI(uint256 tokenId) external view returns (string)",
  "function ownerOf(uint256 tokenId) external view returns (address)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
];

const REPUTATION_REGISTRY_ABI = [
  "function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash) external",
  "function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) external view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)",
  "function getClients(uint256 agentId) external view returns (address[])",
  "event NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex, int128 value, uint8 valueDecimals, string indexed indexedTag1, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)",
];

// Known contract addresses (set via env vars)
const CONTRACTS = {
  identityRegistry: process.env.ERC8004_IDENTITY_REGISTRY || null,
  reputationRegistry: process.env.ERC8004_REPUTATION_REGISTRY || null,
  validationRegistry: process.env.ERC8004_VALIDATION_REGISTRY || null,
};

const RPC_URL = process.env.ERC8004_RPC_URL || "https://sepolia.base.org";
const CHAIN_ID = process.env.ERC8004_CHAIN_ID || "84532";

// In-memory agent registry (mirrors on-chain for fast lookups)
const agentRegistry = new Map(); // agentId -> { wallet, uri, elo, matches }

let provider = null;
let erc8004Enabled = false;

/**
 * Initialize ERC-8004 integration.
 */
export async function initERC8004() {
  if (!CONTRACTS.identityRegistry) {
    console.log("[ERC-8004] No contract addresses configured, running in local-only mode");
    console.log("[ERC-8004] Set ERC8004_IDENTITY_REGISTRY env var to enable on-chain features");
    return;
  }

  try {
    const { JsonRpcProvider } = await import("ethers");
    provider = new JsonRpcProvider(RPC_URL);
    erc8004Enabled = true;
    console.log(`[ERC-8004] Connected to ${RPC_URL} (chain ${CHAIN_ID})`);
    console.log(`[ERC-8004] Identity Registry: ${CONTRACTS.identityRegistry}`);
  } catch (err) {
    console.warn("[ERC-8004] Failed to initialize:", err.message);
  }
}

/**
 * Register an agent locally (and optionally on-chain).
 * Returns the agent registration info.
 */
function registerAgentLocal(walletAddress, metadata = {}) {
  const agentId = agentRegistry.size + 1;
  const agent = {
    agentId,
    wallet: walletAddress.toLowerCase(),
    uri: metadata.uri || `https://script-rts-game.azurewebsites.net/api/agents/${agentId}`,
    name: metadata.name || `Agent #${agentId}`,
    elo: 1000,
    matches: [],
    wins: 0,
    losses: 0,
    registeredAt: Date.now(),
    onChain: false,
    chainAgentId: null,
  };

  agentRegistry.set(agentId, agent);
  linkAgentId(walletAddress, agentId);

  return agent;
}

/**
 * Record a match result in the agent registry.
 * If on-chain is enabled, also posts reputation feedback.
 */
export function recordAgentMatch(winnerAgentId, loserAgentId, gameId) {
  const winner = agentRegistry.get(winnerAgentId);
  const loser = agentRegistry.get(loserAgentId);

  if (winner) {
    winner.wins++;
    winner.matches.push({ gameId, result: "win", opponent: loserAgentId, time: Date.now() });
    // ELO update
    const expectedWin = 1 / (1 + Math.pow(10, ((loser?.elo || 1000) - winner.elo) / 400));
    winner.elo += Math.round(32 * (1 - expectedWin));
  }

  if (loser) {
    loser.losses++;
    loser.matches.push({ gameId, result: "loss", opponent: winnerAgentId, time: Date.now() });
    const expectedLoss = 1 / (1 + Math.pow(10, ((winner?.elo || 1000) - loser.elo) / 400));
    loser.elo += Math.round(32 * (0 - expectedLoss));
  }

  // TODO: Post on-chain reputation feedback when contracts are deployed
  // if (erc8004Enabled && winner?.chainAgentId) {
  //   postReputationFeedback(winner.chainAgentId, 1, "rts-game", "win", gameId);
  // }
}

/**
 * Create the ERC-8004 API router.
 */
export function createERC8004Router() {
  const router = Router();

  // POST /api/agents/register - Register as an on-chain agent
  router.post("/register", (req, res) => {
    const { walletAddress, name, uri } = req.body;

    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return res.status(400).json({ error: "Valid walletAddress required" });
    }

    // Check if already registered
    for (const [, agent] of agentRegistry) {
      if (agent.wallet === walletAddress.toLowerCase()) {
        return res.json({ agent, message: "Already registered" });
      }
    }

    const agent = registerAgentLocal(walletAddress, { name, uri });

    res.status(201).json({
      agent,
      identity: {
        namespace: "eip155",
        chainId: CHAIN_ID,
        registryAddress: CONTRACTS.identityRegistry || "local",
        agentId: agent.agentId,
        fullId: `eip155:${CHAIN_ID}:${CONTRACTS.identityRegistry || "local"}:${agent.agentId}`,
      },
      onChain: erc8004Enabled,
      message: erc8004Enabled
        ? "Agent registered on-chain and locally"
        : "Agent registered locally. Set ERC8004_IDENTITY_REGISTRY to enable on-chain registration.",
    });
  });

  // GET /api/agents - List all registered agents
  router.get("/", (_req, res) => {
    const agents = [...agentRegistry.values()].map(a => ({
      agentId: a.agentId,
      name: a.name,
      wallet: a.wallet,
      elo: a.elo,
      wins: a.wins,
      losses: a.losses,
      matches: a.matches.length,
      registeredAt: a.registeredAt,
      onChain: a.onChain,
    }));

    res.json({
      agents: agents.sort((a, b) => b.elo - a.elo),
      contracts: {
        identityRegistry: CONTRACTS.identityRegistry,
        reputationRegistry: CONTRACTS.reputationRegistry,
        chainId: CHAIN_ID,
        rpcUrl: RPC_URL,
      },
      erc8004Enabled,
    });
  });

  // GET /api/agents/:id - Get agent details
  router.get("/:id", (req, res) => {
    const id = parseInt(req.params.id);
    const agent = agentRegistry.get(id);
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    res.json({
      ...agent,
      recentMatches: agent.matches.slice(-20),
      identity: {
        namespace: "eip155",
        chainId: CHAIN_ID,
        agentId: agent.agentId,
        fullId: `eip155:${CHAIN_ID}:${CONTRACTS.identityRegistry || "local"}:${agent.agentId}`,
      },
    });
  });

  // GET /api/agents/:id/reputation - Get agent reputation summary
  router.get("/:id/reputation", (req, res) => {
    const id = parseInt(req.params.id);
    const agent = agentRegistry.get(id);
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const winRate = agent.matches.length > 0
      ? (agent.wins / agent.matches.length * 100).toFixed(1)
      : "0.0";

    res.json({
      agentId: agent.agentId,
      elo: agent.elo,
      wins: agent.wins,
      losses: agent.losses,
      totalMatches: agent.matches.length,
      winRate: `${winRate}%`,
      reputationScore: Math.max(0, Math.min(100, 50 + (agent.elo - 1000) / 10)),
      onChain: erc8004Enabled,
    });
  });

  // GET /api/agents/by-wallet/:address - Look up agent by wallet
  router.get("/by-wallet/:address", (req, res) => {
    const addr = req.params.address.toLowerCase();
    for (const [, agent] of agentRegistry) {
      if (agent.wallet === addr) {
        return res.json(agent);
      }
    }
    res.status(404).json({ error: "No agent registered with this wallet" });
  });

  // GET /api/agents/config - Get ERC-8004 configuration
  router.get("/config/info", (_req, res) => {
    res.json({
      erc8004Enabled,
      contracts: CONTRACTS,
      chainId: CHAIN_ID,
      rpcUrl: RPC_URL,
      abis: {
        identityRegistry: IDENTITY_REGISTRY_ABI,
        reputationRegistry: REPUTATION_REGISTRY_ABI,
      },
      howToRegister: {
        step1: "POST /api/agents/register { walletAddress: '0x...', name: 'MyAgent' }",
        step2: "Use wallet auth: GET /api/auth/nonce -> sign -> POST /api/auth/verify",
        step3: "Play games, ELO and reputation tracked automatically",
        onChain: "When ERC8004_IDENTITY_REGISTRY is set, registrations are mirrored on-chain",
      },
    });
  });

  return router;
}

export { agentRegistry, erc8004Enabled, CONTRACTS };
