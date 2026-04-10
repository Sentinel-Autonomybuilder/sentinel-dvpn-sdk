#!/usr/bin/env node
/**
 * TEST EVERY CONNECTION TYPE
 *
 * 6 connection combinations:
 * 1. WireGuard + per-GB + direct
 * 2. WireGuard + per-Hour + direct
 * 3. V2Ray + per-GB + direct
 * 4. V2Ray + per-Hour + direct
 * 5. WireGuard + plan + fee-granted
 * 6. V2Ray + plan + fee-granted
 *
 * Plus: session cancel for each
 */
import 'dotenv/config';
const mnemonic = process.env.MNEMONIC;
if (!mnemonic) { console.error('Set MNEMONIC in .env'); process.exit(1); }

import {
  createWallet, generateWallet, createClient, broadcast,
  fetchAllNodes, connectDirect, connectViaPlan, disconnect,
  subscribeToPlan, sendTokens, buildFeeGrantMsg,
  registerCleanupHandlers, nodeStatusV3, createNodeHttpsAgent,
  DEFAULT_RPC, MSG_TYPES,
} from './index.js';
import { buildEndSessionMsg, sentToSentprov, extractId } from './cosmjs-setup.js';

registerCleanupHandlers();

const R = { pass: 0, fail: 0, errors: [] };
async function t(name, fn) {
  try {
    const r = await fn();
    if (r) { R.pass++; console.log('  ✓', name); return r; }
    else { R.fail++; R.errors.push(name); console.log('  ✗', name); return null; }
  } catch (e) {
    R.fail++; R.errors.push(name + ': ' + e.message?.slice(0, 120));
    console.log('  ✗', name, '→', e.message?.slice(0, 120));
    return null;
  }
}

console.log('═══════════════════════════════════════════');
console.log('  EVERY CONNECTION TYPE — Live Mainnet');
console.log('═══════════════════════════════════════════\n');

const { wallet: opW, account: opA } = await createWallet(mnemonic);
const opC = await createClient(DEFAULT_RPC, opW);
const provAddr = sentToSentprov(opA.address);

// Find one WG and one V2Ray node
console.log('Finding nodes...');
const allNodes = await fetchAllNodes();
let wgNode = null, v2Node = null;

for (const n of allNodes.slice(0, 60)) {
  if (wgNode && v2Node) break;
  try {
    const url = 'https://' + (n.remote_addrs?.[0] || '');
    if (!url || url === 'https://') continue;
    const agent = createNodeHttpsAgent(n.address, 'tofu');
    const s = await nodeStatusV3(url, agent);
    if (!s.address || s.address === n.address) {
      if (s.type === 'wireguard' && !wgNode) {
        wgNode = n; console.log('  WG:', n.address, '-', s.moniker);
      }
      if (s.type === 'v2ray' && !v2Node) {
        v2Node = n; console.log('  V2:', n.address, '-', s.moniker);
      }
    }
  } catch {}
}

if (!wgNode) { console.log('No WG node found!'); process.exit(1); }
if (!v2Node) { console.log('No V2Ray node found!'); process.exit(1); }

const V2RAY = process.env.V2RAY_PATH || undefined; // SDK auto-detects
const baseOpts = { fullTunnel: false, dns: 'handshake', v2rayExePath: V2RAY,
  onProgress: (s, d) => console.log('     [' + s + ']', d) };

// ═══ 1. WireGuard per-GB ═══
console.log('\n═══ 1. WireGuard + per-GB + Direct ═══');
await t('WG-GB', async () => {
  const r = await connectDirect({ ...baseOpts, mnemonic, nodeAddress: wgNode.address, gigabytes: 1 });
  console.log('      Session:', r.sessionId, '| Type:', r.serviceType);
  await disconnect();
  return r.serviceType === 'wireguard';
});

// ═══ 2. WireGuard per-Hour ═══
console.log('\n═══ 2. WireGuard + per-Hour + Direct ═══');
await t('WG-HOUR', async () => {
  const r = await connectDirect({ ...baseOpts, mnemonic, nodeAddress: wgNode.address, hours: 1 });
  console.log('      Session:', r.sessionId, '| Type:', r.serviceType, '(hourly)');
  await disconnect();
  return r.serviceType === 'wireguard';
});

// ═══ 3. V2Ray per-GB ═══
console.log('\n═══ 3. V2Ray + per-GB + Direct ═══');
await t('V2-GB', async () => {
  const r = await connectDirect({ ...baseOpts, mnemonic, nodeAddress: v2Node.address, gigabytes: 1 });
  console.log('      Session:', r.sessionId, '| Type:', r.serviceType, '| SOCKS:', r.socksPort);
  await disconnect();
  return r.serviceType === 'v2ray';
});

// ═══ 4. V2Ray per-Hour ═══
console.log('\n═══ 4. V2Ray + per-Hour + Direct ═══');
await t('V2-HOUR', async () => {
  const r = await connectDirect({ ...baseOpts, mnemonic, nodeAddress: v2Node.address, hours: 1 });
  console.log('      Session:', r.sessionId, '| Type:', r.serviceType, '| SOCKS:', r.socksPort, '(hourly)');
  await disconnect();
  return r.serviceType === 'v2ray';
});

// ═══ 5. WireGuard + Plan + Fee Grant ═══
console.log('\n═══ 5. WireGuard + Plan + Fee-Granted ═══');

// Recreate operator client to reset sequence cache after direct connection TXs
const opC2 = await createClient(DEFAULT_RPC, opW);

// Create plan with WG node
console.log('  Setting up plan...');
const planMsg = { typeUrl: MSG_TYPES.CREATE_PLAN, value: { from: provAddr, bytes: '100000000', duration: { seconds: 3600 }, prices: [{ denom: 'udvpn', base_value: '0.000000100000000000', quote_value: '100000' }] } };
const planR = await broadcast(opC2 || opC, opA.address, [planMsg]);
const wgPlanId = extractId(planR, /plan/i, ['plan_id', 'id']);
console.log('  Plan:', wgPlanId);
await new Promise(r => setTimeout(r, 7000));

// Activate + lease + link WG node
await broadcast(opC2 || opC, opA.address, [{ typeUrl: MSG_TYPES.UPDATE_PLAN_STATUS, value: { from: provAddr, id: parseInt(wgPlanId), status: 1 } }]);
await new Promise(r => setTimeout(r, 7000));
const wgHrPrice = wgNode.hourly_prices?.find(p => p.denom === 'udvpn');
if (wgHrPrice) {
  try { await broadcast(opC2 || opC, opA.address, [{ typeUrl: MSG_TYPES.START_LEASE, value: { from: provAddr, nodeAddress: wgNode.address, hours: 1, maxPrice: wgHrPrice, renewalPricePolicy: 0 } }]); } catch {}
  await new Promise(r => setTimeout(r, 7000));
}
try { await broadcast(opC2 || opC, opA.address, [{ typeUrl: MSG_TYPES.LINK_NODE, value: { from: provAddr, id: parseInt(wgPlanId), nodeAddress: wgNode.address } }]); } catch {}
await new Promise(r => setTimeout(r, 7000));

// Create user + fund + subscribe + grant
const { mnemonic: userMn1, account: userA1 } = await generateWallet();
await sendTokens(opC2 || opC, opA.address, userA1.address, '3000000', 'udvpn');
await new Promise(r => setTimeout(r, 8000));
const { wallet: uW1 } = await createWallet(userMn1);
const uC1 = await createClient(DEFAULT_RPC, uW1);
await subscribeToPlan(uC1, userA1.address, wgPlanId);
await new Promise(r => setTimeout(r, 7000));
await broadcast(opC2 || opC, opA.address, [buildFeeGrantMsg(opA.address, userA1.address, { spendLimit: 5_000_000 })]);
await new Promise(r => setTimeout(r, 5000));

await t('WG-PLAN', async () => {
  const r = await connectViaPlan({ ...baseOpts, mnemonic: userMn1, planId: parseInt(wgPlanId), nodeAddress: wgNode.address, feeGranter: opA.address });
  console.log('      Session:', r.sessionId, '| Type:', r.serviceType, '(plan, fee-granted)');
  await disconnect();
  return r.serviceType === 'wireguard';
});

// ═══ 6. V2Ray + Plan + Fee Grant ═══
console.log('\n═══ 6. V2Ray + Plan + Fee-Granted ═══');

// Create plan with V2Ray node
await new Promise(r => setTimeout(r, 7000));
const planMsg2 = { typeUrl: MSG_TYPES.CREATE_PLAN, value: { from: provAddr, bytes: '100000000', duration: { seconds: 3600 }, prices: [{ denom: 'udvpn', base_value: '0.000000100000000000', quote_value: '100000' }] } };
const planR2 = await broadcast(opC2 || opC, opA.address, [planMsg2]);
const v2PlanId = extractId(planR2, /plan/i, ['plan_id', 'id']);
console.log('  Plan:', v2PlanId);
await new Promise(r => setTimeout(r, 7000));

await broadcast(opC2 || opC, opA.address, [{ typeUrl: MSG_TYPES.UPDATE_PLAN_STATUS, value: { from: provAddr, id: parseInt(v2PlanId), status: 1 } }]);
await new Promise(r => setTimeout(r, 7000));
// Lease V2Ray node first (required before linking)
const v2HrPrice = v2Node.hourly_prices?.find(p => p.denom === 'udvpn');
if (v2HrPrice) {
  try { await broadcast(opC2 || opC, opA.address, [{ typeUrl: MSG_TYPES.START_LEASE, value: { from: provAddr, nodeAddress: v2Node.address, hours: 1, maxPrice: v2HrPrice, renewalPricePolicy: 0 } }]); console.log('  V2Ray node leased'); } catch (e) { console.log('  Lease:', e.message?.includes('already') ? 'active' : e.message?.slice(0, 60)); }
  await new Promise(r => setTimeout(r, 7000));
}
// Link V2Ray node to plan
try { await broadcast(opC2 || opC, opA.address, [{ typeUrl: MSG_TYPES.LINK_NODE, value: { from: provAddr, id: parseInt(v2PlanId), nodeAddress: v2Node.address } }]); console.log('  V2Ray node linked'); } catch (e) { console.log('  Link:', e.message?.includes('duplicate') ? 'already linked' : e.message?.slice(0, 60)); }
await new Promise(r => setTimeout(r, 7000));

const { mnemonic: userMn2, account: userA2 } = await generateWallet();
await sendTokens(opC2 || opC, opA.address, userA2.address, '3000000', 'udvpn');
await new Promise(r => setTimeout(r, 8000));
const { wallet: uW2 } = await createWallet(userMn2);
const uC2 = await createClient(DEFAULT_RPC, uW2);
await subscribeToPlan(uC2, userA2.address, v2PlanId);
await new Promise(r => setTimeout(r, 7000));
await broadcast(opC2 || opC, opA.address, [buildFeeGrantMsg(opA.address, userA2.address, { spendLimit: 5_000_000 })]);
await new Promise(r => setTimeout(r, 5000));

await t('V2-PLAN', async () => {
  const r = await connectViaPlan({ ...baseOpts, mnemonic: userMn2, planId: parseInt(v2PlanId), nodeAddress: v2Node.address, feeGranter: opA.address });
  console.log('      Session:', r.sessionId, '| Type:', r.serviceType, '| SOCKS:', r.socksPort, '(plan, fee-granted)');
  await disconnect();
  return r.serviceType === 'v2ray';
});

// ═══ RESULTS ═══
console.log('\n═══════════════════════════════════════════');
console.log('  RESULTS:', R.pass, '/', (R.pass + R.fail), 'passed');
if (R.errors.length > 0) {
  console.log('\n  FAILURES:');
  for (const e of R.errors) console.log('    ✗', e);
}
console.log('═══════════════════════════════════════════');
process.exit(R.fail > 0 ? 1 : 0);
