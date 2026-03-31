/**
 * One-Shot VPN Connection
 *
 * The absolute minimum code to connect to Sentinel dVPN.
 * 10 lines. That's it.
 *
 * Prerequisites:
 *   1. .env file with MNEMONIC=<your 24-word phrase>
 *   2. Funded wallet (P2P tokens)
 *   3. V2Ray or WireGuard installed (run: sentinel-ai setup)
 *
 * Run: node examples/one-shot.mjs
 */

import 'dotenv/config';
import { connect, disconnect } from '../index.js';

const vpn = await connect({
  mnemonic: process.env.MNEMONIC,
  onProgress: (step, detail) => console.log(`[${step}] ${detail}`),
});

console.log(`Connected! Protocol: ${vpn.protocol}, IP: ${vpn.ip}`);
console.log('Press Ctrl+C to disconnect.');

process.on('SIGINT', async () => {
  await disconnect();
  process.exit(0);
});

await new Promise(() => {});
