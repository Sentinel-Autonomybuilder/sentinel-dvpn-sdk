/**
 * Sentinel AI Path — Node Discovery & Selection
 *
 * An AI agent uses these functions to find the best node for its needs:
 * budget, location, protocol, speed.
 */

import {
  queryOnlineNodes,
  fetchActiveNodes,
  filterNodes,
  getNodePrices,
  getNetworkOverview,
  groupNodesByCountry,
  formatP2P,
  TRANSPORT_SUCCESS_RATES,
} from '../index.js';

// ─── discoverNodes() ─────────────────────────────────────────────────────────

/**
 * Discover available nodes with optional filters.
 * Returns enriched node list sorted by quality score.
 *
 * @param {object} [opts]
 * @param {string} [opts.country] - Filter by country name or code (e.g. 'Germany', 'DE')
 * @param {string} [opts.protocol] - Filter by protocol: 'wireguard' or 'v2ray'
 * @param {number} [opts.maxPrice] - Max price in udvpn per GB (filter expensive nodes)
 * @param {number} [opts.limit] - Max nodes to return (default: 50)
 * @param {boolean} [opts.quick] - If true, use chain-only data (fast, no probing). Default: false
 * @param {function} [opts.onProgress] - Progress callback: ({ total, probed, online }) => void
 * @returns {Promise<Array<{
 *   address: string,
 *   country: string|null,
 *   protocol: string,
 *   pricePerGb: { udvpn: number, p2p: string },
 *   pricePerHour: { udvpn: number, p2p: string }|null,
 *   score: number,
 *   peers: number,
 *   remoteUrl: string,
 * }>>}
 */
export async function discoverNodes(opts = {}) {
  if (opts && typeof opts !== 'object') {
    throw new Error('discoverNodes(): opts must be an object or undefined');
  }
  const limit = opts.limit || 50;
  let nodes;

  if (opts.quick) {
    // Fast path: chain data only, no individual node probing
    nodes = await fetchActiveNodes();
  } else {
    // Full path: probe each node for status, country, peers, score
    nodes = await queryOnlineNodes({
      maxNodes: Math.min(limit * 3, 300), // Over-fetch to have room after filtering
      onNodeProbed: opts.onProgress || undefined,
    });
  }

  // Apply filters
  if (opts.country) {
    nodes = filterNodes(nodes, { country: opts.country });
  }
  if (opts.protocol) {
    const wantType = opts.protocol === 'wireguard' ? 2 : 1;
    nodes = nodes.filter(n => n.service_type === wantType || n.serviceType === wantType);
  }

  // Enrich with clean structure
  const enriched = nodes.map(n => {
    const gbPrices = n.gigabyte_prices || [];
    const hrPrices = n.hourly_prices || [];
    const udvpnGb = gbPrices.find(p => p.denom === 'udvpn');
    const udvpnHr = hrPrices.find(p => p.denom === 'udvpn');

    const pricePerGb = udvpnGb ? {
      udvpn: parseInt(udvpnGb.quote_value || udvpnGb.amount || '0', 10),
      p2p: formatP2P(parseInt(udvpnGb.quote_value || udvpnGb.amount || '0', 10)),
    } : null;

    const pricePerHour = udvpnHr ? {
      udvpn: parseInt(udvpnHr.quote_value || udvpnHr.amount || '0', 10),
      p2p: formatP2P(parseInt(udvpnHr.quote_value || udvpnHr.amount || '0', 10)),
    } : null;

    return {
      address: n.address || n.acc_address,
      country: n.country || n.location?.country || null,
      protocol: (n.service_type === 2 || n.serviceType === 2) ? 'wireguard' : 'v2ray',
      pricePerGb,
      pricePerHour,
      score: n.qualityScore ?? n.score ?? 0,
      peers: n.peers ?? 0,
      remoteUrl: n.remote_addrs?.[0] || n.remote_url || '',
    };
  });

  // Filter by max price
  if (opts.maxPrice && opts.maxPrice > 0) {
    const filtered = enriched.filter(n =>
      n.pricePerGb && n.pricePerGb.udvpn <= opts.maxPrice
    );
    if (filtered.length > 0) {
      return filtered.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, limit);
    }
  }

  // Sort by score descending, slice to limit
  const sorted = enriched.sort((a, b) => (b.score || 0) - (a.score || 0));
  const result = sorted.slice(0, limit);
  // Attach total count so consumers know the full network size
  result.total = sorted.length;
  result.showing = result.length;
  return result;
}

// ─── getNodeInfo() ───────────────────────────────────────────────────────────

/**
 * Get detailed info for a specific node including pricing.
 *
 * @param {string} nodeAddress - sentnode1... address
 * @returns {Promise<{ address: string, prices: object, online: boolean, country: string|null }>}
 */
export async function getNodeInfo(nodeAddress) {
  const prices = await getNodePrices(nodeAddress);
  return {
    address: nodeAddress,
    prices,
    online: true, // If getNodePrices didn't throw, node is reachable
  };
}

// ─── getNetworkStats() ───────────────────────────────────────────────────────

/**
 * Get network-wide statistics for an AI agent to understand the landscape.
 *
 * @returns {Promise<{
 *   totalNodes: number,
 *   byCountry: Record<string, number>,
 *   byProtocol: { wireguard: number, v2ray: number },
 *   transportReliability: Record<string, number>,
 * }>}
 */
export async function getNetworkStats() {
  const overview = await getNetworkOverview();
  return {
    totalNodes: overview.totalNodes || overview.total || 0,
    byCountry: overview.byCountry || {},
    byProtocol: overview.byProtocol || { wireguard: 0, v2ray: 0 },
    transportReliability: { ...TRANSPORT_SUCCESS_RATES },
  };
}
