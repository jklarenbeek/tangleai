/**
 * The live DAG hub — one small pub/sub that speaks the contract
 * stream's Subscription duck (`snapshot` / `subscribe` / `close`), so
 * the `dag.live` handler is a one-liner.
 *
 * Emission format is deliberately the simplest correct one: every
 * change is a single root-replace patch (`[{ op: 'replace', path: '',
 * value }]`). The state is small (a run header + one status per node),
 * so structural patch minimalism buys nothing here, and a root replace
 * can never drift from the snapshot.
 */

import type { RunRecord } from '@tangleai/store';
import type { DagNodeRecord } from '@tangleai/pipeline';

export interface LiveDagState {
  run: { id: string, kind: string, startedAt: string, status: string } | null;
  nodes: Record<string, { status: string, ms: number }>;
  seq: number;
}

type Listener = (emission: { patch?: any[], seq?: number, error?: any }) => void;

export interface LiveHub {
  state(): LiveDagState;
  start(run: RunRecord): void;
  node(record: DagNodeRecord): void;
  finish(status: 'ok' | 'error'): void;
  subscription(): {
    snapshot(): LiveDagState,
    subscribe(cb: Listener): () => void,
    close(): void,
  };
}

export function createLiveHub(): LiveHub {
  let state: LiveDagState = { run: null, nodes: {}, seq: 0 };
  const listeners = new Set<Listener>();

  function emit(): void {
    state = { ...state, seq: state.seq + 1 };
    const emission = {
      patch: [{ op: 'replace', path: '', value: structuredClone(state) }],
      seq: state.seq,
    };
    for (const listener of [...listeners]) {
      try { listener(emission); } catch { /* a broken listener is not our error */ }
    }
  }

  return {
    state: () => structuredClone(state),
    start(run) {
      state = { ...state, run: { id: run.id, kind: run.kind, startedAt: run.startedAt, status: 'running' }, nodes: {} };
      emit();
    },
    node(record) {
      state = {
        ...state,
        nodes: { ...state.nodes, [record.id]: { status: record.status, ms: Math.round(record.ms * 100) / 100 } },
      };
      emit();
    },
    finish(status) {
      if (state.run !== null) {
        state = { ...state, run: { ...state.run, status } };
        emit();
      }
    },
    subscription() {
      const mine = new Set<Listener>();
      return {
        snapshot: () => structuredClone(state),
        subscribe(cb) {
          mine.add(cb);
          listeners.add(cb);
          return () => { mine.delete(cb); listeners.delete(cb); };
        },
        close() {
          for (const cb of mine) listeners.delete(cb);
          mine.clear();
        },
      };
    },
  };
}
