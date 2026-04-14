/**
 * Sentinel SDK — Chain / Fee Grants Module
 *
 * FeeGrant message builders, queries, monitoring, and workflow helpers.
 * Gas-free UX: granter pays fees for grantee's transactions.
 *
 * Usage:
 *   import { buildFeeGrantMsg, queryFeeGrants, monitorFeeGrants } from './chain/fee-grants.js';
 *   const msg = buildFeeGrantMsg(serviceAddr, userAddr, { spendLimit: 5000000 });
 */

import { EventEmitter } from 'events';
import { protoString, protoInt64, protoEmbedded } from '../v3protocol.js';
import { LCD_ENDPOINTS } from '../defaults.js';
import { ValidationError, ErrorCodes } from '../errors.js';
import { lcd, lcdPaginatedSafe, lcdQueryAll } from './lcd.js';
import { isSameKey } from './wallet.js';
import { queryPlanSubscribers } from './queries.js';
import {
  createRpcQueryClientWithFallback,
  rpcQueryFeeGrant as _rpcQueryFeeGrant,
  rpcQueryFeeGrants as _rpcQueryFeeGrants,
  rpcQueryFeeGrantsIssued as _rpcQueryFeeGrantsIssued,
} from './rpc.js';

// ─── Protobuf Helpers for FeeGrant ──────────────────────────────────────────
// Uses the same manual protobuf encoding as Sentinel types — no codegen needed.

function encodeCoin(denom, amount) {
  return Buffer.concat([protoString(1, denom), protoString(2, String(amount))]);
}

function encodeTimestamp(date) {
  const ms = date.getTime();
  if (Number.isNaN(ms)) throw new ValidationError(ErrorCodes.INVALID_OPTIONS, 'encodeTimestamp(): invalid date', { date });
  const seconds = BigInt(Math.floor(ms / 1000));
  return Buffer.concat([protoInt64(1, seconds)]);
}

function encodeBasicAllowance(spendLimit, expiration) {
  const parts = [];
  if (spendLimit != null && spendLimit !== false) {
    const coins = Array.isArray(spendLimit) ? spendLimit : [{ denom: 'udvpn', amount: String(spendLimit) }];
    for (const coin of coins) {
      parts.push(protoEmbedded(1, encodeCoin(coin.denom || 'udvpn', coin.amount)));
    }
  }
  if (expiration) {
    parts.push(protoEmbedded(2, encodeTimestamp(expiration instanceof Date ? expiration : new Date(expiration))));
  }
  return Buffer.concat(parts);
}

function encodeAllowedMsgAllowance(innerTypeUrl, innerBytes, allowedMessages) {
  const parts = [protoEmbedded(1, encodeAny(innerTypeUrl, innerBytes))];
  for (const msg of allowedMessages) {
    parts.push(protoString(2, msg));
  }
  return Buffer.concat(parts);
}

function encodeAny(typeUrl, valueBytes) {
  return Buffer.concat([
    protoString(1, typeUrl),
    protoEmbedded(2, valueBytes),
  ]);
}

// ─── RPC Client Helper ─────────────────────────────────────────────────────

let _rpcClient = null;
let _rpcClientPromise = null;

async function getRpcClient() {
  if (_rpcClient) return _rpcClient;
  if (_rpcClientPromise) return _rpcClientPromise;
  _rpcClientPromise = createRpcQueryClientWithFallback()
    .then(client => { _rpcClient = client; return client; })
    .catch(() => { _rpcClient = null; return null; })
    .finally(() => { _rpcClientPromise = null; });
  return _rpcClientPromise;
}

// ─── FeeGrant (cosmos.feegrant.v1beta1) ─────────────────────────────────────

/**
 * Build a MsgGrantAllowance message.
 * @param {string} granter - Address paying fees (sent1...)
 * @param {string} grantee - Address receiving fee grant (sent1...)
 * @param {object} opts
 * @param {number|Array} opts.spendLimit - Max spend in udvpn (number) or [{denom, amount}]
 * @param {Date|string} opts.expiration - Optional expiry date
 * @param {string[]} opts.allowedMessages - Optional: restrict to specific msg types (uses AllowedMsgAllowance)
 */
export function buildFeeGrantMsg(granter, grantee, opts = {}) {
  const { spendLimit, expiration, allowedMessages } = opts;
  const basicBytes = encodeBasicAllowance(spendLimit, expiration);

  let allowanceTypeUrl, allowanceBytes;
  if (allowedMessages?.length) {
    allowanceTypeUrl = '/cosmos.feegrant.v1beta1.AllowedMsgAllowance';
    allowanceBytes = encodeAllowedMsgAllowance(
      '/cosmos.feegrant.v1beta1.BasicAllowance', basicBytes, allowedMessages
    );
  } else {
    allowanceTypeUrl = '/cosmos.feegrant.v1beta1.BasicAllowance';
    allowanceBytes = basicBytes;
  }

  // MsgGrantAllowance: field 1=granter, field 2=grantee, field 3=allowance(Any)
  return {
    typeUrl: '/cosmos.feegrant.v1beta1.MsgGrantAllowance',
    value: { granter, grantee, allowance: { typeUrl: allowanceTypeUrl, value: Uint8Array.from(allowanceBytes) } },
  };
}

/**
 * Build a MsgRevokeAllowance message.
 */
export function buildRevokeFeeGrantMsg(granter, grantee) {
  return {
    typeUrl: '/cosmos.feegrant.v1beta1.MsgRevokeAllowance',
    value: { granter, grantee },
  };
}

/**
 * Query fee grants given to a grantee.
 * RPC-first with LCD fallback.
 * @returns {Promise<Array>} Array of allowance objects
 */
export async function queryFeeGrants(lcdUrl, grantee) {
  // RPC-first
  try {
    const rpc = await getRpcClient();
    if (rpc) {
      return await _rpcQueryFeeGrants(rpc, grantee);
    }
  } catch { /* fall through to LCD */ }

  // LCD fallback
  const { items } = await lcdPaginatedSafe(lcdUrl, `/cosmos/feegrant/v1beta1/allowances/${grantee}`, 'allowances');
  return items;
}

/**
 * Query fee grants issued BY an address (where addr is the granter).
 * RPC-first with LCD fallback.
 * @param {string} lcdUrl
 * @param {string} granter - Address that issued the grants
 * @returns {Promise<Array>}
 */
export async function queryFeeGrantsIssued(lcdUrl, granter) {
  // RPC-first
  try {
    const rpc = await getRpcClient();
    if (rpc) {
      return await _rpcQueryFeeGrantsIssued(rpc, granter);
    }
  } catch { /* fall through to LCD */ }

  // LCD fallback
  const { items } = await lcdPaginatedSafe(lcdUrl, `/cosmos/feegrant/v1beta1/issued/${granter}`, 'allowances');
  return items;
}

/**
 * Query a specific fee grant between granter and grantee.
 * RPC-first with LCD fallback.
 * @returns {Promise<object|null>} Allowance object or null
 */
export async function queryFeeGrant(lcdUrl, granter, grantee) {
  // RPC-first
  try {
    const rpc = await getRpcClient();
    if (rpc) {
      return await _rpcQueryFeeGrant(rpc, granter, grantee);
    }
  } catch { /* fall through to LCD */ }

  // LCD fallback
  try {
    const data = await lcd(lcdUrl, `/cosmos/feegrant/v1beta1/allowance/${granter}/${grantee}`);
    return data.allowance || null;
  } catch { return null; } // 404 = no grant
}

// ─── Fee Grant Workflow Helpers (v25b) ────────────────────────────────────────

/**
 * Grant fee allowance to all plan subscribers who don't already have one.
 * Filters out self-grants (granter === grantee) and already-granted addresses.
 *
 * @param {number|string} planId
 * @param {object} opts
 * @param {string} opts.granterAddress - Who pays fees (typically plan owner)
 * @param {string} opts.lcdUrl - LCD endpoint
 * @param {object} [opts.grantOpts] - Options for buildFeeGrantMsg (spendLimit, expiration, allowedMessages)
 * @returns {Promise<{ msgs: Array, skipped: string[], newGrants: string[] }>} Messages ready for broadcast
 */
export async function grantPlanSubscribers(planId, opts = {}) {
  const { granterAddress, lcdUrl, grantOpts = {} } = opts;
  if (!granterAddress) throw new ValidationError(ErrorCodes.INVALID_OPTIONS, 'granterAddress is required');

  // Get subscribers
  const { subscribers } = await queryPlanSubscribers(planId, { lcdUrl });

  // Get existing grants ISSUED BY granter (not grants received)
  const existingGrants = await queryFeeGrantsIssued(lcdUrl || LCD_ENDPOINTS[0].url, granterAddress);
  const alreadyGranted = new Set(existingGrants.map(g => g.grantee));

  const msgs = [];
  const skipped = [];
  const newGrants = [];

  const now = new Date();
  // Deduplicate by address and filter active+non-expired
  const seen = new Set();
  for (const sub of subscribers) {
    const addr = sub.acc_address || sub.address;
    if (!addr || seen.has(addr)) continue;
    seen.add(addr);
    // Skip self-grant (chain rejects granter === grantee)
    if (addr === granterAddress || isSameKey(addr, granterAddress)) { skipped.push(addr); continue; }
    // Skip inactive or expired
    if (sub.status && sub.status !== 'active') { skipped.push(addr); continue; }
    if (sub.inactive_at && new Date(sub.inactive_at) <= now) { skipped.push(addr); continue; }
    // Skip already granted
    if (alreadyGranted.has(addr)) { skipped.push(addr); continue; }
    msgs.push(buildFeeGrantMsg(granterAddress, addr, grantOpts));
    newGrants.push(addr);
  }

  return { msgs, skipped, newGrants };
}

/**
 * Find fee grants expiring within N days.
 *
 * @param {string} lcdUrl - LCD endpoint
 * @param {string} granteeOrGranter - Address to check grants for
 * @param {number} withinDays - Check grants expiring within this many days (default: 7)
 * @param {'grantee'|'granter'} [role='grantee'] - Whether to check as grantee or granter
 * @returns {Promise<Array<{ granter: string, grantee: string, expiresAt: Date|null, daysLeft: number|null }>>}
 */
export async function getExpiringGrants(lcdUrl, granteeOrGranter, withinDays = 7, role = 'grantee') {
  const grants = role === 'grantee'
    ? await queryFeeGrants(lcdUrl, granteeOrGranter)
    : await queryFeeGrantsIssued(lcdUrl, granteeOrGranter);

  const now = Date.now();
  const cutoff = now + withinDays * 24 * 60 * 60_000;
  const expiring = [];

  for (const g of grants) {
    // Fee grant allowances have complex nested @type structures:
    // BasicAllowance: { expiration }
    // PeriodicAllowance: { basic: { expiration } }
    // AllowedMsgAllowance: { allowance: { expiration } or allowance: { basic: { expiration } } }
    const a = g.allowance || {};
    const inner = a.allowance || a; // unwrap AllowedMsgAllowance
    const expStr = inner.expiration || inner.basic?.expiration || a.expiration || a.basic?.expiration;
    if (!expStr) continue; // no expiry set
    const expiresAt = new Date(expStr);
    if (expiresAt.getTime() <= cutoff) {
      expiring.push({
        granter: g.granter,
        grantee: g.grantee,
        expiresAt,
        daysLeft: Math.max(0, Math.round((expiresAt.getTime() - now) / (24 * 60 * 60_000))),
      });
    }
  }
  return expiring;
}

/**
 * Revoke and re-grant expiring fee grants.
 *
 * @param {string} lcdUrl
 * @param {string} granterAddress
 * @param {number} withinDays - Renew grants expiring within N days
 * @param {object} [grantOpts] - Options for new grants (spendLimit, expiration, allowedMessages)
 * @returns {Promise<{ msgs: Array, renewed: string[] }>} Messages ready for broadcast
 */
export async function renewExpiringGrants(lcdUrl, granterAddress, withinDays = 7, grantOpts = {}) {
  const expiring = await getExpiringGrants(lcdUrl, granterAddress, withinDays, 'granter');
  const msgs = [];
  const renewed = [];

  for (const g of expiring) {
    if (g.grantee === granterAddress) continue; // skip self
    msgs.push(buildRevokeFeeGrantMsg(granterAddress, g.grantee));
    msgs.push(buildFeeGrantMsg(granterAddress, g.grantee, grantOpts));
    renewed.push(g.grantee);
  }

  return { msgs, renewed };
}

// ─── Fee Grant Monitoring (v25b) ─────────────────────────────────────────────

/**
 * Monitor fee grants for expiry. Returns an EventEmitter that checks grants on interval.
 *
 * @param {object} opts
 * @param {string} opts.lcdUrl - LCD endpoint
 * @param {string} opts.address - Address to monitor (as granter)
 * @param {number} [opts.checkIntervalMs] - Check interval (default: 6 hours)
 * @param {number} [opts.warnDays] - Emit 'expiring' when grant expires within N days (default: 7)
 * @param {boolean} [opts.autoRenew] - Auto-revoke+re-grant expiring grants (default: false)
 * @param {object} [opts.grantOpts] - Options for renewed grants
 * @returns {EventEmitter} Emits 'expiring' and 'expired' events. Call .stop() to stop monitoring.
 */
export function monitorFeeGrants(opts = {}) {
  const { lcdUrl, address, checkIntervalMs = 6 * 60 * 60_000, warnDays = 7, autoRenew = false, grantOpts = {} } = opts;
  if (!lcdUrl || !address) throw new ValidationError(ErrorCodes.INVALID_OPTIONS, 'monitorFeeGrants requires lcdUrl and address');

  const emitter = new EventEmitter();
  let timer = null;

  const check = async () => {
    try {
      const expiring = await getExpiringGrants(lcdUrl, address, warnDays, 'granter');
      const now = Date.now();

      for (const g of expiring) {
        if (g.expiresAt.getTime() <= now) {
          emitter.emit('expired', g);
        } else {
          emitter.emit('expiring', g);
        }
      }

      if (autoRenew && expiring.length > 0) {
        const { msgs, renewed } = await renewExpiringGrants(lcdUrl, address, warnDays, grantOpts);
        if (msgs.length > 0) {
          emitter.emit('renew', { msgs, renewed });
        }
      }
    } catch (err) {
      emitter.emit('error', err);
    }
  };

  // Start checking
  check();
  timer = setInterval(check, checkIntervalMs);
  if (timer.unref) timer.unref(); // Don't prevent process exit

  emitter.stop = () => {
    if (timer) { clearInterval(timer); timer = null; }
  };

  return emitter;
}
