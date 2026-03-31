#!/usr/bin/env node
/**
 * Sentinel AI Connect — Auto-Setup Script
 *
 * Runs on postinstall or manually via: node setup.js
 *
 * Checks:
 * 1. Node.js version >= 20
 * 2. V2Ray binary (local bin/, parent SDK bin/, system PATH)
 * 3. WireGuard installation (optional)
 * 4. .env with MNEMONIC
 *
 * Delegates binary downloads to the parent SDK's setup.js when needed.
 */

import { existsSync, readFileSync, copyFileSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PARENT_SDK = path.resolve(__dirname, '..');

// ─── Status Tracking ────────────────────────────────────────────────────────

const status = {
  node: { ok: false, detail: '' },
  v2ray: { ok: false, detail: '' },
  wireguard: { ok: false, detail: '' },
  wallet: { ok: false, detail: '' },
};

// ─── Node.js Version Check ──────────────────────────────────────────────────

function checkNodeVersion() {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major >= 20) {
    status.node = { ok: true, detail: `v${process.versions.node}` };
  } else {
    status.node = { ok: false, detail: `v${process.versions.node} (need >= 20)` };
  }
}

// ─── V2Ray Binary Check ────────────────────────────────────────────────────

function findV2Ray() {
  const binary = process.platform === 'win32' ? 'v2ray.exe' : 'v2ray';

  // Search paths in priority order
  const searchPaths = [
    path.join(__dirname, 'bin', binary),
    path.join(PARENT_SDK, 'bin', binary),
  ];

  // System paths
  if (process.platform === 'win32') {
    searchPaths.push('C:\\Program Files\\V2Ray\\v2ray.exe');
    searchPaths.push('C:\\Program Files (x86)\\V2Ray\\v2ray.exe');
  } else {
    searchPaths.push('/usr/local/bin/v2ray');
    searchPaths.push('/usr/bin/v2ray');
  }

  for (const p of searchPaths) {
    if (existsSync(p)) {
      status.v2ray = { ok: true, detail: `found at ${p}` };
      return p;
    }
  }

  // Check system PATH
  try {
    const cmd = process.platform === 'win32' ? 'where v2ray.exe' : 'which v2ray';
    const result = execSync(cmd, { stdio: 'pipe', encoding: 'utf-8' }).trim();
    if (result) {
      status.v2ray = { ok: true, detail: `found at ${result.split('\n')[0]}` };
      return result.split('\n')[0];
    }
  } catch {
    // Not in PATH
  }

  status.v2ray = { ok: false, detail: 'not found' };
  return null;
}

// ─── V2Ray Setup via Parent SDK ─────────────────────────────────────────────

async function setupV2Ray() {
  const parentSetup = path.join(PARENT_SDK, 'setup.js');
  if (!existsSync(parentSetup)) {
    status.v2ray = { ok: false, detail: 'not found — parent SDK setup.js missing' };
    return;
  }

  console.log('[setup] Downloading V2Ray via parent SDK...');
  try {
    // Windows ESM requires file:// URLs for absolute paths — raw C:\ paths fail
    const { pathToFileURL } = await import('url');
    const mod = await import(pathToFileURL(parentSetup).href);
    // Parent setup.js runs on import (top-level await) or exports a function
    if (typeof mod.default === 'function') {
      await mod.default();
    } else if (typeof mod.setup === 'function') {
      await mod.setup();
    }
    // Re-check after download
    findV2Ray();
  } catch (err) {
    status.v2ray = { ok: false, detail: `download failed — ${err.message}` };
  }
}

// ─── WireGuard Check + Auto-Install ─────────────────────────────────────────

const WG_VERSION = '0.5.3';
const WG_MSI_URLS = {
  'win32-x64':   `https://download.wireguard.com/windows-client/wireguard-amd64-${WG_VERSION}.msi`,
  'win32-arm64': `https://download.wireguard.com/windows-client/wireguard-arm64-${WG_VERSION}.msi`,
  'win32-ia32':  `https://download.wireguard.com/windows-client/wireguard-x86-${WG_VERSION}.msi`,
};

function findWireGuard() {
  const wgPaths = process.platform === 'win32'
    ? ['C:\\Program Files\\WireGuard\\wireguard.exe', 'C:\\Program Files (x86)\\WireGuard\\wireguard.exe']
    : ['/usr/bin/wg', '/usr/local/bin/wg', '/opt/homebrew/bin/wg'];

  for (const p of wgPaths) {
    if (existsSync(p)) return p;
  }

  try {
    const cmd = process.platform === 'win32' ? 'where wireguard.exe' : 'which wg';
    const result = execSync(cmd, { stdio: 'pipe', encoding: 'utf-8' }).trim();
    if (result) return result.split('\n')[0];
  } catch { /* not in PATH */ }

  return null;
}

function isAdmin() {
  if (process.platform === 'win32') {
    try { execSync('net session', { stdio: 'pipe' }); return true; } catch {
      try { execSync('fsutil dirty query C:', { stdio: 'pipe' }); return true; } catch { return false; }
    }
  }
  return process.getuid?.() === 0;
}

async function checkWireGuard() {
  const existing = findWireGuard();
  if (existing) {
    status.wireguard = { ok: true, detail: `found at ${existing}` };
    return;
  }

  // Delegate to parent SDK's setup.js which has full auto-install logic
  // (downloads MSI, silent installs, handles macOS brew, Linux apt/dnf)
  const parentSetup = path.resolve(__dirname, '..', 'bin', 'setup.js');
  if (existsSync(parentSetup)) {
    console.log('[setup] WireGuard not found — attempting auto-install via SDK...');
    try {
      execSync(`node "${parentSetup}"`, { stdio: 'inherit', timeout: 180000 });
      // Re-check after parent setup
      const installed = findWireGuard();
      if (installed) {
        status.wireguard = { ok: true, detail: `auto-installed at ${installed}` };
        return;
      }
    } catch (err) {
      console.log(`[setup] WireGuard auto-install via SDK failed: ${err.message}`);
    }
  }

  // Provide manual install URLs per platform
  const platform = `${process.platform}-${process.arch}`;
  const msiUrl = WG_MSI_URLS[platform];
  if (process.platform === 'win32' && msiUrl) {
    status.wireguard = {
      ok: false,
      detail: `not installed — run setup as admin for auto-install, or download: ${msiUrl}`,
    };
  } else if (process.platform === 'darwin') {
    status.wireguard = { ok: false, detail: 'not installed — run: brew install wireguard-tools' };
  } else if (process.platform === 'linux') {
    status.wireguard = { ok: false, detail: 'not installed — run: sudo apt install wireguard-tools' };
  } else {
    status.wireguard = { ok: false, detail: 'not installed (optional — V2Ray nodes work without it)' };
  }
}

// ─── Wallet / .env Check ───────────────────────────────────────────────────

function checkWallet() {
  const envPath = path.join(__dirname, '.env');
  if (!existsSync(envPath)) {
    // Copy .env.example if it exists
    const examplePath = path.join(__dirname, '.env.example');
    if (existsSync(examplePath)) {
      copyFileSync(examplePath, envPath);
      status.wallet = { ok: false, detail: 'no MNEMONIC in .env (created from .env.example)' };
    } else {
      status.wallet = { ok: false, detail: 'no .env file found' };
    }
    return;
  }

  try {
    const content = readFileSync(envPath, 'utf-8');
    const match = content.match(/^MNEMONIC\s*=\s*(.+)$/m);
    if (match && match[1].trim().length > 0) {
      const words = match[1].trim().split(/\s+/).length;
      status.wallet = { ok: true, detail: `${words}-word mnemonic configured` };
    } else {
      status.wallet = { ok: false, detail: 'no MNEMONIC in .env' };
    }
  } catch {
    status.wallet = { ok: false, detail: 'could not read .env' };
  }
}

// ─── Status Report ──────────────────────────────────────────────────────────

function printReport() {
  const mark = (s) => s.ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  const pad = (s, n) => s.padEnd(n);

  console.log('');
  console.log('Sentinel AI Connect — Setup');
  console.log('\u2550'.repeat(40));
  console.log(`  ${pad('Node.js', 12)} ${mark(status.node)}  ${status.node.detail}`);
  console.log(`  ${pad('V2Ray', 12)} ${mark(status.v2ray)}  ${status.v2ray.detail}`);
  console.log(`  ${pad('WireGuard', 12)} ${mark(status.wireguard)}  ${status.wireguard.detail}`);
  console.log(`  ${pad('Wallet', 12)} ${mark(status.wallet)}  ${status.wallet.detail}`);
  console.log('');

  // Print next steps
  const steps = [];
  if (!status.node.ok) {
    steps.push('Install Node.js >= 20: https://nodejs.org');
  }
  if (!status.v2ray.ok) {
    steps.push('Run: npm run setup (to download V2Ray)');
  }
  if (!status.wallet.ok) {
    steps.push('Set MNEMONIC in .env file');
    steps.push('Or run: npx sentinel-ai wallet create');
  }

  if (steps.length > 0) {
    console.log('  Next:');
    for (const step of steps) {
      console.log(`    ${step}`);
    }
    console.log('');
  } else {
    console.log('  Ready! Run: npx sentinel-ai connect');
    console.log('');
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  checkNodeVersion();

  if (!status.node.ok) {
    console.error(`[sentinel-ai] Node.js >= 20 required (found ${process.versions.node})`);
    printReport();
    process.exit(0); // Exit 0 so postinstall doesn't fail npm install
  }

  const v2rayPath = findV2Ray();

  // If not found, try parent SDK setup
  if (!v2rayPath) {
    await setupV2Ray();
  }

  await checkWireGuard();
  checkWallet();
  printReport();

  // Always exit 0 — missing wallet is expected on first run
  process.exit(0);
}

main().catch((err) => {
  console.error(`[sentinel-ai] Setup error: ${err.message}`);
  process.exit(0); // Don't break npm install
});
