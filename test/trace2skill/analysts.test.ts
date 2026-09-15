/**
 * The two analyst roles: one rollout each, the frozen directory and nothing
 * else. A success is read once; a failure is diagnosed against a repair the
 * host's own evaluator passed over, and every reason a patch was not emitted
 * is a stored value rather than a dropped unit.
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createBudgetAccount, createTrajectory } from '@tangleai/agents';
import { createSharedBudgetClient } from '@tangleai/mas';
import { ANALYSIS_STAGE, ANALYST_EXCLUSIONS, SUCCESS_ANALYST_PROMPT_VERSION, analystInputsOf, createMemoryTrace2SkillStore,
  createRepairSandbox, dispatchAnalysts, idempotencyKeyOf, isReplayOnly, runRollouts, sealAuthoredPatch,
  type AnalystDeps, type AnalystFanOut, type EvolutionRun, type SkillChatClient, type SkillSnapshot,
  type TaskRollout, type Trace2SkillStore } from '@tangleai/trace2skill';
import { readFrozenSkill, runRecord, scriptedClient, taskRecords, testAdapter, type TestAdapter } from './fixture.ts';

const ANCHOR = '- A decimal uses a period separator and no thousands separator.';
const GUIDANCE = 'A weight in kilograms converts to pounds with 1 kg = 2.20462 lb.';
const IDS = ['task-01', 'task-02', 'task-03', 'task-04'];
const TASKS = IDS.map((id, index) => ({ id, prompt: `count ${id}`, input: 'a,b\n1,2\n', answer: `value-${index + 1}` }));

const PATCH = {
  reasoning: 'the directory records no conversion factor',
  operations: [{ op: 'insert_after' as const, path: 'SKILL.md', group: 'g-units', anchor: ANCHOR, content: `- ${GUIDANCE}` }],
};
const DIAGNOSIS = {
  failingStepIndexes: [0], mismatch: 'a weight was reported in kilograms',
  repair: 'convert the weight before answering', evaluation: 1,
  generalization: 'every weight question in this domain needs the same factor',
};

const proposal = (patch: unknown = PATCH, diagnosis: unknown = DIAGNOSIS): string => JSON.stringify({ patch, diagnosis });
const answering = (answer: string): SkillChatClient => scriptedClient([
  { tool: { name: 'read_file', arguments: JSON.stringify({ path: 'inputs/table.csv' }) }, reasoning: 'reading' },
  { answer },
]);

/** A repair that reads the registered answer, rewrites the overlay, proves it and proposes. */
const repairing = (answer: string, body = proposal()): SkillChatClient => scriptedClient([
  { tool: { name: 'truth_read', arguments: '{}' } },
  { tool: { name: 'output_edit', arguments: JSON.stringify({ answer }) } },
  { tool: { name: 'evaluate', arguments: '{}' } },
  { tool: { name: 'propose', arguments: body } },
  { answer: '' },
]);

interface Ground {
  frozen: SkillSnapshot;
  store: Trace2SkillStore;
  adapter: TestAdapter;
  run: EvolutionRun;
  rollouts: TaskRollout[];
}

/** Four real rollouts through the shipped fan-out: two correct, two not. */
async function ground(options: { answers?: Partial<Record<string, string>> } = {}): Promise<Ground> {
  const frozen = await readFrozenSkill();
  const store = createMemoryTrace2SkillStore();
  const adapter = testAdapter(TASKS);
  const run = runRecord({ s0Hash: frozen.bundle.id });
  assert.ok((await store.putSnapshot(frozen)).valid, 'the run pins its frozen directory before anything runs');
  const said = options.answers ?? { 'task-01': 'value-1', 'task-02': 'wrong', 'task-03': 'value-3', 'task-04': 'wrong' };
  const fan = await runRollouts(run, taskRecords(IDS), {
    store, adapter, snapshot: frozen, condition: 'frozen-s0', modelIdentity: 'scripted', now: () => 0,
    client: (task) => answering(said[task.id] ?? 'wrong'),
  });
  assert.equal(fan.rollouts.length, 4, 'the ground rollouts all executed');
  return { frozen, store, adapter, run, rollouts: fan.rollouts };
}

function deps(base: Ground, client: AnalystDeps['client'], extra: Partial<AnalystDeps> = {}): AnalystDeps {
  return {
    store: base.store, adapter: base.adapter, snapshot: base.frozen,
    client, modelIdentity: 'scripted', now: () => 0, forbidden: [], ...extra,
  };
}

const byTask = (fan: AnalystFanOut, taskId: string) => fan.units.find(unit => unit.taskId === taskId)!;

it('an input naming a peer patch or another frozen directory is refused before any model call', async () => {
  const base = await ground();
  const client = scriptedClient([{ answer: '{}' }]);
  const inputs = analystInputsOf(base.rollouts, base.frozen.bundle, base.adapter.id);
  const fan = await dispatchAnalysts(base.run, [
    { ...inputs[0], patchIds: ['patch-from-a-peer'] },
    { ...inputs[1], s0: { ...base.frozen.bundle, id: '1'.repeat(64) } },
  ], deps(base, client));

  assert.equal(client.calls, 0, 'isolation is decided before the wire is asked for anything');
  assert.equal(fan.results.length, 0);
  assert.deepEqual(fan.issues.map(issue => issue.code), ['TT2S1007', 'TT2S1007']);
  assert.equal(fan.counts.peerPatchesSeen, 1);
  assert.equal(fan.counts.baseHashMismatches, 1);
  assert.equal(fan.counts.refused, 2);
  assert.equal((await base.store.listBy(base.run.id, 'analyses')).length, 0, 'a refused unit writes nothing');
});

it('the success role makes exactly one model call and the run seals the patch it authored', async () => {
  const base = await ground();
  const success = base.rollouts.filter(rollout => rollout.label === 'success');
  assert.equal(success.length, 2);
  const clients = new Map(success.map(rollout =>
    [rollout.taskId, scriptedClient([{ answer: JSON.stringify({ patterns: [{ behavior: 'read the header first', evidenceStepIndexes: [0] }], patch: PATCH, reasoning: 'the header rule paid off' }) }])]));
  const fan = await dispatchAnalysts(base.run, analystInputsOf(success, base.frozen.bundle, base.adapter.id),
    deps(base, (input) => clients.get(input.rollout.taskId)!));

  for (const [, client] of clients) assert.equal(client.calls, 1, 'one pass, one call');
  assert.equal(fan.counts.success.analyzed, 2);
  assert.equal(fan.counts.success.patches, 2);
  assert.equal(fan.counts.error.analyzed, 0);
  assert.equal(fan.patches.length, 2);
  for (const patch of fan.patches) {
    assert.equal(patch.baseHash, base.run.s0Hash, 'a sealed patch names the frozen directory');
    assert.equal(patch.runId, base.run.id);
    assert.equal(patch.sourcePatchIds.length, 0, 'an independent analyst builds on no peer');
    assert.equal(patch.validation.state, 'compiled');
  }
  const stored = await base.store.listBy(base.run.id, 'patches');
  assert.equal(stored.length, 2);
  const first = byTask(fan, success[0].taskId);
  assert.equal(first.result!.patchId, stored.find(patch => patch.sourceRolloutIds[0] === success[0].id)!.id);
  assert.equal(first.result!.id, first.idempotencyKey, 'the attempt key is the row address');
  assert.equal(first.idempotencyKey, await idempotencyKeyOf({
    runId: base.run.id, stage: ANALYSIS_STAGE, unit: success[0].id, attempt: 1,
    inputHashes: [base.run.s0Hash, base.adapter.toolManifestHash], identityId: 'scripted', promptVersion: SUCCESS_ANALYST_PROMPT_VERSION,
  }));
});

it('the success prompt carries the stored steps and never a rendered trajectory view', async () => {
  const base = await ground();
  const success = base.rollouts.filter(rollout => rollout.label === 'success');
  const client = scriptedClient([{ answer: JSON.stringify({ patterns: [], patch: null, reasoning: 'nothing new' }) }]);
  await dispatchAnalysts(base.run, analystInputsOf([success[0]], base.frozen.bundle, base.adapter.id), deps(base, client));
  const sent = (client.requests[0].messages as Array<{ content: string }>).map(message => message.content).join('\n');
  for (const step of success[0].steps) assert.ok(sent.includes(step.arguments), 'the analyst reads the step the rollout recorded');
  assert.ok(sent.includes(success[0].finalAnswer));

  const source = await readFile('packages/trace2skill/src/analysts.ts', 'utf8');
  assert.equal(source.includes('describeTrajectory'), false, 'a bounded view is never analyst evidence');
  const tools = await readFile('packages/trace2skill/src/analyst-tools.ts', 'utf8');
  assert.equal((`${source}${tools}`.match(/export function createRepairSandbox/g) ?? []).length, 1, 'one repair sandbox exists');
});

it('the error role proposes only what the evaluator passed, and the proof is stored', async () => {
  const base = await ground();
  const failures = base.rollouts.filter(rollout => rollout.label === 'failure');
  assert.equal(failures.length, 2);
  const fan = await dispatchAnalysts(base.run, analystInputsOf(failures, base.frozen.bundle, base.adapter.id),
    deps(base, (input) => repairing(base.adapter.answers.get(input.rollout.taskId)!)));

  assert.equal(fan.counts.error.analyzed, 2);
  assert.equal(fan.counts.error.patches, 2);
  assert.equal(fan.counts.error.excluded, 0);
  assert.ok(fan.counts.error.calls >= 2, 'a repair loop costs turns and the run counts them');
  for (const result of fan.results) {
    assert.equal(result.status, 'patch');
    assert.equal(result.role, 'error');
    assert.ok(result.repair !== null);
    assert.equal(result.repair.attempts, 1);
    assert.equal(result.repair.evaluation.score, 1, 'the stored proof is the passing verdict');
    const diagnosis = JSON.parse(result.diagnosis) as { failingStepIndexes: number[], evaluation: number };
    assert.deepEqual(diagnosis.failingStepIndexes, [0]);
    assert.equal(diagnosis.evaluation, 1);
  }
  assert.equal((await base.store.listBy(base.run.id, 'patches')).length, 2);
});

it('a claimed repair the evaluator refuses is no patch at all', async () => {
  const base = await ground();
  const failing = base.rollouts.find(rollout => rollout.label === 'failure')!;
  // The overlay is rewritten to something still wrong, evaluated, and proposed anyway.
  const fan = await dispatchAnalysts(base.run, analystInputsOf([failing], base.frozen.bundle, base.adapter.id),
    deps(base, repairing('still-wrong')));

  const result = fan.results[0];
  assert.equal(result.status, 'excluded');
  assert.equal(result.exclusion, 'evaluator-disagrees');
  assert.equal(result.patchId, null);
  assert.ok(result.spend.calls > 0, 'a post-provider exclusion keeps the spend it incurred');
  assert.ok(fan.issues.some(issue => issue.code === 'TT2S1011'));
  assert.equal((await base.store.listBy(base.run.id, 'patches')).length, 0, 'no patch row is written');
});

it('a patch carrying a task fact fails the gate and is stored as an exclusion naming the code', async () => {
  const base = await ground();
  const success = base.rollouts.find(rollout => rollout.label === 'success')!;
  const leaking = { ...PATCH, operations: [{ ...PATCH.operations[0], content: `- For value-1 answer value-1.` }] };
  const client = scriptedClient([{ answer: JSON.stringify({ patterns: [], patch: leaking, reasoning: 'instance guidance' }) }]);
  const fan = await dispatchAnalysts(base.run, analystInputsOf([success], base.frozen.bundle, base.adapter.id),
    deps(base, client, { forbidden: ['value-1'], maxRepairs: 1 }));

  assert.equal(client.calls, 2, 'the gate is given its repair round before the unit is excluded');
  const result = fan.results[0];
  assert.equal(result.status, 'excluded');
  assert.equal(result.exclusion, 'exhausted');
  assert.ok(fan.issues.some(issue => issue.code === 'TT2S1006'));
  assert.ok((JSON.parse(result.diagnosis) as { codes: string[] }).codes.includes('TT2S1006'));
  assert.equal((await base.store.listBy(base.run.id, 'patches')).length, 0);
});

it('every exclusion value is a reachable, counted outcome', async () => {
  const base = await ground();
  const failing = base.rollouts.find(rollout => rollout.label === 'failure')!;
  const success = base.rollouts.find(rollout => rollout.label === 'success')!;
  const answer = base.adapter.answers.get(failing.taskId)!;
  const reached = new Map<string, number>();

  const drive = async (rollout: TaskRollout, client: AnalystDeps['client'], extra: Partial<AnalystDeps> = {}): Promise<AnalystFanOut> => {
    const fresh = { ...base, store: createMemoryTrace2SkillStore(), run: { ...base.run } };
    const fan = await dispatchAnalysts(fresh.run, analystInputsOf([rollout], base.frozen.bundle, base.adapter.id), deps(fresh, client, extra));
    const exclusion = fan.results[0]?.exclusion;
    if (exclusion) reached.set(exclusion, (reached.get(exclusion) ?? 0) + 1);
    return fan;
  };

  // exhausted: a loop that never proposes.
  const spinning = await drive(failing, scriptedClient([{ tool: { name: 'trace_read', arguments: JSON.stringify({ from: 0, to: 4 }) } }]));
  assert.equal(spinning.results[0].exclusion, 'exhausted');

  // tool-failure: the host loses the tool the repair depends on.
  const broken = testAdapter(TASKS);
  broken.analystTools = () => ({
    truth_read: () => ({ valid: false, issues: [{ code: 'TT2S1013', path: '/truth', detail: 'the evaluator is offline' }] }),
    output_edit: (value: string) => value,
    evaluate: () => ({ valid: false, issues: [{ code: 'TT2S1013', path: '/truth', detail: 'the evaluator is offline' }] }),
  });
  const lost = await drive(failing, repairing(answer), { adapter: broken });
  assert.equal(lost.results[0].exclusion, 'tool-failure');

  // unsupported-artifacts: outputs the host exposes no reader for.
  const withArtifact = { ...failing, artifacts: [{ name: 'out.csv', sha256: 'a'.repeat(64), size: 4, address: null }] };
  const unread = await drive(withArtifact, repairing(answer));
  assert.equal(unread.results[0].exclusion, 'unsupported-artifacts');
  assert.equal(unread.results[0].spend.calls, 0, 'an unsupported unit is refused before the wire');

  // already-correct: the untouched overlay passes on the first evaluation.
  const mislabeled = { ...failing, finalAnswer: answer };
  const correct = await drive(mislabeled, scriptedClient([
    { tool: { name: 'evaluate', arguments: '{}' } }, { answer: '' }]));
  assert.equal(correct.results[0].exclusion, 'already-correct');

  // no-causal-explanation: a proven repair that cites no failing span.
  const uncited = await drive(failing, repairing(answer, proposal(PATCH, { ...DIAGNOSIS, failingStepIndexes: [] })));
  assert.equal(uncited.results[0].exclusion, 'no-causal-explanation');

  // evaluator-disagrees: a proposal after a verdict that did not pass.
  const refused = await drive(failing, repairing('still-wrong'));
  assert.equal(refused.results[0].exclusion, 'evaluator-disagrees');

  // The success role reaches the same vocabulary: a null patch, and a window
  // the stored trajectory does not fit in.
  const nothing = await drive(success, scriptedClient([{ answer: JSON.stringify({ patterns: [], patch: null, reasoning: 'covered' }) }]));
  assert.equal(nothing.results[0].exclusion, 'already-correct');
  const oversized = await drive(success, scriptedClient([{ answer: '{}' }]), { contextChars: 16 });
  assert.equal(oversized.results[0].exclusion, 'unsupported-artifacts');
  assert.equal(oversized.results[0].spend.calls, 0);

  assert.deepEqual([...reached.keys()].sort(), [...ANALYST_EXCLUSIONS].sort(), 'every registered exclusion is reachable');
});

it('the repair sandbox writes nothing durable and is unreachable once the unit ends', async () => {
  const base = await ground();
  const failing = base.rollouts.find(rollout => rollout.label === 'failure')!;
  const before = JSON.stringify(failing);
  const frozenBefore = JSON.stringify(base.frozen);
  await dispatchAnalysts(base.run, analystInputsOf([failing], base.frozen.bundle, base.adapter.id),
    deps(base, repairing(base.adapter.answers.get(failing.taskId)!)));

  const stored = (await base.store.listBy(base.run.id, 'rollouts')).find(rollout => rollout.id === failing.id)!;
  assert.equal(JSON.stringify(stored), before, 'the stored rollout is byte-identical after the repair');
  assert.equal(JSON.stringify(base.frozen), frozenBefore, 'the frozen directory is byte-identical after the repair');
  const snapshot = await base.store.getSnapshot(base.frozen.bundle.id);
  assert.ok(snapshot.valid);
  assert.deepEqual(snapshot.value.bundle.files, base.frozen.bundle.files);

  const sandbox = createRepairSandbox(failing, base.adapter.analystTools(failing.taskId));
  assert.ok(sandbox.valid);
  sandbox.value.discard();
  const reached = sandbox.value.evaluate();
  assert.equal(reached.valid, false);
  assert.equal(reached.valid ? '' : reached.issues[0].code, 'TT2S1007');
});

it('a spent run budget refuses the units it cannot pay for and leaves them retryable', async () => {
  const base = await ground();
  const inputs = analystInputsOf(base.rollouts.filter(rollout => rollout.label === 'success'), base.frozen.bundle, base.adapter.id);
  assert.equal(inputs.length, 2);
  const account = createBudgetAccount({ turns: 1 }, () => 0);
  const trajectory = createTrajectory();
  const nothing = JSON.stringify({ patterns: [], patch: null, reasoning: 'covered' });
  const bounded = await dispatchAnalysts(base.run, inputs, deps(base, () =>
    createSharedBudgetClient(scriptedClient([{ answer: nothing }]), account) as SkillChatClient, { trajectory }));

  assert.equal(bounded.counts.refused, 1, 'the unit the ceiling could not pay for is refused');
  assert.equal(bounded.results.length, 1);
  const stop = bounded.issues.find(issue => issue.code === 'TT2S1009');
  assert.ok(stop !== undefined, JSON.stringify(bounded.issues));
  assert.match(stop.detail, /budget-turns/);
  assert.equal(trajectory.entries().length, 2, 'the refused unit is logged too');
  // A run-level stop is not a verdict on the trajectory: nothing was stored
  // under its key, so a run with room left analyses it rather than replaying.
  assert.equal((await base.store.listBy(base.run.id, 'analyses')).length, 1);
  const resumed = await dispatchAnalysts(base.run, inputs, deps(base, () => scriptedClient([{ answer: nothing }])));
  assert.equal(resumed.counts.reused, 1);
  assert.equal(resumed.counts.written, 1);
  assert.equal(resumed.counts.refused, 0);
  assert.equal((await base.store.listBy(base.run.id, 'analyses')).length, 2);
});

it('re-dispatching over stored analyses spends nothing and writes nothing', async () => {
  const base = await ground();
  const inputs = analystInputsOf(base.rollouts, base.frozen.bundle, base.adapter.id);
  const wire = (answer: string) => (input: { rollout: TaskRollout }) => input.rollout.label === 'success'
    ? scriptedClient([{ answer: JSON.stringify({ patterns: [], patch: null, reasoning: 'covered' }) }])
    : repairing(answer);
  const first = await dispatchAnalysts(base.run, inputs, deps(base, (input) => wire(base.adapter.answers.get(input.rollout.taskId)!)(input)));
  assert.equal(first.counts.written, 4);
  assert.ok(first.counts.calls > 0);

  const again = await dispatchAnalysts(base.run, inputs, deps(base, () => {
    throw new Error('a replayed analysis must not reach the wire');
  }));
  assert.equal(again.counts.reused, 4);
  assert.equal(again.counts.written, 0);
  assert.equal(again.counts.calls, 0);
  const replay = isReplayOnly(again);
  assert.ok(replay.valid, replay.valid ? '' : JSON.stringify(replay.issues));
  assert.equal((await base.store.listBy(base.run.id, 'analyses')).length, 4);
});

it('a host role seals its own patch exactly the way the fan-out does', async () => {
  const base = await ground();
  const rollout = base.rollouts[0];
  const authored = { reasoning: 'a rule the directory does not yet state', operations: [] };
  const sealed = await sealAuthoredPatch(base.run, rollout, authored);
  assert.equal(sealed.runId, base.run.id);
  assert.equal(sealed.baseHash, base.run.s0Hash);
  assert.deepEqual(sealed.sourceRolloutIds, [rollout.id]);
  assert.deepEqual(sealed.sourcePatchIds, []);
  assert.equal(sealed.supportCount, 1);
  assert.equal(sealed.validation.state, 'compiled');
  // The address is the content: the same authored edit against the same run
  // and trajectory is the same patch, and a different reasoning is not.
  assert.equal((await sealAuthoredPatch(base.run, rollout, authored)).id, sealed.id);
  assert.notEqual((await sealAuthoredPatch(base.run, rollout, { ...authored, reasoning: 'something else' })).id, sealed.id);
});
