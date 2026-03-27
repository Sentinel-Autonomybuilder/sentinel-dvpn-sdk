#!/usr/bin/env node

/**
 * Sentinel dVPN CLI
 *
 * Command-line interface for the Sentinel SDK.
 * Zero external dependencies — Node.js built-ins + SDK imports only.
 *
 * Usage:
 *   sentinel <command> [options]
 *   sentinel nodes --country US --type wireguard
 *   sentinel status https://node.example.com:8585
 *   sentinel balance
 *   sentinel connect sentnode1abc... --gb 2
 *   sentinel disconnect
 *   sentinel speedtest
 *   sentinel google-check
 *   sentinel version
 */

// ─── SDK Imports ─────────────────────────────────────────────────────────────

import {
  // High-level API
  listNodes,
  connectDirect,
  disconnect,
  isConnected,
  getStatus,
  registerCleanupHandlers,
  verifyConnection,
  filterNodes,
  // Wallet & Chain
  createWallet,
  createClient,
  getBalance,
  formatDvpn,
  // Protocol
  nodeStatusV3,
  // Speed testing
  speedtestDirect,
  // Defaults
  SDK_VERSION,
  DEFAULT_RPC,
  DEFAULT_LCD,
} from '../index.js';

// ─── CLI Modules ─────────────────────────────────────────────────────────────

import {
  loadConfig,
  ensureMnemonic,
  getConfigValue,
} from './config.js';

import {
  printJson,
  printTable,
  printStep,
  printHeader,
  die,
  green,
  red,
  yellow,
  cyan,
  bold,
  dim,
  gray,
  pass,
  fail,
  warn,
  fmtNum,
  truncAddr,
} from './output.js';

// ─── Argument Parsing ────────────────────────────────────────────────────────

const argv = process.argv.slice(2);

/**
 * Get the value of a --flag from argv.
 * Returns the next argument after the flag, or defaultVal if not found.
 * If the flag exists but has no value (or next arg is also a flag), returns true.
 * @param {string} name - Flag name without --
 * @param {*} [defaultVal=undefined]
 * @returns {*}
 */
function flag(name, defaultVal) {
  const idx = argv.indexOf(`--${name}`);
  if (idx === -1) return defaultVal;
  const next = argv[idx + 1];
  if (next === undefined || next.startsWith('--')) return true;
  return next;
}

/**
 * Check if a boolean flag is present (no value expected).
 * @param {string} name
 * @returns {boolean}
 */
function hasFlag(name) {
  return argv.includes(`--${name}`);
}

/** Get positional arguments (non-flag args after the command). */
function positional(index) {
  let pos = 0;
  for (let i = 1; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      // Skip flag and its value
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) i++;
      continue;
    }
    if (pos === index) return argv[i];
    pos++;
  }
  return undefined;
}

const command = argv[0];
const jsonMode = hasFlag('json');

// ─── Wallet Helpers ──────────────────────────────────────────────────────────

async function getWalletFromConfig() {
  const mnemonic = await ensureMnemonic();
  const { wallet, account } = await createWallet(mnemonic);
  return { wallet, account, address: account.address, mnemonic };
}

async function getRpcClient() {
  const { wallet, account, address, mnemonic } = await getWalletFromConfig();
  const rpc = getConfigValue('rpc', flag('rpc'));
  const client = await createClient(rpc, wallet);
  return { client, wallet, account, address, mnemonic };
}

// ─── Commands ────────────────────────────────────────────────────────────────

const commands = {};

// ─── sentinel nodes ──────────────────────────────────────────────────────────

commands.nodes = async function nodesCmd() {
  const country = flag('country');
  const type = flag('type');
  const limit = parseInt(flag('limit', '50'), 10);
  const lcd = getConfigValue('lcd', flag('lcd'));

  if (!jsonMode) printStep('Fetching', 'Querying online nodes from chain...');

  let nodes = await listNodes({
    lcdUrl: lcd,
    serviceType: type || undefined,
    maxNodes: 5000,
    noCache: true,
  });

  // Apply country filter
  if (country) {
    nodes = filterNodes(nodes, { country });
  }

  // Limit results
  const total = nodes.length;
  nodes = nodes.slice(0, limit);

  if (jsonMode) {
    printJson(nodes);
    return;
  }

  printHeader(`Online Nodes (${fmtNum(total)} total, showing ${nodes.length})`);

  if (nodes.length === 0) {
    console.log('  No nodes found matching filters.');
    return;
  }

  const headers = ['Address', 'Moniker', 'Type', 'Country', 'City', 'Peers'];
  const rows = nodes.map(n => [
    truncAddr(n.address),
    (n.moniker || '').slice(0, 20),
    n.serviceType === 'wireguard' ? green('WG') : cyan('V2'),
    n.country || n.location?.country || '?',
    (n.city || n.location?.city || '').slice(0, 15),
    String(n.peers ?? '?'),
  ]);

  printTable(headers, rows, { align: [0, 0, 0, 0, 0, 1] });
  console.log();

  if (total > limit) {
    console.log(dim(`  Showing ${nodes.length} of ${fmtNum(total)}. Use --limit to see more.`));
  }
};

// ─── sentinel status <nodeUrl> ───────────────────────────────────────────────

commands.status = async function statusCmd() {
  const nodeUrl = positional(0);
  if (!nodeUrl) {
    die('Usage: sentinel status <nodeUrl>\n  Example: sentinel status https://1.2.3.4:8585');
  }

  if (!jsonMode) printStep('Querying', nodeUrl);

  const status = await nodeStatusV3(nodeUrl);

  if (jsonMode) {
    printJson(status);
    return;
  }

  printHeader('Node Status');
  console.log(`  Moniker:      ${bold(status.moniker || '(none)')}`);
  console.log(`  Type:         ${status.type === 'wireguard' ? green('WireGuard') : cyan('V2Ray')}`);
  console.log(`  Country:      ${status.location.country || '?'} / ${status.location.city || '?'}`);
  console.log(`  Peers:        ${status.peers}`);
  console.log(`  Bandwidth:    ${dim('down')} ${fmtNum(Math.round(status.bandwidth.download / 1024))} KB/s  ${dim('up')} ${fmtNum(Math.round(status.bandwidth.upload / 1024))} KB/s`);
  if (status.clockDriftSec !== null) {
    const drift = status.clockDriftSec;
    const driftStr = Math.abs(drift) > 120 ? red(`${drift}s`) : green(`${drift}s`);
    console.log(`  Clock drift:  ${driftStr}`);
  }
  console.log();
};

// ─── sentinel balance ────────────────────────────────────────────────────────

commands.balance = async function balanceCmd() {
  const { client, address } = await getRpcClient();

  if (!jsonMode) printStep('Querying', `Balance for ${truncAddr(address)}`);

  const balance = await getBalance(client, address);

  if (jsonMode) {
    printJson({ address, udvpn: balance.udvpn, p2p: balance.dvpn });
    return;
  }

  printHeader('Wallet Balance');
  console.log(`  Address:  ${bold(address)}`);
  console.log(`  Balance:  ${green(formatDvpn(balance.udvpn))} ${dim(`(${fmtNum(balance.udvpn)} udvpn)`)}`);
  console.log();
};

// ─── sentinel connect <nodeAddress> ──────────────────────────────────────────

commands.connect = async function connectCmd() {
  const nodeAddress = positional(0);
  if (!nodeAddress) {
    die('Usage: sentinel connect <nodeAddress> [--gb N]\n  Example: sentinel connect sentnode1abc...xyz --gb 2');
  }

  registerCleanupHandlers();

  const { mnemonic } = await getWalletFromConfig();
  const gb = parseInt(getConfigValue('gigabytes', flag('gb')), 10);
  const rpc = getConfigValue('rpc', flag('rpc'));
  const lcd = getConfigValue('lcd', flag('lcd'));

  if (!jsonMode) {
    printHeader('Connecting');
    console.log(`  Node:       ${bold(nodeAddress)}`);
    console.log(`  Gigabytes:  ${gb}`);
    console.log();
  }

  const result = await connectDirect({
    mnemonic,
    nodeAddress,
    gigabytes: gb,
    rpcUrl: rpc,
    lcdUrl: lcd,
    onProgress: (step, detail) => {
      if (!jsonMode) printStep(step, detail);
    },
  });

  if (jsonMode) {
    printJson(serializeResult(result));
    return;
  }

  console.log();
  console.log(pass('Connected successfully'));
  if (result.serviceType) console.log(`  Type:       ${result.serviceType}`);
  if (result.sessionId) console.log(`  Session:    ${result.sessionId}`);
  if (result.socksPort) console.log(`  SOCKS5:     localhost:${result.socksPort}`);
  console.log();
  console.log(dim('  Press Ctrl+C to disconnect.'));

  // Keep alive until Ctrl+C
  await new Promise(() => {});
};

// ─── sentinel disconnect ────────────────────────────────────────────────────

commands.disconnect = async function disconnectCmd() {
  if (!jsonMode) printStep('Disconnecting', '...');

  await disconnect();

  if (jsonMode) {
    printJson({ disconnected: true });
    return;
  }

  console.log(pass('Disconnected'));
};

// ─── sentinel speedtest ──────────────────────────────────────────────────────

commands.speedtest = async function speedtestCmd() {
  if (!jsonMode) printStep('Testing', 'Running baseline speed test...');

  const result = await speedtestDirect();

  if (jsonMode) {
    printJson(result);
    return;
  }

  printHeader('Baseline Speed Test');
  if (result.downloadMbps != null) {
    console.log(`  Download:  ${bold(result.downloadMbps.toFixed(2))} Mbps`);
  }
  if (result.uploadMbps != null) {
    console.log(`  Upload:    ${bold(result.uploadMbps.toFixed(2))} Mbps`);
  }
  if (result.latencyMs != null) {
    console.log(`  Latency:   ${bold(String(result.latencyMs))} ms`);
  }
  if (result.ip) {
    console.log(`  IP:        ${result.ip}`);
  }
  console.log();
};

// ─── sentinel google-check ──────────────────────────────────────────────────

commands['google-check'] = async function googleCheckCmd() {
  if (!jsonMode) printStep('Checking', 'Google reachability...');

  const result = await verifyConnection({ timeoutMs: 10000 });

  if (jsonMode) {
    printJson(result);
    return;
  }

  printHeader('Google Reachability Check');
  if (result.working) {
    console.log(pass(`Reachable — IP: ${result.vpnIp}`));
  } else {
    console.log(fail(`Not reachable${result.error ? `: ${result.error}` : ''}`));
  }
  console.log();
};

// ─── sentinel version ───────────────────────────────────────────────────────

commands.version = async function versionCmd() {
  if (jsonMode) {
    printJson({ version: SDK_VERSION });
    return;
  }
  console.log(`Sentinel SDK v${SDK_VERSION}`);
};

// ─── Help ────────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
${bold('Sentinel dVPN CLI')} — command-line tools for Sentinel dVPN

${bold('USAGE')}
  sentinel <command> [options]

${bold('NODES')}
  nodes                             List online nodes
    --country <code>                Filter by country (e.g. US, DE)
    --type <wireguard|v2ray>        Filter by tunnel type
    --limit <n>                     Max results (default: 50)
  status <nodeUrl>                  Query node status

${bold('WALLET')}
  balance                           Show wallet balance

${bold('CONNECTION')}
  connect <nodeAddress> [--gb N]    Connect to a node (default: 1 GB)
  disconnect                        Disconnect VPN tunnel

${bold('DIAGNOSTICS')}
  speedtest                         Run baseline speed test
  google-check                      Check internet reachability

${bold('INFO')}
  version                           Show SDK version
  help                              Show this help

${bold('GLOBAL OPTIONS')}
  --json                            Output as JSON (for scripting)
  --rpc <url>                       Override RPC endpoint
  --lcd <url>                       Override LCD endpoint

${bold('CONFIGURATION')}
  Config file: ~/.sentinel/config.json
  Mnemonic can also be set via MNEMONIC environment variable.

${bold('EXAMPLES')}
  sentinel nodes --country US --type wireguard
  sentinel status https://1.2.3.4:8585
  sentinel balance
  sentinel connect sentnode1abc... --gb 2
  sentinel nodes --json | jq '.[] | .address'
`);
}

// ─── BigInt Serializer ───────────────────────────────────────────────────────

function serializeResult(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return obj.toString();
  if (Array.isArray(obj)) return obj.map(serializeResult);
  if (typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = serializeResult(v);
    }
    return out;
  }
  return obj;
}

// ─── Command Router ──────────────────────────────────────────────────────────

async function main() {
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  const handler = commands[command];
  if (!handler) {
    die(`Unknown command: ${command}\nRun 'sentinel help' for usage.`);
  }

  try {
    await handler();
  } catch (err) {
    if (jsonMode) {
      printJson({ error: err.message, code: err.code || 'UNKNOWN' });
      process.exit(1);
    }
    die(err.message);
  }
}

main();
