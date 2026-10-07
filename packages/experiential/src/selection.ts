/** Stable exclusions and independent review precede every training-data selection. */
import { deepFreeze } from '@jarenjs/core/object';
import { canonicalizeJson, canonicalSha256 } from '@jarenjs/json/canonical';
import { experientialSchema, validateExperientialShape } from './schema.ts';
import { checkExperientialRecord } from './identity.ts';
import { refuseExperiential, type ExperientialResult } from './errors.ts';
import { taintOf } from './trust.ts';
import type { ExperientialExperience, ExperientialAssessment, ExperientialExclusionReason, ExperientialSelectionPolicy,
  ExperientialSelectionApproval, ExperientialSelectionCounts, ExperientialTrustView, ExperientialSelectionEvidence } from './contracts.gen.ts';

export const EXPERIENTIAL_EXCLUSION_REASONS = deepFreeze([...experientialSchema.$defs.ExperientialExclusionReason.enum]);
export interface ExperientialSelectionInput {
  experiences: readonly ExperientialExperience[];
  assessments: readonly ExperientialAssessment[];
  approvals: readonly ExperientialSelectionApproval[];
  policy: ExperientialSelectionPolicy;
  trustView: ExperientialTrustView;
}
export interface ExperientialSelectionPlan {
  selected: ExperientialExperience[];
  assessments: ExperientialAssessment[];
  cohort: ExperientialExperience[];
  reviews: ExperientialAssessment[];
  excluded: { id: string; reason: ExperientialExclusionReason }[];
  quarantined: { id: string; reason: ExperientialExclusionReason }[];
  counts: ExperientialSelectionCounts;
  evidence: ExperientialSelectionEvidence;
}

export async function sealExperientialSelectionPolicy(input: Omit<ExperientialSelectionPolicy, 'revision'>): Promise<ExperientialResult<ExperientialSelectionPolicy>> {
  const shape = validateExperientialShape<ExperientialSelectionPolicy>('ExperientialSelectionPolicy', { ...input, revision: '0'.repeat(64) });
  if (!shape.ok) return shape;
  const { revision: _, ...body } = shape.value;
  return { ok: true, value: deepFreeze({ ...body, revision: await canonicalSha256(body) }) };
}

export async function planExperientialSelection(rawInput: ExperientialSelectionInput): Promise<ExperientialResult<ExperientialSelectionPlan>> {
  let input: ExperientialSelectionInput;
  try { input = JSON.parse(canonicalizeJson(rawInput)); }
  catch { return refuseExperiential('TEXP1001', '', 'Selection accepts finite JSON inputs.'); }
  if (!Array.isArray(input?.experiences) || !Array.isArray(input?.assessments) || !Array.isArray(input?.approvals))
    return refuseExperiential('TEXP1001', '', 'Selection requires bounded experience, assessment and approval arrays.');
  if ([input.experiences, input.assessments, input.approvals].some(rows => rows.length > 4096)
    || input.experiences.some((e: unknown) => e === null || typeof e !== 'object' || Array.isArray(e)
      || typeof (e as ExperientialExperience).id !== 'string' || !/^[a-f0-9]{64}$/.test((e as ExperientialExperience).id)))
    return refuseExperiential('TEXP1001', '/experiences', 'Selection requires bounded records with content addresses.');
  const checked = validateExperientialShape<ExperientialSelectionPolicy>('ExperientialSelectionPolicy', input?.policy);
  const view = validateExperientialShape<ExperientialTrustView>('ExperientialTrustView', input?.trustView);
  if (!checked.ok) return checked;
  if (!view.ok) return view;
  const { revision, ...body } = checked.value;
  if (await canonicalSha256(body) !== revision) return refuseExperiential('TEXP1002', '/policy/revision', 'Selection policy content changed.');
  const approvals: ExperientialSelectionApproval[] = [], assessments: ExperientialAssessment[] = [];
  for (const raw of input.approvals) {
    const a = validateExperientialShape<ExperientialSelectionApproval>('ExperientialSelectionApproval', raw);
    if (!a.ok) return a; approvals.push(a.value);
  }
  for (const raw of input.assessments) {
    const a = await checkExperientialRecord('assessment', raw);
    if (!a.ok) return a; assessments.push(a.value);
  }
  const counts: ExperientialSelectionCounts = { input: input.experiences.length, selected: 0, excluded: 0, quarantined: 0,
    byReason: Object.fromEntries(EXPERIENTIAL_EXCLUSION_REASONS.filter(reason => reason !== 'archived').map(reason => [reason, 0])) as unknown as ExperientialSelectionCounts['byReason'] };
  const plan: ExperientialSelectionPlan = { selected: [], assessments: [], cohort: [], reviews: assessments, excluded: [], quarantined: [], counts,
    evidence: { policy: checked.value, approvals: [], trustView: view.value, counts } };
  const seen = new Set<string>(), digests = new Set<string>();
  for (const raw of [...input.experiences].sort((a, b) => a.id.localeCompare(b.id, 'en'))) {
    if (seen.has(raw.id)) return refuseExperiential('TEXP1002', '/experiences', 'Repeated experience identity.');
    seen.add(raw.id);
    let reason: ExperientialExclusionReason | null = null;
    if (Array.isArray(raw.sourceRefs) && raw.sourceRefs.some((source: unknown) => typeof source === 'string')) reason = 'legacy-evidence';
    const shape = reason ? null : await checkExperientialRecord('experience', raw);
    if (shape && !shape.ok) return shape;
    const e = shape?.ok ? shape.value : raw, taint = reason ? null : taintOf(e, view.value);
    if (shape?.ok) plan.cohort.push(shape.value);
    const reviews = assessments.filter(a => a.experienceId === e.id && a.scope === e.scope && a.policyRevision === revision)
      .sort((a, b) => a.id.localeCompare(b.id, 'en'));
    const permission = (a: ExperientialAssessment) => approvals.find(p => p.experienceId === e.id && p.assessmentId === a.id
      && p.scope === e.scope && p.policyRevision === revision && p.principal.id !== taint?.producerId
      && p.principal.authorityId !== e.producingIdentityId && checked.value.principalKinds.includes(p.principal.kind));
    const assessment = reviews.find(a => !!permission(a)) ?? reviews[0];
    const approval = assessment ? permission(assessment) : undefined;
    if (!reason) {
      if (e.state === 'archived') reason = 'archived';
      else if (e.state === 'quarantined' || e.state === 'excluded') reason = 'quarantined';
      else if (e.scope !== checked.value.scope || taint!.reasons.includes('cross-scope')) reason = 'cross-scope';
      else if (!checked.value.allowedPrivacy.some(allowed => allowed === e.privacy) || taint!.reasons.includes('private-scope')) reason = 'private-scope';
      else if (taint!.reasons.includes('missing-source-id')) reason = 'missing-source-id';
      else if (taint!.reasons.includes('self-judged')) reason = 'self-judged';
      else if (taint!.trust === 'untrusted' && taint!.reasons.includes('untrusted-source')) reason = 'untrusted-source';
      else if (taint!.trust === 'untrusted' && taint!.reasons.includes('tainted-lineage')) reason = 'tainted-lineage';
      else if (!taint!.independentOutcome) reason = 'no-independent-outcome';
      else if (!assessment) reason = 'no-assessment';
      else if (assessment.trustDecision === 'untrusted') reason = 'untrusted-source';
      else if (assessment.contradiction === 'unresolved') reason = 'unresolved-contradiction';
      else if (assessment.inclusion === 'quarantine') reason = 'quarantined';
      else if (assessment.duplicateOf || digests.has(e.contentDigest)) reason = 'duplicate';
      else if (!assessment.generalizable) reason = 'not-generalizable';
      else if (assessment.supportingIds.filter(id => taint!.supportingIds.includes(id)).length < checked.value.minimumSupport) reason = 'insufficient-support';
      else if (!approval) reason = assessment.author.kind === 'model' ? 'model-approved' : 'no-approval';
      else if (assessment.author.kind !== 'model' && assessment.inclusion !== 'include') reason = 'quarantined';
    }
    if (reason) {
      const bucket = reason === 'quarantined' ? 'quarantined' : 'excluded';
      plan[bucket].push({ id: e.id, reason }); counts[bucket]++; counts.byReason[reason] = (counts.byReason[reason] ?? 0) + 1;
    } else {
      plan.selected.push(e); plan.assessments.push(assessment); plan.evidence.approvals.push(approval!);
      digests.add(e.contentDigest); counts.selected++;
    }
  }
  const validCounts = validateExperientialShape<ExperientialSelectionCounts>('ExperientialSelectionCounts', counts);
  if (!validCounts.ok) return validCounts;
  return { ok: true, value: deepFreeze(plan) };
}
