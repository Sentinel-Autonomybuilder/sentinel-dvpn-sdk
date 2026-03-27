/**
 * Sentinel SDK — Generic Disk Cache
 *
 * Stale-while-revalidate pattern: returns cached data instantly,
 * refreshes in background. Falls back to stale data on error.
 * Inflight deduplication prevents duplicate concurrent fetches.
 *
 * Usage:
 *   import { cached, cacheInvalidate, cacheClear } from './disk-cache.js';
 *   const nodes = await cached('nodes', 300_000, () => fetchAllNodes());
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import path from 'path';
import os from 'os';

// ─── In-Memory Cache ────────────────────────────────────────────────────────

const _memCache = new Map(); // key → { data, ts, inflight }

/**
 * Fetch data with TTL caching + inflight deduplication + stale fallback.
 *
 * @param {string} key - Cache key
 * @param {number} ttlMs - Time-to-live in milliseconds
 * @param {function} fetchFn - Async function that returns fresh data
 * @returns {Promise<any>} Cached or fresh data
 */
export function cached(key, ttlMs, fetchFn) {
  const entry = _memCache.get(key);

  // Fresh cache hit
  if (entry && (Date.now() - entry.ts) < ttlMs) {
    return Promise.resolve(entry.data);
  }

  // Inflight dedup — don't fetch twice
  if (entry?.inflight) return entry.inflight;

  const p = fetchFn().then(data => {
    _memCache.set(key, { data, ts: Date.now(), inflight: null });
    return data;
  }).catch(err => {
    const existing = _memCache.get(key);
    if (existing) existing.inflight = null;
    // Stale fallback — return old data if available
    if (existing?.data) return existing.data;
    throw err;
  });

  _memCache.set(key, { ...(_memCache.get(key) || {}), inflight: p });
  return p;
}

/** Invalidate a single cache entry. */
export function cacheInvalidate(key) { _memCache.delete(key); }

/** Clear all cache entries. */
export function cacheClear() { _memCache.clear(); }

/** Get cache entry metadata (for debugging). */
export function cacheInfo(key) {
  const entry = _memCache.get(key);
  if (!entry) return null;
  return { ageMs: Date.now() - entry.ts, hasData: !!entry.data, inflight: !!entry.inflight };
}

// ─── Disk Cache ─────────────────────────────────────────────────────────────

const CACHE_DIR = path.join(os.homedir(), '.sentinel-sdk', 'cache');

/**
 * Save data to disk cache with timestamp.
 * @param {string} key - Cache key (becomes filename)
 * @param {any} data - JSON-serializable data
 */
export function diskSave(key, data) {
  try {
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
    const file = path.join(CACHE_DIR, `${key}.json`);
    writeFileSync(file, JSON.stringify({ data, savedAt: Date.now() }), { mode: 0o600 });
  } catch { /* disk write failure is non-fatal */ }
}

/**
 * Load data from disk cache.
 * @param {string} key - Cache key
 * @param {number} maxAgeMs - Maximum age in ms. Returns null if stale.
 * @returns {{ data: any, savedAt: number, stale: boolean } | null}
 */
export function diskLoad(key, maxAgeMs) {
  try {
    const file = path.join(CACHE_DIR, `${key}.json`);
    if (!existsSync(file)) return null;
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    const age = Date.now() - (raw.savedAt || 0);
    return { data: raw.data, savedAt: raw.savedAt, stale: age > maxAgeMs };
  } catch { return null; }
}

/** Clear a disk cache entry. */
export function diskClear(key) {
  try {
    const file = path.join(CACHE_DIR, `${key}.json`);
    if (existsSync(file)) unlinkSync(file);
  } catch { /* non-fatal */ }
}
