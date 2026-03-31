/**
 * Sentinel SDK — Typed Error Classes
 *
 * Machine-readable error codes for programmatic error handling.
 * All SDK errors extend SentinelError with a .code property.
 *
 * Usage:
 *   import { SentinelError, ErrorCodes } from './errors.js';
 *   try { await connect(opts); }
 *   catch (e) {
 *     if (e.code === ErrorCodes.V2RAY_ALL_FAILED) trySwitchNode();
 *     if (e instanceof ValidationError) showFormError(e.message);
 *   }
 */

export class SentinelError extends Error {
  /**
   * @param {string} code - Machine-readable error code (e.g. 'NODE_NO_UDVPN')
   * @param {string} message - Human-readable description
   * @param {object} details - Structured context for programmatic handling
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SentinelError';
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return { name: this.name, code: this.code, message: this.message, details: this.details };
  }
}

/** Input validation failures (bad mnemonic, invalid address, etc.) */
export class ValidationError extends SentinelError {
  constructor(code, message, details) {
    super(code, message, details);
    this.name = 'ValidationError';
  }
}

/** Node-level failures (offline, no udvpn, clock drift, etc.) */
export class NodeError extends SentinelError {
  constructor(code, message, details) {
    super(code, message, details);
    this.name = 'NodeError';
  }
}

/** Chain/transaction failures (broadcast failed, extract failed, etc.) */
export class ChainError extends SentinelError {
  constructor(code, message, details) {
    super(code, message, details);
    this.name = 'ChainError';
  }
}

/** Tunnel setup failures (V2Ray all failed, WG no connectivity, etc.) */
export class TunnelError extends SentinelError {
  constructor(code, message, details) {
    super(code, message, details);
    this.name = 'TunnelError';
  }
}

/** Security failures (TLS cert changed, etc.) */
export class SecurityError extends SentinelError {
  constructor(code, message, details) {
    super(code, message, details);
    this.name = 'SecurityError';
  }
}

/** Error code constants — use these for switch/if checks instead of string parsing */
export const ErrorCodes = {
  // Validation
  INVALID_OPTIONS: 'INVALID_OPTIONS',
  INVALID_MNEMONIC: 'INVALID_MNEMONIC',
  INVALID_NODE_ADDRESS: 'INVALID_NODE_ADDRESS',
  INVALID_GIGABYTES: 'INVALID_GIGABYTES',
  INVALID_URL: 'INVALID_URL',
  INVALID_PLAN_ID: 'INVALID_PLAN_ID',

  // Node
  NODE_OFFLINE: 'NODE_OFFLINE',
  NODE_NO_UDVPN: 'NODE_NO_UDVPN',
  NODE_NOT_FOUND: 'NODE_NOT_FOUND',
  NODE_CLOCK_DRIFT: 'NODE_CLOCK_DRIFT',

  // Chain
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',

  // Session
  SESSION_EXISTS: 'SESSION_EXISTS',
  SESSION_EXTRACT_FAILED: 'SESSION_EXTRACT_FAILED',
  SESSION_POISONED: 'SESSION_POISONED',

  // Tunnel
  V2RAY_NOT_FOUND: 'V2RAY_NOT_FOUND',
  V2RAY_ALL_FAILED: 'V2RAY_ALL_FAILED',
  WG_NOT_AVAILABLE: 'WG_NOT_AVAILABLE',
  WG_NO_CONNECTIVITY: 'WG_NO_CONNECTIVITY',
  TUNNEL_SETUP_FAILED: 'TUNNEL_SETUP_FAILED',

  // Security
  TLS_CERT_CHANGED: 'TLS_CERT_CHANGED',

  // Connection
  ABORTED: 'ABORTED',
  ALL_NODES_FAILED: 'ALL_NODES_FAILED',
  ALREADY_CONNECTED: 'ALREADY_CONNECTED',
};
