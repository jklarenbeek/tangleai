/**
 * The child-process instrument runner, against a real child.
 *
 * Every path here is one the desktop cannot simulate honestly: a
 * process really is spawned, its output really arrives in chunks that
 * are not line boundaries, its environment really is what the runner
 * handed it, and a child that ignores SIGTERM really does have to be
 * killed outright. The fixture reports what it saw back through the
 * document it writes, so the env strip is proven by the child rather
 * than asserted by the caller.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import {
  createChildProcessRunner,
  createReportScratch,
  isCredentialEnv,
  keylessEnv,
  looksLikeCredential,
  MAX_LINE_CHARS,
  type InstrumentRegistration,
} from '../../apps/desktop/src/instruments.ts';

const ROOT = resolve('.');
const ENTRY = 'test/fixtures/instrument-echo.mjs';

const echo = (id: string, outFlag: '--out' | '--out-dir' = '--out'): InstrumentRegistration => ({
  id, title: `echo ${id}`, entry: ENTRY, outFlag,
  schemaId: 'https://tangleai.dev/schemas/echo', keyless: true, acceptsBudget: false,
});

const runner = (registrations: InstrumentRegistration[], sigkillDelayMs?: number) =>
  createChildProcessRunner({ root: ROOT, registrations, ...(sigkillDelayMs === undefined ? {} : { sigkillDelayMs }) });

interface Seen { line: string; stream: 'out' | 'err' }

/** Run one registered instrument in a fresh scratch directory. */
async function runIn(
  instrument: ReturnType<typeof runner>,
  id: string,
  options: { deadlineMs?: number, signal?: AbortSignal, keep?: boolean } = {},
): Promise<{ outcome: any, lines: Seen[], dir: string, dispose: () => Promise<void> }> {
  const scratch = await createReportScratch();
  const lines: Seen[] = [];
  try {
    const outcome = await instrument.run(id, {
      outDir: scratch.dir,
      signal: options.signal ?? new AbortController().signal,
      deadlineMs: options.deadlineMs ?? 30_000,
      onLine: (line, stream) => lines.push({ line, stream }),
    });
    return { outcome, lines, dir: scratch.dir, dispose: scratch.dispose };
  } finally {
    if (options.keep !== true) await scratch.dispose();
  }
}

describe('the instrument runner', () => {
  it('delivers the child\'s lines in order and reads what it produced from the scratch directory', async () => {
    const scratch = await createReportScratch();
    assert.equal(dirname(scratch.dir), resolve(tmpdir()), 'a run writes outside the repository');
    assert.match(basename(scratch.dir), /^tangle-report-/);
    const lines: Seen[] = [];
    try {
      const outcome = await runner([echo('echo-ok')]).run('echo-ok', {
        outDir: scratch.dir,
        signal: new AbortController().signal,
        deadlineMs: 30_000,
        onLine: (line, stream) => lines.push({ line, stream }),
      });
      assert.equal(outcome.ok, true, JSON.stringify(outcome));
      assert.equal(outcome.ok === true && outcome.exitCode, 0);

      const out = lines.filter((seen) => seen.stream === 'out').map((seen) => seen.line);
      assert.deepEqual(out.slice(0, 3), ['echo instrument: echo-ok', '| step | state |', '| scan | done |'],
        'stdout arrives whole and in the order it was written');
      assert.equal(lines.some((seen) => seen.stream === 'err' && seen.line.startsWith('warning:')), true,
        'stderr is a stream of its own, not a failure');

      const files = outcome.ok === true ? outcome.files : [];
      assert.deepEqual(files.map((path: string) => basename(path)), ['echo-ok.json'], 'an --out instrument writes its one file');
      const document = JSON.parse(await readFile(files[0], 'utf8'));
      assert.equal(document.mode, 'echo-ok');
    } finally {
      await scratch.dispose();
    }
    await assert.rejects(() => stat(scratch.dir), 'the scratch directory is removed once its files are read');
  });

  it('hands a keyless child no credential-shaped environment member', async () => {
    const stripped = keylessEnv({
      PATH: '/usr/bin', HOME: '/home/a',
      TANGLE_AI_MODEL: 'z', OPENROUTER_AI_KEY: 'sk-x', SOME_TOKEN: 't', A_SECRET: 's',
    });
    assert.deepEqual(Object.keys(stripped).sort(), ['HOME', 'PATH']);
    for (const name of ['TANGLE_AI_MAX_CALLS', 'OPENROUTER_AI_KEY', 'X_TOKEN', 'Y_SECRET']) {
      assert.equal(isCredentialEnv(name), true, `${name} is a credential-shaped member`);
    }
    assert.equal(isCredentialEnv('PATH'), false);

    // and the child agrees: it reports back what it could actually see
    const { outcome, dispose } = await runIn(runner([echo('echo-ok')]), 'echo-ok', { keep: true });
    try {
      const files = outcome.ok === true ? outcome.files : [];
      const document = JSON.parse(await readFile(files[0], 'utf8'));
      assert.deepEqual(document.env.suspects, [], 'the spawned process saw no key, token or secret member');
    } finally {
      await dispose();
    }
  });

  it('refuses a line shaped like a credential before it can become a frame', async () => {
    assert.equal(looksLikeCredential('resolved credential sk-live-0123456789abcdefghij'), true);
    assert.equal(looksLikeCredential('authorization: Bearer eyJhbGciOiJIUzI1NiJ9abc'), true);
    assert.equal(looksLikeCredential('api_key=0123456789abcdef'), true);
    assert.equal(looksLikeCredential('| scan | done |'), false);
    assert.equal(looksLikeCredential('report → /tmp/x.json (d409d9952277…)'), false);

    const { outcome, lines } = await runIn(runner([echo('echo-secret')]), 'echo-secret');
    assert.equal(outcome.ok, true);
    assert.equal(lines.some((seen) => seen.line.includes('sk-live-')), false, 'no forwarded line carries the key');
    assert.equal(lines.some((seen) => seen.line === 'after the refused line, work continues'), true,
      'the refusal is one line, not the end of the stream');
    assert.equal(outcome.ok === true && outcome.redacted, 1, 'what was refused is a number, not a silence');
  });

  it('cuts an over-long line to the bound a frame can hold', async () => {
    const { outcome, lines } = await runIn(runner([echo('echo-long')]), 'echo-long');
    assert.equal(outcome.ok, true);
    const long = lines.filter((seen) => seen.line.startsWith('line '));
    assert.equal(long.length, 40);
    assert.equal(long.every((seen) => seen.line.length <= MAX_LINE_CHARS), true, 'every line fits a frame');
    assert.equal(long[0].line.endsWith('… [truncated]'), true, 'a cut says it is a cut');
  });

  it('counts a non-zero exit as a value and produces no files from it', async () => {
    const { outcome } = await runIn(runner([echo('echo-fail')]), 'echo-fail');
    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.exitCode, 3);
    assert.equal(outcome.ok === false && outcome.killed, false, 'a failure is not a kill');
    assert.match(outcome.ok === false ? outcome.reason : '', /exited 3/);
  });

  it('kills a child that will not stop: on abort, and at the deadline', async () => {
    const controller = new AbortController();
    const seen: Seen[] = [];
    const scratch = await createReportScratch();
    const aborted = runner([echo('echo-hang')], 100).run('echo-hang', {
      outDir: scratch.dir, signal: controller.signal, deadlineMs: 30_000,
      onLine: (line, stream) => seen.push({ line, stream }),
    });
    // the child prints before it hangs, so its first line — not a fixed
    // sleep a loaded runner can overshoot — is what says it is running
    const start = Date.now();
    while (seen.length === 0 && Date.now() - start < 10_000) await new Promise((wait) => setTimeout(wait, 5));
    assert.equal(seen.length > 0, true, 'the child was running when the abort arrived');
    controller.abort();
    const outcome = await aborted;
    await scratch.dispose();
    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.killed, true);
    assert.equal(outcome.ok === false ? outcome.reason : '', 'cancelled');

    const timedOut = await runIn(runner([echo('echo-hang')], 100), 'echo-hang', { deadlineMs: 1500 });
    assert.equal(timedOut.outcome.ok, false);
    assert.equal(timedOut.outcome.ok === false && timedOut.outcome.killed, true);
    assert.match(timedOut.outcome.ok === false ? timedOut.outcome.reason : '', /deadline/);
    assert.equal(timedOut.lines.length > 0, true, 'what the child said before it was killed is still delivered');
  });

  it('reads every file a directory-writing instrument produced', async () => {
    const { outcome, dispose } = await runIn(runner([echo('echo-dir', '--out-dir')]), 'echo-dir', { keep: true });
    try {
      assert.equal(outcome.ok, true);
      const files = outcome.ok === true ? outcome.files : [];
      assert.deepEqual(files.map((path: string) => basename(path)).sort(), ['ECHO.md', 'echo-dir.json']);
    } finally {
      await dispose();
    }
  });

  it('never writes into the repository, and never runs an entry outside it', async () => {
    const instrument = runner([echo('echo-ok')]);
    const refused = await instrument.run('echo-ok', {
      outDir: join(ROOT, 'benchmark', 'results'),
      signal: new AbortController().signal,
      deadlineMs: 1000,
      onLine: () => assert.fail('a refused run produces no output'),
    });
    assert.equal(refused.ok, false);
    assert.match(refused.ok === false ? refused.reason : '', /never writes inside the workspace/);

    const unknown = await instrument.run('nobody', {
      outDir: tmpdir(), signal: new AbortController().signal, deadlineMs: 1000, onLine: () => {},
    });
    assert.equal(unknown.ok, false);
    assert.match(unknown.ok === false ? unknown.reason : '', /no instrument 'nobody'/);

    assert.throws(() => runner([{ ...echo('escapee'), entry: '../outside.ts' }]), /outside the workspace/);
    assert.throws(() => runner([{ ...echo('escapee'), entry: '/etc/passwd' }]), /outside the workspace/);
    assert.throws(() => runner([echo('twice'), echo('twice')]), /registered twice/);
  });
});
