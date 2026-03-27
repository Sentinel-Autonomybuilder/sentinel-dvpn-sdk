/**
 * Sentinel SDK — Pricing, Display & Filtering Module
 *
 * Extracted from cosmjs-setup.js during domain-module refactor.
 * Provides node price lookups, network overview, display formatting,
 * node filtering, and BigInt-safe serialization.
 *
 * Usage:
 *   import { getNodePrices, formatDvpn, filterNodes } from './pricing/index.js';
 *   const prices = await getNodePrices('sentnode1abc...');
 *   console.log(formatDvpn(prices.gigabyte.udvpn)); // "0.04 P2P"
 */

import { lcd } from '../chain/index.js';
import { fetchActiveNodes } from '../chain/index.js';
import { LCD_ENDPOINTS, tryWithFallback } from '../config/index.js';
import { ValidationError, NodeError, ErrorCodes } from '../errors/index.js';

// ─── Node Price Lookup ──────────────────────────────────────────────────────

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

  const fetchNode = async (baseUrl) => {
    let nextKey = null;
    let pages = 0;
    do {
      const keyParam = nextKey ? `&pagination.key=${encodeURIComponent(nextKey)}` : '';
      const data = await lcd(baseUrl, `/sentinel/node/v3/nodes?status=1&pagination.limit=500${keyParam}`);
      const nodes = data.nodes || [];
      const found = nodes.find(n => n.address === nodeAddress);
      if (found) return found;
      nextKey = data.pagination?.next_key || null;
      pages++;
    } while (nextKey && pages < 20);
    return null;
  };

  let node;
  if (lcdUrl) {
    node = await fetchNode(lcdUrl);
  } else {
    const result = await tryWithFallback(LCD_ENDPOINTS, fetchNode, 'getNodePrices');
    node = result.result;
  }

  if (!node) throw new NodeError(ErrorCodes.NODE_NOT_FOUND, `Node ${nodeAddress} not found on LCD (may be inactive or deregistered)`, { nodeAddress });

  function extractPrice(priceArray) {
    if (!Array.isArray(priceArray)) return { dvpn: 0, udvpn: 0, raw: null };
    const entry = priceArray.find(p => p.denom === 'udvpn');
    if (!entry) return { dvpn: 0, udvpn: 0, raw: null };
    // Defensive fallback chain: quote_value (V3 current) -> base_value -> amount (legacy)
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

// ─── Network Overview ───────────────────────────────────────────────────────

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
  const fetchFn = async (url) => fetchActiveNodes(url);
  let nodes;
  if (lcdUrl) {
    nodes = await fetchFn(lcdUrl);
  } else {
    const result = await tryWithFallback(LCD_ENDPOINTS, fetchFn, 'getNetworkOverview');
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

// ─── Display Formatting ─────────────────────────────────────────────────────

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

// ─── Node Filtering ─────────────────────────────────────────────────────────

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

// ─── Serialization ──────────────────────────────────────────────────────────

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

// ─── PriceResolver Class ────────────────────────────────────────────────────

/**
 * Static class providing a unified API for all pricing operations.
 * Convenience wrapper around the standalone functions above.
 *
 * @example
 *   const prices = await PriceResolver.getNodePrices('sentnode1abc...');
 *   const overview = await PriceResolver.getNetworkOverview();
 *   const display = PriceResolver.format(prices.gigabyte.udvpn);
 *   const filtered = PriceResolver.filter(overview.nodes, { country: 'Germany' });
 *   const safe = PriceResolver.serialize(connectResult);
 */
export class PriceResolver {
  static async getNodePrices(nodeAddress, lcdUrl) { return getNodePrices(nodeAddress, lcdUrl); }
  static async getNetworkOverview(lcdUrl) { return getNetworkOverview(lcdUrl); }
  static format(udvpn, decimals) { return formatDvpn(udvpn, decimals); }
  static filter(nodes, criteria) { return filterNodes(nodes, criteria); }
  static serialize(result) { return serializeResult(result); }
}
