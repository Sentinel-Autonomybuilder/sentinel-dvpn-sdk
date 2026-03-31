/**
 * Sentinel AI Path — Error Types
 *
 * Typed errors with machine-readable codes for AI agent error handling.
 * Every error includes a `nextAction` field telling the agent what to do.
 */

// ─── Error Codes ────────────────────────────────────────────────────────────

export const AiPathErrorCodes = {
  // Wallet
  MISSING_MNEMONIC: 'MISSING_MNEMONIC',
  INVALID_MNEMONIC: 'INVALID_MNEMONIC',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',

  // Environment
  SETUP_FAILED: 'SETUP_FAILED',
  ENVIRONMENT_NOT_READY: 'ENVIRONMENT_NOT_READY',
  V2RAY_NOT_FOUND: 'V2RAY_NOT_FOUND',
  WIREGUARD_NOT_FOUND: 'WIREGUARD_NOT_FOUND',
  ADMIN_REQUIRED: 'ADMIN_REQUIRED',

  // Connection
  CONNECT_FAILED: 'CONNECT_FAILED',
  DISCONNECT_FAILED: 'DISCONNECT_FAILED',
  ALREADY_CONNECTED: 'ALREADY_CONNECTED',
  ALL_NODES_FAILED: 'ALL_NODES_FAILED',
  NO_NODES_IN_COUNTRY: 'NO_NODES_IN_COUNTRY',
  NODE_OFFLINE: 'NODE_OFFLINE',
  HANDSHAKE_FAILED: 'HANDSHAKE_FAILED',
  TUNNEL_FAILED: 'TUNNEL_FAILED',
  TIMEOUT: 'TIMEOUT',

  // Validation
  INVALID_OPTIONS: 'INVALID_OPTIONS',

  // Discovery
  DISCOVERY_FAILED: 'DISCOVERY_FAILED',
  WALLET_FAILED: 'WALLET_FAILED',
  BALANCE_FAILED: 'BALANCE_FAILED',
  VERIFY_FAILED: 'VERIFY_FAILED',
};

// ─── Next Actions (machine-readable) ────────────────────────────────────────

export const NextActions = {
  CREATE_WALLET: 'create_wallet',
  FUND_WALLET: 'fund_wallet',
  RUN_SETUP: 'run_setup',
  RUN_AS_ADMIN: 'run_as_admin',
  TRY_DIFFERENT_NODE: 'try_different_node',
  TRY_DIFFERENT_COUNTRY: 'try_different_country',
  TRY_V2RAY: 'try_v2ray',
  TRY_WIREGUARD: 'try_wireguard',
  DISCONNECT_FIRST: 'disconnect',
  RETRY: 'retry',
  NONE: 'none',
};

// ─── Error Class ────────────────────────────────────────────────────────────

export class AiPathError extends Error {
  /**
   * @param {string} code - Machine-readable error code from AiPathErrorCodes
   * @param {string} message - Human-readable message
   * @param {object} [details] - Extra context for the agent
   * @param {string} [nextAction] - What the agent should do next (from NextActions)
   */
  constructor(code, message, details = null, nextAction = NextActions.RETRY) {
    super(message);
    this.name = 'AiPathError';
    this.code = code;
    this.details = details;
    this.nextAction = nextAction;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
      nextAction: this.nextAction,
    };
  }
}
