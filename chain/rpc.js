/**
 * Sentinel SDK — Chain / RPC Query Module
 *
 * RPC-based chain queries via CosmJS QueryClient + ABCI.
 * ~912x faster than LCD for bulk queries. Uses protobuf transport.
 *
 * Falls back to LCD if RPC connection fails.
 *
 * Usage:
 *   import { createRpcQueryClient, rpcQueryNodes, rpcQueryNode } from './chain/rpc.js';
 *   const rpcClient = await createRpcQueryClient('https://rpc.sentinel.co:443');
 *   const nodes = await rpcQueryNodes(rpcClient, { status: 1, limit: 100 });
 */

import { Tendermint37Client } from '@cosmjs/tendermint-rpc';
import { QueryClient, createProtobufRpcClient } from '@cosmjs/stargate';
import { RPC_ENDPOINTS } from '../defaults.js';

// ─── RPC Client Creation ────────────────────────────────────────────────────

let _cachedRpcClient = null;
let _cachedRpcUrl = null;

/**
 * Create or return cached RPC query client with ABCI protobuf support.
 * Tries RPC endpoints in order until one connects.
 *
 * @param {string} [rpcUrl] - RPC endpoint URL (defaults to first in RPC_ENDPOINTS)
 * @returns {Promise<{ queryClient: QueryClient, rpc: ReturnType<typeof createProtobufRpcClient>, tmClient: Tendermint37Client }>}
 */
export async function createRpcQueryClient(rpcUrl) {
  const url = rpcUrl || RPC_ENDPOINTS[0]?.url || 'https://rpc.sentinel.co:443';

  if (_cachedRpcClient && _cachedRpcUrl === url) return _cachedRpcClient;

  const tmClient = await Tendermint37Client.connect(url);
  const queryClient = QueryClient.withExtensions(tmClient);
  const rpc = createProtobufRpcClient(queryClient);

  _cachedRpcClient = { queryClient, rpc, tmClient };
  _cachedRpcUrl = url;
  return _cachedRpcClient;
}

/**
 * Try connecting to RPC endpoints in order, return first success.
 * @returns {Promise<{ queryClient: QueryClient, rpc: ReturnType<typeof createProtobufRpcClient>, tmClient: Tendermint37Client, url: string }>}
 */
export async function createRpcQueryClientWithFallback() {
  const errors = [];
  for (const ep of RPC_ENDPOINTS) {
    try {
      const client = await createRpcQueryClient(ep.url);
      return { ...client, url: ep.url };
    } catch (err) {
      errors.push({ url: ep.url, error: err.message });
    }
  }
  throw new Error(`All RPC endpoints failed: ${errors.map(e => `${e.url}: ${e.error}`).join('; ')}`);
}

/**
 * Disconnect and clear cached RPC client.
 */
export function disconnectRpc() {
  if (_cachedRpcClient?.tmClient) {
    _cachedRpcClient.tmClient.disconnect();
  }
  _cachedRpcClient = null;
  _cachedRpcUrl = null;
}

// ─── ABCI Query Helper ─────────────────────────────────────────────────────

/**
 * Raw ABCI query — sends protobuf-encoded request to a gRPC service path.
 * This is the low-level primitive used by all typed query functions below.
 *
 * @param {QueryClient} queryClient - CosmJS QueryClient
 * @param {string} path - gRPC method path (e.g., '/sentinel.node.v3.QueryService/QueryNodes')
 * @param {Uint8Array} requestBytes - Protobuf-encoded request
 * @returns {Promise<Uint8Array>} Protobuf-encoded response
 */
async function abciQuery(queryClient, path, requestBytes) {
  const result = await queryClient.queryAbci(path, requestBytes);
  return result.value;
}

// ─── Protobuf Encoding Helpers (minimal, for query requests) ────────────────

function encodeVarint(value) {
  let n = BigInt(value);
  const bytes = [];
  do {
    let b = Number(n & 0x7fn);
    n >>= 7n;
    if (n > 0n) b |= 0x80;
    bytes.push(b);
  } while (n > 0n);
  return new Uint8Array(bytes);
}

function encodeString(fieldNum, str) {
  if (!str) return new Uint8Array(0);
  const encoder = new TextEncoder();
  const b = encoder.encode(str);
  const tag = encodeVarint((BigInt(fieldNum) << 3n) | 2n);
  const len = encodeVarint(b.length);
  const result = new Uint8Array(tag.length + len.length + b.length);
  result.set(tag, 0);
  result.set(len, tag.length);
  result.set(b, tag.length + len.length);
  return result;
}

function encodeUint64(fieldNum, value) {
  if (!value) return new Uint8Array(0);
  const tag = encodeVarint((BigInt(fieldNum) << 3n) | 0n);
  const val = encodeVarint(value);
  const result = new Uint8Array(tag.length + val.length);
  result.set(tag, 0);
  result.set(val, tag.length);
  return result;
}

function encodeEnum(fieldNum, value) {
  return encodeUint64(fieldNum, value);
}

function encodeEmbedded(fieldNum, bytes) {
  if (!bytes || bytes.length === 0) return new Uint8Array(0);
  const tag = encodeVarint((BigInt(fieldNum) << 3n) | 2n);
  const len = encodeVarint(bytes.length);
  const result = new Uint8Array(tag.length + len.length + bytes.length);
  result.set(tag, 0);
  result.set(len, tag.length);
  result.set(bytes, tag.length + len.length);
  return result;
}

function encodePagination({ limit = 100, key, countTotal = false, reverse = false } = {}) {
  // cosmos.base.query.v1beta1.PageRequest proto fields:
  // 1=key, 2=offset, 3=limit, 4=count_total, 5=reverse
  const parts = [];
  if (key) parts.push(encodeString(1, key));    // field 1: key
  parts.push(encodeUint64(3, limit));            // field 3: limit (NOT field 2 which is offset)
  if (countTotal) parts.push(encodeEnum(4, 1));  // field 4: count_total
  if (reverse) parts.push(encodeEnum(5, 1));     // field 5: reverse
  return concat(parts);
}

function concat(arrays) {
  const totalLen = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

// ─── Protobuf Decoding Helpers (minimal, for query responses) ───────────────

/**
 * Decode a protobuf message into a field map.
 * Returns { fieldNumber: { wireType, value } } for each field.
 * Wire types: 0=varint, 2=length-delimited
 */
function decodeProto(buf) {
  const fields = {};
  let i = 0;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  while (i < buf.length) {
    // Read tag
    let tag = 0n;
    let shift = 0n;
    while (i < buf.length) {
      const b = buf[i++];
      tag |= BigInt(b & 0x7f) << shift;
      shift += 7n;
      if (!(b & 0x80)) break;
    }

    const fieldNum = Number(tag >> 3n);
    const wireType = Number(tag & 0x7n);

    if (wireType === 0) {
      // Varint
      let val = 0n;
      let s = 0n;
      while (i < buf.length) {
        const b = buf[i++];
        val |= BigInt(b & 0x7f) << s;
        s += 7n;
        if (!(b & 0x80)) break;
      }
      if (!fields[fieldNum]) fields[fieldNum] = [];
      fields[fieldNum].push({ wireType, value: val });
    } else if (wireType === 2) {
      // Length-delimited
      let len = 0n;
      let s = 0n;
      while (i < buf.length) {
        const b = buf[i++];
        len |= BigInt(b & 0x7f) << s;
        s += 7n;
        if (!(b & 0x80)) break;
      }
      const numLen = Number(len);
      const data = buf.slice(i, i + numLen);
      i += numLen;
      if (!fields[fieldNum]) fields[fieldNum] = [];
      fields[fieldNum].push({ wireType, value: data });
    } else if (wireType === 5) {
      // 32-bit fixed
      i += 4;
    } else if (wireType === 1) {
      // 64-bit fixed
      i += 8;
    }
  }

  return fields;
}

function decodeString(data) {
  return new TextDecoder().decode(data);
}

function decodeRepeatedMessages(fieldEntries) {
  if (!fieldEntries) return [];
  return fieldEntries.map(entry => decodeProto(entry.value));
}

// ─── Shared Decoders ────────────────────────────────────────────────────────

function decodePrice(fields) {
  return {
    denom: fields[1]?.[0] ? decodeString(fields[1][0].value) : '',
    base_value: fields[2]?.[0] ? decodeString(fields[2][0].value) : '0',
    quote_value: fields[3]?.[0] ? decodeString(fields[3][0].value) : '0',
  };
}

/**
 * Decode a google.protobuf.Timestamp (field 1=seconds, field 2=nanos) → ISO string.
 */
function decodeTimestamp(bytes) {
  if (!bytes || bytes.length === 0) return null;
  const f = decodeProto(bytes);
  const seconds = f[1]?.[0] ? Number(f[1][0].value) : 0;
  const nanos = f[2]?.[0] ? Number(f[2][0].value) : 0;
  return new Date(seconds * 1000 + nanos / 1_000_000).toISOString();
}

/**
 * Decode a google.protobuf.Duration (field 1=seconds, field 2=nanos) → "Xs" string (chain format).
 */
function decodeDuration(bytes) {
  if (!bytes || bytes.length === 0) return '0s';
  const f = decodeProto(bytes);
  const seconds = f[1]?.[0] ? Number(f[1][0].value) : 0;
  const nanos = f[2]?.[0] ? Number(f[2][0].value) : 0;
  return `${seconds + nanos / 1_000_000_000}s`;
}

// ─── Node Decoder ───────────────────────────────────────────────────────────

function decodeNode(fields) {
  return {
    address: fields[1]?.[0] ? decodeString(fields[1][0].value) : '',
    gigabyte_prices: (fields[2] || []).map(f => decodePrice(decodeProto(f.value))),
    hourly_prices: (fields[3] || []).map(f => decodePrice(decodeProto(f.value))),
    remote_addrs: (fields[4] || []).map(f => decodeString(f.value)),
    status: fields[6]?.[0] ? Number(fields[6][0].value) : 0,
  };
}

// ─── Session Decoder ────────────────────────────────────────────────────────

/**
 * Decode BaseSession proto fields (sentinel.session.v3.BaseSession).
 * Proto field numbers: 1=id, 2=acc_address, 3=node_address, 4=download_bytes,
 * 5=upload_bytes, 6=max_bytes, 7=duration, 8=max_duration, 9=status,
 * 10=inactive_at, 11=start_at, 12=status_at
 */
function decodeBaseSession(fields) {
  return {
    id: fields[1]?.[0] ? String(fields[1][0].value) : '0',
    acc_address: fields[2]?.[0] ? decodeString(fields[2][0].value) : '',
    node_address: fields[3]?.[0] ? decodeString(fields[3][0].value) : '',
    download_bytes: fields[4]?.[0] ? decodeString(fields[4][0].value) : '0',
    upload_bytes: fields[5]?.[0] ? decodeString(fields[5][0].value) : '0',
    max_bytes: fields[6]?.[0] ? decodeString(fields[6][0].value) : '0',
    duration: fields[7]?.[0] ? decodeDuration(fields[7][0].value) : '0s',
    max_duration: fields[8]?.[0] ? decodeDuration(fields[8][0].value) : '0s',
    status: fields[9]?.[0] ? Number(fields[9][0].value) : 0,
    inactive_at: fields[10]?.[0] ? decodeTimestamp(fields[10][0].value) : null,
    start_at: fields[11]?.[0] ? decodeTimestamp(fields[11][0].value) : null,
    status_at: fields[12]?.[0] ? decodeTimestamp(fields[12][0].value) : null,
  };
}

/**
 * Decode a google.protobuf.Any-wrapped session.
 * Unwraps the Any (field 1=type_url, field 2=value), then decodes the inner session.
 * Inner session types:
 *   - sentinel.node.v3.Session: field 1=base_session, field 2=price
 *   - sentinel.subscription.v3.Session: field 1=base_session, field 2=subscription_id
 *
 * Returns a flat session object matching flattenSession() output from LCD.
 */
function decodeAnySession(anyBytes) {
  const anyFields = decodeProto(anyBytes);
  const typeUrl = anyFields[1]?.[0] ? decodeString(anyFields[1][0].value) : '';
  const innerBytes = anyFields[2]?.[0]?.value;
  if (!innerBytes) return null;

  const sessionFields = decodeProto(innerBytes);

  // Field 1 = base_session (embedded BaseSession)
  const bs = sessionFields[1]?.[0] ? decodeBaseSession(decodeProto(sessionFields[1][0].value)) : {};

  const result = { ...bs, '@type': typeUrl ? `/${typeUrl}` : undefined };

  if (typeUrl.includes('node')) {
    // sentinel.node.v3.Session: field 2 = price
    if (sessionFields[2]?.[0]) {
      result.price = decodePrice(decodeProto(sessionFields[2][0].value));
    }
  } else if (typeUrl.includes('subscription')) {
    // sentinel.subscription.v3.Session: field 2 = subscription_id
    if (sessionFields[2]?.[0]) {
      result.subscription_id = String(sessionFields[2][0].value);
    }
  }

  return result;
}

// ─── Subscription Decoder ───────────────────────────────────────────────────

/**
 * Decode Subscription proto (sentinel.subscription.v3.Subscription).
 * Proto field numbers: 1=id, 2=acc_address, 3=plan_id, 4=price,
 * 5=renewal_price_policy, 6=status, 7=inactive_at, 8=start_at, 9=status_at
 */
function decodeSubscription(fields) {
  return {
    id: fields[1]?.[0] ? String(fields[1][0].value) : '0',
    acc_address: fields[2]?.[0] ? decodeString(fields[2][0].value) : '',
    address: fields[2]?.[0] ? decodeString(fields[2][0].value) : '', // LCD compat alias
    plan_id: fields[3]?.[0] ? String(fields[3][0].value) : '0',
    price: fields[4]?.[0] ? decodePrice(decodeProto(fields[4][0].value)) : null,
    renewal_price_policy: fields[5]?.[0] ? Number(fields[5][0].value) : 0,
    status: fields[6]?.[0] ? Number(fields[6][0].value) : 0,
    inactive_at: fields[7]?.[0] ? decodeTimestamp(fields[7][0].value) : null,
    start_at: fields[8]?.[0] ? decodeTimestamp(fields[8][0].value) : null,
    status_at: fields[9]?.[0] ? decodeTimestamp(fields[9][0].value) : null,
  };
}

// ─── Plan Decoder ───────────────────────────────────────────────────────────

/**
 * Decode Plan proto (sentinel.plan.v3.Plan).
 * Proto field numbers: 1=id, 2=prov_address, 3=bytes, 4=duration,
 * 5=prices (repeated), 6=private, 7=status, 8=status_at
 */
function decodePlan(fields) {
  return {
    id: fields[1]?.[0] ? String(fields[1][0].value) : '0',
    prov_address: fields[2]?.[0] ? decodeString(fields[2][0].value) : '',
    bytes: fields[3]?.[0] ? decodeString(fields[3][0].value) : '0',
    duration: fields[4]?.[0] ? decodeDuration(fields[4][0].value) : '0s',
    prices: (fields[5] || []).map(f => decodePrice(decodeProto(f.value))),
    private: fields[6]?.[0] ? Number(fields[6][0].value) !== 0 : false,
    status: fields[7]?.[0] ? Number(fields[7][0].value) : 0,
    status_at: fields[8]?.[0] ? decodeTimestamp(fields[8][0].value) : null,
  };
}

// ─── Allocation Decoder ─────────────────────────────────────────────────────

/**
 * Decode Allocation proto (sentinel.subscription.v2.Allocation).
 * Proto field numbers: 1=id, 2=address, 3=granted_bytes, 4=utilised_bytes
 */
function decodeAllocation(fields) {
  return {
    id: fields[1]?.[0] ? String(fields[1][0].value) : '0',
    address: fields[2]?.[0] ? decodeString(fields[2][0].value) : '',
    granted_bytes: fields[3]?.[0] ? decodeString(fields[3][0].value) : '0',
    utilised_bytes: fields[4]?.[0] ? decodeString(fields[4][0].value) : '0',
  };
}

// ─── Typed Query Functions ──────────────────────────────────────────────────

/**
 * Query active nodes via RPC.
 *
 * NOTE ON PAGINATION: Sentinel v3's `QueryNodes` truncates at the requested
 * `limit` and does NOT emit `pagination.next_key`. A standard Cosmos
 * "loop while next_key is non-empty" pattern terminates on the first call
 * and silently loses data. Request above the chain's current hard ceiling
 * (~1048 active nodes as of 2026-04). Default raised to 10000.
 *
 * @param {{ queryClient: QueryClient }} client - From createRpcQueryClient()
 * @param {{ status?: number, limit?: number }} [opts]
 * @returns {Promise<Array<{ address: string, gigabyte_prices: Array, hourly_prices: Array, remote_addrs: string[], status: number }>>}
 */
export async function rpcQueryNodes(client, { status = 1, limit = 10000 } = {}) {
  const path = '/sentinel.node.v3.QueryService/QueryNodes';
  const request = concat([
    encodeEnum(1, status),                                        // status field
    encodeEmbedded(2, encodePagination({ limit })),               // pagination field
  ]);

  const response = await abciQuery(client.queryClient, path, request);
  const fields = decodeProto(new Uint8Array(response));

  // Field 1 = repeated Node
  const nodes = (fields[1] || []).map(entry => decodeNode(decodeProto(entry.value)));
  return nodes;
}

/**
 * Query a single node by address via RPC.
 *
 * @param {{ queryClient: QueryClient }} client
 * @param {string} address - sentnode1... address
 * @returns {Promise<object|null>}
 */
export async function rpcQueryNode(client, address) {
  const path = '/sentinel.node.v3.QueryService/QueryNode';
  const request = encodeString(1, address);

  try {
    const response = await abciQuery(client.queryClient, path, request);
    const fields = decodeProto(new Uint8Array(response));
    // Field 1 = Node
    if (!fields[1]?.[0]) return null;
    return decodeNode(decodeProto(fields[1][0].value));
  } catch {
    return null;
  }
}

/**
 * Query nodes linked to a plan via RPC.
 *
 * NOTE ON PAGINATION: `QueryNodesForPlan` silently truncates at the requested
 * `limit` with no `next_key`. Observed 2026-04: plan 36 has 803 active nodes
 * but `limit=500` returns exactly 500 with no indication more exist. Default
 * raised to 10000. If a plan grows beyond that, raise further — the chain's
 * own ceiling is the effective limit.
 *
 * @param {{ queryClient: QueryClient }} client
 * @param {number|bigint} planId
 * @param {{ status?: number, limit?: number }} [opts]
 * @returns {Promise<Array>}
 */
export async function rpcQueryNodesForPlan(client, planId, { status = 1, limit = 10000 } = {}) {
  const path = '/sentinel.node.v3.QueryService/QueryNodesForPlan';
  const request = concat([
    encodeUint64(1, planId),                                     // id
    encodeEnum(2, status),                                        // status
    encodeEmbedded(3, encodePagination({ limit })),               // pagination
  ]);

  const response = await abciQuery(client.queryClient, path, request);
  const fields = decodeProto(new Uint8Array(response));
  return (fields[1] || []).map(entry => decodeNode(decodeProto(entry.value)));
}

/**
 * Query sessions for an account via RPC.
 * Returns decoded, flattened session objects (matching LCD flattenSession format).
 *
 * @param {{ queryClient: QueryClient }} client
 * @param {string} address - sent1... address
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<Array<object>>} Decoded session objects
 */
export async function rpcQuerySessionsForAccount(client, address, { limit = 100 } = {}) {
  const path = '/sentinel.session.v3.QueryService/QuerySessionsForAccount';
  const request = concat([
    encodeString(1, address),
    encodeEmbedded(2, encodePagination({ limit })),
  ]);

  const response = await abciQuery(client.queryClient, path, request);
  const fields = decodeProto(new Uint8Array(response));
  // Field 1 = repeated google.protobuf.Any (sessions)
  return (fields[1] || []).map(entry => decodeAnySession(entry.value)).filter(Boolean);
}

/**
 * Query a single session by ID via RPC.
 * Returns decoded, flattened session object or null.
 *
 * @param {{ queryClient: QueryClient }} client
 * @param {number|bigint|string} sessionId
 * @returns {Promise<object|null>}
 */
export async function rpcQuerySession(client, sessionId) {
  const path = '/sentinel.session.v3.QueryService/QuerySession';
  const request = encodeUint64(1, sessionId);

  try {
    const response = await abciQuery(client.queryClient, path, request);
    const fields = decodeProto(new Uint8Array(response));
    // Field 1 = google.protobuf.Any (session)
    if (!fields[1]?.[0]) return null;
    return decodeAnySession(fields[1][0].value);
  } catch {
    return null;
  }
}

/**
 * Query subscriptions for an account via RPC.
 * Returns decoded subscription objects matching LCD format.
 *
 * @param {{ queryClient: QueryClient }} client
 * @param {string} address - sent1... address
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<Array<object>>} Decoded subscription objects
 */
export async function rpcQuerySubscriptionsForAccount(client, address, { limit = 100 } = {}) {
  const path = '/sentinel.subscription.v3.QueryService/QuerySubscriptionsForAccount';
  const request = concat([
    encodeString(1, address),
    encodeEmbedded(2, encodePagination({ limit })),
  ]);

  const response = await abciQuery(client.queryClient, path, request);
  const fields = decodeProto(new Uint8Array(response));
  return (fields[1] || []).map(entry => decodeSubscription(decodeProto(entry.value)));
}

/**
 * Query a single subscription by ID via RPC.
 *
 * @param {{ queryClient: QueryClient }} client
 * @param {number|bigint|string} subscriptionId
 * @returns {Promise<object|null>}
 */
export async function rpcQuerySubscription(client, subscriptionId) {
  const path = '/sentinel.subscription.v3.QueryService/QuerySubscription';
  const request = encodeUint64(1, subscriptionId);

  try {
    const response = await abciQuery(client.queryClient, path, request);
    const fields = decodeProto(new Uint8Array(response));
    if (!fields[1]?.[0]) return null;
    return decodeSubscription(decodeProto(fields[1][0].value));
  } catch {
    return null;
  }
}

/**
 * Query subscriptions for a plan via RPC.
 *
 * @param {{ queryClient: QueryClient }} client
 * @param {number|bigint} planId
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<Array<object>>}
 */
export async function rpcQuerySubscriptionsForPlan(client, planId, { limit = 500 } = {}) {
  const path = '/sentinel.subscription.v3.QueryService/QuerySubscriptionsForPlan';
  const request = concat([
    encodeUint64(1, planId),
    encodeEmbedded(2, encodePagination({ limit })),
  ]);

  const response = await abciQuery(client.queryClient, path, request);
  const fields = decodeProto(new Uint8Array(response));
  return (fields[1] || []).map(entry => decodeSubscription(decodeProto(entry.value)));
}

/**
 * Query allocations for a subscription via RPC.
 * Uses v2 allocation path (v3 not implemented on chain).
 *
 * @param {{ queryClient: QueryClient }} client
 * @param {number|bigint|string} subscriptionId
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<Array<{ id: string, address: string, granted_bytes: string, utilised_bytes: string }>>}
 */
export async function rpcQuerySubscriptionAllocations(client, subscriptionId, { limit = 100 } = {}) {
  const path = '/sentinel.subscription.v2.QueryService/QueryAllocations';
  const request = concat([
    encodeUint64(1, subscriptionId),
    encodeEmbedded(2, encodePagination({ limit })),
  ]);

  try {
    const response = await abciQuery(client.queryClient, path, request);
    const fields = decodeProto(new Uint8Array(response));
    return (fields[1] || []).map(entry => decodeAllocation(decodeProto(entry.value)));
  } catch {
    return [];
  }
}

/**
 * Query a single plan by ID via RPC.
 *
 * @param {{ queryClient: QueryClient }} client
 * @param {number|bigint} planId
 * @returns {Promise<object|null>} Decoded plan object
 */
export async function rpcQueryPlan(client, planId) {
  const path = '/sentinel.plan.v3.QueryService/QueryPlan';
  const request = encodeUint64(1, planId);

  try {
    const response = await abciQuery(client.queryClient, path, request);
    const fields = decodeProto(new Uint8Array(response));
    if (!fields[1]?.[0]) return null;
    return decodePlan(decodeProto(fields[1][0].value));
  } catch {
    return null;
  }
}

/**
 * Query wallet balance via RPC (uses cosmos bank module).
 *
 * @param {{ queryClient: QueryClient }} client
 * @param {string} address - sent1... address
 * @param {string} [denom='udvpn']
 * @returns {Promise<{ denom: string, amount: string }>}
 */
/**
 * Query a specific fee grant between granter and grantee via RPC.
 * Returns a structured object matching the LCD JSON format, or null if not found.
 *
 * @param {{ queryClient: QueryClient }} client - From createRpcQueryClient()
 * @param {string} granter - Granter address (sent1...)
 * @param {string} grantee - Grantee address (sent1...)
 * @returns {Promise<{ allowance: object, granter: string, grantee: string } | null>}
 */
export async function rpcQueryFeeGrant(client, granter, grantee) {
  const path = '/cosmos.feegrant.v1beta1.Query/Allowance';
  const request = concat([
    encodeString(1, granter),
    encodeString(2, grantee),
  ]);

  let response;
  try {
    response = await abciQuery(client.queryClient, path, request);
  } catch {
    return null; // Query failed (e.g., 404 = no grant)
  }

  const respFields = decodeProto(new Uint8Array(response));
  // Field 1 = Grant message
  if (!respFields[1]?.[0]) return null;
  const grantFields = decodeProto(respFields[1][0].value);

  const result = {
    granter: grantFields[1]?.[0] ? decodeString(grantFields[1][0].value) : granter,
    grantee: grantFields[2]?.[0] ? decodeString(grantFields[2][0].value) : grantee,
    allowance: null,
  };

  // Field 3 = allowance (google.protobuf.Any)
  if (!grantFields[3]?.[0]) return result;
  const anyFields = decodeProto(grantFields[3][0].value);
  const typeUrl = anyFields[1]?.[0] ? decodeString(anyFields[1][0].value) : '';
  const innerBytes = anyFields[2]?.[0]?.value;

  if (typeUrl.includes('AllowedMsgAllowance') && innerBytes) {
    // AllowedMsgAllowance: field 1 = inner allowance (Any), field 2 = allowed_messages (repeated string)
    const amFields = decodeProto(innerBytes);
    const allowedMessages = (amFields[2] || []).map(f => decodeString(f.value));

    let innerAllowance = null;
    if (amFields[1]?.[0]) {
      const innerAnyFields = decodeProto(amFields[1][0].value);
      const innerTypeUrl = innerAnyFields[1]?.[0] ? decodeString(innerAnyFields[1][0].value) : '';
      const basicBytes = innerAnyFields[2]?.[0]?.value;
      if (basicBytes) {
        innerAllowance = _decodeBasicAllowance(basicBytes);
        innerAllowance['@type'] = innerTypeUrl;
      }
    }

    result.allowance = {
      '@type': typeUrl,
      allowance: innerAllowance,
      allowed_messages: allowedMessages,
    };
  } else if (typeUrl.includes('BasicAllowance') && innerBytes) {
    result.allowance = _decodeBasicAllowance(innerBytes);
    result.allowance['@type'] = typeUrl;
  } else {
    // Unknown allowance type — return type URL for diagnostics
    result.allowance = { '@type': typeUrl };
  }

  return result;
}

/**
 * Decode BasicAllowance protobuf: field 1 = spend_limit (repeated Coin), field 2 = expiration (Timestamp)
 */
function _decodeBasicAllowance(bytes) {
  const fields = decodeProto(bytes);
  const spendLimit = (fields[1] || []).map(f => {
    const coinFields = decodeProto(f.value);
    return {
      denom: coinFields[1]?.[0] ? decodeString(coinFields[1][0].value) : '',
      amount: coinFields[2]?.[0] ? decodeString(coinFields[2][0].value) : '0',
    };
  });

  let expiration = null;
  if (fields[2]?.[0]) {
    // Timestamp: field 1 = seconds (int64), field 2 = nanos (int32)
    const tsFields = decodeProto(fields[2][0].value);
    const seconds = tsFields[1]?.[0] ? Number(tsFields[1][0].value) : 0;
    const nanos = tsFields[2]?.[0] ? Number(tsFields[2][0].value) : 0;
    expiration = new Date(seconds * 1000 + nanos / 1_000_000).toISOString();
  }

  return { spend_limit: spendLimit, expiration };
}

/**
 * Query all fee grants for a grantee via RPC.
 * Returns array of grant objects matching LCD format.
 *
 * @param {{ queryClient: QueryClient }} client - From createRpcQueryClient()
 * @param {string} grantee - Grantee address (sent1...)
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<Array<{ granter: string, grantee: string, allowance: object }>>}
 */
export async function rpcQueryFeeGrants(client, grantee, { limit = 100 } = {}) {
  const path = '/cosmos.feegrant.v1beta1.Query/Allowances';
  const request = concat([
    encodeString(1, grantee),
    encodeEmbedded(2, encodePagination({ limit })),
  ]);

  try {
    const response = await abciQuery(client.queryClient, path, request);
    const fields = decodeProto(new Uint8Array(response));
    // Field 1 = repeated Grant (granter, grantee, allowance)
    return (fields[1] || []).map(entry => _decodeFeeGrant(entry.value, grantee));
  } catch {
    return [];
  }
}

/**
 * Query all fee grants issued BY a granter via RPC.
 *
 * @param {{ queryClient: QueryClient }} client
 * @param {string} granter - Granter address (sent1...)
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<Array<{ granter: string, grantee: string, allowance: object }>>}
 */
export async function rpcQueryFeeGrantsIssued(client, granter, { limit = 100 } = {}) {
  const path = '/cosmos.feegrant.v1beta1.Query/AllowancesByGranter';
  const request = concat([
    encodeString(1, granter),
    encodeEmbedded(2, encodePagination({ limit })),
  ]);

  try {
    const response = await abciQuery(client.queryClient, path, request);
    const fields = decodeProto(new Uint8Array(response));
    // Field 1 = repeated Grant
    return (fields[1] || []).map(entry => _decodeFeeGrant(entry.value, null, granter));
  } catch {
    return [];
  }
}

/**
 * Decode a cosmos.feegrant.v1beta1.Grant proto.
 * Fields: 1=granter, 2=grantee, 3=allowance (Any)
 */
function _decodeFeeGrant(bytes, defaultGrantee, defaultGranter) {
  const grantFields = decodeProto(bytes);
  const result = {
    granter: grantFields[1]?.[0] ? decodeString(grantFields[1][0].value) : (defaultGranter || ''),
    grantee: grantFields[2]?.[0] ? decodeString(grantFields[2][0].value) : (defaultGrantee || ''),
    allowance: null,
  };

  if (!grantFields[3]?.[0]) return result;
  const anyFields = decodeProto(grantFields[3][0].value);
  const typeUrl = anyFields[1]?.[0] ? decodeString(anyFields[1][0].value) : '';
  const innerBytes = anyFields[2]?.[0]?.value;

  if (typeUrl.includes('AllowedMsgAllowance') && innerBytes) {
    const amFields = decodeProto(innerBytes);
    const allowedMessages = (amFields[2] || []).map(f => decodeString(f.value));
    let innerAllowance = null;
    if (amFields[1]?.[0]) {
      const innerAnyFields = decodeProto(amFields[1][0].value);
      const innerTypeUrl = innerAnyFields[1]?.[0] ? decodeString(innerAnyFields[1][0].value) : '';
      const basicBytes = innerAnyFields[2]?.[0]?.value;
      if (basicBytes) {
        innerAllowance = _decodeBasicAllowance(basicBytes);
        innerAllowance['@type'] = innerTypeUrl;
      }
    }
    result.allowance = { '@type': typeUrl, allowance: innerAllowance, allowed_messages: allowedMessages };
  } else if (typeUrl.includes('BasicAllowance') && innerBytes) {
    result.allowance = _decodeBasicAllowance(innerBytes);
    result.allowance['@type'] = typeUrl;
  } else {
    result.allowance = { '@type': typeUrl };
  }

  return result;
}

/**
 * Query authz grants between granter and grantee via RPC.
 *
 * @param {{ queryClient: QueryClient }} client
 * @param {string} granter - Granter address (sent1...)
 * @param {string} grantee - Grantee address (sent1...)
 * @param {{ msgTypeUrl?: string, limit?: number }} [opts]
 * @returns {Promise<Array<{ granter: string, grantee: string, authorization: object, expiration: string|null }>>}
 */
export async function rpcQueryAuthzGrants(client, granter, grantee, { msgTypeUrl, limit = 100 } = {}) {
  const path = '/cosmos.authz.v1beta1.Query/Grants';
  const parts = [
    encodeString(1, granter),
    encodeString(2, grantee),
  ];
  if (msgTypeUrl) parts.push(encodeString(3, msgTypeUrl));
  parts.push(encodeEmbedded(4, encodePagination({ limit })));
  const request = concat(parts);

  try {
    const response = await abciQuery(client.queryClient, path, request);
    const fields = decodeProto(new Uint8Array(response));
    // Field 1 = repeated GrantAuthorization
    return (fields[1] || []).map(entry => {
      const gf = decodeProto(entry.value);
      const result = {
        granter: gf[1]?.[0] ? decodeString(gf[1][0].value) : granter,
        grantee: gf[2]?.[0] ? decodeString(gf[2][0].value) : grantee,
        authorization: null,
        expiration: gf[4]?.[0] ? decodeTimestamp(gf[4][0].value) : null,
      };
      // Field 3 = authorization (Any)
      if (gf[3]?.[0]) {
        const anyF = decodeProto(gf[3][0].value);
        result.authorization = {
          '@type': anyF[1]?.[0] ? decodeString(anyF[1][0].value) : '',
        };
      }
      return result;
    });
  } catch {
    return [];
  }
}

/**
 * Query a provider by address via RPC.
 * Provider is still v2 on chain (NOT v3).
 *
 * @param {{ queryClient: QueryClient }} client
 * @param {string} provAddress - sentprov1... address
 * @returns {Promise<object|null>} Provider object or null
 */
export async function rpcQueryProvider(client, provAddress) {
  const path = '/sentinel.provider.v2.QueryService/QueryProvider';
  const request = encodeString(1, provAddress);

  try {
    const response = await abciQuery(client.queryClient, path, request);
    const fields = decodeProto(new Uint8Array(response));
    // Field 1 = Provider
    if (!fields[1]?.[0]) return null;
    const pf = decodeProto(fields[1][0].value);
    return {
      address: pf[1]?.[0] ? decodeString(pf[1][0].value) : provAddress,
      name: pf[2]?.[0] ? decodeString(pf[2][0].value) : '',
      identity: pf[3]?.[0] ? decodeString(pf[3][0].value) : '',
      website: pf[4]?.[0] ? decodeString(pf[4][0].value) : '',
      description: pf[5]?.[0] ? decodeString(pf[5][0].value) : '',
      status: pf[6]?.[0] ? Number(pf[6][0].value) : 0,
      status_at: pf[7]?.[0] ? decodeTimestamp(pf[7][0].value) : null,
    };
  } catch {
    return null;
  }
}

// ─── TX Hash Lookup ─────────────────────────────────────────────────────────

/**
 * Fetch a transaction by hash via Tendermint RPC.
 * Accepts bare hex (64 chars) or 0x-prefixed hex. Returns a normalized shape
 * matching the LCD cosmos/tx/v1beta1/txs/{hash} response so callers don't
 * need to handle both formats.
 *
 * @param {import('@cosmjs/tendermint-rpc').Tendermint37Client} tmClient - From createRpcQueryClient().tmClient
 * @param {string} txHash - TX hash as hex string (bare or 0x-prefixed)
 * @returns {Promise<{ hash: string, height: number, code: number, rawLog: string, events: Array<{ type: string, attributes: Array<{ key: string, value: string }> }>, gasUsed: string, gasWanted: string }>}
 * @throws {Error} If the transaction is not found or RPC call fails
 */
export async function rpcGetTxByHash(tmClient, txHash) {
  // Strip optional 0x prefix and normalise to upper-case for consistency
  const hex = txHash.replace(/^0x/i, '').toUpperCase();
  // Decode hex string → Uint8Array
  const hashBytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    hashBytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }

  const response = await tmClient.tx({ hash: hashBytes });

  // Normalise events: TxData.events is already decoded by CosmJS
  const events = (response.result.events || []).map(ev => ({
    type: ev.type,
    attributes: (ev.attributes || []).map(attr => ({
      key: attr.key,
      value: attr.value,
    })),
  }));

  return {
    hash: hex,
    height: response.height,
    code: response.result.code,
    rawLog: response.result.log || '',
    events,
    gasUsed: String(response.result.gasUsed),
    gasWanted: String(response.result.gasWanted),
  };
}

export async function rpcQueryBalance(client, address, denom = 'udvpn') {
  const path = '/cosmos.bank.v1beta1.Query/Balance';
  const request = concat([
    encodeString(1, address),
    encodeString(2, denom),
  ]);

  const response = await abciQuery(client.queryClient, path, request);
  const fields = decodeProto(new Uint8Array(response));

  // Field 1 = Coin (embedded)
  if (!fields[1]?.[0]) return { denom, amount: '0' };
  const coinFields = decodeProto(fields[1][0].value);
  return {
    denom: coinFields[1]?.[0] ? decodeString(coinFields[1][0].value) : denom,
    amount: coinFields[2]?.[0] ? decodeString(coinFields[2][0].value) : '0',
  };
}
