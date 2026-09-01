/**
 * The MAS runtime conformance instrument — registered BEFORE the runtime.
 *
 * The instrument predates the capability and its registration never
 * moves: 11 positive workflows with exact output/event/aggregation/
 * concurrency/call oracles and 7 negative workflows with reserved
 * refusal codes and pointers, loaded under recomputed canonical
 * revisions. The suite probes prove the published JarenJS substrate
 * primitives directly, and the integrated rows state exactly how far
 * `@tangleai/mas` has come — `validated` (the canonical IR validates
 * and lowers to a complete frozen region plan) and
 * `refused-as-registered` today, `runtime-pass` only when a fixture's
 * full registered oracle holds. Suite availability is never presented
 * as an implemented framework and missing capability is never hidden.
 *
 * Keyless and clock-free by construction: no fetch, no provider, no
 * Date. Probe timing is driven by deferred promises and injected
 * clocks; concurrency is measured by an entry/exit counter, never
 * inferred from durations. Two runs over the same tree render
 * byte-identical JSON, Markdown and query output.
 */

import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';

import { canonicalSha256 } from '@jarenjs/json/canonical';
import { compileJsonQuery } from '@jarenjs/json/query';
import { compileDag, compileFsm, createFsmSession, snapshotFsm, resumeFsmSession } from '@jarenjs/flow';
import { defineDag, defineFsm, edge, input, on, output, state, task, typedTasks } from '@jarenjs/linq/flow';
import { openStore } from '@jarenjs/db';
import { nodeDriver } from '@jarenjs/db/node';
import { createBudgetAccount } from '@jarenjs/ai';

import {
  createMasConfigCatalog,
  createMasRegistrySnapshot,
  masWorkflowVersionIdOf,
  planMasWorkflow,
  validateMasWorkflow,
  type CommitCompletionPlan,
  type MasWorkflow,
} from '@tangleai/mas';
import {
  createMasSegmentHandlers,
  createMasStore,
  enqueueMasSegment,
  namespacedRegionCheckpoints,
  openTangleDb,
} from '@tangleai/store';

// The package owns the one canonical version rule; the instrument re-exports
// it so the registration tests recompute through the same path.
export { masWorkflowVersionIdOf };

import { runAcyclicFixture } from './mas-runner.ts';
import { createReportValidator, describeErrors } from './validate.ts';
import masConformanceSchema from '../schemas/mas-conformance.schema.json' with { type: 'json' };
import type {
  DurabilityProbe,
  FixtureDocument,
  IntegratedRow,
  Manifest,
  MasConformance,
  RegisteredFixture,
  SuiteProbe,
} from './mas-conformance.types.ts';

const exec = promisify(execFile);

export const MANIFEST_PATH = 'benchmark/fixtures/mas/manifest.json';
export const REPORT_PATH = 'benchmark/results/mas-conformance.json';
export const BASELINE_QUERY_PATH = 'queries/mas/runtime-baseline.json';
export const BASELINE_PATH = 'benchmark/results/mas-runtime-baseline.json';
export const DOCUMENT_PATH = 'docs/MAS_RUNTIME_BENCHMARK.md';

// ---------------------------------------------------------------------------
// the explicit source manifest — what this instrument's behavior reads
// ---------------------------------------------------------------------------

export const SOURCE_MANIFEST: readonly string[] = [
  'benchmark/fixtures/mas/config-catalog.json',
  'benchmark/fixtures/mas/manifest.json',
  'benchmark/fixtures/mas/negative/child-over-budget.json',
  'benchmark/fixtures/mas/negative/incompatible-wire.json',
  'benchmark/fixtures/mas/negative/plain-cycle.json',
  'benchmark/fixtures/mas/negative/switch-no-default.json',
  'benchmark/fixtures/mas/negative/unbounded-loop.json',
  'benchmark/fixtures/mas/negative/undeclared-tool.json',
  'benchmark/fixtures/mas/negative/unknown-port.json',
  'benchmark/fixtures/mas/positive/checkpoint.json',
  'benchmark/fixtures/mas/positive/failure-abort.json',
  'benchmark/fixtures/mas/positive/fanout-fanin.json',
  'benchmark/fixtures/mas/positive/interaction.json',
  'benchmark/fixtures/mas/positive/loop-three.json',
  'benchmark/fixtures/mas/positive/message-order.json',
  'benchmark/fixtures/mas/positive/nested-state.json',
  'benchmark/fixtures/mas/positive/sequential.json',
  'benchmark/fixtures/mas/positive/switch-many.json',
  'benchmark/fixtures/mas/positive/switch-one.json',
  'benchmark/fixtures/mas/positive/weekly-report-manual.json',
  'benchmark/fixtures/mas/registry.json',
  'benchmark/lib/mas-conformance.ts',
  'benchmark/lib/mas-conformance.types.ts',
  'benchmark/lib/mas-runner.ts',
  'benchmark/lib/validate.ts',
  'benchmark/mas-conformance.ts',
  'benchmark/schemas/mas-conformance.schema.json',
  'benchmark/scripts/mas-fixtures.ts',
  'queries/mas/runtime-baseline.json',
];

/** HEAD, cleanliness, and the digest of every manifest file. No clock. */
export async function conformanceSource(root = process.cwd()): Promise<MasConformance['source']> {
  const head = (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  const clean = (await exec('git', ['status', '--porcelain'], { cwd: root })).stdout.trim() === '';
  const files: Array<{ path: string, sha256: string }> = [];
  for (const path of [...SOURCE_MANIFEST].sort()) {
    const bytes = await readFile(join(root, path));
    files.push({ path, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  return { head, clean, files, sha256: await canonicalSha256({ head, files }) };
}

/** Installed `@jarenjs/*` packages, name-sorted — the suite pin census. */
export async function suitePackages(root = process.cwd()): Promise<MasConformance['suite']> {
  const dir = join(root, 'node_modules', '@jarenjs');
  const names = (await readdir(dir)).filter((name) => !name.startsWith('.')).sort();
  const packages: Array<{ name: string, version: string }> = [];
  for (const name of names) {
    const manifest = JSON.parse(await readFile(join(dir, name, 'package.json'), 'utf8')) as { version: string };
    packages.push({ name: `@jarenjs/${name}`, version: manifest.version });
  }
  return { packages };
}

// ---------------------------------------------------------------------------
// fixture loading — validated, revisions recomputed
// ---------------------------------------------------------------------------

const manifestValidator = createReportValidator(
  { $ref: 'https://tangleai.dev/schemas/mas-conformance#/$defs/manifest' },
  [masConformanceSchema as object],
);
const fixtureValidator = createReportValidator(
  { $ref: 'https://tangleai.dev/schemas/mas-conformance#/$defs/fixtureDocument' },
  [masConformanceSchema as object],
);

export interface LoadedFixtures {
  manifest: Manifest;
  manifestRevision: string;
  registry: Record<string, unknown>;
  registryRevision: string;
  configCatalog: Record<string, unknown>;
  configCatalogRevision: string;
  /** In registration order: all positive entries, then all negative entries. */
  fixtures: Array<{ document: FixtureDocument, revision: string, workflowVersionId: string }>;
}

export async function loadFixtures(root = process.cwd()): Promise<LoadedFixtures> {
  const manifest = JSON.parse(await readFile(join(root, MANIFEST_PATH), 'utf8')) as Manifest;
  const manifestOutcome = manifestValidator(manifest);
  if (!manifestOutcome.valid) {
    throw new Error(`the MAS fixture manifest does not validate: ${describeErrors(manifestOutcome, 5).join('; ')}`);
  }
  const manifestRevision = await canonicalSha256(manifest);

  const registry = JSON.parse(await readFile(join(root, manifest.registry.path), 'utf8')) as Record<string, unknown>;
  const registryRevision = await canonicalSha256(registry);
  if (registryRevision !== manifest.registry.revision) {
    throw new Error(`the fixture registry does not recompute to its manifest revision (${registryRevision.slice(0, 12)}… != ${manifest.registry.revision.slice(0, 12)}…)`);
  }
  const configCatalog = JSON.parse(await readFile(join(root, manifest.configCatalog.path), 'utf8')) as Record<string, unknown>;
  const configCatalogRevision = await canonicalSha256(configCatalog);
  if (configCatalogRevision !== manifest.configCatalog.revision) {
    throw new Error('the fixture CONFIG catalog does not recompute to its manifest revision');
  }

  const fixtures: LoadedFixtures['fixtures'] = [];
  for (const entry of [...manifest.positive, ...manifest.negative]) {
    const document = JSON.parse(await readFile(join(root, entry.path), 'utf8')) as FixtureDocument;
    const outcome = fixtureValidator(document);
    if (!outcome.valid) {
      throw new Error(`fixture ${entry.id} does not validate: ${describeErrors(outcome, 5).join('; ')}`);
    }
    if (document.id !== entry.id) {
      throw new Error(`fixture at ${entry.path} declares id '${document.id}', the manifest says '${entry.id}'`);
    }
    const revision = await canonicalSha256(document);
    if (revision !== entry.revision) {
      throw new Error(`fixture ${entry.id} does not recompute to its registered revision`);
    }
    const workflow = document.workflow as Record<string, unknown>;
    const workflowVersionId = await masWorkflowVersionIdOf(workflow);
    if (workflowVersionId !== workflow.versionId) {
      throw new Error(`fixture ${entry.id} carries a versionId that does not recompute from its semantic payload`);
    }
    fixtures.push({ document, revision, workflowVersionId });
  }
  return { manifest, manifestRevision, registry, registryRevision, configCatalog, configCatalogRevision, fixtures };
}

export function registrationOf(loaded: LoadedFixtures): MasConformance['registration'] {
  return {
    manifestRevision: loaded.manifestRevision,
    registryRevision: loaded.registryRevision,
    configCatalogRevision: loaded.configCatalogRevision,
    positive: 11,
    negative: 7,
    fixtures: loaded.fixtures.map(({ document, revision, workflowVersionId }): RegisteredFixture => ({
      id: document.id,
      family: document.family,
      title: document.title,
      revision,
      workflowVersionId,
      expect: document.expect,
    })),
  };
}

// ---------------------------------------------------------------------------
// suite probes — published primitives, controlled promises, injected clocks
// ---------------------------------------------------------------------------

interface Deferred<T = void> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

interface GateControl {
  /** Resolves when every listed handler entered. */
  allEntered: Promise<void>;
  enter: (id: string) => Promise<void>;
  release: (id: string) => void;
}

/** A concurrency gate over deferred promises — never a sleep. */
function createGate(ids: readonly string[]): GateControl {
  const entries = new Map<string, Deferred>(ids.map((id) => [id, deferred()]));
  const entered = new Set<string>();
  const all = deferred();
  return {
    allEntered: all.promise,
    enter(id) {
      entered.add(id);
      if (entered.size === ids.length) all.resolve();
      const gate = entries.get(id);
      if (gate === undefined) throw new Error(`gate: unknown id '${id}'`);
      return gate.promise;
    },
    release(id) {
      const gate = entries.get(id);
      if (gate === undefined) throw new Error(`gate: unknown id '${id}'`);
      gate.resolve();
    },
  };
}

/** The fan-out/fan-in probe document, written through the published pen. */
function fanDag() {
  return defineDag({
    nodes: {
      seed: input(),
      a: task('stepA'),
      b: task('stepB'),
      c: task('stepC'),
      d: task('join'),
      out: output(),
    },
    edges: [
      edge('seed', 'a'),
      edge('seed', 'b'),
      edge('seed', 'c'),
      edge('a', 'd', { port: 'a' }),
      edge('b', 'd', { port: 'b' }),
      edge('c', 'd', { port: 'c' }),
      edge('d', 'out'),
    ],
  });
}

interface FanRun {
  maxConcurrency: number;
  portOrder: string[];
  result: unknown;
}

async function runFanProbe(settleOrder: readonly string[]): Promise<FanRun> {
  const graph = fanDag();
  const gate = createGate(['a', 'b', 'c']);
  let inFlight = 0;
  let maxConcurrency = 0;
  let portOrder: string[] = [];
  const step = (id: 'a' | 'b' | 'c') => async ({ input: value }: { with: unknown, input: unknown }) => {
    inFlight += 1;
    maxConcurrency = Math.max(maxConcurrency, inFlight);
    try {
      await gate.enter(id);
      return { branch: id, seed: value };
    } finally {
      inFlight -= 1;
    }
  };
  const compiled = compileDag(graph, {
    tasks: typedTasks(graph, {
      stepA: step('a'),
      stepB: step('b'),
      stepC: step('c'),
      join: ({ input: value }) => {
        portOrder = Object.keys(value as Record<string, unknown>);
        return value;
      },
    }),
  });
  const run = compiled.run('s');
  await gate.allEntered;
  for (const id of settleOrder) gate.release(id);
  const result = await run;
  return { maxConcurrency, portOrder, result };
}

async function probeDagFanout(): Promise<SuiteProbe> {
  const { maxConcurrency, portOrder } = await runFanProbe(['a', 'b', 'c']);
  const pass = maxConcurrency === 3 && portOrder.join(',') === 'a,b,c';
  return {
    id: 'dag-fanout-concurrency',
    title: 'compileDag runs independent branches concurrently',
    state: 'substrate',
    outcome: pass ? 'pass' : 'fail',
    observed: pass
      ? 'three gated handlers were in flight together (entry/exit counter reached exactly 3) before any settled'
      : `expected concurrency 3 over ports a,b,c; measured ${maxConcurrency} over ${portOrder.join(',')}`,
    measured: { maxConcurrency, portOrder },
  };
}

async function probeDagFaninOrder(): Promise<SuiteProbe> {
  const settleOrder = ['c', 'b', 'a'];
  const { portOrder, result } = await runFanProbe(settleOrder);
  const branches = Object.values(result as Record<string, { branch: string }>).map((item) => item.branch);
  const pass = portOrder.join(',') === 'a,b,c' && branches.join(',') === 'a,b,c';
  return {
    id: 'dag-fanin-edge-order',
    title: 'ported fan-in assembles members in edge document order',
    state: 'substrate',
    outcome: pass ? 'pass' : 'fail',
    observed: pass
      ? 'settling c, b, a still delivered the port object as a, b, c — completion order cannot change a value'
      : `ports arrived as ${portOrder.join(',')} with branches ${branches.join(',')}`,
    measured: { settleOrder: [...settleOrder], portOrder, branches },
  };
}

async function probeDagAbort(): Promise<SuiteProbe> {
  const graph = defineDag({
    nodes: {
      seed: input(),
      boom: task('boom'),
      linger: task('linger'),
      merge: task('merge'),
      out: output(),
    },
    edges: [
      edge('seed', 'boom'),
      edge('seed', 'linger'),
      edge('boom', 'merge', { port: 'a' }),
      edge('linger', 'merge', { port: 'b' }),
      edge('merge', 'out'),
    ],
  });
  const gate = createGate(['boom', 'linger']);
  const siblingAborted = deferred<boolean>();
  const records: Record<string, string> = {};
  const compiled = compileDag(graph, {
    tasks: typedTasks(graph, {
      boom: async () => {
        await gate.enter('boom');
        throw new Error('scripted failure');
      },
      linger: (_props, signal) => new Promise((_resolve, reject) => {
        void gate.enter('linger');
        signal.addEventListener('abort', () => {
          siblingAborted.resolve(true);
          reject(signal.reason ?? new Error('aborted'));
        }, { once: true });
      }),
      merge: ({ input: value }) => value,
    }),
  });
  let failure: { code?: string, nodeId?: string } | null = null;
  const run = compiled.run('s', {
    onNode: (record) => { records[record.id] = record.status; },
  }).catch((error: { code?: string, nodeId?: string }) => { failure = error; });
  await gate.allEntered;
  gate.release('boom');
  await run;
  const aborted = await siblingAborted.promise;
  const seen = failure as { code?: string, nodeId?: string } | null;
  const pass = seen !== null && seen.code === 'JF2006' && seen.nodeId === 'boom'
    && aborted && records.boom === 'error' && records.linger === 'aborted';
  return {
    id: 'dag-abort-siblings',
    title: 'the first failing node rejects the run and aborts concurrent siblings',
    state: 'substrate',
    outcome: pass ? 'pass' : 'fail',
    observed: pass
      ? 'the scripted failure rejected as JF2006 naming its node; the gated sibling observed the shared abort signal and recorded aborted'
      : `failure ${JSON.stringify({ code: seen?.code, nodeId: seen?.nodeId })}, records ${JSON.stringify(records)}`,
    measured: { code: seen?.code ?? null, nodeId: seen?.nodeId ?? null, siblingAborted: aborted, records },
  };
}

async function probeDagCheckpointRestore(): Promise<SuiteProbe> {
  const graph = defineDag({
    nodes: {
      seed: input(),
      paid: task('paid').checkpoint(),
      wrap: task('wrap'),
      out: output(),
    },
    edges: [
      edge('seed', 'paid'),
      edge('paid', 'wrap'),
      edge('wrap', 'out'),
    ],
  });
  let paidCalls = 0;
  const saved = new Map<string, Record<string, unknown>>();
  const completes: unknown[] = [];
  const store = {
    load: (runId: string) => (saved.has(runId) ? { values: { ...saved.get(runId) } } : null),
    save: (runId: string, nodeId: string, value: unknown) => {
      const values = saved.get(runId) ?? {};
      values[nodeId] = value;
      saved.set(runId, values);
    },
    complete: (runId: string, result: unknown) => { completes.push({ runId, result }); },
  };
  const compiled = compileDag(graph, {
    tasks: typedTasks(graph, {
      paid: () => {
        paidCalls += 1;
        return { bought: true };
      },
      wrap: ({ input: value }) => ({ wrapped: value }),
    }),
    checkpoint: store,
  });
  const first = await compiled.run('s', { runId: 'probe-run' });
  const firstCalls = paidCalls;
  const restored: string[] = [];
  const second = await compiled.run('s', {
    runId: 'probe-run',
    onNode: (record) => { if (record.status === 'restored') restored.push(record.id); },
  });
  const pass = firstCalls === 1 && paidCalls === 1 && restored.includes('paid')
    && JSON.stringify(first) === JSON.stringify(second) && completes.length === 2;
  return {
    id: 'dag-checkpoint-restore',
    title: 'a declared checkpoint restores instead of re-running the paid node',
    state: 'substrate',
    outcome: pass ? 'pass' : 'fail',
    observed: pass
      ? 'the resumed run seeded the checkpointed value, fired a restored record and made zero duplicate handler calls'
      : `first-run calls ${firstCalls}, total calls ${paidCalls}, restored ${restored.join(',') || '(none)'}`,
    measured: { firstRunCalls: firstCalls, totalCalls: paidCalls, restored, savedNodes: Object.keys(saved.get('probe-run') ?? {}) },
  };
}

async function probeFsmOrderResume(): Promise<SuiteProbe> {
  const machine = defineFsm({
    initial: 'idle',
    states: ['idle', 'first', 'second', state('done', { final: true })],
    transitions: [
      on('idle', 'go').when({ $eq: ['$.payload.ready', true] }).to('first'),
      on('idle', 'go').to('second'),
      on('first', 'finish').to('done'),
    ],
  });
  const fsm = compileFsm(machine);
  const session = createFsmSession(fsm);
  const stepped = session.send('go', { payload: { ready: true } });
  const snapshot = snapshotFsm(session);
  const resumed = resumeFsmSession(fsm, snapshot);
  const finished = resumed.send('finish');
  const pass = stepped.state === 'first' && snapshot.state === 'first'
    && resumed.state === 'done' && finished.final === true && finished.errors.length === 0;
  return {
    id: 'fsm-document-order-resume',
    title: 'compileFsm selects by document order and resumes from a snapshot',
    state: 'substrate',
    outcome: pass ? 'pass' : 'fail',
    observed: pass
      ? 'two matching transitions resolved to the first in document order; the snapshot string resumed the session to its final state'
      : `selected ${stepped.state}, snapshot ${snapshot.state}, resumed ${resumed.state}`,
    measured: { selected: stepped.state, snapshot: snapshot.state, resumedFinal: finished.final },
  };
}

async function probeDbJobReclaim(): Promise<SuiteProbe> {
  let clock = 1000;
  const model = {
    $model: '0.1',
    collections: {
      probe: { schema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }, key: '/id' },
    },
  };
  const store = await openStore(model, {
    driver: nodeDriver(),
    path: ':memory:',
    jobs: { now: () => clock, random: () => 0.5 },
  });
  try {
    const jobs = store.jobs;
    if (jobs === undefined) throw new Error('the store opened without jobs');
    const firstId = await jobs.enqueue('mas-probe', { input: 1 }, { id: 'probe-job' });
    const secondId = await jobs.enqueue('mas-probe', { input: 999 }, { id: 'probe-job' });
    const idempotent = firstId === 'probe-job' && secondId === 'probe-job'
      && (await jobs.counts()).pending === 1;

    const claimed = await jobs.claim({ kinds: ['mas-probe'], owner: 'worker-1', leaseMs: 1000 });
    if (claimed === undefined) throw new Error('the first claim answered nothing');
    const checkpoints = jobs.checkpointsFor(claimed);
    await Promise.resolve(checkpoints.save('probe-job', 'n1', { v: 1 }));

    clock += 5000; // the lease expires; recovery is the next claim
    const reclaimed = await jobs.claim({ kinds: ['mas-probe'], owner: 'worker-2', leaseMs: 1000 });
    if (reclaimed === undefined) throw new Error('the reclaim answered nothing');
    const reclaimedCheckpoints = jobs.checkpointsFor(reclaimed);
    const loaded = await Promise.resolve(reclaimedCheckpoints.load('probe-job')) as { values: Record<string, unknown> } | null;
    const reused = loaded !== null && JSON.stringify(loaded.values.n1) === JSON.stringify({ v: 1 });

    await Promise.resolve(reclaimedCheckpoints.complete('probe-job', { done: true }));
    const done = await jobs.get('probe-job');
    const pruned = (await Promise.resolve(reclaimedCheckpoints.load('probe-job'))) === null;

    const pass = idempotent && reclaimed.id === 'probe-job' && reclaimed.attempts === 2
      && reused && done?.state === 'done' && JSON.stringify(done?.result) === JSON.stringify({ done: true }) && pruned;
    return {
      id: 'db-job-reclaim-checkpoints',
      title: 'an expired lease reclaims the same job and reuses its checkpoint rows',
      state: 'substrate',
      outcome: pass ? 'pass' : 'fail',
      observed: pass
        ? 'idempotent enqueue kept one row; the injected clock expired the lease; the reclaim read the saved checkpoint and its completion atomically pruned the rows'
        : `idempotent ${idempotent}, attempts ${reclaimed.attempts}, reused ${reused}, state ${done?.state}, pruned ${pruned}`,
      measured: {
        idempotentEnqueue: idempotent,
        reclaimedAttempts: reclaimed.attempts,
        reusedValues: loaded === null ? [] : Object.keys(loaded.values),
        finalState: done?.state ?? null,
        prunedAfterComplete: pruned,
      },
    };
  } finally {
    await store.close();
  }
}

async function probeBudgetConcurrentReserve(): Promise<SuiteProbe> {
  const account = createBudgetAccount({ turns: 3 }, () => 0);
  const outcomes: Array<string | null> = [];
  const release = deferred();
  const worker = async (): Promise<void> => {
    // stop() and reserve() run synchronously before the first await, so
    // concurrent branches cannot all observe the same unspent turn.
    const stop = account.stop();
    outcomes.push(stop);
    if (stop !== null) return;
    account.reserve();
    await release.promise;
    account.settle({ prompt_tokens: 1, completion_tokens: 1 });
  };
  const workers = [worker(), worker(), worker(), worker()];
  release.resolve();
  await Promise.all(workers);
  const reserved = outcomes.filter((outcome) => outcome === null).length;
  const stopped = outcomes.filter((outcome) => outcome === 'budget-turns').length;
  const pass = reserved === 3 && stopped === 1 && account.spent().turns === 3;
  return {
    id: 'budget-concurrent-reserve',
    title: 'one shared budget account reserves turns before concurrent calls launch',
    state: 'substrate',
    outcome: pass ? 'pass' : 'fail',
    observed: pass
      ? 'three concurrent reservations consumed the cap synchronously and the fourth stopped as budget-turns before any call launched'
      : `reserved ${reserved}, stopped ${stopped}, spent ${account.spent().turns}`,
    measured: { reserved, stopped, spentTurns: account.spent().turns },
  };
}

// ---------------------------------------------------------------------------
// durability probes — the real MAS store adapter and suite queue, scripted
// ---------------------------------------------------------------------------

interface DurabilityRig {
  db: Awaited<ReturnType<typeof openTangleDb>>;
  store: ReturnType<typeof createMasStore>;
  clock: { value: number };
}

async function durabilityRig(): Promise<DurabilityRig> {
  const clock = { value: 1_000_000 };
  const db = await openTangleDb({ driver: nodeDriver(), jobs: { now: () => clock.value, random: () => 0.5 } });
  let tick = 0;
  const store = createMasStore(db, { now: () => `tick-${String(tick++).padStart(4, '0')}` });
  return { db, store, clock };
}

const DURABILITY_RUN = (workflow: MasWorkflow, runId: string) => ({
  runId,
  workflowId: workflow.workflowId,
  workflowVersionId: workflow.versionId,
  registryRevision: 'b'.repeat(64),
  executableRevision: 'e'.repeat(64),
  configRegistryRevision: null,
  profile: 'scripted',
  input: { text: 'hello' },
  limits: { calls: 10 },
});

const DURABILITY_COMPLETION = (runId: string, attemptId: string, claimSeq: number): CommitCompletionPlan => ({
  runId,
  attemptId,
  claimSeq,
  output: { value: 'hello' },
  messages: [{
    edgeId: 'first-second',
    from: { path: 'first', port: 'value' },
    to: { path: 'second', port: 'value' },
    adapter: 'json-schema',
    aggregation: 'one',
    index: 0,
    payload: 'hello',
  }],
  state: { namespace: '', value: {}, members: [] },
  spend: { turns: 1, tokens: 8, ms: 0 },
  usage: { calls: 1, toolCalls: 0, contextReads: 0, promptTokens: 5, completionTokens: 3 },
  stopReason: 'stop',
  transcript: { state: 'retained', text: 'bought', size: 6, artifact: null },
  toolSteps: [],
  contextReads: [],
  artifacts: [{ kind: 'transcript', state: 'retained', size: 6, bytes: 'bought' }],
  restored: false,
});

export async function runDurabilityProbes(workflow: MasWorkflow): Promise<DurabilityProbe[]> {
  const probes: DurabilityProbe[] = [];

  // atomic five-member completion with an injected mid-transaction failure
  {
    const clock = { value: 1_000_000 };
    const db = await openTangleDb({ driver: nodeDriver(), jobs: { now: () => clock.value, random: () => 0.5 } });
    let tick = 0;
    const failAt: { step: string | null } = { step: null };
    const store = createMasStore(db, {
      now: () => `tick-${String(tick++).padStart(4, '0')}`,
      applyProbe: (step) => { if (failAt.step === step) throw new Error(`injected failure after ${step}`); },
    });
    try {
      const created = await store.createRun(DURABILITY_RUN(workflow, 'dur-atomic'));
      const claimed = created.ok ? await store.claimRunSegment('dur-atomic', 'w1') : created;
      const begun = claimed.ok ? await store.beginNodeAttempt({
        runId: 'dur-atomic', idempotencyKey: 'dur-atomic/dag0//0/first', path: 'first', invocationId: 'first', kind: 'task', claimSeq: claimed.value.claim.seq,
      }) : { kind: 'refused' as const };
      let partials = 0;
      const stages = ['attempt', 'messages', 'state', 'artifacts', 'budget'];
      if (begun.kind === 'started' && claimed.ok) {
        for (const stage of stages) {
          failAt.step = stage;
          const rejected = await store.commitNodeCompletion(DURABILITY_COMPLETION('dur-atomic', begun.attempt.id, claimed.value.claim.seq)).then(() => false, () => true);
          failAt.step = null;
          const trace = await store.readTrace('dur-atomic');
          const untouched = rejected
            && trace !== undefined
            && trace.attempts[0]?.status === 'running'
            && trace.messages.length === 0
            && trace.stateRevisions.length === 0
            && trace.artifacts.length === 0
            && trace.run.budget.spent.turns === 0;
          if (!untouched) partials += 1;
        }
      }
      const committed = begun.kind === 'started' && claimed.ok
        ? await store.commitNodeCompletion(DURABILITY_COMPLETION('dur-atomic', begun.attempt.id, claimed.value.claim.seq))
        : { ok: false as const };
      const trace = await store.readTrace('dur-atomic');
      const complete = committed.ok
        && trace !== undefined
        && trace.attempts[0]?.status === 'completed'
        && trace.messages.length === 1
        && trace.stateRevisions.length === 1
        && trace.artifacts.length === 1
        && trace.run.budget.spent.turns === 1;
      const pass = partials === 0 && complete;
      probes.push({
        id: 'atomic-node-completion',
        title: 'terminal attempt, messages, state, budget and artifacts commit in one transaction',
        state: 'durable-scripted',
        outcome: pass ? 'pass' : 'fail',
        observed: pass
          ? 'an injected failure after each of the five stages left no partial member; the successful commit wrote all five together'
          : `partial commits ${partials}, complete ${complete}`,
        measured: { stages: stages.length, partialsAfterInjectedFailures: partials, committedMembers: complete ? 5 : 0 },
      });
    } finally {
      await db.close();
    }
  }

  // activation compare-and-swap under twenty concurrent attempts
  {
    const { db, store } = await durabilityRig();
    try {
      await store.putWorkflowVersion(workflow);
      const outcomes = await Promise.all(Array.from({ length: 20 }, () => store.activateWorkflow(workflow.workflowId, workflow.versionId, null)));
      const applied = outcomes.filter((outcome) => outcome.applied).length;
      const conflicts = outcomes.filter((outcome) => !outcome.applied && outcome.conflict.code === 'TMAS2001').length;
      const pass = applied === 1 && conflicts === 19;
      probes.push({
        id: 'activation-cas',
        title: 'twenty concurrent activations apply exactly once',
        state: 'durable-scripted',
        outcome: pass ? 'pass' : 'fail',
        observed: pass
          ? 'one compare-and-swap transition applied; nineteen refused TMAS2001 against the moved head'
          : `applied ${applied}, conflicts ${conflicts}`,
        measured: { attempts: 20, applied, conflicts },
      });
    } finally {
      await db.close();
    }
  }

  // semantic idempotency: replay returns the stored completion, writes nothing
  {
    const { db, store } = await durabilityRig();
    try {
      await store.createRun(DURABILITY_RUN(workflow, 'dur-idem'));
      const claimed = await store.claimRunSegment('dur-idem', 'w1');
      const key = { runId: 'dur-idem', idempotencyKey: 'dur-idem/dag0//0/first', path: 'first', invocationId: 'first', kind: 'task' as const, claimSeq: claimed.ok ? claimed.value.claim.seq : 0 };
      const begun = await store.beginNodeAttempt(key);
      if (begun.kind === 'started' && claimed.ok) {
        await store.commitNodeCompletion(DURABILITY_COMPLETION('dur-idem', begun.attempt.id, claimed.value.claim.seq));
      }
      const replay = await store.beginNodeAttempt(key);
      const trace = await store.readTrace('dur-idem');
      const different = begun.kind === 'started' && claimed.ok
        ? await store.commitNodeCompletion({ ...DURABILITY_COMPLETION('dur-idem', begun.attempt.id, claimed.value.claim.seq), output: { value: 'other' } })
        : { ok: true as const };
      const pass = replay.kind === 'completed' && trace?.attempts.length === 1
        && !different.ok && (different as { issue: { code: string } }).issue.code === 'TMAS2001';
      probes.push({
        id: 'semantic-idempotency',
        title: 'a committed idempotency key replays its stored completion and refuses a different payload',
        state: 'durable-scripted',
        outcome: pass ? 'pass' : 'fail',
        observed: pass
          ? 'the replay returned the stored completion with zero new rows; a different payload under the key refused TMAS2001'
          : `replay ${replay.kind}, attempts ${trace?.attempts.length}`,
        measured: { attemptsAfterReplay: trace?.attempts.length ?? -1, replayKind: replay.kind },
      });
    } finally {
      await db.close();
    }
  }

  // namespaced segment checkpoints with atomic terminal prune
  {
    const { db } = await durabilityRig();
    try {
      const jobs = db.jobs;
      if (jobs === undefined) throw new Error('jobs must be enabled');
      await jobs.enqueue('probe', { input: 1 }, { id: 'dur-ns:0000' });
      const job = await jobs.claim({ kinds: ['probe'], owner: 'w1', leaseMs: 60_000 });
      if (job === undefined) throw new Error('the claim answered nothing');
      const suite = jobs.checkpointsFor(job);
      const first = namespacedRegionCheckpoints(suite, 'dur-ns:0000', 'loop//1');
      const second = namespacedRegionCheckpoints(suite, 'dur-ns:0000', 'loop//2');
      await Promise.resolve(first.save('dur-ns:0000', 't:bump', { count: 1 }));
      await Promise.resolve(second.save('dur-ns:0000', 't:bump', { count: 2 }));
      const one = await Promise.resolve(first.load('dur-ns:0000')) as { values: Record<string, unknown> };
      const two = await Promise.resolve(second.load('dur-ns:0000')) as { values: Record<string, unknown> };
      await Promise.resolve(suite.complete('dur-ns:0000', { done: true }));
      const pruned = (await Promise.resolve(first.load('dur-ns:0000'))) === null;
      const done = (await jobs.get('dur-ns:0000'))?.state === 'done';
      const isolated = JSON.stringify(one.values) === JSON.stringify({ 't:bump': { count: 1 } })
        && JSON.stringify(two.values) === JSON.stringify({ 't:bump': { count: 2 } });
      const pass = isolated && pruned && done;
      probes.push({
        id: 'segment-checkpoint-namespace',
        title: 'two iterations of one node id never collide; terminal completion prunes atomically',
        state: 'durable-scripted',
        outcome: pass ? 'pass' : 'fail',
        observed: pass
          ? 'each namespace saw only its own rows through the delegated suite store, and the terminal completion marked the job done and pruned the segment in one guarded statement'
          : `isolated ${isolated}, pruned ${pruned}, done ${done}`,
        measured: { namespaces: 2, isolated, prunedAfterComplete: pruned, jobDone: done },
      });
    } finally {
      await db.close();
    }
  }

  // a committed terminal outcome whose job completion was lost: reclaim closes
  {
    const { db, store, clock } = await durabilityRig();
    try {
      await store.createRun(DURABILITY_RUN(workflow, 'dur-reclaim'));
      let executions = 0;
      const handlers = createMasSegmentHandlers(store, {
        executableRevisions: ['e'.repeat(64)],
        execute: async () => {
          executions += 1;
          await store.transitionRun('dur-reclaim', { kind: 'complete', output: { done: true } });
          throw new Error('scripted crash after the terminal commit, before job completion');
        },
        owner: 'dur',
      });
      await enqueueMasSegment(db, {
        runId: 'dur-reclaim', segment: 0, workflowVersionId: workflow.versionId,
        registryRevision: 'b'.repeat(64), executableRevision: 'e'.repeat(64),
      });
      const jobs = db.jobs;
      if (jobs === undefined) throw new Error('jobs must be enabled');
      const kind = `mas:${'e'.repeat(64)}`;
      const firstJob = await jobs.claim({ kinds: [kind], owner: 'w1', leaseMs: 60_000 });
      if (firstJob === undefined) throw new Error('no first claim');
      const failed = await handlers[kind](firstJob.payload, { job: firstJob, checkpointsFor: (bound: unknown) => jobs.checkpointsFor(bound as never), signal: new AbortController().signal } as never).then(() => false, () => true);
      await jobs.fail(firstJob.id, 'w1', new Error('crash'));
      clock.value += 300_000;
      const secondJob = await jobs.claim({ kinds: [kind], owner: 'w2', leaseMs: 60_000 });
      if (secondJob === undefined) throw new Error('no reclaim');
      await handlers[kind](secondJob.payload, { job: secondJob, checkpointsFor: (bound: unknown) => jobs.checkpointsFor(bound as never), signal: new AbortController().signal } as never);
      await jobs.complete(secondJob.id, 'w2', null);
      const jobDone = (await jobs.get('dur-reclaim:0000'))?.state === 'done';
      const pass = failed && executions === 1 && jobDone && (await store.getRun('dur-reclaim'))?.status === 'completed';
      probes.push({
        id: 'crash-reclaim-closes',
        title: 'a committed terminal outcome whose job completion was lost reclaims and closes without re-execution',
        state: 'durable-scripted',
        outcome: pass ? 'pass' : 'fail',
        observed: pass
          ? 'the reclaimed handler read the committed segment outcome and closed the job without invoking the executor again'
          : `executions ${executions}, jobDone ${jobDone}`,
        measured: { executorInvocations: executions, jobDone },
      });
    } finally {
      await db.close();
    }
  }

  // the uncertain guard
  {
    const { db, store } = await durabilityRig();
    try {
      await store.createRun(DURABILITY_RUN(workflow, 'dur-unsure'));
      const claimed = await store.claimRunSegment('dur-unsure', 'w1');
      const key = { runId: 'dur-unsure', idempotencyKey: 'dur-unsure/dag0//0/first', path: 'first', invocationId: 'first', kind: 'task' as const, claimSeq: claimed.ok ? claimed.value.claim.seq : 0 };
      const begun = await store.beginNodeAttempt(key);
      if (begun.kind === 'started' && claimed.ok) {
        await store.failNodeAttempt({
          runId: 'dur-unsure', attemptId: begun.attempt.id, claimSeq: claimed.value.claim.seq,
          status: 'uncertain',
          error: { code: 'TMAS2006', detail: 'the external call succeeded but its durable outcome is unknown', cause: null },
        });
      }
      const reclaimed = await store.claimRunSegment('dur-unsure', 'w2');
      const again = reclaimed.ok ? await store.beginNodeAttempt({ ...key, claimSeq: reclaimed.value.claim.seq }) : begun;
      const pass = again.kind === 'uncertain';
      probes.push({
        id: 'uncertain-guard',
        title: 'an external success with no durable outcome refuses automatic repetition',
        state: 'durable-scripted',
        outcome: pass ? 'pass' : 'fail',
        observed: pass
          ? 'the reclaim answered TMAS2006 uncertain instead of silently buying or applying again; resolution is the operator\'s'
          : `reclaim answered ${again.kind}`,
        measured: { reclaimKind: again.kind },
      });
    } finally {
      await db.close();
    }
  }

  return probes;
}

export async function runSuiteProbes(): Promise<SuiteProbe[]> {
  return [
    await probeDagFanout(),
    await probeDagFaninOrder(),
    await probeDagAbort(),
    await probeDagCheckpointRestore(),
    await probeFsmOrderResume(),
    await probeDbJobReclaim(),
    await probeBudgetConcurrentReserve(),
  ];
}

// ---------------------------------------------------------------------------
// the integrated measurement — exactly as far as the runtime has come
// ---------------------------------------------------------------------------

/**
 * One row per registration, in registration order. Every positive
 * fixture EXECUTES through the real durable runtime under scripted
 * hosts — acyclic regions, switches, loops, nested graphs and typed
 * interactions — and passes its full registered oracle
 * (`runtime-pass`); negative fixtures refuse at their registered code
 * and pointer. A fixture the stack cannot measure as registered fails
 * the build loudly rather than committing a lying row.
 */

export async function measureIntegrated(loaded: LoadedFixtures): Promise<IntegratedRow[]> {
  const snapshot = await createMasRegistrySnapshot(loaded.registry);
  if (!snapshot.valid) {
    throw new Error(`the fixture registry does not validate as a MAS snapshot: ${snapshot.issues[0]?.code} ${snapshot.issues[0]?.path}`);
  }
  const catalog = await createMasConfigCatalog(loaded.configCatalog);
  if (!catalog.valid) {
    throw new Error(`the fixture CONFIG catalog does not validate: ${catalog.issues[0]?.code}`);
  }

  const rows: IntegratedRow[] = [];
  for (const { document } of loaded.fixtures) {
    const outcome = await validateMasWorkflow(document.workflow, snapshot.value, catalog.value);
    if (document.family === 'positive') {
      if (!outcome.valid) {
        const first = outcome.issues[0];
        throw new Error(`positive fixture ${document.id} refused ${first?.code} at ${first?.path} — the instrument does not commit a lying row`);
      }
      const plan = await planMasWorkflow(outcome.value);
      if (!plan.valid) {
        const first = plan.issues[0];
        throw new Error(`positive fixture ${document.id} did not lower: ${first?.code} at ${first?.path}`);
      }
      rows.push(await runAcyclicFixture(document, outcome.value, plan.value, snapshot.value, catalog.value));
    } else {
      if (outcome.valid) {
        throw new Error(`negative fixture ${document.id} validated but must refuse ${document.expect.kind === 'refusal' ? document.expect.code : ''}`);
      }
      const first = outcome.issues[0];
      const registered = document.expect;
      if (registered.kind !== 'refusal' || first.code !== registered.code || first.path !== registered.path) {
        throw new Error(`negative fixture ${document.id} refused ${first.code} at ${first.path} instead of its registered ${registered.kind === 'refusal' ? `${registered.code} at ${registered.path}` : 'oracle'}`);
      }
      rows.push({
        id: document.id,
        family: document.family,
        state: 'refused-as-registered',
        reason: 'the validator refuses at exactly the registered code and pointer',
        workflowVersionId: null,
        registryRevision: null,
        executableRevision: null,
        attempts: 0,
        calls: 0,
        toolCalls: 0,
        contextReads: 0,
        restores: 0,
        maxObservedConcurrency: null,
        refusal: { code: first.code, path: first.path },
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// report assembly and rendering
// ---------------------------------------------------------------------------

export interface BuildOptions {
  root?: string;
  /** Injected for deterministic tests; the CLI computes the real one. */
  source?: MasConformance['source'];
}

const reportValidator = createReportValidator(masConformanceSchema as object);

export async function buildReport(options: BuildOptions = {}): Promise<MasConformance> {
  const root = options.root ?? process.cwd();
  const loaded = await loadFixtures(root);
  const registration = registrationOf(loaded);
  const suiteProbes = await runSuiteProbes();
  const durabilityWorkflow = loaded.fixtures[0].document.workflow as unknown as MasWorkflow;
  const durability = await runDurabilityProbes(durabilityWorkflow);
  const integrated = await measureIntegrated(loaded);

  const states = { notImplemented: 0, validated: 0, refusedAsRegistered: 0, runtimePass: 0 };
  let calls = 0;
  let toolCalls = 0;
  let contextReads = 0;
  let restores = 0;
  for (const row of integrated) {
    if (row.state === 'not-implemented') states.notImplemented += 1;
    else if (row.state === 'validated') states.validated += 1;
    else if (row.state === 'refused-as-registered') states.refusedAsRegistered += 1;
    else states.runtimePass += 1;
    calls += row.calls;
    toolCalls += row.toolCalls;
    contextReads += row.contextReads;
    restores += row.restores;
  }

  const report: MasConformance = {
    benchmark: 'mas-conformance',
    instrument: { entry: 'benchmark/mas-conformance.ts' },
    source: options.source ?? await conformanceSource(root),
    suite: await suitePackages(root),
    registration,
    suiteProbes,
    durability,
    integrated,
    counts: {
      fixtures: 18,
      probes: {
        total: suiteProbes.length,
        passed: suiteProbes.filter((probe) => probe.outcome === 'pass').length,
        failed: suiteProbes.filter((probe) => probe.outcome === 'fail').length,
      },
      durability: {
        total: durability.length,
        passed: durability.filter((probe) => probe.outcome === 'pass').length,
        failed: durability.filter((probe) => probe.outcome === 'fail').length,
      },
      integrated: states,
      calls,
      toolCalls,
      contextReads,
      restores,
    },
    gate: { schemaValid: true, transportCalls: 0, liveModelCalls: 0 },
    live: { state: 'not-run', reason: 'no authorized live plan' },
    reportId: '0'.repeat(64),
    decision: { outcome: 'not-conformant', failedClauses: [], clauses: { registration: false, conformance: false, concurrencyOrder: false, durability: false, controlSafety: false, persistenceIdentity: false, hygiene: false } },
  };
  // The identity excludes the decision; the decision is computed after it.
  const { reportId: _placeholder, decision: _decisionPlaceholder, ...rest } = report;
  report.reportId = await canonicalSha256(rest);
  report.decision = decideMasRuntime(report);

  const outcome = reportValidator(report);
  if (!outcome.valid) {
    throw new Error(`the MAS conformance report does not validate: ${describeErrors(outcome, 8).join('; ')}`);
  }
  return report;
}

// ---------------------------------------------------------------------------
// the mechanical claim decision — pure, recomputed by the schema
// ---------------------------------------------------------------------------

/**
 * The seven clauses of D12, over the committed report alone. Missing
 * data never passes: every clause reads recorded evidence, `outcome`
 * is `runtime-conformant` exactly when all seven hold, and the schema's
 * `$query` recomputes each clause so a forged outcome, hidden failure
 * or skewed count cannot validate. The decision is computed AFTER the
 * report identity and excluded from it — stating the claim cannot move
 * its evidence address.
 */
export function decideMasRuntime(report: Omit<MasConformance, 'decision'>): MasConformance['decision'] {
  const row = (id: string) => report.integrated.find((candidate) => candidate.id === id);
  const rowPasses = (id: string): boolean => row(id)?.state === 'runtime-pass';
  const weekly = row('weekly-report-manual');

  const clauses = {
    registration: report.registration.fixtures.length === 18
      && report.integrated.every((integrated) => integrated.family === 'negative'
        || (integrated.workflowVersionId !== null && integrated.registryRevision !== null && integrated.executableRevision !== null)),
    conformance: report.counts.integrated.runtimePass === 11
      && report.counts.integrated.refusedAsRegistered === 7,
    concurrencyOrder: weekly !== undefined && weekly.state === 'runtime-pass'
      && weekly.maxObservedConcurrency !== null && weekly.maxObservedConcurrency >= 3,
    durability: report.counts.durability.passed === 6
      && report.counts.durability.failed === 0
      && rowPasses('checkpoint'),
    controlSafety: rowPasses('loop-three') && rowPasses('switch-many')
      && rowPasses('interaction') && rowPasses('switch-one'),
    persistenceIdentity: report.counts.probes.failed === 0
      && report.durability.every((probe) => probe.outcome === 'pass'),
    hygiene: report.counts.probes.failed === 0
      && report.counts.durability.failed === 0
      && report.integrated.every((integrated) => integrated.state !== 'not-implemented'),
  };
  const failedClauses = Object.entries(clauses)
    .filter(([, holds]) => !holds)
    .map(([name]) => name);
  return {
    outcome: failedClauses.length === 0 ? 'runtime-conformant' : 'not-conformant',
    failedClauses,
    clauses,
  };
}

/** The exact bytes the committed report holds. */
export function renderReport(report: MasConformance): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// the committed baseline query
// ---------------------------------------------------------------------------

export interface BaselineArtifact {
  benchmark: 'mas-runtime-baseline';
  query: string;
  queryRevision: string;
  reportId: string;
  rows: unknown;
  artifactId: string;
}

export async function runBaselineQuery(report: MasConformance, root = process.cwd()): Promise<BaselineArtifact> {
  const raw = JSON.parse(await readFile(join(root, BASELINE_QUERY_PATH), 'utf8')) as Record<string, unknown>;
  const { $comment: _comment, ...query } = raw;
  const compiled = compileJsonQuery(query as Record<string, unknown>) as (input: unknown) => unknown;
  const rows = compiled(report);
  const artifact: BaselineArtifact = {
    benchmark: 'mas-runtime-baseline',
    query: BASELINE_QUERY_PATH,
    queryRevision: await canonicalSha256(query),
    reportId: report.reportId,
    rows,
    artifactId: '0'.repeat(64),
  };
  const { artifactId: _placeholder, ...rest } = artifact;
  artifact.artifactId = await canonicalSha256(rest);
  return artifact;
}

export function renderBaseline(artifact: BaselineArtifact): string {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// the generated benchmark document
// ---------------------------------------------------------------------------

export function renderDocument(report: MasConformance): string {
  const lines: string[] = [];
  lines.push('# MAS runtime conformance — the registered instrument and its baseline');
  lines.push('');
  lines.push('Generated by `npm run benchmark:mas` from the committed fixtures; do not edit numbers by hand.');
  lines.push('');
  lines.push(`Registered: **${report.registration.positive} positive** workflow fixtures with exact output/event/aggregation/concurrency/call oracles and **${report.registration.negative} negative** fixtures with reserved refusal codes and pointers (manifest \`${report.registration.manifestRevision.slice(0, 12)}…\`, fixture registry \`${report.registration.registryRevision.slice(0, 12)}…\`). The registration is immutable input: later measurements replace integrated rows by id and never change these denominators.`);
  lines.push('');
  lines.push('## Suite substrate probes');
  lines.push('');
  lines.push('Direct executions of the published JarenJS primitives this campaign lowers to, with controlled promises and injected clocks. A probe passing says the substrate exists; it does not pass a MAS fixture.');
  lines.push('');
  lines.push('| probe | outcome | observed |');
  lines.push('|---|---|---|');
  for (const probe of report.suiteProbes) {
    lines.push(`| \`${probe.id}\` | ${probe.outcome} | ${probe.observed} |`);
  }
  lines.push('');
  lines.push('## Durable persistence measurements');
  lines.push('');
  lines.push('The real MAS store adapter and suite queue under injected clocks — durable-scripted evidence, never a runtime fixture pass.');
  lines.push('');
  lines.push('| probe | outcome | observed |');
  lines.push('|---|---|---|');
  for (const probe of report.durability) {
    lines.push(`| \`${probe.id}\` | ${probe.outcome} | ${probe.observed} |`);
  }
  lines.push('');
  lines.push('## Integrated MAS baseline');
  lines.push('');
  const { integrated } = report.counts;
  const passLine = `${integrated.runtimePass}/11 positive runtime oracles pass; ${integrated.refusedAsRegistered}/7 negative fixtures refuse at their registered code and pointer; ${integrated.validated} validate without executing; ${integrated.notImplemented} are not implemented.`;
  lines.push(passLine);
  lines.push('');
  lines.push('| fixture | family | state | calls | tool calls | context reads | restores | max concurrency | refusal |');
  lines.push('|---|---|---|---:|---:|---:|---:|---:|---|');
  for (const row of report.integrated) {
    const refusal = row.refusal === null ? '—' : `\`${row.refusal.code}\` at \`${row.refusal.path}\``;
    const concurrency = row.maxObservedConcurrency === null ? '—' : String(row.maxObservedConcurrency);
    lines.push(`| \`${row.id}\` | ${row.family} | ${row.state} | ${row.calls} | ${row.toolCalls} | ${row.contextReads} | ${row.restores} | ${concurrency} | ${refusal} |`);
  }
  lines.push('');
  lines.push(`Scripted totals across integrated rows: ${report.counts.calls} model calls, ${report.counts.toolCalls} tool calls, ${report.counts.contextReads} context reads, ${report.counts.restores} restores. The keyless gate is structural: transport calls and live model calls are literal zeros in the schema.`);
  lines.push('');
  lines.push('## Mechanical decision');
  lines.push('');
  const clauseTable = Object.entries(report.decision.clauses)
    .map(([name, holds]) => `| ${name} | ${holds ? 'holds' : 'FAILS'} |`);
  lines.push(`**${report.decision.outcome}** — all seven clauses recomputed by the report schema at validation time.`);
  lines.push('');
  lines.push('| clause | state |');
  lines.push('|---|---|');
  lines.push(...clauseTable);
  lines.push('');
  lines.push(report.live.state === 'not-run'
    ? `Live weekly-report row: **not-run** — ${report.live.reason}. Runtime conformance does not depend on a live model: the claims are scheduler/contract/durability semantics and the scripted clients exercise the exact AI/tool/context seams.`
    : 'Live weekly-report row: run (see the report for identity and losses).');
  lines.push('');
  lines.push(`Report \`${report.reportId.slice(0, 12)}…\` at suite ${report.suite.packages.map((pkg) => `${pkg.name}@${pkg.version}`).find((name) => name.startsWith('@jarenjs/flow')) ?? ''}; flat baseline projected by \`${BASELINE_QUERY_PATH}\`.`);
  lines.push('');
  return lines.join('\n');
}
