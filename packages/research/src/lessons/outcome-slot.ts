/** Held-out registration binds independently recorded truth and actual parent output. */
import { equalsJson } from '@jarenjs/core/object';
import { outcomeRevision, type OutcomeAdapter, type OutcomeService, type EvaluationSlot, type Source, type Json } from '@tangleai/outcomes';
import type { LessonSet, LessonSpend, ResearchLessonScope } from '../contracts.gen.ts';
import { researchRefuse, type ResearchOutcome } from '../errors.ts';
import { immutableResearchJson, researchRevisionOf } from '../identity.ts';
import { validateResearchShape } from '../schema.ts';
import type { ResearchStore } from '../store.ts';
import { lessonStoreAccess, type LessonStoreAccess } from './access.ts';
import { LessonFailure, lessonFail } from './compile.ts';
import { lessonScopeKey } from './records.ts';
import { readOutcomeLessonSet, researchLessonOutcomeScope } from './outcome.ts';
import { lessonOutcomeBinding, lessonOutcomeRecord } from './outcome-records.ts';

export interface ResearchLessonSlotOptions {
  store: ResearchStore;
  outcomes: OutcomeService;
  adapter: OutcomeAdapter;
  scope: ResearchLessonScope;
  validationRunId: string;
  versionId: string;
  slotId: string;
}
export interface ResearchLessonEvaluationSlot {
  slot: EvaluationSlot;
  sources: Source[];
  /** Actual research execution, separate from the native lookup-only zero call/cost fields. */
  spend: LessonSpend;
  validationRunId: string;
}

export async function prepareResearchLessonSlot(options: ResearchLessonSlotOptions): Promise<ResearchOutcome<ResearchLessonEvaluationSlot>> {
  const access: LessonStoreAccess = lessonStoreAccess(options.store.lessons), outcomes = options.outcomes, adapter = options.adapter;
  try {
    const input = immutableResearchJson({ scope: options.scope, validationRunId: options.validationRunId, versionId: options.versionId, slotId: options.slotId });
    if (!validateResearchShape('ResearchLessonScope', input.scope).valid || !validateResearchShape('Sha256', input.validationRunId).valid
      || !validateResearchShape('Sha256', input.versionId).valid || typeof input.slotId !== 'string' || !input.slotId.trim())
      return researchRefuse('TRSH2001', '', 'A lesson slot requires exact retained scope, validation and version addresses.');
    const binding = await lessonOutcomeBinding(outcomes, input.scope);
    const version = await lessonOutcomeRecord(outcomes, binding, input.versionId, 'artifactVersion');
    const reflection = await lessonOutcomeRecord(outcomes, binding, version.reflectionId, 'reflection');
    if (!equalsJson(version.adapter, adapter.identity)) return researchRefuse('TRSH2004', '/adapter', 'The candidate belongs to another frozen adapter identity.');
    const parent = version.parentVersionId ? await lessonOutcomeRecord(outcomes, binding, version.parentVersionId, 'artifactVersion') : null;
    const payload = validateResearchShape<LessonSet>('LessonSet', version.payload), baseline = validateResearchShape<LessonSet>('LessonSet', parent?.payload ?? adapter.staticPayload);
    if (!payload.valid || !baseline.valid) return researchRefuse('TRSH2004', '/payload', 'The candidate or baseline does not contain retained lesson outputs.');
    const setId = await researchRevisionOf(payload.value);
    const retained = await access.apply(input, async (tx, value) => {
      const candidate = await readOutcomeLessonSet(access, tx, value.scope, setId);
      const run = await tx.get('lessonValidations', lessonScopeKey(value.scope), value.validationRunId);
      if (!run || !candidate.set.validationRunIds.includes(value.validationRunId))
        access.refuse('TRSH2004', '/validationRunId', 'This validation does not belong to the exact staged lesson set.');
      const checked = await access.validation(tx, run);
      if (!equalsJson(candidate.set.payload, payload.value) || checked.bundleHash !== payload.value.bundleHash
        || checked.baseBundleHash !== baseline.value.bundleHash || !equalsJson(checked.scope, value.scope))
        access.refuse('TRSH2004', '/payload', 'Candidate and baseline must reproduce the validation procedure bindings.');
      for (const row of checked.rows) if (!Object.hasOwn(baseline.value.rows, row.inputHash)
        || !equalsJson(baseline.value.rows[row.inputHash], row.baselineOutput) || !equalsJson(payload.value.rows[row.inputHash], row.output))
        access.refuse('TRSH2004', '/rows', 'Every held-out comparison requires the actual retained candidate and parent output; missing is not zero.');
      return { value: checked };
    });
    if (!retained.ok) return { valid: false, issues: [retained.issue] };
    const run = retained.value, cases: EvaluationSlot['cases'] = [], sources: Source[] = [];
    const spend: LessonSpend = { calls: 0, tokens: 0, physical: 0, replayed: 0, ms: 0, cost: 0 };
    for (const row of run.rows) {
      const body = { sourceId: 'research-validation:' + run.id + ':' + row.topicId, scopeId: binding.scopeId,
        subject: researchLessonOutcomeScope(input.scope).subject, issuer: 'research-evaluator:' + run.evaluatorRevision,
        observedAt: run.finishedAt, decisionId: null, payload: row.truth as unknown as Json };
      const source: Source = { ...body, digest: await outcomeRevision(body) }; sources.push(source);
      cases.push({ id: row.topicId, domain: row.domain ?? input.scope.domainProfileId, input: { topicId: row.topicId, inputHash: row.inputHash }, source });
      for (const key of ['calls', 'tokens', 'physical', 'replayed', 'ms'] as const) spend[key] += row.spend[key];
      spend.cost = spend.cost === null || row.spend.cost === null ? null : spend.cost + row.spend.cost;
    }
    if (cases.length > 128) lessonFail('TRSH2004', '/rows', 'The native held-out slot accepts at most 128 cases.');
    const slot: EvaluationSlot = { slotId: input.slotId, versionId: version.id, expectedHead: version.expectedHead,
      trainingScoreIds: reflection.scoreIds, cases, evaluatorRevision: run.evaluatorRevision, gatePolicyId: outcomes.gatePolicyId,
      maxPhysicalRequests: 0, maxCost: 0 };
    return { valid: true, value: immutableResearchJson({ slot, sources, spend, validationRunId: run.id }) };
  } catch (cause) {
    return cause instanceof LessonFailure ? { valid: false, issues: [cause.issue] }
      : researchRefuse('TRSH2004', '/slot', 'The retained lesson evaluation slot could not be prepared.', cause);
  }
}
