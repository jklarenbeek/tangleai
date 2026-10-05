/** Activation audit descendants never replace the outcome service's checked head. */
import { equalsJson } from '@jarenjs/core/object';
import type { OutcomeService } from '@tangleai/outcomes';
import type { LessonSet, ResearchLessonScope, ResearchLessonV2 } from '../contracts.gen.ts';
import { researchIssue } from '../errors.ts';
import { immutableResearchJson, researchRevisionOf } from '../identity.ts';
import { validateResearchShape } from '../schema.ts';
import type { ResearchStore, ResearchStoreOutcome } from '../store.ts';
import { lessonStoreAccess, type LessonStoreAccess } from './access.ts';
import { LessonFailure, lessonFail } from './compile.ts';
import { readOutcomeLessonSet } from './outcome.ts';
import { lessonOutcomeBinding, lessonOutcomeRecord } from './outcome-records.ts';
import { sealResearchLesson } from './records.ts';

export interface ResearchLessonActivationOptions {
  store: ResearchStore;
  outcomes: OutcomeService;
  scope: ResearchLessonScope;
  activationEventId: string;
}
export interface ResearchLessonActivation {
  activationEventId: string;
  promoted: ResearchLessonV2[];
  rolledBack: ResearchLessonV2[];
}

export async function recordLessonActivation(options: ResearchLessonActivationOptions): Promise<ResearchStoreOutcome<ResearchLessonActivation>> {
  const access: LessonStoreAccess = lessonStoreAccess(options.store.lessons), outcomes = options.outcomes;
  try {
    const input = immutableResearchJson({ scope: options.scope, activationEventId: options.activationEventId });
    if (!validateResearchShape('ResearchLessonScope', input.scope).valid || !validateResearchShape('Sha256', input.activationEventId).valid)
      lessonFail('TRSH2001', '', 'Activation audit requires an exact scope and native event address.');
    const binding = await lessonOutcomeBinding(outcomes, input.scope);
    const event = await lessonOutcomeRecord(outcomes, binding, input.activationEventId, 'activationEvent');
    const approval = await lessonOutcomeRecord(outcomes, binding, event.approvalId, 'approval');
    const evaluation = await lessonOutcomeRecord(outcomes, binding, event.evaluationId, 'evaluation');
    if (event.versionId !== approval.versionId || event.versionId !== evaluation.versionId || event.evaluationId !== approval.evaluationId
      || event.action !== approval.action || event.nextHead.versionId !== event.versionId || !equalsJson(event.previousHead, approval.expectedHead)
      || event.nextHead.revision !== event.previousHead.revision + 1 || !evaluation.eligible || evaluation.issues.length)
      lessonFail('TRSH2007', '/activationEventId', 'The native activation, approval and evaluation bindings differ.');
    const targets = [{ versionId: event.versionId, state: 'promoted' as const }];
    const previous = event.action === 'rollback' && event.previousHead.versionId
      ? [{ versionId: event.previousHead.versionId, state: 'rolled-back' as const }] : [];
    const plans = [];
    for (const target of [...targets, ...previous]) {
      const version = await lessonOutcomeRecord(outcomes, binding, target.versionId, 'artifactVersion');
      const payload = validateResearchShape<LessonSet>('LessonSet', version.payload);
      if (!payload.valid) lessonFail('TRSH2007', '/payload', 'The activated outcome does not contain a closed lesson set.');
      plans.push({ ...target, payload: payload.value, setId: await researchRevisionOf(payload.value) });
    }
    return await access.apply({ input, event, plans }, async (tx, value) => {
      const promoted: ResearchLessonV2[] = [], rolledBack: ResearchLessonV2[] = []; let writes = 0;
      for (const plan of value.plans) {
        const staged = await readOutcomeLessonSet(access, tx, value.input.scope, plan.setId);
        if (!equalsJson(staged.set.payload, plan.payload)) access.refuse('TRSH2007', '/payload', 'The outcome payload differs from its retained guarded candidate.');
        for (const valid of staged.validated) {
          const { id: _id, revision: _revision, ...body } = valid;
          const lesson = access.checked(await sealResearchLesson({ ...body, parentId: valid.id, recordedAt: value.event.recordedAt,
            validation: { ...valid.validation, state: plan.state },
            promotion: { outcomeVersionId: plan.versionId, activationEventId: value.event.id } }));
          const prior = await access.proposal(tx, lesson.id);
          if (prior && !equalsJson(prior, lesson)) access.refuse('TRSH2007', '/id', 'An activation audit address already has different immutable content.');
          if (!prior) { await tx.put('lessons', lesson.projectId, lesson.id, lesson); writes++; }
          (plan.state === 'promoted' ? promoted : rolledBack).push(lesson);
        }
      }
      return { value: { activationEventId: value.event.id, promoted, rolledBack }, replayed: writes === 0 };
    });
  } catch (cause) {
    return { ok: false, issue: cause instanceof LessonFailure ? cause.issue : researchIssue('TRSH2007', '/activationEventId', 'The native activation audit could not be recorded.', cause) };
  }
}
