# Sentinel dVPN SDK — JavaScript

The official JavaScript SDK for the [Sentinel](https://sentinel.co) decentralized VPN network. WireGuard + V2Ray tunnels, Cosmos blockchain, 1000+ nodes across 70+ countries. No API keys. No accounts. No servers to trust.

**Also available:** [C# SDK](https://github.com/Sentinel-Autonomybuilder/sentinel-dvpn-sdk-csharp) | [AI Connect](https://github.com/Sentinel-Autonomybuilder/sentinel-ai-connect) (zero-config wrapper)

## Install

```bash
npm install sentinel-dvpn-sdk
```

## Quick Start

```javascript
import { connectAuto, disconnect, registerCleanupHandlers } from 'sentinel-dvpn-sdk';

registerCleanupHandlers();

const result = await connectAuto({
  mnemonic: process.env.MNEMONIC,
  serviceType: 'wireguard',
  onProgress: (step, detail) => console.log(`[${step}] ${detail}`),
});

console.log(`Connected: session ${result.sessionId}, IP changed`);

await disconnect();
```

## For AI Agents

Use [sentinel-ai-connect](https://www.npmjs.com/package/sentinel-ai-connect) — a zero-config wrapper with one function call from zero to encrypted tunnel.

## Features

- **WireGuard** kernel-level encrypted tunnels (requires admin)
- **V2Ray** SOCKS5 proxy with transport obfuscation (no admin needed)
- **Split tunneling** — per-app (V2Ray SOCKS5) or per-destination (WireGuard AllowedIPs)
- **276 exports** — wallet, chain, handshake, tunnel, security, pricing, state
- **Cosmos blockchain** — on-chain sessions, P2P token payments
- **4 LCD + 5 RPC failover endpoints** — no single point of failure
- **AES-256-GCM** encrypted credential storage
- **TOFU TLS** certificate pinning
- **Verify-before-capture** — safe WireGuard activation without killing internet

## Security

- All private keys zeroed with `Buffer.fill(0)` after use
- Credentials encrypted at rest (AES-256-GCM)
- File permissions 0o600 on all sensitive files
- See [SECURITY.md](https://github.com/Sentinel-Autonomybuilder/sentinel-dvpn-sdk/blob/main/SECURITY.md)

## Documentation

Full documentation, protocol specs, and examples at [github.com/Sentinel-Autonomybuilder/sentinel-dvpn-sdk](https://github.com/Sentinel-Autonomybuilder/sentinel-dvpn-sdk).

## License

MIT — built on [Sentinel.co](https://sentinel.co)
