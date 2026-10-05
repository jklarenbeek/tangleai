/** Retained validation supplies synchronous interpretation; outcomes owns promotion. */
import { equalsJson } from '@jarenjs/core/object';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { adapterIdentity, type OutcomeAdapter, type Issue, type Json, type Scope } from '@tangleai/outcomes';
import type { LessonOutcomeInput, LessonSet, LessonSetRecord, LessonValidationRun, LessonValidityOutput, ResearchLessonScope } from '../contracts.gen.ts';
import type { ResearchOutcome } from '../errors.ts';
import { researchRefuse } from '../errors.ts';
import { immutableResearchJson } from '../identity.ts';
import { researchSchemaOf, validateResearchShape } from '../schema.ts';
import type { ResearchStore, ResearchTransaction } from '../store.ts';
import { lessonStoreAccess, type LessonStoreAccess } from './access.ts';
import { lessonScopeKey, lessonValidity } from './records.ts';
import { checkedStagedLessonSet } from './stage.ts';

export const researchLessonOutcomeScope = (scope: ResearchLessonScope): Scope =>
  ({ namespace: 'research-lessons', domain: scope.domainProfileId, subject: scope.taskFamily });
export const researchLessonArtifactKey = (scope: ResearchLessonScope): string => 'research-lessons/' + scope.domainProfileId;
export const LESSON_MISSING_OUTPUT: Readonly<LessonValidityOutput> = Object.freeze({ claimSupport: 0, registryAccuracy: 0, preregistrationIntegrity: 0, completion: false });

export interface ResearchLessonAdapterOptions {
  store: ResearchStore;
  scope: ResearchLessonScope;
  baseBundleHash: string;
  /** The entire immutable baseline pool, including later disjoint evaluation slots. */
  validationRunIds: readonly string[];
  /** Every retained candidate or historical payload this adapter may inspect. */
  lessonSetIds: readonly string[];
}

export async function readOutcomeLessonSet(access: LessonStoreAccess, tx: ResearchTransaction, scope: ResearchLessonScope, id: string) {
  const raw = await tx.get('lessonSets', lessonScopeKey(scope), id);
  if (!raw || !equalsJson(raw.scope, scope)) access.refuse('TRSH2004', '/lessonSetIds', 'The lesson set is absent from this exact scope.');
  return checkedStagedLessonSet(access, tx, raw!);
}

/** No model, resolver, hash or persistence I/O occurs in the adapter's three hooks. */
export async function createResearchLessonAdapter(options: ResearchLessonAdapterOptions): Promise<ResearchOutcome<OutcomeAdapter>> {
  const access: LessonStoreAccess = lessonStoreAccess(options.store.lessons);
  let request: Omit<ResearchLessonAdapterOptions, 'store'>;
  try { request = immutableResearchJson({ scope: options.scope, baseBundleHash: options.baseBundleHash,
    validationRunIds: options.validationRunIds, lessonSetIds: options.lessonSetIds }); }
  catch (cause) { return researchRefuse('TRSH2001', '', 'Adapter bindings must be finite JSON.', cause); }
  if (!validateResearchShape('ResearchLessonScope', request.scope).valid || !validateResearchShape('Sha256', request.baseBundleHash).valid
    || [request.validationRunIds, request.lessonSetIds].some(ids => !Array.isArray(ids) || ids.length > 64
      || new Set(ids).size !== ids.length || ids.some(id => !validateResearchShape('Sha256', id).valid)) || !request.validationRunIds.length)
    return researchRefuse('TRSH2001', '', 'The adapter requires a scope, frozen base and bounded distinct retained record IDs.');
  const loaded = await access.apply(request, async (tx, input) => {
    const base = await access.storedProcedure(tx, input.baseBundleHash, true);
    if (base!.bundle.scopeKey !== lessonScopeKey(input.scope)) access.refuse('TRSH2003', '/baseBundleHash', 'The baseline procedure belongs to another scope.');
    const runs: LessonValidationRun[] = [], sets: LessonSetRecord[] = [];
    for (const id of input.validationRunIds) {
      const raw = await tx.get('lessonValidations', lessonScopeKey(input.scope), id);
      if (!raw || !equalsJson(raw.scope, input.scope)) access.refuse('TRSH2004', '/validationRunIds', 'The retained validation belongs to another scope or is missing.');
      const run = await access.validation(tx, raw);
      if (run.issues.length) access.refuse('TRSH2004', '/validationRunIds', 'An unresolved validation cannot supply outcome interpretation.');
      runs.push(run);
    }
    for (const id of input.lessonSetIds) {
      const staged = await readOutcomeLessonSet(access, tx, input.scope, id);
      if (staged.set.validationRunIds.some(id => !input.validationRunIds.includes(id)))
        access.refuse('TRSH2004', '/validationRunIds', 'Every candidate validation must be explicitly preloaded.');
      sets.push(staged.set);
    }
    return { value: { runs, sets } };
  });
  if (!loaded.ok) return { valid: false, issues: [loaded.issue] };
  const bindings = new Map<string, { topicId: string; input: unknown; contentHash: string; domain: string; truth: LessonValidityOutput }>();
  const topics = new Map<string, string>(), baselineRows: LessonSet['rows'] = {};
  for (const run of loaded.value.runs) for (const row of run.rows) {
    const binding = { topicId: row.topicId, input: row.input, contentHash: row.topicContentHash,
      domain: row.domain ?? request.scope.domainProfileId, truth: row.truth };
    const previous = bindings.get(row.inputHash);
    if (previous && !equalsJson(previous, binding) || topics.has(row.topicId) && topics.get(row.topicId) !== row.inputHash)
      return researchRefuse('TRSH2004', '/rows/inputHash', 'A topic or short input address cannot alias different complete content, truth or domain.');
    bindings.set(row.inputHash, binding); topics.set(row.topicId, row.inputHash);
    if (run.baseBundleHash === request.baseBundleHash) {
      if (Object.hasOwn(baselineRows, row.inputHash) && !equalsJson(baselineRows[row.inputHash], row.baselineOutput))
        return researchRefuse('TRSH2004', '/rows/baselineOutput', 'The immutable base has conflicting retained outputs.');
      baselineRows[row.inputHash] = row.baselineOutput;
    }
  }
  if (!Object.keys(baselineRows).length) return researchRefuse('TRSH2004', '/baseBundleHash', 'The static baseline needs actual retained output rows.');
  const staticPayload: LessonSet = immutableResearchJson({ bundleHash: request.baseBundleHash, lessonIds: [], decayHypothesisId: 'none', rows: baselineRows });
  const payloads = new Set([canonicalizeJson(staticPayload), ...loaded.value.sets.map(set => canonicalizeJson(set.payload))]);
  const schemas = { input: researchSchemaOf('LessonOutcomeInput'), output: researchSchemaOf('LessonValidityOutput'),
    resolution: researchSchemaOf('LessonValidityOutput'), artifact: researchSchemaOf('LessonSet') };
  const badPayload = (): Issue[] => [{ code: 'OUTC1010', path: '/payload', retryable: false,
    detail: 'The payload must reproduce a retained procedure, validated lesson chain and exact recorded validation outputs.' }];
  const identity = await adapterIdentity('research-lessons/v1', schemas, immutableResearchJson({
    scope: request.scope, staticPayload, inputs: [...bindings].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
    interpreter: 'synchronous exact topic and short-address lookup over preloaded full-content bindings; missing output is failure',
    scorer: 'validity product: positive value equal to independent truth is success, positive lower value is partial, otherwise failure; completion is secondary',
  }) as unknown as Json);
  const adapter: OutcomeAdapter = {
    identity, schemas, staticPayload: staticPayload as unknown as Json,
    validatePayload(raw) {
      const value = validateResearchShape<LessonSet>('LessonSet', raw);
      return value.valid && payloads.has(canonicalizeJson(value.value)) ? [] : badPayload();
    },
    interpret(raw, payload) {
      const input = validateResearchShape<LessonOutcomeInput>('LessonOutcomeInput', raw), set = validateResearchShape<LessonSet>('LessonSet', payload);
      if (!input.valid || !set.valid || !payloads.has(canonicalizeJson(set.value))
        || bindings.get(input.value.inputHash)?.topicId !== input.value.topicId || !Object.hasOwn(set.value.rows, input.value.inputHash))
        return LESSON_MISSING_OUTPUT as unknown as Json;
      return set.value.rows[input.value.inputHash] as unknown as Json;
    },
    score(raw, evidence): ReturnType<OutcomeAdapter['score']> {
      const actual = validateResearchShape<LessonValidityOutput>('LessonValidityOutput', raw), expected = validateResearchShape<LessonValidityOutput>('LessonValidityOutput', evidence);
      if (!actual.valid || !expected.valid) return { outcome: 'failure', diagnostics: { invalid: true } };
      const score = lessonValidity(actual.value), truth = lessonValidity(expected.value);
      return { outcome: score > 0 && score === truth ? 'success' : score > 0 && score < truth ? 'partial' : 'failure',
        diagnostics: { validity: score, truth, completion: actual.value.completion } };
    },
  };
  return { valid: true, value: Object.freeze(adapter) };
}
