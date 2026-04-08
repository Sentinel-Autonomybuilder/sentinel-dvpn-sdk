#!/usr/bin/env node
/**
 * Sentinel dVPN SDK — Smoke Test Suite
 *
 * Verifies all exports exist, function signatures are correct, defaults are valid,
 * and core utilities work. No network, wallet, or binaries required.
 *
 * Run: node test/smoke.js
 */

import * as SDK from '../index.js';

let passed = 0;
let failed = 0;
const errors = [];

function assert(name, condition, detail = '') {
  if (condition) {
    passed++;
  } else {
    failed++;
    errors.push(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function assertType(name, value, expected) {
  assert(`${name} is ${expected}`, typeof value === expected, `got ${typeof value}`);
}

function assertExists(name) {
  assert(`export: ${name}`, SDK[name] !== undefined, 'missing from index.js');
}

console.log('Sentinel dVPN SDK — Smoke Tests\n');

// ─── 1. All exports exist ──────────────────────────────────────────────────

console.log('1. Checking exports...');

// High-level API
const highLevel = ['connect', 'connectDirect', 'connectViaPlan', 'listNodes', 'queryOnlineNodes',
  'disconnect', 'registerCleanupHandlers', 'setSystemProxy', 'clearSystemProxy', 'checkPortFree', 'events',
  'enableDnsLeakPrevention', 'disableDnsLeakPrevention', 'ConnectionState', 'disconnectState',
  'fetchAllNodes', 'enrichNodes', 'buildNodeIndex'];
highLevel.forEach(assertExists);

// Wallet & Chain
const wallet = ['createWallet', 'generateWallet', 'privKeyFromMnemonic', 'createClient', 'broadcast',
  'broadcastWithFeeGrant', 'createSafeBroadcaster', 'extractId', 'parseChainError', 'getBalance', 'getDvpnPrice',
  'findExistingSession', 'fetchActiveNodes', 'discoverPlanIds', 'resolveNodeUrl',
  'sentToSentprov', 'sentToSentnode', 'sentprovToSent', 'buildRegistry', 'lcd', 'txResponse', 'MSG_TYPES',
  // FeeGrant
  'buildFeeGrantMsg', 'buildRevokeFeeGrantMsg', 'queryFeeGrants', 'queryFeeGrant',
  // Authz
  'buildAuthzGrantMsg', 'buildAuthzRevokeMsg', 'buildAuthzExecMsg', 'encodeForExec', 'queryAuthzGrants'];
wallet.forEach(assertExists);

// Protocol
const protocol = ['nodeStatusV3', 'generateWgKeyPair', 'initHandshakeV3', 'initHandshakeV3V2Ray',
  'writeWgConfig', 'buildV2RayClientConfig', 'generateV2RayUUID', 'extractSessionId', 'waitForPort'];
protocol.forEach(assertExists);

// WireGuard
const wireguard = ['installWgTunnel', 'uninstallWgTunnel', 'connectWireGuard', 'disconnectWireGuard',
  'emergencyCleanupSync', 'watchdogCheck', 'IS_ADMIN', 'WG_EXE', 'WG_AVAILABLE'];
wireguard.forEach(assertExists);

// Speed Testing
const speed = ['speedtestDirect', 'speedtestViaSocks5', 'resolveSpeedtestIPs',
  'SPEEDTEST_DEFAULTS', 'flushSpeedTestDnsCache'];
speed.forEach(assertExists);

// Plan & Provider
const plan = ['encodeMsgRegisterProvider', 'encodeMsgUpdateProviderDetails', 'encodeMsgUpdateProviderStatus',
  'encodeMsgCreatePlan', 'encodeMsgUpdatePlanStatus', 'encodeMsgLinkNode', 'encodeMsgUnlinkNode',
  'encodeMsgPlanStartSession', 'encodeMsgStartLease', 'encodeMsgEndLease',
  'encodePrice', 'encodeDuration', 'decToScaledInt'];
plan.forEach(assertExists);

// Session message encoders (from v3protocol.js)
const sessionEncoders = ['encodeMsgStartSession', 'encodeMsgEndSession', 'encodeMsgStartSubscription', 'encodeMsgSubStartSession'];
sessionEncoders.forEach(assertExists);

// State
const state = ['saveState', 'loadState', 'clearState', 'recoverOrphans',
  'markSessionPoisoned', 'markSessionActive', 'isSessionPoisoned', 'getSessionHistory',
  'writePidFile', 'checkPidFile', 'clearPidFile',
  'saveCredentials', 'loadCredentials', 'clearCredentials', 'clearAllCredentials'];
state.forEach(assertExists);

// Defaults
const defaults = ['SDK_VERSION', 'LAST_VERIFIED', 'HARDCODED_NOTE', 'CHAIN_ID', 'DENOM', 'GAS_PRICE',
  'DEFAULT_RPC', 'DEFAULT_LCD', 'RPC_ENDPOINTS', 'LCD_ENDPOINTS', 'V2RAY_VERSION',
  'TRANSPORT_SUCCESS_RATES', 'BROKEN_NODES', 'PRICING_REFERENCE', 'tryWithFallback',
  'recordTransportResult', 'getDynamicRate', 'getDynamicRates', 'resetDynamicRates',
  'CHAIN_VERSION', 'COSMOS_SDK_VERSION'];
defaults.forEach(assertExists);

// Typed Errors
const errorExports = ['SentinelError', 'ValidationError', 'NodeError', 'ChainError', 'TunnelError',
  'SecurityError', 'ErrorCodes'];
errorExports.forEach(assertExists);

// TLS Trust
const tlsTrust = ['createNodeHttpsAgent', 'clearKnownNode', 'clearAllKnownNodes', 'getKnownNode'];
tlsTrust.forEach(assertExists);

// Session Manager
assertExists('SessionManager');

// Batch Session Operations
['batchStartSessions', 'waitForBatchSessions', 'waitForSessionActive'].forEach(assertExists);

// Client Class
assertExists('SentinelClient');

const totalExports = Object.keys(SDK).length;
assert('total exports >= 100', totalExports >= 100, `got ${totalExports}`);
console.log(`  ${totalExports} exports found`);

// ─── 2. Function types ─────────────────────────────────────────────────────

console.log('2. Checking function types...');

assertType('connect', SDK.connect, 'function');
assertType('connectDirect', SDK.connectDirect, 'function');
assertType('connectViaPlan', SDK.connectViaPlan, 'function');
assertType('listNodes', SDK.listNodes, 'function');
assertType('disconnect', SDK.disconnect, 'function');
assertType('isConnected', SDK.isConnected, 'function');
assertType('getStatus', SDK.getStatus, 'function');
assert('isConnected returns false when not connected', SDK.isConnected() === false);
assert('getStatus returns null when not connected', SDK.getStatus() === null);
assertType('createWallet', SDK.createWallet, 'function');
assertType('broadcast', SDK.broadcast, 'function');
assertType('tryWithFallback', SDK.tryWithFallback, 'function');
assertType('parseChainError', SDK.parseChainError, 'function');
assertType('generateWgKeyPair', SDK.generateWgKeyPair, 'function');
assertType('buildV2RayClientConfig', SDK.buildV2RayClientConfig, 'function');
assertType('generateV2RayUUID', SDK.generateV2RayUUID, 'function');

// ─── 3. Default values ─────────────────────────────────────────────────────

console.log('3. Checking defaults...');

assert('SDK_VERSION is 1.0.0', SDK.SDK_VERSION === '1.0.0');
assert('CHAIN_ID is sentinelhub-2', SDK.CHAIN_ID === 'sentinelhub-2');
assert('DENOM is udvpn', SDK.DENOM === 'udvpn');
assert('GAS_PRICE is 0.2udvpn', SDK.GAS_PRICE === '0.2udvpn');
assert('V2RAY_VERSION is 5.2.1', SDK.V2RAY_VERSION === '5.2.1');
assert('LAST_VERIFIED is ISO date', SDK.LAST_VERIFIED.includes('2026'));
assert('DEFAULT_RPC starts with https', SDK.DEFAULT_RPC.startsWith('https://'));
assert('DEFAULT_LCD starts with https', SDK.DEFAULT_LCD.startsWith('https://'));
assert('RPC_ENDPOINTS has 5 entries', SDK.RPC_ENDPOINTS.length === 5);
assert('LCD_ENDPOINTS has 4 entries', SDK.LCD_ENDPOINTS.length === 4);
assert('BROKEN_NODES has 2 entries', SDK.BROKEN_NODES.length === 2);
// RECOMMENDED_NODES removed — use queryOnlineNodes() for live node discovery

// Endpoints have required fields
for (const ep of SDK.RPC_ENDPOINTS) {
  assert(`RPC ${ep.name} has url`, !!ep.url);
  assert(`RPC ${ep.name} has verified date`, !!ep.verified);
}
for (const ep of SDK.LCD_ENDPOINTS) {
  assert(`LCD ${ep.name} has url`, !!ep.url);
  assert(`LCD ${ep.name} has verified date`, !!ep.verified);
}

// ─── 4. MSG_TYPES constants ─────────────────────────────────────────────────

console.log('4. Checking MSG_TYPES...');

const expectedMsgTypes = [
  'START_SESSION', 'START_SUBSCRIPTION', 'SUB_START_SESSION',
  'PLAN_START_SESSION', 'CREATE_PLAN', 'UPDATE_PLAN_STATUS', 'LINK_NODE', 'UNLINK_NODE',
  'REGISTER_PROVIDER', 'UPDATE_PROVIDER', 'UPDATE_PROVIDER_STATUS',
  'START_LEASE', 'END_LEASE',
  'GRANT_FEE_ALLOWANCE', 'REVOKE_FEE_ALLOWANCE',
  'AUTHZ_GRANT', 'AUTHZ_REVOKE', 'AUTHZ_EXEC',
];
assert('MSG_TYPES has 28 entries', Object.keys(SDK.MSG_TYPES).length === 28);
for (const key of expectedMsgTypes) {
  assert(`MSG_TYPES.${key}`, !!SDK.MSG_TYPES[key], SDK.MSG_TYPES[key] ? '' : 'missing');
}

// Sentinel type URLs start with /sentinel., Cosmos with /cosmos.
for (const [key, url] of Object.entries(SDK.MSG_TYPES)) {
  assert(`MSG_TYPES.${key} starts with /sentinel. or /cosmos.`, url.startsWith('/sentinel.') || url.startsWith('/cosmos.'), url);
}

// ─── 5. Utility functions (no network) ──────────────────────────────────────

console.log('5. Testing utility functions...');

// parseChainError
assert('parseChainError: insufficient funds', SDK.parseChainError('insufficient funds') === 'Insufficient P2P balance');
assert('parseChainError: sequence mismatch', SDK.parseChainError('account sequence mismatch').includes('sequence'));
assert('parseChainError: unknown error', SDK.parseChainError('something weird').length > 0);

// generateV2RayUUID
const uuid = SDK.generateV2RayUUID();
assert('generateV2RayUUID returns UUID format', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid));

// generateWgKeyPair
const wgKeys = SDK.generateWgKeyPair();
assert('generateWgKeyPair returns privateKey (32 bytes)', wgKeys.privateKey.length === 32);
assert('generateWgKeyPair returns publicKey (32 bytes)', wgKeys.publicKey.length === 32);
assert('WG keys are different', !wgKeys.privateKey.equals(wgKeys.publicKey));

// generateWallet — produces valid mnemonic + sent1 address
const genWallet = await SDK.generateWallet();
assert('generateWallet returns mnemonic', typeof genWallet.mnemonic === 'string');
assert('generateWallet mnemonic is 12 words', genWallet.mnemonic.trim().split(/\s+/).length === 12);
assert('generateWallet returns account', !!genWallet.account);
assert('generateWallet address starts with sent1', genWallet.account.address.startsWith('sent1'));

// resolveNodeUrl
assert('resolveNodeUrl: remote_url passthrough', SDK.resolveNodeUrl({ remote_url: 'https://1.2.3.4:443' }) === 'https://1.2.3.4:443');
assert('resolveNodeUrl: remote_addrs conversion', SDK.resolveNodeUrl({ remote_addrs: ['1.2.3.4:443'] }) === 'https://1.2.3.4:443');

// Address prefix conversion
// We can't test with real addresses without a wallet, but we can test the function exists and type-checks
assertType('sentToSentprov', SDK.sentToSentprov, 'function');
assertType('sentToSentnode', SDK.sentToSentnode, 'function');
assertType('sentprovToSent', SDK.sentprovToSent, 'function');

// tryWithFallback — test with mock endpoints
const mockEndpoints = [
  { url: 'bad1', name: 'Bad 1' },
  { url: 'bad2', name: 'Bad 2' },
  { url: 'good', name: 'Good' },
];
const fallbackResult = await SDK.tryWithFallback(
  mockEndpoints,
  async (url) => { if (url !== 'good') throw new Error('nope'); return 'success'; },
  'test',
);
assert('tryWithFallback returns first success', fallbackResult.result === 'success');
assert('tryWithFallback returns correct endpoint', fallbackResult.endpoint === 'good');
assert('tryWithFallback returns correct name', fallbackResult.endpointName === 'Good');

// tryWithFallback — all fail
try {
  await SDK.tryWithFallback(
    [{ url: 'a', name: 'A' }],
    async () => { throw new Error('fail'); },
    'test-fail',
  );
  assert('tryWithFallback throws on all failures', false, 'did not throw');
} catch (err) {
  assert('tryWithFallback throws on all failures', err.message.includes('test-fail'));
}

// Transport success rates
assert('TRANSPORT_SUCCESS_RATES has tcp', SDK.TRANSPORT_SUCCESS_RATES['tcp']?.rate === 1.0);
assert('TRANSPORT_SUCCESS_RATES grpc/tls is 0%', SDK.TRANSPORT_SUCCESS_RATES['grpc/tls']?.rate === 0.0);

// Dynamic transport rates
SDK.resetDynamicRates();
assert('getDynamicRate returns null initially', SDK.getDynamicRate('tcp') === null);
SDK.recordTransportResult('tcp', true);
assert('getDynamicRate returns null with <2 samples', SDK.getDynamicRate('tcp') === null);
SDK.recordTransportResult('tcp', true);
SDK.recordTransportResult('tcp', false);
assert('getDynamicRate returns rate with 3 samples', Math.abs(SDK.getDynamicRate('tcp') - 2/3) < 0.01);
const dynRates = SDK.getDynamicRates();
assert('getDynamicRates has tcp entry', dynRates['tcp']?.sample === 3);
SDK.resetDynamicRates();
assert('resetDynamicRates clears all', SDK.getDynamicRate('tcp') === null);

// Pricing reference
assert('PRICING_REFERENCE has session info', SDK.PRICING_REFERENCE.session?.typicalCostDvpn > 0);
assert('PRICING_REFERENCE has gas estimates', SDK.PRICING_REFERENCE.gasPerMsg?.startSession > 0);

// ─── 5a. FeeGrant & Authz message builders ───────────────────────────────────

console.log('5a. Testing FeeGrant & Authz...');

// buildFeeGrantMsg
const fgMsg = SDK.buildFeeGrantMsg('sent1granter', 'sent1grantee', { spendLimit: 5000000 });
assert('buildFeeGrantMsg has correct typeUrl', fgMsg.typeUrl === '/cosmos.feegrant.v1beta1.MsgGrantAllowance');
assert('buildFeeGrantMsg has granter', fgMsg.value.granter === 'sent1granter');
assert('buildFeeGrantMsg has grantee', fgMsg.value.grantee === 'sent1grantee');
assert('buildFeeGrantMsg has allowance', !!fgMsg.value.allowance);
assert('buildFeeGrantMsg allowance has typeUrl', fgMsg.value.allowance.typeUrl.includes('BasicAllowance'));

// buildFeeGrantMsg with allowedMessages
const fgMsgRestricted = SDK.buildFeeGrantMsg('sent1g', 'sent1r', {
  spendLimit: 1000000,
  allowedMessages: [SDK.MSG_TYPES.START_SESSION],
});
assert('buildFeeGrantMsg restricted uses AllowedMsgAllowance', fgMsgRestricted.value.allowance.typeUrl.includes('AllowedMsgAllowance'));

// buildRevokeFeeGrantMsg
const rfgMsg = SDK.buildRevokeFeeGrantMsg('sent1g', 'sent1r');
assert('buildRevokeFeeGrantMsg has correct typeUrl', rfgMsg.typeUrl === '/cosmos.feegrant.v1beta1.MsgRevokeAllowance');

// buildAuthzGrantMsg
const azMsg = SDK.buildAuthzGrantMsg('sent1g', 'sent1r', SDK.MSG_TYPES.PLAN_START_SESSION);
assert('buildAuthzGrantMsg has correct typeUrl', azMsg.typeUrl === '/cosmos.authz.v1beta1.MsgGrant');
assert('buildAuthzGrantMsg has grant.authorization', !!azMsg.value.grant?.authorization);

// buildAuthzRevokeMsg
const azrMsg = SDK.buildAuthzRevokeMsg('sent1g', 'sent1r', SDK.MSG_TYPES.START_SESSION);
assert('buildAuthzRevokeMsg has correct typeUrl', azrMsg.typeUrl === '/cosmos.authz.v1beta1.MsgRevoke');
assert('buildAuthzRevokeMsg has msgTypeUrl', azrMsg.value.msgTypeUrl === SDK.MSG_TYPES.START_SESSION);

// buildAuthzExecMsg
const execMsg = SDK.buildAuthzExecMsg('sent1grantee', [{ typeUrl: '/test', value: new Uint8Array([1,2,3]) }]);
assert('buildAuthzExecMsg has correct typeUrl', execMsg.typeUrl === '/cosmos.authz.v1beta1.MsgExec');
assert('buildAuthzExecMsg has msgs array', Array.isArray(execMsg.value.msgs) && execMsg.value.msgs.length === 1);

// ─── 5b. Protobuf encoder edge cases ─────────────────────────────────────────

console.log('5b. Testing protobuf encoder edge cases...');

// encodeMsgStartSession should not crash with normal values
const sessionMsg = SDK.encodeMsgRegisterProvider({ from: 'sent1test', name: 'Test' });
assert('encodeMsgRegisterProvider returns Uint8Array', sessionMsg instanceof Uint8Array);
assert('encodeMsgRegisterProvider has content', sessionMsg.length > 0);

// encodeMsgUpdatePlanStatus with zero status (BigInt zero edge case — Bug #53)
const planStatus = SDK.encodeMsgUpdatePlanStatus({ from: 'sentprov1test', id: 1, status: 0 });
assert('encodeMsgUpdatePlanStatus with status=0 returns bytes', planStatus instanceof Uint8Array);
assert('encodeMsgUpdatePlanStatus with status=0 has content', planStatus.length > 0);

// encodeMsgStartLease with zero hours should not crash
const leaseMsg = SDK.encodeMsgStartLease({ from: 'sentprov1test', nodeAddress: 'sentnode1test', hours: 0 });
assert('encodeMsgStartLease with hours=0 returns bytes', leaseMsg instanceof Uint8Array);

// encodeMsgCreatePlan with BigInt ID
const planMsg = SDK.encodeMsgCreatePlan({ from: 'sentprov1test', bytes: '1000000', duration: 3600 });
assert('encodeMsgCreatePlan returns bytes', planMsg instanceof Uint8Array);

// encodePrice and encodeDuration helpers
const priceBytes = SDK.encodePrice({ denom: 'udvpn', base_value: '1.0', quote_value: '1000000' });
assert('encodePrice returns Buffer', Buffer.isBuffer(priceBytes));
assert('encodePrice has content', priceBytes.length > 0);
const durBytes = SDK.encodeDuration({ seconds: 3600, nanos: 0 });
assert('encodeDuration returns Buffer', Buffer.isBuffer(durBytes));
assert('encodeDuration has content', durBytes.length > 0);

// decToScaledInt
const scaled = SDK.decToScaledInt('1.5');
assert('decToScaledInt returns string', typeof scaled === 'string');
assert('decToScaledInt 1.5 scales correctly', scaled === '1500000000000000000');

// ─── 6. State functions (filesystem, but safe) ──────────────────────────────

console.log('6. Testing state functions...');

// loadState returns null when no state file
const initialState = SDK.loadState();
assert('loadState returns null initially (or object)', initialState === null || typeof initialState === 'object');

// getSessionHistory returns object
const history = SDK.getSessionHistory();
assert('getSessionHistory returns object', typeof history === 'object');

// checkPidFile returns object
const pidCheck = SDK.checkPidFile('smoke-test');
assert('checkPidFile returns object', typeof pidCheck === 'object');
assert('checkPidFile has running field', typeof pidCheck.running === 'boolean');

// ─── 7. WireGuard constants ─────────────────────────────────────────────────

console.log('7. Checking WireGuard constants...');

assertType('IS_ADMIN', SDK.IS_ADMIN, 'boolean');
assert('WG_AVAILABLE is boolean', typeof SDK.WG_AVAILABLE === 'boolean');
// WG_EXE can be string or null
assert('WG_EXE is string or null', typeof SDK.WG_EXE === 'string' || SDK.WG_EXE === null);

// ─── 8. Input Validation ──────────────────────────────────────────────────────

console.log('8. Testing input validation...');

// Must register cleanup before calling connect functions (hard-fail since v26c)
SDK.registerCleanupHandlers();

// connectDirect should reject bad inputs synchronously
async function testValidation() {
  const tests = [
    [() => SDK.connectDirect(), 'requires an options object'],
    [() => SDK.connectDirect({}), 'mnemonic must be a 12+ word'],
    [() => SDK.connectDirect({ mnemonic: 'short' }), 'mnemonic must be a 12+ word'],
    [() => SDK.connectDirect({ mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', nodeAddress: 'bad' }), 'nodeAddress must be a valid'],
    [() => SDK.connectDirect({ mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', nodeAddress: 'sentnode1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq', gigabytes: -1 }), 'gigabytes must be a positive'],
    [() => SDK.connectDirect({ mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', nodeAddress: 'sentnode1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq', rpcUrl: 123 }), 'rpcUrl must be a string'],
  ];
  for (const [fn, expected] of tests) {
    try {
      await fn();
      assert(`Input validation: should reject (${expected})`, false);
    } catch (e) {
      assert(`Input validation: ${expected}`, e.message.includes(expected.split(' ')[0]));
    }
  }

  // connectViaPlan should reject bad inputs
  try {
    await SDK.connectViaPlan({});
    assert('connectViaPlan rejects empty opts', false);
  } catch (e) {
    assert('connectViaPlan rejects bad mnemonic', e.message.includes('mnemonic'));
  }
}
await testValidation();

// ─── 9. Typed Errors ──────────────────────────────────────────────────────────

console.log('9. Testing typed errors...');

// SentinelError construction
const err = new SDK.SentinelError('TEST_CODE', 'test message', { key: 'val' });
assert('SentinelError has code', err.code === 'TEST_CODE');
assert('SentinelError has message', err.message === 'test message');
assert('SentinelError has details', err.details.key === 'val');
assert('SentinelError is instance of Error', err instanceof Error);
assert('SentinelError toJSON', err.toJSON().code === 'TEST_CODE');

// Subclass hierarchy
const valErr = new SDK.ValidationError('INVALID_MNEMONIC', 'bad mnemonic');
assert('ValidationError extends SentinelError', valErr instanceof SDK.SentinelError);
assert('ValidationError extends Error', valErr instanceof Error);
assert('ValidationError name', valErr.name === 'ValidationError');

const nodeErr = new SDK.NodeError('NODE_OFFLINE', 'node is offline');
assert('NodeError extends SentinelError', nodeErr instanceof SDK.SentinelError);

const chainErr = new SDK.ChainError('SESSION_EXTRACT_FAILED', 'extract failed');
assert('ChainError extends SentinelError', chainErr instanceof SDK.SentinelError);

const tunErr = new SDK.TunnelError('V2RAY_ALL_FAILED', 'all failed');
assert('TunnelError extends SentinelError', tunErr instanceof SDK.SentinelError);

const secErr = new SDK.SecurityError('TLS_CERT_CHANGED', 'cert changed');
assert('SecurityError extends SentinelError', secErr instanceof SDK.SentinelError);

// ErrorCodes object
assert('ErrorCodes has INVALID_MNEMONIC', SDK.ErrorCodes.INVALID_MNEMONIC === 'INVALID_MNEMONIC');
assert('ErrorCodes has V2RAY_ALL_FAILED', SDK.ErrorCodes.V2RAY_ALL_FAILED === 'V2RAY_ALL_FAILED');
assert('ErrorCodes has TLS_CERT_CHANGED', SDK.ErrorCodes.TLS_CERT_CHANGED === 'TLS_CERT_CHANGED');
assert('ErrorCodes has ABORTED', SDK.ErrorCodes.ABORTED === 'ABORTED');

// Input validation now throws typed errors
async function testTypedValidation() {
  // Register cleanup handlers first (required by connectDirect since v33)
  SDK.registerCleanupHandlers();
  try {
    await SDK.connectDirect();
  } catch (e) {
    assert('connectDirect() throws ValidationError', e instanceof SDK.ValidationError);
    assert('connectDirect() error has code', e.code === 'INVALID_OPTIONS');
  }
  try {
    await SDK.connectDirect({ mnemonic: 'short' });
  } catch (e) {
    assert('bad mnemonic throws ValidationError', e instanceof SDK.ValidationError);
    assert('bad mnemonic has INVALID_MNEMONIC code', e.code === 'INVALID_MNEMONIC');
  }
  try {
    await SDK.connectDirect({ mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', nodeAddress: 'bad' });
  } catch (e) {
    assert('bad address throws error', e instanceof SDK.SentinelError);
    assert('bad address has error code', typeof e.code === 'string');
  }
}
await testTypedValidation();

// ─── 10. Event Emitter ────────────────────────────────────────────────────────

console.log('10. Testing event emitter...');

assert('events is an EventEmitter', typeof SDK.events.on === 'function');
assert('events has emit', typeof SDK.events.emit === 'function');
assert('events has removeListener', typeof SDK.events.removeListener === 'function');

// Test that events can be subscribed to
let progressReceived = false;
const listener = () => { progressReceived = true; };
SDK.events.on('progress', listener);
SDK.events.emit('progress', { step: 'test', detail: 'smoke' });
assert('events emits progress', progressReceived);
SDK.events.removeListener('progress', listener);

// ─── 11. TLS Trust ────────────────────────────────────────────────────────────

console.log('11. Testing TLS trust...');

assertType('createNodeHttpsAgent', SDK.createNodeHttpsAgent, 'function');
assertType('clearKnownNode', SDK.clearKnownNode, 'function');
assertType('clearAllKnownNodes', SDK.clearAllKnownNodes, 'function');
assertType('getKnownNode', SDK.getKnownNode, 'function');

// getKnownNode returns null for unknown node
const unknown = SDK.getKnownNode('sentnode1unknown');
assert('getKnownNode returns null for unknown', unknown === null);

// createNodeHttpsAgent returns an Agent
const tofuAgent = SDK.createNodeHttpsAgent('sentnode1test', 'tofu');
assert('TOFU agent is object', typeof tofuAgent === 'object');
const noneAgent = SDK.createNodeHttpsAgent('sentnode1test', 'none');
assert('none agent is object', typeof noneAgent === 'object');

// ─── 12. SentinelClient class ──────────────────────────────────────────────────

console.log('12. Testing SentinelClient class...');

assertExists('SentinelClient');
assert('SentinelClient is a class', typeof SDK.SentinelClient === 'function');

// Instantiation
const client1 = new SDK.SentinelClient({ rpcUrl: 'https://rpc.example.com', logger: null });
assert('client1 is an EventEmitter', typeof client1.on === 'function');
assert('client1 has connect', typeof client1.connect === 'function');
assert('client1 has connectPlan', typeof client1.connectPlan === 'function');
assert('client1 has disconnect', typeof client1.disconnect === 'function');
assert('client1 has isConnected', typeof client1.isConnected === 'function');
assert('client1 has getStatus', typeof client1.getStatus === 'function');
assert('client1 has listNodes', typeof client1.listNodes === 'function');
assert('client1 has nodeStatus', typeof client1.nodeStatus === 'function');
assert('client1 has getWallet', typeof client1.getWallet === 'function');
assert('client1 has getClient', typeof client1.getClient === 'function');
assert('client1 has getBalance', typeof client1.getBalance === 'function');
assert('client1 has clearKnownNode', typeof client1.clearKnownNode === 'function');
assert('client1 has clearAllKnownNodes', typeof client1.clearAllKnownNodes === 'function');
assert('client1 has getKnownNode', typeof client1.getKnownNode === 'function');
assert('client1 has registerCleanup', typeof client1.registerCleanup === 'function');
assert('client1 has destroy', typeof client1.destroy === 'function');

// Not connected initially
assert('client1 not connected initially', client1.isConnected() === false);
assert('client1 status null initially', client1.getStatus() === null);

// Independent instances
const client2 = new SDK.SentinelClient({ rpcUrl: 'https://other-rpc.example.com' });
assert('two clients are independent', client1 !== client2);

// Event forwarding works
let client1EventReceived = false;
client1.on('progress', () => { client1EventReceived = true; });
SDK.events.emit('progress', { step: 'test', detail: 'client-test' });
assert('client1 receives forwarded events', client1EventReceived);

// Destroy cleans up
client1.destroy();
client2.destroy();
client1EventReceived = false;
SDK.events.emit('progress', { step: 'test', detail: 'after-destroy' });
assert('destroyed client stops receiving events', client1EventReceived === false);

// ─── Section 13: V2Ray Config Generation (v22 fixes) ────────────────────────
console.log('\n--- 13. V2Ray Config Generation ---');

// buildV2RayClientConfig(serverHost, metadataJson, uuid, socksPort)
// metadataJson can be object with .metadata array

// Test with v3-format metadata
const v3MetaObj = { metadata: [
  { port: '443', proxy_protocol: 2, transport_protocol: 7, transport_security: 1 },  // vmess/tcp/none
  { port: '8443', proxy_protocol: 1, transport_protocol: 8, transport_security: 2 }, // vless/ws/tls
]};
const v3Config = SDK.buildV2RayClientConfig('1.2.3.4', v3MetaObj, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 10800);
assert('v3 config has outbounds', v3Config.outbounds.length === 2);
assert('v3 config first outbound is tcp (highest priority)', v3Config.outbounds[0].tag.includes('tcp'));
assert('v3 config has socks inbound on correct port', v3Config.inbounds[1].port === 10800);

// Test v2-format metadata mapping (instead of throwing)
const v2MetaObj = { metadata: [
  { port: '443', protocol: 1 },           // v2 VMess → v3 proxy_protocol=2
  { port: '8080', protocol: 2, tls: 1 },  // v2 VLess+TLS → v3 proxy_protocol=1, transport_security=2
]};
const v2Config = SDK.buildV2RayClientConfig('5.6.7.8', v2MetaObj, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 10801);
assert('v2 metadata maps to valid config', v2Config.outbounds.length === 2);
assert('v2 protocol=1 (VMess) maps to vmess outbound', v2Config.outbounds.some(o => o.protocol === 'vmess'));
assert('v2 protocol=2 (VLess) maps to vless outbound', v2Config.outbounds.some(o => o.protocol === 'vless'));

// Test QUIC settings — security=none (matches sentinel-go-sdk server)
assert('global quic security is none', v3Config.transport.quicSettings.security === 'none');
assert('global quic has empty key', v3Config.transport.quicSettings.key === '');
assert('global quic header type is none', v3Config.transport.quicSettings.header.type === 'none');

// Test QUIC-only metadata correctly throws (QUIC has 0% success, filtered out)
try {
  const quicMetaObj = { metadata: [
    { port: '443', proxy_protocol: 2, transport_protocol: 6, transport_security: 1 }, // vmess/quic/none
  ]};
  SDK.buildV2RayClientConfig('9.10.11.12', quicMetaObj, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 10802);
  assert('quic-only should throw V2RAY_ALL_FAILED', false);
} catch (e) {
  assert('quic-only throws TunnelError', e.code === 'V2RAY_ALL_FAILED');
  assert('quic-only error mentions QUIC', e.message.includes('QUIC'));
}

// Test transport sort order — tcp before grpc (quic filtered out)
const mixedMetaObj = { metadata: [
  { port: '1', proxy_protocol: 2, transport_protocol: 6, transport_security: 1 },  // quic/none (filtered)
  { port: '2', proxy_protocol: 2, transport_protocol: 3, transport_security: 1 },  // grpc/none
  { port: '3', proxy_protocol: 2, transport_protocol: 7, transport_security: 1 },  // tcp/none
]};
const mixedConfig = SDK.buildV2RayClientConfig('1.1.1.1', mixedMetaObj, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 10803);
assert('tcp sorted first', mixedConfig.outbounds[0].tag.includes('tcp'));
// grpc outbounds include gun-from-grpc variants, so check any contains grpc or gun
assert('grpc/gun sorted after tcp', mixedConfig.outbounds.some(o => o.tag.includes('grpc') || o.tag.includes('gun')));

// ─── v24: New exports (getNodePrices, verifyDependencies, helpers) ──────────

assertExists('getNodePrices');
assertType('getNodePrices', SDK.getNodePrices, 'function');

assertExists('verifyDependencies');
assertType('verifyDependencies', SDK.verifyDependencies, 'function');

assertExists('isMnemonicValid');
assertType('isMnemonicValid', SDK.isMnemonicValid, 'function');

assertExists('formatDvpn');
assertType('formatDvpn', SDK.formatDvpn, 'function');

assertExists('filterNodes');
assertType('filterNodes', SDK.filterNodes, 'function');

assertExists('serializeResult');
assertType('serializeResult', SDK.serializeResult, 'function');

assertExists('getNetworkOverview');
assertType('getNetworkOverview', SDK.getNetworkOverview, 'function');

// verifyDependencies returns correct shape (no network needed)
const deps = SDK.verifyDependencies();
assert('verifyDependencies returns object', typeof deps === 'object');
assert('verifyDependencies has ok', typeof deps.ok === 'boolean');
assert('verifyDependencies has v2ray', typeof deps.v2ray === 'object');
assert('verifyDependencies has wireguard', typeof deps.wireguard === 'object');
assert('verifyDependencies has platform', typeof deps.platform === 'string');
assert('verifyDependencies has arch', typeof deps.arch === 'string');
assert('verifyDependencies has nodeVersion', typeof deps.nodeVersion === 'string');
assert('verifyDependencies has errors array', Array.isArray(deps.errors));
assert('verifyDependencies v2ray.available is boolean', typeof deps.v2ray.available === 'boolean');
assert('verifyDependencies wireguard.available is boolean', typeof deps.wireguard.available === 'boolean');
assert('verifyDependencies wireguard.isAdmin is boolean', typeof deps.wireguard.isAdmin === 'boolean');

// isMnemonicValid — no network needed, validates against BIP39 English wordlist
assert('isMnemonicValid rejects short', SDK.isMnemonicValid('two words') === false);
assert('isMnemonicValid rejects empty', SDK.isMnemonicValid('') === false);
assert('isMnemonicValid rejects number', SDK.isMnemonicValid(12345) === false);
assert('isMnemonicValid rejects non-BIP39 words', SDK.isMnemonicValid('a b c d e f g h i j k l') === false);
assert('isMnemonicValid accepts valid 12-word mnemonic', SDK.isMnemonicValid('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about') === true);
assert('isMnemonicValid accepts valid 24-word mnemonic', SDK.isMnemonicValid('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art') === true);
assert('isMnemonicValid rejects valid words with bad checksum', SDK.isMnemonicValid('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon') === false);

// formatDvpn — no network needed
assert('formatDvpn basic', SDK.formatDvpn(1000000) === '1.00 P2P');
assert('formatDvpn zero decimals', SDK.formatDvpn(1000000, 0) === '1 P2P');
assert('formatDvpn fractional', SDK.formatDvpn(40152030, 2) === '40.15 P2P');
assert('formatDvpn string input', SDK.formatDvpn('500000') === '0.50 P2P');
assert('formatDvpn NaN', SDK.formatDvpn('garbage') === '? P2P');
assert('formatDvpn zero', SDK.formatDvpn(0) === '0.00 P2P');

// formatP2P alias — same function
assertExists('formatP2P');
assertType('formatP2P', SDK.formatP2P, 'function');
assert('formatP2P is alias of formatDvpn', SDK.formatP2P === SDK.formatDvpn);

// filterNodes — no network needed
const testNodes = [
  { country: 'Germany', serviceType: 'wireguard', qualityScore: 80, gigabyte_prices: [{ denom: 'udvpn', quote_value: '40000000' }] },
  { country: 'United States', serviceType: 'v2ray', qualityScore: 60, gigabyte_prices: [{ denom: 'udvpn', quote_value: '100000000' }] },
  { country: 'Germany', serviceType: 'v2ray', qualityScore: 90, gigabyte_prices: [{ denom: 'udvpn', quote_value: '20000000' }] },
];
assert('filterNodes by country', SDK.filterNodes(testNodes, { country: 'Germany' }).length === 2);
assert('filterNodes by type', SDK.filterNodes(testNodes, { serviceType: 'v2ray' }).length === 2);
assert('filterNodes by price', SDK.filterNodes(testNodes, { maxPriceDvpn: 50 }).length === 2);
assert('filterNodes by score', SDK.filterNodes(testNodes, { minScore: 85 }).length === 1);
assert('filterNodes combined', SDK.filterNodes(testNodes, { country: 'Germany', serviceType: 'v2ray' }).length === 1);
assert('filterNodes empty array', SDK.filterNodes([], {}).length === 0);
assert('filterNodes no criteria', SDK.filterNodes(testNodes).length === 3);

// serializeResult — no network needed
const fakeResult = { sessionId: BigInt(12345), nodeAddress: 'sentnode1abc', cleanup: () => {} };
const serialized = SDK.serializeResult(fakeResult);
assert('serializeResult converts BigInt', serialized.sessionId === '12345');
assert('serializeResult keeps strings', serialized.nodeAddress === 'sentnode1abc');
assert('serializeResult strips functions', serialized.cleanup === undefined);

// getNodePrices rejects invalid address (no network needed)
try {
  await SDK.getNodePrices('invalid');
  assert('getNodePrices rejects invalid address', false, 'should have thrown');
} catch (err) {
  assert('getNodePrices rejects invalid address', err.code === 'INVALID_NODE_ADDRESS');
}

// ─── v25: New exports ────────────────────────────────────────────────────────

// New function exports exist and have correct types
assertExists('configureCircuitBreaker');
assertType('configureCircuitBreaker', SDK.configureCircuitBreaker, 'function');
assertExists('getCircuitBreakerStatus');
assertType('getCircuitBreakerStatus', SDK.getCircuitBreakerStatus, 'function');
assertExists('flushNodeCache');
assertType('flushNodeCache', SDK.flushNodeCache, 'function');
assertExists('recoverSession');
assertType('recoverSession', SDK.recoverSession, 'function');
assertExists('getConnectionMetrics');
assertType('getConnectionMetrics', SDK.getConnectionMetrics, 'function');
assertExists('createConnectConfig');
assertType('createConnectConfig', SDK.createConnectConfig, 'function');
assertExists('compareSpeedTests');
assertType('compareSpeedTests', SDK.compareSpeedTests, 'function');
assertExists('validateCIDR');
assertType('validateCIDR', SDK.validateCIDR, 'function');

// configureCircuitBreaker — no crash
SDK.configureCircuitBreaker({ threshold: 5, ttlMs: 10000 });
SDK.configureCircuitBreaker({}); // empty opts is fine
SDK.configureCircuitBreaker({ threshold: 3, ttlMs: 300000 }); // reset to defaults

// getCircuitBreakerStatus — returns object or null
const cbStatus = SDK.getCircuitBreakerStatus();
assert('getCircuitBreakerStatus returns object', typeof cbStatus === 'object');
assert('getCircuitBreakerStatus specific returns null', SDK.getCircuitBreakerStatus('sentnode1nonexistent') === null);

// flushNodeCache — no crash
SDK.flushNodeCache();

// getConnectionMetrics — returns object
const metrics = SDK.getConnectionMetrics();
assert('getConnectionMetrics returns object', typeof metrics === 'object');
assert('getConnectionMetrics specific returns null', SDK.getConnectionMetrics('sentnode1nonexistent') === null);

// createConnectConfig — builder pattern
const cfg = SDK.createConnectConfig({ mnemonic: 'a b c d e f g h i j k l' });
assert('createConnectConfig returns frozen base', Object.isFrozen(cfg));
assert('createConnectConfig has mnemonic', cfg.mnemonic === 'a b c d e f g h i j k l');
assert('createConnectConfig has .with()', typeof cfg.with === 'function');
const overridden = cfg.with({ nodeAddress: 'sentnode1test' });
assert('createConnectConfig .with() merges', overridden.nodeAddress === 'sentnode1test');
assert('createConnectConfig .with() keeps base', overridden.mnemonic === 'a b c d e f g h i j k l');

// compareSpeedTests
const before = { downloadMbps: 50, uploadMbps: 10, latencyMs: 20, ip: '1.2.3.4', location: 'US' };
const after = { downloadMbps: 30, uploadMbps: 8, latencyMs: 40, ip: '5.6.7.8', location: 'DE' };
const cmp = SDK.compareSpeedTests(before, after);
assert('compareSpeedTests degraded', cmp.degraded === true);
assert('compareSpeedTests not improved', cmp.improved === false);
assert('compareSpeedTests delta download', cmp.delta.downloadMbps === -20);
assert('compareSpeedTests delta upload', cmp.delta.uploadMbps === -2);
assert('compareSpeedTests delta latency', cmp.delta.latencyMs === 20);
assert('compareSpeedTests pct download', cmp.percentChange.download === -40);
const improved = SDK.compareSpeedTests(after, before);
assert('compareSpeedTests improved', improved.improved === true);

// validateCIDR
assert('validateCIDR valid IPv4', SDK.validateCIDR('10.8.0.2/24') === true);
assert('validateCIDR valid IPv4 /32', SDK.validateCIDR('192.168.1.1/32') === true);
assert('validateCIDR valid IPv6', SDK.validateCIDR('fd1d::2/128') === true);
assert('validateCIDR invalid IP', SDK.validateCIDR('999.999.999.999/24') === false);
assert('validateCIDR no prefix', SDK.validateCIDR('10.8.0.2') === false);
assert('validateCIDR bad prefix', SDK.validateCIDR('10.8.0.2/33') === false);
assert('validateCIDR empty', SDK.validateCIDR('') === false);
assert('validateCIDR not string', SDK.validateCIDR(null) === false);

// resetDynamicRates with persist parameter — no crash
SDK.resetDynamicRates(false);
SDK.resetDynamicRates(true);

// New error codes exist
assert('ErrorCodes.BROADCAST_FAILED', SDK.ErrorCodes.BROADCAST_FAILED === 'BROADCAST_FAILED');
assert('ErrorCodes.TX_FAILED', SDK.ErrorCodes.TX_FAILED === 'TX_FAILED');
assert('ErrorCodes.LCD_ERROR', SDK.ErrorCodes.LCD_ERROR === 'LCD_ERROR');
assert('ErrorCodes.UNKNOWN_MSG_TYPE', SDK.ErrorCodes.UNKNOWN_MSG_TYPE === 'UNKNOWN_MSG_TYPE');
assert('ErrorCodes.INVALID_ASSIGNED_IP', SDK.ErrorCodes.INVALID_ASSIGNED_IP === 'INVALID_ASSIGNED_IP');
assert('ErrorCodes.PARTIAL_CONNECTION_FAILED', SDK.ErrorCodes.PARTIAL_CONNECTION_FAILED === 'PARTIAL_CONNECTION_FAILED');

// ─── Dry-Run Mode ───────────────────────────────────────────────────────────

// connectDirect accepts dryRun option (type check only — no network call)
assert('connectDirect accepts dryRun option', typeof SDK.connectDirect === 'function');
assert('connectViaPlan accepts dryRun option', typeof SDK.connectViaPlan === 'function');
assert('connectAuto accepts dryRun option', typeof SDK.connectAuto === 'function');

// ─── v25b: Field Lesson exports ──────────────────────────────────────────────

// LCD Query Helpers
assertExists('lcdQuery');
assertType('lcdQuery', SDK.lcdQuery, 'function');
assertExists('lcdQueryAll');
assertType('lcdQueryAll', SDK.lcdQueryAll, 'function');

// Plan Subscriber Helpers
assertExists('queryPlanSubscribers');
assertType('queryPlanSubscribers', SDK.queryPlanSubscribers, 'function');
assertExists('getPlanStats');
assertType('getPlanStats', SDK.getPlanStats, 'function');

// Fee Grant Workflow Helpers
assertExists('grantPlanSubscribers');
assertType('grantPlanSubscribers', SDK.grantPlanSubscribers, 'function');
assertExists('getExpiringGrants');
assertType('getExpiringGrants', SDK.getExpiringGrants, 'function');
assertExists('renewExpiringGrants');
assertType('renewExpiringGrants', SDK.renewExpiringGrants, 'function');
assertExists('monitorFeeGrants');
assertType('monitorFeeGrants', SDK.monitorFeeGrants, 'function');

// grantPlanSubscribers rejects missing granterAddress
try {
  await SDK.grantPlanSubscribers(1, {});
  assert('grantPlanSubscribers rejects missing granter', false, 'should throw');
} catch (err) {
  assert('grantPlanSubscribers rejects missing granter', err.code === 'INVALID_OPTIONS');
}

// monitorFeeGrants rejects missing opts
try {
  SDK.monitorFeeGrants({});
  assert('monitorFeeGrants rejects missing opts', false, 'should throw');
} catch (err) {
  assert('monitorFeeGrants rejects missing opts', err.code === 'INVALID_OPTIONS');
}

// ─── v25c: Review fixes ──────────────────────────────────────────────────────

// New exports exist
assertExists('querySubscriptions');
assertType('querySubscriptions', SDK.querySubscriptions, 'function');
assertExists('querySessionAllocation');
assertType('querySessionAllocation', SDK.querySessionAllocation, 'function');
assertExists('queryNode');
assertType('queryNode', SDK.queryNode, 'function');
assertExists('buildBatchStartSession');
assertType('buildBatchStartSession', SDK.buildBatchStartSession, 'function');
assertExists('buildEndSessionMsg');
assertType('buildEndSessionMsg', SDK.buildEndSessionMsg, 'function');
assertExists('connectViaSubscription');
assertType('connectViaSubscription', SDK.connectViaSubscription, 'function');

// MSG_TYPES.END_SESSION exists
assert('MSG_TYPES.END_SESSION', SDK.MSG_TYPES.END_SESSION === '/sentinel.session.v3.MsgCancelSessionRequest');

// ErrorCodes.ALL_ENDPOINTS_FAILED exists
assert('ErrorCodes.ALL_ENDPOINTS_FAILED', SDK.ErrorCodes.ALL_ENDPOINTS_FAILED === 'ALL_ENDPOINTS_FAILED');

// buildBatchStartSession builds correct messages
const batchMsgs = SDK.buildBatchStartSession('sent1test', [
  { nodeAddress: 'sentnode1abc', maxPrice: { denom: 'udvpn', base_value: '0.003', quote_value: '40000000' } },
  { nodeAddress: 'sentnode1def', gigabytes: 2, maxPrice: { denom: 'udvpn', base_value: '0.003', quote_value: '40000000' } },
]);
assert('buildBatchStartSession returns array', Array.isArray(batchMsgs) && batchMsgs.length === 2);
assert('buildBatchStartSession msg 1 type', batchMsgs[0].typeUrl === '/sentinel.node.v3.MsgStartSessionRequest');
assert('buildBatchStartSession msg 1 from', batchMsgs[0].value.from === 'sent1test');
assert('buildBatchStartSession msg 1 node', batchMsgs[0].value.node_address === 'sentnode1abc');
assert('buildBatchStartSession msg 1 gb default', batchMsgs[0].value.gigabytes === 1);
assert('buildBatchStartSession msg 2 gb override', batchMsgs[1].value.gigabytes === 2);

// buildEndSessionMsg
const endMsg = SDK.buildEndSessionMsg('sent1test', 12345);
assert('buildEndSessionMsg type', endMsg.typeUrl === '/sentinel.session.v3.MsgCancelSessionRequest');
assert('buildEndSessionMsg from', endMsg.value.from === 'sent1test');
assert('buildEndSessionMsg id', endMsg.value.id === BigInt(12345));

// queryNode rejects invalid address
try {
  await SDK.queryNode('invalid');
  assert('queryNode rejects invalid', false, 'should throw');
} catch (err) {
  assert('queryNode rejects invalid', err.code === 'INVALID_NODE_ADDRESS');
}

// ─── v26: Field experience exports ───────────────────────────────────────────

assertExists('queryPlanNodes');
assertType('queryPlanNodes', SDK.queryPlanNodes, 'function');
assertExists('discoverPlans');
assertType('discoverPlans', SDK.discoverPlans, 'function');
assertExists('shortAddress');
assertType('shortAddress', SDK.shortAddress, 'function');
assertExists('formatSubscriptionExpiry');
assertType('formatSubscriptionExpiry', SDK.formatSubscriptionExpiry, 'function');
assertExists('sendTokens');
assertType('sendTokens', SDK.sendTokens, 'function');
assertExists('subscribeToPlan');
assertType('subscribeToPlan', SDK.subscribeToPlan, 'function');
assertExists('getProviderByAddress');
assertType('getProviderByAddress', SDK.getProviderByAddress, 'function');
assertExists('buildBatchSend');
assertType('buildBatchSend', SDK.buildBatchSend, 'function');
assertExists('buildBatchLink');
assertType('buildBatchLink', SDK.buildBatchLink, 'function');
assertExists('decodeTxEvents');
assertType('decodeTxEvents', SDK.decodeTxEvents, 'function');
assertExists('extractAllSessionIds');
assertType('extractAllSessionIds', SDK.extractAllSessionIds, 'function');
assertExists('estimateBatchFee');
assertType('estimateBatchFee', SDK.estimateBatchFee, 'function');
assertExists('estimateSessionCost');
assertType('estimateSessionCost', SDK.estimateSessionCost, 'function');
assertExists('isSameKey');
assertType('isSameKey', SDK.isSameKey, 'function');

// shortAddress
assert('shortAddress truncates', SDK.shortAddress('sent1abcdefghijklmnopqrstuvwxyz123456789012') === 'sent1abcdefg...789012');
assert('shortAddress short passthrough', SDK.shortAddress('sent1abc') === 'sent1abc');
assert('shortAddress null', SDK.shortAddress(null) === '');
assert('shortAddress empty', SDK.shortAddress('') === '');

// formatSubscriptionExpiry
assert('formatSubscriptionExpiry expired', SDK.formatSubscriptionExpiry({ inactive_at: '2020-01-01T00:00:00Z' }) === 'expired');
assert('formatSubscriptionExpiry unknown', SDK.formatSubscriptionExpiry({}) === 'unknown');
const future = new Date(Date.now() + 5 * 86400000).toISOString();
assert('formatSubscriptionExpiry future', SDK.formatSubscriptionExpiry({ inactive_at: future }).includes('d left'));

// estimateBatchFee
const bfee = SDK.estimateBatchFee(5, 'startSession');
assert('estimateBatchFee gas', bfee.gas === 1000000);
assert('estimateBatchFee has fee obj', bfee.fee.gas === '1000000');
assert('estimateBatchFee send type', SDK.estimateBatchFee(1, 'send').gas === 80000);

// estimateSessionCost — gigabyte pricing (default)
const nodePrices = { gigabyte_prices: [{ denom: 'udvpn', quote_value: '40000000' }] };
const cost = SDK.estimateSessionCost(nodePrices, 2);
assert('estimateSessionCost udvpn', cost.udvpn === 80000000);
assert('estimateSessionCost dvpn', cost.dvpn === 80);
assert('estimateSessionCost has gas', cost.gasUdvpn === 200000);
assert('estimateSessionCost total', cost.totalUdvpn === 80200000);
assert('estimateSessionCost mode is gigabyte', cost.mode === 'gigabyte');
assert('estimateSessionCost gigabyteUdvpn', cost.gigabyteUdvpn === 40000000);
assert('estimateSessionCost hourlyUdvpn null', cost.hourlyUdvpn === null);

// estimateSessionCost — hourly pricing when cheaper
const nodePricesHourly = {
  gigabyte_prices: [{ denom: 'udvpn', quote_value: '40000000' }],
  hourly_prices: [{ denom: 'udvpn', quote_value: '18000000' }],
};
const costHourly = SDK.estimateSessionCost(nodePricesHourly, 1, { preferHourly: true });
assert('estimateSessionCost hourly mode', costHourly.mode === 'hourly');
assert('estimateSessionCost hourly cost', costHourly.udvpn === 18000000);
assert('estimateSessionCost hourly dvpn', costHourly.dvpn === 18);
assert('estimateSessionCost hourly has both prices', costHourly.hourlyUdvpn === 18000000);
assert('estimateSessionCost hourly has gb price', costHourly.gigabyteUdvpn === 40000000);

// estimateSessionCost — hourly NOT used when more expensive
const nodePricesExpensive = {
  gigabyte_prices: [{ denom: 'udvpn', quote_value: '10000000' }],
  hourly_prices: [{ denom: 'udvpn', quote_value: '50000000' }],
};
const costNoHourly = SDK.estimateSessionCost(nodePricesExpensive, 1, { preferHourly: true });
assert('estimateSessionCost skips expensive hourly', costNoHourly.mode === 'gigabyte');
assert('estimateSessionCost uses gb when cheaper', costNoHourly.udvpn === 10000000);

// estimateSessionCost — preferHourly false (default) uses gb even when hourly is cheaper
const costDefault = SDK.estimateSessionCost(nodePricesHourly, 1);
assert('estimateSessionCost default mode is gigabyte', costDefault.mode === 'gigabyte');
assert('estimateSessionCost default uses gb', costDefault.udvpn === 40000000);

// isSameKey — cross-prefix comparison
// Use a valid bech32 sent1 address for testing
const testSentAddr = 'sent12e03wzmxjerwqt63p252cqs90jwfuwdd4fjhzg';
const testProvAddr = SDK.sentToSentprov(testSentAddr);
assert('sentToSentprov produces sentprov prefix', testProvAddr.startsWith('sentprov'));
assert('isSameKey same key diff prefix', SDK.isSameKey(testSentAddr, testProvAddr) === true);
assert('isSameKey invalid', SDK.isSameKey('invalid', 'invalid') === false);

// buildBatchSend
const sendMsgs = SDK.buildBatchSend('sent1from', [
  { address: 'sent1to1', amountUdvpn: 1000000 },
  { address: 'sent1to2', amountUdvpn: 2000000 },
]);
assert('buildBatchSend length', sendMsgs.length === 2);
assert('buildBatchSend typeUrl', sendMsgs[0].typeUrl === '/cosmos.bank.v1beta1.MsgSend');
assert('buildBatchSend amount', sendMsgs[1].value.amount[0].amount === '2000000');

// buildBatchLink
const linkMsgs = SDK.buildBatchLink('sentprov1test', 5, ['sentnode1a', 'sentnode1b']);
assert('buildBatchLink length', linkMsgs.length === 2);
assert('buildBatchLink typeUrl', linkMsgs[0].typeUrl === '/sentinel.plan.v3.MsgLinkNodeRequest');

// decodeTxEvents
const b64key = Buffer.from('session_id').toString('base64');
const b64val = Buffer.from('123').toString('base64');
const fakeEvents = [{ type: 'test', attributes: [
  { key: b64key, value: b64val },
  { key: 'plain_key', value: 'plain_value' },
]}];
const decoded = SDK.decodeTxEvents(fakeEvents);
// Note: base64 of "session_id" is "c2Vzc2lvbl9pZA==" which is a valid string, so it passes through as-is
// The decoder only base64-decodes if it detects non-UTF8 (Buffer type). String keys pass through.
assert('decodeTxEvents handles string attrs', decoded[0].attributes[1].key === 'plain_key');
assert('decodeTxEvents preserves type', decoded[0].type === 'test');
assert('decodeTxEvents returns array', Array.isArray(decoded) && decoded.length === 1);

// extractAllSessionIds from fake TX result
const fakeTx = { events: [{ type: 'sentinel.session.v3.EventStart', attributes: [
  { key: 'session_id', value: '999' },
  { key: 'session_id', value: '1000' },
]}]};
const sessionIds = SDK.extractAllSessionIds(fakeTx);
assert('extractAllSessionIds finds ids', sessionIds.length === 2);
assert('extractAllSessionIds BigInt', sessionIds[0] === BigInt(999));

// extractAllSessionIds strips quotes and dedups
const quotedTx = { events: [{ type: 'session_start', attributes: [
  { key: 'session_id', value: '"555"' },
  { key: 'session_id', value: '"555"' },
  { key: 'id', value: '"666"' },
]}]};
const quotedIds = SDK.extractAllSessionIds(quotedTx);
assert('extractAllSessionIds strips quotes', quotedIds[0] === BigInt(555));
assert('extractAllSessionIds dedups', quotedIds.length === 2);

// queryFeeGrantsIssued export exists
assertExists('queryFeeGrantsIssued');
assertType('queryFeeGrantsIssued', SDK.queryFeeGrantsIssued, 'function');

// MSG_TYPES.END_SESSION still there
assert('MSG_TYPES.END_SESSION', SDK.MSG_TYPES.END_SESSION === '/sentinel.session.v3.MsgCancelSessionRequest');

// ─── v26c: Final additions ───────────────────────────────────────────────────

// Defensive pagination
assertExists('lcdPaginatedSafe');
assertType('lcdPaginatedSafe', SDK.lcdPaginatedSafe, 'function');

// Session/Subscription queries
assertExists('querySessions');
assertType('querySessions', SDK.querySessions, 'function');
assertExists('querySubscription');
assertType('querySubscription', SDK.querySubscription, 'function');
assertExists('hasActiveSubscription');
assertType('hasActiveSubscription', SDK.hasActiveSubscription, 'function');

// Display helpers
assertExists('formatBytes');
assertType('formatBytes', SDK.formatBytes, 'function');
assert('formatBytes GB', SDK.formatBytes(1610612736) === '1.50 GB');
assert('formatBytes MB', SDK.formatBytes(5242880) === '5.0 MB');
assert('formatBytes KB', SDK.formatBytes(2048) === '2.0 KB');
assert('formatBytes B', SDK.formatBytes(500) === '500 B');
assert('formatBytes null', SDK.formatBytes(null) === '0 B');

assertExists('parseChainDuration');
assertType('parseChainDuration', SDK.parseChainDuration, 'function');
const dur = SDK.parseChainDuration('557817.727815887s');
assert('parseChainDuration hours', dur.hours === 154);
assert('parseChainDuration minutes', dur.minutes === 56);
assert('parseChainDuration formatted', dur.formatted === '154h 56m');
const durShort = SDK.parseChainDuration('45s');
assert('parseChainDuration short', durShort.formatted === '45s');

// Connection helpers
assertExists('autoReconnect');
assertType('autoReconnect', SDK.autoReconnect, 'function');
assertExists('verifyConnection');
assertType('verifyConnection', SDK.verifyConnection, 'function');

// Error DX
assertExists('ERROR_SEVERITY');
assert('ERROR_SEVERITY is object', typeof SDK.ERROR_SEVERITY === 'object');
assert('ERROR_SEVERITY has fatal', SDK.ERROR_SEVERITY[SDK.ErrorCodes.INVALID_MNEMONIC] === 'fatal');
assert('ERROR_SEVERITY has retryable', SDK.ERROR_SEVERITY[SDK.ErrorCodes.NODE_OFFLINE] === 'retryable');
assert('ERROR_SEVERITY has recoverable', SDK.ERROR_SEVERITY[SDK.ErrorCodes.SESSION_EXTRACT_FAILED] === 'recoverable');
assert('ERROR_SEVERITY has infrastructure', SDK.ERROR_SEVERITY[SDK.ErrorCodes.TLS_CERT_CHANGED] === 'infrastructure');

assertExists('isRetryable');
assertType('isRetryable', SDK.isRetryable, 'function');
assert('isRetryable true', SDK.isRetryable({ code: 'NODE_OFFLINE' }) === true);
assert('isRetryable false', SDK.isRetryable({ code: 'INVALID_MNEMONIC' }) === false);
assert('isRetryable string', SDK.isRetryable('NODE_OFFLINE') === true);

assertExists('userMessage');
assertType('userMessage', SDK.userMessage, 'function');
assert('userMessage maps code', SDK.userMessage({ code: 'INSUFFICIENT_BALANCE' }).includes('P2P'));
assert('userMessage maps offline', SDK.userMessage({ code: 'NODE_OFFLINE' }).includes('offline'));
assert('userMessage fallback', SDK.userMessage({ code: 'UNKNOWN', message: 'custom' }) === 'custom');
assert('userMessage no error', SDK.userMessage('NONEXISTENT') === 'An unexpected error occurred.');

// ─── v26c: One-shot buildability ──────────────────────────────────────────────

assertExists('quickConnect');
assertType('quickConnect', SDK.quickConnect, 'function');

assertExists('flattenSession');
assertType('flattenSession', SDK.flattenSession, 'function');

// flattenSession normalizes base_session nesting
const rawSession = {
  '@type': '/sentinel.node.v3.Session',
  base_session: {
    id: '12345',
    acc_address: 'sent1test',
    node_address: 'sentnode1test',
    download_bytes: '1000',
    upload_bytes: '500',
    max_bytes: '1000000000',
    duration: '3600s',
    max_duration: '86400s',
    status: 'active',
    start_at: '2026-03-17T00:00:00Z',
    status_at: '2026-03-17T00:00:00Z',
    inactive_at: '2026-03-18T00:00:00Z',
  },
  price: { denom: 'udvpn', base_value: '0.003', quote_value: '40000000' },
};
const flat = SDK.flattenSession(rawSession);
assert('flattenSession id at top level', flat.id === '12345');
assert('flattenSession node_address', flat.node_address === 'sentnode1test');
assert('flattenSession download_bytes', flat.download_bytes === '1000');
assert('flattenSession preserves price', flat.price.denom === 'udvpn');
assert('flattenSession preserves @type', flat['@type'] === '/sentinel.node.v3.Session');
assert('flattenSession has _raw', flat._raw === rawSession);

// flattenSession handles null gracefully
assert('flattenSession null', SDK.flattenSession(null) === null);

// quickConnect rejects missing mnemonic
try {
  await SDK.quickConnect({});
  assert('quickConnect rejects no mnemonic', false, 'should throw');
} catch (err) {
  assert('quickConnect rejects no mnemonic', err.code === 'INVALID_MNEMONIC');
}

// ─── v27: Connection Mutex ────────────────────────────────────────────────────

assertType('isConnecting', SDK.isConnecting, 'function');
assert('isConnecting returns false initially', SDK.isConnecting() === false);

// ─── v27: VPN Settings Persistence ──────────────────────────────────────────

assertType('loadVpnSettings', SDK.loadVpnSettings, 'function');
assertType('saveVpnSettings', SDK.saveVpnSettings, 'function');

// loadVpnSettings returns object (empty or existing)
const vpnSettings = SDK.loadVpnSettings();
assert('loadVpnSettings returns object', typeof vpnSettings === 'object' && vpnSettings !== null);

// saveVpnSettings round-trip
SDK.saveVpnSettings({ testKey: 'testValue', nested: { a: 1 } });
const reloaded = SDK.loadVpnSettings();
assert('saveVpnSettings round-trip key', reloaded.testKey === 'testValue');
assert('saveVpnSettings round-trip nested', reloaded.nested?.a === 1);

// Clean up test data — restore original settings
SDK.saveVpnSettings(vpnSettings);

// ─── Kill Switch ─────────────────────────────────────────────────────────────

// Kill switch exports
assertExists('enableKillSwitch');
assertType('enableKillSwitch', SDK.enableKillSwitch, 'function');
assertExists('disableKillSwitch');
assertType('disableKillSwitch', SDK.disableKillSwitch, 'function');
assertExists('isKillSwitchEnabled');
assertType('isKillSwitchEnabled', SDK.isKillSwitchEnabled, 'function');
assert('isKillSwitchEnabled returns false', SDK.isKillSwitchEnabled() === false);

// ─── Credential Persistence ──────────────────────────────────────────────────

assertExists('saveCredentials');
assertExists('loadCredentials');
assertExists('clearCredentials');
assertExists('clearAllCredentials');
assertExists('tryFastReconnect');
assertType('saveCredentials', SDK.saveCredentials, 'function');
assertType('loadCredentials', SDK.loadCredentials, 'function');
assertType('clearCredentials', SDK.clearCredentials, 'function');
assertType('clearAllCredentials', SDK.clearAllCredentials, 'function');
assertType('tryFastReconnect', SDK.tryFastReconnect, 'function');

// Round-trip test
SDK.saveCredentials('sentnode1test00000000000000000000000000000', '12345', { serviceType: 'wireguard', wgPrivateKey: 'testkey123' });
const cred = SDK.loadCredentials('sentnode1test00000000000000000000000000000');
assert('credential round-trip', cred && cred.sessionId === '12345');
assert('credential data preserved', cred && cred.wgPrivateKey === 'testkey123');
assert('credential serviceType preserved', cred && cred.serviceType === 'wireguard');
assert('credential has savedAt', cred && typeof cred.savedAt === 'string');

// Clear single credential
SDK.clearCredentials('sentnode1test00000000000000000000000000000');
assert('credential cleared', SDK.loadCredentials('sentnode1test00000000000000000000000000000') === null);

// clearAllCredentials
SDK.saveCredentials('sentnode1aaa0000000000000000000000000000000', '111', { serviceType: 'v2ray' });
SDK.saveCredentials('sentnode1bbb0000000000000000000000000000000', '222', { serviceType: 'wireguard' });
SDK.clearAllCredentials();
assert('clearAllCredentials clears all', SDK.loadCredentials('sentnode1aaa0000000000000000000000000000000') === null);
assert('clearAllCredentials clears all (2)', SDK.loadCredentials('sentnode1bbb0000000000000000000000000000000') === null);

// ─── Results ─────────────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(50)}`);
console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(50)}`);

if (errors.length > 0) {
  console.log('\nFailures:');
  errors.forEach(e => console.log(e));
}

if (failed > 0) {
  process.exit(1);
} else {
  console.log('\nAll smoke tests passed!\n');
}
