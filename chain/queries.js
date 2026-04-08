/**
 * Sentinel SDK — Chain / Queries Module
 *
 * All LCD-based query functions: balance, nodes, sessions, subscriptions,
 * plans, pricing, discovery, and display/serialization helpers.
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

// Re-export for convenience
export { extractSessionId };

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
 *
 * Note: Sessions have a nested base_session object containing the actual data.
 */
export async function findExistingSession(lcdUrl, walletAddr, nodeAddr) {
  const { items } = await lcdPaginatedSafe(lcdUrl, `/sentinel/session/v3/sessions?address=${walletAddr}&status=1`, 'sessions');
  for (const s of items) {
    const bs = s.base_session || s;
    if ((bs.node_address || bs.node) !== nodeAddr) continue;
    if (bs.status && bs.status !== 'active') continue;
    const acct = bs.acc_address || bs.address;
    if (acct && acct !== walletAddr) continue;
    const maxBytes = parseInt(bs.max_bytes || '0');
    const used = parseInt(bs.download_bytes || '0') + parseInt(bs.upload_bytes || '0');
    if (maxBytes === 0 || used < maxBytes) return BigInt(bs.id);
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
 * Fetch all active nodes from LCD with pagination.
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

  const { items } = await lcdPaginatedSafe(lcdUrl, '/sentinel/node/v3/nodes?status=1', 'nodes', { limit });
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
 * @param {string} lcdUrl
 * @param {string} walletAddr - sent1... address
 * @returns {Promise<{ subscriptions: any[], total: number|null }>}
 */
export async function querySubscriptions(lcdUrl, walletAddr, opts = {}) {
  // v26: Correct LCD endpoint for wallet subscriptions
  let path = `/sentinel/subscription/v3/accounts/${walletAddr}/subscriptions`;
  if (opts.status) path += `?status=${opts.status === 'active' ? '1' : '2'}`;
  return lcdQueryAll(path, { lcdUrl, dataKey: 'subscriptions' });
}

/**
 * Query a single session directly by ID — O(1) instead of scanning all wallet sessions.
 * Returns the flattened session object or null if not found.
 * Use this when you know the session ID (e.g., from batch TX events).
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
  try {
    const data = await lcd(lcdUrl, `/sentinel/session/v3/sessions/${sessionId}`);
    const raw = data?.session;
    if (!raw) return null;
    return flattenSession(raw);
  } catch { return null; }
}

/**
 * Query session allocation (remaining bandwidth).
 * @param {string} lcdUrl
 * @param {string|number|bigint} sessionId
 * @returns {Promise<{ maxBytes: number, usedBytes: number, remainingBytes: number, percentUsed: number }|null>}
 */
export async function querySessionAllocation(lcdUrl, sessionId) {
  try {
    const data = await lcd(lcdUrl, `/sentinel/session/v3/sessions/${sessionId}`);
    const s = data.session?.base_session || data.session || {};
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
  } catch { return null; }
}

/**
 * Fetch a single node by address from LCD (no need to fetch all 1000+ nodes).
 * Tries the direct v3 endpoint first, falls back to paginated search.
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
    if (!found) throw new NodeError(ErrorCodes.NODE_NOT_FOUND, `Node ${nodeAddress} not found on LCD (may be inactive)`, { nodeAddress });
    found.remote_url = resolveNodeUrl(found);
    return found;
  };

  if (opts.lcdUrl) return fetchDirect(opts.lcdUrl);
  const { result } = await tryWithFallback(LCD_ENDPOINTS, fetchDirect, `LCD node lookup ${nodeAddress}`);
  return result;
}

/**
 * List all sessions for a wallet address.
 * @param {string} address - sent1... wallet address
 * @param {string} [lcdUrl]
 * @param {object} [opts]
 * @param {string} [opts.status] - '1' (active) or '2' (inactive)
 * @returns {Promise<{ items: ChainSession[], total: number }>}
 */
export async function querySessions(address, lcdUrl, opts = {}) {
  let path = `/sentinel/session/v3/sessions?address=${address}`;
  if (opts.status) path += `&status=${opts.status}`;
  const result = await lcdPaginatedSafe(lcdUrl, path, 'sessions');
  // Auto-flatten base_session nesting so devs don't hit session.id === undefined
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
 * @param {string|number} id - Subscription ID
 * @param {string} [lcdUrl]
 * @returns {Promise<Subscription|null>}
 */
export async function querySubscription(id, lcdUrl) {
  try {
    const data = await lcdQuery(`/sentinel/subscription/v3/subscriptions/${id}`, { lcdUrl });
    return data.subscription || null;
  } catch { return null; }
}

/**
 * Check if wallet has an active subscription for a specific plan.
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

// ─── Plan Subscriber Helpers (v25b) ──────────────────────────────────────────

/**
 * Query all subscriptions for a plan. Supports owner filtering.
 *
 * @param {number|string} planId - Plan ID
 * @param {object} [opts]
 * @param {string} [opts.lcdUrl] - LCD endpoint
 * @param {string} [opts.excludeAddress] - Filter out this address (typically the plan owner)
 * @returns {Promise<{ subscribers: Array<{ address: string, status: number, id: string }>, total: number|null }>}
 */
export async function queryPlanSubscribers(planId, opts = {}) {
  const { items, total } = await lcdQueryAll(
    `/sentinel/subscription/v3/plans/${planId}/subscriptions`,
    { lcdUrl: opts.lcdUrl, dataKey: 'subscriptions' },
  );
  let subscribers = items.map(s => ({
    address: s.address || s.subscriber,
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
 * Query all nodes linked to a plan.
 * @param {number|string} planId
 * @param {string} [lcdUrl]
 * @returns {Promise<{ items: any[], total: number|null }>}
 */
export async function queryPlanNodes(planId, lcdUrl) {
  // LCD pagination is BROKEN on this endpoint — count_total returns min(actual, limit)
  // and next_key is always null. Single high-limit request gets all nodes.
  const doQuery = async (baseUrl) => {
    const data = await lcd(baseUrl, `/sentinel/node/v3/plans/${planId}/nodes?pagination.limit=5000`);
    return { items: data.nodes || [], total: (data.nodes || []).length };
  };
  if (lcdUrl) return doQuery(lcdUrl);
  const { result } = await tryWithFallback(LCD_ENDPOINTS, doQuery, `LCD plan ${planId} nodes`);
  return result;
}

/**
 * Discover all available plans with metadata (subscriber count, node count, price).
 * Probes plan IDs 1-maxId, returns plans with >=1 subscriber.
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

  for (let batch = 0; batch < Math.ceil(maxId / batchSize); batch++) {
    const probes = [];
    for (let i = batch * batchSize + 1; i <= Math.min((batch + 1) * batchSize, maxId); i++) {
      probes.push((async (id) => {
        try {
          const subData = await lcd(baseLcd, `/sentinel/subscription/v3/plans/${id}/subscriptions?pagination.limit=1&pagination.count_total=true`);
          const subCount = parseInt(subData.pagination?.total || '0', 10);
          if (subCount === 0 && !includeEmpty) return null;
          // Plan nodes endpoint has broken pagination (count_total wrong, next_key null).
          // Use limit=5000 single request and count the actual array.
          const nodeData = await lcd(baseLcd, `/sentinel/node/v3/plans/${id}/nodes?pagination.limit=5000`);
          const nodeCount = (nodeData.nodes || []).length;
          const price = subData.subscriptions?.[0]?.price || null;
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
 * @param {string} provAddress - sentprov1... address
 * @param {object} [opts]
 * @param {string} [opts.lcdUrl]
 * @returns {Promise<object|null>}
 */
export async function getProviderByAddress(provAddress, opts = {}) {
  try {
    const data = await lcdQuery(`/sentinel/provider/v2/providers/${provAddress}`, opts);
    return data.provider || null;
  } catch { return null; }
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
