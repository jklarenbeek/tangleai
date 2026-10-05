import assert from 'node:assert/strict';
import { it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryOutcomeStore, type OutcomeService } from '@tangleai/outcomes';
import { openTangleDb, createResearchStore, createOutcomeStore } from '@tangleai/store';
import { injectLessons, researchLessonManifest, planProjectCreate, planStateTransition, prepareResearchWorkflow,
  renderMarkdownBundle, rerunBundle, researchRevisionOf,
  RESEARCH_LESSON_DEFAULTS, RESEARCH_DOMAIN_LESSON_POLICIES, type ResearchStore, type ResearchOutcome } from '@tangleai/research';
import { id } from '../outcomes/fixtures.ts';
import { checked, project, manifest } from './fixtures.ts';
import { memoryHarness, stored } from './store-harness.ts';
import { lessonScope } from './lessons-store-fixtures.ts';
import { lessonOutcomeFixture } from './lessons-outcome-fixtures.ts';
import { reasoningWorkflowHarness } from './reasoning-workflow-fixtures.ts';
import { writingExportFixture } from './writing-fixtures.ts';

async function target(store: ResearchStore, name: string) {
  const owner = { ...project(name), lessonContext: { topicId: name + '-topic', taskFamily: lessonScope.taskFamily, input: { experiment: name } } };
  stored(await store.createProject(checked(planProjectCreate(owner)))); return owner;
}
function refusal(value: ResearchOutcome<unknown>, code: string) {
  assert.equal(value.valid, false, JSON.stringify(value));
  if (value.valid) throw Error('Expected refusal');
  assert.equal(value.issues[0].code, code); return value.issues[0];
}
for (const backend of ['memory', 'sqlite'] as const) it(backend + ' freezes a checked procedure and replays it after a later promotion', async () => {
  const h = backend === 'memory' ? await memoryHarness() : null, db = backend === 'sqlite' ? await openTangleDb() : null;
  const store = h?.store ?? createResearchStore(db!), outcomes = db ? createOutcomeStore(db) : createMemoryOutcomeStore();
  try {
    const f = await lessonOutcomeFixture(store, outcomes), root = await f.root(); await target(store, 'first-consumer');
    const request = { store, outcomes: f.service, profile: lessonScope, runId: 'first-consumer' };
    const first = checked(await injectLessons(request)); assert.equal(first.state, 'on'); assert.equal(first.replayed, false);
    assert.deepEqual(first.refused, {}); assert.equal(first.procedure!.injection!.activationEventId, root.activationEventId);
    assert.equal(first.procedure!.snapshot.bundle.id, f.staged.snapshot.bundle.id); assert.ok(Object.isFrozen(first.procedure));
    const state = stored(await store.getState('first-consumer'))!;
    stored(await store.transition(checked(planStateTransition(state, 'DISCOVERY'))));
    const child = await f.child(root.versionId), approvalId = id(await f.approve(child.versionId, child.evaluationId, root.head, 'child'), 'approvalId');
    await f.service.promote(f.command('promote-child', { approvalId }));
    const replay = checked(await injectLessons({ ...request, outcomes: f.service })); assert.equal(replay.replayed, true);
    assert.deepEqual(replay.procedure, first.procedure); assert.equal(stored(await store.lessons.listInjections('first-consumer')).length, 1);
    await target(store, 'next-consumer');
    const next = checked(await injectLessons({ ...request, outcomes: f.service, runId: 'next-consumer' }));
    assert.equal(next.procedure!.snapshot.bundle.id, child.next.snapshot.bundle.id);
    assert.notEqual(next.procedure!.injection!.id, first.procedure!.injection!.id);
    assert.deepEqual(checked(await researchLessonManifest(store, 'first-consumer')), { injected: [first.procedure!.injection], proposed: [], promoted: [] });
    const omitted = await store.putRecord('first-consumer', { kind: 'InputManifest', value: manifest('first-consumer') });
    assert.equal(omitted.ok, false); if (!omitted.ok) assert.equal(omitted.issue.code, 'TRSH2007');
    stored(await store.putRecord('first-consumer', { kind: 'InputManifest', value: { ...manifest('first-consumer'),
      lessonProcedure: { bundleHash: first.procedure!.snapshot.bundle.id, injection: first.procedure!.injection } } }));
  } finally { await h?.close(); await db?.close(); }
});
it('only a missing native head is counted as off; other failures, wrong scope and late injection are refused', async () => {
  const h = await memoryHarness();
  try {
    const f = await lessonOutcomeFixture(h.store, createMemoryOutcomeStore()); await target(h.store, 'control-consumer');
    const request = { store: h.store, outcomes: f.service, profile: lessonScope, runId: 'control-consumer', baseBundleHash: f.origin.snapshot.bundle.id };
    const off = checked(await injectLessons(request)); assert.equal(off.state, 'off'); assert.deepEqual(off.refused, { OUTC1004: 1 });
    assert.equal(off.procedure!.injection, null); assert.deepEqual(off.procedure!.snapshot, f.origin.snapshot);
    assert.deepEqual(RESEARCH_LESSON_DEFAULTS, { writeback: 'experimental-off', decayHypothesisId: 'none' });
    assert.equal(RESEARCH_DOMAIN_LESSON_POLICIES.computational, RESEARCH_LESSON_DEFAULTS);
    assert.ok(Object.isFrozen(RESEARCH_DOMAIN_LESSON_POLICIES));
    const failing = { ...f.service, injectChecked: async () => ({ ok: false as const,
      issues: [{ code: 'OUTC1015' as const, path: '/head', detail: 'Unavailable test store.', retryable: true }] }) } satisfies OutcomeService;
    assert.equal(refusal(await injectLessons({ ...request, outcomes: failing }), 'TRSH2007').cause?.code, 'OUTC1015');
    refusal(await injectLessons({ ...request, profile: { ...lessonScope, taskFamily: 'foreign' } }), 'TRSH2003');
    const state = stored(await h.store.getState(request.runId))!;
    stored(await h.store.transition(checked(planStateTransition(state, 'DISCOVERY'))));
    refusal(await injectLessons(request), 'TRSH2007'); assert.deepEqual(stored(await h.store.lessons.listInjections(request.runId)), []);
  } finally { await h.close(); }
});
it('scientific and exported provenance reproduce the same native injection and refuse omission or altered identity', async () => {
  const h = await memoryHarness();
  try {
    const f = await lessonOutcomeFixture(h.store, createMemoryOutcomeStore()); await f.root();
    const writing = await writingExportFixture(); await target(h.store, writing.input.projectId);
    const captured = checked(await injectLessons({ store: h.store, outcomes: f.service, profile: lessonScope, runId: writing.input.projectId }));
    const lessons = checked(await researchLessonManifest(h.store, writing.input.projectId));
    assert.deepEqual(lessons.injected, [captured.procedure!.injection]);
    const { manifestHash: _hash, ...body } = writing.scientific;
    const scientific = { ...body, lessons, manifestHash: await researchRevisionOf({ ...body, lessons }) };
    const source = { ...writing.source, provenance: { ...writing.source.provenance, lessons } };
    const bundle = checked(await renderMarkdownBundle(source, scientific));
    assert.deepEqual(bundle.manifest.source.provenance.lessons, lessons);
    assert.deepEqual(checked(await rerunBundle(bundle.manifest)).files, bundle.files);
    refusal(await renderMarkdownBundle(writing.source, scientific), 'TRSH2007');
    const altered = structuredClone(source); altered.provenance.lessons.injected[0].activationEventId = '0'.repeat(64);
    refusal(await renderMarkdownBundle(altered, scientific), 'TRSH2007');
    const alteredScience = { ...body, lessons: altered.provenance.lessons,
      manifestHash: await researchRevisionOf({ ...body, lessons: altered.provenance.lessons }) };
    refusal(await renderMarkdownBundle(altered, alteredScience), 'TRSH2007');
  } finally { await h.close(); }
});

for (const active of [true, false]) it('native roles, skill reads and SQLite recovery retain the ' + (active ? 'activated' : 'baseline') + ' procedure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'research-injection-'));
  let fixture: Awaited<ReturnType<typeof lessonOutcomeFixture>> | undefined, asked = false, inspected = false;
  const h = await reasoningWorkflowHarness('single-agent', { path: join(dir, 'research.sqlite'), lessons: async (store, owner, masStore) => {
    if (!fixture) { fixture = await lessonOutcomeFixture(store, createMemoryOutcomeStore()); if (active) await fixture.root(); }
    return checked(await injectLessons({ store, outcomes: fixture.service, profile: lessonScope, runId: owner.id,
      baseBundleHash: fixture.origin.snapshot.bundle.id, masStore })).procedure!;
  }, client: (base, node) => ({ ...base, complete: async request => {
    const completion = await base.complete(request);
    if (node.role !== 'research-synthesizer') return completion;
    if (!asked) { asked = true; return { ...completion, message: { role: 'assistant', content: '', toolCalls: [
      { id: 'root-page', name: 'skill_read', arguments: JSON.stringify({ path: 'SKILL.md' }) },
      { id: 'policy-page', name: 'skill_read', arguments: JSON.stringify({ path: 'references/seed-policy.md' }) },
    ] }, finishReason: 'tool_calls' }; }
    const messages = (request as { messages: Array<{ role: string; content: string }> }).messages;
    if (!inspected && messages.at(-1)?.role === 'tool') {
      inspected = true; const replies = messages.filter(row => row.role === 'tool').map(row => row.content);
      assert.match(replies[0], /Retain every registered result/);
      assert.match(replies[1], active ? /Retain every registered seed output/ : /TT2S1005/);
    }
    return completion;
  } }) });
  try {
    const originalBinding = h.binding, originalRegistry = h.prepared.snapshot.revision;
    await assert.rejects(prepareResearchWorkflow(h.f.bounds.contract, { binding: h.binding, profile: 'research-scripted', limits: h.limits,
      lessons: structuredClone(h.prepared.lessons!) }), /TRSH2007/);
    await h.start(); assert.equal((await h.segment()).run.status, 'waiting_for_input');
    if (!active) {
      await fixture!.root();
      refusal(await injectLessons({ store: h.host.researchStore, outcomes: fixture!.service, profile: lessonScope,
        runId: h.owner.id, baseBundleHash: fixture!.staged.snapshot.bundle.id }), 'TRSH2007');
    }
    await h.reopen(); assert.deepEqual(h.binding, originalBinding); assert.equal(h.prepared.snapshot.revision, originalRegistry);
    await h.respond(); const trace = await h.segment(), snapshot = await h.snapshot();
    assert.equal(trace.run.status, 'waiting_for_input', JSON.stringify(trace.run.failure)); assert.equal(inspected, true);
    assert.equal(h.calls, 7); assert.ok(h.systems.every(system => system.includes('# Research procedure')));
    const manifests = snapshot.records.filter(row => row.kind === 'InputManifest'); assert.ok(manifests.length > 2);
    for (const row of manifests) assert.deepEqual(row.value.lessonProcedure, h.binding.lessonProcedure);
    const tools = trace.attempts.flatMap(row => row.toolSteps); assert.deepEqual(tools.map(row => row.name), ['skill_read', 'skill_read']);
    await assert.rejects(async () => h.host.bindings.toolBindings.skill_read.handler({ path: 'SKILL.md' }, {
      signal: new AbortController().signal, idempotencyKey: null, invocation: { runId: 'foreign', node: 'model', path: 'foreign/model' } }), /TRSH2005/);
  } finally { await h.close(); await rm(dir, { recursive: true, force: true }); }
});

it('SQLite restart before the first stage preserves the off procedure captured in the native root', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'research-injection-root-'));
  let fixture: Awaited<ReturnType<typeof lessonOutcomeFixture>> | undefined;
  const h = await reasoningWorkflowHarness('single-agent', { path: join(dir, 'research.sqlite'), lessons: async (store, owner, masStore) => {
    fixture ??= await lessonOutcomeFixture(store, createMemoryOutcomeStore());
    return checked(await injectLessons({ store, outcomes: fixture.service, masStore, profile: lessonScope,
      runId: owner.id, baseBundleHash: fixture.origin.snapshot.bundle.id })).procedure!;
  } });
  try {
    await h.start(); const original = h.binding; assert.equal((await h.snapshot()).attempts.length, 0);
    await fixture!.root(); await h.reopen(); assert.deepEqual(h.binding, original);
    assert.equal(h.prepared.lessons!.injection, null); assert.equal((await h.segment()).run.status, 'waiting_for_input');
    await h.respond(); assert.equal((await h.segment()).run.status, 'waiting_for_input');
    assert.equal(h.calls, 6); assert.equal(stored(await h.host.researchStore.lessons.listInjections(h.owner.id)).length, 0);
  } finally { await h.close(); await rm(dir, { recursive: true, force: true }); }
});
