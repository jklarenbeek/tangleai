/**
 * The fence: one explicit call, one applied activation, and five candidates
 * that must not reach the head. Nothing here decides that a directory is good
 * — it decides whether the verdict, the registration and the head agree.
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import {
  activateCandidate, createMemoryTrace2SkillStore, listActivations, rollbackHead,
  type SkillEvaluation, type SkillHead, type SkillPromotionRegistration, type Trace2SkillStore,
} from '@tangleai/trace2skill';
import { createTrace2SkillDbStore } from '@tangleai/store';
import { openTangleDb } from '@tangleai/store';
import { lifecycleRecords, SCOPE } from './fixture.ts';

const SEATED: SkillHead = { versionId: null, revision: 0 };

async function seeded(store: Trace2SkillStore) {
  const records = await lifecycleRecords();
  assert.ok((await store.putSnapshot(records.frozen)).valid);
  assert.ok((await store.markBundle(records.frozen.bundle.id, 'eligible')).valid);
  assert.ok((await store.activate(SCOPE, SEATED, records.frozen.bundle.id)).valid);
  assert.ok((await store.putStagedCandidate(records.evolved, records.candidate)).valid);
  assert.ok((await store.markBundle(records.evolved.bundle.id, 'eligible')).valid);
  const head = await store.head(SCOPE);
  const evaluation: SkillEvaluation = { ...records.evaluation, expectedHead: head };
  assert.ok((await store.putEvaluation(evaluation)).valid);
  const registration: SkillPromotionRegistration = {
    scopeKey: SCOPE, executorIdentityId: evaluation.executorIdentityId,
    policyVersion: evaluation.policyVersion, testHash: evaluation.testHash, expectedHead: head,
  };
  return { records, evaluation, registration, head };
}

/** A variant of the recorded verdict that fails exactly one clause. */
async function forged(evaluation: SkillEvaluation, over: Partial<SkillEvaluation>): Promise<SkillEvaluation> {
  const payload = { ...evaluation, ...over, runId: await canonicalSha256({ of: evaluation.id, over }) };
  return { ...payload, id: await canonicalSha256(payload as unknown as Record<string, unknown>) };
}

it('an eligible candidate activates exactly once and the head revision increments by one', async () => {
  const store = createMemoryTrace2SkillStore();
  const { records, evaluation, registration, head } = await seeded(store);
  const result = await activateCandidate(store, {
    scopeKey: SCOPE, candidateId: records.candidate.id, evaluationId: evaluation.id, registration, actor: 'test',
  });
  assert.equal(result.outcome, 'activated', JSON.stringify(result.issues));
  assert.deepEqual(result.head, { versionId: records.evolved.bundle.id, revision: head.revision + 1 });
  assert.equal(result.event?.outcome, 'activated');
  assert.deepEqual(result.event?.previousHead, head);
  assert.equal((await store.getBundle(records.evolved.bundle.id)).valid, true);

  // The superseded directory stays readable, byte for byte.
  const prior = await store.getSnapshot(records.frozen.bundle.id);
  assert.ok(prior.valid);
  assert.equal(prior.value.bundle.status, 'archived');
  const source = await readFile(join('benchmark/fixtures/trace2skill/skills/s0-human', 'SKILL.md'), 'utf8');
  assert.equal(prior.value.files.find(file => file.path === 'SKILL.md')?.content, source);
});

it('regressing, under-covered, over-budget, evaluation-failed and stale-parent candidates never reach the head', async () => {
  const store = createMemoryTrace2SkillStore();
  const { records, evaluation, registration } = await seeded(store);
  const clause = (path: string) => [{ code: 'TT2S1010' as const, path, detail: `the gate refused at ${path}` }];
  const variants: Array<[string, SkillEvaluation]> = [
    ['regressing', await forged(evaluation, { meanDelta: -1, eligible: false, issues: clause('/meanDelta') })],
    ['under-covered', await forged(evaluation, { skips: 4, eligible: false, issues: clause('/minAnsweredCoverage') })],
    ['over-budget', await forged(evaluation, { costDelta: 1e6, eligible: false, issues: clause('/costCeiling') })],
    ['evaluation-failed', await forged(evaluation, { leakage: 1 })],
  ];
  for (const [scenario, row] of variants) {
    assert.ok((await store.putEvaluation(row)).valid, scenario);
    const before = await store.head(SCOPE);
    const result = await activateCandidate(store, {
      scopeKey: SCOPE, candidateId: records.candidate.id, evaluationId: row.id, registration, actor: 'test',
    });
    assert.equal(result.outcome, 'refused', scenario);
    assert.equal(result.issues[0].code, scenario === 'evaluation-failed' ? 'TT2S1006' : 'TT2S1010', scenario);
    assert.deepEqual(await store.head(SCOPE), before, scenario);
    const prior = await store.getSnapshot(records.frozen.bundle.id);
    assert.ok(prior.valid && prior.value.bundle.status === 'active', scenario);
    assert.equal((await store.getBundle(records.evolved.bundle.id)).valid, true, scenario);
  }

  // A stale parent: the same request once the head has already moved on.
  assert.equal((await activateCandidate(store, {
    scopeKey: SCOPE, candidateId: records.candidate.id, evaluationId: evaluation.id, registration, actor: 'test',
  })).outcome, 'activated');
  const moved = await store.head(SCOPE);
  const stale = await activateCandidate(store, {
    scopeKey: SCOPE, candidateId: records.candidate.id, evaluationId: evaluation.id, registration, actor: 'test',
  });
  assert.equal(stale.outcome, 'refused');
  assert.equal(stale.issues[0].code, 'TT2S1010');
  assert.equal(stale.issues[0].path, '/parentId');
  assert.deepEqual(await store.head(SCOPE), moved);

  // Every attempt is an event, refusals included.
  const events = await listActivations(store, SCOPE);
  assert.equal(events.length, 6);
  assert.equal(events.filter(event => event.outcome === 'activated').length, 1);
  assert.equal(events.filter(event => event.outcome === 'refused').length, 5);
});

it('an unknown candidate, an unknown evaluation and a policy the registration did not name are refused', async () => {
  const store = createMemoryTrace2SkillStore();
  const { records, evaluation, registration } = await seeded(store);
  const missing = await activateCandidate(store, {
    scopeKey: SCOPE, candidateId: '0'.repeat(64), evaluationId: evaluation.id, registration, actor: 'test',
  });
  assert.equal(missing.outcome, 'refused');
  assert.equal(missing.event, null, 'an unresolved request records no event about a candidate it never read');
  const unknown = await activateCandidate(store, {
    scopeKey: SCOPE, candidateId: records.candidate.id, evaluationId: '0'.repeat(64), registration, actor: 'test',
  });
  assert.equal(unknown.outcome, 'refused');
  const other = await activateCandidate(store, {
    scopeKey: SCOPE, candidateId: records.candidate.id, evaluationId: evaluation.id,
    registration: { ...registration, policyVersion: 'another-gate' }, actor: 'test',
  });
  assert.equal(other.outcome, 'refused');
  assert.equal(other.issues[0].path, '/policyVersion');
  assert.deepEqual(await store.head(SCOPE), registration.expectedHead);
});

it('twenty concurrent activations apply exactly once on both stores and a stale revision is refused', async () => {
  const db = await openTangleDb();
  try {
    for (const store of [createMemoryTrace2SkillStore(), createTrace2SkillDbStore(db)]) {
      const { records, evaluation, registration } = await seeded(store);
      const request = {
        scopeKey: SCOPE, candidateId: records.candidate.id, evaluationId: evaluation.id, registration, actor: 'test',
      };
      // The right version with the wrong revision is the ABA a fence exists for.
      const aba = await store.activate(SCOPE, { versionId: records.frozen.bundle.id, revision: 0 }, records.evolved.bundle.id);
      assert.ok(!aba.valid);
      assert.equal(aba.issues[0].cause?.code, 'OUTC1013');
      assert.deepEqual(await store.head(SCOPE), registration.expectedHead, 'a stale fence moves nothing');

      const race = await Promise.all(Array.from({ length: 20 }, () => activateCandidate(store, request)));
      assert.equal(race.filter(result => result.outcome === 'activated').length, 1);
      assert.deepEqual(await store.head(SCOPE), { versionId: records.evolved.bundle.id, revision: 2 });
      assert.equal((await listActivations(store, SCOPE)).filter(event => event.outcome === 'activated').length, 1);
    }
  }
  finally { await db.close(); }
});

it('the directory a scope served before can be reinstated, under the same fence', async () => {
  const store = createMemoryTrace2SkillStore();
  const { records, evaluation, registration } = await seeded(store);
  const promotion = await activateCandidate(store, {
    scopeKey: SCOPE, candidateId: records.candidate.id, evaluationId: evaluation.id, registration, actor: 'test',
  });
  assert.equal(promotion.outcome, 'activated', JSON.stringify(promotion.issues));
  const promoted = await store.head(SCOPE);
  assert.deepEqual(promoted, { versionId: records.evolved.bundle.id, revision: 2 });
  assert.equal((await store.getBundle(records.frozen.bundle.id) as { value: { status: string } }).value.status, 'archived');

  // A stale fence moves nothing, and neither does naming the directory that
  // is already active or one that was never active.
  const stale = await rollbackHead(store, { scopeKey: SCOPE, bundleId: records.frozen.bundle.id, expectedHead: { versionId: records.evolved.bundle.id, revision: 1 }, actor: 'operator' });
  assert.equal(stale.outcome, 'refused');
  assert.equal(stale.issues[0].code, 'TT2S1010');
  assert.deepEqual(await store.head(SCOPE), promoted);
  const itself = await rollbackHead(store, { scopeKey: SCOPE, bundleId: records.evolved.bundle.id, expectedHead: promoted, actor: 'operator' });
  assert.equal(itself.outcome, 'refused');
  assert.deepEqual(await store.head(SCOPE), promoted);

  const back = await rollbackHead(store, { scopeKey: SCOPE, bundleId: records.frozen.bundle.id, expectedHead: promoted, actor: 'operator' });
  assert.equal(back.outcome, 'activated', JSON.stringify(back.issues));
  assert.deepEqual(await store.head(SCOPE), { versionId: records.frozen.bundle.id, revision: 3 });
  assert.equal((await store.getBundle(records.frozen.bundle.id) as { value: { status: string } }).value.status, 'active');
  assert.equal((await store.getBundle(records.evolved.bundle.id) as { value: { status: string } }).value.status, 'archived');
  // The rolled-back-over directory stays readable, pages and all.
  const superseded = await store.getSnapshot(records.evolved.bundle.id);
  assert.ok(superseded.valid, 'a rolled-back directory was deleted');

  // Every attempt is an event, and a rollback names no evaluation because none
  // authorized it: it is a host decision to stop serving what is active.
  const events = await listActivations(store, SCOPE);
  const rollbacks = events.filter(event => event.action === 'rollback');
  assert.equal(rollbacks.length, 3);
  assert.equal(rollbacks.filter(event => event.outcome === 'activated').length, 1);
  for (const event of rollbacks) assert.equal(event.evaluationId, null);

  // Twenty callers racing the same reinstatement produce exactly one move.
  const forward = await rollbackHead(store, { scopeKey: SCOPE, bundleId: records.evolved.bundle.id, expectedHead: await store.head(SCOPE), actor: 'operator' });
  assert.equal(forward.outcome, 'activated');
  const fence = await store.head(SCOPE);
  const race = await Promise.all(Array.from({ length: 20 }, () =>
    rollbackHead(store, { scopeKey: SCOPE, bundleId: records.frozen.bundle.id, expectedHead: fence, actor: 'operator' })));
  assert.equal(race.filter(result => result.outcome === 'activated').length, 1);
  assert.deepEqual(await store.head(SCOPE), { versionId: records.frozen.bundle.id, revision: 5 });
});

it('exactly one head-transition planner serves the package', async () => {
  const root = 'packages/trace2skill/src';
  const sources = (await readdir(root, { recursive: true, withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.endsWith('.ts'))
    .map(entry => join(entry.parentPath, entry.name).slice(root.length + 1));
  assert.ok(sources.length > 15, 'the whole package source tree is scanned');
  let importers = 0;
  let arithmetic = 0;
  for (const name of sources) {
    const text = await readFile(join(root, name), 'utf8');
    if (text.includes('planHeadTransition')) importers++;
    if (/revision\s*\+\s*1|revision\s*\+=/.test(text)) arithmetic++;
  }
  assert.equal(importers, 1, 'only the transition guard names the head planner');
  assert.equal(arithmetic, 0, 'no module does its own revision arithmetic');
  const guards = await readFile(join('packages/trace2skill/src', 'transitions.ts'), 'utf8');
  assert.ok(guards.includes("from '@tangleai/outcomes'"), 'the planner is imported, never forked');
});
