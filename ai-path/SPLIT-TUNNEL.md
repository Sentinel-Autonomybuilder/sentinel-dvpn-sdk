# Split Tunneling — Selective Encryption for AI Agents

> **The most efficient way for an AI agent to use a VPN: encrypt only what needs encrypting, leave everything else on direct internet.**

---

## CRITICAL WARNINGS — Read Before Writing ANY Code

> **Rule 36: NEVER use native `fetch()` for V2Ray traffic.** Node.js `fetch()` silently ignores SOCKS5 proxy. You WILL get your real IP, not the VPN IP. Use `axios` with `SocksProxyAgent` for ALL V2Ray verification, speed tests, and IP checks. This is the #1 mistake every AI builder makes.

> **Rule 37: V2Ray split tunnel IS the SOCKS5 proxy.** V2Ray does not change system routing. Only traffic you explicitly send through `socks5://127.0.0.1:{port}` goes through the VPN. Everything else is direct. There is no kernel-level full tunnel for V2Ray.

> **Rule 38: WireGuard split tunnel requires exact destination IPs.** `splitIPs` takes IP addresses, not domains. CDN/anycast services resolve to hundreds of IPs. Use V2Ray SOCKS5 for per-app routing, WireGuard splitIPs only for known static IPs.

---

## Why Split Tunnel Matters for AI Agents

A full VPN tunnel routes **all** traffic through a single remote node — your chain queries, your API calls, your data collection, your package downloads, everything. For an AI agent, this creates problems:

| Full Tunnel | Split Tunnel |
|-------------|-------------|
| All traffic through VPN (~3-15 Mbps median) | Only selected traffic through VPN |
| Chain queries slow (LCD/RPC through VPN) | Chain queries at full speed (direct) |
| SDK operations may timeout | SDK operations always fast |
| Single point of failure | VPN failure doesn't break the agent |
| Consumes more bandwidth (higher cost) | Only pays for traffic that needs privacy |

**Split tunneling lets an AI agent encrypt one specific operation — a web scrape, an API call, a data fetch — while its own infrastructure calls (blockchain, npm, internal APIs) run at full speed on direct internet.**

---

## Two Modes of Split Tunnel

### Mode 1: Per-Application (V2Ray SOCKS5 Proxy)

V2Ray creates a local SOCKS5 proxy. **Only traffic you explicitly route through the proxy goes through the VPN.** Everything else uses direct internet.

```
Your agent process
├── HTTP request via SOCKS5 proxy  → V2Ray → VPN Node → Internet (VPN IP)
├── HTTP request direct            → Internet (Real IP)
├── Chain query (LCD/RPC)          → Internet (Real IP, fast)
└── npm install                    → Internet (Real IP, fast)
```

**This is the recommended mode for AI agents.** You choose exactly which requests need privacy.

#### How to Use

```javascript
import { connect, disconnect } from 'sentinel-ai-connect';
import { SocksProxyAgent } from 'socks-proxy-agent';
import axios from 'axios';

// Connect — V2Ray creates a SOCKS5 proxy on localhost
const vpn = await connect({
  mnemonic: process.env.MNEMONIC,
  protocol: 'v2ray',
});

console.log(`SOCKS5 proxy ready at 127.0.0.1:${vpn.socksPort}`);

// ─── Route SPECIFIC requests through VPN ─────────────────────
const agent = new SocksProxyAgent(`socks5h://127.0.0.1:${vpn.socksPort}`);

// This request goes through VPN (shows VPN IP)
const vpnRes = await axios.get('https://api.ipify.org?format=json', {
  httpAgent: agent,
  httpsAgent: agent,
  adapter: 'http',
});
console.log('VPN IP:', vpnRes.data.ip);

// ─── Direct requests bypass VPN ──────────────────────────────

// This request goes direct (shows real IP)
const directRes = await axios.get('https://api.ipify.org?format=json', {
  adapter: 'http',
});
console.log('Real IP:', directRes.data.ip);

// ─── Chain queries always fast (direct) ──────────────────────

// LCD query — no proxy, full speed
const nodes = await fetch('https://lcd.sentinel.co/sentinel/node/v3/nodes?status=1&pagination.limit=5');
// This never touches the VPN

await disconnect();
```

#### Using with curl

```bash
# Through VPN (shows VPN IP)
curl --proxy socks5://127.0.0.1:11336 https://api.ipify.org

# Direct (shows real IP)
curl https://api.ipify.org
```

#### Using with a Browser

```bash
# Launch Chrome with all traffic through VPN
chrome.exe --proxy-server="socks5://127.0.0.1:11336" --user-data-dir="/tmp/chrome-vpn"

# Regular Chrome instance stays on direct internet
```

#### Key Points
- SOCKS5 proxy binds to `127.0.0.1` only — not accessible from other machines
- Default: no authentication required (safe for localhost)
- Opt into password auth with `socksAuth: true` for defense-in-depth
- **IMPORTANT:** Use `axios` with `adapter: 'http'`, NOT native `fetch()` — Node.js `fetch()` silently ignores SOCKS5 proxy settings

---

### Mode 2: Per-Destination (WireGuard Split IPs)

WireGuard routes traffic based on destination IP ranges. **Only traffic going to specified IPs routes through the VPN.** Everything else uses direct internet.

```
Your agent process
├── Request to 10.0.0.0/8         → WireGuard → VPN Node → 10.0.0.x (VPN)
├── Request to 192.168.1.0/24     → WireGuard → VPN Node → 192.168.1.x (VPN)
├── Request to any other IP        → Internet (Real IP, direct)
└── Chain query (LCD/RPC)          → Internet (Real IP, fast)
```

**Use this when you know the exact IP addresses or subnets you need to access through VPN.**

#### How to Use

```javascript
import { connect, disconnect } from 'sentinel-ai-connect';

// Connect with specific IPs routed through VPN
const vpn = await connect({
  mnemonic: process.env.MNEMONIC,
  protocol: 'wireguard',
  splitIPs: ['10.0.0.0/8', '192.168.0.0/16'],
});

// Traffic to 10.x.x.x or 192.168.x.x goes through VPN
// All other traffic goes direct

await disconnect();
```

#### Limitations
- Routes by **destination IP**, not by application — all apps sending to those IPs use VPN
- Requires admin privileges (WireGuard kernel tunnel)
- DNS queries may leak to your ISP (split tunnel disables VPN DNS)
- CDN/anycast services (Cloudflare, Google) resolve to many IPs — hard to target

---

## Which Mode Should Your Agent Use?

| Scenario | Recommended Mode | Why |
|----------|-----------------|-----|
| **Web scraping with privacy** | V2Ray (per-app) | Route scraper through proxy, keep SDK/chain direct |
| **Accessing geo-blocked APIs** | V2Ray (per-app) | Proxy only the API calls that need the exit country |
| **Bulk data collection** | V2Ray (per-app) | Control exactly which requests are private |
| **Accessing a specific blocked server** | WireGuard (split IPs) | Route only that server's IP through VPN |
| **Full device privacy** | WireGuard (full tunnel) | Route everything — use `fullTunnel: true` (default) |
| **Maximum agent efficiency** | V2Ray (per-app) | Keeps chain queries fast, only encrypt what matters |

### The Efficiency Argument

An AI agent running with a full VPN tunnel spends **~3x more time** on chain operations because every LCD/RPC query routes through a 3-15 Mbps tunnel instead of direct internet. Split tunnel eliminates this overhead:

```
Full tunnel:
  connect()     → 50s (chain queries through VPN)
  LCD query     → 3s (through VPN)
  RPC broadcast → 5s (through VPN)
  Total overhead: ~8s per chain operation

Split tunnel (V2Ray):
  connect()     → 50s (chain queries direct — same speed)
  LCD query     → 0.3s (direct)
  RPC broadcast → 0.5s (direct)
  Total overhead: ~0.8s per chain operation
```

**For long-running agents** making frequent balance checks, session queries, or multi-step chain operations, split tunnel can reduce operational overhead by **10x**.

---

## Real-Time Processing Pattern

For AI agents that need to process data in real-time while maintaining selective privacy:

```javascript
import { connect, disconnect } from 'sentinel-ai-connect';
import { SocksProxyAgent } from 'socks-proxy-agent';
import axios from 'axios';

// Connect V2Ray — split tunnel by default
const vpn = await connect({
  mnemonic: process.env.MNEMONIC,
  protocol: 'v2ray',
  fullTunnel: false,
});

const proxy = new SocksProxyAgent(`socks5h://127.0.0.1:${vpn.socksPort}`);

// Create two HTTP clients — one private, one direct
const privateHttp = axios.create({
  httpAgent: proxy,
  httpsAgent: proxy,
  adapter: 'http',
  timeout: 30000,
});

const directHttp = axios.create({
  adapter: 'http',
  timeout: 10000,
});

// ─── Real-time processing loop ───────────────────────────────

while (running) {
  // Private: fetch sensitive data through VPN
  const data = await privateHttp.get('https://sensitive-api.example.com/data');

  // Direct: process with fast local/cloud APIs (no VPN overhead)
  const result = await directHttp.post('https://my-processing-api.com/analyze', {
    data: data.data,
  });

  // Direct: store results (no VPN needed)
  await directHttp.post('https://my-database.com/results', result.data);

  // Direct: check VPN balance (chain query, fast)
  const bal = await getBalance(mnemonic);
  if (!bal.funded) break; // Top up needed
}

await disconnect();
```

---

## Configuration Reference

| Option | Default | Effect |
|--------|---------|--------|
| `protocol: 'v2ray'` | Auto | Creates SOCKS5 proxy — per-application split tunnel |
| `protocol: 'wireguard'` | Auto | Creates kernel tunnel — per-destination or full |
| `fullTunnel: true` | `true` | WireGuard: route ALL traffic. V2Ray: set system proxy |
| `fullTunnel: false` | — | WireGuard: route only splitIPs. V2Ray: no system proxy |
| `splitIPs: ['10.0.0.0/8']` | — | WireGuard only: specific IPs through VPN |
| `systemProxy: false` | `true` | V2Ray: don't set Windows system proxy |

---

## Security Notes

- **V2Ray split tunnel:** Only traffic explicitly sent through the SOCKS5 proxy is encrypted. DNS queries from direct requests leak to your ISP.
- **WireGuard split tunnel:** DNS is handled by your system (not the VPN). Use `dns: 'cloudflare'` or `dns: 'google'` for direct queries.
- **Neither mode encrypts traffic to non-VPN destinations.** Only traffic routed through the tunnel gets the VPN's encryption.
- **For maximum privacy:** Use `fullTunnel: true` with WireGuard. This encrypts everything. Use split tunnel only when efficiency matters more than total privacy.
- **Kill Switch: UNTESTED.** The kill switch code exists (enableKillSwitch/disableKillSwitch in node-connect.js) but has never been tested against a live node on mainnet. Do not rely on it for production privacy. WireGuard only — V2Ray has no kill switch support.
