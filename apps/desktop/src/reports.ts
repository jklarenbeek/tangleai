/**
 * Running an instrument from the surface, and keeping what it produced.
 *
 * A report run is a run like any other: it opens a row, streams what it
 * is doing as frames on that row's own subscription, and ends in one
 * terminal state. What makes it different is that it resolves no model
 * stack — it starts a keyless child process — so it carries no config
 * identity and is not asked for one.
 *
 * "Kept by identity" means the instrument's identity, not one this host
 * minted: an instrument computes the canonical digest of its own
 * document, and that digest IS the row key. Two consequences follow and
 * both are deliberate. A run over an unchanged tree recomputes the same
 * digest, so the second pass stores nothing and its frame names the run
 * that did — the run still happened and is still a row. And a read
 * RE-COMPUTES the digest from the stored bytes: a document whose bytes
 * have moved under its identity answers `verified: false` with what it
 * actually hashes to, and is neither hidden nor repaired.
 *
 * Nothing here scores, aggregates or compares. Two stored reports are
 * comparable when their instrument and schema agree; whether one is
 * better than another is a claim only the instrument could make.
 */

import { readFile } from 'node:fs/promises';

import { canonicalSha256 } from '@jarenjs/json/canonical';
import { asRows, type RunLog, type TangleDb } from '@tangleai/store';

import { createFrameSink, type FrameSink } from './frames.ts';
import { isAdmissionRefusal, issue, type DesktopIssue } from './issues.ts';
import {
  createReportScratch,
  type InstrumentRegistration,
  type InstrumentRunner,
} from './instruments.ts';

/** The bounded admission every report run — however it was asked for — goes through. */
export const REPORT_SCOPE = 'report';

/** How long an instrument may run before the runner terminates it. */
export const REPORT_DEADLINE_MS = 600_000;

/** One progress frame per this many milliseconds, or this many lines, whichever comes first. */
export const PROGRESS_WINDOW_MS = 64;
export const PROGRESS_BATCH_LINES = 8;

/**
 * The most progress frames one run may append. An instrument that
 * prints a megabyte would otherwise push the run's live registration
 * past the store's maintained-entry ceiling; past the cap the lines are
 * counted instead, and the last frame carries that number.
 */
export const MAX_PROGRESS_FRAMES = 500;

/** A stored report row: the instrument's document under the instrument's own identity. */
export interface ReportRow {
  id: string;
  instrument: string;
  schemaId: string;
  at: string;
  runId: string;
  bytes: number;
  source: Record<string, unknown> | null;
  document: Record<string, unknown>;
}

/** What a stored report looks like in a list: everything but the document. */
export interface ReportSummary {
  reportId: string;
  instrument: string;
  schemaId: string;
  at: string;
  runId: string;
  bytes: number;
}

export interface ReportDetail extends ReportSummary {
  /** Does the stored document still hash to the identity it is filed under? */
  verified: boolean;
  recomputed: string;
  source: Record<string, unknown> | null;
  document: Record<string, unknown>;
}

/** What a report run answers: addresses, an exit code and counted refusals. */
export interface ReportReceipt {
  runId: string;
  reportId: string | null;
  stored: 'new' | 'unchanged' | 'none';
  exitCode: number | null;
  issues: DesktopIssue[];
}

export type ReportRunOutcome =
  | { ok: true, receipt: ReportReceipt }
  | { ok: false, refused: 'not-found' | 'busy' | 'refused', issues: DesktopIssue[] };

export interface ReportService {
  /** What THIS host registered, and why it registered nothing when it did not. */
  instruments(): { instruments: InstrumentRegistration[], issues: DesktopIssue[] };
  run(input: { id: string, budget?: unknown }): Promise<ReportRunOutcome>;
  list(input?: { instrument?: string, limit?: number }): Promise<{ rows: ReportSummary[] }>;
  get(reportId: string): Promise<ReportDetail | null>;
}

export interface ReportSeams {
  db: TangleDb;
  runLog: RunLog;
  /** Absent on a host with no measurement workspace beside it — the compiled binary. */
  runner?: InstrumentRunner;
  /** Bounded admission, scope `report`: one run, two wait, the next is refused. */
  scheduler: {
    run<T>(worker: () => T | Promise<T>, context?: { scope?: string, signal?: AbortSignal, deadline?: number }): Promise<T>,
  };
  /** The controller of every run this process is executing, keyed by run id. */
  inflight: Map<string, AbortController>;
  now?: () => string;
  /** Monotonic milliseconds, for the admission deadline and the progress window. */
  ticks?: () => number;
  deadlineMs?: number;
}

const NO_RUNNER = 'this build registers no instrument: the measurement workspace is not part of the binary';
const BUDGET_REFUSED = 'no registered instrument accepts spend; a report is keyless and is never a gate';
const REPORT_BUSY_DETAIL = 'a report is already running and the queue behind it is full';

const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

/** The shape a report row is keyed by: the canonical digest, and nothing else. */
const DIGEST = /^[0-9a-f]{64}$/;

const reportsNewestFirst = (instrument: string | undefined): Record<string, unknown> => ({
  $for: { r: '$[*]' },
  ...(instrument === undefined ? {} : { $where: { $eq: ['$r.instrument', { $const: instrument }] } }),
  $orderby: { $key: '$r.at', $dir: 'desc' },
  $return: '$r',
});

const summaryOf = (row: ReportRow): ReportSummary => ({
  reportId: row.id, instrument: row.instrument, schemaId: row.schemaId,
  at: row.at, runId: row.runId, bytes: row.bytes,
});

/**
 * The identity an instrument computed for its own document: the
 * canonical digest of that document with its identity member removed.
 * The desktop verifies this recipe; it never invents one.
 */
export async function recomputeReportId(document: Record<string, unknown>): Promise<string> {
  const { reportId: _identity, ...rest } = document;
  return canonicalSha256(rest as Record<string, unknown>);
}

/**
 * Child output, batched into frames. `close()` settles the last batch
 * and appends what the cap made this run drop, so a truncated record
 * still says by how much it was truncated.
 */
export function createProgressCoalescer(frames: FrameSink, ticks: () => number): {
  push(line: string, stream: 'out' | 'err'): void,
  close(): { appended: number, suppressed: number },
} {
  let held: string[] = [];
  let stream: 'out' | 'err' = 'out';
  let opened = 0;
  let appended = 0;
  /** Lines that reached the cap: one of them is kept, the rest are counted. */
  let capped = 0;
  let heldBack = '';

  const release = (): void => {
    if (held.length === 0) return;
    // one frame short of the cap is kept back for the closing frame,
    // which is the only one that can carry the dropped count
    if (appended >= MAX_PROGRESS_FRAMES - 1) {
      capped += held.length;
      heldBack = held[held.length - 1];
      held = [];
      return;
    }
    frames.push('progress', { lines: held, stream, suppressed: 0 });
    appended += 1;
    held = [];
  };

  return {
    push(line, lineStream) {
      if (line === '') return;
      // one frame is one stream: a batch never mixes what the child
      // said with what it warned
      if (lineStream !== stream) release();
      stream = lineStream;
      if (held.length === 0) opened = ticks();
      held.push(line);
      if (held.length >= PROGRESS_BATCH_LINES || ticks() - opened >= PROGRESS_WINDOW_MS) release();
    },
    close() {
      release();
      if (capped === 0) return { appended, suppressed: 0 };
      // the closing frame keeps the last line the run produced and says
      // how many it could not keep — the kept one is not among them
      const suppressed = capped - 1;
      frames.push('progress', { lines: [heldBack], stream, suppressed });
      appended += 1;
      return { appended, suppressed };
    },
  };
}

export function createReportService(seams: ReportSeams): ReportService {
  const { db, runLog, runner, scheduler, inflight } = seams;
  const now = seams.now ?? ((): string => new Date().toISOString());
  const ticks = seams.ticks ?? ((): number => Date.now());
  const deadlineMs = seams.deadlineMs ?? REPORT_DEADLINE_MS;
  const reports = db.collection<ReportRow>('reports');

  /**
   * The one JSON document a run produced: the file carrying its own
   * canonical identity. A file that will not parse, or whose identity is
   * not the digest a row is keyed by, is counted rather than guessed at
   * — the store would refuse such a key, and a refused write must not
   * reach a caller as a fault.
   */
  async function documentOf(files: readonly string[]): Promise<{ document: Record<string, unknown>, bytes: number } | { reason: string }> {
    let unreadable = 0;
    for (const path of files) {
      if (!path.endsWith('.json')) continue;
      let text: string;
      try {
        text = await readFile(path, 'utf8');
      } catch { unreadable += 1; continue; }
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        if (typeof parsed.reportId === 'string' && DIGEST.test(parsed.reportId)) {
          return { document: parsed, bytes: utf8Bytes(text) };
        }
      } catch { unreadable += 1; }
    }
    return { reason: `the instrument produced no document carrying its own identity (${files.length} files, ${unreadable} unreadable)` };
  }

  /** One admitted report run, from its row to its terminal frame. */
  async function pass(instrument: InstrumentRunner, registration: InstrumentRegistration): Promise<ReportReceipt> {
    const run = await runLog.startRun('report');
    const controller = new AbortController();
    inflight.set(run.id, controller);
    const frames = createFrameSink(runLog, run.id);
    const progress = createProgressCoalescer(frames, ticks);
    const scratch = await createReportScratch();
    try {
      const outcome = await instrument.run(registration.id, {
        outDir: scratch.dir,
        signal: controller.signal,
        deadlineMs,
        onLine: (line, stream) => progress.push(line, stream),
      });
      const counted = progress.close();
      const base = {
        instrument: registration.id,
        schemaId: registration.schemaId,
        exitCode: outcome.exitCode,
        redacted: outcome.redacted,
        progressFrames: counted.appended,
        suppressedLines: counted.suppressed,
      };

      if (!outcome.ok) {
        const cancelled = controller.signal.aborted;
        const drained = await frames.drain();
        await runLog.finishRun(run.id, cancelled ? 'cancelled' : 'error', {
          ...base, killed: outcome.killed, reason: outcome.reason, files: 0, frameRefusals: drained.refused,
        });
        return { runId: run.id, reportId: null, stored: 'none', exitCode: outcome.exitCode, issues: refusalIssues(drained.refused) };
      }

      const produced = await documentOf(outcome.files);
      if (!('document' in produced)) {
        const drained = await frames.drain();
        await runLog.finishRun(run.id, 'error', {
          ...base, killed: false, reason: produced.reason, files: outcome.files.length, frameRefusals: drained.refused,
        });
        return { runId: run.id, reportId: null, stored: 'none', exitCode: 0, issues: refusalIssues(drained.refused) };
      }

      const reportId = String(produced.document.reportId);
      // a document already held is a document already held: the second
      // pass writes nothing and says whose row this is
      const existing = await reports.get(reportId);
      const stored: 'new' | 'unchanged' = existing === undefined ? 'new' : 'unchanged';
      const owner = existing?.runId ?? run.id;
      if (existing === undefined) {
        const source = produced.document.source;
        await reports.put({
          id: reportId,
          instrument: registration.id,
          schemaId: registration.schemaId,
          at: now(),
          runId: run.id,
          bytes: produced.bytes,
          source: source !== null && typeof source === 'object' && !Array.isArray(source) ? source as Record<string, unknown> : null,
          document: produced.document,
        });
      }
      await frames.append('report', {
        reportId,
        instrument: registration.id,
        schemaId: registration.schemaId,
        bytes: produced.bytes,
        stored,
        files: outcome.files.length,
        runId: owner,
      });
      const drained = await frames.drain();
      await runLog.finishRun(run.id, 'ok', {
        ...base, killed: false, reportId, stored, files: outcome.files.length, bytes: produced.bytes, frameRefusals: drained.refused,
      });
      return { runId: run.id, reportId, stored, exitCode: 0, issues: refusalIssues(drained.refused) };
    } catch (error) {
      // a worker that died still has to end its run: a row left running
      // is a run nobody can watch, resume or cancel
      progress.close();
      await frames.drain();
      await runLog.finishRun(run.id, 'error', {
        instrument: registration.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      inflight.delete(run.id);
      await scratch.dispose();
    }
  }

  /** Frames the store would not take are a short record, and say so. */
  function refusalIssues(refused: number): DesktopIssue[] {
    return refused === 0 ? [] : [issue('TDSK1003', '/runId', `${refused} frames of this run were refused by the store`)];
  }

  return {
    instruments() {
      if (runner === undefined) return { instruments: [], issues: [issue('TDSK1008', '/host', NO_RUNNER)] };
      return { instruments: runner.list(), issues: [] };
    },

    async run(input) {
      // the spend seam is DECLARED so a refusal is a declared answer
      // rather than an unrecognized member; no registered instrument
      // accepts it, and no path to a provider exists behind it
      if (input.budget !== undefined && input.budget !== null) {
        return { ok: false, refused: 'refused', issues: [issue('TDSK1009', '/budget', BUDGET_REFUSED)] };
      }
      if (runner === undefined) {
        return { ok: false, refused: 'not-found', issues: [issue('TDSK1008', '/host', NO_RUNNER)] };
      }
      const registration = runner.list().find((candidate) => candidate.id === input.id);
      if (registration === undefined) {
        return { ok: false, refused: 'not-found', issues: [issue('TDSK1008', '/id', `no instrument '${input.id}' is registered on this host`)] };
      }
      try {
        const receipt = await scheduler.run(() => pass(runner, registration), { scope: REPORT_SCOPE, deadline: ticks() + deadlineMs });
        return { ok: true, receipt };
      } catch (error) {
        // a fault is not a refusal anybody declared
        if (!isAdmissionRefusal(error)) throw error;
        const reason = (error as Error).message;
        return {
          ok: false,
          refused: 'busy',
          issues: [issue('TDSK1004', '/id', reason === 'queue-full' ? REPORT_BUSY_DETAIL : reason)],
        };
      }
    },

    async list(input = {}) {
      const limit = input.limit ?? 50;
      if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError('report limit must be a positive integer');
      const rows = asRows<ReportRow>(await reports.execute<ReportRow>(reportsNewestFirst(input.instrument)));
      return { rows: rows.slice(0, limit).map(summaryOf) };
    },

    async get(reportId) {
      const row = await reports.get(reportId);
      if (row === undefined) return null;
      const recomputed = await recomputeReportId(row.document);
      return {
        ...summaryOf(row),
        verified: recomputed === row.id,
        recomputed,
        source: row.source ?? null,
        document: row.document,
      };
    },
  };
}
