/**
 * The check-composition seam: `composeChecks` runs checks in order and
 * the first invalid outcome wins, so "validates against the schema AND
 * compiles" is one injected validator. Deliberately engine-agnostic —
 * a compile gate over ANY Jaren engine composes the same way, and the
 * structured-output error normalizer keeps each engine's `code` and
 * `docPath` through the repair loop.
 */
import { describe, it } from 'node:test';
import * as assert from 'node:assert';

import { createChatClient } from '@tangleai/models/client';
import { createStructuredOutput } from '@tangleai/models/structured';
import { composeChecks } from '@jarenjs/core/check';
import { JarenValidator } from '@jarenjs/validate';
import { compileJsonQuery } from '@jarenjs/json/query';
import { compileJsltStylesheet } from '@jarenjs/json/jslt';

/** A client whose fetch replies with each scripted content in turn. */
function scriptedClient(replies: any) {

  const sent: any[] = [];
  let call = 0;
  const client = createChatClient({
    provider: 'openrouter', model: 'm',
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

/**
 * The two-line compile-gate adapter the docs recommend, over any Jaren
 * engine: compile succeeds → true; a compile error → an outcome
 * carrying the engine's code + docPath.
 */
function compileGate(compile: any) {
  return (doc: any) => {
    try {
      compile(doc);
      return true;
    }
    catch (err: any) {
      const e = (err as any);
      return { valid: false, errors: [{ code: e.code, docPath: e.docPath, message: e.message }] };
    }
  };
}

describe('ai — the compile-error repair loop is engine-agnostic', function () {
  /** Drive a broken-then-fixed transcript through composeChecks + repair. */
  async function repairRun({ schema, compile, broken, fixed }: { schema: any; compile: any; broken: any; fixed: any; }) {
    const { client, sent } = scriptedClient([JSON.stringify(broken), JSON.stringify(fixed)]);
    const out = createStructuredOutput({
      client, schema, name: 'doc',
      validator: composeChecks(
        new JarenValidator({ collectErrors: true }).compile(schema),
        compileGate(compile)),
    });
    const result = await out.generate([{ role: 'user', content: 'author it' }]);
    return { result: (result as any), repairPrompt: sent[1].messages.at(-1).content };
  }

  it('query: a compile-broken document repairs, and the JQ code + docPath reach the prompt', async function () {
    // `$get` needs two operands; one is a compile-time arity error
    const { result, repairPrompt } = await repairRun({
      schema: { type: 'object' },
      compile: compileJsonQuery,
      broken: { $get: ['$.x'] },
      fixed: { $get: ['$.x', 0] },
    });
    assert.deepStrictEqual(result.value, { $get: ['$.x', 0] });
    assert.strictEqual(result.attempts, 2);
    assert.match(repairPrompt, /"code":"JQ/, 'the query engine code reached the model');
    assert.match(repairPrompt, /"docPath":/, 'the docPath reached the model');
  });

  it('jslt: a compile-broken stylesheet repairs, and the JT code reaches the prompt', async function () {
    const { result, repairPrompt } = await repairRun({
      schema: { type: 'array' },
      compile: compileJsltStylesheet,
      broken: [{ match: 5, body: '$' }],   // a numeric match is a JT compile error
      fixed: [{ match: '$', body: '$' }],
    });
    assert.deepStrictEqual(result.value, [{ match: '$', body: '$' }]);
    assert.match(repairPrompt, /"code":"JT/, 'a DIFFERENT engine\'s code flows identically');
  });

  it('normalizeErrors keeps code+docPath for a compile error and stays flat for a schema error', async function () {
    // a pure schema failure (no code/docPath) still normalizes cleanly
    const { client, sent } = scriptedClient(['{"age":-1}', '{"age":5}']);
    const schema = { type: 'object', properties: { age: { type: 'integer', minimum: 0 } }, required: ['age'] };
    const out = createStructuredOutput({ client, schema });
    await out.generate([{ role: 'user', content: 'x' }]);
    const prompt = sent[1].messages.at(-1).content;
    assert.match(prompt, /"instancePath":"\/age"/);
    assert.doesNotMatch(prompt, /"code":/, 'a schema error carries no engine code');
  });
});
