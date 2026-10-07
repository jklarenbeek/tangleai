import assert from 'node:assert/strict';
import { it } from 'node:test';
import { join } from 'node:path';
import { openTangleDb, createExperientialDbStore } from '@tangleai/store';
import { resolveExperientialLineage, type ExperientialResult } from '@tangleai/experiential';
import { runRuntimeFixture } from '../../scripts/runtime-fixture.ts';

const must = <T>(result: ExperientialResult<T>): T => { assert.ok(result.ok, JSON.stringify(result)); return result.value; };
const scope = 'experiential-example';
for (const runtime of [process.execPath, 'bun']) it(`${runtime === 'bun' ? 'Bun' : 'Node'} persists one fake training job across two example tick cycles without approval or activation`, async () => {
  let retainedJob: string | undefined, retainedArtifact: string | undefined;
  const result = await runRuntimeFixture(runtime, ['test/experiential/tick-driver.fixture.ts'], {
    timeout: 60000, env: { NODE_TEST_CONTEXT: undefined },
    async afterExit(directory) {
      const db = await openTangleDb({ path: join(directory, 'ticks.sqlite'), jobs: {} });
      try {
        assert.equal((await db.integrityCheck()).ok, true);
        const store = createExperientialDbStore(db, { now: () => '2026-09-13T01:00:00.000Z' });
        const runs = must(await store.list('training_runs', scope)); assert.equal(runs.length, 1); assert.equal(runs[0].state, 'complete');
        retainedJob = runs[0].idempotencyKey; retainedArtifact = runs[0].progress!.artifactId!;
        const artifact = must(await store.get('artifacts', retainedArtifact)); assert.ok(artifact); assert.equal(artifact.state, 'staged');
        assert.equal(must(await resolveExperientialLineage(store, artifact.id)).experiences.length, 12);
        assert.deepEqual(must(await store.head(scope, scope)).head, { versionId: null, revision: 0 });
        for (const table of ['approvals', 'evaluations', 'pins'] as const) assert.equal(must(await store.list(table, scope)).length, 0);
        const [deployment] = must(await store.list('deployments', scope));
        assert.equal(deployment.activeArtifactId, null); assert.equal(deployment.canaryArtifactId, null);
        assert.equal((await db.jobs!.counts()).done, 1);
      } finally { await db.close(); }
    },
  });
  const row = JSON.parse(result.stdout);
  assert.equal(row.tier, 'synthetic-cadence-conformance'); assert.equal(row.storage, 'sqlite');
  assert.equal(row.scientificApproval, false); assert.equal(row.physicalRequests, 0); assert.equal(row.fakeSubmissions, 1);
  assert.equal(row.jobId, retainedJob); assert.equal(row.artifactId, retainedArtifact); assert.equal(row.newJobsOnReplay, 0);
  assert.deepEqual(row.firstCycle.map((r: { action: string }) => r.action), ['enqueued', 'replayed', 'replayed']);
  assert.deepEqual(row.secondCycle.map((r: { action: string }) => r.action), ['replayed', 'replayed', 'replayed']);
  assert.equal(row.counts.enqueued, 1); assert.equal(row.counts.replayed, 5); assert.equal(row.counts.noops, 2);
  assert.equal(row.counts.byReason.cadence, 1); assert.equal(row.counts.byReason['queue-full'], 1);
});
