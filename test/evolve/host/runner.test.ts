/**
 * The runner, with a spawn counter watching it.
 *
 * Nearly every assertion here checks TWO things: that the refusal has the
 * right code, and that `spawns` did not move. A refusal that arrives after
 * the child already started is not the same guarantee — the point of the
 * allow-list is that nothing runs, not that something ran and was
 * disapproved of afterwards.
 *
 * The real-process cases at the end use `process.execPath`, so the
 * timeout, truncation and exit-code paths are exercised against an actual
 * child rather than a stub that agrees with the implementation.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createProcessRunner, type ProcessRunnerOptions } from '@tangleai/evolve/host';
import { ok, refuseOne } from '@tangleai/evolve';

const acceptAll = () => ok(true as const);
const rejectAll = () => refuseOne<true>('TEVO1006', '/args', 'nothing is acceptable here');

function runnerFor(root: string, overrides: Partial<ProcessRunnerOptions> = {}) {
  let spawned = 0;
  const options: ProcessRunnerOptions = {
    allow: {
      node: { file: process.execPath, args: acceptAll, cwd: 'worktree' },
      picky: { file: process.execPath, args: rejectAll, cwd: 'worktree' },
      elsewhere: { file: process.execPath, args: acceptAll, cwd: 'repository' },
    },
    env: { allow: ['PATH'], set: { CI: '1', GIT_TERMINAL_PROMPT: '0' } },
    limits: { legMs: 5000, stdoutBytes: 64 * 1024, stderrBytes: 64 * 1024 },
    roots: { worktree: root },
    ...overrides,
  };
  const runner = createProcessRunner(options);
  return { runner, spawned: () => spawned };
}

describe('the bounded process runner', () => {
  it('refuses what the allow-list does not name, before spawning', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tangle-runner-'));
    try {
      const { runner } = runnerFor(dir);
      const refused = await runner.run({ name: 'rm', args: ['-rf', '/'], cwd: dir });
      assert.equal(refused.ok, false);
      assert.equal((refused as { issues: Array<{ code: string, path: string }> }).issues[0].code, 'TEVO1006');
      assert.equal((refused as { issues: Array<{ path: string }> }).issues[0].path, '/name');
      assert.equal(runner.spawns, 0, 'an unknown command must not reach spawn');
    }
    finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('refuses an argument its validator rejects, before spawning', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tangle-runner-'));
    try {
      const { runner } = runnerFor(dir);
      const refused = await runner.run({ name: 'picky', args: ['-e', 'process.exit(0)'], cwd: dir });
      assert.equal(refused.ok, false);
      assert.equal((refused as { issues: Array<{ code: string }> }).issues[0].code, 'TEVO1006');
      assert.equal(runner.spawns, 0);
    }
    finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('refuses a working directory outside the declared root, symlink included', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tangle-runner-'));
    const outside = await mkdtemp(join(tmpdir(), 'tangle-outside-'));
    try {
      const { runner } = runnerFor(join(dir, 'root'));
      await mkdir(join(dir, 'root'), { recursive: true });

      const escaped = await runner.run({ name: 'node', args: ['-e', ''], cwd: outside });
      assert.equal(escaped.ok, false);
      assert.equal((escaped as { issues: Array<{ path: string }> }).issues[0].path, '/cwd');
      assert.equal(runner.spawns, 0);

      // A symlink inside the root pointing out of it is the interesting
      // case: the path looks contained until both ends are resolved.
      await symlink(outside, join(dir, 'root', 'link'), 'dir');
      const indirect = await runner.run({ name: 'node', args: ['-e', ''], cwd: join(dir, 'root', 'link') });
      assert.equal(indirect.ok, false, 'realpath both sides, or a symlink walks out');
      assert.equal((indirect as { issues: Array<{ code: string }> }).issues[0].code, 'TEVO1006');
      assert.equal(runner.spawns, 0);
    }
    finally {
      await rm(dir, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('refuses a command whose declared root the host did not supply', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tangle-runner-'));
    try {
      const { runner } = runnerFor(dir);
      const refused = await runner.run({ name: 'elsewhere', args: ['-e', ''], cwd: dir });
      assert.equal(refused.ok, false, 'no repository root was declared');
      assert.equal((refused as { issues: Array<{ path: string }> }).issues[0].path, '/cwd');
      assert.equal(runner.spawns, 0);
    }
    finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('builds the child environment instead of inheriting it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tangle-runner-'));
    const secret = 'TANGLE_AI_API_KEY';
    const previous = process.env[secret];
    process.env[secret] = 'sk-must-never-reach-a-child';
    try {
      const { runner } = runnerFor(dir);
      const result = await runner.run({
        name: 'node',
        args: ['-e', 'process.stdout.write(JSON.stringify(process.env))'],
        cwd: dir,
      });
      assert.equal(result.ok, true, JSON.stringify(result));
      const childEnv = JSON.parse((result as { value: { stdout: string } }).value.stdout);
      assert.equal(childEnv[secret], undefined, 'a credential outside the allow-list never reaches the child');
      assert.equal(childEnv.CI, '1', 'the host’s fixed values are set');
      assert.equal(childEnv.GIT_TERMINAL_PROMPT, '0');
      assert.equal(typeof childEnv.PATH, 'string', 'the allow-list carried PATH');
      assert.equal(runner.spawns, 1);
    }
    finally {
      if (previous === undefined) delete process.env[secret]; else process.env[secret] = previous;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('kills a child that outruns its deadline and reports the budget', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tangle-runner-'));
    try {
      const { runner } = runnerFor(dir, { limits: { legMs: 300, stdoutBytes: 4096, stderrBytes: 4096 } });
      const refused = await runner.run({
        name: 'node',
        args: ['-e', 'setTimeout(() => {}, 60000)'],
        cwd: dir,
      });
      assert.equal(refused.ok, false);
      const issues = (refused as { issues: Array<{ code: string, path: string }> }).issues;
      assert.equal(issues[0].code, 'TEVO1005');
      assert.equal(issues[0].path, '/budgets/legMs');
      assert.equal(runner.spawns, 1, 'it did run; it did not get to finish');
    }
    finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('kills what the child started too, not only the child', async (t) => {
    // A gate command is rarely one process: `node --test` runs each file in
    // its own worker. Signalling only the direct child leaves those workers
    // alive and reparented to init, spinning on a CPU forever, while the
    // runner still reports a tidy SIGKILL — the leak hiding exactly where
    // the deadline was meant to prove nothing escaped.
    if (process.platform === 'win32') return t.skip('no process groups on Windows');
    const dir = await mkdtemp(join(tmpdir(), 'tangle-runner-'));
    try {
      const pidFile = join(dir, 'grandchild.pid');
      const parent = [
        'const { spawn } = require("node:child_process");',
        // A grandchild that would outlive its parent, like a test worker.
        'const kid = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
        `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(kid.pid));`,
        'setTimeout(() => {}, 60000);',
      ].join('');

      const { runner } = runnerFor(dir, { limits: { legMs: 1000, stdoutBytes: 4096, stderrBytes: 4096 } });
      const refused = await runner.run({ name: 'node', args: ['-e', parent], cwd: dir });

      assert.equal(refused.ok, false);
      assert.equal((refused as { issues: Array<{ code: string }> }).issues[0].code, 'TEVO1005');

      const grandchild = Number(await readFile(pidFile, 'utf8'));
      assert.ok(Number.isInteger(grandchild) && grandchild > 0, 'the grandchild recorded its pid');

      // Signal 0 tests for existence. Reaping is not instant, so allow a
      // brief window rather than asserting on the first observation.
      const gone = async (): Promise<boolean> => {
        for (let attempt = 0; attempt < 50; attempt++) {
          try { process.kill(grandchild, 0); }
          catch { return true; }
          await new Promise(resolveWait => setTimeout(resolveWait, 100));
        }
        return false;
      };
      assert.ok(await gone(), 'the deadline reached the whole process group, not just its leader');
    }
    finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('caps a flood of output and reports it rather than only truncating', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tangle-runner-'));
    try {
      const { runner } = runnerFor(dir, { limits: { legMs: 20000, stdoutBytes: 1024, stderrBytes: 1024 } });
      const refused = await runner.run({
        name: 'node',
        args: ['-e', 'process.stdout.write("x".repeat(2 * 1024 * 1024))'],
        cwd: dir,
      });
      assert.equal(refused.ok, false, 'a flood cannot pass quietly');
      const issues = (refused as { issues: Array<{ code: string, path: string }> }).issues;
      assert.ok(issues.some(one => one.path === '/budgets/stdoutBytes' && one.code === 'TEVO1005'));
    }
    finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('answers an ordinary run with its exit code, and a failing one without throwing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tangle-runner-'));
    try {
      const { runner } = runnerFor(dir);
      const green = await runner.run({ name: 'node', args: ['-e', 'process.stdout.write("fine")'], cwd: dir });
      assert.equal(green.ok, true);
      assert.equal((green as { value: { exitCode: number } }).value.exitCode, 0);
      assert.equal((green as { value: { stdout: string } }).value.stdout, 'fine');
      assert.equal((green as { value: { truncated: { stdout: boolean } } }).value.truncated.stdout, false);

      const red = await runner.run({ name: 'node', args: ['-e', 'process.exit(3)'], cwd: dir });
      assert.equal(red.ok, true, 'a non-zero exit is a value, not a refusal');
      assert.equal((red as { value: { exitCode: number } }).value.exitCode, 3);
    }
    finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('turns a spawn failure into a refusal rather than an exception', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tangle-runner-'));
    try {
      const runner = createProcessRunner({
        allow: { missing: { file: join(dir, 'does-not-exist'), args: acceptAll, cwd: 'worktree' } },
        env: { allow: [], set: {} },
        limits: { legMs: 5000, stdoutBytes: 4096, stderrBytes: 4096 },
        roots: { worktree: dir },
      });
      const refused = await runner.run({ name: 'missing', args: [], cwd: dir });
      assert.equal(refused.ok, false);
      assert.equal((refused as { issues: Array<{ code: string }> }).issues[0].code, 'TEVO1006');
    }
    finally { await rm(dir, { recursive: true, force: true }); }
  });
});
