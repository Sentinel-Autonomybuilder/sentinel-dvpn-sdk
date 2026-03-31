# Sentinel SDK Failure Catalog

> Every failure pattern discovered across 10 apps, 2200+ mainnet node tests, 25 project findings files, 161 suggestion files, and 200+ hours of development.
> For any AI building on this SDK: read this BEFORE writing code. Every entry cost real tokens and real debugging time.

---

## Quick Rules -- The 35 Most Critical

| # | Rule | Category | Consequence of Violation |
|---|------|----------|--------------------------|
| 1 | **Use v3 LCD paths, not v2** -- v2 returns "Not Implemented" except `/sentinel/provider/v2/` | chain | Zero chain queries work |
| 2 | **Never trust `count_total` or `next_key`** on Sentinel LCD pagination -- use `limit=5000` single request | chain | Missing 400+ nodes |
| 3 | **`remote_addrs` is an array, not `remote_url` string** -- LCD v3 changed the field name and format | chain | All connections fail silently (undefined) |
| 4 | **Session data is nested under `base_session`** -- always access `session.base_session.id` | chain | Silent undefined propagation |
| 5 | **WireGuard requires Administrator privileges** -- check BEFORE paying for a session | tunnel | Money wasted, no connection |
| 6 | **Never install full-tunnel to unreachable endpoint** -- `AllowedIPs=0.0.0.0/0` kills internet instantly | tunnel | Total internet death |
| 7 | **V2Ray must be exactly v5.2.1** -- newer versions have observatory bugs | dependencies | Silent connection failures |
| 8 | **MTU must be 1280, not 1420** -- Sentinel nodes are configured for 1280 | tunnel | TLS handshake failures, service crashes |
| 9 | **WireGuard DNS must be `10.8.0.1`** (node's internal resolver), not external DNS | tunnel | DNS resolution fails through tunnel |
| 10 | **`grpc/tls` has 0% success rate** -- filter these transports BEFORE paying | protocol | Guaranteed failure, tokens wasted |
| 11 | **QUIC `quicSettings` must use `security: 'none'`** -- not `chacha20-poly1305` | protocol | 0% QUIC connections |
| 12 | **VMess AEAD requires clock drift <120s** -- but VLess is immune to clock drift | protocol | VMess-only nodes fail with drift |
| 13 | **Register MsgEndSession in protobuf Registry** -- or sessions never end on-chain | chain | Orphaned sessions leak resources |
| 14 | **Account sequence mismatch** -- serialize broadcasts through a mutex, retry with backoff | chain | TX failures cascade |
| 15 | **Session may be `inactive_pending` after TX** -- poll until `active` before handshaking | timing | "Invalid session status" errors |
| 16 | **Chain lag** -- node's RPC may not see session for 10s after broadcast | timing | "Session does not exist" on handshake |
| 17 | **Verify-before-capture for WireGuard** -- test with split IPs first, then switch to full tunnel | tunnel | 78s of dead internet on failure |
| 18 | **`autoReconnect()` checks `status?.connected` but that property doesn't exist** -- use `!!status` | protocol | Entire reconnect feature is broken |
| 19 | **Never `taskkill /F /IM node.exe`** -- Claude Code runs on Node.js | dependencies | Kills development environment |
| 20 | **`BigInt` cannot be JSON.stringify'd** -- convert sessionId to string before serialization | protocol | TypeError crash |
| 21 | **Error code strings are a CONTRACT between SDKs** -- `SESSION_EXISTS` must match exactly | parity | Cross-language apps break |
| 22 | **Unit tests prove nothing about live chain** -- 656 tests passed, zero features worked | testing | False confidence |
| 23 | **`fullTunnel: true` is the default** -- routes ALL traffic through VPN. AI agents should explicitly set `fullTunnel: false` or use `protocol: 'v2ray'` for split tunnel. Intentionally `true` since v26c (false caused "IP didn't change" confusion for consumers). | configuration | AI's chain queries slow down through VPN |
| 24 | **SOCKS5 auth breaks Windows system proxy** -- system proxy cannot pass credentials | tunnel | "Connected" but zero traffic |
| 25 | **Fee grant auto-detection should be opt-in** -- don't silently use random granters | wallet | Unexpected behavior, unreliable grants |
| 26 | **Shared VPN client for testing corrupts state** -- always create a DEDICATED VPN client per test | integration | Main VPN session disconnected, state corrupted |
| 27 | **CancellationToken in speed test kills measurements** -- pass `CancellationToken.None` to speed/google tests | integration | Garbage speed numbers, premature cancellation |
| 28 | **Background refresh starves test connections** -- cancel background work before starting test scan | integration | Test hangs indefinitely waiting for HTTP client |
| 29 | **Progress counter must increment on EVERY code path** -- success, failure, AND exception | integration | UI freezes, user thinks app is stuck |
| 30 | **V2Ray SOCKS5 connection reuse silently fails** -- create FRESH HttpClient/SocksProxyAgent per request | protocol | First request works, subsequent hang until timeout |
| 31 | **WPF cannot render emoji flags** -- use PNG images from flagcdn.com, not emoji code points | ux | Empty boxes or nothing at all on Windows native apps |
| 32 | **Load previous results on startup** -- never show "No results" when results exist on disk | ux | User loses trust, thinks data was lost |
| 33 | **Docs describing non-existent code cause more harm than no docs** -- label IMPLEMENTED vs SPEC | documentation | AI spends 10+ hours trying to use classes that don't exist |
| 34 | **transport_security is 0-indexed in C#, 1-indexed in JS** -- always check enum mappings when bridging | parity | All C# V2Ray tests fail with wrong TLS setting |
| 35 | **Missing UUID wait in new code paths** -- copy ALL waits/sleeps when adding a new code path | timing | All V2Ray connections on new path fail silently |
| 36 | **NEVER use native `fetch()` for V2Ray traffic** -- `fetch()` silently ignores SOCKS5 proxy. You WILL get your real IP, not the VPN IP. Use `axios` with `SocksProxyAgent` for ALL V2Ray verification, speed tests, and IP checks. This is the #1 mistake every AI builder makes. | protocol | IP leak — agent thinks it's on VPN but all traffic goes direct |
| 37 | **V2Ray split tunnel IS the SOCKS5 proxy** -- V2Ray does not change system routing. Only traffic you explicitly send through `socks5://127.0.0.1:{port}` goes through the VPN. Everything else is direct. There is no `fullTunnel` for V2Ray — `systemProxy: true` sets Windows proxy but that's opt-in, not default. | protocol | Agent assumes all traffic is encrypted when only proxied traffic is |
| 38 | **WireGuard split tunnel requires exact destination IPs** -- `splitIPs: ['example.com']` does NOT work. WireGuard routes by IP, not domain. CDN/anycast services (Cloudflare, Google) resolve to hundreds of IPs. Use V2Ray SOCKS5 for per-app split tunnel, use WireGuard splitIPs only for known static IPs. | tunnel | Agent sets splitIPs for a CDN domain, traffic goes direct because DNS resolved to a different IP |
| 39 | **WireGuard disconnect MUST restore DNS to DHCP** -- WireGuard config sets system DNS (10.8.0.1 or custom). This persists in the OS adapter AFTER the WG interface is removed. Every disconnect path (normal, error, emergency) must call `disableDnsLeakPrevention()` or `netsh interface ipv4 set dnsservers Wi-Fi dhcp`. Discovered 2026-03-27: Cloudflare DNS persisted after split tunnel test, broke all V2Ray and node tester connections. | tunnel | System DNS silently changed, all subsequent networking affected |

---

## Failures by Category

### PROTOCOL

| # | Failure Name | What Happened | Root Cause | Fix Applied | Prevention Rule |
|---|-------------|---------------|------------|-------------|-----------------|
| P1 | QUIC 0% success rate | All 4 QUIC nodes failed despite having active peers | Global `quicSettings` used `security: 'chacha20-poly1305'` but Sentinel Go SDK server uses `security: 'none'` | Changed to `{ security: 'none', key: '', header: { type: 'none' } }` in both global and per-outbound settings | Always match transport security settings to sentinel-go-sdk server defaults |
| P2 | grpc/tls always fails | 0 nodes passed grpc/tls out of 14+ tested; nodes have active peers | V2Ray gRPC over TLS has incompatible server config; sentinel nodes don't support it | Filter `grpc/tls` (transport_protocol=3, transport_security=2) BEFORE session payment | Pre-filter: if all transports are grpc/tls, skip node |
| P3 | VMess clock drift AEAD failure | VMess connections to nodes with >120s clock drift fail silently | VMess AEAD timestamp auth has +/-120s tolerance; HTTP Date header drift detected but node still tried | Skip VMess-only nodes with >120s drift; prefer VLess outbounds when drift detected | Check clock drift AND available protocols; VLess ignores drift |
| P4 | grpc missing serviceName | gRPC connections fail with "context canceled" after VMess auth | Per-outbound `streamSettings` had no `grpcSettings` block; V2Ray fell back to wrong global setting | Added `grpcSettings: { serviceName: '' }` for both `grpc` and `gun` networks | Always include `grpcSettings` for gun(2) and grpc(3) transports |
| P5 | gun vs grpc documentation contradiction | Docs said gun and grpc are "DIFFERENT protocols" but V2Ray treats them identically | Sentinel uses different enum values (2=gun, 3=grpc) but V2Ray config is identical for both | Updated docs: both use `"network": "grpc"` with `grpcSettings: { serviceName: '' }` | For V2Ray config, gun and grpc are the same -- both use grpcSettings |
| P6 | v2-format metadata rejection | Most popular node (48 peers) rejected because it returned v2 metadata format | SDK threw error on old `{protocol, tls, ca}` fields instead of mapping to v3 `{proxy_protocol, transport_protocol, transport_security}` | Added v2-to-v3 field mapper: v2 protocol:1->v3 proxy_protocol:2, etc. | Never reject metadata outright -- map old formats to new |
| P7 | autoReconnect completely broken | `autoReconnect()` never triggers reconnection | Checked `status?.connected` but `getStatus()` returns `{ sessionId, serviceType, ... }` with no `.connected` property -- always false | Changed to `!!status` (getStatus returns null when disconnected) | Test feature with real connection lifecycle, not just existence |
| P8 | BigInt JSON serialization crash | `JSON.stringify({ sessionId: 123n })` throws TypeError | `sessionId` is BigInt, JavaScript cannot serialize BigInt to JSON | Call `.toString()` before sending to frontend; SDK's `serializeResult()` exists but must be called | Always convert BigInt to string at API boundaries |
| P9 | broadcast() name collision | SSE broadcast and SDK chain broadcast share the same name | SDK exports `broadcast()` for chain TX; apps commonly have local `broadcast()` for SSE | Document collision risk; consider renaming SDK export to `broadcastTx()` | When importing SDK functions, check for local name conflicts |
| P10 | Transport success rates outdated | Code cited grpc/none=58%, quic=55% but real rates are grpc/none=87%, quic=0% | Numbers from early testing never updated after 780-node scan | Updated `TRANSPORT_SUCCESS_RATES` to match 780-node data | Update transport stats after every major test run |
| P11 | Session ID precision time bomb | `Number(sessionId)` silently rounds integers above 2^53 | `initHandshakeV3()` converts BigInt to Number for handshake POST body | Added `Number.isSafeInteger()` bounds check; fails loudly instead of silently | Never downcast BigInt to Number without safety check |
| P12 | V2Ray balancer unreliable | V2Ray 5.2.1 observatory marks working outbounds as dead | V2Ray internal health checker is buggy in 5.2.1 | Implemented own fallback: balancer first (8s), then individual outbounds in priority order | Don't rely on V2Ray's internal balancer -- implement app-level retry |
| P13 | Port probe false negative kills nodes with peers | V2Ray "service dead" error for nodes with active connections | Pre-payment port probe scans 12 standard ports, but V2Ray may run on non-standard ports | If peers > 0, skip probe failure and proceed to handshake (reveals actual ports in metadata) | Never hard-fail port probe when peers > 0; someone IS connecting, V2Ray IS alive |
| P14 | TCP probe fail wastes 20s per V2Ray outbound | Node test times out after trying 3-4 unreachable outbounds | When TCP SYN fails but V2Ray starts anyway, SOCKS5 wait (12s) + sleep (4s) per outbound = 16-20s each | Reduce SOCKS5 wait from 12/8s to 5s when TCP probe already failed; saves ~15s per unreachable port | Use TCP probe result to size timeouts: probe OK → normal timeout; probe fail → fast fail |
| P15 | VMess clock drift unfixable for AEAD-only servers | VMess nodes with >120s drift fail with both alterId=0 and alterId=64 | AEAD (alterId=0) rejects timestamps >120s off. Legacy (alterId=64) on AEAD-only server → auth mismatch → 15s silent drain. No V2Ray config adjusts timestamp. | Try both alterId values, accept failure. Only fix is node operator fixing their clock or supporting legacy. | VMess with drift >120s on AEAD server = UNFIXABLE from client. Skip these nodes and document why. VLess is immune to drift. |
| P16 | SOCKS5 "connected" but no internet | V2Ray opens SOCKS5 port even when remote connection fails | V2Ray starts SOCKS5 listener immediately, before establishing remote tunnel. Traffic enters SOCKS5 but can't route. | Add 3s google connectivity pre-check before running full speedtest. Detects dead tunnels 10x faster. | Never assume SOCKS5 port open = tunnel working. Always pre-check connectivity. |
| P17 | Port scan discovers non-V2Ray ports 7874/7876 | Discovered ports tried as V2Ray, waste time, always fail | Sentinel-go-sdk nodes have internal control/WireGuard ports (7874, 7876) that accept TCP but don't serve V2Ray | Filter discovered ports: if they accept TCP but no TLS and no HTTP response, skip as non-V2Ray | Cross-reference discovered ports with known sentinel internal port ranges before attempting V2Ray |

### CHAIN

| # | Failure Name | What Happened | Root Cause | Fix Applied | Prevention Rule |
|---|-------------|---------------|------------|-------------|-----------------|
| C1 | v2 LCD endpoints return "Not Implemented" | All C# SDK chain queries fail -- zero features work | C# SDK used v2 paths (`/sentinel/nodes?status=STATUS_ACTIVE`); chain runs v3 | Updated all 9 endpoints to v3 paths (e.g., `/sentinel/node/v3/nodes?status=1`) | Always use v3 paths; only exception: provider remains v2 |
| C2 | LCD `count_total` returns wrong number | Plan discovery shows 1 node but plan has 733 | LCD returns `min(actual_count, limit)` as `count_total` with `limit=1` | Changed to `limit=5000` and count array length directly | NEVER trust `count_total` -- always count the returned array |
| C3 | LCD `next_key` always null on plan nodes | Pagination stops at 200 nodes; misses 533 | `/sentinel/node/v3/plans/{id}/nodes` doesn't implement `next_key` pagination | Single request with `limit=5000` | Test pagination per endpoint; some are broken |
| C4 | `remote_addrs` vs `remote_url` | All node connections fail -- `node.remote_url` is undefined | v3 LCD returns `remote_addrs: ["IP:PORT"]` (array, no protocol) instead of `remote_url: "https://IP:PORT"` | Added `resolveRemoteUrl()` that handles both formats | Always use `resolveRemoteUrl(node)`, never access field directly |
| C5 | `base_session` nesting undocumented | `session.id` returns undefined; no error, just silent null | v3 LCD nests session fields under `base_session` | Always use `const bs = session.base_session \|\| session` | Flatten `base_session` in all query helpers |
| C6 | MsgEndSession not registered in protobuf | Sessions NEVER end on-chain; orphaned sessions accumulate | `MsgEndSessionRequest` type URL not registered in CosmJS Registry; no encoder function exists | Registered type in `buildRegistry()` and created `encodeMsgEndSession()` | Verify ALL message types are registered, not just commonly used ones |
| C7 | `status=1` vs `status=STATUS_ACTIVE` | Node status filter returns wrong results | v3 uses integer status codes (1=active), v2 used string enum | Updated all queries to use `status=1` | Use integer status codes for v3 chain |
| C8 | `acc_address` vs `address` | Subscription parser fails | v3 uses `acc_address` field, v2 used `address` | Updated parser to read `acc_address` | Always verify field names against actual LCD responses |
| C9 | Plan discovery endpoint returns 501 | `DiscoverPlansAsync()` returns 0 plans on mainnet | `/sentinel/plan/v3/plans/{id}` is NOT IMPLEMENTED on chain | Use subscription+node endpoints to probe plan existence | Test endpoints with `curl` before building against them |
| C10 | Provider endpoint is v2 only | Provider queries fail with v3 path | `/sentinel/provider/v3/` returns 501; must use `/sentinel/provider/v2/` | Use v2 path for provider queries only | Document the v2 exception prominently |
| C11 | Subscription endpoint returns all 143K results | `GetSubscriptionsAsync` fetches entire chain's subscriptions | Wrong path `/sentinel/subscription/v3/subscriptions?account_address=` vs correct `/sentinel/subscription/v3/accounts/{addr}/subscriptions` | Fixed to account-scoped path | Always use account-scoped endpoints for per-user queries |
| C12 | Handshake error field type mismatch | `JsonException` on deserializing handshake error response | Node returns `{"error": {"code": 2, "message": "..."}}` (object) but SDK typed `Error` as `string?` | Changed to `JsonElement?` with type-safe accessor | Use flexible JSON types for node API responses -- formats vary |
| C13 | Plans start inactive | AI creates plan, tries to subscribe, gets chain error | `encodeMsgCreatePlan()` creates plan with `status=0` (inactive); needs separate `encodeMsgUpdatePlanStatus()` | Added `createAndActivatePlan()` helper | Document two-step plan creation prominently |
| C14 | queryNode() downloaded ALL nodes to find one | Single node lookup fetches 900+ nodes then `.find()` | No direct endpoint used; full paginated query used for single lookup | Try `/sentinel/node/v3/nodes/{address}` first; fall back to full list | Always use direct endpoints when querying single items |
| C15 | `max_price` Code 106 "invalid price" in MsgStartSession | Session payment fails for nodes with certain price combos (base_value=0.005, quote_value=25M) | Chain v3 price validation rejects combinations that were valid at node registration time | Catch Code 106 → retry WITHOUT `max_price` field; chain uses node's registered price directly | Always implement retry-without-max_price for MsgStartSession; 14/987 nodes affected |
| C16 | Batch payment fails on ONE bad-price node | Entire 5-node batch TX rejected with Code 106 when any node has invalid pricing | Batch contains mix of standard (40M quote) and non-standard (25M quote) prices | Retry entire batch without max_price; if still fails, fall back to individual per-node payments | Batch TX is all-or-nothing; one bad message kills all 5. Always have individual fallback. |

### TUNNEL

| # | Failure Name | What Happened | Root Cause | Fix Applied | Prevention Rule |
|---|-------------|---------------|------------|-------------|-----------------|
| T1 | WireGuard race condition -- config deleted before service reads it | "The system cannot find the file specified" service error | SDK deletes config file during cleanup before Windows service has finished starting | Never delete config file while service exists; only delete AFTER confirmed uninstall | Config must remain on disk as long as service exists |
| T2 | MTU 1420 causes service crash | WireGuard service installs but immediately stops | Sentinel nodes configured for MTU 1280; using 1420 causes packet fragmentation and TLS failures | Changed to `MTU = 1280` | Always use MTU 1280 for Sentinel WireGuard tunnels |
| T3 | External DNS unreachable in full tunnel | DNS queries to OpenDNS (208.67.222.222) fail through tunnel | Full tunnel only routes to WireGuard endpoint; external DNS is unreachable | Changed DNS to `10.8.0.1` (node's internal resolver) | Use node's internal DNS (10.8.0.1) in full-tunnel mode |
| T4 | Full-tunnel verification kills internet for 78s | User loses all internet while verification loops fail on a broken node | `setupWireGuard()` installed tunnel with `AllowedIPs=0.0.0.0/0` before verification | Verify-before-capture: install with split IPs first, verify, then switch to `0.0.0.0/0` | Always verify tunnel works with safe split IPs before capturing all traffic |
| T5 | Phantom connected state | App shows "connected" when no tunnel exists; IP leak | `getStatus()` trusted `state.connection` without checking if tunnel was alive | Cross-validate tunnel health; auto-clear stale state; emit `disconnected` event | Always verify tunnel liveness (service running, process alive) before reporting connected |
| T6 | Windows service race on tunnel switch | Double-uninstall races with Windows Service Manager; tunnel fails to start | Manual `disconnectWireGuard()` + `installWgTunnel()` internal force-remove created double-uninstall | Removed manual pre-disconnect; let `installWgTunnel()` handle its own cleanup | Single uninstall path -- never double-uninstall |
| T7 | V2Ray process leak on outbound loop exit | Orphaned V2Ray processes accumulate; SOCKS5 ports consumed | Outbound connection loop exits without `finally` block to kill last spawned process | Wrapped loop in try-finally that kills last process on any exception | Always use try-finally when spawning child processes in loops |
| T8 | Tunnel not cleaned up on handshake retry failure | Dead internet from orphaned WireGuard `0.0.0.0/0` route | Retry catch block only marks session as poisoned; doesn't clean up partially installed tunnel | Added tunnel cleanup check (`state.wgTunnel`, `state.v2rayProc`) in retry catch block | Always clean up tunnel state in all error paths |
| T9 | SOCKS5 auth breaks Windows system proxy | "Connected" but zero traffic flows | V2Ray config uses password auth; Windows system proxy cannot pass SOCKS5 credentials | When `systemProxy: true`, patch SOCKS5 inbound to `noauth` | System proxy mode requires noauth SOCKS5 |
| T10 | System proxy stuck after crash | All HTTP traffic goes to dead SOCKS5 port; browser shows "no internet" | `clearSystemProxy()` only runs in cleanup handler; crash leaves registry pointing to dead port | Write sentinel file on proxy set; check at startup; restore on recovery | Always persist proxy state so crash recovery can restore it |
| T11 | Proxy restore overwrites user's previous proxy | User had corporate proxy; `clearSystemProxy()` sets "no proxy" instead of restoring | Code force-disables proxy entirely instead of restoring saved state | Save proxy state before modifying; restore exact previous state on cleanup | Always backup and restore system proxy state |
| T12 | Orphaned WireGuard adapters block new tunnels | "Tunnel already installed and running" error on fresh connect | Previous crash left Wintun adapter registered but no service managing it | Emergency cleanup at startup: detect and remove orphaned adapters | Run `emergencyCleanupSync()` at startup; clean all stale `wgsent*` services |
| T13 | WireGuard private key file not deleted on failure | Private key stays at `C:\ProgramData\sentinel-wg\wgsent0.conf` indefinitely | Bare `catch {}` on file deletion; locked file or permissions failure silently ignored | Retry deletion; overwrite with zeros before delete; log failure | Always zero-fill sensitive files before deletion |
| T14 | Config ACL race -- key readable before ACL set | Config file (with private key) world-readable in `ProgramData` between write and ACL set | File written FIRST, ACL set SECOND; failure in ACL leaves file exposed | Create directory with restrictive ACL first, then write file | Set restrictive permissions on directory before writing sensitive files |
| T15 | Full tunnel + Handshake DNS = 0-speed (44 nodes) | WireGuard tunnel connects but speed test returns exactly 0 Mbps | Full tunnel routes DNS through VPN; Handshake DNS (103.196.38.38) unreachable through many nodes | Pre-resolve all speed test hostnames BEFORE tunnel installation; use resolved IPs | Always pre-resolve DNS before installing full tunnel |
| T16 | V2Ray port TIME_WAIT kills fallback | V2Ray fallback to different outbound fails because SOCKS5 port still in TIME_WAIT | All outbound configs used same SOCKS5 port; Windows TIME_WAIT is ~120s | Each outbound gets incrementing port: `basePort + idx` | Never reuse same port across V2Ray fallback attempts |

### WALLET

| # | Failure Name | What Happened | Root Cause | Fix Applied | Prevention Rule |
|---|-------------|---------------|------------|-------------|-----------------|
| W1 | Fee grant auto-detection silently applied | Direct-connect app uses random stranger's fee grant without consent | SDK auto-detects fee grants and picks `grants[0]` on every transaction | Made fee grant opt-in via explicit `FeeGranter` option | Never auto-apply fee grants; make it explicit opt-in |
| W2 | Insufficient funds with no dry-run option | AI builds working code but first real run fails with "insufficient funds" | Blockchain requires funded wallet; AI cannot purchase tokens | Added dry-run mode that validates everything except payment | Provide `dryRun: true` option to validate without spending tokens |
| W3 | Fast reconnect never sets `state._mnemonic` | Sessions never end on-chain after fast reconnect; session leak | `connectDirect()` called `tryFastReconnect()` which skips `connectInternal()` where `_mnemonic` was set | Set `state._mnemonic = opts.mnemonic` BEFORE calling `tryFastReconnect()` | Set authentication state before any early-return code path |

### TIMING

| # | Failure Name | What Happened | Root Cause | Fix Applied | Prevention Rule |
|---|-------------|---------------|------------|-------------|-----------------|
| TM1 | Session "does not exist" on handshake | 6.7% of handshakes fail immediately after session payment | `BROADCAST_MODE_SYNC` returns after CheckTx, not DeliverTx; block not committed yet (~6-7s) | Added retry-on-404: wait 10s and retry handshake once | Always retry handshake on "does not exist" with 10s delay |
| TM2 | Session `inactive_pending` status | "Invalid session status inactive_pending, expected active" | Session TX confirmed but not yet transitioned to active status | Added `waitForSessionActive()` polling: every 2s for up to 20s | Poll session status until active before handshaking |
| TM3 | Sequence mismatch on rapid transactions | "Account sequence mismatch" cascades through batch operations | CosmJS caches sequence number; concurrent TXs use stale sequence | Broadcast mutex + retry with exponential backoff + fresh sequence on retry | Serialize broadcasts through mutex; wait 7s between TXs |
| TM4 | Stale session allocation 404 | "Resource not found" when reusing previous session | Session appears "active" in query but allocation endpoint returns 404 (expired/closed) | On 404, skip stale session and create new one automatically | Never throw on allocation 404; fall through to new session |
| TM5 | Session indexing race (409 "already exists") | Handshake returns 409 even though session just created | Node still indexing session after TX confirmation | 5s delay after payment; then retry on 409 at 15s and 20s intervals | Add post-payment delay and handle 409 with progressive retry |
| TM6 | V2Ray needs post-handshake warmup | Speed test returns low/zero speed immediately after V2Ray connect | Node needs time to register UUID and stabilize tunnel | Added 10s post-handshake delay for V2Ray before speed test | Wait 10s after V2Ray handshake before testing connectivity |

### CONFIGURATION

| # | Failure Name | What Happened | Root Cause | Fix Applied | Prevention Rule |
|---|-------------|---------------|------------|-------------|-----------------|
| CF1 | `fullTunnel: true` default bricks AI | AI's own RPC/LCD/npm calls crawl or die after successful connect | Default routes ALL traffic through slow VPN node (median 3 Mbps) | Changed defaults to `false`; explicit opt-in for production apps | Default to split tunnel; full tunnel is opt-in |
| CF2 | `LCD_ENDPOINTS[0]` is an object, not a string | "Invalid URL" error on first LCD call | `LCD_ENDPOINTS` exports `[{ url, name, verified }]` objects; developer assumed string | Use `LCD_ENDPOINTS[0].url` or `DEFAULT_LCD` string export | Make `lcd()` accept both string and Endpoint objects |
| CF3 | Missing `axios.defaults.adapter = 'http'` | Opaque "fetch failed" errors on self-signed node certs | Node.js 18+ uses fetch adapter by default; self-signed certs fail | Move `axios.defaults.adapter = 'http'` to top of `index.js` | Ensure adapter is set on any SDK import path |
| CF4 | Missing `registerCleanupHandlers()` | WireGuard tunnel stays installed with `0.0.0.0/0` after crash; dead internet | No cleanup handlers registered; orphaned tunnel captures all traffic | Hard-fail if cleanup handlers not registered before connect | `connect()` must refuse to proceed without cleanup handlers |
| CF5 | `subscribeToPlan()` field name mismatch | `renewal_price_policy` (snake_case) silently ignored | Encoder destructures `renewalPricePolicy` (camelCase); different naming convention | Changed to `renewalPricePolicy` | Always match field naming convention between callers and encoders |
| CF6 | PersistentKeepalive too long | NAT routers expire UDP mappings at 20-30s; keepalive at 30s causes drops | 30s keepalive is at the edge of many NAT timeout windows | Changed to `PersistentKeepalive = 15` | Use 15s keepalive for WireGuard -- safe for all NAT routers |
| CF7 | Node address mismatch wastes tokens | Session paid for node A, but handshake endpoint serves node B | Node's `remote_addrs` on chain points to wrong IP; different node at that address | Pre-verify node address at remote URL BEFORE creating session | Always verify node identity before paying for session |
| CF8 | Node missing moniker/location from LCD | `node.moniker` returns undefined; no error | LCD returns only address/prices/remote_addrs; moniker/location requires separate `nodeStatusV3()` call | Document clearly: LCD nodes lack moniker/location; must call node's own API | Enrich LCD node data with `nodeStatusV3()` before displaying |
| CF9 | Daemon loses wallet and connection state on restart | User must re-login and reconnect after every daemon restart/crash; auth token survives but wallet doesn't | Daemon stores active wallet and connection state only in memory; no disk persistence for wallet or last-connection | Persist `active-user.json` (encrypted mnemonic + address) and `last-connection.json` (nodeAddress, protocol, sessionId) to `~/.sentinel-daemon/`; on startup: load wallet, check session on chain, auto-reconnect if still active | Persist ALL daemon state to disk; on restart, restore wallet and attempt reconnection automatically |
| CF10 | `connectViaPlan()` BigInt(undefined) crash with confusing error | `TypeError: Cannot convert null to a BigInt` or `SyntaxError: Cannot convert abc to a BigInt` — no context about which parameter | `BigInt(opts.planId)` called without proper type validation; falsy guard `!opts.planId` rejects `0` (potentially valid) and passes through bad types | Added explicit validation: null/empty check first, then `try { BigInt(planId) } catch { throw with context }` | Validate BigInt inputs with try/catch and rethrow with parameter name context |
| CF11 | Handshake timeout 30s too short for distant nodes | Functional nodes with active peers time out at exactly 30s; `ECONNABORTED: timeout of 30000ms exceeded` | 30s timeout insufficient for distant nodes (Asia, South America) or nodes under load; TLS handshake + session negotiation round trip exceeds 30s | Increased handshake timeout to 45s in both `initHandshakeV3()` (WireGuard) and `initHandshakeV3V2Ray()` (V2Ray) | Use 45s handshake timeout; builders can override via their own axios config if needed |
| CF12 | C# `SentinelVpnOptions` missing `Hours` property | Consumer apps can't let users choose hour amounts for time-based sessions | `PreferHourly = true` hardcodes `hours = 1` internally; no way to specify 2h, 4h, 8h, etc. | Need to add `Hours` property alongside `Gigabytes` | Expose both `Gigabytes` and `Hours` in connection options; never hardcode session duration |

### DEPENDENCIES

| # | Failure Name | What Happened | Root Cause | Fix Applied | Prevention Rule |
|---|-------------|---------------|------------|-------------|-----------------|
| D1 | V2Ray version mismatch | Connections fail with no clear error | V2Ray 5.44.1+ has observatory bugs; must be exactly 5.2.1 | `verifyDependencies()` checks version; `connect()` refuses incompatible V2Ray | Check V2Ray version at connect time, not just setup |
| D2 | WireGuard not installed | "Failed to start" with no explanation | `wireguard.exe` not found on system | Pre-check before session payment; clear error message with install link | Check `wireguard.exe` exists BEFORE paying for session |
| D3 | No admin privileges | "Service registered but never reached RUNNING state" | WireGuard service installation requires Administrator | Pre-check admin before ANY session payment; provide self-elevation helper | Check admin at step 0, not step 5 |
| D4 | Windows `taskkill /F` kills Claude Code | Development environment dies during debugging | `taskkill /F /IM node.exe` kills ALL Node.js processes including Claude Code | Kill only by specific PID: `taskkill /F /PID <pid>` | NEVER use `/IM node.exe` -- always use `/PID` |
| D5 | Git Bash mangles `/F` flag | `taskkill /F /PID 32516` fails with "Invalid argument" | Git Bash converts `/F` to `F:/` (POSIX path conversion) | Use `//F` or `execFileSync` (bypasses shell) | Use `execFileSync` for all system commands, never string interpolation |
| D6 | Competing VPN applications | WireGuard tunnel fails; routing table conflicts | NordVPN/ExpressVPN/etc. have active tunnels, route overrides, port conflicts | Added VPN conflict detection in pre-connect diagnostic | Detect and warn about competing VPNs before connecting |
| D7 | WireGuard Manager Service ghost | WireGuard GUI takes over tunnel management; conflicts with programmatic control | `wireguard.exe /installmanagerservice` was called instead of `/installtunnelservice` | Never call `/installmanagerservice`; only use `/installtunnelservice` | SDK must only use direct tunnel service management |

### TESTING

| # | Failure Name | What Happened | Root Cause | Fix Applied | Prevention Rule |
|---|-------------|---------------|------------|-------------|-----------------|
| TS1 | 656 unit tests, zero working features | C# SDK declared "100/100 parity"; every feature broke on first real use | Unit tests used mock data; no test hit a real LCD endpoint or real node | Mandatory live chain smoke tests before any release | Run live chain integration tests, not just unit tests |
| TS2 | Mock data doesn't match real chain | Tests used clean integer prices; chain returns 18-decimal `sdk.Dec` values | Hand-crafted mock data instead of real LCD response snapshots | Copy-paste actual LCD responses into test fixtures | Use real chain response snapshots as test fixtures |
| TS3 | JSON round-trip failure | `GbPriceUdvpn = "5500000"` (string) serialized as integer; deserialized back as null | Unit tests never serialize-then-deserialize-then-use | Added round-trip serialization tests for all data models | Test full lifecycle: create -> serialize -> deserialize -> use |
| TS4 | Second attempt never tested | Reconnect to same node fails; first connection always works | No tests simulated: connect -> disconnect -> wait -> reconnect | Added integration tests for reconnection and crash recovery | Always test the SECOND attempt, not just the first |
| TS5 | Production-scale data breaks pagination | Plan with 147K subscribers; SDK fetches all (50MB) just to count | Test plans had 5 subscribers; nobody tested with large data | Use `pagination.limit=1&count_total=true` for counts (but count_total itself is broken -- see C2) | Test with production-scale data; not just toy datasets |
| TS6 | Parallel chain tests kill internet | Running JS + C# test suites simultaneously triggers LCD/RPC rate limits | Multiple HTTP clients hammering same endpoints in parallel | Always sequential: one SDK at a time, 7s between TXs, 60s between suites | NEVER run chain tests in parallel |
| TS7 | Same code + same node = same result | Retesting without implementing a fix wastes time and tokens | Hoping a transient failure will pass on retry; it never does | Rule: "What is DIFFERENT this time?" before any retest | Never retest without implementing a new solution first |

### DOCUMENTATION

| # | Failure Name | What Happened | Root Cause | Fix Applied | Prevention Rule |
|---|-------------|---------------|------------|-------------|-----------------|
| DC1 | 74% of SDK capability invisible to builders | ConnectAsync has 19 steps; docs describe 5 | Docs written before features; code improved; docs never updated | Comprehensive documentation of all internal steps and edge cases | Every code fix MUST include a doc update |
| DC2 | 154 suggestion files, none migrated to builder docs | Critical edge cases discovered and filed but never reach builders | Suggestions treated as internal notes, not source material for docs | Migration pipeline from suggestions to feature docs | Before saying "done," ask: can an AI reading only docs/ build this correctly? |
| DC3 | Cross-language mapping missing | JS `connectDirect()` = C# `ConnectAsync()` -- not documented anywhere | Each SDK documented independently with different names | Added cross-language reference table | Maintain JS <-> C# function name mapping document |
| DC4 | Error handling guide is JS-only | C# catch patterns not documented; all errors treated identically | C# error docs never written; only JS examples exist | C# error handling patterns with typed exceptions | Every feature doc must have examples in ALL supported languages |

### PARITY

| # | Failure Name | What Happened | Root Cause | Fix Applied | Prevention Rule |
|---|-------------|---------------|------------|-------------|-----------------|
| PR1 | Error code string mismatch | `SESSION_EXISTS` (JS) vs `SESSION_ALREADY_EXISTS` (C#) breaks cross-language apps | Each SDK chose "reasonable" names independently; no shared contract | Error code strings ARE the contract; must be identical | Compare error code counts and strings side-by-side before release |
| PR2 | C# missing 11 error codes | Apps can't distinguish `LCD_ERROR` from `TX_FAILED` in C# | Incremental JS feature additions without C# sync | Added all 11 missing codes to C# with matching string values | When adding ANY error code to JS, mirror to C# in same session |
| PR3 | C# missing severity classifications | `ErrorSeverity.IsRetryable("TUNNEL_SETUP_FAILED")` returns wrong answer | Only 11 of 22 codes classified in C#; rest return "unknown" | Added severity for all C# error codes | Every error code must have severity, user message, and recovery action |
| PR4 | Duplicate UserMessage methods in C# | `ErrorSeverity.UserMessage` and `Helpers.UserMessage` have different coverage | Two developers added user messages independently | Merged into single source of truth | One canonical location per concern |
| PR5 | Country map: JS 183 vs C# 80 | 100+ countries fail `CountryNameToCode()` silently in C# | JS built from complete ISO database; C# hand-typed | Expanded C# country map to match JS | Auto-generate shared data from single source file |
| PR6 | Speed test: JS 6-level fallback, C# 1 target | 43 WireGuard 0-speed failures in C# apps | C# has no DNS pre-resolve, no fallback targets, no rescue mode | Port JS speed test fallback chain to C# | When porting features, port the COMPLETE implementation including fallbacks |
| PR7 | Session poisoning: JS has it, C# doesn't | C# SDK tries to reuse broken sessions; fails again, wastes time | Feature added to JS only; never ported | Port `markSessionPoisoned()` / `isSessionPoisoned()` to C# | Every feature added to one SDK must be tracked for porting |
| PR8 | C# message type URLs wrong | 7 message type URLs don't match JS SDK's `MSG_TYPES` | "Describe and generate" instead of line-by-line translation | Updated all 7 to match JS SDK exactly | NEVER describe-and-generate when porting; translate line by line |

### SECURITY

| # | Failure Name | What Happened | Root Cause | Fix Applied | Prevention Rule |
|---|-------------|---------------|------------|-------------|-----------------|
| S1 | TLS verification disabled globally | All HTTPS node connections accept any certificate; trivial MITM | Sentinel nodes use self-signed certs; `rejectUnauthorized: false` used everywhere | Implemented TOFU (Trust-On-First-Use); save cert fingerprint on first connect | Use TOFU model; reject changed certificates |
| S2 | TOFU not wired into handshake path | TOFU exists in tls-trust.js but handshake still uses insecure agent | `v3protocol.js` imports its own `rejectUnauthorized: false` agent; TOFU agent bypassed | Wired `_tofuStore` through all 6 call sites (3 handshake, 3 status) | Verify security features are connected end-to-end, not just implemented |
| S2b | C# TOFU store not wired into SentinelVpnClient | All C# handshake + status calls used "accept all certs" fallback; TOFU was dead code | `SentinelVpnClient` never passed `tofuStore`/`nodeAddress` to `Handshake.HandshakeAsync()` or `NodeClient.GetStatusAsync()` — all 6 call sites bypassed | Added `TofuStore` to `SentinelVpnOptions`; wired `_tofuStore` + `nodeAddress` through all 6 call sites; added `NodeClient` missing `try/finally` for TOFU client disposal | Wire security features through ALL call sites; verify with grep, not assumption |
| S3 | 27 command injection surfaces | `execSync` with string interpolation allows shell injection via poisoned state | `state.v2rayPid` or `state.wgTunnelName` could contain shell metacharacters | Replace `execSync` with `execFileSync`; add input validation on state values | ALWAYS use `execFileSync` (array args); NEVER string interpolation for commands |
| S4 | 38 silent empty catches | Errors swallowed silently; no trace when things fail | `catch {}` blocks throughout 6 files; zero observability | Categorized each catch: expected (comment), unexpected (log), critical (throw) | Every catch must document WHY it's safe to swallow, or log the error |
| S9 | Bare catch swallows CancellationToken in C# | `OperationCanceledException` silently swallowed; cancellation never propagates | `DiscoverPlansAsync` and `GetProviderByAddressAsync` had bare `catch` blocks that caught ALL exceptions including cancellation | Added `catch (OperationCanceledException) { throw; }` before bare catch blocks | ALWAYS rethrow `OperationCanceledException` before any bare catch; cancellation must propagate |
| S5 | Kill switch state not persisted across crashes | After crash, user's internet permanently blocked by orphaned firewall rules | `_killSwitchEnabled` was in-memory only; `disableKillSwitch()` early-returns | Added `killSwitchEnabled` to state persistence; `recoverOrphans()` cleans up | Persist ALL security-critical state to disk; recover on startup |
| S6 | Kill switch partial failure locks down internet | 7 sequential firewall rules; failure after `blockoutbound` leaves system locked | No rollback on partial failure; first rule blocks all, subsequent rules allow exceptions | Wrapped in try-catch: if allow rules fail, immediately restore `allowoutbound` | Implement rollback for any multi-step security modification |
| S7 | Fire-and-forget EndSession races with Dispose | EndSession TX almost always fails; resources leaked | `DisconnectAsync()` fired EndSession as `_ = Task.Run()` then disposed HTTP client | Added `_pendingEndSession` field; `DisposeAsync` awaits it before disposing | Never fire-and-forget when subsequent code disposes the resources it needs |
| S8 | Dispose sets `_disposed` before DisconnectAsync completes | `ObjectDisposedException` thrown during disconnect cleanup | `_disposed = true` was set BEFORE calling `DisconnectAsync()`, which then checked `_disposed` and threw | Created `DisconnectInternalAsync(reason)` that skips disposed check; `_disposed` set AFTER disconnect completes | Set disposal flags AFTER cleanup completes, not before; create internal disconnect that skips the guard |

### INTEGRATION

| # | Failure Name | What Happened | Root Cause | Fix Applied | Prevention Rule |
|---|-------------|---------------|------------|-------------|-----------------|
| I1 | Shared VPN client for testing | Test disconnected user's active VPN; connection state leaked to UI | Single `SentinelVpnClient` instance shared between main connection and test | Create dedicated `SentinelVpnClient` per test with `ForceNewSession = true`; dispose after each test | NEVER share the main VPN client with test functions; create+dispose per test |
| I2 | CancellationToken kills speed test | Speed test cancelled mid-download; garbage speed numbers; next test also cancelled | CancellationToken propagated from scan loop to `HttpClient.GetByteArrayAsync()` inside speed test | Pass `CancellationToken.None` to speed test and Google check; only check `ct.IsCancellationRequested` BETWEEN phases | Speed test and Google check must run to completion once started; only scan loop is cancellable |
| I3 | Background refresh blocks test connections | Clicking "New Test" during background node probe hung indefinitely | Single chain client's HTTP connections saturated by 30 parallel status probes; new requests queued | Cancel `_refreshCts` before starting test scan | Cancel ALL background chain operations before starting a test scan |
| I4 | Progress counter stuck on errors | Progress bar and "X/Y tested" froze during scan | `_testDone++` was only in the success path; exception handler skipped the increment | Added `_testDone++` and `_testFailed++` in catch-all block | EVERY code path (success, error, cancel) must increment progress counter |
| I5 | testVpn null crash in finally block | NullReferenceException when connection failed before VPN client assigned | `testVpn` declared before try, assigned inside try, but finally always called `testVpn.DisconnectAsync()` | Null-check testVpn in finally; wrap disconnect AND dispose in separate try/catch | Declare VPN client as nullable BEFORE try; null-check in finally BEFORE calling disconnect |
| I6 | NullReferenceException on unrendered dashboard | App crashed when "New Test" clicked before dashboard fully rendered | Background loop referenced UI TextBlock elements (`_testProgressTb`) that were null because `RenderTestStats()` hadn't run yet | Null-check ALL UI references in background loops; add global crash handler | Null-check every UI element reference in background/async code |
| I7 | Stop button doesn't stop | User clicked Stop but test kept running for 15-30 seconds (full ConnectAsync duration) | `CancellationToken.Cancel()` only checked between nodes; SDK's internal async operations don't respond to cancellation mid-flight | Added `_testStopRequested` volatile flag checked at 4 points + force tunnel cleanup on stop | Use volatile bool flag checked at explicit points in flow, not just CancellationToken |
| I8 | Lambda factory pattern fails in WPF | Button click handlers silently didn't bind | WPF click event binding with lambda factory closures doesn't reliably work | Explicit button creation with direct `Click += async (_, _) =>` handlers | Create WPF buttons explicitly with direct event handlers, not factory patterns |
| I9 | Ternary in C# string interpolation | CS8361 compiler error from ternary inside `$""` string | C# string interpolation doesn't allow ternary without explicit parentheses `$"{(a ? b : c)}"` | Wrapped ternary expressions in parentheses or moved to variable | Always parenthesize ternaries inside C# string interpolation |
| I10 | Triple LCD probe on startup | Three independent LCD calls (LoadBalance + RefreshAllAsync + preload) serialized; 15s startup | Each component initiated its own chain query independently | Consolidated into single initialization with shared chain client | Coordinate chain queries at startup; never make 3 independent LCD calls for the same data |
| I11 | Page flickering during user interaction | UI re-rendered node list while user was browsing | Background refresh called `RenderNodes()` after updating `_allNodes` | Background refresh updates data but does NOT re-render; user clicks Refresh to see updates | NEVER re-render during user interaction; update data silently, render on user action |
| I12 | TextChanged fires during init | Null-check crash from UI element events firing before initialization complete | WPF TextChanged event fires when programmatically setting initial values | Null-check UI elements in all event handlers | Guard ALL event handlers against null UI elements during initialization |
| I13 | Double node probing on login | Nodes probed twice: once on app open, once on login | Separate probe triggers for app startup and login without deduplication guard | Added `_initDone` guard + `_nodesLoaded` cache | Use a guard flag to prevent duplicate initialization |
| I14 | Session not visible after disconnect | User disconnected but session tab showed no session | Session saved to chain but not to local cache on disconnect | Save session to local cache instantly on disconnect, before chain confirmation | Always update local cache optimistically on state changes |
| I15 | results.json format mismatch | C# DiskCache wraps results in `{"Data":[...], "SavedAt":"..."}` but Node Tester expects raw array | Different persistence patterns between JS (raw array) and C# (cache wrapper) | Strip wrapper on export; provide both formats | Define canonical result format (raw array); never wrap in metadata for cross-tool compatibility |
| I16 | C# bridge was cosmetic for months | SDK toggle showed "C#" but all code ran through JS; nobody noticed | No logging or verification that the C# code path was actually executing | Log `[C# SDK]` on every status/handshake call; verify code path, not label | Verify the code path actually executes, not just that the UI label is correct |
| I17 | transport_security 0-indexed vs 1-indexed | C# SDK returns 0=none/1=tls; JS expects 1=none/2=tls; all C# V2Ray tests used wrong TLS | Different enum offset conventions between languages; no comparison test | Added +1 offset remap in bridge wrapper | When bridging between languages, ALWAYS check numeric enum mappings with comparison tests |
| I18 | Session lookup scanning 500+ sessions | `waitForSessionActive` scanned ALL wallet sessions (500+) instead of querying by ID | Used broad session list query instead of direct session ID query | Pass session ID directly; query by specific ID | Always use the most specific query possible; never scan full list when you have the ID |
| I19 | V2Ray port pre-check referenced uninitialized variable | `useCached` referenced before initialization; server crashed on all retests | New code inserted in middle of function referenced variable defined later | Moved variable declaration before new code; tested locally before deploying | When inserting code into middle of function, verify variable scope; run locally before deploying |
| I20 | Aggressive port scanning crashed server | Port scan of 1000-65535 in step 100 overwhelmed server with concurrent connections | Too many parallel TCP connection attempts | Limited to probing 10-15 known common ports first; batch and limit | Port scanning must be batched (max 10-15 parallel); never scan full range |
| I21 | Node loading blocks UI for minutes | Users see "No nodes found" for 2-8 minutes while 1000+ nodes enriched with live status | `GetActiveNodesAsync()` + `Task.WhenAll(statusCalls)` blocks UI render until ALL status calls complete | Two-phase loading: Phase 1 renders chain data immediately (address + pricing); Phase 2 enriches with live status in background, fires event on complete | NEVER block UI on status enrichment; show chain data instantly, enrich in background |
| I22 | No loading state during async data fetch | Empty panels during 3-10s chain queries; users think app is broken | `await` called without any visual indicator; panel stays blank until data returns | Call `ShowLoadingState()` BEFORE every `await`; "No results" only shown after completed query returns zero items | Every async data load MUST show a loading indicator before the await |

### UX

| # | Failure Name | What Happened | Root Cause | Fix Applied | Prevention Rule |
|---|-------------|---------------|------------|-------------|-----------------|
| UX1 | No previous results on restart | App showed "No results yet" despite 135 results on disk | In-memory array empty on startup; DiskCache loaded but not rendered | Load cached results in `EnterApp()` BEFORE rendering test tab | On app startup, load and display cached results immediately; never show empty when data exists |
| UX2 | Binary PASS/FAIL instead of FAST/SLOW/FAIL | All passing nodes showed same green badge regardless of speed | Only two result categories: connected vs not connected | Changed to three-tier: FAST (green, >=10 Mbps), SLOW (amber, <10), FAIL (red) | Use three-tier speed badges: FAST/SLOW/FAIL, never binary PASS/FAIL |
| UX3 | GridLength negative crash in WPF | `MakeSessionRow` crashed from negative GridLength value | Progress bar calculation used `Math.Max(2, ...)` which created negative widths for remaining column | Clamp progress percentage to 0.01-0.99 range before creating GridLength | ALWAYS clamp progress values to 0.01-0.99 before creating proportional WPF grid columns |
| UX4 | Grid overlapping text in WPF | Left and right text elements rendered on top of each other | Two elements in Grid without explicit ColumnDefinitions | Always define explicit ColumnDefinitions for left/right layouts in WPF | NEVER put two elements in a WPF Grid without ColumnDefinitions -- they overlap |
| UX5 | No test run history | Each new scan's results replaced previous; no way to compare Monday vs Tuesday | No run archiving or history mechanism | Design: auto-save to `runs/YYYY-MM-DD_HH-MM/` with dropdown to load previous | Auto-archive every completed scan; provide dropdown to load and compare past runs |
| UX6 | No baseline measurement | Cannot distinguish slow node from slow user internet | No direct internet speed measurement before tunnel testing | Design: measure `speedtestDirect()` before scanning; store in `baselineHistory` | Always measure baseline (direct speed) before tunnel testing |
| UX7 | No token spend tracking during scan | User has no idea how much the test scan cost | Balance checked at start but no running delta calculated | Design: record balance before scan; show running spend | Track and display token spend: "Spent: X P2P (balance: Y -> Z)" |
| UX8 | Country flag rendering failure on native platforms | Empty boxes where flags should be on WPF | WPF (and Windows generally) cannot render emoji country flags; only browsers can | Built three-layer cache: memory -> disk -> download from flagcdn.com PNG | Document platform flag rendering: Web=emoji, WPF=PNG images, Swift=emoji works natively |
| UX9 | Test dashboard squeezed into sidebar | Full-width dashboard crammed into 360px sidebar panel | No layout guidance: "dashboard should take over main area, not sidebar" | Moved test dashboard to main content area | Node test dashboards are full-width; never squeeze into sidebar |
| UX10 | No click-to-copy on node addresses | Users had to manually select and copy node addresses | No clipboard integration on table rows | Added `MouseLeftButtonUp` handler for clipboard copy with visual feedback | Every node address in tables must be clickable to copy full address |
| UX11 | No expandable row diagnostics | Users cannot investigate why a specific node failed | No detail view for individual test results | Design: click row to expand and show full diagnostics (session ID, connect time breakdown, error details) | Provide expandable detail view for each test result |
| UX12 | Dedup results not implemented | Retesting a node appended a new row instead of replacing the old one | No upsert-by-address logic in results collection | Check `_testResults.Any(r => r.Address == node.Address)` before adding; `RemoveAll` on retest | Results must be deduplicated by node address; replace old result, never show duplicates |

### SPEED TEST

| # | Failure Name | What Happened | Root Cause | Fix Applied | Prevention Rule |
|---|-------------|---------------|------------|-------------|-----------------|
| SP1 | V2Ray SOCKS5 connection reuse fails | First speed download through SOCKS5 worked; subsequent hung until timeout | V2Ray SOCKS5 proxy doesn't handle HTTP keep-alive correctly; connection pool stalls | Create fresh `SocksProxyAgent` (JS) or `HttpClient+HttpClientHandler` (C#) per request | NEVER reuse HTTP client for V2Ray SOCKS5 requests; create fresh per request |
| SP2 | V2Ray SOCKS5 connectivity pre-check missing | Speed test failed silently because SOCKS5 binding is asynchronous; proxy not ready | No verification that SOCKS5 tunnel was actually routing traffic before measuring speed | Added 3-attempt connectivity check (6 targets: google, cloudflare, 1.1.1.1, httpbin, ifconfig, ip-api) with 5s pause between | ALWAYS verify SOCKS5 connectivity with multi-target check before speed testing |
| SP3 | V2Ray preflight consumed tunnel | Preflight 1KB download via separate SocksProxyAgent consumed V2Ray's SOCKS5 connection; speed test's second agent failed with TLS disconnect | Multiple SocksProxyAgent instances competing for same V2Ray tunnel | Removed separate preflight; speed test probe (2MB) acts as connectivity test; `arraybuffer` mode instead of `stream` | Never use separate preflight through V2Ray SOCKS5; let speed test probe serve as connectivity check |
| SP4 | DNS failures behind WireGuard tunnels | `speedtestDirect` tried hostname URLs first; DNS failed through tunnel; 56/338 nodes showed ENOTFOUND | WireGuard tunnel broke DNS resolution for speed test hostnames | Pre-resolve Cloudflare IP before installing tunnel; try IP-based URL FIRST when cached IP available | ALWAYS pre-resolve speed test hostnames BEFORE installing WireGuard tunnel |
| SP5 | Speed test fallback chain incomplete in C# | 43 WireGuard nodes showed 0 speed in C# apps | C# had only 1 speed target, no DNS pre-resolve, no fallback chain, no rescue mode | Ported complete 7-level fallback: probe -> multi-request -> OVH -> Tele2 -> rescue -> google-fallback -> connected-no-throughput | Port the COMPLETE speed test fallback chain, not just the primary target |
| SP6 | Speed test `arraybuffer` vs `stream` mode | Speed test returned 0 bytes through V2Ray when using `responseType: 'stream'` | `stream` mode interacts differently with SocksProxyAgent than `arraybuffer` | Changed speedtestViaSocks5 to `arraybuffer` mode (matching what works in test-v2ray.js) | Use `arraybuffer` mode for all SOCKS5 speed test downloads |
| SP7 | V2Ray process needs post-handshake warmup | Speed test returned 0 immediately after V2Ray handshake | Node needs time to register UUID after handshake completes | Added 10s post-handshake delay for V2Ray before speed test | Wait 10s after V2Ray handshake before testing connectivity or speed |
| SP8 | Native fetch silently ignores SOCKS5 agent | Node.js `fetch` (undici) produced opaque failures through SOCKS5; speed test silently measured nothing | Node.js 18+ uses undici fetch adapter which ignores `agent` option for SOCKS5 proxies | Used `axios` with explicit `httpAgent` + `httpsAgent` for all SOCKS5 traffic | MUST use axios (not native fetch) for SOCKS5 proxy traffic in Node.js |

### PRICING

| # | Failure Name | What Happened | Root Cause | Fix Applied | Prevention Rule |
|---|-------------|---------------|------------|-------------|-----------------|
| PR9 | BaseValue shows 18-decimal garbage | Price displayed as `52573.099722991367791000000000/GB` | Used `BaseValue` (Cosmos `sdk.Dec` with 18 decimal places) instead of `QuoteValue` (clean integer) | Always use `QuoteValue` for display; document the difference prominently | ALWAYS use `quote_value` (integer udvpn), NEVER `base_value` (18-decimal sdk.Dec) |
| PR10 | PreferHourly creates wrong sessions | SDK silently creates GB sessions when hourly requested | SDK bug: `PreferHourly` flag was ignored internally; always defaulted to GB | Documented as known SDK bug; use explicit `Gigabytes = 1` as fallback for hourly | Verify SDK actually creates the session type requested; don't trust flags blindly |
| PR11 | Session payment mode not exposed by chain | Cannot determine if session is GB-based or hourly from chain data | Chain `max_bytes` is always `1000000000` and `max_duration` is always `"0s"` regardless of payment mode | Built `SessionTracker` to persist payment mode locally | Consumer apps MUST track payment mode locally; chain data does not distinguish GB vs hourly |
| PR12 | Estimated cost shows insane numbers | "Est. Cost: 20,000 P2P" shown for a test scan | Sum of ALL viable node prices (500 nodes * 40 P2P) displayed as total | Change to show actual spent per scan or per-node average | Calculate estimated cost as `tested * avgNodePrice`, not `totalViable * nodePrice` |

### DOCUMENTATION (continued)

| # | Failure Name | What Happened | Root Cause | Fix Applied | Prevention Rule |
|---|-------------|---------------|------------|-------------|-----------------|
| DC5 | Docs describe non-existent code | AI spent 10+ hours trying to use `NodeTester` class, `IVpnTestAdapter`, `createNodeTestAdapter()` -- none exist | Documentation written as design spec but presented as if documenting existing code; no IMPLEMENTED vs SPEC labels | Added status labels; replaced spec references with working code | Label EVERY class/function in docs as IMPLEMENTED or SPEC ONLY; grep codebase to verify |
| DC6 | No C# integration guide | AI reverse-engineered 6,500 lines of JS to build C# integration; 54% of time wasted | Node Tester docs are JS-only; no C# function mapping, no WPF-specific gotchas | Created complete C# integration report with working code | Every integration guide must include working code in BOTH JS and C# |
| DC7 | Country map only in index.html | Country-to-code mapping embedded in client-side HTML; not importable as module | `_CC` lookup table defined at line 688 of index.html; no `core/countries.js` export | Built separate country map with 120+ entries | Export shared data (country map, constants, thresholds) as importable modules, not embedded in HTML |
| DC8 | No cross-language function mapping | `nodeStatusV3()` (JS) = `NodeClient.GetStatusAsync()` (C#) -- no mapping document | Each SDK documented independently with different names | Created JS-to-C# function mapping table | Maintain cross-language function mapping table for every documented function |
| DC9 | Test result schema undocumented | AI reverse-engineered 30+ fields from `results.json` with wrong field names | No schema document; result shape varies between WG and V2Ray; optional fields not marked | Created complete result schema with real mainnet examples | Document result schema with types, optionality, and REAL JSON examples from mainnet tests |
| DC10 | Dashboard layout not specified | AI read 700-line HTML and tried to translate to WPF; layout intent lost | No layout specification; dashboard exists only as interleaved HTML+CSS+JS | Created `DASHBOARD-SPEC.md` with exact widths, alignments, data sources | Provide visual layout specification separate from implementation; not just source code |
| DC11 | Speed test evolved past documentation | Docs describe 3-target basic flow; real code has 7-level fallback chain | Speed test gained rescue mode, google-fallback, connected-no-throughput through iterative fixes; docs never updated | Documented all 7 speed test methods with decision logic | Update speed test documentation after EVERY fallback addition |
| DC12 | User journeys not documented | Basic features missing (load previous results, export, sort) because nobody walked through user flows | Docs describe WHAT the dashboard shows, not WHAT THE USER DOES across sessions | Defined 5 user journeys: first use, return visit, share results, investigate failure, compare over time | Document user journeys (multi-session workflows), not just features |

### TESTING (continued)

| # | Failure Name | What Happened | Root Cause | Fix Applied | Prevention Rule |
|---|-------------|---------------|------------|-------------|-----------------|
| TS8 | Blind retesting 5+ times without fixes | Same 24 nodes run through same code 5 times; all failed identically | Hoping transient failures would pass on retry; they never did | Rule: "What is DIFFERENT this time?" -- must name a specific code change before any retest | NEVER retest without implementing a specific fix; write down what changed |
| TS9 | "Node-side" dismissal of 8 failures | 8 failures dismissed as node problems; all 8 were code bugs | Assumed nodes with weird behavior were broken, not our code | Iron Rule: peers > 0 = OUR fault. Investigated all 8 and found: stale cache, batch mapping, premature rejection, missing UUID wait | NEVER say "node-side" if peers > 0; other clients connect, so a working code path exists |
| TS10 | Stopped running audit to apply code fixes | Killed mid-audit server; lost 130 C# results permanently | Wanted to deploy fix immediately rather than waiting for natural restart | Auto-save results before ANY restart; code fixes wait for next natural restart | NEVER stop a running audit to apply fixes; save results first, deploy fix on next natural restart |
| TS11 | TCP port unreachable but peers connected | 10 nodes showed "port closed" but had 3-7 active peers | TCP probe timeout too short; DNS resolution differs; possible rate limiting from rapid-fire probes | Increase probe timeout; try alternate `remote_addrs`; handle rate limiting | Increase TCP probe timeout for distant nodes; try all `remote_addrs` before declaring unreachable |
| TS12 | SOCKS5 tunnel established but no connectivity | 5 V2Ray nodes with handshake success + SOCKS5 bind but zero internet through tunnel; all had 3-15 peers | V2Ray 5.2.1 may have grpc/quic bugs; connectivity targets may be blocked by node's egress policy; VMess AEAD may silently fail | Try newer V2Ray versions; test with alternate connectivity targets | Verify tunnel actually passes traffic before declaring connected; don't trust SOCKS5 port binding alone |
| TS13 | Clock drift nodes skipped but peers connected | 4 VMess-only nodes with >120s drift skipped entirely despite having 4-6 active peers | Assumed clock drift = permanent failure; peers may use VLess or have different auth | Try VLess outbound even on "VMess-only" nodes; verify VLess detection is complete | Before skipping for clock drift, verify node truly has NO VLess outbounds; peers may use a protocol we don't detect |
| TS14 | V2 format metadata rejection | Most popular node (48 peers) rejected because it returned v2 metadata format | SDK threw error on old `{protocol, tls, ca}` fields instead of mapping to v3 | Added v2-to-v3 field mapper | NEVER reject metadata outright -- map old formats to new; if 48 peers connect, the data is usable |
| TS15 | Session 500+ scan bottleneck | `waitForSessionActive` took 5+ minutes per node during retests | Function scanned ALL wallet sessions (500+) via broad LCD query instead of querying by specific session ID | Pass session ID directly; use `GET /sentinel/session/v3/sessions/{id}` | Always use direct session ID lookup, not full wallet session scan |

---

## Failure Statistics

| Category | Count | Most Common Root Cause |
|----------|-------|----------------------|
| Protocol | 12 | Transport config mismatch with sentinel-go-sdk server |
| Chain | 14 | v2/v3 field name changes, broken LCD endpoints |
| Tunnel | 16 | WireGuard Windows service lifecycle, crash recovery |
| Wallet | 3 | Unsafe defaults, missing state in early-return paths |
| Timing | 6 | Chain propagation lag, session lifecycle delays |
| Configuration | 8 | Wrong defaults for development, field naming |
| Dependencies | 7 | Missing admin, wrong binary versions, competing software |
| Testing | 15 | Mock data != real chain, blind retesting, "node-side" dismissals |
| Documentation | 12 | Docs lag behind code, specs disguised as docs, no cross-language mapping |
| Parity | 8 | Incremental additions without cross-language sync |
| Security | 7 | Silent swallowing, unconnected security features |
| Integration | 20 | Shared state, cancellation propagation, async coordination |
| UX | 12 | Missing data persistence across restarts, platform rendering gaps |
| Speed Test | 8 | SOCKS5 connection reuse, missing fallback chain, DNS behind tunnel |
| Pricing | 4 | BaseValue vs QuoteValue, session mode not on chain |
| **Total** | **152** | |

---

## The 14 Questions to Ask Before Every Change

From the C# SDK debacle (656 tests, 12 critical bugs) and Handshake dVPN integration (135 nodes, 27 problems):

1. **"Does this work on the second attempt?"** -- Test reconnect, retry, recovery
2. **"Does this use real chain data format?"** -- Test with actual LCD responses, not mocks
3. **"Does this survive serialization round-trip?"** -- Serialize -> deserialize -> use
4. **"Does this have silent side effects?"** -- Fee grants, proxy changes, route modifications
5. **"Does this pay tokens before verifying success is possible?"** -- Pre-verify everything
6. **"Does this parse ALL available fields?"** -- Map every chain field, not just the minimum
7. **"Does this work at production scale?"** -- 100K subscribers, 900 nodes, 150K TXs
8. **"Does the test verify the OUTPUT or just the INPUT?"** -- Check the broadcast TX bytes, not the flag value
9. **"Does this work on app restart?"** -- Data must persist across close/open cycle
10. **"Does the user see their data from last session?"** -- Never show empty when data exists on disk
11. **"Can an AI reading only the docs build this correctly?"** -- If docs reference non-existent code, they cause more harm than no docs
12. **"Is every code path ported from the reference?"** -- Copy ALL waits, sleeps, and fallbacks, not just the happy path
13. **"What is DIFFERENT this time?"** -- Before any retest, name the specific code change
14. **"Does this code path actually execute?"** -- Verify with logs, not labels; the C# bridge was cosmetic for months

---

## Source Projects

Every finding traces back to a specific project. This section documents the source for traceability.

### Handshake dVPN (C# WPF)
**Files:** `handshake-RETROSPECTIVE.md`, `handshake-STANDARDS.md`, `handshake-CLAUDE.md`, `handshake-MANIFESTO.md`, `handshake-AI-NODE-TEST-INTEGRATION.md`
**Findings:** I1-I15, UX1-UX12, SP1-SP8, PR9-PR12, DC5-DC12, TS8-TS10
**Summary:** 26-hour build, 135 mainnet nodes tested (118 pass, 17 fail). 54% of time wasted on undocumented issues. Discovered that C# integration requires completely reimplementing speed test, flag rendering, disk cache, and session tracking from scratch due to missing SDK components.

### Node Tester (JS Express)
**Files:** `node-tester-HANDOFF.md`, `node-tester-CLAUDE.md`, all 12 `node-tester-suggestion-*.md` files
**Findings:** P1-P12, C1-C14, T1-T16, TM1-TM6, TS1-TS7, TS11-TS15, I16-I20, DC7, DC10, DC11
**Summary:** 2200+ node tests across JS and C# SDKs. Found 24 protocol bugs. Proved Iron Rule: every node with peers > 0 that failed was our bug, not node-side. Documented complete speed test fallback chain, V2Ray config building, clock drift detection, and WireGuard lifecycle management.

### Test2 (JS SDK Proving Ground)
**Files:** `test2-CLAUDE.md`
**Findings:** P7-P9, CF1-CF4, W1-W3, D1-D4
**Summary:** First consumer of JS SDK. Discovered autoReconnect was completely broken, BigInt serialization crash, broadcast name collision, fullTunnel default bricking AI's internet, and missing cleanup handler registration.

### ClaudeDVPN / C# SDK (EXE)
**Findings:** C1-C14, PR1-PR8, S1-S7, TS1-TS3, DC1-DC4
**Summary:** 656 unit tests passing with zero working features on mainnet. Proved that unit tests are meaningless without live chain integration tests. Found all v2/v3 field name mismatches, MsgEndSession not registered, 27 command injection surfaces, and parity gaps.

### One-Shot Buildability Analysis
**Files:** `node-tester-suggestion-one-shot-buildability-analysis.md`
**Findings:** Wall 1-7 analysis identifying fundamental barriers to AI building node testers: batch payment not in SDK, session reuse complexity, V2Ray config minefield, clock drift detection, WireGuard admin requirement, fragile speed testing through tunnels, pipeline resilience.

### Undiagnosed Failures Report
**Files:** `node-tester-suggestion-undiagnosed-failures.md`
**Findings:** TS11-TS14 (22 nodes with active peers: 10 TCP unreachable, 5 SOCKS5 no connectivity, 4 clock drift skips, 1 v2 format metadata, 2 handshake failures). Total ~130 active users connected to these "failing" nodes. All failures are in our code, not nodes.

---

## Pending Integration

### [PENDING] fix-registry-backup.md
**Category:** BUG-FIX
**Summary:** `setSystemProxy()` overwrites Windows proxy settings with `/f` (force), no backup/restore of previous state. If user had corporate proxy, `clearSystemProxy()` sets "no proxy" instead of restoring their previous configuration.
**Action:** Review and integrate into T10/T11 entries above (proxy restore overwrites user's previous proxy).

### [PENDING] fix-registry-backup.md
**Category:** BUG-FIX
**Summary:** **Status:** SUGGESTION — needs review **Date:** 2026-03-09 **Severity:** HIGH — current implementation force-overwrites, no restore to previous state **File affected:** `js-sdk/node-connect.js` lines 79-124 `setSystemProxy()` overwrites Windows proxy settings with `/f` (force):
**Action:** Review and integrate into main documentation above

### [PENDING] fix-registry-backup.md
**Category:** BUG-FIX
**Summary:** **Status:** SUGGESTION — needs review **Date:** 2026-03-09 **Severity:** HIGH — current implementation force-overwrites, no restore to previous state **File affected:** `js-sdk/node-connect.js` lines 79-124 `setSystemProxy()` overwrites Windows proxy settings with `/f` (force):
**Action:** Review and integrate into main documentation above
