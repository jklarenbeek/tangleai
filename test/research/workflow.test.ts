import { it } from 'node:test';
import assert from 'node:assert/strict';
import { masWorkflowVersionIdOf } from '@tangleai/mas';
import { inputManifestOf, initialResearchFrame, researchProjectHash, gateReviewOf, checkResearchGate,
  createResearchHostBindings, createResearchTaskHandlers, createResearchBinding, prepareResearchWorkflow } from '@tangleai/research';
import { workflowFixture, workflowHarness } from './workflow-fixtures.ts';
import { researchExampleIdentity, researchExampleTools, researchExampleLimits } from '../../examples/research.ts';
import { loadResearchFixture } from '../../benchmark/lib/research-fixture.ts';
const registered = (await loadResearchFixture()).lifecycle;

it('validates and plans one pinned MAS lifecycle with native loops, switches and indefinite gates', async () => {
  const f = await workflowFixture();
  assert.deepEqual(f.prepared.workflow, registered.workflow);
  assert.equal(f.prepared.plan.executableRevision, registered.executableRevision);
  assert.equal(JSON.stringify(f.prepared.snapshot.document), JSON.stringify(registered.registry));
  assert.equal(f.prepared.workflow.versionId, await masWorkflowVersionIdOf(f.prepared.workflow as unknown as Record<string, unknown>));
  const all = [f.prepared.workflow, ...f.prepared.snapshot.subgraphs.values()];
  const loops = all.flatMap(w => w.nodes).filter(n => n.kind === 'loop');
  assert.deepEqual(loops.map(n => [n.id, n.maxIterations]).sort(), [['pivot', 2], ['refine', 3], ['review', 2]]);
  const gates = all.flatMap(w => w.nodes).filter(n => n.kind === 'interaction');
  assert.equal(gates.length, 3); assert.ok(gates.every(g => g.expiry === null));
  assert.ok(all.flatMap(w => w.nodes).some(n => n.kind === 'switch' && n.id === 'decision'));
  assert.ok(all.flatMap(w => w.nodes).some(n => n.kind === 'switch' && n.id === 'quality-decision'));
  assert.match(JSON.stringify(f.prepared.mermaid), /research/);
});

for (const script of registered.cases.filter(row => row.action === 'run' && row.id !== 'review-cap'))
  it(`native lifecycle ${script.id} follows registered edges with exact scripted provider spend`, async () => {
  const f = await workflowFixture(script.decisions), h = await workflowHarness(f), status = script.expected.lifecycleStatus;
  try {
    await h.start(); const trace = await h.finish(script.responses), snapshot = await h.snapshot();
    assert.equal(trace.run.status, 'completed', JSON.stringify(trace.run.failure)); assert.equal(snapshot.state.status, status);
    assert.equal(snapshot.attempts.filter(a => a.attempt.stage === 'EXECUTE').length, script.expected.executions);
    assert.equal(trace.interactions.length, script.expected.approvals);
    assert.deepEqual(trace.run.budget.spent, { turns: 0, tokens: 0, ms: 0 });
    assert.ok(snapshot.attempts.every(a => Object.values(a.attempt.spend).every(n => n === 0)));
    assert.ok(trace.interactions.every(i => i.status === 'responded'));
    if (status === 'STOPPED') assert.equal(trace.interactions.some(i => i.node === 'quality-gate'), false);
    assert.equal(snapshot.attempts.length, (await h.projection()).filter(frame => frame.kind === 'node').length);
  } finally { await h.close(); }
});
it('quality rejection rewrites within the review cap and stops before native exhaustion', async () => {
  const script = registered.cases.find(row => row.id === 'review-cap')!, f = await workflowFixture(script.decisions), h = await workflowHarness(f);
  try {
    await h.start(); const trace = await h.finish(script.responses);
    assert.equal(trace.run.status, 'completed', JSON.stringify(trace.run.failure));
    const s = await h.snapshot(); assert.equal(s.state.status, 'STOPPED');
    assert.equal(s.attempts.filter(a => a.attempt.stage === 'WRITE').length, 2);
    assert.equal(s.attempts.filter(a => a.attempt.stage === 'EXECUTE').length, 1);
  } finally { await h.close(); }
});
it('a widened native run limit fails TMAS2009 before any research task executes', async () => {
  const f = await workflowFixture(), h = await workflowHarness(f);
  try { await h.start({ ...researchExampleLimits, iterations: 9 }); const trace = await h.segment();
    assert.equal(trace.run.failure?.error.code, 'TMAS2009'); assert.equal(trace.attempts.length, 0); assert.equal(h.executions, 0);
  } finally { await h.close(); }
});
it('control input and every content stack dimension enter the single manifest identity', async () => {
  const f = await workflowFixture(), b = f.binding;
  const build = (frame = f.frame, prompt = b.promptRevision, identity = b.runIdentityId, tools = b.toolVersions, evaluator = b.evaluator, reservation = b.reservation) =>
    inputManifestOf(frame.status, frame, prompt, identity, tools, evaluator, reservation);
  const base = await build();
  for (const changed of [await build({ ...f.frame, attempt: 1 }), await build(f.frame, 'f'.repeat(64)), await build(f.frame, b.promptRevision, 'f'.repeat(64)),
    await build(f.frame, b.promptRevision, b.runIdentityId, [{ name: 'changed', version: '2' }]),
    await build(f.frame, b.promptRevision, b.runIdentityId, b.toolVersions, { ...b.evaluator, version: '2' }),
    await build(f.frame, b.promptRevision, b.runIdentityId, b.toolVersions, b.evaluator, { ...b.reservation, tokens: 1 })]) assert.notDeepEqual(changed, base);
  const identity = await researchExampleIdentity();
  await assert.rejects(createResearchBinding(f.contract, { identity: { ...identity, identityId: 'f'.repeat(64) }, ...b }), /CONFIG identity does not recompute/);
});
it('host assembly refuses a changed handler stack before native replay can bypass task admission', async () => {
  const f = await workflowFixture(), h = await workflowHarness(f);
  try {
    const tools = researchExampleTools({ ...f, masStore: h.host.masStore });
    const handlers = createResearchTaskHandlers(h.host.researchStore, { ...tools, binding: { ...f.binding, promptRevision: 'f'.repeat(64) } });
    assert.throws(() => createResearchHostBindings({ masStore: h.host.masStore, researchStore: h.host.researchStore, taskHandlers: handlers,
      prepared: f.prepared, now: () => '2026-01-01T00:00:00.000Z', clock: () => 0 }), /TRSH1007/);
    assert.equal(h.executions, 0);
  } finally { await h.close(); }
});
it('root frames and gate reviews snapshot caller content before hashing yields', async () => {
  const f = await workflowFixture(), project = structuredClone(f.project);
  const pending = initialResearchFrame(project, f.plan, f.binding); project.question = 'Changed after admission';
  assert.equal((await pending).projectHash, await researchProjectHash(f.project));
  const frame = { ...f.frame, status: 'LITERATURE_GATE' as const,
    artifacts: [{ artifactId: 'art-' + 'a'.repeat(64), admissionId: 'admission-' + 'b'.repeat(64) }] };
  const original = structuredClone(frame), review = gateReviewOf('literature', frame, 2);
  frame.artifacts[0].artifactId = 'art-' + 'f'.repeat(64);
  assert.deepEqual(await checkResearchGate({ ...original, gate: await review }, 'literature'), await gateReviewOf('literature', original, 2));
});
it('workflow construction refuses a contract whose caps changed without a new content identity', async () => {
  const f = await workflowFixture();
  await assert.rejects(prepareResearchWorkflow({ ...f.contract, pivotCap: 3 }, { binding: f.binding,
    profile: 'research-scripted', limits: researchExampleLimits }), /TRSH1002/);
});
