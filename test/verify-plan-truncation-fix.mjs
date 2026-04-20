#!/usr/bin/env node
/**
 * Verifies rpcQueryNodes and rpcQueryNodesForPlan no longer truncate silently.
 * Read-only mainnet query.
 */
import { createRpcQueryClient, rpcQueryNodes, rpcQueryNodesForPlan } from '../chain/rpc.js';

const PLAN = Number(process.argv[2] || 36);

console.log('\n── SDK truncation fix verification ───────────────────────\n');

const client = await createRpcQueryClient();

const t1 = Date.now();
const globalNodes = await rpcQueryNodes(client);
console.log(`rpcQueryNodes() → ${globalNodes.length} nodes (${Date.now() - t1}ms)`);

const t2 = Date.now();
const planNodes = await rpcQueryNodesForPlan(client, PLAN);
console.log(`rpcQueryNodesForPlan(${PLAN}) → ${planNodes.length} nodes (${Date.now() - t2}ms)`);

console.log('');
// Plan 36 had 803 active nodes on 2026-04-19. Old default (limit=500) returned 500.
// New default (limit=10000) should return 803+.
if (planNodes.length > 500) {
  console.log(`✓ PASS: plan ${PLAN} returned ${planNodes.length} > 500 — truncation fixed.`);
} else if (planNodes.length === 500) {
  console.log(`✗ FAIL: plan ${PLAN} still returning exactly 500 — fix not applied.`);
  process.exit(1);
} else {
  console.log(`? INCONCLUSIVE: plan ${PLAN} has only ${planNodes.length} active nodes — can't prove truncation is gone from this plan alone.`);
}
if (globalNodes.length > 500) {
  console.log(`✓ PASS: global rpcQueryNodes returned ${globalNodes.length} > 500.`);
} else if (globalNodes.length === 500) {
  console.log(`✗ FAIL: global rpcQueryNodes returning exactly 500 — fix not applied.`);
  process.exit(1);
}
console.log('');
process.exit(0);
