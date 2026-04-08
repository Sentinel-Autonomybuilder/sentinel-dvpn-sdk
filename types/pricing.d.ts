/**
 * Sentinel SDK — Pricing & Display Types
 *
 * Types for pricing display, cost estimation, country mapping,
 * and UI builder helpers. These are NOT protocol functions --
 * they're UX helpers that every consumer app needs.
 */

import type { PriceEntry } from './chain.js';

// ─── Price Display ─────────────────────────────────────────────────────────

/** Formatted node pricing for UI display. From formatNodePricing(). */
export interface NodePricingDisplay {
  /** Per-GB price string (e.g. '0.04 P2P/GB') or null if no GB pricing */
  perGb: string | null;
  /** Per-hour price string (e.g. '0.02 P2P/hr') or null if no hourly pricing */
  perHour: string | null;
  /** Which pricing model is cheaper (null if only one model available) */
  cheapest: 'gb' | 'hour' | null;
  /** Raw per-GB price in micro-denom (null if unavailable) */
  gbRaw: number | null;
  /** Raw per-hour price in micro-denom (null if unavailable) */
  hrRaw: number | null;
}

/** Session cost estimate from estimateSessionPrice(). */
export interface SessionPriceEstimate {
  /** Formatted cost string (e.g. '0.20 P2P') or 'N/A' if pricing unavailable */
  cost: string;
  /** Cost in micro-denom (0 if unavailable) */
  costUdvpn: number;
  /** Pricing model used */
  model: 'gb' | 'hour';
  /** Amount (GB or hours) */
  amount: number;
  /** Unit label ('GB' or 'hours') */
  unit: string;
}

// ─── Country Info ──────────────────────────────────────────────────────────

/**
 * Country name to ISO 3166-1 alpha-2 code map.
 * Includes 80+ countries with standard names, chain variants
 * (e.g. 'The Netherlands', 'Turkiye'), and short codes.
 */
export type CountryMap = Readonly<Record<string, string>>;

// ─── Node Display ──────────────────────────────────────────────────────────

/** Display-ready node object from buildNodeDisplay(). Ready for UI rendering. */
export interface NodeDisplay {
  /** sentnode1... address */
  address: string;
  /** Node display name (null if not probed) */
  moniker: string | null;
  /** Country name (null if not probed) */
  country: string | null;
  /** ISO 3166-1 alpha-2 country code (null if unknown) */
  countryCode: string | null;
  /** City name (null if not probed) */
  city: string | null;
  /** Flag image URL from flagcdn.com (null if no country code) */
  flagUrl: string | null;
  /** Emoji flag for web display (empty string if no country code) */
  flagEmoji: string;
  /** Service type string (null if not probed) */
  serviceType: string | null;
  /** Short protocol label for UI: 'WG' | 'V2' | null */
  protocol: 'WG' | 'V2' | null;
  /** Formatted pricing from formatNodePricing() */
  pricing: NodePricingDisplay;
  /** Current peer count */
  peers: number;
  /** Maximum peer count */
  maxPeers: number;
  /** Node software version */
  version: string | null;
  /** Whether the node responded to status probe */
  online: boolean;
}

/** Country group for sidebar display. From groupNodesByCountry(). */
export interface CountryGroup {
  /** Country name */
  country: string;
  /** ISO country code */
  countryCode: string;
  /** Flag image URL */
  flagUrl: string;
  /** Emoji flag */
  flagEmoji: string;
  /** All nodes in this country */
  nodes: NodeDisplay[];
  /** Number of online nodes */
  onlineCount: number;
  /** Total nodes (online + offline) */
  totalCount: number;
}

// ─── Pricing Reference ─────────────────────────────────────────────────────

/**
 * Static pricing reference for cost estimation UI.
 * These are APPROXIMATE values from chain data -- actual prices vary per node.
 * Always use estimateCost() or getNodePrices() for live data.
 */
export interface PricingReference {
  /** When these values were last verified */
  verified: string;
  /** Disclaimer about accuracy */
  note: string;
  session: {
    /** Typical session cost in P2P (0.04-0.15 per GB) */
    typicalCostDvpn: number;
    /** Minimum recommended wallet balance in P2P */
    minBalanceDvpn: number;
    /** Minimum recommended wallet balance in micro-denom */
    minBalanceUdvpn: number;
  };
  gasPerMsg: {
    /** Gas for MsgStartSession (~200k) */
    startSession: number;
    /** Gas for subscription + session (~250k) */
    startSubscription: number;
    /** Gas for MsgCreatePlan (~300k) */
    createPlan: number;
    /** Gas for MsgStartLease (~250k) */
    startLease: number;
    /** Gas for batch of 5 MsgStartSession (~800k) */
    batchOf5: number;
  };
  averageNodePrices: {
    /** Average per-GB price in micro-denom */
    gigabyteQuoteValue: string;
    /** Average per-hour price in micro-denom */
    hourlyQuoteValue: string;
    /** Typical base_value (sdk.Dec string) */
    baseValue: string;
  };
}

// ─── Session Duration Presets ──────────────────────────────────────────────

/**
 * Common hour options for hourly session selection UI.
 * Values: [1, 2, 4, 8, 12, 24]
 */
export type HourOptions = number[];

/**
 * Common GB options for per-GB session selection UI.
 * Values: [1, 2, 5, 10, 25, 50]
 */
export type GbOptions = number[];
