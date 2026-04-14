/**
 * Sentinel dVPN SDK — Session Manager
 *
 * Reusable session management class ported from the Node Tester's battle-tested
 * implementation. Provides:
 *   - Paginated session map (all active sessions for a wallet)
 *   - Session reuse (find existing session for a node)
 *   - Credential cache (disk-persistent WG keys / V2Ray UUIDs)
 *   - Session poisoning (track failed handshakes)
 *   - Duplicate payment guard (prevent double-paying in a run)
 *
 * Usage:
 *   import { SessionManager } from './session-manager.js';
 *   const mgr = new SessionManager('https://lcd.sentinel.co', 'sent1...');
 *   await mgr.buildSessionMap();
 *   const sid = await mgr.findExistingSession('sentnode1...');
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs';
import path from 'path';
import os from 'os';
import { ChainError, ErrorCodes } from './errors.js';
import { DEFAULT_LCD } from './defaults.js';
import { querySessions } from './chain/queries.js';
import { loadPoisonedKeys, savePoisonedKeys } from './state.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const STATE_DIR = path.join(os.homedir(), '.sentinel-sdk');
const CRED_FILE = path.join(STATE_DIR, 'session-credentials.json');

/** Default session map TTL: 5 minutes */
const DEFAULT_MAP_TTL = 5 * 60 * 1000;

// ─── SessionManager Class ────────────────────────────────────────────────────

/**
 * Manages session state for a wallet: session map, credential cache,
 * poisoning, and duplicate payment tracking.
 *
 * @example
 * const mgr = new SessionManager('https://lcd.sentinel.co', 'sent1abc...');
 * await mgr.buildSessionMap();
 * const sid = await mgr.findExistingSession('sentnode1xyz...');
 * if (sid) console.log(`Reuse session ${sid}`);
 */
export class SessionManager {
  /**
   * @param {string} lcdUrl - LCD endpoint URL (falls back to DEFAULT_LCD)
   * @param {string} walletAddress - Wallet address (sent1...)
   * @param {object} [options]
   * @param {number} [options.mapTtl=300000] - Session map cache TTL in ms (default 5 min)
   * @param {string} [options.credentialPath] - Custom path for credential cache file
   * @param {Function} [options.logger] - Optional logger function (msg) => void
   */
  constructor(lcdUrl, walletAddress, options = {}) {
    this._lcdUrl = lcdUrl || DEFAULT_LCD;
    this._walletAddress = walletAddress;
    this._mapTtl = options.mapTtl ?? DEFAULT_MAP_TTL;
    this._credPath = options.credentialPath || CRED_FILE;
    this._logger = options.logger || null;

    /** @type {Map<string, {sessionId: bigint, maxBytes: number, usedBytes: number}>|null} */
    this._sessionMap = null;
    this._sessionMapAt = 0;

    /** @type {Set<string>} Poisoned session keys: "nodeAddr:sessionId" */
    this._poisoned = new Set(loadPoisonedKeys());

    /** @type {Set<string>} Nodes paid this run */
    this._paidNodes = new Set();

    /** @type {object|null} In-memory credential cache (lazy-loaded from disk) */
    this._credentials = null;
  }

  // ─── Session Map ─────────────────────────────────────────────────────────

  /**
   * Fetch ALL active sessions for the wallet with full pagination.
   * Builds a Map<nodeAddr, {sessionId, maxBytes, usedBytes}> for O(1) lookups.
   * Skips exhausted sessions (used >= max), wrong-wallet sessions, and poisoned sessions.
   *
   * @param {string} [walletAddress] - Override wallet address (default: constructor value)
   * @returns {Promise<Map<string, {sessionId: bigint, maxBytes: number, usedBytes: number}>>}
   */
  async buildSessionMap(walletAddress) {
    const addr = walletAddress || this._walletAddress;
    if (!addr) {
      throw new ChainError(
        ErrorCodes.INVALID_OPTIONS,
        'buildSessionMap requires a wallet address',
      );
    }

    const map = new Map();

    let items;
    try {
      // RPC-first via chain/queries.js — returns flattened sessions
      const result = await querySessions(addr, this._lcdUrl, { status: '1' });
      items = result.items || [];
    } catch (err) {
      throw new ChainError(
        ErrorCodes.LCD_ERROR,
        `Failed to build session map: ${err.message}`,
        { walletAddress: addr, original: err.message },
      );
    }

    for (const s of items) {
      // querySessions returns flat sessions (base_session unwrapped)
      const bs = s.base_session || s;
      const nodeAddr = bs.node_address || bs.node;
      if (!nodeAddr) continue;

      const acct = bs.acc_address || bs.address;
      if (acct && acct !== addr) continue;
      // RPC returns status as number (1=active), LCD as string
      if (bs.status && bs.status !== 'active' && bs.status !== 1) continue;

      const maxBytes = parseInt(bs.max_bytes || '0');
      const used = parseInt(bs.download_bytes || '0') + parseInt(bs.upload_bytes || '0');
      if (maxBytes > 0 && used >= maxBytes) continue;

      const sid = BigInt(bs.id);
      if (this.isPoisoned(nodeAddr, String(sid))) continue;

      // Keep the session with the most remaining bandwidth per node
      const existing = map.get(nodeAddr);
      if (!existing || (maxBytes - used) > (existing.maxBytes - existing.usedBytes)) {
        map.set(nodeAddr, { sessionId: sid, maxBytes, usedBytes: used });
      }
    }

    this._sessionMap = map;
    this._sessionMapAt = Date.now();
    this._log(`Session map: ${map.size} reusable sessions (${items.length} fetched)`);
    return map;
  }

  /**
   * Find an existing reusable session for a node.
   * Auto-refreshes the session map if stale or missing.
   *
   * @param {string} nodeAddr - Node address (sentnode1...)
   * @returns {Promise<bigint|null>} Session ID or null
   */
  async findExistingSession(nodeAddr) {
    try {
      const now = Date.now();
      if (!this._sessionMap || now - this._sessionMapAt > this._mapTtl) {
        await this.buildSessionMap();
      }
      const entry = this._sessionMap?.get(nodeAddr);
      return entry ? entry.sessionId : null;
    } catch (err) {
      if (err?.name !== 'AbortError' && !/timeout|ECONNREFUSED|ENOTFOUND/i.test(err?.message || '')) {
        this._log(`findExistingSession error: ${err.message}`);
      }
      return null;
    }
  }

  /**
   * Invalidate the session map cache, forcing a full refetch on next access.
   */
  invalidateSessionMap() {
    this._sessionMap = null;
    this._sessionMapAt = 0;
  }

  /**
   * Manually add a session to the map (e.g. after batch payment creates new sessions).
   *
   * @param {string} nodeAddr - Node address
   * @param {bigint} sessionId - Session ID
   * @param {number} [maxBytes=1000000000] - Max bytes (default 1 GB)
   */
  addToSessionMap(nodeAddr, sessionId, maxBytes = 1_000_000_000) {
    if (!this._sessionMap) this._sessionMap = new Map();
    this._sessionMap.set(nodeAddr, { sessionId, maxBytes, usedBytes: 0 });
  }

  /**
   * Get the current session map (may be null if never built).
   *
   * @returns {Map<string, {sessionId: bigint, maxBytes: number, usedBytes: number}>|null}
   */
  getSessionMap() {
    return this._sessionMap;
  }

  // ─── Credential Cache (disk-persistent) ──────────────────────────────────

  /**
   * Save handshake credentials for a node (WG keys, V2Ray UUID, etc.).
   * Persists to disk at ~/.sentinel-sdk/session-credentials.json.
   *
   * @param {string} nodeAddr - Node address (sentnode1...)
   * @param {object} data - Credential data to save
   */
  saveCredential(nodeAddr, data) {
    this._loadCredentials();
    this._credentials[nodeAddr] = { ...data, savedAt: new Date().toISOString() };
    this._writeCredentials();
  }

  /**
   * Get cached credentials for a node.
   *
   * @param {string} nodeAddr - Node address
   * @returns {object|null} Credential data or null
   */
  getCredential(nodeAddr) {
    this._loadCredentials();
    return this._credentials[nodeAddr] || null;
  }

  /**
   * Clear cached credentials for a node.
   *
   * @param {string} nodeAddr - Node address
   */
  clearCredential(nodeAddr) {
    this._loadCredentials();
    delete this._credentials[nodeAddr];
    this._writeCredentials();
  }

  /**
   * Clear all cached credentials.
   */
  clearAllCredentials() {
    this._credentials = {};
    this._writeCredentials();
  }

  /** @private Load credential store from disk (lazy, once). */
  _loadCredentials() {
    if (this._credentials !== null) return;
    try {
      if (existsSync(this._credPath)) {
        this._credentials = JSON.parse(readFileSync(this._credPath, 'utf8'));
      } else {
        this._credentials = {};
      }
    } catch {
      this._credentials = {};
    }
  }

  /** @private Write credential store to disk with atomic rename. */
  _writeCredentials() {
    try {
      mkdirSync(path.dirname(this._credPath), { recursive: true, mode: 0o700 });
      const tmp = this._credPath + '.tmp';
      writeFileSync(tmp, JSON.stringify(this._credentials, null, 2), { encoding: 'utf8', mode: 0o600 });
      renameSync(tmp, this._credPath);
    } catch (err) {
      this._log(`Failed to write credentials: ${err.message}`);
    }
  }

  // ─── Session Poisoning ───────────────────────────────────────────────────

  /**
   * Mark a session as poisoned (failed handshake — should not be reused).
   *
   * @param {string} nodeAddr - Node address
   * @param {string|bigint} sessionId - Session ID
   */
  markPoisoned(nodeAddr, sessionId) {
    this._poisoned.add(`${nodeAddr}:${sessionId}`);
    savePoisonedKeys([...this._poisoned]);
  }

  /**
   * Check if a session is poisoned.
   *
   * @param {string} nodeAddr - Node address
   * @param {string|bigint} sessionId - Session ID
   * @returns {boolean}
   */
  isPoisoned(nodeAddr, sessionId) {
    return this._poisoned.has(`${nodeAddr}:${sessionId}`);
  }

  /**
   * Clear all poisoned session markers.
   */
  clearPoisonedSessions() {
    this._poisoned.clear();
    savePoisonedKeys([]);
  }

  // ─── Duplicate Payment Guard ─────────────────────────────────────────────

  /**
   * Mark a node as paid in this run (prevents double-paying).
   *
   * @param {string} nodeAddr - Node address
   */
  markPaid(nodeAddr) {
    this._paidNodes.add(nodeAddr);
  }

  /**
   * Check if a node has been paid in this run.
   *
   * @param {string} nodeAddr - Node address
   * @returns {boolean}
   */
  isPaid(nodeAddr) {
    return this._paidNodes.has(nodeAddr);
  }

  /**
   * Clear all paid node markers (e.g. at start of a new scan run).
   */
  clearPaidNodes() {
    this._paidNodes.clear();
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  /** @private Log a message if a logger is configured. */
  _log(msg) {
    if (this._logger) this._logger(msg);
  }
}
