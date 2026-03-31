/**
 * Sentinel AI Path — Cost Estimation & Budget Planning
 *
 * An AI agent uses these to estimate costs before committing tokens.
 */

import {
  estimateSessionCost,
  estimateSessionPrice,
  formatP2P,
  PRICING_REFERENCE,
  DENOM,
} from '../index.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Reference pricing from the SDK. Based on network-wide observations.
 *
 * @type {{
 *   typicalPerGb: { udvpn: number, p2p: string },
 *   minBalance: { udvpn: number, p2p: string },
 *   gasCost: { udvpn: number, p2p: string },
 *   denom: string,
 * }}
 */
/**
 * Reference pricing sampled from chain data (2026-03-26, 1030 nodes).
 * THESE ARE APPROXIMATE — node operators set their own prices and can change
 * them at any time. Use estimateCost({ nodeAddress }) for live per-node pricing.
 *   Median: ~40 P2P/GB (40152030 udvpn at sample time)
 *   Cheapest: ~0.68 P2P/GB (680000 udvpn at sample time)
 */
export const PRICING = {
  medianPerGb: {
    udvpn: 40152030,
    p2p: formatP2P(40152030),
  },
  cheapestPerGb: {
    udvpn: 680000,
    p2p: formatP2P(680000),
  },
  typicalPerGb: {
    udvpn: 40152030,
    p2p: formatP2P(40152030),
  },
  minBalance: {
    udvpn: 50000000, // 50 P2P — enough for 1 GB on median node + gas
    p2p: formatP2P(50000000),
  },
  gasCost: {
    udvpn: 40000,
    p2p: formatP2P(40000),
  },
  denom: DENOM || 'udvpn',
};

// ─── estimateCost() ──────────────────────────────────────────────────────────

/**
 * Estimate connection cost before committing tokens.
 *
 * @param {object} opts
 * @param {number} [opts.gigabytes=1] - Planned data usage in GB
 * @param {number} [opts.hours] - Planned session duration in hours (alternative to GB)
 * @param {number} [opts.budget] - Available budget in udvpn — calculates how much you can get
 * @param {string} [opts.nodeAddress] - Specific node for exact pricing (queries chain)
 * @returns {Promise<{
 *   perGb: { udvpn: number, p2p: string },
 *   total: { udvpn: number, p2p: string },
 *   gas: { udvpn: number, p2p: string },
 *   grandTotal: { udvpn: number, p2p: string },
 *   forBudget?: { gigabytes: number, hours: number|null },
 *   mode: 'per-gb'|'hourly'|'estimate',
 * }>}
 */
export async function estimateCost(opts = {}) {
  if (opts && typeof opts !== 'object') {
    throw new Error('estimateCost(): opts must be an object or undefined');
  }
  const gb = opts.gigabytes || 1;
  const gasCost = 40000; // ~0.04 P2P per TX

  // If specific node given, get exact price
  if (opts.nodeAddress) {
    try {
      const price = await estimateSessionPrice(opts.nodeAddress, gb);
      const total = price.udvpn || price.amount || 0;
      const grandTotal = total + gasCost;

      const result = {
        perGb: { udvpn: Math.round(total / gb), p2p: formatP2P(Math.round(total / gb)) },
        total: { udvpn: total, p2p: formatP2P(total) },
        gas: { udvpn: gasCost, p2p: formatP2P(gasCost) },
        grandTotal: { udvpn: grandTotal, p2p: formatP2P(grandTotal) },
        mode: opts.hours ? 'hourly' : 'per-gb',
      };

      if (opts.budget) {
        const usable = opts.budget - gasCost;
        const pricePerGb = Math.round(total / gb);
        result.forBudget = {
          gigabytes: pricePerGb > 0 ? Math.floor(usable / pricePerGb) : 0,
          hours: null,
        };
      }

      return result;
    } catch {
      // Fall through to estimate
    }
  }

  // Network-wide estimate based on real chain pricing (median across 1030 nodes)
  const typicalPerGb = PRICING.typicalPerGb.udvpn;
  const total = typicalPerGb * gb;
  const grandTotal = total + gasCost;

  const result = {
    perGb: { udvpn: typicalPerGb, p2p: formatP2P(typicalPerGb) },
    total: { udvpn: total, p2p: formatP2P(total) },
    gas: { udvpn: gasCost, p2p: formatP2P(gasCost) },
    grandTotal: { udvpn: grandTotal, p2p: formatP2P(grandTotal) },
    mode: 'estimate',
  };

  if (opts.budget) {
    const usable = opts.budget - gasCost;
    result.forBudget = {
      gigabytes: typicalPerGb > 0 ? Math.floor(usable / typicalPerGb) : 0,
      hours: null,
    };
  }

  return result;
}
