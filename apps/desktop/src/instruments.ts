/**
 * Running a measurement instrument as a child process.
 *
 * The measurement workspace is private and carries dependencies that
 * are deliberately not ours, and a compiled binary runs from a foreign
 * directory with no repository around it — so the desktop can never
 * import an instrument. It runs one as a REGISTERED child process
 * instead: an id, a title, a repo-relative entry, the flag that entry
 * takes for its output, and the schema its document claims. A host that
 * has no workspace beside it registers nothing, which is the honest
 * answer and not a failure.
 *
 * Three bounds are this module's own:
 *
 *   - the environment the child gets is this process's MINUS every
 *     credential-shaped member, because a keyless instrument must not
 *     be handed a key it could decide to spend;
 *   - output is screened line by line, and a line shaped like a
 *     credential is refused rather than forwarded — the measurement
 *     workspace refuses a leaked secret in its own rendered documents,
 *     and the same intent is restated here because the predicate cannot
 *     be imported across that boundary;
 *   - the caller's deadline is enforced HERE. The suite's scheduler
 *     bounds admission, not execution: a worker it admitted is never
 *     stopped by it, so an instrument that never exits is this module's
 *     problem to end.
 *
 * Output never lands in the repository: the caller passes a scratch
 * directory outside it, and a directory inside it is refused.
 */

import { spawn as nodeSpawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, isAbsolute } from 'node:path';

import { truncate } from '@jarenjs/core/chunk';
import { sleep } from '@jarenjs/core/retry';
import { callerError } from '@tangleai/core/errors';

/** One instrument this host is willing to run. */
export interface InstrumentRegistration {
  id: string;
  title: string;
  /** Repo-relative entry file, run by this process's own runtime. */
  entry: string;
  /** `--out` names a FILE; `--out-dir` names a DIRECTORY. They are not interchangeable. */
  outFlag: '--out' | '--out-dir';
  /** The `$id` of the schema the produced document claims. */
  schemaId: string;
  /** Only a keyless instrument is registrable; the type admits nothing else. */
  keyless: true;
  /** No registered instrument accepts spend; the type admits nothing else. */
  acceptsBudget: false;
}

export interface InstrumentRunOptions {
  /** Where the instrument writes. Must be outside the repository root. */
  outDir: string;
  /** Aborting kills the child immediately. */
  signal: AbortSignal;
  /** How long the child may run before it is terminated, in milliseconds. */
  deadlineMs: number;
  onLine: (line: string, stream: 'out' | 'err') => void;
}

export type InstrumentRunOutcome =
  | { ok: true, files: string[], exitCode: 0, redacted: number }
  | { ok: false, exitCode: number | null, reason: string, killed: boolean, redacted: number };

export interface InstrumentRunner {
  list(): InstrumentRegistration[];
  /** Runs one instrument; `onLine` receives stdout/stderr lines as they arrive. */
  run(id: string, options: InstrumentRunOptions): Promise<InstrumentRunOutcome>;
}

/** The longest a progress line may be, marker included. */
export const MAX_LINE_CHARS = 240;
const CUT = '… [truncated]';

/**
 * Shapes that mean "this line is carrying a credential". Deliberately
 * wide: a suppressed line of an instrument's chatter costs a reader
 * nothing, and a forwarded key is stored forever in a run's frames.
 */
const CREDENTIAL_SHAPES: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{12,}/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
  /\b(?:api[_-]?key|apikey|secret|token|password|passwd|authorization)\b["'\s]*[:=]\s*["']?[A-Za-z0-9._~+/=-]{8,}/i,
];

/** Does this line look like it is carrying a credential? */
export const looksLikeCredential = (line: string): boolean =>
  CREDENTIAL_SHAPES.some((shape) => shape.test(line));

/** Environment members a keyless child is never handed. */
export const isCredentialEnv = (name: string): boolean =>
  name.startsWith('TANGLE_AI_') || name.endsWith('_KEY') || name.endsWith('_TOKEN') || name.endsWith('_SECRET');

/** This process's environment minus everything a keyless run must not see. */
export function keylessEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined || isCredentialEnv(name)) continue;
    env[name] = value;
  }
  return env;
}

/** A per-run directory outside the repository, and the promise that removes it. */
export interface ReportScratch {
  dir: string;
  dispose(): Promise<void>;
}

/**
 * Where one run's instrument writes. The system temporary directory is
 * never the repository, so nothing an instrument produces can reach a
 * tracked path by accident.
 */
export async function createReportScratch(): Promise<ReportScratch> {
  const dir = await mkdtemp(join(tmpdir(), 'tangle-report-'));
  return { dir, dispose: () => rm(dir, { recursive: true, force: true }) };
}

/** Is `path` inside `root` (or root itself)? */
function inside(root: string, path: string): boolean {
  const step = relative(root, path);
  return step === '' || (!step.startsWith('..') && !isAbsolute(step));
}

/** What `spawn` must look like; injected so tests never start a process they did not write. */
export type SpawnLike = typeof nodeSpawn;

export interface ChildProcessRunnerOptions {
  /** The repository root the entries are relative to, and that no output may land in. */
  root: string;
  registrations: readonly InstrumentRegistration[];
  spawn?: SpawnLike;
  /** How long after SIGTERM the child is killed outright. */
  sigkillDelayMs?: number;
}

/**
 * Split a byte stream into whole lines. A chunk boundary is not a line
 * boundary, and a final line without its newline is still a line.
 */
function lineSplitter(emit: (line: string) => void): { push: (chunk: string) => void, end: () => void } {
  let held = '';
  return {
    push(chunk: string): void {
      held += chunk;
      let index = held.indexOf('\n');
      while (index >= 0) {
        emit(held.slice(0, index).replace(/\r$/, ''));
        held = held.slice(index + 1);
        index = held.indexOf('\n');
      }
    },
    end(): void {
      if (held !== '') { emit(held); held = ''; }
    },
  };
}

export function createChildProcessRunner(options: ChildProcessRunnerOptions): InstrumentRunner {
  const root = resolve(options.root);
  const spawn = options.spawn ?? nodeSpawn;
  const sigkillDelayMs = options.sigkillDelayMs ?? 5_000;
  const byId = new Map<string, InstrumentRegistration>();

  for (const registration of options.registrations) {
    // a registration is host configuration, not content: an entry that
    // escapes the workspace is a caller bug and is refused here rather
    // than discovered when a child writes somewhere nobody meant
    if (isAbsolute(registration.entry) || !inside(root, resolve(root, registration.entry))) {
      throw callerError(`instrument '${registration.id}' names an entry outside the workspace: ${registration.entry}`);
    }
    if (byId.has(registration.id)) throw callerError(`instrument '${registration.id}' is registered twice`);
    byId.set(registration.id, registration);
  }
  const registered = [...byId.values()];

  return {
    list: () => registered.map((registration) => ({ ...registration })),

    async run(id, runOptions) {
      const registration = byId.get(id);
      if (registration === undefined) {
        return { ok: false, exitCode: null, reason: `no instrument '${id}' is registered on this host`, killed: false, redacted: 0 };
      }
      const outDir = resolve(runOptions.outDir);
      if (inside(root, outDir)) {
        return { ok: false, exitCode: null, reason: `an instrument never writes inside the workspace: ${outDir}`, killed: false, redacted: 0 };
      }
      if (runOptions.signal.aborted) {
        return { ok: false, exitCode: null, reason: 'cancelled before the instrument started', killed: true, redacted: 0 };
      }

      // `--out` is a file and `--out-dir` is a directory; handing one
      // the other's shape is how an instrument fails at its last write
      const target = registration.outFlag === '--out' ? join(outDir, `${registration.id}.json`) : outDir;
      let redacted = 0;
      const forward = (stream: 'out' | 'err') => (line: string): void => {
        if (line === '') return;
        if (looksLikeCredential(line)) { redacted += 1; return; }
        runOptions.onLine(truncate(line, MAX_LINE_CHARS - CUT.length, CUT), stream);
      };

      const child = spawn(process.execPath, [resolve(root, registration.entry), registration.outFlag, target], {
        cwd: root,
        env: keylessEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const out = lineSplitter(forward('out'));
      const err = lineSplitter(forward('err'));
      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => out.push(chunk));
      child.stderr?.on('data', (chunk: string) => err.push(chunk));

      let killed = false;
      let reason = '';
      // both waits are the suite's abortable sleep, cancelled the moment
      // the child is gone — a raw timer would keep this process alive
      // past the run it belongs to
      const closing = new AbortController();
      const stop = (why: string): void => {
        if (killed) return;
        killed = true;
        reason = why;
        child.kill('SIGTERM');
        // the scheduler bounds admission, never an admitted worker: a
        // child that ignores its termination signal is ended here
        void sleep(sigkillDelayMs, closing.signal).then(() => child.kill('SIGKILL'), () => {});
      };
      const onAbort = (): void => stop('cancelled');
      runOptions.signal.addEventListener('abort', onAbort, { once: true });
      void sleep(runOptions.deadlineMs, closing.signal)
        .then(() => stop(`the instrument passed its ${runOptions.deadlineMs} ms deadline`), () => {});

      const exit = await new Promise<{ code: number | null, error: Error | null }>((settle) => {
        child.once('error', (error: Error) => settle({ code: null, error }));
        child.once('close', (code: number | null) => settle({ code, error: null }));
      });
      closing.abort();
      runOptions.signal.removeEventListener('abort', onAbort);
      out.end();
      err.end();

      if (exit.error !== null) {
        return { ok: false, exitCode: null, reason: exit.error.message, killed, redacted };
      }
      if (killed) return { ok: false, exitCode: exit.code, reason, killed: true, redacted };
      if (exit.code !== 0) {
        return { ok: false, exitCode: exit.code, reason: `the instrument exited ${String(exit.code)}`, killed: false, redacted };
      }

      const produced: string[] = [];
      for (const name of await readdir(outDir, { recursive: true, withFileTypes: true })) {
        if (name.isFile()) produced.push(join(name.parentPath, name.name));
      }
      produced.sort();
      return { ok: true, files: produced, exitCode: 0, redacted };
    },
  };
}
