/**
 * Nested graph semantics: namespace-isolated state where only declared
 * pull/push members cross, the child cannot observe or mutate another
 * parent member, expanded trace names parent and child identities, and
 * a nested failure carries the child workflow identity to the surface.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createMasConfigCatalog,
  createMasRegistrySnapshot,
  planMasWorkflow,
  validateMasWorkflow,
} from '@tangleai/mas';
import { driveAcyclicFixture } from '../../benchmark/lib/mas-runner.ts';
import type { FixtureDocument } from '../../benchmark/lib/mas-conformance.types.ts';

const manifest = JSON.parse(await readFile('benchmark/fixtures/mas/manifest.json', 'utf8')) as { registry: { path: string }, configCatalog: { path: string } };
const snapshotOutcome = await createMasRegistrySnapshot(JSON.parse(await readFile(manifest.registry.path, 'utf8')));
const catalogOutcome = await createMasConfigCatalog(JSON.parse(await readFile(manifest.configCatalog.path, 'utf8')));
assert.ok(snapshotOutcome.valid && catalogOutcome.valid);
const snapshot = snapshotOutcome.value;
const catalog = catalogOutcome.value;

const fixture = JSON.parse(await readFile('benchmark/fixtures/mas/positive/nested-state.json', 'utf8')) as FixtureDocument;
const validatedOutcome = await validateMasWorkflow(fixture.workflow, snapshot, catalog);
assert.ok(validatedOutcome.valid);
const validated = validatedOutcome.value;
const planOutcome = await planMasWorkflow(validated);
assert.ok(planOutcome.valid);
const plan = planOutcome.value;

// The runner closes its database, so state isolation is proven through a
// second bespoke drive that keeps the store open for trace inspection.
import { nodeDriver } from '@jarenjs/db/node';
import { compileMasRuntime, type MasTaskInput } from '@tangleai/mas';
import { compileJsonQuery } from '@jarenjs/json/query';
import { createMasSegmentHandlers, createMasStore, enqueueMasSegment, openTangleDb } from '@tangleai/store';

describe('nested graph state', () => {
  it('passes its registered oracle through the shared runner', async () => {
    const drive = await driveAcyclicFixture(fixture, validated, plan, snapshot, catalog);
    assert.equal(drive.row.state, 'runtime-pass');
    assert.deepEqual(drive.output, { result: { visible: 8 } });
    assert.deepEqual(drive.events, ['sub/work:completed', 'sub:completed', 'read-out:completed'], 'expanded trace names parent and child paths');
  });

  it('isolates namespaces: the child sees only its pull, pushes only its declaration, and hidden survives untouched', async () => {
    const clock = { value: 1_000_000 };
    const db = await openTangleDb({ driver: nodeDriver(), jobs: { now: () => clock.value, random: () => 0.5 } });
    try {
      let tick = 0;
      const store = createMasStore(db, { now: () => `tick-${String(tick++).padStart(4, '0')}` });
      await store.createRun({
        runId: 'ns',
        workflowId: validated.workflow.workflowId,
        workflowVersionId: validated.versionId,
        registryRevision: snapshot.revision,
        executableRevision: plan.executableRevision,
        configRegistryRevision: catalog.revision,
        profile: 'scripted',
        input: fixture.script.input,
        limits: validated.workflow.limits as unknown as Record<string, number>,
      });
      const queries = new Map(Object.entries(fixture.script.handlers).map(([key, handler]) => [key, compileJsonQuery(handler.query as Record<string, unknown>) as (value: unknown) => unknown]));
      const childSaw: unknown[] = [];
      const runtime = compileMasRuntime(validated, plan, snapshot, {
        store,
        taskHandlers: {
          scripted: async ({ value, path }: MasTaskInput) => {
            if (path === 'sub/work') childSaw.push(structuredClone(value));
            const key = path.split('/').filter((segment) => !/^\d+$/.test(segment)).join('/');
            return (queries.get(key) as (value: unknown) => unknown)(value);
          },
        },
        toolBindings: {},
        contextProviders: {},
        now: () => `tick-${String(tick++).padStart(4, '0')}`,
        clock: () => clock.value,
        deadlineFor: () => 'tick-9999',
      });
      assert.ok(runtime.valid);
      await enqueueMasSegment(db, {
        runId: 'ns', segment: 0,
        workflowVersionId: validated.versionId, registryRevision: snapshot.revision, executableRevision: plan.executableRevision,
      });
      const handlers = createMasSegmentHandlers(store, {
        executableRevisions: [plan.executableRevision],
        execute: (segment) => runtime.value.executeSegment(segment),
        owner: 'ns',
      });
      const jobs = db.jobs;
      assert.ok(jobs !== undefined);
      const kind = Object.keys(handlers)[0];
      const job = await jobs.claim({ kinds: [kind], owner: 'w', leaseMs: 60_000 });
      assert.ok(job !== undefined);
      await handlers[kind](job.payload, { job, checkpoints: jobs.checkpointsFor(job), signal: new AbortController().signal } as never);
      await jobs.complete(job.lease, null);

      // The child observed only its declared pull — never `hidden`.
      assert.equal(childSaw.length, 1);
      const seen = childSaw[0] as Record<string, unknown>;
      assert.equal(seen.inherited, 7, 'the pulled member arrived');
      assert.ok(!('hidden' in seen) && !('visible' in seen), 'no undeclared parent member is observable');

      const trace = await store.readTrace('ns');
      const namespaces = new Set(trace?.stateRevisions.map((revision) => revision.namespace));
      assert.ok(namespaces.has('sub'), 'the child pushed into its own namespace');
      assert.ok(namespaces.has(''), 'the graph completion pushed the declared parent member');
      const parentState = trace?.stateRevisions.filter((revision) => revision.namespace === '').at(-1)?.value as { visible: number, hidden: number };
      assert.deepEqual(parentState, { visible: 8, hidden: 99 }, 'only the declared member moved; hidden survives untouched');
      const childState = trace?.stateRevisions.filter((revision) => revision.namespace === 'sub').at(-1)?.value as Record<string, unknown>;
      assert.ok(!('hidden' in childState), 'the child namespace never held the undeclared member');
    } finally {
      await db.close();
    }
  });

  it('a nested failure names the parent invocation and the child workflow identity', async () => {
    const failing = structuredClone(fixture);
    failing.script.failAt = 'work';
    Object.assign(failing.expect as object, { outcome: 'failed', output: null, failure: { node: 'sub' } });
    const drive = await driveAcyclicFixture(failing, validated, plan, snapshot, catalog, { relaxEventOracle: true });
    assert.equal(drive.output, null);
    assert.ok(drive.events.includes('sub:failed'), 'the parent graph invocation records the failure');
  });
});
