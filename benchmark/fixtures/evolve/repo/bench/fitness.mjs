/**
 * The fitness instrument: how many comparisons the ranking costs.
 *
 * The input is a fixed arithmetic permutation of 0..511 — no clock, no
 * randomness, no file read — so the number this prints is a property of
 * `src/rank.js` alone. One JSON line on stdout, nothing else.
 *
 *   node bench/fitness.mjs
 */

import { topK } from '../src/rank.js';

const SIZE = 512;
const K = 8;

const items = [];
for (let index = 0; index < SIZE; index += 1) {
  items.push({ id: `item-${String(index).padStart(3, '0')}`, score: (index * 269 + 137) % SIZE });
}

let comparisons = 0;
const top = topK(items, K, () => { comparisons += 1; });

if (top.length !== K) {
  process.stderr.write(`fitness: topK returned ${top.length} records, expected ${K}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({ metric: 'comparisons', value: comparisons })}\n`);
