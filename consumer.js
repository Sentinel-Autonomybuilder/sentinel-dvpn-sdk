/**
 * Sentinel dVPN SDK — Consumer Entry Point
 *
 * ~50 exports for VPN app developers: connect, disconnect, wallet, security, settings.
 * One session, one node, one user. No batch/audit/operator functions.
 *
 * Usage:
 *   import { connect, disconnect, listNodes, getBalance } from 'sentinel-dvpn-sdk/consumer';
 *
 * For operator/testing functions (batch sessions, audit, plan management):
 *   import { batchStartSessions, auditNetwork } from 'sentinel-dvpn-sdk/operator';
 */

// ─── Connection ─────────────────────────────────────────────────────────────

export {
  connectDirect as connect,
  connectDirect,
  connectAuto,
  connectViaPlan,
  connectViaSubscription,
  disconnect,
  isConnected,
  getStatus,
  quickConnect,
  autoReconnect,
  tryFastReconnect,
  verifyConnection,
  verifyDependencies,
  registerCleanupHandlers,
  recoverSession,
} from './node-connect.js';

// ─── Discovery ──────────────────────────────────────────────────────────────

export {
  queryOnlineNodes as listNodes,
  queryOnlineNodes,
  fetchAllNodes,
  enrichNodes,
  buildNodeIndex,
  flushNodeCache,
} from './node-connect.js';

// ─── Wallet ─────────────────────────────────────────────────────────────────

export {
  createWallet,
  generateWallet,
  getBalance,
  privKeyFromMnemonic,
  isMnemonicValid,
} from './cosmjs-setup.js';

// ─── Security ───────────────────────────────────────────────────────────────

export {
  enableKillSwitch,
  disableKillSwitch,
  isKillSwitchEnabled,
  enableDnsLeakPrevention,
  disableDnsLeakPrevention,
} from './node-connect.js';

// ─── Session ────────────────────────────────────────────────────────────────

export { SessionManager } from './session-manager.js';

export {
  findExistingSession,
} from './cosmjs-setup.js';

// ─── Settings ───────────────────────────────────────────────────────────────

export {
  loadAppSettings,
  saveAppSettings,
  resetAppSettings,
  APP_SETTINGS_DEFAULTS,
} from './app-settings.js';

// ─── Errors ─────────────────────────────────────────────────────────────────

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

// ─── Helpers (country, pricing, display) ────────────────────────────────────

export {
  countryNameToCode,
  getFlagUrl,
  getFlagEmoji,
  formatPriceP2P,
  formatNodePricing,
  estimateSessionPrice,
  buildNodeDisplay,
  groupNodesByCountry,
  computeSessionAllocation,
} from './app-helpers.js';

export {
  formatBytes,
} from './cosmjs-setup.js';

// ─── Speed Testing ──────────────────────────────────────────────────────────

export {
  speedtestDirect,
  speedtestViaSocks5,
} from './speedtest.js';

// ─── Client ─────────────────────────────────────────────────────────────────

export { SentinelClient } from './client.js';

// ─── State Persistence ──────────────────────────────────────────────────────

export {
  saveState,
  loadState,
  clearState,
} from './state.js';
