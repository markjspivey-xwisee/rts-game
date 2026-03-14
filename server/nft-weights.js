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
// Storage: weights JSON stored on IPFS via Pinata, NFT metadata points to
// IPFS CID. Falls back to local content-addressed storage when Pinata
// is not configured.
// ═══════════════════════════════════════════════════════════════════════════

import { Router } from "express";
import { createHash } from "crypto";

// Pinata IPFS configuration
const PINATA_JWT = process.env.PINATA_JWT || null;
const PINATA_API_KEY = process.env.PINATA_API_KEY || null;
const PINATA_API_SECRET = process.env.PINATA_API_SECRET || null;
const PINATA_UPLOAD_URL = "https://api.pinata.cloud/pinning/pinJSONToIPFS";
const PINATA_GATEWAY = "https://gateway.pinata.cloud/ipfs";

const ipfsEnabled = !!PINATA_JWT;

// In-memory NFT registry (stores metadata + CID, not full weights when IPFS is available)
const weightNFTs = new Map(); // tokenId -> NFTMetadata

let nextTokenId = 1;

/**
 * Compute a local content hash for weights (fallback when Pinata isn't configured).
 */
function contentHash(data) {
  return "bafk" + createHash("sha256").update(JSON.stringify(data)).digest("hex").substring(0, 52);
}

/**
 * Upload weights JSON to IPFS via Pinata.
 * Returns the IPFS CID (IpfsHash) or null on failure.
 */
async function uploadToPinata(weights, name) {
  if (!PINATA_JWT) return null;

  try {
    const response = await fetch(PINATA_UPLOAD_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${PINATA_JWT}`,
      },
      body: JSON.stringify({
        pinataContent: weights,
        pinataMetadata: { name: name || "rts-weights" },
      }),
    });

    if (!response.ok) {
      console.error(`[NFT-Weights] Pinata upload failed: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();
    console.log(`[NFT-Weights] Uploaded to IPFS: ${data.IpfsHash}`);
    return data.IpfsHash;
  } catch (err) {
    console.error(`[NFT-Weights] Pinata upload error: ${err.message}`);
    return null;
  }
}

/**
 * Fetch weights JSON from IPFS gateway.
 * Returns the parsed weights object or null on failure.
 */
async function fetchFromIPFS(cid) {
  try {
    const url = `${PINATA_GATEWAY}/${cid}`;
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`[NFT-Weights] IPFS fetch failed: ${response.status} ${response.statusText}`);
      return null;
    }

    return await response.json();
  } catch (err) {
    console.error(`[NFT-Weights] IPFS fetch error: ${err.message}`);
    return null;
  }
}

/**
 * Mint a weight set as an NFT.
 * When Pinata is configured, uploads weights to IPFS and stores only the CID.
 * Falls back to local content-addressed storage otherwise.
 */
async function mintWeightNFT(ownerAddress, weights, metadata = {}) {
  const tokenId = nextTokenId++;
  const localCid = contentHash(weights);

  // Try uploading to IPFS via Pinata
  let ipfsCid = null;
  if (ipfsEnabled) {
    ipfsCid = await uploadToPinata(weights, metadata.name || `Weights #${tokenId}`);
  }

  const nft = {
    tokenId,
    owner: ownerAddress?.toLowerCase() || "local",
    name: metadata.name || `Weights #${tokenId}`,
    description: metadata.description || "Trained neural net weights for Script RTS",
    fitness: metadata.fitness || 0,
    generation: metadata.generation || 0,
    architecture: metadata.architecture || "[45,32,16,13]",
    trainingConfig: metadata.trainingConfig || {},
    contentHash: ipfsCid || localCid,
    ipfsCid: ipfsCid,
    ipfsUrl: ipfsCid ? `${PINATA_GATEWAY}/${ipfsCid}` : null,
    // Only store weights in memory when IPFS is not available
    weights: ipfsCid ? null : weights,
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
  router.post("/mint", async (req, res) => {
    const { ownerAddress, weights, name, description, fitness, generation } = req.body;

    if (!weights) {
      return res.status(400).json({ error: "weights required" });
    }

    const nft = await mintWeightNFT(ownerAddress, weights, {
      name, description, fitness, generation,
    });

    res.status(201).json({
      tokenId: nft.tokenId,
      owner: nft.owner,
      name: nft.name,
      contentHash: nft.contentHash,
      ipfsCid: nft.ipfsCid,
      ipfsUrl: nft.ipfsUrl,
      tba: nft.tba.address,
      message: nft.ipfsCid
        ? "Weights minted as NFT and pinned to IPFS. Token Bound Account created."
        : "Weights minted as NFT (local storage). Token Bound Account created.",
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
      ipfsCid: n.ipfsCid,
      ipfsUrl: n.ipfsUrl,
      listed: n.listed,
      price: n.price,
      downloads: n.downloads,
      tba: n.tba.address,
      tbaBalance: n.tba.balance,
      mintedAt: n.mintedAt,
    }));

    res.json({
      nfts: nfts.sort((a, b) => b.fitness - a.fitness),
      ipfsEnabled,
    });
  });

  // GET /api/nft-weights/:id - Get NFT details (fetches weights from IPFS if needed)
  router.get("/:id", async (req, res) => {
    const nft = weightNFTs.get(parseInt(req.params.id));
    if (!nft) return res.status(404).json({ error: "NFT not found" });

    nft.downloads++;

    // Resolve weights: use local cache if available, otherwise fetch from IPFS
    let weights = nft.weights;
    if (!weights && nft.ipfsCid) {
      weights = await fetchFromIPFS(nft.ipfsCid);
      if (!weights) {
        return res.status(502).json({
          error: "Failed to fetch weights from IPFS",
          ipfsCid: nft.ipfsCid,
          ipfsUrl: nft.ipfsUrl,
        });
      }
    }

    res.json({
      tokenId: nft.tokenId,
      owner: nft.owner,
      name: nft.name,
      description: nft.description,
      fitness: nft.fitness,
      generation: nft.generation,
      architecture: nft.architecture,
      contentHash: nft.contentHash,
      ipfsCid: nft.ipfsCid,
      ipfsUrl: nft.ipfsUrl,
      weights,
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

export { weightNFTs, mintWeightNFT, ipfsEnabled };
