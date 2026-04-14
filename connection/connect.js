/**
 * Connection Orchestration — connectDirect, connectAuto, connectViaPlan,
 * connectViaSubscription, quickConnect, createConnectConfig.
 *
 * Core connection flows that handle payment, handshake, and tunnel setup.
 */

import {
  events, _defaultState, progress, checkAborted,
  warnIfNoCleanup, cachedCreateWallet, _recordMetric,
  broadcastWithInactiveRetry, getConnectLock, setConnectLock,
  getAbortConnect, setAbortConnect,
} from './state.js';

import {
  createClient, privKeyFromMnemonic, broadcastWithFeeGrant,
  extractId, findExistingSession, getBalance, MSG_TYPES, queryNode,
  isMnemonicValid, filterNodes,
} from '../cosmjs-setup.js';
import { nodeStatusV3, waitForPort } from '../v3protocol.js';
import {
  saveState, clearState, markSessionPoisoned, markSessionActive, isSessionPoisoned,
} from '../state.js';
import {
  DEFAULT_RPC, DEFAULT_LCD, RPC_ENDPOINTS, LCD_ENDPOINTS,
  DEFAULT_TIMEOUTS, sleep, tryWithFallback,
} from '../defaults.js';
import {
  SentinelError, ValidationError, NodeError, ChainError, TunnelError, ErrorCodes,
} from '../errors.js';
import { createNodeHttpsAgent } from '../tls-trust.js';
import { disconnectWireGuard } from '../wireguard.js';

import { disconnectState } from './disconnect.js';
import { queryOnlineNodes } from './discovery.js';
import {
  recordNodeFailure, isCircuitOpen, configureCircuitBreaker,
  clearCircuitBreaker, tryFastReconnect,
} from './resilience.js';
import { performHandshake, validateTunnelRequirements, killV2RayProc, verifyDependencies } from './tunnel.js';
import { verifyConnection } from './state.js';
import { registerCleanupHandlers } from './disconnect.js';

let defaultLog = console.log;

// ─── Shared Validation ───────────────────────────────────────────────────────

function validateConnectOpts(opts, fnName) {
  if (!opts || typeof opts !== 'object') throw new ValidationError(ErrorCodes.INVALID_OPTIONS, `${fnName}() requires an options object`);
  if (typeof opts.mnemonic !== 'string') {
    throw new ValidationError(ErrorCodes.INVALID_MNEMONIC, 'mnemonic must be a string', { wordCount: 0 });
  }
  const words = opts.mnemonic.trim().split(/\s+/);
  if (words.length < 12) {
    throw new ValidationError(ErrorCodes.INVALID_MNEMONIC, 'mnemonic must have at least 12 words', { wordCount: words.length });
  }
  if (!isMnemonicValid(opts.mnemonic)) {
    throw new ValidationError(ErrorCodes.INVALID_MNEMONIC, 'mnemonic contains invalid BIP39 words or failed checksum', { wordCount: words.length });
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
    if (!opts.dryRun && !opts.feeGranter && bal.udvpn < 100000) {
      throw new ChainError(ErrorCodes.INSUFFICIENT_BALANCE,
        `Wallet has ${bal.dvpn.toFixed(2)} P2P — need at least 0.1 P2P for a session. Fund address ${account.address} with P2P tokens.`,
        { balance: bal, address: account.address }
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

  // 2c. PRE-PAYMENT PORT PROBE — verify V2Ray node has open transport ports
  // before spending P2P tokens. Prevents paying for sessions on nodes whose
  // V2Ray service crashed (status API responds but V2Ray ports are dead).
  // WireGuard skips this — WG uses a single UDP port that can't be TCP-probed.
  if (status.type === 'v2ray') {
    const serverHost = new URL(nodeInfo.remote_url).hostname;
    const probePorts = [8686, 8787, 7874, 7876, 443, 8443];
    let anyOpen = false;
    for (const port of probePorts) {
      if (await waitForPort(port, 2000, serverHost)) {
        anyOpen = true;
        progress(onProgress, logFn, 'validate', `V2Ray port ${port} open on ${serverHost}`);
        break;
      }
    }
    if (!anyOpen) {
      throw new NodeError(ErrorCodes.NODE_OFFLINE,
        `V2Ray node ${opts.nodeAddress} has no open transport ports (probed ${probePorts.join(',')} on ${serverHost}). Node status API responds but V2Ray service is dead. Skipping to save tokens.`,
        { nodeAddress: opts.nodeAddress, serverHost, probedPorts: probePorts });
    }
  }

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
    const st = err?.details?.status;
    return msg.includes('already exists') || st === 409;
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
 * @param {string} opts.v2rayExePath - Path to v2ray.exe (auto-detected if missing)
 * @param {boolean} opts.fullTunnel - WireGuard: route ALL traffic through VPN (default: true).
 * @param {string[]} opts.splitIPs - WireGuard split tunnel IPs. Overrides fullTunnel.
 * @param {boolean} opts.systemProxy - V2Ray: auto-set Windows system SOCKS proxy (default: false).
 * @param {boolean} opts.killSwitch - Enable kill switch (default: false). Windows only.
 * @param {boolean} opts.forceNewSession - Always pay for a new session (default: false).
 * @param {function} opts.onProgress - Optional callback: (step, detail) => void
 * @param {function} opts.log - Optional log function (default: console.log).
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
  const ownsLock = !opts._skipLock && !getConnectLock();
  if (!opts._skipLock && getConnectLock()) throw new SentinelError(ErrorCodes.ALREADY_CONNECTED, 'Connection already in progress');
  if (ownsLock) setConnectLock(true);
  try {

  const gigabytes = opts.gigabytes || 1;
  const forceNewSession = !!opts.forceNewSession;

  // ── Fast Reconnect: check for saved credentials ──
  if (!forceNewSession) {
    // Set mnemonic on state BEFORE fast reconnect — needed for _endSessionOnChain() on disconnect
    (opts._state || _defaultState)._mnemonic = opts.mnemonic;
    const fast = await tryFastReconnect(opts, opts._state || _defaultState);
    if (fast) {
      clearCircuitBreaker(opts.nodeAddress);
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

    // v34: Pre-payment price validation. Some nodes have prices that pass registration
    // but fail MsgStartSession (chain code 106 "invalid price"). Known bad pattern:
    // base_value containing "0.005" with quote_value "25000000". Skip these to save gas.
    const bv = udvpnPrice.base_value || '';
    if (bv.startsWith('0.005') || bv === '5000000000000000') {
      throw new NodeError(ErrorCodes.NODE_OFFLINE,
        `Node ${opts.nodeAddress} has a price (${bv}) known to be rejected by chain MsgStartSession (code 106 "invalid price"). Skipping to save gas.`,
        { nodeAddress: opts.nodeAddress, baseValue: bv, quoteValue: udvpnPrice.quote_value });
    }

    // Determine pricing model: explicit hours > preferHourly > default GB
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
        nodeAddress: opts.nodeAddress,
        gigabytes: sessionGigabytes,
        hours: sessionHours,
        maxPrice: { denom: 'udvpn', base_value: sessionMaxPrice.base_value, quote_value: sessionMaxPrice.quote_value },
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
        nodeAddress: opts.nodeAddress,
        gigabytes: retryGigabytes,
        hours: retryHours,
        maxPrice: { denom: 'udvpn', base_value: retryMaxPrice.base_value, quote_value: retryMaxPrice.quote_value },
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
  clearCircuitBreaker(opts.nodeAddress);
  return result;

  } finally { if (ownsLock) setConnectLock(false); }
}

// ─── Auto-Connect with Fallback ─────────────────────────────────────────────

/**
 * Connect with auto-fallback: on failure, try next best node automatically.
 * Uses queryOnlineNodes to find candidates, then tries up to `maxAttempts` nodes.
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
  if (getConnectLock()) throw new SentinelError(ErrorCodes.ALREADY_CONNECTED, 'Connection already in progress');
  setConnectLock(true);
  setAbortConnect(false); // v30: reset abort flag at start of new connection attempt
  try {

  // v25: per-call circuit breaker config
  if (opts.circuitBreaker) configureCircuitBreaker(opts.circuitBreaker);

  const maxAttempts = opts.maxAttempts || 3;
  const logFn = opts.log || console.log;
  const errors = [];

  // If nodeAddress specified, try it first (skip circuit breaker check for explicit choice)
  if (opts.nodeAddress) {
    // v30: Check abort flag before each attempt
    if (getAbortConnect()) {
      setAbortConnect(false);
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
  if (getAbortConnect()) {
    setAbortConnect(false);
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
  for (let i = 0; i < Math.min(candidates.length, maxAttempts); i++) {
    // v30: Check abort flag before each retry — disconnect() sets this
    if (getAbortConnect()) {
      setAbortConnect(false);
      throw new SentinelError(ErrorCodes.ABORTED, 'Connection was cancelled by disconnect');
    }
    const node = candidates[i];
    logFn(`[connectAuto] Trying ${node.address} (${i + 1}/${Math.min(candidates.length, maxAttempts)})...`);
    try {
      return await connectDirect({ ...opts, nodeAddress: node.address, _skipLock: true });
    } catch (err) {
      recordNodeFailure(node.address);
      errors.push({ address: node.address, error: err.message });
      logFn(`[connectAuto] ${node.address} failed: ${err.message}`);
    }
  }

  throw new SentinelError(ErrorCodes.ALL_NODES_FAILED,
    `All ${errors.length} nodes failed`,
    { attempts: errors });

  } finally { setConnectLock(false); }
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
 * @param {boolean} opts.killSwitch - Enable kill switch (default: false)
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
  if (getConnectLock()) throw new SentinelError(ErrorCodes.ALREADY_CONNECTED, 'Connection already in progress');
  setConnectLock(true);
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
    const feeGranter = opts.feeGranter || null;

    progress(null, opts.log || defaultLog, 'session', `Subscribing to plan ${opts.planId} + starting session${feeGranter ? ' (fee granted)' : ''}...`);

    let result;
    if (feeGranter) {
      try {
        result = await broadcastWithFeeGrant(client, account.address, [msg], feeGranter);
      } catch (feeErr) {
        // Fee grant TX failed — fall back to user-paid
        progress(null, opts.log || defaultLog, 'session', 'Fee grant failed, paying gas from wallet...');
        result = await broadcastWithInactiveRetry(client, account.address, [msg], opts.log || defaultLog, opts.onProgress);
      }
    } else {
      result = await broadcastWithInactiveRetry(client, account.address, [msg], opts.log || defaultLog, opts.onProgress);
    }
    const planExtracted = extractId(result, /session/i, ['session_id', 'id']);
    if (!planExtracted) throw new ChainError(ErrorCodes.SESSION_EXTRACT_FAILED, 'Failed to extract session ID from plan TX result — check TX events', { txHash: result.transactionHash });
    const sessionId = BigInt(planExtracted);
    const subscriptionId = extractId(result, /subscription/i, ['subscription_id', 'id']);
    progress(null, opts.log || defaultLog, 'session', `Session: ${sessionId}${subscriptionId ? `, Subscription: ${subscriptionId}` : ''}`);
    return { sessionId, subscriptionId };
  }

  // No retry for plan connections (plan payment is idempotent)
  const result = await connectInternal(opts, planPayment, null, opts._state || _defaultState);
  return result;

  } finally { setConnectLock(false); }
}

// ─── Subscription Connection (Use existing subscription) ─────────────────

/**
 * Connect via an existing subscription.
 *
 * Flow: start session via subscription → handshake → tunnel
 *
 * @param {object} opts
 * @param {string} opts.mnemonic - BIP39 mnemonic
 * @param {number|string} opts.subscriptionId - Existing subscription ID
 * @param {string} opts.nodeAddress - sentnode1... address
 * @param {string} opts.rpcUrl - Chain RPC
 * @param {string} opts.lcdUrl - Chain LCD
 * @param {string} opts.v2rayExePath - Path to v2ray.exe (auto-detected if missing)
 * @param {boolean} opts.fullTunnel - WireGuard: route ALL traffic (default: true)
 * @param {string[]} opts.splitIPs - WireGuard split tunnel IPs (overrides fullTunnel)
 * @param {boolean} opts.systemProxy - V2Ray: auto-set Windows system proxy (default: false)
 * @param {boolean} opts.killSwitch - Enable kill switch (default: false)
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
  if (getConnectLock()) throw new SentinelError(ErrorCodes.ALREADY_CONNECTED, 'Connection already in progress');
  setConnectLock(true);
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

    // Fee grant: operator pays gas for the agent (e.g., x402 managed plan flow)
    const feeGranter = opts.feeGranter || null;
    progress(null, opts.log || defaultLog, 'session', `Starting session via subscription ${opts.subscriptionId}${feeGranter ? ' (fee granted)' : ''}...`);

    let result;
    if (feeGranter) {
      try {
        result = await broadcastWithFeeGrant(client, account.address, [msg], feeGranter);
      } catch (feeErr) {
        // Fee grant TX failed — fall back to user-paid
        progress(null, opts.log || defaultLog, 'session', 'Fee grant failed, paying gas from wallet...');
        result = await broadcastWithInactiveRetry(client, account.address, [msg], opts.log || defaultLog, opts.onProgress);
      }
    } else {
      result = await broadcastWithInactiveRetry(client, account.address, [msg], opts.log || defaultLog, opts.onProgress);
    }
    const extracted = extractId(result, /session/i, ['session_id', 'id']);
    if (!extracted) throw new ChainError(ErrorCodes.SESSION_EXTRACT_FAILED, 'Failed to extract session ID from subscription TX result', { txHash: result.transactionHash });
    const sessionId = BigInt(extracted);
    progress(null, opts.log || defaultLog, 'session', `Session: ${sessionId} (subscription ${opts.subscriptionId})`);
    return { sessionId, subscriptionId: opts.subscriptionId };
  }

  const result = await connectInternal(opts, subPayment, null, opts._state || _defaultState);
  return result;

  } finally { setConnectLock(false); }
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
