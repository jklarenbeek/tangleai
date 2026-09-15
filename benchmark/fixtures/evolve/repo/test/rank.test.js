/**
 * The gate. Correctness on hand-written inputs that the fitness script never
 * uses, plus the generated table's drift check — so an implementation cannot
 * buy a cheaper fitness number by getting the ranking wrong, and a generated
 * file cannot drift away from the source it claims to come from.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { topK } from '../src/rank.js';
import { renderTable } from '../scripts/generate-table.mjs';
import { TIERS, tierOf } from '../src/generated/table.js';

const RECORDS = [
  { id: 'e', score: 12 },
  { id: 'a', score: 41 },
  { id: 'c', score: 41 },
  { id: 'd', score: 7 },
  { id: 'b', score: 33 },
];

test('topK ranks by score and breaks ties by id', () => {
  assert.deepEqual(topK(RECORDS, 3).map((record) => record.id), ['a', 'c', 'b']);
});

test('topK returns every record when k exceeds the input', () => {
  assert.deepEqual(topK(RECORDS, 99).map((record) => record.id), ['a', 'c', 'b', 'e', 'd']);
});

test('topK returns nothing for k of zero and refuses a negative k', () => {
  assert.deepEqual(topK(RECORDS, 0), []);
  assert.throws(() => topK(RECORDS, -1), TypeError);
});

test('topK leaves its input untouched', () => {
  const input = RECORDS.map((record) => ({ ...record }));
  topK(input, 2);
  assert.deepEqual(input.map((record) => record.id), ['e', 'a', 'c', 'd', 'b']);
});

test('every comparison reaches the injected counter', () => {
  let comparisons = 0;
  topK(RECORDS, 2, () => { comparisons += 1; });
  assert.ok(comparisons > 0, 'a ranking that counts nothing cannot be measured');
});

test('the generated tier table reproduces from its source', async () => {
  const source = JSON.parse(await readFile(new URL('../src/table-source.json', import.meta.url), 'utf8'));
  const current = await readFile(new URL('../src/generated/table.js', import.meta.url), 'utf8');
  assert.equal(current, renderTable(source), 'src/generated/table.js drifted from src/table-source.json');
  assert.deepEqual(TIERS.map((tier) => tier.id), source.tiers.map((tier) => tier.id));
  assert.equal(tierOf(500), 'gold');
  assert.equal(tierOf(0), 'plain');
});
