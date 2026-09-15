/**
 * What an experiment MEANT, recorded through the outcome lifecycle.
 *
 * This module runs four commands — create, resolve, score, project — and
 * constructs nothing of its own. In particular it never builds an outcome
 * service: the service carries the scope, the principal, the adapters and
 * the memory authorization, and a module that built its own could quietly
 * grant itself a different one.
 *
 * The evidence is the sealed decision RECORD, and it reaches the service
 * the way every other piece of evidence does: as a `Source` the trusted
 * resolver supplies, pinned by digest, bound to the outcome decision it
 * was observed for. A citation the evolve store cannot produce resolves
 * to nothing, and an unresolvable citation is a refusal rather than an
 * empty source — which is what stops an experiment scoring itself on
 * evidence nobody holds.
 *
 * Confidence moves here and nowhere else. `projectOutcomeConfidence` runs
 * inside the service's own transaction, against the memory carrier the
 * decision cited; a carrier that is missing is reported as `missing` and
 * raised as `TEVO1011`, never created on the way past. Nothing in this
 * package writes a confidence number directly.
 *
 * Promotion is deliberately not taken. No `evaluate`, `approve` or
 * `promote` runs in this campaign, the selection artifact keeps empty
 * weights, and the automation principal cannot approve even if something
 * asked it to.
 *
 * No clock. The four timestamps are derived from one registered epoch the
 * caller supplies, so the same experiment recorded twice produces the same
 * records and the second run writes nothing.
 */

import { outcomeRevision } from '@tangleai/outcomes';

import { refuseOne, ok, type EvolveOutcome } from './errors.ts';
import type { EvolveDecision, EvolveMeasurement, Direction } from './contracts.gen.ts';

/** The four commands this module uses, structurally, so a stub fits. */
export interface OutcomeServiceLike {
  scopeId: string;
  create(raw: unknown): Promise<OutcomeResult>;
  resolve(raw: unknown): Promise<OutcomeResult>;
  score(raw: unknown): Promise<OutcomeResult>;
  project(raw: unknown): Promise<OutcomeResult>;
}

export interface OutcomeResult {
  ok: boolean;
  writes?: number;
  replayed?: boolean;
  value?: unknown;
  error?: unknown;
}

/**
 * The evidence snapshot the outcome service verifies. Spelled out rather
 * than loosened to a record, so it stays assignable to the `Source` the
 * service's own resolver signature expects.
 */
export interface EvolveEvidenceSource {
  sourceId: string;
  scopeId: string;
  subject: string;
  decisionId: string;
  issuer: string;
  observedAt: string;
  payload: { decision: string, reason: string, delta: number | null, decisionRecordId: string };
  digest: string;
}

/** A source the resolver can supply, keyed by the evolve record id it names. */
export interface SourceRegistry {
  set(sourceId: string, source: EvolveEvidenceSource): void;
  get(sourceId: string): EvolveEvidenceSource | undefined;
}

export const createSourceRegistry = (): SourceRegistry => new Map<string, EvolveEvidenceSource>();

/** The evolve records a resolver will answer for. */
export interface EvolveRecordReader {
  getRecord(id: string): Promise<EvolveOutcome<{ kind: string } | null>>;
}

/**
 * The trusted resolver the service is constructed with. A reference is
 * answered only when the evolve store really holds a DECISION under that
 * id and a source was registered for it; anything else answers `undefined`,
 * which the service reads as OUTC1006 rather than as empty evidence.
 */
export function resolveEvolveEvidence(store: EvolveRecordReader, registry: SourceRegistry) {
  return async function resolve(reference: { sourceId: string }): Promise<EvolveEvidenceSource | undefined> {
    const sourceId = typeof reference?.sourceId === 'string' ? reference.sourceId : null;
    if (sourceId === null) return undefined;
    const held = await store.getRecord(sourceId).catch(() => null);
    if (held === null || !held.ok || held.value === null || held.value.kind !== 'decision') return undefined;
    return registry.get(sourceId);
  };
}

export interface RecordOutcomeOptions {
  service: OutcomeServiceLike;
  registry: SourceRegistry;
  experiment: { experimentId: string, strategyId: string, baseRevision: string };
  /** The sealed decision. Its id is the evidence citation. */
  decision: EvolveDecision;
  /** Absent for a run that never measured; its delta is then null. */
  measurement: EvolveMeasurement | null;
  strategy: { memoryId: string };
  configuration: { kind: 'scripted', revision: string } | { kind: 'model', identityId: string };
  metric: { name: string, direction: Direction };
  adapter: { id: string } & Record<string, unknown>;
  /** One registered constant; the four command times are derived from it. */
  epoch: string;
  artifactKey?: string;
}

export interface RecordedOutcome {
  decisionId: string;
  resolutionId: string;
  scoreId: string;
  projectionReceiptId: string;
  writes: number;
  /** How many cited carriers the projection could not find. */
  missing: number;
}

/** The four command times, one second apart, from one registered epoch. */
export function outcomeChronology(epoch: string): {
  decided: string, resolved: string, scored: string, projected: string,
} {
  const base = Date.parse(epoch);
  const step = (seconds: number): string => new Date(base + seconds * 1000).toISOString();
  return { decided: step(0), resolved: step(1), scored: step(2), projected: step(3) };
}

/** The refusal an outcome command becomes, with the service's own error kept. */
function bindingRefusal<T>(what: string, result: OutcomeResult): EvolveOutcome<T> {
  const error = result.error as { code?: string, message?: string, detail?: string } | undefined;
  return refuseOne<T>('TEVO1011', '/' + what,
    'The outcome service refused the ' + what + ' command.', {
      code: typeof error?.code === 'string' ? error.code : 'OUTC1010',
      docPath: '/' + what,
      message: typeof error?.message === 'string'
        ? error.message
        : (typeof error?.detail === 'string' ? error.detail : JSON.stringify(result.error ?? result.value ?? null)),
    });
}

const field = (result: OutcomeResult, name: string): string | null => {
  const value = (result.value ?? {}) as Record<string, unknown>;
  return typeof value[name] === 'string' ? value[name] : null;
};

export async function recordExperimentOutcome(
  options: RecordOutcomeOptions,
): Promise<EvolveOutcome<RecordedOutcome>> {
  const { service, registry, experiment, decision, measurement, strategy, metric } = options;
  const artifactKey = options.artifactKey ?? 'strategy-selection';
  const scopeId = service.scopeId;
  const times = outcomeChronology(options.epoch);
  let writes = 0;

  const command = (requestKey: string, at: string, input: Record<string, unknown>) =>
    ({ scopeId, artifactKey, requestKey: experiment.experimentId + ':' + requestKey, at, input });

  // 1. create — the decision, as the experiment's own prediction.
  const created = await service.create(command('create', times.decided, {
    decisionKey: experiment.experimentId,
    adapter: options.adapter,
    input: {
      experimentId: experiment.experimentId,
      strategyId: experiment.strategyId,
      baseRevision: experiment.baseRevision,
      metric: metric.name,
      direction: metric.direction,
    },
    output: { predicted: 'improve' },
    decidedAt: times.decided,
    cutoffAt: times.decided,
    expectedResolutionAt: times.resolved,
    memoryIds: [strategy.memoryId],
    configuration: options.configuration,
    // No selection artifact is checked out, so the service's reproduction
    // guard is not engaged — and must not be, because nothing here chose
    // the proposal from a checked policy.
    usedVersionId: null,
    staticPayload: { weights: {}, version: 1 },
  }));
  if (!created.ok) return bindingRefusal<RecordedOutcome>('create', created);
  writes += created.writes ?? 0;
  const decisionId = field(created, 'decisionId');
  if (decisionId === null) {
    return refuseOne<RecordedOutcome>('TEVO1011', '/create', 'The create command answered no decision id.');
  }

  // 2. resolve — the sealed evolve decision, as a pinned source. The
  //    source is bound to the outcome decision it was observed for, so it
  //    cannot be replayed against a different one.
  const bytes = {
    sourceId: decision.id,
    decisionId,
    scopeId,
    subject: experiment.experimentId,
    issuer: 'evolve-automation',
    observedAt: times.decided,
    payload: {
      decision: decision.decision,
      reason: decision.reason,
      // A run that never measured has no delta, and says so rather than
      // reporting a zero somebody could read as "no change".
      delta: measurement === null ? null : measurement.delta,
      decisionRecordId: decision.id,
    },
  };
  registry.set(decision.id, { ...bytes, digest: await outcomeRevision(bytes) });

  const resolved = await service.resolve(command('resolve', times.resolved, {
    decisionId,
    evidence: [{ sourceId: decision.id, digest: registry.get(decision.id)!.digest }],
    receivedAt: times.resolved,
  }));
  if (!resolved.ok) return bindingRefusal<RecordedOutcome>('resolve', resolved);
  writes += resolved.writes ?? 0;
  const resolutionId = field(resolved, 'resolutionId');
  if (resolutionId === null) {
    return refuseOne<RecordedOutcome>('TEVO1011', '/resolve', 'The resolve command answered no resolution id.');
  }

  // 3. score — the adapter maps the decision to success, partial or failure.
  const scored = await service.score(command('score', times.scored, { resolutionId }));
  if (!scored.ok) return bindingRefusal<RecordedOutcome>('score', scored);
  writes += scored.writes ?? 0;
  const scoreId = field(scored, 'scoreId');
  if (scoreId === null) {
    return refuseOne<RecordedOutcome>('TEVO1011', '/score', 'The score command answered no score id.');
  }

  // 4. project — the carrier's confidence moves, inside the service's own
  //    transaction. A carrier that is not there is reported, never created.
  const projected = await service.project(command('project', times.projected, { scoreId }));
  if (!projected.ok) return bindingRefusal<RecordedOutcome>('project', projected);
  writes += projected.writes ?? 0;
  const projectionReceiptId = field(projected, 'projectionReceiptId');
  if (projectionReceiptId === null) {
    return refuseOne<RecordedOutcome>('TEVO1011', '/project', 'The project command answered no projection receipt.');
  }

  const receipt = (projected.value ?? {}) as { missing?: unknown };
  const missing = typeof receipt.missing === 'number' ? receipt.missing : 0;
  if (missing > 0) {
    return refuseOne<RecordedOutcome>('TEVO1011', '/project/memoryIds',
      'The projection could not find ' + missing + ' cited carrier(s); confidence moved for none of them.');
  }

  return ok({ decisionId, resolutionId, scoreId, projectionReceiptId, writes, missing });
}
