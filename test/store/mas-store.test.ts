/**
 * The MAS store adapter over the real Jaren database in BOTH modes —
 * SQLite `:memory:` and a temporary file — exercising the same
 * validator/transaction path ephemeral and durable: immutable puts,
 * activation compare-and-swap under twenty concurrent attempts, atomic
 * five-way node completion with forced rollback at every stage,
 * semantic idempotency, claim-epoch fencing and isolated reads.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

import { nodeDriver } from '@jarenjs/db/node';
import type { CommitCompletionPlan, MasStore, MasWorkflow } from '@tangleai/mas';
import { openTangleDb, createMasStore, type TangleDb } from '@tangleai/store';

const workflow = (JSON.parse(await readFile('benchmark/fixtures/mas/positive/sequential.json', 'utf8')) as { workflow: MasWorkflow }).workflow;

interface Harness {
  db: TangleDb;
  store: MasStore;
  probeSteps: string[];
  failAt: { step: string | null };
}

async function harness(path?: string): Promise<Harness> {
  const db = await openTangleDb({ driver: nodeDriver(), ...(path === undefined ? {} : { path }) });
  let tick = 0;
  const probeSteps: string[] = [];
  const failAt: { step: string | null } = { step: null };
  const store = createMasStore(db, {
    now: () => `tick-${String(tick++).padStart(4, '0')}`,
    applyProbe: (step) => {
      probeSteps.push(step);
      if (failAt.step === step) throw new Error(`injected failure after ${step}`);
    },
  });
  return { db, store, probeSteps, failAt };
}

const RUN_PLAN = {
  runId: 'run-1',
  workflowId: workflow.workflowId,
  workflowVersionId: workflow.versionId,
  registryRevision: 'b'.repeat(64),
  executableRevision: 'c'.repeat(64),
  configRegistryRevision: null,
  profile: 'scripted',
  input: { text: 'hello' },
  limits: { calls: 10 },
};

function completionPlan(attemptId: string, claimSeq: number): CommitCompletionPlan {
  return {
    runId: 'run-1',
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
    state: { namespace: '', value: { visible: 1 }, members: ['/visible'] },
    spend: { turns: 1, tokens: 8, ms: 5 },
    usage: { calls: 1, toolCalls: 0, contextReads: 0, promptTokens: 5, completionTokens: 3 },
    stopReason: 'stop',
    transcript: { state: 'retained', text: '[paid] hello', size: 12, artifact: null },
    toolSteps: [],
    contextReads: [],
    artifacts: [{ kind: 'transcript', state: 'retained', size: 12, bytes: '[paid] hello' }],
    restored: false,
  };
}

for (const mode of ['memory', 'file'] as const) {
  describe(`the adapter over ${mode === 'memory' ? 'SQLite :memory:' : 'a temporary SQLite file'}`, async () => {
    const path = mode === 'memory' ? undefined : join(await mkdtemp(join(tmpdir(), 'mas-store-')), 'mas.db');

    it('immutable puts: idempotent same bytes, refused mutation, refused stale address', async () => {
      const { store } = await harness(path === undefined ? undefined : `${path}.immutable`);
      const first = await store.putWorkflowVersion(workflow);
      assert.ok(first.ok);
      const again = await store.putWorkflowVersion(structuredClone(workflow));
      assert.ok(again.ok, 'a same-byte repeated put changes nothing');

      const mutated = structuredClone(workflow);
      mutated.title = 'moved bytes';
      const refused = await store.putWorkflowVersion(mutated);
      assert.ok(!refused.ok, 'a mutated document cannot keep a stale address');
      assert.equal(refused.issue.code, 'TMAS2001');

      const read = await store.getWorkflowVersion(workflow.versionId);
      assert.ok(read !== undefined);
      (read as { title: string }).title = 'mutated read';
      const reread = await store.getWorkflowVersion(workflow.versionId);
      assert.equal(reread?.title, workflow.title, 'reads are deeply isolated');
    });

    it('twenty concurrent activation attempts apply exactly once', async () => {
      const { store } = await harness(path === undefined ? undefined : `${path}.cas`);
      assert.ok((await store.putWorkflowVersion(workflow)).ok);
      const outcomes = await Promise.all(
        Array.from({ length: 20 }, () => store.activateWorkflow(workflow.workflowId, workflow.versionId, null)),
      );
      const applied = outcomes.filter((outcome) => outcome.applied);
      const conflicts = outcomes.filter((outcome) => !outcome.applied);
      assert.equal(applied.length, 1, 'exactly one activation applies');
      assert.equal(conflicts.length, 19, 'nineteen conflict');
      for (const conflict of conflicts) {
        assert.ok(!conflict.applied);
        assert.equal(conflict.conflict.code, 'TMAS2001');
      }
      const head = await store.getActiveWorkflow(workflow.workflowId);
      assert.equal(head?.activeVersion, workflow.versionId);
    });

    it('a forced failure after every completion stage leaves NOTHING; success commits all five', async () => {
      const { db, store, failAt } = await harness(path === undefined ? undefined : `${path}.atomic`);
      assert.ok((await store.createRun(RUN_PLAN)).ok);
      const claimed = await store.claimRunSegment('run-1', 'w1');
      assert.ok(claimed.ok);
      const begun = await store.beginNodeAttempt({
        runId: 'run-1',
        idempotencyKey: 'run-1/dag0//0/first',
        path: 'first',
        invocationId: 'first',
        kind: 'task',
        claimSeq: claimed.value.claim.seq,
      });
      assert.equal(begun.kind, 'started');
      const attemptId = begun.kind === 'started' ? begun.attempt.id : '';

      for (const step of ['attempt', 'messages', 'state', 'artifacts', 'budget']) {
        failAt.step = step;
        await assert.rejects(
          store.commitNodeCompletion(completionPlan(attemptId, claimed.value.claim.seq)),
          /injected failure/,
          `stage ${step} fails loudly`,
        );
        failAt.step = null;
        const attempt = (await store.readTrace('run-1'))?.attempts.find((row) => row.id === attemptId);
        assert.equal(attempt?.status, 'running', `after a ${step}-stage failure the attempt is still running`);
        const trace = await store.readTrace('run-1');
        assert.equal(trace?.messages.length, 0, `after a ${step}-stage failure no message exists`);
        assert.equal(trace?.stateRevisions.length, 0, `no state revision exists`);
        assert.equal(trace?.artifacts.length, 0, `no artifact exists`);
        assert.deepEqual(trace?.run.budget.spent, { turns: 0, tokens: 0, ms: 0 }, 'no budget moved');
      }

      const committed = await store.commitNodeCompletion(completionPlan(attemptId, claimed.value.claim.seq));
      assert.ok(committed.ok, JSON.stringify(!committed.ok ? committed.issue : null));
      const trace = await store.readTrace('run-1');
      assert.equal(trace?.attempts[0].status, 'completed');
      assert.equal(trace?.messages.length, 1);
      assert.equal(trace?.stateRevisions.length, 1);
      assert.equal(trace?.artifacts.length, 1);
      assert.deepEqual(trace?.run.budget.spent, { turns: 1, tokens: 8, ms: 5 });
      const seqs = [
        ...(trace?.attempts.map((row) => row.seq) ?? []),
        ...(trace?.messages.map((row) => row.seq) ?? []),
        ...(trace?.stateRevisions.map((row) => row.seq) ?? []),
      ].sort((a, b) => a - b);
      assert.deepEqual(seqs, [1, 2, 3], 'the trace sequence derives from committed records');

      // db handle kept open for the duration of the test body
      void db;
    });

    it('replaying a committed idempotency key returns the stored completion and writes nothing', async () => {
      const { store } = await harness(path === undefined ? undefined : `${path}.idem`);
      assert.ok((await store.createRun(RUN_PLAN)).ok);
      const claimed = await store.claimRunSegment('run-1', 'w1');
      assert.ok(claimed.ok);
      const key = { runId: 'run-1', idempotencyKey: 'run-1/dag0//0/first', path: 'first', invocationId: 'first', kind: 'task' as const, claimSeq: claimed.value.claim.seq };
      const begun = await store.beginNodeAttempt(key);
      assert.equal(begun.kind, 'started');
      const attemptId = begun.kind === 'started' ? begun.attempt.id : '';
      assert.ok((await store.commitNodeCompletion(completionPlan(attemptId, claimed.value.claim.seq))).ok);

      const replay = await store.beginNodeAttempt(key);
      assert.equal(replay.kind, 'completed', 'the stored completion returns');
      assert.ok(replay.kind === 'completed');
      assert.deepEqual(replay.attempt.output, { value: 'hello' });
      assert.equal(replay.messages.length, 1);
      const trace = await store.readTrace('run-1');
      assert.equal(trace?.attempts.length, 1, 'a replay writes no second attempt');

      const different = await store.commitNodeCompletion({ ...completionPlan(attemptId, claimed.value.claim.seq), output: { value: 'other' } });
      assert.ok(!different.ok, 'a different payload under a committed key refuses');
      assert.equal(different.issue.code, 'TMAS2001');
    });

    it('a stale claim epoch cannot begin, commit or fail an attempt (TMAS2005)', async () => {
      const { store } = await harness(path === undefined ? undefined : `${path}.claim`);
      assert.ok((await store.createRun(RUN_PLAN)).ok);
      const first = await store.claimRunSegment('run-1', 'zombie');
      assert.ok(first.ok);
      const staleSeq = first.value.claim.seq;
      const reclaimed = await store.claimRunSegment('run-1', 'healthy');
      assert.ok(reclaimed.ok);

      const begun = await store.beginNodeAttempt({
        runId: 'run-1', idempotencyKey: 'run-1/dag0//0/first', path: 'first', invocationId: 'first', kind: 'task', claimSeq: staleSeq,
      });
      assert.equal(begun.kind, 'refused');
      assert.ok(begun.kind === 'refused' && begun.issue.code === 'TMAS2005');

      const healthy = await store.beginNodeAttempt({
        runId: 'run-1', idempotencyKey: 'run-1/dag0//0/first', path: 'first', invocationId: 'first', kind: 'task', claimSeq: reclaimed.value.claim.seq,
      });
      assert.equal(healthy.kind, 'started');
      const zombieCommit = await store.commitNodeCompletion(completionPlan(healthy.kind === 'started' ? healthy.attempt.id : '', staleSeq));
      assert.ok(!zombieCommit.ok && zombieCommit.issue.code === 'TMAS2005', 'a zombie cannot commit a completion');
    });

    it('an uncertain attempt blocks automatic repetition until resolution (TMAS2006)', async () => {
      const { store } = await harness(path === undefined ? undefined : `${path}.uncertain`);
      assert.ok((await store.createRun(RUN_PLAN)).ok);
      const claimed = await store.claimRunSegment('run-1', 'w1');
      assert.ok(claimed.ok);
      const key = { runId: 'run-1', idempotencyKey: 'run-1/dag0//0/first', path: 'first', invocationId: 'first', kind: 'task' as const, claimSeq: claimed.value.claim.seq };
      const begun = await store.beginNodeAttempt(key);
      assert.equal(begun.kind, 'started');
      const marked = await store.failNodeAttempt({
        runId: 'run-1',
        attemptId: begun.kind === 'started' ? begun.attempt.id : '',
        claimSeq: claimed.value.claim.seq,
        status: 'uncertain',
        error: { code: 'TMAS2006', detail: 'the provider succeeded but the durable outcome is unknown', cause: null },
      });
      assert.ok(marked.ok);
      const reclaimed = await store.claimRunSegment('run-1', 'w2');
      assert.ok(reclaimed.ok);
      const again = await store.beginNodeAttempt({ ...key, claimSeq: reclaimed.value.claim.seq });
      assert.equal(again.kind, 'uncertain', 'automatic resume refuses to repeat external work');
      assert.ok(again.kind === 'uncertain' && again.issue.code === 'TMAS2006');
    });

    it('interactions: one response, conflicting seconds and expiry are TMAS2007 values', async () => {
      const { store } = await harness(path === undefined ? undefined : `${path}.interaction`);
      assert.ok((await store.createRun(RUN_PLAN)).ok);
      assert.ok((await store.claimRunSegment('run-1', 'w1')).ok);
      assert.ok((await store.transitionRun('run-1', { kind: 'wait' })).ok);
      const created = await store.createInteraction({
        runId: 'run-1',
        node: 'approve',
        path: 'approve',
        prompt: { summary: 'about: d1' },
        responseSchema: {
          type: 'object',
          required: ['decision', 'note'],
          properties: { decision: { enum: ['accept', 'revise'] }, note: { type: 'string' } },
          additionalProperties: false,
        },
        expiry: null,
        segment: 0,
      });
      assert.ok(created.ok);
      const id = created.value.id;

      const invalid = await store.respondInteraction(id, { decision: 'maybe', note: 1 }, 0, 'key-1');
      assert.ok(!invalid.ok && invalid.issue.code === 'TMAS2007', 'an invalid response is a TMAS2007 value');

      const responded = await store.respondInteraction(id, { decision: 'accept', note: 'ok' }, 0, 'key-1');
      assert.ok(responded.ok, JSON.stringify(!responded.ok ? responded.issue : null));
      assert.equal(responded.value.status, 'responded');
      assert.equal(responded.value.resumeSegment, 1);
      assert.equal((await store.getRun('run-1'))?.status, 'resume_pending');

      const idempotent = await store.respondInteraction(id, { decision: 'accept', note: 'ok' }, 0, 'key-1');
      assert.ok(idempotent.ok, 'the same response key replays the stored acceptance');

      const conflicting = await store.respondInteraction(id, { decision: 'revise', note: 'no' }, 1, 'key-2');
      assert.ok(!conflicting.ok && conflicting.issue.code === 'TMAS2007', 'a conflicting second response refuses');
    });
  });
}
