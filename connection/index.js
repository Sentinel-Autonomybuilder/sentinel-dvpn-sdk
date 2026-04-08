/**
 * Connection Module — barrel re-export of all connection submodules.
 *
 * This is the single entry point for the connection/ directory.
 * node-connect.js re-exports from here for backwards compatibility.
 */

// ─── State ───────────────────────────────────────────────────────────────────
export {
  events,
  ConnectionState,
  _defaultState,
  isConnecting,
  clearWalletCache,
  getConnectionMetrics,
  isConnected,
  getStatus,
  verifyConnection,
} from './state.js';

// ─── Connect ─────────────────────────────────────────────────────────────────
export {
  connectDirect,
  connectAuto,
  connectViaPlan,
  connectViaSubscription,
  quickConnect,
  createConnectConfig,
} from './connect.js';

// ─── Disconnect ──────────────────────────────────────────────────────────────
export {
  disconnect,
  disconnectState,
  registerCleanupHandlers,
  recoverSession,
} from './disconnect.js';

// ─── Discovery ───────────────────────────────────────────────────────────────
export {
  queryOnlineNodes,
  fetchAllNodes,
  enrichNodes,
  buildNodeIndex,
  flushNodeCache,
} from './discovery.js';

// ─── Security ────────────────────────────────────────────────────────────────
export {
  enableKillSwitch,
  disableKillSwitch,
  isKillSwitchEnabled,
  enableDnsLeakPrevention,
  disableDnsLeakPrevention,
} from './security.js';

// ─── Resilience ──────────────────────────────────────────────────────────────
export {
  resetCircuitBreaker,
  configureCircuitBreaker,
  getCircuitBreakerStatus,
  autoReconnect,
  tryFastReconnect,
} from './resilience.js';

// ─── Proxy ───────────────────────────────────────────────────────────────────
export {
  setSystemProxy,
  clearSystemProxy,
  checkPortFree,
} from './proxy.js';

// ─── Tunnel ──────────────────────────────────────────────────────────────────
export {
  verifyDependencies,
} from './tunnel.js';
