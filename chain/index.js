/**
 * Sentinel SDK — Chain / Blockchain Module
 *
 * CosmJS client creation, transaction broadcasting, LCD queries, registry
 * building, FeeGrant, Authz, and all chain-interaction helpers.
 *
 * Extracted from cosmjs-setup.js during v22 modularization.
 *
 * Usage:
 *   import { createClient, broadcast, lcd, MSG_TYPES } from './chain/index.js';
 *   const client = await createClient(rpcUrl, wallet);
 *   const result = await broadcast(client, addr, [msg]);
 */

import { Registry } from '@cosmjs/proto-signing';
import { SigningStargateClient, GasPrice, defaultRegistryTypes } from '@cosmjs/stargate';
import axios from 'axios';

// Protocol — protobuf encoders for Sentinel message types
import {
  encodeMsgStartSession,
  encodeMsgStartSubscription,
  encodeMsgSubStartSession,
  extractSessionId,
  encodeVarint, protoString, protoInt64, protoEmbedded,
} from '../protocol/index.js';

import {
  encodeMsgRegisterProvider,
  encodeMsgUpdateProviderDetails,
  encodeMsgUpdateProviderStatus,
  encodeMsgCreatePlan,
  encodeMsgUpdatePlanStatus,
  encodeMsgLinkNode,
  encodeMsgUnlinkNode,
  encodeMsgPlanStartSession,
  encodeMsgStartLease,
  encodeMsgEndLease,
} from '../protocol/index.js';

// Config — gas price, LCD endpoints, fallback logic
import { GAS_PRICE, LCD_ENDPOINTS, tryWithFallback } from '../config/index.js';

// Errors — typed error classes
import { ValidationError, NodeError, ErrorCodes } from '../errors/index.js';

// Security — CA-validated HTTPS agent for public LCD/RPC endpoints
import { publicEndpointAgent } from '../security/index.js';

// Wallet — validation helpers (used by chain functions that validate addresses)
import { validateMnemonic, validateAddress } from '../wallet/index.js';

// RPC-first query modules — delegates LCD-only functions to these
import {
  findExistingSession as _rpcFindExistingSession,
  fetchActiveNodes as _rpcFetchActiveNodes,
  getNetworkOverview as _rpcGetNetworkOverview,
  getNodePrices as _rpcGetNodePrices,
  discoverPlanIds as _rpcDiscoverPlanIds,
} from './queries.js';
import {
  queryFeeGrants as _rpcQueryFeeGrants,
  queryFeeGrant as _rpcQueryFeeGrant,
} from './fee-grants.js';

// ─── All Type URL Constants ──────────────────────────────────────────────────

export const MSG_TYPES = {
  // Direct node session
  START_SESSION:          '/sentinel.node.v3.MsgStartSessionRequest',
  // Subscription
  START_SUBSCRIPTION:     '/sentinel.subscription.v3.MsgStartSubscriptionRequest',
  SUB_START_SESSION:      '/sentinel.subscription.v3.MsgStartSessionRequest',
  // Plan
  PLAN_START_SESSION:     '/sentinel.plan.v3.MsgStartSessionRequest',
  CREATE_PLAN:            '/sentinel.plan.v3.MsgCreatePlanRequest',
  UPDATE_PLAN_STATUS:     '/sentinel.plan.v3.MsgUpdatePlanStatusRequest',
  LINK_NODE:              '/sentinel.plan.v3.MsgLinkNodeRequest',
  UNLINK_NODE:            '/sentinel.plan.v3.MsgUnlinkNodeRequest',
  // Provider
  REGISTER_PROVIDER:      '/sentinel.provider.v3.MsgRegisterProviderRequest',
  UPDATE_PROVIDER:        '/sentinel.provider.v3.MsgUpdateProviderDetailsRequest',
  UPDATE_PROVIDER_STATUS: '/sentinel.provider.v3.MsgUpdateProviderStatusRequest',
  // Lease
  START_LEASE:            '/sentinel.lease.v1.MsgStartLeaseRequest',
  END_LEASE:              '/sentinel.lease.v1.MsgEndLeaseRequest',
  // Cosmos FeeGrant
  GRANT_FEE_ALLOWANCE:    '/cosmos.feegrant.v1beta1.MsgGrantAllowance',
  REVOKE_FEE_ALLOWANCE:   '/cosmos.feegrant.v1beta1.MsgRevokeAllowance',
  // Cosmos Authz
  AUTHZ_GRANT:            '/cosmos.authz.v1beta1.MsgGrant',
  AUTHZ_REVOKE:           '/cosmos.authz.v1beta1.MsgRevoke',
  AUTHZ_EXEC:             '/cosmos.authz.v1beta1.MsgExec',
};

// ─── CosmJS Registry ─────────────────────────────────────────────────────────

/**
 * Adapter that wraps a manual protobuf encoder for CosmJS's Registry.
 * CosmJS expects { fromPartial, encode, decode } — we only need encode.
 */
function makeMsgType(encodeFn) {
  return {
    fromPartial: (v) => v,
    encode: (inst) => ({ finish: () => encodeFn(inst) }),
    decode: () => ({}),
  };
}

/**
 * Build a CosmJS Registry with ALL 13 Sentinel message types registered.
 * This is required for signAndBroadcast to encode Sentinel-specific messages.
 */
export function buildRegistry() {
  return new Registry([
    ...defaultRegistryTypes,
    // Direct node session (v3protocol.js)
    ['/sentinel.node.v3.MsgStartSessionRequest', makeMsgType(encodeMsgStartSession)],
    // Subscription (v3protocol.js)
    ['/sentinel.subscription.v3.MsgStartSubscriptionRequest', makeMsgType(encodeMsgStartSubscription)],
    ['/sentinel.subscription.v3.MsgStartSessionRequest', makeMsgType(encodeMsgSubStartSession)],
    // Plan (plan-operations.js)
    ['/sentinel.plan.v3.MsgStartSessionRequest', makeMsgType(encodeMsgPlanStartSession)],
    ['/sentinel.plan.v3.MsgCreatePlanRequest', makeMsgType(encodeMsgCreatePlan)],
    ['/sentinel.plan.v3.MsgLinkNodeRequest', makeMsgType(encodeMsgLinkNode)],
    ['/sentinel.plan.v3.MsgUnlinkNodeRequest', makeMsgType(encodeMsgUnlinkNode)],
    ['/sentinel.plan.v3.MsgUpdatePlanStatusRequest', makeMsgType(encodeMsgUpdatePlanStatus)],
    // Provider (plan-operations.js)
    ['/sentinel.provider.v3.MsgRegisterProviderRequest', makeMsgType(encodeMsgRegisterProvider)],
    ['/sentinel.provider.v3.MsgUpdateProviderDetailsRequest', makeMsgType(encodeMsgUpdateProviderDetails)],
    ['/sentinel.provider.v3.MsgUpdateProviderStatusRequest', makeMsgType(encodeMsgUpdateProviderStatus)],
    // Lease (plan-operations.js)
    ['/sentinel.lease.v1.MsgStartLeaseRequest', makeMsgType(encodeMsgStartLease)],
    ['/sentinel.lease.v1.MsgEndLeaseRequest', makeMsgType(encodeMsgEndLease)],
  ]);
}

// ─── Signing Client ──────────────────────────────────────────────────────────

/**
 * Create a SigningStargateClient connected to Sentinel RPC.
 * Gas price: from defaults.js GAS_PRICE (chain minimum).
 */
export async function createClient(rpcUrl, wallet) {
  return SigningStargateClient.connectWithSigner(rpcUrl, wallet, {
    gasPrice: GasPrice.fromString(GAS_PRICE),
    registry: buildRegistry(),
  });
}

// ─── TX Helpers ──────────────────────────────────────────────────────────────

/**
 * Simple broadcast — send messages and return result.
 * For production apps with multiple TXs, use createSafeBroadcaster() instead.
 */
export async function broadcast(client, signerAddress, msgs, fee = null) {
  if (!fee) fee = 'auto';
  let result;
  try {
    result = await client.signAndBroadcast(signerAddress, msgs, fee);
  } catch (err) {
    // CosmJS on Node.js v18+ uses native fetch (undici) internally for RPC.
    // Undici throws opaque "fetch failed" on network errors. Re-wrap with context.
    const typeUrls = msgs.map(m => m.typeUrl).join(', ');
    throw new Error(`Broadcast failed (${typeUrls}): ${err.message}`);
  }
  if (result.code !== 0) throw new Error(`TX failed (code ${result.code}): ${result.rawLog}`);
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

function extractExpectedSeq(s) {
  const m = String(s).match(/expected\s+(\d+)/);
  return m ? parseInt(m[1]) : null;
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

  async function getClient() {
    if (!_client) {
      _client = await SigningStargateClient.connectWithSigner(rpcUrl, wallet, {
        gasPrice: GasPrice.fromString(GAS_PRICE),
        registry: buildRegistry(),
      });
    }
    return _client;
  }

  async function resetClient() {
    _client = await SigningStargateClient.connectWithSigner(rpcUrl, wallet, {
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
        throw err;
      }
    }
    // Final attempt
    await new Promise(r => setTimeout(r, 4000));
    const client = await resetClient();
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
  if (isSequenceError(s)) return 'Chain busy — sequence mismatch. Wait and retry.';
  if (s.includes('out of gas')) return 'Transaction out of gas';
  if (s.includes('timed out')) return 'Transaction timed out';
  const m = s.match(/desc = (.+?)(?:\[|With gas|$)/);
  if (m) return m[1].trim().slice(0, 120);
  return s.slice(0, 150);
}

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

// ─── LCD Query Helper ────────────────────────────────────────────────────────

/**
 * Query a Sentinel LCD REST endpoint.
 * Checks both HTTP status AND gRPC error codes in response body.
 * Uses CA-validated HTTPS for LCD public infrastructure (valid CA certs).
 *
 * Usage:
 *   const data = await lcd('https://lcd.sentinel.co', '/sentinel/node/v3/nodes?status=1');
 */
export async function lcd(baseUrl, path) {
  const url = `${baseUrl}${path}`;
  const res = await axios.get(url, { httpsAgent: publicEndpointAgent, timeout: 15000 });
  const data = res.data;
  if (data?.code && data.code !== 0) {
    throw new Error(`LCD ${path}: code=${data.code} ${data.message || ''}`);
  }
  return data;
}

// ─── Query Helpers ───────────────────────────────────────────────────────────

/**
 * Check wallet balance.
 * Returns { udvpn: number, dvpn: number }
 */
export async function getBalance(client, address) {
  const bal = await client.getBalance(address, 'udvpn');
  const amount = parseInt(bal?.amount || '0', 10) || 0;
  return { udvpn: amount, dvpn: amount / 1_000_000 };
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
 * Find an existing active session for a wallet+node pair.
 * Returns session ID (BigInt) or null. Use this to avoid double-paying.
 * Delegates to chain/queries.js RPC-first implementation.
 */
export async function findExistingSession(lcdUrl, walletAddr, nodeAddr) {
  return _rpcFindExistingSession(lcdUrl, walletAddr, nodeAddr);
}

/**
 * Resolve LCD node object to an HTTPS URL.
 * LCD v3 returns `remote_addrs: ["IP:PORT"]` (array, NO protocol prefix).
 * Legacy responses may have `remote_url: "https://IP:PORT"` (string with prefix).
 * This handles both formats.
 */
export function resolveNodeUrl(node) {
  // Try legacy field first (string with https://)
  if (node.remote_url && typeof node.remote_url === 'string') return node.remote_url;
  // v3 LCD: remote_addrs is an array of "IP:PORT" strings
  const addrs = node.remote_addrs || [];
  const raw = addrs.find(a => a.includes(':')) || addrs[0];
  if (!raw) throw new Error(`Node ${node.address} has no remote_addrs`);
  return raw.startsWith('http') ? raw : `https://${raw}`;
}

/**
 * Fetch all active nodes with RPC-first + LCD fallback.
 * Returns array of node objects. Each node has `remote_url` resolved from `remote_addrs`.
 * Delegates to chain/queries.js RPC-first implementation.
 */
export async function fetchActiveNodes(lcdUrl, limit = 500, maxPages = 20) {
  return _rpcFetchActiveNodes(lcdUrl, limit, maxPages);
}

/**
 * Get a quick network overview — total nodes, counts by country and service type, average prices.
 * Delegates to chain/queries.js RPC-first implementation.
 *
 * @param {string} [lcdUrl] - LCD endpoint (default: cascading fallback)
 * @returns {Promise<{ totalNodes: number, byCountry: Array<{country: string, count: number}>, byType: {wireguard: number, v2ray: number, unknown: number}, averagePrice: {gigabyteDvpn: number, hourlyDvpn: number}, nodes: Array }>}
 */
export async function getNetworkOverview(lcdUrl) {
  return _rpcGetNetworkOverview(lcdUrl);
}

/**
 * Discover plan IDs by probing subscription endpoints.
 * Delegates to chain/queries.js RPC-first implementation.
 * Returns sorted array of plan IDs that have at least 1 subscription.
 */
export async function discoverPlanIds(lcdUrl, maxId = 100) {
  return _rpcDiscoverPlanIds(lcdUrl, maxId);
}

/**
 * Get standardized prices for a node — abstracts V3 price parsing entirely.
 * Delegates to chain/queries.js RPC-first implementation (direct node lookup, not full-list scan).
 *
 * @param {string} nodeAddress - sentnode1... address
 * @param {string} [lcdUrl] - LCD endpoint URL (default: cascading fallback across all endpoints)
 * @returns {Promise<{ gigabyte: { dvpn: number, udvpn: number, raw: object|null }, hourly: { dvpn: number, udvpn: number, raw: object|null }, denom: string, nodeAddress: string }>}
 */
export async function getNodePrices(nodeAddress, lcdUrl) {
  return _rpcGetNodePrices(nodeAddress, lcdUrl);
}

// ─── Display & Serialization Helpers ────────────────────────────────────────

/**
 * Format a micro-denom (udvpn) amount as a human-readable P2P string.
 *
 * @param {number|string} udvpn - Amount in micro-denom (1 P2P = 1,000,000 udvpn)
 * @param {number} [decimals=2] - Decimal places to show
 * @returns {string} e.g., "0.04 P2P", "47.69 P2P"
 *
 * @example
 *   formatDvpn(40152030);      // "40.15 P2P"
 *   formatDvpn('1000000', 0);  // "1 P2P"
 *   formatDvpn(500000, 4);     // "0.5000 P2P"
 */
export function formatDvpn(udvpn, decimals = 2) {
  const val = Number(udvpn) / 1_000_000;
  if (isNaN(val)) return '? P2P';
  return `${val.toFixed(decimals)} P2P`;
}

/** Alias for formatDvpn — uses the new P2P token ticker. */
export const formatP2P = formatDvpn;

/**
 * Filter a node list by country, service type, and/or max price.
 * Works with results from listNodes(), enrichNodes(), or fetchAllNodes().
 *
 * @param {Array} nodes - Array of node objects
 * @param {object} criteria
 * @param {string} [criteria.country] - Country name (case-insensitive partial match)
 * @param {string} [criteria.serviceType] - 'wireguard' or 'v2ray'
 * @param {number} [criteria.maxPriceDvpn] - Maximum GB price in P2P (e.g., 0.1)
 * @param {number} [criteria.minScore] - Minimum quality score (0-100)
 * @returns {Array} Filtered nodes
 *
 * @example
 *   const cheap = filterNodes(nodes, { maxPriceDvpn: 0.05, serviceType: 'v2ray' });
 *   const german = filterNodes(nodes, { country: 'Germany' });
 */
export function filterNodes(nodes, criteria = {}) {
  if (!Array.isArray(nodes)) return [];
  return nodes.filter(node => {
    if (criteria.country) {
      const c = (node.country || node.location?.country || '').toLowerCase();
      if (!c.includes(criteria.country.toLowerCase())) return false;
    }
    if (criteria.serviceType) {
      const t = node.serviceType || node.type || '';
      if (t !== criteria.serviceType) return false;
    }
    if (criteria.maxPriceDvpn != null) {
      const prices = node.gigabytePrices || node.gigabyte_prices || [];
      const entry = prices.find(p => p.denom === 'udvpn');
      if (entry) {
        const dvpn = parseInt(entry.quote_value || entry.base_value || entry.amount || '0', 10) / 1_000_000;
        if (dvpn > criteria.maxPriceDvpn) return false;
      }
    }
    if (criteria.minScore != null && node.qualityScore != null) {
      if (node.qualityScore < criteria.minScore) return false;
    }
    return true;
  });
}

/**
 * Serialize a ConnectResult for JSON APIs. Handles BigInt -> string conversion.
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

// ─── P2P Price (CoinGecko) ──────────────────────────────────────────────────

let _dvpnPrice = null;
let _dvpnPriceAt = 0;

/**
 * Get P2P token price in USD from CoinGecko (cached for 5 minutes).
 */
export async function getDvpnPrice() {
  if (_dvpnPrice && Date.now() - _dvpnPriceAt < 300_000) return _dvpnPrice;
  try {
    const res = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=sentinel&vs_currencies=usd', { timeout: 10000 });
    _dvpnPrice = res.data?.sentinel?.usd || null;
    _dvpnPriceAt = Date.now();
  } catch { /* keep old value */ }
  return _dvpnPrice;
}

// ─── Protobuf Helpers for FeeGrant & Authz ──────────────────────────────────
// Uses the same manual protobuf encoding as Sentinel types — no codegen needed.

function encodeCoin(denom, amount) {
  return Buffer.concat([protoString(1, denom), protoString(2, String(amount))]);
}

function encodeTimestamp(date) {
  const ms = date.getTime();
  if (Number.isNaN(ms)) throw new ValidationError(ErrorCodes.VALIDATION_FAILED, 'encodeTimestamp(): invalid date', { date });
  const seconds = BigInt(Math.floor(ms / 1000));
  return Buffer.concat([protoInt64(1, seconds)]);
}

function encodeAny(typeUrl, valueBytes) {
  return Buffer.concat([
    protoString(1, typeUrl),
    protoEmbedded(2, valueBytes),
  ]);
}

function encodeBasicAllowance(spendLimit, expiration) {
  const parts = [];
  if (spendLimit != null && spendLimit !== false) {
    const coins = Array.isArray(spendLimit) ? spendLimit : [{ denom: 'udvpn', amount: String(spendLimit) }];
    for (const coin of coins) {
      parts.push(protoEmbedded(1, encodeCoin(coin.denom || 'udvpn', coin.amount)));
    }
  }
  if (expiration) {
    parts.push(protoEmbedded(2, encodeTimestamp(expiration instanceof Date ? expiration : new Date(expiration))));
  }
  return Buffer.concat(parts);
}

function encodeAllowedMsgAllowance(innerTypeUrl, innerBytes, allowedMessages) {
  const parts = [protoEmbedded(1, encodeAny(innerTypeUrl, innerBytes))];
  for (const msg of allowedMessages) {
    parts.push(protoString(2, msg));
  }
  return Buffer.concat(parts);
}

function encodeGenericAuthorization(msgTypeUrl) {
  return protoString(1, msgTypeUrl);
}

function encodeGrant(authTypeUrl, authBytes, expiration) {
  const parts = [protoEmbedded(1, encodeAny(authTypeUrl, authBytes))];
  if (expiration) {
    parts.push(protoEmbedded(2, encodeTimestamp(expiration instanceof Date ? expiration : new Date(expiration))));
  }
  return Buffer.concat(parts);
}

// ─── FeeGrant (cosmos.feegrant.v1beta1) ─────────────────────────────────────
// Gas-free UX: granter pays fees for grantee's transactions.
//
// Usage:
//   const msg = buildFeeGrantMsg(serviceAddr, userAddr, { spendLimit: 5000000 });
//   await broadcast(client, serviceAddr, [msg]);
//   // Now userAddr can broadcast without P2P for gas
//   await broadcastWithFeeGrant(client, userAddr, [connectMsg], serviceAddr);

/**
 * Build a MsgGrantAllowance message.
 * @param {string} granter - Address paying fees (sent1...)
 * @param {string} grantee - Address receiving fee grant (sent1...)
 * @param {object} opts
 * @param {number|Array} opts.spendLimit - Max spend in udvpn (number) or [{denom, amount}]
 * @param {Date|string} opts.expiration - Optional expiry date
 * @param {string[]} opts.allowedMessages - Optional: restrict to specific msg types (uses AllowedMsgAllowance)
 */
export function buildFeeGrantMsg(granter, grantee, opts = {}) {
  const { spendLimit, expiration, allowedMessages } = opts;
  const basicBytes = encodeBasicAllowance(spendLimit, expiration);

  let allowanceTypeUrl, allowanceBytes;
  if (allowedMessages?.length) {
    allowanceTypeUrl = '/cosmos.feegrant.v1beta1.AllowedMsgAllowance';
    allowanceBytes = encodeAllowedMsgAllowance(
      '/cosmos.feegrant.v1beta1.BasicAllowance', basicBytes, allowedMessages
    );
  } else {
    allowanceTypeUrl = '/cosmos.feegrant.v1beta1.BasicAllowance';
    allowanceBytes = basicBytes;
  }

  // MsgGrantAllowance: field 1=granter, field 2=grantee, field 3=allowance(Any)
  return {
    typeUrl: '/cosmos.feegrant.v1beta1.MsgGrantAllowance',
    value: { granter, grantee, allowance: { typeUrl: allowanceTypeUrl, value: Uint8Array.from(allowanceBytes) } },
  };
}

/**
 * Build a MsgRevokeAllowance message.
 */
export function buildRevokeFeeGrantMsg(granter, grantee) {
  return {
    typeUrl: '/cosmos.feegrant.v1beta1.MsgRevokeAllowance',
    value: { granter, grantee },
  };
}

/**
 * Query fee grants given to a grantee.
 * Delegates to chain/fee-grants.js RPC-first implementation.
 * @returns {Promise<Array>} Array of allowance objects
 */
export async function queryFeeGrants(lcdUrl, grantee) {
  return _rpcQueryFeeGrants(lcdUrl, grantee);
}

/**
 * Query a specific fee grant between granter and grantee.
 * Delegates to chain/fee-grants.js RPC-first implementation.
 * @returns {Promise<object|null>} Allowance object or null
 */
export async function queryFeeGrant(lcdUrl, granter, grantee) {
  return _rpcQueryFeeGrant(lcdUrl, granter, grantee);
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
  const gasEstimate = await client.simulate(signerAddress, msgs, memo);
  const gasLimit = Math.ceil(gasEstimate * 1.3);
  const fee = {
    amount: [{ denom: 'udvpn', amount: String(Math.ceil(gasLimit * 0.2)) }],
    gas: String(gasLimit),
    granter: granterAddress,
  };
  return client.signAndBroadcast(signerAddress, msgs, fee, memo);
}

// ─── Authz (cosmos.authz.v1beta1) ──────────────────────────────────────────
// Authorization grants: granter allows grantee to execute specific messages.
//
// Usage (server-side subscription management):
//   // User grants server permission to start sessions on their behalf
//   const msg = buildAuthzGrantMsg(userAddr, serverAddr, MSG_TYPES.PLAN_START_SESSION);
//   await broadcast(client, userAddr, [msg]);
//   // Server can now start sessions for the user
//   const innerMsg = { typeUrl: MSG_TYPES.PLAN_START_SESSION, value: { from: userAddr, ... } };
//   const execMsg = buildAuthzExecMsg(serverAddr, encodeForExec([innerMsg]));
//   await broadcast(serverClient, serverAddr, [execMsg]);

/**
 * Build a MsgGrant (authz) for a specific message type.
 * @param {string} granter - Address granting permission (sent1...)
 * @param {string} grantee - Address receiving permission (sent1...)
 * @param {string} msgTypeUrl - Message type URL to authorize (e.g. MSG_TYPES.START_SESSION)
 * @param {Date|string} expiration - Optional expiry date (default: no expiry)
 */
export function buildAuthzGrantMsg(granter, grantee, msgTypeUrl, expiration) {
  const authBytes = encodeGenericAuthorization(msgTypeUrl);

  return {
    typeUrl: '/cosmos.authz.v1beta1.MsgGrant',
    value: {
      granter,
      grantee,
      grant: {
        authorization: {
          typeUrl: '/cosmos.authz.v1beta1.GenericAuthorization',
          value: Uint8Array.from(authBytes),
        },
        expiration: expiration
          ? { seconds: BigInt(Math.floor((expiration instanceof Date ? expiration : new Date(expiration)).getTime() / 1000)), nanos: 0 }
          : undefined,
      },
    },
  };
}

/**
 * Build a MsgRevoke (authz) to remove a specific grant.
 */
export function buildAuthzRevokeMsg(granter, grantee, msgTypeUrl) {
  return {
    typeUrl: '/cosmos.authz.v1beta1.MsgRevoke',
    value: { granter, grantee, msgTypeUrl },
  };
}

/**
 * Build a MsgExec (authz) to execute messages on behalf of a granter.
 * @param {string} grantee - Address executing on behalf of granter
 * @param {Array} encodedMsgs - Pre-encoded messages (use encodeForExec() to prepare)
 */
export function buildAuthzExecMsg(grantee, encodedMsgs) {
  return {
    typeUrl: '/cosmos.authz.v1beta1.MsgExec',
    value: { grantee, msgs: encodedMsgs },
  };
}

/**
 * Encode SDK message objects to the Any format required by MsgExec.
 * @param {Array<{typeUrl: string, value: object}>} msgs - Standard SDK messages
 * @returns {Array<{typeUrl: string, value: Uint8Array}>} Encoded messages for MsgExec
 */
export function encodeForExec(msgs) {
  const reg = buildRegistry();
  return msgs.map(msg => {
    const type = reg.lookupType(msg.typeUrl);
    if (!type) throw new Error(`Unknown message type: ${msg.typeUrl}. Ensure it is registered in buildRegistry().`);
    return {
      typeUrl: msg.typeUrl,
      value: type.encode(type.fromPartial(msg.value)).finish(),
    };
  });
}

// queryAuthzGrants removed — use RPC-first version from chain/queries.js

// Re-export extractSessionId for convenience (from protocol module)
export { extractSessionId };
