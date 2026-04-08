/**
 * System Proxy — set/clear SOCKS proxy and port availability checks.
 *
 * Manages system-level proxy settings so browser/OS traffic goes through V2Ray.
 */

import { execFileSync } from 'child_process';
import { createServer } from 'net';

import { _defaultState } from './state.js';

// ─── System Proxy (for V2Ray SOCKS5) ─────────────────────────────────────────

const WIN_REG = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

// Module-level fallback for saved proxy state — survives state object resets.
// Stores parsed values: { platform, proxyEnable: 0|1, proxyServer: string|null }
let _savedProxyState = null;

/** Parse ProxyEnable REG_DWORD value from reg query output. Returns 0 or 1. */
function _parseProxyEnable(regOutput) {
  // Output format: "    ProxyEnable    REG_DWORD    0x1" or "0x0" or "0x00000001"
  const match = regOutput.match(/ProxyEnable\s+REG_DWORD\s+(0x[0-9a-fA-F]+)/);
  if (!match) return 0;
  return parseInt(match[1], 16) !== 0 ? 1 : 0;
}

/** Parse ProxyServer REG_SZ value from reg query output. Returns string or null. */
function _parseProxyServer(regOutput) {
  const match = regOutput.match(/ProxyServer\s+REG_SZ\s+(.+)/);
  return match ? match[1].trim() : null;
}

/**
 * Set system SOCKS proxy so browser/system traffic goes through V2Ray.
 * Windows: registry (Internet Settings). macOS: networksetup. Linux: gsettings (GNOME).
 *
 * IMPORTANT: Saves the current proxy configuration BEFORE modifying it, so
 * clearSystemProxy() can restore the original state (e.g., corporate proxy).
 */
export function setSystemProxy(socksPort, state) {
  const _state = state || _defaultState;
  const port = String(Math.floor(Number(socksPort))); // sanitize to numeric string
  try {
    if (process.platform === 'win32') {
      // Save current proxy state BEFORE modifying — restored in clearSystemProxy()
      // This preserves corporate/custom proxies that were configured before Sentinel.
      let proxyEnable = 0;
      let proxyServer = null;
      try {
        const enableOut = execFileSync('reg', ['query', WIN_REG, '/v', 'ProxyEnable'], { encoding: 'utf8', stdio: 'pipe' });
        proxyEnable = _parseProxyEnable(enableOut);
      } catch { /* ProxyEnable not set — defaults to disabled */ }
      try {
        const serverOut = execFileSync('reg', ['query', WIN_REG, '/v', 'ProxyServer'], { encoding: 'utf8', stdio: 'pipe' });
        proxyServer = _parseProxyServer(serverOut);
      } catch { /* ProxyServer not set — no previous proxy server */ }

      const saved = { platform: 'win32', proxyEnable, proxyServer };
      _state.savedProxyState = saved;
      _savedProxyState = saved; // Module-level fallback

      // Now set Sentinel's SOCKS proxy
      execFileSync('reg', ['add', WIN_REG, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '1', '/f'], { stdio: 'pipe' });
      execFileSync('reg', ['add', WIN_REG, '/v', 'ProxyServer', '/t', 'REG_SZ', '/d', `socks=127.0.0.1:${port}`, '/f'], { stdio: 'pipe' });
    } else if (process.platform === 'darwin') {
      // macOS: set SOCKS proxy on all network services
      const services = execFileSync('networksetup', ['-listallnetworkservices'], { encoding: 'utf8', stdio: 'pipe' })
        .split('\n').filter(s => s && !s.startsWith('*') && !s.startsWith('An asterisk'));
      for (const svc of services) {
        try { execFileSync('networksetup', ['-setsocksfirewallproxy', svc, '127.0.0.1', port], { stdio: 'pipe' }); } catch {}
        try { execFileSync('networksetup', ['-setsocksfirewallproxystate', svc, 'on'], { stdio: 'pipe' }); } catch {}
      }
    } else {
      // Linux: GNOME gsettings (most common desktop)
      try {
        execFileSync('gsettings', ['set', 'org.gnome.system.proxy', 'mode', 'manual'], { stdio: 'pipe' });
        execFileSync('gsettings', ['set', 'org.gnome.system.proxy.socks', 'host', '127.0.0.1'], { stdio: 'pipe' });
        execFileSync('gsettings', ['set', 'org.gnome.system.proxy.socks', 'port', port], { stdio: 'pipe' });
      } catch {} // gsettings not available (headless/non-GNOME) — silent no-op
    }
    _state.systemProxy = true;
  } catch (e) { console.warn('[sentinel-sdk] setSystemProxy warning:', e.message); }
}

/**
 * Clear system proxy — restores the ORIGINAL proxy state from before setSystemProxy().
 * If the user had a corporate proxy (ProxyEnable=1 + ProxyServer=...), it is restored.
 * If the user had no proxy (ProxyEnable=0), proxy is disabled and ProxyServer removed.
 * Always call on disconnect/exit. Safe to call multiple times.
 */
export function clearSystemProxy(state) {
  const _state = state || _defaultState;
  try {
    if (process.platform === 'win32') {
      // Use state-level saved proxy, fall back to module-level backup
      const saved = _state.savedProxyState || _savedProxyState;

      if (saved?.platform === 'win32' && saved.proxyEnable === 1) {
        // User HAD a proxy enabled before — restore their ProxyEnable + ProxyServer
        execFileSync('reg', ['add', WIN_REG, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '1', '/f'], { stdio: 'pipe' });
        if (saved.proxyServer) {
          execFileSync('reg', ['add', WIN_REG, '/v', 'ProxyServer', '/t', 'REG_SZ', '/d', saved.proxyServer, '/f'], { stdio: 'pipe' });
        } else {
          // ProxyEnable was 1 but no ProxyServer — unusual but restore faithfully
          try { execFileSync('reg', ['delete', WIN_REG, '/v', 'ProxyServer', '/f'], { stdio: 'pipe' }); } catch {}
        }
      } else {
        // User had NO proxy before (ProxyEnable=0 or no saved state) — disable
        execFileSync('reg', ['add', WIN_REG, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '0', '/f'], { stdio: 'pipe' });
        if (saved?.proxyServer) {
          // Restore original ProxyServer value even if disabled — some apps check it
          execFileSync('reg', ['add', WIN_REG, '/v', 'ProxyServer', '/t', 'REG_SZ', '/d', saved.proxyServer, '/f'], { stdio: 'pipe' });
        } else {
          try { execFileSync('reg', ['delete', WIN_REG, '/v', 'ProxyServer', '/f'], { stdio: 'pipe' }); } catch {} // may not exist
        }
      }
    } else if (process.platform === 'darwin') {
      const services = execFileSync('networksetup', ['-listallnetworkservices'], { encoding: 'utf8', stdio: 'pipe' })
        .split('\n').filter(s => s && !s.startsWith('*') && !s.startsWith('An asterisk'));
      for (const svc of services) {
        try { execFileSync('networksetup', ['-setsocksfirewallproxystate', svc, 'off'], { stdio: 'pipe' }); } catch {}
      }
    } else {
      try { execFileSync('gsettings', ['set', 'org.gnome.system.proxy', 'mode', 'none'], { stdio: 'pipe' }); } catch {} // gsettings unavailable — headless/non-GNOME
    }
  } catch (e) { console.warn('[sentinel-sdk] clearSystemProxy warning:', e.message); }
  _state.systemProxy = false;
  _state.savedProxyState = null;
  _savedProxyState = null;
}

// ─── Port Availability ──────────────────────────────────────────────────────

/**
 * Check if a port is available. Use this at startup to detect port conflicts
 * from zombie processes (e.g., old server still running on the same port).
 * @param {number} port - Port to check
 * @returns {Promise<boolean>} true if port is free
 */
export function checkPortFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => { server.close(() => resolve(true)); });
    server.listen(port, '127.0.0.1');
  });
}
