#!/usr/bin/env node
/**
 * FULL PLAN LIFECYCLE TEST — Live Mainnet
 *
 * Tests the entire commercial/white-label dVPN flow:
 * 1. Register as provider
 * 2. Create a plan
 * 3. Find a good node and link it to the plan
 * 4. Generate a new user wallet
 * 5. Transfer P2P to the user wallet
 * 6. Subscribe the user to the plan
 * 7. Issue fee grant to the user
 * 8. Connect the user via the plan (gas-free)
 * 9. Verify connection works
 * 10. Disconnect and clean up
 *
 * Cost: ~5-10 P2P total (plan creation + session + transfer + gas)
 */

import 'dotenv/config';
const operatorMnemonic = process.env.MNEMONIC;
if (!operatorMnemonic) { console.error('Set MNEMONIC in .env'); process.exit(1); }

import {
  createWallet, generateWallet, getBalance, formatP2P, sendTokens,
  createClient, broadcast, broadcastWithFeeGrant,
  fetchAllNodes, queryPlanNodes, discoverPlans,
  subscribeToPlan, hasActiveSubscription,
  connectViaPlan, connectDirect, disconnect,
  encodeMsgCreatePlan, encodeMsgUpdatePlanStatus, encodeMsgLinkNode,
  encodeMsgRegisterProvider, encodeMsgStartLease,
  buildFeeGrantMsg, queryFeeGrants,
  sentToSentprov, extractId,
  registerCleanupHandlers, nodeStatusV3, createNodeHttpsAgent,
  DEFAULT_RPC, LCD_ENDPOINTS,
} from './index.js';

registerCleanupHandlers();

const R = { pass: 0, fail: 0, errors: [] };
async function t(name, fn) {
  try {
    const r = await fn();
    if (r) { R.pass++; console.log('  ✓', name); return r; }
    else { R.fail++; R.errors.push(name); console.log('  ✗', name, '→ falsy'); return null; }
  } catch (e) {
    R.fail++; R.errors.push(name + ': ' + e.message?.slice(0, 150));
    console.log('  ✗', name, '→', e.message?.slice(0, 150));
    return null;
  }
}

console.log('═══════════════════════════════════════');
console.log('  FULL PLAN LIFECYCLE TEST — Live Mainnet');
console.log('═══════════════════════════════════════\n');

// ─── Step 1: Operator wallet setup ──────────────────────────────────────────
console.log('═══ STEP 1: OPERATOR WALLET ═══');
const { wallet: opWallet, account: opAccount } = await createWallet(operatorMnemonic);
const opClient = await createClient(DEFAULT_RPC, opWallet);
const opBal = await getBalance(opClient, opAccount.address);
console.log('  Operator:', opAccount.address);
console.log('  Balance:', formatP2P(opBal.udvpn));
console.log('  Provider:', sentToSentprov(opAccount.address));

if (opBal.udvpn < 5_000_000) {
  console.error('  Need at least 5 P2P to run this test');
  process.exit(1);
}

// ─── Step 2: Register provider (if not already) ────────────────────────────
console.log('\n═══ STEP 2: REGISTER PROVIDER ═══');
const provAddr = sentToSentprov(opAccount.address);
await t('2.1 Register/update provider', async () => {
  // Encoders return raw protobuf bytes — wrap in { typeUrl, value }
  try {
    const msg = {
      typeUrl: '/sentinel.provider.v3.MsgRegisterProviderRequest',
      value: { from: opAccount.address, name: 'SDK Test Provider', identity: '', website: '', description: 'Automated SDK lifecycle test' },
    };
    const result = await broadcast(opClient, opAccount.address, [msg]);
    console.log('      Registered. TX:', result.transactionHash);
    return true;
  } catch (e) {
    if (e.message?.includes('already registered') || e.message?.includes('duplicate')) {
      console.log('      Already registered (OK)');
      return true;
    }
    throw e;
  }
});

// ─── Step 3: Create a plan ──────────────────────────────────────────────────
console.log('\n═══ STEP 3: CREATE PLAN ═══');
let planId = null;
await t('3.1 Create plan (1GB, 30 days, 1 P2P)', async () => {
  // encodeMsgCreatePlan expects: { from, bytes, duration, prices }
  // bytes = total bandwidth in bytes string (1 GB = 1000000000)
  // duration = { seconds: N } — plan validity
  // prices = subscription price array
  const planMsg = {
    typeUrl: '/sentinel.plan.v3.MsgCreatePlanRequest',
    value: {
      from: provAddr,
      bytes: '1000000000', // 1 GB
      duration: { seconds: 30 * 24 * 3600 }, // 30 days
      prices: [{ denom: 'udvpn', base_value: '0.000001000000000000', quote_value: '1000000' }],
    },
  };
  const result = await broadcast(opClient, opAccount.address, [planMsg]);
  planId = extractId(result, /plan/i, ['plan_id', 'id']);
  if (!planId) {
    // Try extracting from events differently
    for (const ev of (result.events || [])) {
      for (const attr of (ev.attributes || [])) {
        if (attr.key === 'plan_id' || attr.key === 'id') {
          planId = attr.value;
          break;
        }
        // Try base64 decode
        try {
          const decoded = Buffer.from(attr.key, 'base64').toString('utf8');
          if (decoded === 'plan_id' || decoded === 'id') {
            planId = Buffer.from(attr.value, 'base64').toString('utf8');
            break;
          }
        } catch {}
      }
      if (planId) break;
    }
  }
  console.log('      Plan created. ID:', planId, 'TX:', result.transactionHash);
  return !!planId;
});

if (!planId) {
  console.error('  Plan creation failed — cannot continue');
  process.exit(1);
}

// ─── Step 3b: Activate plan ─────────────────────────────────────────────────
await t('3.2 Activate plan', async () => {
  // encodeMsgUpdatePlanStatus expects: { from, id, status }
  const activateMsg = {
    typeUrl: '/sentinel.plan.v3.MsgUpdatePlanStatusRequest',
    value: { from: provAddr, id: parseInt(planId), status: 1 },
  };
  const result = await broadcast(opClient, opAccount.address, [activateMsg]);
  console.log('      Plan activated. TX:', result.transactionHash);
  return result.code === 0;
});

// ─── Step 4: Find a good WG node and link it ───────────────────────────────
console.log('\n═══ STEP 4: LINK NODE TO PLAN ═══');
const allNodes = await fetchAllNodes();
let linkedNode = null;

// Find a WG node that responds
for (const n of allNodes.slice(0, 30)) {
  try {
    const url = 'https://' + (n.remote_addrs?.[0] || '');
    if (!url || url === 'https://') continue;
    const agent = createNodeHttpsAgent(n.address, 'tofu');
    const status = await nodeStatusV3(url, agent);
    if (status.type === 'wireguard' && (!status.address || status.address === n.address)) {
      linkedNode = n;
      console.log('  Found WG node:', n.address, '-', status.moniker);
      break;
    }
  } catch {}
}

if (!linkedNode) {
  console.error('  No reachable WG node found — cannot link');
  process.exit(1);
}

await t('4.1 Lease node (required before linking)', async () => {
  try {
    const gbPrice = linkedNode.gigabyte_prices?.find(p => p.denom === 'udvpn');
    if (!gbPrice) throw new Error('Node has no udvpn pricing');
    // encodeMsgStartLease expects: { from, nodeAddress, hours, maxPrice, renewalPricePolicy }
    // maxPrice must EXACTLY match node's hourly_prices
    const hrPrice = linkedNode.hourly_prices?.find(p => p.denom === 'udvpn') || gbPrice;
    const leaseMsg = {
      typeUrl: '/sentinel.lease.v1.MsgStartLeaseRequest',
      value: {
        from: provAddr,
        nodeAddress: linkedNode.address,
        hours: 1,
        maxPrice: hrPrice, // must match node's price exactly
        renewalPricePolicy: 7,
      },
    };
    const result = await broadcast(opClient, opAccount.address, [leaseMsg]);
    console.log('      Leased. TX:', result.transactionHash);
    return result.code === 0;
  } catch (e) {
    if (e.message?.includes('already exists') || e.message?.includes('active lease')) {
      console.log('      Active lease exists (OK)');
      return true;
    }
    throw e;
  }
});

await t('4.2 Link node to plan', async () => {
  try {
    // encodeMsgLinkNode expects: { from, id, nodeAddress }
    const linkMsg = {
      typeUrl: '/sentinel.plan.v3.MsgLinkNodeRequest',
      value: { from: provAddr, id: parseInt(planId), nodeAddress: linkedNode.address },
    };
    const result = await broadcast(opClient, opAccount.address, [linkMsg]);
    console.log('      Linked. TX:', result.transactionHash);
    return result.code === 0;
  } catch (e) {
    if (e.message?.includes('duplicate') || e.message?.includes('already')) {
      console.log('      Already linked (OK)');
      return true;
    }
    throw e;
  }
});

// Verify plan has nodes
await t('4.3 queryPlanNodes returns linked node', async () => {
  const { items } = await queryPlanNodes(planId);
  console.log('      Plan nodes:', items.length);
  return items.length > 0;
});

// ─── Step 5: Generate user wallet + fund it ─────────────────────────────────
console.log('\n═══ STEP 5: CREATE USER WALLET ═══');
const { mnemonic: userMnemonic, account: userAccount } = await generateWallet();
console.log('  User address:', userAccount.address);
console.log('  User mnemonic: (generated, not printed for safety)');

await t('5.1 Transfer 2 P2P to user wallet', async () => {
  const result = await sendTokens(opClient, opAccount.address, userAccount.address, '2000000', 'udvpn');
  console.log('      TX:', result.transactionHash);
  return result.code === 0;
});

// Wait for transfer to confirm
await new Promise(r => setTimeout(r, 5000));

await t('5.2 User balance = 2 P2P', async () => {
  const { wallet: uWallet } = await createWallet(userMnemonic);
  const uClient = await createClient(DEFAULT_RPC, uWallet);
  const uBal = await getBalance(uClient, userAccount.address);
  console.log('      User balance:', formatP2P(uBal.udvpn));
  return uBal.udvpn >= 1_000_000;
});

// ─── Step 6: Subscribe user to plan ─────────────────────────────────────────
console.log('\n═══ STEP 6: SUBSCRIBE TO PLAN ═══');
await t('6.1 hasActiveSubscription = false before subscribe', async () => {
  const sub = await hasActiveSubscription(userAccount.address, planId);
  console.log('      Has subscription:', sub.has);
  return !sub.has;
});

await t('6.2 subscribeToPlan', async () => {
  const { wallet: uWallet } = await createWallet(userMnemonic);
  const uClient = await createClient(DEFAULT_RPC, uWallet);
  const result = await subscribeToPlan(uClient, userAccount.address, planId);
  console.log('      Subscription ID:', result.subscriptionId, 'TX:', result.txHash);
  return !!result.subscriptionId;
});

await new Promise(r => setTimeout(r, 5000));

await t('6.3 hasActiveSubscription = true after subscribe', async () => {
  const sub = await hasActiveSubscription(userAccount.address, planId);
  console.log('      Has subscription:', sub.has);
  return sub.has;
});

// ─── Step 7: Issue fee grant ────────────────────────────────────────────────
console.log('\n═══ STEP 7: FEE GRANT ═══');
await t('7.1 Grant fee allowance to user', async () => {
  const grantMsg = buildFeeGrantMsg(opAccount.address, userAccount.address, {
    spendLimit: 5_000_000, // 5 P2P max
  });
  const result = await broadcast(opClient, opAccount.address, [grantMsg]);
  console.log('      TX:', result.transactionHash);
  return result.code === 0;
});

await new Promise(r => setTimeout(r, 3000));

await t('7.2 queryFeeGrants shows grant', async () => {
  const lcd = LCD_ENDPOINTS[0]?.url || LCD_ENDPOINTS[0];
  const grants = await queryFeeGrants(lcd, userAccount.address);
  console.log('      Grants received:', grants.length);
  if (grants.length > 0) console.log('      Granter:', grants[0].granter);
  return grants.length > 0;
});

// ─── Step 8: Connect user via plan with fee grant ───────────────────────────
console.log('\n═══ STEP 8: CONNECT VIA PLAN (FEE GRANTED) ═══');
await t('8.1 connectViaPlan with feeGranter', async () => {
  const result = await connectViaPlan({
    mnemonic: userMnemonic,
    planId: parseInt(planId),
    nodeAddress: linkedNode.address,
    feeGranter: opAccount.address,
    fullTunnel: false,
    dns: 'handshake',
    v2rayExePath: process.env.V2RAY_PATH || undefined, // SDK auto-detects
    onProgress: (step, detail) => console.log('     [' + step + ']', detail),
  });
  console.log('      Session:', result.sessionId, 'Type:', result.serviceType);
  console.log('      Connected via plan with fee grant!');

  await disconnect();
  console.log('      Disconnected');
  return result.serviceType === 'wireguard';
});

// ─── RESULTS ────────────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════');
console.log('  PLAN LIFECYCLE TEST COMPLETE');
console.log('  Plan ID:', planId);
console.log('  Linked node:', linkedNode?.address);
console.log('  User wallet:', userAccount?.address);
console.log('═══════════════════════════════════════');
console.log('RESULTS:', R.pass, 'passed,', R.fail, 'failed');
if (R.errors.length > 0) {
  console.log('\nFAILURES:');
  for (const e of R.errors) console.log('  ✗', e);
}
console.log('═══════════════════════════════════════');
process.exit(R.fail > 0 ? 1 : 0);
