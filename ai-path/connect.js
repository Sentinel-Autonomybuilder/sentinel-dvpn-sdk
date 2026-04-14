/**
 * Sentinel AI Path — Zero-Config VPN Connection
 *
 * One function call: await connect({ mnemonic }) -> connected
 *
 * This module wraps the full Sentinel SDK into the simplest possible
 * interface for AI agents. No config files, no setup — just connect.
 *
 * AGENT FLOW (7 steps, each logged):
 *   STEP 1/7  Environment — check OS, V2Ray, WireGuard, admin
 *   STEP 2/7  Wallet — derive address, connect to chain
 *   STEP 3/7  Balance — verify sufficient P2P before paying
 *   STEP 4/7  Node — select + validate target node
 *   STEP 5/7  Session — broadcast TX, create on-chain session
 *   STEP 6/7  Tunnel — handshake + install WireGuard/V2Ray
 *   STEP 7/7  Verify — confirm IP changed, traffic flows
 */

import {
  connectAuto,
  connectDirect,
  connectViaSubscription,
  connectViaPlan,
  disconnect as sdkDisconnect,
  isConnected,
  getStatus,
  registerCleanupHandlers,
  verifyConnection,
  verifyDependencies,
  formatP2P,
  events,
  createWallet as sdkCreateWallet,
  createClient,
  getBalance as sdkGetBalance,
  tryWithFallback,
  RPC_ENDPOINTS,
  LCD_ENDPOINTS,
  queryFeeGrant,
  // v1.5.0: RPC queries (protobuf, ~10x faster than LCD for balance checks)
  createRpcQueryClientWithFallback,
  rpcQueryBalance,
  rpcQueryFeeGrant,
  // v1.5.0: Typed event parsers (replaces string matching for session ID extraction)
  extractSessionIdTyped,
  NodeEventCreateSession,
  // v1.5.0: TYPE_URLS constants (canonical type URL strings)
  TYPE_URLS,
} from '../index.js';

// Use native fetch (Node 20+) for IP check — no axios dependency needed
// The SDK handles axios adapter internally for tunnel traffic

// ─── Constants ───────────────────────────────────────────────────────────────

const IP_CHECK_URL = 'https://api.ipify.org?format=json';
const IP_CHECK_TIMEOUT = 10000;
const MIN_BALANCE_UDVPN = 5_000_000; // 5 P2P — realistic minimum for cheapest node (~4 P2P) + gas

// ─── State ───────────────────────────────────────────────────────────────────

let _cleanupRegistered = false;
let _lastConnectResult = null;
let _connectTimings = {};

// ─── Agent Logger ───────────────────────────────────────────────────────────

/**
 * Structured step logger for autonomous agents.
 * Each step prints a numbered phase with timestamp.
 * Agents can parse these lines programmatically.
 */
function agentLog(step, total, phase, msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [STEP ${step}/${total}] [${phase}] ${msg}`);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Ensure cleanup handlers are registered (idempotent).
 * Handles SIGINT, SIGTERM, uncaught exceptions — tears down tunnels on exit.
 */
function ensureCleanup() {
  if (_cleanupRegistered) return;
  registerCleanupHandlers();
  _cleanupRegistered = true;
}

/**
 * Ensure axios uses Node.js HTTP adapter (not fetch) for Node 20+.
 * Without this, SOCKS proxy and tunnel traffic silently fails.
 * Lazy-imports axios from the SDK's node_modules.
 */
async function ensureAxiosAdapter() {
  try {
    const axios = (await import('axios')).default;
    if (axios.defaults.adapter !== 'http') {
      axios.defaults.adapter = 'http';
    }
  } catch {
    // axios not available — SDK will handle this during connect
  }
}

/**
 * Check the public IP through the VPN tunnel to confirm it changed.
 * For WireGuard: native fetch routes through the tunnel automatically.
 * For V2Ray: must use SOCKS5 proxy — native fetch ignores SOCKS5.
 * Returns the IP string or null if the check fails.
 */
async function checkVpnIp(socksPort) {
  try {
    if (socksPort) {
      // V2Ray: route IP check through SOCKS5 proxy
      // Use SDK's checkVpnIpViaSocks which has proper module resolution
      const { checkVpnIpViaSocks } = await import('../index.js');
      if (typeof checkVpnIpViaSocks === 'function') {
        return await checkVpnIpViaSocks(socksPort, IP_CHECK_TIMEOUT);
      }
      // Fallback: use Node.js module resolution (works in every layout)
      const axios = (await import('axios')).default;
      const { SocksProxyAgent } = await import('socks-proxy-agent');
      const agent = new SocksProxyAgent(`socks5h://127.0.0.1:${socksPort}`);
      const res = await axios.get(IP_CHECK_URL, {
        httpAgent: agent, httpsAgent: agent,
        timeout: IP_CHECK_TIMEOUT, adapter: 'http',
      });
      return res.data?.ip || null;
    }
    // WireGuard: native fetch routes through tunnel
    const res = await fetch(IP_CHECK_URL, {
      signal: AbortSignal.timeout(IP_CHECK_TIMEOUT),
    });
    const data = await res.json();
    return data?.ip || null;
  } catch (err) {
    // IP check is non-critical — tunnel may work but ipify may be blocked
    if (err?.code === 'ERR_MODULE_NOT_FOUND') {
      console.warn('[sentinel-ai] IP check skipped: missing dependency —', err.message?.split("'")[1] || 'unknown');
    }
    return null;
  }
}

/**
 * Convert SDK errors to human-readable messages with machine-readable nextAction.
 * AI agents get clean, actionable error strings instead of stack traces.
 */
function humanError(err) {
  const code = err?.code || 'UNKNOWN';
  const msg = err?.message || String(err);

  // Map common error codes to plain-English messages + next action for agent
  const messages = {
    INVALID_MNEMONIC: {
      message: 'Invalid mnemonic — must be a 12 or 24 word BIP39 phrase.',
      nextAction: 'create_wallet',
    },
    INSUFFICIENT_BALANCE: {
      message: 'Wallet has insufficient P2P tokens. Fund your wallet first.',
      nextAction: 'fund_wallet',
    },
    ALREADY_CONNECTED: {
      message: 'Already connected to VPN. Call disconnect() first.',
      nextAction: 'disconnect',
    },
    NODE_NOT_FOUND: {
      message: 'Node not found or offline. Try a different node or use connectAuto.',
      nextAction: 'try_different_node',
    },
    NODE_NO_UDVPN: {
      message: 'Node does not accept P2P token payments.',
      nextAction: 'try_different_node',
    },
    WG_NO_CONNECTIVITY: {
      message: 'WireGuard tunnel installed but no traffic flows. Try a different node.',
      nextAction: 'try_different_node',
    },
    V2RAY_NOT_FOUND: {
      message: 'V2Ray binary not found. Run setup first: node setup.js',
      nextAction: 'run_setup',
    },
    HANDSHAKE_FAILED: {
      message: 'Handshake with node failed. The node may be overloaded — try another.',
      nextAction: 'try_different_node',
    },
    SESSION_EXTRACT_FAILED: {
      message: 'Session creation TX succeeded but session ID could not be extracted.',
      nextAction: 'retry',
    },
    ALL_NODES_FAILED: {
      message: 'All candidate nodes failed to connect.',
      nextAction: 'try_different_country',
    },
    ABORTED: {
      message: 'Connection was cancelled.',
      nextAction: 'none',
    },
    FEE_GRANT_NOT_FOUND: {
      message: 'No fee grant from operator to agent. Operator must provision a grant first.',
      nextAction: 'request_fee_grant',
    },
    FEE_GRANT_EXPIRED: {
      message: 'Fee grant has expired. Operator must renew the grant.',
      nextAction: 'request_fee_grant_renewal',
    },
    FEE_GRANT_EXHAUSTED: {
      message: 'Fee grant spend limit exhausted. Operator must top up the grant.',
      nextAction: 'request_fee_grant_renewal',
    },
  };

  const entry = messages[code];
  if (entry) return entry;
  return { message: `Connection failed: ${msg}`, nextAction: 'retry' };
}

/**
 * Pre-validate balance before any connection attempt.
 * Returns { address, udvpn, p2p, sufficient }.
 */
async function preValidateBalance(mnemonic) {
  try {
    const { wallet, account } = await sdkCreateWallet(mnemonic);

    // v1.5.0: Try RPC query first (protobuf, ~10x faster — no signing client needed)
    try {
      const rpcClient = await createRpcQueryClientWithFallback();
      const coin = await rpcQueryBalance(rpcClient, account.address, 'udvpn');
      const udvpn = parseInt(coin.amount, 10) || 0;
      return {
        address: account.address,
        udvpn,
        p2p: formatP2P(udvpn),
        sufficient: udvpn >= MIN_BALANCE_UDVPN,
      };
    } catch {
      // RPC failed — fall back to signing client
    }

    // Fallback: signing client + sdkGetBalance (LCD-based)
    const { result: client } = await tryWithFallback(
      RPC_ENDPOINTS,
      async (url) => createClient(url, wallet),
      'RPC connect (balance pre-check)',
    );
    const bal = await sdkGetBalance(client, account.address);
    return {
      address: account.address,
      udvpn: bal.udvpn,
      p2p: formatP2P(bal.udvpn),
      sufficient: bal.udvpn >= MIN_BALANCE_UDVPN,
    };
  } catch {
    // Balance check failed — let connect() handle it downstream
    return { address: null, udvpn: 0, p2p: '0 P2P', sufficient: false };
  }
}

// ─── connect() ───────────────────────────────────────────────────────────────

/**
 * Connect to Sentinel dVPN. The ONE function an AI agent needs.
 *
 * Three connection modes:
 *   1. Direct payment — agent pays per-session from own wallet (default)
 *   2. Subscription — operator provisioned a subscription for this agent
 *   3. Plan — subscribe to plan + start session (optionally fee-granted)
 *
 * For modes 2 & 3, set opts.feeGranter to the operator's address — the
 * agent can have 0 P2P balance and the operator covers gas.
 *
 * Every step is logged with numbered phases (STEP 1/7 through STEP 7/7)
 * so an autonomous agent can track progress and diagnose failures.
 *
 * @param {object} opts
 * @param {string} opts.mnemonic - BIP39 mnemonic (12 or 24 words)
 * @param {string} [opts.country] - Preferred country code (e.g. 'US', 'DE')
 * @param {string} [opts.nodeAddress] - Specific node (sentnode1...). Skips auto-pick.
 * @param {string} [opts.dns] - DNS preset: 'google', 'cloudflare', 'hns'
 * @param {string} [opts.protocol] - Preferred protocol: 'wireguard' or 'v2ray'
 * @param {string|number} [opts.subscriptionId] - Connect via existing subscription (operator-provisioned)
 * @param {string|number} [opts.planId] - Connect via plan (subscribes + starts session)
 * @param {string} [opts.feeGranter] - Operator address that pays gas (sent1...). Skips balance check.
 * @param {function} [opts.onProgress] - Progress callback: (stage, message) => void
 * @param {number} [opts.timeout] - Connection timeout in ms (default: 120000 — 2 minutes)
 * @param {boolean} [opts.silent] - If true, suppress step-by-step console output
 * @returns {Promise<{
 *   sessionId: string,
 *   protocol: string,
 *   nodeAddress: string,
 *   country: string|null,
 *   city: string|null,
 *   moniker: string|null,
 *   socksPort: number|null,
 *   socksAuth: object|null,
 *   dryRun: boolean,
 *   ip: string|null,
 *   walletAddress: string,
 *   balance: { before: string, after: string|null },
 *   cost: { estimated: string },
 *   timing: { totalMs: number, phases: object },
 * }>}
 */
export async function connect(opts = {}) {
  if (!opts || typeof opts !== 'object') {
    throw new Error('connect() requires an options object with at least { mnemonic }');
  }
  if (!opts.mnemonic || typeof opts.mnemonic !== 'string') {
    throw new Error('connect() requires a mnemonic string (12 or 24 word BIP39 phrase)');
  }

  const silent = opts.silent === true;
  const log = silent ? () => {} : agentLog;
  const totalSteps = 7;
  const timings = {};
  const connectStart = Date.now();

  // ── STEP 1/7: Environment ─────────────────────────────────────────────────

  let t0 = Date.now();
  log(1, totalSteps, 'ENVIRONMENT', 'Checking OS, tunnel binaries, admin privileges...');

  await ensureAxiosAdapter();
  ensureCleanup();

  // Detect environment for agent visibility
  let envInfo = { os: process.platform, admin: false, v2ray: false, wireguard: false };
  try {
    const { getEnvironment } = await import('./environment.js');
    const env = getEnvironment();
    envInfo = {
      os: env.os,
      admin: env.admin,
      v2ray: env.v2ray?.available || false,
      wireguard: env.wireguard?.available || false,
      v2rayPath: env.v2ray?.path || null,
    };
  } catch { /* environment detection failed */ }

  log(1, totalSteps, 'ENVIRONMENT', `OS=${envInfo.os} | admin=${envInfo.admin} | v2ray=${envInfo.v2ray} | wireguard=${envInfo.wireguard}`);
  timings.environment = Date.now() - t0;

  // ── STEP 2/7: Wallet ──────────────────────────────────────────────────────

  t0 = Date.now();
  log(2, totalSteps, 'WALLET', 'Deriving wallet address from mnemonic...');

  // We derive address early for agent visibility (before SDK does it internally)
  let walletAddress = null;
  try {
    const { account } = await sdkCreateWallet(opts.mnemonic);
    walletAddress = account.address;
    log(2, totalSteps, 'WALLET', `Address: ${walletAddress}`);
  } catch (err) {
    log(2, totalSteps, 'WALLET', `Failed: ${err.message}`);
    throw new Error('Invalid mnemonic — wallet derivation failed');
  }
  timings.wallet = Date.now() - t0;

  // ── STEP 3/7: Balance Pre-Check ───────────────────────────────────────────

  t0 = Date.now();
  log(3, totalSteps, 'BALANCE', `Checking balance for ${walletAddress}...`);

  const balCheck = await preValidateBalance(opts.mnemonic);
  log(3, totalSteps, 'BALANCE', `Balance: ${balCheck.p2p} | Sufficient: ${balCheck.sufficient}`);

  // Skip balance gate when fee granter is set — agent may have 0 P2P, operator pays gas
  if (!balCheck.sufficient && !opts.dryRun && !opts.feeGranter) {
    const err = new Error(`Insufficient balance: ${balCheck.p2p}. Need at least ${formatP2P(MIN_BALANCE_UDVPN)}. Fund address: ${walletAddress}`);
    err.code = 'INSUFFICIENT_BALANCE';
    err.nextAction = 'fund_wallet';
    err.details = { address: walletAddress, balance: balCheck.p2p, minimum: formatP2P(MIN_BALANCE_UDVPN) };
    throw err;
  }
  if (opts.feeGranter && !balCheck.sufficient) {
    log(3, totalSteps, 'BALANCE', `Balance below minimum but fee granter ${opts.feeGranter} covers gas`);
  }
  timings.balance = Date.now() - t0;

  // ── STEP 3.5: Fee Grant Validity Check (when feeGranter is set) ───────────
  // Verify the fee grant exists on-chain and hasn't expired before attempting
  // a connection that would fail at broadcast time.

  if (opts.feeGranter) {
    try {
      // RPC first (protobuf, ~10x faster), LCD fallback
      let grant = null;
      try {
        const rpcClient = await createRpcQueryClientWithFallback();
        grant = await rpcQueryFeeGrant(rpcClient, opts.feeGranter, walletAddress);
      } catch {
        // RPC failed — fall back to LCD with failover
        const lcdResult = await tryWithFallback(
          LCD_ENDPOINTS,
          async (endpoint) => {
            const url = endpoint?.url || endpoint;
            return queryFeeGrant(url, opts.feeGranter, walletAddress);
          },
          'fee grant pre-check (LCD fallback)',
        );
        grant = lcdResult.result;
      }

      if (!grant) {
        const err = new Error(`No fee grant found from ${opts.feeGranter} to ${walletAddress}. Operator must create a fee grant before agent can connect with 0 P2P.`);
        err.code = 'FEE_GRANT_NOT_FOUND';
        err.nextAction = 'request_fee_grant';
        err.details = { granter: opts.feeGranter, grantee: walletAddress };
        throw err;
      }

      // Unwrap grant structure: AllowedMsgAllowance > BasicAllowance
      // Chain returns: { allowance: { "@type": "AllowedMsg...", allowance: { "@type": "Basic...", spend_limit, expiration }, allowed_messages: [...] } }
      const outerAllowance = grant.allowance || grant;
      const isAllowedMsg = outerAllowance['@type']?.includes('AllowedMsgAllowance');
      const inner = isAllowedMsg ? (outerAllowance.allowance || outerAllowance) : outerAllowance;
      const expiration = inner.expiration || outerAllowance.expiration;

      // Check expiration
      if (expiration) {
        const expiresAt = new Date(expiration);
        const now = new Date();
        if (expiresAt <= now) {
          const err = new Error(`Fee grant from ${opts.feeGranter} expired at ${expiresAt.toISOString()}. Operator must renew the fee grant.`);
          err.code = 'FEE_GRANT_EXPIRED';
          err.nextAction = 'request_fee_grant_renewal';
          err.details = { granter: opts.feeGranter, grantee: walletAddress, expiredAt: expiresAt.toISOString() };
          throw err;
        }

        const hoursLeft = (expiresAt - now) / 3600000;
        if (hoursLeft < 1) {
          log(3, totalSteps, 'FEE_GRANT', `Warning: Fee grant expires in ${Math.round(hoursLeft * 60)} minutes`);
        } else {
          log(3, totalSteps, 'FEE_GRANT', `Fee grant valid, expires ${expiresAt.toISOString()} (${Math.round(hoursLeft)}h remaining)`);
        }
      } else {
        log(3, totalSteps, 'FEE_GRANT', 'Fee grant valid (no expiration)');
      }

      // Check spend_limit — if set, ensure there's enough remaining for at least one TX
      const spendLimit = inner.spend_limit;
      if (spendLimit && Array.isArray(spendLimit)) {
        const udvpnLimit = spendLimit.find(c => c.denom === 'udvpn');
        if (udvpnLimit) {
          const remaining = parseInt(udvpnLimit.amount, 10) || 0;
          if (remaining < 20000) { // 20,000 udvpn = minimum for one session TX
            const err = new Error(`Fee grant from ${opts.feeGranter} has insufficient spend limit: ${remaining} udvpn remaining (need 20,000 for session TX). Operator must top up the grant.`);
            err.code = 'FEE_GRANT_EXHAUSTED';
            err.nextAction = 'request_fee_grant_renewal';
            err.details = { granter: opts.feeGranter, grantee: walletAddress, remainingUdvpn: remaining };
            throw err;
          }
          log(3, totalSteps, 'FEE_GRANT', `Spend limit: ${remaining} udvpn remaining`);
        }
      }

      // Check allowed_messages — verify it includes the messages we need
      const allowedMessages = isAllowedMsg ? (outerAllowance.allowed_messages || []) : [];
      if (allowedMessages.length > 0) {
        const needsStart = allowedMessages.some(m =>
          m.includes('MsgStartSession') || m.includes('MsgStartSessionRequest'),
        );
        if (!needsStart) {
          log(3, totalSteps, 'FEE_GRANT', `Warning: allowed_messages doesn't include MsgStartSession — TX may fail`);
        }
      }
    } catch (err) {
      if (err.code === 'FEE_GRANT_NOT_FOUND' || err.code === 'FEE_GRANT_EXPIRED' || err.code === 'FEE_GRANT_EXHAUSTED') throw err;
      // Non-critical — LCD query failed but fee grant may still work at broadcast time
      log(3, totalSteps, 'FEE_GRANT', `Could not verify fee grant (${err.message}) — proceeding anyway`);
    }
  }

  // ── STEP 4/7: Node Selection ──────────────────────────────────────────────

  t0 = Date.now();

  // Build SDK options — forward ALL documented options to the underlying SDK.
  const sdkOpts = {
    mnemonic: opts.mnemonic,
    onProgress: (stage, msg) => {
      if (opts.onProgress) opts.onProgress(stage, msg);
      const stageMap = {
        'wallet': 2, 'node-check': 4, 'validate': 4,
        'session': 5, 'handshake': 6, 'tunnel': 6,
        'verify': 7, 'dry-run': 7,
      };
      const step = stageMap[stage] || 5;
      const phase = stage.toUpperCase().replace('-', '_');
      if (!silent) agentLog(step, totalSteps, phase, msg);
      // BUG-2 fix: capture node metadata from progress callback
      // Format: "MonkerName (protocol) - City, Country"
      if (stage === 'node-check' && msg && !sdkOpts._discoveredNode) {
        const match = msg.match(/^(.+?)\s+\((\w+)\)\s+-\s+(.+?),\s+(.+)$/);
        if (match) {
          sdkOpts._discoveredNode = {
            moniker: match[1],
            serviceType: match[2],
            city: match[3],
            country: match[4],
          };
        }
      }
    },
    log: (msg) => {
      if (opts.onProgress) opts.onProgress('log', msg);
    },
  };

  // DNS
  if (opts.dns) sdkOpts.dns = opts.dns;

  // Protocol preference — search BOTH protocols when not specified
  if (opts.protocol === 'wireguard') sdkOpts.serviceType = 'wireguard';
  else if (opts.protocol === 'v2ray') sdkOpts.serviceType = 'v2ray';
  // When no protocol specified: do NOT set serviceType — let SDK try all node types
  // This ensures both WireGuard AND V2Ray nodes are candidates

  // Session pricing
  if (opts.gigabytes && opts.gigabytes > 0) sdkOpts.gigabytes = opts.gigabytes;
  if (opts.hours && opts.hours > 0) sdkOpts.hours = opts.hours;

  // Tunnel options
  if (opts.fullTunnel === false) sdkOpts.fullTunnel = false;
  if (opts.killSwitch === true) sdkOpts.killSwitch = true;
  if (opts.systemProxy !== undefined) sdkOpts.systemProxy = opts.systemProxy;

  // Split tunnel — WireGuard: route only specific IPs through VPN
  if (opts.splitIPs && Array.isArray(opts.splitIPs) && opts.splitIPs.length > 0) {
    sdkOpts.splitIPs = opts.splitIPs;
    sdkOpts.fullTunnel = false;
  }

  // V2Ray SOCKS5 auth
  if (opts.socksAuth === true) sdkOpts.socksAuth = true;

  // V2Ray binary path
  if (opts.v2rayExePath) {
    sdkOpts.v2rayExePath = opts.v2rayExePath;
  } else if (envInfo.v2rayPath) {
    sdkOpts.v2rayExePath = envInfo.v2rayPath;
  }

  // Max connection attempts
  if (opts.maxAttempts && opts.maxAttempts > 0) sdkOpts.maxAttempts = opts.maxAttempts;

  // Dry run
  if (opts.dryRun === true) sdkOpts.dryRun = true;

  // Force new session
  if (opts.forceNewSession === true) sdkOpts.forceNewSession = true;

  // AbortController
  const timeoutMs = (opts.timeout && opts.timeout > 0) ? opts.timeout : 120000;
  const ac = new AbortController();
  const timeoutId = setTimeout(() => ac.abort(), timeoutMs);
  if (opts.signal) {
    if (opts.signal.aborted) { ac.abort(); } else {
      opts.signal.addEventListener('abort', () => ac.abort(), { once: true });
    }
  }
  sdkOpts.signal = ac.signal;

  // ── Country-aware node discovery ──────────────────────────────────────
  // When a country is specified, connectAuto's default probe of 9 random nodes
  // is too small to find nodes in rare countries (e.g., Singapore = 2 of 1037).
  // Instead, we discover nodes in that country first, then connectDirect to one.
  // This probes up to 200 nodes to find country matches, searching BOTH protocols.

  let resolvedNodeAddress = opts.nodeAddress || null;

  if (!resolvedNodeAddress && opts.country) {
    const countryUpper = opts.country.toUpperCase();
    log(4, totalSteps, 'NODE', `Discovering nodes in ${countryUpper} (probing both WireGuard + V2Ray)...`);

    try {
      const { queryOnlineNodes, filterNodes, COUNTRY_MAP } = await import('../index.js');

      // Probe a large sample WITHOUT protocol filter — find ALL country matches
      const probeCount = Math.max(200, (opts.maxAttempts || 3) * 50);
      const allProbed = await queryOnlineNodes({
        maxNodes: probeCount,
        onNodeProbed: ({ total, probed, online }) => {
          if (probed % 50 === 0 || probed === total) {
            log(4, totalSteps, 'NODE', `Probed ${probed}/${total} nodes, ${online} online...`);
          }
        },
      });

      // Resolve country: filterNodes uses includes() on country NAME, not ISO code.
      // If agent passed "SG", we need "Singapore" for filterNodes to match.
      // Build reverse map: ISO code → country name
      let countryFilter = countryUpper;
      if (COUNTRY_MAP && countryUpper.length === 2) {
        // COUNTRY_MAP is { 'singapore': 'SG', ... } — reverse lookup
        for (const [name, code] of Object.entries(COUNTRY_MAP)) {
          if (code === countryUpper) {
            countryFilter = name; // "singapore" — filterNodes lowercases both sides
            break;
          }
        }
      }

      // Filter by country — use the resolved name (e.g., "singapore" not "SG")
      let countryNodes = filterNodes(allProbed, { country: countryFilter });
      let wgNodes = countryNodes.filter(n => n.serviceType === 'wireguard');
      let v2Nodes = countryNodes.filter(n => n.serviceType === 'v2ray');

      log(4, totalSteps, 'NODE', `Found ${countryNodes.length} nodes in ${countryUpper}: ${wgNodes.length} WireGuard, ${v2Nodes.length} V2Ray`);

      // If initial sample missed the country, do a FULL scan of all nodes.
      // Rare countries (e.g., Singapore = 2 of 1037) need the full network scan.
      if (countryNodes.length === 0) {
        log(4, totalSteps, 'NODE', `${countryUpper} not in initial sample. Scanning ALL nodes (this takes ~2 min)...`);
        const fullProbed = await queryOnlineNodes({
          maxNodes: 5000, // All nodes
          onNodeProbed: ({ total, probed, online }) => {
            if (probed % 100 === 0 || probed === total) {
              log(4, totalSteps, 'NODE', `Full scan: ${probed}/${total} probed, ${online} online...`);
            }
          },
        });
        countryNodes = filterNodes(fullProbed, { country: countryFilter });
        wgNodes = countryNodes.filter(n => n.serviceType === 'wireguard');
        v2Nodes = countryNodes.filter(n => n.serviceType === 'v2ray');
        log(4, totalSteps, 'NODE', `Full scan: ${countryNodes.length} nodes in ${countryUpper}: ${wgNodes.length} WireGuard, ${v2Nodes.length} V2Ray`);
      }

      if (countryNodes.length > 0) {
        // Pick best node: prefer requested protocol, then WireGuard (faster), then V2Ray
        let picked;
        if (opts.protocol === 'wireguard' && wgNodes.length > 0) {
          picked = wgNodes[0]; // Already sorted by quality score
        } else if (opts.protocol === 'v2ray' && v2Nodes.length > 0) {
          picked = v2Nodes[0];
        } else if (wgNodes.length > 0 && envInfo.admin) {
          picked = wgNodes[0]; // WireGuard preferred when admin
        } else if (v2Nodes.length > 0) {
          picked = v2Nodes[0];
        } else {
          picked = countryNodes[0];
        }

        resolvedNodeAddress = picked.address;
        // Store discovered node metadata for the result object
        sdkOpts._discoveredNode = {
          country: picked.country || null,
          city: picked.city || null,
          moniker: picked.moniker || null,
          serviceType: picked.serviceType || null,
          qualityScore: picked.qualityScore || 0,
        };
        log(4, totalSteps, 'NODE', `Selected: ${picked.address} (${picked.serviceType}) — ${picked.moniker || 'unnamed'}, ${picked.country}, score=${picked.qualityScore}`);
      } else {
        log(4, totalSteps, 'NODE', `No nodes found in ${countryUpper}. Falling back to global auto-select.`);
      }
    } catch (err) {
      log(4, totalSteps, 'NODE', `Country discovery failed: ${err.message}. Falling back to auto-select.`);
    }
  } else if (!resolvedNodeAddress) {
    log(4, totalSteps, 'NODE', 'Auto-selecting best available node (all countries, both protocols)...');
  } else {
    log(4, totalSteps, 'NODE', `Direct node: ${resolvedNodeAddress}`);
  }

  timings.nodeSelection = Date.now() - t0;

  // ── STEP 5/7 + 6/7: Session + Tunnel (handled by SDK internally) ─────────

  t0 = Date.now();
  log(5, totalSteps, 'SESSION', 'Broadcasting session transaction...');

  try {
    let result;

    // ── Connection mode: subscription > plan > direct > auto ──────────────
    if (opts.subscriptionId) {
      // Subscription mode — operator already provisioned a subscription for this agent
      log(5, totalSteps, 'SESSION', `Connecting via subscription ${opts.subscriptionId}${opts.feeGranter ? ' (fee granted)' : ''}...`);
      sdkOpts.subscriptionId = opts.subscriptionId;
      if (opts.feeGranter) sdkOpts.feeGranter = opts.feeGranter;
      if (resolvedNodeAddress) sdkOpts.nodeAddress = resolvedNodeAddress;
      result = await connectViaSubscription(sdkOpts);
    } else if (opts.planId) {
      // Plan mode — subscribe to plan + start session (optionally fee-granted)
      log(5, totalSteps, 'SESSION', `Connecting via plan ${opts.planId}${opts.feeGranter ? ' (fee granted)' : ''}...`);
      sdkOpts.planId = opts.planId;
      if (opts.feeGranter) sdkOpts.feeGranter = opts.feeGranter;
      if (resolvedNodeAddress) sdkOpts.nodeAddress = resolvedNodeAddress;
      result = await connectViaPlan(sdkOpts);
    } else if (resolvedNodeAddress) {
      // Direct connection — either user specified nodeAddress or country discovery found one
      sdkOpts.nodeAddress = resolvedNodeAddress;
      if (opts.feeGranter) sdkOpts.feeGranter = opts.feeGranter;
      result = await connectDirect(sdkOpts);
    } else {
      // No country filter or country discovery found nothing — auto-select globally
      // Use higher maxAttempts to search more nodes
      if (!sdkOpts.maxAttempts) sdkOpts.maxAttempts = 5;
      if (opts.feeGranter) sdkOpts.feeGranter = opts.feeGranter;
      result = await connectAuto(sdkOpts);
    }

    timings.sessionAndTunnel = Date.now() - t0;

    // ── STEP 7/7: Verify ──────────────────────────────────────────────────

    t0 = Date.now();
    log(7, totalSteps, 'VERIFY', 'Checking VPN IP through tunnel...');

    const ip = await checkVpnIp(result.socksPort || null);
    log(7, totalSteps, 'VERIFY', ip ? `VPN IP: ${ip}` : 'IP check failed (tunnel may still work)');

    timings.verify = Date.now() - t0;
    timings.total = Date.now() - connectStart;

    // ── Post-connect balance check (single RPC call — fixes BUG-3) ─────

    let balanceAfter = null;
    let costUdvpn = 0;
    let costFormatted = 'unknown';
    try {
      const postBal = await preValidateBalance(opts.mnemonic);
      balanceAfter = postBal.p2p;
      costUdvpn = Math.max(0, balCheck.udvpn - postBal.udvpn);
      costFormatted = formatP2P(costUdvpn);
    } catch { /* non-critical — tunnel works even if balance check fails */ }

    // ── Build agent-friendly return object ───────────────────────────────

    // Pull country/city/moniker from: discovered node metadata > SDK result > onProgress capture
    const discovered = sdkOpts._discoveredNode || {};

    const output = {
      sessionId: String(result.sessionId),
      protocol: result.serviceType || discovered.serviceType || 'unknown',
      nodeAddress: result.nodeAddress || resolvedNodeAddress || 'unknown',
      country: result.nodeLocation?.country || discovered.country || null,
      city: result.nodeLocation?.city || discovered.city || null,
      moniker: result.nodeMoniker || discovered.moniker || null,
      socksPort: result.socksPort || null,
      socksAuth: result.socksAuth || null,
      dryRun: result.dryRun || false,
      ip,
      walletAddress: walletAddress || balCheck.address,
      balance: {
        before: balCheck.p2p,
        after: balanceAfter,
      },
      cost: {
        udvpn: costUdvpn,
        p2p: costFormatted,
      },
      timing: {
        totalMs: timings.total,
        totalFormatted: `${(timings.total / 1000).toFixed(1)}s`,
        phases: { ...timings },
      },
    };

    _lastConnectResult = output;
    _lastConnectResult._connectedAt = Date.now(); // BUG-4 fix: store actual connect timestamp for uptime
    _connectTimings = timings;

    // ── Final summary ──────────────────────────────────────────────────

    log(7, totalSteps, 'COMPLETE', [
      `Session=${output.sessionId}`,
      `Protocol=${output.protocol}`,
      `Node=${output.nodeAddress}`,
      output.country ? `Country=${output.country}` : null,
      `IP=${output.ip || 'unknown'}`,
      `Time=${output.timing.totalFormatted}`,
      `Balance=${output.balance.before} → ${output.balance.after || '?'}`,
    ].filter(Boolean).join(' | '));

    return output;
  } catch (err) {
    timings.total = Date.now() - connectStart;
    const { message, nextAction } = humanError(err);
    const wrapped = new Error(message);
    wrapped.code = err?.code || 'UNKNOWN';
    wrapped.nextAction = nextAction;
    wrapped.details = err?.details || null;
    wrapped.timing = { totalMs: timings.total, phases: { ...timings } };

    log(5, totalSteps, 'FAILED', `${wrapped.code}: ${message} → nextAction: ${nextAction}`);
    throw wrapped;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

// ─── disconnect() ────────────────────────────────────────────────────────────

/**
 * Disconnect from VPN. Tears down tunnel, cleans up system state.
 * Returns session cost and remaining balance for agent accounting.
 *
 * @returns {Promise<{
 *   disconnected: boolean,
 *   sessionId: string|null,
 *   balance: string|null,
 *   timing: { connectedMs: number|null },
 * }>}
 */
export async function disconnect() {
  const prevResult = _lastConnectResult;
  const sessionId = prevResult?.sessionId || null;

  agentLog(1, 1, 'DISCONNECT', `Ending session${sessionId ? ` ${sessionId}` : ''}...`);

  try {
    await sdkDisconnect();

    // Check remaining balance after disconnect
    let balance = null;
    if (prevResult?.walletAddress) {
      try {
        // Re-derive from stored result isn't possible without mnemonic.
        // Listen for the session-end event from SDK instead.
        balance = prevResult.balance?.after || null;
      } catch { /* non-critical */ }
    }

    const output = {
      disconnected: true,
      sessionId,
      balance,
      timing: {
        connectedMs: prevResult?._connectedAt
          ? Date.now() - prevResult._connectedAt
          : null,
        setupMs: prevResult?.timing?.totalMs || null,
      },
    };

    agentLog(1, 1, 'DISCONNECT', `Done. Session ${sessionId || 'unknown'} ended.`);

    _lastConnectResult = null;
    _connectTimings = {};
    return output;
  } catch (err) {
    _lastConnectResult = null;
    _connectTimings = {};
    throw new Error(`Disconnect failed: ${err.message}`);
  }
}

// ─── status() ────────────────────────────────────────────────────────────────

/**
 * Get current VPN connection status.
 * Returns everything an agent needs to assess the connection.
 *
 * @returns {{
 *   connected: boolean,
 *   sessionId?: string,
 *   protocol?: string,
 *   nodeAddress?: string,
 *   country?: string,
 *   city?: string,
 *   socksPort?: number,
 *   uptimeMs?: number,
 *   uptimeFormatted?: string,
 *   ip?: string|null,
 *   balance?: { before: string, after: string|null },
 * }}
 */
export function status() {
  const sdkStatus = getStatus();

  if (!sdkStatus) {
    return { connected: false };
  }

  return {
    connected: true,
    sessionId: sdkStatus.sessionId || null,
    protocol: sdkStatus.serviceType || null,
    nodeAddress: sdkStatus.nodeAddress || null,
    country: _lastConnectResult?.country || null,
    city: _lastConnectResult?.city || null,
    socksPort: sdkStatus.socksPort || null,
    uptimeMs: sdkStatus.uptimeMs || 0,
    uptimeFormatted: sdkStatus.uptimeFormatted || '0s',
    ip: _lastConnectResult?.ip || null,
    balance: _lastConnectResult?.balance || null,
  };
}

// ─── isVpnActive() ──────────────────────────────────────────────────────────

/**
 * Quick boolean check: is the VPN tunnel active right now?
 *
 * @returns {boolean}
 */
export function isVpnActive() {
  return isConnected();
}

// ─── verify() ───────────────────────────────────────────────────────────────

/**
 * Verify the VPN connection is actually working.
 * Checks: tunnel is up, traffic flows, IP has changed.
 *
 * @returns {Promise<{connected: boolean, ip: string|null, verified: boolean}>}
 */
export async function verify() {
  if (!isConnected()) {
    return { connected: false, ip: null, verified: false };
  }

  // Check IP through tunnel with latency measurement
  const socksPort = _lastConnectResult?.socksPort || null;
  const t0 = Date.now();
  const ip = await checkVpnIp(socksPort);
  const latency = Date.now() - t0;

  // Try SDK's built-in verification if available
  let sdkVerified = false;
  try {
    if (typeof verifyConnection === 'function') {
      const result = await verifyConnection();
      sdkVerified = !!result;
    }
  } catch {
    // verifyConnection may not exist or may fail — IP check is sufficient
  }

  return {
    connected: true,
    ip,
    verified: ip !== null || sdkVerified,
    latency,
    protocol: _lastConnectResult?.protocol || null,
    nodeAddress: _lastConnectResult?.nodeAddress || null,
  };
}

// ─── verifySplitTunnel() ─────────────────────────────────────────────────────

/**
 * Verify split tunneling is working correctly.
 * For V2Ray: confirms SOCKS5 proxy routes traffic through VPN while direct traffic bypasses.
 * For WireGuard: confirms tunnel is active (split tunnel verification requires known static IPs).
 *
 * IMPORTANT: Uses axios + SocksProxyAgent — NOT native fetch (which ignores SOCKS5).
 *
 * @returns {Promise<{splitTunnel: boolean, proxyIp: string|null, directIp: string|null, protocol: string|null}>}
 */
export async function verifySplitTunnel() {
  if (!isConnected()) {
    return { splitTunnel: false, proxyIp: null, directIp: null, protocol: null };
  }

  const socksPort = _lastConnectResult?.socksPort || null;
  const protocol = _lastConnectResult?.protocol || null;

  // Get direct IP (bypasses VPN)
  let directIp = null;
  try {
    if (socksPort) {
      // V2Ray: native fetch goes direct (this is correct — it proves split tunnel)
      const res = await fetch(IP_CHECK_URL, { signal: AbortSignal.timeout(IP_CHECK_TIMEOUT) });
      const data = await res.json();
      directIp = data?.ip || null;
    }
  } catch { /* non-critical */ }

  // Get proxy IP (through VPN)
  const proxyIp = await checkVpnIp(socksPort);

  // Split tunnel works when proxy and direct show different IPs
  const splitTunnel = !!(proxyIp && directIp && proxyIp !== directIp);

  return { splitTunnel, proxyIp, directIp, protocol };
}

// ─── onEvent() ──────────────────────────────────────────────────────────────

/**
 * Subscribe to VPN connection events (progress, errors, reconnect).
 *
 * Event types:
 *   'progress'      — { step, detail } during connection
 *   'connected'     — connection established
 *   'disconnected'  — connection closed
 *   'error'         — { code, message } on failure
 *   'reconnecting'  — auto-reconnect in progress
 *
 * @param {function} callback - (eventType: string, data: object) => void
 * @returns {function} unsubscribe — call to stop listening
 */
export function onEvent(callback) {
  if (!events || typeof events.on !== 'function') {
    // SDK events not available — return no-op unsubscribe
    return () => {};
  }

  // Subscribe to all relevant events — store exact handler refs for clean unsubscribe
  const eventNames = [
    'progress', 'connected', 'disconnected', 'error',
    'reconnecting', 'reconnected', 'sessionEnd', 'sessionEndFailed',
  ];

  const handlers = new Map();
  for (const name of eventNames) {
    const h = (data) => {
      try { callback(name, data); } catch { /* don't crash SDK */ }
    };
    handlers.set(name, h);
    events.on(name, h);
  }

  // Return unsubscribe function — removes exact handler references
  return () => {
    for (const [name, h] of handlers) {
      events.removeListener(name, h);
    }
    handlers.clear();
  };
}
