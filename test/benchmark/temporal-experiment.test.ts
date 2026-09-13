import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTemporalMemoryStore, createTemporalClaim, createTemporalProjection, citeSource, temporalValue, type TemporalQuery } from '@tangleai/memory/temporal';
import { lmeFixture } from '../fixtures/longmemeval.ts';
import { longMemEvalViews } from '../../benchmark/lib/longmemeval.ts';
import { temporalMatrixInput, runTemporalMatrix, temporalOracleRows, runTemporalKeyless } from '../../benchmark/lib/temporal-experiment.ts';
import { TEMPORAL_ROWS, TEMPORAL_CONTROLS } from '../../benchmark/lib/temporal-registration.ts';

async function fixture() {
  const raw = lmeFixture(); raw.haystack_sessions[1][0].content = 'Alex lives on Elm from February 29 through March 2, 2024.';
  const { runtime, evaluator } = longMemEvalViews(raw, 'strict-as-of'), input = await temporalMatrixInput(runtime), source = input.sources[0];
  const claim = temporalValue(await createTemporalClaim({ scope: runtime.scope, series: { subject: 'alex', key: 'address' }, value: 'Elm',
    time: { kind: 'state', from: '2024-02-29T00:00:00Z', until: { kind: 'at', at: '2024-03-03T00:00:00Z' }, precision: 'day' }, status: 'accepted',
    citations: [temporalValue(citeSource(source))], derivation: { method: 'host-asserted', identity: 'independent-fixture' } }, input.sources));
  const store = createTemporalMemoryStore();
  const bundle = temporalValue(await createTemporalProjection({ scope: runtime.scope, sources: input.sources, claims: [claim], knowledge: { mode: 'strict-as-of', cutoff: runtime.anchor.at },
    sourceIdentity: runtime.viewId, viewIdentity: runtime.viewId, policyIdentity: 'matrix-fixture', modelIdentity: 'host', promptIdentity: 'none', embeddedBy: TEMPORAL_CONTROLS.embedder,
    embeddings: [...input.vectors].map(([sourceId, vector]) => ({ sourceId, vector })), complete: true }));
  const head = temporalValue(await store.apply(bundle, { key: 'prepare', expectedHead: null })).head;
  const query: TemporalQuery = { scope: runtime.scope, text: runtime.question, anchor: source.observedAt, knowledge: bundle.projection.knowledge, operation: { kind: 'at', at: runtime.anchor.at },
    subject: 'alex', series: 'address', embeddedBy: TEMPORAL_CONTROLS.embedder, embedding: input.embedding, candidatePool: 100, k: 10, minScore: 0, expectedHead: head };
  query.anchor = { ...source.observedAt, at: runtime.anchor.at, raw: runtime.anchor.raw };
  return { input: { ...input, store, query }, evaluator };
}
test('all eight matrix rows execute public selectors with one shared semantic pool and distinct observation semantics', async () => {
  const { input, evaluator } = await fixture();
  const rows = [...await runTemporalMatrix(input), ...await temporalOracleRows(input, evaluator, input.query)];
  assert.deepEqual(rows.map(r => r.row), TEMPORAL_ROWS); assert.ok(rows.every(r => r.status === 'measured'));
  assert.deepEqual(rows[0].selectedIds, rows[1].selectedIds);
  for (const row of rows.slice(2, 6)) assert.deepEqual(row.poolIds, rows[2].poolIds);
  assert.equal(rows[3].selectedIds.length, 0); assert.equal(rows[4].selectedIds.length, 1); assert.ok(rows[5].kernel?.includes('Elm'));
  assert.ok(rows.every(r => r.bytes <= input.contextBytes));
  assert.deepEqual(rows, [...await runTemporalMatrix(input), ...await temporalOracleRows(input, evaluator, input.query)]);
});
test('mismatched pools, source views, anchors and hidden context budgets refuse before comparison', async () => {
  const { input } = await fixture();
  for (const changed of [ { ...input, query: { ...input.query, candidatePool: 101 } }, { ...input, contextBytes: 12001 },
    { ...input, sources: input.sources.slice(1) }, { ...input, query: { ...input.query, anchor: null } } ]) await assert.rejects(() => runTemporalMatrix(changed));
  const vectors = new Map(input.vectors); vectors.set(input.sources[0].id, Array(512).fill(1));
  await assert.rejects(() => runTemporalMatrix({ ...input, vectors }), /embedding pool/);
});
test('context trimming is counted and cannot leave a computed answer without its cited source', async () => {
  const { input } = await fixture(), rows = await runTemporalMatrix({ ...input, contextBytes: 1 });
  assert.equal(rows[0].selectedIds.length, 0); assert.ok(rows[0].trimmed > 0);
  assert.equal(rows[5].status, 'refused'); assert.equal(rows[5].reason, 'context-budget'); assert.equal(rows[5].kernel, null);
});
test('keyless external rows preserve failed, abstaining and inaccessible-gold denominators without inventing model quality', async () => {
  const row = lmeFixture({ question_id: 'answerable' }), a = await runTemporalKeyless([row], []), b = await runTemporalKeyless([row], []);
  assert.deepEqual(a, b); assert.equal(a.physicalRequests, 0); assert.equal(a.questions.length, 2);
  for (const q of a.questions) { assert.equal(q.rows.length, 8); assert.equal(q.futureGold, true); assert.equal(q.rows.filter(r => r.status === 'unmeasured').length, 4); }
  const absoluteFuture = lmeFixture({ question_id: 'future', question_date: '2024/02/01 (Thu) 12:00' });
  const empty = await runTemporalKeyless([absoluteFuture], []);
  const strict = empty.questions.find(q => q.profile === 'strict-as-of')!;
  assert.equal(strict.occurrences, 0); assert.equal(strict.rows[0].retrieval!.recallAny, 0); assert.equal(strict.rows[6].retrieval!.recallAll, 0);
});
