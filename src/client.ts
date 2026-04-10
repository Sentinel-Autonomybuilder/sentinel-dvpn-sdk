/**
 * BlueSentinelClient — Extends CosmJS SigningStargateClient with Sentinel query extensions.
 *
 * Follows the TKD Alex pattern: extend the ecosystem standard, don't replace it.
 * Every CosmJS method works. Sentinel-specific additions are additive.
 *
 * Usage:
 *   const client = await BlueSentinelClient.connectWithSigner(rpcUrl, signer);
 *   const nodes = await client.sentinelQuery.nodes({ status: 1, limit: 100 });
 *   const balance = await client.getBalance(address, 'udvpn');
 *   const result = await client.signAndBroadcast(address, [msg], fee);
 */

import {
  SigningStargateClient,
  StargateClient,
  QueryClient,
  type StargateClientOptions,
  type SigningStargateClientOptions,
  GasPrice,
} from '@cosmjs/stargate';
import { Tendermint37Client, type CometClient } from '@cosmjs/tendermint-rpc';
import type { OfflineSigner } from '@cosmjs/proto-signing';
import type { Coin } from '@cosmjs/amino';

// ─── Sentinel Types ─────────────────────────────────────────────────────────

export interface SentinelNode {
  address: string;
  gigabyte_prices: SentinelPrice[];
  hourly_prices: SentinelPrice[];
  remote_addrs: string[];
  status: number;
}

export interface SentinelPrice {
  denom: string;
  base_value: string;
  quote_value: string;
}

export interface SentinelSession {
  id: bigint;
  acc_address: string;
  node_address: string;
  download_bytes: string;
  upload_bytes: string;
  max_bytes: string;
  status: number;
}

export interface PaginationOptions {
  limit?: number;
  key?: Uint8Array;
}

export interface NodeQueryOptions extends PaginationOptions {
  status?: number;
}

// ─── Sentinel Query Extension ───────────────────────────────────────────────

export interface SentinelQueryExtension {
  nodes(opts?: NodeQueryOptions): Promise<SentinelNode[]>;
  node(address: string): Promise<SentinelNode | null>;
  nodesForPlan(planId: number | bigint, opts?: NodeQueryOptions): Promise<SentinelNode[]>;
  balance(address: string, denom?: string): Promise<Coin>;
  sessionsForAccount(address: string, opts?: PaginationOptions): Promise<Uint8Array[]>;
  subscriptionsForAccount(address: string, opts?: PaginationOptions): Promise<Uint8Array[]>;
  plan(planId: number | bigint): Promise<Uint8Array | null>;
}

// ─── Protobuf Encoding Helpers ──────────────────────────────────────────────

function encodeVarint(value: number | bigint): Uint8Array {
  let n = BigInt(value);
  const bytes: number[] = [];
  do {
    let b = Number(n & 0x7fn);
    n >>= 7n;
    if (n > 0n) b |= 0x80;
    bytes.push(b);
  } while (n > 0n);
  return new Uint8Array(bytes);
}

function concat(arrays: Uint8Array[]): Uint8Array {
  const totalLen = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

function encodeString(fieldNum: number, str: string): Uint8Array {
  if (!str) return new Uint8Array(0);
  const encoder = new TextEncoder();
  const b = encoder.encode(str);
  const tag = encodeVarint((BigInt(fieldNum) << 3n) | 2n);
  const len = encodeVarint(b.length);
  return concat([tag, len, b]);
}

function encodeUint64(fieldNum: number, value: number | bigint): Uint8Array {
  if (!value && value !== 0) return new Uint8Array(0);
  const tag = encodeVarint((BigInt(fieldNum) << 3n) | 0n);
  const val = encodeVarint(value);
  return concat([tag, val]);
}

function encodeEmbedded(fieldNum: number, bytes: Uint8Array): Uint8Array {
  if (!bytes || bytes.length === 0) return new Uint8Array(0);
  const tag = encodeVarint((BigInt(fieldNum) << 3n) | 2n);
  const len = encodeVarint(bytes.length);
  return concat([tag, len, bytes]);
}

function encodePagination(opts: PaginationOptions = {}): Uint8Array {
  const parts: Uint8Array[] = [];
  if (opts.key) parts.push(encodeEmbedded(1, opts.key));
  parts.push(encodeUint64(2, opts.limit ?? 100));
  return concat(parts);
}

// ─── Protobuf Decoding ─────────────────────────────────────────────────────

interface ProtoField {
  wireType: number;
  value: bigint | Uint8Array;
}

function decodeProto(buf: Uint8Array): Record<number, ProtoField[]> {
  const fields: Record<number, ProtoField[]> = {};
  let i = 0;

  while (i < buf.length) {
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
      i += 4;
    } else if (wireType === 1) {
      i += 8;
    }
  }

  return fields;
}

function decodeStr(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

function decodePrice(fields: Record<number, ProtoField[]>): SentinelPrice {
  return {
    denom: fields[1]?.[0] ? decodeStr(fields[1][0].value as Uint8Array) : '',
    base_value: fields[2]?.[0] ? decodeStr(fields[2][0].value as Uint8Array) : '0',
    quote_value: fields[3]?.[0] ? decodeStr(fields[3][0].value as Uint8Array) : '0',
  };
}

function decodeNode(fields: Record<number, ProtoField[]>): SentinelNode {
  return {
    address: fields[1]?.[0] ? decodeStr(fields[1][0].value as Uint8Array) : '',
    gigabyte_prices: (fields[2] || []).map(f => decodePrice(decodeProto(f.value as Uint8Array))),
    hourly_prices: (fields[3] || []).map(f => decodePrice(decodeProto(f.value as Uint8Array))),
    remote_addrs: (fields[4] || []).map(f => decodeStr(f.value as Uint8Array)),
    status: fields[6]?.[0] ? Number(fields[6][0].value) : 0,
  };
}

// ─── Query-Only Client ──────────────────────────────────────────────────────

export class SentinelQueryClient extends StargateClient {
  public readonly sentinelQuery: SentinelQueryExtension;
  private readonly qc: QueryClient;

  protected constructor(tmClient: CometClient) {
    super(tmClient, {});
    this.qc = QueryClient.withExtensions(tmClient as Tendermint37Client);
    this.sentinelQuery = this.buildQueryExtension();
  }

  static override async connect(endpoint: string): Promise<SentinelQueryClient> {
    const tmClient = await Tendermint37Client.connect(endpoint);
    return new SentinelQueryClient(tmClient);
  }

  private buildQueryExtension(): SentinelQueryExtension {
    const qc = this.qc;

    return {
      async nodes(opts: NodeQueryOptions = {}): Promise<SentinelNode[]> {
        const request = concat([
          encodeUint64(1, opts.status ?? 1),
          encodeEmbedded(2, encodePagination({ limit: opts.limit ?? 500 })),
        ]);
        const response = await qc.queryAbci('/sentinel.node.v3.QueryService/QueryNodes', request);
        const fields = decodeProto(new Uint8Array(response.value));
        return (fields[1] || []).map(entry => decodeNode(decodeProto(entry.value as Uint8Array)));
      },

      async node(address: string): Promise<SentinelNode | null> {
        try {
          const response = await qc.queryAbci('/sentinel.node.v3.QueryService/QueryNode', encodeString(1, address));
          const fields = decodeProto(new Uint8Array(response.value));
          if (!fields[1]?.[0]) return null;
          return decodeNode(decodeProto(fields[1][0].value as Uint8Array));
        } catch {
          return null;
        }
      },

      async nodesForPlan(planId: number | bigint, opts: NodeQueryOptions = {}): Promise<SentinelNode[]> {
        const request = concat([
          encodeUint64(1, planId),
          encodeUint64(2, opts.status ?? 1),
          encodeEmbedded(3, encodePagination({ limit: opts.limit ?? 500 })),
        ]);
        const response = await qc.queryAbci('/sentinel.node.v3.QueryService/QueryNodesForPlan', request);
        const fields = decodeProto(new Uint8Array(response.value));
        return (fields[1] || []).map(entry => decodeNode(decodeProto(entry.value as Uint8Array)));
      },

      async balance(address: string, denom: string = 'udvpn'): Promise<Coin> {
        const request = concat([encodeString(1, address), encodeString(2, denom)]);
        const response = await qc.queryAbci('/cosmos.bank.v1beta1.Query/Balance', request);
        const fields = decodeProto(new Uint8Array(response.value));
        if (!fields[1]?.[0]) return { denom, amount: '0' };
        const coinFields = decodeProto(fields[1][0].value as Uint8Array);
        return {
          denom: coinFields[1]?.[0] ? decodeStr(coinFields[1][0].value as Uint8Array) : denom,
          amount: coinFields[2]?.[0] ? decodeStr(coinFields[2][0].value as Uint8Array) : '0',
        };
      },

      async sessionsForAccount(address: string, opts: PaginationOptions = {}): Promise<Uint8Array[]> {
        const request = concat([encodeString(1, address), encodeEmbedded(2, encodePagination(opts))]);
        const response = await qc.queryAbci('/sentinel.session.v3.QueryService/QuerySessionsForAccount', request);
        const fields = decodeProto(new Uint8Array(response.value));
        return (fields[1] || []).map(entry => entry.value as Uint8Array);
      },

      async subscriptionsForAccount(address: string, opts: PaginationOptions = {}): Promise<Uint8Array[]> {
        const request = concat([encodeString(1, address), encodeEmbedded(2, encodePagination(opts))]);
        const response = await qc.queryAbci('/sentinel.subscription.v3.QueryService/QuerySubscriptionsForAccount', request);
        const fields = decodeProto(new Uint8Array(response.value));
        return (fields[1] || []).map(entry => entry.value as Uint8Array);
      },

      async plan(planId: number | bigint): Promise<Uint8Array | null> {
        try {
          const response = await qc.queryAbci('/sentinel.plan.v3.QueryService/QueryPlan', encodeUint64(1, planId));
          const fields = decodeProto(new Uint8Array(response.value));
          return (fields[1]?.[0]?.value as Uint8Array) || null;
        } catch {
          return null;
        }
      },
    };
  }
}

// ─── Signing Client (Full) ──────────────────────────────────────────────────

export class BlueSentinelClient extends SigningStargateClient {
  public readonly sentinelQuery: SentinelQueryExtension;
  private readonly qc: QueryClient;

  protected constructor(
    tmClient: CometClient,
    signer: OfflineSigner,
    options: SigningStargateClientOptions,
  ) {
    super(tmClient, signer, options);
    this.qc = QueryClient.withExtensions(tmClient as Tendermint37Client);
    this.sentinelQuery = this.buildQueryExtension();
  }

  /**
   * Connect with a signer for full TX + query capabilities.
   * This is the primary entry point — matches TKD Alex's pattern exactly.
   */
  static async connectWithSigner(
    endpoint: string,
    signer: OfflineSigner,
    options?: SigningStargateClientOptions,
  ): Promise<BlueSentinelClient> {
    const tmClient = await Tendermint37Client.connect(endpoint);
    return new BlueSentinelClient(tmClient, signer, {
      gasPrice: GasPrice.fromString('0.1udvpn'),
      ...options,
    });
  }

  private buildQueryExtension(): SentinelQueryExtension {
    const qc = this.qc;

    return {
      async nodes(opts: NodeQueryOptions = {}): Promise<SentinelNode[]> {
        const request = concat([
          encodeUint64(1, opts.status ?? 1),
          encodeEmbedded(2, encodePagination({ limit: opts.limit ?? 500 })),
        ]);
        const response = await qc.queryAbci('/sentinel.node.v3.QueryService/QueryNodes', request);
        const fields = decodeProto(new Uint8Array(response.value));
        return (fields[1] || []).map(entry => decodeNode(decodeProto(entry.value as Uint8Array)));
      },

      async node(address: string): Promise<SentinelNode | null> {
        try {
          const response = await qc.queryAbci('/sentinel.node.v3.QueryService/QueryNode', encodeString(1, address));
          const fields = decodeProto(new Uint8Array(response.value));
          if (!fields[1]?.[0]) return null;
          return decodeNode(decodeProto(fields[1][0].value as Uint8Array));
        } catch {
          return null;
        }
      },

      async nodesForPlan(planId: number | bigint, opts: NodeQueryOptions = {}): Promise<SentinelNode[]> {
        const request = concat([
          encodeUint64(1, planId),
          encodeUint64(2, opts.status ?? 1),
          encodeEmbedded(3, encodePagination({ limit: opts.limit ?? 500 })),
        ]);
        const response = await qc.queryAbci('/sentinel.node.v3.QueryService/QueryNodesForPlan', request);
        const fields = decodeProto(new Uint8Array(response.value));
        return (fields[1] || []).map(entry => decodeNode(decodeProto(entry.value as Uint8Array)));
      },

      async balance(address: string, denom: string = 'udvpn'): Promise<Coin> {
        const request = concat([encodeString(1, address), encodeString(2, denom)]);
        const response = await qc.queryAbci('/cosmos.bank.v1beta1.Query/Balance', request);
        const fields = decodeProto(new Uint8Array(response.value));
        if (!fields[1]?.[0]) return { denom, amount: '0' };
        const coinFields = decodeProto(fields[1][0].value as Uint8Array);
        return {
          denom: coinFields[1]?.[0] ? decodeStr(coinFields[1][0].value as Uint8Array) : denom,
          amount: coinFields[2]?.[0] ? decodeStr(coinFields[2][0].value as Uint8Array) : '0',
        };
      },

      async sessionsForAccount(address: string, opts: PaginationOptions = {}): Promise<Uint8Array[]> {
        const request = concat([encodeString(1, address), encodeEmbedded(2, encodePagination(opts))]);
        const response = await qc.queryAbci('/sentinel.session.v3.QueryService/QuerySessionsForAccount', request);
        const fields = decodeProto(new Uint8Array(response.value));
        return (fields[1] || []).map(entry => entry.value as Uint8Array);
      },

      async subscriptionsForAccount(address: string, opts: PaginationOptions = {}): Promise<Uint8Array[]> {
        const request = concat([encodeString(1, address), encodeEmbedded(2, encodePagination(opts))]);
        const response = await qc.queryAbci('/sentinel.subscription.v3.QueryService/QuerySubscriptionsForAccount', request);
        const fields = decodeProto(new Uint8Array(response.value));
        return (fields[1] || []).map(entry => entry.value as Uint8Array);
      },

      async plan(planId: number | bigint): Promise<Uint8Array | null> {
        try {
          const response = await qc.queryAbci('/sentinel.plan.v3.QueryService/QueryPlan', encodeUint64(1, planId));
          const fields = decodeProto(new Uint8Array(response.value));
          return (fields[1]?.[0]?.value as Uint8Array) || null;
        } catch {
          return null;
        }
      },
    };
  }
}

// ─── WebSocket Client ───────────────────────────────────────────────────────

export interface SentinelEvent {
  type: string;
  attributes: Array<{ key: string; value: string }>;
}

export type EventCallback = (event: SentinelEvent) => void;

/**
 * Real-time event subscription via Tendermint WebSocket.
 *
 * Usage:
 *   const ws = await SentinelWsClient.connect('wss://rpc.sentinel.co/websocket');
 *   ws.subscribe("tm.event='Tx'", (event) => console.log(event));
 *   ws.disconnect();
 */
export class SentinelWsClient {
  private ws: any = null;
  private listeners: Map<string, EventCallback[]> = new Map();
  private nextId = 1;

  private constructor(private readonly endpoint: string) {}

  static async connect(endpoint: string): Promise<SentinelWsClient> {
    const client = new SentinelWsClient(endpoint);
    await client.open();
    return client;
  }

  private open(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Use globalThis.WebSocket (browser) or dynamic import of 'ws' (Node.js)
      const WS = typeof globalThis !== 'undefined' && (globalThis as any).WebSocket
        ? (globalThis as any).WebSocket
        : null;
      if (!WS) {
        reject(new Error('WebSocket not available. In Node.js, install the "ws" package.'));
        return;
      }
      this.ws = new WS(this.endpoint);
      (this.ws as any).onopen = () => resolve();
      (this.ws as any).onerror = (err: any) => reject(new Error(`WebSocket error: ${err}`));
      (this.ws as any).onmessage = (msg: any) => this.handleMessage(msg.data as string);
    });
  }

  /**
   * Subscribe to chain events matching a Tendermint query.
   *
   * Common queries:
   * - "tm.event='Tx'" — all transactions
   * - "tm.event='Tx' AND sentinel.node.v3.EventCreateSession.session_id EXISTS" — session starts
   * - "tm.event='Tx' AND sentinel.session.v3.EventEnd.session_id EXISTS" — session ends
   */
  subscribe(query: string, callback: EventCallback): void {
    const id = this.nextId++;
    if (!this.listeners.has(query)) {
      this.listeners.set(query, []);
    }
    this.listeners.get(query)!.push(callback);

    (this.ws as any)?.send(JSON.stringify({
      jsonrpc: '2.0',
      method: 'subscribe',
      id,
      params: { query },
    }));
  }

  private handleMessage(data: string): void {
    try {
      const msg = JSON.parse(data);
      if (msg.result?.events) {
        // Broadcast to all listeners
        for (const [, callbacks] of this.listeners) {
          for (const cb of callbacks) {
            const events = msg.result.events;
            for (const [type, values] of Object.entries(events)) {
              cb({ type, attributes: Array.isArray(values) ? values.map((v: string) => ({ key: type, value: v })) : [] });
            }
          }
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
    this.listeners.clear();
  }
}
