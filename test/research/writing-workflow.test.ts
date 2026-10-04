import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MasInfrastructureCrash, validateMasWorkflow, planMasWorkflow, compileMasRuntime, masWorkflowVersionIdOf } from '@tangleai/mas';
import { openTangleDb, createMasStore, createMasSegmentDriver } from '@tangleai/store';
import { createResearchWritingContextProvider, verifyResearchDraft, researchValue } from '@tangleai/research';
import { writingWorkflowFixture, writingWorkflowTools, writingReviewClient } from './writing-workflow-fixtures.ts';
import { workflowHarness } from './workflow-fixtures.ts';
import { writingFixture, revisedWritingFixture } from './writing-fixtures.ts';

test('the native read-only writer and independent reviews reach the human quality gate with exact cost', async () => {
  const f = await writingWorkflowFixture(), requests: Array<{ role: string; request: unknown }> = [];
  const h = await workflowHarness(f, { tools: (base, stores) => writingWorkflowTools(f, base, stores.researchStore),
    clientFor: writingReviewClient({ observe: (role, request) => requests.push({ role, request }) }) });
  try {
    await h.start(f.limits); const trace = await h.finish(), snapshot = await h.snapshot();
    assert.equal(trace.run.status, 'completed', JSON.stringify(trace.run.failure)); assert.equal(snapshot.state.status, 'COMPLETE');
    const drafts = snapshot.records.filter(row => row.kind === 'Draft').map(row => row.value);
    assert.equal(drafts.length, 1); assert.equal(drafts[0].mode, 'agent');
    const reviews = snapshot.records.filter(row => row.kind === 'Review').map(row => row.value);
    assert.equal(reviews.length, 2); assert.ok(reviews.every(row => row.independence?.roleId !== drafts[0].writer.roleId && row.verdict === 'accept'));
    assert.equal(requests.filter(row => row.role === 'research-writer').length, 2);
    assert.ok(requests.every(row => !(row.request as { tools?: unknown[] }).tools?.length));
    assert.equal(snapshot.attempts.find(row => row.attempt.stage === 'WRITE')!.attempt.spend.calls, 2);
    assert.equal(snapshot.attempts.find(row => row.attempt.stage === 'VERIFY')!.attempt.spend.calls, 14);
    assert.ok(trace.interactions.some(row => row.path.endsWith('quality-gate')));
    const writer = trace.attempts.find(row => row.kind === 'agent' && row.path.includes('/write/model'))!;
    assert.deepEqual(writer.contextReads.map(row => row.outcome), ['ok']);
  } finally { await h.close(); }
});

test('native critical findings stop before quality approval and survive an atomic-commit crash with their full cost', async () => {
  const f = await writingWorkflowFixture('template'), directory = await mkdtemp(join(tmpdir(), 'research-writing-'));
  let crashed = false, calls = 0;
  const h = await workflowHarness(f, { path: join(directory, 'state.sqlite'),
    tools: (base, stores) => writingWorkflowTools(f, base, stores.researchStore),
    clientFor: writingReviewClient({ critical: true, observe: () => calls++ }),
    probe(point) { if (!crashed && point.includes('/verify/commit:committed')) { crashed = true; throw new MasInfrastructureCrash('after verified negative review commit'); } } });
  try {
    await h.start(f.limits); await h.segment(); await h.respond(); await h.segment(); await h.respond();
    await assert.rejects(() => h.segment(), MasInfrastructureCrash);
    const before = await h.snapshot(), cost = calls; assert.equal(before.state.status, 'STOPPED');
    assert.equal(cost, 26); assert.equal(before.attempts.find(row => row.attempt.stage === 'WRITE')!.attempt.spend.calls, 0);
    const retained = before.records.filter(row => row.kind === 'Review').map(row => row.value);
    assert.equal(retained.length, 2); assert.equal(retained.find(row => row.pattern === 'peer-review')!.retainedFindings!.length, 2);
    assert.equal(before.attempts.find(row => row.attempt.stage === 'VERIFY')!.attempt.spend.calls, cost);
    await h.reopen(); const trace = await h.finish(); assert.equal(trace.run.status, 'failed'); assert.equal(calls, cost);
    assert.equal(trace.interactions.some(row => row.path.endsWith('quality-gate')), false);
    assert.deepEqual((await h.snapshot()).records.filter(row => row.kind === 'Review').map(row => row.value), retained);
  } finally { await h.close(); await rm(directory, { recursive: true, force: true }); }
});

test('a native writer cannot introduce an unbound number and its rejected output and calls remain admitted audit evidence', async () => {
  const f = await writingWorkflowFixture(), roles: string[] = [];
  const h = await workflowHarness(f, { tools: (base, stores) => writingWorkflowTools(f, base, stores.researchStore),
    clientFor: writingReviewClient({ invalidWriter: true, observe: role => roles.push(role) }) });
  try {
    await h.start(f.limits); const trace = await h.finish(), snapshot = await h.snapshot();
    assert.equal(trace.run.status, 'failed'); assert.equal(snapshot.state.status, 'STOPPED');
    assert.equal(trace.run.failure?.error.cause?.code, 'TRSH1005'); assert.deepEqual(roles, ['research-writer', 'research-writer']);
    assert.equal(snapshot.records.filter(row => row.kind === 'Draft').length, 0);
    const failed = snapshot.attempts.find(row => row.attempt.stage === 'WRITE')!;
    assert.equal(failed.attempt.spend.calls, 2); assert.ok(failed.artifactAdmissionIds.length > 0);
    const proposal = snapshot.artifacts.find(row => row.artifact.mediaType === 'application/vnd.tangleai.research-writing-proposal+json')!;
    assert.ok(new TextDecoder().decode(researchValue(await h.host.researchStore.readArtifact(f.project.id, proposal.id)).bytes).includes('99% improvement'));
  } finally { await h.close(); }
});

test('a deterministically refused draft traverses the native review branch with zero provider calls', async () => {
  const f = await writingWorkflowFixture(), invalid = await writingFixture();
  const revised = await revisedWritingFixture(invalid, claims => { claims.find(row => row.kind === 'literature')!.proof!.strength = 'exact'; });
  const verification = researchValue(await verifyResearchDraft(invalid.input, revised.ledger, revised.draft));
  const ready = verification.state === 'verified';
  assert.equal(verification.state, 'refused');
  const workflow = structuredClone(f.prepared.writingGraph!.subgraphs.find(row => row.workflowId === 'research-draft-reviews')!);
  workflow.registry.revision = f.prepared.snapshot.revision; workflow.config.registryRevision = f.prepared.catalog.revision;
  workflow.versionId = await masWorkflowVersionIdOf(workflow as unknown as Record<string, unknown>);
  const validated = await validateMasWorkflow(workflow, f.prepared.snapshot, f.prepared.catalog); assert.ok(validated.valid, JSON.stringify(validated));
  const plan = await planMasWorkflow(validated.value); assert.ok(plan.valid);
  const db = await openTangleDb({ jobs: { now: () => 1000, random: () => 0.5 } }), store = createMasStore(db, { now: () => 'fixed' });
  let calls = 0;
  try {
    const run = await store.createRun({ runId: 'refused-draft', workflowId: workflow.workflowId, workflowVersionId: workflow.versionId,
      registryRevision: f.prepared.snapshot.revision, executableRevision: plan.value.executableRevision, configRegistryRevision: f.prepared.catalog.revision,
      profile: 'research-scripted', input: { ready, input: { caseId: 'refused', query: 'Refused before review.',
        evidence: [], payload: { draftId: revised.draft.id, ledgerId: revised.ledger.id } } }, limits: f.limits }); assert.ok(run.ok);
    const runtime = compileMasRuntime(validated.value, plan.value, f.prepared.snapshot, { store,
      taskHandlers: f.prepared.writingGraph!.taskHandlers, toolBindings: {}, contextProviders: {}, messageAdapters: f.prepared.writingGraph!.adapters,
      now: () => 'fixed', clock: () => 0, clientFor: () => ({ async complete() { calls++; throw Error('Refusal must never dispatch a provider.'); } }) });
    assert.ok(runtime.valid, JSON.stringify(runtime));
    const driver = createMasSegmentDriver(db, store, { owner: 'writing-test', leaseMs: 1000 }); await driver.enqueue(run.value);
    assert.equal(await driver.drive(plan.value.executableRevision, runtime.value.executeSegment, new AbortController().signal), true);
    const trace = (await store.readTrace(run.value.id))!; assert.equal(trace.run.status, 'completed', JSON.stringify(trace.run.failure));
    assert.equal(calls, 0); assert.equal(trace.attempts.filter(row => row.kind === 'agent').length, 0);
    assert.deepEqual(trace.run.output, { result: { peer: null, red: null } }); assert.equal(trace.run.budget.spent.turns, 0);
  } finally { await db.close(); }
});

test('the writer context exposes only its admitted view and refuses incomplete bounds or cancellation', async () => {
  const provider = createResearchWritingContextProvider(), query = { variables: { ledger_id: 'ledger-visible' }, view: 'exact admitted view' };
  const options = { signal: new AbortController().signal, maxUnits: 4, maxChars: 100 };
  const full = await provider.read({ node: 'writer', query }, options); assert.equal(full.outcome, 'ok');
  if (full.outcome === 'ok') { assert.equal(full.units[0].text, query.view); assert.deepEqual(full.units[0].capabilities, ['read']); }
  assert.equal((await provider.read({ node: 'writer', query }, { ...options, maxChars: 2 })).outcome, 'failed');
  assert.equal((await provider.read({ node: 'writer', query }, { ...options, signal: AbortSignal.abort() })).outcome, 'failed');
});
