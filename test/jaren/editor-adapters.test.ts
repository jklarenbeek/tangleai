import { withMember } from '../assert-result.ts';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { MessageChannel } from 'node:worker_threads';
import { createApp, formEventFields } from '@jarenjs/app';
import { createProjectHost, createProjectState, createProjectController, PROJECT_ACTIONS } from '@jarenjs/studio/component';
import { createFlowState, createFlowRuntime, createFlowController, FLOW_ACTIONS } from '@jarenjs/studio/flow';
import { createDataState, createDataRuntime, createDataController, DATA_ACTIONS } from '@jarenjs/studio/data';
import { createDataHandlers, dataContract } from '@jarenjs/studio/data/host';
import { servePort, openPortClient } from '@jarenjs/contract/port';
import { nodeDriver } from '@jarenjs/db/node';
import { resolveProjectFile } from '@jarenjs/studio';
import { createStudioAdapter } from '@tangleai/jaren/studio';
import { createFlowAdapter } from '@tangleai/jaren/flow';
import { createDataAdapter } from '@tangleai/jaren/data';
const fsm = { $fsm: '0.1', initial: 'a', states: ['a', 'b'], transitions: [{ from: 'a', event: 'go', to: 'b' }] };
const dag = { $dag: '0.1', nodes: { input: { kind: 'input' }, task: { kind: 'task', run: 'double' }, out: { kind: 'output' } }, edges: [{ from: 'input', to: 'task' }, { from: 'task', to: 'out' }] };
const model = { $model: '0.1', collections: { rows: { schema: { type: 'object', properties: { id: { type: 'string' }, value: { type: 'integer' } } }, key: '/id' } } };
const query = [{ $for: { row: '$[*]' }, $return: '$row' }];
function scripted(values: any, onCall: (request: any) => unknown = () => { }) {
  const requests: any[] = [];
  return {
    requests, endpoint: { provider: 'openrouter' }, complete: async (request: any) => {
      requests.push(request); await onCall(request); return { message: { content: JSON.stringify(values.shift()) } };
    }
  };
}
function flow(t: any, kind: string = 'fsm', document: { $fsm: string; initial: string; states: string[]; transitions: { from: string; event: string; to: string; }[]; } = fsm) {
  let app: any;
  const runtime = createFlowRuntime({ getFlow: () => app.getState().flow, tasks: { double: async ({ input }: { input?: any; }) => input * 2 } });
  const editor = createFlowController({ getApp: () => app, runtime });
  app = createApp({ state: { flow: createFlowState(({ kind, document } as any)) }, actions: FLOW_ACTIONS, view: [] },
    { schedule: f => f(), effects: { ...runtime.effects, ...editor.effects } });
  editor.attach(); t.after(() => { editor.dispose(); app.destroy(); }); return { app, editor };
}
function project(t: any) {
  let app: any;
  const host = createProjectHost({ loadDocument: () => ({ ok: false }), runQuery: () => [], runJslt: () => [], runValidation: () => ({ valid: true }) });
  const editor = createProjectController({ getApp: () => app, host, debounceMs: 0 });
  const document = {
    project: '0.1', files: [
      { name: 'app', kind: 'app', text: '{"view":[{"match":"$","body":{"tag":"p","children":["$.n"]}}]}', imports: { state: 'state' } },
      { name: 'state', kind: 'state', text: '{"n":1}' },
    ], active: 'app', layout: { autorun: false }
  };
  app = createApp({ state: { project: createProjectState(document) }, actions: PROJECT_ACTIONS, view: [] }, { schedule: f => f(), effects: editor.effects });
  editor.attach(); t.after(() => { editor.dispose(); app.destroy(); }); return { editor, app };
}
async function data(t: any) {
  let app: any, opens = 0;
  const table = createDataHandlers({
    init: async () => ({ topology: 'memory', vfs: 'memory', version: '3' }),
    makeDriver: () => nodeDriver(), makeScratchDriver: () => nodeDriver(), path: () => ':memory:',
    vfs: () => 'memory', durable: () => false, unlink() { opens++; }, announce() { }, operators: undefined
  });
  const { port1, port2 } = new MessageChannel();
  const server = servePort(dataContract, table.handlers, { channel: port1 });
  const client = openPortClient(dataContract, { channel: port2 });
  const request = async (name: any, input: any) => { const outcome = await client.invoke(name, input); if (!outcome.ok) throw new Error(outcome.error.message); return outcome.value; };
  const runtime = createDataRuntime({
    model, query, seeds: [{ id: 'one', value: 7 }], lifecycleTarget: {}, transport: () => ({
      boot: () => request('data.init', null), request, bounded: (_stage: any, work: any) => work(),
      subscribe: (input: any, handlers: any) => client.subscribe('data.live', input, handlers),
      notices() { }, faults() { }, settled() { }, close() { client.close(); },
    })
  });
  const editor = createDataController({ getApp: () => app, runtime });
  app = createApp({ state: { data: createDataState() }, actions: DATA_ACTIONS, view: [] },
    { schedule: f => f(), eventFields: formEventFields(), effects: { ...runtime.effects, ...editor.effects } });
  editor.attach(); await runtime.effects['data-boot']({}, app.dispatch);
  t.after(async () => { editor.dispose(); app.destroy(); server.close(); port1.close(); port2.close(); await table.dispose(); });
  return { editor, app, opens: () => opens };
}
it('Studio candidates preserve assembled imports, source order and concurrent manual work', async t => {
  const { editor, app } = project(t), before = editor.read();
  const client = scripted([{ n: 2 }], () => app.dispatch('project/files-set', {
    files: editor.read().document.files.map((f: any) => f.name === 'state' ? { ...f, text: '{"n":3}' } : f),
  }));
  const adapter = createStudioAdapter({ editor, client });
  const proposal = await adapter.propose({ name: 'state', prompt: 'Set n to two.' });
  assert.equal(proposal.ok, true, JSON.stringify(proposal)); assert.equal(proposal.expectedRevision, before.revision);
  assert.equal((await adapter.accept(proposal)).conflict, true);
  assert.equal(resolveProjectFile(editor.read().document, 'app').doc.state.n, 3);
  assert.equal(JSON.parse(proposal.file.text).n, 2);
  const accepted = await adapter.write({ name: 'state', text: '{"n":4}', expectedRevision: editor.read().revision });
  assert.equal(accepted.ok, true); assert.deepEqual(editor.read().document.files.map((f: any) => f.name), ['app', 'state']);
  const patched = await adapter.patchFile('app', [{ op: 'replace', path: '/state/n', value: 5 }], { expectedRevision: editor.read().revision });
  assert.equal(patched.ok, true); assert.equal(resolveProjectFile(editor.read().document, 'app').doc.state.n, 5);
  assert.deepEqual(editor.read().document.files[0].imports, { state: 'state' });
  const current = editor.read();
  assert.equal((await adapter.write({ name: 'app', text: '{"view":{"$unknown":1}}', expectedRevision: current.revision })).ok, false);
  assert.deepEqual(editor.read(), current);
});
it('Flow proposals repair compiler failures, publish through shared history, and execute the real task registry', async t => {
  const { editor } = flow(t, 'dag', (dag as any)), bad = structuredClone(dag);
  bad.edges.push({ from: 'task', to: 'task' });
  const client = scripted([bad, dag]), adapter = createFlowAdapter({ editor, client });
  const before = editor.read(), proposal = await adapter.propose({ prompt: 'Double the input.' });
  assert.equal(proposal.ok, true); assert.equal(proposal.attempts, 2);
  assert.deepEqual(editor.read(), before, 'generation never publishes or executes');
  assert.equal((await adapter.accept(proposal)).ok, true);
  assert.equal((await adapter.run({ input: 6 })).output, 12);
  assert.match(JSON.stringify(client.requests[1].messages), /JF/);
});
it('Flow refuses stale proposals, preserves run results and keeps template/write/patch/check operations', async t => {
  const { editor, app } = flow(t);
  const adapter = createFlowAdapter({
    editor, client: scripted([fsm], () => app.dispatch('flow/state-minted', 'manual')),
    templates: { machine: { kind: 'fsm', document: fsm } }
  });
  const proposal = await adapter.propose({ prompt: 'Use this machine.' });
  assert.equal((await adapter.accept((proposal as any))).conflict, true); assert.equal(editor.read().document.states.at(-1), 'manual');
  assert.equal((await adapter.template('machine', { expectedRevision: editor.read().revision })).ok, true);
  assert.equal((await adapter.run()).ok, true); const before = editor.read();
  assert.equal(adapter.validate({ ...fsm, initial: 'missing' }).valid, false);
  assert.equal((await adapter.write({ ...fsm, initial: 'missing' }, { expectedRevision: before.revision })).ok, false);
  assert.deepEqual(editor.read(), before);
  assert.equal((await adapter.apply([{ op: 'add', path: '/states/-', value: 'patched' }], { expectedRevision: before.revision })).ok, true);
  app.dispatch('flow/undo'); assert.deepEqual(editor.read().document, fsm);
});
it('Data repairs a query, explicitly executes through SQLite and reports the contract plan', async t => {
  const { editor, opens } = await data(t);
  const requested = [{ $for: { row: '$[*]' }, $where: { $gt: ['$row.value', '$limit'] }, $return: '$row' }];
  const adapter = createDataAdapter({ editor, client: scripted([{ $invented: 1 }, requested]) });
  const before = editor.read(), proposal = await adapter.propose({ member: 'query', prompt: 'Filter by an external limit.' });
  assert.equal(proposal.ok, true); assert.equal(proposal.attempts, 2); assert.deepEqual(editor.read(), before);
  assert.equal((await adapter.accept(proposal)).ok, true); assert.equal(opens(), 0);
  const result = await adapter.run({ externals: { limit: 3 } });
  assert.equal(result.ok, true, JSON.stringify(result)); assert.ok('result' in result);
  assert.deepEqual(result.result, [{ id: 'one', value: 7 }]);
  assert.ok('explain' in result);
  assert.match(result.explain.sql, /SELECT/); assert.ok('explain' in result);
  assert.deepEqual(adapter.inspect().explain, result.explain);
  assert.deepEqual(withMember((await adapter.run({ externals: { limit: 9 } })), 'result').result, []);
});
it('Data conflicts preserve manual buffers, while accepting a model never recreates its store', async t => {
  const { editor, app, opens } = await data(t), changed: any = structuredClone(model);
  changed.collections.rows.indexes = [{ name: 'by_value', path: '$.value' }];
  const adapter = createDataAdapter({ editor, client: scripted([changed], () => app.dispatch('data/query-text', null, { target: { value: '{unfinished' } })) });
  const proposal = await adapter.propose({ member: 'model', prompt: 'Index value.' });
  assert.equal((await adapter.accept((proposal as any))).conflict, true); assert.equal(editor.read().buffers.queryText, '{unfinished');
  assert.equal((await adapter.write((proposal.candidate as any), { expectedRevision: editor.read().revision })).ok, true);
  assert.equal(opens(), 0); assert.deepEqual(withMember((await adapter.run()), 'result').result, [{ id: 'one', value: 7 }]);
  editor.dispose(); assert.equal((await adapter.run()).ok, false);
});
