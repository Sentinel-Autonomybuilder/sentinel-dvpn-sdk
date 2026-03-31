# SDK Changelog, Fixes & Danger Warnings

Every fix made during SDK creation, why it matters, and what happens if you use upstream Sentinel code directly without these fixes.

## Documentation Versions

| Version | Date | Changes |
|---------|------|---------|
| v1 | 2026-03-06 | Initial SDK docs — 16 doc files, 6 code files |
| v2 | 2026-03-07 | Added tutorials.md, benchmarks.md, migration-v2-v3.md. Score 96/100 |
| v3 | 2026-03-07 | 35 AI-readiness gaps identified (8 blockers, 11 high, 16 medium/low) |
| v4 | 2026-03-08 | Deep failure analysis: 6 code bugs fixed, 6 docs updated. Score 98/100 |
| v5 | 2026-03-08 | All 8 blockers + all 11 highs + all mediums/lows addressed. Score 100/100 |
| v6 | 2026-03-08 | AI validation fix: `remote_addrs` vs `remote_url` LCD field name mismatch |
| v7 | 2026-03-08 | Comprehensive re-audit: session nesting fix, httpbin.org removal, waitForPort in examples, taskkill /IM warnings, base_session docs |
| v8 | 2026-03-08 | **Pre-validation + auto-detection**: `findV2RayExe()` searches system for existing v2ray.exe before demanding download. `validateTunnelRequirements()` runs BEFORE paying. |
| v9 | 2026-03-08 | **Tunnel verification**: `installWgTunnel()` now verifies service reaches RUNNING state (catches silent failures). `setupWireGuard()` verifies actual connectivity through tunnel. `connectDirect()` NEVER returns success unless traffic flows. |
| v10 | 2026-03-08 | **Full overhaul from AI builder feedback (Test1)**: `fullTunnel: true` default, stale session auto-retry, V2Ray auto system proxy, `onProgress`/`opts.log`, kill v2ray by PID, WG config→ProgramData, `checkPortFree()`, V2Ray orphan cleanup, all docs updated |
| v11 | 2026-03-08 | **Deep feedback round 2**: `forceNewSession` option for shared wallets, `queryOnlineNodes()` quality scoring (WG>V2Ray, drift penalty, peer count), shared wallet docs in known-issues.md, "Using Primitives Directly" section in end-to-end, `qualityScore` field in node results |
| v12 | 2026-03-08 | **Plug-and-play**: `index.js` single entry point, `setup.js` auto-downloads V2Ray/checks WG, `state.js` crash recovery with `saveState`/`loadState`/`recoverOrphans`, `package.json` gets `main`/`bin`/`scripts`, `disconnect()` clears state, `registerCleanupHandlers()` auto-recovers orphans, `buildV2RayClientConfig()` auto-filters grpc/tls outbounds (0% success rate) |
| v13 | 2026-03-08 | **Session tracking + PID files**: Poisoned session tracking (`markSessionPoisoned`/`isSessionPoisoned`) — `findExistingSession` auto-skips failed sessions, no more P2P waste on retry loops. PID file helpers (`writePidFile`/`checkPidFile`/`clearPidFile`) for server process management. All docs updated to use `index.js` imports (`connect`, `listNodes`). Express pattern shows PID file usage |
| v14 | 2026-03-08 | **Deep review fixes**: VMess/VLess clock drift intelligence (flag in connectDirect, post-handshake VLess check in setupV2Ray, VMess-only+drift>120s fails fast). Pre-connection TCP port probe skips dead outbound ports in 3s. README quickstart updated to `index.js`+`setup.js`+`listNodes`. Benchmarks updated to 708-node data. v2ray-config.md transport_security enum fully documented. plan-lifecycle.md WARNING about inactive default. PREFLIGHT.md references setup.js |
| v15 | 2026-03-08 | **Cold-start audit + critical bug fix**: Fixed `opts.nodeAddress` ReferenceError crash in `setupV2Ray()` — V2Ray connections would crash after tunnel setup. Fixed `require('http')` in ESM `setup.js`. README rewritten with "Zero to VPN" getting-started. PREFLIGHT.md adds wallet/funding checklist. Import path clarified. `nodeAddress` properly threaded through `tunnelOpts→performHandshake→setupV2Ray` |
| v16 | 2026-03-08 | **Hardcoded defaults + endpoint fallback**: New `defaults.js` — single source of truth for all static values with timestamps. Auto-fallback through 5 RPC and 4 LCD endpoints. Known broken nodes auto-filtered. README "Hardcoded Defaults" section. Prepared for future RPC query server |
| v17 | 2026-03-08 | **Testing documentation + example scripts**: New `testing.md` — complete testing methodology from 708-node scan (parallel scanning, batch payment, transport fallback, speed testing, error classification, result structure, all constants). New `js-sdk/examples/probe.js` (single-node diagnostic) and `js-sdk/examples/diagnose.js` (batch N WG + N V2Ray test). README updated with 13 code files, examples section, testing topic in index |
| v18 | 2026-03-08 | **npm-ready + test suite + 5 bug fixes + 4 doc fixes**: Full npm packaging (`npm install sentinel-dvpn-sdk`). `package.json` with exports map, engines, keywords, files, repository, license. MIT license. `.npmignore` for clean 46KB package. `postinstall` auto-runs `setup.js`. `SDK_VERSION` export. 190-assertion smoke test suite (`npm test`). `dotenv` moved to devDependency. **Bug fixes:** (1) `BigInt(null)` crash in node-connect.js, (2) `protoInt64` dropped BigInt zero `0n`, (3) `wg-quick` detection broken, (4) `checkIsAdmin` Windows-only, (5) `emergencyCleanupSync` no-op on Linux/macOS. **Doc fixes:** (1) grpc/tls "auto-filtered" → "auto-removed unless sole transport", (2) "exponential backoff" → "linear backoff", (3) `fetch()` in pricing.md/migration-v2-v3.md → `axios`, (4) tutorials.md `remote_url` clarified with `fetchActiveNodes()` resolution comment, httpbin removed from testing.md targets |
| v19 | 2026-03-09 | **Security hardening + command injection + key zeroing**: All 27 `execSync` template calls → `execFileSync` with argument arrays. State file validation (`validateStateValues`). WireGuard conf ACL on directory. WG private key zeroed after config write. Empty security catches now log warnings. Configurable timeouts (`opts.timeouts`). CosmJS types in TypeScript. Registry backup/restore for system proxy. Input validation at API boundary. 206-assertion test suite |
| v20 | 2026-03-09 | **Architecture overhaul (Meta + DARPA/NSA audit fixes)**: (1) **Typed errors** — `SentinelError`, `ValidationError`, `NodeError`, `ChainError`, `TunnelError`, `SecurityError` with machine-readable `.code` and `.details`. `ErrorCodes` constants. (2) **TOFU TLS** — Trust-On-First-Use certificate pinning for node connections (`tls-trust.js`). Eliminates MITM attack on handshake (was DARPA #1 finding, CVSS 9.1). (3) **EventEmitter** — `events` export emits `connecting`, `connected`, `disconnected`, `error`, `progress`, `log`. No more polling `getStatus()`. (4) **AbortController** — `opts.signal` cancels in-progress connections at any step. (5) **Key zeroing** — Cosmos private key (`privKey.fill(0)`) zeroed after handshake, WG key zeroed after config write. (6) **Code dedup** — `connectInternal()` shared flow eliminates 80% duplication between `connectDirect`/`connectViaPlan`. (7) **Structured logging** — `progress()` emits structured `{ event, detail, ts }` objects via EventEmitter. 108 exports, 251-assertion test suite |
| v21 | 2026-03-09 | **Performance + SentinelClient class (Telegram audit fixes)**: (1) **Reduced sleeps** — WG: exponential retry at 1.5s/3s/5s instead of flat 5s. V2Ray: 2s instead of 5s (outbound loop has own checks). Saves 3-6s per connection. (2) **Parallel setup** — wallet+privKey in Promise.all, RPC+LCD in Promise.all, balance fire-and-forget. Saves 2-4s. (3) **Wallet cache** — `cachedCreateWallet()` keyed by SHA256(mnemonic). Saves 300ms on reconnect. (4) **Node list cache** — `queryOnlineNodes()` cached 5min with background refresh. Instant repeat calls. (5) **SentinelClient class** — Instantiable wrapper with per-instance EventEmitter, DI, cached wallet/client. See `CHANGES-v21.md` for full debugging guide. 109 exports, 275-assertion test suite |
| v22 | 2026-03-09 | **V2Ray config fixes from 780-node test**: (1) **QUIC fix** — global+per-outbound `quicSettings` changed from `chacha20-poly1305` to `security: 'none'` matching sentinel-go-sdk server. Was 0/4 (0%). (2) **v2-format metadata mapping** — nodes returning v2 fields mapped to v3 equivalents instead of throwing. Recovers TCSR-Station (48 peers). (3) **Transport priority** — sort order from 780-node data: grpc/none 58→87%, QUIC last. (4) **Handshake timeout** — 30s→45s for distant/loaded nodes. (5) **defaults.js rates** — updated to 780-node data. (6) **extremeDrift VLess preference** — outbounds re-sorted to put VLess before VMess when drift >120s. 109 exports, 289-assertion test suite |

---

## CRITICAL FIXES (Will cause silent failures or data loss)

### -1. Pre-validation + Auto-detection: Binary/Driver Check Before Payment — ADDED (v8)

**What we changed:** Added `findV2RayExe()` and `validateTunnelRequirements()` to `node-connect.js`. Both `connectDirect()` and `connectViaPlan()` call validation BEFORE broadcasting any payment TX.

**Auto-detection:** Instead of just checking the provided path, `findV2RayExe()` searches the entire system for an existing v2ray.exe installation:
1. Explicit path passed by caller
2. `bin/v2ray.exe` relative to CWD
3. Other Sentinel project directories on Desktop (`sentinel-node-tester/bin/`, `web-proxy/bin/`)
4. Standard install locations (`C:\Program Files\V2Ray\`, `/usr/local/bin/`)
5. `V2RAY_PATH` environment variable
6. System PATH (`where v2ray.exe` / `which v2ray`)

If found elsewhere, it logs `"V2Ray binary found at: <path> (auto-detected)"` and uses it — no redundant download. WireGuard already had equivalent detection in `wireguard.js` (searches Program Files, PATH, `WIREGUARD_PATH` env). If nothing found anywhere, throws with clear error. No P2P spent either way.

**What the code did before v8:** `connectDirect()` paid for a session (broadcast TX → P2P deducted) BEFORE checking if the tunnel binary existed. For V2Ray nodes, it would create a session, try to spawn a non-existent `v2ray.exe`, fail with ENOENT or "All V2Ray transport/protocol combinations failed", and the user's P2P was gone with no tunnel.

**Why it's dangerous:** Every failed V2Ray connection attempt burned P2P tokens. An app with no `bin/v2ray.exe` would hemorrhage P2P — paying for sessions it could never use. Two separate AIs built apps from this SDK and BOTH had this failure mode: wallet/nodes/UI worked fine, but clicking "Connect" either silently wasted P2P or threw cryptic errors. The connection — the ONLY thing that matters — was broken from day one.

**Found by:** Two independent app builds (Antigravity/Gemini, Test1) both failed at the connection step despite having correct handshake/signing code. Root cause was identical: missing V2Ray binary.

### 0. LCD `remote_addrs` vs `remote_url` — RESOLVED (v6)

**What we changed:** Added `resolveNodeUrl(node)` to cosmjs-setup.js. `fetchActiveNodes()` now adds a computed `remote_url` field to each node. lcd-endpoints.md updated to show the real field name.

**What the LCD actually returns:** `remote_addrs: ["185.47.255.36:52618"]` — an array of `"IP:PORT"` strings with NO `https://` protocol prefix.

**What the docs showed before v6:** `remote_url: "https://IP:PORT"` — a string with protocol prefix. This field does not exist in the v3 LCD response.

**Why it's dangerous:** Code that reads `node.remote_url` from raw LCD data gets `undefined`. All `nodeStatusV3()` calls fail with timeouts/errors. Result: **0 node connections**, with misleading "timeout" errors that look like the nodes are offline when the real problem is the URL is undefined.

**Found by:** Another AI (Gemini) building a complete app from the SDK docs. Initial result was 0/10 connections. After the AI independently discovered the field name mismatch, it achieved 9/10.

### 1. V2Ray Balancer Session Poisoning — REMOVED

**What we changed:** `buildV2RayClientConfig()` in v3protocol.js no longer generates a `leastping` balancer. It routes directly to the highest-priority outbound.

**What the upstream code does:** The official sentinel-go-sdk `client.json.tmpl` uses a leastping balancer with observatory. The V2Ray 5.2.1 binary supports this.

**Why it's dangerous:** When V2Ray connects to a node via transport A (e.g., grpc), gets killed, then reconnects via transport B (e.g., tcp) with the same UUID, the node has a stale VMess/VLess session from transport A. The balancer silently picks whichever transport "won" the latency probe — which may be the stale one. Result: connection opens, zero data flows, no error message. We saw this on 40%+ of V2Ray reconnections during testing.

**What happens if you revert:** Intermittent silent failures. Speed tests return 0 Mbps with no error. Appears to work on first connection but fails on subsequent ones.

**The fix:** Test each outbound individually with a fresh V2Ray process per attempt. Kill v2ray, wait 2s for port release, write config with single outbound, spawn new process, test connectivity. First working outbound wins.

---

### 2. Windows TIME_WAIT Port Cascading — ROTATING PORTS

**What we changed:** SOCKS port rotates: `10800 + Math.floor(Math.random() * 1000)`. API port rotates: `10000 + Math.floor(Math.random() * 50000)`.

**What upstream code does:** sentinel-go-sdk uses fixed ports (1080 SOCKS, 2080 API).

**Why it's dangerous:** When V2Ray binds port 1080 and gets killed (or crashes), Windows keeps the port in TIME_WAIT for ~240 seconds. Next V2Ray launch on port 1080 fails: `"bind: Only one usage of each socket address"`. Every subsequent test fails until the port frees. In a testing scenario with 400+ nodes, this cascades into dozens of false failures.

**What happens if you revert:** On Windows, any V2Ray restart within 4 minutes of the previous one fails. On Linux this is less severe (TIME_WAIT is shorter) but still possible.

---

### 3. Native `fetch()` Silently Ignores SOCKS5 Proxy

**What we changed:** All speed tests and proxy-routed HTTP use `axios` with `socks-proxy-agent`, never native `fetch()`.

**What upstream/naive code does:** Node.js `fetch(url, { agent })` — the agent option is silently ignored by native fetch.

**Why it's dangerous:** Your speed test appears to work perfectly — but the traffic bypasses the VPN entirely and goes through your direct internet connection. You measure your own ISP speed, not the VPN. No error, no warning. We discovered this when "VPN speeds" matched raw connection speeds exactly.

**What happens if you revert:** All speed measurements are wrong. You'll report your ISP speed as VPN speed. Connectivity tests pass even when the tunnel is broken.

---

### 4. WireGuard Tunnel Cleanup — EMERGENCY HANDLERS

**What we changed:** `registerCleanupHandlers()` installs exit/SIGINT/SIGTERM/uncaughtException handlers that call `emergencyCleanupSync()`. Also runs cleanup on startup (kills stale tunnels from previous crash).

**What upstream code doesn't do:** No crash recovery. If your app crashes with an active WireGuard tunnel, the tunnel stays installed. On Windows, `AllowedIPs = 0.0.0.0/0` routes ALL traffic through the dead tunnel. Result: **total internet death** until you manually uninstall the tunnel service.

**What happens if you skip this:** One crash = no internet. Users must open Services, find `WireGuard Tunnel: wgsent0`, stop and delete it manually. Non-technical users will think their computer is broken.

---

### 5. Signature Must Be Exactly 64 Bytes

**What we changed:** `sig.toFixedLength().slice(0, 64)` — strip recovery byte.

**What happens with 65 bytes:** Go's `VerifySignature` on the node checks `len(sig) != 64` and returns false. Handshake fails with HTTP 403 "signature verification failed". No explanation in error message about why.

**What upstream docs say:** The Go SDK uses `crypto/ecdsa` which handles this natively. The JavaScript `@cosmjs/crypto` Secp256k1 returns 65 bytes (r + s + recovery). Every JS implementation must strip the last byte.

---

### 6. VMess Clock Drift > 120s = Silent Auth Failure

**What we changed:** `nodeStatusV3()` measures clock drift from the HTTP `Date` header. `connectDirect()` rejects V2Ray nodes with |drift| > 120s.

**What upstream code doesn't do:** No clock check. VMess AEAD authentication uses the client's timestamp. If the node's clock differs by more than 120 seconds, auth silently fails. The connection opens, the handshake succeeds, but no data flows.

**What happens if you skip this:** ~5-10% of V2Ray nodes have drifted clocks. You'll spend hours debugging "why does the handshake succeed but speed test returns 0?" — it's always clock drift for VMess nodes. VLess is unaffected (no timestamp auth).

---

## HIGH SEVERITY FIXES (Will cause TX failures or incorrect behavior)

### 7. `max_price` Must Be Passed in Direct Session TX

**What we changed:** `connectDirect()` now fetches the node's `gigabyte_prices` from LCD and passes the exact price as `max_price` in `MsgStartSessionRequest`.

**What happens without it:** The chain may reject the TX or use a default that doesn't match the node's price. Some nodes have multiple price denoms — you must specify which one.

---

### 8. `encodeDuration()` Was Never Defined

**What we changed:** Created `encodeDuration({ seconds, nanos })` in plan-operations.js. Also added to protobuf-encoding.md.

**What the upstream SDK provides:** The Go SDK handles Duration encoding via protobuf code generation. The JS SDK had no equivalent. The `MsgCreatePlanRequest` encoder referenced `encodeDuration()` but the function didn't exist anywhere.

**What happens without it:** Anyone trying to create a plan gets `ReferenceError: encodeDuration is not defined`. Complete blocker for the plan management flow.

---

### 9. `@cosmjs/encoding` Was Missing from Dependencies

**What we changed:** Added `@cosmjs/encoding` to package.json.

**Why it matters:** `fromBech32()` and `toBech32()` are required for address prefix conversion (sent ↔ sentprov ↔ sentnode). Without this package, any provider/plan operation fails because you can't construct the `sentprov` address.

---

### 10. Provider LCD Endpoint is v2, Not v3

**What we documented:** `/sentinel/provider/v2/providers` — NOT v3.

**What happens with v3:** HTTP 501 "Not Implemented". The v3 provider gRPC-gateway routes were never registered on the LCD. This is an upstream chain issue (sentinelhub v12.0.0). If you follow the pattern of other endpoints (all v3), you'll get 501 for providers.

---

### 11. Plan Query Endpoints Return 501

**What we documented:** `/sentinel/plan/v3/plans` returns 501 Not Implemented.

**Why this matters:** You cannot query plan details (bytes, prices, duration, private flag) via LCD REST API. The gRPC service exists in chain source but the gateway routes are not registered. Plan discovery must happen through subscription events or off-chain data.

---

### 12. UUID is Integer Byte Array, NOT String

**What we changed:** Documented and coded: V2Ray handshake sends `{ uuid: [0x12, 0x34, ...] }` — an array of 16 integers, not a UUID string.

**What happens with a string:** The node's Go code unmarshals `uuid` as `[]byte`. A JSON string would be decoded differently than an integer array. The handshake succeeds but V2Ray can't authenticate because the UUID doesn't match.

---

### 13. `Secp256k1.makeKeypair` vs `nobleSecp.getPublicKey`

**What we fixed:** node-handshake.md was referencing `@cosmjs/crypto`'s `Secp256k1.makeKeypair()` but the actual production code uses `@noble/curves/secp256k1`'s `getPublicKey(privKey, true)`.

**Why it matters:** `Secp256k1.makeKeypair` is async and returns `{ pubkey, privkey }`. `nobleSecp.getPublicKey` is sync and returns the pubkey directly. Mixing these up causes type errors or incorrect key encoding.

---

## MEDIUM SEVERITY FIXES

### 14. `node.exe` Kill Protection

**NEVER run `taskkill /F /IM node.exe`** on Windows. This kills your own Node.js process, Claude Code, VS Code terminals, and anything else running on Node. Kill V2Ray by image name (`v2ray.exe`) or specific processes by PID only.

### 15. Removed Unused `dotenv` from SDK Dependencies

SDK code files never import dotenv. It's an app-level concern. Including it in SDK deps implies the SDK handles .env loading, which it doesn't.

### 16. `grpc/tls` Has 0% Success Rate

From 400+ node tests: grpc with TLS security NEVER works. grpc/none works ~58% of the time. If your transport selection doesn't deprioritize grpc/tls, you'll waste time on connections that will never succeed.

### 17. Plan-lifecycle.md Referenced Undefined `lcd()` Helper

The doc used `await lcd('/sentinel/...')` as a function call, but no such helper existed in any code file. Replaced with actual `axios.get()` calls.

---

## IMPROVEMENTS MADE

| # | Improvement | Impact |
|---|-------------|--------|
| 1 | Created `cosmjs-setup.js` — wallet, registry, signing client, all 13 msg types | Can now send ANY Sentinel TX from one import |
| 2 | Created `plan-operations.js` — 10 encoder functions + proto primitives | Plan management was impossible without this |
| 3 | Created `node-connect.js` — full connect orchestration | 30-line quickstart instead of 300+ lines of glue code |
| 4 | Exported proto primitives from plan-operations.js | Others can build custom encoders without duplicating code |
| 5 | Added `MSG_TYPES` constant with all 13 type URLs | No more copy-pasting long type URL strings |
| 6 | Added `broadcast()` helper with default fee | Eliminates gas estimation round-trip |
| 7 | Added `fetchActiveNodes()` with pagination | Properly handles 900+ nodes across multiple LCD pages |
| 8 | Auto-resolve speedtest IPs for WireGuard split tunnel | WireGuard now auto-configures safe split tunneling |
| 9 | `connectViaPlan()` returns `subscriptionId` | Can manage subscription after connection |
| 10 | Transport priority sort by real success rates | tcp/ws first (100%), grpc/tls last (0%) |
| 11 | Windows setup guide with exact binary versions/URLs | No guessing which V2Ray version or where to get it |
| 12 | Networking stack explanation (WireGuard vs V2Ray flows) | Understand what happens at each layer |
| 13 | Added `createSafeBroadcaster()` — mutex + retry | Prevents sequence mismatch on rapid TXs |
| 14 | Added `parseChainError()` — 13+ error patterns | User-friendly errors instead of raw chain logs |
| 15 | Added `lcd()` helper — LCD REST with error checking | Consistent query pattern, checks gRPC codes in body |
| 16 | Added `discoverPlanIds()` — plan discovery workaround | Works around 501 on /plan/v3/plans endpoint |
| 17 | Added `getDvpnPrice()` — CoinGecko with 5-min cache | USD cost estimation for UX |
| 18 | Created `advanced-patterns.md` — batch TX, auto-lease, session mgmt | Production reliability patterns documented |
| 19 | Updated `findExistingSession()` — uses lcd() + base_session | Correct session nesting, consistent HTTP client |
| 20 | Updated `fetchActiveNodes()` — uses lcd() helper | Consistent error handling across all LCD queries |

---

## VERSION LOCKS (Do Not Upgrade Without Testing)

| Dependency | Locked Version | Why |
|------------|---------------|-----|
| V2Ray | **5.2.1 exactly** | v5.44.1 has observatory bugs that break leastping (even though we removed balancer, future users might add it back) |
| CosmJS | **0.32.x** | v0.33+ may change Registry API or signing behavior |
| sentinelhub | **v12.0.0** | Message type URLs and field numbers are chain-version-specific |
| Node.js | **20+ LTS** | crypto.randomUUID() requires Node 19+, ESM import requires 14+ |

---

## DANGER: Importing Code Directly from Sentinel GitHub

If you clone sentinel-official repos and try to use their code directly:

1. **sentinel-go-sdk** — Go code. Cannot be used in JavaScript. The `client.json.tmpl` is a Go template, not valid JSON. You must understand the template variables and translate.

2. **sentinel-js-sdk** — Limited v3 support. Most message types are not implemented. Uses older CosmJS patterns. Does not handle the v3 handshake protocol.

3. **dvpn-node** — Server-side Go code. Useful for understanding the handshake protocol, but you'll need to reverse-engineer the request/response format from Go structs.

4. **hub** — Proto definitions. If you try to use `protoc` codegen, you'll need the entire Cosmos SDK proto tree. Our manual encoding approach avoids this entirely.

The safest path is using this SDK's code files, which have been tested against 400+ live nodes on the actual chain.

---

## FIXES FROM DEEP FAILURE ANALYSIS (March 2026)

Deep inspection of 26 node test failures (SOCKS5 no connectivity, fetch failed, ETIMEDOUT) revealed 6 bugs across the SDK. All fixed.

### 21. Axios "fetch failed" — Force HTTP Adapter

**What we changed:** Added `axios.defaults.adapter = 'http'` to v3protocol.js, speedtest.js, and node-connect.js.

**Root cause:** On Node.js v18+, axios 1.7+ includes `fetch` (undici) in its default adapter list. Undici throws opaque `"fetch failed"` for ALL network errors — ECONNREFUSED, ETIMEDOUT, ENOTFOUND are collapsed into one useless string. The `http` adapter preserves error codes.

**Impact:** 10 out of 26 failures showed as bare `"fetch failed"` with zero diagnostic context. The actual cause was CosmJS using native fetch for RPC calls during broadcast.

**What happens if you revert:** Opaque error messages. Network failures are undiagnosable. You can't tell if a node is offline, DNS failed, or the RPC endpoint is down.

### 22. V2-Format Metadata Detection

**What we changed:** `buildV2RayClientConfig()` now detects old v2 metadata format (`{port, protocol, ca, tls}`) and throws immediately instead of silently building a broken config.

**Root cause:** Some nodes still run old software returning v2 metadata. `proxy_protocol` is undefined → defaults to vmess, `transport_protocol` is undefined → defaults to tcp. The config "builds" but routes nothing.

**Impact:** 1 out of 26 failures. The node appeared to have a working SOCKS5 proxy that just couldn't reach the internet.

**What happens if you revert:** Silent config generation. V2Ray starts, SOCKS5 port opens, but traffic is black-holed because the outbound config doesn't match what the node expects.

### 23. Handshake Error Wrappers — Include errno

**What we changed:** Both `initHandshakeV3()` and `initHandshakeV3V2Ray()` catch blocks now include `err.code` (ECONNREFUSED, ETIMEDOUT, etc.) alongside HTTP status.

**Before:** `"Node handshake failed (HTTP undefined): fetch failed"` — useless.
**After:** `"Node handshake failed (HTTP undefined, ECONNREFUSED): connect ECONNREFUSED 1.2.3.4:443"` — actionable.

### 24. SOCKS5 Readiness Probe (waitForPort)

**What we changed:** Added `waitForPort()` — TCP port probe that replaces fixed `sleep(6000)` before SOCKS5 testing. Returns when the port is accepting connections or times out.

**Root cause:** V2Ray SOCKS5 binding takes variable time (2-8s+). Fixed sleep was either too short (false failure) or too long (wasted time).

**Impact:** 15 SOCKS5 "no internet connectivity" failures included nodes where V2Ray wasn't ready when the test ran.

### 25. Connectivity Retry in speedtest.js Phase 0

**What we changed:** Phase 0 (Google/Cloudflare/1.1.1.1 HEAD check) now retries once after a 3-second pause if all targets fail.

**Root cause:** Even after `waitForPort()` confirms SOCKS5 is listening, the proxy pipeline may not be fully warmed up. A single retry catches this.

### 26. node-connect.js — Replace httpbin.org with Reliable Targets

**What we changed:** `setupV2Ray()` connectivity test now uses `https://www.google.com` and `https://www.cloudflare.com` (HEAD requests) instead of `https://httpbin.org/ip` (GET).

**Root cause:** httpbin.org has frequent outages and rate limits. Google/Cloudflare are more reliable and match the targets used in speedtest.js.

---

## FIXES FROM AI BUILDER FEEDBACK (v10, March 2026)

An AI built a full desktop app (Test1) from the SDK and wrote `SDK-SUGGESTIONS.md` documenting 8 issues. All 8 are now fixed.

### 27. Full Tunnel by Default — `fullTunnel` Option

**What we changed:** Added `fullTunnel` option to `connectDirect()` and `connectViaPlan()`. Default is `true` — WireGuard writes `AllowedIPs = 0.0.0.0/0, ::/0` which routes ALL traffic through VPN and changes the user's IP.

**What the code did before:** `splitIPs || null` → if caller passes `[]` (empty array, truthy), the SDK tried `resolveSpeedtestIPs()` which only routed 3 speedtest IPs. User's browser IP never changed. The empty-array-is-truthy ambiguity confused both AIs and humans.

**New behavior:**
- `fullTunnel: true` (default) → full tunnel, user's IP changes
- `fullTunnel: false` → split tunnel with speedtest IPs only (safe for testing)
- `splitIPs: ['1.2.3.4']` → explicit IPs, overrides fullTunnel

### 28. Stale Session Auto-Retry

**What we changed:** `connectDirect()` now catches "already exists in database" errors during handshake, automatically pays for a fresh session, and retries.

**What the code did before:** If `findExistingSession()` returned a stale session (paid but handshake already registered on node), the handshake threw HTTP 409 and `connectDirect()` propagated the error. The user lost P2P (session already paid) and got a cryptic error.

**Why it matters:** Every failed connection leaves a stale session on-chain. Next connection attempt finds it via `findExistingSession()`, tries to reuse it, and fails with "already exists". Without auto-retry, every subsequent connection attempt fails until the session expires.

### 29. V2Ray System Proxy Auto-Set

**What we changed:** Added `setSystemProxy(port)` and `clearSystemProxy()`. When `systemProxy: true` (default), `setupV2Ray()` auto-sets the Windows system SOCKS proxy via registry after a working outbound is found. `cleanup()` and `disconnect()` auto-clear it. Exit handlers also clear proxy.

**What the code did before:** V2Ray created a local SOCKS5 proxy on `127.0.0.1:PORT` but nothing in the system was configured to use it. The user connected "successfully" but their browser still used the direct connection. IP didn't change.

**Cross-platform:** `setSystemProxy`/`clearSystemProxy` are no-ops on non-Windows. On macOS/Linux, the caller should handle proxy configuration (networksetup / gsettings).

### 30. Progress Callbacks

**What we changed:** Added `onProgress: (step, detail) => void` option to `connectDirect()` and `connectViaPlan()`. Steps: `wallet`, `node-check`, `validate`, `session`, `handshake`, `tunnel`, `verify`, `proxy`.

**Why it matters:** `connectDirect()` is a ~30-second operation. Without progress feedback, the UI shows nothing — the user thinks the app is frozen. Now apps can show "Checking node...", "Paying...", "Installing tunnel...", etc.

### 31. Kill V2Ray by PID, Not Image Name

**What we changed:** Replaced `execSync('taskkill /F /IM v2ray.exe')` with `activeV2RayProc.kill()` (kill by PID).

**What the code did before:** `taskkill /F /IM v2ray.exe` kills ALL v2ray.exe processes system-wide. If the user had other V2Ray instances (personal VPN, other apps), they all got killed.

### 32. WireGuard Config Written to SYSTEM-Readable Path

**What we changed:** `writeWgConfig()` in v3protocol.js now writes to `C:\ProgramData\sentinel-wg\` on Windows instead of `os.tmpdir()` (user temp).

**What the code did before:** Config was written to `C:\Users\X\AppData\Local\Temp\sentinel-wg\wgsent0.conf`. The WireGuard service runs as the SYSTEM account, which often can't read files from a user's temp directory. The service registered but never started — silent failure caught only by the v9 `verifyTunnelRunning()` check.

**Now:** `C:\ProgramData\` is readable by all accounts including SYSTEM. The tunnel actually starts.

### 33. System Proxy Cleanup in Exit Handlers

**What we changed:** `registerCleanupHandlers()` now calls `clearSystemProxy()` in all exit handlers (exit, SIGINT, SIGTERM, uncaughtException). `disconnect()` also clears proxy.

**What the code did before:** If the app crashed with V2Ray running, the Windows system proxy stayed set to a dead SOCKS port. All browser traffic failed until the user manually cleared the proxy in Windows settings.

### 34. Custom Logger Support (`opts.log`)

**What we changed:** Added `log` option to `connectDirect()` and `connectViaPlan()`. All SDK output routes through this function. Default: `console.log`.

**What the code did before:** All SDK functions used `console.log` directly. When running as a background service with `nohup`, logs disappeared or went to the wrong place. Apps couldn't route SDK logs to their own logging system, UI, or file.

**New behavior:**
```js
const conn = await connectDirect({
  ...opts,
  log: (msg) => myAppLog(msg),   // route all SDK output here
  onProgress: (step, detail) => updateUI(step, detail),  // structured progress
});
```

### 35. Port Conflict Detection (`checkPortFree`)

**What we changed:** Added `checkPortFree(port)` export. Returns a Promise<boolean> — true if port is free.

**Why it matters:** When the old server process wasn't killed properly, restarting silently fails to bind the port. The new process starts, all requests go to the old code, and nothing in the logs indicates this. Use at startup:
```js
if (!await checkPortFree(3000)) {
  console.error('Port 3000 in use — is another server running?');
  process.exit(1);
}
```

### 36. V2Ray Orphan Cleanup in Exit Handlers

**What we changed:** `registerCleanupHandlers()` now calls `killOrphanV2Ray()` which kills the tracked V2Ray process by PID. Previously, `emergencyCleanupSync()` only cleaned up WireGuard tunnels — a crashed app would leave a zombie v2ray.exe running.

---

## FIXES FROM DEEP AI BUILDER FEEDBACK ROUND 2 (v11, March 2026)

Second pass through Test1's SDK-SUGGESTIONS.md (expanded to 16 items with v10 status annotations and 72/100 AI buildability score).

### 37. `forceNewSession` Option

**What we changed:** Added `forceNewSession: true` option to `connectDirect()`. When set, skips `findExistingSession()` entirely and always pays for a fresh session.

**Why it matters:** When multiple apps share one wallet (e.g., desktop app + node tester), `findExistingSession()` picks up sessions created by other apps. Those sessions have already been handshaked with a different UUID/keypair, causing "already exists in database" errors. The auto-retry in v10 handles this by paying again, but it still wastes one session's worth of P2P per attempt. `forceNewSession: true` skips the lookup entirely — zero wasted sessions.

### 38. Built-in Node Quality Scoring

**What we changed:** `queryOnlineNodes()` now returns a `qualityScore` (0-100) per node and sorts results best-first by default. Scoring based on 400+ node test results:
- WireGuard nodes: +20 (simpler tunnel, fewer failure modes)
- Clock drift >120s: -40 (VMess will fail silently)
- Clock drift >60s: -15 (risky for VMess)
- 0 peers: +10 (empty = fast)
- 20+ peers: -10 (congested)

**What the code did before:** `queryOnlineNodes()` returned nodes in random order. An AI building an app didn't know to avoid grpc/tls nodes (0% success), high-drift nodes (VMess death), or heavily loaded nodes unless it read 300 lines of known-issues.md. Now `nodes[0]` is the best available node.

Pass `sort: false` to get random order (useful for load distribution).

### 39. Shared Wallet Documentation

**What we changed:** Added "CRITICAL: Shared Wallet — Multiple Apps, Same Mnemonic" section to known-issues.md. Documents the 409 error cascade, the `forceNewSession` fix, and recommends separate wallets per app in production.

Also documented WireGuard full tunnel DNS behavior (`writeWgConfig` adds OpenDNS only for full tunnel, uses system DNS for split tunnel).

### 40. "Using Primitives Directly" Documentation

**What we changed:** Added a new section in end-to-end-example.md showing how to use the SDK's low-level functions directly for apps that need custom control over each step. Documents that `connectDirect()` is a convenience wrapper, not a requirement.

**Why it matters:** The AI that built Test1 abandoned `connectDirect()` entirely and used primitives. The building blocks were production-grade but this wasn't documented as a supported pattern. Now it is.
