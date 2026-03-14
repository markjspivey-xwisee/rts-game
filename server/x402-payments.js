// ═══════════════════════════════════════════════════════════════════════════
//  x402 PAYMENT MIDDLEWARE - Crypto payments for premium API features
// ═══════════════════════════════════════════════════════════════════════════
//
// Uses the x402 protocol (HTTP 402 Payment Required) to gate premium
// features behind stablecoin micropayments. AI agents with wallets
// (e.g. Coinbase AgentKit) can pay automatically.
//
// Free tier:  create/join games, basic state, 2 concurrent games
// Paid tier:  unlimited games, faster ticks, training, tournaments
//
// Networks:
//   Base Sepolia (testnet): eip155:84532 (default)
//   Base Mainnet:           eip155:8453
//
// Set X402_NETWORK env var to switch. Use X402_MAINNET=true as shortcut.
// ═══════════════════════════════════════════════════════════════════════════

let paymentMiddleware, x402ResourceServer, ExactEvmScheme, HTTPFacilitatorClient;
let x402Enabled = false;

// Payment recipient wallet address (set via env or defaults to zero for testing)
const PAY_TO = process.env.X402_PAY_TO || "0x0000000000000000000000000000000000000000";

// Network configuration
// X402_MAINNET=true is a shortcut to switch to Base mainnet
const CHAIN_CONFIG = {
  testnet: {
    network: "eip155:84532",
    name: "Base Sepolia (testnet)",
    rpcUrl: "https://sepolia.base.org",
    currency: "USDC",
    blockExplorer: "https://sepolia.basescan.org",
  },
  mainnet: {
    network: "eip155:8453",
    name: "Base Mainnet",
    rpcUrl: "https://mainnet.base.org",
    currency: "USDC",
    blockExplorer: "https://basescan.org",
  },
};

const isMainnet = process.env.X402_MAINNET === "true";
const activeChain = isMainnet ? CHAIN_CONFIG.mainnet : CHAIN_CONFIG.testnet;
const NETWORK = process.env.X402_NETWORK || activeChain.network;

// Facilitator URL
const FACILITATOR_URL = process.env.X402_FACILITATOR || "https://x402.org/facilitator";

// Price tiers (in USD, paid in USDC)
const PRICES = {
  premium_state:    process.env.X402_PRICE_STATE    || "$0.0001",  // per state poll
  premium_game:     process.env.X402_PRICE_GAME     || "$0.001",   // create premium game
  training:         process.env.X402_PRICE_TRAINING  || "$0.01",    // start training session
  tournament_entry: process.env.X402_PRICE_TOURNAMENT || "$0.005",  // tournament entry
  replay_share:     process.env.X402_PRICE_REPLAY    || "$0.001",   // permanent replay
  weights_upload:   process.env.X402_PRICE_WEIGHTS   || "$0.002",   // upload weights
};

/**
 * Initialize x402 payment system. Call this at server startup.
 * Gracefully degrades if x402 packages aren't available.
 */
export async function initX402() {
  try {
    const expressModule = await import("@x402/express");
    const evmModule = await import("@x402/evm/exact/server");
    const coreModule = await import("@x402/core/server");

    paymentMiddleware = expressModule.paymentMiddleware;
    x402ResourceServer = expressModule.x402ResourceServer;
    ExactEvmScheme = evmModule.ExactEvmScheme;
    HTTPFacilitatorClient = coreModule.HTTPFacilitatorClient;

    x402Enabled = true;
    console.log("[x402] Payment system initialized");
    console.log(`[x402] Network: ${NETWORK} (${activeChain.name})`);
    console.log(`[x402] Facilitator: ${FACILITATOR_URL}`);
    console.log(`[x402] Pay to: ${PAY_TO}`);
    if (isMainnet) {
      console.log("[x402] *** MAINNET MODE - real payments enabled ***");
    }
  } catch (err) {
    console.warn("[x402] Payment packages not available, running in free mode:", err.message);
    x402Enabled = false;
  }
}

/**
 * Create x402 payment middleware for Express routes.
 * Returns a middleware function, or a pass-through if x402 isn't available.
 */
export function createPaymentMiddleware() {
  if (!x402Enabled) {
    // Return pass-through middleware when x402 is not configured
    return (_req, _res, next) => next();
  }

  const facilitatorClient = new HTTPFacilitatorClient({
    url: FACILITATOR_URL,
  });

  const server = new x402ResourceServer(facilitatorClient)
    .register(NETWORK, new ExactEvmScheme());

  const routeConfig = {
    // Premium game creation (unlimited concurrent games)
    "POST /api/games/premium": {
      accepts: [{ scheme: "exact", price: PRICES.premium_game, network: NETWORK, payTo: PAY_TO }],
      description: "Create a premium game with faster tick rate and all map themes",
      mimeType: "application/json",
    },
    // Training compute
    "POST /api/training/start": {
      accepts: [{ scheme: "exact", price: PRICES.training, network: NETWORK, payTo: PAY_TO }],
      description: "Start a neural net training session with server-side compute",
      mimeType: "application/json",
    },
    // Tournament entry
    "POST /api/tournaments/paid": {
      accepts: [{ scheme: "exact", price: PRICES.tournament_entry, network: NETWORK, payTo: PAY_TO }],
      description: "Enter a paid tournament with prize pool",
      mimeType: "application/json",
    },
    // Permanent replay sharing
    "POST /api/games/*/replay/share": {
      accepts: [{ scheme: "exact", price: PRICES.replay_share, network: NETWORK, payTo: PAY_TO }],
      description: "Create a permanent shareable replay URL",
      mimeType: "application/json",
    },
  };

  return paymentMiddleware(routeConfig, server);
}

/**
 * Get the current x402 configuration (for client display).
 */
export function getX402Config() {
  return {
    enabled: x402Enabled,
    network: NETWORK,
    activeChain: activeChain.name,
    isMainnet,
    facilitator: FACILITATOR_URL,
    payTo: PAY_TO,
    prices: PRICES,
    supportedChains: [
      { id: "eip155:84532", name: "Base Sepolia (testnet)", currency: "USDC", active: NETWORK === "eip155:84532" },
      { id: "eip155:8453", name: "Base Mainnet", currency: "USDC", active: NETWORK === "eip155:8453" },
    ],
    // Mainnet config reference:
    //   X402_MAINNET=true
    //   X402_NETWORK=eip155:8453
    //   X402_PAY_TO=<your mainnet wallet>
    //   X402_FACILITATOR=https://x402.org/facilitator
  };
}

export { x402Enabled, PRICES, isMainnet, NETWORK, activeChain };
