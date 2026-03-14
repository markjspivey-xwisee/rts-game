// ═══════════════════════════════════════════════════════════════════════════
//  NFT WEIGHTS - Neural net weights as tradeable on-chain assets
// ═══════════════════════════════════════════════════════════════════════════
//
// Trained neural net weights can be minted as NFTs using ERC-6551
// (Token Bound Accounts). Each weight NFT:
//   - Has its own wallet (TBA) that can hold tournament winnings
//   - Contains metadata: fitness score, generation, training config
//   - Is owned by the agent/wallet that trained it
//   - Can be listed for sale or shared
//
// Storage: weights JSON stored on IPFS, NFT metadata points to IPFS CID.
// For now, we use local storage with IPFS-style content addressing.
// ═══════════════════════════════════════════════════════════════════════════

import { Router } from "express";
import { createHash } from "crypto";

// In-memory NFT registry
const weightNFTs = new Map(); // tokenId -> NFTMetadata

let nextTokenId = 1;

/**
 * Compute a content hash for weights (simulates IPFS CID).
 */
function contentHash(data) {
  return "bafk" + createHash("sha256").update(JSON.stringify(data)).digest("hex").substring(0, 52);
}

/**
 * Mint a weight set as an NFT.
 */
function mintWeightNFT(ownerAddress, weights, metadata = {}) {
  const tokenId = nextTokenId++;
  const cid = contentHash(weights);

  const nft = {
    tokenId,
    owner: ownerAddress?.toLowerCase() || "local",
    name: metadata.name || `Weights #${tokenId}`,
    description: metadata.description || "Trained neural net weights for Script RTS",
    fitness: metadata.fitness || 0,
    generation: metadata.generation || 0,
    architecture: metadata.architecture || "[45,32,16,13]",
    trainingConfig: metadata.trainingConfig || {},
    contentHash: cid,
    weights, // In production, this would be on IPFS
    mintedAt: Date.now(),
    listed: false,
    price: null,
    downloads: 0,
    // ERC-6551 Token Bound Account (simulated)
    tba: {
      address: `0x${createHash("sha256").update(`tba-${tokenId}`).digest("hex").substring(0, 40)}`,
      balance: 0, // USDC balance from tournament winnings
      earnings: [],
    },
  };

  weightNFTs.set(tokenId, nft);
  return nft;
}

/**
 * Create the NFT weights router.
 */
export function createNFTWeightsRouter() {
  const router = Router();

  // POST /api/nft-weights/mint - Mint weights as NFT
  router.post("/mint", (req, res) => {
    const { ownerAddress, weights, name, description, fitness, generation } = req.body;

    if (!weights) {
      return res.status(400).json({ error: "weights required" });
    }

    const nft = mintWeightNFT(ownerAddress, weights, {
      name, description, fitness, generation,
    });

    res.status(201).json({
      tokenId: nft.tokenId,
      owner: nft.owner,
      name: nft.name,
      contentHash: nft.contentHash,
      tba: nft.tba.address,
      message: "Weights minted as NFT. Token Bound Account created.",
      erc6551: {
        standard: "ERC-6551",
        description: "This NFT has its own wallet (Token Bound Account) that can receive tournament winnings",
        tbaAddress: nft.tba.address,
      },
    });
  });

  // GET /api/nft-weights - List all weight NFTs
  router.get("/", (_req, res) => {
    const nfts = [...weightNFTs.values()].map(n => ({
      tokenId: n.tokenId,
      owner: n.owner,
      name: n.name,
      fitness: n.fitness,
      generation: n.generation,
      contentHash: n.contentHash,
      listed: n.listed,
      price: n.price,
      downloads: n.downloads,
      tba: n.tba.address,
      tbaBalance: n.tba.balance,
      mintedAt: n.mintedAt,
    }));

    res.json({ nfts: nfts.sort((a, b) => b.fitness - a.fitness) });
  });

  // GET /api/nft-weights/:id - Get NFT details
  router.get("/:id", (req, res) => {
    const nft = weightNFTs.get(parseInt(req.params.id));
    if (!nft) return res.status(404).json({ error: "NFT not found" });

    nft.downloads++;

    res.json({
      tokenId: nft.tokenId,
      owner: nft.owner,
      name: nft.name,
      description: nft.description,
      fitness: nft.fitness,
      generation: nft.generation,
      architecture: nft.architecture,
      contentHash: nft.contentHash,
      weights: nft.weights,
      tba: {
        address: nft.tba.address,
        balance: nft.tba.balance,
        earnings: nft.tba.earnings,
      },
      downloads: nft.downloads,
      mintedAt: nft.mintedAt,
    });
  });

  // POST /api/nft-weights/:id/list - List NFT for sale
  router.post("/:id/list", (req, res) => {
    const nft = weightNFTs.get(parseInt(req.params.id));
    if (!nft) return res.status(404).json({ error: "NFT not found" });

    const { price } = req.body;
    nft.listed = true;
    nft.price = price || "$1.00";

    res.json({
      tokenId: nft.tokenId,
      listed: true,
      price: nft.price,
      message: "NFT listed for sale. Buyers pay via x402.",
    });
  });

  // POST /api/nft-weights/:id/earnings - Record tournament earnings to TBA
  router.post("/:id/earnings", (req, res) => {
    const nft = weightNFTs.get(parseInt(req.params.id));
    if (!nft) return res.status(404).json({ error: "NFT not found" });

    const { amount, source, gameId } = req.body;
    const earning = { amount: amount || 0, source: source || "tournament", gameId, time: Date.now() };
    nft.tba.earnings.push(earning);
    nft.tba.balance += earning.amount;

    res.json({
      tokenId: nft.tokenId,
      tba: nft.tba,
      message: "Earnings recorded to Token Bound Account",
    });
  });

  return router;
}

export { weightNFTs, mintWeightNFT };
