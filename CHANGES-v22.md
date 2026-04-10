# v22 Change Log — V2Ray Config Fixes (780-Node Test Data)

**Date:** 2026-03-09
**Files changed:** 3 modified (v3protocol.js, node-connect.js, defaults.js), 1 modified (test/smoke.js)
**Tests:** 289 pass (was 275)
**Exports:** 109 (unchanged)

This document exists for debugging. If a bug appears in v22+, check whether any of these changes caused it.

---

## Change 1: QUIC Transport Fix (v3protocol.js:buildV2RayClientConfig)

**What:** Changed QUIC `security` from `chacha20-poly1305` to `none` in both global transport and per-outbound streamSettings.

**Root cause:** The sentinel-go-sdk server uses `security: 'none'` for QUIC header obfuscation. Our config was sending `chacha20-poly1305`, causing a mismatch — V2Ray encrypted the QUIC header while the server expected plaintext. Connection never established (0/4 pass rate, all nodes had 4-15 active peers).

**Note:** This does NOT disable encryption. QUIC runs over TLS — all data is still encrypted at the transport layer. The `security` field only controls an additional header obfuscation layer on top.

**Changes:**
1. Global transport `quicSettings`: `{ security: 'chacha20-poly1305' }` → `{ security: 'none', key: '', header: { type: 'none' } }`
2. Per-outbound: Added `streamSettings.quicSettings = { security: 'none', key: '', header: { type: 'none' } }` when `network === 'quic'`

**Risk:** If any Sentinel node actually uses chacha20 header obfuscation, that node will fail. From 780-node test data, no node uses it — all QUIC nodes expect `none`.

**If bugs appear:** If a specific QUIC node fails with this fix but worked before, that node may use `chacha20-poly1305`. Check the node's V2Ray server config. Per-outbound settings override global, so you could detect and set per-node.

---

## Change 2: v2-Format Metadata Mapping (v3protocol.js:buildV2RayClientConfig)

**What:** Instead of throwing when v2-format metadata is detected, map v2 fields to v3 equivalents.

**Before:** `throw new Error('Node returned v2-format metadata...')`
**After:** Map fields inline, then continue with normal config generation.

**Mapping:**
| v2 Field | v2 Value | v3 Field | v3 Value |
|----------|----------|----------|----------|
| `protocol` | 1 (VMess) | `proxy_protocol` | 2 |
| `protocol` | 2 (VLess) | `proxy_protocol` | 1 |
| `tls` | 0/false | `transport_security` | 1 (none) |
| `tls` | 1/true | `transport_security` | 2 (TLS) |
| (absent) | — | `transport_protocol` | 7 (tcp default) |

**Why the protocol numbers are swapped:** v2 and v3 use opposite numbering for VMess/VLess. Confirmed against sentinel-go-sdk source.

**Risk:** If v2 metadata has fields we don't map (e.g. custom transport types), the default tcp fallback may be wrong. From test data, the one v2 node (TCSR-Station, 48 peers) only uses tcp, so this is safe.

**If bugs appear:** If a v2 node connects but traffic doesn't flow, the protocol mapping may be wrong. Check if the node uses VMess or VLess and verify the `proxy_protocol` assignment. To revert: replace the mapping loop with the original `throw new Error(...)`.

---

## Change 3: Transport Priority Update (v3protocol.js:buildV2RayClientConfig)

**What:** Updated transport sort order to match 780-node test results.

**Before:**
```
grpc/none → priority 5
quic/tls  → priority 6
quic/none → priority 7
grpc/tls  → priority 8
```

**After:**
```
grpc/none → priority 5  (87%, was listed as 58%)
unknown   → priority 7
grpc/tls  → priority 8  (0%)
quic/tls  → priority 9  (0% on V2Ray 5.2.1)
quic/none → priority 10 (0% on V2Ray 5.2.1)
```

**Key change:** QUIC moved from mid-priority (6-7) to last (9-10). With the QUIC fix applied (Change 1), QUIC may start working — but until verified, it should be tried last.

**Risk:** None. This only affects sort order — all transports are still tried. Worst case: a working QUIC outbound is tried after tcp/ws/grpc instead of before.

**If bugs appear:** If QUIC starts working reliably after Change 1, consider moving it back up to priority 6-7. Update the comment with new success rate data.

---

## Change 4: Handshake Timeout 30s → 45s (v3protocol.js)

**What:** Both `initHandshakeV3()` and `initHandshakeV3V2Ray()` timeout increased from 30s to 45s.

**Why:** 1 node out of 780 timed out at exactly 30s (`ECONNABORTED`) despite having 4 active peers. Distant nodes or nodes under load need more time for TLS + session negotiation.

**Risk:** Slow-failing nodes take 15s longer before erroring. Builders can override via their own axios timeout.

**If bugs appear:** If connections feel sluggish due to slow error cases, reduce back to `30_000`.

---

## Change 5: defaults.js Transport Rates Updated (defaults.js)

**What:** `TRANSPORT_SUCCESS_RATES` updated from 780-node test data.

**Key changes:**
- `tcp/tls` → `tcp` (key renamed, rate unchanged at 1.00, sample 169→274)
- `grpc/none` rate: 0.58→0.87, sample: 83→81
- `quic/tls` → `quic` (key renamed, rate: 0.55→0.00 with note about chacha20 bug)
- All sample sizes updated to 780-node data

**Risk:** None — this is reference data only. `buildV2RayClientConfig()` uses its own sort order, not these rates.

---

## Change 6: extremeDrift VLess Preference (node-connect.js:setupV2Ray)

**What:** When clock drift >120s, outbounds are re-sorted to put VLess before VMess.

**Why:** VMess uses AEAD with timestamps — rejects packets with >120s drift. VLess doesn't use timestamps, so it's immune. Previously `extremeDrift` was detected and logged but the config wasn't reordered, making it dead code.

**Implementation:** After `buildV2RayClientConfig()`, sort outbounds by `protocol === 'vless' ? 0 : 1`. Update routing rule to point to the first (now VLess) outbound.

**Risk:** If a node has only VMess outbounds, sorting is a no-op (the earlier check already throws for VMess-only + extremeDrift). If VLess outbounds exist but are on a worse transport, we try them first anyway — better than guaranteed VMess AEAD failure.

**If bugs appear:** If VLess-first causes issues on specific nodes, remove the sort block. The pre-existing check at line 812 still throws for VMess-only nodes with drift.

---

## How to Revert Individual Changes

1. **QUIC fix:** Revert global `quicSettings` to `{ security: 'chacha20-poly1305' }`. Remove the `if (network === 'quic')` block in per-outbound streamSettings.
2. **v2 metadata:** Replace the mapping `for` loop with `throw new Error('Node returned v2-format metadata...')`.
3. **Transport priority:** Restore `quic/tls → 6, quic/none → 7, grpc/tls → 8` and the old comment.
4. **Handshake timeout:** Replace `timeout: 45_000` with `timeout: 30_000` in both handshake functions.
5. **defaults.js rates:** Restore old key names and rates.
6. **extremeDrift sort:** Remove the `if (extremeDrift && config.outbounds.length > 1)` block in `setupV2Ray()`.
