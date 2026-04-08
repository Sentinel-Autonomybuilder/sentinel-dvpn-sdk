/**
 * Sentinel v3 Protobuf Encoding & Message Encoders
 *
 * Manual protobuf encoding — avoids needing proto-generated code for v3 types.
 * Field tag = (field_number << 3) | wire_type  (0=varint, 2=length-delimited)
 *
 * Contains:
 *   - Encoding primitives (encodeVarint, protoString, protoInt64, protoEmbedded)
 *   - Value converters (decToScaledInt, encodePrice, encodeDuration)
 *   - ALL message encoders (MsgStartSession, MsgEndSession, subscriptions, node ops, plan details)
 */

// ─── Encoding Primitives ────────────────────────────────────────────────────

export function encodeVarint(value) {
  let n = BigInt(value);
  if (n < 0n) throw new RangeError(`encodeVarint: negative values not supported (got ${n})`);
  const bytes = [];
  do {
    let b = Number(n & 0x7fn);
    n >>= 7n;
    if (n > 0n) b |= 0x80;
    bytes.push(b);
  } while (n > 0n);
  return Buffer.from(bytes);
}

export function protoString(fieldNum, str) {
  if (!str) return Buffer.alloc(0);
  const b = Buffer.from(str, 'utf8');
  return Buffer.concat([encodeVarint((BigInt(fieldNum) << 3n) | 2n), encodeVarint(b.length), b]);
}

export function protoInt64(fieldNum, n) {
  if (n === null || n === undefined) return Buffer.alloc(0);
  return Buffer.concat([encodeVarint((BigInt(fieldNum) << 3n) | 0n), encodeVarint(n)]);
}

export function protoEmbedded(fieldNum, msgBytes) {
  if (!msgBytes || msgBytes.length === 0) return Buffer.alloc(0);
  return Buffer.concat([encodeVarint((BigInt(fieldNum) << 3n) | 2n), encodeVarint(msgBytes.length), msgBytes]);
}

// ─── Value Converters ───────────────────────────────────────────────────────

/**
 * Convert sdk.Dec string to scaled big.Int string (multiply by 10^18).
 * "0.003000000000000000" → "3000000000000000"
 * "40152030"             → "40152030000000000000000000"  (only for sdk.Dec fields)
 */
export function decToScaledInt(decStr) {
  if (decStr == null || decStr === '') return '0';
  const s = String(decStr).trim();
  if (!s || s === 'undefined' || s === 'null') return '0';
  const dotIdx = s.indexOf('.');
  if (dotIdx === -1) {
    // Integer — multiply by 10^18
    return s + '0'.repeat(18);
  }
  const intPart = s.slice(0, dotIdx);
  const fracPart = s.slice(dotIdx + 1);
  // Pad or trim fractional part to exactly 18 digits
  const frac18 = (fracPart + '0'.repeat(18)).slice(0, 18);
  const combined = (intPart === '' || intPart === '0' ? '' : intPart) + frac18;
  // Remove leading zeros (but keep at least one digit)
  const trimmed = combined.replace(/^0+/, '') || '0';
  return trimmed;
}

/**
 * Encode sentinel.types.v1.Price { denom, base_value, quote_value }
 * base_value is sdk.Dec → encode as scaled big.Int string
 * quote_value is sdk.Int → encode as integer string
 */
export function encodePrice({ denom, base_value, quote_value }) {
  const baseValEncoded = decToScaledInt(String(base_value));
  return Buffer.concat([
    protoString(1, denom),
    protoString(2, baseValEncoded),
    protoString(3, String(quote_value)),
  ]);
}

/**
 * Encode google.protobuf.Duration { seconds, nanos }
 * Used by MsgCreatePlanRequest and MsgUpdatePlanDetails for plan duration.
 */
export function encodeDuration({ seconds, nanos = 0 }) {
  return Buffer.concat([
    protoInt64(1, seconds),
    nanos ? protoInt64(2, nanos) : Buffer.alloc(0),
  ]);
}

// ─── Session Message Encoders ───────────────────────────────────────────────

/**
 * Encode sentinel.node.v3.MsgStartSessionRequest
 * Replaces old nodeSubscribe + sessionStart (now one tx).
 *
 * Fields:
 *   1: from         (string) — account address
 *   2: node_address (string) — node's sentnode1... address
 *   3: gigabytes    (int64)
 *   4: hours        (int64, 0 if using gigabytes)
 *   5: max_price    (Price, optional) — max price user will pay per GB
 */
export function encodeMsgStartSession({ from, node_address, gigabytes = 1, hours = 0, max_price }) {
  return Uint8Array.from(Buffer.concat([
    protoString(1, from),
    protoString(2, node_address),
    protoInt64(3, gigabytes),
    hours ? protoInt64(4, hours) : Buffer.alloc(0),
    max_price ? protoEmbedded(5, encodePrice(max_price)) : Buffer.alloc(0),
  ]));
}

/**
 * MsgStartSubscriptionRequest (sentinel.subscription.v3):
 *   1: from   (string)
 *   2: id     (uint64, plan ID)
 *   3: denom  (string, e.g. "udvpn")
 *   4: renewal_price_policy (enum/int64, optional)
 */
export function encodeMsgStartSubscription({ from, id, denom = 'udvpn', renewalPricePolicy = 0 }) {
  const parts = [
    protoString(1, from),
    protoInt64(2, id),
    protoString(3, denom),
  ];
  if (renewalPricePolicy) parts.push(protoInt64(4, renewalPricePolicy));
  return Uint8Array.from(Buffer.concat(parts));
}

/**
 * MsgStartSessionRequest (sentinel.subscription.v3) — start session via subscription:
 *   1: from            (string)
 *   2: id              (uint64, subscription ID)
 *   3: node_address    (string)
 */
export function encodeMsgSubStartSession({ from, id, nodeAddress }) {
  return Uint8Array.from(Buffer.concat([
    protoString(1, from),
    protoInt64(2, id),
    protoString(3, nodeAddress),
  ]));
}

// ─── Subscription Management (v3 — from sentinel-go-sdk) ────────────────────

/**
 * MsgCancelSubscriptionRequest (sentinel.subscription.v3) — cancel a subscription:
 *   1: from   (string)
 *   2: id     (uint64, subscription ID)
 */
export function encodeMsgCancelSubscription({ from, id }) {
  return Uint8Array.from(Buffer.concat([
    protoString(1, from),
    protoInt64(2, id),
  ]));
}

/**
 * MsgRenewSubscriptionRequest (sentinel.subscription.v3) — renew an expiring subscription:
 *   1: from   (string)
 *   2: id     (uint64, subscription ID)
 *   3: denom  (string, default 'udvpn')
 */
export function encodeMsgRenewSubscription({ from, id, denom = 'udvpn' }) {
  return Uint8Array.from(Buffer.concat([
    protoString(1, from),
    protoInt64(2, id),
    protoString(3, denom),
  ]));
}

/**
 * MsgShareSubscriptionRequest (sentinel.subscription.v3) — share bandwidth with another address:
 *   1: from        (string)
 *   2: id          (uint64, subscription ID)
 *   3: acc_address (string, recipient sent1... address)
 *   4: bytes       (int64, bytes to share)
 */
export function encodeMsgShareSubscription({ from, id, accAddress, bytes }) {
  return Uint8Array.from(Buffer.concat([
    protoString(1, from),
    protoInt64(2, id),
    protoString(3, accAddress),
    protoInt64(4, bytes),
  ]));
}

/**
 * MsgUpdateSubscriptionRequest (sentinel.subscription.v3) — update renewal policy:
 *   1: from                 (string)
 *   2: id                   (uint64, subscription ID)
 *   3: renewal_price_policy (int64)
 */
export function encodeMsgUpdateSubscription({ from, id, renewalPricePolicy }) {
  return Uint8Array.from(Buffer.concat([
    protoString(1, from),
    protoInt64(2, id),
    protoInt64(3, renewalPricePolicy),
  ]));
}

// ─── Session Management (v3) ────────────────────────────────────────────────

/**
 * MsgUpdateSessionRequest (sentinel.session.v3) — report bandwidth usage:
 *   1: from            (string)
 *   2: id              (uint64, session ID)
 *   3: download_bytes  (int64)
 *   4: upload_bytes    (int64)
 *   5: duration        (bytes, protobuf Duration)
 *   6: signature       (bytes)
 */
export function encodeMsgUpdateSession({ from, id, downloadBytes, uploadBytes }) {
  return Uint8Array.from(Buffer.concat([
    protoString(1, from),
    protoInt64(2, id),
    protoInt64(3, downloadBytes),
    protoInt64(4, uploadBytes),
  ]));
}

// ─── Node Operator (v3 — for node operators, NOT consumer apps) ─────────────

/**
 * MsgRegisterNodeRequest (sentinel.node.v3) — register a new node:
 *   1: from              (string, sentnode1... address)
 *   2: gigabyte_prices   (bytes[], Price entries)
 *   3: hourly_prices     (bytes[], Price entries)
 *   4: remote_addrs      (string[], IP:port addresses)
 */
export function encodeMsgRegisterNode({ from, gigabytePrices = [], hourlyPrices = [], remoteAddrs = [] }) {
  const parts = [protoString(1, from)];
  for (const p of gigabytePrices) parts.push(protoEmbedded(2, encodePrice(p)));
  for (const p of hourlyPrices) parts.push(protoEmbedded(3, encodePrice(p)));
  for (const addr of remoteAddrs) parts.push(protoString(4, addr));
  return Uint8Array.from(Buffer.concat(parts));
}

/**
 * MsgUpdateNodeDetailsRequest (sentinel.node.v3) — update node details:
 *   1: from              (string, sentnode1... address)
 *   2: gigabyte_prices   (bytes[], Price entries)
 *   3: hourly_prices     (bytes[], Price entries)
 *   4: remote_addrs      (string[], IP:port addresses)
 */
export function encodeMsgUpdateNodeDetails({ from, gigabytePrices = [], hourlyPrices = [], remoteAddrs = [] }) {
  const parts = [protoString(1, from)];
  for (const p of gigabytePrices) parts.push(protoEmbedded(2, encodePrice(p)));
  for (const p of hourlyPrices) parts.push(protoEmbedded(3, encodePrice(p)));
  for (const addr of remoteAddrs) parts.push(protoString(4, addr));
  return Uint8Array.from(Buffer.concat(parts));
}

/**
 * MsgUpdateNodeStatusRequest (sentinel.node.v3) — activate/deactivate node:
 *   1: from   (string, sentnode1... address)
 *   2: status (int64, 1=active, 3=inactive)
 */
export function encodeMsgUpdateNodeStatus({ from, status }) {
  return Uint8Array.from(Buffer.concat([
    protoString(1, from),
    protoInt64(2, status),
  ]));
}

// ─── Plan Management (v3 addition) ──────────────────────────────────────────

/**
 * MsgUpdatePlanDetailsRequest (sentinel.plan.v3) — update plan details (NEW in v3):
 *   1: from     (string, sentprov1... address)
 *   2: id       (uint64, plan ID)
 *   3: bytes    (string, total bandwidth)
 *   4: duration (bytes, Duration)
 *   5: prices   (bytes[], Price entries)
 */
export function encodeMsgUpdatePlanDetails({ from, id, bytes, duration, prices = [] }) {
  const parts = [protoString(1, from), protoInt64(2, id)];
  if (bytes) parts.push(protoString(3, String(bytes)));
  if (duration) parts.push(protoEmbedded(4, encodeDuration(
    typeof duration === 'number' ? { seconds: duration } : duration
  )));
  for (const p of prices) parts.push(protoEmbedded(5, encodePrice(p)));
  return Uint8Array.from(Buffer.concat(parts));
}

/**
 * MsgCancelSessionRequest (sentinel.session.v3) — cancel/end a session:
 *   1: from   (string) — signer address
 *   2: id     (uint64) — session ID
 *
 * NOTE: v3 renamed MsgEndSession to MsgCancelSession and removed the rating field.
 * The v2 MsgEndRequest had a rating field — v3 does not.
 */
export function encodeMsgEndSession({ from, id }) {
  return Uint8Array.from(Buffer.concat([
    protoString(1, from),
    protoInt64(2, id),
  ]));
}

/**
 * Extract session ID from MsgStartSession tx result.
 * Checks ABCI events for sentinel.node.v3.EventCreateSession.session_id
 */
export function extractSessionId(txResult) {
  // Try ABCI events first
  for (const event of (txResult.events || [])) {
    if (/session/i.test(event.type)) {
      for (const attr of (event.attributes || [])) {
        const k = typeof attr.key === 'string' ? attr.key
          : Buffer.from(attr.key, 'base64').toString('utf8');
        const v = typeof attr.value === 'string' ? attr.value
          : Buffer.from(attr.value, 'base64').toString('utf8');
        if (k === 'session_id' || k === 'SessionID' || k === 'id') {
          const id = BigInt(v.replace(/"/g, ''));
          if (id > 0n) return id;
        }
      }
    }
  }
  // Try rawLog
  try {
    const logs = JSON.parse(txResult.rawLog || '[]');
    for (const log of (Array.isArray(logs) ? logs : [])) {
      for (const ev of (log.events || [])) {
        for (const attr of (ev.attributes || [])) {
          if (attr.key === 'session_id' || attr.key === 'id') {
            const id = BigInt(String(attr.value).replace(/"/g, ''));
            if (id > 0n) return id;
          }
        }
      }
    }
  } catch { }
  return null;
}
