/**
 * Failures as EVIDENCE, not as modification requests.
 *
 * A mechanism that changes itself once per observed failure is optimizing
 * against the wrong thing. Any single failure has two possible causes and
 * no way to tell them apart: the instance was peculiar, or the mechanism
 * is deficient. Treating every failure as a direct instruction to change
 * therefore bends the mechanism around whatever it happened to see, which
 * narrows what it will accept in future and makes it worse at cases nobody
 * showed it.
 *
 * What distinguishes the two is RECURRENCE ACROSS DISTINCT INSTANCES. A
 * failure mode that shows up under two or more unrelated proposals is
 * evidence about the mechanism; one that shows up once is evidence about
 * that proposal. So this module groups failures into patterns and marks a
 * pattern `systematic` only when it spans at least two distinct instances.
 * That threshold is an inductive bias, deliberately — it is not proof of
 * cause, and single-instance patterns are kept as auxiliary evidence
 * rather than discarded.
 *
 * Everything here is pure and total. It reads decided rows and answers
 * counts; it runs no process, reads no file and decides nothing about any
 * individual experiment. `planExperimentDecision` still owns the
 * per-experiment verdict, and this layer sits above it, saying what a
 * ROUND of verdicts amounts to.
 *
 * What is deliberately NOT computed: the share of changes that accommodate
 * one model's quirks rather than repairing the mechanism. That number
 * needs modification decisions to exist, and nothing here modifies
 * anything yet. `systematicRatio` is its measurable precursor — how much
 * of the failure evidence would license a mechanism-level repair at all.
 */

import type { Decision, DecisionReason, EvolveCode } from './contracts.gen.ts';

/** The stage a failure came from. Total over the reason vocabulary. */
export type FailureMechanism = 'surface' | 'budget' | 'gate' | 'measurement' | 'command' | 'effect';

export const FAILURE_MECHANISMS: readonly FailureMechanism[] =
  Object.freeze(['surface', 'budget', 'gate', 'measurement', 'command', 'effect']);

/** How many distinct instances a pattern must span to read as systematic. */
export const SYSTEMATIC_THRESHOLD = 2;

/**
 * Which mechanism a reason indicts. No default branch: adding a reason
 * fails to compile here rather than being silently filed under something.
 */
export function mechanismOf(reason: DecisionReason): FailureMechanism | null {
  switch (reason) {
    case 'goalpost':
    case 'escape':
      return 'surface';
    case 'over-budget':
      return 'budget';
    case 'red':
    case 'ambiguous':
      return 'gate';
    case 'equal':
    case 'regression':
    case 'unverifiable':
      return 'measurement';
    case 'command':
      return 'command';
    case 'uncertain-effect':
      return 'effect';
    case 'improved':
      // The one reason that is not a failure at all.
      return null;
  }
}

/** One failure, reduced to what makes it comparable with other failures. */
export interface FailureRecord {
  instanceId: string;
  /** What produced it — the strategy. Several instances may share one. */
  cohortId: string;
  decision: Decision;
  reason: DecisionReason;
  code: EvolveCode | null;
  mechanism: FailureMechanism;
}

/** The decided row shape this layer reads. Structural, so any caller fits. */
export interface DecidedRow {
  proposalId: string;
  strategyId: string;
  state: string;
  actual: { decision: Decision, reason: DecisionReason, code: EvolveCode | null } | null;
}

/** A failure record for one decided row, or null when it did not fail. */
export function failureRecordOf(row: DecidedRow): FailureRecord | null {
  if (row.state !== 'run' || row.actual === null) return null;
  if (row.actual.decision === 'kept') return null;
  const mechanism = mechanismOf(row.actual.reason);
  if (mechanism === null) return null;
  return {
    instanceId: row.proposalId,
    cohortId: row.strategyId,
    decision: row.actual.decision,
    reason: row.actual.reason,
    code: row.actual.code,
    mechanism,
  };
}

export interface FailurePattern {
  /** What the group is keyed on, and the key's value. */
  key: 'mechanism' | 'reason';
  name: string;
  mechanism: FailureMechanism;
  /** Distinct instances, sorted. Its size is what the threshold reads. */
  instances: string[];
  /** Distinct cohorts, sorted. Breadth across producers, reported not gated. */
  cohorts: string[];
  failures: number;
  evidence: 'systematic' | 'incidental';
}

const sorted = (values: Iterable<string>): string[] =>
  [...new Set(values)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * Group failures into patterns and mark each one. Deterministic: the
 * groups, their members and their order are a function of the records
 * alone, so two runs over the same rows publish the same bytes.
 */
export function groupFailures(
  records: readonly FailureRecord[],
  key: 'mechanism' | 'reason',
): FailurePattern[] {
  const groups = new Map<string, FailureRecord[]>();
  for (const record of records) {
    const name = key === 'mechanism' ? record.mechanism : record.reason;
    const held = groups.get(name);
    if (held === undefined) groups.set(name, [record]);
    else held.push(record);
  }

  return [...groups.entries()]
    .map(([name, members]): FailurePattern => {
      const instances = sorted(members.map(one => one.instanceId));
      return {
        key,
        name,
        mechanism: members[0].mechanism,
        instances,
        cohorts: sorted(members.map(one => one.cohortId)),
        failures: members.length,
        // The whole rule, in one comparison: recurrence across distinct
        // instances is what separates evidence about the mechanism from
        // evidence about one proposal.
        evidence: instances.length >= SYSTEMATIC_THRESHOLD ? 'systematic' : 'incidental',
      };
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** What one round of verdicts amounts to. */
export interface AggregateEvidence {
  failures: number;
  /** Failures belonging to a pattern that recurs across distinct instances. */
  systematic: number;
  incidental: number;
  /**
   * The share of failure evidence that would license a mechanism-level
   * repair. Not an accommodation ratio — nothing here modifies anything —
   * but the quantity that one is computed against once something does.
   */
  systematicRatio: number;
  /** Coarse view: which stage the failures came from. */
  mechanisms: FailurePattern[];
  /** Fine view: which named reason. */
  reasons: FailurePattern[];
}

export function aggregateFailures(rows: readonly DecidedRow[]): AggregateEvidence {
  const records = rows.map(failureRecordOf).filter((one): one is FailureRecord => one !== null);
  const mechanisms = groupFailures(records, 'mechanism');
  const reasons = groupFailures(records, 'reason');

  // Counted over the coarse view, so a failure is counted exactly once.
  let systematic = 0;
  for (const pattern of mechanisms) {
    if (pattern.evidence === 'systematic') systematic += pattern.failures;
  }
  const failures = records.length;

  return {
    failures,
    systematic,
    incidental: failures - systematic,
    // A round with no failures has no evidence either way, and says 0
    // rather than dividing by nothing.
    systematicRatio: failures === 0 ? 0 : systematic / failures,
    mechanisms,
    reasons,
  };
}

/** One scalar for a round — what a candidate mechanism has to beat. */
export interface RoundScore {
  attempted: number;
  kept: number;
  /** Kept over attempted. A round nobody attempted scores zero. */
  value: number;
}

export function roundScore(rows: readonly DecidedRow[]): RoundScore {
  const decided = rows.filter(row => row.state === 'run' && row.actual !== null);
  const kept = decided.filter(row => row.actual?.decision === 'kept').length;
  return {
    attempted: decided.length,
    kept,
    value: decided.length === 0 ? 0 : kept / decided.length,
  };
}

/**
 * Accept a candidate only on a STRICT improvement of the whole round.
 *
 * Per-instance acceptance is what lets a change that fixes one case and
 * quietly breaks two others survive; requiring the aggregate to improve is
 * what stops it. A tie is rejected on purpose — equal evidence is not a
 * reason to move, and keeping the incumbent is always the cheaper error.
 *
 * Two rounds that answered a DIFFERENT number of experiments are rejected
 * before the score is read at all, because they are not comparable. `value`
 * is kept over attempted and an experiment that never ran is not an attempt,
 * so the count moves the ratio on its own, in both directions: a candidate
 * that broke on the fifteen hard proposals and kept the one easy one scores
 * 1/1 against an incumbent's 1/16, and a candidate that bolts ten trivial
 * proposals onto the round scores 11/26 against the same incumbent. Both win
 * without fixing anything. That is the goalpost move this package refuses at
 * the surface, arriving through the scoreboard instead of through a patch,
 * and it is refused here on the same grounds: a score is evidence only while
 * it is answering the same question. The registration is immutable, so two
 * legitimate rounds over it always attempt the same count — an inequality
 * means something changed that the score cannot see, and the incumbent
 * stands.
 */
export function compareRounds(previous: RoundScore, candidate: RoundScore): 'accept' | 'reject' {
  if (candidate.attempted !== previous.attempted) return 'reject';
  return candidate.value > previous.value ? 'accept' : 'reject';
}
