/**
 * One scenario, two stores, identical answers.
 *
 * The scenario is written once and run against the in-memory reference and
 * against SQLite, and the two transcripts are compared as bytes. That is
 * stronger than asserting each store separately: a behaviour that drifts in
 * only one of them fails here even if nobody thought to assert it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMemoryEvolveStore, sealRecord, type EvolveStore } from '@tangleai/evolve';
import { createEvolveStore, openTangleDb } from '@tangleai/store';

const REVISION = 'a'.repeat(40);

const experimentPayload = {
  schemaVersion: 1, kind: 'experiment', experimentId: 'e1', repositoryId: 'tangle',
  baseRevision: REVISION, strategyId: 's1', proposalId: 'p1', status: 'proposed',
  runIdentityId: 'run/1', revision: 0, history: [],
};

const patchPayload = (patchId: string, bytes: number) => ({
  schemaVersion: 1, kind: 'patch', patchId,
  operations: [{ op: 'replace', path: '/files/src/rank.js', value: 'x' }], files: 1, bytes,
});

const proposalPayload = {
  schemaVersion: 1, kind: 'proposal', proposalId: 'p1', experimentId: 'e1',
  strategyId: 's1', patchId: 'patch1', rationale: 'narrow the loop', evidence: [],
  origin: 'hand-authored', configuration: { kind: 'scripted', revision: 'r1' },
};

/** Every observable answer, in order, as plain JSON. */
async function transcript(store: EvolveStore): Promise<unknown[]> {
  const out: unknown[] = [];
  const patchA = await sealRecord<{ id: string }>(patchPayload('patch1', 10));
  const patchB = await sealRecord<{ id: string }>(patchPayload('patch2', 20));
  const proposal = await sealRecord<{ id: string }>(proposalPayload);
  const experiment = await sealRecord<{ id: string, revision: number }>(experimentPayload);
  assert.ok(patchA.ok && patchB.ok && proposal.ok && experiment.ok);

  // Immutable writes, then the same bytes again: the second is a read.
  out.push(['put patchA', (await store.putRecord(patchA.value)).ok]);
  out.push(['put patchA again', await store.putRecord(patchA.value)]);
  out.push(['put patchB', (await store.putRecord(patchB.value)).ok]);
  out.push(['put proposal', (await store.putRecord(proposal.value)).ok]);

  // Different bytes under an id that exists is a refusal, never a rewrite.
  const forged = { ...patchA.value, bytes: 99 } as Record<string, unknown>;
  out.push(['forged', await store.putRecord(forged)]);

  out.push(['list patches', (await store.listRecords({ kind: 'patch' })).ok]);
  const patches = await store.listRecords({ kind: 'patch' });
  out.push(['patch order', patches.ok ? patches.value.map(row => (row as { patchId: string }).patchId) : patches]);
  const byExperiment = await store.listRecords({ kind: 'proposal', experimentId: 'e1' });
  out.push(['proposals for e1', byExperiment.ok ? byExperiment.value.length : byExperiment]);
  const otherExperiment = await store.listRecords({ kind: 'proposal', experimentId: 'nope' });
  out.push(['proposals for nope', otherExperiment.ok ? otherExperiment.value.length : otherExperiment]);

  out.push(['get patchA', ((await store.getRecord(patchA.value.id)) as { value: { patchId: string } | null }).value?.patchId ?? null]);
  out.push(['get missing', ((await store.getRecord('z'.repeat(64))) as { value: unknown }).value]);

  // Semantic uniqueness: one experiment per repository, base and proposal.
  out.push(['put key', await store.putKey('experiment', 'tangle ' + REVISION + ' p1', 'e1')]);
  out.push(['put key again', await store.putKey('experiment', 'tangle ' + REVISION + ' p1', 'e1')]);
  out.push(['put key conflict', await store.putKey('experiment', 'tangle ' + REVISION + ' p1', 'e2')]);
  out.push(['get key', await store.getKey('experiment', 'tangle ' + REVISION + ' p1')]);
  out.push(['get missing key', await store.getKey('experiment', 'absent')]);

  // The experiment row, and its fence.
  out.push(['create experiment', (await store.putRecord(experiment.value)).ok]);
  out.push(['create again', await store.putRecord(experiment.value)]);
  const isolated = await store.transitionExperiment('e1', 'isolate', 0);
  out.push(['isolate', isolated.ok ? { status: isolated.value.status, revision: isolated.value.revision, history: isolated.value.history.length } : isolated]);
  out.push(['stale isolate', await store.transitionExperiment('e1', 'isolate', 0)]);
  out.push(['illegal record', await store.transitionExperiment('e1', 'record', 1)]);
  out.push(['unknown experiment', await store.transitionExperiment('missing', 'isolate', 0)]);
  const applied = await store.transitionExperiment('e1', 'apply', 1);
  out.push(['apply', applied.ok ? { status: applied.value.status, revision: applied.value.revision } : applied]);
  const held = await store.getExperiment('e1');
  out.push(['held', held.ok && held.value ? { status: held.value.status, revision: held.value.revision } : held]);
  return out;
}

describe('evolve store parity', () => {
  it('the memory reference and SQLite answer the same scenario identically', async () => {
    const memory = await transcript(createMemoryEvolveStore());

    const dir = await mkdtemp(join(tmpdir(), 'tangle-evolve-'));
    const db = await openTangleDb({ path: join(dir, 'evolve.sqlite') });
    try {
      const persistent = await transcript(createEvolveStore(db));
      assert.deepEqual(persistent, memory, 'the two stores must not drift');
      // Parity alone would pass if both stores were wrong in the same way.
      // The next test asserts what the answers actually are.
      assert.ok(memory.length > 20, 'the scenario exercises the whole contract');
    }
    finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refuses a rewrite, a stale fence and an illegal step by code', async () => {
    const store = createMemoryEvolveStore();
    const rows = await transcript(store);
    const byName = new Map(rows.map(row => (row as [string, unknown])));

    const forged = byName.get('forged') as { ok: boolean, issues: Array<{ code: string, path: string }> };
    assert.equal(forged.ok, false);
    assert.equal(forged.issues[0].code, 'TEVO1002', 'different bytes under an existing id');

    const conflict = byName.get('put key conflict') as { ok: boolean, issues: Array<{ code: string }> };
    assert.equal(conflict.ok, false);
    assert.equal(conflict.issues[0].code, 'TEVO1002');

    const stale = byName.get('stale isolate') as { ok: boolean, issues: Array<{ code: string, path: string }> };
    assert.equal(stale.ok, false);
    assert.equal(stale.issues[0].code, 'TEVO1010');
    assert.equal(stale.issues[0].path, '/revision', 'the fence is what refused');

    const illegal = byName.get('illegal record') as { ok: boolean, issues: Array<{ code: string, path: string }> };
    assert.equal(illegal.ok, false);
    assert.equal(illegal.issues[0].path, '/status');

    const unknown = byName.get('unknown experiment') as { ok: boolean, issues: Array<{ code: string, path: string }> };
    assert.equal(unknown.ok, false);
    assert.equal(unknown.issues[0].path, '/experimentId');

    const again = byName.get('put patchA again') as { ok: boolean, value: { writes: number } };
    assert.equal(again.ok, true);
    assert.equal(again.value.writes, 0, 'the same bytes twice is a read');

    const created = byName.get('create again') as { ok: boolean, value: { writes: number } };
    assert.equal(created.value.writes, 0);

    assert.deepEqual(byName.get('patch order'), ['patch1', 'patch2'], 'listing follows write order');
  });
});
