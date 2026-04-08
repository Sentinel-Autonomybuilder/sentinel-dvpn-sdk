/**
 * Sentinel SDK — Chain Types
 *
 * Types for wallet management, chain queries, transaction broadcasting,
 * fee grants, authz, and all Sentinel + Cosmos message types.
 *
 * Chain: sentinelhub-2 (v12.0.0, Cosmos SDK 0.47.17)
 * Denom: udvpn (micro), display: P2P
 */

import type { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import type { SigningStargateClient, DeliverTxResponse } from '@cosmjs/stargate';
import type { StdFee } from '@cosmjs/amino';

// ─── Wallet ────────────────────────────────────────────────────────────────

/** Result from createWallet(). Contains the wallet and first account. */
export interface WalletResult {
  /** CosmJS DirectSecp256k1HdWallet instance */
  wallet: DirectSecp256k1HdWallet;
  /** First account derived from the mnemonic */
  account: {
    /** Bech32 address with "sent" prefix (e.g. sent1abc...) */
    address: string;
    /** Signing algorithm (always "secp256k1") */
    algo: string;
    /** Compressed public key bytes */
    pubkey: Uint8Array;
  };
}

/** Result from generateWallet(). Includes the random mnemonic. */
export interface GenerateWalletResult {
  /** BIP39 mnemonic phrase (24 words by default) */
  mnemonic: string;
  /** CosmJS wallet instance */
  wallet: DirectSecp256k1HdWallet;
  /** First account */
  account: { address: string };
}

/** Wallet balance in both micro-denom and whole tokens. */
export interface WalletBalance {
  /** Balance in micro-denom (1 P2P = 1,000,000 udvpn) */
  udvpn: number;
  /** Balance in whole tokens (human-readable) */
  dvpn: number;
}

// ─── Broadcasting ──────────────────────────────────────────────────────────

/**
 * Safe broadcaster with automatic sequence management.
 * Prevents "account sequence mismatch" errors on rapid TX submission.
 */
export interface SafeBroadcaster {
  /** Broadcast messages with automatic retry on sequence mismatch */
  safeBroadcast: (msgs: EncodedMsg[], memo?: string) => Promise<DeliverTxResponse>;
  /** Get the underlying SigningStargateClient */
  getClient: () => Promise<SigningStargateClient>;
  /** Force-reconnect the RPC client (e.g. after endpoint switch) */
  resetClient: () => Promise<SigningStargateClient>;
}

/** Parsed TX response for quick success/fail checks. */
export interface TxResponseSummary {
  /** Whether the TX succeeded (code === 0) */
  ok: boolean;
  /** Transaction hash */
  txHash: string;
  /** Gas actually consumed */
  gasUsed: number;
  /** Gas limit that was set */
  gasWanted: number;
}

// ─── Encoded Messages ──────────────────────────────────────────────────────

/** A CosmJS-compatible encoded message ready for broadcast. */
export interface EncodedMsg {
  /** Protobuf type URL (e.g. '/sentinel.session.v3.MsgStartSessionRequest') */
  typeUrl: string;
  /** Encoded message value (Uint8Array for raw protobuf, object for amino) */
  value: Uint8Array | Record<string, unknown>;
}

// ─── Chain Message Type URLs ───────────────────────────────────────────────

/**
 * All 15 Sentinel + 5 Cosmos message type URL strings.
 * Use with broadcast() and buildRegistry().
 */
export const MSG_TYPES: {
  readonly START_SESSION: string;
  readonly END_SESSION: string;
  readonly START_SUBSCRIPTION: string;
  readonly SUB_START_SESSION: string;
  readonly PLAN_START_SESSION: string;
  readonly CREATE_PLAN: string;
  readonly UPDATE_PLAN_STATUS: string;
  readonly LINK_NODE: string;
  readonly UNLINK_NODE: string;
  readonly REGISTER_PROVIDER: string;
  readonly UPDATE_PROVIDER: string;
  readonly UPDATE_PROVIDER_STATUS: string;
  readonly START_LEASE: string;
  readonly END_LEASE: string;
  readonly GRANT_FEE_ALLOWANCE: string;
  readonly REVOKE_FEE_ALLOWANCE: string;
  readonly AUTHZ_GRANT: string;
  readonly AUTHZ_REVOKE: string;
  readonly AUTHZ_EXEC: string;
};

// ─── LCD Query Helpers ─────────────────────────────────────────────────────

/** Options for lcdQuery(). */
export interface LcdQueryOptions {
  /** LCD endpoint URL (default: cascading fallback) */
  lcdUrl?: string;
  /** Request timeout in ms (default: 15000) */
  timeout?: number;
}

/** Options for lcdQueryAll() auto-pagination. */
export interface LcdQueryAllOptions extends LcdQueryOptions {
  /** Items per page (default: 100) */
  limit?: number;
  /** JSON key containing the items array in the response */
  dataKey?: string;
}

/** Result from lcdQueryAll(). */
export interface PaginatedResult<T = unknown> {
  /** All fetched items across all pages */
  items: T[];
  /**
   * Total count from chain (may be null or wrong -- Sentinel LCD pagination is unreliable).
   * Do NOT trust this for display. Use items.length instead.
   */
  total: number | null;
}

/** Options for lcdPaginatedSafe(). Handles Sentinel's broken pagination. */
export interface LcdPaginatedSafeOptions {
  /** Items per page (default: 100) */
  limit?: number;
  /** Fallback limit for single large request when pagination breaks (default: 5000) */
  fallbackLimit?: number;
}

// ─── Chain Data Types ──────────────────────────────────────────────────────

/** Reusable price entry (denom + sdk.Dec values). Used across nodes, plans, subscriptions. */
export interface PriceEntry {
  /** Token denomination (e.g. 'udvpn') */
  denom: string;
  /**
   * Base value as sdk.Dec string (e.g. '0.003000000000000000').
   * This is the per-byte or per-second rate.
   */
  base_value: string;
  /**
   * Quote value as string (e.g. '40152030').
   * This is the total cost per GB or per hour in micro-denom.
   */
  quote_value: string;
}

/** Raw node from LCD. Note: remote_addrs is an ARRAY (v3), NOT a string. */
export interface ChainNode {
  /** sentnode1... bech32 address */
  address: string;
  /** Array of remote URLs (v3 uses array, v2 used single string) */
  remote_addrs: string[];
  /** Legacy field -- some nodes still include this */
  remote_url?: string;
  /** Per-GB pricing entries */
  gigabyte_prices: PriceEntry[];
  /** Per-hour pricing entries */
  hourly_prices: PriceEntry[];
  /** Status integer: 1 = active, 2 = inactive */
  status: number;
}

/** Raw subscription from LCD. */
export interface Subscription {
  /** Subscription ID (numeric string) */
  id: string;
  /** Subscriber's sent1... address */
  acc_address: string;
  /** Plan ID if this is a plan subscription (numeric string, "0" if direct) */
  plan_id: string;
  /** Price paid for this subscription (null for plan subscriptions) */
  price: PriceEntry | null;
  /** Renewal price policy (numeric string) */
  renewal_price_policy: string;
  /** Status string (e.g. 'STATUS_ACTIVE') */
  status: string;
  /** When the subscription started (ISO timestamp) */
  start_at: string;
  /** When the status last changed */
  status_at: string;
  /** When the subscription becomes inactive */
  inactive_at: string;
}

/**
 * Raw session from LCD. Data is nested under base_session (v3 format).
 * Use flattenSession() to get a flat object where session.id works directly.
 */
export interface ChainSession {
  /** Protobuf type discriminator */
  '@type': string;
  base_session: {
    /** Session ID (numeric string) */
    id: string;
    /** User's sent1... address */
    acc_address: string;
    /** Connected node's sentnode1... address */
    node_address: string;
    /** Bytes downloaded (numeric string) */
    download_bytes: string;
    /** Bytes uploaded (numeric string) */
    upload_bytes: string;
    /** Maximum bytes allowed (numeric string, "0" for hourly sessions) */
    max_bytes: string;
    /** Current session duration (e.g. "557817.72s") */
    duration: string;
    /** Maximum duration (e.g. "3600s" for hourly, "0s" for GB-based) */
    max_duration: string;
    /** Session status string */
    status: string;
    /** When the session started */
    start_at: string;
    /** When status last changed */
    status_at: string;
    /** When the session becomes inactive */
    inactive_at: string;
  };
  /** Price paid for this session */
  price?: PriceEntry;
  /** Subscription ID if started via subscription */
  subscription_id?: string;
}

/**
 * Flattened session -- base_session fields promoted to top level.
 * Created by flattenSession() to prevent the #1 footgun (session.id being undefined).
 */
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
  price?: PriceEntry;
  subscription_id?: string;
  '@type'?: string;
  /** The original nested ChainSession object */
  _raw: ChainSession;
}

/** Provider details from LCD (v2 -- providers are NOT yet on v3). */
export interface Provider {
  /** sentprov1... bech32 address */
  address: string;
  /** Provider display name */
  name: string;
  /** Identity (e.g. Keybase ID) */
  identity: string;
  /** Provider website URL */
  website: string;
  /** Provider description */
  description: string;
  /** Status integer: 1 = active, 2 = inactive */
  status: number;
}

/**
 * Fee grant allowance from LCD.
 * Complex nested @type structure -- the SDK handles parsing for you.
 */
export interface FeeGrantAllowance {
  /** Granter's sent1... address (who pays gas) */
  granter: string;
  /** Grantee's sent1... address (who gets free gas) */
  grantee: string;
  allowance: {
    '@type': string;
    /** Direct spend limit (BasicAllowance) */
    spend_limit?: Array<{ denom: string; amount: string }>;
    /** Grant expiration ISO timestamp */
    expiration?: string;
    /** Nested basic allowance (AllowedMsgAllowance wraps BasicAllowance) */
    basic?: {
      spend_limit?: Array<{ denom: string; amount: string }>;
      expiration?: string;
    };
    /** Double-nested allowance (PeriodicAllowance wraps AllowedMsgAllowance) */
    allowance?: {
      '@type'?: string;
      spend_limit?: Array<{ denom: string; amount: string }>;
      expiration?: string;
      basic?: {
        spend_limit?: Array<{ denom: string; amount: string }>;
        expiration?: string;
      };
    };
  };
}

/** Plan metadata from discoverPlans(). */
export interface DiscoveredPlan {
  /** Plan ID */
  id: number;
  /** Number of active subscribers */
  subscribers: number;
  /** Number of linked nodes */
  nodeCount: number;
  /** Plan price (null if free or not configured) */
  price: PriceEntry | null;
  /** Whether the plan has any linked nodes */
  hasNodes: boolean;
}

// ─── Fee Grant Options ─────────────────────────────────────────────────────

/** Options for building fee grant messages. */
export interface FeeGrantOptions {
  /**
   * Maximum spend in udvpn (number) or array of {denom, amount} Coins.
   * If not set, the grant is unlimited.
   */
  spendLimit?: number | Array<{ denom: string; amount: string }>;
  /** Grant expiration date. After this, grantee must pay their own gas. */
  expiration?: Date | string;
  /** Restrict grant to specific message types (type URLs). If set, only these TXs are free. */
  allowedMessages?: string[];
}

/** Information about an expiring fee grant. */
export interface ExpiringGrant {
  /** Granter's sent1... address */
  granter: string;
  /** Grantee's sent1... address */
  grantee: string;
  /** Expiration date (null if no expiration set) */
  expiresAt: Date | null;
  /** Days until expiration (null if no expiration) */
  daysLeft: number | null;
}

// ─── Plan Subscriber Helpers ───────────────────────────────────────────────

/** Subscription info from queryPlanSubscribers(). */
export interface PlanSubscriber {
  /** Subscriber's sent1... address */
  address: string;
  /** Subscription status integer */
  status: number;
  /** Subscription ID */
  id: string;
  [key: string]: unknown;
}

/** Plan stats from getPlanStats(). */
export interface PlanStats {
  /** Number of non-owner subscribers */
  subscriberCount: number;
  /** Total on chain (may be inaccurate due to LCD bugs) */
  totalOnChain: number | null;
  /** Whether the plan owner is also subscribed */
  ownerSubscribed: boolean;
}

// ─── Message Encoder Params ────────────────────────────────────────────────

/** Parameters for encodeMsgStartSession(). */
export interface MsgStartSessionParams {
  /** Sender's sent1... address */
  from: string;
  /** Target node's sentnode1... address */
  node_address: string;
  /** Gigabytes to purchase (default: 1). Set to 0 when using hours. */
  gigabytes?: number;
  /** Hours to purchase. When > 0, uses hourly pricing. */
  hours?: number;
  /** Maximum acceptable price. If node price exceeds this, TX fails on-chain. */
  max_price?: PriceEntry;
}

/** Parameters for encodeMsgEndSession(). */
export interface MsgEndSessionParams {
  /** Sender's sent1... address (must be session owner) */
  from: string;
  /** Session ID to end */
  id: number | bigint;
  /** Optional rating for the node (not yet implemented on chain) */
  rating?: number;
}

/** Parameters for encodeMsgStartSubscription(). */
export interface MsgStartSubscriptionParams {
  /** Subscriber's sent1... address */
  from: string;
  /** Plan ID to subscribe to */
  id: number | bigint;
  /** Payment denomination (default: 'udvpn') */
  denom?: string;
  /** Renewal price policy (default: 0) */
  renewalPricePolicy?: number;
}

/** Parameters for encodeMsgSubStartSession(). */
export interface MsgSubStartSessionParams {
  /** Subscriber's sent1... address */
  from: string;
  /** Subscription ID */
  id: number | bigint;
  /** Target node's sentnode1... address */
  nodeAddress: string;
}

/** Parameters for encodeMsgCancelSubscription(). */
export interface MsgCancelSubscriptionParams {
  /** Subscriber's sent1... address */
  from: string;
  /** Subscription ID to cancel */
  id: number | bigint;
}

/** Parameters for encodeMsgRenewSubscription(). */
export interface MsgRenewSubscriptionParams {
  /** Subscriber's sent1... address */
  from: string;
  /** Subscription ID to renew */
  id: number | bigint;
  /** Payment denomination (default: 'udvpn') */
  denom?: string;
}

/** Parameters for encodeMsgShareSubscription(). */
export interface MsgShareSubscriptionParams {
  /** Sharer's sent1... address */
  from: string;
  /** Subscription ID */
  id: number | bigint;
  /** Recipient's sent1... address */
  accAddress: string;
  /** Bytes to share */
  bytes: string | number;
}

/** Parameters for encodeMsgUpdateSubscription(). */
export interface MsgUpdateSubscriptionParams {
  /** Subscriber's sent1... address */
  from: string;
  /** Subscription ID */
  id: number | bigint;
  /** New renewal price policy */
  renewalPricePolicy: number;
}

/** Parameters for encodeMsgUpdateSession(). */
export interface MsgUpdateSessionParams {
  /** Session owner's sent1... address */
  from: string;
  /** Session ID */
  id: number | bigint;
  /** Updated download bytes */
  downloadBytes: string | number;
  /** Updated upload bytes */
  uploadBytes: string | number;
}

/** Parameters for encodeMsgRegisterNode(). */
export interface MsgRegisterNodeParams {
  /** Node operator's sent1... address */
  from: string;
  /** Per-GB pricing entries */
  gigabytePrices?: PriceEntry[];
  /** Per-hour pricing entries */
  hourlyPrices?: PriceEntry[];
  /** Remote addresses (URLs) the node is reachable at */
  remoteAddrs?: string[];
}

/** Parameters for encodeMsgUpdateNodeDetails(). */
export interface MsgUpdateNodeDetailsParams {
  /** Node operator's sent1... address */
  from: string;
  /** Updated per-GB pricing */
  gigabytePrices?: PriceEntry[];
  /** Updated per-hour pricing */
  hourlyPrices?: PriceEntry[];
  /** Updated remote addresses */
  remoteAddrs?: string[];
}

/** Parameters for encodeMsgUpdateNodeStatus(). */
export interface MsgUpdateNodeStatusParams {
  /** Node operator's sent1... address */
  from: string;
  /** New status: 1 = active, 2 = inactive */
  status: number;
}

/** Parameters for encodeMsgUpdatePlanDetails(). */
export interface MsgUpdatePlanDetailsParams {
  /** Plan owner's sent1... address */
  from: string;
  /** Plan ID */
  id: number | bigint;
  /** New bytes allowance (string) */
  bytes?: string;
  /** New duration in seconds or {seconds, nanos} */
  duration?: number | { seconds: number; nanos?: number };
  /** New prices */
  prices?: PriceEntry[];
}

/** Parameters for encodeMsgRegisterProvider(). */
export interface MsgRegisterProviderParams {
  /** Provider's sent1... address */
  from: string;
  /** Display name */
  name: string;
  /** Identity (e.g. Keybase ID) */
  identity?: string;
  /** Website URL */
  website?: string;
  /** Description */
  description?: string;
}

/** Parameters for encodeMsgUpdateProviderDetails(). */
export interface MsgUpdateProviderDetailsParams {
  /** Provider's sent1... address */
  from: string;
  /** Updated name */
  name?: string;
  /** Updated identity */
  identity?: string;
  /** Updated website */
  website?: string;
  /** Updated description */
  description?: string;
}

/** Parameters for encodeMsgUpdateProviderStatus(). */
export interface MsgUpdateProviderStatusParams {
  /** Provider's sent1... address */
  from: string;
  /** New status: 1 = active, 2 = inactive */
  status: number;
}

/** Parameters for encodeMsgCreatePlan(). */
export interface MsgCreatePlanParams {
  /** Plan owner's sent1... address */
  from: string;
  /** Bytes allowance per subscription (string) */
  bytes?: string;
  /** Duration per subscription (seconds or {seconds, nanos}) */
  duration?: number | { seconds: number; nanos?: number };
  /** Subscription price entries */
  prices?: PriceEntry[];
  /** Whether the plan is private (invite-only) */
  isPrivate?: boolean;
}

/** Parameters for encodeMsgUpdatePlanStatus(). */
export interface MsgUpdatePlanStatusParams {
  /** Plan owner's sent1... address */
  from: string;
  /** Plan ID */
  id: number | bigint;
  /** New status: 1 = active, 2 = inactive */
  status: number;
}

/** Parameters for encodeMsgLinkNode(). */
export interface MsgLinkNodeParams {
  /** Plan owner's sent1... address */
  from: string;
  /** Plan ID */
  id: number | bigint;
  /** sentnode1... address of the node to link */
  nodeAddress: string;
}

/** Parameters for encodeMsgUnlinkNode(). */
export interface MsgUnlinkNodeParams {
  /** Plan owner's sent1... address */
  from: string;
  /** Plan ID */
  id: number | bigint;
  /** sentnode1... address of the node to unlink */
  nodeAddress: string;
}

/** Parameters for encodeMsgPlanStartSession(). */
export interface MsgPlanStartSessionParams {
  /** Subscriber's sent1... address */
  from: string;
  /** Plan ID */
  id: number | bigint;
  /** Payment denomination (default: 'udvpn') */
  denom?: string;
  /** Renewal price policy */
  renewalPricePolicy?: number;
  /** Target node for the session */
  nodeAddress?: string;
}

/** Parameters for encodeMsgStartLease(). */
export interface MsgStartLeaseParams {
  /** Lessee's sent1... address */
  from: string;
  /** Node to lease from (sentnode1...) */
  nodeAddress: string;
  /** Lease duration in hours */
  hours: number;
  /** Maximum acceptable price */
  maxPrice?: PriceEntry;
  /** Renewal price policy */
  renewalPricePolicy?: number;
}

/** Parameters for encodeMsgEndLease(). */
export interface MsgEndLeaseParams {
  /** Lease holder's sent1... address */
  from: string;
  /** Lease ID */
  id: number | bigint;
}

// ─── Batch Operations ──────────────────────────────────────────────────────

/** Node configuration for buildBatchStartSession(). */
export interface BatchStartSessionNode {
  /** sentnode1... address */
  nodeAddress: string;
  /** GB to purchase (default: 1) */
  gigabytes?: number;
  /** Max acceptable price (required for batch to protect against price changes) */
  maxPrice: PriceEntry;
}

/** Recipient for buildBatchSend(). */
export interface BatchSendRecipient {
  /** Recipient's sent1... address */
  address: string;
  /** Amount in micro-denom (udvpn) */
  amountUdvpn: number | string;
}

/** Gas fee estimate from estimateBatchFee(). */
export interface BatchFeeEstimate {
  /** Estimated gas units */
  gas: number;
  /** Estimated fee in micro-denom */
  amount: number;
  /** CosmJS-compatible StdFee object ready for broadcast */
  fee: { amount: Array<{ denom: string; amount: string }>; gas: string };
}

/** Result from subscribeToPlan(). */
export interface SubscribeToPlanResult {
  /** New subscription ID */
  subscriptionId: bigint;
  /** Transaction hash */
  txHash: string;
}

/** Parsed chain duration from parseChainDuration(). */
export interface ParsedDuration {
  /** Total seconds */
  seconds: number;
  /** Hours component */
  hours: number;
  /** Minutes component */
  minutes: number;
  /** Human-readable string (e.g. "6d 10h 57m") */
  formatted: string;
}

// ─── Session Cost Estimation ───────────────────────────────────────────────

/** Result from estimateSessionCost(). */
export interface SessionCostEstimate {
  /** Cost in micro-denom for the session itself */
  udvpn: number;
  /** Cost in whole P2P tokens */
  dvpn: number;
  /** Estimated gas cost in micro-denom */
  gasUdvpn: number;
  /** Total cost (session + gas) in micro-denom */
  totalUdvpn: number;
  /** Which pricing mode was selected */
  mode: 'gigabyte' | 'hourly';
  /** Per-hour cost in micro-denom (null if node has no hourly pricing) */
  hourlyUdvpn: number | null;
  /** Per-GB cost in micro-denom (null if node has no GB pricing) */
  gigabyteUdvpn: number | null;
}

// ─── Endpoint Types ────────────────────────────────────────────────────────

/** RPC or LCD endpoint descriptor. */
export interface Endpoint {
  /** Full URL (e.g. 'https://lcd.sentinel.co') */
  url: string;
  /** Human-readable name (e.g. 'Sentinel Official') */
  name: string;
  /** ISO date when this endpoint was last verified reachable */
  verified: string;
}

/** Result from tryWithFallback(). */
export interface FallbackResult<T> {
  /** The operation result from the first successful endpoint */
  result: T;
  /** URL of the endpoint that succeeded */
  endpoint: string;
  /** Name of the endpoint that succeeded */
  endpointName: string;
}

/** Endpoint health check result (from checkEndpointHealth). */
export interface EndpointHealth {
  /** Endpoint URL */
  url: string;
  /** Endpoint name */
  name: string;
  /** Round-trip latency in ms (null if unreachable) */
  latencyMs: number | null;
}
