import assert from 'node:assert/strict';
import { it } from 'node:test';
import { resolveExperientialInference, startExperientialInference, type ExperientialResult } from '@tangleai/experiential';
import { openTangleDb, createExperientialDbStore, createIdentityRepository, createRunLog } from '@tangleai/store';
import { createChatClient } from '@tangleai/models';
import { accepted, addressedFixture } from './identity-fixtures.ts';
import { inferenceFixture } from './inference-fixtures.ts';

function refused(result: ExperientialResult<unknown>, code: string) {
  assert.equal(result.ok, false, JSON.stringify(result));
  if (!result.ok) assert.equal(result.issues[0].code, code, JSON.stringify(result));
}

it('resolves a detached base-only pin and reports inference-only capability explicitly', async () => {
  const input = await inferenceFixture(), copy = structuredClone(input);
  const pending = resolveExperientialInference(copy);
  copy.deployment.base.model = 'later-mutation'; copy.runId = 'later-run'; copy.capability.trainable = false;
  const result = accepted(await pending);
  assert.equal(result.pin.runId, input.runId); assert.equal(result.pin.artifactId, null);
  assert.equal(result.pin.servedModel, input.identity.roles.chat.model);
  assert.equal(result.pin.identityId, result.identity.identityId); assert.equal(result.pin.canary, false);
  assert.ok(Object.isFrozen(result.pin)); assert.equal(result.pin.capability.trainable, true);
  const inferenceOnly = accepted(await resolveExperientialInference({ ...input, capability: { trainable: false } }));
  assert.equal(inferenceOnly.pin.artifactId, null); assert.equal(inferenceOnly.pin.capability.trainable, false);
});

it('selects the pinned active or canary model and refuses a missing, stale or unsupported artifact', async () => {
  const input = await inferenceFixture(), runtime = { ...input.baseArtifact.runtime, servedModel: 'fixture-adapter' };
  const active = await addressedFixture('artifact', { baseArtifactId: input.baseArtifact.id, runtime, state: 'active' });
  const canary = await addressedFixture('artifact', { baseArtifactId: input.baseArtifact.id,
    runtime: { ...runtime, servedModel: 'fixture-canary' }, state: 'canary' });
  const deployment = { ...input.deployment, activeArtifactId: active.id, canaryArtifactId: canary.id,
    rolloutFraction: 1, revision: 2, headRevision: 1, approvalId: 'a'.repeat(64), expectedParentArtifactId: active.id };
  const selected = accepted(await resolveExperientialInference({ ...input, deployment, artifacts: [active, canary] }));
  assert.equal(selected.pin.artifactId, canary.id); assert.equal(selected.pin.canary, true);
  assert.equal(selected.pin.servedModel, 'fixture-canary'); assert.equal(selected.identity.roles.chat.model, input.identity.roles.chat.model);
  const normal = accepted(await resolveExperientialInference({ ...input,
    deployment: { ...deployment, canaryArtifactId: null, rolloutFraction: 0 }, artifacts: [active] }));
  assert.equal(normal.pin.artifactId, active.id); assert.equal(normal.pin.canary, false);
  refused(await resolveExperientialInference({ ...input, deployment, artifacts: [] }), 'TEXP1004');
  refused(await resolveExperientialInference({ ...input, deployment, artifacts: [canary, canary] }), 'TEXP1004');
  refused(await resolveExperientialInference({ ...input, deployment, artifacts: [{ ...canary, state: 'archived' }] }), 'TEXP1006');
  refused(await resolveExperientialInference({ ...input, deployment, artifacts: [canary], capability: { trainable: false } }), 'TEXP1008');
});

it('preserves native configuration causes and refuses a profile that moved away from the registered role', async () => {
  const input = await inferenceFixture();
  const unknown = await resolveExperientialInference({ ...input, request: { ...input.request, profile: 'missing-profile' } });
  refused(unknown, 'TEXP1002'); if (!unknown.ok) assert.equal(unknown.issues[0].cause?.code, 'TCFG1005');
  const changed = structuredClone(input);
  changed.registry.candidates.find(candidate => candidate.id === 'chat-beta')!.model = 'moved-model';
  changed.host.providers.find(provider => provider.provider === 'ollama')!.models = ['moved-model'];
  const moved = await resolveExperientialInference(changed); refused(moved, 'TEXP1002');
  if (!moved.ok) assert.match(moved.issues[0].detail, /base differs/);
  refused(await resolveExperientialInference({ ...input, request: { ...input.request, profile: 'child' } }), 'TEXP1005');
});

it('rehashing a contradictory deployment cannot detach its base fields from the registered role digest', async () => {
  const input = await inferenceFixture();
  const deployment = await addressedFixture('deployment', { ...input.deployment, base: { ...input.deployment.base, model: 'contradictory-model' } });
  refused(await resolveExperientialInference({ ...input, deployment }), 'TEXP1002');
});

it('uses the native identity repository and run log before the durable pin and the first scripted call', async () => {
  const input = await inferenceFixture(), db = await openTangleDb();
  try {
    const store = createExperientialDbStore(db, { now: () => input.recordedAt });
    const identities = createIdentityRepository(db), runs = createRunLog(db);
    accepted(await store.put('artifacts', input.baseArtifact)); accepted(await store.put('deployments', input.deployment));
    const order: string[] = [];
    const ready = accepted(await startExperientialInference({ ...input, store: { pin: async pin => {
      order.push('pin'); const retainedRun = await runs.getRun(pin.runId);
      assert.equal(retainedRun?.run.identityStatus, 'run'); assert.equal(retainedRun?.run.identityId, pin.identityId);
      return store.pin(pin);
    } }, putIdentity: async identity => { order.push('identity'); return identities.put(identity); },
    startRun: async identity => { order.push('run'); assert.ok(await identities.get(identity.identityId));
      return runs.startRun('experiential-inference-conformance', { identityId: identity.identityId }); },
    binding: { capability: { trainable: false }, clientFor: async (pin, identity) => {
      order.push('client'); assert.deepEqual(accepted(await store.get('pins', pin.id)), pin);
      return createChatClient({ provider: identity.roles.chat.provider, baseUrl: identity.roles.chat.base, model: pin.servedModel,
        fetch: async () => { order.push('call'); assert.ok(accepted(await store.get('pins', pin.id)));
          return new Response(JSON.stringify({ model: pin.servedModel, choices: [{ message: { role: 'assistant', content: 'fixture response' }, finish_reason: 'stop' }] }),
            { status: 200, headers: { 'content-type': 'application/json' } }); } });
    } } }));
    assert.deepEqual(order, ['identity', 'run', 'pin', 'client']);
    assert.match(ready.pin.runId, /^r-/); assert.notEqual(ready.pin.runId, input.runId);
    const answer = await ready.client.complete({ messages: [{ role: 'user', content: 'fixture question' }], stream: false });
    assert.equal(answer.message.content, 'fixture response'); assert.deepEqual(order, ['identity', 'run', 'pin', 'client', 'call']);
    refused(await store.pin(ready.pin), 'TEXP1006');
    assert.deepEqual(accepted(await store.get('pins', ready.pin.id)), ready.pin);
    assert.ok((await runs.finishRun(ready.pin.runId, 'ok')).ok);
  } finally { await db.close(); }
});

it('a failed identity write or pin write cannot construct a client or make a call', async () => {
  const input = await inferenceFixture(); let starts = 0, clients = 0;
  const cause = { code: 'TCFG1005', path: '/identity', detail: 'Fixture refusal.' };
  const common = { ...input, store: { pin: async () => ({ ok: false as const, issues: [{ ...cause, code: 'TEXP1009' as const }] }) },
    startRun: async () => { starts++; return { id: 'native-fixture-run' }; },
    binding: { capability: { trainable: false }, clientFor: () => { clients++; throw Error('Client must not be constructed.'); } } };
  const failedIdentity = await startExperientialInference({ ...common, putIdentity: async () => ({ ok: false, issues: [cause] }) });
  refused(failedIdentity, 'TEXP1002'); assert.equal(starts, 0); assert.equal(clients, 0);
  const failedPin = await startExperientialInference({ ...common, putIdentity: async identity => ({ ok: true, id: identity.identityId }) });
  refused(failedPin, 'TEXP1009'); assert.equal(starts, 1); assert.equal(clients, 0);
});
