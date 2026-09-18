import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createConsolidationSource, planDeterministicConsolidation, createConsolidationMemoryStore,
  applyDeterministicConsolidation, createConsolidationLexicalIndex, consolidationTerms, fuseConsolidationRanks } from '@tangleai/memory/consolidation';
import { consolidationMust as must } from '../../benchmark/lib/consolidate-store-probes.ts';
async function sources(texts: string[]) {
  return Promise.all(texts.map(async (text, sequence) => must(await createConsolidationSource({ scope: 'topics', key: `${sequence}`, sequence,
    snapshot: { id: `${sequence}`, text, evidence: `turn ${sequence}`, at: '2024-01-01T00:00:00Z', kind: 'event', tags: [] } }))));
}
it('segments hand-checked topic changes without changing source order or losing evidence', async () => {
  const input = await sources(['cat cat kitten', 'cat kitten', 'rocket space orbit', 'rocket orbit']);
  const plan = must(await planDeterministicConsolidation([...input].reverse()));
  assert.deepEqual(plan.artifacts.map(artifact => artifact.sourceIds), [input.slice(0, 2).map(source => source.id), input.slice(2).map(source => source.id)]);
  assert.deepEqual(plan.boundaries, [2]);
  assert.deepEqual(must(await planDeterministicConsolidation(input)), plan);
});
it('bounds final Unicode previews and reports over-limit input without artifacts', async () => {
  const input = await sources(['a'.repeat(9) + '😀' + 'x'.repeat(80)]);
  const plan = must(await planDeterministicConsolidation(input, { maxArtifactChars: 11 }));
  assert.ok(plan.artifacts[0].text.length <= 11);
  assert.doesNotThrow(() => encodeURIComponent(plan.artifacts[0].text));
  assert.deepEqual(plan.artifacts[0].sourceIds, input.map(source => source.id));
  assert.equal((await planDeterministicConsolidation(input, { maxInputChars: 1 })).status, 'refused');
  assert.equal((await planDeterministicConsolidation([])).status, 'refused');
  assert.equal((await planDeterministicConsolidation(input, { maxArtifactChars: NaN })).status, 'refused');
  const punctuation = await sources(['... 😀 !!!']);
  const singleton = must(await planDeterministicConsolidation(punctuation, { maxArtifactChars: 1 }));
  assert.equal(singleton.artifacts.length, 1);
  assert.ok(singleton.artifacts[0].text.length <= 1);
  assert.deepEqual(singleton.artifacts[0].sourceIds, [punctuation[0].id]);
});
it('activates actual deterministic artifacts once and retains every source on replay', async () => {
  const input = await sources(['Sam visited Paris.', 'Alex visited Paris.']); const store = createConsolidationMemoryStore();
  must(await store.enqueue(input, { maxPending: 2 }));
  const options = { key: 'deterministic', expectedGeneration: 0, completedAt: 1000 };
  must(await applyDeterministicConsolidation(store, input, options));
  const before = must(await store.snapshot('topics'));
  const replay = must(await applyDeterministicConsolidation(store, input, options));
  assert.equal(replay.writes, 0); assert.equal(replay.logicalCalls, 0); assert.equal(replay.embeddingItems, 0);
  assert.deepEqual(must(await store.snapshot('topics')), before); assert.equal(before.sources.length, 2);
});
it('uses the public Jaren lexical score with Unicode normalization and stable ties', () => {
  assert.deepEqual(consolidationTerms('CAFÉ cafe\u0301 １２３'), ['café', 'café', '123']);
  const index = createConsolidationLexicalIndex([{ id: 'a', text: 'cat' }, { id: 'b', text: 'dog' }]);
  assert.deepEqual(index.rank('cat'), [{ id: 'a', score: 1.5 * Math.log(2) }]);
  assert.deepEqual(index.rank('unseen'), []);
  assert.deepEqual(createConsolidationLexicalIndex([{ id: 'a', text: 'cat' }, { id: 'b', text: 'cat' }]).rank('cat').map(hit => hit.id), ['a', 'b']);
  // one vote per id per lane; an exact tie orders by code point id, not by first appearance
  assert.deepEqual(fuseConsolidationRanks([['b', 'b', 'a'], ['a', 'b']]), ['a', 'b']);
  assert.deepEqual(fuseConsolidationRanks([['c'], ['b']]), ['b', 'c']);
  const bounded = createConsolidationLexicalIndex([{ id: 'a', text: 'cat' }], { limits: { maxQueryBytes: 2 } });
  assert.throws(() => bounded.rank('cat'), /bound/);
  assert.throws(() => createConsolidationLexicalIndex([{ id: 'a', text: 'cat' }, { id: 'a', text: 'dog' }]), /Duplicate/);
});


it('uses lexical topic evidence instead of comparing different embedding spaces', async () => {
  const input = await sources(['cat kitten', 'cat kitten', 'rocket orbit', 'rocket orbit']);
  const mixed = await Promise.all(input.map(async (source, i) => must(await createConsolidationSource({ ...source,
    snapshot: { ...source.snapshot, embedding: [1, 0], embeddedBy: { model: i < 2 ? 'cats' : 'rockets', dims: 2 } } }))));
  const plan = must(await planDeterministicConsolidation(mixed));
  assert.equal(plan.artifacts.length, 2); assert.equal(plan.unknownEmbeddingPairs, 1);
});
