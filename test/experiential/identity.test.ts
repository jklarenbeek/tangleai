import { it } from 'node:test';
import assert from 'node:assert/strict';
import { checkExperientialRecord, experientialRecordId, experientialHeadKey, experientialRevisionOf,
  sealExperientialRecord, type ExperientialRecordKind } from '@tangleai/experiential';
import { experientialSchemaFixtures } from './schema-fixtures.ts';
import { accepted, addressedFixture } from './identity-fixtures.ts';

for (const kind of Object.keys(experientialSchemaFixtures()) as ExperientialRecordKind[]) {
  it(`${kind} identity is canonical, excludes observation time and binds scope`, async () => {
    const row = await addressedFixture(kind);
    assert.equal(accepted(await checkExperientialRecord(kind, row)).id, row.id);
    const reordered = Object.fromEntries(Object.entries(row).reverse());
    assert.equal(accepted(await checkExperientialRecord(kind, reordered)).id, row.id);
    const changedTime = { ...row, recordedAt: '2026-10-05T10:00:00.000Z' };
    assert.equal(accepted(await checkExperientialRecord(kind, changedTime)).id, row.id);
    const changedScope = await checkExperientialRecord(kind, { ...row, scope: 'different' });
    assert.equal(changedScope.ok, false);
    if (!changedScope.ok) assert.equal(changedScope.issues[0].code, 'TEXP1002');
    const forged = await checkExperientialRecord(kind, { ...row, id: 'f'.repeat(64) });
    assert.equal(forged.ok, false);
    if (!forged.ok) assert.equal(forged.issues[0].code, 'TEXP1002');
    assert.ok(Object.isFrozen(row));
  });
}

it('lifecycle and measured cost do not change ancestry, but scientific inputs and budget policy do', async () => {
  const run = await addressedFixture('trainingRun');
  assert.equal(await experientialRecordId('trainingRun', { ...run, state: 'complete', submissions: 1,
    startedAt: '2026-10-05T10:00:00.000Z', finishedAt: '2026-10-05T10:00:01.000Z', stopReason: 'complete' }), run.id);
  assert.notEqual(await experientialRecordId('trainingRun', { ...run, budget: { ...run.budget, maxWallMs: run.budget.maxWallMs + 1 } }), run.id);
  assert.notEqual(await experientialRecordId('trainingRun', { ...run, datasetId: 'e'.repeat(64) }), run.id);
  const experience = await addressedFixture('experience');
  assert.equal(await experientialRecordId('experience', { ...experience, state: 'selected' }), experience.id);
  const artifact = await addressedFixture('artifact');
  assert.equal(await experientialRecordId('artifact', { ...artifact, state: 'active' }), artifact.id);
  assert.notEqual(await experientialRecordId('artifact', { ...artifact, checksum: 'f'.repeat(64) }), artifact.id);
  const cost = { calls: 1, promptTokens: 3, completionTokens: 4, ms: 5, amount: 0.2 };
  const evaluation = await addressedFixture('evaluation', { rows: [{ rowId: 'candidate-no-retrieval', status: 'run', cgc: 0.5, retention: 1, failures: 0, cost, identityId: experience.producingIdentityId }] });
  assert.equal(await experientialRecordId('evaluation', { ...evaluation, cost,
    rows: evaluation.rows.map(row => ({ ...row, cost: { ...cost, ms: 999, calls: 5 } })) }), evaluation.id);
  assert.notEqual(await experientialRecordId('evaluation', { ...evaluation, rows: evaluation.rows.map(row => ({ ...row, cgc: 1 })) }), evaluation.id);
});

it('dataset identity binds the exact assessment decision rather than a future latest review', async () => {
  const row = await addressedFixture('dataset');
  assert.notEqual(await experientialRecordId('dataset', { ...row, assessmentIds: ['e'.repeat(64)] }), row.id);
  const { assessmentIds: _, ...missing } = row;
  assert.equal((await checkExperientialRecord('dataset', missing)).ok, false);
});

it('head identity partitions profile and scope while native head state remains mutable only by commands', async () => {
  const row = await addressedFixture('head');
  assert.equal(row.id, await experientialHeadKey(row.profile, row.scope));
  assert.notEqual(row.id, await experientialHeadKey('different', row.scope));
  assert.equal(await experientialRecordId('head', { ...row, head: { versionId: 'a'.repeat(64), revision: 1 }, eventId: 'b'.repeat(64) }), row.id);
});

it('sealing snapshots before its first await and refuses caller-supplied IDs or non-JSON data', async () => {
  const { id: _, ...body } = experientialSchemaFixtures().experience;
  const original = body.taskRef.digest;
  const promise = sealExperientialRecord('experience', body);
  body.taskRef.digest = 'f'.repeat(64);
  assert.equal(accepted(await promise).taskRef.digest, original);
  assert.equal((await sealExperientialRecord('experience', { ...body, id: 'a'.repeat(64) } as typeof body)).ok, false);
  assert.equal((await sealExperientialRecord('experience', { ...body, extra: () => undefined } as typeof body)).ok, false);
  assert.equal(await experientialRevisionOf({ a: 1, b: 2 }), await experientialRevisionOf({ b: 2, a: 1 }));
});
