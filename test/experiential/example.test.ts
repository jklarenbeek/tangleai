import assert from 'node:assert/strict';
import { it } from 'node:test';
import { join } from 'node:path';
import { openTangleDb, createExperientialDbStore } from '@tangleai/store';
import { resolveExperientialLineage, type ExperientialResult } from '@tangleai/experiential';
import { runRuntimeFixture } from '../../scripts/runtime-fixture.ts';

const must = <T>(result: ExperientialResult<T>): T => { assert.ok(result.ok, JSON.stringify(result)); return result.value; };
const scope = 'experiential-example';
const previousId = 'c236c9709a5ddc79638c51b1b296be6c1f62bdd4a9649ab927bf07e1fac3391b';
const candidateId = '651aaa1cdab0a025d6f09ad4f8eb2d4470c848a5e6182b12c98c03bd0528848e';

for (const runtime of [process.execPath, 'bun']) it(`${runtime === 'bun' ? 'Bun' : 'Node'} completes the keyless deployment example and retains its rollback after process exit`, async () => {
  const result = await runRuntimeFixture(runtime, ['test/experiential/example-driver.fixture.ts'], {
    timeout: 300000, env: { NODE_TEST_CONTEXT: undefined },
    async afterExit(directory) {
      const db = await openTangleDb({ path: join(directory, 'example.sqlite') });
      try {
        assert.equal((await db.integrityCheck()).ok, true);
        const store = createExperientialDbStore(db, { now: () => '2026-09-13T00:00:00.000Z' });
        const pins = must(await store.list('pins', scope));
        const previous = must(await store.get('artifacts', previousId));
        const candidate = must(await store.get('artifacts', candidateId));
        assert.ok(previous); assert.ok(candidate);
        assert.notEqual(previous.runtime.servedModel, candidate.runtime.servedModel);
        assert.equal(pins.length, 1000); assert.equal(new Set(pins.map(pin => pin.runId)).size, 1000);
        assert.equal(pins.filter(pin => pin.canary).length, 241);
        assert.ok(pins.filter(pin => pin.canary).every(pin => pin.artifactId === candidateId && pin.servedModel === candidate.runtime.servedModel));
        assert.ok(pins.filter(pin => !pin.canary).every(pin => pin.artifactId === previousId && pin.servedModel === previous.runtime.servedModel));
        assert.deepEqual(must(await store.head(scope, scope)).head, { versionId: previousId, revision: 3 });
        const [deployment] = must(await store.list('deployments', scope));
        assert.equal(deployment.activeArtifactId, previousId); assert.equal(deployment.canaryArtifactId, null);
        assert.equal(deployment.rollbackReason, 'Restore the exact synthetic predecessor after the operational drill.');
        assert.equal(previous.state, 'active'); assert.equal(candidate.state, 'archived');
        assert.equal(must(await resolveExperientialLineage(store, candidateId)).experiences.length, 12);
        assert.equal(must(await store.list('training_runs', scope)).filter(run => run.state === 'complete').length, 2);
      } finally { await db.close(); }
    },
  });
  const row = JSON.parse(result.stdout);
  assert.equal(row.tier, 'synthetic-deployment-conformance'); assert.equal(row.scientificApproval, false);
  assert.equal(row.physicalRequests, 0); assert.equal(row.fakeSubmissions, 2);
  assert.equal(row.previousArtifactId, previousId); assert.equal(row.candidateArtifactId, candidateId);
  assert.equal(row.routed, 241); assert.equal(row.pins, 1000);
  assert.equal(row.inFlightUnchanged, true); assert.equal(row.failedArtifactRetained, true);
});
