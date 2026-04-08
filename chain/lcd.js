/**
 * Sentinel SDK — Chain / LCD Module
 *
 * LCD (REST) query helpers: single query, paginated query, auto-paginating query,
 * defensive pagination (handles Sentinel's broken pagination), endpoint health checks.
 *
 * Usage:
 *   import { lcd, lcdQuery, lcdQueryAll, lcdPaginatedSafe } from './chain/lcd.js';
 *   const data = await lcd('https://lcd.sentinel.co', '/sentinel/node/v3/nodes?status=1');
 */

import axios from 'axios';
import { publicEndpointAgent } from '../tls-trust.js';
import { LCD_ENDPOINTS, tryWithFallback } from '../defaults.js';
import { ChainError, ErrorCodes } from '../errors.js';

// Re-export for convenience (used by other chain modules)
export { LCD_ENDPOINTS };

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
  // Accept Endpoint objects ({ url, name }) or bare strings
  const base = typeof baseUrl === 'object' ? baseUrl.url : baseUrl;
  const url = `${base}${path}`;
  const res = await axios.get(url, { httpsAgent: publicEndpointAgent, timeout: 15000 });
  const data = res.data;
  if (data?.code && data.code !== 0) {
    throw new ChainError(ErrorCodes.LCD_ERROR, `LCD ${path}: code=${data.code} ${data.message || ''}`, { path, code: data.code, message: data.message });
  }
  return data;
}

// ─── LCD Query Helpers (v25b) ────────────────────────────────────────────────
// General-purpose LCD query with timeout, retry, error wrapping, and pagination.

/**
 * Single LCD query with timeout, single retry on network error, and ChainError wrapping.
 * Uses the fallback endpoint list if no lcdUrl is provided.
 *
 * @param {string} path - LCD path (e.g. '/sentinel/node/v3/nodes?status=1')
 * @param {object} [opts]
 * @param {string} [opts.lcdUrl] - Specific LCD endpoint (or uses fallback chain)
 * @param {number} [opts.timeout] - Request timeout in ms (default: 15000)
 * @returns {Promise<any>} Parsed JSON response
 */
export async function lcdQuery(path, opts = {}) {
  const timeout = opts.timeout || 15000;
  const doQuery = async (baseUrl) => {
    try {
      return await lcd(baseUrl, path);
    } catch (err) {
      // Single retry on network error
      if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.message?.includes('timeout')) {
        await new Promise(r => setTimeout(r, 1000));
        return await lcd(baseUrl, path);
      }
      throw err;
    }
  };

  if (opts.lcdUrl) {
    return doQuery(opts.lcdUrl);
  }
  const { result } = await tryWithFallback(LCD_ENDPOINTS, doQuery, `LCD ${path}`);
  return result;
}

/**
 * Auto-paginating LCD query. Fetches all pages via next_key, returns all results + chain total.
 *
 * @param {string} basePath - LCD path without pagination params (e.g. '/sentinel/node/v3/nodes?status=1')
 * @param {object} [opts]
 * @param {string} [opts.lcdUrl] - Specific LCD endpoint (or uses fallback chain)
 * @param {number} [opts.limit] - Page size (default: 200)
 * @param {number} [opts.timeout] - Per-page timeout (default: 15000)
 * @param {string} [opts.dataKey] - Key for the results array in response (default: auto-detect first array)
 * @returns {Promise<{ items: any[], total: number|null }>}
 */
export async function lcdQueryAll(basePath, opts = {}) {
  const limit = opts.limit || 200;
  const dataKey = opts.dataKey || null;

  const fetchAll = async (baseUrl) => {
    let allItems = [];
    let nextKey = null;
    let chainTotal = null;
    let isFirst = true;
    do {
      const sep = basePath.includes('?') ? '&' : '?';
      let url = `${basePath}${sep}pagination.limit=${limit}`;
      if (isFirst) url += '&pagination.count_total=true';
      if (nextKey) url += `&pagination.key=${encodeURIComponent(nextKey)}`;
      const data = await lcd(baseUrl, url);
      if (isFirst && data.pagination?.total) {
        chainTotal = parseInt(data.pagination.total, 10);
      }
      // Auto-detect data key: first array property that isn't 'pagination'
      const key = dataKey || Object.keys(data).find(k => k !== 'pagination' && Array.isArray(data[k]));
      const pageItems = key ? (data[key] || []) : [];
      allItems = allItems.concat(pageItems);
      nextKey = data.pagination?.next_key || null;
      isFirst = false;
    } while (nextKey);

    if (chainTotal && allItems.length !== chainTotal) {
      console.warn(`[lcdQueryAll] Pagination mismatch: got ${allItems.length}, chain reports ${chainTotal}`);
    }
    return { items: allItems, total: chainTotal };
  };

  if (opts.lcdUrl) {
    return fetchAll(opts.lcdUrl);
  }
  const { result } = await tryWithFallback(LCD_ENDPOINTS, fetchAll, `LCD paginated ${basePath}`);
  return result;
}

// ─── v26c: Defensive Pagination ──────────────────────────────────────────────

/**
 * Paginated LCD query that handles Sentinel's broken pagination.
 * Tries next_key first. If next_key is null but we got exactly `limit` results
 * (suggesting truncation), falls back to a single large request.
 *
 * @param {string} lcdUrl - LCD base URL
 * @param {string} path - Endpoint path (e.g. '/sentinel/node/v3/plans/36/nodes')
 * @param {string} itemsKey - Response array key ('nodes', 'subscriptions', 'sessions')
 * @param {object} [opts]
 * @param {number} [opts.limit=500] - Page size for paginated requests
 * @param {number} [opts.fallbackLimit=5000] - Single-request limit if pagination broken
 * @returns {Promise<{ items: any[], total: number }>}
 */
export async function lcdPaginatedSafe(lcdUrl, path, itemsKey, opts = {}) {
  const limit = opts.limit || 500;
  const fallbackLimit = opts.fallbackLimit || 5000;
  const baseLcd = lcdUrl || LCD_ENDPOINTS[0].url;
  const sep = path.includes('?') ? '&' : '?';

  const firstPage = await lcd(baseLcd, `${path}${sep}pagination.limit=${limit}`);
  const firstItems = firstPage[itemsKey] || [];
  const nextKey = firstPage.pagination?.next_key;

  // Fewer than limit = that's everything
  if (firstItems.length < limit) {
    return { items: firstItems, total: firstItems.length };
  }

  // next_key exists = pagination works, follow it
  if (nextKey) {
    let allItems = [...firstItems];
    let key = nextKey;
    while (key) {
      const page = await lcd(baseLcd, `${path}${sep}pagination.limit=${limit}&pagination.key=${encodeURIComponent(key)}`);
      allItems.push(...(page[itemsKey] || []));
      key = page.pagination?.next_key || null;
    }
    return { items: allItems, total: allItems.length };
  }

  // next_key null but hit limit = broken pagination. Single large request.
  const fullData = await lcd(baseLcd, `${path}${sep}pagination.limit=${fallbackLimit}`);
  const allItems = fullData[itemsKey] || [];
  return { items: allItems, total: allItems.length };
}

// ─── Display & Formatting Helpers ───────────────────────────────────────────

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

/** Alias for formatDvpn — uses the current P2P token name. */
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
 * Get P2P price in USD from CoinGecko (cached for 5 minutes).
 */
let _dvpnPrice = null;
let _dvpnPriceAt = 0;
export async function getDvpnPrice() {
  if (_dvpnPrice && Date.now() - _dvpnPriceAt < 300_000) return _dvpnPrice;
  try {
    const res = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=sentinel&vs_currencies=usd', { timeout: 10000 });
    _dvpnPrice = res.data?.sentinel?.usd || null;
    _dvpnPriceAt = Date.now();
  } catch { /* keep old value */ }
  return _dvpnPrice;
}

// ─── v26c: Display Helpers ───────────────────────────────────────────────────

/**
 * Truncate an address for display. Works with sent1, sentprov1, sentnode1.
 * @param {string} addr
 * @param {number} [prefixLen=12]
 * @param {number} [suffixLen=6]
 * @returns {string}
 */
export function shortAddress(addr, prefixLen = 12, suffixLen = 6) {
  if (!addr || addr.length <= prefixLen + suffixLen + 3) return addr || '';
  return `${addr.slice(0, prefixLen)}...${addr.slice(-suffixLen)}`;
}

/**
 * Format subscription expiry as relative time.
 * @param {object} subscription - LCD subscription object (or any object with inactive_at)
 * @returns {string} e.g. "23d left", "4h left", "expired"
 */
export function formatSubscriptionExpiry(subscription) {
  const iso = subscription?.inactive_at || subscription?.status_at;
  if (!iso) return 'unknown';
  const diff = new Date(iso).getTime() - Date.now();
  if (diff < 0) return 'expired';
  const days = Math.floor(diff / 86400000);
  if (days > 1) return `${days}d left`;
  const hrs = Math.floor(diff / 3600000);
  if (hrs > 0) return `${hrs}h left`;
  const mins = Math.floor(diff / 60000);
  if (mins > 0) return `${mins}m left`;
  return '<1m left';
}

/**
 * Format byte count for display.
 * @param {number} bytes
 * @returns {string} e.g. '1.5 GB', '340 MB', '1.2 KB'
 */
export function formatBytes(bytes) {
  if (bytes == null || isNaN(bytes)) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(2) + ' GB';
}

/**
 * Parse chain duration string (has "s" suffix).
 * @param {string} durationStr - e.g. '557817.727815887s'
 * @returns {{ seconds: number, hours: number, minutes: number, formatted: string }}
 */
export function parseChainDuration(durationStr) {
  const seconds = parseFloat(String(durationStr).replace(/s$/i, '')) || 0;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const formatted = hours > 0 ? `${hours}h ${minutes}m` : minutes > 0 ? `${minutes}m ${secs}s` : `${secs}s`;
  return { seconds, hours, minutes, formatted };
}
