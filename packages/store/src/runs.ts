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
}

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
  startRun(kind: string): Promise<RunRecord>;
  recordEvent(runId: string, record: { id: string, status: string, ms: number }): Promise<RunEvent>;
  finishRun(runId: string, status: 'ok' | 'error', summary?: any): Promise<void>;
  listRuns(limit?: number): Promise<RunRecord[]>;
  getRun(id: string): Promise<{ run: RunRecord, events: RunEvent[] } | undefined>;
}

export interface RunLogOptions {
  now?: () => string;
}

const seqKey = (n: number): string => String(n).padStart(4, '0');

export function createRunLog(db: TangleDb, options: RunLogOptions = {}): RunLog {
  const now = options.now ?? ((): string => new Date().toISOString());
  const runs = db.collection('runs');
  const events = db.collection('events');
  let sequence = 0;
  const eventSeq = new Map<string, number>();

  return {
    async startRun(kind) {
      const startedAt = now();
      sequence += 1;
      const id = `r-${hashContent(`${startedAt}|${kind}|${sequence}`)}`;
      const run: RunRecord = { id, kind, startedAt, finishedAt: null, status: 'running', summary: null };
      await runs.put(run);
      eventSeq.set(id, 0);
      return run;
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
      const run = await runs.get(runId) as RunRecord | undefined;
      if (run === undefined) return;
      await runs.put({ ...run, finishedAt: now(), status, summary });
      eventSeq.delete(runId);
    },

    async listRuns(limit = 50) {
      const rows = asRows<RunRecord>(await runs.execute({ $for: { r: '$[*]' }, $return: '$r' }));
      rows.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
      return rows.slice(0, limit);
    },

    async getRun(id) {
      const run = await runs.get(id) as RunRecord | undefined;
      if (run === undefined) return undefined;
      const rows = asRows<RunEvent>(await events.execute({
        $for: { e: '$[*]' },
        $where: { $eq: ['$e.runId', id] },
        $return: '$e',
      }));
      rows.sort((a, b) => a.seq - b.seq);
      return { run, events: rows };
    },
  };
}
