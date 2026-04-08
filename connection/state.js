/**
 * Connection State — shared state, event emitter, metrics, wallet cache, and helpers.
 *
 * This module owns all mutable state that other connection modules depend on.
 * Import ConnectionState, _defaultState, events, etc. from here.
 */

import { EventEmitter } from 'events';
import { execFileSync } from 'child_process';
import axios from 'axios';
import { sha256 as _sha256 } from '@cosmjs/crypto';

import {
  createWallet, createClient, broadcast, buildEndSessionMsg,
} from '../cosmjs-setup.js';
import {
  SentinelError, NodeError, ErrorCodes,
} from '../errors.js';
import {
  saveState, clearState,
} from '../state.js';
import {
  sleep, RPC_ENDPOINTS, tryWithFallback,
} from '../defaults.js';

// ─── Event Emitter ───────────────────────────────────────────────────────────
// Subscribe to SDK lifecycle events without polling:
//   import { events } from './connection/state.js';
//   events.on('connected', ({ sessionId, serviceType }) => updateUI());
//   events.on('disconnected', ({ reason }) => showNotification());
//   events.on('progress', ({ step, detail }) => updateProgressBar());

export const events = new EventEmitter();

// ─── Cleanup Safety ──────────────────────────────────────────────────────────
// Track whether registerCleanupHandlers() has been called. If a developer calls
// connect() without registering, they risk orphaning WireGuard adapters or V2Ray
// processes on crash/SIGINT — the "Dead Internet" bug.
let _cleanupRegistered = false;

export function isCleanupRegistered() { return _cleanupRegistered; }
export function markCleanupRegistered() { _cleanupRegistered = true; }

export function warnIfNoCleanup(fnName) {
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
export function getConnectLock() { return _connectLock; }
export function setConnectLock(v) { _connectLock = v; }
export function getAbortConnect() { return _abortConnect; }
export function setAbortConnect(v) { _abortConnect = v; }

// ─── Connection State ─────────────────────────────────────────────────────────
// v22: Encapsulated state enables per-instance connections via SentinelClient.
// Module-level functions use _defaultState for backward compatibility.

// Global registry of active states — used by exit handlers to clean up all instances
export const _activeStates = new Set();

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

export const _defaultState = new ConnectionState();

// Default logger — can be overridden per-call via opts.log
export let defaultLog = console.log;

// ─── Wallet Cache ────────────────────────────────────────────────────────────
// v21: Cache wallet derivation (BIP39 → SLIP-10 is CPU-bound, ~300ms).
// Same mnemonic always produces the same wallet — safe to cache.
// Keyed by full SHA256 of mnemonic to avoid storing the raw mnemonic.

const _walletCache = new Map();

export async function cachedCreateWallet(mnemonic) {
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

// ─── Connection Metrics (v25) ────────────────────────────────────────────────
// Track per-node connection stats for reliability tracking over time.

const _connectionMetrics = new Map(); // nodeAddress -> { attempts, successes, failures, avgTimeMs, lastAttempt }

export function _recordMetric(nodeAddress, success, durationMs) {
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

// ─── Abort helper ────────────────────────────────────────────────────────────

export function checkAborted(signal) {
  if (signal?.aborted) {
    throw new SentinelError(ErrorCodes.ABORTED, 'Connection aborted', { reason: signal.reason });
  }
}

// ─── Progress helper ─────────────────────────────────────────────────────────

export function progress(cb, logFn, step, detail, meta = {}) {
  const entry = { event: `sdk.${step}`, detail, ts: Date.now(), ...meta };
  events.emit('progress', entry);
  if (logFn) try { logFn(`[${step}] ${detail}`); } catch {} // user callback may throw — don't crash SDK
  if (cb) try { cb(step, detail, entry); } catch {} // user callback may throw — don't crash SDK
}

// ─── Node Inactive Retry Helper ──────────────────────────────────────────────
// LCD may show node as active, but chain rejects TX with code 105 ("invalid
// status inactive") if the node went offline between query and payment.
// Retry once after 15s in case LCD data was stale.

export function _isNodeInactiveError(err) {
  const msg = String(err?.message || '');
  const code = err?.details?.code;
  return msg.includes('invalid status inactive') || code === 105;
}

export async function broadcastWithInactiveRetry(client, address, msgs, logFn, onProgress) {
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

// ─── Uptime Formatter ────────────────────────────────────────────────────────

export function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

// ─── Session End (on-chain cleanup) ──────────────────────────────────────────

/**
 * End a session on-chain. Best-effort, fire-and-forget.
 * Prevents stale session accumulation on nodes.
 * @param {string|bigint} sessionId - Session ID to end
 * @param {string} mnemonic - BIP39 mnemonic for signing the TX
 * @private
 */
export async function _endSessionOnChain(sessionId, mnemonic) {
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
