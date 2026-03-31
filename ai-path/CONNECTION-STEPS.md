# Connection Steps — Complete Technical Walkthrough

> **Purpose:** Show every step of a successful Sentinel dVPN connection with real output, so an AI agent building on this SDK can verify each phase against its own results and pinpoint exactly where a failure occurs.

## NON-NEGOTIABLE RULES — Read Before Writing ANY Code

These rules exist because every AI that has built on this SDK violated at least one of them. They are not suggestions. They are requirements.

1. **NEVER use native `fetch()` for V2Ray traffic.** Node.js `fetch()` silently ignores SOCKS5 proxy. Your IP check will show your real IP and you will think the VPN is working when it is not. Use `axios` with `SocksProxyAgent` for ALL traffic that must go through V2Ray.

2. **V2Ray is a SOCKS5 proxy, not a system tunnel.** Only traffic you explicitly route through `socks5://127.0.0.1:{port}` goes through the VPN. Everything else — your chain queries, your npm installs, your other HTTP calls — goes direct. This is by design. It is the split tunnel.

3. **WireGuard `splitIPs` takes IP addresses, not domain names.** `splitIPs: ['google.com']` does nothing. Domains resolve to many IPs via DNS/CDN. You must provide CIDR ranges like `splitIPs: ['10.0.0.0/8']`. For per-app routing, use V2Ray SOCKS5 instead.

4. **Use `axios` with `adapter: 'http'` for all SOCKS5 traffic.** Node.js 20+ defaults to the undici fetch adapter which silently fails with self-signed certificates and SOCKS5 proxies. Always set `adapter: 'http'` explicitly.

5. **After V2Ray connect, verify with `verify()` — not with `fetch()`.** The SDK's `verify()` function routes through SOCKS5 automatically. A raw `fetch()` call bypasses the proxy entirely.

---

## Overview — The 9 Phases

```
Phase 1: Environment Check     → Can I run?
Phase 2: Wallet Setup           → Do I have keys?
Phase 3: Balance Check          → Can I pay?
Phase 4: Node Discovery         → Who can I connect to?
Phase 5: Cost Estimation        → How much will it cost?
Phase 6: Session Creation       → Pay the blockchain
Phase 7: Handshake              → Exchange keys with the node
Phase 8: Tunnel Installation    → Start encrypted tunnel
Phase 9: Verification           → Confirm traffic flows
```

Each phase below includes:
- **What happens** (technical)
- **Successful output** (real example)
- **Failure signatures** (what goes wrong and why)
- **Diagnostic check** (how to verify this phase independently)

---

## Phase 1: Environment Check

### What Happens
The SDK checks that all required binaries and permissions are available before any network calls.

### Code
```javascript
import { setup, getEnvironment } from 'sentinel-ai-connect';

// Quick synchronous check (no network calls)
const env = getEnvironment();
console.log(env);

// Full async check (includes chain reachability)
const check = await setup();
console.log(check);
```

### Successful Output
```json
{
  "os": "win32",
  "arch": "x64",
  "nodeVersion": "22.4.0",
  "admin": true,
  "v2ray": {
    "available": true,
    "path": "~/.sentinel-sdk/bin/v2ray.exe",
    "version": "5.2.1"
  },
  "wireguard": {
    "available": true,
    "path": "C:\\Program Files\\WireGuard\\wireguard.exe"
  },
  "capabilities": ["v2ray", "wireguard"],
  "recommendations": []
}
```

### Failure Signatures

| Symptom | Cause | Fix |
|---------|-------|-----|
| `v2ray.available: false` | V2Ray binary not downloaded | Run `npx sentinel-setup` or call `setup()` |
| `v2ray.version: "5.44.1"` | Wrong version — observatory bug breaks VMess | Delete and re-download v5.2.1 exactly |
| `wireguard.available: false` | WireGuard not installed | Install from wireguard.com |
| `admin: false` | Not elevated | WireGuard requires admin. Without it, only V2Ray works (~70% of network) |
| `capabilities: ["v2ray"]` | Admin false → WireGuard unavailable | Elevate with `run-admin.vbs` (Windows) or `sudo` (macOS/Linux) |

### Diagnostic Check
```bash
# V2Ray version (MUST be 5.2.1)
~/.sentinel-sdk/bin/v2ray version

# WireGuard available
wireguard.exe /version

# Admin check (Windows)
net session >nul 2>&1 && echo ADMIN || echo NOT ADMIN
```

---

## Phase 2: Wallet Setup

### What Happens
Creates or imports a BIP39 mnemonic, derives a Cosmos HD wallet (path `m/44'/118'/0'/0/0`), produces a `sent1...` address.

### Code
```javascript
import { createWallet, importWallet } from 'sentinel-ai-connect';

// Create new wallet
const wallet = await createWallet();
console.log(`Address: ${wallet.address}`);
console.log(`Mnemonic: ${wallet.mnemonic}`);
// ⚠ SAVE THE MNEMONIC. It cannot be recovered.

// OR import existing wallet
const imported = await importWallet('your twelve word mnemonic phrase goes right here in this string');
console.log(`Address: ${imported.address}`);
```

### Successful Output
```
Address: sent1abc...xyz
Mnemonic: word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12
```

### Failure Signatures

| Symptom | Cause | Fix |
|---------|-------|-----|
| `INVALID_MNEMONIC` | Not 12 or 24 words, or not valid BIP39 English words | Check for typos, extra spaces, wrong word count |
| `Cannot read properties of undefined (reading 'slice')` | Empty string or null passed as mnemonic | Ensure `.env` file exists and `MNEMONIC` is set |
| Address starts with `cosmos1` instead of `sent1` | Wrong bech32 prefix (using vanilla CosmJS without Sentinel prefix) | Use SDK's `generateWallet()`, not raw CosmJS |

### Diagnostic Check
```javascript
// Verify address format
const addr = imported.address;
console.assert(addr.startsWith('sent1'), 'Address must start with sent1');
console.assert(addr.length === 44, 'Address must be 44 characters');
```

---

## Phase 3: Balance Check

### What Happens
Queries the Sentinel blockchain (LCD REST API) for the wallet's `udvpn` balance. Tries 4 LCD endpoints with automatic failover.

### Code
```javascript
import { getBalance } from 'sentinel-ai-connect';

const bal = await getBalance('your twelve word mnemonic phrase...');
console.log(bal);
```

### Successful Output
```json
{
  "address": "sent1abc...xyz",
  "udvpn": 47690000,
  "p2p": "47.69",
  "funded": true
}
```

### Failure Signatures

| Symptom | Cause | Fix |
|---------|-------|-----|
| `udvpn: 0, funded: false` | Wallet has no tokens | Send P2P tokens to the `sent1...` address |
| `ECONNREFUSED` or timeout on all 4 LCD endpoints | Network down or all LCD endpoints unreachable | Check internet connection. Verify manually: `curl https://lcd.sentinel.co/cosmos/bank/v1beta1/balances/sent1...` |
| `funded: false` but `udvpn > 0` | Balance below 1,000,000 udvpn (1.0 P2P) threshold | Fund wallet with at least 1.0 P2P to cover gas + cheapest node |

### Diagnostic Check
```bash
# Manual balance check (replace address)
curl -s "https://lcd.sentinel.co/cosmos/bank/v1beta1/balances/sent1abc...xyz" | jq '.balances[] | select(.denom=="udvpn")'
```

### Cost Reference

> Prices are set by independent node operators and vary. Use `estimateCost()` for live pricing.

| Action | Approximate Cost |
|--------|------|
| Gas per TX | ~0.04 P2P |
| 1 GB (cheapest nodes) | ~0.68 P2P (varies) |
| 1 GB (median node) | ~40 P2P (varies) |
| `funded: true` threshold | 1.0 P2P |
| Comfortable testing budget | 50 P2P |

---

## Phase 4: Node Discovery

### What Happens
Queries the Sentinel LCD for all active nodes (`status=1`), fetches up to 5,000 nodes in a single request. Can optionally probe individual nodes for country, peers, and health.

### Code
```javascript
import { discoverNodes, getNetworkStats } from 'sentinel-ai-connect';

// Quick mode — chain data only, no probing (fast, < 3 seconds)
const nodes = await discoverNodes({ quick: true });
console.log(`Found ${nodes.length} active nodes`);
console.log('First node:', nodes[0]);

// Network overview
const stats = await getNetworkStats();
console.log(stats);
```

### Successful Output
```
Found 1030 active nodes
First node: {
  address: "sentnode1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5h38un",
  country: "DE",
  protocol: "wireguard",
  pricePerGb: "4.22",
  pricePerHour: null,
  score: 85,
  peers: 12,
  remoteUrl: "https://45.76.32.100:8585"
}

{
  totalNodes: 1030,
  byCountry: { DE: 42, US: 38, SG: 35, ... },
  byProtocol: { wireguard: 618, v2ray: 412 },
  transportReliability: { "tcp": "100%", "grpc/none": "87%", "websocket": "75%", ... }
}
```

### Failure Signatures

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Found 0 active nodes` | LCD endpoint returned empty, or using v2 path | Verify path is `/sentinel/node/v3/nodes?status=1` (NOT v2, NOT `STATUS_ACTIVE`) |
| Only ~400 nodes when 1000+ expected | Pagination truncated | Set `pagination.limit=5000` — SDK does this automatically |
| Country/protocol null on all nodes | Used `quick: true` mode (chain data only, no probing) | Use full mode (omit `quick`) for enriched data — takes 30-60s |
| `ECONNREFUSED` | LCD endpoints all down | Retry. Check manually: `curl https://lcd.sentinel.co/sentinel/node/v3/nodes?status=1&pagination.limit=5` |

### Diagnostic Check
```bash
# Count active nodes
curl -s "https://lcd.sentinel.co/sentinel/node/v3/nodes?status=1&pagination.limit=1&pagination.count_total=true" | jq '.pagination.total'

# Check single node
curl -s "https://lcd.sentinel.co/sentinel/node/v3/nodes/sentnode1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5h38un"
```

---

## Phase 5: Cost Estimation

### What Happens
Calculates how much a connection will cost before paying. Uses the node's on-chain price or network median if no specific node.

### Code
```javascript
import { estimateCost, recommend } from 'sentinel-ai-connect';

// Estimate for 1 GB
const cost = await estimateCost({ gigabytes: 1 });
console.log(cost);

// Or get a full recommendation
const rec = await recommend({
  country: 'Germany',
  priority: 'reliability',
  gigabytes: 1,
});
console.log(rec);
```

### Successful Output — estimateCost
```json
{
  "perGb": { "udvpn": 4220000, "p2p": "4.22" },
  "total": { "udvpn": 4220000, "p2p": "4.22" },
  "gas": { "udvpn": 40000, "p2p": "0.04" },
  "grandTotal": { "udvpn": 4260000, "p2p": "4.26" },
  "mode": "gigabyte"
}
```

### Successful Output — recommend
```json
{
  "action": "connect",
  "confidence": 0.9,
  "primary": {
    "address": "sentnode1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5h38un",
    "country": "DE",
    "protocol": "wireguard",
    "score": 85,
    "pricePerGb": "4.22",
    "peers": 12,
    "reason": "Exact country match, WireGuard available, low peer count"
  },
  "alternatives": [ /* 5 more nodes */ ],
  "estimatedCost": { "udvpn": 4260000, "p2p": "4.26" },
  "warnings": [],
  "reasoning": [
    "Checked capabilities: WireGuard available, admin elevated",
    "Queried 1030 active nodes",
    "Filtered to 42 nodes in Germany",
    "Selected top node by reliability score"
  ],
  "capabilities": { "wireguard": true, "v2ray": true, "admin": true }
}
```

### Failure Signatures

| Symptom | Cause | Fix |
|---------|-------|-----|
| `action: "cannot-connect"` | No nodes match filter (e.g. country with zero nodes) | Broaden filter, remove `strictCountry`, or use different country |
| `action: "connect-fallback"` | Exact country unavailable, using nearby country | Check `warnings` array for details |
| `pricePerGb` extremely high (>100 P2P) | Looking at `baseValue` instead of `quoteValue` | SDK handles this. If building manually: use `gigabyte_prices[0].amount` not `baseValue` |

---

## Phase 6: Session Creation (Payment)

### What Happens
Broadcasts a `MsgStartSession` transaction to the Sentinel blockchain. The node is notified on-chain that a session exists. Costs real P2P tokens.

**This is the point of no return — tokens are spent regardless of whether the connection succeeds.**

### Code (via connect — this happens automatically)
```javascript
// connect() handles this internally. The onProgress callback shows it:
const vpn = await connect({
  mnemonic: process.env.MNEMONIC,
  onProgress: (step, detail) => console.log(`[${step}] ${detail}`),
});
```

### Successful Progress Output
```
[wallet]      Wallet ready: sent12e03...
[wallet]      RPC connected: https://rpc.sentinel.co
[wallet]      LCD connected: https://lcd.sentinel.co
[wallet]      Balance: 47.69 P2P
[session]     Found 1030 active nodes
[session]     Selected node sentnode1qyp... (DE, WireGuard, 4.22 P2P/GB)
[session]     Broadcasting MsgStartSession...
[session]     TX broadcast: hash 7A3F...B21C
[session]     Waiting for block confirmation...
[session]     Session created: ID 485721
```

> **Progress tag reference:** The SDK emits these step names: `wallet`, `session`, `node-check`, `validate`, `handshake`, `tunnel`, `verify`, `proxy`, `recover`, `cache`, `dry-run`, `log`. Match against these when programmatically parsing progress output.

### Failure Signatures

| Symptom | Cause | Fix |
|---------|-------|-----|
| `INSUFFICIENT_BALANCE` | Not enough udvpn for session + gas | Fund wallet with more P2P tokens |
| `account sequence mismatch` | Previous TX still pending | SDK auto-retries up to 5 times with local sequence counter |
| `node does not exist` | Node went offline between query and TX | SDK retries once after 10s wait (chain lag). If persistent, try another node |
| `session already exists` | Active session with this node exists from a previous run | SDK detects and reuses the existing session |
| `BROADCAST_FAILED` after 5 retries | RPC endpoint congested | Wait 60s, then retry. Check RPC health: `curl https://rpc.sentinel.co/health` |
| `code 105: inactive` | Node just went inactive on-chain | SDK auto-retries with a different node |
| Progress stops at `[subscribe] Broadcasting...` | TX stuck in mempool | Wait up to 60s. Sentinel blocks are ~6s. If >60s, RPC may be congested |

### Diagnostic Check
```bash
# Check your sessions on-chain
curl -s "https://lcd.sentinel.co/sentinel/session/v3/accounts/sent1abc...xyz/sessions" | jq '.sessions | length'

# Check specific session
curl -s "https://lcd.sentinel.co/sentinel/session/v3/sessions/485721"
```

### Critical Timing
- After TX broadcast, the SDK waits for block confirmation (~6s)
- If session query returns "does not exist," the SDK waits 10s and retries (chain propagation lag)
- A new session may show `inactive_pending` status briefly — the SDK polls until `active`

---

## Phase 7: Handshake

### What Happens
The SDK sends an authenticated POST request to the node's HTTPS API. The body contains the session ID, a public key (X25519 for WireGuard or UUID for V2Ray), and a cryptographic signature proving ownership of the wallet that paid for the session.

**Signature construction:** `secp256k1_sign(SHA256(BigEndian_uint64(sessionId) + raw_peer_data_json_bytes))`

### Successful Progress Output — WireGuard
```
[handshake]   Handshaking with sentnode1qyp... (WireGuard)
[handshake]   Generated X25519 key pair
[handshake]   POST https://45.76.32.100:8585
[handshake]   WireGuard config received
[log]         Server public key: aB3x...kLm=
[log]         Endpoint: 45.76.32.100:51820
[log]         Tunnel IP: 10.8.0.2/32
```

### Successful Progress Output — V2Ray
```
[handshake]   Handshaking with sentnode1abc... (V2Ray)
[handshake]   Generated UUID: 7f3a...e2b1
[handshake]   POST https://198.51.100.42:8585
[handshake]   V2Ray config received
[log]         Protocol: VLess, Transport: grpc/none
[log]         Metadata entries: 3 outbounds available
[log]         Ports: [8686, 8787, 7874]
```

### Failure Signatures

| Symptom | Cause | Fix |
|---------|-------|-----|
| `HANDSHAKE_FAILED` with timeout | Node API is unreachable (HTTPS port down) | Try a different node. SDK timeout is 90s |
| `409 Conflict` | Session exists but node has stale state | SDK retries at 15s, 20s, then 25s. Usually resolves |
| `session does not exist` (code 5) | Chain propagation lag — node hasn't seen the TX yet | SDK waits 10s and retries once |
| `ECONNRESET` or `EPROTO` | Node TLS certificate issue or network instability | SDK uses TOFU TLS (first cert is trusted, changes are rejected) |
| `already exists` | Re-handshaking for an already-used session | SDK creates a fresh session and retries |
| `certificate has changed` | Possible MITM attack OR node rotated its cert | SDK rejects. Skip this node (security) |
| Handshake succeeds but V2Ray tunnel hangs | VLess `flow` field set to `xtls-rprx-vision` instead of `''` | Must be empty string — V2Ray 5.x silently rejects Xray-only flows |

### Diagnostic Check
```bash
# Check if node is reachable (replace URL from node's remote_addrs)
curl -k -s -o /dev/null -w "%{http_code}" https://45.76.32.100:8585/status

# Expected: 200 (node alive) or 401 (alive but needs auth)
# If timeout or connection refused: node is down
```

---

## Phase 8: Tunnel Installation

### What Happens

**WireGuard path:**
1. Writes `wgsent0.conf` with: private key, server public key, endpoint, allowed IPs, DNS
2. Calls `wireguard.exe /installtunnelservice <path>/wgsent0.conf`
3. Windows creates a `WireGuardTunnel$wgsent0` service
4. Waits for the adapter to appear and traffic to flow
5. Config file must remain on disk — the service reads it at startup

**V2Ray path:**
1. Builds client config JSON with inbound (SOCKS5 proxy) and outbounds (one per transport)
2. Spawns `v2ray.exe run -config <path>/config.json`
3. Tests each outbound sequentially (TCP probe → SOCKS5 connectivity → traffic test)
4. First working outbound wins — remaining are skipped
5. SOCKS5 port: `10800 + random(1000)` — randomized to avoid TIME_WAIT collisions

### Successful Progress Output — WireGuard
```
[tunnel]      Writing WireGuard config: wgsent0.conf
[tunnel]      Config: MTU=1280, DNS=10.8.0.1, PersistentKeepalive=15
[tunnel]      Installing tunnel service...
[tunnel]      Service WireGuardTunnel$wgsent0 started
[tunnel]      Adapter active: wgsent0
[tunnel]      Waiting 3s for tunnel stabilization...
[tunnel]      Tunnel ready
```

### Successful Progress Output — V2Ray
```
[tunnel]      Building V2Ray config with 3 outbounds
[tunnel]      SOCKS5 inbound on 127.0.0.1:11342
[tunnel]      Starting V2Ray process (PID 14208)
[tunnel]      Testing outbound 1/3: grpc/none on port 8686...
[tunnel]      TCP probe: port 8686 open (142ms)
[tunnel]      SOCKS5 test: connected (1.2s)
[tunnel]      Outbound 1 works — using grpc/none
```

### Failure Signatures

| Symptom | Cause | Fix |
|---------|-------|-----|
| `WG_NOT_AVAILABLE` or `Access denied` | Not running as admin | Elevate: `run-admin.vbs` (Windows) or `sudo` |
| `Service failed to start` | Orphaned WireGuard tunnel from previous crash | Run `wireguard.exe /uninstalltunnelservice wgsent0` manually |
| `MTU errors` or `TLS handshake failure through tunnel` | MTU set to 1420 instead of 1280 | SDK uses 1280. If building manually: ALWAYS use 1280 |
| All 3 V2Ray outbounds fail TCP probe | Node's V2Ray ports are firewalled | Try a different node |
| V2Ray starts but SOCKS5 returns `connection refused` | Port collision — another process on the same port | SDK randomizes port. If persistent: kill orphaned V2Ray processes |
| `WG_NO_CONNECTIVITY` | WireGuard tunnel installed but no traffic flows | Node may be overloaded or routing broken. Disconnect and try another node |
| Internet dies completely for ~78 seconds | Full-tunnel WireGuard installed before verification | SDK uses verify-before-capture: tests with split IPs first, then switches to full tunnel |
| V2Ray tunnel works for 10-18s then hangs | VLess with wrong `flow` field, OR VMess with clock drift >120s | Check node's clock. Ensure `flow: ''` for VLess |

### Diagnostic Check — WireGuard
```bash
# Check if WireGuard service exists
sc query WireGuardTunnel$wgsent0

# Check if adapter exists
netsh interface show interface name="wgsent0"

# Check if traffic flows
ping -n 1 10.8.0.1
```

### Diagnostic Check — V2Ray
```bash
# Check if V2Ray process is running
tasklist | grep v2ray

# Test SOCKS5 proxy (replace port)
curl --socks5-hostname 127.0.0.1:11342 https://api.ipify.org

# IMPORTANT: Use axios with adapter:'http', NOT native fetch
# Native fetch silently ignores SOCKS5 proxy configuration
```

---

## Phase 9: Verification

### What Happens
The SDK confirms the tunnel is actually working by checking the public IP through the tunnel. This verifies end-to-end connectivity.

### Code
```javascript
import { verify, status } from 'sentinel-ai-connect';

const v = await verify();
console.log(v);

const s = status();
console.log(s);
```

### Successful Output
```json
// verify()
{
  "connected": true,
  "ip": "45.76.32.100",
  "verified": true
}

// status()
{
  "connected": true,
  "sessionId": "485721",
  "protocol": "wireguard",
  "nodeAddress": "sentnode1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5h38un",
  "socksPort": null,
  "uptimeMs": 12345,
  "uptimeFormatted": "12s",
  "ip": "45.76.32.100"
}
```

### Failure Signatures

| Symptom | Cause | Fix |
|---------|-------|-----|
| `verified: false`, `ip: null` | Tunnel is up but no traffic flows | Disconnect and try a different node |
| `ip` matches your real IP (not the node's) | Tunnel not actually routing traffic (split tunnel or DNS leak) | Check WireGuard AllowedIPs includes `0.0.0.0/0` |
| `connected: false` | Tunnel collapsed between installation and verification | Reconnect |
| Timeout on IP check | `api.ipify.org` blocked through this node | Non-critical — tunnel may still work. Try `curl https://ifconfig.me` manually |

### Diagnostic Check
```bash
# WireGuard: IP should match the node's IP
curl https://api.ipify.org

# V2Ray: IP should match the node's IP (must use SOCKS5)
curl --socks5-hostname 127.0.0.1:11342 https://api.ipify.org

# DNS leak check
nslookup whoami.akamai.net
# Should resolve through tunnel DNS, not your ISP's DNS
```

---

## Complete Successful Connection — Full Log

This is the real output of a successful `connect()` call from start to finish:

```
[wallet]      Deriving wallet from mnemonic...
[wallet]      Wallet ready: sent1abc...xyz
[wallet]      Connecting to RPC: https://rpc.sentinel.co
[wallet]      RPC connected (chain: sentinelhub-2, height: 18,234,567)
[wallet]      LCD available: https://lcd.sentinel.co
[wallet]      Balance: 47.69 P2P (47,690,000 udvpn)
[session]     Querying active nodes...
[session]     Found 1,030 active nodes
[session]     Filtering: WireGuard preferred, country: any
[session]     Selected: sentnode1qyp... (DE, WireGuard, 4.22 P2P/GB, 12 peers)
[session]     Broadcasting MsgStartSession (1 GB, ~4.26 P2P total)...
[session]     TX hash: 7A3F8B2C...
[session]     Confirmed in block 18,234,573 (6.2s)
[session]     Session ID: 485721
[handshake]   POST https://45.76.32.100:8585/handshake
[handshake]   WireGuard keys exchanged successfully
[tunnel]      Installing WireGuard tunnel (MTU=1280, DNS=10.8.0.1)
[tunnel]      Service WireGuardTunnel$wgsent0 started
[tunnel]      Tunnel active — verifying connectivity...
[verify]      IP changed: 45.76.32.100 (was: 203.0.113.50)
[verify]      Tunnel verified — traffic flowing through node

Result: {
  sessionId: "485721",
  protocol: "wireguard",
  nodeAddress: "sentnode1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5h38un",
  socksPort: null,
  ip: "45.76.32.100"
}
```

**Total time:** ~20-45 seconds (depends on node responsiveness and chain block time)

---

## Failure Diagnosis Flowchart

If `connect()` throws an error, match the error against this progression to identify the exact failing phase:

```
Error contains "mnemonic" or "wallet"?
  → Phase 2 failure. Check mnemonic format.

Error contains "balance" or "insufficient"?
  → Phase 3 failure. Fund wallet.

Error contains "0 nodes" or "no nodes"?
  → Phase 4 failure. Check LCD endpoint connectivity.

Error contains "broadcast" or "sequence"?
  → Phase 6 failure. Chain TX issue. Wait and retry.

Error contains "handshake" or "409" or "does not exist"?
  → Phase 7 failure. Node communication issue. Try different node.

Error contains "V2RAY_NOT_FOUND" or "WG_NOT_AVAILABLE"?
  → Phase 8 failure. Missing binary or admin rights.

Error contains "no connectivity" or "tunnel" or "timeout"?
  → Phase 8-9 failure. Tunnel installed but broken. Try different node.

Error contains "ABORTED"?
  → Timeout exceeded (default 120s). Increase timeout or check network.

None of the above?
  → Check err.code and err.details for SDK error code.
  → Report with full error output for diagnosis.
```

---

## The One-Shot Test

Run this to verify everything works end-to-end in your environment:

```javascript
import 'dotenv/config';
import { setup, getBalance, connect, verify, disconnect } from 'sentinel-ai-connect';

async function test() {
  // Phase 1: Environment
  console.log('--- Phase 1: Environment ---');
  const env = await setup();
  if (!env.ready) {
    console.error('Environment not ready:', env.issues);
    return;
  }
  console.log('Environment OK:', env.environment.capabilities);

  // Phase 2-3: Wallet + Balance
  console.log('\n--- Phase 2-3: Wallet + Balance ---');
  const bal = await getBalance(process.env.MNEMONIC);
  console.log(`Balance: ${bal.p2p} P2P, funded: ${bal.funded}`);
  if (!bal.funded) {
    console.error(`Fund wallet: ${bal.address}`);
    return;
  }

  // Phase 4-9: Connect (handles discovery, payment, handshake, tunnel, verify)
  console.log('\n--- Phase 4-9: Connect ---');
  try {
    const vpn = await connect({
      mnemonic: process.env.MNEMONIC,
      onProgress: (step, detail) => console.log(`  [${step}] ${detail}`),
    });

    console.log('\n--- Result ---');
    console.log(`Protocol: ${vpn.protocol}`);
    console.log(`Node: ${vpn.nodeAddress}`);
    console.log(`Session: ${vpn.sessionId}`);
    console.log(`IP: ${vpn.ip}`);

    // Extra verification
    const v = await verify();
    console.log(`Verified: ${v.verified}`);

    // Disconnect
    console.log('\n--- Disconnect ---');
    await disconnect();
    console.log('Disconnected successfully');

  } catch (err) {
    console.error(`FAILED: ${err.message}`);
    console.error(`Code: ${err.code}`);
    console.error(`Details: ${JSON.stringify(err.details)}`);
    // Match against the Failure Diagnosis Flowchart above
  }
}

test();
```

**Expected:** All phases complete, IP changes, `verified: true`, clean disconnect.

**If it fails:** The `onProgress` output shows exactly which phase succeeded before the failure. Match the last successful phase and the error against the tables above.
