/**
 * Sentinel SDK — Pre-Flight System Check
 *
 * Run before any connection attempt. Detects:
 * - Missing binaries (WireGuard, V2Ray) with install instructions
 * - Admin/root permissions
 * - Orphaned tunnels from previous crashes
 * - Orphaned V2Ray processes
 * - Conflicting VPN software
 * - Port conflicts
 *
 * Returns actionable steps — not just pass/fail.
 */

import { execSync, execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { WG_EXE, WG_QUICK, WG_AVAILABLE, IS_ADMIN, emergencyCleanupSync } from './wireguard.js';

// ─── Orphaned Tunnel Detection ──────────────────────────────────────────────

/**
 * Check for orphaned WireGuard tunnels (left over from crashes).
 * @returns {{ found: boolean, tunnels: string[], cleaned: boolean }}
 */
export function checkOrphanedTunnels() {
  const result = { found: false, tunnels: [], cleaned: false };

  if (process.platform === 'win32') {
    try {
      const services = execSync('sc query type= service state= all', { encoding: 'utf8', timeout: 5000, stdio: 'pipe' });
      const matches = services.match(/WireGuardTunnel\$wgsent\S*/g) || [];
      if (matches.length > 0) {
        result.found = true;
        result.tunnels = matches.map(s => s.replace('WireGuardTunnel$', ''));
      }
    } catch { /* sc query may fail */ }
  } else {
    // Linux/macOS: check for wgsent* interfaces
    try {
      const ifaces = execSync('ip link show 2>/dev/null || ifconfig 2>/dev/null', { encoding: 'utf8', timeout: 3000, stdio: 'pipe' });
      const matches = ifaces.match(/wgsent\d+/g) || [];
      if (matches.length > 0) {
        result.found = true;
        result.tunnels = [...new Set(matches)];
      }
    } catch { /* ip/ifconfig may not exist */ }
  }

  return result;
}

/**
 * Clean up orphaned WireGuard tunnels.
 * @returns {{ cleaned: number, errors: string[] }}
 */
export function cleanOrphanedTunnels() {
  const before = checkOrphanedTunnels();
  if (!before.found) return { cleaned: 0, errors: [] };

  emergencyCleanupSync();

  const after = checkOrphanedTunnels();
  const cleaned = before.tunnels.length - after.tunnels.length;
  const errors = after.found
    ? [`${after.tunnels.length} tunnel(s) could not be removed: ${after.tunnels.join(', ')}`]
    : [];

  return { cleaned, errors };
}

// ─── V2Ray Orphan Detection ─────────────────────────────────────────────────

/**
 * Check for orphaned V2Ray processes.
 * @returns {{ found: boolean, pids: number[] }}
 */
export function checkOrphanedV2Ray() {
  const result = { found: false, pids: [] };

  try {
    if (process.platform === 'win32') {
      const out = execSync('tasklist /FI "IMAGENAME eq v2ray.exe" /NH /FO CSV', { encoding: 'utf8', timeout: 5000, stdio: 'pipe' });
      const lines = out.split('\n').filter(l => l.includes('v2ray.exe'));
      for (const line of lines) {
        const match = line.match(/"v2ray\.exe","(\d+)"/);
        if (match) result.pids.push(parseInt(match[1], 10));
      }
    } else {
      const out = execSync('pgrep -x v2ray 2>/dev/null || true', { encoding: 'utf8', timeout: 3000, stdio: 'pipe' });
      for (const line of out.trim().split('\n')) {
        const pid = parseInt(line, 10);
        if (!isNaN(pid)) result.pids.push(pid);
      }
    }
  } catch { /* process listing may fail */ }

  result.found = result.pids.length > 0;
  return result;
}

// ─── Conflicting VPN Detection ──────────────────────────────────────────────

/** Known VPN processes that conflict with WireGuard routing. */
const KNOWN_VPN_PROCESSES = [
  { name: 'NordVPN', process: 'nordvpn', service: 'nordvpn-service' },
  { name: 'ExpressVPN', process: 'expressvpn', service: 'ExpressVpnService' },
  { name: 'Surfshark', process: 'surfshark', service: 'Surfshark' },
  { name: 'ProtonVPN', process: 'protonvpn', service: 'ProtonVPN Service' },
  { name: 'Mullvad', process: 'mullvad-vpn', service: 'mullvad' },
  { name: 'CyberGhost', process: 'cyberghost', service: 'CyberGhostVPN' },
  { name: 'PIA', process: 'pia-client', service: 'PrivateInternetAccessService' },
  { name: 'Windscribe', process: 'windscribe', service: 'WindscribeService' },
  { name: 'TunnelBear', process: 'tunnelbear', service: 'TunnelBearService' },
  { name: 'OpenVPN', process: 'openvpn', service: 'OpenVPNService' },
];

/**
 * Check for running VPN software that may conflict.
 * @returns {{ conflicts: Array<{ name: string, running: boolean }> }}
 */
export function checkVpnConflicts() {
  const conflicts = [];

  if (process.platform === 'win32') {
    try {
      const tasks = execSync('tasklist /NH /FO CSV', { encoding: 'utf8', timeout: 5000, stdio: 'pipe' }).toLowerCase();
      for (const vpn of KNOWN_VPN_PROCESSES) {
        if (tasks.includes(vpn.process.toLowerCase())) {
          conflicts.push({ name: vpn.name, running: true });
        }
      }
    } catch { /* tasklist may fail */ }
  } else {
    try {
      const ps = execSync('ps aux 2>/dev/null || ps -ef', { encoding: 'utf8', timeout: 3000, stdio: 'pipe' }).toLowerCase();
      for (const vpn of KNOWN_VPN_PROCESSES) {
        if (ps.includes(vpn.process.toLowerCase())) {
          conflicts.push({ name: vpn.name, running: true });
        }
      }
    } catch { /* ps may fail */ }
  }

  return { conflicts };
}

// ─── Port Conflict Detection ────────────────────────────────────────────────

/**
 * Check if common V2Ray SOCKS5 ports are in use.
 * @returns {{ conflicts: Array<{ port: number, inUse: boolean }> }}
 */
export function checkPortConflicts() {
  const portsToCheck = [10808, 10809, 10810]; // common V2Ray SOCKS ports
  const conflicts = [];

  try {
    if (process.platform === 'win32') {
      const netstat = execSync('netstat -ano', { encoding: 'utf8', timeout: 5000, stdio: 'pipe' });
      for (const port of portsToCheck) {
        if (netstat.includes(`:${port} `)) {
          conflicts.push({ port, inUse: true });
        }
      }
    } else {
      for (const port of portsToCheck) {
        try {
          execSync(`lsof -i :${port} -t 2>/dev/null`, { encoding: 'utf8', timeout: 3000, stdio: 'pipe' });
          conflicts.push({ port, inUse: true });
        } catch { /* port free */ }
      }
    }
  } catch { /* netstat may fail */ }

  return { conflicts };
}

// ─── Main Preflight Check ───────────────────────────────────────────────────

/**
 * Complete pre-flight system check. Run at app startup before any connection.
 *
 * Returns a structured report with:
 * - ok: boolean (true if everything is ready to connect)
 * - issues: array of { severity, message, action, autoFix }
 * - Each issue has a human-readable message and an actionable fix
 *
 * @param {object} [opts]
 * @param {boolean} [opts.autoClean=false] - Auto-clean orphaned tunnels/processes
 * @param {string} [opts.v2rayExePath] - Explicit V2Ray path
 * @returns {object} Pre-flight report
 */
export function preflight(opts = {}) {
  const issues = [];

  // ── 1. WireGuard ──
  if (!WG_AVAILABLE) {
    issues.push({
      severity: 'warning',
      component: 'wireguard',
      message: 'WireGuard is not installed.',
      detail: 'WireGuard nodes (faster, more reliable) will not work. V2Ray nodes still work without it.',
      action: process.platform === 'win32'
        ? 'Download and install from: https://download.wireguard.com/windows-client/wireguard-installer.exe'
        : process.platform === 'darwin'
          ? 'Run: brew install wireguard-tools'
          : 'Run: sudo apt install wireguard (Ubuntu/Debian) or sudo dnf install wireguard-tools (Fedora)',
      autoFix: false,
    });
  } else if (!IS_ADMIN) {
    issues.push({
      severity: 'warning',
      component: 'wireguard',
      message: 'WireGuard requires administrator privileges.',
      detail: 'WireGuard is installed but the app is not running as admin. WireGuard nodes will fail. V2Ray nodes still work.',
      action: process.platform === 'win32'
        ? 'Right-click your app → "Run as administrator", or add a manifest with requireAdministrator.'
        : 'Run with: sudo node your-app.js',
      autoFix: false,
    });
  }

  // ── 2. V2Ray ──
  const findV2Ray = () => {
    const paths = [
      opts.v2rayExePath,
      process.env.V2RAY_PATH,
      './bin/v2ray.exe', './bin/v2ray',
      '../bin/v2ray.exe', '../bin/v2ray',
    ].filter(Boolean);
    for (const p of paths) { if (existsSync(p)) return p; }
    try {
      const cmd = process.platform === 'win32' ? 'where v2ray.exe' : 'which v2ray';
      return execSync(cmd, { encoding: 'utf8', stdio: 'pipe', timeout: 3000 }).trim().split('\n')[0];
    } catch { return null; }
  };

  const v2path = findV2Ray();
  if (!v2path) {
    issues.push({
      severity: 'warning',
      component: 'v2ray',
      message: 'V2Ray binary not found.',
      detail: 'V2Ray nodes will not work. WireGuard nodes still work without it.',
      action: 'Run: node js-sdk/setup.js (auto-downloads V2Ray 5.2.1), or place v2ray.exe + geoip.dat + geosite.dat in a bin/ folder.',
      autoFix: false,
    });
  }

  // ── 3. Neither installed ──
  if (!WG_AVAILABLE && !v2path) {
    // Upgrade to error — no protocol available at all
    issues.push({
      severity: 'error',
      component: 'protocols',
      message: 'No VPN protocol available. Cannot connect to any node.',
      detail: 'Neither WireGuard nor V2Ray is installed. You need at least one.',
      action: 'Install WireGuard (recommended) and/or run: node js-sdk/setup.js to download V2Ray.',
      autoFix: false,
    });
  }

  // ── 4. Orphaned WireGuard tunnels ──
  const orphanedWg = checkOrphanedTunnels();
  if (orphanedWg.found) {
    if (opts.autoClean) {
      const cleaned = cleanOrphanedTunnels();
      if (cleaned.errors.length > 0) {
        issues.push({
          severity: 'warning',
          component: 'wireguard',
          message: `Found ${orphanedWg.tunnels.length} orphaned tunnel(s), cleaned ${cleaned.cleaned}. ${cleaned.errors[0]}`,
          detail: 'Stale tunnels from a previous crash. Some could not be removed automatically.',
          action: process.platform === 'win32'
            ? `Run as admin: sc stop WireGuardTunnel$${orphanedWg.tunnels[0]} && sc delete WireGuardTunnel$${orphanedWg.tunnels[0]}`
            : `Run: sudo wg-quick down ${orphanedWg.tunnels[0]}`,
          autoFix: false,
        });
      }
      // If all cleaned, no issue to report
    } else {
      issues.push({
        severity: 'warning',
        component: 'wireguard',
        message: `Found ${orphanedWg.tunnels.length} orphaned WireGuard tunnel(s): ${orphanedWg.tunnels.join(', ')}`,
        detail: 'Left over from a previous crash or app exit. Will block new connections. Set autoClean: true to fix automatically.',
        action: 'Call preflight({ autoClean: true }) or cleanOrphanedTunnels() to remove them.',
        autoFix: true,
      });
    }
  }

  // ── 5. Orphaned V2Ray processes ──
  const orphanedV2 = checkOrphanedV2Ray();
  if (orphanedV2.found) {
    issues.push({
      severity: 'info',
      component: 'v2ray',
      message: `Found ${orphanedV2.pids.length} V2Ray process(es) running: PIDs ${orphanedV2.pids.join(', ')}`,
      detail: 'May be from a previous session or another application. These consume SOCKS5 ports.',
      action: 'If these are unexpected, they will be replaced on next connection. No action needed unless ports conflict.',
      autoFix: false,
    });
  }

  // ── 6. Conflicting VPN software ──
  const vpnCheck = checkVpnConflicts();
  if (vpnCheck.conflicts.length > 0) {
    const names = vpnCheck.conflicts.map(c => c.name).join(', ');
    issues.push({
      severity: 'warning',
      component: 'system',
      message: `Other VPN software detected: ${names}`,
      detail: 'Running multiple VPNs simultaneously can cause routing conflicts, DNS leaks, or connection failures. Disconnect the other VPN before connecting.',
      action: `Disconnect ${names} before using this app.`,
      autoFix: false,
    });
  }

  // ── 7. Port conflicts ──
  const portCheck = checkPortConflicts();
  if (portCheck.conflicts.length > 0) {
    const ports = portCheck.conflicts.map(c => c.port).join(', ');
    issues.push({
      severity: 'info',
      component: 'v2ray',
      message: `SOCKS5 port(s) already in use: ${ports}`,
      detail: 'V2Ray will use a random port to avoid conflicts. This is usually fine.',
      action: 'No action needed — SDK uses random ports. If you need a specific port, close the process using it.',
      autoFix: false,
    });
  }

  // ── Summary ──
  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');

  return {
    ok: errors.length === 0,
    ready: {
      wireguard: WG_AVAILABLE && IS_ADMIN,
      v2ray: !!v2path,
      anyProtocol: (WG_AVAILABLE && IS_ADMIN) || !!v2path,
    },
    issues,
    summary: errors.length === 0 && warnings.length === 0
      ? 'All checks passed. Ready to connect.'
      : errors.length > 0
        ? `${errors.length} error(s), ${warnings.length} warning(s). Fix errors before connecting.`
        : `${warnings.length} warning(s). Can still connect with available protocols.`,
  };
}
