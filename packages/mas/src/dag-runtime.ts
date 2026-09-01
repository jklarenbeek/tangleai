/**
 * One acyclic region through `compileDag` — the suite is the scheduler.
 *
 * The lowered region document compiles against the lifecycle handlers
 * and runs once per incarnation under the segment's namespaced
 * checkpoint store and one shared abort signal. The first semantic
 * failure surfaces as Jaren's own `JF2006` (its abort reaches every
 * sibling handler, model call, context read and wrapped tool); the
 * region runner waits for every started lifecycle to settle its own
 * attempt before reporting the failure value, and it never turns
 * partial results into region output. `restored` records from a resumed
 * run reach the observer; an infrastructure crash passes through raw so
 * the queue retries it.
 */

import { compileDag } from '@jarenjs/flow';

import { MasInfrastructureCrash, MasNodeFailure, type MasRuntimeObserver } from './node-lifecycle.ts';
import { invocationPathOf } from './runtime-state.ts';
import type { RuntimeError } from './contracts.gen.ts';

export interface RegionCheckpoints {
  load(runId: string): unknown;
  save(runId: string, nodeId: string, value: unknown): unknown;
  complete(runId: string, result: unknown): unknown;
}

export interface DagRegionRun {
  document: unknown;
  handlers: Record<string, (props: { with: unknown, input: unknown }, signal: AbortSignal) => Promise<unknown>>;
  scope: { input: unknown, nodes: Record<string, unknown> };
  segmentJobId: string;
  checkpoints: RegionCheckpoints;
  signal: AbortSignal;
  observer?: MasRuntimeObserver;
  region: { branch: string, iteration: number, pathPrefix?: string };
}

export type DagRegionOutcome =
  | { ok: true, exposed: Record<string, Record<string, unknown>> }
  | { ok: false, failure: { node: string, error: RuntimeError } };

export async function executeDagRegion(run: DagRegionRun): Promise<DagRegionOutcome> {
  const pending = new Set<Promise<unknown>>();
  const tracked: typeof run.handlers = {};
  for (const [name, handler] of Object.entries(run.handlers)) {
    tracked[name] = (props, signal) => {
      const promise = handler(props, signal);
      pending.add(promise);
      promise.catch(() => undefined).finally(() => pending.delete(promise));
      return promise;
    };
  }
  const compiled = compileDag(run.document, { tasks: tracked, checkpoint: run.checkpoints });
  try {
    const exposed = await compiled.run(run.scope, {
      runId: run.segmentJobId,
      signal: run.signal,
      onNode: (record) => {
        if (record.status === 'restored' && record.id.startsWith('t:')) {
          run.observer?.onNodeRestored?.(invocationPathOf({
            prefix: run.region.pathPrefix,
            branch: run.region.branch,
            iteration: run.region.iteration,
            node: record.id.slice(2),
          }));
        }
      },
    }) as Record<string, Record<string, unknown>>;
    return { ok: true, exposed };
  } catch (error) {
    // Every started lifecycle settles its own attempt before the region reports.
    await Promise.allSettled([...pending]);
    const flowError = error as { code?: string, nodeId?: string, cause?: unknown };
    const cause = flowError.cause;
    if (cause instanceof MasInfrastructureCrash) throw cause;
    if (error instanceof MasInfrastructureCrash) throw error;
    if (cause instanceof MasNodeFailure) {
      return {
        ok: false,
        failure: {
          node: cause.node,
          error: { code: cause.issue.code, detail: cause.issue.detail, cause: null },
        },
      };
    }
    if (flowError.code === 'JF2007') throw error;
    const node = typeof flowError.nodeId === 'string' && flowError.nodeId.startsWith('t:')
      ? flowError.nodeId.slice(2)
      : flowError.nodeId ?? 'unknown';
    return {
      ok: false,
      failure: {
        node: String(node),
        error: {
          code: 'TMAS2004',
          detail: (error as Error).message ?? String(error),
          cause: flowError.code === undefined ? null : { code: flowError.code, docPath: '', message: (error as Error).message ?? '' },
        },
      },
    };
  }
}
