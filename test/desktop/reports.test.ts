/**
 * The report lane: admission, frames, stored identity and every refusal.
 *
 * The instrument runner is SCRIPTED here — the gate starts no child
 * process, spends no minutes and depends on no workspace — but the
 * files are real: the scripted runner writes its document into the same
 * scratch directory a child would, so the identity the desktop verifies
 * is read from bytes on disk rather than handed over in memory.
 *
 * What the acceptance of this lane rests on: a report run is a run with
 * frames, a stored report is filed under the identity its instrument
 * computed and re-verified on every read, a second run over an
 * unchanged document stores nothing, a budget cannot reach a provider
 * because there is no path behind it, and a report is never a gate.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import { nodeDriver } from '@jarenjs/db/node';
import { compileContract } from '@jarenjs/contract';
import { openHttpClient } from '@jarenjs/contract/client';
import { toFetchHandler } from '@jarenjs/contract/fetch';

import { DESKTOP_CONTRACT } from '../../apps/desktop/src/contract.ts';
import { createTangleUi } from '../../apps/desktop/src/ui/app.ts';
import { createDesktop, CONFIG_AWARE_RUN_KINDS, REPORT_ADMISSION, type Desktop } from '../../apps/desktop/src/server.ts';
import { openTangleDb, createRunLog } from '@tangleai/store';
import {
  createProgressCoalescer,
  createReportService,
  MAX_PROGRESS_FRAMES,
  PROGRESS_BATCH_LINES,
  recomputeReportId,
} from '../../apps/desktop/src/reports.ts';
import type { FrameSink } from '../../apps/desktop/src/frames.ts';
import type { InstrumentRegistration, InstrumentRunner } from '../../apps/desktop/src/instruments.ts';

const REGISTRATION: InstrumentRegistration = {
  id: 'echo-conformance',
  title: 'Echo conformance',
  entry: 'benchmark/echo-conformance.ts',
  outFlag: '--out',
  schemaId: 'https://tangleai.dev/schemas/echo-conformance',
  keyless: true,
  acceptsBudget: false,
};

interface Script {
  lines?: Array<[string, 'out' | 'err']>;
  /** The document body the run produces, before its identity is computed. */
  body?: Record<string, unknown>;
  /** Produce no document at all. */
  silent?: boolean;
  exitCode?: number;
  /** Hold the run open until it is released or aborted. */
  hold?: boolean;
  /** Report the runner's own deadline kill — a termination nobody asked for. */
  deadline?: boolean;
  /** Write a document under an identity the instrument did not compute. */
  identity?: string;
  redacted?: number;
}

/** A runner that writes real files but starts no process. */
function scriptedRunner(script: Script = {}) {
  const waiting: Array<() => void> = [];
  const dirs: string[] = [];
  let started = 0;
  let holding = script.hold === true;
  const runner: InstrumentRunner = {
    list: () => [{ ...REGISTRATION }],
    async run(id, options) {
      started += 1;
      dirs.push(options.outDir);
      for (const [line, stream] of script.lines ?? [['scanning…', 'out'], ['done', 'out']]) options.onLine(line, stream);
      if (holding) {
        await new Promise<void>((release) => {
          waiting.push(release);
          options.signal.addEventListener('abort', () => release(), { once: true });
        });
      }
      const redacted = script.redacted ?? 0;
      if (options.signal.aborted) return { ok: false, exitCode: null, reason: 'cancelled', killed: true, redacted };
      if (script.deadline === true) return { ok: false, exitCode: null, reason: 'the instrument passed its deadline', killed: true, redacted };
      if ((script.exitCode ?? 0) !== 0) {
        return { ok: false, exitCode: script.exitCode as number, reason: `the instrument exited ${String(script.exitCode)}`, killed: false, redacted };
      }
      if (script.silent === true) return { ok: true, files: [], exitCode: 0, redacted };
      const body = script.body ?? { benchmark: 'echo', rows: [{ id: 'a', value: 1 }] };
      const document = { ...body, reportId: script.identity ?? await recomputeReportId({ ...body, reportId: '' }) };
      const path = join(options.outDir, `${id}.json`);
      await writeFile(path, `${JSON.stringify(document, null, 2)}\n`);
      return { ok: true, files: [path], exitCode: 0, redacted };
    },
  };
  return {
    runner,
    started: (): number => started,
    dirs: (): string[] => [...dirs],
    /** Let go, for good: runs admitted after this one never hold. */
    release(): void { holding = false; for (const done of waiting.splice(0)) done(); },
    waiting: (): number => waiting.length,
  };
}

const post = (desktop: Desktop, url: string, body: unknown): Promise<{ status: number, value: any }> =>
  desktop.dispatcher.dispatch({ method: 'POST', url, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then((res: { status: number, body: unknown }) => ({ status: res.status, value: JSON.parse(String(res.body)) }));
const get = (desktop: Desktop, url: string): Promise<{ status: number, value: any }> =>
  desktop.dispatcher.dispatch({ method: 'GET', url, headers: {}, body: null })
    .then((res: { status: number, body: unknown }) => ({ status: res.status, value: JSON.parse(String(res.body)) }));

const open = (instruments?: InstrumentRunner): Promise<Desktop> =>
  createDesktop({
    driver: nodeDriver(),
    fetch: (() => { throw new Error('a report never calls a provider'); }) as never,
    ...(instruments === undefined ? {} : { instruments }),
  });

const settle = async (done: () => boolean, deadlineMs = 4000): Promise<void> => {
  const start = Date.now();
  while (!done() && Date.now() - start < deadlineMs) await new Promise((resolve) => setTimeout(resolve, 5));
};

describe('a report is a run', () => {
  it('appends the child\'s progress, one report frame and one terminal frame', async () => {
    const script = scriptedRunner({ lines: [['step one', 'out'], ['step two', 'out'], ['a warning', 'err']] });
    const desktop = await open(script.runner);
    try {
      const started = await post(desktop, '/api/reports/run', { id: 'echo-conformance' });
      assert.equal(started.status, 200, JSON.stringify(started.value));
      assert.equal(started.value.stored, 'new');
      assert.equal(started.value.exitCode, 0);
      assert.match(started.value.reportId, /^[0-9a-f]{64}$/);
      assert.deepEqual(started.value.issues, []);

      const frames = (await get(desktop, `/api/runs/live/frames?runId=${started.value.runId}`)).value.rows as any[];
      const kinds = frames.map((frame) => frame.kind);
      assert.deepEqual(kinds.filter((kind) => kind === 'report').length, 1, 'one report frame, not one per file');
      assert.equal(kinds.at(-1), 'status', 'the terminal frame is last');
      assert.equal(kinds.filter((kind) => kind === 'status').length, 1);

      const progress = frames.filter((frame) => frame.kind === 'progress');
      assert.equal(progress.length > 0, true, 'what the instrument said is on the run');
      assert.deepEqual(progress.flatMap((frame) => frame.body.lines), ['step one', 'step two', 'a warning'],
        'lines arrive in the order the instrument wrote them');
      assert.deepEqual(progress.map((frame) => frame.body.stream), ['out', 'err'],
        'one frame never mixes what the child said with what it warned');
      assert.equal(progress.every((frame) => frame.body.suppressed === 0), true);

      const report = frames.find((frame) => frame.kind === 'report');
      assert.equal(report.body.reportId, started.value.reportId);
      assert.equal(report.body.instrument, 'echo-conformance');
      assert.equal(report.body.schemaId, REGISTRATION.schemaId);
      assert.equal(report.body.stored, 'new');
      assert.equal(report.body.files, 1);
      assert.equal(report.body.runId, started.value.runId, 'a new document names the run that stored it');

      const detail = (await get(desktop, `/api/runs/detail?id=${started.value.runId}`)).value;
      assert.equal(detail.run.kind, 'report');
      assert.equal(detail.run.status, 'ok');
      assert.equal(detail.frames, frames.length);
      assert.equal(detail.run.summary.reportId, started.value.reportId);
      assert.equal(detail.run.summary.redacted, 0);

      const rows = (await get(desktop, '/api/reports')).value.rows;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].reportId, started.value.reportId, 'the stored row is filed under the instrument\'s own identity');
      assert.equal(rows[0].runId, started.value.runId);
    } finally {
      await desktop.close();
    }
  });

  it('is not config-aware: a keyless child process resolves no model stack', async () => {
    assert.equal((CONFIG_AWARE_RUN_KINDS as readonly string[]).includes('report'), false,
      'demanding an identity of a report would make every report run finish in error');
    const script = scriptedRunner();
    const desktop = await open(script.runner);
    try {
      const started = await post(desktop, '/api/reports/run', { id: 'echo-conformance' });
      const detail = (await get(desktop, `/api/runs/detail?id=${started.value.runId}`)).value;
      assert.equal(detail.run.status, 'ok', 'a run with no identity still completes');
      assert.equal(detail.run.identityStatus, 'legacy-unrecorded', 'and says honestly that it carries none');
    } finally {
      await desktop.close();
    }
  });

  it('writes outside the repository and leaves nothing behind', async () => {
    const script = scriptedRunner();
    const desktop = await open(script.runner);
    try {
      await post(desktop, '/api/reports/run', { id: 'echo-conformance' });
      const [dir] = script.dirs();
      assert.equal(relative(resolve('.'), dir).startsWith('..'), true, `an instrument wrote inside the repository: ${dir}`);
      const { stat } = await import('node:fs/promises');
      await assert.rejects(() => stat(dir), 'the scratch directory is removed once its files are read');
    } finally {
      await desktop.close();
    }
  });
});

describe('a stored report is verified, never asserted', () => {
  it('recomputes the identity on every read and refuses to repair a document that moved', async () => {
    const script = scriptedRunner();
    const desktop = await open(script.runner);
    try {
      const started = await post(desktop, '/api/reports/run', { id: 'echo-conformance' });
      const reportId = started.value.reportId as string;

      const honest = (await get(desktop, `/api/reports/detail?reportId=${reportId}`)).value;
      assert.equal(honest.verified, true);
      assert.equal(honest.recomputed, reportId, 'the identity is derived from the stored bytes');
      assert.equal(honest.document.reportId, reportId);

      // a row edited under its identity: the read says so and changes nothing
      const rows = desktop.db.collection('reports');
      const stored = await rows.get(reportId) as any;
      await rows.put({ ...stored, document: { ...stored.document, rows: [{ id: 'a', value: 99 }] } });

      const moved = (await get(desktop, `/api/reports/detail?reportId=${reportId}`)).value;
      assert.equal(moved.verified, false, 'bytes that moved under an identity are not the document that identity names');
      assert.match(moved.recomputed, /^[0-9a-f]{64}$/);
      assert.notEqual(moved.recomputed, reportId);
      assert.equal(moved.reportId, reportId, 'the row keeps the identity it was filed under');
      assert.equal(moved.document.rows[0].value, 99, 'the document is shown as it is, not as it should have been');

      const after = await rows.get(reportId) as any;
      assert.equal(after.document.rows[0].value, 99, 'a read repairs nothing');

      const missing = await get(desktop, `/api/reports/detail?reportId=${'0'.repeat(64)}`);
      assert.equal(missing.status, 404);
      assert.equal(missing.value.details.issues[0].code, 'TDSK1008');
    } finally {
      await desktop.close();
    }
  });

  it('lists newest first, by instrument and within a limit, and never carries a document', async () => {
    let seed = 0;
    const script = scriptedRunner();
    const varying: InstrumentRunner = {
      list: () => script.runner.list(),
      run: (id, options) => {
        seed += 1;
        return scriptedRunner({ body: { benchmark: 'echo', rows: [{ id: 'a', value: seed }] } }).runner.run(id, options);
      },
    };
    const desktop = await open(varying);
    try {
      for (let i = 0; i < 3; i++) await post(desktop, '/api/reports/run', { id: 'echo-conformance' });
      const all = (await get(desktop, '/api/reports')).value.rows;
      assert.equal(all.length, 3, 'a moved document is a second row');
      assert.deepEqual([...all].sort((a: any, b: any) => (a.at < b.at ? 1 : -1)), all, 'newest first');
      assert.equal(all.every((row: any) => !('document' in row)), true, 'a list is addresses, not documents');
      assert.equal((await get(desktop, '/api/reports?instrument=echo-conformance')).value.rows.length, 3);
      assert.deepEqual((await get(desktop, '/api/reports?instrument=nobody')).value.rows, []);
      assert.equal((await get(desktop, '/api/reports?limit=2')).value.rows.length, 2);
    } finally {
      await desktop.close();
    }
  });

  it('stores one row for two runs of an unchanged document, and names the run that stored it', async () => {
    const script = scriptedRunner();
    const desktop = await open(script.runner);
    try {
      const first = await post(desktop, '/api/reports/run', { id: 'echo-conformance' });
      const listedOnce = (await get(desktop, '/api/reports')).value.rows;
      const second = await post(desktop, '/api/reports/run', { id: 'echo-conformance' });
      const listedTwice = (await get(desktop, '/api/reports')).value.rows;

      assert.equal(first.value.reportId, second.value.reportId, 'an unchanged document recomputes the same identity');
      assert.equal(first.value.stored, 'new');
      assert.equal(second.value.stored, 'unchanged');
      assert.equal(listedOnce.length, 1);
      assert.equal(listedTwice.length, 1, 'the second pass wrote no row');
      assert.equal(listedTwice[0].runId, first.value.runId, 'the row still belongs to the run that stored it');

      const runs = (await get(desktop, '/api/runs')).value.filter((run: any) => run.kind === 'report');
      assert.equal(runs.length, 2, 'a run that happened is a fact, whatever it stored');
      assert.equal(runs.every((run: any) => run.status === 'ok'), true);

      const frames = (await get(desktop, `/api/runs/live/frames?runId=${second.value.runId}`)).value.rows as any[];
      const report = frames.find((frame) => frame.kind === 'report');
      assert.equal(report.body.stored, 'unchanged');
      assert.equal(report.body.runId, first.value.runId, 'the second frame names the run that holds the row');

      // a moved tree is a different document, and a second row
      const moved = scriptedRunner({ body: { benchmark: 'echo', rows: [{ id: 'a', value: 2 }] } });
      const movedDesktop = await createDesktop({ driver: nodeDriver(), instruments: moved.runner });
      try {
        await post(movedDesktop, '/api/reports/run', { id: 'echo-conformance' });
        await post(movedDesktop, '/api/reports/run', { id: 'echo-conformance' });
        assert.equal((await get(movedDesktop, '/api/reports')).value.rows.length, 1);
      } finally {
        await movedDesktop.close();
      }
    } finally {
      await desktop.close();
    }
  });
});

describe('a report refuses rather than spends', () => {
  it('refuses a budget before a run exists, and names no path behind it', async () => {
    const script = scriptedRunner();
    const desktop = await open(script.runner);
    try {
      const before = (await get(desktop, '/api/runs')).value.length;
      const refused = await post(desktop, '/api/reports/run', { id: 'echo-conformance', budget: { maxCalls: 1 } });
      assert.equal(refused.status, 409);
      assert.equal(refused.value.code, 'refused');
      assert.equal(refused.value.details.issues[0].code, 'TDSK1009');
      assert.equal(refused.value.details.issues[0].path, '/budget');
      assert.equal(script.started(), 0, 'the instrument was never started');
      assert.equal((await get(desktop, '/api/runs')).value.length, before, 'no run row was opened');

      const tokens = await post(desktop, '/api/reports/run', { id: 'echo-conformance', budget: { maxTokens: 10 } });
      assert.equal(tokens.status, 409);
      assert.equal(script.started(), 0);

      // the declared member is what makes the refusal a declared answer
      const instruments = (await get(desktop, '/api/reports/instruments')).value.instruments;
      assert.equal(instruments.every((entry: any) => entry.acceptsBudget === false && entry.keyless === true), true);
    } finally {
      await desktop.close();
    }
  });

  it('answers an empty list and the reason on a host that registered nothing', async () => {
    const desktop = await open();
    try {
      const listed = (await get(desktop, '/api/reports/instruments')).value;
      assert.deepEqual(listed.instruments, []);
      assert.equal(listed.issues.length, 1);
      assert.equal(listed.issues[0].code, 'TDSK1008');
      assert.equal(listed.issues[0].path, '/host');
      assert.match(listed.issues[0].detail, /registers no instrument/);

      const refused = await post(desktop, '/api/reports/run', { id: 'echo-conformance' });
      assert.equal(refused.status, 404);
      assert.equal(refused.value.details.issues[0].code, 'TDSK1008');
      assert.equal((await get(desktop, '/api/runs')).value.length, 0);
      assert.deepEqual((await get(desktop, '/api/reports')).value.rows, []);
    } finally {
      await desktop.close();
    }
  });

  it('refuses an instrument nobody registered', async () => {
    const script = scriptedRunner();
    const desktop = await open(script.runner);
    try {
      const refused = await post(desktop, '/api/reports/run', { id: 'not-registered' });
      assert.equal(refused.status, 404);
      assert.equal(refused.value.details.issues[0].code, 'TDSK1008');
      assert.equal(script.started(), 0);
    } finally {
      await desktop.close();
    }
  });
});

describe('report admission is bounded', () => {
  it('runs one, queues two and refuses what would be a backlog', async () => {
    assert.deepEqual({ ...REPORT_ADMISSION }, { concurrency: 1, maxQueue: 2 });
    const script = scriptedRunner({ hold: true });
    const desktop = await open(script.runner);
    try {
      // one pass is running before the others are asked for, so what is
      // measured is the QUEUE's depth rather than a race between four
      // admissions arriving in one turn
      const running = post(desktop, '/api/reports/run', { id: 'echo-conformance' });
      await settle(() => script.started() === 1);
      const queued = [
        post(desktop, '/api/reports/run', { id: 'echo-conformance' }),
        post(desktop, '/api/reports/run', { id: 'echo-conformance' }),
      ];
      const refused = await post(desktop, '/api/reports/run', { id: 'echo-conformance' });

      assert.equal(refused.status, 429, 'a request past the bound is a backlog, not a plan');
      assert.equal(refused.value.code, 'busy');
      assert.equal(refused.value.details.issues[0].code, 'TDSK1004');
      assert.equal(script.started(), 1, 'a refused request never reaches the instrument');

      script.release();
      const answers = [await running, ...await Promise.all(queued)];
      assert.deepEqual(answers.map((answer) => answer.status), [200, 200, 200],
        'one runs and two wait: the bound admits three');
      assert.equal(script.started(), 3);
    } finally {
      script.release();
      await desktop.close();
    }
  });

  it('cancels a running report: the child is stopped and the run says cancelled', async () => {
    const script = scriptedRunner({ hold: true });
    const desktop = await open(script.runner);
    try {
      const asked = post(desktop, '/api/reports/run', { id: 'echo-conformance' });
      await settle(() => script.started() === 1);
      const running = (await get(desktop, '/api/runs')).value.find((run: any) => run.kind === 'report' && run.status === 'running');
      assert.notEqual(running, undefined, 'a report run is watchable while it runs');

      const cancelled = await post(desktop, '/api/runs/cancel', { runId: running.id });
      assert.equal(cancelled.status, 200);
      assert.equal(cancelled.value.cancelled, true);

      const answer = await asked;
      assert.equal(answer.status, 200, 'a cancelled run is a value, not a wire failure');
      assert.equal(answer.value.reportId, null);
      assert.equal(answer.value.stored, 'none');

      const detail = (await get(desktop, `/api/runs/detail?id=${running.id}`)).value;
      assert.equal(detail.run.status, 'cancelled');
      assert.equal(detail.run.summary.killed, true);
      const frames = (await get(desktop, `/api/runs/live/frames?runId=${running.id}`)).value.rows as any[];
      assert.equal(frames.at(-1).kind, 'status');
      assert.equal(frames.at(-1).body.status, 'cancelled');
      assert.deepEqual((await get(desktop, '/api/reports')).value.rows, [], 'a cancelled run stores nothing');
    } finally {
      script.release();
      await desktop.close();
    }
  });

  it('counts a killed deadline and a non-zero exit as values, never as success', async () => {
    const timedOut = scriptedRunner({ deadline: true });
    const desktop = await open(timedOut.runner);
    try {
      const answer = await post(desktop, '/api/reports/run', { id: 'echo-conformance' });
      assert.equal(answer.status, 200);
      assert.equal(answer.value.exitCode, null);
      assert.equal(answer.value.stored, 'none');
      const detail = (await get(desktop, `/api/runs/detail?id=${answer.value.runId}`)).value;
      assert.equal(detail.run.status, 'error', 'a deadline is not a cancellation, and neither is success');
      assert.equal(detail.run.summary.killed, true);
      assert.match(detail.run.summary.reason, /deadline/);
    } finally {
      await desktop.close();
    }

    const failed = scriptedRunner({ exitCode: 3 });
    const second = await open(failed.runner);
    try {
      const answer = await post(second, '/api/reports/run', { id: 'echo-conformance' });
      assert.equal(answer.status, 200);
      assert.equal(answer.value.exitCode, 3);
      assert.equal(answer.value.reportId, null);
      const detail = (await get(second, `/api/runs/detail?id=${answer.value.runId}`)).value;
      assert.equal(detail.run.status, 'error');
      assert.equal(detail.run.summary.killed, false);
      assert.deepEqual((await get(second, '/api/reports')).value.rows, []);
    } finally {
      await second.close();
    }

    const silent = scriptedRunner({ silent: true });
    const third = await open(silent.runner);
    try {
      const answer = await post(third, '/api/reports/run', { id: 'echo-conformance' });
      assert.equal(answer.value.reportId, null);
      const detail = (await get(third, `/api/runs/detail?id=${answer.value.runId}`)).value;
      assert.equal(detail.run.status, 'error');
      assert.match(detail.run.summary.reason, /no document carrying its own identity/);
    } finally {
      await third.close();
    }

    // an identity the instrument did not compute is not a key: the row
    // would be refused at the write, so the run says so instead of
    // reaching the caller as a fault
    const forged = scriptedRunner({ identity: 'not-a-canonical-digest' });
    const fourth = await open(forged.runner);
    try {
      const answer = await post(fourth, '/api/reports/run', { id: 'echo-conformance' });
      assert.equal(answer.status, 200);
      assert.equal(answer.value.reportId, null);
      assert.equal(answer.value.stored, 'none');
      const detail = (await get(fourth, `/api/runs/detail?id=${answer.value.runId}`)).value;
      assert.equal(detail.run.status, 'error');
      assert.deepEqual((await get(fourth, '/api/reports')).value.rows, []);
    } finally {
      await fourth.close();
    }
  });

  it('says how many frames the store would not take, and still ends the run', async () => {
    const db = await openTangleDb({ driver: nodeDriver(), capture: { mode: 'auto' } });
    // a store that refuses every progress frame: the record is short, and
    // the run has to publish that rather than read as a complete one
    const stored = createRunLog(db, { configAwareKinds: [...CONFIG_AWARE_RUN_KINDS] });
    const refusing = Object.create(stored) as typeof stored;
    let refused = 0;
    refusing.appendFrame = async (runId, frame) => {
      if (frame.kind !== 'progress') return stored.appendFrame(runId, frame);
      refused += 1;
      return { ok: false as const, code: 'TDSK1003' as const, reason: 'the store refused this frame' };
    };
    const script = scriptedRunner({ lines: [['one', 'out'], ['two', 'out'], ['a warning', 'err']] });
    const reports = createReportService({
      db,
      runLog: refusing,
      runner: script.runner,
      scheduler: { run: (worker) => Promise.resolve().then(worker) },
      inflight: new Map(),
    });
    try {
      const answer = await reports.run({ id: 'echo-conformance' });
      assert.equal(answer.ok, true, JSON.stringify(answer));
      if (!answer.ok) return;
      assert.equal(answer.receipt.stored, 'new', 'a short record is not a failed measurement');
      assert.equal(answer.receipt.exitCode, 0);
      assert.equal(refused > 0, true, 'the scripted store refused at least one progress frame');
      assert.deepEqual(answer.receipt.issues,
        [{ code: 'TDSK1003', path: '/runId', detail: `${refused} frames of this run were refused by the store` }],
        'the refused count reaches the caller as a counted issue');
      const detail = await stored.getRun(answer.receipt.runId);
      assert.equal(detail?.run.status, 'ok', 'a refused frame never leaves the run open');
      assert.equal(detail?.run.summary.frameRefusals, refused, 'the run summary carries the same number');
    } finally {
      await db.close();
    }
  });
});

describe('the reports tab shows what runs did', () => {
  const uiFor = (desktop: Desktop, errors: unknown[]): any => {
    const handler = toFetchHandler(desktop.dispatcher);
    const client = openHttpClient(compileContract(DESKTOP_CONTRACT), {
      baseUrl: 'http://tangle.test',
      fetch: (async (url: any, init: any) => handler(new Request(url, init))) as any,
    });
    return createTangleUi({ client, onError: (report: unknown) => errors.push(report) });
  };

  it('lists the registered instruments, runs one, and shows the stored row verified', async () => {
    const script = scriptedRunner();
    const desktop = await createDesktop({ driver: nodeDriver(), instruments: script.runner });
    const errors: unknown[] = [];
    const app = uiFor(desktop, errors);
    try {
      await settle(() => app.getState().reports.instruments.length === 1);
      app.dispatch('nav', 'reports');
      await settle(() => app.getVnode() !== undefined);
      const listed = JSON.stringify(app.getVnode());
      assert.match(listed, /Echo conformance/, 'the registered instrument is named');
      assert.match(listed, /benchmark\/echo-conformance\.ts/, 'and so is the entry it would run');

      app.dispatch('reports/run', 'echo-conformance');
      await settle(() => app.getState().reports.receipt !== null);
      const receipt = app.getState().reports.receipt;
      assert.equal(receipt.stored, 'new');
      assert.equal(receipt.exitCode, 0);
      await settle(() => app.getState().reports.rows.length === 1);

      app.dispatch('reports/open', receipt.reportId);
      await settle(() => app.getState().reports.detail !== null);
      const shown = JSON.stringify(app.getVnode());
      assert.match(shown, /identity verified against the stored bytes/);
      assert.equal(app.getState().reports.detail.verified, true);
      assert.equal(app.getState().reports.error, null);
      assert.equal(errors.length, 0, JSON.stringify(errors[0] ?? null));
    } finally {
      app.destroy();
      await desktop.close();
    }
  });

  it('says plainly that a build with no measurement workspace registers nothing', async () => {
    const desktop = await createDesktop({ driver: nodeDriver() });
    const errors: unknown[] = [];
    const app = uiFor(desktop, errors);
    try {
      await settle(() => app.getState().reports.issues.length === 1);
      app.dispatch('nav', 'reports');
      await settle(() => app.getVnode() !== undefined);
      const shown = JSON.stringify(app.getVnode());
      assert.match(shown, /This build registers no instrument/);
      assert.match(shown, /TDSK1008/, 'the reason is shown as the issue it is');
      assert.equal(errors.length, 0, JSON.stringify(errors[0] ?? null));
    } finally {
      app.destroy();
      await desktop.close();
    }
  });
});

describe('progress is bounded, and says by how much', () => {
  /** A sink that keeps what was pushed instead of writing it. */
  const collector = (): { sink: FrameSink, frames: Array<Record<string, any>> } => {
    const frames: Array<Record<string, any>> = [];
    const sink: FrameSink = {
      push: (_kind, body) => { frames.push(body as Record<string, any>); },
      append: async (_kind, body) => { frames.push(body as Record<string, any>); },
      drain: async () => ({ appended: frames.length, refused: 0 }),
    };
    return { sink, frames };
  };

  it('batches by line count and never mixes two streams in one frame', () => {
    const { sink, frames } = collector();
    const progress = createProgressCoalescer(sink, () => 0);
    for (let i = 0; i < PROGRESS_BATCH_LINES; i++) progress.push(`out ${i}`, 'out');
    progress.push('an error', 'err');
    const counted = progress.close();

    assert.equal(frames.length, 2, 'eight lines fill one frame; the other stream opens the next');
    assert.equal(frames[0].lines.length, PROGRESS_BATCH_LINES);
    assert.equal(frames[0].stream, 'out');
    assert.deepEqual(frames[1], { lines: ['an error'], stream: 'err', suppressed: 0 });
    assert.deepEqual(counted, { appended: 2, suppressed: 0 });
  });

  it('opens a new frame once the window has passed, whatever the batch holds', () => {
    const { sink, frames } = collector();
    let clock = 0;
    const progress = createProgressCoalescer(sink, () => clock);
    progress.push('one', 'out');
    clock = 1000;
    progress.push('two', 'out');
    progress.push('three', 'out');
    progress.close();
    assert.deepEqual(frames.map((frame) => frame.lines), [['one', 'two'], ['three']],
      'the window closes on the line that crossed it, and the rest open the next frame');
  });

  it('caps the frames one run may append and counts every line it could not keep', () => {
    const { sink, frames } = collector();
    const progress = createProgressCoalescer(sink, () => 0);
    const total = 5000;
    for (let i = 0; i < total; i++) progress.push(`line ${i}`, 'out');
    const counted = progress.close();

    assert.equal(frames.length, MAX_PROGRESS_FRAMES, 'a run that prints a megabyte cannot grow its stream without limit');
    assert.equal(counted.appended, MAX_PROGRESS_FRAMES);
    const kept = frames.reduce((sum, frame) => sum + frame.lines.length, 0);
    assert.equal(kept + counted.suppressed, total, 'every line is either kept or counted — none is silently lost');
    assert.equal(frames.at(-1)?.suppressed, counted.suppressed);
    assert.equal(frames.at(-1)?.lines[0], `line ${total - 1}`, 'the closing frame keeps the last thing the run said');
    assert.equal(frames.slice(0, -1).every((frame) => frame.suppressed === 0), true);
  });
});
