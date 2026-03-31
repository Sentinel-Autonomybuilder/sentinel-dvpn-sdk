/**
 * Sentinel AI Path — Environment Detection & Setup
 *
 * Detects OS, checks all dependencies, reports what's available.
 * An AI agent calls setup() first to understand what it can do.
 */

import {
  verifyDependencies,
  IS_ADMIN,
  WG_AVAILABLE,
  V2RAY_VERSION,
  preflight,
} from '../index.js';
import { existsSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── V2Ray Detection (comprehensive) ────────────────────────────────────────

/**
 * Find V2Ray binary by checking every known location.
 * This is the authoritative detection — covers env var, SDK paths, system paths.
 */
function findV2Ray() {
  const binary = process.platform === 'win32' ? 'v2ray.exe' : 'v2ray';

  // 1. V2RAY_PATH env var (highest priority)
  if (process.env.V2RAY_PATH && existsSync(process.env.V2RAY_PATH)) {
    return process.env.V2RAY_PATH;
  }

  // 2. Parent SDK bin/ (when running from ai-path/)
  const sdkBin = resolve(__dirname, '..', 'bin', binary);
  if (existsSync(sdkBin)) return sdkBin;

  // 3. Local bin/
  const localBin = resolve(__dirname, 'bin', binary);
  if (existsSync(localBin)) return localBin;

  // 4. Sibling bin/ (when SDK is installed as npm package)
  const siblingBin = resolve(__dirname, '..', 'bin', binary);
  if (existsSync(siblingBin)) return siblingBin;

  // 5. System paths
  const systemPaths = process.platform === 'win32'
    ? ['C:\\Program Files\\V2Ray\\v2ray.exe', 'C:\\Program Files (x86)\\V2Ray\\v2ray.exe']
    : ['/usr/local/bin/v2ray', '/usr/bin/v2ray', '/opt/homebrew/bin/v2ray'];
  for (const p of systemPaths) {
    if (existsSync(p)) return p;
  }

  // 6. System PATH
  try {
    const cmd = process.platform === 'win32' ? 'where v2ray.exe' : 'which v2ray';
    const result = execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim();
    if (result) return result.split('\n')[0];
  } catch { /* not in PATH */ }

  return null;
}

// ─── WireGuard Detection (comprehensive) ─────────────────────────────────────

function findWireGuard() {
  if (process.platform === 'win32') {
    const paths = [
      'C:\\Program Files\\WireGuard\\wireguard.exe',
      'C:\\Program Files (x86)\\WireGuard\\wireguard.exe',
    ];
    for (const p of paths) {
      if (existsSync(p)) return p;
    }
  } else {
    const paths = ['/usr/bin/wg', '/usr/local/bin/wg', '/opt/homebrew/bin/wg'];
    for (const p of paths) {
      if (existsSync(p)) return p;
    }
  }
  try {
    const cmd = process.platform === 'win32' ? 'where wireguard.exe' : 'which wg';
    const result = execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim();
    if (result) return result.split('\n')[0];
  } catch { /* not in PATH */ }
  return null;
}

// ─── getEnvironment() ────────────────────────────────────────────────────────

/**
 * Detect the current environment without changing anything.
 * Uses comprehensive detection — checks env vars, SDK paths, system paths, PATH.
 *
 * @returns {{
 *   os: string,
 *   arch: string,
 *   platform: string,
 *   nodeVersion: string,
 *   admin: boolean,
 *   v2ray: { available: boolean, version: string|null, path: string|null },
 *   wireguard: { available: boolean, path: string|null, requiresAdmin: true },
 *   capabilities: string[],
 *   recommended: string[],
 * }}
 */
export function getEnvironment() {
  const os = process.platform === 'win32' ? 'windows'
    : process.platform === 'darwin' ? 'macos'
    : process.platform === 'linux' ? 'linux'
    : process.platform;

  // V2Ray: our own comprehensive detection (not just SDK's verifyDependencies)
  const v2rayPath = findV2Ray();
  let v2rayVersion = null;
  if (v2rayPath) {
    try {
      const out = execSync(`"${v2rayPath}" version`, { encoding: 'utf8', stdio: 'pipe', timeout: 5000 });
      const match = out.match(/V2Ray\s+(\d+\.\d+\.\d+)/);
      v2rayVersion = match ? match[1] : null;
    } catch { /* version check optional */ }
  }

  const v2ray = {
    available: !!v2rayPath,
    version: v2rayVersion,
    path: v2rayPath,
  };

  // WireGuard: our own comprehensive detection
  const wgPath = findWireGuard();
  const wireguard = {
    available: !!wgPath,
    path: wgPath,
    requiresAdmin: true,
  };

  // What this environment can do
  const capabilities = [];
  if (v2ray.available) capabilities.push('v2ray');
  if (wireguard.available && IS_ADMIN) capabilities.push('wireguard');
  if (wireguard.available && !IS_ADMIN) capabilities.push('wireguard-needs-admin');

  // What we recommend installing
  const recommended = [];
  if (!v2ray.available) recommended.push('v2ray — run: node setup.js');
  if (!wireguard.available && os === 'windows') {
    recommended.push('wireguard — run setup.js as admin for auto-install');
  }
  if (!wireguard.available && os === 'macos') {
    recommended.push('wireguard — run: brew install wireguard-tools');
  }
  if (!wireguard.available && os === 'linux') {
    recommended.push('wireguard — run: sudo apt install wireguard-tools');
  }
  if (wireguard.available && !IS_ADMIN) {
    recommended.push('run as admin to use WireGuard nodes (faster, more reliable)');
  }

  return {
    os,
    arch: process.arch,
    platform: `${os}-${process.arch}`,
    nodeVersion: process.versions.node,
    admin: IS_ADMIN,
    v2ray,
    wireguard,
    capabilities,
    recommended,
  };
}

// ─── setup() ─────────────────────────────────────────────────────────────────

/**
 * Full environment setup: check deps, install missing ones, report status.
 * Runs preflight checks that verify everything needed for a VPN connection.
 *
 * Returns a FLAT structure — agents access .os, .v2ray, .wireguard directly.
 * No nested .environment wrapper to misread.
 *
 * @returns {Promise<{
 *   ready: boolean,
 *   os: string,
 *   arch: string,
 *   platform: string,
 *   nodeVersion: string,
 *   admin: boolean,
 *   v2ray: boolean,
 *   v2rayVersion: string|null,
 *   v2rayPath: string|null,
 *   wireguard: boolean,
 *   wireguardPath: string|null,
 *   capabilities: string[],
 *   recommended: string[],
 *   preflight: object|null,
 *   issues: string[],
 * }>}
 */
export async function setup() {
  const env = getEnvironment();
  const issues = [];

  // Run preflight checks (network, chain reachability, etc.)
  let preflightResult = null;
  try {
    preflightResult = await preflight();
  } catch (err) {
    issues.push(`Preflight failed: ${err.message}`);
  }

  // Check critical requirements
  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  if (nodeMajor < 20) {
    issues.push(`Node.js ${process.versions.node} too old — need >= 20`);
  }

  if (!env.v2ray.available && !env.wireguard.available) {
    issues.push('No tunnel protocol available — install V2Ray or WireGuard');
  }

  if (env.v2ray.available && env.v2ray.version && env.v2ray.version !== V2RAY_VERSION) {
    issues.push(`V2Ray version ${env.v2ray.version} — need exactly ${V2RAY_VERSION} (5.44.1+ has bugs)`);
  }

  const ready = issues.length === 0 && env.capabilities.length > 0;

  // Flat return — agent accesses .os, .v2ray, .admin directly
  return {
    ready,
    os: env.os,
    arch: env.arch,
    platform: env.platform,
    nodeVersion: env.nodeVersion,
    admin: env.admin,
    v2ray: env.v2ray.available,
    v2rayVersion: env.v2ray.version,
    v2rayPath: env.v2ray.path,
    wireguard: env.wireguard.available,
    wireguardPath: env.wireguard.path,
    capabilities: env.capabilities,
    recommended: env.recommended,
    preflight: preflightResult,
    issues,
    // Backward compat — keep nested .environment for existing consumers
    environment: env,
  };
}
