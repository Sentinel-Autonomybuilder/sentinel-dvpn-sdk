/**
 * Sentinel AI Path — Decision Engine for Autonomous Agents
 *
 * An autonomous agent calls recommend() BEFORE connect().
 * It receives structured recommendations with alternatives,
 * cost estimates, warnings, and fallback strategies.
 *
 * The agent makes the final decision — the SDK never decides for it.
 */

import {
  queryOnlineNodes,
  fetchActiveNodes,
  filterNodes,
  getNodePrices,
  formatP2P,
  IS_ADMIN,
  WG_AVAILABLE,
  TRANSPORT_SUCCESS_RATES,
  COUNTRY_MAP,
} from '../index.js';

// ─── Country Proximity Map ──────────────────────────────────────────────────

const REGION_MAP = {
  // Western Europe
  'DE': ['AT', 'CH', 'NL', 'BE', 'LU', 'FR', 'CZ', 'PL', 'DK'],
  'FR': ['BE', 'LU', 'CH', 'DE', 'ES', 'IT', 'NL', 'GB'],
  'GB': ['IE', 'NL', 'FR', 'BE', 'DE', 'DK', 'NO'],
  'NL': ['BE', 'DE', 'GB', 'LU', 'FR', 'DK'],
  // Nordic
  'SE': ['NO', 'DK', 'FI', 'DE', 'NL', 'EE'],
  'NO': ['SE', 'DK', 'FI', 'GB', 'DE', 'NL'],
  'FI': ['SE', 'EE', 'NO', 'DK', 'LV', 'LT'],
  'DK': ['SE', 'NO', 'DE', 'NL', 'GB'],
  // Eastern Europe
  'PL': ['CZ', 'SK', 'DE', 'LT', 'UA', 'AT'],
  'CZ': ['SK', 'DE', 'AT', 'PL'],
  'RO': ['BG', 'HU', 'MD', 'UA', 'RS'],
  'UA': ['PL', 'RO', 'MD', 'HU', 'SK', 'CZ'],
  // Southern Europe
  'IT': ['CH', 'AT', 'FR', 'SI', 'HR'],
  'ES': ['PT', 'FR', 'IT'],
  'GR': ['BG', 'TR', 'CY', 'AL', 'MK', 'IT'],
  'TR': ['GR', 'BG', 'GE', 'CY'],
  // North America
  'US': ['CA', 'MX'],
  'CA': ['US'],
  // Asia
  'JP': ['KR', 'TW', 'HK', 'SG'],
  'KR': ['JP', 'TW', 'HK', 'SG'],
  'SG': ['MY', 'ID', 'TH', 'VN', 'HK', 'JP', 'KR', 'TW'],
  'IN': ['SG', 'AE', 'LK', 'BD'],
  'AE': ['IN', 'SG', 'BH', 'QA', 'SA'],
  // Oceania
  'AU': ['NZ', 'SG', 'JP'],
  'NZ': ['AU', 'SG'],
  // South America
  'BR': ['AR', 'CL', 'UY', 'CO'],
  'AR': ['BR', 'CL', 'UY'],
  // Africa
  'ZA': ['NA', 'BW', 'MZ', 'KE'],
};

/**
 * Get nearby countries sorted by proximity.
 */
function getNearbyCountries(countryCode) {
  const code = countryCode.toUpperCase();
  const nearby = REGION_MAP[code] || [];
  return nearby;
}

/**
 * Normalize a country input to ISO code.
 */
function toCountryCode(input) {
  if (!input) return null;
  const upper = input.toUpperCase().trim();
  if (upper.length === 2) return upper;
  // Check COUNTRY_MAP from SDK if available
  if (COUNTRY_MAP) {
    for (const [name, code] of Object.entries(COUNTRY_MAP)) {
      if (name.toUpperCase() === upper) return code;
    }
  }
  // Common names
  const common = {
    'GERMANY': 'DE', 'UNITED STATES': 'US', 'USA': 'US', 'UNITED KINGDOM': 'GB',
    'UK': 'GB', 'FRANCE': 'FR', 'JAPAN': 'JP', 'CANADA': 'CA', 'AUSTRALIA': 'AU',
    'NETHERLANDS': 'NL', 'SWITZERLAND': 'CH', 'SWEDEN': 'SE', 'NORWAY': 'NO',
    'SINGAPORE': 'SG', 'SOUTH KOREA': 'KR', 'KOREA': 'KR', 'INDIA': 'IN',
    'BRAZIL': 'BR', 'SPAIN': 'ES', 'ITALY': 'IT', 'TURKEY': 'TR', 'RUSSIA': 'RU',
    'UKRAINE': 'UA', 'POLAND': 'PL', 'ROMANIA': 'RO', 'FINLAND': 'FI',
    'DENMARK': 'DK', 'IRELAND': 'IE', 'PORTUGAL': 'PT', 'AUSTRIA': 'AT',
    'CZECH REPUBLIC': 'CZ', 'CZECHIA': 'CZ', 'HUNGARY': 'HU', 'BELGIUM': 'BE',
    'SOUTH AFRICA': 'ZA', 'ARGENTINA': 'AR', 'MEXICO': 'MX', 'COLOMBIA': 'CO',
    'HONG KONG': 'HK', 'TAIWAN': 'TW', 'THAILAND': 'TH', 'VIETNAM': 'VN',
    'INDONESIA': 'ID', 'MALAYSIA': 'MY', 'PHILIPPINES': 'PH', 'NEW ZEALAND': 'NZ',
    'UNITED ARAB EMIRATES': 'AE', 'UAE': 'AE', 'ISRAEL': 'IL',
  };
  return common[upper] || null;
}

// ─── recommend() ─────────────────────────────────────────────────────────────

/**
 * Generate structured recommendations for an autonomous AI agent.
 *
 * The agent provides its preferences. The SDK returns ranked options
 * with cost estimates, warnings, and fallback strategies.
 * The agent makes the final decision.
 *
 * @param {object} preferences
 * @param {string} [preferences.country] - Preferred country (name or ISO code)
 * @param {number} [preferences.budget] - Available budget in udvpn
 * @param {'reliability'|'cost'|'speed'|'location'} [preferences.priority='reliability'] - What matters most
 * @param {number} [preferences.gigabytes=1] - Planned data usage
 * @param {string} [preferences.protocol] - Force 'wireguard' or 'v2ray'
 * @param {boolean} [preferences.strictCountry=false] - If true, fail if exact country unavailable
 * @param {number} [preferences.maxNodes=50] - Max nodes to evaluate
 *
 * @returns {Promise<{
 *   action: 'connect'|'connect-fallback'|'cannot-connect',
 *   confidence: number,
 *   primary: object|null,
 *   alternatives: object[],
 *   fallbackStrategy: string,
 *   estimatedCost: { udvpn: number, p2p: string },
 *   warnings: string[],
 *   reasoning: string[],
 *   capabilities: { wireguard: boolean, v2ray: boolean, admin: boolean },
 * }>}
 */
export async function recommend(preferences = {}) {
  if (preferences && typeof preferences !== 'object') {
    throw new Error('recommend(): preferences must be an object or undefined');
  }
  const {
    country = null,
    budget = 0,
    priority = 'reliability',
    gigabytes = 1,
    protocol = null,
    strictCountry = false,
    maxNodes = 50,
  } = preferences;

  const warnings = [];
  const reasoning = [];
  const countryCode = toCountryCode(country);

  // ─── Capabilities assessment ───────────────────────────────────────────

  const canWG = WG_AVAILABLE && IS_ADMIN;
  const canV2 = true; // V2Ray always available if binary exists
  const capabilities = { wireguard: canWG, v2ray: canV2, admin: IS_ADMIN };

  if (protocol === 'wireguard' && !canWG) {
    warnings.push('WireGuard requested but not available (need admin + WireGuard installed). Falling back to V2Ray.');
    reasoning.push('Protocol constraint: WireGuard unavailable, using V2Ray');
  }
  if (!IS_ADMIN && WG_AVAILABLE) {
    warnings.push('WireGuard installed but not admin — running as admin unlocks faster WireGuard nodes');
  }

  // ─── Fetch nodes ───────────────────────────────────────────────────────

  reasoning.push('Fetching active nodes from chain...');
  let allNodes;
  try {
    // fetchActiveNodes returns raw chain data (no country/location).
    // If country filter needed, we need enriched data from queryOnlineNodes.
    if (countryCode) {
      reasoning.push('Country filter requested — probing nodes for location data...');
      allNodes = await queryOnlineNodes({ maxNodes: maxNodes * 3 });
    } else {
      allNodes = await fetchActiveNodes();
    }
    reasoning.push(`Found ${allNodes.length} active nodes`);
  } catch (err) {
    return {
      action: 'cannot-connect',
      confidence: 0,
      primary: null,
      alternatives: [],
      fallbackStrategy: 'none',
      estimatedCost: { udvpn: 0, p2p: '0 P2P' },
      warnings: [`Chain query failed: ${err.message}`],
      reasoning: ['Cannot fetch nodes — network may be unreachable'],
      capabilities,
    };
  }

  // ─── Filter by protocol ────────────────────────────────────────────────

  let candidates = [...allNodes];
  const effectiveProtocol = protocol === 'wireguard' && canWG ? 'wireguard'
    : protocol === 'v2ray' ? 'v2ray'
    : null; // auto

  // Only filter by protocol if nodes have service_type data (enriched/probed nodes).
  // Raw chain data from fetchActiveNodes() does NOT include service_type.
  const hasServiceType = candidates.some(n => n.service_type !== undefined || n.serviceType !== undefined);

  if (hasServiceType) {
    if (effectiveProtocol === 'wireguard') {
      candidates = candidates.filter(n => (n.service_type || n.serviceType) === 2);
      reasoning.push(`Filtered to ${candidates.length} WireGuard nodes`);
    } else if (effectiveProtocol === 'v2ray') {
      candidates = candidates.filter(n => (n.service_type || n.serviceType) === 1);
      reasoning.push(`Filtered to ${candidates.length} V2Ray nodes`);
    } else if (!canWG) {
      candidates = candidates.filter(n => (n.service_type || n.serviceType) === 1);
      reasoning.push(`No admin — filtered to ${candidates.length} V2Ray nodes`);
    }
  } else {
    reasoning.push(`${candidates.length} nodes from chain (protocol unknown until probe — connectAuto handles selection)`);
    if (!canWG) {
      reasoning.push('No admin — connectAuto will auto-select V2Ray nodes');
    }
  }

  // ─── Filter by country ─────────────────────────────────────────────────

  let exactCountryNodes = [];
  let nearbyNodes = [];
  let anyNodes = candidates;

  if (countryCode) {
    // Try exact country match
    exactCountryNodes = filterNodes(candidates, { country: countryCode });
    reasoning.push(`${exactCountryNodes.length} nodes in ${country} (${countryCode})`);

    if (exactCountryNodes.length === 0 && !strictCountry) {
      // Try nearby countries
      const nearby = getNearbyCountries(countryCode);
      reasoning.push(`No nodes in ${countryCode}. Checking nearby: ${nearby.join(', ')}`);

      for (const nc of nearby) {
        const found = filterNodes(candidates, { country: nc });
        if (found.length > 0) {
          nearbyNodes.push(...found.map(n => ({ ...n, _fallbackCountry: nc })));
          reasoning.push(`  Found ${found.length} nodes in ${nc}`);
        }
      }
    }
  }

  // ─── Score and rank ────────────────────────────────────────────────────

  function scoreNode(node, isExactCountry, isNearby) {
    let score = 50; // base

    // Protocol bonus
    const isWG = (node.service_type || node.serviceType) === 2;
    if (isWG) score += 15; // WireGuard more reliable

    // Country bonus
    if (isExactCountry) score += 30;
    else if (isNearby) score += 15;

    // Pricing bonus (cheaper = better if priority is cost)
    const gbPrices = node.gigabyte_prices || [];
    const udvpnPrice = gbPrices.find(p => p.denom === 'udvpn');
    const price = parseInt(udvpnPrice?.quote_value || udvpnPrice?.amount || '999999999', 10);
    if (priority === 'cost') {
      score += Math.max(0, 20 - (price / 50000)); // cheaper gets more points
    }

    // Quality score from SDK (if enriched)
    if (node.qualityScore) score += node.qualityScore * 0.2;

    // Peer count: fewer peers = less loaded
    if (node.peers !== undefined) {
      if (node.peers < 5) score += 10;
      else if (node.peers < 20) score += 5;
      else score -= 5;
    }

    return { ...node, _score: Math.round(score), _price: price, _isWG: isWG };
  }

  // Build ranked list
  const ranked = [];

  for (const n of exactCountryNodes) {
    ranked.push(scoreNode(n, true, false));
  }
  for (const n of nearbyNodes) {
    ranked.push(scoreNode(n, false, true));
  }
  // Fill rest from any nodes (not already included)
  const included = new Set(ranked.map(n => n.address || n.acc_address));
  for (const n of anyNodes) {
    const addr = n.address || n.acc_address;
    if (!included.has(addr)) {
      ranked.push(scoreNode(n, false, false));
    }
  }

  // Sort by score descending
  ranked.sort((a, b) => b._score - a._score);
  const top = ranked.slice(0, maxNodes);

  // ─── Build recommendation ──────────────────────────────────────────────

  if (top.length === 0) {
    return {
      action: 'cannot-connect',
      confidence: 0,
      primary: null,
      alternatives: [],
      fallbackStrategy: strictCountry ? 'fail' : 'none',
      estimatedCost: { udvpn: 0, p2p: '0 P2P' },
      warnings: [`No nodes available${country ? ` for ${country}` : ''}`],
      reasoning,
      capabilities,
    };
  }

  if (countryCode && exactCountryNodes.length === 0 && strictCountry) {
    return {
      action: 'cannot-connect',
      confidence: 0,
      primary: null,
      alternatives: top.slice(0, 5).map(formatNode),
      fallbackStrategy: 'fail — strictCountry is true',
      estimatedCost: { udvpn: 0, p2p: '0 P2P' },
      warnings: [`No nodes in ${country} (${countryCode}). strictCountry=true prevents fallback.`],
      reasoning,
      capabilities,
    };
  }

  const primary = top[0];
  const alternatives = top.slice(1, 6).map(formatNode);
  const gasCost = 40000;
  const sessionCost = (primary._price || 100000) * gigabytes;
  const totalCost = sessionCost + gasCost;

  // Budget check
  if (budget > 0 && budget < totalCost) {
    warnings.push(`Budget (${formatP2P(budget)}) may be insufficient for ${gigabytes} GB (estimated ${formatP2P(totalCost)})`);
  }

  // Determine action
  let action = 'connect';
  let confidence = 0.9;

  if (countryCode && exactCountryNodes.length === 0) {
    action = 'connect-fallback';
    confidence = 0.7;
    const fc = primary._fallbackCountry || 'nearest available';
    warnings.push(`Exact country ${country} not available. Recommending ${fc} as fallback.`);
    reasoning.push(`Fallback: ${country} → ${fc}`);
  }

  // Determine fallback strategy
  let fallbackStrategy = 'auto — SDK tries next node on failure';
  if (countryCode && exactCountryNodes.length > 0) {
    fallbackStrategy = `${exactCountryNodes.length} nodes in ${country}; SDK retries within country`;
  } else if (nearbyNodes.length > 0) {
    fallbackStrategy = `nearest-country — ${nearbyNodes.length} nodes in nearby countries`;
  }

  return {
    action,
    confidence,
    primary: formatNode(primary),
    alternatives,
    fallbackStrategy,
    estimatedCost: { udvpn: totalCost, p2p: formatP2P(totalCost) },
    warnings,
    reasoning,
    capabilities,
  };
}

/**
 * Format a node for the recommendation response.
 */
function formatNode(node) {
  return {
    address: node.address || node.acc_address,
    country: node.country || node._fallbackCountry || null,
    protocol: node._isWG ? 'wireguard' : 'v2ray',
    score: node._score || 0,
    pricePerGb: node._price ? { udvpn: node._price, p2p: formatP2P(node._price) } : null,
    peers: node.peers ?? null,
    reason: node._fallbackCountry
      ? `Fallback from requested country (nearest: ${node._fallbackCountry})`
      : node._score >= 80 ? 'High reliability score'
      : node._score >= 60 ? 'Good match'
      : 'Available',
  };
}
