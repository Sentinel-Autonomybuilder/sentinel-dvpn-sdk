# Sentinel dVPN SDK Examples

Runnable examples showing how to use the SDK. Each file is self-contained.

## Prerequisites

- Node.js 18+
- `npm install sentinel-dvpn-sdk`
- For wallet/connection examples: set `MNEMONIC` environment variable (12 or 24-word BIP39 phrase)
- For WireGuard nodes: run as admin/root. Without admin, only V2Ray nodes are available (~70% of the network).

## Examples

| File | Description | Needs Wallet? |
|------|-------------|:---:|
| `connect-direct.mjs` | Complete VPN flow: wallet, balance, find nodes, connect, verify IP, disconnect | Yes |
| `query-nodes.mjs` | Browse nodes, filter by country/protocol/price, display table | No |
| `wallet-basics.mjs` | Generate a new wallet or import existing, check balance | Optional |
| `connect-plan.mjs` | Connect via a subscription plan (operator-managed node bundles) | Yes |
| `error-handling.mjs` | Typed error codes, severity levels, retry logic patterns | Yes |

## Quick Start

```bash
# Browse the network (no wallet needed)
node query-nodes.mjs
node query-nodes.mjs --country germany --protocol wireguard

# Generate a new wallet
node wallet-basics.mjs

# Check balance of an existing wallet
MNEMONIC="your twelve word phrase here ..." node wallet-basics.mjs

# Connect to VPN (simplest)
MNEMONIC="your twelve word phrase here ..." node connect-direct.mjs

# Connect to a specific country
MNEMONIC="your twelve word phrase here ..." node connect-direct.mjs --country finland

# Connect via a plan
MNEMONIC="your twelve word phrase here ..." node connect-plan.mjs --plan-id 42

# Explore error handling
MNEMONIC="your twelve word phrase here ..." node error-handling.mjs
```

## Token Info

- Display name: **P2P**
- Chain denom: `udvpn` (micro denomination)
- 1 P2P = 1,000,000 udvpn
- Typical session cost: ~0.04-0.15 P2P per GB
- Minimum recommended balance: 1 P2P

## Key Concepts

**connectAuto vs connectDirect**: `connectAuto` scans nodes, filters, retries on failure. `connectDirect` connects to one specific node address. Start with `connectAuto`.

**WireGuard vs V2Ray**: WireGuard is faster but requires admin. V2Ray works without admin and supports more transport types. The SDK picks the best available.

**Plans vs Direct**: Direct connections pay per GB/hour to individual nodes. Plans are operator bundles with fixed pricing and optional fee grants (operator pays gas for subscribers).

**Error severity**: `fatal` = user must fix, `retryable` = try another node, `recoverable` = call `recoverSession()`, `infrastructure` = check system setup.
