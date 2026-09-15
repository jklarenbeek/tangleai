/**
 * What a host must inject to execute an experiment, named once.
 *
 * A consumer that wants to run experiments — research being the first —
 * injects the executor rather than importing a runner, and this is the
 * description it matches against. The bytes are pinned by a test, so
 * renaming a capability is a visible contract change rather than a silent
 * one that only fails at someone else's call site.
 */

import { EVOLVE_CODES } from './errors.ts';

export interface EvolveExecutorManifest {
  readonly runner: string;
  readonly worktree: string;
  readonly effects: string;
  readonly codes: readonly string[];
}

export const EVOLVE_EXECUTOR_MANIFEST: EvolveExecutorManifest = Object.freeze({
  runner: 'evolve-runner/v1',
  worktree: 'evolve-worktree/v1',
  effects: 'jarenjs-external-effects',
  codes: Object.freeze(Object.keys(EVOLVE_CODES).sort()),
});
