/**
 * Sentinel WireGuard Config Builder
 *
 * Generates WireGuard key pairs and writes .conf files from v3 handshake results.
 * Handles platform-specific security (Windows NTFS ACLs, Unix file permissions).
 */

import { randomBytes } from 'crypto';
import { x25519 } from '@noble/curves/ed25519.js';
import path from 'path';
import os from 'os';
import { mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { execFileSync } from 'child_process';
import { SecurityError, ErrorCodes } from '../errors.js';

// ─── WireGuard Key Generation ─────────────────────────────────────────────────

/**
 * Generate a WireGuard-compatible Curve25519 key pair.
 * Returns { privateKey: Buffer(32), publicKey: Buffer(32) }
 */
export function generateWgKeyPair() {
  // Generate private key with WireGuard bit clamping
  const priv = Buffer.from(randomBytes(32));
  priv[0] &= 248;  // clear bottom 3 bits
  priv[31] &= 127;  // clear top bit
  priv[31] |= 64;   // set second-highest bit

  // Derive public key via X25519 (Curve25519 scalar base mult)
  const pub = Buffer.from(x25519.getPublicKey(priv));

  return { privateKey: priv, publicKey: pub };
}

// ─── Build & Write WireGuard Config ──────────────────────────────────────────

/**
 * Write a WireGuard .conf file from v3 handshake result.
 * @param {Buffer}   wgPrivKey      - Our WireGuard private key (32 bytes)
 * @param {string[]} assignedAddrs  - Our assigned IPs from node (e.g. ["10.8.0.2/24"])
 * @param {string}   serverPubKey   - Server WireGuard public key (base64)
 * @param {string}   serverEndpoint - "IP:PORT" for the WireGuard server
 * @param {string[]} [splitIPs]     - If provided, only route these IPs through tunnel (split tunneling).
 *                                    Prevents internet death if tunnel cleanup fails.
 *                                    Pass null/empty for full tunnel (0.0.0.0/0) — NOT recommended for testing.
 * @param {object}   [opts]         - Optional config overrides { mtu, dns, keepalive }
 * @returns {string} Path to the written .conf file
 */
export function writeWgConfig(wgPrivKey, assignedAddrs, serverPubKey, serverEndpoint, splitIPs = null, opts = {}) {
  // Use a SYSTEM-readable path on Windows. The WireGuard service runs as SYSTEM
  // and often can't read configs from user temp dirs (C:\Users\X\AppData\Local\Temp).
  // C:\ProgramData is readable by all accounts including SYSTEM.
  const tmpDir = process.platform === 'win32'
    ? path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'sentinel-wg')
    : path.join(os.tmpdir(), 'sentinel-wg');
  mkdirSync(tmpDir, { recursive: true, mode: 0o700 });

  // SECURITY: Restrict directory ACL BEFORE writing the config file.
  // The file inherits the directory ACL on creation, closing the race window
  // where the private key would be world-readable between write and ACL set.
  if (process.platform === 'win32') {
    const user = process.env.USERNAME || 'BUILTIN\\Users';
    try {
      execFileSync('icacls', [tmpDir, '/inheritance:r', '/grant:r', `${user}:F`, '/grant:r', 'SYSTEM:F'], { stdio: 'pipe', timeout: 5000 });
    } catch (dirAclErr) {
      throw new SecurityError(ErrorCodes.TLS_CERT_CHANGED, `Failed to secure WireGuard config directory (private key exposure risk): ${dirAclErr.message}`, { tmpDir });
    }
  }

  const confPath = path.join(tmpDir, 'wgsent0.conf');
  const privKeyBase64 = wgPrivKey.toString('base64');
  const address = assignedAddrs.join(', ');

  // Split tunneling: only route speedtest target IPs through tunnel.
  // Full tunnel (0.0.0.0/0) captures ALL traffic — if tunnel dies, internet dies.
  const useSplit = splitIPs && splitIPs.length > 0;
  const allowedIPsStr = useSplit
    ? splitIPs.map(ip => ip.includes('/') ? ip : `${ip}/32`).join(', ')
    : '0.0.0.0/0, ::/0';

  // WireGuard config values — configurable via opts parameter or defaults
  // MTU 1280 = Sentinel nodes configured for 1280. Using 1420 causes TLS failures. (FAILURES.md T2)
  // DNS 10.8.0.1 = node's internal resolver (always reachable inside tunnel). (FAILURES.md T3)
  //   External DNS (Cloudflare, Google) may be unreachable through some nodes.
  //   Caller can override via opts.dns for specific DNS presets.
  // PersistentKeepalive 15 = safe for all NAT routers (20-30s timeout windows). (FAILURES.md CF6)
  const wgMtu = opts?.mtu || 1280;
  const wgDns = opts?.dns || '10.8.0.1, 1.1.1.1';
  const wgKeepalive = opts?.keepalive || 15;

  const lines = [
    '[Interface]',
    `PrivateKey = ${privKeyBase64}`,
    `Address = ${address}`,
    `MTU = ${wgMtu}`,
  ];
  // Only set DNS for full tunnel; split tunnel uses system DNS (safer)
  if (!useSplit) lines.push(`DNS = ${wgDns}`);
  lines.push(
    '',
    '[Peer]',
    `PublicKey = ${serverPubKey}`,
    `Endpoint = ${serverEndpoint}`,
    `AllowedIPs = ${allowedIPsStr}`,
    `PersistentKeepalive = ${wgKeepalive}`,
    '',
  );

  const conf = lines.join('\n');

  writeFileSync(confPath, conf, { encoding: 'utf8', mode: 0o600 }); // restrict: owner-only read/write
  // On Windows, POSIX mode bits are ignored — file inherits directory ACL set above.
  // Belt-and-suspenders: also set file-level ACL explicitly.
  if (process.platform === 'win32') {
    const user = process.env.USERNAME || 'BUILTIN\\Users';
    try {
      execFileSync('icacls', [confPath, '/inheritance:r', '/grant:r', `${user}:F`, '/grant:r', 'SYSTEM:F'], { stdio: 'pipe', timeout: 5000 });
    } catch (aclErr) {
      // Don't leave an unprotected private key on disk
      try { unlinkSync(confPath); } catch { /* cleanup best-effort */ }
      throw new SecurityError(ErrorCodes.TLS_CERT_CHANGED, `Failed to secure WireGuard config (private key exposure risk): ${aclErr.message}`, { confPath });
    }
  }
  return confPath;
}
