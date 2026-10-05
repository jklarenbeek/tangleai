/** Guarded staging publishes native candidates and immutable lesson descendants together. */
import { equalsJson } from '@jarenjs/core/object';
import { compilePatch, applyCompiled, candidateDiff, draftsOf, sealSkillBundle, validateTrace2SkillShape,
  type SkillCandidate, type SkillPatch, type SkillSnapshot, type SkillFormatProfile } from '@tangleai/trace2skill';
import type { LessonSetRecord, LessonValidationRun, ResearchLessonScope, ResearchLessonV2 } from '../contracts.gen.ts';
import { researchRevisionOf } from '../identity.ts';
import type { ResearchTransaction } from '../store.ts';
import type { LessonStoreAccess } from './access.ts';
import { checkedLessonOrigin } from './origins.ts';
import { checkLessonRecord, lessonScopeKey, sealLessonSetRecord, sealResearchLesson } from './records.ts';
import { lessonPatches } from './compile.ts';

export interface LessonStageInput {
  scope: ResearchLessonScope;
  base: SkillSnapshot;
  snapshot: SkillSnapshot;
  patches: SkillPatch[];
  candidate: SkillCandidate;
  proposals: ResearchLessonV2[];
  validations: LessonValidationRun[];
}
export interface StagedLessonResult {
  snapshot: SkillSnapshot;
  candidate: SkillCandidate;
  set: LessonSetRecord;
  staged: ResearchLessonV2[];
  validated: ResearchLessonV2[];
}
const sorted = (values: readonly string[]) => [...values].sort();

async function child(access: LessonStoreAccess, source: ResearchLessonV2, parentId: string, state: 'staged' | 'validated', runIds: string[], at: string) {
  const { id: _id, revision: _revision, ...body } = source;
  return access.checked(await sealResearchLesson({ ...body, parentId, recordedAt: at,
    validation: { state, validationRunIds: runIds, issues: [] }, promotion: null }));
}

/** Used again on replay and by the later outcome boundary; storage alone is no certificate. */
export async function checkedStagedLessonSet(access: LessonStoreAccess, tx: ResearchTransaction, set: LessonSetRecord): Promise<StagedLessonResult> {
  set = access.checked(await checkLessonRecord<LessonSetRecord>('LessonSetRecord', set));
  const scopeKey = lessonScopeKey(set.scope), candidates = await tx.skills.listCandidates(scopeKey);
  const candidate = candidates.find(row => row.id === set.candidateId);
  if (!candidate) access.refuse('TRSH2004', '/candidateId', 'The lesson set has no retained native candidate.');
  const { id: candidateId, ...candidateBody } = candidate;
  if (!validateTrace2SkillShape('skillCandidate', candidate).valid || candidateId !== await researchRevisionOf(candidateBody)
    || candidate.bundleId !== set.payload.bundleHash) access.refuse('TRSH2004', '/candidateId', 'The native candidate does not reproduce the lesson set.');
  const snapshot = await access.storedProcedure(tx, candidate.bundleId, true), base = candidate.parentId ? await access.storedProcedure(tx, candidate.parentId, true) : null;
  if (!base || !snapshot || snapshot.bundle.parentId !== base.bundle.id) access.refuse('TRSH2004', '/bundleHash', 'The staged candidate lost its frozen parent procedure.');
  const patches = await tx.skills.listPatches(candidate.runId), patch = patches.find(row => row.id === candidate.finalPatchId);
  if (!patch) access.refuse('TRSH2004', '/finalPatchId', 'The native candidate has no retained compiled patch.');
  for (const row of [patch, ...patch.sourcePatchIds.map(id => patches.find(patch => patch.id === id))]) {
    if (!row) access.refuse('TRSH2004', '/sourcePatchIds', 'A source patch is missing.');
    const { id, ...body } = row;
    if (!validateTrace2SkillShape('skillPatch', row).valid || id !== await researchRevisionOf(body)
      || row.baseHash !== base.bundle.id || row.runId !== candidate.runId || row.sourceRolloutIds.length || row.supportCount !== 0)
      access.refuse('TRSH2004', '/patch', 'Native patch identity or research attribution changed.');
  }
  const originals: ResearchLessonV2[] = [], staged: ResearchLessonV2[] = [], validated: ResearchLessonV2[] = [];
  const origins = [];
  for (const id of set.proposalIds) {
    const original = await access.proposal(tx, id);
    if (!original || original.validation.state !== 'proposed' || !equalsJson(original.scope, set.scope)) access.refuse('TRSH2004', '/proposalIds', 'The original proposal is missing or belongs to another scope.');
    origins.push(await checkedLessonOrigin(access, tx, original)); originals.push(original);
  }
  for (const id of set.payload.lessonIds) {
    const valid = await access.proposal(tx, id), stage = valid?.parentId ? await access.proposal(tx, valid.parentId) : null;
    const original = stage ? originals.find(row => row.id === stage.parentId) : null;
    if (!valid || !stage || !original) access.refuse('TRSH2004', '/lessonIds', 'The validated lesson has no complete immutable parent chain.');
    if (!equalsJson(stage, await child(access, original, original.id, 'staged', set.validationRunIds, stage.recordedAt))
      || !equalsJson(valid, await child(access, original, stage.id, 'validated', set.validationRunIds, valid.recordedAt)))
      access.refuse('TRSH2004', '/lessonIds', 'The lesson descendants differ from their original proposal and validation binding.');
    staged.push(stage); validated.push(valid);
  }
  if (!equalsJson(sorted(staged.map(row => row.parentId!)), sorted(set.proposalIds))) access.refuse('TRSH2004', '/lessonIds', 'The lesson set does not cover every original proposal exactly.');
  const rows: LessonSetRecord['payload']['rows'] = {};
  const inputs = new Map<string, LessonValidationRun['rows'][number]>();
  for (const id of set.validationRunIds) {
    const raw = await tx.get('lessonValidations', scopeKey, id);
    if (!raw) access.refuse('TRSH2004', '/validationRunIds', 'A retained validation run is missing.');
    const run = await access.validation(tx, raw);
    if (run.issues.length || run.bundleHash !== snapshot.bundle.id || !equalsJson(sorted(run.proposalIds), sorted(set.proposalIds)))
      access.refuse('TRSH2004', '/validationRunIds', 'The validation does not bind this exact staged candidate.');
    for (const row of run.rows) {
      if (origins.some(origin => origin.topicIds.includes(row.topicId) || origin.topicContentHashes.includes(row.topicContentHash)
        || [origin.proposal, ...origin.corroborating].some(lesson => lesson.origin.runId === row.topicId)))
        access.refuse('TRSH2005', '/rows/topicId', 'Held-out data overlaps a primary or corroborating origin.');
      const prior = inputs.get(row.inputHash);
      if (prior && !equalsJson(prior, row)) access.refuse('TRSH2004', '/rows', 'Validation runs disagree on one complete input or retained output.');
      inputs.set(row.inputHash, row);
      rows[row.inputHash] = row.output;
    }
  }
  if (!equalsJson(rows, set.payload.rows) || originals.some(row => row.decay.hypothesisId !== set.payload.decayHypothesisId))
    access.refuse('TRSH2004', '/payload', 'The payload does not reproduce its retained validation rows and registered hypothesis.');
  const expectedPatches = await lessonPatches(originals, set.validationRunIds);
  if (expectedPatches.some(expected => !equalsJson(patches.find(row => row.id === expected.id), expected))
    || !equalsJson(patch, expectedPatches.at(-1)) || patch.runId !== candidate.runId)
    access.refuse('TRSH2004', '/patch', 'The native patches do not reproduce from the original proposals and validation IDs.');
  const forbidden = origins.flatMap(origin => [origin.proposal.origin.runId, ...origin.corroborating.map(lesson => lesson.origin.runId), ...origin.topicIds]);
  const compiled = compilePatch({ bundle: base.bundle, files: draftsOf(base.files) }, patch, { forbidden });
  if (!compiled.valid || compiled.value.withheld.length) access.refuse('TRSH2004', '/patch', 'The retained native patch no longer compiles.');
  const applied = applyCompiled(draftsOf(base.files), compiled.value);
  if (!applied.valid) access.refuse('TRSH2004', '/patch', 'The retained native patch no longer applies.', applied.issues[0]);
  const sealed = await sealSkillBundle(applied.value, { scopeKey, mode: base.bundle.mode, origin: 'evolved', parentId: base.bundle.id, status: 'staged' });
  const diff = candidateDiff(draftsOf(base.files), applied.value, compiled.value);
  if (!sealed.valid || !equalsJson(sealed.value, snapshot) || !equalsJson(candidate.diffSummary, diff.diffSummary)
    || candidate.churn !== diff.churn || !equalsJson(candidate.structural, { valid: true, issues: [] }) || !equalsJson(candidate.semantic, { valid: true, issues: [] }))
    access.refuse('TRSH2004', '/candidate', 'The retained procedure or candidate receipt differs from its exact compiled edit.');
  return { snapshot, candidate, set, staged, validated };
}

export async function commitLessonStage(access: LessonStoreAccess, input: LessonStageInput, profile: SkillFormatProfile, now: () => string) {
  return access.apply(input, async (tx, plan) => {
    const scopeKey = lessonScopeKey(plan.scope);
    const base = await access.storedProcedure(tx, plan.base.bundle.id, true);
    if (!equalsJson(base, plan.base)) access.refuse('TRSH2007', '/baseHash', 'The frozen procedure changed before staging.');
    for (const lesson of plan.proposals) {
      if (!equalsJson(await access.proposal(tx, lesson.id), lesson)) access.refuse('TRSH2002', '/proposalIds', 'A prepared proposal differs from retained content.');
      await checkedLessonOrigin(access, tx, lesson);
    }
    for (const run of plan.validations) {
      const raw = await tx.get('lessonValidations', scopeKey, run.id);
      if (!raw || !equalsJson(await access.validation(tx, raw), run)) access.refuse('TRSH2004', '/validationRunIds', 'A held-out validation changed before staging.');
    }
    const compiled = compilePatch({ bundle: plan.base.bundle, files: draftsOf(plan.base.files) }, plan.patches.at(-1)!, { profile });
    if (!compiled.valid || compiled.value.withheld.length) access.refuse('TRSH2004', '/patch', 'The native staged patch no longer compiles.');
    const applied = applyCompiled(draftsOf(plan.base.files), compiled.value, profile);
    if (!applied.valid) access.refuse('TRSH2004', '/patch', 'The native staged patch no longer applies.', applied.issues[0]);
    const sealed = await sealSkillBundle(applied.value, { scopeKey, mode: plan.base.bundle.mode, origin: 'evolved', parentId: plan.base.bundle.id, status: 'staged', profile });
    if (!sealed.valid || !equalsJson(sealed.value, plan.snapshot)) access.refuse('TRSH2004', '/bundleHash', 'The held-out snapshot differs from the exact compiled edit.');
    for (const raw of await tx.list('lessonSets', scopeKey)) {
      const retained = access.checked(await checkLessonRecord<LessonSetRecord>('LessonSetRecord', raw));
      if (retained.candidateId !== plan.candidate.id) continue;
      if (!equalsJson(sorted(retained.proposalIds), sorted(plan.proposals.map(row => row.id)))
        || !equalsJson(sorted(retained.validationRunIds), sorted(plan.validations.map(row => row.id))))
        access.refuse('TRSH2004', '/candidateId', 'A staged candidate already binds different source records.');
      return { value: await checkedStagedLessonSet(access, tx, retained), replayed: true };
    }
    for (const patch of plan.patches) {
      const written = await tx.skills.putPatch(patch);
      if (!written.valid) access.refuse('TRSH2004', '/patch', 'Native patch storage refused the candidate.', written.issues[0]);
    }
    const written = await tx.skills.putStagedCandidate(plan.snapshot, plan.candidate);
    if (!written.valid) access.refuse('TRSH2004', '/candidate', 'Native candidate storage refused the procedure.', written.issues[0]);
    const staged: ResearchLessonV2[] = [], validated: ResearchLessonV2[] = [], at = now();
    const runIds = sorted(plan.validations.map(row => row.id));
    for (const original of plan.proposals) {
      const stage = await child(access, original, original.id, 'staged', runIds, at), valid = await child(access, original, stage.id, 'validated', runIds, at);
      await tx.put('lessons', original.projectId, stage.id, stage); await tx.put('lessons', original.projectId, valid.id, valid);
      staged.push(stage); validated.push(valid);
    }
    const rows = Object.fromEntries(plan.validations.flatMap(run => run.rows.map(row => [row.inputHash, row.output])));
    const set = access.checked(await sealLessonSetRecord({ scope: plan.scope, candidateId: plan.candidate.id,
      proposalIds: sorted(plan.proposals.map(row => row.id)), validationRunIds: runIds,
      payload: { bundleHash: plan.snapshot.bundle.id, lessonIds: sorted(validated.map(row => row.id)), decayHypothesisId: plan.proposals[0].decay.hypothesisId, rows } }));
    const prior = await tx.get('lessonSets', scopeKey, set.id);
    if (prior && !equalsJson(prior, set)) access.refuse('TRSH2001', '/lessonSet/id', 'The lesson set address already has different immutable metadata.');
    await tx.put('lessonSets', scopeKey, set.id, set);
    return { value: await checkedStagedLessonSet(access, tx, set) };
  });
}
