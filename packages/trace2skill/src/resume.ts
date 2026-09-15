/**
 * Resume: the same drive, over what the store already holds.
 *
 * There is no second algorithm here, and deliberately so — a resume that
 * replanned would be a different run wearing the first one's id. A resumed
 * pass re-reads the stored run record and drives the same stages, and every
 * expensive unit reuses its stored result only when its key matches exactly.
 * A key covers the run, the stage, the unit, the attempt, the frozen
 * directory, the tool manifest, the model identity and the prompt version, so
 * changing any of them produces new units rather than quietly reusing work
 * that answered a different question.
 */
import { trace2SkillIssue, trace2SkillRefuse, type Trace2SkillOutcome } from './errors.ts';
import { runTrace2Skill, type Trace2SkillRunDeps, type Trace2SkillRunResult } from './run.ts';
import type { EvolutionRun } from './contracts.gen.ts';

/** A stored unit may only be replayed under the key it was written with. */
export function assertUnitReuse(stored: { idempotencyKey: string }, key: string, at: string): Trace2SkillOutcome<null> {
  if (stored.idempotencyKey === key) return { valid: true, value: null };
  return trace2SkillRefuse<null>('TT2S1012', at,
    `a unit written under ${stored.idempotencyKey.slice(0, 12)}… cannot be reused under ${key.slice(0, 12)}…`);
}

/** The stored run record a resume continues, or a refusal naming what is missing. */
export async function storedRun(deps: Pick<Trace2SkillRunDeps, 'store' | 'snapshot'>, runId: string): Promise<Trace2SkillOutcome<EvolutionRun>> {
  const runs = await deps.store.listBy(deps.snapshot.bundle.scopeKey, 'runs');
  const found = runs.find(run => run.id === runId);
  if (found === undefined) {
    return trace2SkillRefuse<EvolutionRun>('TT2S1012', `/runs/${runId}`, 'no run record is stored under this address in this scope');
  }
  if (found.s0Hash !== deps.snapshot.bundle.id) {
    return trace2SkillRefuse<EvolutionRun>('TT2S1012', `/runs/${runId}`, 'the stored run pinned another frozen directory');
  }
  return { valid: true, value: found };
}

/**
 * Continue an interrupted run. Everything already stored under a matching key
 * is replayed without a call; only what is missing is dispatched.
 */
export async function resumeRun(runId: string, deps: Trace2SkillRunDeps): Promise<Trace2SkillOutcome<Trace2SkillRunResult>> {
  const run = await storedRun(deps, runId);
  if (!run.valid) return run;
  return { valid: true, value: await runTrace2Skill(run.value, deps) };
}

export interface ResumeCensus { stages: number, executed: number, idle: number, reused: number, calls: number, written: number, refused: number }

/** What a drive spent and what it replayed, as the numbers a report publishes. */
export function resumeCensus(result: Trace2SkillRunResult): ResumeCensus {
  return {
    stages: result.stages.length,
    executed: result.stages.filter(receipt => receipt.executed).length,
    idle: result.stages.filter(receipt => !receipt.executed).length,
    reused: result.counts.reused,
    calls: result.counts.calls,
    written: result.counts.written,
    refused: result.counts.refused,
  };
}

/** A resumed drive that spent anything is not a resume of a finished run. */
export function refuseRepeatedWork(census: ResumeCensus, at = '/resume'): Trace2SkillOutcome<null> {
  if (census.calls === 0 && census.written === 0) return { valid: true, value: null };
  return {
    valid: false,
    issues: [trace2SkillIssue('TT2S1012', at, `a resumed drive spent ${census.calls} call(s) and wrote ${census.written} row(s)`)],
  };
}
