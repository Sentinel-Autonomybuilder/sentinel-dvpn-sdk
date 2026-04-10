/**
 * Sentinel dVPN SDK — Single Entry Point
 *
 * 160+ exports (+ dryRun option on connect functions) — import everything from one place:
 *   import { connect, disconnect, listNodes } from './index.js';
 *
 * Or import specific modules:
 *   import { createWallet, broadcast } from './index.js';
 */

// Ensure axios uses Node.js HTTP adapter (prevents opaque "fetch failed" on Node 18+)
import axios from 'axios';
axios.defaults.adapter = 'http';

// ─── High-level API (use these for quick apps) ──────────────────────────────

export {
  connectDirect as connect,
  connectDirect,
  connectViaPlan,
  connectViaSubscription,
  connectAuto,
  isConnecting,
  queryOnlineNodes as listNodes,
  queryOnlineNodes,
  fetchAllNodes,
  enrichNodes,
  buildNodeIndex,
  disconnect,
  isConnected,
  getStatus,
  registerCleanupHandlers,
  setSystemProxy,
  clearSystemProxy,
  checkPortFree,
  resetCircuitBreaker,
  configureCircuitBreaker,
  getCircuitBreakerStatus,
  clearWalletCache,
  flushNodeCache,
  recoverSession,
  getConnectionMetrics,
  createConnectConfig,
  quickConnect,
  autoReconnect,
  verifyConnection,
  verifyDependencies,
  enableKillSwitch,
  disableKillSwitch,
  isKillSwitchEnabled,
  enableDnsLeakPrevention,
  disableDnsLeakPrevention,
  events,
  ConnectionState,
  disconnectState,
  tryFastReconnect,
} from './node-connect.js';

// ─── Wallet & Chain ─────────────────────────────────────────────────────────

export {
  createWallet,
  generateWallet,
  privKeyFromMnemonic,
  createClient,
  broadcast,
  broadcastWithFeeGrant,
  createSafeBroadcaster,
  extractId,
  parseChainError,
  getBalance,
  isMnemonicValid,
  getNodePrices,
  getNetworkOverview,
  formatDvpn,
  formatP2P,
  filterNodes,
  serializeResult,
  getDvpnPrice,
  findExistingSession,
  fetchActiveNodes,
  discoverPlanIds,
  resolveNodeUrl,
  sentToSentprov,
  sentToSentnode,
  sentprovToSent,
  buildRegistry,
  lcd,
  txResponse,
  MSG_TYPES,
  // FeeGrant
  buildFeeGrantMsg,
  buildRevokeFeeGrantMsg,
  queryFeeGrants,
  queryFeeGrant,
  // Authz
  buildAuthzGrantMsg,
  buildAuthzRevokeMsg,
  buildAuthzExecMsg,
  encodeForExec,
  queryAuthzGrants,
  // LCD Query Helpers (v25b)
  lcdQuery,
  lcdQueryAll,
  // Plan Subscriber Helpers (v25b)
  queryPlanSubscribers,
  getPlanStats,
  // Fee Grant Workflow (v25b)
  grantPlanSubscribers,
  queryFeeGrantsIssued,
  getExpiringGrants,
  renewExpiringGrants,
  monitorFeeGrants,
  // Missing functionality (v25c)
  querySubscriptions,
  querySessionAllocation,
  queryNode,
  buildBatchStartSession,
  buildEndSessionMsg,
  // v26: Field experience helpers
  queryPlanNodes,
  discoverPlans,
  shortAddress,
  formatSubscriptionExpiry,
  sendTokens,
  subscribeToPlan,
  getProviderByAddress,
  buildBatchSend,
  buildBatchLink,
  decodeTxEvents,
  extractAllSessionIds,
  estimateBatchFee,
  estimateSessionCost,
  isSameKey,
  // v26c: Defensive pagination + queries
  lcdPaginatedSafe,
  querySessions,
  querySubscription,
  hasActiveSubscription,
  // v26c: Display helpers
  formatBytes,
  parseChainDuration,
  flattenSession,
  // v27: VPN Settings Persistence
  loadVpnSettings,
  saveVpnSettings,
} from './cosmjs-setup.js';

// ─── Protocol (handshakes, configs, tunnels) ─────────────────────────────────

export {
  nodeStatusV3,
  generateWgKeyPair,
  initHandshakeV3,
  initHandshakeV3V2Ray,
  writeWgConfig,
  buildV2RayClientConfig,
  generateV2RayUUID,
  extractSessionId,
  waitForPort,
  validateCIDR,
} from './v3protocol.js';

// ─── WireGuard (Cross-Platform) ─────────────────────────────────────────────

export {
  installWgTunnel,
  uninstallWgTunnel,
  connectWireGuard,
  disconnectWireGuard,
  emergencyCleanupSync,
  watchdogCheck,
  IS_ADMIN,
  WG_EXE,
  WG_QUICK,
  WG_AVAILABLE,
} from './wireguard.js';

// ─── Speed Testing ──────────────────────────────────────────────────────────

export {
  speedtestDirect,
  speedtestViaSocks5,
  resolveSpeedtestIPs,
  flushSpeedTestDnsCache,
  compareSpeedTests,
  SPEEDTEST_DEFAULTS,
} from './speedtest.js';

// ─── Plan & Provider Management ─────────────────────────────────────────────

export {
  encodeMsgRegisterProvider,
  encodeMsgUpdateProviderDetails,
  encodeMsgUpdateProviderStatus,
  encodeMsgCreatePlan,
  encodeMsgUpdatePlanStatus,
  encodeMsgLinkNode,
  encodeMsgUnlinkNode,
  encodeMsgPlanStartSession,
  encodeMsgStartLease,
  encodeMsgEndLease,
  encodePrice,
  encodeDuration,
  decToScaledInt,
} from './plan-operations.js';

// ─── Session Message Encoders (direct/sub sessions) ─────────────────────────

export {
  encodeMsgStartSession,
  encodeMsgEndSession,
  encodeMsgStartSubscription,
  encodeMsgSubStartSession,
  // Subscription management (v3)
  encodeMsgCancelSubscription,
  encodeMsgRenewSubscription,
  encodeMsgShareSubscription,
  encodeMsgUpdateSubscription,
  // Session management (v3)
  encodeMsgUpdateSession,
  // Node operator (v3)
  encodeMsgRegisterNode,
  encodeMsgUpdateNodeDetails,
  encodeMsgUpdateNodeStatus,
  // Plan details update (v3)
  encodeMsgUpdatePlanDetails,
  // EncodeObject builders (return { typeUrl, value } for signAndBroadcast)
  buildMsgStartSession,
  buildMsgEndSession,
  buildMsgStartSubscription,
  buildMsgSubStartSession,
  buildMsgCancelSubscription,
  buildMsgRenewSubscription,
  buildMsgShareSubscription,
  buildMsgUpdateSubscription,
  buildMsgUpdateSession,
} from './v3protocol.js';

// ─── Typed Message Builders (return { typeUrl, value } EncodeObject) ────────
// These are the RECOMMENDED way to build messages for signAndBroadcast.
// The encodeMsg* functions above return raw Uint8Array (for internal/advanced use).

export {
  TYPE_URLS,
  buildMsgStartSession as buildMsg_StartSession,
  buildMsgCancelSession,
  buildMsgEndSession as buildMsg_EndSession,
  buildMsgUpdateSession as buildMsg_UpdateSession,
  buildMsgStartSubscription as buildMsg_StartSubscription,
  buildMsgSubStartSession as buildMsg_SubStartSession,
  buildMsgCancelSubscription as buildMsg_CancelSubscription,
  buildMsgRenewSubscription as buildMsg_RenewSubscription,
  buildMsgShareSubscription as buildMsg_ShareSubscription,
  buildMsgUpdateSubscription as buildMsg_UpdateSubscription,
  buildMsgPlanStartSession as buildMsg_PlanStartSession,
  buildMsgCreatePlan as buildMsg_CreatePlan,
  buildMsgUpdatePlanDetails as buildMsg_UpdatePlanDetails,
  buildMsgUpdatePlanStatus as buildMsg_UpdatePlanStatus,
  buildMsgLinkNode as buildMsg_LinkNode,
  buildMsgUnlinkNode as buildMsg_UnlinkNode,
  buildMsgRegisterProvider as buildMsg_RegisterProvider,
  buildMsgUpdateProviderDetails as buildMsg_UpdateProviderDetails,
  buildMsgUpdateProviderStatus as buildMsg_UpdateProviderStatus,
  buildMsgStartLease as buildMsg_StartLease,
  buildMsgEndLease as buildMsg_EndLease,
  buildMsgRegisterNode as buildMsg_RegisterNode,
  buildMsgUpdateNodeDetails as buildMsg_UpdateNodeDetails,
  buildMsgUpdateNodeStatus as buildMsg_UpdateNodeStatus,
} from './protocol/messages.js';

// ─── Typed Event Parsers ────────────────────────────────────────────────────

export {
  searchEvent,
  searchEvents,
  extractSessionIdTyped,
  NodeEventCreateSession,
  NodeEventPay,
  NodeEventRefund,
  NodeEventUpdateStatus,
  SessionEventEnd,
  SessionEventUpdateDetails,
  SubscriptionEventCreate,
  SubscriptionEventCreateSession,
  SubscriptionEventPay,
  SubscriptionEventEnd,
  LeaseEventCreate,
  LeaseEventEnd,
} from './protocol/events.js';

// ─── RPC Queries (protobuf via CosmJS — 912x faster than LCD) ───────────────

export {
  createRpcQueryClient,
  createRpcQueryClientWithFallback,
  disconnectRpc,
  rpcQueryNodes,
  rpcQueryNode,
  rpcQueryNodesForPlan,
  rpcQuerySessionsForAccount,
  rpcQuerySubscriptionsForAccount,
  rpcQueryPlan,
  rpcQueryBalance,
} from './chain/rpc.js';

// ─── TypeScript Client (extends CosmJS SigningStargateClient) ───────────────

export {
  BlueSentinelClient,
  SentinelQueryClient,
  SentinelWsClient,
} from './dist/index.js';

// ─── State Persistence (crash recovery) ─────────────────────────────────────

export {
  saveState,
  loadState,
  clearState,
  recoverOrphans,
  markSessionPoisoned,
  markSessionActive,
  isSessionPoisoned,
  getSessionHistory,
  writePidFile,
  checkPidFile,
  clearPidFile,
  saveCredentials,
  loadCredentials,
  clearCredentials,
  clearAllCredentials,
} from './state.js';

// ─── Hardcoded Defaults & Fallback ──────────────────────────────────────────
// Static values verified 2026-03-08. Will be replaced by live RPC query server.

export {
  SDK_VERSION,
  LAST_VERIFIED,
  HARDCODED_NOTE,
  CHAIN_ID,
  CHAIN_VERSION,
  COSMOS_SDK_VERSION,
  DENOM,
  GAS_PRICE,
  DEFAULT_RPC,
  DEFAULT_LCD,
  RPC_ENDPOINTS,
  LCD_ENDPOINTS,
  V2RAY_VERSION,
  TRANSPORT_SUCCESS_RATES,
  BROKEN_NODES,
  PRICING_REFERENCE,
  DEFAULT_TIMEOUTS,
  tryWithFallback,
  checkEndpointHealth,
  sleep,
  bytesToMbps,
  // Dynamic transport rates
  recordTransportResult,
  getDynamicRate,
  getDynamicRates,
  resetDynamicRates,
  // DNS presets
  DNS_PRESETS,
  DEFAULT_DNS_PRESET,
  DNS_FALLBACK_ORDER,
  resolveDnsServers,
} from './defaults.js';

// ─── Typed Errors ────────────────────────────────────────────────────────────

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

// ─── TLS Trust (TOFU) ───────────────────────────────────────────────────────

export {
  createNodeHttpsAgent,
  clearKnownNode,
  clearAllKnownNodes,
  getKnownNode,
  publicEndpointAgent,
} from './tls-trust.js';

// ─── Session Manager ─────────────────────────────────────────────────────────

export { SessionManager } from './session-manager.js';

// ─── Batch Session Operations ────────────────────────────────────────────────

export {
  batchStartSessions,
  waitForBatchSessions,
  waitForSessionActive,
} from './batch.js';

// ─── Pre-Flight System Check ─────────────────────────────────────────────────

export {
  preflight,
  checkOrphanedTunnels,
  cleanOrphanedTunnels,
  checkOrphanedV2Ray,
  checkVpnConflicts,
  checkPortConflicts,
} from './preflight.js';

// ─── Cache & Persistence ─────────────────────────────────────────────────────

export {
  cached,
  cacheInvalidate,
  cacheClear,
  cacheInfo,
  diskSave,
  diskLoad,
  diskClear,
} from './disk-cache.js';

export {
  trackSession,
  getSessionMode,
  getAllTrackedSessions,
  clearSessionMode,
} from './session-tracker.js';

export {
  loadAppSettings,
  saveAppSettings,
  resetAppSettings,
  APP_SETTINGS_DEFAULTS,
} from './app-settings.js';

// ─── App Types & Builder Helpers ─────────────────────────────────────────────

export {
  APP_TYPES,
  APP_TYPE_CONFIG,
  validateAppConfig,
  getConnectDefaults,
} from './app-types.js';

export {
  COUNTRY_MAP,
  countryNameToCode,
  getFlagUrl,
  getFlagEmoji,
  formatPriceP2P,
  formatNodePricing,
  estimateSessionPrice,
  buildNodeDisplay,
  groupNodesByCountry,
  HOUR_OPTIONS,
  GB_OPTIONS,
  formatUptime,
  computeSessionAllocation,
} from './app-helpers.js';

// ─── Instantiable Client Class ───────────────────────────────────────────────

export { SentinelClient } from './client.js';

// ─── Network Audit & Node Testing ───────────────────────────────────────────

export {
  testNode,
  auditNetwork,
  loadTransportCache,
  saveTransportCache,
  recordTransportSuccess,
  recordTransportFailure,
  reorderOutbounds,
  getCacheStats,
} from './audit.js';
