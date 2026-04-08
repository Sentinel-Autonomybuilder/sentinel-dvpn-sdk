/**
 * Sentinel V2Ray Config Builder
 *
 * Builds V2Ray client configs from node handshake metadata.
 * Handles transport mapping, outbound sorting, observatory config,
 * and SOCKS5 proxy setup.
 *
 * proxy_protocol:    1=VLess  2=VMess
 * transport_protocol:1=domainsocket 2=gun 3=grpc 4=http 5=mkcp 6=quic 7=tcp 8=websocket
 * transport_security:0=unspecified  1=none  2=TLS  (per sentinel-go-sdk transport.go iota)
 */

import net from 'net';
import { randomBytes, randomUUID } from 'crypto';
import { getDynamicRate, resolveDnsServers } from '../defaults.js';
import { NodeError, TunnelError, ErrorCodes } from '../errors.js';

// ─── UUID Generation ────────────────────────────────────────────────────────

export function generateV2RayUUID() {
  return randomUUID();
}

// ─── Port Readiness Probe ───────────────────────────────────────────────────

/**
 * Wait until a TCP port is accepting connections (SOCKS5 readiness probe).
 * V2Ray takes variable time to bind its SOCKS5 inbound — a fixed sleep is unreliable.
 * Returns true when ready, false if timeout.
 * @param {number} port - Port to probe (e.g. SOCKS5 port)
 * @param {number} timeoutMs - Max wait time (default: 10000)
 * @param {string} host - Host to probe (default: '127.0.0.1')
 * @param {number} intervalMs - Probe interval (default: 500)
 */
export async function waitForPort(port, timeoutMs = 10000, host = '127.0.0.1', intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise(resolve => {
      const sock = net.createConnection({ host, port }, () => {
        sock.destroy();
        resolve(true);
      });
      sock.on('error', () => resolve(false));
      sock.setTimeout(1000, () => { sock.destroy(); resolve(false); });
    });
    if (ok) return true;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}

// ─── V2Ray Config Helpers ──────────────────────────────────────────────────

// Transport names — MUST match sentinel-go-sdk transport.go String() output exactly.
// CRITICAL: "gun" and "grpc" are DIFFERENT in V2Ray 5.x (gun = raw H2, grpc = gRPC lib).
const NETWORK_MAP = { 2: 'gun', 3: 'grpc', 4: 'http', 5: 'mkcp', 6: 'quic', 7: 'tcp', 8: 'websocket' };

// Sort by transport reliability so the first outbound (used by default routing) is most likely to work.
// Observed success rates from 780-node test (2026-03-09):
//   tcp=100%, websocket=100%, http=100%, gun=100%, mkcp=100%
//   grpc/none=87% (70/81), quic=0% (0/4), grpc/tls=0%
const TRANSPORT_PRIORITY = { 7: 0, 8: 1, 4: 2, 2: 3, 5: 4 }; // tcp, ws, http, gun, kcp

function transportSortKey(tp, ts) {
  // Check dynamic rate first (in-memory, from actual runtime connections)
  const network = NETWORK_MAP[tp] || 'tcp';
  const key = ts === 2 ? `${network}/tls` : (tp === 3 ? 'grpc/none' : network);
  const dynamicRate = getDynamicRate(key);
  if (dynamicRate !== null) {
    // Map rate [0,1] → sort key [0,10] (lower = better priority)
    return Math.round((1 - dynamicRate) * 10);
  }
  // Fall back to hardcoded priority order
  if (TRANSPORT_PRIORITY[tp] !== undefined) return TRANSPORT_PRIORITY[tp];
  if (tp === 3 && ts !== 2) return 5;  // grpc/none
  if (tp === 3 && ts === 2) return 8;  // grpc/tls
  if (tp === 6 && ts === 2) return 9;  // quic/tls
  if (tp === 6 && ts !== 2) return 10; // quic/none
  return 7;
}

/** Map v2-format metadata to v3 fields. Mutates entries in place. */
function normalizeV2Metadata(entries) {
  const hasV2Format = entries.some(e => e.ca !== undefined || (e.protocol !== undefined && e.proxy_protocol === undefined));
  if (!hasV2Format) return entries;
  return entries.map(e => {
    if (e.proxy_protocol !== undefined) return e; // already v3
    const copy = { ...e };
    // v2: protocol 1=VMess, 2=VLess → v3: proxy_protocol 2=VMess, 1=VLess (swapped)
    if (copy.protocol !== undefined && copy.proxy_protocol === undefined) {
      copy.proxy_protocol = copy.protocol === 2 ? 1 : 2;
    }
    if (copy.transport_protocol === undefined) copy.transport_protocol = 7; // default tcp
    if (copy.transport_security === undefined) {
      copy.transport_security = (copy.tls === 1 || copy.tls === true) ? 2 : 1;
    }
    return copy;
  });
}

/** Filter out unsupported transports and sort by reliability. */
function filterAndSortTransports(entries) {
  // Remove domainsocket (1 — unix sockets, can't work remotely)
  // Remove QUIC (6 — 0% success rate from 780+ node scan, chacha20 mismatch)
  const supported = entries.filter(e => e.transport_protocol !== 1 && e.transport_protocol !== 6);
  if (supported.length === 0) {
    const allDs = entries.every(e => e.transport_protocol === 1);
    const allQuic = entries.every(e => e.transport_protocol === 6);
    const reason = allDs ? 'All transports are domainsocket — unusable remotely'
      : allQuic ? 'All transports are QUIC — 0% success rate on current network'
      : 'No usable transport entries (domainsocket + QUIC filtered)';
    throw new TunnelError(ErrorCodes.V2RAY_ALL_FAILED, reason);
  }
  // gun (2) and grpc (3) are different protocols in V2Ray 5.x — some nodes accept
  // one but not the other. For every grpc entry, add a gun variant (and vice versa)
  // so the sequential fallback loop can try both. ~13% of grpc nodes only accept gun.
  const withDualGrpc = [];
  for (const e of supported) {
    withDualGrpc.push(e);
    if (e.transport_protocol === 3) {
      withDualGrpc.push({ ...e, transport_protocol: 2, _derived: 'gun-from-grpc' });
    } else if (e.transport_protocol === 2) {
      withDualGrpc.push({ ...e, transport_protocol: 3, _derived: 'grpc-from-gun' });
    }
  }
  return [...withDualGrpc].sort((a, b) => {
    return transportSortKey(a.transport_protocol, a.transport_security)
         - transportSortKey(b.transport_protocol, b.transport_security);
  });
}

/** Build a single V2Ray outbound from a metadata entry.
 * @param {object} entry - metadata entry with transport/security info
 * @param {string} serverHost - node IP/hostname
 * @param {string} uuid - V2Ray UUID
 * @param {object} [opts] - { clockDriftSec } for VMess alterId adjustment
 */
function buildOutbound(entry, serverHost, uuid, opts = {}) {
  const port = parseInt(entry.port, 10);
  if (!port || port < 1 || port > 65535) return null;
  const protocol = entry.proxy_protocol === 1 ? 'vless' : 'vmess';
  const network = NETWORK_MAP[entry.transport_protocol] || 'tcp';
  const security = entry.transport_security === 2 ? 'tls' : 'none';
  const tag = `${serverHost}_${port}_${protocol}_${network}_${security}`;

  const streamSettings = { network, security };
  if (security === 'tls') streamSettings.tlsSettings = { allowInsecure: true, serverName: serverHost };
  if (network === 'grpc' || network === 'gun') streamSettings.grpcSettings = { serviceName: '' };
  if (network === 'quic') streamSettings.quicSettings = { security: 'none', key: '', header: { type: 'none' } };

  // VMess alterId: 0 (AEAD) by default. For nodes with >120s clock drift,
  // use alterId: 64 (legacy VMess) which is more tolerant of time differences.
  // VLess is unaffected by clock drift — no timestamp in the protocol.
  const drifted = Math.abs(opts?.clockDriftSec || 0) > 120;
  const vmessAlterId = drifted ? 64 : 0;

  const settings = protocol === 'vmess'
    ? { vnext: [{ address: serverHost, port, users: [{ id: uuid, alterId: vmessAlterId }] }] }
    : { vnext: [{ address: serverHost, port, users: [{ id: uuid, encryption: 'none', flow: '' }] }] };

  return { tag, protocol, settings, streamSettings };
}

// ─── Main Config Builder ──────────────────────────────────────────────────

/**
 * Build a complete V2Ray client JSON config from the node's handshake metadata.
 *
 * The node returns a metadata blob like:
 *   {"metadata":[{"port":"55215","proxy_protocol":2,"transport_protocol":3,"transport_security":1},...]}
 *
 * We must convert this into a proper V2Ray config with inbounds + outbounds.
 *
 * @param {string}  serverHost    - Hostname of the node (e.g. "us04.quinz.top")
 * @param {string}  metadataJson  - JSON string returned from handshake (hs.config)
 * @param {string}  uuid          - UUID/UID we generated for the session
 * @param {number}  socksPort     - Local SOCKS5 port to listen on (default 1080)
 * @param {object}  [opts]        - { clockDriftSec, socksAuth, dns, dnsPreset }
 * @returns {object}              - Complete V2Ray config object (call JSON.stringify to write)
 */
export function buildV2RayClientConfig(serverHost, metadataJson, uuid, socksPort = 1080, opts = {}) {
  const parsed = typeof metadataJson === 'string' ? JSON.parse(metadataJson) : metadataJson;
  const entries = parsed.metadata || [];

  if (entries.length === 0) throw new NodeError(ErrorCodes.NODE_OFFLINE, 'No metadata entries in V2Ray handshake response');

  const normalized = normalizeV2Metadata(entries);
  const sorted = filterAndSortTransports(normalized);
  const obOpts = { clockDriftSec: opts?.clockDriftSec || 0 };
  const outbounds = sorted.map(e => buildOutbound(e, serverHost, uuid, obOpts)).filter(Boolean);
  if (outbounds.length === 0) throw new TunnelError(ErrorCodes.V2RAY_ALL_FAILED, 'All V2Ray outbounds filtered out (all ports invalid or transports unsupported)');

  // SOCKS5 auth: 'noauth' by default — proxy binds to 127.0.0.1 (localhost only),
  // so password auth adds complexity without security benefit. Any local process can
  // already read V2Ray's config from memory. noauth is the industry standard for
  // localhost SOCKS proxies (Tor, shadowsocks, clash all use noauth by default).
  // Opt into password auth with opts.socksAuth = true for extra defense-in-depth.
  const usePasswordAuth = opts?.socksAuth === true;
  const socksUser = usePasswordAuth ? randomBytes(8).toString('hex') : null;
  const socksPass = usePasswordAuth ? randomBytes(16).toString('hex') : null;

  // Match the official sentinel-go-sdk client.json.tmpl structure exactly:
  //   - API inbound (dokodemo-door) for StatsService
  //   - SOCKS inbound with sniffing
  //   - ALL metadata entries as separate outbounds
  //   - Routing: API → api tag, proxy → first outbound (most reliable transport)
  //   - NEVER use balancer/observatory — causes session poisoning (see known-issues.md)
  //   - Policy with uplinkOnly/downlinkOnly = 0
  //   - Global transport section with QUIC security=none (matches sentinel-go-sdk server)
  // Random API port — avoids Windows TIME_WAIT collisions when v2ray is killed and respawned.
  // Port 2080 (fixed) caused cascading bind failures across sequential node tests.
  const apiPort = 10000 + Math.floor(Math.random() * 50000);

  return {
    api: {
      services: ['StatsService'],
      tag: 'api',
    },
    inbounds: [
      {
        listen: '127.0.0.1',
        port: apiPort,
        protocol: 'dokodemo-door',
        settings: { address: '127.0.0.1' },
        tag: 'api',
      },
      {
        listen: '127.0.0.1',
        port: socksPort,
        protocol: 'socks',
        settings: usePasswordAuth
          ? { auth: 'password', accounts: [{ user: socksUser, pass: socksPass }], ip: '127.0.0.1', udp: true }
          : { auth: 'noauth', ip: '127.0.0.1', udp: true },
        sniffing: { enabled: true, destOverride: ['http', 'tls'] },
        tag: 'proxy',
      },
    ],
    log: { loglevel: 'info' },
    outbounds,
    routing: {
      domainStrategy: 'IPIfNonMatch',
      rules: [
        { inboundTag: ['api'], outboundTag: 'api', type: 'field' },
        { inboundTag: ['proxy'], outboundTag: outbounds[0].tag, type: 'field' },
      ],
    },
    policy: {
      levels: { '0': { downlinkOnly: 0, uplinkOnly: 0 } },
      system: { statsOutboundDownlink: true, statsOutboundUplink: true },
    },
    dns: {
      servers: (opts?.dns || resolveDnsServers(opts?.dnsPreset)).split(',').map(s => s.trim()),
    },
    stats: {},
    transport: {
      dsSettings: {},
      grpcSettings: {},
      gunSettings: {},
      httpSettings: {},
      kcpSettings: {},
      quicSettings: { security: 'none', key: '', header: { type: 'none' } },
      tcpSettings: {},
      wsSettings: {},
    },
    // SOCKS5 auth credentials — use these when creating SocksProxyAgent
    _socksAuth: { user: socksUser, pass: socksPass },
  };
}
