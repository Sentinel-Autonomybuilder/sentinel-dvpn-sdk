/**
 * Sentinel v3 Node Handshake
 *
 * Handles the v3 node handshake protocol for both WireGuard and V2Ray nodes.
 *
 * v3 handshake request body:
 * - data:      base64(JSON.stringify({public_key: "<base64_wg_pubkey>"}))  [WG]
 *              base64(JSON.stringify({uuid: [byte_array]}))                [V2Ray]
 * - id:        session ID (uint64 number)
 * - pub_key:   "secp256k1:<base64_cosmos_pubkey>"
 * - signature: base64(secp256k1_sign(SHA256(BigEndian8(id) + data_bytes)))
 *
 * Sources verified from:
 *   github.com/sentinel-official/dvpn-node development branch (Dec 2025, v8.3.1)
 *   github.com/sentinel-official/sentinel-go-sdk main branch
 */

import https from 'https';
import net from 'net';
import axios from 'axios';
import { Secp256k1, sha256 } from '@cosmjs/crypto';
import { secp256k1 as nobleSecp } from '@noble/curves/secp256k1.js';
import { NodeError, ErrorCodes } from '../errors.js';

// Legacy fallback — node-connect.js passes TOFU agent; this only used for direct calls
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// ─── IP/CIDR Validation ─────────────────────────────────────────────────────

/**
 * Validate an IP/CIDR string (e.g. "10.8.0.2/24" or "fd1d::2/128").
 * Returns true if valid IPv4 or IPv6 CIDR, false otherwise.
 */
export function validateCIDR(cidr) {
  if (typeof cidr !== 'string') return false;
  const parts = cidr.split('/');
  if (parts.length !== 2) return false;
  const [ip, prefix] = parts;
  const prefixNum = parseInt(prefix, 10);
  if (isNaN(prefixNum) || prefixNum < 0) return false;
  // IPv4
  if (net.isIPv4(ip)) return prefixNum <= 32;
  // IPv6
  if (net.isIPv6(ip)) return prefixNum <= 128;
  return false;
}

// ─── Node Status (v3: GET /) ──────────────────────────────────────────────────

/**
 * Fetch node info from v3 node API.
 * Returns a normalised object compatible with the rest of the codebase.
 */
export async function nodeStatusV3(remoteUrl, agent) {
  const stripped = remoteUrl.replace(/\/+$/, '').trim();
  const url = stripped.startsWith('http') ? stripped : `https://${stripped}`;
  const before = Date.now();
  const res = await axios.get(url + '/', { httpsAgent: agent || httpsAgent, timeout: 12_000 });
  const after = Date.now();
  const r = res.data?.result;
  if (!r) throw new NodeError(ErrorCodes.NODE_OFFLINE, 'No result in node status response', { remoteUrl });

  // Detect server clock drift from the HTTP Date header.
  // VMess AEAD auth fails if |client_time - server_time| > 120 seconds.
  let clockDriftSec = null;
  const dateHeader = res.headers?.['date'];
  if (dateHeader) {
    const serverTime = new Date(dateHeader).getTime();
    if (!isNaN(serverTime)) {
      const localMidpoint = before + (after - before) / 2;
      clockDriftSec = Math.round((serverTime - localMidpoint) / 1000);
    }
  }

  // Normalise to match the shape the rest of server.js expects
  return {
    address: r.address || '',
    type: r.service_type === 'wireguard' ? 'wireguard' : 'v2ray',
    moniker: r.moniker || '',
    peers: r.peers || 0,
    bandwidth: {
      // downlink/uplink are bytes/s (string in v3)
      download: parseInt(r.downlink || '0', 10),
      upload: parseInt(r.uplink || '0', 10),
    },
    location: {
      city: r.location?.city || '',
      country: r.location?.country || '',
      country_code: r.location?.country_code || '',
      latitude: r.location?.latitude || 0,
      longitude: r.location?.longitude || 0,
    },
    qos: { max_peers: r.qos?.max_peers || null },
    clockDriftSec,
    gigabyte_prices: [],  // not in v3 status; fetched from LCD
    _raw: r,
  };
}

// ─── Handshake Signing (shared between WG and V2Ray) ────────────────────────

/**
 * Build signed handshake body for v3 node protocol.
 * @param {Buffer} dataBytes   - Peer request JSON bytes
 * @param {bigint} sessionId   - Session ID (uint64)
 * @param {Buffer} cosmosPrivKey - Raw secp256k1 private key (32 bytes)
 * @returns {{ body: object }} - Signed request body ready for POST
 */
async function buildSignedBody(dataBytes, sessionId, cosmosPrivKey) {
  // Build message: BigEndian uint64 (8 bytes) ++ data
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64BE(BigInt(sessionId));
  const msg = Buffer.concat([idBuf, dataBytes]);

  // Sign: SHA256(msg) → secp256k1 compact 64-byte sig (r+s, no recovery byte) → base64
  // IMPORTANT: Go's VerifySignature requires EXACTLY 64 bytes (len != 64 → false)
  const msgHash = sha256(msg);
  const sig = await Secp256k1.createSignature(msgHash, cosmosPrivKey);
  // toFixedLength() returns 65 bytes (r+s+recovery) — take only first 64 (r+s)
  const sigBytes = Buffer.from(sig.toFixedLength()).slice(0, 64);
  const signature = sigBytes.toString('base64');

  // Encode Cosmos public key (compressed, 33 bytes): "secp256k1:<base64>"
  const compressedPubKey = nobleSecp.getPublicKey(cosmosPrivKey, true);
  const pubKeyEncoded = 'secp256k1:' + Buffer.from(compressedPubKey).toString('base64');

  const idNum = Number(sessionId);
  if (!Number.isSafeInteger(idNum)) {
    throw new NodeError(ErrorCodes.INVALID_OPTIONS, `Session ID ${sessionId} exceeds safe integer range (max ${Number.MAX_SAFE_INTEGER})`, { sessionId });
  }

  return {
    body: {
      data: dataBytes.toString('base64'),
      id: idNum,
      pub_key: pubKeyEncoded,
      signature,
    },
  };
}

// ─── Chain-Lag Retry POST ───────────────────────────────────────────────────

/**
 * POST to node with chain-lag retry logic.
 * After MsgStartSession, the node may not see the session on-chain yet.
 * If the node returns "does not exist" or HTTP 404 code 5, wait and retry once.
 */
async function postWithChainLagRetry(url, body, agent, label = 'Node') {
  const doPost = async () => {
    let res;
    try {
      res = await axios.post(url, body, {
        httpsAgent: agent || httpsAgent,
        timeout: 90_000,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      // 409 "session already exists" — node already has our session and peer data.
      // Extract the config from the error response instead of wasting tokens on a new session.
      if (err.response?.status === 409 && err.response?.data?.result?.data) {
        return err.response; // Treat as success — node accepted our session
      }
      const errData = err.response?.data;
      const code = err.code || '';
      const status = err.response?.status;
      const detail = errData ? JSON.stringify(errData) : err.message;
      const bodyStr = typeof errData === 'string' ? errData : JSON.stringify(errData || '');
      // Detect corrupted node database (HTTP 500 with sqlite errors)
      if (status === 500 && (bodyStr.includes('no such table') || bodyStr.includes('database is locked') || bodyStr.includes('disk I/O error'))) {
        throw new NodeError('NODE_DATABASE_CORRUPT', `Node ${url} has a corrupted database: ${bodyStr.substring(0, 200)}`, { remoteUrl: url, status });
      }
      const isChainLag = bodyStr.includes('does not exist') ||
        (status === 404 && errData?.code === 5);
      if (isChainLag) return { _chainLag: true, detail };
      throw new NodeError(ErrorCodes.NODE_OFFLINE, `${label} handshake failed (HTTP ${status}${code ? ', ' + code : ''}): ${detail}`, { status, code });
    }
    return res;
  };

  let res = await doPost();

  // Retry once on chain lag
  if (res?._chainLag) {
    console.log('Session not yet visible on node — waiting 10s for chain propagation...');
    await new Promise(r => setTimeout(r, 10_000));
    res = await doPost();
    if (res?._chainLag) {
      throw new NodeError(ErrorCodes.NODE_OFFLINE, `${label} handshake failed: session does not exist on node after retry (chain propagation delay). Detail: ${res.detail}`, { chainLag: true });
    }
  }

  return res;
}

// ─── v3 WireGuard Handshake (POST /) ────────────────────────────────────────

/**
 * Perform v3 node handshake for WireGuard.
 * @param {string}     remoteUrl     - Node's HTTPS base URL
 * @param {bigint}     sessionId     - Session ID (uint64)
 * @param {Buffer}     cosmosPrivKey - Raw secp256k1 private key bytes (32 bytes)
 * @param {Buffer}     wgPublicKey   - WireGuard public key (32 bytes)
 * @returns {{ assignedAddrs: string[], serverPubKey: string, serverEndpoints: string[] }}
 */
export async function initHandshakeV3(remoteUrl, sessionId, cosmosPrivKey, wgPublicKey, agent) {
  // 1. Build peer request data
  const peerRequest = { public_key: wgPublicKey.toString('base64') };
  const dataBytes = Buffer.from(JSON.stringify(peerRequest));

  // 2. Sign and build body
  const { body } = await buildSignedBody(dataBytes, sessionId, cosmosPrivKey);

  // 3. POST with chain-lag retry
  const url = remoteUrl.replace(/\/+$/, '') + '/';
  const res = await postWithChainLagRetry(url, body, agent, 'Node');

  const result = res.data?.result;
  if (!result) {
    const errInfo = res.data?.error;
    throw new NodeError(ErrorCodes.NODE_OFFLINE, `Node handshake error: ${JSON.stringify(errInfo || res.data)}`, { response: errInfo || res.data });
  }

  // 4. Parse AddPeerResponse from result.data (base64-encoded JSON bytes)
  const addPeerData = Buffer.from(result.data, 'base64').toString('utf8');
  const addPeerResp = JSON.parse(addPeerData);

  // result.addrs = node's WireGuard listening addresses (["IP:PORT", ...])
  // addPeerResp.addrs = our assigned IPs (["10.x.x.x/24", ...])
  // addPeerResp.metadata = [{port, public_key}, ...]

  const metadata = (addPeerResp.metadata || [])[0] || {};
  const serverPubKeyBase64 = metadata.public_key || '';
  const serverPort = parseInt(metadata.port, 10) || 51820;

  // Validate handshake response — garbage data from node → clear error instead of opaque WG failure
  if (!serverPubKeyBase64) throw new NodeError(ErrorCodes.NODE_OFFLINE, 'Handshake failed: node returned empty WireGuard public key');
  if (serverPort < 1 || serverPort > 65535) throw new NodeError(ErrorCodes.NODE_OFFLINE, `Handshake failed: invalid port ${serverPort} from node`, { serverPort });

  const assignedAddrs = addPeerResp.addrs || [];
  if (assignedAddrs.length === 0) throw new NodeError(ErrorCodes.NODE_OFFLINE, 'Handshake failed: node returned no assigned addresses');
  for (const addr of assignedAddrs) {
    if (!validateCIDR(addr)) {
      throw new NodeError(ErrorCodes.INVALID_ASSIGNED_IP, `Handshake failed: node returned invalid IP/CIDR "${addr}"`, { assignedAddrs });
    }
  }

  // Node's WireGuard endpoint: use first entry of result.addrs
  // If it doesn't include a port, append the metadata port
  const rawEndpoint = (result.addrs || [])[0] || '';
  if (!rawEndpoint) throw new NodeError(ErrorCodes.NODE_OFFLINE, 'Handshake failed: node returned no WireGuard endpoint addresses');
  const serverEndpoint = rawEndpoint.includes(':')
    ? rawEndpoint
    : `${rawEndpoint}:${serverPort}`;

  return {
    assignedAddrs,                              // our IPs e.g. ["10.8.0.2/24"]
    serverPubKey: serverPubKeyBase64,         // server WG pub key (base64)
    serverEndpoint,                             // "IP:PORT" for WireGuard Endpoint
    serverEndpoints: result.addrs || [],
    rawAddPeerResp: addPeerResp,
  };
}

// ─── v3 V2Ray Handshake (POST /) ────────────────────────────────────────────

/**
 * Perform v3 V2Ray handshake.
 * Returns the V2Ray client config (JSON string in result.data).
 */
export async function initHandshakeV3V2Ray(remoteUrl, sessionId, cosmosPrivKey, uuid, agent) {
  const hex = uuid.replace(/-/g, '');
  const uuidBytes = [];
  for (let i = 0; i < hex.length; i += 2) {
    uuidBytes.push(parseInt(hex.substring(i, i + 2), 16));
  }
  const peerRequest = { uuid: uuidBytes };
  const dataBytes = Buffer.from(JSON.stringify(peerRequest));

  const { body } = await buildSignedBody(dataBytes, sessionId, cosmosPrivKey);

  const url = remoteUrl.replace(/\/+$/, '') + '/';
  const res = await postWithChainLagRetry(url, body, agent, 'V2Ray');

  const result = res.data?.result;
  if (!result) {
    throw new NodeError(ErrorCodes.NODE_OFFLINE, `V2Ray handshake error: ${JSON.stringify(res.data?.error || res.data)}`, { response: res.data?.error || res.data });
  }

  // result.data is base64-encoded V2Ray client config JSON
  const v2rayConfig = Buffer.from(result.data, 'base64').toString('utf8');

  return {
    config: v2rayConfig,
    serverEndpoints: result.addrs || [],
  };
}
