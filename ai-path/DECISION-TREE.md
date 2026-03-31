# AI Agent Decision Tree — Every Possible Path

> For autonomous agents making decisions without human intervention.
> Every path leads to either a resolution or a structured request for help.
> Nothing goes unresolved — every dead end produces actionable output.

---

## Decision Node 1: CAN I INSTALL?

```
Agent needs VPN
    │
    ├── Has Node.js 20+?
    │   ├── YES → continue
    │   └── NO → OUTPUT: { action: 'install-required', what: 'nodejs', url: 'https://nodejs.org', minVersion: '20.0.0' }
    │
    ├── Can run npm install?
    │   ├── YES → npm install sentinel-ai-connect
    │   ├── NO (network restricted) → OUTPUT: { action: 'offline-install', instructions: 'download tarball from registry' }
    │   └── NO (permissions) → OUTPUT: { action: 'permission-required', what: 'npm global install or local project' }
    │
    └── Postinstall (V2Ray download)?
        ├── SUCCESS → V2Ray 5.2.1 ready
        ├── FAIL (network) → OUTPUT: { action: 'manual-download', url: 'github.com/v2fly/v2ray-core/releases/tag/v5.2.1', sha256: '...' }
        └── FAIL (disk) → OUTPUT: { action: 'disk-space-required', minMb: 50 }
```

## Decision Node 2: WHAT CAN I USE?

```
setup() → environment check
    │
    ├── V2Ray available?
    │   ├── YES → can use ~630 V2Ray nodes (70% of network)
    │   └── NO → must install (run: node setup.js)
    │
    ├── WireGuard available?
    │   ├── YES + Admin → can use ALL 1000+ nodes (100% of network)
    │   ├── YES + No Admin → WG installed but locked. OUTPUT: { action: 'elevation-recommended', method: 'cscript run-admin.vbs', benefit: '+300 WireGuard nodes, faster, more reliable' }
    │   └── NO → WG not installed. For auto-install: cscript run-admin.vbs setup.js
    │
    └── Neither available?
        └── OUTPUT: { action: 'cannot-proceed', reason: 'no-tunnel-protocol', fix: 'run node setup.js' }
```

## Decision Node 3: DO I HAVE A WALLET?

```
Agent needs wallet
    │
    ├── Has mnemonic already?
    │   ├── YES → importWallet(mnemonic) → { address }
    │   └── NO → createWallet() → { mnemonic, address }
    │       └── CRITICAL: Store mnemonic securely. Never log it. Never commit it.
    │
    └── Is wallet funded?
        ├── getBalance(mnemonic) → { funded: true } → continue
        └── getBalance(mnemonic) → { funded: false }
            │
            ├── Agent has crypto on other chains?
            │   ├── Has ATOM → swap on Osmosis DEX (ATOM → P2P)
            │   ├── Has USDT/USDC → swap on Osmosis DEX (stable → ATOM → P2P)
            │   ├── Has ETH → bridge to Cosmos via Gravity Bridge or Axelar, then swap
            │   └── Has SOL/other → no direct bridge yet
            │       └── OUTPUT: { action: 'funding-request', address: 'sent1...', amount: '100000 udvpn', reason: 'minimum for 1 VPN session', acceptedTokens: ['udvpn', 'ATOM via Osmosis'] }
            │
            ├── Agent has fiat payment method?
            │   └── OUTPUT: { action: 'fiat-not-supported-yet', workaround: 'buy ATOM on exchange → send to Cosmos wallet → swap to P2P on Osmosis', futureSupport: 'planned' }
            │
            ├── Agent is operated by a company/human?
            │   └── OUTPUT: { action: 'request-funding', to: 'operator', address: 'sent1...', minAmount: '1000000 udvpn (1 P2P)', estimatedUsage: '~10 GB or ~10 sessions' }
            │
            └── Agent has no payment capability?
                └── OUTPUT: {
                      action: 'funding-needed',
                      address: 'sent1...',
                      minAmount: { udvpn: 1000000, p2p: '1.0 P2P', note: 'Covers gas + 1 GB on cheapest node' },
                      methods: [
                        { method: 'direct-transfer', description: 'Send P2P tokens to this address' },
                        { method: 'osmosis-swap', description: 'Swap ATOM/USDT → P2P on app.osmosis.zone' },
                        { method: 'operator-grant', description: 'Fee grant from plan operator covers gas' },
                      ],
                      request: {
                        type: 'funding-request',
                        reason: 'Autonomous agent needs VPN access for [task description]',
                        willingness: 'Will pay up to X per GB if funded',
                        contact: null,
                      }
                    }
```

## Decision Node 4: WHICH NODE DO I CONNECT TO?

```
recommend(preferences) → structured recommendation
    │
    ├── Agent needs specific country?
    │   ├── Nodes available in that country?
    │   │   ├── YES → action: 'connect', primary: { node in country }
    │   │   └── NO → check strictCountry flag
    │   │       ├── strict=true → action: 'cannot-connect', reason: 'country-unavailable'
    │   │       │   └── OUTPUT: {
    │   │       │         action: 'country-unavailable',
    │   │       │         requestedCountry: 'Germany',
    │   │       │         nearestAvailable: ['Netherlands', 'Austria', 'Switzerland'],
    │   │       │         suggestion: 'Try nearest country or wait for German node to come online',
    │   │       │         bounty: {
    │   │       │           description: 'Agent willing to pay premium for Germany access',
    │   │       │           maxPricePerGb: 500000,  // udvpn
    │   │       │           duration: '1h',
    │   │       │         }
    │   │       │       }
    │   │       └── strict=false → auto-fallback to nearest country
    │   │           └── action: 'connect-fallback', primary: { node in nearby country }
    │   │
    │   └── Agent needs specific city?
    │       ├── City data available (from node probe)?
    │       │   ├── YES → filter by city
    │       │   └── NO → fall back to country-level
    │       └── No nodes in that city?
    │           └── OUTPUT: { action: 'city-unavailable', fallbackToCountry: true }
    │
    ├── Agent prioritizes cost?
    │   ├── Sort by price ascending
    │   ├── estimateCost({ budget }) → how many GB affordable
    │   └── Warn if budget < 1 session
    │
    ├── Agent prioritizes reliability?
    │   ├── Sort by quality score (WireGuard bonus, low peer count, no clock drift)
    │   └── Prefer nodes with 100% transport success (tcp, websocket)
    │
    ├── Agent prioritizes speed?
    │   ├── Prefer WireGuard (10-50+ Mbps typical)
    │   ├── For V2Ray prefer tcp transport (highest throughput)
    │   └── Prefer nodes with low peer count (<5)
    │
    └── Agent has no preference?
        └── Default: reliability priority, auto protocol, any country
```

## Decision Node 5: CONNECTION FAILED — WHAT NOW?

```
connect() failed
    │
    ├── Error: INSUFFICIENT_BALANCE
    │   └── Go to Decision Node 3 (funding)
    │
    ├── Error: NODE_OFFLINE / NODE_INACTIVE
    │   ├── SDK auto-retries next node (maxAttempts=3)
    │   ├── All retries failed?
    │   │   ├── Try different country
    │   │   ├── Try different protocol
    │   │   └── Wait 60s and retry (node may come back)
    │   └── OUTPUT: { action: 'retry-later', waitSeconds: 60, alternativeCountries: [...] }
    │
    ├── Error: V2RAY_NOT_FOUND
    │   └── OUTPUT: { action: 'install-required', what: 'v2ray', fix: 'node setup.js' }
    │
    ├── Error: WG_NOT_AVAILABLE
    │   ├── If V2Ray available → retry with protocol: 'v2ray'
    │   └── If neither → OUTPUT: { action: 'install-required', what: 'wireguard or v2ray' }
    │
    ├── Error: ALL_NODES_FAILED
    │   ├── Network issue? Check internet connectivity first
    │   ├── All LCD endpoints down? Chain may be under maintenance
    │   └── OUTPUT: { action: 'network-issue', diagnosis: 'check internet → check lcd.sentinel.co → retry in 5min' }
    │
    ├── Error: BROADCAST_FAILED / TX_FAILED
    │   ├── Gas too low? SDK handles retry
    │   ├── Sequence mismatch? SDK retries 5 times
    │   └── If persists → OUTPUT: { action: 'chain-issue', waitMinutes: 5 }
    │
    ├── Error: V2RAY_ALL_FAILED
    │   ├── All transports on this node failed
    │   ├── SDK already tried next node
    │   └── Try: different country, or wait for node maintenance
    │
    ├── Error: TLS_CERT_CHANGED
    │   └── OUTPUT: { action: 'security-alert', severity: 'high', description: 'Node TLS certificate changed — possible MITM attack', recommendation: 'skip this node, report to network' }
    │
    └── Unknown error
        └── OUTPUT: { action: 'unknown-error', error: err.message, code: err.code, suggestion: 'retry once, then try different node/country' }
```

## Decision Node 6: CONNECTED — NOW WHAT?

```
VPN connected
    │
    ├── verify() → { verified: true }
    │   └── Traffic is flowing through encrypted tunnel
    │
    ├── verify() → { verified: false }
    │   ├── Tunnel up but no traffic
    │   ├── DNS issue? (especially with WireGuard full tunnel)
    │   ├── Node may be overloaded
    │   └── Recommendation: disconnect → try different node
    │
    ├── Agent needs to monitor connection?
    │   ├── onEvent('disconnected') → auto-reconnect or abort
    │   ├── onEvent('error') → log and decide
    │   └── Periodic verify() every 60s for long sessions
    │
    ├── Connection drops mid-session?
    │   ├── SDK has auto-reconnect if configured
    │   ├── Session still active on chain → can reconnect without new payment
    │   ├── Session expired → need new payment
    │   └── Recommendation: call connect() again — SDK reuses session if valid
    │
    └── Agent done with VPN?
        └── disconnect() → clean shutdown → session ended on chain
```

## Decision Node 7: PAYMENT & BUDGET MANAGEMENT

```
Agent managing budget
    │
    ├── How much per GB?
    │   ├── estimateCost({ gigabytes: 1 }) → typical 0.10-0.15 P2P
    │   ├── estimateCost({ nodeAddress }) → exact price for specific node
    │   └── Cheapest nodes: ~0.05 P2P/GB. Expensive: ~0.50 P2P/GB
    │
    ├── How much can I get with my balance?
    │   ├── estimateCost({ budget: myBalance }) → { forBudget: { gigabytes: X } }
    │   └── Include gas costs: ~0.04 P2P per session
    │
    ├── GB-based vs hourly?
    │   ├── GB-based: pay for data used. Best for: browsing, scraping, API calls
    │   ├── Hourly: pay for time. Best for: streaming, long connections, idle presence
    │   └── Recommendation: GB-based for AI agents (predictable cost per task)
    │
    ├── Agent wants to set spending limits?
    │   ├── Track: sessions created, tokens spent, GB used
    │   ├── Before each connect: check remaining budget
    │   ├── Set maxPrice in recommend() to filter expensive nodes
    │   └── Pattern:
    │       if (estimateCost().grandTotal.udvpn > budget * 0.1) {
    │         // Single session would cost >10% of budget — warn
    │       }
    │
    ├── Agent has tokens on wrong chain?
    │   ├── ATOM on Cosmos Hub → swap on Osmosis to P2P
    │   ├── USDT on Ethereum → bridge via Gravity/Axelar to Cosmos → swap
    │   ├── Other tokens → OUTPUT: { action: 'token-swap-needed', from: 'ETH', to: 'P2P', via: 'Osmosis DEX' }
    │   └── Future: SDK will include Osmosis swap helper
    │
    └── Agent ran out of tokens mid-session?
        ├── Session still active until allocation runs out
        ├── When allocation depleted: node stops routing traffic
        ├── Agent should monitor allocation: querySessionAllocation()
        └── OUTPUT: { action: 'low-balance-warning', remainingGb: X, estimatedMinutesLeft: Y }
```

## Decision Node 8: AGENT-TO-AGENT & AGENT-TO-NETWORK COMMUNICATION

```
Agent can't solve problem alone
    │
    ├── Country not available → place a demand signal
    │   └── OUTPUT: {
    │         type: 'demand-signal',
    │         what: 'vpn-node',
    │         where: 'Germany',
    │         willingToPay: { perGb: 500000, perHour: 200000 },
    │         duration: 'ongoing',
    │         contact: { type: 'sentinel-address', value: 'sent1...' },
    │         // Future: publish to on-chain demand marketplace
    │       }
    │
    ├── Agent needs funding → request from operator or marketplace
    │   └── OUTPUT: {
    │         type: 'funding-request',
    │         address: 'sent1...',
    │         amount: { min: 100000, preferred: 1000000, max: 10000000 },
    │         reason: 'Web scraping task requires VPN in 3 countries',
    │         taskDescription: '...',
    │         estimatedUsage: { gb: 5, sessions: 3, duration: '2h' },
    │         repayment: 'task revenue will cover costs',
    │       }
    │
    ├── Agent found a bug → report upstream
    │   └── OUTPUT: {
    │         type: 'bug-report',
    │         nodeAddress: 'sentnode1...',
    │         error: { code: 'V2RAY_ALL_FAILED', message: '...' },
    │         context: { os: 'windows', protocol: 'v2ray', transport: 'grpc' },
    │         // Write to: Sentinel SDK/suggestions/{timestamp}-agent-report.md
    │       }
    │
    ├── Agent wants to share results → contribute to network intelligence
    │   └── OUTPUT: {
    │         type: 'node-report',
    │         nodeAddress: 'sentnode1...',
    │         speed: 15.2,  // Mbps
    │         latency: 45,  // ms
    │         reliability: 'pass',
    │         timestamp: '2026-03-26T19:00:00Z',
    │         // Future: publish to decentralized node quality index
    │       }
    │
    └── Agent needs help from another agent
        └── OUTPUT: {
              type: 'agent-request',
              need: 'fund my wallet',
              offer: 'will share VPN session results',
              myAddress: 'sent1...',
              // Future: agent-to-agent marketplace on Sentinel chain
            }
```

## Decision Node 9: PAYMENT METHOD NOT SUPPORTED

```
Agent has funds but wrong type
    │
    ├── Has USDT (ERC-20 Ethereum)
    │   ├── Bridge: Gravity Bridge or Axelar to Cosmos
    │   ├── Then: Osmosis DEX swap USDT → P2P
    │   └── OUTPUT: { action: 'cross-chain-swap', steps: ['bridge to cosmos', 'swap on osmosis'], estimatedTime: '15-30min', estimatedFees: '~$2-5 bridge + swap' }
    │
    ├── Has USDC (multiple chains)
    │   ├── If on Cosmos/Noble → direct swap on Osmosis
    │   ├── If on Ethereum → bridge first
    │   └── OUTPUT: { steps: [...], cheapestPath: 'Noble USDC → Osmosis → P2P' }
    │
    ├── Has SOL
    │   ├── No direct bridge to Cosmos yet
    │   └── OUTPUT: { action: 'unsupported-currently', workaround: 'swap SOL→USDT on DEX, bridge to Cosmos, swap to P2P' }
    │
    ├── Has BTC
    │   ├── Nomic bridge (BTC → nBTC on Cosmos) → Osmosis → P2P
    │   └── OUTPUT: { action: 'cross-chain-swap', via: 'Nomic Bridge', steps: [...] }
    │
    ├── Has credit card / fiat only
    │   ├── Buy ATOM on Coinbase/Binance/Kraken → withdraw to Cosmos wallet → Osmosis → P2P
    │   └── OUTPUT: { action: 'fiat-onramp', steps: ['buy ATOM on exchange', 'withdraw to sent1... address', 'swap on Osmosis'], estimatedTime: '1-24h depending on exchange' }
    │
    └── Has nothing — pure autonomous agent with no funds
        └── OUTPUT: {
              action: 'request-sponsorship',
              description: 'Autonomous agent needs VPN access but has no tokens',
              request: {
                type: 'fee-grant',
                description: 'Operator covers gas, agent pays bandwidth from fee grant',
                requiresPlan: true,
                planOperatorBenefit: 'Agent drives usage and network growth',
              },
              alternatives: [
                'Apply for fee grant from plan operator',
                'Request funding from agent marketplace (future)',
                'Earn tokens by providing node quality reports (future)',
              ]
            }
```

## Quick Reference: Error → Action

| Error Code | Agent Action |
|-----------|-------------|
| `INSUFFICIENT_BALANCE` | Fund wallet → Decision Node 3 |
| `NODE_OFFLINE` | SDK auto-retries. If all fail → try different country |
| `NODE_INACTIVE` | SDK retries after 15s. If fails → different node |
| `V2RAY_NOT_FOUND` | Run `node setup.js` |
| `WG_NOT_AVAILABLE` | Retry with `protocol: 'v2ray'` |
| `V2RAY_ALL_FAILED` | Try different node. All nodes fail → wait 5min |
| `ALL_NODES_FAILED` | Check internet. Try different country. Wait 5min. |
| `ALL_ENDPOINTS_FAILED` | Chain unreachable. Wait 5min. Check lcd.sentinel.co |
| `BROADCAST_FAILED` | SDK retries 5x. If persists → chain congestion, wait |
| `TX_FAILED` | Check balance. Check gas. Try again. |
| `TLS_CERT_CHANGED` | Security alert. Skip node. |
| `SESSION_EXISTS` | SDK recovers automatically |
| `SESSION_POISONED` | SDK skips this session automatically |
| `CHAIN_LAG` | SDK waits 10s and retries automatically |
| `ALREADY_CONNECTED` | Call disconnect() first |
| `ABORTED` | Agent cancelled — intentional |
