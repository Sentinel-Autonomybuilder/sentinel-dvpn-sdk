#!/usr/bin/env node
/**
 * Live mainnet verification — tests every SDK feature against the real chain.
 * Uses the node-tester wallet. Costs ~1-2 P2P per run (one session).
 */

import 'dotenv/config';
const mnemonic = process.env.MNEMONIC;
if (!mnemonic) { console.error('Set MNEMONIC in .env'); process.exit(1); }

import {
  createWallet, getBalance, formatP2P, fetchAllNodes,
  formatNodePricing, estimateSessionPrice, countryNameToCode, getFlagUrl,
  GB_OPTIONS, HOUR_OPTIONS, discoverPlans, preflight,
  validateAppConfig, cached, diskSave, diskLoad, trackSession, getSessionMode,
  loadAppSettings, formatUptime, computeSessionAllocation,
  resolveDnsServers, APP_TYPES, connectDirect, disconnect,
  registerCleanupHandlers, nodeStatusV3, createNodeHttpsAgent,
  DEFAULT_RPC, userMessage, ErrorCodes,
} from './index.js';
import { createClient } from './cosmjs-setup.js';

registerCleanupHandlers();

const R = { pass: 0, fail: 0, errors: [] };
async function t(name, fn) {
  try {
    const r = await fn();
    if (r) { R.pass++; console.log('  ✓', name); }
    else { R.fail++; R.errors.push(name); console.log('  ✗', name, '→ falsy'); }
  } catch (e) {
    R.fail++; R.errors.push(name + ': ' + e.message?.slice(0, 120));
    console.log('  ✗', name, '→', e.message?.slice(0, 120));
  }
}

// ═══ WALLET ═══
console.log('\n═══ WALLET ═══');
const { wallet, account } = await createWallet(mnemonic);
await t('1.1 address starts with sent1', async () => account.address.startsWith('sent1'));
const client = await createClient(DEFAULT_RPC, wallet);
const bal = await getBalance(client, account.address);
await t('1.2 balance > 0', async () => { console.log('      Balance:', formatP2P(bal.udvpn)); return bal.udvpn > 0; });

// ═══ CHAIN QUERIES ═══
console.log('\n═══ CHAIN QUERIES ═══');
const allNodes = await fetchAllNodes();
await t('2.1 fetchAllNodes > 900', async () => { console.log('      Nodes:', allNodes.length); return allNodes.length > 900; });
await t('2.2 nodes have pricing', async () => allNodes.filter(n => n.gigabyte_prices?.length > 0).length > 500);
const plans = await discoverPlans(undefined, { maxId: 30 });
await t('2.5 discoverPlans finds plans', async () => { console.log('      Plans:', plans.length); return plans.length > 0; });

// ═══ PRICING ═══
console.log('\n═══ PRICING ═══');
const dualNode = allNodes.find(n => n.gigabyte_prices?.length > 0 && n.hourly_prices?.length > 0);
await t('7.1 formatNodePricing both', async () => {
  const p = formatNodePricing(dualNode);
  console.log('      GB:', p.perGb, '| Hr:', p.perHour);
  return p.perGb && p.perHour;
});
await t('7.2 estimateSessionPrice gb', async () => estimateSessionPrice(dualNode, 'gb', 5).costUdvpn > 0);
await t('7.3 estimateSessionPrice hour', async () => estimateSessionPrice(dualNode, 'hour', 4).costUdvpn > 0);

// ═══ COUNTRY ═══
console.log('\n═══ COUNTRY & FLAGS ═══');
await t('8.1 The Netherlands → NL', async () => countryNameToCode('The Netherlands') === 'NL');
await t('8.2 Türkiye → TR', async () => countryNameToCode('Türkiye') === 'TR');
await t('8.3 DR Congo → CD', async () => countryNameToCode('DR Congo') === 'CD');
await t('8.4 getFlagUrl', async () => getFlagUrl('US').includes('flagcdn.com'));
await t('8.6 unknown → null', async () => countryNameToCode('Atlantis') === null);

// ═══ CACHE ═══
console.log('\n═══ CACHE & PERSISTENCE ═══');
await t('9.1 cached TTL + dedup', async () => {
  let calls = 0;
  const v1 = await cached('t1', 5000, async () => { calls++; return 42; });
  const v2 = await cached('t1', 5000, async () => { calls++; return 99; });
  return v1 === 42 && v2 === 42 && calls === 1;
});
await t('9.3 cached stale fallback', async () => {
  await cached('t2', 1, async () => 'good'); // cache with 1ms TTL
  await new Promise(r => setTimeout(r, 5)); // expire it
  const val = await cached('t2', 1, async () => { throw new Error('fail'); });
  return val === 'good'; // stale fallback
});
await t('9.4 diskSave + diskLoad', async () => {
  diskSave('test-rt', { x: 1 });
  return diskLoad('test-rt', 60000)?.data?.x === 1;
});
await t('9.5 trackSession persist', async () => {
  trackSession('88888', 'hour');
  return getSessionMode('88888') === 'hour';
});
await t('9.6 loadAppSettings defaults', async () => {
  const s = loadAppSettings();
  return s.dnsPreset === 'handshake' && s.fullTunnel === true;
});

// ═══ DISPLAY ═══
console.log('\n═══ DISPLAY HELPERS ═══');
await t('10.1 formatUptime', async () => formatUptime(7350000) === '2h 2m');
await t('10.3 computeSessionAllocation', async () => {
  const a = computeSessionAllocation({ downloadBytes: '500000000', uploadBytes: '100000000', maxBytes: '1000000000', max_duration: '0s' });
  return a.usedPercent === 60 && a.isGbBased;
});
await t('10.5 userMessage covers all codes', async () => {
  const codes = Object.values(ErrorCodes);
  const covered = codes.filter(c => userMessage(c) !== 'An unexpected error occurred.');
  console.log('      Covered:', covered.length + '/' + codes.length);
  return covered.length === codes.length;
});

// ═══ APP TYPES ═══
console.log('\n═══ APP TYPES ═══');
await t('11.1 white_label valid', async () => validateAppConfig('white_label', { planId: 42, mnemonic: 'x' }).valid);
await t('11.2 white_label missing → errors', async () => !validateAppConfig('white_label', {}).valid);
await t('11.3 direct_p2p valid', async () => validateAppConfig('direct_p2p', { mnemonic: 'x' }).valid);

// ═══ DNS ═══
console.log('\n═══ DNS ═══');
await t('DNS handshake default', async () => resolveDnsServers().includes('103.196.38.38'));
await t('DNS fallback chain', async () => resolveDnsServers('google').includes('103.196.38.38'));

// ═══ PREFLIGHT ═══
console.log('\n═══ PREFLIGHT ═══');
await t('6.5 preflight', async () => {
  const r = preflight();
  console.log('      WG:', r.ready.wireguard, '| V2:', r.ready.v2ray);
  return r.ready.anyProtocol;
});

// ═══ LIVE CONNECTION ═══
console.log('\n═══ LIVE WireGuard CONNECTION ═══');
let wgNode = null;
for (const n of allNodes.slice(0, 25)) {
  try {
    const url = 'https://' + (n.remote_addrs?.[0] || '');
    if (!url || url === 'https://') continue;
    const agent = createNodeHttpsAgent(n.address, 'tofu');
    const status = await nodeStatusV3(url, agent);
    if (status.type === 'wireguard' && (!status.address || status.address === n.address)) {
      wgNode = n;
      console.log('  Found WG:', n.address, '-', status.moniker);
      break;
    }
  } catch {}
}

if (wgNode) {
  await t('3.1 connectDirect WG per-GB', async () => {
    const result = await connectDirect({
      mnemonic, nodeAddress: wgNode.address, gigabytes: 1,
      fullTunnel: false, dns: 'handshake',
      v2rayExePath: process.env.V2RAY_PATH || undefined, // SDK auto-detects
      onProgress: (step, detail) => console.log('     [' + step + ']', detail),
    });
    console.log('      Session:', result.sessionId, 'Type:', result.serviceType);
    trackSession(result.sessionId, 'gb');
    console.log('      Tracked mode:', getSessionMode(result.sessionId));
    await disconnect();
    console.log('      Disconnected OK');
    return result.serviceType === 'wireguard';
  });
} else {
  console.log('  SKIP: No WG node reachable in first 25');
}

// ═══ RESULTS ═══
console.log('\n═══════════════════════════════════════');
console.log('RESULTS:', R.pass, 'passed,', R.fail, 'failed');
if (R.errors.length > 0) {
  console.log('\nFAILURES:');
  for (const e of R.errors) console.log('  ✗', e);
}
console.log('═══════════════════════════════════════');
process.exit(R.fail > 0 ? 1 : 0);
