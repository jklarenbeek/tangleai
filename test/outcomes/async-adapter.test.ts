import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createExactMatchAdapter } from '@tangleai/outcomes/adapters/exact-match';
import { lifecycleFixture } from './guarded-fixtures.ts';
import { value, scopeId, revision, LATER } from './fixtures.ts';

it('awaits pure asynchronous interpreters through evaluation, activation and checked decision reproduction', async () => {
  const base = await createExactMatchAdapter(), adapter = { ...base,interpret: async (...args: Parameters<typeof base.interpret>) => base.interpret(...args) };
  const f = await lifecycleFixture({ host: { adapters: [adapter] } }), root = await f.root();
  assert.equal(value(root.result).eligible,true);
  const checked = value(await f.service.injectChecked({ scopeId,artifactKey: 'a',input: {} }));
  assert.equal(checked.versionId,root.versionId);
  const input = { token: 'accept:next' }, output = await adapter.interpret(input,checked.payload);
  const result = await f.service.create(f.command('async-checked',{ decisionKey: 'async-checked',adapter: adapter.identity,input,output,decidedAt: LATER,cutoffAt: LATER,expectedResolutionAt: LATER,memoryIds: [],configuration: { kind: 'scripted',revision },usedVersionId: root.versionId,staticPayload: adapter.staticPayload }));
  assert.ok(result.ok,JSON.stringify(result));
});
it('counts an asynchronous interpreter rejection as an ineligible held-out result', async () => {
  const base = await createExactMatchAdapter(), adapter = { ...base,interpret: async () => { throw Error('unavailable interpretation'); } };
  const f = await lifecycleFixture({ host: { adapters: [adapter] } }), staged = await f.stage(), evaluated = await f.evaluate(staged.versionId);
  assert.equal(value(evaluated.result).eligible,false);
  const record = await f.inspect(evaluated.evaluationId);
  assert.match(JSON.stringify(record.issues),/Held-out case could not be scored/);
});
