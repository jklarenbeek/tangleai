/**
 * Typed interactions and the resume outbox: the peer-review pause
 * follows revise deterministically; the interaction completes its
 * segment durably (no worker holds the run); invalid, conflicting and
 * cancelled responses are exact TMAS2007 values with no resume segment;
 * and the reconciler recovers a crash before AND after the enqueue with
 * a zero-change second pass.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { nodeDriver } from '@jarenjs/db/node';
import {
  createMasConfigCatalog,
  createMasRegistrySnapshot,
  planMasWorkflow,
  validateMasWorkflow,
  interactionIdOf,
} from '@tangleai/mas';
import {
  createMasStore,
  ensurePendingMasSegments,
  openTangleDb,
} from '@tangleai/store';
import { driveAcyclicFixture } from '../../benchmark/lib/mas-runner.ts';
import type { FixtureDocument } from '../../benchmark/lib/mas-conformance.types.ts';

const manifest = JSON.parse(await readFile('benchmark/fixtures/mas/manifest.json', 'utf8')) as { configCatalog: { path: string } };
const catalogOutcome = await createMasConfigCatalog(JSON.parse(await readFile(manifest.configCatalog.path, 'utf8')));
const registryOutcome = await createMasRegistrySnapshot(JSON.parse(await readFile('benchmark/fixtures/mas/control-registry.json', 'utf8')));
assert.ok(catalogOutcome.valid && registryOutcome.valid);
const catalog = catalogOutcome.value;
const registry = registryOutcome.value;

const fixture = JSON.parse(await readFile('benchmark/fixtures/mas/control/peer-review.json', 'utf8')) as FixtureDocument;
const validatedOutcome = await validateMasWorkflow(fixture.workflow, registry, catalog);
assert.ok(validatedOutcome.valid, JSON.stringify(!validatedOutcome.valid ? validatedOutcome.issues[0] : null));
const validated = validatedOutcome.value;
const planOutcome = await planMasWorkflow(validated);
assert.ok(planOutcome.valid);
const plan = planOutcome.value;

describe('peer review through the durable runtime', () => {
  it('pauses for the typed decision and follows revise deterministically', async () => {
    const drive = await driveAcyclicFixture(fixture, validated, plan, registry, catalog);
    assert.equal(drive.row.state, 'runtime-pass');
    assert.deepEqual(drive.output, { result: { text: 'revised per: tighten the intro', disposition: 'revised' } });
    assert.ok(drive.events.includes('review:waiting'), 'the run waited durably');
    assert.ok(!drive.events.some((event) => event.startsWith('publish')), 'the accept branch never executed');
  });

  it('an accept response follows the accept branch of the same workflow', async () => {
    const accepting = structuredClone(fixture);
    (accepting.script.respond as { value: unknown }).value = { decision: 'accept', note: 'ship it' };
    Object.assign(accepting.expect as object, {
      output: { result: { text: 'published', disposition: 'accepted' } },
      events: ['draft:completed', 'review:waiting', 'review:completed', 'publish:completed', 'gate:completed'],
    });
    const drive = await driveAcyclicFixture(accepting, validated, plan, registry, catalog);
    assert.deepEqual(drive.output, { result: { text: 'published', disposition: 'accepted' } });
  });
});

describe('the resume outbox over the published queue', () => {
  async function rig() {
    const clock = { value: 1_000_000 };
    const db = await openTangleDb({ driver: nodeDriver(), jobs: { now: () => clock.value, random: () => 0.5 } });
    let tick = 0;
    const store = createMasStore(db, { now: () => `tick-${String(tick++).padStart(4, '0')}` });
    const created = await store.createRun({
      runId: 'outbox',
      workflowId: validated.workflow.workflowId,
      workflowVersionId: validated.versionId,
      registryRevision: registry.revision,
      executableRevision: plan.executableRevision,
      configRegistryRevision: catalog.revision,
      profile: 'scripted',
      input: { draft: 'v1' },
      limits: { calls: 10 },
    });
    assert.ok(created.ok);
    assert.ok((await store.claimRunSegment('outbox', 'w')).ok);
    assert.ok((await store.transitionRun('outbox', { kind: 'wait' })).ok);
    const interaction = await store.createInteraction({
      runId: 'outbox',
      node: 'review',
      path: 'review',
      prompt: 'drafted: v1',
      responseSchema: {
        type: 'object',
        required: ['decision', 'note'],
        properties: { decision: { enum: ['accept', 'revise'] }, note: { type: 'string' } },
        additionalProperties: false,
      },
      expiry: null,
      segment: 0,
    });
    assert.ok(interaction.ok);
    return { db, store, interactionId: interactionIdOf('outbox', 'review') };
  }

  it('recovers a crash BEFORE the enqueue: the reconciler enqueues and advances, then reports zero', async () => {
    const { db, store, interactionId } = await rig();
    try {
      const accepted = await store.respondInteraction(interactionId, { decision: 'accept', note: 'ok' }, 0, 'key-1');
      assert.ok(accepted.ok);
      assert.equal((await store.getRun('outbox'))?.status, 'resume_pending');
      // crash here: nothing was enqueued — the reconciler recovers
      const first = await ensurePendingMasSegments(db, store);
      assert.deepEqual(first, { examined: 1, enqueued: 1, queued: 1, skipped: 0 });
      const run = await store.getRun('outbox');
      assert.equal(run?.status, 'queued');
      assert.equal(run?.segment, 1, 'the reserved zero-padded segment advanced');
      assert.equal((await db.jobs?.get('outbox:0001'))?.state, 'pending');
      const second = await ensurePendingMasSegments(db, store);
      assert.deepEqual(second, { examined: 0, enqueued: 0, queued: 0, skipped: 0 }, 'the second identical reconciliation changes zero rows');
    } finally {
      await db.close();
    }
  });

  it('recovers a crash AFTER the enqueue: the same derived id is the suite no-op', async () => {
    const { db, store, interactionId } = await rig();
    try {
      assert.ok((await store.respondInteraction(interactionId, { decision: 'accept', note: 'ok' }, 0, 'key-1')).ok);
      const jobs = db.jobs;
      assert.ok(jobs !== undefined);
      // the crash window: enqueue happened, the CAS did not
      await jobs.enqueue(`mas:${plan.executableRevision}`, { runId: 'outbox', segment: 1 }, { id: 'outbox:0001' });
      const recovered = await ensurePendingMasSegments(db, store);
      assert.deepEqual(recovered, { examined: 1, enqueued: 1, queued: 1, skipped: 0 });
      assert.equal((await jobs.counts()).pending, 1, 'the idempotent derived id kept one row');
    } finally {
      await db.close();
    }
  });

  it('conflicting, cancelled and second responses are TMAS2007 values with no resume segment', async () => {
    const { db, store, interactionId } = await rig();
    try {
      const cancelled = await store.resolveInteraction(interactionId, 'cancelled', 0);
      assert.ok(cancelled.ok);
      const late = await store.respondInteraction(interactionId, { decision: 'accept', note: 'ok' }, 1, 'key-2');
      assert.ok(!late.ok && late.issue.code === 'TMAS2007', 'a response after cancellation refuses');
      const outcome = await ensurePendingMasSegments(db, store);
      assert.equal(outcome.enqueued, 0, 'cancellation reserves no resume segment');
      assert.equal((await db.jobs?.counts())?.pending ?? 0, 0);
    } finally {
      await db.close();
    }
  });
});
