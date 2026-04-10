#!/usr/bin/env node
/**
 * Test: Fee-granted plan connection (the step that failed before).
 * Uses existing Plan #44 with linked node.
 * Creates new user, funds, subscribes, grants, connects — all fee-granted.
 */
import 'dotenv/config';
const opMnemonic = process.env.MNEMONIC;
if (!opMnemonic) { console.error('Set MNEMONIC in .env'); process.exit(1); }

import {
  createWallet, generateWallet, getBalance, formatP2P, sendTokens,
  createClient, broadcast, broadcastWithFeeGrant,
  subscribeToPlan, hasActiveSubscription, queryFeeGrants,
  buildFeeGrantMsg, connectViaPlan, disconnect,
  registerCleanupHandlers, DEFAULT_RPC, LCD_ENDPOINTS, MSG_TYPES,
} from './index.js';

registerCleanupHandlers();
const PLAN_ID = 44;
const NODE = 'sentnode1qqywpumwtxxgffqqr9eg94w72tlragzjg0zxs4';

console.log('═══ FEE GRANT CONNECT TEST ═══\n');

// 1. Operator setup
const { wallet: opW, account: opA } = await createWallet(opMnemonic);
const opC = await createClient(DEFAULT_RPC, opW);
console.log('Operator:', opA.address);

// 2. New user
const { mnemonic: userMnemonic, account: userA } = await generateWallet();
console.log('User:', userA.address);

// 3. Fund user with 3 P2P (subscription=1P2P + gas for sub TX ~0.3P2P + buffer)
console.log('\nFunding user with 3 P2P...');
const sendResult = await sendTokens(opC, opA.address, userA.address, '3000000', 'udvpn');
console.log('  TX:', sendResult.transactionHash, 'Code:', sendResult.code);
await new Promise(r => setTimeout(r, 5000));

// 4. Subscribe user to plan
console.log('\nSubscribing to plan #' + PLAN_ID + '...');
const { wallet: uW } = await createWallet(userMnemonic);
const uC = await createClient(DEFAULT_RPC, uW);
const subResult = await subscribeToPlan(uC, userA.address, PLAN_ID);
console.log('  Subscription:', subResult.subscriptionId, 'TX:', subResult.txHash);
await new Promise(r => setTimeout(r, 5000));

// 5. Verify subscription
const hasSub = await hasActiveSubscription(userA.address, PLAN_ID);
console.log('  Has subscription:', hasSub.has);

// 6. Fee grant from operator to user
console.log('\nIssuing fee grant...');
const grantMsg = buildFeeGrantMsg(opA.address, userA.address, { spendLimit: 5_000_000 });
const grantResult = await broadcast(opC, opA.address, [grantMsg]);
console.log('  TX:', grantResult.transactionHash, 'Code:', grantResult.code);
await new Promise(r => setTimeout(r, 3000));

// 7. Verify fee grant
const lcd = LCD_ENDPOINTS[0]?.url || LCD_ENDPOINTS[0];
const grants = await queryFeeGrants(lcd, userA.address);
console.log('  Grants:', grants.length, grants.length > 0 ? 'from ' + grants[0].granter : '');

// 8. User balance check
const uBal = await getBalance(uC, userA.address);
console.log('\nUser balance before connect:', formatP2P(uBal.udvpn));

// 9. Connect via plan with fee grant
console.log('\nConnecting via plan with fee grant...');
try {
  const conn = await connectViaPlan({
    mnemonic: userMnemonic,
    planId: PLAN_ID,
    nodeAddress: NODE,
    feeGranter: opA.address,
    fullTunnel: false,
    dns: 'handshake',
    v2rayExePath: process.env.V2RAY_PATH || undefined, // SDK auto-detects
    onProgress: (step, detail) => console.log('  [' + step + ']', detail),
  });

  console.log('\n✓ CONNECTED!');
  console.log('  Session:', conn.sessionId);
  console.log('  Type:', conn.serviceType);

  // Check user balance after (should be same — gas was free)
  const uBalAfter = await getBalance(uC, userA.address);
  console.log('  User balance after connect:', formatP2P(uBalAfter.udvpn));
  console.log('  Gas cost to user:', formatP2P(uBal.udvpn - uBalAfter.udvpn));

  await disconnect();
  console.log('  Disconnected');
  console.log('\n═══ TEST PASSED ═══');
} catch (e) {
  console.error('\n✗ CONNECT FAILED:', e.message);
  console.log('\n═══ TEST FAILED ═══');
  process.exit(1);
}
