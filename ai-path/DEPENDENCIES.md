# Sentinel SDK Dependencies

> Complete dependency reference for the Sentinel dVPN SDK.
> Every dependency listed with: what it is, why it's needed, exact version, what breaks if wrong, how to install, how to verify.

---

## Runtime Environment

### Node.js

| Property | Value |
|----------|-------|
| **What** | JavaScript runtime |
| **Why** | The JS SDK is ES Module-based; requires Node.js 20+ for native fetch, AbortController, and stable ES module support |
| **Exact version** | `>=20.0.0` (specified in `package.json` `engines`) |
| **What breaks if wrong** | Node 18: `fetch` adapter issues with axios on self-signed certs. Node 16: no top-level await, no AbortController, ES module bugs. |
| **Install** | https://nodejs.org/ -- download LTS (20.x or 22.x) |
| **Verify** | `node --version` -- must show v20.x.x or higher |

### .NET 8.0 SDK (C# only)

| Property | Value |
|----------|-------|
| **What** | .NET runtime and build tools |
| **Why** | The C# SDK targets .NET 8.0 for WPF desktop apps |
| **Exact version** | .NET 8.0 SDK |
| **What breaks if wrong** | .NET 6/7: Missing APIs used by the SDK. .NET 9: untested, may have breaking changes. |
| **Install** | https://dotnet.microsoft.com/download/dotnet/8.0 |
| **Verify** | `dotnet --version` -- must show 8.0.x |

---

## npm Packages (JS SDK)

### @cosmjs/stargate

| Property | Value |
|----------|-------|
| **What** | Cosmos SDK client library for signing and broadcasting transactions |
| **Why** | Core chain interaction: wallet creation, message signing, transaction broadcast, RPC queries |
| **Exact version** | `^0.32.2` |
| **What breaks if wrong** | 0.31.x: Different `SigningStargateClient` API, missing gas estimation features. 0.33+: untested, may have breaking changes to registry or signing. |
| **Install** | `npm install @cosmjs/stargate@^0.32.2` |
| **Verify** | `node -e "import('@cosmjs/stargate').then(m => console.log('OK:', Object.keys(m).length, 'exports'))"` |

### @cosmjs/amino

| Property | Value |
|----------|-------|
| **What** | Cosmos Amino encoding for legacy message signing |
| **Why** | Some Sentinel message types use Amino encoding; required by `@cosmjs/stargate` |
| **Exact version** | `^0.32.2` (must match stargate version) |
| **What breaks if wrong** | Version mismatch with stargate causes cryptic encoding errors on TX broadcast |
| **Install** | `npm install @cosmjs/amino@^0.32.2` |
| **Verify** | Installed automatically with stargate; verify same version in `package-lock.json` |

### @cosmjs/crypto

| Property | Value |
|----------|-------|
| **What** | Cryptographic primitives (SHA256, secp256k1, Ripemd160) |
| **Why** | Wallet key derivation (BIP39/BIP44), handshake signature (secp256k1 sign of session ID), address generation |
| **Exact version** | `^0.32.2` (must match stargate version) |
| **What breaks if wrong** | Signature format changes break handshake; key derivation changes break wallet address |
| **Install** | `npm install @cosmjs/crypto@^0.32.2` |
| **Verify** | `node -e "import('@cosmjs/crypto').then(m => console.log('Secp256k1:', typeof m.Secp256k1))"` |

### @cosmjs/encoding

| Property | Value |
|----------|-------|
| **What** | Encoding utilities (Bech32, Base64, hex) |
| **Why** | Bech32 address encoding (`sent1...`, `sentnode1...`), Base64 for handshake signatures and keys |
| **Exact version** | `^0.32.2` (must match stargate version) |
| **What breaks if wrong** | Address encoding changes break all chain queries |
| **Install** | `npm install @cosmjs/encoding@^0.32.2` |
| **Verify** | `node -e "import('@cosmjs/encoding').then(m => console.log('Bech32:', typeof m.Bech32))"` |

### @cosmjs/proto-signing

| Property | Value |
|----------|-------|
| **What** | Protobuf message signing and registry |
| **Why** | Registering Sentinel-specific message types (MsgStartSession, MsgEndSession, etc.) in the CosmJS Registry |
| **Exact version** | `^0.32.2` (must match stargate version) |
| **What breaks if wrong** | Unregistered message types silently fail on broadcast; sessions never start or end |
| **Install** | `npm install @cosmjs/proto-signing@^0.32.2` |
| **Verify** | `node -e "import('@cosmjs/proto-signing').then(m => console.log('Registry:', typeof m.Registry))"` |

**CRITICAL:** All 5 `@cosmjs/*` packages must be the SAME version. Mixed versions cause encoding mismatches and cryptic failures.

### @noble/curves

| Property | Value |
|----------|-------|
| **What** | Elliptic curve cryptography (secp256k1, x25519) |
| **Why** | X25519 key generation for WireGuard handshake; secp256k1 for handshake signature computation |
| **Exact version** | `^2.0.1` |
| **What breaks if wrong** | 1.x: Different API (no `x25519.utils`). Key generation fails silently or produces wrong keys. |
| **Install** | `npm install @noble/curves@^2.0.1` |
| **Verify** | `node -e "import('@noble/curves/ed25519').then(m => console.log('x25519:', typeof m.x25519))"` |

### axios

| Property | Value |
|----------|-------|
| **What** | HTTP client library |
| **Why** | All HTTP requests to Sentinel nodes (handshake, status), LCD queries, speed tests. SOCKS5 proxy support via agents. |
| **Exact version** | `^1.6.8` |
| **What breaks if wrong** | <1.0: Missing `adapter` config. Node.js 18+ uses fetch adapter by default; self-signed certs fail without `adapter: 'http'`. |
| **Install** | `npm install axios@^1.6.8` |
| **Verify** | `node -e "import('axios').then(m => console.log('axios:', m.default.VERSION))"` |

**CRITICAL:** Must set `axios.defaults.adapter = 'http'` at startup. Node.js 18+ defaults to `fetch` adapter which cannot handle self-signed certificates used by Sentinel nodes. Without this, every node HTTPS request fails with opaque "fetch failed" error.

### dotenv

| Property | Value |
|----------|-------|
| **What** | Environment variable loader from `.env` files |
| **Why** | Loading mnemonic, RPC/LCD URLs, and configuration from `.env` without hardcoding secrets |
| **Exact version** | `^16.6.1` |
| **What breaks if wrong** | Older versions: Missing `dotenv/config` import path. Not critical -- any v16+ works. |
| **Install** | `npm install dotenv@^16.6.1` |
| **Verify** | Create `.env` with `TEST=hello`, run `node -e "import('dotenv/config'); console.log(process.env.TEST)"` |

### socks-proxy-agent

| Property | Value |
|----------|-------|
| **What** | SOCKS5 proxy agent for HTTP clients |
| **Why** | Speed testing through V2Ray SOCKS5 tunnel; verifying tunnel connectivity |
| **Exact version** | `^8.0.4` |
| **What breaks if wrong** | <8.0: Different API; `new SocksProxyAgent()` constructor changes. Native `fetch` silently ignores this agent -- must use axios. |
| **Install** | `npm install socks-proxy-agent@^8.0.4` |
| **Verify** | `node -e "import('socks-proxy-agent').then(m => console.log('SocksProxyAgent:', typeof m.SocksProxyAgent))"` |

**CRITICAL:** JavaScript native `fetch()` silently ignores SOCKS proxy agents. All SOCKS5 speed tests MUST use axios with `adapter: 'http'`. Using `fetch` through a SOCKS5 proxy appears to work but bypasses the proxy entirely.

---

## External Binaries

### WireGuard

| Property | Value |
|----------|-------|
| **What** | VPN tunnel implementation using Noise protocol |
| **Why** | Primary tunnel type for Sentinel dVPN; ~380 nodes are WireGuard, 100% success rate when reachable |
| **Exact version** | Any recent version; tested with v0.5.3 (Windows Dec 2021) |
| **What breaks if wrong** | WireGuard is backwards-compatible; version rarely matters. The SDK uses `/installtunnelservice` and `/uninstalltunnelservice` CLI commands which are stable. |
| **Install (Windows)** | Download from https://www.wireguard.com/install/ -- MSI installer |
| **Install (macOS)** | `brew install wireguard-tools` or App Store |
| **Install (Linux)** | `sudo apt install wireguard-tools` or `yum install wireguard-tools` |
| **Verify** | `"C:\Program Files\WireGuard\wireguard.exe" /help` (Windows) or `wg --version` (macOS/Linux) |
| **Default path (Windows)** | `C:\Program Files\WireGuard\wireguard.exe` |
| **Default path (macOS/Linux)** | `/usr/bin/wg-quick` or `/usr/local/bin/wg-quick` |

**CRITICAL REQUIREMENTS:**
- **Windows: Administrator privileges REQUIRED.** WireGuard installs a Windows service (`WireGuardTunnel$wgsent0`) which requires SYSTEM-level access. Without admin, tunnel install silently fails. Check admin BEFORE paying for a session.
- **Never call `/installmanagerservice`** -- this launches the WireGuard GUI and takes over all tunnel management. Only use `/installtunnelservice` and `/uninstalltunnelservice`.
- **Use `execFileSync`, never `execSync` with string interpolation** -- prevents command injection and Git Bash path mangling.
- **Config file must remain on disk while service exists** -- the Windows service reads `wgsent0.conf` at startup; deleting it causes "file not found" crash.

### V2Ray

| Property | Value |
|----------|-------|
| **What** | Multi-protocol proxy platform (VMess, VLess, gRPC, WebSocket, etc.) |
| **Why** | Secondary tunnel type for Sentinel dVPN; ~407 nodes are V2Ray. Supports multiple transport protocols. |
| **Exact version** | **v5.2.1 ONLY** |
| **What breaks if wrong** | v5.44.1+: Observatory module has bugs that mark working outbounds as dead; connection success rate drops drastically. v4.x: Different config format entirely. v5.3-5.43: untested, may or may not work. **The SDK will silently use a wrong version if it finds one on PATH.** |
| **Install** | SDK's `setup.js` auto-downloads v5.2.1 to `~/.sentinel-sdk/bin/v2ray.exe`. Run `npm run setup` or `node setup.js`. |
| **Verify** | `~/.sentinel-sdk/bin/v2ray.exe version` -- must show `V2Ray 5.2.1` |
| **Binary location** | `~/.sentinel-sdk/bin/v2ray.exe` (Windows), `~/.sentinel-sdk/bin/v2ray` (macOS/Linux) |

**CRITICAL REQUIREMENTS:**
- **Exactly v5.2.1.** No newer, no older. The observatory module in 5.44.1+ has confirmed bugs.
- **Do not rely on system-wide V2Ray.** The SDK should use its own copy at `~/.sentinel-sdk/bin/`.
- **Two companion data files required:** `geoip.dat` and `geosite.dat` must be in the same directory as the binary.
- **SOCKS5 inbound configuration:** When using `systemProxy: true`, SOCKS5 auth must be set to `noauth` because Windows system proxy cannot pass credentials.
- **Port selection:** Use `10800 + Math.floor(Math.random() * 1000)` for SOCKS5 port. Increment for fallback outbounds to avoid TIME_WAIT conflicts.

### GeoIP and GeoSite Data

| Property | Value |
|----------|-------|
| **What** | IP geolocation and domain categorization databases for V2Ray routing |
| **Why** | V2Ray uses these for routing decisions; required at startup |
| **Exact version** | Any recent version; bundled with V2Ray download |
| **What breaks if wrong** | V2Ray fails to start with "geoip.dat not found" error |
| **Install** | Automatically downloaded by `setup.js` alongside V2Ray binary |
| **Verify** | Check files exist in V2Ray binary directory |

---

## OS Requirements

### Windows

| Requirement | Details |
|-------------|---------|
| **Windows 10/11** | WireGuard requires Windows 10 1607+ for Wintun driver support |
| **Administrator privileges** | Required for WireGuard service install, kill switch firewall rules, DNS leak prevention |
| **PowerShell** | Required for VPN conflict detection, adapter cleanup, diagnostic commands |
| **Windows Firewall** | Must be running for kill switch functionality (`netsh advfirewall`) |
| **.NET 8.0 Runtime** | Required for C# SDK only; installed with SDK or separately |

### macOS

| Requirement | Details |
|-------------|---------|
| **macOS 12+** | Required for modern WireGuard kernel extension support |
| **Root access** | Required for `wg-quick up/down` and `networksetup` proxy configuration |
| **wireguard-tools** | Install via `brew install wireguard-tools` |

### Linux

| Requirement | Details |
|-------------|---------|
| **Kernel 5.6+** | WireGuard built into kernel since 5.6; older kernels need `wireguard-dkms` |
| **Root access** | Required for `wg-quick` and `gsettings` proxy configuration |
| **wireguard-tools** | Install via package manager |

---

## Sentinel Chain Infrastructure

### LCD (Light Client Daemon) Endpoints

| Property | Value |
|----------|-------|
| **What** | REST API for querying chain state (nodes, subscriptions, sessions, balances) |
| **Why** | All chain queries: node discovery, subscription lookup, session status, balance check |
| **Primary** | `https://lcd.sentinel.co` |
| **Failover 1** | `https://api.sentinel.quokkastake.io` |
| **Failover 2** | `https://sentinel-api.polkachu.com` |
| **Failover 3** | `https://sentinel.api.trivium.network:1317` |
| **What breaks** | All LCD endpoints down = no node queries, no subscriptions, no chain interaction |
| **Verify** | `curl https://lcd.sentinel.co/sentinel/node/v3/nodes?status=1&pagination.limit=1` |

**CRITICAL:** All paths must use v3 format EXCEPT provider which is v2:
- Nodes: `/sentinel/node/v3/nodes?status=1`
- Sessions: `/sentinel/session/v3/accounts/{addr}/sessions`
- Subscriptions: `/sentinel/subscription/v3/accounts/{addr}/subscriptions`
- Plans: `/sentinel/node/v3/plans/{id}/nodes`
- Provider: `/sentinel/provider/v2/providers/{addr}` (v2 only!)

### RPC Endpoints

| Property | Value |
|----------|-------|
| **What** | Tendermint RPC for transaction broadcast and block queries |
| **Why** | Signing and broadcasting transactions (session creation, subscription, etc.) |
| **Primary** | `https://rpc.sentinel.co` |
| **Failover 1** | `https://rpc.sentinel.quokkastake.io` |
| **Failover 2** | `https://sentinel-rpc.polkachu.com` |
| **What breaks** | All RPC endpoints down = no transactions, no connections |
| **Verify** | `curl https://rpc.sentinel.co/status` |

### Chain Parameters

| Parameter | Value |
|-----------|-------|
| **Chain ID** | `sentinelhub-2` |
| **Denom** | `udvpn` (micro-DVPN; 1 P2P = 1,000,000 udvpn) |
| **Display token** | P2P (not DVPN, not dvpn) |
| **Gas price** | `0.2udvpn` |
| **Address prefix** | `sent1...` (wallet), `sentnode1...` (node), `sentprov1...` (provider) |
| **Key algorithm** | secp256k1 (same as Cosmos Hub, Ethereum) |
| **HD path** | `m/44'/118'/0'/0/0` (Cosmos standard) |

---

## Protocol Specifications

### V3 Handshake

| Property | Value |
|----------|-------|
| **Method** | `POST /` to node's remote URL |
| **Content-Type** | `application/json` |
| **TLS** | Self-signed certificates; use TOFU model |
| **Timeout** | 90 seconds (increased from 30s through testing) |

**Request body:**
```json
{
  "session_id": 12345678,
  "key": "<base64-encoded-key>",
  "signature": "<base64-encoded-signature>"
}
```

**Signature computation:**
1. Convert session_id to 8-byte big-endian uint64
2. Sign raw bytes with secp256k1 private key (same key that created session)
3. Base64-encode the signature

**Key field:**
- WireGuard: X25519 public key (32 bytes, base64)
- V2Ray: UUID as 16-byte array (base64)

### V2Ray Transport Map

| Sentinel Enum | Transport | V2Ray Network | Success Rate |
|---------------|-----------|---------------|-------------|
| 1 | domainsocket | N/A (unusable remotely) | 0% |
| 2 | gun | `grpc` | 100% (same config as grpc) |
| 3 | grpc | `grpc` | 87% (none), 0% (tls) |
| 4 | http | `http` | 100% |
| 5 | mkcp | `kcp` | 100% |
| 6 | quic | `quic` | 0% (with 5.2.1 fix: untested post-fix) |
| 7 | tcp | `tcp` | 100% |
| 8 | websocket | `ws` | 100% |

### V2Ray Proxy Protocol Map

| Sentinel Enum | Protocol | V2Ray Protocol |
|---------------|----------|---------------|
| 1 | VLess | `vless` (encryption=none, NO flow) |
| 2 | VMess | `vmess` (alterId=0, NO security in user) |

### WireGuard Config Template

```ini
[Interface]
PrivateKey = <client-x25519-private-key>
Address = <assigned-address-from-handshake>/32
MTU = 1280
DNS = 10.8.0.1

[Peer]
PublicKey = <server-public-key-from-handshake>
Endpoint = <server-endpoint-from-handshake>
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 15
```

**Non-negotiable values:**
- MTU = 1280 (NOT 1420)
- DNS = 10.8.0.1 (NOT external DNS)
- PersistentKeepalive = 15 (NOT 30)

---

## NuGet Packages (C# SDK)

### CosmosSharp / Cosmos SDK bindings

| Property | Value |
|----------|-------|
| **What** | Cosmos chain interaction for .NET |
| **Why** | Transaction signing, broadcasting, and chain queries in C# |
| **Note** | The C# SDK has its own `TransactionBuilder` and `ChainClient` that use raw HTTP -- not a third-party Cosmos SDK package |

### System.Security.Cryptography

| Property | Value |
|----------|-------|
| **What** | .NET built-in cryptography |
| **Why** | secp256k1 signing, SHA256, X25519 key generation |
| **Note** | Built into .NET 8.0; no separate package needed |

### System.Text.Json

| Property | Value |
|----------|-------|
| **What** | .NET built-in JSON serializer |
| **Why** | Parsing LCD responses, handshake payloads, config files |
| **CRITICAL** | String-number round-trip bug: `"5500000"` (string) serializes as `5500000` (number), deserializes back as `null`. Test all data models with round-trip serialization. |

---

## Development Dependencies

### For testing the SDK itself

| Tool | Purpose | Version |
|------|---------|---------|
| `node test/smoke.js` | SDK smoke tests (661 assertions) | Built-in |
| Live Sentinel mainnet | Integration testing | N/A |
| Funded wallet | Real chain transactions | Need `udvpn` tokens |

### For building consumer apps

| Tool | Purpose | Notes |
|------|---------|-------|
| `npm` or `yarn` | Package management | npm 10+ recommended |
| Git | Version control | Any recent version |
| VS Code / IDE | Development | Recommended: ESLint with single-quote, semicolons |

---

## Version Compatibility Matrix

| Component | Minimum | Recommended | Maximum Tested |
|-----------|---------|-------------|---------------|
| Node.js | 20.0.0 | 22.x LTS | 22.x |
| .NET SDK | 8.0.0 | 8.0.x latest | 8.0.x |
| @cosmjs/* | 0.32.2 | 0.32.4 | 0.32.x |
| @noble/curves | 2.0.1 | 2.x latest | 2.x |
| axios | 1.6.8 | 1.7.x | 1.x |
| V2Ray | 5.2.1 | **5.2.1 only** | 5.2.1 |
| WireGuard | 0.5.3 | Latest | Latest |
| Windows | 10 1607 | 11 | 11 |
| macOS | 12 | 14+ | 15 |
| Linux kernel | 5.6 | 6.x | 6.x |

---

## Dependency Installation Checklist

For a fresh development machine:

```bash
# 1. Install Node.js 22 LTS
# Download from https://nodejs.org/

# 2. Install WireGuard
# Windows: https://www.wireguard.com/install/ (MSI)
# macOS: brew install wireguard-tools
# Linux: sudo apt install wireguard-tools

# 3. Clone/create project and install SDK
npm init -y
npm install sentinel-dvpn-sdk

# 4. Download V2Ray 5.2.1 (automatic)
npx sentinel-setup
# OR: node node_modules/sentinel-dvpn-sdk/setup.js

# 5. Create .env file
echo "MNEMONIC=your twelve word mnemonic phrase goes here" > .env

# 6. Verify everything
node -e "
import sdk from 'sentinel-dvpn-sdk';
console.log('SDK exports:', Object.keys(sdk).length);
"

# 7. Run smoke tests
node node_modules/sentinel-dvpn-sdk/test/smoke.js
```

**For C# projects:**

```bash
# 1. Install .NET 8.0 SDK
# Download from https://dotnet.microsoft.com/download/dotnet/8.0

# 2. Add SDK NuGet package (when published)
dotnet add package Sentinel.SDK

# 3. Build and run tests
dotnet build
dotnet test
```
