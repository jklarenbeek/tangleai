import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTemporalMemoryStore, validateSourceSpan } from '@tangleai/memory/temporal';
import { openTangleDb, createTemporalDbStore } from '@tangleai/store';
import { lmeFixture } from '../fixtures/longmemeval.ts';
import { longMemEvalViews } from '../../benchmark/lib/longmemeval.ts';
import { materializeLongMemEval } from '../../benchmark/lib/longmemeval-runtime.ts';
import { qualifyLongMemEvalRoundtrip } from '../../benchmark/lib/longmemeval-roundtrip.ts';
test('public materialization preserves repeated occurrences and source precision, with no evaluator handoff', async () => {
  const views = longMemEvalViews(lmeFixture(), 'strict-as-of'), materialized = await materializeLongMemEval(views.runtime);
  assert.equal(materialized.sources.length, 2); assert.notEqual(materialized.sources[0].id, materialized.sources[1].id);
  assert.ok(materialized.sources.every(s => s.observedAt.precision === 'minute' && s.observedAt.provenance === 'synthetic-UTC'));
  assert.deepEqual(Object.values(materialized.runtimeIds), views.runtime.occurrences.map(o => o.id));
  await assert.rejects(() => materializeLongMemEval({ ...views.runtime, answer: 'hidden gold' } as typeof views.runtime), /invalid or privileged/);
});
test('both source views roundtrip and replay identically through memory and real SQLite', async () => {
  const rows = [lmeFixture()], memory = await qualifyLongMemEvalRoundtrip(rows, async () => ({ store: createTemporalMemoryStore(), close: async () => {} }));
  const sqlite = await qualifyLongMemEvalRoundtrip(rows, async () => { const db = await openTangleDb(); return { store: createTemporalDbStore(db), close: () => db.close() }; });
  assert.deepEqual(sqlite, memory); assert.equal(memory.passed, 2);
  assert.equal(memory.counts['provided-history'].occurrences, 3); assert.equal(memory.counts['strict-as-of'].occurrences, 2);
  assert.equal(memory.activations, 2);
});
test('empty observed turns retain their identity and roundtrip without invented citation evidence', async () => {
  const row = lmeFixture(); row.haystack_sessions[1][0].content = '';
  const { runtime } = longMemEvalViews(row, 'strict-as-of');
  const { sources } = await materializeLongMemEval(runtime), source = sources.find(s => s.text === '')!;
  assert.ok(source); assert.equal(sources.length, 2);
  assert.notEqual(validateSourceSpan({ sourceId: source.id, sourceHash: source.sourceHash, start: 0, end: 0, quote: '' }, source, source.scope).status, 'success');
  const result = await qualifyLongMemEvalRoundtrip([row], async () => { const db = await openTangleDb(); return { store: createTemporalDbStore(db), close: () => db.close() }; });
  assert.equal(result.passed, 2); assert.equal(result.counts['provided-history'].occurrences, 3);
});
