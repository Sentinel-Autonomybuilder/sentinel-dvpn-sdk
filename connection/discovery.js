/**
 * Node Discovery — query, fetch, enrich, index, and score nodes.
 *
 * Handles LCD queries for online nodes, caching, quality scoring,
 * and geographic indexing.
 */

import {
  fetchActiveNodes, filterNodes, resolveNodeUrl,
} from '../cosmjs-setup.js';
import { nodeStatusV3 } from '../v3protocol.js';
import {
  BROKEN_NODES, tryWithFallback, LCD_ENDPOINTS, LAST_VERIFIED,
} from '../defaults.js';

// ─── Node List Cache ─────────────────────────────────────────────────────────
// v21: Cache queryOnlineNodes results for 5 minutes. Returns cached results
// immediately on repeat calls and refreshes in background if stale.
// v25: Deduplicated concurrent refreshes + flushNodeCache() export.

const NODE_CACHE_TTL = 5 * 60_000; // 5 minutes
let _nodeCache = null; // { nodes, timestamp, key }
let _inflightRefresh = null; // Promise — prevents duplicate concurrent refreshes

/** Clear the node list cache. Next queryOnlineNodes() call will fetch fresh data. */
export function flushNodeCache() {
  _nodeCache = null;
  _inflightRefresh = null;
}

// ─── Node Quality Scoring ───────────────────────────────────────────────────

/**
 * Score a node's expected connection quality (0-100).
 * Based on real success rates from 400+ node tests.
 * Higher = more likely to produce a working tunnel.
 */
export function scoreNode(status) {
  let score = 50; // baseline

  // WireGuard is simpler and more reliable than V2Ray
  if (status.type === 'wireguard') score += 20;

  // Clock drift penalty — VMess fails at >120s, VLess is immune.
  // We can't know VMess vs VLess until handshake, but high drift is still risky.
  if (status.clockDriftSec !== null) {
    const drift = Math.abs(status.clockDriftSec);
    if (drift > 120) score -= 40; // VMess will fail entirely (VLess OK but rare)
    else if (drift > 60) score -= 15;
    else if (drift > 30) score -= 5;
  }

  // Peer count — fewer peers = less congestion
  if (status.peers !== undefined) {
    if (status.peers === 0) score += 10; // empty node = fast
    else if (status.peers < 5) score += 5;
    else if (status.peers > 20) score -= 10;
  }

  return Math.max(0, Math.min(100, score));
}

// ─── Query Nodes ─────────────────────────────────────────────────────────────

/**
 * Fetch active nodes from LCD and check which are actually online.
 * Returns array sorted by quality score (best first).
 *
 * Built-in quality scoring (from 400+ node tests):
 * - WireGuard nodes scored higher than V2Ray (simpler tunnel, fewer failure modes)
 * - V2Ray with grpc/tls deprioritized (0% success rate in testing)
 * - High clock drift nodes penalized (VMess fails silently at >120s)
 * - Nodes with fewer peers scored higher (less congestion)
 *
 * @param {object} options
 * @param {string} options.lcdUrl - LCD endpoint (default: https://lcd.sentinel.co)
 * @param {string} options.serviceType - Filter: 'wireguard' | 'v2ray' | null (both)
 * @param {number} options.maxNodes - Max nodes to check online status (default: 100)
 * @param {number} options.concurrency - Parallel online checks (default: 20)
 * @param {boolean} options.sort - Sort by quality score, best first (default: true). Set false for random order.
 */
export async function queryOnlineNodes(options = {}) {
  // v25: waitForFresh skips cache entirely
  if (options.waitForFresh) {
    const nodes = await _queryOnlineNodesImpl(options);
    _nodeCache = { nodes, timestamp: Date.now(), key: `${options.lcdUrl || 'default'}_${options.serviceType || 'all'}_${options.maxNodes || 100}` };
    return nodes;
  }

  // v21: Node cache — return cached results if fresh, background-refresh if stale
  const cacheKey = `${options.lcdUrl || 'default'}_${options.serviceType || 'all'}_${options.maxNodes || 100}`;
  if (!options.noCache && _nodeCache && _nodeCache.key === cacheKey && Date.now() - _nodeCache.timestamp < NODE_CACHE_TTL) {
    // Cache hit — fire deduplicated background refresh but return instantly
    if (!_inflightRefresh) {
      _inflightRefresh = _queryOnlineNodesImpl(options).then(nodes => {
        _nodeCache = { nodes, timestamp: Date.now(), key: cacheKey };
      }).catch(e => {
        if (typeof console !== 'undefined') console.warn('[sentinel-sdk] Node cache refresh failed:', e.message);
      }).finally(() => { _inflightRefresh = null; });
    }
    return _nodeCache.nodes;
  }

  // No cache — deduplicate concurrent cold fetches
  if (!_inflightRefresh) {
    _inflightRefresh = _queryOnlineNodesImpl(options).then(nodes => {
      _nodeCache = { nodes, timestamp: Date.now(), key: cacheKey };
      return nodes;
    }).finally(() => { _inflightRefresh = null; });
  }
  const nodes = await _inflightRefresh;
  return nodes || _nodeCache?.nodes || [];
}

async function _queryOnlineNodesImpl(options = {}) {
  const maxNodes = options.maxNodes || 5000; // v25b: raised from 100 — chain has 1000+ nodes
  const concurrency = options.concurrency || 20;
  const shouldSort = options.sort !== false; // default true
  const logFn = options.log || null;
  const brokenAddrs = new Set(BROKEN_NODES.map(n => n.address));

  // 1. Fetch ALL active nodes from LCD — uses lcdPaginatedSafe (handles broken pagination)
  let nodes = [];
  if (options.lcdUrl) {
    nodes = await fetchActiveNodes(options.lcdUrl);
  } else {
    const { result } = await tryWithFallback(LCD_ENDPOINTS, fetchActiveNodes, 'LCD node list');
    nodes = result;
  }

  // Resolve remote_addrs → remote_url (LCD v3 returns "IP:PORT" array, not "https://..." string)
  nodes = nodes.map(n => {
    try { n.remote_url = resolveNodeUrl(n); } catch { n.remote_url = null; }
    return n;
  });

  // Filter: must accept udvpn, must have URL, skip known broken nodes (verified ${LAST_VERIFIED})
  nodes = nodes.filter(n =>
    n.remote_url &&
    !brokenAddrs.has(n.address) &&
    (n.gigabyte_prices || []).some(p => p.denom === 'udvpn')
  );

  // Warn if maxNodes truncates results
  if (maxNodes < nodes.length && logFn) {
    logFn(`[queryOnlineNodes] Warning: ${nodes.length} nodes on chain, returning ${maxNodes} (capped by maxNodes)`);
  }

  // Shuffle and limit
  // Fisher-Yates shuffle (unbiased)
  for (let i = nodes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [nodes[i], nodes[j]] = [nodes[j], nodes[i]];
  }
  nodes = nodes.slice(0, maxNodes);

  // 2. Check online status in parallel batches
  const online = [];
  let probed = 0;
  const onNodeProbed = options.onNodeProbed; // callback: ({ total, probed, online }) => void
  for (let i = 0; i < nodes.length; i += concurrency) {
    const batch = nodes.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(async (node) => {
        const status = await nodeStatusV3(node.remote_url);
        if (options.serviceType && status.type !== options.serviceType) return null;
        return {
          address: node.address,
          remoteUrl: node.remote_url,
          serviceType: status.type,
          moniker: status.moniker,
          country: status.location.country,
          city: status.location.city,
          peers: status.peers,
          clockDriftSec: status.clockDriftSec,
          gigabytePrices: node.gigabyte_prices,
          hourlyPrices: node.hourly_prices,
          qualityScore: scoreNode(status),
        };
      })
    );
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) online.push(r.value);
    }
    probed += batch.length;
    if (onNodeProbed) try { onNodeProbed({ total: nodes.length, probed, online: online.length }); } catch {}
  }

  // 3. Sort by quality score (best first) unless disabled
  if (shouldSort) {
    online.sort((a, b) => b.qualityScore - a.qualityScore);
  }

  return online;
}

// ─── Full Node Catalog (LCD only, no per-node status checks) ────────────────

/**
 * Fetch ALL active nodes from the LCD. No per-node HTTP checks — instant.
 *
 * Returns every node that accepts udvpn, with LCD data only:
 * address, remote_url, gigabyte_prices, hourly_prices.
 *
 * Use this for: building node lists/maps, country pickers, price comparisons.
 * Use queryOnlineNodes() when you need verified online status + quality scores.
 *
 * @param {object} [options]
 * @param {string} [options.lcdUrl] - LCD endpoint (uses fallback chain if omitted)
 * @returns {Promise<Array>} All active nodes (900+)
 */
export async function fetchAllNodes(options = {}) {
  let nodes;
  if (options.lcdUrl) {
    nodes = await fetchActiveNodes(options.lcdUrl);
  } else {
    const { result } = await tryWithFallback(
      LCD_ENDPOINTS,
      async (url) => fetchActiveNodes(url),
      'LCD full node list',
    );
    nodes = result;
  }

  // Filter: must accept udvpn, must have a resolvable URL
  return nodes.filter(n =>
    n.remote_url &&
    (n.gigabyte_prices || []).some(p => p.denom === 'udvpn')
  );
}

/**
 * Build a geographic index from a node list for instant country/city lookups.
 *
 * Requires enriched nodes (with country/city fields from nodeStatusV3).
 * For LCD-only nodes, call enrichNodes() first.
 *
 * @param {Array} nodes - Array of node objects with country/city fields
 * @returns {{ countries: Object, cities: Object, stats: Object }}
 *   - countries: { "Germany": [node, ...], "United States": [...] }
 *   - cities:    { "Berlin": [node, ...], "New York": [...] }
 *   - stats:     { totalNodes, totalCountries, totalCities, byCountry: [{country, count}] }
 */
export function buildNodeIndex(nodes) {
  const countries = {};
  const cities = {};

  for (const node of nodes) {
    const country = node.country || node.location?.country || 'Unknown';
    const city = node.city || node.location?.city || 'Unknown';

    if (!countries[country]) countries[country] = [];
    countries[country].push(node);

    const cityKey = city === 'Unknown' ? `${city} (${country})` : city;
    if (!cities[cityKey]) cities[cityKey] = [];
    cities[cityKey].push(node);
  }

  // Stats sorted by node count (most nodes first)
  const byCountry = Object.entries(countries)
    .map(([country, nodes]) => ({ country, count: nodes.length }))
    .sort((a, b) => b.count - a.count);

  return {
    countries,
    cities,
    stats: {
      totalNodes: nodes.length,
      totalCountries: Object.keys(countries).length,
      totalCities: Object.keys(cities).length,
      byCountry,
    },
  };
}

/**
 * Enrich LCD nodes with type/country/city by probing each node's status API.
 *
 * @param {Array} nodes - Raw LCD nodes from fetchAllNodes()
 * @param {object} [options]
 * @param {number} [options.concurrency=30] - Parallel probes
 * @param {function} [options.onProgress] - Callback: ({ total, done, enriched }) => void
 * @returns {Promise<Array>} Enriched nodes with serviceType, country, city, moniker, qualityScore
 */
export async function enrichNodes(nodes, options = {}) {
  const concurrency = options.concurrency || 30;
  const enriched = [];
  let done = 0;

  for (let i = 0; i < nodes.length; i += concurrency) {
    const batch = nodes.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(async (node) => {
        const status = await nodeStatusV3(node.remote_url);
        return {
          address: node.address,
          remoteUrl: node.remote_url,
          serviceType: status.type,
          moniker: status.moniker,
          country: status.location.country,
          city: status.location.city,
          peers: status.peers,
          clockDriftSec: status.clockDriftSec,
          gigabytePrices: node.gigabyte_prices,
          hourlyPrices: node.hourly_prices,
          qualityScore: scoreNode(status),
        };
      })
    );
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) enriched.push(r.value);
    }
    done += batch.length;
    if (options.onProgress) {
      try { options.onProgress({ total: nodes.length, done, enriched: enriched.length }); } catch {}
    }
  }

  return enriched;
}
