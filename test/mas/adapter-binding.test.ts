import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  agentInvocation, createMasRegistrySnapshot, createMasConfigCatalog, defineMasWorkflow,
  validateMasWorkflow, planMasWorkflow, compileMasRuntime, masRevisionOf,
  type MasHostBindings, type MasMessageAdapter,
} from '@tangleai/mas';
import { openTangleDb, createMasStore } from '@tangleai/store';

async function setup(adapterId = 'custom', adapterVersion = '1') {
  const instructions = 'Echo the inbound text.';
  const r = await createMasRegistrySnapshot({ $masRegistry: '0.1', registryId: 'adapter-test',
    roles: [{ id: 'echo', title: 'echo', instructions, instructionsRevision: await masRevisionOf(instructions), capabilities: [] }],
    handlers: [], tools: [], contextAdapters: [], templates: [], subgraphs: [],
    messageAdapters: [{ id: adapterId, version: adapterVersion }],
  });
  const c = await createMasConfigCatalog({ profiles: ['scripted'], tools: [], contexts: [] });
  assert.ok(r.valid && c.valid);
  const str = { type: 'string' };
  const obj = { type: 'object', required: ['text'], properties: { text: str }, additionalProperties: false };
  const w = await defineMasWorkflow({ workflowId: 'adapter-test', title: 'Adapter test', description: 'One echo', author: 'test',
    input: obj, output: obj, entry: [{ port: 'text', to: { node: 'echo', port: 'text' } }],
    exit: [{ port: 'text', from: { node: 'echo', port: 'text' } }],
    nodes: [agentInvocation({ id: 'echo', role: 'echo', profile: 'scripted', instructionsRevision: r.value.document.roles[0].instructionsRevision,
      input: { text: str }, output: { text: str }, messageAdapter: adapterId })],
    registryRevision: r.value.revision, configRegistryRevision: c.value.revision, profile: 'scripted',
  });
  const v = await validateMasWorkflow(w, r.value, c.value); assert.ok(v.valid);
  const p = await planMasWorkflow(v.value); assert.ok(p.valid);
  return { snapshot: r.value, validated: v.value, plan: p.value, catalog: c.value };
}
const prepared = await setup();
function compile(messageAdapters: ReadonlyMap<string, MasMessageAdapter>, extra: Partial<MasHostBindings> = {}) {
  return compileMasRuntime(prepared.validated, prepared.plan, prepared.snapshot, {
    store: {} as MasHostBindings['store'], taskHandlers: {}, toolBindings: {}, contextProviders: {},
    clientFor: () => ({ complete: async () => { throw Error('unexpected provider'); } }),
    now: () => '2026-09-12T00:00:00Z', clock: () => 0, messageAdapters, ...extra,
  });
}

describe('pinned message adapter binding', () => {
  it('runtime rejects mismatched adapter identity before dispatch', () => {
    for (const entries of [
      [['custom', { id: 'custom', version: '2', render: () => '' }]],
      [['custom', { id: 'other', version: '1', render: () => '' }]],
      [['other', { id: 'custom', version: '1', render: () => '' }]],
      [['custom', { id: 'custom', version: '1', render: null }]],
      [],
    ]) {
      const r = compile(new Map(entries as Array<[string, MasMessageAdapter]>));
      assert.ok(!r.valid);
      assert.equal(r.issues[0].code, 'TMAS1009');
      assert.match(r.issues[0].path, /^\/messageAdapters\//);
    }
  });

  it('compiled runtime captures adapter bindings', async () => {
    const db = await openTangleDb();
    try {
      const store = createMasStore(db, { now: () => '2026-09-12T00:00:00Z' });
      const requests: string[] = [];
      const adapter: MasMessageAdapter = { id: 'custom', version: '1', render: () => 'original' };
      const map = new Map([['custom', adapter]]);
      const r = compile(map, { store, clientFor: () => ({ complete: async request => {
        const messages = (request as { messages: Array<{ content: string }> }).messages;
        requests.push(messages.at(-1)!.content);
        return { message: { role: 'assistant', content: 'done' }, usage: { prompt_tokens: 1, completion_tokens: 1 } };
      } }) });
      assert.ok(r.valid);
      adapter.render = () => 'mutated';
      map.set('custom', { id: 'custom', version: '2', render: () => 'replaced' });
      const w = prepared.validated.workflow;
      assert.ok((await store.createRun({ runId: 'adapter-run', workflowId: w.workflowId, workflowVersionId: w.versionId,
        registryRevision: prepared.snapshot.revision, executableRevision: prepared.plan.executableRevision,
        configRegistryRevision: prepared.catalog.revision, profile: 'scripted', input: { text: 'hello' }, limits: { ...w.limits } })).ok);
      const claim = await store.claimRunSegment('adapter-run', 'test'); assert.ok(claim.ok);
      const run = await store.getRun('adapter-run'); assert.ok(run);
      const checkpoints = new Map<string, unknown>();
      await r.value.executeSegment({ run, claimSeq: run.claim.seq, segmentJobId: 'adapter-run:0000', signal: new AbortController().signal,
        checkpointsFor: () => ({ load: id => checkpoints.get(id), save: () => {}, complete: () => {} }), completeSegment: async () => {},
      });
      assert.deepEqual(requests, ['original']);
      assert.equal((await store.getRun('adapter-run'))?.status, 'completed');
    } finally { await db.close(); }
  });
});

it('default adapters need only cover registered builtins', async () => {
  const p = await setup('json-schema', '0.1');
  const r = compileMasRuntime(p.validated, p.plan, p.snapshot, {
    store: {} as MasHostBindings['store'], taskHandlers: {}, toolBindings: {}, contextProviders: {},
    clientFor: () => ({ complete: async () => { throw Error('unexpected provider'); } }), now: () => '', clock: () => 0,
  });
  assert.ok(r.valid);
});
