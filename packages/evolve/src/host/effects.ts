/**
 * The executor, the classifier and the authorization the suite's fence calls.
 *
 * Three rules carry the safety of this file.
 *
 * `execute` must await `beforeDispatch()` and do nothing when it answers
 * false. That call is what writes the INTENT before anything happens
 * outside the process — skip it and a crash mid-effect becomes an event
 * with no record, which is precisely the failure the fence exists to
 * prevent. It also never throws: the fence swallows a thrown cause and
 * records `unresolved`, so a refusal that could have been specific would
 * arrive as "something went wrong".
 *
 * `classifyEffect` reads exit codes and structured values only. It never
 * parses stdout text to decide whether an effect happened, because a
 * child that can print can print anything, including a convincing success.
 *
 * `authorizeEffect` re-checks the plan at both phases rather than trusting
 * the one made at preparation: `resume` runs after a crash, and the world
 * may have changed while nobody was looking.
 */

import { refuseOne, ok, type EvolveOutcome } from '../errors.ts';
import { validateGitArgs, refuseProtectedRef } from './git-allow.ts';
import type { ProcessRunner, RunResult } from './runner.ts';
import type { WorktreeHost } from './worktree.ts';

/** What a leg asks for: one command, or one worktree operation. */
export type EffectRequest =
  | { safety: 'single-send' | 'safe-read', command: { name: string, args: string[], cwd: string } }
  | { safety: 'single-send' | 'safe-read', worktree: { op: 'create' | 'write-files' | 'commit' | 'remove', input: Record<string, unknown> } };

export interface EffectResponse {
  state: 'ok' | 'refused' | 'unresolved';
  response?: unknown;
  reason?: string;
}

export interface EffectExecutorOptions {
  runner: ProcessRunner;
  host: WorktreeHost;
}

export interface DispatchContext {
  signal: AbortSignal;
  budget: { take: () => boolean, safety: string };
  beforeDispatch: () => Promise<boolean>;
}

export function createEffectExecutor(options: EffectExecutorOptions) {
  const { runner, host } = options;

  return {
    async execute(request: EffectRequest, context: DispatchContext): Promise<EffectResponse> {
      // The intent is persisted here, before anything reaches the world.
      const admitted = await context.beforeDispatch();
      if (!admitted) return { state: 'refused', reason: 'not-admitted' };
      if (!context.budget.take()) return { state: 'refused', reason: 'budget' };

      try {
        if ('command' in request) {
          const result = await runner.run({
            name: request.command.name,
            args: request.command.args,
            cwd: request.command.cwd,
            signal: context.signal,
          });
          // A runner refusal travels INSIDE the response: it is a thing that
          // was decided, not a transport failure that lost the answer.
          return { state: 'ok', response: result };
        }

        const { op, input } = request.worktree;
        let result: EvolveOutcome<unknown>;
        switch (op) {
          case 'create':
            result = await host.create(input as { experimentId: string, baseRevision: string });
            break;
          case 'write-files':
            result = await host.writeFiles(input.path as string, input.plan as Record<string, string | null>);
            break;
          case 'commit':
            result = await host.commit(input.path as string, input as unknown as { experimentId: string, message: string });
            break;
          case 'remove':
            result = await host.remove(input.path as string, { deleteBranch: input.deleteBranch === true });
            break;
          default:
            return { state: 'ok', response: refuseOne('TEVO1006', '/worktree/op', 'Unknown worktree operation.') };
        }
        return { state: 'ok', response: result };
      }
      catch (error) {
        // Reaching here means a defect, not content. It is reported as
        // unresolved rather than thrown, so the fence records it as an
        // effect whose outcome nobody knows — which is the truth.
        return { state: 'unresolved', reason: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

export interface ClassifiedEffect {
  state: 'confirmed' | 'rejected';
  evidence: Record<string, unknown>;
}

/**
 * Whether the effect happened, read from structure alone. Stdout text is
 * never consulted: a child that can print can print a convincing success.
 */
export function classifyEffect(response: EffectResponse, planned: { id?: string } = {}): ClassifiedEffect {
  const value = response.response as EvolveOutcome<RunResult> | undefined;
  if (value === undefined || typeof value !== 'object') {
    return { state: 'rejected', evidence: { leg: planned.id ?? null, reason: 'no-response' } };
  }
  if (!value.ok) {
    return { state: 'rejected', evidence: { leg: planned.id ?? null, code: value.issues[0]?.code ?? null, reason: 'refused' } };
  }
  const run = value.value as Partial<RunResult>;
  if (typeof run === 'object' && run !== null && Object.hasOwn(run, 'exitCode')) {
    const green = run.exitCode === 0;
    return {
      state: green ? 'confirmed' : 'rejected',
      evidence: {
        leg: planned.id ?? null,
        exitCode: run.exitCode ?? null,
        signal: run.signal ?? null,
        truncated: run.truncated ?? { stdout: false, stderr: false },
      },
    };
  }
  // A host call that answered `ok` succeeded; there is no exit code to read.
  return { state: 'confirmed', evidence: { leg: planned.id ?? null, host: true } };
}

export interface AuthorizeOptions {
  never: ReadonlySet<string>;
  allowedCommands: readonly string[];
}

/**
 * Re-check the plan at every phase. `dispatch` and `resume` are different
 * moments, and a plan that was safe at preparation is not self-evidently
 * safe after a crash.
 */
export function authorizeEffect(plan: { legs?: Array<{ request?: EffectRequest }> }, options: AuthorizeOptions): boolean {
  const legs = plan.legs ?? [];
  if (legs.length === 0) return false;
  for (const leg of legs) {
    const request = leg.request;
    if (request === undefined) return false;
    if ('command' in request) {
      if (!options.allowedCommands.includes(request.command.name)) return false;
      if (request.command.name === 'git') {
        if (!validateGitArgs(request.command.args).ok) return false;
        if (!refuseProtectedRef(request.command.args, options.never).ok) return false;
      }
    }
  }
  return true;
}

/** The refusal an unresolved leg becomes, once the fence has recorded it. */
export function unresolvedRefusal(legId: string): EvolveOutcome<never> {
  return refuseOne('TEVO1009', '/legs/' + legId,
    'The effect leg ' + legId + ' is unresolved; a person reconciles it before anything else runs.');
}

export { ok };
