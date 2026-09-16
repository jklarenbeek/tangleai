/**
 * The lifecycle version against a real store, and the resume path.
 *
 * Two properties are checked here that no unit test can reach.
 *
 * EVOLVE registers exactly ONE immutable version and never activates it
 * as a head. That is not a detail: an active head is a moving target, and
 * a workflow whose head can move is a workflow whose experiments were not
 * all run under the same rules. Storing without activating keeps the
 * version addressable and the campaign comparable.
 *
 * And resume is the SUITE's path, not a second one. `ensurePendingMasSegments`
 * is the reconciler that turns a responded interaction into a queued
 * segment, and its second identical call must report zeros — that is the
 * two-run/no-change surface the whole crash story rests on.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { nodeDriver } from '@jarenjs/db/node';
import {
  createMasStore, openTangleDb, ensurePendingMasSegments, type TangleDb,
} from '@tangleai/store';
import { createMasRegistrySnapshot, createMasConfigCatalog } from '@tangleai/mas';

import { buildEvolveLifecycle, evolveRegistryDocument, EVOLVE_WORKFLOW_ID } from '@tangleai/evolve/lifecycle';

const EXECUTABLE = 'e'.repeat(64);

async function lifecycleVersion() {
  const registry = await createMasRegistrySnapshot(evolveRegistryDocument());
  assert.ok(registry.valid);
  const catalog = await createMasConfigCatalog({ profiles: ['evolve'], tools: [], contexts: [] });
  assert.ok(catalog.valid);
  const workflow = await buildEvolveLifecycle({
    experimentMs: 600000,
    registryRevision: registry.value.revision,
    configRegistryRevision: catalog.value.revision,
    profile: 'evolve',
  });
  return { workflow, registry: registry.value, catalog: catalog.value };
}

async function rig(): Promise<{ db: TangleDb, store: ReturnType<typeof createMasStore> }> {
  const clock = { value: 1_000_000 };
  const db = await openTangleDb({
    driver: nodeDriver(),
    jobs: { now: () => clock.value, random: () => 0.5 },
  });
  let tick = 0;
  const store = createMasStore(db, { now: () => `tick-${String(tick++).padStart(4, '0')}` });
  return { db, store };
}

describe('the lifecycle version in a real store', () => {
  it('stores one immutable version and activates no head', async () => {
    const { db, store } = await rig();
    try {
      const { workflow } = await lifecycleVersion();
      const put = await store.putWorkflowVersion(workflow);
      assert.ok(put.ok, 'the authored version is storable as-is');
      assert.equal(put.value.versionId, workflow.versionId,
        'the store agrees with the author about the identity');

      const active = await store.getActiveWorkflow(EVOLVE_WORKFLOW_ID);
      assert.ok(active === undefined || active.activeVersion === null,
        'no head is activated — an active head is a moving target, and experiments '
        + 'run under a moving target are not comparable with each other');
    } finally { await db.close(); }
  });

  it('stores the same version twice without creating a second one', async () => {
    const { db, store } = await rig();
    try {
      const { workflow } = await lifecycleVersion();
      const first = await store.putWorkflowVersion(workflow);
      const second = await store.putWorkflowVersion(workflow);
      assert.ok(first.ok && second.ok);
      assert.equal(second.value.versionId, first.value.versionId,
        'writing identical bytes under the same identity is a read');
    } finally { await db.close(); }
  });

  it('creates a run bound to that exact version', async () => {
    const { db, store } = await rig();
    try {
      const { workflow, registry } = await lifecycleVersion();
      await store.putWorkflowVersion(workflow);
      const created = await store.createRun({
        runId: 'evolve-run-1',
        workflowId: workflow.workflowId,
        workflowVersionId: workflow.versionId,
        registryRevision: registry.revision,
        executableRevision: EXECUTABLE,
        configRegistryRevision: null,
        profile: 'evolve',
        input: { env: { experimentId: 'exp-1', proposalId: 'p', strategyId: 's' } },
        limits: { calls: 10 },
      } as never);
      assert.ok(created.ok, 'the run binds the version it will run under');

      const run = await store.getRun('evolve-run-1');
      assert.equal(run?.workflowVersionId, workflow.versionId);
    } finally { await db.close(); }
  });
});

describe('the resume reconciler', () => {
  it('reports zeros when there is nothing pending, twice over', async () => {
    const { db, store } = await rig();
    try {
      // Resume is the suite's own path and this package adds no second
      // one. With no responded interaction there is nothing to enqueue,
      // and the reconciler must say so rather than guessing.
      const first = await ensurePendingMasSegments(db, store);
      const second = await ensurePendingMasSegments(db, store);
      assert.deepEqual(first, second,
        'the reconciler is a function of the store, not of how often it ran');
      assert.equal(first.enqueued, 0);
      assert.equal(first.queued, 0);
    } finally { await db.close(); }
  });
});
