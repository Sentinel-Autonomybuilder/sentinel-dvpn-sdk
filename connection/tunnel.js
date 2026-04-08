/**
 * Tunnel Management — WireGuard and V2Ray tunnel setup, verification, and helpers.
 *
 * Handles the low-level process of creating and verifying VPN tunnels
 * after a successful handshake.
 */

import axios from 'axios';
import { execSync, execFileSync, spawn } from 'child_process';
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';
import path from 'path';
import os from 'os';

import {
  events, _defaultState, _activeStates, progress, checkAborted,
  _endSessionOnChain,
} from './state.js';
import { enableKillSwitch, isKillSwitchEnabled, disableKillSwitch } from './security.js';
import { setSystemProxy } from './proxy.js';

import {
  generateWgKeyPair, initHandshakeV3,
  writeWgConfig, generateV2RayUUID, initHandshakeV3V2Ray,
  buildV2RayClientConfig, waitForPort,
} from '../v3protocol.js';
import { installWgTunnel, disconnectWireGuard, WG_AVAILABLE, IS_ADMIN } from '../wireguard.js';
import { resolveSpeedtestIPs } from '../speedtest.js';
import {
  saveState, clearState, saveCredentials, clearCredentials,
} from '../state.js';
import {
  DEFAULT_TIMEOUTS, sleep, recordTransportResult, resolveDnsServers,
} from '../defaults.js';
import {
  NodeError, TunnelError, ErrorCodes,
} from '../errors.js';
import { createNodeHttpsAgent } from '../tls-trust.js';

// ─── V2Ray binary detection ──────────────────────────────────────────────────
// Search common locations so apps can find an existing v2ray.exe instead of
// requiring every project to bundle its own copy.

export function findV2RayExe(hint) {
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
    path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..', 'bin', binary),

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
export function validateTunnelRequirements(serviceType, v2rayExePath) {
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

/**
 * Pre-flight check: verify all required binaries and permissions.
 *
 * Call this at app startup to surface clear, human-readable errors
 * instead of cryptic ENOENT crashes mid-connection.
 *
 * @param {object} [opts]
 * @param {string} [opts.v2rayExePath] - Explicit V2Ray binary path
 * @returns {{ ok, v2ray, wireguard, platform, arch, nodeVersion, errors }}
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

// ─── Handshake & Tunnel Setup ────────────────────────────────────────────────

export async function performHandshake({ serviceType, remoteUrl, serverHost, sessionId, privKey, v2rayExePath, fullTunnel, splitIPs, systemProxy, killSwitch, dns, onProgress, logFn, extremeDrift, clockDriftSec, nodeAddress, timeouts, signal, nodeAgent, state }) {
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
      if (isKillSwitchEnabled()) disableKillSwitch();
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
export async function verifyWgConnectivity(maxAttempts = 1, customTargets = null) {
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
  const { checkPortFree } = await import('./proxy.js');
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

// ─── V2Ray Process Management ───────────────────────────────────────────────

/**
 * Kill a V2Ray process with SIGTERM, falling back to SIGKILL if it doesn't exit.
 */
export function killV2RayProc(proc) {
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
export function killOrphanV2Ray() {
  for (const s of _activeStates) {
    if (s.v2rayProc) {
      killV2RayProc(s.v2rayProc);
      s.v2rayProc = null;
    }
  }
}
