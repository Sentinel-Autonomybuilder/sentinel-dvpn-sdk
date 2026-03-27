/**
 * Sentinel dVPN SDK — Local State Persistence
 *
 * Tracks active sessions, V2Ray PIDs, and WireGuard tunnel names across process restarts.
 * Also tracks session history to avoid reusing poisoned (failed handshake) sessions.
 * State is saved to ~/.sentinel-sdk/state.json.
 * Session history is saved to ~/.sentinel-sdk/sessions.json.
 * PID file at ~/.sentinel-sdk/app.pid for server process management.
 *
 * When the process crashes mid-connection:
 * - In-memory state (activeV2RayProc, activeWgTunnel) is lost
 * - The tunnel/proxy may still be running (WG service, v2ray.exe, system proxy)
 * - On next startup, loadState() + recoverOrphans() detects and cleans up
 *
 * Usage:
 *   import { saveState, loadState, clearState, recoverOrphans } from './state.js';
 *   import { markSessionPoisoned, isSessionPoisoned, getSessionHistory } from './state.js';
 *   import { writePidFile, checkPidFile, clearPidFile } from './state.js';
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, renameSync } from 'fs';
import { execSync, execFileSync } from 'child_process';
import path from 'path';
import os from 'os';

// ── State file validation (prevents command injection via poisoned state.json) ──
const STATE_SCHEMA = {
  sessionId:      v => v == null || /^\d+$/.test(String(v)),
  serviceType:    v => v == null || v === 'wireguard' || v === 'v2ray',
  v2rayPid:       v => v == null || (Number.isInteger(Number(v)) && Number(v) > 0),
  socksPort:      v => v == null || (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 65535),
  wgTunnelName:   v => v == null || /^[a-zA-Z0-9_-]{1,64}$/.test(v),
  systemProxySet: v => v == null || typeof v === 'boolean',
  nodeAddress:    v => v == null || /^sentnode1[a-z0-9]{38}$/.test(v),
  confPath:       v => v == null || (typeof v === 'string' && v.length <= 260 && (/^[a-zA-Z]:[\\\/][a-zA-Z0-9_.\-\\\/ ]+$/.test(v) || /^\/[a-zA-Z0-9_.\-\/ ]+$/.test(v))),
};

function validateStateValues(state) {
  for (const [field, validate] of Object.entries(STATE_SCHEMA)) {
    if (state[field] !== undefined && !validate(state[field])) {
      console.warn(`[sentinel-sdk] Corrupted state: invalid ${field} "${state[field]}" — skipping recovery`);
      return false;
    }
  }
  return true;
}

const STATE_DIR = path.join(os.homedir(), '.sentinel-sdk');
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const SESSIONS_FILE = path.join(STATE_DIR, 'sessions.json');
const PID_FILE = path.join(STATE_DIR, 'app.pid');

/**
 * Save current connection state to disk.
 * Call this after a successful connection.
 * @param {object} state
 * @param {string} state.sessionId - Active session ID
 * @param {string} state.serviceType - 'wireguard' | 'v2ray'
 * @param {number} state.v2rayPid - V2Ray process PID (if v2ray)
 * @param {number} state.socksPort - SOCKS5 port (if v2ray)
 * @param {string} state.wgTunnelName - WireGuard tunnel service name (if wireguard)
 * @param {boolean} state.systemProxySet - Whether Windows system proxy was set
 * @param {string} state.nodeAddress - Connected node address
 * @param {string} state.confPath - WireGuard config file path
 */
export function saveState(state) {
  try {
    mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
    // Strip unknown fields — only persist STATE_SCHEMA keys + metadata
    const ALLOWED_KEYS = new Set([...Object.keys(STATE_SCHEMA), 'savedAt', 'pid']);
    const cleaned = {};
    for (const [k, v] of Object.entries(state)) {
      if (ALLOWED_KEYS.has(k)) cleaned[k] = v;
    }
    const data = {
      ...cleaned,
      savedAt: new Date().toISOString(),
      pid: process.pid,
    };
    writeFileSync(STATE_FILE + '.tmp', JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(STATE_FILE + '.tmp', STATE_FILE);
  } catch (e) { console.warn('[sentinel-sdk] saveState warning:', e.message); }
}

/**
 * Load saved state from disk.
 * Returns null if no state file exists or it's corrupt.
 */
export function loadState() {
  try {
    if (!existsSync(STATE_FILE)) return null;
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Clear saved state (call after successful disconnect).
 */
export function clearState() {
  try {
    if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE);
  } catch (e) { console.warn('[sentinel-sdk] clearState warning:', e.message); }
}

/**
 * Detect and clean up orphaned tunnels/processes from a previous crash.
 * Call this at app startup after registerCleanupHandlers().
 *
 * Returns what was cleaned up (for logging).
 */
export function recoverOrphans() {
  const state = loadState();
  if (!state) return null;

  // Validate state values before using them in shell commands (prevents command injection via poisoned state.json)
  if (!validateStateValues(state)) {
    clearState();
    return { found: true, cleaned: ['Corrupted state file removed'] };
  }

  const recovered = { found: true, cleaned: [] };

  // Check if the process that saved the state is still running
  const savedPid = state.pid;
  let processAlive = false;
  if (savedPid) {
    try {
      process.kill(savedPid, 0); // signal 0 = check existence
      processAlive = true;
    } catch {
      processAlive = false;
    }
  }

  // If the original process is still running, don't touch anything
  if (processAlive) {
    return { found: true, cleaned: [], note: `Original process ${savedPid} still running` };
  }

  // Clean up orphaned V2Ray
  if (state.serviceType === 'v2ray' && state.v2rayPid) {
    try {
      if (process.platform === 'win32') {
        execFileSync('taskkill', ['/F', '/PID', String(state.v2rayPid)], { stdio: 'pipe', timeout: 5000 });
      } else {
        process.kill(state.v2rayPid, 'SIGKILL');
      }
      recovered.cleaned.push(`v2ray PID ${state.v2rayPid}`);
    } catch {} // already dead — expected if process exited naturally
  }

  // Clean up orphaned WireGuard tunnel
  if (state.serviceType === 'wireguard' && state.wgTunnelName) {
    try {
      if (process.platform === 'win32') {
        // Check if WireGuard service exists
        const out = execFileSync('sc', ['query', `WireGuardTunnel$${state.wgTunnelName}`], {
          encoding: 'utf8', timeout: 5000, stdio: 'pipe',
        });
        if (out.includes('RUNNING') || out.includes('STOPPED')) {
          // Find wireguard.exe
          const wgExe = ['C:\\Program Files\\WireGuard\\wireguard.exe', 'C:\\Program Files (x86)\\WireGuard\\wireguard.exe']
            .find(p => existsSync(p));
          if (wgExe) {
            execFileSync(wgExe, ['/uninstalltunnelservice', state.wgTunnelName], { timeout: 15000, stdio: 'pipe' });
            recovered.cleaned.push(`WireGuard tunnel ${state.wgTunnelName}`);
          }
        }
      }
    } catch (e) { console.warn('[sentinel-sdk] WG orphan cleanup warning:', e.message); }

    // Linux/macOS: use wg-quick to remove stale tunnel
    if (process.platform !== 'win32') {
      try {
        execFileSync('wg-quick', ['down', state.wgTunnelName], { timeout: 10000, stdio: 'pipe' });
        recovered.cleaned.push(`WireGuard tunnel ${state.wgTunnelName} (wg-quick down)`);
      } catch (e) { console.warn('[sentinel-sdk] wg-quick down warning:', e.message); }
    }
  }

  // Clean up orphaned system proxy
  if (state.systemProxySet) {
    try {
      if (process.platform === 'win32') {
        const REG = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
        execFileSync('reg', ['add', REG, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '0', '/f'], { stdio: 'pipe' });
        execFileSync('reg', ['delete', REG, '/v', 'ProxyServer', '/f'], { stdio: 'pipe' });
        recovered.cleaned.push('Windows system proxy');
      } else if (process.platform === 'darwin') {
        const services = execFileSync('networksetup', ['-listallnetworkservices'], { encoding: 'utf8', stdio: 'pipe' })
          .split('\n').filter(s => s && !s.startsWith('*') && !s.startsWith('An asterisk'));
        for (const svc of services) {
          try { execFileSync('networksetup', ['-setsocksfirewallproxystate', svc, 'off'], { stdio: 'pipe' }); } catch {} // service may not have proxy enabled
        }
        recovered.cleaned.push('macOS system proxy');
      } else {
        execFileSync('gsettings', ['set', 'org.gnome.system.proxy', 'mode', 'none'], { stdio: 'pipe' });
        recovered.cleaned.push('Linux system proxy (GNOME)');
      }
    } catch (e) { console.warn('[sentinel-sdk] proxy orphan cleanup warning:', e.message); }
  }

  // Clean up stale config file
  if (state.confPath && existsSync(state.confPath)) {
    try { unlinkSync(state.confPath); } catch (e) { console.warn('[sentinel-sdk] conf cleanup warning:', e.message); }
  }

  clearState();
  return recovered;
}

// ─── Session Tracking ────────────────────────────────────────────────────────

/**
 * Load session history from disk.
 * Returns { sessions: { [sessionId]: { status, nodeAddress, error?, timestamp } } }
 */
function loadSessions() {
  try {
    if (!existsSync(SESSIONS_FILE)) return { sessions: {} };
    return JSON.parse(readFileSync(SESSIONS_FILE, 'utf8'));
  } catch {
    return { sessions: {} };
  }
}

function saveSessions(data) {
  try {
    mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
    const tmpFile = SESSIONS_FILE + '.tmp';
    writeFileSync(tmpFile, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(tmpFile, SESSIONS_FILE);
  } catch {} // best-effort session tracking — non-fatal if write fails
}

/**
 * Mark a session as poisoned (handshake failed).
 * findExistingSession callers should skip poisoned sessions.
 * @param {string} sessionId
 * @param {string} nodeAddress
 * @param {string} error - Why it was poisoned
 */
export function markSessionPoisoned(sessionId, nodeAddress, error) {
  const data = loadSessions();
  data.sessions[String(sessionId)] = {
    status: 'poisoned',
    nodeAddress,
    error: error?.substring(0, 200),
    timestamp: new Date().toISOString(),
  };
  // Prune old entries (keep last 200)
  const entries = Object.entries(data.sessions);
  if (entries.length > 200) {
    const sorted = entries.sort((a, b) => new Date(b[1].timestamp) - new Date(a[1].timestamp));
    data.sessions = Object.fromEntries(sorted.slice(0, 200));
  }
  saveSessions(data);
}

/**
 * Mark a session as successfully connected.
 * @param {string} sessionId
 * @param {string} nodeAddress
 */
export function markSessionActive(sessionId, nodeAddress) {
  const data = loadSessions();
  data.sessions[String(sessionId)] = {
    status: 'active',
    nodeAddress,
    timestamp: new Date().toISOString(),
  };
  saveSessions(data);
}

/**
 * Check if a session was poisoned (handshake failed previously).
 * @param {string} sessionId
 * @returns {boolean}
 */
export function isSessionPoisoned(sessionId) {
  const data = loadSessions();
  return data.sessions[String(sessionId)]?.status === 'poisoned';
}

/**
 * Get full session history for debugging.
 * @returns {{ [sessionId]: { status, nodeAddress, error?, timestamp } }}
 */
export function getSessionHistory() {
  return loadSessions().sessions;
}

// ─── PID File ────────────────────────────────────────────────────────────────

/**
 * Write a PID file for the current process.
 * Use at server startup to enable clean restarts.
 * @param {string} [name='app'] - App name (creates ~/.sentinel-sdk/{name}.pid)
 * @returns {{ pidFile: string }}
 */
export function writePidFile(name = 'app') {
  try {
    mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
    const pidFile = path.join(STATE_DIR, `${name}.pid`);
    writeFileSync(pidFile, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), { encoding: 'utf8', mode: 0o600 });
    return { pidFile };
  } catch {
    return { pidFile: null };
  }
}

/**
 * Check if a previous instance is running from a PID file.
 * Returns { running: boolean, pid?: number } so the caller can decide what to do.
 * @param {string} [name='app'] - App name
 */
export function checkPidFile(name = 'app') {
  try {
    const pidFile = path.join(STATE_DIR, `${name}.pid`);
    if (!existsSync(pidFile)) return { running: false };
    const data = JSON.parse(readFileSync(pidFile, 'utf8'));
    const pid = data.pid;
    try {
      process.kill(pid, 0); // signal 0 = check existence
      return { running: true, pid, startedAt: data.startedAt };
    } catch {
      // Process is dead — stale PID file
      unlinkSync(pidFile);
      return { running: false, stalePid: pid };
    }
  } catch {
    return { running: false };
  }
}

/**
 * Remove the PID file (call on clean shutdown).
 * @param {string} [name='app'] - App name
 */
export function clearPidFile(name = 'app') {
  try {
    const pidFile = path.join(STATE_DIR, `${name}.pid`);
    if (existsSync(pidFile)) unlinkSync(pidFile);
  } catch {} // best-effort cleanup — non-fatal
}
