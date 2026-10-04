import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createReplayTransport, createResearchHypotheses, executeResearchNovelty,
  type ResearchNoveltyPolicy } from '@tangleai/research';
import { checked } from './fixtures.ts';
import { memoryHarness, start, stored } from './store-harness.ts';
import { reasoningFixture } from './reasoning-fixtures.ts';
import { providerHost, transcript } from './discovery-fixtures.ts';

const policy: ResearchNoveltyPolicy = { criteriaId: 'novelty-identity-only', concurrency: 1, maxRequests: 8, maxBytes: 1048576,
  query: { provider: 'crossref', pages: 3, rows: 100, bytes: 262144, pageSize: 5 } };
async function fixture(missing = false) {
  const data = await reasoningFixture(), transcripts = [];
  for (const text of new Set(data.set.queries.map(row => row.query))) for (const page of [0, 1]) {
    const entry = await transcript('kmeans-seeding/crossref-' + page), url = new URL(entry.url);
    url.searchParams.set('query', text); entry.url = url.href; transcripts.push(entry);
  }
  const replay = await createReplayTransport(missing ? [] : transcripts, { scope: 'novelty-fixture' });
  return { ...data, replay };
}
it('novelty searches its own hypotheses only after durable plan admission and measures identifier overlap', async () => {
  const data = await fixture(), h = await memoryHarness(); let admittedId: string | null = null;
  try {
    await start(h.store);
    const provider = providerHost(async (request, context) => {
      assert.ok(admittedId);
      const plan = stored(await h.store.getRecord(data.set.projectId, 'QueryPlan', admittedId)); assert.ok(plan);
      assert.ok(plan.queries.some(row => row.text === new URL(request.url).searchParams.get('query')));
      return data.replay.transport(request, context);
    }, { now: () => 0 });
    const result = await executeResearchNovelty(data.set, policy, [data.literature], { provider, admitPlan: async plan => {
      stored(await h.store.putRecord(plan.projectId, { kind: 'QueryPlan', value: plan })); admittedId = plan.id;
    } }, new AbortController().signal);
    assert.deepEqual(result.plan.queries.map(row => row.text), data.set.queries.map(row => row.query).sort());
    assert.deepEqual(result.report.coverage, { attempted: 2, complete: 2, total: 2 });
    assert.deepEqual(result.report.overlapLiteratureIds, [data.literature.id]);
    assert.equal(result.report.gating, false); assert.deepEqual(result.report.advisory, data.set.advisory);
    assert.deepEqual(data.replay.stats(), { requests: 4, misses: 0, networkCalls: 0 });
    const changed = checked(await createResearchHypotheses(data.synthesis,
      { ...data.hypothesisProposal, advisory: { rating: 1, reason: 'A different model opinion.' } }, data.cards, ['control'], 'single-agent'));
    const second = await executeResearchNovelty(changed.set, policy, [data.literature], { provider,
      admitPlan: async plan => { stored(await h.store.putRecord(plan.projectId, { kind: 'QueryPlan', value: plan })); admittedId = plan.id; } }, new AbortController().signal);
    assert.deepEqual(second.report.coverage, result.report.coverage);
    assert.deepEqual(second.report.overlapLiteratureIds, result.report.overlapLiteratureIds);
    assert.equal(second.report.gating, false); assert.equal(second.report.advisory.rating, 1);
  } finally { await h.close(); }
});
it('a refused plan dispatches no novelty request', async () => {
  const data = await fixture();
  await assert.rejects(executeResearchNovelty(data.set, policy, [], { provider: providerHost(data.replay.transport),
    admitPlan: async () => { throw Error('Plan admission refused.'); } }, new AbortController().signal), /admission refused/);
  assert.deepEqual(data.replay.stats(), { requests: 0, misses: 0, networkCalls: 0 });
});
it('missing transcripts retain attempted but incomplete query coverage without a novelty verdict', async () => {
  const data = await fixture(true);
  const result = await executeResearchNovelty(data.set, policy, [data.literature], {
    provider: providerHost(data.replay.transport, { now: () => 0 }), admitPlan: async () => {},
  }, new AbortController().signal);
  assert.deepEqual(result.report.coverage, { attempted: 2, complete: 0, total: 2 });
  assert.deepEqual(result.report.overlapLiteratureIds, []); assert.equal(result.report.gating, false);
  assert.ok(result.receipt.outcomes.every(row => row.state === 'incomplete' && row.reason === 'replay-miss' && row.issues[0]?.code === 'TRSH1008'));
  assert.deepEqual(data.replay.stats(), { requests: 4, misses: 4, networkCalls: 0 });
});
