import { it } from 'node:test';
import assert from 'node:assert/strict';
import { defineMasWorkflow, taskInvocation, createMasConfigCatalog, createMasRegistrySnapshot,
  validateMasWorkflow, planMasWorkflow, compileMasRuntime, MasTaskRefusal, type MasTaskHandlerBinding,
  type RuntimeError } from '@tangleai/mas';
import { openTangleDb, createMasStore, createMasSegmentDriver } from '@tangleai/store';

async function execute(handler: MasTaskHandlerBinding) {
  const snapshot = await createMasRegistrySnapshot({ $masRegistry: '0.1', registryId: 'task-refusal', roles: [],
    handlers: [{ id: 'step', title: 'Step', effect: 'pure', idempotency: 'not-required' }], tools: [], contextAdapters: [],
    messageAdapters: [{ id: 'json-schema', version: '0.1' }], templates: [], subgraphs: [] });
  const catalog = await createMasConfigCatalog({ profiles: ['scripted'], tools: [], contexts: [] }); assert.ok(snapshot.valid && catalog.valid);
  const shape = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false };
  const workflow = await defineMasWorkflow({ workflowId: 'task-refusal', title: 'Typed task', description: 'A native task boundary.',
    profile: 'scripted', registryRevision: snapshot.value.revision, configRegistryRevision: catalog.value.revision,
    input: shape, output: shape, entry: [{ port: 'text', to: { node: 'step', port: 'text' } }],
    exit: [{ port: 'text', from: { node: 'step', port: 'text' } }],
    nodes: [taskInvocation({ id: 'step', handler: 'step', input: { text: { type: 'string' } }, output: { text: { type: 'string' } } })] });
  const validated = await validateMasWorkflow(workflow, snapshot.value, catalog.value); assert.ok(validated.valid, JSON.stringify(validated));
  const planned = await planMasWorkflow(validated.value); assert.ok(planned.valid);
  const db = await openTangleDb({ jobs: { now: () => 1000, random: () => 0.5 } }), store = createMasStore(db, { now: () => 'fixed' });
  try {
    const current = await store.createRun({ runId: 'native-task', workflowId: workflow.workflowId, workflowVersionId: workflow.versionId,
      registryRevision: snapshot.value.revision, executableRevision: planned.value.executableRevision, configRegistryRevision: catalog.value.revision,
      profile: 'scripted', input: { text: 'input' }, limits: { ...workflow.limits } }); assert.ok(current.ok);
    const runtime = compileMasRuntime(validated.value, planned.value, snapshot.value, { store, taskHandlers: { step: handler },
      toolBindings: {}, contextProviders: {}, now: () => 'fixed', clock: () => 0 }); assert.ok(runtime.valid);
    const segments = createMasSegmentDriver(db, store, { owner: 'test', leaseMs: 1000 });
    await segments.enqueue(current.value); assert.equal(await segments.drive(planned.value.executableRevision, runtime.value.executeSegment, new AbortController().signal), true);
    return (await store.readTrace(current.value.id))!;
  } finally { await db.close(); }
}
it('a typed task refusal persists its originating content cause on the attempt and the run', async () => {
  const error: RuntimeError = { code: 'TMAS2004', detail: 'An undeclared input was refused.',
    cause: { code: 'TRSH1005', docPath: '/inputs/0', message: 'Artifact is outside the manifest.' } };
  const refusal = new MasTaskRefusal(error); error.cause!.code = 'mutated';
  const trace = await execute(() => { throw refusal; });
  assert.equal(trace.run.status, 'failed'); assert.equal(trace.attempts.length, 1); assert.equal(trace.attempts[0].status, 'failed');
  assert.deepEqual(trace.attempts[0].error, refusal.failure); assert.deepEqual(trace.run.failure?.error, refusal.failure);
  assert.equal(trace.run.failure?.error.cause?.code, 'TRSH1005');
  assert.deepEqual(trace.run.budget.spent, { turns: 0, tokens: 0, ms: 0 });
  assert.equal(trace.messages.length, 0); assert.equal(trace.run.output, null);
});
it('task context carries the native run id and preserves ordinary typed output', async () => {
  const trace = await execute(input => {
    assert.equal(input.runId, 'native-task'); assert.equal(input.node, 'step'); assert.equal(input.path, 'step');
    return { text: input.runId + ':' + input.value.text };
  });
  assert.equal(trace.run.status, 'completed'); assert.deepEqual(trace.run.output, { text: 'native-task:input' });
});
it('a task refusal rejects foreign top-level codes and unknown members at its own boundary', () => {
  for (const error of [{ code: 'TRSH1005', detail: 'wrong owner', cause: null },
    { code: 'TMAS2004', detail: 'unknown member', cause: null, secret: 'not accepted' }]) {
    assert.throws(() => new MasTaskRefusal(error as RuntimeError), /closed native runtime error/);
  }
});
