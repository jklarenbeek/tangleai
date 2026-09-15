/** The committed corpus as skill-evolution records, shared by every suite here. */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { applyCompiled, compilePatch, draftsOf, importBundle, sealSkillBundle,
  type AnalystResult, type EvolutionRun, type EvolutionTask, type MergeNode, type PatchOperation,
  type ActivationEvent, type PreparedSkillTask, type SkillCandidate, type SkillChatClient, type SkillEvaluation,
  type SkillPatch, type SkillSnapshot, type TaskEvaluation, type TaskRollout,
  type Trace2SkillOutcome, type Trace2SkillTaskAdapter, type Trace2SkillStore } from '@tangleai/trace2skill';
import { operationsOf as documentOperations } from '../../benchmark/lib/trace2skill-fixture.ts';

export const FIXTURE = 'benchmark/fixtures/trace2skill';
export const SCOPE = 'tabular-extract';
export const FROZEN_BUNDLE_ID = 'ff8070b41b71060c008ce25988953b8f0f1d8f785c4f2db206341a6b9defb1db';
export const RUN_ID = 'a'.repeat(64);

export interface FixturePatchDocument {
  id: string;
  origin: { rollout: string, analyst: string };
  expectedCode: string | null;
  withheld: boolean;
  baseHash?: string;
  rationale: string;
  operations: Array<{ group: string, op: string, file: string, anchor?: string, text?: string }>;
}

/** The frozen directory's bytes, read once from the committed corpus. */
export async function FIXTURE_FILES(): Promise<Array<{ path: string, bytes: Uint8Array }>> {
  const base = join(FIXTURE, 'skills/s0-human');
  return [
    { path: 'SKILL.md', bytes: new Uint8Array(await readFile(join(base, 'SKILL.md'))) },
    { path: 'references/csv-conventions.md', bytes: new Uint8Array(await readFile(join(base, 'references/csv-conventions.md'))) },
  ];
}

export async function readFrozenSkill(): Promise<SkillSnapshot> {
  const imported = await importBundle(await FIXTURE_FILES(), { scopeKey: SCOPE, mode: 'deepening', origin: 'human-import' });
  if (!imported.valid) throw new Error(JSON.stringify(imported.issues));
  return imported.value;
}

/** Task ids and registered answers reusable guidance may not carry. */
export async function forbiddenTerms(): Promise<string[]> {
  const terms: string[] = [];
  for (const name of (await readdir(join(FIXTURE, 'tasks'))).sort()) {
    const task = JSON.parse(await readFile(join(FIXTURE, 'tasks', name), 'utf8')) as { id: string };
    const truth = JSON.parse(await readFile(join(FIXTURE, 'truth', name), 'utf8')) as { answer: string, normalized: string };
    terms.push(task.id, truth.answer, truth.normalized);
  }
  return terms;
}

export async function readPatchDocuments(): Promise<Map<string, FixturePatchDocument>> {
  const names = (await readdir(join(FIXTURE, 'patches'))).filter(name => name.endsWith('.json') && name !== 'expected-merge-tree.json').sort();
  const documents = new Map<string, FixturePatchDocument>();
  for (const name of names)
    documents.set(name.replace(/\.json$/, ''), JSON.parse(await readFile(join(FIXTURE, 'patches', name), 'utf8')) as FixturePatchDocument);
  return documents;
}

/** The registered document's spelling, mapped by the corpus loader that owns the mapping. */
export function operationsOf(document: FixturePatchDocument): PatchOperation[] {
  return documentOperations(document as unknown as Parameters<typeof documentOperations>[0]);
}

export async function patchOf(body: {
  runId?: string, baseHash: string, sourceRolloutIds?: string[], sourcePatchIds?: string[],
  supportCount?: number, reasoning?: string, operations: PatchOperation[],
}): Promise<SkillPatch> {
  const payload = {
    runId: body.runId ?? RUN_ID, baseHash: body.baseHash, sourceRolloutIds: body.sourceRolloutIds ?? [],
    sourcePatchIds: body.sourcePatchIds ?? [], supportCount: body.supportCount ?? 1,
    reasoning: body.reasoning ?? 'fixture', operations: body.operations, changelog: [],
    validation: { state: 'pending' as const, issues: [] },
  };
  return { id: await canonicalSha256(payload), ...payload };
}

export async function fixturePatch(document: FixturePatchDocument, baseHash: string): Promise<SkillPatch> {
  return patchOf({ baseHash: document.baseHash ?? baseHash, sourceRolloutIds: [document.origin.rollout], reasoning: document.rationale, operations: operationsOf(document) });
}

/** The evolved directory the valid pool produces, sealed as a child of the frozen one. */
export async function evolvedSkill(frozen: SkillSnapshot, document: FixturePatchDocument): Promise<SkillSnapshot> {
  const patch = await fixturePatch(document, frozen.bundle.id);
  const compiled = compilePatch({ bundle: frozen.bundle, files: draftsOf(frozen.files) }, patch);
  if (!compiled.valid) throw new Error(JSON.stringify(compiled.issues));
  const applied = applyCompiled(draftsOf(frozen.files), compiled.value);
  if (!applied.valid) throw new Error(JSON.stringify(applied.issues));
  const sealed = await sealSkillBundle(applied.value, { scopeKey: SCOPE, mode: 'deepening', origin: 'evolved', parentId: frozen.bundle.id });
  if (!sealed.valid) throw new Error(JSON.stringify(sealed.issues));
  return sealed.value;
}

export interface LifecycleRecords {
  frozen: SkillSnapshot;
  evolved: SkillSnapshot;
  run: EvolutionRun;
  task: EvolutionTask;
  rollout: TaskRollout;
  analysis: AnalystResult;
  patch: SkillPatch;
  merge: MergeNode;
  candidate: SkillCandidate;
  evaluation: SkillEvaluation;
}

const SPEND = { calls: 1, tokens: 128, cost: null };
const HASH = (seed: string) => seed.repeat(64).slice(0, 64);

/** One record per collection, bound to the committed corpus. */
export async function lifecycleRecords(): Promise<LifecycleRecords> {
  const frozen = await readFrozenSkill();
  const documents = await readPatchDocuments();
  const evolved = await evolvedSkill(frozen, documents.get('units-a')!);
  const patch = await fixturePatch(documents.get('units-a')!, frozen.bundle.id);
  const run: EvolutionRun = {
    id: RUN_ID, scopeKey: SCOPE, mode: 'deepening', s0Id: frozen.bundle.id, s0Hash: frozen.bundle.id,
    evolveHash: HASH('e'), testHash: HASH('7'), roles: [{ role: 'executor', identityId: 'keyless', promptVersion: '1' }],
    toolManifestHash: HASH('c'), budgets: { turns: 6, tokens: 16384, ms: 60000 }, concurrency: 4,
    bMerge: 4, lMax: 3, seed: 17753, supportThreshold: 1, status: 'running', spend: SPEND,
  };
  const rollout: TaskRollout = {
    id: HASH('1'), runId: RUN_ID, taskId: 'task-13', s0Hash: frozen.bundle.id, condition: 'frozen-s0', attempt: 1,
    messages: [{ role: 'user', content: 'weight in pounds' }], reasoning: [{ turn: 1, text: 'read the table' }],
    steps: [{ turn: 1, name: 'read_file', arguments: '{"path":"inputs/shipments.csv"}', result: 'ok' }],
    finalAnswer: '511.0', artifacts: [], evaluation: { evaluatorId: 'exact-normalized-v1', score: 0, detail: 'mismatch' },
    label: 'failure', stopReason: 'answered', spend: SPEND, idempotencyKey: HASH('2'),
  };
  const analysis: AnalystResult = {
    id: HASH('3'), runId: RUN_ID, role: 'error', rolloutId: rollout.id, s0Hash: frozen.bundle.id, status: 'patch',
    exclusion: null, diagnosis: 'the directory records no conversion factor',
    repair: { attempts: 1, evaluation: { evaluatorId: 'exact-normalized-v1', score: 1, detail: 'repaired' } },
    patchId: patch.id, spend: SPEND, idempotencyKey: HASH('4'),
  };
  const merge: MergeNode = {
    id: 'merge-1-1', runId: RUN_ID, level: 1, groupIndex: 1, inputPatchIds: [patch.id], outputPatchId: patch.id,
    baseHash: frozen.bundle.id, supportCount: 1,
    report: { unique: 1, duplicates: 0, withheld: 0, successSupport: 0, errorSupport: 1, issues: [] },
    spend: SPEND, idempotencyKey: HASH('5'),
  };
  const candidate: SkillCandidate = {
    id: HASH('6'), runId: RUN_ID, scopeKey: SCOPE, finalPatchId: patch.id, bundleId: evolved.bundle.id,
    parentId: frozen.bundle.id, structural: { valid: true, issues: [] }, semantic: { valid: true, issues: [] },
    diffSummary: { filesAdded: 1, filesChanged: 1, linesAdded: 5, linesRemoved: 0 }, churn: 0.2,
  };
  const evaluation: SkillEvaluation = {
    id: HASH('8'), runId: RUN_ID, scopeKey: SCOPE, baselineBundleId: frozen.bundle.id, candidateBundleId: evolved.bundle.id,
    executorIdentityId: 'keyless', split: 'test', testHash: run.testHash,
    results: [{ taskId: 'task-02', baselineScore: 0, candidateScore: 1, label: 'success' }],
    meanDelta: 1, costDelta: null, failures: 0, skips: 0, leakage: 0, eligible: true,
    policyVersion: 'held-out-v1', expectedHead: { versionId: frozen.bundle.id, revision: 1 }, issues: [],
  };
  const task: EvolutionTask = {
    id: 'task-13', scopeKey: SCOPE, split: 'evolve', prompt: 'What is the weight of the shipment in pounds?',
    inputs: [{ path: 'assets/shipments.csv', sha256: HASH('9'), size: 128 }], adapterId: 'tabular-extract', adapterRevision: '1',
  };
  return { frozen, evolved, run, task, rollout, analysis, patch, merge, candidate, evaluation };
}

/** The one lifecycle every implementation of the store contract must pass. */
export async function runSkillLifecycle(store: Trace2SkillStore, records: LifecycleRecords): Promise<void> {
  const { frozen, evolved } = records;
  assert.deepEqual(await store.head(SCOPE), { versionId: null, revision: 0 });
  // A reader with no scope in hand asks the store which partitions exist; an
  // empty collection names none rather than guessing.
  assert.deepEqual(await store.scopes('bundles'), []);
  assert.deepEqual(await store.scopes('runs'), []);

  const smuggled = await store.putBundle({ ...frozen.bundle, status: 'active' });
  assert.ok(!smuggled.valid, 'a directory cannot arrive already active');
  assert.equal(smuggled.issues[0].code, 'TT2S1010');

  const stored = await store.putSnapshot(frozen);
  assert.ok(stored.valid, stored.valid ? '' : JSON.stringify(stored.issues));
  const replay = await store.putSnapshot(frozen);
  assert.ok(replay.valid, 'identical bytes replay');
  assert.equal(store.stats().replays > 0, true);

  const forged = { ...frozen, bundle: { ...frozen.bundle, origin: 'evolved' as const } };
  const refused = await store.putSnapshot(forged);
  assert.ok(!refused.valid);
  assert.equal(refused.issues[0].code, 'TT2S1002');

  const structural = await store.activate(SCOPE, { versionId: null, revision: 0 }, frozen.bundle.id);
  assert.ok(!structural.valid, 'a staged directory is not activatable');
  assert.equal(structural.issues[0].code, 'TT2S1010');

  assert.ok((await store.markBundle(frozen.bundle.id, 'eligible')).valid);
  const first = await store.activate(SCOPE, { versionId: null, revision: 0 }, frozen.bundle.id);
  assert.ok(first.valid, first.valid ? '' : JSON.stringify(first.issues));
  assert.deepEqual(first.value, { versionId: frozen.bundle.id, revision: 1 });

  assert.ok((await store.putSnapshot(evolved)).valid);
  assert.ok((await store.markBundle(evolved.bundle.id, 'eligible')).valid);
  const stale = await store.activate(SCOPE, { versionId: frozen.bundle.id, revision: 0 }, evolved.bundle.id);
  assert.ok(!stale.valid);
  assert.equal(stale.issues[0].code, 'TT2S1010');
  assert.equal(stale.issues[0].cause?.code, 'OUTC1013');

  // Twenty callers race the same fence; exactly one moves the head and the
  // nineteen that lose change nothing.
  const race = await Promise.all(Array.from({ length: 20 }, () => store.activate(SCOPE, first.value, evolved.bundle.id)));
  const winners = race.filter(outcome => outcome.valid);
  assert.equal(winners.length, 1, 'exactly one concurrent activation applies');
  for (const loser of race.filter(outcome => !outcome.valid)) assert.equal(loser.issues[0].code, 'TT2S1010');
  const second = winners[0] as Extract<typeof race[number], { valid: true }>;
  assert.deepEqual(second.value, { versionId: evolved.bundle.id, revision: 2 });
  assert.deepEqual(await store.head(SCOPE), second.value);

  const superseded = await store.getSnapshot(frozen.bundle.id);
  assert.ok(superseded.valid, 'the superseded directory is still readable');
  assert.equal(superseded.value.bundle.status, 'archived');
  assert.equal(superseded.value.files.length, frozen.files.length);
  const page = await store.getFile(frozen.bundle.id, 'SKILL.md');
  assert.ok(page.valid, 'a superseded page is never deleted');
  const active = await store.getBundle(evolved.bundle.id);
  assert.ok(active.valid);
  assert.equal(active.value.status, 'active');

  for (const [put, row] of [
    [store.putRun, records.run], [store.putTask, records.task], [store.putRollout, records.rollout],
    [store.putAnalysis, records.analysis], [store.putPatch, records.patch], [store.putMerge, records.merge],
    [store.putCandidate, records.candidate], [store.putEvaluation, records.evaluation],
  ] as Array<[(row: never) => Promise<{ valid: boolean }>, unknown]>) {
    const written = await put(row as never);
    assert.ok(written.valid, JSON.stringify(written));
    assert.ok((await put(row as never)).valid, 'an immutable put replays');
  }
  // A staged candidate and the directory it names land in one transaction.
  const staged = await store.putStagedCandidate(records.evolved, records.candidate);
  assert.ok(staged.valid, staged.valid ? '' : JSON.stringify(staged.issues));
  const foreign = await store.putStagedCandidate(records.frozen, records.candidate);
  assert.ok(!foreign.valid, 'a candidate that names another directory is refused');
  assert.equal(foreign.issues[0].code, 'TT2S1002');

  assert.equal((await store.listBy(SCOPE, 'bundles')).length, 2);
  assert.equal((await store.listBy(RUN_ID, 'rollouts')).length, 1);
  assert.equal((await store.listBy(RUN_ID, 'patches')).length, 1);
  // The partitions a collection holds, so a reader with no scope in hand can
  // find one: runs are partitioned by scope key, their rows by run id.
  assert.deepEqual(await store.scopes('runs'), [SCOPE]);
  assert.deepEqual(await store.scopes('rollouts'), [RUN_ID]);
  assert.deepEqual(await store.scopes('bundles'), [SCOPE]);
  assert.deepEqual(await store.scopes('heads'), [SCOPE]);
  // The evaluations collection holds the held-out verdict and the activation
  // events that name it; only the event carries a kind.
  const event: ActivationEvent = {
    kind: 'activation', id: HASH('a'), scopeKey: SCOPE, candidateId: records.candidate.id,
    bundleId: evolved.bundle.id, evaluationId: records.evaluation.id, action: 'promote',
    outcome: 'activated', actor: 'lifecycle', previousHead: { versionId: frozen.bundle.id, revision: 1 },
    nextHead: { versionId: evolved.bundle.id, revision: 2 }, issues: [],
  };
  assert.ok((await store.putActivation(event)).valid);
  assert.ok((await store.putActivation(event)).valid, 'an immutable event replays');
  const rows = await store.listBy(SCOPE, 'evaluations');
  assert.equal(rows.length, 2);
  assert.equal(rows.filter(row => 'kind' in row).length, 1);
  assert.equal((await store.listBy(frozen.bundle.id, 'files')).length, frozen.files.length);

  const unwind = await store.markBundle(evolved.bundle.id, 'archived');
  assert.ok(!unwind.valid, 'only the fenced swap archives the active directory');
  assert.equal(unwind.issues[0].code, 'TT2S1010');
  assert.deepEqual(await store.head(SCOPE), second.value);

  const drifted = { ...records.rollout, finalAnswer: '1126.0' };
  const conflict = await store.putRollout(drifted);
  assert.ok(!conflict.valid);
  assert.equal(conflict.issues[0].code, 'TT2S1002');
  assert.equal(store.stats().activations, 2);
}

/** A conflicting page refuses the whole directory; no earlier page is committed. */
export async function runPartialWriteRefusal(store: Trace2SkillStore, records: LifecycleRecords): Promise<void> {
  const [first, second] = records.frozen.files;
  const tampered = { ...second, content: `${second.content}\n<!-- moved -->\n` };
  assert.ok((await store.putFile(tampered)).valid);
  const refused = await store.putSnapshot(records.frozen);
  assert.ok(!refused.valid);
  assert.equal(refused.issues[0].code, 'TT2S1002');
  assert.ok(!(await store.getFile(records.frozen.bundle.id, first.path)).valid, 'no page landed ahead of the conflict');
  assert.ok(!(await store.getBundle(records.frozen.bundle.id)).valid, 'the directory did not land');
}

/** A failure at any stage of the swap leaves the prior head active and the candidate inspectable. */
export async function runActivationRollback(
  make: (applyProbe: (step: string) => void) => Promise<Trace2SkillStore> | Trace2SkillStore,
  records: LifecycleRecords,
): Promise<void> {
  const held = { versionId: records.frozen.bundle.id, revision: 1 };
  for (const failAt of ['put:bundles', 'put:heads', 'commit']) {
    const gate: { step: string | null } = { step: null };
    const store = await make(step => { if (gate.step === step) { gate.step = null; throw new Error(`forced ${step}`); } });
    assert.ok((await store.putSnapshot(records.frozen)).valid);
    assert.ok((await store.markBundle(records.frozen.bundle.id, 'eligible')).valid);
    assert.ok((await store.activate(SCOPE, { versionId: null, revision: 0 }, records.frozen.bundle.id)).valid);
    assert.ok((await store.putSnapshot(records.evolved)).valid);
    assert.ok((await store.markBundle(records.evolved.bundle.id, 'eligible')).valid);

    gate.step = failAt;
    await assert.rejects(() => store.activate(SCOPE, held, records.evolved.bundle.id), /forced/, failAt);
    assert.deepEqual(await store.head(SCOPE), held, failAt);
    const prior = await store.getBundle(records.frozen.bundle.id);
    assert.ok(prior.valid, failAt);
    assert.equal(prior.value.status, 'active', failAt);
    const candidate = await store.getBundle(records.evolved.bundle.id);
    assert.ok(candidate.valid, failAt);
    assert.equal(candidate.value.status, 'eligible', `${failAt}: the candidate stays inspectable`);
    assert.equal((await store.listBy(records.frozen.bundle.id, 'files')).length, records.frozen.files.length, failAt);
  }
}

export interface ScriptedTurn {
  /** A tool call this turn makes instead of answering. */
  tool?: { name: string, arguments: string };
  /** The thinking this turn streams; it never reaches the transcript. */
  reasoning?: string;
  /** The answer this turn ends on. */
  answer?: string;
  tokens?: number;
}

export interface TestChatClient extends SkillChatClient {
  endpoint: { provider: string };
  readonly calls: number;
  readonly systems: string[];
  readonly requests: Array<Record<string, unknown>>;
}

/** A client that answers a fixed script of turns, so a loop's shape is the test's. */
export function scriptedClient(turns: readonly ScriptedTurn[], options: { latencyMs?: number } = {}): TestChatClient {
  let calls = 0;
  const systems: string[] = [];
  const requests: Array<Record<string, unknown>> = [];
  return {
    endpoint: { provider: 'scripted' },
    get calls() { return calls; },
    get systems() { return systems; },
    get requests() { return requests; },
    async complete(request: unknown) {
      const body = request as { messages?: Array<{ role: string, content: string }>, onReasoning?: (text: string) => void };
      requests.push(body as Record<string, unknown>);
      const system = body.messages?.find(message => message.role === 'system');
      if (system !== undefined) systems.push(system.content);
      const turn = turns[Math.min(calls, turns.length - 1)];
      calls++;
      if (options.latencyMs) await new Promise(resolve => setTimeout(resolve, options.latencyMs));
      if (turn.reasoning !== undefined) body.onReasoning?.(turn.reasoning);
      const usage = { total_tokens: turn.tokens ?? 64 };
      if (turn.tool !== undefined) {
        return {
          message: { role: 'assistant', content: '', toolCalls: [{ id: `call-${calls}`, name: turn.tool.name, arguments: turn.tool.arguments }] },
          finishReason: 'tool_calls', usage,
        };
      }
      return { message: { role: 'assistant', content: turn.answer ?? '' }, finishReason: 'stop', usage };
    },
  };
}

export interface TestAdapter extends Trace2SkillTaskAdapter {
  readonly reads: string[];
  answers: Map<string, string>;
}

/** The smallest host contract a rollout needs: one input, one registered answer. */
export function testAdapter(tasks: ReadonlyArray<{ id: string, prompt: string, input: string, answer: string }>): TestAdapter {
  const byId = new Map(tasks.map(task => [task.id, task]));
  const reads: string[] = [];
  const answers = new Map(tasks.map(task => [task.id, task.answer]));
  const refuse = <T>(code: 'TT2S1001' | 'TT2S1003', detail: string): Trace2SkillOutcome<T> =>
    ({ valid: false, issues: [{ code, path: '/tasks', detail }] });
  const adapter: TestAdapter = {
    id: 'test-adapter', revision: '1', evaluatorId: 'exact-v1',
    toolManifest: [{ name: 'read_file', description: 'read one input', scope: 'executor' }],
    toolManifestHash: HASH('a'),
    counts: { leakage: 0, refused: 0 },
    get reads() { return reads; },
    answers,
    prepare(taskId): Trace2SkillOutcome<PreparedSkillTask> {
      const task = byId.get(taskId);
      if (task === undefined) return refuse('TT2S1001', `no such task: ${taskId}`);
      return { valid: true, value: { taskId, prompt: task.prompt, inputs: [{ path: 'inputs/table.csv', content: task.input }] } };
    },
    executorTools(taskId) {
      const task = byId.get(taskId);
      return {
        read_file(path: string): Trace2SkillOutcome<string> {
          reads.push(`${taskId}:${path}`);
          if (path.startsWith('truth/')) { adapter.counts.leakage++; return refuse('TT2S1003', 'ground truth is unreadable from executor'); }
          if (task === undefined || path !== 'inputs/table.csv') { adapter.counts.refused++; return refuse('TT2S1003', `${path} is not an input`); }
          return { valid: true, value: task.input };
        },
      };
    },
    evaluate(taskId, answer): Trace2SkillOutcome<TaskEvaluation> {
      const expected = answers.get(taskId);
      if (expected === undefined) return refuse('TT2S1001', `no registered answer for ${taskId}`);
      const score = answer.trim() === expected ? 1 : 0;
      return { valid: true, value: { evaluatorId: 'exact-v1', score, detail: score === 1 ? 'match' : 'mismatch' } };
    },
    analystTools(taskId) {
      return {
        truth_read: (): Trace2SkillOutcome<string> => ({ valid: true, value: answers.get(taskId) ?? '' }),
        output_edit: (answer: string): string => answer,
        evaluate: (answer: string): Trace2SkillOutcome<TaskEvaluation> => adapter.evaluate(taskId, answer),
      };
    },
    cleanup: async (): Promise<void> => undefined,
  };
  return adapter;
}

/** The run record a rollout fan-out is pinned to. */
export function runRecord(overrides: Omit<Partial<EvolutionRun>, 's0Hash'> & { s0Hash: string }): EvolutionRun {
  return {
    id: RUN_ID, scopeKey: SCOPE, mode: 'deepening', s0Id: overrides.s0Hash,
    evolveHash: HASH('e'), testHash: HASH('7'),
    roles: [{ role: 'executor', identityId: 'keyless', promptVersion: 'executor-1' }],
    toolManifestHash: HASH('c'), budgets: { turns: 6, tokens: 16384, ms: 60000 }, concurrency: 4,
    bMerge: 4, lMax: 3, seed: 17753, supportThreshold: 1, status: 'running',
    spend: { calls: 0, tokens: 0, cost: null },
    ...overrides,
  };
}

/** Evolution task records for the smallest adapter above. */
export function taskRecords(ids: readonly string[], split: EvolutionTask['split'] = 'evolve'): EvolutionTask[] {
  return ids.map(id => ({
    id, scopeKey: SCOPE, split, prompt: `answer ${id}`,
    inputs: [{ path: 'inputs/table.csv', sha256: HASH('f'), size: 16 }],
    adapterId: 'test-adapter', adapterRevision: '1',
  }));
}
