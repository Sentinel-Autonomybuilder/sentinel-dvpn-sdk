/**
 * Security — kill switch, DNS leak prevention.
 *
 * Controls firewall rules and DNS settings to prevent traffic leaks
 * when the VPN tunnel is active.
 */

import { execFileSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';

import { _defaultState } from './state.js';
import { saveState } from '../state.js';
import { TunnelError } from '../errors.js';

// ─── Kill Switch (Firewall / Packet Filter) ────────────────────────────────

let _killSwitchEnabled = false;

/**
 * Enable kill switch — blocks all non-tunnel traffic.
 * Windows: netsh advfirewall, macOS: pfctl, Linux: iptables.
 * Call after WireGuard tunnel is installed.
 * @param {string} serverEndpoint - WireGuard server "IP:PORT"
 * @param {string} [tunnelName='wgsent0'] - WireGuard interface name
 */
export function enableKillSwitch(serverEndpoint, tunnelName = 'wgsent0') {
  const [serverIp, serverPort] = serverEndpoint.split(':');

  if (process.platform === 'win32') {
    // Windows: netsh advfirewall
    // Block all outbound by default
    execFileSync('netsh', ['advfirewall', 'set', 'allprofiles', 'firewallpolicy', 'blockinbound,blockoutbound'], { stdio: 'pipe' });

    // Wrap allow rules in try-catch — if any fail after block-all, restore default policy
    // to prevent permanent internet loss from partial firewall state.
    try {
      // Allow tunnel interface
      execFileSync('netsh', ['advfirewall', 'firewall', 'add', 'rule', 'name=SentinelVPN-Allow-Tunnel', 'dir=out', `interface=${tunnelName}`, 'action=allow'], { stdio: 'pipe' });

      // Allow WireGuard endpoint (UDP to server)
      execFileSync('netsh', ['advfirewall', 'firewall', 'add', 'rule', 'name=SentinelVPN-Allow-WG-Endpoint', 'dir=out', 'action=allow', 'protocol=udp', `remoteip=${serverIp}`, `remoteport=${serverPort}`], { stdio: 'pipe' });

      // Allow loopback
      execFileSync('netsh', ['advfirewall', 'firewall', 'add', 'rule', 'name=SentinelVPN-Allow-Loopback', 'dir=out', 'action=allow', 'remoteip=127.0.0.1'], { stdio: 'pipe' });

      // Allow DHCP
      execFileSync('netsh', ['advfirewall', 'firewall', 'add', 'rule', 'name=SentinelVPN-Allow-DHCP', 'dir=out', 'action=allow', 'protocol=udp', 'localport=68', 'remoteport=67'], { stdio: 'pipe' });

      // Allow DNS only through tunnel
      execFileSync('netsh', ['advfirewall', 'firewall', 'add', 'rule', 'name=SentinelVPN-Allow-DNS-Tunnel', 'dir=out', 'action=allow', 'protocol=udp', 'remoteip=10.8.0.1', 'remoteport=53'], { stdio: 'pipe' });

      // Block IPv6 (prevent leaks)
      execFileSync('netsh', ['advfirewall', 'firewall', 'add', 'rule', 'name=SentinelVPN-Block-IPv6', 'dir=out', 'action=block', 'protocol=any', 'remoteip=::/0'], { stdio: 'pipe' });
    } catch (err) {
      // Emergency restore — unblock outbound so user isn't locked out
      try { execFileSync('netsh', ['advfirewall', 'set', 'allprofiles', 'firewallpolicy', 'blockinbound,allowoutbound'], { stdio: 'pipe' }); } catch { /* last resort */ }
      _killSwitchEnabled = false;
      throw new TunnelError('KILL_SWITCH_FAILED', `Kill switch failed: ${err.message}`);
    }

  } else if (process.platform === 'darwin') {
    // macOS: pfctl (packet filter)
    const pfRules = [
      '# Sentinel VPN Kill Switch',
      'block out all',
      `pass out on ${tunnelName} all`,
      `pass out proto udp from any to ${serverIp} port ${serverPort}`,
      'pass out on lo0 all',
      'pass out proto udp from any port 68 to any port 67',
      'pass out proto udp from any to 10.8.0.1 port 53',
      'block out inet6 all',
    ].join('\n') + '\n';

    const pfPath = '/tmp/sentinel-killswitch.conf';
    writeFileSync(pfPath, pfRules, { mode: 0o600 });

    // Save current pf state for restore
    try { execFileSync('pfctl', ['-sr'], { encoding: 'utf8', stdio: 'pipe' }); } catch { /* may not have existing rules */ }

    // Load rules and enable pf
    execFileSync('pfctl', ['-f', pfPath], { stdio: 'pipe' });
    execFileSync('pfctl', ['-e'], { stdio: 'pipe' });

  } else {
    // Linux: iptables
    // Flush existing sentinel rules first
    try { execFileSync('iptables', ['-D', 'OUTPUT', '-m', 'comment', '--comment', 'sentinel-vpn', '-j', 'DROP'], { stdio: 'pipe' }); } catch { /* rule may not exist */ }

    // Allow loopback
    execFileSync('iptables', ['-A', 'OUTPUT', '-o', 'lo', '-j', 'ACCEPT', '-m', 'comment', '--comment', 'sentinel-vpn'], { stdio: 'pipe' });

    // Allow tunnel interface
    execFileSync('iptables', ['-A', 'OUTPUT', '-o', tunnelName, '-j', 'ACCEPT', '-m', 'comment', '--comment', 'sentinel-vpn'], { stdio: 'pipe' });

    // Allow WireGuard server endpoint
    execFileSync('iptables', ['-A', 'OUTPUT', '-d', serverIp, '-p', 'udp', '--dport', serverPort, '-j', 'ACCEPT', '-m', 'comment', '--comment', 'sentinel-vpn'], { stdio: 'pipe' });

    // Allow DHCP
    execFileSync('iptables', ['-A', 'OUTPUT', '-p', 'udp', '--sport', '68', '--dport', '67', '-j', 'ACCEPT', '-m', 'comment', '--comment', 'sentinel-vpn'], { stdio: 'pipe' });

    // Allow DNS only through tunnel
    execFileSync('iptables', ['-A', 'OUTPUT', '-d', '10.8.0.1', '-p', 'udp', '--dport', '53', '-j', 'ACCEPT', '-m', 'comment', '--comment', 'sentinel-vpn'], { stdio: 'pipe' });

    // Block everything else
    execFileSync('iptables', ['-A', 'OUTPUT', '-j', 'DROP', '-m', 'comment', '--comment', 'sentinel-vpn'], { stdio: 'pipe' });

    // Block IPv6
    try { execFileSync('ip6tables', ['-A', 'OUTPUT', '-j', 'DROP', '-m', 'comment', '--comment', 'sentinel-vpn'], { stdio: 'pipe' }); } catch { /* ip6tables may not be available */ }
  }

  _killSwitchEnabled = true;
  // Persist kill switch state — survives crash so recoverOrphans() can restore internet
  try {
    const conn = _defaultState.connection || {};
    saveState({ sessionId: conn.sessionId, serviceType: conn.serviceType, nodeAddress: conn.nodeAddress, killSwitchEnabled: true });
  } catch {} // best-effort
}

/**
 * Disable kill switch — restore normal routing.
 * Windows: removes netsh rules, macOS: disables pfctl, Linux: removes iptables rules.
 */
export function disableKillSwitch() {
  if (!_killSwitchEnabled) return;

  if (process.platform === 'win32') {
    // Windows: remove firewall rules
    const rules = [
      'SentinelVPN-Allow-Tunnel',
      'SentinelVPN-Allow-WG-Endpoint',
      'SentinelVPN-Allow-Loopback',
      'SentinelVPN-Allow-DHCP',
      'SentinelVPN-Allow-DNS-Tunnel',
      'SentinelVPN-Block-IPv6',
    ];
    for (const rule of rules) {
      try { execFileSync('netsh', ['advfirewall', 'firewall', 'delete', 'rule', `name=${rule}`], { stdio: 'pipe' }); } catch { /* rule may not exist */ }
    }

    // Restore default outbound policy
    try { execFileSync('netsh', ['advfirewall', 'set', 'allprofiles', 'firewallpolicy', 'blockinbound,allowoutbound'], { stdio: 'pipe' }); } catch { /* best effort */ }

  } else if (process.platform === 'darwin') {
    // macOS: disable pf and remove temp rules
    try { execFileSync('pfctl', ['-d'], { stdio: 'pipe' }); } catch { /* pf may already be disabled */ }
    try { unlinkSync('/tmp/sentinel-killswitch.conf'); } catch { /* file may not exist */ }

  } else {
    // Linux: remove all sentinel-vpn rules
    let hasRules = true;
    while (hasRules) {
      try {
        execFileSync('iptables', ['-D', 'OUTPUT', '-m', 'comment', '--comment', 'sentinel-vpn', '-j', 'ACCEPT'], { stdio: 'pipe' });
      } catch {
        hasRules = false;
      }
    }
    try { execFileSync('iptables', ['-D', 'OUTPUT', '-m', 'comment', '--comment', 'sentinel-vpn', '-j', 'DROP'], { stdio: 'pipe' }); } catch { /* rule may not exist */ }
    try { execFileSync('ip6tables', ['-D', 'OUTPUT', '-m', 'comment', '--comment', 'sentinel-vpn', '-j', 'DROP'], { stdio: 'pipe' }); } catch { /* rule may not exist */ }
  }

  _killSwitchEnabled = false;
  // Persist cleared kill switch state
  try {
    const conn = _defaultState.connection || {};
    saveState({ sessionId: conn.sessionId, serviceType: conn.serviceType, nodeAddress: conn.nodeAddress, killSwitchEnabled: false });
  } catch {} // best-effort
}

/** Check if kill switch is enabled */
export function isKillSwitchEnabled() { return _killSwitchEnabled; }

// ─── DNS Leak Prevention ────────────────────────────────────────────────────

/**
 * Enable DNS leak prevention by forcing all DNS through the VPN tunnel.
 * Windows: netsh interface ipv4 set dnsservers + firewall rules
 * macOS: networksetup -setdnsservers
 * Linux: write /etc/resolv.conf
 * @param {string} [dnsServer='10.8.0.1'] - DNS server inside the tunnel
 * @param {string} [tunnelInterface='wgsent0'] - WireGuard tunnel interface name
 */
export function enableDnsLeakPrevention(dnsServer = '10.8.0.1', tunnelInterface = 'wgsent0') {
  const platform = process.platform;
  if (platform === 'win32') {
    // Set DNS on all interfaces to tunnel DNS
    execFileSync('netsh', ['interface', 'ipv4', 'set', 'dnsservers', tunnelInterface, 'static', dnsServer, 'primary'], { stdio: 'pipe' });
    // Block DNS on non-tunnel interfaces
    execFileSync('netsh', ['advfirewall', 'firewall', 'add', 'rule',
      'name=SentinelDNSBlock', 'dir=out', 'protocol=udp', 'remoteport=53',
      'action=block'], { stdio: 'pipe' });
    execFileSync('netsh', ['advfirewall', 'firewall', 'add', 'rule',
      'name=SentinelDNSAllow', 'dir=out', 'protocol=udp', 'remoteport=53',
      'interface=' + tunnelInterface, 'action=allow'], { stdio: 'pipe' });
  } else if (platform === 'darwin') {
    // macOS: set DNS via networksetup for all services
    const services = execFileSync('networksetup', ['-listallnetworkservices'], { encoding: 'utf8' })
      .split('\n').filter(s => s && !s.startsWith('*'));
    for (const svc of services) {
      try { execFileSync('networksetup', ['-setdnsservers', svc.trim(), dnsServer], { stdio: 'pipe' }); } catch { /* best effort */ }
    }
  } else {
    // Linux: backup and overwrite resolv.conf
    try { execFileSync('cp', ['/etc/resolv.conf', '/etc/resolv.conf.sentinel.bak'], { stdio: 'pipe' }); } catch { /* backup may fail if file missing */ }
    writeFileSync('/etc/resolv.conf', `nameserver ${dnsServer}\n`);
  }
}

/**
 * Disable DNS leak prevention and restore normal DNS resolution.
 * Windows: removes firewall rules, resets DNS to DHCP
 * macOS: clears DNS overrides
 * Linux: restores /etc/resolv.conf from backup
 */
export function disableDnsLeakPrevention() {
  const platform = process.platform;
  if (platform === 'win32') {
    try { execFileSync('netsh', ['advfirewall', 'firewall', 'delete', 'rule', 'name=SentinelDNSBlock'], { stdio: 'pipe' }); } catch { /* rule may not exist */ }
    try { execFileSync('netsh', ['advfirewall', 'firewall', 'delete', 'rule', 'name=SentinelDNSAllow'], { stdio: 'pipe' }); } catch { /* rule may not exist */ }
    // Reset DNS to DHCP
    try { execFileSync('netsh', ['interface', 'ipv4', 'set', 'dnsservers', 'Wi-Fi', 'dhcp'], { stdio: 'pipe' }); } catch { /* interface may not exist */ }
    try { execFileSync('netsh', ['interface', 'ipv4', 'set', 'dnsservers', 'Ethernet', 'dhcp'], { stdio: 'pipe' }); } catch { /* interface may not exist */ }
  } else if (platform === 'darwin') {
    const services = execFileSync('networksetup', ['-listallnetworkservices'], { encoding: 'utf8' })
      .split('\n').filter(s => s && !s.startsWith('*'));
    for (const svc of services) {
      try { execFileSync('networksetup', ['-setdnsservers', svc.trim(), 'empty'], { stdio: 'pipe' }); } catch { /* best effort */ }
    }
  } else {
    try { execFileSync('cp', ['/etc/resolv.conf.sentinel.bak', '/etc/resolv.conf'], { stdio: 'pipe' }); } catch { /* backup may not exist */ }
  }
}
