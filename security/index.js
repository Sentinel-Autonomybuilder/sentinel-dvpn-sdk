/**
 * TLS Trust-On-First-Use (TOFU) for Sentinel Nodes
 *
 * Sentinel nodes use self-signed certificates (no CA issues certs for ephemeral IP servers).
 * TOFU model: save cert fingerprint on first connect, reject if it changes later.
 * Same concept as SSH known_hosts.
 *
 * Usage:
 *   import { createNodeHttpsAgent } from './tls-trust.js';
 *   const agent = createNodeHttpsAgent('sentnode1abc...', 'tofu');
 *   const res = await axios.post(url, body, { httpsAgent: agent });
 */

import https from 'https';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';
import { SecurityError, ErrorCodes } from '../errors/index.js';

const KNOWN_NODES_DIR = path.join(os.homedir(), '.sentinel-sdk');
const KNOWN_NODES_PATH = path.join(KNOWN_NODES_DIR, 'known_nodes.json');

// In-memory cache to avoid file I/O on every request
let knownNodesCache = null;

function loadKnownNodes() {
  if (knownNodesCache) return knownNodesCache;
  try {
    knownNodesCache = JSON.parse(readFileSync(KNOWN_NODES_PATH, 'utf8'));
  } catch {
    knownNodesCache = {};
  }
  return knownNodesCache;
}

function saveKnownNodes(nodes) {
  knownNodesCache = nodes;
  try {
    if (!existsSync(KNOWN_NODES_DIR)) mkdirSync(KNOWN_NODES_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(KNOWN_NODES_PATH, JSON.stringify(nodes, null, 2), { mode: 0o600 });
  } catch (e) {
    console.warn('[sentinel-sdk] Failed to save known_nodes.json:', e.message);
  }
}

/**
 * Create an HTTPS agent with TOFU certificate pinning for a specific node.
 *
 * Modes:
 * - 'tofu' (default): Pin cert on first connection, reject if it changes
 * - 'none': Accept any cert (current behavior, for testing only)
 *
 * @param {string} nodeAddress - sentnode1... address (used as lookup key)
 * @param {'tofu'|'none'} mode - Trust mode
 * @returns {https.Agent}
 */
export function createNodeHttpsAgent(nodeAddress, mode = 'tofu') {
  if (mode === 'none') {
    return new https.Agent({ rejectUnauthorized: false });
  }

  const known = loadKnownNodes();

  return new https.Agent({
    rejectUnauthorized: false,
    checkServerIdentity: (_hostname, cert) => {
      const fingerprint = cert.fingerprint256;
      if (!fingerprint) return new Error('Certificate missing fingerprint — possible MITM or malformed cert');

      const saved = known[nodeAddress];

      if (saved && saved.fingerprint !== fingerprint) {
        throw new SecurityError(
          ErrorCodes.TLS_CERT_CHANGED,
          `TLS certificate CHANGED for ${nodeAddress}. ` +
          `Expected: ${saved.fingerprint.substring(0, 20)}... ` +
          `Got: ${fingerprint.substring(0, 20)}... ` +
          `This could indicate a man-in-the-middle attack. ` +
          `If the node legitimately rotated its certificate, call clearKnownNode('${nodeAddress}') or delete ~/.sentinel-sdk/known_nodes.json`,
          { nodeAddress, expected: saved.fingerprint, got: fingerprint, firstSeen: saved.firstSeen },
        );
      }

      if (!saved) {
        known[nodeAddress] = {
          fingerprint,
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        };
        saveKnownNodes(known);
      } else {
        saved.lastSeen = new Date().toISOString();
        saveKnownNodes(known);
      }
    },
  });
}

/**
 * Clear a specific node's stored certificate fingerprint.
 * Call after a node legitimately rotates its TLS cert.
 */
export function clearKnownNode(nodeAddress) {
  const known = loadKnownNodes();
  delete known[nodeAddress];
  saveKnownNodes(known);
}

/**
 * Clear all stored node certificate fingerprints.
 */
export function clearAllKnownNodes() {
  saveKnownNodes({});
}

/**
 * Get stored certificate info for a node (null if not known).
 */
export function getKnownNode(nodeAddress) {
  const known = loadKnownNodes();
  return known[nodeAddress] || null;
}

/**
 * Secure agent for LCD/RPC public endpoints (CA-validated).
 * These endpoints have valid CA-signed certificates — no reason to skip verification.
 * TOFU is only for node-direct connections (self-signed certs).
 */
export const publicEndpointAgent = new https.Agent({ rejectUnauthorized: true });

/** @deprecated Use publicEndpointAgent. Kept for backward compatibility. */
export const insecureAgent = publicEndpointAgent;
