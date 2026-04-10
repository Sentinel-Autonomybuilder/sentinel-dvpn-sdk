/**
 * Sentinel dVPN SDK — TypeScript Declarations
 * 160+ exports across 14 modules.
 */

import { EventEmitter } from 'events';

// ─── Typed Errors ──────────────────────────────────────────────────────────

/** Base error class for all SDK errors. Check .code for machine-readable error type. */
export class SentinelError extends Error {
  code: string;
  details: Record<string, any>;
  constructor(code: string, message: string, details?: Record<string, any>);
  toJSON(): { name: string; code: string; message: string; details: Record<string, any> };
}

/** Input validation failures (bad mnemonic, invalid address, etc.) */
export class ValidationError extends SentinelError {}
/** Node-level failures (offline, no udvpn, clock drift, etc.) */
export class NodeError extends SentinelError {}
/** Chain/transaction failures (broadcast failed, extract failed, etc.) */
export class ChainError extends SentinelError {}
/** Tunnel setup failures (V2Ray all failed, WG no connectivity, etc.) */
export class TunnelError extends SentinelError {}
/** Security failures (TLS cert changed, etc.) */
export class SecurityError extends SentinelError {}

/** Machine-readable error codes */
export const ErrorCodes: {
  INVALID_OPTIONS: 'INVALID_OPTIONS';
  INVALID_MNEMONIC: 'INVALID_MNEMONIC';
  INVALID_NODE_ADDRESS: 'INVALID_NODE_ADDRESS';
  INVALID_GIGABYTES: 'INVALID_GIGABYTES';
  INVALID_URL: 'INVALID_URL';
  INVALID_PLAN_ID: 'INVALID_PLAN_ID';
  NODE_OFFLINE: 'NODE_OFFLINE';
  NODE_NO_UDVPN: 'NODE_NO_UDVPN';
  NODE_NOT_FOUND: 'NODE_NOT_FOUND';
  NODE_CLOCK_DRIFT: 'NODE_CLOCK_DRIFT';
  SESSION_EXISTS: 'SESSION_EXISTS';
  SESSION_EXTRACT_FAILED: 'SESSION_EXTRACT_FAILED';
  SESSION_POISONED: 'SESSION_POISONED';
  V2RAY_NOT_FOUND: 'V2RAY_NOT_FOUND';
  V2RAY_ALL_FAILED: 'V2RAY_ALL_FAILED';
  WG_NOT_AVAILABLE: 'WG_NOT_AVAILABLE';
  WG_NO_CONNECTIVITY: 'WG_NO_CONNECTIVITY';
  TUNNEL_SETUP_FAILED: 'TUNNEL_SETUP_FAILED';
  TLS_CERT_CHANGED: 'TLS_CERT_CHANGED';
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE';
  BROADCAST_FAILED: 'BROADCAST_FAILED';
  TX_FAILED: 'TX_FAILED';
  LCD_ERROR: 'LCD_ERROR';
  UNKNOWN_MSG_TYPE: 'UNKNOWN_MSG_TYPE';
  ALL_ENDPOINTS_FAILED: 'ALL_ENDPOINTS_FAILED';
  INVALID_ASSIGNED_IP: 'INVALID_ASSIGNED_IP';
  NODE_INACTIVE: 'NODE_INACTIVE';
  NODE_DATABASE_CORRUPT: 'NODE_DATABASE_CORRUPT';
  CHAIN_LAG: 'CHAIN_LAG';
  ABORTED: 'ABORTED';
  ALL_NODES_FAILED: 'ALL_NODES_FAILED';
  ALREADY_CONNECTED: 'ALREADY_CONNECTED';
  PARTIAL_CONNECTION_FAILED: 'PARTIAL_CONNECTION_FAILED';
};

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

// ─── Event Emitter ─────────────────────────────────────────────────────────

interface SDKEvents {
  on(event: 'connecting', listener: (data: { nodeAddress: string }) => void): SDKEvents;
  on(event: 'connected', listener: (data: { sessionId: bigint; serviceType: string; nodeAddress: string }) => void): SDKEvents;
  on(event: 'disconnected', listener: (data: { nodeAddress: string; serviceType: string; reason: string }) => void): SDKEvents;
  on(event: 'error', listener: (err: SentinelError | Error) => void): SDKEvents;
  on(event: 'progress', listener: (entry: { event: string; detail: string; ts: number; [key: string]: any }) => void): SDKEvents;
}

/** SDK lifecycle event emitter. Subscribe without polling. */
export const events: SDKEvents & EventEmitter;

// ─── High-level API ────────────────────────────────────────────────────────

export interface ConnectOptions {
  /** BIP39 mnemonic phrase (12 or 24 words) */
  mnemonic: string;
  /** sentnode1... address of the node to connect to */
  nodeAddress: string;
  /** Chain RPC URL (default: cascading fallback across 5 endpoints) */
  rpcUrl?: string;
  /** Chain LCD URL (default: cascading fallback across 4 endpoints) */
  lcdUrl?: string;
  /** Bandwidth to purchase in GB (default: 1). Ignored when hours is set. */
  gigabytes?: number;
  /** Hours to purchase (e.g. 1, 4, 8, 24). When set, uses hourly pricing instead of per-GB. */
  hours?: number;
  /** Prefer hourly sessions when cheaper than per-GB (default: false). Ignored when hours is explicitly set. */
  preferHourly?: boolean;
  /** Path to v2ray binary (auto-detected if missing) */
  v2rayExePath?: string;
  /** Route ALL traffic through VPN (default: true). Set false for split tunnel/dev mode. */
  fullTunnel?: boolean;
  /** Specific IPs to route through VPN (overrides fullTunnel) */
  splitIPs?: string[];
  /** Set system SOCKS proxy (default: false — explicit opt-in) */
  systemProxy?: boolean;
  /** Always pay for a new session, skip findExistingSession (default: false) */
  forceNewSession?: boolean;
  /** Progress callback: (step, detail, structuredEntry?) => void */
  onProgress?: (step: string, detail: string, entry?: Record<string, any>) => void;
  /** Logger function (default: console.log) */
  log?: (msg: string) => void;
  /** Override default timeouts (ms) for different operations */
  timeouts?: {
    /** V2Ray SOCKS5 port readiness wait (default: 10000) */
    v2rayReady?: number;
    /** Handshake HTTP request timeout (default: 30000) */
    handshake?: number;
    /** LCD query timeout (default: 15000) */
    lcdQuery?: number;
    /** Node status check timeout (default: 12000) */
    nodeStatus?: number;
  };
  /** AbortSignal for cancelling in-progress connections */
  signal?: AbortSignal;
  /** TLS trust mode: 'tofu' (default, pin on first use) | 'none' (insecure, for testing) */
  tlsTrust?: 'tofu' | 'none';
  /** If false, throw instead of auto-disconnecting when already connected (default: true — auto-reconnect) */
  allowReconnect?: boolean;
  /** Dry-run mode: runs wallet, LCD, node status checks but skips TX broadcast, handshake, and tunnel. For unfunded wallets / UI testing. */
  dryRun?: boolean;
  /** Enable kill switch — blocks all traffic if tunnel drops (default: false) */
  killSwitch?: boolean;
  /**
   * DNS servers for WireGuard tunnel.
   * - Preset name: 'handshake' (default), 'google', 'cloudflare'
   * - Custom array: ['1.2.3.4', '5.6.7.8']
   * Handshake DNS (103.196.38.38/39) is default — decentralized, censorship-resistant.
   */
  dns?: 'handshake' | 'google' | 'cloudflare' | string[];
}

export interface ConnectViaPlanOptions extends Omit<ConnectOptions, 'gigabytes' | 'forceNewSession'> {
  /** Plan ID to subscribe to */
  planId: number | string | bigint;
  /**
   * Plan owner's address (sent1...) to use as fee granter.
   * When set, the TX includes fee.granter so the plan operator pays gas.
   * If the grant doesn't exist on-chain, falls back to user-paid gas.
   * The app should set this to the plan owner's address — the plan operator
   * is responsible for issuing fee grants to subscribers.
   */
  feeGranter?: string;
}

export interface ConnectResult {
  /** Session ID as string (safe for JSON.stringify — no BigInt serialization errors) */
  sessionId: string;
  serviceType: 'wireguard' | 'v2ray';
  nodeAddress: string;
  /** SOCKS5 proxy port (V2Ray only) */
  socksPort?: number;
  /** WireGuard tunnel name (WireGuard only) */
  wgTunnelName?: string;
  /** WireGuard config file path (WireGuard only) */
  confPath?: string;
  /** V2Ray process PID (V2Ray only) */
  v2rayPid?: number;
  /** Whether system proxy was set */
  systemProxySet?: boolean;
  /** Disconnect and clean up */
  cleanup: () => Promise<void>;
  /** Present and true when dryRun was used */
  dryRun?: boolean;
  /** Wallet address (dry-run only) */
  walletAddress?: string;
  /** Node moniker (dry-run only) */
  nodeMoniker?: string;
  /** Node location (dry-run only) */
  nodeLocation?: { city: string; country: string };
  /** RPC endpoint used (dry-run only) */
  rpcUsed?: string;
  /** LCD endpoint used (dry-run only) */
  lcdUsed?: string;
}

export interface ConnectionStatus {
  connected: boolean;
  sessionId: bigint;
  serviceType: 'wireguard' | 'v2ray';
  nodeAddress: string;
  connectedAt: number;
  uptimeMs: number;
  uptimeFormatted: string;
  socksPort?: number;
  /** v25: Health checks for tunnel/proxy liveness */
  healthChecks: {
    tunnelActive: boolean;
    proxyListening: boolean;
    systemProxyValid: boolean;
  };
}

export interface ListNodesOptions {
  /** LCD URL (default: cascading fallback) */
  lcdUrl?: string;
  /** Maximum nodes to probe (default: 100). Set higher to discover more of the network. */
  maxNodes?: number;
  /** Filter by service type: 'wireguard' | 'v2ray' | null */
  serviceType?: string | null;
  /** Concurrency for node probing (default: 30) */
  concurrency?: number;
  /** Progress callback: called after each batch of nodes is probed */
  onNodeProbed?: (progress: { total: number; probed: number; online: number }) => void;
  /** Skip quality-score sorting (default: false) */
  skipSort?: boolean;
  /** Bypass 5-minute node cache and force fresh scan (default: false) */
  noCache?: boolean;
  /** Skip cache entirely and wait for fresh results (default: false) */
  waitForFresh?: boolean;
}

export interface ScoredNode {
  address: string;
  remoteUrl: string;
  serviceType: string;
  moniker: string;
  country: string;
  city: string;
  peers: number;
  clockDriftSec: number | null;
  qualityScore: number;
  gigabytePrices: Array<{ denom: string; base_value: string; quote_value: string }>;
  hourlyPrices: Array<{ denom: string; base_value: string; quote_value: string }>;
}

/** Connect to a Sentinel dVPN node (alias for connectDirect) */
export function connect(opts: ConnectOptions): Promise<ConnectResult>;
/** Connect directly to a Sentinel dVPN node */
export function connectDirect(opts: ConnectOptions): Promise<ConnectResult>;
/** Connect via a subscription plan */
export function connectViaPlan(opts: ConnectViaPlanOptions): Promise<ConnectResult>;
/** Connect via an existing subscription */
export function connectViaSubscription(opts: ConnectOptions & { subscriptionId: number | string | bigint }): Promise<ConnectResult>;
/** List online nodes, sorted by quality score */
export function listNodes(options?: ListNodesOptions): Promise<ScoredNode[]>;
/** List online nodes, sorted by quality score */
export function queryOnlineNodes(options?: ListNodesOptions): Promise<ScoredNode[]>;
/** Fetch ALL active nodes from LCD — no per-node status checks, instant. Returns 900+ nodes. */
export function fetchAllNodes(options?: { lcdUrl?: string }): Promise<Array<{
  address: string;
  remote_url: string;
  gigabyte_prices: Array<{ denom: string; base_value: string; quote_value: string }>;
  hourly_prices: Array<{ denom: string; base_value: string; quote_value: string }>;
}>>;
/** Enrich LCD nodes with type/country/city by probing each node's status API */
export function enrichNodes(nodes: any[], options?: {
  concurrency?: number;
  /** Per-node probe timeout in ms (default: 8000) */
  timeout?: number;
  onProgress?: (progress: { total: number; done: number; enriched: number }) => void;
}): Promise<ScoredNode[]>;
/** Build geographic index from enriched nodes for instant country/city lookups */
export function buildNodeIndex(nodes: ScoredNode[]): {
  countries: Record<string, ScoredNode[]>;
  cities: Record<string, ScoredNode[]>;
  stats: {
    totalNodes: number;
    totalCountries: number;
    totalCities: number;
    byCountry: Array<{ country: string; count: number }>;
  };
};
/** Disconnect current VPN tunnel */
export function disconnect(): Promise<void>;
/** Check if a VPN tunnel is currently active */
export function isConnected(): boolean;
/** Check if a connection attempt is currently in progress (mutex held) */
export function isConnecting(): boolean;
/** Get current connection status (null if not connected) */
export function getStatus(): ConnectionStatus | null;
/** Register process exit handlers for clean tunnel shutdown */
export function registerCleanupHandlers(): void;
/** Enable kill switch — blocks all non-tunnel traffic (Windows only) */
export function enableKillSwitch(serverEndpoint: string, tunnelName?: string): void;
/** Disable kill switch — restore normal routing */
export function disableKillSwitch(): void;
/** Check if kill switch is enabled */
export function isKillSwitchEnabled(): boolean;
/** Set system SOCKS proxy (Windows: registry, macOS: networksetup, Linux: gsettings) */
export function setSystemProxy(socksPort: number): void;
/** Clear system SOCKS proxy */
export function clearSystemProxy(): void;
/** Check if a TCP port is free */
export function checkPortFree(port: number): Promise<boolean>;

/** Connect with auto-fallback: tries multiple nodes on failure */
export function connectAuto(opts: ConnectOptions & {
  maxAttempts?: number;
  serviceType?: 'wireguard' | 'v2ray';
  /** Only try nodes in these countries (optional) */
  countries?: string[];
  /** Skip nodes in these countries (optional) */
  excludeCountries?: string[];
  /** Max price in P2P per GB (optional) */
  maxPriceDvpn?: number;
  /** Minimum quality score (optional) */
  minScore?: number;
  /** Per-call circuit breaker config */
  circuitBreaker?: { threshold?: number; ttlMs?: number };
  /** Progress callback during node scan (before connection attempt) */
  onNodeProbed?: (progress: { total: number; probed: number; online: number }) => void;
  /** Restrict auto-connect to these specific node addresses (sentnode1...) */
  nodePool?: string[];
}): Promise<ConnectResult>;

/** Reset the circuit breaker for a node (or all nodes if no address given) */
export function resetCircuitBreaker(address?: string): void;

/** Clear the wallet derivation cache. Call after disconnect to release key material from memory. */
export function clearWalletCache(): void;

/** Clear the node list cache. Next queryOnlineNodes() call will fetch fresh data. */
export function flushNodeCache(): void;

/** Configure circuit breaker thresholds globally. */
export function configureCircuitBreaker(opts?: { threshold?: number; ttlMs?: number }): void;

/** Get circuit breaker status for a node or all nodes. */
export function getCircuitBreakerStatus(address?: string): Record<string, { count: number; lastFail: number; isOpen: boolean }> | { count: number; lastFail: number; isOpen: boolean } | null;

/**
 * Retry handshake on an already-paid session. Use when connect fails AFTER payment.
 * The error.details from a failed connect contains { sessionId, nodeAddress } — pass those here.
 */
export function recoverSession(opts: ConnectOptions & { sessionId: string | bigint }): Promise<ConnectResult>;

/** Connection metrics per node */
export interface ConnectionMetric {
  attempts: number;
  successes: number;
  failures: number;
  successRate: number;
  avgTimeMs: number;
  totalTimeMs: number;
  lastAttempt: number;
}

/** Get connection metrics for observability. */
export function getConnectionMetrics(nodeAddress?: string): Record<string, ConnectionMetric> | ConnectionMetric | null;

/**
 * Create a reusable base config. Override per-call with .with().
 * @example const cfg = createConnectConfig({ mnemonic, rpcUrl }); await connectDirect(cfg.with({ nodeAddress }));
 */
export function createConnectConfig(baseOpts: Partial<ConnectOptions>): Readonly<Partial<ConnectOptions>> & { with(overrides: Partial<ConnectOptions>): ConnectOptions };

/** Pre-flight dependency check result */
export interface DependencyCheck {
  ok: boolean;
  v2ray: {
    available: boolean;
    path: string | null;
    version: string | null;
    error: string | null;
  };
  wireguard: {
    available: boolean;
    path: string | null;
    isAdmin: boolean;
    error: string | null;
  };
  platform: string;
  arch: string;
  nodeVersion: string;
  errors: string[];
}

/**
 * Pre-flight check: verify all required binaries and permissions before connecting.
 * Call at app startup to surface clear errors instead of cryptic ENOENT crashes.
 */
export function verifyDependencies(opts?: { v2rayExePath?: string }): DependencyCheck;

/** Default timeout values used during node connection */
export const DEFAULT_TIMEOUTS: {
  handshake: number;
  nodeStatus: number;
  lcdQuery: number;
  v2rayReady: number;
};

/** Check endpoint health — returns endpoints sorted by latency */
export function checkEndpointHealth(
  endpoints: Array<{ url: string; name: string }>,
  timeoutMs?: number
): Promise<Array<{ url: string; name: string; latencyMs: number | null }>>;

/** Promise-based delay (ms). */
export function sleep(ms: number): Promise<void>;

/** Convert bytes transferred over seconds to Mbps. Pass decimals to round. */
export function bytesToMbps(bytes: number, seconds: number, decimals?: number): number;

// ─── Wallet & Chain ────────────────────────────────────────────────────────

// CosmJS type aliases — use these for autocomplete without requiring @cosmjs/* as a direct dependency.
// If you have @cosmjs installed, these are compatible with the real types.
import type { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import type { SigningStargateClient, DeliverTxResponse } from '@cosmjs/stargate';
import type { StdFee } from '@cosmjs/amino';

export interface WalletResult {
  wallet: DirectSecp256k1HdWallet;
  account: { address: string; algo: string; pubkey: Uint8Array };
}

export interface SafeBroadcaster {
  safeBroadcast: (msgs: any[], memo?: string) => Promise<DeliverTxResponse>;
  getClient: () => Promise<SigningStargateClient>;
  resetClient: () => Promise<SigningStargateClient>;
}

/** Create a Cosmos wallet from mnemonic */
export function createWallet(mnemonic: string): Promise<WalletResult>;
/** Generate a new wallet with a fresh random BIP39 mnemonic */
export function generateWallet(strength?: number): Promise<{ mnemonic: string; wallet: DirectSecp256k1HdWallet; account: { address: string } }>;
/** Derive private key from mnemonic */
export function privKeyFromMnemonic(mnemonic: string): Promise<Uint8Array>;
/** Create a SigningStargateClient */
export function createClient(rpcUrl: string, wallet: DirectSecp256k1HdWallet): Promise<SigningStargateClient>;
/** Broadcast messages to the chain */
export function broadcast(client: SigningStargateClient, signerAddress: string, msgs: any[], fee?: StdFee): Promise<DeliverTxResponse>;
/** Create a safe broadcaster with automatic sequence management */
export function createSafeBroadcaster(rpcUrl: string, wallet: DirectSecp256k1HdWallet, signerAddress: string): SafeBroadcaster;
/** Extract an ID from TX result events */
export function extractId(txResult: DeliverTxResponse, eventPattern: RegExp, keyNames: string[]): string | null;
/** Parse chain error into human-readable message */
export function parseChainError(raw: string): string;
/** Get P2P balance for an address. Returns { udvpn: number (micro-denom), dvpn: number (whole tokens) }. */
export function getBalance(client: SigningStargateClient, address: string): Promise<{ udvpn: number; dvpn: number }>;
/** Standardized price extraction result */
export interface NodePrices {
  gigabyte: { dvpn: number; udvpn: number; raw: { denom: string; base_value: string; quote_value: string } | null };
  hourly: { dvpn: number; udvpn: number; raw: { denom: string; base_value: string; quote_value: string } | null };
  denom: string;
  nodeAddress: string;
}

/**
 * Get standardized prices for a node — abstracts V3 LCD price parsing entirely.
 * Returns human-friendly P2P amounts plus raw objects for TX encoding.
 * Handles quote_value / base_value / amount field variations automatically.
 */
export function getNodePrices(nodeAddress: string, lcdUrl?: string): Promise<NodePrices>;

// ─── Display & Serialization Helpers ──────────────────────────────────────

/**
 * Format a micro-denom (udvpn) amount as a human-readable P2P string.
 * @example formatDvpn(40152030) → "40.15 P2P"
 */
export function formatDvpn(udvpn: number | string, decimals?: number): string;

/**
 * Format a micro-denom (udvpn) amount as a human-readable P2P string.
 * Alias for formatDvpn.
 * @example formatP2P(40152030) → "40.15 P2P"
 */
export function formatP2P(udvpn: number | string, decimals?: number): string;

/**
 * Filter a node list by country, service type, max price, or min quality score.
 * Works with results from listNodes(), enrichNodes(), or fetchAllNodes().
 */
export function filterNodes(nodes: any[], criteria?: {
  country?: string;
  serviceType?: 'wireguard' | 'v2ray';
  maxPriceDvpn?: number;
  minScore?: number;
}): any[];

/**
 * Serialize a ConnectResult for JSON APIs. Converts BigInt → string, strips functions.
 * Without this, JSON.stringify(connectResult) throws "BigInt can't be serialized".
 */
export function serializeResult(result: ConnectResult): Record<string, any>;

/**
 * Validate a BIP39 mnemonic against the English wordlist without throwing.
 * Returns true if the mnemonic has 12+ words, all words are in the BIP39 list,
 * and the checksum is valid. Use this to enable/disable UI controls.
 */
export function isMnemonicValid(mnemonic: string): boolean;

/** Network overview result from getNetworkOverview() */
export interface NetworkOverview {
  totalNodes: number;
  byCountry: Array<{ country: string; count: number }>;
  byType: { wireguard: number; v2ray: number; unknown: number };
  averagePrice: { gigabyteDvpn: number; hourlyDvpn: number };
  nodes: any[];
}

/**
 * Get a quick network overview — total nodes, counts by country/type, average prices.
 * Perfect for dashboard UIs and onboarding screens.
 */
export function getNetworkOverview(lcdUrl?: string): Promise<NetworkOverview>;

/** Get current P2P price in USD */
export function getDvpnPrice(): Promise<number>;
/** Find existing active session for wallet+node pair */
export function findExistingSession(lcdUrl: string, walletAddr: string, nodeAddr: string): Promise<bigint | null>;
/** Fetch active nodes from LCD with pagination */
export function fetchActiveNodes(lcdUrl: string, limit?: number, maxPages?: number): Promise<any[]>;
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
/** Build Sentinel protobuf type registry */
export function buildRegistry(): any;
/** Query LCD endpoint */
export function lcd(baseUrl: string, path: string): Promise<any>;
/** Extract TX response details */
export function txResponse(result: DeliverTxResponse): { ok: boolean; txHash: string; gasUsed: number; gasWanted: number };

// ─── FeeGrant (cosmos.feegrant.v1beta1) ─────────────────────────────────────

export interface FeeGrantOptions {
  /** Max spend in udvpn (number) or array of {denom, amount} */
  spendLimit?: number | Array<{ denom: string; amount: string }>;
  /** Expiration date */
  expiration?: Date | string;
  /** Restrict grant to specific message types */
  allowedMessages?: string[];
}

/** Build a MsgGrantAllowance — granter pays gas for grantee */
export function buildFeeGrantMsg(granter: string, grantee: string, opts?: FeeGrantOptions): { typeUrl: string; value: any };
/** Build a MsgRevokeAllowance */
export function buildRevokeFeeGrantMsg(granter: string, grantee: string): { typeUrl: string; value: any };
/** Query fee grants given to a grantee */
export function queryFeeGrants(lcdUrl: string, grantee: string): Promise<FeeGrantAllowance[]>;
/** Query fee grants issued BY an address (granter lookup) */
export function queryFeeGrantsIssued(lcdUrl: string, granter: string): Promise<FeeGrantAllowance[]>;
/** Query a specific fee grant */
export function queryFeeGrant(lcdUrl: string, granter: string, grantee: string): Promise<any | null>;
/** Broadcast with fee paid by a granter (fee grant) */
export function broadcastWithFeeGrant(client: SigningStargateClient, signerAddress: string, msgs: any[], granterAddress: string, memo?: string): Promise<DeliverTxResponse>;

// ─── Authz (cosmos.authz.v1beta1) ──────────────────────────────────────────

/** Build a MsgGrant for a specific message type */
export function buildAuthzGrantMsg(granter: string, grantee: string, msgTypeUrl: string, expiration?: Date | string): { typeUrl: string; value: any };
/** Build a MsgRevoke to remove an authorization */
export function buildAuthzRevokeMsg(granter: string, grantee: string, msgTypeUrl: string): { typeUrl: string; value: any };
/** Build a MsgExec to execute messages on behalf of a granter */
export function buildAuthzExecMsg(grantee: string, encodedMsgs: Array<{ typeUrl: string; value: Uint8Array }>): { typeUrl: string; value: any };
/** Encode SDK message objects for use in MsgExec */
export function encodeForExec(msgs: Array<{ typeUrl: string; value: any }>): Array<{ typeUrl: string; value: Uint8Array }>;
/** Query authz grants between granter and grantee */
export function queryAuthzGrants(lcdUrl: string, granter: string, grantee: string): Promise<any[]>;

// ─── LCD Query Helpers (v25b) ────────────────────────────────────────────────

/** Single LCD query with timeout, retry, and ChainError wrapping. */
export function lcdQuery(path: string, opts?: {
  lcdUrl?: string;
  timeout?: number;
}): Promise<any>;

/** Auto-paginating LCD query. Returns all items + chain total. */
export function lcdQueryAll(basePath: string, opts?: {
  lcdUrl?: string;
  limit?: number;
  timeout?: number;
  dataKey?: string;
}): Promise<{ items: any[]; total: number | null }>;

// ─── Plan Subscriber Helpers (v25b) ──────────────────────────────────────────

/** Subscription info from LCD */
export interface PlanSubscriber {
  address: string;
  status: number;
  id: string;
  [key: string]: any;
}

/** Query all subscriptions for a plan. Supports owner filtering. */
export function queryPlanSubscribers(planId: number | string, opts?: {
  lcdUrl?: string;
  excludeAddress?: string;
}): Promise<{ subscribers: PlanSubscriber[]; total: number | null }>;

/** Get plan stats with self-subscription filtered out. */
export function getPlanStats(planId: number | string, ownerAddress: string, opts?: {
  lcdUrl?: string;
}): Promise<{ subscriberCount: number; totalOnChain: number | null; ownerSubscribed: boolean }>;

// ─── Fee Grant Workflow Helpers (v25b) ────────────────────────────────────────

/** Grant fee allowance to all plan subscribers who don't already have one. */
export function grantPlanSubscribers(planId: number | string, opts: {
  granterAddress: string;
  lcdUrl?: string;
  grantOpts?: FeeGrantOptions;
}): Promise<{ msgs: Array<{ typeUrl: string; value: any }>; skipped: string[]; newGrants: string[] }>;

/** Expiring grant info */
export interface ExpiringGrant {
  granter: string;
  grantee: string;
  expiresAt: Date | null;
  daysLeft: number | null;
}

/** Find fee grants expiring within N days. */
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
): Promise<{ msgs: Array<{ typeUrl: string; value: any }>; renewed: string[] }>;

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
  on(event: 'expiring', listener: (grant: ExpiringGrant) => void): any;
  on(event: 'expired', listener: (grant: ExpiringGrant) => void): any;
  on(event: 'renew', listener: (data: { msgs: any[]; renewed: string[] }) => void): any;
  on(event: 'error', listener: (err: Error) => void): any;
};

// ─── Missing Functionality (v25c) ────────────────────────────────────────────

/** Query a wallet's active subscriptions */
export function querySubscriptions(lcdUrl: string, walletAddr: string, opts?: { status?: 'active' | 'inactive' }): Promise<{ items: Subscription[]; total: number | null }>;

/** Query session allocation (remaining bandwidth) */
export function querySessionAllocation(lcdUrl: string, sessionId: string | number | bigint): Promise<{
  maxBytes: number;
  usedBytes: number;
  remainingBytes: number;
  percentUsed: number;
} | null>;

/** Fetch a single node by address from LCD */
export function queryNode(nodeAddress: string, opts?: { lcdUrl?: string }): Promise<ChainNode>;

/** Build batch MsgStartSession messages for multiple nodes in one TX */
export function buildBatchStartSession(from: string, nodes: Array<{
  nodeAddress: string;
  gigabytes?: number;
  maxPrice: { denom: string; base_value: string; quote_value: string };
}>): Array<{ typeUrl: string; value: any }>;

/** Build MsgEndSession to close a session early */
export function buildEndSessionMsg(from: string, sessionId: number | string | bigint): { typeUrl: string; value: any };

// ─── v26: Chain Data Types ────────────────────────────────────────────────────

/** Raw subscription from LCD */
export interface Subscription {
  id: string;
  acc_address: string;
  plan_id: string;
  price: { denom: string; base_value: string; quote_value: string } | null;
  renewal_price_policy: string;
  status: string;
  start_at: string;
  status_at: string;
  inactive_at: string;
}

/** Raw session from LCD — data nested under base_session */
export interface ChainSession {
  '@type': string;
  base_session: {
    id: string;
    acc_address: string;
    node_address: string;
    download_bytes: string;
    upload_bytes: string;
    max_bytes: string;
    duration: string;
    max_duration: string;
    status: string;
    start_at: string;
    status_at: string;
    inactive_at: string;
  };
  price?: { denom: string; base_value: string; quote_value: string };
  subscription_id?: string;
}

/** Raw node from LCD — note: remote_addrs (array), NOT remote_url. status is integer (1=active). */
export interface ChainNode {
  address: string;
  remote_addrs: string[];
  remote_url?: string;
  gigabyte_prices: Array<{ denom: string; base_value: string; quote_value: string }>;
  hourly_prices: Array<{ denom: string; base_value: string; quote_value: string }>;
  status: number;
}

/** Provider details from LCD */
export interface Provider {
  address: string;
  name: string;
  identity: string;
  website: string;
  description: string;
  status: number;
}

/** Fee grant allowance from LCD — complex nested @type structure */
export interface FeeGrantAllowance {
  granter: string;
  grantee: string;
  allowance: {
    '@type': string;
    spend_limit?: Array<{ denom: string; amount: string }>;
    expiration?: string;
    basic?: { spend_limit?: Array<{ denom: string; amount: string }>; expiration?: string };
    allowance?: {
      '@type'?: string;
      spend_limit?: Array<{ denom: string; amount: string }>;
      expiration?: string;
      basic?: { spend_limit?: Array<{ denom: string; amount: string }>; expiration?: string };
    };
  };
}

/** Plan metadata from discovery */
export interface DiscoveredPlan {
  id: number;
  subscribers: number;
  nodeCount: number;
  price: { denom: string; base_value: string; quote_value: string } | null;
  hasNodes: boolean;
}

// ─── v26: Field Experience Helpers ────────────────────────────────────────────

/** Query nodes linked to a plan */
export function queryPlanNodes(planId: number | string, lcdUrl?: string): Promise<{ items: ChainNode[]; total: number | null }>;

/** Discover all plans with metadata (subscriber count, node count, price) */
export function discoverPlans(lcdUrl?: string, opts?: {
  maxId?: number;
  batchSize?: number;
  includeEmpty?: boolean;
}): Promise<DiscoveredPlan[]>;

/** Truncate an address for display. Works with sent1, sentprov1, sentnode1. */
export function shortAddress(addr: string, prefixLen?: number, suffixLen?: number): string;

/** Format subscription expiry as relative time (e.g. "23d left", "expired") */
export function formatSubscriptionExpiry(subscription: { inactive_at?: string; status_at?: string }): string;

/** Send P2P tokens to an address */
export function sendTokens(client: SigningStargateClient, fromAddress: string, toAddress: string, amountUdvpn: number | string, memo?: string): Promise<DeliverTxResponse>;

/** Subscribe to a plan. Returns subscription ID from TX events. */
export function subscribeToPlan(client: SigningStargateClient, fromAddress: string, planId: number | string | bigint, denom?: string): Promise<{ subscriptionId: bigint; txHash: string }>;

/** Get provider details by address */
export function getProviderByAddress(provAddress: string, opts?: { lcdUrl?: string }): Promise<Provider | null>;

/** Build batch MsgSend messages for token distribution */
export function buildBatchSend(fromAddress: string, recipients: Array<{ address: string; amountUdvpn: number | string }>): Array<{ typeUrl: string; value: any }>;

/** Build batch MsgLinkNode messages */
export function buildBatchLink(provAddress: string, planId: number | string | bigint, nodeAddresses: string[]): Array<{ typeUrl: string; value: any }>;

/** Decode base64-encoded TX events into readable key-value pairs */
export function decodeTxEvents(events: any[]): Array<{ type: string; attributes: Array<{ key: string; value: string }> }>;

/** Extract ALL session IDs from a batch TX result */
export function extractAllSessionIds(txResult: DeliverTxResponse): bigint[];

/** Estimate gas fee for a batch of messages */
export function estimateBatchFee(msgCount: number, msgType?: 'startSession' | 'feeGrant' | 'send' | 'link'): {
  gas: number;
  amount: number;
  fee: { amount: Array<{ denom: string; amount: string }>; gas: string };
};

/** Estimate the cost of starting a session with a node (supports hourly pricing) */
export function estimateSessionCost(nodeInfo: any, gigabytes?: number, options?: {
  /** Prefer hourly sessions when cheaper than per-GB (default: false) */
  preferHourly?: boolean;
  /** Number of hours for hourly pricing (default: 1) */
  hours?: number;
}): {
  udvpn: number;
  dvpn: number;
  gasUdvpn: number;
  totalUdvpn: number;
  /** Which pricing mode was selected */
  mode: 'gigabyte' | 'hourly';
  /** Per-hour cost in udvpn (null if node has no hourly pricing) */
  hourlyUdvpn: number | null;
  /** Per-GB cost in udvpn (null if node has no GB pricing) */
  gigabyteUdvpn: number | null;
};

/** Compare addresses across bech32 prefixes (sent1 vs sentprov1 vs sentnode1) */
export function isSameKey(addr1: string, addr2: string): boolean;

// ─── v26c: Defensive Pagination ──────────────────────────────────────────────

/** Reusable price entry (denom + base_value + quote_value) */
export interface PriceEntry {
  denom: string;
  base_value: string;
  quote_value: string;
}

/**
 * Paginated LCD query that handles Sentinel's broken pagination.
 * Detects null next_key with full page (truncation) and falls back to single large request.
 */
export function lcdPaginatedSafe(lcdUrl: string, path: string, itemsKey: string, opts?: {
  limit?: number;
  fallbackLimit?: number;
}): Promise<{ items: any[]; total: number }>;

/** List all sessions for a wallet */
export function querySessions(address: string, lcdUrl?: string, opts?: { status?: string }): Promise<{ items: ChainSession[]; total: number }>;

/** Get a single subscription by ID */
export function querySubscription(id: string | number, lcdUrl?: string): Promise<Subscription | null>;

/** Check if wallet has active subscription for a plan */
export function hasActiveSubscription(address: string, planId: number | string, lcdUrl?: string): Promise<{ has: boolean; subscription?: Subscription }>;

/** Format byte count for display */
export function formatBytes(bytes: number): string;

/** Parse chain duration string ("557817.72s" → structured object) */
export function parseChainDuration(durationStr: string): { seconds: number; hours: number; minutes: number; formatted: string };

// ─── v26c: Connection Helpers ────────────────────────────────────────────────

/** Flattened session with base_session fields at top level */
export interface FlatSession {
  id: string;
  acc_address: string;
  node_address: string;
  download_bytes: string;
  upload_bytes: string;
  max_bytes: string;
  duration: string;
  max_duration: string;
  status: string;
  start_at: string;
  status_at: string;
  inactive_at: string;
  price?: { denom: string; base_value: string; quote_value: string };
  subscription_id?: string;
  '@type'?: string;
  _raw: ChainSession;
}

/** Flatten base_session nesting so session.id works (prevents the #1 footgun) */
export function flattenSession(session: ChainSession): FlatSession;

/**
 * One-call VPN connection. Handles deps check, cleanup registration,
 * node selection, connection, and IP verification.
 */
export function quickConnect(opts: ConnectOptions & {
  countries?: string[];
  serviceType?: 'wireguard' | 'v2ray';
  maxAttempts?: number;
}): Promise<ConnectResult & { vpnIp?: string }>;

/** Auto-reconnect on connection loss. Returns { stop() } to cancel. */
export function autoReconnect(opts: ConnectOptions & {
  pollIntervalMs?: number;
  maxRetries?: number;
  backoffMs?: number[];
  onReconnecting?: (attempt: number) => void;
  onReconnected?: (result: ConnectResult) => void;
  onGaveUp?: (errors: Error[]) => void;
}): { stop: () => void };

/** Verify VPN is working by checking public IP */
export function verifyConnection(opts?: { timeoutMs?: number }): Promise<{ working: boolean; vpnIp: string | null; error?: string }>;

// ─── v26c: Error DX ─────────────────────────────────────────────────────────

/** Error severity classification: 'fatal' | 'retryable' | 'recoverable' | 'infrastructure' */
export const ERROR_SEVERITY: Record<string, 'fatal' | 'retryable' | 'recoverable' | 'infrastructure'>;

/** Check if an error should be retried */
export function isRetryable(error: SentinelError | { code: string }): boolean;

/** Map SDK error code to user-friendly message */
export function userMessage(error: SentinelError | { code: string } | string): string;

/** Chain message type URLs (15 Sentinel + 5 Cosmos feegrant/authz) */
export const MSG_TYPES: {
  START_SESSION: string;
  END_SESSION: string;
  START_SUBSCRIPTION: string;
  SUB_START_SESSION: string;
  PLAN_START_SESSION: string;
  CREATE_PLAN: string;
  UPDATE_PLAN_STATUS: string;
  LINK_NODE: string;
  UNLINK_NODE: string;
  REGISTER_PROVIDER: string;
  UPDATE_PROVIDER: string;
  UPDATE_PROVIDER_STATUS: string;
  START_LEASE: string;
  END_LEASE: string;
  GRANT_FEE_ALLOWANCE: string;
  REVOKE_FEE_ALLOWANCE: string;
  AUTHZ_GRANT: string;
  AUTHZ_REVOKE: string;
  AUTHZ_EXEC: string;
};

// ─── Protocol ──────────────────────────────────────────────────────────────

export interface NodeStatus {
  moniker: string;
  type: 'wireguard' | 'v2ray';
  location: { country: string; city: string; country_code: string; latitude: number; longitude: number };
  peers: number;
  bandwidth: { download: number; upload: number };
  qos: { max_peers: number | null };
  clockDriftSec: number | null;
  gigabyte_prices: any[];
  _raw: any;
}

export interface WgKeyPair {
  privateKey: Buffer;
  publicKey: Buffer;
}

export interface HandshakeResult {
  /** IP addresses assigned to our WireGuard interface (e.g. ['10.8.0.2/32']) */
  assignedAddrs: string[];
  /** Server's WireGuard public key (base64) */
  serverPubKey: string;
  /** Server's WireGuard endpoint (e.g. '185.47.255.36:52618') */
  serverEndpoint: string;
  /** Raw JSON config string from node response */
  config: string;
  /** Full handshake response object */
  result: any;
}

export interface V2RayHandshakeResult {
  /** JSON string of V2Ray metadata — pass to buildV2RayClientConfig() as metadataJson parameter */
  config: string;
  /** Full handshake response object */
  result: any;
}

/** Query node status via its REST API */
export function nodeStatusV3(remoteUrl: string, agent?: import('https').Agent): Promise<NodeStatus>;
/** Generate WireGuard keypair (Curve25519) */
export function generateWgKeyPair(): WgKeyPair;
/** Perform WireGuard handshake with node */
export function initHandshakeV3(remoteUrl: string, sessionId: bigint | string | number, cosmosPrivKey: Uint8Array, wgPublicKey: Buffer, agent?: import('https').Agent): Promise<HandshakeResult>;
/** Perform V2Ray handshake with node */
export function initHandshakeV3V2Ray(remoteUrl: string, sessionId: bigint | string | number, cosmosPrivKey: Uint8Array, uuid: string, agent?: import('https').Agent): Promise<V2RayHandshakeResult>;
/** Write WireGuard config file */
export function writeWgConfig(wgPrivKey: Buffer, assignedAddrs: string[], serverPubKey: string, serverEndpoint: string, splitIPs?: string[] | null, opts?: { dns?: string; mtu?: number; keepalive?: number }): string;
/** Build V2Ray client config JSON */
export function buildV2RayClientConfig(serverHost: string, metadataJson: string, uuid: string, socksPort?: number, opts?: { dns?: string; dnsPreset?: string }): object;
/** Generate a V2Ray-compatible UUID */
export function generateV2RayUUID(): string;
/** Extract session ID from handshake response */
export function extractSessionId(hsResult: any): bigint | null;
/** Wait for a TCP port to become available. Returns true if port is ready, false if timeout. */
export function waitForPort(port: number, timeoutMs?: number, host?: string, intervalMs?: number): Promise<boolean>;
/** Validate an IP/CIDR string (e.g. "10.8.0.2/24"). Returns true if valid. */
export function validateCIDR(cidr: string): boolean;

// ─── Session Message Encoders ──────────────────────────────────────────────

/** Encode MsgStartSession (sentinel.session.v3) */
export function encodeMsgStartSession(params: { from: string; node_address: string; gigabytes?: number; hours?: number; max_price?: any }): Uint8Array;
/** Encode MsgEndSession (sentinel.session.v3) */
export function encodeMsgEndSession(params: { from: string; id: number | bigint; rating?: number }): Uint8Array;
/** Encode MsgStartSubscription (sentinel.subscription.v3) */
export function encodeMsgStartSubscription(params: { from: string; id: number | bigint; denom?: string; renewalPricePolicy?: number }): Uint8Array;
/** Encode MsgSubStartSession (sentinel.subscription.v3) */
export function encodeMsgSubStartSession(params: { from: string; id: number | bigint; nodeAddress: string }): Uint8Array;

// ─── WireGuard ─────────────────────────────────────────────────────────────

/** Install and activate a WireGuard tunnel */
export function installWgTunnel(confPath: string): Promise<string>;
/** Uninstall a WireGuard tunnel */
export function uninstallWgTunnel(tunnelName?: string): Promise<void>;
/** Legacy: connect WireGuard from instance */
export function connectWireGuard(wgInstance: any): Promise<string>;
/** Legacy: disconnect WireGuard */
export function disconnectWireGuard(): Promise<void>;
/** Emergency force-kill all sentinel WireGuard tunnels (sync, safe in exit handlers) */
export function emergencyCleanupSync(): void;
/** Check if a tunnel is currently active */
export function watchdogCheck(): { active: boolean; name?: string; uptimeMs?: number };
/** Whether the current process is running as admin/root */
export const IS_ADMIN: boolean;
/** Path to wireguard.exe (Windows) or null */
export const WG_EXE: string | null;
/** Path to wg-quick (Linux/macOS) or null */
export const WG_QUICK: string | null;
/** Whether WireGuard is available on this system */
export const WG_AVAILABLE: boolean;

// ─── Speed Testing ─────────────────────────────────────────────────────────

export interface SpeedResult {
  mbps: number;
  chunks: number;
  adaptive: string;
  totalBytes?: number;
  seconds?: number;
  fallbackHost?: string;
}

/** Run speed test directly (no VPN) */
export function speedtestDirect(): Promise<SpeedResult>;
/** Run speed test through SOCKS5 proxy (V2Ray tunnel) */
export function speedtestViaSocks5(testMb?: number, proxyPort?: number, socksAuth?: { user: string; pass: string } | null): Promise<SpeedResult>;
/** Resolve Cloudflare speedtest IPs for split tunneling */
export function resolveSpeedtestIPs(): Promise<string[]>;

/** Flush cached DNS resolutions. Call when switching VPN connections. */
export function flushSpeedTestDnsCache(): void;

/** Compare two speed test results. Returns delta and improvement/degradation. */
export function compareSpeedTests(before: SpeedResult, after: SpeedResult): {
  improved: boolean;
  degraded: boolean;
  delta: { downloadMbps: number; uploadMbps: number; latencyMs: number };
  percentChange: { download: number; upload: number };
};

/** Speed test configuration constants (read-only). */
export const SPEEDTEST_DEFAULTS: Readonly<{
  chunkBytes: number;
  chunkCount: number;
  probeBytes: number;
  probeThresholdMbps: number;
  primaryHost: string;
  dnsCacheTtl: number;
  fallbackHosts: ReadonlyArray<{ host: string; path: string; size: number }>;
}>;

// ─── Plan & Provider Message Encoders ──────────────────────────────────────

export interface PriceParam {
  denom: string;
  base_value: string | number;
  quote_value: string | number;
}

/** Encode MsgRegisterProviderRequest */
export function encodeMsgRegisterProvider(params: { from: string; name: string; identity?: string; website?: string; description?: string }): Uint8Array;
/** Encode MsgUpdateProviderDetailsRequest */
export function encodeMsgUpdateProviderDetails(params: { from: string; name?: string; identity?: string; website?: string; description?: string }): Uint8Array;
/** Encode MsgUpdateProviderStatusRequest */
export function encodeMsgUpdateProviderStatus(params: { from: string; status: number }): Uint8Array;
/** Encode MsgCreatePlanRequest */
export function encodeMsgCreatePlan(params: { from: string; bytes?: string; duration?: number | { seconds: number; nanos?: number }; prices?: PriceParam[]; isPrivate?: boolean }): Uint8Array;
/** Encode MsgUpdatePlanStatusRequest */
export function encodeMsgUpdatePlanStatus(params: { from: string; id: number | bigint; status: number }): Uint8Array;
/** Encode MsgLinkNodeRequest */
export function encodeMsgLinkNode(params: { from: string; id: number | bigint; nodeAddress: string }): Uint8Array;
/** Encode MsgUnlinkNodeRequest */
export function encodeMsgUnlinkNode(params: { from: string; id: number | bigint; nodeAddress: string }): Uint8Array;
/** Encode MsgStartSessionRequest (plan subscribe + session in one TX) */
export function encodeMsgPlanStartSession(params: { from: string; id: number | bigint; denom?: string; renewalPricePolicy?: number; nodeAddress?: string }): Uint8Array;
/** Encode MsgStartLeaseRequest */
export function encodeMsgStartLease(params: { from: string; nodeAddress: string; hours: number; maxPrice?: PriceParam; renewalPricePolicy?: number }): Uint8Array;
/** Encode MsgEndLeaseRequest */
export function encodeMsgEndLease(params: { from: string; id: number | bigint }): Uint8Array;
/** Encode sentinel.types.v1.Price */
export function encodePrice(params: PriceParam): Buffer;
/** Encode google.protobuf.Duration */
export function encodeDuration(params: { seconds: number; nanos?: number }): Buffer;
/** Convert sdk.Dec string to scaled integer string (multiply by 10^18) */
export function decToScaledInt(decStr: string): string;

// ─── State Persistence ─────────────────────────────────────────────────────

export interface SDKState {
  sessionId?: string;
  serviceType?: 'wireguard' | 'v2ray';
  wgTunnelName?: string;
  v2rayPid?: number;
  socksPort?: number;
  systemProxySet?: boolean;
  nodeAddress?: string;
  confPath?: string;
  savedAt?: string;
  pid?: number;
}

export interface RecoverResult {
  hadState: boolean;
  cleaned: string[];
}

export interface PidCheck {
  running: boolean;
  pid?: number;
  startedAt?: string;
}

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
export function getSessionHistory(): Record<string, any>;
/** Write a PID file for process management */
export function writePidFile(name?: string): { pidFile: string };
/** Check if a process with a PID file is running */
export function checkPidFile(name?: string): PidCheck;
/** Clear a PID file */
export function clearPidFile(name?: string): void;

// ─── Credential Cache ──────────────────────────────────────────────────────

export interface SavedCredentials {
  sessionId: string;
  serviceType: 'wireguard' | 'v2ray';
  wgPrivateKey?: string;
  wgServerPubKey?: string;
  wgAssignedAddrs?: string[];
  wgServerEndpoint?: string;
  v2rayUuid?: string;
  v2rayConfig?: string;
  savedAt: string;
}

/** Save handshake credentials for a node+session pair (enables fast reconnect) */
export function saveCredentials(nodeAddress: string, sessionId: string, credentials: Record<string, any>): void;
/** Load saved credentials for a node (null if none) */
export function loadCredentials(nodeAddress: string): SavedCredentials | null;
/** Clear saved credentials for a specific node */
export function clearCredentials(nodeAddress: string): void;
/** Clear all saved credentials */
export function clearAllCredentials(): void;
/** Attempt fast reconnect using saved credentials. Returns null if unavailable or expired. */
export function tryFastReconnect(opts: ConnectOptions): Promise<ConnectResult | null>;

// ─── VPN Settings Persistence ──────────────────────────────────────────────

/** Load persisted VPN settings from ~/.sentinel-sdk/settings.json */
export function loadVpnSettings(): Record<string, any>;
/** Save VPN settings to ~/.sentinel-sdk/settings.json */
export function saveVpnSettings(settings: Record<string, any>): void;

// ─── Defaults & Constants ──────────────────────────────────────────────────

export interface Endpoint {
  url: string;
  name: string;
  verified: string;
}

export interface FallbackResult<T> {
  result: T;
  endpoint: string;
  endpointName: string;
}

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

export const TRANSPORT_SUCCESS_RATES: Record<string, { rate: number; sample: number; note: string }>;

export const BROKEN_NODES: Array<{ address: string; reason: string; verified: string }>;

export const PRICING_REFERENCE: {
  verified: string;
  note: string;
  session: { typicalCostDvpn: number; minBalanceDvpn: number; minBalanceUdvpn: number };
  gasPerMsg: Record<string, number>;
  [key: string]: any;
};

/** Try an operation across multiple endpoints with fallback */
export function tryWithFallback<T>(
  endpoints: Endpoint[],
  operation: (url: string) => Promise<T>,
  label?: string,
): Promise<FallbackResult<T>>;

// ─── Dynamic Transport Rate Tracking ─────────────────────────────────────────

/** Record a transport connection success/failure (called automatically by setupV2Ray) */
export function recordTransportResult(transportKey: string, success: boolean): void;
/** Get dynamic success rate for a transport (null if < 2 samples) */
export function getDynamicRate(transportKey: string): number | null;
/** Get all dynamic rates */
export function getDynamicRates(): Record<string, { rate: number; sample: number }>;
/** Clear all dynamic rate data. Pass true to also clear persisted data on disk. */
export function resetDynamicRates(persist?: boolean): void;

// ─── DNS Presets ────────────────────────────────────────────────────────────

interface DnsPreset {
  name: string;
  servers: string[];
  description: string;
}

/** DNS server presets. Handshake is default (censorship-resistant). */
export const DNS_PRESETS: Readonly<{
  handshake: DnsPreset;
  google: DnsPreset;
  cloudflare: DnsPreset;
}>;

/** Default DNS preset name ('handshake') */
export const DEFAULT_DNS_PRESET: string;

/** Fallback order when primary DNS fails: handshake → google → cloudflare */
export const DNS_FALLBACK_ORDER: string[];

/**
 * Resolve a DNS option into a comma-separated string for WireGuard/V2Ray config.
 * Includes fallback DNS servers — if the primary fails, the OS tries the next ones.
 * @param dns - Preset name, array of custom IPs, or undefined for default (Handshake)
 */
export function resolveDnsServers(dns?: string | string[]): string;

// ─── Session Manager ────────────────────────────────────────────────────────

/** Manages session lifecycle (start, monitor, end) for a single node connection. */
export class SessionManager {
  constructor(opts?: { lcdUrl?: string; pollIntervalMs?: number });
  start(sessionId: bigint | string, nodeAddress: string): void;
  stop(): void;
}

// ─── Batch Session Operations ──────────────────────────────────────────────

/** Start sessions on multiple nodes in one batch TX. */
export function batchStartSessions(opts: {
  mnemonic: string;
  rpcUrl?: string;
  lcdUrl?: string;
  nodes: Array<{ nodeAddress: string; gigabytes?: number; maxPrice?: { denom: string; base_value: string; quote_value: string } }>;
}): Promise<{ txHash: string; sessionIds: bigint[] }>;

/** Wait for batch sessions to appear on LCD. */
export function waitForBatchSessions(sessionIds: bigint[], opts?: {
  lcdUrl?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<Array<{ sessionId: bigint; status: string }>>;

/** Wait for a single session to become active on LCD. */
export function waitForSessionActive(sessionId: bigint | string | number, opts?: {
  lcdUrl?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<boolean>;

// ─── DNS Leak Prevention ────────────────────────────────────────────────────

/** Enable DNS leak prevention (forces DNS through tunnel) */
export function enableDnsLeakPrevention(dnsServer?: string): void;
/** Disable DNS leak prevention (restore original DNS settings) */
export function disableDnsLeakPrevention(): void;

// ─── Pre-Flight System Check ────────────────────────────────────────────────

interface PreflightIssue {
  severity: 'error' | 'warning' | 'info';
  component: 'wireguard' | 'v2ray' | 'protocols' | 'system';
  message: string;
  detail: string;
  action: string;
  autoFix: boolean;
}

interface PreflightReport {
  ok: boolean;
  ready: { wireguard: boolean; v2ray: boolean; anyProtocol: boolean };
  issues: PreflightIssue[];
  summary: string;
}

/**
 * Complete pre-flight system check. Run at app startup.
 * Detects: missing binaries, admin permissions, orphaned tunnels,
 * orphaned V2Ray, conflicting VPNs, port conflicts.
 */
export function preflight(opts?: { autoClean?: boolean; v2rayExePath?: string }): PreflightReport;

/** Check for orphaned WireGuard tunnels from previous crashes. */
export function checkOrphanedTunnels(): { found: boolean; tunnels: string[]; cleaned: boolean };

/** Remove orphaned WireGuard tunnels. */
export function cleanOrphanedTunnels(): { cleaned: number; errors: string[] };

/** Check for orphaned V2Ray processes. */
export function checkOrphanedV2Ray(): { found: boolean; pids: number[] };

/** Detect running VPN software that may conflict. */
export function checkVpnConflicts(): { conflicts: Array<{ name: string; running: boolean }> };

/** Check if common V2Ray SOCKS5 ports are in use. */
export function checkPortConflicts(): { conflicts: Array<{ port: number; inUse: boolean }> };

// ─── App Types ─────────────────────────────────────────────────────────────

/**
 * Three types of dVPN applications:
 * - WHITE_LABEL: Branded app with pre-loaded plan + fee grant. Users click "Connect", done.
 * - DIRECT_P2P: Users browse nodes, pick pricing (GB/hour), pay per session.
 * - ALL_IN_ONE: Plan subscriptions + direct P2P. Full flexibility.
 */
export const APP_TYPES: Readonly<{
  WHITE_LABEL: 'white_label';
  DIRECT_P2P: 'direct_p2p';
  ALL_IN_ONE: 'all_in_one';
}>;

interface AppTypeScreens {
  welcome: boolean;
  planBrowser: boolean;
  nodeBrowser: boolean;
  durationPicker: boolean;
  pricingDisplay: boolean;
  connect: boolean;
  settings: boolean;
}

interface AppTypeInfo {
  description: string;
  requiredConfig: string[];
  optionalConfig: string[];
  connectFunction: string;
  userPaysGas: boolean;
  userPicksNode: boolean;
  userPicksDuration: boolean;
  userSeesPricing: boolean;
  screens: AppTypeScreens;
  flow: string[];
  sdkFunctions: string[];
}

/** Per-type configuration, UI requirements, flows, and SDK function lists. */
export const APP_TYPE_CONFIG: Readonly<Record<string, AppTypeInfo>>;

interface AppConfigValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  type: AppTypeInfo | null;
}

/** Validate app config against type requirements. Call at startup. */
export function validateAppConfig(appType: string, config?: Record<string, any>): AppConfigValidation;

/** Get recommended connect options for an app type. Spread into your connect call. */
export function getConnectDefaults(appType: string, appConfig?: Record<string, any>): Record<string, any>;

// ─── App Builder Helpers ────────────────────────────────────────────────────

/** Country name → ISO code map (80+ countries, includes chain variants). */
export const COUNTRY_MAP: Readonly<Record<string, string>>;

/** Convert country name to ISO 3166-1 alpha-2 code. Handles variants + fuzzy matching. */
export function countryNameToCode(name: string | null | undefined): string | null;

/** Get flag PNG URL from flagcdn.com (for native apps where emoji flags don't render). */
export function getFlagUrl(code: string, width?: number): string;

/** Get emoji flag for web apps (regional indicator symbols). Does NOT work in WPF. */
export function getFlagEmoji(code: string): string;

/** Format a raw udvpn amount to human-readable P2P price string. */
export function formatPriceP2P(udvpnAmount: string | number, decimals?: number): string;

interface NodePricing {
  perGb: string | null;
  perHour: string | null;
  cheapest: 'gb' | 'hour' | null;
  gbRaw: number | null;
  hrRaw: number | null;
}

/** Format both GB and hourly prices from a chain node for UI display. */
export function formatNodePricing(node: any): NodePricing;

interface SessionCostEstimate {
  cost: string;
  costUdvpn: number;
  model: string;
  amount: number;
  unit: string;
}

/** Estimate session cost for a given duration/amount and pricing model. */
export function estimateSessionPrice(node: any, model: 'gb' | 'hour', amount: number): SessionCostEstimate;

interface NodeDisplay {
  address: string;
  moniker: string | null;
  country: string | null;
  countryCode: string | null;
  city: string | null;
  flagUrl: string | null;
  flagEmoji: string;
  serviceType: string | null;
  protocol: 'WG' | 'V2' | null;
  pricing: NodePricing;
  peers: number;
  maxPeers: number;
  version: string | null;
  online: boolean;
}

/** Build a display-ready node object combining chain data + status enrichment. */
export function buildNodeDisplay(chainNode: any, status?: any): NodeDisplay;

interface CountryGroup {
  country: string;
  countryCode: string;
  flagUrl: string;
  flagEmoji: string;
  nodes: NodeDisplay[];
  onlineCount: number;
  totalCount: number;
}

/** Group nodes by country for sidebar display. Sorted by online count, unknown last. */
export function groupNodesByCountry(nodes: NodeDisplay[]): CountryGroup[];

/** Common hour options for hourly session selection UI: [1, 2, 4, 8, 12, 24]. */
export const HOUR_OPTIONS: number[];

/** Common GB options for per-GB session selection UI: [1, 2, 5, 10, 25, 50]. */
export const GB_OPTIONS: number[];

// ─── SentinelClient (Instantiable) ─────────────────────────────────────────

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
  timeouts?: ConnectOptions['timeouts'];
  /** Default fullTunnel setting */
  fullTunnel?: boolean;
  /** Default systemProxy setting */
  systemProxy?: boolean;
}

/**
 * Instantiable SDK client with per-instance state, DI, and EventEmitter.
 *
 * Addresses the "global singleton" finding from Meta/Telegram audits.
 * Each instance has its own EventEmitter, cached wallet/client, and
 * default options that merge with per-call overrides.
 *
 * LIMITATION: WireGuard and V2Ray tunnels are OS-level singletons.
 * Only one client can have an active tunnel at a time.
 */

/** Per-instance tunnel state for SentinelClient. */
export class ConnectionState {
  v2rayProc: any;
  wgTunnel: string | null;
  connection: any;
  systemProxy: boolean;
  savedProxyState: any;
  /** @internal Stored for session-end TX on disconnect. Cleared after use. */
  _mnemonic: string | null;
  readonly isConnected: boolean;
  destroy(): void;
}

/** Disconnect a specific connection state (used by SentinelClient internally). */
export function disconnectState(state: ConnectionState): Promise<void>;

export class SentinelClient extends EventEmitter {
  constructor(opts?: SentinelClientOptions);

  /** Connect to a node (pay per GB). Options merged with constructor defaults. */
  connect(opts?: Partial<ConnectOptions>): Promise<ConnectResult>;
  /** Connect with auto-fallback: picks best node, retries on failure. Recommended for most apps. */
  autoConnect(opts?: Partial<ConnectOptions> & { maxAttempts?: number; serviceType?: 'wireguard' | 'v2ray'; onNodeProbed?: (progress: { total: number; probed: number; online: number }) => void }): Promise<ConnectResult>;
  /** Connect via plan subscription. Options merged with constructor defaults. */
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

  /** Create or return cached wallet */
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
