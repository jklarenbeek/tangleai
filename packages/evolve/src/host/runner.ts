/**
 * A bounded, allow-listed process runner over the suite's named-process
 * executor (`@jarenjs/core/process-node`).
 *
 * The rule that matters most here: a command is selected by NAME from a
 * table the host wrote, and the name resolves to a file the host chose. A
 * proposal, a model, or anything else that crossed a trust boundary can
 * name a key in that table and nothing else — it can never become an
 * executable, an argument the validator did not accept, a working
 * directory outside the declared root, or an environment variable the
 * allow-list does not carry.
 *
 * The executor owns spawning, process-group cleanup, output caps and the
 * deadline. This layer owns what is Tangle's: one executor per declared
 * root, the host's fixed environment values, a bare command name resolved
 * once against the child's PATH, and the translation of every executor
 * verdict into an evolve outcome with a code. A spawn that fails, a child
 * that outruns its deadline, a flood of output — each is a refusal, never
 * an exception, which is what lets the layer above record a run's outcome
 * instead of losing it to a stack unwind.
 *
 * Output is capped rather than buffered without limit, and exceeding the
 * cap is REPORTED as well as truncated, so a child cannot hide what it
 * did by drowning the reader in bytes.
 */

import { spawn as nodeSpawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import { createProcessExecutor } from '@jarenjs/core/process-node';

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
}

type Executor = ReturnType<typeof createProcessExecutor>;

/** The file a bare command name would run, searched on the child's own PATH. */
function onPath(file: string, path: string | undefined): string | null {
  if (isAbsolute(file)) return file;
  if (file.includes('/') || file.includes('\\')) return null;
  const suffixes = process.platform === 'win32' ? ['', ...(process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';')] : [''];
  for (const directory of (path ?? '').split(delimiter)) {
    if (!isAbsolute(directory)) continue;
    for (const suffix of suffixes) {
      const candidate = join(directory, file + suffix);
      try { accessSync(candidate, constants.X_OK); return candidate; }
      catch { /* not here */ }
    }
  }
  return null;
}

export function createProcessRunner(options: ProcessRunnerOptions): ProcessRunner {
  const spawn = options.spawn ?? nodeSpawn;
  const { allow, env, limits, roots } = options;
  let spawns = 0;

  // The child's environment is built, never inherited: the executor copies
  // only allow-listed names, and the host's fixed values ride every request.
  const envNames = [...new Set([...env.allow, ...Object.keys(env.set)])];
  const childPath = Object.hasOwn(env.set, 'PATH') ? env.set.PATH : env.allow.includes('PATH') ? process.env.PATH : undefined;
  const counted = ((...args: Parameters<SpawnFn>) => { spawns++; return spawn(...args); }) as SpawnFn;
  const unresolved = new Set<string>();
  const executors = new Map<RunnerCwd, Executor>();
  for (const cwd of ['worktree', 'repository', 'base'] as const) {
    const root = roots[cwd];
    if (root === undefined) continue;
    const table: Record<string, { argv0: string, args: (argv: readonly string[]) => boolean }> = {};
    for (const [name, command] of Object.entries(allow)) {
      if (command.cwd !== cwd) continue;
      const file = onPath(command.file, childPath);
      if (file === null) { unresolved.add(name); continue; }
      table[name] = { argv0: file, args: (argv) => command.args([...argv]).ok };
    }
    executors.set(cwd, createProcessExecutor({
      cwd: root, allow: table, env: { allow: envNames },
      timeoutMs: limits.legMs, maxStdoutBytes: limits.stdoutBytes, maxStderrBytes: limits.stderrBytes,
      // A deadline is a verdict, not a request to wind down.
      killSignal: 'SIGKILL', spawn: counted as never,
    }));
  }

  return {
    get spawns() { return spawns; },

    async run(request: RunRequest): Promise<EvolveOutcome<RunResult>> {
      const allowed = Object.hasOwn(allow, request.name) ? allow[request.name] : undefined;
      if (allowed === undefined) {
        return refuseOne<RunResult>('TEVO1006', '/name', 'No allowed command is named ' + request.name + '.');
      }

      const accepted = allowed.args(request.args);
      if (!accepted.ok) return accepted as EvolveOutcome<RunResult>;

      const executor = executors.get(allowed.cwd);
      if (executor === undefined) {
        return refuseOne<RunResult>('TEVO1006', '/cwd', 'No ' + allowed.cwd + ' root is declared for ' + request.name + '.');
      }
      if (unresolved.has(request.name)) {
        return refuseOne<RunResult>('TEVO1006', '/name', 'Spawning ' + request.name + ' failed: ' + allowed.file + ' is not on the PATH.');
      }

      // The executor resolves both sides through realpath, so a symlink
      // cannot point a legal-looking path at a directory outside the root.
      const result = await executor.run({ name: request.name, args: request.args, cwd: request.cwd, env: env.set, signal: request.signal });

      switch (result.refused) {
        case undefined: break;
        case 'cwd-escape':
          return refuseOne<RunResult>('TEVO1006', '/cwd', 'The working directory escapes the ' + allowed.cwd + ' root.');
        case 'request-rejected':
          return refuseOne<RunResult>('TEVO1006', '/cwd', 'The working directory does not resolve.');
        case 'argument-rejected':
          return refuseOne<RunResult>('TEVO1006', '/args', 'The arguments for ' + request.name + ' exceed the process bounds.');
        case 'env-rejected':
          return refuseOne<RunResult>('TEVO1006', '/env', 'The environment for ' + request.name + ' exceeds the process bounds.');
        case 'cancelled':
          return refuseOne<RunResult>('TEVO1006', '/signal', request.name + ' was cancelled before it started.');
        default:
          return refuseOne<RunResult>('TEVO1006', '/name', 'Running ' + request.name + ' was refused: ' + result.refused + '.');
      }
      if (result.reason === 'spawn-error' || result.reason === 'process-error' || result.reason === 'input-error') {
        return refuseOne<RunResult>('TEVO1006', '/name', 'Running ' + request.name + ' failed: ' + result.reason + '.');
      }
      if (result.settlement === 'unresolved') {
        return refuseOne<RunResult>('TEVO1006', '/name', request.name + ' did not exit after it was stopped; its process is still owned.');
      }

      const value: RunResult = {
        exitCode: result.exitCode,
        signal: result.signal,
        stdout: result.stdout,
        stderr: result.stderr,
        truncated: { stdout: result.truncated.stdout, stderr: result.truncated.stderr },
        durationMs: result.durationMs,
      };

      // A budget that was exceeded is reported even though the output was
      // already capped: truncation alone would let a flood pass quietly.
      const exhausted = [];
      if (result.reason === 'timeout') {
        exhausted.push(evolveIssue('TEVO1005', '/budgets/legMs',
          request.name + ' exceeded ' + limits.legMs + 'ms and was killed.'));
      }
      if (result.reason === 'drain-timeout') {
        exhausted.push(evolveIssue('TEVO1005', '/budgets/legMs',
          request.name + ' exited but its output did not close and was killed.'));
      }
      if (value.truncated.stdout) {
        exhausted.push(evolveIssue('TEVO1005', '/budgets/stdoutBytes',
          request.name + ' wrote more than ' + limits.stdoutBytes + ' stdout bytes.'));
      }
      if (value.truncated.stderr) {
        exhausted.push(evolveIssue('TEVO1005', '/budgets/stderrBytes',
          request.name + ' wrote more than ' + limits.stderrBytes + ' stderr bytes.'));
      }
      if (exhausted.length) return refuse<RunResult>(exhausted);

      return ok(value);
    },
  };
}
