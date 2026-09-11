/**
 * Switch semantics through the real durable runtime: one-of document
 * order with an explicit default, multi-select declaration-order merge
 * with a deliberately untaken EFFECTFUL branch recording zero
 * attempts/calls/spend, and a Jaren guard evaluation error surfacing
 * with its exact JF code as a control failure — never a false branch.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { nodeDriver } from '@jarenjs/db/node';
import {
  compileMasRuntime,
  createMasConfigCatalog,
  createMasRegistrySnapshot,
  planMasWorkflow,
  validateMasWorkflow,
  type MasWorkflowPlan,
} from '@tangleai/mas';
import { createMasSegmentHandlers, createMasStore, enqueueMasSegment, openTangleDb } from '@tangleai/store';
import { driveAcyclicFixture } from '../../benchmark/lib/mas-runner.ts';
import type { FixtureDocument } from '../../benchmark/lib/mas-conformance.types.ts';

const manifest = JSON.parse(await readFile('benchmark/fixtures/mas/manifest.json', 'utf8')) as { registry: { path: string }, configCatalog: { path: string } };
const snapshotOutcome = await createMasRegistrySnapshot(JSON.parse(await readFile(manifest.registry.path, 'utf8')));
const catalogOutcome = await createMasConfigCatalog(JSON.parse(await readFile(manifest.configCatalog.path, 'utf8')));
assert.ok(snapshotOutcome.valid && catalogOutcome.valid);
const snapshot = snapshotOutcome.value;
const catalog = catalogOutcome.value;

const controlRegistry = await createMasRegistrySnapshot(JSON.parse(await readFile('benchmark/fixtures/mas/control-registry.json', 'utf8')));
assert.ok(controlRegistry.valid);

async function prepared(path: string, registry = snapshot) {
  const fixture = JSON.parse(await readFile(path, 'utf8')) as FixtureDocument;
  const validated = await validateMasWorkflow(fixture.workflow, registry, catalog);
  assert.ok(validated.valid, JSON.stringify(!validated.valid ? validated.issues[0] : null));
  const plan = await planMasWorkflow(validated.value);
  assert.ok(plan.valid);
  return { fixture, validated: validated.value, plan: plan.value, registry };
}

describe('one-of and multi-select through the runtime', () => {
  it('the untaken effectful branch records zero attempts, calls, checkpoints and spend', async () => {
    const { fixture, validated, plan } = await prepared('benchmark/fixtures/mas/control/multi-select-untaken.json', controlRegistry.value);
    const drive = await driveAcyclicFixture(fixture, validated, plan, controlRegistry.value, catalog);
    assert.equal(drive.row.state, 'runtime-pass');
    assert.ok(!drive.events.some((event) => event.startsWith('do-gamma')), 'the untaken branch produced no event');
    assert.deepEqual(drive.spend, { turns: 0, tokens: 0, ms: 0 }, 'no spend anywhere — and none from the untaken effectful branch');
    assert.deepEqual(drive.output, { result: [{ branch: 'alpha' }, { branch: 'beta' }] }, 'merge is declaration order under reverse completion');
  });

  it('the switch merge is durable: indexed messages name the ordered sources', async () => {
    const { fixture, validated, plan } = await prepared('benchmark/fixtures/mas/positive/switch-many.json');
    const drive = await driveAcyclicFixture(fixture, validated, plan, snapshot, catalog);
    const merge = drive.messagesBrief.filter((message) => message.to === 'fan.results').sort((a, b) => a.index - b.index);
    assert.deepEqual(merge.map((message) => message.from), ['do-alpha', 'do-beta']);
  });
});

describe('a guard evaluation error is a control failure with its Jaren code', () => {
  it('fails the control attempt as JF2003, never a false branch', async () => {
    const { fixture, validated, plan } = await prepared('benchmark/fixtures/mas/positive/switch-one.json');
    // Tamper the LOWERED machine only: a guard that throws at evaluation
    // time (integer division by zero) — the host must surface the recorded
    // JF2003 with its docPath, not treat the transition as unselected.
    const tampered: MasWorkflowPlan = structuredClone(plan);
    const document = tampered.documents['switch:route'] as { transitions: Array<{ guard?: unknown }> };
    document.transitions[0].guard = { $idiv: [1, 0] };

    const clock = { value: 1_000_000 };
    const db = await openTangleDb({ driver: nodeDriver(), jobs: { now: () => clock.value, random: () => 0.5 } });
    try {
      let tick = 0;
      const store = createMasStore(db, { now: () => `tick-${String(tick++).padStart(4, '0')}` });
      await store.createRun({
        runId: 'guard-error',
        workflowId: validated.workflow.workflowId,
        workflowVersionId: validated.versionId,
        registryRevision: snapshot.revision,
        executableRevision: tampered.executableRevision,
        configRegistryRevision: catalog.revision,
        profile: 'scripted',
        input: fixture.script.input,
        limits: validated.workflow.limits as unknown as Record<string, number>,
      });
      const runtime = compileMasRuntime(validated, tampered, snapshot, {
        store,
        taskHandlers: { scripted: async () => ({ out: { handled: 'low', n: 4 } }) },
        toolBindings: {},
        contextProviders: {},
        now: () => `tick-${String(tick++).padStart(4, '0')}`,
        clock: () => clock.value,
        deadlineFor: () => 'tick-9999',
      });
      assert.ok(runtime.valid);
      await enqueueMasSegment(db, {
        runId: 'guard-error', segment: 0,
        workflowVersionId: validated.versionId, registryRevision: snapshot.revision, executableRevision: tampered.executableRevision,
      });
      const handlers = createMasSegmentHandlers(store, {
        executableRevisions: [tampered.executableRevision],
        execute: (segment) => runtime.value.executeSegment(segment),
        owner: 'guard',
      });
      const jobs = db.jobs;
      assert.ok(jobs !== undefined);
      const kind = Object.keys(handlers)[0];
      const job = await jobs.claim({ kinds: [kind], owner: 'w', leaseMs: 60_000 });
      assert.ok(job !== undefined);
      await handlers[kind](job.payload, { job, checkpoints: jobs.checkpointsFor(job), signal: new AbortController().signal } as never);
      await jobs.complete(job.lease, null);

      const run = await store.getRun('guard-error');
      assert.equal(run?.status, 'failed');
      assert.equal(run?.failure?.error.code, 'TMAS2004');
      assert.equal(run?.failure?.error.cause?.code, 'JF2003', 'the recorded guard failure keeps its exact Jaren code');
      assert.ok((run?.failure?.error.cause?.docPath ?? '').length > 0, 'and its docPath');
      const trace = await store.readTrace('guard-error');
      const attempt = trace?.attempts.find((row) => row.invocationId === 'route');
      assert.equal(attempt?.status, 'failed', 'the control attempt failed — the error was not mistaken for a false guard');
    } finally {
      await db.close();
    }
  });
});
