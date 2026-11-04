/**
 * @file What a host gets to decide about the agent loop: the language of
 * every sentence the loop writes, whether `recall` is listed, the context
 * and the abort signal its tools receive, the work so far when a model call
 * rejects, and budgets that reserve a call's worst case before making it.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert';

import { createAgent, AGENT_MESSAGES } from '@tangleai/agents/agent';
import { createToolbox, toolboxFromContract } from '@tangleai/agents/toolbox';
import { createLedger } from '@tangleai/context/ledger';
import { createEnvironment } from '@tangleai/context/environment';
import { compileContract } from '@jarenjs/contract';
import { AiError } from '@tangleai/models/errors';

function scriptedClient(replies: any[]) {
  const requests: any[] = [];
  return {
    requests,
    complete: async (request: any) => {
      requests.push(request);
      const next = replies.shift();
      if (next === undefined) throw new Error('script exhausted');
      return typeof next === 'function' ? next(request) : next;
    },
  };
}
const final = (content: string, usage: any = null) => ({ message: { role: 'assistant', content, toolCalls: null }, finishReason: 'stop', usage });
const toolTurn = (calls: any[], usage: any = null) => ({ message: { role: 'assistant', content: '', toolCalls: calls }, finishReason: 'tool_calls', usage });

/** Every sentence replaced by a marker naming its key: whatever English is left is the loop's. */
const marked = Object.fromEntries(Object.entries(AGENT_MESSAGES).map(([key, value]) => [key,
  typeof value === 'function' ? () => `«${key}»` : typeof value === 'string' ? `«${key}»` : value]));
const ENGLISH = /Stopped|ARCHIVED|compacted|Fetch an archived|List what the environment|unknown tool|invalid input|not valid JSON|no tools are available|Continue working|Your objective|Progress recorded|What you have learned|Skills you can reuse|whole conversation|A slot name|unknown slot|lists every address|DONE/;

describe('the agent loop in a host\'s language', () => {
  it('writes the stop, error, resume, goal and retrieval sentences from the host\'s words', async () => {
    const ledger = createLedger({ messages: { goal: { heading: '## Doel', checkpoint: 'Klaar:', progress: () => 'Voortgang:', entry: (entry) => `- ${entry.note}` } } });
    await ledger.setGoal({ objective: 'Vind de fout.' });
    await ledger.recordProgress({ note: 'Stap één', evidence: 'log' });
    await ledger.addMemory({ text: 'Het bestand is UTF-8.', evidence: 'file' });
    const client = scriptedClient([
      toolTurn([{ id: 'a', name: 'missing', arguments: '{' }]),
      toolTurn([{ id: 'b', name: 'missing', arguments: '{}' }]),
      final('klaar'),
    ]);
    const agent = createAgent({
      client, ledger, maxToolRounds: 1, budget: { turns: 3 },
      retrieval: { memories: {} }, messages: { ...marked, memory: (memory: any) => `- ${memory.text}` },
    });
    const first = await agent.resume([]);
    assert.strictEqual(first.stopReason, 'tool-limit');
    assert.strictEqual(first.message.content, '«toolLimit»');
    assert.strictEqual(first.steps[0].result.error, '«invalidArguments»');
    assert.strictEqual(first.messages.find((m: any) => m.role === 'user').content, '«resume»');
    const system = client.requests[0].messages[0].content;
    assert.match(system, /## Doel/);
    assert.match(system, /«memories»/);
    const second = await agent.send([...first.messages, { role: 'user', content: 'nog eens' }]);
    assert.strictEqual(second.message.content, 'klaar');
    const third = await agent.send([...second.messages, { role: 'user', content: 'en nu?' }]);
    assert.strictEqual(third.stopReason, 'budget-turns');
    assert.strictEqual(third.message.content, '«budget»');
    for (const text of [JSON.stringify(client.requests), JSON.stringify([first, second, third])])
      assert.doesNotMatch(text.replace(/Vind de fout\.|Stap één|Het bestand is UTF-8\.|klaar|nog eens|en nu\?/g, ''), ENGLISH);
  });

  it('archives, points and describes its tools in the host\'s words', async () => {
    const ledger = createLedger();
    const environment = createEnvironment();
    await environment.put('notes', 'een\ntwee\ndrie');
    const client = scriptedClient([
      toolTurn([{ id: 'r', name: 'recall', arguments: '{"slot":"nope"}' }]),
      final('klaar'),
    ]);
    const long = Array.from({ length: 8 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `beurt ${i} ${'x'.repeat(200)}` }));
    const agent = createAgent({
      client, ledger, environment, historyBudget: 900, transcript: { window: 1 },
      messages: { ...marked, recall: { description: '«recall.description»', slot: '«recall.slot»', unknown: () => '«recall.unknown»', hint: '«recall.hint»', hintIndex: () => '«recall.hintIndex»', evicted: () => '«recall.evicted»' },
        environment: Object.fromEntries(['slot', 'prefix', 'digest', 'peek', 'grep', 'grepIn', 'chunk', 'stat', 'read'].map((key) => [key, `«env.${key}»`])) },
    });
    const result = await agent.send(long);
    assert.strictEqual(result.steps[0].result.error, '«recall.unknown»');
    const request = client.requests[0];
    assert.ok(request.tools.some((tool: any) => tool.function.name === 'recall' && tool.function.description === '«recall.description»'));
    assert.ok(request.tools.some((tool: any) => tool.function.name === 'env_read' && tool.function.description === '«env.read»'));
    assert.ok(request.messages.some((message: any) => message.content === '«transcript»'));
    assert.doesNotMatch(JSON.stringify(client.requests).replace(/beurt \d x+|een\\ntwee\\ndrie|klaar/g, ''), ENGLISH);
  });

  it('lists recall only when the agent can compact, unless the host says otherwise', async () => {
    const names = async (options: any) => {
      const client = scriptedClient([final('ok')]);
      await createAgent({ client, ledger: createLedger(), ...options }).send([{ role: 'user', content: 'x' }]);
      return (client.requests[0].tools ?? []).map((tool: any) => tool.function.name);
    };
    assert.deepStrictEqual(await names({}), [], 'a ledger without a history budget writes no address to recall');
    assert.deepStrictEqual(await names({ historyBudget: 10_000 }), ['recall']);
    assert.deepStrictEqual(await names({ recall: true }), ['recall']);
    assert.deepStrictEqual(await names({ historyBudget: 10_000, recall: false }), []);
  });
});

describe('the host\'s control over a send', () => {
  it('hands tools the send\'s signal and the host context, and a stop aborts a pending tool', async () => {
    const seen: any[] = [];
    let aborted = false;
    const toolbox = createToolbox();
    toolbox.add({
      name: 'slow', description: 'waits', inputSchema: { type: 'object' },
      execute: (_input: any, context: any) => {
        seen.push(context.context);
        return new Promise((resolve) => context.signal.addEventListener('abort', () => { aborted = true; resolve({ stopped: true }); }));
      },
    });
    const controller = new AbortController();
    const client = scriptedClient([toolTurn([{ id: 't', name: 'slow', arguments: '{}' }]), final('done')]);
    const agent = createAgent({ client, toolbox, toolContext: { runId: 'agent' } });
    const pending = agent.send([{ role: 'user', content: 'go' }], { signal: controller.signal, toolContext: { runId: 'run-7' } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort(new Error('the operator stopped it'));
    await pending.catch(() => { });
    assert.deepStrictEqual(seen, [{ runId: 'run-7' }]);
    assert.strictEqual(aborted, true);
  });

  it('a model call that rejects carries the rounds already finished, and counts as a turn', async () => {
    const toolbox = createToolbox();
    toolbox.add({ name: 'look', description: 'looks', inputSchema: { type: 'object' }, execute: () => ({ seen: 1 }) });
    const reason = new Error('provider down');
    const client = scriptedClient([toolTurn([{ id: 'l', name: 'look', arguments: '{}' }]), () => { throw reason; }]);
    const agent = createAgent({ client, toolbox });
    await assert.rejects(agent.send([{ role: 'user', content: 'go' }]), (err: any) => {
      const { partial } = err;
      assert.strictEqual(err, reason);
      assert.strictEqual(partial.steps.length, 1);
      assert.deepStrictEqual(partial.messages.map((m: any) => m.role), ['user', 'assistant', 'tool']);
      assert.strictEqual(partial.spent.turns, 2);
      return true;
    });
    assert.strictEqual(agent.spend().turns, 2);
  });

  it('a reserving budget never lets a call cross its token or cost ceiling', async () => {
    const usage = { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 };
    const client = scriptedClient(Array.from({ length: 10 }, () => toolTurn([{ id: 'n', name: 'noop', arguments: '{}' }], usage)));
    const toolbox = createToolbox();
    toolbox.add({ name: 'noop', description: 'n', inputSchema: { type: 'object' }, execute: () => ({}) });
    const prices = () => ({ prompt: 0.001, completion: 0.002 });
    const agent = createAgent({
      client, toolbox, maxToolRounds: 10, maxOutputTokens: 10, prices,
      budget: { cost: 0.2, tokens: 10_000, reserve: true, estimate: () => 40 },
    });
    const result = await agent.send([{ role: 'user', content: 'go' }]);
    assert.strictEqual(result.stopReason, 'budget-cost');
    const spent = agent.spend();
    assert.ok(spent.cost! <= 0.2, `${spent.cost}`);
    assert.ok(spent.cost! + (40 * 0.001 + 10 * 0.002) > 0.2, 'it stopped because the next call could have crossed');
    assert.ok(client.requests.every((request: any) => request.maxTokens === 10), 'every request carries the output cap');
    assert.throws(() => createAgent({ client, budget: { reserve: true } }), (err: any) => err instanceof AiError && /maxOutputTokens/.test(err.message));
    assert.throws(() => createAgent({ client, budget: { cost: 1 } }), (err: any) => err instanceof AiError && /prices/.test(err.message));
  });
});

describe('the toolbox a host registers', () => {
  it('refuses a second tool of the same name unless told to replace it', () => {
    const toolbox = createToolbox();
    const def = { name: 'a', description: 'a', inputSchema: { type: 'object' }, execute: () => 1 };
    toolbox.add(def);
    assert.throws(() => toolbox.add(def), (err: any) => err instanceof AiError && /already registered/.test(err.message));
    toolbox.add({ ...def, execute: () => 2 }, { replace: true });
    assert.strictEqual(toolbox.execute('a', {}), 2);
    const dutch = createToolbox({ messages: { unknownTool: (name) => `onbekend: ${name}`, invalidInput: () => 'ongeldig' } });
    dutch.add({ name: 'n', description: 'n', inputSchema: { type: 'object', properties: { x: { type: 'integer' } }, required: ['x'] }, execute: () => 0 });
    assert.strictEqual(dutch.execute('zz', {}).error, 'onbekend: zz');
    assert.strictEqual(dutch.execute('n', {}).error, 'ongeldig');
  });

  it('a contract toolbox keeps host-bound members out of the model\'s reach and maps outcomes', async () => {
    const contract = compileContract({
      $contract: '0.1', id: 'shop', version: '1',
      operations: {
        'proposal.create': {
          kind: 'command', http: { method: 'POST', path: '/proposals' },
          input: { type: 'object', required: ['runId', 'label'], additionalProperties: false, properties: { runId: { type: 'string' }, label: { type: 'string' } } },
          output: { type: 'object' },
        },
      },
    });
    const invoked: any[] = [];
    const client = { invoke: async (op: string, input: any, ctx: any) => { invoked.push({ op, input, signal: ctx?.signal !== undefined }); return { ok: true, value: { id: 1 } }; } };
    const toolbox = toolboxFromContract(contract, client, {
      bind: { runId: (context: any) => context.runId },
      mapOutcome: (outcome) => (outcome.ok ? 'Voorstel aangemaakt.' : 'Mislukt.'),
    });
    const [tool] = toolbox.toFunctionTools();
    assert.deepStrictEqual(Object.keys(tool.function.parameters.properties), ['label']);
    assert.deepStrictEqual(tool.function.parameters.required, ['label']);
    const forged = await toolbox.execute(tool.function.name, { label: 'x', runId: 'forged' }, { context: { runId: 'run-1' } });
    assert.match(String(forged.error), /invalid input/, 'the model cannot send a bound member');
    const answer = await toolbox.execute(tool.function.name, { label: 'x' }, { context: { runId: 'run-1' }, signal: new AbortController().signal });
    assert.strictEqual(answer, 'Voorstel aangemaakt.');
    assert.deepStrictEqual(invoked, [{ op: 'proposal.create', input: { label: 'x', runId: 'run-1' }, signal: true }]);
    assert.throws(() => toolboxFromContract(contract, client, { toolbox }), /already registered/);
  });
});
