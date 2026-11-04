/**
 * Structured output: the wire shape per provider tier, the local
 * validation gate, the bounded repair loop — and the marquee pipeline,
 * generating a Jaren query document constrained by the real published
 * schema twin and compiling it with the real engine.
 */
import { describe, it } from 'node:test';
import * as assert from 'node:assert';

import { createChatClient } from '@tangleai/models/client';
import { createStructuredOutput } from '@tangleai/models/structured';
import { AiError } from '@tangleai/models/errors';
import { compileJsonQuery } from '@jarenjs/json/query';
import querySchema from '@jarenjs/json/schemas/jaren-query.schema.json' with { type: 'json' };

/** A client whose fetch replies with each scripted content in turn. */
function scriptedClient(provider: any, replies: any) {

  const sent: any[] = [];
  let call = 0;
  const client = createChatClient({
    provider, model: 'm', baseUrl: provider === 'custom' ? 'https://x.test/v1' : undefined,
    retry: { attempts: 1 },
    fetch: (url: any, init: any) => {
      sent.push(JSON.parse(init.body));
      const content = replies[Math.min(call++, replies.length - 1)];
      return Promise.resolve(new Response(
        JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 }));
    },
  });
  return { client, sent };
}

const SCHEMA = {
  type: 'object',
  properties: { name: { type: 'string' }, age: { type: 'integer', minimum: 0 } },
  required: ['name', 'age'],
  additionalProperties: false,
};

describe('ai — structured output', function () {
  it('openrouter tier: json_schema response_format, no prompt embedding', async function () {
    const { client, sent } = scriptedClient('openrouter', ['{"name":"Ada","age":36}']);
    const out = createStructuredOutput({ client, schema: SCHEMA, name: 'person' });
    const result = await out.generate([{ role: 'user', content: 'Ada, 36' }]);
    assert.deepStrictEqual((result as any).value, { name: 'Ada', age: 36 });
    assert.strictEqual((result as any).attempts, 1);

    assert.deepStrictEqual(sent[0].response_format, {
      type: 'json_schema',
      json_schema: { name: 'person', schema: SCHEMA, strict: true },
    });
    assert.strictEqual(sent[0].stream, false);
    assert.strictEqual(sent[0].messages[0].role, 'user', 'no schema instruction injected');
  });

  it('ollama tier: json_object mode plus the schema in a system instruction', async function () {
    const { client, sent } = scriptedClient('ollama', ['{"name":"Bo","age":7}']);
    const out = createStructuredOutput({ client, schema: SCHEMA });
    const result = await out.generate([{ role: 'user', content: 'Bo, 7' }]);
    assert.deepStrictEqual((result as any).value, { name: 'Bo', age: 7 });

    assert.deepStrictEqual(sent[0].response_format, { type: 'json_object' });
    assert.strictEqual(sent[0].messages[0].role, 'system');
    assert.match(sent[0].messages[0].content, /JSON Schema/);
    assert.match(sent[0].messages[0].content, /"required":\["name","age"\]/);
  });

  it('custom tier: no response_format at all, schema in the prompt', async function () {
    const { client, sent } = scriptedClient('custom', ['{"name":"Cy","age":1}']);
    const out = createStructuredOutput({ client, schema: SCHEMA });
    await out.generate([{ role: 'user', content: 'Cy' }]);
    assert.strictEqual(sent[0].response_format, undefined);
    assert.strictEqual(sent[0].messages[0].role, 'system');
  });

  it('repairs an invalid reply with instancePath errors, then succeeds', async function () {
    const { client, sent } = scriptedClient('openrouter', [
      '{"name":"Dee","age":-1}',
      '{"name":"Dee","age":31}',
    ]);
    const out = createStructuredOutput({ client, schema: SCHEMA });
    const result = await out.generate([{ role: 'user', content: 'Dee' }]);
    assert.deepStrictEqual((result as any).value, { name: 'Dee', age: 31 });
    assert.strictEqual((result as any).attempts, 2);

    // the repair turn carried the assistant's bad reply + the errors
    const repair = sent[1].messages;
    assert.strictEqual(repair[repair.length - 2].role, 'assistant');
    assert.match(repair[repair.length - 1].content, /"instancePath":"\/age"/);
  });

  it('unfences a code-fenced reply before parsing', async function () {
    const { client } = scriptedClient('custom', ['```json\n{"name":"Ed","age":9}\n```']);
    const out = createStructuredOutput({ client, schema: SCHEMA });
    const result = await out.generate([{ role: 'user', content: 'Ed' }]);
    assert.deepStrictEqual((result as any).value, { name: 'Ed', age: 9 });
  });

  it('gives up after maxRepairs with the errors and the raw text', async function () {
    const { client, sent } = scriptedClient('openrouter', ['not json at all']);
    const out = createStructuredOutput({ client, schema: SCHEMA, maxRepairs: 2 });
    const result = await out.generate([{ role: 'user', content: 'x' }]);
    assert.strictEqual((result as any).value, undefined);
    assert.strictEqual((result as any).attempts, 3);
    assert.strictEqual(sent.length, 3);
    assert.match((result as any).errors[0].message, /not JSON/);
    assert.strictEqual((result as any).raw, 'not json at all');
  });

  it('end to end: a generated query document validates against the published twin and compiles', async function () {
    // the marquee pipeline from the json README, as one function call:
    // constrained generation → local validation → compile → run
    const queryDoc = {
      $for: { b: '$.books[*]' },
      $where: { $gt: ['$b.price', 10] },
      $return: '$b.price',
    };
    const { client } = scriptedClient('openrouter', [JSON.stringify(queryDoc)]);
    const out = createStructuredOutput({ client, schema: querySchema, name: 'jaren_query' });
    const result = await out.generate([
      { role: 'user', content: 'prices over 10' },
    ]);
    const value = (result as any).value;
    assert.deepStrictEqual(value, queryDoc, 'validated against the real jaren-query schema');

    const fn = compileJsonQuery(value);
    const run = fn({ books: [{ price: 5 }, { price: 15 }, { price: 40 }] });
    assert.deepStrictEqual(run, [15, 40]);
  });

  it('the `gate` option adds a compile check after schema validation, and repairs it', async function () {
    // the reliable engine-document recipe: the schema keeps the SHAPE
    // (and drives constrained decoding), a compile gate keeps the
    // SEMANTICS. First reply is a structurally-fine object that does
    // NOT compile (unknown operator); second reply compiles.
    const { client, sent } = scriptedClient('openrouter', [
      '{"$bogus":[1]}',
      '{"$add":[1,2]}',
    ]);
    const compileGate = (doc: any) => {
      try { compileJsonQuery(doc); return true; }
      catch (e: any) { return { valid: false, errors: [{ code: e.code, docPath: e.docPath, message: e.message }] }; }
    };
    const out = createStructuredOutput({
      client, schema: { type: 'object' }, name: 'jaren_query',
      gate: compileGate, maxRepairs: 2,
    });
    const result = (await out.generate([{ role: 'user', content: 'a query' }]) as any);
    assert.deepStrictEqual(result.value, { $add: [1, 2] });
    assert.strictEqual(result.attempts, 2);
    // the compile error's code + docPath reached the model in the repair turn
    const repair = sent[1].messages.at(-1).content;
    assert.match(repair, /"code":"JQ/, 'the query engine\'s compile code drives the repair');

    // a schema-valid AND compilable document passes in one shot
    const clean = scriptedClient('openrouter', ['{"$add":[1,2]}']);
    const ok = createStructuredOutput({ client: clean.client, schema: { type: 'object' }, gate: compileGate });
    const r2 = (await ok.generate([{ role: 'user', content: 'x' }]) as any);
    assert.deepStrictEqual(r2.value, { $add: [1, 2] });
    assert.strictEqual(r2.attempts, 1);
  });

  it('`refs` lets the internal validator resolve a composed schema (the real jaren-fsm case)', async function () {
    // a schema that $refs another by $id — exactly the shape of every
    // jaren engine-document grammar. Without `refs` the internal compile
    // throws "Can not resolve schema".
    const inner = { $id: 'https://example.test/inner', type: 'object', required: ['k'], properties: { k: { type: 'string' } } };
    const outer = { type: 'object', required: ['item'], properties: { item: { $ref: 'https://example.test/inner' } } };
    const { client } = scriptedClient('openrouter', ['{"item":{"k":"ok"}}']);
    assert.throws(
      () => createStructuredOutput({ client, schema: outer }),
      /Can not resolve schema/, 'without refs it cannot compile the composed schema');
    const out = createStructuredOutput({ client, schema: outer, refs: [inner], maxRepairs: 1 });
    const r = (await out.generate([{ role: 'user', content: 'x' }]) as any);
    assert.deepStrictEqual(r.value, { item: { k: 'ok' } });
  });

  it('`gate` accepts an array of checks, run in order after the schema', async function () {
    const { client } = scriptedClient('openrouter', ['{"n":4}']);
    const positive = (v: any) => (v.n > 0 ? true : { valid: false, errors: [{ message: 'not positive' }] });
    const even = (v: any) => (v.n % 2 === 0 ? true : { valid: false, errors: [{ message: 'not even' }] });
    const out = createStructuredOutput({
      client, schema: { type: 'object', properties: { n: { type: 'integer' } } },
      gate: [positive, even],
    });
    const r = (await out.generate([{ role: 'user', content: 'x' }]) as any);
    assert.deepStrictEqual(r.value, { n: 4 });
  });
});

/** A client object answering each scripted reply in turn and keeping every request. */
function replies(...answers: any[]) {
  const sent: any[] = [];
  return {
    sent,
    client: {
      endpoint: { provider: 'custom', structured: null },
      complete: async (request: any) => {
        sent.push(request);
        const answer = answers[Math.min(sent.length - 1, answers.length - 1)];
        return typeof answer === 'string' ? { message: { content: answer }, finishReason: 'stop', usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } } : answer;
      },
    },
  };
}

describe('ai — structured output results', function () {
  it('every failure is one record shape with a stage, a code and a path, beside the counts of every call', async function () {
    const { client } = replies('not json', '{"name":"Ada"}');
    const result = await createStructuredOutput({ client, schema: SCHEMA, maxRepairs: 1 }).generate([{ role: 'user', content: 'Ada' }]);
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.errors![0], { instancePath: '', keyword: 'required', message: result.errors![0].message, stage: 'schema', code: 'required', path: '' });
    assert.deepStrictEqual(result.calls.map((call) => call.outcome), ['parse', 'schema']);
    assert.deepStrictEqual(result.usage, { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24 });
    assert.strictEqual(result.finishReason, 'stop');

    const parse = await createStructuredOutput({ client: replies('nope').client, schema: SCHEMA, maxRepairs: 0 }).generate([]);
    assert.deepStrictEqual({ ...parse.errors![0], message: '' }, { instancePath: '', keyword: 'parse', message: '', stage: 'parse', code: 'parse', path: '' });

    const gate = await createStructuredOutput({
      client: replies('{"name":"Ada","age":3}').client, schema: SCHEMA, maxRepairs: 0,
      gate: () => ({ valid: false, errors: [{ code: 'JQ0002', docPath: '/age', message: 'too young' }] }),
    }).generate([]);
    assert.deepStrictEqual(gate.errors, [{ instancePath: '/age', keyword: 'JQ0002', message: 'too young', code: 'JQ0002', docPath: '/age', stage: 'gate', path: '/age' }]);
  });

  it('a reply cut off at the token limit, or one of reasoning only, is reported as truncated and never repaired', async function () {
    const cut = replies({ message: { content: '{"name":"Ad' }, finishReason: 'length', usage: { prompt_tokens: 9, completion_tokens: 64, total_tokens: 73 } });
    const result = await createStructuredOutput({ client: cut.client, schema: SCHEMA, maxRepairs: 2 }).generate([]);
    assert.strictEqual(cut.sent.length, 1, 'no repair goes out with the same budget');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.attempts, 1);
    assert.deepStrictEqual([result.errors![0].stage, result.errors![0].code, result.finishReason], ['truncated', 'truncated', 'length']);
    // a complete-looking value is still refused: a number cut short parses
    const short = await createStructuredOutput({ client: replies({ message: { content: '{"name":"Ada","age":3}' }, finishReason: 'length' }).client, schema: SCHEMA }).generate([]);
    assert.strictEqual(short.ok, false);
    const thinking = replies({ message: { content: '', reasoning: 'Let me consider the schema…' }, finishReason: 'stop' });
    const events: any[] = [];
    const thought = await createStructuredOutput({ client: thinking.client, schema: SCHEMA, onAttempt: (event) => events.push(event) }).generate([]);
    assert.strictEqual(thinking.sent.length, 1);
    assert.match(thought.errors![0].message, /reasoning and no content/);
    assert.deepStrictEqual(events.map((event) => [event.outcome, event.finishReason]), [['truncated', 'stop']]);
  });

  it('a passing gate hands back what it computed', async function () {
    const single = await createStructuredOutput({
      client: replies('{"name":"Ada","age":36}').client, schema: SCHEMA, gate: (value: any) => ({ valid: true, data: { decade: Math.floor(value.age / 10) } }),
    }).generate([]);
    assert.deepStrictEqual([single.ok, single.gateData], [true, { decade: 3 }]);
    const many = await createStructuredOutput({
      client: replies('{"name":"Ada","age":36}').client, schema: SCHEMA, gate: [() => true, () => ({ valid: true, data: 7 })],
    }).generate([]);
    assert.deepStrictEqual(many.gateData, [undefined, 7]);
  });

  it('the tier comes from the client unless the generator names one', async function () {
    const { client, sent } = scriptedClient('openrouter', ['{"name":"Ada","age":36}']);
    await createStructuredOutput({ client, schema: SCHEMA, tier: null }).generate([{ role: 'user', content: 'x' }]);
    assert.strictEqual(sent[0].response_format, undefined);
    assert.match(sent[0].messages[0].content, /validates against this JSON Schema/);
    const stated = createChatClient({ provider: 'openrouter', model: 'm', structured: null, retry: { attempts: 1 },
      fetch: async (_url: any, init: any) => { sent.push(JSON.parse(init.body)); return Response.json({ choices: [{ message: { content: '{"name":"Ada","age":36}' } }] }); } });
    await createStructuredOutput({ client: stated, schema: SCHEMA }).generate([{ role: 'user', content: 'x' }]);
    assert.strictEqual(sent[1].response_format, undefined, 'the client stated the model speaks no json_schema');
  });

  it('lenient parsing reads the JSON a reply wraps in prose; strict does not', async function () {
    const prose = 'Sure — here it is: {"name":"Ada {the first}","age":36} Hope that helps.';
    const lenient = await createStructuredOutput({ client: replies(prose).client, schema: SCHEMA, parse: 'lenient' }).generate([]);
    assert.deepStrictEqual(lenient.value, { name: 'Ada {the first}', age: 36 });
    const strict = await createStructuredOutput({ client: replies(prose).client, schema: SCHEMA, maxRepairs: 0 }).generate([]);
    assert.strictEqual(strict.errors![0].stage, 'parse');
  });

  it('a generation deadline bounds every call and repair together, even over a client that ignores signals', async function () {
    const hung = { endpoint: { provider: 'custom' }, complete: () => new Promise(() => { }) };
    await assert.rejects(createStructuredOutput({ client: hung, schema: SCHEMA, deadlineMs: 20 }).generate([]),
      (err: any) => err instanceof AiError && err.code === 'AI0004' && err.outcome === 'timeout' && err.deadlineMs === 20);
    await assert.rejects(createStructuredOutput({ client: hung, schema: SCHEMA }).generate([], { deadlineMs: 0 }),
      (err: any) => err instanceof AiError && err.code === 'AI0001');
  });

  it('bundle sends one self-contained schema and validates against the original', async function () {
    const wrapper = { type: 'object', required: ['filter'], properties: { filter: { $ref: 'https://example.test/shared#/$defs/flag' } } };
    const shared = { $id: 'https://example.test/shared', $defs: { flag: { type: 'boolean' } } };
    const { client, sent } = scriptedClient('openrouter', ['{"filter":true}']);
    const result = await createStructuredOutput({ client, schema: wrapper, refs: [shared], bundle: true }).generate([{ role: 'user', content: 'x' }]);
    assert.strictEqual(result.ok, true);
    const wire = sent[0].response_format.json_schema.schema;
    assert.strictEqual(wire.properties.filter.$ref, '#/$defs/shared.flag');
    assert.deepStrictEqual(wire.$defs, { 'shared.flag': { type: 'boolean' } }, 'an empty resource root nobody points at is left out');
  });
});
