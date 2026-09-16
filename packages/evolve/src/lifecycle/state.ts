/**
 * What one experiment carries between stages, and the total rules for
 * moving it forward.
 *
 * Pure and total: no I/O, no clock, no process. The durable path and the
 * sequential path must land on the SAME decision and the same leg census
 * for all sixteen registered proposals, and the only way to be sure of
 * that is for the arithmetic to live in one place both can call.
 *
 * The central rule is `decided`. A stage that refuses writes a decision
 * into the envelope, and every later stage carries it through untouched
 * rather than working around it with a branch. That is what lets the
 * graph stay a straight line with one switch in it: nine of the sixteen
 * registered proposals are refused at `propose` and travel the whole
 * length of the workflow as a value, spending nothing.
 */

import type { Decision, DecisionReason, EvolveCode } from '../contracts.gen.ts';
import type { GateVerdict } from './../decide.ts';

/** A decision as the row census reads it. */
export interface EnvelopeDecision {
  decision: Decision;
  reason: DecisionReason;
  code: EvolveCode | null;
}

/** The value that travels every edge of the lifecycle. */
export interface EvolveEnvelope {
  experimentId: string;
  proposalId: string;
  strategyId: string;
  /** Set by the first stage that refuses. Never overwritten. */
  decision: EnvelopeDecision | null;
  gate: GateVerdict | null;
  rerun: GateVerdict | null;
  fitness: 'improved' | 'equal' | 'regression' | 'unverifiable' | null;
  /** Effect plan ids that settled, in the order they settled. */
  settled: string[];
  /** The leg census. Counted as legs settle, never derived afterwards. */
  legs: number;
  unresolved: number;
}

/** What a worker answers a wait with. */
export interface EvolveSettlement {
  operationId: string;
  state: 'confirmed' | 'rejected' | 'unresolved';
  recordId?: string;
  evidence?: Record<string, unknown>;
}

export function emptyEnvelope(input: {
  experimentId: string, proposalId: string, strategyId: string,
}): EvolveEnvelope {
  return {
    experimentId: input.experimentId,
    proposalId: input.proposalId,
    strategyId: input.strategyId,
    decision: null,
    gate: null,
    rerun: null,
    fitness: null,
    settled: [],
    legs: 0,
    unresolved: 0,
  };
}

/**
 * Whether this experiment already has its answer.
 *
 * Every stage asks this first. A decided envelope is carried, not acted
 * on — so a refusal at `propose` reaches `record` without any stage in
 * between writing an effect intent.
 */
export const decided = (env: EvolveEnvelope): boolean => env.decision !== null;

/**
 * Write the decision, if there is not one already.
 *
 * First refusal wins, deliberately. A later stage cannot overwrite an
 * earlier refusal with a tidier one, because the earliest refusal is the
 * one that says what actually stopped the experiment.
 */
export function decide(env: EvolveEnvelope, decision: EnvelopeDecision): EvolveEnvelope {
  if (env.decision !== null) return env;
  return { ...env, decision };
}

/** Count legs that settled, and the ones nobody can account for. */
export function counted(env: EvolveEnvelope, legs: number, unresolved = 0): EvolveEnvelope {
  return { ...env, legs: env.legs + legs, unresolved: env.unresolved + unresolved };
}

/** Note that an operation's record is now readable. */
export function settled(env: EvolveEnvelope, planId: string): EvolveEnvelope {
  return env.settled.includes(planId) ? env : { ...env, settled: [...env.settled, planId] };
}

/**
 * An unresolved leg is terminal and is NOT a decision about the change.
 *
 * `uncertain` rather than `abandoned`: nobody knows whether the effect
 * happened, and recording an abandon would be claiming knowledge the run
 * does not have. A person reconciles it.
 */
export function uncertain(env: EvolveEnvelope): EvolveEnvelope {
  return decide(counted(env, 0, 1), {
    decision: 'uncertain', reason: 'uncertain-effect', code: 'TEVO1009',
  });
}

/**
 * Whether the measurement stages should run at all.
 *
 * Only a green gate earns a measurement. A red one is already decided,
 * and an over-budget or refused one reached no verdict to measure
 * against.
 */
export const measures = (env: EvolveEnvelope): boolean =>
  !decided(env) && env.gate === 'green';

/**
 * Whether the single rerun is earned. The whole flake policy, and the
 * same predicate the switch branch tests.
 */
export const reruns = (env: EvolveEnvelope): boolean =>
  !decided(env) && env.gate === 'red';

/** Read a settlement, tolerating a worker that answered something odd. */
export function readSettlement(value: unknown): EvolveSettlement | null {
  if (typeof value !== 'object' || value === null) return null;
  const held = value as Record<string, unknown>;
  const state = held.state;
  if (state !== 'confirmed' && state !== 'rejected' && state !== 'unresolved') return null;
  if (typeof held.operationId !== 'string') return null;
  return {
    operationId: held.operationId,
    state,
    recordId: typeof held.recordId === 'string' ? held.recordId : undefined,
    evidence: typeof held.evidence === 'object' && held.evidence !== null
      ? held.evidence as Record<string, unknown>
      : undefined,
  };
}
