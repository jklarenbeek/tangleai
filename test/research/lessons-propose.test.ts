import { it } from 'node:test';
import assert from 'node:assert/strict';
import { proposeLessons, createLessonRefiner, type ResearchLessonDraft, type ResearchLessonV2,
  type LessonProposerOptions, type ResearchStore } from '@tangleai/research';
import { memoryHarness, stored } from './store-harness.ts';
import { correctionFixture, retainCandidateValidation } from './lessons-refiner-fixtures.ts';
import { alternateOriginFixture, webOriginFixture } from './lessons-origin-fixtures.ts';
import { lessonFixture, lessonNow, lessonScope } from './lessons-store-fixtures.ts';

function draft(lesson: ResearchLessonV2): ResearchLessonDraft {
  return structuredClone({ scope: lesson.scope, origin: { kind: lesson.origin.kind, envelope: lesson.origin.envelope },
    proposal: lesson.proposal, severity: lesson.severity, decayHypothesisId: lesson.decay.hypothesisId });
}
function script(store: ResearchStore, lesson: ResearchLessonV2, reply: unknown = draft(lesson)) {
  const requests: Array<{ messages: Array<{ role: string; content: string }>; signal?: AbortSignal }> = [];
  const options: LessonProposerOptions = { store, run: lesson.projectId, profile: lessonScope, bundleHash: lesson.proposal.baseHash,
    now: () => '2026-10-05T00:00:01.000Z', clock: () => 0, physicalRequests: () => 0, budget: { calls: 6, tokens: 100000, ms: 1000 },
    client: { endpoint: { provider: 'openai' }, async complete(raw) {
      const request = raw as typeof requests[number]; requests.push(request);
      const input = JSON.parse(request.messages.find(message => message.role === 'user')!.content);
      return { message: { content: JSON.stringify({ proposals: input.sourceKind === lesson.origin.kind ? [reply] : [] }) }, usage: { total_tokens: 10 } };
    } } };
  return { options, requests };
}

it('seals only the current run evidence and replays the same immutable proposal without writes', async () => {
  const h = await memoryHarness();
  try {
    const f = await correctionFixture(h.store), foreign = await correctionFixture(h.store, { id: 'foreign-origin', text: 'foreign secret policy' });
    await retainCandidateValidation(h.store, foreign.lesson, foreign.snapshot,
      [{ topicId: 'hidden-topic', input: { secret: 'never disclose this held-out result' } }]);
    const wire = script(h.store, f.lesson), before = await h.capture(), result = await proposeLessons(wire.options);
    assert.deepEqual(result.refused, {}); assert.equal(result.proposals.length, 1); assert.notDeepEqual(await h.capture(), before);
    const proposal = result.proposals[0];
    assert.equal(proposal.validation.state, 'proposed'); assert.equal(proposal.promotion, null); assert.equal(proposal.parentId, null);
    assert.equal(proposal.origin.runId, f.owner.id); assert.deepEqual(proposal.origin.topicContentHashes, f.lesson.origin.topicContentHashes);
    assert.deepEqual(proposal.origin.envelope, f.lesson.origin.envelope); assert.equal(proposal.recordedAt, wire.options.now());
    assert.deepEqual(result.spend, { calls: 1, tokens: 10, ms: 0, replayed: 0, physical: 0, unknownTokenCalls: 0 });
    const prompt = JSON.stringify(wire.requests);
    for (const secret of ['foreign-origin', 'foreign secret policy', 'hidden-topic', 'never disclose this held-out result', f.owner.lessonContext.input.question])
      assert.equal(prompt.includes(secret), false, secret);
    const captured = await h.capture(), replay = await proposeLessons(wire.options);
    assert.deepEqual(replay, result); assert.deepEqual(await h.capture(), captured);
  } finally { await h.close(); }
});

for (const kind of ['review', 'verification', 'intervention', 'attempt'] as const) it(`calls once for each eligible class including native ${kind}`, async () => {
  const h = await memoryHarness();
  try {
    const f = await alternateOriginFixture(h.store, kind), wire = script(h.store, f.lesson), result = await proposeLessons(wire.options);
    assert.deepEqual(result.refused, {}); assert.equal(result.proposals.length, 1); assert.equal(result.proposals[0].origin.kind, kind);
    assert.equal(result.spend.calls, 2); assert.equal(wire.requests.length, 2);
    assert.deepEqual(result.sources.filter(row => row.attempted).map(row => row.kind).sort(), [kind, 'decision'].sort());
  } finally { await h.close(); }
});
it('keeps a source-bound web proposal uncorroborated and cannot stage it', async () => {
  const h = await memoryHarness();
  try {
    const f = await webOriginFixture(h.store), wire = script(h.store, f.lesson), result = await proposeLessons(wire.options);
    assert.equal(result.proposals.length, 1); assert.equal(result.uncorroborated, 1); assert.deepEqual(result.refused, { TRSH2006: 1 });
    assert.equal(result.proposals[0].validation.state, 'proposed'); assert.equal(result.proposals[0].corroboration, null);
    assert.equal(result.spend.calls, 1); assert.equal(JSON.stringify(wire.requests).includes(f.corroborating.lesson.id), false);
    assert.ok(result.sources.every(row => row.nonRecordArtifacts === 1));
    const blocked = await createLessonRefiner(f.options).materialize({ proposalIds: [result.proposals[0].id] });
    assert.equal(blocked.valid, false); if (!blocked.valid) assert.equal(blocked.issues[0].code, 'TRSH2006');
  } finally { await h.close(); }
});

for (const key of ['validationTopics', 'validationRuns', 'lessons', 'otherLessons', 'hiddenResults', 'artifacts'])
  it(`refuses caller-supplied ${key} before any model call or write`, async () => {
    const h = await memoryHarness();
    try {
      const f = await correctionFixture(h.store), wire = script(h.store, f.lesson), before = await h.capture();
      const result = await proposeLessons({ ...wire.options, [key]: ['forbidden'] });
      assert.deepEqual(result.refused, { TRSH2005: 1 }); assert.equal(wire.requests.length, 0); assert.equal(result.spend.calls, 0);
      assert.deepEqual(await h.capture(), before);
    } finally { await h.close(); }
  });
it('refuses an artifact-shaped run selector and a mismatched run scope before generation', async () => {
  const h = await memoryHarness();
  try {
    const f = await correctionFixture(h.store), wire = script(h.store, f.lesson);
    const unsafe = { ...wire.options, run: { id: f.owner.id, validationTopics: ['hidden'] } };
    assert.deepEqual((await proposeLessons(unsafe as unknown as LessonProposerOptions)).refused, { TRSH2005: 1 });
    assert.deepEqual((await proposeLessons({ ...wire.options, profile: { ...lessonScope, taskFamily: 'unrelated' } })).refused, { TRSH2003: 1 });
    assert.equal(wire.requests.length, 0);
  } finally { await h.close(); }
});
for (const variant of ['uncommitted', 'ordinary-artifact', 'proceed'] as const) it(`does not call the model for ${variant} evidence`, async () => {
  const h = await memoryHarness();
  try {
    const f = variant === 'proceed' ? await correctionFixture(h.store, { kind: 'Proceed' })
      : await lessonFixture(h.store, { committed: variant !== 'uncommitted' });
    const wire = script(h.store, f.lesson), result = await proposeLessons(wire.options);
    assert.equal(wire.requests.length, 0); assert.equal(result.proposals.length, 0); assert.deepEqual(result.refused, {});
  } finally { await h.close(); }
});

const invalidDrafts: Array<[string, string, (value: ResearchLessonDraft) => void]> = [
  ['scope', 'TRSH2003', value => { value.scope.taskFamily = 'unrelated'; }],
  ['frozen base', 'TRSH2007', value => { value.proposal.baseHash = 'f'.repeat(64); }],
  ['class label', 'TRSH2002', value => { value.origin.kind = 'review'; }],
  ['foreign artifact', 'TRSH2002', value => { value.origin.envelope.artifacts[0].locator = 'other-admission'; }],
  ['unresolved claim', 'TRSH2002', value => { value.origin.envelope.claims[0].status = 'unresolved'; }],
  ['forged quote', 'TRSH2002', value => { value.origin.envelope.evidence[0].quote = 'A fabricated correction.'; }],
  ['unrelated selector', 'TRSH2002', value => { value.origin.envelope.evidence[0].selector = '/value/0/value/projectId'; value.origin.envelope.evidence[0].quote = 'guarded-origin'; }],
  ['oversized edit', 'TRSH2001', value => { value.proposal.edit.reasoning = 'x'.repeat(8193); }],
  ['forged validation', 'TRSH2001', value => { Object.assign(value, { validation: { state: 'validated' } }); }],
];
for (const [label, code, change] of invalidDrafts) it(`counts ${label} refusal without repair calls or proposal writes`, async () => {
  const h = await memoryHarness();
  try {
    const f = await correctionFixture(h.store), value = draft(f.lesson); change(value);
    const wire = script(h.store, f.lesson, value), before = await h.capture(), result = await proposeLessons(wire.options);
    assert.deepEqual(result.refused, { [code]: 1 }); assert.equal(result.proposals.length, 0); assert.equal(result.spend.calls, 1);
    assert.equal(wire.requests.length, 1); assert.deepEqual(await h.capture(), before);
  } finally { await h.close(); }
});
it('accepts the final allowed successful call and refuses the next eligible class', async () => {
  const h = await memoryHarness();
  try {
    const f = await alternateOriginFixture(h.store, 'attempt'), wire = script(h.store, f.lesson);
    wire.options.budget.calls = 1;
    const result = await proposeLessons(wire.options);
    assert.equal(result.proposals.length, 1); assert.equal(result.proposals[0].origin.kind, 'attempt');
    assert.deepEqual(result.refused, { TRSH1006: 1 }); assert.equal(result.spend.calls, 1);
  } finally { await h.close(); }
});
for (const limit of ['calls', 'tokens', 'ms', 'context', 'cancelled'] as const) it(`counts the ${limit} admission refusal without a physical call`, async () => {
  const h = await memoryHarness();
  try {
    const f = await correctionFixture(h.store), wire = script(h.store, f.lesson);
    if (limit === 'context') wire.options.maxContextChars = 1;
    else if (limit === 'cancelled') wire.options.signal = AbortSignal.abort();
    else wire.options.budget[limit] = 0;
    const result = await proposeLessons(wire.options);
    assert.deepEqual(result.refused, { TRSH1006: 1 }); assert.equal(result.spend.calls, 0); assert.equal(wire.requests.length, 0);
  } finally { await h.close(); }
});
it('retains failed-call reservations and distinguishes unknown usage from zero observed physical requests', async () => {
  const h = await memoryHarness();
  try {
    const f = await correctionFixture(h.store), wire = script(h.store, f.lesson);
    wire.options.client.complete = async () => { throw Object.assign(new Error('scripted transport failure'), { code: 'WIRE_FAILURE' }); };
    const result = await proposeLessons(wire.options);
    assert.deepEqual(result.refused, { TRSH1008: 1 }); assert.equal(result.issues[0].cause?.code, 'WIRE_FAILURE');
    assert.deepEqual(result.spend, { calls: 1, tokens: 0, ms: 0, replayed: 0, physical: 0, unknownTokenCalls: 1 });
  } finally { await h.close(); }
});
it('keeps native token estimates and cache replay counts separate from an unobserved transport', async () => {
  const h = await memoryHarness();
  try {
    const f = await correctionFixture(h.store), wire = script(h.store, f.lesson), original = wire.options.client.complete;
    delete wire.options.physicalRequests;
    wire.options.client.complete = async request => ({ ...await original(request), usage: undefined, replayed: { id: 'retained-completion' } });
    const result = await proposeLessons(wire.options);
    assert.equal(result.proposals.length, 1); assert.equal(result.spend.unknownTokenCalls, 1); assert.ok(result.spend.tokens! > 10);
    assert.equal(result.spend.physical, null); assert.equal(result.spend.replayed, 1);
  } finally { await h.close(); }
});
for (const dimension of ['tokens', 'ms', 'invalid-usage'] as const) it(`refuses post-dispatch ${dimension} without concealing spent work`, async () => {
  const h = await memoryHarness();
  try {
    const f = await correctionFixture(h.store), wire = script(h.store, f.lesson), original = wire.options.client.complete;
    let time = 0, physical = 0;
    wire.options.clock = () => time; wire.options.physicalRequests = () => physical;
    wire.options.client.complete = async request => {
      const completion = await original(request); physical += 2;
      if (dimension === 'ms') time = wire.options.budget.ms + 1;
      return { ...completion, usage: { total_tokens: dimension === 'invalid-usage' ? Infinity : dimension === 'tokens' ? wire.options.budget.tokens + 1 : 10 } };
    };
    const before = await h.capture(), result = await proposeLessons(wire.options);
    assert.deepEqual(result.refused, { [dimension === 'invalid-usage' ? 'TRSH1008' : 'TRSH1006']: 1 });
    assert.equal(result.proposals.length, 0); assert.equal(result.spend.calls, 1); assert.equal(result.spend.physical, 2);
    if (dimension === 'invalid-usage') assert.equal(result.spend.tokens, null);
    assert.deepEqual(await h.capture(), before);
  } finally { await h.close(); }
});
it('refuses non-JSON output once and preserves the supplied cancellation signal', async () => {
  const h = await memoryHarness();
  try {
    const f = await correctionFixture(h.store), wire = script(h.store, f.lesson), controller = new AbortController();
    let calls = 0; wire.options.signal = controller.signal;
    wire.options.client.complete = async raw => {
      calls++; assert.equal((raw as { signal: AbortSignal }).signal, controller.signal);
      return { message: { content: 'invalid JSON' }, usage: { total_tokens: 1 } };
    };
    const result = await proposeLessons(wire.options);
    assert.deepEqual(result.refused, { TRSH2001: 1 }); assert.equal(calls, 1); assert.equal(result.spend.tokens, 1);
    assert.equal(stored(await h.store.lessons.list({ projectId: f.owner.id })).length, 1);
    assert.equal(f.lesson.recordedAt, lessonNow);
  } finally { await h.close(); }
});
