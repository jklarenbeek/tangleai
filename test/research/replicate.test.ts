import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MasInfrastructureCrash } from '@tangleai/mas';
import { analysisWorkflowFixture, analysisWorkflowTools, analysisReviewClient } from './analysis-workflow-fixtures.ts';
import { workflowHarness } from './workflow-fixtures.ts';

test('declared replication uses native execution, retains independent peer review and terminates explicitly', async () => {
  const f = await analysisWorkflowFixture('negative'); let reviews = 0;
  const h = await workflowHarness(f, { tools: (base, stores) => analysisWorkflowTools(f, base, stores.researchStore), clientFor: analysisReviewClient(false, () => reviews++) });
  try {
    await h.start(); const trace = await h.finish(), snapshot = await h.snapshot();
    assert.equal(trace.run.status, 'completed', JSON.stringify(trace.run.failure)); assert.equal(snapshot.state.status, 'STOPPED');
    const branches = snapshot.records.filter(row => row.kind === 'ExperimentBranch').map(row => row.value).sort((a, b) => a.attemptOrdinal - b.attemptOrdinal);
    assert.deepEqual(branches.map(row => row.kind), ['initial', 'replicate', 'replicate']);
    assert.deepEqual(branches.map(row => row.runIds.length), [4, 4, 2]); assert.equal(branches[1].parentId, branches[0].id);
    assert.equal(snapshot.records.filter(row => row.kind === 'ExperimentRun').length, 10);
    const decisions = snapshot.records.filter(row => row.kind === 'ResearchDecision').map(row => row.value);
    assert.equal(decisions.filter(row => row.kind === 'Refine' && row.details!.action === 'replicate').length, 2);
    assert.equal(decisions.filter(row => row.kind === 'Stop').length, 1); assert.equal(reviews, 18);
    assert.equal(snapshot.attempts.filter(row => row.attempt.stage === 'DECIDE').reduce((n, row) => n + row.attempt.spend.calls, 0), reviews);
    assert.ok(snapshot.records.some(row => row.kind === 'Analysis' && row.value.support === 'not-supported'));
  } finally { await h.close(); }
});
test('a crash between replicate seeds resumes with no repeated seeds, spend or observations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'research-replicate-')), f = await analysisWorkflowFixture('negative');
  let crashed = false; const dispatched: string[] = [];
  const executor = { ...f.executor, run: async (...args: Parameters<typeof f.executor.run>) => {
    dispatched.push(args[0].condition + ':' + args[0].seed); return f.executor.run(...args);
  } };
  const h = await workflowHarness(f, { path: join(directory, 'state.sqlite'), clientFor: analysisReviewClient(),
    tools: (base, stores) => analysisWorkflowTools(f, base, stores.researchStore, executor),
    observer: { onNodeSettle(path, status) { if (!crashed && status === 'completed' && path.endsWith('/run') && dispatched.length === 5) {
      crashed = true; throw new MasInfrastructureCrash('after first experiment in replication');
    } } } });
  try {
    await h.start(); await h.segment(); await h.respond(); await h.segment(); await h.respond();
    await assert.rejects(() => h.segment(), MasInfrastructureCrash); assert.equal(dispatched.length, 5);
    await h.reopen(); const trace = await h.finish(), snapshot = await h.snapshot();
    assert.equal(trace.run.status, 'completed', JSON.stringify(trace.run.failure));
    assert.equal(dispatched.length, 10); assert.equal(new Set(dispatched).size, 10);
    const observations = snapshot.records.filter(row => row.kind === 'MetricObservation').map(row => row.value);
    assert.equal(observations.length, 10); assert.ok(observations.every(row => row.value === 20));
    const uninterrupted = await workflowHarness(f, { clientFor: analysisReviewClient(),
      tools: (base, stores) => analysisWorkflowTools(f, base, stores.researchStore) });
    try {
      await uninterrupted.start(); assert.equal((await uninterrupted.finish()).run.status, 'completed');
      const baseline = await uninterrupted.snapshot();
      const sorted = (rows: typeof observations) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
      assert.deepEqual(sorted(observations), sorted(baseline.records.filter(row => row.kind === 'MetricObservation').map(row => row.value)));
      assert.deepEqual(snapshot.attempts.map(row => row.attempt.spend), baseline.attempts.map(row => row.attempt.spend));
    } finally { await uninterrupted.close(); }
    assert.equal(snapshot.attempts.filter(row => row.attempt.stage === 'EXECUTE').reduce((n, row) => n + row.attempt.spend.physical, 0), 10);
  } finally { await h.close(); await rm(directory, { recursive: true, force: true }); }
});

for (const critical of [false, true]) test('native result review retains independent findings and ' + (critical ? 'blocks' : 'allows') + ' supported evidence', async () => {
  const f = await analysisWorkflowFixture('success');
  const h = await workflowHarness(f, { clientFor: analysisReviewClient(critical), tools: (base, stores) => analysisWorkflowTools(f, base, stores.researchStore) });
  try {
    await h.start(); const trace = await h.finish(), snapshot = await h.snapshot();
    assert.equal(trace.run.status, 'completed', JSON.stringify(trace.run.failure));
    const decision = snapshot.records.filter(row => row.kind === 'ResearchDecision').map(row => row.value)
      .find(row => row.details?.attemptOrdinal === 3)!;
    assert.equal(decision.kind, critical ? 'Stop' : 'Proceed');
    assert.equal(snapshot.state.status, critical ? 'STOPPED' : 'COMPLETE');
    assert.equal(decision.details!.reviewerIdentityId, f.analysisPolicy.reviewerIdentityId);
    const findings = decision.details!.reviewerFindings;
    if (critical) {
      const reviewers = findings.filter(row => row.id.startsWith('critical-'));
      assert.equal(reviewers.length, 2); assert.ok(reviewers.every(row => row.critical)); assert.equal(new Set(reviewers.map(row => row.origin)).size, 2);
      assert.ok(findings.some(row => row.id === 'result-review-incomplete'));
    }
    else assert.deepEqual(findings, []);
    assert.ok(decision.details!.reviewArtifactIds.every(id => snapshot.artifacts.some(row => row.artifact.id === id && snapshot.committedAdmissionIds.includes(row.id))));
  } finally { await h.close(); }
});
