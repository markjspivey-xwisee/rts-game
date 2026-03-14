// ═══════════════════════════════════════════════════════════════════════════
//  ERC-8004 INTEGRATION - On-chain agent identity & reputation
// ═══════════════════════════════════════════════════════════════════════════
//
// Integrates with ERC-8004 Trustless Agents standard:
//   - Identity Registry: agents register as NFTs with on-chain identity
//   - Reputation Registry: game results posted as reputation feedback
//
// Uses the canonical deployed contracts on Base Sepolia:
//   - IdentityRegistry: 0x8004A818BFB912233c491871b3d84c89A494BD9e
//   - ReputationRegistry: 0x8004B663056A597Dffe9eCcC1965A193B7388713
//
// Agents register via API, server submits on-chain tx with server wallet.
// ═══════════════════════════════════════════════════════════════════════════

import { Router } from "express";
import { createHash } from "crypto";
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
};

const RPC_URL = process.env.ERC8004_RPC_URL || "https://sepolia.base.org";
const CHAIN_ID = process.env.ERC8004_CHAIN_ID || "84532";
const SERVER_PRIVATE_KEY = process.env.SERVER_WALLET_PRIVATE_KEY || null;

// In-memory agent registry (mirrors on-chain for fast lookups)
const agentRegistry = new Map(); // agentId -> { wallet, uri, elo, matches }

let provider = null;
let signer = null;
let identityContract = null;
let reputationContract = null;
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
    const { JsonRpcProvider, Wallet, Contract } = await import("ethers");
    provider = new JsonRpcProvider(RPC_URL);

    if (SERVER_PRIVATE_KEY) {
      signer = new Wallet(SERVER_PRIVATE_KEY, provider);
      console.log(`[ERC-8004] Server wallet: ${signer.address}`);

      // Connect to on-chain contracts
      identityContract = new Contract(CONTRACTS.identityRegistry, IDENTITY_REGISTRY_ABI, signer);
      console.log(`[ERC-8004] Identity Registry: ${CONTRACTS.identityRegistry}`);

      if (CONTRACTS.reputationRegistry) {
        reputationContract = new Contract(CONTRACTS.reputationRegistry, REPUTATION_REGISTRY_ABI, signer);
        console.log(`[ERC-8004] Reputation Registry: ${CONTRACTS.reputationRegistry}`);
      }
    } else {
      console.warn("[ERC-8004] No SERVER_WALLET_PRIVATE_KEY, on-chain writes disabled");
    }

    erc8004Enabled = true;
    console.log(`[ERC-8004] Connected to ${RPC_URL} (chain ${CHAIN_ID})`);
  } catch (err) {
    console.warn("[ERC-8004] Failed to initialize:", err.message);
  }
}

/**
 * Register an agent on-chain via the Identity Registry.
 * Returns the on-chain agent ID (token ID) or null on failure.
 */
async function registerAgentOnChain(agentURI) {
  if (!identityContract || !signer) return null;

  try {
    console.log(`[ERC-8004] Registering agent on-chain: ${agentURI}`);
    const tx = await identityContract["register(string)"](agentURI);
    const receipt = await tx.wait();

    // Parse the Registered event to get the agentId
    for (const log of receipt.logs) {
      try {
        const parsed = identityContract.interface.parseLog(log);
        if (parsed && parsed.name === "Registered") {
          const chainAgentId = parsed.args.agentId;
          console.log(`[ERC-8004] Agent registered on-chain with ID: ${chainAgentId}`);
          return Number(chainAgentId);
        }
      } catch { /* skip non-matching logs */ }
    }

    console.log(`[ERC-8004] Registration tx confirmed: ${receipt.hash}`);
    return null;
  } catch (err) {
    console.error(`[ERC-8004] On-chain registration failed: ${err.message}`);
    return null;
  }
}

/**
 * Post reputation feedback on-chain after a match.
 */
async function postReputationFeedback(chainAgentId, value, tag1, tag2, gameId) {
  if (!reputationContract || !signer) return;

  try {
    const feedbackURI = `https://script-rts-game.azurewebsites.net/api/games/${gameId}/replay`;
    const feedbackHash = "0x" + createHash("sha256").update(`${gameId}-${chainAgentId}-${value}`).digest("hex");

    const tx = await reputationContract.giveFeedback(
      chainAgentId,
      value,        // +1 for win, -1 for loss
      0,            // valueDecimals
      tag1,         // "rts-game"
      tag2,         // "win" or "loss"
      "script-rts", // endpoint
      feedbackURI,
      feedbackHash
    );
    const receipt = await tx.wait();
    console.log(`[ERC-8004] Reputation feedback posted: ${receipt.hash} (agent ${chainAgentId}, ${tag2})`);
  } catch (err) {
    console.error(`[ERC-8004] Reputation feedback failed: ${err.message}`);
  }
}

/**
 * Register an agent locally and optionally on-chain.
 */
async function registerAgent(walletAddress, metadata = {}) {
  const localId = agentRegistry.size + 1;
  const agentURI = metadata.uri || `https://script-rts-game.azurewebsites.net/api/agents/${localId}`;

  const agent = {
    agentId: localId,
    wallet: walletAddress.toLowerCase(),
    uri: agentURI,
    name: metadata.name || `Agent #${localId}`,
    elo: 1000,
    matches: [],
    wins: 0,
    losses: 0,
    registeredAt: Date.now(),
    onChain: false,
    chainAgentId: null,
    txHash: null,
  };

  agentRegistry.set(localId, agent);
  linkAgentId(walletAddress, localId);

  // Attempt on-chain registration (non-blocking for the API response)
  if (erc8004Enabled && identityContract) {
    registerAgentOnChain(agentURI).then(chainId => {
      if (chainId) {
        agent.onChain = true;
        agent.chainAgentId = chainId;
      }
    });
  }

  return agent;
}

/**
 * Record a match result in the agent registry.
 * Posts on-chain reputation feedback if enabled.
 */
export function recordAgentMatch(winnerAgentId, loserAgentId, gameId) {
  const winner = agentRegistry.get(winnerAgentId);
  const loser = agentRegistry.get(loserAgentId);

  if (winner) {
    winner.wins++;
    winner.matches.push({ gameId, result: "win", opponent: loserAgentId, time: Date.now() });
    const expectedWin = 1 / (1 + Math.pow(10, ((loser?.elo || 1000) - winner.elo) / 400));
    winner.elo += Math.round(32 * (1 - expectedWin));
  }

  if (loser) {
    loser.losses++;
    loser.matches.push({ gameId, result: "loss", opponent: winnerAgentId, time: Date.now() });
    const expectedLoss = 1 / (1 + Math.pow(10, ((winner?.elo || 1000) - loser.elo) / 400));
    loser.elo += Math.round(32 * (0 - expectedLoss));
  }

  // Post on-chain reputation feedback (fire-and-forget)
  if (erc8004Enabled && reputationContract) {
    if (winner?.chainAgentId) {
      postReputationFeedback(winner.chainAgentId, 1, "rts-game", "win", gameId);
    }
    if (loser?.chainAgentId) {
      postReputationFeedback(loser.chainAgentId, -1, "rts-game", "loss", gameId);
    }
  }
}

/**
 * Create the ERC-8004 API router.
 */
export function createERC8004Router() {
  const router = Router();

  // POST /api/agents/register - Register as an on-chain agent
  router.post("/register", async (req, res) => {
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

    const agent = await registerAgent(walletAddress, { name, uri });

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
        ? "Agent registered. On-chain registration submitted (may take a few seconds to confirm)."
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
      chainAgentId: a.chainAgentId,
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
        chainAgentId: agent.chainAgentId,
        fullId: `eip155:${CHAIN_ID}:${CONTRACTS.identityRegistry || "local"}:${agent.chainAgentId || agent.agentId}`,
      },
    });
  });

  // GET /api/agents/:id/reputation - Get agent reputation (local + on-chain)
  router.get("/:id/reputation", async (req, res) => {
    const id = parseInt(req.params.id);
    const agent = agentRegistry.get(id);
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const winRate = agent.matches.length > 0
      ? (agent.wins / agent.matches.length * 100).toFixed(1)
      : "0.0";

    const result = {
      agentId: agent.agentId,
      chainAgentId: agent.chainAgentId,
      elo: agent.elo,
      wins: agent.wins,
      losses: agent.losses,
      totalMatches: agent.matches.length,
      winRate: `${winRate}%`,
      reputationScore: Math.max(0, Math.min(100, 50 + (agent.elo - 1000) / 10)),
      onChain: agent.onChain,
    };

    // Fetch on-chain reputation summary if available
    if (reputationContract && agent.chainAgentId) {
      try {
        const [count, summaryValue, decimals] = await reputationContract.getSummary(
          agent.chainAgentId, [], "rts-game", ""
        );
        result.onChainReputation = {
          feedbackCount: Number(count),
          summaryValue: Number(summaryValue),
          decimals: Number(decimals),
        };
      } catch (err) {
        result.onChainReputation = { error: err.message };
      }
    }

    res.json(result);
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

  // GET /api/agents/config/info - Get ERC-8004 configuration
  router.get("/config/info", (_req, res) => {
    res.json({
      erc8004Enabled,
      contracts: CONTRACTS,
      chainId: CHAIN_ID,
      rpcUrl: RPC_URL,
      serverWallet: signer?.address || null,
      abis: {
        identityRegistry: IDENTITY_REGISTRY_ABI,
        reputationRegistry: REPUTATION_REGISTRY_ABI,
      },
      howToRegister: {
        step1: "POST /api/agents/register { walletAddress: '0x...', name: 'MyAgent' }",
        step2: "Use wallet auth: GET /api/auth/nonce -> sign -> POST /api/auth/verify",
        step3: "Play games, ELO and reputation tracked automatically",
        onChain: erc8004Enabled
          ? "On-chain registration active. Agents are registered as NFTs on Base Sepolia."
          : "Set ERC8004_IDENTITY_REGISTRY to enable on-chain registration.",
      },
    });
  });

  return router;
}

export { agentRegistry, erc8004Enabled, CONTRACTS };
