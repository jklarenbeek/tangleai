import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { changedLeafPaths, preparePayload, DEFAULT_OUTCOME_POLICY } from '@tangleai/outcomes';
import { createExactMatchAdapter } from '@tangleai/outcomes/adapters/exact-match';
import { adapterIdentity } from '../../packages/outcomes/src/domain.ts';
import { persistenceFor } from '../../packages/outcomes/src/store.ts';
import { lifecycleFixture } from './guarded-fixtures.ts';
import { code, value, id, scopeId, revision } from './fixtures.ts';
import type { OutcomeAdapter, Json, ReflectInput } from '@tangleai/outcomes';

describe('guarded outcome payload preparation', () => {
  it('counts removed leaves, empty containers and array indices once', () => {
    assert.equal(changedLeafPaths({}, Object.fromEntries(Array.from({ length: 100 }, (_, i) => [String(i), i]))).length, 101);
    assert.deepEqual(changedLeafPaths({ a: [] }, { a: [1, 2] }), ['/a', '/a/0', '/a/1']);
    assert.deepEqual(changedLeafPaths([1, 2], [2, 1]), ['/0', '/1']);
    assert.deepEqual(changedLeafPaths({ a: 1, b: 2 }, { b: 2, a: 1 }), []);
  });
  it('stages roots without activating, and completed replay adds no retained version', async () => {
    const f = await lifecycleFixture(), staged = await f.stage();
    code(await f.service.injectChecked({ scopeId, artifactKey: 'a', input: {} }), 'OUTC1004');
    const again = await f.service.reflect(staged.command); assert.ok(again.ok && again.replayed); assert.equal(again.writes, 0); assert.equal(id(again, 'versionId'), staged.versionId);
    assert.equal((await persistenceFor(f.store).transaction(tx => tx.query('records', { scopeId, kind: 'artifactVersion' }))).length, 1);
  });
  it('admits ten retained candidates and refuses the eleventh without evaluating anything', async () => {
    const f = await lifecycleFixture();
    for (let i = 0; i < 10; i++) await f.stage(String(i));
    code(await f.service.reflect(f.command('eleven', f.input())), 'OUTC1014'); assert.equal(f.deliveries(), 0);
  });
  it('denies envelope, prototype and invalid pointer edits, while a no-op child has no version', async () => {
    const f = await lifecycleFixture(), root = await f.root();
    for (const path of ['/scopeId', '/policy', '/__proto__/x', '/rules/0/constructor', '/fallbackLabel~2']) {
      const input = f.input({ mode: 'evolve', parentVersionId: root.versionId, payload: null, patch: [{ op: 'replace', path, value: 'x' }] });
      code(await f.service.reflect(f.command(path, input)), 'OUTC1009');
    }
    const result = await f.service.reflect(f.command('noop', f.input({ mode: 'evolve', parentVersionId: root.versionId, payload: null, patch: [{ op: 'test', path: '/fallbackLabel', value: 'unknown' }] })));
    assert.equal(value(result).noOp, true); assert.equal(value(result).versionId, null);
    assert.equal(value(await f.service.injectChecked({ scopeId, artifactKey: 'a', input: {} })).versionId, root.versionId);
  });
  it('retains schema-valid semantic refusals for inspection', async () => {
    const f = await lifecycleFixture(), staged = await f.stage('duplicate', { payload: { fallbackLabel: 'no', rules: [{ prefix: 'a', label: 'x' }, { prefix: 'a', label: 'y' }] } });
    const record = await f.inspect(staged.versionId); assert.equal((record.issues as Json[]).length, 1);
    const evaluated = await f.evaluate(staged.versionId); assert.equal(value(evaluated.result).eligible, false);
  });
  it('tests byte, operation and leaf limits at their boundary and one beyond', async () => {
    const schema = { type: 'object', additionalProperties: { type: 'string' } };
    const schemas = { input: schema, output: schema, resolution: schema, artifact: schema };
    const adapter: OutcomeAdapter = { identity: await adapterIdentity('bounds/v1', schemas, {}), schemas, staticPayload: {}, score: () => ({ outcome: 'success', diagnostics: {} }), interpret: x => x, validatePayload: () => [] };
    const input: ReflectInput = { mode: 'create', scoreIds: ['a'.repeat(64)], parentVersionId: null, payload: {}, patch: [], text: '', citations: ['a'.repeat(64)], configuration: { kind: 'scripted', revision } };
    const policy = { ...DEFAULT_OUTCOME_POLICY, maxPayloadBytes: 16 };
    assert.equal(new TextEncoder().encode(JSON.stringify({ a: '😀😀' })).length, 16);
    preparePayload(adapter, policy, {}, { ...input, payload: { a: '😀😀' } });
    assert.throws(() => preparePayload(adapter, policy, {}, { ...input, payload: { a: '😀😀x' } }), (e: unknown) => e instanceof Error && 'code' in e && e.code === 'OUTC1009');
    preparePayload(adapter, DEFAULT_OUTCOME_POLICY, {}, { ...input, text: '😀'.repeat(2048) });
    assert.throws(() => preparePayload(adapter, DEFAULT_OUTCOME_POLICY, {}, { ...input, text: '😀'.repeat(2048) + 'x' }));
    const patch = Array.from({ length: 32 }, () => ({ op: 'test' as const, path: '/a', value: 'x' }));
    preparePayload(adapter, DEFAULT_OUTCOME_POLICY, { a: 'x' }, { ...input, mode: 'evolve', payload: null, patch });
    assert.throws(() => preparePayload(adapter, DEFAULT_OUTCOME_POLICY, { a: 'x' }, { ...input, mode: 'evolve', payload: null, patch: [...patch, patch[0]] }));
    for (const count of [31, 32]) {
      const plan = preparePayload(adapter, DEFAULT_OUTCOME_POLICY, {}, { ...input, payload: Object.fromEntries(Array.from({ length: count }, (_, i) => [String(i), 'x'])) });
      assert.equal(plan.changed.length, count + 1); assert.equal(plan.issues.length, count === 31 ? 0 : 1);
    }
  });
});
