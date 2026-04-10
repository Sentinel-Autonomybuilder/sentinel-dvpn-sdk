#!/usr/bin/env node
/**
 * ALL pure logic tests — every function that can be tested without chain/network.
 * Covers: formatting, encoding, address conversion, error system, DNS, cache,
 * settings, country map, pricing, app types, validation, state, credentials.
 */
import * as sdk from './index.js';

let pass = 0, fail = 0;
function t(name, result) {
  if (result) { pass++; }
  else { fail++; console.log('  ✗', name); }
}

// ═══ FORMAT HELPERS (12) ═══
console.log('═══ FORMAT HELPERS ═══');
t('formatP2P 40M', sdk.formatP2P(40152030) === '40.15 P2P');
t('formatP2P 1M', sdk.formatP2P(1000000) === '1.00 P2P');
t('formatP2P 0', sdk.formatP2P(0) === '0.00 P2P');
t('formatDvpn alias', sdk.formatDvpn(1000000) === '1.00 P2P');
t('formatPriceP2P', sdk.formatPriceP2P(40152030) === '40.15');
t('formatBytes GB', sdk.formatBytes(1500000000).includes('GB'));
t('formatBytes MB', sdk.formatBytes(250000000).includes('MB'));
t('formatBytes 0', sdk.formatBytes(0) === '0 B');
t('formatUptime 2h', sdk.formatUptime(7350000) === '2h 2m');
t('formatUptime 1m', sdk.formatUptime(90000) === '1m 30s');
t('formatUptime 45s', sdk.formatUptime(45000) === '45s');
t('formatUptime 0', sdk.formatUptime(0) === '0s');

// ═══ ADDRESS CONVERSION (6) ═══
console.log('═══ ADDRESS CONVERSION ═══');
t('shortAddress truncates', sdk.shortAddress('sent1example9pqrse8q4m6lz8alxqv5hkx3fkxe0q').includes('...'));
t('shortAddress short passthrough', sdk.shortAddress('sent1abc') === 'sent1abc');
t('sentToSentprov', sdk.sentToSentprov('sent1example9pqrse8q4m6lz8alxqv5hkx3fkxe0q').startsWith('sentprov'));
t('sentToSentnode', sdk.sentToSentnode('sent1example9pqrse8q4m6lz8alxqv5hkx3fkxe0q').startsWith('sentnode'));
t('sentprovToSent', sdk.sentprovToSent(sdk.sentToSentprov('sent1example9pqrse8q4m6lz8alxqv5hkx3fkxe0q')).startsWith('sent1'));
t('isSameKey cross-prefix', sdk.isSameKey('sent1example9pqrse8q4m6lz8alxqv5hkx3fkxe0q', sdk.sentToSentprov('sent1example9pqrse8q4m6lz8alxqv5hkx3fkxe0q')));

// ═══ VALIDATION (7) ═══
console.log('═══ VALIDATION ═══');
t('isMnemonicValid good', sdk.isMnemonicValid('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'));
t('isMnemonicValid bad (short)', !sdk.isMnemonicValid('not a valid mnemonic'));
t('isMnemonicValid bad (fake words)', !sdk.isMnemonicValid('a b c d e f g h i j k l'));
t('isMnemonicValid bad (checksum)', !sdk.isMnemonicValid('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon'));
t('validateCIDR ipv4', sdk.validateCIDR('10.8.0.1/32'));
t('validateCIDR ipv6', sdk.validateCIDR('fd00::/64'));
t('validateCIDR invalid', !sdk.validateCIDR('not-a-cidr'));

// ═══ COUNTRY MAP (13) ═══
console.log('═══ COUNTRY MAP ═══');
t('Netherlands', sdk.countryNameToCode('The Netherlands') === 'NL');
t('Türkiye', sdk.countryNameToCode('Türkiye') === 'TR');
t('DR Congo', sdk.countryNameToCode('DR Congo') === 'CD');
t('Czechia', sdk.countryNameToCode('Czechia') === 'CZ');
t('Russian Federation', sdk.countryNameToCode('Russian Federation') === 'RU');
t('Viet Nam', sdk.countryNameToCode('Viet Nam') === 'VN');
t('South Korea', sdk.countryNameToCode('South Korea') === 'KR');
t('UAE', sdk.countryNameToCode('UAE') === 'AE');
t('us lowercase', sdk.countryNameToCode('us') === 'US');
t('unknown null', sdk.countryNameToCode('Atlantis') === null);
t('empty null', sdk.countryNameToCode('') === null);
t('getFlagUrl', sdk.getFlagUrl('US').includes('flagcdn.com'));
t('getFlagEmoji', sdk.getFlagEmoji('DE') === '🇩🇪');

// ═══ DNS (11) ═══
console.log('═══ DNS ═══');
t('default handshake', sdk.DEFAULT_DNS_PRESET === 'handshake');
t('3 presets', Object.keys(sdk.DNS_PRESETS).length === 3);
t('fallback 3', sdk.DNS_FALLBACK_ORDER.length === 3);
t('resolve default has HNS', sdk.resolveDnsServers().includes('103.196.38.38'));
t('resolve default has google', sdk.resolveDnsServers().includes('8.8.8.8'));
t('resolve default has cloudflare', sdk.resolveDnsServers().includes('1.1.1.1'));
t('resolve google starts 8.8.8.8', sdk.resolveDnsServers('google').startsWith('8.8.8.8'));
t('resolve google has HNS fallback', sdk.resolveDnsServers('google').includes('103.196.38.38'));
t('resolve cloudflare starts 1.1.1.1', sdk.resolveDnsServers('cloudflare').startsWith('1.1.1.1'));
t('resolve custom has fallbacks', sdk.resolveDnsServers('9.9.9.9').includes('103.196.38.38'));
t('no duplicate DNS', new Set(sdk.resolveDnsServers().split(', ')).size === sdk.resolveDnsServers().split(', ').length);

// ═══ ERROR SYSTEM (20) ═══
console.log('═══ ERROR SYSTEM ═══');
t('33 error codes', Object.values(sdk.ErrorCodes).length === 33);
t('all have messages', Object.values(sdk.ErrorCodes).every(c => sdk.userMessage(c) !== 'An unexpected error occurred.'));
t('unknown default', sdk.userMessage('FAKE') === 'An unexpected error occurred.');
t('INSUFFICIENT fatal', sdk.ERROR_SEVERITY[sdk.ErrorCodes.INSUFFICIENT_BALANCE] === 'fatal');
t('NODE_OFFLINE retryable', sdk.ERROR_SEVERITY[sdk.ErrorCodes.NODE_OFFLINE] === 'retryable');
t('SESSION_EXISTS recoverable', sdk.ERROR_SEVERITY[sdk.ErrorCodes.SESSION_EXISTS] === 'recoverable');
t('V2RAY_NOT_FOUND infra', sdk.ERROR_SEVERITY[sdk.ErrorCodes.V2RAY_NOT_FOUND] === 'infrastructure');
t('isRetryable true', sdk.isRetryable(sdk.ErrorCodes.NODE_OFFLINE));
t('isRetryable false', !sdk.isRetryable(sdk.ErrorCodes.INVALID_MNEMONIC));
t('msg INSUFFICIENT', sdk.userMessage(sdk.ErrorCodes.INSUFFICIENT_BALANCE).includes('P2P'));
t('msg NODE_OFFLINE', sdk.userMessage(sdk.ErrorCodes.NODE_OFFLINE).includes('offline'));
t('msg V2RAY_NOT_FOUND', sdk.userMessage(sdk.ErrorCodes.V2RAY_NOT_FOUND).includes('V2Ray'));
t('msg WG_NOT_AVAILABLE', sdk.userMessage(sdk.ErrorCodes.WG_NOT_AVAILABLE).includes('WireGuard'));
t('msg ABORTED', sdk.userMessage(sdk.ErrorCodes.ABORTED).includes('cancelled'));
t('msg CHAIN_LAG', sdk.userMessage(sdk.ErrorCodes.CHAIN_LAG).includes('confirmed'));
t('msg INVALID_ASSIGNED_IP', sdk.userMessage(sdk.ErrorCodes.INVALID_ASSIGNED_IP).includes('invalid'));
t('msg NODE_DATABASE_CORRUPT', sdk.userMessage(sdk.ErrorCodes.NODE_DATABASE_CORRUPT).includes('corrupted'));
t('msg BROADCAST_FAILED', sdk.userMessage(sdk.ErrorCodes.BROADCAST_FAILED).includes('balance'));
t('msg SESSION_POISONED', sdk.userMessage(sdk.ErrorCodes.SESSION_POISONED).includes('poisoned'));
t('msg ALL_NODES_FAILED', sdk.userMessage(sdk.ErrorCodes.ALL_NODES_FAILED).includes('network'));

// ═══ APP TYPES (8) ═══
console.log('═══ APP TYPES ═══');
t('3 types', Object.keys(sdk.APP_TYPES).length === 3);
t('WHITE_LABEL', sdk.APP_TYPES.WHITE_LABEL === 'white_label');
t('DIRECT_P2P', sdk.APP_TYPES.DIRECT_P2P === 'direct_p2p');
t('ALL_IN_ONE', sdk.APP_TYPES.ALL_IN_ONE === 'all_in_one');
t('validate valid', sdk.validateAppConfig('white_label', { planId: 42, mnemonic: 'x' }).valid);
t('validate invalid', !sdk.validateAppConfig('white_label', {}).valid);
t('validate bad type', !sdk.validateAppConfig('fake', {}).valid);
t('getConnectDefaults', sdk.getConnectDefaults('direct_p2p', {}).dns === 'handshake');

// ═══ CACHE & PERSISTENCE (8) ═══
console.log('═══ CACHE & PERSISTENCE ═══');
const cv1 = await sdk.cached('all-logic-1', 5000, async () => 42);
const cv2 = await sdk.cached('all-logic-1', 5000, async () => 99);
t('cached TTL', cv1 === 42 && cv2 === 42);
sdk.cacheInvalidate('all-logic-1');
const cv3 = await sdk.cached('all-logic-1', 5000, async () => 77);
t('cache invalidate', cv3 === 77);
t('cacheInfo', sdk.cacheInfo('all-logic-1')?.hasData === true);
sdk.diskSave('all-logic-rt', { x: 1 });
t('diskSave+Load', sdk.diskLoad('all-logic-rt', 60000)?.data?.x === 1);
sdk.trackSession('77777', 'hour');
t('trackSession', sdk.getSessionMode('77777') === 'hour');
t('getAllTracked', typeof sdk.getAllTrackedSessions() === 'object');
const s = sdk.loadAppSettings();
t('loadAppSettings', s.dnsPreset === 'handshake' && s.fullTunnel === true);
t('APP_SETTINGS_DEFAULTS', sdk.APP_SETTINGS_DEFAULTS.statusPollSec === 3);

// ═══ PRICING (7) ═══
console.log('═══ PRICING ═══');
t('GB_OPTIONS', sdk.GB_OPTIONS.includes(1) && sdk.GB_OPTIONS.includes(50));
t('HOUR_OPTIONS', sdk.HOUR_OPTIONS.includes(1) && sdk.HOUR_OPTIONS.includes(24));
const mockNode = { gigabyte_prices: [{ denom: 'udvpn', quote_value: '40152030' }], hourly_prices: [{ denom: 'udvpn', quote_value: '18384000' }] };
const pr = sdk.formatNodePricing(mockNode);
t('formatNodePricing GB', pr.perGb?.includes('P2P/GB'));
t('formatNodePricing Hr', pr.perHour?.includes('P2P/hr'));
t('formatNodePricing cheapest', pr.cheapest === 'hour');
t('estimateSessionPrice gb', sdk.estimateSessionPrice(mockNode, 'gb', 5).costUdvpn > 0);
t('estimateSessionPrice hr', sdk.estimateSessionPrice(mockNode, 'hour', 4).costUdvpn > 0);

// ═══ SESSION ALLOCATION (4) ═══
console.log('═══ SESSION ALLOCATION ═══');
const aGb = sdk.computeSessionAllocation({ downloadBytes: '500000000', uploadBytes: '100000000', maxBytes: '1000000000', max_duration: '0s' });
t('allocation GB percent', aGb.usedPercent === 60);
t('allocation GB isGbBased', aGb.isGbBased === true);
const aHr = sdk.computeSessionAllocation({ downloadBytes: '100', uploadBytes: '50', maxBytes: '1000000000', max_duration: '3600s' });
t('allocation hourly', aHr.isHourlyBased === true);
t('allocation displays', aGb.usedDisplay.includes('MB') && aGb.maxDisplay.includes('GB'));

// ═══ CONSTANTS (12) ═══
console.log('═══ CONSTANTS ═══');
t('CHAIN_ID', sdk.CHAIN_ID === 'sentinelhub-2');
t('DENOM', sdk.DENOM === 'udvpn');
t('SDK_VERSION', typeof sdk.SDK_VERSION === 'string');
t('DEFAULT_RPC', sdk.DEFAULT_RPC.includes('rpc.sentinel'));
t('DEFAULT_LCD', sdk.DEFAULT_LCD.includes('lcd.sentinel'));
t('LCD_ENDPOINTS 4', sdk.LCD_ENDPOINTS.length === 4);
t('RPC_ENDPOINTS 5', sdk.RPC_ENDPOINTS.length === 5);
t('MSG_TYPES 28', Object.keys(sdk.MSG_TYPES).length === 28);
t('DEFAULT_TIMEOUTS', sdk.DEFAULT_TIMEOUTS.handshake === 90000);
t('COUNTRY_MAP 183+', Object.keys(sdk.COUNTRY_MAP).length >= 183);
t('bytesToMbps', sdk.bytesToMbps(1000000, 1) === 8);
t('TRANSPORT_SUCCESS_RATES', sdk.TRANSPORT_SUCCESS_RATES['tcp']?.rate === 1.0);

// ═══ PROTOBUF ENCODERS (14) ═══
console.log('═══ PROTOBUF ENCODERS ═══');
t('encodeMsgStartSession', typeof sdk.encodeMsgStartSession === 'function');
t('encodeMsgEndSession', typeof sdk.encodeMsgEndSession === 'function');
t('encodeMsgStartSubscription', typeof sdk.encodeMsgStartSubscription === 'function');
t('encodeMsgCancelSubscription', typeof sdk.encodeMsgCancelSubscription === 'function');
t('encodeMsgRenewSubscription', typeof sdk.encodeMsgRenewSubscription === 'function');
t('encodeMsgShareSubscription', typeof sdk.encodeMsgShareSubscription === 'function');
t('encodeMsgUpdateSubscription', typeof sdk.encodeMsgUpdateSubscription === 'function');
t('encodeMsgUpdateSession', typeof sdk.encodeMsgUpdateSession === 'function');
t('encodeMsgRegisterNode', typeof sdk.encodeMsgRegisterNode === 'function');
t('encodeMsgUpdateNodeDetails', typeof sdk.encodeMsgUpdateNodeDetails === 'function');
t('encodeMsgUpdateNodeStatus', typeof sdk.encodeMsgUpdateNodeStatus === 'function');
t('encodeMsgUpdatePlanDetails', typeof sdk.encodeMsgUpdatePlanDetails === 'function');
t('encodeMsgCreatePlan', typeof sdk.encodeMsgCreatePlan === 'function');
t('encodeMsgSubStartSession', typeof sdk.encodeMsgSubStartSession === 'function');

// ═══ NODE DISPLAY (3) ═══
console.log('═══ NODE DISPLAY ═══');
const nd = sdk.buildNodeDisplay({ address: 'sentnode1test', gigabyte_prices: [{ denom: 'udvpn', quote_value: '40152030' }], hourly_prices: [] }, { type: 'wireguard', moniker: 'Test', location: { country: 'Germany', city: 'Berlin' } });
t('buildNodeDisplay has flag', nd.flagUrl?.includes('flagcdn'));
t('buildNodeDisplay protocol WG', nd.protocol === 'WG');
const groups = sdk.groupNodesByCountry([nd]);
t('groupNodesByCountry', groups.length === 1 && groups[0].country === 'Germany');

// ═══ SERIALIZATION (2) ═══
console.log('═══ SERIALIZATION ═══');
const sr = sdk.serializeResult({ sessionId: BigInt(12345678901234), nodeAddress: 'sentnode1test' });
t('serializeResult BigInt→string', typeof sr.sessionId === 'string');
t('serializeResult preserves fields', sr.nodeAddress === 'sentnode1test');

console.log(`\n═══ RESULTS: ${pass} passed, ${fail} failed (${pass + fail} total) ═══`);
process.exit(fail > 0 ? 1 : 0);
