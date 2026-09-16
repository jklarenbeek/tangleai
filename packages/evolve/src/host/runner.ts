/**
 * A bounded, allow-listed process runner.
 *
 * The rule that matters most here: a command is selected by NAME from a
 * table the host wrote, and the name resolves to a file the host chose. A
 * proposal, a model, or anything else that crossed a trust boundary can
 * name a key in that table and nothing else — it can never become an
 * executable, an argument the validator did not accept, a working
 * directory outside the declared root, or an environment variable the
 * allow-list does not carry.
 *
 * Everything is a value. A spawn that fails with ENOENT, a child that
 * outruns its deadline, a flood of output — each is a refusal with a code,
 * never an exception. That is what lets the layer above record a run's
 * outcome instead of losing it to a stack unwind.
 *
 * Output is capped rather than buffered without limit, and exceeding the
 * cap is REPORTED as well as truncated, so a child cannot hide what it
 * did by drowning the reader in bytes.
 */

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

import { refuseOne, refuse, ok, evolveIssue, type EvolveOutcome } from '../errors.ts';

export type RunnerCwd = 'worktree' | 'repository' | 'base';

export interface AllowedCommand {
  /** The executable. Chosen by the host, never by a peer. */
  file: string;
  /** Accept or refuse this exact argv. */
  args: (argv: string[]) => EvolveOutcome<true>;
  cwd: RunnerCwd;
}

export interface RunnerEnv {
  /** Names copied from the ambient environment. Nothing else is copied. */
  allow: string[];
  /** Fixed values the host sets, applied after the allow-list. */
  set: Record<string, string>;
}

export interface RunnerLimits {
  legMs: number;
  stdoutBytes: number;
  stderrBytes: number;
}

export interface RunnerRoots {
  worktree?: string;
  repository?: string;
  base?: string;
}

export interface RunResult {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  truncated: { stdout: boolean, stderr: boolean };
  durationMs: number;
}

export interface RunRequest {
  name: string;
  args: string[];
  cwd: string;
  signal?: AbortSignal;
}

export interface ProcessRunner {
  run(request: RunRequest): Promise<EvolveOutcome<RunResult>>;
  /** Every spawn this runner actually performed. A refusal must not move it. */
  readonly spawns: number;
}

type SpawnFn = typeof nodeSpawn;

export interface ProcessRunnerOptions {
  spawn?: SpawnFn;
  allow: Record<string, AllowedCommand>;
  env: RunnerEnv;
  limits: RunnerLimits;
  roots: RunnerRoots;
  clock?: () => number;
}

/** Whether `child` is the directory itself or below it, after both are resolved. */
function contains(root: string, child: string): boolean {
  if (root === child) return true;
  return child.startsWith(root.endsWith(sep) ? root : root + sep);
}

/**
 * Kill the child AND everything the child started.
 *
 * `child.kill()` signals one process, and a gate command is almost never
 * one process. `node --test` runs each test file in its own worker; a
 * build script shells out; a task runner supervises. Signalling only the
 * parent leaves those workers alive and reparented to init, holding a CPU
 * for as long as the machine is up — and the runner still reports a tidy
 * `SIGKILL`, so the leak is invisible exactly where the deadline was
 * supposed to be proof that nothing escaped.
 *
 * So the child is spawned as its own process-group leader and the whole
 * group is signalled by negative pid. Windows has no equivalent, and the
 * single-process kill is all that is available there.
 */
function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) return;
  if (process.platform === 'win32') {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
    return;
  }
  // The group first. ESRCH means it is already gone, which is the goal.
  try { process.kill(-pid, 'SIGKILL'); }
  catch { /* fall through to the single process */ }
  try { child.kill('SIGKILL'); } catch { /* already gone */ }
}

/** A bounded sink: keeps at most `cap` bytes and remembers it dropped some. */
function createSink(cap: number) {
  const chunks: Buffer[] = [];
  let kept = 0;
  let overflowed = false;
  return {
    write(chunk: Buffer): void {
      if (kept >= cap) { overflowed = true; return; }
      const room = cap - kept;
      if (chunk.length <= room) { chunks.push(chunk); kept += chunk.length; return; }
      chunks.push(chunk.subarray(0, room));
      kept = cap;
      overflowed = true;
    },
    get text(): string { return Buffer.concat(chunks).toString('utf8'); },
    get truncated(): boolean { return overflowed; },
  };
}

export function createProcessRunner(options: ProcessRunnerOptions): ProcessRunner {
  const spawn = options.spawn ?? nodeSpawn;
  const clock = options.clock ?? (() => performance.now());
  const { allow, env, limits, roots } = options;
  let spawns = 0;

  return {
    get spawns() { return spawns; },

    async run(request: RunRequest): Promise<EvolveOutcome<RunResult>> {
      const allowed = Object.hasOwn(allow, request.name) ? allow[request.name] : undefined;
      if (allowed === undefined) {
        return refuseOne<RunResult>('TEVO1006', '/name', 'No allowed command is named ' + request.name + '.');
      }

      const accepted = allowed.args(request.args);
      if (!accepted.ok) return accepted as EvolveOutcome<RunResult>;

      const root = roots[allowed.cwd];
      if (root === undefined) {
        return refuseOne<RunResult>('TEVO1006', '/cwd', 'No ' + allowed.cwd + ' root is declared for ' + request.name + '.');
      }

      // realpath on BOTH sides, so a symlink cannot point a legal-looking
      // path at a directory outside the root.
      let resolvedRoot: string;
      let resolvedCwd: string;
      try {
        resolvedRoot = await realpath(resolve(root));
        resolvedCwd = await realpath(resolve(request.cwd));
      }
      catch {
        return refuseOne<RunResult>('TEVO1006', '/cwd', 'The working directory does not resolve.');
      }
      if (!contains(resolvedRoot, resolvedCwd)) {
        return refuseOne<RunResult>('TEVO1006', '/cwd', 'The working directory escapes the ' + allowed.cwd + ' root.');
      }

      // The child's environment is built, never inherited. A name outside
      // the allow-list cannot reach the child even if it is set here.
      const childEnv: Record<string, string> = {};
      for (const name of env.allow) {
        const value = process.env[name];
        if (typeof value === 'string') childEnv[name] = value;
      }
      for (const [name, value] of Object.entries(env.set)) childEnv[name] = value;

      const started = clock();
      let child: ChildProcess;
      try {
        spawns++;
        child = spawn(allowed.file, request.args, {
          cwd: resolvedCwd,
          env: childEnv,
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: false,
          // Its own process group, so the deadline can reach the whole
          // tree and not just its root. See killTree.
          detached: process.platform !== 'win32',
        });
      }
      catch (error) {
        return refuseOne<RunResult>('TEVO1006', '/name',
          'Spawning ' + request.name + ' failed: ' + (error instanceof Error ? error.message : String(error)) + '.');
      }

      const stdout = createSink(limits.stdoutBytes);
      const stderr = createSink(limits.stderrBytes);
      child.stdout?.on('data', (chunk: Buffer) => stdout.write(chunk));
      child.stderr?.on('data', (chunk: Buffer) => stderr.write(chunk));

      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; killTree(child); }, limits.legMs);
      const onAbort = () => killTree(child);
      request.signal?.addEventListener('abort', onAbort, { once: true });

      const settled = await new Promise<{ code: number | null, signal: string | null, error?: Error }>(resolveSettled => {
        child.once('error', (error: Error) => resolveSettled({ code: null, signal: null, error }));
        child.once('close', (code, signal) => resolveSettled({ code, signal: signal ?? null }));
      });
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onAbort);

      const durationMs = clock() - started;

      if (settled.error && !timedOut) {
        return refuseOne<RunResult>('TEVO1006', '/name',
          'Running ' + request.name + ' failed: ' + settled.error.message + '.');
      }

      const value: RunResult = {
        exitCode: settled.code,
        signal: timedOut ? 'SIGKILL' : settled.signal,
        stdout: stdout.text,
        stderr: stderr.text,
        truncated: { stdout: stdout.truncated, stderr: stderr.truncated },
        durationMs,
      };

      // A budget that was exceeded is reported even though the output was
      // already capped: truncation alone would let a flood pass quietly.
      const exhausted = [];
      if (timedOut) {
        exhausted.push(evolveIssue('TEVO1005', '/budgets/legMs',
          request.name + ' exceeded ' + limits.legMs + 'ms and was killed.'));
      }
      if (stdout.truncated) {
        exhausted.push(evolveIssue('TEVO1005', '/budgets/stdoutBytes',
          request.name + ' wrote more than ' + limits.stdoutBytes + ' stdout bytes.'));
      }
      if (stderr.truncated) {
        exhausted.push(evolveIssue('TEVO1005', '/budgets/stderrBytes',
          request.name + ' wrote more than ' + limits.stderrBytes + ' stderr bytes.'));
      }
      if (exhausted.length) return refuse<RunResult>(exhausted);

      return ok(value);
    },
  };
}
