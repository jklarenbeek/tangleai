/**
 * Measurement: N samples on the base, N on the candidate, and the guard
 * that makes the pair comparable.
 *
 * `cwd: 'base'` is the repository root — the same directory `'repository'`
 * resolves to, under a separate allow-list name so that running the
 * instrument against the base is a DIFFERENT command from running it
 * against the candidate, and neither can be mistaken for the other. No
 * second worktree is created for it: a detached worktree would be a write
 * target the vocabulary cannot name.
 *
 * Running anything in the operator's own root is the most dangerous thing
 * this campaign does, so it is bracketed. Before and after every sample
 * batch the root must still answer the registered base revision on a clean
 * tree, and its tracked digest must be byte-identical. An instrument that
 * writes into the base has invalidated every number in the run — including
 * the ones already taken — so the refusal is `TEVO1003` and the experiment
 * becomes uncertain rather than merely unmeasured.
 *
 * The samples themselves are read back from the effect record, not from
 * the transcript. That is what lets a resumed experiment reproduce its
 * measurement without spawning anything: the number a leg reported is part
 * of what the leg recorded, and a replay returns it.
 */

import { refuseOne, ok, evolveIssue, type EvolveIssue, type EvolveOutcome } from '../errors.ts';
import { sealRecord } from '../identity.ts';
import { summarize, compareFitness, type Comparison, type SampleSet } from '../fitness.ts';
import type { EvolveMeasurement, Direction } from '../contracts.gen.ts';
import type { EffectPlan } from './driver.ts';
import type { WorktreeHost } from './worktree.ts';
import type { Transcript, LegTranscript } from './classify.ts';
import { sampleOf } from './classify.ts';
import type { SettledLeg, GateDriver, GateEffectStore } from './gate.ts';

/** The candidate side's allow-list name: the instrument, in the worktree. */
export const INSTRUMENT_COMMAND = 'instrument';
/** The base side's allow-list name: the same instrument, in the repository root. */
export const BASE_INSTRUMENT_COMMAND = 'instrument-base';

export type MeasureSide = 'measure-base' | 'measure-candidate';

export interface MeasureOptions {
  driver: GateDriver;
  effects: GateEffectStore;
  host: WorktreeHost;
  experimentId: string;
  worktreePath: string;
  repositoryRoot: string;
  /** The repository record's registered instrument argv. */
  args: readonly string[];
  metric: { name: string, direction: Direction };
  /** How many samples each side takes. Bound to the effect store's leg cap. */
  samples: number;
  baseRevision: string;
  /** What the registration says the base measures. The drift check's anchor. */
  truth: number;
  minDelta?: number;
  transcript: Transcript;
}

export interface MeasureOutcome {
  record: EvolveMeasurement;
  comparison: Comparison['comparison'];
  delta: number;
  refused: number;
  /** For a reviewer; empty after a replay. */
  transcripts: LegTranscript[];
}

/** What the base root must still be, before and after every batch. */
interface BaseSeal {
  revision: string;
  digest: string;
}

/** One side's sample batch, prepared under its own semantic id. */
export function measurePlan(options: {
  experimentId: string, side: MeasureSide, name: string,
  args: readonly string[], cwd: string, samples: number,
}): EffectPlan {
  const id = options.experimentId + '/' + options.side;
  const prefix = options.side === 'measure-base' ? 'base' : 'candidate';
  return {
    id,
    jobId: id,
    kind: 'evolve-effect',
    actor: 'evolve-automation',
    reason: options.side,
    hashVersion: '1',
    legs: Array.from({ length: options.samples }, (_unused, index) => ({
      id: prefix + '-sample-' + index,
      request: {
        safety: 'single-send' as const,
        command: { name: options.name, args: [...options.args], cwd: options.cwd },
      },
      maxAttempts: 1,
    })),
  };
}

export async function measureFitness(options: MeasureOptions): Promise<EvolveOutcome<MeasureOutcome>> {
  const {
    driver, effects, host, experimentId, worktreePath, repositoryRoot,
    samples, baseRevision, truth, metric, transcript,
  } = options;

  if (!Number.isInteger(samples) || samples < 1) {
    return refuseOne<MeasureOutcome>('TEVO1001', '/budgets/samples',
      'A measurement takes at least one sample per side.');
  }

  /** The base root as it must stay: registered revision, clean, same bytes. */
  async function sealBase(): Promise<EvolveOutcome<BaseSeal>> {
    const inspected = await host.inspect();
    if (!inspected.ok) return inspected as EvolveOutcome<BaseSeal>;
    if (inspected.value.revision !== baseRevision) {
      return refuseOne<BaseSeal>('TEVO1003', '/base/revision',
        'The repository root is at ' + inspected.value.revision + ', not the registered base.');
    }
    const digest = await host.trackedDigest(repositoryRoot);
    if (!digest.ok) return digest as EvolveOutcome<BaseSeal>;
    return ok({ revision: inspected.value.revision, digest: digest.value });
  }

  const before = await sealBase();
  if (!before.ok) return before as EvolveOutcome<MeasureOutcome>;

  // The base side. Its legs run in the operator's own root, which is why
  // the seal brackets them.
  const basePlan = measurePlan({
    experimentId, side: 'measure-base', name: BASE_INSTRUMENT_COMMAND,
    args: options.args, cwd: repositoryRoot, samples,
  });
  const baseRun = await driver.run(basePlan);
  if (!baseRun.ok) return baseRun as EvolveOutcome<MeasureOutcome>;

  const after = await sealBase();
  if (!after.ok) return after as EvolveOutcome<MeasureOutcome>;
  if (after.value.revision !== before.value.revision || after.value.digest !== before.value.digest) {
    return refuseOne<MeasureOutcome>('TEVO1003', '/base',
      'The repository root changed while the instrument ran; every number in this run is void.');
  }

  const candidatePlan = measurePlan({
    experimentId, side: 'measure-candidate', name: INSTRUMENT_COMMAND,
    args: options.args, cwd: worktreePath, samples,
  });
  const candidateRun = await driver.run(candidatePlan);
  if (!candidateRun.ok) return candidateRun as EvolveOutcome<MeasureOutcome>;

  const readSide = async (planId: string, side: MeasureSide): Promise<{ values: number[], issues: EvolveIssue[] }> => {
    const held = await effects.get(planId).catch(() => null) as { legs?: SettledLeg[] } | null;
    const legs = held?.legs ?? [];
    const prefix = side === 'measure-base' ? 'base' : 'candidate';
    const values: number[] = [];
    const issues: EvolveIssue[] = [];
    for (let index = 0; index < samples; index++) {
      const leg = legs.find(one => one.id === prefix + '-sample-' + index);
      const value = leg === undefined ? null : sampleOf(leg);
      // A leg that did not pass contributes no number even if it printed
      // one: an instrument that failed has not measured anything.
      if (leg?.state === 'confirmed' && value !== null) values.push(value);
      else issues.push(evolveIssue('TEVO1008', '/' + side + '/samples/' + index,
        'Sample ' + index + ' of the ' + side + ' side was not readable.'));
    }
    return { values, issues };
  };

  const baseSide = await readSide(basePlan.id, 'measure-base');
  const candidateSide = await readSide(candidatePlan.id, 'measure-candidate');
  const refused = baseSide.issues.length + candidateSide.issues.length;

  const baseSummary = summarize(baseSide.values);
  const candidateSummary = summarize(candidateSide.values);
  if (!baseSummary.ok || !candidateSummary.ok) {
    // Nothing readable on a side: there is no measurement to record, and
    // the caller reads this as `unverifiable` rather than as a regression.
    return { ok: false, issues: [...baseSide.issues, ...candidateSide.issues] };
  }

  const comparison = compareFitness({
    base: baseSummary.value,
    candidate: candidateSummary.value,
    truth,
    direction: metric.direction,
    minDelta: options.minDelta,
    refused,
  });

  const record = await sealRecord<EvolveMeasurement>({
    schemaVersion: 1,
    kind: 'measurement',
    experimentId,
    metric: metric.name,
    direction: metric.direction,
    base: baseSummary.value as SampleSet,
    candidate: candidateSummary.value as SampleSet,
    truth,
    delta: comparison.delta,
    effectRecordIds: [basePlan.id, candidatePlan.id],
  });
  if (!record.ok) return record as EvolveOutcome<MeasureOutcome>;

  const transcripts = [...transcript.values()];
  return ok({
    record: record.value,
    comparison: comparison.comparison,
    delta: comparison.delta,
    refused,
    transcripts,
  });
}
