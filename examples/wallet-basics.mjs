/**
 * wallet-basics.mjs — Create a Sentinel wallet and check balance
 *
 * Demonstrates wallet generation, import from mnemonic, and balance queries.
 * The Sentinel chain uses 'sent' prefix addresses and 'udvpn' (micro P2P) denomination.
 * 1 P2P = 1,000,000 udvpn.
 *
 * Usage:
 *   node wallet-basics.mjs                     # Generate new wallet
 *   MNEMONIC="word1 word2 ..." node wallet-basics.mjs  # Import existing wallet
 */

import {
  generateWallet,
  createWallet,
  createClient,
  getBalance,
  formatP2P,
  isMnemonicValid,
  DENOM,
  CHAIN_ID,
} from 'sentinel-dvpn-sdk';

async function main() {
  console.log(`Chain: ${CHAIN_ID} | Denom: ${DENOM}\n`);

  if (process.env.MNEMONIC) {
    // --- Import existing wallet ---
    const mnemonic = process.env.MNEMONIC;

    if (!isMnemonicValid(mnemonic)) {
      console.error('Invalid mnemonic. Must be 12 or 24 BIP39 words.');
      process.exit(1);
    }

    const { account } = await createWallet(mnemonic);
    console.log('Imported wallet:');
    console.log(`  Address: ${account.address}`);

    // Query on-chain balance
    const client = await createClient(mnemonic);
    const balance = await getBalance(client, account.address);
    console.log(`  Balance: ${formatP2P(balance.udvpn)} (${balance.udvpn} udvpn)`);
  } else {
    // --- Generate new wallet ---
    console.log('No MNEMONIC set — generating a new wallet.\n');

    const { mnemonic, account } = await generateWallet();
    console.log('New wallet generated:');
    console.log(`  Address:  ${account.address}`);
    console.log(`  Mnemonic: ${mnemonic}`);
    console.log(`  Balance:  ${formatP2P(0)} (new wallet, unfunded)`);
    console.log('\nSave your mnemonic securely. Fund this address with P2P tokens to use dVPN.');
    console.log('You can get P2P tokens from exchanges or the Sentinel community.');
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
