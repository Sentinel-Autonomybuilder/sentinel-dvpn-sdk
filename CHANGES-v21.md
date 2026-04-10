# v21 Change Log — Performance + SentinelClient Class

**Date:** 2026-03-09
**Files changed:** 7 modified, 1 new
**Tests:** 275 pass (was 251)
**Exports:** 109 (was 108)

This document exists for debugging. If a bug appears in v21+, check whether any of these changes caused it.

---

## Change 1: Reduced Fixed Sleeps (node-connect.js)

**What:** Replaced two `sleep(5000)` calls in the connection critical path.

**WireGuard path (setupWireGuard):**
- **Before:** `await sleep(5000)` then install tunnel once.
- **After:** Exponential retry — try install at 1.5s, 3s, 5s (total budget 5s same as before). If install fails, retry at next interval. Most nodes are ready in 1-2s.
- **Risk:** If a node takes exactly 4s to register a peer, the first two attempts fail and waste time on failed install attempts. Net effect is still <=5s total wait, so worst case is same as before.

**V2Ray path (setupV2Ray):**
- **Before:** `await sleep(5000)` after handshake.
- **After:** `await sleep(2000)` — reduced to 2s because the V2Ray outbound loop already has its own readiness checks (`waitForPort` + SOCKS5 connectivity test per outbound).
- **Risk:** If a node takes >2s to register the UUID, the first outbound test may fail. But the loop tries multiple outbounds anyway, and each has its own timeout. In 400+ node tests, UUID registration was consistently <2s.

**If bugs appear:** Look for "tunnel install attempt N failed" in logs. If all 3 WG attempts fail but the tunnel would have worked at 5s, increase `installDelays` array. For V2Ray, if the first outbound always fails but later ones succeed, increase the 2000ms sleep.

---

## Change 2: Parallelized Wallet + RPC + LCD (node-connect.js:connectInternal)

**What:** Three sequential network calls now run in parallel.

**Before (sequential):**
```
createWallet()          → 300ms
privKeyFromMnemonic()   → 300ms
createClient(rpc)       → 1-3s
getBalance()            → 1-2s
fetchNodeFromLcd()      → 1-3s
                          Total: 3-9s
```

**After (parallel):**
```
Promise.all([createWallet, privKeyFromMnemonic])  → 300ms (parallel)
Promise.all([createClient, fetchNodeFromLcd])     → 1-3s (parallel, was sequential)
getBalance()                                      → fire-and-forget (background)
                                                    Total: 1.5-4s
```

**Specific changes:**
1. `createWallet` + `privKeyFromMnemonic` run in `Promise.all` (both derive from same mnemonic, independent)
2. RPC connect + LCD lookup run in `Promise.all` (independent network calls)
3. Balance check is fire-and-forget — result shown when ready, doesn't block connection

**Risk:** If RPC fails but LCD succeeds, the error from RPC is thrown immediately (Promise.all rejects on first error). Before, the user would see the LCD result first, then RPC error. Now they see the RPC error without the LCD result. This is fine — the connection can't proceed without RPC anyway.

**If bugs appear:** If balance never shows up in logs, check the fire-and-forget `.catch(() => {})`. If you need balance to block (e.g., "insufficient funds" check before paying), make it awaited again.

---

## Change 3: Wallet Derivation Cache (node-connect.js)

**What:** `cachedCreateWallet()` caches wallet derivation results keyed by first 16 hex chars of SHA256(mnemonic).

**Why:** `DirectSecp256k1HdWallet.fromMnemonic()` does BIP39 seed + SLIP-10 key derivation (~300ms). Same mnemonic always produces the same wallet. On disconnect/reconnect, this saves 300ms.

**Implementation:** Module-level `Map` (`_walletCache`). Key is `sha256(mnemonic).substring(0, 16)` — avoids storing the mnemonic itself.

**Risk:** If the cache holds a reference to a wallet object that becomes stale (shouldn't happen — wallet is stateless), reconnects may fail. Clear cache by restarting the process.

**If bugs appear:** If wallet operations fail after reconnect, bypass cache by using `createWallet()` directly instead of `cachedCreateWallet()`.

---

## Change 4: Node List Cache (node-connect.js:queryOnlineNodes)

**What:** `queryOnlineNodes()` caches results for 5 minutes. On cache hit, returns instantly and refreshes in background.

**Implementation:**
- Module-level `_nodeCache = { nodes, timestamp, key }`
- Cache key = `${lcdUrl}_${serviceType}_${maxNodes}`
- TTL = 5 minutes (`NODE_CACHE_TTL`)
- On cache hit: return cached, fire background refresh (don't await)
- On cache miss: fetch fresh, save to cache

**Opt-out:** Pass `{ noCache: true }` to force a fresh fetch.

**Risk:** Stale cache returns nodes that went offline in the last 5 minutes. The connection will fail on handshake, which is handled by existing error recovery. Background refresh may fail silently (caught with `.catch(() => {})`).

**If bugs appear:** If stale node data causes issues, reduce `NODE_CACHE_TTL` or add `noCache: true`. The cache is in-memory only — restart clears it.

---

## Change 5: SentinelClient Class (NEW: client.js)

**What:** Instantiable class wrapping the functional API. Addresses Meta "global singleton" finding.

**Design decisions:**
1. **Wrapper, not rewrite:** SentinelClient delegates to `connectDirect`, `connectViaPlan`, `disconnect`, etc. It does NOT duplicate the connection logic.
2. **Own EventEmitter:** Each instance gets its own `EventEmitter`. Module-level `events` are forwarded to all instances via listeners.
3. **DI via constructor:** `{ rpcUrl, lcdUrl, logger, tlsTrust, timeouts, v2rayExePath }`. Per-call options override constructor defaults.
4. **Cached wallet/client:** `getWallet()` and `getClient()` cache results per-instance.
5. **`destroy()` cleanup:** Removes event forwarding listeners. MUST be called when discarding an instance, otherwise module-level listeners leak.

**Limitation (documented in JSDoc + TypeScript):** WireGuard and V2Ray tunnels are OS-level singletons. Only one SentinelClient can have an active tunnel at a time. Multiple instances can query nodes, check balances, and broadcast TXs concurrently.

**Risk:**
- Event forwarding creates N listeners on `sdkEvents` for N clients. If many clients are created without `destroy()`, this causes a listener leak. Node.js warns at 10 listeners by default.
- Constructor defaults + per-call merge: if a user passes `{ mnemonic: undefined }` explicitly, it overrides the constructor default. This is standard spread behavior but could surprise.

**If bugs appear:**
- "MaxListenersExceededWarning" → Too many SentinelClient instances without `destroy()`. Call `destroy()` when done.
- Events firing on wrong client → The forwarding mechanism forwards ALL module-level events to ALL instances. This is by design (underlying API is singleton). If you need isolated events, check `nodeAddress` in the event payload.

---

## Change 6: Import Addition (node-connect.js)

**What:** Added `import { sha256 as _sha256 } from '@cosmjs/crypto'` for wallet cache keying.

**Risk:** This import already exists in v3protocol.js. If `@cosmjs/crypto` is not installed, the import fails at load time. This is caught by existing npm install + postinstall.

---

## Files Modified

| File | Changes |
|------|---------|
| `node-connect.js` | Parallel wallet/RPC/LCD, wallet cache, node cache, sleep reduction, sha256 import |
| `client.js` | **NEW** — SentinelClient class |
| `index.js` | Export SentinelClient |
| `index.d.ts` | TypeScript for SentinelClient, SentinelClientOptions |
| `test/smoke.js` | 24 new tests (SentinelClient class) |
| `CHANGELOG.md` | v21 entry |
| `SDK-FEATURES.md` | Updated with SentinelClient docs |
| `README.md` | Updated file list, export count, test count |

---

## How to Revert Individual Changes

Each change is independent. To revert:

1. **Sleep reduction:** Replace `installDelays` loop with `await sleep(5000)` + single `installWgTunnel()`. Replace V2Ray `sleep(2000)` with `sleep(5000)`.
2. **Parallelization:** Replace `Promise.all` blocks with sequential awaits. Make `getBalance` await instead of fire-and-forget.
3. **Wallet cache:** Replace `cachedCreateWallet` calls with `createWallet`.
4. **Node cache:** Remove the cache check in `queryOnlineNodes`, call `_queryOnlineNodesImpl` directly.
5. **SentinelClient:** Remove `client.js`, remove export from `index.js`, remove from `index.d.ts`.
