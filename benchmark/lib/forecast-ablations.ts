/** Read-only accounting and a predeclared comparison; the promotion gate is never relaxed. */
import { forecastRevision, visibleHarness, admitEvidence, type HarnessRevision, type RetrospectiveCheck } from '@tangleai/forecast';
import { bootstrapInterval } from './locomo-policy.ts';
import type { Row } from './forecast.types.ts';

export const FORECAST_CLAIM_POLICY = Object.freeze({ id: 'forecast-paired-utility/v1',treatment: 'evolving-harness',control: 'scaffold-no-harness',resamples: 10000,seed: 17753,level: 0.95,budget: Object.freeze({ maxCallsPerCheckpoint: 8,maxRetrospectiveCalls: 4,maxTokensPerCall: 1024,maxPhysicalRequests: 0 } as const) } as const);
export function forecastCounterfactuals(evolving: Row) {
  if (!evolving.lifecycle || !evolving.runtime) throw Error('Counterfactual accounting requires retained evolving records.');
  const revisions = evolving.runtime.retained.map(r => r.revision).filter(Boolean) as unknown as HarnessRevision[], retrospectives = evolving.lifecycle.records.retrospectives as unknown as RetrospectiveCheck[];
  const refused = revisions.filter(r => !r.validation.ok), kinds: Record<string,number> = {};
  for (const r of revisions) for (const kind of r.gate.volatileFact.items) kinds[kind] = (kinds[kind] ?? 0)+1;
  const excluded = revisions.flatMap(r => r.deferredFeedback.filter(g => g.reason.startsWith('TFCT1008:')));
  const semanticRefusals = revisions.reduce((n,r) => n+r.gate.volatileFact.items.filter(kind => kind === 'semantic').length,0);
  const refined = retrospectives.filter(r => r.verdicts.some(v => v.verdict === 'refine'));
  return { gateCounterfactual: { revisionAttempts: revisions.length,refusedRevisions: refused.length,guidanceRefused: revisions.reduce((n,r) => n+r.gate.volatileFact.refused,0),byKind: kinds,semanticRefusals,excludedGuidanceBytes: excluded.reduce((n,g) => n+new TextEncoder().encode(g.text).length,0),newWrites: 0 as const,scope: 'Retained primary revisions only; adversarial leak probes are separate and buy no editor calls.' },verdictOnlyPromotion: { refinedCandidates: refined.length,promoted: refined.filter(r => r.outcome === 'promoted').length,refused: refined.filter(r => r.outcome === 'ineligible').length,candidates: evolving.lifecycle.pairedCandidates.map(c => ({ versionId: c.versionId,delta: c.delta,eligible: c.eligible,issues: c.issues })),newWrites: 0 as const } };
}
export async function forecastClaimGate(rows: readonly Row[], observed: { cutoffViolations: number;crossScopeLeaks: number }) {
  const treatment = rows.find(r => r.id === FORECAST_CLAIM_POLICY.treatment), control = rows.find(r => r.id === FORECAST_CLAIM_POLICY.control);
  if (!treatment || !control || treatment.status !== 'measured' || control.status !== 'measured') throw Error('The registered claim requires both measured treatments.');
  const resolved = treatment.cases.filter(c => c.available), pairs = resolved.map(c => {
    const other = control.cases.find(x => x.checkpointId === c.checkpointId);
    if (!other || other.questionId !== c.questionId || other.cutoffAt !== c.cutoffAt || !other.available) throw Error('The claim comparison lost its registered pairs.');
    return { checkpointId: c.checkpointId,treatment: c.utility,control: other.utility,delta: c.utility === null || other.utility === null ? null : c.utility-other.utility };
  });
  const complete = pairs.length > 0 && pairs.every(p => p.delta !== null) && resolved.length === control.cases.filter(c => c.available).length;
  const deltas = pairs.flatMap(p => p.delta === null ? [] : [p.delta]), interval = bootstrapInterval(deltas,FORECAST_CLAIM_POLICY), delta = deltas.length ? deltas.reduce((a,b) => a+b,0)/deltas.length : null;
  const bounds = { maxCalls: treatment.counts.planned*FORECAST_CLAIM_POLICY.budget.maxCallsPerCheckpoint+(treatment.lifecycle?.resolutions ?? 0)*FORECAST_CLAIM_POLICY.budget.maxRetrospectiveCalls,maxTokens: (treatment.counts.planned*FORECAST_CLAIM_POLICY.budget.maxCallsPerCheckpoint+(treatment.lifecycle?.resolutions ?? 0)*FORECAST_CLAIM_POLICY.budget.maxRetrospectiveCalls)*FORECAST_CLAIM_POLICY.budget.maxTokensPerCall,maxPhysicalRequests: FORECAST_CLAIM_POLICY.budget.maxPhysicalRequests };
  const withinBudget = [treatment,control].every(r => r.cost.calls <= bounds.maxCalls && r.cost.tokens !== null && r.cost.tokens <= bounds.maxTokens && r.runtime?.physicalCalls === 0);
  const passed = complete && withinBudget && interval.low > 0 && delta !== null && delta > 0 && observed.cutoffViolations === 0 && observed.crossScopeLeaks === 0;
  return { policy: FORECAST_CLAIM_POLICY,policyId: await forecastRevision(FORECAST_CLAIM_POLICY),pairs,delta,interval,complete,budget: bounds,withinBudget,...observed,verdict: passed ? 'positive' as const : 'not-demonstrated' as const,quality: 'unmeasured-scripted-conformance' as const,writeback: 'experimental-opt-in' as const,cost: { treatment: treatment.cost,control: control.cost } };
}

export function forecastClaimObservations(rows: readonly Row[]) {
  let cutoffViolations = 0,crossScopeLeaks = 0;
  for (const row of rows) for (const retained of row.runtime?.retained ?? []) {
    const r = retained as unknown as { question: import('@tangleai/forecast').ForecastQuestion;checkpoint: import('@tangleai/forecast').ForecastCheckpoint;harness: import('@tangleai/forecast').ForecastHarnessVersion | null;evidence: import('@tangleai/forecast').ForecastEvidence[] };
    if (r.harness && !visibleHarness(r.question,r.harness).ok) crossScopeLeaks++;
    for (const evidence of r.evidence) if (evidence.admitted) { const admitted = admitEvidence(evidence,r.checkpoint.cutoffAt);if (!admitted.ok || !admitted.value.admitted) cutoffViolations++; }
  }
  return { cutoffViolations,crossScopeLeaks };
}
