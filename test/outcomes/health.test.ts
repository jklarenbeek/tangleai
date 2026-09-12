import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createOutcomeService, createOutcomeStoreAdapter, createMemoryOutcomeStore, outcomeRevision } from '@tangleai/outcomes';
import { persistenceFor } from '../../packages/outcomes/src/store.ts';
import { beginOperation } from '../../packages/outcomes/src/operations.ts';
import { keyId } from '../../packages/outcomes/src/identity.ts';
import { fixture, code, id, value, scopeId, revision, LATER } from './fixtures.ts';
import { lifecycleFixture } from './guarded-fixtures.ts';
import type { HistoryPage } from '@tangleai/outcomes';

describe('outcome recovery and provenance health regressions', () => {
  it('a lost reservation acknowledgement is explicitly retryable without stranding a request', async () => {
    const owner = persistenceFor(createMemoryOutcomeStore()); let armed = true;
    const store = createOutcomeStoreAdapter({ async transaction(task) {
      let reserved = false;
      const result = await owner.transaction(tx => task({ ...tx, async put(table, row) {
        await tx.put(table, row); if (table === 'operations' && 'state' in row && row.state === 'reserved') reserved = true;
      } }));
      if (armed && reserved) { armed = false; throw Error('lost reservation acknowledgement'); } return result;
    } });
    const f = await fixture({ store });
    code(await f.create('lost-reservation'), 'OUTC1015');
    const retry = await f.create('lost-reservation'); assert.ok(retry.ok, JSON.stringify(retry));
  });
  it('a reserved attempt is discoverable and host no-dispatch proof fences its old worker', async () => {
    const f = await fixture(), decisionId = id(await f.create('reserved'), 'decisionId');
    const ref = await f.evidence(decisionId);
    const command = f.command('reserved-resolution', { decisionId, evidence: [ref], receivedAt: LATER });
    const first = await beginOperation(f.store, 'resolve', command);
    const page = value(await f.service.history({ scopeId, artifactKey: 'a', input: {} })) as unknown as HistoryPage;
    assert.ok(page.entries.some(e => e.record.kind === 'attemptEvent' && e.record.stage === 'reserved' && e.record.requestId === first.operation.id));
    const proof = { kind: 'no-dispatch', attemptId: first.operation.id, attempt: first.operation.attempt, inputDigest: first.operation.inputDigest, reason: 'The previous host stopped before dispatch; its worker is fenced.' };
    const bytes = { sourceId: 'no-dispatch', decisionId: null, scopeId, subject: f.host.scope.subject, issuer: 'trusted-host', observedAt: LATER, payload: proof };
    const source = { ...bytes, digest: await outcomeRevision(bytes) }; f.sources.set(source.sourceId, source);
    const reconciled = await f.service.reconcile(f.command('reconcile-reservation', { attemptId: first.operation.id, evidence: { sourceId: source.sourceId, digest: source.digest } }));
    assert.ok(reconciled.ok, JSON.stringify(reconciled));
    const fenced = await persistenceFor(f.store).transaction(tx => tx.get('operations', first.operation.id));
    assert.ok(fenced && fenced.attempt > first.operation.attempt);
    const retry = await f.service.resolve(command); assert.ok(retry.ok, JSON.stringify(retry));
  });
  it('evolve refuses a head whose checked activation provenance was lost', async () => {
    const f = await lifecycleFixture(), root = await f.root();
    await persistenceFor(f.store).transaction(async tx => {
      const key = await keyId(scopeId, 'head', 'a'), head = await tx.get('heads', key); assert.ok(head);
      await tx.put('heads', { ...head, eventId: null });
    });
    code(await f.service.reflect(f.command('corrupt-parent', f.input({ mode: 'evolve', parentVersionId: root.versionId, payload: null, patch: [{ op: 'replace', path: '/fallbackLabel', value: 'no' }] }))), 'OUTC1002');
  });
  it('semantic indexes cannot redirect an owned lookup through a corrupted scope envelope', async () => {
    const f = await fixture(), r = await f.resolved('index');
    await persistenceFor(f.store).transaction(async tx => {
      const key = await keyId(scopeId, 'resolution', r.decisionId), row = await tx.get('keys', key); assert.ok(row);
      await tx.put('keys', { ...row, scopeId: revision });
    });
    code(await f.service.resolve({ ...r.resolutionCommand, requestKey: 'corrupt-index' }), 'OUTC1002');
  });
});

it('positive overall utility cannot hide a held-out domain regression', async () => {
  const f = await lifecycleFixture(), staged = await f.stage();
  const slot = await f.register(staged.versionId, 'domains');
  for (let i = 0; i < slot.cases.length; i++) {
    const c = slot.cases[i]; c.domain = i === 3 ? 'minority' : 'majority';
    if (i === 3) {
      c.input = { token: 'accept:minority' };
      const { digest, ...bytes } = c.source;
      const data = { ...bytes, payload: { label: 'unknown' } }; c.source = { ...data, digest: await outcomeRevision(data) };
      f.sources.set(c.source.sourceId, c.source);
    }
  }
  f.slots.set(slot.slotId, slot);
  const result = await f.service.evaluate(f.command('domains', { versionId: staged.versionId, slotId: slot.slotId }));
  const evaluation = await f.inspect(id(result, 'evaluationId'));
  assert.equal(evaluation.meanDelta, .5); assert.equal(evaluation.eligible, false);
  assert.match(JSON.stringify(evaluation.issues), /domain regressed/);
});
it('a checked but never active version cannot be a rollback target', async () => {
  const f = await lifecycleFixture(), staged = await f.stage(), evaluated = await f.evaluate(staged.versionId);
  code(await f.service.approve(f.command('never-active', { action: 'rollback', versionId: staged.versionId, evaluationId: evaluated.evaluationId, expectedHead: { versionId: null, revision: 0 }, reason: 'A check alone is not prior activation.' })), 'OUTC1012');
});
it('unknown monetary cost fails a registered cost ceiling', async () => {
  const { eligibilityIssues } = await import('@tangleai/outcomes');
  const f = await lifecycleFixture(), staged = await f.stage(), evaluated = await f.evaluate(staged.versionId);
  const evaluation = await f.inspect(evaluated.evaluationId), registration = await f.inspect(evaluation.registrationId as string), version = await f.inspect(staged.versionId);
  const issues = eligibilityIssues({ ...evaluation, cost: null } as unknown as import('@tangleai/outcomes').Evaluation, { ...registration, maxCost: 1 } as unknown as import('@tangleai/outcomes').EvaluationRegistration, version as unknown as import('@tangleai/outcomes').ArtifactVersion);
  assert.match(JSON.stringify(issues), /Known cost/);
});
