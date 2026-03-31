#!/usr/bin/env node
/**
 * Sentinel AI Connect — CLI Entry Point
 *
 * Usage: npx sentinel-ai <command>
 *
 * Commands:
 *   setup                          Check dependencies
 *   wallet create                  Generate new wallet
 *   wallet balance                 Check P2P balance
 *   wallet import <mnemonic...>    Import existing wallet
 *   connect [options]              Connect to VPN
 *   disconnect                     Disconnect from VPN
 *   status                         Show connection status
 *   nodes [options]                List available nodes
 *   help                           Show this message
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── ANSI Colors ────────────────────────────────────────────────────────────

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgBlue: '\x1b[44m',
};

const ok = `${c.green}+${c.reset}`;
const warn = `${c.yellow}!${c.reset}`;
const err = `${c.red}x${c.reset}`;
const info = `${c.cyan}>${c.reset}`;

// ─── .env Loader ────────────────────────────────────────────────────────────

function loadEnv() {
  const envPath = resolve(__dirname, '.env');
  if (!existsSync(envPath)) return;
  try {
    const lines = readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  } catch {
    // .env read failed — non-critical
  }
}

// ─── Argument Parser ────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = [];
  const flags = {};
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  return { positional, flags };
}

// ─── Banner ─────────────────────────────────────────────────────────────────

function banner() {
  console.log('');
  console.log(`${c.bold}${c.cyan}  Sentinel AI Connect${c.reset}  ${c.dim}v0.1.0${c.reset}`);
  console.log(`${c.dim}  Decentralized VPN for AI agents${c.reset}`);
  console.log('');
}

// ─── Help ───────────────────────────────────────────────────────────────────

function showHelp() {
  banner();
  console.log(`${c.bold}USAGE${c.reset}`);
  console.log(`  sentinel-ai <command> [options]`);
  console.log('');
  console.log(`${c.bold}COMMANDS${c.reset}`);
  console.log(`  ${c.cyan}setup${c.reset}                          Check dependencies and environment`);
  console.log(`  ${c.cyan}wallet create${c.reset}                  Generate a new wallet`);
  console.log(`  ${c.cyan}wallet balance${c.reset}                 Check P2P token balance`);
  console.log(`  ${c.cyan}wallet import${c.reset} <mnemonic...>    Import wallet from mnemonic`);
  console.log(`  ${c.cyan}connect${c.reset} [options]              Connect to VPN`);
  console.log(`  ${c.cyan}disconnect${c.reset}                     Disconnect from VPN`);
  console.log(`  ${c.cyan}status${c.reset}                         Show connection status`);
  console.log(`  ${c.cyan}nodes${c.reset} [options]                List available nodes`);
  console.log(`  ${c.cyan}help${c.reset}                           Show this message`);
  console.log('');
  console.log(`${c.bold}CONNECT OPTIONS${c.reset}`);
  console.log(`  --country <code>    Preferred country (e.g. US, DE, JP)`);
  console.log(`  --protocol <type>   Protocol: wireguard or v2ray`);
  console.log(`  --dns <preset>      DNS: google, cloudflare, or hns (Handshake)`);
  console.log(`  --node <address>    Connect to specific node (sentnode1...)`);
  console.log('');
  console.log(`${c.bold}NODES OPTIONS${c.reset}`);
  console.log(`  --country <code>    Filter by country`);
  console.log(`  --limit <n>         Max nodes to show (default: 20)`);
  console.log('');
  console.log(`${c.bold}ENVIRONMENT${c.reset}`);
  console.log(`  MNEMONIC            BIP39 mnemonic in .env file`);
  console.log('');
  console.log(`${c.bold}EXAMPLES${c.reset}`);
  console.log(`  ${c.dim}# First time setup${c.reset}`);
  console.log(`  sentinel-ai setup`);
  console.log(`  sentinel-ai wallet create`);
  console.log('');
  console.log(`  ${c.dim}# Connect to VPN${c.reset}`);
  console.log(`  sentinel-ai connect`);
  console.log(`  sentinel-ai connect --country DE --protocol wireguard`);
  console.log(`  sentinel-ai connect --node sentnode1abc...`);
  console.log('');
  console.log(`  ${c.dim}# List nodes${c.reset}`);
  console.log(`  sentinel-ai nodes --country US --limit 10`);
  console.log('');
}

// ─── Command: setup ─────────────────────────────────────────────────────────

async function cmdSetup() {
  banner();
  console.log(`${info} Running environment checks...`);
  console.log('');

  // Delegate to setup.js which has all the detection logic
  await import('./setup.js');
}

// ─── Command: wallet create ─────────────────────────────────────────────────

async function cmdWalletCreate() {
  banner();
  console.log(`${info} Generating new wallet...`);
  console.log('');

  const { createWallet } = await import('./index.js');
  const wallet = await createWallet();

  // Write mnemonic directly to .env — never print it to stdout
  const envPath = resolve(__dirname, '.env');
  const mnemonicLine = `MNEMONIC=${wallet.mnemonic}`;
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf-8');
    if (content.includes('MNEMONIC=')) {
      // Replace existing MNEMONIC line
      const updated = content.replace(/^MNEMONIC=.*$/m, mnemonicLine);
      writeFileSync(envPath, updated, 'utf-8');
    } else {
      appendFileSync(envPath, `\n${mnemonicLine}\n`, 'utf-8');
    }
  } else {
    writeFileSync(envPath, `${mnemonicLine}\n`, 'utf-8');
  }

  console.log(`${ok} ${c.bold}Wallet created${c.reset}`);
  console.log('');
  console.log(`${c.bold}  Address:${c.reset}   ${c.green}${wallet.address}${c.reset}`);
  console.log(`${ok} Mnemonic saved to .env (24 words). ${c.red}${c.bold}NEVER share this.${c.reset}`);
  console.log('');
  console.log(`${info} Next steps:`);
  console.log(`  1. Fund the wallet with P2P tokens`);
  console.log(`  2. Connect:  ${c.cyan}sentinel-ai connect${c.reset}`);
  console.log('');
}

// ─── Command: wallet balance ────────────────────────────────────────────────

async function cmdWalletBalance() {
  banner();

  const mnemonic = process.env.MNEMONIC;
  delete process.env.MNEMONIC; // Don't keep mnemonic in environment after reading
  if (!mnemonic) {
    console.log(`${err} No MNEMONIC in .env file.`);
    console.log(`  Run: ${c.cyan}sentinel-ai wallet create${c.reset}`);
    console.log(`  Then add the mnemonic to your .env file.`);
    process.exit(1);
  }

  console.log(`${info} Checking balance...`);

  const { getBalance } = await import('./index.js');
  const bal = await getBalance(mnemonic);

  console.log('');
  console.log(`${ok} ${c.bold}Wallet Balance${c.reset}`);
  console.log(`  Address:  ${c.cyan}${bal.address}${c.reset}`);
  console.log(`  Balance:  ${c.bold}${bal.p2p}${c.reset}  (${bal.udvpn.toLocaleString()} udvpn)`);
  console.log(`  Status:   ${bal.funded ? `${c.green}Funded` : `${c.red}Insufficient`}${c.reset}`);
  console.log('');

  if (!bal.funded) {
    console.log(`${warn} Wallet needs P2P tokens to pay for VPN sessions.`);
    console.log(`  Send P2P tokens to: ${c.cyan}${bal.address}${c.reset}`);
    console.log('');
  }
}

// ─── Command: wallet import ─────────────────────────────────────────────────

async function cmdWalletImport(words) {
  banner();

  if (!words || words.length === 0) {
    console.log(`${err} Usage: sentinel-ai wallet import <word1 word2 word3 ...>`);
    process.exit(1);
  }

  const mnemonic = words.join(' ');
  console.log(`${info} Validating mnemonic (${words.length} words)...`);

  const { importWallet } = await import('./index.js');
  const result = await importWallet(mnemonic);

  // Write mnemonic directly to .env — never print it to stdout
  const envPath = resolve(__dirname, '.env');
  const mnemonicLine = `MNEMONIC=${mnemonic}`;
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf-8');
    if (content.includes('MNEMONIC=')) {
      const updated = content.replace(/^MNEMONIC=.*$/m, mnemonicLine);
      writeFileSync(envPath, updated, 'utf-8');
    } else {
      appendFileSync(envPath, `\n${mnemonicLine}\n`, 'utf-8');
    }
  } else {
    writeFileSync(envPath, `${mnemonicLine}\n`, 'utf-8');
  }

  console.log('');
  console.log(`${ok} ${c.bold}Wallet imported${c.reset}`);
  console.log(`  Address:  ${c.green}${result.address}${c.reset}`);
  console.log(`${ok} Mnemonic saved to .env (${words.length} words). ${c.red}${c.bold}NEVER share this.${c.reset}`);
  console.log('');
  console.warn(`  ${c.yellow}WARNING: Your mnemonic was passed as command arguments.${c.reset}`);
  console.warn(`  ${c.yellow}Clear your shell history: history -c (bash) or rm ~/.bash_history${c.reset}`);
  console.log('');
}

// ─── Command: connect ───────────────────────────────────────────────────────

async function cmdConnect(flags) {
  banner();

  const mnemonic = process.env.MNEMONIC;
  delete process.env.MNEMONIC; // Don't keep mnemonic in environment after reading
  if (!mnemonic) {
    console.log(`${err} No MNEMONIC in .env file.`);
    console.log(`  Run: ${c.cyan}sentinel-ai wallet create${c.reset}`);
    process.exit(1);
  }

  const opts = {
    mnemonic,
    onProgress: (stage, detail) => {
      const icon = stage === 'error' ? err : stage === 'done' ? ok : info;
      console.log(`  ${icon} ${c.dim}[${stage}]${c.reset} ${detail}`);
    },
  };

  if (flags.country) opts.country = flags.country;
  if (flags.protocol) opts.protocol = flags.protocol;
  if (flags.dns) opts.dns = flags.dns;
  if (flags.node) opts.nodeAddress = flags.node;

  console.log(`${info} Connecting to Sentinel dVPN...`);
  if (flags.country) console.log(`  Country:  ${c.cyan}${flags.country}${c.reset}`);
  if (flags.protocol) console.log(`  Protocol: ${c.cyan}${flags.protocol}${c.reset}`);
  if (flags.dns) console.log(`  DNS:      ${c.cyan}${flags.dns}${c.reset}`);
  if (flags.node) console.log(`  Node:     ${c.cyan}${flags.node}${c.reset}`);
  console.log('');

  const { connect, disconnect } = await import('./index.js');
  const vpn = await connect(opts);

  console.log('');
  console.log(`${ok} ${c.bold}${c.green}Connected!${c.reset}`);
  console.log(`  Session:  ${c.cyan}${vpn.sessionId}${c.reset}`);
  console.log(`  Protocol: ${c.cyan}${vpn.protocol}${c.reset}`);
  console.log(`  Node:     ${c.cyan}${vpn.nodeAddress}${c.reset}`);
  if (vpn.ip) console.log(`  IP:       ${c.cyan}${vpn.ip}${c.reset}`);
  if (vpn.socksPort) console.log(`  SOCKS5:   ${c.cyan}127.0.0.1:${vpn.socksPort}${c.reset}`);
  console.log('');
  console.log(`${c.dim}  Press Ctrl+C to disconnect${c.reset}`);
  console.log('');

  // Keep process alive, handle graceful shutdown
  let disconnecting = false;

  const cleanup = async () => {
    if (disconnecting) return;
    disconnecting = true;
    console.log('');
    console.log(`${info} Disconnecting...`);
    try {
      await disconnect();
      console.log(`${ok} Disconnected.`);
    } catch (e) {
      console.log(`${warn} Disconnect error: ${e.message}`);
    }
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Keep alive
  await new Promise(() => {});
}

// ─── Command: disconnect ────────────────────────────────────────────────────

async function cmdDisconnect() {
  banner();
  console.log(`${info} Disconnecting...`);

  const { disconnect } = await import('./index.js');

  try {
    await disconnect();
    console.log(`${ok} Disconnected from VPN.`);
  } catch (e) {
    console.log(`${warn} ${e.message}`);
  }
  console.log('');
}

// ─── Command: status ────────────────────────────────────────────────────────

async function cmdStatus() {
  banner();

  const { status } = await import('./index.js');
  const s = status();

  if (!s.connected) {
    console.log(`${c.dim}  Not connected${c.reset}`);
    console.log('');
    console.log(`  Run: ${c.cyan}sentinel-ai connect${c.reset}`);
  } else {
    console.log(`${ok} ${c.bold}${c.green}VPN Active${c.reset}`);
    console.log(`  Session:  ${c.cyan}${s.sessionId}${c.reset}`);
    console.log(`  Protocol: ${c.cyan}${s.protocol}${c.reset}`);
    console.log(`  Node:     ${c.cyan}${s.nodeAddress}${c.reset}`);
    console.log(`  Uptime:   ${c.cyan}${s.uptimeFormatted}${c.reset}`);
    if (s.ip) console.log(`  IP:       ${c.cyan}${s.ip}${c.reset}`);
    if (s.socksPort) console.log(`  SOCKS5:   ${c.cyan}127.0.0.1:${s.socksPort}${c.reset}`);
  }
  console.log('');
}

// ─── Command: nodes ─────────────────────────────────────────────────────────

async function cmdNodes(flags) {
  banner();

  const limit = parseInt(flags.limit, 10) || 20;
  const country = flags.country || null;

  console.log(`${info} Fetching online nodes...`);
  if (country) console.log(`  Filter: country = ${c.cyan}${country}${c.reset}`);
  console.log('');

  const { queryOnlineNodes, filterNodes } = await import('../index.js');

  let nodes = await queryOnlineNodes({
    maxNodes: 200,
    onNodeProbed: ({ total, probed, online }) => {
      process.stdout.write(`\r  ${c.dim}Probing: ${probed}/${total} checked, ${online} online${c.reset}`);
    },
  });
  process.stdout.write('\r' + ' '.repeat(60) + '\r'); // Clear progress line

  // Filter by country if requested
  if (country) {
    nodes = filterNodes(nodes, { country });
  }

  // Limit output
  const display = nodes.slice(0, limit);

  if (display.length === 0) {
    console.log(`${warn} No nodes found${country ? ` in "${country}"` : ''}.`);
    console.log('');
    return;
  }

  console.log(`${ok} ${c.bold}${nodes.length} nodes found${c.reset}${nodes.length > limit ? ` (showing ${limit})` : ''}`);
  console.log('');

  // Table header
  console.log(
    `  ${c.bold}${pad('#', 4)}${pad('Address', 52)}${pad('Country', 16)}${pad('Type', 12)}${pad('Score', 8)}${pad('Peers', 6)}${c.reset}`,
  );
  console.log(`  ${c.dim}${'─'.repeat(96)}${c.reset}`);

  for (let i = 0; i < display.length; i++) {
    const n = display[i];
    const addr = n.address || '?';
    const short = addr.length > 48 ? addr.slice(0, 20) + '...' + addr.slice(-20) : addr;
    const loc = n.country || n.city || '?';
    const stype = n.serviceType || '?';
    const score = n.qualityScore != null ? n.qualityScore.toFixed(1) : '-';
    const peers = n.peers != null ? String(n.peers) : '-';

    console.log(
      `  ${c.dim}${pad(String(i + 1), 4)}${c.reset}${c.cyan}${pad(short, 52)}${c.reset}${pad(loc, 16)}${pad(stype, 12)}${c.green}${pad(score, 8)}${c.reset}${pad(peers, 6)}`,
    );
  }

  console.log('');
  console.log(`${info} Connect to a node: ${c.cyan}sentinel-ai connect --node <address>${c.reset}`);
  console.log('');
}

/** Pad string to fixed width */
function pad(str, width) {
  if (str.length >= width) return str.slice(0, width);
  return str + ' '.repeat(width - str.length);
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  loadEnv();

  const { positional, flags } = parseArgs(process.argv);
  const cmd = positional[0] || 'help';
  const sub = positional[1] || '';

  try {
    switch (cmd) {
      case 'setup':
        await cmdSetup();
        break;

      case 'wallet':
        switch (sub) {
          case 'create':
            await cmdWalletCreate();
            break;
          case 'balance':
            await cmdWalletBalance();
            break;
          case 'import':
            await cmdWalletImport(positional.slice(2));
            break;
          default:
            console.log(`${err} Unknown wallet command: ${sub}`);
            console.log(`  Available: create, balance, import`);
            process.exit(1);
        }
        break;

      case 'connect':
        await cmdConnect(flags);
        break;

      case 'disconnect':
        await cmdDisconnect();
        break;

      case 'status':
        await cmdStatus();
        break;

      case 'nodes':
        await cmdNodes(flags);
        break;

      case 'help':
      case '--help':
      case '-h':
        showHelp();
        break;

      default:
        console.log(`${err} Unknown command: ${cmd}`);
        console.log(`  Run: ${c.cyan}sentinel-ai help${c.reset}`);
        process.exit(1);
    }
  } catch (e) {
    console.log('');
    console.log(`${err} ${c.red}${e.message}${c.reset}`);
    console.log('');

    // Provide contextual recovery hints
    if (e.message.includes('mnemonic') || e.message.includes('MNEMONIC')) {
      console.log(`${info} Generate a wallet: ${c.cyan}sentinel-ai wallet create${c.reset}`);
      console.log(`${info} Then add MNEMONIC to your .env file`);
    } else if (e.message.includes('balance') || e.message.includes('Insufficient')) {
      console.log(`${info} Check balance: ${c.cyan}sentinel-ai wallet balance${c.reset}`);
    } else if (e.message.includes('V2Ray') || e.message.includes('WireGuard')) {
      console.log(`${info} Run setup: ${c.cyan}sentinel-ai setup${c.reset}`);
    }

    console.log('');
    process.exit(1);
  }
}

main();
