import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { AiError } from '@tangleai/models/errors';
import { TOOL_BUDGETS } from '@tangleai/models/profile';
import { createAgent } from '@tangleai/agents/agent';
import { estimateArgumentChars, stageTools } from '@tangleai/agents/staging';
import type { StagedTools } from '@tangleai/agents/staging';
import { createToolbox } from '@tangleai/agents/toolbox';
import type { ToolDef } from '@tangleai/agents/toolbox';

const NOTE = {
  type: 'object',
  required: ['id', 'title', 'tags'],
  properties: {
    id: { type: 'string', pattern: '^n[0-9]+$' },
    title: { type: 'string', minLength: 1, maxLength: 80 },
    tags: { type: 'array', items: { type: 'string', minLength: 1 } },
    meta: {
      type: 'object',
      properties: {
        owner: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
        priority: { type: 'integer', minimum: 1, maximum: 5 },
      },
    },
  },
  additionalProperties: false,
};

const IMPORT_SCHEMA = {
  type: 'object',
  required: ['board', 'notes'],
  properties: {
    board: { type: 'string', minLength: 1 },
    notes: { type: 'array', minItems: 3, items: { $ref: '#/$defs/Note' } },
  },
  additionalProperties: false,
  $defs: { Note: NOTE },
};

/** The tiny tier without its catalog: staged tools, direct tools listed whole. */
const TINY_DIRECT = { ...TOOL_BUDGETS.tiny, catalog: false };

function boardTools(received: unknown[] = []): ToolDef[] {
  return [
    {
      name: 'board_import',
      description: 'Import notes into a board. Every note needs an id, a title and tags.',
      inputSchema: IMPORT_SCHEMA,
      execute: (input: any) => { received.push(input); return { imported: input.notes.length }; },
    },
    {
      name: 'board_rename',
      description: 'Rename a board.',
      inputSchema: { type: 'object', required: ['board', 'title'], properties: { board: { type: 'string' }, title: { type: 'string', minLength: 1 } } },
      execute: ({ board, title }: any) => ({ board, title }),
    },
    {
      name: 'board_ping',
      description: 'Check that the board service answers.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute: () => ({ pong: true }),
    },
  ];
}

/** The staged tools registered into a real toolbox, as an agent would call them. */
function caller(staged: StagedTools) {
  const toolbox = createToolbox();
  for (const tool of staged.tools) toolbox.add(tool);
  return async (name: string, args: unknown): Promise<any> => toolbox.execute(name, args);
}

const note = (id: number, extra: Record<string, unknown> = {}) => ({ id: `n${id}`, title: `Note ${id}`, tags: ['plan'], ...extra });

const refused = (attempt: () => unknown, message: RegExp) => assert.throws(attempt,
  (error: unknown) => error instanceof AiError && error.code === 'AI0001' && message.test(error.message));

describe('agents — estimating a tool call', () => {
  it('sizes a typical instance from what the schema asks for', () => {
    assert.equal(estimateArgumentChars({ type: 'object', properties: { id: { type: 'integer' } } }),
      JSON.stringify({ id: 1234 }).length);
    assert.equal(estimateArgumentChars({ type: 'array', items: { type: 'string' } }),
      JSON.stringify(['twelve chars', 'twelve chars', 'twelve chars']).length, 'three items of twelve characters');
    assert.equal(estimateArgumentChars({ type: 'string', format: 'date-time' }), JSON.stringify(new Date(0).toISOString()).length);
    assert.equal(estimateArgumentChars({ enum: ['a', 'considerably longer'] }), JSON.stringify('considerably longer').length);
    assert.equal(estimateArgumentChars(true), 12);
    assert.equal(estimateArgumentChars(false), 0);
    assert.equal(estimateArgumentChars({ type: 'object', properties: {}, additionalProperties: false }), 2);
  });

  it('grows with every member, length and item the schema asks for', () => {
    const one = { type: 'object', properties: { id: { type: 'integer' } } };
    const two = { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } } };
    assert.ok(estimateArgumentChars(two) > estimateArgumentChars(one), 'an optional member counts');
    assert.ok(estimateArgumentChars({ type: 'string', minLength: 50 }) > estimateArgumentChars({ type: 'string' }));
    assert.ok(estimateArgumentChars({ type: 'string', maxLength: 4 }) < estimateArgumentChars({ type: 'string' }));
    const list = { type: 'array', items: one };
    assert.ok(estimateArgumentChars({ ...list, minItems: 10 }) > estimateArgumentChars(list), 'minItems over three counts');
    assert.ok(estimateArgumentChars({ ...list, maxItems: 1 }) < estimateArgumentChars(list), 'maxItems under three caps');
    assert.ok(estimateArgumentChars({ type: 'array', prefixItems: [{ type: 'integer' }], items: false })
      < estimateArgumentChars({ type: 'array', items: { type: 'integer' } }), 'a closed tuple has its own length');
    const nested = { type: 'object', properties: { inner: two } };
    assert.ok(estimateArgumentChars(nested) > estimateArgumentChars(two));
  });

  it('resolves $refs into the schema\'s own $defs, and cuts recursion', () => {
    const inlined = { ...IMPORT_SCHEMA, properties: { ...IMPORT_SCHEMA.properties, notes: { type: 'array', minItems: 3, items: NOTE } } };
    assert.equal(estimateArgumentChars(IMPORT_SCHEMA), estimateArgumentChars(inlined));
    const tree = {
      $ref: '#/$defs/Tree',
      $defs: { Tree: { type: 'object', properties: { name: { type: 'string' }, children: { type: 'array', items: { $ref: '#/$defs/Tree' } } } } },
    };
    const size = estimateArgumentChars(tree);
    assert.ok(Number.isFinite(size) && size > estimateArgumentChars({ type: 'object', properties: { name: { type: 'string' } } }));
    assert.equal(estimateArgumentChars({ $ref: 'https://example.com/elsewhere' }), 12, 'an outside reference is an unknown value');
  });

  it('counts the largest branch, and adds up the parts of an object', () => {
    const small = { type: 'object', properties: { a: { type: 'integer' } } };
    const large = { type: 'object', properties: { a: { type: 'integer' }, b: { type: 'string', minLength: 40 } } };
    assert.equal(estimateArgumentChars({ oneOf: [small, large] }), estimateArgumentChars(large));
    assert.equal(estimateArgumentChars({ anyOf: [large, small] }), estimateArgumentChars(large));
    assert.ok(estimateArgumentChars({ allOf: [small, large] }) > estimateArgumentChars(large));
  });
});

describe('agents — staged tool calls', () => {
  it('passes every tool through unchanged under an unlimited budget', () => {
    const tools = boardTools();
    const staged = stageTools(tools, { budget: TOOL_BUDGETS.unlimited });
    assert.equal(staged.tools.length, tools.length);
    staged.tools.forEach((tool, index) => assert.equal(tool, tools[index], 'the same definition, not a copy'));
    assert.deepEqual(staged.direct, ['board_import', 'board_rename', 'board_ping']);
    assert.deepEqual(staged.staged, []);
    assert.deepEqual(staged.drafts(), []);
  });

  it('stages only the tools whose typical input is over the budget', () => {
    const tools = boardTools();
    const staged = stageTools(tools, { budget: TINY_DIRECT });
    assert.ok(estimateArgumentChars(IMPORT_SCHEMA) > TINY_DIRECT.maxArgumentChars);
    assert.deepEqual(staged.staged, ['board_import']);
    assert.deepEqual(staged.direct, ['board_rename', 'board_ping']);
    assert.deepEqual(staged.tools.map((tool) => tool.name), [
      'board_rename', 'board_ping', 'draft_open', 'draft_set', 'draft_append', 'draft_view', 'draft_commit', 'draft_discard',
    ]);
    assert.equal(staged.tools[0], tools[1], 'a direct tool passes through unchanged');
    const open = staged.tools.find((tool) => tool.name === 'draft_open')!;
    assert.deepEqual(open.inputSchema.properties.tool.enum, ['board_import']);
    assert.ok(open.description.includes(JSON.stringify(IMPORT_SCHEMA)),
      'without a catalog the staged schema travels in full, up front');
    assert.match(open.description, /at most 300 characters and 2 items per call/);

    // the small tier: the same tools fit it, a longer list does not
    assert.deepEqual(stageTools(boardTools(), { budget: TOOL_BUDGETS.small }).staged, []);
    const longer = { ...IMPORT_SCHEMA, properties: { ...IMPORT_SCHEMA.properties, notes: { ...IMPORT_SCHEMA.properties.notes, minItems: 6 } } };
    assert.ok(estimateArgumentChars(longer) > TOOL_BUDGETS.small.maxArgumentChars);
    assert.deepEqual(stageTools([{ ...tools[0], inputSchema: longer }, tools[1]], { budget: TOOL_BUDGETS.small }).staged, ['board_import']);

    const prefixed = stageTools(boardTools(), { budget: TINY_DIRECT, prefix: 'board_' });
    assert.deepEqual(prefixed.tools.slice(2).map((tool) => tool.name), [
      'board_draft_open', 'board_draft_set', 'board_draft_append', 'board_draft_view', 'board_draft_commit', 'board_draft_discard',
    ]);
    assert.equal(stageTools(boardTools().slice(1), { budget: TINY_DIRECT }).tools.length, 2,
      'nothing staged, no draft tools');
  });

  it('builds a draft in budget-sized calls and commits it to the tool', async () => {
    const received: unknown[] = [];
    const staged = stageTools(boardTools(received), { budget: TINY_DIRECT });
    const call = caller(staged);

    const board = 'the roadmap for the autumn release';
    const opened = await call('draft_open', { tool: 'board_import', value: { board } });
    assert.equal(opened.draft, 'd1');
    assert.equal(opened.tool, 'board_import');
    assert.deepEqual(opened.missing, ['/notes']);
    assert.deepEqual(opened.budget, { maxArgumentChars: 300, maxItems: 2 });
    assert.match(opened.hint, /draft_set \{ draft: "d1", path, value \}/);

    const nested = await call('draft_set', { draft: 'd1', path: '/notes/0/meta/owner/name', value: 'Ann' });
    assert.equal(nested.ok, true);
    assert.deepEqual(nested.missing, ['/notes/0/id', '/notes/0/title', '/notes/0/tags'],
      'the parents were created, and their required members are reported');
    await call('draft_set', { draft: 'd1', path: '/notes/0/id', value: 'n1' });
    await call('draft_set', { draft: 'd1', path: '/notes/0/title', value: 'Note 1' });
    const tags = await call('draft_append', { draft: 'd1', path: '/notes/0/tags', items: ['plan', 'q3'] });
    assert.deepEqual({ ok: tags.ok, path: tags.path, length: tags.length, missing: tags.missing }, { ok: true, path: '/notes/0/tags', length: 2, missing: [] });

    // the rest of the list arrives in appends of at most two items
    assert.equal((await call('draft_append', { draft: 'd1', path: '/notes', items: [note(2), note(3)] })).length, 3);
    assert.equal((await call('draft_append', { draft: 'd1', path: '/notes', items: [note(4)] })).length, 4);
    // `-` appends one element at a time, and a text is continued by an append
    const appended = await call('draft_set', { draft: 'd1', path: '/notes/-', value: { id: 'n5', title: 'No', tags: [] } });
    assert.equal(appended.path, '/notes/4');
    const text = await call('draft_append', { draft: 'd1', path: '/notes/4/title', items: ['te ', '5'] });
    assert.equal(text.length, 'Note 5'.length);

    const expected = {
      board,
      notes: [
        { meta: { owner: { name: 'Ann' } }, id: 'n1', title: 'Note 1', tags: ['plan', 'q3'] },
        note(2), note(3), note(4), { id: 'n5', title: 'Note 5', tags: [] },
      ],
    };
    const view = await call('draft_view', { draft: 'd1' });
    assert.equal(view.truncated, true, 'the whole draft is over 300 characters');
    assert.equal(view.value, JSON.stringify(expected).slice(0, 300));
    assert.equal(view.size, JSON.stringify(expected).length);
    assert.deepEqual(view.next, ['/board', '/notes'], 'the paths to page through');
    const part = await call('draft_view', { draft: 'd1', path: '/notes/4' });
    assert.deepEqual({ value: part.value, truncated: part.truncated }, { value: expected.notes[4], truncated: false });
    assert.deepEqual(staged.drafts(), [{ draft: 'd1', tool: 'board_import', size: JSON.stringify(expected).length, missing: [] }]);

    assert.deepEqual(await call('draft_commit', { draft: 'd1' }), { imported: 5 }, 'the tool\'s own answer');
    assert.deepEqual(received, [expected], 'the tool received the whole, valid input');
    assert.deepEqual(staged.drafts(), [], 'a committed draft closes');
    assert.match((await call('draft_commit', { draft: 'd1' })).error, /no open draft 'd1'/);
  });

  it('refuses a value over the budget with the paths to send instead', async () => {
    const staged = stageTools(boardTools(), { budget: TINY_DIRECT });
    const call = caller(staged);
    await call('draft_open', { tool: 'board_import', value: { board: 'roadmap' } });
    const long = 'x'.repeat(120);

    const object = await call('draft_set', { draft: 'd1', path: '/notes/0', value: note(1, { title: long, meta: { owner: { name: long } } }) });
    assert.match(object.error, /^the value for \/notes\/0 is \d+ characters; one call carries at most 300$/);
    assert.deepEqual(object.paths, ['/notes/0/id', '/notes/0/title', '/notes/0/tags', '/notes/0/meta']);
    assert.match(object.hint, /set its members one by one with draft_set: \/notes\/0\/id, \/notes\/0\/title/);

    const list = await call('draft_set', { draft: 'd1', path: '/notes', value: [note(1), note(2), note(3), note(4), note(5), note(6), note(7), note(8)] });
    assert.deepEqual(list.paths, ['/notes/0', '/notes/1', '/notes/2', '/notes/3', '/notes/4', '/notes/5'], 'at most six paths');
    assert.match(list.hint, /add the 8 items with draft_append \{ path: "\/notes", items \}/);

    const text = await call('draft_set', { draft: 'd1', path: '/board', value: 'b'.repeat(400) });
    assert.match(text.hint, /draft_append \{ path: "\/board", items: \["…the next part"\] \}/);

    const start = await call('draft_open', { tool: 'board_import', value: { board: long, notes: [note(1, { title: long })] } });
    assert.match(start.error, /^the starting value is \d+ characters/);
    assert.deepEqual(start.paths, ['/board', '/notes']);

    const many = await call('draft_append', { draft: 'd1', path: '/notes', items: [note(1), note(2), note(3)] });
    assert.match(many.error, /one append carries at most 2 items; this one carried 3/);
    const heavy = await call('draft_append', { draft: 'd1', path: '/notes', items: [note(1, { title: long }), note(2, { title: long })] });
    assert.match(heavy.error, /these 2 items are \d+ characters together/);
    const huge = await call('draft_append', { draft: 'd1', path: '/notes', items: [note(1, { title: long, meta: { owner: { name: long } } })] });
    assert.match(huge.error, /^item 0 is \d+ characters/);
    assert.match(huge.hint, /draft_set at \/notes\/<its index>\/<member>/);

    assert.deepEqual((await call('draft_view', { draft: 'd1' })).value, { board: 'roadmap' }, 'no refusal changed the draft');
  });

  it('checks each value against the sub-schema at its path', async () => {
    const staged = stageTools(boardTools(), { budget: TINY_DIRECT });
    const call = caller(staged);
    await call('draft_open', { tool: 'board_import' });

    const priority = await call('draft_set', { draft: 'd1', path: '/notes/0/meta/priority', value: 'high' });
    assert.equal(priority.error, 'invalid input for board_import at /notes/0/meta/priority');
    assert.deepEqual(priority.errors.map(({ instancePath, keyword }: any) => ({ instancePath, keyword })),
      [{ instancePath: '/notes/0/meta/priority', keyword: 'type' }]);
    assert.deepEqual(priority.inputSchema, { type: 'integer', minimum: 1, maximum: 5 }, 'a small sub-schema rides along');

    const id = await call('draft_set', { draft: 'd1', path: '/notes/0/id', value: 'x1' });
    assert.equal(id.errors[0].instancePath, '/notes/0/id');
    assert.equal(id.errors[0].keyword, 'pattern');

    const item = await call('draft_append', { draft: 'd1', path: '/notes', items: [note(1), { id: 'n2', title: '', tags: [] }] });
    assert.deepEqual(item.errors.map(({ instancePath, keyword }: any) => ({ instancePath, keyword })),
      [{ instancePath: '/notes/1/title', keyword: 'minLength' }], 'items are checked at the index they would take');
    assert.equal((await call('draft_view', { draft: 'd1', path: '/notes' })).error, 'nothing is set at /notes', 'a refused append adds nothing');

    const stray = await call('draft_set', { draft: 'd1', path: '/notes/0/colour/shade', value: 'red' });
    assert.equal(stray.error, '/notes/0/colour is not part of board_import\'s input');
    assert.deepEqual(stray.members, ['/notes/0/id', '/notes/0/title', '/notes/0/tags', '/notes/0/meta']);

    assert.match((await call('draft_set', { draft: 'd1', path: 'notes/0', value: 1 })).error, /is not a JSON Pointer: start it with '\/'/);
    assert.match((await call('draft_set', { draft: 'd1', path: '', value: {} })).error, /path "" is the whole input/);
    assert.match((await call('draft_set', { draft: 'd1', path: '/notes/3/id', value: 'n4' })).error,
      /index 3 is past the end of \/notes \(length 0\); use \/notes\/- to append/);

    // past a branch the leaf waits for the commit, which checks everything
    const branching = stageTools([{
      name: 'shape_save',
      description: 'Save a shape.',
      inputSchema: {
        type: 'object',
        required: ['shape'],
        properties: {
          shape: { oneOf: [{ type: 'object', required: ['r'], properties: { r: { type: 'number' } } }, { type: 'object', required: ['w', 'h'], properties: { w: { type: 'number' }, h: { type: 'number' } } }] },
          label: { type: 'string', minLength: 400 },
        },
      },
      execute: (input: any) => input,
    }], { budget: TINY_DIRECT });
    assert.deepEqual(branching.staged, ['shape_save']);
    const shapes = caller(branching);
    await shapes('draft_open', { tool: 'shape_save' });
    assert.equal((await shapes('draft_set', { draft: 'd1', path: '/shape/r', value: 'wide' })).ok, true, 'no leaf check below a oneOf');
    const commit = await shapes('draft_commit', { draft: 'd1' });
    assert.equal(commit.error, 'invalid input for shape_save');
  });

  it('keeps the draft when the commit finds it invalid, and when the tool throws', async () => {
    const received: unknown[] = [];
    const tools = boardTools(received);
    let failures = 1;
    tools.push({
      name: 'board_flaky',
      description: 'Import notes, failing once.',
      inputSchema: IMPORT_SCHEMA,
      execute: () => { if (failures-- > 0) throw new Error('the board is busy'); return { imported: 'later' }; },
    });
    const staged = stageTools(tools, { budget: TINY_DIRECT });
    const call = caller(staged);
    await call('draft_open', { tool: 'board_import', value: { board: 'roadmap' } });
    await call('draft_append', { draft: 'd1', path: '/notes', items: [note(1)] });

    const rejected = await call('draft_commit', { draft: 'd1' });
    assert.equal(rejected.error, 'invalid input for board_import');
    assert.deepEqual(rejected.errors, [{ instancePath: '/notes', keyword: 'minItems', message: rejected.errors[0].message }]);
    assert.ok(rejected.errors.length <= 8);
    assert.equal(rejected.draft, 'd1');
    assert.match(rejected.hint, /the draft is kept/);
    assert.equal(rejected.inputSchema, undefined, 'the whole schema is the thing too large to send back');
    assert.deepEqual(staged.drafts().map((draft) => draft.draft), ['d1']);

    await call('draft_append', { draft: 'd1', path: '/notes', items: [note(2), note(3)] });
    assert.deepEqual(await call('draft_commit', { draft: 'd1' }), { imported: 3 }, 'fixing only the reported path is enough');
    assert.equal(received.length, 1);

    await call('draft_open', { tool: 'board_flaky', value: { board: 'roadmap' } });
    await call('draft_append', { draft: 'd2', path: '/notes', items: [note(1), note(2)] });
    await call('draft_append', { draft: 'd2', path: '/notes', items: [note(3)] });
    const thrown = await call('draft_commit', { draft: 'd2' });
    assert.deepEqual(thrown, { error: 'the board is busy', draft: 'd2', hint: thrown.hint });
    assert.deepEqual(staged.drafts().map((draft) => draft.draft), ['d2'], 'the tool did not answer: the draft stays');
    assert.deepEqual(await call('draft_commit', { draft: 'd2' }), { imported: 'later' });
  });

  it('discards a draft, and answers an unknown one with the open ids', async () => {
    const staged = stageTools(boardTools(), { budget: TINY_DIRECT });
    const call = caller(staged);
    await call('draft_open', { tool: 'board_import' });
    assert.deepEqual(await call('draft_discard', { draft: 'd1' }), { ok: true, discarded: 'd1' });
    assert.deepEqual(staged.drafts(), []);
    const unknown = await call('draft_view', { draft: 'd1' });
    assert.deepEqual({ error: unknown.error, open: unknown.open }, { error: 'no open draft \'d1\'', open: [] });
    const direct = await call('draft_open', { tool: 'board_rename' });
    assert.equal(direct.error, 'invalid input for draft_open', 'the enum names the staged tools');
    assert.equal(direct.errors[0].instancePath, '/tool');
    // a host that calls the definition directly (a WebMCP page) still gets a reason
    const open = staged.tools.find((tool) => tool.name === 'draft_open')!;
    assert.deepEqual(open.execute({ tool: 'board_rename' }), { error: '\'board_rename\' takes a small input: call it directly' });
    assert.deepEqual(open.execute({ tool: 'board_purge' }), { error: 'no staged tool \'board_purge\'', staged: ['board_import'] });
  });

  it('answers a host that calls the definitions directly, and never throws', async () => {
    const staged = stageTools(boardTools(), { budget: TINY_DIRECT });
    const tool = (name: string) => staged.tools.find((def) => def.name === name)!;
    const { draft } = tool('draft_open').execute({ tool: 'board_import' });
    const cyclic: Record<string, unknown> = { board: 'b' };
    cyclic.self = cyclic;
    const calls: Array<[string, unknown]> = [
      ['draft_open', null],
      ['draft_open', { tool: 'board_import', value: cyclic }],
      ['draft_set', { draft, path: '/board', value: cyclic }],
      ['draft_set', { draft, path: 3, value: 1 }],
      ['draft_append', { draft, path: '/notes', items: 'n1' }],
      ['draft_append', { draft, path: '/notes', items: [1n] }],
      ['draft_view', undefined],
      ['draft_commit', {}],
      ['draft_discard', { draft: 7 }],
    ];
    for (const [name, input] of calls) {
      const answer = await tool(name).execute(input);
      assert.equal(typeof answer.error, 'string', `${name} answers with an error`);
    }
    assert.deepEqual(staged.drafts().map((open) => open.draft), [draft], 'nothing was opened or changed');
  });

  it('refuses a draft past maxDrafts and names the open ones', async () => {
    const staged = stageTools(boardTools(), { budget: TINY_DIRECT, maxDrafts: 2 });
    const call = caller(staged);
    await call('draft_open', { tool: 'board_import' });
    await call('draft_open', { tool: 'board_import', value: { board: 'two' } });
    const third = await call('draft_open', { tool: 'board_import' });
    assert.equal(third.error, '2 drafts are open, the most this toolbox keeps');
    assert.deepEqual(third.open.map((draft: any) => draft.draft), ['d1', 'd2']);
    assert.match(third.hint, /draft_commit or draft_discard one first/);
    await call('draft_discard', { draft: 'd1' });
    assert.equal((await call('draft_open', { tool: 'board_import' })).draft, 'd3', 'ids are never reused');
  });

  it('stands a catalog in for the direct tools under a catalog budget', async () => {
    const staged = stageTools(boardTools(), { budget: TOOL_BUDGETS.tiny });
    const call = caller(staged);
    assert.deepEqual(staged.tools.map((tool) => tool.name), [
      'tool_list', 'tool_describe', 'tool_call',
      'draft_open', 'draft_set', 'draft_append', 'draft_view', 'draft_commit', 'draft_discard',
    ]);
    assert.ok(!staged.tools.find((tool) => tool.name === 'draft_open')!.description.includes('"$defs"'),
      'with a catalog the schema is read on demand, not sent up front');

    assert.deepEqual(await call('tool_list', {}), [
      { name: 'board_import', description: 'Import notes into a board.', staged: true, size: 'large' },
      { name: 'board_rename', description: 'Rename a board.', staged: false, size: 'small' },
      { name: 'board_ping', description: 'Check that the board service answers.', staged: false, size: 'none' },
    ]);

    const root = await call('tool_describe', { name: 'board_import' });
    const { $defs, ...withoutDefs } = IMPORT_SCHEMA;
    assert.deepEqual(root.schema, withoutDefs, 'definitions are reached by drilling in');
    assert.deepEqual({ truncated: root.truncated, next: root.next }, { truncated: false, next: ['/board', '/notes'] });
    const item = await call('tool_describe', { name: 'board_import', path: '/notes/0' });
    assert.deepEqual(item.schema, NOTE, 'the $ref is followed');
    assert.deepEqual(item.next, ['/notes/0/id', '/notes/0/title', '/notes/0/tags', '/notes/0/meta']);

    const wordy = stageTools([{
      name: 'form_fill',
      description: 'Fill a form.',
      inputSchema: {
        type: 'object',
        properties: Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`field${index}`, { type: 'string', description: `The value of field ${index}, as printed on the form.` }])),
      },
      execute: (input: any) => input,
    }], { budget: TOOL_BUDGETS.tiny });
    const cut = await caller(wordy)('tool_describe', { name: 'form_fill' });
    assert.equal(cut.truncated, true);
    assert.equal(typeof cut.schema, 'string');
    assert.equal(cut.schema.length, TOOL_BUDGETS.tiny.maxSchemaChars);
    assert.equal(cut.next.length, 24, 'the paths to drill into, capped');
    assert.equal(cut.next[0], '/field0');

    assert.deepEqual(await call('tool_call', { name: 'board_rename', input: { board: 'b', title: 'Plans' } }), { board: 'b', title: 'Plans' });
    const invalid = await call('tool_call', { name: 'board_rename', input: { board: 'b', title: '' } });
    assert.equal(invalid.error, 'invalid input for board_rename');
    assert.equal(invalid.errors[0].instancePath, '/title');
    assert.deepEqual(await call('tool_call', { name: 'board_ping' }), { pong: true }, 'no input is an empty one');
    assert.match((await call('tool_call', { name: 'board_import', input: {} })).hint, /draft_open \{ tool: "board_import" \}/);
    assert.match((await call('tool_call', { name: 'board_purge', input: {} })).error, /unknown tool 'board_purge'/);
    assert.match((await call('tool_describe', { name: 'nope' })).hint, /tool_list names the tools/);
  });

  it('refuses invalid and duplicate tool names, and a malformed budget', () => {
    const [importer, renamer] = boardTools();
    refused(() => stageTools([renamer, { ...importer, name: 'board_rename' }], { budget: TOOL_BUDGETS.unlimited }),
      /the tool name 'board_rename' is used twice/);
    refused(() => stageTools([importer, { ...renamer, name: 'draft_open' }], { budget: TINY_DIRECT }),
      /'draft_open' is used twice, by tool 'draft_open' and by the draft protocol — pass a prefix/);
    assert.equal(stageTools([importer, { ...renamer, name: 'draft_open' }], { budget: TINY_DIRECT, prefix: 'b_' }).tools[1].name, 'b_draft_open');
    refused(() => stageTools([importer, { ...renamer, name: 'tool_call' }], { budget: TOOL_BUDGETS.tiny }),
      /'tool_call' is used twice, by tool 'tool_call' and by the tool catalog/);
    refused(() => stageTools([{ ...renamer, name: 'rename board' }], { budget: TOOL_BUDGETS.unlimited }), /must match \^\[a-zA-Z0-9_-\]\{1,64\}\$/);
    refused(() => stageTools([importer], { budget: TINY_DIRECT, prefix: 'p'.repeat(60) }), /the name of the draft protocol must match/);
    refused(() => stageTools([importer], { budget: { ...TINY_DIRECT, maxArgumentChars: -1 } }), /budget must be a tool budget/);
    refused(() => stageTools([importer], {} as never), /budget must be a tool budget/);
    refused(() => stageTools([importer], { budget: TINY_DIRECT, maxDrafts: 0 }), /maxDrafts must be a positive integer/);
    refused(() => stageTools([{ name: 'x' } as unknown as ToolDef], { budget: TINY_DIRECT }), /tools\[0\] must be \{ name, description, inputSchema, execute \}/);
  });
});

describe('agents — a reply cut at its length limit', () => {
  /** A scripted client: each complete() call shifts the next reply. */
  function scriptedClient(replies: any[]) {
    return { complete: async () => replies.shift() };
  }
  const cutTurn = (name: string, text: string) => ({
    message: { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name, arguments: text }] },
    finishReason: 'length',
  });
  const final = { message: { role: 'assistant', content: 'done', toolCalls: null }, finishReason: 'stop' };
  const cut = '{"board":"roadmap","notes":[{"id":"n1","title":"Note 1","tags":["pl';

  it('says where the call was cut, and points at the drafts the request offers', async () => {
    const toolbox = createToolbox();
    for (const tool of stageTools(boardTools(), { budget: TINY_DIRECT }).tools) toolbox.add(tool);
    const result = await createAgent({ client: scriptedClient([cutTurn('board_import', cut), final]), toolbox })
      .send([{ role: 'user', content: 'import the notes' }]);
    const { error } = result.steps[0].result;
    assert.match(error, new RegExp(`^tool call cut off at ${cut.length} characters: the reply reached its length limit`));
    assert.match(error, /build this input in parts instead: draft_open, then draft_set \(or draft_append for list items\) in small calls, then draft_commit$/);
    assert.equal(result.message.content, 'done');
  });

  it('names prefixed draft tools, and says only "smaller" when none are offered', async () => {
    const prefixed = createToolbox();
    for (const tool of stageTools(boardTools(), { budget: TINY_DIRECT, prefix: 'board_' }).tools) prefixed.add(tool);
    const named = await createAgent({ client: scriptedClient([cutTurn('board_import', cut), final]), toolbox: prefixed })
      .send([{ role: 'user', content: 'import' }]);
    assert.match(named.steps[0].result.error, /board_draft_open, then board_draft_set .* then board_draft_commit$/);

    const plain = createToolbox();
    for (const tool of boardTools()) plain.add(tool);
    const bare = await createAgent({ client: scriptedClient([cutTurn('board_import', cut), final]), toolbox: plain })
      .send([{ role: 'user', content: 'import' }]);
    assert.equal(bare.steps[0].result.error, `tool call cut off at ${cut.length} characters: the reply reached its length limit`
      + ' before the arguments were complete, so they are not valid JSON — send a smaller input');

    const broken = await createAgent({
      client: scriptedClient([{ ...cutTurn('board_import', '{oops'), finishReason: 'tool_calls' }, final]),
      toolbox: plain,
    }).send([{ role: 'user', content: 'import' }]);
    assert.match(broken.steps[0].result.error, /^tool arguments are not valid JSON/, 'a reply that was not cut reads as before');
  });
});
