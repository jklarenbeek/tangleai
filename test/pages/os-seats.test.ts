/**
 * Radiant OS's language-model seats (Pages, Tangle edition): the crew's
 * seat building through the OS contract with the contract toolbox — from
 * a catalog under a small model's budget, in one call for a dense model,
 * by the scripted crew wherever the model leaves an idea unbuilt — the docs'
 * voice answering only from the library's passages, and the library the
 * build collects. The model is a scripted endpoint on the OpenAI wire.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { compileContract } from '@jarenjs/contract';
import { openLocalClient } from '@jarenjs/contract/local';
import { JarenValidator } from '@jarenjs/validate';
import contractDoc from '../../apps/pages/src/os/documents/os.contract.json' with { type: 'json' };
import { createStudioHandlers } from '../../apps/pages/src/os/kernel/studio.ts';
import type { StudioHost } from '../../apps/pages/src/os/kernel/studio.ts';
import { emptyMail } from '../../apps/pages/src/os/kernel/mail.ts';
import { emptyBoard } from '../../apps/pages/src/os/kernel/board.ts';
import { scriptedCrew } from '../../apps/pages/src/os/kernel/crew.ts';
import { createCrewSeat, crewSystem, crewTask } from '../../apps/pages/src/os/kernel/crew-seat.ts';
import { createDocsVoice, docsPrompt, citedIn, PASSAGES } from '../../apps/pages/src/os/kernel/docs-voice.ts';
import { libraryFrom, createLibraryIndex, answerFromDocs, isLibrary, SECTION_MAX } from '../../apps/pages/src/os/kernel/library.ts';
import { collectLibrary, GUIDE } from '../../apps/pages/src/os/library-sources.ts';

const contract = compileContract(contractDoc as any, { validator: new JarenValidator({ collectErrors: true }) as any });

/** The studio's contract handlers over a bare state, as the OS serves them. */
function desk() {
  const state: any = { crew: { project: null }, mail: emptyMail(), board: emptyBoard(), settings: {} };
  const host: StudioHost = {
    getState: () => state,
    dispatch: (action, payload) => {
      if (action === 'crew/set') state.crew.project = payload;
      else if (action === 'mail/set') state.mail = payload;
    },
    now: () => 1000,
    library: () => null,
    arcade: () => null,
  };
  const studio = createStudioHandlers(host);
  // the studio's operations, served; the rest of the OS is not in this test
  const handlers = Object.fromEntries(Object.keys(contractDoc.operations).map((op) => [op, studio[op] ?? (() => { throw new Error(`${op} is not served here`); })]));
  const client = openLocalClient(contract, handlers as any) as any;
  return { state, client };
}

/** A project with one idea, handed to the crew. */
async function handedOver(text: string) {
  const d = desk();
  await d.client.invoke('crew.start', { by: 'human', title: 'Tea time', players: ['Ada'] });
  await d.client.invoke('crew.idea', { by: 'human', text });
  await d.client.invoke('crew.end', { by: 'human' });
  assert.equal(d.state.crew.project.phase, 'crew');
  return d;
}

const settings = (model: string) => ({ provider: 'custom', baseUrl: 'https://model.invalid/v1', model, apiKey: '' });

/** A chat completion on the OpenAI wire. */
const reply = (message: any) => new Response(JSON.stringify({
  id: 'scripted', object: 'chat.completion',
  choices: [{ index: 0, finish_reason: message.tool_calls ? 'tool_calls' : 'stop', message }],
}), { status: 200, headers: { 'Content-Type': 'application/json' } });

/**
 * A scripted model: it reads which tools it was offered and builds the
 * idea with them — `crew_build` when offered whole, or, from a small
 * model's catalog, a look at `tool_list` and then `tool_call` — and then
 * says what it built the same way.
 */
function scriptedModel(block: any, options: { silent?: boolean } = {}) {
  const called: string[] = [];
  const offered: string[][] = [];
  const fetch = (async (_url: unknown, init: any) => {
    const body = JSON.parse(init.body);
    const tools: string[] = (body.tools ?? []).map((t: any) => t.function.name);
    offered.push(tools);
    const messages: any[] = body.messages;
    const idea = /Idea (\S+):/.exec(messages.find((m) => m.role === 'user').content)?.[1] ?? '';
    const done = messages.filter((m) => m.role === 'assistant').flatMap((m) => m.tool_calls ?? []).map((c: any) => c.function);
    const direct = tools.includes('crew_build');
    const use = (name: string, input: any) => (direct ? { name, args: input } : { name: 'tool_call', args: { name, input } });
    const plan = [
      ...(direct ? [] : [{ name: 'tool_list', args: {} }]),
      use('crew_build', { idea, block }),
      use('crew_say', { idea, text: 'Here it is.' }),
    ];
    const next = options.silent ? null : plan[done.length] ?? null;
    if (next === null) return reply({ role: 'assistant', content: 'Done.' });
    called.push(next.name);
    return reply({ role: 'assistant', content: null, tool_calls: [{ id: `call${called.length}`, type: 'function', function: { name: next.name, arguments: JSON.stringify(next.args) } }] });
  }) as typeof globalThis.fetch;
  return { fetch, called, offered };
}

const TEA = { kind: 'counter', label: 'Cups of tea today', step: 2 };

describe('the crew’s seat', () => {
  it('builds each planned idea through the model, from a catalog under a small model’s budget', async () => {
    const d = await handedOver('a counter for cups of tea');
    const plan = scriptedCrew(d.state.crew.project);
    const model = scriptedModel(TEA);
    const seat = createCrewSeat({ contract, client: d.client, settings: settings('qwen/qwen3.6-35b-a3b'), fetch: model.fetch, budget: () => 'auto' });
    assert.equal(seat.live, true);
    assert.equal(seat.label, 'qwen/qwen3.6-35b-a3b');
    assert.equal(await seat.turn(d.state.crew.project), true);
    assert.deepEqual(model.offered[0], ['tool_list', 'tool_describe', 'tool_call'], 'a small model reads three short tools, not every schema');
    assert.deepEqual(model.called, ['tool_list', 'tool_call', 'tool_call']);
    const task = d.state.crew.project.tasks[0];
    assert.deepEqual(task.block, TEA, 'the model’s block, not the scripted one');
    assert.equal(task.by, plan[0].by, 'built by the member the plan seated');
    const said = d.state.mail.threads.flatMap((t: any) => t.messages).map((m: any) => m.text);
    assert.ok(said.includes('Here it is.'));
    assert.ok(said.includes('That took 3 tool calls under the small tool budget.'));
    assert.ok(!said.includes(plan[0].say), 'the scripted crew did not have to step in');
  });

  it('hands a dense model the block whole, and the setting can say otherwise', async () => {
    const dense = await handedOver('a counter for cups of tea');
    const model = scriptedModel(TEA);
    await createCrewSeat({ contract, client: dense.client, settings: settings('qwen/qwen3.8-27b'), fetch: model.fetch }).turn(dense.state.crew.project);
    assert.deepEqual(model.called, ['crew_build', 'crew_say'], 'a dense model is handed the block whole');
    assert.deepEqual(dense.state.crew.project.tasks[0].block, TEA);
    assert.ok(!dense.state.mail.threads.flatMap((t: any) => t.messages).some((m: any) => /tool calls/.test(m.text)), 'a call to build and one to speak need no note');

    const unlimited = await handedOver('a counter for cups of tea');
    const small = scriptedModel(TEA);
    await createCrewSeat({ contract, client: unlimited.client, settings: settings('qwen/qwen3.6-35b-a3b'), fetch: small.fetch, budget: () => 'unlimited' }).turn(unlimited.state.crew.project);
    assert.equal(small.called[0], 'crew_build', 'the setting overrides the model’s own budget');

    const aliased = await handedOver('a counter for cups of tea');
    const alias = scriptedModel(TEA);
    await createCrewSeat({ contract, client: aliased.client, settings: settings('local-model'), fetch: alias.fetch, profile: () => 'qwen/qwen3.8-27b' }).turn(aliased.state.crew.project);
    assert.equal(alias.called[0], 'crew_build', 'a served alias is budgeted by the model it names in the OS settings');
  });

  it('builds with the scripted crew whatever the model leaves unbuilt, and reports a failed call', async () => {
    const silent = await handedOver('a checklist for the shopping');
    const plan = scriptedCrew(silent.state.crew.project);
    assert.equal(await createCrewSeat({ contract, client: silent.client, settings: settings('qwen/qwen3.8-27b'), fetch: scriptedModel(TEA, { silent: true }).fetch }).turn(silent.state.crew.project), true);
    assert.deepEqual(silent.state.crew.project.tasks[0].block, plan[0].block);

    const down = await handedOver('a checklist for the shopping');
    const errors: unknown[] = [];
    const seat = createCrewSeat({
      contract, client: down.client, settings: settings('qwen/qwen3.8-27b'),
      fetch: (async () => { throw new Error('the model is down'); }) as typeof fetch,
      onError: (e) => errors.push(e),
    });
    assert.equal(await seat.turn(down.state.crew.project), true);
    assert.equal(errors.length, 1);
    assert.equal(down.state.crew.project.tasks.length, 1, 'the idea is built all the same');
  });

  it('sits the turn out with no model, and takes one when the settings name it', async () => {
    const d = await handedOver('a note about the recipe');
    const seat = createCrewSeat({ contract, client: d.client, settings: null });
    assert.equal(seat.live, false);
    assert.equal(seat.label, 'scripted');
    assert.equal(await seat.turn(d.state.crew.project), false);
    assert.equal(d.state.crew.project.tasks.length, 0);
    seat.configure(settings('qwen/qwen3.8-27b'));
    assert.equal(seat.live, true);
    seat.configure({ provider: 'custom', baseUrl: '', model: 'x', apiKey: '' });
    assert.equal(seat.live, false, 'a custom provider needs its address');
  });

  it('tells each member who it is, what the blocks are, and the one block to build', async () => {
    const d = await handedOver('a counter for cups of tea');
    const move = scriptedCrew(d.state.crew.project)[0];
    assert.match(crewSystem('the Painter'), /^You are the Painter, one of the four builders/);
    assert.match(crewSystem('x'), /counter — /);
    const task = crewTask(d.state.crew.project, d.state.crew.project.ideas[0], move);
    assert.match(task, /^Project: “Tea time”\. Idea i1: “a counter for cups of tea”\./);
    assert.match(task, /Build it as one counter block/);
  });
});

const LIBRARY = libraryFrom([
  { id: 'store', title: '@tangleai/store', source: 'store', markdown: '# Store\n\nThe store keeps documents in SQLite. Collections have keys.' },
  { id: 'models', title: '@tangleai/models', source: 'models', markdown: '# Models\n\nOne OpenAI-compatible wire for every provider.' },
]);

describe('the docs’ voice', () => {
  const index = createLibraryIndex(LIBRARY);
  const hits = index.search('where are documents kept', 5);

  it('answers from the passages it was handed, citing them', async () => {
    let asked: any = null;
    const voice = createDocsVoice({
      settings: settings('qwen/qwen3.8-27b'),
      fetch: (async (_url: unknown, init: any) => { asked = JSON.parse(init.body); return reply({ role: 'assistant', content: 'In SQLite, by the store [1].' }); }) as typeof fetch,
    });
    assert.equal(voice.live, true);
    const answer = await voice.ask('where are documents kept?', hits);
    assert.equal(answer.text, 'In SQLite, by the store [1].');
    assert.deepEqual(answer.citations, [{ doc: 'store', section: 0, label: '@tangleai/store — Store' }]);
    assert.match(asked.messages[1].content, /^\[1\] @tangleai\/store — Store: /);
    assert.match(asked.messages[0].content, /from nothing else/);
  });

  it('keeps the offline answer when the model cites nothing, cites what it was not given, or fails', async () => {
    const offline = answerFromDocs('where are documents kept?', hits);
    for (const content of ['They are in SQLite.', 'See [9].', '']) {
      const voice = createDocsVoice({ settings: settings('m'), fetch: (async () => reply({ role: 'assistant', content })) as typeof fetch });
      assert.deepEqual(await voice.ask('where are documents kept?', hits), offline, JSON.stringify(content));
    }
    const errors: unknown[] = [];
    const down = createDocsVoice({ settings: settings('m'), fetch: (async () => { throw new Error('down'); }) as typeof fetch, onError: (e) => errors.push(e) });
    assert.deepEqual(await down.ask('where are documents kept?', hits), offline);
    assert.equal(errors.length, 1);
    const none = createDocsVoice();
    assert.equal(none.live, false);
    assert.deepEqual(await none.ask('anything', hits), offline);
    assert.deepEqual(await createDocsVoice({ settings: settings('m') }).ask('nothing', []), answerFromDocs('nothing', []), 'no passages, no call');
  });

  it('reads citations in the order they are first made, once each', () => {
    const many = ['a', 'b', 'c'].map((id, i) => ({ doc: id, section: i, title: id.toUpperCase(), heading: 'H', excerpt: `about ${id}`, score: 1 }));
    assert.deepEqual(citedIn('b [2], a [1], b again [2], out of range [7] [0]', many), [many[1], many[0]]);
    assert.equal(docsPrompt('q', many)[1].content.split('\n').filter((l) => /^\[\d\]/.test(l)).length, 3);
    assert.ok(PASSAGES >= 1);
  });
});

describe('the library the build collects', () => {
  const root = new URL('../../', import.meta.url).pathname;
  const read = (path: string) => { try { return readFileSync(`${root}${path}`, 'utf8'); } catch { return null; } };
  const packages = JSON.parse(readFileSync(`${root}release.config.json`, 'utf8')).packages as string[];

  it('opens with this edition’s guide, then every published package’s README in release order', () => {
    const library = collectLibrary(packages, read);
    assert.ok(isLibrary(library));
    assert.equal(library.docs[0].source, GUIDE);
    const withReadme = packages.filter((dir) => read(`${dir}/README.md`) !== null);
    assert.deepEqual(library.docs.slice(1).map((d) => d.source), withReadme.map((dir) => `${dir}/README.md`));
    for (const doc of library.docs) for (const s of doc.sections) assert.ok(s.text.length > 0 && s.text.length <= SECTION_MAX, `${doc.id} ${s.id}`);
    assert.equal(JSON.stringify(collectLibrary(packages, read)), JSON.stringify(library), 'the same checkout, the same library');
    assert.equal(createLibraryIndex(library).search('veto review approve', 3)[0].doc, 'radiant-os');
  });

  it('leaves out a package with no README, and refuses a build without its guide', () => {
    const files: Record<string, string> = { [GUIDE]: '# Guide\n\nHello.', 'packages/a/README.md': '# A thing\n\nWords.', 'packages/a/package.json': '{"name":"@tangleai/a"}', 'packages/b/package.json': '{"name":"@tangleai/b"}' };
    const library = collectLibrary(['packages/a', 'packages/b'], (p) => files[p] ?? null);
    assert.deepEqual(library.docs.map((d) => [d.id, d.title]), [['radiant-os', 'Radiant OS field guide'], ['a', 'A thing']]);
    assert.throws(() => collectLibrary([], () => null), /needs its guide/);
  });
});
