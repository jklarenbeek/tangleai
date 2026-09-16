/**
 * The target repository's own gate, run as a fenced effect.
 *
 * The distinction this module exists to keep is between a gate that
 * FAILED and a gate that never finished. A test run that exits non-zero
 * has reached a verdict about the change: that is `red`, and red earns the
 * single rerun the flake policy allows. A run killed at its deadline,
 * drowned in output, or refused before it started reached no verdict at
 * all — calling that `red` would credit the gate with an opinion it never
 * formed, and would spend the rerun budget on a command that cannot
 * finish. So every budget refusal is `over-budget`, and `over-budget`
 * earns no rerun.
 *
 * The exit code is the whole verdict (CONVENTIONS §2). Nothing here reads
 * what the gate printed: stdout and stderr are captured for a reviewer and
 * never parsed, never grepped, and never hashed into any identity.
 *
 * The workspace walk after a green gate is part of the gate, not an
 * afterthought. A change that passes its tests by writing a gigabyte into
 * the workspace has exceeded a budget the runner cannot see, because the
 * runner only watches the pipes.
 */

import { refuseOne, ok, type EvolveOutcome } from '../errors.ts';
import { sealRecord } from '../identity.ts';
import type { EvolveBudgets, EvolveGateResult } from '../contracts.gen.ts';
import type { GateVerdict } from '../decide.ts';
import type { EffectPlan, EffectRunResult } from './driver.ts';
import type { WorktreeHost } from './worktree.ts';
import type { Transcript } from './classify.ts';

/** The allow-list name a gate command is selected by. Never a path. */
export const GATE_COMMAND = 'gate';

export type GateLeg = 'gate' | 'gate-rerun';

/** The settled leg a gate operation leaves in the effect record. */
export interface SettledLeg {
  id: string;
  state: string;
  evidence?: Record<string, unknown>;
}

export interface GateDriver {
  run(plan: EffectPlan): Promise<EvolveOutcome<EffectRunResult>>;
}

export interface GateEffectStore {
  get(id: string): Promise<unknown>;
}

export interface RunGateOptions {
  driver: GateDriver;
  effects: GateEffectStore;
  host: WorktreeHost;
  experimentId: string;
  worktreePath: string;
  /** The repository record's registered gate argv. Fixed at registration. */
  args: readonly string[];
  budgets: EvolveBudgets;
  leg: GateLeg;
  transcript: Transcript;
}

export interface GateOutcome {
  verdict: GateVerdict;
  record: EvolveGateResult;
  /** For a reviewer. Absent after a replay, and never an input to anything. */
  stdout: string;
  stderr: string;
}

/**
 * The verdict one settled gate leg carries. Total over what the classifier
 * can record, and the only place a runner code becomes a gate verdict.
 */
export function gateVerdictOf(leg: SettledLeg): GateVerdict {
  const evidence = (leg.evidence ?? {}) as {
    code?: unknown, exitCode?: unknown, signal?: unknown,
    truncated?: { stdout?: boolean, stderr?: boolean },
  };

  // A refusal carries its code and no exit code: the command never ran to
  // completion, so there is nothing to call red.
  if (typeof evidence.code === 'string') {
    if (evidence.code === 'TEVO1005') return 'over-budget';
    return 'command-refused';
  }

  // Killed, or drowned. Both are budgets, both reached no verdict.
  if (typeof evidence.signal === 'string' && evidence.signal !== null) return 'over-budget';
  if (evidence.truncated?.stdout === true || evidence.truncated?.stderr === true) return 'over-budget';

  if (evidence.exitCode === 0) return 'green';
  if (typeof evidence.exitCode === 'number') return 'red';

  // A leg that settled with nothing readable is not a verdict either.
  return 'command-refused';
}

/** One gate leg, prepared under its own semantic id so a replay costs nothing. */
export function gatePlan(options: {
  experimentId: string, leg: GateLeg, args: readonly string[], worktreePath: string,
}): EffectPlan {
  const id = options.experimentId + '/' + options.leg;
  return {
    id,
    jobId: id,
    kind: 'evolve-effect',
    actor: 'evolve-automation',
    reason: options.leg,
    hashVersion: '1',
    legs: [{
      id: options.leg,
      request: {
        safety: 'single-send',
        command: { name: GATE_COMMAND, args: [...options.args], cwd: options.worktreePath },
      },
      // One attempt, enforced by the store. A second attempt would be a
      // retry the flake policy does not grant.
      maxAttempts: 1,
    }],
  };
}

/**
 * The readback half: what a settled gate leg means, with no process in it.
 *
 * Separated from `runGate` because the durable path does not own both
 * halves. There, a workflow task writes the intent and a worker in another
 * process runs it; the stage that reads the verdict runs later, against
 * the record alone, and must touch no job and spawn nothing. The
 * sequential path calls the two halves back to back and is unchanged.
 */
export async function readGateResult(
  options: Omit<RunGateOptions, 'driver' | 'args'>,
): Promise<EvolveOutcome<GateOutcome>> {
  const { effects, host, experimentId, worktreePath, budgets, leg, transcript } = options;
  const planId = experimentId + '/' + leg;

  const held = await effects.get(planId).catch(() => null) as { legs?: SettledLeg[] } | null;
  const settled = (held?.legs ?? []).find(one => one.id === leg);
  if (settled === undefined) {
    return refuseOne<GateOutcome>('TEVO1009', '/legs/' + leg,
      'The gate leg settled without a record; its outcome is unknown.');
  }

  let verdict = gateVerdictOf(settled);

  // The budget the runner cannot see. Only a gate that otherwise passed is
  // worth walking: a red gate is already decided.
  if (verdict === 'green') {
    const bytes = await host.workspaceBytes(worktreePath);
    if (bytes > budgets.workspaceBytes) verdict = 'over-budget';
  }

  const evidence = (settled.evidence ?? {}) as {
    exitCode?: unknown, signal?: unknown, stdoutBytes?: unknown, stderrBytes?: unknown,
    truncated?: { stdout?: boolean, stderr?: boolean }, budgets?: unknown,
  };
  const captured = transcript.get(leg);

  // A refused run has no result to read, only the budgets it broke. They
  // are reconstructed here so the record says WHICH one, not merely that
  // one was exceeded.
  const broke = Array.isArray(evidence.budgets) ? evidence.budgets as string[] : [];
  const killed = broke.includes('/budgets/legMs');
  const truncated = {
    stdout: evidence.truncated?.stdout === true || broke.includes('/budgets/stdoutBytes'),
    stderr: evidence.truncated?.stderr === true || broke.includes('/budgets/stderrBytes'),
  };

  const record = await sealRecord<EvolveGateResult>({
    schemaVersion: 1,
    kind: 'gate-result',
    experimentId,
    leg,
    exitCode: typeof evidence.exitCode === 'number' ? evidence.exitCode : null,
    signal: typeof evidence.signal === 'string' ? evidence.signal : (killed ? 'SIGKILL' : null),
    stdoutBytes: typeof evidence.stdoutBytes === 'number' ? evidence.stdoutBytes : 0,
    stderrBytes: typeof evidence.stderrBytes === 'number' ? evidence.stderrBytes : 0,
    truncated,
    effectRecordId: planId,
  });
  if (!record.ok) return record as EvolveOutcome<GateOutcome>;

  return ok({
    verdict,
    record: record.value,
    stdout: captured?.stdout ?? '',
    stderr: captured?.stderr ?? '',
  });
}

/** Both halves, back to back: the sequential path's gate stage. */
export async function runGate(options: RunGateOptions): Promise<EvolveOutcome<GateOutcome>> {
  const plan = gatePlan({
    experimentId: options.experimentId, leg: options.leg,
    args: options.args, worktreePath: options.worktreePath,
  });
  const run = await options.driver.run(plan);
  // An unresolved leg travels up as TEVO1009 unchanged: the gate did not
  // decide anything, and nothing below may pretend otherwise.
  if (!run.ok) return run as EvolveOutcome<GateOutcome>;
  return readGateResult(options);
}

/**
 * Whether a verdict earns the single rerun. Only red does — the whole
 * flake policy, in one total function nobody can widen by accident.
 */
export const earnsRerun = (verdict: GateVerdict): boolean => verdict === 'red';
