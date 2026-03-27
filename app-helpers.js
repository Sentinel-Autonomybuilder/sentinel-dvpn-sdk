/**
 * Sentinel SDK — App Builder Helpers
 *
 * Utilities for building consumer dVPN applications:
 * - Country name → ISO code mapping (80+ countries on Sentinel network)
 * - Flag URL/emoji helpers
 * - Node pricing display formatters (GB + hourly)
 * - Session cost estimation for both pricing models
 *
 * These are NOT protocol functions — they're UI/UX helpers that every
 * consumer app needs but shouldn't have to build from scratch.
 */

// ─── Country Name → ISO Code Map ────────────────────────────────────────────
// Comprehensive map of all country names returned by Sentinel nodes.
// Includes standard names, variant names (chain returns these), and short codes.
// 80+ countries confirmed on the Sentinel network as of 2026-03.

export const COUNTRY_MAP = Object.freeze({
  // Standard names
  'united states': 'US', 'germany': 'DE', 'france': 'FR', 'united kingdom': 'GB',
  'netherlands': 'NL', 'canada': 'CA', 'japan': 'JP', 'singapore': 'SG',
  'australia': 'AU', 'brazil': 'BR', 'india': 'IN', 'south korea': 'KR',
  'turkey': 'TR', 'romania': 'RO', 'poland': 'PL', 'spain': 'ES',
  'italy': 'IT', 'sweden': 'SE', 'norway': 'NO', 'finland': 'FI',
  'switzerland': 'CH', 'austria': 'AT', 'ireland': 'IE', 'portugal': 'PT',
  'czech republic': 'CZ', 'hungary': 'HU', 'bulgaria': 'BG', 'greece': 'GR',
  'ukraine': 'UA', 'russia': 'RU', 'hong kong': 'HK', 'taiwan': 'TW',
  'thailand': 'TH', 'vietnam': 'VN', 'indonesia': 'ID', 'philippines': 'PH',
  'mexico': 'MX', 'argentina': 'AR', 'chile': 'CL', 'colombia': 'CO',
  'south africa': 'ZA', 'israel': 'IL', 'united arab emirates': 'AE',
  'nigeria': 'NG', 'latvia': 'LV', 'lithuania': 'LT', 'estonia': 'EE',
  'croatia': 'HR', 'serbia': 'RS', 'denmark': 'DK', 'belgium': 'BE',
  'luxembourg': 'LU', 'malta': 'MT', 'cyprus': 'CY', 'iceland': 'IS',
  'new zealand': 'NZ', 'malaysia': 'MY', 'bangladesh': 'BD', 'pakistan': 'PK',
  'egypt': 'EG', 'kenya': 'KE', 'morocco': 'MA', 'peru': 'PE',
  'venezuela': 'VE', 'georgia': 'GE', 'guatemala': 'GT', 'puerto rico': 'PR',
  'china': 'CN', 'saudi arabia': 'SA', 'kazakhstan': 'KZ', 'mongolia': 'MN',
  'slovakia': 'SK', 'albania': 'AL', 'moldova': 'MD', 'jamaica': 'JM',
  'bolivia': 'BO', 'ecuador': 'EC', 'uruguay': 'UY', 'bahrain': 'BH',
  'dr congo': 'CD', 'costa rica': 'CR', 'panama': 'PA', 'paraguay': 'PY',
  'dominican republic': 'DO', 'el salvador': 'SV', 'honduras': 'HN',
  'nicaragua': 'NI', 'cuba': 'CU', 'haiti': 'HT', 'trinidad and tobago': 'TT',

  // Variant names the chain actually returns
  'the netherlands': 'NL',
  'türkiye': 'TR',
  'turkiye': 'TR',
  'czechia': 'CZ',
  'russian federation': 'RU',
  'viet nam': 'VN',
  'korea': 'KR',
  'republic of korea': 'KR',
  'uae': 'AE',
  'uk': 'GB',
  'usa': 'US',
  'democratic republic of the congo': 'CD',
  'congo': 'CD',

  // Short codes (some nodes return these directly)
  'us': 'US', 'de': 'DE', 'fr': 'FR', 'gb': 'GB', 'nl': 'NL', 'ca': 'CA',
  'jp': 'JP', 'sg': 'SG', 'au': 'AU', 'br': 'BR', 'in': 'IN', 'kr': 'KR',
  'tr': 'TR', 'ro': 'RO', 'pl': 'PL', 'es': 'ES', 'it': 'IT', 'se': 'SE',
  'no': 'NO', 'fi': 'FI', 'ch': 'CH', 'at': 'AT', 'ie': 'IE', 'pt': 'PT',
  'cz': 'CZ', 'hu': 'HU', 'bg': 'BG', 'gr': 'GR', 'ua': 'UA', 'ru': 'RU',
  'hk': 'HK', 'tw': 'TW', 'th': 'TH', 'vn': 'VN', 'id': 'ID', 'ph': 'PH',
  'mx': 'MX', 'ar': 'AR', 'cl': 'CL', 'co': 'CO', 'za': 'ZA', 'il': 'IL',
  'ae': 'AE', 'ng': 'NG', 'lv': 'LV', 'lt': 'LT', 'ee': 'EE', 'hr': 'HR',
  'rs': 'RS', 'dk': 'DK', 'be': 'BE', 'lu': 'LU', 'mt': 'MT', 'cy': 'CY',
  'is': 'IS', 'nz': 'NZ', 'my': 'MY', 'bd': 'BD', 'pk': 'PK', 'eg': 'EG',
  'ke': 'KE', 'ma': 'MA', 'pe': 'PE', 've': 'VE', 'ge': 'GE', 'gt': 'GT',
  'pr': 'PR', 'cn': 'CN', 'sa': 'SA', 'kz': 'KZ', 'mn': 'MN', 'sk': 'SK',
  'al': 'AL', 'md': 'MD', 'jm': 'JM', 'bo': 'BO', 'ec': 'EC', 'uy': 'UY',
  'bh': 'BH', 'cd': 'CD',
});

/**
 * Convert a country name to ISO 3166-1 alpha-2 code.
 * Handles standard names, chain variants ("The Netherlands", "Türkiye"),
 * and short codes. Falls back to fuzzy contains matching.
 *
 * @param {string} name - Country name from node status
 * @returns {string|null} ISO code (uppercase) or null if unknown
 */
export function countryNameToCode(name) {
  if (!name) return null;
  const lower = name.trim().toLowerCase();

  // Exact match
  const exact = COUNTRY_MAP[lower];
  if (exact) return exact;

  // Already a 2-letter code?
  if (lower.length === 2) return lower.toUpperCase();

  // Fuzzy: find first key that contains or is contained by the input
  for (const [key, code] of Object.entries(COUNTRY_MAP)) {
    if (key.length > 2 && (lower.includes(key) || key.includes(lower))) {
      return code;
    }
  }

  return null;
}

// ─── Flag Helpers ────────────────────────────────────────────────────────────

/**
 * Get flag image URL from flagcdn.com.
 * Use for native apps (WPF, Electron) where emoji flags don't render.
 *
 * @param {string} code - ISO 3166-1 alpha-2 code (e.g. 'US')
 * @param {number} [width=40] - Image width in pixels (flagcdn supports 16-256)
 * @returns {string} URL to PNG flag image
 */
export function getFlagUrl(code, width = 40) {
  if (!code || code.length !== 2) return '';
  return `https://flagcdn.com/w${width}/${code.toLowerCase()}.png`;
}

/**
 * Get emoji flag for a country code (for web apps / browsers).
 * Uses regional indicator symbols — works in Chrome, Firefox, Safari.
 * Does NOT work in WPF/WinForms — use getFlagUrl() for native Windows apps.
 *
 * @param {string} code - ISO 3166-1 alpha-2 code (e.g. 'US')
 * @returns {string} Emoji flag string (e.g. '🇺🇸')
 */
export function getFlagEmoji(code) {
  if (!code || code.length !== 2) return '';
  const upper = code.toUpperCase();
  return String.fromCodePoint(
    upper.charCodeAt(0) + 0x1F1A5,
    upper.charCodeAt(1) + 0x1F1A5,
  );
}

// ─── Pricing Display Helpers ────────────────────────────────────────────────

/**
 * Parse a chain price entry into a human-readable P2P amount.
 * Chain prices use udvpn (micro denomination, 6 decimals).
 *
 * @param {string|number} udvpnAmount - Raw udvpn amount (e.g. "40152030" or 40152030)
 * @param {number} [decimals=2] - Decimal places
 * @returns {string} Formatted price (e.g. "40.15")
 */
export function formatPriceP2P(udvpnAmount, decimals = 2) {
  const raw = typeof udvpnAmount === 'string' ? parseInt(udvpnAmount, 10) : udvpnAmount;
  if (!raw || isNaN(raw)) return '0.00';
  return (raw / 1_000_000).toFixed(decimals);
}

/**
 * Format a node's pricing for display in a UI.
 * Returns both GB and hourly prices when available.
 *
 * @param {object} node - Chain node object with gigabyte_prices / hourly_prices
 * @returns {{ perGb: string|null, perHour: string|null, cheapest: 'gb'|'hour'|null }}
 *
 * @example
 * const p = formatNodePricing(node);
 * // { perGb: '0.04 P2P/GB', perHour: '0.02 P2P/hr', cheapest: 'hour' }
 */
export function formatNodePricing(node) {
  const gbPrice = _extractUdvpnPrice(node.gigabyte_prices || node.GigabytePrices);
  const hrPrice = _extractUdvpnPrice(node.hourly_prices || node.HourlyPrices);

  const perGb = gbPrice ? `${formatPriceP2P(gbPrice)} P2P/GB` : null;
  const perHour = hrPrice ? `${formatPriceP2P(hrPrice)} P2P/hr` : null;

  let cheapest = null;
  if (gbPrice && hrPrice) {
    // Rough comparison: 1 GB ≈ 1 hour of streaming at 10Mbps
    // But for user display, we just show both and let them pick
    cheapest = hrPrice < gbPrice ? 'hour' : 'gb';
  } else if (gbPrice) {
    cheapest = 'gb';
  } else if (hrPrice) {
    cheapest = 'hour';
  }

  return { perGb, perHour, cheapest, gbRaw: gbPrice, hrRaw: hrPrice };
}

/**
 * Estimate session cost for a given duration/amount.
 *
 * @param {object} node - Chain node with pricing
 * @param {'gb'|'hour'} model - Pricing model
 * @param {number} amount - GB or hours
 * @returns {{ cost: string, costUdvpn: number, model: string, amount: number }}
 */
export function estimateSessionPrice(node, model, amount) {
  const pricing = formatNodePricing(node);
  const raw = model === 'hour' ? pricing.hrRaw : pricing.gbRaw;
  if (!raw) return { cost: 'N/A', costUdvpn: 0, model, amount };
  const totalUdvpn = raw * amount;
  return {
    cost: `${formatPriceP2P(totalUdvpn)} P2P`,
    costUdvpn: totalUdvpn,
    model,
    amount,
    unit: model === 'hour' ? 'hours' : 'GB',
  };
}

/** Extract udvpn price from a chain price array (filter for denom='udvpn'). */
function _extractUdvpnPrice(prices) {
  if (!prices || !Array.isArray(prices)) return null;
  for (const p of prices) {
    const denom = p.denom || p.Denom;
    if (denom === 'udvpn') {
      const val = p.quote_value || p.base_value || p.amount || p.QuoteValue || p.BaseValue;
      if (val) return parseInt(String(val), 10);
    }
  }
  return null;
}

// ─── Node Display Helpers ───────────────────────────────────────────────────

/**
 * Build a display-ready node object for UI rendering.
 * Combines chain data with status enrichment.
 *
 * @param {object} chainNode - Raw chain node
 * @param {object} [status] - Optional node status from nodeStatusV3()
 * @returns {object} Display-ready node with all fields apps need
 */
export function buildNodeDisplay(chainNode, status = null) {
  const country = status?.location?.country || status?.Location?.Country || null;
  const code = countryNameToCode(country);

  return {
    address: chainNode.address,
    moniker: status?.moniker || status?.Moniker || null,
    country,
    countryCode: code,
    city: status?.location?.city || status?.Location?.City || null,
    flagUrl: code ? getFlagUrl(code) : null,
    flagEmoji: code ? getFlagEmoji(code) : '',
    serviceType: status?.type || status?.ServiceType || null,
    protocol: status?.type === 'wireguard' ? 'WG' : status?.type === 'v2ray' ? 'V2' : null,
    pricing: formatNodePricing(chainNode),
    peers: status?.peers || status?.Peers || 0,
    maxPeers: status?.max_peers || status?.MaxPeers || 0,
    version: status?.version || status?.Version || null,
    online: status !== null,
  };
}

/**
 * Group nodes by country for sidebar display.
 *
 * @param {object[]} nodes - Array of display-ready nodes (from buildNodeDisplay)
 * @returns {object[]} Sorted array of { country, countryCode, flagUrl, flagEmoji, nodes[], onlineCount, totalCount }
 */
export function groupNodesByCountry(nodes) {
  const groups = new Map();

  for (const node of nodes) {
    const key = node.countryCode || 'ZZ'; // ZZ = unknown
    if (!groups.has(key)) {
      groups.set(key, {
        country: node.country || 'Unknown',
        countryCode: key,
        flagUrl: node.flagUrl || '',
        flagEmoji: node.flagEmoji || '',
        nodes: [],
        onlineCount: 0,
        totalCount: 0,
      });
    }
    const g = groups.get(key);
    g.nodes.push(node);
    g.totalCount++;
    if (node.online) g.onlineCount++;
  }

  // Sort: most nodes first, unknown last
  return [...groups.values()].sort((a, b) => {
    if (a.countryCode === 'ZZ') return 1;
    if (b.countryCode === 'ZZ') return -1;
    return b.onlineCount - a.onlineCount;
  });
}

// ─── Session Duration Helpers ───────────────────────────────────────────────

/** Common hour options for hourly session selection UI. */
export const HOUR_OPTIONS = [1, 2, 4, 8, 12, 24];

/** Common GB options for per-GB session selection UI. */
export const GB_OPTIONS = [1, 2, 5, 10, 25, 50];

// ─── Display Formatters ─────────────────────────────────────────────────────

/**
 * Format milliseconds into human-readable uptime.
 * @param {number} ms - Milliseconds
 * @returns {string} e.g. "2h 15m", "5m 30s", "45s"
 */
export function formatUptime(ms) {
  if (!ms || ms < 0) return '0s';
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * Format bytes into human-readable size.
 * @param {number|string} bytes
 * @returns {string} e.g. "1.5 GB", "250 MB", "12 KB"
 */
export function formatBytes(bytes) {
  const b = typeof bytes === 'string' ? parseInt(bytes, 10) : bytes;
  if (!b || isNaN(b) || b === 0) return '0 B';
  if (b >= 1e9) return (b / 1e9).toFixed(2) + ' GB';
  if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB';
  if (b >= 1e3) return (b / 1e3).toFixed(0) + ' KB';
  return b + ' B';
}

/**
 * Compute session allocation stats from chain session data.
 * Works for both GB-based and hourly sessions.
 *
 * @param {object} session - Chain session with downloadBytes, uploadBytes, maxBytes, duration, maxDuration
 * @returns {{ usedBytes: number, maxBytes: number, remainingBytes: number, usedPercent: number,
 *             usedDisplay: string, maxDisplay: string, remainingDisplay: string,
 *             isGbBased: boolean, isHourlyBased: boolean }}
 */
export function computeSessionAllocation(session) {
  const dl = parseInt(session.downloadBytes || session.download_bytes || '0', 10);
  const ul = parseInt(session.uploadBytes || session.upload_bytes || '0', 10);
  const max = parseInt(session.maxBytes || session.max_bytes || '0', 10);
  const maxDuration = session.maxDuration || session.max_duration || '0s';

  const usedBytes = dl + ul;
  const remainingBytes = Math.max(0, max - usedBytes);
  const usedPercent = max > 0 ? Math.min(100, (usedBytes / max) * 100) : 0;

  // GB-based: maxDuration is "0s". Hourly: maxDuration is "3600s" or similar.
  const isHourlyBased = maxDuration !== '0s' && maxDuration !== '0' && maxDuration !== null;
  const isGbBased = !isHourlyBased;

  return {
    usedBytes,
    maxBytes: max,
    remainingBytes,
    usedPercent: Math.round(usedPercent * 10) / 10,
    usedDisplay: formatBytes(usedBytes),
    maxDisplay: formatBytes(max),
    remainingDisplay: formatBytes(remainingBytes),
    isGbBased,
    isHourlyBased,
  };
}
