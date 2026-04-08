/**
 * connect-plan.mjs — Connect to Sentinel dVPN via a subscription plan
 *
 * Plans are created by operators who bundle nodes at a fixed rate.
 * Subscribers get access to all nodes in the plan. Operators can pay gas
 * on behalf of subscribers via fee grants (making it free for end users).
 *
 * Prerequisites:
 *   - Node.js 18+
 *   - npm install sentinel-dvpn-sdk
 *   - Set MNEMONIC env var
 *   - Run as admin/root for WireGuard support
 *
 * Usage:
 *   MNEMONIC="word1 word2 ..." node connect-plan.mjs                 # Auto-discover plans
 *   MNEMONIC="word1 word2 ..." node connect-plan.mjs --plan-id 42    # Specific plan
 */

import {
  createWallet,
  createClient,
  getBalance,
  formatP2P,
  discoverPlans,
  queryPlanNodes,
  connectViaPlan,
  disconnect,
  verifyConnection,
  registerCleanupHandlers,
  formatPriceP2P,
  DEFAULT_LCD,
} from 'sentinel-dvpn-sdk';

const MNEMONIC = process.env.MNEMONIC;
if (!MNEMONIC) {
  console.error('Set MNEMONIC environment variable (12 or 24 BIP39 words)');
  process.exit(1);
}

const planIdArg = process.argv.includes('--plan-id')
  ? process.argv[process.argv.indexOf('--plan-id') + 1]
  : null;

async function main() {
  registerCleanupHandlers();

  // 1. Wallet and balance
  const { account } = await createWallet(MNEMONIC);
  const client = await createClient(MNEMONIC);
  const balance = await getBalance(client, account.address);
  console.log(`Wallet: ${account.address} | Balance: ${formatP2P(balance.udvpn)}\n`);

  let planId;
  let nodeAddress;

  if (planIdArg) {
    // 2a. Use the specified plan
    planId = parseInt(planIdArg, 10);
    console.log(`Using plan ${planId}`);
  } else {
    // 2b. Discover available plans
    console.log('Discovering plans (probing IDs 1-100, may take 10-20s)...');
    const plans = await discoverPlans(DEFAULT_LCD, { maxId: 100 });

    if (plans.length === 0) {
      console.error('No plans found. Try a specific plan ID with --plan-id.');
      process.exit(1);
    }

    // Show available plans
    console.log(`\nFound ${plans.length} plans:\n`);
    console.log('  ID'.padEnd(8), 'Subscribers'.padEnd(14), 'Nodes'.padEnd(8), 'Price');
    console.log('  ' + '-'.repeat(50));
    for (const p of plans) {
      const price = p.price ? `${formatPriceP2P(p.price.amount || '0')} P2P` : 'N/A';
      console.log(
        `  ${String(p.id).padEnd(8)}${String(p.subscribers).padEnd(14)}${String(p.nodeCount).padEnd(8)}${price}`,
      );
    }

    // Pick the plan with the most nodes
    const best = plans.sort((a, b) => b.nodeCount - a.nodeCount)[0];
    planId = best.id;
    console.log(`\nSelected plan ${planId} (${best.nodeCount} nodes, ${best.subscribers} subscribers)`);
  }

  // 3. Get nodes in the plan
  const { items: planNodes } = await queryPlanNodes(planId);
  if (planNodes.length === 0) {
    console.error(`Plan ${planId} has no nodes. Try a different plan.`);
    process.exit(1);
  }
  nodeAddress = planNodes[0].address;
  console.log(`Plan has ${planNodes.length} nodes. Connecting to ${nodeAddress}...`);

  // 4. Connect via the plan
  const result = await connectViaPlan({
    mnemonic: MNEMONIC,
    planId,
    nodeAddress,
    log: (msg) => console.log(msg),
    onProgress: (step, detail) => console.log(`  [${step}] ${detail}`),
  });

  console.log(`\nConnected via plan ${planId}`);
  console.log(`  Session: ${result.sessionId}`);
  console.log(`  Protocol: ${result.protocol}`);

  // 5. Verify
  const check = await verifyConnection();
  if (check.working) console.log(`  VPN IP: ${check.vpnIp}`);

  // 6. Stay connected
  console.log('\nVPN active. Press Ctrl+C to disconnect (auto-disconnect in 30s)...');
  await new Promise((r) => setTimeout(r, 30_000));

  await disconnect();
  console.log('Disconnected.');
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  if (err.code) console.error(`  Code: ${err.code}`);
  process.exit(1);
});
