/**
 * The run log — what makes the DAG surface historical.
 *
 * A run is one pass of the pipeline; an event is one DAG node record
 * inside it (`{ node, status, ms }`, the exact shape @jarenjs/flow's
 * `onNode` observer emits, plus a timestamp). The desktop app renders
 * the current run live from these and any past run from the same rows —
 * one storage shape, both tenses.
 *
 * Run ids are content-addressed from (startedAt, kind, sequence) so an
 * injected `now` makes tests deterministic; event ids are
 * `<runId>:<seq>` with a zero-padded seq so lexicographic id order IS
 * event order.
 */

import { hashContent } from '@jarenjs/core/string';

import type { TangleDb } from './db.ts';
import { asRows } from './memory-store.ts';

export interface RunRecord {
  id: string;
  kind: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'ok' | 'error';
  summary: any;
  /** The content-addressed config identity that produced this run. Absent on rows written before identities were recorded. */
  identityId?: string;
}

/** How a run relates to the identity table when read back. */
export type RunIdentityStatus = 'run' | 'legacy-unrecorded';

/** A run row as reads return it: the stored record plus its honest identity status. */
export type RunView = RunRecord & { identityStatus: RunIdentityStatus };

export interface RunEvent {
  id: string;
  runId: string;
  seq: number;
  node: string;
  status: string;
  ms: number;
  at: string;
}

export interface RunLog {
  startRun(kind: string, options?: { identityId?: string }): Promise<RunRecord>;
  recordEvent(runId: string, record: { id: string, status: string, ms: number }): Promise<RunEvent>;
  /** Attach the finalized identity to a running run — before any corpus write it authorizes. */
  attachIdentity(runId: string, identityId: string): Promise<void>;
  finishRun(runId: string, status: 'ok' | 'error', summary?: any): Promise<{ ok: true } | { ok: false, reason: string }>;
  listRuns(limit?: number): Promise<RunView[]>;
  getRun(id: string): Promise<{ run: RunView, events: RunEvent[] } | undefined>;
}

export interface RunLogOptions {
  now?: () => string;
  /**
   * Run kinds that must carry a config identity by the time they
   * finish. A finish without one is refused as a value: the run is
   * closed as an error naming the absence, never silently completed —
   * a run that cannot say what stack produced it is not "ok".
   */
  configAwareKinds?: readonly string[];
}

const seqKey = (n: number): string => String(n).padStart(4, '0');

const viewOf = (run: RunRecord): RunView => ({
  ...run,
  identityStatus: typeof run.identityId === 'string' ? 'run' : 'legacy-unrecorded',
});

export function createRunLog(db: TangleDb, options: RunLogOptions = {}): RunLog {
  const now = options.now ?? ((): string => new Date().toISOString());
  const configAware = new Set(options.configAwareKinds ?? []);
  const runs = db.collection<RunRecord>('runs');
  const events = db.collection<RunEvent>('events');
  let sequence = 0;
  const eventSeq = new Map<string, number>();

  return {
    async startRun(kind, startOptions = {}) {
      const startedAt = now();
      sequence += 1;
      const id = `r-${hashContent(`${startedAt}|${kind}|${sequence}`)}`;
      const run: RunRecord = { id, kind, startedAt, finishedAt: null, status: 'running', summary: null };
      if (startOptions.identityId !== undefined) run.identityId = startOptions.identityId;
      await runs.put(run);
      eventSeq.set(id, 0);
      return run;
    },

    async attachIdentity(runId, identityId) {
      const run = await runs.get(runId);
      if (run === undefined) return;
      await runs.put({ ...run, identityId });
    },

    async recordEvent(runId, record) {
      const seq = (eventSeq.get(runId) ?? 0) + 1;
      eventSeq.set(runId, seq);
      const event: RunEvent = {
        id: `${runId}:${seqKey(seq)}`,
        runId,
        seq,
        node: record.id,
        status: record.status,
        ms: record.ms,
        at: now(),
      };
      await events.put(event);
      return event;
    },

    async finishRun(runId, status, summary = null) {
      const run = await runs.get(runId);
      if (run === undefined) return { ok: false as const, reason: `run '${runId}' does not exist` };
      eventSeq.delete(runId);
      if (status === 'ok' && configAware.has(run.kind) && run.identityId === undefined) {
        const reason = 'the run carries no config identity; a config-aware run cannot complete without saying what stack produced it';
        await runs.put({ ...run, finishedAt: now(), status: 'error', summary: { ...(summary ?? {}), refused: reason } });
        return { ok: false as const, reason };
      }
      await runs.put({ ...run, finishedAt: now(), status, summary });
      return { ok: true as const };
    },

    async listRuns(limit = 50) {
      if (!Number.isSafeInteger(limit) || limit < 0) throw new TypeError('run limit must be a non-negative integer');
      if (limit === 0) return [];
      const rows: RunView[] = [];
      const cursor = runs.query<RunRecord>({
        $for: { r: '$[*]' }, $orderby: { $key: '$r.startedAt', $dir: 'desc' }, $return: '$r',
      });
      for await (const row of cursor) {
        rows.push(viewOf(row));
        if (rows.length === limit) break;
      }
      return rows;
    },

    async getRun(id) {
      const run = await runs.get(id);
      if (run === undefined) return undefined;
      const rows = asRows(await events.execute<RunEvent>({
        $for: { e: '$[*]' },
        $where: { $eq: ['$e.runId', { $const: id }] },
        $orderby: '$e.seq',
        $return: '$e',
      }));
      return { run: viewOf(run), events: rows };
    },
  };
}
