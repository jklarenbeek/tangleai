import assert from 'node:assert/strict';
import { it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MasInfrastructureCrash, MasTaskRefusal } from '@tangleai/mas';
import type { ResearchDesignProposal, HypothesisSetProposal } from '@tangleai/research';
import { reasoningWorkflowHarness } from './reasoning-workflow-fixtures.ts';
import { resolveResearchFrame } from '../../packages/research/src/frames.ts';

it('reasoning control resolves its retained evidence checkpoint and refuses altered control', async () => {
  const h = await reasoningWorkflowHarness();
  try {
    await h.start(); await h.segment(); await h.respond(); const trace = await h.segment();
    assert.equal(trace.run.status, 'waiting_for_input', JSON.stringify(trace.run.failure));
    const operation = h.operations.find(row => row.stage === 'hypothesis')!;
    const preparation = trace.attempts.find(row => row.kind === 'task' && row.path.endsWith('/hypothesis/prepare'))!.output as {
      preparation: { frame: import('@tangleai/research').ResearchWorkflowFrame } };
    const wire = preparation.preparation.frame;
    assert.equal(wire.artifacts.length, 0); assert.ok(wire.checkpoint);
    assert.deepEqual((await resolveResearchFrame(h.host.researchStore, wire)).artifacts, operation.frame.artifacts);
    await assert.rejects(resolveResearchFrame(h.host.researchStore, { ...wire, pivot: wire.pivot + 1 }), /TRSH1002/);
    const snapshot = await h.snapshot();
    assert.ok(snapshot.committedAdmissionIds.includes(wire.checkpoint.admissionId));
    assert.ok(operation.frame.artifacts.every(ref => snapshot.committedAdmissionIds.includes(ref.admissionId)));
    assert.equal(h.calls, 6);
  } finally { await h.close(); }
});

for (const mode of ['single-agent', 'debate'] as const) it(mode + ' uses one native research run and freezes its generated plan at the real design gate', async () => {
  const h = await reasoningWorkflowHarness(mode);
  try {
    await h.start(); assert.equal((await h.segment()).run.status, 'waiting_for_input');
    const discovered = await h.snapshot(); assert.equal(discovered.state.contractHash, null); assert.equal(h.calls, 0);
    await h.respond(); const trace = await h.segment(), snapshot = await h.snapshot();
    assert.equal(trace.run.status, 'waiting_for_input', JSON.stringify(trace.run.failure));
    assert.equal(snapshot.state.status, 'DESIGN_GATE'); assert.equal(snapshot.state.planHash, h.f.design.plan.planHash);
    assert.equal(snapshot.state.contractHash, h.f.design.contract.contractHash);
    for (const id of discovered.committedAdmissionIds) {
      assert.ok(snapshot.committedAdmissionIds.includes(id));
      const artifact = await h.host.researchStore.readArtifact(h.owner.id, id); assert.equal(artifact.ok, true);
    }
    assert.equal(snapshot.records.filter(row => row.kind === 'ResearchHypothesis').length, 2);
    const novelty = snapshot.records.find(row => row.kind === 'NoveltyReport')!;
    assert.equal(novelty.kind, 'NoveltyReport'); if (novelty.kind !== 'NoveltyReport') throw Error('Missing report');
    assert.deepEqual(novelty.value.coverage, { attempted: 2, complete: 2, total: 2 }); assert.equal(novelty.value.gating, false);
    const stages = snapshot.attempts.filter(row => ['SYNTHESIS', 'HYPOTHESIS_GATE', 'DESIGN'].includes(row.attempt.stage));
    assert.equal(stages.length, 3); assert.ok(stages.every(row => row.attempt.mode === mode));
    const calls = mode === 'single-agent' ? 6 : 26;
    assert.equal(h.calls, calls); assert.equal(stages.reduce((sum, row) => sum + row.attempt.spend.calls, 0), calls);
    assert.equal(stages.reduce((sum, row) => sum + row.attempt.spend.tokens, 0), calls * 10);
    assert.equal(trace.run.budget.spent.turns, calls); assert.equal(trace.run.budget.spent.tokens, calls * 10);
    assert.ok(trace.attempts.every(row => row.runId === h.owner.id));
    assert.equal(snapshot.records.filter(row => row.kind === 'MetricObservation').length, 0);
    await h.respond(); const failed = await h.segment();
    assert.equal(failed.run.status, 'failed'); assert.equal(failed.run.failure?.error.cause?.code, 'TRSH1007'); assert.equal(h.downstream, 0);
    assert.equal((await h.snapshot()).attempts.find(row => row.attempt.stage === 'EXECUTE')?.attempt.error?.code, 'TRSH1007');
  } finally { await h.close(); }
});
it('model preparation cannot admit a host-supplied hidden dataset path', async () => {
  await assert.rejects(reasoningWorkflowHarness('single-agent', { inputPaths: ['hidden/results.json'] }), /TRSH1005/);
});

for (const [name, stage, expected, calls, mutate] of [
  ['unknown evidence', 'hypothesis', 'TRSH1003', 4, (p: unknown) => { (p as HypothesisSetProposal).hypotheses[0].evidenceIds = ['unseen-card']; return p; }],
  ['uncontrolled confound', 'design', 'TRSH1009', 6, (p: unknown) => { (p as ResearchDesignProposal).plan.design.controls[0].confound = 'a different confound'; return p; }],
  ['hidden dataset', 'design', 'TRSH1005', 6, (p: unknown) => { (p as ResearchDesignProposal).plan.inputPaths.push('hidden/labels.json'); return p; }],
  ['malformed native output', 'synthesis', 'TRSH1008', 3, () => ({})],
] as const) it(name + ' stops the real model workflow and retains all physical cost', async () => {
  const h = await reasoningWorkflowHarness('single-agent', { proposal: (actual, p) => actual === stage ? mutate(p) : p });
  try {
    await h.start(); await h.segment(); await h.respond(); const trace = await h.segment(), snapshot = await h.snapshot();
    assert.equal(trace.run.status, 'failed', JSON.stringify(trace.run.failure)); assert.equal(snapshot.state.status, 'STOPPED');
    assert.equal(snapshot.attempts.find(row => row.attempt.stopReason === 'failed')?.attempt.error?.code, expected);
    assert.equal(h.calls, calls); assert.equal(snapshot.attempts.reduce((sum, row) => sum + row.attempt.spend.calls, 0), calls);
    assert.equal(snapshot.attempts.reduce((sum, row) => sum + row.attempt.spend.tokens, 0), calls * 10);
    assert.equal(snapshot.state.contractHash, null); assert.equal(h.downstream, 0);
  } finally { await h.close(); }
});
it('an observed reservation overrun is retained on a terminal failed receipt without granting more work', async () => {
  const h = await reasoningWorkflowHarness('single-agent', { client: base => ({ ...base, complete: async request => {
    const result = await base.complete(request); return { ...result, usage: { prompt_tokens: 16000, completion_tokens: 1 } };
  } }) });
  try {
    await h.start(); await h.segment(); await h.respond(); const trace = await h.segment(), snapshot = await h.snapshot();
    assert.equal(trace.run.status, 'failed'); assert.equal(snapshot.state.status, 'STOPPED');
    const failed = snapshot.attempts.find(row => row.attempt.stopReason === 'failed')!;
    assert.equal(failed.attempt.error?.code, 'TRSH1006'); assert.equal(failed.attempt.spend.tokens, 32002);
    assert.equal(trace.run.budget.spent.tokens, 32002); assert.equal(failed.attempt.spend.calls, 2);
  } finally { await h.close(); }
});
it('a committed synthesis survives SQLite reopen without another model call or duplicate spend', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'research-model-reopen-')); let armed = true;
  const h = await reasoningWorkflowHarness('single-agent', { path: join(dir, 'research.sqlite'), onOperation: (step, op) => {
    if (armed && step === 'committed' && op.stage === 'synthesis') { armed = false; throw new MasInfrastructureCrash('Crash after model-stage commit.'); }
  } });
  try {
    await h.start(); await h.segment(); await h.respond(); await assert.rejects(h.segment(), /Crash after model-stage commit/);
    assert.equal(h.calls, 2); await h.reopen(); const trace = await h.segment(), snapshot = await h.snapshot();
    assert.equal(trace.run.status, 'waiting_for_input', JSON.stringify(trace.run.failure)); assert.equal(snapshot.state.status, 'DESIGN_GATE');
    assert.equal(h.calls, 6); assert.equal(snapshot.attempts.filter(row => row.attempt.stage === 'SYNTHESIS').length, 1);
    assert.equal(snapshot.attempts.reduce((sum, row) => sum + row.attempt.spend.calls, 0), 6);
  } finally { await h.close(); await rm(dir, { recursive: true, force: true }); }
});
it('native failure recovery reuses the terminal research receipt after a crash between the two owners', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'research-model-failure-')); let armed = true;
  const h = await reasoningWorkflowHarness('single-agent', { path: join(dir, 'research.sqlite'), proposal: stage => stage === 'synthesis' ? {} : undefined,
    failTransition: () => { if (!armed) return false; armed = false; return true; } });
  try {
    await h.start(); await h.segment(); await h.respond(); await assert.rejects(h.segment(), /between research failure and native failure/);
    const before = await h.snapshot(); assert.equal(before.state.status, 'STOPPED'); assert.equal(h.calls, 3);
    await h.reopen(); const trace = await h.segment(); assert.equal(trace.run.status, 'failed');
    assert.deepEqual(await h.snapshot(), before); assert.equal(h.calls, 3); assert.equal(trace.run.budget.spent.turns, 3);
  } finally { await h.close(); await rm(dir, { recursive: true, force: true }); }
});
it('a native gate failure after design commits stops the research projection and replays without charging its models again', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'research-gate-failure-')); let armed = true;
  const h = await reasoningWorkflowHarness('single-agent', { path: join(dir, 'research.sqlite'),
    failInteraction: node => node === 'design-gate', failTransition: () => { if (!armed) return false; armed = false; return true; } });
  try {
    await h.start(); await h.segment(); await h.respond(); await assert.rejects(h.segment(), /between research failure and native failure/);
    const before = await h.snapshot(); assert.equal(before.state.status, 'STOPPED'); assert.equal(h.calls, 6);
    assert.equal(before.state.planHash, h.f.design.plan.planHash);
    const failed = before.attempts.find(row => row.attempt.stopReason === 'failed')!;
    assert.equal(failed.attempt.stage, 'DESIGN_GATE'); assert.equal(failed.attempt.error?.code, 'TRSH1008');
    const gateAttempt = (await h.host.masStore.readTrace(h.owner.id))!.attempts.find(row => row.invocationId === 'design-gate')!;
    assert.equal(failed.attempt.masPath, gateAttempt.path);
    assert.deepEqual(failed.attempt.spend, { calls: 0, tokens: 0, ms: 0, physical: 0 });
    assert.equal(before.attempts.reduce((sum, row) => sum + row.attempt.spend.calls, 0), 6);
    await h.reopen(); const trace = await h.segment(); assert.equal(trace.run.status, 'failed');
    assert.deepEqual(await h.snapshot(), before); assert.equal(h.calls, 6); assert.equal(trace.run.budget.spent.turns, 6);
  } finally { await h.close(); await rm(dir, { recursive: true, force: true }); }
});
it('single-agent tools read only prepared evidence and proposal validation writes no research records', async () => {
  let h: Awaited<ReturnType<typeof reasoningWorkflowHarness>>, asked = false, before: unknown, inspected = false;
  h = await reasoningWorkflowHarness('single-agent', { client: (base, node) => ({ ...base, complete: async request => {
    const completion = await base.complete(request);
    if (node.role !== 'research-synthesizer') return completion;
    if (!asked) {
      asked = true; before = await h.snapshot();
      return { ...completion, message: { role: 'assistant', content: '', toolCalls: [
        { id: 'cards', name: 'read_cards', arguments: '{}' }, { id: 'synthesis', name: 'read_synthesis', arguments: '{}' },
        { id: 'hypotheses', name: 'propose_hypotheses', arguments: JSON.stringify(h.f.hypothesisProposal) },
        { id: 'hidden', name: 'read_cards', arguments: JSON.stringify({ path: 'hidden/labels.json' }) },
      ] }, finishReason: 'tool_calls' };
    }
    const messages = (request as { messages: Array<{ role: string; content: string }> }).messages;
    if (!inspected && messages.at(-1)?.role === 'tool') {
      inspected = true; assert.deepEqual(await h.snapshot(), before);
      const replies = messages.filter(row => row.role === 'tool').map(row => row.content);
      assert.equal(replies.length, 4); assert.match(replies[0], /card-fixture/); assert.match(replies[1], /Compare initialization/);
      assert.match(replies[2], /"valid":true/); assert.match(replies[3], /error/);
    }
    return completion;
  } }) });
  try {
    await h.start(); await h.segment(); await h.respond(); const trace = await h.segment();
    assert.equal(trace.run.status, 'waiting_for_input', JSON.stringify(trace.run.failure)); assert.equal(inspected, true); assert.equal(h.calls, 7);
    const steps = trace.attempts.flatMap(row => row.toolSteps); assert.equal(steps.length, 4);
    assert.deepEqual(steps.map(row => row.name), ['read_cards', 'read_synthesis', 'propose_hypotheses', 'read_cards']);
    await assert.rejects(async () => h.host.bindings.toolBindings.read_cards.handler({}, { signal: new AbortController().signal,
      idempotencyKey: null, invocation: { runId: h.owner.id, node: 'model', path: 'invented/model' } }), /TRSH1005/);
  } finally { await h.close(); }
});
it('a preparation refusal stops the projection before dispatch and preserves the earlier model receipt', async () => {
  const h = await reasoningWorkflowHarness('single-agent', { onOperation: (step, op) => {
    if (step === 'prepared' && op.stage === 'hypothesis') throw new MasTaskRefusal({ code: 'TMAS2004', detail: 'Preparation refused.',
      cause: { code: 'TRSH1005', docPath: '/inputs', message: 'Preparation refused.' } });
  } });
  try {
    await h.start(); await h.segment(); await h.respond(); const trace = await h.segment(), snapshot = await h.snapshot();
    assert.equal(trace.run.status, 'failed'); assert.equal(snapshot.state.status, 'STOPPED'); assert.equal(h.calls, 2);
    const failed = snapshot.attempts.find(row => row.attempt.stopReason === 'failed')!;
    assert.equal(failed.attempt.stage, 'HYPOTHESIS_GATE'); assert.equal(failed.attempt.error?.code, 'TRSH1005');
    assert.equal(failed.attempt.spend.calls, 0); assert.equal(snapshot.attempts.reduce((sum, row) => sum + row.attempt.spend.calls, 0), 2);
  } finally { await h.close(); }
});
for (const [stage, point] of [['synthesis', 'planned'], ['design', 'committed']] as const)
  it('resume at ' + stage + ' ' + point + ' preserves completed model calls and the frozen plan', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'research-model-boundary-')); let armed = true, plans = 0;
    const h = await reasoningWorkflowHarness('single-agent', { path: join(dir, 'research.sqlite'), onOperation: (step, op) => {
      if (op.stage !== stage || step !== point) return;
      if (point === 'planned' && ++plans < 2) return;
      if (armed) { armed = false; throw new MasInfrastructureCrash('Native model boundary interruption.'); }
    } });
    try {
      await h.start(); await h.segment(); await h.respond(); await assert.rejects(h.segment(), /boundary interruption/);
      await h.reopen(); const trace = await h.segment(), snapshot = await h.snapshot();
      assert.equal(trace.run.status, 'waiting_for_input', JSON.stringify(trace.run.failure)); assert.equal(h.calls, 6);
      assert.equal(snapshot.state.planHash, h.f.design.plan.planHash);
      assert.equal(snapshot.attempts.reduce((sum, row) => sum + row.attempt.spend.calls, 0), 6);
    } finally { await h.close(); await rm(dir, { recursive: true, force: true }); }
  });
