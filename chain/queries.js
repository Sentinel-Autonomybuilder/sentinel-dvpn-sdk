/**
 * Sentinel SDK — Chain / Queries Module
 *
 * RPC-first query functions with LCD fallback.
 * All queries try RPC (protobuf via CosmJS ABCI) first for speed (~912x faster),
 * then fall back to LCD (REST) if RPC fails.
 *
 * Usage:
 *   import { getBalance, fetchActiveNodes, queryNode } from './chain/queries.js';
 *   const nodes = await fetchActiveNodes(lcdUrl);
 */

import path from 'path';
import os from 'os';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { LCD_ENDPOINTS, tryWithFallback } from '../defaults.js';
import { ValidationError, NodeError, ChainError, ErrorCodes } from '../errors.js';
import { extractSessionId } from '../v3protocol.js';
import { lcd, lcdQuery, lcdQueryAll, lcdPaginatedSafe } from './lcd.js';
import {
  createRpcQueryClientWithFallback,
  rpcQueryNodes,
  rpcQueryNode,
  rpcQueryNodesForPlan,
  rpcQuerySession,
  rpcQuerySessionsForAccount,
  rpcQuerySubscription,
  rpcQuerySubscriptionsForAccount,
  rpcQuerySubscriptionsForPlan,
  rpcQuerySubscriptionAllocations as rpcQuerySubAllocations,
  rpcQueryPlan,
  rpcQueryBalance,
  rpcQueryProvider as _rpcQueryProvider,
  rpcQueryAuthzGrants as _rpcQueryAuthzGrants,
  rpcGetTxByHash,
} from './rpc.js';

// Re-export for convenience
export { extractSessionId };

// ─── RPC Client Helper ─────────────────────────────────────────────────────

let _rpcClient = null;
let _rpcClientPromise = null;

/**
 * Get or create a cached RPC query client. Returns null if all RPC endpoints fail
 * (caller should fall back to LCD).
 */
async function getRpcClient() {
  if (_rpcClient) return _rpcClient;
  if (_rpcClientPromise) return _rpcClientPromise;
  _rpcClientPromise = createRpcQueryClientWithFallback()
    .then(client => { _rpcClient = client; return client; })
    .catch(() => { _rpcClient = null; return null; })
    .finally(() => { _rpcClientPromise = null; });
  return _rpcClientPromise;
}

/**
 * Clear the cached RPC query client. Called during process cleanup
 * to ensure WebSocket connections are properly closed.
 */
export function resetQueryRpcCache() {
  _rpcClient = null;
  _rpcClientPromise = null;
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
 * Find an existing active session for a wallet+node pair.
 * Returns session ID (BigInt) or null. Use this to avoid double-paying.
 * RPC-first with LCD fallback.
 */
export async function findExistingSession(lcdUrl, walletAddr, nodeAddr) {
  let sessions;

  // RPC-first: returns decoded, flat session objects
  try {
    const rpc = await getRpcClient();
    if (rpc) {
      sessions = await rpcQuerySessionsForAccount(rpc, walletAddr, { limit: 500 });
    }
  } catch { /* RPC failed, fall through to LCD */ }

  if (!sessions) {
    // LCD fallback
    const { items } = await lcdPaginatedSafe(lcdUrl, `/sentinel/session/v3/sessions?address=${walletAddr}&status=1`, 'sessions');
    sessions = items.map(s => {
      const bs = s.base_session || s;
      return { ...bs, price: s.price, subscription_id: s.subscription_id };
    });
  }

  for (const s of sessions) {
    if ((s.node_address || s.node) !== nodeAddr) continue;
    // RPC returns status as number (1=active), LCD as string
    const st = s.status;
    if (st && st !== 1 && st !== 'active') continue;
    const acct = s.acc_address || s.address;
    if (acct && acct !== walletAddr) continue;
    const maxBytes = parseInt(s.max_bytes || '0');
    const used = parseInt(s.download_bytes || '0') + parseInt(s.upload_bytes || '0');
    if (maxBytes === 0 || used < maxBytes) return BigInt(s.id);
  }
  return null;
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
  if (!raw) throw new NodeError(ErrorCodes.NODE_NOT_FOUND, `Node ${node.address} has no remote_addrs`, { address: node.address });
  return raw.startsWith('http') ? raw : `https://${raw}`;
}

// ─── Node List Cache ────────────────────────────────────────────────────────
let _nodeListCache = null;
let _nodeListCacheAt = 0;
const NODE_CACHE_TTL = 5 * 60_000; // 5 minutes

/**
 * Invalidate the node list cache. Call after operations that change the node set.
 */
export function invalidateNodeCache() { _nodeListCache = null; }

/**
 * Fetch all active nodes via RPC (primary) with LCD fallback.
 * Returns array of node objects. Each node has:
 * - `remote_url`: the first usable HTTPS URL (for primary connection)
 * - `remoteAddrs`: ALL remote addresses (for fallback on connection failure)
 *
 * Results are cached for 5 minutes. Call invalidateNodeCache() to force refresh.
 */
export async function fetchActiveNodes(lcdUrl, limit = 500, maxPages = 20) {
  // Return cached copy if fresh
  if (_nodeListCache && (Date.now() - _nodeListCacheAt) < NODE_CACHE_TTL) {
    return _nodeListCache.map(n => ({ ...n, planIds: [...(n.planIds || [])] }));
  }

  let items;
  try {
    // RPC-first: ~912x faster than LCD for bulk node queries
    const rpc = await getRpcClient();
    if (rpc) {
      items = await rpcQueryNodes(rpc, { status: 1, limit });
    }
  } catch { /* RPC failed, fall through to LCD */ }

  if (!items) {
    // LCD fallback
    const result = await lcdPaginatedSafe(lcdUrl, '/sentinel/node/v3/nodes?status=1', 'nodes', { limit });
    items = result.items;
  }

  for (const n of items) {
    // Preserve ALL remote addresses for fallback
    const addrs = n.remote_addrs || [];
    n.remoteAddrs = addrs.map(a => a.startsWith('http') ? a : `https://${a}`);
    try { n.remote_url = resolveNodeUrl(n); } catch { /* skip nodes with no address */ }
  }

  // Cache with deep copy
  _nodeListCache = items;
  _nodeListCacheAt = Date.now();
  return items.map(n => ({ ...n, planIds: [...(n.planIds || [])] }));
}

/**
 * Get a quick network overview — total nodes, counts by country and service type, average prices.
 * Perfect for dashboard UIs, onboarding screens, and network health displays.
 *
 * @param {string} [lcdUrl] - LCD endpoint (default: cascading fallback)
 * @returns {Promise<{ totalNodes: number, byCountry: Array<{country: string, count: number}>, byType: {wireguard: number, v2ray: number, unknown: number}, averagePrice: {gigabyteDvpn: number, hourlyDvpn: number}, nodes: Array }>}
 *
 * @example
 *   const overview = await getNetworkOverview();
 *   console.log(`${overview.totalNodes} nodes across ${overview.byCountry.length} countries`);
 *   console.log(`Average: ${overview.averagePrice.gigabyteDvpn.toFixed(3)} P2P/GB`);
 */
export async function getNetworkOverview(lcdUrl) {
  let nodes;
  if (lcdUrl) {
    nodes = await fetchActiveNodes(lcdUrl);
  } else {
    const result = await tryWithFallback(LCD_ENDPOINTS, fetchActiveNodes, 'getNetworkOverview');
    nodes = result.result;
  }

  // Filter to nodes that accept udvpn
  const active = nodes.filter(n => n.remote_url && (n.gigabyte_prices || []).some(p => p.denom === 'udvpn'));

  // Count by country (from LCD metadata, limited — enrichNodes gives better data)
  const countryMap = {};
  for (const n of active) {
    const c = n.location?.country || n.country || 'Unknown';
    countryMap[c] = (countryMap[c] || 0) + 1;
  }
  const byCountry = Object.entries(countryMap)
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count);

  // Count by type (type not in LCD — estimate from service_type field if present)
  const byType = { wireguard: 0, v2ray: 0, unknown: 0 };
  for (const n of active) {
    const t = n.service_type || n.type;
    if (t === 'wireguard' || t === 1) byType.wireguard++;
    else if (t === 'v2ray' || t === 2) byType.v2ray++;
    else byType.unknown++;
  }

  // Average prices
  let gbTotal = 0, gbCount = 0, hrTotal = 0, hrCount = 0;
  for (const n of active) {
    const gb = (n.gigabyte_prices || []).find(p => p.denom === 'udvpn');
    if (gb?.quote_value) { gbTotal += parseInt(gb.quote_value, 10); gbCount++; }
    const hr = (n.hourly_prices || []).find(p => p.denom === 'udvpn');
    if (hr?.quote_value) { hrTotal += parseInt(hr.quote_value, 10); hrCount++; }
  }

  return {
    totalNodes: active.length,
    byCountry,
    byType,
    averagePrice: {
      gigabyteDvpn: gbCount > 0 ? (gbTotal / gbCount) / 1_000_000 : 0,
      hourlyDvpn: hrCount > 0 ? (hrTotal / hrCount) / 1_000_000 : 0,
    },
    nodes: active,
  };
}

/**
 * Discover plan IDs by probing subscription endpoints.
 * Workaround for /sentinel/plan/v3/plans returning 501 Not Implemented.
 * Returns sorted array of plan IDs that have at least 1 subscription.
 */
export async function discoverPlanIds(lcdUrl, maxId = 500) {
  // Delegates to discoverPlans and extracts just the IDs
  const plans = await discoverPlans(lcdUrl, { maxId });
  return plans.map(p => p.id);
}

/**
 * Get standardized prices for a node — abstracts V3 LCD price parsing entirely.
 *
 * Solves the common "NaN / GB" problem by defensively extracting quote_value,
 * base_value, or amount from the nested LCD response structure.
 *
 * @param {string} nodeAddress - sentnode1... address
 * @param {string} [lcdUrl] - LCD endpoint URL (default: cascading fallback across all endpoints)
 * @returns {Promise<{ gigabyte: { dvpn: number, udvpn: number, raw: object|null }, hourly: { dvpn: number, udvpn: number, raw: object|null }, denom: string, nodeAddress: string }>}
 *
 * @example
 *   const prices = await getNodePrices('sentnode1abc...');
 *   console.log(`${prices.gigabyte.dvpn} P2P/GB, ${prices.hourly.dvpn} P2P/hr`);
 *   // Use prices.gigabyte.raw for the full { denom, base_value, quote_value } object
 *   // needed by encodeMsgStartSession's max_price field.
 */
export async function getNodePrices(nodeAddress, lcdUrl) {
  if (typeof nodeAddress !== 'string' || !/^sentnode1[a-z0-9]{38}$/.test(nodeAddress)) {
    throw new ValidationError(ErrorCodes.INVALID_NODE_ADDRESS, 'nodeAddress must be a valid sentnode1... bech32 address (46 characters)', { value: nodeAddress });
  }

  // Reuse queryNode() instead of duplicating pagination
  const node = await queryNode(nodeAddress, { lcdUrl });

  function extractPrice(priceArray) {
    if (!Array.isArray(priceArray)) return { dvpn: 0, udvpn: 0, raw: null };
    const entry = priceArray.find(p => p.denom === 'udvpn');
    if (!entry) return { dvpn: 0, udvpn: 0, raw: null };
    // Defensive fallback chain: quote_value (V3 current) → base_value → amount (legacy)
    const rawVal = entry.quote_value || entry.base_value || entry.amount || '0';
    const udvpn = parseInt(rawVal, 10) || 0;
    return { dvpn: parseFloat((udvpn / 1_000_000).toFixed(6)), udvpn, raw: entry };
  }

  return {
    gigabyte: extractPrice(node.gigabyte_prices),
    hourly: extractPrice(node.hourly_prices),
    denom: 'P2P',
    nodeAddress,
  };
}

// ─── v26c: Session & Subscription Queries ────────────────────────────────────

/**
 * Query a wallet's active subscriptions.
 * RPC-first with LCD fallback.
 * @param {string} lcdUrl
 * @param {string} walletAddr - sent1... address
 * @returns {Promise<{ items: any[], total: number|null }>}
 */
export async function querySubscriptions(lcdUrl, walletAddr, opts = {}) {
  // RPC-first
  try {
    const rpc = await getRpcClient();
    if (rpc) {
      let subs = await rpcQuerySubscriptionsForAccount(rpc, walletAddr, { limit: 500 });
      if (opts.status) {
        const statusNum = opts.status === 'active' ? 1 : 2;
        subs = subs.filter(s => s.status === statusNum);
      }
      return { items: subs, total: subs.length };
    }
  } catch { /* fall through to LCD */ }

  // LCD fallback
  let lcdPath = `/sentinel/subscription/v3/accounts/${walletAddr}/subscriptions`;
  if (opts.status) lcdPath += `?status=${opts.status === 'active' ? '1' : '2'}`;
  return lcdQueryAll(lcdPath, { lcdUrl, dataKey: 'subscriptions' });
}

/**
 * Query a single session directly by ID — O(1) instead of scanning all wallet sessions.
 * Returns the flattened session object or null if not found.
 * RPC-first with LCD fallback.
 *
 * @param {string} lcdUrl - LCD endpoint URL
 * @param {string|number|bigint} sessionId - Session ID to query
 * @returns {Promise<object|null>} Flattened session object, or null if not found
 *
 * @example
 *   const session = await querySessionById('https://lcd.sentinel.co', 123456);
 *   if (session) console.log(`Session ${session.id} on node ${session.node_address}`);
 */
export async function querySessionById(lcdUrl, sessionId) {
  // RPC-first
  try {
    const rpc = await getRpcClient();
    if (rpc) {
      const session = await rpcQuerySession(rpc, sessionId);
      if (session) return session;
    }
  } catch { /* fall through to LCD */ }

  // LCD fallback (with endpoint failover via lcdQuery)
  try {
    const data = await lcdQuery(`/sentinel/session/v3/sessions/${sessionId}`, { lcdUrl });
    const raw = data?.session;
    if (!raw) return null;
    return flattenSession(raw);
  } catch { return null; }
}

/**
 * Query session allocation (remaining bandwidth).
 * RPC-first with LCD fallback.
 * @param {string} lcdUrl
 * @param {string|number|bigint} sessionId
 * @returns {Promise<{ maxBytes: number, usedBytes: number, remainingBytes: number, percentUsed: number }|null>}
 */
export async function querySessionAllocation(lcdUrl, sessionId) {
  let s = null;

  // RPC-first: query session by ID returns flat decoded object
  try {
    const rpc = await getRpcClient();
    if (rpc) {
      s = await rpcQuerySession(rpc, sessionId);
    }
  } catch { /* fall through */ }

  if (!s) {
    // LCD fallback (with endpoint failover via lcdQuery)
    try {
      const data = await lcdQuery(`/sentinel/session/v3/sessions/${sessionId}`, { lcdUrl });
      s = data.session?.base_session || data.session || null;
    } catch { return null; }
  }

  if (!s) return null;
  const maxBytes = parseInt(s.max_bytes || '0', 10);
  const dl = parseInt(s.download_bytes || '0', 10);
  const ul = parseInt(s.upload_bytes || '0', 10);
  const usedBytes = dl + ul;
  return {
    maxBytes,
    usedBytes,
    remainingBytes: Math.max(0, maxBytes - usedBytes),
    percentUsed: maxBytes > 0 ? Math.round((usedBytes / maxBytes) * 100) : 0,
  };
}

/**
 * Fetch a single node by address via RPC (primary) with LCD fallback.
 *
 * @param {string} nodeAddress - sentnode1... address
 * @param {object} [opts]
 * @param {string} [opts.lcdUrl] - LCD endpoint (or uses fallback chain)
 * @returns {Promise<object>} Node object with remote_url resolved
 */
export async function queryNode(nodeAddress, opts = {}) {
  if (typeof nodeAddress !== 'string' || !nodeAddress.startsWith('sentnode1')) {
    throw new ValidationError(ErrorCodes.INVALID_NODE_ADDRESS, 'nodeAddress must be sentnode1...', { nodeAddress });
  }

  // RPC-first: single node query is fast and avoids LCD rate limits
  try {
    const rpc = await getRpcClient();
    if (rpc) {
      const node = await rpcQueryNode(rpc, nodeAddress);
      if (node) {
        node.remote_url = resolveNodeUrl(node);
        const addrs = node.remote_addrs || [];
        node.remoteAddrs = addrs.map(a => a.startsWith('http') ? a : `https://${a}`);
        return node;
      }
    }
  } catch { /* RPC failed, fall through to LCD */ }

  // LCD fallback
  const fetchDirect = async (baseUrl) => {
    try {
      const data = await lcdQuery(`/sentinel/node/v3/nodes/${nodeAddress}`, { lcdUrl: baseUrl });
      if (data?.node) {
        data.node.remote_url = resolveNodeUrl(data.node);
        return data.node;
      }
    } catch { /* fall through to full list */ }
    const { items } = await lcdPaginatedSafe(baseUrl, '/sentinel/node/v3/nodes?status=1', 'nodes');
    const found = items.find(n => n.address === nodeAddress);
    if (!found) throw new NodeError(ErrorCodes.NODE_NOT_FOUND, `Node ${nodeAddress} not found (may be inactive)`, { nodeAddress });
    found.remote_url = resolveNodeUrl(found);
    return found;
  };

  if (opts.lcdUrl) return fetchDirect(opts.lcdUrl);
  const { result } = await tryWithFallback(LCD_ENDPOINTS, fetchDirect, `node lookup ${nodeAddress}`);
  return result;
}

/**
 * List all sessions for a wallet address.
 * RPC-first with LCD fallback.
 * @param {string} address - sent1... wallet address
 * @param {string} [lcdUrl]
 * @param {object} [opts]
 * @param {string} [opts.status] - '1' (active) or '2' (inactive)
 * @returns {Promise<{ items: ChainSession[], total: number }>}
 */
export async function querySessions(address, lcdUrl, opts = {}) {
  // RPC-first: returns already-flat decoded sessions
  try {
    const rpc = await getRpcClient();
    if (rpc) {
      const sessions = await rpcQuerySessionsForAccount(rpc, address, { limit: 500 });
      // Filter by status if requested (RPC returns all statuses)
      let items = sessions;
      if (opts.status) {
        const statusNum = parseInt(opts.status, 10);
        items = sessions.filter(s => s.status === statusNum);
      }
      return { items, total: items.length };
    }
  } catch { /* fall through to LCD */ }

  // LCD fallback
  let lcdPath = `/sentinel/session/v3/sessions?address=${address}`;
  if (opts.status) lcdPath += `&status=${opts.status}`;
  const result = await lcdPaginatedSafe(lcdUrl, lcdPath, 'sessions');
  result.items = result.items.map(flattenSession);
  return result;
}

/**
 * Flatten a chain session's base_session fields to top level.
 * Prevents the #1 footgun: `session.id === undefined` (data is nested under base_session).
 * Preserves `price` (node sessions) and `subscription_id` (plan sessions).
 *
 * @param {object} session - Raw LCD session object
 * @returns {object} Flattened session with all fields at top level
 */
export function flattenSession(session) {
  if (!session) return session;
  const bs = session.base_session || {};
  return {
    id: bs.id || session.id,
    acc_address: bs.acc_address || session.acc_address,
    node_address: bs.node_address || bs.node || session.node_address,
    download_bytes: bs.download_bytes || session.download_bytes || '0',
    upload_bytes: bs.upload_bytes || session.upload_bytes || '0',
    max_bytes: bs.max_bytes || session.max_bytes || '0',
    duration: bs.duration || session.duration,
    max_duration: bs.max_duration || session.max_duration,
    status: bs.status || session.status,
    start_at: bs.start_at || session.start_at,
    status_at: bs.status_at || session.status_at,
    inactive_at: bs.inactive_at || session.inactive_at,
    // Preserve type-specific fields
    price: session.price || undefined,
    subscription_id: session.subscription_id || undefined,
    '@type': session['@type'] || undefined,
    _raw: session, // original for advanced use
  };
}

/**
 * Get a single subscription by ID.
 * RPC-first with LCD fallback.
 * @param {string|number} id - Subscription ID
 * @param {string} [lcdUrl]
 * @returns {Promise<Subscription|null>}
 */
export async function querySubscription(id, lcdUrl) {
  // RPC-first
  try {
    const rpc = await getRpcClient();
    if (rpc) {
      const sub = await rpcQuerySubscription(rpc, id);
      if (sub) return sub;
    }
  } catch { /* fall through */ }

  // LCD fallback
  try {
    const data = await lcdQuery(`/sentinel/subscription/v3/subscriptions/${id}`, { lcdUrl });
    return data.subscription || null;
  } catch { return null; }
}

/**
 * Check if wallet has an active subscription for a specific plan.
 * Uses querySubscriptions which is already RPC-first.
 * @param {string} address - sent1... wallet address
 * @param {number|string} planId - Plan ID to check
 * @param {string} [lcdUrl]
 * @returns {Promise<{ has: boolean, subscription?: object }>}
 */
export async function hasActiveSubscription(address, planId, lcdUrl) {
  const { items } = await querySubscriptions(lcdUrl, address, { status: 'active' });
  const match = items.find(s => String(s.plan_id) === String(planId));
  if (match) return { has: true, subscription: match };
  return { has: false };
}

/**
 * Query allocations for a subscription (who has how many bytes).
 * RPC-first with LCD fallback. Uses v2 allocation path (v3 returns 501 on chain).
 *
 * @param {string|number|bigint} subscriptionId
 * @param {string} [lcdUrl]
 * @returns {Promise<Array<{ id: string, address: string, grantedBytes: string, utilisedBytes: string }>>}
 */
export async function querySubscriptionAllocations(subscriptionId, lcdUrl) {
  // RPC-first
  try {
    const rpc = await getRpcClient();
    if (rpc) {
      const allocs = await rpcQuerySubAllocations(rpc, subscriptionId, { limit: 100 });
      return allocs.map(a => ({
        id: a.id,
        address: a.address,
        grantedBytes: a.granted_bytes || '0',
        utilisedBytes: a.utilised_bytes || '0',
      }));
    }
  } catch { /* fall through */ }

  // LCD fallback
  try {
    const data = await lcdQuery(`/sentinel/subscription/v2/subscriptions/${subscriptionId}/allocations`, { lcdUrl });
    return (data.allocations || []).map(a => ({
      id: a.id,
      address: a.address,
      grantedBytes: a.granted_bytes || '0',
      utilisedBytes: a.utilised_bytes || '0',
    }));
  } catch { return []; }
}

// ─── Plan Subscriber Helpers (v25b) ──────────────────────────────────────────

/**
 * Query all subscriptions for a plan. Supports owner filtering.
 * RPC-first with LCD fallback.
 *
 * @param {number|string} planId - Plan ID
 * @param {object} [opts]
 * @param {string} [opts.lcdUrl] - LCD endpoint
 * @param {string} [opts.excludeAddress] - Filter out this address (typically the plan owner)
 * @returns {Promise<{ subscribers: Array<{ address: string, status: number, id: string }>, total: number|null }>}
 */
export async function queryPlanSubscribers(planId, opts = {}) {
  let items;
  let total;

  // RPC-first
  try {
    const rpc = await getRpcClient();
    if (rpc) {
      items = await rpcQuerySubscriptionsForPlan(rpc, planId, { limit: 500 });
      total = items.length;
    }
  } catch { /* fall through */ }

  if (!items) {
    // LCD fallback
    const result = await lcdQueryAll(
      `/sentinel/subscription/v3/plans/${planId}/subscriptions`,
      { lcdUrl: opts.lcdUrl, dataKey: 'subscriptions' },
    );
    items = result.items;
    total = result.total;
  }

  let subscribers = items.map(s => ({
    address: s.address || s.acc_address || s.subscriber,
    status: s.status,
    id: s.id || s.base_id,
    ...s,
  }));
  if (opts.excludeAddress) {
    subscribers = subscribers.filter(s => s.address !== opts.excludeAddress);
  }
  return { subscribers, total };
}

/**
 * Get plan stats with self-subscription filtered out.
 *
 * @param {number|string} planId
 * @param {string} ownerAddress - Plan owner's sent1... address (filtered from counts)
 * @param {object} [opts]
 * @param {string} [opts.lcdUrl]
 * @returns {Promise<{ subscriberCount: number, totalOnChain: number, ownerSubscribed: boolean }>}
 */
export async function getPlanStats(planId, ownerAddress, opts = {}) {
  const { subscribers, total } = await queryPlanSubscribers(planId, { lcdUrl: opts.lcdUrl });
  const ownerSubscribed = subscribers.some(s => s.address === ownerAddress);
  const filtered = subscribers.filter(s => s.address !== ownerAddress);
  return {
    subscriberCount: filtered.length,
    totalOnChain: total,
    ownerSubscribed,
  };
}

// ─── v26: Field Experience Helpers ────────────────────────────────────────────

/**
 * Query all nodes linked to a plan via RPC (primary) with LCD fallback.
 * @param {number|string} planId
 * @param {string} [lcdUrl]
 * @returns {Promise<{ items: any[], total: number|null }>}
 */
export async function queryPlanNodes(planId, lcdUrl) {
  // RPC-first
  try {
    const rpc = await getRpcClient();
    if (rpc) {
      const nodes = await rpcQueryNodesForPlan(rpc, planId, { status: 1, limit: 5000 });
      return { items: nodes, total: nodes.length };
    }
  } catch { /* RPC failed, fall through to LCD */ }

  // LCD fallback — pagination is BROKEN on this endpoint, single high-limit request
  const doQuery = async (baseUrl) => {
    const data = await lcd(baseUrl, `/sentinel/node/v3/plans/${planId}/nodes?pagination.limit=5000`);
    return { items: data.nodes || [], total: (data.nodes || []).length };
  };
  if (lcdUrl) return doQuery(lcdUrl);
  const { result } = await tryWithFallback(LCD_ENDPOINTS, doQuery, `plan ${planId} nodes`);
  return result;
}

/**
 * Discover all available plans with metadata (subscriber count, node count, price).
 * RPC-first: probes plan IDs via rpcQueryPlan, falls back to LCD.
 *
 * @param {string} [lcdUrl]
 * @param {object} [opts]
 * @param {number} [opts.maxId=500] - Highest plan ID to probe
 * @param {number} [opts.batchSize=15] - Parallel probes per batch
 * @param {boolean} [opts.includeEmpty=false] - Include plans with 0 nodes
 * @returns {Promise<Array<{ id: number, subscribers: number, nodeCount: number, price: object|null, hasNodes: boolean }>>}
 */
export async function discoverPlans(lcdUrl, opts = {}) {
  const maxId = opts.maxId || 500;
  const batchSize = opts.batchSize || 15;
  const includeEmpty = opts.includeEmpty || false;
  const baseLcd = lcdUrl || LCD_ENDPOINTS[0].url;
  const plans = [];

  // Try to get RPC client for plan queries
  let rpc = null;
  try { rpc = await getRpcClient(); } catch { /* LCD only */ }

  for (let batch = 0; batch < Math.ceil(maxId / batchSize); batch++) {
    const probes = [];
    for (let i = batch * batchSize + 1; i <= Math.min((batch + 1) * batchSize, maxId); i++) {
      probes.push((async (id) => {
        try {
          // RPC-first: query plan existence via RPC
          let plan = null;
          if (rpc) {
            try { plan = await rpcQueryPlan(rpc, id); } catch { /* fall through */ }
          }

          // Get subscriber count — RPC for plan subs, LCD as fallback
          let subCount = 0;
          let price = null;
          if (rpc) {
            try {
              const subs = await rpcQuerySubscriptionsForPlan(rpc, id, { limit: 1 });
              subCount = subs.length; // Quick check — at least 1
              price = subs[0]?.price || null;
              // If RPC returned subs, plan exists even if rpcQueryPlan returned null
              if (subCount > 0 && !plan) plan = { id };
            } catch { /* fall through */ }
          }
          if (!plan && subCount === 0) {
            // LCD fallback for subscriber count
            try {
              const subData = await lcd(baseLcd, `/sentinel/subscription/v3/plans/${id}/subscriptions?pagination.limit=1&pagination.count_total=true`);
              subCount = parseInt(subData.pagination?.total || '0', 10);
              price = subData.subscriptions?.[0]?.price || null;
              if (subCount > 0) plan = { id };
            } catch { /* plan doesn't exist */ }
          }

          if (!plan && !includeEmpty) return null;
          if (subCount === 0 && !includeEmpty) return null;

          // Get node count — RPC-first
          let nodeCount = 0;
          if (rpc) {
            try {
              const nodes = await rpcQueryNodesForPlan(rpc, id, { status: 1, limit: 5000 });
              nodeCount = nodes.length;
            } catch { /* fall through to LCD */ }
          }
          if (nodeCount === 0) {
            try {
              const nodeData = await lcd(baseLcd, `/sentinel/node/v3/plans/${id}/nodes?pagination.limit=5000`);
              nodeCount = (nodeData.nodes || []).length;
            } catch { /* no nodes */ }
          }

          return { id, subscribers: subCount, nodeCount, price, hasNodes: nodeCount > 0 };
        } catch { return null; }
      })(i));
    }
    const results = await Promise.all(probes);
    for (const r of results) if (r) plans.push(r);
  }
  return plans.sort((a, b) => a.id - b.id);
}


/**
 * Get provider details by address.
 * RPC-first with LCD fallback. Provider is still v2 on chain.
 * @param {string} provAddress - sentprov1... address
 * @param {object} [opts]
 * @param {string} [opts.lcdUrl]
 * @returns {Promise<object|null>}
 */
export async function getProviderByAddress(provAddress, opts = {}) {
  // RPC-first
  try {
    const rpc = await getRpcClient();
    if (rpc) {
      const provider = await _rpcQueryProvider(rpc, provAddress);
      if (provider) return provider;
    }
  } catch { /* fall through to LCD */ }

  // LCD fallback
  try {
    const data = await lcdQuery(`/sentinel/provider/v2/providers/${provAddress}`, opts);
    return data.provider || null;
  } catch { return null; }
}

/**
 * Query authz grants between granter and grantee.
 * RPC-first with LCD fallback.
 * @param {string} lcdUrl - LCD endpoint
 * @param {string} granter - Granter address (sent1...)
 * @param {string} grantee - Grantee address (sent1...)
 * @returns {Promise<Array>}
 */
export async function queryAuthzGrants(lcdUrl, granter, grantee) {
  // RPC-first
  try {
    const rpc = await getRpcClient();
    if (rpc) {
      return await _rpcQueryAuthzGrants(rpc, granter, grantee);
    }
  } catch { /* fall through to LCD */ }

  // LCD fallback
  const { items } = await lcdPaginatedSafe(lcdUrl, `/cosmos/authz/v1beta1/grants?granter=${granter}&grantee=${grantee}`, 'grants');
  return items;
}

// ─── VPN Settings Persistence ────────────────────────────────────────────────
// v27: Persistent user settings (backported from C# VpnSettings.cs).
// Stores preferences in ~/.sentinel-sdk/settings.json with restrictive permissions.

const SETTINGS_FILE = path.join(os.homedir(), '.sentinel-sdk', 'settings.json');

/**
 * Load persisted VPN settings from disk.
 * Returns empty object if file doesn't exist or is corrupt.
 * @returns {Record<string, any>}
 */
export function loadVpnSettings() {
  try {
    if (!existsSync(SETTINGS_FILE)) return {};
    return JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8'));
  } catch { return {}; }
}

/**
 * Save VPN settings to disk. Creates ~/.sentinel-sdk/ if needed.
 * @param {Record<string, any>} settings
 */
export function saveVpnSettings(settings) {
  const dir = path.dirname(SETTINGS_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), { mode: 0o600 });
}

// ─── TX Hash Lookup (RPC-first, LCD fallback) ───────────────────────────────

/**
 * Fetch a transaction by hash. RPC is tried first; if it fails or the TX is
 * not found, falls back to the LCD REST endpoint.
 *
 * Accepts bare hex or 0x-prefixed hex for the hash.
 * Returns the same normalised shape regardless of source:
 *   { hash, height, code, rawLog, events, gasUsed, gasWanted }
 *
 * Use this to re-fetch TX events after a crash/restart or from a different
 * process (CosmJS only returns DeliverTxResponse inline from signAndBroadcast).
 *
 * @param {string} txHash - Transaction hash (bare hex or 0x-prefixed)
 * @param {object} [opts]
 * @param {string} [opts.rpcUrl] - RPC endpoint (uses cached client if omitted)
 * @param {string} [opts.lcdUrl] - LCD endpoint for fallback
 * @returns {Promise<{ hash: string, height: number, code: number, rawLog: string, events: Array<{ type: string, attributes: Array<{ key: string, value: string }> }>, gasUsed: string, gasWanted: string } | null>}
 */
export async function getTxByHash(txHash, opts = {}) {
  const hex = txHash.replace(/^0x/i, '').toUpperCase();

  // ── RPC-first ──────────────────────────────────────────────────────────────
  try {
    let rpc;
    if (opts.rpcUrl) {
      const { createRpcQueryClient } = await import('./rpc.js');
      rpc = await createRpcQueryClient(opts.rpcUrl);
    } else {
      rpc = await getRpcClient();
    }
    if (rpc?.tmClient) {
      const result = await rpcGetTxByHash(rpc.tmClient, hex);
      return result;
    }
  } catch (rpcErr) {
    // "tx not found" from RPC → fall through to LCD
    const msg = rpcErr?.message || '';
    if (!msg.toLowerCase().includes('not found') && !msg.toLowerCase().includes('404')) {
      // Real connectivity error — still fall through, LCD may succeed
    }
  }

  // ── LCD fallback ───────────────────────────────────────────────────────────
  try {
    const doLcd = async (baseUrl) => {
      const data = await lcdQuery(`/cosmos/tx/v1beta1/txs/${hex}`, { lcdUrl: baseUrl });
      const txResp = data?.tx_response;
      if (!txResp) return null;
      const events = (txResp.events || []).map(ev => ({
        type: ev.type,
        attributes: (ev.attributes || []).map(attr => ({
          key: attr.key,
          value: attr.value,
        })),
      }));
      return {
        hash: (txResp.txhash || hex).toUpperCase(),
        height: parseInt(txResp.height || '0', 10),
        code: txResp.code || 0,
        rawLog: txResp.raw_log || '',
        events,
        gasUsed: String(txResp.gas_used || '0'),
        gasWanted: String(txResp.gas_wanted || '0'),
      };
    };
    if (opts.lcdUrl) return await doLcd(opts.lcdUrl);
    const { result } = await tryWithFallback(LCD_ENDPOINTS, doLcd, `getTxByHash ${hex}`);
    return result;
  } catch { return null; }
}
