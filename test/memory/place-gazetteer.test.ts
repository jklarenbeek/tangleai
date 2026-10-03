import { it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeJson, canonicalSha256 } from '@jarenjs/json/canonical';
import { createGazetteer } from '@tangleai/memory/place';
import fixture from '../../benchmark/fixtures/place/gazetteer.json' with { type: 'json' };

async function document(entries = fixture.entries) {
  const copied = structuredClone(entries);
  return { id: 'sourced-place-fixture', revision: await canonicalSha256([...copied].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), entries: copied };
}

it('constructs a frozen sourced gazetteer without mutating or retaining mutable caller data', async () => {
  const input = await document([...fixture.entries].reverse()), before = canonicalizeJson(input);
  const result = await createGazetteer(input);
  if (result.status !== 'success') throw Error(result.detail);
  assert.equal(canonicalizeJson(input), before);
  assert.deepEqual(result.value.entries, fixture.entries);
  assert.equal(Object.isFrozen(result.value), true);
  assert.equal(Object.isFrozen(result.value.entries), true);
  assert.equal(Object.isFrozen(result.value.entries[0].source), true);
  assert.equal(Object.isFrozen(result.value.byName(' BALI ')), true);
  assert.equal(result.value.byName(' BALI ')[0].id, 'bali-island-q4648');
  const missing = result.value.byId('nowhere'); assert.equal(missing.status === 'refused' && missing.code, 'TPLC1004');
  assert.deepEqual(result.value.byName('no such place'), []);
  input.entries[0].names[0] = 'changed by caller';
  assert.equal(result.value.entries.some(entry => entry.names.includes('changed by caller')), false);
});

it('refuses absent sources, duplicate ids, changed revisions and swapped source coordinates', async () => {
  const input = await document();
  const absent = structuredClone(input) as unknown as { entries: Array<Record<string, unknown>> };
  delete absent.entries[0].source;
  const refused = await createGazetteer(absent); assert.equal(refused.status === 'refused' && refused.code, 'TPLC1003');
  const duplicate = await document([fixture.entries[0], fixture.entries[0]]);
  const dup = await createGazetteer(duplicate); assert.equal(dup.status === 'refused' && dup.code, 'TPLC1001');
  const wrong = await createGazetteer({ ...input, revision: '0'.repeat(64) }); assert.equal(wrong.status === 'refused' && wrong.code, 'TPLC1001');
  const moved = structuredClone(input); moved.entries[0].geometry.coordinates.reverse();
  const swapped = await createGazetteer(moved); assert.equal(swapped.status === 'refused' && swapped.code, 'TPLC1002');
  const synthetic = structuredClone(input) as unknown as { entries: Array<{ source: { kind: string } }> };
  synthetic.entries[0].source.kind = 'synthetic';
  const unsupported = await createGazetteer(synthetic); assert.equal(unsupported.status === 'refused' && unsupported.code, 'TPLC1003');
});

it('normalizes aliases with NFC, lowercase and whitespace without losing ambiguity or duplicating one entry', async () => {
  const entries = structuredClone(fixture.entries.slice(0, 2));
  entries[0].names = ['Café place', 'CAFE\u0301   PLACE']; entries[1].names = ['café place'];
  const result = await createGazetteer(await document(entries));
  if (result.status !== 'success') throw Error(result.detail);
  assert.deepEqual(result.value.byName('  CAFE\u0301\tPLACE  ').map(entry => entry.id), entries.map(entry => entry.id));
  assert.equal(result.value.byName('cafe place').length, 0, 'no fuzzy accent removal');
});
