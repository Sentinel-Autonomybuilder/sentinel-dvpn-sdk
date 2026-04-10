#!/usr/bin/env node
/**
 * Sentinel dVPN SDK — Setup Script
 *
 * Downloads required binaries (V2Ray, WireGuard) for the current platform.
 * Run: node setup.js
 *
 * What it does:
 * 1. Checks if V2Ray v5.2.1 exists in bin/ — downloads if missing
 * 2. Checks if WireGuard is installed — prints install instructions if missing
 * 3. Verifies all SDK dependencies are installed (npm install)
 */

import { existsSync, mkdirSync, createWriteStream, unlinkSync, readFileSync } from 'fs';
import { execSync, execFileSync } from 'child_process';
import { createHash } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN_DIR = path.join(__dirname, 'bin');

import { V2RAY_VERSION } from './defaults.js';
const V2RAY_URLS = {
  'win32-x64':  `https://github.com/v2fly/v2ray-core/releases/download/v${V2RAY_VERSION}/v2ray-windows-64.zip`,
  'win32-ia32': `https://github.com/v2fly/v2ray-core/releases/download/v${V2RAY_VERSION}/v2ray-windows-32.zip`,
  'linux-x64':  `https://github.com/v2fly/v2ray-core/releases/download/v${V2RAY_VERSION}/v2ray-linux-64.zip`,
  'linux-arm64':`https://github.com/v2fly/v2ray-core/releases/download/v${V2RAY_VERSION}/v2ray-linux-arm64-v8a.zip`,
  'darwin-x64': `https://github.com/v2fly/v2ray-core/releases/download/v${V2RAY_VERSION}/v2ray-macos-64.zip`,
  'darwin-arm64':`https://github.com/v2fly/v2ray-core/releases/download/v${V2RAY_VERSION}/v2ray-macos-arm64-v8a.zip`,
};

const V2RAY_BINARY = process.platform === 'win32' ? 'v2ray.exe' : 'v2ray';
const V2RAY_FILES = [V2RAY_BINARY, 'geoip.dat', 'geosite.dat'];

// SHA256 checksums for V2Ray v5.2.1 release binaries (from official .dgst files)
const V2RAY_SHA256 = {
  'win32-x64':   'd9791f911b603437a34219488b0111ae9913f38abe22c0103abce330537dabd6',
  'win32-ia32':  'dc9f37dbeb32221e62b9a52b79f1842a217f049675872b334e1e5fd96121d0d2',
  'linux-x64':   '56eb8d4727b058d10f8ff830bb0121381386b0695171767f38ba410f2613fc9a',
  'linux-arm64': '63958429e93f24f10f34a64701f70b4f42dfa0bc8120e1c0a426c6161bd2a3c9',
  'darwin-x64':  'edbb0b94c05570d39a4549186927369853542649eb6b703dd432bda300c5d51a',
  'darwin-arm64':'e18c17a79c4585d963395ae6ddafffb18c5d22777f7ac5938c1b40563db88d56',
};

// ─── WireGuard Download URLs (verified 2026-03-26) ─────────────────────────
// Direct MSI downloads — no browser, no bootstrapper, silent-installable
const WG_VERSION = '0.5.3';
const WG_URLS = {
  'win32-x64':   `https://download.wireguard.com/windows-client/wireguard-amd64-${WG_VERSION}.msi`,
  'win32-arm64': `https://download.wireguard.com/windows-client/wireguard-arm64-${WG_VERSION}.msi`,
  'win32-ia32':  `https://download.wireguard.com/windows-client/wireguard-x86-${WG_VERSION}.msi`,
};
const WG_INSTALL_URL = 'https://download.wireguard.com/windows-client/wireguard-installer.exe';

// ─── Helpers ────────────────────────────────────────────────────────────────

function log(msg) { console.log(`[setup] ${msg}`); }
function warn(msg) { console.log(`[setup] ⚠ ${msg}`); }
function ok(msg) { console.log(`[setup] ✓ ${msg}`); }

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const follow = (url, redirects = 0) => {
      if (redirects > 5) return reject(new Error('Too many redirects'));
      const mod = url.startsWith('https') ? https : http;
      mod.get(url, { headers: { 'User-Agent': 'sentinel-sdk-setup' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return follow(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        const file = createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', reject);
      }).on('error', reject);
    };
    follow(url);
  });
}

function unzip(zipPath, destDir) {
  // Use PowerShell on Windows, unzip on others
  if (process.platform === 'win32') {
    execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${destDir}'`], { stdio: 'pipe' });
  } else {
    execFileSync('unzip', ['-o', zipPath, '-d', destDir], { stdio: 'pipe' });
  }
}

// ─── V2Ray ──────────────────────────────────────────────────────────────────

async function setupV2Ray() {
  const v2rayPath = path.join(BIN_DIR, V2RAY_BINARY);

  // Check if already exists
  if (existsSync(v2rayPath)) {
    ok(`V2Ray found at ${v2rayPath}`);
    // Verify companion files
    for (const f of V2RAY_FILES) {
      if (!existsSync(path.join(BIN_DIR, f))) {
        warn(`Missing ${f} in bin/ — re-downloading`);
        break;
      }
    }
    if (V2RAY_FILES.every(f => existsSync(path.join(BIN_DIR, f)))) return;
  }

  // Check system-wide
  const systemPaths = [
    'C:\\Program Files\\V2Ray\\v2ray.exe',
    'C:\\Program Files (x86)\\V2Ray\\v2ray.exe',
    '/usr/local/bin/v2ray',
    '/usr/bin/v2ray',
  ];
  for (const p of systemPaths) {
    if (existsSync(p)) {
      ok(`V2Ray found at ${p} (system install)`);
      log('Tip: copy v2ray.exe + geoip.dat + geosite.dat to bin/ for portability');
      return;
    }
  }

  // Download
  const platform = `${process.platform}-${process.arch}`;
  const url = V2RAY_URLS[platform];
  if (!url) {
    warn(`No V2Ray binary available for ${platform}`);
    warn(`Download manually from: https://github.com/v2fly/v2ray-core/releases/tag/v${V2RAY_VERSION}`);
    warn(`Place v2ray${process.platform === 'win32' ? '.exe' : ''}, geoip.dat, geosite.dat in bin/`);
    return;
  }

  mkdirSync(BIN_DIR, { recursive: true });
  const zipPath = path.join(BIN_DIR, 'v2ray.zip');

  log(`Downloading V2Ray v${V2RAY_VERSION} for ${platform}...`);
  log(`URL: ${url}`);
  await download(url, zipPath);

  // SHA256 verification
  const expectedHash = V2RAY_SHA256[platform];
  if (expectedHash) {
    const fileData = readFileSync(zipPath);
    const actualHash = createHash('sha256').update(fileData).digest('hex');
    if (actualHash !== expectedHash) {
      unlinkSync(zipPath);
      throw new Error(
        `V2Ray SHA256 mismatch! Expected ${expectedHash}, got ${actualHash}. ` +
        `Download may be corrupt or tampered. Delete bin/ and retry.`
      );
    }
    ok('SHA256 checksum verified');
  } else {
    warn(`No SHA256 checksum for ${platform} — skipping verification`);
  }

  log('Extracting...');
  unzip(zipPath, BIN_DIR);
  unlinkSync(zipPath);

  // Verify extraction + version check
  if (existsSync(v2rayPath)) {
    if (process.platform !== 'win32') {
      execFileSync('chmod', ['+x', v2rayPath], { stdio: 'pipe' });
    }
    // Verify the binary runs and reports correct version
    try {
      const versionOut = execFileSync(v2rayPath, ['version'], { encoding: 'utf8', timeout: 10000, stdio: 'pipe' });
      if (versionOut.includes(V2RAY_VERSION)) {
        ok(`V2Ray v${V2RAY_VERSION} installed and verified`);
      } else {
        warn(`V2Ray binary reports unexpected version: ${versionOut.trim().split('\n')[0]}`);
      }
    } catch {
      warn('V2Ray installed but version check failed (binary may not be executable on this platform)');
    }
  } else {
    warn('V2Ray extraction failed — check bin/ directory');
  }
}

// ─── WireGuard ──────────────────────────────────────────────────────────────

function findWireGuard() {
  // Windows: check standard install paths
  if (process.platform === 'win32') {
    const paths = [
      'C:\\Program Files\\WireGuard\\wireguard.exe',
      'C:\\Program Files (x86)\\WireGuard\\wireguard.exe',
    ];
    for (const p of paths) {
      if (existsSync(p)) return p;
    }
  }

  // macOS/Linux: check wg-quick
  if (process.platform !== 'win32') {
    const paths = ['/usr/bin/wg', '/usr/local/bin/wg', '/opt/homebrew/bin/wg'];
    for (const p of paths) {
      if (existsSync(p)) return p;
    }
  }

  // Check system PATH
  try {
    const cmd = process.platform === 'win32' ? 'where wireguard.exe' : 'which wg';
    const result = execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim();
    if (result) return result.split('\n')[0];
  } catch { /* not in PATH */ }

  return null;
}

function isAdmin() {
  if (process.platform === 'win32') {
    try {
      execSync('net session', { stdio: 'pipe' });
      return true;
    } catch {
      try {
        execSync('fsutil dirty query C:', { stdio: 'pipe' });
        return true;
      } catch { return false; }
    }
  }
  return process.getuid?.() === 0;
}

async function setupWireGuard() {
  const existing = findWireGuard();
  if (existing) {
    ok(`WireGuard found at ${existing}`);
    return;
  }

  // ─── Windows: auto-download MSI and silent install ───
  if (process.platform === 'win32') {
    const platform = `${process.platform}-${process.arch}`;
    const msiUrl = WG_URLS[platform];

    if (!msiUrl) {
      warn(`No WireGuard MSI for ${platform}`);
      log(`Download manually from: ${WG_INSTALL_URL}`);
      return;
    }

    if (!isAdmin()) {
      warn('WireGuard not installed — admin privileges required for automatic install');
      log('Run setup as Administrator, or install manually:');
      log(`  Download: ${msiUrl}`);
      log(`  Install:  msiexec /i wireguard-amd64-${WG_VERSION}.msi /qn /norestart`);
      log('');
      log('WireGuard is optional — V2Ray nodes (~70% of network) work without it');
      return;
    }

    const msiPath = path.join(BIN_DIR, `wireguard-${WG_VERSION}.msi`);
    mkdirSync(BIN_DIR, { recursive: true });

    log(`Downloading WireGuard v${WG_VERSION} for ${platform}...`);
    log(`URL: ${msiUrl}`);
    await download(msiUrl, msiPath);

    log('Installing WireGuard (silent)...');
    try {
      execSync(`msiexec /i "${msiPath}" /qn /norestart`, {
        stdio: 'pipe',
        timeout: 60000,
      });

      // Verify installation
      const installed = findWireGuard();
      if (installed) {
        ok(`WireGuard v${WG_VERSION} installed at ${installed}`);
      } else {
        warn('WireGuard MSI completed but binary not found — may need reboot');
      }
    } catch (err) {
      warn(`WireGuard MSI install failed: ${err.message}`);
      log('Try installing manually:');
      log(`  msiexec /i "${msiPath}" /qn /norestart`);
    }

    // Clean up MSI
    try { unlinkSync(msiPath); } catch { /* ignore */ }
    return;
  }

  // ─── macOS: use Homebrew ───
  if (process.platform === 'darwin') {
    try {
      execSync('which brew', { stdio: 'pipe' });
      log('Installing WireGuard via Homebrew...');
      execSync('brew install wireguard-tools', { stdio: 'inherit', timeout: 120000 });
      ok('WireGuard installed via Homebrew');
      return;
    } catch {
      warn('WireGuard not found and Homebrew not available');
      log('Install Homebrew: /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"');
      log('Then: brew install wireguard-tools');
      return;
    }
  }

  // ─── Linux: use package manager ───
  if (process.platform === 'linux') {
    const managers = [
      { cmd: 'apt-get', install: 'sudo apt-get install -y wireguard-tools' },
      { cmd: 'dnf', install: 'sudo dnf install -y wireguard-tools' },
      { cmd: 'pacman', install: 'sudo pacman -S --noconfirm wireguard-tools' },
      { cmd: 'apk', install: 'sudo apk add wireguard-tools' },
    ];

    for (const mgr of managers) {
      try {
        execSync(`which ${mgr.cmd}`, { stdio: 'pipe' });
        if (isAdmin()) {
          log(`Installing WireGuard via ${mgr.cmd}...`);
          execSync(mgr.install, { stdio: 'inherit', timeout: 120000 });
          ok('WireGuard installed');
        } else {
          warn('WireGuard not installed — root required');
          log(`Install: ${mgr.install}`);
        }
        return;
      } catch { /* try next manager */ }
    }

    warn('WireGuard not found and no supported package manager detected');
    log('Install wireguard-tools for your distribution');
  }
}

// ─── npm dependencies ───────────────────────────────────────────────────────

function checkDeps() {
  if (!existsSync(path.join(__dirname, 'node_modules'))) {
    log('Installing npm dependencies...');
    execSync('npm install', { cwd: __dirname, stdio: 'inherit' });
    ok('Dependencies installed');
  } else {
    ok('npm dependencies present');
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('  Sentinel dVPN SDK — Setup');
  console.log('  ─────────────────────────');
  console.log('');

  checkDeps();
  await setupV2Ray();
  await setupWireGuard();

  console.log('');
  console.log('  Setup complete! Quick start:');
  console.log('');
  console.log('    import { connect, listNodes, registerCleanupHandlers } from \'./index.js\';');
  console.log('');
  console.log('    registerCleanupHandlers();');
  console.log('    const nodes = await listNodes();');
  console.log('    const conn = await connect({ mnemonic: \'...\', nodeAddress: nodes[0].address });');
  console.log('');
}

main().catch(err => {
  console.error(`[setup] Fatal: ${err.message}`);
  process.exit(1);
});
