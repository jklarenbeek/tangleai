import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadEvolveFixture } from '../../../benchmark/lib/evolve-fixture.ts';
import { withExperimentHost, runExperiment } from '../../../benchmark/lib/evolve-host.ts';
import { createMasStore } from '@tangleai/store';

it('a durable kept experiment leaves resolvable records and one review branch', async () => {
  const root = process.cwd(), fixture = await loadEvolveFixture(root);
  const files: Record<string, string> = {};
  for (const file of fixture.manifest.files) files[file.path] = await readFile(resolve(root, 'benchmark/fixtures/evolve/repo', file.path), 'utf8');
  const index = fixture.proposals.findIndex(p => p.document.id === 'improve-partial-select');
  const entry = fixture.proposals[index];
  await withExperimentHost(root, fixture, async host => {
    const protectedBefore = await host.protectedRefs();
    const baseBefore = await host.host.trackedDigest(host.repositoryRoot);
    const run = await runExperiment(fixture, {
      document: entry.document as never, index,
      budgets: { patchBytes: 0, patchFiles: 1, withinPatchBytes: true, withinPatchFiles: true },
      expect: fixture.manifest.proposals[index].expect,
    }, host, files);
    assert.equal(run.decision.decision, 'kept');
    const experiment = await host.evolveStore.getExperiment(entry.document.id);
    assert.ok(experiment.ok && experiment.value !== null);
    assert.equal(experiment.value.status, 'recorded');
    assert.deepEqual(experiment.value.history.map(h => h.to), ['isolated', 'applied', 'gated', 'measured', 'decided', 'recorded']);
    const bundles = await host.evolveStore.listRecords({ kind: 'review-bundle', experimentId: entry.document.id });
    assert.ok(bundles.ok && bundles.value.length === 1);
    const bundle = bundles.value[0];
    assert.ok(bundle.kind === 'review-bundle');
    for (const id of [...bundle.gateResultIds, bundle.measurementId, bundle.decisionId]) {
      const record = await host.evolveStore.getRecord(id);
      assert.ok(record.ok && record.value !== null, 'review evidence must resolve: ' + id);
      const replay = await host.evolveStore.putRecord(record.value);
      assert.ok(replay.ok);
      assert.equal(replay.value.writes, 0);
    }
    const trace = await createMasStore(host.db, { now: () => 'fixed' }).readTrace('evolve:' + entry.document.id);
    assert.equal(trace?.run.status, 'completed');
    assert.equal(trace?.interactions.length, run.lifecycle.interactions);
    assert.equal(trace?.interactions.filter(i => i.status === 'waiting').length, 0);
    assert.equal(await host.protectedRefs(), protectedBefore);
    assert.deepEqual(await host.host.trackedDigest(host.repositoryRoot), baseBefore);
    assert.equal(host.counters.branchesLeft, 1);
    assert.equal(host.counters.worktreesRemoved, 1);
  });
});
