/**
 * Multi-Region Rotation
 *
 * Connect to VPN nodes in different countries sequentially.
 * Each hop: connect -> perform work -> disconnect -> next country.
 *
 * Use cases:
 *   - Data collection from different geographic perspectives
 *   - Verifying geo-restricted content availability
 *   - Testing regional API responses
 *   - Distributing requests across exit regions
 *
 * Run: node examples/multi-region.mjs
 */

import 'dotenv/config';
import { connect, disconnect, isVpnActive } from '../index.js';

// ─── Configuration ──────────────────────────────────────────────────────────

const REGIONS = [
  { country: 'DE', label: 'Germany' },
  { country: 'JP', label: 'Japan' },
  { country: 'US', label: 'United States' },
];

const SETTLE_DELAY_MS = 3000;

// ─── Helpers ────────────────────────────────────────────────────────────────

function log(level, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  const prefix = { info: '\x1b[36m[INFO]\x1b[0m', warn: '\x1b[33m[WARN]\x1b[0m', err: '\x1b[31m[ERR]\x1b[0m', ok: '\x1b[32m[ OK ]\x1b[0m' };
  console.log(`${ts} ${prefix[level] || prefix.info} ${msg}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Work Function ──────────────────────────────────────────────────────────

/**
 * Perform work through the VPN tunnel.
 * Replace this with your actual task (scraping, API calls, etc.).
 */
async function doWork(region) {
  log('info', `[${region.label}] Performing work through tunnel...`);

  try {
    const { default: axios } = await import('axios');

    // Verify we have a new IP
    const ipRes = await axios.get('https://api.ipify.org?format=json', {
      timeout: 15000,
      adapter: 'http',
    });
    log('ok', `[${region.label}] Exit IP: ${ipRes.data.ip}`);

    // Example: fetch region-specific data
    const geoRes = await axios.get(`https://ipapi.co/${ipRes.data.ip}/json/`, {
      timeout: 15000,
      adapter: 'http',
    });
    const geo = geoRes.data;
    log('ok', `[${region.label}] Geo: ${geo.country_name || '?'}, ${geo.city || '?'}, ${geo.org || '?'}`);

    return {
      region: region.label,
      ip: ipRes.data.ip,
      country: geo.country_name || null,
      city: geo.city || null,
      org: geo.org || null,
    };
  } catch (err) {
    log('warn', `[${region.label}] Work failed: ${err.message}`);
    return { region: region.label, ip: null, error: err.message };
  }
}

// ─── Main Loop ──────────────────────────────────────────────────────────────

async function main() {
  const mnemonic = process.env.MNEMONIC;
  if (!mnemonic) {
    log('err', 'No MNEMONIC in .env file. Run: sentinel-ai wallet create');
    process.exit(1);
  }

  log('info', `Multi-region rotation: ${REGIONS.map(r => r.label).join(' -> ')}`);
  console.log('');

  const results = [];

  for (let i = 0; i < REGIONS.length; i++) {
    const region = REGIONS[i];
    const step = `[${i + 1}/${REGIONS.length}]`;

    // ── Connect ──
    log('info', `${step} Connecting to ${region.label} (${region.country})...`);

    try {
      const vpn = await connect({
        mnemonic,
        country: region.country,
        protocol: 'v2ray',
        onProgress: (stage, detail) => log('info', `  [${stage}] ${detail}`),
      });

      log('ok', `${step} Connected via ${vpn.protocol}, IP: ${vpn.ip || 'checking...'}`);

      // Let the tunnel settle
      await sleep(SETTLE_DELAY_MS);

      // ── Work ──
      const result = await doWork(region);
      results.push(result);

    } catch (err) {
      log('err', `${step} Failed to connect to ${region.label}: ${err.message}`);
      results.push({ region: region.label, ip: null, error: err.message });
    }

    // ── Disconnect ──
    if (isVpnActive()) {
      log('info', `${step} Disconnecting from ${region.label}...`);
      try {
        await disconnect();
        log('ok', `${step} Disconnected`);
      } catch (err) {
        log('warn', `${step} Disconnect error: ${err.message}`);
      }
    }

    // Pause between regions (let chain state settle)
    if (i < REGIONS.length - 1) {
      log('info', 'Waiting before next region...');
      await sleep(SETTLE_DELAY_MS);
    }

    console.log('');
  }

  // ─── Summary ────────────────────────────────────────────────────────────

  console.log('\x1b[1m  Region Rotation Summary\x1b[0m');
  console.log(`  ${'─'.repeat(60)}`);

  for (const r of results) {
    if (r.error) {
      console.log(`  \x1b[31mx\x1b[0m ${r.region.padEnd(20)} Failed: ${r.error}`);
    } else {
      console.log(`  \x1b[32m+\x1b[0m ${r.region.padEnd(20)} IP: ${r.ip}  (${r.country || '?'}, ${r.city || '?'})`);
    }
  }

  console.log('');
  const ok = results.filter(r => !r.error).length;
  log('info', `Done. ${ok}/${results.length} regions connected successfully.`);
}

// ─── Graceful Shutdown ──────────────────────────────────────────────────────

process.on('SIGINT', async () => {
  console.log('');
  log('info', 'Interrupted — disconnecting...');
  try { await disconnect(); } catch { /* best effort */ }
  process.exit(0);
});

main().catch((err) => {
  log('err', `Fatal: ${err.message}`);
  process.exit(1);
});
