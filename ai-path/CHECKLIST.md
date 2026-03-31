# Sentinel AI Path — Operational Checklists

> **For AI agents.** Run these checklists programmatically before, during, and after VPN operations. Every check includes the exact code, expected result, and failure response. Assume the wallet has sufficient P2P for bandwidth consumption.

---

## How to Use

```javascript
import {
  setup, getEnvironment, createWallet, importWallet, getBalance,
  discoverNodes, getNodeInfo, getNetworkStats,
  estimateCost, PRICING, recommend,
  connect, disconnect, status, isVpnActive, verify, onEvent,
} from './index.js'; // or 'sentinel-ai-connect' when published to npm
```

Each checklist item has:
- **Check**: what to verify
- **Code**: exact call
- **Pass**: expected result
- **Fail**: what the failure means and what to do

Run all checks in order. Stop at the first `CRITICAL` failure. `WARNING` items can be bypassed with degraded capability.

---

## Checklist 1: Pre-Flight (Before Any Connection)

Run once per session. Verifies the machine can operate.

### 1.1 Node.js Version

```javascript
const [major] = process.versions.node.split('.').map(Number);
```

| | |
|---|---|
| **Pass** | `major >= 20` |
| **Fail** | CRITICAL. Node.js 20+ required for stable ESM, `crypto.randomUUID`, and `AbortSignal.timeout`. Upgrade Node.js. |

### 1.2 Environment Detection

```javascript
const env = getEnvironment();
```

| Check | Pass | Fail |
|-------|------|------|
| `env.v2ray.available` | `true` | WARNING. Run `setup()` to download V2Ray 5.2.1. Without V2Ray, only WireGuard nodes work. |
| `env.v2ray.version` | Starts with `'5.2'` | WARNING. V2Ray 5.44.1+ has observatory bugs that break VMess. Delete and redownload 5.2.1. |
| `env.wireguard.available` | `true` | WARNING. WireGuard not installed. Limited to V2Ray nodes (~70% of network). |
| `env.admin` | `true` | WARNING. Not admin. WireGuard tunnel installation will be blocked. V2Ray still works. |
| `env.capabilities.length` | `> 0` | CRITICAL. No tunnel protocol available. Install V2Ray or WireGuard before proceeding. |

### 1.3 Full System Check

```javascript
const check = await setup();
```

| Check | Pass | Fail |
|-------|------|------|
| `check.ready` | `true` | See `check.issues` array for specific problems. |
| `check.issues.length` | `0` | Review each issue: `issue.severity`, `issue.message`, `issue.action`. Fix `error` severity items. `warning` items are non-blocking. |
| `check.preflight.ok` | `true` | Preflight found blockers. Check `check.preflight.issues` for details. |
| `check.preflight.ready.anyProtocol` | `true` | CRITICAL. Neither WireGuard nor V2Ray is operational. |

### 1.4 Orphan Detection

```javascript
const pf = check.preflight;
const orphans = pf.issues.filter(i => i.component === 'wireguard' && i.message.includes('orphan'));
const conflicts = pf.issues.filter(i => i.component === 'system');
```

| Check | Pass | Fail |
|-------|------|------|
| `orphans.length` | `0` | WARNING. Leftover WireGuard tunnels from a previous crash. Run `setup()` with autoClean or manually uninstall: `wireguard.exe /uninstalltunnelservice wgsent0` |
| `conflicts.length` | `0` | WARNING. Conflicting VPN software detected (NordVPN, ExpressVPN, etc.). May interfere with tunnel routing. |

### 1.5 Axios Adapter

```javascript
const axios = (await import('axios')).default;
const adapterOk = axios.defaults.adapter === 'http';
if (!adapterOk) axios.defaults.adapter = 'http';
```

| Check | Pass | Fail |
|-------|------|------|
| Adapter is `'http'` | `true` | Auto-fixed above. Without this, Node.js 20+ uses fetch adapter which silently fails on self-signed node certificates. The `connect()` function handles this automatically, but verify if making direct SDK calls. |

---

## Checklist 2: Wallet & Funding

Run before every connection attempt.

### 2.1 Wallet Valid

```javascript
const bal = await getBalance(process.env.MNEMONIC);
```

| Check | Pass | Fail |
|-------|------|------|
| No exception thrown | Call succeeds | CRITICAL. If `INVALID_MNEMONIC`: check word count (must be 12 or 24), check for typos, verify BIP39 English wordlist. If network error: LCD endpoints may be down — retry in 30s. |
| `bal.address` starts with `'sent1'` | `true` | CRITICAL. Wrong address prefix means wrong chain derivation. |
| `bal.address.length >= 43 && bal.address.length <= 46` | `true` | CRITICAL. Malformed address — expected 43-46 characters. |

### 2.2 Balance Sufficient

```javascript
const { funded, udvpn, p2p } = bal;
```

| Check | Pass | Fail |
|-------|------|------|
| `funded` | `true` | CRITICAL. Balance below 1.0 P2P. Fund wallet at `bal.address`. Prices vary — use `estimateCost()` to check if current balance covers at least one session. |
| `udvpn > 0` | `true` | CRITICAL. Wallet is empty. Send P2P tokens to `bal.address`. |

### 2.3 Cost Estimation

```javascript
const cost = await estimateCost({ gigabytes: 1 });
const canAfford = bal.udvpn >= cost.grandTotal.udvpn;
```

| Check | Pass | Fail |
|-------|------|------|
| `canAfford` | `true` | CRITICAL. Balance `${bal.p2p}` insufficient for 1 GB session costing ~`${cost.grandTotal.p2p}`. Fund wallet with at least `${cost.grandTotal.p2p}`. |
| `cost.mode` | Any value returned | If exception: network issue querying node prices. Proceed with `funded: true` as a fallback estimate. |

---

## Checklist 3: Network Reachability

Run before connection to verify chain infrastructure is accessible.

### 3.1 LCD Endpoint

```javascript
const res = await fetch('https://lcd.sentinel.co/cosmos/bank/v1beta1/balances/' + bal.address, {
  signal: AbortSignal.timeout(10000),
});
```

| Check | Pass | Fail |
|-------|------|------|
| `res.ok` | `true` | WARNING. Primary LCD down. The SDK has 4 failover endpoints and handles this automatically. If all 4 fail, check your internet connection. |

### 3.2 Node Discovery

```javascript
const nodes = await discoverNodes({ quick: true });
```

| Check | Pass | Fail |
|-------|------|------|
| `nodes.length > 0` | `true` | CRITICAL. Zero nodes returned. Chain may be down or LCD endpoints unreachable. Retry in 60s. |
| `nodes.length > 100` | `true` | WARNING. Unusually few nodes. Possible pagination issue or chain maintenance. Connection may still work. |

### 3.3 Network Health

```javascript
const stats = await getNetworkStats();
```

| Check | Pass | Fail |
|-------|------|------|
| `stats.totalNodes > 0` | `true` | CRITICAL. Network appears empty. |
| `stats.byProtocol.v2ray > 0` or `stats.byProtocol.wireguard > 0` | At least one `> 0` | CRITICAL. No nodes available for any protocol. |

---

## Checklist 4: Connection

Run during the `connect()` call. Use `onProgress` to track each phase.

### 4.1 Progress Monitoring

```javascript
const phases = new Set();
let lastPhase = null;
let lastError = null;

const vpn = await connect({
  mnemonic: process.env.MNEMONIC,
  // fullTunnel: true (default) for privacy, or protocol: 'v2ray' for per-app split tunnel
  onProgress: (step, detail) => {
    phases.add(step);
    lastPhase = step;
    // Log for diagnostics: console.log(`[${step}] ${detail}`);
  },
});
```

### 4.2 Phase Completion Verification

After `connect()` returns successfully, verify all critical phases were reached:

| Phase | Expected in `phases` | If Missing |
|-------|---------------------|------------|
| `'wallet'` | Yes | CRITICAL. Wallet derivation never started. Check mnemonic. |
| `'session'` | Yes | CRITICAL. Node selection or payment never started. Check balance, check node availability. |
| `'handshake'` | Yes | CRITICAL. Handshake phase never reached. Payment may have failed — check `lastError`. Session may exist on-chain (tokens spent). |
| `'tunnel'` | Yes | CRITICAL. Tunnel installation never started. Handshake may have failed. |
| `'verify'` | Yes | WARNING. Verification phase was skipped. Tunnel may still work — proceed to manual verification (Checklist 5). |

### 4.3 Connect Result Validation

```javascript
const { sessionId, protocol, nodeAddress, socksPort, ip } = vpn;
```

| Check | Pass | Fail |
|-------|------|------|
| `sessionId` defined and non-empty | `true` | CRITICAL. No session ID means the blockchain TX may have failed. Check wallet balance — if it decreased, the session exists but ID extraction failed. |
| `protocol` is `'wireguard'` or `'v2ray'` | `true` | WARNING. Unknown protocol `'${protocol}'`. Connection may still work. |
| `nodeAddress` starts with `'sentnode1'` | `true` | WARNING. Node address missing or malformed. Connection may still work if sessionId is valid. |
| If V2Ray: `socksPort` is a number > 0 | `true` | WARNING. No SOCKS5 port. V2Ray may not be routing traffic. Verify manually. |
| `ip !== null` | `true` | WARNING. IP verification failed (ipify.org may be unreachable through this node). Tunnel may still work. Run Checklist 5 to confirm. |
| `ip !== yourOriginalIp` | `true` | WARNING. IP didn't change. Possible split tunnel mode or full tunnel not installed. May be expected if `fullTunnel: false`. |

---

## Checklist 5: Post-Connection Verification

Run immediately after `connect()` succeeds. Confirms the tunnel is actually working.

### 5.1 Connection State

```javascript
const active = isVpnActive();
const st = status();
```

| Check | Pass | Fail |
|-------|------|------|
| `active` | `true` | CRITICAL. `isVpnActive()` returns false immediately after connect. Tunnel may have collapsed. Disconnect and retry with a different node. |
| `st.connected` | `true` | CRITICAL. Same as above — status shows disconnected. |
| `st.sessionId` matches `vpn.sessionId` | `true` | WARNING. Session ID mismatch. State may be stale. |
| `st.protocol` matches `vpn.protocol` | `true` | WARNING. Protocol mismatch. Likely a state tracking issue — tunnel may still work. |

### 5.2 Traffic Verification

```javascript
const v = await verify();
```

| Check | Pass | Fail |
|-------|------|------|
| `v.connected` | `true` | CRITICAL. Tunnel down during verification. |
| `v.verified` | `true` | CRITICAL. Cannot confirm traffic flows through the tunnel. The tunnel may be installed but not routing. Disconnect and try a different node. |
| `v.ip !== null` | `true` | WARNING. IP check failed but `verified` may still be true from SDK verification. If both `ip === null` and `verified === false`, the tunnel is dead. |

### 5.3 Data Transfer Test

```javascript
let testRes;
if (vpn.socksPort) {
  // V2Ray: test through SOCKS5 proxy
  const axios = (await import('axios')).default;
  const { SocksProxyAgent } = await import('socks-proxy-agent');
  const agent = new SocksProxyAgent(`socks5h://127.0.0.1:${vpn.socksPort}`);
  testRes = await axios.get('https://api.ipify.org?format=json', {
    httpAgent: agent, httpsAgent: agent, timeout: 15000, adapter: 'http',
  });
} else {
  // WireGuard: traffic routes automatically through the tunnel
  const axios = (await import('axios')).default;
  testRes = await axios.get('https://api.ipify.org?format=json', {
    timeout: 15000, adapter: 'http',
  });
}
```

| Check | Pass | Fail |
|-------|------|------|
| Response received within timeout | `true` | WARNING. Tunnel may be slow or congested. Increase timeout to 30s and retry once. If still fails, try a different node. |
| `testRes.data.ip` is not your real IP | `true` | CRITICAL (WireGuard full tunnel). Traffic is not routing through the VPN. NORMAL (V2Ray split tunnel) — only SOCKS5-proxied traffic routes through the tunnel. |
| `testRes.status === 200` | `true` | WARNING. Non-200 response. The test endpoint may be down. Try `https://ifconfig.me` as fallback. |

### 5.4 DNS Leak Check

```javascript
// Verify DNS resolves through the tunnel, not your ISP
const dnsRes = await axios.get('https://1.1.1.1/cdn-cgi/trace', {
  httpAgent: agent, httpsAgent: agent, timeout: 10000, adapter: 'http', // V2Ray
  // For WireGuard: omit agents, DNS is enforced by tunnel config
});
```

| Check | Pass | Fail |
|-------|------|------|
| Response received | `true` | WARNING. Cloudflare trace endpoint unreachable. DNS may still be correct — this is a secondary check. |
| Response does not contain your real ISP IP | `true` | WARNING. Possible DNS leak. If using WireGuard, check that `DNS = 10.8.0.1` is in the config. If using V2Ray, verify SOCKS5 proxy is routing DNS queries. |

---

## Checklist 6: Runtime Health Monitoring

Run periodically while connected (every 30-60 seconds).

### 6.1 Connection Still Active

```javascript
const alive = isVpnActive();
const st = status();
```

| Check | Pass | Fail |
|-------|------|------|
| `alive` | `true` | CRITICAL. Connection lost. Begin reconnection (Checklist 8). |
| `st.connected` | `true` | CRITICAL. Same — status shows disconnected. |
| `st.uptimeMs > previousUptimeMs` | `true` | WARNING. Uptime not advancing. State may be stale. Verify with `verify()`. |

### 6.2 Traffic Still Flows

```javascript
const v = await verify();
```

| Check | Pass | Fail |
|-------|------|------|
| `v.verified` | `true` | CRITICAL. Tunnel is up but traffic has stopped flowing. Disconnect and reconnect. |
| Time since last successful verify < 120s | `true` | WARNING. Verification hasn't succeeded in 2+ minutes. Network may be degrading. |

### 6.3 Balance Monitor (Every 5 Minutes)

```javascript
const bal = await getBalance(process.env.MNEMONIC);
```

| Check | Pass | Fail |
|-------|------|------|
| `bal.funded` | `true` | WARNING. Balance dropping below threshold. Plan for disconnection or top-up. Session continues until data allocation is consumed, but new sessions cannot be created. |
| `bal.udvpn > previousBalance - expectedConsumption` | `true` | INFO. Track spend rate. If balance is dropping faster than expected, session may have an issue. |

---

## Checklist 7: Disconnection

Run when work is complete or on shutdown.

### 7.1 Graceful Disconnect

```javascript
const result = await disconnect();
```

| Check | Pass | Fail |
|-------|------|------|
| `result.disconnected` | `true` | WARNING. Disconnect reported failure, but tunnel is likely down. Proceed to verification. |
| No exception thrown | `true` | WARNING. Best-effort — the tunnel was probably torn down. Continue to post-disconnect verification. |

### 7.2 Post-Disconnect Verification

```javascript
const active = isVpnActive();
const st = status();
```

| Check | Pass | Fail |
|-------|------|------|
| `active` | `false` | CRITICAL. Tunnel still active after disconnect. Orphaned tunnel. Attempt: `await disconnect()` again. If still active, escalate to manual cleanup (7.3). |
| `st.connected` | `false` | CRITICAL. Same — state still shows connected. |

### 7.3 Orphan Cleanup (If 7.2 Fails)

```javascript
import { emergencyCleanupSync } from 'sentinel-dvpn-sdk';
emergencyCleanupSync();
```

| Check | Pass | Fail |
|-------|------|------|
| After cleanup: `isVpnActive() === false` | `true` | CRITICAL. Orphaned tunnel survived emergency cleanup. Manual intervention required: `wireguard.exe /uninstalltunnelservice wgsent0` (WireGuard) or kill V2Ray process by PID (NOT `taskkill /F /IM node.exe` — that kills your own process). |

### 7.4 System State Clean

```javascript
// Verify no system proxy left behind (V2Ray)
// On Windows, check registry or run:
// netsh winhttp show proxy
```

| Check | Pass | Fail |
|-------|------|------|
| No system proxy pointing to dead SOCKS5 port | `true` | WARNING. Orphaned system proxy will break system HTTP traffic. Clear it: `netsh winhttp reset proxy` |

---

## Checklist 8: Error Recovery

Run when any connection attempt fails or when runtime health check fails.

### 8.1 Classify the Error

```javascript
try {
  await connect(opts);
} catch (err) {
  const code = err.code || 'UNKNOWN';
  const msg = err.message;
}
```

| Error Code | Severity | Recovery Action |
|------------|----------|----------------|
| `INVALID_MNEMONIC` | Fatal | Fix mnemonic. Do not retry. |
| `INSUFFICIENT_BALANCE` | Fatal | Fund wallet. Do not retry until funded. |
| `ALREADY_CONNECTED` | Fatal | Call `disconnect()` first, then retry. |
| `ABORTED` | Fatal | Timeout or cancellation. Increase `timeout` or check network. |
| `SESSION_POISONED` | Fatal | Previous session is corrupted. Do not reuse. Fresh connection needed. |
| `NODE_OFFLINE` | Retryable | Try a different node. |
| `NODE_CLOCK_DRIFT` | Retryable | Skip this node. Try another. |
| `V2RAY_ALL_FAILED` | Retryable | All transports failed. Try a WireGuard node or different V2Ray node. |
| `WG_NO_CONNECTIVITY` | Retryable | Tunnel installed but dead. Try a different node. |
| `BROADCAST_FAILED` | Retryable | Chain TX failed. Wait 30s, retry. |
| `ALL_NODES_FAILED` | Retryable | Every candidate failed. Wait 60s, retry with different country or protocol. |
| `ALL_ENDPOINTS_FAILED` | Retryable | LCD/RPC all down. Check internet. Wait 60s, retry. |
| `V2RAY_NOT_FOUND` | Setup | Run `setup()` to install V2Ray binary. |
| `WG_NOT_AVAILABLE` | Setup | Install WireGuard or retry with `protocol: 'v2ray'`. |
| `SESSION_EXISTS` | Recoverable | Active session found. SDK reuses it automatically. If it keeps failing, wait for session expiry. |
| `PARTIAL_CONNECTION_FAILED` | Recoverable | Payment succeeded but tunnel failed. Session exists on-chain. Retry connection to same node — session will be reused (no double payment). |

### 8.2 Retry Strategy

```javascript
const MAX_RETRIES = 3;
const BACKOFF = [5000, 10000, 20000]; // ms

for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
  try {
    const vpn = await connect(opts);
    // Run Checklist 4 + 5
    break; // Success
  } catch (err) {
    if (['INVALID_MNEMONIC', 'INSUFFICIENT_BALANCE', 'ABORTED'].includes(err.code)) {
      throw err; // Fatal — do not retry
    }
    if (attempt < MAX_RETRIES - 1) {
      await new Promise(r => setTimeout(r, BACKOFF[attempt]));
    } else {
      throw err; // Exhausted retries
    }
  }
}
```

### 8.3 Post-Failure Cleanup

After any failed connection attempt:

```javascript
// Always verify no orphaned state
try { await disconnect(); } catch { /* best effort */ }
const stillActive = isVpnActive();
if (stillActive) {
  const { emergencyCleanupSync } = await import('sentinel-dvpn-sdk');
  emergencyCleanupSync();
}
```

| Check | Pass | Fail |
|-------|------|------|
| `isVpnActive() === false` after cleanup | `true` | Orphaned tunnel exists. See Checklist 7.3. |

---

## Checklist 9: Full End-to-End Validation

Run this as a single script to verify the entire pipeline works. This is the definitive test.

```javascript
// Load mnemonic from .env (use dotenv or manual parsing)
// import 'dotenv/config';  // Requires: npm install dotenv
import {
  setup, getEnvironment, getBalance, estimateCost, recommend,
  connect, disconnect, status, isVpnActive, verify,
} from './index.js'; // or 'sentinel-ai-connect' when published to npm

const results = {
  preflight: false,
  wallet: false,
  balance: false,
  costEstimate: false,
  recommendation: false,
  connection: false,
  stateConsistent: false,
  trafficVerified: false,
  disconnection: false,
  cleanState: false,
};

try {
  // ── Preflight ──
  const env = getEnvironment();
  if (env.capabilities.length === 0) throw new Error('No tunnel protocol available');
  const check = await setup();
  if (!check.ready) throw new Error(`Setup issues: ${check.issues.join(', ')}`);
  results.preflight = true;

  // ── Wallet ──
  const bal = await getBalance(process.env.MNEMONIC);
  if (!bal.address.startsWith('sent1')) throw new Error('Bad address');
  results.wallet = true;

  // ── Balance ──
  if (!bal.funded) throw new Error(`Underfunded: ${bal.p2p}`);
  results.balance = true;

  // ── Cost Estimate ──
  const cost = await estimateCost({ gigabytes: 1 });
  if (bal.udvpn < cost.grandTotal.udvpn) throw new Error(`Need ${cost.grandTotal.p2p}, have ${bal.p2p}`);
  results.costEstimate = true;

  // ── Recommendation ──
  const rec = await recommend({ priority: 'reliability' });
  if (rec.action === 'cannot-connect') throw new Error('No nodes available');
  results.recommendation = true;

  // ── Connection ──
  const phases = new Set();
  const vpn = await connect({
    mnemonic: process.env.MNEMONIC,
    fullTunnel: false,
    onProgress: (step) => phases.add(step),
    timeout: 120000,
  });
  if (!vpn.sessionId) throw new Error('No session ID');
  if (!phases.has('wallet')) throw new Error('Wallet phase missing');
  if (!phases.has('session')) throw new Error('Session phase missing');
  if (!phases.has('handshake')) throw new Error('Handshake phase missing');
  if (!phases.has('tunnel')) throw new Error('Tunnel phase missing');
  results.connection = true;

  // ── State Consistency ──
  const st = status();
  if (!st.connected) throw new Error('Status says disconnected after connect');
  if (!isVpnActive()) throw new Error('isVpnActive false after connect');
  if (st.sessionId !== vpn.sessionId) throw new Error('Session ID mismatch');
  results.stateConsistent = true;

  // ── Traffic Verification ──
  const v = await verify();
  if (!v.verified) throw new Error('Traffic verification failed');
  results.trafficVerified = true;

  // ── Disconnection ──
  await disconnect();
  results.disconnection = true;

  // ── Clean State ──
  if (isVpnActive()) throw new Error('Still active after disconnect');
  if (status().connected) throw new Error('Status still connected after disconnect');
  results.cleanState = true;

} catch (err) {
  console.error(`FAILED: ${err.message} (code: ${err.code || 'none'})`);
} finally {
  // Ensure cleanup even on failure
  try { await disconnect(); } catch {}
}

// ── Report ──
console.log('\n═══ End-to-End Checklist Results ═══');
const entries = Object.entries(results);
const passed = entries.filter(([, v]) => v).length;
const total = entries.length;

for (const [name, ok] of entries) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
}

console.log(`\n  ${passed}/${total} checks passed.`);
if (passed === total) {
  console.log('  All systems operational. AI Path is fully functional.');
} else {
  const firstFail = entries.find(([, v]) => !v)?.[0];
  console.log(`  First failure: ${firstFail}. Fix this before retrying.`);
}
```

### Expected Output (All Pass)

```
═══ End-to-End Checklist Results ═══
  PASS  preflight
  PASS  wallet
  PASS  balance
  PASS  costEstimate
  PASS  recommendation
  PASS  connection
  PASS  stateConsistent
  PASS  trafficVerified
  PASS  disconnection
  PASS  cleanState

  10/10 checks passed.
  All systems operational. AI Path is fully functional.
```

---

## Quick Reference: Which Checklist When

| Situation | Run |
|-----------|-----|
| First time using AI Path | Checklist 1 (preflight) → 2 (wallet) → 3 (network) → 9 (full E2E) |
| Before each connection | Checklist 2.2 (balance) → 4 (connection) → 5 (post-connect) |
| While connected (every 30-60s) | Checklist 6 (health) |
| Connection fails | Checklist 8 (error recovery) |
| Shutting down | Checklist 7 (disconnection) |
| After crash or unexpected restart | Checklist 1.4 (orphan detection) → 7.3 (orphan cleanup) |
| Validating a new environment | Checklist 9 (full E2E) |
