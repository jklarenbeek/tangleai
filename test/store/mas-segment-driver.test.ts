/**
 * A segment that completes in its own transaction and then throws.
 *
 * The suite store closes the segment's job inside the same transaction that
 * records its outcome, so a host error raised after that commit meets a job
 * this attempt already settled. The job store refuses the failure write as
 * that attempt's own settlement (JD2065), as the suite worker reads it: a
 * lost settlement, never a second error. The driver must still hand the
 * host its own error, and leave the completed job and run as they are.
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { defineMasWorkflow, taskInvocation, createMasConfigCatalog, createMasRegistrySnapshot,
  validateMasWorkflow, planMasWorkflow, compileMasRuntime, segmentJobIdOf } from '@tangleai/mas';
import { openTangleDb, createMasStore, createMasSegmentDriver } from '@tangleai/store';
import { failClaimedSegment } from '../../packages/store/src/mas-jobs.ts';

it('a host error after the segment completed reaches the host, and the completed job stays done', async () => {
  const snapshot = await createMasRegistrySnapshot({ $masRegistry: '0.1', registryId: 'settled-driver', roles: [],
    handlers: [{ id: 'step', title: 'Step', effect: 'pure', idempotency: 'not-required' }], tools: [], contextAdapters: [],
    messageAdapters: [{ id: 'json-schema', version: '0.1' }], templates: [], subgraphs: [] });
  const catalog = await createMasConfigCatalog({ profiles: ['scripted'], tools: [], contexts: [] }); assert.ok(snapshot.valid && catalog.valid);
  const shape = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false };
  const workflow = await defineMasWorkflow({ workflowId: 'settled-driver', title: 'Settled segment', description: 'A segment that completes, then its host throws.',
    profile: 'scripted', registryRevision: snapshot.value.revision, configRegistryRevision: catalog.value.revision,
    input: shape, output: shape, entry: [{ port: 'text', to: { node: 'step', port: 'text' } }],
    exit: [{ port: 'text', from: { node: 'step', port: 'text' } }],
    nodes: [taskInvocation({ id: 'step', handler: 'step', input: { text: { type: 'string' } }, output: { text: { type: 'string' } } })] });
  const validated = await validateMasWorkflow(workflow, snapshot.value, catalog.value); assert.ok(validated.valid, JSON.stringify(validated));
  const planned = await planMasWorkflow(validated.value); assert.ok(planned.valid);
  const db = await openTangleDb({ jobs: { now: () => 1000, random: () => 0.5 } }), store = createMasStore(db, { now: () => 'fixed' });
  try {
    const created = await store.createRun({ runId: 'settled-run', workflowId: workflow.workflowId, workflowVersionId: workflow.versionId,
      registryRevision: snapshot.value.revision, executableRevision: planned.value.executableRevision, configRegistryRevision: catalog.value.revision,
      profile: 'scripted', input: { text: 'input' }, limits: { ...workflow.limits } }); assert.ok(created.ok);
    const runtime = compileMasRuntime(validated.value, planned.value, snapshot.value, { store, taskHandlers: { step: input => ({ text: input.value.text }) },
      toolBindings: {}, contextProviders: {}, now: () => 'fixed', clock: () => 0 }); assert.ok(runtime.valid);
    const segments = createMasSegmentDriver(db, store, { owner: 'settled', leaseMs: 1000 });
    await segments.enqueue(created.value);
    const afterCommit = new Error('the host failed after its segment committed');
    await assert.rejects(segments.drive(planned.value.executableRevision, async (segment) => {
      await runtime.value.executeSegment(segment);
      throw afterCommit;
    }, new AbortController().signal), (error: unknown) => error === afterCommit);
    const run = (await store.getRun(created.value.id))!;
    assert.equal(run.status, 'completed');
    assert.equal(await segments.settled(run), true);
    const job = await db.jobs!.get(segmentJobIdOf(run.id, run.segment));
    assert.equal(job?.state, 'done');
    assert.equal(job?.attempts, 1);
    assert.equal((await db.jobs!.counts()).pending, 0);
  } finally { await db.close(); }
});

it('only a fence refusal is a lost settlement; any other refusal of the failure write is thrown', async () => {
  const fence = (code: string) => Object.assign(new Error('fence ' + code), { code });
  const storage = Object.assign(new Error('disk full'), { code: 'JD0001' });
  const refusing = (refusal: unknown) => ({ fail: async () => { throw refusal; } }) as never;
  for (const code of ['JD2065', 'JD2066', 'JD2067']) await failClaimedSegment(refusing(fence(code)), {} as never, new Error('cause'));
  await assert.rejects(failClaimedSegment(refusing(storage), {} as never, new Error('cause')), (error: unknown) => error === storage);
  await assert.rejects(failClaimedSegment(refusing(null), {} as never, new Error('cause')), (error: unknown) => error === null);
});
