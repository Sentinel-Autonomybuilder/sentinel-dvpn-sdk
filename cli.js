#!/usr/bin/env node

// ─── Sentinel SDK CLI ───
//
// Command-line interface for common Sentinel operations.
// No GUI needed — scriptable, pipe-friendly, perfect for automation.
//
// Usage:
//   node js-sdk/cli.js <command> [options]
//
// Examples:
//   node js-sdk/cli.js balance
//   node js-sdk/cli.js nodes --country Germany --limit 10
//   node js-sdk/cli.js connect sentnode1abc...
//   node js-sdk/cli.js plan-create --gb 10 --days 30 --price 1000000
//   node js-sdk/cli.js grant-subscribers --plan 42

import {
  createWallet,
  generateWallet,
  getBalance,
  isMnemonicValid,
  createClient,
  fetchActiveNodes,
  getNodePrices,
  getNetworkOverview,
  filterNodes,
  queryPlanNodes,
  queryPlanSubscribers,
  getPlanStats,
  discoverPlans,
  hasActiveSubscription,
  querySubscriptions,
  findExistingSession,
  connectDirect,
  connectAuto,
  connectViaSubscription,
  disconnect,
  isConnected,
  getStatus,
  registerCleanupHandlers,
  verifyDependencies,
  formatDvpn,
  shortAddress,
  buildFeeGrantMsg,
  buildRevokeFeeGrantMsg,
  queryFeeGrants,
  queryFeeGrantsIssued,
  getExpiringGrants,
  grantPlanSubscribers,
  broadcastWithFeeGrant,
  broadcast,
  createSafeBroadcaster,
  sentToSentprov,
  sentToSentnode,
  encodeMsgCreatePlan,
  encodeMsgLinkNode,
  encodeMsgUnlinkNode,
  encodeMsgUpdatePlanStatus,
  encodeMsgRegisterProvider,
  encodeMsgUpdateProviderStatus,
  encodeMsgStartLease,
  encodeMsgEndLease,
  encodeMsgStartSubscription,
  LCD_ENDPOINTS,
  DEFAULT_RPC,
  DNS_PRESETS,
  DEFAULT_DNS_PRESET,
  DNS_FALLBACK_ORDER,
  resolveDnsServers,
} from './index.js';

import { config } from 'dotenv';
config({ path: '.env' });

// ─── Helpers ───

const MNEMONIC = process.env.MNEMONIC;
const args = process.argv.slice(2);
const command = args[0];

function flag(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return defaultVal;
  return args[idx + 1] || true;
}

function die(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

async function getWallet() {
  if (!MNEMONIC) die('MNEMONIC not set in .env');
  const { wallet, account } = await createWallet(MNEMONIC);
  return { wallet, account, address: account.address };
}

async function getRpc() {
  const { wallet, account } = await getWallet();
  const client = await createClient(flag('rpc', DEFAULT_RPC), wallet);
  return { client, wallet, account, address: account.address };
}

function json(obj) {
  console.log(JSON.stringify(obj, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
}

// ─── Commands ───

const commands = {

  async help() {
    console.log(`
Sentinel SDK CLI — command-line tools for Sentinel dVPN

WALLET
  balance                          Show wallet balance
  generate                         Generate new mnemonic + address
  address                          Show wallet address + provider address

NODES
  nodes [--country X] [--limit N]  List active nodes
  node-prices <sentnode1...>       Show node pricing
  network                          Network overview (total nodes, by country)

PLANS
  plans                            Discover plans on chain
  plan-stats <planId>              Plan statistics (subscribers, nodes, revenue)
  plan-nodes <planId>              List nodes in a plan
  plan-subscribers <planId>        List plan subscribers
  plan-create --gb N --days N --price N  Create a new plan
  plan-activate <planId>           Activate a plan
  plan-link <planId> <sentnode1>   Link a node to a plan
  plan-unlink <planId> <sentnode1> Unlink a node from a plan

SUBSCRIPTIONS
  subscriptions                    List your subscriptions
  subscribe <planId>               Subscribe to a plan
  has-subscription <planId>        Check if subscribed to a plan

SESSIONS
  find-session <sentnode1...>      Find existing session for a node

FEE GRANTS
  grants-received                  List fee grants you've received
  grants-issued                    List fee grants you've issued
  grant <sent1...> [--amount N]    Grant fee allowance to an address
  grant-subscribers <planId>       Batch grant all plan subscribers
  expiring-grants [--days 7]       List grants expiring soon

CONNECTION
  connect <sentnode1...> [--gb N] [--dns X]  Connect to a specific node
  connect-auto [--country X] [--dns X]       Auto-connect to best node
  disconnect                       Disconnect VPN
  status                           Show connection status

DNS
  dns                              Show DNS presets and current resolution
  dns --preset <name>              Show resolved DNS for a preset
  dns --custom <ip1,ip2>           Show resolved DNS for custom IPs

SYSTEM
  deps                             Check V2Ray + WireGuard availability
  endpoints                        Test LCD endpoint health

Options:
  --rpc <url>       RPC endpoint (default: ${DEFAULT_RPC})
  --lcd <url>       LCD endpoint (default: ${LCD_ENDPOINTS[0].url || LCD_ENDPOINTS[0]})
  --country <name>  Filter by country
  --limit <n>       Limit results
  --gb <n>          Gigabytes (default: 1)
  --days <n>        Duration in days
  --price <udvpn>   Price in micro-denomination
  --amount <udvpn>  Fee grant amount in udvpn
  --plan <id>       Plan ID
  --dns <preset>    DNS preset: handshake (default), google, cloudflare, or custom IPs

Environment:
  MNEMONIC          BIP39 mnemonic phrase (in .env file)
`);
  },

  // ─── Wallet ───

  async balance() {
    const { client, address } = await getRpc();
    const balance = await getBalance(client, address);
    console.log(`Address:  ${address}`);
    console.log(`Balance:  ${formatDvpn(balance.udvpn)} (${balance.udvpn} udvpn)`);
  },

  async generate() {
    const { mnemonic, account } = await generateWallet();
    console.log(`Mnemonic: ${mnemonic}`);
    console.log(`Address:  ${account.address}`);
    console.log(`\nSave the mnemonic in your .env file as MNEMONIC="..."`);
  },

  async address() {
    const { address } = await getWallet();
    console.log(`Account:  ${address}`);
    console.log(`Provider: ${sentToSentprov(address)}`);
    console.log(`Node:     ${sentToSentnode(address)}`);
  },

  // ─── Nodes ───

  async nodes() {
    const country = flag('country', null);
    const limit = parseInt(flag('limit', '20'));
    let nodes = await fetchActiveNodes();
    if (country) nodes = filterNodes(nodes, { country });
    nodes = nodes.slice(0, limit);
    console.log(`${nodes.length} nodes:`);
    for (const n of nodes) {
      const addr = shortAddress(n.address, 15, 6);
      const url = n.remote_addrs?.[0] || n.remote_url || '?';
      console.log(`  ${addr}  ${url}  ${n.service_type === 2 ? 'WG' : 'V2'}`);
    }
  },

  async 'node-prices'() {
    const nodeAddr = args[1];
    if (!nodeAddr) die('Usage: node-prices <sentnode1...>');
    const prices = await getNodePrices(nodeAddr);
    json(prices);
  },

  async network() {
    const overview = await getNetworkOverview();
    json(overview);
  },

  // ─── Plans ───

  async plans() {
    const plans = await discoverPlans();
    console.log(`${plans.length} plans found:`);
    for (const p of plans) {
      console.log(`  Plan ${p.id}: ${p.subscribers} subscribers, ${p.nodeCount} nodes`);
    }
  },

  async 'plan-stats'() {
    const planId = parseInt(args[1]);
    if (!planId) die('Usage: plan-stats <planId>');
    const { address } = await getWallet();
    const stats = await getPlanStats(planId, address);
    json(stats);
  },

  async 'plan-nodes'() {
    const planId = parseInt(args[1]);
    if (!planId) die('Usage: plan-nodes <planId>');
    const nodes = await queryPlanNodes(planId);
    console.log(`${nodes.length} nodes in plan ${planId}:`);
    for (const n of nodes) {
      console.log(`  ${n.address}  ${n.remote_addrs?.[0] || '?'}`);
    }
  },

  async 'plan-subscribers'() {
    const planId = parseInt(args[1]);
    if (!planId) die('Usage: plan-subscribers <planId>');
    const subs = await queryPlanSubscribers(planId);
    console.log(`${subs.length} subscribers:`);
    for (const s of subs) {
      console.log(`  ${s.address}  status=${s.status}`);
    }
  },

  async 'plan-create'() {
    const gb = parseInt(flag('gb', '10'));
    const days = parseInt(flag('days', '30'));
    const price = flag('price', null);
    if (!price) die('Usage: plan-create --gb 10 --days 30 --price 1000000');
    const { client, address } = await getRpc();
    const provAddr = sentToSentprov(address);
    const msg = encodeMsgCreatePlan({
      from: provAddr,
      bytes: String(BigInt(gb) * 1000000000n),
      duration: days * 86400,
      prices: [{ denom: 'udvpn', base_value: '1', quote_value: price }],
    });
    const result = await broadcast(client, address, [{ typeUrl: '/sentinel.plan.v3.MsgCreatePlanRequest', value: msg }]);
    json({ txHash: result.transactionHash, code: result.code });
  },

  async 'plan-activate'() {
    const planId = parseInt(args[1]);
    if (!planId) die('Usage: plan-activate <planId>');
    const { client, address } = await getRpc();
    const provAddr = sentToSentprov(address);
    const msg = encodeMsgUpdatePlanStatus({ from: provAddr, id: planId, status: 1 });
    const result = await broadcast(client, address, [{ typeUrl: '/sentinel.plan.v3.MsgUpdatePlanStatusRequest', value: msg }]);
    json({ txHash: result.transactionHash, code: result.code });
  },

  // ─── Subscriptions ───

  async subscriptions() {
    const { address } = await getWallet();
    const subs = await querySubscriptions(LCD_ENDPOINTS[0]?.url || LCD_ENDPOINTS[0], address);
    json(subs);
  },

  async subscribe() {
    const planId = parseInt(args[1]);
    if (!planId) die('Usage: subscribe <planId>');
    const { client, address } = await getRpc();
    const msg = encodeMsgStartSubscription({ from: address, id: planId, denom: 'udvpn' });
    const result = await broadcast(client, address, [{ typeUrl: '/sentinel.subscription.v3.MsgStartRequest', value: msg }]);
    json({ txHash: result.transactionHash, code: result.code });
  },

  async 'has-subscription'() {
    const planId = parseInt(args[1]);
    if (!planId) die('Usage: has-subscription <planId>');
    const { address } = await getWallet();
    const has = await hasActiveSubscription(address, planId);
    console.log(has ? 'Yes — active subscription exists' : 'No — not subscribed');
  },

  // ─── Sessions ───

  async 'find-session'() {
    const nodeAddr = args[1];
    if (!nodeAddr) die('Usage: find-session <sentnode1...>');
    const { address } = await getWallet();
    const sessionId = await findExistingSession(LCD_ENDPOINTS[0]?.url || LCD_ENDPOINTS[0], address, nodeAddr);
    console.log(sessionId ? `Session: ${sessionId}` : 'No active session found');
  },

  // ─── Fee Grants ───

  async 'grants-received'() {
    const { address } = await getWallet();
    const grants = await queryFeeGrants(LCD_ENDPOINTS[0]?.url || LCD_ENDPOINTS[0], address);
    json(grants);
  },

  async 'grants-issued'() {
    const { address } = await getWallet();
    const grants = await queryFeeGrantsIssued(LCD_ENDPOINTS[0]?.url || LCD_ENDPOINTS[0], address);
    json(grants);
  },

  async 'grant-subscribers'() {
    const planId = parseInt(flag('plan', args[1]));
    if (!planId) die('Usage: grant-subscribers <planId>');
    const { address } = await getWallet();
    const result = await grantPlanSubscribers(planId, {
      granterAddress: address,
      lcdUrl: LCD_ENDPOINTS[0]?.url || LCD_ENDPOINTS[0],
    });
    json(result);
  },

  async 'expiring-grants'() {
    const days = parseInt(flag('days', '7'));
    const { address } = await getWallet();
    const expiring = await getExpiringGrants(
      LCD_ENDPOINTS[0]?.url || LCD_ENDPOINTS[0],
      address, days, 'granter',
    );
    json(expiring);
  },

  // ─── Connection ───

  async connect() {
    registerCleanupHandlers();
    const nodeAddr = args[1];
    if (!nodeAddr) die('Usage: connect <sentnode1...>');
    const gb = parseInt(flag('gb', '1'));
    const dns = flag('dns', undefined);
    const result = await connectDirect({
      mnemonic: MNEMONIC,
      nodeAddress: nodeAddr,
      gigabytes: gb,
      dns,
      onProgress: (step, detail) => console.log(`[${step}] ${detail}`),
    });
    json(result);
    console.log(`\nDNS: ${resolveDnsServers(dns)}`);
    console.log('VPN connected. Press Ctrl+C to disconnect.');
    await new Promise(() => {}); // Keep alive
  },

  async 'connect-auto'() {
    registerCleanupHandlers();
    const country = flag('country', undefined);
    const dns = flag('dns', undefined);
    const result = await connectAuto({
      mnemonic: MNEMONIC,
      countries: country ? [country] : undefined,
      dns,
      onProgress: (step, detail) => console.log(`[${step}] ${detail}`),
    });
    json(result);
    console.log(`\nDNS: ${resolveDnsServers(dns)}`);
    console.log('VPN connected. Press Ctrl+C to disconnect.');
    await new Promise(() => {});
  },

  // ─── DNS ───

  async dns() {
    const preset = flag('preset', undefined);
    const custom = flag('custom', undefined);

    if (custom) {
      const ips = custom.split(',').map(s => s.trim());
      console.log(`Custom DNS: ${ips.join(', ')}`);
      console.log(`Resolved (with fallbacks): ${resolveDnsServers(ips)}`);
      return;
    }

    if (preset) {
      const p = DNS_PRESETS[preset.toLowerCase()];
      if (!p) die(`Unknown preset: ${preset}. Available: ${Object.keys(DNS_PRESETS).join(', ')}`);
      console.log(`Preset: ${p.name}`);
      console.log(`Servers: ${p.servers.join(', ')}`);
      console.log(`Resolved (with fallbacks): ${resolveDnsServers(preset)}`);
      return;
    }

    // Show all presets
    console.log('DNS Presets:');
    console.log(`  Default: ${DEFAULT_DNS_PRESET}`);
    console.log(`  Fallback order: ${DNS_FALLBACK_ORDER.join(' → ')}\n`);
    for (const [key, p] of Object.entries(DNS_PRESETS)) {
      const isDefault = key === DEFAULT_DNS_PRESET ? ' (default)' : '';
      console.log(`  ${key}${isDefault}`);
      console.log(`    ${p.description}`);
      console.log(`    Servers: ${p.servers.join(', ')}`);
      console.log(`    With fallbacks: ${resolveDnsServers(key)}`);
      console.log();
    }
  },

  async disconnect() {
    await disconnect();
    console.log('Disconnected.');
  },

  async status() {
    if (isConnected()) {
      json(getStatus());
    } else {
      console.log('Not connected.');
    }
  },

  // ─── System ───

  async deps() {
    const deps = verifyDependencies();
    json(deps);
  },

  async endpoints() {
    const endpoints = LCD_ENDPOINTS.map(e => typeof e === 'string' ? e : e.url);
    for (const url of endpoints) {
      const start = Date.now();
      try {
        const res = await fetch(`${url}/cosmos/base/tendermint/v1beta1/node_info`, {
          signal: AbortSignal.timeout(5000),
        });
        const ms = Date.now() - start;
        console.log(`  ${res.ok ? 'OK' : 'ERR'} ${ms}ms  ${url}`);
      } catch {
        console.log(`  FAIL      ${url}`);
      }
    }
  },
};

// ─── Run ───

if (!command || command === 'help' || command === '--help' || command === '-h') {
  commands.help();
} else if (commands[command]) {
  commands[command]().catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
} else {
  die(`Unknown command: ${command}. Run with --help for usage.`);
}
