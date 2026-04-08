/**
 * Sentinel dVPN SDK — Operator Entry Point
 *
 * ~70 exports for operators, testers, plan managers, and auditing tools.
 * Batch sessions, network audit, plan/provider/lease management, fee grants, authz.
 *
 * Usage:
 *   import { batchStartSessions, auditNetwork } from 'sentinel-dvpn-sdk/operator';
 *
 * For consumer VPN app functions (connect, disconnect, wallet, security):
 *   import { connect, disconnect, listNodes } from 'sentinel-dvpn-sdk/consumer';
 *
 * WARNING: These functions can cost real P2P tokens in bulk. They are NOT for
 * end-user VPN apps. A consumer app accidentally using batchStartSessions
 * will drain the wallet.
 */

// ─── Batch Session Operations ───────────────────────────────────────────────

export {
  batchStartSessions,
  waitForBatchSessions,
} from './batch.js';

export {
  buildBatchStartSession,
  extractAllSessionIds,
} from './cosmjs-setup.js';

// ─── Network Audit & Node Testing ──────────────────────────────────────────

export {
  testNode,
  auditNetwork,
  loadTransportCache,
  saveTransportCache,
  recordTransportSuccess,
  recordTransportFailure,
} from './audit.js';

// ─── Plan Management ────────────────────────────────────────────────────────

export {
  encodeMsgCreatePlan,
  encodeMsgUpdatePlanStatus,
  encodeMsgLinkNode,
  encodeMsgUnlinkNode,
  encodeMsgPlanStartSession,
} from './plan-operations.js';

export {
  encodeMsgUpdatePlanDetails,
} from './v3protocol.js';

// ─── Provider Management ────────────────────────────────────────────────────

export {
  encodeMsgRegisterProvider,
  encodeMsgUpdateProviderDetails,
  encodeMsgUpdateProviderStatus,
} from './plan-operations.js';

// ─── Lease Management ───────────────────────────────────────────────────────

export {
  encodeMsgStartLease,
  encodeMsgEndLease,
} from './plan-operations.js';

// ─── Fee Grants ─────────────────────────────────────────────────────────────

export {
  buildFeeGrantMsg,
  buildRevokeFeeGrantMsg,
  queryFeeGrants,
  queryFeeGrantsIssued,
  grantPlanSubscribers,
  renewExpiringGrants,
  monitorFeeGrants,
} from './cosmjs-setup.js';

// ─── Authz ──────────────────────────────────────────────────────────────────

export {
  buildAuthzGrantMsg,
  buildAuthzRevokeMsg,
  buildAuthzExecMsg,
  encodeForExec,
  queryAuthzGrants,
} from './cosmjs-setup.js';

// ─── Chain Direct (broadcast, registry, LCD) ────────────────────────────────

export {
  broadcast,
  broadcastWithFeeGrant,
  createSafeBroadcaster,
  createClient,
  buildRegistry,
  lcd,
  MSG_TYPES,
} from './cosmjs-setup.js';

// ─── Address Conversion ─────────────────────────────────────────────────────

export {
  sentToSentprov,
  sentToSentnode,
  sentprovToSent,
} from './cosmjs-setup.js';

// ─── Query Helpers (plans, subscriptions, network) ──────────────────────────

export {
  discoverPlans,
  queryPlanSubscribers,
  getPlanStats,
  queryPlanNodes,
  getNetworkOverview,
} from './cosmjs-setup.js';

// ─── Session Encoders ───────────────────────────────────────────────────────

export {
  encodeMsgStartSession,
  encodeMsgEndSession,
  encodeMsgStartSubscription,
  encodeMsgSubStartSession,
  encodeMsgCancelSubscription,
  encodeMsgRenewSubscription,
  encodeMsgShareSubscription,
  encodeMsgUpdateSubscription,
  encodeMsgUpdateSession,
} from './v3protocol.js';
