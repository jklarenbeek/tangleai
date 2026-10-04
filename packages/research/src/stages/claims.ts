/** Research proof policy over the shared claim envelope; the native validator owns references. */
import { validateClaimEvidence } from '@tangleai/context/evidence';
import type { ArtifactRecord, ClaimEvidenceEnvelope } from '@tangleai/context/schemas/evidence';
import { equalsJson } from '@jarenjs/core/object';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import type { ResearchWritingInputs, ResearchClaim, ResearchClaimProof, ResearchClaimLedger, EvidenceCard, MetricObservation, MetricBinding } from '../contracts.gen.ts';
import { immutableResearchJson, researchRevisionOf } from '../identity.ts';
import { researchIssue, researchRefuse, type ResearchOutcome } from '../errors.ts';
import { researchFail, researchValue, ResearchFailure } from '../workflow-contract.ts';
import { validateResearchShape } from '../schema.ts';
import { toAdmittedArtifact } from './cards.ts';
import { researchAggregate } from '../statistics.ts';
import { researchObservationSignature } from '../execution/registry.ts';

export const RESEARCH_DRAFT_SECTIONS = ['abstract', 'methods', 'experiments', 'results', 'conclusion', 'discussion'] as const;
export const researchStrictSection = (section: string): boolean => section !== 'discussion';
export const researchClaimCritical = (claim: ResearchClaim): boolean => researchStrictSection(claim.section) || claim.kind === 'metric' || claim.proof?.type === 'result';
export const researchEvidenceId = (id: string): string => id + '-evidence';
export function researchCardStrength(card: EvidenceCard): ResearchClaimProof['strength'] {
  return card.fields.some(field => ['quote', 'table', 'code'].includes(field)) ? 'exact'
    : card.fields.some(field => ['paragraph', 'list-item'].includes(field)) ? 'supports' : 'suggests';
}
export function researchObservationArtifact(row: MetricObservation): ArtifactRecord {
  return { id: row.id, kind: 'metric-observation', locator: row.experimentRunId + '#' + row.metric, digest: row.registrySignature };
}
export function researchObservationQuote(row: MetricObservation): string {
  return canonicalizeJson({ condition: row.condition, metric: row.metric, value: row.value, unit: row.unit, seed: row.seed });
}
export function researchMetricText(binding: MetricBinding, n: number): string {
  return `${binding.condition} has ${binding.aggregate === 'mean' ? 'mean' : 'individual'} ${binding.metric} ${binding.value} ${binding.unit} (n=${n}; seeds=${binding.seeds.join(',')}).`;
}
export function researchDisplayValue(value: number, digits: number | undefined): number {
  if (!Number.isFinite(value)) researchFail('TRSH1002', '/value', 'A rendered metric must be finite.');
  return digits === undefined ? value : Number(value.toFixed(digits));
}

/** Validate the immutable admitted projection; digests are provenance, not evaluator authentication. */
export async function validateResearchWritingInputs(value: unknown): Promise<ResearchOutcome<ResearchWritingInputs>> {
  try {
    const input = researchValue(validateResearchShape<ResearchWritingInputs>('ResearchWritingInputs', value));
    for (const [kind, rows] of [['cards', input.cards], ['literature', input.literature], ['observations', input.observations]] as const)
      if (new Set(rows.map(row => row.id)).size !== rows.length) researchFail('TRSH1002', '/' + kind, 'Admitted writing records must have distinct identities.');
    if (input.scope === 'retrieval-control') {
      if (input.contract || input.plan || input.decision || input.analysis || input.observations.length)
        researchFail('TRSH1004', '/scope', 'The retrieval-only control has no hypotheses, decisions or experimental observations.');
    } else {
      const { contract, plan, decision, analysis } = input;
      if (!contract || !plan || !decision || !analysis) researchFail('TRSH1003', '/decision', 'Research writing requires its retained decision and complete analysis lineage.');
      const { contractHash, ...contractBody } = contract, { planHash, ...planBody } = plan;
      const { id: analysisId, ...analysisBody } = analysis, { id: decisionId, ...decisionBody } = decision;
      if (contractHash !== await researchRevisionOf(contractBody) || planHash !== await researchRevisionOf(planBody)
        || analysisId !== 'analysis-' + await researchRevisionOf(analysisBody) || decisionId !== 'decision-' + await researchRevisionOf(decisionBody))
        researchFail('TRSH1002', '/lineage', 'Writing requires unchanged content-addressed scientific records.');
      if ([contract, plan, decision, analysis].some(row => row.projectId !== input.projectId) || plan.contractHash !== contractHash
        || analysis.contractHash !== contractHash || analysis.planHash !== planHash || decision.contractHash !== contractHash
        || decision.details?.analysisId !== analysisId || decision.details.selectedBranchId !== analysis.branchId)
        researchFail('TRSH1005', '/lineage', 'The retained writing records do not describe the same admitted comparison.');
      if (input.scope === 'research-draft' && (decision.kind !== 'Proceed' || analysis.support !== 'supported' || analysis.evidence.missingSeeds.length)
        || input.scope === 'stopped-run-audit' && decision.kind !== 'Stop')
        researchFail('TRSH1004', '/scope', 'Writing scope must preserve the actual terminal decision.');
      if (!equalsJson([...analysis.observationIds].sort(), input.observations.map(row => row.id).sort()))
        researchFail('TRSH1005', '/observations', 'The writer must retain every observation in its selected analysis.');
      for (const row of input.observations) {
        const metric = contract.metrics.find(metric => metric.id === row.metric);
        if (row.projectId !== input.projectId || !metric || row.unit !== metric.unit || !plan.conditions.some(condition => condition.id === row.condition)
          || !contract.replicatePolicy.seeds.includes(row.seed) || row.evaluatorId !== plan.evaluator.id || row.evaluatorVersion !== plan.evaluator.version)
          researchFail('TRSH1006', '/observations', 'Metric condition, unit, seed and evaluator must be preregistered.');
        const registrySignature = await researchObservationSignature(row);
        if (registrySignature !== row.registrySignature || row.id !== 'metric-' + await researchRevisionOf({ experimentRunId: row.experimentRunId, registrySignature }))
          researchFail('TRSH1002', '/observations', 'An observation changed after registry admission.');
      }
      const metrics = plan.conditions.flatMap(condition => contract.metrics.map(metric => researchAggregate(condition.id, metric.id, metric.unit, input.observations)));
      if (!equalsJson(metrics, analysis.metrics)) researchFail('TRSH1002', '/analysis/metrics', 'The retained analysis must reproduce its admitted observation rows.');
    }
    for (const card of input.cards) if (card.artifactId !== 'art-' + card.contentHash || !input.literature.some(row => row.id === card.literatureId))
      researchFail('TRSH1003', '/cards', 'Each admitted card must resolve to its source hash and literature record.');
    return { valid: true, value: input };
  } catch (cause) { return cause instanceof ResearchFailure ? { valid: false, issues: [cause.issue] }
    : researchRefuse('TRSH1001', '/writing', 'Writing inputs must be finite immutable admitted records.', cause); }
}

/** Arrange admitted quotations and registered means; no model or evidence write occurs here. */
export async function buildClaimLedger(value: ResearchWritingInputs, proposed?: readonly ResearchClaim[]): Promise<ResearchOutcome<ResearchClaimLedger>> {
  try {
    proposed = proposed ? immutableResearchJson(proposed) : undefined;
    const input = researchValue(await validateResearchWritingInputs(value));
    const claims: ResearchClaim[] = proposed ? immutableResearchJson([...proposed]) : [];
    if (!proposed) {
      for (const [index, card] of input.cards.entries()) {
        const record = input.literature.find(row => row.id === card.literatureId)!;
        const body: Omit<ResearchClaim, 'id'> = { section: index === 0 ? 'methods' : 'discussion', kind: 'literature', text: card.excerpt,
          literatureIds: [record.id], evidenceIds: [researchEvidenceId(card.id)], observationIds: [], strength: 'descriptive', metricBinding: null,
          proof: { type: 'literature', strength: researchCardStrength(card), cardId: card.id, quote: card.excerpt,
            citation: { recordId: record.id, canonicalIds: record.canonicalIds, rawHashes: record.rawHashes }, n: null } };
        claims.push({ id: 'claim-' + await researchRevisionOf(body), ...body });
      }
      for (const aggregate of input.analysis?.metrics ?? []) {
        if (aggregate.mean === null) continue;
        const metric = input.contract!.metrics.find(row => row.id === aggregate.metric)!;
        const binding: MetricBinding = { condition: aggregate.condition, metric: aggregate.metric, unit: aggregate.unit,
          seeds: aggregate.values.map(row => row.seed), aggregate: 'mean', value: researchDisplayValue(aggregate.mean, metric.roundingDigits) };
        const body: Omit<ResearchClaim, 'id'> = { section: 'results', kind: 'metric', text: researchMetricText(binding, aggregate.n), literatureIds: [],
          evidenceIds: aggregate.values.map(row => researchEvidenceId(row.observationId)), observationIds: aggregate.values.map(row => row.observationId),
          strength: 'descriptive', metricBinding: binding,
          proof: { type: 'result', strength: 'exact', cardId: null, quote: null, citation: null, n: aggregate.n } };
        claims.push({ id: 'claim-' + await researchRevisionOf(body), ...body });
      }
    }
    for (const claim of claims) researchValue(validateResearchShape('ResearchClaim', claim));
    const envelope: ClaimEvidenceEnvelope = { version: 1, artifacts: [...input.cards.map(toAdmittedArtifact), ...input.observations.map(researchObservationArtifact)],
      evidence: [...input.cards.map(card => ({ id: researchEvidenceId(card.id), artifact: card.id, selector: '/excerpt', quote: card.excerpt })),
        ...input.observations.map(row => ({ id: researchEvidenceId(row.id), artifact: row.id, selector: '/value', quote: researchObservationQuote(row) }))],
      claims: claims.map(claim => ({ id: claim.id, text: claim.text, critical: researchClaimCritical(claim),
        status: claim.evidenceIds.length ? 'supported' : 'unresolved', evidence: claim.evidenceIds })), visibleEvidence: [] };
    envelope.visibleEvidence = envelope.evidence.map(row => row.id);
    const checked = validateClaimEvidence(envelope, { artifacts: envelope.artifacts });
    if (!checked.valid) return { valid: false, issues: (checked.errors ?? []).map((error: unknown) =>
      researchIssue('TRSH1005', '/envelope', 'The native claim validator refused the proposed evidence view.', error)) };
    const body = { projectId: input.projectId, scope: input.scope, decisionId: input.decision?.id ?? null, analysisId: input.analysis?.id ?? null, claims, envelope };
    return validateResearchShape<ResearchClaimLedger>('ResearchClaimLedger', { id: 'ledger-' + await researchRevisionOf(body), ...body });
  } catch (cause) { return cause instanceof ResearchFailure ? { valid: false, issues: [cause.issue] }
    : researchRefuse('TRSH1001', '/claims', 'The claim ledger requires finite immutable evidence.', cause); }
}
