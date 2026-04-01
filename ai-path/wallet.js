/**
 * Sentinel AI Path — Wallet Management
 *
 * Simple wallet operations for AI agents:
 *   createWallet()           -> { mnemonic, address }
 *   importWallet(mnemonic)   -> { address }
 *   getBalance(mnemonic)     -> { address, p2p, udvpn, funded }
 */

import {
  createWallet as sdkCreateWallet,
  generateWallet,
  isMnemonicValid,
  getBalance as sdkGetBalance,
  createClient,
  formatP2P,
  LCD_ENDPOINTS,
  DEFAULT_RPC,
  tryWithFallback,
  RPC_ENDPOINTS,
} from '../index.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Minimum balance (in udvpn) to consider a wallet "funded" for VPN sessions.
 *  Matches connect.js MIN_BALANCE_UDVPN — cheapest node (~4 P2P) + gas. */
const FUNDED_THRESHOLD = 5_000_000; // 5.0 P2P

// ─── createWallet() ──────────────────────────────────────────────────────────

/**
 * Generate a brand new Sentinel wallet.
 *
 * @returns {Promise<{mnemonic: string, address: string}>}
 */
export async function createWallet() {
  try {
    const { mnemonic, account } = await generateWallet();
    return {
      mnemonic,
      address: account.address,
    };
  } catch (err) {
    throw new Error(`Wallet creation failed: ${err.message}`);
  }
}

// ─── importWallet() ──────────────────────────────────────────────────────────

/**
 * Import an existing wallet from a BIP39 mnemonic.
 * Validates the mnemonic and derives the sent1... address.
 *
 * @param {string} mnemonic - 12 or 24 word BIP39 phrase
 * @returns {Promise<{address: string}>}
 */
export async function importWallet(mnemonic) {
  if (!mnemonic || typeof mnemonic !== 'string') {
    throw new Error('importWallet() requires a mnemonic string');
  }

  if (!isMnemonicValid(mnemonic)) {
    const wordCount = mnemonic.trim().split(/\s+/).length;
    throw new Error(
      `Invalid mnemonic: got ${wordCount} words, need at least 12. ` +
      'Must be a valid BIP39 phrase.',
    );
  }

  try {
    const { account } = await sdkCreateWallet(mnemonic);
    return { address: account.address };
  } catch (err) {
    throw new Error(`Wallet import failed: ${err.message}`);
  }
}

// ─── getBalance() ────────────────────────────────────────────────────────────

/**
 * Check the P2P token balance of a wallet.
 *
 * @param {string} mnemonic - 12 or 24 word BIP39 phrase
 * @returns {Promise<{address: string, p2p: string, udvpn: number, funded: boolean}>}
 */
export async function getBalance(mnemonic) {
  if (!mnemonic || typeof mnemonic !== 'string') {
    throw new Error('getBalance() requires a mnemonic string');
  }

  if (!isMnemonicValid(mnemonic)) {
    throw new Error('Invalid mnemonic. Must be a 12 or 24 word BIP39 phrase.');
  }

  try {
    // Create wallet to get address
    const { wallet, account } = await sdkCreateWallet(mnemonic);

    // Connect to RPC with fallback
    const { result: client } = await tryWithFallback(
      RPC_ENDPOINTS,
      async (url) => createClient(url, wallet),
      'RPC connect (balance check)',
    );

    // Query balance
    const bal = await sdkGetBalance(client, account.address);

    return {
      address: account.address,
      p2p: formatP2P(bal.udvpn),
      udvpn: bal.udvpn,
      funded: bal.udvpn >= FUNDED_THRESHOLD,
    };
  } catch (err) {
    throw new Error(`Balance check failed: ${err.message}`);
  }
}
