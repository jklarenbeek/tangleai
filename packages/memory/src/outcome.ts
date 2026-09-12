/**
 * Outcome learning — ported from memflow `OutcomeLearnerModule`.
 *
 * The one idea worth keeping from the "Karpathy loop": confidence moves
 * on GROUND TRUTH, not on the model's opinion of itself. A host files an
 * `OutcomeReport` after acting on recalled memories — the report carries
 * evidence of what actually happened — and the cited memories move:
 * success boosts, failure penalizes (harder than success boosts, which
 * is the asymmetry that makes the loop conservative), partial nudges.
 * Confidence is clamped to [floor, max]: a memory can be discredited
 * down to the floor but never silently erased by arithmetic — deletion
 * is a separate, auditable decision.
 */

import type { MemoryUnit, OutcomeReport } from '@tangleai/core/schemas/memory';
import type { MemoryStore } from './store.ts';
import { cloneJson } from '@jarenjs/core/object';

export interface OutcomeOptions {
  successBoost: number;
  failurePenalty: number;
  partialBoost: number;
  minConfidence: number;
  maxConfidence: number;
}

export const DEFAULT_OUTCOME_OPTIONS: OutcomeOptions = {
  successBoost: 0.15,
  failurePenalty: 0.25,
  partialBoost: 0.05,
  minConfidence: 0.1,
  maxConfidence: 1.0,
};

/** The signed confidence delta for an outcome. Pure. */
export function outcomeAdjustment(
  outcome: OutcomeReport['outcome'],
  options: OutcomeOptions = DEFAULT_OUTCOME_OPTIONS,
): number {
  switch (outcome) {
    case 'success': return options.successBoost;
    case 'failure': return -options.failurePenalty;
    case 'partial': return options.partialBoost;
    default: return 0;
  }
}

export interface ApplyOutcomeResult {
  adjusted: number;
  adjustment: number;
  missing: string[];
}

/** Detached confidence projection; preserves fact time and all other fields. */
export function projectOutcomeConfidence(
  unit: MemoryUnit,
  category: OutcomeReport['outcome'],
  options: OutcomeOptions = DEFAULT_OUTCOME_OPTIONS,
): MemoryUnit {
  const next = cloneJson(unit);
  next.confidence = Math.min(options.maxConfidence, Math.max(
    options.minConfidence, (unit.confidence ?? 0.5) + outcomeAdjustment(category, options),
  ));
  return next;
}

/** Apply an outcome report to the store. */
export async function applyOutcome(
  store: MemoryStore,
  report: OutcomeReport,
  config: { options?: OutcomeOptions } = {},
): Promise<ApplyOutcomeResult> {
  const options = config.options ?? DEFAULT_OUTCOME_OPTIONS;
  const adjustment = outcomeAdjustment(report.outcome, options);

  let adjusted = 0;
  const missing: string[] = [];

  for (const id of report.memoryIds) {
    const unit: MemoryUnit | undefined = await store.get(id);
    if (!unit) {
      missing.push(id); // reported, not swallowed — a report citing a
      continue;         // vanished memory is a fact the host should see
    }
    const next = projectOutcomeConfidence(unit, report.outcome, options);
    next.at = report.at;
    await store.put(next);
    adjusted++;
  }

  return { adjusted, adjustment, missing };
}
