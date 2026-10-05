/** A run captures one checked outcome procedure before its first native stage. */
import { equalsJson } from '@jarenjs/core/object';
import type { OutcomeService } from '@tangleai/outcomes';
import type { MasStore } from '@tangleai/mas';
import type { SkillSnapshot } from '@tangleai/trace2skill';
import type { LessonInjection, LessonSet, LessonSetRecord, ResearchLessonScope, ResearchManifestLessons, ResearchWorkflowFrame } from '../contracts.gen.ts';
import { researchRefuse, type ResearchOutcome } from '../errors.ts';
import { immutableResearchJson, researchRevisionOf } from '../identity.ts';
import { validateResearchShape } from '../schema.ts';
import type { ResearchStore, ResearchTransaction } from '../store.ts';
import { lessonStoreAccess, type LessonStoreAccess } from './access.ts';
import { LessonFailure, lessonFail } from './compile.ts';
import { lessonOutcomeBinding, lessonOutcomeRecord } from './outcome-records.ts';
import { readOutcomeLessonSet } from './outcome.ts';
import { checkLessonRecord, lessonOriginContext, lessonScopeKey, sealLessonInjection } from './records.ts';

export { RESEARCH_LESSON_DEFAULTS } from '../domains/registry.ts';
export interface ResearchLessonProcedure {
  runId: string;
  snapshot: SkillSnapshot;
  set: LessonSetRecord | null;
  injection: LessonInjection | null;
}
export interface InjectLessonsOptions {
  store: ResearchStore;
  outcomes: OutcomeService;
  profile: ResearchLessonScope;
  runId: string;
  /** Retained procedure for the lessons-off control; omitted means no preload. */
  baseBundleHash?: string;
  /** Recover a captured native root even when no research stage committed yet. */
  masStore?: Pick<MasStore, 'getRun'>;
}
export interface LessonInjectionResult {
  state: 'on' | 'off';
  procedure: ResearchLessonProcedure | null;
  refused: Partial<Record<'OUTC1004', number>>;
  replayed: boolean;
}
const admissions = new WeakMap<ResearchLessonProcedure, ResearchStore>();
export function lessonProcedureStore(procedure: ResearchLessonProcedure): ResearchStore | undefined { return admissions.get(procedure); }

/** Publication reads retained records; a model-authored manifest cannot add lesson authority. */
export async function researchLessonManifest(store: ResearchStore, runId: string): Promise<ResearchOutcome<ResearchManifestLessons>> {
  const injections = await store.lessons.listInjections(runId);
  if (!injections.ok) return { valid: false, issues: [injections.issue] };
  const lessons = await store.lessons.list({ projectId: runId });
  if (!lessons.ok) return { valid: false, issues: [lessons.issue] };
  return { valid: true, value: immutableResearchJson({ injected: injections.value,
    proposed: lessons.value.filter(row => row.validation.state === 'proposed').map(row => row.id).sort(),
    promoted: lessons.value.filter(row => row.validation.state === 'promoted').map(row => row.id).sort() }) };
}

export async function injectLessons(options: InjectLessonsOptions): Promise<ResearchOutcome<LessonInjectionResult>> {
  const store = options.store, access: LessonStoreAccess = lessonStoreAccess(store.lessons), outcomes = options.outcomes;
  try {
    const input = immutableResearchJson({ profile: options.profile, runId: options.runId,
      ...(options.baseBundleHash !== undefined ? { baseBundleHash: options.baseBundleHash } : {}) });
    if (!validateResearchShape('ResearchLessonScope', input.profile).valid || !validateResearchShape('ResearchId', input.runId).valid
      || input.baseBundleHash !== undefined && !validateResearchShape('Sha256', input.baseBundleHash).valid)
      return researchRefuse('TRSH2001', '', 'Lesson injection requires a scope, actual run and optional retained baseline address.');
    const binding = await lessonOutcomeBinding(outcomes, input.profile);
    const nativeRun = await options.masStore?.getRun(input.runId);
    let nativeFrame: ResearchWorkflowFrame | null = null;
    if (nativeRun) {
      const frame = validateResearchShape<ResearchWorkflowFrame>('ResearchWorkflowFrame', (nativeRun.input as { frame?: unknown })?.frame);
      if (!frame.valid || nativeRun.id !== input.runId || frame.value.projectId !== input.runId || frame.value.status !== 'CREATED')
        return researchRefuse('TRSH2007', '/masStore', 'The retained native root does not bind this research run.');
      nativeFrame = frame.value;
    }
    async function prior(tx: ResearchTransaction) {
      const rows = await tx.list('lessonInjections', input.runId);
      if (rows.length > 1) access.refuse('TRSH2007', '/runId', 'A run cannot have more than one frozen lesson injection.');
      const record = rows.length ? access.checked(await checkLessonRecord<LessonInjection>('LessonInjection', rows[0])) : null;
      if (record && (record.projectId !== input.runId || record.runId !== input.runId || !equalsJson(record.scope, input.profile)))
        access.refuse('TRSH2003', '/runId', 'The retained injection has a different run or scope.');
      return record;
    }
    const captured = await access.apply(input, async tx => {
      const project = await access.project(tx, input.runId);
      if (!project) access.refuse('TRSH2002', '/runId', 'The target run is missing.');
      const context = access.checked(await lessonOriginContext(project));
      if (!equalsJson(context.scope, input.profile)) access.refuse('TRSH2003', '/profile', 'The target run belongs to another lesson scope.');
      const injection = await prior(tx), receipts = await access.receipts(tx, input.runId);
      if (nativeFrame && !equalsJson(nativeFrame.lessonProcedure?.injection ?? null, injection))
        access.refuse('TRSH2007', '/masStore', 'The retained native root differs from the frozen injection.');
      let baselineHash: string | null | undefined = nativeFrame && !injection ? nativeFrame.lessonProcedure?.bundleHash ?? null : undefined;
      if (baselineHash !== undefined && input.baseBundleHash !== undefined && input.baseBundleHash !== baselineHash)
        access.refuse('TRSH2007', '/baseBundleHash', 'Recovery must preserve the procedure in the retained native root.');
      for (const receipt of receipts) {
        const manifest = await access.record(tx, input.runId, 'InputManifest', 'manifest-' + receipt.attempt.inputManifestHash);
        if (!manifest || !equalsJson(manifest.lessonProcedure?.injection ?? null, injection))
          access.refuse('TRSH2007', '/runId', 'A committed stage differs from its frozen injection.');
        if (!injection) {
          const hash = manifest.lessonProcedure?.bundleHash ?? null;
          if (baselineHash !== undefined && baselineHash !== hash || input.baseBundleHash !== undefined && input.baseBundleHash !== hash)
            access.refuse('TRSH2007', '/baseBundleHash', 'Recovery must retain the baseline already used by the run.');
          baselineHash = hash;
        }
      }
      return { value: { injection, baselineHash: baselineHash ?? null, history: receipts.length > 0 || nativeFrame !== null } };
    });
    if (!captured.ok) return { valid: false, issues: [captured.issue] };
    let injection = captured.value.injection, absent = !injection && captured.value.history;
    if (!injection && !captured.value.history) {
      const checked = await outcomes.injectChecked({ ...binding, input: {} });
      if (!checked.ok) {
        if (checked.issues.length !== 1 || checked.issues[0].code !== 'OUTC1004')
          return researchRefuse('TRSH2007', '/outcomes', 'The native checked head refused injection.', checked.issues[0]);
        absent = true;
      } else {
        const head = checked.value as { payload?: unknown; versionId?: unknown; activationEventId?: unknown };
        const payload = validateResearchShape<LessonSet>('LessonSet', head.payload);
        if (!payload.valid) return researchRefuse('TRSH2007', '/payload', 'The checked head does not contain a lesson set.', payload.issues[0]);
        const sealed = await sealLessonInjection({ projectId: input.runId, runId: input.runId, scope: input.profile,
          bundleHash: payload.value.bundleHash, lessonSetHash: await researchRevisionOf(payload.value),
          outcomeVersionId: head.versionId as string, activationEventId: head.activationEventId as string });
        if (!sealed.valid) return sealed;
        injection = sealed.value;
      }
    }
    if (injection) {
      const event = await lessonOutcomeRecord(outcomes, binding, injection.activationEventId, 'activationEvent');
      const version = await lessonOutcomeRecord(outcomes, binding, injection.outcomeVersionId, 'artifactVersion');
      if (event.versionId !== version.id || event.nextHead.versionId !== version.id
        || await researchRevisionOf(version.payload) !== injection.lessonSetHash
        || (version.payload as unknown as LessonSet).bundleHash !== injection.bundleHash)
        lessonFail('TRSH2007', '/injection', 'The frozen procedure differs from its native activation and outcome payload.');
    }
    const prepared = await access.apply({ injection, absent }, async (tx, value) => {
      const previous = await prior(tx);
      if (previous && !equalsJson(previous, value.injection)) access.refuse('TRSH2007', '/injection', 'Another procedure was already frozen for this run.');
      if (!previous && !captured.value.history) {
        const state = await tx.get('state', input.runId, 'control');
        if (!state || state.status !== 'CREATED' || (await access.receipts(tx, input.runId)).length)
          access.refuse('TRSH2007', '/runId', 'A procedure must be frozen before the run executes its first native stage.');
      }
      let procedure: ResearchLessonProcedure | null = null;
      if (value.injection) {
        const staged = await readOutcomeLessonSet(access, tx, input.profile, value.injection.lessonSetHash);
        if (staged.snapshot.bundle.id !== value.injection.bundleHash) access.refuse('TRSH2007', '/bundleHash', 'The activated procedure hash differs from the retained candidate.');
        if (!previous) await tx.put('lessonInjections', input.runId, value.injection.id, value.injection);
        procedure = { runId: input.runId, snapshot: staged.snapshot, set: staged.set, injection: value.injection };
      } else if (captured.value.baselineHash ?? input.baseBundleHash) {
        const snapshot = await access.storedProcedure(tx, (captured.value.baselineHash ?? input.baseBundleHash)!, true);
        if (snapshot!.bundle.scopeKey !== lessonScopeKey(input.profile)) access.refuse('TRSH2003', '/baseBundleHash', 'The baseline belongs to another lesson scope.');
        procedure = { runId: input.runId, snapshot: snapshot!, set: null, injection: null };
      }
      return { value: { state: value.absent ? 'off' as const : 'on' as const, procedure,
        refused: value.absent ? { OUTC1004: 1 } : {}, replayed: previous !== null || captured.value.history } };
    });
    if (!prepared.ok) return { valid: false, issues: [prepared.issue] };
    const result = immutableResearchJson(prepared.value);
    if (result.procedure) admissions.set(result.procedure, store);
    return { valid: true, value: result };
  } catch (cause) {
    return cause instanceof LessonFailure ? { valid: false, issues: [cause.issue] }
      : researchRefuse('TRSH2007', '/injection', 'The checked research procedure could not be captured.', cause);
  }
}
