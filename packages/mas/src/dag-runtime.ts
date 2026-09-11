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

import { compileDag, FlowRuntimeError } from '@jarenjs/flow';
import { equalsJson } from '@jarenjs/core/object';

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
  taskVersion: string;
  executableRevision: string;
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
  const tasks = Object.fromEntries(Object.entries(run.handlers).map(([name, handler]) =>
    [name, { run: handler, version: run.taskVersion }]));
  // Store the suite's provenance beside each value in the existing namespaced
  // checkpoint rows. A crash cannot publish a value without its identity.
  const checkpoint = {
    async load(id: string) {
      const loaded = await run.checkpoints.load(id) as { values: Record<string, unknown> } | null;
      if (loaded == null) return null;
      let identity: unknown;
      const values: Record<string, unknown> = {};
      for (const [node, raw] of Object.entries(loaded.values)) {
        const record = raw as { format?: string, identity?: unknown, value?: unknown } | null;
        if (record?.format !== 'tangle-mas-checkpoint/1' || !Object.hasOwn(record, 'value')) {
          throw new FlowRuntimeError('JF2013', 'the region checkpoint has no verified provenance');
        }
        if (identity !== undefined && !equalsJson(identity, record.identity)) {
          throw new FlowRuntimeError('JF2013', 'the region checkpoint mixes execution identities');
        }
        identity = record.identity;
        values[node] = record.value;
      }
      return { identity, values };
    },
    save: (id: string, node: string, value: unknown, identity: unknown) =>
      run.checkpoints.save(id, node, { format: 'tangle-mas-checkpoint/1', identity, value }),
    complete: (id: string, value: unknown, identity: unknown) =>
      run.checkpoints.complete(id, { format: 'tangle-mas-checkpoint/1', identity, value }),
  };
  const compiled = compileDag(run.document, { tasks, checkpoint, revision: run.executableRevision });
  try {
    const exposed = await compiled.run(run.scope, {
      runId: run.segmentJobId,
      signal: run.signal,
      drainOnAbort: true,
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
    // drainOnAbort ensures every started lifecycle settles before this branch.
    const flowError = error as { code?: string, nodeId?: string, cause?: unknown };
    const cause = flowError.cause;
    if (cause instanceof MasInfrastructureCrash) throw cause;
    if (error instanceof MasInfrastructureCrash) throw error;
    if (flowError.code === 'JF2009') throw new MasInfrastructureCrash((error as Error).message);
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
          code: flowError.code === 'JF2013' ? 'TMAS2002' : 'TMAS2004',
          detail: (error as Error).message ?? String(error),
          cause: flowError.code === undefined ? null : { code: flowError.code, docPath: '', message: (error as Error).message ?? '' },
        },
      },
    };
  }
}
