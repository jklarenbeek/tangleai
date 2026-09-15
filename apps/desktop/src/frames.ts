/**
 * Ordered frame appends for one run.
 *
 * Every producer — the pipeline's node observer, the chat engine's
 * delta consumer — hands frames over from a synchronous callback, and
 * the store's append is asynchronous. One chain per run makes the
 * order of the appends the order of the events, and `drain()` is what a
 * handler awaits before it finishes the run: a write still in flight
 * when the run row closes is a frame the reader never sees.
 *
 * A refused or failed append is counted, never swallowed and never
 * thrown at a sync callback that has nowhere to put it; the count
 * belongs in the run's summary, where a reader can see that the record
 * is short.
 */

import type { FrameKind, RunLog } from '@tangleai/store';

export interface FrameSink {
  /** Queue one frame behind everything queued before it. */
  push(kind: FrameKind, body: Record<string, unknown>): void;
  /** Queue one frame and await it and its predecessors. */
  append(kind: FrameKind, body: Record<string, unknown>): Promise<void>;
  /** Settle everything queued; answers what landed and what did not. */
  drain(): Promise<{ appended: number, refused: number }>;
}

export function createFrameSink(runLog: RunLog, runId: string): FrameSink {
  let chain: Promise<void> = Promise.resolve();
  let appended = 0;
  let refused = 0;

  const queue = (kind: FrameKind, body: Record<string, unknown>): Promise<void> => {
    chain = chain.then(async () => {
      try {
        const outcome = await runLog.appendFrame(runId, { kind, body });
        if (outcome.ok) appended += 1;
        else refused += 1;
      } catch {
        // the store itself failed; the run still has to finish and say so
        refused += 1;
      }
    });
    return chain;
  };

  return {
    push: (kind, body) => { void queue(kind, body); },
    append: (kind, body) => queue(kind, body),
    async drain() {
      await chain;
      return { appended, refused };
    },
  };
}
