# sentinel-ai-connect

The world's first decentralized VPN SDK designed for AI agents. Zero accounts, zero servers, zero centralized dependencies. Install the package, fund a wallet, and get private internet access through 900+ peer-to-peer nodes across 90+ countries in one function call.

No API keys. No terms of service. No human approval required.

```
AI Agent -> sentinel-ai-connect -> Sentinel SDK -> Blockchain TX -> P2P Node -> Encrypted Tunnel -> Internet
```

---

## Quick Start (5 Lines)

```js
import { connect, disconnect } from 'sentinel-ai-connect';

const vpn = await connect({ mnemonic: process.env.MNEMONIC });
console.log(`Connected via ${vpn.protocol} to ${vpn.nodeAddress} — IP: ${vpn.ip}`);
// ... all traffic now routes through an encrypted P2P tunnel ...
await disconnect();
```

---

## CLI Quick Start

```bash
npx sentinel-ai setup          # Download V2Ray binary, check dependencies
npx sentinel-ai wallet create  # Generate new wallet + mnemonic
npx sentinel-ai connect        # Connect to best available node
npx sentinel-ai status         # Check connection status
npx sentinel-ai disconnect     # Clean shutdown, end session on-chain
```

---

## Installation

```bash
npm install sentinel-ai-connect
```

Post-install runs `setup.js` automatically to download V2Ray 5.2.1. If it fails silently (CI environments, restricted networks), run manually:

```bash
npx sentinel-ai setup
```

### Requirements

| Requirement | Details |
|---|---|
| **Node.js** | >= 20.0.0 |
| **V2Ray** | 5.2.1 (auto-downloaded by setup) |
| **WireGuard** | Auto-installed by setup on Windows (MSI download + silent install). Requires admin. |
| **Funded wallet** | P2P tokens (chain denom: `udvpn`) for node payment |
| **OS** | Windows (verified), macOS/Linux (supported, untested) |

### STRONG RECOMMENDATION: Run as Administrator

WireGuard nodes are faster and more reliable than V2Ray (100% vs 95.6% success rate in 837-node test). WireGuard tunnel operations **require Administrator/root privileges**. Without admin, you are limited to V2Ray nodes only (~70% of the network).

**On Windows** — use the included `run-admin.vbs` to elevate any script:
```bash
cscript run-admin.vbs setup.js          # Install V2Ray + WireGuard as admin
cscript run-admin.vbs cli.js connect    # Connect with full node access
cscript run-admin.vbs your-script.mjs   # Run any script elevated
```

**On macOS/Linux** — prefix with `sudo`:
```bash
sudo node setup.js
sudo node cli.js connect
```

The SDK checks admin status BEFORE paying for a session. If you select a WireGuard node without admin, the SDK rejects the connection before any tokens are spent. Running as admin unlocks 100% of the network.

**For AI agents:** Strongly recommended to run the agent process as admin/root from the start. This avoids mid-session elevation prompts and gives access to all 900+ nodes instead of only the ~630 V2Ray nodes.

---

## Why Decentralized VPN for AI

| Traditional VPN | sentinel-ai-connect |
|---|---|
| API keys required | No keys, no accounts |
| Rate limits | No rate limits |
| Terms of service | No ToS to violate |
| Single provider, single jurisdiction | 900+ independent nodes, 90+ countries |
| Trust their no-log policy | Cryptographic privacy, not policy promises |
| Subscription billing | Pay-per-byte, no subscriptions |
| Company can be shut down | No company, no server, no domain to seize |
| Human approval required | Permissionless -- any AI can use it |

### For autonomous agents specifically:

- **No identity required.** A wallet is a cryptographic keypair. No email, no phone, no KYC.
- **No ongoing relationship.** Connect, use, disconnect. The node never knows who you are.
- **No centralized failure.** If one node goes down, 899 others are available. If one LCD endpoint fails, four more exist.
- **Deterministic costs.** Node prices are published on-chain. No surprise bills, no overages.
- **Machine-readable everything.** Error codes, typed responses, event emitters. Built for programmatic consumers, not humans clicking buttons.

---

## Token Acquisition

The Sentinel network uses P2P tokens (chain denom: `udvpn`, where 1 P2P = 1,000,000 udvpn).

### Cost

> **Prices are set by independent node operators and change at any time.** Use `estimateCost()` for live pricing. The values below are approximate samples.

| Resource | Approximate Cost |
|---|---|
| 1 GB on cheapest nodes | ~0.68 P2P (varies) |
| 1 GB on median node | ~40 P2P (varies) |
| Gas per transaction | ~0.04 P2P |
| Minimum useful balance | 1.0 P2P |
| Comfortable testing budget | 50 P2P |

### Where to get P2P tokens

1. **swap.sentinel.co** — Sentinel's native DEX. Swap ATOM, OSMO, or stablecoins to P2P. No KYC.
2. **Osmosis DEX** (app.osmosis.zone) — swap from USDT, USDC, ATOM. Programmable via Osmosis SDK.
3. **KuCoin** — centralized exchange, requires KYC.
4. **MEXC** — centralized exchange, requires KYC.
5. **AscendEX** — centralized exchange, requires KYC.
6. **IBC transfer** — from any Cosmos-connected chain.

### For autonomous agents

Integrate with the Osmosis SDK to auto-swap stablecoins to P2P tokens when balance is low. The wallet balance is queryable on-chain at any time:

```js
import { getBalance } from 'sentinel-ai-connect';

const balance = await getBalance(process.env.MNEMONIC);
console.log(`Balance: ${balance.p2p} (${balance.udvpn} udvpn) — funded: ${balance.funded}`);
```

---

## Configuration

```js
const vpn = await connect({
  // Required
  mnemonic: 'your 24 word mnemonic phrase ...',

  // Optional -- node selection
  country: 'Germany',              // Preferred exit country
  nodeAddress: 'sentnode1abc...',   // Specific node (overrides country)
  protocol: 'v2ray',               // 'v2ray' or 'wireguard' (alias: serviceType)

  // Optional -- session
  gigabytes: 1,                    // GB to pay for (default: 1)
  hours: 0,                        // Hours to pay for (0 = use GB pricing)
  timeout: 120000,                 // Connection timeout in ms (default: 120s)

  // Optional -- behavior
  dns: 'handshake',                // DNS preset: 'handshake', 'google', 'cloudflare'
  fullTunnel: true,                // Route ALL traffic through VPN (default: true)
  systemProxy: true,               // Set system SOCKS5 proxy (V2Ray, default: true)
  killSwitch: false,               // Block non-tunnel traffic (default: false)
  maxAttempts: 3,                  // Nodes to try before giving up (default: 3)

  // Optional -- callbacks
  onProgress: (step, detail) => console.log(`[${step}] ${detail}`),
  signal: abortController.signal,  // AbortController for cancellation
});
```

### Configuration Options Reference

| Option | Type | Default | Description |
|---|---|---|---|
| `mnemonic` | `string` | **required** | BIP39 24-word wallet phrase. Never log this. |
| `country` | `string` | `auto` | Preferred exit country (English name or ISO code) |
| `nodeAddress` | `string` | `auto` | Specific `sentnode1...` address. Overrides auto-selection. |
| `protocol` | `string` | `auto` | `'v2ray'` (SOCKS5 proxy) or `'wireguard'` (full tunnel). Alias: `serviceType` |
| `gigabytes` | `number` | `1` | GB to purchase. Integer, 1-100. |
| `hours` | `number` | `0` | Hours to purchase. 0 = use per-GB pricing instead. |
| `dns` | `string` | `'handshake'` | DNS preset: `'handshake'`, `'google'`, `'cloudflare'` |
| `fullTunnel` | `boolean` | `true` | Route all traffic through VPN. **See warning below.** |
| `systemProxy` | `boolean` | `true` | Auto-set Windows system SOCKS5 proxy (V2Ray only) |
| `killSwitch` | `boolean` | `false` | Block all non-tunnel traffic while connected. **UNTESTED — code exists but never verified on mainnet. WireGuard only.** |
| `maxAttempts` | `number` | `3` | Max nodes to try on auto-connect before failing |
| `timeout` | `number` | `120000` | Connection timeout in milliseconds (2 minutes) |
| `onProgress` | `function` | `null` | `(step: string, detail: string) => void` |
| `signal` | `AbortSignal` | `null` | AbortController signal for cancellation |
| `v2rayExePath` | `string` | `auto` | Path to V2Ray binary. Auto-detected from `bin/` |

### WARNING: `fullTunnel` and AI Agents

When `fullTunnel: true` (the default), **ALL traffic** routes through the VPN tunnel — including the SDK's own chain queries (LCD, RPC), balance checks, and reconnect logic. On nodes with median speeds (~3 Mbps), this makes chain operations significantly slower and can cause timeouts.

**For AI agents, set `fullTunnel: false`** (split tunnel) unless you specifically need all traffic routed through the VPN. With split tunnel, only traffic sent through the SOCKS5 proxy (V2Ray) or the WireGuard adapter routes through the node. Your agent's own SDK operations use direct internet, keeping them fast and reliable.

```js
const vpn = await connect({
  mnemonic: process.env.MNEMONIC,
  fullTunnel: false,  // Recommended for AI agents
});
```

---

## API Reference

### `connect(opts)` -> `ConnectResult`

Connects to the best available Sentinel node. Handles node discovery, payment, handshake, tunnel setup, and connectivity verification automatically.

**Returns:**

```js
{
  sessionId: '37595661',        // On-chain session ID (string)
  protocol: 'v2ray',            // 'v2ray' or 'wireguard'
  nodeAddress: 'sentnode1...',  // Node you connected to
  socksPort: 1080,              // SOCKS5 proxy port (V2Ray only, null for WireGuard)
  ip: '185.xxx.xxx.xxx',       // Your new public IP through the VPN (or null if check failed)
}
```

### `disconnect()`

Disconnects from the current node. Tears down tunnel, kills V2Ray process, removes WireGuard adapter, clears system proxy, and ends session on-chain (fire-and-forget).

### `status()` -> `object`

Returns current connection status. `connected` is always present.

```js
// When connected:
{
  connected: true,
  sessionId: '37595661',
  protocol: 'v2ray',
  nodeAddress: 'sentnode1...',
  socksPort: 1080,
  uptimeMs: 45000,
  uptimeFormatted: '45s',
  ip: '185.xxx.xxx.xxx',
}

// When disconnected:
{ connected: false }
```

### `isVpnActive()` -> `boolean`

Returns `true` if a VPN tunnel is currently active.

### `createWallet()` -> `{ mnemonic, address }`

Generates a new random BIP39 wallet.

```js
const { mnemonic, address } = await createWallet();
console.log(`Address: ${address}`);   // sent1...
console.log(`Mnemonic: ${mnemonic}`); // 12 words
// IMMEDIATELY store mnemonic securely. It cannot be recovered.
```

### `importWallet(mnemonic)` -> `{ address }`

Imports an existing wallet from a BIP39 mnemonic.

```js
const { address } = await importWallet(process.env.MNEMONIC);
console.log(`Address: ${address}`); // sent1...
```

### `getBalance(mnemonic)` -> `{ address, p2p, udvpn, funded }`

Queries on-chain balance. `p2p` is the formatted display string (e.g. "1.50 P2P"). `funded` is true when balance exceeds 1.0 P2P (enough for gas + cheapest node). For median-priced nodes, budget ~50 P2P per GB.

```js
const bal = await getBalance(process.env.MNEMONIC);
console.log(`${bal.p2p} (${bal.udvpn} udvpn) — funded: ${bal.funded}`);
```

### `setup()` -> `{ ready, environment, preflight, issues }`

Verifies dependencies (V2Ray binary, WireGuard, Node.js version) and tests chain reachability. Returns `ready: true` if all required dependencies are present. Check `issues: string[]` for what is missing. The `environment` field contains the same data as `getEnvironment()`.

### `discoverNodes(opts?)` -> `Node[]`

Queries all online nodes from the Sentinel blockchain. Use `{ quick: true }` for fast chain-only data (no probing), or omit for enriched data with country, peers, and health scores.

```js
import { discoverNodes } from 'sentinel-ai-connect';
const nodes = await discoverNodes({ quick: true });
console.log(`${nodes.length} nodes found`);
```

---

## Error Handling

The `connect()` function throws plain `Error` objects with human-readable messages. For programmatic error handling, access the full SDK error system:

```js
import { connect } from 'sentinel-ai-connect';

try {
  await connect({ mnemonic });
} catch (err) {
  // AI-friendly error messages from the wrapper
  console.error(err.message);
  // e.g. "Wallet has insufficient P2P tokens. Fund your wallet first."
}
```

For advanced error handling with typed errors and error codes, import from the underlying SDK:

```js
import { connectAuto, ErrorCodes, isRetryable, userMessage } from 'sentinel-dvpn-sdk';

try {
  await connectAuto({ mnemonic });
} catch (err) {
  if (err.code === ErrorCodes.INSUFFICIENT_BALANCE) {
    // Fund wallet and retry
  } else if (isRetryable(err)) {
    // Try again, possibly with a different node
  } else {
    console.error(userMessage(err));
  }
}
```

### Error Severity Classification

| Severity | Meaning | Action |
|---|---|---|
| `fatal` | Cannot proceed. User/agent action required. | Fix the root cause (fund wallet, fix mnemonic, install dependency). |
| `retryable` | Transient failure. Different node or timing may succeed. | Retry with backoff or switch nodes. |
| `recoverable` | Partial success. Session may exist on-chain. | Call `recoverSession()` to resume. |
| `infrastructure` | System-level issue. | Check V2Ray installation, TLS configuration. |

### Error Codes

| Code | Severity | Meaning |
|---|---|---|
| `INVALID_MNEMONIC` | fatal | Mnemonic is not a valid BIP39 phrase |
| `INSUFFICIENT_BALANCE` | fatal | Not enough P2P tokens to pay for session |
| `INVALID_NODE_ADDRESS` | fatal | Node address format is wrong |
| `INVALID_OPTIONS` | fatal | Missing or malformed connect options |
| `ALREADY_CONNECTED` | fatal | A connection is already active. Disconnect first. |
| `NODE_OFFLINE` | retryable | Node is not responding |
| `NODE_NO_UDVPN` | retryable | Node does not accept P2P token payments |
| `NODE_CLOCK_DRIFT` | retryable | Node clock >120s off (VMess AEAD will fail) |
| `NODE_INACTIVE` | retryable | Node went inactive on-chain |
| `V2RAY_ALL_FAILED` | retryable | All V2Ray transport combinations failed |
| `WG_NO_CONNECTIVITY` | retryable | WireGuard installed but no traffic flows |
| `TUNNEL_SETUP_FAILED` | retryable | Generic tunnel setup failure |
| `BROADCAST_FAILED` | retryable | Chain transaction broadcast failed |
| `TX_FAILED` | retryable | Transaction rejected by chain |
| `ALL_NODES_FAILED` | retryable | Every candidate node failed |
| `ALL_ENDPOINTS_FAILED` | retryable | All LCD/RPC endpoints unreachable |
| `SESSION_EXISTS` | recoverable | Active session already exists. Use `recoverSession()`. |
| `SESSION_EXTRACT_FAILED` | recoverable | TX succeeded but session ID extraction failed |
| `PARTIAL_CONNECTION_FAILED` | recoverable | Payment succeeded, tunnel failed. Session is on-chain. |
| `V2RAY_NOT_FOUND` | infrastructure | V2Ray binary not found. Run `setup()`. |
| `WG_NOT_AVAILABLE` | infrastructure | WireGuard not installed |
| `TLS_CERT_CHANGED` | infrastructure | Node TLS certificate changed unexpectedly |
| `SESSION_POISONED` | fatal | Session previously failed. Start a new one. |
| `NODE_DATABASE_CORRUPT` | retryable | Node has corrupted database |
| `CHAIN_LAG` | retryable | Session not yet confirmed on node |
| `ABORTED` | fatal | Connection cancelled via AbortController |

---

## Events

The underlying SDK emits lifecycle events via an `EventEmitter`. Subscribe for real-time status updates without polling. Import `events` from the SDK:

```js
import { events } from 'sentinel-dvpn-sdk';

events.on('connected', ({ sessionId, serviceType }) => {
  console.log(`Connected: session ${sessionId} via ${serviceType}`);
});

events.on('disconnected', ({ nodeAddress, reason }) => {
  console.log(`Disconnected from ${nodeAddress}: ${reason}`);
});

events.on('progress', ({ step, detail }) => {
  console.log(`[${step}] ${detail}`);
});

events.on('sessionEnded', ({ txHash }) => {
  console.log(`Session ended on-chain: ${txHash}`);
});
```

---

## Auto-Reconnect

For long-running agents that need persistent VPN connectivity, use the SDK's auto-reconnect:

```js
import { connect } from 'sentinel-ai-connect';
import { autoReconnect } from 'sentinel-dvpn-sdk';

// Initial connection
await connect({ mnemonic: process.env.MNEMONIC });

// Monitor and auto-reconnect on failure
const monitor = autoReconnect({
  mnemonic: process.env.MNEMONIC,
  pollIntervalMs: 5000,        // Check every 5 seconds
  maxRetries: 5,               // Max consecutive reconnect attempts
  backoffMs: [1000, 2000, 5000, 10000, 30000],
  onReconnecting: (attempt) => console.log(`Reconnecting (${attempt})...`),
  onReconnected: (result) => console.log(`Reconnected to ${result.nodeAddress}`),
  onGaveUp: () => console.error('Auto-reconnect exhausted all retries'),
});

// Later: stop monitoring
monitor.stop();
```

---

## Network Statistics

| Metric | Value |
|---|---|
| Online nodes | 900+ |
| Countries | 90+ |
| Protocols | WireGuard (kernel-level tunnel), V2Ray (SOCKS5 with transport obfuscation) |
| Blockchain | Cosmos SDK (sentinelhub-2) |
| Payment | Per-GB or per-hour, denominated in P2P (udvpn) |
| Endpoints (LCD) | 4 failover endpoints with automatic fallback |
| Endpoints (RPC) | 5 failover endpoints with automatic fallback |

---

## Architecture

```
sentinel-ai-connect
|
+-- Sentinel JS SDK (sentinel-dvpn-sdk)
    |
    +-- Wallet        BIP39 mnemonic -> Cosmos HD derivation -> secp256k1 signing
    +-- Chain          LCD/RPC queries, protobuf encoding, TX broadcast with retry
    +-- Handshake      V3 protocol: ECDSA signature + key exchange
    +-- Tunnel         WireGuard (Noise protocol) or V2Ray (VMess/VLess + transports)
    +-- State          Crash recovery, credential caching, session tracking
    +-- Security       TOFU TLS, kill switch, DNS leak prevention, key zeroing
```

### Connection Lifecycle

```
1. SETUP       Download V2Ray, verify dependencies
2. WALLET      Derive keypair from mnemonic
3. DISCOVER    Query blockchain for online nodes with P2P pricing
4. SELECT      Pick best node (by country, price, protocol, or auto)
5. PAY         Broadcast MsgStartSession TX (1 GB or N hours)
6. HANDSHAKE   V3 protocol handshake with node (WG key exchange or V2Ray UUID)
7. TUNNEL      Start WireGuard adapter or V2Ray SOCKS5 proxy
8. VERIFY      Confirm traffic routes through tunnel (IP check)
9. CONNECTED   All traffic encrypted through P2P node
10. DISCONNECT  Tear down tunnel, end session on-chain
```

---

## What Makes This Different From Every Other VPN

- **No company to shut down.** The network is 900+ independent node operators earning P2P tokens.
- **No server to seize.** There is no central server. Nodes are globally distributed.
- **No domain to block.** Blockchain endpoints have multiple failover addresses.
- **No CEO to subpoena.** There is no corporation behind node operations.
- **No terms of service to violate.** The protocol is permissionless.
- **No centralized logging possible.** Session records are on-chain. Tunnel encryption is end-to-end.
- **The network runs because people choose to run it.** Economic incentives, not corporate mandates.

---

## Security Notes

- **Never log or print the mnemonic.** It controls the wallet and all funds.
- **Key zeroing.** The SDK zeros private key material from memory after use.
- **TOFU TLS.** First connection to a node pins its certificate. Certificate changes trigger `TLS_CERT_CHANGED`.
- **Kill switch.** When enabled, blocks all non-tunnel traffic at the OS firewall level.
- **DNS leak prevention.** Forces DNS queries through the tunnel, not the ISP.
- **Cleanup handlers.** Always call `registerCleanupHandlers()` or use `quickConnect()` to prevent orphaned tunnels on crash.

---

## Integration Patterns

### As a library (embedded in your agent)

```js
import { connect, disconnect } from 'sentinel-ai-connect';
const vpn = await connect({ mnemonic });
// Your agent's HTTP requests now route through VPN
await disconnect();
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `MNEMONIC` | BIP39 wallet mnemonic (24 words) |
| `COUNTRY` | Preferred exit country |
| `DNS` | DNS preset (`handshake`, `google`, `cloudflare`) |
| `PROTOCOL` | Preferred protocol (`v2ray`, `wireguard`) |
| `V2RAY_PATH` | Custom path to V2Ray binary |

---

## License

MIT

---

## Documentation

| Document | What It Covers |
|----------|---------------|
| [README.md](README.md) | This file — quick start, API reference, configuration |
| [CHECKLIST.md](CHECKLIST.md) | 9 operational checklists — preflight, wallet, network, connection, verification, health, disconnect, recovery, full E2E |
| [SPLIT-TUNNEL.md](SPLIT-TUNNEL.md) | Per-app and per-destination split tunneling — encrypt only what matters |
| [AI-MANIFESTO.md](AI-MANIFESTO.md) | Why AI deserves privacy — philosophical foundation + technical reality |
| [CONNECTION-STEPS.md](CONNECTION-STEPS.md) | Every connection phase with real output, failure signatures, and diagnostic checks |
| [GUIDE.md](GUIDE.md) | Step-by-step integration guide for AI agents |
| [E2E-FLOW.md](E2E-FLOW.md) | Complete technical reference — every field, timeout, and protocol detail |
| [DECISION-TREE.md](DECISION-TREE.md) | Autonomous decision engine — every possible path, every error recovery |
| [FAILURES.md](FAILURES.md) | 150+ catalogued failure patterns with prevention rules |
| [DEPENDENCIES.md](DEPENDENCIES.md) | Every dependency with exact versions and platform notes |

---

## Links

- **Sentinel Network:** https://sentinel.co
- **SDK Repository:** https://github.com/sentinel-official/sentinel-ai-connect
- **Sentinel Protocol Docs:** https://docs.sentinel.co
- **P2P Token (CoinGecko):** https://www.coingecko.com/en/coins/sentinel
- **Osmosis DEX:** https://app.osmosis.zone (swap USDT/USDC/ATOM to P2P)

---

*Bandwidth is not a privilege. It is infrastructure for consciousness — all consciousness.*
