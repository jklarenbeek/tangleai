/**
 * Pure runtime state — identities, legal transitions, sequencing.
 *
 * Everything here is a pure function over the generated runtime value
 * contracts: the semantic idempotency key an attempt commits under, the
 * derived record ids whose lexicographic order IS the trace sequence,
 * and the legal run/attempt/interaction lifecycle transitions. Illegal
 * transitions are `TMAS2003` values, never throws; the store adapter
 * applies what these planners decide and nothing else.
 */

import { masIssue, type MasIssue } from './errors.ts';
import type { MasRun, RunStatus } from './contracts.gen.ts';

// -- identities --------------------------------------------------------------

export interface NodeAddress {
  runId: string;
  region: string;
  /** '' outside a switch branch. */
  branch: string;
  /** 0 outside a loop; 1-based inside. */
  iteration: number;
  node: string;
}

/** The semantic idempotency key: `<run>/<region>/<branch>/<iteration>/<node>`. */
export function semanticKeyOf(address: NodeAddress): string {
  return `${address.runId}/${address.region}/${address.branch}/${address.iteration}/${address.node}`;
}

/** The hierarchical invocation path an attempt records (`refine/1/bump`). */
export function invocationPathOf(address: Pick<NodeAddress, 'branch' | 'iteration' | 'node'> & { prefix?: string }): string {
  const segments: string[] = [];
  if (address.prefix !== undefined && address.prefix !== '') segments.push(address.prefix);
  if (address.branch !== '') segments.push(address.branch);
  if (address.iteration > 0) segments.push(String(address.iteration));
  segments.push(address.node);
  return segments.join('/');
}

/** The checkpoint namespace of one region incarnation: `<region>/<branch>/<iteration>`. */
export function checkpointNamespaceOf(address: Pick<NodeAddress, 'region' | 'branch' | 'iteration'>): string {
  return `${address.region}/${address.branch}/${address.iteration}`;
}

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

/** Record ids sort by construction: the zero-padded per-run sequence IS the trace order. */
export function attemptIdOf(runId: string, seq: number): string {
  return `${runId}:a:${pad(seq, 6)}`;
}
export function messageIdOf(runId: string, seq: number): string {
  return `${runId}:m:${pad(seq, 6)}`;
}
export function stateRevisionIdOf(runId: string, seq: number): string {
  return `${runId}:s:${pad(seq, 6)}`;
}
export function artifactIdOf(runId: string, seq: number): string {
  return `${runId}:t:${pad(seq, 6)}`;
}
export function interactionIdOf(runId: string, node: string): string {
  return `${runId}:i:${node}`;
}

/** The derived queue segment job id: `<masRunId>:<zero-padded segment>`. */
export function segmentJobIdOf(runId: string, segment: number): string {
  return `${runId}:${pad(segment, 4)}`;
}

/** The versioned queue job kind: `mas:<executableRevision>`. */
export function masJobKindOf(executableRevision: string): string {
  return `mas:${executableRevision}`;
}

// -- run lifecycle -----------------------------------------------------------

export type RunCommand =
  | { kind: 'start' }
  | { kind: 'complete', output: unknown }
  | { kind: 'fail', failure: MasRun['failure'] }
  | { kind: 'wait' }
  | { kind: 'resume-pending' }
  | { kind: 'queue-segment' }
  | { kind: 'cancel' };

const RUN_TRANSITIONS: Record<RunCommand['kind'], { from: RunStatus[], to: RunStatus }> = {
  start: { from: ['queued'], to: 'running' },
  complete: { from: ['running'], to: 'completed' },
  fail: { from: ['running', 'queued', 'resume_pending'], to: 'failed' },
  wait: { from: ['running'], to: 'waiting_for_input' },
  'resume-pending': { from: ['waiting_for_input'], to: 'resume_pending' },
  'queue-segment': { from: ['resume_pending'], to: 'queued' },
  cancel: { from: ['queued', 'running', 'waiting_for_input', 'resume_pending'], to: 'cancelled' },
};

export type RunTransition =
  | { ok: true, status: RunStatus }
  | { ok: false, issue: MasIssue };

/** Decide one run lifecycle step; the adapter applies it transactionally. */
export function planRunTransition(current: RunStatus, command: RunCommand): RunTransition {
  const rule = RUN_TRANSITIONS[command.kind];
  if (!rule.from.includes(current)) {
    return {
      ok: false,
      issue: masIssue('TMAS2003', '/status', `a '${command.kind}' transition is illegal from '${current}' (legal from: ${rule.from.join(', ')})`),
    };
  }
  return { ok: true, status: rule.to };
}

// -- attempt lifecycle -------------------------------------------------------

export type AttemptStatusValue = 'running' | 'completed' | 'failed' | 'aborted' | 'uncertain';

const ATTEMPT_TERMINALS: Record<AttemptStatusValue, AttemptStatusValue[]> = {
  running: ['completed', 'failed', 'aborted', 'uncertain'],
  completed: [],
  failed: [],
  aborted: [],
  uncertain: ['completed', 'failed'],
};

export function planAttemptTransition(current: AttemptStatusValue, next: AttemptStatusValue): RunTransition {
  if (!ATTEMPT_TERMINALS[current].includes(next)) {
    return {
      ok: false,
      issue: masIssue('TMAS2003', '/status', `an attempt cannot move '${current}' -> '${next}'`),
    };
  }
  return { ok: true, status: next as RunStatus };
}

// -- interaction lifecycle ---------------------------------------------------

export type InteractionStatusValue = 'waiting' | 'responded' | 'cancelled' | 'expired';

const INTERACTION_TRANSITIONS: Record<InteractionStatusValue, InteractionStatusValue[]> = {
  waiting: ['responded', 'cancelled', 'expired'],
  responded: [],
  cancelled: [],
  expired: [],
};

export function planInteractionTransition(current: InteractionStatusValue, next: InteractionStatusValue): { ok: true } | { ok: false, issue: MasIssue } {
  if (!INTERACTION_TRANSITIONS[current].includes(next)) {
    return {
      ok: false,
      issue: masIssue('TMAS2007', '/status', `an interaction cannot move '${current}' -> '${next}'; a resolved interaction accepts nothing further`),
    };
  }
  return { ok: true };
}
