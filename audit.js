/**
 * Sentinel dVPN SDK -- Network Audit & Node Testing
 *
 * Utility/operator functions for testing individual nodes and auditing the
 * network. These use the SDK's own consumer path (connectDirect/disconnect)
 * internally -- they do NOT reimplement handshake, tunnel, or payment logic.
 *
 * WARNING: OPERATOR TOOL -- NOT FOR CONSUMER APPS
 *   These functions start sessions across many nodes, costing real P2P tokens.
 *   Consumer apps should use connectAuto() or connectDirect() instead.
 *
 * Usage:
 *   import { testNode, auditNetwork } from './audit.js';
 *
 *   // Test a single node
 *   const result = await testNode({ mnemonic, nodeAddress: 'sentnode1...' });
 *
 *   // Audit the whole network
 *   const { results, stats } = await auditNetwork({
 *     mnemonic, concurrency: 30, onProgress: (r) => console.log(r),
 *   });
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';
import axios from 'axios';

import {
  connectDirect,
  disconnect,
  queryOnlineNodes,
  fetchAllNodes,
  registerCleanupHandlers,
  events,
  ConnectionState,
  disconnectState,
} from './node-connect.js';

import {
  speedtestDirect,
  speedtestViaSocks5,
} from './speedtest.js';

import {
  createWallet,
  getBalance,
  createClient,
} from './cosmjs-setup.js';

import { nodeStatusV3 } from './v3protocol.js';

import {
  DEFAULT_RPC,
  DEFAULT_LCD,
  RPC_ENDPOINTS,
  LCD_ENDPOINTS,
  BROKEN_NODES,
  tryWithFallback,
  sleep,
} from './defaults.js';

import {
  SentinelError,
  ValidationError,
  NodeError,
  ChainError,
  TunnelError,
  ErrorCodes,
  isRetryable,
} from './errors.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const TRANSPORT_CACHE_DIR = path.join(os.homedir(), '.sentinel-sdk');
const TRANSPORT_CACHE_FILE = path.join(TRANSPORT_CACHE_DIR, 'transport-cache.json');
const TRANSPORT_CACHE_TTL = 14 * 24 * 60 * 60_000; // 14 days

const GOOGLE_CHECK_TARGETS = [
  'https://www.google.com',
  'https://www.google.com/generate_204',
];

const GOOGLE_CHECK_TIMEOUT = 10_000;

// ─── Transport Cache ──────────────────────────────────────────────────────────
//
// Learns which V2Ray transports work per node. Persists to disk at
// ~/.sentinel-sdk/transport-cache.json with TTL eviction.
//
// Structure:
//   {
//     perNode: { "sentnode1...": { protocol, network, security, port, successCount, failCount, lastSeen } },
//     global:  { "grpc/none": { success, fail, updatedAt }, ... },
//   }

/** @type {{ perNode: Record<string, object>, global: Record<string, object> } | null} */
let _transportCache = null;

/**
 * Load the transport cache from disk. Creates an empty cache if none exists.
 * Evicts entries older than TRANSPORT_CACHE_TTL.
 *
 * @param {string} [cachePath] - Custom path (default: ~/.sentinel-sdk/transport-cache.json)
 * @returns {{ perNode: Record<string, object>, global: Record<string, object> }}
 */
export function loadTransportCache(cachePath) {
  const filePath = cachePath || TRANSPORT_CACHE_FILE;
  try {
    if (existsSync(filePath)) {
      const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
      const now = Date.now();
      const perNode = {};
      const global = {};

      // Evict stale per-node entries
      for (const [addr, entry] of Object.entries(raw.perNode || {})) {
        if (entry.lastSeen && now - entry.lastSeen < TRANSPORT_CACHE_TTL) {
          perNode[addr] = entry;
        }
      }

      // Evict stale global entries
      for (const [key, entry] of Object.entries(raw.global || {})) {
        if (entry.updatedAt && now - entry.updatedAt < TRANSPORT_CACHE_TTL) {
          global[key] = entry;
        }
      }

      _transportCache = { perNode, global };
    } else {
      _transportCache = { perNode: {}, global: {} };
    }
  } catch {
    _transportCache = { perNode: {}, global: {} };
  }
  return _transportCache;
}

/**
 * Save the current transport cache to disk.
 *
 * @param {string} [cachePath] - Custom path (default: ~/.sentinel-sdk/transport-cache.json)
 */
export function saveTransportCache(cachePath) {
  if (!_transportCache) return;
  const filePath = cachePath || TRANSPORT_CACHE_FILE;
  try {
    const dir = path.dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(filePath, JSON.stringify(_transportCache, null, 2), { mode: 0o600 });
  } catch {
    // Disk write failed -- cache stays in memory only
  }
}

/** Ensure cache is loaded (lazy init). */
function _ensureCache() {
  if (!_transportCache) loadTransportCache();
  return _transportCache;
}

/**
 * Record a successful transport for a node. Updates both per-node and global stats.
 *
 * @param {string} nodeAddr - Node address (sentnode1...)
 * @param {{ protocol: string, network: string, security: string, port: number }} transport - Working transport details
 */
export function recordTransportSuccess(nodeAddr, transport) {
  const cache = _ensureCache();
  const { protocol, network, security, port } = transport;
  const globalKey = security && security !== 'none' ? `${network}/${security}` : network;

  // Per-node: store the working transport
  cache.perNode[nodeAddr] = {
    protocol,
    network,
    security: security || 'none',
    port,
    successCount: (cache.perNode[nodeAddr]?.successCount || 0) + 1,
    failCount: cache.perNode[nodeAddr]?.failCount || 0,
    lastSeen: Date.now(),
  };

  // Global: increment success
  if (!cache.global[globalKey]) cache.global[globalKey] = { success: 0, fail: 0, updatedAt: 0 };
  cache.global[globalKey].success++;
  cache.global[globalKey].updatedAt = Date.now();

  saveTransportCache();
}

/**
 * Record a transport failure. Updates global stats only (per-node keeps last success).
 *
 * @param {{ protocol: string, network: string, security: string }} transport - Failed transport details
 */
export function recordTransportFailure(transport) {
  const cache = _ensureCache();
  const { network, security } = transport;
  const globalKey = security && security !== 'none' ? `${network}/${security}` : network;

  if (!cache.global[globalKey]) cache.global[globalKey] = { success: 0, fail: 0, updatedAt: 0 };
  cache.global[globalKey].fail++;
  cache.global[globalKey].updatedAt = Date.now();

  saveTransportCache();
}

/**
 * Reorder V2Ray outbounds based on cached intelligence.
 * Cached per-node hit goes first, then sorted by global success rate (descending).
 *
 * @param {string} nodeAddr - Node address
 * @param {Array<object>} outbounds - V2Ray outbound configs (from buildV2RayClientConfig)
 * @returns {Array<object>} Reordered outbounds (new array, original unchanged)
 */
export function reorderOutbounds(nodeAddr, outbounds) {
  const cache = _ensureCache();
  const nodeEntry = cache.perNode[nodeAddr];

  // Extract transport key from outbound
  function outboundKey(ob) {
    const network = ob.streamSettings?.network;
    const security = ob.streamSettings?.security || 'none';
    if (!network) return null;
    return security !== 'none' ? `${network}/${security}` : network;
  }

  // Get global success rate for a transport key
  function globalRate(key) {
    if (!key) return 0;
    const entry = cache.global[key];
    if (!entry) return 0.5; // unknown -- neutral
    const total = entry.success + entry.fail;
    if (total < 2) return 0.5;
    return entry.success / total;
  }

  const sorted = [...outbounds];

  sorted.sort((a, b) => {
    // Cached per-node hit gets priority
    if (nodeEntry) {
      const aMatch = a.streamSettings?.network === nodeEntry.network &&
        (a.streamSettings?.security || 'none') === nodeEntry.security;
      const bMatch = b.streamSettings?.network === nodeEntry.network &&
        (b.streamSettings?.security || 'none') === nodeEntry.security;
      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;
    }

    // Then sort by global success rate
    const aRate = globalRate(outboundKey(a));
    const bRate = globalRate(outboundKey(b));
    return bRate - aRate;
  });

  return sorted;
}

/**
 * Get transport cache statistics.
 *
 * @returns {{ nodesCached: number, transportStats: Array<{ transport: string, success: number, fail: number, rate: number }> }}
 */
export function getCacheStats() {
  const cache = _ensureCache();
  const transportStats = [];

  for (const [key, entry] of Object.entries(cache.global)) {
    const total = entry.success + entry.fail;
    transportStats.push({
      transport: key,
      success: entry.success,
      fail: entry.fail,
      rate: total > 0 ? parseFloat((entry.success / total).toFixed(3)) : 0,
    });
  }

  // Sort by sample size descending
  transportStats.sort((a, b) => (b.success + b.fail) - (a.success + a.fail));

  return {
    nodesCached: Object.keys(cache.perNode).length,
    transportStats,
  };
}

// ─── Google Accessibility Check ───────────────────────────────────────────────

/**
 * Check if Google is reachable through the active tunnel.
 * For WireGuard: direct HTTPS (all traffic is tunneled).
 * For V2Ray: routes through SOCKS5 proxy.
 *
 * @param {'wireguard'|'v2ray'} serviceType
 * @param {number} [socksPort] - SOCKS5 port (V2Ray only)
 * @returns {Promise<boolean>}
 * @private
 */
async function _checkGoogleAccessible(serviceType, socksPort) {
  for (const target of GOOGLE_CHECK_TARGETS) {
    try {
      if (serviceType === 'wireguard') {
        // WireGuard: all traffic goes through tunnel
        await axios.get(target, {
          timeout: GOOGLE_CHECK_TIMEOUT,
          maxRedirects: 2,
          validateStatus: (s) => s < 500,
        });
        return true;
      } else if (serviceType === 'v2ray' && socksPort) {
        // V2Ray: route through SOCKS5
        const { SocksProxyAgent } = await import('socks-proxy-agent');
        const agent = new SocksProxyAgent(`socks5://127.0.0.1:${socksPort}`);
        try {
          await axios.get(target, {
            httpAgent: agent,
            httpsAgent: agent,
            timeout: GOOGLE_CHECK_TIMEOUT,
            maxRedirects: 2,
            validateStatus: (s) => s < 500,
          });
          return true;
        } finally {
          agent.destroy();
        }
      }
    } catch {
      // Try next target
    }
  }
  return false;
}

// ─── testNode ─────────────────────────────────────────────────────────────────

/**
 * Test a single Sentinel dVPN node using the SDK's consumer connection path.
 *
 * Flow:
 *   1. connectDirect() -- real wallet, real session, real tunnel
 *   2. Speed test (WG: speedtestDirect, V2Ray: speedtestViaSocks5)
 *   3. Google accessibility check
 *   4. disconnect() -- clean teardown
 *
 * Returns a structured result with pass/fail, speed, accessibility, and diagnostics.
 *
 * @param {object} options
 * @param {string} options.mnemonic - BIP39 wallet mnemonic (required)
 * @param {string} options.nodeAddress - Node address sentnode1... (required)
 * @param {string} [options.rpcUrl] - RPC endpoint URL
 * @param {string} [options.lcdUrl] - LCD endpoint URL
 * @param {string} [options.v2rayExePath] - Path to v2ray binary (required for V2Ray nodes)
 * @param {number} [options.gigabytes=1] - GB to allocate for session
 * @param {number} [options.testMb=5] - Download size for speed test (MB)
 * @param {number} [options.baselineMbps=null] - Baseline speed for scoring
 * @param {function} [options.onLog=null] - Log callback (msg) => {}
 * @param {function} [options.onProgress=null] - Progress callback (step, detail) => {}
 * @param {AbortSignal} [options.signal=null] - AbortSignal for cancellation
 * @returns {Promise<{
 *   pass: boolean,
 *   address: string,
 *   type: string,
 *   moniker: string,
 *   country: string,
 *   city: string,
 *   actualMbps: number,
 *   googleAccessible: boolean,
 *   diag: string,
 *   timestamp: string,
 * }>}
 */
export async function testNode(options) {
  // ── Validate inputs ──
  if (!options || typeof options !== 'object') {
    throw new ValidationError(ErrorCodes.INVALID_OPTIONS, 'testNode() requires an options object');
  }
  if (typeof options.mnemonic !== 'string' || options.mnemonic.trim().split(/\s+/).length < 12) {
    throw new ValidationError(ErrorCodes.INVALID_MNEMONIC, 'mnemonic must be a 12+ word BIP39 string');
  }
  if (!options.nodeAddress || !options.nodeAddress.startsWith('sentnode')) {
    throw new ValidationError(ErrorCodes.INVALID_NODE_ADDRESS, 'nodeAddress must be a valid sentnode1... address');
  }

  const {
    mnemonic,
    nodeAddress,
    rpcUrl,
    lcdUrl,
    v2rayExePath,
    gigabytes = 1,
    testMb = 5,
    baselineMbps = null,
    onLog = null,
    onProgress = null,
    signal = null,
  } = options;

  // Ensure cleanup handlers are registered (connectDirect requires it)
  registerCleanupHandlers();

  const log = (msg) => { if (onLog) onLog(msg); };
  const progress = (step, detail) => { if (onProgress) onProgress(step, detail); };

  const timestamp = new Date().toISOString();
  let connResult = null;
  let serviceType = null;
  let moniker = '';
  let country = '';
  let city = '';
  let actualMbps = 0;
  let googleAccessible = false;
  let diag = '';
  let pass = false;

  try {
    // ── Step 1: Connect via the SDK's consumer path ──
    progress('connect', `Connecting to ${nodeAddress}...`);
    log(`[testNode] Connecting to ${nodeAddress}`);

    connResult = await connectDirect({
      mnemonic,
      nodeAddress,
      rpcUrl,
      lcdUrl,
      v2rayExePath,
      gigabytes,
      fullTunnel: serviceType === 'wireguard', // WG: full tunnel for speedtest, V2Ray: SOCKS5
      systemProxy: false, // Never set system proxy during testing
      onProgress: (step, detail) => progress(`connect:${step}`, detail),
      signal,
      _skipLock: true, // Allow concurrent tests (audit mode)
    });

    serviceType = connResult.serviceType;
    log(`[testNode] Connected: ${serviceType} (session ${connResult.sessionId})`);

    // Extract node metadata from the connection result if available
    if (connResult.nodeMoniker) moniker = connResult.nodeMoniker;
    if (connResult.nodeLocation) {
      country = connResult.nodeLocation.country || '';
      city = connResult.nodeLocation.city || '';
    }

    // If we don't have moniker/location from connResult, fetch node status
    if (!moniker || !country) {
      try {
        const lcdBase = lcdUrl || DEFAULT_LCD;
        const { queryNode } = await import('./cosmjs-setup.js');
        const nodeInfo = await queryNode(nodeAddress, { lcdUrl: lcdBase });
        if (nodeInfo.remote_url) {
          const status = await nodeStatusV3(nodeInfo.remote_url);
          moniker = moniker || status.moniker;
          country = country || status.location.country;
          city = city || status.location.city;
        }
      } catch {
        // Metadata fetch failed -- non-fatal, continue with empty fields
      }
    }

    // ── Step 2: Speed test ──
    progress('speedtest', `Running speed test (${testMb}MB)...`);
    log(`[testNode] Running speed test (${serviceType})`);

    try {
      let speedResult;
      if (serviceType === 'wireguard') {
        speedResult = await speedtestDirect();
      } else if (serviceType === 'v2ray' && connResult.socksPort) {
        speedResult = await speedtestViaSocks5(testMb, connResult.socksPort);
      }
      if (speedResult) {
        actualMbps = speedResult.mbps || 0;
        log(`[testNode] Speed: ${actualMbps} Mbps (${speedResult.adaptive || 'unknown'})`);
      }
    } catch (speedErr) {
      diag += `speedtest_failed: ${speedErr.message}; `;
      log(`[testNode] Speed test failed: ${speedErr.message}`);
    }

    // ── Step 3: Google accessibility ──
    progress('google', 'Checking Google accessibility...');
    log('[testNode] Checking Google accessibility');

    try {
      googleAccessible = await _checkGoogleAccessible(
        serviceType,
        connResult.socksPort,
      );
      log(`[testNode] Google accessible: ${googleAccessible}`);
    } catch (googleErr) {
      diag += `google_check_failed: ${googleErr.message}; `;
      log(`[testNode] Google check failed: ${googleErr.message}`);
    }

    // ── Determine pass/fail ──
    // Pass: connected + has some measurable speed + Google is accessible
    pass = actualMbps > 0 && googleAccessible;
    if (pass) {
      diag = diag || 'ok';
    } else if (!googleAccessible) {
      diag += 'google_unreachable; ';
    }

  } catch (connectErr) {
    // Connection failed entirely
    diag = `connect_failed: ${connectErr.code || connectErr.name}: ${connectErr.message}`;
    log(`[testNode] Connection failed: ${diag}`);

    // Try to extract node metadata from the error or via status probe
    if (!moniker || !country) {
      try {
        const lcdBase = lcdUrl || DEFAULT_LCD;
        const { queryNode } = await import('./cosmjs-setup.js');
        const nodeInfo = await queryNode(nodeAddress, { lcdUrl: lcdBase });
        if (nodeInfo.remote_url) {
          const status = await nodeStatusV3(nodeInfo.remote_url);
          serviceType = serviceType || status.type;
          moniker = moniker || status.moniker;
          country = country || status.location.country;
          city = city || status.location.city;
        }
      } catch {
        // Can't reach node at all
      }
    }
  } finally {
    // ── Step 4: Disconnect (always) ──
    progress('disconnect', 'Disconnecting...');
    try {
      if (connResult?.cleanup) {
        await connResult.cleanup();
      } else {
        await disconnect();
      }
      log('[testNode] Disconnected');
    } catch (dcErr) {
      log(`[testNode] Disconnect warning: ${dcErr.message}`);
    }
  }

  const result = {
    pass,
    address: nodeAddress,
    type: serviceType || 'unknown',
    moniker,
    country,
    city,
    actualMbps: parseFloat(actualMbps.toFixed(2)),
    googleAccessible,
    diag: diag.replace(/;\s*$/, '') || 'unknown',
    timestamp,
  };

  // Record transport cache data for V2Ray nodes
  if (serviceType === 'v2ray' && connResult?.outbound) {
    try {
      const obTag = connResult.outbound;
      // Parse transport info from outbound tag (format: "proto-network-security-port")
      const parts = obTag.split('-');
      if (parts.length >= 2) {
        const transport = {
          protocol: parts[0] || 'vmess',
          network: parts[1] || 'tcp',
          security: parts[2] || 'none',
          port: parseInt(parts[3]) || 0,
        };
        if (pass) {
          recordTransportSuccess(nodeAddress, transport);
        } else {
          recordTransportFailure(transport);
        }
      }
    } catch {
      // Transport cache update failed -- non-fatal
    }
  }

  return result;
}

// ─── auditNetwork ─────────────────────────────────────────────────────────────

/**
 * Audit the Sentinel dVPN network by testing all (or some) active nodes.
 *
 * Flow:
 *   1. Wallet setup + balance check
 *   2. Fetch all active nodes from LCD
 *   3. Parallel online scan (probe each node's status endpoint)
 *   4. For each viable node: testNode() with retry
 *   5. Emit progress events, return results + stats
 *
 * @param {object} options
 * @param {string} options.mnemonic - BIP39 wallet mnemonic (required)
 * @param {string} [options.rpcUrl] - RPC endpoint URL
 * @param {string} [options.lcdUrl] - LCD endpoint URL
 * @param {string} [options.v2rayExePath] - Path to v2ray binary
 * @param {number} [options.concurrency=30] - Parallel status scan concurrency
 * @param {number} [options.batchSize=5] - Payment batching (for display only; testNode pays individually)
 * @param {number} [options.gigabytesPerNode=1] - GB per session
 * @param {number} [options.testMb=5] - Speed test download size (MB)
 * @param {number} [options.maxNodes=0] - 0 = test all viable nodes
 * @param {Array} [options.resume=null] - Previous results array to skip already-tested nodes
 * @param {function} [options.onProgress=null] - Called with each test result: (result) => {}
 * @param {function} [options.onLog=null] - Log callback: (msg) => {}
 * @param {function} [options.onBatchPayment=null] - Called per batch: (batchNum, total) => {}
 * @param {AbortSignal} [options.signal=null] - AbortSignal for cancellation
 * @returns {Promise<{
 *   results: Array<object>,
 *   stats: {
 *     total: number,
 *     tested: number,
 *     passed: number,
 *     failed: number,
 *     skipped: number,
 *     avgMbps: number,
 *     googleAccessiblePct: number,
 *     durationMs: number,
 *   },
 * }>}
 */
export async function auditNetwork(options) {
  // ── Validate inputs ──
  if (!options || typeof options !== 'object') {
    throw new ValidationError(ErrorCodes.INVALID_OPTIONS, 'auditNetwork() requires an options object');
  }
  if (typeof options.mnemonic !== 'string' || options.mnemonic.trim().split(/\s+/).length < 12) {
    throw new ValidationError(ErrorCodes.INVALID_MNEMONIC, 'mnemonic must be a 12+ word BIP39 string');
  }

  const {
    mnemonic,
    rpcUrl,
    lcdUrl,
    v2rayExePath,
    concurrency = 30,
    batchSize = 5,
    gigabytesPerNode = 1,
    testMb = 5,
    maxNodes = 0,
    resume = null,
    onProgress = null,
    onLog = null,
    onBatchPayment = null,
    signal = null,
  } = options;

  const log = (msg) => { if (onLog) onLog(msg); };
  const auditStart = Date.now();
  const results = [];

  // Ensure cleanup handlers are registered (idempotent)
  registerCleanupHandlers();

  // Build skip set from resume data
  const skipSet = new Set();
  if (resume && Array.isArray(resume)) {
    for (const r of resume) {
      if (r.address) skipSet.add(r.address);
    }
    log(`[audit] Resuming: ${skipSet.size} nodes already tested, will skip`);
  }

  // ── Step 1: Wallet setup + balance check ──
  log('[audit] Setting up wallet...');
  _checkAborted(signal);

  let walletAddress = '';
  let balanceDvpn = 0;
  try {
    const { wallet, account } = await createWallet(mnemonic);
    walletAddress = account.address;

    const clientResult = rpcUrl
      ? { result: await createClient(rpcUrl, wallet) }
      : await tryWithFallback(RPC_ENDPOINTS, async (url) => createClient(url, wallet), 'RPC connect');
    const client = clientResult.result || clientResult;
    const bal = await getBalance(client, walletAddress);
    balanceDvpn = bal.dvpn;
    log(`[audit] Wallet: ${walletAddress} | ${balanceDvpn.toFixed(1)} P2P`);

    if (balanceDvpn < 1) {
      throw new ChainError(
        ErrorCodes.INSUFFICIENT_BALANCE,
        `Wallet has ${balanceDvpn.toFixed(2)} P2P -- need at least 1 P2P for network audit. Fund ${walletAddress}.`,
        { balance: bal, address: walletAddress },
      );
    }
  } catch (err) {
    if (err.code === ErrorCodes.INSUFFICIENT_BALANCE) throw err;
    log(`[audit] Wallet setup warning: ${err.message}`);
  }

  // ── Step 2: Fetch all active nodes ──
  log('[audit] Fetching active nodes from chain...');
  _checkAborted(signal);

  let allNodes;
  try {
    allNodes = await queryOnlineNodes({
      lcdUrl,
      maxNodes: maxNodes > 0 ? maxNodes * 3 : 5000, // Fetch extra for filtering
      concurrency,
      noCache: true,
      sort: true,
    });
    log(`[audit] Found ${allNodes.length} online nodes`);
  } catch (err) {
    throw new ChainError(
      ErrorCodes.LCD_ERROR,
      `Failed to fetch nodes: ${err.message}`,
      { original: err.message },
    );
  }

  // ── Step 3: Filter and prepare test queue ──
  const brokenAddrs = new Set(BROKEN_NODES.map(n => n.address));
  let viableNodes = allNodes.filter(n =>
    !brokenAddrs.has(n.address) &&
    !skipSet.has(n.address),
  );

  if (maxNodes > 0 && viableNodes.length > maxNodes) {
    viableNodes = viableNodes.slice(0, maxNodes);
  }

  const totalToTest = viableNodes.length;
  log(`[audit] Testing ${totalToTest} nodes (${skipSet.size} skipped from resume, ${brokenAddrs.size} known broken)`);

  // ── Step 4: Test each node sequentially ──
  // Sequential testing is required because:
  //   - connectDirect uses system-level tunnels (WireGuard) that conflict when parallel
  //   - Each test creates/tears down a tunnel -- cannot have multiple active tunnels
  let testedCount = 0;
  let passedCount = 0;
  let failedCount = 0;
  let totalMbps = 0;
  let googleCount = 0;

  for (let i = 0; i < viableNodes.length; i++) {
    _checkAborted(signal);

    const node = viableNodes[i];
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(viableNodes.length / batchSize);

    if (i % batchSize === 0 && onBatchPayment) {
      onBatchPayment(batchNum, totalBatches);
    }

    log(`[audit] [${i + 1}/${totalToTest}] Testing ${node.address} (${node.moniker || 'unknown'}, ${node.serviceType || 'unknown'})...`);

    let result;
    try {
      result = await testNode({
        mnemonic,
        nodeAddress: node.address,
        rpcUrl,
        lcdUrl,
        v2rayExePath,
        gigabytes: gigabytesPerNode,
        testMb,
        onLog,
        signal,
      });
    } catch (err) {
      // testNode should not throw (it catches internally), but handle just in case
      result = {
        pass: false,
        address: node.address,
        type: node.serviceType || 'unknown',
        moniker: node.moniker || '',
        country: node.country || '',
        city: node.city || '',
        actualMbps: 0,
        googleAccessible: false,
        diag: `unexpected_error: ${err.message}`,
        timestamp: new Date().toISOString(),
      };
    }

    // Merge node metadata from scan if missing from result
    if (!result.moniker && node.moniker) result.moniker = node.moniker;
    if (!result.country && node.country) result.country = node.country;
    if (!result.city && node.city) result.city = node.city;
    if (result.type === 'unknown' && node.serviceType) result.type = node.serviceType;

    results.push(result);
    testedCount++;

    if (result.pass) {
      passedCount++;
      totalMbps += result.actualMbps;
    } else {
      failedCount++;
    }
    if (result.googleAccessible) googleCount++;

    // Emit progress
    if (onProgress) {
      try {
        onProgress(result);
      } catch {
        // Progress callback error -- non-fatal
      }
    }

    log(`[audit] [${i + 1}/${totalToTest}] ${result.pass ? 'PASS' : 'FAIL'} ${node.address} | ${result.actualMbps} Mbps | Google: ${result.googleAccessible}`);
  }

  // ── Step 5: Compute stats ──
  const durationMs = Date.now() - auditStart;
  const stats = {
    total: totalToTest + skipSet.size,
    tested: testedCount,
    passed: passedCount,
    failed: failedCount,
    skipped: skipSet.size,
    avgMbps: passedCount > 0 ? parseFloat((totalMbps / passedCount).toFixed(2)) : 0,
    googleAccessiblePct: testedCount > 0
      ? parseFloat(((googleCount / testedCount) * 100).toFixed(1))
      : 0,
    durationMs,
  };

  log(`[audit] Complete: ${passedCount}/${testedCount} passed, avg ${stats.avgMbps} Mbps, ${stats.googleAccessiblePct}% Google accessible, ${(durationMs / 1000 / 60).toFixed(1)} min`);

  return { results, stats };
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Check if an AbortSignal has been triggered.
 * @param {AbortSignal|null} signal
 * @throws {SentinelError} if aborted
 * @private
 */
function _checkAborted(signal) {
  if (signal?.aborted) {
    throw new SentinelError(ErrorCodes.ABORTED, 'Audit was cancelled');
  }
}
