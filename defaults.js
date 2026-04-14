/**
 * Sentinel dVPN SDK — Hardcoded Defaults & Recommended Values
 *
 * SINGLE SOURCE OF TRUTH for all values that may go stale.
 * When the RPC query server is built, this file gets replaced by live lookups.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │  LAST VERIFIED: 2026-03-08T00:00:00Z                               │
 * │  VERIFIED BY:   708-node scan + manual LCD/RPC checks              │
 * │  CHAIN:         sentinelhub-2 (sentinelhub v12.0.0, Cosmos 0.47.17)│
 * │                                                                      │
 * │  These values are HARDCODED for easy cold-start setup.              │
 * │  A future RPC query server will replace static defaults with live   │
 * │  endpoint health checks, node scoring, and price feeds.             │
 * └──────────────────────────────────────────────────────────────────────┘
 */

// ─── Axios adapter fix (MUST run before any HTTP requests) ──────────────────
// Node.js 18+ uses undici internally. Without this, ~40% of HTTP requests
// fail with opaque "fetch failed" errors (no stack trace, no errno).
import axios from 'axios';
axios.defaults.adapter = 'http';

// ─── SDK Version ─────────────────────────────────────────────────────────────
// This is the npm/semver version for consumers. Internal development iterations
// (v20, v21, v22, etc.) track feature milestones and are not exposed as exports.

export const SDK_VERSION = '2.3.0';

// ─── Timestamps ──────────────────────────────────────────────────────────────

/** When these defaults were last verified against the live chain */
export const LAST_VERIFIED = '2026-03-08T00:00:00Z';

/** Human-readable note for builders */
export const HARDCODED_NOTE = 'Static defaults — no RPC query server yet. Verify endpoints are live before production use. See README.md "Hardcoded Defaults" section.';

// ─── Chain ───────────────────────────────────────────────────────────────────

export const CHAIN_ID = 'sentinelhub-2';
export const DENOM = 'udvpn';
export const GAS_PRICE = '0.2udvpn';       // Chain minimum as of 2026-03-08
export const CHAIN_VERSION = 'v12.0.0';     // sentinelhub version
export const COSMOS_SDK_VERSION = '0.47.17';

// ─── RPC Endpoints (TX broadcast) ────────────────────────────────────────────
// Ordered by reliability. Primary is tried first, fallbacks on failure.
// Verified reachable 2026-03-08.

export const RPC_ENDPOINTS = [
  { url: 'https://rpc.sentinel.co:443',           name: 'Sentinel Official',  verified: '2026-03-08' },
  { url: 'https://sentinel-rpc.polkachu.com',     name: 'Polkachu',           verified: '2026-03-08' },
  { url: 'https://rpc.mathnodes.com',             name: 'MathNodes',          verified: '2026-03-08' },
  { url: 'https://sentinel-rpc.publicnode.com',   name: 'PublicNode',         verified: '2026-03-08' },
  { url: 'https://rpc.sentinel.quokkastake.io',   name: 'QuokkaStake',       verified: '2026-03-08' },
];

export const DEFAULT_RPC = RPC_ENDPOINTS[0].url;

// ─── LCD Endpoints (REST queries) ────────────────────────────────────────────
// Ordered by reliability. All have same limitations (v3 providers = 501, plan details = 501).
// Verified reachable 2026-03-08.

export const LCD_ENDPOINTS = [
  { url: 'https://lcd.sentinel.co',               name: 'Sentinel Official',  verified: '2026-03-08' },
  { url: 'https://sentinel-api.polkachu.com',     name: 'Polkachu',           verified: '2026-03-08' },
  { url: 'https://api.sentinel.quokkastake.io',   name: 'QuokkaStake',       verified: '2026-03-08' },
  { url: 'https://sentinel-rest.publicnode.com',   name: 'PublicNode',         verified: '2026-03-08' },
];

export const DEFAULT_LCD = LCD_ENDPOINTS[0].url;

// ─── V2Ray ───────────────────────────────────────────────────────────────────

export const V2RAY_VERSION = '5.2.1';
/** WARNING: v5.44.1 has observatory bugs. Do NOT upgrade past 5.2.1. Verified 2026-03-08. */
export const V2RAY_VERSION_WARNING = 'v5.2.1 exactly — v5.44.1+ has observatory/balancer bugs that break multi-outbound configs';

// ─── Transport Success Rates (from 780-node scan, 2026-03-09) ────────────────
// Used by buildV2RayClientConfig() to sort outbounds by reliability.
// Dynamic rates (in-memory) override these when available — see below.

export const TRANSPORT_SUCCESS_RATES = {
  'tcp':          { rate: 1.00, sample: 274, note: 'Best — always first choice' },
  'websocket':    { rate: 1.00, sample: 23,  note: 'Second choice' },
  'http':         { rate: 1.00, sample: 4,   note: '' },
  'gun':          { rate: 1.00, sample: 10,  note: 'gun(2) ≠ grpc(3) — different protocols' },
  'mkcp':         { rate: 1.00, sample: 5,   note: '' },
  'grpc/none':    { rate: 0.87, sample: 81,  note: '70/81 pass. serverName TLS fix applied.' },
  'quic':         { rate: 0.00, sample: 4,   note: '0/4 — chacha20 mismatch fixed, low node count' },
  'grpc/tls':     { rate: 0.00, sample: 0,   note: 'serverName TLS fix applied. No test nodes available.' },
};

// ─── Dynamic Transport Rate Tracking (persisted to disk) ─────────────────────
// Runtime success/failure tracking per transport type. Overrides hardcoded
// TRANSPORT_SUCCESS_RATES when enough samples exist. Persisted to
// ~/.sentinel-sdk/dynamic-rates.json with TTL eviction on load.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';

const DYNAMIC_RATES_DIR = path.join(os.homedir(), '.sentinel-sdk');
const DYNAMIC_RATES_FILE = path.join(DYNAMIC_RATES_DIR, 'dynamic-rates.json');
const DYNAMIC_RATES_TTL = 7 * 24 * 60 * 60_000; // 7 days

const _dynamicRates = new Map(); // transportKey -> { success, fail, updatedAt }

/** Load persisted dynamic rates from disk (evict stale entries). */
function _loadDynamicRates() {
  try {
    if (!existsSync(DYNAMIC_RATES_FILE)) return;
    const raw = JSON.parse(readFileSync(DYNAMIC_RATES_FILE, 'utf-8'));
    const now = Date.now();
    for (const [key, entry] of Object.entries(raw)) {
      if (entry.updatedAt && now - entry.updatedAt < DYNAMIC_RATES_TTL) {
        _dynamicRates.set(key, entry);
      }
    }
  } catch { /* corrupt file — start fresh */ }
}

/** Persist current dynamic rates to disk. */
function _saveDynamicRates() {
  try {
    if (!existsSync(DYNAMIC_RATES_DIR)) mkdirSync(DYNAMIC_RATES_DIR, { recursive: true, mode: 0o700 });
    const obj = {};
    for (const [key, entry] of _dynamicRates) obj[key] = entry;
    writeFileSync(DYNAMIC_RATES_FILE, JSON.stringify(obj, null, 2), { mode: 0o600 });
  } catch { /* disk write failed — rates stay in memory */ }
}

// Load on module init
_loadDynamicRates();

/** Record a transport connection result. Called automatically by setupV2Ray. */
export function recordTransportResult(transportKey, success) {
  const entry = _dynamicRates.get(transportKey) || { success: 0, fail: 0, updatedAt: 0 };
  if (success) entry.success++; else entry.fail++;
  entry.updatedAt = Date.now();
  _dynamicRates.set(transportKey, entry);
  _saveDynamicRates();
}

/**
 * Get the dynamic success rate for a transport. Returns null if < 2 samples.
 * Used by transportSortKey() in v3protocol.js to prioritize transports.
 */
export function getDynamicRate(transportKey) {
  const entry = _dynamicRates.get(transportKey);
  if (!entry) return null;
  const total = entry.success + entry.fail;
  if (total < 2) return null;
  return entry.success / total;
}

/** Get all dynamic rates as { transportKey: { rate, sample } }. */
export function getDynamicRates() {
  const result = {};
  for (const [key, entry] of _dynamicRates) {
    const total = entry.success + entry.fail;
    if (total > 0) result[key] = { rate: entry.success / total, sample: total };
  }
  return result;
}

/** Clear all dynamic rate data. Pass persist: true to also clear disk. */
export function resetDynamicRates(persist = false) {
  _dynamicRates.clear();
  if (persist) _saveDynamicRates();
}

// ─── Recommended Starter Nodes ───────────────────────────────────────────────
// High-reliability nodes from 708-node scan (2026-03-08).
// These had 100% connection success, low drift, WireGuard or proven V2Ray transports.
//
// ⚠ STALE WARNING: Nodes go offline. These are starting points, NOT guarantees.
// No hardcoded node list — nodes go offline unpredictably.
// Use queryOnlineNodes() for live, scored results:
//   const nodes = await queryOnlineNodes({ lcdUrl: DEFAULT_LCD, maxNodes: 50 });
//   // Returns nodes sorted by quality score (WG preferred, clock drift penalized)

// ─── Known Broken Nodes (blacklist) ──────────────────────────────────────────
// Nodes with confirmed bugs. Skip these to avoid wasting P2P.
// Verified 2026-03-08.

export const BROKEN_NODES = [
  { address: 'sentnode1qqktst6793vdxknvvkewfcmtv9edh7vvdvavrj', reason: 'nil UUID state — handshake always fails',         verified: '2026-03-08' },
  { address: 'sentnode1qx2p7kyep6m44ae47yh9zf3cfxrzrv5zt9vdnj', reason: 'handshake OK but proxy always fails (0 bytes)',   verified: '2026-03-08' },
];

// ─── Pricing Reference (from chain data, 2026-03-08) ─────────────────────────
// Typical values — actual prices vary per node. These are for estimation only.

export const PRICING_REFERENCE = {
  verified: '2026-03-08',
  note: 'Approximate values for cost estimation. Actual prices vary per node and change over time.',
  session: {
    typicalCostDvpn: 0.1,                  // ~0.04-0.15 P2P per 1GB session
    minBalanceDvpn: 1,                      // Minimum recommended wallet balance
    minBalanceUdvpn: 1_000_000,             // Same in micro-denom
  },
  gasPerMsg: {
    startSession: 200_000,                  // ~200k gas for MsgStartSession
    startSubscription: 250_000,             // ~250k gas for subscription + session
    createPlan: 300_000,                    // ~300k gas
    startLease: 250_000,                    // ~250k gas
    batchOf5: 800_000,                      // ~800k gas for 5 MsgStartSession batch
  },
  averageNodePrices: {
    gigabyteQuoteValue: '40152030',         // Average udvpn per GB (0.04 P2P)
    hourlyQuoteValue: '18384000',           // Average udvpn per hour (0.018 P2P)
    baseValue: '0.003000000000000000',      // Typical base_value (sdk.Dec)
  },
};

// ─── Shared Utilities ─────────────────────────────────────────────────────────

/** Promise-based delay. Used across node-connect, wireguard, speedtest. */
export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Convert bytes transferred over seconds to Mbps. */
export function bytesToMbps(bytes, seconds, decimals = null) {
  if (!seconds || seconds <= 0) return 0;
  const mbps = (bytes * 8) / seconds / 1_000_000;
  return decimals !== null ? parseFloat(mbps.toFixed(decimals)) : mbps;
}

// ─── DNS Presets ─────────────────────────────────────────────────────────────
// DNS servers for WireGuard tunnel. Handshake is default — decentralized,
// censorship-resistant DNS that resolves both Handshake TLDs and ICANN domains.
// Matches Sentinel Shield mobile app behavior.

export const DNS_PRESETS = Object.freeze({
  handshake: {
    name: 'Handshake',
    servers: ['103.196.38.38', '103.196.38.39'],
    description: 'Decentralized DNS — resolves Handshake + ICANN domains. Censorship-resistant.',
  },
  google: {
    name: 'Google',
    servers: ['8.8.8.8', '8.8.4.4'],
    description: 'Google Public DNS',
  },
  cloudflare: {
    name: 'Cloudflare',
    servers: ['1.1.1.1', '1.0.0.1'],
    description: 'Cloudflare Public DNS',
  },
});

export const DEFAULT_DNS_PRESET = 'handshake';

/** Fallback order: handshake → google → cloudflare. */
export const DNS_FALLBACK_ORDER = ['handshake', 'google', 'cloudflare'];

/**
 * Resolve a DNS option into a comma-separated string for WireGuard config.
 * Includes fallback DNS servers — if the primary DNS fails, the OS tries the next ones.
 *
 * @param {string|string[]|undefined} dns - Preset name ('handshake'|'google'|'cloudflare'),
 *   array of custom IP strings, or undefined for default (Handshake).
 * @returns {string} DNS string for WireGuard config with fallbacks
 *   (e.g. '103.196.38.38, 103.196.38.39, 8.8.8.8, 1.1.1.1')
 */
export function resolveDnsServers(dns) {
  const primary = _resolvePrimary(dns);
  const primarySet = new Set(primary);

  // Append one server from each fallback preset not already in the primary list
  const fallbacks = [];
  for (const name of DNS_FALLBACK_ORDER) {
    const preset = DNS_PRESETS[name];
    for (const server of preset.servers) {
      if (!primarySet.has(server)) {
        fallbacks.push(server);
        primarySet.add(server);
        break; // one per preset is enough for fallback
      }
    }
  }

  return [...primary, ...fallbacks].join(', ');
}

/** Resolve just the primary DNS servers (no fallbacks). */
function _resolvePrimary(dns) {
  if (!dns) return [...DNS_PRESETS[DEFAULT_DNS_PRESET].servers];
  if (typeof dns === 'string') {
    const preset = DNS_PRESETS[dns.toLowerCase()];
    if (preset) return [...preset.servers];
    return [dns];
  }
  if (Array.isArray(dns) && dns.length > 0) return [...dns];
  return [...DNS_PRESETS[DEFAULT_DNS_PRESET].servers];
}

// ─── Connection Timeouts (ms) ────────────────────────────────────────────────

/** Default timeout values used during node connection. Override via opts.timeouts. */
export const DEFAULT_TIMEOUTS = {
  handshake: 90000,    // Max time for WireGuard/V2Ray handshake with node (overloaded nodes need 60-90s)
  nodeStatus: 12000,   // Max time to fetch node status from remote URL
  lcdQuery: 15000,     // Max time for LCD chain queries
  v2rayReady: 10000,   // Max time waiting for V2Ray SOCKS proxy to be ready
};

// ─── Endpoint Health Check ────────────────────────────────────────────────────

/**
 * Ping endpoints and return them sorted by latency (fastest first).
 * Unreachable endpoints are moved to the end.
 * @param {Array<{url: string, name: string}>} endpoints
 * @param {number} timeoutMs - Per-endpoint timeout (default 5000ms)
 * @returns {Promise<Array<{url: string, name: string, latencyMs: number|null}>>}
 */
export async function checkEndpointHealth(endpoints, timeoutMs = 5000) {
  const results = await Promise.all(endpoints.map(async (ep) => {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      // LCD endpoints use /cosmos/base/tendermint/v1beta1/syncing for health check
      // (/status doesn't exist on LCD — that's an RPC endpoint path)
      await axios.get(`${ep.url}/cosmos/base/tendermint/v1beta1/syncing`, { signal: controller.signal, timeout: timeoutMs });
      clearTimeout(timer);
      return { ...ep, latencyMs: Date.now() - start };
    } catch {
      return { ...ep, latencyMs: null };
    }
  }));
  // Sort: reachable first (by latency), unreachable last
  return results.sort((a, b) => {
    if (a.latencyMs != null && b.latencyMs != null) return a.latencyMs - b.latencyMs;
    if (a.latencyMs != null) return -1;
    if (b.latencyMs != null) return 1;
    return 0;
  });
}

// ─── Helper: Try endpoints with fallback ─────────────────────────────────────

/**
 * Try an async operation against multiple endpoints, returning the first success.
 * Use this for RPC/LCD operations that should fall back to alternatives.
 *
 * @param {Array<{url: string, name: string}>} endpoints - Ordered list of endpoints
 * @param {function} operation - async (url) => result
 * @param {string} label - For error messages (e.g. 'LCD query', 'RPC connect')
 * @returns {Promise<{result: any, endpoint: string}>}
 */
export async function tryWithFallback(endpoints, operation, label = 'operation') {
  const errors = [];
  for (const ep of endpoints) {
    try {
      const result = await operation(ep.url);
      return { result, endpoint: ep.url, endpointName: ep.name };
    } catch (err) {
      errors.push({ endpoint: ep.url, name: ep.name, error: err.message });
    }
  }
  const tried = errors.map(e => `  ${e.name} (${e.endpoint}): ${e.error}`).join('\n');
  // Lazy import to avoid circular dependency (errors.js is simple, no deps)
  const { ChainError } = await import('./errors.js');
  throw new ChainError('ALL_ENDPOINTS_FAILED', `${label} failed on all ${endpoints.length} endpoints (verified ${LAST_VERIFIED}):\n${tried}\n\nAll endpoints may be down, or your network may be blocking HTTPS. Try curl-ing the URLs manually.`, { endpoints: errors });
}

// ─── Runtime Endpoint Management ────────────────────────────────────────────
// Add/remove/reorder RPC and LCD endpoints at runtime without code changes.
// The arrays above are `const` but are Objects (mutable contents).

/**
 * Add an RPC endpoint at runtime. Skips if URL already exists.
 * @param {string} url - RPC URL (e.g. 'https://rpc.newprovider.com')
 * @param {string} [name='Custom'] - Provider name
 * @param {boolean} [prepend=false] - If true, adds to front (highest priority)
 */
export function addRpcEndpoint(url, name = 'Custom', prepend = false) {
  if (RPC_ENDPOINTS.some(e => e.url === url)) return;
  const entry = { url, name, verified: new Date().toISOString().slice(0, 10) };
  prepend ? RPC_ENDPOINTS.unshift(entry) : RPC_ENDPOINTS.push(entry);
}

/**
 * Add an LCD endpoint at runtime. Skips if URL already exists.
 * @param {string} url - LCD URL (e.g. 'https://api.newprovider.com')
 * @param {string} [name='Custom'] - Provider name
 * @param {boolean} [prepend=false] - If true, adds to front (highest priority)
 */
export function addLcdEndpoint(url, name = 'Custom', prepend = false) {
  if (LCD_ENDPOINTS.some(e => e.url === url)) return;
  const entry = { url, name, verified: new Date().toISOString().slice(0, 10) };
  prepend ? LCD_ENDPOINTS.unshift(entry) : LCD_ENDPOINTS.push(entry);
}

/**
 * Remove an RPC endpoint by URL.
 * @param {string} url
 */
export function removeRpcEndpoint(url) {
  const idx = RPC_ENDPOINTS.findIndex(e => e.url === url);
  if (idx !== -1) RPC_ENDPOINTS.splice(idx, 1);
}

/**
 * Remove an LCD endpoint by URL.
 * @param {string} url
 */
export function removeLcdEndpoint(url) {
  const idx = LCD_ENDPOINTS.findIndex(e => e.url === url);
  if (idx !== -1) LCD_ENDPOINTS.splice(idx, 1);
}

/**
 * Replace ALL endpoints at once (e.g. from a config file or remote registry).
 * @param {'rpc'|'lcd'} type
 * @param {Array<{url: string, name?: string}>} endpoints
 */
export function setEndpoints(type, endpoints) {
  const target = type === 'rpc' ? RPC_ENDPOINTS : LCD_ENDPOINTS;
  target.length = 0;
  for (const ep of endpoints) {
    target.push({ url: ep.url, name: ep.name || 'Custom', verified: new Date().toISOString().slice(0, 10) });
  }
}

/**
 * Get current endpoint lists (for inspection/debugging).
 * @returns {{ rpc: Array, lcd: Array }}
 */
export function getEndpoints() {
  return { rpc: [...RPC_ENDPOINTS], lcd: [...LCD_ENDPOINTS] };
}

/**
 * Health-check RPC endpoints and reorder by latency (fastest first).
 * Uses Tendermint /status endpoint which returns node info + sync status.
 * @param {number} [timeoutMs=5000] - Timeout per endpoint
 * @returns {Promise<Array<{url: string, name: string, latencyMs: number|null, blockHeight?: number}>>}
 */
export async function checkRpcEndpointHealth(timeoutMs = 5000) {
  const results = await Promise.all(RPC_ENDPOINTS.map(async (ep) => {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const resp = await axios.get(`${ep.url}/status`, { signal: controller.signal, timeout: timeoutMs });
      clearTimeout(timer);
      const height = parseInt(resp.data?.result?.sync_info?.latest_block_height || '0', 10);
      return { ...ep, latencyMs: Date.now() - start, blockHeight: height };
    } catch {
      return { ...ep, latencyMs: null };
    }
  }));
  return results.sort((a, b) => {
    if (a.latencyMs != null && b.latencyMs != null) return a.latencyMs - b.latencyMs;
    if (a.latencyMs != null) return -1;
    if (b.latencyMs != null) return 1;
    return 0;
  });
}

/**
 * Health-check both RPC and LCD endpoints, reorder by latency.
 * Moves fastest-responding endpoints to the front of each array.
 * @param {number} [timeoutMs=5000]
 * @returns {Promise<{ rpc: Array, lcd: Array }>}
 */
export async function optimizeEndpoints(timeoutMs = 5000) {
  const [rpcResults, lcdResults] = await Promise.all([
    checkRpcEndpointHealth(timeoutMs),
    checkEndpointHealth(LCD_ENDPOINTS, timeoutMs),
  ]);
  // Reorder arrays in-place: healthy first, by latency
  const reorder = (target, results) => {
    const healthy = results.filter(r => r.latencyMs != null);
    const dead = results.filter(r => r.latencyMs == null);
    target.length = 0;
    for (const r of [...healthy, ...dead]) {
      target.push({ url: r.url, name: r.name, verified: r.verified || LAST_VERIFIED });
    }
  };
  reorder(RPC_ENDPOINTS, rpcResults);
  reorder(LCD_ENDPOINTS, lcdResults);
  return { rpc: rpcResults, lcd: lcdResults };
}
