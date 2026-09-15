/**
 * Fitness: what the registered instrument said, and whether to believe it.
 *
 * The drift check is the load-bearing idea. Before any candidate number
 * means anything, the BASE must still measure what the registration says it
 * measures. If it does not, the instrument, the fixture or the machine has
 * moved, and every number in the run — including a flattering one — is
 * unverifiable. That check is why a candidate median is evidence rather
 * than a reading.
 *
 * A refused sample is a counted value, never a retry. Re-running a sample
 * until it parses is how a measurement quietly becomes a search for the
 * answer you wanted.
 */

import { median } from '@jarenjs/core/stats';

import { evolveIssue, refuse, ok, type EvolveIssue, type EvolveOutcome } from './errors.ts';
import type { Direction } from './contracts.gen.ts';

export interface Sample {
  metric: string;
  value: number;
}

export interface SampleSet {
  samples: number[];
  median: number;
}

export type FitnessComparison = 'improved' | 'equal' | 'regression' | 'unverifiable';

export interface CompareInput {
  base: SampleSet;
  candidate: SampleSet;
  truth: number;
  direction: Direction;
  minDelta?: number;
  /** How many samples were refused on either side. Any refusal is unverifiable. */
  refused?: number;
}

export interface Comparison {
  comparison: FitnessComparison;
  /** Movement in the direction's sign: positive is better, always. */
  delta: number;
}

/**
 * Read one sample from an instrument's stdout: the LAST non-empty line,
 * parsed and checked against the registered metric. Taking the last line
 * means an instrument may log freely above its result.
 */
export function parseSample(
  stdout: string,
  metric: { name: string },
  index = 0,
): EvolveOutcome<Sample> {
  const path = '/samples/' + index;
  const lines = stdout.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  if (lines.length === 0) return refuse<Sample>([evolveIssue('TEVO1008', path, 'The instrument printed nothing to read.')]);

  let parsed: unknown;
  try {
    parsed = JSON.parse(lines[lines.length - 1]);
  }
  catch {
    return refuse<Sample>([evolveIssue('TEVO1008', path, 'The instrument’s last line is not JSON.')]);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return refuse<Sample>([evolveIssue('TEVO1008', path, 'A sample is a JSON object.')]);
  }
  const sample = parsed as { metric?: unknown, value?: unknown };
  if (sample.metric !== metric.name) {
    return refuse<Sample>([evolveIssue('TEVO1008', path,
      'The sample reports ' + String(sample.metric) + ', not the registered ' + metric.name + '.')]);
  }
  if (typeof sample.value !== 'number' || !Number.isFinite(sample.value)) {
    return refuse<Sample>([evolveIssue('TEVO1008', path, 'A sample value must be a finite number.')]);
  }
  return ok({ metric: metric.name, value: sample.value });
}

/** The median of a sample batch, through the suite's own statistic. */
export function summarize(samples: readonly number[]): EvolveOutcome<SampleSet> {
  if (samples.length === 0) {
    return refuse<SampleSet>([evolveIssue('TEVO1008', '/samples', 'A side with no samples measures nothing.')]);
  }
  const value = median([...samples]);
  if (value === undefined || !Number.isFinite(value)) {
    return refuse<SampleSet>([evolveIssue('TEVO1008', '/samples', 'The median is not a finite number.')]);
  }
  return ok({ samples: [...samples], median: value });
}

/**
 * Compare a candidate against its base. `improved` requires strict movement
 * in the registered direction by at least `minDelta`; a tie is `equal`,
 * never a generous `improved`.
 */
export function compareFitness(input: CompareInput): Comparison {
  const minDelta = input.minDelta ?? 0;
  const sign = input.direction === 'lower' ? -1 : 1;
  // Positive delta always means better, whichever way the metric points.
  // The `+ 0` normalizes negative zero: a tie on a `lower` metric would
  // otherwise be -0, which is not `Object.is`-equal to 0 and would make a
  // dead-even result read as a different number from the one it is.
  const delta = (input.candidate.median - input.base.median) * sign + 0;

  if ((input.refused ?? 0) > 0) return { comparison: 'unverifiable', delta };
  // The drift check: a base that no longer measures what was registered
  // makes every number in this run meaningless, flattering ones included.
  if (input.base.median !== input.truth) return { comparison: 'unverifiable', delta };

  if (delta > 0 && delta >= minDelta) return { comparison: 'improved', delta };
  if (delta === 0) return { comparison: 'equal', delta };
  if (delta > 0) return { comparison: 'equal', delta };
  return { comparison: 'regression', delta };
}

/** Collect a batch of raw stdout strings into samples, counting refusals. */
export function collectSamples(
  outputs: readonly string[],
  metric: { name: string },
): { values: number[], refused: number, issues: EvolveIssue[] } {
  const values: number[] = [];
  const issues: EvolveIssue[] = [];
  for (const [index, stdout] of outputs.entries()) {
    const sample = parseSample(stdout, metric, index);
    if (sample.ok) values.push(sample.value.value);
    else issues.push(...sample.issues);
  }
  return { values, refused: issues.length, issues };
}
