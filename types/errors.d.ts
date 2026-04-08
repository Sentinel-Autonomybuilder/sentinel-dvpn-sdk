/**
 * Sentinel SDK — Error Types
 *
 * Machine-readable error codes, typed error classes, and severity classification.
 * All SDK errors extend SentinelError with a .code property matching ErrorCodes.
 *
 * Usage:
 *   import { SentinelError, ErrorCodes, isRetryable, userMessage } from 'sentinel-dvpn-sdk';
 *   try { await connect(opts); }
 *   catch (e) {
 *     if (e.code === ErrorCodes.V2RAY_ALL_FAILED) trySwitchNode();
 *     if (e instanceof ValidationError) showFormError(e.message);
 *   }
 */

// ─── Error Code Constants ──────────────────────────────────────────────────

/**
 * Machine-readable error code strings.
 * These are a CONTRACT between all SDK languages (JS, C#, Rust, Swift).
 * Use for switch/if checks instead of parsing error.message.
 */
export type ErrorCode =
  // Validation — bad input, user must fix before retrying
  | 'INVALID_OPTIONS'
  | 'INVALID_MNEMONIC'
  | 'INVALID_NODE_ADDRESS'
  | 'INVALID_GIGABYTES'
  | 'INVALID_URL'
  | 'INVALID_PLAN_ID'
  // Node — node-level failures
  | 'NODE_OFFLINE'
  | 'NODE_NO_UDVPN'
  | 'NODE_NOT_FOUND'
  | 'NODE_CLOCK_DRIFT'
  | 'NODE_INACTIVE'
  | 'INVALID_ASSIGNED_IP'
  | 'NODE_DATABASE_CORRUPT'
  // Chain — transaction and query failures
  | 'INSUFFICIENT_BALANCE'
  | 'BROADCAST_FAILED'
  | 'TX_FAILED'
  | 'LCD_ERROR'
  | 'UNKNOWN_MSG_TYPE'
  | 'ALL_ENDPOINTS_FAILED'
  | 'CHAIN_LAG'
  // Session — session lifecycle issues
  | 'SESSION_EXISTS'
  | 'SESSION_EXTRACT_FAILED'
  | 'SESSION_POISONED'
  // Tunnel — VPN tunnel setup/operation failures
  | 'V2RAY_NOT_FOUND'
  | 'V2RAY_ALL_FAILED'
  | 'WG_NOT_AVAILABLE'
  | 'WG_NO_CONNECTIVITY'
  | 'TUNNEL_SETUP_FAILED'
  // Security — TLS and certificate issues
  | 'TLS_CERT_CHANGED'
  // Connection — high-level connection failures
  | 'ABORTED'
  | 'ALL_NODES_FAILED'
  | 'ALREADY_CONNECTED'
  | 'PARTIAL_CONNECTION_FAILED';

/** Frozen map of error code string constants. */
export const ErrorCodes: {
  readonly INVALID_OPTIONS: 'INVALID_OPTIONS';
  readonly INVALID_MNEMONIC: 'INVALID_MNEMONIC';
  readonly INVALID_NODE_ADDRESS: 'INVALID_NODE_ADDRESS';
  readonly INVALID_GIGABYTES: 'INVALID_GIGABYTES';
  readonly INVALID_URL: 'INVALID_URL';
  readonly INVALID_PLAN_ID: 'INVALID_PLAN_ID';
  readonly NODE_OFFLINE: 'NODE_OFFLINE';
  readonly NODE_NO_UDVPN: 'NODE_NO_UDVPN';
  readonly NODE_NOT_FOUND: 'NODE_NOT_FOUND';
  readonly NODE_CLOCK_DRIFT: 'NODE_CLOCK_DRIFT';
  readonly NODE_INACTIVE: 'NODE_INACTIVE';
  readonly INVALID_ASSIGNED_IP: 'INVALID_ASSIGNED_IP';
  readonly NODE_DATABASE_CORRUPT: 'NODE_DATABASE_CORRUPT';
  readonly INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE';
  readonly BROADCAST_FAILED: 'BROADCAST_FAILED';
  readonly TX_FAILED: 'TX_FAILED';
  readonly LCD_ERROR: 'LCD_ERROR';
  readonly UNKNOWN_MSG_TYPE: 'UNKNOWN_MSG_TYPE';
  readonly ALL_ENDPOINTS_FAILED: 'ALL_ENDPOINTS_FAILED';
  readonly CHAIN_LAG: 'CHAIN_LAG';
  readonly SESSION_EXISTS: 'SESSION_EXISTS';
  readonly SESSION_EXTRACT_FAILED: 'SESSION_EXTRACT_FAILED';
  readonly SESSION_POISONED: 'SESSION_POISONED';
  readonly V2RAY_NOT_FOUND: 'V2RAY_NOT_FOUND';
  readonly V2RAY_ALL_FAILED: 'V2RAY_ALL_FAILED';
  readonly WG_NOT_AVAILABLE: 'WG_NOT_AVAILABLE';
  readonly WG_NO_CONNECTIVITY: 'WG_NO_CONNECTIVITY';
  readonly TUNNEL_SETUP_FAILED: 'TUNNEL_SETUP_FAILED';
  readonly TLS_CERT_CHANGED: 'TLS_CERT_CHANGED';
  readonly ABORTED: 'ABORTED';
  readonly ALL_NODES_FAILED: 'ALL_NODES_FAILED';
  readonly ALREADY_CONNECTED: 'ALREADY_CONNECTED';
  readonly PARTIAL_CONNECTION_FAILED: 'PARTIAL_CONNECTION_FAILED';
};

// ─── Error Severity ────────────────────────────────────────────────────────

/**
 * Severity levels that determine retry/UX behavior:
 * - fatal: Don't retry, user action needed (e.g. invalid mnemonic, insufficient balance)
 * - retryable: Try again, possibly with a different node
 * - recoverable: Can resume with recoverSession()
 * - infrastructure: Check system state (e.g. missing binary, cert changed)
 */
export type ErrorSeverity = 'fatal' | 'retryable' | 'recoverable' | 'infrastructure';

/** Map of error code to severity level. Apps use this for retry/UX logic. */
export const ERROR_SEVERITY: Readonly<Record<ErrorCode, ErrorSeverity>>;

// ─── Error Classes ─────────────────────────────────────────────────────────

/**
 * Base error class for all SDK errors.
 * Check .code (ErrorCode) for machine-readable error type.
 * Check .details for structured context (node address, session ID, etc.).
 */
export class SentinelError extends Error {
  /** Machine-readable error code matching ErrorCodes constants */
  readonly code: ErrorCode;
  /** Structured context for programmatic handling (varies by error type) */
  readonly details: Record<string, unknown>;
  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>);
  /** Serialize to JSON-safe object */
  toJSON(): { name: string; code: ErrorCode; message: string; details: Record<string, unknown> };
}

/** Input validation failures — bad mnemonic, invalid address, wrong option types */
export class ValidationError extends SentinelError {
  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>);
}

/** Node-level failures — offline, no udvpn pricing, clock drift, database corruption */
export class NodeError extends SentinelError {
  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>);
}

/** Chain/transaction failures — broadcast failed, extract failed, LCD errors */
export class ChainError extends SentinelError {
  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>);
}

/** Tunnel setup failures — V2Ray config errors, WG no connectivity */
export class TunnelError extends SentinelError {
  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>);
}

/** Security failures — TLS certificate changed (possible MITM) */
export class SecurityError extends SentinelError {
  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>);
}

// ─── Error Helper Functions ────────────────────────────────────────────────

/**
 * Check if an error should be retried.
 * Returns true for 'retryable' severity errors.
 *
 * @param error - SentinelError instance or object with .code, or just an error code string
 */
export function isRetryable(error: SentinelError | { code: string } | string): boolean;

/**
 * Map an SDK error to a user-friendly message suitable for UI display.
 * Returns a plain English sentence. Falls back to error.message for unknown codes.
 *
 * @param error - SentinelError instance, object with .code, or just an error code string
 */
export function userMessage(error: SentinelError | { code: string } | string): string;
