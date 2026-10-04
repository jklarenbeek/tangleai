import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { researchValue, type ResearchWorkflowFrame } from '@tangleai/research';
import { workflowFixture, workflowHarness, MasInfrastructureCrash } from './workflow-fixtures.ts';

it('interrupted after every operation resumes to the same artifact graph and spend as an uninterrupted run', async t => {
  const f = await workflowFixture(), dir = await mkdtemp(join(tmpdir(), 'research-resume-')), points: string[] = [];
  const baseline = await workflowHarness(f, { path: join(dir, 'baseline.sqlite'), probe: point => points.push(point) });
  try {
    await baseline.start(); const uninterrupted = await baseline.finish(), expected = await baseline.snapshot(), projection = await baseline.projection();
    assert.equal(uninterrupted.run.status, 'completed'); const expectedExecutions = baseline.executions;
    await baseline.close();
    assert.ok(points.some(p => p.endsWith(':committed'))); assert.ok(points.some(p => p.startsWith('response:')));
    for (const [index, point] of points.entries()) await t.test(`${index + 1}: ${point}`, async () => {
      let seen = 0, crashed = false;
      const h = await workflowHarness(f, { path: join(dir, `case-${index}.sqlite`), probe: actual => {
        if (!crashed && ++seen === index + 1) { assert.equal(actual, point); crashed = true; throw new MasInfrastructureCrash('injected operation interruption'); }
      } });
      try {
        await h.start();
        await assert.rejects(h.finish(), /injected operation interruption/); assert.equal(crashed, true);
        await h.reopen();
        const current = (await h.host.masStore.readTrace(f.project.id))!;
        // A crash at a completed final node can leave the native queue ready for terminal settlement.
        if (current.run.status === 'waiting_for_input') assert.ok((await h.respond()).ok);
        const done = await h.finish(); assert.equal(done.run.status, 'completed', JSON.stringify(done.run.failure));
        assert.deepEqual(await h.snapshot(), expected); assert.deepEqual(await h.projection(), projection);
        assert.deepEqual(done.run.budget.spent, uninterrupted.run.budget.spent);
        if (point.endsWith(':committed') || point.startsWith('native:') || point.startsWith('response:'))
          assert.equal(h.executions, expectedExecutions, 'Committed work must not be executed again');
      } finally { await h.close(); }
    });
  } finally { await baseline.close(); await rm(dir, { recursive: true, force: true }); }
});
it('same-path changed content is refused before execution while exact research commit replay returns its frame', async () => {
  const f = await workflowFixture(), h = await workflowHarness(f);
  try {
    await h.start(); await h.segment(); const op = h.operations.find(op => op.stage === 'create')!, before = await h.snapshot(), count = h.executions;
    const input = { runId: f.project.id, value: { frame: op.frame }, state: {}, node: 'create', path: op.path,
      idempotencyKey: op.idempotencyKey, signal: new AbortController().signal };
    const exact = await h.host.handlers['research-create'](input) as { frame: ResearchWorkflowFrame };
    assert.equal(exact.frame.status, 'DISCOVERY'); assert.ok(exact.frame.checkpoint);
    await assert.rejects(async () => h.host.handlers['research-create']({ ...input, value: { frame: { ...op.frame, attempt: 1 } } }),
      (e: unknown) => (e as { failure: { cause: { code: string } } }).failure.cause.code === 'TRSH1004');
    assert.equal(h.executions, count); assert.deepEqual(await h.snapshot(), before);
  } finally { await h.close(); }
});
it('a stage cannot read an unlisted artifact and its exact refusal is retained on research and MAS', async () => {
  const f = await workflowFixture(), h = await workflowHarness(f, { tools: tools => ({ ...tools,
    execute: async (op, access) => {
      if (op.stage === 'discovery') await access.readArtifact({ artifactId: 'art-' + 'f'.repeat(64), admissionId: 'admission-' + 'f'.repeat(64) });
      return tools.execute(op, access);
    } }) });
  try {
    await h.start(); const trace = await h.segment(); assert.equal(trace.run.status, 'failed'); assert.equal(trace.run.failure?.error.cause?.code, 'TRSH1005');
    const failed = (await h.snapshot()).attempts.find(a => a.attempt.stage === 'DISCOVERY')!;
    assert.equal(failed.attempt.error?.code, 'TRSH1005'); assert.equal(failed.attempt.outputArtifactIds.length, 0);
    assert.equal(researchValue(await h.host.researchStore.getState(f.project.id))?.status, 'STOPPED');
  } finally { await h.close(); }
});
