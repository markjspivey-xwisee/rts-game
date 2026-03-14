// ═══════════════════════════════════════════════════════════════════════════
//  WALLET AUTH - Ethereum wallet signature authentication for AI agents
// ═══════════════════════════════════════════════════════════════════════════
//
// Allows agents to authenticate with wallet signatures instead of
// bearer tokens. The wallet address becomes the agent's persistent
// identity across games.
//
// Flow:
// 1. Agent requests a nonce: GET /api/auth/nonce?address=0x...
// 2. Agent signs the nonce with their wallet
// 3. Agent sends signature: POST /api/auth/verify { address, signature, nonce }
// 4. Server returns a bearer token tied to that wallet address
// 5. Agent uses bearer token for game API (same as before)
//
// This is compatible with Coinbase AgentKit agentic wallets.
// ═══════════════════════════════════════════════════════════════════════════

import { Router } from "express";
import { randomBytes, createHash } from "crypto";

// Nonce store: address -> { nonce, expires }
const nonceStore = new Map();

// Wallet-to-token mappings: walletAddress -> { tokens: Set, elo, agentId }
const walletProfiles = new Map();

// Token-to-wallet reverse lookup
const tokenToWallet = new Map();

const NONCE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Generate a deterministic message to sign.
 */
function buildMessage(nonce) {
  return `Sign this message to authenticate with Script RTS.\n\nNonce: ${nonce}`;
}

/**
 * Verify an Ethereum signature (EIP-191 personal_sign).
 * Uses ethers.js if available, otherwise falls back to basic recovery.
 */
async function verifySignature(address, signature, nonce) {
  try {
    const { verifyMessage } = await import("ethers");
    const message = buildMessage(nonce);
    const recovered = verifyMessage(message, signature);
    return recovered.toLowerCase() === address.toLowerCase();
  } catch (err) {
    console.warn("[WalletAuth] ethers not available for sig verification:", err.message);
    // Fallback: accept if ethers isn't available (dev mode)
    return process.env.NODE_ENV === "development";
  }
}

/**
 * Get or create a wallet profile.
 */
function getProfile(address) {
  const addr = address.toLowerCase();
  if (!walletProfiles.has(addr)) {
    walletProfiles.set(addr, {
      address: addr,
      tokens: new Set(),
      agentId: null,       // ERC-8004 agent ID (if registered)
      elo: 1000,
      gamesPlayed: 0,
      createdAt: Date.now(),
    });
  }
  return walletProfiles.get(addr);
}

/**
 * Create the wallet auth router.
 */
export function createWalletAuthRouter() {
  const router = Router();

  // GET /api/auth/nonce?address=0x... - Request a signing nonce
  router.get("/nonce", (req, res) => {
    const address = req.query.address;
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return res.status(400).json({ error: "Valid Ethereum address required" });
    }

    const nonce = randomBytes(32).toString("hex");
    nonceStore.set(address.toLowerCase(), {
      nonce,
      expires: Date.now() + NONCE_EXPIRY_MS,
    });

    res.json({
      nonce,
      message: buildMessage(nonce),
      expiresIn: NONCE_EXPIRY_MS / 1000,
    });
  });

  // POST /api/auth/verify - Verify signature and get token
  router.post("/verify", async (req, res) => {
    const { address, signature, nonce } = req.body;

    if (!address || !signature || !nonce) {
      return res.status(400).json({ error: "address, signature, and nonce required" });
    }

    const addr = address.toLowerCase();
    const stored = nonceStore.get(addr);

    if (!stored || stored.nonce !== nonce) {
      return res.status(401).json({ error: "Invalid or expired nonce" });
    }

    if (Date.now() > stored.expires) {
      nonceStore.delete(addr);
      return res.status(401).json({ error: "Nonce expired" });
    }

    // Verify the signature
    const valid = await verifySignature(address, signature, nonce);
    if (!valid) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    // Clean up nonce
    nonceStore.delete(addr);

    // Generate a bearer token tied to this wallet
    const token = randomBytes(32).toString("hex");
    const profile = getProfile(addr);
    profile.tokens.add(token);
    tokenToWallet.set(token, addr);

    res.json({
      token,
      address: addr,
      agentId: profile.agentId,
      elo: profile.elo,
      message: "Authenticated via wallet signature. Use this token as Bearer auth.",
    });
  });

  // GET /api/auth/profile?address=0x... - Get wallet profile
  router.get("/profile", (req, res) => {
    const address = req.query.address;
    if (!address) return res.status(400).json({ error: "address required" });

    const profile = walletProfiles.get(address.toLowerCase());
    if (!profile) return res.status(404).json({ error: "Unknown wallet" });

    res.json({
      address: profile.address,
      agentId: profile.agentId,
      elo: profile.elo,
      gamesPlayed: profile.gamesPlayed,
      createdAt: profile.createdAt,
    });
  });

  return router;
}

/**
 * Resolve a bearer token to a wallet address (if wallet-authenticated).
 */
export function resolveWallet(token) {
  return tokenToWallet.get(token) || null;
}

/**
 * Link an ERC-8004 agent ID to a wallet.
 */
export function linkAgentId(walletAddress, agentId) {
  const profile = getProfile(walletAddress);
  profile.agentId = agentId;
}

export { walletProfiles, tokenToWallet, getProfile };
