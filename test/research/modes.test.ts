import assert from 'node:assert/strict';
import { it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initialResearchFrame, prepareResearchWorkflow, researchMode, interventionReport, planProjectCreate } from '@tangleai/research';
import { researchExampleLimits } from '../../examples/research.ts';
import { workflowFixture, workflowHarness } from './workflow-fixtures.ts';

it('gate-only is the default and full-auto requires an explicit experimental opt-in', async () => {
  assert.deepEqual(researchMode(), { mode: 'gate-only', experimental: false });
  const f = await workflowFixture();
  assert.equal(planProjectCreate({ ...f.project, mode: 'full-auto' }).valid, false);
  assert.equal(planProjectCreate({ ...f.project, experimental: true }).valid, false);
  await assert.rejects(prepareResearchWorkflow(f.contract, { binding: f.binding, profile: 'research-scripted',
    limits: researchExampleLimits, mode: 'full-auto' } as never), /explicit experimental/);
});

for (const mode of ['gate-only', 'full-auto'] as const) it(`${mode} retains every native approval through SQLite reopen with no extra execution`, async () => {
  const base = await workflowFixture(), project = { ...base.project, mode, ...(mode === 'full-auto' ? { experimental: true } : {}) };
  const prepared = await prepareResearchWorkflow(base.contract, { binding: base.binding, profile: 'research-scripted', limits: researchExampleLimits,
    ...(mode === 'full-auto' ? { mode, experimental: true } as const : { mode: 'gate-only', experimental: false } as const) });
  const f = { ...base, project, prepared, frame: await initialResearchFrame(project, base.plan, base.binding) };
  const dir = await mkdtemp(join(tmpdir(), 'research-mode-')), h = await workflowHarness(f, { path: join(dir, 'state.sqlite') });
  try {
    await h.start(); const trace = await h.finish(), snapshot = await h.snapshot();
    assert.equal(trace.run.status, 'completed', JSON.stringify(trace.run.failure)); assert.equal(snapshot.state.status, 'COMPLETE');
    const report = interventionReport(trace), records = snapshot.records.filter(row => row.kind === 'Intervention').map(row => row.value);
    assert.equal(report.total, 3); assert.equal(report.approvals, 3); assert.equal(report.substantive, 0);
    assert.equal(report.automatic, mode === 'full-auto' ? 3 : 0); assert.equal(report.scripted, mode === 'gate-only' ? 3 : 0);
    assert.equal(trace.interactions.length, mode === 'gate-only' ? 3 : 0); assert.equal(records.length, 3);
    assert.deepEqual(records.map(row => row.gate).sort(), ['design', 'literature', 'quality']);
    assert.ok(records.every(row => row.actor === (mode === 'gate-only' ? 'scripted' : 'full-auto')
      && row.experimental === (mode === 'full-auto') && row.viewedArtifactIds!.length > 0 && row.effect!.kind === 'approval'));
    const gates = [prepared.workflow, ...prepared.snapshot.subgraphs.values()].flatMap(row => row.nodes)
      .filter(row => ['literature-gate', 'design-gate', 'quality-gate'].includes(row.id));
    assert.equal(gates.length, 3); assert.ok(gates.every(row => row.kind === (mode === 'gate-only' ? 'interaction' : 'task')));
    const executions = h.executions; await h.reopen();
    assert.deepEqual(interventionReport((await h.host.masStore.readTrace(f.project.id))!), report);
    assert.deepEqual((await h.snapshot()).records, snapshot.records); assert.equal(h.executions, executions);
    assert.equal((await h.db.jobs!.counts()).pending, 0);
  } finally { await h.close(); await rm(dir, { recursive: true, force: true }); }
});
