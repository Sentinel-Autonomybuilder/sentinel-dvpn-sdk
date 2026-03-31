/**
 * Sentinel AI Path — Decentralized VPN for AI Agents
 *
 * Complete agent flow:
 *
 *   1. Setup:    await setup()           → { os, node, v2ray, wireguard, admin }
 *   2. Wallet:   await createWallet()    → { mnemonic, address }
 *   3. Fund:     await getBalance(m)     → { p2p, funded }
 *   4. Discover: await discoverNodes()   → [{ address, country, protocol, price, score }]
 *   5. Estimate: await estimateCost(opts) → { perGb, perHour, forBudget }
 *   6. Connect:  await connect(opts)     → { sessionId, protocol, ip, socksPort }
 *   7. Verify:   await verify()          → { connected, ip, latency }
 *   8. Monitor:  onEvent(callback)       → unsubscribe function
 *   9. Disconnect: await disconnect()    → { disconnected: true }
 */

// ─── Phase 1: Setup & Environment ────────────────────────────────────────────

export { setup, getEnvironment } from './environment.js';

// ─── Phase 2-3: Wallet & Funding ─────────────────────────────────────────────

export { createWallet, importWallet, getBalance } from './wallet.js';

// ─── Phase 4: Node Discovery ─────────────────────────────────────────────────

export { discoverNodes, getNodeInfo, getNetworkStats } from './discover.js';

// ─── Phase 5: Cost Estimation ────────────────────────────────────────────────

export { estimateCost, PRICING } from './pricing.js';

// ─── Phase 5.5: Decision Engine ───────────────────────────────────────────────

export { recommend } from './recommend.js';

// ─── Phase 6-7: Connect, Verify, Monitor ─────────────────────────────────────

export { connect, disconnect, status, isVpnActive, verify, verifySplitTunnel, onEvent } from './connect.js';

// ─── Error Handling ─────────────────────────────────────────────────────────

export { AiPathError, AiPathErrorCodes } from './errors.js';
