/**
 * One bounded execution, with the directory composed into the request as data
 * and nothing retrieved. What the model saw is recoverable from the recorded
 * request, the per-turn thinking the transcript drops is recovered from the
 * envelope, and a stop is never mistaken for an answer.
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createSkillExecutor, isUnansweredStop } from '@tangleai/trace2skill';
import { readFrozenSkill, scriptedClient, testAdapter } from './fixture.ts';

const TASKS = [{ id: 'task-01', prompt: 'how many rows?', input: 'a,b\n1,2\n', answer: '1' }];
const BUDGET = { turns: 6, tokens: 16384, ms: 60000 };

const executorOver = async (client: ReturnType<typeof scriptedClient>, skill: boolean) => {
  const adapter = testAdapter(TASKS);
  const prepared = adapter.prepare('task-01');
  assert.ok(prepared.valid);
  const snapshot = skill ? await readFrozenSkill() : null;
  const executor = createSkillExecutor({ client, adapter, task: prepared.value, snapshot, budget: BUDGET, now: () => 0 });
  assert.ok(executor.valid, executor.valid ? '' : JSON.stringify(executor.issues));
  return { adapter, executor: executor.value };
};

it('the executor request contains the skill and no retrieval', async () => {
  const frozen = await readFrozenSkill();
  const root = frozen.files.find(file => file.path === 'SKILL.md')?.content as string;
  const client = scriptedClient([
    { tool: { name: 'skill_read', arguments: JSON.stringify({ path: 'references/csv-conventions.md' }) } },
    { answer: '1' },
  ]);
  const { executor } = await executorOver(client, true);
  assert.ok(executor.system.includes(root), 'the request carries the root page bytes');
  assert.deepEqual(executor.tools, ['read_file', 'skill_read']);

  const outcome = await executor.run();
  assert.ok(outcome.valid);
  assert.equal(outcome.value.finalAnswer, '1');
  assert.equal(client.systems[0], executor.system);
  for (const request of client.requests) assert.equal(request.retrieval, undefined, 'no retrieval block is ever composed');

  // The referenced page answers its frozen bytes through the one read tool.
  const reference = frozen.files.find(file => file.path === 'references/csv-conventions.md')?.content as string;
  const step = outcome.value.steps.find(entry => entry.name === 'skill_read');
  assert.ok(step !== undefined);
  assert.ok(step.result.includes(JSON.stringify(reference).slice(1, 60)), 'skill_read answers the frozen bytes');
});

it('the no-skill condition omits the directory and its tool', async () => {
  const client = scriptedClient([{ answer: '1' }]);
  const { executor } = await executorOver(client, false);
  assert.deepEqual(executor.tools, ['read_file']);
  assert.ok(!executor.system.includes('Tabular extraction'));
  const outcome = await executor.run();
  assert.ok(outcome.valid);
  assert.equal(outcome.value.spend.calls, 1);
});

it('intermediate reasoning is captured with its turn although the transcript drops it', async () => {
  const client = scriptedClient([
    { tool: { name: 'read_file', arguments: JSON.stringify({ path: 'inputs/table.csv' }) }, reasoning: 'first I read the table' },
    { tool: { name: 'read_file', arguments: JSON.stringify({ path: 'inputs/table.csv' }) }, reasoning: 'then I count' },
    { answer: '1' },
  ]);
  const { executor } = await executorOver(client, false);
  const outcome = await executor.run();
  assert.ok(outcome.valid);
  assert.deepEqual(outcome.value.reasoning, [
    { turn: 1, text: 'first I read the table' },
    { turn: 2, text: 'then I count' },
  ]);
  assert.deepEqual(outcome.value.steps.map(step => step.turn), [1, 2]);
  const transcript = JSON.stringify(outcome.value.messages);
  assert.ok(!transcript.includes('first I read the table'), 'reasoning never reaches the stored transcript');
  assert.equal(outcome.value.stopReason, 'stop');
});

it('a tool failure stays in the steps and the task still answers', async () => {
  const client = scriptedClient([
    { tool: { name: 'read_file', arguments: JSON.stringify({ path: 'inputs/elsewhere.csv' }) } },
    { answer: '1' },
  ]);
  const { adapter, executor } = await executorOver(client, false);
  const outcome = await executor.run();
  assert.ok(outcome.valid);
  assert.equal(outcome.value.steps.length, 1);
  assert.ok(outcome.value.steps[0].result.includes('"error"'), 'the refusal is retained as a value');
  assert.equal(adapter.counts.refused, 1);
  assert.equal(outcome.value.finalAnswer, '1');
});

it('a spent turn budget stops with no answer and keeps its spend', async () => {
  const client = scriptedClient([{ tool: { name: 'read_file', arguments: JSON.stringify({ path: 'inputs/table.csv' }) } }]);
  const adapter = testAdapter(TASKS);
  const prepared = adapter.prepare('task-01');
  assert.ok(prepared.valid);
  const executor = createSkillExecutor({
    client, adapter, task: prepared.value, snapshot: null,
    budget: { turns: 3, tokens: 16384, ms: 60000 }, now: () => 0,
  });
  assert.ok(executor.valid);
  const outcome = await executor.value.run();
  assert.ok(outcome.valid);
  assert.equal(outcome.value.stopReason, 'budget-turns');
  assert.equal(outcome.value.finalAnswer, '', 'the text a stopped loop emits is not an answer');
  assert.equal(outcome.value.spend.calls, 3);
  assert.equal(outcome.value.spend.tokens, 3 * 64);
  assert.ok(isUnansweredStop(outcome.value.stopReason));
  assert.ok(!isUnansweredStop('stop'));
});

it('a directory with no readable root page is refused before any call', async () => {
  const frozen = await readFrozenSkill();
  const adapter = testAdapter(TASKS);
  const prepared = adapter.prepare('task-01');
  assert.ok(prepared.valid);
  const client = scriptedClient([{ answer: '1' }]);
  const blank = { ...frozen, files: frozen.files.map(file => ({ ...file, content: file.path === 'SKILL.md' ? '  ' : file.content })) };
  const refused = createSkillExecutor({ client, adapter, task: prepared.value, snapshot: blank, budget: BUDGET, now: () => 0 });
  assert.ok(!refused.valid);
  assert.equal(refused.issues[0].code, 'TT2S1005');
  assert.equal(client.calls, 0);
});
