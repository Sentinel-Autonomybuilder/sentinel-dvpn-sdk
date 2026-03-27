/**
 * Sentinel SDK — Wallet Module
 *
 * Wallet creation, mnemonic validation, key derivation, and address prefix
 * conversion for the Sentinel dVPN chain.
 *
 * Usage:
 *   import { createWallet, generateWallet, privKeyFromMnemonic } from './wallet/index.js';
 *   import { Wallet } from './wallet/index.js';
 *
 *   const { wallet, account } = await createWallet(mnemonic);
 *   const { mnemonic, wallet, account } = await Wallet.generate();
 *   const provAddr = Wallet.toProvider(account.address);
 */

import { Bip39, EnglishMnemonic, Slip10, Slip10Curve, Random } from '@cosmjs/crypto';
import { makeCosmoshubPath } from '@cosmjs/amino';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { fromBech32, toBech32 } from '@cosmjs/encoding';
import { ValidationError, ErrorCodes } from '../errors/index.js';

// ─── Input Validation Helpers ────────────────────────────────────────────────

/**
 * Validate a BIP39 mnemonic string. Returns true if valid, false if not.
 * Use this to enable/disable a "Connect" button in your UI.
 *
 * @param {string} mnemonic - The mnemonic to validate
 * @returns {boolean} True if the mnemonic is a valid 12+ word string
 *
 * @example
 *   if (isMnemonicValid(userInput)) showConnectButton();
 */
export function isMnemonicValid(mnemonic) {
  return typeof mnemonic === 'string' && mnemonic.trim().split(/\s+/).length >= 12;
}

/**
 * Validate a mnemonic and throw ValidationError if invalid.
 * Used internally by createWallet, privKeyFromMnemonic, etc.
 * Also exported for use by the chain module.
 *
 * @param {string} mnemonic - The mnemonic to validate
 * @param {string} fnName - Calling function name (for error messages)
 * @throws {ValidationError} If mnemonic is not a 12+ word string
 */
export function validateMnemonic(mnemonic, fnName) {
  if (!isMnemonicValid(mnemonic)) {
    throw new ValidationError(ErrorCodes.INVALID_MNEMONIC,
      `${fnName}(): mnemonic must be a 12+ word BIP39 string`,
      { wordCount: typeof mnemonic === 'string' ? mnemonic.trim().split(/\s+/).length : 0 });
  }
}

/**
 * Validate a bech32 address has the expected prefix.
 * Used internally by address conversion functions.
 * Also exported for use by the chain module.
 *
 * @param {string} addr - The address to validate
 * @param {string} prefix - Expected bech32 prefix (e.g. 'sent', 'sentprov')
 * @param {string} fnName - Calling function name (for error messages)
 * @throws {ValidationError} If address doesn't start with expected prefix
 */
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

// ─── Wallet Class (convenience wrapper) ─────────────────────────────────────

/**
 * Static utility class wrapping all wallet functions.
 *
 * @example
 *   const { wallet, account } = await Wallet.create(mnemonic);
 *   const { mnemonic, wallet, account } = await Wallet.generate();
 *   const privKey = await Wallet.derivePrivKey(mnemonic);
 *   if (Wallet.isValid(input)) { ... }
 *   const provAddr = Wallet.toProvider(sentAddr);
 *   const nodeAddr = Wallet.toNode(sentAddr);
 *   const sentAddr = Wallet.toAccount(provAddr);
 */
export class Wallet {
  static async create(mnemonic) { return createWallet(mnemonic); }
  static async generate(strength) { return generateWallet(strength); }
  static async derivePrivKey(mnemonic) { return privKeyFromMnemonic(mnemonic); }
  static isValid(mnemonic) { return isMnemonicValid(mnemonic); }
  static toProvider(addr) { return sentToSentprov(addr); }
  static toNode(addr) { return sentToSentnode(addr); }
  static toAccount(addr) { return sentprovToSent(addr); }
}
