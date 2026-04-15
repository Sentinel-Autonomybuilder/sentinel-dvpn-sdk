/**
 * Sentinel JS SDK — Fallback & Endpoint Rotation Test
 *
 * Tests that every query layer properly falls back:
 *   1. tryWithFallback() — endpoint rotation (tries all, returns first success)
 *   2. createRpcQueryClientWithFallback() — RPC endpoint rotation
 *   3. lcdQuery() — LCD endpoint rotation via tryWithFallback
 *   4. RPC-first query functions — RPC → LCD fallback
 *   5. Live integration — real queries through the full fallback chain
 *
 * Usage: node test/fallback-test.mjs
 */

import {
  tryWithFallback, RPC_ENDPOINTS, LCD_ENDPOINTS,
  addRpcEndpoint, removeRpcEndpoint,
  addLcdEndpoint, removeLcdEndpoint,
} from '../defaults.js';
import {
  createRpcQueryClientWithFallback, createRpcQueryClient,
  rpcQueryNodes, rpcQueryBalance, disconnectRpc,
} from '../chain/rpc.js';
import { lcd, lcdQuery, lcdQueryAll, lcdPaginatedSafe } from '../chain/lcd.js';
import {
  fetchActiveNodes, queryNode, getBalance as chainGetBalance,
  querySubscriptions, querySessionById, querySessionAllocation,
  findExistingSession, getNetworkOverview, getNodePrices,
} from '../chain/queries.js';
import {
  queryFeeGrants, queryFeeGrant, queryFeeGrantsIssued,
} from '../chain/fee-grants.js';

// ─── Config ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];
const t0 = Date.now();

function ok(name, detail) {
  passed++;
  console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name, err) {
  failed++;
  const msg = err?.message || String(err);
  failures.push({ name, msg });
  console.log(`  \x1b[31m✗\x1b[0m ${name} — ${msg}`);
}

// Known valid address for read-only queries
const TEST_ADDR = 'sent12e03wzmxjerwqt63p252cqs90jwfuwdd4fjhzg';
const TEST_NODE = 'sentnode1qqywpumwtxxgmg4xjae9se86msk30uf8m7d2we';

console.log('══════════════════════════════════════════');
console.log('  Sentinel JS SDK — Fallback Structure Test');
console.log('══════════════════════════════════════════');
console.log();

// ═══════════════════════════════════════════════════════════════════════════
// 1. tryWithFallback — core endpoint rotation
// ═══════════════════════════════════════════════════════════════════════════

console.log('─── 1. tryWithFallback() Core ───');

try {
  // Test: first endpoint fails, second succeeds
  const endpoints = [
    { url: 'https://dead.endpoint.invalid', name: 'Dead' },
    { url: 'https://also-dead.invalid', name: 'AlsoDead' },
    { url: LCD_ENDPOINTS[0].url, name: 'Live' },
  ];
  const { result, endpoint } = await tryWithFallback(endpoints, async (url) => {
    const res = await lcd(url, '/cosmos/bank/v1beta1/balances/' + TEST_ADDR);
    return res;
  }, 'fallback-rotation-test');
  if (result && result.balances) {
    ok('tryWithFallback skips dead endpoints, hits live one', `landed on: ${endpoint}`);
  } else {
    fail('tryWithFallback rotation', 'No balances in result');
  }
} catch (e) { fail('tryWithFallback rotation', e); }

try {
  // Test: all endpoints fail → throws ALL_ENDPOINTS_FAILED
  const deadEndpoints = [
    { url: 'https://dead1.invalid', name: 'Dead1' },
    { url: 'https://dead2.invalid', name: 'Dead2' },
  ];
  try {
    await tryWithFallback(deadEndpoints, async (url) => {
      await lcd(url, '/cosmos/bank/v1beta1/balances/' + TEST_ADDR);
    }, 'all-dead-test');
    fail('tryWithFallback all-fail', 'Should have thrown');
  } catch (err) {
    if (err.code === 'ALL_ENDPOINTS_FAILED') {
      ok('tryWithFallback throws ALL_ENDPOINTS_FAILED when all die', `${err.message.slice(0, 80)}...`);
    } else {
      fail('tryWithFallback all-fail error code', `Expected ALL_ENDPOINTS_FAILED, got: ${err.code}`);
    }
  }
} catch (e) { fail('tryWithFallback all-fail', e); }

try {
  // Test: first endpoint succeeds → never hits the rest
  let callCount = 0;
  const endpoints = [
    { url: LCD_ENDPOINTS[0].url, name: 'Primary' },
    { url: LCD_ENDPOINTS[1].url, name: 'Secondary' },
  ];
  const { endpoint } = await tryWithFallback(endpoints, async (url) => {
    callCount++;
    return await lcd(url, '/cosmos/bank/v1beta1/balances/' + TEST_ADDR);
  }, 'short-circuit-test');
  if (callCount === 1) {
    ok('tryWithFallback short-circuits on first success', `only called 1 of ${endpoints.length}`);
  } else {
    fail('tryWithFallback short-circuit', `Called ${callCount} endpoints instead of 1`);
  }
} catch (e) { fail('tryWithFallback short-circuit', e); }

console.log();

// ═══════════════════════════════════════════════════════════════════════════
// 2. RPC endpoint rotation
// ═══════════════════════════════════════════════════════════════════════════

console.log('─── 2. RPC Endpoint Rotation ───');

try {
  disconnectRpc(); // clear cache
  const rpc = await createRpcQueryClientWithFallback();
  if (rpc && rpc.url) {
    ok('createRpcQueryClientWithFallback', `connected to: ${rpc.url}`);
  } else {
    fail('createRpcQueryClientWithFallback', 'No client returned');
  }
} catch (e) { fail('createRpcQueryClientWithFallback', e); }

try {
  // Test: bad RPC URL → fallback to next
  disconnectRpc();
  const originalEndpoints = [...RPC_ENDPOINTS];
  // Prepend a dead endpoint
  addRpcEndpoint('https://dead-rpc.invalid:443', 'DeadRPC', true);
  const rpc = await createRpcQueryClientWithFallback();
  if (rpc && rpc.url !== 'https://dead-rpc.invalid:443') {
    ok('RPC skips dead endpoint, connects to live one', `landed on: ${rpc.url}`);
  } else {
    fail('RPC rotation', 'Connected to dead endpoint or failed');
  }
  // Cleanup: remove the dead endpoint we added
  removeRpcEndpoint('https://dead-rpc.invalid:443');
  disconnectRpc();
} catch (e) {
  removeRpcEndpoint('https://dead-rpc.invalid:443');
  disconnectRpc();
  fail('RPC rotation with dead endpoint', e);
}

console.log();

// ═══════════════════════════════════════════════════════════════════════════
// 3. lcdQuery() endpoint failover
// ═══════════════════════════════════════════════════════════════════════════

console.log('─── 3. lcdQuery() Endpoint Failover ───');

try {
  // lcdQuery with no lcdUrl → uses tryWithFallback(LCD_ENDPOINTS)
  const data = await lcdQuery(`/cosmos/bank/v1beta1/balances/${TEST_ADDR}`);
  if (data && data.balances) {
    ok('lcdQuery (auto-failover, no lcdUrl)', `${data.balances.length} balance(s)`);
  } else {
    fail('lcdQuery auto-failover', 'No balances');
  }
} catch (e) { fail('lcdQuery auto-failover', e); }

try {
  // lcdQuery with explicit lcdUrl → uses that one, no failover
  const data = await lcdQuery(`/cosmos/bank/v1beta1/balances/${TEST_ADDR}`, { lcdUrl: LCD_ENDPOINTS[0].url });
  if (data && data.balances) {
    ok('lcdQuery (explicit lcdUrl)', `used: ${LCD_ENDPOINTS[0].url}`);
  } else {
    fail('lcdQuery explicit lcdUrl', 'No balances');
  }
} catch (e) { fail('lcdQuery explicit lcdUrl', e); }

try {
  // lcdQuery with dead lcdUrl → should fail (no fallover when explicit URL provided)
  try {
    await lcdQuery(`/cosmos/bank/v1beta1/balances/${TEST_ADDR}`, { lcdUrl: 'https://dead-lcd.invalid' });
    fail('lcdQuery dead explicit URL', 'Should have thrown');
  } catch {
    ok('lcdQuery rejects on dead explicit lcdUrl (no silent fallover)', 'throws as expected');
  }
} catch (e) { fail('lcdQuery dead explicit URL test', e); }

console.log();

// ═══════════════════════════════════════════════════════════════════════════
// 4. RPC-first query functions — RPC → LCD fallback
// ═══════════════════════════════════════════════════════════════════════════

console.log('─── 4. RPC-first Query Functions ───');

// These all use the pattern: try RPC → catch → LCD fallback
// We test them in normal mode (RPC should succeed) to verify the path works

try {
  const nodes = await fetchActiveNodes(null, 50);
  if (Array.isArray(nodes) && nodes.length > 0) {
    ok('fetchActiveNodes (RPC-first)', `${nodes.length} nodes`);
  } else {
    fail('fetchActiveNodes', 'No nodes returned');
  }
} catch (e) { fail('fetchActiveNodes', e); }

try {
  const node = await queryNode(TEST_NODE);
  if (node && (node.address || node.remote_url)) {
    ok('queryNode (RPC-first)', `${node.address?.slice(0, 20) || node.remote_url?.slice(0, 30)}...`);
  } else {
    fail('queryNode', 'No node data');
  }
} catch (e) { fail('queryNode', e); }

try {
  const subs = await querySubscriptions(null, TEST_ADDR);
  ok('querySubscriptions (RPC-first)', `${subs?.length || 0} subscriptions`);
} catch (e) { fail('querySubscriptions', e); }

try {
  const grants = await queryFeeGrants(null, TEST_ADDR);
  ok('queryFeeGrants (RPC-first)', `${grants?.length || 0} grants`);
} catch (e) { fail('queryFeeGrants', e); }

try {
  const grant = await queryFeeGrant(null, TEST_ADDR, TEST_ADDR);
  ok('queryFeeGrant (RPC-first)', grant ? 'grant found' : 'no grant (expected)');
} catch (e) { fail('queryFeeGrant', e); }

try {
  const issued = await queryFeeGrantsIssued(null, TEST_ADDR);
  ok('queryFeeGrantsIssued (RPC-first)', `${issued?.length || 0} issued`);
} catch (e) { fail('queryFeeGrantsIssued', e); }

try {
  const overview = await getNetworkOverview();
  if (overview) {
    ok('getNetworkOverview (RPC-first)', `nodes=${overview.activeNodes || overview.totalNodes}, plans=${overview.totalPlans}`);
  } else {
    fail('getNetworkOverview', 'null result');
  }
} catch (e) { fail('getNetworkOverview', e); }

try {
  const prices = await getNodePrices(TEST_NODE);
  if (prices) {
    ok('getNodePrices (RPC-first, direct node lookup)', JSON.stringify(prices).slice(0, 80));
  } else {
    fail('getNodePrices', 'null result');
  }
} catch (e) { fail('getNodePrices', e); }

console.log();

// ═══════════════════════════════════════════════════════════════════════════
// 5. LCD-only functions that use endpoint failover
// ═══════════════════════════════════════════════════════════════════════════

console.log('─── 5. LCD Endpoint Failover in lcdPaginatedSafe / lcdQueryAll ───');

try {
  const data = await lcdQueryAll('/sentinel/node/v3/nodes?status=1', { limit: 10 });
  if (data.items && data.items.length > 0) {
    ok('lcdQueryAll (auto-failover)', `${data.items.length} nodes, chain total=${data.total}`);
  } else {
    fail('lcdQueryAll', 'Empty result');
  }
} catch (e) { fail('lcdQueryAll auto-failover', e); }

try {
  // lcdPaginatedSafe uses bare lcd() with baseLcd — no auto-failover
  // This is a known limitation, not a bug (it takes explicit lcdUrl)
  const data = await lcdPaginatedSafe(LCD_ENDPOINTS[0].url, '/sentinel/node/v3/nodes?status=1', 'nodes', { limit: 10 });
  if (data.items && data.items.length > 0) {
    ok('lcdPaginatedSafe (explicit lcdUrl)', `${data.items.length} nodes`);
  } else {
    fail('lcdPaginatedSafe', 'Empty result');
  }
} catch (e) { fail('lcdPaginatedSafe', e); }

console.log();

// ═══════════════════════════════════════════════════════════════════════════
// 6. Forced LCD fallback — verify LCD path works when RPC is unavailable
// ═══════════════════════════════════════════════════════════════════════════

console.log('─── 6. Forced LCD Fallback (RPC bypassed) ───');

try {
  // Direct LCD query to verify the LCD path works independently
  const data = await lcd(LCD_ENDPOINTS[0].url, `/sentinel/node/v3/nodes/${TEST_NODE}`);
  if (data && data.node) {
    ok('Direct LCD query (node lookup)', `${data.node.address?.slice(0, 20) || 'found'}...`);
  } else {
    fail('Direct LCD query', 'No node data');
  }
} catch (e) { fail('Direct LCD node query', e); }

try {
  const data = await lcd(LCD_ENDPOINTS[0].url, `/cosmos/bank/v1beta1/balances/${TEST_ADDR}`);
  if (data && data.balances) {
    ok('Direct LCD query (balance)', `${data.balances.length} balance(s)`);
  } else {
    fail('Direct LCD balance', 'No balances');
  }
} catch (e) { fail('Direct LCD balance query', e); }

try {
  const data = await lcd(LCD_ENDPOINTS[0].url, `/sentinel/session/v3/accounts/${TEST_ADDR}/sessions`);
  ok('Direct LCD query (sessions)', `${(data.sessions || []).length} sessions`);
} catch (e) { fail('Direct LCD sessions query', e); }

try {
  const data = await lcd(LCD_ENDPOINTS[0].url, `/cosmos/feegrant/v1beta1/allowances/${TEST_ADDR}`);
  ok('Direct LCD query (fee grants)', `${(data.allowances || []).length} grants`);
} catch (e) { fail('Direct LCD fee grants query', e); }

console.log();

// ═══════════════════════════════════════════════════════════════════════════
// 7. Endpoint management (runtime add/remove)
// ═══════════════════════════════════════════════════════════════════════════

console.log('─── 7. Runtime Endpoint Management ───');

try {
  const originalRpcCount = RPC_ENDPOINTS.length;
  addRpcEndpoint('https://test-rpc.example.com', 'TestRPC');
  if (RPC_ENDPOINTS.length === originalRpcCount + 1) {
    ok('addRpcEndpoint', `${originalRpcCount} → ${RPC_ENDPOINTS.length}`);
  } else {
    fail('addRpcEndpoint', 'Count unchanged');
  }
  // Duplicate should be skipped
  addRpcEndpoint('https://test-rpc.example.com', 'TestRPCDuplicate');
  if (RPC_ENDPOINTS.length === originalRpcCount + 1) {
    ok('addRpcEndpoint deduplicates', 'duplicate skipped');
  } else {
    fail('addRpcEndpoint dedup', `Expected ${originalRpcCount + 1}, got ${RPC_ENDPOINTS.length}`);
  }
  removeRpcEndpoint('https://test-rpc.example.com');
  if (RPC_ENDPOINTS.length === originalRpcCount) {
    ok('removeRpcEndpoint', `back to ${originalRpcCount}`);
  } else {
    fail('removeRpcEndpoint', `Expected ${originalRpcCount}, got ${RPC_ENDPOINTS.length}`);
  }
} catch (e) { fail('RPC endpoint management', e); }

try {
  const originalLcdCount = LCD_ENDPOINTS.length;
  addLcdEndpoint('https://test-lcd.example.com', 'TestLCD', true); // prepend
  if (LCD_ENDPOINTS[0].url === 'https://test-lcd.example.com') {
    ok('addLcdEndpoint (prepend=true)', 'inserted at front');
  } else {
    fail('addLcdEndpoint prepend', 'Not at front');
  }
  removeLcdEndpoint('https://test-lcd.example.com');
  if (LCD_ENDPOINTS.length === originalLcdCount) {
    ok('removeLcdEndpoint', `back to ${originalLcdCount}`);
  } else {
    fail('removeLcdEndpoint', `Expected ${originalLcdCount}, got ${LCD_ENDPOINTS.length}`);
  }
} catch (e) { fail('LCD endpoint management', e); }

console.log();

// ═══════════════════════════════════════════════════════════════════════════
// 8. Endpoint health summary
// ═══════════════════════════════════════════════════════════════════════════

console.log('─── 8. Endpoint Health Check ───');

// Check all RPC endpoints
for (const ep of RPC_ENDPOINTS) {
  try {
    disconnectRpc();
    const client = await createRpcQueryClient(ep.url);
    // Quick query to verify it works
    const nodes = await rpcQueryNodes(client, { status: 1, limit: 1 });
    if (nodes && nodes.length > 0) {
      ok(`RPC ${ep.name}`, `${ep.url} — alive`);
    } else {
      fail(`RPC ${ep.name}`, 'Connected but query returned empty');
    }
    disconnectRpc();
  } catch (e) {
    fail(`RPC ${ep.name}`, `${ep.url} — ${e.message.slice(0, 60)}`);
    disconnectRpc();
  }
}

// Check all LCD endpoints
for (const ep of LCD_ENDPOINTS) {
  try {
    const data = await lcd(ep.url, `/cosmos/bank/v1beta1/balances/${TEST_ADDR}`);
    if (data?.balances) {
      ok(`LCD ${ep.name}`, `${ep.url} — alive`);
    } else {
      fail(`LCD ${ep.name}`, 'Connected but no data');
    }
  } catch (e) {
    fail(`LCD ${ep.name}`, `${ep.url} — ${e.message.slice(0, 60)}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Results
// ═══════════════════════════════════════════════════════════════════════════

console.log();
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log('══════════════════════════════════════════');
console.log(`  RESULTS: ${passed} passed, ${failed} failed (${elapsed}s)`);
if (failures.length > 0) {
  console.log();
  console.log('  Failures:');
  for (const f of failures) {
    console.log(`    ${f.name}: ${f.msg}`);
  }
}
console.log('══════════════════════════════════════════');

disconnectRpc(); // cleanup
process.exit(failed > 0 ? 1 : 0);
