import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { compileContract } from '@jarenjs/contract';
import { openLocalClient } from '@jarenjs/contract/local';
import { contractTools } from '@jarenjs/contract/project';
import { AiError } from '@tangleai/models/errors';
import { TOOL_BUDGETS } from '@tangleai/models/profile';
import { createAgent } from '@tangleai/agents/agent';
import { createToolbox } from '@tangleai/agents/toolbox';
import { createContractToolbox } from '@tangleai/jaren/contract-tools';

const BOARD = JSON.parse(readFileSync(new URL('./fixtures/board.contract.json', import.meta.url), 'utf8'));

/** The board contract served in-process, recording what each handler received. */
function openBoard() {
  const contract = compileContract(BOARD);
  const received: Record<string, any[]> = { 'board.import': [], 'board.rename': [], 'board.purge': [] };
  const client = openLocalClient(contract, {
    'board.import': (input: any, ctx: any) => {
      received['board.import'].push(input);
      const seen = new Set<string>();
      for (const note of input.notes) {
        if (seen.has(note.id)) return ctx.fail('duplicate', {}, { id: note.id });
        seen.add(note.id);
      }
      return { board: input.board, imported: input.notes.length };
    },
    'board.rename': (input: any) => {
      received['board.rename'].push(input);
      return { board: input.board, title: input.title };
    },
    'board.read': (input: any) => ({ board: input.board, notes: [] }),
    'board.purge': (input: any) => {
      received['board.purge'].push(input);
      return true;
    },
  }, { validateOutput: 'always' });
  return { contract, client, received };
}

const TOPICS = ['migration guide', 'release notes', 'consumer gate', 'browser matrix', 'replay cache', 'routing table',
  'budget report', 'ledger export', 'graph ranking', 'vector storage', 'policy contract', 'retention sweep'];

/** Twelve notes, about 2,000 characters as one argument — far over what the weak model below can emit. */
const NOTES = TOPICS.map((topic, index) => ({
  id: `n${index + 1}`,
  title: `Milestone ${index + 1}: ${topic}`,
  text: `Ship the ${topic} work, measure it against the baseline and write down what changed.`,
  tags: ['roadmap', index % 2 === 0 ? 'build' : 'measure'],
  links: index === 0 ? [] : [`n${index}`],
}));

const shaped = (outcome: any) => (outcome.ok
  ? { ok: true, value: outcome.value, meta: { op: outcome.meta.op } }
  : { ok: false, error: { code: outcome.error.code, message: outcome.error.message, details: outcome.error.details ?? null }, meta: { op: outcome.meta.op } });

describe('jaren — the contract toolbox', () => {
  it('is contractTools, with outcomes shaped for a model, under an unlimited budget', async () => {
    const { contract, client } = openBoard();
    const plain = contractTools(contract, client);
    const tools = createContractToolbox(contract, client, { budget: 'unlimited' });
    assert.deepEqual(tools.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      plain.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })));
    assert.deepEqual(tools.direct, ['board_import', 'board_rename', 'board_read']);
    assert.deepEqual(tools.staged, []);
    assert.equal(tools.budget, TOOL_BUDGETS.unlimited);
    assert.equal(tools.profile, null);

    const input = { board: 'roadmap', title: 'Autumn', by: 'human' };
    const answer = await tools.execute('board_rename', input);
    assert.deepEqual(answer, shaped(await plain[1].execute(input)));
    assert.deepEqual(answer, { ok: true, value: { board: 'roadmap', title: 'Autumn' }, meta: { op: 'board.rename' } },
      'meta keeps the operation and drops the trace');

    const duplicate = await tools.execute('board_import', { board: 'roadmap', by: 'human', notes: [...NOTES.slice(0, 5), NOTES[0]] });
    assert.deepEqual(duplicate, {
      ok: false,
      error: { code: 'duplicate', message: (duplicate as any).error.message, details: { id: 'n1' } },
      meta: { op: 'board.import' },
    });
    const invalid = await tools.execute('board_rename', { board: 'roadmap' });
    assert.equal((invalid as any).error, 'invalid input for board_rename', 'the toolbox guards the input first');

    const bare = createContractToolbox(contract, client);
    assert.equal(bare.budget, TOOL_BUDGETS.unlimited, 'with neither a model nor a budget nothing is staged');
    assert.deepEqual(bare.tools.map((tool) => tool.name), plain.map((tool) => tool.name));
  });

  it('pins host-fixed members: out of the schema, over whatever the model sent', async () => {
    const { contract, client, received } = openBoard();
    const tools = createContractToolbox(contract, client, { budget: 'unlimited', pin: { by: 'oracle' } });
    const schema = (name: string) => tools.tools.find((tool) => tool.name === name)!.inputSchema;
    for (const name of ['board_import', 'board_rename']) {
      assert.equal(schema(name).properties.by, undefined, `${name} no longer asks for by`);
      assert.ok(!schema(name).required.includes('by'));
    }
    assert.deepEqual(schema('board_read'), contractTools(contract, client)[2].inputSchema, 'an operation without the member is untouched');
    assert.equal(BOARD.operations['board.import'].input.properties.by.enum.length, 2, 'the contract itself is untouched');

    assert.equal((await tools.execute('board_rename', { board: 'roadmap', title: 'Autumn' }) as any).ok, true);
    const forged = await tools.execute('board_rename', { board: 'roadmap', title: 'Autumn', by: 'human' });
    assert.equal((forged as any).errors[0].keyword, 'additionalProperties', 'a closed schema refuses the member outright');
    // a host calling the definition directly (WebMCP) gets the pin applied over what it sent
    await tools.tools.find((tool) => tool.name === 'board_rename')!.execute({ board: 'roadmap', title: 'Winter', by: 'human' });
    assert.deepEqual(received['board.rename'].map((input) => input.by), ['oracle', 'oracle']);

    const refusedPin = createContractToolbox(contract, client, { budget: 'unlimited', pin: { by: 'robot' } });
    const contractRefusal = await refusedPin.execute('board_rename', { board: 'roadmap', title: 'Autumn' }) as any;
    assert.deepEqual({ ok: contractRefusal.ok, code: contractRefusal.error.code }, { ok: false, code: 'JC2050' },
      'the contract validates the completed input once more');

    assert.throws(() => createContractToolbox(contract, client, { pin: { author: 'oracle' } }),
      (error: unknown) => error instanceof AiError && /no offered operation declares the pinned member 'author'/.test(error.message));
    assert.throws(() => createContractToolbox(contract, client, { pin: { by: undefined } }),
      (error: unknown) => error instanceof AiError && /pin 'by' must be a JSON value/.test(error.message));
    assert.throws(() => createContractToolbox(contract, client, { budget: { maxItems: 2 } }),
      (error: unknown) => error instanceof AiError && /pass model, or name a tier/.test(error.message));
    assert.throws(() => createContractToolbox(contract, client, { audience: 'public' } as never),
      (error: unknown) => error instanceof AiError && /unknown option 'audience'/.test(error.message));
  });

  it('never offers a server-audience (human-only) operation', async () => {
    const { contract, client, received } = openBoard();
    for (const options of [{ budget: 'unlimited' as const }, { model: 'qwen/qwen3.6-35b-a3b' }, { model: 'qwen/qwen3.8-27b' }, { budget: 'tiny' as const }]) {
      const tools = createContractToolbox(contract, client, options);
      assert.ok(!tools.tools.some((tool) => tool.name === 'board_purge'), JSON.stringify(options));
      assert.ok(![...tools.direct, ...tools.staged].includes('board_purge'));
      assert.ok(!JSON.stringify(tools.tools.map((tool) => tool.description)).includes('board_purge'));
      if (tools.budget.catalog) {
        assert.ok(!(await tools.execute('tool_list', {}) as any[]).some((tool) => tool.name === 'board_purge'));
        assert.match((await tools.execute('tool_call', { name: 'board_purge', input: { board: 'roadmap' } }) as any).error, /unknown tool 'board_purge'/);
      }
    }
    assert.deepEqual(createContractToolbox(contract, client, { ops: ['board.purge'] }).tools, [],
      'naming it in ops does not offer it either');
    assert.deepEqual(received['board.purge'], []);
  });

  it('stages the large operation under a weak model\'s budget, and not under a stronger one', () => {
    const { contract, client } = openBoard();
    const weak = createContractToolbox(contract, client, { model: 'qwen/qwen3.6-35b-a3b', pin: { by: 'oracle' } });
    assert.equal(weak.profile?.moe, true);
    assert.equal(weak.budget, TOOL_BUDGETS.small);
    assert.deepEqual(weak.staged, ['board_import']);
    assert.deepEqual(weak.direct, ['board_rename', 'board_read']);
    assert.deepEqual(weak.tools.map((tool) => tool.name), [
      'tool_list', 'tool_describe', 'tool_call', 'draft_open', 'draft_set', 'draft_append', 'draft_view', 'draft_commit', 'draft_discard',
    ]);
    const dense = createContractToolbox(contract, client, { model: 'qwen/qwen3.8-27b', pin: { by: 'oracle' } });
    assert.equal(dense.budget, TOOL_BUDGETS.medium);
    assert.deepEqual(dense.staged, [], 'a dense 27B model is offered the whole import');
    const prefixed = createContractToolbox(contract, client, { model: 'qwen/qwen3.6-35b-a3b', prefix: 'board_', maxDrafts: 1 });
    assert.equal(prefixed.tools[3].name, 'board_draft_open');
  });
});

/**
 * A scripted weak model: it can emit tool-call arguments of at most
 * `limit` characters, and a longer call comes back cut at the limit with
 * `finishReason: 'length'` — the way a provider stops a reply at its
 * output budget. What it calls is decided from the tools it is offered
 * and the results it has read, as a model following the tool
 * descriptions would.
 */
function weakModel(limit: number, board: string, notes: readonly unknown[]) {
  const sent: string[] = [];
  let draft: string | null = null;
  let budget = { maxArgumentChars: limit, maxItems: 1 };
  let appended = 0;
  let calls = 0;
  const say = (content: string) => ({ message: { role: 'assistant', content, toolCalls: null }, finishReason: 'stop' });
  const call = (name: string, args: unknown) => {
    const text = JSON.stringify(args);
    const cut = text.length > limit;
    sent.push(cut ? text.slice(0, limit) : text);
    return {
      message: { role: 'assistant', content: '', toolCalls: [{ id: `c${++calls}`, name, arguments: sent.at(-1) }] },
      finishReason: cut ? 'length' : 'tool_calls',
    };
  };
  return {
    sent,
    async complete(request: { messages: any[]; tools?: any[] }) {
      const offered = new Set((request.tools ?? []).map((tool) => tool.function.name));
      const results = request.messages.filter((message) => message.role === 'tool').map((message) => JSON.parse(message.content));
      const last = results.at(-1);
      if (draft === null) {
        if (results.length === 0) {
          // first, the obvious thing: the whole input in one call
          return offered.has('board_import')
            ? call('board_import', { board, notes })
            : call('tool_call', { name: 'board_import', input: { board, notes } });
        }
        if (typeof last.error === 'string' && /cut off/.test(last.error)) {
          if (!/draft_open/.test(last.error)) return results.length < 2 ? call('board_import', { board, notes }) : say('I could not send the import: every attempt was cut off.');
          return call('tool_describe', { name: 'board_import', path: '/notes/0' });
        }
        if (last.schema !== undefined) return call('draft_open', { tool: 'board_import', value: { board } });
        if (typeof last.draft !== 'string') return say(`I could not open a draft: ${JSON.stringify(last)}`);
        draft = last.draft;
        budget = last.budget;
      }
      if (last.ok === true && last.meta?.op === 'board.import') return say(`Imported ${last.value.imported} notes into ${last.value.board}.`);
      if (last.error !== undefined) return say(`The import failed: ${last.error}`);
      if (appended < notes.length) {
        // as many notes as the budget the draft answered with allows
        const chunk: unknown[] = [];
        while (appended + chunk.length < notes.length && chunk.length < budget.maxItems
          && JSON.stringify([...chunk, notes[appended + chunk.length]]).length <= budget.maxArgumentChars) {
          chunk.push(notes[appended + chunk.length]);
        }
        appended += chunk.length;
        return call('draft_append', { draft, path: '/notes', items: chunk });
      }
      return call('draft_commit', { draft });
    },
  };
}

describe('jaren — a weak model imports a board through the contract toolbox', () => {
  const LIMIT = 700;
  const ask = [{ role: 'user', content: 'Import these twelve notes into the roadmap board.' }];

  it('cannot send the import as one call', async () => {
    const { contract, client, received } = openBoard();
    assert.ok(JSON.stringify({ board: 'roadmap', notes: NOTES }).length > 2 * LIMIT, 'the whole input is far over the limit');
    const tools = createContractToolbox(contract, client, { budget: 'unlimited', pin: { by: 'oracle' } });
    const toolbox = createToolbox();
    for (const tool of tools.tools) toolbox.add(tool);
    const model = weakModel(LIMIT, 'roadmap', NOTES);
    const result = await createAgent({ client: model, toolbox, maxToolRounds: 12 }).send(ask);

    assert.equal(result.steps.length, 2, 'two attempts at the whole input');
    for (const step of result.steps) {
      assert.equal(step.name, 'board_import');
      assert.match(step.result.error, new RegExp(`^tool call cut off at ${LIMIT} characters`));
      assert.doesNotMatch(step.result.error, /draft_open/, 'no drafts are offered to point at');
    }
    assert.match(result.message.content, /could not send the import/);
    assert.deepEqual(received['board.import'], [], 'the handler never ran');
  });

  it('imports the same notes through drafts under the model\'s own budget', async () => {
    const { contract, client, received } = openBoard();
    const tools = createContractToolbox(contract, client, { model: 'qwen/qwen3.6-35b-a3b', pin: { by: 'oracle' } });
    const toolbox = createToolbox();
    for (const tool of tools.tools) toolbox.add(tool);
    const model = weakModel(LIMIT, 'roadmap', NOTES);
    const result = await createAgent({ client: model, toolbox, maxToolRounds: 12 }).send(ask);

    // the first, whole call is cut, and the error points at the drafts
    assert.equal(result.steps[0].name, 'tool_call');
    assert.match(result.steps[0].result.error, new RegExp(`^tool call cut off at ${LIMIT} characters`));
    assert.match(result.steps[0].result.error, /draft_open, then draft_set .* then draft_commit$/);
    // then the model reads the note schema, opens a draft and sends the notes in budget-sized appends
    assert.deepEqual(result.steps.map((step: any) => step.name), [
      'tool_call', 'tool_describe', 'draft_open', 'draft_append', 'draft_append', 'draft_append', 'draft_append', 'draft_commit',
    ]);
    assert.deepEqual(result.steps[1].result.schema, BOARD.$defs.Note, 'the $ref to the note is followed');
    const root = await tools.execute('tool_describe', { name: 'board_import' }) as any;
    assert.deepEqual(Object.keys(root.schema.properties), ['board', 'notes'], 'the pinned member is not asked for');
    assert.deepEqual(result.steps[2].result.budget, { maxArgumentChars: 600, maxItems: 4 });
    for (const text of model.sent.slice(1)) assert.ok(text.length <= LIMIT, `every later call fits the limit (${text.length})`);
    assert.deepEqual(result.steps.at(-1).result, { ok: true, value: { board: 'roadmap', imported: 12 }, meta: { op: 'board.import' } });
    assert.equal(result.message.content, 'Imported 12 notes into roadmap.');

    assert.deepEqual(received['board.import'], [{ board: 'roadmap', by: 'oracle', notes: NOTES }],
      'the handler received the full, valid input once, with the pinned member');
    assert.deepEqual(tools.drafts(), [], 'the committed draft is closed');
  });
});
