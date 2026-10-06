/** Assign complete source families before rendering any training example. */
import { deepFreeze, equalsJson } from '@jarenjs/core/object';
import { mulberry32, drawDistinct } from '@jarenjs/core/random';
import { canonicalizeJson, canonicalSha256 } from '@jarenjs/json/canonical';
import { compileJtltStylesheet } from '@jarenjs/json/jtlt';
import defaultTemplate from '../templates/experience-example.jtlt.json' with { type: 'json' };
import { checkExperientialRecord, sealExperientialRecord } from './identity.ts';
import { validateExperientialShape } from './schema.ts';
import { refuseExperiential, type ExperientialResult } from './errors.ts';
import { planExperientialSelection, type ExperientialSelectionPlan } from './selection.ts';
import { experientialGroups, type ExperientialGrouping } from './grouping.ts';
import type { ExperientialDataset, ExperientialExperience, ExperientialAssessment, ExperientialEvaluationReferences,
  ExperientialExampleVariables, ExperientialRenderedExample } from './contracts.gen.ts';

export const EXPERIENTIAL_EXAMPLE_TEMPLATE = deepFreeze(defaultTemplate);
export interface ExperientialDatasetOptions {
  seed: number;
  splitRatios: { validation: number; replay: number };
  groupKeyOf(experience: ExperientialExperience): { sourceEpisodeId: string; duplicateFamilyId: string };
  holdoutPairsOf(experience: ExperientialExperience): readonly (readonly string[])[];
  conceptsOf(experience: ExperientialExperience): readonly string[];
  template: unknown;
  tokenizerIdentity: string;
  chatTemplateIdentity: string;
  recordedAt: string;
  evaluationReferences?: ExperientialEvaluationReferences;
}
export interface ExperientialDatasetPlan {
  dataset: ExperientialDataset;
  experiences: ExperientialExperience[];
  assessments: ExperientialAssessment[];
  grouping: ExperientialGrouping;
}
const ordered = (ids: readonly string[]) => [...ids].sort();
const pairKey = (ids: readonly string[]) => canonicalizeJson(ordered(ids));
const failure = (path: string, detail: string) => refuseExperiential('TEXP1011', path, detail);

/** Manifest projection includes authority, grouping and external evaluation references. */
export function experientialDatasetManifest(dataset: Omit<ExperientialDataset, 'id' | 'manifestDigest'>) {
  const { selectedIds, assessmentIds, splits, groupKeys, concepts, seed, templateRevision, tokenizerIdentity,
    chatTemplateIdentity, selection, evaluationReferences, exclusions, scope, heldoutPairs, groupingExperienceIds, groupingAssessmentIds } = dataset;
  return { selectedIds, assessmentIds, splits, groupKeys, concepts, seed, templateRevision, tokenizerIdentity,
    chatTemplateIdentity, selection, evaluationReferences, exclusions, scope, heldoutPairs, groupingExperienceIds, groupingAssessmentIds };
}

export async function planExperientialDataset(selection: ExperientialSelectionPlan, options: ExperientialDatasetOptions): Promise<ExperientialResult<ExperientialDatasetPlan>> {
  let plan: ExperientialSelectionPlan, template: unknown, external: ExperientialEvaluationReferences;
  try {
    plan = JSON.parse(canonicalizeJson(selection)); template = JSON.parse(canonicalizeJson(options.template));
    external = JSON.parse(canonicalizeJson(options.evaluationReferences ?? { compositionalHoldout: [], replay: [] }));
  } catch { return failure('', 'Dataset inputs must be finite JSON.'); }
  if (!plan || !Array.isArray(plan.selected) || !Array.isArray(plan.assessments) || !Array.isArray(plan.cohort)
    || !Array.isArray(plan.reviews) || !Array.isArray(plan.excluded) || !Array.isArray(plan.quarantined))
    return failure('/selection', 'A complete selection plan is required.');
  const { seed, tokenizerIdentity, chatTemplateIdentity, recordedAt, groupKeyOf, conceptsOf, holdoutPairsOf } = options;
  const ratios = { ...options.splitRatios };
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || Object.values(ratios).some(n => !Number.isFinite(n) || n < 0 || n >= 1)
    || ratios.validation + ratios.replay >= 1) return failure('/splitRatios', 'A uint32 seed and disjoint bounded split ratios are required.');
  const evidence = validateExperientialShape<NonNullable<ExperientialDataset['selection']>>('ExperientialSelectionEvidence', plan.evidence);
  if (!evidence.ok) return evidence;
  if (!equalsJson(plan.counts, evidence.value.counts) || plan.counts.selected !== plan.selected.length
    || plan.counts.excluded !== plan.excluded.length || plan.counts.quarantined !== plan.quarantined.length)
    return failure('/selection/counts', 'Selection records and counts do not reconcile.');
  const checked = await planExperientialSelection({ experiences: plan.selected, assessments: plan.assessments,
    approvals: plan.evidence.approvals, policy: plan.evidence.policy, trustView: plan.evidence.trustView });
  if (!checked.ok) return checked;
  if (checked.value.counts.selected !== plan.selected.length || !plan.selected.length)
    return failure('/selection', 'Every selected experience must still have independent evidence and approval.');
  const selectionEvidence = evidence.value, experiences = checked.value.selected;
  const externalCheck = validateExperientialShape<ExperientialEvaluationReferences>('ExperientialEvaluationReferences', external);
  if (!externalCheck.ok) return externalCheck;
  external = externalCheck.value;
  const ids = new Set(experiences.map(e => e.id)), groupKeys: ExperientialDataset['groupKeys'] = [], concepts: NonNullable<ExperientialDataset['concepts']> = [];
  const holdout = new Set<string>(), heldPairs = new Map<string, string[]>();
  for (const partition of ['compositionalHoldout', 'replay'] as const) for (const reference of external[partition]) {
    if (reference.scope !== selectionEvidence.policy.scope || reference.partition !== (partition === 'replay' ? 'replay' : 'compositional-holdout')
      || ids.has(reference.id) || reference.experienceIds.some(id => ids.has(id)))
      return failure('/evaluationReferences', 'External evaluation questions cannot be selected experiences or cross scope.');
    if (partition === 'compositionalHoldout') heldPairs.set(pairKey(reference.conceptIds), ordered(reference.conceptIds));
  }
  const allExternal = [...external.compositionalHoldout, ...external.replay];
  if (new Set(allExternal.map(r => r.id)).size !== allExternal.length) return failure('/evaluationReferences', 'An evaluation item occurs in multiple partitions.');
  for (const e of experiences) {
    const group = groupKeyOf(deepFreeze(structuredClone(e))), episodeIds = e.sourceRefs.filter(ref => ref.kind === 'episode').map(ref => ref.sourceId);
    if (!episodeIds.length || !episodeIds.includes(group.sourceEpisodeId)) return failure('/groupKeys', 'A host grouping must name a retained source episode.');
    // A paraphrase cannot escape a retained episode by using another host label.
    if (episodeIds.length !== 1) return failure('/groupKeys', 'Multi-episode experiences need a single retained aggregate episode.');
    groupKeys.push({ experienceId: e.id, ...group });
    const conceptIds = ordered(conceptsOf(deepFreeze(structuredClone(e))));
    if (new Set(conceptIds).size !== conceptIds.length) return failure('/concepts', 'Concept identities must be distinct.');
    concepts.push({ experienceId: e.id, conceptIds });
    const pairs = holdoutPairsOf(deepFreeze(structuredClone(e)));
    for (const pair of pairs) {
      if (!pair.length || pair.some(id => !conceptIds.includes(id))) return failure('/compositionalHoldout', 'A held pair must belong to its experience.');
      heldPairs.set(pairKey(pair), ordered(pair)); holdout.add(e.id);
    }
  }
  for (const row of concepts) if ([...heldPairs.values()].some(pair => pair.every(id => row.conceptIds.includes(id)))) holdout.add(row.experienceId);
  const grouping: ExperientialGrouping = { experiences: plan.cohort.filter(e => e.scope === selectionEvidence.policy.scope),
    assessments: plan.reviews.filter(a => a.scope === selectionEvidence.policy.scope && a.policyRevision === selectionEvidence.policy.revision) };
  const connected = await experientialGroups(grouping, groupKeys, selectionEvidence.policy.scope, selectionEvidence.policy.revision);
  if (!connected.ok) return connected;
  const groups = connected.value;
  const splits: ExperientialDataset['splits'] = { train: [], validation: [], compositionalHoldout: [], replay: [] };
  const available: string[][] = [];
  for (const group of groups) {
    if (group.some(id => holdout.has(id))) splits.compositionalHoldout.push(...group);
    else available.push(group);
  }
  const random = mulberry32(seed), draw = (count: number, target: 'validation' | 'replay') => {
    const chosen = new Set(drawDistinct(random, available.length, count));
    for (let i = available.length - 1; i >= 0; i--) if (chosen.has(i)) splits[target].push(...available.splice(i, 1)[0]);
  };
  const size = available.length;
  draw(Math.floor(size * ratios.validation), 'validation'); draw(Math.floor(size * ratios.replay), 'replay');
  splits.train.push(...available.flat()); for (const partition of Object.values(splits)) partition.sort();
  deepFreeze(splits);
  const templateRevision = await canonicalSha256(template);
  const body = { document: 'experiential-dataset' as const, schemaVersion: 1 as const, scope: selectionEvidence.policy.scope, recordedAt,
    selectedIds: ordered([...ids]), assessmentIds: ordered(checked.value.assessments.map(a => a.id)), splits, groupKeys, concepts, seed,
    templateRevision, tokenizerIdentity, chatTemplateIdentity, selection: selectionEvidence, evaluationReferences: external,
    heldoutPairs: [...heldPairs].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([, pair]) => pair),
    groupingExperienceIds: ordered(grouping.experiences.map(e => e.id)), groupingAssessmentIds: ordered(grouping.assessments.map(a => a.id)),
    exclusions: { total: plan.counts.excluded + plan.counts.quarantined, byReason: { ...plan.counts.byReason } } };
  const dataset = await sealExperientialRecord('dataset', { ...body, manifestDigest: await canonicalSha256(experientialDatasetManifest(body)) });
  if (!dataset.ok) return dataset;
  return { ok: true, value: deepFreeze({ dataset: dataset.value, experiences, assessments: checked.value.assessments, grouping }) };
}

/** Rechecked on persistence and rendering; a freshly rehashed split is still subject to leakage policy. */
export async function checkExperientialDataset(dataset: ExperientialDataset, experiences: readonly ExperientialExperience[],
  assessments: readonly ExperientialAssessment[], grouping: ExperientialGrouping = { experiences: [...experiences], assessments: [...assessments] }): Promise<ExperientialResult<ExperientialDataset>> {
  try {
    experiences = JSON.parse(canonicalizeJson(experiences)); assessments = JSON.parse(canonicalizeJson(assessments));
    grouping = JSON.parse(canonicalizeJson(grouping));
  } catch { return failure('/selection', 'Retained dataset bindings must be finite JSON.'); }
  const checked = await checkExperientialRecord('dataset', dataset);
  if (!checked.ok) return checked;
  const row = checked.value;
  if (!row.selection || !row.evaluationReferences || !row.concepts || !row.heldoutPairs || !row.groupingExperienceIds || !row.groupingAssessmentIds)
    return failure('/selection', 'Retained selection authority, concept assignments and evaluation references are required.');
  if (await canonicalSha256(experientialDatasetManifest(row)) !== row.manifestDigest)
    return failure('/manifestDigest', 'The complete dataset manifest does not reproduce.');
  const selected = ordered(row.selectedIds), splitIds = Object.values(row.splits).flat(), groups = row.groupKeys;
  if (!equalsJson(selected, ordered(experiences.map(e => e.id))) || !equalsJson(selected, ordered(splitIds)) || new Set(splitIds).size !== splitIds.length
    || !equalsJson(selected, ordered(groups.map(g => g.experienceId))) || !equalsJson(selected, ordered(row.concepts.map(c => c.experienceId)))
    || !equalsJson(ordered(row.assessmentIds), ordered(assessments.map(a => a.id))))
    return failure('/splits', 'Every selected experience requires one assessment, grouping, concept row and partition.');
  const review = await planExperientialSelection({ experiences, assessments, ...row.selection });
  if (!review.ok) return review;
  if (review.value.counts.selected !== experiences.length || row.selection.policy.scope !== row.scope)
    return failure('/selection', 'The retained selection no longer admits every dataset member.');
  const splitOf = (id: string) => Object.entries(row.splits).find(([, ids]) => ids.includes(id))?.[0];
  if (!equalsJson(row.groupingExperienceIds, ordered(grouping.experiences.map(e => e.id)))
    || !equalsJson(row.groupingAssessmentIds, ordered(grouping.assessments.map(a => a.id))))
    return failure('/groupingExperienceIds', 'The original grouping ancestry must remain resolvable.');
  const connected = await experientialGroups(grouping, groups, row.scope, row.selection.policy.revision);
  if (!connected.ok) return connected;
  if (connected.value.some(group => new Set(group.map(splitOf)).size !== 1)) return failure('/splits', 'A transitive episode or duplicate family straddles partitions.');
  for (const group of groups) {
    const e = experiences.find(e => e.id === group.experienceId)!;
    const episodes = e.sourceRefs.filter(ref => ref.kind === 'episode').map(ref => ref.sourceId);
    if (episodes.length !== 1 || episodes[0] !== group.sourceEpisodeId)
      return failure('/groupKeys', 'Grouping differs from the retained source episode.');
    for (const other of groups) if ((group.sourceEpisodeId === other.sourceEpisodeId || group.duplicateFamilyId === other.duplicateFamilyId)
      && splitOf(group.experienceId) !== splitOf(other.experienceId)) return failure('/splits', 'An episode or duplicate family straddles partitions.');
  }
  for (const concept of row.concepts) if (row.heldoutPairs.some(pair => pair.every(id => concept.conceptIds.includes(id)))
    && splitOf(concept.experienceId) !== 'compositionalHoldout') return failure('/splits/train', 'A held-out concept pair escaped its reserved partition.');
  const external = [...row.evaluationReferences.compositionalHoldout, ...row.evaluationReferences.replay];
  if (new Set(external.map(r => r.id)).size !== external.length || external.some(r => r.scope !== row.scope || selected.includes(r.id)
    || r.experienceIds.some(id => selected.includes(id)))) return failure('/evaluationReferences', 'External evaluation aliases selected experience data.');
  for (const ref of row.evaluationReferences.compositionalHoldout) if (ref.partition !== 'compositional-holdout'
    || !row.heldoutPairs.some(pair => equalsJson(pair, ordered(ref.conceptIds)))) return failure('/evaluationReferences', 'A compositional reference has no reserved concept pair.');
  if (row.evaluationReferences.replay.some(ref => ref.partition !== 'replay')) return failure('/evaluationReferences', 'A replay reference has the wrong partition.');
  if (Object.entries(row.selection.counts.byReason).some(([key, count]) => (row.exclusions.byReason[key] ?? 0) !== count)
    || Object.keys(row.exclusions.byReason).some(key => !Object.hasOwn(row.selection!.counts.byReason, key)))
    return failure('/exclusions', 'Dataset exclusions must preserve the complete selection census.');
  return checked;
}

export async function renderExperientialExamples(plan: ExperientialDatasetPlan, template: unknown,
  variables: readonly ExperientialExampleVariables[]): Promise<ExperientialResult<{ train: ExperientialRenderedExample[]; validation: ExperientialRenderedExample[] }>> {
  let stable: ExperientialDatasetPlan, sheet: unknown, supplied: ExperientialExampleVariables[];
  try { stable = JSON.parse(canonicalizeJson(plan)); sheet = JSON.parse(canonicalizeJson(template)); supplied = JSON.parse(canonicalizeJson(variables)); }
  catch { return failure('', 'Rendering accepts only immutable JSON inputs.'); }
  if (!stable || !Array.isArray(stable.experiences) || !Array.isArray(stable.assessments) || !stable.grouping || !Array.isArray(supplied))
    return failure('', 'A complete dataset plan and bounded example variables are required.');
  const record = await checkExperientialDataset(stable.dataset, stable.experiences, stable.assessments, stable.grouping);
  if (!record.ok) return record;
  const dataset = record.value, needed = [...dataset.splits.train, ...dataset.splits.validation];
  if (!dataset.selection || !dataset.evaluationReferences || !dataset.concepts || !dataset.heldoutPairs)
    return failure('/selection', 'A dataset must retain selection authority and evaluation bindings before rendering.');
  if (await canonicalSha256(sheet) !== dataset.templateRevision || await canonicalSha256(experientialDatasetManifest(dataset)) !== dataset.manifestDigest)
    return failure('/templateRevision', 'The dataset or pinned stylesheet changed after partitioning.');
  if (supplied.length !== needed.length || new Set(supplied.map(v => v.experienceId)).size !== supplied.length
    || supplied.some(v => !needed.includes(v.experienceId))) return failure('/variables', 'Only the exact train and validation examples may be rendered.');
  const inputs = new Map<string, ExperientialExampleVariables>();
  for (const raw of supplied) {
    const shape = validateExperientialShape<ExperientialExampleVariables>('ExperientialExampleVariables', raw);
    if (!shape.ok) return shape;
    const { experienceId, question, answer } = shape.value, e = stable.experiences.find(e => e.id === experienceId);
    if (!e || await canonicalSha256({ question, answer }) !== e.contentDigest) return failure('/variables', 'Example text does not reproduce its selected content digest.');
    inputs.set(experienceId, shape.value);
  }
  const output: { train: ExperientialRenderedExample[]; validation: ExperientialRenderedExample[] } = { train: [], validation: [] };
  try {
    const render = compileJtltStylesheet(sheet);
    for (const split of ['train', 'validation'] as const) for (const id of dataset.splits[split]) {
      const example = validateExperientialShape<ExperientialRenderedExample>('ExperientialRenderedExample', JSON.parse(render(inputs.get(id))));
      if (!example.ok) return example;
      output[split].push(example.value);
    }
  } catch { return failure('/template', 'The pinned JTLT renderer did not produce a valid example.'); }
  return { ok: true, value: deepFreeze(output) };
}
