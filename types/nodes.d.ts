/**
 * Sentinel SDK — Node Types
 *
 * Types for querying, filtering, scoring, and displaying Sentinel dVPN nodes.
 * Covers: online node queries, node enrichment, geographic indexing,
 * node filtering, and display-ready objects for UI rendering.
 */

import type { PriceEntry, ChainNode } from './chain.js';

// ─── Node Query Options ────────────────────────────────────────────────────

/** Options for queryOnlineNodes() / listNodes(). */
export interface ListNodesOptions {
  /** LCD URL (default: cascading fallback across 4 endpoints) */
  lcdUrl?: string;
  /**
   * Maximum nodes to probe for status (default: 100).
   * Set higher to discover more of the network (900+ active nodes total).
   */
  maxNodes?: number;
  /** Filter by service type (null = all) */
  serviceType?: 'wireguard' | 'v2ray' | null;
  /** Concurrency for node probing (default: 30) */
  concurrency?: number;
  /** Progress callback: called after each batch of nodes is probed */
  onNodeProbed?: (progress: NodeProbeProgress) => void;
  /** Skip quality-score sorting (default: false) */
  skipSort?: boolean;
  /** Bypass 5-minute node cache and force fresh scan (default: false) */
  noCache?: boolean;
  /** Skip cache entirely and wait for fresh results (default: false) */
  waitForFresh?: boolean;
}

/** Progress callback data for node probing. */
export interface NodeProbeProgress {
  /** Total nodes to probe */
  total: number;
  /** Nodes probed so far */
  probed: number;
  /** Nodes found online so far */
  online: number;
}

/** Options for enrichNodes(). */
export interface EnrichNodesOptions {
  /** Concurrency for status probes (default: 30) */
  concurrency?: number;
  /** Per-node probe timeout in ms (default: 8000) */
  timeout?: number;
  /** Progress callback */
  onProgress?: (progress: { total: number; done: number; enriched: number }) => void;
}

// ─── Scored Node ───────────────────────────────────────────────────────────

/**
 * Node with quality scoring applied. Returned by queryOnlineNodes() and enrichNodes().
 * Sorted by qualityScore (highest first).
 */
export interface ScoredNode {
  /** sentnode1... address */
  address: string;
  /** Node's HTTPS remote URL */
  remoteUrl: string;
  /** Service type: 'wireguard' or 'v2ray' */
  serviceType: string;
  /** Node display name */
  moniker: string;
  /** Country name (as reported by node) */
  country: string;
  /** City name */
  city: string;
  /** Current peer count */
  peers: number;
  /**
   * Clock drift in seconds (null if unknown).
   * Nodes with |drift| > 120s are penalized (VMess breaks).
   */
  clockDriftSec: number | null;
  /**
   * Quality score 0-100. Higher is better.
   * Factors: WG preferred over V2Ray, low peers, low drift, udvpn pricing.
   */
  qualityScore: number;
  /** Per-GB pricing entries from LCD */
  gigabytePrices: PriceEntry[];
  /** Per-hour pricing entries from LCD */
  hourlyPrices: PriceEntry[];
}

// ─── Node Filter ───────────────────────────────────────────────────────────

/** Criteria for filterNodes(). All fields are optional (AND logic). */
export interface NodeFilter {
  /** Filter by country name or ISO code */
  country?: string;
  /** Filter by service type */
  serviceType?: 'wireguard' | 'v2ray';
  /** Maximum price in P2P per GB */
  maxPriceDvpn?: number;
  /** Minimum quality score (0-100) */
  minScore?: number;
}

// ─── Node Score ────────────────────────────────────────────────────────────

/** Standardized price extraction result from getNodePrices(). */
export interface NodePrices {
  /** Per-GB pricing */
  gigabyte: {
    /** Price in whole P2P tokens */
    dvpn: number;
    /** Price in micro-denom (udvpn) */
    udvpn: number;
    /** Raw chain price object (null if node has no GB pricing) */
    raw: PriceEntry | null;
  };
  /** Per-hour pricing */
  hourly: {
    /** Price in whole P2P tokens */
    dvpn: number;
    /** Price in micro-denom (udvpn) */
    udvpn: number;
    /** Raw chain price object (null if node has no hourly pricing) */
    raw: PriceEntry | null;
  };
  /** Token denomination (always 'udvpn') */
  denom: string;
  /** sentnode1... address */
  nodeAddress: string;
}

// ─── Geographic Index ──────────────────────────────────────────────────────

/** Geographic index from buildNodeIndex(). Enables instant country/city lookups. */
export interface NodeIndex {
  /** Nodes grouped by country name */
  countries: Record<string, ScoredNode[]>;
  /** Nodes grouped by city name */
  cities: Record<string, ScoredNode[]>;
  /** Summary statistics */
  stats: {
    totalNodes: number;
    totalCountries: number;
    totalCities: number;
    byCountry: Array<{ country: string; count: number }>;
  };
}

// ─── Network Overview ──────────────────────────────────────────────────────

/** Network overview from getNetworkOverview(). Perfect for dashboards. */
export interface NetworkOverview {
  /** Total active nodes on the network */
  totalNodes: number;
  /** Node count by country */
  byCountry: Array<{ country: string; count: number }>;
  /** Node count by service type */
  byType: {
    wireguard: number;
    v2ray: number;
    unknown: number;
  };
  /** Average prices across all nodes */
  averagePrice: {
    /** Average per-GB price in P2P tokens */
    gigabyteDvpn: number;
    /** Average per-hour price in P2P tokens */
    hourlyDvpn: number;
  };
  /** Raw node data */
  nodes: unknown[];
}

// ─── Broken Nodes ──────────────────────────────────────────────────────────

/** Known broken node entry from BROKEN_NODES blacklist. */
export interface BrokenNode {
  /** sentnode1... address */
  address: string;
  /** Reason the node is broken */
  reason: string;
  /** Date when the node was verified broken */
  verified: string;
}
