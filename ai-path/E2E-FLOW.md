# End-to-End Flow: AI Agent to Decentralized VPN

> The definitive technical reference. Every step from SDK discovery to encrypted traffic flowing through a decentralized VPN tunnel. Verified against 837+ mainnet node tests, 8 consumer apps, and 165+ hours of production debugging. Enriched with findings from Handshake dVPN (27 problems), Test2 proving ground, Node Tester (780+ nodes), and 22 undiagnosed failure patterns. Every timeout, every field name, every byte count is exact.

---

## Phase 1: Discovery & Installation

### Package

```
npm install sentinel-dvpn-sdk
```

Package name: `sentinel-dvpn-sdk`
License: MIT
Entry point: `index.js` (ESM only -- `"type": "module"`)
Exports: 160+ functions from single entry point

### Node.js Requirement

**Node.js 20.0.0 or higher.** The SDK uses:
- ES Modules (`import`/`export`) exclusively
- `crypto.randomUUID()` (Node 19+)
- Native `fetch` adapter override via `axios.defaults.adapter = 'http'` (Node 18+ uses undici internally, which produces opaque "fetch failed" errors on self-signed certs -- the SDK forces the classic HTTP adapter)

### Postinstall: V2Ray Download

`npm install` triggers `node setup.js` which:

1. Detects platform: `${process.platform}-${process.arch}` (e.g., `win32-x64`, `linux-x64`, `darwin-arm64`)
2. Downloads V2Ray v5.2.1 from `https://github.com/v2fly/v2ray-core/releases/download/v5.2.1/v2ray-{platform}.zip`
3. Verifies SHA256 checksum against hardcoded digests:
   - `win32-x64`: `d9791f911b603437a34219488b0111ae9913f38abe22c0103abce330537dabd6`
   - `win32-ia32`: `dc9f37dbeb32221e62b9a52b79f1842a217f049675872b334e1e5fd96121d0d2`
   - `linux-x64`: `56eb8d4727b058d10f8ff830bb0121381386b0695171767f38ba410f2613fc9a`
   - `linux-arm64`: `63958429e93f24f10f34a64701f70b4f42dfa0bc8120e1c0a426c6161bd2a3c9`
   - `darwin-x64`: `edbb0b94c05570d39a4549186927369853542649eb6b703dd432bda300c5d51a`
   - `darwin-arm64`: `e18c17a79c4585d963395ae6ddafffb18c5d22777f7ac5938c1b40563db88d56`
4. Extracts to `bin/` directory: `v2ray.exe` (or `v2ray`), `geoip.dat`, `geosite.dat`
5. If download fails, prints warning but does not block install (V2Ray is only needed for V2Ray nodes)

**CRITICAL: V2Ray must be exactly v5.2.1.** Versions 5.44.1+ have observatory/balancer bugs that break multi-outbound configs. The SDK's `verifyDependencies()` function checks the version at connect time and refuses incompatible versions.

### WireGuard (Optional)

WireGuard is not downloaded by setup. It must be pre-installed:
- **Windows:** `https://download.wireguard.com/windows-client/wireguard-installer.exe` -- installs to `C:\Program Files\WireGuard\wireguard.exe`
- **Linux:** `apt install wireguard` or equivalent
- **macOS:** `brew install wireguard-tools`

WireGuard requires **Administrator/root privileges** for tunnel installation. The SDK detects admin status at module load via `IS_ADMIN` export. Approximately 30% of Sentinel nodes are WireGuard; the rest are V2Ray.

### File Structure After Install

```
node_modules/sentinel-dvpn-sdk/
  index.js              # Single entry point (160+ exports)
  index.d.ts            # TypeScript definitions
  defaults.js           # Chain IDs, endpoints, timeouts, transport rates
  errors.js             # 33 typed error codes with severity classification
  cosmjs-setup.js       # Wallet, registry, broadcast, LCD queries
  v3protocol.js         # Handshake, protobuf encoders, WireGuard/V2Ray config
  node-connect.js       # Connection orchestration (connectDirect, connectAuto, disconnect)
  wireguard.js          # Cross-platform WireGuard tunnel management
  speedtest.js          # SOCKS5 and direct speed testing
  plan-operations.js    # Plan/provider/lease message encoders
  batch.js              # Batch session operations (operator/testing)
  preflight.js          # Pre-flight system checks
  tls-trust.js          # TOFU TLS for self-signed node certificates
  state.js              # Crash recovery state persistence
  disk-cache.js         # Generic disk cache with age tracking
  session-tracker.js    # Payment mode persistence per session
  session-manager.js    # Session lifecycle management
  app-settings.js       # VPN settings persistence
  app-types.js          # App type framework (peer-to-peer, plan-based, all-in-one)
  app-helpers.js        # Country map (183 entries), pricing display, UX helpers
  client.js             # SentinelClient class (per-instance DI)
  audit.js              # Network audit and node testing
  setup.js              # Binary download script
  bin/
    v2ray.exe           # V2Ray 5.2.1 binary
    geoip.dat           # V2Ray GeoIP database
    geosite.dat         # V2Ray GeoSite database
```

---

## Phase 2: Wallet Setup

### Key Generation

```javascript
import { generateWallet, createWallet, privKeyFromMnemonic } from 'sentinel-dvpn-sdk';

// Generate a NEW wallet (random mnemonic)
const { mnemonic, wallet, account } = await generateWallet(128); // 128=12 words, 256=24 words

// Restore from existing mnemonic
const { wallet, account } = await createWallet('your twelve word mnemonic phrase here ...');

// Derive raw private key (needed for handshake signatures)
const privKey = await privKeyFromMnemonic('your twelve word mnemonic ...');
// privKey is a 32-byte Buffer (secp256k1 private key)
```

### Cryptographic Details

| Property | Value |
|----------|-------|
| Mnemonic standard | BIP39, English wordlist |
| Word count | 12 (128-bit entropy) or 24 (256-bit entropy) |
| Entropy source | `@cosmjs/crypto Random.getBytes()` (CSPRNG) |
| Seed derivation | BIP39 mnemonic-to-seed (PBKDF2, 2048 rounds) |
| HD derivation | SLIP-10 (not BIP32) with curve `Secp256k1` |
| HD path | `m/44'/118'/0'/0/0` (Cosmos standard, `makeCosmoshubPath(0)`) |
| Key type | secp256k1 (same as Bitcoin, Ethereum, Cosmos) |
| Address format | Bech32 with prefix `sent` (e.g., `sent1abc...xyz`) |
| Address length | 47 characters total (5 prefix + 1 separator + 38 data + 6 checksum) |
| Node address format | Bech32 with prefix `sentnode` (e.g., `sentnode1abc...xyz`) |
| Provider address format | Bech32 with prefix `sentprov` |

### Security Requirements

- **Zero private key after use:** `privKey.fill(0)` -- the SDK does this automatically in `connectInternal()` via `try/finally`
- **NEVER log or store mnemonic in source code** -- use environment variables or secure storage
- **Wallet cache:** The SDK caches wallet derivation by SHA256(mnemonic) to avoid repeated 300ms BIP39 derivation. Call `clearWalletCache()` after disconnect to release key material from memory.

### Address Conversion

Same key, different Bech32 prefix. The SDK provides conversion functions:

```javascript
import { sentToSentnode, sentToSentprov, sentprovToSent } from 'sentinel-dvpn-sdk';

sentToSentnode('sent1abc...')  // -> 'sentnode1abc...'
sentToSentprov('sent1abc...')  // -> 'sentprov1abc...'
sentprovToSent('sentprov1abc...') // -> 'sent1abc...'
```

---

## Phase 3: Funding

### Token

| Property | Value |
|----------|-------|
| Display name | **P2P** (NOT "DVPN" in user-facing text) |
| Chain denom | `udvpn` (micro-DVPN, 1 P2P = 1,000,000 udvpn) |
| Format function | `formatP2P(amount)` returns "X.XX P2P" |
| Chain ID | `sentinelhub-2` |
| Gas price | `0.2udvpn` (chain minimum) |

### CRITICAL: BaseValue vs QuoteValue Pricing

*(Source: Handshake dVPN -- 3 hours wasted debugging 18-decimal garbage)*

Node prices come with TWO values. Use the WRONG one and your UI shows `52573.099722991367791000000000/GB`:

| Field | Format | Use? | Example |
|-------|--------|------|---------|
| `base_value` | Cosmos `sdk.Dec` (scaled by 10^18) | **NEVER for display** | `"5500000000000000000000000"` |
| `quote_value` | Integer (`sdk.Int`) in `udvpn` | **ALWAYS for display** | `"40152030"` |

**Rule:** Always use `quote_value` for display pricing. Use `base_value` only when constructing the `max_price` protobuf field for `MsgStartSessionRequest`.

**Price formatting function:**
```javascript
function formatP2PPrice(udvpnStr) {
  const p2p = parseInt(udvpnStr) / 1_000_000;
  if (p2p >= 100) return `${Math.round(p2p)} P2P`;
  if (p2p >= 10) return `${p2p.toFixed(1).replace(/\.0$/, '')} P2P`;
  if (p2p >= 1) return `${p2p.toFixed(2).replace(/0$/, '').replace(/\.$/, '')} P2P`;
  return `${p2p.toFixed(4)} P2P`;
}
// formatP2PPrice("40152030") -> "40.15 P2P"
```

### Minimum Balance

| Item | Cost |
|------|------|
| Minimum for any operation | 1.0 P2P (1,000,000 udvpn) — covers gas + cheapest node |
| 1 GB (cheapest, varies) | ~0.68 P2P — node operators set their own prices |
| 1 GB (median, varies) | ~40 P2P — use `estimateCost()` for live pricing |
| Gas per transaction | ~0.04 P2P (40,000 udvpn) |
| End session TX | Fixed 0.02 P2P gas (20,000 udvpn, 200,000 gas) |

The SDK checks balance before session payment:
```javascript
if (bal.udvpn < 1000000) {
  throw new ChainError('INSUFFICIENT_BALANCE',
    `Wallet has ${bal.p2p} P2P -- need at least 1.0 P2P`);
}
```

### Where to Buy P2P Tokens

- **Osmosis DEX:** Swap USDT/USDC/ATOM to P2P
- **CEX listings:** Check CoinGecko for current exchanges
- Fund the `sent1...` address shown in `account.address`

### Balance Check

```javascript
import { getBalance, createWallet, createClient, DEFAULT_RPC } from 'sentinel-dvpn-sdk';

const { wallet, account } = await createWallet(mnemonic);
const client = await createClient(DEFAULT_RPC, wallet);
const { udvpn, dvpn } = await getBalance(client, account.address);
// udvpn = raw micro amount (integer), dvpn = human-readable (float)
```

**LCD endpoint for direct query:**
```
GET /cosmos/bank/v1beta1/balances/{sent1...}
```

### LCD Failover Chain

The SDK tries these endpoints in order. On failure, it automatically falls back to the next:

| Priority | URL | Name |
|----------|-----|------|
| 1 | `https://lcd.sentinel.co` | Sentinel Official |
| 2 | `https://sentinel-api.polkachu.com` | Polkachu |
| 3 | `https://api.sentinel.quokkastake.io` | QuokkaStake |
| 4 | `https://sentinel-rest.publicnode.com` | PublicNode |

**RPC Failover Chain** (for TX broadcast):

| Priority | URL | Name |
|----------|-----|------|
| 1 | `https://rpc.sentinel.co:443` | Sentinel Official |
| 2 | `https://sentinel-rpc.polkachu.com` | Polkachu |
| 3 | `https://rpc.mathnodes.com` | MathNodes |
| 4 | `https://sentinel-rpc.publicnode.com` | PublicNode |
| 5 | `https://rpc.sentinel.quokkastake.io` | QuokkaStake |

---

## Phase 4: Node Discovery

### Fetching Active Nodes

```javascript
import { queryOnlineNodes, fetchAllNodes } from 'sentinel-dvpn-sdk';

// Fast: LCD-only, no per-node checks (900+ nodes, instant)
const allNodes = await fetchAllNodes();

// Thorough: checks each node's online status + quality scoring
const onlineNodes = await queryOnlineNodes({
  serviceType: 'v2ray',    // 'wireguard' | 'v2ray' | null (both)
  maxNodes: 100,            // max nodes to probe
  concurrency: 20,          // parallel online checks
});
```

### LCD Endpoint for Active Nodes

```
GET /sentinel/node/v3/nodes?status=1&pagination.limit=5000
```

### CRITICAL v3 Rules

| Rule | Detail |
|------|--------|
| **Use v3 paths, NOT v2** | v2 returns "Not Implemented" for ALL endpoints except provider |
| **Provider is v2 ONLY** | `/sentinel/provider/v2/providers/{sentprov1...}` -- NOT v3 |
| **Status filter** | `status=1` (integer), NOT `status=STATUS_ACTIVE` (string) |
| **Node type field** | `service_type` (NOT `type`) -- values: `1` (V2Ray) or `2` (WireGuard) |
| **Remote URL field** | `remote_addrs` (array of `"IP:PORT"` strings), NOT `remote_url` (string) |
| **Account address** | `acc_address` (NOT `address`) |
| **Session nesting** | Session data is under `base_session` -- always use `session.base_session || session` |

### CRITICAL: Pagination is Broken

*(Source: Test2 confirmed, Node Tester confirmed with 921+ node scans)*

**NEVER trust `count_total` or `next_key`** on Sentinel LCD endpoints:
- Some endpoints return `min(actual_count, limit)` as `count_total`
- Some endpoints return `null` for `next_key` even when more data exists
- Test2 verified: `count_total` returned 500 when 921 nodes existed
- **Solution:** Single request with `limit=5000` -- returns all data in one call

### Tiered Caching Pattern

*(Source: Handshake dVPN -- bandwidth optimization for consumer apps)*

Node data should be cached at multiple tiers to minimize chain queries:

| Data | Show From | Refresh When | TTL |
|------|-----------|-------------|-----|
| Node list | Disk cache on login | Background after login | 30 min |
| Node status (peers, location) | Memory from last probe | On user Refresh click | Per session |
| Balance | Last known value | Every 5 min | -- |
| Session allocation | Chain query | Every 120s when connected | -- |
| Country flags | Disk permanent | Never | Forever |
| Settings | Disk permanent | On save | Forever |

**Key rules from Handshake dVPN:**
- Load on app open -- probing starts immediately, before login
- Single probe per session -- cache in memory, reuse across login/logout
- Only re-probe on explicit Refresh button -- user controls when to re-query
- Progress logged every 200 nodes, not every 100 (reduces log spam)
- 30 parallel workers, 6s timeout each, ~25s for 1000+ nodes
- ChainClient usable without wallet (for node loading before login)

### Node Object Shape (from LCD)

```json
{
  "address": "sentnode1...",
  "remote_addrs": ["1.2.3.4:8585"],
  "gigabyte_prices": [
    { "denom": "udvpn", "base_value": "5500000", "quote_value": "40152030" }
  ],
  "hourly_prices": [
    { "denom": "udvpn", "base_value": "1000000", "quote_value": "0" }
  ],
  "service_type": 1
}
```

### Resolving Node URL

LCD returns `remote_addrs` as an array of bare `"IP:PORT"` strings (no protocol prefix). The SDK's `resolveNodeUrl()` handles both v2 and v3 formats:

```javascript
import { resolveNodeUrl } from 'sentinel-dvpn-sdk';
const url = resolveNodeUrl(node); // Returns "https://1.2.3.4:8585"
```

**NEVER access `node.remote_url` directly** -- it is undefined in v3. Always use `resolveNodeUrl()`.

### Country Data

Country/city information is NOT on the LCD. It requires querying each node's own status API:

```javascript
import { nodeStatusV3 } from 'sentinel-dvpn-sdk';
const status = await nodeStatusV3('https://1.2.3.4:8585');
// status.location = { city, country, country_code, latitude, longitude }
// status.moniker = "MyNode"
// status.type = "wireguard" | "v2ray"
// status.peers = 3
// status.clockDriftSec = -2 (seconds, negative = node behind)
```

Use `enrichNodes()` to batch-probe all nodes for country data, or `buildNodeIndex()` to create a geographic lookup.

---

## Phase 5: Node Selection

### Service Type Success Rates (from 780-node mainnet scan)

| Service Type | Success Rate | Admin Required | Notes |
|-------------|-------------|----------------|-------|
| WireGuard | ~100% (when reachable) | Yes | Simpler protocol, fewer failure modes |
| V2Ray | ~95.6% | No | Multiple transport fallback options |

### V2Ray Transport Reliability (from 780-node scan)

| Transport | Success Rate | Sample | Notes |
|-----------|-------------|--------|-------|
| `tcp` | 100% | 274 | **Best. Always first choice.** |
| `websocket` | 100% | 23 | Second choice |
| `http` | 100% | 4 | Third choice |
| `gun` | 100% | 10 | gun(2) and grpc(3) are DIFFERENT enum values but use same V2Ray config |
| `mkcp` | 100% | 5 | |
| `grpc/none` | 87% | 81 | Fixed by serverName TLS fix |
| `quic` | 0% | 4 | Fixed (security: 'none'), but low node count |
| `grpc/tls` | **0%** | 0 | **ALWAYS FAILS. Filter before paying.** |

### Undiagnosed Failure Categories

*(Source: Node Tester -- 22 nodes with active peers that fail for us)*

Even after all fixes, ~2.8% of nodes with active peers still fail. These are OUR bugs, not node-side issues. Categories:

| Category | Count | Symptom | Likely Cause (Our Side) |
|----------|-------|---------|------------------------|
| TCP Port Unreachable | 10 | Pre-check says port closed, but 3-7 peers connected | Probe timeout too short, DNS resolution differs, ISP blocking from our IP |
| SOCKS5 No Connectivity | 5 | Handshake OK, V2Ray starts, SOCKS5 binds, no internet | V2Ray 5.2.1 grpc/quic bugs, egress policy blocks our test targets |
| Clock Drift VMess Skip | 4 | >120s drift detected, we skip, but 4-6 peers work fine | Our measurement may be inaccurate, node may have VLess (unaffected) we fail to detect |
| V2 Format Metadata | 1 | 48 peers, but metadata has v2 fields not v3 | Dual-format node, we should support v2 fallback |
| Handshake Failures | 2 | ECONNRESET or 30s timeout with 3-4 peers | TLS cipher mismatch, timeout too short for distant nodes |

**Iron rule:** Any node with peers > 0 that fails = our bug. NEVER say "node-side" or "can't fix."

### Quality Scoring

The SDK scores nodes 0-100 based on:
- **+20** for WireGuard type
- **-40** for clock drift >120s (VMess AEAD failure zone)
- **-15** for clock drift >60s
- **-5** for clock drift >30s
- **+10** for 0 peers (empty node = fast)
- **+5** for <5 peers
- **-10** for >20 peers

### Circuit Breaker

The SDK tracks node failures and skips nodes that fail repeatedly:
- Default: 3 failures within 5 minutes = circuit open (node skipped)
- Configurable via `configureCircuitBreaker({ threshold: 3, ttlMs: 300000 })`
- Auto-resets after TTL expires
- Cleared on successful connection

### Pre-Selection Checks

Before paying for a session, verify:
1. Node accepts `udvpn` denom: `node.gigabyte_prices.some(p => p.denom === 'udvpn')`
2. Node has reachable remote URL: `resolveNodeUrl(node)` does not return null
3. Node is not in the circuit breaker
4. Node address matches remote URL (prevents address mismatch -- check `nodeStatusV3().address`)
5. Clock drift <120s for V2Ray nodes (VMess AEAD tolerance)
6. If WireGuard: admin privileges available (`IS_ADMIN === true`)
7. If V2Ray: `v2ray.exe` v5.2.1 exists

---

## Phase 6: Session Creation (Blockchain TX)

### Message Type

```
/sentinel.node.v3.MsgStartSessionRequest
```

### Protobuf Fields

| Field # | Name | Type | Description |
|---------|------|------|-------------|
| 1 | `from` | string | Signer's `sent1...` address |
| 2 | `node_address` | string | Target `sentnode1...` address |
| 3 | `gigabytes` | int64 | Bandwidth to purchase (0 if hourly) |
| 4 | `hours` | int64 | Duration to purchase (0 if per-GB) |
| 5 | `max_price` | Price | Maximum price user will pay (from node's gigabyte_prices or hourly_prices) |

**Price sub-message:**
| Field # | Name | Type | Description |
|---------|------|------|-------------|
| 1 | `denom` | string | `"udvpn"` |
| 2 | `base_value` | string | sdk.Dec scaled by 10^18 (e.g., `"5500000"` from LCD) |
| 3 | `quote_value` | string | sdk.Int (e.g., `"40152030"` from LCD) |

### SDK Usage

```javascript
import { connectDirect, registerCleanupHandlers } from 'sentinel-dvpn-sdk';

// REQUIRED: Register cleanup handlers BEFORE any connection
registerCleanupHandlers();

const result = await connectDirect({
  mnemonic: process.env.MNEMONIC,
  nodeAddress: 'sentnode1...',
  gigabytes: 1,
  // Optional:
  rpcUrl: 'https://rpc.sentinel.co:443',
  lcdUrl: 'https://lcd.sentinel.co',
  v2rayExePath: './bin/v2ray.exe',
  fullTunnel: true,      // Route ALL traffic through VPN
  systemProxy: false,     // Set Windows system SOCKS proxy
  killSwitch: false,      // Block all traffic if tunnel drops
  onProgress: (step, detail) => console.log(`[${step}] ${detail}`),
});
```

### CRITICAL: ForceNewSession for Consumer Apps

*(Source: Handshake dVPN -- stale session 404 errors)*

Consumer apps should use `forceNewSession: true` to avoid stale session 404 errors. Without it, the SDK attempts to reuse existing sessions which may have expired or become corrupted on the node side, producing confusing 404 "session does not exist" errors.

```javascript
const result = await connectDirect({
  mnemonic: process.env.MNEMONIC,
  nodeAddress: 'sentnode1...',
  gigabytes: 1,
  forceNewSession: true,  // RECOMMENDED for consumer apps
});
```

**Exception:** For node testing tools that test hundreds of nodes, session reuse saves tokens. Only use `forceNewSession: false` when you have logic to validate the existing session is still active.

### CRITICAL: Fee Grant Detection

*(Source: Handshake dVPN -- wrong fee grant auto-detection for direct-connect apps)*

The SDK's fee grant auto-detection assumes plan-based subscriptions (where the plan owner pays gas). For direct-connect (P2P) apps where the user pays their own gas, fee grant detection must be **disabled entirely**. Otherwise the SDK incorrectly tries to use a non-existent fee grant and the TX fails.

- **Plan-based apps:** Fee grant auto-detection is correct (plan owner grants gas to subscribers)
- **Direct-connect apps:** Set `feeGrant: false` or remove fee grant logic entirely
- **All-in-one apps:** Detect payment mode and toggle accordingly

### Payment Is Locked Upfront

Tokens are escrowed on session creation. They are NOT refundable if the connection fails after payment. This is why pre-verification (Phase 5) is critical.

### Sequence Retry Logic

The SDK uses `createSafeBroadcaster()` for production apps, which handles:
- **Error code 32 (sequence mismatch):** Up to 5 retry attempts with exponential backoff (2s, 4s, 6s, 6s)
- Each retry creates a fresh SigningStargateClient (fresh sequence number from RPC)
- Broadcasts are serialized through a mutex (one TX at a time)

### Code 105 Retry (Node Inactive)

If the chain returns code 105 ("invalid status inactive"), it means the node went offline between the LCD query and the payment TX. The SDK:
1. Waits 15 seconds (LCD data may be stale)
2. Retries the broadcast once
3. If still code 105, throws `NodeError('NODE_INACTIVE')`

### Session ID Extraction

After successful broadcast, the session ID is extracted from TX ABCI events:
```javascript
const sessionId = extractId(txResult, /session/i, ['session_id', 'id']);
```

Event attributes may be base64-encoded (depends on CosmJS version). The SDK handles both string and base64-encoded keys/values. The extracted ID is a string representation of a uint64.

**CRITICAL:** `sessionId` is a BigInt internally. Convert to string before JSON serialization: `sessionId.toString()`. `JSON.stringify({ sessionId: 123n })` throws `TypeError`.

### Inter-TX Spacing

**Minimum 7 seconds between transactions.** Rapid TX submission causes sequence mismatch cascades. NEVER run parallel chain operations -- rate limits will kill your internet connectivity.

---

## Phase 7: Index Wait

After the session TX confirms on-chain, the node needs time to see the block and index the session.

### Wait Sequence

| Step | Delay | Purpose |
|------|-------|---------|
| Post-payment wait | **5 seconds** | Node indexes session from new block |
| Chain lag retry (handshake 404) | **10 seconds** | Node still processing; retry once |
| Already-exists retry 1 (409) | **15 seconds** | Session indexing race condition |
| Already-exists retry 2 (409) | **20 seconds** | Final attempt before fresh payment |

### What Happens Without the Wait

Without the 5-second post-payment delay:
- **404 "session does not exist"** -- node hasn't seen the block yet
- **409 "already exists"** -- node is still indexing the previous state

The SDK handles both automatically with retries, but the initial 5s delay prevents most failures.

### Inactive Pending Status

After TX confirms, the session may be in `inactive_pending` status. The SDK's `waitForSessionActive()` polls every 2 seconds for up to 20 seconds until the status transitions to `active`.

---

## Phase 8: V3 Handshake

### Protocol

Single HTTPS POST to the node's remote URL (from `remote_addrs`).

### Endpoint

```
POST https://{node_ip}:{node_port}/
Content-Type: application/json
```

### TLS

All Sentinel nodes use **self-signed certificates**. The SDK uses a TOFU (Trust-On-First-Use) model:
- First connection: accept any certificate, save fingerprint
- Subsequent connections: reject if certificate fingerprint changed (possible MITM)
- Configurable via `tlsTrust: 'tofu'` (default) or `'none'` (insecure)

### Request Timeout

**90 seconds.** Overloaded nodes can take 60-90s to respond.

### Request Body

```json
{
  "data": "<base64_encoded_peer_data>",
  "id": 12345,
  "pub_key": "secp256k1:<base64_compressed_pubkey>",
  "signature": "<base64_signature>"
}
```

### Field Construction Details

**`data` field (base64-encoded JSON):**

For WireGuard:
```json
{"public_key": "<base64_x25519_public_key>"}
```

For V2Ray:
```json
{"uuid": [byte, byte, byte, ...16 bytes]}
```

The `data` field is `base64(JSON.stringify(peer_request))`.

**`id` field:**
- Session ID as a JavaScript Number (NOT BigInt)
- CRITICAL: Must pass `Number.isSafeInteger()` check (max 2^53 - 1 = 9007199254740991)
- The SDK throws if sessionId exceeds safe integer range

**`pub_key` field:**
- Format: `"secp256k1:" + base64(compressed_secp256k1_pubkey)`
- Compressed public key is 33 bytes (prefix 0x02 or 0x03 + 32 bytes X coordinate)

**`signature` field:**

```
signature = base64(secp256k1_sign(SHA256(message))[0:64])
```

Where `message` is the concatenation of:
1. **BigEndian uint64 (8 bytes)** of the session ID
2. **Raw bytes** of the `data` field (the base64-decoded peer JSON bytes)

**CRITICAL: Sign the RAW JSON bytes, NOT the base64 string.**

The signature is:
- SHA256 hash of the concatenated message
- secp256k1 signature (deterministic, RFC 6979)
- **Exactly 64 bytes** (r + s, NO recovery byte) -- Go's `VerifySignature` requires `len == 64`
- The SDK takes the first 64 bytes of the 65-byte `toFixedLength()` output

### WireGuard Key Generation

```javascript
import { generateWgKeyPair } from 'sentinel-dvpn-sdk';
const { privateKey, publicKey } = generateWgKeyPair();
// privateKey: Buffer(32), publicKey: Buffer(32)
```

Key generation:
1. Generate 32 random bytes (CSPRNG)
2. Apply WireGuard bit clamping: `priv[0] &= 248; priv[31] &= 127; priv[31] |= 64;`
3. Derive public key via X25519 scalar base multiplication

### V2Ray UUID Generation

```javascript
import { generateV2RayUUID } from 'sentinel-dvpn-sdk';
const uuid = generateV2RayUUID(); // crypto.randomUUID(), e.g., "550e8400-e29b-41d4-a716-446655440000"
```

The UUID is sent to the node as an integer byte array (16 bytes) in the peer request.

### Response (WireGuard)

The response `result.data` is base64-encoded JSON containing:
```json
{
  "addrs": ["10.8.0.2/24"],
  "metadata": [{ "port": 51820, "public_key": "<base64_server_wg_pubkey>" }]
}
```

- `result.addrs` = node's WireGuard listening addresses (`["IP:PORT", ...]`)
- `addPeerResp.addrs` = our assigned IPs (e.g., `["10.8.0.2/24"]`)
- `addPeerResp.metadata[0].public_key` = server's WireGuard public key
- `addPeerResp.metadata[0].port` = server's WireGuard port (default 51820)

### Response (V2Ray)

The response `result.data` is base64-encoded JSON containing V2Ray outbound configuration with metadata entries. Each metadata entry describes one transport option:

```json
{
  "metadata": [
    {
      "proxy_protocol": 1,
      "transport_protocol": 7,
      "transport_security": 0,
      "port": 443
    }
  ]
}
```

- `proxy_protocol`: 1=VLess, 2=VMess
- `transport_protocol`: 1=domainsocket, 2=gun, 3=grpc, 4=http, 5=mkcp, 6=quic, 7=tcp, 8=websocket
- `transport_security`: 0=none, 2=tls
- `port`: server port for this transport

### Handshake Error Handling

| HTTP Status | Body Pattern | Meaning | Action |
|-------------|-------------|---------|--------|
| 404 | "does not exist" | Chain lag -- node hasn't indexed session | Wait 10s, retry once |
| 409 | "already exists" | Session indexing race | Wait 15s/20s, retry; then pay fresh |
| 500 | "no such table" / "database is locked" | Corrupted node database | Throw `NODE_DATABASE_CORRUPT`, skip node |
| Other | Any | Node-level failure | Throw `NODE_OFFLINE` |

### Response Validation

The SDK validates every handshake response field:
- Server public key must be non-empty
- Server port must be 1-65535
- Assigned addresses must be valid CIDR (IPv4 or IPv6)
- At least one assigned address must be returned
- At least one server endpoint address must be returned

---

## Phase 9: Tunnel Installation

### CRITICAL: WireGuard Pre-Cleanup Before Every Connect

*(Source: Handshake dVPN -- tunnel orphan crashes)*

**Always uninstall stale WireGuard tunnels BEFORE attempting a new connection.** A leftover `wgsent0` tunnel from a crash, force-quit, or previous session will cause the new install to fail silently.

```
# Windows: run before every new connection
wireguard.exe /uninstalltunnelservice wgsent0
```

The SDK's `registerCleanupHandlers()` does this at startup via `emergencyCleanupSync()`, but consumer apps with dedicated test VPN instances must also clean up independently. For node testing scenarios, clean up BEFORE and AFTER each test node.

### WireGuard Path

#### Config Generation

```ini
[Interface]
PrivateKey = <base64_client_private_key>
Address = 10.8.0.2/24
MTU = 1420
DNS = 103.196.38.38, 103.196.38.39

[Peer]
PublicKey = <base64_server_public_key>
Endpoint = 1.2.3.4:51820
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
```

#### Config Values

| Setting | Value | Why |
|---------|-------|-----|
| MTU | `1420` (default, configurable) | WireGuard standard for IPv4. Use `1280` for IPv6/restrictive networks. Sentinel nodes historically used 1280; current SDK defaults to 1420. |
| DNS | `103.196.38.38, 103.196.38.39` (default: Handshake DNS) | Configurable via `dns` option. Presets: `handshake`, `google` (8.8.8.8), `cloudflare` (1.1.1.1). Only set for full tunnel; split tunnel uses system DNS. |
| PersistentKeepalive | `25` (default, configurable) | NAT traversal. 15-25s is safe for all NAT routers. |
| AllowedIPs (full tunnel) | `0.0.0.0/0, ::/0` | Routes ALL traffic. **Kills internet if tunnel fails.** |
| AllowedIPs (split tunnel) | Explicit IP list | Only routes specified IPs. Safe for testing. |

#### Config File Location

- **Windows:** `C:\ProgramData\sentinel-wg\wgsent0.conf` (SYSTEM-readable; user temp dirs are not)
- **Linux/macOS:** `/tmp/sentinel-wg/wgsent0.conf`

**Security:** Directory ACL is set BEFORE writing the file (closes the race window where the private key would be world-readable). On Windows, `icacls` restricts to current user + SYSTEM only.

#### Verify-Before-Capture (Critical Safety Pattern)

The SDK uses a two-phase install to prevent killing the user's internet:

1. **Phase 1: Safe install** -- Install with split IPs (`1.1.1.1/32, 1.0.0.1/32`) that only capture verification traffic
2. **Verify** -- HTTP GET to `https://1.1.1.1` and `https://1.0.0.1` through the tunnel
3. **Phase 2: Full capture** -- If verified, reinstall with `AllowedIPs = 0.0.0.0/0, ::/0`

Without this pattern, a broken node causes ~78 seconds of dead internet while verification loops fail.

#### Installation (Windows)

```
wireguard.exe /installtunnelservice C:\ProgramData\sentinel-wg\wgsent0.conf
```

**NEVER use `/installmanagerservice`** -- that starts the WireGuard GUI which takes over tunnel management and conflicts with programmatic control.

#### Installation Retry

The SDK tries tunnel installation 3 times with escalating delays:
1. Wait 1.5s, try install
2. Wait 1.5s, try install
3. Wait 2.0s, try install (final attempt)

This gives the node time to register the peer (most do so within 1-2 seconds).

#### Connectivity Verification

After installation, the SDK verifies actual traffic flow:
- 1 attempt, 2 targets (`https://1.1.1.1`, `https://www.cloudflare.com`), 5s timeout each
- Maximum exposure: ~10 seconds
- If verification fails: immediately tear down tunnel, throw `WG_NO_CONNECTIVITY`
- A RUNNING service does NOT guarantee traffic flows

### V2Ray Path

#### Post-Handshake Delay

**Wait 5 seconds after handshake before starting V2Ray.** The node needs time to register the UUID internally. Without this delay, ~8% of V2Ray nodes will reject connections.

#### Sequential Outbound Fallback

The SDK does NOT use V2Ray's built-in balancer (it's buggy in v5.2.1). Instead, it implements its own sequential fallback:

1. Parse all metadata entries from handshake response
2. Sort outbounds by transport reliability (tcp > websocket > http > gun > mkcp > grpc/none)
3. For each outbound, one at a time:
   a. Write V2Ray config with single outbound
   b. Spawn `v2ray run -config <path>`
   c. Wait for SOCKS5 port to accept connections (`waitForPort`, 10s timeout)
   d. Test SOCKS5 connectivity via HTTP GET through proxy (see pre-check below)
   e. If connected: keep this outbound, break
   f. If failed: kill V2Ray process, try next outbound

#### CRITICAL: V2Ray SOCKS5 Connectivity Pre-Check

*(Source: Node Tester -- 411/411 V2Ray speed tests failing until this was fixed)*
*(Source: Complete Integration Spec -- exact retry pattern)*

V2Ray SOCKS5 binding is asynchronous. The proxy may not be ready even after the port accepts TCP connections. The pre-check MUST use retries:

```
Try up to 3 attempts with 5-second pause between:
  For each target in [google.com, cloudflare.com, 1.1.1.1/cdn-cgi/trace,
                      httpbin.org/ip, ifconfig.me, ip-api.com/json]:
    HTTP GET via SOCKS5 proxy (15s timeout)
    If ANY target returns HTTP 200 -> tunnel is working, proceed

  If all 6 targets fail -> wait 5 seconds -> try again (up to 3 attempts)

If ALL 3 attempts fail -> throw "SOCKS5 tunnel has no internet connectivity"
```

**CRITICAL:** Create a FRESH `SocksProxyAgent` / `HttpClient` per request. V2Ray SOCKS5 connections SILENTLY FAIL with connection reuse. In C#, never reuse `HttpClient` for SOCKS5 -- connection pooling returns stale/empty responses.

#### V2Ray Config Rules (Silent Failures If Wrong)

| Setting | Correct | Wrong (Fails Silently) |
|---------|---------|----------------------|
| VLess encryption | `"none"` | Any other value |
| VLess flow | **Omit entirely** | Any value including `""` |
| VMess alterId | `0` | Any other value |
| VMess user security | **Omit entirely** | Any value |
| UUID field name | `"uuid"` | `"id"` |
| UUID format | String `"550e8400-..."` | Array or other format |
| grpc serviceName | `grpcSettings: { serviceName: '' }` | Omitting grpcSettings |
| QUIC security | `security: 'none'` | `security: 'chacha20-poly1305'` |
| Per-outbound transport | **No per-outbound streamSettings** | Putting streamSettings inside outbound |

#### SOCKS5 Port Assignment

Each outbound attempt gets a unique SOCKS5 port to avoid Windows TIME_WAIT conflicts:
```
basePort = 10800 + random(0, 999)
port_for_outbound_i = basePort + i
```

TIME_WAIT on Windows lasts ~120 seconds. Reusing the same port across fallback attempts guarantees failure.

#### SOCKS5 Authentication

V2Ray SOCKS5 inbound uses username/password authentication by default. **Windows system proxy cannot pass SOCKS5 credentials.** When `systemProxy: true`, the SDK patches SOCKS5 inbound to `noauth`.

#### SOCKS5 Testing

```javascript
// MUST use axios with adapter='http' for SOCKS5 testing
// Native fetch silently ignores the proxy agent
const { SocksProxyAgent } = await import('socks-proxy-agent');
const agent = new SocksProxyAgent(`socks5://user:pass@127.0.0.1:${socksPort}`);
await axios.get('https://www.google.com', {
  httpAgent: agent,
  httpsAgent: agent,
  timeout: 10000,
});
```

### 7-Layer Speed Test Fallback Chain

*(Source: Node Tester -- discovered through 780+ node tests, Complete Integration Spec)*

Speed testing must handle a wide range of tunnel capabilities. The SDK uses a 7-layer fallback chain:

#### For WireGuard (Direct Through Tunnel)

```
1. PRE-RESOLVE DNS before tunnel install
   Resolve speed.cloudflare.com, proof.ovh.net, speedtest.tele2.net to IP
   Cache resolved IPs for 5 minutes (DNS fails through many WireGuard tunnels)

2. PROBE: 1MB download (try in order, 30s timeout each)
   a. Cloudflare via cached IP: https://{cached_cf_ip}/__down?bytes=1048576
   b. Cloudflare via hostname: https://speed.cloudflare.com/__down?bytes=1048576
   c. OVH fallback: https://proof.ovh.net/files/1Mb.dat
   d. Tele2 fallback: https://speedtest.tele2.net/1MB.zip
   e. RESCUE: Cloudflare with 60s keep-alive timeout

   If ALL fail -> return "speed test failed"
   If probeMbps < 3 -> return { mbps: probeMbps, method: "probe-only" }
   If probeMbps >= 3 -> proceed to multi-request

3. MULTI-REQUEST: 5 x 1MB sequential downloads
   FRESH TCP+TLS connection per download (no connection reuse)
   Return average: { mbps: totalMbps, method: "multi-request", chunks: 5 }
   If fails but probe worked -> return { mbps: probeMbps, method: "probe-fallback" }
```

#### For V2Ray (Through SOCKS5 Proxy)

Same fallback chain but through SOCKS5, plus two additional layers:

```
4-5. Same as WireGuard layers 2-3 but via SOCKS5 proxy
     CRITICAL: Fresh SocksProxyAgent per request

6. GOOGLE FALLBACK: If all speed targets fail, time a Google HEAD request
   Estimate speed from latency: { mbps: estimated, method: "google-fallback" }

7. CONNECTED-NO-THROUGHPUT: If connectivity check passed but ALL speed methods fail
   Return: { mbps: 0.01, method: "connected-no-throughput" }
   (Node is reachable but too slow for meaningful speed measurement)
```

#### Speed Test Constants

```javascript
SPEED_THRESHOLDS = {
  PROBE_CUTOFF_MBPS: 3,       // Below this, skip multi-request
  PASS_10_MBPS: 10,            // SLA threshold ("FAST")
  PASS_15_MBPS: 15,            // High quality threshold
  BASELINE_MIN: 30,            // Minimum baseline for SLA applicability
  ISP_BOTTLENECK_PCT: 0.85,    // 85% of baseline = ISP bottleneck
};

TIMEOUTS = {
  PROBE_MS: 30000,
  RESCUE_MS: 60000,
  GOOGLE_MS: 15000,
  MULTI_CHUNK_MS: 30000,
  CONNECTIVITY_MS: 15000,
};
```

---

## Phase 10: Verification

### IP Verification

```javascript
// Check your VPN IP
const response = await axios.get('https://api.ipify.org?format=json', { timeout: 10000 });
console.log(response.data.ip); // Should be the VPN node's IP, not your real IP
```

### DNS Leak Check

For full-tunnel WireGuard: **Pre-resolve ALL hostnames BEFORE installing full tunnel.** DNS resolution fails through many WireGuard full tunnels because:
- The tunnel routes ALL traffic (including DNS)
- The node's internal DNS (10.8.0.1) may not resolve all domains
- External DNS servers may be unreachable through the tunnel

The SDK's `resolveSpeedtestIPs()` pre-resolves speed test hostnames before tunnel installation.

### CRITICAL: Fresh HttpClient Per V2Ray SOCKS5 Request

*(Source: Handshake dVPN -- 2 hours debugging; Node Tester -- 411 V2Ray tests failing)*

**Never reuse HTTP clients for V2Ray SOCKS5 proxy requests.** This is a platform-wide gotcha:

| Platform | Problem | Fix |
|----------|---------|-----|
| **Node.js** | `SocksProxyAgent` connection reuse causes TLS failures ("socket disconnected before secure connection") | Create fresh `SocksProxyAgent` per request, call `agent.destroy()` after |
| **C# (.NET)** | `HttpClient` connection pooling silently returns stale/empty responses through SOCKS5 | Create fresh `HttpClient(new HttpClientHandler { Proxy = ... })` per request |
| **Node.js fetch** | Native `fetch` (undici) **silently ignores** the `agent` option for SOCKS5 | Must use `axios` with `httpAgent`/`httpsAgent`, never native fetch |

This applies to ALL V2Ray SOCKS5 operations: connectivity pre-check, speed test, IP verification, Google check.

### Connection Verification Function

```javascript
import { verifyConnection } from 'sentinel-dvpn-sdk';

const result = await verifyConnection({
  socksPort: 10800,  // V2Ray only
  timeout: 10000,
});
// result = { connected: true, vpnIp: '1.2.3.4', latencyMs: 150 }
```

---

## Phase 11: Active Connection

### V2Ray (SOCKS5 Proxy)

After successful connection, a SOCKS5 proxy is available at:
```
127.0.0.1:<socksPort>
```

Route application traffic through this proxy:
```javascript
const { SocksProxyAgent } = await import('socks-proxy-agent');
const agent = new SocksProxyAgent(`socks5://127.0.0.1:${result.socksPort}`);
const response = await axios.get('https://example.com', {
  httpAgent: agent,
  httpsAgent: agent,
});
```

System-wide proxy (optional): `setSystemProxy(socksPort)` modifies Windows registry / macOS networksetup / Linux gsettings.

### WireGuard (Full Tunnel)

All system traffic is routed through the VPN. No application configuration needed. The tunnel is managed as a Windows service (`WireGuardTunnel$wgsent0`).

### Kill Switch

Blocks all non-tunnel traffic using Windows firewall rules (`netsh advfirewall`):
```javascript
import { enableKillSwitch, disableKillSwitch, isKillSwitchEnabled } from 'sentinel-dvpn-sdk';
enableKillSwitch(serverEndpoint); // Blocks all traffic except to VPN server
disableKillSwitch();              // Restores normal routing
```

The kill switch state is persisted to disk. On crash, `recoverOrphans()` at next startup detects and cleans orphaned firewall rules.

### Auto-Reconnect

```javascript
import { autoReconnect } from 'sentinel-dvpn-sdk';
autoReconnect({
  mnemonic: process.env.MNEMONIC,
  maxRetries: 5,
  onReconnecting: (attempt) => console.log(`Reconnecting (${attempt})...`),
});
```

### Events

```javascript
import { events } from 'sentinel-dvpn-sdk';
events.on('connected',    ({ sessionId, serviceType, nodeAddress }) => { });
events.on('disconnected', ({ nodeAddress, serviceType, reason }) => { });
events.on('progress',     ({ event, detail, ts }) => { });
events.on('error',        (err) => { });
events.on('sessionEnded', ({ txHash }) => { });
events.on('sessionEndFailed', ({ error }) => { });
```

---

## Phase 12: Disconnect

### SDK Disconnect

```javascript
import { disconnect } from 'sentinel-dvpn-sdk';
await disconnect();
```

Or use the cleanup function returned by `connectDirect()`:
```javascript
const conn = await connectDirect({ ... });
// ... use VPN ...
await conn.cleanup();
```

### Disconnect Sequence

1. **Signal abort:** Set `_abortConnect = true` to stop any running `connectAuto()` retry loop
2. **Release connection lock:** Set `_connectLock = false` so user can reconnect
3. **Disable kill switch:** Remove firewall rules (if enabled)
4. **Clear system proxy:** Restore previous proxy settings (Windows registry / macOS / Linux)
5. **Kill V2Ray:** `process.kill()` on the V2Ray child process
6. **Uninstall WireGuard:** `wireguard.exe /uninstalltunnelservice wgsent0`
7. **End session on chain:** `MsgCancelSessionRequest` (fire-and-forget, best-effort)
8. **Zero mnemonic:** `state._mnemonic = null`
9. **Clear connection state:** `state.connection = null`
10. **Clear persisted state:** Remove crash recovery files
11. **Flush DNS cache:** Clear stale speed test DNS entries
12. **Emit event:** `events.emit('disconnected', { ... })`

### End Session On-Chain

Message type: `/sentinel.session.v3.MsgCancelSessionRequest`

| Field # | Name | Type |
|---------|------|------|
| 1 | `from` | string (signer address) |
| 2 | `id` | uint64 (session ID) |

Gas: Fixed 200,000 gas, 20,000 udvpn fee.

This is fire-and-forget (never blocks disconnect). If the TX fails, it logs a warning. Unended sessions eventually expire on-chain, but ending them promptly is good practice.

### CRITICAL: Session Tracker (Chain Doesn't Store Payment Mode)

*(Source: Handshake dVPN -- built SessionTracker from scratch because this was undocumented)*

The Sentinel chain does NOT store whether a session was created with GB-based or hourly payment. After disconnect, there is no way to query the chain and determine the payment mode. Consumer apps MUST track this locally.

**What must be persisted per session:**

| Field | Source | Why |
|-------|--------|-----|
| `sessionId` | TX event extraction | Identify the session |
| `nodeAddress` | User selection | Reconnection |
| `paymentMode` | User choice ("gb" or "hourly") | Chain doesn't expose this |
| `gigabytes` or `hours` | User input | Allocation display |
| `priceUdvpn` | Node's `quote_value` | Cost tracking |
| `createdAt` | Local timestamp | Session age |

The SDK provides `session-tracker.js` for this. If not using the SDK module, persist to disk (e.g., `%LocalAppData%/AppName/sessions.json`). Clear on successful end-session TX.

**Why this matters:** Without local tracking, the app cannot:
- Show "Per GB" vs "Per Hour" on the session card
- Calculate remaining allocation correctly (GB remaining vs time remaining)
- Display cost information after reconnection

### Crash Cleanup

The SDK registers process handlers via `registerCleanupHandlers()`:

| Signal | Action |
|--------|--------|
| `exit` | Kill switch off, clear proxy, kill V2Ray, cleanup WireGuard |
| `SIGINT` (Ctrl+C) | Same + `process.exit(130)` |
| `SIGTERM` | Same + `process.exit(143)` |
| `uncaughtException` | Same + `process.exit(1)` |

On startup, `registerCleanupHandlers()` also:
- Calls `recoverOrphans()` to clean state-tracked orphans from previous crashes
- Calls `emergencyCleanupSync()` to remove any stale `wgsent*` WireGuard services
- Calls `killOrphanV2Ray()` to terminate abandoned V2Ray processes

**CRITICAL: `registerCleanupHandlers()` MUST be called before any `connect*()` function.** The SDK throws `INVALID_OPTIONS` if cleanup handlers are not registered, because an unregistered crash leaves WireGuard capturing all traffic with no way to recover.

---

## Appendix A: Every LCD Endpoint Path

### Sentinel v3 Endpoints

| Query | Method | Path | Notes |
|-------|--------|------|-------|
| Active nodes | GET | `/sentinel/node/v3/nodes?status=1&pagination.limit=5000` | Use `status=1`, not `STATUS_ACTIVE` |
| Single node | GET | `/sentinel/node/v3/nodes/{sentnode1...}` | Direct lookup, no pagination |
| Plan nodes | GET | `/sentinel/node/v3/plans/{planId}/nodes?pagination.limit=5000` | Pagination broken (next_key always null) |
| Plan by ID | GET | `/sentinel/plan/v3/plans/{planId}` | May return 501 on some endpoints |
| Plan subscribers | GET | `/sentinel/plan/v3/plans/{planId}/subscribers?pagination.limit=5000` | |
| Subscriptions (by account) | GET | `/sentinel/subscription/v3/accounts/{sent1...}/subscriptions` | **Account-scoped!** |
| Subscription by ID | GET | `/sentinel/subscription/v3/subscriptions/{id}` | |
| Sessions (by account) | GET | `/sentinel/session/v3/accounts/{sent1...}/sessions` | Add `&status=1` for active only |
| Session allocation | GET | `/sentinel/session/v3/sessions/{sessionId}/allocations` | May 404 for expired sessions |

### Sentinel v2 Endpoints (Still Active)

| Query | Method | Path | Notes |
|-------|--------|------|-------|
| Provider | GET | `/sentinel/provider/v2/providers/{sentprov1...}` | **Only provider remains v2** |

### Cosmos Standard Endpoints

| Query | Method | Path |
|-------|--------|------|
| Balance | GET | `/cosmos/bank/v1beta1/balances/{sent1...}` |
| Fee grants (for address) | GET | `/cosmos/feegrant/v1beta1/allowances/{sent1...}` |
| Authz grants | GET | `/cosmos/authz/v1beta1/grants?granter={addr}&grantee={addr}` |

### Node Direct API

| Query | Method | URL | Notes |
|-------|--------|-----|-------|
| Node status | GET | `https://{ip}:{port}/` | Returns moniker, location, peers, bandwidth |
| Handshake | POST | `https://{ip}:{port}/` | Session handshake (see Phase 8) |

---

## Appendix B: Every Error Code with Action

### Error Classes

| Class | Base | When |
|-------|------|------|
| `SentinelError` | `Error` | Generic SDK errors |
| `ValidationError` | `SentinelError` | Input validation failures |
| `NodeError` | `SentinelError` | Node-level failures |
| `ChainError` | `SentinelError` | Chain/transaction failures |
| `TunnelError` | `SentinelError` | Tunnel setup failures |
| `SecurityError` | `SentinelError` | Security policy violations |

### All 33 Error Codes

| Code | Severity | Trigger | User Message | Action |
|------|----------|---------|-------------|--------|
| `INVALID_OPTIONS` | fatal | Bad options object | "Invalid connection options provided." | Fix input, do not retry |
| `INVALID_MNEMONIC` | fatal | Bad mnemonic (<12 words) | "Invalid wallet phrase. Must be 12 or 24 words." | Fix input, do not retry |
| `INVALID_NODE_ADDRESS` | fatal | Bad sentnode1... address | "Invalid node address." | Fix input, do not retry |
| `INVALID_GIGABYTES` | fatal | gigabytes < 1 or > 100 | "Invalid bandwidth amount. Must be a positive number." | Fix input, do not retry |
| `INVALID_URL` | fatal | Malformed URL | "Invalid URL format." | Fix input, do not retry |
| `INVALID_PLAN_ID` | fatal | Non-numeric plan ID | "Invalid plan ID." | Fix input, do not retry |
| `NODE_OFFLINE` | retryable | Node unreachable or handshake failed | "This node is offline. Try a different server." | Try different node |
| `NODE_NO_UDVPN` | retryable | Node doesn't accept udvpn denom | "This node does not accept P2P tokens." | Try different node |
| `NODE_NOT_FOUND` | retryable | Node not on chain / address mismatch | "Node not found on chain. It may be inactive." | Try different node |
| `NODE_CLOCK_DRIFT` | retryable | VMess node with >120s clock drift | "Node clock is out of sync. Try a different server." | Try different node (or VLess node) |
| `NODE_INACTIVE` | retryable | Code 105 after retry | "Node went inactive. Try a different server." | Try different node |
| `NODE_DATABASE_CORRUPT` | retryable | HTTP 500 with sqlite errors | "Node has a corrupted database. Try a different server." | Try different node |
| `INVALID_ASSIGNED_IP` | retryable | Handshake returned bad IP/CIDR | "Node returned an invalid IP address during handshake. Try a different server." | Try different node |
| `INSUFFICIENT_BALANCE` | fatal | Wallet < 1.0 P2P | "Not enough P2P tokens. Fund your wallet to continue." | Fund wallet, do not retry |
| `BROADCAST_FAILED` | retryable | TX broadcast network error | "Transaction failed. Check your balance and try again." | Retry after delay |
| `TX_FAILED` | retryable | TX returned non-zero code | "Chain transaction rejected. Check balance and gas." | Check error, retry |
| `LCD_ERROR` | retryable | LCD query returned error code | "Chain query failed. Try again later." | Retry with fallback LCD |
| `UNKNOWN_MSG_TYPE` | fatal | Unregistered protobuf type | "Unknown message type. Check SDK version compatibility." | Update SDK |
| `ALL_ENDPOINTS_FAILED` | retryable | All LCD/RPC endpoints down | "All chain endpoints are unreachable. Try again later." | Wait and retry |
| `SESSION_EXISTS` | recoverable | Active session found for wallet+node | "An active session already exists. Use recoverSession() to resume." | Call `recoverSession()` |
| `SESSION_EXTRACT_FAILED` | recoverable | TX OK but no session ID in events | "Session creation succeeded but ID extraction failed. Use recoverSession()." | Call `recoverSession()` |
| `SESSION_POISONED` | fatal | Previously failed session reuse attempt | "Session is poisoned (previously failed). Start a new session." | Use `forceNewSession: true` |
| `V2RAY_NOT_FOUND` | infrastructure | v2ray.exe missing | "V2Ray binary not found. Check your installation." | Run `npm run setup` |
| `V2RAY_ALL_FAILED` | retryable | All V2Ray transports failed | "Could not establish tunnel. Node may be overloaded." | Try different node |
| `WG_NOT_AVAILABLE` | fatal | WireGuard not installed | "WireGuard is not available. Install it or use V2Ray nodes." | Install WireGuard |
| `WG_NO_CONNECTIVITY` | retryable | Tunnel installed but no traffic | "VPN tunnel has no internet connectivity." | Try different node |
| `TUNNEL_SETUP_FAILED` | retryable | Generic tunnel error | "Tunnel setup failed. Try again or pick another server." | Try different node |
| `TLS_CERT_CHANGED` | infrastructure | TOFU certificate mismatch | "Node certificate changed unexpectedly. This could indicate a security issue." | Investigate; clear TOFU store if intentional |
| `ABORTED` | -- | AbortController signal / disconnect during connect | "Connection was cancelled." | User-initiated; no action |
| `ALL_NODES_FAILED` | retryable | connectAuto exhausted all candidates | "All servers failed. Check your network connection." | Check network; increase maxAttempts |
| `ALREADY_CONNECTED` | -- | connect() called while connected | "Already connected. Disconnect first." | Call `disconnect()` first |
| `PARTIAL_CONNECTION_FAILED` | recoverable | Payment OK, tunnel failed | "Payment succeeded but connection failed. Use recoverSession() to retry." | Call `recoverSession()` |
| `CHAIN_LAG` | retryable | Session not confirmed on node | "Session not yet confirmed on node. Wait a moment and try again." | Wait 10s, retry |

### Severity Classification

| Severity | Meaning | Retry? | Action |
|----------|---------|--------|--------|
| `fatal` | User action required | No | Fix input, fund wallet, install dependency |
| `retryable` | Transient failure | Yes, different node | Use `connectAuto()` for automatic fallback |
| `recoverable` | Partial success | Yes, same session | Call `recoverSession()` to resume |
| `infrastructure` | System issue | No | Fix system state (install binary, check certs) |

### Usage

```javascript
import { ErrorCodes, ERROR_SEVERITY, isRetryable, userMessage } from 'sentinel-dvpn-sdk';

try {
  await connectDirect({ ... });
} catch (err) {
  console.log(err.code);                    // 'V2RAY_ALL_FAILED'
  console.log(err.name);                    // 'TunnelError'
  console.log(userMessage(err));            // 'Could not establish tunnel...'
  console.log(ERROR_SEVERITY[err.code]);    // 'retryable'
  console.log(isRetryable(err));            // true
  console.log(err.details);                 // { sessionId, nodeAddress, failedAt }
}
```

---

## Appendix C: Configuration That Silently Fails If Wrong

These are settings where an incorrect value produces NO error message -- the connection simply doesn't work, traffic doesn't flow, or data is silently wrong. Every one of these has caused real production failures.

### Protocol Configuration

| # | Setting | Correct Value | Wrong Value | What Happens |
|---|---------|--------------|-------------|-------------|
| 1 | VLess encryption | `"none"` | Any other string | Connection accepted but zero traffic flows |
| 2 | VLess flow field | **Omit entirely** | `""` or `"xtls-rprx-vision"` | V2Ray silently drops to fallback |
| 3 | VMess alterId | `0` | Any non-zero value | Authentication fails silently |
| 4 | VMess user security | **Omit from user object** | `"auto"` or `"aes-128-gcm"` | Config parsing fails silently |
| 5 | UUID field name | `"uuid"` | `"id"` | V2Ray cannot match incoming connection |
| 6 | grpc serviceName | `grpcSettings: { serviceName: '' }` | Omitting grpcSettings entirely | gRPC transport silently fails |
| 7 | QUIC security | `security: 'none'` | `security: 'chacha20-poly1305'` | QUIC handshake fails silently |
| 8 | gun vs grpc in V2Ray config | Both use `"network": "grpc"` with grpcSettings | Using `"network": "gun"` | V2Ray does not recognize "gun" network |

### Signature & Handshake

| # | Setting | Correct Value | Wrong Value | What Happens |
|---|---------|--------------|-------------|-------------|
| 9 | Signature input | `SHA256(BigEndian_uint64(sessionId) + raw_data_bytes)` | Using base64-encoded data string | Signature verification fails, 401 |
| 10 | Signature length | Exactly 64 bytes (r + s) | 65 bytes (with recovery byte) | Go `VerifySignature` returns false |
| 11 | Session ID in POST body | JavaScript Number (not BigInt) | BigInt | `JSON.stringify` throws TypeError |
| 12 | Public key encoding | `"secp256k1:" + base64(compressed_33_bytes)` | Uncompressed key (65 bytes) | Key format mismatch, rejected |

### Chain Queries

| # | Setting | Correct Value | Wrong Value | What Happens |
|---|---------|--------------|-------------|-------------|
| 13 | LCD API version | v3 paths (`/sentinel/node/v3/...`) | v2 paths | Returns "Not Implemented" |
| 14 | Provider API version | v2 path (`/sentinel/provider/v2/...`) | v3 path | Returns 501 |
| 15 | Status filter | `status=1` (integer) | `status=STATUS_ACTIVE` (string) | Returns wrong or empty results |
| 16 | Node type field | `service_type` (v3) | `type` (v2) | `undefined` -- no error, just missing data |
| 17 | Remote URL field | `remote_addrs` (array) | `remote_url` (string) | `undefined` -- all connections fail |
| 18 | Session data | `session.base_session.id` | `session.id` | `undefined` -- silent null propagation |
| 19 | Account address field | `acc_address` (v3) | `address` (v2) | `undefined` -- subscription parsing fails |
| 20 | Pagination | `limit=5000` single request | Trust `count_total` or `next_key` | Missing 400+ nodes silently |

### Tunnel Configuration

| # | Setting | Correct Value | Wrong Value | What Happens |
|---|---------|--------------|-------------|-------------|
| 21 | WireGuard config path (Windows) | `C:\ProgramData\sentinel-wg\` | User temp dir | SYSTEM service cannot read file -- silent fail |
| 22 | axios SOCKS5 adapter | `axios` with `adapter: 'http'` | Native `fetch` | Proxy agent silently ignored, direct connection |
| 23 | System proxy + SOCKS5 auth | `noauth` when systemProxy is true | Username/password auth | System proxy cannot pass credentials, zero traffic |
| 24 | SOCKS5 port reuse in fallback | Unique port per outbound | Same port | TIME_WAIT (120s on Windows) blocks connection |
| 25 | Full tunnel default in dev | `fullTunnel: false` for development | `fullTunnel: true` | AI's own internet dies (RPC/LCD/npm unreachable) |
| 26 | DNS before full tunnel | Pre-resolve hostnames BEFORE installing tunnel | Resolve after tunnel up | DNS fails through tunnel, speed test returns 0 |
| 27 | Cleanup handler registration | Call `registerCleanupHandlers()` before connect | Skip it | Crash leaves WireGuard 0.0.0.0/0 route -- dead internet |

### Consumer App Integration (from project findings)

*(Source: Handshake dVPN, Test2, Node Tester -- 22 discovered patterns)*

| # | Setting | Correct Value | Wrong Value | What Happens |
|---|---------|--------------|-------------|-------------|
| 28 | Price display field | `quote_value` (integer udvpn) | `base_value` (18-decimal sdk.Dec) | UI shows `52573.099722991367791000000000/GB` |
| 29 | Fee grant for direct-connect | Disabled / `feeGrant: false` | Auto-detect (assumes plan-based) | TX fails with invalid fee grant |
| 30 | Session creation for consumer apps | `forceNewSession: true` | Default (reuse existing) | Stale session 404 "does not exist" errors |
| 31 | V2Ray SOCKS5 HttpClient reuse | Fresh client per request | Reuse connections | Stale/empty responses, TLS disconnects |
| 32 | WireGuard pre-connect cleanup | Uninstall `wgsent0` before connect | Skip cleanup | New tunnel install fails silently |
| 33 | CancellationToken for speed test (C#) | `CancellationToken.None` | Pass parent CT | Speed test cancelled prematurely |
| 34 | Shared VPN client for testing | Dedicated test VPN instance | Share with main app | State corruption, tunnel leftovers |
| 35 | V2Ray "context canceled" after success | Ignore (normal cleanup) | Treat as error | False failure reporting |
| 36 | WPF emoji country flags | PNG images from flagcdn.com | Unicode emoji | Invisible flags (Windows limitation) |
| 37 | Country name normalization | 120+ variant map with fuzzy match | Exact string match | "The Netherlands" != "Netherlands" -> no flag |
| 38 | Plan endpoint v3 | May return 501 on some LCD endpoints | Assume always works | Unhandled 501, no plan data |
| 39 | JSON BigInt serialization | `sessionId.toString()` before JSON | `JSON.stringify({ id: 123n })` | `TypeError: Do not know how to serialize a BigInt` |
| 40 | Progress counter on error | Increment on ALL paths (success, error, cancel) | Only on success | UI freezes, appears stuck |
| 41 | Background refresh during test | Cancel refresh before starting test | Let refresh run | Chain client contention, connection timeouts |
| 42 | Node status check without wallet | ChainClient usable pre-login | Require wallet for all queries | Cannot load nodes before login |
| 43 | `PreferHourly` SDK option | Silently creates GB sessions (known bug) | Trust it works | Wrong session type, wrong billing |

---

## Appendix D: Complete Message Type URLs

All 22 registered protobuf message types in the CosmJS Registry:

### Consumer App Messages

| Operation | Type URL |
|-----------|----------|
| Start direct session | `/sentinel.node.v3.MsgStartSessionRequest` |
| End/cancel session | `/sentinel.session.v3.MsgCancelSessionRequest` |
| Start subscription | `/sentinel.subscription.v3.MsgStartSubscriptionRequest` |
| Start session via subscription | `/sentinel.subscription.v3.MsgStartSessionRequest` |
| Start session via plan | `/sentinel.plan.v3.MsgStartSessionRequest` |
| Cancel subscription | `/sentinel.subscription.v3.MsgCancelSubscriptionRequest` |
| Renew subscription | `/sentinel.subscription.v3.MsgRenewSubscriptionRequest` |
| Share subscription | `/sentinel.subscription.v3.MsgShareSubscriptionRequest` |
| Update subscription | `/sentinel.subscription.v3.MsgUpdateSubscriptionRequest` |
| Update session | `/sentinel.session.v3.MsgUpdateSessionRequest` |

### Operator/Provider Messages

| Operation | Type URL |
|-----------|----------|
| Register provider | `/sentinel.provider.v3.MsgRegisterProviderRequest` |
| Update provider details | `/sentinel.provider.v3.MsgUpdateProviderDetailsRequest` |
| Update provider status | `/sentinel.provider.v3.MsgUpdateProviderStatusRequest` |
| Create plan | `/sentinel.plan.v3.MsgCreatePlanRequest` |
| Update plan status | `/sentinel.plan.v3.MsgUpdatePlanStatusRequest` |
| Update plan details | `/sentinel.plan.v3.MsgUpdatePlanDetailsRequest` |
| Link node to plan | `/sentinel.plan.v3.MsgLinkNodeRequest` |
| Unlink node from plan | `/sentinel.plan.v3.MsgUnlinkNodeRequest` |
| Register node | `/sentinel.node.v3.MsgRegisterNodeRequest` |
| Update node details | `/sentinel.node.v3.MsgUpdateNodeDetailsRequest` |
| Update node status | `/sentinel.node.v3.MsgUpdateNodeStatusRequest` |

### Lease Messages (v1)

| Operation | Type URL |
|-----------|----------|
| Start lease | `/sentinel.lease.v1.MsgStartLeaseRequest` |
| End lease | `/sentinel.lease.v1.MsgEndLeaseRequest` |

---

## Appendix E: Timeouts Reference

| Operation | Timeout | Configurable | Notes |
|-----------|---------|-------------|-------|
| Handshake POST | 90,000ms | `timeouts.handshake` | Overloaded nodes need 60-90s |
| Node status GET | 12,000ms | `timeouts.nodeStatus` | Quick health check |
| LCD query | 15,000ms | `timeouts.lcdQuery` | Chain REST API |
| V2Ray port ready | 10,000ms | `timeouts.v2rayReady` | SOCKS5 port acceptance |
| WireGuard verify | 5,000ms per target | Hardcoded | 2 targets, 1 attempt |
| SOCKS5 connectivity test | 10,000ms | Hardcoded | Through V2Ray proxy |
| Post-payment wait | 5,000ms | Hardcoded | Node session indexing |
| Chain lag retry | 10,000ms | Hardcoded | Handshake 404 retry |
| Already-exists retry 1 | 15,000ms | Hardcoded | Session indexing race |
| Already-exists retry 2 | 20,000ms | Hardcoded | Final retry before fresh payment |
| V2Ray UUID registration | 5,000ms | Hardcoded | Post-handshake warmup |
| WireGuard peer registration | 1,500ms / 1,500ms / 2,000ms | Hardcoded | Exponential install retry |
| Sequence mismatch retry | 2,000ms / 4,000ms / 6,000ms / 6,000ms / 4,000ms | Hardcoded | Up to 5 retries + final |
| Node inactive retry | 15,000ms | Hardcoded | Code 105 stale LCD data |
| Circuit breaker TTL | 300,000ms (5 min) | `configureCircuitBreaker()` | Node skip duration |
| Node cache TTL | 300,000ms (5 min) | Hardcoded | Background refresh |
| Dynamic rate TTL | 604,800,000ms (7 days) | Hardcoded | Transport success rates |
| Inter-TX spacing | 7,000ms minimum | Manual | Prevent sequence mismatch |

---

## Appendix F: Quick Start (Minimal Working Code)

```javascript
import {
  registerCleanupHandlers,
  quickConnect,
  disconnect,
  events,
} from 'sentinel-dvpn-sdk';

// Listen to events
events.on('progress', ({ event, detail }) => console.log(`[${event}] ${detail}`));
events.on('connected', ({ serviceType, nodeAddress }) => {
  console.log(`Connected via ${serviceType} to ${nodeAddress}`);
});

// One-call connection (handles everything)
const conn = await quickConnect({
  mnemonic: process.env.SENTINEL_MNEMONIC,
  countries: ['DE', 'NL'],         // Preferred countries
  serviceType: 'v2ray',            // 'wireguard' | 'v2ray' | null
  maxAttempts: 3,                   // Try up to 3 nodes
  fullTunnel: true,                 // Route all traffic through VPN
  onProgress: (step, detail) => console.log(`[${step}] ${detail}`),
});

console.log(`Session: ${conn.sessionId}`);
console.log(`Type: ${conn.serviceType}`);
if (conn.socksPort) console.log(`SOCKS5: 127.0.0.1:${conn.socksPort}`);
if (conn.vpnIp) console.log(`VPN IP: ${conn.vpnIp}`);

// ... use VPN ...

// Disconnect
await disconnect();
```

`quickConnect()` automatically:
1. Calls `registerCleanupHandlers()` (idempotent)
2. Verifies dependencies (V2Ray, WireGuard)
3. Selects best node based on quality scoring
4. Connects with automatic fallback
5. Verifies IP changed

For more control, use `connectDirect()` (specific node) or `connectAuto()` (auto-fallback without quickConnect's dependency check overhead).

---

## Appendix G: Consumer App Integration Patterns

*(Source: Handshake dVPN retrospective, Test2 proving ground, Node Tester 780+ node scans)*

These patterns were discovered through 165+ hours of production debugging across 8 consumer apps. Every pattern listed here caused real failures.

### Dedicated Test VPN Instance (CRITICAL)

*(Source: Handshake dVPN -- 2 hours debugging state corruption)*

**NEVER share the main VPN client with a test/audit feature.** Create a fresh VPN client per test node:
- Main app VPN: user's active connection, managed by UI
- Test VPN: dedicated instance per test, disposed after each node
- The two must share NO state (no shared chain client, no shared tunnel, no shared session)

In C#: `new SentinelVpnClient()` per test. In JS: separate `connectDirect()` call with independent options.

### CancellationToken Architecture (C#)

*(Source: Handshake dVPN -- 1 hour debugging premature cancellation)*

| Operation | CancellationToken | Why |
|-----------|------------------|-----|
| Outer test loop (between nodes) | Pass `ct` | Check between nodes, stop cleanly |
| Speed test (once started) | `CancellationToken.None` | Let it complete, don't waste the session |
| Google connectivity check | `CancellationToken.None` | Let it complete |
| Background refresh | Cancel BEFORE starting test | Prevent chain client contention |

Use `volatile bool _stopRequested` as an additional stop signal -- CancellationToken alone is NOT sufficient because SDK async operations don't respond to cancellation mid-flight.

### In-App Node Testing (Level 2)

*(Source: Handshake dVPN AI-NODE-TEST-INTEGRATION spec)*

Two levels of testing exist:
- **Level 1 (CLI/Browser):** Tests raw protocol (handshake, V2Ray config, transport). Finds SDK bugs.
- **Level 2 (In-App):** Tests the APP's own `connect()`/`disconnect()`. Finds integration bugs.

Level 2 is a thin orchestrator:
1. Gets node list via the app's own API
2. For each node: calls the app's `ConnectDirectAsync()` (not raw SDK)
3. Runs connectivity check + speed test through the tunnel
4. Calls the app's `Disconnect()`
5. Records the result

**It does NOT reimplement handshake/tunnel logic.** The app is the black box.

### Bandwidth Optimization for Consumer Apps

*(Source: Handshake dVPN -- measured actual bandwidth)*

| Poll Type | Interval | Cost | Notes |
|-----------|----------|------|-------|
| Status poll (is tunnel alive?) | 3s | FREE (in-memory) | No chain call |
| Allocation check (bytes remaining) | 120s | ~2KB chain query | Node posts to chain every ~5min |
| IP check (am I still on VPN?) | 60s | ~0.5KB to ipify.org | Detect tunnel drops |
| Balance check | 5min | ~2KB chain query | Doesn't change mid-session |
| Total daily overhead when connected | -- | ~3MB | Negligible |

### The 6 Questions Every Feature Must Answer

*(Source: Handshake dVPN retrospective)*

1. Does it work on first use? (New user, no data)
2. Does it work on return visit? (Data exists from previous session)
3. Does it work after restart? (App closed, reopened)
4. Does it work after failure? (Crash, network error, cancel)
5. Can the user share the output? (Export, copy)
6. Can the user investigate issues? (Click, expand, filter, sort)

### Country Flag Rendering

*(Source: Handshake dVPN -- 2 hours discovering WPF limitation)*

| Platform | Method | Notes |
|----------|--------|-------|
| Web/Electron | `String.fromCodePoint()` emoji | Works in all browsers |
| WPF (.NET) | PNG images from `flagcdn.com/w40/{code}.png` | WPF CANNOT render emoji flags |
| macOS/iOS (Swift) | Native emoji in NSImage/UILabel | Works natively |

For WPF: three-layer cache (memory -> disk -> download). Cache permanently (flags don't change). Requires 120+ country name variant map with fuzzy matching (e.g., "The Netherlands" -> NL, "Turkiye"/"Turkey" -> TR).

### Results Must Survive Restarts

*(Source: Handshake dVPN, Node Tester -- both had blank dashboards after restart)*

- On app startup, load cached results from disk BEFORE rendering any UI
- Save results to disk every N nodes (5 recommended) AND on completion AND on stop
- Users will force-kill your app -- don't lose 50 results because you only save at the end
- NEVER show "No results yet" when results exist on disk
- Handle corruption gracefully (reset to empty on parse error, don't crash)
- Cap stored results at 2000 entries to prevent unbounded growth
