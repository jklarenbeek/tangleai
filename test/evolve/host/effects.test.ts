/**
 * The fence, and the property that makes a crash survivable.
 *
 * The load-bearing test is `replay spends nothing`: the same plan id is
 * prepared twice and run twice, and the second run must spawn zero
 * processes. Everything else about crash recovery follows from that — if a
 * replay could re-spawn, then "resume" would mean "do it again", and an
 * experiment that died after running a gate would run it twice.
 *
 * The executor is checked for the two things the suite's fence cannot
 * check for it: that it asks `beforeDispatch` BEFORE doing anything, and
 * that it never throws.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createExternalEffects } from '@jarenjs/flow';
import { openTangleDb, createEvolveEffectStore } from '@tangleai/store';
import {
  createProcessRunner, createEffectExecutor, classifyEffect, authorizeEffect,
  neverWriteSet, validateGitArgs, createEffectDriver, type EffectPlan,
} from '@tangleai/evolve/host';
import { ok } from '@tangleai/evolve';

const now = () => 1767225600000;

function countingRunner(root: string) {
  const runner = createProcessRunner({
    allow: { node: { file: process.execPath, args: () => ok(true as const), cwd: 'worktree' } },
    env: { allow: ['PATH'], set: {} },
    limits: { legMs: 20000, stdoutBytes: 65536, stderrBytes: 65536 },
    roots: { worktree: root },
  });
  return runner;
}

const planFor = (id: string, root: string, script: string): EffectPlan => ({
  id,
  jobId: id,
  kind: 'evolve-effect',
  actor: 'evolve-automation',
  reason: 'test',
  hashVersion: '1',
  legs: [{
    id: 'leg-1',
    request: { safety: 'single-send', command: { name: 'node', args: ['-e', script], cwd: root } },
    maxAttempts: 1,
  }],
});

describe('the effect fence', () => {
  it('records the intent before dispatching, and never throws', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tangle-eff-'));
    try {
      const order: string[] = [];
      const executor = createEffectExecutor({ runner: countingRunner(dir), host: {} as never });

      const response = await executor.execute(
        { safety: 'single-send', command: { name: 'node', args: ['-e', 'process.exit(0)'], cwd: dir } },
        {
          signal: new AbortController().signal,
          budget: { safety: 'single-send', take: () => { order.push('take'); return true; } },
          beforeDispatch: async () => { order.push('beforeDispatch'); return true; },
        });
      assert.equal(response.state, 'ok');
      assert.deepEqual(order, ['beforeDispatch', 'take'], 'the intent is written first, always');

      // Refused admission means nothing runs at all.
      const runner = countingRunner(dir);
      const refusedExecutor = createEffectExecutor({ runner, host: {} as never });
      const refused = await refusedExecutor.execute(
        { safety: 'single-send', command: { name: 'node', args: ['-e', ''], cwd: dir } },
        { signal: new AbortController().signal, budget: { safety: 'single-send', take: () => true }, beforeDispatch: async () => false });
      assert.equal(refused.state, 'refused');
      assert.equal(runner.spawns, 0, 'a leg that was not admitted never spawns');

      // A host that throws is answered, not propagated.
      const brokenHost = { create: () => { throw new Error('boom'); } } as never;
      const broken = createEffectExecutor({ runner: countingRunner(dir), host: brokenHost });
      const answered = await broken.execute(
        { safety: 'single-send', worktree: { op: 'create', input: {} } },
        { signal: new AbortController().signal, budget: { safety: 'single-send', take: () => true }, beforeDispatch: async () => true });
      assert.equal(answered.state, 'unresolved', 'a defect is an effect nobody can account for');
    }
    finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('classifies from structure, never from what the child printed', () => {
    const green = classifyEffect({ state: 'ok', response: ok({ exitCode: 0, signal: null, stdout: 'FAILED', stderr: '', truncated: { stdout: false, stderr: false }, durationMs: 1 }) }, { id: 'leg-1' });
    assert.equal(green.state, 'confirmed', 'the exit code decides, not the word FAILED');

    const red = classifyEffect({ state: 'ok', response: ok({ exitCode: 1, signal: null, stdout: 'all good!', stderr: '', truncated: { stdout: false, stderr: false }, durationMs: 1 }) }, { id: 'leg-1' });
    assert.equal(red.state, 'rejected', 'a convincing success message does not change an exit code');
    assert.equal((red.evidence as { exitCode: number }).exitCode, 1);

    const refusedLeg = classifyEffect({ state: 'ok', response: { ok: false, issues: [{ code: 'TEVO1006', path: '/name', detail: 'x' }] } }, { id: 'leg-1' });
    assert.equal(refusedLeg.state, 'rejected');
    assert.equal((refusedLeg.evidence as { code: string }).code, 'TEVO1006');

    const absent = classifyEffect({ state: 'unresolved' }, { id: 'leg-1' });
    assert.equal(absent.state, 'rejected');
  });

  it('authorizes only plans whose every leg stays inside the vocabulary', () => {
    const never = neverWriteSet({ protectedRefs: ['main'], operatorBranch: 'main', checkedOut: ['main'] });
    const options = { never, allowedCommands: ['git', 'node'] };

    assert.equal(authorizeEffect({ legs: [{ request: { safety: 'single-send', command: { name: 'git', args: ['status', '--porcelain'], cwd: '/tmp' } } }] }, options), true);
    assert.equal(authorizeEffect({ legs: [] }, options), false, 'an empty plan authorizes nothing');
    assert.equal(authorizeEffect({ legs: [{ request: { safety: 'single-send', command: { name: 'rm', args: [], cwd: '/tmp' } } }] }, options), false);
    assert.equal(authorizeEffect({ legs: [{ request: { safety: 'single-send', command: { name: 'git', args: ['push', 'origin', 'main'], cwd: '/tmp' } } }] }, options), false);
    assert.equal(authorizeEffect({ legs: [{ request: { safety: 'single-send', command: { name: 'git', args: ['branch', '-D', 'main'], cwd: '/tmp' } } }] }, options), false,
      'a protected ref is refused even in an otherwise legal verb');
  });

  it('replay spends nothing: the same plan prepared twice runs once', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tangle-eff-'));
    const db = await openTangleDb({ path: join(dir, 'effects.sqlite'), jobs: { now, random: () => 0.5 } });
    try {
      const store = createEvolveEffectStore(db);
      const runner = countingRunner(dir);
      const executor = createEffectExecutor({ runner, host: {} as never });
      const never = neverWriteSet({ protectedRefs: ['main'], operatorBranch: 'main', checkedOut: [] });
      const external = createExternalEffects({
        store,
        executor,
        authorize: (plan: never) => authorizeEffect(plan, { never, allowedCommands: ['node'] }),
        classify: classifyEffect as never,
      });

      const driver = createEffectDriver({
        jobs: db.jobs as never,
        effects: store as never,
        external: external as never,
        owner: 'test-owner',
      });

      const plan = planFor('e1/gate', dir, 'process.exit(0)');
      const first = await driver.run(plan);
      assert.equal(first.ok, true, JSON.stringify(first));
      const firstValue = (first as { value: { prepared: number, state: string, legs: Array<{ state: string }> } }).value;
      assert.equal(firstValue.prepared, 1, 'the first preparation writes the record');
      assert.equal(firstValue.state, 'complete');
      assert.deepEqual(firstValue.legs, [{ id: 'leg-1', state: 'confirmed' }]);
      assert.equal(runner.spawns, 1);

      // The same semantic id again: the record replays, nothing spawns.
      const second = await driver.run(plan);
      assert.equal(second.ok, true, JSON.stringify(second));
      const secondValue = (second as { value: { prepared: number, state: string } }).value;
      assert.equal(secondValue.prepared, 0, 'the record already held this plan');
      assert.equal(secondValue.state, 'complete');
      assert.equal(runner.spawns, 1, 'a replay must not run the effect a second time');
    }
    finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refuses a changed payload under an id the record already holds', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tangle-eff-'));
    const db = await openTangleDb({ path: join(dir, 'effects.sqlite'), jobs: { now, random: () => 0.5 } });
    try {
      const store = createEvolveEffectStore(db);
      const runner = countingRunner(dir);
      const never = neverWriteSet({ protectedRefs: ['main'], operatorBranch: 'main', checkedOut: [] });
      const external = createExternalEffects({
        store,
        executor: createEffectExecutor({ runner, host: {} as never }),
        authorize: (plan: never) => authorizeEffect(plan, { never, allowedCommands: ['node'] }),
        classify: classifyEffect as never,
      });
      const driver = createEffectDriver({ jobs: db.jobs as never, effects: store as never, external: external as never, owner: 'test-owner' });

      assert.equal((await driver.run(planFor('e2/gate', dir, 'process.exit(0)'))).ok, true);

      const changed = await driver.run(planFor('e2/gate', dir, 'process.exit(1)'));
      assert.equal(changed.ok, false, 'the plan you replayed is not the plan that ran');
      const issue = (changed as { issues: Array<{ code: string, cause?: { code: string } }> }).issues[0];
      assert.equal(issue.code, 'TEVO1002');
      assert.equal(issue.cause?.code, 'JL2009', 'the suite’s own refusal is carried');
    }
    finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('records a red gate as a rejected leg rather than a failure to run', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tangle-eff-'));
    const db = await openTangleDb({ path: join(dir, 'effects.sqlite'), jobs: { now, random: () => 0.5 } });
    try {
      const store = createEvolveEffectStore(db);
      const runner = countingRunner(dir);
      const never = neverWriteSet({ protectedRefs: ['main'], operatorBranch: 'main', checkedOut: [] });
      const external = createExternalEffects({
        store,
        executor: createEffectExecutor({ runner, host: {} as never }),
        authorize: (plan: never) => authorizeEffect(plan, { never, allowedCommands: ['node'] }),
        classify: classifyEffect as never,
      });
      const driver = createEffectDriver({ jobs: db.jobs as never, effects: store as never, external: external as never, owner: 'test-owner' });

      const result = await driver.run(planFor('e3/gate', dir, 'process.exit(7)'));
      assert.equal(result.ok, true, 'the effect happened; its outcome was red');
      assert.deepEqual((result as { value: { legs: Array<{ id: string, state: string }> } }).value.legs,
        [{ id: 'leg-1', state: 'rejected' }]);
      assert.equal(runner.spawns, 1);
    }
    finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
