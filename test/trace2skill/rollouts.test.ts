/**
 * The fan-out: one frozen directory, one attempt key per unit, results by task
 * id and never by latency, a retry beside its predecessor rather than over it,
 * and a run-wide ceiling that stops the unit it cannot pay for.
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createBudgetAccount, createTrajectory } from '@tangleai/agents';
import { createSharedBudgetClient } from '@tangleai/mas';
import { createMemoryTrace2SkillStore, isReplayOnly, runRollouts,
  type SkillChatClient, type Trace2SkillStore } from '@tangleai/trace2skill';
import { readFrozenSkill, runRecord, scriptedClient, taskRecords, testAdapter } from './fixture.ts';

const IDS = ['task-01', 'task-02', 'task-03', 'task-04'];
const TASKS = IDS.map((id, index) => ({ id, prompt: `count ${id}`, input: 'a,b\n1,2\n', answer: String(index + 1) }));
const ANSWERING = (answer: string) => scriptedClient([
  { tool: { name: 'read_file', arguments: JSON.stringify({ path: 'inputs/table.csv' }) }, reasoning: `reading for ${answer}` },
  { answer },
]);

it('every rollout names one identical frozen directory and a different one is refused', async () => {
  const frozen = await readFrozenSkill();
  const store = createMemoryTrace2SkillStore();
  const adapter = testAdapter(TASKS);
  const run = runRecord({ s0Hash: frozen.bundle.id });
  const fan = await runRollouts(run, taskRecords(IDS), {
    store, adapter, snapshot: frozen, condition: 'frozen-s0', modelIdentity: 'scripted',
    now: () => 0, client: (task) => ANSWERING(task.id.slice(-1)),
  });
  assert.equal(fan.rollouts.length, 4);
  assert.deepEqual([...new Set(fan.rollouts.map(rollout => rollout.s0Hash))], [frozen.bundle.id]);
  assert.deepEqual(fan.counts, { success: 4, failure: 0, unanswered: 0, refused: 0, reused: 0, written: 4, calls: 8 });
  assert.ok(fan.rollouts.every(rollout => rollout.reasoning.length === 1), 'per-turn reasoning is stored');

  // A run that pinned another directory refuses every unit against this one.
  const drifted = runRecord({ s0Hash: '1'.repeat(64), id: '2'.repeat(64) });
  const stale = await runRollouts(drifted, taskRecords(IDS), {
    store, adapter, snapshot: frozen, condition: 'frozen-s0', modelIdentity: 'scripted',
    now: () => 0, client: (task) => ANSWERING(task.id.slice(-1)),
  });
  assert.equal(stale.rollouts.length, 0);
  assert.equal(stale.counts.refused, 4);
  assert.deepEqual([...new Set(stale.issues.map(issue => issue.code))], ['TT2S1002']);
});

it('labels follow the evaluator and a budget stop keeps its spend without an answer', async () => {
  const frozen = await readFrozenSkill();
  const store = createMemoryTrace2SkillStore();
  const adapter = testAdapter(TASKS);
  const run = runRecord({ s0Hash: frozen.bundle.id, budgets: { turns: 3, tokens: 16384, ms: 60000 } });
  const looping = () => scriptedClient([{ tool: { name: 'read_file', arguments: JSON.stringify({ path: 'inputs/table.csv' }) } }]);
  const failing = () => scriptedClient([{ answer: 'wrong' }]);
  const fan = await runRollouts(run, taskRecords(IDS), {
    store, adapter, snapshot: frozen, condition: 'frozen-s0', modelIdentity: 'scripted', now: () => 0,
    client: (task) => task.id === 'task-01' ? looping() : task.id === 'task-02' ? failing() : ANSWERING(task.id.slice(-1)),
  });
  const byTask = new Map(fan.rollouts.map(rollout => [rollout.taskId, rollout]));
  const stopped = byTask.get('task-01');
  assert.ok(stopped !== undefined);
  assert.equal(stopped.label, 'unanswered');
  assert.equal(stopped.stopReason, 'budget-turns');
  assert.equal(stopped.finalAnswer, '');
  assert.equal(stopped.spend.calls, 3);
  assert.equal(stopped.spend.tokens, 3 * 64);
  assert.equal(byTask.get('task-02')?.label, 'failure');
  assert.equal(byTask.get('task-03')?.label, 'success');
  assert.deepEqual(fan.counts.success + fan.counts.failure + fan.counts.unanswered, 4);

  // A tool failure is a step, not a stop: the task still labels.
  const refusing = scriptedClient([
    { tool: { name: 'read_file', arguments: JSON.stringify({ path: 'inputs/elsewhere.csv' }) } },
    { answer: '4' },
  ]);
  const second = runRecord({ s0Hash: frozen.bundle.id, id: '3'.repeat(64) });
  const tooled = await runRollouts(second, taskRecords(['task-04']), {
    store, adapter, snapshot: frozen, condition: 'frozen-s0', modelIdentity: 'scripted', now: () => 0, client: refusing,
  });
  assert.equal(tooled.rollouts[0].label, 'success');
  assert.equal(tooled.rollouts[0].steps.length, 1);
  assert.ok(tooled.rollouts[0].steps[0].result.includes('"error"'));
});

it('results follow task ids, not completion order', async () => {
  const frozen = await readFrozenSkill();
  const store = createMemoryTrace2SkillStore();
  const adapter = testAdapter(TASKS);
  const run = runRecord({ s0Hash: frozen.bundle.id });
  const finished: string[] = [];
  // Reversed latencies: the last task by id answers first.
  const latency = new Map(IDS.map((id, index) => [id, (IDS.length - index) * 4]));
  const reversed = [...taskRecords(IDS)].reverse();
  const fan = await runRollouts(run, reversed, {
    store, adapter, snapshot: frozen, condition: 'frozen-s0', modelIdentity: 'scripted', now: () => 0,
    client: (task) => {
      const client = scriptedClient([{ answer: task.id.slice(-1) }], { latencyMs: latency.get(task.id) });
      return {
        endpoint: client.endpoint,
        async complete(request: unknown) { const done = await client.complete(request); finished.push(task.id); return done; },
      } as SkillChatClient;
    },
  });
  assert.deepEqual(fan.units.map(unit => unit.taskId), IDS);
  assert.deepEqual(fan.rollouts.map(rollout => rollout.taskId), IDS);
  assert.notDeepEqual(finished, IDS, 'the wire answered in another order');
});

it('a retry is a new attempt beside the first, and a replay spends nothing', async () => {
  const frozen = await readFrozenSkill();
  const store = createMemoryTrace2SkillStore();
  const adapter = testAdapter(TASKS);
  const run = runRecord({ s0Hash: frozen.bundle.id });
  const deps = (attempt: number) => ({
    store, adapter, snapshot: frozen, condition: 'frozen-s0', modelIdentity: 'scripted', now: () => 0, attempt,
    client: (task: { id: string }) => ANSWERING(task.id.slice(-1)),
  });

  const first = await runRollouts(run, taskRecords(IDS), deps(1));
  assert.equal(first.counts.written, 4);
  const keys = new Map(first.units.map(unit => [unit.taskId, unit.idempotencyKey]));

  // The same attempt again: every unit replays from the store.
  const replay = await runRollouts(run, taskRecords(IDS), deps(1));
  assert.equal(replay.counts.reused, 4);
  assert.equal(replay.counts.written, 0);
  assert.equal(replay.counts.calls, 0);
  assert.ok(isReplayOnly(replay).valid);
  assert.deepEqual(replay.rollouts.map(rollout => rollout.id), first.rollouts.map(rollout => rollout.id));

  // A retry is attempt 2: its own key, its own spend, beside the first.
  const retry = await runRollouts(run, taskRecords(IDS), deps(2));
  assert.equal(retry.counts.written, 4);
  assert.equal(retry.counts.calls, 8);
  for (const unit of retry.units) {
    assert.equal(unit.attempt, 2);
    assert.notEqual(unit.idempotencyKey, keys.get(unit.taskId));
  }
  assert.deepEqual(first.units.map(unit => unit.idempotencyKey), [...keys.values()], 'attempt one keeps its key');
  const stored = await store.listBy(run.id, 'rollouts');
  assert.equal(stored.length, 8);
  assert.deepEqual([...new Set(stored.map(rollout => rollout.attempt))].sort(), [1, 2]);
  assert.ok(stored.every(rollout => rollout.spend.calls > 0));
  assert.ok(!isReplayOnly(retry).valid);
});

it('two concurrent completions cannot overspend the run turn ceiling', async () => {
  const frozen = await readFrozenSkill();
  const store = createMemoryTrace2SkillStore();
  const ids = ['task-01', 'task-02', 'task-03', 'task-04', 'task-05', 'task-06', 'task-07'];
  const adapter = testAdapter(ids.map((id, index) => ({ id, prompt: `count ${id}`, input: 'a,b\n1,2\n', answer: String(index + 1) })));
  const account = createBudgetAccount({ turns: 6 }, () => 0);
  const trajectory = createTrajectory();
  let reservations = 0;
  const run = runRecord({ s0Hash: frozen.bundle.id, concurrency: 4 });
  const fan = await runRollouts(run, taskRecords(ids), {
    store, adapter, snapshot: frozen, condition: 'frozen-s0', modelIdentity: 'scripted', now: () => 0, trajectory,
    client: (task) => createSharedBudgetClient(
      scriptedClient([{ answer: String(ids.indexOf(task.id) + 1) }]), account,
      { onCall: () => { reservations++; } }) as SkillChatClient,
  });
  assert.equal(account.spent().turns, 6, 'exactly six turns were reserved');
  assert.equal(reservations, 6);
  assert.equal(fan.rollouts.length, 6);
  assert.equal(fan.counts.refused, 1);
  const stop = fan.issues.find(issue => issue.code === 'TT2S1009');
  assert.ok(stop !== undefined, JSON.stringify(fan.issues));
  assert.match(stop.detail, /budget-turns/);
  assert.equal(stop.cause?.message, 'the shared workflow budget is spent (budget-turns)');
  assert.equal(trajectory.entries().length, 7, 'the refused unit is logged too');
});

it('a second result under one attempt key is an isolation refusal', async () => {
  const frozen = await readFrozenSkill();
  const store = createMemoryTrace2SkillStore();
  const adapter = testAdapter(TASKS);
  const run = runRecord({ s0Hash: frozen.bundle.id });
  const first = await runRollouts(run, taskRecords(['task-01']), {
    store, adapter, snapshot: frozen, condition: 'frozen-s0', modelIdentity: 'scripted', now: () => 0, client: ANSWERING('1'),
  });
  assert.equal(first.counts.written, 1);

  // The same key, a different answer. A run that can see the stored attempt
  // replays it; one that cannot — a resume against a store it has not read —
  // meets the immutable address, and the refusal is a second result under one
  // key rather than an overwrite.
  const replayed = await runRollouts(run, taskRecords(['task-01']), {
    store, adapter, snapshot: frozen, condition: 'frozen-s0', modelIdentity: 'scripted', now: () => 0, client: ANSWERING('9'),
  });
  assert.equal(replayed.counts.reused, 1);
  assert.equal(replayed.counts.calls, 0);

  const blind: Trace2SkillStore = { ...store, listBy: (async () => []) as Trace2SkillStore['listBy'] };
  const conflicting = await runRollouts(run, taskRecords(['task-01']), {
    store: blind, adapter, snapshot: frozen, condition: 'frozen-s0', modelIdentity: 'scripted', now: () => 0, client: ANSWERING('9'),
  });
  assert.equal(conflicting.rollouts.length, 0);
  assert.equal(conflicting.issues[0].code, 'TT2S1007');
  assert.equal(conflicting.issues[0].cause?.code, 'TT2S1002');
  const stored = await store.listBy(run.id, 'rollouts');
  assert.equal(stored.length, 1);
  assert.equal(stored[0].finalAnswer, '1');
});
