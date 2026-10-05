import assert from 'node:assert/strict';
import { it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createResearchStore } from '@tangleai/store';
import { researchValue, validateResearchShape, type HumanCommand, type ResearchWorkflowFrame } from '@tangleai/research';
import type { TraceView } from '@tangleai/mas';
import { createResearchCommands, planHumanCommand, interventionReport } from '../../packages/research/src/commands.ts';
import { workflowFixture, workflowHarness } from './workflow-fixtures.ts';
import { readResearchDirective } from '../../packages/research/src/directives.ts';
import { writingWorkflowFixture, writingWorkflowTools, writingReviewClient } from './writing-workflow-fixtures.ts';
import { reasoningWorkflowHarness } from './reasoning-workflow-fixtures.ts';

function command(trace: TraceView, kind: HumanCommand['kind'], id: string = kind, extra: Record<string, unknown> = {}): HumanCommand {
  const gate = trace.interactions.find(row => row.status === 'waiting'); assert.ok(gate);
  const review = (gate.prompt as ResearchWorkflowFrame).gate; assert.ok(review);
  return researchValue(validateResearchShape<HumanCommand>('HumanCommand', { kind, id, interactionId: gate.id,
    revision: gate.revision, gate: review.kind, approvedManifestHash: review.manifestHash,
    actor: 'human', actorId: 'fixture-operator', at: '2026-10-04T00:00:00Z',
    ...(kind === 'approve' ? { note: 'Reviewed the evidence.' } : kind === 'stop' ? { reason: 'Stop this run.' }
      : kind === 'guide' ? { text: 'Retain the negative results and their uncertainty.' }
        : kind === 'reject' ? { reason: 'Revisit the declared stage.', target: 'write' } : {}), ...extra }));
}
it('human command planning is read-only and stale manifests, revisions and clock actors refuse before writes', async () => {
  const f = await workflowFixture(), h = await workflowHarness(f);
  try {
    await h.start(); const trace = await h.segment(), before = structuredClone(trace), approve = command(trace, 'approve');
    assert.ok((await planHumanCommand(trace, approve)).ok);
    for (const changed of [{ approvedManifestHash: 'f'.repeat(64) }, { revision: 99 }, { actor: 'timeout' }, { at: 'tomorrow' }]) {
      const result = await planHumanCommand(trace, { ...approve, ...changed });
      assert.ok(!result.ok && result.issue.code === 'TMAS2007', JSON.stringify(result));
    }
    assert.deepEqual(trace, before); assert.deepEqual(await h.host.masStore.readTrace(f.project.id), before);
    const commands = createResearchCommands(h.host), status = await commands.attach(f.project.id);
    assert.ok(status.ok); assert.equal(status.value.interventions.total, 0);
    assert.deepEqual(await h.host.masStore.readTrace(f.project.id), before);
  } finally { await h.close(); }
});

for (const kind of ['approve', 'guide', 'reject'] as const) it(`${kind} survives a competing attachment and SQLite restart with one recorded action`, async () => {
  const f = await workflowFixture(), dir = await mkdtemp(join(tmpdir(), 'research-action-'));
  const directives: Array<Awaited<ReturnType<typeof readResearchDirective>>> = [];
  const h = await workflowHarness(f, { path: join(dir, 'state.sqlite'), tools: base => ({ ...base,
    async execute(operation, access) { directives.push(await readResearchDirective(operation, access)); return base.execute(operation, access); } }) });
  try {
    await h.start(); let trace = await h.segment();
    if (kind === 'reject') {
      assert.ok((await h.respond()).ok); trace = await h.segment();
      assert.ok((await h.respond()).ok); trace = await h.segment();
    }
    const proposed = command(trace, kind), rival = { ...proposed, id: proposed.id + '-rival' };
    const a = createResearchCommands(h.host), b = createResearchCommands(h.host);
    assert.ok((await a.attach(f.project.id)).ok); assert.ok((await b.attach(f.project.id)).ok);
    const responses = await Promise.all([a.execute(proposed), b.execute(rival)]);
    assert.equal(responses.filter(row => row.ok).length, 1);
    const winner = responses[0].ok ? proposed : rival, accepted = responses.find(row => row.ok)!;
    const executions = h.executions; await h.reopen();
    assert.deepEqual(await createResearchCommands(h.host).execute(winner), accepted); assert.equal(h.executions, executions);
    trace = await h.segment(); assert.equal(trace.run.status, 'waiting_for_input', JSON.stringify(trace.run.failure));
    const snapshot = await h.snapshot(), row = snapshot.records.find(row => row.kind === 'Intervention' && row.id === winner.id);
    assert.equal(row?.kind, 'Intervention'); if (row?.kind !== 'Intervention') return;
    assert.equal(row.value.action, kind === 'guide' ? 'guidance' : kind); assert.equal(row.value.substantive, kind !== 'approve');
    assert.equal(row.value.actorId, winner.actorId); assert.equal(row.value.at, winner.at);
    if (kind === 'guide') {
      const directive = directives.find(row => row?.interventionId === winner.id); assert.ok(directive);
      assert.equal(directive.stage, 'SYNTHESIS'); assert.equal(directive.text, winner.kind === 'guide' ? winner.text : '');
      const synthesis = snapshot.attempts.find(row => row.attempt.stage === 'SYNTHESIS')!;
      const manifest = snapshot.records.find(row => row.kind === 'InputManifest' && row.id === 'manifest-' + synthesis.attempt.inputManifestHash);
      assert.ok(manifest?.kind === 'InputManifest'); assert.equal(manifest.value.guidanceHash, directive.guidanceHash);
    }
    if (kind === 'reject') assert.equal(snapshot.attempts.filter(row => row.attempt.stage === 'WRITE').length, 2);
    assert.ok((await h.respond()).ok); trace = await h.finish(); assert.equal(trace.run.status, 'completed', JSON.stringify(trace.run.failure));
    assert.equal((await h.snapshot()).state.status, 'COMPLETE');
    const after = h.executions; assert.deepEqual(await createResearchCommands(h.host).execute(winner), accepted); assert.equal(h.executions, after);
  } finally { await h.close(); await rm(dir, { recursive: true, force: true }); }
});

it('trace accounting refuses one response key reused for two distinct native gate actions', async () => {
  const f = await workflowFixture(), h = await workflowHarness(f);
  try {
    await h.start(); let trace = await h.segment();
    for (let index = 0; index < 2; index++) {
      const gate = trace.interactions.find(row => row.status === 'waiting')!;
      const response = { decision: 'approve', approvedManifestHash: (gate.prompt as ResearchWorkflowFrame).gate!.manifestHash,
        actor: 'scripted', note: 'Legacy native caller.' };
      assert.ok((await h.host.masStore.respondInteraction(gate.id, response, gate.revision, 'reused-native-key')).ok);
      if (index === 0) trace = await h.segment();
    }
    trace = (await h.host.masStore.readTrace(f.project.id))!;
    assert.equal(trace.interactions.filter(row => row.status === 'responded').length, 2);
    assert.throws(() => interventionReport(trace), /TRSH1002/);
  } finally { await h.close(); }
});

for (const target of ['analyze', 'design'] as const) it(`quality rejection follows the bounded ${target} edge and retains earlier artifacts`, async () => {
  const f = await workflowFixture(), h = await workflowHarness(f);
  try {
    await h.start(); await h.segment(); await h.respond(); await h.segment(); await h.respond();
    const trace = await h.segment(), before = await h.snapshot(), action = command(trace, 'reject', 'retry-' + target, { target });
    assert.ok((await createResearchCommands(h.host).execute(action)).ok);
    const finished = await h.finish(); assert.equal(finished.run.status, 'completed', JSON.stringify(finished.run.failure));
    const after = await h.snapshot(); assert.equal(after.state.status, 'COMPLETE');
    for (const row of before.artifacts) assert.deepEqual(after.artifacts.find(found => found.id === row.id), row);
    assert.equal(after.attempts.filter(row => row.attempt.stage === 'ANALYZE').length, 2);
    assert.equal(after.attempts.filter(row => row.attempt.stage === 'EXECUTE').length, target === 'design' ? 2 : 1);
  } finally { await h.close(); }
});

it('an edited writer proposal survives racing attachments and restart as a pending child before independent verification', async () => {
  const f = await writingWorkflowFixture('agent', 2), dir = await mkdtemp(join(tmpdir(), 'research-edit-'));
  const requests: unknown[] = [];
  const h = await workflowHarness(f, { path: join(dir, 'state.sqlite'),
    tools: (base, stores) => writingWorkflowTools(f, base, stores.researchStore),
    clientFor: writingReviewClient({ observe: (role, request) => { if (role === 'research-writer') requests.push(request); } }) });
  try {
    await h.start(f.limits); await h.segment(); await h.respond(); await h.segment(); await h.respond();
    const trace = await h.segment(); assert.equal(trace.run.status, 'waiting_for_input', JSON.stringify(trace.run.failure));
    const before = await h.snapshot(), proposals = await Promise.all(before.artifacts
      .filter(row => row.artifact.mediaType === 'application/vnd.tangleai.research-writing-proposal+json').map(async row => {
        const bytes = researchValue(await h.host.researchStore.readArtifact(f.project.id, row.id)).bytes;
        return { original: row, bytes, proposal: JSON.parse(new TextDecoder().decode(bytes)) };
      }));
    const { original, bytes, proposal } = proposals.find(row => row.proposal.phase === 'write')!;
    const sectionIndex = proposal.proposal.sections.findIndex((row: { claimIds: string[] }) => row.claimIds.length > 1);
    assert.ok(sectionIndex >= 0);
    const section = proposal.proposal.sections[sectionIndex], sentences = section.text.split('\n\n');
    assert.equal(sentences.length, section.claimIds.length);
    const revised = { ...section, claimIds: [...section.claimIds].reverse(), text: sentences.reverse().join('\n\n') };
    const edit = command(trace, 'edit', 'edit-reviewed-draft', { target: 'write', artifactId: original.artifact.id,
      admissionId: original.id, patch: [{ op: 'replace', path: '/proposal/sections/' + sectionIndex, value: revised }] });
    const rival = { ...edit, id: 'rival-reviewed-draft' };
    const outcomes = await Promise.all([createResearchCommands(h.host).execute(edit), createResearchCommands(h.host).execute(rival)]);
    assert.equal(outcomes.filter(row => row.ok).length, 1, JSON.stringify(outcomes));
    const accepted = outcomes.find(row => row.ok)!, winner = outcomes[0].ok ? edit : rival, calls = requests.length;
    await h.reopen(); assert.deepEqual(await createResearchCommands(h.host).execute(winner), accepted); assert.equal(requests.length, calls);
    const next = await h.segment(); assert.equal(next.run.status, 'waiting_for_input', JSON.stringify(next.run.failure));
    const after = await h.snapshot(), intervention = after.records.find(row => row.kind === 'Intervention' && row.id === winner.id);
    assert.ok(intervention?.kind === 'Intervention'); assert.equal(intervention.value.action, 'edit'); assert.equal(intervention.value.substantive, true);
    const admissions = after.artifacts.filter(row => row.artifact.id === intervention.value.effect!.editedArtifactId);
    const pending = admissions.filter(row => row.artifact.verification === 'pending'); assert.equal(pending.length, 1);
    const changed = pending[0];
    assert.equal(changed.artifact.verification, 'pending'); assert.deepEqual(changed.artifact.parentIds, [original.artifact.id]);
    assert.equal(after.committedAdmissionIds.includes(changed.id), false);
    assert.ok(admissions.some(row => row.id !== changed.id && row.artifact.verification === 'verified' && after.committedAdmissionIds.includes(row.id)));
    assert.deepEqual(researchValue(await h.host.researchStore.readArtifact(f.project.id, original.id)).bytes, bytes);
    const drafts = after.records.filter(row => row.kind === 'Draft').map(row => row.value);
    assert.equal(drafts.length, 2); assert.ok(drafts.some(row => JSON.stringify(row.sections[sectionIndex]) === JSON.stringify(revised)));
    assert.ok(requests.slice(calls).some(row => JSON.stringify(row).includes(winner.id)));
    assert.ok((await h.respond()).ok); assert.equal((await h.finish()).run.status, 'completed');
    const completedCalls = requests.length; assert.deepEqual(await createResearchCommands(h.host).execute(winner), accepted);
    assert.equal(requests.length, completedCalls);
  } finally { await h.close(); await rm(dir, { recursive: true, force: true }); }
});
for (const honorEdit of [false, true]) it(`a design edit ${honorEdit ? 'creates a separately frozen amendment after restart' : 'refuses a model that ignores the reviewed candidate'}`, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'research-design-command-'));
  let candidate: unknown;
  const h = await reasoningWorkflowHarness('single-agent', { path: join(directory, 'research.sqlite'),
    proposal: (stage, proposal) => honorEdit && stage === 'design' && candidate !== undefined ? structuredClone(candidate) : proposal });
  try {
    await h.start(); await h.segment(); await h.respond(); const trace = await h.segment();
    assert.equal(trace.run.status, 'waiting_for_input', JSON.stringify(trace.run.failure));
    const before = await h.snapshot();
    const proposals = await Promise.all(before.artifacts.filter(row => row.artifact.mediaType === 'application/json').map(async row => {
      const bytes = researchValue(await h.host.researchStore.readArtifact(h.owner.id, row.id)).bytes;
      return { row, bytes, content: JSON.parse(new TextDecoder().decode(bytes)) };
    }));
    const original = proposals.find(row => row.content.kind === 'reasoning-proposal' && row.content.stage === 'design')!;
    assert.ok(original);
    const revised = structuredClone(original.content.proposal);
    revised.plan.design.expectedFailures.push('Human review requires retaining null and negative outcomes.');
    candidate = revised;
    const action = command(trace, 'edit', 'review-design-candidate', { target: 'design', artifactId: original.row.artifact.id,
      admissionId: original.row.id, patch: [{ op: 'replace', path: '/proposal/plan/design/expectedFailures', value: revised.plan.design.expectedFailures }] });
    const accepted = await createResearchCommands(h.host).execute(action); assert.ok(accepted.ok, JSON.stringify(accepted));
    const calls = h.calls; await h.reopen();
    assert.deepEqual(await createResearchCommands(h.host).execute(action), accepted); assert.equal(h.calls, calls);
    const next = await h.segment(), after = await h.snapshot();
    assert.deepEqual(researchValue(await h.host.researchStore.readArtifact(h.owner.id, original.row.id)).bytes, original.bytes);
    for (const record of before.records) assert.deepEqual(after.records.find(row => row.kind === record.kind && row.id === record.id), record);
    if (!honorEdit) {
      assert.equal(next.run.status, 'failed', JSON.stringify(next.run.failure));
      assert.equal(after.attempts.find(row => row.attempt.stopReason === 'failed')?.attempt.error?.code, 'TRSH1005');
      assert.equal(after.state.planHash, before.state.planHash);
      assert.equal(after.records.filter(row => row.kind === 'Amendment').length, 0);
    } else {
      assert.equal(next.run.status, 'waiting_for_input', JSON.stringify(next.run.failure));
      assert.equal(after.state.status, 'DESIGN_GATE'); assert.notEqual(after.state.planHash, before.state.planHash);
      const amendments = after.records.filter(row => row.kind === 'Amendment').map(row => row.value);
      assert.equal(amendments.length, 1); assert.equal(amendments[0].before, before.state.contractHash);
      assert.equal(amendments[0].after, after.state.contractHash); assert.deepEqual(amendments[0].marksExploratory, []);
      assert.match(amendments[0].reason, /review-design-candidate/);
      const plan = after.records.find(row => row.kind === 'ExperimentPlan' && row.value.planHash === after.state.planHash);
      assert.ok(plan?.kind === 'ExperimentPlan'); assert.deepEqual(plan.value.design!.expectedFailures, revised.plan.design.expectedFailures);
      assert.equal(after.attempts.filter(row => row.attempt.stage === 'DESIGN').length, 2);
      assert.ok((await createResearchCommands(h.host).execute(command(next, 'stop', 'end-design-fixture'))).ok);
    }
  } finally { await h.close(); await rm(directory, { recursive: true, force: true }); }
});
it('an accepted edit remains attributable when staging its pending child fails', async () => {
  const h = await reasoningWorkflowHarness();
  try {
    await h.start(); await h.segment(); await h.respond(); const trace = await h.segment(), before = await h.snapshot();
    const proposals = await Promise.all(before.artifacts.filter(row => row.artifact.mediaType === 'application/json').map(async row => ({ row,
      content: JSON.parse(new TextDecoder().decode(researchValue(await h.host.researchStore.readArtifact(h.owner.id, row.id)).bytes)) })));
    const original = proposals.find(row => row.content.kind === 'reasoning-proposal' && row.content.stage === 'design')!;
    const action = command(trace, 'edit', 'accepted-edit-staging-failure', { target: 'design', artifactId: original.row.artifact.id,
      admissionId: original.row.id, patch: [{ op: 'add', path: '/proposal/plan/design/expectedFailures/-', value: 'Retain a negative result.' }] });
    const accepted = await createResearchCommands(h.host).execute(action); assert.ok(accepted.ok, JSON.stringify(accepted));
    const stage = h.host.researchStore.stageArtifact;
    h.host.researchStore.stageArtifact = (bytes, descriptor) => descriptor.verification === 'pending'
      ? Promise.resolve({ ok: false, issue: { code: 'TRSH1008', path: '/artifact', detail: 'Injected pending-edit storage refusal.' } })
      : stage(bytes, descriptor);
    const calls = h.calls, failed = await h.segment(), snapshot = await h.snapshot();
    assert.equal(failed.run.status, 'failed'); assert.equal(snapshot.state.status, 'STOPPED'); assert.equal(h.calls, calls);
    const row = snapshot.records.find(row => row.kind === 'Intervention' && row.id === action.id);
    assert.ok(row?.kind === 'Intervention'); assert.equal(row.value.action, 'edit'); assert.equal(row.value.actorId, action.actorId);
    assert.equal(row.value.effect?.target, 'STOPPED'); assert.equal(row.value.effect?.editedArtifactId, null);
    assert.equal(snapshot.attempts.find(row => row.attempt.stopReason === 'failed')?.attempt.interventions.includes(action.id), true);
    assert.deepEqual(await createResearchCommands(h.host).execute(action), accepted); assert.equal(h.calls, calls);
  } finally { await h.close(); }
});
it('an attributable human stop survives SQLite reopen and duplicate delivery without executing another stage', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'research-command-')), f = await workflowFixture();
  const h = await workflowHarness(f, { path: join(dir, 'research.sqlite') });
  try {
    await h.start(); const trace = await h.segment(), stop = command(trace, 'stop'), executions = h.executions;
    const first = await createResearchCommands(h.host).execute(stop); assert.ok(first.ok, JSON.stringify(first));
    await h.reopen();
    assert.deepEqual(await createResearchCommands(h.host).execute(stop), first);
    assert.equal(h.executions, executions);
    const after = await h.host.masStore.readTrace(f.project.id); assert.ok(after);
    assert.equal(after.run.status, 'failed'); assert.equal(after.interactions[0].responseKey, stop.id);
    assert.deepEqual(interventionReport(after), { total: 1, approvals: 0, substantive: 0, stops: 1, human: 1, scripted: 0, automatic: 0 });
    const snapshot = await h.snapshot(), records = snapshot.records.filter(row => row.kind === 'Intervention');
    assert.equal(snapshot.state.status, 'STOPPED'); assert.equal(records.length, 1);
    const record = records[0]; assert.equal(record.kind, 'Intervention'); if (record.kind !== 'Intervention') return;
    assert.equal(record.value.actorId, 'fixture-operator'); assert.equal(record.value.at, stop.at);
    assert.equal(record.value.effect?.target, 'STOPPED'); assert.ok(record.value.viewedArtifactIds!.length > 0);
    assert.equal((await h.db.jobs!.counts()).pending, 0);
  } finally { await h.close(); await rm(dir, { recursive: true, force: true }); }
});
it('a durable cancellation reconciles every failed domain-write boundary on duplicate delivery', async () => {
  const f = await workflowFixture(), h = await workflowHarness(f); let failAt = '';
  try {
    await h.start(); const trace = await h.segment(), stop = command(trace, 'stop'), before = await h.snapshot();
    const researchStore = createResearchStore(h.db, { applyProbe: step => { if (step === failAt) throw Error('injected human-stop projection'); } });
    const commands = createResearchCommands({ masStore: h.host.masStore, researchStore });
    for (const step of ['put:records', 'put:state', 'projection:append', 'projection:finish', 'commit']) {
      failAt = step; const result = await commands.execute(stop);
      assert.ok(!result.ok && result.issue.code === 'TMAS2007', step);
      assert.deepEqual(await h.snapshot(), before, step);
      assert.equal((await h.host.masStore.getInteraction(stop.interactionId))?.status, 'cancelled');
    }
    failAt = ''; const result = await commands.execute(stop); assert.ok(result.ok, JSON.stringify(result));
    const after = await h.snapshot(); assert.equal(after.state.status, 'STOPPED');
    assert.equal(after.records.filter(row => row.kind === 'Intervention').length, 1);
    assert.deepEqual(await commands.execute(stop), result); assert.deepEqual(await h.snapshot(), after);
  } finally { await h.close(); }
});
for (const first of ['approve', 'stop'] as const) it(`two attached command clients retain only the winning ${first} action`, async () => {
  const f = await workflowFixture(), h = await workflowHarness(f);
  try {
    await h.start(); const trace = await h.segment(), a = createResearchCommands(h.host), b = createResearchCommands(h.host);
    const approve = command(trace, 'approve'), stop = command(trace, 'stop');
    const actions = first === 'approve' ? [() => a.execute(approve), () => b.execute(stop)] : [() => b.execute(stop), () => a.execute(approve)];
    const results = await Promise.all(actions.map(action => action()));
    assert.equal(results.filter(row => row.ok).length, 1);
    const retained = await h.host.masStore.readTrace(f.project.id); assert.ok(retained);
    const counts = interventionReport(retained); assert.equal(counts.total, 1); assert.equal(counts.substantive, 0);
    assert.equal(counts.approvals, first === 'approve' ? 1 : 0); assert.equal(counts.stops, first === 'stop' ? 1 : 0);
    const before = h.executions; assert.ok((await a.execute(first === 'approve' ? approve : stop)).ok); assert.equal(h.executions, before);
  } finally { await h.close(); }
});
