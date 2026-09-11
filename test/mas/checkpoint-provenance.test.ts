import { it } from 'node:test';
import assert from 'node:assert/strict';
import { defineDag, edge, input, output, task } from '@jarenjs/linq/flow';
import { executeDagRegion } from '../../packages/mas/src/dag-runtime.ts';
import type {} from '../../packages/mas/src/jaren-flow.d.ts';

it('restores identical region inputs but refuses changed inputs, revisions and unversioned checkpoints before work', async () => {
  const document = defineDag({
    nodes: { scope: input(), 't:work': task('work', undefined, { version: 'test/1' }).checkpoint(), expose: output() },
    edges: [edge('scope', 't:work'), edge('t:work', 'expose', { port: 'work' })],
  });
  const values: Record<string, unknown> = {};
  let calls = 0;
  const run = {
    document, taskVersion: 'test/1', executableRevision: 'revision-1',
    handlers: { work: async () => { calls++; return { result: 'paid' }; } },
    scope: { input: 'original', nodes: {} }, segmentJobId: 'segment-1',
    signal: new AbortController().signal, region: { branch: '', iteration: 0 },
    checkpoints: {
      load: () => Object.keys(values).length === 0 ? null : { values: structuredClone(values) },
      save: (_id: string, node: string, value: unknown) => { values[node] = structuredClone(value); },
      complete: () => {},
    },
  };
  assert.equal((await executeDagRegion(run)).ok, true);
  assert.equal((await executeDagRegion(run)).ok, true);
  assert.equal(calls, 1);
  for (const changed of [{ ...run, scope: { input: 'changed', nodes: {} } }, { ...run, executableRevision: 'revision-2' }]) {
    const result = await executeDagRegion(changed);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.error.code, 'TMAS2002');
  }
  values['t:work'] = { result: 'unverified old checkpoint' };
  const legacy = await executeDagRegion(run);
  assert.equal(legacy.ok, false);
  assert.equal(calls, 1);
});
