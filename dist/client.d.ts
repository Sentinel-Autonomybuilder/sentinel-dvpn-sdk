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
import { SigningStargateClient, StargateClient, type SigningStargateClientOptions } from '@cosmjs/stargate';
import { type CometClient } from '@cosmjs/tendermint-rpc';
import type { OfflineSigner } from '@cosmjs/proto-signing';
import type { Coin } from '@cosmjs/amino';
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
export interface SentinelQueryExtension {
    nodes(opts?: NodeQueryOptions): Promise<SentinelNode[]>;
    node(address: string): Promise<SentinelNode | null>;
    nodesForPlan(planId: number | bigint, opts?: NodeQueryOptions): Promise<SentinelNode[]>;
    balance(address: string, denom?: string): Promise<Coin>;
    sessionsForAccount(address: string, opts?: PaginationOptions): Promise<Uint8Array[]>;
    subscriptionsForAccount(address: string, opts?: PaginationOptions): Promise<Uint8Array[]>;
    plan(planId: number | bigint): Promise<Uint8Array | null>;
}
export declare class SentinelQueryClient extends StargateClient {
    readonly sentinelQuery: SentinelQueryExtension;
    private readonly qc;
    protected constructor(tmClient: CometClient);
    static connect(endpoint: string): Promise<SentinelQueryClient>;
    private buildQueryExtension;
}
export declare class BlueSentinelClient extends SigningStargateClient {
    readonly sentinelQuery: SentinelQueryExtension;
    private readonly qc;
    protected constructor(tmClient: CometClient, signer: OfflineSigner, options: SigningStargateClientOptions);
    /**
     * Connect with a signer for full TX + query capabilities.
     * This is the primary entry point — matches TKD Alex's pattern exactly.
     */
    static connectWithSigner(endpoint: string, signer: OfflineSigner, options?: SigningStargateClientOptions): Promise<BlueSentinelClient>;
    private buildQueryExtension;
}
export interface SentinelEvent {
    type: string;
    attributes: Array<{
        key: string;
        value: string;
    }>;
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
export declare class SentinelWsClient {
    private readonly endpoint;
    private ws;
    private listeners;
    private nextId;
    private constructor();
    static connect(endpoint: string): Promise<SentinelWsClient>;
    private open;
    /**
     * Subscribe to chain events matching a Tendermint query.
     *
     * Common queries:
     * - "tm.event='Tx'" — all transactions
     * - "tm.event='Tx' AND sentinel.node.v3.EventCreateSession.session_id EXISTS" — session starts
     * - "tm.event='Tx' AND sentinel.session.v3.EventEnd.session_id EXISTS" — session ends
     */
    subscribe(query: string, callback: EventCallback): void;
    private handleMessage;
    disconnect(): void;
}
//# sourceMappingURL=client.d.ts.map