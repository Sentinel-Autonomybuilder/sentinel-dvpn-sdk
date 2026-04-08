/**
 * Sentinel SDK — Connection Types
 *
 * Types for connecting, disconnecting, and managing VPN connections.
 * Covers: direct connect, plan connect, auto connect, reconnect,
 * circuit breaker, kill switch, and connection state.
 */

import type { EventEmitter } from 'events';
import type { ErrorCode, SentinelError } from './errors.js';

// ─── Connect Options ───────────────────────────────────────────────────────

/**
 * Options for connectDirect() / connect().
 * Only `mnemonic` and `nodeAddress` are required for basic usage.
 */
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
  /** Set system SOCKS proxy (default: false -- explicit opt-in) */
  systemProxy?: boolean;
  /** Always pay for a new session, skip findExistingSession (default: false) */
  forceNewSession?: boolean;
  /**
   * Progress callback. Called at each major step of connection.
   * @param step - Step name (e.g. 'wallet', 'balance', 'subscribe', 'handshake', 'tunnel')
   * @param detail - Human-readable description
   * @param entry - Optional structured entry with extra fields
   */
  onProgress?: (step: string, detail: string, entry?: Record<string, unknown>) => void;
  /** Logger function (default: console.log). Set to (() => {}) to suppress. */
  log?: (msg: string) => void;
  /** Override default timeouts (ms) for different operations */
  timeouts?: ConnectionTimeouts;
  /** AbortSignal for cancelling in-progress connections */
  signal?: AbortSignal;
  /** TLS trust mode: 'tofu' (default, pin on first use) | 'none' (insecure, for testing) */
  tlsTrust?: 'tofu' | 'none';
  /** If false, throw instead of auto-disconnecting when already connected (default: true) */
  allowReconnect?: boolean;
  /**
   * Dry-run mode: runs wallet, LCD, node status checks but skips TX broadcast,
   * handshake, and tunnel. For unfunded wallets / UI testing.
   */
  dryRun?: boolean;
  /** Enable kill switch -- blocks all traffic if tunnel drops (default: false) */
  killSwitch?: boolean;
  /**
   * DNS servers for WireGuard tunnel.
   * - Preset name: 'handshake' (default), 'google', 'cloudflare'
   * - Custom array: ['1.2.3.4', '5.6.7.8']
   * Handshake DNS (103.196.38.38/39) is default -- decentralized, censorship-resistant.
   */
  dns?: 'handshake' | 'google' | 'cloudflare' | string[];
}

/** Timeout overrides for connection operations (all values in ms). */
export interface ConnectionTimeouts {
  /** V2Ray SOCKS5 port readiness wait (default: 10000) */
  v2rayReady?: number;
  /** Handshake HTTP request timeout (default: 90000). Overloaded nodes need 60-90s. */
  handshake?: number;
  /** LCD query timeout (default: 15000) */
  lcdQuery?: number;
  /** Node status check timeout (default: 12000) */
  nodeStatus?: number;
}

/**
 * Options for connectViaPlan().
 * Extends ConnectOptions but replaces gigabytes/forceNewSession with planId.
 */
export interface ConnectViaPlanOptions extends Omit<ConnectOptions, 'gigabytes' | 'forceNewSession'> {
  /** Plan ID to subscribe to */
  planId: number | string | bigint;
  /**
   * Plan owner's address (sent1...) to use as fee granter.
   * When set, the TX includes fee.granter so the plan operator pays gas.
   * If the grant doesn't exist on-chain, falls back to user-paid gas.
   */
  feeGranter?: string;
}

/**
 * Options for connectAuto().
 * Extends ConnectOptions with filtering and retry configuration.
 * nodeAddress is NOT required -- auto-connect picks the best node.
 */
export interface ConnectAutoOptions extends Omit<ConnectOptions, 'nodeAddress'> {
  /** sentnode1... address -- optional, overrides auto-selection */
  nodeAddress?: string;
  /** Maximum connection attempts across different nodes (default: 3) */
  maxAttempts?: number;
  /** Preferred service type filter */
  serviceType?: 'wireguard' | 'v2ray';
  /** Only try nodes in these countries (ISO codes, e.g. ['US', 'DE']) */
  countries?: string[];
  /** Skip nodes in these countries */
  excludeCountries?: string[];
  /** Max price in P2P per GB -- nodes above this are skipped */
  maxPriceDvpn?: number;
  /** Minimum quality score (0-100) for node selection */
  minScore?: number;
  /** Per-call circuit breaker config override */
  circuitBreaker?: CircuitBreakerConfig;
  /** Progress callback during node scan (before connection attempt) */
  onNodeProbed?: (progress: { total: number; probed: number; online: number }) => void;
  /** Restrict auto-connect to these specific node addresses (sentnode1...) */
  nodePool?: string[];
}

// ─── Connect Results ───────────────────────────────────────────────────────

/** Result from connect(), connectDirect(), connectViaPlan(), connectAuto(). */
export interface ConnectResult {
  /** Session ID as string (safe for JSON.stringify -- no BigInt serialization errors) */
  sessionId: string;
  /** Protocol used for this connection */
  serviceType: 'wireguard' | 'v2ray';
  /** sentnode1... address of the connected node */
  nodeAddress: string;
  /** SOCKS5 proxy port (V2Ray only). Use for HTTP requests through the tunnel. */
  socksPort?: number;
  /** WireGuard tunnel name (WireGuard only). Used for tunnel management. */
  wgTunnelName?: string;
  /** WireGuard config file path (WireGuard only) */
  confPath?: string;
  /** V2Ray process PID (V2Ray only). Can be used to monitor the process. */
  v2rayPid?: number;
  /** Whether system SOCKS proxy was configured */
  systemProxySet?: boolean;
  /** Disconnect and clean up all resources. Call this when done. */
  cleanup: () => Promise<void>;
  /** Present and true when dryRun was used -- no actual tunnel was created */
  dryRun?: boolean;
  /** Wallet address (dry-run only) */
  walletAddress?: string;
  /** Node moniker/name (dry-run only) */
  nodeMoniker?: string;
  /** Node location (dry-run only) */
  nodeLocation?: { city: string; country: string };
  /** RPC endpoint used (dry-run only) */
  rpcUsed?: string;
  /** LCD endpoint used (dry-run only) */
  lcdUsed?: string;
}

/** Result from disconnect(). */
export interface DisconnectResult {
  /** Whether a tunnel was actually cleaned up */
  disconnected: boolean;
}

// ─── Connection Status ─────────────────────────────────────────────────────

/** Current connection status from getStatus(). null if not connected. */
export interface ConnectionStatus {
  /** Whether a VPN tunnel is currently active */
  connected: boolean;
  /** Active session ID */
  sessionId: bigint;
  /** Protocol in use */
  serviceType: 'wireguard' | 'v2ray';
  /** Connected node address */
  nodeAddress: string;
  /** Timestamp when connection was established (Date.now()) */
  connectedAt: number;
  /** Connection uptime in milliseconds */
  uptimeMs: number;
  /** Human-readable uptime (e.g. "2h 15m 30s") */
  uptimeFormatted: string;
  /** SOCKS5 port (V2Ray only) */
  socksPort?: number;
  /** Health checks for tunnel/proxy liveness */
  healthChecks: {
    /** Whether the tunnel interface/process is alive */
    tunnelActive: boolean;
    /** Whether the SOCKS5 proxy port is listening (V2Ray only) */
    proxyListening: boolean;
    /** Whether system proxy settings are valid */
    systemProxyValid: boolean;
  };
}

// ─── Connection Verification ───────────────────────────────────────────────

/** Result from verifyConnection(). */
export interface VerifyResult {
  /** Whether the VPN tunnel is working (IP changed from original) */
  working: boolean;
  /** Public IP address through the VPN tunnel (null if check failed) */
  vpnIp: string | null;
  /** Error message if verification failed */
  error?: string;
}

// ─── Auto Reconnect ────────────────────────────────────────────────────────

/** Options for autoReconnect(). Returns a handle with stop(). */
export interface AutoReconnectOptions extends ConnectOptions {
  /** How often to check connection health in ms (default: 5000) */
  pollIntervalMs?: number;
  /** Max reconnection attempts before giving up (default: 5) */
  maxRetries?: number;
  /** Backoff delays in ms between retries (default: [1000, 2000, 5000, 10000, 30000]) */
  backoffMs?: number[];
  /** Called when a reconnection attempt starts */
  onReconnecting?: (attempt: number) => void;
  /** Called when reconnection succeeds */
  onReconnected?: (result: ConnectResult) => void;
  /** Called when all retries exhausted */
  onGaveUp?: (errors: Error[]) => void;
}

/** Handle returned by autoReconnect(). */
export interface AutoReconnectHandle {
  /** Stop monitoring and reconnecting */
  stop: () => void;
}

// ─── Circuit Breaker ───────────────────────────────────────────────────────

/** Configuration for the per-node circuit breaker. */
export interface CircuitBreakerConfig {
  /**
   * Number of consecutive failures before a node is "open" (skipped).
   * Default: 3
   */
  threshold?: number;
  /**
   * Time in ms before a node's failure count resets (half-open).
   * Default: 300000 (5 minutes)
   */
  ttlMs?: number;
}

/** Status of a circuit breaker for a single node. */
export interface CircuitBreakerStatus {
  /** Number of consecutive failures */
  count: number;
  /** Timestamp of last failure */
  lastFail: number;
  /** Whether the circuit is open (node will be skipped) */
  isOpen: boolean;
}

// ─── Connection Metrics ────────────────────────────────────────────────────

/** Connection metrics for observability (per node). */
export interface ConnectionMetric {
  /** Total connection attempts */
  attempts: number;
  /** Successful connections */
  successes: number;
  /** Failed connections */
  failures: number;
  /** Success rate (0-1) */
  successRate: number;
  /** Average connection time in ms */
  avgTimeMs: number;
  /** Total connection time in ms */
  totalTimeMs: number;
  /** Timestamp of last attempt */
  lastAttempt: number;
}

// ─── Connection State ──────────────────────────────────────────────────────

/**
 * Per-instance tunnel state for SentinelClient.
 * Each SentinelClient instance has its own ConnectionState.
 * LIMITATION: WireGuard and V2Ray are OS-level singletons --
 * only one active tunnel at a time system-wide.
 */
export class ConnectionState {
  /** Active V2Ray process reference (null if not running) */
  v2rayProc: unknown;
  /** Active WireGuard tunnel name (null if not running) */
  wgTunnel: string | null;
  /** Current connection info (null if disconnected) */
  connection: ConnectResult | null;
  /** Whether system SOCKS proxy was set */
  systemProxy: boolean;
  /** Saved proxy state for restoration on disconnect */
  savedProxyState: unknown;
  /** @internal Stored mnemonic for session-end TX on disconnect. Cleared after use. */
  _mnemonic: string | null;
  /** Whether a tunnel is currently active */
  readonly isConnected: boolean;
  /** Remove this state from the global cleanup registry */
  destroy(): void;
}

// ─── SDK Events ────────────────────────────────────────────────────────────

/** Progress entry emitted during connection. */
export interface ProgressEntry {
  /** Step/event name (e.g. 'wallet_created', 'handshake_started') */
  event: string;
  /** Human-readable detail string */
  detail: string;
  /** Timestamp (Date.now()) */
  ts: number;
  /** Additional structured fields vary by event */
  [key: string]: unknown;
}

/** SDK lifecycle event emitter. Subscribe without polling. */
export interface SDKEvents extends EventEmitter {
  on(event: 'connecting', listener: (data: { nodeAddress: string }) => void): this;
  on(event: 'connected', listener: (data: { sessionId: bigint; serviceType: 'wireguard' | 'v2ray'; nodeAddress: string }) => void): this;
  on(event: 'disconnected', listener: (data: { nodeAddress: string; serviceType: string; reason: string }) => void): this;
  on(event: 'error', listener: (err: SentinelError | Error) => void): this;
  on(event: 'progress', listener: (entry: ProgressEntry) => void): this;
  emit(event: 'connecting', data: { nodeAddress: string }): boolean;
  emit(event: 'connected', data: { sessionId: bigint; serviceType: string; nodeAddress: string }): boolean;
  emit(event: 'disconnected', data: { nodeAddress: string; serviceType: string; reason: string }): boolean;
  emit(event: 'error', err: SentinelError | Error): boolean;
  emit(event: 'progress', entry: ProgressEntry): boolean;
}

// ─── Dependency Check ──────────────────────────────────────────────────────

/** Result from verifyDependencies(). Run at app startup. */
export interface DependencyCheck {
  /** Overall pass: true if at least one protocol (WG or V2Ray) is available */
  ok: boolean;
  v2ray: {
    /** Whether v2ray binary was found */
    available: boolean;
    /** Path to v2ray binary (null if not found) */
    path: string | null;
    /** Detected v2ray version string (null if not found) */
    version: string | null;
    /** Error message if detection failed */
    error: string | null;
  };
  wireguard: {
    /** Whether WireGuard tools are installed */
    available: boolean;
    /** Path to wireguard.exe / wg-quick (null if not found) */
    path: string | null;
    /** Whether process is running as admin/root (required for WG) */
    isAdmin: boolean;
    /** Error message if detection failed */
    error: string | null;
  };
  /** Current OS platform */
  platform: string;
  /** CPU architecture */
  arch: string;
  /** Node.js version */
  nodeVersion: string;
  /** Summary of all errors found */
  errors: string[];
}

// ─── Preflight Check ───────────────────────────────────────────────────────

/** Single issue found during preflight check. */
export interface PreflightIssue {
  /** Severity: error = blocks connection, warning = may cause problems, info = informational */
  severity: 'error' | 'warning' | 'info';
  /** Which component has the issue */
  component: 'wireguard' | 'v2ray' | 'protocols' | 'system';
  /** Short description of the issue */
  message: string;
  /** Detailed explanation */
  detail: string;
  /** Suggested action to fix */
  action: string;
  /** Whether the SDK can auto-fix this issue */
  autoFix: boolean;
}

/** Full preflight report from preflight(). */
export interface PreflightReport {
  /** Overall pass: true if at least one protocol is ready */
  ok: boolean;
  /** Per-protocol readiness */
  ready: {
    wireguard: boolean;
    v2ray: boolean;
    /** True if at least WG or V2Ray is available */
    anyProtocol: boolean;
  };
  /** All detected issues */
  issues: PreflightIssue[];
  /** One-line summary suitable for UI display */
  summary: string;
}

// ─── Config Builder ────────────────────────────────────────────────────────

/**
 * Reusable base config. Created by createConnectConfig().
 * Override per-call with .with().
 *
 * @example
 * const cfg = createConnectConfig({ mnemonic, rpcUrl });
 * await connectDirect(cfg.with({ nodeAddress: 'sentnode1...' }));
 */
export interface ConnectConfig extends Readonly<Partial<ConnectOptions>> {
  /** Merge base config with per-call overrides */
  with(overrides: Partial<ConnectOptions>): ConnectOptions;
}
