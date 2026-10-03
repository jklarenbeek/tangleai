import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openTangleDb, createResearchStore, researchRunLogId, createRunLog, RESEARCH_COLLECTIONS, type TangleDb } from '@tangleai/store';
import { planProjectCreate, planStateTransition, type ResearchProjection, type ResearchStoreOutcome, type ResearchState } from '@tangleai/research';
import { researchStoreSuite, faultProbe, lifecycle, memoryHarness, stored, start, staged, type ResearchHarness } from '../research/store-harness.ts';
import { checked, project } from '../research/fixtures.ts';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function sqliteHarness(): Promise<ResearchHarness> {
  const probe = faultProbe(), db = await openTangleDb();
  return { store: createResearchStore(db, { now: () => '2026-10-03T00:00:00.000Z', applyProbe: probe.applyProbe }),
    close: () => db.close(), ...probe,
    async capture() {
      const rows: Record<string, unknown> = {};
      for (const table of [...Object.keys(RESEARCH_COLLECTIONS), 'runs', 'run_frames']) {
        const result: unknown[] = [];
        for await (const row of db.collection(table).query({ $for: { r: '$[*]' }, $orderby: '$r.id', $return: '$r' })) result.push(row);
        rows[table] = result;
      }
      return rows;
    },
    async projection(projectId) {
      const id = await researchRunLogId(db, projectId); if (id === null) return null;
      const log = createRunLog(db), found = await log.getRun(id), frames = await log.frames(id);
      assert.ok(found);
      const projected = frames.filter(frame => frame.kind === 'node').map(frame => ({ stage: frame.body.node,
        status: frame.body.status, ms: frame.body.ms }) as ResearchProjection);
      const statuses = frames.filter(frame => frame.kind === 'status');
      assert.equal(statuses.length, found.run.status === 'running' ? 0 : 1);
      assert.deepEqual(frames.map(frame => frame.seq), frames.map((_, i) => i + 1), 'native allocator owns every contiguous frame sequence');
      return { frames: projected, terminal: found.run.status === 'running' ? null : { status: found.run.status, state: found.run.summary.researchStatus } };
    } };
}
researchStoreSuite('SQLite research transactions', sqliteHarness);
it('one lifecycle fixture passes identically against memory and SQLite', async () => {
  const memory = await memoryHarness(), sqlite = await sqliteHarness();
  try {
    assert.deepEqual(await lifecycle(sqlite.store), await lifecycle(memory.store));
    assert.deepEqual(await sqlite.projection('fixture-project'), await memory.projection('fixture-project'));
  } finally { await memory.close(); await sqlite.close(); }
});
it('independent adapters serialize a project CAS and reopening retains attempts, artifacts and native projections', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tangle-research-store-')), path = join(directory, 'research.sqlite');
  let first: TangleDb | undefined, second: TangleDb | undefined;
  try {
    first = await openTangleDb({ path }); second = await openTangleDb({ path });
    const a = createResearchStore(first), b = createResearchStore(first), reader = createResearchStore(second);
    const state = await start(a), plan = checked(planStateTransition(state, 'DISCOVERY'));
    const outcomes = await Promise.all([a.transition(plan), b.transition(plan)]);
    assert.equal(outcomes.filter(row => row.ok).length, 1);
    const conflict = outcomes.find(row => !row.ok)!; assert.ok(!conflict.ok); assert.equal(conflict.issue.code, 'TRSH1004');
    const externalConflict = await reader.transition(plan); assert.ok(!externalConflict.ok); assert.equal(externalConflict.issue.code, 'TRSH1004');
    const next = stored(await a.getState(state.projectId))!, fixture = await staged(a, next, 'LITERATURE_GATE');
    const receipt = stored(await b.commitStage(fixture.plan)), before = stored(await a.snapshot(state.projectId));
    const id = await researchRunLogId(first, state.projectId); assert.ok(id);
    await second.close(); second = undefined; await first.close(); first = undefined;
    first = await openTangleDb({ path }); const reopened = createResearchStore(first);
    assert.deepEqual(stored(await reopened.snapshot(state.projectId)), before);
    assert.deepEqual(stored(await reopened.getAttempt(state.projectId, receipt.attempt.id)), receipt);
    assert.equal(await researchRunLogId(first, state.projectId), id);
    const replay = await reopened.commitStage(fixture.plan); assert.equal(replay.ok && replay.replayed, true);
    assert.equal((await createRunLog(first).frames(id)).length, 1);
    const other = stored(await reopened.createProject(checked(planProjectCreate(project('another-project')))));
    assert.notEqual(await researchRunLogId(first, other.projectId), id);
  } finally { await second?.close(); await first?.close(); await rm(directory, { recursive: true, force: true }); }
});
it('independent processes compete on one persisted revision and produce exactly one winner', { timeout: 15000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tangle-research-cas-')), path = join(directory, 'research.sqlite');
  const db = await openTangleDb({ path });
  const children: Array<ReturnType<typeof spawn>> = [];
  try {
    const state = await start(createResearchStore(db)), plan = checked(planStateTransition(state, 'DISCOVERY'));
    const workers = [0, 1].map(() => {
      const child = spawn(process.execPath, [fileURLToPath(new URL('./research-cas.fixture.ts', import.meta.url)), path, JSON.stringify(plan)],
        { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
      children.push(child); let stdout = '', stderr = '';
      const ready = deferred<void>(), done = deferred<ResearchStoreOutcome<ResearchState>>();
      const timeout = setTimeout(() => child.kill(), 10000);
      child.stdout!.on('data', chunk => { stdout += String(chunk); if (stdout.startsWith('ready\n')) ready.resolve(); });
      child.stderr!.on('data', chunk => { stderr += String(chunk); });
      child.on('error', error => { ready.reject(error); done.reject(error); });
      child.on('close', code => {
        clearTimeout(timeout);
        if (code !== 0) { const error = new Error('CAS worker failed: ' + stderr); ready.reject(error); done.reject(error); }
        else { try { done.resolve(JSON.parse(stdout.trim().split('\n').at(-1)!)); } catch (error) { done.reject(error); } }
      });
      return { child, ready: ready.promise, done: done.promise };
    });
    const outcomesPromise = Promise.all(workers.map(worker => worker.done));
    await Promise.all(workers.map(worker => worker.ready));
    for (const worker of workers) worker.child.stdin!.end('go\n');
    const outcomes = await outcomesPromise;
    assert.equal(outcomes.filter(outcome => outcome.ok).length, 1);
    const loser = outcomes.find(outcome => !outcome.ok)!; assert.ok(!loser.ok); assert.equal(loser.issue.code, 'TRSH1004');
    assert.deepEqual(stored(await createResearchStore(db).getState(state.projectId)), plan.nextState);
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill();
    await db.close(); await rm(directory, { recursive: true, force: true });
  }
});
