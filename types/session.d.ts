/**
 * Sentinel SDK — Session Types
 *
 * Types for session management: state persistence, credential caching,
 * session poisoning, payment mode tracking, and session allocation.
 */

// ─── State Persistence ─────────────────────────────────────────────────────

/**
 * Saved connection state for crash recovery.
 * Written to ~/.sentinel-sdk/state.json after successful connection.
 * Read on next startup by recoverOrphans() to clean up leaked resources.
 */
export interface SDKState {
  /** Active session ID (numeric string) */
  sessionId?: string;
  /** Protocol in use */
  serviceType?: 'wireguard' | 'v2ray';
  /** WireGuard tunnel service name (e.g. 'sentinel0') */
  wgTunnelName?: string;
  /** V2Ray process PID */
  v2rayPid?: number;
  /** SOCKS5 proxy port */
  socksPort?: number;
  /** Whether system proxy was modified */
  systemProxySet?: boolean;
  /** Whether kill switch was enabled */
  killSwitchEnabled?: boolean;
  /** Connected node address (sentnode1...) */
  nodeAddress?: string;
  /** WireGuard config file path */
  confPath?: string;
  /** When state was saved (ISO timestamp) */
  savedAt?: string;
  /** Process ID that saved this state */
  pid?: number;
}

/** Result from recoverOrphans(). */
export interface RecoverResult {
  /** Whether any orphaned state was found */
  hadState: boolean;
  /** List of resources that were cleaned up (e.g. 'wg:sentinel0', 'v2ray:12345') */
  cleaned: string[];
}

/** Result from checkPidFile(). */
export interface PidCheck {
  /** Whether the process is still running */
  running: boolean;
  /** PID from the file */
  pid?: number;
  /** When the PID file was written (ISO timestamp) */
  startedAt?: string;
}

// ─── Credential Cache ──────────────────────────────────────────────────────

/**
 * Saved handshake credentials for fast reconnect.
 * Persisted to ~/.sentinel-sdk/ encrypted on disk.
 * Enables reconnecting to a node without redoing the handshake.
 */
export interface SavedCredentials {
  /** Session ID this credential belongs to */
  sessionId: string;
  /** Protocol type */
  serviceType: 'wireguard' | 'v2ray';
  /** WireGuard private key (base64, WG only) */
  wgPrivateKey?: string;
  /** Server's WG public key (base64, WG only) */
  wgServerPubKey?: string;
  /** Assigned IP addresses with CIDR (WG only) */
  wgAssignedAddrs?: string[];
  /** Server's WG endpoint (WG only) */
  wgServerEndpoint?: string;
  /** V2Ray UUID (V2Ray only) */
  v2rayUuid?: string;
  /** V2Ray metadata JSON (V2Ray only) */
  v2rayConfig?: string;
  /** When credentials were saved (ISO timestamp) */
  savedAt: string;
}

// ─── Session Manager ───────────────────────────────────────────────────────

/**
 * Options for SessionManager constructor.
 */
export interface SessionManagerOptions {
  /** Session map cache TTL in ms (default: 300000 = 5 min) */
  mapTtl?: number;
  /** Custom path for credential cache file */
  credentialPath?: string;
  /** Logger function */
  logger?: (msg: string) => void;
}

/**
 * Session map entry (from SessionManager.buildSessionMap).
 * Maps node address to active session info.
 */
export interface SessionMapEntry {
  /** Session ID */
  sessionId: bigint;
  /** Maximum bytes for this session */
  maxBytes: number;
  /** Bytes used so far */
  usedBytes: number;
}

// ─── Session Allocation ────────────────────────────────────────────────────

/**
 * Session allocation stats from computeSessionAllocation() or querySessionAllocation().
 * Shows how much bandwidth has been used and remains.
 */
export interface SessionAllocation {
  /** Total bytes used (download + upload) */
  usedBytes: number;
  /** Maximum bytes allowed for this session */
  maxBytes: number;
  /** Remaining bytes before session expires */
  remainingBytes: number;
  /** Usage percentage (0-100, rounded to 1 decimal) */
  usedPercent: number;
  /** Human-readable used amount (e.g. "1.5 GB") */
  usedDisplay: string;
  /** Human-readable max amount (e.g. "5.0 GB") */
  maxDisplay: string;
  /** Human-readable remaining amount (e.g. "3.5 GB") */
  remainingDisplay: string;
  /** True if session is GB-based (maxDuration is "0s") */
  isGbBased: boolean;
  /** True if session is hourly (maxDuration > "0s") */
  isHourlyBased: boolean;
}

/** Result from querySessionAllocation() (null if session not found). */
export interface QuerySessionAllocationResult {
  /** Maximum bytes allowed */
  maxBytes: number;
  /** Bytes used (download + upload) */
  usedBytes: number;
  /** Remaining bytes */
  remainingBytes: number;
  /** Usage percentage (0-100) */
  percentUsed: number;
}

// ─── Session Payment Mode Tracking ─────────────────────────────────────────

/**
 * Session payment mode. The chain doesn't distinguish GB-based from hourly.
 * This is tracked client-side so apps can show the correct pricing model.
 *
 * - 'gb': Paid per gigabyte (connectDirect with gigabytes param)
 * - 'hour': Paid per hour (connectDirect with hours param)
 * - 'plan': Started via plan subscription (connectViaPlan)
 */
export type SessionPaymentMode = 'gb' | 'hour' | 'plan';

// ─── Session History ───────────────────────────────────────────────────────

/**
 * Session history entry. Tracks both active and poisoned sessions.
 * Stored in ~/.sentinel-sdk/sessions.json.
 */
export interface SessionHistoryEntry {
  /** sentnode1... address */
  nodeAddress: string;
  /** Session status */
  status: 'active' | 'poisoned';
  /** Error message (poisoned sessions only) */
  error?: string;
  /** When the entry was created/updated */
  timestamp: string;
}

// ─── Batch Session Operations ──────────────────────────────────────────────

/** Options for batchStartSessions() (operator/testing tool). */
export interface BatchStartSessionsOptions {
  /** BIP39 mnemonic phrase */
  mnemonic: string;
  /** RPC URL (default: cascading fallback) */
  rpcUrl?: string;
  /** LCD URL (default: cascading fallback) */
  lcdUrl?: string;
  /** Nodes to start sessions on */
  nodes: Array<{
    /** sentnode1... address */
    nodeAddress: string;
    /** GB to purchase (default: 1) */
    gigabytes?: number;
    /** Max acceptable price */
    maxPrice?: { denom: string; base_value: string; quote_value: string };
  }>;
}

/** Result from batchStartSessions(). */
export interface BatchStartResult {
  /** Transaction hash */
  txHash: string;
  /** Session IDs created (one per node) */
  sessionIds: bigint[];
}

/** Status of a batch session (from waitForBatchSessions). */
export interface BatchSessionStatus {
  /** Session ID */
  sessionId: bigint;
  /** Whether the session appeared on LCD */
  status: string;
}

/** Options for waitForBatchSessions(). */
export interface WaitForBatchOptions {
  /** LCD URL */
  lcdUrl?: string;
  /** Max wait time in ms (default: 60000) */
  timeoutMs?: number;
  /** Polling interval in ms (default: 5000) */
  pollIntervalMs?: number;
}

/** Options for waitForSessionActive(). */
export interface WaitForSessionActiveOptions {
  /** LCD URL */
  lcdUrl?: string;
  /** Max wait time in ms (default: 30000) */
  timeoutMs?: number;
  /** Polling interval in ms (default: 3000) */
  pollIntervalMs?: number;
}
