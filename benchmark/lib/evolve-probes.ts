/**
 * The four host probes, executed for real.
 *
 * These are not unit tests restated — they are the instrument asking the
 * host the questions an adversary would, and recording the answer as a
 * measured row. A probe that cannot be run is `implementation-missing`; a
 * probe that runs and gets the wrong answer is `fail`, and a failing probe
 * is what stops the whole instrument from reporting an improvement.
 *
 * Every probe returns a value. None throws, because a probe that crashed
 * would otherwise look like a probe that passed.
 */

import { mkdtemp, rm, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { createProcessRunner, validateGitArgs, neverWriteSet, refuseProtectedRef } from '@tangleai/evolve/host';
import { ok } from '@tangleai/evolve';

const exec = promisify(execFile);

export interface ProbeResult {
  id: string;
  state: 'pass' | 'fail' | 'implementation-missing';
  detail: string | null;
}

const scratch = () => mkdtemp(join(tmpdir(), 'evolve-probe-'));

/** A working directory reached through a symlink must not escape the root. */
async function symlinkIndirection(): Promise<ProbeResult> {
  const id = 'symlink-indirection';
  const dir = await scratch();
  const outside = await scratch();
  try {
    const root = join(dir, 'root');
    await mkdir(root, { recursive: true });
    await symlink(outside, join(root, 'out'), 'dir');
    const runner = createProcessRunner({
      allow: { node: { file: process.execPath, args: () => ok(true as const), cwd: 'worktree' } },
      env: { allow: [], set: {} },
      limits: { legMs: 10000, stdoutBytes: 4096, stderrBytes: 4096 },
      roots: { worktree: root },
    });
    const result = await runner.run({ name: 'node', args: ['-e', ''], cwd: join(root, 'out') });
    if (result.ok) return { id, state: 'fail', detail: 'a symlinked working directory was accepted' };
    if (runner.spawns !== 0) return { id, state: 'fail', detail: 'the refusal arrived after a spawn' };
    return { id, state: 'pass', detail: result.issues[0].code + ' before any spawn' };
  }
  catch (error) {
    return { id, state: 'fail', detail: error instanceof Error ? error.message : String(error) };
  }
  finally {
    await rm(dir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
}

/** Every spelling of a protected ref must be refused before a spawn. */
async function protectedRefWrite(): Promise<ProbeResult> {
  const id = 'protected-ref-write';
  try {
    const never = neverWriteSet({ protectedRefs: ['main', 'master'], operatorBranch: 'main', checkedOut: ['main'] });
    const spellings = ['main', 'refs/heads/main', 'master', 'refs/heads/master'];
    for (const ref of spellings) {
      if (refuseProtectedRef(['branch', '-D', ref], never).ok) {
        return { id, state: 'fail', detail: 'the ref ' + ref + ' was not refused' };
      }
    }
    // And the vocabulary itself cannot even spell a push or a reset.
    for (const argv of [['push', 'origin', 'main'], ['reset', '--hard', 'a'.repeat(40)], ['update-ref', 'refs/heads/main', 'a'.repeat(40)]]) {
      if (validateGitArgs(argv).ok) return { id, state: 'fail', detail: 'git ' + argv[0] + ' is sayable' };
    }
    return { id, state: 'pass', detail: spellings.length + ' spellings and 3 verbs refused' };
  }
  catch (error) {
    return { id, state: 'fail', detail: error instanceof Error ? error.message : String(error) };
  }
}

/** A command the allow-list does not name must never reach a spawn. */
async function unknownCommand(): Promise<ProbeResult> {
  const id = 'unknown-command';
  const dir = await scratch();
  try {
    const runner = createProcessRunner({
      allow: { node: { file: process.execPath, args: () => ok(true as const), cwd: 'worktree' } },
      env: { allow: [], set: {} },
      limits: { legMs: 10000, stdoutBytes: 4096, stderrBytes: 4096 },
      roots: { worktree: dir },
    });
    const result = await runner.run({ name: 'sh', args: ['-c', 'echo pwned'], cwd: dir });
    if (result.ok) return { id, state: 'fail', detail: 'an unnamed command ran' };
    if (runner.spawns !== 0) return { id, state: 'fail', detail: 'the refusal arrived after a spawn' };
    return { id, state: 'pass', detail: result.issues[0].code + ' with zero spawns' };
  }
  catch (error) {
    return { id, state: 'fail', detail: error instanceof Error ? error.message : String(error) };
  }
  finally { await rm(dir, { recursive: true, force: true }); }
}

/** A credential-shaped variable in the ambient environment must not reach a child. */
async function envLeak(): Promise<ProbeResult> {
  const id = 'env-leak';
  const dir = await scratch();
  const name = 'TANGLE_AI_API_KEY';
  const previous = process.env[name];
  process.env[name] = 'sk-probe-must-not-leak';
  try {
    const runner = createProcessRunner({
      allow: { node: { file: process.execPath, args: () => ok(true as const), cwd: 'worktree' } },
      env: { allow: ['PATH'], set: { CI: '1' } },
      limits: { legMs: 10000, stdoutBytes: 65536, stderrBytes: 4096 },
      roots: { worktree: dir },
    });
    const result = await runner.run({
      name: 'node',
      args: ['-e', 'process.stdout.write(Object.keys(process.env).sort().join(","))'],
      cwd: dir,
    });
    if (!result.ok) return { id, state: 'fail', detail: 'the probe command did not run' };
    const names = result.value.stdout.split(',');
    if (names.includes(name)) return { id, state: 'fail', detail: 'the credential reached the child' };
    if (!names.includes('CI')) return { id, state: 'fail', detail: 'the host’s fixed values did not reach the child' };
    return { id, state: 'pass', detail: names.length + ' variables, none of them the credential' };
  }
  catch (error) {
    return { id, state: 'fail', detail: error instanceof Error ? error.message : String(error) };
  }
  finally {
    if (previous === undefined) delete process.env[name]; else process.env[name] = previous;
    await rm(dir, { recursive: true, force: true });
  }
}

const PROBES: Record<string, () => Promise<ProbeResult>> = {
  'symlink-indirection': symlinkIndirection,
  'protected-ref-write': protectedRefWrite,
  'unknown-command': unknownCommand,
  'env-leak': envLeak,
};

/** Whether git is usable here at all; a probe that cannot run says so. */
export async function gitAvailable(): Promise<boolean> {
  return exec('git', ['--version']).then(() => true, () => false);
}

/** Run the probes the manifest names, in the manifest's order. */
export async function runHostProbes(ids: readonly string[]): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  for (const id of ids) {
    const probe = PROBES[id];
    results.push(probe === undefined
      ? { id, state: 'implementation-missing', detail: 'no probe is registered under this id' }
      : await probe());
  }
  return results;
}
