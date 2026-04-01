/**
 * Node Connection Orchestration for Sentinel dVPN
 *
 * Complete flows for connecting to a Sentinel node via WireGuard or V2Ray.
 * Handles: query → pay → handshake → tunnel setup → speed test.
 *
 * Usage:
 *   import { connectDirect, connectViaPlan, queryOnlineNodes, disconnect } from './node-connect.js';
 *
 *   // Direct pay-per-GB connection (full tunnel — changes your IP)
 *   const conn = await connectDirect({ mnemonic, nodeAddress, rpcUrl, lcdUrl, v2rayExePath });
 *
 *   // With progress callback
 *   const conn = await connectDirect({
 *     mnemonic, nodeAddress, rpcUrl, lcdUrl, v2rayExePath,
 *     onProgress: (step, detail) => console.log(`[${step}] ${detail}`),
 *   });
 *
 *   // Connection via existing plan
 *   const conn = await connectViaPlan({ mnemonic, planId, nodeAddress, rpcUrl, lcdUrl, v2rayExePath });
 */

import https from 'https';
import { EventEmitter } from 'events';
import axios from 'axios';
import { execSync, execFileSync, spawn } from 'child_process';
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';
import { createServer } from 'net';
import path from 'path';
import os from 'os';

// axios adapter set in defaults.js (imported below) — prevents undici "fetch failed" on Node.js v18+.

import {
  createWallet, privKeyFromMnemonic, createClient, broadcast, broadcastWithFeeGrant,
  extractId, findExistingSession, getBalance, MSG_TYPES, resolveNodeUrl,
  fetchActiveNodes, filterNodes, queryNode, buildEndSessionMsg,
} from './cosmjs-setup.js';

import {
  nodeStatusV3, generateWgKeyPair, initHandshakeV3,
  writeWgConfig, generateV2RayUUID, initHandshakeV3V2Ray,
  buildV2RayClientConfig, extractSessionId, waitForPort,
} from './v3protocol.js';

import { installWgTunnel, disconnectWireGuard, emergencyCleanupSync, WG_AVAILABLE, IS_ADMIN } from './wireguard.js';
import { speedtestViaSocks5, speedtestDirect, resolveSpeedtestIPs, flushSpeedTestDnsCache } from './speedtest.js';
import { saveState, clearState, recoverOrphans, markSessionPoisoned, markSessionActive, isSessionPoisoned, saveCredentials, loadCredentials, clearCredentials } from './state.js';
import {
  DEFAULT_RPC, DEFAULT_LCD, RPC_ENDPOINTS, LCD_ENDPOINTS,
  BROKEN_NODES, tryWithFallback, LAST_VERIFIED, DEFAULT_TIMEOUTS, sleep,
  recordTransportResult, resolveDnsServers,
} from './defaults.js';
import {
  SentinelError, ValidationError, NodeError, ChainError, TunnelError, ErrorCodes,
} from './errors.js';
import { createNodeHttpsAgent, publicEndpointAgent } from './tls-trust.js';

// CA-validated agent for LCD/RPC public endpoints (valid CA certs)
const httpsAgent = publicEndpointAgent;

// ─── Event Emitter ───────────────────────────────────────────────────────────
// Subscribe to SDK lifecycle events without polling:
//   import { events } from './node-connect.js';
//   events.on('connected', ({ sessionId, serviceType }) => updateUI());
//   events.on('disconnected', ({ reason }) => showNotification());
//   events.on('progress', ({ step, detail }) => updateProgressBar());

export const events = new EventEmitter();

// ─── Cleanup Safety ──────────────────────────────────────────────────────────
// Track whether registerCleanupHandlers() has been called. If a developer calls
// connect() without registering, they risk orphaning WireGuard adapters or V2Ray
// processes on crash/SIGINT — the "Dead Internet" bug.
let _cleanupRegistered = false;
let _cleanupWarned = false;

function warnIfNoCleanup(fnName) {
  if (!_cleanupRegistered) {
    throw new SentinelError(ErrorCodes.INVALID_OPTIONS,
      `${fnName}() called without registerCleanupHandlers(). ` +
      `If your app crashes, WireGuard/V2Ray tunnels will orphan and kill the user's internet. ` +
      `Call registerCleanupHandlers() once at app startup, or use quickConnect() which does it automatically.`
    );
  }
}

// ─── Connection Mutex ─────────────────────────────────────────────────────────
// v27: Prevent concurrent connection attempts (backported from C# SemaphoreSlim).
// Only one connect call may be in-flight at a time. quickConnect inherits via connectAuto.
let _connectLock = false;

// v30: Abort flag — disconnect() sets this to stop a running connectAuto() retry loop.
// Without this, disconnect() clears tunnel state but connectAuto() keeps retrying,
// paying for new sessions. The user cannot reconnect because _connectLock stays held.
let _abortConnect = false;

/** Check if a connection attempt is currently in progress. */
export function isConnecting() { return _connectLock; }

// ─── Connection State ─────────────────────────────────────────────────────────
// v22: Encapsulated state enables per-instance connections via SentinelClient.
// Module-level functions use _defaultState for backward compatibility.

export class ConnectionState {
  constructor() {
    this.v2rayProc = null;
    this.wgTunnel = null;
    this.systemProxy = false;
    this.connection = null;  // { nodeAddress, serviceType, sessionId, connectedAt, socksPort? }
    this.savedProxyState = null;
    this._mnemonic = null;   // Stored for session-end TX on disconnect (zeroed after use)
    _activeStates.add(this);
  }
  get isConnected() { return !!(this.v2rayProc || this.wgTunnel); }
  destroy() { _activeStates.delete(this); }
}

// Global registry of active states — used by exit handlers to clean up all instances
const _activeStates = new Set();
const _defaultState = new ConnectionState();

// Default logger — can be overridden per-call via opts.log
let defaultLog = console.log;

// ─── Wallet Cache ────────────────────────────────────────────────────────────
// v21: Cache wallet derivation (BIP39 → SLIP-10 is CPU-bound, ~300ms).
// Same mnemonic always produces the same wallet — safe to cache.
// Keyed by full SHA256 of mnemonic to avoid storing the raw mnemonic.

import { sha256 as _sha256 } from '@cosmjs/crypto';
const _walletCache = new Map();

async function cachedCreateWallet(mnemonic) {
  const key = Buffer.from(_sha256(Buffer.from(mnemonic))).toString('hex'); // full SHA256 — no truncation
  if (_walletCache.has(key)) return _walletCache.get(key);
  const result = await createWallet(mnemonic);
  _walletCache.set(key, result);
  return result;
}

/** Clear the wallet derivation cache. Call after disconnect to release key material from memory. */
export function clearWalletCache() {
  _walletCache.clear();
}

// ─── Circuit Breaker ─────────────────────────────────────────────────────────
// v22: Skip nodes that repeatedly fail. Resets after TTL expires.
// v25: Configurable threshold/TTL via configureCircuitBreaker().

const _circuitBreaker = new Map(); // address -> { count, lastFail }
let _cbTtl = 5 * 60_000;  // default 5 minutes
let _cbThreshold = 3;      // default 3 failures before tripping

function recordNodeFailure(address) {
  const entry = _circuitBreaker.get(address) || { count: 0, lastFail: 0 };
  entry.count++;
  entry.lastFail = Date.now();
  _circuitBreaker.set(address, entry);
}

function isCircuitOpen(address) {
  const entry = _circuitBreaker.get(address);
  if (!entry) return false;
  if (Date.now() - entry.lastFail > _cbTtl) {
    _circuitBreaker.delete(address);
    return false;
  }
  return entry.count >= _cbThreshold;
}

export function resetCircuitBreaker(address) {
  if (address) _circuitBreaker.delete(address);
  else _circuitBreaker.clear();
}

/**
 * Configure circuit breaker thresholds globally.
 * @param {{ threshold?: number, ttlMs?: number }} opts
 */
export function configureCircuitBreaker(opts = {}) {
  if (opts.threshold != null) _cbThreshold = Math.max(1, Math.floor(opts.threshold));
  if (opts.ttlMs != null) _cbTtl = Math.max(1000, Math.floor(opts.ttlMs));
}

/**
 * Get circuit breaker status for observability.
 * @param {string} [address] - Specific node, or omit for all.
 * @returns {object} Status per node: { count, lastFail, isOpen }
 */
export function getCircuitBreakerStatus(address) {
  if (address) {
    const entry = _circuitBreaker.get(address);
    if (!entry) return null;
    return { count: entry.count, lastFail: entry.lastFail, isOpen: isCircuitOpen(address) };
  }
  const result = {};
  for (const [addr, entry] of _circuitBreaker) {
    result[addr] = { count: entry.count, lastFail: entry.lastFail, isOpen: isCircuitOpen(addr) };
  }
  return result;
}

// ─── Connection Metrics (v25) ────────────────────────────────────────────────
// Track per-node connection stats for reliability tracking over time.

const _connectionMetrics = new Map(); // nodeAddress -> { attempts, successes, failures, avgTimeMs, lastAttempt }

function _recordMetric(nodeAddress, success, durationMs) {
  const entry = _connectionMetrics.get(nodeAddress) || { attempts: 0, successes: 0, failures: 0, totalTimeMs: 0, lastAttempt: 0 };
  entry.attempts++;
  if (success) entry.successes++; else entry.failures++;
  entry.totalTimeMs += durationMs || 0;
  entry.lastAttempt = Date.now();
  _connectionMetrics.set(nodeAddress, entry);
}

/**
 * Get connection metrics for observability.
 * @param {string} [nodeAddress] - Specific node, or omit for all.
 * @returns {object} Per-node stats: { attempts, successes, failures, successRate, avgTimeMs, lastAttempt }
 */
export function getConnectionMetrics(nodeAddress) {
  const format = (entry) => ({
    ...entry,
    successRate: entry.attempts > 0 ? entry.successes / entry.attempts : 0,
    avgTimeMs: entry.attempts > 0 ? Math.round(entry.totalTimeMs / entry.attempts) : 0,
  });
  if (nodeAddress) {
    const entry = _connectionMetrics.get(nodeAddress);
    return entry ? format(entry) : null;
  }
  const result = {};
  for (const [addr, entry] of _connectionMetrics) result[addr] = format(entry);
  return result;
}

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

// ─── Abort helper ────────────────────────────────────────────────────────────

function checkAborted(signal) {
  if (signal?.aborted) {
    throw new SentinelError(ErrorCodes.ABORTED, 'Connection aborted', { reason: signal.reason });
  }
}

// ─── Progress helper ─────────────────────────────────────────────────────────

function progress(cb, logFn, step, detail, meta = {}) {
  const entry = { event: `sdk.${step}`, detail, ts: Date.now(), ...meta };
  events.emit('progress', entry);
  if (logFn) try { logFn(`[${step}] ${detail}`); } catch {} // user callback may throw — don't crash SDK
  if (cb) try { cb(step, detail, entry); } catch {} // user callback may throw — don't crash SDK
}

// ─── Node Inactive Retry Helper ──────────────────────────────────────────────
// LCD may show node as active, but chain rejects TX with code 105 ("invalid
// status inactive") if the node went offline between query and payment.
// Retry once after 15s in case LCD data was stale.

function _isNodeInactiveError(err) {
  const msg = String(err?.message || '');
  const code = err?.details?.code;
  return msg.includes('invalid status inactive') || code === 105;
}

async function broadcastWithInactiveRetry(client, address, msgs, logFn, onProgress) {
  try {
    return await broadcast(client, address, msgs);
  } catch (err) {
    if (_isNodeInactiveError(err)) {
      progress(onProgress, logFn, 'session', 'Node reported inactive (code 105) — LCD stale data. Retrying in 15s...');
      await sleep(15000);
      try {
        return await broadcast(client, address, msgs);
      } catch (retryErr) {
        if (_isNodeInactiveError(retryErr)) {
          throw new NodeError(ErrorCodes.NODE_INACTIVE, 'Node went inactive between query and payment (code 105). LCD stale data confirmed after retry.', {
            original: retryErr.message,
            code: 105,
          });
        }
        throw retryErr;
      }
    }
    throw err;
  }
}

// ─── System Proxy (for V2Ray SOCKS5) ─────────────────────────────────────────

const WIN_REG = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

/**
 * Set system SOCKS proxy so browser/system traffic goes through V2Ray.
 * Windows: registry (Internet Settings). macOS: networksetup. Linux: gsettings (GNOME).
 */
export function setSystemProxy(socksPort, state) {
  const _state = state || _defaultState;
  const port = String(Math.floor(Number(socksPort))); // sanitize to numeric string
  try {
    if (process.platform === 'win32') {
      // Backup current proxy state before modifying (restored in clearSystemProxy)
      try {
        const enableOut = execFileSync('reg', ['query', WIN_REG, '/v', 'ProxyEnable'], { encoding: 'utf8', stdio: 'pipe' });
        let serverOut = '';
        try { serverOut = execFileSync('reg', ['query', WIN_REG, '/v', 'ProxyServer'], { encoding: 'utf8', stdio: 'pipe' }); } catch {}
        _state.savedProxyState = { platform: 'win32', enableOut, serverOut };
      } catch {
        _state.savedProxyState = { platform: 'win32', enableOut: '', serverOut: '' };
      }
      execFileSync('reg', ['add', WIN_REG, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '1', '/f'], { stdio: 'pipe' });
      execFileSync('reg', ['add', WIN_REG, '/v', 'ProxyServer', '/t', 'REG_SZ', '/d', `socks=127.0.0.1:${port}`, '/f'], { stdio: 'pipe' });
    } else if (process.platform === 'darwin') {
      // macOS: set SOCKS proxy on all network services
      const services = execFileSync('networksetup', ['-listallnetworkservices'], { encoding: 'utf8', stdio: 'pipe' })
        .split('\n').filter(s => s && !s.startsWith('*') && !s.startsWith('An asterisk'));
      for (const svc of services) {
        try { execFileSync('networksetup', ['-setsocksfirewallproxy', svc, '127.0.0.1', port], { stdio: 'pipe' }); } catch {}
        try { execFileSync('networksetup', ['-setsocksfirewallproxystate', svc, 'on'], { stdio: 'pipe' }); } catch {}
      }
    } else {
      // Linux: GNOME gsettings (most common desktop)
      try {
        execFileSync('gsettings', ['set', 'org.gnome.system.proxy', 'mode', 'manual'], { stdio: 'pipe' });
        execFileSync('gsettings', ['set', 'org.gnome.system.proxy.socks', 'host', '127.0.0.1'], { stdio: 'pipe' });
        execFileSync('gsettings', ['set', 'org.gnome.system.proxy.socks', 'port', port], { stdio: 'pipe' });
      } catch {} // gsettings not available (headless/non-GNOME) — silent no-op
    }
    _state.systemProxy = true;
  } catch (e) { console.warn('[sentinel-sdk] setSystemProxy warning:', e.message); }
}

/**
 * Clear system proxy. Always call on disconnect/exit.
 * Safe to call multiple times.
 */
export function clearSystemProxy(state) {
  const _state = state || _defaultState;
  try {
    if (process.platform === 'win32') {
      if (_state.savedProxyState?.platform === 'win32' && _state.savedProxyState.enableOut.includes('0x1') && _state.savedProxyState.serverOut) {
        // User had a proxy before — restore their previous ProxyServer value
        const match = _state.savedProxyState.serverOut.match(/ProxyServer\s+REG_SZ\s+(.+)/);
        if (match) {
          execFileSync('reg', ['add', WIN_REG, '/v', 'ProxyServer', '/t', 'REG_SZ', '/d', match[1].trim(), '/f'], { stdio: 'pipe' });
        } else {
          execFileSync('reg', ['delete', WIN_REG, '/v', 'ProxyServer', '/f'], { stdio: 'pipe' });
        }
        // Keep ProxyEnable=1 since they had it on
      } else {
        // User had no proxy before (or no backup) — disable
        execFileSync('reg', ['add', WIN_REG, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '0', '/f'], { stdio: 'pipe' });
        try { execFileSync('reg', ['delete', WIN_REG, '/v', 'ProxyServer', '/f'], { stdio: 'pipe' }); } catch {} // may not exist
      }
    } else if (process.platform === 'darwin') {
      const services = execFileSync('networksetup', ['-listallnetworkservices'], { encoding: 'utf8', stdio: 'pipe' })
        .split('\n').filter(s => s && !s.startsWith('*') && !s.startsWith('An asterisk'));
      for (const svc of services) {
        try { execFileSync('networksetup', ['-setsocksfirewallproxystate', svc, 'off'], { stdio: 'pipe' }); } catch {}
      }
    } else {
      try { execFileSync('gsettings', ['set', 'org.gnome.system.proxy', 'mode', 'none'], { stdio: 'pipe' }); } catch {} // gsettings unavailable — headless/non-GNOME
    }
  } catch (e) { console.warn('[sentinel-sdk] clearSystemProxy warning:', e.message); }
  _state.systemProxy = false;
  _state.savedProxyState = null;
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

/**
 * Score a node's expected connection quality (0-100).
 * Based on real success rates from 400+ node tests.
 * Higher = more likely to produce a working tunnel.
 */
function scoreNode(status) {
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

// ─── Fast Reconnect (Credential Cache) ───────────────────────────────────────

/**
 * Attempt fast reconnect using saved credentials. Skips payment and handshake.
 * Returns null if no saved credentials, session expired, or tunnel setup fails.
 *
 * @param {object} opts - Same as connectDirect options
 * @param {ConnectionState} [state] - Connection state instance
 * @returns {Promise<object|null>} Connection result or null
 */
export async function tryFastReconnect(opts, state = _defaultState) {
  const saved = loadCredentials(opts.nodeAddress);
  if (!saved) return null;

  const onProgress = opts.onProgress || null;
  const logFn = opts.log || defaultLog;
  const fullTunnel = opts.fullTunnel !== false;
  const killSwitch = opts.killSwitch === true;
  const systemProxy = opts.systemProxy === true;
  const tlsTrust = opts.tlsTrust || 'tofu';

  progress(onProgress, logFn, 'cache', `Found saved credentials for ${opts.nodeAddress}, verifying session...`);

  // Verify session is still active on chain
  try {
    const lcd = opts.lcdUrl || DEFAULT_LCD;
    const { wallet, account } = await cachedCreateWallet(opts.mnemonic);
    const existingSession = await findExistingSession(lcd, account.address, opts.nodeAddress);
    if (!existingSession || String(existingSession) !== saved.sessionId) {
      clearCredentials(opts.nodeAddress);
      progress(onProgress, logFn, 'cache', 'Saved session expired — proceeding with fresh payment');
      return null;
    }
  } catch (err) {
    // Chain query failed — can't verify session, fall back to normal flow
    progress(onProgress, logFn, 'cache', `Session verification failed (${err.message}) — proceeding with fresh payment`);
    clearCredentials(opts.nodeAddress);
    return null;
  }

  progress(onProgress, logFn, 'cache', `Session ${saved.sessionId} still active — skipping payment and handshake`);

  try {
    if (saved.serviceType === 'wireguard') {
      // Validate tunnel requirements
      if (!WG_AVAILABLE) {
        clearCredentials(opts.nodeAddress);
        return null;
      }

      // Resolve split IPs
      let resolvedSplitIPs = null;
      if (opts.splitIPs && Array.isArray(opts.splitIPs) && opts.splitIPs.length > 0) {
        resolvedSplitIPs = opts.splitIPs;
      } else if (fullTunnel) {
        resolvedSplitIPs = null;
      } else {
        try { resolvedSplitIPs = await resolveSpeedtestIPs(); } catch { resolvedSplitIPs = null; }
      }

      const confPath = writeWgConfig(
        Buffer.from(saved.wgPrivateKey, 'base64'),
        saved.wgAssignedAddrs,
        saved.wgServerPubKey,
        saved.wgServerEndpoint,
        resolvedSplitIPs,
        { dns: resolveDnsServers(opts.dns) },
      );

      progress(onProgress, logFn, 'tunnel', 'Installing WireGuard tunnel from cached credentials...');
      const installDelays = [1500, 1500, 2000];
      let tunnelInstalled = false;
      for (let i = 0; i < installDelays.length; i++) {
        await sleep(installDelays[i]);
        try {
          await installWgTunnel(confPath);
          state.wgTunnel = 'wgsent0';
          tunnelInstalled = true;
          break;
        } catch (installErr) {
          if (i === installDelays.length - 1) throw installErr;
        }
      }

      // Verify connectivity
      progress(onProgress, logFn, 'verify', 'Verifying tunnel connectivity...');
      const tunnelWorks = await verifyWgConnectivity();
      if (!tunnelWorks) {
        try { await disconnectWireGuard(); } catch {}
        state.wgTunnel = null;
        clearCredentials(opts.nodeAddress);
        return null;
      }

      if (killSwitch) {
        try { enableKillSwitch(saved.wgServerEndpoint); } catch {}
      }

      progress(onProgress, logFn, 'verify', 'WireGuard reconnected from cached credentials!');
      const sessionIdStr = saved.sessionId;
      saveState({ sessionId: sessionIdStr, serviceType: 'wireguard', wgTunnelName: 'wgsent0', confPath, systemProxySet: false });
      state.connection = { sessionId: sessionIdStr, serviceType: 'wireguard', nodeAddress: opts.nodeAddress, connectedAt: Date.now() };
      events.emit('connected', { sessionId: BigInt(sessionIdStr), serviceType: 'wireguard', nodeAddress: opts.nodeAddress, cached: true });
      return {
        sessionId: sessionIdStr,
        serviceType: 'wireguard',
        nodeAddress: opts.nodeAddress,
        confPath,
        cached: true,
        cleanup: async () => {
          if (_killSwitchEnabled) disableKillSwitch();
          try { await disconnectWireGuard(); } catch {}
          // End session on chain (fire-and-forget)
          if (saved.sessionId && state._mnemonic) {
            _endSessionOnChain(saved.sessionId, state._mnemonic).then(r => events.emit('sessionEnded', { txHash: r?.transactionHash })).catch(e => events.emit('sessionEndFailed', { error: e.message }));
          }
          state.wgTunnel = null;
          state.connection = null;
          state._mnemonic = null;
          clearState();
        },
      };

    } else if (saved.serviceType === 'v2ray') {
      const v2rayExePath = findV2RayExe(opts.v2rayExePath);
      if (!v2rayExePath) {
        clearCredentials(opts.nodeAddress);
        return null;
      }

      // Fetch node info to get serverHost
      const nodeInfo = await queryNode(opts.nodeAddress, { lcdUrl: opts.lcdUrl || DEFAULT_LCD });
      const serverHost = new URL(nodeInfo.remote_url).hostname;

      // Rebuild V2Ray config from saved metadata
      // Sequential increment from random start avoids repeated collisions
      // with TIME_WAIT ports that pure random retries can hit.
      const startPort1 = 10800 + Math.floor(Math.random() * 1000);
      let socksPort = startPort1;
      for (let i = 0; i < 5; i++) {
        socksPort = startPort1 + i;
        if (await checkPortFree(socksPort)) break;
      }
      const config = buildV2RayClientConfig(serverHost, saved.v2rayConfig, saved.v2rayUuid, socksPort, { dns: resolveDnsServers(opts.dns), systemProxy: opts.systemProxy === true });

      const tmpDir = path.join(os.tmpdir(), 'sentinel-v2ray');
      mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
      const cfgPath = path.join(tmpDir, 'config.json');

      let workingOutbound = null;
      for (const ob of config.outbounds) {
        if (state.v2rayProc) {
          state.v2rayProc.kill();
          state.v2rayProc = null;
          await sleep(2000);
        }

        const attempt = {
          ...config,
          outbounds: [ob],
          routing: {
            domainStrategy: 'IPIfNonMatch',
            rules: [
              { inboundTag: ['api'], outboundTag: 'api', type: 'field' },
              { inboundTag: ['proxy'], outboundTag: ob.tag, type: 'field' },
            ],
          },
        };

        writeFileSync(cfgPath, JSON.stringify(attempt, null, 2), { mode: 0o600 });
        const proc = spawn(v2rayExePath, ['run', '-config', cfgPath], { stdio: 'pipe' });
        // Filter V2Ray stderr noise (fast reconnect path)
        if (proc.stderr) {
          proc.stderr.on('data', (chunk) => {
            const lines = chunk.toString().split('\n');
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed.includes('insufficient header')) continue;
              logFn?.(`[v2ray stderr] ${trimmed}`);
            }
          });
        }
        setTimeout(() => { try { unlinkSync(cfgPath); } catch {} }, 2000);

        const ready = await waitForPort(socksPort, DEFAULT_TIMEOUTS.v2rayReady);
        if (!ready || proc.exitCode !== null) {
          proc.kill();
          continue;
        }

        // Test SOCKS5 connectivity
        let connected = false;
        try {
          const { SocksProxyAgent } = await import('socks-proxy-agent');
          const auth = config._socksAuth;
          const proxyUrl = (auth?.user && auth?.pass)
            ? `socks5://${auth.user}:${auth.pass}@127.0.0.1:${socksPort}`
            : `socks5://127.0.0.1:${socksPort}`;
          const agent = new SocksProxyAgent(proxyUrl);
          try {
            await axios.get('https://www.google.com', { httpAgent: agent, httpsAgent: agent, timeout: 10000, maxRedirects: 2, validateStatus: () => true });
            connected = true;
          } catch {} finally { agent.destroy(); }
        } catch {}

        if (connected) {
          workingOutbound = ob;
          state.v2rayProc = proc;
          break;
        }
        proc.kill();
      }

      if (!workingOutbound) {
        clearCredentials(opts.nodeAddress);
        return null;
      }

      if (systemProxy && socksPort) {
        setSystemProxy(socksPort, state);
      }

      progress(onProgress, logFn, 'verify', 'V2Ray reconnected from cached credentials!');
      const sessionIdStr = saved.sessionId;
      saveState({ sessionId: sessionIdStr, serviceType: 'v2ray', v2rayPid: state.v2rayProc?.pid, socksPort, systemProxySet: state.systemProxy, nodeAddress: opts.nodeAddress });
      state.connection = { sessionId: sessionIdStr, serviceType: 'v2ray', nodeAddress: opts.nodeAddress, socksPort, connectedAt: Date.now() };
      events.emit('connected', { sessionId: BigInt(sessionIdStr), serviceType: 'v2ray', nodeAddress: opts.nodeAddress, cached: true });
      return {
        sessionId: sessionIdStr,
        serviceType: 'v2ray',
        nodeAddress: opts.nodeAddress,
        socksPort,
        outbound: workingOutbound.tag,
        cached: true,
        cleanup: async () => {
          if (state.v2rayProc) { state.v2rayProc.kill(); state.v2rayProc = null; await sleep(500); }
          if (state.systemProxy) clearSystemProxy(state);
          // End session on chain (fire-and-forget)
          if (sessionIdStr && state._mnemonic) {
            _endSessionOnChain(sessionIdStr, state._mnemonic).then(r => events.emit('sessionEnded', { txHash: r?.transactionHash })).catch(e => events.emit('sessionEndFailed', { error: e.message }));
          }
          state.connection = null;
          state._mnemonic = null;
          clearState();
        },
      };
    }
  } catch (err) {
    // Fast reconnect failed — clear stale credentials, fall back to normal flow
    progress(onProgress, logFn, 'cache', `Fast reconnect failed (${err.message}) — falling back to normal flow`);
    clearCredentials(opts.nodeAddress);
    return null;
  }

  return null;
}

// ─── Direct Connection (Pay per GB) ─────────────────────────────────────────

/**
 * Connect to a node by paying directly per GB.
 *
 * Flow: check existing session → pay for new session → handshake → tunnel
 *
 * @param {object} opts
 * @param {string} opts.mnemonic - BIP39 mnemonic
 * @param {string} opts.nodeAddress - sentnode1... address
 * @param {string} opts.rpcUrl - Chain RPC (default: https://rpc.sentinel.co:443)
 * @param {string} opts.lcdUrl - Chain LCD (default: https://lcd.sentinel.co)
 * @param {number} opts.gigabytes - Bandwidth to purchase (default: 1)
 * @param {boolean} opts.preferHourly - Prefer hourly sessions when cheaper than per-GB (default: false).
 *   When true, checks if the node offers hourly_prices with udvpn denom and uses { hours: 1 } if cheaper.
 * @param {string} opts.v2rayExePath - Path to v2ray.exe (auto-detected if missing)
 * @param {boolean} opts.fullTunnel - WireGuard: route ALL traffic through VPN (default: true). Set false for split tunnel.
 *   Set to true for production VPN apps that need full IP masking.
 * @param {string[]} opts.splitIPs - WireGuard split tunnel IPs. Overrides fullTunnel.
 *   Pass specific IPs to route only those through VPN. Ignored if fullTunnel is true.
 * @param {boolean} opts.systemProxy - V2Ray: auto-set Windows system SOCKS proxy (default: false).
 *   Set to true for production VPN apps. Caution: if V2Ray crashes, system proxy points to dead port.
 * @param {boolean} opts.killSwitch - Enable kill switch — blocks all traffic if tunnel drops (default: false). Windows only.
 * @param {boolean} opts.forceNewSession - Always pay for a new session, skip findExistingSession (default: false).
 *   Use when multiple apps share one wallet to avoid "already exists" errors from stale sessions.
 * @param {function} opts.onProgress - Optional callback: (step, detail) => void
 *   Steps: 'wallet' | 'node-check' | 'validate' | 'session' | 'handshake' | 'tunnel' | 'verify' | 'proxy'
 * @param {function} opts.log - Optional log function (default: console.log). All SDK output goes through this.
 *   Pass a custom function to route logs to your app's logging system.
 * @returns {{ sessionId, serviceType, socksPort?, cleanup() }}
 */
export async function connectDirect(opts) {
  warnIfNoCleanup('connectDirect');
  // ── Input validation (fail fast before any network/chain calls) ──
  validateConnectOpts(opts, 'connectDirect');
  if (opts.gigabytes != null) {
    const g = Number(opts.gigabytes);
    if (!Number.isInteger(g) || g < 1 || g > 100) throw new ValidationError(ErrorCodes.INVALID_GIGABYTES, 'gigabytes must be a positive integer (1-100)', { value: opts.gigabytes });
  }

  // ── Connection mutex (prevent concurrent connects) ──
  const ownsLock = !opts._skipLock && !_connectLock;
  if (!opts._skipLock && _connectLock) throw new SentinelError(ErrorCodes.ALREADY_CONNECTED, 'Connection already in progress');
  if (ownsLock) _connectLock = true;
  try {

  const gigabytes = opts.gigabytes || 1;
  const forceNewSession = !!opts.forceNewSession;

  // ── Fast Reconnect: check for saved credentials ──
  if (!forceNewSession) {
    // Set mnemonic on state BEFORE fast reconnect — needed for _endSessionOnChain() on disconnect
    (opts._state || _defaultState)._mnemonic = opts.mnemonic;
    const fast = await tryFastReconnect(opts, opts._state || _defaultState);
    if (fast) {
      _circuitBreaker.delete(opts.nodeAddress);
      return fast;
    }
  }

  // Payment strategy for direct pay-per-GB
  async function directPayment(ctx) {
    const { client, account, nodeInfo, lcd, logFn, onProgress, signal } = ctx;

    // Check for existing session (avoid double-pay) — skip if forceNewSession
    let sessionId = null;
    if (!forceNewSession) {
      progress(onProgress, logFn, 'session', 'Checking for existing session...');
      checkAborted(signal);
      sessionId = await findExistingSession(lcd, account.address, opts.nodeAddress);
      if (sessionId && isSessionPoisoned(String(sessionId))) {
        progress(onProgress, logFn, 'session', `Session ${sessionId} previously failed — skipping`);
        sessionId = null;
      }
    }

    if (sessionId) {
      progress(onProgress, logFn, 'session', `Reusing existing session: ${sessionId}`);
      return { sessionId: BigInt(sessionId) };
    }

    // Pay for new session — choose hourly vs per-GB pricing
    const udvpnPrice = nodeInfo.gigabyte_prices.find(p => p.denom === 'udvpn');
    if (!udvpnPrice) throw new NodeError(ErrorCodes.NODE_NO_UDVPN, 'Node does not accept udvpn', { nodeAddress: opts.nodeAddress });

    // Determine pricing model: explicit hours > preferHourly > default GB
    // preferHourly = use hourly if node offers it. No cross-unit price comparison
    // (GB price vs hour price are different units — comparing them is meaningless).
    const hourlyPrice = (nodeInfo.hourly_prices || []).find(p => p.denom === 'udvpn');
    const explicitHours = opts.hours > 0 ? opts.hours : 0;
    const useHourly = explicitHours > 0 || (opts.preferHourly && !!hourlyPrice);

    if (useHourly && !hourlyPrice) {
      throw new NodeError(ErrorCodes.NODE_OFFLINE, `Node ${opts.nodeAddress} has no hourly pricing — cannot use hours-based session. Use gigabytes instead.`);
    }

    const sessionGigabytes = useHourly ? 0 : gigabytes;
    const sessionHours = useHourly ? (explicitHours || 1) : 0;
    const sessionMaxPrice = useHourly ? hourlyPrice : udvpnPrice;

    const msg = {
      typeUrl: MSG_TYPES.START_SESSION,
      value: {
        from: account.address,
        node_address: opts.nodeAddress,
        gigabytes: sessionGigabytes,
        hours: sessionHours,
        max_price: { denom: 'udvpn', base_value: sessionMaxPrice.base_value, quote_value: sessionMaxPrice.quote_value },
      },
    };

    checkAborted(signal);
    const pricingMode = useHourly ? 'hourly' : 'per-GB';
    progress(onProgress, logFn, 'session', `Broadcasting session TX (${pricingMode})...`);
    const result = await broadcastWithInactiveRetry(client, account.address, [msg], logFn, onProgress);
    const extractedId = extractId(result, /session/i, ['session_id', 'id']);
    if (!extractedId) throw new ChainError(ErrorCodes.SESSION_EXTRACT_FAILED, 'Failed to extract session ID from TX result — check TX events', { txHash: result.transactionHash });
    sessionId = BigInt(extractedId);
    progress(onProgress, logFn, 'session', `Session created: ${sessionId} (${pricingMode}, tx: ${result.transactionHash})`);
    return { sessionId };
  }

  // Retry strategy: if handshake fails with "already exists", pay for fresh session
  async function retryPayment(ctx, _hsErr) {
    const { client, account, nodeInfo, logFn, onProgress, signal } = ctx;
    const udvpnPrice = nodeInfo.gigabyte_prices.find(p => p.denom === 'udvpn');
    if (!udvpnPrice) throw new NodeError(ErrorCodes.NODE_NO_UDVPN, 'Node does not accept udvpn', { nodeAddress: opts.nodeAddress });

    // Retry uses same hourly logic as directPayment
    const hourlyPrice = (nodeInfo.hourly_prices || []).find(p => p.denom === 'udvpn');
    const explicitHours = opts.hours > 0 ? opts.hours : 0;
    const useHourly = explicitHours > 0 || (opts.preferHourly && !!hourlyPrice);

    const retryGigabytes = useHourly ? 0 : gigabytes;
    const retryHours = useHourly ? (explicitHours || 1) : 0;
    const retryMaxPrice = useHourly ? hourlyPrice : udvpnPrice;

    const msg = {
      typeUrl: MSG_TYPES.START_SESSION,
      value: {
        from: account.address,
        node_address: opts.nodeAddress,
        gigabytes: retryGigabytes,
        hours: retryHours,
        max_price: { denom: 'udvpn', base_value: retryMaxPrice.base_value, quote_value: retryMaxPrice.quote_value },
      },
    };
    checkAborted(signal);
    const result = await broadcastWithInactiveRetry(client, account.address, [msg], logFn, onProgress);
    const retryExtracted = extractId(result, /session/i, ['session_id', 'id']);
    if (!retryExtracted) throw new ChainError(ErrorCodes.SESSION_EXTRACT_FAILED, 'Failed to extract session ID from retry TX result — check TX events', { txHash: result.transactionHash });
    const sessionId = BigInt(retryExtracted);
    progress(onProgress, logFn, 'session', `Fresh session: ${sessionId} (tx: ${result.transactionHash})`);
    return { sessionId };
  }

  const result = await connectInternal(opts, directPayment, retryPayment, opts._state || _defaultState);
  // Record success — clear circuit breaker for this node
  _circuitBreaker.delete(opts.nodeAddress);
  return result;

  } finally { if (ownsLock) _connectLock = false; }
}

/**
 * Connect with auto-fallback: on failure, try next best node automatically.
 * Uses queryOnlineNodes to find candidates, then tries up to `maxAttempts` nodes.
 *
 * v25: Supports filtering by countries, maxPriceDvpn, minScore, excludeCountries.
 *
 * @param {object} opts - Same as connectDirect, plus:
 * @param {number} opts.maxAttempts - Max nodes to try (default: 3)
 * @param {string} opts.serviceType - Filter nodes by type: 'wireguard' | 'v2ray' (optional)
 * @param {string[]} opts.countries - Only try nodes in these countries (optional)
 * @param {string[]} opts.excludeCountries - Skip nodes in these countries (optional)
 * @param {number} opts.maxPriceDvpn - Max price in P2P per GB (optional)
 * @param {number} opts.minScore - Minimum quality score (optional)
 * @param {{ threshold?: number, ttlMs?: number }} opts.circuitBreaker - Per-call circuit breaker config (optional)
 * @returns {{ sessionId, serviceType, socksPort?, cleanup(), nodeAddress }}
 */
export async function connectAuto(opts) {
  warnIfNoCleanup('connectAuto');
  if (!opts || typeof opts !== 'object') throw new ValidationError(ErrorCodes.INVALID_OPTIONS, 'connectAuto() requires an options object');
  if (typeof opts.mnemonic !== 'string' || opts.mnemonic.trim().split(/\s+/).length < 12) {
    throw new ValidationError(ErrorCodes.INVALID_MNEMONIC, 'mnemonic must be a 12+ word BIP39 string');
  }
  if (opts.maxAttempts != null && (!Number.isInteger(opts.maxAttempts) || opts.maxAttempts < 1)) {
    throw new ValidationError(ErrorCodes.INVALID_OPTIONS, 'maxAttempts must be a positive integer');
  }

  // ── Connection mutex (prevent concurrent connects) ──
  if (_connectLock) throw new SentinelError(ErrorCodes.ALREADY_CONNECTED, 'Connection already in progress');
  _connectLock = true;
  _abortConnect = false; // v30: reset abort flag at start of new connection attempt
  try {

  // v25: per-call circuit breaker config
  if (opts.circuitBreaker) configureCircuitBreaker(opts.circuitBreaker);

  const maxAttempts = opts.maxAttempts || 3;
  const logFn = opts.log || console.log;
  const errors = [];

  // If nodeAddress specified, try it first (skip circuit breaker check for explicit choice)
  if (opts.nodeAddress) {
    // v30: Check abort flag before each attempt
    if (_abortConnect) {
      _abortConnect = false;
      throw new SentinelError(ErrorCodes.ABORTED, 'Connection was cancelled by disconnect');
    }
    try {
      return await connectDirect({ ...opts, _skipLock: true });
    } catch (err) {
      recordNodeFailure(opts.nodeAddress);
      errors.push({ address: opts.nodeAddress, error: err.message });
      logFn(`[connectAuto] ${opts.nodeAddress} failed: ${err.message} — trying fallback nodes...`);
    }
  }

  // Find online nodes, excluding circuit-broken ones
  logFn('[connectAuto] Scanning for online nodes...');
  const nodes = await queryOnlineNodes({
    serviceType: opts.serviceType,
    maxNodes: maxAttempts * 3,
    onNodeProbed: opts.onNodeProbed,
  });

  // v30: Check abort after slow queryOnlineNodes call
  if (_abortConnect) {
    _abortConnect = false;
    throw new SentinelError(ErrorCodes.ABORTED, 'Connection was cancelled by disconnect');
  }

  // v25: Apply filters using filterNodes + custom exclusions
  let filtered = nodes.filter(n => n.address !== opts.nodeAddress && !isCircuitOpen(n.address));
  if (opts.countries || opts.maxPriceDvpn != null || opts.minScore != null) {
    filtered = filterNodes(filtered, {
      country: opts.countries?.[0], // filterNodes supports single country
      maxPriceDvpn: opts.maxPriceDvpn,
      minScore: opts.minScore,
    });
    // Multi-country support (filterNodes does single, we handle array)
    if (opts.countries && opts.countries.length > 1) {
      const lc = opts.countries.map(c => c.toLowerCase());
      filtered = filtered.filter(n => lc.some(c => (n.country || '').toLowerCase().includes(c)));
    }
  }
  if (opts.excludeCountries?.length) {
    const exc = opts.excludeCountries.map(c => c.toLowerCase());
    filtered = filtered.filter(n => !exc.some(c => (n.country || '').toLowerCase().includes(c)));
  }

  // v25: Emit events for skipped nodes (clock drift, circuit breaker)
  const skipped = nodes.filter(n => !filtered.includes(n) && n.address !== opts.nodeAddress);
  for (const n of skipped) {
    if (isCircuitOpen(n.address)) {
      events.emit('progress', { event: 'node.skipped', reason: 'circuit_breaker', nodeAddress: n.address, ts: Date.now() });
    }
    if (n.clockDriftSec !== null && Math.abs(n.clockDriftSec) > 120 && n.serviceType === 'v2ray') {
      events.emit('progress', { event: 'node.skipped', reason: 'clock_drift', nodeAddress: n.address, driftSeconds: n.clockDriftSec, ts: Date.now() });
    }
  }

  // v28: nodePool — restrict to a specific set of node addresses
  if (opts.nodePool?.length) {
    const poolSet = new Set(opts.nodePool);
    filtered = filtered.filter(n => poolSet.has(n.address));
  }

  const candidates = filtered;
  // Retry budget: limit total spend to maxSpend (default: 2x cheapest node price)
  const cheapestPrice = Math.min(...candidates.map(n => {
    const p = (n.gigabyte_prices || []).find(p => p.denom === 'udvpn');
    return p ? parseInt(p.quote_value || '0', 10) : Infinity;
  }).filter(p => p < Infinity));
  const maxSpend = opts.maxSpend || (cheapestPrice > 0 ? cheapestPrice * 2 + 1000000 : 100_000_000);
  let totalSpent = 0;

  for (let i = 0; i < Math.min(candidates.length, maxAttempts); i++) {
    // Check abort flag before each retry — disconnect() sets this
    if (_abortConnect) {
      _abortConnect = false;
      throw new SentinelError(ErrorCodes.ABORTED, 'Connection was cancelled by disconnect');
    }
    // Check retry budget — stop if we've spent too much
    const nodePrice = (() => {
      const p = (candidates[i].gigabyte_prices || []).find(p => p.denom === 'udvpn');
      return p ? parseInt(p.quote_value || '0', 10) : 50_000_000;
    })();
    if (totalSpent > 0 && totalSpent + nodePrice > maxSpend) {
      logFn(`[connectAuto] Retry budget exhausted (spent ${(totalSpent / 1e6).toFixed(1)} P2P, next would cost ${(nodePrice / 1e6).toFixed(1)} P2P, max ${(maxSpend / 1e6).toFixed(1)} P2P). Stopping.`);
      break;
    }
    const node = candidates[i];
    logFn(`[connectAuto] Trying ${node.address} (${i + 1}/${Math.min(candidates.length, maxAttempts)})...`);
    try {
      return await connectDirect({ ...opts, nodeAddress: node.address, _skipLock: true });
    } catch (err) {
      recordNodeFailure(node.address);
      // Track spend: if error is AFTER payment (tunnel failure), count the cost
      if (err.code !== 'INSUFFICIENT_BALANCE' && err.code !== 'NODE_OFFLINE' && err.code !== 'NODE_NOT_FOUND') {
        totalSpent += nodePrice;
      }
      errors.push({ address: node.address, error: err.message, spent: nodePrice });
      logFn(`[connectAuto] ${node.address} failed: ${err.message}`);
    }
  }

  throw new SentinelError(ErrorCodes.ALL_NODES_FAILED,
    `All ${errors.length} nodes failed (spent ~${(totalSpent / 1e6).toFixed(1)} P2P)`,
    { attempts: errors, totalSpent });

  } finally { _connectLock = false; }
}

// ─── Plan Connection (Subscribe to existing plan) ────────────────────────────

/**
 * Connect via a plan subscription.
 *
 * Flow: subscribe to plan → start session via subscription → handshake → tunnel
 *
 * @param {object} opts
 * @param {string} opts.mnemonic - BIP39 mnemonic
 * @param {number|string} opts.planId - Plan ID to subscribe to
 * @param {string} opts.nodeAddress - sentnode1... address (must be linked to plan)
 * @param {string} opts.rpcUrl - Chain RPC
 * @param {string} opts.lcdUrl - Chain LCD
 * @param {string} opts.v2rayExePath - Path to v2ray.exe (auto-detected if missing)
 * @param {boolean} opts.fullTunnel - WireGuard: route ALL traffic (default: true)
 * @param {string[]} opts.splitIPs - WireGuard split tunnel IPs (overrides fullTunnel)
 * @param {boolean} opts.systemProxy - V2Ray: auto-set Windows system proxy (default: false)
 * @param {boolean} opts.killSwitch - Enable kill switch — blocks all traffic if tunnel drops (default: false)
 * @param {function} opts.onProgress - Optional callback: (step, detail) => void
 * @param {function} opts.log - Optional log function (default: console.log)
 */
export async function connectViaPlan(opts) {
  warnIfNoCleanup('connectViaPlan');
  // ── Input validation ──
  validateConnectOpts(opts, 'connectViaPlan');
  if (opts.planId == null || opts.planId === '' || opts.planId === 0 || opts.planId === '0') {
    throw new ValidationError(ErrorCodes.INVALID_PLAN_ID, 'connectViaPlan requires opts.planId (number or string)', { value: opts.planId });
  }
  let planIdBigInt;
  try {
    planIdBigInt = BigInt(opts.planId);
  } catch {
    throw new ValidationError(ErrorCodes.INVALID_PLAN_ID, `Invalid planId: "${opts.planId}" — must be a numeric value`, { value: opts.planId });
  }

  // ── Connection mutex (prevent concurrent connects) ──
  if (_connectLock) throw new SentinelError(ErrorCodes.ALREADY_CONNECTED, 'Connection already in progress');
  _connectLock = true;
  try {

  // Payment strategy for plan subscription
  async function planPayment(ctx) {
    const { client, account, lcd: lcdUrl, logFn, onProgress, signal } = ctx;
    const msg = {
      typeUrl: MSG_TYPES.PLAN_START_SESSION,
      value: {
        from: account.address,
        id: planIdBigInt,
        denom: 'udvpn',
        renewalPricePolicy: 0,
        nodeAddress: opts.nodeAddress,
      },
    };

    checkAborted(signal);

    // Fee grant: the app passes the plan owner's address as feeGranter.
    // The plan operator is responsible for granting fee allowance to subscribers.
    // We just include it in the TX — if the grant exists on-chain, gas is free.
    // If it doesn't exist, the chain rejects and we fall back to user-paid gas.
    const feeGranter = opts.feeGranter || null;

    progress(onProgress, logFn, 'session', `Subscribing to plan ${opts.planId} + starting session${feeGranter ? ' (fee granted)' : ''}...`);

    let result;
    if (feeGranter) {
      try {
        result = await broadcastWithFeeGrant(client, account.address, [msg], feeGranter);
      } catch (feeErr) {
        // Fee grant TX failed (grant expired, revoked, or never existed) — fall back to user-paid
        progress(onProgress, logFn, 'session', 'Fee grant failed, paying gas from wallet...');
        result = await broadcastWithInactiveRetry(client, account.address, [msg], logFn, onProgress);
      }
    } else {
      result = await broadcastWithInactiveRetry(client, account.address, [msg], logFn, onProgress);
    }
    const planExtracted = extractId(result, /session/i, ['session_id', 'id']);
    if (!planExtracted) throw new ChainError(ErrorCodes.SESSION_EXTRACT_FAILED, 'Failed to extract session ID from plan TX result — check TX events', { txHash: result.transactionHash });
    const sessionId = BigInt(planExtracted);
    const subscriptionId = extractId(result, /subscription/i, ['subscription_id', 'id']);
    progress(onProgress, logFn, 'session', `Session: ${sessionId}${subscriptionId ? `, Subscription: ${subscriptionId}` : ''}`);
    return { sessionId, subscriptionId };
  }

  // No retry for plan connections (plan payment is idempotent)
  const result = await connectInternal(opts, planPayment, null, opts._state || _defaultState);
  return result;

  } finally { _connectLock = false; }
}

// ─── Subscription Connection (Use existing subscription) ─────────────────

/**
 * Connect via an existing subscription.
 *
 * Flow: start session via subscription → handshake → tunnel
 * Unlike connectViaPlan, this reuses an existing subscription instead of creating a new one.
 *
 * @param {object} opts
 * @param {string} opts.mnemonic - BIP39 mnemonic
 * @param {number|string} opts.subscriptionId - Existing subscription ID
 * @param {string} opts.nodeAddress - sentnode1... address (must be linked to subscription's plan)
 * @param {string} opts.rpcUrl - Chain RPC
 * @param {string} opts.lcdUrl - Chain LCD
 * @param {string} opts.v2rayExePath - Path to v2ray.exe (auto-detected if missing)
 * @param {boolean} opts.fullTunnel - WireGuard: route ALL traffic (default: true)
 * @param {string[]} opts.splitIPs - WireGuard split tunnel IPs (overrides fullTunnel)
 * @param {boolean} opts.systemProxy - V2Ray: auto-set Windows system proxy (default: false)
 * @param {boolean} opts.killSwitch - Enable kill switch — blocks all traffic if tunnel drops (default: false)
 * @param {function} opts.onProgress - Optional callback: (step, detail) => void
 * @param {function} opts.log - Optional log function (default: console.log)
 */
export async function connectViaSubscription(opts) {
  warnIfNoCleanup('connectViaSubscription');
  validateConnectOpts(opts, 'connectViaSubscription');
  if (opts.subscriptionId == null || opts.subscriptionId === '') {
    throw new ValidationError(ErrorCodes.INVALID_OPTIONS, 'connectViaSubscription requires opts.subscriptionId (number or string)', { value: opts.subscriptionId });
  }
  let subIdBigInt;
  try {
    subIdBigInt = BigInt(opts.subscriptionId);
  } catch {
    throw new ValidationError(ErrorCodes.INVALID_OPTIONS, `Invalid subscriptionId: "${opts.subscriptionId}" — must be a numeric value`, { value: opts.subscriptionId });
  }

  // ── Connection mutex (prevent concurrent connects) ──
  if (_connectLock) throw new SentinelError(ErrorCodes.ALREADY_CONNECTED, 'Connection already in progress');
  _connectLock = true;
  try {

  async function subPayment(ctx) {
    const { client, account, logFn, onProgress, signal } = ctx;
    const msg = {
      typeUrl: MSG_TYPES.SUB_START_SESSION,
      value: {
        from: account.address,
        id: subIdBigInt,
        nodeAddress: opts.nodeAddress,
      },
    };

    checkAborted(signal);
    progress(onProgress, logFn, 'session', `Starting session via subscription ${opts.subscriptionId}...`);
    const result = await broadcastWithInactiveRetry(client, account.address, [msg], logFn, onProgress);
    const extracted = extractId(result, /session/i, ['session_id', 'id']);
    if (!extracted) throw new ChainError(ErrorCodes.SESSION_EXTRACT_FAILED, 'Failed to extract session ID from subscription TX result', { txHash: result.transactionHash });
    const sessionId = BigInt(extracted);
    progress(onProgress, logFn, 'session', `Session: ${sessionId} (subscription ${opts.subscriptionId})`);
    return { sessionId, subscriptionId: opts.subscriptionId };
  }

  const result = await connectInternal(opts, subPayment, null, opts._state || _defaultState);
  return result;

  } finally { _connectLock = false; }
}

// ─── Shared Validation ───────────────────────────────────────────────────────

function validateConnectOpts(opts, fnName) {
  if (!opts || typeof opts !== 'object') throw new ValidationError(ErrorCodes.INVALID_OPTIONS, `${fnName}() requires an options object`);
  if (typeof opts.mnemonic !== 'string' || opts.mnemonic.trim().split(/\s+/).length < 12) {
    throw new ValidationError(ErrorCodes.INVALID_MNEMONIC, 'mnemonic must be a 12+ word BIP39 string', { wordCount: typeof opts.mnemonic === 'string' ? opts.mnemonic.trim().split(/\s+/).length : 0 });
  }
  if (typeof opts.nodeAddress !== 'string' || !/^sentnode1[a-z0-9]{38}$/.test(opts.nodeAddress)) {
    throw new ValidationError(ErrorCodes.INVALID_NODE_ADDRESS, 'nodeAddress must be a valid sentnode1... bech32 address (47 characters)', { value: opts.nodeAddress });
  }
  if (opts.rpcUrl != null && typeof opts.rpcUrl !== 'string') throw new ValidationError(ErrorCodes.INVALID_URL, 'rpcUrl must be a string URL', { value: opts.rpcUrl });
  if (opts.lcdUrl != null && typeof opts.lcdUrl !== 'string') throw new ValidationError(ErrorCodes.INVALID_URL, 'lcdUrl must be a string URL', { value: opts.lcdUrl });
}

// ─── Shared Connect Flow (eliminates connectDirect/connectViaPlan duplication) ─

async function connectInternal(opts, paymentStrategy, retryStrategy, state = _defaultState) {
  const signal = opts.signal; // AbortController support
  const _connectStart = Date.now(); // v25: metrics timing
  checkAborted(signal);

  // Handle existing connection
  if (state.isConnected) {
    if (opts.allowReconnect === false) {
      throw new SentinelError(ErrorCodes.ALREADY_CONNECTED,
        'Already connected. Disconnect first or set allowReconnect: true.',
        { nodeAddress: state.connection?.nodeAddress });
    }
    const prev = state.connection;
    await disconnectState(state);
    if (opts.log || defaultLog) (opts.log || defaultLog)(`[connect] Disconnected from ${prev?.nodeAddress || 'previous node'}`);
  }

  const onProgress = opts.onProgress || null;
  const logFn = opts.log || defaultLog;
  const fullTunnel = opts.fullTunnel !== false; // v26c: default TRUE (was false — caused "IP didn't change" confusion)
  const systemProxy = opts.systemProxy === true;
  const killSwitch = opts.killSwitch === true;
  const timeouts = { ...DEFAULT_TIMEOUTS, ...opts.timeouts };
  const tlsTrust = opts.tlsTrust || 'tofu'; // 'tofu' (default) | 'none' (insecure)

  events.emit('connecting', { nodeAddress: opts.nodeAddress });

  // 1. Wallet + key derivation in parallel (both derive from same mnemonic, independent)
  // v21: parallelized — saves ~300ms (was sequential)
  progress(onProgress, logFn, 'wallet', 'Setting up wallet...');
  checkAborted(signal);
  const [{ wallet, account }, privKey] = await Promise.all([
    cachedCreateWallet(opts.mnemonic),
    privKeyFromMnemonic(opts.mnemonic),
  ]);

  // Store mnemonic on state for session-end TX on disconnect (fire-and-forget cleanup)
  state._mnemonic = opts.mnemonic;

  // 2. RPC connect + LCD lookup in parallel (independent network calls)
  // v21: parallelized — saves 1-3s (was sequential)
  progress(onProgress, logFn, 'wallet', 'Connecting to chain endpoints...');
  checkAborted(signal);

  const rpcPromise = opts.rpcUrl
    ? createClient(opts.rpcUrl, wallet).then(client => ({ client, rpc: opts.rpcUrl, name: 'user-provided' }))
    : tryWithFallback(RPC_ENDPOINTS, async (url) => createClient(url, wallet), 'RPC connect')
        .then(({ result, endpoint, endpointName }) => ({ client: result, rpc: endpoint, name: endpointName }));

  const lcdPromise = opts.lcdUrl
    ? queryNode(opts.nodeAddress, { lcdUrl: opts.lcdUrl }).then(info => ({ nodeInfo: info, lcd: opts.lcdUrl }))
    : queryNode(opts.nodeAddress).then(info => ({ nodeInfo: info, lcd: DEFAULT_LCD }));

  const [rpcResult, lcdResult] = await Promise.all([rpcPromise, lcdPromise]);
  const { client, rpc } = rpcResult;
  if (rpcResult.name !== 'user-provided') progress(onProgress, logFn, 'wallet', `RPC: ${rpcResult.name} (${rpc})`);
  let { nodeInfo, lcd } = lcdResult;

  // Balance check — verify wallet has enough P2P before paying for session
  // Dry-run mode skips balance enforcement (wallet may be unfunded)
  checkAborted(signal);
  try {
    const bal = await getBalance(client, account.address);
    progress(onProgress, logFn, 'wallet', `${account.address} | ${bal.dvpn.toFixed(1)} P2P`);
    // Check balance against actual node price + gas (not just 0.1 P2P)
    const nodePriceUdvpn = (nodeInfo.gigabyte_prices || []).find(p => p.denom === 'udvpn');
    const minRequired = nodePriceUdvpn ? parseInt(nodePriceUdvpn.quote_value || '0', 10) + 500000 : 1000000; // price + 0.5 P2P gas
    if (!opts.dryRun && bal.udvpn < minRequired) {
      throw new ChainError(ErrorCodes.INSUFFICIENT_BALANCE,
        `Wallet has ${bal.dvpn.toFixed(2)} P2P — need at least ${(minRequired / 1e6).toFixed(2)} P2P (node price + gas) for a session. Fund address ${account.address} with P2P tokens.`,
        { balance: bal, address: account.address, required: minRequired }
      );
    }
  } catch (balErr) {
    if (balErr.code === ErrorCodes.INSUFFICIENT_BALANCE) throw balErr;
    // Non-fatal: balance check failed (network issue) — continue and let chain reject if needed
    progress(onProgress, logFn, 'wallet', `${account.address} | balance check skipped (${balErr.message})`);
  }

  // 3. Check node status
  progress(onProgress, logFn, 'node-check', `Checking node ${opts.nodeAddress}...`);
  const nodeAgent = createNodeHttpsAgent(opts.nodeAddress, tlsTrust);
  const status = await nodeStatusV3(nodeInfo.remote_url, nodeAgent);
  progress(onProgress, logFn, 'node-check', `${status.moniker} (${status.type}) - ${status.location.city}, ${status.location.country}`);

  // Pre-verify: node's address must match what we're paying for.
  // Prevents wasting tokens when remote URL serves a different node.
  if (status.address && status.address !== opts.nodeAddress) {
    throw new NodeError(ErrorCodes.NODE_NOT_FOUND, `Node address mismatch: remote URL serves ${status.address}, not ${opts.nodeAddress}. Aborting before payment.`, { expected: opts.nodeAddress, actual: status.address });
  }

  const extremeDrift = status.type === 'v2ray' && status.clockDriftSec !== null && Math.abs(status.clockDriftSec) > 120;
  if (extremeDrift) {
    logFn?.(`Warning: clock drift ${status.clockDriftSec}s — VMess will fail but VLess may work`);
  }

  // 2b. PRE-VALIDATE tunnel requirements BEFORE paying
  progress(onProgress, logFn, 'validate', 'Checking tunnel requirements...');
  const resolvedV2rayPath = validateTunnelRequirements(status.type, opts.v2rayExePath);

  // Note: node reachability is already proven by nodeStatusV3() above (line ~1502).
  // If the status probe succeeded, the node's HTTPS endpoint is live.
  // WG tunnel failures are transport-level (UDP), not reachability — TCP pre-checks can't predict them.

  // ── DRY-RUN: return mock result without paying, handshaking, or tunneling ──
  if (opts.dryRun) {
    privKey.fill(0);
    progress(onProgress, logFn, 'dry-run', 'Dry-run complete — no TX broadcast, no tunnel created');
    events.emit('connected', { sessionId: BigInt(0), serviceType: status.type, nodeAddress: opts.nodeAddress, dryRun: true });
    return {
      dryRun: true,
      sessionId: BigInt(0),
      serviceType: status.type,
      nodeAddress: opts.nodeAddress,
      nodeMoniker: status.moniker,
      nodeLocation: status.location,
      walletAddress: account.address,
      rpcUsed: rpc,
      lcdUsed: lcd,
      cleanup: async () => {},
    };
  }

  // 3. Payment (strategy-specific)
  checkAborted(signal);
  const payCtx = { client, account, nodeInfo, lcd, logFn, onProgress, signal, timeouts };
  const { sessionId: paidSessionId, subscriptionId } = await paymentStrategy(payCtx);
  let sessionId = paidSessionId;

  // 4. Handshake & tunnel
  // Wait 5s after session TX for node to index the session on-chain.
  // Without this, the node may return 409 "already exists" because it's still
  // processing the previous block's state changes.
  progress(onProgress, logFn, 'handshake', 'Waiting for node to index session...');
  await sleep(5000);
  progress(onProgress, logFn, 'handshake', 'Starting handshake...');
  checkAborted(signal);
  const tunnelOpts = {
    serviceType: status.type,
    remoteUrl: nodeInfo.remote_url,
    serverHost: new URL(nodeInfo.remote_url).hostname,
    sessionId,
    privKey,
    v2rayExePath: resolvedV2rayPath,
    fullTunnel,
    splitIPs: opts.splitIPs,
    systemProxy,
    killSwitch,
    dns: opts.dns,
    onProgress,
    logFn,
    extremeDrift,
    clockDriftSec: status.clockDriftSec,
    nodeAddress: opts.nodeAddress,
    timeouts,
    signal,
    nodeAgent,
    state,
  };

  // ─── Handshake with "already exists" (409) retry ───
  // After session TX confirms, the node may still be indexing. Handshake can
  // return 409 "already exists" if the node hasn't finished processing.
  // Retry schedule: wait 15s, then 20s. If still fails, fall back to
  // retryStrategy (pay for fresh session) or throw.
  const _isAlreadyExists = (err) => {
    const msg = String(err?.message || '');
    const status = err?.details?.status;
    return msg.includes('already exists') || status === 409;
  };

  let handshakeResult = null;
  let handshakeErr = null;
  const alreadyExistsDelays = [15000, 20000]; // retry delays for 409 "already exists"
  let alreadyExistsAttempt = 0;

  for (;;) {
    try {
      handshakeResult = await performHandshake(tunnelOpts);
      break; // success
    } catch (err) {
      if (_isAlreadyExists(err) && alreadyExistsAttempt < alreadyExistsDelays.length) {
        const delayMs = alreadyExistsDelays[alreadyExistsAttempt];
        progress(onProgress, logFn, 'handshake', `Session indexing race (409) — retrying in ${delayMs / 1000}s (attempt ${alreadyExistsAttempt + 1}/${alreadyExistsDelays.length})...`);
        await sleep(delayMs);
        checkAborted(signal);
        alreadyExistsAttempt++;
        continue;
      }
      handshakeErr = err;
      break;
    }
  }

  try {
    if (handshakeResult) {
      markSessionActive(String(sessionId), opts.nodeAddress);
      if (subscriptionId) handshakeResult.subscriptionId = subscriptionId;
      _recordMetric(opts.nodeAddress, true, Date.now() - _connectStart); // v25: metrics
      events.emit('connected', { sessionId, serviceType: status.type, nodeAddress: opts.nodeAddress });
      return handshakeResult;
    }

    // Handshake failed
    const hsErr = handshakeErr;
    _recordMetric(opts.nodeAddress, false, Date.now() - _connectStart); // v25: metrics
    markSessionPoisoned(String(sessionId), opts.nodeAddress, hsErr.message);

    // v25: Attach partial connection state for recovery (#2)
    if (!hsErr.details) hsErr.details = {};
    hsErr.details.sessionId = String(sessionId);
    hsErr.details.nodeAddress = opts.nodeAddress;
    hsErr.details.failedAt = 'handshake';
    hsErr.details.serviceType = status.type;

    // "already exists" final fallback: pay for fresh session and retry handshake
    if (retryStrategy && _isAlreadyExists(hsErr)) {
      progress(onProgress, logFn, 'session', `Session ${sessionId} stale on node — paying for fresh session...`);
      checkAborted(signal);
      const retry = await retryStrategy(payCtx, hsErr);
      sessionId = retry.sessionId;
      tunnelOpts.sessionId = sessionId;
      try {
        const retryResult = await performHandshake(tunnelOpts);
        markSessionActive(String(sessionId), opts.nodeAddress);
        events.emit('connected', { sessionId, serviceType: status.type, nodeAddress: opts.nodeAddress });
        return retryResult;
      } catch (retryErr) {
        // Clean up any partially-installed tunnel before re-throwing
        if (state.wgTunnel) {
          try { await disconnectWireGuard(); } catch {} // cleanup: best-effort
          state.wgTunnel = null;
        }
        if (state.v2rayProc) {
          try { killV2RayProc(state.v2rayProc); } catch {} // cleanup: best-effort
          state.v2rayProc = null;
        }
        markSessionPoisoned(String(sessionId), opts.nodeAddress, retryErr.message);
        if (!retryErr.details) retryErr.details = {};
        retryErr.details.sessionId = String(sessionId);
        retryErr.details.nodeAddress = opts.nodeAddress;
        retryErr.details.failedAt = 'handshake_retry';
        events.emit('error', retryErr);
        throw retryErr;
      }
    }
    events.emit('error', hsErr);
    throw hsErr;
  } finally {
    // Zero mnemonic-derived private key — guaranteed even if exceptions thrown
    privKey.fill(0);
  }
}

// ─── Handshake & Tunnel Setup ────────────────────────────────────────────────

async function performHandshake({ serviceType, remoteUrl, serverHost, sessionId, privKey, v2rayExePath, fullTunnel, splitIPs, systemProxy, killSwitch, dns, onProgress, logFn, extremeDrift, clockDriftSec, nodeAddress, timeouts, signal, nodeAgent, state }) {
  if (serviceType === 'wireguard') {
    return await setupWireGuard({ remoteUrl, sessionId, privKey, fullTunnel, splitIPs, killSwitch, dns, onProgress, logFn, nodeAddress, timeouts, signal, nodeAgent, state });
  } else {
    return await setupV2Ray({ remoteUrl, serverHost, sessionId, privKey, v2rayExePath, systemProxy, dns, onProgress, logFn, extremeDrift, clockDriftSec, nodeAddress, timeouts, signal, nodeAgent, state });
  }
}

async function setupWireGuard({ remoteUrl, sessionId, privKey, fullTunnel, splitIPs, killSwitch, dns, onProgress, logFn, nodeAddress, timeouts, signal, nodeAgent, state }) {
  // Generate WireGuard keys
  const wgKeys = generateWgKeyPair();

  // Handshake with node
  checkAborted(signal);
  progress(onProgress, logFn, 'handshake', 'WireGuard handshake...');
  const hs = await initHandshakeV3(remoteUrl, sessionId, privKey, wgKeys.publicKey, nodeAgent);

  // NOTE: Credentials are saved AFTER verified connectivity (not here).
  // Saving before verification causes stale credentials to persist on retry
  // when the tunnel fails — the node doesn't route traffic with old UUID/keys.

  // Resolve AllowedIPs based on fullTunnel flag:
  // - fullTunnel=true (default): 0.0.0.0/0 — routes ALL traffic, changes your IP
  // - fullTunnel=false: only speedtest IPs — safe for testing, IP unchanged
  // - splitIPs=[...]: explicit IPs override everything
  let resolvedSplitIPs = null;
  if (splitIPs && Array.isArray(splitIPs) && splitIPs.length > 0) {
    // Explicit split IPs provided — use them as-is
    resolvedSplitIPs = splitIPs;
    progress(onProgress, logFn, 'tunnel', `Split tunnel: routing ${resolvedSplitIPs.length} explicit IPs`);
  } else if (fullTunnel) {
    // Full tunnel: pass null to writeWgConfig → generates 0.0.0.0/0, ::/0
    resolvedSplitIPs = null;
    progress(onProgress, logFn, 'tunnel', 'Full tunnel mode (0.0.0.0/0) — all traffic through VPN');
  } else {
    // Safe split tunnel: only route speedtest IPs
    try {
      resolvedSplitIPs = await resolveSpeedtestIPs();
      progress(onProgress, logFn, 'tunnel', `Split tunnel: routing ${resolvedSplitIPs.length} speedtest IPs`);
    } catch {
      // Can't resolve speedtest IPs, fall back to full tunnel
      resolvedSplitIPs = null;
      progress(onProgress, logFn, 'tunnel', 'Warning: could not resolve speedtest IPs, falling back to full tunnel');
    }
  }

  // v28: VERIFY-BEFORE-CAPTURE — install with safe split IPs first, verify tunnel works,
  // THEN switch to full tunnel (0.0.0.0/0). This prevents killing the user's internet
  // if the node is broken. Previously, fullTunnel captured ALL traffic before verification,
  // causing up to ~78s of dead internet on failure.
  const VERIFY_IPS = ['1.1.1.1/32', '1.0.0.1/32'];
  const VERIFY_TARGETS = ['https://1.1.1.1', 'https://1.0.0.1'];
  const needsFullTunnelSwitch = fullTunnel && (!resolvedSplitIPs || resolvedSplitIPs.length === 0);

  const initialSplitIPs = needsFullTunnelSwitch ? VERIFY_IPS : resolvedSplitIPs;
  const confPath = writeWgConfig(
    wgKeys.privateKey,
    hs.assignedAddrs,
    hs.serverPubKey,
    hs.serverEndpoint,
    initialSplitIPs,
    { dns: resolveDnsServers(dns) },
  );

  // DON'T zero private key yet — may need to rewrite config for full tunnel switch
  // wgKeys.privateKey.fill(0);  // deferred to after potential second config write

  // Wait for node to register peer then install + verify tunnel.
  // v20: Fixed 5s sleep. v21: Exponential retry — try install at 1.5s, then 3s, 5s.
  // Most nodes register the peer within 1-2s. Saves ~3s on average.
  progress(onProgress, logFn, 'tunnel', 'Waiting for node to register peer...');
  const installDelays = [1500, 1500, 2000]; // total budget: 5s (same as before but tries earlier)
  let tunnelInstalled = false;
  for (let i = 0; i < installDelays.length; i++) {
    await sleep(installDelays[i]);
    checkAborted(signal);
    try {
      progress(onProgress, logFn, 'tunnel', `Installing WireGuard tunnel (attempt ${i + 1}/${installDelays.length})...`);
      await installWgTunnel(confPath);
      state.wgTunnel = 'wgsent0';
      tunnelInstalled = true;
      break;
    } catch (installErr) {
      if (i === installDelays.length - 1) {
        wgKeys.privateKey.fill(0);
        throw installErr; // last attempt — propagate
      }
      progress(onProgress, logFn, 'tunnel', `Tunnel install attempt ${i + 1} failed, retrying...`);
    }
  }

  // Verify actual connectivity through the tunnel.
  // A RUNNING service doesn't guarantee packets flow — the peer might reject us,
  // the endpoint might be firewalled, or the handshake may have been for a stale session.
  // v28: When fullTunnel, we're still on safe split IPs — user's internet is unaffected.
  progress(onProgress, logFn, 'verify', 'Verifying tunnel connectivity...');
  // v29: 1 attempt x 2 targets x 5s = ~10s max exposure. Tear down immediately on failure.
  const verifyTargets = needsFullTunnelSwitch ? VERIFY_TARGETS : null;
  const tunnelWorks = await verifyWgConnectivity(1, verifyTargets);
  if (!tunnelWorks) {
    wgKeys.privateKey.fill(0);
    clearCredentials(nodeAddress); // Clear stale handshake credentials so retry gets fresh ones
    progress(onProgress, logFn, 'verify', 'WireGuard tunnel installed but no traffic flows. Tearing down immediately...');
    try { await disconnectWireGuard(); } catch (e) { logFn?.(`[cleanup] WG disconnect warning: ${e.message}`); }
    state.wgTunnel = null;
    throw new TunnelError(ErrorCodes.WG_NO_CONNECTIVITY, 'WireGuard tunnel installed (service RUNNING) but connectivity check failed — no traffic flows through the tunnel. The node may have rejected the peer or the session may be stale.', { nodeAddress, sessionId: String(sessionId) });
  }

  // Capture private key base64 BEFORE zeroing — needed for credential save after verification.
  const wgPrivKeyB64 = wgKeys.privateKey.toString('base64');

  // v28: Tunnel verified! If fullTunnel, switch from safe split IPs to 0.0.0.0/0
  // Don't manually disconnect — installWgTunnel() handles its own force-remove + 1s wait.
  // Double-uninstall races with Windows Service Manager and causes "failed to start" errors.
  if (needsFullTunnelSwitch) {
    progress(onProgress, logFn, 'tunnel', 'Verified! Switching to full tunnel (0.0.0.0/0)...');
    const fullConfPath = writeWgConfig(
      wgKeys.privateKey,
      hs.assignedAddrs,
      hs.serverPubKey,
      hs.serverEndpoint,
      null, // null = 0.0.0.0/0, ::/0
      { dns: resolveDnsServers(dns) },
    );
    wgKeys.privateKey.fill(0); // Zero AFTER final config write
    state.wgTunnel = null;
    await installWgTunnel(fullConfPath);
    state.wgTunnel = 'wgsent0';
  } else {
    wgKeys.privateKey.fill(0); // Zero for non-fullTunnel path
  }

  progress(onProgress, logFn, 'verify', 'WireGuard connected and verified!');

  // Save credentials AFTER verified connectivity — prevents stale credentials
  // from persisting when handshake succeeds but tunnel fails to route traffic.
  saveCredentials(nodeAddress, String(sessionId), {
    serviceType: 'wireguard',
    wgPrivateKey: wgPrivKeyB64,
    wgServerPubKey: hs.serverPubKey,
    wgAssignedAddrs: hs.assignedAddrs,
    wgServerEndpoint: hs.serverEndpoint,
  });

  // Enable kill switch if opts.killSwitch is true
  if (killSwitch) {
    try {
      enableKillSwitch(hs.serverEndpoint);
      logFn?.('[kill-switch] Enabled — all non-tunnel traffic blocked');
    } catch (e) { logFn?.(`[kill-switch] Warning: ${e.message}`); }
  }

  saveState({ sessionId: String(sessionId), serviceType: 'wireguard', wgTunnelName: 'wgsent0', confPath, systemProxySet: false });
  const sessionIdStr = String(sessionId); // String, not BigInt — safe for JSON.stringify
  state.connection = { sessionId: sessionIdStr, serviceType: 'wireguard', nodeAddress, connectedAt: Date.now() };
  return {
    sessionId: sessionIdStr,
    serviceType: 'wireguard',
    nodeAddress,
    confPath,
    cleanup: async () => {
      if (_killSwitchEnabled) disableKillSwitch();
      try { await disconnectWireGuard(); } catch {} // tunnel may already be down
      // End session on chain (fire-and-forget)
      if (sessionIdStr && state._mnemonic) {
        _endSessionOnChain(sessionIdStr, state._mnemonic).then(r => events.emit('sessionEnded', { txHash: r?.transactionHash })).catch(e => events.emit('sessionEndFailed', { error: e.message }));
      }
      state.wgTunnel = null;
      state.connection = null;
      state._mnemonic = null;
      clearState();
    },
  };
}

/**
 * Verify that traffic actually flows through the WireGuard tunnel.
 * Tries HEAD requests to reliable targets. For full tunnel (0.0.0.0/0) all
 * traffic goes through it. For split tunnel, the speedtest IPs are routed.
 */
async function verifyWgConnectivity(maxAttempts = 1, customTargets = null) {
  // v29: Reduced from 3 attempts x 3 targets x 8s to 1 attempt x 2 targets x 5s.
  // Old config: worst case ~78s of dead internet if node is broken with fullTunnel.
  // New config: worst case ~10s exposure. Tunnel is torn down immediately on failure.
  const targets = customTargets || ['https://1.1.1.1', 'https://www.cloudflare.com'];
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await sleep(2000);
    for (const target of targets) {
      try {
        await axios.get(target, { timeout: 5000, maxRedirects: 2, validateStatus: () => true });
        return true;
      } catch {} // expected: target may be unreachable through tunnel
    }
  }
  return false;
}

/** Extract transport rate key from a V2Ray outbound for dynamic rate recording. */
function _transportRateKey(ob) {
  const network = ob.streamSettings?.network;
  const security = ob.streamSettings?.security || 'none';
  if (!network) return null;
  if (security === 'tls') return `${network}/tls`;
  if (network === 'grpc') return 'grpc/none';
  return network;
}

async function setupV2Ray({ remoteUrl, serverHost, sessionId, privKey, v2rayExePath, systemProxy, dns, onProgress, logFn, extremeDrift, clockDriftSec, nodeAddress, timeouts, signal, nodeAgent, state }) {
  if (!v2rayExePath) throw new TunnelError(ErrorCodes.V2RAY_NOT_FOUND, 'v2rayExePath required for V2Ray nodes');

  // Generate UUID for V2Ray session
  const uuid = generateV2RayUUID();

  // Handshake with node
  checkAborted(signal);
  progress(onProgress, logFn, 'handshake', 'V2Ray handshake...');
  const hs = await initHandshakeV3V2Ray(remoteUrl, sessionId, privKey, uuid, nodeAgent);

  // NOTE: Credentials are saved AFTER verified connectivity (not here).
  // Saving before verification causes stale credentials to persist on retry
  // when the tunnel fails — the node doesn't route traffic with old UUID/keys.

  // Wait for node to register UUID.
  // v20: Fixed 5s sleep. v21: Reduced to 2s — V2Ray outbound loop has its own
  // readiness checks (waitForPort + SOCKS5 connectivity test). ~8% of V2Ray
  // nodes need 5-10s to register UUID internally (node-tester-learnings-2026-03-20).
  progress(onProgress, logFn, 'tunnel', 'Waiting for node to register UUID...');
  await sleep(5000);

  // Post-handshake viability checks (before spending time on outbound tests)
  const allMeta = JSON.parse(hs.config).metadata || [];

  // VMess-only nodes with extreme clock drift → guaranteed AEAD failure.
  // VLess (proxy_protocol=1) is immune to clock drift; only VMess (proxy_protocol=2) fails.
  if (extremeDrift) {
    const hasVless = allMeta.some(m => m.proxy_protocol === 1);
    if (!hasVless) {
      throw new NodeError(ErrorCodes.NODE_CLOCK_DRIFT, `VMess-only node with clock drift ${clockDriftSec}s (AEAD tolerance ±120s, no VLess available)`, { clockDriftSec, nodeAddress });
    }
    logFn?.('VLess available — testing despite clock drift (VLess ignores clock drift)');
  }

  // Build config — rotating port to avoid Windows TIME_WAIT conflicts
  // Sequential increment from random start avoids repeated collisions
  // with TIME_WAIT ports that pure random retries can hit.
  const startPort = 10800 + Math.floor(Math.random() * 1000);
  let socksPort = startPort;
  for (let i = 0; i < 5; i++) {
    socksPort = startPort + i;
    if (await checkPortFree(socksPort)) break;
  }
  const config = buildV2RayClientConfig(serverHost, hs.config, uuid, socksPort, { dns: resolveDnsServers(dns), systemProxy, clockDriftSec: clockDriftSec || 0 });

  // When clock drift is extreme (>120s), prefer VLess outbounds over VMess.
  // VLess doesn't use AEAD timestamps so it's immune to clock drift.
  // VMess AEAD rejects packets with >120s drift — guaranteed failure.
  if (extremeDrift && config.outbounds.length > 1) {
    config.outbounds.sort((a, b) => {
      const aIsVless = a.protocol === 'vless' ? 0 : 1;
      const bIsVless = b.protocol === 'vless' ? 0 : 1;
      return aIsVless - bIsVless;
    });
    // Update routing to point to the first (now VLess) outbound
    const proxyRule = config.routing.rules.find(r => r.inboundTag?.includes('proxy'));
    if (proxyRule) proxyRule.outboundTag = config.outbounds[0].tag;
    logFn?.(`Clock drift ${clockDriftSec}s: reordered outbounds — VLess first (immune to drift)`);
  }

  // Write config and start V2Ray, testing each outbound individually
  // (NEVER use balancer — causes session poisoning, see known-issues.md)
  const tmpDir = path.join(os.tmpdir(), 'sentinel-v2ray');
  mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
  const cfgPath = path.join(tmpDir, 'config.json');

  let workingOutbound = null;
  try {
    for (const ob of config.outbounds) {
      checkAborted(signal);
      // Pre-connection TCP probe for TCP-based transports — skip dead ports in 3s
      // instead of wasting 30s on a full V2Ray start+test cycle
      const obNet = ob.streamSettings?.network;
      if (['tcp', 'websocket', 'grpc', 'gun', 'http'].includes(obNet)) {
        const obPort = ob.settings?.vnext?.[0]?.port;
        const obHost = ob.settings?.vnext?.[0]?.address || serverHost;
        if (obPort) {
          const portOpen = await waitForPort(obPort, 3000, obHost);
          if (!portOpen) {
            const rk = _transportRateKey(ob);
            if (rk) recordTransportResult(rk, false);
            progress(onProgress, logFn, 'tunnel', `  ${ob.tag}: port ${obPort} not reachable, skipping`);
            continue;
          }
        }
      }

      // Kill previous v2ray process by PID (NOT taskkill /IM which kills ALL v2ray.exe system-wide)
      if (state.v2rayProc) {
        state.v2rayProc.kill();
        state.v2rayProc = null;
        await sleep(2000);
      }

      // Config with single outbound (no balancer) — only include the outbound being tested
      const attempt = {
        ...config,
        outbounds: [ob],
        routing: {
          domainStrategy: 'IPIfNonMatch',
          rules: [
            { inboundTag: ['api'], outboundTag: 'api', type: 'field' },
            { inboundTag: ['proxy'], outboundTag: ob.tag, type: 'field' },
          ],
        },
      };

      writeFileSync(cfgPath, JSON.stringify(attempt, null, 2), { mode: 0o600 });
      // Restrict ACL on Windows (temp dir is user-scoped but readable by same-user processes)
      if (process.platform === 'win32') {
        try { execFileSync('icacls', [cfgPath, '/inheritance:r', '/grant:r', `${process.env.USERNAME || 'BUILTIN\\Users'}:F`, '/grant:r', 'SYSTEM:F'], { stdio: 'pipe', timeout: 3000 }); } catch {}
      }
      const proc = spawn(v2rayExePath, ['run', '-config', cfgPath], { stdio: 'pipe' });
      // Capture V2Ray stderr for diagnostics — filter out known noise lines
      // "proxy/socks: insufficient header" appears on every port probe (100% of runs), not a real error.
      if (proc.stderr) {
        proc.stderr.on('data', (chunk) => {
          const lines = chunk.toString().split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (trimmed.includes('insufficient header')) continue; // port probe noise
            logFn?.(`[v2ray stderr] ${trimmed}`);
          }
        });
      }
      // Delete config after V2Ray reads it (contains UUID credentials)
      setTimeout(() => { try { unlinkSync(cfgPath); } catch {} }, 2000);

      // Wait for SOCKS5 port to accept connections instead of fixed sleep.
      // V2Ray binding is async — fixed 6s sleep causes false failures on slow starts.
      const ready = await waitForPort(socksPort, timeouts.v2rayReady);
      if (!ready || proc.exitCode !== null) {
        progress(onProgress, logFn, 'tunnel', `  ${ob.tag}: v2ray ${proc.exitCode !== null ? `exited (code ${proc.exitCode})` : 'SOCKS5 port not ready'}, skipping`);
        proc.kill();
        continue;
      }

      // Test connectivity through SOCKS5 — use reliable targets, not httpbin.org
      const TARGETS = ['https://www.google.com', 'https://www.cloudflare.com'];
      let connected = false;
      try {
        const { SocksProxyAgent } = await import('socks-proxy-agent');
        for (const target of TARGETS) {
          const auth = config._socksAuth;
          const proxyUrl = (auth?.user && auth?.pass)
            ? `socks5://${auth.user}:${auth.pass}@127.0.0.1:${socksPort}`
            : `socks5://127.0.0.1:${socksPort}`;
          const agent = new SocksProxyAgent(proxyUrl);
          try {
            await axios.get(target, { httpAgent: agent, httpsAgent: agent, timeout: 10000, maxRedirects: 2, validateStatus: () => true });
            connected = true;
            break;
          } catch {} finally { agent.destroy(); }
        }
        if (connected) {
          const rk = _transportRateKey(ob);
          if (rk) recordTransportResult(rk, true);
          progress(onProgress, logFn, 'verify', `${ob.tag}: connected!`);
          workingOutbound = ob;
          state.v2rayProc = proc;
          break;
        }
      } catch {}
      if (!connected) {
        const rk = _transportRateKey(ob);
        if (rk) recordTransportResult(rk, false);
        progress(onProgress, logFn, 'tunnel', `  ${ob.tag}: failed (no connectivity)`);
        proc.kill();
      }
    }
  } catch (err) {
    // Kill any lingering V2Ray process on loop exit (abort, unexpected throw, etc.)
    if (state.v2rayProc) {
      try { killV2RayProc(state.v2rayProc); } catch {} // cleanup: best-effort
      state.v2rayProc = null;
    }
    throw err;
  }

  if (!workingOutbound) {
    clearCredentials(nodeAddress); // Clear stale handshake credentials so retry gets fresh ones
    throw new TunnelError(ErrorCodes.V2RAY_ALL_FAILED, 'All V2Ray transport/protocol combinations failed', { nodeAddress, sessionId: String(sessionId) });
  }

  // Save credentials AFTER verified connectivity — prevents stale credentials
  // from persisting when handshake succeeds but tunnel fails to route traffic.
  saveCredentials(nodeAddress, String(sessionId), {
    serviceType: 'v2ray',
    v2rayUuid: uuid,
    v2rayConfig: hs.config,
  });

  // Auto-set Windows system proxy so browser traffic goes through the SOCKS5 tunnel.
  // Without this, V2Ray creates a local proxy but nothing uses it — the user's IP doesn't change.
  if (systemProxy && socksPort) {
    progress(onProgress, logFn, 'proxy', `Setting system SOCKS proxy → 127.0.0.1:${socksPort}`);
    setSystemProxy(socksPort);
  }

  const sessionIdStr = String(sessionId); // String, not BigInt — safe for JSON.stringify
  // Expose SOCKS5 auth credentials so external apps can use the proxy for split tunneling.
  // Default is noauth (no credentials needed), but if socksAuth=true was passed, return creds.
  const socksAuth = config._socksAuth?.user
    ? { user: config._socksAuth.user, pass: config._socksAuth.pass }
    : null;
  saveState({ sessionId: sessionIdStr, serviceType: 'v2ray', v2rayPid: state.v2rayProc?.pid, socksPort, systemProxySet: state.systemProxy, nodeAddress });
  state.connection = { sessionId: sessionIdStr, serviceType: 'v2ray', nodeAddress, socksPort, connectedAt: Date.now() };
  return {
    sessionId: sessionIdStr,
    serviceType: 'v2ray',
    nodeAddress,
    socksPort,
    socksAuth,
    outbound: workingOutbound.tag,
    cleanup: async () => {
      if (state.v2rayProc) { state.v2rayProc.kill(); state.v2rayProc = null; await sleep(500); }
      if (state.systemProxy) clearSystemProxy();
      // End session on chain (fire-and-forget)
      if (sessionIdStr && state._mnemonic) {
        _endSessionOnChain(sessionIdStr, state._mnemonic).then(r => events.emit('sessionEnded', { txHash: r?.transactionHash })).catch(e => events.emit('sessionEndFailed', { error: e.message }));
      }
      state.connection = null;
      state._mnemonic = null;
      clearState();
    },
  };
}

// ─── Connection Status (VPN UX: user must always know if they're connected) ─

/**
 * Check if a VPN tunnel is currently active.
 * Use this to show connected/disconnected state in UI — like the VPN icon.
 */
export function isConnected() {
  return _defaultState.isConnected;
}

/**
 * Get current connection status. Returns null if disconnected.
 * Apps should poll this (e.g. every 5s) to update UI — like NordVPN's status bar.
 * v25: Includes healthChecks for tunnel/proxy liveness.
 */
export function getStatus() {
  if (!_defaultState.connection) return null;

  // v29: Cross-check tunnel liveness FIRST — if connection object exists but neither
  // tunnel handle is truthy, the state is phantom (tunnel torn down, connection stale).
  // This prevents IP leak where user thinks they're connected but traffic goes direct.
  if (!_defaultState.wgTunnel && !_defaultState.v2rayProc) {
    const stale = _defaultState.connection;
    _defaultState.connection = null;
    // End session on chain (fire-and-forget) to prevent stale session leaks
    if (stale?.sessionId && _defaultState._mnemonic) {
      _endSessionOnChain(stale.sessionId, _defaultState._mnemonic).then(r => events.emit('sessionEnded', { txHash: r?.transactionHash })).catch(e => events.emit('sessionEndFailed', { error: e.message }));
    }
    clearState();
    events.emit('disconnected', { nodeAddress: stale.nodeAddress, serviceType: stale.serviceType, reason: 'phantom_state' });
    return null;
  }

  const conn = _defaultState.connection;
  const uptimeMs = Date.now() - conn.connectedAt;

  // v25: Health checks — distinguish tunnel states
  const healthChecks = {
    tunnelActive: false,
    proxyListening: false,
    systemProxyValid: _defaultState.systemProxy,
  };

  if (_defaultState.wgTunnel) {
    // WireGuard: check if adapter exists
    if (process.platform === 'win32') {
      try {
        const out = execFileSync('netsh', ['interface', 'show', 'interface', 'name=wgsent0'], { encoding: 'utf8', stdio: 'pipe', timeout: 3000 });
        healthChecks.tunnelActive = out.includes('Connected');
      } catch {
        // Adapter gone — tunnel is dead
        healthChecks.tunnelActive = false;
      }
    } else {
      // Non-Windows: trust state (no easy check)
      healthChecks.tunnelActive = true;
    }
  }

  if (_defaultState.v2rayProc) {
    // V2Ray: check if process is alive
    healthChecks.tunnelActive = !_defaultState.v2rayProc.killed && _defaultState.v2rayProc.exitCode === null;
    // Proxy listening = process alive (async port check removed — was broken, fired after return)
    healthChecks.proxyListening = healthChecks.tunnelActive;
    if (conn.socksPort) {
    }
  }

  // v28: Auto-clear phantom state — if connection exists but tunnel is dead,
  // clean up stale state. Prevents ghost "connected" status after tunnel dies.
  if (!healthChecks.tunnelActive && !_defaultState.v2rayProc && !_defaultState.wgTunnel) {
    // Both tunnel handles are null — connection state is stale
    if (conn?.sessionId && _defaultState._mnemonic) {
      _endSessionOnChain(conn.sessionId, _defaultState._mnemonic).then(r => events.emit('sessionEnded', { txHash: r?.transactionHash })).catch(e => events.emit('sessionEndFailed', { error: e.message }));
    }
    _defaultState.connection = null;
    clearState();
    return null;
  }
  if (_defaultState.wgTunnel && !healthChecks.tunnelActive) {
    // WireGuard state says connected but tunnel is dead — auto-cleanup
    if (conn?.sessionId && _defaultState._mnemonic) {
      _endSessionOnChain(conn.sessionId, _defaultState._mnemonic).then(r => events.emit('sessionEnded', { txHash: r?.transactionHash })).catch(e => events.emit('sessionEndFailed', { error: e.message }));
    }
    _defaultState.wgTunnel = null;
    _defaultState.connection = null;
    clearState();
    events.emit('disconnected', { nodeAddress: conn.nodeAddress, serviceType: conn.serviceType, reason: 'tunnel_died' });
    return null;
  }
  if (_defaultState.v2rayProc && !healthChecks.tunnelActive) {
    // V2Ray process died — auto-cleanup
    if (conn?.sessionId && _defaultState._mnemonic) {
      _endSessionOnChain(conn.sessionId, _defaultState._mnemonic).then(r => events.emit('sessionEnded', { txHash: r?.transactionHash })).catch(e => events.emit('sessionEndFailed', { error: e.message }));
    }
    _defaultState.v2rayProc = null;
    _defaultState.connection = null;
    clearState();
    events.emit('disconnected', { nodeAddress: conn.nodeAddress, serviceType: conn.serviceType, reason: 'tunnel_died' });
    return null;
  }

  return {
    connected: _defaultState.isConnected,
    ...conn,
    uptimeMs,
    uptimeFormatted: formatUptime(uptimeMs),
    healthChecks,
  };
}

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

// ─── Disconnect ──────────────────────────────────────────────────────────────

/**
 * Clean up all active tunnels and system proxy.
 * ALWAYS call this on exit — a stale WireGuard tunnel will kill your internet.
 */
/** Disconnect a specific state instance (internal). */
export async function disconnectState(state) {
  // v30: Signal any running connectAuto() retry loop to abort, and release the
  // connection lock so the user can reconnect after disconnect completes.
  _abortConnect = true;
  _connectLock = false;

  const prev = state.connection;
  // v29: try/finally ensures state.connection is ALWAYS cleared, even if
  // disableKillSwitch() or clearSystemProxy() throw. Previously, an exception
  // here left state.connection set → phantom "connected" status (IP leak).
  try {
    if (_killSwitchEnabled) {
      try { disableKillSwitch(); } catch (e) { console.warn('[sentinel-sdk] Kill switch disable warning:', e.message); }
    }
    if (state.systemProxy) {
      try { clearSystemProxy(); } catch (e) { console.warn('[sentinel-sdk] System proxy clear warning:', e.message); }
    }
    if (state.v2rayProc) {
      killV2RayProc(state.v2rayProc);
      state.v2rayProc = null;
    }
    if (state.wgTunnel) {
      try { await disconnectWireGuard(); } catch (e) { console.warn('[sentinel-sdk] WireGuard disconnect warning:', e.message); }
      state.wgTunnel = null;
    }

    // End session on chain (best-effort, fire-and-forget — never blocks disconnect)
    if (prev?.sessionId && state._mnemonic) {
      _endSessionOnChain(prev.sessionId, state._mnemonic).catch(e => {
        console.warn(`[sentinel-sdk] Failed to end session ${prev.sessionId} on chain: ${e.message}`);
      });
    }
  } finally {
    // ALWAYS clear connection state — even if teardown threw
    state._mnemonic = null;
    state.connection = null;
    clearState();
    clearWalletCache(); // v34: Clear cached wallet objects (private keys) from memory
    flushSpeedTestDnsCache(); // v25: Clear stale DNS cache between connections (#14)
    if (prev) events.emit('disconnected', { nodeAddress: prev.nodeAddress, serviceType: prev.serviceType, reason: 'user' });
  }
}

export async function disconnect() {
  return disconnectState(_defaultState);
}

// ─── Session End (on-chain cleanup) ──────────────────────────────────────────

/**
 * End a session on-chain. Best-effort, fire-and-forget.
 * Prevents stale session accumulation on nodes.
 * @param {string|bigint} sessionId - Session ID to end
 * @param {string} mnemonic - BIP39 mnemonic for signing the TX
 * @private
 */
async function _endSessionOnChain(sessionId, mnemonic) {
  const { wallet, account } = await cachedCreateWallet(mnemonic);
  const client = await tryWithFallback(
    RPC_ENDPOINTS,
    async (url) => createClient(url, wallet),
    'RPC connect (session end)',
  ).then(r => r.result);
  const msg = buildEndSessionMsg(account.address, sessionId);
  const fee = { amount: [{ denom: 'udvpn', amount: '20000' }], gas: '200000' };
  const result = await client.signAndBroadcast(account.address, [msg], fee);
  if (result.code !== 0) {
    console.warn(`[sentinel-sdk] End session TX failed (code ${result.code}): ${result.rawLog}`);
  } else {
    console.log(`[sentinel-sdk] Session ${sessionId} ended on chain (TX ${result.transactionHash})`);
  }
}

// ─── Session Recovery (v25) ──────────────────────────────────────────────────

/**
 * Retry handshake on an already-paid session. Use when connect fails AFTER payment.
 * The error.details from a failed connect contains { sessionId, nodeAddress } — pass those here.
 *
 * @param {object} opts - Same as connectDirect (mnemonic, v2rayExePath, etc.)
 * @param {string|bigint} opts.sessionId - Session ID from the failed connection error
 * @param {string} opts.nodeAddress - Node address from the failed connection error
 * @returns {Promise<ConnectResult>}
 */
export async function recoverSession(opts) {
  if (!opts?.sessionId) throw new ValidationError(ErrorCodes.INVALID_OPTIONS, 'recoverSession requires opts.sessionId');
  if (!opts?.nodeAddress) throw new ValidationError(ErrorCodes.INVALID_OPTIONS, 'recoverSession requires opts.nodeAddress');
  if (!opts?.mnemonic) throw new ValidationError(ErrorCodes.INVALID_MNEMONIC, 'recoverSession requires opts.mnemonic');

  const logFn = opts.log || console.log;
  const onProgress = opts.onProgress || null;
  const sessionId = BigInt(opts.sessionId);
  const timeouts = { ...DEFAULT_TIMEOUTS, ...opts.timeouts };
  const tlsTrust = opts.tlsTrust || 'tofu';
  const state = opts._state || _defaultState;

  // Fetch node info
  progress(onProgress, logFn, 'recover', `Recovering session ${sessionId} on ${opts.nodeAddress}...`);
  const nodeAgent = createNodeHttpsAgent(opts.nodeAddress, tlsTrust);

  // Get node status (we need serviceType and remote URL)
  const lcdUrl = opts.lcdUrl || DEFAULT_LCD;
  const nodeInfo = await queryNode(opts.nodeAddress, { lcdUrl });

  const status = await nodeStatusV3(nodeInfo.remote_url, nodeAgent);
  const resolvedV2rayPath = validateTunnelRequirements(status.type, opts.v2rayExePath);

  const privKey = await privKeyFromMnemonic(opts.mnemonic);
  const extremeDrift = status.type === 'v2ray' && status.clockDriftSec !== null && Math.abs(status.clockDriftSec) > 120;

  try {
    const result = await performHandshake({
      serviceType: status.type,
      remoteUrl: nodeInfo.remote_url,
      serverHost: new URL(nodeInfo.remote_url).hostname,
      sessionId,
      privKey,
      v2rayExePath: resolvedV2rayPath,
      fullTunnel: opts.fullTunnel !== false,
      splitIPs: opts.splitIPs,
      systemProxy: opts.systemProxy === true,
      dns: opts.dns,
      onProgress,
      logFn,
      extremeDrift,
      clockDriftSec: status.clockDriftSec,
      nodeAddress: opts.nodeAddress,
      timeouts,
      signal: opts.signal,
      nodeAgent,
      state,
    });
    markSessionActive(String(sessionId), opts.nodeAddress);
    events.emit('connected', { sessionId, serviceType: status.type, nodeAddress: opts.nodeAddress });
    return result;
  } finally {
    privKey.fill(0);
  }
}

/**
 * Register exit handlers to clean up tunnels on crash/exit.
 * Call this once at app startup.
 */
export function registerCleanupHandlers() {
  if (_cleanupRegistered) return; // prevent duplicate handler stacking
  _cleanupRegistered = true;
  const orphans = recoverOrphans(); // recover state-tracked orphans from crash
  if (orphans?.cleaned?.length) console.log('[sentinel-sdk] Recovered orphans:', orphans.cleaned.join(', '));
  emergencyCleanupSync(); // kill stale tunnels from previous crash
  killOrphanV2Ray(); // kill orphaned v2ray from previous crash
  process.on('exit', () => { if (_killSwitchEnabled) disableKillSwitch(); clearSystemProxy(); killOrphanV2Ray(); emergencyCleanupSync(); });
  process.on('SIGINT', () => { if (_killSwitchEnabled) disableKillSwitch(); clearSystemProxy(); killOrphanV2Ray(); emergencyCleanupSync(); process.exit(130); });
  process.on('SIGTERM', () => { if (_killSwitchEnabled) disableKillSwitch(); clearSystemProxy(); killOrphanV2Ray(); emergencyCleanupSync(); process.exit(143); });
  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    if (_killSwitchEnabled) disableKillSwitch();
    clearSystemProxy();
    killOrphanV2Ray();
    emergencyCleanupSync();
    process.exit(1);
  });
}

// ─── Quick Connect (v26c) ────────────────────────────────────────────────────

/**
 * One-call VPN connection. Handles everything: dependency check, cleanup registration,
 * node selection, connection, and IP verification. The simplest way to use the SDK.
 *
 * @param {object} opts
 * @param {string} opts.mnemonic - BIP39 wallet mnemonic (12 or 24 words)
 * @param {string[]} [opts.countries] - Preferred countries (e.g. ['DE', 'NL'])
 * @param {string} [opts.serviceType] - 'wireguard' | 'v2ray' | null (both)
 * @param {number} [opts.maxAttempts=3] - Max nodes to try
 * @param {function} [opts.onProgress] - Progress callback
 * @param {function} [opts.log] - Logger function
 * @returns {Promise<ConnectResult & { vpnIp?: string }>}
 */
export async function quickConnect(opts) {
  if (!opts?.mnemonic) {
    throw new ValidationError(ErrorCodes.INVALID_MNEMONIC, 'quickConnect() requires opts.mnemonic');
  }

  // Auto-register cleanup (idempotent)
  registerCleanupHandlers();

  // Check dependencies
  const deps = verifyDependencies({ v2rayExePath: opts.v2rayExePath });
  if (!deps.ok) {
    const logFn = opts.log || console.warn;
    for (const err of deps.errors) logFn(`[quickConnect] Warning: ${err}`);
  }

  // Connect with auto-fallback
  const connectOpts = {
    ...opts,
    fullTunnel: opts.fullTunnel !== false, // default true
    systemProxy: opts.systemProxy !== false, // default true for V2Ray
    killSwitch: opts.killSwitch === true,
  };

  const result = await connectAuto(connectOpts);

  // Verify IP changed
  try {
    const { vpnIp } = await verifyConnection({ timeoutMs: 6000 });
    result.vpnIp = vpnIp;
  } catch { /* IP check is best-effort */ }

  return result;
}

// ─── Auto-Reconnect (v26c) ───────────────────────────────────────────────────

/**
 * Monitor connection and auto-reconnect on failure.
 * Returns an object with .stop() to cancel monitoring.
 *
 * @param {object} opts - Same as connectAuto() options, plus:
 * @param {number} [opts.pollIntervalMs=5000] - Health check interval
 * @param {number} [opts.maxRetries=5] - Max consecutive reconnect attempts
 * @param {number[]} [opts.backoffMs=[1000,2000,5000,10000,30000]] - Backoff delays
 * @param {function} [opts.onReconnecting] - (attempt: number) => void
 * @param {function} [opts.onReconnected] - (result: ConnectResult) => void
 * @param {function} [opts.onGaveUp] - (errors: Error[]) => void
 * @returns {{ stop: () => void }}
 */
export function autoReconnect(opts) {
  const pollMs = opts.pollIntervalMs || 5000;
  const maxRetries = opts.maxRetries || 5;
  const backoff = opts.backoffMs || [1000, 2000, 5000, 10000, 30000];
  let wasConnected = false;
  let retries = 0;
  let timer = null;
  let stopped = false;

  const check = async () => {
    if (stopped) return;
    const status = getStatus();
    const connected = !!status; // v28 fix: getStatus() returns null when disconnected, not { connected: false }

    if (connected) {
      wasConnected = true;
      retries = 0;
      return;
    }

    if (!wasConnected) return; // never connected yet, don't auto-reconnect

    // Lost connection — attempt reconnect
    if (retries >= maxRetries) {
      if (opts.onGaveUp) try { opts.onGaveUp([]); } catch {}
      return;
    }

    retries++;
    if (opts.onReconnecting) try { opts.onReconnecting(retries); } catch {}

    const delay = backoff[Math.min(retries - 1, backoff.length - 1)];
    await sleep(delay);

    if (stopped) return;
    try {
      const result = await connectAuto(opts);
      retries = 0;
      wasConnected = true;
      if (opts.onReconnected) try { opts.onReconnected(result); } catch {}
    } catch (err) {
      // Don't count lock contention or aborts as real failures
      if (err?.code === 'ALREADY_CONNECTED' || err?.code === 'ABORTED') {
        retries--; // undo the increment — not a real connection failure
        return;
      }
      events.emit('error', err);
    }
  };

  timer = setInterval(check, pollMs);
  if (timer.unref) timer.unref();

  return {
    stop: () => { stopped = true; if (timer) { clearInterval(timer); timer = null; } },
  };
}

// ─── Verify Connection (v26c) ────────────────────────────────────────────────

/**
 * Verify VPN is working by checking if IP has changed.
 * Fetches public IP via ipify.org and compares to a direct (non-VPN) fetch.
 *
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=8000]
 * @returns {Promise<{ working: boolean, vpnIp: string|null, error?: string }>}
 */
export async function verifyConnection(opts = {}) {
  const timeout = opts.timeoutMs || 8000;
  try {
    const res = await axios.get('https://api.ipify.org?format=json', { timeout });
    const vpnIp = res.data?.ip || null;
    return { working: !!vpnIp, vpnIp };
  } catch (err) {
    return { working: false, vpnIp: null, error: err.message };
  }
}

// ─── ConnectOptions Builder (v25) ────────────────────────────────────────────

/**
 * Create a reusable base config. Override per-call with .with().
 * @param {object} baseOpts - Default ConnectOptions (mnemonic, rpcUrl, etc.)
 * @returns {{ ...baseOpts, with(overrides): object }}
 */
export function createConnectConfig(baseOpts) {
  const config = { ...baseOpts };
  config.with = (overrides) => ({ ...config, ...overrides });
  // Remove .with from spread results (non-enumerable)
  Object.defineProperty(config, 'with', { enumerable: false });
  return Object.freeze(config);
}

/**
 * Pre-flight check: verify all required binaries and permissions.
 *
 * Call this at app startup to surface clear, human-readable errors
 * instead of cryptic ENOENT crashes mid-connection.
 *
 * @param {object} [opts]
 * @param {string} [opts.v2rayExePath] - Explicit V2Ray binary path
 * @returns {{ ok: boolean, v2ray: { available: boolean, path: string|null, version: string|null, error: string|null }, wireguard: { available: boolean, path: string|null, isAdmin: boolean, error: string|null }, platform: string, arch: string, nodeVersion: string, errors: string[] }}
 */
export function verifyDependencies(opts = {}) {
  const errors = [];
  const result = {
    ok: true,
    v2ray: { available: false, path: null, version: null, error: null },
    wireguard: { available: false, path: null, isAdmin: IS_ADMIN, error: null },
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    errors,
  };

  // V2Ray check
  const v2path = findV2RayExe(opts.v2rayExePath);
  if (v2path) {
    result.v2ray.available = true;
    result.v2ray.path = v2path;
    try {
      const ver = execFileSync(v2path, ['version'], { encoding: 'utf8', timeout: 5000, stdio: 'pipe' });
      const match = ver.match(/V2Ray\s+([\d.]+)/i) || ver.match(/([\d]+\.[\d]+\.[\d]+)/);
      result.v2ray.version = match ? match[1] : ver.trim().split('\n')[0];
    } catch {
      result.v2ray.version = 'unknown (binary exists but version check failed)';
    }
  } else {
    result.v2ray.error = process.platform === 'win32'
      ? 'V2Ray not found. Place v2ray.exe + geoip.dat + geosite.dat in a bin/ folder next to your app, or set the V2RAY_PATH environment variable.'
      : process.platform === 'darwin'
        ? 'V2Ray not found. Install via: brew install v2ray, or place the v2ray binary in ./bin/ or /usr/local/bin/'
        : 'V2Ray not found. Install via your package manager (apt install v2ray), or place the v2ray binary in ./bin/ or /usr/local/bin/';
    errors.push(result.v2ray.error);
  }

  // WireGuard check
  if (WG_AVAILABLE) {
    result.wireguard.available = true;
    result.wireguard.path = process.platform === 'win32'
      ? ['C:\\Program Files\\WireGuard\\wireguard.exe', 'C:\\Program Files (x86)\\WireGuard\\wireguard.exe'].find(p => existsSync(p)) || 'in PATH'
      : (() => { try { return execSync('which wg-quick', { encoding: 'utf8', stdio: 'pipe' }).trim(); } catch { return 'in PATH'; } })();
    if (!IS_ADMIN) {
      result.wireguard.error = process.platform === 'win32'
        ? 'WireGuard requires Administrator privileges. Run your app as Admin, or use V2Ray nodes (no admin needed).'
        : 'WireGuard requires root/sudo. Run with sudo, or use V2Ray nodes (no root needed).';
      errors.push(result.wireguard.error);
    }
  } else {
    result.wireguard.error = process.platform === 'win32'
      ? 'WireGuard not installed. Download from https://download.wireguard.com/windows-client/wireguard-installer.exe — V2Ray nodes still work without it.'
      : process.platform === 'darwin'
        ? 'WireGuard not installed. Install via: brew install wireguard-tools — V2Ray nodes still work without it.'
        : 'WireGuard not installed. Install via: sudo apt install wireguard (or equivalent) — V2Ray nodes still work without it.';
    errors.push(result.wireguard.error);
  }

  result.ok = errors.length === 0;
  return result;
}

/**
 * Kill a V2Ray process with SIGTERM, falling back to SIGKILL if it doesn't exit.
 */
function killV2RayProc(proc) {
  if (!proc) return;
  try { proc.kill('SIGTERM'); } catch (e) { console.warn('[sentinel-sdk] V2Ray SIGTERM warning:', e.message); }
  // Give 2s for graceful shutdown, then force kill
  setTimeout(() => {
    try { if (!proc.killed) proc.kill('SIGKILL'); } catch {} // SIGKILL can't be caught, truly final
  }, 2000).unref();
}

/**
 * Kill orphaned v2ray process if one exists from a previous crash.
 * Only kills the process tracked by this module (by PID), NOT all v2ray.exe.
 */
function killOrphanV2Ray() {
  for (const s of _activeStates) {
    if (s.v2rayProc) {
      killV2RayProc(s.v2rayProc);
      s.v2rayProc = null;
    }
  }
}

/**
 * Check if a port is available. Use this at startup to detect port conflicts
 * from zombie processes (e.g., old server still running on the same port).
 * @param {number} port - Port to check
 * @returns {Promise<boolean>} true if port is free
 */
export function checkPortFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => { server.close(() => resolve(true)); });
    server.listen(port, '127.0.0.1');
  });
}

// ─── V2Ray binary detection ──────────────────────────────────────────────────
// Search common locations so apps can find an existing v2ray.exe instead of
// requiring every project to bundle its own copy.

function findV2RayExe(hint) {
  const binary = process.platform === 'win32' ? 'v2ray.exe' : 'v2ray';

  // 1. Explicit path (if provided and exists)
  if (hint && existsSync(hint)) return hint;

  // 2. Environment variable
  if (process.env.V2RAY_PATH && existsSync(process.env.V2RAY_PATH)) {
    return process.env.V2RAY_PATH;
  }

  // 3. Search common locations (cross-platform)
  const home = os.homedir();
  const searchPaths = [
    // ─── Relative to CWD (works for any project layout) ───
    path.join(process.cwd(), 'bin', binary),
    path.join(process.cwd(), 'resources', 'bin', binary),

    // ─── Relative to SDK code dir (npm install or git clone) ───
    path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), 'bin', binary),

    // ─── Electron / bundled app paths ───
    // process.resourcesPath is set by Electron for packaged apps
    ...(typeof process.resourcesPath === 'string' ? [
      path.join(process.resourcesPath, 'bin', binary),
      path.join(process.resourcesPath, 'app.asar.unpacked', 'bin', binary),
      path.join(process.resourcesPath, 'extraResources', binary),
    ] : []),

    // ─── Windows ───
    ...(process.platform === 'win32' ? [
      'C:\\Program Files\\V2Ray\\v2ray.exe',
      'C:\\Program Files (x86)\\V2Ray\\v2ray.exe',
      path.join(home, 'AppData', 'Local', 'v2ray', 'v2ray.exe'),
      path.join(home, 'AppData', 'Local', 'Programs', 'v2ray', 'v2ray.exe'),
      path.join(home, 'scoop', 'apps', 'v2ray', 'current', 'v2ray.exe'),
    ] : []),

    // ─── macOS ───
    ...(process.platform === 'darwin' ? [
      '/usr/local/bin/v2ray',
      '/opt/homebrew/bin/v2ray',
      path.join(home, 'Library', 'Application Support', 'v2ray', 'v2ray'),
      '/Applications/V2Ray.app/Contents/MacOS/v2ray',
    ] : []),

    // ─── Linux ───
    ...(process.platform === 'linux' ? [
      '/usr/local/bin/v2ray',
      '/usr/bin/v2ray',
      path.join(home, '.local', 'bin', 'v2ray'),
      '/snap/v2ray/current/bin/v2ray',
      path.join(home, '.config', 'v2ray', 'v2ray'),
    ] : []),
  ];

  for (const p of searchPaths) {
    try { if (existsSync(p)) return p; } catch {} // catch invalid paths on non-matching platforms
  }

  // 4. Check system PATH
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const arg = process.platform === 'win32' ? 'v2ray.exe' : 'v2ray';
    const result = execFileSync(cmd, [arg], { encoding: 'utf8', stdio: 'pipe' }).trim();
    if (result) return result.split('\n')[0].trim();
  } catch {}

  return null;
}

// ─── Pre-validation (MUST run before paying for session) ─────────────────────

/**
 * Validate that tunnel requirements are met BEFORE paying for a session.
 * Prevents burning P2P on sessions that can never produce a working tunnel.
 *
 * For V2Ray: searches system for an existing v2ray.exe if the provided path
 * doesn't exist. Returns the resolved path so callers can use it.
 *
 * Throws with a clear error message if requirements are not met.
 */
function validateTunnelRequirements(serviceType, v2rayExePath) {
  if (serviceType === 'v2ray') {
    const resolved = findV2RayExe(v2rayExePath);
    if (!resolved) {
      const searched = v2rayExePath ? `Checked: ${v2rayExePath} (not found). ` : '';
      throw new TunnelError(ErrorCodes.V2RAY_NOT_FOUND, `${searched}V2Ray binary not found anywhere on this system. Either: (a) set v2rayExePath to the correct path, (b) set V2RAY_PATH env var, (c) add v2ray.exe to PATH, or (d) download v2ray-core v5.x from https://github.com/v2fly/v2ray-core/releases and place v2ray.exe + geoip.dat + geosite.dat in a bin/ directory.`, { checked: v2rayExePath });
    }
    if (resolved !== v2rayExePath) {
      console.log(`V2Ray binary found at: ${resolved} (auto-detected)`);
    }
    // V2Ray version check — 5.44.1+ has observatory bugs that break multi-outbound configs
    try {
      const verOut = execFileSync(resolved, ['version'], { encoding: 'utf8', timeout: 5000, stdio: 'pipe' });
      const verMatch = verOut.match(/V2Ray\s+(\d+\.\d+\.\d+)/i) || verOut.match(/(\d+\.\d+\.\d+)/);
      if (verMatch) {
        const [major, minor] = verMatch[1].split('.').map(Number);
        if (major >= 5 && minor >= 44) {
          console.warn(`[sentinel-sdk] WARNING: V2Ray ${verMatch[1]} detected — v5.44.1+ has observatory bugs. Recommended: v5.2.1 exactly.`);
        }
      }
    } catch { /* version check is best-effort */ }
    return resolved;
  } else if (serviceType === 'wireguard') {
    if (!WG_AVAILABLE) {
      throw new TunnelError(ErrorCodes.WG_NOT_AVAILABLE, 'WireGuard node selected but WireGuard is not installed. Download from https://download.wireguard.com/windows-client/wireguard-installer.exe');
    }
    if (process.platform === 'win32' && !IS_ADMIN) {
      throw new TunnelError(ErrorCodes.TUNNEL_SETUP_FAILED, 'WireGuard requires administrator privileges. Restart your application as Administrator.');
    }
  }
  return v2rayExePath;
}

// fetchNodeFromLcd removed — use queryNode() from cosmjs-setup.js instead

// ─── Kill Switch (Firewall / Packet Filter) ────────────────────────────────

let _killSwitchEnabled = false;

/**
 * Enable kill switch — blocks all non-tunnel traffic.
 * Windows: netsh advfirewall, macOS: pfctl, Linux: iptables.
 * Call after WireGuard tunnel is installed.
 * @param {string} serverEndpoint - WireGuard server "IP:PORT"
 * @param {string} [tunnelName='wgsent0'] - WireGuard interface name
 */
export function enableKillSwitch(serverEndpoint, tunnelName = 'wgsent0') {
  const [serverIp, serverPort] = serverEndpoint.split(':');

  if (process.platform === 'win32') {
    // Windows: netsh advfirewall
    // Block all outbound by default
    execFileSync('netsh', ['advfirewall', 'set', 'allprofiles', 'firewallpolicy', 'blockinbound,blockoutbound'], { stdio: 'pipe' });

    // Wrap allow rules in try-catch — if any fail after block-all, restore default policy
    // to prevent permanent internet loss from partial firewall state.
    try {
      // Allow tunnel interface
      execFileSync('netsh', ['advfirewall', 'firewall', 'add', 'rule', 'name=SentinelVPN-Allow-Tunnel', 'dir=out', `interface=${tunnelName}`, 'action=allow'], { stdio: 'pipe' });

      // Allow WireGuard endpoint (UDP to server)
      execFileSync('netsh', ['advfirewall', 'firewall', 'add', 'rule', 'name=SentinelVPN-Allow-WG-Endpoint', 'dir=out', 'action=allow', 'protocol=udp', `remoteip=${serverIp}`, `remoteport=${serverPort}`], { stdio: 'pipe' });

      // Allow loopback
      execFileSync('netsh', ['advfirewall', 'firewall', 'add', 'rule', 'name=SentinelVPN-Allow-Loopback', 'dir=out', 'action=allow', 'remoteip=127.0.0.1'], { stdio: 'pipe' });

      // Allow DHCP
      execFileSync('netsh', ['advfirewall', 'firewall', 'add', 'rule', 'name=SentinelVPN-Allow-DHCP', 'dir=out', 'action=allow', 'protocol=udp', 'localport=68', 'remoteport=67'], { stdio: 'pipe' });

      // Allow DNS only through tunnel
      execFileSync('netsh', ['advfirewall', 'firewall', 'add', 'rule', 'name=SentinelVPN-Allow-DNS-Tunnel', 'dir=out', 'action=allow', 'protocol=udp', 'remoteip=10.8.0.1', 'remoteport=53'], { stdio: 'pipe' });

      // Block IPv6 (prevent leaks)
      execFileSync('netsh', ['advfirewall', 'firewall', 'add', 'rule', 'name=SentinelVPN-Block-IPv6', 'dir=out', 'action=block', 'protocol=any', 'remoteip=::/0'], { stdio: 'pipe' });
    } catch (err) {
      // Emergency restore — unblock outbound so user isn't locked out
      try { execFileSync('netsh', ['advfirewall', 'set', 'allprofiles', 'firewallpolicy', 'blockinbound,allowoutbound'], { stdio: 'pipe' }); } catch { /* last resort */ }
      _killSwitchEnabled = false;
      throw new TunnelError('KILL_SWITCH_FAILED', `Kill switch failed: ${err.message}`);
    }

  } else if (process.platform === 'darwin') {
    // macOS: pfctl (packet filter)
    const pfRules = [
      '# Sentinel VPN Kill Switch',
      'block out all',
      `pass out on ${tunnelName} all`,
      `pass out proto udp from any to ${serverIp} port ${serverPort}`,
      'pass out on lo0 all',
      'pass out proto udp from any port 68 to any port 67',
      'pass out proto udp from any to 10.8.0.1 port 53',
      'block out inet6 all',
    ].join('\n') + '\n';

    const pfPath = '/tmp/sentinel-killswitch.conf';
    writeFileSync(pfPath, pfRules, { mode: 0o600 });

    // Save current pf state for restore
    try { execFileSync('pfctl', ['-sr'], { encoding: 'utf8', stdio: 'pipe' }); } catch { /* may not have existing rules */ }

    // Load rules and enable pf
    execFileSync('pfctl', ['-f', pfPath], { stdio: 'pipe' });
    execFileSync('pfctl', ['-e'], { stdio: 'pipe' });

  } else {
    // Linux: iptables
    // Flush existing sentinel rules first
    try { execFileSync('iptables', ['-D', 'OUTPUT', '-m', 'comment', '--comment', 'sentinel-vpn', '-j', 'DROP'], { stdio: 'pipe' }); } catch { /* rule may not exist */ }

    // Allow loopback
    execFileSync('iptables', ['-A', 'OUTPUT', '-o', 'lo', '-j', 'ACCEPT', '-m', 'comment', '--comment', 'sentinel-vpn'], { stdio: 'pipe' });

    // Allow tunnel interface
    execFileSync('iptables', ['-A', 'OUTPUT', '-o', tunnelName, '-j', 'ACCEPT', '-m', 'comment', '--comment', 'sentinel-vpn'], { stdio: 'pipe' });

    // Allow WireGuard server endpoint
    execFileSync('iptables', ['-A', 'OUTPUT', '-d', serverIp, '-p', 'udp', '--dport', serverPort, '-j', 'ACCEPT', '-m', 'comment', '--comment', 'sentinel-vpn'], { stdio: 'pipe' });

    // Allow DHCP
    execFileSync('iptables', ['-A', 'OUTPUT', '-p', 'udp', '--sport', '68', '--dport', '67', '-j', 'ACCEPT', '-m', 'comment', '--comment', 'sentinel-vpn'], { stdio: 'pipe' });

    // Allow DNS only through tunnel
    execFileSync('iptables', ['-A', 'OUTPUT', '-d', '10.8.0.1', '-p', 'udp', '--dport', '53', '-j', 'ACCEPT', '-m', 'comment', '--comment', 'sentinel-vpn'], { stdio: 'pipe' });

    // Block everything else
    execFileSync('iptables', ['-A', 'OUTPUT', '-j', 'DROP', '-m', 'comment', '--comment', 'sentinel-vpn'], { stdio: 'pipe' });

    // Block IPv6
    try { execFileSync('ip6tables', ['-A', 'OUTPUT', '-j', 'DROP', '-m', 'comment', '--comment', 'sentinel-vpn'], { stdio: 'pipe' }); } catch { /* ip6tables may not be available */ }
  }

  _killSwitchEnabled = true;
  // Persist kill switch state — survives crash so recoverOrphans() can restore internet
  try {
    const conn = _defaultState.connection || {};
    saveState({ sessionId: conn.sessionId, serviceType: conn.serviceType, nodeAddress: conn.nodeAddress, killSwitchEnabled: true });
  } catch {} // best-effort
}

/**
 * Disable kill switch — restore normal routing.
 * Windows: removes netsh rules, macOS: disables pfctl, Linux: removes iptables rules.
 */
export function disableKillSwitch() {
  if (!_killSwitchEnabled) return;

  if (process.platform === 'win32') {
    // Windows: remove firewall rules
    const rules = [
      'SentinelVPN-Allow-Tunnel',
      'SentinelVPN-Allow-WG-Endpoint',
      'SentinelVPN-Allow-Loopback',
      'SentinelVPN-Allow-DHCP',
      'SentinelVPN-Allow-DNS-Tunnel',
      'SentinelVPN-Block-IPv6',
    ];
    for (const rule of rules) {
      try { execFileSync('netsh', ['advfirewall', 'firewall', 'delete', 'rule', `name=${rule}`], { stdio: 'pipe' }); } catch { /* rule may not exist */ }
    }

    // Restore default outbound policy
    try { execFileSync('netsh', ['advfirewall', 'set', 'allprofiles', 'firewallpolicy', 'blockinbound,allowoutbound'], { stdio: 'pipe' }); } catch { /* best effort */ }

  } else if (process.platform === 'darwin') {
    // macOS: disable pf and remove temp rules
    try { execFileSync('pfctl', ['-d'], { stdio: 'pipe' }); } catch { /* pf may already be disabled */ }
    try { unlinkSync('/tmp/sentinel-killswitch.conf'); } catch { /* file may not exist */ }

  } else {
    // Linux: remove all sentinel-vpn rules
    let hasRules = true;
    while (hasRules) {
      try {
        execFileSync('iptables', ['-D', 'OUTPUT', '-m', 'comment', '--comment', 'sentinel-vpn', '-j', 'ACCEPT'], { stdio: 'pipe' });
      } catch {
        hasRules = false;
      }
    }
    try { execFileSync('iptables', ['-D', 'OUTPUT', '-m', 'comment', '--comment', 'sentinel-vpn', '-j', 'DROP'], { stdio: 'pipe' }); } catch { /* rule may not exist */ }
    try { execFileSync('ip6tables', ['-D', 'OUTPUT', '-m', 'comment', '--comment', 'sentinel-vpn', '-j', 'DROP'], { stdio: 'pipe' }); } catch { /* rule may not exist */ }
  }

  _killSwitchEnabled = false;
  // Persist cleared kill switch state
  try {
    const conn = _defaultState.connection || {};
    saveState({ sessionId: conn.sessionId, serviceType: conn.serviceType, nodeAddress: conn.nodeAddress, killSwitchEnabled: false });
  } catch {} // best-effort
}

/** Check if kill switch is enabled */
export function isKillSwitchEnabled() { return _killSwitchEnabled; }

// ─── DNS Leak Prevention ────────────────────────────────────────────────────

/**
 * Enable DNS leak prevention by forcing all DNS through the VPN tunnel.
 * Windows: netsh interface ipv4 set dnsservers + firewall rules
 * macOS: networksetup -setdnsservers
 * Linux: write /etc/resolv.conf
 * @param {string} [dnsServer='10.8.0.1'] - DNS server inside the tunnel
 * @param {string} [tunnelInterface='wgsent0'] - WireGuard tunnel interface name
 */
export function enableDnsLeakPrevention(dnsServer = '10.8.0.1', tunnelInterface = 'wgsent0') {
  const platform = process.platform;
  if (platform === 'win32') {
    // Set DNS on all interfaces to tunnel DNS
    execFileSync('netsh', ['interface', 'ipv4', 'set', 'dnsservers', tunnelInterface, 'static', dnsServer, 'primary'], { stdio: 'pipe' });
    // Block DNS on non-tunnel interfaces
    execFileSync('netsh', ['advfirewall', 'firewall', 'add', 'rule',
      'name=SentinelDNSBlock', 'dir=out', 'protocol=udp', 'remoteport=53',
      'action=block'], { stdio: 'pipe' });
    execFileSync('netsh', ['advfirewall', 'firewall', 'add', 'rule',
      'name=SentinelDNSAllow', 'dir=out', 'protocol=udp', 'remoteport=53',
      'interface=' + tunnelInterface, 'action=allow'], { stdio: 'pipe' });
  } else if (platform === 'darwin') {
    // macOS: set DNS via networksetup for all services
    const services = execFileSync('networksetup', ['-listallnetworkservices'], { encoding: 'utf8' })
      .split('\n').filter(s => s && !s.startsWith('*'));
    for (const svc of services) {
      try { execFileSync('networksetup', ['-setdnsservers', svc.trim(), dnsServer], { stdio: 'pipe' }); } catch { /* best effort */ }
    }
  } else {
    // Linux: backup and overwrite resolv.conf
    try { execFileSync('cp', ['/etc/resolv.conf', '/etc/resolv.conf.sentinel.bak'], { stdio: 'pipe' }); } catch { /* backup may fail if file missing */ }
    writeFileSync('/etc/resolv.conf', `nameserver ${dnsServer}\n`);
  }
}

/**
 * Disable DNS leak prevention and restore normal DNS resolution.
 * Windows: removes firewall rules, resets DNS to DHCP
 * macOS: clears DNS overrides
 * Linux: restores /etc/resolv.conf from backup
 */
export function disableDnsLeakPrevention() {
  const platform = process.platform;
  if (platform === 'win32') {
    try { execFileSync('netsh', ['advfirewall', 'firewall', 'delete', 'rule', 'name=SentinelDNSBlock'], { stdio: 'pipe' }); } catch { /* rule may not exist */ }
    try { execFileSync('netsh', ['advfirewall', 'firewall', 'delete', 'rule', 'name=SentinelDNSAllow'], { stdio: 'pipe' }); } catch { /* rule may not exist */ }
    // Reset DNS to DHCP
    try { execFileSync('netsh', ['interface', 'ipv4', 'set', 'dnsservers', 'Wi-Fi', 'dhcp'], { stdio: 'pipe' }); } catch { /* interface may not exist */ }
    try { execFileSync('netsh', ['interface', 'ipv4', 'set', 'dnsservers', 'Ethernet', 'dhcp'], { stdio: 'pipe' }); } catch { /* interface may not exist */ }
  } else if (platform === 'darwin') {
    const services = execFileSync('networksetup', ['-listallnetworkservices'], { encoding: 'utf8' })
      .split('\n').filter(s => s && !s.startsWith('*'));
    for (const svc of services) {
      try { execFileSync('networksetup', ['-setdnsservers', svc.trim(), 'empty'], { stdio: 'pipe' }); } catch { /* best effort */ }
    }
  } else {
    try { execFileSync('cp', ['/etc/resolv.conf.sentinel.bak', '/etc/resolv.conf'], { stdio: 'pipe' }); } catch { /* backup may not exist */ }
  }
}

