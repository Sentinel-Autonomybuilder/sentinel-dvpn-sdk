/**
 * CosmJS Wallet, Registry & Signing Setup for Sentinel dVPN
 *
 * Everything needed to create a wallet, sign transactions, and broadcast
 * to the Sentinel chain. Registers ALL 13 Sentinel message types.
 *
 * Usage:
 *   import { createWallet, privKeyFromMnemonic, createClient, extractId } from './cosmjs-setup.js';
 *   const { wallet, account } = await createWallet(mnemonic);
 *   const privKey = await privKeyFromMnemonic(mnemonic);
 *   const client = await createClient('https://rpc.sentinel.co:443', wallet);
 */

import { Bip39, EnglishMnemonic, Slip10, Slip10Curve, Random } from '@cosmjs/crypto';
import { makeCosmoshubPath } from '@cosmjs/amino';
import { DirectSecp256k1HdWallet, Registry } from '@cosmjs/proto-signing';
import { SigningStargateClient, GasPrice, defaultRegistryTypes } from '@cosmjs/stargate';
import { fromBech32, toBech32 } from '@cosmjs/encoding';
import { EventEmitter } from 'events';

// 4 encoders + protobuf primitives from v3protocol.js
import {
  encodeMsgStartSession,
  encodeMsgEndSession,
  encodeMsgStartSubscription,
  encodeMsgSubStartSession,
  encodeMsgCancelSubscription,
  encodeMsgRenewSubscription,
  encodeMsgShareSubscription,
  encodeMsgUpdateSubscription,
  encodeMsgUpdateSession,
  encodeMsgRegisterNode,
  encodeMsgUpdateNodeDetails,
  encodeMsgUpdateNodeStatus,
  encodeMsgUpdatePlanDetails,
  extractSessionId,
  encodeVarint, protoString, protoInt64, protoEmbedded,
} from './v3protocol.js';

// 10 encoders from plan-operations.js (provider, plan, lease, plan-session)
import {
  encodeMsgRegisterProvider,
  encodeMsgUpdateProviderDetails,
  encodeMsgUpdateProviderStatus,
  encodeMsgCreatePlan,
  encodeMsgUpdatePlanStatus,
  encodeMsgLinkNode,
  encodeMsgUnlinkNode,
  encodeMsgPlanStartSession,
  encodeMsgStartLease,
  encodeMsgEndLease,
} from './plan-operations.js';
import { GAS_PRICE, RPC_ENDPOINTS, LCD_ENDPOINTS, tryWithFallback } from './defaults.js';
import { ValidationError, NodeError, ChainError, ErrorCodes } from './errors.js';
// path, os, fs imports removed — settings persistence now in chain/queries.js

// RPC-first query layer — cosmjs-setup.js delegates query functions here
import {
  findExistingSession as _findExistingSession,
  fetchActiveNodes as _fetchActiveNodes,
  getNetworkOverview as _getNetworkOverview,
  queryNode as _queryNode,
  resolveNodeUrl as _resolveNodeUrl,
  querySubscriptions as _querySubscriptions,
  querySessionAllocation as _querySessionAllocation,
  querySessions as _querySessions,
  flattenSession as _flattenSession,
  querySubscription as _querySubscription,
  hasActiveSubscription as _hasActiveSubscription,
  queryPlanNodes as _queryPlanNodes,
  discoverPlans as _discoverPlans,
  discoverPlanIds as _discoverPlanIds,
  getNodePrices as _getNodePrices,
  getProviderByAddress as _getProviderByAddress,
  queryPlanSubscribers as _queryPlanSubscribers,
  getPlanStats as _getPlanStats,
  querySubscriptionAllocations as _querySubscriptionAllocations,
  queryAuthzGrants as _queryAuthzGrants,
  loadVpnSettings as _loadVpnSettings,
  saveVpnSettings as _saveVpnSettings,
} from './chain/queries.js';
import {
  queryFeeGrants as _queryFeeGrants,
  queryFeeGrantsIssued as _queryFeeGrantsIssued,
  queryFeeGrant as _queryFeeGrant,
  grantPlanSubscribers as _grantPlanSubscribers,
  getExpiringGrants as _getExpiringGrants,
  renewExpiringGrants as _renewExpiringGrants,
  monitorFeeGrants as _monitorFeeGrants,
} from './chain/fee-grants.js';

// ─── Input Validation Helpers ────────────────────────────────────────────────

/**
 * Validate a BIP39 mnemonic string. Returns true if valid, false if not.
 * Use this to enable/disable a "Connect" button in your UI.
 *
 * @param {string} mnemonic - The mnemonic to validate
 * @returns {boolean} True if the mnemonic is a valid 12+ word string
 *
 * @example
 *   if (isMnemonicValid(userInput)) showConnectButton();
 */
export function isMnemonicValid(mnemonic) {
  if (typeof mnemonic !== 'string') return false;
  const trimmed = mnemonic.trim();
  if (trimmed.split(/\s+/).length < 12) return false;
  try {
    new EnglishMnemonic(trimmed);
    return true;
  } catch {
    return false;
  }
}

function validateMnemonic(mnemonic, fnName) {
  if (!isMnemonicValid(mnemonic)) {
    throw new ValidationError(ErrorCodes.INVALID_MNEMONIC,
      `${fnName}(): mnemonic must be a 12+ word BIP39 string`,
      { wordCount: typeof mnemonic === 'string' ? mnemonic.trim().split(/\s+/).length : 0 });
  }
}

function validateAddress(addr, prefix, fnName) {
  if (typeof addr !== 'string' || !addr.startsWith(prefix)) {
    throw new ValidationError(ErrorCodes.INVALID_NODE_ADDRESS,
      `${fnName}(): address must be a valid ${prefix}... bech32 string`,
      { value: addr });
  }
}

// ─── Wallet ──────────────────────────────────────────────────────────────────

/**
 * Create a Sentinel wallet from a BIP39 mnemonic.
 * Returns { wallet, account } where account.address is the sent1... address.
 */
export async function createWallet(mnemonic) {
  validateMnemonic(mnemonic, 'createWallet');
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, { prefix: 'sent' });
  const [account] = await wallet.getAccounts();
  return { wallet, account };
}

/**
 * Generate a new wallet with a fresh random BIP39 mnemonic.
 * @param {number} strength - 128 for 12 words, 256 for 24 words (default: 128)
 * @returns {{ mnemonic: string, wallet: DirectSecp256k1HdWallet, account: { address: string } }}
 */
export async function generateWallet(strength = 128) {
  const entropy = Random.getBytes(strength / 8);
  const mnemonic = Bip39.encode(entropy).toString();
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, { prefix: 'sent' });
  const [account] = await wallet.getAccounts();
  return { mnemonic, wallet, account };
}

/**
 * Derive the raw secp256k1 private key from a mnemonic.
 * Needed for handshake signatures (node-handshake protocol).
 */
export async function privKeyFromMnemonic(mnemonic) {
  validateMnemonic(mnemonic, 'privKeyFromMnemonic');
  const seed = await Bip39.mnemonicToSeed(new EnglishMnemonic(mnemonic));
  const { privkey } = Slip10.derivePath(Slip10Curve.Secp256k1, seed, makeCosmoshubPath(0));
  return Buffer.from(privkey);
}

// ─── Address Prefix Conversion ───────────────────────────────────────────────
// Same key, different bech32 prefix. See address-prefixes.md.

export function sentToSentprov(sentAddr) {
  validateAddress(sentAddr, 'sent', 'sentToSentprov');
  const { data } = fromBech32(sentAddr);
  return toBech32('sentprov', data);
}

export function sentToSentnode(sentAddr) {
  validateAddress(sentAddr, 'sent', 'sentToSentnode');
  const { data } = fromBech32(sentAddr);
  return toBech32('sentnode', data);
}

export function sentprovToSent(provAddr) {
  validateAddress(provAddr, 'sentprov', 'sentprovToSent');
  const { data } = fromBech32(provAddr);
  return toBech32('sent', data);
}

// ─── CosmJS Registry ─────────────────────────────────────────────────────────

/**
 * Adapter that wraps a manual protobuf encoder for CosmJS's Registry.
 * CosmJS expects { fromPartial, encode, decode } — we only need encode.
 */
function makeMsgType(encodeFn) {
  return {
    fromPartial: (v) => v,
    encode: (inst) => ({ finish: () => encodeFn(inst) }),
    decode: () => ({}),
  };
}

/**
 * Build a CosmJS Registry with ALL 14 Sentinel message types registered.
 * This is required for signAndBroadcast to encode Sentinel-specific messages.
 */
export function buildRegistry() {
  return new Registry([
    ...defaultRegistryTypes,
    // Direct node session (v3protocol.js)
    ['/sentinel.node.v3.MsgStartSessionRequest', makeMsgType(encodeMsgStartSession)],
    // End session (v3protocol.js)
    ['/sentinel.session.v3.MsgCancelSessionRequest', makeMsgType(encodeMsgEndSession)],
    // Subscription (v3protocol.js)
    ['/sentinel.subscription.v3.MsgStartSubscriptionRequest', makeMsgType(encodeMsgStartSubscription)],
    ['/sentinel.subscription.v3.MsgStartSessionRequest', makeMsgType(encodeMsgSubStartSession)],
    // Plan (plan-operations.js)
    ['/sentinel.plan.v3.MsgStartSessionRequest', makeMsgType(encodeMsgPlanStartSession)],
    ['/sentinel.plan.v3.MsgCreatePlanRequest', makeMsgType(encodeMsgCreatePlan)],
    ['/sentinel.plan.v3.MsgLinkNodeRequest', makeMsgType(encodeMsgLinkNode)],
    ['/sentinel.plan.v3.MsgUnlinkNodeRequest', makeMsgType(encodeMsgUnlinkNode)],
    ['/sentinel.plan.v3.MsgUpdatePlanStatusRequest', makeMsgType(encodeMsgUpdatePlanStatus)],
    // Provider (plan-operations.js)
    ['/sentinel.provider.v3.MsgRegisterProviderRequest', makeMsgType(encodeMsgRegisterProvider)],
    ['/sentinel.provider.v3.MsgUpdateProviderDetailsRequest', makeMsgType(encodeMsgUpdateProviderDetails)],
    ['/sentinel.provider.v3.MsgUpdateProviderStatusRequest', makeMsgType(encodeMsgUpdateProviderStatus)],
    // Plan details update (v3 — NEW, from sentinel-go-sdk)
    ['/sentinel.plan.v3.MsgUpdatePlanDetailsRequest', makeMsgType(encodeMsgUpdatePlanDetails)],
    // Lease (plan-operations.js)
    ['/sentinel.lease.v1.MsgStartLeaseRequest', makeMsgType(encodeMsgStartLease)],
    ['/sentinel.lease.v1.MsgEndLeaseRequest', makeMsgType(encodeMsgEndLease)],
    // Subscription management (v3 — from sentinel-go-sdk)
    ['/sentinel.subscription.v3.MsgCancelSubscriptionRequest', makeMsgType(encodeMsgCancelSubscription)],
    ['/sentinel.subscription.v3.MsgRenewSubscriptionRequest', makeMsgType(encodeMsgRenewSubscription)],
    ['/sentinel.subscription.v3.MsgShareSubscriptionRequest', makeMsgType(encodeMsgShareSubscription)],
    ['/sentinel.subscription.v3.MsgUpdateSubscriptionRequest', makeMsgType(encodeMsgUpdateSubscription)],
    // Session management (v3)
    ['/sentinel.session.v3.MsgUpdateSessionRequest', makeMsgType(encodeMsgUpdateSession)],
    // Node operator (v3 — for node operators, NOT consumer apps)
    ['/sentinel.node.v3.MsgRegisterNodeRequest', makeMsgType(encodeMsgRegisterNode)],
    ['/sentinel.node.v3.MsgUpdateNodeDetailsRequest', makeMsgType(encodeMsgUpdateNodeDetails)],
    ['/sentinel.node.v3.MsgUpdateNodeStatusRequest', makeMsgType(encodeMsgUpdateNodeStatus)],
  ]);
}

// ─── Signing Client ──────────────────────────────────────────────────────────

/**
 * Create a SigningStargateClient connected to Sentinel RPC.
 * Gas price: from defaults.js GAS_PRICE (chain minimum).
 *
 * Signatures:
 *   createClient(rpcUrl, wallet)  — classic: connect to specific RPC with existing wallet
 *   createClient(mnemonic)        — convenience: create wallet from mnemonic, try RPC endpoints with failover
 *
 * @param {string} rpcUrlOrMnemonic - Either an RPC URL (https://...) or a BIP39 mnemonic
 * @param {DirectSecp256k1HdWallet} [wallet] - Wallet object (required when first arg is RPC URL)
 * @returns {Promise<SigningStargateClient>} Connected signing client with full Sentinel registry
 */
export async function createClient(rpcUrlOrMnemonic, wallet) {
  // Classic call: createClient(rpcUrl, wallet)
  if (wallet) {
    return SigningStargateClient.connectWithSigner(rpcUrlOrMnemonic, wallet, {
      gasPrice: GasPrice.fromString(GAS_PRICE),
      registry: buildRegistry(),
    });
  }

  // If first arg looks like a URL, it's a missing wallet — throw helpful error
  if (typeof rpcUrlOrMnemonic === 'string' && /^(https?|wss?):\/\//i.test(rpcUrlOrMnemonic)) {
    throw new ValidationError(ErrorCodes.INVALID_MNEMONIC,
      'createClient(rpcUrl, wallet): wallet parameter is required when passing an RPC URL. ' +
      'Use createClient(mnemonic) for convenience, or createClient(rpcUrl, wallet) with an existing wallet.',
      { value: rpcUrlOrMnemonic });
  }

  // Convenience call: createClient(mnemonic) — create wallet + try RPC endpoints
  validateMnemonic(rpcUrlOrMnemonic, 'createClient');
  const { wallet: derivedWallet } = await createWallet(rpcUrlOrMnemonic);
  const registry = buildRegistry();
  const gasPrice = GasPrice.fromString(GAS_PRICE);

  // Try each RPC endpoint until one connects
  const errors = [];
  for (const ep of RPC_ENDPOINTS) {
    try {
      const client = await SigningStargateClient.connectWithSigner(ep.url, derivedWallet, {
        gasPrice,
        registry,
      });
      return client;
    } catch (err) {
      errors.push({ endpoint: ep.url, name: ep.name, error: err.message });
    }
  }

  // All endpoints failed
  const tried = errors.map(e => `  ${e.name} (${e.endpoint}): ${e.error}`).join('\n');
  throw new ChainError('ALL_ENDPOINTS_FAILED',
    `createClient(mnemonic): failed to connect to all ${RPC_ENDPOINTS.length} RPC endpoints:\n${tried}`,
    { endpoints: errors });
}

// ─── TX Helpers ──────────────────────────────────────────────────────────────

/**
 * Simple broadcast — send messages and return result.
 * For production apps with multiple TXs, use createSafeBroadcaster() instead.
 */
export async function broadcast(client, signerAddress, msgs, fee = null) {
  if (!fee) fee = 'auto';
  let result;
  try {
    result = await client.signAndBroadcast(signerAddress, msgs, fee);
  } catch (err) {
    // CosmJS on Node.js v18+ uses native fetch (undici) internally for RPC.
    // Undici throws opaque "fetch failed" on network errors. Re-wrap with context.
    const typeUrls = msgs.map(m => m.typeUrl).join(', ');
    throw new ChainError(ErrorCodes.BROADCAST_FAILED, `Broadcast failed (${typeUrls}): ${err.message}`, { typeUrls, original: err.message });
  }
  if (result.code !== 0) throw new ChainError(ErrorCodes.TX_FAILED, `TX failed (code ${result.code}): ${result.rawLog}`, { code: result.code, rawLog: result.rawLog, txHash: result.transactionHash });
  return result;
}

// ─── Safe Broadcast (Mutex + Retry + Sequence Recovery) ─────────────────────
// Production-critical: prevents sequence mismatch errors when sending
// multiple TXs rapidly (batch operations, auto-lease + link, UI clicks).

function isSequenceError(errOrStr) {
  // Check Cosmos SDK error code 32 (ErrWrongSequence) first
  if (errOrStr?.code === 32) return true;
  const s = typeof errOrStr === 'string' ? errOrStr : errOrStr?.message || String(errOrStr);
  // Try parsing rawLog as JSON to extract error code
  try { const parsed = JSON.parse(s); if (parsed?.code === 32) return true; } catch {} // not JSON — fall through to string match
  // Fallback to string match (last resort — fragile across Cosmos SDK upgrades)
  return s && (s.includes('account sequence mismatch') || s.includes('incorrect account sequence'));
}

/**
 * Create a safe broadcaster with mutex serialization and retry logic.
 * Only one TX broadcasts at a time. Sequence errors trigger client reconnect + retry.
 *
 * Usage:
 *   const { safeBroadcast } = createSafeBroadcaster(rpcUrl, wallet, signerAddress);
 *   const result = await safeBroadcast([msg1, msg2]); // batch = one TX
 */
export function createSafeBroadcaster(rpcUrl, wallet, signerAddress) {
  let _client = null;
  let _queue = Promise.resolve();

  async function getClient() {
    if (!_client) {
      _client = await SigningStargateClient.connectWithSigner(rpcUrl, wallet, {
        gasPrice: GasPrice.fromString(GAS_PRICE),
        registry: buildRegistry(),
      });
    }
    return _client;
  }

  async function resetClient() {
    _client = await SigningStargateClient.connectWithSigner(rpcUrl, wallet, {
      gasPrice: GasPrice.fromString(GAS_PRICE),
      registry: buildRegistry(),
    });
    return _client;
  }

  async function _inner(msgs, memo) {
    for (let attempt = 0; attempt < 5; attempt++) {
      let client;
      if (attempt === 0) {
        client = await getClient();
      } else {
        const delay = Math.min(2000 * attempt, 6000);
        await new Promise(r => setTimeout(r, delay));
        client = await resetClient(); // fresh connection = fresh sequence
      }

      try {
        const result = await client.signAndBroadcast(signerAddress, msgs, 'auto', memo);
        if (result.code !== 0 && isSequenceError(result.rawLog)) continue;
        return result;
      } catch (err) {
        if (isSequenceError(err.message)) continue;
        throw err;
      }
    }
    // Final attempt
    await new Promise(r => setTimeout(r, 4000));
    const client = await resetClient();
    return client.signAndBroadcast(signerAddress, msgs, 'auto', memo);
  }

  function safeBroadcast(msgs, memo) {
    const p = _queue.then(() => _inner(msgs, memo));
    _queue = p.catch(() => {}); // don't break queue on failure
    return p;
  }

  return { safeBroadcast, getClient, resetClient };
}

/**
 * Parse chain error messages into user-friendly text.
 * Covers all known Sentinel-specific error patterns.
 */
export function parseChainError(raw) {
  const s = String(raw || '');
  if (s.includes('duplicate node for plan')) return 'Node is already in this plan';
  if (s.includes('duplicate provider')) return 'Provider already registered — use Update';
  if (s.includes('lease') && s.includes('not found')) return 'No active lease for this node';
  if (s.includes('lease') && s.includes('already exists')) return 'Lease already exists for this node';
  if (s.includes('insufficient funds')) return 'Insufficient P2P balance';
  if (s.includes('invalid price')) return 'Price mismatch — node may have changed rates';
  if (s.includes('invalid status inactive')) return 'Plan is inactive — activate first';
  if (s.includes('plan') && s.includes('does not exist')) return 'Plan not found on chain';
  if (s.includes('provider') && s.includes('does not exist')) return 'Provider not registered';
  if (s.includes('node') && s.includes('does not exist')) return 'Node not found on chain';
  if (s.includes('node') && s.includes('not active')) return 'Node is inactive';
  if (s.includes('active session already exists')) return 'Session already exists for this node';
  if (s.includes('subscription') && s.includes('not found')) return 'Subscription not found or expired';
  if (s.includes('node address mismatch')) return 'Node address mismatch — wrong node at this URL';
  if (s.includes('maximum peer limit')) return 'Node is full — maximum peer limit reached';
  if (isSequenceError(s)) return 'Chain busy — sequence mismatch. Wait and retry.';
  if (s.includes('out of gas')) return 'Transaction out of gas';
  if (s.includes('timed out')) return 'Transaction timed out';
  const m = s.match(/desc = (.+?)(?:\[|With gas|$)/);
  if (m) return m[1].trim().slice(0, 120);
  return s.slice(0, 150);
}

/**
 * Extract an ID from TX ABCI events.
 * Events may have base64-encoded keys/values depending on CosmJS version.
 *
 * Usage:
 *   extractId(result, /session/i, ['session_id', 'id'])
 *   extractId(result, /subscription/i, ['subscription_id', 'id'])
 *   extractId(result, /plan/i, ['plan_id', 'id'])
 *   extractId(result, /lease/i, ['lease_id', 'id'])
 */
export function extractId(txResult, eventPattern, keyNames) {
  for (const event of (txResult.events || [])) {
    if (eventPattern.test(event.type)) {
      for (const attr of event.attributes) {
        const k = typeof attr.key === 'string'
          ? attr.key
          : Buffer.from(attr.key, 'base64').toString('utf8');
        const v = typeof attr.value === 'string'
          ? attr.value
          : Buffer.from(attr.value, 'base64').toString('utf8');
        if (keyNames.includes(k)) {
          const p = v.replace(/"/g, '');
          if (p && parseInt(p) > 0) return p;
        }
      }
    }
  }
  return null;
}

// ─── LCD Query Helper ────────────────────────────────────────────────────────
// Canonical LCD functions live in chain/lcd.js. Re-export for backward compatibility.

import axios from 'axios';

export { lcd, lcdQuery, lcdQueryAll, lcdPaginatedSafe } from './chain/lcd.js';

// ─── Query Helpers ───────────────────────────────────────────────────────────

/**
 * Check wallet balance.
 * Returns { udvpn: number, dvpn: number }
 */
export async function getBalance(client, address) {
  const bal = await client.getBalance(address, 'udvpn');
  const amount = parseInt(bal?.amount || '0', 10) || 0;
  return { udvpn: amount, dvpn: amount / 1_000_000 };
}

/**
 * Find an existing active session for a wallet+node pair.
 * Returns session ID (BigInt) or null. Use this to avoid double-paying.
 *
 * Note: Sessions have a nested base_session object containing the actual data.
 */
export async function findExistingSession(lcdUrl, walletAddr, nodeAddr) {
  return _findExistingSession(lcdUrl, walletAddr, nodeAddr);
}

/**
 * Resolve LCD node object to an HTTPS URL.
 * LCD v3 returns `remote_addrs: ["IP:PORT"]` (array, NO protocol prefix).
 * Legacy responses may have `remote_url: "https://IP:PORT"` (string with prefix).
 * This handles both formats.
 */
export function resolveNodeUrl(node) {
  return _resolveNodeUrl(node);
}

/**
 * Fetch all active nodes from LCD with pagination.
 * Returns array of node objects. Each node has `remote_url` resolved from `remote_addrs`.
 */
export async function fetchActiveNodes(lcdUrl, limit = 500, maxPages = 20) {
  return _fetchActiveNodes(lcdUrl, limit, maxPages);
}

/**
 * Get a quick network overview — total nodes, counts by country and service type, average prices.
 * Perfect for dashboard UIs, onboarding screens, and network health displays.
 *
 * @param {string} [lcdUrl] - LCD endpoint (default: cascading fallback)
 * @returns {Promise<{ totalNodes: number, byCountry: Array<{country: string, count: number}>, byType: {wireguard: number, v2ray: number, unknown: number}, averagePrice: {gigabyteDvpn: number, hourlyDvpn: number}, nodes: Array }>}
 *
 * @example
 *   const overview = await getNetworkOverview();
 *   console.log(`${overview.totalNodes} nodes across ${overview.byCountry.length} countries`);
 *   console.log(`Average: ${overview.averagePrice.gigabyteDvpn.toFixed(3)} P2P/GB`);
 */
export async function getNetworkOverview(lcdUrl) {
  return _getNetworkOverview(lcdUrl);
}

/**
 * Discover plan IDs by probing subscription endpoints.
 * Workaround for /sentinel/plan/v3/plans returning 501 Not Implemented.
 * Returns sorted array of plan IDs that have at least 1 subscription.
 */
export async function discoverPlanIds(lcdUrl, maxId = 500) {
  return _discoverPlanIds(lcdUrl, maxId);
}

/**
 * Get standardized prices for a node — abstracts V3 LCD price parsing entirely.
 *
 * Solves the common "NaN / GB" problem by defensively extracting quote_value,
 * base_value, or amount from the nested LCD response structure.
 *
 * @param {string} nodeAddress - sentnode1... address
 * @param {string} [lcdUrl] - LCD endpoint URL (default: cascading fallback across all endpoints)
 * @returns {Promise<{ gigabyte: { dvpn: number, udvpn: number, raw: object|null }, hourly: { dvpn: number, udvpn: number, raw: object|null }, denom: string, nodeAddress: string }>}
 *
 * @example
 *   const prices = await getNodePrices('sentnode1abc...');
 *   console.log(`${prices.gigabyte.dvpn} P2P/GB, ${prices.hourly.dvpn} P2P/hr`);
 *   // Use prices.gigabyte.raw for the full { denom, base_value, quote_value } object
 *   // needed by encodeMsgStartSession's max_price field.
 */
export async function getNodePrices(nodeAddress, lcdUrl) {
  return _getNodePrices(nodeAddress, lcdUrl);
}

// ─── Display & Serialization Helpers ────────────────────────────────────────

/**
 * Format a micro-denom (udvpn) amount as a human-readable P2P string.
 *
 * @param {number|string} udvpn - Amount in micro-denom (1 P2P = 1,000,000 udvpn)
 * @param {number} [decimals=2] - Decimal places to show
 * @returns {string} e.g., "0.04 P2P", "47.69 P2P"
 *
 * @example
 *   formatDvpn(40152030);      // "40.15 P2P"
 *   formatDvpn('1000000', 0);  // "1 P2P"
 *   formatDvpn(500000, 4);     // "0.5000 P2P"
 */
export function formatDvpn(udvpn, decimals = 2) {
  const val = Number(udvpn) / 1_000_000;
  if (isNaN(val)) return '? P2P';
  return `${val.toFixed(decimals)} P2P`;
}

/** Alias for formatDvpn — uses the current P2P token name. */
export const formatP2P = formatDvpn;

/**
 * Filter a node list by country, service type, and/or max price.
 * Works with results from listNodes(), enrichNodes(), or fetchAllNodes().
 *
 * @param {Array} nodes - Array of node objects
 * @param {object} criteria
 * @param {string} [criteria.country] - Country name (case-insensitive partial match)
 * @param {string} [criteria.serviceType] - 'wireguard' or 'v2ray'
 * @param {number} [criteria.maxPriceDvpn] - Maximum GB price in P2P (e.g., 0.1)
 * @param {number} [criteria.minScore] - Minimum quality score (0-100)
 * @returns {Array} Filtered nodes
 *
 * @example
 *   const cheap = filterNodes(nodes, { maxPriceDvpn: 0.05, serviceType: 'v2ray' });
 *   const german = filterNodes(nodes, { country: 'Germany' });
 */
export function filterNodes(nodes, criteria = {}) {
  if (!Array.isArray(nodes)) return [];
  return nodes.filter(node => {
    if (criteria.country) {
      const c = (node.country || node.location?.country || '').toLowerCase();
      if (!c.includes(criteria.country.toLowerCase())) return false;
    }
    if (criteria.serviceType) {
      const t = node.serviceType || node.type || '';
      if (t !== criteria.serviceType) return false;
    }
    if (criteria.maxPriceDvpn != null) {
      const prices = node.gigabytePrices || node.gigabyte_prices || [];
      const entry = prices.find(p => p.denom === 'udvpn');
      if (entry) {
        const dvpn = parseInt(entry.quote_value || entry.base_value || entry.amount || '0', 10) / 1_000_000;
        if (dvpn > criteria.maxPriceDvpn) return false;
      }
    }
    if (criteria.minScore != null && node.qualityScore != null) {
      if (node.qualityScore < criteria.minScore) return false;
    }
    return true;
  });
}

/**
 * Serialize a ConnectResult for JSON APIs. Handles BigInt → string conversion.
 * Without this, JSON.stringify(connectResult) throws "BigInt can't be serialized".
 *
 * @param {object} result - ConnectResult from connectDirect/connectAuto/connectViaPlan
 * @returns {object} JSON-safe object with sessionId as string
 *
 * @example
 *   const conn = await connectDirect(opts);
 *   res.json(serializeResult(conn)); // Safe for Express response
 */
export function serializeResult(result) {
  if (!result || typeof result !== 'object') return result;
  const out = {};
  for (const [key, val] of Object.entries(result)) {
    if (typeof val === 'bigint') out[key] = String(val);
    else if (typeof val === 'function') continue; // skip cleanup()
    else out[key] = val;
  }
  return out;
}

/**
 * Get P2P price in USD from CoinGecko (cached for 5 minutes).
 */
let _dvpnPrice = null;
let _dvpnPriceAt = 0;
export async function getDvpnPrice() {
  if (_dvpnPrice && Date.now() - _dvpnPriceAt < 300_000) return _dvpnPrice;
  try {
    const res = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=sentinel&vs_currencies=usd', { timeout: 10000 });
    _dvpnPrice = res.data?.sentinel?.usd || null;
    _dvpnPriceAt = Date.now();
  } catch { /* keep old value */ }
  return _dvpnPrice;
}

/**
 * BigInt-safe serialization of TX result (for logging/API responses).
 */
export function txResponse(result) {
  return {
    ok: result.code === 0,
    txHash: result.transactionHash,
    gasUsed: Number(result.gasUsed),
    gasWanted: Number(result.gasWanted),
    code: result.code,
    rawLog: result.rawLog,
    events: result.events,
  };
}

// Re-export for convenience
export { extractSessionId };

// ─── Protobuf Helpers for FeeGrant & Authz ──────────────────────────────────
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

function encodeAny(typeUrl, valueBytes) {
  return Buffer.concat([
    protoString(1, typeUrl),
    protoEmbedded(2, valueBytes),
  ]);
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

function encodeGenericAuthorization(msgTypeUrl) {
  return protoString(1, msgTypeUrl);
}

function encodeGrant(authTypeUrl, authBytes, expiration) {
  const parts = [protoEmbedded(1, encodeAny(authTypeUrl, authBytes))];
  if (expiration) {
    parts.push(protoEmbedded(2, encodeTimestamp(expiration instanceof Date ? expiration : new Date(expiration))));
  }
  return Buffer.concat(parts);
}

// ─── FeeGrant (cosmos.feegrant.v1beta1) ─────────────────────────────────────
// Gas-free UX: granter pays fees for grantee's transactions.
//
// Usage:
//   const msg = buildFeeGrantMsg(serviceAddr, userAddr, { spendLimit: 5000000 });
//   await broadcast(client, serviceAddr, [msg]);
//   // Now userAddr can broadcast without P2P for gas
//   await broadcastWithFeeGrant(client, userAddr, [connectMsg], serviceAddr);

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
 * @returns {Promise<Array>} Array of allowance objects
 */
export async function queryFeeGrants(lcdUrl, grantee) {
  return _queryFeeGrants(lcdUrl, grantee);
}

/**
 * Query fee grants issued BY an address (where addr is the granter).
 * @param {string} lcdUrl
 * @param {string} granter - Address that issued the grants
 * @returns {Promise<Array>}
 */
export async function queryFeeGrantsIssued(lcdUrl, granter) {
  return _queryFeeGrantsIssued(lcdUrl, granter);
}

/**
 * Query a specific fee grant between granter and grantee.
 * @returns {Promise<object|null>} Allowance object or null
 */
export async function queryFeeGrant(lcdUrl, granter, grantee) {
  return _queryFeeGrant(lcdUrl, granter, grantee);
}

/**
 * Broadcast a TX with fee paid by a granter (fee grant).
 * The grantee signs; the granter pays gas via their fee allowance.
 * @param {SigningStargateClient} client - Client with grantee's wallet
 * @param {string} signerAddress - Grantee address (sent1...)
 * @param {Array} msgs - Messages to broadcast
 * @param {string} granterAddress - Fee granter address (sent1...)
 * @param {string} memo - Optional memo
 */
export async function broadcastWithFeeGrant(client, signerAddress, msgs, granterAddress, memo = '') {
  // NOTE: client.simulate() does NOT support fee granter — it simulates without
  // the granter field, causing "insufficient funds" if the grantee has low balance.
  // Use fixed gas estimate instead. 300k gas covers all single-message Sentinel TXs.
  // For multi-message batches, scale by message count.
  const gasPerMsg = 200_000;
  const gasLimit = Math.max(300_000, msgs.length * gasPerMsg);
  const fee = {
    amount: [{ denom: 'udvpn', amount: String(Math.ceil(gasLimit * 0.2)) }],
    gas: String(gasLimit),
    granter: granterAddress,
  };
  return client.signAndBroadcast(signerAddress, msgs, fee, memo);
}

// ─── Authz (cosmos.authz.v1beta1) ──────────────────────────────────────────
// Authorization grants: granter allows grantee to execute specific messages.
//
// Usage (server-side subscription management):
//   // User grants server permission to start sessions on their behalf
//   const msg = buildAuthzGrantMsg(userAddr, serverAddr, MSG_TYPES.PLAN_START_SESSION);
//   await broadcast(client, userAddr, [msg]);
//   // Server can now start sessions for the user
//   const innerMsg = { typeUrl: MSG_TYPES.PLAN_START_SESSION, value: { from: userAddr, ... } };
//   const execMsg = buildAuthzExecMsg(serverAddr, encodeForExec([innerMsg]));
//   await broadcast(serverClient, serverAddr, [execMsg]);

/**
 * Build a MsgGrant (authz) for a specific message type.
 * @param {string} granter - Address granting permission (sent1...)
 * @param {string} grantee - Address receiving permission (sent1...)
 * @param {string} msgTypeUrl - Message type URL to authorize (e.g. MSG_TYPES.START_SESSION)
 * @param {Date|string} expiration - Optional expiry date (default: no expiry)
 */
export function buildAuthzGrantMsg(granter, grantee, msgTypeUrl, expiration) {
  const authBytes = encodeGenericAuthorization(msgTypeUrl);

  return {
    typeUrl: '/cosmos.authz.v1beta1.MsgGrant',
    value: {
      granter,
      grantee,
      grant: {
        authorization: {
          typeUrl: '/cosmos.authz.v1beta1.GenericAuthorization',
          value: Uint8Array.from(authBytes),
        },
        expiration: expiration
          ? { seconds: BigInt(Math.floor((expiration instanceof Date ? expiration : new Date(expiration)).getTime() / 1000)), nanos: 0 }
          : undefined,
      },
    },
  };
}

/**
 * Build a MsgRevoke (authz) to remove a specific grant.
 */
export function buildAuthzRevokeMsg(granter, grantee, msgTypeUrl) {
  return {
    typeUrl: '/cosmos.authz.v1beta1.MsgRevoke',
    value: { granter, grantee, msgTypeUrl },
  };
}

/**
 * Build a MsgExec (authz) to execute messages on behalf of a granter.
 * @param {string} grantee - Address executing on behalf of granter
 * @param {Array} encodedMsgs - Pre-encoded messages (use encodeForExec() to prepare)
 */
export function buildAuthzExecMsg(grantee, encodedMsgs) {
  return {
    typeUrl: '/cosmos.authz.v1beta1.MsgExec',
    value: { grantee, msgs: encodedMsgs },
  };
}

/**
 * Encode SDK message objects to the Any format required by MsgExec.
 * @param {Array<{typeUrl: string, value: object}>} msgs - Standard SDK messages
 * @returns {Array<{typeUrl: string, value: Uint8Array}>} Encoded messages for MsgExec
 */
export function encodeForExec(msgs) {
  const reg = buildRegistry();
  return msgs.map(msg => {
    const type = reg.lookupType(msg.typeUrl);
    if (!type) throw new ChainError(ErrorCodes.UNKNOWN_MSG_TYPE, `Unknown message type: ${msg.typeUrl}. Ensure it is registered in buildRegistry().`, { typeUrl: msg.typeUrl });
    return {
      typeUrl: msg.typeUrl,
      value: type.encode(type.fromPartial(msg.value)).finish(),
    };
  });
}

/**
 * Query authz grants between granter and grantee.
 * @returns {Promise<Array>} Array of grant objects
 */
export async function queryAuthzGrants(lcdUrl, granter, grantee) {
  return _queryAuthzGrants(lcdUrl, granter, grantee);
}

// LCD Query Helpers — canonical implementations in chain/lcd.js, re-exported above.

// ─── Plan Subscriber Helpers (v25b) ──────────────────────────────────────────

/**
 * Query all subscriptions for a plan. Supports owner filtering.
 *
 * @param {number|string} planId - Plan ID
 * @param {object} [opts]
 * @param {string} [opts.lcdUrl] - LCD endpoint
 * @param {string} [opts.excludeAddress] - Filter out this address (typically the plan owner)
 * @returns {Promise<{ subscribers: Array<{ address: string, status: number, id: string }>, total: number|null }>}
 */
export async function queryPlanSubscribers(planId, opts = {}) {
  return _queryPlanSubscribers(planId, opts);
}

/**
 * Get plan stats with self-subscription filtered out.
 *
 * @param {number|string} planId
 * @param {string} ownerAddress - Plan owner's sent1... address (filtered from counts)
 * @param {object} [opts]
 * @param {string} [opts.lcdUrl]
 * @returns {Promise<{ subscriberCount: number, totalOnChain: number, ownerSubscribed: boolean }>}
 */
export async function getPlanStats(planId, ownerAddress, opts = {}) {
  return _getPlanStats(planId, ownerAddress, opts);
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
  return _grantPlanSubscribers(planId, opts);
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
  return _getExpiringGrants(lcdUrl, granteeOrGranter, withinDays, role);
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
  return _renewExpiringGrants(lcdUrl, granterAddress, withinDays, grantOpts);
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
  return _monitorFeeGrants(opts);
}

// ─── Query Helpers (v25c) ────────────────────────────────────────────────────

/**
 * Query a wallet's active subscriptions.
 * @param {string} lcdUrl
 * @param {string} walletAddr - sent1... address
 * @returns {Promise<{ subscriptions: any[], total: number|null }>}
 */
export async function querySubscriptions(lcdUrl, walletAddr, opts = {}) {
  return _querySubscriptions(lcdUrl, walletAddr, opts);
}

/**
 * Query session allocation (remaining bandwidth).
 * @param {string} lcdUrl
 * @param {string|number|bigint} sessionId
 * @returns {Promise<{ maxBytes: number, usedBytes: number, remainingBytes: number, percentUsed: number }|null>}
 */
export async function querySessionAllocation(lcdUrl, sessionId) {
  return _querySessionAllocation(lcdUrl, sessionId);
}

/**
 * Fetch a single node by address from LCD (no need to fetch all 1000+ nodes).
 * Tries the direct v3 endpoint first, falls back to paginated search.
 *
 * @param {string} nodeAddress - sentnode1... address
 * @param {object} [opts]
 * @param {string} [opts.lcdUrl] - LCD endpoint (or uses fallback chain)
 * @returns {Promise<object>} Node object with remote_url resolved
 */
export async function queryNode(nodeAddress, opts = {}) {
  return _queryNode(nodeAddress, opts);
}

/**
 * Build batch MsgStartSession messages for multiple nodes in one TX.
 * Saves gas vs separate TXs (~800k gas for 5 sessions vs 200k × 5 = 1M).
 *
 * @param {string} from - Wallet address (sent1...)
 * @param {Array<{ nodeAddress: string, gigabytes?: number, maxPrice: { denom: string, base_value: string, quote_value: string } }>} nodes
 * @returns {Array<{ typeUrl: string, value: object }>} Messages ready for broadcast()
 */
export function buildBatchStartSession(from, nodes) {
  return nodes.map(n => ({
    typeUrl: '/sentinel.node.v3.MsgStartSessionRequest',
    value: {
      from,
      node_address: n.nodeAddress,
      gigabytes: n.gigabytes || 1,
      hours: 0,
      max_price: n.maxPrice,
    },
  }));
}

/**
 * Build MsgEndSession to close a session early (stop paying for bandwidth).
 * @param {string} from - Wallet address
 * @param {number|string|bigint} sessionId - Session to end
 * @returns {{ typeUrl: string, value: object }}
 */
export function buildEndSessionMsg(from, sessionId) {
  return {
    typeUrl: '/sentinel.session.v3.MsgCancelSessionRequest',
    value: { from, id: BigInt(sessionId) },
  };
}

// lcdPaginatedSafe — canonical implementation in chain/lcd.js, re-exported above.

// ─── v26c: Session & Subscription Queries ────────────────────────────────────

/**
 * List all sessions for a wallet address.
 * @param {string} address - sent1... wallet address
 * @param {string} [lcdUrl]
 * @param {object} [opts]
 * @param {string} [opts.status] - '1' (active) or '2' (inactive)
 * @returns {Promise<{ items: ChainSession[], total: number }>}
 */
export async function querySessions(address, lcdUrl, opts = {}) {
  return _querySessions(address, lcdUrl, opts);
}

/**
 * Flatten a chain session's base_session fields to top level.
 * Prevents the #1 footgun: `session.id === undefined` (data is nested under base_session).
 * Preserves `price` (node sessions) and `subscription_id` (plan sessions).
 *
 * @param {object} session - Raw LCD session object
 * @returns {object} Flattened session with all fields at top level
 */
export function flattenSession(session) {
  return _flattenSession(session);
}

/**
 * Get a single subscription by ID.
 * @param {string|number} id - Subscription ID
 * @param {string} [lcdUrl]
 * @returns {Promise<Subscription|null>}
 */
export async function querySubscription(id, lcdUrl) {
  return _querySubscription(id, lcdUrl);
}

/**
 * Check if wallet has an active subscription for a specific plan.
 * @param {string} address - sent1... wallet address
 * @param {number|string} planId - Plan ID to check
 * @param {string} [lcdUrl]
 * @returns {Promise<{ has: boolean, subscription?: object }>}
 */
export async function hasActiveSubscription(address, planId, lcdUrl) {
  return _hasActiveSubscription(address, planId, lcdUrl);
}

// ─── v26c: Display Helpers ───────────────────────────────────────────────────

/**
 * Format byte count for display.
 * @param {number} bytes
 * @returns {string} e.g. '1.5 GB', '340 MB', '1.2 KB'
 */
export function formatBytes(bytes) {
  if (bytes == null || isNaN(bytes)) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(2) + ' GB';
}

/**
 * Parse chain duration string (has "s" suffix).
 * @param {string} durationStr - e.g. '557817.727815887s'
 * @returns {{ seconds: number, hours: number, minutes: number, formatted: string }}
 */
export function parseChainDuration(durationStr) {
  const seconds = parseFloat(String(durationStr).replace(/s$/i, '')) || 0;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const formatted = hours > 0 ? `${hours}h ${minutes}m` : minutes > 0 ? `${minutes}m ${secs}s` : `${secs}s`;
  return { seconds, hours, minutes, formatted };
}

// ─── v26: Field Experience Helpers ────────────────────────────────────────────

/**
 * Query all nodes linked to a plan.
 * @param {number|string} planId
 * @param {string} [lcdUrl]
 * @returns {Promise<{ items: any[], total: number|null }>}
 */
export async function queryPlanNodes(planId, lcdUrl) {
  return _queryPlanNodes(planId, lcdUrl);
}

/**
 * Discover all available plans with metadata (subscriber count, node count, price).
 * Probes plan IDs 1-maxId, returns plans with >=1 subscriber.
 *
 * @param {string} [lcdUrl]
 * @param {object} [opts]
 * @param {number} [opts.maxId=500] - Highest plan ID to probe
 * @param {number} [opts.batchSize=15] - Parallel probes per batch
 * @param {boolean} [opts.includeEmpty=false] - Include plans with 0 nodes
 * @returns {Promise<Array<{ id: number, subscribers: number, nodeCount: number, price: object|null, hasNodes: boolean }>>}
 */
export async function discoverPlans(lcdUrl, opts = {}) {
  return _discoverPlans(lcdUrl, opts);
}

/**
 * Truncate an address for display. Works with sent1, sentprov1, sentnode1.
 * @param {string} addr
 * @param {number} [prefixLen=12]
 * @param {number} [suffixLen=6]
 * @returns {string}
 */
export function shortAddress(addr, prefixLen = 12, suffixLen = 6) {
  if (!addr || addr.length <= prefixLen + suffixLen + 3) return addr || '';
  return `${addr.slice(0, prefixLen)}...${addr.slice(-suffixLen)}`;
}

/**
 * Format subscription expiry as relative time.
 * @param {object} subscription - LCD subscription object (or any object with inactive_at)
 * @returns {string} e.g. "23d left", "4h left", "expired"
 */
export function formatSubscriptionExpiry(subscription) {
  const iso = subscription?.inactive_at || subscription?.status_at;
  if (!iso) return 'unknown';
  const diff = new Date(iso).getTime() - Date.now();
  if (diff < 0) return 'expired';
  const days = Math.floor(diff / 86400000);
  if (days > 1) return `${days}d left`;
  const hrs = Math.floor(diff / 3600000);
  if (hrs > 0) return `${hrs}h left`;
  const mins = Math.floor(diff / 60000);
  if (mins > 0) return `${mins}m left`;
  return '<1m left';
}

/**
 * Send P2P tokens to an address.
 * @param {SigningStargateClient} client
 * @param {string} fromAddress
 * @param {string} toAddress
 * @param {number|string} amountUdvpn - Amount in micro-denom
 * @param {string} [memo='']
 * @returns {Promise<DeliverTxResponse>}
 */
export async function sendTokens(client, fromAddress, toAddress, amountUdvpn, memo = '') {
  // Robust amount extraction: handle string, number, bigint, or coin object { amount, denom }
  let amountStr;
  if (amountUdvpn && typeof amountUdvpn === 'object') {
    amountStr = String(amountUdvpn.amount || amountUdvpn.value || amountUdvpn);
  } else {
    amountStr = String(amountUdvpn);
  }
  if (!amountStr || amountStr === 'undefined' || amountStr === 'null' || amountStr === '[object Object]') {
    throw new Error(`sendTokens: invalid amount "${amountUdvpn}" — expected string or number, got ${typeof amountUdvpn}`);
  }
  const msg = {
    typeUrl: '/cosmos.bank.v1beta1.MsgSend',
    value: { fromAddress, toAddress, amount: [{ denom: 'udvpn', amount: amountStr }] },
  };
  return broadcast(client, fromAddress, [msg]);
}

/**
 * Subscribe to a plan. Returns subscription ID from TX events.
 * @param {SigningStargateClient} client
 * @param {string} fromAddress
 * @param {number|string|bigint} planId
 * @param {string} [denom='udvpn']
 * @returns {Promise<{ subscriptionId: bigint, txHash: string }>}
 */
export async function subscribeToPlan(client, fromAddress, planId, denom = 'udvpn') {
  const msg = {
    typeUrl: MSG_TYPES_OBJ.START_SUBSCRIPTION,
    value: { from: fromAddress, id: BigInt(planId), denom, renewalPricePolicy: 0 },
  };
  const result = await broadcast(client, fromAddress, [msg]);
  const subId = extractId(result, /subscription/i, ['subscription_id', 'id']);
  if (!subId) throw new ChainError(ErrorCodes.SESSION_EXTRACT_FAILED, 'Failed to extract subscription ID from TX events', { txHash: result.transactionHash });
  return { subscriptionId: BigInt(subId), txHash: result.transactionHash };
}

/**
 * Get provider details by address.
 * @param {string} provAddress - sentprov1... address
 * @param {object} [opts]
 * @param {string} [opts.lcdUrl]
 * @returns {Promise<object|null>}
 */
export async function getProviderByAddress(provAddress, opts = {}) {
  return _getProviderByAddress(provAddress, opts);
}

/**
 * Build batch MsgSend messages for token distribution.
 * @param {string} fromAddress
 * @param {Array<{ address: string, amountUdvpn: number|string }>} recipients
 * @returns {Array<{ typeUrl: string, value: object }>}
 */
export function buildBatchSend(fromAddress, recipients) {
  return recipients.map(r => ({
    typeUrl: '/cosmos.bank.v1beta1.MsgSend',
    value: { fromAddress, toAddress: r.address, amount: [{ denom: 'udvpn', amount: String(r.amountUdvpn) }] },
  }));
}

/**
 * Build batch MsgLinkNode messages for linking nodes to a plan.
 * @param {string} provAddress - sentprov1... address
 * @param {number|string|bigint} planId
 * @param {string[]} nodeAddresses - sentnode1... addresses
 * @returns {Array<{ typeUrl: string, value: object }>}
 */
export function buildBatchLink(provAddress, planId, nodeAddresses) {
  return nodeAddresses.map(addr => ({
    typeUrl: '/sentinel.plan.v3.MsgLinkNodeRequest',
    value: { from: provAddress, id: BigInt(planId), node_address: addr },
  }));
}

/**
 * Decode base64-encoded TX events into readable key-value pairs.
 * @param {Array} events - TX result events array
 * @returns {Array<{ type: string, attributes: Array<{ key: string, value: string }> }>}
 */
export function decodeTxEvents(events) {
  return (events || []).map(e => ({
    type: e.type,
    attributes: (e.attributes || []).map(a => ({
      key: typeof a.key === 'string' ? a.key : Buffer.from(a.key, 'base64').toString('utf8'),
      value: typeof a.value === 'string' ? a.value : Buffer.from(a.value, 'base64').toString('utf8'),
    })),
  }));
}

/**
 * Extract ALL session IDs from a batch TX result (multiple MsgStartSession).
 * @param {DeliverTxResponse} txResult
 * @returns {bigint[]}
 */
export function extractAllSessionIds(txResult) {
  const ids = [];
  const seen = new Set();
  const decoded = decodeTxEvents(txResult.events || []);
  for (const evt of decoded) {
    if (/session/i.test(evt.type)) {
      for (const attr of evt.attributes) {
        if (attr.key === 'session_id' || attr.key === 'SessionID' || attr.key === 'id') {
          try {
            const id = BigInt(attr.value.replace(/"/g, '')); // strip quotes from base64-decoded values
            if (id > 0n && !seen.has(id)) { seen.add(id); ids.push(id); }
          } catch {}
        }
      }
    }
  }
  return ids;
}

/**
 * Estimate gas fee for a batch of messages.
 * @param {number} msgCount
 * @param {string} [msgType='startSession'] - 'startSession' | 'feeGrant' | 'send'
 * @returns {{ gas: number, amount: number, fee: { amount: Array<{ denom: string, amount: string }>, gas: string } }}
 */
export function estimateBatchFee(msgCount, msgType = 'startSession') {
  const gasPerMsg = { startSession: 200000, feeGrant: 150000, send: 80000, link: 150000 };
  const base = gasPerMsg[msgType] || 200000;
  const gas = base * msgCount;
  const amount = Math.ceil(gas * 0.2); // GAS_PRICE = 0.2udvpn
  return {
    gas,
    amount,
    fee: { amount: [{ denom: 'udvpn', amount: String(amount) }], gas: String(gas) },
  };
}

/**
 * Estimate the cost of starting a session with a node.
 * Supports both gigabyte and hourly pricing. When preferHourly is true and
 * hourly pricing is available and cheaper, returns the hourly cost instead.
 *
 * @param {object} nodeInfo - Node LCD object with gigabyte_prices and optionally hourly_prices
 * @param {number} [gigabytes=1] - Number of gigabytes (ignored when hourly pricing is selected)
 * @param {{ preferHourly?: boolean, hours?: number }} [options] - Optional pricing mode
 * @returns {{ udvpn: number, dvpn: number, gasUdvpn: number, totalUdvpn: number, mode: 'gigabyte'|'hourly', hourlyUdvpn?: number, gigabyteUdvpn?: number }}
 */
export function estimateSessionCost(nodeInfo, gigabytes = 1, options = {}) {
  const gbPrices = nodeInfo.gigabyte_prices || nodeInfo.gigabytePrices || [];
  const gbEntry = gbPrices.find(p => p.denom === 'udvpn');
  const perGb = parseInt(gbEntry?.quote_value || gbEntry?.amount || '0', 10);

  const hrPrices = nodeInfo.hourly_prices || nodeInfo.hourlyPrices || [];
  const hrEntry = hrPrices.find(p => p.denom === 'udvpn');
  const perHour = parseInt(hrEntry?.quote_value || hrEntry?.amount || '0', 10);

  const hours = options.hours || 1;
  const gbCost = perGb * gigabytes;
  const hrCost = perHour * hours;

  // Use hourly if preferHourly is set AND hourly pricing exists AND is cheaper
  const useHourly = options.preferHourly && hrEntry && hrCost < gbCost;
  const sessionCost = useHourly ? hrCost : gbCost;
  const gasEstimate = 200000; // ~200k gas per MsgStartSession

  return {
    udvpn: sessionCost,
    dvpn: sessionCost / 1_000_000,
    gasUdvpn: gasEstimate,
    totalUdvpn: sessionCost + gasEstimate,
    mode: useHourly ? 'hourly' : 'gigabyte',
    hourlyUdvpn: perHour || null,
    gigabyteUdvpn: perGb || null,
  };
}

/**
 * Compare two addresses across different bech32 prefixes (sent1, sentprov1, sentnode1).
 * Returns true if they derive from the same public key.
 * @param {string} addr1
 * @param {string} addr2
 * @returns {boolean}
 */
export function isSameKey(addr1, addr2) {
  try {
    const { data: d1 } = fromBech32(addr1);
    const { data: d2 } = fromBech32(addr2);
    return Buffer.from(d1).equals(Buffer.from(d2));
  } catch { return false; }
}

// Internal ref for subscribeToPlan (avoids circular ref with MSG_TYPES below)
const MSG_TYPES_OBJ = { START_SUBSCRIPTION: '/sentinel.subscription.v3.MsgStartSubscriptionRequest' };

// ─── All Type URL Constants ──────────────────────────────────────────────────

export const MSG_TYPES = {
  // Direct node session
  START_SESSION:          '/sentinel.node.v3.MsgStartSessionRequest',
  END_SESSION:            '/sentinel.session.v3.MsgCancelSessionRequest',
  // Subscription
  START_SUBSCRIPTION:     '/sentinel.subscription.v3.MsgStartSubscriptionRequest',
  SUB_START_SESSION:      '/sentinel.subscription.v3.MsgStartSessionRequest',
  // Plan
  PLAN_START_SESSION:     '/sentinel.plan.v3.MsgStartSessionRequest',
  CREATE_PLAN:            '/sentinel.plan.v3.MsgCreatePlanRequest',
  UPDATE_PLAN_STATUS:     '/sentinel.plan.v3.MsgUpdatePlanStatusRequest',
  LINK_NODE:              '/sentinel.plan.v3.MsgLinkNodeRequest',
  UNLINK_NODE:            '/sentinel.plan.v3.MsgUnlinkNodeRequest',
  // Provider
  REGISTER_PROVIDER:      '/sentinel.provider.v3.MsgRegisterProviderRequest',
  UPDATE_PROVIDER:        '/sentinel.provider.v3.MsgUpdateProviderDetailsRequest',
  UPDATE_PROVIDER_STATUS: '/sentinel.provider.v3.MsgUpdateProviderStatusRequest',
  // Plan details update (v3 — NEW)
  UPDATE_PLAN_DETAILS:    '/sentinel.plan.v3.MsgUpdatePlanDetailsRequest',
  // Lease
  START_LEASE:            '/sentinel.lease.v1.MsgStartLeaseRequest',
  END_LEASE:              '/sentinel.lease.v1.MsgEndLeaseRequest',
  // Subscription management (v3)
  CANCEL_SUBSCRIPTION:    '/sentinel.subscription.v3.MsgCancelSubscriptionRequest',
  RENEW_SUBSCRIPTION:     '/sentinel.subscription.v3.MsgRenewSubscriptionRequest',
  SHARE_SUBSCRIPTION:     '/sentinel.subscription.v3.MsgShareSubscriptionRequest',
  UPDATE_SUBSCRIPTION:    '/sentinel.subscription.v3.MsgUpdateSubscriptionRequest',
  // Session management (v3)
  UPDATE_SESSION:         '/sentinel.session.v3.MsgUpdateSessionRequest',
  // Node operator (v3)
  REGISTER_NODE:          '/sentinel.node.v3.MsgRegisterNodeRequest',
  UPDATE_NODE_DETAILS:    '/sentinel.node.v3.MsgUpdateNodeDetailsRequest',
  UPDATE_NODE_STATUS:     '/sentinel.node.v3.MsgUpdateNodeStatusRequest',
  // Cosmos FeeGrant
  GRANT_FEE_ALLOWANCE:    '/cosmos.feegrant.v1beta1.MsgGrantAllowance',
  REVOKE_FEE_ALLOWANCE:   '/cosmos.feegrant.v1beta1.MsgRevokeAllowance',
  // Cosmos Authz
  AUTHZ_GRANT:            '/cosmos.authz.v1beta1.MsgGrant',
  AUTHZ_REVOKE:           '/cosmos.authz.v1beta1.MsgRevoke',
  AUTHZ_EXEC:             '/cosmos.authz.v1beta1.MsgExec',
};

// ─── VPN Settings Persistence ────────────────────────────────────────────────
// v27: Persistent user settings (backported from C# VpnSettings.cs).
// Stores preferences in ~/.sentinel-sdk/settings.json with restrictive permissions.


/**
 * Load persisted VPN settings from disk.
 * Returns empty object if file doesn't exist or is corrupt.
 * @returns {Record<string, any>}
 */
export function loadVpnSettings() {
  return _loadVpnSettings();
}

/**
 * Save VPN settings to disk. Creates ~/.sentinel-sdk/ if needed.
 * @param {Record<string, any>} settings
 */
export function saveVpnSettings(settings) {
  return _saveVpnSettings(settings);
}
