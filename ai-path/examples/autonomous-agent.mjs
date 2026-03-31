/**
 * Autonomous Agent — Production VPN Pattern
 *
 * A complete autonomous AI agent that:
 *   1. Creates or loads a wallet
 *   2. Checks balance, warns if low
 *   3. Connects to VPN with retry logic
 *   4. Performs work (HTTP requests through the tunnel)
 *   5. Monitors connection health
 *   6. Auto-reconnects on failure
 *   7. Gracefully disconnects when done
 *
 * Run: node examples/autonomous-agent.mjs
 */

import 'dotenv/config';
import { connect, disconnect, status, isVpnActive, createWallet, getBalance } from '../index.js';

// ─── Configuration ──────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;
const HEALTH_CHECK_INTERVAL_MS = 30000;
const WORK_CYCLES = 5;

// ─── Helpers ────────────────────────────────────────────────────────────────

function log(level, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  const prefix = { info: '\x1b[36m[INFO]\x1b[0m', warn: '\x1b[33m[WARN]\x1b[0m', err: '\x1b[31m[ERR]\x1b[0m', ok: '\x1b[32m[ OK ]\x1b[0m' };
  console.log(`${ts} ${prefix[level] || prefix.info} ${msg}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Step 1: Wallet Setup ───────────────────────────────────────────────────

async function ensureWallet() {
  let mnemonic = process.env.MNEMONIC;

  if (!mnemonic) {
    log('warn', 'No MNEMONIC in .env — generating a new wallet');
    const wallet = await createWallet();
    mnemonic = wallet.mnemonic;
    log('ok', `Wallet created: ${wallet.address}`);
    log('warn', 'SAVE YOUR MNEMONIC — it will not be shown again.');
    log('warn', `Add to .env: MNEMONIC=<your ${mnemonic.split(' ').length} words>`);
    // SECURITY: Never log the full mnemonic. Write directly to .env file instead.
    const { writeFileSync } = await import('fs');
    writeFileSync('.env', `MNEMONIC=${mnemonic}\n`, { mode: 0o600 });
  }

  return mnemonic;
}

// ─── Step 2: Balance Check ──────────────────────────────────────────────────

async function checkFunds(mnemonic) {
  log('info', 'Checking wallet balance...');
  const bal = await getBalance(mnemonic);
  log('info', `Address: ${bal.address}`);
  log('info', `Balance: ${bal.p2p} (${bal.udvpn.toLocaleString()} udvpn)`);

  if (!bal.funded) {
    log('err', 'Insufficient balance. Fund your wallet with P2P tokens.');
    log('info', `Send tokens to: ${bal.address}`);
    process.exit(1);
  }

  log('ok', 'Wallet funded and ready');
  return bal;
}

// ─── Step 3: Connect with Retries ───────────────────────────────────────────

async function connectWithRetry(mnemonic) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    log('info', `Connection attempt ${attempt}/${MAX_RETRIES}...`);

    try {
      const vpn = await connect({
        mnemonic,
        protocol: 'v2ray',
        onProgress: (stage, detail) => log('info', `  [${stage}] ${detail}`),
      });

      log('ok', `Connected via ${vpn.protocol} to ${vpn.nodeAddress}`);
      if (vpn.ip) log('ok', `Public IP: ${vpn.ip}`);
      return vpn;
    } catch (err) {
      log('err', `Attempt ${attempt} failed: ${err.message}`);

      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * attempt;
        log('info', `Retrying in ${delay / 1000}s...`);
        await sleep(delay);
      }
    }
  }

  log('err', `Failed after ${MAX_RETRIES} attempts`);
  process.exit(1);
}

// ─── Step 4: Perform Work ───────────────────────────────────────────────────

async function doWork(cycleNum) {
  // Simulated work — replace with your actual task
  // (web scraping, API calls, data collection, etc.)
  log('info', `Work cycle ${cycleNum}: making request through VPN tunnel...`);

  try {
    // Use dynamic import so this example works without axios installed
    const { default: axios } = await import('axios');
    const res = await axios.get('https://api.ipify.org?format=json', {
      timeout: 15000,
      adapter: 'http',
    });
    log('ok', `Work cycle ${cycleNum}: response from IP ${res.data.ip}`);
  } catch (err) {
    log('warn', `Work cycle ${cycleNum}: request failed — ${err.message}`);
    return false;
  }

  return true;
}

// ─── Step 5: Health Monitor ─────────────────────────────────────────────────

function startHealthMonitor(mnemonic) {
  const intervalId = setInterval(async () => {
    if (!isVpnActive()) {
      log('warn', 'VPN connection lost — reconnecting...');
      clearInterval(intervalId);

      try {
        await connectWithRetry(mnemonic);
        startHealthMonitor(mnemonic);
      } catch (err) {
        log('err', `Auto-reconnect failed: ${err.message}`);
      }
    } else {
      const s = status();
      log('info', `Health check: connected, uptime ${s.uptimeFormatted || 'unknown'}`);
    }
  }, HEALTH_CHECK_INTERVAL_MS);

  return intervalId;
}

// ─── Main Agent Loop ────────────────────────────────────────────────────────

async function main() {
  log('info', 'Autonomous agent starting...');
  console.log('');

  // 1. Wallet
  const mnemonic = await ensureWallet();

  // 2. Funds
  await checkFunds(mnemonic);
  console.log('');

  // 3. Connect
  await connectWithRetry(mnemonic);
  console.log('');

  // 4. Health monitor
  const monitorId = startHealthMonitor(mnemonic);

  // 5. Work loop
  let failures = 0;
  for (let i = 1; i <= WORK_CYCLES; i++) {
    const success = await doWork(i);
    if (!success) failures++;

    // If too many consecutive failures, reconnect
    if (failures >= 2) {
      log('warn', 'Multiple work failures — reconnecting...');
      await disconnect().catch(() => {});
      await connectWithRetry(mnemonic);
      failures = 0;
    }

    // Pause between work cycles
    if (i < WORK_CYCLES) {
      await sleep(3000);
    }
  }

  // 6. Cleanup
  console.log('');
  log('info', 'Work complete. Disconnecting...');
  clearInterval(monitorId);

  try {
    await disconnect();
    log('ok', 'Disconnected. Agent finished.');
  } catch (err) {
    log('warn', `Disconnect error: ${err.message}`);
  }

  process.exit(0);
}

// ─── Graceful Shutdown ──────────────────────────────────────────────────────

process.on('SIGINT', async () => {
  console.log('');
  log('info', 'Interrupted — shutting down...');
  try { await disconnect(); } catch { /* best effort */ }
  process.exit(0);
});

main().catch((err) => {
  log('err', `Fatal: ${err.message}`);
  process.exit(1);
});
