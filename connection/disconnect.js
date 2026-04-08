/**
 * Disconnect — clean up tunnels, system proxy, kill switch, and session state.
 *
 * Handles graceful and emergency disconnection, cleanup handler registration,
 * and session recovery.
 */

import {
  events, _defaultState, _activeStates,
  clearWalletCache, _endSessionOnChain,
  markCleanupRegistered, isCleanupRegistered,
  progress, checkAborted, cachedCreateWallet, _recordMetric,
  setAbortConnect, setConnectLock,
} from './state.js';
import { disableKillSwitch, isKillSwitchEnabled, disableDnsLeakPrevention } from './security.js';
import { clearSystemProxy } from './proxy.js';
import { killV2RayProc, killOrphanV2Ray, performHandshake, validateTunnelRequirements } from './tunnel.js';

import { disconnectWireGuard, emergencyCleanupSync } from '../wireguard.js';
import { flushSpeedTestDnsCache } from '../speedtest.js';
import {
  clearState, recoverOrphans, markSessionActive,
} from '../state.js';
import { ValidationError, ErrorCodes } from '../errors.js';
import { DEFAULT_LCD, DEFAULT_TIMEOUTS } from '../defaults.js';
import { nodeStatusV3 } from '../v3protocol.js';
import { queryNode, privKeyFromMnemonic } from '../cosmjs-setup.js';
import { createNodeHttpsAgent } from '../tls-trust.js';

// ─── Disconnect ──────────────────────────────────────────────────────────────

/**
 * Clean up all active tunnels and system proxy.
 * ALWAYS call this on exit — a stale WireGuard tunnel will kill your internet.
 */
/** Disconnect a specific state instance (internal). */
export async function disconnectState(state) {
  // v30: Signal any running connectAuto() retry loop to abort, and release the
  // connection lock so the user can reconnect after disconnect completes.
  setAbortConnect(true);
  setConnectLock(false);

  const prev = state.connection;
  // v29: try/finally ensures state.connection is ALWAYS cleared, even if
  // disableKillSwitch() or clearSystemProxy() throw. Previously, an exception
  // here left state.connection set → phantom "connected" status (IP leak).
  try {
    if (isKillSwitchEnabled()) {
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
      // v34: Restore DNS to DHCP after WireGuard disconnect.
      // WireGuard config sets DNS (10.8.0.1 or custom). When the adapter is removed,
      // the system DNS may remain changed (observed: Cloudflare 1.1.1.1 persisted after
      // split tunnel test). Always restore to DHCP to prevent DNS leak/persistence.
      try { disableDnsLeakPrevention(); } catch (e) { console.warn('[sentinel-sdk] DNS restore warning:', e.message); }
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

// ─── Cleanup Registration ───────────────────────────────────────────────────

/**
 * Register exit handlers to clean up tunnels on crash/exit.
 * Call this once at app startup.
 */
export function registerCleanupHandlers() {
  if (isCleanupRegistered()) return; // prevent duplicate handler stacking
  markCleanupRegistered();
  const orphans = recoverOrphans(); // recover state-tracked orphans from crash
  if (orphans?.cleaned?.length) console.log('[sentinel-sdk] Recovered orphans:', orphans.cleaned.join(', '));
  emergencyCleanupSync(); // kill stale tunnels from previous crash
  killOrphanV2Ray(); // kill orphaned v2ray from previous crash
  process.on('exit', () => { if (isKillSwitchEnabled()) disableKillSwitch(); clearSystemProxy(); killOrphanV2Ray(); emergencyCleanupSync(); });
  process.on('SIGINT', () => { if (isKillSwitchEnabled()) disableKillSwitch(); clearSystemProxy(); killOrphanV2Ray(); emergencyCleanupSync(); process.exit(130); });
  process.on('SIGTERM', () => { if (isKillSwitchEnabled()) disableKillSwitch(); clearSystemProxy(); killOrphanV2Ray(); emergencyCleanupSync(); process.exit(143); });
  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    if (isKillSwitchEnabled()) disableKillSwitch();
    clearSystemProxy();
    killOrphanV2Ray();
    emergencyCleanupSync();
    process.exit(1);
  });
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
