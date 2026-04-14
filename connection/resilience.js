/**
 * Connection Resilience — circuit breaker, auto-reconnect, fast reconnect.
 *
 * Handles node failure tracking and automatic recovery from dropped connections.
 */

import axios from 'axios';
import { writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { spawn } from 'child_process';
import path from 'path';
import os from 'os';

import {
  events, _defaultState, progress, checkAborted,
  cachedCreateWallet, _endSessionOnChain, getStatus,
} from './state.js';

import { queryNode } from '../cosmjs-setup.js';
import { nodeStatusV3, buildV2RayClientConfig, waitForPort } from '../v3protocol.js';
import { installWgTunnel, disconnectWireGuard, WG_AVAILABLE } from '../wireguard.js';
import { writeWgConfig } from '../v3protocol.js';
import { resolveSpeedtestIPs } from '../speedtest.js';
import {
  saveState, clearState, saveCredentials, loadCredentials, clearCredentials,
} from '../state.js';
import {
  DEFAULT_LCD, DEFAULT_TIMEOUTS, sleep, resolveDnsServers,
} from '../defaults.js';
import { findV2RayExe } from './tunnel.js';
import { enableKillSwitch, isKillSwitchEnabled as _isKillSwitchEnabled } from './security.js';
import { setSystemProxy, clearSystemProxy, checkPortFree } from './proxy.js';
import { connectAuto, connectViaSubscription, connectViaPlan } from './connect.js';

// ─── Circuit Breaker ─────────────────────────────────────────────────────────
// v22: Skip nodes that repeatedly fail. Resets after TTL expires.
// v25: Configurable threshold/TTL via configureCircuitBreaker().

const _circuitBreaker = new Map(); // address -> { count, lastFail }
let _cbTtl = 5 * 60_000;  // default 5 minutes
let _cbThreshold = 3;      // default 3 failures before tripping

export function recordNodeFailure(address) {
  const entry = _circuitBreaker.get(address) || { count: 0, lastFail: 0 };
  entry.count++;
  entry.lastFail = Date.now();
  _circuitBreaker.set(address, entry);
}

export function isCircuitOpen(address) {
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

/** Clear circuit breaker entry for a specific node (on successful connect). */
export function clearCircuitBreaker(address) {
  _circuitBreaker.delete(address);
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
  const logFn = opts.log || console.log;
  const fullTunnel = opts.fullTunnel !== false;
  const killSwitch = opts.killSwitch === true;
  const systemProxy = opts.systemProxy === true;

  progress(onProgress, logFn, 'cache', `Found saved credentials for ${opts.nodeAddress}, verifying session...`);

  // Verify session is still active on chain
  try {
    const lcd = opts.lcdUrl || DEFAULT_LCD;
    const { wallet, account } = await cachedCreateWallet(opts.mnemonic);
    const { findExistingSession } = await import('../cosmjs-setup.js');
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
      const { verifyWgConnectivity } = await import('./tunnel.js');
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
          if (_isKillSwitchEnabled()) {
            const { disableKillSwitch } = await import('./security.js');
            disableKillSwitch();
          }
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
      // Dispatch to correct connect function based on original connection mode
      let result;
      if (opts.subscriptionId) {
        result = await connectViaSubscription(opts);
      } else if (opts.planId) {
        result = await connectViaPlan(opts);
      } else {
        result = await connectAuto(opts);
      }
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
