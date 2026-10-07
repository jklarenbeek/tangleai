import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openTangleDb, createExperientialDbStore } from '@tangleai/store';
import { createExperientialOperations, sealExperientialRecord, planExperientialRollback } from '@tangleai/experiential';
import { runExperientialExample } from './experiential-example.mjs';
import { qualifyExperientialBrowser } from './experiential-browser.mjs';

globalThis.fetch = async () => { throw Error('Installed experiential consumer forbids network'); };
const directory = process.env.TANGLE_FIXTURE_DIRECTORY;
if (!directory) throw Error('Installed experiential consumer requires parent-owned scratch');
assert.match(import.meta.resolve('@tangleai/experiential/contract'), /\.js$/);
const guide = await readFile(new URL('./README.md', import.meta.resolve('@tangleai/experiential/package.json')), 'utf8');
assert.match(guide, /createExperientialOperations/);
assert.deepEqual(await qualifyExperientialBrowser(), { operations: 8, schemaClosed: true, stableShare: true, writes: 0 });
const database = join(directory, 'experiential.sqlite');
const result = await runExperientialExample({ storage: 'sqlite', database });
assert.equal(result.physicalRequests, 0); assert.equal(result.scientificApproval, false);
assert.equal(result.fakeSubmissions, 2); assert.equal(result.pins, 1000); assert.equal(result.routed, 241);
assert.equal(result.inFlightUnchanged, true); assert.equal(result.failedArtifactRetained, true);
const db = await openTangleDb({ path: database });
const store = createExperientialDbStore(db, { now: () => '2026-09-13T00:00:00.000Z' }), operations = createExperientialOperations(store);
const must = result => { assert.ok(result.ok, JSON.stringify(result)); return result.value; };
try {
  assert.equal((await db.integrityCheck()).ok, true);
  const scope = 'experiential-example', before = must(await store.snapshot(scope));
  const lineage = must(must(await operations.invoke('experiential.lineage', { scope, artifactId: result.previousArtifactId })));
  assert.equal(lineage.artifact.state, 'active'); assert.equal(lineage.experiences.length, 12);
  const deployments = must(must(await operations.invoke('experiential.deployments', { scope })));
  assert.equal(deployments.deployments[0].activeArtifactId, result.previousArtifactId);
  assert.equal(deployments.heads[0].head.revision, 3);
  assert.ok(deployments.history.some(event => event.kind === 'artifact-rolled-back'));
  assert.equal(before.pins.length, 1000);
  assert.deepEqual(must(await store.snapshot(scope)), before); assert.equal(store.stats().writes, 0);
  await operations.close();
  assert.equal(must(await store.list('artifacts', scope)).length, before.artifacts.length, 'closing an inspection client preserves its host store');
  const deployment = before.deployments[0], base = before.artifacts.find(a => a.id === deployment.baseArtifactId);
  const head = must(await store.head(scope, scope));
  const approval = must(await sealExperientialRecord('approval', {
    document: 'experiential-approval', schemaVersion: 1, scope, profile: scope, recordedAt: '2026-09-13T00:00:00.000Z',
    action: 'rollback', artifactId: base.id, evaluationId: null, baseDigest: deployment.base.digest,
    expectedHead: head.head, deploymentId: deployment.id, expectedDeploymentRevision: deployment.revision,
    rolloutFraction: null, principal: before.approvals[0].principal, reason: 'Installed package registered-base restore.' }));
  must(await store.put('approvals', approval));
  const plan = must(planExperientialRollback({ head, deployment, artifact: base, evaluation: null, approval, reason: approval.reason }));
  assert.deepEqual(must(await store.rollback(plan)).head, { versionId: null, revision: 4 });
  assert.deepEqual(must(await store.list('pins', scope)), before.pins);
  assert.deepEqual(must(await store.list('evaluations', scope)), before.evaluations);
  assert.deepEqual(must(await store.get('artifacts', base.id)), base);
  assert.equal((await store.rollback(plan)).writes, 0);
} finally { await operations.close(); await db.close(); }
const reopened = await openTangleDb({ path: database });
try {
  const retained = createExperientialDbStore(reopened, { now: () => '2026-09-13T00:00:00.000Z' });
  assert.deepEqual(must(await retained.head('experiential-example', 'experiential-example')).head, { versionId: null, revision: 4 });
} finally { await reopened.close(); }
const ticks = await runExperientialExample({ tick: true, database: join(directory, 'ticks.sqlite') });
assert.equal(ticks.fakeSubmissions, 1); assert.equal(ticks.newJobsOnReplay, 0);
assert.equal(ticks.scientificApproval, false); assert.equal(ticks.physicalRequests, 0);
assert.equal(ticks.counts.enqueued, 1); assert.equal(ticks.counts.replayed, 5);
console.log('Installed experiential: 1000 pins, learned and registered-base rollback, atomic read-only lineage and replayed cadence passed');
