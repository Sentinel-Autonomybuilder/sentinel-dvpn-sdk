/**
 * Sentinel SDK — Chain / Wallet Module
 *
 * Wallet creation, mnemonic validation, private key derivation,
 * and bech32 address prefix conversion.
 *
 * Usage:
 *   import { createWallet, generateWallet, privKeyFromMnemonic } from './chain/wallet.js';
 *   const { wallet, account } = await createWallet(mnemonic);
 */

import { Bip39, EnglishMnemonic, Slip10, Slip10Curve, Random } from '@cosmjs/crypto';
import { makeCosmoshubPath } from '@cosmjs/amino';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { fromBech32, toBech32 } from '@cosmjs/encoding';
import { ValidationError, ErrorCodes } from '../errors.js';

// ─── Input Validation Helpers ────────────────────────────────────────────────

/**
 * Validate a BIP39 mnemonic string against the English wordlist.
 * Returns true if valid (12/15/18/21/24 words, all in BIP39 list, valid checksum).
 * Use this to enable/disable a "Connect" button in your UI.
 *
 * @param {string} mnemonic - The mnemonic to validate
 * @returns {boolean} True if the mnemonic is a valid BIP39 English mnemonic
 *
 * @example
 *   if (isMnemonicValid(userInput)) showConnectButton();
 */
export function isMnemonicValid(mnemonic) {
  if (typeof mnemonic !== 'string') return false;
  const trimmed = mnemonic.trim();
  if (trimmed.split(/\s+/).length < 12) return false;
  try {
    // EnglishMnemonic constructor validates word count, wordlist membership, and checksum
    new EnglishMnemonic(trimmed);
    return true;
  } catch {
    return false;
  }
}

export function validateMnemonic(mnemonic, fnName) {
  if (typeof mnemonic !== 'string') {
    throw new ValidationError(ErrorCodes.INVALID_MNEMONIC,
      `${fnName}(): mnemonic must be a string`, { wordCount: 0 });
  }
  const words = mnemonic.trim().split(/\s+/);
  if (words.length < 12) {
    throw new ValidationError(ErrorCodes.INVALID_MNEMONIC,
      `${fnName}(): mnemonic must have at least 12 words`,
      { wordCount: words.length });
  }
  if (!isMnemonicValid(mnemonic)) {
    throw new ValidationError(ErrorCodes.INVALID_MNEMONIC,
      `${fnName}(): mnemonic contains invalid BIP39 words or failed checksum`,
      { wordCount: words.length });
  }
}

export function validateAddress(addr, prefix, fnName) {
  if (typeof addr !== 'string' || !addr.startsWith(prefix)) {
    throw new ValidationError(ErrorCodes.INVALID_NODE_ADDRESS,
      `${fnName}(): address must be a valid ${prefix}... bech32 string`,
      { value: addr });
  }
}

// ─── Wallet ──────────────────────────────────────────────────────────────────

/**
 * Create a Sentinel wallet from a BIP39 mnemonic.
 * Returns { wallet, account } where account.address is the sent1... address.
 */
export async function createWallet(mnemonic) {
  validateMnemonic(mnemonic, 'createWallet');
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, { prefix: 'sent' });
  const [account] = await wallet.getAccounts();
  return { wallet, account };
}

/**
 * Generate a new wallet with a fresh random BIP39 mnemonic.
 * @param {number} strength - 128 for 12 words, 256 for 24 words (default: 128)
 * @returns {{ mnemonic: string, wallet: DirectSecp256k1HdWallet, account: { address: string } }}
 */
export async function generateWallet(strength = 128) {
  const entropy = Random.getBytes(strength / 8);
  const mnemonic = Bip39.encode(entropy).toString();
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, { prefix: 'sent' });
  const [account] = await wallet.getAccounts();
  return { mnemonic, wallet, account };
}

/**
 * Derive the raw secp256k1 private key from a mnemonic.
 * Needed for handshake signatures (node-handshake protocol).
 */
export async function privKeyFromMnemonic(mnemonic) {
  validateMnemonic(mnemonic, 'privKeyFromMnemonic');
  const seed = await Bip39.mnemonicToSeed(new EnglishMnemonic(mnemonic));
  const { privkey } = Slip10.derivePath(Slip10Curve.Secp256k1, seed, makeCosmoshubPath(0));
  return Buffer.from(privkey);
}

// ─── Address Prefix Conversion ───────────────────────────────────────────────
// Same key, different bech32 prefix. See address-prefixes.md.

export function sentToSentprov(sentAddr) {
  validateAddress(sentAddr, 'sent', 'sentToSentprov');
  const { data } = fromBech32(sentAddr);
  return toBech32('sentprov', data);
}

export function sentToSentnode(sentAddr) {
  validateAddress(sentAddr, 'sent', 'sentToSentnode');
  const { data } = fromBech32(sentAddr);
  return toBech32('sentnode', data);
}

export function sentprovToSent(provAddr) {
  validateAddress(provAddr, 'sentprov', 'sentprovToSent');
  const { data } = fromBech32(provAddr);
  return toBech32('sent', data);
}

/**
 * Compare two addresses across different bech32 prefixes (sent1, sentprov1, sentnode1).
 * Returns true if they derive from the same public key.
 * @param {string} addr1
 * @param {string} addr2
 * @returns {boolean}
 */
export function isSameKey(addr1, addr2) {
  try {
    const { data: d1 } = fromBech32(addr1);
    const { data: d2 } = fromBech32(addr2);
    return Buffer.from(d1).equals(Buffer.from(d2));
  } catch { return false; }
}
