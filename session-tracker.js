/**
 * Sentinel SDK — Session Payment Mode Tracker
 *
 * The chain doesn't distinguish GB-based from hourly sessions.
 * This persists the payment mode per session ID so apps can
 * show the correct pricing model after restart.
 *
 * Usage:
 *   import { trackSession, getSessionMode, getAllTrackedSessions } from './session-tracker.js';
 *   trackSession('37546368', 'gb');      // after connectDirect with gigabytes
 *   trackSession('37546652', 'hour');    // after connectDirect with hours
 *   trackSession('37547890', 'plan');    // after connectViaPlan
 *   getSessionMode('37546368');          // → 'gb'
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';

const SESSION_DIR = path.join(os.homedir(), '.sentinel-sdk');
const SESSION_FILE = path.join(SESSION_DIR, 'session-modes.json');

let _modes = null; // lazy load

function _load() {
  if (_modes) return _modes;
  try {
    if (existsSync(SESSION_FILE)) {
      _modes = JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
    }
  } catch { /* corrupt file — start fresh */ }
  _modes = _modes || {};
  return _modes;
}

function _save() {
  try {
    if (!existsSync(SESSION_DIR)) mkdirSync(SESSION_DIR, { recursive: true });
    writeFileSync(SESSION_FILE, JSON.stringify(_modes, null, 2));
  } catch { /* non-fatal */ }
}

/**
 * Track payment mode for a session.
 * @param {string|number|bigint} sessionId
 * @param {'gb'|'hour'|'plan'} mode
 */
export function trackSession(sessionId, mode) {
  _load();
  _modes[String(sessionId)] = mode;
  _save();
}

/**
 * Get payment mode for a session.
 * @param {string|number|bigint} sessionId
 * @returns {'gb'|'hour'|'plan'} Defaults to 'gb' for unknown sessions
 */
export function getSessionMode(sessionId) {
  _load();
  return _modes[String(sessionId)] || 'gb';
}

/**
 * Get all tracked sessions.
 * @returns {Record<string, 'gb'|'hour'|'plan'>}
 */
export function getAllTrackedSessions() {
  return { ..._load() };
}

/**
 * Clear tracking for a session.
 * @param {string|number|bigint} sessionId
 */
export function clearSessionMode(sessionId) {
  _load();
  delete _modes[String(sessionId)];
  _save();
}
