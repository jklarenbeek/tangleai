/** Deterministic strategy selection; promotion remains an outcome-host action. */
import { ok, refuseOne, type EvolveOutcome } from './errors.ts';

export const EVOLVE_SELECTION_DEFAULT = 'unranked' as const;
export const EVOLVE_SELECTION_ARMS = ['unranked', 'recall', 'outcome-ranked', 'scripted-model'] as const;
export type SelectionArm = typeof EVOLVE_SELECTION_ARMS[number];
export interface SelectionCandidate { id: string; strategyId: string }
export interface SelectionContext {
  arm: SelectionArm;
  pool: readonly SelectionCandidate[];
  attempted: ReadonlySet<string>;
  /** Registered strategy order breaks equal-confidence and equal-recall ties. */
  strategyOrder: readonly string[];
  recall: () => Promise<ReadonlyMap<string, number>>;
  confidence: (strategyId: string) => Promise<number>;
}

export async function selectExperiment(options: SelectionContext): Promise<EvolveOutcome<SelectionCandidate | null>> {
  if (!(EVOLVE_SELECTION_ARMS as readonly string[]).includes(options.arm)) {
    return refuseOne('TEVO1001', '/arm', 'Unknown selection arm.');
  }
  if (new Set(options.pool.map(one => one.id)).size !== options.pool.length) {
    return refuseOne('TEVO1001', '/pool', 'A selection pool contains duplicate proposal identities.');
  }
  if (options.pool.some(one => !options.strategyOrder.includes(one.strategyId))) {
    return refuseOne('TEVO1001', '/pool', 'Every strategy must belong to the registered library.');
  }
  const pool = options.pool.filter(one => !options.attempted.has(one.id));
  if (pool.length === 0) return ok(null);
  if (options.arm === 'unranked' || options.arm === 'scripted-model') return ok({ ...pool[0] });
  const scores = options.arm === 'recall' ? await options.recall() : new Map(await Promise.all(
    [...new Set(pool.map(one => one.strategyId))].map(async id => [id, await options.confidence(id)] as const),
  ));
  if (pool.some(one => !Number.isFinite(scores.get(one.strategyId)))) {
    return refuseOne('TEVO1011', '/ranking', 'Every candidate needs a finite score from its registered ranking source.');
  }
  pool.sort((a, b) => scores.get(b.strategyId)! - scores.get(a.strategyId)!
    || options.strategyOrder.indexOf(a.strategyId) - options.strategyOrder.indexOf(b.strategyId)
    || options.pool.indexOf(a) - options.pool.indexOf(b));
  return ok({ ...pool[0] });
}
