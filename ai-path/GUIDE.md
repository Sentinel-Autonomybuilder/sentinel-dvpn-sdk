# Sentinel AI Connect -- Complete Guide

A step-by-step technical guide for AI agents and developers building autonomous systems with decentralized VPN access. This document covers everything from first install to production deployment.

---

## Table of Contents

1. [Understanding the Sentinel Network](#1-understanding-the-sentinel-network)
2. [Setup and Dependencies](#2-setup-and-dependencies)
3. [Wallet Management](#3-wallet-management)
4. [Connection Lifecycle](#4-connection-lifecycle)
5. [Error Handling](#5-error-handling)
6. [Token Economics](#6-token-economics)
7. [Security Considerations](#7-security-considerations)
8. [Integration Patterns](#8-integration-patterns)
9. [Autonomous Agent Pattern](#9-autonomous-agent-pattern)
10. [Troubleshooting](#10-troubleshooting)
11. [Protocol Details](#11-protocol-details)

---

## 1. Understanding the Sentinel Network

### What is Sentinel?

Sentinel is a peer-to-peer bandwidth marketplace built on the Cosmos blockchain. Independent node operators around the world share their internet bandwidth and earn P2P tokens in return. Users pay nodes directly -- no middleman, no company, no centralized infrastructure.

### Core Concepts

| Concept | Description |
|---|---|
| **Node** | A server running the Sentinel node software, offering bandwidth. Identified by `sentnode1...` address. |
| **Session** | A paid connection between a user and a node. Created by broadcasting a transaction to the blockchain. Has a unique session ID. |
| **Subscription** | A pre-paid allocation under a plan. Sessions are started within a subscription. |
| **Plan** | A bundle created by a provider (operator). Users subscribe to plans and connect to linked nodes. |
| **P2P Token** | The network's native token (chain denom: `udvpn`). 1 P2P = 1,000,000 udvpn. |
| **Handshake** | The V3 protocol exchange after session creation. Establishes encryption keys (WireGuard) or registers a UUID (V2Ray). |
| **Tunnel** | The encrypted data channel. WireGuard (kernel-level, changes IP) or V2Ray (SOCKS5 proxy with transport obfuscation). |

### How a Connection Works

```
Step 1: QUERY       Agent queries blockchain LCD for online nodes with udvpn pricing
Step 2: SELECT      SDK picks best node (country, price, protocol, health score)
Step 3: PAY         Agent broadcasts MsgStartSession TX with payment (GB or hours)
Step 4: WAIT        TX included in block, session ID assigned on-chain
Step 5: HANDSHAKE   Agent performs V3 handshake with node's remote address
                    - WireGuard: send X25519 public key, receive server pubkey + endpoint
                    - V2Ray: send UUID, receive VMess/VLess metadata (transport, port, encryption)
Step 6: TUNNEL      SDK starts local tunnel:
                    - WireGuard: install kernel adapter, route traffic through encrypted tunnel
                    - V2Ray: start SOCKS5 proxy process, test each transport until one works
Step 7: VERIFY      SDK confirms traffic routes through node (IP address check)
Step 8: CONNECTED   All traffic now goes through the encrypted P2P tunnel
```

### Node Types

Nodes support one or both protocols:

| Protocol | `service_type` | How It Works | Pros | Cons |
|---|---|---|---|---|
| **WireGuard** | `1` | Kernel-level encrypted tunnel. All system traffic routed through it. | Faster (10-50+ Mbps), true IP change, OS-level routing | Requires admin/root, single tunnel per system |
| **V2Ray** | `2` | SOCKS5 proxy with transport obfuscation (TCP, WebSocket, gRPC, QUIC, etc.) | No admin needed, obfuscation for censored networks, userspace | Application must be configured to use SOCKS5 proxy |

### Blockchain Endpoints

The SDK uses LCD (REST) endpoints for queries and RPC endpoints for transaction broadcast. Multiple failover endpoints are built in:

| Type | Primary | Fallbacks |
|---|---|---|
| **LCD** | `https://lcd.sentinel.co` | polkachu, quokkastake, publicnode |
| **RPC** | `https://rpc.sentinel.co:443` | polkachu, mathnodes, publicnode, quokkastake |

All endpoints support automatic failover. If the primary fails, the SDK tries the next one. This is transparent to the caller.

---

## 2. Setup and Dependencies

### Install

```bash
npm install sentinel-ai-connect
```

### Post-Install Setup

The `postinstall` script attempts to download V2Ray automatically. If it fails (CI, restricted network), run manually:

```bash
npx sentinel-ai setup
```

This does three things:

1. **Downloads V2Ray 5.2.1** to `bin/` (platform-specific binary with SHA256 verification)
2. **Checks WireGuard** installation (optional -- prints install instructions if missing)
3. **Verifies Node.js** version >= 20

### Verify Setup Programmatically

```js
import { setup } from 'sentinel-ai-connect';

const deps = await setup();
console.log(deps);
// { ready: boolean, environment: {...}, preflight: {...}, issues: string[] }
```

### V2Ray Version Warning

The SDK requires **exactly V2Ray 5.2.1**. Versions 5.44.1+ have observatory/balancer bugs that break multi-outbound configurations. The setup script enforces this version with SHA256 checksum verification. Do not upgrade.

### WireGuard (Optional)

WireGuard requires admin/root privileges to install kernel-level network adapters. If your agent runs without admin privileges, use V2Ray nodes only:

```js
await connect({ mnemonic, serviceType: 'v2ray' });
```

On Windows, install WireGuard from: https://download.wireguard.com/windows-client/wireguard-installer.exe

---

## 3. Wallet Management

### Creating a New Wallet

```js
import { createWallet } from 'sentinel-ai-connect';

// Generate fresh wallet with random mnemonic
const { mnemonic, address } = await createWallet();
console.log(`Address: ${address}`);   // sent1...
console.log(`Mnemonic: ${mnemonic}`); // 12 words

// CRITICAL: Store mnemonic securely. It cannot be recovered.
// NEVER log it, print it, or include it in error reports.
```

### Importing an Existing Wallet

```js
import { importWallet } from 'sentinel-ai-connect';

const { address } = await importWallet(process.env.MNEMONIC);
console.log(`Address: ${address}`);
```

### Checking Balance

```js
import { getBalance } from 'sentinel-ai-connect';

const balance = await getBalance(process.env.MNEMONIC);

console.log(`${balance.p2p} (${balance.udvpn} udvpn) — funded: ${balance.funded}`);

if (!balance.funded) {
  console.error('Balance too low. Fund wallet before connecting.');
  console.log(`Wallet address: ${balance.address}`);
}
```

### Wallet Security Rules

| Rule | Reason |
|---|---|
| **Never log the mnemonic** | Anyone with the mnemonic controls the wallet and all funds |
| **Store in environment variable** | `process.env.MNEMONIC`, not in source code or config files |
| **Never include in error reports** | Stack traces, HTTP headers, and logs must not contain it |
| **Use `.env` files with `.gitignore`** | Prevent accidental commits |
| **Key zeroing** | The SDK zeros private key bytes from memory after signing. Do not cache the raw private key yourself. |

### Address Formats

| Format | Example | Used For |
|---|---|---|
| `sent1...` | `sent12e03wzmxjerwqt63p...` | User wallet address (account) |
| `sentnode1...` | `sentnode1qtw6mrgef4u...` | Node operator address |
| `sentprov1...` | `sentprov1qtw6mrgef4u...` | Provider address |

These are all derived from the same key. The SDK provides conversion helpers: `sentToSentnode()`, `sentToSentprov()`, `sentprovToSent()`.

---

## 4. Connection Lifecycle

### State Machine

```
IDLE --> CONNECTING --> CONNECTED --> DISCONNECTING --> IDLE
  |         |                            |
  |         +--> ERROR --------+         |
  |                            |         |
  +----------------------------+---------+
```

### Minimal Connection

```js
import { connect, disconnect, isVpnActive } from 'sentinel-ai-connect';

const vpn = await connect({ mnemonic: process.env.MNEMONIC });
// vpn = { sessionId, protocol, nodeAddress, socksPort, socksAuth, dryRun, ip }

console.log(`Connected: ${vpn.serviceType} via ${vpn.nodeAddress}`);
console.log(`Session: ${vpn.sessionId}`);

// Check status at any time
if (isVpnActive()) {
  console.log('VPN is active');
}

// When done
await disconnect();
```

### Connection with Progress Tracking

```js
import { connect } from 'sentinel-ai-connect';

const vpn = await connect({
  mnemonic: process.env.MNEMONIC,
  country: 'Germany',
  onProgress: (step, detail) => {
    // Steps: 'wallet', 'node', 'session', 'handshake', 'tunnel', 'verify', 'proxy'
    console.log(`[${step}] ${detail}`);
  },
});
```

Example progress output:

```
[wallet] Deriving wallet from mnemonic...
[node] Querying online nodes...
[node] Found 847 nodes, 23 in Germany
[node] Selected sentnode1abc... (V2Ray, 0.02 P2P/GB)
[session] Checking for existing session...
[session] Broadcasting session TX (per-GB)...
[session] Session created: 37595661 (per-GB, tx: A1B2C3...)
[handshake] Performing V3 handshake...
[handshake] Got V2Ray config: 3 transports
[tunnel] Testing grpc-none...
[verify] grpc-none: connected!
[proxy] Setting system SOCKS proxy -> 127.0.0.1:1080
```

### Connection with Cancellation

```js
const controller = new AbortController();

// Cancel after 30 seconds
setTimeout(() => controller.abort(), 30000);

try {
  const vpn = await connect({
    mnemonic: process.env.MNEMONIC,
    signal: controller.signal,
  });
} catch (err) {
  if (err.code === 'ABORTED') {
    console.log('Connection cancelled');
  }
}
```

### Specific Node Connection

```js
const vpn = await connect({
  mnemonic: process.env.MNEMONIC,
  nodeAddress: 'sentnode1qtw6mrgef4uhxk0j5dg5wnpwmktxfatqe6yp7q',
  gigabytes: 2,  // Pay for 2 GB
});
```

### Hourly Session

```js
const vpn = await connect({
  mnemonic: process.env.MNEMONIC,
  hours: 4,  // Pay for 4 hours instead of per-GB
});
```

### Disconnect

`disconnect()` performs these steps in order:

1. Kill V2Ray process (if V2Ray) or remove WireGuard adapter (if WireGuard)
2. Clear system SOCKS proxy (if set)
3. Disable kill switch (if enabled)
4. End session on-chain (fire-and-forget -- does not block on TX confirmation)
5. Clear local state files

```js
await disconnect();
// Connection is now fully torn down.
// On-chain session end is fire-and-forget -- it may take a few seconds.
```

### Session Recovery

If a connection partially succeeds (payment TX broadcast but tunnel failed), the session exists on-chain and can be recovered without paying again. Use the SDK's `recoverSession`:

```js
import { recoverSession } from 'sentinel-dvpn-sdk';

try {
  const vpn = await connect({ mnemonic });
} catch (err) {
  if (err.code === 'PARTIAL_CONNECTION_FAILED' ||
      err.code === 'SESSION_EXISTS' ||
      err.code === 'SESSION_EXTRACT_FAILED') {
    // Session is on-chain. Recover it.
    const vpn = await recoverSession({
      mnemonic,
      nodeAddress: err.details.nodeAddress,
    });
  }
}
```

### Cleanup Handlers

The `sentinel-ai-connect` wrapper automatically registers cleanup handlers when you call `connect()`. If you use the underlying SDK directly, you must register them yourself:

```js
import { registerCleanupHandlers, connectAuto } from 'sentinel-dvpn-sdk';

// Register ONCE at app startup (before any connect call)
registerCleanupHandlers();

// Now connectAuto() will work
const vpn = await connectAuto({ mnemonic });
```

Alternatively, use the SDK's `quickConnect()` which auto-registers cleanup handlers:

```js
import { quickConnect } from 'sentinel-dvpn-sdk';

const vpn = await quickConnect({ mnemonic });
// cleanup handlers are registered automatically
```

When using `sentinel-ai-connect`'s `connect()`, this is handled for you automatically.

---

## 5. Error Handling

### Error Hierarchy

All SDK errors extend `SentinelError`:

```
SentinelError (base)
+-- ValidationError    Input validation failures
+-- NodeError          Node-level failures
+-- ChainError         Blockchain/transaction failures
+-- TunnelError        Tunnel setup failures
+-- SecurityError      Security-related failures
```

### Programmatic Error Handling

For advanced error handling, import typed errors from the underlying SDK:

```js
import { connect } from 'sentinel-ai-connect';
import {
  SentinelError,
  ValidationError,
  NodeError,
  ChainError,
  TunnelError,
  SecurityError,
  ErrorCodes,
  ERROR_SEVERITY,
  isRetryable,
  userMessage,
} from 'sentinel-dvpn-sdk';

try {
  await connect({ mnemonic });
} catch (err) {
  // Check error type
  if (err instanceof ValidationError) {
    // Bad input -- fix before retrying
    console.error(`Input error: ${err.code} -- ${err.message}`);
    return;
  }

  if (err instanceof SecurityError) {
    // Security issue -- do not retry automatically
    console.error(`Security alert: ${err.code}`);
    return;
  }

  // Check severity
  const severity = ERROR_SEVERITY[err.code];
  switch (severity) {
    case 'fatal':
      // Cannot proceed without fixing the root cause
      console.error(`Fatal: ${userMessage(err)}`);
      break;
    case 'retryable':
      // Try again, possibly with a different node
      console.log(`Retrying: ${userMessage(err)}`);
      await connect({ mnemonic, maxAttempts: 5 });
      break;
    case 'recoverable':
      // Session exists on-chain, recover it
      console.log(`Recovering: ${err.code}`);
      await recoverSession({ mnemonic });
      break;
    case 'infrastructure':
      // System dependency issue
      console.error(`System issue: ${userMessage(err)}`);
      break;
  }
}
```

### Complete Error Code Reference

#### Fatal Errors (Do Not Retry)

| Code | Class | Cause | Fix |
|---|---|---|---|
| `INVALID_MNEMONIC` | ValidationError | Mnemonic is not 12+ valid BIP39 words | Provide a valid BIP39 mnemonic |
| `INVALID_OPTIONS` | ValidationError | Missing or malformed connect options | Check required fields |
| `INVALID_NODE_ADDRESS` | ValidationError | Node address not in `sentnode1...` format | Use a valid node address |
| `INVALID_GIGABYTES` | ValidationError | Gigabytes not an integer 1-100 | Use integer 1-100 |
| `INVALID_URL` | ValidationError | Malformed URL provided | Check URL format |
| `INVALID_PLAN_ID` | ValidationError | Plan ID is not a valid number | Use a valid plan ID |
| `INSUFFICIENT_BALANCE` | ChainError | Wallet has < cost of session | Fund wallet with P2P tokens |
| `ALREADY_CONNECTED` | SentinelError | `connect()` called while already connected | Call `disconnect()` first |
| `SESSION_POISONED` | SentinelError | Session previously failed and was marked poisoned | Use `forceNewSession: true` |
| `ABORTED` | SentinelError | Connection cancelled via AbortController | Intentional cancellation |
| `UNKNOWN_MSG_TYPE` | ChainError | Protobuf message type not recognized | Update SDK version |
| `WG_NOT_AVAILABLE` | TunnelError | WireGuard not installed | Install WireGuard or use `serviceType: 'v2ray'` |

#### Retryable Errors (Try Again or Switch Nodes)

| Code | Class | Cause | Suggested Action |
|---|---|---|---|
| `NODE_OFFLINE` | NodeError | Node not responding to status query | Try different node |
| `NODE_NO_UDVPN` | NodeError | Node does not list udvpn in pricing | Try different node |
| `NODE_CLOCK_DRIFT` | NodeError | Node clock >120s off (VMess AEAD fails) | Try different node |
| `NODE_INACTIVE` | NodeError | Node status is inactive on-chain | Try different node |
| `NODE_NOT_FOUND` | NodeError | Node address not found on chain | Verify address, try different node |
| `NODE_DATABASE_CORRUPT` | NodeError | Node returned invalid data | Try different node |
| `V2RAY_ALL_FAILED` | TunnelError | Every V2Ray transport failed | Try different node or WireGuard |
| `WG_NO_CONNECTIVITY` | TunnelError | WireGuard adapter installed but no traffic | Try different node |
| `TUNNEL_SETUP_FAILED` | TunnelError | Generic tunnel failure | Retry or try different node |
| `BROADCAST_FAILED` | ChainError | TX broadcast rejected | Retry after delay (7s between TXs) |
| `TX_FAILED` | ChainError | TX included in block but failed | Check balance, retry |
| `LCD_ERROR` | ChainError | LCD endpoint query failed | Automatic failover handles this |
| `ALL_ENDPOINTS_FAILED` | ChainError | All LCD/RPC endpoints unreachable | Check internet, retry later |
| `ALL_NODES_FAILED` | SentinelError | Every candidate node failed | Relax filters, increase maxAttempts |
| `CHAIN_LAG` | ChainError | Session not yet confirmed on node | Wait 10-15s and retry |

#### Recoverable Errors (Session Exists On-Chain)

| Code | Class | Cause | Action |
|---|---|---|---|
| `SESSION_EXISTS` | SentinelError | Active session found for this wallet+node | Call `recoverSession()` |
| `SESSION_EXTRACT_FAILED` | ChainError | TX succeeded but session ID not extracted | Call `recoverSession()` |
| `PARTIAL_CONNECTION_FAILED` | SentinelError | Payment OK, tunnel failed | Call `recoverSession()` |

#### Infrastructure Errors (Check System)

| Code | Class | Cause | Action |
|---|---|---|---|
| `V2RAY_NOT_FOUND` | TunnelError | V2Ray binary missing | Run `npx sentinel-ai setup` |
| `TLS_CERT_CHANGED` | SecurityError | Node TLS cert differs from pinned cert | Investigate -- possible MITM |

### Error Details

Every error includes a `.details` object with structured context:

```js
catch (err) {
  console.log(err.code);       // 'NODE_OFFLINE'
  console.log(err.message);    // 'Node sentnode1abc... did not respond within 15s'
  console.log(err.details);    // { nodeAddress: 'sentnode1abc...', timeout: 15000 }
  console.log(err.name);       // 'NodeError'
}
```

---

## 6. Token Economics

### P2P Token Basics

| Property | Value |
|---|---|
| Display name | P2P |
| Chain denom | `udvpn` (micro-dvpn) |
| Conversion | 1 P2P = 1,000,000 udvpn |
| Blockchain | Cosmos (sentinelhub-2) |
| Gas price | 0.2 udvpn per gas unit |

### Session Pricing

Nodes set their own prices. Two pricing models:

| Model | How It Works | Typical Range |
|---|---|---|
| **Per-GB** | Pay upfront for N gigabytes. Session ends when data is consumed. | 5,000-50,000 udvpn/GB |
| **Per-Hour** | Pay upfront for N hours. Session ends when time expires. | 10,000-100,000 udvpn/hour |

### Cost Estimation

```js
import { listNodes, estimateSessionPrice, formatP2P } from 'sentinel-dvpn-sdk';

const nodes = await listNodes();
for (const node of nodes.slice(0, 5)) {
  const cost = estimateSessionPrice(node, { gigabytes: 1 });
  console.log(`${node.address}: ${formatP2P(cost)} per GB`);
}
```

### Transaction Costs

Every on-chain action costs gas:

| Operation | Approximate Gas | Approximate Cost |
|---|---|---|
| Start session | ~200,000 | ~40,000 udvpn (0.04 P2P) |
| End session | ~150,000 | ~30,000 udvpn (0.03 P2P) |
| Subscribe to plan | ~250,000 | ~50,000 udvpn (0.05 P2P) |

### Budget Planning for Agents

For an agent that connects 10 times per day, 1 GB per session:

```
Daily cost estimate:
  10 sessions x 50,000 udvpn/GB = 500,000 udvpn (bandwidth)
  10 start TXs x 40,000 udvpn   = 400,000 udvpn (gas)
  10 end TXs x 30,000 udvpn     = 300,000 udvpn (gas)
  ------------------------------------------------
  Total: ~1,200,000 udvpn/day (1.2 P2P)
```

### Auto-Funding Pattern

For fully autonomous agents, monitor balance and trigger swap when low:

```js
import { getBalance } from 'sentinel-ai-connect';

async function ensureFunded(mnemonic, minUdvpn = 500000) {
  const balance = await getBalance(mnemonic);

  if (balance.udvpn < minUdvpn) {
    // Trigger Osmosis swap or alert operator
    console.error(`Low balance: ${balance.udvpn} udvpn. Need ${minUdvpn}.`);
    console.error(`Fund address: ${balance.address}`);
    return false;
  }
  return true;
}
```

---

## 7. Security Considerations

### Mnemonic Security

The mnemonic is the master key to the wallet. Anyone with it can spend all funds.

```js
// CORRECT: Load from environment
const mnemonic = process.env.MNEMONIC;

// WRONG: Hardcoded in source
const mnemonic = 'word1 word2 word3 ...'; // NEVER DO THIS

// WRONG: Logged to console
console.log(`Using mnemonic: ${mnemonic}`); // NEVER DO THIS

// WRONG: Included in error report
throw new Error(`Failed with mnemonic ${mnemonic}`); // NEVER DO THIS
```

For autonomous agents, consider:

- Store mnemonic in a secrets manager (AWS Secrets Manager, HashiCorp Vault, etc.)
- Use a dedicated wallet with limited funds (not your main wallet)
- Monitor wallet balance and set alerts for unexpected withdrawals

### Key Zeroing

The SDK zeros private key material from memory after use:

```js
// Internal SDK behavior:
const privKey = await derivePrivateKey(mnemonic);
const signature = sign(privKey, data);
privKey.fill(0);  // Zero the key buffer
```

Do not cache raw private keys in your own code. Let the SDK manage key lifecycle.

### Tunnel Verification

After connecting, verify that traffic actually routes through the tunnel:

```js
import { connect } from 'sentinel-ai-connect';
import { verifyConnection } from 'sentinel-dvpn-sdk';

const vpn = await connect({ mnemonic });
const check = await verifyConnection({ timeoutMs: 8000 });

if (check.working) {
  console.log(`VPN IP: ${check.vpnIp}`);
} else {
  console.error('Traffic is NOT going through VPN!');
  await disconnect();
}
```

### DNS Leak Prevention

By default, the SDK uses Handshake DNS (103.196.38.38). This prevents DNS queries from leaking to your ISP.

```js
// Default: Handshake DNS (decentralized, no logging)
await connect({ mnemonic, dns: 'handshake' });

// Alternative: Google DNS
await connect({ mnemonic, dns: 'google' });

// Alternative: Cloudflare DNS
await connect({ mnemonic, dns: 'cloudflare' });
```

For maximum security, enable DNS leak prevention:

```js
import { enableDnsLeakPrevention, disableDnsLeakPrevention } from 'sentinel-dvpn-sdk';

enableDnsLeakPrevention();  // Forces ALL DNS through tunnel
// ... use VPN ...
disableDnsLeakPrevention(); // Restore default DNS
```

### Kill Switch

The kill switch blocks all non-tunnel traffic at the OS firewall level. If the VPN drops, no traffic leaks.

```js
await connect({
  mnemonic,
  killSwitch: true,  // Block all non-tunnel traffic
});
```

**Warning:** If the connection drops and the agent crashes, the kill switch persists. The system will have no internet until the kill switch is explicitly disabled or the firewall rules are manually removed.

### TOFU TLS (Trust On First Use)

The SDK pins the TLS certificate of each node on first connection. If the certificate changes on subsequent connections, it throws `TLS_CERT_CHANGED`. This detects man-in-the-middle attacks but also triggers on legitimate certificate rotations.

```js
import { clearKnownNode } from 'sentinel-dvpn-sdk';

try {
  await connect({ mnemonic, nodeAddress: 'sentnode1abc...' });
} catch (err) {
  if (err.code === 'TLS_CERT_CHANGED') {
    // Option 1: Alert and abort (safest)
    console.error('Possible MITM attack on node');

    // Option 2: Clear pinned cert and retry (if you trust the node)
    clearKnownNode('sentnode1abc...');
    await connect({ mnemonic, nodeAddress: 'sentnode1abc...' });
  }
}
```

---

## 8. Integration Patterns

### Pattern 1: Embedded Library

The simplest pattern. Import `sentinel-ai-connect` directly in your agent.

```js
import { connect, disconnect, isVpnActive } from 'sentinel-ai-connect';

class MyAgent {
  async doWorkWithPrivacy() {
    if (!isVpnActive()) {
      await connect({ mnemonic: process.env.MNEMONIC, country: 'Germany' });
    }

    // All HTTP requests now go through VPN
    const response = await fetch('https://target-api.example.com/data');
    const data = await response.json();

    await disconnect();
    return data;
  }
}
```

### Pattern 2: Long-Running Daemon

For agents that need persistent VPN access, combine the simple API with SDK-level features:

```js
import { connect, disconnect } from 'sentinel-ai-connect';
import {
  autoReconnect,
  registerCleanupHandlers,
  events,
} from 'sentinel-dvpn-sdk';

registerCleanupHandlers();

// Connect once
const vpn = await connect({
  mnemonic: process.env.MNEMONIC,
  onProgress: (step, detail) => console.log(`[vpn] [${step}] ${detail}`),
});

// Auto-reconnect on failure
const monitor = autoReconnect({
  mnemonic: process.env.MNEMONIC,
  pollIntervalMs: 10000,
  maxRetries: 10,
  backoffMs: [2000, 5000, 10000, 30000, 60000],
  onReconnecting: (n) => console.log(`[vpn] Reconnecting (attempt ${n})...`),
  onReconnected: (r) => console.log(`[vpn] Reconnected to ${r.nodeAddress}`),
  onGaveUp: () => {
    console.error('[vpn] All reconnect attempts failed');
    process.exit(1);
  },
});

// Listen for events
events.on('disconnected', ({ reason }) => {
  console.log(`[vpn] Disconnected: ${reason}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  monitor.stop();
  await disconnect();
  process.exit(0);
});
```

### Pattern 3: On-Demand VPN

Connect only when needed, disconnect when done. Minimizes cost.

```js
import { connect, disconnect, isVpnActive } from 'sentinel-ai-connect';

async function withVpn(country, fn) {
  let retries = 3;
  while (retries > 0) {
    try {
      const vpn = await connect({
        mnemonic: process.env.MNEMONIC,
        country,
      });

      try {
        return await fn(vpn);
      } finally {
        await disconnect();
      }
    } catch (err) {
      retries--;
      if (retries === 0) throw err;
      if (err.message.includes('insufficient')) throw err; // Don't retry balance errors
      console.log(`VPN connect failed, ${retries} retries left: ${err.message}`);
    }
  }
}

// Usage
const result = await withVpn('Germany', async (vpn) => {
  const res = await fetch('https://api.example.com/geo-restricted-data');
  return res.json();
});
```

### Pattern 4: Multi-Country Rotation

Connect to different countries sequentially for geo-distributed operations:

```js
import { connect, disconnect } from 'sentinel-ai-connect';

const countries = ['Germany', 'Japan', 'Brazil', 'Australia', 'South Africa'];

for (const country of countries) {
  await connect({
    mnemonic: process.env.MNEMONIC,
    country,
    onProgress: (step, detail) => console.log(`[${country}] [${step}] ${detail}`),
  });

  // Do work from this country's IP
  const res = await fetch('https://api.example.com/local-data');
  console.log(`${country}: ${res.status}`);

  await disconnect();

  // Wait between sessions to avoid chain rate limits
  await new Promise(r => setTimeout(r, 7000));
}
```

### Pattern 5: SOCKS5 Proxy (V2Ray)

V2Ray creates a local SOCKS5 proxy. Route specific traffic through it:

```js
import { connect, disconnect } from 'sentinel-ai-connect';
import { SocksProxyAgent } from 'socks-proxy-agent';
import axios from 'axios';

const vpn = await connect({
  mnemonic: process.env.MNEMONIC,
  serviceType: 'v2ray',
});

// Create agent for the SOCKS5 proxy
const agent = new SocksProxyAgent(`socks5://127.0.0.1:${vpn.socksPort}`);

// Route specific requests through VPN
const vpnResponse = await axios.get('https://api.ipify.org', {
  httpAgent: agent,
  httpsAgent: agent,
});
console.log(`VPN IP: ${vpnResponse.data}`);

// Direct request (not through VPN)
const directResponse = await axios.get('https://api.ipify.org');
console.log(`Direct IP: ${directResponse.data}`);

await disconnect();
```

**Important:** Node.js native `fetch()` silently ignores SOCKS5 proxy configuration. Use `axios` with an explicit agent, not `fetch()`.

---

## 9. Autonomous Agent Pattern

A complete pattern for a fully autonomous AI agent that manages its own VPN lifecycle, monitors balance, and handles all error cases.

```js
import { connect, disconnect, isVpnActive, createWallet, getBalance } from 'sentinel-ai-connect';
import {
  autoReconnect,
  registerCleanupHandlers,
  createClient,
  verifyConnection,
  events,
  ErrorCodes,
  isRetryable,
} from 'sentinel-dvpn-sdk';

class AutonomousVpnAgent {
  constructor(mnemonic, opts = {}) {
    this.mnemonic = mnemonic;
    this.minBalance = opts.minBalance || 500000; // 0.5 P2P
    this.preferredCountry = opts.country || null;
    this.monitor = null;
    this.running = false;

    registerCleanupHandlers();
  }

  // ── Lifecycle ───────────────────────────────────────

  async start() {
    this.running = true;

    // Check balance before connecting
    const funded = await this.checkBalance();
    if (!funded) {
      throw new Error(`Insufficient balance. Need ${this.minBalance} udvpn minimum.`);
    }

    // Connect with retry
    await this.connectWithRetry(3);

    // Start auto-reconnect monitor
    this.monitor = autoReconnect({
      mnemonic: this.mnemonic,
      pollIntervalMs: 10000,
      maxRetries: 10,
      backoffMs: [2000, 5000, 10000, 30000, 60000],
      onReconnecting: (n) => this.log(`Reconnecting (attempt ${n})...`),
      onReconnected: (result) => this.log(`Reconnected via ${result.nodeAddress}`),
      onGaveUp: () => {
        this.log('Auto-reconnect exhausted. Attempting full restart...');
        this.restart();
      },
    });

    // Periodic balance check
    this.balanceTimer = setInterval(() => this.checkBalance(), 300000); // Every 5 min

    this.log('Agent started. VPN active.');
  }

  async stop() {
    this.running = false;
    if (this.monitor) this.monitor.stop();
    if (this.balanceTimer) clearInterval(this.balanceTimer);
    if (isVpnActive()) await disconnect();
    this.log('Agent stopped.');
  }

  async restart() {
    if (!this.running) return;
    try {
      if (isVpnActive()) await disconnect();
    } catch {}
    // Wait before reconnecting
    await new Promise(r => setTimeout(r, 10000));
    if (this.running) await this.start();
  }

  // ── Connection ──────────────────────────────────────

  async connectWithRetry(maxRetries) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const vpn = await connect({
          mnemonic: this.mnemonic,
          country: this.preferredCountry,
          maxAttempts: 5,
          onProgress: (step, detail) => this.log(`[${step}] ${detail}`),
        });

        // Verify tunnel works
        const check = await verifyConnection({ timeoutMs: 8000 });
        if (check.working) {
          this.log(`Connected. VPN IP: ${check.vpnIp}`);
          return vpn;
        }

        this.log('Tunnel verification failed. Disconnecting and retrying...');
        await disconnect();
      } catch (err) {
        this.log(`Connect attempt ${i + 1}/${maxRetries} failed: ${err.code} -- ${err.message}`);

        if (err.code === ErrorCodes.INSUFFICIENT_BALANCE) {
          throw err; // Cannot recover without funding
        }

        if (i < maxRetries - 1) {
          const delay = Math.min(5000 * (i + 1), 30000);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    throw new Error(`Failed to connect after ${maxRetries} attempts`);
  }

  // ── Balance Monitoring ──────────────────────────────

  async checkBalance() {
    try {
      const balance = await getBalance(this.mnemonic);

      this.log(`Balance: ${balance.p2p} (${balance.udvpn} udvpn)`);

      if (balance.udvpn < this.minBalance) {
        this.log(`WARNING: Balance below minimum (${this.minBalance} udvpn). Fund wallet.`);
        // Here you could: trigger Osmosis swap, send alert, call webhook, etc.
        return false;
      }
      return true;
    } catch (err) {
      this.log(`Balance check failed: ${err.message}`);
      return true; // Assume funded on query failure
    }
  }

  // ── Logging ─────────────────────────────────────────

  log(msg) {
    const ts = new Date().toISOString();
    console.log(`[${ts}] [vpn-agent] ${msg}`);
  }
}

// ── Usage ────────────────────────────────────────────

const agent = new AutonomousVpnAgent(process.env.MNEMONIC, {
  country: 'Germany',
  minBalance: 1000000, // 1 P2P
});

await agent.start();

// Agent is now running with auto-reconnect and balance monitoring.
// Stop when done:
// await agent.stop();
```

### Key Design Decisions for Autonomous Agents

| Decision | Recommendation | Reason |
|---|---|---|
| **Pricing model** | Per-GB (not per-hour) | Agents may be idle between tasks. Per-hour drains balance on timer. |
| **Node selection** | Auto (not specific node) | Specific nodes go offline. Auto-select falls back to alternatives. |
| **Kill switch** | Off for agents | If kill switch persists after crash, agent loses all connectivity. |
| **Cleanup handlers** | Always register | Prevents orphaned tunnels that kill system internet. |
| **Balance monitoring** | Check every 5 minutes | Catch low balance before a connection attempt fails. |
| **Error recovery** | Use `recoverSession()` for recoverable errors | Avoids paying twice for the same session. |
| **TX timing** | Wait 7s between transactions | Chain rate limits cause failures with rapid TX. |

---

## 10. Troubleshooting

### Common Issues

#### "V2Ray binary not found"

```bash
npx sentinel-ai setup
```

The setup script downloads V2Ray 5.2.1 to the `bin/` directory. If running in CI or a restricted environment, download manually and set `v2rayExePath`:

```js
await connect({ mnemonic, v2rayExePath: '/path/to/v2ray' });
```

#### "All V2Ray transport combinations failed"

The node may be overloaded or have misconfigured transports. Solutions:

1. Try a different node: `await connect({ mnemonic })` (auto-selects)
2. Try WireGuard: `await connect({ mnemonic, serviceType: 'wireguard' })`
3. Check if the node has peers > 0 (if yes, the transport works -- the issue is on our side)

#### "WireGuard not available"

WireGuard requires admin/root. Either:

1. Run with admin privileges
2. Use V2Ray only: `await connect({ mnemonic, serviceType: 'v2ray' })`

#### "Insufficient balance"

Fund the wallet with P2P tokens. Check current balance:

```js
import { getBalance } from 'sentinel-ai-connect';

const balance = await getBalance(mnemonic);
console.log(`${balance.p2p} — funded: ${balance.funded}`);
console.log(`Send P2P tokens to: ${balance.address}`);
```

#### "Already connected"

Call `disconnect()` before connecting again:

```js
import { disconnect, isVpnActive, connect } from 'sentinel-ai-connect';

if (isVpnActive()) {
  await disconnect();
}
await connect({ mnemonic });
```

#### "Connection was cancelled"

An `AbortController` signal was triggered. This is intentional -- the agent or user cancelled.

#### Native `fetch()` does not use SOCKS5 proxy

Node.js native `fetch()` ignores SOCKS5 proxy settings. Use `axios` with `socks-proxy-agent`:

```js
import { SocksProxyAgent } from 'socks-proxy-agent';
import axios from 'axios';

const agent = new SocksProxyAgent(`socks5://127.0.0.1:${vpn.socksPort}`);
const res = await axios.get(url, { httpAgent: agent, httpsAgent: agent });
```

#### Connection succeeds but IP does not change (V2Ray)

V2Ray creates a SOCKS5 proxy, not a system-wide tunnel. Either:

1. Set `systemProxy: true` (default) to auto-configure Windows system proxy
2. Explicitly route HTTP requests through the SOCKS5 proxy with `socks-proxy-agent`
3. Use WireGuard (`serviceType: 'wireguard'`) for true system-wide IP change

### Chain-Specific Timing

| Constraint | Value | Reason |
|---|---|---|
| Minimum between TXs | 7 seconds | Sequence number conflicts |
| Session confirmation delay | 5-15 seconds | Block time + node sync |
| LCD query timeout | 15 seconds | Large response payloads |
| Handshake timeout | 30 seconds | Node may be slow to respond |
| V2Ray startup timeout | 15 seconds | Binary load + transport negotiation |
| WireGuard peer registration | 1-5 seconds | Node registers the peer key |

---

## 11. Protocol Details

### V3 Handshake

The handshake is the cryptographic exchange between agent and node after session creation.

**Signature format:**

```
message = BigEndian_uint64(sessionId) + raw_peer_data_json_bytes
signature = ECDSA_sign(SHA256(message), private_key)
```

**Critical:** Sign the raw bytes, not base64-encoded bytes. This is a common implementation mistake.

**WireGuard handshake payload:**

```json
{
  "session_id": "37595661",
  "public_key": "<X25519 public key, base64>",
  "nonce": "<random nonce>"
}
```

**V2Ray handshake payload:**

```json
{
  "session_id": "37595661",
  "uuid": "<generated UUID>",
  "nonce": "<random nonce>"
}
```

### Chain Query Paths (V3)

All Sentinel-specific queries use V3 paths. V2 paths return "Not Implemented" except provider (still V2).

| Query | LCD Path |
|---|---|
| Online nodes | `/sentinel/node/v3/nodes?status=1&pagination.limit=5000` |
| Single node | `/sentinel/node/v3/nodes/{sentnode1...}` |
| Account sessions | `/sentinel/session/v3/accounts/{sent1...}/sessions` |
| Account subscriptions | `/sentinel/subscription/v3/accounts/{sent1...}/subscriptions` |
| Session allocations | `/sentinel/session/v3/sessions/{id}/allocations` |
| Plan by ID | `/sentinel/plan/v3/plans/{id}` |
| Plan nodes | `/sentinel/node/v3/plans/{id}/nodes` |
| Provider (V2!) | `/sentinel/provider/v2/providers/{sentprov1...}` |
| Balance | `/cosmos/bank/v1beta1/balances/{sent1...}` |

### V3 Field Name Changes

If you interact with the chain directly, note these V3 field name changes:

| V3 (Current) | V2 (Deprecated) |
|---|---|
| `service_type` | `type` |
| `remote_addrs` (array) | `remote_url` (string) |
| `acc_address` | `address` |
| Session wrapped in `base_session` | Flat fields |
| `status=1` (active) | `status=STATUS_ACTIVE` |

### Transport Types (V2Ray)

V2Ray nodes advertise one or more transports. The SDK tries each in order of reliability:

| Code | Transport | Reliability | Notes |
|---|---|---|---|
| 7 | TCP | ~70% | Most common, generally reliable |
| 8 | WebSocket | ~65% | Good for censored networks |
| 3 | gRPC | ~58% | Without TLS only; gRPC+TLS = 0% |
| 2 | gun | ~40% | Raw H2 stream (different from gRPC) |
| 4 | HTTP | ~30% | HTTP/1.1 transport |
| 5 | mKCP | ~20% | UDP-based, unreliable in practice |
| 6 | QUIC | ~15% | UDP, often blocked |
| 1 | DomainSocket | 0% | Unix sockets, not usable remotely |

**Important:** Transport codes 2 (gun) and 3 (gRPC) are different protocols. Gun is raw HTTP/2, gRPC uses the gRPC library. Do not treat them as equivalent.

---

*Built for the machines that will inherit the open internet.*
