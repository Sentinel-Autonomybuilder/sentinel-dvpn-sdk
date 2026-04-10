#!/usr/bin/env node
/**
 * Pure logic tests — matches Go's 45 tests exactly.
 * NO chain calls, NO network, NO tokens. Instant and safe.
 */
import {
  formatP2P, formatPriceP2P, formatNodePricing, estimateSessionPrice,
  formatBytes, formatUptime, shortAddress, computeSessionAllocation,
  countryNameToCode, getFlagUrl, getFlagEmoji,
  GB_OPTIONS, HOUR_OPTIONS,
  DNS_PRESETS, DEFAULT_DNS_PRESET, DNS_FALLBACK_ORDER, resolveDnsServers,
  ErrorCodes, ERROR_SEVERITY, isRetryable, userMessage,
  APP_TYPES, APP_TYPE_CONFIG, validateAppConfig,
  cached, cacheInvalidate, diskSave, diskLoad,
  trackSession, getSessionMode, loadAppSettings, APP_SETTINGS_DEFAULTS,
} from './index.js';

let pass = 0, fail = 0;
function t(name, result) {
  if (result) { pass++; }
  else { fail++; console.log('  ✗', name); }
}

console.log('═══ HELPERS (19 tests) ═══');
// FormatP2P
t('formatP2P 40152030', formatP2P(40152030) === '40.15 P2P');
t('formatP2P 1000000', formatP2P(1000000) === '1.00 P2P');
t('formatP2P 0', formatP2P(0) === '0.00 P2P');

// FormatPriceP2P
t('formatPriceP2P 40152030', formatPriceP2P(40152030) === '40.15');
t('formatPriceP2P string', formatPriceP2P('1000000') === '1.00');

// FormatBytes
t('formatBytes 1.5GB', formatBytes(1500000000).includes('GB'));
t('formatBytes 250MB', formatBytes(250000000).includes('MB'));
t('formatBytes 1000', formatBytes(1000) === '1000 B' || formatBytes(1000).includes('KB'));
t('formatBytes 0', formatBytes(0) === '0 B');

// FormatUptime
t('formatUptime 2h2m', formatUptime(7350000) === '2h 2m');
t('formatUptime 1m30s', formatUptime(90000) === '1m 30s');
t('formatUptime 45s', formatUptime(45000) === '45s');
t('formatUptime 0', formatUptime(0) === '0s');

// ShortAddress
t('shortAddress', shortAddress('sent1example9pqrse8q4m6lz8alxqv5hkx3fkxe0q', 12, 6).includes('...'));

// ComputeAllocation GB-based
const allocGb = computeSessionAllocation({ downloadBytes: '500000000', uploadBytes: '100000000', maxBytes: '1000000000', max_duration: '0s' });
t('allocation GB percent', allocGb.usedPercent === 60);
t('allocation GB isGbBased', allocGb.isGbBased === true);

// ComputeAllocation hourly
const allocHr = computeSessionAllocation({ downloadBytes: '100000', uploadBytes: '50000', maxBytes: '1000000000', max_duration: '3600s' });
t('allocation hourly', allocHr.isHourlyBased === true);

// Options
t('GB_OPTIONS has 1 and 50', GB_OPTIONS.includes(1) && GB_OPTIONS.includes(50));
t('HOUR_OPTIONS has 1 and 24', HOUR_OPTIONS.includes(1) && HOUR_OPTIONS.includes(24));

console.log('═══ COUNTRY & FLAGS (13 tests) ═══');
t('Netherlands → NL', countryNameToCode('The Netherlands') === 'NL');
t('Türkiye → TR', countryNameToCode('Türkiye') === 'TR');
t('DR Congo → CD', countryNameToCode('DR Congo') === 'CD');
t('Czechia → CZ', countryNameToCode('Czechia') === 'CZ');
t('Russian Federation → RU', countryNameToCode('Russian Federation') === 'RU');
t('Viet Nam → VN', countryNameToCode('Viet Nam') === 'VN');
t('South Korea → KR', countryNameToCode('South Korea') === 'KR');
t('UAE → AE', countryNameToCode('UAE') === 'AE');
t('us → US', countryNameToCode('us') === 'US');
t('Atlantis → null', countryNameToCode('Atlantis') === null);
t('empty → null', countryNameToCode('') === null);
t('getFlagUrl US', getFlagUrl('US').includes('flagcdn.com'));
t('getFlagEmoji DE', getFlagEmoji('DE') === '🇩🇪');

console.log('═══ DNS (11 tests) ═══');
t('default is handshake', DEFAULT_DNS_PRESET === 'handshake');
t('3 presets', Object.keys(DNS_PRESETS).length === 3);
t('fallback order 3', DNS_FALLBACK_ORDER.length === 3);
t('resolve default has handshake', resolveDnsServers().includes('103.196.38.38'));
t('resolve default has google fallback', resolveDnsServers().includes('8.8.8.8'));
t('resolve default has cloudflare fallback', resolveDnsServers().includes('1.1.1.1'));
t('resolve google starts with 8.8.8.8', resolveDnsServers('google').startsWith('8.8.8.8'));
t('resolve google has handshake fallback', resolveDnsServers('google').includes('103.196.38.38'));
t('resolve cloudflare starts with 1.1.1.1', resolveDnsServers('cloudflare').startsWith('1.1.1.1'));
t('resolve custom has fallbacks', resolveDnsServers('9.9.9.9').includes('103.196.38.38'));
const dnsServers = resolveDnsServers().split(', ');
t('no duplicate DNS servers', dnsServers.length === new Set(dnsServers).size);

console.log('═══ ERRORS (15 tests) ═══');
const allCodes = Object.values(ErrorCodes);
t('33 error codes', allCodes.length === 33);
t('all have user messages', allCodes.every(c => userMessage(c) !== 'An unexpected error occurred.'));
t('unknown code → default', userMessage('FAKE_CODE') === 'An unexpected error occurred.');
t('INSUFFICIENT_BALANCE is fatal', ERROR_SEVERITY[ErrorCodes.INSUFFICIENT_BALANCE] === 'fatal');
t('NODE_OFFLINE is retryable', ERROR_SEVERITY[ErrorCodes.NODE_OFFLINE] === 'retryable');
t('SESSION_EXISTS is recoverable', ERROR_SEVERITY[ErrorCodes.SESSION_EXISTS] === 'recoverable');
t('V2RAY_NOT_FOUND is infrastructure', ERROR_SEVERITY[ErrorCodes.V2RAY_NOT_FOUND] === 'infrastructure');
t('isRetryable NODE_OFFLINE', isRetryable(ErrorCodes.NODE_OFFLINE) === true);
t('isRetryable INVALID_MNEMONIC', isRetryable(ErrorCodes.INVALID_MNEMONIC) === false);
t('userMessage INSUFFICIENT_BALANCE', userMessage(ErrorCodes.INSUFFICIENT_BALANCE).includes('P2P'));
t('userMessage NODE_OFFLINE', userMessage(ErrorCodes.NODE_OFFLINE).includes('offline'));
t('userMessage V2RAY_NOT_FOUND', userMessage(ErrorCodes.V2RAY_NOT_FOUND).includes('V2Ray'));
t('userMessage ABORTED', userMessage(ErrorCodes.ABORTED).includes('cancelled'));
t('userMessage INVALID_ASSIGNED_IP', userMessage(ErrorCodes.INVALID_ASSIGNED_IP).includes('invalid'));
t('userMessage CHAIN_LAG', userMessage(ErrorCodes.CHAIN_LAG).includes('confirmed'));

console.log('═══ APP TYPES (6 tests) ═══');
t('3 app types', Object.keys(APP_TYPES).length === 3);
t('WHITE_LABEL exists', APP_TYPES.WHITE_LABEL === 'white_label');
t('DIRECT_P2P exists', APP_TYPES.DIRECT_P2P === 'direct_p2p');
t('validate valid', validateAppConfig('white_label', { planId: 42, mnemonic: 'x' }).valid === true);
t('validate invalid', validateAppConfig('white_label', {}).valid === false);
t('validate bad type', validateAppConfig('fake', {}).valid === false);

console.log('═══ CACHE & SETTINGS (6 tests) ═══');
const v1 = await cached('logic-test', 5000, async () => 42);
const v2 = await cached('logic-test', 5000, async () => 99);
t('cached returns first', v1 === 42 && v2 === 42);
cacheInvalidate('logic-test');
const v3 = await cached('logic-test', 5000, async () => 77);
t('cache invalidate works', v3 === 77);
diskSave('logic-test-rt', { x: 1 });
t('diskSave + diskLoad', diskLoad('logic-test-rt', 60000)?.data?.x === 1);
trackSession('99999', 'hour');
t('trackSession', getSessionMode('99999') === 'hour');
const settings = loadAppSettings();
t('default settings', settings.dnsPreset === 'handshake' && settings.fullTunnel === true);
t('APP_SETTINGS_DEFAULTS', APP_SETTINGS_DEFAULTS.statusPollSec === 3);

// ═══ PRICING (5 tests) ═══
console.log('═══ PRICING (5 tests) ═══');
const mockNode = {
  gigabyte_prices: [{ denom: 'udvpn', quote_value: '40152030' }],
  hourly_prices: [{ denom: 'udvpn', quote_value: '18384000' }],
};
const pricing = formatNodePricing(mockNode);
t('formatNodePricing perGb', pricing.perGb?.includes('P2P/GB'));
t('formatNodePricing perHour', pricing.perHour?.includes('P2P/hr'));
t('formatNodePricing cheapest', pricing.cheapest === 'hour');
const gbCost = estimateSessionPrice(mockNode, 'gb', 5);
t('estimateSessionPrice gb', gbCost.costUdvpn > 0);
const hrCost = estimateSessionPrice(mockNode, 'hour', 4);
t('estimateSessionPrice hour', hrCost.costUdvpn > 0);

console.log(`\n═══ RESULTS: ${pass} passed, ${fail} failed (${pass + fail} total) ═══`);
process.exit(fail > 0 ? 1 : 0);
