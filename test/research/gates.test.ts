import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { overdueGates, applyOverduePolicy, researchValue, type ResearchWorkflowFrame, type ResearchStore } from '@tangleai/research';
import { workflowFixture, workflowHarness } from './workflow-fixtures.ts';

it('stale approval is refused TMAS2007 and identical response delivery reserves exactly one resume', async () => {
  const f = await workflowFixture(), h = await workflowHarness(f);
  try {
    await h.start(); const before = await h.segment(), count = h.executions;
    assert.equal(before.run.status, 'waiting_for_input'); assert.equal(before.interactions[0].expiry, null);
    const invalid = await h.respond('approve', { approvedManifestHash: 'f'.repeat(64) });
    assert.ok(!invalid.ok); assert.equal(invalid.issue.code, 'TMAS2007');
    assert.deepEqual(await h.host.masStore.readTrace(f.project.id), before); assert.equal(h.executions, count);
    assert.ok((await h.respond()).ok); const after = (await h.host.masStore.readTrace(f.project.id))!;
    assert.equal(after.run.status, 'resume_pending'); assert.equal(after.interactions[0].resumeSegment, 1);
    assert.equal(h.executions, count); await h.finish();
    const snapshot = await h.snapshot(), interventions = snapshot.records.filter(r => r.kind === 'Intervention');
    assert.equal(interventions.length, 3);
    assert.equal(new Set(interventions.map(i => i.value.reviewedManifestHash)).size, 3, 'Early approvals retain their actual stage-specific artifact sets');
    assert.equal(interventions.every(i => i.value.actor === 'scripted'), true);
  } finally { await h.close(); }
});
it('overdue pause retains a waiting native run and never manufactures an approval', async () => {
  const f = await workflowFixture(), h = await workflowHarness(f);
  try {
    await h.start(); const before = await h.segment();
    assert.equal(overdueGates(before, '2026-01-01T00:00:00.999Z', { kind: 'pause', afterMs: 1000 }).length, 0);
    const result = await applyOverduePolicy({ ...h.host, runId: f.project.id, now: '2026-01-01T00:00:01.000Z', policy: { kind: 'pause', afterMs: 1000 } });
    assert.equal(result.overdue.length, 1); assert.deepEqual(result.stopped, []);
    assert.deepEqual(await h.host.masStore.readTrace(f.project.id), before);
    assert.equal((await h.snapshot()).records.some(r => r.kind === 'Intervention'), false);
    assert.throws(() => overdueGates(before, 'not-a-time', { kind: 'stop', afterMs: 1 }), /TRSH1001/);
    assert.throws(() => overdueGates(before, '2026-01-01T00:00:00Z', { kind: 'stop', afterMs: -1 }), /TRSH1001/);
  } finally { await h.close(); }
});
it('changing a policy object after admission cannot turn pause into stop', async () => {
  const f = await workflowFixture(), h = await workflowHarness(f);
  try {
    await h.start(); const before = await h.segment(), policy: { kind: 'pause' | 'stop'; afterMs: number } = { kind: 'pause', afterMs: 1000 };
    const pending = applyOverduePolicy({ ...h.host, runId: f.project.id, now: '2026-01-01T00:00:01Z', policy });
    policy.kind = 'stop';
    assert.deepEqual((await pending).stopped, []); assert.deepEqual(await h.host.masStore.readTrace(f.project.id), before);
  } finally { await h.close(); }
});
it('overdue stop atomically expires MAS with TMAS2007 and reconciles research after a projection interruption', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'research-overdue-')), f = await workflowFixture(), h = await workflowHarness(f, { path: join(dir, 'db.sqlite') });
  try {
    await h.start(); await h.segment();
    const interrupted: ResearchStore = { ...h.host.researchStore, transition: async () => { throw Error('projection interrupted'); } };
    await assert.rejects(applyOverduePolicy({ masStore: h.host.masStore, researchStore: interrupted,
      runId: f.project.id, now: '2026-01-01T00:00:01Z', policy: { kind: 'stop', afterMs: 1000 } }), /projection interrupted/);
    await h.reopen(); const terminal = (await h.host.masStore.readTrace(f.project.id))!;
    assert.equal(terminal.run.status, 'failed'); assert.equal(terminal.run.failure?.error.code, 'TMAS2007');
    assert.equal(terminal.interactions[0].status, 'expired'); assert.equal(terminal.interactions[0].resumeSegment, null);
    assert.equal(terminal.interactions[0].response, null); assert.equal((await h.snapshot()).state.status, 'LITERATURE_GATE');
    const repaired = await applyOverduePolicy({ ...h.host, runId: f.project.id, now: '2026-01-01T00:00:02Z', policy: { kind: 'stop', afterMs: 1000 } });
    assert.equal(repaired.overdue.length, 0); assert.equal(repaired.reconciled, true);
    assert.equal((await h.snapshot()).state.status, 'STOPPED');
    const snapshot = await h.snapshot(), projection = await h.projection();
    assert.equal((await applyOverduePolicy({ ...h.host, runId: f.project.id, now: '2026-01-01T00:00:03Z', policy: { kind: 'stop', afterMs: 1000 } })).reconciled, false);
    assert.deepEqual(await h.snapshot(), snapshot); assert.deepEqual(await h.projection(), projection);
    assert.equal(researchValue(await h.host.researchStore.listRecords(f.project.id, 'Intervention')).length, 0);
  } finally { await h.close(); await rm(dir, { recursive: true, force: true }); }
});
it('a direct gate handler cannot bypass native attempt admission or alter a waiting projection', async () => {
  const f = await workflowFixture(), h = await workflowHarness(f);
  try {
    await h.start(); const trace = await h.segment(), gate = trace.interactions[0], frame = gate.prompt as ResearchWorkflowFrame, before = await h.snapshot();
    await assert.rejects(async () => h.host.handlers['research-literature']({ runId: f.project.id, value: { frame,
      response: { decision: 'approve', approvedManifestHash: frame.gate!.manifestHash, actor: 'scripted', note: '' } },
      state: {}, node: 'literature-gate-apply', path: 'literature-gate-apply', idempotencyKey: 'forged', signal: new AbortController().signal }),
    (e: unknown) => (e as { failure: { cause: { code: string } } }).failure.cause.code === 'TRSH1004');
    assert.equal((await h.snapshot()).records.some(r => r.kind === 'Intervention'), false);
    assert.deepEqual(await h.snapshot(), before); assert.deepEqual(await h.host.masStore.readTrace(f.project.id), trace);
  } finally { await h.close(); }
});
