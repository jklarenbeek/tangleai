import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGrammarAuthor } from '@tangleai/models/grammar';
import { createRoutedClient } from '@tangleai/models/routing';
import { createBudgetAccount } from '@tangleai/agents/recursive';
import { checkOutcome } from '@jarenjs/core/check';
import { compileJsonQuery } from '@jarenjs/json/query';
import { compileJsltStylesheet } from '@jarenjs/json/jslt';
import { compileFsm, compileDag, compileStatechart, compileWorkflow } from '@jarenjs/flow';
import { normalizeModel, normalizeEntities } from '@jarenjs/db';
import { JarenValidator } from '@jarenjs/validate';
const AUTHORING_PROFILES = [
  {
    "package": "db",
    "grammar": "model"
  },
  {
    "package": "json",
    "grammar": "query"
  },
  {
    "package": "json",
    "grammar": "jslt"
  },
  {
    "package": "app",
    "grammar": "app"
  },
  {
    "package": "flow",
    "grammar": "fsm"
  },
  {
    "package": "flow",
    "grammar": "dag"
  },
  {
    "package": "flow",
    "grammar": "statechart"
  },
  {
    "package": "flow",
    "grammar": "workflow"
  }
];

const read = (pkg: any, name: any, suffix = '') => JSON.parse(readFileSync(new URL(import.meta.resolve(`@jarenjs/${pkg}/schemas/jaren-${name}${suffix}.schema.json`)), 'utf8'));
const query = read('json', 'query');
const jslt = read('json', 'jslt');
const dag = read('flow', 'dag');
const corpus = {
  model: [{ $model: '0.1', collections: { notes: { schema: { type: 'object' }, key: '/id' } } }],
  query: [{ $sum: '$.prices[*]' }, { $for: { r: '$.records[*]' }, $return: '$r.id' }],
  jslt: [[{ match: '$', body: { total: { $sum: '$.prices[*]' } } }]],
  app: [{ state: { count: 0 }, view: [{ match: '$', body: { tag: 'div', children: ['hello'] } }], actions: { inc: { state: { count: { $add: ['$.count', 1] } } } } }],
  fsm: [{ initial: 'idle', states: ['idle', 'done'], transitions: [{ from: 'idle', to: 'done', event: 'GO' }] }],
  dag: [{ $dag: '0.1', nodes: { input: { kind: 'input' }, output: { kind: 'output' } }, edges: [{ from: 'input', to: 'output' }] }],
  statechart: [{ $fsm: '0.2', initial: 'idle', states: ['idle', { id: 'done', final: true }], transitions: [{ from: 'idle', to: 'done', after: 10 }] }],
  workflow: [{ $workflow: '0.2', revision: '1', initial: 'done', states: { done: { final: true } } }],
};
const compilers = {
  model: (doc: any) => { normalizeModel(doc); normalizeEntities(doc); }, query: compileJsonQuery, jslt: compileJsltStylesheet, fsm: compileFsm, dag: compileDag,
  statechart: compileStatechart, workflow: compileWorkflow,
  app: (doc: any) => { compileJsltStylesheet(doc.view); Object.values(doc.actions ?? {}).forEach((action: any) => compileJsonQuery(action)); }
};

describe('generated grammar profiles', () => {
  for (const entry of AUTHORING_PROFILES) {
    it(`${entry.grammar} profile corpus also passes full validation and compilation`, async () => {
      const schema = read(entry.package, entry.grammar);
      const profile = read(entry.package, entry.grammar, '.authoring');
      const full = new JarenValidator({ skipErrors: false });
      if (schema.$id !== query.$id) full.addSchema(query); if (schema.$id !== jslt.$id) full.addSchema(jslt);
      if (schema.$id !== dag.$id) full.addSchema(dag);
      const check = full.compile(schema);
      for (const doc of corpus[entry.grammar as keyof typeof corpus]) {
        assert.equal(checkOutcome(check(doc)).valid, true);
        const requests: any[] = [];
        const client = {
          endpoint: { provider: 'openrouter' }, complete: async (request: any) => {
            requests.push(request); return { message: { content: JSON.stringify(doc) } };
          }
        };
        const author = createGrammarAuthor(({
          client, grammar: entry.grammar, schema, profile,
          refs: [query, jslt, ...(entry.grammar === 'workflow' ? [dag] : [])].filter((ref: any) => ref.$id !== schema.$id), compile: compilers[entry.grammar as keyof typeof compilers]
        } as any));
        const result = await author.author('fixture');
        assert.deepEqual(result.value, doc, JSON.stringify(result));
        assert.equal(requests[0].responseFormat.schema.$id, profile.$id);
      }
    });
  }
  it('never accepts a profile-only value that the full grammar rejects', async () => {
    const author = createGrammarAuthor({
      grammar: 'query', profile: read('json', 'query', '.authoring'), schema: query,
      compile: compileJsonQuery, maxRepairs: 0,
      client: { endpoint: { provider: 'openrouter' }, complete: async () => ({ message: { content: '{"$invented":1}' } }) }
    });
    assert.equal((await author.author('test')).value, undefined);
  });
});

describe('injected model routing', () => {
  const client = (complete: any) => ({ endpoint: { provider: 'openrouter' }, complete });
  it('routes all grammar author calls and subcalls with observable, bounded fallbacks', async () => {
    for (const grammar of ['program', 'query', 'jslt', 'app', 'fsm', 'dag']) {
      const seen: any[] = []; const events: any[] = [];
      const successful = client(async (request: any) => { seen.push(request); return { message: { content: '{}' }, usage: { total_tokens: 4 } }; });
      const router = createRoutedClient({
        client: successful, limits: { deadlineMs: 5, outputTokens: 30, reasoningTokens: 10 },
        selectModel: (context) => {
          assert.equal(context.grammar, grammar); return [
            { client: client(() => new Promise(() => { })), identity: 'slow' }, { client: successful, identity: 'fallback' },
          ];
        }, onRoute: (event: any) => events.push(event)
      }, { purpose: 'author', grammar, depth: 2 });
      await router.complete({ messages: [], maxTokens: 100 });
      assert.equal(seen[0].maxTokens, 30);
      assert.equal(seen[0].reasoning.max_tokens, 10);
      assert.deepEqual(events.map((event: any) => event.outcome), ['timeout', 'complete']);
    }
  });
  it('charges each fallback against the same account and stops at the turn limit', async () => {
    let calls = 0;
    const dead = client(async () => { calls++; throw new Error('transport'); });
    const account = createBudgetAccount({ turns: 1 });
    const router = createRoutedClient({
      client: dead, account,
      selectModel: () => [{ client: dead, identity: 'first' }, { client: dead, identity: 'second' }]
    }, { purpose: 'subcall' });
    await assert.rejects(router.complete({ messages: [] }), /budget-turns/);
    assert.equal(calls, 1); assert.equal(account.spent().turns, 1);
  });
  it('refuses tool replay, embedding fallback, provider token overruns and cancellation', async () => {
    const endpoint = client(async () => ({ message: { content: 'ok' }, usage: { completion_tokens: 50 } }));
    const router = createRoutedClient({ client: endpoint, limits: { outputTokens: 10 } }, { purpose: 'subcall' });
    await assert.rejects(router.complete({ tools: [{}] }), /tool-bearing/);
    await assert.rejects(router.complete({ messages: [] }), /ceiling/);
    assert.throws(() => createRoutedClient({ client: endpoint }, { purpose: 'embedding' }), /chat routing/);
    await assert.rejects(router.complete({ messages: [], signal: AbortSignal.abort() }));
  });
});
