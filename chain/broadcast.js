/**
 * Sentinel SDK — Chain / Broadcast Module
 *
 * TX broadcasting: simple broadcast, fee-granted broadcast,
 * safe broadcaster (mutex + retry + sequence recovery + RPC rotation),
 * chain error parsing, event extraction.
 *
 * Usage:
 *   import { broadcast, createSafeBroadcaster, broadcastWithFeeGrant } from './chain/broadcast.js';
 *   const result = await broadcast(client, addr, [msg]);
 */

import { SigningStargateClient, GasPrice } from '@cosmjs/stargate';
import { GAS_PRICE, RPC_ENDPOINTS } from '../defaults.js';
import { ChainError, ErrorCodes } from '../errors.js';
import { buildRegistry } from './client.js';

// ─── TX Helpers ──────────────────────────────────────────────────────────────

/**
 * Simple broadcast — send messages and return result.
 * For production apps with multiple TXs, use createSafeBroadcaster() instead.
 */
export async function broadcast(client, signerAddress, msgs, fee = null) {
  // Fee validation: detect malformed fee objects and fall back to 'auto'
  if (!fee || (typeof fee === 'object' && (!fee.gas || !fee.amount))) fee = 'auto';
  let result;
  try {
    result = await client.signAndBroadcast(signerAddress, msgs, fee);
  } catch (err) {
    // CosmJS on Node.js v18+ uses native fetch (undici) internally for RPC.
    // Undici throws opaque "fetch failed" on network errors. Re-wrap with context.
    const typeUrls = msgs.map(m => m.typeUrl).join(', ');
    throw new ChainError(ErrorCodes.BROADCAST_FAILED, `Broadcast failed (${typeUrls}): ${err.message}`, { typeUrls, original: err.message });
  }
  if (result.code !== 0) throw new ChainError(ErrorCodes.TX_FAILED, `TX failed (code ${result.code}): ${result.rawLog}`, { code: result.code, rawLog: result.rawLog, txHash: result.transactionHash });
  return result;
}

// ─── Safe Broadcast (Mutex + Retry + Sequence Recovery) ─────────────────────
// Production-critical: prevents sequence mismatch errors when sending
// multiple TXs rapidly (batch operations, auto-lease + link, UI clicks).

export function isSequenceError(errOrStr) {
  // Check Cosmos SDK error code 32 (ErrWrongSequence) first
  if (errOrStr?.code === 32) return true;
  const s = typeof errOrStr === 'string' ? errOrStr : errOrStr?.message || String(errOrStr);
  // Try parsing rawLog as JSON to extract error code
  try { const parsed = JSON.parse(s); if (parsed?.code === 32) return true; } catch {} // not JSON — fall through to string match
  // Fallback to string match (last resort — fragile across Cosmos SDK upgrades)
  return s && (s.includes('account sequence mismatch') || s.includes('incorrect account sequence'));
}

/** Check if error is "wrong number of signers" — indicates stale client state, retryable with reconnect */
function isSignerError(errOrStr) {
  const s = typeof errOrStr === 'string' ? errOrStr : errOrStr?.message || String(errOrStr);
  return s && s.includes('wrong number of signers');
}

/** Check if error is a network/connection failure — triggers RPC endpoint rotation */
function isConnectionError(errOrStr) {
  const s = typeof errOrStr === 'string' ? errOrStr : errOrStr?.message || String(errOrStr);
  return s && (/fetch failed|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET|ENETUNREACH|Query failed/i.test(s));
}

/**
 * Create a safe broadcaster with mutex serialization and retry logic.
 * Only one TX broadcasts at a time. Sequence errors trigger client reconnect + retry.
 *
 * Usage:
 *   const { safeBroadcast } = createSafeBroadcaster(rpcUrl, wallet, signerAddress);
 *   const result = await safeBroadcast([msg1, msg2]); // batch = one TX
 */
export function createSafeBroadcaster(rpcUrl, wallet, signerAddress) {
  let _client = null;
  let _queue = Promise.resolve();
  // RPC rotation: cycle through endpoints on connection failures
  const _rpcUrls = [rpcUrl, ...RPC_ENDPOINTS.map(e => e.url).filter(u => u !== rpcUrl)];
  let _rpcIdx = 0;

  function _currentRpc() { return _rpcUrls[_rpcIdx % _rpcUrls.length]; }
  function _rotateRpc() { _rpcIdx = (_rpcIdx + 1) % _rpcUrls.length; return _currentRpc(); }

  async function getClient() {
    if (!_client) {
      _client = await SigningStargateClient.connectWithSigner(_currentRpc(), wallet, {
        gasPrice: GasPrice.fromString(GAS_PRICE),
        registry: buildRegistry(),
      });
    }
    return _client;
  }

  async function resetClient(rotate = false) {
    if (rotate) _rotateRpc();
    _client = await SigningStargateClient.connectWithSigner(_currentRpc(), wallet, {
      gasPrice: GasPrice.fromString(GAS_PRICE),
      registry: buildRegistry(),
    });
    return _client;
  }

  async function _inner(msgs, memo) {
    for (let attempt = 0; attempt < 5; attempt++) {
      let client;
      if (attempt === 0) {
        client = await getClient();
      } else {
        const delay = Math.min(2000 * attempt, 6000);
        await new Promise(r => setTimeout(r, delay));
        client = await resetClient(); // fresh connection = fresh sequence
      }

      try {
        const result = await client.signAndBroadcast(signerAddress, msgs, 'auto', memo);
        if (result.code !== 0 && isSequenceError(result.rawLog)) continue;
        return result;
      } catch (err) {
        if (isSequenceError(err.message)) continue;
        // "wrong number of signers" — stale client state, retryable with reconnect
        if (isSignerError(err.message)) continue;
        // Connection/network failure — rotate to next RPC endpoint
        if (isConnectionError(err.message)) {
          client = await resetClient(true);
          continue;
        }
        throw err;
      }
    }
    // Final attempt — try with rotated RPC
    await new Promise(r => setTimeout(r, 4000));
    const client = await resetClient(true);
    return client.signAndBroadcast(signerAddress, msgs, 'auto', memo);
  }

  function safeBroadcast(msgs, memo) {
    const p = _queue.then(() => _inner(msgs, memo));
    _queue = p.catch(() => {}); // don't break queue on failure
    return p;
  }

  return { safeBroadcast, getClient, resetClient };
}

/**
 * Broadcast a TX with fee paid by a granter (fee grant).
 * The grantee signs; the granter pays gas via their fee allowance.
 * @param {SigningStargateClient} client - Client with grantee's wallet
 * @param {string} signerAddress - Grantee address (sent1...)
 * @param {Array} msgs - Messages to broadcast
 * @param {string} granterAddress - Fee granter address (sent1...)
 * @param {string} memo - Optional memo
 */
export async function broadcastWithFeeGrant(client, signerAddress, msgs, granterAddress, memo = '') {
  // NOTE: client.simulate() does NOT support fee granter — it simulates without
  // the granter field, causing "insufficient funds" if the grantee has low balance.
  // Use fixed gas estimate instead. 300k gas covers all single-message Sentinel TXs.
  // For multi-message batches, scale by message count.
  const gasPerMsg = 200_000;
  const gasLimit = Math.max(300_000, msgs.length * gasPerMsg);
  const fee = {
    amount: [{ denom: 'udvpn', amount: String(Math.ceil(gasLimit * 0.2)) }],
    gas: String(gasLimit),
    granter: granterAddress,
  };
  return client.signAndBroadcast(signerAddress, msgs, fee, memo);
}

// ─── Chain Error Parsing ────────────────────────────────────────────────────

/**
 * Parse chain error messages into user-friendly text.
 * Covers all known Sentinel-specific error patterns.
 */
export function parseChainError(raw) {
  const s = String(raw || '');
  if (s.includes('duplicate node for plan')) return 'Node is already in this plan';
  if (s.includes('duplicate provider')) return 'Provider already registered — use Update';
  if (s.includes('lease') && s.includes('not found')) return 'No active lease for this node';
  if (s.includes('lease') && s.includes('already exists')) return 'Lease already exists for this node';
  if (s.includes('insufficient funds')) return 'Insufficient P2P balance';
  if (s.includes('invalid price')) return 'Price mismatch — node may have changed rates';
  if (s.includes('invalid status inactive')) return 'Plan is inactive — activate first';
  if (s.includes('plan') && s.includes('does not exist')) return 'Plan not found on chain';
  if (s.includes('provider') && s.includes('does not exist')) return 'Provider not registered';
  if (s.includes('node') && s.includes('does not exist')) return 'Node not found on chain';
  if (s.includes('node') && s.includes('not active')) return 'Node is inactive';
  if (s.includes('active session already exists')) return 'Session already exists for this node';
  if (s.includes('subscription') && s.includes('not found')) return 'Subscription not found or expired';
  if (s.includes('node address mismatch')) return 'Node address mismatch — wrong node at this URL';
  if (s.includes('maximum peer limit')) return 'Node is full — maximum peer limit reached';
  if (isSequenceError(s)) return 'Chain busy — sequence mismatch. Wait and retry.';
  if (s.includes('out of gas')) return 'Transaction out of gas';
  if (s.includes('timed out')) return 'Transaction timed out';
  const m = s.match(/desc = (.+?)(?:\[|With gas|$)/);
  if (m) return m[1].trim().slice(0, 120);
  return s.slice(0, 150);
}

// ─── TX Event Extraction ────────────────────────────────────────────────────

/**
 * Extract an ID from TX ABCI events.
 * Events may have base64-encoded keys/values depending on CosmJS version.
 *
 * Usage:
 *   extractId(result, /session/i, ['session_id', 'id'])
 *   extractId(result, /subscription/i, ['subscription_id', 'id'])
 *   extractId(result, /plan/i, ['plan_id', 'id'])
 *   extractId(result, /lease/i, ['lease_id', 'id'])
 */
export function extractId(txResult, eventPattern, keyNames) {
  for (const event of (txResult.events || [])) {
    if (eventPattern.test(event.type)) {
      for (const attr of event.attributes) {
        const k = typeof attr.key === 'string'
          ? attr.key
          : Buffer.from(attr.key, 'base64').toString('utf8');
        const v = typeof attr.value === 'string'
          ? attr.value
          : Buffer.from(attr.value, 'base64').toString('utf8');
        if (keyNames.includes(k)) {
          const p = v.replace(/"/g, '');
          if (p && parseInt(p) > 0) return p;
        }
      }
    }
  }
  return null;
}

/**
 * Decode base64-encoded TX events into readable key-value pairs.
 * @param {Array} events - TX result events array
 * @returns {Array<{ type: string, attributes: Array<{ key: string, value: string }> }>}
 */
export function decodeTxEvents(events) {
  return (events || []).map(e => ({
    type: e.type,
    attributes: (e.attributes || []).map(a => ({
      key: typeof a.key === 'string' ? a.key : Buffer.from(a.key, 'base64').toString('utf8'),
      value: typeof a.value === 'string' ? a.value : Buffer.from(a.value, 'base64').toString('utf8'),
    })),
  }));
}

/**
 * Extract ALL session IDs from a batch TX result (multiple MsgStartSession).
 * @param {DeliverTxResponse} txResult
 * @returns {bigint[]}
 */
export function extractAllSessionIds(txResult) {
  const ids = [];
  const seen = new Set();
  const decoded = decodeTxEvents(txResult.events || []);
  for (const evt of decoded) {
    if (/session/i.test(evt.type)) {
      for (const attr of evt.attributes) {
        if (attr.key === 'session_id' || attr.key === 'SessionID' || attr.key === 'id') {
          try {
            const id = BigInt(attr.value.replace(/"/g, '')); // strip quotes from base64-decoded values
            if (id > 0n && !seen.has(id)) { seen.add(id); ids.push(id); }
          } catch {}
        }
      }
    }
  }
  return ids;
}

/**
 * BigInt-safe serialization of TX result (for logging/API responses).
 */
export function txResponse(result) {
  return {
    ok: result.code === 0,
    txHash: result.transactionHash,
    gasUsed: Number(result.gasUsed),
    gasWanted: Number(result.gasWanted),
    code: result.code,
    rawLog: result.rawLog,
    events: result.events,
  };
}

/**
 * Serialize a ConnectResult for JSON APIs. Handles BigInt → string conversion.
 * Without this, JSON.stringify(connectResult) throws "BigInt can't be serialized".
 *
 * @param {object} result - ConnectResult from connectDirect/connectAuto/connectViaPlan
 * @returns {object} JSON-safe object with sessionId as string
 *
 * @example
 *   const conn = await connectDirect(opts);
 *   res.json(serializeResult(conn)); // Safe for Express response
 */
export function serializeResult(result) {
  if (!result || typeof result !== 'object') return result;
  const out = {};
  for (const [key, val] of Object.entries(result)) {
    if (typeof val === 'bigint') out[key] = String(val);
    else if (typeof val === 'function') continue; // skip cleanup()
    else out[key] = val;
  }
  return out;
}

/**
 * Estimate gas fee for a batch of messages.
 * @param {number} msgCount
 * @param {string} [msgType='startSession'] - 'startSession' | 'feeGrant' | 'send'
 * @returns {{ gas: number, amount: number, fee: { amount: Array<{ denom: string, amount: string }>, gas: string } }}
 */
export function estimateBatchFee(msgCount, msgType = 'startSession') {
  const gasPerMsg = { startSession: 200000, feeGrant: 150000, send: 80000, link: 150000 };
  const base = gasPerMsg[msgType] || 200000;
  const gas = base * msgCount;
  const amount = Math.ceil(gas * 0.2); // GAS_PRICE = 0.2udvpn
  return {
    gas,
    amount,
    fee: { amount: [{ denom: 'udvpn', amount: String(amount) }], gas: String(gas) },
  };
}

// ─── Batch Message Builders ─────────────────────────────────────────────────

/**
 * Build batch MsgStartSession messages for multiple nodes in one TX.
 * Saves gas vs separate TXs (~800k gas for 5 sessions vs 200k x 5 = 1M).
 *
 * @param {string} from - Wallet address (sent1...)
 * @param {Array<{ nodeAddress: string, gigabytes?: number, maxPrice: { denom: string, base_value: string, quote_value: string } }>} nodes
 * @returns {Array<{ typeUrl: string, value: object }>} Messages ready for broadcast()
 */
export function buildBatchStartSession(from, nodes) {
  return nodes.map(n => ({
    typeUrl: '/sentinel.node.v3.MsgStartSessionRequest',
    value: {
      from,
      node_address: n.nodeAddress,
      gigabytes: n.gigabytes || 1,
      hours: 0,
      max_price: n.maxPrice,
    },
  }));
}

/**
 * Build MsgEndSession to close a session early (stop paying for bandwidth).
 * @param {string} from - Wallet address
 * @param {number|string|bigint} sessionId - Session to end
 * @returns {{ typeUrl: string, value: object }}
 */
export function buildEndSessionMsg(from, sessionId) {
  return {
    typeUrl: '/sentinel.session.v3.MsgCancelSessionRequest',
    value: { from, id: BigInt(sessionId) },
  };
}

/**
 * Build batch MsgSend messages for token distribution.
 * @param {string} fromAddress
 * @param {Array<{ address: string, amountUdvpn: number|string }>} recipients
 * @returns {Array<{ typeUrl: string, value: object }>}
 */
export function buildBatchSend(fromAddress, recipients) {
  return recipients.map(r => ({
    typeUrl: '/cosmos.bank.v1beta1.MsgSend',
    value: { fromAddress, toAddress: r.address, amount: [{ denom: 'udvpn', amount: String(r.amountUdvpn) }] },
  }));
}

/**
 * Build batch MsgLinkNode messages for linking nodes to a plan.
 * @param {string} provAddress - sentprov1... address
 * @param {number|string|bigint} planId
 * @param {string[]} nodeAddresses - sentnode1... addresses
 * @returns {Array<{ typeUrl: string, value: object }>}
 */
export function buildBatchLink(provAddress, planId, nodeAddresses) {
  return nodeAddresses.map(addr => ({
    typeUrl: '/sentinel.plan.v3.MsgLinkNodeRequest',
    value: { from: provAddress, id: BigInt(planId), node_address: addr },
  }));
}

/**
 * Send P2P tokens to an address.
 * @param {SigningStargateClient} client
 * @param {string} fromAddress
 * @param {string} toAddress
 * @param {number|string} amountUdvpn - Amount in micro-denom
 * @param {string} [memo='']
 * @returns {Promise<DeliverTxResponse>}
 */
export async function sendTokens(client, fromAddress, toAddress, amountUdvpn, memo = '') {
  // Robust amount extraction: handle string, number, bigint, or coin object { amount, denom }
  let amountStr;
  if (amountUdvpn && typeof amountUdvpn === 'object') {
    amountStr = String(amountUdvpn.amount || amountUdvpn.value || amountUdvpn);
  } else {
    amountStr = String(amountUdvpn);
  }
  if (!amountStr || amountStr === 'undefined' || amountStr === 'null' || amountStr === '[object Object]') {
    throw new Error(`sendTokens: invalid amount "${amountUdvpn}" — expected string or number, got ${typeof amountUdvpn}`);
  }
  const msg = {
    typeUrl: '/cosmos.bank.v1beta1.MsgSend',
    value: { fromAddress, toAddress, amount: [{ denom: 'udvpn', amount: amountStr }] },
  };
  return broadcast(client, fromAddress, [msg]);
}

/**
 * Subscribe to a plan. Returns subscription ID from TX events.
 * @param {SigningStargateClient} client
 * @param {string} fromAddress
 * @param {number|string|bigint} planId
 * @param {string} [denom='udvpn']
 * @returns {Promise<{ subscriptionId: bigint, txHash: string }>}
 */
export async function subscribeToPlan(client, fromAddress, planId, denom = 'udvpn') {
  const msg = {
    typeUrl: '/sentinel.subscription.v3.MsgStartSubscriptionRequest',
    value: { from: fromAddress, id: BigInt(planId), denom, renewalPricePolicy: 0 },
  };
  const result = await broadcast(client, fromAddress, [msg]);
  const subId = extractId(result, /subscription/i, ['subscription_id', 'id']);
  if (!subId) throw new ChainError(ErrorCodes.SESSION_EXTRACT_FAILED, 'Failed to extract subscription ID from TX events', { txHash: result.transactionHash });
  return { subscriptionId: BigInt(subId), txHash: result.transactionHash };
}

/**
 * Estimate the cost of starting a session with a node.
 * Supports both gigabyte and hourly pricing. When preferHourly is true and
 * hourly pricing is available and cheaper, returns the hourly cost instead.
 *
 * @param {object} nodeInfo - Node LCD object with gigabyte_prices and optionally hourly_prices
 * @param {number} [gigabytes=1] - Number of gigabytes (ignored when hourly pricing is selected)
 * @param {{ preferHourly?: boolean, hours?: number }} [options] - Optional pricing mode
 * @returns {{ udvpn: number, dvpn: number, gasUdvpn: number, totalUdvpn: number, mode: 'gigabyte'|'hourly', hourlyUdvpn?: number, gigabyteUdvpn?: number }}
 */
export function estimateSessionCost(nodeInfo, gigabytes = 1, options = {}) {
  const gbPrices = nodeInfo.gigabyte_prices || nodeInfo.gigabytePrices || [];
  const gbEntry = gbPrices.find(p => p.denom === 'udvpn');
  const perGb = parseInt(gbEntry?.quote_value || gbEntry?.amount || '0', 10);

  const hrPrices = nodeInfo.hourly_prices || nodeInfo.hourlyPrices || [];
  const hrEntry = hrPrices.find(p => p.denom === 'udvpn');
  const perHour = parseInt(hrEntry?.quote_value || hrEntry?.amount || '0', 10);

  const hours = options.hours || 1;
  const gbCost = perGb * gigabytes;
  const hrCost = perHour * hours;

  // Use hourly if preferHourly is set AND hourly pricing exists AND is cheaper
  const useHourly = options.preferHourly && hrEntry && hrCost < gbCost;
  const sessionCost = useHourly ? hrCost : gbCost;
  const gasEstimate = 200000; // ~200k gas per MsgStartSession

  return {
    udvpn: sessionCost,
    dvpn: sessionCost / 1_000_000,
    gasUdvpn: gasEstimate,
    totalUdvpn: sessionCost + gasEstimate,
    mode: useHourly ? 'hourly' : 'gigabyte',
    hourlyUdvpn: perHour || null,
    gigabyteUdvpn: perGb || null,
  };
}
