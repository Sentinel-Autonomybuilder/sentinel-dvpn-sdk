/**
 * error-handling.mjs — Typed error handling with the Sentinel SDK
 *
 * The SDK uses typed errors with machine-readable codes, severity levels,
 * and user-friendly messages. This example shows how to handle errors
 * programmatically instead of just catching strings.
 *
 * Usage:
 *   MNEMONIC="word1 word2 ..." node error-handling.mjs
 */

import {
  SentinelError,
  ValidationError,
  NodeError,
  ChainError,
  TunnelError,
  ErrorCodes,
  ERROR_SEVERITY,
  isRetryable,
  userMessage,
  connectAuto,
  registerCleanupHandlers,
  disconnect,
} from 'sentinel-dvpn-sdk';

const MNEMONIC = process.env.MNEMONIC;
if (!MNEMONIC) {
  console.error('Set MNEMONIC environment variable');
  process.exit(1);
}

// --- Show the error taxonomy ---
console.log('Sentinel SDK Error Codes:\n');
console.log('  Code'.padEnd(32), 'Severity'.padEnd(16), 'Retryable?');
console.log('  ' + '-'.repeat(60));
for (const [name, code] of Object.entries(ErrorCodes)) {
  const severity = ERROR_SEVERITY[code] || 'unknown';
  const retry = isRetryable(code) ? 'yes' : 'no';
  console.log(`  ${code.padEnd(32)}${severity.padEnd(16)}${retry}`);
}

// --- Demonstrate real error handling ---
console.log('\n\nAttempting connection with full error handling...\n');

async function main() {
  registerCleanupHandlers();

  try {
    const result = await connectAuto({
      mnemonic: MNEMONIC,
      maxAttempts: 2,
      log: (msg) => console.log(msg),
    });
    console.log(`Connected to ${result.nodeAddress}`);
    await disconnect();
  } catch (err) {
    // 1. Check if it is a typed SDK error
    if (!(err instanceof SentinelError)) {
      console.error('Unexpected error (not from SDK):', err.message);
      return;
    }

    // 2. Use the error code for programmatic handling
    console.log(`SDK Error: ${err.code}`);
    console.log(`  Class:    ${err.constructor.name}`);
    console.log(`  Message:  ${err.message}`);
    console.log(`  Severity: ${ERROR_SEVERITY[err.code] || 'unknown'}`);
    console.log(`  User msg: ${userMessage(err)}`);

    // 3. Severity-based logic
    const severity = ERROR_SEVERITY[err.code];

    if (severity === 'fatal') {
      // User must fix something (bad mnemonic, no balance, etc.)
      console.log('\n  Action: Show error to user, do not retry.');
    } else if (severity === 'retryable') {
      // Transient failure — try again with a different node
      console.log('\n  Action: Retry with a different node or wait and try again.');
    } else if (severity === 'recoverable') {
      // Partial success — session exists but tunnel failed
      console.log('\n  Action: Call recoverSession() to resume without re-paying.');
    } else if (severity === 'infrastructure') {
      // System-level issue (missing binary, cert mismatch)
      console.log('\n  Action: Check system dependencies.');
    }

    // 4. Type-specific handling
    if (err instanceof ValidationError) {
      console.log('\n  Input validation failed. Check your parameters.');
    } else if (err instanceof NodeError) {
      console.log(`\n  Node-level issue. Details: ${JSON.stringify(err.details)}`);
    } else if (err instanceof ChainError) {
      console.log('\n  Chain/transaction issue. Check balance and gas.');
    } else if (err instanceof TunnelError) {
      console.log('\n  Tunnel setup failed. Try another node or check WireGuard/V2Ray.');
    }

    // 5. Structured details are always available
    if (Object.keys(err.details).length > 0) {
      console.log(`\n  Details: ${JSON.stringify(err.details, null, 2)}`);
    }
  }
}

main().catch((err) => {
  console.error('Unhandled:', err);
  process.exit(1);
});
