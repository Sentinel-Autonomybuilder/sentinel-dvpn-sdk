/**
 * Sentinel SDK — App Settings Persistence
 *
 * Typed settings object with defaults, disk persistence, and atomic writes.
 * Covers: DNS, tunnel, session defaults, polling intervals.
 * Every setting has a sane default — apps can use this out of the box.
 *
 * Usage:
 *   import { loadAppSettings, saveAppSettings } from './app-settings.js';
 *   const settings = loadAppSettings();
 *   settings.dnsPreset = 'google';
 *   saveAppSettings(settings);
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import path from 'path';
import os from 'os';

const SETTINGS_DIR = path.join(os.homedir(), '.sentinel-sdk');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'app-settings.json');

// ─── Default Settings ───────────────────────────────────────────────────────

/** All settings with their defaults. */
export const APP_SETTINGS_DEFAULTS = Object.freeze({
  // Network
  dnsPreset: 'handshake',        // 'handshake' | 'google' | 'cloudflare' | 'custom'
  customDns: '',                  // Custom DNS IPs (comma-separated)

  // Tunnel
  fullTunnel: true,               // Route all traffic through VPN
  systemProxy: false,             // Set OS SOCKS proxy for V2Ray
  killSwitch: false,              // Block all traffic if tunnel drops
  wgMtu: 1420,                    // WireGuard MTU (1280-1500)
  wgKeepalive: 25,               // WireGuard keepalive seconds (15-60)

  // Session
  defaultGigabytes: 1,            // Default GB amount for per-GB sessions
  defaultHours: 1,                // Default hour amount for hourly sessions
  preferHourly: false,            // Prefer hourly pricing when available
  protocolPreference: 'auto',     // 'auto' | 'wireguard' | 'v2ray'

  // Polling (seconds)
  statusPollSec: 3,               // Connection status check
  ipCheckSec: 60,                 // Public IP check
  balanceCheckSec: 300,           // Wallet balance refresh (5 min)
  allocationCheckSec: 120,        // Session allocation refresh (2 min)

  // Plan
  planProbeMax: 500,              // Max plan ID to probe in discoverPlans

  // Favorites
  favoriteNodes: [],              // Array of sentnode1... addresses

  // Last connection
  lastNodeAddress: null,          // For quick reconnect
  lastServiceType: null,          // 'wireguard' | 'v2ray'
});

// ─── Load / Save ────────────────────────────────────────────────────────────

/**
 * Load app settings from disk. Returns defaults for missing/corrupt files.
 * @returns {object} Settings object (mutate + pass to saveAppSettings)
 */
export function loadAppSettings() {
  try {
    if (existsSync(SETTINGS_FILE)) {
      const raw = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
      // Merge with defaults — new settings get defaults, removed settings get dropped
      return { ...APP_SETTINGS_DEFAULTS, ...raw };
    }
  } catch { /* corrupt file — return defaults */ }
  return { ...APP_SETTINGS_DEFAULTS };
}

/**
 * Save app settings to disk (atomic write).
 * @param {object} settings - Settings object to save
 */
export function saveAppSettings(settings) {
  try {
    if (!existsSync(SETTINGS_DIR)) mkdirSync(SETTINGS_DIR, { recursive: true });
    const tmpFile = SETTINGS_FILE + '.tmp';
    writeFileSync(tmpFile, JSON.stringify(settings, null, 2));
    renameSync(tmpFile, SETTINGS_FILE);
  } catch { /* non-fatal */ }
}

/**
 * Reset all settings to defaults.
 */
export function resetAppSettings() {
  saveAppSettings({ ...APP_SETTINGS_DEFAULTS });
}
