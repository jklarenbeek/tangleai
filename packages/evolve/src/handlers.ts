/**
 * One dispatch table over the record store. Every operation is a read.
 *
 * There is no handler that merges, promotes, approves, runs, cancels or
 * stops an experiment — not because each is guarded, but because none
 * exists. A caller who wants to stop an experiment reaches for the host
 * library, which an operator runs and a wire client does not.
 *
 * `evolve.review.get` answers the bundle's diff DIGEST and byte count and
 * never the diff text, and never what the gate printed. A reviewer reads
 * those from the branch the experiment left, where they are attributable
 * to a commit, rather than from a payload that could be rewritten on the
 * way past.
 */

import type { Handler, RequestContext } from '@jarenjs/contract/http';

import { refuseOne } from './errors.ts';
import type { EvolveStore } from './store.ts';

/** The read surface a host binds. Narrow on purpose. */
export interface EvolveReader {
  listExperiments(query: {
    repository?: string, baseRevision?: string, status?: string, decision?: string, limit?: number,
  }): Promise<{ experiments: unknown[], truncated: boolean }>;
  getExperiment(experimentId: string): Promise<{ experiment: unknown, recordIds: string[] } | undefined>;
  getReviewBundle(experimentId: string): Promise<unknown | undefined>;
}

export interface EvolveHandlerBinding {
  reader: EvolveReader;
  /** Host access policy, evaluated before every read. */
  allowRead(context: RequestContext): boolean | Promise<boolean>;
}

export interface EvolveHandlerOptions {
  resolveHost(context: RequestContext): EvolveHandlerBinding | undefined | Promise<EvolveHandlerBinding | undefined>;
}

/** Every operation this package publishes. All reads; the list is closed. */
export const EVOLVE_OPERATIONS = Object.freeze([
  'evolve.experiments.list', 'evolve.experiment.get', 'evolve.review.get',
]);

/** The bound on a list, applied whether or not the caller asked for one. */
export const EVOLVE_LIST_LIMIT = 200;

export function createEvolveHandlers(options: EvolveHandlerOptions): Record<string, Handler> {
  const refused = () => refuseOne('TEVO1007', '/host', 'The authenticated host refused read access.');

  return {
    'evolve.experiments.list': async (input: unknown, context: RequestContext) => {
      const binding = await options.resolveHost(context);
      if (!binding || !await binding.allowRead(context)) return refused();
      const query = (input ?? {}) as { limit?: number };
      const limit = Math.min(
        typeof query.limit === 'number' && query.limit > 0 ? query.limit : EVOLVE_LIST_LIMIT,
        EVOLVE_LIST_LIMIT,
      );
      return await binding.reader.listExperiments({ ...query, limit });
    },

    'evolve.experiment.get': async (input: unknown, context: RequestContext) => {
      const binding = await options.resolveHost(context);
      if (!binding || !await binding.allowRead(context)) return refused();
      const id = (input as { experimentId?: unknown } | null)?.experimentId;
      if (typeof id !== 'string') {
        return refuseOne('TEVO1001', '/experimentId', 'An experiment id is required.');
      }
      const held = await binding.reader.getExperiment(id);
      if (held === undefined) {
        return refuseOne('TEVO1010', '/experimentId', 'No such experiment.');
      }
      return held;
    },

    'evolve.review.get': async (input: unknown, context: RequestContext) => {
      const binding = await options.resolveHost(context);
      if (!binding || !await binding.allowRead(context)) return refused();
      const id = (input as { experimentId?: unknown } | null)?.experimentId;
      if (typeof id !== 'string') {
        return refuseOne('TEVO1001', '/experimentId', 'An experiment id is required.');
      }
      const bundle = await binding.reader.getReviewBundle(id);
      if (bundle === undefined) {
        // A refused or abandoned experiment leaves no bundle, and saying
        // so is more useful than an empty one that looks like a keep.
        return refuseOne('TEVO1010', '/experimentId', 'This experiment left no review bundle.');
      }
      return { bundle };
    },
  };
}

/**
 * A reader over the package's own store contract.
 *
 * Built from `listRecords` and `getExperiment` rather than from bespoke
 * query methods: the store stays the four narrow members it already is,
 * and the filtering a read operation needs lives here, where it can be
 * read beside the bound it is subject to.
 */
export function createEvolveReader(store: EvolveStore): EvolveReader {
  const matches = (
    experiment: Record<string, unknown>,
    query: { repository?: string, baseRevision?: string, status?: string, decision?: string },
  ): boolean =>
    (query.repository === undefined || experiment.repository === query.repository)
    && (query.baseRevision === undefined || experiment.baseRevision === query.baseRevision)
    && (query.status === undefined || experiment.status === query.status)
    && (query.decision === undefined
      || (experiment.decision as { decision?: string } | null)?.decision === query.decision);

  return {
    async listExperiments(query) {
      const limit = Math.min(query.limit ?? EVOLVE_LIST_LIMIT, EVOLVE_LIST_LIMIT);
      const held = await store.listRecords({ kind: 'experiment' });
      if (!held.ok) return { experiments: [], truncated: false };
      const kept = held.value.filter(one => matches(one as unknown as Record<string, unknown>, query));
      return { experiments: kept.slice(0, limit), truncated: kept.length > limit };
    },

    async getExperiment(experimentId) {
      const experiment = await store.getExperiment(experimentId);
      if (!experiment.ok || experiment.value === null) return undefined;
      const held = await store.listRecords({ kind: 'experiment', experimentId });
      const recordIds = held.ok
        ? held.value.map(one => (one as unknown as { id: string }).id)
        : [];
      return { experiment: experiment.value, recordIds };
    },

    async getReviewBundle(experimentId) {
      const held = await store.listRecords({ kind: 'review-bundle', experimentId });
      if (!held.ok || held.value.length === 0) return undefined;
      return held.value[0];
    },
  };
}
