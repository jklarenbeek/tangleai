/**
 * The guarded patch path — the ONE consumer of the suite's guarded editor.
 *
 * `createGuardedRefiner` owns the shape of a safe edit: read a document,
 * validate the proposal, apply on a COPY, validate the candidate, plan the
 * commit, and never let an invalid candidate reach the plan. This module
 * supplies the five judgements and nothing else; it does not reimplement
 * the sequencing, and no second copy of it exists in this package.
 *
 * Two traps the suite's contract sets, both deliberate:
 *
 *  - every validator must be SYNCHRONOUS. A validator that returns a
 *    Promise is read as `{ valid: false, errors: [] }` — a refusal with no
 *    reason, which looks like a bug in the caller rather than in the
 *    validator. A test pins that ours are synchronous.
 *  - every refusal must carry at least one error, for the same reason: an
 *    empty `errors` is indistinguishable from the accidental-Promise case.
 *
 * `commit` refuses on purpose. Preparation never writes: the host applies
 * the plan as a fenced effect, so the thing that edits files is the thing
 * that recorded an intent first.
 */

import { createGuardedRefiner } from '@jarenjs/core/guarded';
import { applyJSONPatch } from '@jarenjs/json/patch';

import { evolveIssue, refuse, ok, type EvolveIssue, type EvolveOutcome } from './errors.ts';
import { loadProposal, operationPath, patchBytes, type EvolveProposalInput, type ProposalOperation } from './proposal.ts';
import type { FileMap, SurfacePolicy, SurfaceStatus } from './policy.ts';
import type { EvolveBudgets } from './contracts.gen.ts';

export interface WritePlan {
  writes: Array<{ path: string, text: string }>;
  removes: string[];
  changed: string[];
  bytes: number;
}

export interface PatchRefinerOptions {
  policy: SurfacePolicy;
  budgets: EvolveBudgets;
  apply?: typeof applyJSONPatch;
}

export interface PreparedPatch {
  proposal: EvolveProposalInput;
  plan: WritePlan;
  next: FileMap;
}

interface Verdict { valid: boolean; errors: EvolveIssue[] }

const invalid = (errors: EvolveIssue[]): Verdict =>
  // Never empty: an empty refusal reads like the accidental-Promise trap.
  ({ valid: false, errors: errors.length > 0 ? errors : [evolveIssue('TEVO1001', '', 'The candidate was refused without a stated reason.')] });

export function createPatchRefiner(options: PatchRefinerOptions) {
  const { policy, budgets } = options;
  const apply = options.apply ?? applyJSONPatch;

  /** Build the ordered write plan a host can execute without re-deciding anything. */
  function planFor(previous: FileMap, next: FileMap): WritePlan {
    const before = new Set(Object.keys(previous));
    const after = Object.keys(next).sort();
    const writes: Array<{ path: string, text: string }> = [];
    for (const path of after) {
      if (!before.has(path) || previous[path] !== next[path]) writes.push({ path, text: next[path] });
    }
    const removes = [...before].filter(path => !Object.hasOwn(next, path)).sort();
    const changed = [...new Set([...writes.map(one => one.path), ...removes])].sort();
    let bytes = 0;
    for (const one of writes) bytes += Buffer.byteLength(one.text, 'utf8');
    return { writes, removes, changed, bytes };
  }

  const guarded = createGuardedRefiner({
    // Only `prepare` is used here, which takes the document directly;
    // `read` exists for the engine's own commit path, which this
    // consumer refuses to take.
    read: async () => ({ files: {} as FileMap }),
    validateProposal: (value: unknown): Verdict => {
      const loaded = loadProposal(value);
      return loaded.ok ? { valid: true, errors: [] } : invalid(loaded.issues);
    },
    apply: (document: unknown, proposal: unknown) => {
      const operations = (proposal as EvolveProposalInput).patch.map(one => ({ ...one }));
      const target = { files: { ...(document as { files: FileMap }).files } };
      return apply(target, operations as never);
    },
    // The engine wraps this return in its own `errors` array, so it must
    // answer ONE issue rather than a verdict — a verdict here would nest
    // itself inside the error list and arrive as an unreadable object.
    // The patch engine's own code and pointer are the useful part; they
    // are carried as `cause` rather than replaced with a paraphrase.
    applyFailure: (error: unknown): EvolveIssue => {
      const held = error as { code?: string, docPath?: string, message?: string };
      return evolveIssue('TEVO1001', '/patch', 'The patch did not apply.', {
        code: typeof held?.code === 'string' ? held.code : 'patch/failed',
        docPath: typeof held?.docPath === 'string' ? held.docPath : '/patch',
        message: typeof held?.message === 'string' ? held.message : String(error),
      });
    },
    validateCandidate: (next: unknown, previous: unknown): Verdict => {
      const candidate = (next as { files?: FileMap })?.files;
      if (candidate === undefined || typeof candidate !== 'object') {
        return invalid([evolveIssue('TEVO1001', '/files', 'The patched document has no file map.')]);
      }
      const issues = policy.check((previous as { files: FileMap }).files, candidate);
      return issues.length === 0 ? { valid: true, errors: [] } : invalid(issues);
    },
    planCommit: (next: unknown, previous: unknown) => {
      const plan = planFor((previous as { files: FileMap }).files, (next as { files: FileMap }).files);
      const errors: EvolveIssue[] = [];
      if (plan.bytes > budgets.patchBytes) {
        errors.push(evolveIssue('TEVO1005', '/budgets/patchBytes',
          'over-budget: ' + plan.bytes + ' bytes exceeds ' + budgets.patchBytes + '.'));
      }
      if (plan.changed.length > budgets.patchFiles) {
        errors.push(evolveIssue('TEVO1005', '/budgets/patchFiles',
          'over-budget: ' + plan.changed.length + ' files exceeds ' + budgets.patchFiles + '.'));
      }
      return errors.length === 0 ? { valid: true, errors: [], plan } : { valid: false, errors, plan };
    },
    commit: () => {
      // Preparation never writes. The host applies this plan as an effect,
      // so the thing that edits files is the thing that recorded an intent.
      throw new Error('preparation never commits through the generic engine');
    },
  });

  return {
    /** The one API a caller uses. A refused prepare costs no worktree and no spawn. */
    prepare(previous: FileMap, proposal: unknown): EvolveOutcome<PreparedPatch> {
      const loaded = loadProposal(proposal);
      if (!loaded.ok) return loaded;

      // The operations are judged before the engine sees them, so an
      // escaped path is reported as written and an oversized patch never
      // reaches an apply at all.
      const early = policy.checkPatch(loaded.value.patch);
      if (early.length > 0) return refuse<PreparedPatch>(early);

      // `prepare` is the suite's read-validate-apply-validate-plan sequence,
      // synchronous by contract. It never commits, which is exactly what is
      // wanted: the write happens later, as a recorded effect.
      const result = guarded.prepare({ files: { ...previous } }, loaded.value as unknown as Record<string, unknown>);
      if (!result.valid) {
        const errors = (result.errors ?? []) as EvolveIssue[];
        return refuse<PreparedPatch>(errors.length > 0
          ? errors
          : [evolveIssue('TEVO1001', '', 'The guarded editor refused without a stated reason.')]);
      }
      const next = (result.next as { files: FileMap }).files;
      return ok({ proposal: loaded.value, plan: (result.plan as WritePlan) ?? planFor(previous, next), next });
    },

    /** The second rename and symlink look, over git's own staged view. */
    verifyStaged(previous: FileMap, next: FileMap, status: SurfaceStatus): EvolveOutcome<true> {
      const issues = policy.check(previous, next, status);
      return issues.length === 0 ? ok(true as const) : refuse<true>(issues);
    },

    planFor,
  };
}

export { operationPath, patchBytes };
export type { ProposalOperation };
