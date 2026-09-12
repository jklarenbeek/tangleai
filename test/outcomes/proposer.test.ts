import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createOutcomeService, createMemoryOutcomeStore, createOutcomeStoreAdapter, outcomeRevision } from '@tangleai/outcomes';
import { createStructuredOutcomeProposer, outcomeProposalComponents } from '@tangleai/outcomes/proposer';
import { replayKey } from '@tangleai/models/replay';
import configFixture from '../fixtures/config-conformance.json' with { type: 'json' };
import { persistenceFor } from '../../packages/outcomes/src/store.ts';
import { lifecycleFixture } from './guarded-fixtures.ts';
import { code, value, id, scopeId, LATER, revision } from './fixtures.ts';
import type { ProfileRegistry, HostManifest } from '@tangleai/config';
import type { Json, Proposal, ProposalReply } from '@tangleai/outcomes';

async function configuration() {
  const base = structuredClone(configFixture.base), registry = base.registry as unknown as ProfileRegistry;
  registry.inference[0].maxTokens = 512;
  for (const p of registry.profiles) if (p.kind === 'root') p.roles.answer.tools = [];
  const revisions = await outcomeProposalComponents();
  registry.prompts[0].revision = revisions.promptRevision; registry.responseSchemas[0].revision = revisions.responseSchemaRevision;
  return { registry, request: base.request, host: base.host as unknown as HostManifest };
}
function proposed(body: Record<string, unknown>): Proposal {
  const messages = body.messages as Array<{ content: string }>;
  const context = JSON.parse(messages.at(-1)!.content) as { training: Array<{ scoreId: string }> };
  assert.deepEqual(Object.keys(context).sort(), ['bounds', 'mode', 'parentPayload', 'schema', 'training']);
  return { payload: { fallbackLabel: 'unknown', rules: [{ prefix: 'accept:', label: 'yes' }] }, patch: [], text: 'A bounded proposal from provided training.', citations: context.training.map(t => t.scoreId) };
}
const response = (proposal: unknown) => new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(proposal) }, finish_reason: 'stop' }], model: 'example/alpha', usage: { prompt_tokens: 6, completion_tokens: 4, total_tokens: 10 } }), { status: 200 });

describe('durable bounded outcome model proposals', () => {
  it('uses one physical request, exact wire replay identity and zero calls on completed replay', async () => {
    let calls = 0, body: Record<string, Json> = {}, milliseconds = 0;
    const proposer = await createStructuredOutcomeProposer({ configuration: await configuration(), role: 'answer', apiKey: 'test-only', clock: () => 0, deadline: ms => { milliseconds = ms; return new AbortController().signal; },
      async fetch(_url, init) { calls++; body = JSON.parse(String(init?.body)); return response(proposed(body)); },
    });
    const f = await lifecycleFixture(), service = await createOutcomeService({ ...f.host, proposer });
    const c = f.command('model', f.input({ payload: null, text: '', configuration: { kind: 'model', identityId: proposer.identity.identityId } }));
    const first = await service.reflect(c), versionId = id(first, 'versionId');
    const replay = await service.reflect(c); assert.ok(replay.ok && replay.replayed); assert.equal(replay.writes, 0); assert.equal(id(replay, 'versionId'), versionId); assert.equal(calls, 1); assert.equal(milliseconds, 120000);
    const attempts = await persistenceFor(f.store).transaction(tx => tx.query('records', { scopeId, kind: 'attemptEvent' }));
    const dispatch = attempts.find(r => r.record.kind === 'attemptEvent' && r.record.stage === 'dispatched')!.record;
    assert.ok(dispatch.kind === 'attemptEvent'); const details = (dispatch.details as { value: Record<string, Json> }).value;
    const { stream: _stream, ...keyed } = body;
    assert.equal(details.requestDigest, await outcomeRevision(replayKey('chat', { provider: 'openrouter', base: 'https://openrouter.ai/api/v1' }, keyed)));
    assert.ok(!JSON.stringify(attempts).includes('test-only'));
  });
  it('a concurrent duplicate returns in-progress, without a second dispatch', async () => {
    let enter!: () => void, release!: () => void, calls = 0;
    const entered = new Promise<void>(resolve => { enter = resolve; }), released = new Promise<void>(resolve => { release = resolve; });
    const proposer = await createStructuredOutcomeProposer({ configuration: await configuration(), role: 'answer', apiKey: 'test-only', clock: () => 0, deadline: () => new AbortController().signal,
      async fetch(_url, init) { calls++; const p = proposed(JSON.parse(String(init?.body))); enter(); await released; return response(p); },
    });
    const f = await lifecycleFixture(), service = await createOutcomeService({ ...f.host, proposer });
    const c = f.command('model', f.input({ payload: null, text: '', configuration: { kind: 'model', identityId: proposer.identity.identityId } }));
    const first = service.reflect(c); await entered;
    code(await service.reflect(c), 'OUTC1019'); release(); value(await first); assert.equal(calls, 1);
  });
  it('retains uncertain completion and refuses automatic redispatch after a lost output write', async () => {
    const base = createMemoryOutcomeStore(), owner = persistenceFor(base); let armed = true, calls = 0, proposal!: Proposal, digest = '';
    const store = createOutcomeStoreAdapter({ transaction: task => owner.transaction(tx => task({ ...tx, async put(table, row) {
      if (armed && table === 'records' && 'record' in row && row.record.kind === 'attemptEvent' && row.record.stage === 'ready') { armed = false; throw Error('lost output write'); }
      await tx.put(table, row);
    } })) });
    const proposer = await createStructuredOutcomeProposer({ configuration: await configuration(), role: 'answer', apiKey: 'test-only', clock: () => 0, deadline: () => new AbortController().signal,
      async fetch(_url, init) { calls++; const body = JSON.parse(String(init?.body)) as Record<string, Json>, { stream: _stream, ...keyed } = body; digest = await outcomeRevision(replayKey('chat', { provider: 'openrouter', base: 'https://openrouter.ai/api/v1' }, keyed)); proposal = proposed(body); return response(proposal); },
    });
    const f = await lifecycleFixture({ store }), service = await createOutcomeService({ ...f.host, proposer });
    const c = f.command('model', f.input({ payload: null, text: '', configuration: { kind: 'model', identityId: proposer.identity.identityId } }));
    code(await service.reflect(c), 'OUTC1017'); code(await service.reflect(c), 'OUTC1017'); assert.equal(calls, 1);
    const operation = (await persistenceFor(store).transaction(tx => tx.query('operations', { scopeId }))).find(o => o.requestKey === 'model')!;
    assert.equal(operation.state, 'uncertain'); assert.equal(operation.capacityReserved, true);
    const reply: ProposalReply = { proposal, issues: [], requestDigest: digest, identityId: proposer.identity.identityId, physicalRequests: 1, replayed: false, usage: { prompt_tokens: 6, completion_tokens: 4, total_tokens: 10 }, usageKnown: true, cost: null, outputDigest: await outcomeRevision({ raw: JSON.stringify(proposal) }) };
    const proof = { kind: 'retained-output', attemptId: operation.id, attempt: operation.attempt, inputDigest: operation.inputDigest, reply };
    const evidence = await f.evidence(operation.id, { decisionId: null, payload: proof as unknown as Json });
    const reconcile = f.command('reconcile', { attemptId: operation.id, evidence });
    const untrusted = await createOutcomeService({ ...f.host, proposer, principal: { id: 'model', authorityId: revision, approve: false, reconcile: false } });
    code(await untrusted.reconcile(reconcile), 'OUTC1012');
    value(await service.reconcile(reconcile)); const staged = await service.reflect(c); value(staged); assert.equal(calls, 1);
    const again = await service.reflect(c); assert.ok(again.ok && again.replayed); assert.equal(again.writes, 0);
    code(await service.injectChecked({ scopeId, artifactKey: 'a', input: {} }), 'OUTC1004');
  });
  it('capacity is reserved before model dispatch and invalid output never repairs itself', async () => {
    let calls = 0;
    const proposer = await createStructuredOutcomeProposer({ configuration: await configuration(), role: 'answer', apiKey: 'test-only', clock: () => 0, deadline: () => new AbortController().signal, async fetch() { calls++; return response({ invalid: true }); } });
    const f = await lifecycleFixture(), service = await createOutcomeService({ ...f.host, proposer });
    const c = f.command('model', f.input({ payload: null, text: '', configuration: { kind: 'model', identityId: proposer.identity.identityId } }));
    code(await service.reflect(c), 'OUTC1001'); code(await service.reflect(c), 'OUTC1001'); assert.equal(calls, 1);
    for (let i = 0; i < 10; i++) await f.stage('candidate:' + i);
    code(await service.reflect({ ...c, requestKey: 'eleven' }), 'OUTC1014'); assert.equal(calls, 1);
  });
  it('a deadline before dispatch is refused without an uncertain purchase', async () => {
    const controller = new AbortController(); controller.abort(); let calls = 0;
    const proposer = await createStructuredOutcomeProposer({ configuration: await configuration(), role: 'answer', apiKey: 'test-only', clock: () => 0, deadline: () => controller.signal, async fetch() { calls++; throw Error('must not fetch'); } });
    const f = await lifecycleFixture(), service = await createOutcomeService({ ...f.host, proposer });
    const c = f.command('model', f.input({ payload: null, text: '', configuration: { kind: 'model', identityId: proposer.identity.identityId } }));
    code(await service.reflect(c), 'OUTC1016'); assert.equal(calls, 0);
  });
});
