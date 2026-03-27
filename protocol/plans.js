/**
 * Plan, Provider & Lease Operations for Sentinel dVPN
 *
 * Contains all encoder functions for plan management, provider registration,
 * and node leasing. These are the 10 message types NOT in v3protocol.js.
 *
 * v3protocol.js handles: direct session, subscription, sub-session (3 types)
 * This file handles: provider (3), plan (4), lease (2), plan-session (1) = 10 types
 */

// ─── Protobuf Encoding Primitives ────────────────────────────────────────────
// Shared with v3.js — single source of truth for protobuf encoding.
import { encodeVarint, protoString, protoInt64, protoEmbedded, decToScaledInt, encodePrice } from './v3.js';

// protoUint64 is identical to protoInt64 — both use varint wire type 0
function protoUint64(fieldNum, n) {
  return protoInt64(fieldNum, n);
}

function protoBool(fieldNum, val) {
  if (!val) return Buffer.alloc(0); // false = omit (protobuf default)
  return Buffer.concat([encodeVarint((BigInt(fieldNum) << 3n) | 0n), encodeVarint(1)]);
}

// decToScaledInt and encodePrice imported from v3.js (single source of truth)

/**
 * Encode google.protobuf.Duration { seconds, nanos }
 * Used by MsgCreatePlanRequest for plan duration.
 */
function encodeDuration({ seconds, nanos = 0 }) {
  return Buffer.concat([
    protoInt64(1, seconds),
    nanos ? protoInt64(2, nanos) : Buffer.alloc(0),
  ]);
}

// ─── Provider Messages ───────────────────────────────────────────────────────

/**
 * MsgRegisterProviderRequest (sentinel.provider.v3)
 * Register a new provider. One wallet = one provider.
 * from: sent prefix (account address)
 */
export function encodeMsgRegisterProvider({ from, name, identity, website, description }) {
  return Uint8Array.from(Buffer.concat([
    protoString(1, from),
    protoString(2, name),
    protoString(3, identity || ''),
    protoString(4, website || ''),
    protoString(5, description || ''),
  ]));
}

/**
 * MsgUpdateProviderDetailsRequest (sentinel.provider.v3)
 * Update existing provider info.
 * from: sentprov prefix (provider address)
 */
export function encodeMsgUpdateProviderDetails({ from, name, identity, website, description }) {
  return Uint8Array.from(Buffer.concat([
    protoString(1, from),
    protoString(2, name || ''),
    protoString(3, identity || ''),
    protoString(4, website || ''),
    protoString(5, description || ''),
  ]));
}

/**
 * MsgUpdateProviderStatusRequest (sentinel.provider.v3)
 * Activate/deactivate provider. Status: 1=active, 2=inactive_pending, 3=inactive
 * from: sent prefix (account address)
 */
export function encodeMsgUpdateProviderStatus({ from, status }) {
  return Uint8Array.from(Buffer.concat([
    protoString(1, from),
    protoInt64(2, status),
  ]));
}

// ─── Plan Messages ───────────────────────────────────────────────────────────

/**
 * MsgCreatePlanRequest (sentinel.plan.v3)
 * Create a new subscription plan.
 * from: sentprov prefix (provider address)
 * bytes: total bandwidth as string (e.g. "10000000000" for 10GB)
 * duration: { seconds: N } — plan validity period
 * prices: [{ denom, base_value, quote_value }] — subscription cost
 * isPrivate: boolean
 *
 * NOTE: Plans start INACTIVE by default — must send MsgUpdatePlanStatusRequest separately!
 */
export function encodeMsgCreatePlan({ from, bytes, duration, prices, isPrivate }) {
  const parts = [protoString(1, from)];
  if (bytes) parts.push(protoString(2, String(bytes)));
  if (duration) parts.push(protoEmbedded(3, encodeDuration(
    typeof duration === 'number' ? { seconds: duration } : duration
  )));
  for (const p of (prices || [])) {
    parts.push(protoEmbedded(4, encodePrice(p)));
  }
  if (isPrivate) parts.push(protoBool(5, true));
  return Uint8Array.from(Buffer.concat(parts));
}

/**
 * MsgUpdatePlanStatusRequest (sentinel.plan.v3)
 * Activate/deactivate a plan. Status: 1=active, 2=inactive_pending, 3=inactive
 * from: sentprov prefix (provider address)
 */
export function encodeMsgUpdatePlanStatus({ from, id, status }) {
  return Uint8Array.from(Buffer.concat([
    protoString(1, from),
    protoUint64(2, id),
    protoInt64(3, status),
  ]));
}

/**
 * MsgLinkNodeRequest (sentinel.plan.v3)
 * Link a leased node to a plan. Requires active lease for the node.
 * from: sentprov prefix (provider address)
 */
export function encodeMsgLinkNode({ from, id, nodeAddress }) {
  return Uint8Array.from(Buffer.concat([
    protoString(1, from),
    protoUint64(2, id),
    protoString(3, nodeAddress),
  ]));
}

/**
 * MsgUnlinkNodeRequest (sentinel.plan.v3)
 * Remove a node from a plan.
 * from: sentprov prefix (provider address)
 */
export function encodeMsgUnlinkNode({ from, id, nodeAddress }) {
  return Uint8Array.from(Buffer.concat([
    protoString(1, from),
    protoUint64(2, id),
    protoString(3, nodeAddress),
  ]));
}

/**
 * MsgStartSessionRequest (sentinel.plan.v3) — COMBINED subscribe + session
 * Subscribes to a plan AND starts a session in one TX.
 * from: sent prefix (account address)
 */
export function encodeMsgPlanStartSession({ from, id, denom = 'udvpn', renewalPricePolicy = 0, nodeAddress }) {
  const parts = [
    protoString(1, from),
    protoUint64(2, id),
    protoString(3, denom),
  ];
  if (renewalPricePolicy) parts.push(protoInt64(4, renewalPricePolicy));
  if (nodeAddress) parts.push(protoString(5, nodeAddress));
  return Uint8Array.from(Buffer.concat(parts));
}

// ─── Lease Messages ──────────────────────────────────────────────────────────

/**
 * MsgStartLeaseRequest (sentinel.lease.v1)
 * Lease a node from its operator. Provider pays node's hourly price.
 * from: sentprov prefix (provider address)
 *
 * CRITICAL: maxPrice must EXACTLY match the node's hourly_prices from LCD.
 * Any mismatch → "invalid price" error.
 */
export function encodeMsgStartLease({ from, nodeAddress, hours, maxPrice, renewalPricePolicy = 0 }) {
  const parts = [
    protoString(1, from),
    protoString(2, nodeAddress),
    protoInt64(3, hours),
  ];
  if (maxPrice) parts.push(protoEmbedded(4, encodePrice(maxPrice)));
  if (renewalPricePolicy) parts.push(protoInt64(5, renewalPricePolicy));
  return Uint8Array.from(Buffer.concat(parts));
}

/**
 * MsgEndLeaseRequest (sentinel.lease.v1)
 * End an active lease.
 * from: sentprov prefix (provider address)
 */
export function encodeMsgEndLease({ from, id }) {
  return Uint8Array.from(Buffer.concat([
    protoString(1, from),
    protoUint64(2, id),
  ]));
}

// ─── Exported Helpers ────────────────────────────────────────────────────────

export { encodePrice, encodeDuration, decToScaledInt };
export { encodeVarint, protoString, protoInt64, protoUint64, protoBool, protoEmbedded };
