import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createExperientialMemoryStore, createExperientialOperations, experientialContractDocument, redactExperientialView,
  sealExperientialRetentionPolicy, type ExperientialResult, type ExperientialStore, type ExperientialLineage } from '@tangleai/experiential';
import { experientialStoreFixture, EXPERIENTIAL_FIXTURE_TIME } from './store-fixtures.ts';
import { accepted } from './identity-fixtures.ts';

const names = ['experiential.lineage', 'experiential.experiences', 'experiential.datasets', 'experiential.trainingruns',
  'experiential.artifacts', 'experiential.evaluations', 'experiential.deployments', 'experiential.retention'];
type Reply = Awaited<ReturnType<ReturnType<typeof createExperientialOperations>['invoke']>>;
function value<T>(response: Reply): T { assert.ok(response.ok, JSON.stringify(response)); return accepted(response.value as ExperientialResult<T>); }
const input = (name: string, artifactId: string, scope = 'fixture') => ({ scope,
  ...(name === 'experiential.lineage' ? { artifactId } : {}), ...(name === 'experiential.experiences' ? { state: null } : {}),
  ...(name === 'experiential.retention' ? { preview: null } : {}) });

it('exposes exactly eight native read operations and validates input before touching storage', async () => {
  let reads = 0;
  const store = new Proxy({}, { get() { reads++; throw Error('No malformed input may reach the store.'); } }) as ExperientialStore;
  const operations = createExperientialOperations(store);
  try {
    assert.ok(Object.isFrozen(operations));
    assert.deepEqual(operations.describe().operations.map((operation: { id: string; kind: string }) => [operation.id, operation.kind]), names.map(name => [name, 'read']));
    assert.ok(Object.values(experientialContractDocument.operations).every(operation => operation.kind === 'read'));
    const malformed = await operations.invoke('experiential.artifacts', { scope: 'fixture', approve: true });
    assert.equal(malformed.ok, false); if (!malformed.ok) assert.equal(malformed.error.code, 'JC2050');
    assert.equal((await operations.invoke('experiential.experiences', { scope: 'fixture', state: 'invented' })).ok, false);
    await assert.rejects(operations.invoke('experiential.activate', { scope: 'fixture' }), { code: 'JC1005' });
    assert.equal(reads, 0);
  } finally { await operations.close(); }
});

it('reads the complete active lineage and all inspection families from one transaction each without writes', async () => {
  const store = createExperientialMemoryStore({ now: () => EXPERIENTIAL_FIXTURE_TIME });
  const fixture = await experientialStoreFixture(store), operations = createExperientialOperations(store);
  try {
    const before = store.stats();
    const outputs = new Map<string, unknown>();
    for (const name of names) outputs.set(name, value(await operations.invoke(name, input(name, fixture.artifact.id))));
    assert.equal(store.stats().transactions - before.transactions, 8);
    assert.equal(store.stats().writes, before.writes); assert.equal(store.stats().activations, before.activations);
    const lineage = outputs.get('experiential.lineage') as ExperientialLineage;
    assert.equal(lineage.artifact.id, fixture.artifact.id); assert.equal(lineage.artifact.state, 'active');
    assert.equal(lineage.artifacts.length, 2); assert.equal(lineage.trainingRuns.length, 1);
    assert.equal(lineage.datasets.length, 1); assert.equal(lineage.assessments.length, 1); assert.equal(lineage.experiences.length, 1);
    assert.equal(lineage.externalBytes, 'not-resolved'); assert.ok(lineage.sourceRefs.length > 0);
    const deployments = outputs.get('experiential.deployments') as { heads: unknown[]; history: Array<{ kind: string }> };
    assert.equal(deployments.heads.length, 1); assert.ok(deployments.history.some(row => row.kind === 'artifact-activated'));
    const filtered = value<{ experiences: unknown[]; assessments: unknown[] }>(await operations.invoke('experiential.experiences', { scope: 'fixture', state: 'archived' }));
    assert.deepEqual(filtered, { experiences: [], assessments: [] });
    await operations.close();
    assert.equal((await operations.invoke('experiential.artifacts', { scope: 'fixture' })).ok, false);
    assert.ok((await store.get('artifacts', fixture.artifact.id)).ok);
  } finally { await operations.close(); await store.close(); }
});

it('removes log sentinels, credential-bearing locations and secret-shaped members from every read family', async () => {
  const store = createExperientialMemoryStore({ now: () => EXPERIENTIAL_FIXTURE_TIME });
  const fixture = await experientialStoreFixture(store), snapshot = structuredClone(accepted(await store.snapshot('fixture')));
  const sentinel = 'SENTINEL_INSPECTION_SECRET_713';
  snapshot.training_runs[0].logRefs = [{ sourceId: sentinel, digest: 'b'.repeat(64), kind: 'log' }];
  snapshot.training_runs[0].metricsRef = { sourceId: sentinel, digest: 'c'.repeat(64), kind: 'metrics' };
  snapshot.artifacts[0].storageUri = 'https://user:' + sentinel + '@artifact.example.test/path?key=' + sentinel;
  snapshot.artifacts[0].runtime.base = 'https://user:' + sentinel + '@runtime.example.test/v1?token=' + sentinel + '#' + sentinel;
  for (const rows of Object.values(snapshot)) for (const row of rows) Object.assign(row, { nestedCredential: { value: sentinel } });
  for (const event of snapshot.events) event.detail = sentinel;
  const injected: ExperientialStore = { ...store, async snapshot() { return { ok: true, value: snapshot, writes: 0, replayed: true }; } };
  const operations = createExperientialOperations(injected);
  try {
    for (const name of names) {
      const output = value<unknown>(await operations.invoke(name, input(name, fixture.artifact.id)));
      assert.ok(!JSON.stringify(output).includes(sentinel), name);
      assert.ok(!JSON.stringify(output).includes('storageUri'), name);
    }
    const training = value<{ logDigests: Array<{ digests: string[] }> }>(await operations.invoke('experiential.trainingruns', { scope: 'fixture' }));
    assert.deepEqual(training.logDigests[0].digests, ['b'.repeat(64)]);
    assert.equal(snapshot.training_runs[0].logRefs[0].sourceId, sentinel);
  } finally { await operations.close(); await store.close(); }
});

it('previews retention refusals with their dependency and grants no mutation authority', async () => {
  const store = createExperientialMemoryStore({ now: () => EXPERIENTIAL_FIXTURE_TIME });
  const fixture = await experientialStoreFixture(store), operations = createExperientialOperations(store);
  try {
    const policy = accepted(await sealExperientialRetentionPolicy({ decision: 'archive', rollbackWindowMs: 1000, holds: [],
      reason: 'Read-only dependency preview.', principal: fixture.approval.principal, evidence: fixture.experience.sourceRefs }));
    const before = store.stats();
    const output = value<{ preview: ExperientialResult<unknown> }>(await operations.invoke('experiential.retention', { scope: 'fixture',
      preview: { episodeIds: [fixture.experience.id], deploymentId: fixture.servingDeployment.id, now: Date.parse(EXPERIENTIAL_FIXTURE_TIME), policy } }));
    assert.equal(output.preview.ok, false);
    if (!output.preview.ok) {
      assert.equal(output.preview.issues[0].code, 'TEXP1012'); assert.ok(output.preview.issues[0].path.includes(fixture.artifact.id));
    }
    assert.equal(store.stats().writes, before.writes); assert.equal(store.stats().activations, before.activations);
    const missing = await operations.invoke('experiential.lineage', { scope: 'another-scope', artifactId: fixture.artifact.id });
    assert.ok(missing.ok); const result = missing.value as ExperientialResult<unknown>;
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.issues[0].code, 'TEXP1004');
  } finally { await operations.close(); await store.close(); }
});

it('detaches and freezes redacted views while omitting nested secret-shaped keys', () => {
  const input = { id: 'retained-id', rows: [{ apiKey: 'hidden', authorizationToken: 'hidden', public: { value: 1 } }] };
  const output = redactExperientialView(input) as { id: string; rows: Array<{ public: { value: number } }> };
  input.rows[0].public.value = 2;
  assert.deepEqual(output, { id: 'retained-id', rows: [{ public: { value: 1 } }] });
  assert.ok(Object.isFrozen(output)); assert.ok(Object.isFrozen(output.rows[0].public));
});

it('keeps ordinary base labels distinct from credential-bearing runtime endpoints', () => {
  const output = redactExperientialView({ base: 'frozen-base', nested: { base: 'arbitrary-label' },
    runtime: { provider: 'fixture', servedModel: 'model', base: 'https://user:secret@example.test/v1?key=secret#secret' } });
  assert.deepEqual(output, { base: 'frozen-base', nested: { base: 'arbitrary-label' },
    runtime: { provider: 'fixture', servedModel: 'model', base: 'https://example.test/v1' } });
});
