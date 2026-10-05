/** One guarded compiler path serves previews and validated staging. */
import { createGuardedRefiner } from '@jarenjs/core/guarded';
import { isThenable } from '@jarenjs/core/function';
import { equalsJson } from '@jarenjs/core/object';
import { applyCompiled, candidateDiff, compilePatch, draftsOf, guidanceLeakCheck, validateFormat, validateTrace2SkillShape,
  type CompiledPatch, type SkillFileDraft, type SkillFormatProfile, type SkillPatch, type SkillSnapshot } from '@tangleai/trace2skill';
import type { ResearchIssue, ResearchLessonV2 } from '../contracts.gen.ts';
import { researchIssue, type ResearchCode } from '../errors.ts';
import { immutableResearchJson, researchRevisionOf } from '../identity.ts';

export class LessonFailure extends Error {
  readonly issue: ResearchIssue;
  constructor(issue: ResearchIssue) { super(issue.detail); this.issue = issue; }
}
export function lessonFail(code: ResearchCode, path: string, detail: string, cause?: unknown): never {
  throw new LessonFailure(researchIssue(code, path, detail, cause));
}
export interface LessonCompilerHooks {
  compile?: typeof compilePatch;
  validateProposal?: (patch: SkillPatch) => unknown;
  validateBundle?: (files: readonly SkillFileDraft[]) => unknown;
  validateCandidate?: (files: readonly SkillFileDraft[]) => unknown;
  planCommit?: (plan: LessonCompilation) => unknown;
}
export interface LessonCompilation {
  files: SkillFileDraft[];
  compiled: CompiledPatch;
  diffSummary: ReturnType<typeof candidateDiff>['diffSummary'];
  churn: number;
}
interface Document { files: SkillFileDraft[]; compiled: CompiledPatch | null }
const guardError = (issue: ResearchIssue) => ({ ...issue, docPath: issue.path, message: issue.detail });

/** Research provenance names real proposals; it never invents skill rollouts. */
export async function lessonPatches(proposals: readonly ResearchLessonV2[], validationRunIds: readonly string[]): Promise<SkillPatch[]> {
  const ordered = [...proposals].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const runId = await researchRevisionOf({ document: 'research-lesson-staging/v1', scope: ordered[0].scope,
    proposalIds: ordered.map(row => row.id), validationRunIds: [...validationRunIds].sort(),
    originIds: [...new Set(ordered.map(row => row.origin.runId))].sort() });
  async function seal(body: Omit<SkillPatch, 'id'>): Promise<SkillPatch> { return { ...body, id: await researchRevisionOf(body) }; }
  const common = { runId, baseHash: ordered[0].proposal.baseHash, sourceRolloutIds: [], supportCount: 0,
    changelog: [], validation: { state: 'compiled' as const, issues: [] } };
  const leaves: SkillPatch[] = [];
  for (const proposal of ordered) leaves.push(await seal({ ...common, sourcePatchIds: [], reasoning: proposal.proposal.edit.reasoning,
    operations: proposal.proposal.edit.operations.map(operation => ({ ...operation, group: proposal.id + '/' + operation.group })) }));
  const final = await seal({ ...common, sourcePatchIds: leaves.map(row => row.id).sort(),
    reasoning: ordered.map(row => row.proposal.edit.reasoning).join('\n'), operations: leaves.flatMap(row => row.operations) });
  return [...leaves, final];
}

/** Even native commit's asynchronous runner sees a synchronous refusal value. */
function synchronous<T>(name: string, run: () => T): T {
  let result: T;
  try { result = run(); }
  catch (cause) { if (cause instanceof LessonFailure) throw cause; return lessonFail('TRSH2004', '/' + name, name + ' threw before validation completed.', cause); }
  if (isThenable(result)) {
    // The refusal is reported below; observe a rejected thenable so the
    // caller's invalid validator cannot become an unhandled process rejection.
    void Promise.resolve(result).then(() => undefined, () => undefined);
    lessonFail('TRSH2004', '/' + name, name + ' returned a thenable; validators are synchronous.');
  }
  return result;
}
function additional(name: string, run: (() => unknown) | undefined) {
  if (!run) return;
  const result = synchronous(name, run) as { valid?: boolean; issues?: unknown[]; errors?: unknown[] } | null;
  if (result?.valid !== true) lessonFail('TRSH2004', '/' + name, name + ' refused the candidate.', result?.issues?.[0] ?? result?.errors?.[0]);
}
export function lessonGuardIssues(errors: unknown[] | undefined, cause?: unknown): ResearchIssue[] {
  if (cause instanceof LessonFailure) return [cause.issue];
  return (errors?.length ? errors : [cause]).map(value => {
    const row = value as Partial<ResearchIssue> & { docPath?: string; message?: string } | undefined;
    return researchIssue(row?.code?.startsWith('TRSH20') ? row.code as ResearchCode : 'TRSH2004', row?.path ?? row?.docPath ?? '',
      row?.detail ?? row?.message ?? 'The guarded lesson operation failed.', row?.cause ?? value);
  });
}

export function createLessonCompiler<T>(options: { snapshot: SkillSnapshot; patch: SkillPatch; profile: SkillFormatProfile;
  forbidden: readonly string[]; hooks: LessonCompilerHooks; expectedFiles?: readonly SkillFileDraft[];
  validate(): void; commit(plan: LessonCompilation): Promise<T> }) {
  const { snapshot, profile, forbidden, hooks } = options;
  const frozen = { bundle: snapshot.bundle, files: draftsOf(snapshot.files) };
  const previous: Document = { files: frozen.files, compiled: null };
  const engine = createGuardedRefiner({
    read: async () => previous,
    validateProposal(patch: SkillPatch) {
      try {
        const shape = validateTrace2SkillShape('skillPatch', patch);
        if (!shape.valid) lessonFail('TRSH2001', '/proposal', 'The native skill patch is invalid.', shape.issues[0]);
        if (!equalsJson(patch, options.patch)) lessonFail('TRSH2007', '/proposal', 'The patch differs from the retained proposals.');
        options.validate();
        additional('validateProposal', hooks.validateProposal ? () => hooks.validateProposal!(immutableResearchJson(patch)) : undefined);
        for (const text of [patch.reasoning, ...patch.operations.map(operation => operation.path)]) {
          const leak = guidanceLeakCheck(text, forbidden);
          if (!leak.valid) lessonFail('TRSH2005', '/proposal', 'Reusable guidance contains a forbidden task or result.', leak.issues[0]);
        }
        return { valid: true, errors: [] };
      } catch (cause) { return { valid: false, errors: lessonGuardIssues(undefined, cause).map(guardError) }; }
    },
    apply(document: Document, patch: SkillPatch): Document {
      const compiler = hooks.compile ?? compilePatch;
      const result = synchronous('compile', () => compiler(immutableResearchJson(frozen), immutableResearchJson(patch), immutableResearchJson({ profile, forbidden })));
      if (!result.valid) lessonFail(result.issues.some(issue => issue.code === 'TT2S1006') ? 'TRSH2005' : 'TRSH2004', '/proposal', 'The native compiler refused this edit.', result.issues[0]);
      if (compiler !== compilePatch) {
        const native = compilePatch(frozen, patch, { profile, forbidden });
        if (!equalsJson(result, native)) lessonFail('TRSH2004', '/compile', 'The injected compiler differs from the native edit receipt.');
      }
      if (result.value.withheld.length) lessonFail('TRSH2004', '/proposal', 'Every requested hunk must compile without withholding.', result.value.issues[0]);
      const applied = applyCompiled(document.files, result.value, profile);
      if (!applied.valid) lessonFail('TRSH2004', '/proposal', 'The native compiler could not apply the copied edit.', applied.issues[0]);
      return { files: applied.value, compiled: result.value };
    },
    applyFailure: (cause: unknown) => guardError(lessonGuardIssues(undefined, cause)[0]),
    validateCandidate(next: Document, previous: Document) {
      try {
        const format = validateFormat(next.files, profile);
        if (!format.valid) lessonFail('TRSH2004', '/bundle', 'The candidate violates the native format profile.', format.issues[0]);
        if (equalsJson(next.files, previous.files)) lessonFail('TRSH2004', '/bundle', 'The proposal does not change the frozen procedure.');
        if (options.expectedFiles && !equalsJson(next.files, options.expectedFiles)) lessonFail('TRSH2004', '/bundleHash', 'The candidate differs from the held-out procedure.');
        for (const file of next.files) for (const text of [file.path, file.content ?? '']) {
          const leak = guidanceLeakCheck(text, forbidden);
          if (!leak.valid) lessonFail('TRSH2005', '/files', 'Reusable procedure contains a task ID or hidden result.', leak.issues[0]);
        }
        additional('validateBundle', hooks.validateBundle ? () => hooks.validateBundle!(immutableResearchJson(next.files)) : undefined);
        additional('validateCandidate', hooks.validateCandidate ? () => hooks.validateCandidate!(immutableResearchJson(next.files)) : undefined);
        return { valid: true, errors: [] };
      } catch (cause) { return { valid: false, errors: lessonGuardIssues(undefined, cause).map(guardError) }; }
    },
    planCommit(next: Document, previous: Document) {
      try {
        if (!next.compiled) lessonFail('TRSH2004', '/compiled', 'The prepared document has no native compilation receipt.');
        const plan = { files: next.files, compiled: next.compiled, ...candidateDiff(previous.files, next.files, next.compiled) };
        additional('planCommit', hooks.planCommit ? () => hooks.planCommit!(immutableResearchJson(plan)) : undefined);
        return { valid: true, errors: [], plan };
      } catch (cause) { return { valid: false, errors: lessonGuardIssues(undefined, cause).map(guardError) }; }
    },
    commit: options.commit,
  });
  return { prepare: () => engine.prepare(previous, options.patch) as { valid: boolean; errors: unknown[]; plan?: LessonCompilation },
    commit: () => engine.commit(options.patch) as Promise<{ ok: boolean; value?: T; errors?: unknown[]; cause?: unknown }> };
}
