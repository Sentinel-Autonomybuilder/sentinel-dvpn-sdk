/**
 * query-nodes.mjs — Browse the Sentinel dVPN node network
 *
 * Query online nodes, filter by country/protocol/price, and display a formatted table.
 * No wallet or tokens needed — this is read-only chain data.
 *
 * Usage:
 *   node query-nodes.mjs
 *   node query-nodes.mjs --country germany
 *   node query-nodes.mjs --protocol wireguard
 *   node query-nodes.mjs --country US --max-price 0.1
 */

import {
  queryOnlineNodes,
  filterNodes,
  formatPriceP2P,
  countryNameToCode,
  getFlagEmoji,
  groupNodesByCountry,
} from 'sentinel-dvpn-sdk';

// Parse CLI flags
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : null;
const countryArg = flag('country');
const protocolArg = flag('protocol');       // 'wireguard' or 'v2ray'
const maxPriceArg = flag('max-price');      // max P2P per GB (e.g. 0.1)

async function main() {
  // 1. Query online nodes (probes each node for status — takes 5-15s)
  console.log('Scanning Sentinel network...');
  const nodes = await queryOnlineNodes({ maxNodes: 100 });
  console.log(`Found ${nodes.length} online nodes\n`);

  // 2. Apply filters
  let filtered = nodes;
  if (countryArg || protocolArg || maxPriceArg) {
    filtered = filterNodes(nodes, {
      country: countryArg || undefined,
      serviceType: protocolArg || undefined,
      maxPriceDvpn: maxPriceArg ? parseFloat(maxPriceArg) : undefined,
    });
    console.log(`After filters: ${filtered.length} nodes\n`);
  }

  // 3. Display as table
  console.log(
    'Address'.padEnd(20),
    'Country'.padEnd(16),
    'Proto'.padEnd(6),
    'Price/GB'.padEnd(12),
    'Price/Hr'.padEnd(12),
    'Peers'.padEnd(6),
    'Score',
  );
  console.log('-'.repeat(90));

  for (const node of filtered.slice(0, 30)) {
    const code = countryNameToCode(node.country);
    const emoji = code ? getFlagEmoji(code) : '  ';
    const gbPrice = node.gigabytePrices?.find(p => p.denom === 'udvpn');
    const hrPrice = node.hourlyPrices?.find(p => p.denom === 'udvpn');

    console.log(
      node.address.slice(0, 18).padEnd(20),
      `${emoji} ${(node.country || '?').slice(0, 12)}`.padEnd(16),
      (node.serviceType === 'wireguard' ? 'WG' : 'V2').padEnd(6),
      (gbPrice ? `${formatPriceP2P(gbPrice.quote_value || gbPrice.base_value)} P2P` : 'N/A').padEnd(12),
      (hrPrice ? `${formatPriceP2P(hrPrice.quote_value || hrPrice.base_value)} P2P` : 'N/A').padEnd(12),
      String(node.peers || 0).padEnd(6),
      String(node.qualityScore ?? '?'),
    );
  }

  // 4. Country summary
  console.log('\n--- Nodes by Country ---');
  const groups = groupNodesByCountry(
    filtered.map((n) => ({
      ...n,
      countryCode: countryNameToCode(n.country),
      flagEmoji: getFlagEmoji(countryNameToCode(n.country) || ''),
      online: true,
    })),
  );
  for (const g of groups.slice(0, 15)) {
    console.log(`  ${g.flagEmoji || '  '} ${(g.country || '?').padEnd(20)} ${g.onlineCount} nodes`);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
