/**
 * connect-direct.mjs — Connect to Sentinel dVPN in ~60 lines
 *
 * The complete flow: wallet -> balance check -> find nodes -> connect -> verify -> disconnect.
 * Uses connectAuto() which handles node selection, retries, and fallback automatically.
 *
 * Prerequisites:
 *   - Node.js 18+
 *   - npm install sentinel-dvpn-sdk
 *   - Set MNEMONIC env var (12 or 24-word BIP39 phrase)
 *   - Run as admin/root for WireGuard support (otherwise V2Ray nodes only)
 *
 * Usage:
 *   MNEMONIC="word1 word2 ... word12" node connect-direct.mjs
 *   MNEMONIC="word1 word2 ..." node connect-direct.mjs --country germany
 */

import {
  createWallet,
  getBalance,
  createClient,
  formatP2P,
  connectAuto,
  disconnect,
  verifyConnection,
  registerCleanupHandlers,
  queryOnlineNodes,
  filterNodes,
  DEFAULT_RPC,
  DEFAULT_LCD,
} from 'sentinel-dvpn-sdk';

const MNEMONIC = process.env.MNEMONIC;
if (!MNEMONIC) {
  console.error('Set MNEMONIC environment variable (12 or 24 BIP39 words)');
  process.exit(1);
}

// Parse optional --country flag
const countryArg = process.argv.includes('--country')
  ? process.argv[process.argv.indexOf('--country') + 1]
  : null;

async function main() {
  // 1. Register cleanup handlers (ensures VPN tunnel is torn down on exit)
  registerCleanupHandlers();

  // 2. Create wallet from mnemonic
  const { account } = await createWallet(MNEMONIC);
  console.log(`Wallet: ${account.address}`);

  // 3. Check balance
  const client = await createClient(MNEMONIC);
  const balance = await getBalance(client, account.address);
  console.log(`Balance: ${formatP2P(balance.udvpn)}`);

  if (balance.udvpn < 1_000_000) {
    console.error('Insufficient balance. Need at least 1 P2P (~1,000,000 udvpn).');
    process.exit(1);
  }

  // 4. Preview available nodes (optional — connectAuto does this internally)
  const nodes = await queryOnlineNodes({ maxNodes: 20 });
  const filtered = countryArg ? filterNodes(nodes, { country: countryArg }) : nodes;
  console.log(`Found ${filtered.length} nodes${countryArg ? ` in ${countryArg}` : ''}`);
  for (const n of filtered.slice(0, 5)) {
    console.log(`  ${n.address.slice(0, 20)}... | ${n.country || '?'} | ${n.serviceType} | score: ${n.qualityScore}`);
  }

  // 5. Connect — handles node selection, payment, handshake, and tunnel setup
  console.log('\nConnecting...');
  const result = await connectAuto({
    mnemonic: MNEMONIC,
    countries: countryArg ? [countryArg] : undefined,
    maxAttempts: 3,
    gigabytes: 1,
    log: (msg) => console.log(msg),
    onProgress: (step, detail) => console.log(`  [${step}] ${detail}`),
  });

  console.log(`\nConnected to ${result.nodeAddress}`);
  console.log(`  Session ID: ${result.sessionId}`);
  console.log(`  Protocol: ${result.protocol}`);

  // 6. Verify VPN is working (check external IP)
  const check = await verifyConnection();
  if (check.working) {
    console.log(`  VPN IP: ${check.vpnIp}`);
  } else {
    console.warn('  IP check failed — tunnel may still be working');
  }

  // 7. Keep connected for 30 seconds, then disconnect
  console.log('\nVPN active. Press Ctrl+C to disconnect (auto-disconnect in 30s)...');
  await new Promise((r) => setTimeout(r, 30_000));

  // 8. Disconnect cleanly (ends session on-chain, tears down tunnel)
  await disconnect();
  console.log('Disconnected.');
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  if (err.code) console.error(`  Code: ${err.code}`);
  process.exit(1);
});
