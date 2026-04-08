/**
 * Sentinel dVPN SDK — Comprehensive Type Definitions
 *
 * 200+ exports across 14 modules. Every function parameter, return type,
 * and option object is explicitly typed with named interfaces.
 *
 * Import types from the main package:
 *   import type { ConnectOptions, ConnectResult, ScoredNode } from 'sentinel-dvpn-sdk';
 *
 * Or from specific type modules:
 *   import type { ConnectOptions } from 'sentinel-dvpn-sdk/types/connection';
 */

// ─── Re-export all types ───────────────────────────────────────────────────

export type {
  ErrorCode,
  ErrorSeverity,
} from './errors.js';

export {
  SentinelError,
  ValidationError,
  NodeError,
  ChainError,
  TunnelError,
  SecurityError,
  ErrorCodes,
  ERROR_SEVERITY,
  isRetryable,
  userMessage,
} from './errors.js';

export type {
  ConnectOptions,
  ConnectionTimeouts,
  ConnectViaPlanOptions,
  ConnectAutoOptions,
  ConnectResult,
  DisconnectResult,
  ConnectionStatus,
  VerifyResult,
  AutoReconnectOptions,
  AutoReconnectHandle,
  CircuitBreakerConfig,
  CircuitBreakerStatus,
  ConnectionMetric,
  ConnectionState,
  ProgressEntry,
  SDKEvents,
  DependencyCheck,
  PreflightIssue,
  PreflightReport,
  ConnectConfig,
} from './connection.js';

export type {
  WalletResult,
  GenerateWalletResult,
  WalletBalance,
  SafeBroadcaster,
  TxResponseSummary,
  EncodedMsg,
  LcdQueryOptions,
  LcdQueryAllOptions,
  PaginatedResult,
  LcdPaginatedSafeOptions,
  PriceEntry,
  ChainNode,
  Subscription,
  ChainSession,
  FlatSession,
  Provider,
  FeeGrantAllowance,
  DiscoveredPlan,
  FeeGrantOptions,
  ExpiringGrant,
  PlanSubscriber,
  PlanStats,
  MsgStartSessionParams,
  MsgEndSessionParams,
  MsgStartSubscriptionParams,
  MsgSubStartSessionParams,
  MsgCancelSubscriptionParams,
  MsgRenewSubscriptionParams,
  MsgShareSubscriptionParams,
  MsgUpdateSubscriptionParams,
  MsgUpdateSessionParams,
  MsgRegisterNodeParams,
  MsgUpdateNodeDetailsParams,
  MsgUpdateNodeStatusParams,
  MsgUpdatePlanDetailsParams,
  MsgRegisterProviderParams,
  MsgUpdateProviderDetailsParams,
  MsgUpdateProviderStatusParams,
  MsgCreatePlanParams,
  MsgUpdatePlanStatusParams,
  MsgLinkNodeParams,
  MsgUnlinkNodeParams,
  MsgPlanStartSessionParams,
  MsgStartLeaseParams,
  MsgEndLeaseParams,
  BatchStartSessionNode,
  BatchSendRecipient,
  BatchFeeEstimate,
  SubscribeToPlanResult,
  ParsedDuration,
  SessionCostEstimate,
  Endpoint,
  FallbackResult,
  EndpointHealth,
} from './chain.js';

export { MSG_TYPES } from './chain.js';

export type {
  NodeStatus,
  WgKeyPair,
  WgConfigOptions,
  HandshakeResult,
  V2RayHandshakeResult,
  V2RayConfigOptions,
  V2RayConfig,
  TransportSuccessRate,
  DynamicTransportRate,
  SpeedResult,
  SpeedComparison,
  SpeedtestDefaults,
  WatchdogResult,
  OrphanedTunnelCheck,
  CleanOrphanedResult,
  OrphanedV2RayCheck,
  VpnConflictCheck,
  PortConflictCheck,
} from './protocol.js';

export type {
  ListNodesOptions,
  NodeProbeProgress,
  EnrichNodesOptions,
  ScoredNode,
  NodeFilter,
  NodePrices,
  NodeIndex,
  NetworkOverview,
  BrokenNode,
} from './nodes.js';

export type {
  SDKState,
  RecoverResult,
  PidCheck,
  SavedCredentials,
  SessionManagerOptions,
  SessionMapEntry,
  SessionAllocation,
  QuerySessionAllocationResult,
  SessionPaymentMode,
  SessionHistoryEntry,
  BatchStartSessionsOptions,
  BatchStartResult,
  BatchSessionStatus,
  WaitForBatchOptions,
  WaitForSessionActiveOptions,
} from './session.js';

export type {
  AppSettings,
  DnsPreset,
  DnsPresetName,
  DnsPresets,
  AppType,
  AppTypeConstants,
  AppTypeScreens,
  AppTypeConfig,
  AppConfigValidation,
  VpnSettings,
  CacheInfo,
  DiskCacheEntry,
} from './settings.js';

export type {
  NodePricingDisplay,
  SessionPriceEstimate,
  CountryMap,
  NodeDisplay,
  CountryGroup,
  PricingReference,
  HourOptions,
  GbOptions,
} from './pricing.js';

// ─── Re-export CosmJS types for convenience ────────────────────────────────

import type { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import type { SigningStargateClient, DeliverTxResponse } from '@cosmjs/stargate';
import type { StdFee } from '@cosmjs/amino';
import type { EventEmitter } from 'events';

// ─── High-level Connection API ─────────────────────────────────────────────

import type {
  ConnectOptions,
  ConnectViaPlanOptions,
  ConnectAutoOptions,
  ConnectResult,
  ConnectionStatus,
  VerifyResult,
  AutoReconnectHandle,
  CircuitBreakerConfig,
  CircuitBreakerStatus,
  ConnectionMetric,
  DependencyCheck,
  PreflightReport,
  ConnectConfig,
  SDKEvents,
  ConnectionState,
} from './connection.js';

/** Connect to a Sentinel dVPN node (alias for connectDirect) */
export function connect(opts: ConnectOptions): Promise<ConnectResult>;

/** Connect directly to a Sentinel dVPN node — pay per GB or per hour */
export function connectDirect(opts: ConnectOptions): Promise<ConnectResult>;

/** Connect via a subscription plan — plan operator pays gas via fee grant */
export function connectViaPlan(opts: ConnectViaPlanOptions): Promise<ConnectResult>;

/** Connect via an existing subscription — reuse a subscription you already have */
export function connectViaSubscription(opts: ConnectOptions & { subscriptionId: number | string | bigint }): Promise<ConnectResult>;

/** Connect with auto-fallback: tries multiple nodes on failure */
export function connectAuto(opts: ConnectAutoOptions): Promise<ConnectResult>;

/** Disconnect current VPN tunnel and clean up all resources */
export function disconnect(): Promise<void>;

/** Check if a VPN tunnel is currently active */
export function isConnected(): boolean;

/** Check if a connection attempt is currently in progress (mutex held) */
export function isConnecting(): boolean;

/** Get current connection status (null if not connected) */
export function getStatus(): ConnectionStatus | null;

/** Register process exit handlers for clean tunnel shutdown. Call once at app startup. */
export function registerCleanupHandlers(): void;

/**
 * One-call VPN connection. Handles deps check, cleanup registration,
 * node selection, connection, and IP verification.
 */
export function quickConnect(opts: ConnectOptions & {
  countries?: string[];
  serviceType?: 'wireguard' | 'v2ray';
  maxAttempts?: number;
}): Promise<ConnectResult & { vpnIp?: string }>;

/** Auto-reconnect on connection loss. Returns handle with stop(). */
export function autoReconnect(opts: ConnectOptions & {
  pollIntervalMs?: number;
  maxRetries?: number;
  backoffMs?: number[];
  onReconnecting?: (attempt: number) => void;
  onReconnected?: (result: ConnectResult) => void;
  onGaveUp?: (errors: Error[]) => void;
}): AutoReconnectHandle;

/** Verify VPN is working by checking public IP through the tunnel */
export function verifyConnection(opts?: { timeoutMs?: number }): Promise<VerifyResult>;

/**
 * Retry handshake on an already-paid session. Use when connect fails AFTER payment.
 * Pass sessionId + nodeAddress from the error.details of the failed connect.
 */
export function recoverSession(opts: ConnectOptions & { sessionId: string | bigint }): Promise<ConnectResult>;

/** Attempt fast reconnect using saved credentials. Returns null if unavailable. */
export function tryFastReconnect(opts: ConnectOptions): Promise<ConnectResult | null>;

/**
 * Create a reusable base config. Override per-call with .with().
 * @example
 * const cfg = createConnectConfig({ mnemonic, rpcUrl });
 * await connectDirect(cfg.with({ nodeAddress: 'sentnode1...' }));
 */
export function createConnectConfig(baseOpts: Partial<ConnectOptions>): ConnectConfig;

/** Pre-flight dependency check: verify V2Ray and WireGuard availability */
export function verifyDependencies(opts?: { v2rayExePath?: string }): DependencyCheck;

/**
 * Complete pre-flight system check. Run at app startup.
 * Detects: missing binaries, admin permissions, orphaned tunnels,
 * conflicting VPNs, port conflicts.
 */
export function preflight(opts?: { autoClean?: boolean; v2rayExePath?: string }): PreflightReport;

/** SDK lifecycle event emitter */
export const events: SDKEvents & EventEmitter;

/** Disconnect a specific connection state (used by SentinelClient internally) */
export function disconnectState(state: ConnectionState): Promise<void>;

// ─── Circuit Breaker ───────────────────────────────────────────────────────

/** Reset the circuit breaker for a node (or all nodes if no address given) */
export function resetCircuitBreaker(address?: string): void;

/** Configure circuit breaker thresholds globally */
export function configureCircuitBreaker(opts?: CircuitBreakerConfig): void;

/** Get circuit breaker status for a node or all nodes */
export function getCircuitBreakerStatus(address?: string):
  Record<string, CircuitBreakerStatus> | CircuitBreakerStatus | null;

/** Get connection metrics for observability */
export function getConnectionMetrics(nodeAddress?: string):
  Record<string, ConnectionMetric> | ConnectionMetric | null;

// ─── Kill Switch & System Proxy ────────────────────────────────────────────

/** Enable kill switch -- blocks all non-tunnel traffic (Windows only) */
export function enableKillSwitch(serverEndpoint: string, tunnelName?: string): void;

/** Disable kill switch -- restore normal routing */
export function disableKillSwitch(): void;

/** Check if kill switch is enabled */
export function isKillSwitchEnabled(): boolean;

/** Enable DNS leak prevention (forces DNS through tunnel) */
export function enableDnsLeakPrevention(dnsServer?: string): void;

/** Disable DNS leak prevention (restore original DNS settings) */
export function disableDnsLeakPrevention(): void;

/** Set system SOCKS proxy (Windows: registry, macOS: networksetup, Linux: gsettings) */
export function setSystemProxy(socksPort: number): void;

/** Clear system SOCKS proxy */
export function clearSystemProxy(): void;

/** Check if a TCP port is free */
export function checkPortFree(port: number): Promise<boolean>;

// ─── Node Discovery ────────────────────────────────────────────────────────

import type {
  ListNodesOptions,
  ScoredNode,
  NodePrices,
  NodeIndex,
  NetworkOverview,
} from './nodes.js';

/** List online nodes, sorted by quality score. Uses 5-min cache. */
export function listNodes(options?: ListNodesOptions): Promise<ScoredNode[]>;

/** List online nodes (alias for listNodes) */
export function queryOnlineNodes(options?: ListNodesOptions): Promise<ScoredNode[]>;

/** Fetch ALL active nodes from LCD -- no per-node status checks, instant. Returns 900+ nodes. */
export function fetchAllNodes(options?: { lcdUrl?: string }): Promise<Array<{
  address: string;
  remote_url: string;
  gigabyte_prices: Array<{ denom: string; base_value: string; quote_value: string }>;
  hourly_prices: Array<{ denom: string; base_value: string; quote_value: string }>;
}>>;

/** Enrich LCD nodes with type/country/city by probing each node's status API */
export function enrichNodes(nodes: unknown[], options?: {
  concurrency?: number;
  timeout?: number;
  onProgress?: (progress: { total: number; done: number; enriched: number }) => void;
}): Promise<ScoredNode[]>;

/** Build geographic index from enriched nodes for instant country/city lookups */
export function buildNodeIndex(nodes: ScoredNode[]): NodeIndex;

/**
 * Filter a node list by country, service type, max price, or min quality score.
 * Works with results from listNodes(), enrichNodes(), or fetchAllNodes().
 */
export function filterNodes(nodes: unknown[], criteria?: {
  country?: string;
  serviceType?: 'wireguard' | 'v2ray';
  maxPriceDvpn?: number;
  minScore?: number;
}): unknown[];

/** Get standardized prices for a node -- abstracts V3 LCD price parsing entirely */
export function getNodePrices(nodeAddress: string, lcdUrl?: string): Promise<NodePrices>;

/** Get a quick network overview -- total nodes, counts by country/type, average prices */
export function getNetworkOverview(lcdUrl?: string): Promise<NetworkOverview>;

/** Fetch a single node by address from LCD */
export function queryNode(nodeAddress: string, opts?: { lcdUrl?: string }): Promise<import('./chain.js').ChainNode>;

/** Clear the node list cache. Next queryOnlineNodes() call will fetch fresh data. */
export function flushNodeCache(): void;

// ─── Wallet & Chain ────────────────────────────────────────────────────────

import type {
  WalletResult,
  SafeBroadcaster,
  EncodedMsg,
  PriceEntry,
  ChainNode,
  Subscription,
  ChainSession,
  FlatSession,
  Provider,
  FeeGrantAllowance,
  DiscoveredPlan,
  FeeGrantOptions,
  ExpiringGrant,
  PlanSubscriber,
  BatchFeeEstimate,
  SessionCostEstimate,
  Endpoint,
  FallbackResult,
  EndpointHealth,
  PlanStats,
  ParsedDuration,
  SubscribeToPlanResult,
} from './chain.js';

/** Create a Cosmos wallet from BIP39 mnemonic */
export function createWallet(mnemonic: string): Promise<WalletResult>;

/** Generate a new wallet with a fresh random BIP39 mnemonic */
export function generateWallet(strength?: number): Promise<{
  mnemonic: string;
  wallet: DirectSecp256k1HdWallet;
  account: { address: string };
}>;

/** Derive raw secp256k1 private key from mnemonic (32 bytes) */
export function privKeyFromMnemonic(mnemonic: string): Promise<Uint8Array>;

/** Create a SigningStargateClient connected to an RPC endpoint */
export function createClient(rpcUrl: string, wallet: DirectSecp256k1HdWallet): Promise<SigningStargateClient>;

/** Broadcast messages to the chain with automatic gas estimation */
export function broadcast(client: SigningStargateClient, signerAddress: string, msgs: EncodedMsg[], fee?: StdFee): Promise<DeliverTxResponse>;

/** Create a safe broadcaster with automatic sequence management */
export function createSafeBroadcaster(rpcUrl: string, wallet: DirectSecp256k1HdWallet, signerAddress: string): SafeBroadcaster;

/** Clear the wallet derivation cache. Call after disconnect to release key material. */
export function clearWalletCache(): void;

/** Extract an ID from TX result events using regex pattern */
export function extractId(txResult: DeliverTxResponse, eventPattern: RegExp, keyNames: string[]): string | null;

/** Parse chain error into human-readable message */
export function parseChainError(raw: string): string;

/** Get P2P balance for an address */
export function getBalance(client: SigningStargateClient, address: string): Promise<{ udvpn: number; dvpn: number }>;

/** Validate a BIP39 mnemonic without throwing. Returns true if valid. */
export function isMnemonicValid(mnemonic: string): boolean;

/** Get current P2P price in USD */
export function getDvpnPrice(): Promise<number>;

/** Find existing active session for wallet+node pair */
export function findExistingSession(lcdUrl: string, walletAddr: string, nodeAddr: string): Promise<bigint | null>;

/** Fetch active nodes from LCD with pagination */
export function fetchActiveNodes(lcdUrl: string, limit?: number, maxPages?: number): Promise<unknown[]>;

/** Discover plan IDs by probing LCD */
export function discoverPlanIds(lcdUrl: string, maxId?: number): Promise<number[]>;

/** Resolve node URL from LCD data (handles remote_addrs vs remote_url) */
export function resolveNodeUrl(node: { remote_url?: string; remote_addrs?: string[] }): string;

/** Convert sent1... address to sentprov1... */
export function sentToSentprov(sentAddr: string): string;

/** Convert sent1... address to sentnode1... */
export function sentToSentnode(sentAddr: string): string;

/** Convert sentprov1... address to sent1... */
export function sentprovToSent(provAddr: string): string;

/** Compare addresses across bech32 prefixes (sent1 vs sentprov1 vs sentnode1) */
export function isSameKey(addr1: string, addr2: string): boolean;

/** Build Sentinel protobuf type registry (for custom message handling) */
export function buildRegistry(): unknown;

/** Query LCD endpoint with timeout and error wrapping */
export function lcd(baseUrl: string, path: string): Promise<unknown>;

/** Extract TX response details into a simple object */
export function txResponse(result: DeliverTxResponse): { ok: boolean; txHash: string; gasUsed: number; gasWanted: number };

/** Single LCD query with timeout, retry, and ChainError wrapping */
export function lcdQuery(path: string, opts?: { lcdUrl?: string; timeout?: number }): Promise<unknown>;

/** Auto-paginating LCD query. Returns all items + chain total. */
export function lcdQueryAll(basePath: string, opts?: {
  lcdUrl?: string;
  limit?: number;
  timeout?: number;
  dataKey?: string;
}): Promise<{ items: unknown[]; total: number | null }>;

/** Paginated LCD query that handles Sentinel's broken pagination */
export function lcdPaginatedSafe(lcdUrl: string, path: string, itemsKey: string, opts?: {
  limit?: number;
  fallbackLimit?: number;
}): Promise<{ items: unknown[]; total: number }>;

// ─── Fee Grants ────────────────────────────────────────────────────────────

/** Build a MsgGrantAllowance -- granter pays gas for grantee */
export function buildFeeGrantMsg(granter: string, grantee: string, opts?: FeeGrantOptions): EncodedMsg;

/** Build a MsgRevokeAllowance */
export function buildRevokeFeeGrantMsg(granter: string, grantee: string): EncodedMsg;

/** Query fee grants given to a grantee */
export function queryFeeGrants(lcdUrl: string, grantee: string): Promise<FeeGrantAllowance[]>;

/** Query fee grants issued BY an address (granter lookup) */
export function queryFeeGrantsIssued(lcdUrl: string, granter: string): Promise<FeeGrantAllowance[]>;

/** Query a specific fee grant between granter and grantee */
export function queryFeeGrant(lcdUrl: string, granter: string, grantee: string): Promise<unknown | null>;

/** Broadcast with fee paid by a granter (fee grant) */
export function broadcastWithFeeGrant(client: SigningStargateClient, signerAddress: string, msgs: EncodedMsg[], granterAddress: string, memo?: string): Promise<DeliverTxResponse>;

/** Grant fee allowance to all plan subscribers who don't already have one */
export function grantPlanSubscribers(planId: number | string, opts: {
  granterAddress: string;
  lcdUrl?: string;
  grantOpts?: FeeGrantOptions;
}): Promise<{ msgs: EncodedMsg[]; skipped: string[]; newGrants: string[] }>;

/** Find fee grants expiring within N days */
export function getExpiringGrants(
  lcdUrl: string,
  granteeOrGranter: string,
  withinDays?: number,
  role?: 'grantee' | 'granter',
): Promise<ExpiringGrant[]>;

/** Revoke and re-grant expiring fee grants. Returns messages ready for broadcast. */
export function renewExpiringGrants(
  lcdUrl: string,
  granterAddress: string,
  withinDays?: number,
  grantOpts?: FeeGrantOptions,
): Promise<{ msgs: EncodedMsg[]; renewed: string[] }>;

/** Monitor fee grants for expiry. Returns EventEmitter with .stop(). */
export function monitorFeeGrants(opts: {
  lcdUrl: string;
  address: string;
  checkIntervalMs?: number;
  warnDays?: number;
  autoRenew?: boolean;
  grantOpts?: FeeGrantOptions;
}): EventEmitter & {
  stop(): void;
  on(event: 'expiring', listener: (grant: ExpiringGrant) => void): EventEmitter;
  on(event: 'expired', listener: (grant: ExpiringGrant) => void): EventEmitter;
  on(event: 'renew', listener: (data: { msgs: EncodedMsg[]; renewed: string[] }) => void): EventEmitter;
  on(event: 'error', listener: (err: Error) => void): EventEmitter;
};

// ─── Authz (cosmos.authz.v1beta1) ──────────────────────────────────────────

/** Build a MsgGrant for a specific message type */
export function buildAuthzGrantMsg(granter: string, grantee: string, msgTypeUrl: string, expiration?: Date | string): EncodedMsg;

/** Build a MsgRevoke to remove an authorization */
export function buildAuthzRevokeMsg(granter: string, grantee: string, msgTypeUrl: string): EncodedMsg;

/** Build a MsgExec to execute messages on behalf of a granter */
export function buildAuthzExecMsg(grantee: string, encodedMsgs: Array<{ typeUrl: string; value: Uint8Array }>): EncodedMsg;

/** Encode SDK message objects for use in MsgExec */
export function encodeForExec(msgs: EncodedMsg[]): Array<{ typeUrl: string; value: Uint8Array }>;

/** Query authz grants between granter and grantee */
export function queryAuthzGrants(lcdUrl: string, granter: string, grantee: string): Promise<unknown[]>;

// ─── Subscriptions & Plans ─────────────────────────────────────────────────

/** Query a wallet's active subscriptions */
export function querySubscriptions(lcdUrl: string, walletAddr: string, opts?: { status?: 'active' | 'inactive' }): Promise<{ items: Subscription[]; total: number | null }>;

/** Get a single subscription by ID */
export function querySubscription(id: string | number, lcdUrl?: string): Promise<Subscription | null>;

/** Check if wallet has active subscription for a plan */
export function hasActiveSubscription(address: string, planId: number | string, lcdUrl?: string): Promise<{ has: boolean; subscription?: Subscription }>;

/** Subscribe to a plan. Returns subscription ID from TX events. */
export function subscribeToPlan(client: SigningStargateClient, fromAddress: string, planId: number | string | bigint, denom?: string): Promise<SubscribeToPlanResult>;

/** Send P2P tokens to an address */
export function sendTokens(client: SigningStargateClient, fromAddress: string, toAddress: string, amountUdvpn: number | string, memo?: string): Promise<DeliverTxResponse>;

/** Query nodes linked to a plan */
export function queryPlanNodes(planId: number | string, lcdUrl?: string): Promise<{ items: ChainNode[]; total: number | null }>;

/** Discover all plans with metadata */
export function discoverPlans(lcdUrl?: string, opts?: {
  maxId?: number;
  batchSize?: number;
  includeEmpty?: boolean;
}): Promise<DiscoveredPlan[]>;

/** Query all subscriptions for a plan */
export function queryPlanSubscribers(planId: number | string, opts?: {
  lcdUrl?: string;
  excludeAddress?: string;
}): Promise<{ subscribers: PlanSubscriber[]; total: number | null }>;

/** Get plan stats with self-subscription filtered out */
export function getPlanStats(planId: number | string, ownerAddress: string, opts?: {
  lcdUrl?: string;
}): Promise<PlanStats>;

/** Get provider details by address */
export function getProviderByAddress(provAddress: string, opts?: { lcdUrl?: string }): Promise<Provider | null>;

// ─── Sessions ──────────────────────────────────────────────────────────────

/** Query session allocation (remaining bandwidth) */
export function querySessionAllocation(lcdUrl: string, sessionId: string | number | bigint): Promise<{
  maxBytes: number;
  usedBytes: number;
  remainingBytes: number;
  percentUsed: number;
} | null>;

/** List all sessions for a wallet */
export function querySessions(address: string, lcdUrl?: string, opts?: { status?: string }): Promise<{ items: ChainSession[]; total: number }>;

/** Flatten base_session nesting so session.id works (prevents the #1 footgun) */
export function flattenSession(session: ChainSession): FlatSession;

// ─── Batch Operations ──────────────────────────────────────────────────────

/** Build batch MsgStartSession messages for multiple nodes in one TX */
export function buildBatchStartSession(from: string, nodes: Array<{
  nodeAddress: string;
  gigabytes?: number;
  maxPrice: PriceEntry;
}>): EncodedMsg[];

/** Build MsgEndSession to close a session early */
export function buildEndSessionMsg(from: string, sessionId: number | string | bigint): EncodedMsg;

/** Build batch MsgSend messages for token distribution */
export function buildBatchSend(fromAddress: string, recipients: Array<{ address: string; amountUdvpn: number | string }>): EncodedMsg[];

/** Build batch MsgLinkNode messages */
export function buildBatchLink(provAddress: string, planId: number | string | bigint, nodeAddresses: string[]): EncodedMsg[];

/** Decode base64-encoded TX events into readable key-value pairs */
export function decodeTxEvents(events: unknown[]): Array<{ type: string; attributes: Array<{ key: string; value: string }> }>;

/** Extract ALL session IDs from a batch TX result */
export function extractAllSessionIds(txResult: DeliverTxResponse): bigint[];

/** Estimate gas fee for a batch of messages */
export function estimateBatchFee(msgCount: number, msgType?: 'startSession' | 'feeGrant' | 'send' | 'link'): BatchFeeEstimate;

/** Estimate the cost of starting a session with a node */
export function estimateSessionCost(nodeInfo: unknown, gigabytes?: number, options?: {
  preferHourly?: boolean;
  hours?: number;
}): SessionCostEstimate;

/** Start sessions on multiple nodes in one batch TX (OPERATOR TOOL) */
export function batchStartSessions(opts: {
  mnemonic: string;
  rpcUrl?: string;
  lcdUrl?: string;
  nodes: Array<{ nodeAddress: string; gigabytes?: number; maxPrice?: PriceEntry }>;
}): Promise<{ txHash: string; sessionIds: bigint[] }>;

/** Wait for batch sessions to appear on LCD */
export function waitForBatchSessions(sessionIds: bigint[], opts?: {
  lcdUrl?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<Array<{ sessionId: bigint; status: string }>>;

/** Wait for a single session to become active on LCD */
export function waitForSessionActive(sessionId: bigint | string | number, opts?: {
  lcdUrl?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<boolean>;

// ─── Protocol ──────────────────────────────────────────────────────────────

import type {
  NodeStatus,
  WgKeyPair,
  HandshakeResult,
  V2RayHandshakeResult,
  SpeedResult,
  SpeedComparison,
  SpeedtestDefaults,
  WatchdogResult,
} from './protocol.js';

/** Query node status via its REST API */
export function nodeStatusV3(remoteUrl: string, agent?: import('https').Agent): Promise<NodeStatus>;

/** Generate WireGuard keypair (Curve25519) */
export function generateWgKeyPair(): WgKeyPair;

/** Perform WireGuard handshake with node */
export function initHandshakeV3(remoteUrl: string, sessionId: bigint | string | number, cosmosPrivKey: Uint8Array, wgPublicKey: Buffer, agent?: import('https').Agent): Promise<HandshakeResult>;

/** Perform V2Ray handshake with node */
export function initHandshakeV3V2Ray(remoteUrl: string, sessionId: bigint | string | number, cosmosPrivKey: Uint8Array, uuid: string, agent?: import('https').Agent): Promise<V2RayHandshakeResult>;

/** Write WireGuard config file and return the file path */
export function writeWgConfig(wgPrivKey: Buffer, assignedAddrs: string[], serverPubKey: string, serverEndpoint: string, splitIPs?: string[] | null, opts?: { dns?: string; mtu?: number; keepalive?: number }): string;

/** Build V2Ray client config JSON object */
export function buildV2RayClientConfig(serverHost: string, metadataJson: string, uuid: string, socksPort?: number, opts?: { dns?: string; dnsPreset?: string }): object;

/** Generate a V2Ray-compatible UUID */
export function generateV2RayUUID(): string;

/** Extract session ID from handshake response */
export function extractSessionId(hsResult: unknown): bigint | null;

/** Wait for a TCP port to become available */
export function waitForPort(port: number, timeoutMs?: number, host?: string, intervalMs?: number): Promise<boolean>;

/** Validate an IP/CIDR string (e.g. "10.8.0.2/24") */
export function validateCIDR(cidr: string): boolean;

// ─── Session Message Encoders ──────────────────────────────────────────────

/** Encode MsgStartSession (sentinel.session.v3) */
export function encodeMsgStartSession(params: { from: string; node_address: string; gigabytes?: number; hours?: number; max_price?: unknown }): Uint8Array;

/** Encode MsgEndSession (sentinel.session.v3) */
export function encodeMsgEndSession(params: { from: string; id: number | bigint; rating?: number }): Uint8Array;

/** Encode MsgStartSubscription (sentinel.subscription.v3) */
export function encodeMsgStartSubscription(params: { from: string; id: number | bigint; denom?: string; renewalPricePolicy?: number }): Uint8Array;

/** Encode MsgSubStartSession (sentinel.subscription.v3) */
export function encodeMsgSubStartSession(params: { from: string; id: number | bigint; nodeAddress: string }): Uint8Array;

/** Encode MsgCancelSubscription (sentinel.subscription.v3) */
export function encodeMsgCancelSubscription(params: { from: string; id: number | bigint }): Uint8Array;

/** Encode MsgRenewSubscription (sentinel.subscription.v3) */
export function encodeMsgRenewSubscription(params: { from: string; id: number | bigint; denom?: string }): Uint8Array;

/** Encode MsgShareSubscription (sentinel.subscription.v3) */
export function encodeMsgShareSubscription(params: { from: string; id: number | bigint; accAddress: string; bytes: string | number }): Uint8Array;

/** Encode MsgUpdateSubscription (sentinel.subscription.v3) */
export function encodeMsgUpdateSubscription(params: { from: string; id: number | bigint; renewalPricePolicy: number }): Uint8Array;

/** Encode MsgUpdateSession (sentinel.session.v3) */
export function encodeMsgUpdateSession(params: { from: string; id: number | bigint; downloadBytes: string | number; uploadBytes: string | number }): Uint8Array;

/** Encode MsgRegisterNode (sentinel.node.v3) */
export function encodeMsgRegisterNode(params: { from: string; gigabytePrices?: unknown[]; hourlyPrices?: unknown[]; remoteAddrs?: string[] }): Uint8Array;

/** Encode MsgUpdateNodeDetails (sentinel.node.v3) */
export function encodeMsgUpdateNodeDetails(params: { from: string; gigabytePrices?: unknown[]; hourlyPrices?: unknown[]; remoteAddrs?: string[] }): Uint8Array;

/** Encode MsgUpdateNodeStatus (sentinel.node.v3) */
export function encodeMsgUpdateNodeStatus(params: { from: string; status: number }): Uint8Array;

/** Encode MsgUpdatePlanDetails (sentinel.plan.v3) */
export function encodeMsgUpdatePlanDetails(params: { from: string; id: number | bigint; bytes?: string; duration?: number | { seconds: number; nanos?: number }; prices?: unknown[] }): Uint8Array;

// ─── Plan & Provider Message Encoders ──────────────────────────────────────

/** Encode MsgRegisterProviderRequest */
export function encodeMsgRegisterProvider(params: { from: string; name: string; identity?: string; website?: string; description?: string }): Uint8Array;

/** Encode MsgUpdateProviderDetailsRequest */
export function encodeMsgUpdateProviderDetails(params: { from: string; name?: string; identity?: string; website?: string; description?: string }): Uint8Array;

/** Encode MsgUpdateProviderStatusRequest */
export function encodeMsgUpdateProviderStatus(params: { from: string; status: number }): Uint8Array;

/** Encode MsgCreatePlanRequest */
export function encodeMsgCreatePlan(params: { from: string; bytes?: string; duration?: number | { seconds: number; nanos?: number }; prices?: PriceEntry[]; isPrivate?: boolean }): Uint8Array;

/** Encode MsgUpdatePlanStatusRequest */
export function encodeMsgUpdatePlanStatus(params: { from: string; id: number | bigint; status: number }): Uint8Array;

/** Encode MsgLinkNodeRequest */
export function encodeMsgLinkNode(params: { from: string; id: number | bigint; nodeAddress: string }): Uint8Array;

/** Encode MsgUnlinkNodeRequest */
export function encodeMsgUnlinkNode(params: { from: string; id: number | bigint; nodeAddress: string }): Uint8Array;

/** Encode MsgPlanStartSession (plan subscribe + session in one TX) */
export function encodeMsgPlanStartSession(params: { from: string; id: number | bigint; denom?: string; renewalPricePolicy?: number; nodeAddress?: string }): Uint8Array;

/** Encode MsgStartLeaseRequest */
export function encodeMsgStartLease(params: { from: string; nodeAddress: string; hours: number; maxPrice?: PriceEntry; renewalPricePolicy?: number }): Uint8Array;

/** Encode MsgEndLeaseRequest */
export function encodeMsgEndLease(params: { from: string; id: number | bigint }): Uint8Array;

/** Encode sentinel.types.v1.Price protobuf */
export function encodePrice(params: PriceEntry): Buffer;

/** Encode google.protobuf.Duration */
export function encodeDuration(params: { seconds: number; nanos?: number }): Buffer;

/** Convert sdk.Dec string to scaled integer string (multiply by 10^18) */
export function decToScaledInt(decStr: string): string;

// ─── WireGuard ─────────────────────────────────────────────────────────────

/** Install and activate a WireGuard tunnel */
export function installWgTunnel(confPath: string): Promise<string>;

/** Uninstall a WireGuard tunnel */
export function uninstallWgTunnel(tunnelName?: string): Promise<void>;

/** Legacy: connect WireGuard from instance */
export function connectWireGuard(wgInstance: unknown): Promise<string>;

/** Legacy: disconnect WireGuard */
export function disconnectWireGuard(): Promise<void>;

/** Emergency force-kill all sentinel WireGuard tunnels (sync, safe in exit handlers) */
export function emergencyCleanupSync(): void;

/** Check if a tunnel is currently active */
export function watchdogCheck(): WatchdogResult;

/** Whether the current process is running as admin/root */
export const IS_ADMIN: boolean;

/** Path to wireguard.exe (Windows) or null */
export const WG_EXE: string | null;

/** Path to wg-quick (Linux/macOS) or null */
export const WG_QUICK: string | null;

/** Whether WireGuard is available on this system */
export const WG_AVAILABLE: boolean;

// ─── Preflight Helpers ─────────────────────────────────────────────────────

/** Check for orphaned WireGuard tunnels from previous crashes */
export function checkOrphanedTunnels(): { found: boolean; tunnels: string[]; cleaned: boolean };

/** Remove orphaned WireGuard tunnels */
export function cleanOrphanedTunnels(): { cleaned: number; errors: string[] };

/** Check for orphaned V2Ray processes */
export function checkOrphanedV2Ray(): { found: boolean; pids: number[] };

/** Detect running VPN software that may conflict */
export function checkVpnConflicts(): { conflicts: Array<{ name: string; running: boolean }> };

/** Check if common V2Ray SOCKS5 ports are in use */
export function checkPortConflicts(): { conflicts: Array<{ port: number; inUse: boolean }> };

// ─── Speed Testing ─────────────────────────────────────────────────────────

/** Run speed test directly (no VPN) */
export function speedtestDirect(): Promise<SpeedResult>;

/** Run speed test through SOCKS5 proxy (V2Ray tunnel) */
export function speedtestViaSocks5(testMb?: number, proxyPort?: number, socksAuth?: { user: string; pass: string } | null): Promise<SpeedResult>;

/** Resolve Cloudflare speedtest IPs for split tunneling */
export function resolveSpeedtestIPs(): Promise<string[]>;

/** Flush cached DNS resolutions. Call when switching VPN connections. */
export function flushSpeedTestDnsCache(): void;

/** Compare two speed test results */
export function compareSpeedTests(before: SpeedResult, after: SpeedResult): SpeedComparison;

/** Speed test configuration constants */
export const SPEEDTEST_DEFAULTS: Readonly<SpeedtestDefaults>;

// ─── State Persistence ─────────────────────────────────────────────────────

import type { SDKState, RecoverResult, PidCheck, SavedCredentials } from './session.js';

/** Save current connection state for crash recovery */
export function saveState(state: SDKState): void;

/** Load saved state (null if none) */
export function loadState(): SDKState | null;

/** Clear saved state */
export function clearState(): void;

/** Recover orphaned tunnels/proxies from a previous crash */
export function recoverOrphans(): RecoverResult;

/** Mark a session as poisoned (failed, don't retry) */
export function markSessionPoisoned(sessionId: string, nodeAddress: string, error: string): void;

/** Mark a session as active */
export function markSessionActive(sessionId: string, nodeAddress: string): void;

/** Check if a session is poisoned */
export function isSessionPoisoned(sessionId: string): boolean;

/** Get session history (all sessions, active and poisoned) */
export function getSessionHistory(): Record<string, unknown>;

/** Write a PID file for process management */
export function writePidFile(name?: string): { pidFile: string };

/** Check if a process with a PID file is running */
export function checkPidFile(name?: string): PidCheck;

/** Clear a PID file */
export function clearPidFile(name?: string): void;

/** Save handshake credentials for a node+session pair (enables fast reconnect) */
export function saveCredentials(nodeAddress: string, sessionId: string, credentials: Record<string, unknown>): void;

/** Load saved credentials for a node (null if none) */
export function loadCredentials(nodeAddress: string): SavedCredentials | null;

/** Clear saved credentials for a specific node */
export function clearCredentials(nodeAddress: string): void;

/** Clear all saved credentials */
export function clearAllCredentials(): void;

// ─── VPN Settings Persistence ──────────────────────────────────────────────

/** Load persisted VPN settings from ~/.sentinel-sdk/settings.json */
export function loadVpnSettings(): Record<string, unknown>;

/** Save VPN settings to ~/.sentinel-sdk/settings.json */
export function saveVpnSettings(settings: Record<string, unknown>): void;

// ─── TLS Trust (TOFU) ─────────────────────────────────────────────────────

/** Create an HTTPS agent with TOFU certificate pinning for a node */
export function createNodeHttpsAgent(nodeAddress: string, mode?: 'tofu' | 'none'): import('https').Agent;

/** Clear stored certificate for a specific node */
export function clearKnownNode(nodeAddress: string): void;

/** Clear all stored node certificates */
export function clearAllKnownNodes(): void;

/** Get stored certificate info for a node (null if unknown) */
export function getKnownNode(nodeAddress: string): { fingerprint: string; firstSeen: string; lastSeen: string } | null;

/** CA-validated HTTPS agent for LCD/RPC public endpoints */
export const publicEndpointAgent: import('https').Agent;

// ─── Defaults & Constants ──────────────────────────────────────────────────

export const SDK_VERSION: string;
export const LAST_VERIFIED: string;
export const HARDCODED_NOTE: string;
export const CHAIN_ID: string;
export const CHAIN_VERSION: string;
export const COSMOS_SDK_VERSION: string;
export const DENOM: string;
export const GAS_PRICE: string;
export const DEFAULT_RPC: string;
export const DEFAULT_LCD: string;
export const RPC_ENDPOINTS: Endpoint[];
export const LCD_ENDPOINTS: Endpoint[];
export const V2RAY_VERSION: string;
export const TRANSPORT_SUCCESS_RATES: Record<string, import('./protocol.js').TransportSuccessRate>;
export const BROKEN_NODES: Array<import('./nodes.js').BrokenNode>;
export const PRICING_REFERENCE: import('./pricing.js').PricingReference;
export const DEFAULT_TIMEOUTS: Readonly<import('./connection.js').ConnectionTimeouts>;

/** Try an operation across multiple endpoints with fallback */
export function tryWithFallback<T>(
  endpoints: Endpoint[],
  operation: (url: string) => Promise<T>,
  label?: string,
): Promise<FallbackResult<T>>;

/** Check endpoint health -- returns endpoints sorted by latency */
export function checkEndpointHealth(
  endpoints: Array<{ url: string; name: string }>,
  timeoutMs?: number,
): Promise<EndpointHealth[]>;

/** Promise-based delay (ms) */
export function sleep(ms: number): Promise<void>;

/** Convert bytes transferred over seconds to Mbps */
export function bytesToMbps(bytes: number, seconds: number, decimals?: number): number;

// ─── Dynamic Transport Rate Tracking ───────────────────────────────────────

/** Record a transport connection success/failure (called automatically by setupV2Ray) */
export function recordTransportResult(transportKey: string, success: boolean): void;

/** Get dynamic success rate for a transport (null if < 2 samples) */
export function getDynamicRate(transportKey: string): number | null;

/** Get all dynamic rates */
export function getDynamicRates(): Record<string, import('./protocol.js').DynamicTransportRate>;

/** Clear all dynamic rate data. Pass true to also clear persisted data on disk. */
export function resetDynamicRates(persist?: boolean): void;

// ─── DNS Presets ───────────────────────────────────────────────────────────

import type { DnsPreset } from './settings.js';

/** DNS server presets. Handshake is default (censorship-resistant). */
export const DNS_PRESETS: Readonly<{
  handshake: DnsPreset;
  google: DnsPreset;
  cloudflare: DnsPreset;
}>;

/** Default DNS preset name ('handshake') */
export const DEFAULT_DNS_PRESET: string;

/** Fallback order when primary DNS fails */
export const DNS_FALLBACK_ORDER: string[];

/**
 * Resolve a DNS option into a comma-separated string for WireGuard/V2Ray config.
 * Includes fallback DNS servers.
 */
export function resolveDnsServers(dns?: string | string[]): string;

// ─── Display & Serialization Helpers ───────────────────────────────────────

/** Format micro-denom (udvpn) as human-readable P2P string. e.g. formatDvpn(40152030) -> "40.15 P2P" */
export function formatDvpn(udvpn: number | string, decimals?: number): string;

/** Format micro-denom as P2P string (alias for formatDvpn) */
export function formatP2P(udvpn: number | string, decimals?: number): string;

/** Serialize a ConnectResult for JSON APIs (converts BigInt -> string, strips functions) */
export function serializeResult(result: ConnectResult): Record<string, unknown>;

/** Truncate an address for display (e.g. "sent1abc...xyz") */
export function shortAddress(addr: string, prefixLen?: number, suffixLen?: number): string;

/** Format subscription expiry as relative time (e.g. "23d left", "expired") */
export function formatSubscriptionExpiry(subscription: { inactive_at?: string; status_at?: string }): string;

/** Format byte count for display (e.g. "1.5 GB", "250 MB") */
export function formatBytes(bytes: number | string): string;

/** Format milliseconds into human-readable uptime (e.g. "2h 15m") */
export function formatUptime(ms: number): string;

/** Parse chain duration string ("557817.72s" -> structured object) */
export function parseChainDuration(durationStr: string): ParsedDuration;

/** Compute session allocation stats from chain session data */
export function computeSessionAllocation(session: {
  downloadBytes?: string;
  download_bytes?: string;
  uploadBytes?: string;
  upload_bytes?: string;
  maxBytes?: string;
  max_bytes?: string;
  maxDuration?: string;
  max_duration?: string;
}): import('./session.js').SessionAllocation;

// ─── App Builder Helpers ───────────────────────────────────────────────────

import type { NodeDisplay, CountryGroup, NodePricingDisplay, SessionPriceEstimate } from './pricing.js';

/** Country name -> ISO code map (80+ countries, includes chain variants) */
export const COUNTRY_MAP: Readonly<Record<string, string>>;

/** Convert country name to ISO 3166-1 alpha-2 code */
export function countryNameToCode(name: string | null | undefined): string | null;

/** Get flag PNG URL from flagcdn.com (for native apps where emoji flags don't render) */
export function getFlagUrl(code: string, width?: number): string;

/** Get emoji flag for web apps. Does NOT work in WPF. */
export function getFlagEmoji(code: string): string;

/** Format raw udvpn amount to human-readable P2P price string */
export function formatPriceP2P(udvpnAmount: string | number, decimals?: number): string;

/** Format both GB and hourly prices from a chain node for UI display */
export function formatNodePricing(node: unknown): NodePricingDisplay;

/** Estimate session cost for a given duration/amount and pricing model */
export function estimateSessionPrice(node: unknown, model: 'gb' | 'hour', amount: number): SessionPriceEstimate;

/** Build a display-ready node object combining chain data + status enrichment */
export function buildNodeDisplay(chainNode: unknown, status?: unknown): NodeDisplay;

/** Group nodes by country for sidebar display */
export function groupNodesByCountry(nodes: NodeDisplay[]): CountryGroup[];

/** Common hour options for hourly session selection UI: [1, 2, 4, 8, 12, 24] */
export const HOUR_OPTIONS: number[];

/** Common GB options for per-GB session selection UI: [1, 2, 5, 10, 25, 50] */
export const GB_OPTIONS: number[];

// ─── App Types ─────────────────────────────────────────────────────────────

import type { AppTypeConfig, AppConfigValidation } from './settings.js';

/** App type constants: WHITE_LABEL, DIRECT_P2P, ALL_IN_ONE */
export const APP_TYPES: Readonly<{
  WHITE_LABEL: 'white_label';
  DIRECT_P2P: 'direct_p2p';
  ALL_IN_ONE: 'all_in_one';
}>;

/** Per-type configuration, UI requirements, flows, and SDK function lists */
export const APP_TYPE_CONFIG: Readonly<Record<string, AppTypeConfig>>;

/** Validate app config against type requirements. Call at startup. */
export function validateAppConfig(appType: string, config?: Record<string, unknown>): AppConfigValidation;

/** Get recommended connect options for an app type */
export function getConnectDefaults(appType: string, appConfig?: Record<string, unknown>): Record<string, unknown>;

// ─── App Settings ──────────────────────────────────────────────────────────

import type { AppSettings } from './settings.js';

/** Load app settings from disk. Returns defaults for missing/corrupt files. */
export function loadAppSettings(): AppSettings;

/** Save app settings to disk (atomic write) */
export function saveAppSettings(settings: AppSettings): void;

/** Reset all settings to defaults */
export function resetAppSettings(): void;

/** All settings with their defaults (frozen object) */
export const APP_SETTINGS_DEFAULTS: Readonly<AppSettings>;

// ─── Session Tracker ───────────────────────────────────────────────────────

import type { SessionPaymentMode } from './session.js';

/** Track payment mode for a session */
export function trackSession(sessionId: string | number | bigint, mode: SessionPaymentMode): void;

/** Get payment mode for a session */
export function getSessionMode(sessionId: string | number | bigint): SessionPaymentMode;

/** Get all tracked sessions */
export function getAllTrackedSessions(): Record<string, SessionPaymentMode>;

/** Clear tracking for a session */
export function clearSessionMode(sessionId: string | number | bigint): void;

// ─── Disk Cache ────────────────────────────────────────────────────────────

import type { CacheInfo, DiskCacheEntry } from './settings.js';

/** Fetch data with TTL caching + inflight deduplication + stale fallback */
export function cached<T>(key: string, ttlMs: number, fetchFn: () => Promise<T>): Promise<T>;

/** Invalidate a single cache entry */
export function cacheInvalidate(key: string): void;

/** Clear all cache entries */
export function cacheClear(): void;

/** Get cache entry metadata (for debugging) */
export function cacheInfo(key: string): CacheInfo | null;

/** Save data to disk cache */
export function diskSave(key: string, data: unknown): void;

/** Load data from disk cache */
export function diskLoad<T = unknown>(key: string, maxAgeMs: number): DiskCacheEntry<T> | null;

/** Clear a disk cache entry */
export function diskClear(key: string): void;

// ─── Session Manager Class ─────────────────────────────────────────────────

/**
 * Manages session lifecycle: session map, credential cache,
 * poisoning, and duplicate payment tracking.
 */
export class SessionManager {
  constructor(lcdUrl: string, walletAddress: string, options?: {
    mapTtl?: number;
    credentialPath?: string;
    logger?: (msg: string) => void;
  });

  /** Fetch all active sessions for the wallet with full pagination */
  buildSessionMap(): Promise<Map<string, { sessionId: bigint; maxBytes: number; usedBytes: number }>>;

  /** Find existing session for a node (returns session ID or null) */
  findExistingSession(nodeAddress: string): Promise<bigint | null>;

  /** Check if a session is poisoned */
  isPoisoned(nodeAddress: string, sessionId: bigint | string): boolean;

  /** Mark a session as poisoned */
  poison(nodeAddress: string, sessionId: bigint | string, error: string): void;

  /** Check if we already paid for a node this run */
  hasPaid(nodeAddress: string): boolean;

  /** Mark a node as paid this run */
  markPaid(nodeAddress: string): void;

  /** Save credentials for a session */
  saveCredentials(nodeAddress: string, sessionId: string, creds: Record<string, unknown>): void;

  /** Load credentials for a node */
  loadCredentials(nodeAddress: string): SavedCredentials | null;
}

// ─── SentinelClient (Instantiable) ─────────────────────────────────────────

/** Options for SentinelClient constructor. */
export interface SentinelClientOptions {
  /** Default RPC URL (overridable per-call) */
  rpcUrl?: string;
  /** Default LCD URL (overridable per-call) */
  lcdUrl?: string;
  /** Default mnemonic (overridable per-call) */
  mnemonic?: string;
  /** Default V2Ray binary path */
  v2rayExePath?: string;
  /** Logger function (default: console.log). Set to null to suppress. */
  logger?: ((msg: string) => void) | null;
  /** TLS trust mode (default: 'tofu') */
  tlsTrust?: 'tofu' | 'none';
  /** Default timeout overrides */
  timeouts?: import('./connection.js').ConnectionTimeouts;
  /** Default fullTunnel setting */
  fullTunnel?: boolean;
  /** Default systemProxy setting */
  systemProxy?: boolean;
}

/**
 * Instantiable SDK client with per-instance state, DI, and EventEmitter.
 *
 * Each instance has its own EventEmitter, cached wallet/client, and
 * default options that merge with per-call overrides.
 *
 * LIMITATION: WireGuard and V2Ray tunnels are OS-level singletons.
 * Only one client can have an active tunnel at a time.
 */
export class SentinelClient extends EventEmitter {
  constructor(opts?: SentinelClientOptions);

  /** Connect to a node (pay per GB). Options merged with constructor defaults. */
  connect(opts?: Partial<ConnectOptions>): Promise<ConnectResult>;

  /** Connect with auto-fallback: picks best node, retries on failure */
  autoConnect(opts?: Partial<ConnectAutoOptions>): Promise<ConnectResult>;

  /** Connect via plan subscription */
  connectPlan(opts?: Partial<ConnectViaPlanOptions>): Promise<ConnectResult>;

  /** Disconnect current VPN tunnel */
  disconnect(): Promise<void>;

  /** Check if a VPN tunnel is currently active */
  isConnected(): boolean;

  /** Get current connection status (null if not connected) */
  getStatus(): ConnectionStatus | null;

  /** List online nodes (uses 5min cache) */
  listNodes(options?: ListNodesOptions): Promise<ScoredNode[]>;

  /** Get status of a specific node */
  nodeStatus(remoteUrl: string, nodeAddress?: string): Promise<NodeStatus>;

  /** Create or return cached wallet from mnemonic */
  getWallet(mnemonic?: string): Promise<WalletResult>;

  /** Get or create cached RPC client */
  getClient(rpcUrl?: string): Promise<SigningStargateClient>;

  /** Get P2P balance for instance wallet */
  getBalance(): Promise<{ udvpn: number; dvpn: number }>;

  /** Clear stored TLS fingerprint for a node */
  clearKnownNode(nodeAddress: string): void;

  /** Clear all stored TLS fingerprints */
  clearAllKnownNodes(): void;

  /** Get stored cert info for a node */
  getKnownNode(nodeAddress: string): { fingerprint: string; firstSeen: string; lastSeen: string } | null;

  /** Register process exit handlers */
  registerCleanup(): void;

  /** Clean up event forwarding. Call when discarding the instance. */
  destroy(): void;
}

// ─── Network Audit & Node Testing (OPERATOR TOOLS) ─────────────────────────

/** Test a single node end-to-end */
export function testNode(options: {
  mnemonic: string;
  nodeAddress: string;
  rpcUrl?: string;
  lcdUrl?: string;
  gigabytes?: number;
  speedtest?: boolean;
  log?: (msg: string) => void;
}): Promise<{
  nodeAddress: string;
  success: boolean;
  serviceType?: string;
  speedMbps?: number;
  error?: string;
  durationMs: number;
}>;

/** Audit the entire network (OPERATOR TOOL -- costs tokens) */
export function auditNetwork(options: {
  mnemonic: string;
  rpcUrl?: string;
  lcdUrl?: string;
  concurrency?: number;
  maxNodes?: number;
  speedtest?: boolean;
  onProgress?: (result: unknown) => void;
  log?: (msg: string) => void;
}): Promise<{
  results: unknown[];
  stats: { total: number; success: number; failed: number; skipped: number };
}>;

/** Load transport cache from disk */
export function loadTransportCache(cachePath?: string): void;

/** Save transport cache to disk */
export function saveTransportCache(cachePath?: string): void;

/** Record a transport success for reordering */
export function recordTransportSuccess(nodeAddr: string, transport: string): void;

/** Record a transport failure */
export function recordTransportFailure(transport: string): void;

/** Reorder V2Ray outbounds based on cached transport success rates */
export function reorderOutbounds(nodeAddr: string, outbounds: unknown[]): unknown[];

/** Get transport cache statistics */
export function getCacheStats(): { totalEntries: number; totalSamples: number };
