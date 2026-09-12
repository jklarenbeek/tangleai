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

it('identifies the executed mechanisms and refuses legacy checkpoints without writes or repeated effects', async () => {
  const { masTaskVersionOf } = await import('../../packages/mas/src/lower.ts');
  const { masRevisionOf } = await import('@tangleai/mas');
  const flow = (await import('@jarenjs/flow/package.json', { with: { type: 'json' } })).default;
  const models = (await import('@tangleai/models/package.json', { with: { type: 'json' } })).default;
  const context = (await import('@tangleai/context/package.json', { with: { type: 'json' } })).default;
  const agents = (await import('@tangleai/agents/package.json', { with: { type: 'json' } })).default;
  const current = masTaskVersionOf('registry-1');
  assert.equal(current, `tangle-mas/3:flow/${flow.version}:models/${models.version}:context/${context.version}:agents/${agents.version}:registry-1`);
  assert.notEqual(masTaskVersionOf('registry-2'), current);
  const values: Record<string, unknown> = {};
  let calls = 0, writes = 0;
  const ledger: Array<{ id: string, text: string, evidence: string }> = [];
  const run = async (taskVersion: string) => {
    const document = defineDag({ nodes: { scope: input(), work: task('work', undefined, { version: taskVersion }).checkpoint(), expose: output() },
      edges: [edge('scope', 'work'), edge('work', 'expose')] });
    return executeDagRegion({ document, taskVersion, executableRevision: await masRevisionOf({ document, taskVersion }),
      handlers: { work: async () => { calls++; ledger.push({ id: 'effect', text: 'completed', evidence: 'tool result' }); return { result: 'paid' }; } },
      scope: { input: 'same', nodes: {} }, segmentJobId: 'identity-transition', signal: new AbortController().signal,
      region: { branch: '', iteration: 0 }, checkpoints: {
        load: () => Object.keys(values).length ? { values: structuredClone(values) } : null,
        save: (_id: string, node: string, value: unknown) => { writes++; values[node] = structuredClone(value); },
        complete: () => { writes++; },
      },
    });
  };
  assert.equal((await run(`tangle-mas/2:flow/${flow.version}:ai/0.83.3:registry-1`)).ok, true);
  const before = structuredClone({ values, writes, ledger, calls });
  for (let retry = 0; retry < 2; retry++) {
    const refused = await run(current); assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.failure.error.code, 'TMAS2002');
    assert.deepEqual({ values, writes, ledger, calls }, before);
  }
  // A fresh checkpoint in the new identity resumes the exact same operation.
  for (const name of Object.keys(values)) delete values[name];
  assert.equal((await run(current)).ok, true);
  assert.equal((await run(current)).ok, true);
  assert.equal(calls, 2); assert.equal(ledger.length, 2);
});
