import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MasInfrastructureCrash } from '@tangleai/mas';
import { createFixtureExecutor, type ResearchExecutor } from '@tangleai/research';
import { executionWorkflowFixture, executionWorkflowTools } from './execution-workflow-fixtures.ts';
import { workflowHarness } from './workflow-fixtures.ts';

test('native execution commits all ten independently verified experiments and one terminal branch', async () => {
  const f = await executionWorkflowFixture();
  const h = await workflowHarness(f, { tools: (tools, stores) => executionWorkflowTools(f, tools, stores.researchStore) });
  try {
    await h.start(); const trace = await h.finish(), snapshot = await h.snapshot();
    assert.equal(trace.run.status, 'completed', JSON.stringify(trace.run.failure));
    assert.equal(snapshot.state.status, 'STOPPED');
    assert.equal(snapshot.records.filter(row => row.kind === 'ExperimentRun').length, 10);
    assert.equal(snapshot.records.filter(row => row.kind === 'MetricObservation').length, 10);
    const branches = snapshot.records.filter(row => row.kind === 'ExperimentBranch');
    assert.equal(branches.length, 1); assert.equal(branches[0].value.status, 'completed');
    assert.equal(trace.attempts.filter(row => row.invocationId === 'run' && row.kind === 'task' && row.status === 'completed').length, 10);
    const receipt = snapshot.attempts.find(row => row.attempt.stage === 'EXECUTE')!;
    assert.equal(receipt.attempt.spend.physical, 10); assert.ok(receipt.artifactAdmissionIds.length > 10);
    assert.equal(trace.run.budget.spent.turns, 0);
  } finally { await h.close(); }
});
test('native partial failure commits prior observations and the failed raw run without dropping its cost', async () => {
  const f = await executionWorkflowFixture(), program = f.programs[f.plan.conditions[1].programId];
  const executor = createFixtureExecutor({ ...f.programs, [f.plan.conditions[1].programId]: async input => {
    if (input.seed === 3) throw Error('third-seed failure'); return program(input);
  } }, { now: () => 0 });
  const h = await workflowHarness(f, { tools: (tools, stores) => executionWorkflowTools(f, tools, stores.researchStore, executor) });
  try {
    await h.start(); const trace = await h.finish(), snapshot = await h.snapshot();
    assert.equal(trace.run.status, 'failed', JSON.stringify(trace.run.failure));
    assert.equal(snapshot.state.status, 'STOPPED');
    const runs = snapshot.records.filter(row => row.kind === 'ExperimentRun');
    assert.equal(runs.length, 6); assert.equal(runs.filter(row => row.value.status === 'failed').length, 1);
    assert.equal(snapshot.records.filter(row => row.kind === 'MetricObservation').length, 5);
    assert.equal(snapshot.attempts.find(row => row.attempt.stage === 'EXECUTE')!.attempt.spend.physical, 6);
    const failed = runs.find(row => row.value.status === 'failed')!;
    assert.equal(failed.value.stopReason, 'completed'); assert.equal(failed.value.exitStatus, 1);
    assert.ok(snapshot.artifacts.some(row => snapshot.committedAdmissionIds.includes(row.id) && row.artifact.id === failed.value.stderrArtifactId));
  } finally { await h.close(); }
});
test('a crash after a native experiment checkpoint does not execute completed seeds again after SQLite restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'research-execution-'));
  const f = await executionWorkflowFixture(); let crashed = false, calls = 0;
  const executor: ResearchExecutor = { ...f.executor, run: async (...args) => { calls++; return f.executor.run(...args); } };
  const h = await workflowHarness(f, { path: join(directory, 'state.sqlite'),
    tools: (tools, stores) => executionWorkflowTools(f, tools, stores.researchStore, executor),
    observer: { onNodeSettle(path, status) { if (!crashed && status === 'completed' && path.endsWith('/run')) { crashed = true; throw new MasInfrastructureCrash('after experiment checkpoint'); } } } });
  try {
    await h.start(); await h.segment(); await h.respond(); await h.segment(); await h.respond();
    await assert.rejects(() => h.segment(), MasInfrastructureCrash); assert.equal(calls, 1);
    await h.reopen(); const trace = await h.finish();
    assert.equal(trace.run.status, 'completed', JSON.stringify(trace.run.failure)); assert.equal(calls, 10);
    assert.equal((await h.snapshot()).records.filter(row => row.kind === 'ExperimentRun').length, 10);
  } finally { await h.close(); await rm(directory, { recursive: true, force: true }); }
});
test('cancellation during a replicate retains its cancelled raw run and earlier independent observations', async () => {
  const f = await executionWorkflowFixture(), controller = new AbortController(); let calls = 0;
  const executor = createFixtureExecutor(Object.fromEntries(Object.entries(f.programs).map(([id, program]) => [id, async input => {
    if (++calls === 3) controller.abort(); return program(input);
  }])), { now: () => 0 });
  const h = await workflowHarness(f, { tools: (tools, stores) => executionWorkflowTools(f, tools, stores.researchStore, executor) });
  try {
    await h.start(); await h.segment(); await h.respond(); await h.segment(); await h.respond();
    const trace = await h.segment(controller.signal), snapshot = await h.snapshot();
    assert.equal(trace.run.status, 'failed', JSON.stringify(trace.run.failure)); assert.equal(snapshot.state.status, 'STOPPED');
    const runs = snapshot.records.filter(row => row.kind === 'ExperimentRun');
    assert.equal(runs.length, 3); assert.equal(runs.filter(row => row.value.stopReason === 'cancelled').length, 1);
    assert.equal(snapshot.records.filter(row => row.kind === 'MetricObservation').length, 2);
    assert.equal(snapshot.attempts.find(row => row.attempt.stage === 'EXECUTE')!.attempt.spend.physical, 3);
  } finally { await h.close(); }
});
