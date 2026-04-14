/**
 * Sentinel JS SDK — Full On-Chain + Tunnel Integration Test
 *
 * Tests: RPC queries, LCD queries, wallet, balance, nodes, subscriptions,
 * sessions, fee grants, V2Ray connection, WireGuard connection.
 *
 * Usage: MNEMONIC="your 12/24 words" node test/chain-full-test.mjs
 */

import * as SDK from '../index.js';
import * as AiPath from '../ai-path/index.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Config ─────────────────────────────────────────────────────────────────

// Load mnemonic from env or ai-path/.env
let MNEMONIC = process.env.MNEMONIC;
if (!MNEMONIC) {
  try {
    const envPath = resolve(__dirname, '..', '..', 'ai-path', '.env');
    const envContent = readFileSync(envPath, 'utf-8');
    const match = envContent.match(/^MNEMONIC=(.+)$/m);
    if (match) MNEMONIC = match[1].trim();
  } catch {}
}
if (!MNEMONIC) {
  console.error('ERROR: No MNEMONIC found. Set MNEMONIC env var or create ai-path/.env');
  process.exit(1);
}

const SKIP_TUNNEL = process.argv.includes('--skip-tunnel');
const V2RAY_ONLY = process.argv.includes('--v2ray-only');
const WG_ONLY = process.argv.includes('--wg-only');

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];
const t0 = Date.now();

function ok(name, detail) {
  passed++;
  console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name, err) {
  failed++;
  const msg = err?.message || String(err);
  failures.push({ name, msg });
  console.log(`  \x1b[31m✗\x1b[0m ${name} — ${msg}`);
}
function skip(name, reason) {
  skipped++;
  console.log(`  \x1b[33m○\x1b[0m ${name} — SKIP: ${reason}`);
}

// ─── Test Runner ────────────────────────────────────────────────────────────

async function run() {
  console.log('\n══════════════════════════════════════════');
  console.log('  Sentinel JS SDK — Full Chain + Tunnel Test');
  console.log('══════════════════════════════════════════\n');

  // ── Section 1: Wallet ───────────────────────────────────────────────────
  console.log('─── 1. Wallet ───');

  let wallet, address;
  try {
    wallet = await SDK.createWallet(MNEMONIC);
    address = wallet.account?.address || wallet.address || wallet.accounts?.[0]?.address;
    if (!address || !address.startsWith('sent1')) throw new Error(`Bad address: ${address}`);
    ok('createWallet', `address=${address.slice(0, 15)}...`);
  } catch (e) { fail('createWallet', e); return; }

  try {
    const valid = SDK.isMnemonicValid(MNEMONIC);
    if (!valid) throw new Error('returned false');
    ok('isMnemonicValid');
  } catch (e) { fail('isMnemonicValid', e); }

  // ── Section 2: RPC Queries ──────────────────────────────────────────────
  console.log('\n─── 2. RPC Queries ───');

  let rpcClient;
  try {
    rpcClient = await SDK.createRpcQueryClientWithFallback();
    ok('createRpcQueryClientWithFallback', 'connected');
  } catch (e) { fail('createRpcQueryClientWithFallback', e); }

  // Balance
  try {
    const coin = await SDK.rpcQueryBalance(rpcClient, address, 'udvpn');
    const bal = Number(coin?.amount || 0);
    ok('rpcQueryBalance', `${SDK.formatP2P(bal)} (${bal} udvpn)`);
  } catch (e) { fail('rpcQueryBalance', e); }

  // Active nodes
  let nodes = [];
  try {
    nodes = await SDK.rpcQueryNodes(rpcClient, { status: 1, limit: 50 });
    ok('rpcQueryNodes', `${nodes.length} nodes returned`);
  } catch (e) { fail('rpcQueryNodes', e); }

  // Single node
  if (nodes.length > 0) {
    try {
      const n = await SDK.rpcQueryNode(rpcClient, nodes[0].address);
      ok('rpcQueryNode', `${n.address?.slice(0, 20)}... status=${n.status}`);
    } catch (e) { fail('rpcQueryNode', e); }
  }

  // Plan query
  try {
    const plan = await SDK.rpcQueryPlan(rpcClient, 1);
    ok('rpcQueryPlan', `plan #1: provider=${plan?.provider_address?.slice(0, 20) || 'n/a'}...`);
  } catch (e) { fail('rpcQueryPlan', e); }

  // Plan nodes
  try {
    const planNodes = await SDK.rpcQueryNodesForPlan(rpcClient, 1, { limit: 10 });
    ok('rpcQueryNodesForPlan', `plan #1: ${planNodes.length} nodes`);
  } catch (e) { fail('rpcQueryNodesForPlan', e); }

  // Sessions for account
  try {
    const sessions = await SDK.rpcQuerySessionsForAccount(rpcClient, address, { limit: 5 });
    ok('rpcQuerySessionsForAccount', `${sessions.length} sessions`);
  } catch (e) { fail('rpcQuerySessionsForAccount', e); }

  // Subscriptions for account
  try {
    const subs = await SDK.rpcQuerySubscriptionsForAccount(rpcClient, address, { limit: 5 });
    ok('rpcQuerySubscriptionsForAccount', `${subs.length} subscriptions`);
  } catch (e) { fail('rpcQuerySubscriptionsForAccount', e); }

  // Fee grant query
  try {
    // Just test that the function exists and doesn't crash with non-existent grant
    const grant = await SDK.rpcQueryFeeGrant(rpcClient, 'sent1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrec2l', address);
    ok('rpcQueryFeeGrant', grant ? 'grant found' : 'no grant (expected)');
  } catch (e) {
    // "not found" is OK — it means the query works
    if (e.message?.includes('not found') || e.message?.includes('no allowance')) {
      ok('rpcQueryFeeGrant', 'no grant found (expected, query works)');
    } else {
      fail('rpcQueryFeeGrant', e);
    }
  }

  // ── Section 3: LCD Queries (fallback layer) ─────────────────────────────
  console.log('\n─── 3. LCD Queries ───');

  try {
    const overview = await SDK.getNetworkOverview();
    ok('getNetworkOverview', `${overview.activeNodes} active nodes, ${overview.plans} plans`);
  } catch (e) { fail('getNetworkOverview', e); }

  // LCD balance via direct axios (lcdQuery wrapper uses internal failover)
  try {
    const { default: axios } = await import('axios');
    const lcdUrl = SDK.LCD_ENDPOINTS[0]?.url || SDK.DEFAULT_LCD;
    const r = await axios.get(`${lcdUrl}/cosmos/bank/v1beta1/balances/${address}`, { timeout: 10000 });
    const udvpn = r.data?.balances?.find(b => b.denom === 'udvpn')?.amount || '0';
    ok('LCD balance (direct)', `${SDK.formatP2P(Number(udvpn))}`);
  } catch (e) { fail('LCD balance (direct)', e); }

  try {
    const hasSub = await SDK.hasActiveSubscription(address);
    ok('hasActiveSubscription', `${hasSub}`);
  } catch (e) { fail('hasActiveSubscription', e); }

  try {
    const lcdUrl = SDK.LCD_ENDPOINTS[0]?.url || SDK.LCD_ENDPOINTS[0] || SDK.DEFAULT_LCD;
    const subs = await SDK.querySubscriptions(lcdUrl, address);
    ok('querySubscriptions (LCD)', `${subs?.length || 0} subs`);
  } catch (e) { fail('querySubscriptions (LCD)', e); }

  // ── Section 4: Node Discovery & Pricing ─────────────────────────────────
  console.log('\n─── 4. Node Discovery & Pricing ───');

  let liveNodes = [];
  try {
    liveNodes = await SDK.queryOnlineNodes({ limit: 20 });
    ok('queryOnlineNodes', `${liveNodes.length} nodes`);
  } catch (e) { fail('queryOnlineNodes', e); }

  if (liveNodes.length > 0) {
    try {
      const prices = await SDK.getNodePrices(liveNodes[0].address || liveNodes[0].node_address);
      ok('getNodePrices', JSON.stringify(prices).slice(0, 100));
    } catch (e) { fail('getNodePrices', e); }
  }

  try {
    const cost = await SDK.estimateSessionCost({ gigabytes: 1 });
    ok('estimateSessionCost', `1GB ≈ ${cost?.total?.p2p || JSON.stringify(cost).slice(0, 80)}`);
  } catch (e) { fail('estimateSessionCost', e); }

  // ── Section 5: AI Path Functions ────────────────────────────────────────
  console.log('\n─── 5. AI Path ───');

  try {
    const env = await AiPath.getEnvironment();
    ok('getEnvironment', `${env.os}/${env.arch} v2ray=${env.v2ray?.available} wg=${env.wireguard?.available}`);
  } catch (e) { fail('getEnvironment', e); }

  try {
    const cost = await AiPath.estimateCost({ gigabytes: 5 });
    ok('estimateCost(5GB)', `${cost.grandTotal.p2p}`);
  } catch (e) { fail('estimateCost', e); }

  try {
    const disc = await AiPath.discoverNodes({ limit: 10 });
    ok('discoverNodes', `${disc.length} nodes`);
  } catch (e) { fail('discoverNodes', e); }

  try {
    const rec = await AiPath.recommend({ limit: 5 });
    ok('recommend', `${rec.length} recommended nodes`);
  } catch (e) { fail('recommend', e); }

  try {
    const w = await AiPath.createWallet();
    ok('createWallet (ai-path)', `${w.address?.slice(0, 15)}...`);
  } catch (e) { fail('createWallet (ai-path)', e); }

  try {
    const bal = await AiPath.getBalance(MNEMONIC);
    ok('getBalance (ai-path)', `${bal?.display || bal?.p2p || JSON.stringify(bal).slice(0, 80)}`);
  } catch (e) { fail('getBalance (ai-path)', e); }

  // ── Section 6: Protocol Layer ───────────────────────────────────────────
  console.log('\n─── 6. Protocol Layer ───');

  try {
    const kp = SDK.generateWgKeyPair();
    if (!kp.publicKey || !kp.privateKey) throw new Error('Missing keys');
    ok('generateWgKeyPair', `pub=${kp.publicKey.slice(0, 15)}...`);
  } catch (e) { fail('generateWgKeyPair', e); }

  try {
    const uuid = SDK.generateV2RayUUID();
    if (!uuid || uuid.length < 30) throw new Error(`Bad UUID: ${uuid}`);
    ok('generateV2RayUUID', uuid);
  } catch (e) { fail('generateV2RayUUID', e); }

  // ── Section 7: Message Builders ─────────────────────────────────────────
  console.log('\n─── 7. Message Builders ───');

  // Message builders use {from, id} pattern (matching protobuf field names)
  const msgTests = [
    ['buildMsg_StartSession', () => SDK.buildMsg_StartSession({ from: address, nodeAddress: 'sentnode1test', denom: 'udvpn', deposit: '10000000' })],
    ['buildMsg_EndSession', () => SDK.buildMsg_EndSession({ from: address, id: '1' })],
    ['buildMsg_StartSubscription', () => SDK.buildMsg_StartSubscription({ from: address, id: '1', denom: 'udvpn' })],
    ['buildMsg_CancelSubscription', () => SDK.buildMsg_CancelSubscription({ from: address, id: '1' })],
    ['buildMsg_ShareSubscription', () => SDK.buildMsg_ShareSubscription({ from: address, id: '1', accAddress: 'sent1other', bytes: '1000000000' })],
    ['buildMsg_SubStartSession', () => SDK.buildMsg_SubStartSession({ from: address, id: '1', nodeAddress: 'sentnode1test' })],
    ['buildMsg_RenewSubscription', () => SDK.buildMsg_RenewSubscription({ from: address, id: '1', denom: 'udvpn' })],
    ['buildMsg_UpdateSubscription', () => SDK.buildMsg_UpdateSubscription({ from: address, id: '1', renewalPricePolicy: 0 })],
    ['buildMsg_CreatePlan', () => SDK.buildMsg_CreatePlan({ from: address, duration: '720h', gigabytes: '100', prices: [{ denom: 'udvpn', amount: '1000000' }] })],
    ['buildMsg_LinkNode', () => SDK.buildMsg_LinkNode({ from: address, id: '1', nodeAddress: 'sentnode1test' })],
    ['buildMsg_UnlinkNode', () => SDK.buildMsg_UnlinkNode({ from: address, id: '1', nodeAddress: 'sentnode1test' })],
    ['buildMsg_RegisterProvider', () => SDK.buildMsg_RegisterProvider({ from: address, name: 'Test', identity: '', website: '', description: '' })],
    ['buildMsg_RegisterNode', () => SDK.buildMsg_RegisterNode({ from: address, gigabytePrice: '1000000udvpn', hourlyPrice: '100000udvpn', remoteUrl: 'https://test:443' })],
  ];

  for (const [name, fn] of msgTests) {
    try {
      const msg = fn();
      if (!msg?.typeUrl) throw new Error('No typeUrl');
      ok(name, msg.typeUrl.split('.').pop());
    } catch (e) { fail(name, e); }
  }

  // ── Section 8: State & Cache ────────────────────────────────────────────
  console.log('\n─── 8. State & Cache ───');

  try {
    SDK.saveState({ sessionId: '99999' });
    const s = SDK.loadState();
    if (!s?.sessionId) throw new Error('State not persisted');
    SDK.clearState();
    const s2 = SDK.loadState();
    if (s2 !== null) throw new Error('State not cleared');
    ok('saveState/loadState/clearState', `sessionId=${s.sessionId}`);
  } catch (e) { fail('state persistence', e); }

  try {
    SDK.diskSave('sdk-test-key', { hello: 'world', ts: Date.now() });
    const v = SDK.diskLoad('sdk-test-key');
    if (v?.data?.hello !== 'world' && v?.hello !== 'world') throw new Error(`Disk cache miss: ${JSON.stringify(v)?.slice(0, 100)}`);
    SDK.diskClear('sdk-test-key');
    ok('diskSave/diskLoad/diskClear');
  } catch (e) { fail('disk cache', e); }

  try {
    const settings = SDK.loadAppSettings();
    ok('loadAppSettings', `keys: ${Object.keys(settings).length}`);
  } catch (e) { fail('loadAppSettings', e); }

  // ── Section 9: Typed Errors ─────────────────────────────────────────────
  console.log('\n─── 9. Typed Errors ───');

  try {
    // NodeError(code, message) — code first, message second
    const e = new SDK.NodeError('NODE_OFFLINE', 'Node is offline');
    if (e.code !== 'NODE_OFFLINE') throw new Error(`Bad code: ${e.code}`);
    if (!(e instanceof SDK.SentinelError)) throw new Error('Not SentinelError');
    ok('NodeError', `code=${e.code} msg=${e.message}`);
  } catch (e) { fail('NodeError', e); }

  try {
    if (!SDK.isRetryable('NODE_OFFLINE')) throw new Error('NODE_OFFLINE should be retryable');
    if (SDK.isRetryable('INVALID_MNEMONIC')) throw new Error('INVALID_MNEMONIC should not be retryable');
    ok('isRetryable', 'NODE_OFFLINE=retryable, INVALID_MNEMONIC=not');
  } catch (e) { fail('isRetryable', e); }

  // ── Section 10: V2Ray Tunnel Test ───────────────────────────────────────
  console.log('\n─── 10. V2Ray Tunnel ───');

  if (SKIP_TUNNEL || WG_ONLY) {
    skip('V2Ray connection', 'tunnel tests skipped');
  } else {
    try {
      console.log('    Connecting via V2Ray (this takes 30-60s)...');
      const result = await AiPath.connect({
        mnemonic: MNEMONIC,
        protocol: 'v2ray',
        timeout: 120000,
      });

      ok('V2Ray connect', `node=${result.nodeAddress?.slice(0, 20)}... ip=${result.ip || 'n/a'}`);

      // Check status
      try {
        const st = await AiPath.status();
        ok('status() while connected', `connected=${st.connected} protocol=${st.protocol}`);
      } catch (e) { fail('status() while connected', e); }

      // Check isVpnActive
      try {
        const active = await AiPath.isVpnActive();
        ok('isVpnActive()', `${active}`);
      } catch (e) { fail('isVpnActive()', e); }

      // Verify tunnel
      try {
        const v = await AiPath.verify();
        ok('verify()', `tunnelIp=${v.tunnelIp || v.ip} latency=${v.latency || 'n/a'}ms`);
      } catch (e) { fail('verify()', e); }

      // Disconnect
      try {
        const disc = await AiPath.disconnect();
        ok('V2Ray disconnect', `uptime=${disc.uptime || 'n/a'}s cost=${disc.cost?.p2p || 'n/a'}`);
      } catch (e) { fail('V2Ray disconnect', e); }

      // Wait between tests
      await new Promise(r => setTimeout(r, 5000));
    } catch (e) {
      fail('V2Ray connect', e);
    }
  }

  // ── Section 11: WireGuard Tunnel Test ─────────────────────────────────
  console.log('\n─── 11. WireGuard Tunnel ───');

  if (SKIP_TUNNEL || V2RAY_ONLY) {
    skip('WireGuard connection', 'tunnel tests skipped');
  } else if (!SDK.IS_ADMIN) {
    skip('WireGuard connection', 'requires admin privileges');
  } else if (!SDK.WG_AVAILABLE) {
    skip('WireGuard connection', 'WireGuard not installed');
  } else {
    try {
      console.log('    Connecting via WireGuard (this takes 30-60s)...');
      const result = await AiPath.connect({
        mnemonic: MNEMONIC,
        protocol: 'wireguard',
        timeout: 120000,
      });

      ok('WireGuard connect', `node=${result.nodeAddress?.slice(0, 20)}... ip=${result.ip || 'n/a'}`);

      // Check status
      try {
        const st = await AiPath.status();
        ok('status() WG connected', `connected=${st.connected} protocol=${st.protocol}`);
      } catch (e) { fail('status() WG connected', e); }

      // Verify tunnel
      try {
        const v = await AiPath.verify();
        ok('verify() WG', `tunnelIp=${v.tunnelIp || v.ip} latency=${v.latency || 'n/a'}ms`);
      } catch (e) { fail('verify() WG', e); }

      // Disconnect
      try {
        const disc = await AiPath.disconnect();
        ok('WireGuard disconnect', `uptime=${disc.uptime || 'n/a'}s`);
      } catch (e) { fail('WireGuard disconnect', e); }
    } catch (e) {
      fail('WireGuard connect', e);
    }
  }

  // ── Section 12: Event Parsers ───────────────────────────────────────────
  console.log('\n─── 12. Event Parsers & Utilities ───');

  try {
    const p = SDK.NodeEventCreateSession;
    if (!p || !p.type) throw new Error('Missing parser');
    ok('NodeEventCreateSession', `type=${p.type}`);
  } catch (e) { fail('NodeEventCreateSession', e); }

  try {
    const urls = SDK.TYPE_URLS;
    const keys = Object.keys(urls);
    ok('TYPE_URLS', `${keys.length} type URLs defined`);
  } catch (e) { fail('TYPE_URLS', e); }

  try {
    const formatted = SDK.formatP2P(50000000);
    if (formatted !== '50.00 P2P') throw new Error(`Got: ${formatted}`);
    ok('formatP2P', formatted);
  } catch (e) { fail('formatP2P', e); }

  try {
    const bytes = SDK.formatBytes(1073741824);
    ok('formatBytes', `1GB = ${bytes}`);
  } catch (e) { fail('formatBytes', e); }

  try {
    const cc = SDK.countryNameToCode('Germany');
    if (cc !== 'DE') throw new Error(`Got: ${cc}`);
    ok('countryNameToCode', `Germany → ${cc}`);
  } catch (e) { fail('countryNameToCode', e); }

  // ── Results ─────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('\n══════════════════════════════════════════');
  console.log(`  RESULTS: ${passed} passed, ${failed} failed, ${skipped} skipped (${elapsed}s)`);
  console.log('══════════════════════════════════════════');

  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) {
      console.log(`  ✗ ${f.name}: ${f.msg}`);
    }
  }

  console.log();

  // Cleanup RPC
  try { SDK.disconnectRpc?.(); } catch {}

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
