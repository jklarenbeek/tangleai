/**
 * Paused runs in a desktop's inbox: a waiting interaction becomes a proposal
 * the kernel accepts, the person's answer becomes the store's response (the
 * run is then resume-pending), the same answer twice is one answer, and a
 * pause that moved elsewhere is refused with the store's reason.
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createMasRegistrySnapshot, createMasConfigCatalog, defineMasWorkflow, interactionInvocation, validateMasWorkflow, planMasWorkflow } from '@tangleai/mas';
import { waitingProposals, decideInteraction, inboxResponseKey } from '@tangleai/mas/inbox';
import { createKernel } from '@tangleai/os';

const integer = { type: 'integer', minimum: 0 }, state = { type: 'object', properties: { n: integer }, required: ['n'], additionalProperties: false };
const limits = { calls: 10, tokens: 1000, ms: 120000, toolRounds: 1, fanOut: 4, concurrency: 2, iterations: 3, contextChars: 1000, traceBytes: 1000000 };

async function pausedRun() {
  const registry = await createMasRegistrySnapshot({ $masRegistry: '0.1', registryId: 'inbox-wait', roles: [], handlers: [], tools: [], contextAdapters: [], messageAdapters: [{ id: 'json-schema', version: '0.1' }], templates: [], subgraphs: [] } as any);
  const catalog = await createMasConfigCatalog({ profiles: ['scripted-v1'], tools: [], contexts: [] } as any);
  assert.ok(registry.valid && catalog.valid);
  const workflow = await defineMasWorkflow({ workflowId: 'inbox-wait', title: 'Inbox wait', description: 'One typed wait', profile: 'scripted-v1', input: state, output: { type: 'object', properties: { response: state }, required: ['response'], additionalProperties: false },
    nodes: [interactionInvocation({ id: 'human', input: { prompt: integer }, output: { response: state }, prompt: integer, response: state })],
    entry: [{ port: 'n', to: { node: 'human', port: 'prompt' } }], exit: [{ port: 'response', from: { node: 'human', port: 'response' } }], limits,
    registryRevision: registry.value.revision, configRegistryRevision: catalog.value.revision } as any);
  const validated = await validateMasWorkflow(workflow, registry.value, catalog.value);
  assert.ok(validated.valid, JSON.stringify(validated));
  const plan = await planMasWorkflow(validated.value);
  assert.ok(plan.valid);
  const { openTangleDb, createMasStore } = await import('@tangleai/store');
  const db = await openTangleDb(), store = createMasStore(db, { now: () => 'tick-000000' });
  const w = validated.value.workflow;
  assert.ok((await store.createRun({ runId: 'weekly-order', workflowId: w.workflowId, workflowVersionId: w.versionId, registryRevision: registry.value.revision, executableRevision: plan.value.executableRevision, configRegistryRevision: catalog.value.revision, profile: w.config.profile, input: { n: 0 }, limits } as any)).ok);
  assert.ok((await store.claimRunSegment('weekly-order', 'test')).ok);
  assert.ok((await store.transitionRun('weekly-order', { kind: 'wait' })).ok);
  const interaction = await store.createInteraction({ runId: 'weekly-order', node: 'human', path: 'human', prompt: 'How many crates of the weekly order?', responseSchema: state, expiry: null, segment: 0 });
  assert.ok(interaction.ok);
  return { db, store, interactionId: interaction.value.id };
}

it('a paused run waits in the inbox, the answer resumes it, and a second answer changes nothing', async () => {
  const { db, store, interactionId } = await pausedRun();
  try {
    const proposals = await waitingProposals(store, { kind: 'run.pause', answerLabel: 'Send' });
    assert.deepEqual(proposals.map(p => [p.id, p.title, p.revision, p.origin]), [[interactionId, 'How many crates of the weekly order?', '0', 'ai']]);
    // the desktop takes it as any proposal, and the application's decider carries the answer to the store
    const kernel = createKernel();
    kernel.install({ $module: '0.1', id: 'orders', version: '1.0.0', title: { en: 'Orders' }, host: { kind: 'shipped', mount: 'orders' }, proposals: [{ kind: 'run.pause' }] });
    kernel.registerDecider('orders', 'host', (decision) => decideInteraction(store, decision));
    assert.equal(kernel.propose('orders', proposals[0]).ok, true);
    const item = kernel.mail().find(m => m.proposal?.id === interactionId)!;
    const wrong = await kernel.decide(item.id, 'answer', { n: 'three' });
    assert.ok(!wrong.ok && wrong.error.code === 'OS0124', 'the form is checked against the run\'s own schema before it leaves');
    assert.equal((await kernel.decide(item.id, 'answer', { n: 3 })).ok, true);
    assert.equal((await store.getRun('weekly-order'))!.status, 'resume_pending');
    assert.deepEqual((await store.getInteraction(interactionId))!.responseKey, inboxResponseKey(interactionId, 0));
    assert.deepEqual(await waitingProposals(store, { kind: 'run.pause' }), [], 'nothing waits any more');
    // the same answer again (a retried request) is the same answer; a different one is refused with the store's reason
    assert.deepEqual(await decideInteraction(store, { id: interactionId, decision: 'answer', revision: '0', response: { n: 3 } }), { resume: true });
    const changed = await decideInteraction(store, { id: interactionId, decision: 'answer', revision: '0', response: { n: 4 } });
    assert.match(changed.refused ?? '', /different response/);
  } finally { await db.close(); }
});

it('a rejected pause cancels the interaction; a pause answered elsewhere is refused and stays pending in the inbox', async () => {
  const { db, store, interactionId } = await pausedRun();
  try {
    const kernel = createKernel();
    kernel.install({ $module: '0.1', id: 'orders', version: '1.0.0', title: { en: 'Orders' }, host: { kind: 'shipped', mount: 'orders' }, proposals: [{ kind: 'run.pause' }] });
    kernel.registerDecider('orders', 'host', (decision) => decideInteraction(store, decision));
    const [proposal] = await waitingProposals(store, { kind: 'run.pause' });
    kernel.propose('orders', proposal);
    // another device answered first
    assert.ok((await store.respondInteraction(interactionId, { n: 9 }, 0, 'other-device')).ok);
    const item = kernel.mail().find(m => m.proposal?.id === interactionId)!;
    const late = await kernel.decide(item.id, 'answer', { n: 1 });
    assert.ok(!late.ok && late.error.code === 'OS0112');
    assert.equal(kernel.mail().find(m => m.id === item.id)!.proposal!.status, 'pending');
  } finally { await db.close(); }
  const second = await pausedRun();
  try {
    assert.deepEqual(await decideInteraction(second.store, { id: second.interactionId, decision: 'reject', revision: '0' }), {});
    assert.equal((await second.store.getInteraction(second.interactionId))!.status, 'cancelled');
  } finally { await second.db.close(); }
});
