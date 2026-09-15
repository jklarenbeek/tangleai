/**
 * What a leg proved, and what it merely printed.
 *
 * Two things have to come out of one effect leg and they must not be
 * confused. The STATE — did this happen, did it pass — is read from
 * structure alone: an exit code, a signal, a refusal. The TEXT a child
 * wrote is evidence for a person, not for the mechanism, so it never
 * decides anything and never enters an identity.
 *
 * The classifier is the one place holding both the leg's identity and the
 * runner's answer, so it is where both are captured. The structural facts
 * go into the effect record's evidence, where they are durable and replay
 * with the record after a crash. The text goes into a transcript beside
 * the record, which is deliberately NOT hashed and deliberately empty
 * after a replay: a review bundle's captured output is a convenience, and
 * the record is the truth.
 *
 * A sample is the one exception, and it is not an exception to the rule
 * above. A leg named `<side>-sample-<n>` runs the registered instrument,
 * whose output contract is part of the registration; the NUMBER it reports is
 * parsed into the evidence so a resumed experiment reads its measurement
 * instead of re-running it. The exit code still decides whether the leg
 * passed — a sample never promotes a failed run into a confirmed one.
 */

import { classifyEffect, type ClassifiedEffect, type EffectResponse } from './effects.ts';
import { parseSample } from '../fitness.ts';
import type { RunResult } from './runner.ts';
import type { EvolveOutcome } from '../errors.ts';

/** The text one leg produced. Never hashed, never an input to a decision. */
export interface LegTranscript {
  legId: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  truncated: { stdout: boolean, stderr: boolean };
}

export type Transcript = Map<string, LegTranscript>;

export const createTranscript = (): Transcript => new Map<string, LegTranscript>();

/**
 * The leg ids whose stdout carries a registered sample. The side is part of
 * the id so the two batches cannot collide in one transcript — and so a
 * reviewer reading a captured line can tell which side produced it.
 */
export const SAMPLE_LEG = /^(base|candidate)-sample-(\d+)$/;

export interface EvolveClassifierOptions {
  transcript: Transcript;
  /** The repository's registered instrument metric, when one is registered. */
  metric?: { name: string };
}

/**
 * The classifier every evolve effect uses. It delegates the verdict to the
 * structural classifier and adds exactly two things: the transcript entry,
 * and — for a sample leg — the parsed number.
 */
export function createEvolveClassifier(options: EvolveClassifierOptions) {
  const { transcript, metric } = options;

  return function classify(response: EffectResponse, planned: { id?: string } = {}): ClassifiedEffect {
    const verdict = classifyEffect(response, planned);
    const legId = planned.id ?? '';
    const held = response.response as EvolveOutcome<RunResult> | undefined;

    // A refused run produced no result to read, so the only durable fact
    // about it is WHICH budget it broke. Without the pointers a record can
    // say "over-budget" but never say why, and a reviewer needs the why.
    if (held !== undefined && typeof held === 'object' && held.ok === false) {
      return {
        state: verdict.state,
        evidence: { ...verdict.evidence, budgets: held.issues.map(issue => issue.path) },
      };
    }

    if (held !== undefined && typeof held === 'object' && held.ok === true
      && typeof held.value === 'object' && held.value !== null && Object.hasOwn(held.value, 'exitCode')) {
      const run = held.value as RunResult;
      transcript.set(legId, {
        legId,
        stdout: run.stdout,
        stderr: run.stderr,
        exitCode: run.exitCode,
        signal: run.signal,
        truncated: run.truncated,
      });

      // Byte counts are structure, not text: they belong in the record, so a
      // replayed leg can still say how much a child wrote.
      const counted = {
        ...verdict.evidence,
        stdoutBytes: Buffer.byteLength(run.stdout, 'utf8'),
        stderrBytes: Buffer.byteLength(run.stderr, 'utf8'),
      };

      const sampleLeg = metric === undefined ? null : SAMPLE_LEG.exec(legId);
      if (metric !== undefined && sampleLeg !== null) {
        const index = Number(sampleLeg[2]);
        const sample = parseSample(run.stdout, metric, index);
        // Recorded either way: a sample nobody could read is a counted
        // refusal, and counting it is what makes the run unverifiable
        // rather than quietly shorter.
        return {
          state: verdict.state,
          evidence: sample.ok
            ? { ...counted, sample: sample.value.value }
            : { ...counted, sample: null, sampleRefused: sample.issues[0]?.detail ?? 'unreadable' },
        };
      }
      return { state: verdict.state, evidence: counted };
    }

    return verdict;
  };
}

/** The sample a settled leg recorded, or null when it had none to record. */
export function sampleOf(leg: { evidence?: unknown }): number | null {
  const evidence = leg.evidence as { sample?: unknown } | undefined;
  if (evidence === undefined || evidence === null) return null;
  return typeof evidence.sample === 'number' ? evidence.sample : null;
}
