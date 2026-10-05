/** Async evidence is preloaded; the native guarded engine owns every copied edit. */
import { equalsJson } from '@jarenjs/core/object';
import { sealSkillBundle, MINIMAL_SKILL_PROFILE, type SkillFormatProfile, type SkillSnapshot, type SkillCandidate } from '@tangleai/trace2skill';
import type { LessonSetRecord, LessonValidationRun, ResearchLessonScope, ResearchLessonV2 } from '../contracts.gen.ts';
import { researchIssue, type ResearchOutcome } from '../errors.ts';
import { immutableResearchJson, researchRevisionOf } from '../identity.ts';
import { validateResearchShape } from '../schema.ts';
import type { ResearchStore, ResearchStoreOutcome } from '../store.ts';
import { lessonStoreAccess, type LessonStoreAccess } from './access.ts';
import { checkLessonRecord, lessonScopeKey } from './records.ts';
import { checkedLessonOrigin, type CheckedLessonOrigin } from './origins.ts';
import { createLessonCompiler, LessonFailure, lessonFail, lessonGuardIssues, lessonPatches,
  type LessonCompilerHooks, type LessonCompilation } from './compile.ts';
import { checkedStagedLessonSet, commitLessonStage, type LessonStageInput, type StagedLessonResult } from './stage.ts';

export interface LessonProcedureView { snapshot: SkillSnapshot; set: LessonSetRecord | null }
export interface LessonRefinerOptions extends LessonCompilerHooks {
  store: ResearchStore;
  scope: ResearchLessonScope;
  /** The host supplies its checked outcome head, or its registered empty base. */
  read(): Promise<LessonProcedureView>;
  now(): string;
  profile?: SkillFormatProfile;
  /** Task IDs, ground-truth strings and hidden-result spans registered by the host. */
  forbidden?: readonly string[];
  /** Optional preloaded evaluator view; every entry must equal retained storage. */
  validationRuns?: ReadonlyMap<string, LessonValidationRun>;
}
export interface LessonMaterializeRequest { proposalIds: readonly string[] }
export interface LessonRefineRequest extends LessonMaterializeRequest { validationRunIds: readonly string[] }
export interface MaterializedLessonCandidate { snapshot: SkillSnapshot; patches: LessonStageInput['patches']; compilation: LessonCompilation }
export interface PreparedLessonCandidate extends MaterializedLessonCandidate { candidate: SkillCandidate; validations: LessonValidationRun[] }
export interface LessonRefiner {
  /** Returns exact procedure bytes without any candidate, lesson or set writes. */
  materialize(request: LessonMaterializeRequest): Promise<ResearchOutcome<MaterializedLessonCandidate>>;
  prepare(request: LessonRefineRequest): Promise<ResearchOutcome<PreparedLessonCandidate>>;
  commit(request: LessonRefineRequest): Promise<ResearchStoreOutcome<StagedLessonResult>>;
}
const sorted = (values: readonly string[]) => [...values].sort();

export function createLessonRefiner(options: LessonRefinerOptions): LessonRefiner {
  if (typeof options.read !== 'function' || typeof options.now !== 'function') throw new TypeError('Lesson refinement requires an injected checked reader and clock.');
  const access: LessonStoreAccess = lessonStoreAccess(options.store.lessons);
  const scope = immutableResearchJson(options.scope);
  const scopeShape = validateResearchShape<ResearchLessonScope>('ResearchLessonScope', scope);
  if (!scopeShape.valid) throw new TypeError('Lesson refinement requires a valid scope.');
  const profile = immutableResearchJson(options.profile ?? MINIMAL_SKILL_PROFILE), forbidden = immutableResearchJson(options.forbidden ?? []);
  const hooks: LessonCompilerHooks = { compile: options.compile, validateProposal: options.validateProposal,
    validateBundle: options.validateBundle, validateCandidate: options.validateCandidate, planCommit: options.planCommit };
  const validationView = options.validationRuns ? new Map([...options.validationRuns].map(([id, row]) => [id, immutableResearchJson(row)])) : null;
  function must<T>(result: ResearchStoreOutcome<T>): T { if (!result.ok) throw new LessonFailure(result.issue); return result.value; }
  function request(input: LessonMaterializeRequest | LessonRefineRequest, stage: boolean) {
    let value: LessonRefineRequest;
    try { value = immutableResearchJson(input) as LessonRefineRequest; }
    catch (cause) { return lessonFail('TRSH2001', '', 'A lesson request must be finite JSON.', cause); }
    if (!value || !equalsJson(Object.keys(value).sort(), stage ? ['proposalIds', 'validationRunIds'] : ['proposalIds']))
      lessonFail('TRSH2001', '', 'A lesson request contains only the declared record IDs.');
    for (const [name, ids, maximum] of [['proposalIds', value.proposalIds, 64], ...(stage ? [['validationRunIds', value.validationRunIds, 64] as const] : [])] as const) {
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > maximum || new Set(ids).size !== ids.length
        || ids.some(id => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id))) lessonFail('TRSH2001', '/' + name, 'Expected distinct bounded content addresses.');
    }
    return { proposalIds: sorted(value.proposalIds), validationRunIds: stage ? sorted(value.validationRunIds) : [] };
  }
  async function readView(): Promise<LessonProcedureView> {
    const input = await options.read();
    const result = await access.apply(input, async (tx, view) => {
      const snapshot = await access.procedure(view.snapshot);
      const retained = await access.storedProcedure(tx, snapshot.bundle.id, true);
      if (!equalsJson(snapshot, retained)) access.refuse('TRSH2007', '/read', 'The checked reader differs from the retained procedure bytes.');
      if (snapshot.bundle.scopeKey !== lessonScopeKey(scope)) access.refuse('TRSH2003', '/scope', 'The checked procedure belongs to another lesson scope.');
      if (view.set) {
        const set = access.checked(await checkLessonRecord<LessonSetRecord>('LessonSetRecord', view.set));
        const raw = await tx.get('lessonSets', lessonScopeKey(scope), set.id);
        if (!raw || !equalsJson(raw, set) || set.payload.bundleHash !== snapshot.bundle.id) access.refuse('TRSH2007', '/read/set', 'The checked lesson set does not bind this retained procedure.');
        await checkedStagedLessonSet(access, tx, set);
      }
      return { value: { snapshot, set: view.set } };
    });
    return must(result);
  }
  async function load(input: LessonMaterializeRequest | LessonRefineRequest, stage: boolean) {
    const captured = request(input, stage), view = await readView();
    const origins = must(await access.apply(captured.proposalIds, async (tx, ids) => {
      const values: CheckedLessonOrigin[] = [];
      for (const id of ids) {
        const proposal = await access.proposal(tx, id);
        if (!proposal) access.refuse('TRSH2002', '/proposalIds', 'The proposal has no retained origin record.');
        if (!equalsJson(proposal.scope, scope)) access.refuse('TRSH2003', '/scope', 'The proposal belongs to another domain or task family.');
        if (proposal.validation.state !== 'proposed' || proposal.parentId || proposal.promotion)
          access.refuse('TRSH2007', '/proposalIds', 'Only original proposals may request a new staged candidate.');
        if (proposal.proposal.baseHash !== view.snapshot.bundle.id) access.refuse('TRSH2007', '/baseHash', 'The active procedure differs from the proposal frozen base.');
        values.push(await checkedLessonOrigin(access, tx, proposal));
      }
      if (values.some(row => row.proposal.decay.hypothesisId !== values[0].proposal.decay.hypothesisId)) access.refuse('TRSH2011', '/decay', 'A candidate binds one registered decay hypothesis.');
      return { value: values };
    }));
    const proposals = origins.map(row => row.proposal), patches = await lessonPatches(proposals, captured.validationRunIds);
    const hidden = [...new Set([...forbidden, ...origins.flatMap(row => [row.proposal.origin.runId, ...row.corroborating.map(lesson => lesson.origin.runId), ...row.topicIds])])];
    const compiler = createLessonCompiler({ snapshot: view.snapshot, patch: patches.at(-1)!, profile, forbidden: hidden, hooks,
      validate: () => {}, commit: async plan => plan });
    const prepared = compiler.prepare();
    if (!prepared.valid || !prepared.plan) throw new LessonFailure(lessonGuardIssues(prepared.errors)[0]);
    const sealed = await sealSkillBundle(prepared.plan.files, { scopeKey: lessonScopeKey(scope), mode: view.snapshot.bundle.mode,
      origin: 'evolved', parentId: view.snapshot.bundle.id, status: 'staged', profile });
    if (!sealed.valid) lessonFail('TRSH2004', '/bundle', 'The native candidate could not be sealed.', sealed.issues[0]);
    const materialized: MaterializedLessonCandidate = { snapshot: sealed.value, patches, compilation: prepared.plan };
    return { captured, view, proposals, origins, hidden, materialized };
  }
  function validateRuns(runs: readonly LessonValidationRun[], origins: readonly CheckedLessonOrigin[], snapshot: SkillSnapshot, proposalIds: string[]) {
    const addresses = new Map<string, LessonValidationRun['rows'][number]>();
    for (const run of runs) {
      if (run.issues.length || run.bundleHash !== snapshot.bundle.id || !equalsJson(sorted(run.proposalIds), proposalIds))
        lessonFail('TRSH2004', '/validationRunIds', 'Held-out validation must bind the exact candidate and proposal set without unresolved issues.');
      for (const row of run.rows) {
        if (origins.some(origin => origin.topicIds.includes(row.topicId) || origin.topicContentHashes.includes(row.topicContentHash)
          || origin.proposal.origin.runId === row.topicId || origin.corroborating.some(lesson => lesson.origin.runId === row.topicId)))
          lessonFail('TRSH2005', '/validationRunIds', 'Held-out inputs overlap a primary or corroborating origin.');
        const prior = addresses.get(row.inputHash);
        if (prior && !equalsJson(prior, row)) lessonFail('TRSH2004', '/rows/inputHash', 'Validation runs disagree on one complete input or retained output.');
        addresses.set(row.inputHash, row);
      }
    }
  }
  async function stage(input: LessonRefineRequest, commit: boolean): Promise<ResearchStoreOutcome<StagedLessonResult> | ResearchOutcome<PreparedLessonCandidate>> {
    const loaded = await load(input, true), { materialized, captured, view, origins, proposals } = loaded;
    const validations = must(await access.apply(captured.validationRunIds, async (tx, ids) => {
      const runs: LessonValidationRun[] = [];
      for (const id of ids) {
        const raw = await tx.get('lessonValidations', lessonScopeKey(scope), id);
        if (!raw) access.refuse('TRSH2004', '/validationRunIds', 'The held-out validation run is missing.');
        const run = await access.validation(tx, raw);
        if (validationView && !equalsJson(validationView.get(id), run)) access.refuse('TRSH2004', '/validationRuns', 'The preloaded validation map is missing or stale.');
        runs.push(run);
      }
      return { value: runs };
    }));
    validateRuns(validations, origins, materialized.snapshot, captured.proposalIds);
    const payload = { runId: materialized.patches.at(-1)!.runId, scopeKey: lessonScopeKey(scope), finalPatchId: materialized.patches.at(-1)!.id,
      bundleId: materialized.snapshot.bundle.id, parentId: view.snapshot.bundle.id, structural: { valid: true, issues: [] },
      semantic: { valid: true, issues: [] }, diffSummary: materialized.compilation.diffSummary, churn: materialized.compilation.churn };
    const candidate: SkillCandidate = { ...payload, id: await researchRevisionOf(payload) };
    const plan: LessonStageInput = { scope, base: view.snapshot, snapshot: materialized.snapshot, patches: materialized.patches, candidate, proposals, validations };
    const compiler = createLessonCompiler({ snapshot: view.snapshot, patch: materialized.patches.at(-1)!, profile,
      forbidden: [...loaded.hidden, ...validations.flatMap(run => run.topicIds)], hooks, expectedFiles: materialized.compilation.files,
      validate: () => validateRuns(validations, origins, materialized.snapshot, captured.proposalIds),
      async commit(compilation) {
        if (!equalsJson(compilation, materialized.compilation)) lessonFail('TRSH2004', '/compiled', 'The final native compilation differs from its preview.');
        const current = await readView();
        if (!equalsJson(current, view)) lessonFail('TRSH2007', '/baseHash', 'The checked active procedure changed before candidate staging.');
        const result = await commitLessonStage(access, plan, profile, options.now);
        if (!result.ok) throw new LessonFailure(result.issue);
        return result;
      } });
    if (!commit) {
      const checked = compiler.prepare();
      return checked.valid ? { valid: true, value: immutableResearchJson({ ...materialized, candidate, validations }) }
        : { valid: false, issues: lessonGuardIssues(checked.errors) };
    }
    const result = await compiler.commit();
    return result.ok && result.value ? result.value : { ok: false, issue: lessonGuardIssues(result.errors, result.cause)[0] };
  }
  function refusal(cause: unknown) { return { valid: false as const, issues: [cause instanceof LessonFailure ? cause.issue
    : researchIssue('TRSH2004', '', 'Lesson preparation could not complete.', cause)] }; }
  return {
    async materialize(input) { try { return { valid: true, value: immutableResearchJson((await load(input, false)).materialized) }; } catch (cause) { return refusal(cause); } },
    async prepare(input) { try { return await stage(input, false) as ResearchOutcome<PreparedLessonCandidate>; } catch (cause) { return refusal(cause); } },
    async commit(input) { try { return await stage(input, true) as ResearchStoreOutcome<StagedLessonResult>; } catch (cause) { return { ok: false, issue: refusal(cause).issues[0] }; } },
  };
}
