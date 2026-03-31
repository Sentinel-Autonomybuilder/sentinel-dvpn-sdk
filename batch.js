/**
 * Sentinel dVPN SDK — Batch Session Operations
 *
 * ⚠️  TESTING / AUDITING TOOL ONLY — NOT FOR CONSUMER APPS  ⚠️
 *
 * Batch session creation: start multiple node sessions in a single transaction.
 * This is designed for network audit tools that test hundreds of nodes sequentially.
 *
 * WHY THIS EXISTS:
 *   The Node Tester audits 1,000+ nodes. Paying individually = 1,000 TXs = 200 P2P in gas.
 *   Batching 5 per TX = 200 TXs = 40 P2P in gas. 5x cheaper.
 *
 * WHY CONSUMER APPS SHOULD NOT USE THIS:
 *   - Consumer apps connect to ONE node at a time. Use `connect()` or `connectDirect()`.
 *   - Batch payment creates sessions for 5 nodes simultaneously — wasteful for single-node use.
 *   - If any node in the batch fails, the entire TX fails (atomic).
 *   - Session management complexity (credential caching, poisoning, dedup) is audit-level concern.
 *
 * FOR CONSUMER APPS: use `connect(mnemonic, options)` from the SDK. One function, one node, done.
 *
 * Usage (audit tools only):
 *   import { batchStartSessions } from './batch.js';
 *   const results = await batchStartSessions(client, account, nodes, 1, 'udvpn');
 *   // results = Map<nodeAddr, BigInt sessionId>
 */

import { ChainError, ErrorCodes } from './errors.js';
import { sleep } from './defaults.js';
import {
  broadcast,
  extractAllSessionIds,
  findExistingSession,
  lcdPaginatedSafe,
  MSG_TYPES,
} from './cosmjs-setup.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Default batch size limit (chain-tested safe maximum) */
const DEFAULT_BATCH_SIZE = 5;

/** Default gas per message */
const GAS_PER_MSG = 800000;

/** Default fee per message (udvpn) */
const FEE_PER_MSG = 200000;

/** Wait time before polling chain for session confirmation (ms) */
const POST_TX_POLL_DELAY = 2000;

/** Max time to wait for sessions to appear on-chain (ms) */
const DEFAULT_POLL_TIMEOUT = 20000;

// ─── Batch Start Sessions ────────────────────────────────────────────────────

/**
 * Start sessions for multiple nodes in a single transaction.
 * Builds N MsgStartSessionRequest messages, broadcasts as one TX,
 * and extracts session IDs from the TX events.
 *
 * Handles:
 *   - Duplicate payment detection (via sessionManager if provided)
 *   - Session ID extraction from base64-encoded TX events
 *   - Fallback: on-chain lookup if extraction fails for some sessions
 *   - Cost tracking via optional onCost callback
 *
 * @param {SigningStargateClient} client - CosmJS signing client
 * @param {{ address: string }} account - Signer account with .address
 * @param {Array<{ address: string, gigabyte_prices: Array<{ denom: string, base_value: string, quote_value: string }> }>} nodes - Nodes to start sessions on
 * @param {number} gigabytes - GB to allocate per session (typically 1)
 * @param {string} denom - Token denomination (typically 'udvpn')
 * @param {object} [options]
 * @param {import('./session-manager.js').SessionManager} [options.sessionManager] - SessionManager for dedup/caching
 * @param {number} [options.batchSize=5] - Max messages per TX
 * @param {Function} [options.logger] - Optional logger function (msg) => void
 * @param {Function} [options.onCost] - Called with { udvpn: number } after each TX (for cost tracking)
 * @param {string} [options.lcdUrl] - LCD URL for fallback session lookups
 * @returns {Promise<Map<string, bigint>>} Map of nodeAddr -> sessionId for all started sessions
 */
export async function batchStartSessions(client, account, nodes, gigabytes, denom, options = {}) {
  const {
    sessionManager,
    batchSize = DEFAULT_BATCH_SIZE,
    logger,
    onCost,
    lcdUrl,
  } = options;

  const log = logger || (() => {});
  const allResults = new Map();

  // Split into batches
  const batches = [];
  for (let i = 0; i < nodes.length; i += batchSize) {
    batches.push(nodes.slice(i, i + batchSize));
  }

  for (const batch of batches) {
    const batchResult = await _processBatch(
      client, account, batch, gigabytes, denom,
      { sessionManager, log, onCost, lcdUrl },
    );
    for (const [addr, sid] of batchResult) {
      allResults.set(addr, sid);
    }
  }

  return allResults;
}

// ─── Internal: Process a Single Batch ────────────────────────────────────────

/**
 * Process a single batch of nodes: build messages, broadcast, extract IDs.
 * @private
 */
async function _processBatch(client, account, batch, gigabytes, denom, ctx) {
  const { sessionManager, log, onCost, lcdUrl } = ctx;
  const result = new Map();

  // Filter out already-paid nodes
  const toPayBatch = [];
  for (const node of batch) {
    if (sessionManager?.isPaid(node.address)) {
      log(`Skip ${node.address.slice(0, 20)}... - already paid this run`);
      continue;
    }

    const priceEntry = (node.gigabyte_prices || []).find(p => p.denom === denom);
    if (!priceEntry) {
      log(`Skip ${node.address.slice(0, 20)}... - no ${denom} pricing`);
      continue;
    }

    toPayBatch.push({ node, priceEntry });
  }

  if (toPayBatch.length === 0) return result;

  // Build messages
  const messages = toPayBatch.map(({ node, priceEntry }) => ({
    typeUrl: MSG_TYPES.START_SESSION,
    value: {
      from: account.address,
      node_address: node.address,
      gigabytes,
      hours: 0,
      max_price: {
        denom: priceEntry.denom,
        base_value: priceEntry.base_value,
        quote_value: priceEntry.quote_value,
      },
    },
  }));

  // Calculate fee
  const n = toPayBatch.length;
  const fee = {
    amount: [{ denom, amount: String(FEE_PER_MSG * n) }],
    gas: String(GAS_PER_MSG * n),
  };

  // Broadcast
  let txResult;
  try {
    txResult = await broadcast(client, account.address, messages, fee);
  } catch (err) {
    throw new ChainError(
      ErrorCodes.BROADCAST_FAILED,
      `Batch session TX failed (${n} nodes): ${err.message}`,
      { nodeCount: n, original: err.message },
    );
  }

  // Extract session IDs from TX events
  const ids = extractAllSessionIds(txResult);

  const unmatchedNodes = [];
  toPayBatch.forEach(({ node }, i) => {
    // Mark as paid regardless
    if (sessionManager) sessionManager.markPaid(node.address);

    if (ids[i]) {
      result.set(node.address, ids[i]);
      if (sessionManager) sessionManager.addToSessionMap(node.address, ids[i]);
    } else {
      unmatchedNodes.push(node.address);
    }
  });

  // Fallback: look up missing session IDs on-chain
  if (unmatchedNodes.length > 0) {
    log(`${unmatchedNodes.length} session IDs not extracted from TX, looking up on chain...`);
    await sleep(POST_TX_POLL_DELAY);

    if (sessionManager) sessionManager.invalidateSessionMap();

    for (const addr of unmatchedNodes) {
      try {
        const sid = sessionManager
          ? await sessionManager.findExistingSession(addr)
          : await findExistingSession(lcdUrl, account.address, addr);
        if (sid) {
          result.set(addr, sid);
        } else {
          log(`Could not find session for ${addr.slice(0, 20)}... - may need individual payment`);
        }
      } catch (err) {
        log(`Fallback lookup failed for ${addr.slice(0, 20)}...: ${err.message}`);
      }
    }
  }

  // Log TX hash
  log(`Batch TX (${n} msgs): ${txResult.transactionHash.slice(0, 16)}...`);

  // Report cost
  if (onCost) {
    let sessionCost = 0;
    for (const { node } of toPayBatch) {
      const priceEntry = (node.gigabyte_prices || []).find(p => p.denom === denom);
      if (priceEntry) {
        sessionCost += Math.round(parseFloat(priceEntry.quote_value) || 0) * gigabytes;
      }
    }
    const gasCost = FEE_PER_MSG * n;
    onCost({ udvpn: sessionCost + gasCost, sessionCost, gasCost, txHash: txResult.transactionHash });
  }

  return result;
}

// ─── Wait for Batch Sessions ─────────────────────────────────────────────────

/**
 * Poll until all node sessions appear on chain, or timeout.
 * Useful after batch payment to ensure sessions are confirmed before handshake.
 *
 * @param {string[]} nodeAddrs - Node addresses to wait for
 * @param {string} walletAddr - Wallet address
 * @param {string} [lcdUrl] - LCD endpoint URL
 * @param {object} [options]
 * @param {number} [options.maxWaitMs=20000] - Maximum wait time in ms
 * @param {number} [options.pollIntervalMs=2000] - Poll interval in ms
 * @returns {Promise<{ confirmed: string[], pending: string[] }>}
 */
export async function waitForBatchSessions(nodeAddrs, walletAddr, lcdUrl, options = {}) {
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_POLL_TIMEOUT;
  const pollIntervalMs = options.pollIntervalMs ?? 2000;
  const baseLcd = lcdUrl || 'https://lcd.sentinel.co';

  if (nodeAddrs.length === 0) return { confirmed: [], pending: [] };

  const pending = new Set(nodeAddrs);
  const deadline = Date.now() + maxWaitMs;

  while (pending.size > 0 && Date.now() < deadline) {
    await sleep(pollIntervalMs);
    try {
      const result = await lcdPaginatedSafe(
        baseLcd,
        `/sentinel/session/v3/sessions?address=${walletAddr}&status=1`,
        'sessions',
      );
      for (const s of (result.items || [])) {
        const bs = s.base_session || s;
        const n = bs.node_address || bs.node;
        if (pending.has(n)) pending.delete(n);
      }
    } catch {
      // Transient LCD error — will retry on next poll
    }
  }

  const confirmed = nodeAddrs.filter(a => !pending.has(a));
  return { confirmed, pending: [...pending] };
}

/**
 * Wait for a single session to appear on chain.
 * Convenience wrapper around waitForBatchSessions.
 *
 * @param {string} nodeAddr - Node address
 * @param {string} walletAddr - Wallet address
 * @param {string} [lcdUrl] - LCD endpoint URL
 * @param {object} [options]
 * @param {number} [options.maxWaitMs=20000] - Maximum wait time in ms
 * @returns {Promise<boolean>} True if session confirmed, false if timed out
 */
export async function waitForSessionActive(nodeAddr, walletAddr, lcdUrl, options = {}) {
  const { confirmed } = await waitForBatchSessions([nodeAddr], walletAddr, lcdUrl, options);
  return confirmed.includes(nodeAddr);
}
