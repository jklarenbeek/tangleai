import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createBudgetAccount } from '@tangleai/agents';
import { createScriptedPlanner, retrieveLightRag, lightragMust } from '@tangleai/lightrag';
import { loadLightRagFixture, createLightRagFixtureCorpus } from '../../benchmark/lib/lightrag.ts';
import { compareRankings, compareGraphRetrieval } from '../../benchmark/lib/vector-parity.ts';

it('ranking comparison preserves order, exact doubles and every skipped count', () => {
  const expected = { rows: [{ id: 'B', score: 0 }, { id: 'b', score: 0 }], skipped: { identity: 1, width: 2 } };
  assert.equal(compareRankings(expected, structuredClone(expected)).equal, true);
  assert.equal(compareRankings(expected, { ...expected, rows: [...expected.rows].reverse() }).equal, false);
  assert.equal(compareRankings(expected, { ...expected, rows: [{ id: 'B', score: -0 }, expected.rows[1]] }).equal, false);
  assert.equal(compareRankings(expected, { ...expected, skipped: { identity: 1, width: 1 } }).equal, false);
});
it('complete graph comparison covers resident and SQLite results and detects hidden observable changes', async () => {
  const fixture = await loadLightRagFixture(), resident = await createLightRagFixtureCorpus(fixture, { graph: 'memory' });
  const sqlite = await createLightRagFixtureCorpus(fixture, { graph: 'sqlite' });
  try {
    const planner = createScriptedPlanner(fixture.fixture.questions);
    for (const question of fixture.fixture.questions) {
      const plan = lightragMust(await planner(question.text, { mode: 'hybrid' }));
      const query = async (corpus: typeof resident) => lightragMust(await retrieveLightRag({ store: corpus.graph!,
        documents: corpus.store, embedder: corpus.embedder, plan, budget: createBudgetAccount({ turns: 4, tokens: 16000 }, () => 0), clock: () => 0 }));
      const expected = await query(resident), actual = await query(sqlite);
      assert.deepEqual(compareGraphRetrieval(expected, actual), { equal: true, differences: 0, paths: [] });
      for (const mutate of [
        (value: typeof actual) => { value.trace[0].score += Number.EPSILON; },
        (value: typeof actual) => { value.pruned++; },
        (value: typeof actual) => { value.bundle.text += 'changed'; },
        (value: typeof actual) => { value.graphRevision = 'f'.repeat(64); },
        (value: typeof actual) => { value.projectionIds.reverse(); },
        (value: typeof actual) => { value.citations[0].title += 'changed'; },
      ]) {
        const changed = structuredClone(actual); mutate(changed);
        assert.equal(compareGraphRetrieval(expected, changed).equal, false);
      }
    }
  } finally { await resident.close(); await sqlite.close(); }
});
